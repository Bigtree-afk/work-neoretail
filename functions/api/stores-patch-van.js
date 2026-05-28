/**
 * 거래처 부분 패치 — 주 VAN사만 추가 (다른 필드 보존)
 *
 *   POST /api/stores-patch-van
 *      Body: { rows: [ { biz, van }, ... ], dryRun?: true }
 *      → {
 *          matched: N,         // 사업자번호로 매장 찾은 건수 (공유 biz 는 매장 수만큼)
 *          updated: M,         // 실제 van 추가/변경된 건수
 *          alreadySet: K,      // 이미 같은 값이 들어 있던 건수
 *          unmatched: [...],   // 매장 못 찾은 행 (사업자번호 미존재)
 *        }
 *
 * 동작:
 *   1) 사업자번호 숫자 10자리로 정규화 → 매장 찾기
 *   2) 같은 사업자번호의 모든 매장에 van 적용 (VAN 은 사업자 단위)
 *   3) van 필드만 추가/갱신 — 다른 필드 절대 안 건드림
 *   4) write-time re-read 로 동시 client push race 회피
 */

const STORES_KEY = 'stores';

export async function onRequestPost({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  let body;
  try { body = await request.json(); } catch(e){ return text('invalid json: ' + e.message, 400); }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = !!body.dryRun;
  if (!rows.length) return json({ matched:0, updated:0, alreadySet:0, unmatched:[] }, 200);

  const cur = (await env.STORES_KV.get(STORES_KEY, 'json')) || { stores: [] };
  const stores = Array.isArray(cur.stores) ? cur.stores : (Array.isArray(cur) ? cur : []);

  const norm = (b) => String(b||'').replace(/\D/g, '');
  const bizIndex = new Map();   // biz digits → store[]
  for (const s of stores) {
    const k = norm(s.biz || s.bizno);
    if (k) {
      if (!bizIndex.has(k)) bizIndex.set(k, []);
      bizIndex.get(k).push(s);
    }
  }

  let matched = 0, updated = 0, alreadySet = 0;
  const unmatched = [];
  // Map<storeId or biz:digits, { van }>
  const patchedFields = new Map();

  for (const row of rows) {
    const bizDigits = norm(row.biz);
    const van = String(row.van || '').trim();
    if (!bizDigits) { unmatched.push({ biz: row.biz, van, reason:'사업자번호 없음' }); continue; }
    if (!van)       { unmatched.push({ biz: row.biz, van, reason:'van 값 없음' }); continue; }

    const arr = bizIndex.get(bizDigits) || [];
    if (!arr.length) { unmatched.push({ biz: row.biz, van, reason:'매장 없음' }); continue; }

    for (const store of arr) {
      matched++;
      if (store.van === van) { alreadySet++; continue; }
      if (!dryRun) {
        store.van = van;
        const storeKey = store.id || ('biz:' + bizDigits);
        patchedFields.set(storeKey, { van });
      }
      updated++;
    }
  }

  let raceMerged = 0;
  if (!dryRun && patchedFields.size > 0) {
    // Write-time re-read — 동시 client push race 회피
    const freshCur = await env.STORES_KV.get(STORES_KEY, 'json');
    const freshArr = Array.isArray(freshCur?.stores) ? freshCur.stores
                    : (Array.isArray(freshCur) ? freshCur : null);
    if (freshArr && freshArr !== stores) {
      const freshById = new Map();
      const freshByBiz = new Map();   // biz digits → store[]
      for (const s of freshArr) {
        if (s.id) freshById.set(s.id, s);
        const nb = norm(s.biz || s.bizno);
        if (nb) {
          if (!freshByBiz.has(nb)) freshByBiz.set(nb, []);
          freshByBiz.get(nb).push(s);
        }
      }
      for (const [storeKey, changes] of patchedFields) {
        let targets = [];
        const byId = freshById.get(storeKey);
        if (byId) targets = [byId];
        else if (storeKey.startsWith('biz:')) targets = freshByBiz.get(storeKey.slice(4)) || [];
        for (const t of targets) { t.van = changes.van; raceMerged++; }
      }
      if (Array.isArray(freshCur)) {
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(freshArr));
      } else {
        freshCur.stores = freshArr;
        freshCur.lastVanPatch = new Date().toISOString();
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(freshCur));
      }
    } else {
      if (Array.isArray(cur)) {
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(stores));
      } else {
        cur.stores = stores;
        cur.lastVanPatch = new Date().toISOString();
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(cur));
      }
    }
  }

  return json({
    matched,
    updated,
    alreadySet,
    raceMerged,
    unmatched: unmatched.slice(0, 200),
    unmatchedTotal: unmatched.length,
    dryRun,
  }, 200);
}

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function text(m,s){return new Response(m,{status:s,headers:{'content-type':'text/plain; charset=utf-8'}});}
