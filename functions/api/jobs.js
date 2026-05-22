/**
 * 작업(신규/AS/POS교체 등) — 클라우드 동기화
 *
 *   GET  /api/jobs            → 누구나 조회 가능
 *   POST /api/jobs            → Authorization: Bearer <SYNC_SECRET>
 *      body: { jobs: [...] }
 *
 * 저장 위치: STORES_KV 의 키 "jobs"
 *   { jobs: [...], updatedAt: ISO8601 }
 */
export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ jobs: [], error: 'KV not bound' }, 200);
  const data = (await env.STORES_KV.get('jobs', 'json')) || { jobs: [] };
  // 🪦 deleted_jobs 레지스트리 포함 — 클라이언트가 자기 localStorage 정리에 사용
  //    형식: [{ id, deletedAt, reason }]
  const deleted = (await env.STORES_KV.get('deleted_jobs', 'json')) || [];
  // 🔁 resync_token — 데이터 대규모 변경 시 모든 클라이언트 force-resync 트리거
  const resyncToken = (await env.STORES_KV.get('resync_token')) || '';
  const out = (data && typeof data === 'object' && !Array.isArray(data))
    ? { ...data, deleted, resyncToken }
    : { jobs: Array.isArray(data) ? data : [], deleted, resyncToken };
  return json(out, 200);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STORES_KV) return json({ error: 'KV not bound', envKeys: Object.keys(env) }, 500);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'invalid_json', detail: String(e) }, 400); }

    const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
    if (jobs.length > 10000) return json({ error: 'too_many', count: jobs.length }, 413);

    // 🪦 deleted_jobs 레지스트리로 부활 차단 — stale 클라이언트 wholesale POST 가
    //    삭제된 job 을 다시 cloud 에 등록시키는 문제 방지 (샤르르 부활 루프, 2026-05-22)
    let deletedIds = new Set();
    try {
      const reg = (await env.STORES_KV.get('deleted_jobs', 'json')) || [];
      if (Array.isArray(reg)) {
        for (const e of reg) {
          if (e && e.id) deletedIds.add(String(e.id));
        }
      }
    } catch (_) {}

    const cleaned = jobs.filter(j => {
      if (!j || typeof j !== 'object' || !j.id) return false;
      if (deletedIds.has(String(j.id))) return false;  // 부활 차단
      return true;
    });
    const rejected = jobs.length - cleaned.length;
    const serialized = JSON.stringify({ jobs: cleaned, updatedAt: new Date().toISOString() });
    if (serialized.length > 25_000_000) return json({ error: 'payload too large', size: serialized.length }, 413);

    try {
      await env.STORES_KV.put('jobs', serialized);
    } catch (e) {
      return json({ error: 'kv_put_failed', detail: String(e), stack: e?.stack || '', size: serialized.length }, 500);
    }
    return json({ ok: true, count: cleaned.length, rejectedDeleted: rejected }, 200);
  } catch (e) {
    return json({ error: 'handler_exception', detail: String(e), stack: e?.stack || '' }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
function text(msg, status) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain' } });
}
