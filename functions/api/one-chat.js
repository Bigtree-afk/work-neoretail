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

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return json({ ok: false, error: 'kv_not_bound' }, 500);

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'bad_json' }, 400); }

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
  if (!apiKey) return json({ ok: false, error: 'no_claude_key', detail: '관리자 페이지 → LINE 설정에서 Claude API key 입력 필요' }, 503);

  const title = String((body && body.title) || '').trim();
  const system = [{
    type: 'text',
    text: SYSTEM + (title ? `\n\n(참고: 지금 다루는 주제는 "${title}" 입니다.)` : ''),
    cache_control: { type: 'ephemeral' },   // 안정 프롬프트 캐싱
  }];

  // 누적 이력 캐싱 — 마지막 직전 메시지에 breakpoint(다음 턴이 캐시에서 읽음)
  const messages = clean.map((m, i) => {
    if (i === clean.length - 2) {
      return { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
    }
    return m;
  });

  async function callClaude(model) {
    const payload = {
      model,
      max_tokens: 1024,
      system,
      messages,
    };
    // Opus 5 는 thinking 기본 on → 음성 대화 지연/비용 줄이려 disabled(도구 없음이라 안전).
    //   내부 태그 누출 방지 위해 '생각하지 마' 류 지시는 넣지 않고 system 에 태그 금지만 명시함.
    if (/opus-5|opus-4-8|opus-4-7|fable-5|sonnet-5/.test(model)) {
      payload.thinking = { type: 'disabled' };
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return r;
  }

  let r, model = PRIMARY_MODEL;
  try { r = await callClaude(PRIMARY_MODEL); }
  catch (e) { return json({ ok: false, error: 'claude_fetch_failed', detail: String(e).slice(0, 200) }, 502); }

  // Opus 5 미지원 키 → sonnet 폴백 (404 model_not_found / 403)
  if (!r.ok && (r.status === 404 || r.status === 403)) {
    model = FALLBACK_MODEL;
    try { r = await callClaude(FALLBACK_MODEL); } catch (e) { return json({ ok: false, error: 'claude_fetch_failed', detail: String(e).slice(0, 200) }, 502); }
  }
  if (!r.ok) {
    const e = await r.text().catch(() => '');
    return json({ ok: false, error: 'claude_' + r.status, detail: e.slice(0, 200) }, 502);
  }

  const data = await r.json();
  if (data.stop_reason === 'refusal') {
    return json({ ok: true, reply: '그 주제는 제가 도와드리기 어려워요. 다른 이야기를 해볼까요?', model, refusal: true });
  }
  let reply = '';
  for (const b of (data.content || [])) { if (b && b.type === 'text') reply += b.text; }
  reply = reply.trim();
  if (!reply) return json({ ok: false, error: 'empty_reply' }, 502);

  return json({ ok: true, reply, model: data.model || model });
}
