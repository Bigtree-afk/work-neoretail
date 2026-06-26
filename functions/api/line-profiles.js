/**
 * LINE 프로필 캐시 조회 — 직원 LINE userId 매핑 보조
 *
 *   GET /api/line-profiles  → { profiles: { <userId>: <displayName> }, count }
 *
 * line-webhook 이 메시지 수신 시마다 발신자 userId→displayName 을 line_profile_cache 에
 * 저장한다. 전자결재 양식·루트 탭에서 직원명 ↔ userId 자동 매칭에 사용.
 *
 * 내부 운영 도구(읽기 전용) — /api/jobs GET 과 동일하게 무인증.
 */
export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ profiles: {}, count: 0, error: 'KV not bound' }, 200);
  let profiles = {};
  try {
    const v = await env.STORES_KV.get('line_profile_cache', 'json');
    if (v && typeof v === 'object') profiles = v;
  } catch (_) {}
  return json({ profiles, count: Object.keys(profiles).length }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}
