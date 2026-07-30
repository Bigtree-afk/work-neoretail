/**
 * ONE 노트 — 전사 텍스트 다듬기(띄어쓰기·문장부호·줄바꿈 교정)
 *
 *   POST /api/one-tidy  { text:"..." }  → { ok:true, text:"교정된 텍스트" }
 *
 * 음성 전사 결과를 편집하기 쉽게 다듬는다. 요약·추가·삭제 없이 형식만 정리.
 * 가벼운 작업이라 sonnet-4-5(빠르고 저렴) 사용. line_config.claudeApiKey 재사용.
 */
const CFG_KEY = 'line_config';
const MODEL = 'claude-sonnet-4-5-20250929';

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

export async function onRequestOptions() { return json({}, 204); }

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return json({ ok: false, error: 'kv_not_bound' }, 200);
  let body;
  try { body = await request.json(); } catch (_) { return json({ ok: false, error: 'bad_json' }, 400); }
  const text = String((body && body.text) || '').trim();
  if (!text) return json({ ok: false, error: 'no_text' }, 400);
  if (text.length < 5) return json({ ok: true, text });

  let cfg = {};
  try { cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {}; } catch (_) {}
  const apiKey = cfg.claudeApiKey;
  if (!apiKey) return json({ ok: false, error: 'no_claude_key' }, 200);

  const prompt = `아래는 음성 인식(STT)으로 받아쓴 텍스트입니다. 편집하기 쉽도록 형식만 다듬어 주세요.
규칙:
- 한국어 띄어쓰기를 자연스럽게 교정하고, 마침표·물음표·쉼표 등 문장부호를 알맞게 넣으세요.
- 문장(또는 발화) 단위로 줄바꿈을 넣어 읽기 쉽게 하세요. 화제가 크게 바뀌면 빈 줄로 문단을 나눠도 됩니다.
- 명백한 인식 오탈자만 문맥상 자연스럽게 바로잡되, 내용을 요약·추가·삭제하거나 말투를 바꾸지 마세요. 있는 말을 그대로 살리세요.
- 설명·머리말 없이 다듬은 본문 텍스트만 출력하세요.

원문:
${text.slice(0, 16000)}`;

  let base = 'https://api.anthropic.com/v1/messages';
  if (cfg.anthropicBase && /^https:\/\//.test(cfg.anthropicBase)) {
    base = cfg.anthropicBase.replace(/\/+$/, '');
    if (!/\/v1\/messages$/.test(base)) base += '/v1/messages';
  }
  let r;
  try {
    r = await fetch(base, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'accept': 'application/json', 'user-agent': 'neoretail-one/1.0 (+https://work.neoretail.net)' },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
    });
  } catch (e) { return json({ ok: false, error: 'claude_fetch_failed', detail: String(e).slice(0, 200) }, 200); }
  if (!r.ok) { const e = await r.text().catch(() => ''); return json({ ok: false, error: 'claude_' + r.status, detail: e.slice(0, 200) }, 200); }

  let data; try { data = JSON.parse(await r.text()); } catch (_) { return json({ ok: false, error: 'claude_bad_json' }, 200); }
  let out = '';
  for (const b of (data.content || [])) { if (b && b.type === 'text') out += b.text; }
  out = out.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!out) return json({ ok: false, error: 'empty_result' }, 200);
  return json({ ok: true, text: out });
}
