  /* ════════════════════════════════════════════════════════════════════════
   * _setThreadFor — AS/신규 thread 영구 저장
   *   ⚠ 안정화 규약 (docs/AS_ARCHITECTURE.md 참조)
   *   1. 편집 모드 (!draftMode && jobId) → saveJobs 직후 pushJobsToCloud 즉시 호출
   *      이유: 1.5s debounce 갭에서 stale cloud 가 thread 를 덮어쓰는 사고 차단
   *   2. job.completed 는 '모든 ROOT 가 완료 child 를 가질 때만' true
   *      이유: 한 ROOT 완료가 job 전체 completed 화면 다음 요청 ROOT 추가가 분리됨
   *   3. arr 는 saveJobs 호출 전 반드시 _threadMigrate 정규화
   * ════════════════════════════════════════════════════════════════════════ */
  // 🛡 고아 child 복구 — parent ROOT 가 thread 에 없는 child 의 ROOT 를 job 필드(asRequest/lineParsed/notes)에서 재구성.
  //   원인(2026-06-12 판다팜): AS 요청접수 ROOT 가 display-only 시드(저장 안 됨, app-07:807)였는데
  //   완료 child 만 그 시드 id 를 parent 로 저장 → ROOT 소실 → 요청접수·처리기록 안 보이고 status 계산 불가.
  //   완료 저장 직전 호출해 ROOT 를 thread 에 영속시킨다(시드 id 그대로 → tombstone 무관, 머지 생존).
  window._healOrphanRoots = function(job, arr) {
    if (!job || !Array.isArray(arr) || arr.length === 0) return arr;
    const rootIds = new Set(arr.filter(e => e && e.parentId == null).map(e => String(e.threadId)));
    const orphan = [];
    for (const e of arr) {
      if (e && e.parentId != null && !rootIds.has(String(e.parentId)) && orphan.indexOf(String(e.parentId)) < 0) {
        orphan.push(String(e.parentId));
      }
    }
    if (orphan.length === 0) return arr;
    const parts = [];
    if (job.lineParsed && String(job.lineParsed).trim()) parts.push('📩 ' + String(job.lineParsed).trim());
    else if (job.lineRaw && String(job.lineRaw).trim()) parts.push('📩 ' + String(job.lineRaw).trim());
    const asText = String(job.asRequest || '').trim(); if (asText && !parts.some(p => p.includes(asText))) parts.push(asText);
    const notesText = String(job.notes || '').trim(); if (notesText && !parts.some(p => p.includes(notesText))) parts.push(notesText);
    const text = parts.join('\n\n') || '(요청 내용)';
    const ts = String(job.asReceivedAt || '').slice(0,16).replace('T',' ')
            || String(job.lineMsgAt || '').slice(0,16).replace('T',' ')
            || (job.createdAt ? new Date(job.createdAt).toISOString().slice(0,16).replace('T',' ') : ((typeof _kstNow === 'function') ? _kstNow() : ''));
    const author = job.lineSender || job.engineer || job.assignee || '담당자';
    for (const pid of orphan) {
      arr.unshift({ ts, author, status: '요청접수', text, threadId: pid, parentId: null });
    }
    return arr;
  };
  function _setThreadFor(jobId, draftMode, arr, containerId) {
    const entity = _threadEntityFor(containerId);
    if (entity === 'stocktake') {
      if (!jobId) return;
      const all = (typeof window.getStocktakes === 'function') ? (window.getStocktakes() || []) : [];
      const i = all.findIndex(x => x.id === jobId);
      if (i < 0) return;
      all[i].thread = (typeof window._threadMigrate === 'function') ? window._threadMigrate(arr.slice()) : arr.slice();
      if (typeof window.saveStocktakes === 'function') window.saveStocktakes(all);
      try { if (typeof window.renderStocktakeHub === 'function') window.renderStocktakeHub(); } catch(_){}
      return;
    }
    if (draftMode) { window._jobThreadDraft = arr.slice(); return; }
    if (!jobId) return;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const i = jobs.findIndex(x => x.id === jobId);
    if (i < 0) return;
    jobs[i].thread = arr.slice();
    // 🛡 고아 child 의 ROOT 재구성 (display-only 시드 ROOT 소실 방지)
    try { if (typeof window._healOrphanRoots === 'function') window._healOrphanRoots(jobs[i], jobs[i].thread); } catch(_){}
    // job status 동기화 — 공용 헬퍼 사용 (다른 경로에서도 동일 규칙 적용 가능)
    if (typeof window._recomputeJobStatus === 'function') {
      window._recomputeJobStatus(jobs[i]);
    }
    if (typeof saveJobs === 'function') saveJobs(jobs);
    // 스레드 편집은 즉시 푸시 — 디바운스 갭에서 stale cloud 가 덮을 위험 차단
    if (!draftMode && jobId) {
      try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}
    }
    // 모든 hub/대시보드 자동 갱신 — 단순 hydrateNewopen 만 호출하면 다른 카테고리는 stale
    try { if (typeof _refreshAllHubsAfterThread === 'function') _refreshAllHubsAfterThread(); } catch(e){}
  }

  // 컨테이너별 maxRoots 설정 보존 — 첫 렌더에서 지정된 값을 재렌더 시에도 사용
  window._threadMaxRootsMap = window._threadMaxRootsMap || {};
  function _rerenderThread(containerId, jobId, draftMode) {
    const thread = _getThreadFor(jobId, draftMode, containerId);
    const maxRoots = window._threadMaxRootsMap[containerId] || 0;
    window._renderThreadGroups(containerId, thread, { editable:true, jobId: jobId||null, draftMode: !!draftMode, maxRoots });
  }

  // thread 저장(요청접수/진행/완료) 후 — 모달 뒤의 hub 리스트가 새 상태를 반영하도록 일괄 재렌더
  // 모든 카테고리 hub 가 변경됐는지 알기 어렵고 cheap 한 호출이므로 모두 호출 (각 함수는 본인 컨테이너 없으면 no-op)
  function _refreshAllHubsAfterThread() {
    const safe = (fn) => { try { if (typeof fn === 'function') fn(); } catch(e) { console.warn('[refreshAllHubs]', e); } };
    safe(window.renderNewHub);
    safe(window.renderAsHub);
    safe(window.renderVanHub);
    safe(window.renderStocktakeHub);
    safe(window.renderSuppliesHub);  // typo 수정 — Supply → Supplies
    safe(window.hydrateDashboardJobs);
    safe(window.hydrateAsMgmt);
    safe(window.hydrateNewopen && (() => window.hydrateNewopen('all')));
  }
  window._refreshAllHubsAfterThread = _refreshAllHubsAfterThread;

  function _newThreadId() {
    return 'TR-' + Date.now() + '-' + Math.floor(Math.random()*1e9).toString(36);
  }

  function _kstNow() {
    return (typeof _kstDateTimeStr === 'function')
      ? _kstDateTimeStr()
      : new Date().toISOString().slice(0,16).replace('T',' ');
  }

  function _whoNow() {
    // 작성자는 항상 현재 로그인 사용자 — jobEngineer(담당 엔지니어) 와는 별개 개념
    return ((typeof _currentAuthName==='function') ? _currentAuthName() : '') || '담당자';
  }

  // 기존 thread/메모/접수기록 등에 박힌 옛 작성자 이름을 일괄 치환
  // 콘솔에서: window.replaceAuthorName('Live Wire', '이동호')
  window.replaceAuthorName = function(oldName, newName) {
    if (!oldName || !newName) { console.warn('oldName, newName 필요'); return 0; }
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    let fixed = 0;
    jobs.forEach(j => {
      // thread 작성자
      if (Array.isArray(j.thread)) {
        j.thread.forEach(e => { if (e && e.author === oldName) { e.author = newName; fixed++; } });
      }
      // 메모 작성자
      if (Array.isArray(j.memos)) {
        j.memos.forEach(m => { if (m && m.author === oldName) { m.author = newName; fixed++; } });
      }
      // 엔지니어
      if (j.engineer === oldName) { j.engineer = newName; fixed++; }
      if (j.assignee === oldName) { j.assignee = newName; fixed++; }
    });
    if (typeof saveJobs === 'function') saveJobs(jobs);
    // ns_users / ns_auth 에서도 동기화
    try {
      const users = JSON.parse(localStorage.getItem('ns_users') || '[]');
      users.forEach(u => { if (u.name === oldName) { u.name = newName; fixed++; } });
      localStorage.setItem('ns_users', JSON.stringify(users));
      const auth = JSON.parse(localStorage.getItem('ns_auth') || 'null');
      if (auth && auth.name === oldName) { auth.name = newName; fixed++; localStorage.setItem('ns_auth', JSON.stringify(auth)); }
    } catch(_){}
    console.info(`✅ '${oldName}' → '${newName}' 치환:`, fixed, '건');
    try { showToast(`✅ '${oldName}' → '${newName}' ${fixed}건 치환 완료`); } catch(_){}
    return fixed;
  };

  // 진단용 — 콘솔에서 window.diagnoseStoreJobs('정이가마트') 또는 사업자번호로 호출
  window.diagnoseStoreJobs = function(bizOrName) {
    const jobs = (function(){ try { return JSON.parse(localStorage.getItem('ns_jobs')||'[]'); } catch { return []; } })();
    const needle = String(bizOrName||'').toLowerCase();
    const matches = jobs.filter(j => {
      const sn = (j.storeName||j.store||'').toLowerCase();
      const sid = String(j.storeId||'').toLowerCase();
      const biz = String(j.biz||j.bizno||'').toLowerCase();
      return sn.includes(needle) || sid.includes(needle) || biz.includes(needle);
    });
    console.log('Local jobs for', bizOrName, '— count:', matches.length, matches);
    matches.forEach(j => {
      console.log(`  ${j.id} ${j.type} ${j.status} thread:${(j.thread||[]).length}entries`);
      (j.thread||[]).forEach((e,i) => console.log('    ', i, e.status, e.ts, (e.text||'').slice(0,40)));
    });
    return matches;
  };

  /* ════════════════════════════════════════════════════════════
     _openLineForThreadEntry — thread 의 새 항목(ROOT/child) 저장 후 LINE 발송
     ────────────────────────────────────────────────────────────
     containerId 의 entity (job/stocktake) 자동 감지 → 적절한 컴포저 호출
     entry: 방금 저장된 thread 항목 ({status, text, attachments, ts, author})
   ════════════════════════════════════════════════════════════ */
  window._openLineForThreadEntry = function(containerId, jobId, entry) {
    if (!entry || !jobId) return;
    const entity = (containerId && window._threadEntities && window._threadEntities[containerId]) || 'job';
    try {
      if (entity === 'stocktake') {
        const arr = (typeof window.getStocktakes === 'function') ? (window.getStocktakes() || []) : [];
        const rec = arr.find(r => r.id === jobId);
        if (!rec) return;
        // 새 항목의 text/status/attachments 를 우선시 (단, 매장/일정/담당자 등은 rec 유지)
        const merged = Object.assign({}, rec, {
          status: entry.status || rec.status,
          memo:   entry.text || rec.memo,
          attachments: (Array.isArray(entry.attachments) && entry.attachments.length)
                       ? entry.attachments
                       : (Array.isArray(rec.attachments) ? rec.attachments : []),
        });
        if (typeof window._stocktakeOpenLineComposer === 'function') {
          window._stocktakeOpenLineComposer(merged);
        }
        return;
      }
      // job (AS / 신규 / VAN)
      const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
      const job = jobs.find(j => j.id === jobId);
      if (!job) return;
      if (typeof window._openLineForJob === 'function') {
        window._openLineForJob(job, { entry });
      }
    } catch(e) { console.warn('[_openLineForThreadEntry]', e); }
  };

  // 새 ROOT 제출 — AS draft 모드인 경우 즉시 live 저장으로 전환 (Fix A)
  window._submitNewRoot = function(containerId, jobId, draftMode, lineOverride) {
    const ta = document.getElementById(containerId + '__newroot');
    const text = (ta && ta.value || '').trim();
    if (!text) { try { showToast('내용을 입력하세요'); } catch(e){} return; }
    const ts = _kstNow();
    const who = _whoNow();
    // 📡 LINE 발송 — [등록 후 LINE 발송] 버튼이면 true / [등록] 이면 false. (구 체크박스 fallback)
    const wantLine = (typeof lineOverride === 'boolean')
      ? lineOverride
      : !!document.getElementById(containerId + '__newroot_line')?.checked;
    // 첨부 회수
    const attKey = '__newroot__' + (jobId || 'draft');
    window._threadFormAttachments = window._threadFormAttachments || {};
    window._threadFormUploaderCtl = window._threadFormUploaderCtl || {};
    let attachments = [];
    try {
      attachments = window._threadFormUploaderCtl[attKey] ? window._threadFormUploaderCtl[attKey].get() : (window._threadFormAttachments[attKey] || []);
    } catch(_){}
    const entry = { ts, author: who, status: '요청접수', text, threadId: _newThreadId(), parentId: null };
    if (Array.isArray(attachments) && attachments.length) entry.attachments = attachments;
    // 첨부 draft 초기화
    delete window._threadFormAttachments[attKey];
    delete window._threadFormUploaderCtl[attKey];

    // 📑 VAN 신규(draft) — 요청접수 [등록] 이 곧 VAN 업무 생성 (하단 footer 없음, 인라인 저장).
    //   매장 미선택이면 막고, 선택됐으면 이 ROOT 를 draft 에 넣어 saveVanJob 으로 생성 → 모달 유지(편집모드).
    if (draftMode && containerId === 'vanJobThread') {
      const hasStore = (typeof _vanUnregMode !== 'undefined' && _vanUnregMode)
        ? !!(document.getElementById('vanUnregName')?.value || '').trim()
        : !!(typeof _vanPickedStore !== 'undefined' && _vanPickedStore);
      if (!hasStore) { try { showToast('매장을 먼저 선택하세요'); } catch(e){} return; }
      window._jobThreadDraft = Array.isArray(window._jobThreadDraft) ? window._jobThreadDraft : [];
      window._jobThreadDraft.push(entry);
      try { if (typeof window.saveVanJob === 'function') window.saveVanJob({ wantLine, keepOpen: true }); }
      catch(e) { console.warn('[van newroot create]', e); }
      return;
    }

    // Fix A: AS draftMode → 즉시 live job 생성 또는 기존 AS 에 append
    if (draftMode && window._currentJobContext === 'as') {
      const storeName = ((document.getElementById('jobStoreName')||{}).value || '').trim();
      if (!storeName) { try { showToast('점포명을 먼저 입력하세요'); } catch(e){} return; }
      try {
        const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        const normFn = (typeof _normStoreKey === 'function') ? _normStoreKey : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
        const classifyFn = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : () => 'as';
        const target = normFn(storeName);
        // Fix C: completed 도 포함하여 매장당 단일 AS 로그를 유지 — 진행중 우선
        const candidates = jobs
          .map((j, idx) => ({ j, idx }))
          .filter(x => {
            if (classifyFn(x.j) !== 'as') return false;
            const sn = (x.j.storeName || x.j.store || '').trim();
            return !!sn && normFn(sn) === target;
          });
        const isDoneFn = (typeof window._isJobDone === 'function') ? window._isJobDone : () => false;
        let pick = candidates.find(x => !isDoneFn(x.j));
        if (!pick) pick = candidates.sort((a,b) => (b.j.createdAt||0) - (a.j.createdAt||0))[0];

        if (pick) {
          // 기존 AS 에 append (완료 상태였더라도 진행중으로 환원)
          const existing = jobs[pick.idx];
          existing.thread = (Array.isArray(existing.thread) ? existing.thread : []).slice();
          // draft 에 누적된 다른 항목도 함께 머지 후 비움
          const draftExtras = Array.isArray(window._jobThreadDraft) ? window._jobThreadDraft.slice() : [];
          existing.thread.push(entry);
          draftExtras.forEach(e => { if (e) existing.thread.push(e); });
          existing.thread = (typeof window._threadMigrate === 'function')
                          ? window._threadMigrate(existing.thread) : existing.thread;
          existing.completed = false;
          existing.status = '진행중';
          jobs[pick.idx] = existing;
          if (typeof saveJobs === 'function') saveJobs(jobs);
          try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}
          window._asInlineEditJobId = existing.id;
          window._jobThreadDraft = [];
          // UI 인라인 편집 모드 전환
          try { document.body.classList.add('as-inline-edit-mode'); } catch(e){}
          try {
            const rootCnt = (existing.thread||[]).filter(e => e && e.parentId == null).length;
            const banner = document.getElementById('asInlineEditBanner');
            if (banner) {
              banner.style.display = 'block';
              banner.innerHTML =
                '<div style="font-size:13px;font-weight:800;color:#1E40AF;margin-bottom:4px">' +
                '📌 이 매장의 기존 AS 업무에 누적 기록 중 — ID: ' + (existing.id||'') + '</div>' +
                '<div style="font-size:11.5px;color:#1E40AF;line-height:1.5">' +
                '요청 ' + rootCnt + '건 · 편집 내용은 즉시 저장됩니다.</div>';
            }
            const footer = document.querySelector('#newJobModal .modal-footer .btn.btn-primary');
            if (footer) footer.textContent = '완료';
          } catch(e){}
          const openKey = '_threadOpen_' + existing.id;
          window[openKey] = window[openKey] || {};
          window[openKey]['__newroot__'] = false;
          window[openKey][entry.threadId] = true;
          try {
            window._renderThreadGroups(containerId, existing.thread || [],
              { editable:true, jobId: existing.id, draftMode:false });
          } catch(e){}
          try { showToast('✅ 저장됨 (기존 AS 업무에 추가)'); } catch(e){}
          try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
          try { if (typeof hydrateAsMgmt === 'function') hydrateAsMgmt(); } catch(e){}
          try { if (typeof hydrateNewopen === 'function') hydrateNewopen('all'); } catch(e){}
          if (wantLine) { try { window._openLineForThreadEntry(containerId, existing.id, entry); } catch(_){} }
          return;
        }

        // 매장에 AS 가 전혀 없음 — 새 AS job 즉시 생성
        const storeMatch = (typeof getStores === 'function')
                          ? (getStores() || []).find(s => (s.name || '').trim() === storeName) : null;
        const draftExtras = Array.isArray(window._jobThreadDraft) ? window._jobThreadDraft.slice() : [];
        const initialThread = [entry].concat(draftExtras);
        const newJob = {
          id: 'JOB-' + Date.now().toString(36).toUpperCase(),
          type: 'AS 처리',
          storeName, store: storeName,
          storeId: storeMatch ? storeMatch.id : '',
          unregistered: (typeof jobStoreUnregistered !== 'undefined' ? jobStoreUnregistered : false) || !storeMatch,
          engineer: '',
          address: '',
          notes: '',
          equipment: [], equipTotal: 0,
          thread: (typeof window._threadMigrate === 'function') ? window._threadMigrate(initialThread) : initialThread,
          vandocs: { van:{status:'접수',tid:'',serial:''}, easy:{status:'접수',tid:''}, kakao:{status:'접수',tid:''} },
          status: '진행중',
          createdAt: Date.now(),
        };
        jobs.unshift(newJob);
        if (typeof saveJobs === 'function') saveJobs(jobs);
        try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}
        window._asInlineEditJobId = newJob.id;
        window._jobThreadDraft = [];
        try { document.body.classList.add('as-inline-edit-mode'); } catch(e){}
        try {
          const rootCnt = (newJob.thread||[]).filter(e => e && e.parentId == null).length;
          const banner = document.getElementById('asInlineEditBanner');
          if (banner) {
            banner.style.display = 'block';
            banner.innerHTML =
              '<div style="font-size:13px;font-weight:800;color:#1E40AF;margin-bottom:4px">' +
              '📌 새 AS 업무 — ID: ' + (newJob.id||'') + '</div>' +
              '<div style="font-size:11.5px;color:#1E40AF;line-height:1.5">' +
              '요청 ' + rootCnt + '건 · 편집 내용은 즉시 저장됩니다.</div>';
          }
          const footer = document.querySelector('#newJobModal .modal-footer .btn.btn-primary');
          if (footer) footer.textContent = '완료';
        } catch(e){}
        const openKey = '_threadOpen_' + newJob.id;
        window[openKey] = window[openKey] || {};
        window[openKey]['__newroot__'] = false;
        window[openKey][entry.threadId] = true;
        try {
          window._renderThreadGroups(containerId, newJob.thread || [],
            { editable:true, jobId: newJob.id, draftMode:false });
        } catch(e){}
        try { showToast('✅ 새 AS 업무가 등록되고 첫 요청이 저장되었습니다'); } catch(e){}
        try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
        try { if (typeof hydrateAsMgmt === 'function') hydrateAsMgmt(); } catch(e){}
        try { if (typeof hydrateNewopen === 'function') hydrateNewopen('all'); } catch(e){}
        try { _refreshAllHubsAfterThread(); } catch(e){}
        if (wantLine) { try { window._openLineForThreadEntry(containerId, newJob.id, entry); } catch(_){} }
        return;
      } catch(err) {
        console.warn('[_submitNewRoot AS live-save]', err);
        // fall through to default draft path on error
      }
    }

    // 기본 경로 (신규/VAN draft, 또는 기존 live edit, stocktake)
    let arr = window._threadMigrate(_getThreadFor(jobId, draftMode, containerId));
    arr.push(entry);
    _setThreadFor(jobId, draftMode, arr, containerId);
    // 새 ROOT 폼 닫기, 새 ROOT 펼침
    const openKey = '_threadOpen_' + (jobId || 'draft');
    window[openKey] = window[openKey] || {};
    window[openKey]['__newroot__'] = false;
    window[openKey][entry.threadId] = true;
    _rerenderThread(containerId, jobId, draftMode);
    _refreshAllHubsAfterThread();
    try { showToast('✅ 새 요청이 접수되었습니다'); } catch(e){}
    if (wantLine && jobId) { try { window._openLineForThreadEntry(containerId, jobId, entry); } catch(_){} }
  };

  // child 제출
  window._submitChild = function(containerId, jobId, draftMode, rootId, formId, lineOverride) {
    const ta = document.getElementById(formId + '_text');
    const text = (ta && ta.value || '').trim();
    // 📡 LINE 발송 — [등록 후 LINE 발송] 버튼이면 lineOverride=true, [등록] 이면 false. (구 체크박스 fallback)
    const wantLine = (typeof lineOverride === 'boolean')
      ? lineOverride
      : !!document.getElementById(formId + '_line')?.checked;
    // 폼별 투입 장비 임시 목록 회수
    window._threadChildEquipDraft = window._threadChildEquipDraft || {};
    const eqList = (window._threadChildEquipDraft[formId] || []).slice();
    // 첨부 회수
    window._threadFormUploaderCtl = window._threadFormUploaderCtl || {};
    window._threadFormAttachments = window._threadFormAttachments || {};
    let attachments = [];
    try {
      attachments = window._threadFormUploaderCtl[formId] ? window._threadFormUploaderCtl[formId].get() : (window._threadFormAttachments[formId] || []);
    } catch(_){}
    if (!text && eqList.length === 0 && (!attachments || !attachments.length)) { try { showToast('내용·장비·첨부 중 하나는 필요합니다'); } catch(e){} return; }
    const st = (document.querySelector(`input[name="${formId}_st"]:checked`)||{}).value || '진행';
    const ts = _kstNow();
    const who = _whoNow();
    const entry = { ts, author: who, status: st, text: text || (attachments.length?'(첨부만 등록)':'(투입 장비만 등록)'),
                    threadId: _newThreadId(), parentId: rootId };
    if (eqList.length > 0) entry.equipment = eqList;
    if (Array.isArray(attachments) && attachments.length) entry.attachments = attachments;
    // 첨부 draft 초기화
    delete window._threadFormAttachments[formId];
    delete window._threadFormUploaderCtl[formId];

    // Fix A (child): AS draft 모드 — 가능한 경우 즉시 live job 으로 라우팅
    let _liveRoute = false;
    if (draftMode && window._currentJobContext === 'as' && window._asInlineEditJobId) {
      try {
        const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        const idx = jobs.findIndex(j => j.id === window._asInlineEditJobId);
        if (idx >= 0) {
          const live = jobs[idx];
          live.thread = (Array.isArray(live.thread) ? live.thread : []).slice();
          live.thread.push(entry);
          live.thread = (typeof window._threadMigrate === 'function')
                       ? window._threadMigrate(live.thread) : live.thread;
          jobs[idx] = live;
          // 🛡 고아 child 의 ROOT 재구성 — display-only 시드 ROOT 가 저장 안 돼 완료 child 만 남는 사고 방지(2026-06-12 판다팜)
          try { if (typeof window._healOrphanRoots === 'function') window._healOrphanRoots(live, live.thread); } catch(_){}
          // 🔧 job status 동기화 — 완료 child 추가 시 _recomputeJobStatus 누락으로
          //   AS 업무가 '진행중'에 갇히던 버그 fix (2026-06-12). _setThreadFor 일반경로는 이미 호출하나
          //   이 AS live-route 만 빠져 있었음. 모든 요청접수(ROOT) 완료 시 job 을 '처리완료' 로 승격.
          if (typeof window._recomputeJobStatus === 'function') window._recomputeJobStatus(live);
          if (typeof saveJobs === 'function') saveJobs(jobs);
          try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}
          jobId = live.id;
          draftMode = false;
          _liveRoute = true;
        }
      } catch(err) { console.warn('[_submitChild AS live-route]', err); }
    }
    let arr;
    if (!_liveRoute) {
      arr = window._threadMigrate(_getThreadFor(jobId, draftMode, containerId));
      arr.push(entry);
      _setThreadFor(jobId, draftMode, arr, containerId);
    }
    // ⚠ AS 처리 장비는 child.equipment 에만 보관 — job.equipment(설치되어야 할 장비)로 누적하지 않음
    //   (요청건 단위로 어떤 장비가 어디에 투입됐는지 명확히 추적하기 위함)
    // 폼 임시 장비 목록 비움
    delete window._threadChildEquipDraft[formId];
    // 완료 처리 시 — 해당 ROOT 자동 접힘
    if (st === '완료') {
      const openKey = '_threadOpen_' + (jobId || 'draft');
      window[openKey] = window[openKey] || {};
      window[openKey][rootId] = false;
    }
    _rerenderThread(containerId, jobId, draftMode);
    _refreshAllHubsAfterThread();
    try { showToast(st==='완료' ? '✅ 완료 처리되었습니다' : '🔄 진행 기록이 추가되었습니다'); } catch(e){}
    if (wantLine && jobId) { try { window._openLineForThreadEntry(containerId, jobId, entry); } catch(_){} }
  };

  // 자식 폼의 textarea/상태 스냅샷 후 재렌더 + 복원 — 입력 중인 내용 보존
  function _rerenderThreadPreserving(containerId, jobId, draftMode, formId) {
    const taOld = document.getElementById(formId + '_text');
    const stash = {
      text: taOld ? taOld.value : '',
      st: (document.querySelector(`input[name="${formId}_st"]:checked`)||{}).value || ''
    };
    _rerenderThread(containerId, jobId, draftMode);
    const taNew = document.getElementById(formId + '_text');
    if (taNew && stash.text) taNew.value = stash.text;
    if (stash.st) {
      const r = document.querySelector(`input[name="${formId}_st"][value="${stash.st}"]`);
      if (r) r.checked = true;
    }
  }

  // 처리 기록 폼별 — 투입 장비 추가 팝업
  window._openChildEquipAdd = function(containerId, jobId, draftMode, rootId, formId, editIdx) {
    const modal = (typeof _ensureStoreEquipModal === 'function') ? _ensureStoreEquipModal() : null;
    if (!modal) { alert('장비 입력 모달을 불러올 수 없습니다'); return; }
    window._threadChildEquipDraft = window._threadChildEquipDraft || {};
    window._threadChildEquipDraft[formId] = window._threadChildEquipDraft[formId] || [];
    const isEdit = typeof editIdx === 'number';
    const current = isEdit ? (window._threadChildEquipDraft[formId][editIdx] || {}) : {};
    document.getElementById('seemTitle').textContent = isEdit ? '🔧 처리 투입 장비 — 수정' : '🔧 처리 투입 장비 — 추가';
    document.getElementById('seemBody').innerHTML = _renderEquipFormFields('seem_child', current);
    document.getElementById('seemFooterLeft').innerHTML = '';
    const saveBtn = document.getElementById('seemSaveBtn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const data = _collectEquipForm('seem_child');
        if (!data.name) { alert('장비명을 입력하세요'); return; }
        if (isEdit) window._threadChildEquipDraft[formId][editIdx] = data;
        else window._threadChildEquipDraft[formId].push(data);
        modal.classList.remove('show');
        _rerenderThreadPreserving(containerId, jobId, draftMode, formId);
      };
    }
    modal.classList.add('show');
  };
  window._removeChildEquip = function(containerId, jobId, draftMode, rootId, formId, idx) {
    window._threadChildEquipDraft = window._threadChildEquipDraft || {};
    if (!window._threadChildEquipDraft[formId]) return;
    window._threadChildEquipDraft[formId].splice(idx, 1);
    _rerenderThreadPreserving(containerId, jobId, draftMode, formId);
  };

  // 노드 삭제 (ROOT 또는 child)
  window._removeThreadNode = function(containerId, jobId, draftMode, nodeId, isRoot) {
    if (isRoot && !confirm('이 요청과 하위 기록을 모두 삭제할까요?')) return;
    let arr = window._threadMigrate(_getThreadFor(jobId, draftMode, containerId));
    if (isRoot) {
      arr = arr.filter(e => e.threadId !== nodeId && e.parentId !== nodeId);
    } else {
      arr = arr.filter(e => e.threadId !== nodeId);
    }
    // 🪦 클라우드 유니온 머지로 부활하는 사고 방지 — tombstone 등록
    //    draftMode (저장 전 임시) 에서는 tombstone 등록 X (실제 저장된 적 없음)
    if (!draftMode && jobId) {
      if (isRoot) {
        _addTombstone('thread', nodeId, jobId);
        _addTombstone('thread-children', nodeId, jobId); // 자식들도 union 부활 차단
      } else {
        _addTombstone('thread', nodeId, jobId);
      }
    }
    // 🔥 AS/신규 카테고리: 마지막 ROOT 삭제 시 job 전체 삭제 (cascade) — 2026-05-22
    //   dashboard / 매장정보에서 thread=[] 인 ghost 카드로 남아 클릭 시 재시드되는 부활 차단
    if (!draftMode && jobId && isRoot) {
      const remainingRoots = (Array.isArray(arr) ? arr : []).filter(e => e && e.parentId == null);
      if (remainingRoots.length === 0) {
        try {
          const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
          const ji = jobs.findIndex(x => x.id === jobId);
          if (ji >= 0) {
            const cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(jobs[ji]) : '';
            if (cat === 'as' || cat === 'new') {
              if (typeof _addTombstone === 'function') _addTombstone('job', jobId);
              jobs.splice(ji, 1);
              if (typeof saveJobs === 'function') saveJobs(jobs);
              try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(_){}
              if (typeof showToast === 'function') showToast('🗑 마지막 요청이라 업무가 함께 삭제됐습니다');
              // 모달 닫기 시도
              try { if (typeof closeModal === 'function') closeModal('newopenEditModal'); } catch(_){}
              try { document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active')); } catch(_){}
              _refreshAllHubsAfterThread();
              return;
            }
          }
        } catch(e) { console.warn('[cascadeDeleteJob]', e); }
      }
    }
    _setThreadFor(jobId, draftMode, arr, containerId);
    _rerenderThread(containerId, jobId, draftMode);
    _refreshAllHubsAfterThread();
  };

  // 구버전 호환 wrapper — 기존 호출자(있다면) 보호
  window._renderJobThread = function() {
    try { window._renderThreadGroups('jobThreadContainer', window._jobThreadDraft || [], { editable:true, jobId:null, draftMode:true }); } catch(e){}
  };
  window.addJobThreadAt = function(jobId) {
    // 구 진입점 — 호환을 위해 그냥 모달 재오픈
    try { editNewopen(jobId); } catch(e){}
  };
  window.removeJobThreadAt = function(jobId, idx) {
    try { editNewopen(jobId); } catch(e){}
  };
  window._addJobThreadEntry = function() {
    try { window._renderJobThread(); } catch(e){}
  };
  window._removeJobThreadEntry = function(idx) {
    try { window._renderJobThread(); } catch(e){}
  };

  /* ─── VAN 서류 진행 ─── */
  // 구조 v2 (2026-05-17): vandocs = {
  //   vans: { KOCES:{status,tid,serial}, NICE:{status,tid}, KIS:{status,tid}, KSNET:{status,tid} },
  //   easy: {status,tid},
  //   kakao: {status,tid}
  // }
  // 구조 v1 (legacy) vandocs.van = {status,tid,serial} → 첫 진입 시 KOCES 로 마이그
  const VAN_BRANDS = ['KOCES','NICE','KIS','KSNET'];
  const VAN_BRAND_HAS_SERIAL = { KOCES:true };
  const VANDOC_STATES = [
    { v:'접수', icon:'📥' },
    { v:'진행', icon:'📤' },
    { v:'완료', icon:'✅' }
  ];

  function _vandocStatusMeta(s) {
    if (s === '완료' || s === '진행완료') return { color:'#065F46', bg:'#D1FAE5', border:'#A7F3D0' };
    if (s === '진행' || s === '신청진행') return { color:'#92400E', bg:'#FEF3C7', border:'#FCD34D' };
    return { color:'#1E40AF', bg:'#DBEAFE', border:'#BFDBFE' };
  }
  function _vandocNormalizeStatus(s) {
    if (s === '서류접수') return '접수';
    if (s === '신청진행') return '진행';
    if (s === '진행완료') return '완료';
    return s || '접수';
  }

  // legacy v1 (vandocs.van) → v2 (vandocs.vans.KOCES) 인플레이스 보정. 비파괴.
  function _vandocMigrateV2(vandocs) {
    if (!vandocs || typeof vandocs !== 'object') vandocs = {};
    if (!vandocs.vans) vandocs.vans = {};
    if (vandocs.van && typeof vandocs.van === 'object' && (vandocs.van.tid || vandocs.van.serial || vandocs.van.status)) {
      // KOCES 비어있으면 옛 데이터로 채움
      if (!vandocs.vans.KOCES || (!vandocs.vans.KOCES.tid && !vandocs.vans.KOCES.serial)) {
        vandocs.vans.KOCES = Object.assign({}, vandocs.van);
      }
    }
    return vandocs;
  }

  // store.vanProfile / payProfile 로 vandocs 빈 칸 prefill (값 있는 칸은 보존)
  function _vandocPrefillFromStore(vandocs, store) {
    if (!store) return vandocs;
    vandocs = _vandocMigrateV2(vandocs);
    const vp = store.vanProfile || {};
    VAN_BRANDS.forEach(b => {
      const sp = vp[b];
      if (!sp || !sp.tid) return;
      vandocs.vans[b] = vandocs.vans[b] || { status:'접수' };
      if (!vandocs.vans[b].tid)    vandocs.vans[b].tid    = sp.tid;
      if (!vandocs.vans[b].serial && sp.serial) vandocs.vans[b].serial = sp.serial;
    });
    const pp = store.payProfile || {};
    if (pp['간편결제'] && pp['간편결제'].tid) {
      vandocs.easy = vandocs.easy || { status:'접수' };
      if (!vandocs.easy.tid) vandocs.easy.tid = pp['간편결제'].tid;
    }
    if (pp['카카오페이'] && pp['카카오페이'].tid) {
      vandocs.kakao = vandocs.kakao || { status:'접수' };
      if (!vandocs.kakao.tid) vandocs.kakao.tid = pp['카카오페이'].tid;
    }
    return vandocs;
  }
  window._vandocPrefillFromStore = _vandocPrefillFromStore;

  window._renderJobVandocs = function(containerId, vandocs, opts) {
    const root = document.getElementById(containerId);
    if (!root) return;
    opts = opts || {};
    const editable = !!opts.editable;
    const jobId = opts.jobId || null;
    const draftMode = !!opts.draftMode;
    const escFn = (typeof esc === 'function') ? esc : (s)=>String(s||'');
    const data = _vandocMigrateV2(vandocs || {});

    // 노출할 VAN 브랜드 — 데이터 있는 브랜드 모두 (없으면 KOCES 기본 1개)
    let activeBrands = VAN_BRANDS.filter(b => data.vans[b] && (data.vans[b].tid || data.vans[b].serial || data.vans[b].status));
    if (activeBrands.length === 0) activeBrands = ['KOCES'];

    const brandCards = activeBrands.map(b => {
      const d = data.vans[b] || {};
      const st = _vandocNormalizeStatus(d.status);
      const m = _vandocStatusMeta(st);
      const tid = d.tid || '';
      const serial = d.serial || '';
      const showSerial = !!VAN_BRAND_HAS_SERIAL[b];
      const radioName = `${containerId}_van_${b}_st`;
      const states = VANDOC_STATES.map(s => `
        <label style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;background:${st===s.v?m.bg:'#F1F5F9'};border:1px solid ${st===s.v?m.color:'#CBD5E1'};color:${st===s.v?m.color:'var(--gray-600)'};border-radius:14px;cursor:pointer;font-size:11px;font-weight:700">
          <input type="radio" name="${escFn(radioName)}" value="${escFn(s.v)}" ${st===s.v?'checked':''} ${editable?'':'disabled'} onchange="window._updateVandoc('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'van.${escFn(b)}','status',this.value)" style="margin:0"> ${s.icon} ${escFn(s.v)}
        </label>`).join('');
      const serialField = showSerial ? `
            <label style="display:flex;flex-direction:column;gap:3px">
              <span style="font-size:10.5px;color:var(--gray-500);font-weight:600">Serial</span>
              <input type="text" value="${escFn(serial)}" placeholder="Serial" ${editable?'':'disabled'} onchange="window._updateVandoc('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'van.${escFn(b)}','serial',this.value)" style="padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;background:#fff;font-family:inherit;width:100%;box-sizing:border-box">
            </label>` : '';
      const gridCols = showSerial ? '1fr 1fr' : '1fr';
      const removeBtn = editable ? `<button type="button" title="이 VAN 제거" onclick="window._updateVandoc('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'van.${escFn(b)}','__remove',true)" style="background:transparent;border:0;color:var(--gray-400);font-size:14px;cursor:pointer;padding:0;line-height:1">×</button>` : '';
      return `
        <div style="background:#fff;border:1px solid ${m.border};border-left:4px solid ${m.color};border-radius:10px;padding:11px 12px;display:flex;flex-direction:column;gap:7px;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:${m.color};font-size:13px">
            <span>💳</span><span>${escFn(b)}</span>
            <div style="flex:1"></div>
            ${removeBtn}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${states}</div>
          <div style="display:grid;grid-template-columns:${gridCols};gap:6px;margin-top:2px">
            <label style="display:flex;flex-direction:column;gap:3px">
              <span style="font-size:10.5px;color:var(--gray-500);font-weight:600">TID</span>
              <input type="text" value="${escFn(tid)}" placeholder="TID" ${editable?'':'disabled'} onchange="window._updateVandoc('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'van.${escFn(b)}','tid',this.value)" style="padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;background:#fff;font-family:inherit;width:100%;box-sizing:border-box">
            </label>${serialField}
          </div>
        </div>`;
    }).join('');

    // VAN 브랜드 추가 버튼 — 아직 활성 안 된 브랜드 dropdown
    const inactiveBrands = VAN_BRANDS.filter(b => !activeBrands.includes(b));
    const addBrandHtml = (editable && inactiveBrands.length) ? `
      <div style="background:#fff;border:1px dashed var(--gray-300);border-radius:10px;padding:11px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:120px">
        <div style="font-size:11px;color:var(--gray-500);font-weight:600">+ VAN 사 추가</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:center">
          ${inactiveBrands.map(b => `<button type="button" onclick="window._updateVandoc('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'van.${escFn(b)}','status','접수')" style="padding:4px 10px;background:#EFF6FF;border:1px solid #BFDBFE;color:#1d4ed8;border-radius:14px;font-size:11px;font-weight:700;cursor:pointer">+ ${escFn(b)}</button>`).join('')}
        </div>
      </div>` : '';

    // 간편결제 / 카카오페이 카드
    const renderPayCard = (key, label, icon) => {
      const d = data[key] || {};
      const st = _vandocNormalizeStatus(d.status);
      const m = _vandocStatusMeta(st);
      const tid = d.tid || '';
      const radioName = `${containerId}_${key}_st`;
      const states = VANDOC_STATES.map(s => `
        <label style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;background:${st===s.v?m.bg:'#F1F5F9'};border:1px solid ${st===s.v?m.color:'#CBD5E1'};color:${st===s.v?m.color:'var(--gray-600)'};border-radius:14px;cursor:pointer;font-size:11px;font-weight:700">
          <input type="radio" name="${escFn(radioName)}" value="${escFn(s.v)}" ${st===s.v?'checked':''} ${editable?'':'disabled'} onchange="window._updateVandoc('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(key)}','status',this.value)" style="margin:0"> ${s.icon} ${escFn(s.v)}
        </label>`).join('');
      return `
        <div style="background:#fff;border:1px solid ${m.border};border-left:4px solid ${m.color};border-radius:10px;padding:11px 12px;display:flex;flex-direction:column;gap:7px;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:${m.color};font-size:13px">
            <span>${icon}</span><span>${escFn(label)}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${states}</div>
          <div style="display:grid;grid-template-columns:1fr;gap:6px;margin-top:2px">
            <label style="display:flex;flex-direction:column;gap:3px">
              <span style="font-size:10.5px;color:var(--gray-500);font-weight:600">TID</span>
              <input type="text" value="${escFn(tid)}" placeholder="TID" ${editable?'':'disabled'} onchange="window._updateVandoc('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(key)}','tid',this.value)" style="padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;background:#fff;font-family:inherit;width:100%;box-sizing:border-box">
            </label>
          </div>
        </div>`;
    };
    const easyCard  = renderPayCard('easy',  '간편결제',  '📱');
    const kakaoCard = renderPayCard('kakao', '카카오페이', '🟡');

    root.innerHTML = `
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div style="font-weight:700;color:#1E40AF;font-size:13.5px">📑 VAN 서류 진행</div>
          <div style="font-size:10.5px;color:#1E40AF;opacity:0.8">VAN 다건 + 간편결제 + 카카오페이 · 상태 토글 · 매장 정보 자동 prefill</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
          ${brandCards}${addBrandHtml}${easyCard}${kakaoCard}
        </div>
      </div>`;
  };

  // kind 표기: 'van.KOCES' / 'van.NICE' / 'van.KIS' / 'van.KSNET' / 'easy' / 'kakao'
  window._updateVandoc = function(containerId, jobId, draftMode, kind, field, value) {
    function applyTo(target) {
      target = _vandocMigrateV2(target);
      if (kind.startsWith('van.')) {
        const b = kind.slice(4);
        target.vans = target.vans || {};
        target.vans[b] = target.vans[b] || { status:'접수' };
        if (field === '__remove') { delete target.vans[b]; return target; }
        target.vans[b][field] = value;
      } else {
        target[kind] = target[kind] || { status:'접수' };
        target[kind][field] = value;
      }
      return target;
    }
    if (draftMode) {
      window._jobVandocsDraft = applyTo(window._jobVandocsDraft || {});
      try { window._renderJobVandocs(containerId, window._jobVandocsDraft, { editable:true, jobId:null, draftMode:true }); } catch(e){}
    } else if (jobId) {
      const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
      const i = jobs.findIndex(x => x.id === jobId);
      if (i < 0) return;
      jobs[i].vandocs = applyTo(jobs[i].vandocs || {});
      if (typeof saveJobs === 'function') saveJobs(jobs);
      try { window._renderJobVandocs(containerId, jobs[i].vandocs, { editable:true, jobId:jobId, draftMode:false }); } catch(e){}
    }
  };

  /* ── 상담 등록 / 조회 / 전환 ──
     상담은 newJobModal 을 그대로 활용 — type='상담' 만 preset, 장비/일정/담당자 모두 동일 입력
     장점: 신규 전환 시 데이터 그대로 이어져 추가 입력 불필요 */
  function openConsultJob() {
    if (typeof showModal === 'function') showModal('newJobModal');
    setTimeout(() => {
      // 작업 유형을 '상담' 으로 preset
      const sel = document.getElementById('jobType');
      if (sel) {
        for (const opt of sel.options) {
          if (opt.value === '상담' || opt.textContent === '상담') { sel.value = opt.value || opt.textContent; break; }
        }
      }
      // 상담 모드 적용 (입고가 숨김 + 상담일 노출)
      applyJobTypeMode();
      // 상담일 기본값 = 오늘
      const cdEl = document.getElementById('jobConsultDate');
      if (cdEl) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth()+1).padStart(2,'0');
        const dd = String(today.getDate()).padStart(2,'0');
        cdEl.value = `${yyyy}-${mm}-${dd}`;
      }
      // 상담은 보통 미등록 매장이므로 자동으로 미등록 모드 ON
      if (typeof jobStoreUnregistered !== 'undefined' && !jobStoreUnregistered) {
        if (typeof toggleUnregisteredStore === 'function') toggleUnregisteredStore();
      }
      const storeEl = document.getElementById('jobStoreName');
      if (storeEl) storeEl.focus();
    }, 100);
  }
  window.openConsultJob = openConsultJob;

  function isConsultJob(j) { return j && j.type === '상담'; }

  function hydrateConsult(filter) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const all = jobs.filter(isConsultJob);
    const active = all.filter(j => j.status === '상담중');
    const won    = all.filter(j => j.status === '납품성공');
    const lost   = all.filter(j => j.status === '납품실패');

    const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    setText('consultActiveCount', active.length);
    setText('consultWonCount',    won.length);
    setText('consultLostCount',   lost.length);
    setText('consultTotalCount',  all.length);

    let view;
    if (filter === 'won')        view = won;
    else if (filter === 'lost')  view = lost;
    else if (filter === 'all')   view = all;
    else                          view = active;

    view = view.slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0));

    const tb = document.getElementById('consultTbody');
    if (!tb) return;
    if (view.length === 0) {
      tb.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px 20px;color:var(--gray-400);font-size:13px">
        <div style="font-size:36px;margin-bottom:10px">💬</div>
        <div style="font-weight:700;color:var(--gray-500);margin-bottom:4px">해당 상담이 없습니다</div>
        <div style="font-size:11px">필터를 변경하거나 [+ 상담 등록] 으로 추가하세요.</div>
      </td></tr>`;
      return;
    }
    tb.innerHTML = view.map(j => {
      const badge = j.status === '상담중'
        ? `<span class="badge badge-blue">상담중</span>`
        : j.status === '납품성공'
          ? `<span class="badge badge-green">납품 결정</span>`
          : `<span class="badge" style="background:#FEE2E2;color:#991B1B">납품 실패</span>`;
      const contactHtml = (j.contactName || j.contactPhone)
        ? `<div style="font-size:12px"><b>${esc(j.contactName||'-')}</b></div>
           ${j.contactPhone ? `<div style="font-size:11px;color:var(--gray-500)"><a href="tel:${esc(j.contactPhone)}" style="color:inherit;text-decoration:none">📞 ${esc(j.contactPhone)}</a></div>` : ''}`
        : `<span style="color:var(--gray-400);font-size:11px">미입력</span>`;
      // 상담일 우선, 없으면 등록일 (createdAt) 표시
      const created = j.consultDate
        ? new Date(j.consultDate).toLocaleDateString('ko-KR')
        : (j.createdAt ? new Date(j.createdAt).toLocaleDateString('ko-KR') : '-');
      const actions = j.status === '상담중'
        ? `<button class="btn btn-primary btn-sm" style="font-size:11px;padding:5px 10px;font-weight:700" onclick="convertConsultToNewopen('${j.id}')">→ 신규 전환</button>
           <button class="btn btn-outline btn-sm" style="font-size:11px;padding:5px 10px;color:var(--danger);border-color:var(--danger)" onclick="markConsultLost('${j.id}')">✕ 납품 실패</button>`
        : j.status === '납품실패'
          ? `<button class="btn btn-outline btn-sm" style="font-size:11px;padding:5px 10px" onclick="reopenConsult('${j.id}')">↻ 상담 재개</button>
             <button class="btn btn-outline btn-sm" style="font-size:11px;padding:5px 10px;color:var(--danger);border-color:var(--danger)" onclick="deleteConsult('${j.id}')">🗑 삭제</button>`
          : `<span style="font-size:11px;color:var(--gray-500)">신규관리에서 진행</span>`;
      const eqCount = Array.isArray(j.equipment) ? j.equipment.filter(e => (Number(e.qty)||0)>0).length : 0;
      const eqTotal = Array.isArray(j.equipment) ? j.equipment.reduce((s,e)=> s + ((Number(e.qty)||0)*(Number(e.salePrice)||0)),0) : 0;
      const eqBadge = eqCount > 0
        ? `<span style="display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700;margin-top:3px">📦 ${eqCount}종 / ${eqTotal.toLocaleString('ko-KR')}원</span>`
        : '';
      const notesHtml = `<div style="font-size:12px;color:var(--gray-600);white-space:pre-wrap;max-width:340px">${esc(j.notes||'')}</div>${eqBadge}`;
      return `<tr style="cursor:pointer" onclick="editNewopen('${j.id}')" title="클릭하여 상세 보기 (장비/일정 편집)">
        <td>${badge}</td>
        <td><b>${esc(j.storeName || j.store || '-')}</b></td>
        <td>${contactHtml}</td>
        <td>${notesHtml}</td>
        <td style="font-size:11px;color:var(--gray-500)">${created}</td>
        <td style="text-align:center" onclick="event.stopPropagation()"><div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap">${actions}</div></td>
      </tr>`;
    }).join('');
  }
  window.hydrateConsult = hydrateConsult;

  function filterConsult(chip, f) {
    chip.parentElement.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    hydrateConsult(f);
  }
  window.filterConsult = filterConsult;

  /* ══════════════════════════════════════════════
     AS 관리 — 별도 화면
  ══════════════════════════════════════════════ */
  let _asMgmtFilter = 'pending';   // 기본: 진행 중(미처리) — 탭 순서 진행중:전체:완료:... 통일

  function isAsJob(j) {
    // 모바일과 동일하게 classifyJobCategory 로 판정 (type 텍스트 /AS/ 판정은 lineCategory=pos_as 인데
    //   type 에 'AS' 없는 작업을 누락 → PC↔모바일 AS 집합 불일치. CLAUDE.md: type 텍스트로 분류 금지)
    if (!j) return false;
    if (typeof window.classifyJobCategory === 'function') return window.classifyJobCategory(j) === 'as';
    return /AS/i.test(j.type || '');
  }

  function openAsJob() {
    if (typeof showModal === 'function') showModal('newJobModal');
    setTimeout(() => {
      const sel = document.getElementById('jobType');
      if (sel) {
        for (const opt of sel.options) {
          if (/AS/i.test(opt.value || opt.textContent)) { sel.value = opt.value || opt.textContent; break; }
        }
      }
      if (typeof applyJobTypeMode === 'function') applyJobTypeMode();
    }, 50);
  }
  window.openAsJob = openAsJob;

  /* AS 상태 사이클 — 접수 → 방문예정 → 재방문필요 → 처리완료 → (다시 접수) */
  const AS_STATUS_FLOW = ['접수', '방문예정', '재방문필요', '처리완료'];
  const AS_STATUS_META = {
    '접수':       { color:'#0EA5E9', bg:'#E0F2FE', icon:'📋' },
    '방문예정':   { color:'#1D4ED8', bg:'#DBEAFE', icon:'🚗' },
    '재방문필요': { color:'#9A3412', bg:'#FED7AA', icon:'🔁' },
    '처리완료':   { color:'#065F46', bg:'#D1FAE5', icon:'✅' },
  };
  // _isJobEffectivelyDone 우선 사용 — thread ROOT 전체 완료 시 status 무관 done 처리
  // 옛 데이터의 stale status 도 정확히 분류 (대시보드 AS 미처리 불일치 fix)
  function _isAsDone(j) {
    if (typeof window._isJobEffectivelyDone === 'function') return window._isJobEffectivelyDone(j);
    return j.status === '처리완료' || j.status === '완료' || j.status === 'done';
  }
  function cycleAsStatus(jobId) {
    const jobs = getJobs();
    const j = jobs.find(x => x.id === jobId);
    if (!j) return;
    const cur = j.status || '접수';
    const idx = AS_STATUS_FLOW.indexOf(cur);
    const next = AS_STATUS_FLOW[(idx + 1) % AS_STATUS_FLOW.length];
    setAsStatus(jobId, next);
  }
  window.cycleAsStatus = cycleAsStatus;

  function setAsStatus(jobId, status) {
    const jobs = getJobs();
    const j = jobs.find(x => x.id === jobId);
    if (!j) return;
    j.status = status;
    if (status === '처리완료') j.completedAt = new Date().toISOString();
    else delete j.completedAt;
    saveJobs(jobs);
    try { pushJobsToCloud({ toast: false }); } catch(e){}
    try { hydrateAsMgmt(); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
    try { rebuildJobsGrid(); } catch(e){}
    // 상세 모달이 열려 있으면 갱신
    try {
      const modal = document.getElementById('newopenDetailModal');
      if (modal && modal.classList.contains('show')) editNewopen(jobId);
    } catch(e){}
    if (typeof showToast === 'function') showToast(`상태: ${status}`);
  }
  window.setAsStatus = setAsStatus;

  /* AS 메인 — 최신 요청접수(ROOT) 기준 담당 조회/배정 (요청별 담당 모델) */
  function _asLatestRoot(j) {
    const roots = (Array.isArray(j.thread) ? j.thread : []).filter(e => e && e.parentId === null);
    if (!roots.length) return null;
    roots.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
    return roots[0];
  }
  function _asCurrentAssignee(j) {
    const r = _asLatestRoot(j);
    return (r && r.assignee) || j.engineer || j.assignee || '';
  }
  // AS 메인 리스트에서 담당 즉시 배정 — 최신 요청접수에 반영 (없으면 job 레벨)
  window._asmgmtAssign = function(jobId, name) {
    const jobs = getJobs();
    const job = jobs.find(x => x.id === jobId);
    if (!job) return;
    const val = String(name || '').trim();
    const root = _asLatestRoot(job);
    if (root) { if ((root.assignee || '') === val) return; root.assignee = val; }
    else { if ((job.engineer || job.assignee || '') === val) return; job.engineer = val; job.assignee = val; }
    job.updatedAt = Date.now();
    saveJobs(jobs);
    try { pushJobsToCloud({ toast:false }); } catch(e){}
    if (typeof showToast === 'function') showToast(val ? `👷 담당: ${val}` : '담당 해제됨');
    try { hydrateAsMgmt(); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
  };

  function hydrateAsMgmt() {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const all = jobs.filter(isAsJob);
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    const ym = todayStr.slice(0,7);
    const isDone = _isAsDone;
    const pending = all.filter(j => !isDone(j));
    const over48 = pending.filter(j => {
      const ts = j.asReceivedAt ? new Date(j.asReceivedAt.replace(' ','T')+':00').getTime()
              : (j.createdAt ? Number(j.createdAt) : 0);
      return ts && (Date.now() - ts) > 48 * 3600 * 1000;
    });
    const todayDue = pending.filter(j => (j.asDueDate || '').slice(0,10) === todayStr);
    const doneThisMonth = all.filter(j => isDone(j) && ((j.completedAt||j.createdAt||0) && new Date(j.completedAt||j.createdAt||0).toISOString().slice(0,7) === ym));

    const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    setText('asMgmtPending', pending.length);
    setText('asMgmtPendingSub', pending.length === 0 ? '접수 없음' : '접수 대기');
    setText('asMgmtOver48', over48.length);
    setText('asMgmtToday', todayDue.length);
    setText('asMgmtDone', doneThisMonth.length);

    // 필터링
    let view = all.slice();
    const q = String(document.getElementById('asMgmtSearch')?.value || '').toLowerCase().replace(/\s+/g,'');
    if (_asMgmtFilter === 'pending')  view = view.filter(j => !isDone(j));
    else if (_asMgmtFilter === 'today') view = view.filter(j => !isDone(j) && (j.asDueDate||'').slice(0,10) === todayStr);
    else if (_asMgmtFilter === 'done')  view = view.filter(isDone);
    else if (_asMgmtFilter === 'posvan') view = view.filter(j => !isDone(j) && (['pos_as','van_as','as_pos_van'].includes(j.lineCategory) || (!j.lineCategory && !(Array.isArray(j.asTargets) && j.asTargets.includes('이동단말기')))));
    else if (_asMgmtFilter === 'device') view = view.filter(j => !isDone(j) && (j.lineCategory === 'device_mgmt' || (Array.isArray(j.asTargets) && j.asTargets.includes('이동단말기'))));
    if (q) {
      view = view.filter(j => {
        const blob = [j.store, j.storeName, j.notes, j.address, j.engineer]
          .filter(Boolean).join(' | ').toLowerCase().replace(/\s+/g,'');
        return blob.includes(q);
      });
    }
    // 정렬 규칙:
    //   전체(all): ① 미완료 먼저 ② 미완료 내에서 최신 접수 순 ③ 완료 내에서 최신 완료 순
    //   미처리(pending)/필터: 최신 접수 순 (최근 건 위)
    //   완료(done): 최신 완료 순
    const _mtime = j => {
      if (j.asReceivedAt) return new Date(j.asReceivedAt.replace(' ','T')+':00').getTime();
      return Number(j.createdAt || 0);
    };
    // 🔢 전 메뉴 공통 정렬(job-done-sort): 미완료(등록desc) → 완료(완료시각desc)
    view.sort(window._jobDoneSort || ((a, b) => {
      const doneA = isDone(a), doneB = isDone(b);
      if (doneA !== doneB) return doneA ? 1 : -1;
      if (!doneA) return _mtime(b) - _mtime(a);
      return (new Date(b.completedAt||0).getTime()) - (new Date(a.completedAt||0).getTime());
    }));

    const tb = document.getElementById('asMgmtTbody');
    if (!tb) return;
    // 🛡 어른거림 방지 — 필터+내용 동일하면 재구축 skip (행별 select 재생성 차단)
    {
      const _amSig = 'asmgmt|' + (_asMgmtFilter||'') + '|' + JSON.stringify(view.map(j=>[j.id,j.status||'',j.completed?1:0,j.updatedAt||0,(Array.isArray(j.thread)?j.thread.length:0)]));
      if (window._sigSkip && window._sigSkip(tb, _amSig)) return;
    }
    if (view.length === 0) {
      tb.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px 20px;color:var(--gray-400);font-size:13px">
        <div style="font-size:36px;margin-bottom:10px">🔧</div>
        <div style="font-weight:700;color:var(--gray-500);margin-bottom:4px">해당 조건에 맞는 AS 가 없습니다</div>
      </td></tr>`;
      return;
    }

    tb.innerHTML = view.map(j => {
      const done = isDone(j);
      const recv = j.asReceivedAt || (j.createdAt ? new Date(Number(j.createdAt)).toISOString().slice(0,16).replace('T',' ') : '-');
      const ts = j.asReceivedAt ? new Date(j.asReceivedAt.replace(' ','T')+':00').getTime() : Number(j.createdAt||0);
      const hours = ts ? Math.round((Date.now() - ts) / 3600000) : 0;
      const elapsedTxt = done
        ? '<span style="color:var(--success);font-weight:700">완료</span>'
        : hours >= 72 ? `<span style="color:var(--danger);font-weight:700">${hours}h ⚠</span>`
        : hours >= 48 ? `<span style="color:var(--warning);font-weight:700">${hours}h</span>`
        : `<span style="color:var(--gray-600)">${hours}h</span>`;
      const due = [j.asDueDate, j.asDueTime].filter(Boolean).join(' ');
      const targets = Array.isArray(j.asTargets) ? j.asTargets : [];
      const targetIcons = { 'VAN':'💳', 'POS':'🖥', '키오스크':'📟', '기타':'📦' };
      const targetBadges = targets.length
        ? targets.map(t => `<span style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-right:2px">${targetIcons[t]||''} ${esc(t)}</span>`).join('')
        : '<span style="color:var(--gray-300);font-size:11px">-</span>';
      const curStatus = j.status || '접수';
      const meta = AS_STATUS_META[curStatus] || AS_STATUS_META['접수'];
      const statusBadge = `<span class="badge" style="background:${meta.bg};color:${meta.color};font-weight:700">${meta.icon} ${esc(curStatus)}</span>`;
      const store = j.store || j.storeName || '-';
      const unregBadge = j.unregistered ? '<span style="margin-left:4px;background:#FEF3C7;color:#92400E;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700">미등록</span>' : '';
      const lineCatBadge = (j.source === 'line' && j.lineCategory && LINE_TYPE_META[j.lineCategory])
        ? `<span style="margin-left:4px;background:${LINE_TYPE_META[j.lineCategory].bg};color:${LINE_TYPE_META[j.lineCategory].color};font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700" title="Line 분류">${LINE_TYPE_META[j.lineCategory].label}</span>`
        : '';
      // 담당 — 진행/미처리 건은 인라인 select 로 즉시 배정 (최신 요청접수 기준), 완료 건은 읽기전용
      const curAsg = _asCurrentAssignee(j);
      const eng = done
        ? (curAsg ? esc(curAsg) : '<span style="color:var(--gray-400)">-</span>')
        : `<select onclick="event.stopPropagation()" onchange="event.stopPropagation();window._asmgmtAssign('${j.id}',this.value)" style="font-size:11.5px;font-weight:700;padding:3px 6px;border:1px solid ${curAsg?'var(--gray-300)':'var(--danger)'};border-radius:5px;background:#fff;font-family:inherit;max-width:120px" title="담당 배정">${(typeof _jobStaffOptions==='function')?_jobStaffOptions(curAsg):('<option value="">미배정</option>')}</select>`;
      // 상태 사이클 버튼 — 다음 상태로 토글
      const curIdx = AS_STATUS_FLOW.indexOf(curStatus);
      const nextStatus = AS_STATUS_FLOW[(curIdx + 1) % AS_STATUS_FLOW.length];
      const nextMeta = AS_STATUS_META[nextStatus];
      const actBtn = `<button class="btn btn-sm" style="background:${nextMeta.bg};color:${nextMeta.color};border:1px solid ${nextMeta.color};font-size:11px;padding:5px 8px;font-weight:700;white-space:nowrap" onclick="event.stopPropagation();cycleAsStatus('${j.id}')" title="현재: ${esc(curStatus)} → 다음: ${esc(nextStatus)}">→ ${nextMeta.icon} ${esc(nextStatus)}</button>`;

      return `<tr style="cursor:pointer${done ? ';background:#D1D5DB' : ''}" onclick="editNewopen('${j.id}')" title="클릭 — 상세 보기">
        <td>${statusBadge}</td>
        <td><b>${esc(store)}</b>${unregBadge}${lineCatBadge}</td>
        <td>${targetBadges}</td>
        <td style="font-size:11px;color:var(--gray-600);font-family:monospace">${esc(recv)}</td>
        <td style="font-size:11px;color:var(--gray-600)">${esc(due || '-')}</td>
        <td>${elapsedTxt}</td>
        <td style="font-size:12px;color:var(--gray-600);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(j.asRequest || j.notes || j.description || '')}">${esc(j.asRequest || j.notes || j.description || '-')}</td>
        <td style="font-size:12px">${eng}</td>
        <td style="text-align:center" onclick="event.stopPropagation()">${actBtn}</td>
      </tr>`;
    }).join('');
  }
  window.hydrateAsMgmt = hydrateAsMgmt;

  function filterAsMgmt(chip, filter) {
    if (chip) {
      chip.parentElement.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    }
    _asMgmtFilter = filter;
    hydrateAsMgmt();
  }
  window.filterAsMgmt = filterAsMgmt;

  function convertConsultToNewopen(jobId) {
    if (!confirm('이 상담을 신규로 전환하시겠습니까?\n\n상담 시 입력한 장비/담당자/메모가 그대로 신규관리로 이전됩니다.\n일정(설치/가오픈/오픈)만 추가 입력하시면 됩니다.')) return;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const j = jobs.find(x => x.id === jobId);
    if (!j) return;
    j.type = '신규';
    j.status = '진행중';
    j.convertedFromConsult = true;
    j.convertedAt = Date.now();
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast(`✅ 신규 전환 완료: ${j.storeName||j.store||''}`);
    try { hydrateConsult('active'); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
    // 신규관리로 이동 + 해당 작업 상세 자동 펼치기 — 일정 입력하기 편하게
    if (typeof showScreen === 'function') showScreen('newopen');
    setTimeout(() => { try { editNewopen(jobId); } catch(e){} }, 250);
  }
  window.convertConsultToNewopen = convertConsultToNewopen;

  function markConsultLost(jobId) {
    if (!confirm('이 상담을 납품 실패로 표시하시겠습니까?')) return;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const j = jobs.find(x => x.id === jobId);
    if (!j) return;
    j.status = '납품실패';
    j.lostAt = Date.now();
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('🛑 납품 실패로 표시됨');
    try { hydrateConsult('active'); } catch(e){}
  }
  window.markConsultLost = markConsultLost;

  function reopenConsult(jobId) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const j = jobs.find(x => x.id === jobId);
    if (!j) return;
    j.status = '상담중';
    delete j.lostAt;
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('↻ 상담 재개됨');
    try { hydrateConsult('active'); } catch(e){}
  }
  window.reopenConsult = reopenConsult;

  function deleteConsult(jobId) {
    if (!confirm('이 상담 기록을 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const idx = jobs.findIndex(x => x.id === jobId);
    if (idx < 0) return;
    // 🪦 클라우드 부활 차단 — 삭제 전에 tombstone 등록 + 즉시 cloud 푸시
    if (typeof _addTombstone === 'function') _addTombstone('job', jobId);
    jobs.splice(idx, 1);
    saveJobs(jobs);
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}
    if (typeof showToast === 'function') showToast('🗑 삭제됨');
    try { hydrateConsult('lost'); } catch(e){}
    try { _refreshAllHubsAfterThread(); } catch(e){}
  }
  window.deleteConsult = deleteConsult;
