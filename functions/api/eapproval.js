/**
 * 전자결재 (eApproval) — 클라우드 동기화
 *
 *   GET  /api/eapproval        → { docs:[...], config:{...}, deleted:[ids], resyncToken }
 *   POST /api/eapproval        → 머지 저장 (토큰 불필요 — jobs.js 와 동일 정책)
 *      body: {
 *        docs?:    [...],          // per-doc merge by updatedAt (ms)
 *        config?:  { tpl, routes, birth, leave, lineMap },  // 키별 last-write-wins
 *        tombstones?: [docId, ...] // 삭제 등록 (부활 차단)
 *      }
 *
 * 저장 위치 (STORES_KV):
 *   eapproval_docs    = { docs:[...], updatedAt:ISO }
 *   eapproval_config  = { tpl:[], routes:{}, birth:{}, leave:{}, lineMap:{}, updatedAt:ISO }
 *   eapproval_deleted = [ { id, deletedAt, reason }, ... ]
 *
 * 설계: jobs.js 의 per-job mtime 머지 + deleted 레지스트리 부활차단을 그대로 미러링.
 *   - 클라이언트가 보낸 doc 중 KV 가 더 최신(updatedAt)이면 KV 유지 (stale push 차단)
 *   - 클라이언트가 보내지 않은 cloud doc 은 그대로 유지 (omission ≠ 삭제)
 */

const DOCS_KEY = 'eapproval_docs';
const CFG_KEY = 'eapproval_config';
const DEL_KEY = 'eapproval_deleted';
const FUND_KEY = 'eapproval_fund';

export async function onRequestGet({ request, env }) {
  if (!env.STORES_KV) return json({ docs: [], config: {}, error: 'KV not bound' }, 200);
  const docsRaw = await safeGetJson(env, DOCS_KEY, { docs: [] });
  const docs = Array.isArray(docsRaw) ? docsRaw : (Array.isArray(docsRaw?.docs) ? docsRaw.docs : []);
  const config = (await safeGetJson(env, CFG_KEY, {})) || {};
  const fundRaw = await safeGetJson(env, FUND_KEY, { fund: [] });
  const fund = Array.isArray(fundRaw) ? fundRaw : (Array.isArray(fundRaw?.fund) ? fundRaw.fund : []);
  const delReg = await safeGetJson(env, DEL_KEY, []);
  const deleted = Array.isArray(delReg) ? delReg.map(e => (e && e.id) ? String(e.id) : '').filter(Boolean) : [];
  const resyncToken = (await env.STORES_KV.get('resync_token')) || '';

  const out = { docs, config, fund, deleted, resyncToken };
  const bodyStr = JSON.stringify(out);
  const etag = '"' + etagHash(bodyStr) + '"';
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

    const result = { ok: true };

    // ── 1) 삭제 레지스트리 (부활 차단) ──
    let deletedIds = new Set();
    let delList = [];
    const delReg = await safeGetJson(env, DEL_KEY, []);
    if (Array.isArray(delReg)) {
      delList = delReg.filter(e => e && e.id);
      for (const e of delList) deletedIds.add(String(e.id));
    }
    const incomingTombs = Array.isArray(body?.tombstones) ? body.tombstones : [];
    let newTombs = 0;
    for (const t of incomingTombs) {
      const id = (t && typeof t === 'object') ? String(t.id || '') : String(t || '');
      if (!id) continue;
      if (!deletedIds.has(id)) {
        deletedIds.add(id);
        delList.push({ id, deletedAt: (t && t.deletedAt) || new Date().toISOString(), reason: (t && t.reason) || 'client-tombstone' });
        newTombs++;
      }
    }
    if (newTombs > 0) {
      try { await env.STORES_KV.put(DEL_KEY, JSON.stringify(delList)); } catch (_) {}
    }
    result.newTombs = newTombs;

    // ── 2) docs per-doc merge ──
    if (Array.isArray(body?.docs)) {
      const incoming = body.docs.filter(d => d && typeof d === 'object' && d.id && !deletedIds.has(String(d.id)));
      const existingRaw = await safeGetJson(env, DOCS_KEY, { docs: [] });
      const existingArr = Array.isArray(existingRaw) ? existingRaw : (Array.isArray(existingRaw?.docs) ? existingRaw.docs : []);
      const byId = new Map();
      for (const d of existingArr) {
        if (d && d.id && !deletedIds.has(String(d.id))) byId.set(String(d.id), d);
      }
      let added = 0, replaced = 0, kept = 0;
      for (const inc of incoming) {
        const id = String(inc.id);
        const ex = byId.get(id);
        if (!ex) { byId.set(id, inc); added++; continue; }
        const exMt = mtimeMs(ex), inMt = mtimeMs(inc);
        if (!exMt || inMt > exMt) { byId.set(id, inc); replaced++; }
        else if (inMt === exMt && JSON.stringify(ex) !== JSON.stringify(inc)) { byId.set(id, inc); replaced++; }
        else kept++;
      }
      const merged = [...byId.values()];
      const serialized = JSON.stringify({ docs: merged, updatedAt: new Date().toISOString() });
      if (serialized.length > 25_000_000) return json({ error: 'payload too large', size: serialized.length }, 413);
      try { await env.STORES_KV.put(DOCS_KEY, serialized); }
      catch (e) { return json({ error: 'kv_put_failed', detail: String(e) }, 500); }
      Object.assign(result, { docCount: merged.length, added, replaced, kept });
    }

    // ── 2b) fund tx per-id merge (docs 미러) ──
    if (Array.isArray(body?.fund)) {
      const incoming = body.fund.filter(t => t && typeof t === 'object' && t.id && !deletedIds.has(String(t.id)));
      const existingRaw = await safeGetJson(env, FUND_KEY, { fund: [] });
      const existingArr = Array.isArray(existingRaw) ? existingRaw : (Array.isArray(existingRaw?.fund) ? existingRaw.fund : []);
      const byId = new Map();
      for (const t of existingArr) { if (t && t.id && !deletedIds.has(String(t.id))) byId.set(String(t.id), t); }
      let fAdded = 0, fReplaced = 0, fKept = 0;
      for (const inc of incoming) {
        const id = String(inc.id); const ex = byId.get(id);
        if (!ex) { byId.set(id, inc); fAdded++; continue; }
        const exMt = mtimeMs(ex), inMt = mtimeMs(inc);
        if (!exMt || inMt > exMt) { byId.set(id, inc); fReplaced++; }
        else if (inMt === exMt && JSON.stringify(ex) !== JSON.stringify(inc)) { byId.set(id, inc); fReplaced++; }
        else fKept++;
      }
      const mergedF = [...byId.values()];
      const serF = JSON.stringify({ fund: mergedF, updatedAt: new Date().toISOString() });
      if (serF.length > 25_000_000) return json({ error: 'fund payload too large', size: serF.length }, 413);
      try { await env.STORES_KV.put(FUND_KEY, serF); }
      catch (e) { return json({ error: 'kv_put_failed_fund', detail: String(e) }, 500); }
      Object.assign(result, { fundCount: mergedF.length, fAdded, fReplaced, fKept });
    }

    // ── 3) config 키별 deep-merge (다중 PC 동시편집 시 빈 값이 서로 덮어쓰지 않도록) ──
    if (body?.config && typeof body.config === 'object') {
      const cur = (await safeGetJson(env, CFG_KEY, {})) || {};
      const inc = body.config;
      // birth/routes/leave/lineMap: 하위키 머지(incoming 우선)
      for (const k of ['routes', 'birth', 'leave', 'lineMap']) {
        if (inc[k] && typeof inc[k] === 'object') cur[k] = Object.assign({}, cur[k] || {}, inc[k]);
      }
      // holidays/holidayExcludes: union
      for (const k of ['holidays', 'holidayExcludes']) {
        if (Array.isArray(inc[k])) cur[k] = [...new Set([...(Array.isArray(cur[k]) ? cur[k] : []), ...inc[k]])];
      }
      // tpl: id 기준 머지(incoming 우선)
      if (Array.isArray(inc.tpl)) {
        const byId = new Map((Array.isArray(cur.tpl) ? cur.tpl : []).map(t => [t.id, t]));
        inc.tpl.forEach(t => { if (t && t.id) byId.set(t.id, t); });
        cur.tpl = [...byId.values()];
      }
      // fund 메타: cats(전체 교체) / opening·closings(키별 머지) / openingDate(최신)
      if (inc.fund && typeof inc.fund === 'object') {
        const cf = (cur.fund && typeof cur.fund === 'object') ? cur.fund : {};
        if (inc.fund.cats) cf.cats = inc.fund.cats;
        if (inc.fund.opening) cf.opening = Object.assign({}, cf.opening || {}, inc.fund.opening);
        if (inc.fund.openingDate) cf.openingDate = inc.fund.openingDate;
        if (inc.fund.closings) cf.closings = Object.assign({}, cf.closings || {}, inc.fund.closings);
        cur.fund = cf;
      }
      cur.updatedAt = new Date().toISOString();
      try { await env.STORES_KV.put(CFG_KEY, JSON.stringify(cur)); }
      catch (e) { return json({ error: 'kv_put_failed_cfg', detail: String(e) }, 500); }
      result.configSaved = true;
    }

    return json(result, 200);
  } catch (e) {
    return json({ error: 'handler_exception', detail: String(e), stack: e?.stack || '' }, 500);
  }
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

function mtimeMs(d) {
  const v = (d && (d.updatedAt ?? d.lastEditedAt ?? d.createdAt));
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/^\d+$/.test(s)) return Number(s);
  const p = Date.parse(s);
  return Number.isFinite(p) ? p : 0;
}

function etagHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
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
