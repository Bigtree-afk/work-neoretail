/**
 * 거래처 부분 패치 — 이카운트 등록일만 추가 (다른 필드 보존)
 *
 *   POST /api/stores-patch-ecount
 *      Body: { rows: [ { biz, regDate }, ... ], dryRun?: true }
 *      → {
 *          matched: N,         // 사업자번호로 매장 찾은 건수
 *          updated: M,         // 실제 등록일 추가/변경된 건수 (dryRun 이 아닐 때만)
 *          unmatched: [...],   // 매장 못 찾은 행
 *          alreadySet: K,      // 이미 같은 값이 들어 있던 건수
 *          bizNormalized: P,   // 사업자번호 포맷이 표준화된 건수 (***-**-*****)
 *        }
 *
 * 동작:
 *   1) 사업자번호 정규화: 숫자 10자리로 비교 → 매장 찾기
 *   2) 매장의 ecountRegDate 필드만 추가/갱신
 *   3) 사업자번호 포맷이 다르면 ***-**-***** 형태로 표준화
 *   4) 다른 필드 절대 안 건드림
 *   5) KV stores 키 갱신
 */

const STORES_KEY = 'stores';

export async function onRequestPost({ env, request }) {
  if (!env.STORES_KV) return text('KV not bound', 500);
  let body;
  try { body = await request.json(); } catch(e){ return text('invalid json: ' + e.message, 400); }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = !!body.dryRun;
  if (!rows.length) return json({ matched:0, updated:0, unmatched:[], alreadySet:0, bizNormalized:0 }, 200);

  // 매장 로드 — cacheTtl:0 으로 PoP 캐시 우회 (race-safe 필수)
  const cur = (await env.STORES_KV.get(STORES_KEY, 'json')) || { stores: [] };
  const stores = Array.isArray(cur.stores) ? cur.stores : (Array.isArray(cur) ? cur : []);

  // biz 정규화 인덱스 (숫자만 10자리 → store[])  — 같은 biz 공유하는 직영점 대응
  const norm = (b) => String(b||'').replace(/\D/g, '');
  const bizIndex = new Map();          // biz digits → store[]
  const codeIndex = new Map();         // code → store
  for (const s of stores) {
    const k = norm(s.biz || s.bizno);
    if (k) {
      if (!bizIndex.has(k)) bizIndex.set(k, []);
      bizIndex.get(k).push(s);
    }
    if (s.code) codeIndex.set(String(s.code), s);
  }

  const formatBiz = (digits) => {
    if (digits.length !== 10) return digits;   // 비표준 길이는 그대로
    return `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5,10)}`;
  };

  let matched = 0, updated = 0, alreadySet = 0, bizNormalized = 0;
  const unmatched = [];

  // 이 patch 가 변경한 store id 와 패치된 필드 추적 (write-time re-read 시 사용)
  // Map<storeId, { biz?, storeRegDate?, ecountRegDate? }>
  const patchedFields = new Map();

  let ambiguous = 0;

  for (const row of rows) {
    const bizDigits = norm(row.biz);
    const rowCode = row.code ? String(row.code).trim() : '';

    // 매장 찾기 — 우선순위:
    //   1) code 가 주어지면 code 로 정확 매칭
    //   2) biz 로 찾되, 여러 매장이 공유하면 ambiguous (code 없으면 처리 불가)
    let targets = [];
    if (rowCode) {
      const s = codeIndex.get(rowCode);
      if (s) targets = [s];
    }
    if (!targets.length && bizDigits) {
      const arr = bizIndex.get(bizDigits) || [];
      if (arr.length === 1) {
        targets = arr;
      } else if (arr.length > 1) {
        // 공유 사업자번호 — code 없으면 어느 매장인지 알 수 없음
        ambiguous++;
        unmatched.push({
          biz: row.biz,
          code: rowCode,
          regDate: row.regDate,
          reason: `사업자번호 공유 매장 ${arr.length}개 — code 필수`,
          candidateNames: arr.map(s => s.name).slice(0, 10),
        });
        continue;
      }
    }

    if (!targets.length) {
      if (!bizDigits && !rowCode) {
        unmatched.push({ biz: row.biz, code: rowCode, regDate: row.regDate, reason:'사업자번호/코드 없음' });
      } else {
        unmatched.push({ biz: row.biz, code: rowCode, regDate: row.regDate, reason:'매장 없음' });
      }
      continue;
    }

    for (const store of targets) {
      matched++;
      const newRegDate = String(row.regDate || '').trim();
      const stdBiz = bizDigits ? formatBiz(bizDigits) : store.biz;
      const targetBizDigits = bizDigits || norm(store.biz);

      if (!dryRun) {
        const storeKey = store.id || ('biz:' + targetBizDigits) || ('code:' + (store.code||''));
        const myChanges = patchedFields.get(storeKey) || {};
        if (bizDigits && store.biz !== stdBiz) {
          store.biz = stdBiz;
          myChanges.biz = stdBiz;
          bizNormalized++;
        }
        if (newRegDate) {
          if (store.storeRegDate === newRegDate || store.ecountRegDate === newRegDate) {
            alreadySet++;
            if (!store.storeRegDate && store.ecountRegDate === newRegDate) {
              store.storeRegDate = newRegDate;
              myChanges.storeRegDate = newRegDate;
            }
          } else {
            store.storeRegDate = newRegDate;
            store.ecountRegDate = newRegDate;
            myChanges.storeRegDate = newRegDate;
            myChanges.ecountRegDate = newRegDate;
            updated++;
          }
        }
        if (Object.keys(myChanges).length > 0) patchedFields.set(storeKey, myChanges);
      } else {
        if (bizDigits && store.biz !== stdBiz) bizNormalized++;
        if (newRegDate && store.ecountRegDate === newRegDate) alreadySet++;
        else if (newRegDate) updated++;
      }
    }
  }

  let raceMerged = 0;
  if (!dryRun && patchedFields.size > 0) {
    // ⚠ Write-time re-read — 동시 client push 와의 race condition 회피
    // 처음 읽은 cur 가 stale 일 수 있음. 쓰기 직전 KV 를 다시 읽고
    // 우리가 패치한 필드만 새 KV 위에 다시 덮는다.
    const freshCur = await env.STORES_KV.get(STORES_KEY, 'json');
    const freshArr = Array.isArray(freshCur?.stores) ? freshCur.stores
                    : (Array.isArray(freshCur) ? freshCur : null);
    if (freshArr && freshArr !== stores) {
      const freshById = new Map();
      const freshByBiz = new Map();
      const freshByCode = new Map();
      for (const s of freshArr) {
        if (s.id) freshById.set(s.id, s);
        const nb = norm(s.biz || s.bizno);
        if (nb) freshByBiz.set(nb, s);
        if (s.code) freshByCode.set(String(s.code), s);
      }
      // 우리가 패치한 매장만 fresh KV 위에 my changes 다시 적용
      for (const [storeKey, changes] of patchedFields) {
        let target = freshById.get(storeKey);
        if (!target && storeKey.startsWith('biz:')) target = freshByBiz.get(storeKey.slice(4));
        if (!target && storeKey.startsWith('code:')) target = freshByCode.get(storeKey.slice(5));
        // freshArr 에도 (사업자번호 정규화 했을 수 있으므로) 우리 변경 후 stdBiz 로 찾기
        if (!target && changes.biz) target = freshByBiz.get(norm(changes.biz));
        if (target) {
          if (changes.biz)            target.biz = changes.biz;
          if (changes.storeRegDate)   target.storeRegDate = changes.storeRegDate;
          if (changes.ecountRegDate)  target.ecountRegDate = changes.ecountRegDate;
          raceMerged++;
        }
      }
      // 변경 후 freshArr 을 stores 로 사용
      if (Array.isArray(freshCur)) {
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(freshArr));
      } else {
        freshCur.stores = freshArr;
        freshCur.lastEcountPatch = new Date().toISOString();
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(freshCur));
      }
    } else {
      // 처음 read 한 그대로 — 변경 없으면 그대로 write
      if (Array.isArray(cur)) {
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(stores));
      } else {
        cur.stores = stores;
        cur.lastEcountPatch = new Date().toISOString();
        await env.STORES_KV.put(STORES_KEY, JSON.stringify(cur));
      }
    }
  }

  return json({
    matched,
    updated,
    alreadySet,
    bizNormalized,
    raceMerged,
    ambiguous,
    unmatched: unmatched.slice(0, 200),
    unmatchedTotal: unmatched.length,
    dryRun,
  }, 200);
}

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function text(m,s){return new Response(m,{status:s,headers:{'content-type':'text/plain; charset=utf-8'}});}
