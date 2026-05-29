/**
 * 사이트 개선안 게시판 — 모두 함께 공유 / 논의
 *
 *   GET    /api/improvements                 → { items: [...] }
 *   POST   /api/improvements                 → 신규 개선안 추가
 *       Body(JSON): { author, category, content }
 *   POST   /api/improvements                 → 개선의견(논의) 추가
 *       Body(JSON): { action:'comment', id, author, text }
 *   PUT    /api/improvements?id=<id>          → 본문/구분/상태 수정
 *       Body(JSON): { author?, category?, content?, status? }
 *   DELETE /api/improvements?id=<id>          → 삭제
 *
 * KV 저장 (STORES_KV):
 *   improvements → {
 *     items: [
 *       { id, author, category, content, status,
 *         createdAt, editedAt, comments: [ { id, author, text, at } ] }
 *     ]
 *   }
 *
 * 동시 쓰기 안전: 각 write 직전 KV 를 다시 읽어 내 변경만 적용 후 저장(append-merge).
 */

const KEY = 'improvements';
const MAX_ITEMS = 1000;

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

async function loadItems(env) {
  const data = (await env.STORES_KV.get(KEY, 'json')) || { items: [] };
  if (!Array.isArray(data.items)) data.items = [];
  return data;
}

export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ items: [], error: 'KV not bound' }, 200);
  const data = await loadItems(env);
  return json({ items: data.items }, 200);
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  let body;
  try { body = await request.json(); } catch(e) { return text('invalid json: ' + e.message, 400); }

  // ── 논의(개선의견) 추가 ──
  if (body.action === 'comment') {
    const id     = String(body.id || '').trim();
    const author = String(body.author || '').trim().slice(0, 80) || '익명';
    const txt    = String(body.text || '').trim().slice(0, 4000);
    if (!id || !txt) return text('id 와 text 가 필요합니다', 400);

    const data = await loadItems(env);
    const item = data.items.find(x => x.id === id);
    if (!item) return json({ error: 'not found' }, 404);
    if (!Array.isArray(item.comments)) item.comments = [];
    const comment = { id: newId(), author, text: txt, at: new Date().toISOString() };
    item.comments.push(comment);
    await env.STORES_KV.put(KEY, JSON.stringify(data));
    return json({ ok: true, id, comment }, 200);
  }

  // ── 신규 개선안 ──
  const author   = String(body.author   || '').trim().slice(0, 80) || '익명';
  const category = String(body.category || '').trim().slice(0, 60);
  const content  = String(body.content  || '').trim().slice(0, 8000);
  if (!content) return text('개선할 내용(content)이 필요합니다', 400);

  const now = new Date().toISOString();
  const item = {
    id: newId(),
    author, category, content,
    status: '논의중',
    createdAt: now,
    editedAt: now,
    comments: [],
  };

  const data = await loadItems(env);
  data.items.unshift(item);
  if (data.items.length > MAX_ITEMS) data.items = data.items.slice(0, MAX_ITEMS);
  await env.STORES_KV.put(KEY, JSON.stringify(data));
  return json({ ok: true, item }, 200);
}

export async function onRequestPut({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return text('id required', 400);
  let body;
  try { body = await request.json(); } catch(e) { return text('invalid json', 400); }

  const data = await loadItems(env);
  const item = data.items.find(x => x.id === id);
  if (!item) return json({ error: 'not found' }, 404);

  if (body.category !== undefined) item.category = String(body.category || '').slice(0, 60);
  if (body.content  !== undefined) item.content  = String(body.content  || '').slice(0, 8000);
  if (body.status   !== undefined) item.status   = String(body.status   || '').slice(0, 30);
  item.editedAt = new Date().toISOString();
  if (body.author) item.editedBy = String(body.author).slice(0, 80);
  await env.STORES_KV.put(KEY, JSON.stringify(data));
  return json({ ok: true, item }, 200);
}

export async function onRequestDelete({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return text('id required', 400);

  const data = await loadItems(env);
  const before = data.items.length;
  data.items = data.items.filter(x => x.id !== id);
  if (data.items.length !== before) await env.STORES_KV.put(KEY, JSON.stringify(data));
  return json({ ok: true }, 200);
}

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  }});
}
function text(m, s) { return new Response(m, { status: s, headers: { 'content-type': 'text/plain; charset=utf-8' }}); }
