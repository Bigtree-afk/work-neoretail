/**
 * POST /api/sync
 *   Authorization: Bearer <SYNC_SECRET>
 *   body: { stores: [...], source?: string }
 * 로컬 동기화 스크립트가 호출. KV에 점포 + 메타 저장.
 */
export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  if (!env.SYNC_SECRET) return text('SYNC_SECRET not set', 500);

  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${env.SYNC_SECRET}`) return text('unauthorized', 401);

  let body;
  try { body = await request.json(); }
  catch { return text('invalid json', 400); }

  const stores = Array.isArray(body?.stores) ? body.stores : [];
  // 안전 한도 (악의적 페이로드 방지)
  if (stores.length > 50000) return text('too many stores', 413);

  await env.STORES_KV.put('stores', JSON.stringify(stores));
  await env.STORES_KV.put(
    'meta',
    JSON.stringify({
      syncedAt: new Date().toISOString(),
      count: stores.length,
      source: String(body.source || 'manual'),
    }),
  );

  return new Response(
    JSON.stringify({ ok: true, count: stores.length }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

function text(msg, status) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain' } });
}
