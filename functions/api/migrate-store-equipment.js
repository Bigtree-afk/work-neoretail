/**
 * 서버사이드 일괄 마이그레이션 — job.equipment[] → store.equipment[]
 *
 *   POST /api/migrate-store-equipment
 *   Body(JSON): { dryRun?: boolean, force?: boolean, includeUncheckedPending?: boolean }
 *     - dryRun: true 면 KV 쓰지 않고 시뮬레이션만
 *     - force:  true 면 이미 적재된 인스턴스(sourceJobId+idx) 까지 새로 추가
 *               (보통 false — 기존 인스턴스 보존)
 *     - includeUncheckedPending: true 면 진행중 작업의 unchecked 항목도 적재
 *
 *  적재 정책 (force=false 기본):
 *    - 완료 작업(_isJobDone): equipment[] 전체를 설치된 것으로 간주
 *    - 진행중 작업: equipmentChecked[i]=true 만 (또는 includeUncheckedPending 시 전부)
 *    - sourceJobId + sourceJobItemIdx 중복 차단 (재실행 안전)
 *
 *  매장 매칭: id > biz > 정확이름 (대소문자/공백/괄호 정규화)
 *
 *  반환:
 *    { ok:true, summary: { added, skippedDupe, jobsScanned, stores, noStoreMatched },
 *      noStoreMatchedSamples: [...], updated: count }
 */

const STORE_EQUIP_SCHEMA_VER = 1;
const DONE_STATUSES = new Set(['완료', '처리완료', 'done']);

function isJobDone(j) {
  if (!j) return false;
  return DONE_STATUSES.has(String(j.status || ''));
}

function normBiz(b) {
  return String(b || '').replace(/\D/g, '');
}
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(주\)|\(유\)|\(합\)|\(재\)|\(사\)|주식회사|유한회사/g, '')
    .replace(/[()[\]{}<>「」]/g, '')
    .replace(/[._\-·\/\\,'"!?@#%&*+=:;|~`]/g, '')
    .replace(/\s+/g, '');
}

function findStore(stores, byBiz, byName, ref) {
  if (ref.storeId) {
    const m = stores.find(s => s.id === ref.storeId || s.storeId === ref.storeId);
    if (m) return m;
  }
  if (ref.businessNumber) {
    const b = normBiz(ref.businessNumber);
    if (b && b.length === 10) {
      const m = byBiz.get(b);
      if (m) return m;
    }
  }
  if (ref.storeName) {
    const n = normName(ref.storeName);
    if (n) {
      const m = byName.get(n);
      if (m) return m;
    }
  }
  return null;
}

function genInstanceId() {
  return 'eqi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function buildInstance(e, job, idx, checkedMeta, isDone, checked) {
  const installedAt = (checkedMeta.at || job.completedAt || job.installDate || job.openDate || job.createdAt || '')
    .slice(0, 10) || undefined;
  return {
    instanceId: genInstanceId(),
    catalogId: e.catalogId || null,  // fixedKey 는 카탈로그 id 와 안 맞음 → 클라이언트가 findCatalogByName 으로 재매칭
    catalogVer: STORE_EQUIP_SCHEMA_VER,
    name:      e.name || '-',
    category:  e.category || '',
    variant:   e.variant || '',
    options:   e.options || {},
    size:      e.size || '',
    condition: e.condition || 'new',
    qty:       Number(e.qty) || 1,
    serialNo:  '',
    costPrice: Number(e.costPrice) || 0,
    salePrice: Number(e.salePrice) || 0,
    status:    'in_use',
    installedAt,
    installedBy: checkedMeta.name || job.engineer || job.assignee || '',
    sourceJobId:      job.id,
    sourceJobItemIdx: idx,
    history: [{
      at: new Date().toISOString(),
      kind: 'migrated_from_job',
      by: 'server-migration',
      note: checked ? '체크박스로 설치 확인' : (isDone ? '완료 작업에서 자동 적재' : '진행 작업 적재'),
    }],
    updatedAt: new Date().toISOString(),
    updatedBy: 'server-migration',
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.STORES_KV) return json({ error: 'KV not bound' }, 500);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const dryRun = !!body.dryRun;
  const force = !!body.force;
  const includeUncheckedPending = !!body.includeUncheckedPending;

  // 데이터 로드
  const jobsData = (await env.STORES_KV.get('jobs', 'json')) || { jobs: [] };
  const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : (Array.isArray(jobsData) ? jobsData : []);
  const storesData = (await env.STORES_KV.get('stores', 'json')) || { stores: [] };
  const stores = Array.isArray(storesData.stores) ? storesData.stores : (Array.isArray(storesData) ? storesData : []);

  if (jobs.length === 0) {
    return json({ ok: true, summary: { jobsScanned: 0, added: 0 }, note: 'no jobs in KV' });
  }

  // 매장 인덱스
  const byBiz = new Map();
  const byName = new Map();
  for (const s of stores) {
    const b = normBiz(s.biz || s.businessNumber || s.bizno);
    if (b && b.length === 10) byBiz.set(b, s);
    const n = normName(s.storeName || s.name);
    if (n) byName.set(n, s);
  }

  let added = 0, skippedDupe = 0, noStoreMatched = 0;
  const seenStores = new Set();
  const noStoreSamples = [];
  const updatedStoreIds = new Set();

  for (const j of jobs) {
    if (!Array.isArray(j.equipment) || j.equipment.length === 0) continue;

    const ref = {
      storeId: j.storeId,
      storeName: j.storeName || j.store,
      businessNumber: j.businessNumber || j.biz,
    };
    const store = findStore(stores, byBiz, byName, ref);
    if (!store) {
      noStoreMatched++;
      if (noStoreSamples.length < 10) noStoreSamples.push({ jobId: j.id, store: ref.storeName, eq: j.equipment.length });
      continue;
    }

    if (!Array.isArray(store.equipment)) store.equipment = [];
    const checked = j.equipmentChecked || {};
    const checkedBy = j.equipmentCheckedBy || {};
    const done = isJobDone(j);

    let touched = false;
    j.equipment.forEach((e, i) => {
      const isChecked = !!(checked[i] || checked[String(i)]);
      // 적재 조건
      const shouldAdd = isChecked
        || done
        || (includeUncheckedPending);
      if (!shouldAdd) return;

      // 중복 차단 (force=false 일 때)
      if (!force) {
        const dupe = store.equipment.find(x => x.sourceJobId === j.id && x.sourceJobItemIdx === i);
        if (dupe) { skippedDupe++; return; }
      }

      const meta = checkedBy[i] || checkedBy[String(i)] || {};
      const inst = buildInstance(e, j, i, meta, done, isChecked);
      store.equipment.push(inst);
      added++;
      touched = true;
    });
    if (touched) {
      const key = store.id || store.storeId || store.biz || store.storeName || JSON.stringify(store).slice(0,40);
      seenStores.add(key);
      updatedStoreIds.add(key);
    }
  }

  // KV 쓰기 (dryRun 아닐 때)
  if (!dryRun && added > 0) {
    const newPayload = { stores };
    const serialized = JSON.stringify(newPayload);
    if (serialized.length > 50_000_000) {
      return json({ error: 'stores payload too large after migration', size: serialized.length }, 413);
    }
    await env.STORES_KV.put('stores', serialized);
  }

  return json({
    ok: true,
    dryRun,
    summary: {
      jobsScanned: jobs.length,
      added,
      skippedDupe,
      stores: seenStores.size,
      noStoreMatched,
    },
    noStoreMatchedSamples: noStoreSamples,
    updated: updatedStoreIds.size,
    note: dryRun ? 'KV not written (dryRun)' : 'stores KV updated',
  }, 200);
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
