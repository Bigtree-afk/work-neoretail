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

  // 🪦 deleted_jobs / deleted_stores 레지스트리 누적 — 클라이언트 sync 가 이걸 읽어
  //    자기 localStorage 의 동일 id 를 제거하고 tombstone 등록.
  //    결과: 한 기기에서 삭제하면 모든 기기가 다음 sync 때 자동 정리.
  //
  //    형식: [{ id, deletedAt }]
  //    보존: 최근 90일 (오래된 것은 정리 — KV 크기 폭증 방지)
  //    reason: body.reason 또는 'admin-delete'
  const nowIso = new Date().toISOString();
  const reason = String(body.reason || 'admin-delete');
  const PRUNE_DAYS = 90;
  const pruneMs = PRUNE_DAYS * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(Date.now() - pruneMs).toISOString();
  async function appendTombstones(kvKey, ids) {
    if (!ids.length) return;
    const cur = (await env.STORES_KV.get(kvKey, 'json')) || [];
    const arr = Array.isArray(cur) ? cur : [];
    // 기존 항목 중 90일 이내만 유지
    const pruned = arr.filter(e => e && e.deletedAt && e.deletedAt > cutoffIso);
    const existing = new Set(pruned.map(e => String(e.id || '')));
    for (const id of ids) {
      if (existing.has(String(id))) continue;
      pruned.push({ id: String(id), deletedAt: nowIso, reason });
    }
    await env.STORES_KV.put(kvKey, JSON.stringify(pruned));
  }
  try {
    await appendTombstones('deleted_jobs', jobIds);
    await appendTombstones('deleted_stores', storeIds);
  } catch (e) {
    // 레지스트리 쓰기 실패해도 본 삭제는 이미 끝났으므로 ok=true 유지
    console.warn('[admin-delete] tombstone registry write failed', e);
  }

  return new Response(
    JSON.stringify({ ok: true, storesRemoved, jobsRemoved }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

function text(msg, status) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain' } });
}
