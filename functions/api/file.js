/**
 * R2 첨부 프록시 — public r2.dev 미설정 시 폴백 경로
 *
 *   GET /api/file?key=images/2026/05/abc.jpg
 *
 *   - R2 에서 객체 가져와 그대로 응답.
 *   - 이미지/PDF/문서 모두 동일 처리.
 *   - 다운로드 강제는 ?dl=1 로 옵션.
 *
 *   PUBLIC_R2_BASE 가 설정되어 R2 자체 도메인을 쓰는 경우 이 엔드포인트는 불필요.
 */
export async function onRequestGet({ request, env }) {
  if (!env.ATTACHMENTS) return new Response('r2 not bound', { status: 500 });

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return new Response('key required', { status: 400 });

  // 휴지통 직접 접근 차단 (관리자 페이지에서 별도 처리)
  if (key.startsWith('_trash/')) return new Response('not found', { status: 404 });
  if (!/^(images|files)\//.test(key)) return new Response('invalid key', { status: 400 });

  const obj = await env.ATTACHMENTS.get(key);
  if (!obj) return new Response('not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  if (url.searchParams.get('dl') === '1') {
    const origName = obj.customMetadata?.origName;
    if (origName) {
      headers.set('content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(origName)}`);
    } else {
      headers.set('content-disposition', 'attachment');
    }
  }

  return new Response(obj.body, { headers });
}
