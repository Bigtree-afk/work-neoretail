/**
 * GET /api/stores
 * KV에 저장된 점포 목록 + 마지막 동기화 메타정보 반환.
 */
export async function onRequestGet({ env }) {
  if (!env.STORES_KV) {
    return json({ stores: [], meta: { error: 'KV not bound' } }, 200);
  }
  // cacheTtl:0 — patch / sync 의 최신 write 가 PoP 캐시에 막혀 stale 안 되도록
  const stores = (await env.STORES_KV.get('stores', 'json')) || [];
  const meta = (await env.STORES_KV.get('meta', 'json')) || {};
  // 🪦 deleted_stores 레지스트리 — 클라이언트가 localStorage 정리에 사용
  const deleted = (await env.STORES_KV.get('deleted_stores', 'json')) || [];
  return json({ stores, meta, deleted }, 200);
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
