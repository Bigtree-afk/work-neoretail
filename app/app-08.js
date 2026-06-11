  /* ══════════════════════════════════════════════
     점포 정보 변경 / 매장 병합
  ══════════════════════════════════════════════ */
  function _kstDateStr() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  }
  function _kstDateTimeStr() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false,
    }).format(d);
    return parts.replace('T',' ').replace(',',' ');
  }
  // 🎯 닉네임 → 실명 정규화 — whitelist users의 nicknames 배열 기반
  function _normalizeDisplayName(name) {
    if (!name) return name;
    try {
      const users = JSON.parse(localStorage.getItem('ns_users') || '[]');
      for (const u of users) {
        if (!u.name) continue;
        if (Array.isArray(u.nicknames) && u.nicknames.some(n => String(n).trim() === String(name).trim())) {
          return u.name;
        }
      }
    } catch(_){}
    return name;
  }
  window._normalizeDisplayName = _normalizeDisplayName;

  function _currentAuthName() {
    try {
      const a = JSON.parse(localStorage.getItem('ns_auth') || 'null');
      if (!a) return '';
      // 항상 ns_users 의 최신 이름 우선 (관리자 페이지에서 이름 변경 즉시 반영)
      try {
        const users = JSON.parse(localStorage.getItem('ns_users') || '[]');
        const me = users.find(u => (u.id||'').toLowerCase() === (a.id||a.email||'').toLowerCase());
        if (me && me.name) return me.name;
      } catch(_){}
      return _normalizeDisplayName(a.name || a.email || '');
    } catch(e) { return ''; }
  }
  window._currentAuthName = _currentAuthName;

  /* ── 정보 변경 다이얼로그 ── */
  function openStoreChangeDialog(storeId, fallbackStore) {
    let store = null;
    if (storeId) {
      const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
      store = stores.find(s => s.id === storeId) || null;
    }
    if (!store && fallbackStore) store = fallbackStore;
    if (!store) { showToast && showToast('점포 정보를 찾을 수 없습니다'); return; }

    const body = document.getElementById('storeChangeBody');
    const cur = {
      name: store.name || '',
      biz:  store.biz || store.bizno || '',
      ceo:  store.ceo || store.owner || '',
      addr: store.addr || store.address || '',
      tel:  store.tel || store.phone || '',
      van:  store.van || '',
    };
    body.innerHTML = `
      <div style="background:#F9FAFB;border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--gray-600)">
        <b>${esc(store.name)}</b> 의 정보를 변경합니다.<br>
        <span style="font-size:11px;color:var(--gray-500)">이전 정보는 자동으로 변경 이력에 보존되고, 검색 시 이전 상호로도 매칭됩니다.</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${[
          ['name','상호 (점포명)','text'],
          ['biz','사업자등록번호','text'],
          ['ceo','대표자','text'],
          ['addr','주소','text'],
          ['tel','연락처','tel'],
          ['van','VAN사','text'],
        ].map(([k, label, type]) => `
          <div>
            <label style="font-size:11px;color:var(--gray-600);font-weight:600;display:block;margin-bottom:4px">${label}</label>
            <div style="display:grid;grid-template-columns:1fr 24px 1fr;gap:4px;align-items:center">
              <input type="text" disabled value="${esc(cur[k]||'')}" style="padding:7px 9px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;background:#F9FAFB;color:var(--gray-500)">
              <div style="text-align:center;color:var(--gray-400)">→</div>
              <input type="${type}" id="chg_${k}" value="${esc(cur[k]||'')}" style="padding:7px 9px;border:1px solid var(--gray-300);border-radius:6px;font-size:12px;background:#fff">
            </div>
          </div>`).join('')}
        <div>
          <label style="font-size:11px;color:var(--gray-600);font-weight:600;display:block;margin-bottom:4px">변경 사유 / 메모</label>
          <textarea id="chgNote" placeholder="예: 가맹 해지 후 재오픈, 사업자 변경" style="width:100%;padding:8px 10px;border:1px solid var(--gray-300);border-radius:6px;font-size:13px;min-height:50px;font-family:inherit;resize:vertical"></textarea>
        </div>
      </div>`;

    const saveBtn = document.getElementById('storeChangeSaveBtn');
    saveBtn.onclick = () => {
      const newFields = {
        name: document.getElementById('chg_name').value.trim(),
        biz:  document.getElementById('chg_biz').value.trim(),
        ceo:  document.getElementById('chg_ceo').value.trim(),
        addr: document.getElementById('chg_addr').value.trim(),
        tel:  document.getElementById('chg_tel').value.trim(),
        van:  document.getElementById('chg_van').value.trim(),
      };
      const note = document.getElementById('chgNote').value.trim();
      // 실제 바뀐 필드
      const changed = ['name','biz','ceo','addr','tel','van'].filter(k => (cur[k]||'') !== (newFields[k]||''));
      if (!changed.length) { showToast && showToast('변경된 내용이 없습니다'); return; }
      // 변경유형은 선택 없이 '실제 바뀐 필드' 로 자동 결정 (단일 필드 → 해당 라벨, 복수 → '정보 변경').
      const autoMap = { name:'상호 변경', biz:'사업자 변경', ceo:'대표자 변경', addr:'주소 이전', tel:'연락처 변경', van:'VAN 변경' };
      const type = (changed.length === 1) ? (autoMap[changed[0]] || '정보 변경') : '정보 변경';

      applyStoreChange(store.id, type, cur, newFields, note);
      closeModal('storeChangeModal');
      closeModal('storeDetailModal');
      showToast && showToast(`✅ ${type} 처리 완료`);
    };

    if (typeof showModal === 'function') showModal('storeChangeModal');
  }
  window.openStoreChangeDialog = openStoreChangeDialog;

  /* 변경 적용 — store + aliases + changeLog */
  function applyStoreChange(storeId, type, before, after, note) {
    const stores = getStores();
    const s = stores.find(x => x.id === storeId);
    if (!s) return false;
    // 이전 상호가 바뀐 경우 aliases 에 추가
    if (before.name && before.name !== after.name) {
      if (!Array.isArray(s.aliases)) s.aliases = [];
      if (!s.aliases.includes(before.name)) s.aliases.unshift(before.name);
    }
    // 필드 갱신
    s.name = after.name || s.name;
    s.biz  = after.biz;
    s.ceo  = after.ceo;
    s.addr = after.addr;
    s.tel  = after.tel;
    s.van  = after.van;
    // 실제 바뀐 필드만 per-field mtime 스탬프 (name 은 빈 값이면 유지하므로 제외)
    const _chg = ['name','biz','ceo','addr','tel','van'].filter(k =>
      (String(before[k]||'') !== String(after[k]||'')) && !(k === 'name' && !after.name));
    _touchStore(s, _chg);
    // 변경 이력 기록
    if (!Array.isArray(s.changeLog)) s.changeLog = [];
    s.changeLog.unshift({
      at: _kstDateTimeStr(),
      type, from: before, to: after,
      note, by: _currentAuthName(),
    });
    saveStores(stores);
    try { pushStoresToCloud({ toast: false }); } catch(e){}
    try { hydrateSavedStores(); } catch(e){}
    return true;
  }
  window.applyStoreChange = applyStoreChange;

  /* ── 매장 병합 다이얼로그 ── */
  function openStoreMergeDialog(survivorId, fallbackStore) {
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    let survivor = stores.find(s => s.id === survivorId) || fallbackStore;
    if (!survivor) { showToast && showToast('점포를 찾을 수 없습니다'); return; }

    const body = document.getElementById('storeMergeBody');
    body.innerHTML = `
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:#92400E">
        <b>유지(생존) 매장:</b> ${esc(survivor.name)}<br>
        다른 매장을 검색해 선택하면, 그 매장의 정보가 이 매장에 흡수되고 <b>병합된 매장은 삭제</b>됩니다.<br>
        병합된 매장의 이전 상호는 자동으로 검색 별칭(aliases)에 추가됩니다.
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:11px;color:var(--gray-600);font-weight:600;display:block;margin-bottom:4px">병합할 다른 매장 검색</label>
        <div class="search-row">
          <select id="mergeScope" style="padding:8px 10px;border:1px solid var(--gray-300);border-radius:8px;font-size:13px;background:#fff;font-weight:600;color:var(--gray-700)">
            <option value="name_biz">상호·사업자번호</option>
            <option value="ceo">대표자</option>
            <option value="addr">주소</option>
          </select>
          <input type="text" id="mergeSearch" placeholder="검색어 입력..." style="padding:8px 10px;border:1px solid var(--gray-300);border-radius:8px;font-size:13px">
        </div>
      </div>
      <div id="mergeResults" style="max-height:280px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px;padding:4px"></div>
    `;

    let pickedId = null;
    const renderResults = (q) => {
      const results = document.getElementById('mergeResults');
      const qNorm = _normalizeSearch(q);
      const scope = (document.getElementById('mergeScope')||{}).value || 'name_biz';
      // 자기 자신만 제외. 검색어 없으면 전체 표시 (최근 등록순)
      let matched = stores.filter(s => s.id !== survivor.id);
      if (qNorm.length >= 1) {
        matched = matched.filter(s => _matchStore(s, qNorm, scope));
      }
      // 최근 등록순 정렬 — 큰 데이터셋이라도 빠르게
      matched.sort((a,b) => (Number(b.createdAt)||0) - (Number(a.createdAt)||0));
      const total = matched.length;
      const renderLimit = 500;
      matched = matched.slice(0, renderLimit);

      if (total === 0) { results.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:12px">일치 매장이 없습니다</div>'; return; }
      const headerInfo = `<div style="font-size:11px;color:var(--gray-500);padding:6px 10px;background:#F9FAFB;border-bottom:1px solid var(--gray-200);position:sticky;top:0">
        ${q ? `검색 결과 ${total.toLocaleString()}건` : `전체 ${total.toLocaleString()}건`}${total > renderLimit ? ` · 상위 ${renderLimit}건 표시 (검색어를 입력해 좁히세요)` : ''}
      </div>`;
      results.innerHTML = headerInfo + matched.map(s => {
        const aliases = Array.isArray(s.aliases) ? s.aliases : [];
        return `<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;margin:4px;cursor:pointer;background:#fff">
          <input type="radio" name="mergePick" value="${esc(s.id)}" style="margin:0">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px">${esc(s.name)}</div>
            <div style="font-size:11px;color:var(--gray-500)">${esc(s.biz||s.bizno||'-')} · ${esc(s.ceo||s.owner||'-')} · ${esc(s.addr||s.address||'-')}</div>
            ${aliases.length ? `<div style="font-size:10px;color:var(--gray-400);margin-top:2px">↳ (구) ${esc(aliases.join(', '))}</div>` : ''}
          </div>
        </label>`;
      }).join('');
      results.querySelectorAll('input[name="mergePick"]').forEach(r => {
        r.onchange = () => { pickedId = r.value; };
      });
    };

    document.getElementById('mergeSearch').addEventListener('input', e => renderResults(e.target.value));
    document.getElementById('mergeScope').addEventListener('change', () => renderResults(document.getElementById('mergeSearch').value));
    // 다이얼로그 열 때 바로 전체 목록 노출
    renderResults('');

    const confirmBtn = document.getElementById('storeMergeConfirmBtn');
    confirmBtn.onclick = () => {
      if (!pickedId) { showToast && showToast('병합할 매장을 선택하세요'); return; }
      const merged = stores.find(s => s.id === pickedId);
      if (!merged) return;
      const msg = `다음 매장을 [${survivor.name}] 으로 병합합니다:\n\n` +
        `흡수: ${merged.name} (${merged.biz||'-'})\n` +
        `유지: ${survivor.name} (${survivor.biz||'-'})\n\n` +
        `흡수 매장의 작업/이력/별칭이 유지 매장으로 옮겨지고, 흡수 매장은 삭제됩니다.\n계속하시겠습니까?`;
      if (!confirm(msg)) return;
      mergeStores(survivor.id, merged.id);
      closeModal('storeMergeModal');
      closeModal('storeDetailModal');
      showToast && showToast(`✅ 병합 완료 — [${merged.name}] → [${survivor.name}]`);
    };

    if (typeof showModal === 'function') showModal('storeMergeModal');
  }
  window.openStoreMergeDialog = openStoreMergeDialog;

  /* 매장 병합 실행 — 취소 가능 스냅샷 포함
     v2 (2026-05): 모든 데이터 완전 흡수
     - 작업 재라우팅: id 매칭 + 정규화 이름 매칭 + survivor.aliases 매칭
     - 장비(equipment[]) 인스턴스 흡수 (instanceId 충돌시 신규 발급)
     - 거래처(contacts[]) / 메모(memos[]) / 변경이력(changeLog[]) 통합
     - 사용자 정의 필드(notes, tags 등) survivor 가 빈 값이면 merged 값 채움
  */
  function mergeStores(survivorId, mergedId) {
    const stores = getStores();
    const survivor = stores.find(s => s.id === survivorId);
    const merged   = stores.find(s => s.id === mergedId);
    if (!survivor || !merged) return false;

    // 흡수 매장 전체 스냅샷 (취소 시 복원용)
    const mergedSnapshot = JSON.parse(JSON.stringify(merged));

    // 1) Aliases 흡수 — merged 이름과 별칭을 survivor.aliases 에 모두 추가
    const addedAliases = [];
    if (!Array.isArray(survivor.aliases)) survivor.aliases = [];
    if (merged.name && !survivor.aliases.includes(merged.name)) {
      survivor.aliases.unshift(merged.name);
      addedAliases.push(merged.name);
    }
    if (Array.isArray(merged.aliases)) {
      merged.aliases.forEach(a => {
        if (a && !survivor.aliases.includes(a)) {
          survivor.aliases.push(a);
          addedAliases.push(a);
        }
      });
    }

    // 2) Equipment 인스턴스 흡수 — store.equipment[]
    const absorbedEquipment = [];
    if (Array.isArray(merged.equipment) && merged.equipment.length > 0) {
      if (!Array.isArray(survivor.equipment)) survivor.equipment = [];
      const existingIds = new Set(survivor.equipment.map(e => e.instanceId));
      merged.equipment.forEach(e => {
        const inst = JSON.parse(JSON.stringify(e));  // deep copy
        // instanceId 충돌 시 신규 발급 (이론상 거의 안 일어남)
        if (existingIds.has(inst.instanceId)) {
          inst.instanceId = 'eqi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        }
        // 이력에 흡수 사실 기록
        inst.history = inst.history || [];
        inst.history.push({
          at: new Date().toISOString(),
          kind: 'absorbed_via_merge',
          by: (typeof _currentUserName === 'function' ? _currentUserName() : ''),
          note: `매장 병합으로 흡수 (${merged.name} → ${survivor.name})`,
        });
        survivor.equipment.push(inst);
        absorbedEquipment.push(inst.instanceId);
      });
    }

    // 3) Contacts 흡수 — store.contacts[] (있는 경우)
    const absorbedContacts = [];
    if (Array.isArray(merged.contacts) && merged.contacts.length > 0) {
      if (!Array.isArray(survivor.contacts)) survivor.contacts = [];
      // 전화번호 정규화 후 중복 제거
      const normPhone = p => String(p||'').replace(/\D/g,'');
      const existingPhones = new Set(survivor.contacts.map(c => normPhone(c.phone)).filter(Boolean));
      merged.contacts.forEach(c => {
        const np = normPhone(c.phone);
        if (np && existingPhones.has(np)) return;  // 동일 전화번호 = 중복
        const copy = JSON.parse(JSON.stringify(c));
        // primary 플래그 보존하되 survivor 에 이미 primary 있으면 해제
        if (copy.primary && survivor.contacts.some(x => x.primary)) copy.primary = false;
        survivor.contacts.push(copy);
        absorbedContacts.push(c.name || c.phone || '');
      });
    }

    // 4) Memos / changeLog 등 누적성 배열
    if (Array.isArray(merged.memos) && merged.memos.length > 0) {
      if (!Array.isArray(survivor.memos)) survivor.memos = [];
      survivor.memos.push(...merged.memos);
    }
    if (Array.isArray(merged.changeLog) && merged.changeLog.length > 0) {
      if (!Array.isArray(survivor.changeLog)) survivor.changeLog = [];
      // 시간순 머지
      survivor.changeLog = [...survivor.changeLog, ...merged.changeLog]
        .sort((a,b) => String(b.at||'').localeCompare(String(a.at||'')));
    }

    // 5) survivor 가 비어있는 필드는 merged 값으로 채움 (정보 보존)
    const fillIfEmpty = ['biz','bizno','ceo','phone','address','road','memo','notes','pos','kiosk','displayPos','displayVan'];
    const filledFields = {};
    fillIfEmpty.forEach(k => {
      if ((survivor[k] == null || survivor[k] === '') && merged[k]) {
        survivor[k] = merged[k];
        filledFields[k] = merged[k];
      }
    });

    // 6) 작업(jobs) 재라우팅 — id 매칭 + 정규화 이름 매칭 + aliases 매칭
    const reroutedJobs = [];
    try {
      const jobs = getJobs();
      const mergedName = merged.name || '';
      const survivorName = survivor.name || '';
      const mergedNorm = _normStoreKey ? _normStoreKey(mergedName) : mergedName.toLowerCase();
      // merged 의 모든 별칭 (자기 이름 포함) 의 정규화 형태 set
      const mergedAliasesNorm = new Set([mergedName, ...(merged.aliases || [])]
        .filter(Boolean)
        .map(s => _normStoreKey ? _normStoreKey(s) : s.toLowerCase()));

      jobs.forEach(j => {
        const changed = {};
        let touched = false;
        // (a) storeId 정확 매칭
        if (j.storeId === merged.id) { changed.storeId = j.storeId; j.storeId = survivor.id; touched = true; }
        // (b) store/storeName 의 정규화 매칭 (variants/whitespace/괄호 위치 흡수)
        const jStore = j.store || j.storeName || '';
        if (jStore) {
          const jNorm = _normStoreKey ? _normStoreKey(jStore) : jStore.toLowerCase();
          if (mergedAliasesNorm.has(jNorm)) {
            if ('store' in j) { changed.store = j.store; j.store = survivorName; }
            if ('storeName' in j) { changed.storeName = j.storeName; j.storeName = survivorName; }
            touched = true;
          }
        }
        if (touched) reroutedJobs.push({ id: j.id, prev: changed });
      });
      if (reroutedJobs.length) saveJobs(jobs);
      try { pushJobsToCloud({ toast: false }); } catch(e){}
    } catch(e){ console.warn('[mergeStores] job reroute failed:', e); }

    // 7) changeLog 기록 (취소용 스냅샷 + 모든 흡수 정보 포함)
    if (!Array.isArray(survivor.changeLog)) survivor.changeLog = [];
    survivor.changeLog.unshift({
      at: _kstDateTimeStr(),
      type: '매장 병합',
      from: { name: merged.name, biz: merged.biz, ceo: merged.ceo },
      to:   { name: survivor.name, biz: survivor.biz, ceo: survivor.ceo },
      note: `흡수: ${merged.name}${merged.biz?` (${merged.biz})`:''} → 유지: ${survivor.name}`,
      by:   _currentAuthName(),
      mergedSnapshot,
      addedAliases,
      absorbedEquipment,
      absorbedContacts,
      filledFields,
      reroutedJobs,
    });

    // 병합으로 채워진 필드 + 매장 mtime 스탬프 (per-field)
    _touchStore(survivor, Object.keys(filledFields || {}));

    // 8) 흡수 매장 삭제
    const idx = stores.findIndex(s => s.id === merged.id);
    if (idx >= 0) stores.splice(idx, 1);

    saveStores(stores);
    try { pushStoresToCloud({ toast: false }); } catch(e){}
    try { hydrateSavedStores(); } catch(e){}

    // 사용자 피드백 — 흡수된 데이터 요약
    const summary = [];
    if (reroutedJobs.length) summary.push(`작업 ${reroutedJobs.length}건`);
    if (absorbedEquipment.length) summary.push(`장비 ${absorbedEquipment.length}건`);
    if (absorbedContacts.length) summary.push(`담당자 ${absorbedContacts.length}건`);
    if (addedAliases.length) summary.push(`별칭 ${addedAliases.length}건`);
    if (summary.length && typeof showToast === 'function') {
      showToast(`✅ 병합 완료 — ${summary.join(' · ')} 흡수`, 5000);
    }
    return true;
  }
  window.mergeStores = mergeStores;

  /* 매장 병합 취소 — changeLog 의 mergedSnapshot 으로 복원 */
  function undoStoreMerge(survivorId, logIdx) {
    const stores = getStores();
    const survivor = stores.find(s => s.id === survivorId);
    if (!survivor || !Array.isArray(survivor.changeLog)) return false;
    const entry = survivor.changeLog[logIdx];
    if (!entry || entry.type !== '매장 병합' || !entry.mergedSnapshot) {
      showToast && showToast('이 병합은 취소 불가 (스냅샷 없음)');
      return false;
    }
    if (entry._undone) {
      showToast && showToast('이미 취소된 병합입니다');
      return false;
    }

    // 흡수 매장 복원 — id 가 같은 매장이 이미 있으면 중단
    if (stores.find(s => s.id === entry.mergedSnapshot.id)) {
      showToast && showToast('동일 ID 매장이 이미 존재해 복원할 수 없습니다');
      return false;
    }
    stores.push(JSON.parse(JSON.stringify(entry.mergedSnapshot)));

    // 추가된 aliases 만 제거
    if (Array.isArray(entry.addedAliases) && Array.isArray(survivor.aliases)) {
      survivor.aliases = survivor.aliases.filter(a => !entry.addedAliases.includes(a));
      if (survivor.aliases.length === 0) delete survivor.aliases;
    }

    // 작업 재라우팅 되돌리기
    try {
      const jobs = getJobs();
      if (Array.isArray(entry.reroutedJobs)) {
        const byId = {};
        entry.reroutedJobs.forEach(r => { byId[r.id] = r.prev; });
        jobs.forEach(j => {
          const prev = byId[j.id];
          if (!prev) return;
          if ('storeId' in prev)   j.storeId   = prev.storeId;
          if ('store' in prev)     j.store     = prev.store;
          if ('storeName' in prev) j.storeName = prev.storeName;
        });
        saveJobs(jobs);
        try { pushJobsToCloud({ toast: false }); } catch(e){}
      }
    } catch(e){}

    // 흡수된 장비 인스턴스 제거 (취소: survivor 에서 빼냄)
    if (Array.isArray(entry.absorbedEquipment) && entry.absorbedEquipment.length > 0 && Array.isArray(survivor.equipment)) {
      const removeSet = new Set(entry.absorbedEquipment);
      survivor.equipment = survivor.equipment.filter(e => !removeSet.has(e.instanceId));
    }
    // 흡수된 contacts 제거 (이름/전화 매칭)
    if (Array.isArray(entry.absorbedContacts) && entry.absorbedContacts.length > 0 && Array.isArray(survivor.contacts)) {
      const normP = p => String(p||'').replace(/\D/g,'');
      const mSnap = entry.mergedSnapshot || {};
      const mContacts = Array.isArray(mSnap.contacts) ? mSnap.contacts : [];
      const removePhones = new Set(mContacts.map(c => normP(c.phone)).filter(Boolean));
      survivor.contacts = survivor.contacts.filter(c => {
        const np = normP(c.phone);
        return !np || !removePhones.has(np);
      });
    }
    // filledFields 되돌리기 — 병합으로 채워진 빈 필드 비우기
    if (entry.filledFields && typeof entry.filledFields === 'object') {
      Object.keys(entry.filledFields).forEach(k => {
        if (survivor[k] === entry.filledFields[k]) {
          delete survivor[k];
        }
      });
    }

    // 취소 사실을 changeLog 상단에 기록
    entry._undone = true;
    entry._undoneAt = _kstDateTimeStr();
    entry._undoneBy = _currentAuthName();
    survivor.changeLog.unshift({
      at: _kstDateTimeStr(),
      type: '병합 취소',
      from: { name: survivor.name },
      to:   { name: entry.mergedSnapshot.name },
      note: `병합 취소 — ${entry.mergedSnapshot.name} 매장 복원됨`,
      by:   _currentAuthName(),
    });

    // 병합 취소로 되돌린 필드 + 매장 mtime 스탬프
    _touchStore(survivor, Object.keys(entry.filledFields || {}));
    const _restored = stores.find(s => s.id === entry.mergedSnapshot.id);
    if (_restored) _touchStore(_restored, []);

    saveStores(stores);
    try { pushStoresToCloud({ toast: false }); } catch(e){}
    try { hydrateSavedStores(); } catch(e){}
    showToast && showToast(`✅ 병합 취소 — [${entry.mergedSnapshot.name}] 복원됨`);
    return true;
  }
  window.undoStoreMerge = undoStoreMerge;

  function confirmUndoStoreMerge(survivorId, logIdx) {
    const stores = getStores();
    const survivor = stores.find(s => s.id === survivorId);
    if (!survivor) return;
    const entry = (survivor.changeLog||[])[logIdx];
    if (!entry || !entry.mergedSnapshot) return;
    const msg = `다음 병합을 취소합니다:\n\n` +
      `유지 매장: ${survivor.name}\n` +
      `복원 매장: ${entry.mergedSnapshot.name}${entry.mergedSnapshot.biz?` (${entry.mergedSnapshot.biz})`:''}\n\n` +
      `- 흡수됐던 매장이 다시 별도 항목으로 복원됩니다.\n` +
      `- 이 병합으로 옮겨졌던 작업들이 원래 매장으로 되돌아갑니다.\n` +
      `- 이 병합으로 추가된 별칭(aliases)도 제거됩니다.\n\n계속하시겠습니까?`;
    if (!confirm(msg)) return;
    const ok = undoStoreMerge(survivorId, logIdx);
    if (ok) closeModal('storeDetailModal');
  }
  window.confirmUndoStoreMerge = confirmUndoStoreMerge;

  /* ══════════════════════════════════════════════
     검색 / 필터 / 음성 인식
  ══════════════════════════════════════════════ */
  // 활성 음성 인식 인스턴스 — 토글 (재클릭 시 중지) 용
  let _activeVoiceRec = null;

  function _showVoiceOverlay(label) {
    let ov = document.getElementById('voiceOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'voiceOverlay';
      ov.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);color:#fff;padding:14px 20px;border-radius:14px;font-size:14px;z-index:9998;box-shadow:0 10px 30px rgba(0,0,0,0.35);display:flex;align-items:center;gap:14px;min-width:280px;max-width:90vw';
      document.body.appendChild(ov);
    }
    ov.innerHTML = `
      <div style="width:38px;height:38px;border-radius:50%;background:#EF4444;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;animation:pulse-dot 1s infinite">🎙</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;color:#94A3B8;margin-bottom:2px">${label||'듣고 있어요'} · 말씀해 주세요</div>
        <div id="voiceOverlayText" style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">…</div>
      </div>
      <button onclick="(function(){if(window._activeVoiceRec){try{window._activeVoiceRec.stop()}catch(e){}}})()" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap">정지</button>`;
  }
  function _updateVoiceOverlay(text) {
    const el = document.getElementById('voiceOverlayText');
    if (el) el.textContent = text || '…';
  }
  function _hideVoiceOverlay() {
    const ov = document.getElementById('voiceOverlay');
    if (ov) ov.remove();
  }

  function _runVoice(inputEl, onDone, opts) {
    opts = opts || {};
    // 이미 듣고 있으면 중지(토글)
    if (_activeVoiceRec) {
      try { _activeVoiceRec.stop(); } catch(e){}
      _activeVoiceRec = null;
      return null;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showToast && showToast('이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome / Edge 권장)');
      return null;
    }
    const rec = new SR();
    rec.lang = 'ko-KR';
    rec.interimResults = true;          // 실시간 인식 결과 표시
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let finalText = '';
    let interimText = '';

    // 안전 타이머 — 모바일에서 마이크가 너무 오래 켜져있으면
    // OS 가 통화모드(스피커폰)로 전환해버리므로, 짧게만 켰다 끈다.
    let silenceTimer = null;
    let maxTimer = null;
    const SILENCE_MS = 2500;   // 마지막 입력 후 2.5초 침묵 → 종료
    const MAX_MS    = 10000;   // 최대 10초 (그 이후 강제 종료)
    function _stopRec(reason) {
      try { rec.stop(); } catch(e){}
    }
    function _resetSilence() {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => _stopRec('silence'), SILENCE_MS);
    }

    rec.onresult = (ev) => {
      interimText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      const display = (finalText + interimText).trim();
      if (inputEl) inputEl.value = display;
      _updateVoiceOverlay(display);
      // 입력이 들어오는 동안은 침묵 타이머 리셋
      _resetSilence();
      // 라이브 검색 옵션이 켜진 경우 — 입력될 때마다 onDone 호출
      if (opts.liveSearch && typeof onDone === 'function') {
        try { onDone(display); } catch(e){}
      }
    };
    rec.onend = () => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      if (maxTimer)     { clearTimeout(maxTimer);     maxTimer = null; }
      if (opts.btn) opts.btn.classList.remove('listening');
      _hideVoiceOverlay();
      _activeVoiceRec = null;
      window._activeVoiceRec = null;
      const final = (finalText.trim() || (inputEl ? inputEl.value : '')).trim();
      if (typeof onDone === 'function') {
        try { onDone(final); } catch(e){}
      }
    };
    rec.onspeechend = () => _stopRec('speech-end');
    rec.onerror = (e) => {
      const msg = e && e.error;
      // 권한 거부는 안내, 그 외 일반 에러
      if (msg === 'not-allowed' || msg === 'service-not-allowed') {
        showToast && showToast('🎙 마이크 권한이 거부되었습니다. 주소창 좌측 자물쇠 → 마이크 허용으로 변경하세요');
      } else if (msg === 'no-speech') {
        showToast && showToast('🎙 음성이 감지되지 않았습니다. 다시 시도해 주세요');
      } else if (msg === 'aborted') {
        // 사용자 정지 — 별도 안내 X
      } else {
        showToast && showToast('음성 인식 오류: ' + (msg || ''));
      }
      if (opts.btn) opts.btn.classList.remove('listening');
      _hideVoiceOverlay();
      _activeVoiceRec = null;
    };
    try {
      rec.start();
      _activeVoiceRec = rec;
      window._activeVoiceRec = rec; // overlay 의 정지 버튼이 참조
      if (opts.btn) opts.btn.classList.add('listening');
      _showVoiceOverlay(opts.label || '듣고 있어요');
      // 침묵 타이머 시작 + 최대 시간 안전 가드
      _resetSilence();
      maxTimer = setTimeout(() => _stopRec('max'), MAX_MS);
      // 페이지 숨김/포커스 잃으면 즉시 종료 — 마이크 점유 방지
      const _hardStop = () => _stopRec('hidden');
      document.addEventListener('visibilitychange', _hardStop, { once: true });
    } catch(e) {
      showToast && showToast('음성 인식 시작 실패: ' + e.message);
      return null;
    }
    return rec;
  }

  // 공백 무시 정규화 — "이마트 에브리데이" 와 "이마트에브리데이" 모두 매칭되게
  function _normalizeSearch(s) {
    return String(s||'')
      .toLowerCase()
      // 회사 형태 토큰 제거 — "다봄(주)" / "(주)다봄" / "다봄주식회사" → "다봄"
      .replace(/\(주\)|\(유\)|\(합\)|\(재\)|\(사\)/g, '')
      .replace(/주식회사|유한회사|합자회사|합명회사|유한책임회사|재단법인|사단법인/g, '')
      // 괄호 자체도 제거
      .replace(/[()[\]{}<>「」]/g, '')
      // 구두점·기호 제거
      .replace(/[._\-·\/\\,'"!?@#%&*+=:;|~`]/g, '')
      // 모든 공백 제거
      .replace(/\s+/g, '');
  }
  /* 🔑 매장 식별 키 — 소문자 + 공백 제거만. ⚠ 법인표기(주식회사/(주))를 보존한다!
     _normalizeSearch 는 법인표기를 지워 '오케이마트'와 '오케이마트주식회사'가 같은 키가 됨 →
     별개 매장이 이름으로 사실상 병합되는 교차오염(2026-06-10 사고). 식별 비교는 반드시 이 함수. */
  function _normStoreKey(s) {
    return String(s||'').toLowerCase().replace(/\s+/g, '');
  }
  window._normStoreKey = _normStoreKey;
  /* 검색 범위 → 매장에서 검색 대상이 되는 필드만 추출 (모든 검색 지점 공통) */
  function _storeFieldsForScope(s, scope) {
    if (!s) return [];
    if (scope === 'ceo')      return [s.ceo, s.owner];
    if (scope === 'addr')     return [s.addr, s.address];
    // 기본 'name_biz' — 상호 + 간판명 + 별칭 + 사업자번호 + 거래처코드 + 태그
    const aliasNames = Array.isArray(s.aliases) ? s.aliases : [];
    const tagNames   = Array.isArray(s.tags)    ? s.tags    : [];
    return [s.name, s.signageName, ...aliasNames, s.biz, s.bizno, s.code, ...tagNames];
  }
  /* 입력값 normalize + scope 적용해서 매칭 */
  function _matchStore(store, qNorm, scope) {
    if (!qNorm) return true;
    const blob = _normalizeSearch(_storeFieldsForScope(store, scope).filter(Boolean).join(' | '));
    return blob.includes(qNorm);
  }
  /* 검색창 옆에 끼워 넣을 scope selector HTML 생성 */
  function _scopeSelectorHTML(id, current) {
    const cur = current || 'name_biz';
    return `<select id="${id}" style="width:auto;flex:0 0 auto;min-width:140px;padding:6px 10px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px;background:#fff;font-weight:600;color:var(--gray-700);margin-right:6px">
      <option value="name_biz"${cur==='name_biz'?' selected':''}>상호·사업자번호</option>
      <option value="ceo"${cur==='ceo'?' selected':''}>대표자</option>
      <option value="addr"${cur==='addr'?' selected':''}>주소</option>
    </select>`;
  }

  function applyStoreFilter(q, opts) {
    opts = opts || {};
    const qNorm = _normalizeSearch(q);
    const tb = document.getElementById('storeListTbody');
    if (!tb) return 0;

    // 검색어 비었으면 → 기본 hydrate (최신 200개)로 복원
    if (!qNorm) {
      try { if (typeof hydrateSavedStores === 'function') hydrateSavedStores(); } catch(e) {}
      if (opts.toast && typeof showToast === 'function') {
        const total = (getStores()||[]).length;
        showToast(`전체 ${total.toLocaleString()}개 점포`);
      }
      return (getStores()||[]).length;
    }

    // 검색어 있으면 → 전체 점포 데이터에서 매칭 결과만 렌더 (DOM 외부 점포까지 포함)
    const scope = (document.getElementById('storeSearchScope')||{}).value || 'name_biz';
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const matched = stores.filter(s => _matchStore(s, qNorm, scope));

    // 렌더 (성능: 최대 500건) — 정렬 상태 반영, 없으면 등록순
    if (_storeSort) {
      const { key, dir } = _storeSort;
      matched.sort((a,b) => {
        const r = _storeFieldVal(a,key).localeCompare(_storeFieldVal(b,key), 'ko');
        return dir === 'asc' ? r : -r;
      });
    } else {
      matched.sort((a,b) => (Number(b.createdAt)||0) - (Number(a.createdAt)||0));
    }
    if (matched.length === 0) {
      // 검색 결과 없음 — 무한 스크롤 해제 후 빈 안내 행만 표시
      try { if (_storeRender.io) { _storeRender.io.disconnect(); _storeRender.io = null; } } catch(e){}
      tb.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px">
        <div style="font-size:24px;margin-bottom:6px">🔍</div>
        <div><b>"${q}"</b> 검색 결과가 없습니다 (전체 ${stores.length.toLocaleString()}개 중)</div>
      </td></tr>`;
    } else {
      // 검색 결과도 200개씩 스크롤로 점진 렌더
      _storeRenderList(matched, (shown, total) =>
        `<td colspan="10" style="text-align:center;padding:10px;font-size:11px;background:#F9FAFB">
          🔍 <b>"${q}"</b> 검색 결과: <b>${total.toLocaleString()}건</b> (전체 ${stores.length.toLocaleString()}개 중) · ${shown.toLocaleString()}개 표시${shown < total ? ' · 스크롤 시 더 보기' : ''}
        </td>`);
    }

    if (opts.toast && typeof showToast === 'function') {
      showToast(`🔍 "${q}" 결과 ${matched.length.toLocaleString()}건`);
    }
    return matched.length;
  }

  function runStoreSearch() {
    const q = document.getElementById('storeSearchInput')?.value || '';
    applyStoreFilter(q, { toast: true });
  }

  /* 라이브 검색 — 2자 이상 입력 시 즉시 필터 (debounce 120ms) */
  let _storeSearchTimer = null;
  function onStoreSearchInput(val) {
    if (_storeSearchTimer) clearTimeout(_storeSearchTimer);
    const q = (val || '').trim();
    if (q.length === 0) {
      // 비우면 전체 표시 (즉시)
      applyStoreFilter('', { toast: false });
      return;
    }
    if (q.length < 2) {
      // 1글자는 너무 광범위하므로 무시 (성능)
      return;
    }
    _storeSearchTimer = setTimeout(() => {
      applyStoreFilter(q, { toast: false });
    }, 120);
  }
  window.onStoreSearchInput = onStoreSearchInput;

  function startStoreVoiceSearch() {
    const inp = document.getElementById('storeSearchInput');
    const btn = document.getElementById('storeMicBtn');
    if (!inp) return;
    // 라이브 검색 — 인식 도중에도 실시간으로 결과 갱신
    _runVoice(inp, (text) => {
      const q = (text||'').trim();
      // 짧으면 패스, 그 외 즉시 검색
      if (q.length === 0) applyStoreFilter('', { toast:false });
      else applyStoreFilter(q, { toast:false });
    }, { btn, label:'점포 검색', liveSearch:true });
  }

  function filterStoresByStatus(chip, status) {
    const row = chip.parentElement;
    row.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const tb = document.getElementById('storeListTbody');
    if (!tb) return;
    Array.from(tb.querySelectorAll('tr')).forEach(tr => {
      if (status === '전체') { tr.style.display = ''; return; }
      const badge = tr.querySelector('.badge-green, .badge-blue, .badge-amber, .badge-red, .badge-gray');
      const text = badge ? badge.textContent.trim() : '';
      tr.style.display = (text === status) ? '' : 'none';
    });
  }

  function runJobSearch() {
    const q = (document.getElementById('jobSearchInput')?.value || '').trim().toLowerCase();
    const grid = document.getElementById('jobsGrid');
    if (!grid) return;
    let shown = 0;
    grid.querySelectorAll('.job-card').forEach(c => {
      if (c.id === 'newJobCardBtn') return;
      const txt = c.textContent.toLowerCase();
      const match = !q || txt.includes(q);
      c.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    showToast && showToast(q ? `🔍 "${q}" 작업 ${shown}건` : `전체 ${shown}건 작업`);
  }

  function startJobVoiceSearch() {
    const inp = document.getElementById('jobSearchInput');
    _runVoice(inp, () => runJobSearch());
  }

  /* ══════════════════════════════════════════════
     페이지 로드 초기화
  ══════════════════════════════════════════════ */
  renderQuote();
  updateNavAuth();
  populateStoreNameList();
  hydrateSavedJobs();
  hydrateSavedStores();
  enforceAuthGate();  // 로그인 안 되어 있으면 사이트 전체 차단

  /* ══════════════════════════════════════════════
     RIPPLE EFFECT — 모든 버튼 클릭 시 물결 효과
  ══════════════════════════════════════════════ */
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('button, .btn, .filter-chip, .capture-tab, .nav-item, .cm-tab');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top  - size / 2;
    const wave = document.createElement('span');
    wave.className = 'ripple-wave';
    wave.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
    btn.appendChild(wave);
    wave.addEventListener('animationend', () => wave.remove());
  }, true);

  /* ══════════════════════════════════════════════
     CALENDAR EVENT TOOLTIP — 일정 마우스오버/클릭 팝업
  ══════════════════════════════════════════════ */
  // 캘린더 이벤트 메타 데이터 (타입→색상·아이콘)
  const CAL_EVENT_META = {
    'new':     { icon: '🏪', label: '신규',  color: '#1D4ED8' },
    'replace': { icon: '🖥',  label: 'POS 교체', color: '#065F46' },
    'van':     { icon: '💳', label: 'VAN 교체', color: '#5B21B6' },
    'as':      { icon: '🔧', label: 'AS 처리',  color: '#92400E' },
  };

  // 캘린더 이벤트 상세 데이터 (점포명 → 상세)
  const CAL_EVENT_DETAIL = {
    'K-1 안중 신규':   { store:'K-1마트 안중점',   date:'4월 7일',  engineer:'김현장', note:'POS 5대 + 저울 설치' },
    '웰빙마트 POS':    { store:'웰빙마트 일산점',   date:'4월 9일',  engineer:'이기사', note:'POS 교체 3대' },
    'SK마트 강화':     { store:'SK마트 강화점',     date:'4월 14일', engineer:'박기사', note:'신규 POS 2대' },
    '가락마트 AS':     { store:'가락마트 하나시스', date:'4월 15일', engineer:'이기사', note:'영수프린터 교체' },
    'L-마트 VAN':      { store:'L-마트 반포점',     date:'4월 16일', engineer:'박기사', note:'KCP → KSNET 전환' },
    '365할인마트':     { store:'365할인마트 광적',   date:'4월 18일', engineer:'김현장', note:'신규 POS 3대 설치' },
    'K-1 안중점':      { store:'K-1마트 안중점',   date:'4월 20일', engineer:'김현장', note:'설치 진행중 (4/6단계)' },
    '웰빙마트 VAN':    { store:'웰빙마트 신림점',   date:'4월 20일', engineer:'이기사', note:'VAN 단말 교체 3대' },
    'ECJ마트 AS':      { store:'ECJ마트',           date:'4월 20일', engineer:'박기사', note:'영수프린터 용지 걸림' },
    '365마트 VAN':     { store:'365마트',           date:'4월 22일', engineer:'이기사', note:'VAN 교체' },
    '웰빙마트 설치':   { store:'웰빙마트 신림점',   date:'4월 23일', engineer:'김현장', note:'POS 교체 최종 설치' },
  };

  // 툴팁 DOM 생성
  const calTooltip = document.createElement('div');
  calTooltip.id = 'calTooltip';
  calTooltip.innerHTML = '<div class="ct-title"></div><div class="ct-rows"></div>';
  document.body.appendChild(calTooltip);

  function showCalTooltip(e, el) {
    const text = el.textContent.trim();
    const detail = CAL_EVENT_DETAIL[text];
    const typeClass = [...el.classList].find(c => CAL_EVENT_META[c]);
    const meta = CAL_EVENT_META[typeClass] || { icon:'📅', label:'일정', color:'#374151' };

    calTooltip.querySelector('.ct-title').innerHTML =
      `<span style="margin-right:4px">${meta.icon}</span>${text}`;
    calTooltip.querySelector('.ct-rows').innerHTML = detail ? `
      <div class="ct-row"><b>점포:</b> ${detail.store}</div>
      <div class="ct-row"><b>날짜:</b> ${detail.date}</div>
      <div class="ct-row"><b>담당:</b> ${detail.engineer}</div>
      <div class="ct-row"><b>내용:</b> ${detail.note}</div>
    ` : `<div class="ct-row" style="color:#64748B">유형: ${meta.label}</div>`;

    positionTooltip(e);
    calTooltip.classList.add('visible');
  }

  function positionTooltip(e) {
    const tx = Math.min(e.clientX + 14, window.innerWidth - 240);
    const ty = Math.min(e.clientY + 14, window.innerHeight - 140);
    calTooltip.style.left = tx + 'px';
    calTooltip.style.top  = ty + 'px';
  }

  function hideCalTooltip() {
    calTooltip.classList.remove('visible');
  }

  // 이벤트 바인딩 (이벤트 위임)
  document.addEventListener('mouseover', function(e) {
    const ev = e.target.closest('.cal-event');
    if (ev) showCalTooltip(e, ev);
  });
  document.addEventListener('mousemove', function(e) {
    if (calTooltip.classList.contains('visible')) positionTooltip(e);
  });
  document.addEventListener('mouseout', function(e) {
    if (e.target.closest('.cal-event')) hideCalTooltip();
  });

  // 캘린더 이벤트 클릭 → 상세 팝업 (재사용 가능 모달)
  document.addEventListener('click', function(e) {
    const ev = e.target.closest('.cal-event');
    if (!ev) return;
    hideCalTooltip();
    const text = ev.textContent.trim();
    const detail = CAL_EVENT_DETAIL[text] || {};
    const typeClass = [...ev.classList].find(c => CAL_EVENT_META[c]);
    const meta = CAL_EVENT_META[typeClass] || { icon:'📅', label:'일정', color:'#374151' };
    showScheduleDetail({
      title: text,
      icon: meta.icon,
      type: meta.label,
      color: meta.color,
      store: detail.store || text,
      date: detail.date || '',
      engineer: detail.engineer || '',
      note: detail.note || '',
    });
  });

  // 오늘 일정 카드 행 클릭 — 실제 job 데이터 row 는 자체 onclick(editNewopen) 으로 매장 정보 모달을 띄우므로
  // data-title 가 없는 경우는 skip (중복 팝업 방지). data-title 가 있는 정적/데모 row 에서만 일정 상세 모달 표시.
  document.addEventListener('click', function(e) {
    const row = e.target.closest('.sched-row');
    if (!row) return;
    if (!row.dataset.title) return;
    showScheduleDetail({
      title: row.dataset.title || '',
      icon: row.dataset.icon || '📅',
      type: row.dataset.type || '',
      color: '#2563EB',
      store: row.dataset.store || '',
      date: row.dataset.date || '',
      engineer: row.dataset.engineer || '',
      note: row.dataset.note || '',
    });
  });

  /* 일정 상세 모달 표시 */
  function showScheduleDetail(d) {
    let modal = document.getElementById('scheduleDetailModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'scheduleDetailModal';
      modal.className = 'modal-overlay';
      modal.style.cssText = 'z-index:9000';
      modal.innerHTML = `
        <div class="modal" style="width:min(440px,92vw);max-height:80vh;overflow-y:auto">
          <div class="modal-header" id="sdmHeader" style="padding-bottom:12px">
            <div>
              <div id="sdmTitle" class="modal-title" style="font-size:17px"></div>
              <div id="sdmType" style="font-size:12px;font-weight:600;margin-top:3px"></div>
            </div>
            <button class="modal-close" onclick="document.getElementById('scheduleDetailModal').classList.remove('show')">✕</button>
          </div>
          <div class="modal-body" id="sdmBody" style="padding:16px 20px 20px"></div>
        </div>`;
      /* backdrop close disabled — use ✕ or ESC */
      document.body.appendChild(modal);
    }

    document.getElementById('sdmTitle').textContent = d.icon + ' ' + d.title;
    document.getElementById('sdmType').style.color = d.color;
    document.getElementById('sdmType').textContent = d.type;

    const rows = [
      d.store    ? `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--gray-100)"><span style="width:60px;font-size:12px;color:var(--gray-400);font-weight:600">점포</span><span style="font-size:13px;font-weight:700">${d.store}</span></div>` : '',
      d.date     ? `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--gray-100)"><span style="width:60px;font-size:12px;color:var(--gray-400);font-weight:600">날짜</span><span style="font-size:13px">${d.date}</span></div>` : '',
      d.engineer ? `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--gray-100)"><span style="width:60px;font-size:12px;color:var(--gray-400);font-weight:600">담당</span><span style="font-size:13px">${d.engineer}</span></div>` : '',
      d.note     ? `<div style="display:flex;gap:10px;padding:9px 0"><span style="width:60px;font-size:12px;color:var(--gray-400);font-weight:600">내용</span><span style="font-size:13px;color:var(--gray-600)">${d.note}</span></div>` : '',
    ].filter(Boolean).join('');

    document.getElementById('sdmBody').innerHTML = rows || '<p style="color:var(--gray-400);font-size:13px">상세 정보가 없습니다.</p>';
    modal.classList.add('show');
  }

  /* ═════════════════════════════════════════════════════════════════
     매장 장비 인스턴스 — 추가/편집/상태변경 모달 (Plan B)
     ═════════════════════════════════════════════════════════════════ */
  function _ensureStoreEquipModal() {
    let modal = document.getElementById('storeEquipEditorModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'storeEquipEditorModal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '9500';
    modal.innerHTML = `
      <div class="modal" style="max-width:520px;width:96%;max-height:88vh;overflow-y:auto">
        <div class="modal-header">
          <div class="modal-title" id="seemTitle">🖥 매장 장비</div>
          <button class="modal-close" onclick="document.getElementById('storeEquipEditorModal').classList.remove('show')">✕</button>
        </div>
        <div class="modal-body" id="seemBody" style="padding:18px 20px"></div>
        <div class="modal-footer" style="justify-content:space-between;gap:6px">
          <div id="seemFooterLeft"></div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-outline" onclick="document.getElementById('storeEquipEditorModal').classList.remove('show')">취소</button>
            <button class="btn btn-primary" id="seemSaveBtn">저장</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function _renderEquipFormFields(prefix, current) {
    const c = current || {};
    const catalog = (typeof getEquipmentCatalog === 'function') ? getEquipmentCatalog() : [];
    const statusOpts = Object.entries(STORE_EQUIP_STATUS).map(([k,v]) =>
      `<option value="${k}" ${c.status===k?'selected':''}>${v.label}</option>`).join('');
    const optsText = c.options && typeof c.options==='object'
      ? Object.entries(c.options).map(([k,v]) => `${k}: ${v}`).join('\n') : '';

    // 카테고리별 그룹화 — optgroup 으로 카탈로그를 종류별로 묶어 표시
    const byCategory = {};
    catalog.forEach(it => {
      const cat = it.category || '기타';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(it);
    });
    // 카테고리 우선순위 정렬: POS / 키오스크 / VAN / 주변기기 / 영수증 / 라벨 / 기타
    const catOrder = ['POS','키오스크','VAN','주변기기','영수증','라벨','기타'];
    const sortedCats = Object.keys(byCategory).sort((a,b) => {
      const ai = catOrder.findIndex(k => a.includes(k));
      const bi = catOrder.findIndex(k => b.includes(k));
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    const catalogGroups = sortedCats.map(cat => {
      const items = byCategory[cat].map(it =>
        `<option value="${esc(it.id)}" data-cat="${esc(cat)}" ${c.catalogId===it.id?'selected':''}>${esc(it.name)}</option>`
      ).join('');
      return `<optgroup label="${esc(cat)}">${items}</optgroup>`;
    }).join('');

    // 카테고리 필터 칩 (장비 종류 먼저 선택)
    const catChips = ['전체', ...sortedCats].map((cat, i) =>
      `<button type="button" class="seem-catchip${i===0?' active':''}" data-cat="${esc(cat)}" onclick="_seemFilterCat('${prefix}','${esc(cat)}',this)" style="background:${i===0?'#2563EB':'#fff'};color:${i===0?'#fff':'#374151'};border:1px solid ${i===0?'#2563EB':'#D1D5DB'};border-radius:99px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit">${esc(cat)}</button>`
    ).join('');

    return `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
        <div>
          <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:6px">📂 장비 종류 (먼저 선택)</label>
          <div id="${prefix}_catchips" style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">${catChips}</div>
          <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">카탈로그 항목 (변경되어도 매장 장비는 유지)</label>
          <select id="${prefix}_catalogId" onchange="_onSeemCatalogChange('${prefix}')" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
            <option value="">(직접 입력 — 카탈로그에 없음)</option>
            ${catalogGroups}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">장비명 *</label>
            <input type="text" id="${prefix}_name" value="${esc(c.name||'')}" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
          </div>
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">분류</label>
            <input type="text" id="${prefix}_category" value="${esc(c.category||'')}" placeholder="POS / 주변기기 등" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">수량</label>
            <input type="number" id="${prefix}_qty" value="${c.qty||1}" min="1" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
          </div>
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">상태(신/중고)</label>
            <select id="${prefix}_condition" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
              <option value="new" ${c.condition!=='used'?'selected':''}>신품</option>
              <option value="used" ${c.condition==='used'?'selected':''}>중고</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">라이프사이클</label>
            <select id="${prefix}_status" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">${statusOpts}</select>
          </div>
        </div>
        <div>
          <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">옵션 (각 줄: "이름: 값")</label>
          <textarea id="${prefix}_options" placeholder="예)&#10;길이(mm): 1800&#10;형태: 일자" style="width:100%;min-height:60px;padding:8px;border:1px solid var(--gray-200);border-radius:6px;font-family:inherit;font-size:12px;resize:vertical">${esc(optsText)}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">시리얼 (선택)</label>
            <input type="text" id="${prefix}_serial" value="${esc(c.serialNo||'')}" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
          </div>
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">사이즈 (선택)</label>
            <input type="text" id="${prefix}_size" value="${esc(c.size||'')}" placeholder="가로×세로 등" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">설치일</label>
            <input type="date" id="${prefix}_installedAt" value="${esc((c.installedAt||'').slice(0,10))}" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
          </div>
          <div>
            <label style="font-size:11px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:4px">설치자</label>
            <input type="text" id="${prefix}_installedBy" value="${esc(c.installedBy||'')}" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:6px">
          </div>
        </div>
        ${c.instanceId ? `<div style="font-size:10px;color:var(--gray-400);background:#F9FAFB;padding:6px 10px;border-radius:6px;font-family:monospace">ID: ${esc(c.instanceId)}${c.sourceJobId?' · 출처 작업: '+esc(c.sourceJobId):''}</div>` : ''}
      </div>`;
  }
  function _onSeemCatalogChange(prefix) {
    const sel = document.getElementById(prefix+'_catalogId');
    if (!sel || !sel.value) return;
    const catalog = (typeof getEquipmentCatalog === 'function') ? getEquipmentCatalog() : [];
    const it = catalog.find(x => x.id === sel.value);
    if (!it) return;
    const nameEl = document.getElementById(prefix+'_name');
    const catEl  = document.getElementById(prefix+'_category');
    if (nameEl && !nameEl.value) nameEl.value = it.name || '';
    if (catEl  && !catEl.value)  catEl.value  = it.category || '';
  }
  window._onSeemCatalogChange = _onSeemCatalogChange;

  // 장비 종류 칩 클릭 → 카탈로그 셀렉트 필터링
  window._seemFilterCat = function(prefix, cat, btn) {
    const chips = document.getElementById(prefix+'_catchips');
    if (chips) chips.querySelectorAll('.seem-catchip').forEach(c => {
      const active = (c === btn);
      c.classList.toggle('active', active);
      c.style.background = active ? '#2563EB' : '#fff';
      c.style.color = active ? '#fff' : '#374151';
      c.style.borderColor = active ? '#2563EB' : '#D1D5DB';
    });
    const sel = document.getElementById(prefix+'_catalogId');
    if (!sel) return;
    // optgroup 별로 카테고리 매칭 후 보임/숨김 (option 의 data-cat 사용)
    Array.from(sel.querySelectorAll('optgroup')).forEach(g => {
      const show = (cat === '전체') || (g.label === cat);
      g.style.display = show ? '' : 'none';
      Array.from(g.querySelectorAll('option')).forEach(o => o.disabled = !show);
    });
    // 현재 선택값이 숨겨진 카테고리에 속하면 (직접 입력) 으로 reset
    const selOpt = sel.options[sel.selectedIndex];
    if (selOpt && selOpt.parentElement && selOpt.parentElement.tagName === 'OPTGROUP' && selOpt.parentElement.style.display === 'none') {
      sel.value = '';
    }
  };

  function _collectEquipForm(prefix) {
    const optsText = (document.getElementById(prefix+'_options')?.value || '').trim();
    const options = {};
    if (optsText) {
      optsText.split(/\r?\n/).forEach(line => {
        const m = line.match(/^([^:：]+)[:：](.+)$/);
        if (m) options[m[1].trim()] = m[2].trim();
      });
    }
    return {
      catalogId:   document.getElementById(prefix+'_catalogId')?.value || null,
      name:        document.getElementById(prefix+'_name')?.value.trim() || '',
      category:    document.getElementById(prefix+'_category')?.value.trim() || '',
      qty:         Number(document.getElementById(prefix+'_qty')?.value) || 1,
      condition:   document.getElementById(prefix+'_condition')?.value || 'new',
      status:      document.getElementById(prefix+'_status')?.value || 'in_use',
      serialNo:    document.getElementById(prefix+'_serial')?.value.trim() || '',
      size:        document.getElementById(prefix+'_size')?.value.trim() || '',
      installedAt: document.getElementById(prefix+'_installedAt')?.value || '',
      installedBy: document.getElementById(prefix+'_installedBy')?.value.trim() || '',
      options,
    };
  }

  function openStoreEquipAdd() {
    const ctx = window._currentStoreEquipCtx;
    if (!ctx) { showToast && showToast('매장 컨텍스트가 없습니다'); return; }
    const modal = _ensureStoreEquipModal();
    document.getElementById('seemTitle').textContent = `🖥 ${ctx.storeName || ''} — 장비 추가`;
    document.getElementById('seemBody').innerHTML = _renderEquipFormFields('seem_new', {});
    document.getElementById('seemFooterLeft').innerHTML = '';
    document.getElementById('seemSaveBtn').onclick = () => {
      const data = _collectEquipForm('seem_new');
      if (!data.name) { showToast && showToast('장비명 입력 필요'); return; }
      addStoreEquipment(ctx, data, { toast:true });
      modal.classList.remove('show');
      // 매장 상세 모달 재렌더
      try { if (typeof reopenStoreDetail === 'function') reopenStoreDetail(); else location.reload(); } catch(e) { location.reload(); }
    };
    modal.classList.add('show');
  }
  window.openStoreEquipAdd = openStoreEquipAdd;

  function _findInstanceFromCtx(instanceId) {
    const ctx = window._currentStoreEquipCtx;
    if (!ctx) return null;
    const list = getStoreEquipment(ctx);
    return list.find(e => e.instanceId === instanceId) || null;
  }

  function openStoreEquipEditor(instanceId) {
    const ctx = window._currentStoreEquipCtx;
    const inst = _findInstanceFromCtx(instanceId);
    if (!ctx || !inst) { showToast && showToast('장비를 찾을 수 없음'); return; }
    const modal = _ensureStoreEquipModal();
    document.getElementById('seemTitle').textContent = `✎ ${inst.name} — 편집`;
    document.getElementById('seemBody').innerHTML = _renderEquipFormFields('seem_ed', inst);
    document.getElementById('seemFooterLeft').innerHTML = `
      <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:var(--danger);font-weight:700"
              onclick="if(confirm('이 장비 인스턴스를 폐기 처리하시겠습니까?\\n(데이터는 보존, 상태만 disposed)')){updateStoreEquipment(window._currentStoreEquipCtx,'${esc(instanceId)}',{status:'disposed'},{toast:true});document.getElementById('storeEquipEditorModal').classList.remove('show');try{reopenStoreDetail()}catch(e){location.reload()}}">
        🗑 폐기 처리
      </button>`;
    document.getElementById('seemSaveBtn').onclick = () => {
      const data = _collectEquipForm('seem_ed');
      if (!data.name) { showToast && showToast('장비명 필요'); return; }
      updateStoreEquipment(ctx, instanceId, data, { toast:true });
      modal.classList.remove('show');
      try { reopenStoreDetail(); } catch(e) { location.reload(); }
    };
    modal.classList.add('show');
  }
  window.openStoreEquipEditor = openStoreEquipEditor;

  function openStoreEquipStatusPicker(instanceId) {
    const inst = _findInstanceFromCtx(instanceId);
    if (!inst) { showToast && showToast('장비를 찾을 수 없음'); return; }
    const opts = Object.entries(STORE_EQUIP_STATUS).map(([k,v]) =>
      `${k===inst.status?'· (현재) ':'  '}${k} = ${v.label}`).join('\n');
    const next = prompt(`상태 변경 — ${inst.name}\n\n다음 중 하나를 입력하세요:\n${opts}\n\n사유 / 메모 (선택)는 다음 단계에서.`, inst.status);
    if (!next || !STORE_EQUIP_STATUS[next]) return;
    const note = prompt('상태 변경 메모 (선택)', '') || '';
    updateStoreEquipment(window._currentStoreEquipCtx, instanceId, { status: next, statusNote: note }, { toast:true });
    try { reopenStoreDetail(); } catch(e) { location.reload(); }
  }
  window.openStoreEquipStatusPicker = openStoreEquipStatusPicker;

  function reopenStoreDetail() {
    /* 현재 열려있는 매장 상세 모달을 다시 채워 넣기 (페이지 새로고침 X) */
    // sdv2: 저장된 row 로 toggleStoreDetail 재호출 — 현재 활성 탭 유지
    const savedRow = window._currentStoreDetailRow;
    if (savedRow && typeof window.toggleStoreDetail === 'function') {
      // 현재 활성 탭 기억
      const activeTab = document.querySelector('#storeDetailTabbar .sdv2-tab.active');
      const activeKey = activeTab ? activeTab.dataset.pane : 'ongoing';
      try {
        window.toggleStoreDetail(savedRow);
        // 다시 그렸으니 같은 탭 활성화
        setTimeout(() => {
          const tabs = document.querySelectorAll('#storeDetailTabbar .sdv2-tab');
          const panes = document.querySelectorAll('#storeDetailModal .sdv2-pane');
          tabs.forEach(t => t.classList.toggle('active', t.dataset.pane === activeKey));
          panes.forEach(p => p.classList.toggle('active', p.dataset.pane === activeKey));
        }, 30);
        return;
      } catch(e) { console.warn('[reopenStoreDetail] toggleStoreDetail 재호출 실패', e); }
    }
    // legacy fallback — openStoreDetail 류 함수가 있으면 호출
    const ctx = window._currentStoreEquipCtx;
    if (!ctx) return;
    if (typeof window.openStoreDetail === 'function' && ctx.storeName) {
      try { window.openStoreDetail(ctx.storeName); return; } catch(e){}
    }
    showToast && showToast('💡 매장 상세를 다시 열어 변경 사항을 확인하세요');
  }
  window.reopenStoreDetail = reopenStoreDetail;

  /* 페이지 로드 후 1회 자동 마이그레이션 — job.equipment → store.equipment
     v2 정책: 완료 작업 = 모든 장비 / 진행 작업 = checked 만
     이미 적재된 항목(sourceJobId+idx)은 자동 skip */
  setTimeout(() => {
    try {
      if (typeof migrateJobEquipmentToStore !== 'function') return;
      const r = migrateJobEquipmentToStore();
      if (r && r.ok && r.added > 0) {
        console.log(`[migrate v${r.version}] store.equipment — ${r.added}건 / ${r.stores}개 매장 적재${r.noStoreMatched ? ' (매장 매칭 실패 '+r.noStoreMatched+'건)' : ''}`);
        if (typeof showToast === 'function') {
          showToast(`📦 매장 장비 DB 마이그레이션 — ${r.stores}개 매장에 ${r.added}건 장비 자동 연결`, 6000);
        }
      } else if (r && r.skipped) {
        console.log('[migrate] skipped —', r.reason);
      }
    } catch(e) { console.warn('[migrate] failed:', e); }
  }, 1500);

  /* 페이지 로드 후 1회 자동 백필 — job 연락처(이름/직책/전화/이메일/주소) → store.contacts
     idempotent(전화번호 dedupe). 모든 작업(모바일 생성 포함, 동기화된 것) 스캔. */
  setTimeout(() => {
    try {
      if (typeof migrateJobContactsToStore !== 'function') return;
      const r = migrateJobContactsToStore();
      if (r && r.ok && r.added > 0) {
        console.log(`[migrate] store.contacts — ${r.added}건 연락처 매장 누적`);
        if (typeof showToast === 'function') showToast(`📇 연락처 ${r.added}건을 매장에 누적했습니다`, 5000);
      }
    } catch(e) { console.warn('[migrate contacts] failed:', e); }
  }, 3000);

  /* 페이지 로드 후 1회 — 저장된 작성자 '닉네임 → 실명' 일괄 정리 (ns_users nicknames 레지스트리 기반)
     예: '미디' → '박재민'. _normalizeDisplayName 으로 변환 — 미등록 닉네임/실명은 그대로(안전).
     saveJobs 가 변경된 job 만 updatedAt bump + push → 다른 기기도 동기화로 실명 반영. */
  window.migrateJobAuthorNicknames = function(opts) {
    opts = opts || {};
    const FLAG = 'ns_author_nick_migrated_v1';
    if (!opts.force && localStorage.getItem(FLAG) === '1') return { skipped:true };
    const norm = window._normalizeDisplayName;
    if (typeof norm !== 'function') return { skipped:true, reason:'no _normalizeDisplayName' };
    let jobs = []; try { jobs = (typeof getJobs === 'function') ? (getJobs() || []) : []; } catch(e){ return { skipped:true }; }
    const FIELDS = ['author','createdBy','recordedBy','assignee','engineer','owner','_whoCreated','completedBy','lastEditedBy'];
    const fix = (v) => { if (!v || typeof v !== 'string') return v; const n = norm(v); return (n && n !== v) ? n : v; };
    let changed = 0;
    jobs.forEach(j => {
      if (!j || typeof j !== 'object') return;
      let jc = false;
      FIELDS.forEach(f => { const nv = fix(j[f]); if (nv !== j[f]) { j[f] = nv; jc = true; } });
      if (Array.isArray(j.assignees)) j.assignees = j.assignees.map(a => { const nv = fix(a); if (nv !== a) jc = true; return nv; });
      if (Array.isArray(j.thread))  j.thread.forEach(e => { if (e) { const nv = fix(e.author); if (nv !== e.author) { e.author = nv; jc = true; } } });
      if (Array.isArray(j.memos))   j.memos.forEach(m => { if (m) { ['author','recordedBy'].forEach(f => { const nv = fix(m[f]); if (nv !== m[f]) { m[f] = nv; jc = true; } }); } });
      if (jc) changed++;
    });
    if (changed > 0 && typeof saveJobs === 'function') {
      saveJobs(jobs);
      try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud({ toast:false }); } catch(e){}
    }
    try { localStorage.setItem(FLAG, '1'); } catch(_){}
    return { ok:true, changed };
  };
  setTimeout(() => {
    try {
      const r = window.migrateJobAuthorNicknames();
      if (r && r.ok && r.changed > 0) {
        console.log('[migrate] 작성자 닉네임→실명 ' + r.changed + '건');
        if (typeof showToast === 'function') showToast('📝 작성자 닉네임 ' + r.changed + '건을 실명으로 정리했습니다', 5000);
      }
    } catch(e) { console.warn('[migrate author] failed:', e); }
  }, 4500);

  /* 관리자 강제 재실행 — console 또는 마이페이지 버튼 */
  window.forceReMigrateStoreEquipment = function() {
    if (!confirm('매장 장비 DB 를 강제 재마이그레이션 하시겠습니까?\n\n동작:\n- 모든 작업의 장비를 스캔\n- 완료 작업: 모든 장비 적재 / 진행 작업: checked 만\n- 이미 적재된 항목은 중복 방지 (sourceJobId+idx 매칭)\n\n안전 — 데이터 손실 없음.')) return;
    const r = migrateJobEquipmentToStore({ force:true });
    const msg = `마이그레이션 완료\n\n적재: ${r.added}건\n영향 매장: ${r.stores}개${r.noStoreMatched ? '\n매장 매칭 실패: '+r.noStoreMatched+'건' : ''}\n\n클라우드에 자동 동기화 중...`;
    alert(msg);
    return r;
  };

  /* ── 매장 변경이력(changeLog) 라벨 일괄 정정 ──
     - 옛 인라인 포맷 {field, before, after} → {type, from, to} 로 승격
     - 자동타입 라벨(상호/사업자/대표자/주소/연락처/VAN/정보 변경)을 실제 바뀐 필드로 정정
       (주소만 바꿨는데 '상호 변경'으로 찍힌 옛 데이터 교정)
     - '매장 병합'/'병합 취소'/'재오픈'/'기타'/커스텀 라벨 및 diff 없는 항목은 건드리지 않음
     - 안전: 라벨/포맷만 수정, 값(from/to)·날짜·작성자 보존. updatedAt bump 안 함(필드 값은 안 바꾸므로).
     - ⚠ 다중기기 수렴: changeLog 머지 중복키가 at|note 라 'type 만' 바꾼 정정은, 아직 정정을
       안 돌린 기기의 옛 라벨 항목이 머지에서 먼저 채택돼 일시적으로 되돌아갈 수 있음.
       각 기기가 로드 시 1회(flag) 정정을 돌리므로 결국 모두 수렴(eventually consistent). */
  function fixChangeLogLabels(opts) {
    opts = opts || {};
    const AUTO_TYPES = new Set(['상호 변경','사업자 변경','대표자 변경','주소 이전','연락처 변경','VAN 변경','정보 변경','변경']);
    const autoMap = { name:'상호 변경', storeName:'상호 변경', signageName:'간판명 변경', biz:'사업자 변경', bizno:'사업자 변경', ceo:'대표자 변경', ceoTel:'대표자 연락처 변경', addr:'주소 이전', address:'주소 이전', tel:'연락처 변경', phone:'연락처 변경', van:'VAN 변경' };
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    let fixed = 0, upgraded = 0, storesTouched = 0;
    stores.forEach(s => {
      if (!Array.isArray(s.changeLog) || !s.changeLog.length) return;
      let touched = false;
      s.changeLog.forEach(l => {
        if (!l) return;
        // (A) 옛 인라인 포맷 승격: {field, before, after} → {type, from, to}
        if (l.field && !l.from && !l.to) {
          const t = autoMap[l.field] || `${l.field} 변경`;
          l.type = t;
          l.from = { [l.field]: l.before || '' };
          l.to   = { [l.field]: l.after  || '' };
          delete l.field; delete l.before; delete l.after;
          upgraded++; touched = true;
          return;
        }
        // (B) 자동타입 라벨 정정 — diff 로 실제 변경 필드 판별
        if (l.type && !AUTO_TYPES.has(l.type)) return;   // 병합/재오픈/기타/커스텀 보존
        const from = l.from || {}, to = l.to || {};
        const keys = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]));
        if (!keys.length) return;                         // diff 없음 → 판단 불가, 유지
        const changed = keys.filter(k => (from[k]||'') !== (to[k]||''));
        if (!changed.length) return;
        const correct = (changed.length === 1) ? (autoMap[changed[0]] || l.type || '정보 변경') : '정보 변경';
        if (correct !== l.type) { l.type = correct; fixed++; touched = true; }
      });
      if (touched) storesTouched++;
    });
    const total = fixed + upgraded;
    if (total > 0 && !opts.dryRun) {
      // saveStores 가 dirty=true + push 예약. force 안 씀 → dirty/해시-스킵 echo 보호 유지
      //   (N대 기기가 force 로 전체배열을 동시에 KV 에 쓰는 증폭/put-한도 위험 제거).
      try { saveStores(stores); } catch(_){}
      try { pushStoresToCloud({ toast:false }); } catch(_){}
      try { if (typeof hydrateSavedStores === 'function') hydrateSavedStores(); } catch(_){}
    }
    return { ok:true, fixed, upgraded, total, stores: storesTouched };
  }
  window.fixChangeLogLabels = fixChangeLogLabels;

  /* 페이지 로드 후 1회 자동 정정 (idempotent — flag) */
  setTimeout(() => {
    try {
      const FLAG = 'ns_changelog_label_fix_v1';
      if (localStorage.getItem(FLAG)) return;
      const r = fixChangeLogLabels();
      localStorage.setItem(FLAG, String(Date.now()));
      if (r.total > 0) {
        console.log(`[changelog-fix] 변경이력 라벨 정정 — 정정 ${r.fixed} · 포맷승격 ${r.upgraded} (${r.stores}개 매장)`);
        if (typeof showToast === 'function') showToast(`🏷 변경이력 라벨 ${r.total}건 자동 정정 (${r.stores}개 매장)`, 5000);
      }
    } catch(e) { console.warn('[changelog-fix] failed:', e); }
  }, 2500);

  /* 관리자 강제 재실행 — console 또는 버튼 */
  window.forceFixChangeLogLabels = function() {
    const dry = fixChangeLogLabels({ dryRun:true });
    if (dry.total === 0) { alert('정정할 변경이력이 없습니다 (이미 모두 정상).'); return dry; }
    if (!confirm(`변경이력 라벨 일괄 정정\n\n정정 대상: ${dry.fixed}건 (라벨 교정)\n포맷 승격: ${dry.upgraded}건\n영향 매장: ${dry.stores}개\n\n안전 — 변경 내용/날짜/작성자는 보존, 라벨만 실제 변경 필드로 교정합니다.\n진행할까요?`)) return;
    const r = fixChangeLogLabels();
    localStorage.setItem('ns_changelog_label_fix_v1', String(Date.now()));
    alert(`완료 — 라벨 정정 ${r.fixed}건 · 포맷 승격 ${r.upgraded}건 (${r.stores}개 매장)\n클라우드 동기화 중...`);
    return r;
  };

  /* ── 🧹 작업 데이터 1회 치유 — thread 중복 제거(#2) + 작성자 가명→실명(#1) ──
     - _dedupeThread 로 콘텐츠 중복 ROOT/child collapse (마이그레이션 재-prefix 잔재 정리)
     - ns_users.nicknames 맵으로 stored author/engineer/assignee/createdBy/completedBy/memos 정정
     - per-job mtime 으로 변경분만 push (stale 보호). 기기당 1회(flag ns_jobs_heal_v1). */
  function _nickToRealMap() {
    const map = {};
    try {
      const users = JSON.parse(localStorage.getItem('ns_users') || '[]');
      users.forEach(u => {
        if (u && u.name && Array.isArray(u.nicknames)) {
          u.nicknames.forEach(n => { const k = String(n||'').trim(); if (k) map[k] = u.name; });
        }
      });
    } catch(_){}
    return map;
  }
  window.healJobsData = function(opts) {
    opts = opts || {};
    const nick = _nickToRealMap();
    const fix = (v) => { const s = String(v||'').trim(); return (s && nick[s]) ? nick[s] : v; };
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    let threadDeduped = 0, namesFixed = 0, jobsTouched = 0;
    jobs.forEach(j => {
      if (!j) return;
      let touched = false;
      if (Array.isArray(j.thread) && j.thread.length > 1) {
        const before = j.thread.length;
        const dd = _dedupeThread(j.thread.slice());
        if (dd.length !== before) { j.thread = dd; threadDeduped += (before - dd.length); touched = true; }
      }
      (j.thread || []).forEach(e => { if (e) { const nv = fix(e.author); if (nv !== e.author) { e.author = nv; namesFixed++; touched = true; } } });
      ['engineer','assignee','createdBy','completedBy','lastEditedBy'].forEach(k => {
        const nv = fix(j[k]); if (j[k] && nv !== j[k]) { j[k] = nv; namesFixed++; touched = true; }
      });
      (j.memos || []).forEach(m => { if (m) ['assignee','recordedBy','by','author'].forEach(k => {
        const nv = fix(m[k]); if (m[k] && nv !== m[k]) { m[k] = nv; namesFixed++; touched = true; }
      }); });
      if (touched) jobsTouched++;
    });
    if ((threadDeduped + namesFixed) > 0 && !opts.dryRun) {
      try { saveJobs(jobs); } catch(_){}
      try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud({ toast:false }); } catch(_){}
    }
    return { ok:true, threadDeduped, namesFixed, jobs: jobsTouched };
  };
  setTimeout(() => {
    try {
      const FLAG = 'ns_jobs_heal_v1';
      if (localStorage.getItem(FLAG)) return;
      const r = window.healJobsData();
      localStorage.setItem(FLAG, String(Date.now()));
      if ((r.threadDeduped + r.namesFixed) > 0) {
        console.log(`[heal] thread중복 ${r.threadDeduped} · 이름정정 ${r.namesFixed} (${r.jobs}개 작업)`);
        if (typeof showToast === 'function') showToast(`🧹 데이터 정리 — 중복 ${r.threadDeduped}건 · 이름 ${r.namesFixed}건`, 5000);
      }
    } catch(e) { console.warn('[heal] failed:', e); }
  }, 3000);
  window.forceHealJobsData = function() {
    const dry = window.healJobsData({ dryRun:true });
    if ((dry.threadDeduped + dry.namesFixed) === 0) { alert('정리할 항목이 없습니다 (이미 정상).'); return dry; }
    if (!confirm(`작업 데이터 정리\n\nthread 중복 제거: ${dry.threadDeduped}건\n작성자 이름 정정: ${dry.namesFixed}건\n영향 작업: ${dry.jobs}개\n\n진행할까요?`)) return;
    const r = window.healJobsData();
    localStorage.setItem('ns_jobs_heal_v1', String(Date.now()));
    alert(`완료 — 중복 ${r.threadDeduped}건 · 이름 ${r.namesFixed}건 정정 (${r.jobs}개 작업)\n클라우드 동기화 중...`);
    return r;
  };

  /* ── 🔄 새 버전 배포 감지 → 새로고침 안내 ──
     실행중 버전 = 로드된 app.js 의 ?v=, 최신 버전 = 현재 페이지 HTML 을 no-store 로 다시 받아 파싱.
     배포마다 bump 하는 ?v= 를 그대로 버전 마커로 사용(추가 파일·이중 bump 불필요).
     SPA 라 탭을 안 닫으면 옛 코드가 계속 도는 문제를 메움 — PC/모바일 공통 패턴(여기는 app.js=PC). */
  function _setupVersionWatch(scriptName) {
    function readV(srcHaystack) {
      const m = String(srcHaystack || '').match(/[?&]v=([^&"'\s]+)/);
      return m ? m[1] : '';
    }
    function currentV() {
      const tags = Array.from(document.querySelectorAll('script[src]'));
      const t = tags.find(s => (s.getAttribute('src') || '').indexOf(scriptName) >= 0);
      return t ? readV(t.getAttribute('src')) : '';
    }
    const RUNNING = currentV();
    if (!RUNNING) return;   // 버전 못 읽으면 비활성(안전)
    let notified = false;
    let timer = null;
    const re = new RegExp(scriptName.replace(/[.]/g, '\\.') + '\\?v=([^"\'&\\s]+)');
    async function check() {
      if (notified) return;
      try {
        const res = await fetch(location.pathname + '?_vc=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(re);
        const live = m ? m[1] : '';
        if (live && live !== RUNNING) {
          notified = true; if (timer) clearInterval(timer);
          try { sessionStorage.setItem('ns_version_stale', '1'); } catch(_){}  // 풀다운/새로고침에도 즉시 재표시되도록 표시
          _showVersionBanner();
        } else if (live && live === RUNNING) {
          try { sessionStorage.removeItem('ns_version_stale'); } catch(_){}  // 진짜 최신 → 잔여 플래그 제거
        }
      } catch (_) {}
    }
    // 직전에 '구버전' 으로 떴었다면(=캐시된 옛 코드로 새로고침/풀다운해도 사라진 것처럼 보이는 것 방지) 즉시 재확인
    let _wasStale = false; try { _wasStale = sessionStorage.getItem('ns_version_stale') === '1'; } catch(_){}
    setTimeout(check, _wasStale ? 0 : 5000);
    timer = setInterval(check, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }
  // 🔄 완전 새로고침(캐시 무력화) — 페이지 URL 에 _u 파라미터를 붙여 HTML 부터 새로 받음 → 새 ?v= 스크립트 로드.
  //   iOS Safari 등 캐시 강한 환경에서 일반 reload 가 옛 코드를 다시 쓰는 문제 회피.
  function _hardReloadForUpdate() {
    try {
      const u = new URL(location.href);
      u.searchParams.set('_u', String(Date.now()));   // 기존 쿼리(desktop=1 등)·해시 보존
      location.href = u.toString();
    } catch(_) { try { location.reload(); } catch(e) { location.href = location.href; } }
  }
  // PC — 화면 중앙 강제 모달 (닫기/나중에 없음, 클릭해야만 진행)
  function _showVersionBanner() {
    if (document.getElementById('nsVersionModal')) return;
    const ov = document.createElement('div');
    ov.id = 'nsVersionModal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,0.80);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = '<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:32px 26px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,0.45);font-family:inherit">'
      + '<div style="font-size:46px;margin-bottom:12px">🔄</div>'
      + '<div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:10px">새 버전이 배포되었습니다</div>'
      + '<div style="font-size:13.5px;color:#475569;line-height:1.65;margin-bottom:24px">최신 기능과 동기화 개선을 적용하려면 업데이트가 필요합니다.<br>아래 버튼을 누르면 <b>완전히 새로고침</b>됩니다.</div>'
      + '<button id="nsVerReload" style="background:#1D4ED8;color:#fff;border:none;border-radius:11px;padding:15px 28px;font-weight:800;font-size:15px;cursor:pointer;width:100%">지금 업데이트</button></div>';
    document.body.appendChild(ov);
    const rl = document.getElementById('nsVerReload');
    if (rl) rl.onclick = _hardReloadForUpdate;
  }
  window._showVersionBanner = _showVersionBanner;
  setTimeout(() => { try { _setupVersionWatch('app-08.js'); } catch(_){} }, 100);  // 분할: 마지막 세그먼트 ?v= 감시(전 세그먼트 동일 ?v=)
