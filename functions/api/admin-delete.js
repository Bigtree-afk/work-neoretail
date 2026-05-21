/**
 * POST /api/admin-delete
 *   body: { storeIds?: [...], jobIds?: [...] }
 *   header: Authorization: Bearer <SYNC_SECRET>
 *
 * 지정한 storeIds / jobIds 를 KV 에서 완전 제거.
 * sync.js 가 incoming-only-merge 로 동작하기 때문에 클라이언트 측에서 단순히
 * "그 매장 빼고 보내기" 만으로는 삭제가 안 됨 — 이 endpoint 로 명시적 제거.
 */
export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);

  // 인증
  const auth = request.headers.get('authorization') || '';
  const expect = 'Bearer ' + String(env.SYNC_SECRET || '');
  if (!env.SYNC_SECRET || auth !== expect) {
    return text('unauthorized', 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return text('invalid json', 400); }

  const storeIds = Array.isArray(body?.storeIds) ? body.storeIds.filter(Boolean) : [];
  const jobIds = Array.isArray(body?.jobIds) ? body.jobIds.filter(Boolean) : [];

  let storesRemoved = 0;
  let jobsRemoved = 0;

  // stores
  if (storeIds.length > 0) {
    const cur = (await env.STORES_KV.get('stores', 'json')) || { stores: [] };
    const arr = Array.isArray(cur.stores) ? cur.stores : (Array.isArray(cur) ? cur : []);
    const ids = new Set(storeIds.map(String));
    const filtered = arr.filter(s => !ids.has(String(s.id || '')));
    storesRemoved = arr.length - filtered.length;
    if (Array.isArray(cur)) {
      await env.STORES_KV.put('stores', JSON.stringify(filtered));
    } else {
      cur.stores = filtered;
      cur.meta = cur.meta || {};
      cur.meta.syncedAt = new Date().toISOString();
      cur.meta.count = filtered.length;
      await env.STORES_KV.put('stores', JSON.stringify(cur));
    }
  }

  // jobs
  if (jobIds.length > 0) {
    const cur = (await env.STORES_KV.get('jobs', 'json')) || [];
    const arr = Array.isArray(cur) ? cur : (Array.isArray(cur?.jobs) ? cur.jobs : []);
    const ids = new Set(jobIds.map(String));
    const filtered = arr.filter(j => !ids.has(String(j.id || '')));
    jobsRemoved = arr.length - filtered.length;
    if (Array.isArray(cur)) {
      await env.STORES_KV.put('jobs', JSON.stringify(filtered));
    } else {
      cur.jobs = filtered;
      await env.STORES_KV.put('jobs', JSON.stringify(cur));
    }
  }

  return new Response(
    JSON.stringify({ ok: true, storesRemoved, jobsRemoved }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

function text(msg, status) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain' } });
}
