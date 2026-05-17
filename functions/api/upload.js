/**
 * 첨부 업로드 — 이미지 + 일반 파일 통합
 *
 *   POST /api/upload      (multipart/form-data)
 *     file:      Blob (필수)
 *     kind:      'image' | 'file'  (선택, 미지정시 mime 으로 자동 판단)
 *     name:      원본 파일명 (선택, 파일일 때 다운로드용)
 *     jobId:     'JOB-xxxx' (선택, 메타용)
 *     category:  'as'|'as_new'|'stocktake'|'van'|'supply'|'memo' (선택)
 *     threadId:  'th-xxxx' (선택)
 *
 *   응답 (200):
 *     image → { ok, kind:'image', key, url, size, uploadedAt, uploadedBy }
 *     file  → { ok, kind:'file',  key, url, name, ext, mime, size, previewable, ... }
 *
 *   응답 (실패):
 *     400 unsupported_type / 401 login_required / 413 too_large / 500 r2_put_failed
 *
 * 저장 경로:
 *     이미지: images/{yyyy}/{MM}/{uuid}.jpg   (클라이언트가 항상 jpg 로 변환 후 업로드)
 *     파일:   files/{yyyy}/{MM}/{uuid}.{ext}
 *
 * R2 binding: env.ATTACHMENTS (wrangler.toml [[r2_buckets]])
 * 공개 접근: r2.dev 자동 도메인 또는 Worker 프록시 (GET /api/file/{key})
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10MB (압축 후)
const MAX_FILE_BYTES  = 50 * 1024 * 1024;   // 50MB
const TOTAL_REQUEST_LIMIT = 60 * 1024 * 1024;

// 화이트리스트
const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif',
]);

const FILE_EXT_WHITELIST = new Set([
  'pdf', 'hwp', 'hwpx',
  'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt',
  'zip', 'txt', 'csv',
]);

const FILE_EXT_BLACKLIST = new Set([
  'exe', 'bat', 'ps1', 'sh', 'js', 'cmd', 'com', 'scr', 'msi', 'dll',
  'vbs', 'jar', 'apk',
]);

const PREVIEWABLE_EXT = new Set(['pdf', 'docx', 'xlsx', 'pptx']);

const EXT_MIME = {
  pdf: 'application/pdf',
  hwp: 'application/x-hwp',
  hwpx: 'application/haansoft-hwpx',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:  'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt:  'application/vnd.ms-powerpoint',
  zip:  'application/zip',
  txt:  'text/plain',
  csv:  'text/csv',
};

export async function onRequestPost({ request, env }) {
  if (!env.ATTACHMENTS) {
    return json({ ok:false, error:'r2_not_bound' }, 500);
  }

  // Content-Length 사전 검사
  const cl = parseInt(request.headers.get('content-length') || '0', 10);
  if (cl > TOTAL_REQUEST_LIMIT) {
    return json({ ok:false, error:'too_large', maxMB:50 }, 413);
  }

  let form;
  try { form = await request.formData(); }
  catch { return json({ ok:false, error:'invalid_multipart' }, 400); }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return json({ ok:false, error:'file_missing' }, 400);
  }

  const declaredKind = (form.get('kind') || '').toString().toLowerCase();
  const originalName = (form.get('name') || file.name || 'unnamed').toString();
  const jobId    = (form.get('jobId')    || '').toString();
  const category = (form.get('category') || '').toString();
  const threadId = (form.get('threadId') || '').toString();
  const uploadedBy = (form.get('uploadedBy') || '').toString();

  const mime = (file.type || '').toLowerCase();
  const size = file.size;
  const isImage = declaredKind === 'image' || (!declaredKind && mime.startsWith('image/'));

  // ─── 이미지 흐름 ──────────────────────────────
  if (isImage) {
    // 클라이언트에서 항상 jpg 로 변환 후 보냄
    if (!IMAGE_MIMES.has(mime) && !mime.startsWith('image/')) {
      return json({ ok:false, error:'unsupported_image_type', mime }, 400);
    }
    if (size > MAX_IMAGE_BYTES) {
      return json({ ok:false, error:'too_large', kind:'image', maxMB:10 }, 413);
    }
    const key = buildKey('images', 'jpg');
    try {
      await env.ATTACHMENTS.put(key, file.stream(), {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: { jobId, category, threadId, uploadedBy, origName: originalName },
      });
    } catch (e) {
      return json({ ok:false, error:'r2_put_failed', detail:String(e) }, 500);
    }
    return json({
      ok: true,
      kind: 'image',
      key,
      url: publicUrl(env, key),
      size,
      uploadedAt: new Date().toISOString(),
      uploadedBy,
    });
  }

  // ─── 파일 흐름 ──────────────────────────────
  const ext = extractExt(originalName, mime);
  if (!ext) {
    return json({ ok:false, error:'unsupported_type', mime, name:originalName }, 400);
  }
  if (FILE_EXT_BLACKLIST.has(ext)) {
    return json({ ok:false, error:'blocked_type', ext }, 400);
  }
  if (!FILE_EXT_WHITELIST.has(ext)) {
    return json({ ok:false, error:'unsupported_type', ext }, 400);
  }
  if (size > MAX_FILE_BYTES) {
    return json({ ok:false, error:'too_large', kind:'file', maxMB:50 }, 413);
  }

  const key = buildKey('files', ext);
  const contentType = EXT_MIME[ext] || mime || 'application/octet-stream';
  try {
    await env.ATTACHMENTS.put(key, file.stream(), {
      httpMetadata: {
        contentType,
        // 다운로드 시 원본 파일명으로 저장되도록
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      },
      customMetadata: { jobId, category, threadId, uploadedBy, origName: originalName },
    });
  } catch (e) {
    return json({ ok:false, error:'r2_put_failed', detail:String(e) }, 500);
  }

  return json({
    ok: true,
    kind: 'file',
    key,
    url: publicUrl(env, key),
    name: originalName,
    ext,
    mime: contentType,
    size,
    previewable: PREVIEWABLE_EXT.has(ext),
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  });
}

// 옵션: CORS preflight (필요 시)
export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}

// ─── 유틸 ───────────────────────────────────
function buildKey(prefix, ext) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const uuid = crypto.randomUUID().replace(/-/g, '');
  return `${prefix}/${yyyy}/${mm}/${uuid}.${ext}`;
}

function extractExt(name, mime) {
  // 1) 확장자 추출
  const m = (name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  let ext = m ? m[1] : '';
  // 2) 미지정시 mime → ext 역추정
  if (!ext) {
    if (mime === 'application/pdf') ext = 'pdf';
    else if (mime?.includes('wordprocessingml')) ext = 'docx';
    else if (mime?.includes('spreadsheetml')) ext = 'xlsx';
    else if (mime?.includes('presentationml')) ext = 'pptx';
    else if (mime === 'application/zip') ext = 'zip';
    else if (mime === 'text/plain') ext = 'txt';
    else if (mime === 'text/csv') ext = 'csv';
  }
  return ext || null;
}

function publicUrl(env, key) {
  // 우선순위:
  //   1) PUBLIC_R2_BASE 환경변수 (사용자 지정 도메인 또는 r2.dev URL)
  //   2) 폴백: 우리 프록시 /api/file?key=...
  const base = env.PUBLIC_R2_BASE;
  if (base) {
    return `${base.replace(/\/+$/,'')}/${key}`;
  }
  // 폴백 (R2 public 미설정 시) — 같은 도메인 프록시
  return `/api/file?key=${encodeURIComponent(key)}`;
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
