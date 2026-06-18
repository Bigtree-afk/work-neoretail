/**
 * POST /api/sync
 *   body: { stores: [...], source?: string }
 *
 * 점포 데이터 동기화 — **MERGE 방식** (전체 교체 X)
 *   - 기존 KV 매장의 패치된 필드(storeRegDate, ecountRegDate)는 보존
 *   - 클라이언트가 storeRegDate 를 명시적으로 보내면 그 값으로 갱신
 *   - 신규 매장은 추가, 기존 매장은 필드별 머지
 *   - KV 에만 있는 매장도 보존 (클라이언트 삭제는 별도 API)
 */

// ═══════════════════════════════════════════════════════════════════════
// 매장 필드 머지 정책 (Single Source of Truth — 클라이언트와 동일하게 유지)
// ───────────────────────────────────────────────────────────────────────
// 클라이언트 (index.html 의 STORE_FIELD_POLICY) 와 동일 의미.
// 변경 시 양쪽 모두 업데이트.
//
// 정책:
//   'kv-wins'              — KV 가 항상 우선
//   'prefer-non-empty'     — 비어있지 않은 쪽 우선, 둘 다 있으면 클라이언트
//   'additive-by-id'       — 인스턴스 추가 머지 (instanceId/phone)
//   'additive-time-sorted' — 시간순 정렬 합본
//   'aliases-union'        — set union
// 기본: 'prefer-non-empty' (호환 — 기존 동작과 동일하게 incoming 이 이김)
// ═══════════════════════════════════════════════════════════════════════
const STORE_FIELD_POLICY = {
  storeRegDate:   'kv-wins',
  ecountRegDate:  'kv-wins',
  equipment:      { type: 'additive-by-id', idKey: 'instanceId' },
  // contacts: phone(정규화) 기준 dedup. 전화 없는 연락처(직무상 대다수)는 fallbackKeys(이름+직책)로 dedup.
  //   ⚠ fallbackKeys 없으면 phoneless 가 머지마다 무한 doubling 됨(2026-06-12 사고).
  contacts:       { type: 'additive-by-id', idKey: 'phone', normalize: 'phone', fallbackKeys: ['name', 'role'] },
  contactsDeleted:'aliases-union',   // 삭제한 담당자 키 집합 — union 으로 동기화 부활 차단 (클라이언트와 동일)
  memos:          'additive-time-sorted',
  changeLog:      'additive-time-sorted',
  aliases:        'aliases-union',
  // per-field mtime — 필드별 편집 시각 맵(키별 max) / 매장 mtime(최신값). 클라이언트와 동일.
  fieldUpdatedAt: 'max-by-key',
  updatedAt:      'max-number',
};

function _isEmptyValue(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === 'object' && Object.keys(v).length === 0) return true;
  return false;
}
function _normPhone(p) { return String(p||'').replace(/\D/g,''); }
/* content dedup 키 — id(전화) 없는 인스턴스 fallback. 소문자+공백제거. */
function _normContent(v) { return String(v||'').trim().toLowerCase().replace(/\s+/g,''); }
/* per-field mtime 비교 시각 — fieldUpdatedAt 있으면 누락 키는 0(미편집), 없으면 매장 updatedAt fallback */
function _fieldTs(store, key) {
  if (store && store.fieldUpdatedAt && typeof store.fieldUpdatedAt === 'object') {
    return Number(store.fieldUpdatedAt[key]) || 0;
  }
  return Number(store && store.updatedAt) || 0;
}

function mergeStoreField(loc, rem, key) {
  const policy = STORE_FIELD_POLICY[key] || 'prefer-non-empty';
  const ptype = typeof policy === 'string' ? policy : policy.type;
  const lv = loc[key], rv = rem[key];

  switch (ptype) {
    case 'kv-wins':
      if (!_isEmptyValue(rv)) return rv;
      return lv;

    case 'max-number': {
      const mx = Math.max(Number(lv)||0, Number(rv)||0);
      return mx || undefined;
    }

    case 'max-by-key': {
      const lo = (lv && typeof lv === 'object') ? lv : {};
      const ro = (rv && typeof rv === 'object') ? rv : {};
      const out = {};
      new Set([...Object.keys(lo), ...Object.keys(ro)]).forEach(k => {
        out[k] = Math.max(Number(lo[k])||0, Number(ro[k])||0);
      });
      return Object.keys(out).length ? out : undefined;
    }

    case 'prefer-non-empty':
    default: {
      const le = _isEmptyValue(lv), re = _isEmptyValue(rv);
      if (le && re) return undefined;
      if (le)  return rv;
      if (re)  return lv;
      // 둘 다 값 있음 → per-field mtime (fieldUpdatedAt[key]). incoming(loc) 이 최신-또는-동률이면 incoming,
      //   stale 한 옛 push 면 KV(rem) 유지. 서로 다른 필드 동시편집 보존(#1). 레거시는 updatedAt fallback.
      const lts = _fieldTs(loc, key), rts = _fieldTs(rem, key);
      return lts >= rts ? lv : rv;
    }

    case 'additive-by-id': {
      const idKey = policy.idKey || 'id';
      const norm  = policy.normalize === 'phone' ? _normPhone : (x => x);
      const fbKeys = Array.isArray(policy.fallbackKeys) ? policy.fallbackKeys : null;
      const out = [];
      const seen = new Set();
      const push = (item) => {
        if (!item) return;
        const id = norm(item[idKey] || '');
        let dk = id ? ('id:' + id) : '';
        // id(전화) 없으면 fallbackKeys(이름+직책) 내용 키로 dedup → phoneless doubling 차단
        if (!dk && fbKeys) {
          const fk = fbKeys.map(k => _normContent(item[k])).join('|');
          if (fk.replace(/\|/g,'')) dk = 'c:' + fk;
        }
        if (dk) {
          if (seen.has(dk)) return;
          seen.add(dk);
        }
        out.push(item);
      };
      (Array.isArray(lv) ? lv : []).forEach(push);
      (Array.isArray(rv) ? rv : []).forEach(push);
      return out.length > 0 ? out : undefined;
    }

    case 'additive-time-sorted': {
      const merged = [...(Array.isArray(lv) ? lv : []), ...(Array.isArray(rv) ? rv : [])];
      const seen = new Set();
      const out = [];
      merged.sort((a,b) => String(b?.at||'').localeCompare(String(a?.at||''))).forEach(m => {
        const k = String(m?.at||'') + '|' + String(m?.text||m?.note||'').slice(0,60);
        if (seen.has(k)) return;
        seen.add(k);
        out.push(m);
      });
      return out.length > 0 ? out : undefined;
    }

    case 'aliases-union': {
      const set = new Set();
      (Array.isArray(lv) ? lv : []).forEach(a => { if (a) set.add(a); });
      (Array.isArray(rv) ? rv : []).forEach(a => { if (a) set.add(a); });
      return set.size > 0 ? [...set] : undefined;
    }
  }
}

function mergeStoreObjects(incoming, kvOld) {
  // 서버 머지에서는 incoming 이 'loc' 역할, kvOld 가 'rem' 역할 (이 함수 시그니처는 그렇게 호출됨)
  if (!kvOld) return incoming;
  if (!incoming) return kvOld;
  const out = {};
  const allKeys = new Set([...Object.keys(incoming), ...Object.keys(kvOld)]);
  for (const k of allKeys) {
    const v = mergeStoreField(incoming, kvOld, k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return text('KV not bound', 500);

  let body;
  try { body = await request.json(); }
  catch { return text('invalid json', 400); }

  const incoming = Array.isArray(body?.stores) ? body.stores : [];
  if (incoming.length > 50000) return text('too many stores', 413);

  // 기존 KV 데이터 로드 — cacheTtl:0 으로 PoP 캐시 우회 (다른 endpoint 의 최신 write 보기 위해)
  const cur = (await env.STORES_KV.get('stores', 'json')) || { stores: [] };
  const existingArr = Array.isArray(cur.stores) ? cur.stores : (Array.isArray(cur) ? cur : []);

  // id / biz / code 기준 인덱스
  const byId = new Map();
  const byBiz = new Map();
  const byCode = new Map();
  const normBiz = (b) => String(b||'').replace(/\D/g, '');
  for (const s of existingArr) {
    if (s.id) byId.set(s.id, s);
    const nb = normBiz(s.biz || s.bizno);
    if (nb && nb.length === 10) byBiz.set(nb, s);
    if (s.code) byCode.set(s.code, s);
  }

  // 머지: 각 incoming 매장에 대해 기존 KV 매장 찾기 + 정책 기반 머지
  let preservedCount = 0;   // 호환용 카운터 (legacy)
  const merged = incoming.map(inc => {
    const old = byId.get(inc.id)
              || byBiz.get(normBiz(inc.biz || inc.bizno))
              || byCode.get(inc.code);
    if (!old) return inc;
    const result = mergeStoreObjects(inc, old);
    preservedCount++;
    return result;
  });

  // KV 에만 있는 매장 보존 (클라이언트가 못 받아온 것일 수 있음 — 실수 삭제 방지)
  const incomingKeys = new Set();
  for (const s of incoming) {
    if (s.id) incomingKeys.add('id:' + s.id);
    const nb = normBiz(s.biz || s.bizno);
    if (nb && nb.length === 10) incomingKeys.add('biz:' + nb);
    if (s.code) incomingKeys.add('code:' + s.code);
  }
  let onlyInExisting = 0;
  for (const old of existingArr) {
    const keys = [];
    if (old.id) keys.push('id:' + old.id);
    const nb = normBiz(old.biz || old.bizno);
    if (nb && nb.length === 10) keys.push('biz:' + nb);
    if (old.code) keys.push('code:' + old.code);
    if (!keys.some(k => incomingKeys.has(k))) {
      merged.push(old);
      onlyInExisting++;
    }
  }

  // ⚠ Write-time re-read — 동시 patch 와의 race condition 방지
  // POST /api/sync 와 /api/stores-patch-ecount 가 거의 동시에 실행될 때,
  // 처음 읽은 cur 가 stale 이면 patch 결과를 덮어쓸 수 있음.
  // → KV 쓰기 직전에 다시 읽어, 그 사이 변경된 필드를 보존.
  const freshCur = await env.STORES_KV.get('stores', 'json');
  const freshArr = Array.isArray(freshCur?.stores) ? freshCur.stores
                  : (Array.isArray(freshCur) ? freshCur : null);
  if (freshArr && freshArr !== existingArr) {
    // 처음 읽은 시점과 비교해 변경된 매장이 있으면 정책 머지 재실행
    const freshById = new Map();
    const freshByBiz = new Map();
    for (const s of freshArr) {
      if (s.id) freshById.set(s.id, s);
      const nb = normBiz(s.biz || s.bizno);
      if (nb && nb.length === 10) freshByBiz.set(nb, s);
    }
    let raceCount = 0;
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      const fresh = freshById.get(m.id) || freshByBiz.get(normBiz(m.biz || m.bizno));
      if (fresh) {
        // fresh (지금 KV) 가 처음 read한 cur 와 다르면 patch 가 끼어든 것 → 재머지
        const original = byId.get(m.id) || byBiz.get(normBiz(m.biz || m.bizno));
        if (original && JSON.stringify(original) !== JSON.stringify(fresh)) {
          merged[i] = mergeStoreObjects(m, fresh);  // patch 결과 보존
          raceCount++;
        }
      }
    }
    if (raceCount > 0) {
      console.log(`[sync] race-merge: ${raceCount} stores re-merged with fresh KV`);
    }
  }

  // KV 저장
  if (Array.isArray(cur)) {
    await env.STORES_KV.put('stores', JSON.stringify(merged));
  } else {
    cur.stores = merged;
    cur.meta = cur.meta || {};
    cur.meta.syncedAt = new Date().toISOString();
    cur.meta.count = merged.length;
    cur.meta.source = String(body.source || 'manual');
    cur.meta.preservedCount = preservedCount;
    await env.STORES_KV.put('stores', JSON.stringify(cur));
  }
  await env.STORES_KV.put(
    'meta',
    JSON.stringify({
      syncedAt: new Date().toISOString(),
      count: merged.length,
      source: String(body.source || 'manual'),
      preservedFields: preservedCount,
      onlyInExisting,
    }),
  );

  return new Response(
    JSON.stringify({ ok: true, count: merged.length, preserved: preservedCount, onlyInExisting }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}

function text(msg, status) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain' } });
}
