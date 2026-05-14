/**
 * NeoRetail LINE 파싱 Cron Worker
 *
 * Cloudflare Workers Cron Triggers 가 매시 45분 / 55분에 발사 →
 *   POST https://work.neoretail.net/api/line-parse-cron  (Bearer 토큰)
 *
 * GitHub Actions 보다 훨씬 안정적 (Cloudflare 인프라 내부 실행, 드롭 거의 없음).
 * GitHub Actions cron 은 백업으로 유지 — 같은 endpoint 가 idempotent.
 *
 * 환경변수 (wrangler secret put):
 *   - LINE_PARSE_SECRET : line_config.parseSecret 와 동일
 *
 * 수동 실행:
 *   curl https://neoretail-cron.<account>.workers.dev/run
 */
const TARGET_URL = 'https://work.neoretail.net/api/line-parse-cron';

async function callParseCron(env, source) {
  if (!env.LINE_PARSE_SECRET) {
    console.error('[cron] LINE_PARSE_SECRET not set');
    return { ok:false, error:'no secret' };
  }
  const started = Date.now();
  try {
    const r = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${env.LINE_PARSE_SECRET}`,
        'content-type': 'application/json',
        'x-cron-source': source,
      },
      body: JSON.stringify({}),
    });
    const txt = await r.text();
    const elapsed = Date.now() - started;
    console.log(`[cron source=${source}] status=${r.status} ms=${elapsed} body=${txt.slice(0, 400)}`);
    return { ok: r.ok, status: r.status, elapsed, body: txt.slice(0, 400) };
  } catch (e) {
    console.error(`[cron source=${source}] fetch failed:`, e.message);
    return { ok:false, error:e.message };
  }
}

export default {
  // Cloudflare Cron Triggers
  async scheduled(event, env, ctx) {
    const minute = new Date(event.scheduledTime).getUTCMinutes();
    const source = minute === 55 ? 'cf-cron-watchdog' : 'cf-cron-primary';
    ctx.waitUntil(callParseCron(env, source));
  },

  // 수동 트리거용 HTTP 엔드포인트
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const r = await callParseCron(env, 'manual-http');
      return new Response(JSON.stringify(r), {
        status: r.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok:true, name:'neoretail-cron' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('neoretail-cron: POST /run to trigger, GET /health for status', { status: 200 });
  },
};
