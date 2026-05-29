/**
 * 사이트 개선안 게시판 — 모두 함께 공유 / 논의 (파일·이미지 첨부 지원)
 *
 *   GET    /api/improvements                       → { items: [...] }
 *   GET    /api/improvements?id=<id>&file=<key>     → 첨부 파일 바이너리 (inline)
 *   POST   /api/improvements                        → 신규 개선안 / 의견
 *       • application/json : { author, category, content }                (텍스트만)
 *                            { action:'comment', id, author, text }
 *       • multipart/form-data : 위 필드 + files[]                          (첨부 포함)
 *   PUT    /api/improvements?id=<id>                 → 본문/구분/상태 수정
 *   DELETE /api/improvements?id=<id>                 → 삭제 (첨부 포함)
 *
 * KV 저장 (STORES_KV):
 *   improvements → { items: [
 *     { id, author, category, content, status, createdAt, editedAt,
 *       files:[{name,type,size,key,isImage,url}],
 *       comments:[{ id, author, text, at, files:[...] }] }
 *   ] }
 *   imp:<id>:f<n>          → 개선안 첨부 바이너리
 *   imp:<id>:c<cid>:f<n>   → 의견 첨부 바이너리
 */

const KEY = 'improvements';
const MAX_ITEMS = 1000;
const MAX_FILE_BYTES = 24_000_000;
const MAX_TOTAL_BYTES = 50_000_000;

function newId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

async function loadItems(env) {
  const data = (await env.STORES_KV.get(KEY, 'json')) || { items: [] };
  if (!Array.isArray(data.items)) data.items = [];
  return data;
}

function fileUrl(id, key) {
  return `/api/improvements?id=${encodeURIComponent(id)}&file=${encodeURIComponent(key)}`;
}

// form 의 files[] 를 KV 에 저장하고 메타 배열 반환
async function storeFiles(env, form, prefix, id) {
  const raw = form.getAll('files') || [];
  const metas = [];
  let total = 0, n = 0;
  for (const f of raw) {
    if (!f || typeof f.arrayBuffer !== 'function') continue;
    const buf = await f.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_FILE_BYTES) continue;
    if (total + buf.byteLength > MAX_TOTAL_BYTES) continue;
    total += buf.byteLength;
    const key = `${prefix}:f${n}`;
    await env.STORES_KV.put(key, buf);
    const type = String(f.type || 'application/octet-stream').slice(0, 100);
    metas.push({
      name: String(f.name || ('file_' + n)).slice(0, 200),
      type, size: buf.byteLength, key,
      isImage: type.startsWith('image/'),
      url: fileUrl(id, key),
    });
    n++;
  }
  return metas;
}

export async function onRequestGet({ env, request }) {
  if (!env.STORES_KV) return json({ items: [], error: 'KV not bound' }, 200);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const fileKey = url.searchParams.get('file');

  // 첨부 파일 서빙
  if (id && fileKey) {
    if (!fileKey.startsWith('imp:')) return text('forbidden', 403);
    const data = await loadItems(env);
    const item = data.items.find(x => x.id === id);
    if (!item) return text('not found', 404);
    let meta = (item.files || []).find(f => f.key === fileKey);
    if (!meta) {
      for (const c of (item.comments || [])) {
        meta = (c.files || []).find(f => f.key === fileKey);
        if (meta) break;
      }
    }
    if (!meta) return text('file not found', 404);
    const bin = await env.STORES_KV.get(fileKey, 'arrayBuffer');
    if (!bin) return text('file data missing', 404);
    return new Response(bin, { status: 200, headers: {
      'content-type': meta.type || 'application/octet-stream',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name || 'file')}`,
      'cache-control': 'private, max-age=300',
    }});
  }

  const data = await loadItems(env);
  return json({ items: data.items }, 200);
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const ct = request.headers.get('content-type') || '';

  // ───────── multipart (첨부 포함) ─────────
  if (ct.includes('multipart/form-data')) {
    let form;
    try { form = await request.formData(); } catch(e) { return text('invalid form-data: ' + e.message, 400); }
    const action   = String(form.get('action') || '').trim();
    const author   = String(form.get('author') || '').trim().slice(0, 80) || '익명';

    if (action === 'comment') {
      const id  = String(form.get('id') || '').trim();
      const txt = String(form.get('text') || '').trim().slice(0, 4000);
      if (!id) return text('id 가 필요합니다', 400);
      const data = await loadItems(env);
      const item = data.items.find(x => x.id === id);
      if (!item) return json({ error: 'not found' }, 404);
      if (!Array.isArray(item.comments)) item.comments = [];
      const cid = newId();
      const files = await storeFiles(env, form, `imp:${id}:c${cid}`, id);
      if (!txt && !files.length) return text('의견 또는 첨부가 필요합니다', 400);
      const comment = { id: cid, author, text: txt, at: new Date().toISOString(), files };
      item.comments.push(comment);
      await env.STORES_KV.put(KEY, JSON.stringify(data));
      return json({ ok: true, id, comment }, 200);
    }

    const category = String(form.get('category') || '').trim().slice(0, 60);
    const content  = String(form.get('content')  || '').trim().slice(0, 8000);
    const id = newId();
    const files = await storeFiles(env, form, `imp:${id}`, id);
    if (!content && !files.length) return text('개선할 내용 또는 첨부가 필요합니다', 400);
    const now = new Date().toISOString();
    const item = { id, author, category, content, status: '논의중', createdAt: now, editedAt: now, files, comments: [] };
    const data = await loadItems(env);
    data.items.unshift(item);
    if (data.items.length > MAX_ITEMS) data.items = data.items.slice(0, MAX_ITEMS);
    await env.STORES_KV.put(KEY, JSON.stringify(data));
    return json({ ok: true, item }, 200);
  }

  // ───────── JSON (텍스트만) ─────────
  let body;
  try { body = await request.json(); } catch(e) { return text('invalid json: ' + e.message, 400); }

  if (body.action === 'comment') {
    const id     = String(body.id || '').trim();
    const author = String(body.author || '').trim().slice(0, 80) || '익명';
    const txt    = String(body.text || '').trim().slice(0, 4000);
    if (!id || !txt) return text('id 와 text 가 필요합니다', 400);
    const data = await loadItems(env);
    const item = data.items.find(x => x.id === id);
    if (!item) return json({ error: 'not found' }, 404);
    if (!Array.isArray(item.comments)) item.comments = [];
    const comment = { id: newId(), author, text: txt, at: new Date().toISOString(), files: [] };
    item.comments.push(comment);
    await env.STORES_KV.put(KEY, JSON.stringify(data));
    return json({ ok: true, id, comment }, 200);
  }

  const author   = String(body.author   || '').trim().slice(0, 80) || '익명';
  const category = String(body.category || '').trim().slice(0, 60);
  const content  = String(body.content  || '').trim().slice(0, 8000);
  if (!content) return text('개선할 내용(content)이 필요합니다', 400);
  const now = new Date().toISOString();
  const item = { id: newId(), author, category, content, status: '논의중', createdAt: now, editedAt: now, files: [], comments: [] };
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
  const item = data.items.find(x => x.id === id);
  // 첨부 바이너리 삭제
  if (item) {
    const keys = [];
    for (const f of (item.files || [])) if (f.key) keys.push(f.key);
    for (const c of (item.comments || [])) for (const f of (c.files || [])) if (f.key) keys.push(f.key);
    for (const k of keys) { try { await env.STORES_KV.delete(k); } catch(e){} }
  }
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
