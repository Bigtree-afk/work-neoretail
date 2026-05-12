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
const MAX_MSGS_PER_RUN = 80;
const MAX_PENDING = 500;

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
  if (!apiKey) return json({ error:'claudeApiKey not configured' }, 503);

  const lastRun = Number(await env.STORES_KV.get(LASTRUN_KEY) || '0');
  const queue = (await env.STORES_KV.get(RAW_KEY, 'json')) || { items: [] };

  // 마지막 처리 이후 메시지만 (시간 기반 + 최대 80개)
  const fresh = queue.items.filter(m => Number(m.ts||0) > lastRun).slice(0, MAX_MSGS_PER_RUN);
  if (!fresh.length) {
    await env.STORES_KV.put(LASTRUN_KEY, String(Date.now()));
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

  for (const [roomId, msgs] of Object.entries(byRoom)) {
    const roomInfo = (cfg.roomMap||{})[roomId] || { name: roomId, type:'general' };
    const blob = msgs.map(m => {
      const t = new Date(Number(m.ts||0));
      const hh = String(t.getUTCHours()+9).padStart(2,'0').slice(-2);
      const mi = String(t.getUTCMinutes()).padStart(2,'0');
      return `[${hh}:${mi}] ${m.sender||'?'}: ${m.text||''}`;
    }).join('\n');

    try {
      const parsed = await parseWithClaude(apiKey, blob, roomInfo);
      const items = parsed.items || [];

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
    } catch(e) {
      errors.push({ room: roomId, error: e.message });
      // 실패한 채팅방 메시지들도 로그에 'error' 로 기록
      for (const m of msgs) {
        const t = new Date(Number(m.ts||0));
        const kstHH = String(t.getUTCHours()+9).padStart(2,'0').slice(-2);
        const kstMI = String(t.getUTCMinutes()).padStart(2,'0');
        const msgKstDate = new Date(t.getTime()+9*3600*1000).toISOString().slice(0,10);
        allLogs.push({
          logEntry: {
            logId:       `log-err-${m.id || m.ts}`,
            msgTs:       m.ts || 0,
            msgAtKst:    `${msgKstDate} ${kstHH}:${kstMI}`,
            room:        roomId,
            roomName:    roomInfo.name || roomId,
            sender:      m.sender || '',
            text:        (m.text||'').slice(0, 300),
            result:      'error',
            reason:      e.message,
            parseRunAt:  runAt,
            parseSource,
          }, matchedItem: null
        });
      }
    }
  }

  // 로그 적재
  try {
    await appendParseLog(env, allLogs.map(x => x.logEntry));
  } catch(e) {
    console.warn('log append failed', e.message);
  }

  if (totalAdded > 0) await env.STORES_KV.put(PENDING_KEY, JSON.stringify(pendingCur));
  await env.STORES_KV.put(LASTRUN_KEY, String(Date.now()));

  return json({
    ok: true,
    processed: fresh.length,
    rooms: Object.keys(byRoom).length,
    pendingAdded: totalAdded,
    errors,
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
  const prompt = `당신은 POS/VAN 설치·AS 관리 회사의 운영 어시스턴트입니다.
아래는 '${roomInfo.name}' (${roomInfo.type||'일반'}) Line 그룹 채팅 내용입니다.

각 메시지를 분석해서 업무적으로 의미 있는 항목을 추출하고 4개 카테고리로 분류해 주세요.

## 카테고리
1. **as_pos_van** — A/S 관리: POS/VAN 단말기 고장, 키오스크 이슈, 카드단말/프린터 오류 등
2. **open_store** — 오픈 작업: 신규 매장 설치, 키오스크/POS 세팅, 오픈 일정, 미설치 잔여 작업 등
3. **van_doc** — 밴서류: 신용카드 가맹 신청/심사/완료, 결제계좌·상호·주소·대표자 변경, 재신고, [Web발신] 알림 등
4. **device_mgmt** — 단말기 관리: 이동단말기(휴대용) AS·수리완료·대체품·신규개통·SN 관리, 라우터 설치 등
5. **ignore** — 인사, 확인 응답, 잡담, 파일 공유 알림

## 규칙
- 헤더 메시지(예: "* 신규") 자체는 ignore, 다음 메시지의 분류 힌트로만 사용
- 같은 매장 + 같은 작업의 후속 보고는 같은 항목으로 묶기
- status: 신규접수|진행중|완료|재방문필요|심사중

## JSON 응답 (다른 텍스트 없이 JSON만, 최대 30개)
{ "summary":"...", "items":[ { "type":"...", "status":"...", "sender":"...", "time":"HH:MM", "store":"...","assignee":"...","device":"...","request":"...","parsed":"...","original":"..." } ] }

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
