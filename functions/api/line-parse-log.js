/**
 * Line 파싱 이력 — 메시지별 결과 추적
 *
 *   GET /api/line-parse-log?date=2026-05-12&result=pending|ignore|all&limit=200
 *
 * 저장 키: line_parse_log:<YYYY-MM-DD>
 *   { items: [
 *       {
 *         logId,           // 고유 id
 *         msgTs,           // 라인 메시지 ts (ms)
 *         msgAtKst,        // KST 표시 (YYYY-MM-DD HH:mm)
 *         room, roomName,  // 채팅방 ID + 매핑된 이름
 *         sender,
 *         text,            // 원문
 *         result,          // 'pending' | 'ignore' | 'error'
 *         category,        // pending 일 때만 — as_pos_van/open_store/van_doc/device_mgmt
 *         pendingId,       // pending 일 때만 — 큐 항목 id
 *         status,          // 파싱 결과 status
 *         store, assignee, // 추출 결과
 *         parseRunAt,      // 파싱 실행 시각
 *         parseSource,     // 'cron' | 'manual'
 *       }
 *     ],
 *     stats: { total, pending, ignore, error }
 *   }
 */

const LOG_PREFIX = 'line_parse_log:';
const LOG_RETENTION_DAYS = 30;   // 30일 보관

export async function onRequestGet({ env, request }) {
  if (!env.STORES_KV) return json({ error:'KV not bound' }, 500);
  const url = new URL(request.url);
  const date  = url.searchParams.get('date') || _todayKst();
  const result= url.searchParams.get('result') || 'all';
  const limit = Number(url.searchParams.get('limit') || 200);

  const data = (await env.STORES_KV.get(LOG_PREFIX + date, 'json')) || { items: [], stats: { total:0, pending:0, ignore:0, error:0 } };

  let items = data.items || [];
  if (result !== 'all') items = items.filter(it => it.result === result);
  items = items.slice(0, limit);

  // 최근 7일치 날짜 목록 (날짜 셀렉터용)
  const datesList = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.now() - i*24*3600*1000);
    const kst = new Date(d.getTime() + 9*3600*1000);
    datesList.push(kst.toISOString().slice(0,10));
  }

  return json({
    date,
    items,
    stats: data.stats || { total:0, pending:0, ignore:0, error:0 },
    datesList,
  }, 200);
}

function _todayKst() {
  const d = new Date();
  const kst = new Date(d.getTime() + 9*3600*1000);
  return kst.toISOString().slice(0,10);
}

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}

/* 파싱 cron 에서 호출 — 로그 항목 추가 (내부 모듈로도 export) */
export async function appendParseLog(env, entries) {
  if (!env.STORES_KV || !entries || !entries.length) return;
  // KST 날짜별로 그룹
  const byDate = {};
  for (const e of entries) {
    const kstDate = e.msgAtKst ? e.msgAtKst.slice(0,10) : _todayKst();
    (byDate[kstDate] ||= []).push(e);
  }
  for (const [date, items] of Object.entries(byDate)) {
    const key = LOG_PREFIX + date;
    const cur = (await env.STORES_KV.get(key, 'json')) || { items: [], stats: { total:0, pending:0, ignore:0, error:0, error_giveup:0, overflow:0 } };
    cur.items = [...items, ...cur.items].slice(0, 1000);
    // 통계 재계산
    const stats = { total:0, pending:0, ignore:0, error:0, error_giveup:0, overflow:0 };
    for (const it of cur.items) {
      stats.total++;
      if (it.result === 'pending') stats.pending++;
      else if (it.result === 'ignore') stats.ignore++;
      else if (it.result === 'error') stats.error++;
      else if (it.result === 'error_giveup') stats.error_giveup++;
      else if (it.result === 'overflow') stats.overflow++;
    }
    cur.stats = stats;
    await env.STORES_KV.put(key, JSON.stringify(cur));
  }
  // 보관 기간 지난 키 정리 (lazy)
  try {
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS*24*3600*1000);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    // KV에 list API 가 있긴 한데 무거우니 1주일 더 오래된 단일 키만 시도 삭제
    const oldKey = LOG_PREFIX + (new Date(Date.now() - (LOG_RETENTION_DAYS+1)*24*3600*1000)).toISOString().slice(0,10);
    await env.STORES_KV.delete(oldKey);
  } catch(e) {}
}
