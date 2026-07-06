  /* ═════════════════════════════════════════════════════════════
     공통 자동완성 헬퍼 (Autocomplete)
     ─────────────────────────────────────────────────────────────
     [규칙] 사이트의 모든 input 자동완성/제안 드롭다운은 반드시 이
     헬퍼를 사용한다. HTML5 <datalist> 금지, 직접 dropdown 구현 금지.
     blur/click race, 모바일 터치 누락 같은 버그가 한 곳에서 해결됨.

     사용:
       Autocomplete.register('store', {
         search: (q, key) => 결과 배열,
         renderItem: (item, isActive) => HTML 문자열 (inner),
         onPick: (item, key) => void,
         maxItems: 8,
       });

     HTML:
       <div style="position:relative">
         <input id="storeInput-${key}"
                oninput="Autocomplete.live('store', '${key}', this)"
                onfocus="Autocomplete.live('store', '${key}', this)"
                onkeydown="Autocomplete.key('store', '${key}', event)"
                onblur="setTimeout(()=>Autocomplete.hide('store', '${key}'), 200)">
         <div id="storeSuggest-${key}" style="display:none;position:absolute;..."></div>
       </div>
     ═══════════════════════════════════════════════════════════*/
  const _ACReg = {};
  const _ACState = {};
  window.Autocomplete = {
    register(kind, cfg) {
      _ACReg[kind] = {
        search: cfg.search,
        renderItem: cfg.renderItem,
        onPick: cfg.onPick,
        maxItems: cfg.maxItems || 8,
        inputPrefix: cfg.inputPrefix || (kind + 'Input-'),
        suggestPrefix: cfg.suggestPrefix || (kind + 'Suggest-'),
        emptyMessage: cfg.emptyMessage || '매칭 결과 없음',
      };
    },
    live(kind, key, inputEl) {
      const cfg = _ACReg[kind];
      if (!cfg) { console.warn('[Autocomplete] not registered:', kind); return; }
      const q = (inputEl.value || '').trim();
      const results = (cfg.search(q, key) || []).slice(0, cfg.maxItems);
      const stateKey = kind + ':' + key;
      _ACState[stateKey] = { results, activeIdx: results.length ? 0 : -1, kind, key };
      Autocomplete._render(stateKey);
    },
    key(kind, key, ev) {
      const cfg = _ACReg[kind]; if (!cfg) return;
      const stateKey = kind + ':' + key;
      const st = _ACState[stateKey];
      if (ev.key === 'Escape') { Autocomplete.hide(kind, key); return; }
      if (!st || !st.results.length) return;
      const max = st.results.length - 1;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        st.activeIdx = Math.min(max, (st.activeIdx < 0 ? 0 : st.activeIdx + 1));
        Autocomplete._render(stateKey);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        st.activeIdx = Math.max(0, st.activeIdx - 1);
        Autocomplete._render(stateKey);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const sel = st.results[st.activeIdx];
        if (sel) cfg.onPick(sel, key);
        else Autocomplete.hide(kind, key);
      } else if (ev.key === 'Tab' && st.activeIdx >= 0 && !ev.shiftKey) {
        const sel = st.results[st.activeIdx];
        if (sel) cfg.onPick(sel, key);
      }
    },
    hide(kind, key) {
      const cfg = _ACReg[kind]; if (!cfg) return;
      const el = document.getElementById(cfg.suggestPrefix + key);
      if (el) el.style.display = 'none';
    },
    setActive(kind, key, idx) {
      const stateKey = kind + ':' + key;
      const st = _ACState[stateKey]; if (!st) return;
      st.activeIdx = idx;
      Autocomplete._render(stateKey);
    },
    pick(kind, key, idx) {
      const cfg = _ACReg[kind]; if (!cfg) return;
      const stateKey = kind + ':' + key;
      const st = _ACState[stateKey]; if (!st) return;
      const sel = st.results[idx];
      if (sel) cfg.onPick(sel, key);
    },
    _render(stateKey) {
      const st = _ACState[stateKey]; if (!st) return;
      const cfg = _ACReg[st.kind]; if (!cfg) return;
      const el = document.getElementById(cfg.suggestPrefix + st.key);
      if (!el) return;
      const { results, activeIdx } = st;
      el.style.display = '';
      if (!results.length) {
        el.innerHTML = `<div style="padding:10px;color:var(--gray-500);font-size:11px;text-align:center">${cfg.emptyMessage}</div>`;
        return;
      }
      el.innerHTML = results.map((item, i) => {
        const active = i === activeIdx;
        const inner = cfg.renderItem(item, active);
        // onmousedown + ontouchstart + preventDefault → input blur 차단 후 즉시 onPick 실행
        return `<div data-idx="${i}"
                     onmousedown="event.preventDefault(); Autocomplete.pick('${st.kind}', '${esc(st.key)}', ${i})"
                     ontouchstart="event.preventDefault(); Autocomplete.pick('${st.kind}', '${esc(st.key)}', ${i})"
                     onmouseenter="Autocomplete.setActive('${st.kind}', '${esc(st.key)}', ${i})"
                     role="button"
                     style="cursor:pointer;border-bottom:1px solid var(--gray-100);background:${active?'#DBEAFE':'#fff'};user-select:none;-webkit-tap-highlight-color:rgba(59,130,246,.2)">${inner}</div>`;
      }).join('');
    },
  };

  // 사이트 시작 시 1회 등록 — store / assignee 두 kind 사용
  Autocomplete.register('store', {
    search: (q) => _searchStores(q, 8),
    renderItem: (s, active) => {
      const addr = s.addr || s.address || '';
      const tel = s.tel || s.phone || '';
      const bizNo = s.bizNo || s.biz || '';
      return `<div style="padding:7px 10px">
        <div style="font-size:12px;font-weight:700;color:var(--gray-900);display:flex;align-items:center;gap:6px">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name||'-')}</span>
          ${bizNo ? `<span style="font-size:10px;color:var(--gray-500);font-family:monospace;font-weight:500">${esc(bizNo)}</span>` : ''}
        </div>
        <div style="font-size:10px;color:var(--gray-500);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">
          ${s.ceo ? `<span>👤 ${esc(s.ceo)}</span>` : ''}
          ${tel ? `<span style="color:#1D4ED8">📞 ${esc(tel)}</span>` : ''}
          ${addr ? `<span style="flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📍 ${esc(addr)}</span>` : ''}
        </div>
      </div>`;
    },
    onPick: (s, pendId) => selectStoreForPending(pendId, s.id),
    emptyMessage: '매칭되는 매장 없음 — 다른 키워드로 검색해 주세요',
  });

  Autocomplete.register('assignee', {
    search: (q) => {
      const users = (typeof getUsers === 'function') ? (getUsers() || []) : [];
      const names = users.map(u => (u.name || u.email || '')).filter(Boolean);
      if (!q) return names;
      const qLow = q.toLowerCase();
      return names.filter(n => n.toLowerCase().includes(qLow));
    },
    renderItem: (name, active) => `<div style="padding:7px 10px;font-size:12px;font-weight:600">👤 ${esc(name)}</div>`,
    onPick: (name, pendId) => selectAssigneeForPending(pendId, name),
    emptyMessage: '일치하는 사용자 없음 (이름 입력 후 Enter 로 자유 입력 가능)',
  });


  /* 검색 상태 — pendId 별 결과/하이라이트 인덱스 — (구버전 호환, 점진 제거) */
  const _storeSearchState = {};

  /* oninput — 라이브 검색 — 구버전 호환 wrapper (Autocomplete 헬퍼로 위임) */
  function onStoreSearchLive(pendId, inputEl) {
    Autocomplete.live('store', pendId, inputEl);
  }
  window.onStoreSearchLive = onStoreSearchLive;

  /* 구버전 함수들 — Autocomplete 헬퍼로 위임. 다른 코드에서 직접 호출 시 호환 보장. */
  window.onStoreSearchKey = (ev, pendId) => Autocomplete.key('store', pendId, ev);
  window.hideStoreSuggest = (pendId) => Autocomplete.hide('store', pendId);
  window._setStoreActive  = (pendId, idx) => Autocomplete.setActive('store', pendId, idx);

  /* 결과 선택 — 매장 연결 + 상단 패널 갱신 + 드롭다운 닫기 + 검색창 비움 */
  function selectStoreForPending(pendId, storeId) {
    const it = _linePending.find(x => x.id === pendId);
    if (!it) return;
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const s = stores.find(x => x.id === storeId);
    if (!s) return;
    it.storeId = s.id;
    it.store = s.name;
    _flushPending(pendId, { storeId: s.id, store: s.name });
    const input = document.getElementById('storeInput-' + pendId);
    if (input) input.value = '';
    hideStoreSuggest(pendId);
    _storeSearchState[pendId] = { results: [], activeIdx: -1 };
    _updateStoreStatusPanel(pendId);
    showToast('🏪 매장 연결: ' + s.name);
  }
  window.selectStoreForPending = selectStoreForPending;

  /* 연결된 매장 패널 — 2행 레이아웃 (헤더 + 주소·전화) */
  function _renderConnectedStorePanel(pendId, s, originalStoreText) {
    const showOriginal = originalStoreText && originalStoreText !== s.name;
    const addr = s.addr || s.address || '';
    const tel = s.tel || s.phone || '';
    const bizNo = s.bizNo || s.biz || '';
    const ceo = s.ceo || '';
    const telLink = tel ? `<a href="tel:${esc(tel)}" style="color:#1D4ED8;text-decoration:none;font-weight:700">📞 ${esc(tel)}</a>` : '';
    return `<div style="background:#F0FDF4;border:1px solid var(--success);border-radius:5px;padding:6px 10px">
      <!-- 1행: 연결됨 + 매장명 + 사업자 + 원문 + 해제 -->
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:700;color:var(--success);flex-shrink:0">✓ 연결됨</span>
        <span style="font-size:13px;font-weight:800;color:var(--gray-900);flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name||'-')}</span>
        ${bizNo ? `<span style="font-size:10px;color:var(--gray-500);font-family:monospace">${esc(bizNo)}</span>` : ''}
        ${showOriginal ? `<span style="font-size:10px;color:#92400E;background:#FEF3C7;padding:1px 6px;border-radius:3px" title="LINE 원문에서 추출된 매장명">원문: ${esc(originalStoreText)}</span>` : ''}
        <span onclick="clearPendingStore('${pendId}')" title="연결 해제" style="cursor:pointer;color:var(--gray-400);font-size:14px;font-weight:700;padding:0 4px">✕</span>
      </div>
      <!-- 2행: 주소 · 전화 · 대표자 (있을 때만) -->
      ${(addr || tel || ceo) ? `
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px;font-size:11px;color:var(--gray-700);flex-wrap:wrap">
          ${ceo ? `<span>👤 ${esc(ceo)}</span>` : ''}
          ${tel ? `<span>${telLink}</span>` : ''}
          ${addr ? `<span style="flex:1;min-width:150px;color:var(--gray-600)" title="${esc(addr)}">📍 ${esc(addr)}</span>` : ''}
        </div>` : ''}
    </div>`;
  }

  /* 연결 상태 패널만 다시 그리기 — 전체 리렌더 회피로 검색 입력 포커스 유지 가능 */
  function _updateStoreStatusPanel(pendId) {
    const it = _linePending.find(x => x.id === pendId);
    if (!it) return;
    const statusEl = document.getElementById('storeStatus-' + pendId);
    if (!statusEl) return;
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const linkedStore = it.storeId ? stores.find(x => x.id === it.storeId) : null;
    if (linkedStore) {
      statusEl.innerHTML = _renderConnectedStorePanel(pendId, linkedStore, it.storeOriginal);
    } else if (it.storeId) {
      statusEl.innerHTML = `<div style="padding:5px 8px;background:#FEE2E2;border:1px solid var(--danger);border-radius:5px;font-size:11px;color:#991B1B;display:flex;align-items:center;gap:6px">
        <span style="font-weight:700">⚠ 잘못된 연결</span>
        <span style="flex:1">존재하지 않는 매장 ID — 원문: <b>${esc(it.store || '없음')}</b></span>
        <button onclick="clearPendingStore('${pendId}')" style="font-size:10px;padding:2px 8px;background:var(--danger);color:#fff;border:none;border-radius:3px;cursor:pointer;font-weight:700">🔧 정리</button>
      </div>`;
    } else {
      statusEl.innerHTML = `<div style="padding:5px 8px;background:#FFFBEB;border:1px solid var(--warning);border-radius:5px;font-size:11px;color:#92400E">
        ⚠ 미연결 — 원문: <b>${esc(it.store || '없음')}</b>
      </div>`;
    }
  }

  // 구 함수명 호환
  const _updateStoreInputStyle = (pendId) => _updateStoreStatusPanel(pendId);

  /* 담당자 autocomplete — Autocomplete 헬퍼로 위임 (구버전 호환) */
  window.onAssigneeSearchLive = (pendId, inputEl) => Autocomplete.live('assignee', pendId, inputEl);

  /* 구버전 호환 wrapper — Autocomplete 헬퍼로 위임 */
  window.onAssigneeSearchKey = (ev, pendId) => Autocomplete.key('assignee', pendId, ev);
  window.hideAssigneeSuggest = (pendId) => Autocomplete.hide('assignee', pendId);
  window._setAssigneeActive  = (pendId, idx) => Autocomplete.setActive('assignee', pendId, idx);

  /* 담당자 선택 시 비즈니스 로직 — Autocomplete.onPick 에서 호출 */
  function selectAssigneeForPending(pendId, name) {
    const inp = document.getElementById('assigneeInput-' + pendId);
    if (inp) inp.value = name;
    updatePending(pendId, { assignee: name });
    Autocomplete.hide('assignee', pendId);
    showToast('👤 담당자: ' + name);
  }
  window.selectAssigneeForPending = selectAssigneeForPending;

  function clearPendingStore(pendId) {
    const it = _linePending.find(x => x.id === pendId);
    if (!it) return;
    // 연결만 해제 — 원문 store 텍스트는 보존 (재검색 단서로 남김)
    const originalStore = it.store;
    it.storeId = '';
    _flushPending(pendId, { storeId:'' });
    const inp = document.getElementById('storeInput-' + pendId);
    if (inp) inp.value = '';
    _updateStoreStatusPanel(pendId);
  }
  window.clearPendingStore = clearPendingStore;

  // 인메모리 + 디바운스 서버 PUT
  let _pendingPutTimers = {};
  function updatePending(id, patch, debounce) {
    const it = _linePending.find(x => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    if (debounce) {
      clearTimeout(_pendingPutTimers[id]);
      _pendingPutTimers[id] = setTimeout(() => _flushPending(id, patch), 600);
    } else {
      _flushPending(id, patch);
    }
  }
  window.updatePending = updatePending;

  async function _flushPending(id, patch) {
    try {
      await fetch('/api/line-pending?id=' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch(e) { console.warn('[Line Pending] update 실패:', e); }
  }

  function cyclePendingStatus(id, status) {
    const it = _linePending.find(x => x.id === id);
    if (!it) return;
    const prev = it.status;
    it.status = status;
    it.manualStatus = true;   // 사용자가 직접 상태 선택 — 완료 시 자동 강등하지 않고 존중
    it.statusChangedBy = _currentUserName();
    it.statusChangedAt = new Date().toISOString();
    _flushPending(id, { status, manualStatus: true, statusChangedBy: it.statusChangedBy, statusChangedAt: it.statusChangedAt });
    renderLinePendingList();
    if (status === '완료' && prev !== '완료') {
      showToast(`✅ 처리 완료 — ${it.statusChangedBy} 기록`);
    }
  }
  window.cyclePendingStatus = cyclePendingStatus;

  async function deletePending(id) {
    if (!confirm('이 등록 대기 항목을 삭제하시겠습니까?')) return;
    try {
      await fetch('/api/line-pending?id=' + encodeURIComponent(id), { method: 'DELETE' });
      _linePending = _linePending.filter(x => x.id !== id);
      renderLinePendingList();
      refreshLinePendingBanner();
      showToast('삭제됨');
    } catch(e) { showToast('❌ 삭제 실패: ' + e.message); }
  }
  window.deletePending = deletePending;

  async function approvePending(id, btnEl) {
    // 🛡 중복 승인 방지 (더블클릭·재렌더 무관) + 버튼 처리중 표시 + try/finally 로 항상 복구
    window._lineApprovingSet = window._lineApprovingSet || new Set();
    if (window._lineApprovingSet.has(id)) {
      try { showToast('⏳ 이미 승인 중입니다…'); } catch(_){}
      return;
    }
    window._lineApprovingSet.add(id);
    const _origBtnHtml = btnEl ? btnEl.innerHTML : '';
    if (btnEl) { try { btnEl.disabled = true; btnEl.style.opacity = '0.6'; btnEl.innerHTML = '⏳ 등록 중…'; } catch(_){} }
    const _cleanup = () => {
      try { window._lineApprovingSet.delete(id); } catch(_){}
      if (btnEl && btnEl.isConnected) { try { btnEl.disabled = false; btnEl.style.opacity = ''; btnEl.innerHTML = _origBtnHtml; } catch(_){} }
    };
    try {
    const p = _linePending.find(x => x.id === id);
    if (!p) return;
    // 🛡 매장 미특정 차단 — storeId 없고 매장명도 없으면 빈 껍데기 작업 (LINE 인증번호·잡담 등)
    if (!p.storeId && !(p.store && String(p.store).trim())) {
      alert('⚠ 매장이 특정되지 않아 등록할 수 없습니다.\n\n매장을 연결하거나 매장명을 입력한 뒤 등록하세요.\n(LINE 인증번호 알림·일반 대화 등 매장 없는 메시지는 업무 등록 대상이 아닙니다 — 등록 대기에서 삭제하세요.)');
      return;
    }
    // 📥 요청 접수 내용 — 카드 입력(reqContent) 우선, 없으면 파서 결과 fallback (요청접수 ROOT 로 사용)
    const reqText = (p.reqContent != null && String(p.reqContent).trim())
      ? String(p.reqContent).trim()
      : (p.lineParsed || p.lineRequest || p.lineRaw || '');
    if (!reqText) {
      if (!confirm('요청 접수 내용이 비어있습니다. 그대로 등록할까요?')) return;
    }

    const jobs = getJobs();
    const meta = LINE_TYPE_META[p.lineCategory] || LINE_TYPE_META.open_store;
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const storeMatch = p.storeId ? stores.find(s => s.id === p.storeId) : null;

    // 등록 시점 = 라인 메시지 시각
    const lineTs = p.lineMsgAt ? new Date(p.lineMsgAt.replace(' ', 'T') + ':00+09:00').getTime() : Date.now();

    // 진행 상황 → job status 매핑
    const isAsCat = ['pos_as','van_as','device_mgmt','as_pos_van'].includes(p.lineCategory);
    const statusMap = {
      '접수':    isAsCat ? '접수' : '예정',
      '진행중':  '진행중',
      '추가처리': isAsCat ? '재방문필요' : '진행중',
      '완료':    isAsCat ? '처리완료' : '완료',
    };
    let jobStatus = statusMap[p.status] || '진행중';  // 🐛 const→let: 아래 강등 라인 재할당(예외로 등록 무반응이던 근본원인)

    // ── UPDATE 경로 ──────────────────────────────────────
    if (p.action === 'update' && p.targetJobId) {
      const job = jobs.find(j => j.id === p.targetJobId);
      if (job) {
        if (!Array.isArray(job.memos)) job.memos = [];
        const memoLines = [
          `[${meta.label}] ${p.status}`,
          reqText || '',
        ].filter(Boolean);
        // 담당(assignee=engineer)과 기록자(현재 사용자) 분리 기록
        const assignee = p.assignee || job.engineer || '';
        const recordedBy = _currentUserName();
        const header = (assignee && assignee !== recordedBy)
          ? `담당 : ${assignee} / 기록 : ${recordedBy}`
          : (recordedBy ? `기록 : ${recordedBy}` : '');
        job.memos.push({
          at:        (p.lineMsgAt||'').slice(2),
          author:    p.lineSender || 'Line',
          assignee:  assignee,
          recordedBy,
          text:      header ? `[${header}] ${memoLines.join(' / ')}` : memoLines.join(' / '),
          tag:       'line-update',
        });
        if (jobStatus === '처리완료' || jobStatus === '완료') {
          job.status = jobStatus;
          job.completedAt = new Date().toISOString();
          job.completedBy = recordedBy;   // 누가 완료 처리했는지 기록
        } else {
          job.status = jobStatus;
        }
        job.lastEditedBy = recordedBy;
        job.lastEditedAt = new Date().toISOString();
        if (p.assignee && !job.engineer) job.engineer = p.assignee;
        if (p.storeId && !job.storeId) { job.storeId = p.storeId; job.unregistered = false; }
        saveJobs(jobs);
      }
    } else {
      // ── NEW 경로 ────────────────────────────────────────
      const isAs = isAsCat;
      // 🆕 LINE→새 AS 는 자동 완료 금지 (2026-06-12 이지팜 '자료 복구 불가' 케이스):
      //   파서가 '복구 불가/못살림' 같은 미해결 보고를 status='완료'로 분류 → 새 AS 가 처리완료로 등록돼
      //   AS 진행중(기본=미처리)에서 안 보임. 새 AS 는 항상 활성(접수)로 등록 → 완료는 검토 후 thread 에서 명시적.
      //   (UPDATE 경로/비AS 카테고리는 영향 없음)
      // 파서가 자동으로 완료 분류한 경우만 접수로 강등(오분류 방지). 사용자가 직접 완료를 선택(manualStatus)했으면 존중.
      if (isAs && (jobStatus === '처리완료' || jobStatus === '완료') && !p.manualStatus) jobStatus = '접수';
      const recordedBy = _currentUserName();
      const assignee = p.assignee || '';
      const memoHeader = (assignee && assignee !== recordedBy)
        ? `담당 : ${assignee} / 기록 : ${recordedBy}`
        : (recordedBy ? `기록 : ${recordedBy}` : '');
      const job = {
        id: 'JOB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,5),
        type: isAs ? 'AS 처리' : meta.jobType,
        storeName: storeMatch?.name || p.store || '',
        store:     storeMatch?.name || p.store || '',
        storeId:   p.storeId || '',
        // 매장 부가정보
        address:   storeMatch?.addr || storeMatch?.address || '',
        storeTel:  storeMatch?.tel  || storeMatch?.phone   || '',
        storeCeo:  storeMatch?.ceo  || '',
        storeBizNo: storeMatch?.biz || storeMatch?.bizNo   || '',
        unregistered: !p.storeId,
        engineer: assignee,
        // 비고는 검토자 메모만 (LINE 원문은 별도 패널로 분리)
        notes: p.memo || '',
        status: jobStatus,
        createdAt: lineTs,                  // ← 라인 메시지 시각 기준
        createdBy: recordedBy,              // ← 누가 등록 처리했는지
        source: 'line',
        lineCategory: p.lineCategory,
        lineSender: p.lineSender || '',
        lineMsgAt: p.lineMsgAt || '',
        lineRoom:  p.lineRoom || '',
        lineRaw:   p.lineRaw || '',         // LINE 원문
        lineParsed: p.lineParsed || '',     // Claude 요약
        lineRequest: p.lineRequest || '',   // 요청·증상 핵심
        reviewMemo: p.memo || '',
        memos: p.memo ? [{
          at:        (p.lineMsgAt||'').slice(2),
          author:    p.lineSender || 'Line',
          assignee,
          recordedBy,
          text:      memoHeader ? `[${memoHeader}] 📝 검토메모: ${p.memo}` : `📝 검토메모: ${p.memo}`,
          tag:       'line-review',
        }] : [],
      };
      if (jobStatus === '처리완료' || jobStatus === '완료') {
        job.completedAt = new Date().toISOString();
        job.completedBy = recordedBy;
      }
      if (isAs) {
        job.asReceivedAt = (p.lineMsgAt || '').replace('T',' ').slice(0,16);
        job.asRequest = reqText;
        job.asTargets = p.lineCategory === 'device_mgmt' ? ['이동단말기']
          : (/키오스크|키오/.test(p.lineRaw||p.lineParsed||'') ? ['키오스크']
             : /VAN|단말|카드/i.test(p.lineRaw||p.lineParsed||'') ? ['VAN']
             : /POS|영수증|프린터/i.test(p.lineRaw||p.lineParsed||'') ? ['POS']
             : []);
        if (jobStatus === '처리완료') job.completedAt = new Date().toISOString();
      } else {
        job.date = (p.lineMsgAt || '').slice(0,10);
      }

      // 🔁 AS 통합 — saveNewJob 과 동일 정책: 같은 매장 진행 중 AS 가 있으면 별도 등록 X,
      //   기존 AS thread 에 새 ROOT 추가. (LINE import 가 이 경로 우회해서 중복 발생하던 버그 차단)
      //   샤르르 케이스 (2026-05-20 15:08 → 15:13 후속 메시지) 같은 경우 한 건으로 통합됨.
      let _mergedExistingAs = null;
      if (isAs && !job.unregistered) {
        const isDoneFn = (typeof window._isJobDone === 'function') ? window._isJobDone : () => false;
        const classifyFn = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : () => 'as';
        const normFn = (typeof _normStoreKey === 'function') ? _normStoreKey : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
        const target = normFn(job.storeName);
        const candIdxs = [];
        jobs.forEach((j, idx) => {
          if (j.id === job.id) return;
          if (classifyFn(j) !== 'as') return;
          const sn = (j.storeName || j.store || '').trim();
          if (!sn) return;
          if (normFn(sn) === target) candIdxs.push(idx);
        });
        // ⛔️ 완료된 AS 에는 절대 머지하지 않음 — 샤르르 reopen 루프 차단 (2026-05-22)
        //   기존 fallback 은 진행 중 후보 없을 때 가장 최근 완료건을 골라 thread 추가 + 상태 환원 →
        //   다른 기기에서 stale localStorage push 시 무한 reopen. 새 job 생성으로 강제.
        let existingIdx = candIdxs.find(i => !isDoneFn(jobs[i]));
        if (existingIdx === undefined) {
          existingIdx = -1;  // 완료건은 merge 대상 아님 → 새 AS 로 등록
        }
        if (existingIdx >= 0) {
          const existing = jobs[existingIdx];
          const ts = (p.lineMsgAt || '').replace('T',' ').slice(0,16)
                  || ((typeof _kstDateTimeStr === 'function') ? _kstDateTimeStr() : new Date().toISOString().slice(0,16).replace('T',' '));
          const author = p.lineSender || recordedBy || 'Line';
          const _newRootId = 'TR-line-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
          const newRoot = {
            ts, author, status: '요청접수',
            text: reqText || '(요청 내용 없음)',
            threadId: _newRootId,
            parentId: null,
            _lineSource: { msgAt: p.lineMsgAt || '', sender: p.lineSender || '', raw: p.lineRaw || '' },
          };
          const _mergeAdd = [newRoot];
          // 🐛 통합(merge) 경로도 완료 선택 반영 — 완료면 새 ROOT 에 완료 child 동반 (기존엔 요청접수만 추가돼 접수로 남던 문제)
          if (jobStatus === '처리완료' || jobStatus === '완료') {
            _mergeAdd.push({ ts, author, status: '완료', text: '(LINE 등록 시 완료 상태)',
              threadId: 'TR-line-done-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
              parentId: _newRootId });
          }
          const existingThread = Array.isArray(existing.thread) ? existing.thread.slice() : [];
          const mergedT = existingThread.concat(_mergeAdd);
          existing.thread = (typeof window._threadMigrate === 'function')
                          ? window._threadMigrate(mergedT) : mergedT;
          // AS 메타 갱신
          if (job.asReceivedAt) existing.asReceivedAt = job.asReceivedAt;
          if (Array.isArray(job.asTargets) && job.asTargets.length) {
            const cur = Array.isArray(existing.asTargets) ? existing.asTargets : [];
            existing.asTargets = Array.from(new Set(cur.concat(job.asTargets)));
          }
          if (!/AS|에이에스/i.test(existing.type || '')) {
            if (!existing._originalType) existing._originalType = existing.type || '';
            existing.type = 'AS 처리';
          }
          existing.lastEditedBy = recordedBy;
          existing.lastEditedAt = new Date().toISOString();
          // 🎯 새 ROOT 가 추가됐으니 status 재평가 — 보통 '접수'/'진행중' 으로 환원
          //   _recomputeJobStatus 가 모든 규칙 적용 (allRootsDone / AS '접수' / 신규 openDate 가드)
          if (typeof window._recomputeJobStatus === 'function') {
            window._recomputeJobStatus(existing);
          } else {
            // fallback — 단순 환원
            if (existing.status === '완료' || existing.status === '처리완료' || existing.completed) {
              existing.status = '접수';
              existing.completed = false;
              existing.completedAt = '';
            }
          }
          jobs[existingIdx] = existing;
          _mergedExistingAs = existing;
          if (typeof showToast === 'function') {
            showToast(`🔁 기존 AS 업무에 통합됨 (${existing.id})`);
          }
        }
      }
      if (!_mergedExistingAs) {
        // 🌱 요청접수 ROOT 시드 — thread 가 없으면 진행/완료 처리가 불가하던 문제(2026-06-12).
        //   LINE 등록대기→새 작업은 thread 가 비어 'display-only 시드'에만 의존 → 완료 시 고아 ROOT 사고.
        //   실제 ROOT 를 영속시켜 진행→완료 가능하게. (AS/신규만 — VAN 은 thread 미사용)
        if (!Array.isArray(job.thread) || job.thread.length === 0) {
          const _cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(job) : (isAs ? 'as' : '');
          // thread 를 쓰는 모든 카테고리에 요청접수 ROOT 시드 — VAN·소모품 누락 fix(2026-06-12 명동교자 VAN).
          if (['as','new','van','supplies','stocktake'].indexOf(_cat) >= 0 || !_cat) {
            const _rt = (p.lineMsgAt || '').replace('T',' ').slice(0,16)
                      || ((typeof _kstDateTimeStr === 'function') ? _kstDateTimeStr() : new Date().toISOString().slice(0,16).replace('T',' '));
            const _rid = 'TR-line-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
            job.thread = [{
              ts: _rt, author: p.lineSender || recordedBy || '담당자',
              status: '요청접수',
              text: reqText || '(요청 내용)',
              threadId: _rid, parentId: null,
              _lineSource: { msgAt: p.lineMsgAt || '', sender: p.lineSender || '', raw: p.lineRaw || '' },
            }];
            // LINE 으로 이미 완료 상태로 들어온 경우 — 완료 child 동반(상태 일관성 → 재계산 시 강등 방지)
            if (jobStatus === '처리완료' || jobStatus === '완료') {
              job.thread.push({ ts: _rt, author: p.lineSender || recordedBy || '담당자',
                status: '완료', text: '(LINE 등록 시 완료 상태)',
                threadId: 'TR-line-done-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
                parentId: _rid });
            }
          }
        }
        jobs.unshift(job);
      }
      saveJobs(jobs);
      // 🔄 hub 라이브 갱신 — 새로고침 없이 즉시 반영
      try { if (typeof window._refreshHubsForCategory === 'function') window._refreshHubsForCategory('as'); } catch(_){}
    }

    try { pushJobsToCloud({ toast:false }); } catch(e){}

    // 골드 셋 누적 — 검토·승인된 분류 결과를 학습 데이터로 저장 (Haiku 전환용)
    try {
      const auth = getAuthState();
      const goldPayload = {
        input: {
          text:   p.lineRaw || '',
          sender: p.lineSender || '',
          time:   (p.lineMsgAt || '').slice(11),  // HH:MM
          room:   p.lineRoom || '',
        },
        output: {
          type:         p.lineCategory,
          store:        storeMatch?.name || p.store || '',
          storeMatched: !!p.storeId,
          status:       p.status,
          assignee:     p.assignee || '',
          device:       p.lineDevice || '',
          request:      p.lineRequest || '',
          parsed:       p.lineParsed || '',
        },
        meta: {
          originalCategory:  p.lineCategory,   // 검토 중 변경 추적은 추후 구현
          categoryChanged:   false,
          reviewMemo:        p.memo || '',
          storeOriginal:     p.storeOriginal || '',
          action:            p.action || 'new',
        },
        approvedBy: auth?.email || auth?.name || 'unknown',
        approvedAt: new Date().toISOString(),
      };
      fetch('/api/line-gold', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(goldPayload),
      }).catch(e => console.warn('gold save failed:', e));
    } catch(e) { console.warn('gold collection skipped:', e); }

    // 큐에서 제거
    try {
      await fetch('/api/line-pending?id=' + encodeURIComponent(id), { method: 'DELETE' });
    } catch(e) { console.warn('queue delete 실패', e); }
    _linePending = _linePending.filter(x => x.id !== id);
    renderLinePendingList();
    refreshLinePendingBanner();

    // 관련 화면 갱신
    try { hydrateDashboardJobs(); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
    try { hydrateAsMgmt(); } catch(e){}
    try { rebuildJobsGrid(); } catch(e){}
    showToast('✅ 업무 등록 완료');
    } catch (e) {
      console.warn('[approvePending] 처리 실패:', e);
      try { showToast('❌ 등록 실패: ' + (e && e.message ? e.message : e)); } catch(_){}
    } finally {
      _cleanup();
    }
  }
  window.approvePending = approvePending;

  /* ════════════════════════════════════════
     (구) registerLineItems 의 잔여 호환 코드 — 제거됨, 위 신규 함수가 대체
  ════════════════════════════════════════ */
  function _legacyRegisterLineItems_REMOVED() {
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const jobs = getJobs();
    const cats = { pos_as:0, van_as:0, device_mgmt:0, open_store:0, van_doc:0, label:0, equip_out:0, delivery:0 };
    let newCount = 0, updCount = 0;

    const kstNow = (() => {
      const d = new Date();
      const p = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(d);
      return p.replace('T',' ').replace(',',' ');
    })();
    const todayDate = kstNow.slice(0,10);

    toRegister.forEach((item, idx) => {
      const meta = LINE_TYPE_META[item.type];
      if (!meta || !meta.jobType) return;
      cats[item.type] = (cats[item.type] || 0) + 1;

      // ──────────────────────────────────────────────
      // ACTION: update — 기존 작업에 상태/메모만 갱신
      // ──────────────────────────────────────────────
      if (item.action === 'update' && item.targetJobId) {
        const job = jobs.find(j => j.id === item.targetJobId);
        if (job) {
          // 누적 메모로 기록
          if (!Array.isArray(job.memos)) job.memos = [];
          job.memos.push({
            at: kstNow.replace(/^\d{2}/, m => m).slice(2),   // YY.MM.DD HH:mm 형태
            author: item.sender || 'Line 임포트',
            text: [
              `[${meta.label}]`,
              item.status ? `상태: ${item.status}` : '',
              item.parsed || item.request || item.original || ''
            ].filter(Boolean).join(' '),
          });
          // 상태 전환 — 단말기 A/S 수리완료 등 '완료' 표시
          if (item.status === '완료') {
            if (/AS/i.test(job.type||'')) {
              job.status = '처리완료';
              job.completedAt = new Date().toISOString();
            } else {
              job.status = '완료';
              job.completedAt = new Date().toISOString();
            }
          } else if (item.status === '진행중') {
            job.status = '진행중';
          } else if (item.status === '재방문필요') {
            job.status = '재방문필요';
          } else if (item.status === '심사중') {
            // 밴서류 진행상태
            job.status = '심사중';
          }
          // 담당자가 비어있으면 보강
          if (!job.engineer && item.assignee) job.engineer = item.assignee;
          updCount++;
          return; // 다음 항목으로
        }
      }

      // 이하 신규 등록 흐름 (action === 'new')
      newCount++;

      // 매장 매칭 (이름/별칭 기반)
      const wantName = (item.store || '').trim();
      const norm = (s) => String(s||'').toLowerCase().replace(/\s+/g,'');
      const wantNorm = norm(wantName);
      const storeMatch = wantNorm ? stores.find(s => {
        if (norm(s.name) === wantNorm || norm(s.name).includes(wantNorm) || wantNorm.includes(norm(s.name))) return true;
        const aliases = Array.isArray(s.aliases) ? s.aliases : [];
        return aliases.some(a => norm(a) === wantNorm);
      }) : null;

      const isAs = (item.type === 'pos_as' || item.type === 'van_as' || item.type === 'as_pos_van');
      const isDeviceAs = (item.type === 'device_mgmt' && /AS|수리|고장/i.test(item.request || item.parsed || ''));
      const isDeviceDone = (item.type === 'device_mgmt' && item.status === '완료');

      // 상태 매핑
      let status = '진행중';
      if (isAs || isDeviceAs) status = (item.status === '완료') ? '처리완료' : '접수';
      else if (item.status === '완료') status = '완료';
      else if (item.status === '심사중') status = '심사중';
      else if (item.status === '재방문필요') status = '재방문필요';

      const job = {
        id: 'JOB-' + Date.now().toString(36).toUpperCase() + '-' + idx,
        type: (isAs || isDeviceAs) ? 'AS 처리' : meta.jobType,
        storeName: wantName || '',
        store: wantName || '',
        storeId: storeMatch ? storeMatch.id : '',
        unregistered: !storeMatch,
        engineer: item.assignee || '',
        notes: [item.parsed, item.original].filter(Boolean).join(' / '),
        status,
        createdAt: Date.now(),
        // Line 출처 메타
        source: 'line',
        lineCategory: item.type,
        lineSender: item.sender || '',
        lineTime: item.time || '',
        lineImportedAt: kstNow,
      };

      // AS 일 때 AS 전용 필드 채우기
      if (isAs || isDeviceAs) {
        job.asReceivedAt = kstNow;
        job.asRequest = item.request || item.parsed || '';
        job.asTargets = isAs
          ? (/키오스크|키오/.test(item.request||item.parsed||'') ? ['키오스크']
             : /VAN|단말|카드/i.test(item.request||item.parsed||'') ? ['VAN']
             : /POS|영수증|프린터/i.test(item.request||item.parsed||'') ? ['POS']
             : [])
          : (item.type === 'device_mgmt' ? ['이동단말기'] : []);
        if (isDeviceDone) {
          job.status = '처리완료';
          job.completedAt = new Date().toISOString();
        }
        // 장비 정보 추출
        if (item.device) {
          const m = String(item.device).match(/([A-Za-z0-9\-+]+)[ /·]+([A-Za-z0-9\-]+)/);
          if (m) job.deviceInfo = { model: m[1], sn: m[2] };
          else job.deviceInfo = { model: item.device };
        }
      } else {
        // 오픈 작업 / 밴서류 → 날짜 기본 오늘
        job.date = todayDate;
      }

      jobs.unshift(job);
    });

    saveJobs(jobs);
    try { pushJobsToCloud({ toast: false }); } catch(e){}

    const summary = Object.entries(cats).filter(([,n]) => n>0)
      .map(([k,n]) => `${LINE_TYPE_META[k].label} ${n}건`).join(' · ');
    showToast(`✅ ${toRegister.length}건 등록 완료 — ${summary}`);
    closeModal('lineImportModal');

    // 모든 관련 화면 갱신
    try { hydrateDashboardJobs(); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
    try { hydrateConsult('active'); } catch(e){}
    try { hydrateAsMgmt(); } catch(e){}
    try { rebuildJobsGrid(); } catch(e){}

    // 가장 많이 등록된 카테고리로 이동
    const top = Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
    setTimeout(() => {
      if (top && (top[0] === 'pos_as' || top[0] === 'van_as' || top[0] === 'as_pos_van' || top[0] === 'device_mgmt')) showScreen('asmgmt');
      else showScreen('jobs');
    }, 300);
  }

  /* ── 설정 모달 초기화 ── */
  /* ════════════════════════════════════════
     AUTH SYSTEM — 로그인 / 회원가입 / 로그아웃
  ════════════════════════════════════════ */
  const ADMIN_CODE = 'NEO2026';  // 관리자 승인 코드

  function getAuthState() {
    try { return JSON.parse(localStorage.getItem('ns_auth') || 'null'); } catch { return null; }
  }
  function setAuthState(state) {
    if (state) localStorage.setItem('ns_auth', JSON.stringify(state));
    else localStorage.removeItem('ns_auth');
  }
  function getUsers() {
    try { return JSON.parse(localStorage.getItem('ns_users') || '[]'); } catch { return []; }
  }
  function saveUsers(users) {
    localStorage.setItem('ns_users', JSON.stringify(users));
  }

  function updateNavAuth() {
    const state = getAuthState();
    const loginBtn = document.getElementById('navLoginBtn');
    const userBlock = document.getElementById('navUserBlock');
    const settingsBtn = document.getElementById('navSettingsBtn');
    const navAvatar = document.getElementById('navAvatar');
    const navUserName = document.getElementById('navUserName');
    const navUserRole = document.getElementById('navUserRole');

    if (state && state.loggedIn) {
      loginBtn.style.display = 'none';
      userBlock.style.display = 'flex';
      navAvatar.textContent = state.name.charAt(0);
      navUserName.textContent = state.name;
      navUserRole.textContent = state.role === 'admin' ? '관리자' : '직원';
      settingsBtn.style.display = state.role === 'admin' ? '' : 'none';
    } else {
      loginBtn.style.display = '';
      userBlock.style.display = 'none';
      settingsBtn.style.display = 'none';
    }
  }

  /* ══════════════════════════════════════════════
     GOOGLE AUTH — Sign in with Google (GIS)
  ══════════════════════════════════════════════ */

  // 관리자 이메일 화이트리스트 (이 목록에 있는 구글 계정은 자동 관리자 승격)
  const ADMIN_EMAILS = ['zoolex@gmail.com'];

  // Google OAuth Client ID — 관리자 페이지에서 설정/변경 가능
  // 기본값: 미설정 (빈 문자열). 설정 시 localStorage에 저장됨.
  function getGoogleClientId() {
    return localStorage.getItem('google_client_id') || '';
  }
  function setGoogleClientId(id) {
    if (id) localStorage.setItem('google_client_id', id.trim());
    else localStorage.removeItem('google_client_id');
  }

  // JWT 페이로드 디코딩 (base64url)
  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      const json = atob(payload.replace(/-/g,'+').replace(/_/g,'/'));
      // UTF-8 복원
      const decoded = decodeURIComponent(json.split('').map(c => '%' + ('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(decoded);
    } catch(e) { return null; }
  }

  // GIS 초기화 + 버튼 렌더
  // 플레이스홀더 Google 버튼 클릭 핸들러:
  // - Client ID 설정됨 → 실제 GIS 초기화 시도
  // - 미설정 → 바로 개발자 모드 로그인 프롬프트 (관리자가 초기 설정 가능)
  function handleGsiPlaceholderClick() {
    const clientId = getGoogleClientId();
    if (clientId && window.google && google.accounts && google.accounts.id) {
      initGoogleSignIn();
      return;
    }
    if (!clientId) {
      const ok = confirm('Google OAuth Client ID가 아직 설정되지 않았습니다.\n\n관리자 초기 설정을 위해 "개발자 모드 로그인"으로 먼저 들어가시겠습니까?\n(관리자 페이지에서 Client ID를 등록한 뒤 정식 Google 로그인을 사용할 수 있습니다.)');
      if (ok) devQuickLogin();
      return;
    }
    // Client ID는 있는데 라이브러리가 아직 로드 안됨
    alert('Google 라이브러리 로딩 중입니다. 잠시 후 다시 시도하세요.');
    setTimeout(initGoogleSignIn, 500);
  }

  function initGoogleSignIn() {
    const clientId = getGoogleClientId();
    const container = document.getElementById('gsiButtonContainer');
    const fallback = document.getElementById('gsiFallback');
    const placeholder = document.getElementById('gsiPlaceholderBtn');
    if (!container) return;

    if (!clientId || !window.google || !google.accounts || !google.accounts.id) {
      // Client ID 미설정: 플레이스홀더 버튼 유지 + 안내 박스 표시
      if (placeholder) placeholder.style.display = '';
      container.style.display = '';
      if (fallback) fallback.style.display = '';
      return;
    }
    // Client ID 설정됨: 플레이스홀더 제거 후 실제 Google 버튼 렌더
    if (placeholder) placeholder.style.display = 'none';
    container.style.display = '';
    // 🔎 프리뷰 도메인(*.pages.dev)은 Google OAuth 승인 원본이 아니라 로그인 불가 →
    //    개발자(이메일) 로그인 fallback 을 노출해 프리뷰 확인 가능하게 (프로덕션엔 영향 없음)
    const _isPreviewHost = (location.hostname || '').endsWith('.pages.dev');
    if (fallback) fallback.style.display = _isPreviewHost ? '' : 'none';

    try {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
        auto_select: false,
        ux_mode: 'popup'
      });
      container.innerHTML = '';
      google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        locale: 'ko_KR',
        width: 320
      });
    } catch(e) {
      console.error('GIS init failed', e);
      container.style.display = 'none';
      if (fallback) fallback.style.display = '';
    }
  }

  // Google credential (JWT) 처리
  function handleGoogleCredential(resp) {
    const errEl = document.getElementById('loginError');
    if (errEl) errEl.style.display = 'none';
    if (!resp || !resp.credential) {
      if (errEl) { errEl.textContent = '구글 로그인 응답이 비어 있습니다.'; errEl.style.display = ''; }
      return;
    }
    const info = decodeJwt(resp.credential);
    if (!info || !info.email) {
      if (errEl) { errEl.textContent = '구글 토큰 해석 실패'; errEl.style.display = ''; }
      return;
    }
    loginWithGoogleProfile({
      email: info.email,
      name: info.name || info.given_name || info.email.split('@')[0],
      picture: info.picture || ''
    });
  }

  // 허용된 이메일 화이트리스트 (관리자 + 직원)
  function getAllowedEmails() {
    try { return JSON.parse(localStorage.getItem('ns_allowed_emails') || '[]'); } catch { return []; }
  }
  function saveAllowedEmails(list) {
    localStorage.setItem('ns_allowed_emails', JSON.stringify(list));
  }
  function isEmailAllowed(email) {
    const e = (email || '').toLowerCase();
    if (ADMIN_EMAILS.includes(e)) return true;  // 관리자는 항상 허용
    return getAllowedEmails().map(x => x.toLowerCase()).includes(e);
  }

  /* ══════════════════════════════════════════════
     클라우드 화이트리스트 (Cloudflare KV)
       - 페이지 로드 시 /api/whitelist GET → 로컬에 머지 (모든 PC/모바일 자동 동기화)
       - 관리자가 직원 추가/삭제 시 /api/whitelist POST 로 클라우드에 푸시
       - 동기화 토큰: 관리자가 한 번만 입력 (cloud_sync_token, localStorage)
  ══════════════════════════════════════════════ */
  function getCloudSyncToken() {
    return localStorage.getItem('cloud_sync_token') || '';
  }
  function saveCloudSyncToken(token) {
    if (token) localStorage.setItem('cloud_sync_token', token.trim());
    else localStorage.removeItem('cloud_sync_token');
  }

  async function pullCloudWhitelist() {
    try {
      const res = await fetch('/api/whitelist', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      const remoteEmails = Array.isArray(data.emails) ? data.emails : [];
      const remoteUsers = Array.isArray(data.users) ? data.users : [];

      // Google Client ID 동기화 — 로컬에 없으면 클라우드 값으로 채움
      if (data.googleClientId && !getGoogleClientId()) {
        setGoogleClientId(data.googleClientId);
        // GIS 라이브러리 이미 로드됐으면 즉시 버튼 갱신
        try { if (typeof initGoogleSignIn === 'function') initGoogleSignIn(); } catch(e) {}
      }

      // 로컬 화이트리스트와 머지 (클라우드 우선)
      const local = getAllowedEmails().map(x => x.toLowerCase());
      const all = Array.from(new Set([...local, ...remoteEmails.map(x => x.toLowerCase())]));
      saveAllowedEmails(all);

      // 사용자 정보(이름/직책/전화)도 머지
      if (remoteUsers.length > 0) {
        const users = getUsers();
        const byEmail = new Map(users.map(u => [(u.email || u.id || '').toLowerCase(), u]));
        remoteUsers.forEach(ru => {
          const key = (ru.email || '').toLowerCase();
          if (!key) return;
          const existing = byEmail.get(key);
          if (existing) {
            // 비어있는 필드만 보강 (로컬 변경사항 우선)
            if (!existing.name)  existing.name  = ru.name;
            if (!existing.title) existing.title = ru.title;
            if (!existing.phone) existing.phone = ru.phone;
            existing.email = key;
            byEmail.set(key, existing);
          } else {
            byEmail.set(key, {
              id: key, email: key,
              name: ru.name || key.split('@')[0],
              title: ru.title || '',
              phone: ru.phone || '',
              role: ru.role || 'staff',
              provider: 'cloud',
              createdAt: Date.now(),
            });
          }
        });
        saveUsers(Array.from(byEmail.values()));
      }
      return data;
    } catch (e) {
      console.warn('[pullCloudWhitelist] failed', e);
      return null;
    }
  }
  window.pullCloudWhitelist = pullCloudWhitelist;

  async function pushCloudWhitelist(opts) {
    const token = getCloudSyncToken();
    if (!token) {
      if (opts && opts.toast && typeof showToast === 'function') {
        showToast('⚠ 클라우드 동기화 토큰 미설정 — 로컬에만 저장됨');
      }
      return { ok: false, reason: 'no token' };
    }
    const emails = getAllowedEmails().map(x => x.toLowerCase());
    const users = getUsers().map(u => ({
      email: (u.email || u.id || '').toLowerCase(),
      name: u.name || '',
      title: u.title || '',
      phone: u.phone || '',
      role: u.role || 'staff',
    })).filter(u => u.email);
    const googleClientId = getGoogleClientId();
    try {
      const res = await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ emails, users, googleClientId }),
      });
      if (!res.ok) {
        const txt = await res.text();
        if (opts && opts.toast && typeof showToast === 'function') {
          showToast(`⚠ 클라우드 푸시 실패 (${res.status}): ${txt.slice(0,80)}`);
        }
        return { ok: false, status: res.status, error: txt };
      }
      const data = await res.json();
      if (opts && opts.toast && typeof showToast === 'function') {
        showToast(`☁ 클라우드 동기화 완료 (직원 ${data.users}명, 이메일 ${data.count}개)`);
      }
      return { ok: true, ...data };
    } catch (e) {
      console.warn('[pushCloudWhitelist] failed', e);
      if (opts && opts.toast && typeof showToast === 'function') {
        showToast('⚠ 클라우드 푸시 실패 (네트워크)');
      }
      return { ok: false, reason: 'network' };
    }
  }
  window.pushCloudWhitelist = pushCloudWhitelist;

  // 페이지 로드 직후 1회 — 화이트리스트 클라우드에서 받기
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { try { pullCloudWhitelist(); } catch(e){} }, 800);
  });

  // 이메일/이름으로 로그인 처리 (Google credential 성공 후 또는 dev quick login)
  function loginWithGoogleProfile({ email, name, picture }) {
    const emailLc = (email || '').toLowerCase();

    // 화이트리스트 체크 — 미등록 시 차단
    if (!isEmailAllowed(emailLc)) {
      const errEl = document.getElementById('loginError');
      if (errEl) {
        errEl.innerHTML = `❌ <b>${email}</b> 계정은 등록되지 않았습니다.<br>관리자에게 접근 권한을 요청하세요.`;
        errEl.style.display = '';
      }
      try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch {}
      return;
    }

    const role = ADMIN_EMAILS.includes(emailLc) ? 'admin' : 'staff';

    // ns_users 에 등록/갱신
    const users = getUsers();
    let u = users.find(x => x.id === email);
    if (!u) {
      u = { id: email, name, role, picture, provider: 'google', createdAt: Date.now() };
      users.push(u);
    } else {
      // 이름은 처음 등록시에만 Google 값 사용 — 관리자가 수정한 이름을 보존
      u.name = u.name || name;
      u.role = role;         // 화이트리스트 기준으로 매번 갱신
      u.picture = picture || u.picture || '';
      u.provider = 'google';
    }
    saveUsers(users);

    setAuthState({ loggedIn: true, id: email, name: u.name, role, picture: u.picture || '' });
    document.body.classList.remove('auth-required');
    closeModal('loginModal');
    updateNavAuth();
    showToast && showToast(`✅ ${u.name} (${role === 'admin' ? '관리자' : '직원'}) 로그인`);
  }

  // 개발자 모드: Client ID 미설정 시 이메일 수동 입력으로 로그인
  function devQuickLogin() {
    const email = prompt('구글 계정 이메일을 입력하세요 (개발자 모드):', 'zoolex@gmail.com');
    if (!email || !email.includes('@')) return;
    const name = prompt('표시 이름:', email.split('@')[0]) || email.split('@')[0];
    loginWithGoogleProfile({ email: email.trim().toLowerCase(), name: name.trim(), picture: '' });
  }

  function openLoginModal() {
    const errEl = document.getElementById('loginError');
    if (errEl) errEl.style.display = 'none';
    showModal('loginModal');
    // GIS 스크립트 로드를 잠깐 기다렸다가 렌더
    setTimeout(initGoogleSignIn, 120);
  }

  function doLogout() {
    setAuthState(null);
    closeModal('adminModal');
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch {}
    updateNavAuth();
    enforceAuthGate();
    showToast && showToast('로그아웃되었습니다');
  }

  /* ── 사이트 전체 로그인 게이트 (회사 내부용) ── */
  function enforceAuthGate() {
    const state = getAuthState();
    if (state && state.loggedIn) {
      document.body.classList.remove('auth-required');
      // 로그인 모달이 열려있다면 닫기
      const m = document.getElementById('loginModal');
      if (m && m.classList.contains('show')) closeModal('loginModal');
    } else {
      document.body.classList.add('auth-required');
      showModal('loginModal');
      setTimeout(initGoogleSignIn, 150);
    }
  }

  // 레거시 함수 스텁 (삭제된 구 인터페이스 호출 방지)
  function switchAuthTab() {}
  function doLogin() { initGoogleSignIn(); }
  function doSignup() { showToast && showToast('구글 로그인을 이용하세요'); }
  function submitForcePasswordChange() {}
  function cancelForcePasswordChange() {}

  function openProfileMenu() {
    const state = getAuthState();
    if (!state) return;
    let menu = document.getElementById('profileDropdown');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'profileDropdown';
      menu.style.cssText = 'position:fixed;top:60px;right:16px;z-index:1000;background:#fff;border:1px solid var(--gray-200);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.15);min-width:240px;overflow:hidden';
      document.body.appendChild(menu);
      // 외부 클릭 시 닫기
      setTimeout(() => {
        document.addEventListener('click', _profileMenuOutside, { once: false });
      }, 0);
    }
    const initial = (state.name || state.email || '?').charAt(0).toUpperCase();
    const isAdmin = state.role === 'admin';
    menu.innerHTML = `
      <div style="padding:14px 16px;background:linear-gradient(135deg,#1A1614,#3F3936);color:#FFF8E7">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:50%;background:${isAdmin?'#EF4444':'#2563EB'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px">${initial}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(state.name||'-')}</div>
            <div style="font-size:11px;opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(state.email||state.id||'')}</div>
            <div style="font-size:10px;margin-top:3px"><span style="background:${isAdmin?'#EF4444':'#2563EB'};color:#fff;padding:1px 8px;border-radius:8px;font-weight:700">${isAdmin?'관리자':'직원'}</span></div>
          </div>
        </div>
      </div>
      <div style="padding:6px">
        <button onclick="closeProfileMenu();openMyPage()" style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;border-radius:6px;cursor:pointer;font-size:13px;color:var(--gray-700);display:flex;align-items:center;gap:8px" onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background=''">📦 장비 품목 관리</button>
        <button onclick="closeProfileMenu();window.open('/manual.html','_blank','noopener')" style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;border-radius:6px;cursor:pointer;font-size:13px;color:var(--gray-700);display:flex;align-items:center;gap:8px" onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background=''">📖 이용 매뉴얼</button>
        <button onclick="closeProfileMenu();if(window.forceCloudRepull)window.forceCloudRepull()" style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;border-radius:6px;cursor:pointer;font-size:13px;color:var(--gray-700);display:flex;align-items:center;gap:8px" onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background=''" title="기기마다 건수가 다를 때 — 이 기기를 클라우드 기준으로 맞춥니다 (안전·유실 없음)">🔄 클라우드 기준 강제 동기화</button>
        ${isAdmin ? `<button onclick="closeProfileMenu();openAdminPage()" style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;border-radius:6px;cursor:pointer;font-size:13px;color:var(--gray-700);display:flex;align-items:center;gap:8px" onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background=''">⚙️ 관리자 페이지</button>` : ''}
        <button onclick="closeProfileMenu();doLogout()" style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;border-radius:6px;cursor:pointer;font-size:13px;color:var(--danger);display:flex;align-items:center;gap:8px;font-weight:600" onmouseover="this.style.background='#FEF2F2'" onmouseout="this.style.background=''">🚪 로그아웃</button>
      </div>
    `;
    menu.style.display = '';
  }
  function closeProfileMenu() {
    const m = document.getElementById('profileDropdown');
    if (m) m.style.display = 'none';
  }
  function _profileMenuOutside(e) {
    const m = document.getElementById('profileDropdown');
    if (!m || m.style.display === 'none') return;
    const userBlock = document.getElementById('navUserBlock');
    if (m.contains(e.target) || (userBlock && userBlock.contains(e.target))) return;
    closeProfileMenu();
  }
  window.openProfileMenu = openProfileMenu;
  window.closeProfileMenu = closeProfileMenu;

  /* ── 관리자 페이지 열기 ── */
  function openAdminPage() {
    // API 키 로드
    document.getElementById('adminApiKey').value = getApiKey();
    document.getElementById('adminApiKeyStatus').style.display = 'none';
    // Google Client ID 로드
    const gcidEl = document.getElementById('adminGoogleClientId');
    if (gcidEl) gcidEl.value = getGoogleClientId();
    // 클라우드 동기화 토큰 로드
    const tokEl = document.getElementById('adminCloudSyncToken');
    if (tokEl) tokEl.value = getCloudSyncToken();
    // 허용 이메일 목록 렌더
    renderAllowedEmailList();

    // 직원 목록 렌더 (이름/직책/전화/이메일 통합)
    try { renderEmployeeList(); } catch(e) {}

    // LINE 봇 설정 로드
    try { loadLineConfig(); } catch(e){}
    try { loadLineRooms(); } catch(e){}
    try { loadParseLog(); } catch(e){}
    try { loadGoldStats(); } catch(e){}

    showModal('adminModal');
  }

  /* ════════════════════════════════════════
     LINE 봇 연동 (Phase 2) — 관리자 페이지
  ════════════════════════════════════════ */
  function _lineAdminPin() {
    return (document.getElementById('lineAdminPin')||{}).value || localStorage.getItem('line_admin_pin') || '';
  }

  async function loadLineConfig() {
    const pin = _lineAdminPin();
    const statusEl = document.getElementById('lineCfgStatus');
    try {
      const r = await fetch('/api/line-config?admin=' + encodeURIComponent(pin));
      if (!r.ok) {
        const t = await r.text().catch(()=>'');
        statusEl.innerHTML = `<span style="color:var(--danger)">❌ ${r.status} ${esc(t)}</span> — PIN 확인 필요`;
        return;
      }
      const d = await r.json();
      // 마스킹된 값 표시용
      const showMask = (id, v, ok) => {
        const el = document.getElementById(id);
        if (el) el.placeholder = ok ? `✓ 저장됨 (${v||'***'})` : el.placeholder;
      };
      showMask('lineCfgToken',       d.channelAccessToken, d.hasToken);
      showMask('lineCfgSecret',      d.channelSecret,      d.hasSecret);
      showMask('lineCfgParseSecret', d.parseSecret,        d.hasParseSecret);
      showMask('lineCfgClaudeKey',   d.claudeApiKey,       d.hasClaudeKey);

      // 알림 수신자 셀렉트 채우기 — _lineRooms 가 로드되어 있어야 옵션이 보임
      _populateAlertRecipientSelect(d.alertRecipientId || '', d.alertRecipientName || '');
      // 카테고리별 발송 채팅방 셀렉트 채우기
      try { _populateCategoryRoomSelects(d.categoryRooms || {}); } catch(_){}

      const parts = [];
      parts.push(d.hasToken  ? '✅ Channel Token'    : '❌ Channel Token');
      parts.push(d.hasSecret ? '✅ Channel Secret'   : '❌ Channel Secret');
      parts.push(d.hasParseSecret ? '✅ 파싱 토큰'    : '❌ 파싱 토큰');
      parts.push(d.hasClaudeKey ? '✅ Claude Key'    : '❌ Claude Key');
      parts.push(d.hasAlertRecipient ? `✅ 알림 수신자(${esc(d.alertRecipientName||'')})` : '⚠️ 알림 수신자 미설정');
      statusEl.innerHTML = parts.join('  ·  ');
    } catch(e) {
      statusEl.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`;
    }
  }
  window.loadLineConfig = loadLineConfig;

  async function saveLineConfig() {
    const pin = _lineAdminPin();
    if (pin) localStorage.setItem('line_admin_pin', pin);
    const payload = {};
    const t = document.getElementById('lineCfgToken').value.trim();         if (t) payload.channelAccessToken = t;
    const s = document.getElementById('lineCfgSecret').value.trim();        if (s) payload.channelSecret = s;
    const p = document.getElementById('lineCfgParseSecret').value.trim();   if (p) payload.parseSecret = p;
    const c = document.getElementById('lineCfgClaudeKey').value.trim();     if (c) payload.claudeApiKey = c;
    // 알림 수신자 — 셀렉트 값 + 표시명
    const alertSel = document.getElementById('lineCfgAlertRecipient');
    if (alertSel && alertSel.value) {
      payload.alertRecipientId   = alertSel.value;
      payload.alertRecipientName = alertSel.options[alertSel.selectedIndex]?.text?.replace(/\s*\(.*?\)\s*$/,'').trim() || '';
    }
    // 카테고리별 발송 채팅방 — 빈 값은 매핑 제거 의미 (서버는 빈문자 무시하므로 그대로 dict 보내)
    const catRooms = {};
    ['stocktake','as','newjob','van','supply','memo'].forEach(cat => {
      const el = document.getElementById('lineCfgCatRoom_' + cat);
      if (el && el.value) catRooms[cat] = el.value;
    });
    payload.categoryRooms = catRooms;
    if (Object.keys(payload).length === 0) { showToast('변경할 값 없음 (마스킹된 값은 빈칸으로 두기)'); return; }
    try {
      const r = await fetch('/api/line-config?admin=' + encodeURIComponent(pin), {
        method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload)
      });
      if (!r.ok) { const t = await r.text(); showToast('❌ ' + t); return; }
      showToast('✅ 저장됨');
      // 입력값 클리어 (보안)
      ['lineCfgToken','lineCfgSecret','lineCfgParseSecret','lineCfgClaudeKey'].forEach(id => document.getElementById(id).value = '');
      await loadLineConfig();
    } catch(e) { showToast('❌ ' + e.message); }
  }
  window.saveLineConfig = saveLineConfig;

  function generateParseSecret() {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    const hex = Array.from(a).map(b => b.toString(16).padStart(2,'0')).join('');
    document.getElementById('lineCfgParseSecret').value = hex;
    showToast('🔑 토큰 생성됨 — [저장] 클릭 후 GitHub Secret 에도 등록');
  }
  window.generateParseSecret = generateParseSecret;

  /* 알림 수신자 셀렉트 — _lineRooms 에서 선택 가능 옵션 채움
     1:1 채팅(roomType='user') 을 우선, 그 다음 그룹 채팅 */
  function _populateAlertRecipientSelect(currentId, currentName){
    const sel = document.getElementById('lineCfgAlertRecipient');
    if (!sel) return;
    const rooms = Array.isArray(_lineRooms) ? _lineRooms : [];
    // 정렬: user → group/room, 그 안에서 lastSender 가 있는 것 우선
    const sorted = [...rooms].sort((a,b)=>{
      const ua = a.roomType==='user'?0:1;
      const ub = b.roomType==='user'?0:1;
      return ua - ub;
    });
    const opts = ['<option value="">— 선택 (수신 채팅방에서) —</option>'];
    let foundCurrent = false;
    for (const r of sorted) {
      const icon = r.roomType==='user'?'👤':r.roomType==='group'?'👥':'💬';
      const label = r.name || r.lastSender || r.id.slice(0,16)+'…';
      const detail = r.roomType==='user' && r.lastSender && r.lastSender !== r.name ? ` (${r.lastSender})` : '';
      const isSel = r.id === currentId;
      if (isSel) foundCurrent = true;
      opts.push(`<option value="${esc(r.id)}" ${isSel?'selected':''}>${icon} ${esc(label)}${esc(detail)}</option>`);
    }
    // 현재 선택값이 _lineRooms 에 없으면 별도 옵션으로 보존
    if (currentId && !foundCurrent) {
      opts.splice(1, 0, `<option value="${esc(currentId)}" selected>🔒 ${esc(currentName||currentId.slice(0,16)+'…')} (저장된 값)</option>`);
    }
    sel.innerHTML = opts.join('');
  }

  /* 카테고리별 발송 채팅방 셀렉트 채우기 — _lineRooms 기준 */
  function _populateCategoryRoomSelects(currentMap) {
    const rooms = Array.isArray(_lineRooms) ? _lineRooms : [];
    const sorted = [...rooms].sort((a,b)=>{
      const oa = a.roomType==='group'?0 : a.roomType==='room'?1 : 2;
      const ob = b.roomType==='group'?0 : b.roomType==='room'?1 : 2;
      return oa - ob;
    });
    ['stocktake','as','newjob','van','supply','memo'].forEach(cat => {
      const sel = document.getElementById('lineCfgCatRoom_' + cat);
      if (!sel) return;
      const cur = currentMap[cat] || '';
      const opts = ['<option value="">— (기본 알림 수신자 사용) —</option>'];
      let found = false;
      for (const r of sorted) {
        const icon = r.roomType==='user'?'👤':r.roomType==='group'?'👥':'💬';
        const label = r.name || r.lastSender || (r.id||'').slice(0,16)+'…';
        const isSel = r.id === cur;
        if (isSel) found = true;
        opts.push(`<option value="${esc(r.id)}" ${isSel?'selected':''}>${icon} ${esc(label)}</option>`);
      }
      if (cur && !found) opts.splice(1, 0, `<option value="${esc(cur)}" selected>🔒 ${esc(cur.slice(0,16))}… (저장된 값)</option>`);
      sel.innerHTML = opts.join('');
    });
  }

  /* 테스트 알림 발송 — 현재 선택된 수신자에게 테스트 메시지 보냄 */
  async function testAlertSend(){
    const sel = document.getElementById('lineCfgAlertRecipient');
    const id = sel?.value;
    if (!id) { showToast('⚠️ 수신자를 먼저 선택하세요'); return; }
    const pin = _lineAdminPin();
    if (!pin) { showToast('⚠️ 관리자 PIN 을 입력하세요'); return; }
    // 저장 안 된 변경 사항이 있을 수 있으니 먼저 저장
    const name = sel.options[sel.selectedIndex]?.text?.replace(/\s*\(.*?\)\s*$/,'').trim() || '';
    try {
      await fetch('/api/line-config?admin=' + encodeURIComponent(pin), {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ alertRecipientId:id, alertRecipientName:name }),
      });
      // 테스트 발송 — line-parse-cron 의 force 모드 없이는 직접 안 됨.
      // 임시 방법: 서버에 테스트용 엔드포인트 호출 (없으면 사용자에게 안내)
      const r = await fetch('/api/line-alert-test?admin=' + encodeURIComponent(pin), { method:'POST' });
      if (r.ok) {
        const d = await r.json();
        showToast(d.ok ? '📤 테스트 메시지 발송됨 — LINE 확인하세요' : '❌ ' + (d.error || '발송 실패'));
      } else {
        showToast('💾 수신자 저장됨 — 다음 파싱 실패 시 자동 발송됩니다');
      }
    } catch(e) { showToast('❌ ' + e.message); }
  }
  window.testAlertSend = testAlertSend;

  async function runParseNow(force) {
    // 파싱 토큰을 별도로 요구 — KV 의 값을 모르므로 입력란에 값이 있으면 그걸 사용
    const ps = document.getElementById('lineCfgParseSecret').value.trim();
    if (!ps) {
      const ok = confirm('파싱 토큰을 입력란에 채워주세요. (서버에 저장된 토큰을 알지 못해서 그 값을 그대로 입력해야 합니다)\n\n계속하려면 OK');
      if (!ok) return;
      return;
    }
    const info = document.getElementById('lineCfgQueueInfo');
    info.innerHTML = '⏳ 실행 중…';
    try {
      const r = await fetch('/api/line-parse-cron', {
        method:'POST',
        headers: { 'authorization': 'Bearer ' + ps, 'content-type':'application/json' },
        body: JSON.stringify({ force: !!force }),
      });
      const d = await r.json();
      if (!r.ok) { info.innerHTML = `<span style="color:var(--danger)">❌ ${r.status}: ${esc(JSON.stringify(d))}</span>`; return; }
      if (d.skipped) info.innerHTML = `⏸ 업무시간 외 — skipped (${esc(d.reason||'')})`;
      else info.innerHTML = `✅ ${d.processed||0}개 메시지 처리 · ${d.pendingAdded||0}건 pending 추가 · 룸 ${d.rooms||0}개${d.errors?.length?` · ⚠️ ${d.errors.length} 에러`:''}`;
      refreshLinePendingBanner();
    } catch(e) { info.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`; }
  }
  window.runParseNow = runParseNow;

  async function peekLineQueue() {
    const info = document.getElementById('lineCfgQueueInfo');
    try {
      const r = await fetch('/api/line-parse-cron');
      const d = await r.json();
      info.innerHTML = `📦 큐 ${d.rawQueueLen||0}건 · 미처리 ${d.unprocessed||0}건 · pending ${d.pendingLen||0}건 · 마지막 실행 ${esc(d.lastRun||'-')}`;
    } catch(e) { info.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`; }
  }
  window.peekLineQueue = peekLineQueue;

  /* Haiku 전환 알림 배너 — zoolex 전용, 2026-06-12 ~ 2026-07-31 사이만 노출 */
  function checkHaikuMigrationBanner() {
    const banner = document.getElementById('haikuMigrationBanner');
    if (!banner) return;
    const auth = (typeof getAuthState === 'function') ? getAuthState() : null;
    const email = (auth?.email || '').toLowerCase();
    if (email !== 'zoolex@gmail.com') { banner.style.display = 'none'; return; }
    const todayKst = (() => {
      const d = new Date();
      const k = new Date(d.getTime() + 9*3600*1000);
      return k.toISOString().slice(0,10);
    })();
    const START = '2026-06-12';
    const END   = '2026-07-31';   // 약 7주 노출 후 자동 사라짐
    if (todayKst < START || todayKst > END) { banner.style.display = 'none'; return; }
    // 사용자가 '나중에 확인' 누른 경우 — 24시간 숨김
    const dismissed = Number(localStorage.getItem('haikuBannerDismissAt') || '0');
    if (dismissed && (Date.now() - dismissed) < 24*3600*1000) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = '';
  }
  window.checkHaikuMigrationBanner = checkHaikuMigrationBanner;

  function dismissHaikuBanner() {
    localStorage.setItem('haikuBannerDismissAt', String(Date.now()));
    const banner = document.getElementById('haikuMigrationBanner');
    if (banner) banner.style.display = 'none';
    showToast('24시간 후 다시 표시됩니다');
  }
  window.dismissHaikuBanner = dismissHaikuBanner;

  /* ════════════ 이카운트 등록일 부분 패치 ════════════ */
  let _ecountParsedRows = [];

  function parseEcountFile(inputEl) {
    const f = inputEl.files && inputEl.files[0];
    if (!f) return;
    document.getElementById('ecountFileLabel').textContent = '📄 ' + f.name;
    const preview = document.getElementById('ecountPreview');
    preview.innerHTML = '⏳ 파일 분석 중…';
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type:'array', cellDates:true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header:1, raw:false, defval:'' });

        // 헤더 자동 감지: 첫 행에 '사업자' 또는 '등록일' 글자 포함 시 헤더로 처리
        let startIdx = 0;
        if (rows.length && rows[0].some(c => /사업자|등록일|biz|reg|date/i.test(String(c||'')))) startIdx = 1;

        const parsed = [];
        const invalid = [];
        for (let i = startIdx; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length < 2) continue;
          const bizRaw = String(r[0]||'').trim();
          const dateRaw = r[1];
          if (!bizRaw) continue;
          const bizDigits = bizRaw.replace(/\D/g,'');
          if (bizDigits.length !== 10) {
            invalid.push({ row: i+1, biz: bizRaw, reason: '사업자번호 길이 ' + bizDigits.length });
            continue;
          }
          const biz = `${bizDigits.slice(0,3)}-${bizDigits.slice(3,5)}-${bizDigits.slice(5,10)}`;
          const regDate = _normalizeDate(dateRaw);
          if (!regDate) {
            invalid.push({ row: i+1, biz, reason: '일자 인식 실패: ' + String(dateRaw||'') });
            continue;
          }
          parsed.push({ biz, regDate, _row: i+1 });
        }
        _ecountParsedRows = parsed;
        preview.innerHTML = `
          <div style="background:#F0FDF4;border:1px solid var(--success);border-radius:6px;padding:8px 10px;color:#065F46">
            ✅ 파싱 완료: <b>${parsed.length}건</b> / 총 ${rows.length - startIdx}행
            ${invalid.length ? `<br>⚠ 변환 실패 ${invalid.length}건:<br>` + invalid.slice(0,5).map(x=>`&nbsp;&nbsp;• ${x.row}행: ${esc(x.biz)} — ${esc(x.reason)}`).join('<br>') + (invalid.length>5?'<br>&nbsp;&nbsp;… 외 '+(invalid.length-5)+'건':'') : ''}
          </div>
          ${parsed.length ? `<div style="margin-top:6px;padding:6px 10px;background:#fff;border:1px solid var(--gray-200);border-radius:6px">
            <div style="font-size:10px;color:var(--gray-500);font-weight:600;margin-bottom:3px">미리보기 (앞 5건)</div>
            ${parsed.slice(0,5).map(p => `<div style="font-family:monospace;font-size:11px">${esc(p.biz)} → ${esc(p.regDate)}</div>`).join('')}
          </div>` : ''}
        `;
        document.getElementById('ecountDryRunBtn').disabled = parsed.length === 0;
        document.getElementById('ecountApplyBtn').disabled = parsed.length === 0;
      } catch(err) {
        preview.innerHTML = `<span style="color:var(--danger)">❌ 파일 파싱 실패: ${esc(err.message)}</span>`;
      }
    };
    reader.readAsArrayBuffer(f);
  }
  window.parseEcountFile = parseEcountFile;

  /* 일자 정규화 — 다양한 포맷 → YYYY-MM-DD
     처리 가능:
       Date 객체, Excel 일자 시리얼,
       YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD,
       YY.MM.DD / YY-M-DD / YY/M/DD  (2자리 년: 00-69→20xx, 70-99→19xx),
       YYMMDD (6자리, 2자리 년),
       YYYY-MM (월까지만 → -01 첨가),
       한글 접미사 ("25.10.17 부터", "23.12.07 영업확인") → 일자 부분만 추출,
       기타 깨진 값(".", "-", 한글만 등) → '' */
  function _normalizeDate(v) {
    if (v == null) return '';

    // 1) Date 객체
    if (v instanceof Date && !isNaN(v.getTime())) {
      return _toYmd(v);
    }

    // 2) Excel 일자 시리얼 (숫자)
    if (typeof v === 'number' && isFinite(v) && v > 1) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + v * 86400000);
      if (!isNaN(d.getTime())) return _toYmd(d);
    }

    let s = String(v).trim();
    if (!s) return '';

    // 괄호 안 일자 추출 — "신규등록보류(22/6/13)" → "22/6/13"
    const paren = s.match(/[(（]\s*(\d{1,4}[-./]\d{1,2}[-./]\d{1,4})\s*[)）]/);
    if (paren) s = paren[1];

    // 비표준 구분자 정리 — '*', '.-', '..' 같은 깨진 입력 보정
    //   "2019*09-19"  → "2019-09-19"
    //   "2021-01.-21" → "2021-01-21"
    s = s.replace(/[*]/g, '-').replace(/\.-/g, '-').replace(/\.\./g, '.');

    // 한글/영문 잔여 텍스트 제거 — 일자 부분만 추출 시도
    // 예: "25.10.17 부터" → "25.10.17"
    const cleaned = s.replace(/\s*[가-힣].*$/, '').trim();
    if (cleaned) s = cleaned;

    // 깨진/너무 짧은 값
    if (s.length < 5) return '';

    let m;

    // 3) YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD (4자리 년 우선)
    m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) {
      const [_, y, mo, d] = m;
      return _validYmd(y, mo, d);
    }

    // 4) YY.MM.DD / YY-M-DD / YY/M/DD  (2자리 년)
    m = s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) {
      const [_, yy, mo, d] = m;
      const y = _twoDigitYearToFull(yy);
      return _validYmd(y, mo, d);
    }

    // 5) YYYYMMDD (8자리 무구분자)
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return _validYmd(m[1], m[2], m[3]);

    // 6) YYMMDD (6자리 무구분자, 2자리 년)
    m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (m) {
      const y = _twoDigitYearToFull(m[1]);
      return _validYmd(y, m[2], m[3]);
    }

    // 7) YYYY-MM (월까지만) → 1일로 보정
    m = s.match(/^(\d{4})[-./](\d{1,2})$/);
    if (m) return _validYmd(m[1], m[2], '01');

    // 8) YY-MM (월까지만, 2자리 년) → 1일로 보정
    m = s.match(/^(\d{2})[-./](\d{1,2})$/);
    if (m) {
      const y = _twoDigitYearToFull(m[1]);
      return _validYmd(y, m[2], '01');
    }

    // 9) DD-MM-YYYY 또는 DD/MM/YYYY (덜 일반적)
    m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
    if (m) return _validYmd(m[3], m[2], m[1]);

    // 10) Date 파싱 마지막 시도
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return _toYmd(dt);

    return '';
  }

  /* 2자리 연도 → 4자리 연도 (한국 비즈니스 컨벤션) */
  function _twoDigitYearToFull(yy) {
    const n = parseInt(String(yy), 10);
    if (!isFinite(n)) return '';
    // 00-69 → 20xx (2000~2069)
    // 70-99 → 19xx (1970~1999)
    return n < 70 ? (2000 + n) : (1900 + n);
  }

  /* YMD 유효성 검사 + 포맷 */
  function _validYmd(y, m, d) {
    const yy = parseInt(y, 10), mm = parseInt(m, 10), dd = parseInt(d, 10);
    if (!yy || !mm || !dd) return '';
    if (mm < 1 || mm > 12) return '';
    if (dd < 1 || dd > 31) return '';
    if (yy < 1900 || yy > 2100) return '';
    return `${String(yy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }

  function _toYmd(d) {
    const y = d.getUTCFullYear ? d.getUTCFullYear() : d.getFullYear();
    const m = (d.getUTCMonth ? d.getUTCMonth() : d.getMonth()) + 1;
    const dd = d.getUTCDate ? d.getUTCDate() : d.getDate();
    return `${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }

  async function runEcountPatch(dryRun) {
    if (!_ecountParsedRows.length) { showToast('파일을 먼저 선택하세요'); return; }
    const resultEl = document.getElementById('ecountResult');
    resultEl.innerHTML = '⏳ ' + (dryRun ? '미리보기' : '적용') + ' 중…';

    // 적용 시 확인
    if (!dryRun) {
      if (!confirm(`${_ecountParsedRows.length}건의 매장에 이카운트 등록일을 추가합니다.\n\n• 사업자번호 포맷도 표준화 (***-**-*****)\n• 다른 매장 데이터는 절대 변경되지 않음\n\n진행하시겠습니까?`)) {
        resultEl.innerHTML = '';
        return;
      }
    }

    try {
      const r = await fetch('/api/stores-patch-ecount', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: _ecountParsedRows, dryRun }),
      });
      const d = await r.json();
      if (!r.ok) { resultEl.innerHTML = `<span style="color:var(--danger)">❌ ${esc(d.error||JSON.stringify(d))}</span>`; return; }
      const unmatchedHtml = (d.unmatched && d.unmatched.length) ? `
        <details style="margin-top:6px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;padding:6px 10px">
          <summary style="cursor:pointer;font-weight:700;color:#92400E">⚠ 매칭 실패 ${d.unmatchedTotal||d.unmatched.length}건 (펼치기)</summary>
          <div style="max-height:200px;overflow-y:auto;margin-top:6px;font-size:10px">
            ${d.unmatched.map(x => `<div>${esc(x.biz)} (${esc(x.regDate||'')}) — ${esc(x.reason||'')}</div>`).join('')}
            ${d.unmatchedTotal > d.unmatched.length ? `<div style="color:var(--gray-500);margin-top:4px">… 외 ${d.unmatchedTotal - d.unmatched.length}건 더</div>` : ''}
          </div>
        </details>` : '';
      resultEl.innerHTML = `
        <div style="background:${dryRun?'#EFF6FF':'#F0FDF4'};border:1px solid ${dryRun?'#1D4ED8':'var(--success)'};border-radius:6px;padding:10px 12px">
          <b style="font-size:12px">${dryRun ? '👁 미리보기 결과' : '✅ 적용 완료'}</b><br>
          • 매칭: <b>${d.matched}</b> 건<br>
          • ${dryRun ? '갱신 예상' : '실제 갱신'}: <b style="color:var(--success)">${d.updated}</b> 건<br>
          • 사업자번호 표준화: <b>${d.bizNormalized}</b> 건<br>
          • 이미 동일값: ${d.alreadySet} 건
        </div>
        ${unmatchedHtml}
      `;
      if (!dryRun && d.updated > 0) {
        // KV 갱신 — 로컬 sync 권장
        try { if (typeof syncFromCloud === 'function') await syncFromCloud({ toast:false }); } catch(e){}
        showToast(`✅ ${d.updated}건 갱신 완료`);
      }
    } catch(e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`;
    }
  }
  window.runEcountPatch = runEcountPatch;

  /* 골드 셋 통계 로드 */
  async function loadGoldStats() {
    const el = document.getElementById('goldStats');
    if (!el) return;
    try {
      const r = await fetch('/api/line-gold');
      const d = await r.json();
      const s = d.stats || {};
      const cats = s.byCategory || {};
      const catMeta = {
        pos_as: '🖥 POS A/S', van_as: '💳 VAN A/S', device_mgmt: '📱 단말기 A/S',
        open_store: '🏪 오픈', van_doc: '📑 밴서류',
        label: '🏷 라벨지', equip_out: '📦 장비출고', delivery: '🚚 택배',
        as_pos_van: '🛠 A/S(구)',
      };
      const catParts = Object.entries(cats).map(([k,v]) => `${catMeta[k]||k}: <b>${v}</b>`).join('  ·  ');
      const progressBar = (() => {
        const target = 200;
        const pct = Math.min(100, Math.round((s.total||0) * 100 / target));
        const color = pct >= 50 ? '#16A34A' : pct >= 25 ? '#F59E0B' : '#94A3B8';
        return `<div style="margin-top:6px"><div style="height:6px;background:#fff;border-radius:3px;overflow:hidden;border:1px solid var(--gray-200)"><div style="height:100%;width:${pct}%;background:${color};transition:width .3s"></div></div><div style="font-size:9px;color:var(--gray-500);margin-top:2px">목표 200건 대비 <b>${pct}%</b></div></div>`;
      })();
      el.innerHTML = `
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          <span>총 <b style="font-size:14px;color:#92400E">${s.total||0}</b>건</span>
          <span style="color:var(--gray-400)">|</span>
          ${catParts || '<span style="color:var(--gray-400)">데이터 없음</span>'}
        </div>
        <div style="margin-top:4px;font-size:10px;color:var(--gray-500)">
          ${s.storeMatched ? `매장 연결: ${s.storeMatched}건` : ''}
          ${s.categoryChanged ? ` · 카테고리 변경: ${s.categoryChanged}건` : ''}
          ${s.firstAt ? ` · 시작: ${(s.firstAt||'').slice(0,10)}` : ''}
          ${s.lastAt ? ` · 최근: ${(s.lastAt||'').slice(0,10)}` : ''}
        </div>
        ${progressBar}
      `;
    } catch(e) { el.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`; }
  }
  window.loadGoldStats = loadGoldStats;

  /* LINE 파싱 이력 — 어느 메시지가 pending/ignore/error 되었는지 */
  async function loadParseLog() {
    const dateEl = document.getElementById('parseLogDate');
    const filtEl = document.getElementById('parseLogFilter');
    const statsEl = document.getElementById('parseLogStats');
    const listEl = document.getElementById('parseLogList');
    if (!listEl) return;

    listEl.innerHTML = '⏳ 조회 중…';
    const date = dateEl?.value || '';
    const result = filtEl?.value || 'all';
    try {
      const url = '/api/line-parse-log?' + new URLSearchParams({ date, result, limit: 300 });
      const r = await fetch(url);
      const d = await r.json();

      // 날짜 셀렉터 populate (최초 호출 시)
      if (dateEl && dateEl.options.length === 0 && d.datesList) {
        dateEl.innerHTML = d.datesList.map(x => `<option value="${x}" ${x===d.date?'selected':''}>${x}</option>`).join('');
      }

      const st = d.stats || {};
      statsEl.innerHTML = `
        <span style="margin-right:10px">📊 <b>${st.total||0}</b>건</span>
        <span style="color:#16A34A;margin-right:10px">✅ 등록 대기: <b>${st.pending||0}</b></span>
        <span style="color:var(--gray-500);margin-right:10px">⚪ 무시: <b>${st.ignore||0}</b></span>
        ${st.error ? `<span style="color:var(--danger)">⚠ 오류: <b>${st.error}</b></span>` : ''}
      `;

      const items = d.items || [];
      if (!items.length) {
        listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--gray-400)">조회된 항목이 없습니다</div>`;
        return;
      }
      const resultMeta = {
        pending: { bg:'#D1FAE5', color:'#065F46', icon:'✅', label:'등록 대기' },
        ignore:  { bg:'#F3F4F6', color:'#6B7280', icon:'⚪', label:'무시' },
        error:   { bg:'#FEE2E2', color:'#991B1B', icon:'⚠', label:'오류' },
      };
      const catMeta = {
        pos_as:      '🖥 POS A/S',
        van_as:      '💳 VAN A/S',
        device_mgmt: '📱 단말기 A/S',
        open_store:  '🏪 오픈',
        van_doc:     '📑 밴서류',
        label:       '🏷 라벨지',
        equip_out:   '📦 장비출고',
        delivery:    '🚚 택배',
        as_pos_van:  '🛠 A/S(구)',
      };
      listEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead style="background:#F3F4F6;position:sticky;top:0">
            <tr>
              <th style="text-align:left;padding:5px 6px">시각</th>
              <th style="text-align:left;padding:5px 6px">발신</th>
              <th style="text-align:left;padding:5px 6px">메시지</th>
              <th style="text-align:left;padding:5px 6px;width:90px">결과</th>
              <th style="text-align:left;padding:5px 6px;width:80px">분류</th>
              <th style="text-align:left;padding:5px 6px">매장/사유</th>
            </tr>
          </thead>
          <tbody>
          ${items.map(it => {
            const rm = resultMeta[it.result] || resultMeta.ignore;
            return `<tr style="border-top:1px solid var(--gray-200)">
              <td style="padding:5px 6px;font-family:monospace;color:var(--gray-600);white-space:nowrap">${esc((it.msgAtKst||'').slice(11))}</td>
              <td style="padding:5px 6px;font-weight:600;white-space:nowrap">${esc(it.sender||'-')}</td>
              <td style="padding:5px 6px;max-width:280px;color:var(--gray-700)" title="${esc(it.text||'')}">${esc((it.text||'').slice(0,80))}${(it.text||'').length>80?'…':''}</td>
              <td style="padding:5px 6px"><span style="background:${rm.bg};color:${rm.color};padding:2px 7px;border-radius:4px;font-weight:700;font-size:10px">${rm.icon} ${rm.label}</span></td>
              <td style="padding:5px 6px;font-size:10px;color:var(--gray-600)">${it.category ? esc(catMeta[it.category] || it.category) : '-'}</td>
              <td style="padding:5px 6px;font-size:10px;color:var(--gray-500)" title="${esc(it.reason||'')}">
                ${it.store ? `🏪 ${esc(it.store)}` : ''}
                ${it.assignee ? ` · 👤 ${esc(it.assignee)}` : ''}
                ${it.result === 'ignore' && it.reason ? `<span style="color:var(--gray-400)">${esc(it.reason.slice(0,40))}</span>` : ''}
                ${it.result === 'error' ? `<span style="color:var(--danger)">${esc((it.reason||'').slice(0,40))}</span>` : ''}
              </td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>`;
    } catch(e) {
      listEl.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`;
    }
  }
  window.loadParseLog = loadParseLog;

  /* LINE 수신 채팅방 매핑 — 봇이 받은 ID 에 사이트 이름·타입 부여 */
  let _lineRooms = [];
  async function loadLineRooms() {
    const list = document.getElementById('lineRoomList');
    if (!list) return;
    list.innerHTML = '⏳ 조회 중…';
    try {
      const r = await fetch('/api/line-rooms');
      const d = await r.json();
      _lineRooms = d.rooms || [];
      renderLineRoomList();
      // localStorage 동기화 — Line 가져오기 모달이 같은 이름을 보게
      syncRoomsToLocal();
      // 알림 수신자 셀렉트 갱신 — 현재 선택값 유지
      try {
        const sel = document.getElementById('lineCfgAlertRecipient');
        const curId = sel?.value || '';
        const curName = sel?.options[sel.selectedIndex]?.text?.replace(/\s*\(.*?\)\s*$/,'').trim() || '';
        _populateAlertRecipientSelect(curId, curName);
      } catch(e){}
    } catch(e) { list.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`; }
  }
  window.loadLineRooms = loadLineRooms;

  // 혼합 분류 룸 — Claude 가 메시지마다 분류 (룸 성격은 힌트로만 사용)
  const LINE_ROOM_MIXED_OPTS = [
    { v:'general',  l:'일반 대화' },
    { v:'as',       l:'AS/작업 접수' },
    { v:'work',     l:'업무 지시' },
    { v:'schedule', l:'일정 관리' },
  ];
  // 고정 분류 룸 — 모든 메시지가 이 카테고리로 자동 분류 (Claude 호출 안 함)
  const LINE_ROOM_FIXED_OPTS = [
    { v:'equip_out', l:'📦 장비 출고' },
    { v:'delivery',  l:'🚚 택배 관리' },
    { v:'label',     l:'🏷 라벨지 발주' },
  ];
  function _lineRoomTypeLabel(v){
    const o = [...LINE_ROOM_MIXED_OPTS, ...LINE_ROOM_FIXED_OPTS].find(x=>x.v===v);
    return o ? o.l : '';
  }
  function _isFixedType(v){ return LINE_ROOM_FIXED_OPTS.some(o=>o.v===v); }
  function _roomTypeIcon(t){ return t === 'group' ? '👥' : t === 'room' ? '💬' : t === 'user' ? '👤' : '❓'; }

  function renderLineRoomList() {
    const list = document.getElementById('lineRoomList');
    if (!list) return;
    if (!_lineRooms.length) {
      list.innerHTML = `<div style="color:var(--gray-400);font-size:11px;padding:8px;text-align:center">아직 수신한 채팅방이 없습니다 — 그룹에 메시지 1개 작성 후 조회</div>`;
      return;
    }
    // 미매핑 먼저, 매핑된 것 뒤로
    const sorted = [..._lineRooms].sort((a,b)=>{
      if (a.mapped !== b.mapped) return a.mapped ? 1 : -1;
      return (b.lastTs||0) - (a.lastTs||0);
    });
    list.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
      ${sorted.map(r => {
        const typeLabel = _lineRoomTypeLabel(r.type);
        const isFixed = _isFixedType(r.type);
        const modeBadge = r.mapped
          ? (isFixed
              ? '<span style="background:#FFF7ED;color:#9A3412;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700">🎯 고정 분류</span>'
              : '<span style="background:#EFF6FF;color:#1E40AF;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700">🔀 메시지별 분류</span>')
          : '';
        const preview = r.msgCount
          ? `<b>${esc(r.lastSender||'')}</b>: ${esc((r.lastText||'').slice(0,80))}${(r.lastText||'').length>80?'…':''}`
          : '<span style="color:var(--gray-400)">메시지 없음</span>';
        return `
          <div style="border:1px solid ${r.mapped?'var(--success)':'var(--gray-300)'};${r.mapped?'background:#F0FDF4':'background:#fff'};border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:12px">
            <div style="font-size:18px;line-height:1">${_roomTypeIcon(r.roomType)}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
                <span style="font-weight:700;font-size:13px;color:${r.name?'#111':'#9CA3AF'}">${r.name?esc(r.name):'(표시명 미설정)'}</span>
                ${typeLabel
                  ? `<span style="background:#DBEAFE;color:#1D4ED8;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700">${esc(typeLabel)}</span>`
                  : `<span style="background:#FEE2E2;color:#991B1B;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700">타입 미설정</span>`}
                ${modeBadge}
                ${r.mapped?'<span style="color:var(--success);font-size:11px;font-weight:700">✓ 매핑됨</span>':''}
                <span style="color:var(--gray-400);font-size:10px;margin-left:auto">${r.msgCount||0}건</span>
              </div>
              <div style="font-size:11px;color:var(--gray-600);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.lastText||'')}">${preview}</div>
            </div>
            <button class="btn btn-sm" onclick="openLineRoomEdit('${esc(r.id)}')" style="white-space:nowrap;background:#1A1614;color:#FFF8E7;padding:6px 12px;font-size:12px">편집</button>
          </div>`;
      }).join('')}
      </div>`;
  }

  let _editingRoomId = null;
  function openLineRoomEdit(id){
    const r = _lineRooms.find(x=>x.id===id);
    if(!r){ showToast('채팅방 정보를 찾을 수 없습니다'); return; }
    _editingRoomId = id;
    const body = document.getElementById('lineRoomEditBody');
    if(!body) return;
    const date = r.lastTs ? new Date(r.lastTs).toLocaleString('ko-KR') : '-';
    const initialMode = _isFixedType(r.type) ? 'fixed' : 'mixed';
    body.innerHTML = `
      <div style="background:#F9FAFB;border:1px solid var(--gray-200);border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:18px">${_roomTypeIcon(r.roomType)}</span>
          <span style="font-size:12px;color:var(--gray-600);font-family:monospace">${esc(r.roomType||'?')} · ${esc(r.id.slice(0,16))}…</span>
          <span style="margin-left:auto;font-size:11px;color:var(--gray-500)">${r.msgCount||0}건 수신</span>
        </div>
        <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px">최근 메시지 (${esc(date)})</div>
        <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px">발신: <b style="color:#111">${esc(r.lastSender||'-')}</b></div>
        <div style="background:#fff;border:1px solid var(--gray-200);border-radius:6px;padding:10px;font-size:13px;color:#111;max-height:200px;overflow:auto;white-space:pre-wrap;line-height:1.5">${esc(r.lastText||'(메시지 없음)')}</div>
      </div>

      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;font-weight:700;color:var(--gray-700);margin-bottom:6px">표시명 <span style="color:var(--danger)">*</span></label>
        <input type="text" id="lineRoomEditName" value="${esc(r.name||'')}" placeholder="예: AS 접수방 / 신규 오픈방 / 장비 출고방"
               style="width:100%;padding:10px 12px;border:1.5px solid var(--gray-400);border-radius:6px;font-size:14px;color:#111;background:#fff;font-weight:500">
      </div>

      <div style="margin-bottom:14px">
        <label style="display:block;font-size:12px;font-weight:700;color:var(--gray-700);margin-bottom:8px">분류 방식 <span style="color:var(--danger)">*</span></label>
        <div style="display:flex;gap:8px">
          <label class="line-mode-card" data-mode="mixed" onclick="onLineRoomModeChange('mixed')"
                 style="flex:1;border:2px solid ${initialMode==='mixed'?'#1D4ED8':'var(--gray-300)'};border-radius:8px;padding:10px 12px;cursor:pointer;background:${initialMode==='mixed'?'#EFF6FF':'#fff'}">
            <div style="font-size:12px;font-weight:700;color:#1D4ED8;margin-bottom:3px">🔀 메시지별 분류</div>
            <div style="font-size:11px;color:var(--gray-600);line-height:1.4">Claude 가 메시지마다 자동 분류<br>(AS / 밴서류 / 신규 / 단말기 등 혼합)</div>
          </label>
          <label class="line-mode-card" data-mode="fixed" onclick="onLineRoomModeChange('fixed')"
                 style="flex:1;border:2px solid ${initialMode==='fixed'?'#9A3412':'var(--gray-300)'};border-radius:8px;padding:10px 12px;cursor:pointer;background:${initialMode==='fixed'?'#FFF7ED':'#fff'}">
            <div style="font-size:12px;font-weight:700;color:#9A3412;margin-bottom:3px">🎯 고정 분류</div>
            <div style="font-size:11px;color:var(--gray-600);line-height:1.4">모든 메시지를 동일 타입으로<br>(장비 출고 / 택배 / 라벨지 전용방)</div>
          </label>
        </div>
        <input type="hidden" id="lineRoomEditMode" value="${initialMode}">
      </div>

      <div id="lineRoomEditTypeWrap">
        <label style="display:block;font-size:12px;font-weight:700;color:var(--gray-700);margin-bottom:6px">
          <span id="lineRoomEditTypeLabel">${initialMode==='fixed'?'고정 카테고리':'채팅방 성격'}</span>
          <span style="color:var(--danger)">*</span>
        </label>
        <select id="lineRoomEditType"
                style="width:100%;padding:10px 12px;border:1.5px solid var(--gray-400);border-radius:6px;font-size:14px;color:#111;background:#fff;font-weight:500">
          <option value="">— 선택 —</option>
        </select>
        <div id="lineRoomEditTypeHint" style="font-size:11px;color:var(--gray-500);margin-top:6px"></div>
      </div>`;
    _refreshLineRoomTypeOptions(initialMode, r.type);
    showModal('lineRoomEditModal');
    setTimeout(()=>document.getElementById('lineRoomEditName')?.focus(), 200);
  }
  window.openLineRoomEdit = openLineRoomEdit;

  function _refreshLineRoomTypeOptions(mode, currentValue){
    const sel = document.getElementById('lineRoomEditType');
    const label = document.getElementById('lineRoomEditTypeLabel');
    const hint = document.getElementById('lineRoomEditTypeHint');
    if (!sel) return;
    const opts = mode === 'fixed' ? LINE_ROOM_FIXED_OPTS : LINE_ROOM_MIXED_OPTS;
    // 모드 전환 시 이전 값이 새 옵션에 없으면 초기화
    const keep = opts.some(o => o.v === currentValue) ? currentValue : '';
    sel.innerHTML = '<option value="">— 선택 —</option>' +
      opts.map(o=>`<option value="${o.v}" ${o.v===keep?'selected':''}>${o.l}</option>`).join('');
    if (label) label.textContent = mode === 'fixed' ? '고정 카테고리' : '채팅방 성격';
    if (hint) hint.textContent = mode === 'fixed'
      ? '이 룸의 모든 메시지가 선택한 카테고리로 자동 분류됩니다 (Claude 미호출, 토큰 절약).'
      : 'Claude 가 메시지 내용을 보고 AS·밴서류·신규 등으로 분류합니다. 룸 성격은 분류 힌트로 사용됩니다.';
  }

  function onLineRoomModeChange(mode){
    document.getElementById('lineRoomEditMode').value = mode;
    document.querySelectorAll('.line-mode-card').forEach(el=>{
      const m = el.getAttribute('data-mode');
      const active = m === mode;
      const accent = m === 'fixed' ? '#9A3412' : '#1D4ED8';
      const bg = m === 'fixed' ? '#FFF7ED' : '#EFF6FF';
      el.style.borderColor = active ? accent : 'var(--gray-300)';
      el.style.background  = active ? bg : '#fff';
    });
    const curType = document.getElementById('lineRoomEditType')?.value || '';
    _refreshLineRoomTypeOptions(mode, curType);
  }
  window.onLineRoomModeChange = onLineRoomModeChange;

  async function saveLineRoomEdit(){
    if(!_editingRoomId){ closeModal('lineRoomEditModal'); return; }
    const r = _lineRooms.find(x=>x.id===_editingRoomId);
    if(!r) return;
    const name = (document.getElementById('lineRoomEditName')?.value||'').trim();
    const mode = (document.getElementById('lineRoomEditMode')?.value||'mixed').trim();
    const type = (document.getElementById('lineRoomEditType')?.value||'').trim();
    if(!name){ showToast('⚠️ 표시명을 입력하세요'); return; }
    if(!type){ showToast(mode==='fixed'?'⚠️ 고정 카테고리를 선택하세요':'⚠️ 채팅방 성격을 선택하세요'); return; }
    const btn = document.getElementById('lineRoomEditSaveBtn');
    if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; }
    try{
      await fetch('/api/line-rooms', {
        method:'PUT', headers:{'content-type':'application/json'},
        body: JSON.stringify({ id:_editingRoomId, name, type, parseMode: mode }),
      });
      r.name = name; r.type = type; r.parseMode = mode; r.mapped = true;
      renderLineRoomList();
      syncRoomsToLocal();
      closeModal('lineRoomEditModal');
      showToast('💾 매핑 저장됨 — ' + name);
    }catch(e){ showToast('❌ ' + e.message); }
    finally{ if(btn){ btn.disabled = false; btn.textContent = '저장'; } _editingRoomId = null; }
  }
  window.saveLineRoomEdit = saveLineRoomEdit;

  let _roomUpdateTimers = {};
  function updateLineRoom(id, field, value) {
    const r = _lineRooms.find(x => x.id === id);
    if (!r) return;
    r[field] = value;
    clearTimeout(_roomUpdateTimers[id]);
    _roomUpdateTimers[id] = setTimeout(async () => {
      try {
        await fetch('/api/line-rooms', {
          method:'PUT',
          headers:{'content-type':'application/json'},
          body: JSON.stringify({ id, name: r.name, type: r.type }),
        });
        r.mapped = true;
        renderLineRoomList();
        syncRoomsToLocal();
        showToast('💾 매핑 저장됨');
      } catch(e) { showToast('❌ ' + e.message); }
    }, 500);
  }
  window.updateLineRoom = updateLineRoom;

  /* KV roomMap → localStorage(neo_line_rooms) 동기화 — Line 가져오기 모달이 동일 이름 사용 */
  function syncRoomsToLocal() {
    try {
      const existing = JSON.parse(localStorage.getItem('neo_line_rooms') || '[]');
      const byId = {};
      for (const e of existing) byId[e.id] = e;
      for (const r of _lineRooms) {
        if (r.mapped && r.name) {
          byId[r.id] = { id: r.id, name: r.name, type: r.type || 'general' };
        }
      }
      const merged = Object.values(byId);
      localStorage.setItem('neo_line_rooms', JSON.stringify(merged));
      // 임포트 모달이 열려있으면 즉시 재렌더
      try { if (typeof renderLineRoomChips === 'function') renderLineRoomChips(); } catch(e){}
    } catch(e) {}
  }

  /* 라인 임포트 모달 열기 전에 KV 룸 가져와 병합 — 메뉴 클릭 시 자동 동기화 */
  async function syncLineRoomsFromKV() {
    try {
      const r = await fetch('/api/line-rooms');
      if (!r.ok) return;
      const d = await r.json();
      _lineRooms = d.rooms || [];
      syncRoomsToLocal();
    } catch(e) {}
  }
  window.syncLineRoomsFromKV = syncLineRoomsFromKV;

  function toggleAdminApiKeyVisibility() {
    const inp = document.getElementById('adminApiKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }
  function toggleAdminGoogleClientIdVisibility() {
    const inp = document.getElementById('adminGoogleClientId');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }

  function toggleAdminSection(key) {
    const body = document.getElementById(key + 'SectionBody');
    const arrow = document.getElementById(key + 'SectionArrow');
    if (!body) return;
    const hidden = body.style.display === 'none' || !body.style.display;
    body.style.display = hidden ? 'block' : 'none';
    if (arrow) arrow.textContent = hidden ? '▾ 접기' : '▸ 펼치기';
  }

  async function testAdminApiKey() {
    const key = document.getElementById('adminApiKey').value.trim();
    const statusEl = document.getElementById('adminApiKeyStatus');
    if (!key) { statusEl.textContent = 'API 키를 입력하세요.'; statusEl.style.display=''; statusEl.style.background='#FEF2F2'; statusEl.style.color='#DC2626'; return; }
    statusEl.textContent = '⏳ 연결 테스트 중...'; statusEl.style.display=''; statusEl.style.background='#EFF6FF'; statusEl.style.color='#1D4ED8';
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
      if (res.ok) { statusEl.textContent = '✅ 연결 성공! API 키가 유효합니다.'; statusEl.style.background='#F0FDF4'; statusEl.style.color='#16A34A'; }
      else { statusEl.textContent = '❌ 연결 실패. API 키를 확인해 주세요.'; statusEl.style.background='#FEF2F2'; statusEl.style.color='#DC2626'; }
    } catch { statusEl.textContent = '❌ 네트워크 오류 또는 CORS 제한.'; statusEl.style.background='#FEF2F2'; statusEl.style.color='#DC2626'; }
  }

  function clearAllLegacyUsers() {
    if (!confirm('기존에 등록된 모든 직원 데이터를 삭제합니다.\n(관리자 본인 계정은 유지됩니다.)\n\n계속하시겠습니까?')) return;
    const me = getAuthState();
    const keep = (me && me.loggedIn) ? [{
      id: me.id, name: me.name, role: me.role, picture: me.picture || '', provider: 'google', createdAt: Date.now()
    }] : [];
    saveUsers(keep);
    // 관리자 페이지 즉시 갱신
    if (typeof openAdminPage === 'function') {
      const listEl = document.getElementById('adminEmployeeList');
      if (listEl) {
        const users = getUsers();
        listEl.innerHTML = users.length === 0
          ? '<div style="padding:14px;text-align:center;color:var(--gray-400);font-size:12px;background:#FAFAFA;border-radius:8px">등록된 사용자가 없습니다.</div>'
          : users.map(p => `
            <div class="admin-employee-row">
              <div class="avatar-sm" style="background:${p.role==='admin'?'#EF4444':'#2563EB'}">${(p.name||'?').charAt(0)}</div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700">${p.name}</div>
                <div style="font-size:11px;color:var(--gray-400)">${p.id}</div>
              </div>
              <span class="admin-badge ${p.role==='admin'?'admin':'staff'}">${p.role==='admin'?'관리자':'직원'}</span>
            </div>
          `).join('');
      }
    }
    showToast && showToast('✅ 기존 직원 데이터 삭제됨');
  }

  /* 직원 전체 정보 추가 (이름/직책/전화/이메일) — 한 번에 등록 */
  function addEmployeeFull() {
    const nameEl  = document.getElementById('newEmpName');
    const roleEl  = document.getElementById('newEmpRole');
    const phoneEl = document.getElementById('newEmpPhone');
    const emailEl = document.getElementById('newEmpEmail');
    const name  = (nameEl?.value  || '').trim();
    const role  = (roleEl?.value  || '').trim();
    const phone = (phoneEl?.value || '').trim();
    const email = (emailEl?.value || '').trim().toLowerCase();

    // 이메일 필수
    if (!email || !email.includes('@') || !email.includes('.')) {
      showToast && showToast('올바른 이메일을 입력하세요. (로그인용 필수)');
      emailEl?.focus();
      return;
    }
    if (!name) {
      showToast && showToast('이름을 입력하세요.');
      nameEl?.focus();
      return;
    }

    // 1) ns_users 에 풀 정보 저장
    const users = getUsers();
    const existing = users.find(u => (u.id || '').toLowerCase() === email || (u.email || '').toLowerCase() === email);
    if (existing) {
      // 기존 사용자 정보 업데이트
      existing.name = name;
      existing.role = existing.role || (role || 'staff');
      existing.title = role || existing.title || '';
      existing.phone = phone || existing.phone || '';
      existing.email = email;
      existing.updatedAt = Date.now();
    } else {
      users.push({
        id: email,
        email,
        name,
        title: role,
        role: 'staff',
        phone,
        provider: 'manual',
        createdAt: Date.now(),
      });
    }
    saveUsers(users);

    // 2) 화이트리스트에 이메일 자동 등록
    const allowed = getAllowedEmails();
    if (!allowed.map(x => x.toLowerCase()).includes(email)) {
      allowed.push(email);
      saveAllowedEmails(allowed);
    }

    // 3) 입력란 초기화 + 목록 갱신
    if (nameEl)  nameEl.value  = '';
    if (roleEl)  roleEl.value  = '';
    if (phoneEl) phoneEl.value = '';
    if (emailEl) emailEl.value = '';

    showToast && showToast(`✅ ${name} (${email}) 직원 등록됨`);

    // 직원 목록 + 화이트리스트 즉시 갱신
    if (typeof openAdminPage === 'function') {
      try { renderAllowedEmailList(); } catch(e) {}
      try { renderEmployeeList(); } catch(e) {}
    }

    // ☁ 클라우드 자동 동기화 (관리자 토큰 있을 때만)
    try { pushCloudWhitelist({ toast: true }); } catch(e) {}
  }
  window.addEmployeeFull = addEmployeeFull;

  /* 직원 목록 렌더 (이름/직책/전화/이메일) */
  function renderEmployeeList() {
    const listEl = document.getElementById('adminEmployeeList');
    if (!listEl) return;
    const users = getUsers();
    const presets = (typeof APPROVED_EMPLOYEES !== 'undefined') ? APPROVED_EMPLOYEES : [];
    const allPeople = [
      ...presets.map(e => ({ id: e.id, name: e.name, title: e.role, role: e.role === '관리자' ? 'admin' : 'staff', color: e.color, phone: '', email: e.id, source: 'preset' })),
      ...users.map(u => ({ id: u.id, name: u.name, title: u.title || '', role: u.role || 'staff', phone: u.phone || '', email: u.email || u.id, source: 'user' }))
    ];
    if (allPeople.length === 0) {
      listEl.innerHTML = '<div style="padding:14px;text-align:center;color:var(--gray-400);font-size:12px;background:#FAFAFA;border-radius:8px">등록된 사용자가 없습니다.</div>';
      return;
    }
    const inSty = 'padding:5px 8px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff';
    listEl.innerHTML = allPeople.map((p) => {
      // 프리셋: 읽기 전용
      if (p.source === 'preset') {
        return `<div class="admin-employee-row" style="padding:10px 12px">
          <div class="avatar-sm" style="background:${p.color || (p.role==='admin'?'#EF4444':'#2563EB')}">${(p.name||'?').charAt(0)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700">${esc(p.name||'-')}${p.title ? ` <span style="font-size:11px;color:var(--gray-500);font-weight:500">${esc(p.title)}</span>` : ''}</div>
            <div style="font-size:11px;color:var(--gray-500);margin-top:2px">${p.email ? `📧 ${esc(p.email)}` : ''}</div>
          </div>
          <span class="admin-badge ${p.role==='admin'?'admin':'staff'}">${p.role==='admin'?'관리자':'직원'}</span>
          <span style="font-size:10px;color:var(--gray-300);margin-left:6px">기본</span>
        </div>`;
      }
      // 사용자 — 인라인 편집 가능
      const sid = esc(p.id);
      return `<div class="admin-employee-row" style="padding:10px 12px;align-items:flex-start">
        <div class="avatar-sm" style="background:${p.role==='admin'?'#EF4444':'#2563EB'};margin-top:4px">${(p.name||'?').charAt(0)}</div>
        <div style="flex:1;min-width:0;display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <input type="text" value="${esc(p.name||'')}" placeholder="이름" onchange="updateUserField('${sid}','name',this.value)" style="${inSty}">
          <input type="text" value="${esc(p.title||'')}" placeholder="직책 (예: 영업팀장)" onchange="updateUserField('${sid}','title',this.value)" style="${inSty}">
          <input type="tel" value="${esc(p.phone||'')}" placeholder="연락처" onchange="updateUserField('${sid}','phone',this.value)" style="${inSty}">
          <select onchange="updateUserField('${sid}','role',this.value)" style="${inSty}">
            <option value="staff" ${p.role!=='admin'?'selected':''}>직원</option>
            <option value="admin" ${p.role==='admin'?'selected':''}>관리자</option>
          </select>
          <div style="grid-column:1/-1;font-size:11px;color:var(--gray-500)">📧 ${esc(p.email)}</div>
        </div>
        <button class="btn btn-outline btn-sm" style="color:#EF4444;border-color:#FCA5A5;padding:3px 10px;font-size:11px;margin-left:6px;flex-shrink:0" onclick="removeEmployee('${sid}')">삭제</button>
      </div>`;
    }).join('');
  }
  window.renderEmployeeList = renderEmployeeList;

  function updateUserField(userId, field, value) {
    if (!['name','title','phone','role'].includes(field)) return;
    const users = getUsers();
    const u = users.find(x => x.id === userId);
    if (!u) return;
    u[field] = String(value||'').trim();
    saveUsers(users);
    // 현재 로그인한 사용자의 이름/역할이 바뀌면 ns_auth 도 동기화 — 프로필 드롭다운 즉시 반영
    try {
      const auth = JSON.parse(localStorage.getItem('ns_auth') || 'null');
      if (auth && (auth.email || auth.id || '').toLowerCase() === (u.email || u.id || '').toLowerCase()) {
        if (field === 'name') auth.name = u.name;
        if (field === 'role') auth.role = u.role;
        localStorage.setItem('ns_auth', JSON.stringify(auth));
      }
    } catch(e){}
    if (typeof showToast === 'function') {
      const labels = { name:'이름', title:'직책', phone:'연락처', role:'역할' };
      showToast(`✅ ${labels[field]} 저장됨`);
    }
    // 클라우드에 직원 정보도 푸시
    try { pushCloudWhitelist({ toast: false }); } catch(e){}
  }
  window.updateUserField = updateUserField;

  function removeEmployee(id) {
    if (!confirm('이 직원을 삭제하시겠습니까? (이메일 화이트리스트에서도 제거됩니다)')) return;
    const users = getUsers().filter(u => u.id !== id);
    saveUsers(users);
    const allowed = getAllowedEmails().filter(e => e.toLowerCase() !== (id || '').toLowerCase());
    saveAllowedEmails(allowed);
    try { renderEmployeeList(); } catch(e) {}
    try { renderAllowedEmailList(); } catch(e) {}
    showToast && showToast('🗑 직원 삭제됨');
    try { pushCloudWhitelist({ toast: true }); } catch(e) {}
  }
  window.removeEmployee = removeEmployee;

  function renderAllowedEmailList() {
    const el = document.getElementById('allowedEmailList');
    if (!el) return;
    const list = getAllowedEmails();
    if (list.length === 0) {
      el.innerHTML = '<div style="padding:14px;text-align:center;color:var(--gray-400);font-size:12px;background:#FAFAFA;border-radius:8px">등록된 이메일이 없습니다. 직원 이메일을 추가하세요.</div>';
      return;
    }
    el.innerHTML = list.map((em, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#F9FAFB;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
        <span style="flex:1;color:var(--gray-700);font-weight:500">${em}</span>
        <button class="btn btn-outline btn-sm" style="color:#EF4444;border-color:#FCA5A5;padding:3px 10px;font-size:11px" onclick="removeAllowedEmail(${i})">삭제</button>
      </div>
    `).join('');
  }

  function addAllowedEmail() {
    const inp = document.getElementById('newAllowedEmail');
    const em = (inp.value || '').trim().toLowerCase();
    if (!em || !em.includes('@') || !em.includes('.')) {
      showToast && showToast('올바른 이메일을 입력하세요.');
      return;
    }
    const list = getAllowedEmails();
    if (list.map(x => x.toLowerCase()).includes(em)) {
      showToast && showToast('이미 등록된 이메일입니다.');
      return;
    }
    list.push(em);
    saveAllowedEmails(list);
    inp.value = '';
    renderAllowedEmailList();
    showToast && showToast(`✅ ${em} 추가됨`);
    try { pushCloudWhitelist({ toast: true }); } catch(e) {}
  }

  function removeAllowedEmail(idx) {
    const list = getAllowedEmails();
    const em = list[idx];
    if (!em) return;
    if (!confirm(`${em} 의 접근 권한을 제거할까요?`)) return;
    list.splice(idx, 1);
    saveAllowedEmails(list);
    renderAllowedEmailList();
    showToast && showToast('삭제됨');
    try { pushCloudWhitelist({ toast: true }); } catch(e) {}
  }

  function saveAdminSettings() {
    // API 키 저장 — getApiKey() 가 읽는 키와 동일한 'neo_api_key' 로 저장 (이전엔 'anthropic_api_key' 로 저장해 모달 재오픈 시 사라져 보였음)
    const key = document.getElementById('adminApiKey').value.trim();
    if (key) saveApiKey(key);
    // 구버전 키 'anthropic_api_key' 도 함께 정리 (혼동 방지)
    try { localStorage.removeItem('anthropic_api_key'); } catch(e){}

    const gcidEl = document.getElementById('adminGoogleClientId');
    if (gcidEl) setGoogleClientId(gcidEl.value.trim());
    const tokEl = document.getElementById('adminCloudSyncToken');
    if (tokEl) saveCloudSyncToken(tokEl.value.trim());
    showToast && showToast('✅ 설정이 저장되었습니다.');
    // 클라우드에도 Google Client ID + 화이트리스트 동기화
    try { pushCloudWhitelist({ toast: false }); } catch(e) {}
    closeModal('adminModal');
  }

  /* ── 기존 설정 모달은 관리자 페이지로 리다이렉트 ── */
  function openSettingsModal() {
    openAdminPage();
  }

  /* ════════════════════════════════════════
     COMMENT SYSTEM — 팀 댓글
     승인된 직원: localStorage 저장 · 페이지별
  ════════════════════════════════════════ */

  // 샘플 직원 목록 제거 — 실제 직원은 관리자 페이지의 접근 허용 이메일로 관리
  const APPROVED_EMPLOYEES = [];

  const CM_SCREEN_LABELS = {
    dashboard: '대시보드', jobs: '작업목록', stores: '점포관리',
    calendar: '일정', equipment: '장비재고', quote: '견적'
  };

  let cmCurrentScreen = 'dashboard';
  let cmPanelOpen = false;

  /* 저장소 접근 */
  function getComments() {
    try { return JSON.parse(localStorage.getItem('ns_comments') || '{}'); } catch { return {}; }
  }
  function saveComments(data) {
    localStorage.setItem('ns_comments', JSON.stringify(data));
  }
  function getScreenComments(screen) {
    return (getComments()[screen] || []);
  }

  /* 패널 토글 */
  function toggleCommentPanel() {
    cmPanelOpen = !cmPanelOpen;
    document.getElementById('commentPanel').classList.toggle('open', cmPanelOpen);
    document.getElementById('commentOverlay').classList.toggle('show', cmPanelOpen);
    if (cmPanelOpen) {
      renderCommentPanel();
      setTimeout(() => {
        const list = document.getElementById('cmList');
        list.scrollTop = list.scrollHeight;
      }, 50);
    }
  }

  /* 패널 전체 렌더 */
  function renderCommentPanel() {
    renderCmTabs();
    renderCmList();
    updateFabBadge();
    document.getElementById('cmPanelTitle').textContent =
      (CM_SCREEN_LABELS[cmCurrentScreen] || cmCurrentScreen) + ' 댓글';
  }

  /* 화면 탭 렌더 */
  function renderCmTabs() {
    const all = getComments();
    const tabs = document.getElementById('cmScreenTabs');
    tabs.innerHTML = Object.entries(CM_SCREEN_LABELS).map(([k, v]) => {
      const cnt = (all[k] || []).length;
      const isActive = k === cmCurrentScreen;
      return `<button class="cm-tab${isActive ? ' active' : ''}" onclick="cmSwitchScreen('${k}')">
        ${v}${cnt > 0 ? `<span class="cm-tab-count">${cnt}</span>` : ''}
      </button>`;
    }).join('');
  }

  /* 화면 탭 클릭 */
  function cmSwitchScreen(screen) {
    cmCurrentScreen = screen;
    renderCommentPanel();
    document.getElementById('cmList').scrollTop = 0;
  }

  /* 댓글 목록 렌더 */
  function renderCmList() {
    const comments = getScreenComments(cmCurrentScreen);
    const list = document.getElementById('cmList');
    const authState = getAuthState();
    const currentUserId = authState && authState.loggedIn ? authState.id : null;

    // 작성자 레이블 업데이트
    const labelEl = document.getElementById('cmCurrentUserLabel');
    if (labelEl) {
      if (authState && authState.loggedIn) {
        labelEl.textContent = authState.name + ' (' + (authState.role === 'admin' ? '관리자' : '직원') + ')';
        labelEl.style.color = 'var(--primary)';
      } else {
        labelEl.textContent = '로그인 필요';
        labelEl.style.color = 'var(--gray-400)';
      }
    }

    if (comments.length === 0) {
      list.innerHTML = `<div class="cm-empty">
        <div class="cm-empty-icon">💬</div>
        아직 댓글이 없습니다.<br>
        <span style="font-size:11px;opacity:.7;display:block;margin-top:6px">
          이 페이지의 첫 댓글을 남겨보세요!
        </span>
      </div>`;
      return;
    }

    // 아바타 색상 팔레트 (userId 기반)
    const AVATAR_PALETTE = ['#FF2D1F','#2563EB','#10B981','#8B5CF6','#F59E0B','#06B6D4','#EC4899','#14B8A6'];
    function getAvatarColor(userId) {
      const preset = APPROVED_EMPLOYEES.find(e => e.id === userId);
      if (preset) return preset.color;
      let hash = 0;
      for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
      return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
    }

    list.innerHTML = comments.map(c => {
      const isOwn = c.userId === currentUserId;
      const avatarColor = getAvatarColor(c.userId);
      return `<div class="cm-item${isOwn ? ' own' : ''}">
        <div class="cm-avatar" style="background:${avatarColor}">${c.userName.charAt(0)}</div>
        <div class="cm-body">
          <div class="cm-meta">
            <span class="cm-name">${escCm(c.userName)}</span>
            <span class="cm-role">${escCm(c.userRole)}</span>
            <span class="cm-time">${formatCmTime(c.ts)}</span>
          </div>
          <div class="cm-text">${escCm(c.text).replace(/\n/g,'<br>')}</div>
          ${isOwn ? `<div class="cm-actions"><button class="cm-del" onclick="deleteComment('${c.id}','${cmCurrentScreen}')">삭제</button></div>` : ''}
        </div>
      </div>`;
    }).join('');

    list.scrollTop = list.scrollHeight;
  }

  /* 댓글 작성 */
  function postComment() {
    const input = document.getElementById('cmInput');
    const text = input.value.trim();
    if (!text) { input.focus(); return; }

    const authState = getAuthState();
    if (!authState || !authState.loggedIn) {
      showToast('💬 로그인 후 댓글을 작성할 수 있습니다');
      openLoginModal && openLoginModal();
      return;
    }

    const user = {
      id: authState.id,
      name: authState.name,
      role: authState.role === 'admin' ? '관리자' : '직원'
    };

    const all = getComments();
    if (!all[cmCurrentScreen]) all[cmCurrentScreen] = [];

    all[cmCurrentScreen].push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      screen: cmCurrentScreen,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      text,
      ts: Date.now()
    });

    saveComments(all);
    input.value = '';
    renderCommentPanel();
    showToast(`💬 ${user.name}님이 댓글을 남겼습니다`);
  }

  /* 댓글 삭제 */
  function deleteComment(id, screen) {
    const all = getComments();
    if (!all[screen]) return;
    all[screen] = all[screen].filter(c => c.id !== id);
    saveComments(all);
    renderCommentPanel();
  }

  /* 시간 포맷 */
  function formatCmTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000)     return '방금';
    if (diff < 3600000)   return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000)  return Math.floor(diff / 3600000) + '시간 전';
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  /* HTML 이스케이프 */
  function escCm(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* FAB 뱃지 업데이트 */
  function updateFabBadge() {
    const all = getComments();
    let total = 0;
    Object.values(all).forEach(arr => { total += (arr || []).length; });
    const badge = document.getElementById('commentFabBadge');
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : total;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  /* 초기화 */
  (function initCommentSystem() {
    // 현재 로그인 사용자 이름 표시
    const labelEl = document.getElementById('cmCurrentUserLabel');
    if (labelEl) {
      const authState = getAuthState();
      if (authState && authState.loggedIn) {
        labelEl.textContent = authState.name + ' (' + (authState.role === 'admin' ? '관리자' : '직원') + ')';
        labelEl.style.color = 'var(--primary)';
      } else {
        labelEl.textContent = '로그인 필요';
        labelEl.style.color = 'var(--gray-400)';
      }
    }
    updateFabBadge();
  })();

  /* ══════════════════════════════════════════════
     QUOTE SCREEN — 견적 화면
  ══════════════════════════════════════════════ */
  const QUOTE_ITEMS_DATA = [
    { name:'POS 일체형 PC',      spec:'Intel N5095 / 15.6" 터치',    unit:1100000, qty:5 },
    { name:'서버용 PC',           spec:'Ryzen5 4650G / SSD 256G',      unit:700000,  qty:1 },
    { name:'고정스캐너 마젤란 8100', spec:'360° 전방향 인식',          unit:1200000, qty:2 },
    { name:'영수프린터 SRP-330',  spec:'58mm 감열지',                  unit:250000,  qty:5 },
    { name:'전자저울 SM-100',     spec:'라벨 프린터 내장',              unit:650000,  qty:3 },
    { name:'설치 / 데이터 이관',  spec:'1년 무상 AS 포함',             unit:1500000, qty:1 },
  ];

  function renderQuote() {
    const list = document.getElementById('quoteItemList');
    const summary = document.getElementById('quoteSummary');
    if (!list || !summary) return;

    let subtotal = 0;
    list.innerHTML = QUOTE_ITEMS_DATA.map((it, idx) => {
      const lineTotal = it.unit * it.qty;
      subtotal += lineTotal;
      return `
        <div class="quote-item" style="display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--gray-200)">
          <div style="flex:1; min-width:0">
            <div style="font-weight:700; font-size:13.5px">${it.name}</div>
            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px">${it.spec}</div>
          </div>
          <div style="display:flex; align-items:center; gap:0; border:1px solid var(--gray-200); border-radius:8px; overflow:hidden; flex-shrink:0">
            <button onclick="changeQty(${idx},-1)" style="width:28px; height:28px; border:0; background:var(--gray-50); cursor:pointer; font-size:14px; color:var(--text-secondary)">−</button>
            <span style="width:32px; text-align:center; font-size:13px; font-weight:700; font-variant-numeric:tabular-nums">${it.qty}</span>
            <button onclick="changeQty(${idx},+1)" style="width:28px; height:28px; border:0; background:var(--gray-50); cursor:pointer; font-size:14px; color:var(--text-secondary)">＋</button>
          </div>
          <div style="width:90px; text-align:right; font-size:12px; color:var(--text-secondary); flex-shrink:0">₩${it.unit.toLocaleString()}</div>
          <div style="width:100px; text-align:right; font-size:14px; font-weight:700; flex-shrink:0">₩${lineTotal.toLocaleString()}</div>
          <button onclick="removeQuoteItem(${idx})" style="background:transparent; border:0; color:var(--text-secondary); cursor:pointer; font-size:14px; padding:4px; flex-shrink:0">✕</button>
        </div>`;
    }).join('');

    const vat = Math.round(subtotal * 0.1);
    const total = subtotal + vat;
    summary.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:13px">
        <span style="color:var(--text-secondary)">공급가액</span>
        <span style="font-weight:600">₩${subtotal.toLocaleString()}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:13px; border-bottom:1px dashed var(--gray-200)">
        <span style="color:var(--text-secondary)">부가세 (10%)</span>
        <span style="font-weight:600">₩${vat.toLocaleString()}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0 4px">
        <span style="font-size:14px; font-weight:800">합계</span>
        <span style="font-size:22px; font-weight:900; color:var(--danger)">₩${total.toLocaleString()}</span>
      </div>`;
  }

  function changeQty(idx, delta) {
    QUOTE_ITEMS_DATA[idx].qty = Math.max(0, QUOTE_ITEMS_DATA[idx].qty + delta);
    renderQuote();
  }

  function removeQuoteItem(idx) {
    QUOTE_ITEMS_DATA.splice(idx, 1);
    renderQuote();
  }

  function addQuoteItemPrompt() {
    const name = prompt('품목명을 입력하세요:');
    if (!name) return;
    const priceStr = prompt('단가 (원, 숫자만):');
    const unit = parseInt(priceStr) || 0;
    if (unit <= 0) { alert('올바른 단가를 입력하세요.'); return; }
    QUOTE_ITEMS_DATA.push({ name, spec:'', unit, qty:1 });
    renderQuote();
  }

  /* ══════════════════════════════════════════════
     JOBS SCREEN — 작업 목록 필터
  ══════════════════════════════════════════════ */
  function filterJobs(el, type) {
    // 칩 active 상태
    document.querySelectorAll('#screen-jobs .filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');

    // 카드 표시/숨김
    document.querySelectorAll('#screen-jobs .job-card').forEach(card => {
      if (type === '전체') {
        card.style.display = '';
      } else if (type === '완료') {
        const badge = card.querySelector('.status-badge');
        card.style.display = (badge && badge.textContent.trim() === '완료') ? '' : 'none';
      } else {
        card.style.display = (card.dataset.jobtype === type) ? '' : 'none';
      }
    });
  }

  /* ══════════════════════════════════════════════
     EQUIPMENT SCREEN — 장비 재고 필터 + 검색
  ══════════════════════════════════════════════ */
  let equipFilterActive = false;
  let equipSearchQuery = '';

  function applyEquipFilters() {
    document.querySelectorAll('#screen-equipment .equip-item').forEach(item => {
      const stockOk = !equipFilterActive || item.dataset.stock === 'low' || item.dataset.stock === 'out';
      const name = (item.dataset.name || item.textContent || '').toLowerCase();
      const searchOk = !equipSearchQuery || name.includes(equipSearchQuery.toLowerCase());
      item.style.display = (stockOk && searchOk) ? '' : 'none';
    });
    // 카테고리 헤더 - 아이템이 하나도 없으면 숨김
    document.querySelectorAll('#screen-equipment .equip-category').forEach(cat => {
      const visible = [...cat.querySelectorAll('.equip-item')].some(i => i.style.display !== 'none');
      cat.style.display = visible ? '' : 'none';
    });
  }

  function toggleEquipFilter(btn) {
    equipFilterActive = !equipFilterActive;
    btn.classList.toggle('active', equipFilterActive);
    btn.style.background = equipFilterActive ? 'var(--primary)' : '';
    btn.style.color = equipFilterActive ? '#fff' : '';
    btn.style.borderColor = equipFilterActive ? 'var(--primary)' : '';
    applyEquipFilters();
  }

  function searchEquip(query) {
    equipSearchQuery = query;
    applyEquipFilters();
  }

  /* ══════════════════════════════════════════════
     STORES — localStorage 헬퍼
  ══════════════════════════════════════════════ */
  // ⚡ 파싱 캐시 — raw 문자열을 키로 캐시. 어떤 경로로든 ns_stores 가 바뀌면 raw 가 달라져
  //   자동 무효화(별도 hook 불필요). JSON.parse(~1MB) 반복 비용 제거. .slice() 로 배열 변형 격리.
  let _storesCacheRaw = null, _storesCacheArr = [];
  function getStores() {
    let raw; try { raw = localStorage.getItem('ns_stores') || '[]'; } catch { return []; }
    if (raw === _storesCacheRaw) return _storesCacheArr.slice();
    _storesCacheRaw = raw;
    try { _storesCacheArr = JSON.parse(raw); } catch { _storesCacheArr = []; }
    if (!Array.isArray(_storesCacheArr)) _storesCacheArr = [];
    return _storesCacheArr.slice();
  }
  /* dirty flag — 로컬에서 사용자가 수정한 적 있을 때만 true
     sync 로 받은 데이터를 save 할 땐 dirty=false 유지 → 불필요한 echo push 차단
     이게 race condition (KV PoP cache) 의 가장 큰 원인이었음 */
  let _storesDirty = false;
  function markStoresDirty() { _storesDirty = true; }
  window.markStoresDirty = markStoresDirty;

  function saveStores(arr, opts) {
    opts = opts || {};
    localStorage.setItem('ns_stores', JSON.stringify(arr));
    scheduleAutoBackup();
    // fromSync: true 면 dirty 안 켜고 push 스케줄 안 함 (sync 후 echo push 방지)
    if (opts.fromSync) return;
    // 일반 save = 사용자 편집 → dirty + push 예약
    _storesDirty = true;
    schedulePushStoresToCloud();
  }
  // 단일 매장 인-플레이스 업데이트 + 저장 (id 기반)
  function saveStoreInPlace(store) {
    if (!store || !store.id) return false;
    const arr = getStores();
    const idx = arr.findIndex(s => s.id === store.id);
    if (idx < 0) return false;
    arr[idx] = store;
    saveStores(arr);
    return true;
  }
  window.saveStoreInPlace = saveStoreInPlace;
  // 점포 데이터를 클라우드에 자동 푸시 — dirty=true 일 때만
  let _pushStoresTimer = null;
  function schedulePushStoresToCloud() {
    if (_pushStoresTimer) clearTimeout(_pushStoresTimer);
    _pushStoresTimer = setTimeout(() => {
      if (!_storesDirty) return;   // 변경 없으면 push 안 함 (재발방지 핵심)
      pushStoresToCloud();
    }, 1500);
  }
  async function pushStoresToCloud(opts) {
    opts = opts || {};
    // 강제 호출이 아니고 dirty 가 false 면 skip (admin 'force sync' 버튼은 force:true)
    if (!opts.force && !_storesDirty) {
      if (opts.toast && typeof showToast === 'function') showToast('변경 사항 없음 — push 생략');
      return { ok:true, skipped:true };
    }
    const stores = (function(){ try { return JSON.parse(localStorage.getItem('ns_stores')||'[]'); } catch { return []; } })();
    const body = JSON.stringify({ stores, source:'client' });
    // content-skip
    const h = window._fastHash(body);
    if (!opts.force && window._lastStoresPushHash === h) {
      _storesDirty = false;
      return { ok:true, skipped:true, count: stores.length };
    }
    try {
      const res = await fetch('/api/sync', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body,
      });
      if (!res.ok) {
        let txt = ''; try { txt = await res.text(); } catch(_){}
        const limitHit = /KV put.*limit exceeded/i.test(txt);
        if (limitHit && !window._kvLimitToastShown) {
          window._kvLimitToastShown = true;
          try { if (typeof showToast === 'function') showToast('⚠ 클라우드 동기화 한도 초과 — 한국 시간 익일 09:00 자동 해제 (로컬 저장은 정상)'); } catch(_){}
        } else if (opts.toast && typeof showToast === 'function') showToast(`⚠ 점포 클라우드 푸시 실패 (${res.status}): ${txt.slice(0,80)}`);
        return { ok:false, status:res.status, limitHit };
      }
      const data = await res.json();
      _storesDirty = false;
      window._lastStoresPushHash = h;
      if (opts.toast && typeof showToast === 'function') showToast(`☁ 점포 클라우드 동기화 완료 (${data.count}건)`);
      return { ok:true, ...data };
    } catch(e) {
      if (opts.toast && typeof showToast === 'function') showToast('⚠ 점포 클라우드 푸시 실패 (네트워크)');
      return { ok:false, error:String(e) };
    }
  }
  window.pushStoresToCloud = pushStoresToCloud;

  /* ══════════════════════════════════════════════
     JOBS — localStorage 헬퍼
  ══════════════════════════════════════════════ */
  // ⚡ 파싱 캐시 — raw 문자열 키. ns_jobs 변경 시 raw 가 달라져 자동 무효화. JSON.parse(~400KB) 반복 제거.
  let _jobsCacheRaw = null, _jobsCacheArr = [];
  function getJobs() {
    let raw; try { raw = localStorage.getItem('ns_jobs') || '[]'; } catch { return []; }
    if (raw === _jobsCacheRaw) return _jobsCacheArr.slice();
    _jobsCacheRaw = raw;
    try { _jobsCacheArr = JSON.parse(raw); } catch { _jobsCacheArr = []; }
    if (!Array.isArray(_jobsCacheArr)) _jobsCacheArr = [];
    return _jobsCacheArr.slice();
  }
  // 🕐 per-job mtime 자동 스탬프 — sync 시 cloud-pulled 데이터를 snapshot 에 기록해 둠으로써
  //   다음 saveJobs 호출 시 "변경된 job 만" updatedAt 갱신 → 서버 머지가 정확히 동작.
  //   (구조 변경: wholesale POST → per-job upsert by mtime, 2026-05-22)
  function _jobHashForMtime(j) {
    if (!j || typeof j !== 'object') return '';
    // updatedAt 자체는 hash 에서 제외 — 스탬프가 다음 hash 를 바꿔서 무한 재스탬프 방지
    const out = {};
    const keys = Object.keys(j).sort();
    for (const k of keys) {
      if (k === 'updatedAt') continue;
      out[k] = j[k];
    }
    // ⚡ 짧은 해시 저장 (통짜 JSON 금지) — ns_jobs_snap 이 jobs 2벌이 돼 모바일 quota 압박하던 문제 해결
    try { const s = JSON.stringify(out); return (window._fastHash ? window._fastHash(s) : String(s.length)); } catch { return ''; }
  }
  function _loadJobsSnap() {
    try { return JSON.parse(localStorage.getItem('ns_jobs_snap') || '{}') || {}; } catch { return {}; }
  }
  function _saveJobsSnap(snap) {
    try { localStorage.setItem('ns_jobs_snap', JSON.stringify(snap || {})); } catch(_){}
  }
  // sync 경로에서 호출 — 현재 localStorage 의 jobs 상태를 snapshot 에 동기화.
  //   결과: 다음 saveJobs 가 cloud-pulled 데이터를 "변경됨" 으로 오인하지 않음.
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
  window._refreshJobsSnap = _refreshJobsSnap;

  function saveJobs(arr) {
    // 🛡 id 기준 dedup — 중복 등록 사고 방어 (어디서든 같은 id 가 두 번 들어가면 첫 항목만 유지)
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
    // 🕐 변경 감지 + 자동 mtime 스탬프 — 변경된 job 만 updatedAt 갱신
    try {
      const snap = _loadJobsSnap();
      const newSnap = {};
      const now = new Date().toISOString();
      let stamped = 0;
      for (const j of (Array.isArray(safe) ? safe : [])) {
        if (!j || !j.id) continue;
        const h = _jobHashForMtime(j);
        const prev = snap[String(j.id)];
        if (prev !== h) {
          j.updatedAt = now;
          stamped++;
        }
        // hash 재계산 — updatedAt 은 제외되므로 동일 값
        newSnap[String(j.id)] = h;
      }
      _saveJobsSnap(newSnap);
      if (stamped > 0) console.debug('[saveJobs] mtime 스탬프', stamped, '건');
    } catch(e) { console.warn('[saveJobs mtime]', e); }
    localStorage.setItem('ns_jobs', JSON.stringify(safe));
    scheduleAutoBackup();
    schedulePushJobsToCloud();
  }
  // 동일 id 의 로컬/클라우드 job 을 thread/memos/equipment 단위로 합집합 머지
  // — 데이터 손실 방지: cloud 가 stale 해서 thread ROOT 가 줄어드는 사고 차단
  /* ════════════════════════════════════════════════════════════════════════
   * 🪦 TOMBSTONE 시스템 — 삭제된 항목이 클라우드 유니온 머지로 부활하는 사고 차단
   *
   * 문제: syncJobsFromCloud() 는 cloud + local 의 union 머지 (id 기준 byId Map +
   *      _mergeJobRecord 의 thread union). 사용자가 로컬에서 항목을 삭제해도
   *      다른 PC/탭의 stale cloud 가 그대로 가지고 있으면 다음 sync 에서 부활.
   *
   * 해결: ns_tombstones 에 삭제 기록 (jobId / threadId) 을 30일간 유지.
   *      _mergeJobRecord / syncJobsFromCloud 에서 tombstone 항목을 항상 차단.
   *
   * 사용:
   *   _addTombstone('thread', threadId, jobId)   // thread 노드 삭제
   *   _addTombstone('thread-children', rootId, jobId)  // ROOT 의 모든 자식까지 삭제
   *   _addTombstone('job', jobId)                // job 자체 삭제
   *   _isTombstoned('thread', threadId, jobId)
   * ════════════════════════════════════════════════════════════════════════ */
  function _addTombstone(type, id, jobId) {
    if (!type || !id) return;
    try {
      const key = 'ns_tombstones';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      // 🛡 중복 차단 — 같은 (type, id, jobId) 가 이미 있으면 push 하지 않음
      //    (이전: syncFromCloud 가 매초 deleted_stores 를 무조건 _addTombstone 호출 →
      //     ns_tombstones 가 매초 +N 건씩 누적 → localStorage I/O 부담 + 페이지 지연)
      const targetJob = jobId || null;
      const dup = list.some(t => t.type === type && t.id === id
                                  && (t.jobId || null) === targetJob);
      if (!dup) {
        list.push({ type, id, jobId: targetJob, ts: Date.now() });
      }
      // 30 일 이상된 항목 자동 정리 (cloud 측에서도 그 사이 정합성이 맞춰졌을 가능성)
      const cutoff = Date.now() - 30*24*3600*1000;
      const fresh = list.filter(t => (t.ts||0) >= cutoff);
      // 변경 있을 때만 setItem (불필요한 I/O 회피)
      if (!dup || fresh.length !== list.length) {
        localStorage.setItem(key, JSON.stringify(fresh));
      }
    } catch(e) { console.warn('[_addTombstone]', e); }
    // 🛡 cloud deleted_jobs 레지스트리에도 등록 — 다른 기기의 stale localStorage 가
    //    wholesale POST 로 부활시키는 문제 차단 (샤르르 부활 루프, 2026-05-22)
    if (type === 'job' && id) {
      try { _cloudDeleteJobIds([id]); } catch(_){}   // 토큰 보유 시 즉시 등록
      // 토큰 없어도 jobTombstones 동봉 push 로 전파되도록 push 예약 (reconcile 완료 후 동봉됨)
      try { if (typeof schedulePushJobsToCloud === 'function') schedulePushJobsToCloud(); } catch(_){}
    }
  }
  // 클라우드 deleted_jobs 등록 — 토큰 없으면 silent skip (서버측 jobs.js 가 추가 방어선)
  async function _cloudDeleteJobIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    let token = '';
    try { token = (typeof getCloudSyncToken === 'function') ? getCloudSyncToken() : ''; } catch(_){}
    if (!token) return;  // 토큰 없으면 server-side 필터에만 의존
    try {
      await fetch('/api/admin-delete', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ jobIds: ids, reason: 'client-tombstone', bumpToken: true }),
      });
    } catch (e) {
      console.warn('[_cloudDeleteJobIds] failed', e);
    }
  }
  window._cloudDeleteJobIds = _cloudDeleteJobIds;
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
    if (_isTombstoned('thread', threadId, jobId)) return true;
    // ROOT 가 삭제된 경우 (thread-children 으로 자식까지 차단) — 자식인지 판단은 호출부에서 처리
    return false;
  }
  function _isThreadChildOfTombstonedRoot(parentId, jobId) {
    if (!parentId) return false;
    return _isTombstoned('thread-children', parentId, jobId);
  }
  window._addTombstone = _addTombstone;
  window._isTombstoned = _isTombstoned;

  /* thread 콘텐츠 기반 중복 제거 — threadId 가 달라도 (ts·text·status·author·ROOT여부) 동일하면 1개로.
     비멱등 마이그레이션이 재-prefix 한 threadId(TR-mig-X-TR-mig-X 등)로 생긴 중복을 치유.
     드롭된 항목의 threadId 를 살아남은 항목으로 parentId 재매핑(고아 child 방지). */
  function _dedupeThread(thread) {
    if (!Array.isArray(thread) || thread.length < 2) return thread;
    const keyOf = e => [e.ts||'', e.text||'', e.status||'', e.author||'', (e.parentId==null?'R':'C')].join('');
    const seen = new Map();    // key -> survivor entry
    const remap = new Map();   // dropped threadId -> survivor threadId
    const out = [];
    for (const e of thread) {
      if (!e) continue;
      const k = keyOf(e);
      const surv = seen.get(k);
      if (surv) {
        if (e.threadId && surv.threadId && e.threadId !== surv.threadId) remap.set(e.threadId, surv.threadId);
        continue;   // 중복 → 드롭
      }
      seen.set(k, e);
      out.push(e);
    }
    if (remap.size) {
      out.forEach(e => { if (e.parentId && remap.has(e.parentId)) e.parentId = remap.get(e.parentId); });
    }
    return out;
  }
  window._dedupeThread = _dedupeThread;

  function _mergeJobRecord(localJob, cloudJob) {
    if (!localJob) {
      // 🪦 cloud only — localJob 이 없는 케이스(예: cascade 삭제 직후) 라도
      //   thread tombstone 은 반드시 적용. 적용 없이 cloudJob 을 그대로 반환하면
      //   사용자가 삭제한 ROOT 가 다음 sync 마다 영구 부활하는 사고 발생.
      if (cloudJob && Array.isArray(cloudJob.thread) && cloudJob.thread.length) {
        const jobIdForTomb = cloudJob.id || null;
        const filtered = cloudJob.thread.filter(e => {
          if (!e) return false;
          if (e.threadId && _isThreadTombstoned(e.threadId, jobIdForTomb)) return false;
          if (e.parentId && _isThreadChildOfTombstonedRoot(e.parentId, jobIdForTomb)) return false;
          return true;
        });
        const deduped = _dedupeThread(filtered);
        if (deduped.length !== cloudJob.thread.length) {
          return Object.assign({}, cloudJob, { thread: deduped });
        }
      }
      return cloudJob;
    }
    if (!cloudJob) return localJob;
    // base = mtime 최신 레코드의 scalar 가 이기도록 (2026-06-17 버그픽스).
    //   이전엔 무조건 Object.assign({},cloud,local) 로 local-wins 였는데, 다른 기기가
    //   클라우드의 새 편집값(예: 수정된 금액)을 pull 해도 자기 stale local 이 덮어써
    //   영영 반영 안 되던 문제. 더 최신 mtime 쪽 scalar 를 base 로 선택.
    //   (thread/memos/attachments union + 완료 sticky 는 아래에서 재적용 → base 방향 무관하게 보존)
    const _mMs = (j) => { const v = j && (j.updatedAt ?? j.lastEditedAt ?? j.createdAt); if (v==null||v==='') return 0; if (typeof v==='number') return v; const s=String(v); if (/^\d+$/.test(s)) return Number(s); const p=Date.parse(s); return Number.isFinite(p)?p:0; };
    const merged = (_mMs(cloudJob) > _mMs(localJob))
      ? Object.assign({}, localJob, cloudJob)   // cloud 가 더 최신 → cloud scalar 우선
      : Object.assign({}, cloudJob, localJob);  // local 이 최신/동일 → local 우선(기존 동작)
    // ── thread: threadId 우선, 없으면 ts+text 키로 union
    //   같은 threadId 라도 attachments 는 양쪽 union (PC 간 첨부 동기화)
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
          // 같은 ROOT/child — attachments 만 union, 본문은 첫 진입(cloud) 유지
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
    // 🪦 tombstone 적용 — 삭제된 thread / ROOT 자식 차단
    const jobIdForTomb = (localJob && localJob.id) || (cloudJob && cloudJob.id) || null;
    _merged = _merged.filter(e => {
      if (!e) return false;
      if (e.threadId && _isThreadTombstoned(e.threadId, jobIdForTomb)) return false;
      if (e.parentId && _isThreadChildOfTombstonedRoot(e.parentId, jobIdForTomb)) return false;
      return true;
    });
    merged.thread = _dedupeThread(_merged.sort((a,b) => String(a.ts||'').localeCompare(String(b.ts||''))));
    // ── memos: at+text union
    const mSeen = new Map();
    [...(cloudJob.memos||[]), ...(localJob.memos||[])].forEach(m => {
      if (!m) return;
      const k = (m.at||'') + '|' + (m.text||'');
      if (!mSeen.has(k)) mSeen.set(k, m);
    });
    if (mSeen.size > 0 || (cloudJob.memos||localJob.memos)) merged.memos = [...mSeen.values()];
    // ── vandocs: local 의 non-empty 우선
    if (localJob.vandocs || cloudJob.vandocs) {
      merged.vandocs = Object.assign({}, cloudJob.vandocs||{}, localJob.vandocs||{});
    }
    // ── job 레벨 attachments: key 기준 union (PC 간 첨부 동기화)
    //   Object.assign 의 blanket override 때문에 한쪽이 빈 배열이면 사라지는 문제 차단.
    //   다른 PC 에서 올린 첨부도 보이도록, key 별 union 으로 머지.
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
    // ── 완료 sticky (2026-06-11 보강): completed 플래그 OR 완료계열 status 가 한쪽에라도
    //   있으면 완료 유지. 예전엔 completed===true 플래그가 있을 때만 status 를 보정했는데,
    //   옛 완료 데이터(status='완료'인데 completed 플래그 없음)가 다수(소모품 132건 등)라
    //   Object.assign({},cloud,local) 로 local 의 stale '진행중' 이 cloud '완료' 를 계속
    //   덮어써, 동기화해도 기기마다 진행중 카운트가 영원히 수렴 안 하던 문제. 이제 status 도
    //   완료 신호로 인정 → stale '진행중' 이 cloud '완료' 를 못 덮음. (CLAUDE.md 완료 sticky)
    const _isDoneStatusM = (s) => { s = String(s||''); return s === '완료' || s === '처리완료' || s === 'done'; };
    const _localDone = !!localJob.completed || _isDoneStatusM(localJob.status);
    const _cloudDone = !!cloudJob.completed || _isDoneStatusM(cloudJob.status);
    if (_localDone || _cloudDone) {
      merged.completed = true;
      const cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(merged) : '';
      const doneStr = (cat === 'as') ? '처리완료' : '완료';
      if (!_isDoneStatusM(merged.status)) merged.status = doneStr;
      if (localJob.completed && localJob.doneAt) merged.doneAt = localJob.doneAt;
      else if (cloudJob.completed && cloudJob.doneAt) merged.doneAt = cloudJob.doneAt;
      merged.completedAt = localJob.completedAt || cloudJob.completedAt || merged.completedAt || '';
    } else {
      merged.completed = !!(localJob.completed || cloudJob.completed);
    }
    // ── 매장 연결 sticky (2026-07-06): storeId/storeName 은 일반 mtime 이 아니라
    //   가장 최근의 명시적 연결/해제(linkedAt/unlinkedAt)를 따른다. 처리 중인 stale 사본이
    //   연결(예: 미등록→퍼스트카드)을 되돌리던 리버트 차단. (완료 sticky 와 동일 원리 — 자가치유)
    {
      const _act = (j) => Math.max(Number(j && j.linkedAt) || 0, Number(j && j.unlinkedAt) || 0);
      const la = _act(localJob), ca = _act(cloudJob);
      if (la || ca) {
        const win = (la >= ca) ? localJob : cloudJob;   // 최근 연결/해제 액션 쪽이 매장필드 결정
        merged.storeId = win.storeId;
        merged.storeName = win.storeName;
        merged.store = win.store;
        if ('unregistered' in win) merged.unregistered = win.unregistered;
        if ('linkedAt' in win) merged.linkedAt = win.linkedAt;
        if ('unlinkedAt' in win) merged.unlinkedAt = win.unlinkedAt;
        if ('originalStoreName' in win) merged.originalStoreName = win.originalStoreName;
        if (win.address) merged.address = win.address;  // 연결로 채운 주소 유지(빈 값으론 안 덮음)
      }
    }
    return merged;
  }
  window._mergeJobRecord = _mergeJobRecord;

  // 클라우드 ↔ 로컬 작업 동기화 — 다른 PC/모바일도 동일 작업 보이도록
  let _lastJobsAutoFetch = 0;
  async function syncJobsFromCloud(opts) {
    opts = opts || {};
    // ⚡ A-2 자동 루프 중복 제거 — 자동 호출(opts.auto)만 12초 throttle. 수동/강제는 항상 실행.
    if (opts.auto) { const _n = Date.now(); if (_n - _lastJobsAutoFetch < 12000) return; _lastJobsAutoFetch = _n; }
    try {
      // ⚡ A-3 ETag/304 — 변경 없으면 본문(수백 KB) 재다운로드 회피
      const _inm = (function(){ try { return localStorage.getItem('ns_jobs_etag') || ''; } catch { return ''; } })();
      const res = await fetch('/api/jobs', { cache: 'no-store', headers: _inm ? { 'If-None-Match': _inm } : undefined });
      if (res.status === 304) return;   // 클라우드 변경 없음 → 그대로
      if (!res.ok) return;
      const _newEtag = res.headers.get('ETag') || '';
      const data = await res.json();
      // 🔁 resync_token — 서버가 데이터 정합화 필요를 알리는 신호
      //   로컬 토큰과 다르면 → force-resync (localStorage 를 cloud 로 강제 덮어쓰기)
      //   서버는 admin-delete / 머지 작업 후 토큰 bump → 모든 기기 자동 정합화
      const cloudToken = String(data?.resyncToken || '');
      const localToken = (function(){ try { return localStorage.getItem('ns_resync_token') || ''; } catch { return ''; } })();
      if (cloudToken && cloudToken !== localToken) {
        // force resync: cloud 가 진실. 로컬 jobs 를 cloud + deleted 적용 후 강제 덮어쓰기
        const cloudJobsRaw = Array.isArray(data?.jobs) ? data.jobs : [];
        const cloudDeletedRaw = Array.isArray(data?.deleted) ? data.deleted : [];
        const delIds = new Set(cloudDeletedRaw.map(e => String(e && e.id || '')).filter(Boolean));
        const clean = cloudJobsRaw.filter(j => j && j.id && !delIds.has(j.id));
        try { localStorage.setItem('ns_jobs', JSON.stringify(clean)); } catch(_){}
        try { localStorage.setItem('ns_resync_token', cloudToken); } catch(_){}
        // 🕐 cloud-pulled 상태로 snapshot 동기화 — 다음 saveJobs 가 cloud job 을 "변경됨" 으로 오인 안 함
        try { _refreshJobsSnap(); } catch(_){}
        try { _selfHealJobStatuses(); } catch(_){}   // 🩹 status 자동 승격(모바일과 동일)
        // deleted 도 tombstone 등록
        for (const id of delIds) { try { _addTombstone('job', id); } catch(_){} }
        // push 캐시 리셋
        window._lastJobsPushHash = null;
        // hub 자동 갱신
        try { if (typeof window._refreshAllHubsAfterThread === 'function') window._refreshAllHubsAfterThread(); } catch(_){}
        if (typeof showToast === 'function') showToast(`🔄 데이터 자동 정합화 (${clean.length}건)`);
        try { if (_newEtag) localStorage.setItem('ns_jobs_etag', _newEtag); } catch(_){}
        return;
      }
      const local = (function(){ try { return JSON.parse(localStorage.getItem('ns_jobs')||'[]'); } catch { return []; } })();
      const cloud = Array.isArray(data?.jobs) ? data.jobs : [];
      // 🪦 서버 측 삭제 레지스트리 — admin-delete 로 다른 기기에서 지운 항목을
      //    이 기기에서도 자동 제거 + 로컬 tombstone 등록 (재발 차단)
      //    형식: [{ id, deletedAt, reason }]
      const cloudDeleted = Array.isArray(data?.deleted) ? data.deleted : [];
      const cloudDeletedIds = new Set(cloudDeleted.map(e => String(e && e.id || '')).filter(Boolean));
      let serverTombsAdded = 0;
      if (cloudDeletedIds.size > 0) {
        for (const id of cloudDeletedIds) {
          if (!_isJobTombstoned(id)) {
            try { _addTombstone('job', id); serverTombsAdded++; } catch(_){}
          }
        }
      }
      // 🪦 서버측 thread tombstone 레지스트리 (보강 B, 2026-05-28) — 다른 기기에서 삭제한 thread 를
      //    이 기기에도 자동 등록. _addTombstone 의 중복 차단으로 누적 폭주 없음.
      const cloudDeletedThreads = Array.isArray(data?.deletedThreads) ? data.deletedThreads : [];
      const cloudDeletedThreadChildren = Array.isArray(data?.deletedThreadChildren) ? data.deletedThreadChildren : [];
      let serverThreadTombsAdded = 0;
      for (const e of cloudDeletedThreads) {
        if (e && e.threadId) {
          try { _addTombstone('thread', e.threadId, e.jobId || null); serverThreadTombsAdded++; } catch(_){}
        }
      }
      for (const e of cloudDeletedThreadChildren) {
        if (e && e.threadId) {
          try { _addTombstone('thread-children', e.threadId, e.jobId || null); serverThreadTombsAdded++; } catch(_){}
        }
      }
      // 로컬과 머지: id 기준 합집합 — 같은 id 는 thread/memos union 으로 안전 머지
      // (이전 정책: cloud 가 무조건 우선 → stale cloud 가 로컬 thread 를 지우는 사고 발생)
      const byId = new Map();
      // 🪦 로컬에 이미 tombstone 된 OR 서버에서 삭제된 job 은 skip
      local.forEach(j => {
        if (!j || !j.id) return;
        if (_isJobTombstoned(j.id)) return;
        if (cloudDeletedIds.has(j.id)) return;   // 서버 삭제 항목은 즉시 제거
        byId.set(j.id, j);
      });
      let mergedCount = 0;
      cloud.forEach(j => {
        if (!j || !j.id) return;
        // ☁️ 클라우드 job 은 서버 deleted_jobs 만으로 판단 — 로컬 tombstone 무시
        // (로컬 tombstone 이 유효한 클라우드 job 을 가려서 191→184 shrink 버그 원인)
        if (cloudDeletedIds.has(j.id)) return;
        const existing = byId.get(j.id);
        if (existing) mergedCount++;
        byId.set(j.id, _mergeJobRecord(existing, j));
      });
      // byId 자체가 id 기준 dedup 이지만, 방어적으로 한 번 더 정리 (혹시 모를 동일 id 다중 값 보호)
      const dedupSeen = new Set();
      const merged = [];
      for (const j of byId.values()) {
        if (!j || !j.id) continue;
        if (dedupSeen.has(j.id)) continue;
        dedupSeen.add(j.id);
        merged.push(j);
      }
      localStorage.setItem('ns_jobs', JSON.stringify(merged));
      try { if (_newEtag) localStorage.setItem('ns_jobs_etag', _newEtag); } catch(_){}
      // 🕐 머지 결과로 snapshot 갱신 — 다음 saveJobs 가 cloud-pulled job 을 "변경됨" 으로 오인 안 함
      try { _refreshJobsSnap(); } catch(_){}
      // 🩹 thread 완료건 status 자동 승격 (모바일과 동일) — status drift 통일
      try { _selfHealJobStatuses(); } catch(_){}
      // 🛟 누락 안전망 — '로컬엔 있는데 클라우드엔 없는 최근(3일) 작업'을 id 집합으로 정확히 감지해 push.
      //   기존 count 비교(merged.length>cloud.length)는 로컬-only 와 cloud-only 가 개수로 상쇄되면 놓침.
      //   안전: 서버가 id-upsert(Map)+mtime 병합+deleted_jobs 필터 → 중복/부활/덮어쓰기 불가.
      //   조건에 최근·tombstone제외·deleted제외 → 옛 stale 대량 재등록·echo 차단.
      const _cloudIdSet = new Set(cloud.map(j => j && j.id).filter(Boolean));
      const _NOW = Date.now(), _RECENT_MS = 3*24*3600*1000;
      const _msOf = (v) => { const n = Number(v) || Date.parse(v); return n || 0; };
      const _hasUnpushedRecent = merged.some(j => j && j.id
        && !_cloudIdSet.has(j.id)
        && !cloudDeletedIds.has(j.id)
        && !_isJobTombstoned(j.id)
        && (_NOW - (_msOf(j.createdAt) || _msOf(j.updatedAt))) < _RECENT_MS);
      // 로컬이 클라우드보다 많거나, 머지 결과 thread/memos 가 cloud 와 다르거나, 최근 누락분이 있으면 즉시 푸시
      if (_hasUnpushedRecent || merged.length > cloud.length || mergedCount > 0) {
        schedulePushJobsToCloud();
      }
    } catch(e) { /* 네트워크 실패 무시 */ }
  }
  window.syncJobsFromCloud = syncJobsFromCloud;

  /* _selfHealJobStatuses — thread 전체 완료된 작업의 status 를 완료계열로 영구 승격(+push).
     모바일(m-core)과 동일 로직(SSOT) — PC만 미보유라 status drift 가 있던 것 통일.
     forward-only(미완료→완료)만, 역방향 환원 없음(CLAUDE.md 완료 환원 금지). thread=0/신규 openDate 가드. */
  function _selfHealJobStatuses() {
    try {
      const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
      let dirty = false;
      const _today = (typeof _kstNow === 'function') ? String(_kstNow()||'').slice(0,10)
                    : new Date(Date.now()+9*3600*1000).toISOString().slice(0,10);
      const _mig = (typeof window._threadMigrate === 'function') ? window._threadMigrate : (a=>a);
      const _doneFn = (typeof window._isJobDone === 'function') ? window._isJobDone : (j=>!!(j&&(j.completed||/완료/.test(j.status||''))));
      const _cls = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : (()=>'as');
      for (const j of jobs) {
        if (!j || !Array.isArray(j.thread) || j.thread.length === 0) continue;
        const norm = _mig(j.thread);
        const roots = norm.filter(e => e && e.parentId == null);
        if (roots.length === 0) continue;
        const allDone = roots.every(r => norm.some(k => k.parentId === r.threadId && k.status === '완료'));
        const cat = _cls(j);
        let blockAutoDone = false;
        if (cat === 'new') { const od = String(j.openDate||'').slice(0,10); if (od && od >= _today) blockAutoDone = true; }
        if (allDone && !blockAutoDone && !_doneFn(j)) {
          j.status = (cat === 'as') ? '처리완료' : '완료';
          j.completed = true;
          j.completedAt = j.completedAt || new Date().toISOString();
          dirty = true;
        }
      }
      if (dirty) { try { saveJobs(jobs); } catch(_){} try { schedulePushJobsToCloud(); } catch(_){} }
      return dirty;
    } catch(e) { return false; }
  }
  window._selfHealJobStatuses = _selfHealJobStatuses;

  /* 🔁 전 기기 강제 수렴 — resync_token bump (관리자 토큰 보유 기기 전용).
     실행 시 모든 기기가 다음 sync(최대 30초)에 로컬 ns_jobs 를 클라우드 기준으로 재초기화 → 즉시 일괄 수렴.
     미push 로컬 편집 소실 위험이 있으니 모든 기기가 저장·동기화된 상태에서 실행. */
  window.forceGlobalResync = async function() {
    const token = (typeof getCloudSyncToken === 'function') ? getCloudSyncToken() : '';
    if (!token) { alert('관리자 동기화 토큰이 없는 기기입니다 (이 기능은 토큰 보유 PC 전용).'); return { ok:false, reason:'no-token' }; }
    if (!confirm('전 기기 강제 수렴(resync_token bump)\n\n모든 기기가 다음 동기화 때 로컬 작업목록을 클라우드 기준으로 재초기화합니다.\n미동기(미push) 로컬 편집이 있으면 소실될 수 있으니, 모든 기기가 저장·동기화된 상태에서 실행하세요.\n\n진행할까요?')) return;
    try {
      const res = await fetch('/api/admin-delete', {
        method:'POST',
        headers:{ 'content-type':'application/json', 'authorization':'Bearer '+token },
        body: JSON.stringify({ bumpToken:true, reason:'manual-global-resync' }),
      });
      if (!res.ok) { alert('실패 ('+res.status+') — 토큰/권한을 확인하세요'); return { ok:false, status:res.status }; }
      alert('✅ resync_token bump 완료 — 모든 기기가 다음 동기화(최대 30초)에 클라우드 기준으로 자동 수렴합니다.');
      return { ok:true };
    } catch(e) { alert('실패 (네트워크): ' + e); return { ok:false, error:String(e) }; }
  };

  /* ── 🔧 작업 삭제 정합화(B) — 로컬 전용 job tombstone(클라우드 미등록) 제거 → 클라우드 union 재구성 ──
     기기마다 다른 stale 로컬 삭제표식이 클라우드 작업을 숨겨 PC↔모바일 건수가 어긋나던 문제 해소.
     클라우드 deleted_jobs 의 진짜 삭제는 보존. 1회 자동(flag) + 수동 forceReconcileJobs(). */
  async function reconcileJobTombstones() {
    let cloudDel = new Set();
    let ok = false;
    try {
      const res = await fetch('/api/jobs', { cache:'no-store' });
      if (res.ok) { const d = await res.json(); (Array.isArray(d.deleted)?d.deleted:[]).forEach(e => { const id = String((e && e.id) || e || ''); if (id) cloudDel.add(id); }); ok = true; }
    } catch(_){}
    if (!ok) return { removed: 0, ok: false };   // 클라우드 레지스트리 못 받으면 아무것도 지우지 않음(legit 삭제 보호)
    let removed = 0;
    try {
      const list = JSON.parse(localStorage.getItem('ns_tombstones') || '[]');
      const kept = list.filter(t => { if (t && t.type === 'job' && !cloudDel.has(String(t.id))) { removed++; return false; } return true; });
      if (removed) localStorage.setItem('ns_tombstones', JSON.stringify(kept));
    } catch(_){}
    try { window._lastJobsPushHash = null; } catch(_){}
    try { if (typeof syncJobsFromCloud === 'function') await syncJobsFromCloud(); } catch(_){}
    return { removed, ok: true };
  }
  window.reconcileJobTombstones = reconcileJobTombstones;
  window.forceReconcileJobs = async function() {
    const r = await reconcileJobTombstones();
    if (!r.ok) { alert('정합화 실패 — 클라우드 연결을 확인하세요 (변경 없음)'); return r; }
    try { localStorage.setItem('ns_jobtomb_reconcile_v2', String(Date.now())); } catch(_){}
    try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(_){}
    try { if (typeof hydrateAsMgmt === 'function') hydrateAsMgmt(); } catch(_){}
    alert('정합화 완료 — 로컬 전용 삭제표식 ' + r.removed + '건 제거 후 클라우드 기준 재동기화');
    return r;
  };
  /* 🔄 클라우드 기준 강제 동기화 (토큰 불필요, 이 기기 한정).
     기기별 미수렴(작업 누락·매장명 stale·로컬 전용 삭제표식 숨김) 을 한 번에 해소.
     순서: ① 로컬 전용 삭제표식 정합화 ② 로컬 작업 클라우드로 푸시(유실 방지)
           ③ 클라우드 전체 작업으로 ns_jobs 재구축(+살아있는 작업의 로컬 삭제표식 제거)
           ④ 매장 데이터 재동기화 ⑤ 새로고침 */
  window.forceCloudRepull = async function(opts) {
    opts = opts || {};
    if (!opts.silent && !confirm('이 기기를 클라우드 기준으로 강제 동기화합니다.\n\n• 로컬 작업은 먼저 클라우드로 안전하게 올린 뒤\n• 클라우드 전체를 다시 받아 화면을 맞춥니다.\n\n진행할까요?')) return;
    const toast = (m, t) => { try { if (typeof showToast === 'function') showToast(m, t); } catch(_){} };
    toast('🔄 클라우드 기준 동기화 중...', 4000);
    try { if (typeof reconcileJobTombstones === 'function') { const r = await reconcileJobTombstones(); if (r && r.ok) localStorage.setItem('ns_jobtomb_reconcile_v2', String(Date.now())); } } catch(e){ console.warn('[repull] reconcile', e); }
    try { if (typeof pushJobsToCloud === 'function') await pushJobsToCloud({ force:true }); } catch(e){ console.warn('[repull] push', e); }
    let clean = null;
    try {
      const res = await fetch('/api/jobs', { cache:'no-store' });
      const r = await res.json();
      const del = new Set((r.deleted || []).map(e => String((e && e.id) || e)));
      clean = (r.jobs || []).filter(j => j && j.id && !del.has(j.id));
    } catch(e) { console.warn('[repull] fetch', e); toast('⚠ 클라우드 작업 수신 실패 — 잠시 후 다시 시도하세요', 5000); return; }
    try {
      // 클라우드에 살아있는 작업의 로컬 삭제표식 제거 → 재구축 후 다시 숨겨지는 것 방지
      const liveIds = new Set(clean.map(j => j.id));
      let tomb = JSON.parse(localStorage.getItem('ns_tombstones') || '[]');
      tomb = tomb.filter(t => !(t && t.type === 'job' && liveIds.has(t.id)));
      localStorage.setItem('ns_tombstones', JSON.stringify(tomb));
    } catch(_){}
    try { localStorage.setItem('ns_jobs', JSON.stringify(clean)); } catch(_){}
    try { if (typeof _refreshJobsSnap === 'function') _refreshJobsSnap(); } catch(_){}
    try { if (typeof syncFromCloud === 'function') await syncFromCloud(); } catch(e){ console.warn('[repull] store sync', e); }
    toast('✅ 클라우드 기준 동기화 완료 — 새로고침합니다', 3000);
    setTimeout(() => location.reload(), 700);
  };

  setTimeout(async () => {
    try {
      const FLAG = 'ns_jobtomb_reconcile_v2';
      if (localStorage.getItem(FLAG)) return;
      const r = await reconcileJobTombstones();
      if (!r.ok) return;   // 실패 시 flag 미설정 → 다음 로드 재시도
      localStorage.setItem(FLAG, String(Date.now()));
      if (r.removed > 0) {
        console.log('[reconcile] 로컬전용 삭제표식 ' + r.removed + '건 제거 → 클라우드 union 정합화');
        try { if (typeof showToast === 'function') showToast('🔧 작업 목록 정합화 — 로컬 전용 삭제표식 ' + r.removed + '건 정리', 5000); } catch(_){}
        try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(_){}
        try { if (typeof hydrateAsMgmt === 'function') hydrateAsMgmt(); } catch(_){}
      }
    } catch(e) { console.warn('[reconcile]', e); }
  }, 4000);

