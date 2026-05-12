/**
 * LINE 파싱 골드 셋 — 직원 검토·승인된 분류 결과를 학습 데이터로 누적
 *
 *   GET  /api/line-gold
 *        → { items: [...], stats: { total, byCategory, ... }, firstAt, lastAt }
 *
 *   POST /api/line-gold
 *        Body: { input, output, source, approvedBy, approvedAt }
 *
 *   DELETE /api/line-gold?id=<id>     → 단일 삭제
 *   DELETE /api/line-gold?clear=1     → 전체 삭제 (Haiku 전환 후 정리용)
 *
 * 저장 키: line_gold_examples
 *   {
 *     items: [
 *       {
 *         id,                 // gold-<ts>-<rnd>
 *         input: {            // 모델 입력
 *           text,             // LINE 원문
 *           sender,           // 발신자
 *           time,             // 시각 (HH:MM)
 *           room,             // 채팅방 이름
 *         },
 *         output: {           // 검토자가 확정한 분류 결과 (정답)
 *           type,             // as_pos_van / open_store / van_doc / device_mgmt
 *           store,            // 매장명 (정확한 매장명)
 *           storeMatched,     // 매장이 등록 매장과 매칭되었는지
 *           status,           // 접수/진행중/추가처리/완료
 *           assignee,         // 담당자
 *           device,           // 장비/SN
 *           request,          // 요청·증상 요약
 *           parsed,           // 1줄 핵심 요약
 *         },
 *         meta: {
 *           originalCategory,   // Claude 가 처음 분류한 카테고리 (변경됐는지 추적)
 *           categoryChanged,    // 사용자가 카테고리 변경했는지
 *           reviewMemo,         // 검토자가 추가한 메모
 *         },
 *         approvedBy,         // 등록자 이메일
 *         approvedAt,         // 등록 시각 ISO
 *       }
 *     ],
 *     firstAt, lastAt,
 *   }
 *
 * 용도: 1개월 후 Haiku 전환 시 few-shot 예시로 사용 — 큐레이트 후 프롬프트에 포함
 */

const KEY = 'line_gold_examples';
const MAX_ITEMS = 5000;

export async function onRequestGet({ env }) {
  if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);
  const data = (await env.STORES_KV.get(KEY, 'json')) || { items: [] };
  const items = data.items || [];
  // 통계 계산
  const byCategory = {};
  let categoryChanged = 0, storeMatched = 0;
  for (const it of items) {
    const c = it.output?.type || '?';
    byCategory[c] = (byCategory[c] || 0) + 1;
    if (it.meta?.categoryChanged) categoryChanged++;
    if (it.output?.storeMatched) storeMatched++;
  }
  return json({
    items: items.slice(0, 200),  // 페이지당 200건만 응답
    stats: {
      total: items.length,
      byCategory,
      categoryChanged,
      storeMatched,
      firstAt: items.length ? items[items.length-1]?.approvedAt : null,
      lastAt:  items.length ? items[0]?.approvedAt : null,
    },
  }, 200);
}

export async function onRequestPost({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  let body;
  try { body = await request.json(); } catch(e){ return text('invalid json', 400); }

  const cur = (await env.STORES_KV.get(KEY, 'json')) || { items: [] };
  const id = `gold-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
  const newItem = {
    id,
    input: body.input || {},
    output: body.output || {},
    meta: body.meta || {},
    approvedBy: String(body.approvedBy || '').slice(0, 120),
    approvedAt: body.approvedAt || new Date().toISOString(),
  };
  cur.items = [newItem, ...(cur.items || [])].slice(0, MAX_ITEMS);
  await env.STORES_KV.put(KEY, JSON.stringify(cur));
  return json({ ok: true, id, total: cur.items.length }, 200);
}

export async function onRequestDelete({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const clear = url.searchParams.get('clear');
  const cur = (await env.STORES_KV.get(KEY, 'json')) || { items: [] };
  if (clear === '1') cur.items = [];
  else if (id) cur.items = (cur.items || []).filter(x => x.id !== id);
  else return text('id or clear required', 400);
  await env.STORES_KV.put(KEY, JSON.stringify(cur));
  return json({ ok: true, total: cur.items.length }, 200);
}

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function text(m, s) { return new Response(m, { status: s, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
