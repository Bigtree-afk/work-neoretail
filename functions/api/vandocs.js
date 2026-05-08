/**
 * VAN 서류 업로드 — 공개 엔드포인트 (인증 없음)
 *
 *   GET  /api/vandocs                → 인덱스(목록) 반환
 *   GET  /api/vandocs?id=<id>        → 특정 제출 상세(파일 base64 포함)
 *   GET  /api/vandocs?id=<id>&fileIdx=<n>&download=1
 *                                     → 단일 파일 바이너리 다운로드
 *   POST /api/vandocs                → multipart/form-data 업로드
 *      필드:
 *        store     (필수) — 매장명
 *        category  (선택) — 카테고리 경로 ("카드가맹 신규/개인사업자/1인대표")
 *        docType   (선택) — 서류 종류 ("사업자등록증" 등)
 *        submitter (선택) — 제출자 이름·연락처
 *        note      (선택) — 비고
 *        files     (필수, 다중) — 업로드 파일들
 *
 * 저장 위치 (KV STORES_KV):
 *   "vandocs_index"          → { items: [{id, store, category, docType, count, totalBytes, createdAt}, ...] }
 *   "vandoc:<id>"            → { id, store, ..., files: [{name, type, size, data(base64)}, ...] }
 *
 * 한도: 파일당 5MB, 제출당 총 20MB (KV value 25MB 제한 회피).
 */

const MAX_FILE_BYTES   =  5_000_000;  // 파일당 5MB
const MAX_TOTAL_BYTES  = 20_000_000;  // 제출당 20MB
const INDEX_MAX        = 2000;        // 인덱스 최대 항목 수

export async function onRequestGet({ env, request }) {
  if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const data = await env.STORES_KV.get('vandoc:' + id, 'json');
    if (!data) return json({ error: 'not found' }, 404);

    // 단일 파일 바이너리 다운로드
    const fileIdx = url.searchParams.get('fileIdx');
    const download = url.searchParams.get('download');
    if (fileIdx != null && download) {
      const idx = Number(fileIdx);
      const f = data.files && data.files[idx];
      if (!f) return text('file not found', 404);
      const bin = base64ToBytes(f.data || '');
      return new Response(bin, {
        status: 200,
        headers: {
          'content-type': f.type || 'application/octet-stream',
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name || 'file')}`,
          'cache-control': 'private, max-age=300',
        },
      });
    }

    return json(data, 200);
  }

  const idx = (await env.STORES_KV.get('vandocs_index', 'json')) || { items: [] };
  return json(idx, 200);
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);

  let form;
  try { form = await request.formData(); }
  catch (e) { return text('invalid form-data: ' + e.message, 400); }

  const store     = String(form.get('store')     || '').trim();
  const category  = String(form.get('category')  || '').trim();
  const docType   = String(form.get('docType')   || '').trim();
  const submitter = String(form.get('submitter') || '').trim();
  const note      = String(form.get('note')      || '').trim();

  if (!store)   return text('매장명(store)이 필요합니다', 400);
  if (!docType) return text('서류 종류(docType)가 필요합니다', 400);

  const rawFiles = form.getAll('files');
  if (!rawFiles || !rawFiles.length) return text('업로드 파일이 없습니다', 400);

  const stored = [];
  let totalBytes = 0;
  let skipped = 0;
  for (const f of rawFiles) {
    if (!f || typeof f.arrayBuffer !== 'function') { skipped++; continue; }
    const buf = await f.arrayBuffer();
    if (!buf.byteLength) { skipped++; continue; }
    if (buf.byteLength > MAX_FILE_BYTES) { skipped++; continue; }
    if (totalBytes + buf.byteLength > MAX_TOTAL_BYTES) { skipped++; continue; }
    totalBytes += buf.byteLength;
    stored.push({
      name: String(f.name || 'file').slice(0, 200),
      type: String(f.type || 'application/octet-stream').slice(0, 100),
      size: buf.byteLength,
      data: bytesToBase64(new Uint8Array(buf)),
    });
  }
  if (!stored.length) return text('유효한 파일이 없습니다 (파일당 ≤5MB, 제출 합 ≤20MB)', 413);

  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const submission = {
    id,
    store,
    category,
    docType,
    submitter,
    note,
    files: stored,
    createdAt: new Date().toISOString(),
  };

  await env.STORES_KV.put('vandoc:' + id, JSON.stringify(submission));

  // 인덱스 갱신
  const idx = (await env.STORES_KV.get('vandocs_index', 'json')) || { items: [] };
  idx.items.unshift({
    id, store, category, docType, submitter,
    count: stored.length, totalBytes,
    createdAt: submission.createdAt,
  });
  if (idx.items.length > INDEX_MAX) idx.items = idx.items.slice(0, INDEX_MAX);
  await env.STORES_KV.put('vandocs_index', JSON.stringify(idx));

  return json({
    ok: true,
    id,
    count: stored.length,
    skipped,
    totalBytes,
  }, 200);
}

/* base64 ↔ bytes (Workers 환경) */
function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
  return new Response(msg, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
