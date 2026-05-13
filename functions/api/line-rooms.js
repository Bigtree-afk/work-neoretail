/**
 * LINE 수신 채팅방 매핑
 *
 *   GET  /api/line-rooms
 *        → {
 *            rooms: [
 *              { id, name, type, roomType, msgCount, lastSender, lastText, lastTs, mapped }
 *            ]
 *          }
 *        roomType: 'user' | 'group' | 'room' | ''   (LINE 원본 채팅 종류)
 *        type:     'as'   | 'schedule' | 'work' | 'general'   (사이트 분류 — 사용자 지정)
 *        mapped:   true 면 roomMap 에 등록된 채팅방
 *
 *   PUT  /api/line-rooms
 *        Body: { id, name?, type? }
 *        → roomMap[id] = { name, type } 저장
 *
 *   DELETE /api/line-rooms?id=<id>
 *        → roomMap 에서 매핑 제거 (수신은 계속 됨)
 */

const RAW_KEY = 'line_raw_queue';
const CFG_KEY = 'line_config';

export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ error:'KV not bound' }, 500);
  const cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {};
  const roomMap = cfg.roomMap || {};
  const queue = (await env.STORES_KV.get(RAW_KEY, 'json')) || { items: [] };

  // 큐에서 채팅방 통계 집계
  const stats = new Map();
  for (const m of queue.items || []) {
    if (!m.room) continue;
    const cur = stats.get(m.room) || { id: m.room, roomType: m.roomType || '', msgCount: 0 };
    cur.msgCount++;
    if (!cur.lastTs || (m.ts||0) > cur.lastTs) {
      cur.lastTs = m.ts || 0;
      cur.lastSender = m.sender || '';
      cur.lastText = (m.text||'').slice(0, 60);
    }
    stats.set(m.room, cur);
  }

  // roomMap 도 합쳐서 — 큐에 메시지 없어도 매핑된 채팅방은 노출
  for (const [id, info] of Object.entries(roomMap)) {
    if (!stats.has(id)) {
      stats.set(id, { id, roomType:'', msgCount:0 });
    }
  }

  // 결과 빌드
  const rooms = Array.from(stats.values()).map(r => {
    const info = roomMap[r.id] || {};
    return {
      ...r,
      name:      info.name || '',
      type:      info.type || '',
      parseMode: info.parseMode || (info.type ? 'mixed' : ''),  // 기존 매핑 호환
      mapped:    !!roomMap[r.id],
    };
  });
  // 최근 메시지순 정렬 (매핑 안 된 게 위로)
  rooms.sort((a,b) => (b.lastTs||0) - (a.lastTs||0));

  return json({ rooms }, 200);
}

export async function onRequestPut({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  let body;
  try { body = await request.json(); } catch(e) { return text('invalid json', 400); }
  const id = String(body.id || '').trim();
  if (!id) return text('id required', 400);

  const cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {};
  cfg.roomMap = cfg.roomMap || {};
  const type = String(body.type || 'general');
  const FIXED_TYPES = ['equip_out','delivery','label'];
  const inferredMode = FIXED_TYPES.includes(type) ? 'fixed' : 'mixed';
  cfg.roomMap[id] = {
    name:      String(body.name || '').slice(0, 100),
    type,
    parseMode: String(body.parseMode || inferredMode),
  };
  await env.STORES_KV.put(CFG_KEY, JSON.stringify(cfg));
  return json({ ok:true, room: { id, ...cfg.roomMap[id] } }, 200);
}

export async function onRequestDelete({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return text('id required', 400);
  const cfg = (await env.STORES_KV.get(CFG_KEY, 'json')) || {};
  if (cfg.roomMap && cfg.roomMap[id]) {
    delete cfg.roomMap[id];
    await env.STORES_KV.put(CFG_KEY, JSON.stringify(cfg));
  }
  return json({ ok:true }, 200);
}

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*'}});}
function text(m,s){return new Response(m,{status:s,headers:{'content-type':'text/plain; charset=utf-8'}});}
