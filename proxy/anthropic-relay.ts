/**
 * Anthropic 릴레이 프록시 — Cloudflare 워커 egress IP 가 Anthropic 앞단 CF 엣지에
 *   'Request not allowed'(403) 로 차단될 때 우회용. **비-Cloudflare 호스트**(Deno Deploy 등)에 배포.
 *
 * 흐름: NeoRetail 워커(one-chat/one-meeting/one-tidy) → (x-relay-secret + x-api-key) → 이 릴레이
 *       → api.anthropic.com/v1/messages 로 그대로 전달 → 응답 반환.
 *   - Anthropic API 키는 여기 저장하지 않음(워커가 x-api-key 로 보낸 값을 그대로 전달).
 *   - 남용 방지: 워커가 보낸 x-relay-secret 이 이 서버의 RELAY_SECRET(환경변수)과 일치해야만 전달.
 *
 * 배포(Deno Deploy):
 *   1) https://dash.deno.com → New Project → Playground
 *   2) 이 파일 내용 붙여넣기 → Save & Deploy
 *   3) Settings → Environment Variables 에 RELAY_SECRET = <워커 line_config.claudeRelaySecret 과 동일값> 추가
 *   4) 배포된 URL(예: https://xxxx.deno.dev)을 관리자에게 전달 → line_config.claudeRelayUrl 로 설정
 *   * 헬스체크: GET https://xxxx.deno.dev/health → {"ok":true}
 */
const RELAY_SECRET = Deno.env.get("RELAY_SECRET") || "";
const UPSTREAM = "https://api.anthropic.com/v1/messages";

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-api-key,x-relay-secret,anthropic-version",
    "access-control-allow-methods": "POST,OPTIONS",
  };
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (url.pathname === "/health" || url.pathname === "/") return json({ ok: true, relay: "anthropic", hasSecret: !!RELAY_SECRET });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!RELAY_SECRET) return json({ error: "relay_misconfigured", detail: "RELAY_SECRET env 미설정" }, 500);
  if ((req.headers.get("x-relay-secret") || "") !== RELAY_SECRET) return json({ error: "unauthorized" }, 401);

  const apiKey = req.headers.get("x-api-key") || "";
  if (!apiKey) return json({ error: "no_api_key" }, 400);
  const body = await req.text();

  // 타임아웃(25s) — 매달림 방지
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(UPSTREAM, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": req.headers.get("anthropic-version") || "2023-06-01",
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "Anthropic/Python 0.40.0",
      },
      body,
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...cors(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    return json({ error: "relay_upstream_error", detail: String((e as Error)?.message || e).slice(0, 200) }, 502);
  } finally {
    clearTimeout(timer);
  }
});
