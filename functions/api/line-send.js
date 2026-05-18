/**
 * LINE 메시지 발송 — 사이트에서 LINE 으로 메시지 전송
 *
 *   POST /api/line-send
 *     body: {
 *       text:     '매장명 : 처리일 ; 요청내용',  (필수, ≤200자 권장)
 *       category: 'stocktake' | 'as' | 'newjob' | 'van' | 'supply' | 'memo',
 *       to:       '<lineRoomId>'  (선택 — 미지정 시 category 별 기본 채팅방)
 *       images:   [{ url, name? }, ...]  (선택, 공개 HTTPS URL — R2 public)
 *       files:    [{ url, name }, ...]   (선택 — LINE File Message 미지원, URL 텍스트로 동봉)
 *       jobId:    'JOB-xxx' (선택, 메타용)
 *     }
 *
 *   응답: { ok, sentTo, messageIds, skipped? }
 *
 *   self-echo 차단:
 *     발송 직전 sha256(roomId + ':' + text).slice(0,16) 를 KV 에 저장 (TTL 600s)
 *     → line-webhook 수신 시 동일 해시 hit 이면 self-echo 로 마킹 (별도 작업 필요)
 *
 *   목적지 결정 우선순위:
 *     1) body.to 직접 지정
 *     2) cfg.categoryRooms[category]
 *     3) cfg.alertRecipientId (fallback)
 */

const CFG_KEY = 'line_config';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return json({ ok:false, error:'KV not bound' }, 500);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok:false, error:'invalid_json' }, 400); }

  const text = String(body?.text || '').trim();
  const category = String(body?.category || '').trim();
  if (!text) return json({ ok:false, error:'text_required' }, 400);

  const cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {};
  if (!cfg.channelAccessToken) {
    return json({ ok:false, error:'no_channel_token', detail:'관리자 페이지에서 Channel Access Token 설정 필요' }, 400);
  }

  // 목적지 결정
  let to = String(body?.to || '').trim();
  if (!to && category && cfg.categoryRooms && cfg.categoryRooms[category]) {
    to = cfg.categoryRooms[category];
  }
  if (!to) to = cfg.alertRecipientId || '';
  if (!to) {
    return json({ ok:false, error:'no_recipient', detail:`category=${category} 의 기본 채팅방이 설정되지 않았습니다` }, 400);
  }

  // 메시지 빌드 (LINE 은 한 요청에 최대 5개 메시지)
  const messages = [];

  // 1) 텍스트 본문 — 파일 링크는 텍스트에 동봉
  let mainText = text;
  if (Array.isArray(body.files) && body.files.length) {
    mainText += '\n\n📎 파일:';
    body.files.forEach(f => {
      if (f && f.url) mainText += `\n· ${f.name || ''} ${f.url}`;
    });
  }
  messages.push({ type:'text', text: mainText.slice(0, 4900) });

  // 2) 이미지 메시지 (LINE 최대 5개 - 1 텍스트 = 4개 이미지)
  if (Array.isArray(body.images)) {
    const imgs = body.images.filter(i => i && i.url && /^https:/i.test(i.url)).slice(0, 4);
    imgs.forEach(img => {
      messages.push({
        type: 'image',
        originalContentUrl: img.url,
        previewImageUrl: img.url,
      });
    });
  }

  // self-echo 차단 — 발송 텍스트 해시를 KV 에 저장 (TTL 10분)
  try {
    const hashHex = await sha256Hex(`${to}:${text}`);
    const seKey = 'se_' + hashHex.slice(0, 16);
    // 한 번에 여러 메시지 발송 시 첫 텍스트만 해시 등록 (수신 시 사용자가 첫 줄로 판단)
    await env.STORES_KV.put(seKey, '1', { expirationTtl: 600 });
  } catch(e) { /* 해시 실패해도 발송은 계속 */ }

  // LINE Push 발송
  try {
    const r = await fetch(LINE_PUSH_URL, {
      method:'POST',
      headers:{
        'authorization': `Bearer ${cfg.channelAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ to, messages }),
    });
    if (!r.ok) {
      let detail = ''; try { detail = await r.text(); } catch(_){}
      return json({ ok:false, status:r.status, error:'line_api_failed', detail: detail.slice(0,400) }, 200);
    }
    return json({ ok:true, sentTo: to.slice(0,12)+'…', count: messages.length }, 200);
  } catch(e) {
    return json({ ok:false, error:'fetch_failed', detail: String(e) }, 500);
  }
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});}
