/**
 * ONE 노트 — 음성 회의 모드(Claude 대화 파트너)
 *
 *   POST /api/one-chat
 *     Body: { messages:[{role:'user'|'assistant', content:'...'}], title? }
 *     → { ok:true, reply:"...", model:"..." }
 *
 * 턴 방식 음성 대화의 '두뇌'. 클라이언트가 STT 결과 + 대화이력을 보내면 Claude 가
 * 짧은 대화체 응답을 돌려주고, 클라이언트가 TTS 로 읽어준다. line_config.claudeApiKey 재사용.
 *
 * 모델: 기본 claude-opus-5(사용자 지정). 키가 Opus 5 미지원(404/403)이면 sonnet-4-5 로 폴백.
 * 비용 절감: system 프롬프트 + 직전 대화까지 프롬프트 캐싱(누적 이력이 캐시에서 읽힘).
 */
const CFG_KEY = 'line_config';
const PRIMARY_MODEL = 'claude-opus-5';
const FALLBACK_MODEL = 'claude-sonnet-4-5-20250929';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    },
  });
}

const SYSTEM = `당신은 사용자와 음성으로 대화하며 아이디어를 함께 탐색하는 브레인스토밍 파트너입니다.
- 응답은 곧바로 음성으로 읽히므로 2~4문장으로 짧고 자연스럽게 말하세요. 한 번에 핵심 하나 또는 질문 하나.
- 사용자의 생각을 발전시키고, 때때로 다른 관점이나 도발적인 질문으로 사고를 넓히세요. 무조건 동의하지 말고 근거 있게 이견도 제시하세요.
- 목록·마크다운 기호·이모지·XML 태그·머리말("좋은 질문이에요" 같은 상투구)을 쓰지 말고, 사람이 말하듯 대화체로.
- 한국어로 답하세요.`;

export async function onRequestOptions() { return json({}, 204); }

export async function onRequestPost(ctx) {
  // 🛡 어떤 경우에도 JSON 만 반환 — 미처리 예외로 Cloudflare 502(HTML) 뜨는 것 차단
  try { return await handleChat(ctx); }
  catch (e) { return json({ ok: false, error: 'server', detail: String((e && e.message) || e).slice(0, 200) }, 200); }
}

// 지정 ms 후 abort 되는 Claude 호출 (fetch 가 매달려 워커가 죽는 것 방지)
// baseUrl: 기본 api.anthropic.com. cfg.anthropicBase 설정 시 Cloudflare AI Gateway 등으로 우회 가능
//   (예: https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic/v1/messages)
async function callClaudeOnce(apiKey, model, system, messages, timeoutMs, baseUrl) {
  const payload = { model, max_tokens: 1024, system, messages };
  if (/opus-5|opus-4-8|opus-4-7|fable-5|sonnet-5/.test(model)) payload.thinking = { type: 'disabled' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(baseUrl || 'https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      // 표준 클라이언트처럼 보이게 — 빈 UA + 워커 egress IP 는 Anthropic 앞단 CF 가 403 차단하는 패턴
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': 'neoretail-one/1.0 (+https://work.neoretail.net)',
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    // 403/5xx 진단용 — 차단 주체 식별(server=cloudflare + cf-ray 면 엣지 차단)
    let meta = '';
    if (!r.ok) meta = ' [http=' + r.status + ' server=' + (r.headers.get('server') || '') + ' cf-ray=' + (r.headers.get('cf-ray') || '') + ' cf-mitigated=' + (r.headers.get('cf-mitigated') || '') + ' retry-after=' + (r.headers.get('retry-after') || '') + ']';
    return { status: r.status, ok: r.ok, text, meta };
  } finally { clearTimeout(timer); }
}

async function handleChat({ request, env }) {
  if (!env.STORES_KV) return json({ ok: false, error: 'kv_not_bound' }, 200);

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'bad_json' }, 200); }

  const msgs = Array.isArray(body && body.messages) ? body.messages : [];
  const clean = msgs
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.trim() }))
    .slice(-40);   // 최근 40턴만(이력 폭주 방지)
  if (!clean.length || clean[0].role !== 'user') {
    // 첫 메시지는 user 여야 함
    if (!clean.length) return json({ ok: false, error: 'no_messages' }, 400);
    clean.unshift({ role: 'user', content: '안녕하세요, 대화를 시작할게요.' });
  }

  let cfg = {};
  try { cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {}; } catch (_) {}
  const apiKey = cfg.claudeApiKey;
  if (!apiKey) return json({ ok: false, error: 'no_claude_key', detail: '관리자 페이지 → LINE 설정에서 Claude API key 입력 필요' }, 200);

  const title = String((body && body.title) || '').trim();
  const system = [{
    type: 'text',
    text: SYSTEM + (title ? `\n\n(참고: 지금 다루는 주제는 "${title}" 입니다.)` : ''),
    cache_control: { type: 'ephemeral' },   // 안정 프롬프트 캐싱
  }];

  // 누적 이력 캐싱 — 마지막 직전 메시지에 breakpoint(다음 턴이 캐시에서 읽음)
  const messages = clean.map((m, i) => {
    if (i === clean.length - 2) return { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
    return m;
  });

  const baseUrl = (cfg.anthropicBase && /^https:\/\//.test(cfg.anthropicBase)) ? cfg.anthropicBase : '';
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  // 호출 — 타임아웃 22s, 429/5xx/네트워크는 1회 재시도, Opus 5 미지원(404/403)이면 sonnet 폴백
  async function callWithRetry(model) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try { res = await callClaudeOnce(apiKey, model, system, messages, 22000, baseUrl); }
      catch (e) { if (attempt === 0) { await sleep(900); continue; } return { err: 'timeout_or_network', detail: String((e && e.message) || e) }; }
      if (res.ok) return res;
      // 429/5xx 만 1회 재시도(진짜 일시 오류). 403 은 재시도하면 엣지 남용차단만 악화 → 즉시 반환(상위서 sonnet 폴백)
      if ((res.status === 429 || res.status >= 500) && attempt === 0) { await sleep(900); continue; }
      return res;   // 404/403/기타 → 상위에서 처리(폴백)
    }
  }

  let model = PRIMARY_MODEL;
  let res = await callWithRetry(PRIMARY_MODEL);
  if (res && res.err) return json({ ok: false, error: res.err, detail: (res.detail || '').slice(0, 200) }, 200);
  // Opus 5 미지원 키 → sonnet 폴백
  if (res && !res.ok && (res.status === 404 || res.status === 403)) {
    model = FALLBACK_MODEL;
    res = await callWithRetry(FALLBACK_MODEL);
    if (res && res.err) return json({ ok: false, error: res.err, detail: (res.detail || '').slice(0, 200) }, 200);
  }
  if (!res || !res.ok) return json({ ok: false, error: 'claude_' + ((res && res.status) || '000'), detail: ((res && res.text || '').slice(0, 160) + (res && res.meta || '')) }, 200);

  let data;
  try { data = JSON.parse(res.text); }
  catch (_) { return json({ ok: false, error: 'claude_bad_json', detail: (res.text || '').slice(0, 120) }, 200); }
  if (data.stop_reason === 'refusal') return json({ ok: true, reply: '그 주제는 제가 도와드리기 어려워요. 다른 이야기를 해볼까요?', model, refusal: true });
  let reply = '';
  for (const b of (data.content || [])) { if (b && b.type === 'text') reply += b.text; }
  reply = reply.trim();
  if (!reply) return json({ ok: false, error: 'empty_reply' }, 200);
  return json({ ok: true, reply, model: data.model || model });
}
