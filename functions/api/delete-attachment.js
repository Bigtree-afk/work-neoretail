/**
 * 첨부 삭제 — 휴지통 이동 (30일 보존)
 *
 *   POST /api/delete-attachment
 *     body: { key: 'images/2026/05/abc.jpg' }
 *
 *   동작:
 *     1) 원본을 _trash/{원본키} 로 복사
 *     2) 원본 삭제
 *
 *   영구 삭제는 별도 cron (TODO).
 */
export async function onRequestPost({ request, env }) {
  if (!env.ATTACHMENTS) return json({ ok:false, error:'r2_not_bound' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok:false, error:'invalid_json' }, 400); }

  const key = (body?.key || '').toString();
  if (!key) return json({ ok:false, error:'key_required' }, 400);

  // 안전: 휴지통 안의 것은 다시 휴지통으로 보내지 않음
  if (key.startsWith('_trash/')) {
    return json({ ok:false, error:'already_trashed' }, 400);
  }
  // 안전: key 는 images/ 또는 files/ 로 시작해야 함
  if (!/^(images|files)\//.test(key)) {
    return json({ ok:false, error:'invalid_key' }, 400);
  }

  try {
    const src = await env.ATTACHMENTS.get(key);
    if (!src) return json({ ok:false, error:'not_found', key }, 404);

    const trashKey = `_trash/${key}`;
    await env.ATTACHMENTS.put(trashKey, src.body, {
      httpMetadata: src.httpMetadata,
      customMetadata: {
        ...(src.customMetadata || {}),
        trashedAt: new Date().toISOString(),
      },
    });
    await env.ATTACHMENTS.delete(key);

    return json({ ok:true, trashedKey: trashKey, expiresInDays: 30 });
  } catch (e) {
    return json({ ok:false, error:'r2_op_failed', detail:String(e) }, 500);
  }
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
