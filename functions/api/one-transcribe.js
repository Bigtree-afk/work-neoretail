/**
 * ONE 노트 녹음 — Whisper 전사 (Cloudflare Workers AI)
 *
 *   POST /api/one-transcribe
 *     Body: { audio: <base64>, mime?, language? }   // audio = 16kHz mono WAV(권장) 청크의 base64
 *     → { ok:true, text:"...", model:"..." }
 *
 * 설계: 클라이언트가 긴 녹음을 짧은 WAV 청크로 잘라 순차 호출 → 텍스트 이어붙임.
 *   (Whisper 한 요청당 오디오 길이/크기 한계 회피). env.AI 바인딩 필요(wrangler [ai]).
 *
 * ⚠ 서버측 인증 없음 — 사이트 전체가 그러함(ONE 은 클라이언트 zoolex 게이트). 남용 방지는 별도.
 */
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

// base64 → Uint8Array
function b64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function onRequestOptions() { return json({}, 204); }

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({ ok: false, error: 'ai_not_bound', detail: 'wrangler [ai] binding=AI 필요' }, 500);

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'bad_json' }, 400); }

  const b64 = body && body.audio;
  if (!b64) return json({ ok: false, error: 'no_audio' }, 400);

  let bytes;
  try { bytes = b64ToBytes(b64); }
  catch (_) { return json({ ok: false, error: 'bad_base64' }, 400); }
  if (!bytes.length) return json({ ok: false, error: 'empty_audio' }, 400);

  const language = (body.language || 'ko').slice(0, 8);

  // 1차: whisper-large-v3-turbo (base64 입력, 다국어·품질 우수)
  try {
    const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: b64,
      task: 'transcribe',
      language,
    });
    const text = (r && (r.text || r.transcription || '')) || '';
    return json({ ok: true, text: String(text).trim(), model: 'whisper-large-v3-turbo' });
  } catch (e1) {
    // 2차 폴백: whisper (바이트 배열 입력)
    try {
      const r = await env.AI.run('@cf/openai/whisper', { audio: [...bytes] });
      const text = (r && (r.text || '')) || '';
      return json({ ok: true, text: String(text).trim(), model: 'whisper', fallback: true });
    } catch (e2) {
      return json({ ok: false, error: 'whisper_failed', detail: String(e1).slice(0, 200) + ' | ' + String(e2).slice(0, 200) }, 502);
    }
  }
}
