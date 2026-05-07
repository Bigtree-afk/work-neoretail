/**
 * POST /api/sync
 *   body: { stores: [...], source?: string }
 * 점포 데이터를 KV에 저장. 외부 cron(이카운트 동기화) + 클라이언트 모두 호출.
 * 인증은 화이트리스트 기반 앱 진입 게이트로 위임 (단순화).
 */
export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);

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
