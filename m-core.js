/* ============================================================================
 * m-core.js — NeoRetail mobile shared core
 * ----------------------------------------------------------------------------
 * PC SPA (index.html) 와 같은 localStorage 키 / 동일한 cloud API endpoint 사용
 *  - ns_jobs        : 작업 (신규/AS/VAN/소모품/매장이탈)
 *  - ns_stores      : 매장
 *  - ns_stocktake   : 재고조사 (참고: 단수형 키, PC 와 동일)
 *  - ns_users       : 사용자
 *  - ns_auth        : 로그인 상태
 *  - ns_tombstones  : 삭제 부활 방지
 *
 * 노출 함수는 PC SPA 와 100% 호환되도록 window 동일 명칭으로 export.
 * 함수마다 PC index.html 의 원본 라인 ref 를 함께 표기.
 * ===========================================================================*/
(function(global) {
  'use strict';

  /* ───────────────────────────────────────────────────────────
   * 보조: 빠른 해시 (push content-skip 용) — index.html L7884
   * ───────────────────────────────────────────────────────── */
  function _fastHash(s) {
    let h = 5381; const len = s.length;
    for (let i = 0; i < len; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /* ───────────────────────────────────────────────────────────
   * HTML escape — index.html L15821
   * ───────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
    ));
  }

  /* ───────────────────────────────────────────────────────────
   * KST 시간 헬퍼 — index.html L19008 / L22188
   * ───────────────────────────────────────────────────────── */
  function _kstDateTimeStr() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false,
    }).format(d);
    return parts.replace('T',' ').replace(',',' ');
  }
  function _kstNow() {
    return _kstDateTimeStr();
  }

  /* ───────────────────────────────────────────────────────────
   * 닉네임 → 실명 정규화 — whitelist users의 nicknames 배열 기반
   * 저장/표시 시 항상 이 함수를 통해 이름 정규화
   * ───────────────────────────────────────────────────────── */
  function _normalizeDisplayName(name) {
    if (!name) return name;
    try {
      const users = JSON.parse(localStorage.getItem('ns_users') || '[]');
      for (const u of users) {
        if (!u.name) continue;
        // 닉네임 배열에서 일치 여부 확인
        if (Array.isArray(u.nicknames) && u.nicknames.some(n => String(n).trim() === String(name).trim())) {
          return u.name;
        }
      }
    } catch(_){}
    return name;
  }
  window._normalizeDisplayName = _normalizeDisplayName;

  /* ───────────────────────────────────────────────────────────
   * 현재 로그인 사용자 이름 — index.html L22196
   * ───────────────────────────────────────────────────────── */
  function _currentAuthName() {
    try {
      const a = JSON.parse(localStorage.getItem('ns_auth') || 'null');
      if (!a) return '';
      try {
        const users = JSON.parse(localStorage.getItem('ns_users') || '[]');
        const me = users.find(u => (u.id||'').toLowerCase() === (a.id||a.email||'').toLowerCase());
        if (me && me.name) return me.name;
      } catch(_){}
      return _normalizeDisplayName(a.name || a.email || '');
    } catch(e) { return ''; }
  }

  /* ───────────────────────────────────────────────────────────
   * Toast — 모바일 친화적 재구현 (index.html L7511)
   * ───────────────────────────────────────────────────────── */
  function showToast(msg) {
    let t = document.getElementById('neoToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'neoToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:calc(80px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#1F2937;color:#fff;padding:11px 20px;border-radius:24px;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.3);transition:opacity .3s;pointer-events:none;max-width:84vw;text-align:center';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
  }

  /* ───────────────────────────────────────────────────────────
   * scheduleAutoBackup — 모바일에선 no-op (PC 의 ns_backups 와 충돌 회피)
   * ───────────────────────────────────────────────────────── */
  function scheduleAutoBackup(/* delayMs */) { /* no-op on mobile */ }

  /* ═══════════════════════════════════════════════════════════
   * 데이터 레이어 — localStorage R/W
   * ═══════════════════════════════════════════════════════════ */

  // ── USERS — index.html L10808 ────────────────────────────────
  function getUsers() {
    try { return JSON.parse(localStorage.getItem('ns_users') || '[]'); } catch { return []; }
  }

  // ── STORES — index.html L12753 ───────────────────────────────
  function getStores() {
    try { return JSON.parse(localStorage.getItem('ns_stores') || '[]'); } catch { return []; }
  }
  function saveStores(arr) {
    localStorage.setItem('ns_stores', JSON.stringify(arr));
  }

  // 매장 클라우드 풀 (모바일 첫 진입 시 PC 데이터 받기 위함) — index.html L4895 syncFromCloud
  function _isStoreTombstoned(storeId) { return _isTombstoned('store', storeId); }
  async function syncStoresFromCloud() {
    try {
      const res = await fetch('/api/stores', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const remote = Array.isArray(data && data.stores) ? data.stores : [];
      if (remote.length === 0) return;
      // 🪦 서버 측 매장 삭제 레지스트리 — 자기 localStorage 에서도 제거 + 로컬 tombstone 등록
      const cloudDeleted = Array.isArray(data && data.deleted) ? data.deleted : [];
      const cloudDeletedIds = new Set(cloudDeleted.map(e => String(e && e.id || '')).filter(Boolean));
      if (cloudDeletedIds.size > 0 && typeof _addTombstone === 'function') {
        for (const id of cloudDeletedIds) {
          try { _addTombstone('store', id); } catch(_){}
        }
      }
      const local = getStores() || [];
      const byId = new Map();
      // 로컬 우선 등록 (tombstone 된 매장은 skip)
      local.forEach(s => {
        if (!s || !s.id) return;
        if (_isStoreTombstoned(s.id)) return;
        if (cloudDeletedIds.has(s.id)) return;
        byId.set(s.id, s);
      });
      // 클라우드 매장 추가 — tombstone 필터 적용 (삭제된 매장이 살아돌아오는 것 방지)
      remote.forEach(s => {
        if (!s || !s.id) return;
        if (_isStoreTombstoned(s.id)) return;
        if (cloudDeletedIds.has(s.id)) return;
        byId.set(s.id, s); // 같은 id 면 remote 우선 (PC master 가정)
      });
      const noId = [
        ...local.filter(s => s && !s.id),
        ...remote.filter(s => s && !s.id),
      ];
      const merged = [...byId.values(), ...noId];
      saveStores(merged);
    } catch(e) { /* 네트워크 실패 무시 */ }
  }

  // 미등록 가맹점 → 정식 매장으로 KV 등록 (PC pushStoresToCloud 와 동일 /api/sync POST)
  // 반환: { ok, store, error? }
  async function registerStoreAsOfficial({ name, biz, addr, ceo, tel }) {
    name = String(name||'').trim();
    if (!name) return { ok:false, error:'매장명 필수' };
    const bizDigits = String(biz||'').replace(/\D/g,'');
    const local = getStores() || [];
    // 중복 체크 — 같은 사업자번호 또는 같은 이름 + 주소
    const dupe = local.find(s => {
      const sb = String(s.biz || s.bizNo || s.bizno || '').replace(/\D/g,'');
      if (bizDigits && sb && bizDigits === sb) return true;
      if ((s.name||'') === name && (s.addr||'') === (addr||'')) return true;
      return false;
    });
    if (dupe) return { ok:false, error:'이미 등록된 매장입니다', store:dupe };

    const id = 'EC-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase();
    const newStore = {
      id,
      name,
      biz: biz || '',
      addr: addr || '',
      ceo: ceo || '',
      tel: tel || '',
      pos: '0',
      status: '거래중',
      createdAt: Date.now(),
      storeRegDate: new Date().toISOString().slice(0,10),
      _origin: 'mobile-unreg-promote',
    };
    const next = [...local, newStore];
    saveStores(next);
    // 클라우드 sync (PC pushStoresToCloud 와 같은 엔드포인트)
    try {
      const res = await fetch('/api/sync', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body: JSON.stringify({ stores: next, source:'mobile-spa' }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=>'')
        return { ok:false, error:`서버 응답 ${res.status}: ${txt.slice(0,80)}`, store:newStore };
      }
    } catch(e) {
      return { ok:false, error:'네트워크 실패 — 로컬에는 저장됨, 추후 자동 동기화', store:newStore };
    }
    return { ok:true, store:newStore };
  }

  // 매장 검색에서 0건일 때 부르는 공용 모달 — 이름 prefill 후 사업자번호·주소 입력받아 즉시 정식 등록.
  // 호출: const store = await promptRegisterStore('카페모리'); store 가 null 이면 취소
  function promptRegisterStore(prefilledName) {
    return new Promise((resolve) => {
      // 모달 DOM (이미 있으면 재사용)
      let m = document.getElementById('mcPromptRegStore');
      if (!m) {
        m = document.createElement('div');
        m.id = 'mcPromptRegStore';
        m.innerHTML = `
          <div style="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;justify-content:center" id="prsBack">
            <div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:480px;padding:18px 18px calc(18px + env(safe-area-inset-bottom));font-family:-apple-system,'Pretendard Variable','Pretendard',sans-serif">
              <div style="display:flex;align-items:center;gap:9px;margin-bottom:13px">
                <div style="font-size:21px">⭐</div>
                <div style="font-size:16px;font-weight:800;color:#1F2937">새 매장 정식 등록</div>
                <button id="prsClose" style="margin-left:auto;background:transparent;border:none;font-size:22px;color:#9CA3AF;cursor:pointer">✕</button>
              </div>
              <div style="margin-bottom:9px">
                <label style="font-size:11.5px;font-weight:700;color:#4B5563;margin-bottom:4px;display:block">상호명 <span style="color:#DC2626">*</span></label>
                <input id="prsName" type="text" style="width:100%;padding:11px 12px;border:1.5px solid #D1D5DB;border-radius:9px;font-size:16px;font-family:inherit" placeholder="매장명">
              </div>
              <div style="margin-bottom:9px">
                <label style="font-size:11.5px;font-weight:700;color:#4B5563;margin-bottom:4px;display:block">사업자번호</label>
                <input id="prsBiz" type="text" inputmode="numeric" style="width:100%;padding:11px 12px;border:1.5px solid #D1D5DB;border-radius:9px;font-size:16px;font-family:inherit" placeholder="000-00-00000">
              </div>
              <div style="margin-bottom:9px">
                <label style="font-size:11.5px;font-weight:700;color:#4B5563;margin-bottom:4px;display:block">주소</label>
                <input id="prsAddr" type="text" style="width:100%;padding:11px 12px;border:1.5px solid #D1D5DB;border-radius:9px;font-size:16px;font-family:inherit" placeholder="서울특별시 ...">
              </div>
              <div style="margin-bottom:9px">
                <label style="font-size:11.5px;font-weight:700;color:#4B5563;margin-bottom:4px;display:block">대표자</label>
                <input id="prsCeo" type="text" style="width:100%;padding:11px 12px;border:1.5px solid #D1D5DB;border-radius:9px;font-size:16px;font-family:inherit" placeholder="(선택)">
              </div>
              <div style="margin-bottom:14px">
                <label style="font-size:11.5px;font-weight:700;color:#4B5563;margin-bottom:4px;display:block">매장 전화</label>
                <input id="prsTel" type="tel" inputmode="tel" style="width:100%;padding:11px 12px;border:1.5px solid #D1D5DB;border-radius:9px;font-size:16px;font-family:inherit" placeholder="(선택)">
              </div>
              <div id="prsMsg" style="font-size:11.5px;color:#92400E;margin-bottom:10px;display:none"></div>
              <div style="display:flex;gap:8px">
                <button id="prsCancel" style="flex:1;padding:13px;background:#fff;color:#4B5563;border:1.5px solid #D1D5DB;border-radius:10px;font-size:14.5px;font-weight:800;cursor:pointer">취소</button>
                <button id="prsSubmit" style="flex:2;padding:13px;background:#16A34A;color:#fff;border:none;border-radius:10px;font-size:14.5px;font-weight:800;cursor:pointer">⭐ 정식 등록</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(m);
      }
      const $ = id => m.querySelector('#'+id);
      $('prsName').value = prefilledName || '';
      $('prsBiz').value = ''; $('prsAddr').value = ''; $('prsCeo').value = ''; $('prsTel').value = '';
      $('prsMsg').style.display = 'none';
      m.style.display = 'block';
      const close = (val) => { m.style.display = 'none'; resolve(val); };
      $('prsClose').onclick = $('prsCancel').onclick = () => close(null);
      $('prsBack').onclick = (e) => { if (e.target.id === 'prsBack') close(null); };
      $('prsSubmit').onclick = async () => {
        const name = ($('prsName').value || '').trim();
        if (!name) { $('prsMsg').textContent = '⚠ 매장명을 입력하세요'; $('prsMsg').style.display='block'; $('prsName').focus(); return; }
        const sub = $('prsSubmit');
        sub.disabled = true; sub.textContent = '⏳ 등록 중...';
        const res = await registerStoreAsOfficial({
          name,
          biz:  ($('prsBiz').value || '').trim(),
          addr: ($('prsAddr').value || '').trim(),
          ceo:  ($('prsCeo').value || '').trim(),
          tel:  ($('prsTel').value || '').trim(),
        });
        sub.disabled = false; sub.textContent = '⭐ 정식 등록';
        if (res.ok) {
          showToast(`⭐ ${name} 정식 등록 완료`);
          close(res.store);
        } else if (res.store) {
          $('prsMsg').textContent = 'ℹ️ ' + (res.error || '이미 등록된 매장') + ' — 자동 선택됩니다';
          $('prsMsg').style.display='block';
          setTimeout(() => close(res.store), 600);
        } else {
          $('prsMsg').textContent = '⚠ ' + (res.error || '등록 실패');
          $('prsMsg').style.display='block';
        }
      };
      setTimeout(() => $('prsName').focus(), 50);
    });
  }

  // ── 첨부 (사진 + 파일) 업로드 — POST /api/upload (multipart) ────
  async function uploadAttachment(file, opts) {
    opts = opts || {};
    const fd = new FormData();
    fd.append('file', file);
    if (opts.kind)     fd.append('kind', opts.kind);
    if (opts.name)     fd.append('name', opts.name || file.name);
    if (opts.jobId)    fd.append('jobId', opts.jobId);
    if (opts.category) fd.append('category', opts.category);
    if (opts.threadId) fd.append('threadId', opts.threadId);
    const res = await fetch('/api/upload', { method:'POST', body:fd });
    if (!res.ok) {
      const txt = await res.text().catch(()=> '');
      throw new Error('upload_failed_' + res.status + (txt ? ':' + txt.slice(0,80) : ''));
    }
    return await res.json();
  }

  // ── 모바일 첨부 picker UI — 호스트 element 에 마운트 ────
  // opts: { jobId?, category?, threadId?, onChange? }
  // 반환: { get(): [], clear(), destroy() }
  // 다중 인스턴스 지원 — window._atpRegistry 로 onclick 라우팅
  const _atpRegistry = window._atpRegistry = window._atpRegistry || {};
  window._atpRemove = function(id, idx) {
    const r = _atpRegistry[id];
    if (!r) return;
    r.state.splice(idx, 1);
    r.render();
    if (r.onChange) r.onChange(r.state);
  };
  function mountAttachPicker(host, opts) {
    if (!host) return null;
    opts = opts || {};
    const id = 'atp-' + Math.random().toString(36).slice(2, 8);
    const state = [];
    host.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <input type="file" id="${id}-img" accept="image/*" capture="environment" style="display:none">
        <input type="file" id="${id}-file" style="display:none" multiple>
        <button type="button" onclick="document.getElementById('${id}-img').click()"
          style="padding:6px 10px;font-size:11.5px;background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;border-radius:7px;font-weight:700;cursor:pointer">📷 사진</button>
        <button type="button" onclick="document.getElementById('${id}-file').click()"
          style="padding:6px 10px;font-size:11.5px;background:#F3F4F6;border:1px solid #D1D5DB;color:#4B5563;border-radius:7px;font-weight:700;cursor:pointer">📎 파일</button>
        <span id="${id}-busy" style="font-size:11px;color:#9CA3AF;display:none">⏳ 업로드 중...</span>
      </div>
      <div id="${id}-grid" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px"></div>
    `;
    const gridEl = host.querySelector('#' + id + '-grid');
    const busyEl = host.querySelector('#' + id + '-busy');
    function render() {
      gridEl.innerHTML = state.map((a, i) => {
        if (a.kind === 'image' && a.url) {
          return `<div style="position:relative;width:54px;height:54px;border-radius:7px;background:#fff;border:1px solid #E5E7EB;overflow:hidden">
            <img src="${a.url}" style="width:100%;height:100%;object-fit:cover" alt="">
            <button type="button" onclick="window._atpRemove('${id}', ${i})" style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;border-radius:50%;background:#EF4444;color:#fff;border:2px solid #fff;font-size:10px;cursor:pointer;padding:0;line-height:1">×</button>
          </div>`;
        }
        const nm = String(a.name || a.key || 'file').replace(/^.*\//, '').slice(0, 16);
        return `<div style="position:relative;display:inline-flex;align-items:center;gap:5px;padding:5px 8px;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:7px;font-size:11px;color:#4B5563">
          <span>📄 ${nm}</span>
          <button type="button" onclick="window._atpRemove('${id}', ${i})" style="background:transparent;border:none;color:#9CA3AF;cursor:pointer;font-size:13px;padding:0">×</button>
        </div>`;
      }).join('');
    }
    async function handleFiles(fileList, kind) {
      if (!fileList || fileList.length === 0) return;
      busyEl.style.display = 'inline';
      for (const f of fileList) {
        try {
          const res = await uploadAttachment(f, { kind, jobId: opts.jobId, category: opts.category, threadId: opts.threadId, name: f.name });
          if (res && res.ok) state.push(res);
        } catch(e) {
          showToast('⚠ 업로드 실패: ' + (e.message || e));
        }
      }
      busyEl.style.display = 'none';
      render();
      if (opts.onChange) opts.onChange(state);
    }
    host.querySelector('#' + id + '-img').addEventListener('change', e => { handleFiles(e.target.files, 'image'); e.target.value = ''; });
    host.querySelector('#' + id + '-file').addEventListener('change', e => { handleFiles(e.target.files, 'file'); e.target.value = ''; });
    _atpRegistry[id] = { state, render, onChange: opts.onChange };
    return {
      id,
      get: () => state.slice(),
      clear: () => { state.length = 0; render(); },
      destroy: () => { delete _atpRegistry[id]; host.innerHTML = ''; },
    };
  }

  // ── STOCKTAKE — index.html L5923 (키: ns_stocktake 단수) ────
  function getStocktakes() {
    try { return JSON.parse(localStorage.getItem('ns_stocktake') || '[]'); } catch { return []; }
  }
  function saveStocktakes(arr) {
    try {
      localStorage.setItem('ns_stocktake', JSON.stringify(arr));
    } catch(e){ console.warn('saveStocktakes failed', e); }
  }

  // ── JOBS — index.html L12838 / L12841 ───────────────────────
  function getJobs() {
    try { return JSON.parse(localStorage.getItem('ns_jobs') || '[]'); } catch { return []; }
  }
  // 🕐 per-job mtime 자동 스탬프 (PC index.html 과 동일 정책, 2026-05-22)
  function _jobHashForMtime(j) {
    if (!j || typeof j !== 'object') return '';
    const out = {};
    const keys = Object.keys(j).sort();
    for (const k of keys) {
      if (k === 'updatedAt') continue;
      out[k] = j[k];
    }
    try { return JSON.stringify(out); } catch { return ''; }
  }
  function _loadJobsSnap() {
    try { return JSON.parse(localStorage.getItem('ns_jobs_snap') || '{}') || {}; } catch { return {}; }
  }
  function _saveJobsSnap(snap) {
    try { localStorage.setItem('ns_jobs_snap', JSON.stringify(snap || {})); } catch(_){}
  }
  function _refreshJobsSnap() {
    try {
      const arr = getJobs();
      const snap = {};
      for (const j of arr) {
        if (j && j.id) snap[String(j.id)] = _jobHashForMtime(j);
      }
      _saveJobsSnap(snap);
    } catch(_){}
  }

  function saveJobs(arr) {
    // 🛡 id 기준 dedup — 중복 등록 방어 (PC 와 동일)
    let safe = arr;
    if (Array.isArray(arr)) {
      const seenIds = new Set();
      safe = [];
      let dupes = 0;
      for (const j of arr) {
        if (!j) continue;
        const id = j.id;
        if (id && seenIds.has(id)) { dupes++; continue; }
        if (id) seenIds.add(id);
        safe.push(j);
      }
      if (dupes > 0) console.warn('[saveJobs] 동일 id job', dupes, '건 dedup');
    }
    // 🕐 변경 감지 + 자동 mtime 스탬프
    try {
      const snap = _loadJobsSnap();
      const newSnap = {};
      const now = new Date().toISOString();
      for (const j of (Array.isArray(safe) ? safe : [])) {
        if (!j || !j.id) continue;
        const h = _jobHashForMtime(j);
        if (snap[String(j.id)] !== h) {
          j.updatedAt = now;
        }
        newSnap[String(j.id)] = h;
      }
      _saveJobsSnap(newSnap);
    } catch(_){}
    localStorage.setItem('ns_jobs', JSON.stringify(safe));
    scheduleAutoBackup();
    schedulePushJobsToCloud();
  }

  /* ═══════════════════════════════════════════════════════════
   * TOMBSTONE — index.html L12879 ~ L12909
   * ═══════════════════════════════════════════════════════════ */
  function _addTombstone(type, id, jobId) {
    if (!type || !id) return;
    try {
      const key = 'ns_tombstones';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.push({ type, id, jobId: jobId || null, ts: Date.now() });
      const cutoff = Date.now() - 30*24*3600*1000;
      const fresh = list.filter(t => (t.ts||0) >= cutoff);
      localStorage.setItem(key, JSON.stringify(fresh));
    } catch(e) { console.warn('[_addTombstone]', e); }
  }
  function _getTombstones() {
    try { return JSON.parse(localStorage.getItem('ns_tombstones') || '[]'); }
    catch { return []; }
  }
  function _isTombstoned(type, id, jobId) {
    if (!type || !id) return false;
    const list = _getTombstones();
    return list.some(t => t.type === type && t.id === id && (jobId == null || t.jobId == null || t.jobId === jobId));
  }
  function _isJobTombstoned(jobId) { return _isTombstoned('job', jobId); }
  function _isThreadTombstoned(threadId, jobId) {
    return _isTombstoned('thread', threadId, jobId);
  }
  function _isThreadChildOfTombstonedRoot(parentId, jobId) {
    if (!parentId) return false;
    return _isTombstoned('thread-children', parentId, jobId);
  }

  /* ═══════════════════════════════════════════════════════════
   * 클라우드 동기화 — index.html L12913 / L12993 / L13037
   * ═══════════════════════════════════════════════════════════ */
  function _mergeJobRecord(localJob, cloudJob) {
    if (!localJob) return cloudJob;
    if (!cloudJob) return localJob;
    const merged = Object.assign({}, cloudJob, localJob);
    // ── thread union
    const seen = new Map();
    const noKey = [];
    const mergeAttList = (a1, a2) => {
      const m = new Map();
      (Array.isArray(a1)?a1:[]).concat(Array.isArray(a2)?a2:[]).forEach(x => {
        if (x && x.key && !m.has(x.key)) m.set(x.key, x);
      });
      return [...m.values()];
    };
    const addEntry = (e) => {
      if (!e) return;
      if (e.threadId) {
        const existing = seen.get(e.threadId);
        if (!existing) seen.set(e.threadId, e);
        else {
          const newAtts = mergeAttList(existing.attachments, e.attachments);
          if (newAtts.length) existing.attachments = newAtts;
        }
      } else {
        const k = (e.ts||'') + '|' + (e.text||'');
        if (!noKey.find(x => ((x.ts||'')+'|'+(x.text||'')) === k)) noKey.push(e);
      }
    };
    (cloudJob.thread || []).forEach(addEntry);
    (localJob.thread || []).forEach(addEntry);
    let _merged = [...seen.values(), ...noKey];
    // 🪦 tombstone 적용
    const jobIdForTomb = (localJob && localJob.id) || (cloudJob && cloudJob.id) || null;
    _merged = _merged.filter(e => {
      if (!e) return false;
      if (e.threadId && _isThreadTombstoned(e.threadId, jobIdForTomb)) return false;
      if (e.parentId && _isThreadChildOfTombstonedRoot(e.parentId, jobIdForTomb)) return false;
      return true;
    });
    merged.thread = _merged.sort((a,b) => String(a.ts||'').localeCompare(String(b.ts||'')));
    // ── memos union
    const mSeen = new Map();
    [...(cloudJob.memos||[]), ...(localJob.memos||[])].forEach(m => {
      if (!m) return;
      const k = (m.at||'') + '|' + (m.text||'');
      if (!mSeen.has(k)) mSeen.set(k, m);
    });
    if (mSeen.size > 0 || (cloudJob.memos || localJob.memos)) merged.memos = [...mSeen.values()];
    // ── vandocs
    if (localJob.vandocs || cloudJob.vandocs) {
      merged.vandocs = Object.assign({}, cloudJob.vandocs||{}, localJob.vandocs||{});
    }
    // ── job 레벨 첨부 union
    {
      const cA = Array.isArray(cloudJob.attachments) ? cloudJob.attachments : [];
      const lA = Array.isArray(localJob.attachments) ? localJob.attachments : [];
      if (cA.length || lA.length) {
        const seenAtt = new Map();
        cA.concat(lA).forEach(a => {
          if (!a || !a.key) return;
          if (!seenAtt.has(a.key)) seenAtt.set(a.key, a);
        });
        merged.attachments = [...seenAtt.values()];
      }
    }
    merged.completed = !!(localJob.completed || cloudJob.completed);
    if (localJob.completed && localJob.doneAt) merged.doneAt = localJob.doneAt;
    else if (cloudJob.completed && cloudJob.doneAt) merged.doneAt = cloudJob.doneAt;
    // 🛡 status 보전 — completed 면 status 도 완료계열로 (샤르르 reopen 차단, 2026-05-22)
    if (merged.completed) {
      const cat = (typeof classifyJobCategory === 'function') ? classifyJobCategory(merged) : '';
      const doneStr = (cat === 'as') ? '처리완료' : '완료';
      if (merged.status !== '완료' && merged.status !== '처리완료') {
        merged.status = doneStr;
      }
      merged.completedAt = localJob.completedAt || cloudJob.completedAt || merged.completedAt || '';
    }
    return merged;
  }

  async function syncJobsFromCloud() {
    try {
      const res = await fetch('/api/jobs', { cache:'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      // 🔁 resync_token — 토큰 불일치 시 강제 정합화
      const cloudToken = String(data?.resyncToken || '');
      const localToken = (function(){ try { return localStorage.getItem('ns_resync_token') || ''; } catch { return ''; } })();
      if (cloudToken && cloudToken !== localToken) {
        const cloudJobsRaw = Array.isArray(data?.jobs) ? data.jobs : [];
        const cloudDeletedRaw = Array.isArray(data?.deleted) ? data.deleted : [];
        const delIds = new Set(cloudDeletedRaw.map(e => String(e && e.id || '')).filter(Boolean));
        const clean = cloudJobsRaw.filter(j => j && j.id && !delIds.has(j.id));
        try { localStorage.setItem('ns_jobs', JSON.stringify(clean)); } catch(_){}
        try { localStorage.setItem('ns_resync_token', cloudToken); } catch(_){}
        try { _refreshJobsSnap(); } catch(_){}  // 🕐 snapshot 동기화
        for (const id of delIds) { try { _addTombstone('job', id); } catch(_){} }
        global._lastJobsPushHash = null;
        try { _selfHealJobStatuses(); } catch(_){}
        return;
      }
      const local = (function(){ try { return JSON.parse(localStorage.getItem('ns_jobs')||'[]'); } catch { return []; } })();
      const cloud = Array.isArray(data?.jobs) ? data.jobs : [];
      // 🪦 서버 측 삭제 레지스트리 적용 — 다른 기기에서 admin-delete 된 항목을 이 기기에서도 자동 제거
      const cloudDeleted = Array.isArray(data?.deleted) ? data.deleted : [];
      const cloudDeletedIds = new Set(cloudDeleted.map(e => String(e && e.id || '')).filter(Boolean));
      if (cloudDeletedIds.size > 0 && typeof _addTombstone === 'function') {
        for (const id of cloudDeletedIds) {
          if (!_isJobTombstoned(id)) {
            try { _addTombstone('job', id); } catch(_){}
          }
        }
      }
      const byId = new Map();
      local.forEach(j => {
        if (!j || !j.id) return;
        if (_isJobTombstoned(j.id)) return;
        if (cloudDeletedIds.has(j.id)) return;
        byId.set(j.id, j);
      });
      let mergedCount = 0;
      cloud.forEach(j => {
        if (!j || !j.id) return;
        if (_isJobTombstoned(j.id)) return;
        if (cloudDeletedIds.has(j.id)) return;
        const existing = byId.get(j.id);
        if (existing) mergedCount++;
        byId.set(j.id, _mergeJobRecord(existing, j));
      });
      const dedupSeen = new Set();
      const merged = [];
      for (const j of byId.values()) {
        if (!j || !j.id) continue;
        if (dedupSeen.has(j.id)) continue;
        dedupSeen.add(j.id);
        merged.push(j);
      }
      localStorage.setItem('ns_jobs', JSON.stringify(merged));
      try { _refreshJobsSnap(); } catch(_){}  // 🕐 snapshot 동기화
      // 🩹 sync 후 status 와 thread 정합성 자동 보정 — 옛 데이터의 drift 자가 치료
      try { _selfHealJobStatuses(); } catch(_){}
      if (merged.length > cloud.length || mergedCount > 0) {
        schedulePushJobsToCloud();
      }
    } catch(e) { /* 네트워크 실패 무시 */ }
  }

  let _pushJobsTimer = null;
  function schedulePushJobsToCloud() {
    if (_pushJobsTimer) clearTimeout(_pushJobsTimer);
    _pushJobsTimer = setTimeout(() => { pushJobsToCloud(); }, 5000);
  }
  async function pushJobsToCloud(opts) {
    const jobs = (function(){ try { return JSON.parse(localStorage.getItem('ns_jobs')||'[]'); } catch { return []; } })();
    const body = JSON.stringify({ jobs });
    const h = _fastHash(body);
    if (!opts || !opts.force) {
      if (global._lastJobsPushHash === h) {
        return { ok:true, skipped:true, count: jobs.length };
      }
    }
    try {
      const res = await fetch('/api/jobs', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body,
      });
      if (!res.ok) {
        let detail = ''; try { detail = await res.text(); } catch(_){}
        const limitHit = /KV put.*limit exceeded/i.test(detail);
        if (limitHit && !global._kvLimitToastShown) {
          global._kvLimitToastShown = true;
          try { showToast('⚠ 클라우드 동기화 한도 초과 — 익일 09:00 자동 해제'); } catch(_){}
        } else if (opts && opts.toast) {
          showToast(`⚠ 클라우드 푸시 실패 (${res.status})`);
        }
        return { ok:false, status:res.status, limitHit };
      }
      const data = await res.json();
      global._lastJobsPushHash = h;
      if (opts && opts.toast) showToast(`☁ 동기화 완료 (${data.count}건)`);
      return { ok:true, ...data };
    } catch(e) {
      if (opts && opts.toast) showToast('⚠ 푸시 실패 (네트워크)');
      return { ok:false, error:String(e) };
    }
  }

  /* ═══════════════════════════════════════════════════════════
   * 분류 / 정규화 — index.html L5108 / L9881 / L22825
   * ═══════════════════════════════════════════════════════════ */
  function classifyJobCategory(j) {
    if (!j) return 'as';
    const lc = String(j.lineCategory || '').toLowerCase();
    const tp = String(j.type || j.category || '').toLowerCase();
    const all = lc + ' ' + tp;
    if (/label|equip_out|delivery|라벨|영수증|프라이스텍|소모품|택배/.test(all)) return 'supplies';
    if (/van_doc|밴서류|van.*신규|van.*재신고|van.*정산|van.*계약|van.*변경/.test(all)) return 'van';
    if (/open_store|오픈|신규|new_open|newopen/.test(all)) return 'new';
    if (/churn|폐업|매각|해지|이탈/.test(all)) return 'churn';
    if (/pos_as|van_as|device_mgmt|as_pos|단말|a\/s|as\s|에이에스/.test(all)) return 'as';
    return 'as';
  }
  function _isJobDone(j) {
    if (!j) return false;
    const s = String(j.status || '');
    return s === '완료' || s === '처리완료' || s === 'done';
  }
  /* 🎯 _isJobEffectivelyDone — status OR thread ROOT 전체 완료 검사
     옛 데이터의 status='접수' 인데 thread 다 끝난 경우도 done 처리. PC 와 동일 규칙. */
  function _isJobEffectivelyDone(j) {
    if (!j) return false;
    if (_isJobDone(j)) return true;
    const thread = Array.isArray(j.thread) ? j.thread : [];
    if (thread.length === 0) return false;
    const norm = (typeof _threadMigrate === 'function') ? _threadMigrate(thread) : thread;
    const roots = norm.filter(e => e && e.parentId == null);
    if (roots.length === 0) return false;
    const allRootsDone = roots.every(r => {
      const kids = norm.filter(e => e.parentId === r.threadId);
      return kids.some(k => k.status === '완료');
    });
    if (!allRootsDone) return false;
    // 신규 카테고리 openDate 가드
    try {
      if (classifyJobCategory(j) === 'new') {
        const todayStr = String(_kstNow()||'').slice(0,10);
        const od = String(j.openDate||'').slice(0,10);
        if (od && od >= todayStr) return false;
      }
    } catch(_){}
    return true;
  }
  /* 🩹 _selfHealJobStatuses — 로컬 jobs 의 status 와 thread 가 어긋난 경우 자동 보정
     mobile sync 시 호출. drift 있으면 saveJobs + 푸시 트리거. */
  function _selfHealJobStatuses() {
    try {
      const jobs = getJobs();
      let dirty = false;
      const _today = String(_kstNow()||'').slice(0,10);
      for (const j of jobs) {
        if (!j || !j.thread || !Array.isArray(j.thread) || j.thread.length === 0) continue;
        const norm = _threadMigrate(j.thread);
        const roots = norm.filter(e => e && e.parentId == null);
        if (roots.length === 0) continue;
        const allDone = roots.every(r => {
          const kids = norm.filter(e => e.parentId === r.threadId);
          return kids.some(k => k.status === '완료');
        });
        const cat = classifyJobCategory(j);
        // 신규 openDate 가드
        let blockAutoDone = false;
        if (cat === 'new') {
          const od = String(j.openDate||'').slice(0,10);
          if (od && od >= _today) blockAutoDone = true;
        }
        const wasDone = _isJobDone(j);
        if (allDone && !blockAutoDone && !wasDone) {
          j.status = (cat === 'as') ? '처리완료' : '완료';
          j.completed = true;
          j.completedAt = j.completedAt || new Date().toISOString();
          dirty = true;
        }
        // ⛔️ 역방향 (완료→진행중) 자동 환원 제거 — 샤르르 reopen 루프 차단 (2026-05-22)
        //   stale thread (다른 기기가 추가한 완료 child 가 아직 동기화 안 됨) 때문에
        //   자동 환원이 cloud 의 완료 상태를 덮어쓰는 문제. completed 는 sticky.
        //   진짜 reopen 은 사용자가 명시적으로 thread 편집할 때만 발생해야 함.
      }
      if (dirty) {
        saveJobs(jobs);
        try { schedulePushJobsToCloud(); } catch(_){}
      }
      return dirty;
    } catch(e) { return false; }
  }
  /* 🆘 _forceResyncFromCloud — 사용자 트리거 강제 재초기화
     localStorage(ns_jobs) 비우고 cloud 에서 새로 받기. 모바일 "🔄 데이터 새로고침" 버튼용. */
  async function _forceResyncFromCloud() {
    try {
      const r1 = await fetch('/api/jobs', { cache:'no-store' });
      const d1 = await r1.json();
      const cloudJobs = Array.isArray(d1?.jobs) ? d1.jobs : [];
      const cloudDeletedJobs = Array.isArray(d1?.deleted) ? d1.deleted : [];
      const r2 = await fetch('/api/stores', { cache:'no-store' });
      const d2 = await r2.json();
      const cloudStores = Array.isArray(d2?.stores) ? d2.stores : [];
      const cloudDeletedStores = Array.isArray(d2?.deleted) ? d2.deleted : [];
      // 삭제 ID set
      const delJobIds = new Set(cloudDeletedJobs.map(e => String(e.id||'')).filter(Boolean));
      const delStoreIds = new Set(cloudDeletedStores.map(e => String(e.id||'')).filter(Boolean));
      const cleanJobs = cloudJobs.filter(j => j && j.id && !delJobIds.has(j.id));
      const cleanStores = cloudStores.filter(s => s && s.id && !delStoreIds.has(s.id));
      localStorage.setItem('ns_jobs', JSON.stringify(cleanJobs));
      localStorage.setItem('ns_stores', JSON.stringify(cleanStores));
      // 삭제 레지스트리를 로컬 tombstone 에도 등록
      for (const id of delJobIds) { try { _addTombstone('job', id); } catch(_){} }
      for (const id of delStoreIds) { try { _addTombstone('store', id); } catch(_){} }
      global._lastJobsPushHash = null;
      return { ok:true, jobs: cleanJobs.length, stores: cleanStores.length };
    } catch(e) {
      return { ok:false, error: String(e) };
    }
  }
  function _normalizeSearch(s) {
    return String(s||'')
      .toLowerCase()
      .replace(/\(주\)|\(유\)|\(합\)|\(재\)|\(사\)/g, '')
      .replace(/주식회사|유한회사|합자회사|합명회사|유한책임회사|재단법인|사단법인/g, '')
      .replace(/[()[\]{}<>「」]/g, '')
      .replace(/[._\-·\/\\,'"!?@#%&*+=:;|~`]/g, '')
      .replace(/\s+/g, '');
  }

  /* ═══════════════════════════════════════════════════════════
   * Thread 시스템 — index.html L18565 / L18571 / L18609
   * ═══════════════════════════════════════════════════════════ */
  function _normalizeStatus(s) {
    if (s === '접수') return '요청접수';
    return s || '요청접수';
  }
  function _threadMigrate(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    let lastRootId = null;
    let rand = 0;
    const newId = () => 'TR-' + Date.now() + '-' + (++rand) + '-' + Math.random().toString(36).slice(2,7);
    for (const raw of arr) {
      if (!raw) continue;
      const e = Object.assign({}, raw);
      e.status = _normalizeStatus(e.status);
      if (e.threadId && (e.parentId !== undefined)) {
        if (e.parentId === null && e.status === '요청접수') lastRootId = e.threadId;
        out.push(e);
        continue;
      }
      if (e.status === '요청접수') {
        e.threadId = newId();
        e.parentId = null;
        lastRootId = e.threadId;
      } else {
        if (!lastRootId) {
          const synth = { ts:e.ts||'', author:e.author||'담당자', status:'요청접수', text:'(이전 요청)', threadId:newId(), parentId:null };
          out.push(synth);
          lastRootId = synth.threadId;
        }
        e.threadId = newId();
        e.parentId = lastRootId;
      }
      out.push(e);
    }
    return out;
  }
  function _groupStatus(root, children) {
    if (children.some(c => c.status === '완료')) return '완료';
    if (children.some(c => c.status === '진행')) return '진행';
    return '요청접수';
  }

  /* ═══════════════════════════════════════════════════════════
   * LINE 발송 — index.html L13676 ~ L14098
   * ═══════════════════════════════════════════════════════════ */
  const _LINE_HEAD_BYTES = 140;
  function _byteLen(s) {
    s = String(s == null ? '' : s);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function _sliceByByte(s, maxBytes) {
    s = String(s == null ? '' : s);
    if (_byteLen(s) <= maxBytes) return s;
    let n = 0, out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      let inc;
      if (c < 0x80) inc = 1;
      else if (c < 0x800) inc = 2;
      else if (c >= 0xD800 && c <= 0xDBFF) inc = 4;
      else inc = 3;
      if (n + inc > maxBytes) break;
      n += inc;
      out += s[i];
      if (inc === 4) { out += s[i+1]; i++; }
    }
    return out;
  }

  // 카테고리 공용 메시지 빌더 — index.html L13722
  function _buildEnrichedLineText(rec, opts) {
    if (!rec) return '';
    opts = opts || {};
    const status = rec.status || rec.statusLabel || '';
    const todayKst = (function(){
      const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset() + 9*60);
      return d.toISOString().slice(0,10);
    })();
    const processDate = opts.processDate || rec.doneDate || rec.scheduleDate || rec.consultDate || rec.dueDate || rec.date || todayKst;
    const storeName = rec.storeName || rec.store || '';
    let content = opts.headContent || '';
    if (!content) {
      const head = (rec.memo || rec.text || rec.request || '').replace(/\s+/g,' ').trim();
      content = _sliceByByte(head, _LINE_HEAD_BYTES);
      if (!content) content = status || '업무 등록';
    }
    const headLine = `${storeName} : ${processDate} ; ${content}`;
    const lines = [];
    const schedLabel = opts.scheduleLabel || '📅 예정';
    const sd = rec.scheduleDate || rec.dueDate || rec.installDate || rec.softOpenDate || rec.openDate;
    if (sd && sd !== processDate) lines.push(`${schedLabel} ${sd}`);
    const sizeParts = [];
    if (rec.area)      sizeParts.push(`${rec.area}평`);
    if (rec.headcount) sizeParts.push(`${rec.headcount}명`);
    if (rec.fee)       sizeParts.push(`수수료 ${Number(rec.fee).toLocaleString('ko-KR')}원`);
    if (sizeParts.length) lines.push(`📊 ${sizeParts.join(' · ')}`);
    if (/(완료|정산|마감)/.test(status)) {
      const res = [];
      if (rec.expectedAmount && rec.actualAmount) res.push(`예상 → 실 ${Number(rec.expectedAmount).toLocaleString('ko-KR')} → ${Number(rec.actualAmount).toLocaleString('ko-KR')}원`);
      if (typeof rec.margin === 'number')         res.push(`수익 ${rec.margin >= 0 ? '+':''}${rec.margin.toLocaleString('ko-KR')}원`);
      if (rec.paymentMethod)                      res.push(`수금 ${rec.paymentMethod}`);
      if (res.length) lines.push(`💰 ${res.join(' · ')}`);
    }
    const owner = rec.owner || rec.engineer || rec.assignee || (_currentAuthName() || '');
    const contactBits = [];
    if (rec.contactName)  contactBits.push(rec.contactRole ? `${rec.contactRole} ${rec.contactName}` : rec.contactName);
    if (rec.contactPhone) contactBits.push(rec.contactPhone);
    if (owner || contactBits.length) {
      const parts = [];
      if (owner) parts.push(`담당 ${owner}`);
      if (contactBits.length) parts.push(`거래처 ${contactBits.join(' ')}`);
      lines.push(`👤 ${parts.join(' / ')}`);
    }
    return headLine + (lines.length ? '\n' + lines.join('\n') : '');
  }

  /* ───────────────────────────────────────────────────────────
   * LINE composer — 모바일용 동적 DOM (없으면 자동 생성)
   * ───────────────────────────────────────────────────────── */
  function _ensureLineComposerDOM() {
    if (document.getElementById('lineSendComposerModal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'lineSendComposerModal';
    wrap.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);align-items:flex-end;justify-content:center;padding:0';
    wrap.innerHTML = `
      <div style="background:#fff;width:100%;max-width:540px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;display:flex;flex-direction:column">
        <div style="background:linear-gradient(135deg,#06C755,#04A047);color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
          <div style="font-size:15px;font-weight:800">📡 LINE 메시지 발송</div>
          <button onclick="window._lineSendComposerCancel()" style="background:transparent;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0;width:32px;height:32px">✕</button>
        </div>
        <div style="padding:14px 16px;flex:1;overflow:auto">
          <div id="lsComposerCategoryBar" style="margin-bottom:10px;padding:7px 11px;background:#F3F4F6;border-radius:8px;font-size:11.5px;color:#4B5563;font-weight:600"></div>
          <div style="margin-bottom:10px">
            <label style="font-size:11.5px;color:#4B5563;font-weight:700;display:block;margin-bottom:4px">📂 발송 채팅방</label>
            <select id="lsComposerRoom" style="width:100%;padding:10px 11px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:16px;background:#fff">
              <option value="">— 로딩 중 —</option>
            </select>
            <div style="margin-top:5px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <label style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:14px;font-size:11px;font-weight:700;color:#06A647">
                <input type="checkbox" id="lsComposerSetDefault" style="accent-color:#06C755;margin:0">
                <span id="lsComposerSetDefaultLabel">📌 기본으로 설정</span>
              </label>
              <span id="lsComposerCurDefault" style="font-size:10.5px;color:#6B7280"></span>
            </div>
          </div>
          <div style="margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
              <label style="font-size:11.5px;color:#4B5563;font-weight:700">📝 메시지 본문</label>
              <span id="lsComposerCharCount" style="font-size:10.5px;color:#6B7280;margin-left:auto">0자</span>
            </div>
            <textarea id="lsComposerText" rows="5" style="width:100%;padding:10px 12px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:16px;font-family:inherit;resize:vertical;line-height:1.5"></textarea>
          </div>
          <div id="lsComposerAttBox" style="margin-bottom:10px"></div>
          <div style="margin-bottom:6px">
            <label style="font-size:11.5px;color:#4B5563;font-weight:700;display:block;margin-bottom:4px">👁 LINE 도착 미리보기</label>
            <div id="lsComposerPreview" style="background:#F3F4F6;border:1px dashed #06C755;border-radius:8px;padding:10px 12px;font-size:12.5px;color:#374151;line-height:1.6;white-space:pre-wrap"></div>
          </div>
        </div>
        <div style="padding:10px 16px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #E5E7EB;display:flex;justify-content:space-between;gap:8px;flex-shrink:0">
          <button onclick="window._lineSendComposerCancel()" style="flex:1;padding:11px 14px;background:#fff;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;font-weight:700;color:#374151">취소</button>
          <button id="lsComposerSendBtn" onclick="window._lineSendComposerSubmit()" style="flex:1.4;padding:11px 14px;background:#06C755;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:800">
            <span class="ls-send-label">📡 LINE 발송</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }
  function _showLineModal()  { _ensureLineComposerDOM(); const m=document.getElementById('lineSendComposerModal'); if (m) m.style.display='flex'; }
  function _closeLineModal() { const m=document.getElementById('lineSendComposerModal'); if (m) m.style.display='none'; }

  function _strEsc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  // ── 카테고리별 LINE composer (PC 와 동일 동작) ───────────────
  function _openLineSendComposer(opts) {
    opts = opts || {};
    _ensureLineComposerDOM();
    const ta       = document.getElementById('lsComposerText');
    const roomSel  = document.getElementById('lsComposerRoom');
    const charCount= document.getElementById('lsComposerCharCount');
    const catBar   = document.getElementById('lsComposerCategoryBar');
    const attBox   = document.getElementById('lsComposerAttBox');
    const previewEl= document.getElementById('lsComposerPreview');
    const sendBtn  = document.getElementById('lsComposerSendBtn');

    const category = opts.category || 'memo';
    const labelDict = {stocktake:'📦 재고조사', as:'🔧 AS', newjob:'🆕 신규', van:'📑 VAN', supply:'🛒 소모품', memo:'📝 메모'};
    const categoryLabel = opts.categoryLabel || labelDict[category] || '메시지';
    catBar.textContent = categoryLabel;
    ta.value = opts.defaultText || '';
    const attachments = Array.isArray(opts.attachments) ? opts.attachments.slice() : [];
    const images = attachments.filter(a => a && a.kind === 'image' && /^https:/.test(a.url||''));
    const files  = attachments.filter(a => a && a.kind === 'file'  && /^https:/.test(a.url||''));

    if (images.length || files.length) {
      const imgStrip = images.length ? `
        <div style="font-size:11px;color:#4B5563;font-weight:700;margin-bottom:4px">📷 이미지 ${images.length}장</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
          ${images.slice(0,4).map(i => `<div style="width:46px;height:46px;border-radius:5px;background:#1F2937 url('${i.url}') center/cover no-repeat;border:1px solid #D1D5DB"></div>`).join('')}
        </div>` : '';
      const fileStrip = files.length ? `
        <div style="font-size:11px;color:#4B5563;font-weight:700;margin-bottom:4px">📎 파일 ${files.length}개</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${files.map(f => `<div style="font-size:11px;color:#374151;padding:4px 8px;background:#F3F4F6;border-radius:5px">${_strEsc(f.name||'')}</div>`).join('')}
        </div>` : '';
      attBox.innerHTML = `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:8px 10px">${imgStrip}${fileStrip}</div>`;
    } else {
      attBox.innerHTML = '';
    }

    function updatePreview() {
      const text = ta.value;
      const firstLine = (text.split('\n')[0] || '');
      const headBytes = _byteLen(firstLine);
      charCount.textContent = `${text.length}자 · 첫줄 ${headBytes}/${_LINE_HEAD_BYTES}byte`;
      charCount.style.color = (headBytes > _LINE_HEAD_BYTES) ? '#DC2626' : '#6B7280';
      let preview = text;
      if (files.length) {
        preview += '\n\n📎 파일:';
        files.forEach(f => { preview += `\n· ${f.name||''} ${f.url}`; });
      }
      if (images.length) preview += `\n\n+ 이미지 ${Math.min(images.length,4)}장`;
      previewEl.textContent = preview || '(메시지 비어있음)';
    }
    ta.oninput = updatePreview;
    updatePreview();

    const catLabelMap = { stocktake:'재고조사', as:'AS', newjob:'신규', van:'VAN', supply:'소모품', memo:'메모' };
    const setDefaultLbl = document.getElementById('lsComposerSetDefaultLabel');
    const curDefaultEl  = document.getElementById('lsComposerCurDefault');
    const setDefaultChk = document.getElementById('lsComposerSetDefault');
    if (setDefaultChk) setDefaultChk.checked = false;
    if (setDefaultLbl) setDefaultLbl.textContent = `📌 [${catLabelMap[category]||category}] 기본 설정`;
    if (curDefaultEl)  curDefaultEl.textContent = '';

    roomSel.innerHTML = '<option value="">— 로딩 중 —</option>';
    fetch('/api/line-rooms', { cache:'no-store' }).then(r => r.json()).then(d => {
      const rooms = Array.isArray(d.rooms) ? d.rooms : [];
      const catRooms = d.categoryRooms || {};
      const defaultRoom = opts.defaultTo || catRooms[category] || '';
      if (curDefaultEl) {
        if (catRooms[category]) {
          const cur = rooms.find(r => r.id === catRooms[category]);
          curDefaultEl.textContent = `현재 기본: ${cur && cur.name ? cur.name : (catRooms[category].slice(0,12)+'…')}`;
        } else {
          curDefaultEl.textContent = '현재 기본 미설정';
          curDefaultEl.style.color = '#B45309';
        }
      }
      if (global._lineSendComposerState) {
        global._lineSendComposerState.currentDefaultRoom = catRooms[category] || '';
        global._lineSendComposerState.allCategoryRooms   = catRooms;
      }
      const sorted = [...rooms].sort((a,b) => {
        if (a.mapped !== b.mapped) return a.mapped ? -1 : 1;
        const oa = a.roomType==='group'?0 : a.roomType==='room'?1 : 2;
        const ob = b.roomType==='group'?0 : b.roomType==='room'?1 : 2;
        return oa - ob;
      });
      const opts2 = ['<option value="">— 채팅방 선택 —</option>'];
      let foundDefault = false;
      sorted.forEach(r => {
        const icon = r.roomType==='user'?'👤':r.roomType==='group'?'👥':'💬';
        const label = r.name || r.lastSender || (r.id||'').slice(0,16)+'…';
        const mappedMark = r.mapped ? ' ✓' : '';
        const catMark = (r.id === catRooms[category]) ? ' (기본)' : '';
        const isSel = (r.id === defaultRoom);
        if (isSel) foundDefault = true;
        opts2.push(`<option value="${_strEsc(r.id)}" ${isSel?'selected':''}>${icon} ${_strEsc(label)}${mappedMark}${catMark}</option>`);
      });
      if (defaultRoom && !foundDefault) {
        opts2.splice(1, 0, `<option value="${_strEsc(defaultRoom)}" selected>🔒 (기본: ${_strEsc(defaultRoom.slice(0,16))}…)</option>`);
      }
      roomSel.innerHTML = opts2.join('');
      if (!roomSel.value && roomSel.options.length > 1) {
        for (const opt of roomSel.options) {
          if (opt.value) { roomSel.value = opt.value; break; }
        }
      }
    }).catch(e => {
      roomSel.innerHTML = '<option value="">— 채팅방 목록 로딩 실패 —</option>';
      console.warn('line-rooms fetch failed', e);
    });

    global._lineSendComposerState = {
      category, attachments, images, files,
      jobId: opts.jobId || '',
      onSent: typeof opts.onSent === 'function' ? opts.onSent : null,
      onCancel: typeof opts.onCancel === 'function' ? opts.onCancel : null,
    };
    sendBtn.disabled = false;
    const lbl = sendBtn.querySelector('.ls-send-label'); if (lbl) lbl.textContent = 'LINE 발송';
    _showLineModal();
    setTimeout(() => { try { ta.focus(); } catch(_){} }, 100);
  }

  function _lineSendComposerCancel() {
    const st = global._lineSendComposerState || {};
    _closeLineModal();
    if (typeof st.onCancel === 'function') { try { st.onCancel(); } catch(_){} }
    global._lineSendComposerState = null;
  }

  async function _lineSendComposerSubmit() {
    const st = global._lineSendComposerState || {};
    const ta = document.getElementById('lsComposerText');
    const roomSel = document.getElementById('lsComposerRoom');
    const sendBtn = document.getElementById('lsComposerSendBtn');
    const text = (ta?.value || '').trim();
    const to = roomSel?.value || '';
    if (!text) { showToast('⚠ 메시지를 입력하세요'); return; }
    if (!to)   { showToast('⚠ 발송 채팅방을 선택하세요'); return; }
    sendBtn.disabled = true;
    const lbl = sendBtn.querySelector('.ls-send-label'); if (lbl) lbl.textContent = '발송 중...';
    try {
      const r = await fetch('/api/line-send', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({
          text, category: st.category, to,
          images: st.images || [], files: st.files || [],
          jobId: st.jobId || '',
        }),
      });
      const d = await r.json().catch(()=>({}));
      if (d.ok) {
        showToast(`📡 LINE 발송 완료 (${d.count||1}건)`);
        // 기본 채팅방 저장
        try {
          const setDefault = !!document.getElementById('lsComposerSetDefault')?.checked;
          if (setDefault && to && to !== st.currentDefaultRoom) {
            const pin = localStorage.getItem('line_admin_pin') || '';
            const updated = Object.assign({}, st.allCategoryRooms || {}, { [st.category]: to });
            const url = '/api/line-config' + (pin ? ('?admin='+encodeURIComponent(pin)) : '');
            fetch(url, {
              method:'POST', headers:{'content-type':'application/json'},
              body: JSON.stringify({ categoryRooms: updated }),
            }).then(rr => rr.json()).then(dd => {
              if (dd && dd.ok) showToast(`📌 [${st.category}] 기본 채팅방 저장됨`);
              else if (dd && dd.error === 'unauthorized') showToast('⚠ 기본 저장 실패 — 관리자 PIN 필요');
            }).catch(_=>{});
          }
        } catch(_){}
        if (typeof st.onSent === 'function') { try { st.onSent({ text, to, ok:true, count:d.count }); } catch(_){} }
        _closeLineModal();
        global._lineSendComposerState = null;
      } else {
        showToast(`⚠ 발송 실패: ${d.error||r.status}`);
        sendBtn.disabled = false;
        if (lbl) lbl.textContent = '재시도';
      }
    } catch(e) {
      showToast('⚠ 발송 실패 (네트워크)');
      sendBtn.disabled = false;
      if (lbl) lbl.textContent = '재시도';
    }
  }

  // ── job 객체로 LINE composer 열기 — index.html L13783 ────────
  function _openLineForJob(job, opts) {
    if (!job) return;
    opts = opts || {};
    let category = opts.category;
    if (!category) {
      const detected = classifyJobCategory(job);
      if (detected === 'supplies') category = 'supply';
      else if (detected === 'new')  category = 'newjob';
      else if (detected === 'as')   category = 'as';
      else if (detected === 'van')  category = 'van';
      else category = 'newjob';
    }
    const labelMap = { as:'🔧 AS', newjob:'🆕 신규', van:'💳 VAN', stocktake:'📦 재고조사', supply:'🛒 소모품판매' };
    const scheduleLabelMap = { as:'📅 처리예정', newjob:'📅 설치예정', van:'📅 진행일', stocktake:'📅 조사예정', supply:'📅 발송예정' };

    const entry = opts.entry;
    let headContent = '';
    let attachments = Array.isArray(job.attachments) ? job.attachments.slice() : [];
    const _bSlice = (s) => _sliceByByte(s, _LINE_HEAD_BYTES);
    if (entry) {
      headContent = _bSlice((entry.text || '').replace(/\s+/g,' ').trim());
      if (Array.isArray(entry.attachments) && entry.attachments.length) {
        attachments = entry.attachments;
      }
    } else if (Array.isArray(job.thread) && job.thread.length) {
      const latest = job.thread.slice().sort((a,b)=>(b.ts||'').localeCompare(a.ts||''))[0];
      if (latest) {
        headContent = _bSlice((latest.text || '').replace(/\s+/g,' ').trim());
        if (Array.isArray(latest.attachments) && latest.attachments.length) {
          const seen = new Set(attachments.map(a => a.key || a.url));
          latest.attachments.forEach(a => {
            const k = a.key || a.url;
            if (!seen.has(k)) { attachments.push(a); seen.add(k); }
          });
        }
      }
    }
    if (!headContent) headContent = _bSlice(job.memo || job.notes || job.type || '업무 등록');

    const rec = Object.assign({}, job, {
      storeName: job.storeName || job.store || '',
      status:    (entry && entry.status) || job.status || (job.completed ? '완료' : '진행중'),
      scheduleDate: job.scheduleDate || job.asDueDate || job.installDate || job.softOpenDate || job.openDate || job.date || '',
      contactName: job.contactName || '',
      contactPhone: job.contactPhone || '',
      contactRole: job.contactRole || '',
      owner: job.owner || job.engineer || job.assignee || '',
      memo: headContent,
    });
    let defaultText = _buildEnrichedLineText(rec, { scheduleLabel: scheduleLabelMap[category] || '📅 예정', headContent });
    // opts.extraPrefix — 호출 측에서 메시지 본문 앞에 붙이고 싶은 텍스트 (예: 요청접수 내용 + 설치 장비 목록)
    if (opts.extraPrefix && typeof opts.extraPrefix === 'string') {
      defaultText = opts.extraPrefix.trim() + '\n\n' + defaultText;
    }

    _openLineSendComposer({
      category,
      categoryLabel: `${labelMap[category] || ''} — ${rec.status || ''}`,
      defaultText,
      attachments,
      jobId: job.id,
      onSent: (result) => {
        try {
          const jobs = getJobs();
          const i = jobs.findIndex(x => x.id === job.id);
          if (i >= 0) {
            jobs[i].lineHistory = Array.isArray(jobs[i].lineHistory) ? jobs[i].lineHistory : [];
            jobs[i].lineHistory.push({
              at: (new Date()).toISOString(),
              ok: !!(result && result.ok),
              count: result && result.count,
              text: defaultText.slice(0, 200),
            });
            saveJobs(jobs);
          }
        } catch(e){ console.warn('[openLineForJob] history save failed', e); }
      },
    });
  }

  // ── thread entry 발송 (entity-aware) — index.html L19076 ─────
  function _openLineForThreadEntry(containerId, jobId, entry) {
    if (!entry || !jobId) return;
    try {
      const jobs = getJobs();
      const job = jobs.find(j => j.id === jobId);
      if (!job) return;
      _openLineForJob(job, { entry });
    } catch(e) { console.warn('[_openLineForThreadEntry]', e); }
  }

  /* ═══════════════════════════════════════════════════════════
   * window 노출 — PC SPA 와 같은 함수명으로 export
   * ═══════════════════════════════════════════════════════════ */
  // 데이터 레이어
  global.getJobs = getJobs;
  global.saveJobs = saveJobs;
  global.getStocktakes = getStocktakes;
  global.saveStocktakes = saveStocktakes;
  global.getStores = getStores;
  global.saveStores = saveStores;
  global.syncStoresFromCloud = syncStoresFromCloud;
  global.registerStoreAsOfficial = registerStoreAsOfficial;
  global.promptRegisterStore = promptRegisterStore;
  global.uploadAttachment = uploadAttachment;
  global.mountAttachPicker = mountAttachPicker;
  global.getUsers = getUsers;
  global.scheduleAutoBackup = scheduleAutoBackup;

  // 보조
  global.esc = esc;
  global._fastHash = global._fastHash || _fastHash;
  global._kstNow = _kstNow;
  global._kstDateTimeStr = _kstDateTimeStr;
  global._currentAuthName = _currentAuthName;
  global.showToast = showToast;

  // 클라우드 동기화
  global._mergeJobRecord = _mergeJobRecord;
  global.syncJobsFromCloud = syncJobsFromCloud;
  global.pushJobsToCloud = pushJobsToCloud;
  global.schedulePushJobsToCloud = schedulePushJobsToCloud;

  // tombstone
  global._addTombstone = _addTombstone;
  global._getTombstones = _getTombstones;
  global._isTombstoned = _isTombstoned;
  global._isJobTombstoned = _isJobTombstoned;
  global._isThreadTombstoned = _isThreadTombstoned;
  global._isStoreTombstoned = _isStoreTombstoned;
  global._isThreadChildOfTombstonedRoot = _isThreadChildOfTombstonedRoot;

  // 분류 / 정규화
  global.classifyJobCategory = classifyJobCategory;
  global._isJobDone = _isJobDone;
  global._isJobEffectivelyDone = _isJobEffectivelyDone;
  global._selfHealJobStatuses = _selfHealJobStatuses;
  global._forceResyncFromCloud = _forceResyncFromCloud;
  global._normalizeSearch = _normalizeSearch;

  // thread
  global._normalizeStatus = _normalizeStatus;
  global._threadMigrate = _threadMigrate;
  global._groupStatus = _groupStatus;

  // LINE
  global._LINE_HEAD_BYTES = _LINE_HEAD_BYTES;
  global._byteLen = _byteLen;
  global._sliceByByte = _sliceByByte;
  global._buildEnrichedLineText = _buildEnrichedLineText;
  global._openLineSendComposer = _openLineSendComposer;
  global._lineSendComposerCancel = _lineSendComposerCancel;
  global._lineSendComposerSubmit = _lineSendComposerSubmit;
  global._openLineForJob = _openLineForJob;
  global._openLineForThreadEntry = _openLineForThreadEntry;

  // 디버그/식별
  global.NS_MOBILE_CORE_VERSION = '1.0.0';
})(window);
