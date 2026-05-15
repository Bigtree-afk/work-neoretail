/**
 * POST /api/stores-normalize-biz
 *   Body: { dryRun?: true }
 *
 * 모든 매장의 사업자번호를 ***-**-***** 표준 포맷으로 정규화.
 *   - 숫자만 추출했을 때 10자리인 매장만 처리
 *   - 정보 없거나 10자리 아닌 매장은 건드리지 않음
 *   - biz 필드만 수정, 다른 필드 절대 보존
 *   - write-time re-read 로 race-safe
 */

const STORES_KEY = 'stores';

export async function onRequestPost({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  let body = {};
  try { body = await request.json(); } catch(_){ /* empty body ok */ }
  const dryRun = !!body.dryRun;

  const cur = (await env.STORES_KV.get(STORES_KEY, 'json')) || { stores: [] };
  const stores = Array.isArray(cur.stores) ? cur.stores : (Array.isArray(cur) ? cur : []);

  const norm = (b) => String(b||'').replace(/\D/g, '');
  const fmt = (d) => `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5,10)}`;

  let total = stores.length;
  let alreadyStandard = 0;
  let normalized = 0;
  let skippedNoBiz = 0;
  let skippedBadLength = 0;
  const changedIds = new Map(); // storeKey -> newBiz

  for (const s of stores) {
    const raw = String(s.biz || s.bizno || '').trim();
    if (!raw) { skippedNoBiz++; continue; }
    const d = norm(raw);
    if (d.length !== 10) { skippedBadLength++; continue; }
    const std = fmt(d);
    if (s.biz === std) { alreadyStandard++; continue; }
    if (!dryRun) {
      s.biz = std;
      const key = s.id || ('biz:' + d);
      changedIds.set(key, { newBiz: std, digits: d });
    }
    normalized++;
  }

  // write-time re-read — race fix
  let raceMerged = 0;
  if (!dryRun && changedIds.size > 0) {
    const freshCur = await env.STORES_KV.get(STORES_KEY, 'json');
    const freshArr = Array.isArray(freshCur?.stores) ? freshCur.stores
                    : (Array.isArray(freshCur) ? freshCur : null);
    if (freshArr && freshArr !== stores) {
      const byId = new Map();
      const byBiz = new Map();
      for (const s of freshArr) {
        if (s.id) byId.set(s.id, s);
        const nb = norm(s.biz || s.bizno);
        if (nb) byBiz.set(nb, s);
      }
      for (const [key, info] of changedIds) {
        let target = byId.get(key);
        if (!target && key.startsWith('biz:')) target = byBiz.get(key.slice(4));
        if (!target) target = byBiz.get(info.digits);
        if (target && target.biz !== info.newBiz) {
          target.biz = info.newBiz;
          raceMerged++;
        }
      }
      if (Array.isArray(freshCur)) {
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(freshArr));
      } else {
        freshCur.stores = freshArr;
        freshCur.lastBizNormalize = new Date().toISOString();
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(freshCur));
      }
    } else {
      if (Array.isArray(cur)) {
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(stores));
      } else {
        cur.stores = stores;
        cur.lastBizNormalize = new Date().toISOString();
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(cur));
      }
    }
  }

  return json({
    total,
    normalized,
    alreadyStandard,
    skippedNoBiz,
    skippedBadLength,
    raceMerged,
    dryRun,
  });
}

function json(o, s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function text(m,s){return new Response(m,{status:s,headers:{'content-type':'text/plain; charset=utf-8'}});}
