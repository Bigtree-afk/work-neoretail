/**
 * LINE Messaging API 연동 설정 — 관리자 전용 (간단 토큰 보호)
 *
 *   GET  /api/line-config?admin=<ADMIN_PIN>
 *        → { channelAccessToken, channelSecret, parseSecret, claudeApiKey, roomMap }
 *
 *   POST /api/line-config?admin=<ADMIN_PIN>
 *        Body: { channelAccessToken?, channelSecret?, parseSecret?, claudeApiKey?, roomMap? }
 *
 * 저장 키: line_config
 *   {
 *     channelAccessToken : LINE Bot Channel Access Token (long-lived)
 *     channelSecret      : LINE Channel Secret — 웹훅 서명 검증용
 *     parseSecret        : /api/line-parse-cron 호출 보호용 (Bearer 토큰)
 *     claudeApiKey       : 서버측 파싱에서 사용할 Claude API key (선택)
 *     roomMap            : { "<lineGroupId>": { name, type } }
 *   }
 *
 * Note: ADMIN_PIN 은 환경변수에서 검사하는 게 이상적이지만, 우선 KV 의 admin_pin 키와 비교.
 *       관리자 페이지에서 PIN 을 설정해 두고, 해당 페이지에서만 이 API 를 호출하게 됨.
 */

const KV_KEY = 'line_config';

async function checkAdmin(env, request) {
  const url = new URL(request.url);
  const pin = url.searchParams.get('admin') || '';
  const storedPin = await env.STORES_KV.get('admin_pin');
  // 처음 사용 시 PIN 이 비어있으면 누구나 설정 가능 (최초 1회 자기보호 단계)
  if (!storedPin) return true;
  return pin && pin === storedPin;
}

export async function onRequestGet({ env, request }) {
  if (!env.STORES_KV) return json({ error:'KV not bound' }, 500);
  if (!await checkAdmin(env, request)) return json({ error:'unauthorized' }, 401);
  const cfg = (await env.STORES_KV.get(KV_KEY, 'json')) || {};
  // 민감값은 마스킹해서 반환 (전체값은 클라에 다시 안 줌)
  const mask = (s) => !s ? '' : (s.length > 12 ? s.slice(0,4)+'…'+s.slice(-4) : '***');
  return json({
    channelAccessToken: mask(cfg.channelAccessToken),
    channelSecret:      mask(cfg.channelSecret),
    parseSecret:        mask(cfg.parseSecret),
    claudeApiKey:       mask(cfg.claudeApiKey),
    roomMap:            cfg.roomMap || {},
    hasToken:           !!cfg.channelAccessToken,
    hasSecret:          !!cfg.channelSecret,
    hasParseSecret:     !!cfg.parseSecret,
    hasClaudeKey:       !!cfg.claudeApiKey,
  }, 200);
}

export async function onRequestPost({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  if (!await checkAdmin(env, request)) return text('unauthorized', 401);
  let body;
  try { body = await request.json(); } catch(e){ return text('invalid json', 400); }
  const cur = (await env.STORES_KV.get(KV_KEY, 'json')) || {};
  const keys = ['channelAccessToken', 'channelSecret', 'parseSecret', 'claudeApiKey', 'roomMap'];
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') cur[k] = body[k];
  }
  await env.STORES_KV.put(KV_KEY, JSON.stringify(cur));
  return json({ ok:true }, 200);
}

/* admin PIN 설정/변경 — 별도 엔드포인트가 더 깔끔하지만 같은 파일에 묶음 */
export async function onRequestPut({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  if (!await checkAdmin(env, request)) return text('unauthorized', 401);
  let body;
  try { body = await request.json(); } catch(e){ return text('invalid json', 400); }
  if (body.newAdminPin) {
    await env.STORES_KV.put('admin_pin', String(body.newAdminPin));
    return json({ ok:true, msg:'PIN updated' }, 200);
  }
  return json({ ok:false, msg:'no change' }, 200);
}

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});}
function text(m,s){return new Response(m,{status:s,headers:{'content-type':'text/plain; charset=utf-8'}});}
