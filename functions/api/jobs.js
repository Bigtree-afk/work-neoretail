/**
 * 작업(신규/AS/POS교체 등) — 클라우드 동기화
 *
 *   GET  /api/jobs            → 누구나 조회 가능
 *   POST /api/jobs            → Authorization: Bearer <SYNC_SECRET>
 *      body: { jobs: [...] }
 *
 * 저장 위치: STORES_KV 의 키 "jobs"
 *   { jobs: [...], updatedAt: ISO8601 }
 */
export async function onRequestGet({ request, env }) {
  if (!env.STORES_KV) return json({ jobs: [], error: 'KV not bound' }, 200);
  // 🛡 KV.get('...', 'json') 은 손상된 JSON (예: BOM 포함) 만나면 unhandled throw →
  //   handler 가 500 / Cloudflare 1101 에러 반환. wrangler kv put 으로 직접 데이터를
  //   넣는 경우 PowerShell WriteAllText 가 BOM 을 붙여서 깨질 위험 → try/catch 로 격리.
  const safeGetJson = async (key, fallback) => {
    try {
      const v = await env.STORES_KV.get(key, 'json');
      return v == null ? fallback : v;
    } catch (e) {
      console.warn(`[jobs GET] KV.get('${key}', 'json') 실패:`, e?.message || e);
      // text 로 재시도 — BOM 제거 후 parse 가능하면 사용
      try {
        const raw = await env.STORES_KV.get(key);
        if (!raw) return fallback;
        const cleaned = raw.replace(/^﻿/, '').trim();
        return cleaned ? JSON.parse(cleaned) : fallback;
      } catch (_) {
        return fallback;
      }
    }
  };
  const data = await safeGetJson('jobs', { jobs: [] });
  // 🪦 deleted_jobs 레지스트리 포함 — 클라이언트가 자기 localStorage 정리에 사용
  //    형식: [{ id, deletedAt, reason }]
  const deleted = await safeGetJson('deleted_jobs', []);
  // 🪦 deleted_threads — thread 단위 부활 차단 레지스트리 (보강 B, 2026-05-28)
  //    형식: [{ threadId, jobId, deletedAt, reason }]
  //    한 PC 에서 ROOT/child 를 삭제하면 다른 PC 도 자동 차단됨 (admin token 무관)
  const deletedThreads = await safeGetJson('deleted_threads', []);
  // 🪦 deleted_thread_children — ROOT 삭제 시 자식까지 차단 (parentId 매칭)
  const deletedThreadChildren = await safeGetJson('deleted_thread_children', []);
  // 🔁 resync_token — 데이터 대규모 변경 시 모든 클라이언트 force-resync 트리거
  const resyncToken = (await env.STORES_KV.get('resync_token')) || '';
  const out = (data && typeof data === 'object' && !Array.isArray(data))
    ? { ...data, deleted, deletedThreads, deletedThreadChildren, resyncToken }
    : { jobs: Array.isArray(data) ? data : [], deleted, deletedThreads, deletedThreadChildren, resyncToken };
  // ⚡ ETag/304 — 변경 없으면 본문(jobs 등 수백 KB) 재전송 회피 (If-None-Match)
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

// djb2-xor + 길이 — 변경감지용 ETag(충돌 무해)
function _etagHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.STORES_KV) return json({ error: 'KV not bound', envKeys: Object.keys(env) }, 500);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'invalid_json', detail: String(e) }, 400); }

    const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
    if (jobs.length > 10000) return json({ error: 'too_many', count: jobs.length }, 413);

    // 🪦 deleted_jobs 레지스트리로 부활 차단 — stale 클라이언트 wholesale POST 가
    //    삭제된 job 을 다시 cloud 에 등록시키는 문제 방지 (샤르르 부활 루프, 2026-05-22)
    let deletedIds = new Set();
    let jobRegList = [];
    try {
      const reg = (await env.STORES_KV.get('deleted_jobs', 'json')) || [];
      if (Array.isArray(reg)) {
        jobRegList = reg.filter(e => e && e.id);
        for (const e of jobRegList) deletedIds.add(String(e.id));
      }
    } catch (_) {}

    // 🪦 jobTombstones 무인증 수신 (보강 C, 2026-05-28) — 토큰 없는 기기(모바일 등)도
    //   job 삭제를 서버 deleted_jobs 레지스트리에 등록 가능. admin-delete(토큰) 채널의
    //   silent fail 로 job 이 cloud KV 에 남아 다른 기기에서 부활하던 문제 차단.
    //   형식: body.jobTombstones = [{ id, deletedAt, reason }]
    const incomingJobTombs = Array.isArray(body?.jobTombstones) ? body.jobTombstones : [];
    let newJobTombs = 0;
    for (const t of incomingJobTombs) {
      if (!t || !t.id) continue;
      const jid = String(t.id);
      if (!deletedIds.has(jid)) {
        deletedIds.add(jid);
        jobRegList.push({ id: jid, deletedAt: t.deletedAt || new Date().toISOString(), reason: t.reason || 'client-tombstone' });
        newJobTombs++;
      }
    }
    if (newJobTombs > 0) {
      try { await env.STORES_KV.put('deleted_jobs', JSON.stringify(jobRegList)); } catch (_) {}
    }

    // 🪦 deleted_threads / deleted_thread_children 레지스트리 (보강 B, 2026-05-28)
    //   — incoming body.threadTombstones 를 받아 union 한 뒤 다시 KV 저장
    //   — 그 다음 incoming jobs 의 thread 에서 매칭 entry 제거 (cloud merge 시에도 적용)
    let deletedThreadIds = new Set();
    let deletedThreadChildrenIds = new Set();
    let threadRegList = [];
    let childRegList = [];
    try {
      const reg = (await env.STORES_KV.get('deleted_threads', 'json')) || [];
      if (Array.isArray(reg)) {
        threadRegList = reg.filter(e => e && e.threadId);
        for (const e of threadRegList) deletedThreadIds.add(String(e.threadId));
      }
    } catch (_) {}
    try {
      const reg = (await env.STORES_KV.get('deleted_thread_children', 'json')) || [];
      if (Array.isArray(reg)) {
        childRegList = reg.filter(e => e && e.threadId);
        for (const e of childRegList) deletedThreadChildrenIds.add(String(e.threadId));
      }
    } catch (_) {}
    // incoming threadTombstones 머지 — 두 type 으로 입력 가능: { type:'thread'|'thread-children', threadId, jobId, deletedAt, reason }
    const incomingTombs = Array.isArray(body?.threadTombstones) ? body.threadTombstones : [];
    let newThreadTombs = 0, newChildTombs = 0;
    for (const t of incomingTombs) {
      if (!t || !t.threadId) continue;
      const tid = String(t.threadId);
      const entry = {
        threadId: tid,
        jobId: t.jobId || null,
        deletedAt: t.deletedAt || new Date().toISOString(),
        reason: t.reason || 'client-tombstone'
      };
      if (t.type === 'thread-children') {
        if (!deletedThreadChildrenIds.has(tid)) {
          deletedThreadChildrenIds.add(tid);
          childRegList.push(entry);
          newChildTombs++;
        }
      } else {
        if (!deletedThreadIds.has(tid)) {
          deletedThreadIds.add(tid);
          threadRegList.push(entry);
          newThreadTombs++;
        }
      }
    }
    // 신규 tombstone 이 있을 때만 KV 갱신
    if (newThreadTombs > 0) {
      try { await env.STORES_KV.put('deleted_threads', JSON.stringify(threadRegList)); } catch (_) {}
    }
    if (newChildTombs > 0) {
      try { await env.STORES_KV.put('deleted_thread_children', JSON.stringify(childRegList)); } catch (_) {}
    }
    // 🛡 thread filter — incoming/cloud 양쪽 thread 에서 tombstoned entry 제거
    const filterThread = (thread) => {
      if (!Array.isArray(thread)) return thread;
      return thread.filter(e => {
        if (!e) return false;
        if (e.threadId && deletedThreadIds.has(String(e.threadId))) return false;
        if (e.parentId && deletedThreadChildrenIds.has(String(e.parentId))) return false;
        return true;
      });
    };

    const cleaned = jobs.filter(j => {
      if (!j || typeof j !== 'object' || !j.id) return false;
      if (deletedIds.has(String(j.id))) return false;  // 부활 차단
      return true;
    });
    const rejected = jobs.length - cleaned.length;

    // 🕐 PER-JOB MERGE BY mtime (2026-05-22) — wholesale overwrite 폐기.
    //   다른 PC 의 stale localStorage 가 wholesale POST 로 cloud 를 덮어쓰던 문제 차단.
    //   규칙:
    //     - 클라이언트가 보낸 각 job 에 대해, KV 에 같은 id 의 기존 job 이 있고 그쪽 updatedAt 이 더 최신이면
    //       기존 cloud 버전을 그대로 유지 (incoming 무시).
    //     - 그렇지 않으면 incoming 으로 교체.
    //     - 클라이언트가 보내지 않은 cloud job 은 그대로 유지 (omission 으로 삭제 안 함).
    //     - 삭제는 오로지 /api/admin-delete (= deleted_jobs 레지스트리 + token bump) 채널로만.
    const existingRaw = (await env.STORES_KV.get('jobs', 'json')) || { jobs: [] };
    const existingArr = Array.isArray(existingRaw)
      ? existingRaw
      : (Array.isArray(existingRaw?.jobs) ? existingRaw.jobs : []);
    const byId = new Map();
    for (const j of existingArr) {
      if (j && j.id && !deletedIds.has(String(j.id))) {
        // 🪦 cloud 의 기존 job thread 도 deleted_threads 필터 적용 (cleanup 효과)
        const clone = { ...j, thread: filterThread(j.thread) };
        byId.set(String(j.id), clone);
      }
    }
    let kept = 0, replaced = 0, added = 0;
    const mtime = (j) => String(j?.updatedAt || j?.lastEditedAt || j?.createdAt || '');
    for (const inc of cleaned) {
      const id = String(inc.id);
      // 🪦 incoming 의 thread 도 필터 (사용자가 모르고 stale push 한 thread 차단)
      const incFiltered = { ...inc, thread: filterThread(inc.thread) };
      const ex = byId.get(id);
      if (!ex) {
        byId.set(id, incFiltered);
        added++;
        continue;
      }
      const exMt = mtime(ex);
      const inMt = mtime(incFiltered);
      if (!exMt || inMt > exMt) {
        byId.set(id, incFiltered);
        replaced++;
      } else if (inMt === exMt && JSON.stringify(ex) !== JSON.stringify(incFiltered)) {
        // 동일 mtime 인데 내용 다름 — incoming 채택 (last-writer-wins 보조 규칙)
        byId.set(id, incFiltered);
        replaced++;
      } else {
        kept++;
      }
    }
    const merged = [...byId.values()];
    const serialized = JSON.stringify({ jobs: merged, updatedAt: new Date().toISOString() });
    if (serialized.length > 25_000_000) return json({ error: 'payload too large', size: serialized.length }, 413);

    try {
      await env.STORES_KV.put('jobs', serialized);
    } catch (e) {
      return json({ error: 'kv_put_failed', detail: String(e), stack: e?.stack || '', size: serialized.length }, 500);
    }
    return json({ ok: true, count: merged.length, added, replaced, kept,
                   rejectedDeleted: rejected,
                   newThreadTombs, newChildTombs, newJobTombs }, 200);
  } catch (e) {
    return json({ error: 'handler_exception', detail: String(e), stack: e?.stack || '' }, 500);
  }
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
function text(msg, status) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain' } });
}
