/**
 * 재고조사(stocktake) — 클라우드 정본(cloud-native, 레코드 단위)
 *
 *   GET  /api/stocktake            → { records:[...], deleted:[...], updatedAt }
 *   POST /api/stocktake            → body { records:[...], deletedIds:[...] }
 *        - records  : upsert(레코드 단위, mtime 비교). 보낸 것만 반영, 안 보낸 것 유지(omission≠삭제)
 *        - deletedIds: 제거 + deleted_stocktake 레지스트리 등록(부활 차단)
 *        → { ok, count, added, replaced, kept, removed, records:[...merged] }
 *
 * 저장:
 *   KV 'stocktake'         = { records:[...], updatedAt: ISO }
 *   KV 'deleted_stocktake' = [{ id, deletedAt, reason }]
 *
 * 작업(jobs) 과 달리 "localStorage 원본 + 머지" 가 아니라 클라우드가 진실.
 * 클라이언트는 레코드 1건씩만 보내고(전체 덮어쓰기 없음) 서버가 병합 → 동시편집 안전.
 */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-expose-headers': 'ETag',
    },
  });
}

function _etagHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}

// mtime → epoch ms (updatedAt/lastEditedAt/createdAt, ISO·숫자 문자열·숫자 모두 처리)
function mtimeMs(r) {
  const v = (r && (r.updatedAt ?? r.lastEditedAt ?? r.createdAt));
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/^\d+$/.test(s)) return Number(s);
  const p = Date.parse(s);
  return Number.isFinite(p) ? p : 0;
}

async function safeGetJson(env, key, fallback) {
  try {
    const v = await env.STORES_KV.get(key, 'json');
    return v == null ? fallback : v;
  } catch (e) {
    try {
      const raw = await env.STORES_KV.get(key);
      if (!raw) return fallback;
      const cleaned = raw.replace(/^﻿/, '').trim();
      return cleaned ? JSON.parse(cleaned) : fallback;
    } catch (_) { return fallback; }
  }
}

export async function onRequestOptions() { return json({}, 204); }

export async function onRequestGet({ request, env }) {
  if (!env.STORES_KV) return json({ records: [], deleted: [], error: 'KV not bound' }, 200);
  const data = await safeGetJson(env, 'stocktake', { records: [] });
  const records = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : []);
  const deleted = await safeGetJson(env, 'deleted_stocktake', []);
  const out = { records, deleted: Array.isArray(deleted) ? deleted : [], updatedAt: (data && data.updatedAt) || '' };
  const bodyStr = JSON.stringify(out);
  const etag = '"' + _etagHash(bodyStr) + '"';
  if (request && request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: {
      'cache-control': 'no-store', 'access-control-allow-origin': '*',
      'access-control-expose-headers': 'ETag', 'etag': etag } });
  }
  return new Response(bodyStr, { status: 200, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag', 'etag': etag } });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);
    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'invalid_json', detail: String(e) }, 400); }

    const incoming = Array.isArray(body?.records) ? body.records : [];
    const delIdsIn = Array.isArray(body?.deletedIds) ? body.deletedIds.map(String).filter(Boolean) : [];
    if (incoming.length > 5000) return json({ error: 'too_many', count: incoming.length }, 413);

    // 삭제 레지스트리 로드
    let delReg = await safeGetJson(env, 'deleted_stocktake', []);
    if (!Array.isArray(delReg)) delReg = [];
    const deletedIds = new Set(delReg.filter(e => e && e.id).map(e => String(e.id)));

    // 신규 삭제 등록
    let newDeletes = 0;
    for (const id of delIdsIn) {
      if (!deletedIds.has(id)) {
        deletedIds.add(id);
        delReg.push({ id, deletedAt: new Date().toISOString(), reason: 'client-delete' });
        newDeletes++;
      }
    }

    // 기존 records
    const existing = await safeGetJson(env, 'stocktake', { records: [] });
    const existingArr = Array.isArray(existing) ? existing : (Array.isArray(existing.records) ? existing.records : []);
    const byId = new Map();
    for (const r of existingArr) {
      if (r && r.id && !deletedIds.has(String(r.id))) byId.set(String(r.id), r);
    }

    // upsert incoming (mtime 비교, 삭제된 id 는 부활 차단)
    let added = 0, replaced = 0, kept = 0, blocked = 0;
    for (const inc of incoming) {
      if (!inc || typeof inc !== 'object' || !inc.id) continue;
      const id = String(inc.id);
      if (deletedIds.has(id)) { blocked++; continue; }   // 부활 차단
      const ex = byId.get(id);
      if (!ex) { byId.set(id, inc); added++; continue; }
      const exMt = mtimeMs(ex), inMt = mtimeMs(inc);
      if (!exMt || inMt > exMt) { byId.set(id, inc); replaced++; }
      else if (inMt === exMt && JSON.stringify(ex) !== JSON.stringify(inc)) { byId.set(id, inc); replaced++; }
      else kept++;
    }

    const merged = [...byId.values()];
    // 저장 (records 변경 or 신규삭제가 있을 때만 write)
    if (added || replaced || newDeletes || delIdsIn.length) {
      await env.STORES_KV.put('stocktake', JSON.stringify({ records: merged, updatedAt: new Date().toISOString() }));
    }
    if (newDeletes) {
      await env.STORES_KV.put('deleted_stocktake', JSON.stringify(delReg));
    }

    return json({ ok: true, count: merged.length, added, replaced, kept, removed: newDeletes, blocked, records: merged, deleted: delReg }, 200);
  } catch (e) {
    return json({ error: 'handler_exception', detail: String(e), stack: e?.stack || '' }, 500);
  }
}
