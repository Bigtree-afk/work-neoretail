/**
 * POST /api/sync
 *   body: { stores: [...], source?: string }
 *
 * 점포 데이터 동기화 — **MERGE 방식** (전체 교체 X)
 *   - 기존 KV 매장의 패치된 필드(storeRegDate, ecountRegDate)는 보존
 *   - 클라이언트가 storeRegDate 를 명시적으로 보내면 그 값으로 갱신
 *   - 신규 매장은 추가, 기존 매장은 필드별 머지
 *   - KV 에만 있는 매장도 보존 (클라이언트 삭제는 별도 API)
 */

// 클라이언트 push 가 명시적으로 안 보내면 KV 측 값을 보존하는 필드들
// (서버측 패치/관리 데이터 — 브라우저 localStorage 에는 없을 수 있음)
const SERVER_PRESERVED_FIELDS = [
  'storeRegDate',
  'ecountRegDate',
  'equipment',         // store.equipment[] — 인스턴스 단위 장비 DB (Plan B). 구버전 클라이언트가 누락 push 해도 보존
];

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);

  let body;
  try { body = await request.json(); }
  catch { return text('invalid json', 400); }

  const incoming = Array.isArray(body?.stores) ? body.stores : [];
  if (incoming.length > 50000) return text('too many stores', 413);

  // 기존 KV 데이터 로드
  const cur = (await env.STORES_KV.get('stores', 'json')) || { stores: [] };
  const existingArr = Array.isArray(cur.stores) ? cur.stores : (Array.isArray(cur) ? cur : []);

  // id / biz / code 기준 인덱스
  const byId = new Map();
  const byBiz = new Map();
  const byCode = new Map();
  const normBiz = (b) => String(b||'').replace(/\D/g, '');
  for (const s of existingArr) {
    if (s.id) byId.set(s.id, s);
    const nb = normBiz(s.biz || s.bizno);
    if (nb && nb.length === 10) byBiz.set(nb, s);
    if (s.code) byCode.set(s.code, s);
  }

  // 머지: 각 incoming 매장에 대해 기존 KV 매장 찾기
  let preservedCount = 0;
  const merged = incoming.map(inc => {
    const old = byId.get(inc.id)
              || byBiz.get(normBiz(inc.biz || inc.bizno))
              || byCode.get(inc.code);
    if (!old) return inc;   // 신규 매장은 그대로
    // 서버 보존 필드: incoming 에 없거나 빈 배열이면 KV 값 유지
    const result = { ...inc };
    for (const field of SERVER_PRESERVED_FIELDS) {
      const v = result[field];
      const incomingIsEmpty = (v == null || v === '' || (Array.isArray(v) && v.length === 0));
      const oldHas = old[field] && (!Array.isArray(old[field]) || old[field].length > 0);
      if (incomingIsEmpty && oldHas) {
        result[field] = old[field];
        preservedCount++;
      }
    }
    return result;
  });

  // KV 에만 있는 매장 보존 (클라이언트가 못 받아온 것일 수 있음 — 실수 삭제 방지)
  const incomingKeys = new Set();
  for (const s of incoming) {
    if (s.id) incomingKeys.add('id:' + s.id);
    const nb = normBiz(s.biz || s.bizno);
    if (nb && nb.length === 10) incomingKeys.add('biz:' + nb);
    if (s.code) incomingKeys.add('code:' + s.code);
  }
  let onlyInExisting = 0;
  for (const old of existingArr) {
    const keys = [];
    if (old.id) keys.push('id:' + old.id);
    const nb = normBiz(old.biz || old.bizno);
    if (nb && nb.length === 10) keys.push('biz:' + nb);
    if (old.code) keys.push('code:' + old.code);
    if (!keys.some(k => incomingKeys.has(k))) {
      merged.push(old);
      onlyInExisting++;
    }
  }

  // KV 저장
  if (Array.isArray(cur)) {
    await env.STORES_KV.put('stores', JSON.stringify(merged));
  } else {
    cur.stores = merged;
    cur.meta = cur.meta || {};
    cur.meta.syncedAt = new Date().toISOString();
    cur.meta.count = merged.length;
    cur.meta.source = String(body.source || 'manual');
    cur.meta.preservedCount = preservedCount;
    await env.STORES_KV.put('stores', JSON.stringify(cur));
  }
  await env.STORES_KV.put(
    'meta',
    JSON.stringify({
      syncedAt: new Date().toISOString(),
      count: merged.length,
      source: String(body.source || 'manual'),
      preservedFields: preservedCount,
      onlyInExisting,
    }),
  );

  return new Response(
    JSON.stringify({ ok: true, count: merged.length, preserved: preservedCount, onlyInExisting }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

function text(msg, status) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain' } });
}
