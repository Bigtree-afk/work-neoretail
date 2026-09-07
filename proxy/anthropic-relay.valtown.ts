/**
 * Anthropic 릴레이 프록시 — Val Town 용 (HTTP val).
 *   Cloudflare 워커 egress 가 Anthropic 앞단 CF 엣지에 403 차단될 때 우회용.
 *
 * 배포(Val Town — 가장 간단):
 *   1) https://www.val.town 가입/로그인 → 우측 상단 "New" → "HTTP" (HTTP val 생성)
 *   2) 기존 내용 지우고 이 파일 내용 전체 붙여넣기 → 자동 저장/배포됨
 *   3) 좌측(또는 val 이름 옆 ⋯) Settings → "Environment Variables" 에
 *        RELAY_SECRET = <워커 line_config.claudeRelaySecret 과 동일값> 추가
 *   4) val 상단에 나오는 HTTP 엔드포인트 URL(예: https://<user>-<valname>.web.val.run) 복사
 *   5) 그 URL 을 관리자에게 전달 → line_config.claudeRelayUrl 로 설정
 *   * 헬스체크: 브라우저로 <URL>/health → {"ok":true,"hasSecret":true}
 *
 * 키(Claude API key)는 여기 저장 안 함 — 워커가 x-api-key 로 보낸 값을 그대로 api.anthropic.com 에 전달.
 * 남용 방지: 워커가 보낸 x-relay-secret 이 RELAY_SECRET(환경변수)과 일치해야만 전달.
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
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default async function (req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (url.pathname === "/health" || url.pathname === "/") {
    return json({ ok: true, relay: "anthropic", hasSecret: !!RELAY_SECRET });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!RELAY_SECRET) return json({ error: "relay_misconfigured", detail: "RELAY_SECRET env 미설정" }, 500);
  if ((req.headers.get("x-relay-secret") || "") !== RELAY_SECRET) return json({ error: "unauthorized" }, 401);

  const apiKey = req.headers.get("x-api-key") || "";
  if (!apiKey) return json({ error: "no_api_key" }, 400);
  const body = await req.text();

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
}
