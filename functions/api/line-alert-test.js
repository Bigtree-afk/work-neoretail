/**
 * 알림 수신자 테스트 발송 — POST /api/line-alert-test?admin=<PIN>
 *
 * 동작: line_config.alertRecipientId 로 테스트 LINE 메시지 push
 */

const CFG_KEY = 'line_config';

export async function onRequestPost({ env, request }) {
  if (!env.STORES_KV) return json({ error:'KV not bound' }, 500);
  // admin PIN 체크
  const url = new URL(request.url);
  const pin = url.searchParams.get('admin') || '';
  const storedPin = await env.STORES_KV.get('admin_pin');
  if (storedPin && pin !== storedPin) return json({ error:'unauthorized' }, 401);

  const cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {};
  if (!cfg.alertRecipientId) return json({ ok:false, error:'알림 수신자가 설정되지 않았습니다 — 저장 후 다시 시도' }, 400);
  if (!cfg.channelAccessToken) return json({ ok:false, error:'Channel Access Token 이 설정되지 않았습니다' }, 400);

  const text = `✅ [NeoRetail 테스트 알림]
파싱 실패 알림이 정상적으로 이 채팅방으로 발송됩니다.

발송 시각: ${new Date(Date.now()+9*3600*1000).toISOString().slice(0,19).replace('T',' ')} (KST)
수신자: ${cfg.alertRecipientName || '(이름 없음)'}

실제 알림 발송 조건:
• Claude 파싱 ${3}회 재시도 실패한 메시지 발생
• Claude API 키 누락
• 메시지 100건 이상 적체`;

  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method:'POST',
      headers:{
        'authorization': `Bearer ${cfg.channelAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: cfg.alertRecipientId,
        messages: [{ type:'text', text }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(()=>'');
      return json({ ok:false, status:r.status, error:errText.slice(0,400) }, 200);
    }
    return json({ ok:true, sentTo: cfg.alertRecipientName || cfg.alertRecipientId.slice(0,16)+'…' }, 200);
  } catch(e) {
    return json({ ok:false, error:e.message }, 500);
  }
}

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
