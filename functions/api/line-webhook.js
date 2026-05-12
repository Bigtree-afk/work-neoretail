/**
 * LINE Messaging API Webhook
 *
 *   POST /api/line-webhook
 *   Header: x-line-signature   ← LINE 서버 서명 (HMAC-SHA256 with channelSecret)
 *   Body  : { destination, events: [ { type, source:{type,groupId,userId}, message:{text,...}, timestamp, ... } ] }
 *
 * 동작:
 *   1) 서명 검증 (channelSecret 으로 본문 HMAC-SHA256, base64 비교)
 *   2) 메시지 이벤트만 추출 (text 위주)
 *   3) KV 큐 'line_raw_queue' 에 push — 1시간마다 line-parse-cron 이 소비
 *
 * 큐 항목:
 *   { id, ts, room, sender, text, raw }
 */

const QUEUE_KEY     = 'line_raw_queue';
const QUEUE_MAX     = 5000;
const PROFILE_CACHE = 'line_profile_cache';   // userId → displayName 캐시

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return new Response('KV not bound', { status: 500 });

  const cfg = (await env.STORES_KV.get('line_config', 'json')) || {};
  const secret = cfg.channelSecret;
  if (!secret) return new Response('config missing', { status: 503 });

  const bodyText = await request.text();
  const sig = request.headers.get('x-line-signature') || '';
  const ok = await verifySignature(secret, bodyText, sig);
  if (!ok) return new Response('invalid signature', { status: 401 });

  let payload;
  try { payload = JSON.parse(bodyText); } catch(e) { return new Response('bad json', { status: 400 }); }
  const events = Array.isArray(payload.events) ? payload.events : [];

  const cur = (await env.STORES_KV.get(QUEUE_KEY, 'json')) || { items: [] };
  const profCache = (await env.STORES_KV.get(PROFILE_CACHE, 'json')) || {};
  let added = 0;
  let profileDirty = false;

  for (const ev of events) {
    if (ev.type !== 'message') continue;
    const msg = ev.message || {};
    if (msg.type !== 'text') continue;   // 1차: 텍스트만 (이미지/파일은 나중에)
    const src = ev.source || {};
    const room = src.groupId || src.roomId || src.userId || 'unknown';
    const userId = src.userId || '';

    // 프로필 캐시 (그룹 멤버 표시명 조회 — 채널 토큰 필요)
    let senderName = profCache[userId] || '';
    if (!senderName && userId && cfg.channelAccessToken) {
      try {
        const path = src.groupId
          ? `https://api.line.me/v2/bot/group/${encodeURIComponent(src.groupId)}/member/${encodeURIComponent(userId)}`
          : `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`;
        const r = await fetch(path, { headers: { 'authorization': 'Bearer ' + cfg.channelAccessToken } });
        if (r.ok) {
          const p = await r.json();
          senderName = p.displayName || '';
          if (senderName) { profCache[userId] = senderName; profileDirty = true; }
        }
      } catch(e) { /* skip */ }
    }

    cur.items.push({
      id:     ev.webhookEventId || `${ev.timestamp}-${msg.id||Math.random().toString(36).slice(2,6)}`,
      ts:     ev.timestamp || Date.now(),
      room,
      roomType: src.type || '',
      userId,
      sender: senderName || '',
      text:   msg.text || '',
      raw:    { srcType: src.type, msgId: msg.id },
    });
    added++;
  }
  if (cur.items.length > QUEUE_MAX) cur.items = cur.items.slice(-QUEUE_MAX);

  if (added > 0) await env.STORES_KV.put(QUEUE_KEY, JSON.stringify(cur));
  if (profileDirty) await env.STORES_KV.put(PROFILE_CACHE, JSON.stringify(profCache));

  // LINE 은 200 OK 만 받으면 OK (응답 본문은 안 봄)
  return new Response('OK', { status: 200 });
}

/* LINE 서명 검증 — HMAC-SHA256(channelSecret, requestBody) → Base64 == x-line-signature */
async function verifySignature(secret, bodyText, sigHeader) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(bodyText));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return b64 === sigHeader;
  } catch(e) { return false; }
}

/* GET 은 LINE 측 헬스체크 / 디버그용 */
export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  if (url.searchParams.get('peek')) {
    if (!env.STORES_KV) return new Response('KV not bound', { status:500 });
    const cur = (await env.STORES_KV.get(QUEUE_KEY, 'json')) || { items: [] };
    return new Response(JSON.stringify({ queueLen: cur.items.length, lastN: cur.items.slice(-5) }), {
      status:200, headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }
    });
  }
  return new Response('LINE webhook endpoint ready', { status: 200 });
}
