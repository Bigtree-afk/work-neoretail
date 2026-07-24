/**
 * ONE 노트 — 회의록 정리 (Claude)
 *
 *   POST /api/one-meeting
 *     Body: { transcript:"...", title?, hint? }
 *     → { ok:true, html:"<h3>...</h3>..." }   // contenteditable 에 바로 삽입 가능한 HTML 조각
 *
 * 서버측 Claude 키 재사용(line_config.claudeApiKey). 별도 키 불필요.
 */
const CFG_KEY = 'line_config';
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

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

// Claude 응답에서 허용 태그만 남기는 최소 새니타이즈(그래도 클라이언트가 한 번 더 거름)
function sanitizeHtml(s) {
  let h = String(s || '');
  // 코드펜스 제거
  h = h.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // script/style/on* 제거
  h = h.replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  h = h.replace(/ on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  h = h.replace(/javascript:/gi, '');
  return h;
}

export async function onRequestOptions() { return json({}, 204); }

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return json({ ok: false, error: 'kv_not_bound' }, 500);

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'bad_json' }, 400); }

  const transcript = String((body && body.transcript) || '').trim();
  if (!transcript) return json({ ok: false, error: 'no_transcript' }, 400);
  if (transcript.length < 10) return json({ ok: false, error: 'too_short' }, 400);

  let cfg = {};
  try { cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {}; } catch (_) {}
  const apiKey = cfg.claudeApiKey;
  if (!apiKey) return json({ ok: false, error: 'no_claude_key', detail: '관리자 페이지 → LINE 설정에서 Claude API key 입력 필요' }, 503);

  const title = String((body && body.title) || '').trim();
  const hint = String((body && body.hint) || '').trim();

  const prompt = `당신은 회의록 정리 전문가입니다. 아래는 음성 인식으로 전사된 회의 내용입니다(오탈자·중복·잡음이 있을 수 있음). 이를 깔끔한 한국어 회의록으로 정리하세요.

규칙:
- 전사 오류로 보이는 부분은 문맥으로 자연스럽게 교정하되, 없는 내용을 지어내지 마세요.
- 출력은 HTML 조각만. <h3>, <h4>, <ul>/<li>, <ol>/<li>, <p>, <b>, <table>/<tr>/<td> 만 사용. 코드펜스(\`\`\`)·<html>·<body>·style/script 금지.
- 아래 구조를 따르세요:
  <h3>📋 회의록${title ? ' — ' + title : ''}</h3>
  <p><b>일시</b> · <b>참석</b> (내용에서 파악되면. 모르면 생략)</p>
  <h4>🗣 핵심 논의</h4> — 주제별 bullet 요약(간결하게)
  <h4>✅ 결정 사항</h4> — 확정된 것만. 없으면 "특이사항 없음"
  <h4>📌 액션 아이템</h4> — 표(담당 / 할 일 / 기한). 담당·기한 불명이면 빈칸. 없으면 이 섹션 생략
- 장황하지 않게, 실무자가 30초 안에 파악할 수 있게.
${hint ? '\n추가 맥락: ' + hint : ''}

전사 내용:
${transcript.slice(0, 24000)}`;

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
  } catch (e) {
    return json({ ok: false, error: 'claude_fetch_failed', detail: String(e).slice(0, 200) }, 502);
  }
  if (!r.ok) {
    const e = await r.text().catch(() => '');
    return json({ ok: false, error: 'claude_' + r.status, detail: e.slice(0, 200) }, 502);
  }
  const data = await r.json();
  const raw = (data.content && data.content[0] && data.content[0].text) || '';
  const html = sanitizeHtml(raw);
  if (!html) return json({ ok: false, error: 'empty_result' }, 502);

  return json({ ok: true, html, model: CLAUDE_MODEL });
}
