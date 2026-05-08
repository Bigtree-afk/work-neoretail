/**
 * VAN 서류 업로드 — 공개 엔드포인트 (인증 없음)
 *
 *   GET  /api/vandocs                → 인덱스(목록) 반환
 *   GET  /api/vandocs?unack=1        → 미확인 항목만
 *   GET  /api/vandocs?id=<id>        → 특정 제출 메타데이터(파일 목록 포함, 바이너리 제외)
 *   GET  /api/vandocs?id=<id>&fileIdx=<n>&download=1
 *                                     → 단일 파일 바이너리 다운로드
 *   POST /api/vandocs                → multipart/form-data 업로드
 *      필드: store, category, docType, submitter, note, files[]
 *   PUT  /api/vandocs?ack=<id>&by=<name>  → 확인(ack) 처리
 *
 * 저장 위치 (KV STORES_KV):
 *   "vandocs_index"                  → { items: [...] }
 *   "vandoc:<id>"                    → 메타데이터(JSON) — files: [{name,type,size,key}]
 *   "vandoc:<id>:f<n>"               → 파일 바이너리 (raw bytes, KV 25MB 한도)
 *   "vandocs_cleanup_at"             → 마지막 정리 시각(ms) — 1시간마다 게으른 정리
 *
 * 한도: 파일당 24MB (KV 25MB 한도 안전 마진), 제출당 합계 50MB.
 * 자동 삭제: 확인(ack)된 후 7일 경과 시 게으른 정리로 KV에서 삭제.
 */

const MAX_FILE_BYTES   =  24_000_000; // 파일당 24MB (KV value 25MB 안전 마진)
const MAX_TOTAL_BYTES  =  50_000_000; // 제출당 합계 50MB
const INDEX_MAX        = 2000;
const ACK_RETENTION_MS = 7 * 24 * 3600 * 1000; // 확인 후 7일 보관
const CLEANUP_THROTTLE_MS = 3600 * 1000;       // 정리 주기 1시간

export async function onRequestGet({ env, request }) {
  if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const unack = url.searchParams.get('unack');

  // 게으른 정리 (목록 조회 시에만 — 1시간 쓰로틀)
  if (!id) { try { await _maybeCleanup(env); } catch(e){} }

  if (unack && !id) {
    const idx = (await env.STORES_KV.get('vandocs_index', 'json')) || { items: [] };
    const items = (idx.items || []).filter(it => !it.acknowledged);
    return json({ items }, 200);
  }

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

      let bin = null;
      if (f.key) {
        // 신규 형식: 별도 KV 키에 raw bytes 저장
        bin = await env.STORES_KV.get(f.key, 'arrayBuffer');
      } else if (f.data) {
        // 구버전 호환: base64 inline
        bin = base64ToBytes(f.data);
      }
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

    // 메타데이터만 (data 필드 제거 — 응답 크기 절감)
    const meta = { ...data, files: (data.files || []).map(f => ({
      name: f.name, type: f.type, size: f.size,
      hasData: !!(f.key || f.data),
    })) };
    return json(meta, 200);
  }

  const idx = (await env.STORES_KV.get('vandocs_index', 'json')) || { items: [] };
  return json(idx, 200);
}

/* PUT /api/vandocs?ack=<id>&by=<name>  → 확인(ack) 처리 */
export async function onRequestPut({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url = new URL(request.url);
  const ackId = url.searchParams.get('ack');
  if (!ackId) return text('ack id required', 400);

  const idx = (await env.STORES_KV.get('vandocs_index', 'json')) || { items: [] };
  const item = (idx.items || []).find(it => it.id === ackId);
  if (!item) return json({ error: 'not found' }, 404);

  let by = url.searchParams.get('by') || '';
  try {
    const body = await request.json();
    if (body && body.by) by = String(body.by);
  } catch(e){}

  item.acknowledged = true;
  item.acknowledgedAt = new Date().toISOString();
  item.acknowledgedBy = String(by || '').slice(0, 80);

  await env.STORES_KV.put('vandocs_index', JSON.stringify(idx));
  return json({ ok: true, id: ackId, autoDeleteAt: new Date(Date.now() + ACK_RETENTION_MS).toISOString() }, 200);
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

  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  const fileMetas = [];
  let totalBytes = 0;
  let skipped = 0;
  let n = 0;

  for (const f of rawFiles) {
    if (!f || typeof f.arrayBuffer !== 'function') { skipped++; continue; }
    const buf = await f.arrayBuffer();
    if (!buf.byteLength) { skipped++; continue; }
    if (buf.byteLength > MAX_FILE_BYTES) { skipped++; continue; }
    if (totalBytes + buf.byteLength > MAX_TOTAL_BYTES) { skipped++; continue; }
    totalBytes += buf.byteLength;

    const fileKey = `vandoc:${id}:f${n}`;
    // KV 는 ArrayBuffer 그대로 저장 가능 — base64 오버헤드 없음
    await env.STORES_KV.put(fileKey, buf);

    fileMetas.push({
      name: String(f.name || `file_${n}`).slice(0, 200),
      type: String(f.type || 'application/octet-stream').slice(0, 100),
      size: buf.byteLength,
      key:  fileKey,
    });
    n++;
  }
  if (!fileMetas.length) {
    return text(`유효한 파일이 없습니다 (파일당 ≤${(MAX_FILE_BYTES/1_000_000)|0}MB, 제출 합 ≤${(MAX_TOTAL_BYTES/1_000_000)|0}MB)`, 413);
  }

  const submission = {
    id, store, category, docType, submitter, note,
    files: fileMetas,
    createdAt: new Date().toISOString(),
  };

  await env.STORES_KV.put('vandoc:' + id, JSON.stringify(submission));

  // 인덱스 갱신
  const idx = (await env.STORES_KV.get('vandocs_index', 'json')) || { items: [] };
  idx.items.unshift({
    id, store, category, docType, submitter,
    count: fileMetas.length, totalBytes,
    createdAt: submission.createdAt,
  });
  if (idx.items.length > INDEX_MAX) idx.items = idx.items.slice(0, INDEX_MAX);
  await env.STORES_KV.put('vandocs_index', JSON.stringify(idx));

  return json({
    ok: true,
    id,
    count: fileMetas.length,
    skipped,
    totalBytes,
  }, 200);
}

/* ──────────────────────────────────────────────
   게으른 정리: 확인 후 7일 경과 항목 KV에서 삭제
   - 1시간에 한 번만 실행 (vandocs_cleanup_at 키)
────────────────────────────────────────────── */
async function _maybeCleanup(env) {
  const last = Number(await env.STORES_KV.get('vandocs_cleanup_at') || '0');
  const now = Date.now();
  if (now - last < CLEANUP_THROTTLE_MS) return;
  await env.STORES_KV.put('vandocs_cleanup_at', String(now));

  const idx = (await env.STORES_KV.get('vandocs_index', 'json')) || { items: [] };
  const items = idx.items || [];
  const keep = [];
  const expired = [];
  for (const it of items) {
    const ackTs = it.acknowledged && it.acknowledgedAt
      ? new Date(it.acknowledgedAt).getTime()
      : 0;
    if (ackTs && (now - ackTs) > ACK_RETENTION_MS) expired.push(it);
    else keep.push(it);
  }
  if (!expired.length) return;

  for (const it of expired) {
    try {
      // 메타데이터에서 파일 키 목록을 정확히 얻기 위해 한 번 읽기
      const meta = await env.STORES_KV.get('vandoc:' + it.id, 'json');
      const fileKeys = (meta && meta.files || []).map(f => f.key).filter(Boolean);
      // 파일 바이너리 삭제
      for (const k of fileKeys) { try { await env.STORES_KV.delete(k); } catch(e){} }
      // 호환: count 기반 추정 키 삭제 (구버전 데이터)
      const cnt = it.count || 0;
      for (let i = 0; i < cnt; i++) {
        try { await env.STORES_KV.delete(`vandoc:${it.id}:f${i}`); } catch(e){}
      }
      // 메타데이터 삭제
      try { await env.STORES_KV.delete('vandoc:' + it.id); } catch(e){}
    } catch(e) {}
  }

  idx.items = keep;
  await env.STORES_KV.put('vandocs_index', JSON.stringify(idx));
}

/* base64 → bytes (구버전 호환용) */
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
