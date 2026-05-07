/**
 * 장비 품목 카탈로그 — 클라우드 동기화
 *
 *   GET  /api/catalog          → 누구나 조회 가능 (items 배열)
 *   POST /api/catalog          → Authorization: Bearer <SYNC_SECRET>
 *      body: { items: [{id, category, name, variants[], costPrice, salePrice}, ...] }
 *
 * 저장 위치: STORES_KV 의 키 "equipment_catalog"
 *   { items: [...], updatedAt: ISO8601 }
 */
export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ items: [], error: 'KV not bound' }, 200);
  const data = (await env.STORES_KV.get('equipment_catalog', 'json')) || { items: [] };
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

  const raw = Array.isArray(body?.items) ? body.items : [];
  if (raw.length > 1000) return text('too many items', 413);

  const items = raw.map(it => ({
    id:        String(it?.id || '').trim(),
    category:  String(it?.category || '').trim(),
    name:      String(it?.name || '').trim(),
    variants:  Array.isArray(it?.variants)
                 ? it.variants.map(v => String(v||'').trim()).filter(Boolean).slice(0, 20)
                 : [],
    costPrice: Math.max(0, Math.round(Number(it?.costPrice)||0)),
    salePrice: Math.max(0, Math.round(Number(it?.salePrice)||0)),
  })).filter(it => it.id && it.name);

  const payload = {
    items,
    updatedAt: new Date().toISOString(),
  };
  await env.STORES_KV.put('equipment_catalog', JSON.stringify(payload));

  return json({ ok: true, count: items.length }, 200);
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
