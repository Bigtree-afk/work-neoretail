/**
 * 매장 데이터 헬스 / 동기화 진단 endpoint
 *
 *   GET /api/sync-diagnostics
 *   GET /api/sync-diagnostics?store=<name>   — 특정 매장만
 *
 * 반환:
 *   - 매장 데이터 shape (bare array vs {stores, meta})
 *   - 빈 배열 필드 카운트 (equipment=[], contacts=[] 등 — 동기화 충돌 원인)
 *   - 정책별 필드 카운트
 *   - 최근 동기화 메타
 *   - 특정 매장 조회시: 모든 필드 + 정책 + 마지막 변경 시각
 */

export async function onRequestGet({ env, request }) {
  if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);
  const url = new URL(request.url);
  const storeQ = url.searchParams.get('store');

  const raw = await env.STORES_KV.get('stores', 'json');
  const meta = (await env.STORES_KV.get('meta', 'json')) || {};
  let shape = 'unknown', stores = [];
  if (Array.isArray(raw)) { shape = 'bare-array'; stores = raw; }
  else if (raw && Array.isArray(raw.stores)) { shape = 'wrapped {stores, meta}'; stores = raw.stores; }
  else { shape = 'invalid'; stores = []; }

  if (storeQ) {
    // 특정 매장 조회
    const norm = s => String(s||'').toLowerCase().replace(/\s+/g,'');
    const target = stores.find(s =>
      norm(s.storeName || s.name) === norm(storeQ) ||
      (s.storeName || s.name || '').includes(storeQ) ||
      s.id === storeQ || s.biz === storeQ
    );
    if (!target) return json({ ok:true, found:false, query:storeQ });
    // 필드 + 값 요약
    const fields = {};
    Object.keys(target).forEach(k => {
      const v = target[k];
      if (Array.isArray(v)) fields[k] = `[Array ${v.length}]`;
      else if (typeof v === 'object' && v !== null) fields[k] = `{Object ${Object.keys(v).length}}`;
      else if (typeof v === 'string') fields[k] = v.length > 60 ? v.slice(0,60)+'...' : v;
      else fields[k] = v;
    });
    return json({
      ok: true,
      found: true,
      store: { id: target.id, name: target.storeName || target.name, biz: target.biz },
      fields,
      arrays: {
        equipment: (target.equipment || []).length,
        contacts: (target.contacts || []).length,
        memos: (target.memos || []).length,
        aliases: (target.aliases || []).length,
        changeLog: (target.changeLog || []).length,
      },
    });
  }

  // 전체 헬스 진단
  let withEquipment = 0, withContacts = 0, withMemos = 0, withAliases = 0;
  let emptyEquipment = 0, emptyContacts = 0;
  let totalEquipInstances = 0, totalContactsInstances = 0;
  let autoCreated = 0;
  const fieldCount = {};
  for (const s of stores) {
    Object.keys(s).forEach(k => { fieldCount[k] = (fieldCount[k] || 0) + 1; });
    if (s.equipment) {
      if (Array.isArray(s.equipment) && s.equipment.length > 0) {
        withEquipment++;
        totalEquipInstances += s.equipment.length;
      } else emptyEquipment++;
    }
    if (s.contacts) {
      if (Array.isArray(s.contacts) && s.contacts.length > 0) {
        withContacts++;
        totalContactsInstances += s.contacts.length;
      } else emptyContacts++;
    }
    if (Array.isArray(s.memos) && s.memos.length > 0) withMemos++;
    if (Array.isArray(s.aliases) && s.aliases.length > 0) withAliases++;
    if (s.autoCreated) autoCreated++;
  }

  return json({
    ok: true,
    kv: {
      shape,
      storesCount: stores.length,
      meta,
    },
    health: {
      withEquipment,
      emptyEquipment,
      totalEquipInstances,
      withContacts,
      emptyContacts,
      totalContactsInstances,
      withMemos,
      withAliases,
      autoCreatedStubs: autoCreated,
    },
    topFields: Object.entries(fieldCount).sort((a,b) => b[1]-a[1]).slice(0, 30),
    hint: emptyEquipment > 0
      ? `⚠ ${emptyEquipment} 매장에 equipment:[] (빈배열) — 동기화 충돌 원인. /api/migrate-store-equipment 로 정상화 가능`
      : '✅ 빈 배열 필드 없음',
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
