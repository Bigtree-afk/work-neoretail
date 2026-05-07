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
  return json(data, 200);
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  if (!env.SYNC_SECRET) return text('SYNC_SECRET not set', 500);

  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${env.SYNC_SECRET}`) return text('unauthorized', 401);

  let body;
  try { body = await request.json(); }
  catch { return text('invalid json', 400); }

  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  if (jobs.length > 10000) return text('too many jobs', 413);

  // 최소한의 정상화 (필수 필드만)
  const cleaned = jobs.filter(j => j && typeof j === 'object' && j.id);
  // 5MB 상한 안전장치
  const serialized = JSON.stringify({ jobs: cleaned, updatedAt: new Date().toISOString() });
  if (serialized.length > 5_000_000) return text('payload too large', 413);

  await env.STORES_KV.put('jobs', serialized);
  return json({ ok: true, count: cleaned.length }, 200);
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
