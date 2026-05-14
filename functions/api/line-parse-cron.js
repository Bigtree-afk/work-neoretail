/**
 * Line 메시지 큐 → Claude 파싱 → line_pending 으로 적재
 *
 *   POST /api/line-parse-cron
 *   Header: authorization: Bearer <parseSecret>   ← line_config.parseSecret 와 일치 필요
 *   Body  : { force?: true }   force=true 일 때 업무시간 외에도 실행
 *
 * 동작:
 *   1) 업무시간(KST 09:00~19:00, 평일) 체크 (force 면 우회)
 *   2) line_raw_queue 에서 미처리 메시지 꺼내옴 (마지막 처리 시각 이후)
 *   3) 채팅방별로 묶어서 Claude 분석
 *   4) line_pending 큐로 push
 *   5) 'line_parse_lastrun' 갱신
 */

import { appendParseLog } from './line-parse-log.js';

const RAW_KEY    = 'line_raw_queue';
const PENDING_KEY= 'line_pending';
const LASTRUN_KEY= 'line_parse_lastrun';
const CFG_KEY    = 'line_config';
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_MSGS_PER_RUN = 200;
const MAX_PENDING = 500;
const MAX_RETRY = 3;   // 룸 파싱 실패 시 최대 재시도 횟수 — 초과 시 cursor 강제 이동(영구 미처리 메시지로 표시)
const ALERT_THROTTLE_KEY = 'line_alert_lastsent';
const ALERT_THROTTLE_SEC = 600;   // 같은 종류 알림 10분 내 중복 송신 차단

/* LINE Messaging API push — cfg.alertRecipientId 로 텍스트 전송 */
async function notifyLineAlert(env, cfg, kind, text) {
  if (!cfg.alertRecipientId || !cfg.channelAccessToken) return { ok:false, reason:'no recipient or token' };
  // 쓰로틀: 같은 kind 가 ALERT_THROTTLE_SEC 내 송신됐으면 skip
  try {
    const last = (await env.STORES_KV.get(ALERT_THROTTLE_KEY, 'json')) || {};
    const t = Number(last[kind] || 0);
    if (Date.now() - t < ALERT_THROTTLE_SEC * 1000) return { ok:false, reason:'throttled', skipped:true };
    last[kind] = Date.now();
    await env.STORES_KV.put(ALERT_THROTTLE_KEY, JSON.stringify(last));
  } catch(e) {}
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method:'POST',
      headers:{
        'authorization': `Bearer ${cfg.channelAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: cfg.alertRecipientId,
        messages: [{ type:'text', text: String(text).slice(0, 4900) }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(()=>'');
      return { ok:false, status:r.status, error: errText.slice(0,200) };
    }
    return { ok:true };
  } catch(e) {
    return { ok:false, error:e.message };
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return json({ error:'KV not bound' }, 500);
  const cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {};

  // 보호 — Bearer 토큰
  const authHdr = request.headers.get('authorization') || '';
  const token = authHdr.startsWith('Bearer ') ? authHdr.slice(7) : '';
  if (!cfg.parseSecret || token !== cfg.parseSecret) {
    return json({ error:'unauthorized' }, 401);
  }

  let body = {};
  try { body = await request.json(); } catch(e){}
  const force = !!body.force;

  // 업무시간 체크 (KST 평일 08:30 ~ 17:59 — 매시 45분 cron 커버)
  if (!force) {
    const nowKst = new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Seoul' }));
    const dow = nowKst.getDay();
    const hr = nowKst.getHours();
    const mn = nowKst.getMinutes();
    const tooEarly = (hr < 8) || (hr === 8 && mn < 30);
    const tooLate  = (hr >= 18);
    if (dow === 0 || dow === 6 || tooEarly || tooLate) {
      return json({ ok:true, skipped:true, reason:'outside business hours (KST 평일 08:45~17:45)' }, 200);
    }
  }

  const apiKey = cfg.claudeApiKey;
  if (!apiKey) {
    await notifyLineAlert(env, cfg, 'no_api_key',
      '🚨 [NeoRetail 파싱 알림]\nClaude API 키가 설정되지 않아 파싱 cron 이 실행되지 않습니다.\n관리자 페이지 → LINE 설정에서 Claude API key 를 입력하세요.');
    return json({ error:'claudeApiKey not configured' }, 503);
  }

  const lastRun = Number(await env.STORES_KV.get(LASTRUN_KEY) || '0');
  const queue = (await env.STORES_KV.get(RAW_KEY, 'json')) || { items: [] };

  // Watchdog — cron 드롭 감지: 미처리 메시지가 90분 이상 묵으면 LINE 알림
  // (이 cron 이 결국 실행되었을 때 알림이 발사됨 — Cloudflare Worker + GHA 이중화로
  //  한쪽이 드롭되어도 다른 한쪽이 실행되어 watchdog 트리거)
  try {
    const STALE_THRESHOLD_MS = 90 * 60 * 1000;
    const oldestUnprocessed = queue.items
      .filter(m => !m.processedAt)
      .reduce((acc, m) => {
        const t = Number(m.ts || 0);
        return t > 0 && (acc === 0 || t < acc) ? t : acc;
      }, 0);
    if (oldestUnprocessed > 0 && (Date.now() - oldestUnprocessed) > STALE_THRESHOLD_MS) {
      const ageMin = Math.round((Date.now() - oldestUnprocessed) / 60000);
      const unprocessedCount = queue.items.filter(m => !m.processedAt).length;
      await notifyLineAlert(env, cfg, 'cron_stale',
        `⚠️ [NeoRetail 파싱 알림]\n큐에 미처리 메시지가 ${ageMin}분 이상 누적되어 있습니다.\n` +
        `미처리: ${unprocessedCount}건, 가장 오래된 메시지: ${ageMin}분 전.\n` +
        `cron 트리거(Cloudflare Worker 또는 GitHub Actions) 가 일시적으로 누락되었을 가능성.\n` +
        `이 cron 이 실행되어 알림이 도달했으므로 곧 처리됩니다.`);
    }
  } catch(e) { /* watchdog 실패해도 본 처리는 계속 */ }

  // 미처리 메시지만 (m.processedAt 없는 것 + ts > lastRun 빠른 필터)
  // - processedAt: 성공/giveup 시 Date.now() 로 마크
  // - failed-retryable 메시지는 processedAt 없음 → 다음 cron 에서 재시도
  const allFresh = queue.items
    .filter(m => !m.processedAt && Number(m.ts||0) > lastRun)
    .sort((a,b) => Number(a.ts||0) - Number(b.ts||0));
  const fresh = allFresh.slice(0, MAX_MSGS_PER_RUN);
  const overflowCount = Math.max(0, allFresh.length - MAX_MSGS_PER_RUN);
  if (!fresh.length) {
    // cursor 는 손대지 않음 — Date.now() 로 옮기면 큐에 늦게 추가된 메시지(시각이 과거인) 누락 위험
    return json({ ok:true, parsed:0, msg:'no new messages' }, 200);
  }

  // 채팅방별로 묶어서 분석
  const byRoom = {};
  for (const m of fresh) {
    (byRoom[m.room] ||= []).push(m);
  }

  const pendingCur = (await env.STORES_KV.get(PENDING_KEY, 'json')) || { items: [] };
  // 매장 목록 로드 — 서버측 자동 매칭에 사용
  const storesData = (await env.STORES_KV.get('stores', 'json')) || { stores: [] };
  const storeList = Array.isArray(storesData.stores) ? storesData.stores : (Array.isArray(storesData) ? storesData : []);
  let totalAdded = 0;
  const errors = [];
  const runAt = new Date().toISOString();
  const parseSource = force ? 'manual' : 'cron';
  const allLogs = [];
  const failedRoomMsgIds = new Set();   // Claude 호출 실패한 룸의 메시지 id — cursor 미이동 대상
  const giveUpMsgIds = new Set();       // 재시도 한계 초과로 강제 이동된 메시지 id

  const FIXED_TYPES = ['equip_out','delivery','label'];

  for (const [roomId, msgs] of Object.entries(byRoom)) {
    const roomInfo = (cfg.roomMap||{})[roomId] || { name: roomId, type:'general' };
    const isFixedRoom = roomInfo.parseMode === 'fixed' && FIXED_TYPES.includes(roomInfo.type);
    const blob = msgs.map(m => {
      const t = new Date(Number(m.ts||0));
      const hh = String(t.getUTCHours()+9).padStart(2,'0').slice(-2);
      const mi = String(t.getUTCMinutes()).padStart(2,'0');
      return `[${hh}:${mi}] ${m.sender||'?'}: ${m.text||''}`;
    }).join('\n');

    try {
      let items;
      if (isFixedRoom) {
        // 고정 분류 룸 — Claude 호출 안 함. 각 메시지를 룸 타입으로 분류.
        items = msgs
          .filter(m => (m.text||'').trim().length > 1)  // 1글자 잡담 제외
          .map(m => {
            const t = new Date(Number(m.ts||0));
            const hh = String(t.getUTCHours()+9).padStart(2,'0').slice(-2);
            const mi = String(t.getUTCMinutes()).padStart(2,'0');
            return {
              type: roomInfo.type,
              status: '접수',
              sender: m.sender || '',
              time: `${hh}:${mi}`,
              store: '',       // 고정룸은 매장이 메시지에서 직접 추출 안 됨 — 사람이 검토 시 지정
              storeMatched: false,
              assignee: '',
              device: '',
              request: m.text || '',
              parsed: (m.text || '').slice(0, 80),
              original: m.text || '',
            };
          });
      } else {
        const parsed = await parseWithClaude(apiKey, blob, roomInfo);
        items = parsed.items || [];
      }

      // Claude 가 반환한 항목들을 원본 메시지와 매칭 — original 텍스트 일치로
      const itemByText = new Map();
      for (const it of items) {
        const k = (it.original || '').slice(0, 40);
        if (k) itemByText.set(k, it);
      }

      // 모든 원본 메시지에 대해 결과 로그 작성
      for (const m of msgs) {
        const matched = _findItemForMsg(items, m);
        const t = new Date(Number(m.ts||0));
        const kstHH = String(t.getUTCHours()+9).padStart(2,'0').slice(-2);
        const kstMI = String(t.getUTCMinutes()).padStart(2,'0');
        const msgKstDate = new Date(t.getTime()+9*3600*1000).toISOString().slice(0,10);
        const msgAtKst = `${msgKstDate} ${kstHH}:${kstMI}`;

        const logEntry = {
          logId:       `log-${m.id || (m.ts+'-'+Math.random().toString(36).slice(2,6))}`,
          msgTs:       m.ts || 0,
          msgAtKst,
          room:        roomId,
          roomName:    roomInfo.name || roomId,
          sender:      m.sender || '',
          text:        (m.text||'').slice(0, 300),
          result:      'ignore',
          category:    '',
          pendingId:   '',
          status:      '',
          store:       '',
          assignee:    '',
          parseRunAt:  runAt,
          parseSource,
          reason:      'Claude 가 무관 메시지로 분류',
        };

        if (matched) {
          if (matched.type === 'ignore') {
            logEntry.result = 'ignore';
            logEntry.reason = matched.parsed || matched.request || '잡담/인사/확인';
          } else {
            logEntry.result = 'pending';
            logEntry.category = matched.type;
            logEntry.status = matched.status || '';
            logEntry.store = matched.store || '';
            logEntry.assignee = matched.assignee || '';
            // pendingId 는 buildPending 에서 할당됨 — 아래에서 채움
          }
        }
        allLogs.push({ logEntry, matchedItem: matched });
      }

      // pending 큐 형식으로 변환
      const now = Date.now();
      const addItems = items
        .filter(it => it.type && it.type !== 'ignore')
        .map((it, i) => {
          const pend = buildPending(it, msgs, roomId, roomInfo, now, i, storeList);
          // 매칭된 로그에 pendingId 채우기 + 매장 자동연결 정보 반영
          for (const log of allLogs) {
            if (log.matchedItem === it) {
              log.logEntry.pendingId = pend.id;
              if (pend.storeId) log.logEntry.store = pend.store + ' ✓';
            }
          }
          return pend;
        });
      pendingCur.items = [...addItems, ...pendingCur.items].slice(0, MAX_PENDING);
      totalAdded += addItems.length;

      // 성공 처리된 메시지들 — processedAt 마킹 (다음 cron 에서 재처리 방지)
      const processedStamp = Date.now();
      for (const m of msgs) {
        m.processedAt = processedStamp;
        if (m.parseAttempts) delete m.lastParseError;  // 이전 시도 에러 정리
      }
    } catch(e) {
      errors.push({ room: roomId, error: e.message });
      // 실패한 채팅방 메시지들 — 재시도 카운트 체크
      for (const m of msgs) {
        const attempts = Number(m.parseAttempts || 0) + 1;
        m.parseAttempts = attempts;   // 큐 객체에 직접 갱신 (아래에서 KV 에 다시 저장)
        m.lastParseError = e.message;
        const giveUp = attempts >= MAX_RETRY;
        if (giveUp) {
          giveUpMsgIds.add(m.id);
          m.processedAt = Date.now();  // 재시도 한계 초과 — 영구 건너뜀
          m.processedStatus = 'giveup';
        } else {
          failedRoomMsgIds.add(m.id);
          // processedAt 미설정 → 다음 cron 에서 재시도
        }

        const t = new Date(Number(m.ts||0));
        const kstHH = String(t.getUTCHours()+9).padStart(2,'0').slice(-2);
        const kstMI = String(t.getUTCMinutes()).padStart(2,'0');
        const msgKstDate = new Date(t.getTime()+9*3600*1000).toISOString().slice(0,10);
        allLogs.push({
          logEntry: {
            logId:       `log-err-${m.id || m.ts}-${attempts}`,
            msgTs:       m.ts || 0,
            msgAtKst:    `${msgKstDate} ${kstHH}:${kstMI}`,
            room:        roomId,
            roomName:    roomInfo.name || roomId,
            sender:      m.sender || '',
            text:        (m.text||'').slice(0, 300),
            result:      giveUp ? 'error_giveup' : 'error',
            reason:      `${e.message} (시도 ${attempts}/${MAX_RETRY}${giveUp ? ' — 재시도 한계 초과, 건너뜀' : ' — 다음 cron 에서 재시도'})`,
            parseRunAt:  runAt,
            parseSource,
          }, matchedItem: null
        });
      }
    }
  }

  // Overflow 경고 로그 — 200건 cap 초과 시 다음 cron 이 자동으로 이어 처리됨을 알림
  if (overflowCount > 0) {
    allLogs.push({
      logEntry: {
        logId:       `log-overflow-${Date.now().toString(36)}`,
        msgTs:       Date.now(),
        msgAtKst:    new Date(Date.now()+9*3600*1000).toISOString().slice(0,16).replace('T',' '),
        room:        '*',
        roomName:    '(시스템)',
        sender:      'cron',
        text:        `이번 cron 처리량 ${fresh.length}건 — 추가로 ${overflowCount}건 누적 (다음 cron 에서 처리 예정)`,
        result:      'overflow',
        reason:      `MAX_MSGS_PER_RUN=${MAX_MSGS_PER_RUN} 초과`,
        parseRunAt:  runAt,
        parseSource,
      }, matchedItem: null
    });
  }

  // 로그 적재
  try {
    await appendParseLog(env, allLogs.map(x => x.logEntry));
  } catch(e) {
    console.warn('log append failed', e.message);
  }

  if (totalAdded > 0) await env.STORES_KV.put(PENDING_KEY, JSON.stringify(pendingCur));

  // === Cursor 진행 ===
  // - 처리 완료(processedAt 마킹된) 메시지 중 최소 ts 직전까지만 cursor 이동
  //   즉 retry 대기 중인 가장 오래된 메시지의 ts 직전까지만 이동
  // - retry 대기 메시지가 없으면 fresh 중 max ts 로 이동
  // - lastRun 은 빠른 필터일 뿐 — 실제 재처리 방지는 m.processedAt 가 담당
  let newCursor = lastRun;
  const retryPending = fresh.filter(m => !m.processedAt).sort((a,b)=>Number(a.ts||0)-Number(b.ts||0));
  if (retryPending.length > 0) {
    // retry 메시지의 (min ts - 1) 까지만 이동 — retry 메시지 자체는 다음 run 에서도 잡혀야 함
    newCursor = Math.max(lastRun, Number(retryPending[0].ts||0) - 1);
  } else {
    // 전부 처리됨 — fresh 중 max ts 로 이동
    for (const m of fresh) {
      const t = Number(m.ts || 0);
      if (t > newCursor) newCursor = t;
    }
  }
  if (newCursor > lastRun) {
    await env.STORES_KV.put(LASTRUN_KEY, String(newCursor));
  }

  // 큐 다시 저장 — processedAt / parseAttempts 등 메타 변경 반영
  // 동시 webhook write 와의 충돌 완화: 다시 읽어와서 id 기준으로 메타만 병합
  try {
    const latest = (await env.STORES_KV.get(RAW_KEY, 'json')) || { items: [] };
    const metaById = new Map();
    for (const m of fresh) {
      if (m.processedAt || m.parseAttempts) {
        metaById.set(m.id, {
          processedAt: m.processedAt,
          processedStatus: m.processedStatus,
          parseAttempts: m.parseAttempts,
          lastParseError: m.lastParseError,
        });
      }
    }
    for (const lm of latest.items) {
      const meta = metaById.get(lm.id);
      if (meta) {
        if (meta.processedAt != null) lm.processedAt = meta.processedAt;
        if (meta.processedStatus)     lm.processedStatus = meta.processedStatus;
        if (meta.parseAttempts != null) lm.parseAttempts = meta.parseAttempts;
        if (meta.lastParseError)      lm.lastParseError = meta.lastParseError;
        else delete lm.lastParseError;
      }
    }
    await env.STORES_KV.put(RAW_KEY, JSON.stringify(latest));
  } catch(e) {
    console.warn('queue meta merge failed:', e.message);
  }

  // === 알림 발송 ===
  // 1) giveup 발생 시 — 사람이 봐야 하는 영구 실패 메시지 안내
  let alertResults = [];
  if (giveUpMsgIds.size > 0) {
    const sample = [];
    for (const m of fresh) {
      if (giveUpMsgIds.has(m.id) && sample.length < 3) {
        sample.push(`• ${m.sender||'?'}: ${(m.text||'').slice(0,40)}…`);
      }
    }
    const msg = `🚨 [NeoRetail 파싱 알림]\n메시지 ${giveUpMsgIds.size}건이 ${MAX_RETRY}회 재시도 후에도 분석 실패로 영구 건너뜀 처리되었습니다.\n\n샘플:\n${sample.join('\n')}\n\n원인: Claude API 호출 실패 또는 응답 파싱 오류.\n관리자 페이지 → 파싱 로그에서 'error_giveup' 항목을 확인하세요.`;
    alertResults.push(await notifyLineAlert(env, cfg, 'giveup', msg));
  }
  // 2) 룸 에러가 다수 발생 시 — Claude API 문제일 가능성
  if (errors.length >= 3) {
    const msg = `⚠️ [NeoRetail 파싱 경고]\n이번 cron 에서 ${errors.length}개 채팅방의 파싱이 실패했습니다.\n\n원인: ${errors[0].error.slice(0,80)}\n\nClaude API 키나 네트워크를 확인하세요. 자동 재시도 진행 중.`;
    alertResults.push(await notifyLineAlert(env, cfg, 'many_errors', msg));
  }
  // 3) overflow — 메시지 적체가 심한 경우
  if (overflowCount >= 100) {
    const msg = `📥 [NeoRetail 파싱 알림]\n메시지 누적 ${fresh.length + overflowCount}건 (한 회 처리 한도 ${MAX_MSGS_PER_RUN} 초과 ${overflowCount}건).\n다음 cron 들이 자동으로 이어서 처리합니다.`;
    alertResults.push(await notifyLineAlert(env, cfg, 'overflow', msg));
  }

  return json({
    ok: true,
    processed: fresh.length,
    overflowed: overflowCount,
    rooms: Object.keys(byRoom).length,
    pendingAdded: totalAdded,
    errors,
    retried: failedRoomMsgIds.size,
    gaveUp: giveUpMsgIds.size,
    cursorAdvanced: newCursor > lastRun,
    alerts: alertResults,
    runAt: new Date().toISOString(),
  }, 200);
}

/* Claude 파싱 결과 항목을 원본 메시지에 매칭 — text 부분 일치 + sender 일치 */
function _findItemForMsg(items, m) {
  if (!items || !items.length || !m) return null;
  const text = String(m.text||'').toLowerCase().replace(/\s+/g,'');
  if (!text) return null;
  const sender = String(m.sender||'');
  // 1) original 부분 일치 + sender 일치
  let found = items.find(it => {
    const o = String(it.original||'').toLowerCase().replace(/\s+/g,'');
    return o && (text.includes(o.slice(0,20)) || o.includes(text.slice(0,20)))
        && (!it.sender || !sender || it.sender === sender);
  });
  if (found) return found;
  // 2) original 부분 일치
  found = items.find(it => {
    const o = String(it.original||'').toLowerCase().replace(/\s+/g,'');
    return o && (text.includes(o.slice(0,15)) || o.includes(text.slice(0,15)));
  });
  if (found) return found;
  // 3) request/parsed 일치 (마지막 시도)
  found = items.find(it => {
    const blob = String((it.request||'') + ' ' + (it.parsed||'')).toLowerCase().replace(/\s+/g,'');
    return blob && (blob.includes(text.slice(0,15)) || text.includes(blob.slice(0,15)));
  });
  return found || null;
}

/* 매장 점수 매칭 — 다중 토큰 + 이름/별칭/주소 가중 */
function _matchStoreOnServer(storeText, storeList) {
  if (!storeText || !storeList || !storeList.length) return null;
  const norm = (x) => String(x||'').toLowerCase().replace(/\s+/g,'');
  const tokens = String(storeText).trim().split(/\s+/).filter(t => t.length > 0);
  if (!tokens.length) return null;

  const score = (s) => {
    const name = norm(s.name);
    const addr = norm(s.addr || s.address);
    const aliases = (Array.isArray(s.aliases) ? s.aliases : []).map(norm);
    let sc = 0, matched = 0;
    for (const t of tokens) {
      const nt = norm(t);
      if (!nt) continue;
      let hit = false;
      if (name === nt)             { sc += 10; hit = true; }
      else if (name.includes(nt))  { sc += 4;  hit = true; }
      if (aliases.some(a => a === nt))            { sc += 8; hit = true; }
      else if (aliases.some(a => a.includes(nt))) { sc += 3; hit = true; }
      if (addr.includes(nt))       { sc += 2;  hit = true; }
      if (hit) matched++;
    }
    if (matched === tokens.length && tokens.length >= 2) sc += 5;
    return { score: sc, matched };
  };

  const ranked = storeList
    .map(s => ({ s, ...score(s) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.matched - a.matched);

  if (!ranked.length) return null;
  const top = ranked[0];
  const second = ranked[1];
  // 자동 연결 임계값:
  //   - 점수 >= 5 (이름 부분일치 1회 + 주소 일치 = 6 정도, 또는 다중토큰 보너스)
  //   - 2위와 1.3배 이상 차이 (안전 마진 — 동점이면 사람 검토)
  if (top.score >= 5 && (!second || top.score >= second.score * 1.3)) {
    return top.s;
  }
  return null;
}

function buildPending(it, msgs, roomId, roomInfo, now, idx, storeList) {
  // 라인 메시지 시각 (HH:MM → 오늘 KST, 또는 가장 비슷한 메시지 시각)
  const time = it.time || '';
  let lineMsgAt = '';
  if (/^\d{2}:\d{2}$/.test(time)) {
    const matched = msgs.find(m => {
      const t = new Date(Number(m.ts||0));
      const hh = String(t.getUTCHours()+9).padStart(2,'0').slice(-2);
      const mi = String(t.getUTCMinutes()).padStart(2,'0');
      return `${hh}:${mi}` === time;
    });
    if (matched) {
      const d = new Date(Number(matched.ts||0));
      const kst = new Date(d.getTime() + 9*3600*1000);
      lineMsgAt = kst.toISOString().slice(0,16).replace('T',' ');
    } else {
      lineMsgAt = new Date(now+9*3600*1000).toISOString().slice(0,10) + ' ' + time;
    }
  } else {
    lineMsgAt = new Date(now+9*3600*1000).toISOString().slice(0,16).replace('T',' ');
  }

  let status = '접수';
  if (it.status === '완료') status = '완료';
  else if (it.status === '진행중') status = '진행중';
  else if (it.status === '재방문필요' || it.status === '심사중') status = '추가처리';

  // 매장 자동 매칭 — 임계값 통과하면 storeId 채워서 '연결됨' 상태로 등록
  const matchedStore = _matchStoreOnServer(it.store, storeList);

  return {
    id: `cron-${now.toString(36)}-${idx}-${Math.random().toString(36).slice(2,5)}`,
    lineMsgAt,
    lineSender: it.sender || '',
    lineRoom:   roomInfo.name || roomId,
    lineRoomId: roomId,
    lineCategory: it.type,
    lineRaw:    it.original || '',
    lineParsed: it.parsed || '',
    lineRequest: it.request || '',
    lineDevice: it.device || '',
    store:      matchedStore ? matchedStore.name : (it.store || ''),
    storeId:    matchedStore ? matchedStore.id : '',
    storeOriginal: it.store || '',   // Claude 가 추출한 원본 매장명 — 자동 매칭이 잘못된 경우 대조용
    assignee:   it.assignee || '',
    status,
    memo:       '',
    action:     'new',
    targetJobId:'',
    createdAtSrv: new Date().toISOString(),
    source: 'cron',
  };
}

async function parseWithClaude(apiKey, chatBlob, roomInfo) {
  const ROOM_TYPE_LABELS = {
    general:'일반 대화', as:'AS/작업 접수 목적', work:'업무 지시 목적', schedule:'일정 관리 목적',
    equip_out:'장비 출고 목적', delivery:'택배 관리 목적', label:'라벨지 작업 목적',
  };
  const typeLabel = ROOM_TYPE_LABELS[roomInfo.type] || '일반';
  const prompt = `당신은 POS/VAN 설치·AS 관리 회사의 운영 어시스턴트입니다.
아래는 '${roomInfo.name}' (${typeLabel}) Line 그룹 채팅 내용입니다.

각 메시지를 분석해서 업무적으로 의미 있는 항목을 추출하고 8개 카테고리 중 하나로 분류해 주세요.

## 카테고리
1. **pos_as** — POS A/S: POS 본체·키오스크·영수증프린터·POS SW 오류, 매장 방문 수리 등
2. **van_as** — VAN A/S: 카드결제기(VAN 단말기) 통신·IC/리더기 인식·체크기 오류·단말 교체 등
3. **device_mgmt** — 단말기 A/S: 이동단말기(휴대용/무선)·핸드스캐너·PDA AS·수리완료·대체품·신규개통·SN 관리, 라우터 설치 등
4. **open_store** — 오픈 작업: 신규 매장 설치, 키오스크/POS 세팅, 오픈 일정, 미설치 잔여 작업 등
5. **van_doc** — 밴서류: 신용카드 가맹 신청/심사/완료, 결제계좌·상호·주소·대표자 변경, 재신고, [Web발신] 알림 등
6. **label** — 라벨지: 라벨지 발주·출고·재고
7. **equip_out** — 장비 출고: 장비 출고·발주·반품 (단말기 외 일반 장비)
8. **delivery** — 택배: 택배 발송·수령·반품
9. **ignore** — 인사, 확인 응답, 잡담, 파일 공유 알림

## A/S 구분 가이드
- POS 본체/키오스크/영수증프린터/POS SW → pos_as
- 카드결제기/VAN/IC 인식/체크기 → van_as
- 이동단말기/무선/핸드스캐너/PDA → device_mgmt

## 규칙
- 헤더 메시지(예: "* 신규") 자체는 ignore, 다음 메시지의 분류 힌트로만 사용
- 같은 매장 + 같은 작업의 후속 보고는 같은 항목으로 묶기
- status: 신규접수|진행중|완료|재방문필요|심사중

## JSON 응답 (다른 텍스트 없이 JSON만, 최대 30개)
{ "summary":"...", "items":[ { "type":"pos_as|van_as|device_mgmt|open_store|van_doc|label|equip_out|delivery|ignore", "status":"...", "sender":"...", "time":"HH:MM", "store":"...","assignee":"...","device":"...","request":"...","parsed":"...","original":"..." } ] }

채팅 내용:
${chatBlob.slice(0, 8000)}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':'application/json',
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 8000, messages: [{ role:'user', content: prompt }] }),
  });
  if (!r.ok) {
    const e = await r.text().catch(()=>'');
    throw new Error(`Claude API ${r.status}: ${e.slice(0,200)}`);
  }
  const data = await r.json();
  const text = data.content?.[0]?.text || '';
  let raw = String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/i,'').trim();
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('no JSON in Claude response');
  const j = raw.slice(start);
  try { return JSON.parse(j); }
  catch(pe) {
    // 잘림 복구
    let depth=0, inStr=false, esc=false, lastObj=-1, arrStart=-1;
    for (let i=0;i<j.length;i++){
      const c=j[i];
      if(esc){esc=false;continue;}
      if(c==='\\'){esc=true;continue;}
      if(c==='"'){inStr=!inStr;continue;}
      if(inStr)continue;
      if(c==='['&&arrStart<0)arrStart=i;
      if(c==='{')depth++;
      else if(c==='}'){depth--; if(depth===1&&arrStart>=0)lastObj=i;}
    }
    if (lastObj<0) return { items:[] };
    return JSON.parse(j.slice(0,lastObj+1)+']}');
  }
}

export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ error:'KV not bound' }, 500);
  const lastRun = Number(await env.STORES_KV.get(LASTRUN_KEY) || '0');
  const queue = (await env.STORES_KV.get(RAW_KEY, 'json')) || { items: [] };
  const pending = (await env.STORES_KV.get(PENDING_KEY, 'json')) || { items: [] };
  return json({
    lastRun: lastRun ? new Date(lastRun).toISOString() : null,
    rawQueueLen: queue.items.length,
    pendingLen: pending.items.length,
    unprocessed: queue.items.filter(m => Number(m.ts||0) > lastRun).length,
  }, 200);
}

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
