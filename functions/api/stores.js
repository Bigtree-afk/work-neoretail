/**
 * GET /api/stores
 * KV에 저장된 점포 목록 + 마지막 동기화 메타정보 반환.
 * ⚡ ETag/304 — 변경 없으면 본문(최대 ~1MB) 재전송 회피 (If-None-Match).
 */
export async function onRequestGet({ request, env }) {
  if (!env.STORES_KV) {
    return json({ stores: [], meta: { error: 'KV not bound' } }, 200);
  }
  // cacheTtl:0 — patch / sync 의 최신 write 가 PoP 캐시에 막혀 stale 안 되도록
  const stores = (await env.STORES_KV.get('stores', 'json')) || [];
  const meta = (await env.STORES_KV.get('meta', 'json')) || {};
  // 🪦 deleted_stores 레지스트리 — 클라이언트가 localStorage 정리에 사용
  const deleted = (await env.STORES_KV.get('deleted_stores', 'json')) || [];
  const bodyStr = JSON.stringify({ stores, meta, deleted });
  const etag = '"' + _etagHash(bodyStr) + '"';
  if (request && request.headers.get('If-None-Match') === etag) return notModified(etag);
  return jsonRaw(bodyStr, 200, etag);
}

// djb2-xor + 길이 — 변경감지용 ETag(충돌 무해, 다르면 재전송될 뿐)
function _etagHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}
function jsonRaw(bodyStr, status, etag) {
  return new Response(bodyStr, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag',
      'etag': etag,
    },
  });
}
function notModified(etag) {
  return new Response(null, {
    status: 304,
    headers: {
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag',
      'etag': etag,
    },
  });
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
