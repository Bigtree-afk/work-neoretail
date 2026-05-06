/**
 * 직원 이메일 화이트리스트 — 클라우드 동기화
 *
 *   GET  /api/whitelist         → 누구나 조회 가능 (이메일 목록 + 표시용 이름·직책·전화)
 *   POST /api/whitelist         → Authorization: Bearer <SYNC_SECRET>
 *      body: { emails: string[], users?: [{email, name, title, phone}], updatedAt? }
 *
 * 저장 위치: STORES_KV 의 키 "whitelist"
 *   { emails: [...], users: [...], updatedAt: ISO8601 }
 */
export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ emails: [], users: [], error: 'KV not bound' }, 200);
  const data = (await env.STORES_KV.get('whitelist', 'json')) || { emails: [], users: [] };
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

  const emails = Array.isArray(body?.emails)
    ? Array.from(new Set(body.emails.map(s => String(s || '').trim().toLowerCase()).filter(Boolean)))
    : [];
  if (emails.length > 5000) return text('too many emails', 413);

  const users = Array.isArray(body?.users) ? body.users.slice(0, 5000).map(u => ({
    email: String(u?.email || '').trim().toLowerCase(),
    name:  String(u?.name  || '').trim(),
    title: String(u?.title || '').trim(),
    phone: String(u?.phone || '').trim(),
    role:  String(u?.role  || 'staff').trim(),
  })).filter(u => u.email) : [];

  // Google Client ID 도 함께 저장 (공개 정보 — 클라이언트 식별자)
  const googleClientId = String(body?.googleClientId || '').trim();

  const payload = {
    emails,
    users,
    googleClientId,
    updatedAt: new Date().toISOString(),
  };
  await env.STORES_KV.put('whitelist', JSON.stringify(payload));

  return json({ ok: true, count: emails.length, users: users.length, googleClientId: !!googleClientId }, 200);
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
