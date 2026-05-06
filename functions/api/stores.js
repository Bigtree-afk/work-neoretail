/**
 * GET /api/stores
 * KV에 저장된 점포 목록 + 마지막 동기화 메타정보 반환.
 */
export async function onRequestGet({ env }) {
  if (!env.STORES_KV) {
    return json({ stores: [], meta: { error: 'KV not bound' } }, 200);
  }
  const stores = (await env.STORES_KV.get('stores', 'json')) || [];
  const meta = (await env.STORES_KV.get('meta', 'json')) || {};
  return json({ stores, meta }, 200);
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
