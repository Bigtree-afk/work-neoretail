/**
 * Line 메시지 파싱 결과 — 업무 등록 대기열
 *
 *   GET    /api/line-pending             → { items: [...] }
 *   POST   /api/line-pending             → bulk add { items: [...] }
 *   PUT    /api/line-pending?id=<id>     → patch single item { ...fields }
 *   DELETE /api/line-pending?id=<id>     → remove single (reject/registered)
 *   DELETE /api/line-pending?clear=1     → clear all
 *
 * 저장: KV 키 "line_pending"
 *   { items: [
 *       {
 *         id,                    // 고유 ID (pend-<ts>-<rnd>)
 *         lineMsgAt,             // 라인 메시지 시각 (ISO, 등록 시 createdAt 이 됨)
 *         lineSender,            // 라인 발신자
 *         lineRoom,              // 라인 채팅방 ID
 *         lineCategory,          // as_pos_van | open_store | van_doc | device_mgmt
 *         lineRaw,               // 원문
 *         lineParsed,            // 파싱 요약
 *         store,                 // 추정 매장명
 *         storeId,               // 연결된 매장 ID (있을 때)
 *         assignee,              // 담당자 (메시지에서 추출 → 검토에서 수정 가능)
 *         status,                // 접수 | 진행중 | 추가처리 | 완료
 *         memo,                  // 검토자가 추가한 메모
 *         action,                // new | update
 *         targetJobId,           // update 시 대상 job
 *         reviewedBy,            // 마지막 수정자 (이메일)
 *         reviewedAt,            // 마지막 수정 시각
 *         createdAtSrv,          // 큐 등록 시각
 *       }
 *     ]
 *   }
 */

const KV_KEY    = 'line_pending';
const MAX_ITEMS = 500;

export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);
  const data = (await env.STORES_KV.get(KV_KEY, 'json')) || { items: [] };
  return json(data, 200);
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  let body;
  try { body = await request.json(); } catch(e) { return text('invalid json', 400); }
  const incoming = Array.isArray(body.items) ? body.items : [];
  if (!incoming.length) return json({ ok: true, added: 0 }, 200);

  const cur = (await env.STORES_KV.get(KV_KEY, 'json')) || { items: [] };
  const existingIds = new Set((cur.items || []).map(i => i.id));
  const now = new Date().toISOString();

  const toAdd = incoming
    .filter(it => it && it.id && !existingIds.has(it.id))
    .map(it => ({
      ...it,
      createdAtSrv: it.createdAtSrv || now,
    }));

  cur.items = [...toAdd, ...(cur.items || [])].slice(0, MAX_ITEMS);
  await env.STORES_KV.put(KV_KEY, JSON.stringify(cur));
  return json({ ok: true, added: toAdd.length, total: cur.items.length }, 200);
}

export async function onRequestPut({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url = new URL(request.url);
  const id  = url.searchParams.get('id');
  if (!id) return text('id required', 400);

  let patch;
  try { patch = await request.json(); } catch(e) { return text('invalid json', 400); }

  const cur = (await env.STORES_KV.get(KV_KEY, 'json')) || { items: [] };
  const idx = (cur.items || []).findIndex(x => x.id === id);
  if (idx < 0) return json({ error: 'not found', id }, 404);

  cur.items[idx] = {
    ...cur.items[idx],
    ...patch,
    id,
    reviewedAt: new Date().toISOString(),
  };
  await env.STORES_KV.put(KV_KEY, JSON.stringify(cur));
  return json({ ok: true, item: cur.items[idx] }, 200);
}

export async function onRequestDelete({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url   = new URL(request.url);
  const id    = url.searchParams.get('id');
  const clear = url.searchParams.get('clear');

  const cur = (await env.STORES_KV.get(KV_KEY, 'json')) || { items: [] };
  if (clear === '1' || clear === 'true') {
    cur.items = [];
  } else if (id) {
    cur.items = (cur.items || []).filter(x => x.id !== id);
  } else {
    return text('id or clear required', 400);
  }
  await env.STORES_KV.put(KV_KEY, JSON.stringify(cur));
  return json({ ok: true, total: cur.items.length }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
function text(msg, status) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
