/**
 * 공지사항 게시판 — 누구나 작성, 파일/이미지/동영상 첨부 가능
 *
 *   GET    /api/notices                       → 인덱스 (목록)
 *   GET    /api/notices?id=<id>                → 단일 게시물 (본문 + 첨부 메타)
 *   GET    /api/notices?id=<id>&fileIdx=<n>    → 첨부 파일 바이너리 (inline 서빙)
 *   POST   /api/notices                        → multipart/form-data 작성
 *      필드: title, body, author, files[]
 *   PUT    /api/notices?id=<id>                → 본문/제목 수정 (첨부는 별도)
 *      Body(JSON): { title?, body?, editor? }
 *   DELETE /api/notices?id=<id>                → 삭제 (첨부 파일 포함)
 *
 * KV 저장:
 *   notices_index            → { items: [{ id, title, author, createdAt, fileCount, hasImage, hasVideo }] }
 *   notice:<id>              → 전체 메타데이터 { id, title, body, author, files:[...] }
 *   notice:<id>:f<n>         → 파일 바이너리 (raw bytes)
 *
 * 한도: 파일당 24MB, 게시물당 합계 50MB. 게시물 최대 500개 (오래된 것 자동 정리).
 */

const MAX_FILE_BYTES  = 24_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
const INDEX_MAX       = 500;
const IDX_KEY         = 'notices_index';

const IMAGE_TYPES = ['image/jpeg','image/png','image/gif','image/webp','image/heic','image/avif','image/bmp'];
const VIDEO_TYPES = ['video/mp4','video/webm','video/ogg','video/quicktime','video/x-matroska'];
function isImageType(t){ return t && t.startsWith('image/'); }
function isVideoType(t){ return t && t.startsWith('video/'); }

export async function onRequestGet({ env, request }) {
  if (!env.STORES_KV) return json({ error:'KV not bound' }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    const idx = (await env.STORES_KV.get(IDX_KEY, 'json')) || { items: [] };
    return json({ items: idx.items || [] }, 200);
  }

  const data = await env.STORES_KV.get('notice:' + id, 'json');
  if (!data) return json({ error:'not found' }, 404);

  const fileIdx = url.searchParams.get('fileIdx');
  if (fileIdx != null) {
    const i = Number(fileIdx);
    const f = data.files && data.files[i];
    if (!f || !f.key) return text('file not found', 404);
    const bin = await env.STORES_KV.get(f.key, 'arrayBuffer');
    if (!bin) return text('file data missing', 404);
    return new Response(bin, {
      status: 200,
      headers: {
        'content-type': f.type || 'application/octet-stream',
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name || 'file')}`,
        'cache-control': 'private, max-age=300',
      },
    });
  }

  // 메타데이터 + 첨부 메타 (바이너리는 별도 요청)
  const meta = {
    ...data,
    files: (data.files || []).map((f, i) => ({
      idx:  i,
      name: f.name,
      type: f.type,
      size: f.size,
      isImage: isImageType(f.type),
      isVideo: isVideoType(f.type),
      url:  `/api/notices?id=${encodeURIComponent(id)}&fileIdx=${i}`,
    })),
  };
  return json(meta, 200);
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);

  let form;
  try { form = await request.formData(); }
  catch(e) { return text('invalid form-data: ' + e.message, 400); }

  const title  = String(form.get('title')  || '').trim();
  const body   = String(form.get('body')   || '').trim();
  const author = String(form.get('author') || '').trim();
  if (!title)  return text('제목(title)이 필요합니다', 400);
  if (!body && (!form.getAll('files').length)) return text('본문 또는 첨부가 필요합니다', 400);

  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  const rawFiles = form.getAll('files') || [];
  const fileMetas = [];
  let totalBytes = 0;
  let skipped = 0;
  let hasImage = false;
  let hasVideo = false;
  let n = 0;

  for (const f of rawFiles) {
    if (!f || typeof f.arrayBuffer !== 'function') { skipped++; continue; }
    const buf = await f.arrayBuffer();
    if (!buf.byteLength) { skipped++; continue; }
    if (buf.byteLength > MAX_FILE_BYTES) { skipped++; continue; }
    if (totalBytes + buf.byteLength > MAX_TOTAL_BYTES) { skipped++; continue; }
    totalBytes += buf.byteLength;

    const fileKey = `notice:${id}:f${n}`;
    await env.STORES_KV.put(fileKey, buf);

    const ftype = String(f.type || 'application/octet-stream').slice(0, 100);
    if (isImageType(ftype)) hasImage = true;
    if (isVideoType(ftype)) hasVideo = true;

    fileMetas.push({
      name: String(f.name || `file_${n}`).slice(0, 200),
      type: ftype,
      size: buf.byteLength,
      key:  fileKey,
    });
    n++;
  }

  const submission = {
    id,
    title:  title.slice(0, 200),
    body:   body.slice(0, 20000),
    author: author.slice(0, 80),
    files:  fileMetas,
    createdAt: new Date().toISOString(),
  };

  await env.STORES_KV.put('notice:' + id, JSON.stringify(submission));

  // 인덱스 갱신
  const idx = (await env.STORES_KV.get(IDX_KEY, 'json')) || { items: [] };
  idx.items.unshift({
    id,
    title: submission.title,
    author: submission.author,
    createdAt: submission.createdAt,
    fileCount: fileMetas.length,
    hasImage,
    hasVideo,
    excerpt: (submission.body || '').slice(0, 120),
  });
  if (idx.items.length > INDEX_MAX) idx.items = idx.items.slice(0, INDEX_MAX);
  await env.STORES_KV.put(IDX_KEY, JSON.stringify(idx));

  return json({ ok:true, id, fileCount: fileMetas.length, skipped, totalBytes }, 200);
}

export async function onRequestPut({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return text('id required', 400);

  let body;
  try { body = await request.json(); } catch(e) { return text('invalid json', 400); }

  const data = await env.STORES_KV.get('notice:' + id, 'json');
  if (!data) return json({ error:'not found' }, 404);

  if (body.title !== undefined) data.title = String(body.title || '').slice(0, 200);
  if (body.body !== undefined)  data.body  = String(body.body  || '').slice(0, 20000);
  data.editedAt = new Date().toISOString();
  data.editor   = String(body.editor || '').slice(0, 80);
  await env.STORES_KV.put('notice:' + id, JSON.stringify(data));

  // 인덱스 동기화
  const idx = (await env.STORES_KV.get(IDX_KEY, 'json')) || { items: [] };
  const row = (idx.items || []).find(x => x.id === id);
  if (row) {
    if (body.title !== undefined) row.title = data.title;
    if (body.body !== undefined)  row.excerpt = (data.body || '').slice(0, 120);
    row.editedAt = data.editedAt;
    await env.STORES_KV.put(IDX_KEY, JSON.stringify(idx));
  }

  return json({ ok:true, id }, 200);
}

export async function onRequestDelete({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return text('id required', 400);

  const data = await env.STORES_KV.get('notice:' + id, 'json');
  if (data && Array.isArray(data.files)) {
    for (const f of data.files) {
      if (f.key) { try { await env.STORES_KV.delete(f.key); } catch(e){} }
    }
  }
  try { await env.STORES_KV.delete('notice:' + id); } catch(e){}

  const idx = (await env.STORES_KV.get(IDX_KEY, 'json')) || { items: [] };
  idx.items = (idx.items || []).filter(x => x.id !== id);
  await env.STORES_KV.put(IDX_KEY, JSON.stringify(idx));

  return json({ ok:true }, 200);
}

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  }});
}
function text(m, s) { return new Response(m, { status: s, headers: { 'content-type': 'text/plain; charset=utf-8' }}); }
