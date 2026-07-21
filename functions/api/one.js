/**
 * ONE — 개인 노트 앱 저장 API (KV: STORES_KV)
 *
 *   GET  /api/one              → { tree, updatedAt }           (필기장/섹션/페이지 구조 + 페이지 메타)
 *   GET  /api/one?page=<id>    → { page }                      (페이지 본문 HTML + 첨부)
 *   POST /api/one { tree }     → 구조 저장
 *   POST /api/one { page }     → 페이지 본문 저장 (one_page_<id>)
 *   POST /api/one { deletePage:<id> } → 페이지 본문 삭제
 *
 * ⚠ 이 API 는 서버측 인증이 없다(사이트 전체가 Cloudflare Access 미적용 상태와 동일).
 *   진짜 사적 보호는 /one/* 에 Cloudflare Access 정책(zoolex@gmail.com 허용) 적용 필요.
 *   클라이언트는 ns_auth 로 zoolex 전용 게이트를 건다(UI 노출 차단).
 */
const TREE_KEY = 'one_tree';
const pageKey = (id) => 'one_page_' + String(id).replace(/[^a-zA-Z0-9_-]/g, '');

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, if-none-match',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-expose-headers': 'ETag',
      ...extra,
    },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return json({}, 204);
  if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const pageId = url.searchParams.get('page');
    if (pageId) {
      const raw = await env.STORES_KV.get(pageKey(pageId));
      return json({ page: raw ? JSON.parse(raw) : null });
    }
    const raw = await env.STORES_KV.get(TREE_KEY);
    const data = raw ? JSON.parse(raw) : { tree: null, updatedAt: 0 };
    const etag = '"' + (data.updatedAt || '0') + '"';
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag' } });
    }
    return json(data, 200, { etag });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'bad json' }, 400); }

    if (body.tree) {
      const doc = { tree: body.tree, updatedAt: Date.now() };
      const s = JSON.stringify(doc);
      if (s.length > 10_000_000) return json({ error: 'tree too large', size: s.length }, 413);
      try { await env.STORES_KV.put(TREE_KEY, s); }
      catch (e) { return json({ error: 'kv_put_failed', detail: String(e) }, 500); }
      return json({ ok: true, updatedAt: doc.updatedAt });
    }

    if (body.page && body.page.id) {
      const p = Object.assign({}, body.page, { updatedAt: Date.now() });
      const s = JSON.stringify(p);
      if (s.length > 20_000_000) return json({ error: 'page too large', size: s.length }, 413);
      try { await env.STORES_KV.put(pageKey(p.id), s); }
      catch (e) { return json({ error: 'kv_put_failed', detail: String(e) }, 500); }
      return json({ ok: true, updatedAt: p.updatedAt });
    }

    if (body.deletePage) {
      try { await env.STORES_KV.delete(pageKey(body.deletePage)); } catch (_) {}
      return json({ ok: true });
    }

    return json({ error: 'nothing to save' }, 400);
  }

  return json({ error: 'method not allowed' }, 405);
}
