/**
 * POST /api/dedup-store-contacts
 *   header: Authorization: Bearer <SYNC_SECRET>
 *   body(JSON): { dryRun?: boolean (기본 true), cap?: number }
 *
 * store.contacts[] 의 중복(특히 전화 없는 phoneless 연락처의 doubling 누적)을 일괄 정리.
 *
 * 배경(2026-06-12): additive-by-id 머지가 전화번호 없는 연락처(전체 99.5%)를 dedup 하지
 *   못해, 멀티 디바이스 sync 라운드마다 배열이 2배씩 증식 → 일부 매장 contacts 4,000+ 건,
 *   /api/stores 5.2MB(그 중 contacts 3.98MB). 머지 버그는 sync.js / app-01.js 의 fallbackKeys
 *   로 수정 → 이 endpoint 는 **이미 쌓인 KV 데이터**를 1회성으로 정리.
 *
 * dedup 키 = 전화 정규화(있으면) | 아니면 'c:'+이름+직책(정규화).
 *   같은 키의 중복은 1건으로 합본(빈 필드 보강 · earliest addedAt · latest updatedAt · primary 보존).
 *
 * ⚠ dryRun 기본 true — KV 변경하려면 명시적으로 { dryRun: false }.
 *
 * 안전한 배포 순서: ① sync.js 머지 수정 배포(재증식 차단) → ② 이 endpoint 실행.
 */

function _normPhone(p) { return String(p || '').replace(/\D/g, ''); }
function _normContent(v) { return String(v || '').trim().toLowerCase().replace(/\s+/g, ''); }

// 연락처 dedup 키 — 전화(있으면) 우선, 없으면 이름+직책 내용 키
function _contactKey(c) {
  const pk = _normPhone(c && c.phone);
  if (pk) return 'p:' + pk;
  const fk = _normContent(c && c.name) + '|' + _normContent(c && c.role);
  if (fk.replace(/\|/g, '')) return 'c:' + fk;
  return '';  // 이름·전화 둘 다 없음 — dedup 불가(드묾, 그대로 보존)
}

// 두 중복 연락처 합본 — base 에 빈 필드만 dup 으로 보강
function _mergeContact(base, dup) {
  const FIELDS = ['name', 'role', 'phone', 'email', 'address', 'sourceJobId', 'sourceJobType', 'addedBy'];
  for (const f of FIELDS) {
    if ((base[f] == null || base[f] === '') && dup[f] != null && dup[f] !== '') base[f] = dup[f];
  }
  if (dup.primary) base.primary = true;
  // earliest addedAt / latest updatedAt
  if (dup.addedAt && (!base.addedAt || String(dup.addedAt) < String(base.addedAt))) base.addedAt = dup.addedAt;
  if (dup.updatedAt && (!base.updatedAt || String(dup.updatedAt) > String(base.updatedAt))) base.updatedAt = dup.updatedAt;
  return base;
}

// 한 매장 contacts 정리 → { list, before, after }
function _dedupContacts(contacts, cap) {
  const before = contacts.length;
  const map = new Map();   // key -> merged contact
  const noKey = [];        // dedup 불가 항목 (보존)
  for (const c of contacts) {
    if (!c || typeof c !== 'object') continue;
    const k = _contactKey(c);
    if (!k) { noKey.push(c); continue; }
    if (map.has(k)) _mergeContact(map.get(k), c);
    else map.set(k, Object.assign({}, c));
  }
  let list = [...map.values(), ...noKey];
  // primary 정확히 1개 보장 (여러 개면 첫 번째만)
  let firstPri = -1;
  list.forEach((c, i) => { if (c.primary) { if (firstPri === -1) firstPri = i; else c.primary = false; } });
  // 선택 cap — dedup 후에도 많으면 상한 (addedAt 오름차순 우선 보존)
  if (cap && cap > 0 && list.length > cap) {
    list = list.slice().sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || ''))).slice(0, cap);
  }
  return { list, before, after: list.length };
}

export async function onRequestPost({ request, env }) {
  try { return await _run({ request, env }); }
  catch (err) {
    return json({ error: 'exception', message: String((err && err.message) || err), stack: String((err && err.stack) || '').slice(0, 1500) }, 500);
  }
}

async function _run({ request, env }) {
  if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);

  // 인증 (admin-delete.js 패턴 — SYNC_SECRET Bearer)
  const auth = request.headers.get('authorization') || '';
  if (!env.SYNC_SECRET || auth !== 'Bearer ' + String(env.SYNC_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const dryRun = body.dryRun !== false;   // ⚠ 기본 true
  const cap = Number(body.cap) || 0;

  const cur = (await env.STORES_KV.get('stores', 'json')) || { stores: [] };
  const isWrapped = !Array.isArray(cur);
  const stores = Array.isArray(cur) ? cur : (Array.isArray(cur.stores) ? cur.stores : []);

  let storesScanned = 0, storesAffected = 0;
  let contactsBefore = 0, contactsAfter = 0;
  const topReductions = [];   // 큰 정리 매장 (이름·PII 없이 카운트만)

  for (const s of stores) {
    if (!Array.isArray(s.contacts) || s.contacts.length === 0) continue;
    storesScanned++;
    const { list, before, after } = _dedupContacts(s.contacts, cap);
    contactsBefore += before;
    contactsAfter += after;
    if (after !== before) {
      storesAffected++;
      if (before - after >= 10) topReductions.push({ before, after, removed: before - after });
      if (!dryRun) s.contacts = list;
    }
  }
  topReductions.sort((a, b) => b.removed - a.removed);

  const bytesBefore = Buffer.byteLength(JSON.stringify(stores.map(s => s.contacts || [])), 'utf8');

  if (!dryRun && storesAffected > 0) {
    const serialized = isWrapped
      ? JSON.stringify(Object.assign({}, cur, { stores, meta: Object.assign({}, cur.meta, { syncedAt: new Date().toISOString(), count: stores.length }) }))
      : JSON.stringify(stores);
    if (serialized.length > 50_000_000) return json({ error: 'payload too large', size: serialized.length }, 413);
    await env.STORES_KV.put('stores', serialized);
  }

  return json({
    ok: true,
    dryRun,
    cap: cap || null,
    summary: {
      totalStores: stores.length,
      storesWithContacts: storesScanned,
      storesAffected,
      contactsBefore,
      contactsAfter,
      contactsRemoved: contactsBefore - contactsAfter,
      contactsBytesAfter: bytesBefore,   // dryRun 이면 변경 전, 실행이면 변경 후 contacts 바이트
    },
    topReductions: topReductions.slice(0, 15),
    note: dryRun ? 'KV NOT written (dryRun). 실행하려면 { "dryRun": false }' : 'stores KV updated',
  }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
