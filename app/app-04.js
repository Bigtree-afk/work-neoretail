  /* ════════════════════════════════════════════════════════════
     🎯 _recomputeJobStatus(job) — thread 기반 status 재평가 (공용 헬퍼)
     호출 시점: thread 편집, AS 머지, child 추가/삭제 등 thread 가 바뀐 직후
     규칙:
       - 모든 ROOT 가 child '완료' 가지면 → status='완료'/'처리완료', completed=true, doneAt 셋팅
       - 그 외엔 → '진행중' (AS 는 '접수' 우선, 진행중 entry 있으면 '진행중')
       - 신규(new) 카테고리: openDate 가 오늘 이상이면 자동 완료 차단
     job 객체를 in-place 수정. 호출자가 saveJobs() 와 hub 재렌더 책임짐.
     ════════════════════════════════════════════════════════════ */
  window._recomputeJobStatus = function(job) {
    if (!job) return;
    const arr = Array.isArray(job.thread) ? job.thread : [];
    const norm = (typeof window._threadMigrate === 'function') ? window._threadMigrate(arr) : arr;
    const roots = norm.filter(e => e && e.parentId == null);
    const allRootsDone = roots.length > 0 && roots.every(r => {
      const kids = norm.filter(e => e.parentId === r.threadId);
      return kids.some(k => k.status === '완료');
    });
    const anyProg = norm.some(e => e.status === '진행');
    const cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(job) : '';
    const isAs = (cat === 'as');
    if (allRootsDone) {
      // 신규(new) — openDate 가 오늘 이상이면 자동 완료 차단
      let blockAutoDone = false;
      if (cat === 'new') {
        try {
          const todayStr = (typeof _kstNow === 'function')
            ? String(_kstNow()||'').slice(0,10)
            : new Date().toISOString().slice(0,10);
          const od = String(job.openDate||'').slice(0,10);
          if (od && od >= todayStr) blockAutoDone = true;
        } catch(_){}
      }
      if (blockAutoDone) {
        job.completed = false;
        job.status = '진행중';
      } else {
        job.completed = true;
        const lastDone = norm.filter(e => e.status==='완료').slice(-1)[0]?.ts || '';
        job.doneAt = lastDone;
        job.completedAt = job.completedAt || new Date().toISOString();
        job.status = isAs ? '처리완료' : '완료';
      }
    } else {
      job.completed = false;
      // AS: 진행 entry 있으면 '진행중', 없으면 '접수'
      // 그 외: 진행 entry 있으면 '진행중', 기존 '완료' 면 '진행중' 환원, 아니면 기존 유지
      if (isAs) {
        job.status = anyProg ? '진행중' : '접수';
      } else {
        job.status = anyProg ? '진행중' : (job.status === '완료' ? '진행중' : (job.status || '진행중'));
      }
      job.doneAt = '';
    }
    return job;
  };
  /* 매장 + 카테고리로 hub 변경 트리거 — 공용 헬퍼
     호출자가 saveJobs / pushJobsToCloud 후에 호출. UI 라이브 갱신 보장. */
  window._refreshHubsForCategory = function(cat) {
    try {
      if (typeof _refreshAllHubsAfterThread === 'function') {
        _refreshAllHubsAfterThread();
        return;
      }
    } catch(_){}
    // fallback — 각 hub 직접 호출
    try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(_){}
    try { if (typeof hydrateNewopen === 'function') hydrateNewopen('all'); } catch(_){}
    try { if (typeof hydrateAsMgmt === 'function') hydrateAsMgmt(); } catch(_){}
    try { if (typeof renderAsHub === 'function') renderAsHub(); } catch(_){}
    try { if (typeof renderNewHub === 'function') renderNewHub(); } catch(_){}
    try { if (typeof renderVanHub === 'function') renderVanHub(); } catch(_){}
    try { if (typeof renderSuppliesHub === 'function') renderSuppliesHub(); } catch(_){}
  };
  let _pushJobsTimer = null;
  function schedulePushJobsToCloud() {
    if (_pushJobsTimer) clearTimeout(_pushJobsTimer);
    // KV 일일 쓰기 한도 보호 — 디바운스 5초 (연속 편집을 한번에 묶음)
    _pushJobsTimer = setTimeout(() => { pushJobsToCloud(); }, 5000);
  }
  async function pushJobsToCloud(opts) {
    const jobs = (function(){ try { return JSON.parse(localStorage.getItem('ns_jobs')||'[]'); } catch { return []; } })();
    // 🪦 threadTombstones — 로컬 ns_tombstones 중 thread / thread-children 만 추출해 서버에 동봉.
    //   서버는 deleted_threads / deleted_thread_children KV 키에 union 등록 후
    //   incoming/cloud jobs 의 thread 에서 자동 제거 → 다른 PC 도 자동 차단됨.
    //   token 인증 불필요 (jobs.js POST 무인증 라우트라 모든 클라이언트가 활용 가능).
    const _allTombs = (function(){ try { return JSON.parse(localStorage.getItem('ns_tombstones') || '[]'); } catch { return []; } })();
    const threadTombstones = _allTombs
      .filter(t => t && (t.type === 'thread' || t.type === 'thread-children'))
      .map(t => ({
        type: t.type,
        threadId: t.id,
        jobId: t.jobId || null,
        deletedAt: t.ts ? new Date(t.ts).toISOString() : new Date().toISOString(),
        reason: t.reason || 'client-tombstone'
      }));
    // 🪦 jobTombstones (보강 C) — job 단위 삭제도 토큰 없이 서버 deleted_jobs 등록
    const jobTombstones = _allTombs
      .filter(t => t && t.type === 'job')
      .map(t => ({
        id: t.id,
        deletedAt: t.ts ? new Date(t.ts).toISOString() : new Date().toISOString(),
        reason: t.reason || 'client-tombstone'
      }));
    const _payload = { jobs };
    if (threadTombstones.length) _payload.threadTombstones = threadTombstones;
    // jobTombstones 전파 규칙:
    //   ① reconcile 완료(flag) → 전체 전파.
    //   ② reconcile 전이라도 '방금(10분 내) 사용자가 삭제한 건'은 전파 — flag 미설정 기기에서
    //      삭제가 통째로 안 올라가던 문제 fix. 옛 stale 대량삭제는 시간창으로 차단(deletion-wins 방지).
    let _reconciledPC = false; try { _reconciledPC = !!localStorage.getItem('ns_jobtomb_reconcile_v2'); } catch(_){}
    if (jobTombstones.length) {
      if (_reconciledPC) {
        _payload.jobTombstones = jobTombstones;
      } else {
        const _now = Date.now();
        const fresh = _allTombs
          .filter(t => t && t.type === 'job' && (_now - (t.ts || 0)) < 600000)
          .map(t => ({ id: t.id, deletedAt: t.ts ? new Date(t.ts).toISOString() : new Date().toISOString(), reason: t.reason || 'client-tombstone' }));
        if (fresh.length) _payload.jobTombstones = fresh;
      }
    }
    const body = JSON.stringify(_payload);
    // ── content-skip: 직전에 push 한 내용과 동일하면 네트워크 호출 자체를 생략 (KV 쓰기 절감)
    const h = window._fastHash(body);
    if (!opts || !opts.force) {
      if (window._lastJobsPushHash === h) {
        return { ok:true, skipped:true, count: jobs.length };
      }
    }
    // 🔁 푸시 실패 시 자동 재시도 — 일시 오류로 작업이 로컬에만 묶이는 것 방지.
    //   KV 한도초과 제외, 최대 4회 백오프(8s,16s,24s,32s). 성공 시 카운터 리셋.
    const _retryPush = () => {
      window._pushRetryN = (window._pushRetryN || 0) + 1;
      if (window._pushRetryN > 4) return;
      const delay = Math.min(60000, 8000 * window._pushRetryN);
      setTimeout(() => { try { window.pushJobsToCloud(); } catch(_){} }, delay);
    };
    try {
      const res = await fetch('/api/jobs', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body,
      });
      if (!res.ok) {
        let detail = ''; try { detail = await res.text(); } catch(_){}
        const limitHit = /KV put.*limit exceeded/i.test(detail);
        if (limitHit) {
          // KV 일일 쓰기 한도 — 사용자에게 1회만 친절 안내
          if (!window._kvLimitToastShown) {
            window._kvLimitToastShown = true;
            try { if (typeof showToast === 'function') showToast('⚠ 클라우드 동기화 한도 초과 — 한국 시간 익일 09:00 자동 해제 (로컬 저장은 정상)'); } catch(_){}
          }
        } else if (opts && opts.toast && typeof showToast === 'function') {
          showToast(`⚠ 작업 클라우드 푸시 실패 (${res.status}): ${detail.slice(0,80)}`);
        }
        if (!limitHit) _retryPush();   // 일시 실패 → 자동 재시도
        return { ok:false, status:res.status, limitHit };
      }
      const data = await res.json();
      window._lastJobsPushHash = h;
      window._pushRetryN = 0;   // 성공 → 재시도 카운터 리셋
      if (opts && opts.toast && typeof showToast === 'function') showToast(`☁ 작업 클라우드 동기화 완료 (${data.count}건)`);
      return { ok:true, ...data };
    } catch(e) {
      if (opts && opts.toast && typeof showToast === 'function') showToast('⚠ 작업 클라우드 푸시 실패 (네트워크)');
      _retryPush();   // 네트워크 오류 → 자동 재시도
      return { ok:false, error:String(e) };
    }
  }
  window.pushJobsToCloud = pushJobsToCloud;
  // 작업 일정일 — j.date 만 사용. 날짜 미정(null/빈값)은 빈 문자열 반환.
  // 일정이 확정되지 않은 작업이 많으므로 createdAt 으로 자동 fallback 하지 않는다
  // (그렇지 않으면 "이번달 작업" 카운트에 등록만 한 미정 작업이 잡혀버림)
  function jobDateStr(j) {
    if (!j || !j.date) return '';
    return String(j.date);
  }

  /* ══════════════════════════════════════════════
     사이트 전역 LIVE SYNC — 새로고침 없이 데이터 변경 자동 반영
     ─────────────────────────────────────────────
     원칙:
     1) 탭이 포커스/가시 상태가 되면 즉시 cloud 동기화
     2) 탭이 가시 상태이면 INTERVAL(기본 20초) 마다 백그라운드 동기화
     3) 동일 브라우저의 다른 탭이 데이터 변경하면 storage 이벤트로 즉시 반영
     4) 데이터 변경 감지되면 'ns:data-changed' 이벤트 발행
     5) 활성 화면별 renderer 가 이벤트 듣고 자체 재렌더 (스크롤/입력 상태 보존)

     화면 추가 시 규칙:
       - 그 화면이 ns_jobs / ns_stores / ns_users 등을 보여준다면
       - document.addEventListener('ns:data-changed', () => 자기_renderer()) 등록
       - 활성 여부는 screen.active 클래스 / 모달 표시 여부로 가드
  ══════════════════════════════════════════════ */
  window.NS_LIVE = (function(){
    const INTERVAL_MS = 20 * 1000;   // 20초 — 가시 상태일 때 백그라운드 polling
    const MIN_GAP_MS  = 4 * 1000;    // 4초 — 연속 sync 방지 throttle
    let _lastSync = 0;
    let _intervalTimer = null;
    let _busy = false;

    // 데이터 hash — 변경 감지용 (jobs/stores 단순 길이 + updatedAt)
    function _snapshotHash() {
      try {
        // ⚡ A-5 — JSON.parse(1.4MB) 제거. raw 문자열 content-hash 로 변경 감지(파싱 없음).
        const j = localStorage.getItem('ns_jobs') || '';
        const s = localStorage.getItem('ns_stores') || '';
        return window._fastHash ? (window._fastHash(j) + '/' + window._fastHash(s)) : (j.length + '/' + s.length);
      } catch { return ''; }
    }

    async function sync(opts) {
      opts = opts || {};
      if (_busy) return;
      const now = Date.now();
      if (!opts.force && (now - _lastSync) < MIN_GAP_MS) return;
      _lastSync = now;
      _busy = true;
      const before = _snapshotHash();
      try {
        if (typeof window.syncJobsFromCloud === 'function') await window.syncJobsFromCloud({ auto: !opts.force });
        if (typeof window.syncFromCloud === 'function')      await window.syncFromCloud({ silent:true, auto: !opts.force });
      } catch(e) { /* 네트워크 실패 무시 */ }
      _busy = false;
      const after = _snapshotHash();
      if (before !== after) {
        try { document.dispatchEvent(new CustomEvent('ns:data-changed', { detail:{ before, after } })); } catch(e){}
      }
    }

    function start() {
      stop();
      if (document.visibilityState === 'visible') {
        _intervalTimer = setInterval(() => sync(), INTERVAL_MS);
      }
    }
    function stop() {
      if (_intervalTimer) { clearInterval(_intervalTimer); _intervalTimer = null; }
    }

    // 이벤트 와이어링
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { sync({ force:true }); start(); }
      else stop();
    });
    window.addEventListener('focus', () => sync({ force:true }));
    // 동일 브라우저 다른 탭의 변경
    window.addEventListener('storage', (e) => {
      if (!e || !e.key) return;
      if (/^ns_(jobs|stores|users|comments)$/.test(e.key)) {
        try { document.dispatchEvent(new CustomEvent('ns:data-changed', { detail:{ src:'storage', key:e.key } })); } catch(_){}
      }
    });
    // 시작
    document.addEventListener('DOMContentLoaded', () => setTimeout(start, 1500));

    return { sync, start, stop };
  })();

  /* ════════════════════════════════════════════════════════════
     NS_UPLOAD — 첨부 (이미지+파일) 업로드 공통 모듈
     ────────────────────────────────────────────────────────────
     사용:
       const ctl = NS_UPLOAD.mount(containerEl, {
         initial: [],                  // 기존 attachments 배열
         category: 'as',               // (선택) 메타용
         jobId, threadId,              // (선택) 메타용
         max: 50,                      // (선택) 카드 최대 수
         readonly: false,              // (선택) true 면 보기 전용
         onChange: (attachments) => {} // (선택) 변경 시 콜백
       });
       ctl.get()  → attachments 배열 반환
       ctl.set(arr) → 외부에서 강제 지정
       ctl.destroy()

     attachments[] 항목 형태:
       { kind:'image', key, url, size, w?, h?, uploadedAt, uploadedBy }
       { kind:'file',  key, url, name, ext, mime, size, previewable, ... }
  ════════════════════════════════════════════════════════════ */
  window.NS_UPLOAD = (function(){
    const MAX_IMAGE_DIM = 1600;       // 압축 시 긴 변 한도
    const JPEG_QUALITY  = 0.85;
    const FILE_MAX_MB   = 50;
    const IMG_MAX_MB    = 10;
    const FILE_EXT_OK   = new Set(['pdf','hwp','hwpx','docx','doc','xlsx','xls','pptx','ppt','zip','txt','csv']);
    const FILE_EXT_BAD  = new Set(['exe','bat','ps1','sh','js','cmd','com','scr','msi','dll','vbs','jar','apk']);
    const PREVIEWABLE   = new Set(['pdf','docx','xlsx','pptx']);

    let _heicLoading = null;
    function _ensureHeic2Any(){
      if (window.heic2any) return Promise.resolve();
      if (_heicLoading) return _heicLoading;
      _heicLoading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = window.NS_HEIC2ANY_CDN || 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
        s.onload = () => res();
        s.onerror = () => rej(new Error('heic2any load failed'));
        document.head.appendChild(s);
      });
      return _heicLoading;
    }

    function _isHeic(file){
      const m = (file.type || '').toLowerCase();
      const n = (file.name || '').toLowerCase();
      return m === 'image/heic' || m === 'image/heif' || n.endsWith('.heic') || n.endsWith('.heif');
    }
    function _isImage(file){
      const m = (file.type || '').toLowerCase();
      return m.startsWith('image/') || _isHeic(file);
    }
    function _extOf(name){
      const m = (name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
      return m ? m[1] : '';
    }
    function _human(bytes){
      if (bytes < 1024) return bytes + 'B';
      if (bytes < 1024*1024) return (bytes/1024).toFixed(0) + 'KB';
      return (bytes/1024/1024).toFixed(1) + 'MB';
    }
    function _loadImage(blob){
      return new Promise((res, rej) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); res(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
        img.src = url;
      });
    }
    async function _compressImage(blob){
      const img = await _loadImage(blob);
      const longSide = Math.max(img.width, img.height);
      const scale = longSide > MAX_IMAGE_DIM ? (MAX_IMAGE_DIM / longSide) : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      return new Promise(res => canvas.toBlob(b => res({ blob:b, w, h }), 'image/jpeg', JPEG_QUALITY));
    }

    function _currentUser(){
      try {
        const u = JSON.parse(localStorage.getItem('ns_current_user') || 'null');
        return u?.email || u?.name || '';
      } catch { return ''; }
    }

    function _uploadXhr(blob, meta, onProgress){
      return new Promise((res, rej) => {
        const fd = new FormData();
        fd.append('file', blob, meta.name || 'upload');
        if (meta.kind)     fd.append('kind', meta.kind);
        if (meta.name)     fd.append('name', meta.name);
        if (meta.jobId)    fd.append('jobId', meta.jobId);
        if (meta.category) fd.append('category', meta.category);
        if (meta.threadId) fd.append('threadId', meta.threadId);
        if (meta.uploadedBy) fd.append('uploadedBy', meta.uploadedBy);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
          let body; try { body = JSON.parse(xhr.responseText); } catch {}
          if (xhr.status >= 200 && xhr.status < 300 && body?.ok) res(body);
          else rej(new Error(body?.error || ('HTTP ' + xhr.status)));
        };
        xhr.onerror = () => rej(new Error('network_error'));
        xhr.ontimeout = () => rej(new Error('timeout'));
        xhr.timeout = 120000; // 2분
        xhr.send(fd);
      });
    }

    // ─── 마운트 ─────────────────────────────
    function mount(container, opts){
      opts = opts || {};
      let attachments = Array.isArray(opts.initial) ? opts.initial.slice() : [];
      const readonly = !!opts.readonly;
      const max = opts.max || 50;
      const onChange = opts.onChange || function(){};
      const category = opts.category || '';
      const jobId    = opts.jobId    || '';
      const threadId = opts.threadId || '';

      container.innerHTML = '';
      const root = document.createElement('div');
      root.className = 'ns-uploader';
      root.innerHTML = `
        <div class="ns-uploader-head">
          <span class="lbl">📷📎 첨부</span>
          <span class="cnt"></span>
          <span class="quota"></span>
        </div>
        <div class="ns-uploader-grid"></div>
      `;
      container.appendChild(root);

      const grid    = root.querySelector('.ns-uploader-grid');
      const cntEl   = root.querySelector('.cnt');
      const quotaEl = root.querySelector('.quota');

      function _save(){
        onChange(attachments.slice());
        _renderHeader();
      }
      function _renderHeader(){
        const imgs  = attachments.filter(a => a.kind==='image').length;
        const files = attachments.filter(a => a.kind==='file').length;
        const total = attachments.reduce((s,a)=>s+(a.size||0),0);
        cntEl.textContent = `사진 ${imgs} · 파일 ${files}`;
        quotaEl.textContent = `총 ${_human(total)} · 최대 ${max}개`;
      }

      function _cardImage(att){
        const el = document.createElement('div');
        el.className = 'ns-up-photo';
        if (att.url) el.style.backgroundImage = `url("${att.url}")`;
        el.title = att.uploadedBy ? `${att.uploadedBy}` : '';
        el.onclick = (e) => {
          if (e.target.classList.contains('ns-up-del')) return;
          const idx = attachments.indexOf(att);
          NS_LIGHTBOX.open(attachments, idx);
        };
        if (!readonly) {
          const del = document.createElement('span');
          del.className = 'ns-up-del';
          del.textContent = '×';
          del.onclick = () => _remove(att);
          el.appendChild(del);
        }
        return el;
      }
      function _cardFile(att){
        const ext = (att.ext || '').toLowerCase();
        const el = document.createElement('div');
        el.className = 'ns-up-file';
        const iconCls = FILE_EXT_OK.has(ext) ? ext : 'etc';
        el.innerHTML = `
          <div class="ficon ${iconCls}">${(ext||'?').toUpperCase().slice(0,4)}</div>
          <div class="fmeta">
            <div class="fname">${_escape(att.name || att.key || '파일')}</div>
            <div class="fsize">${_human(att.size||0)}${att.previewable?' · 미리보기':''}</div>
          </div>
        `;
        el.onclick = (e) => {
          if (e.target.classList.contains('ns-up-del')) return;
          const idx = attachments.indexOf(att);
          NS_LIGHTBOX.open(attachments, idx);
        };
        if (!readonly) {
          const del = document.createElement('span');
          del.className = 'ns-up-del';
          del.textContent = '×';
          del.onclick = () => _remove(att);
          el.appendChild(del);
        }
        return el;
      }
      function _cardUploading(item, isImage){
        const el = document.createElement(isImage ? 'div' : 'div');
        el.className = isImage ? 'ns-up-photo uploading' : 'ns-up-file uploading';
        if (isImage) {
          el.innerHTML = (item.heic ? '<span class="ns-up-heic-tag">HEIC→JPG</span>' : '')
            + '<div class="ns-up-spinner"></div>'
            + '<div class="ns-up-progress"><b style="width:0%"></b></div>';
        } else {
          const ext = _extOf(item.file?.name||'') || 'etc';
          const cls = FILE_EXT_OK.has(ext) ? ext : 'etc';
          el.innerHTML = `
            <div class="ficon ${cls}">${(ext||'?').toUpperCase().slice(0,4)}</div>
            <div class="fmeta">
              <div class="fname">${_escape(item.file?.name||'업로드 중')}</div>
              <div class="fsize">업로드 중 0%</div>
            </div>
            <div class="ns-up-progress"><b style="width:0%"></b></div>
          `;
        }
        return el;
      }
      function _cardError(item, message, retryFn){
        const el = document.createElement('div');
        el.className = 'ns-up-photo error';
        el.innerHTML = `<button class="ns-up-retry">↻ 재시도</button>`;
        el.querySelector('.ns-up-retry').onclick = () => retryFn();
        el.title = '실패: ' + (message||'unknown');
        const del = document.createElement('span');
        del.className = 'ns-up-del';
        del.textContent = '×';
        del.onclick = () => { _removeNode(el); };
        el.appendChild(del);
        return el;
      }
      function _addBtn(){
        const el = document.createElement('div');
        el.className = 'ns-up-photo ns-up-add';
        el.innerHTML = `<span class="plus">＋</span><span>추가</span><span class="hint">사진+파일</span>`;
        el.onclick = () => _pickFiles();
        return el;
      }
      function _pickFiles(){
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*,application/pdf,.hwp,.hwpx,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.zip,.txt,.csv';
        // 모바일에서 카메라 우선이 아니라 OS 시트로 선택 — capture 미설정
        input.onchange = () => _handleFiles(Array.from(input.files || []));
        input.click();
      }

      async function _handleFiles(files){
        for (const f of files) {
          if (attachments.length >= max) {
            alert(`최대 ${max}개까지 첨부 가능합니다.`);
            break;
          }
          _processOne(f);
        }
      }

      async function _processOne(file){
        const isImg = _isImage(file);
        const heic = _isHeic(file);

        // 화이트리스트 검사 (파일)
        if (!isImg) {
          const ext = _extOf(file.name);
          if (!ext) {
            alert('확장자를 알 수 없는 파일은 첨부할 수 없습니다: ' + file.name);
            return;
          }
          if (FILE_EXT_BAD.has(ext)) {
            alert('보안상 차단된 파일 형식입니다: .' + ext);
            return;
          }
          if (!FILE_EXT_OK.has(ext)) {
            alert('지원하지 않는 파일 형식입니다: .' + ext);
            return;
          }
          if (file.size > FILE_MAX_MB * 1024 * 1024) {
            alert(`파일 크기는 ${FILE_MAX_MB}MB 이하만 가능합니다.`);
            return;
          }
        }

        // placeholder 카드
        const placeholderCard = _cardUploading({ file, heic }, isImg);
        _insertBeforeAdd(placeholderCard);

        const setProgress = (frac) => {
          const bar = placeholderCard.querySelector('.ns-up-progress > b');
          if (bar) bar.style.width = Math.round(frac*100) + '%';
          const sz = placeholderCard.querySelector('.fsize');
          if (sz) sz.textContent = '업로드 중 ' + Math.round(frac*100) + '%';
        };

        const doUpload = async () => {
          try {
            let blob = file, name = file.name, kind = isImg ? 'image' : 'file';
            if (isImg) {
              if (heic) {
                await _ensureHeic2Any();
                const out = await window.heic2any({ blob:file, toType:'image/jpeg', quality: JPEG_QUALITY });
                blob = Array.isArray(out) ? out[0] : out;
                name = name.replace(/\.heic$|\.heif$/i, '.jpg');
              }
              // 리사이즈+압축
              const compressed = await _compressImage(blob);
              blob = compressed.blob;
              if (blob.size > IMG_MAX_MB * 1024 * 1024) {
                throw new Error('압축 후에도 ' + IMG_MAX_MB + 'MB 초과');
              }
            }
            const res = await _uploadXhr(blob, {
              kind, name, jobId, category, threadId, uploadedBy: _currentUser(),
            }, setProgress);

            // 성공 → placeholder 교체
            const att = {
              kind: res.kind,
              key:  res.key,
              url:  res.url,
              name: res.name || name,
              ext:  res.ext  || _extOf(name),
              mime: res.mime,
              size: res.size,
              w: res.w, h: res.h,
              previewable: res.previewable,
              uploadedAt: res.uploadedAt,
              uploadedBy: res.uploadedBy,
            };
            attachments.push(att);
            const newCard = (att.kind === 'image') ? _cardImage(att) : _cardFile(att);
            grid.replaceChild(newCard, placeholderCard);
            _save();
          } catch (e) {
            const msg = String(e?.message || e);
            const errCard = _cardError({}, msg, doUpload);
            grid.replaceChild(errCard, placeholderCard);
          }
        };
        doUpload();
      }

      function _insertBeforeAdd(node){
        const addBtn = grid.querySelector('.ns-up-add');
        if (addBtn) grid.insertBefore(node, addBtn);
        else grid.appendChild(node);
      }

      function _remove(att){
        // 휴지통 이동 (실패해도 UI 에서는 제거 — 백그라운드 best-effort)
        if (att.key) {
          fetch('/api/delete-attachment', {
            method:'POST', headers:{'content-type':'application/json'},
            body: JSON.stringify({ key: att.key }),
          }).catch(()=>{});
        }
        attachments = attachments.filter(a => a !== att);
        _renderAll();
        _save();
      }
      function _removeNode(node){ if (node && node.parentNode) node.parentNode.removeChild(node); }

      function _renderAll(){
        grid.innerHTML = '';
        attachments.forEach(att => {
          grid.appendChild(att.kind === 'image' ? _cardImage(att) : _cardFile(att));
        });
        if (!readonly) grid.appendChild(_addBtn());
        _renderHeader();
      }

      function _escape(s){
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      }

      _renderAll();

      return {
        get: () => attachments.slice(),
        set: (arr) => { attachments = Array.isArray(arr)?arr.slice():[]; _renderAll(); _save(); },
        destroy: () => { container.innerHTML = ''; },
      };
    }

    return { mount };
  })();

  /* ════════════════════════════════════════════════════════════
     NS_LIGHTBOX — 첨부 뷰어 (이미지 + PDF + Office 미리보기)
     ────────────────────────────────────────────────────────────
     NS_LIGHTBOX.open(attachments, startIndex)
       이미지: <img>
       PDF:    iframe src=R2 URL (브라우저 내장 PDF 뷰어)
       Office (docx/xlsx/pptx): iframe src=Office Online Viewer
       기타 (hwp/zip 등): 다운로드 버튼
  ════════════════════════════════════════════════════════════ */
  window.NS_LIGHTBOX = (function(){
    let _root = null;
    let _items = [];
    let _idx = 0;

    function _esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    function _absUrl(url){
      if (!url) return '';
      if (/^https?:\/\//.test(url)) return url;
      // 상대 URL → 절대 URL (Office Viewer 는 절대 URL 필요)
      return new URL(url, location.origin).toString();
    }

    function _renderStage(att){
      const ext = (att.ext || '').toLowerCase();
      if (att.kind === 'image') {
        return `<img class="ns-lbox-img" src="${_esc(att.url)}" alt="">`;
      }
      if (ext === 'pdf') {
        return `<iframe class="ns-lbox-iframe" src="${_esc(att.url)}#toolbar=1"></iframe>`;
      }
      if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
        const src = 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(_absUrl(att.url));
        return `<iframe class="ns-lbox-iframe" src="${_esc(src)}"></iframe>`;
      }
      // 미리보기 불가
      const iconColor = ({hwp:'#1D4ED8',hwpx:'#1D4ED8',zip:'#6D28D9',txt:'#6B7280',csv:'#6B7280'})[ext] || '#6B7280';
      const dlUrl = att.url + (att.url.includes('?') ? '&' : '?') + 'dl=1';
      return `
        <div class="ns-lbox-fallback">
          <div class="bigicon" style="background:${iconColor}">${(ext||'?').toUpperCase().slice(0,4)}</div>
          <div style="font-size:15px;font-weight:700">${_esc(att.name || '파일')}</div>
          <div style="font-size:11.5px;opacity:.7;margin-top:4px">브라우저에서 미리보기 불가</div>
          <a class="ns-lbox-dl" href="${_esc(dlUrl)}" download>⬇ 다운로드해서 열기</a>
        </div>
      `;
    }
    function _renderInfo(att){
      const parts = [];
      if (att.kind==='image') parts.push('📷 사진'); else parts.push('📎 ' + (att.ext||'파일').toUpperCase());
      parts.push((_idx+1) + ' / ' + _items.length);
      if (att.uploadedBy) parts.push(att.uploadedBy);
      if (att.uploadedAt) {
        try { parts.push(new Date(att.uploadedAt).toLocaleString('ko-KR',{hour12:false})); } catch{}
      }
      if (att.size) parts.push(_human(att.size));
      return parts.join(' · ');
    }
    function _human(b){
      if (b<1024) return b+'B';
      if (b<1024*1024) return (b/1024).toFixed(0)+'KB';
      return (b/1024/1024).toFixed(1)+'MB';
    }

    function _render(){
      const att = _items[_idx];
      if (!att || !_root) return;
      _root.querySelector('.ns-lbox-stage').innerHTML = _renderStage(att);
      _root.querySelector('.ns-lbox-info').innerHTML = _renderInfo(att);
      _root.querySelector('.ns-lbox-nav.prev').style.display = (_items.length>1) ? '' : 'none';
      _root.querySelector('.ns-lbox-nav.next').style.display = (_items.length>1) ? '' : 'none';
    }
    function _prev(){ if (_items.length<2) return; _idx = (_idx-1+_items.length)%_items.length; _render(); }
    function _next(){ if (_items.length<2) return; _idx = (_idx+1)%_items.length; _render(); }
    function _onKey(e){
      if (!_root) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') _prev();
      else if (e.key === 'ArrowRight') _next();
    }

    function open(attachments, startIdx){
      _items = (attachments||[]).filter(a => a && a.url);
      if (!_items.length) return;
      _idx = Math.max(0, Math.min(startIdx||0, _items.length-1));
      if (!_root) {
        _root = document.createElement('div');
        _root.className = 'ns-lbox';
        _root.innerHTML = `
          <button class="ns-lbox-close" title="닫기 (Esc)">×</button>
          <button class="ns-lbox-nav prev" title="이전">‹</button>
          <button class="ns-lbox-nav next" title="다음">›</button>
          <div class="ns-lbox-stage"></div>
          <div class="ns-lbox-info"></div>
        `;
        _root.querySelector('.ns-lbox-close').onclick = close;
        _root.querySelector('.ns-lbox-nav.prev').onclick = _prev;
        _root.querySelector('.ns-lbox-nav.next').onclick = _next;
        _root.onclick = (e) => { if (e.target === _root) close(); };
        document.body.appendChild(_root);
        document.addEventListener('keydown', _onKey);
      }
      _render();
    }
    function close(){
      if (!_root) return;
      document.removeEventListener('keydown', _onKey);
      _root.remove();
      _root = null;
      _items = []; _idx = 0;
    }

    return { open, close };
  })();

  /* ════════════════════════════════════════════════════════════
     LINE 메시지 본문 길이 — UTF-8 byte 기준 (한글 3byte, ASCII 1byte)
     · 헤더 본문(headContent) 최대 140byte
     · 한 LINE 메시지 전체는 LINE API 한도 4900자 유지 (서버측)
   ════════════════════════════════════════════════════════════ */
  window._LINE_HEAD_BYTES = 600;   // 처리내용 헤더 한도 — 200자(한글 기준 ≈600byte)까지 허용 (이전 140)
  window._byteLen = function(s) {
    s = String(s == null ? '' : s);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }   // surrogate pair (이모지)
      else n += 3;
    }
    return n;
  };
  window._sliceByByte = function(s, maxBytes) {
    s = String(s == null ? '' : s);
    if (window._byteLen(s) <= maxBytes) return s;
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
  };

  /* ════════════════════════════════════════════════════════════
     _buildEnrichedLineText — 카테고리 공용 다중 라인 메시지 빌더
     ────────────────────────────────────────────────────────────
     포맷:
       매장명 : 처리일 ; 본문(≤140byte)
       📅 일정
       📊 규모 / 옵션
       💰 결과 (완료 시)
       👤 담당 ... / 거래처 ...

     opts.category : 'stocktake' | 'as' | 'newjob' | 'van' | ...
     opts.headContent : 본문(content) — 미지정 시 상태 기반 자동
     opts.scheduleLabel : '📅 조사예정' | '📅 처리예정' | '📅 설치예정' (카테고리별 라벨)
   ════════════════════════════════════════════════════════════ */
  window._buildEnrichedLineText = function(rec, opts) {
    if (!rec) return '';
    opts = opts || {};
    const status = rec.status || rec.statusLabel || '';
    const todayKst = (function(){
      // 🕐 KST 날짜 — 브라우저 타임존 무관 절대 보정 (UTC+9). 기존 getTimezoneOffset 방식은
      //   브라우저가 이미 KST 면 +9h 이중 적용 → 오후 등록이 다음날로 밀리는 버그. (2026-05-28 fix)
      return new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10);
    })();
    const processDate = opts.processDate || rec.doneDate || rec.scheduleDate || rec.consultDate || rec.dueDate || rec.date || todayKst;
    const storeName = rec.storeName || rec.store || '';
    let content = opts.headContent || '';
    if (!content) {
      const head = (rec.memo || rec.text || rec.request || '').replace(/\s+/g,' ').trim();
      content = (typeof window._sliceByByte === 'function')
              ? window._sliceByByte(head, window._LINE_HEAD_BYTES || 140)
              : head.slice(0, 140);
      if (!content) content = status || '업무 등록';
    }
    const headLine = `${storeName} : ${processDate} ; ${content}`;

    const lines = [];
    // 일정
    const schedLabel = opts.scheduleLabel || '📅 예정';
    const sd = rec.scheduleDate || rec.dueDate || rec.installDate || rec.softOpenDate || rec.openDate;
    if (sd && sd !== processDate) lines.push(`${schedLabel} ${sd}`);
    // 규모
    const sizeParts = [];
    if (rec.area)        sizeParts.push(`${rec.area}평`);
    if (rec.headcount)   sizeParts.push(`${rec.headcount}명`);
    if (rec.fee)         sizeParts.push(`수수료 ${Number(rec.fee).toLocaleString('ko-KR')}원`);
    if (sizeParts.length) lines.push(`📊 ${sizeParts.join(' · ')}`);
    // 완료 시 결과
    if (/(완료|정산|마감)/.test(status)) {
      const res = [];
      if (rec.expectedAmount && rec.actualAmount) res.push(`예상 → 실 ${Number(rec.expectedAmount).toLocaleString('ko-KR')} → ${Number(rec.actualAmount).toLocaleString('ko-KR')}원`);
      if (typeof rec.margin === 'number')         res.push(`수익 ${rec.margin >= 0 ? '+':''}${rec.margin.toLocaleString('ko-KR')}원`);
      if (rec.paymentMethod)                      res.push(`수금 ${rec.paymentMethod}`);
      if (res.length) lines.push(`💰 ${res.join(' · ')}`);
    }
    // 담당자
    const owner = rec.owner || rec.engineer || rec.assignee || (((typeof _currentAuthName==='function') ? _currentAuthName() : '') || '');
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
  };

  /* ════════════════════════════════════════════════════════════
     _supplyItemSummary — 소모품 job 으로부터 "품목명 수량단위" 문자열 생성
     ────────────────────────────────────────────────────────────
     예: { type:'소모품/POS용지', supplyQty:1, supplyUnit:'개' } → 'POS용지 1개'
     LINE 발송 본문 / 발송 이력 표시에 공통 사용
  ════════════════════════════════════════════════════════════ */
  window._supplyItemSummary = function(job, opts) {
    if (!job) return '';
    opts = opts || {};
    // 규격(spec) 포함된 품목 매핑 — hub sub-card 와 동일
    const SUPPLY_DISPLAY = {
      '소모품/POS용지':   { name: 'POS용지',         spec: '3"'    },
      '소모품/단말용지':  { name: '이동단말기 용지', spec: '57×30' },
      '소모품/가격라벨':  { name: '가격라벨',        spec: '40×23' },
      '소모품/프라이스텍':{ name: '프라이스텍',      spec: '70×35' },
      '소모품/저울라벨':  { name: '저울라벨',        spec: '58×40' },
      '소모품/기타':      { name: '기타',            spec: ''      },
    };
    const typeKey = String(job.type||'');
    const disp = SUPPLY_DISPLAY[typeKey];
    if (!disp) return '';
    // ✏️ '소모품/기타' 는 사용자가 입력한 supplyEtcName 우선
    let itemName = disp.name;
    if (typeKey === '소모품/기타') {
      const etc = String(job.supplyEtcName||'').trim();
      if (etc) itemName = etc;
    }
    // 수량 + 단위
    let qty = Number(job.supplyQty);
    let unit = job.supplyUnit || '';
    if (!Number.isFinite(qty) || qty === 0) {
      const m = String(job.supplyQty||'').match(/(\d+(?:\.\d+)?)\s*(\S*)/);
      if (m) { qty = parseFloat(m[1])||0; if (!unit && m[2]) unit = m[2]; }
    }
    const qtyTxt = (qty > 0) ? `${qty}${unit||'개'}` : '';
    // 🔧 규격 prefix — opts.withSpec=true 면 '3" POS용지' 형태로
    const headPart = (opts.withSpec && disp.spec) ? `${disp.spec} ${itemName}` : itemName;
    const namePart = qtyTxt ? `${headPart} ${qtyTxt}` : headPart;
    // 🔧 처리구분 emoji — opts.withMode=true 면 '🎁 지원' / '💰 선불' / '📌 후불' 부착
    if (opts.withMode) {
      const mode = job.supplyMode || ((Number(job.amount)||0) > 0 ? 'prepaid' : 'support');
      const modeMap = { support:'🎁 지원', prepaid:'💰 선불', postpaid:'📌 후불' };
      const modeTxt = modeMap[mode] || '';
      return modeTxt ? `${namePart} ${modeTxt}` : namePart;
    }
    return namePart;
  };

  /* ════════════════════════════════════════════════════════════
     _openLineForJob — AS/신규/VAN job 객체로 LINE composer 열기
     ────────────────────────────────────────────────────────────
     job: jobs[] 의 객체 (또는 thread root/entry)
     opts.entry: thread 항목(있으면 그 항목 텍스트를 본문으로 사용)
     opts.category: 명시적 카테고리 ('as'|'newjob'|'van' 자동 감지 가능)
   ════════════════════════════════════════════════════════════ */
  window._openLineForJob = function(job, opts) {
    if (!job) return;
    opts = opts || {};
    // 카테고리 자동 감지 — classifyJobCategory 우선, fallback 으로 type 패턴 매칭
    let category = opts.category;
    if (!category) {
      let detected = '';
      try { if (typeof window.classifyJobCategory === 'function') detected = window.classifyJobCategory(job); } catch(_){}
      // classifyJobCategory: 'as' | 'new' | 'van' | 'supplies' | 'churn'
      if (detected === 'supplies') category = 'supply';
      else if (detected === 'new')  category = 'newjob';
      else if (detected === 'as')   category = 'as';
      else if (detected === 'van')  category = 'van';
      else {
        const tp = String(job.type || '');
        if (/소모품|supply|supplies/i.test(tp))       category = 'supply';
        else if (/AS|에이에스/i.test(tp))             category = 'as';
        else if (/VAN/i.test(tp) || job.vanRegistration) category = 'van';
        else category = 'newjob';
      }
    }
    const labelMap = { as:'🔧 AS', newjob:'🆕 신규', van:'💳 VAN', stocktake:'📦 재고조사', supply:'🛒 소모품' };
    const scheduleLabelMap = { as:'📅 처리예정', newjob:'📅 설치예정', van:'📅 진행일', stocktake:'📅 조사예정', supply:'📅 발송예정' };

    // entry 가 주어지면 그 텍스트를 본문으로, 아니면 job 최신 ROOT/메모 사용
    const entry = opts.entry;
    let headContent = '';
    let attachments = Array.isArray(job.attachments) ? job.attachments.slice() : [];
    const _bSlice = (s) => (typeof window._sliceByByte === 'function')
                          ? window._sliceByByte(s, window._LINE_HEAD_BYTES || 140)
                          : String(s||'').slice(0, 140);
    if (entry) {
      headContent = _bSlice((entry.text || '').replace(/\s+/g,' ').trim());
      if (Array.isArray(entry.attachments) && entry.attachments.length) {
        attachments = entry.attachments;
      }
    } else if (Array.isArray(job.thread) && job.thread.length) {
      // 최신 항목 (ts 기준)
      const latest = job.thread.slice().sort((a,b)=>(b.ts||'').localeCompare(a.ts||''))[0];
      if (latest) {
        headContent = _bSlice((latest.text || '').replace(/\s+/g,' ').trim());
        if (Array.isArray(latest.attachments) && latest.attachments.length) {
          // job-level + thread-level 합치기 (중복 제거 by key/url)
          const seen = new Set(attachments.map(a => a.key || a.url));
          latest.attachments.forEach(a => {
            const k = a.key || a.url;
            if (!seen.has(k)) { attachments.push(a); seen.add(k); }
          });
        }
      }
    }
    if (!headContent) headContent = _bSlice(job.memo || job.notes || job.type || '업무 등록');

    // 🏷️ 소모품 — headContent 에 품목명·수량·단위 자동 prefix
    // rec 객체로 정규화 (job 필드를 _buildEnrichedLineText 가 읽는 키 이름으로 매핑)
    const rec = Object.assign({}, job, {
      storeName: job.storeName || job.store || '',
      status:    (entry && entry.status) || job.status || (job.completed ? '완료' : '진행중'),
      scheduleDate: job.scheduleDate || job.asDueDate || job.installDate || job.softOpenDate || job.openDate || job.date || '',
      // 거래처 담당 연락처 — 업무 등록 시 기록한 작업 연락처로 한정(매장 fallback 안 함)
      contactName: job.contactName || '',
      contactPhone: job.contactPhone || '',
      contactRole: job.contactRole || '',
      // (entry 발송 시) entry.author 우선 — 병합/옛 job 메타가 아닌 "지금 보내는 요청" 작성자 (2026-06-02)
      owner: (entry && entry.author) || job.owner || job.engineer || job.assignee || '',
      memo: headContent,
    });

    // 🏷️ 소모품 전용 LINE 메시지 형식 — 매장명 [YYYY-MM-DD] [규격 품목명 수량단위 처리구분] 담당 이름
    //   예: 도담마트 [2026-05-27] [3" POS용지 2박스 🎁 지원] 담당 이동호
    //   hub sub-card 와 동일한 표기 규칙(spec + name + qty + mode emoji)을 LINE 본문에도 적용
    let defaultText;
    if (category === 'supply' && typeof window._supplyItemSummary === 'function') {
      const sigName = job.signageName ? `${rec.storeName} ${job.signageName}` : rec.storeName;
      const shipDate = job.shipDate || job.date
                    || (job.createdAt ? new Date(job.createdAt).toISOString().slice(0,10) : '')
                    || (new Date()).toISOString().slice(0,10);
      const fullItem = window._supplyItemSummary(job, { withSpec: true, withMode: true });
      // 담당자 우선순위: owner → engineer → assignee → createdBy → _whoCreated
      //   모바일 m/supplies 는 owner/engineer/assignee 를 저장 안 하므로 createdBy 가 핵심 fallback
      let ownerName = rec.owner || job.engineer || job.assignee
                    || job.createdBy || job._whoCreated || '';
      // 닉네임 → 본명 정규화 (m-core / index.html 의 _normalizeDisplayName)
      if (ownerName && typeof window._normalizeDisplayName === 'function') {
        try { ownerName = window._normalizeDisplayName(ownerName) || ownerName; } catch(_){}
      }
      const ownerPart = ownerName ? ` 담당 ${ownerName}` : '';
      defaultText = `${sigName} [${shipDate}] [${fullItem}]${ownerPart}`;
    } else {
      // entry 발송 시 헤드라인 날짜는 그 entry 작성일(ts) 기준 — 병합된 옛 job 날짜 오염 방지 (2026-06-02)
      const entryDate = (entry && entry.ts) ? String(entry.ts).slice(0,10) : '';
      defaultText = (typeof window._buildEnrichedLineText === 'function')
        ? window._buildEnrichedLineText(rec, { scheduleLabel: scheduleLabelMap[category] || '📅 예정', headContent, processDate: entryDate || undefined })
        : `${rec.storeName} : ${entryDate || (new Date(Date.now()+9*3600*1000)).toISOString().slice(0,10)} ; ${headContent}`;
    }

    if (typeof window._openLineSendComposer !== 'function') {
      if (typeof showToast === 'function') showToast('⚠ LINE 컴포저가 로드되지 않았습니다');
      return;
    }
    window._openLineSendComposer({
      category,
      categoryLabel: `${labelMap[category] || ''} — ${rec.status || ''}`,
      defaultText,
      attachments,
      jobId: job.id,
      onSent: (result) => {
        try {
          const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
          const i = jobs.findIndex(x => x.id === job.id);
          if (i >= 0) {
            jobs[i].lineHistory = Array.isArray(jobs[i].lineHistory) ? jobs[i].lineHistory : [];
            jobs[i].lineHistory.push({
              at: (new Date()).toISOString(),
              ok: !!(result && result.ok),
              count: result && result.count,
              text: defaultText.slice(0, 200),
            });
            if (typeof saveJobs === 'function') saveJobs(jobs);
          }
        } catch(e){ console.warn('[openLineForJob] history save failed', e); }
      },
    });
  };

  /* ════════════════════════════════════════════════════════════
     _openLineSendComposer — LINE 발송 전 사용자 편집 모달 (전 카테고리 공용)
     ────────────────────────────────────────────────────────────
     사용:
       window._openLineSendComposer({
         category: 'stocktake' | 'as' | 'newjob' | 'van' | 'supply' | 'memo',
         categoryLabel: '📦 재고조사 — 진행 추가',
         defaultText: '정이가마트 : 2026-05-18 ; 창고 영역 완료',
         attachments: [{kind,url,name,...}, ...],
         jobId: 'JOB-xxx',
         onSent: (result) => { ... }   // 발송 성공 시 콜백
       });
       사용자가 채팅방 선택 + 메시지 본문 수정 후 [발송] 클릭 → /api/line-send
  ════════════════════════════════════════════════════════════ */
  window._openLineSendComposer = function(opts) {
    opts = opts || {};
    const modal = document.getElementById('lineSendComposerModal');
    if (!modal) return;
    const ta = document.getElementById('lsComposerText');
    const roomSel = document.getElementById('lsComposerRoom');
    const charCount = document.getElementById('lsComposerCharCount');
    const catBar = document.getElementById('lsComposerCategoryBar');
    const attBox = document.getElementById('lsComposerAttBox');
    const previewEl = document.getElementById('lsComposerPreview');
    const sendBtn = document.getElementById('lsComposerSendBtn');

    const category = opts.category || 'memo';
    const categoryLabel = opts.categoryLabel || ({stocktake:'📦 재고조사', as:'🔧 AS', newjob:'🆕 신규', van:'📑 VAN', supply:'🛒 소모품', memo:'📝 메모'})[category] || '메시지';
    catBar.textContent = categoryLabel;

    // 초기 텍스트 — 📩 발송자(현재 로그인 사용자) 이름을 맨 앞에 (neo_work 공용 계정 발송 시 누가 보냈는지 표시)
    (function(){
      let _dt = opts.defaultText || '';
      try {
        const _sender = (typeof window._currentUserName === 'function') ? (window._currentUserName() || '')
                      : ((typeof window._currentAuthName === 'function') ? (window._currentAuthName() || '') : '');
        if (_sender && _sender !== '익명' && !_dt.startsWith('[' + _sender + ']')) _dt = '[' + _sender + '] ' + _dt;
      } catch(_){}
      ta.value = _dt;
    })();
    const attachments = Array.isArray(opts.attachments) ? opts.attachments.slice() : [];
    const images = attachments.filter(a => a && a.kind === 'image' && /^https:/.test(a.url||''));
    const files  = attachments.filter(a => a && a.kind === 'file'  && /^https:/.test(a.url||''));

    // 첨부 미리보기
    if (images.length || files.length) {
      const imgStrip = images.length ? `
        <div style="font-size:11px;color:var(--gray-600);font-weight:700;margin-bottom:4px">📷 이미지 ${images.length}장</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
          ${images.slice(0,4).map(i => `<div style="width:46px;height:46px;border-radius:5px;background:#1F2937 url('${i.url}') center/cover no-repeat;border:1px solid var(--gray-300)"></div>`).join('')}
          ${images.length>4?`<div style="width:46px;height:46px;border-radius:5px;background:#F3F4F6;border:1px dashed var(--gray-300);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--gray-500);font-weight:700">+${images.length-4}</div>`:''}
        </div>
        ${images.length>4?'<div style="font-size:10px;color:var(--warn);margin-bottom:6px">⚠ LINE 한 번에 최대 4장만 발송 — 나머지는 별도 발송 필요</div>':''}
      ` : '';
      const fileStrip = files.length ? `
        <div style="font-size:11px;color:var(--gray-600);font-weight:700;margin-bottom:4px">📎 파일 ${files.length}개 (텍스트에 링크로 동봉)</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${files.map(f => `<div style="font-size:11px;color:var(--gray-700);padding:4px 8px;background:#F3F4F6;border-radius:5px;display:flex;align-items:center;gap:6px"><span style="font-weight:800">${(f.ext||'').toUpperCase().slice(0,4)}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(f.name||'')}</span></div>`).join('')}
        </div>
      ` : '';
      attBox.innerHTML = `<div style="background:#F9FAFB;border:1px solid var(--gray-200);border-radius:8px;padding:8px 10px">${imgStrip}${fileStrip}</div>`;
    } else {
      attBox.innerHTML = '';
    }

    // 미리보기 업데이트 함수
    function updatePreview() {
      const text = ta.value;
      // 첫 줄(헤더) byte 수 표시 + 전체 길이
      const firstLine = (text.split('\n')[0] || '');
      const headBytes = (typeof window._byteLen === 'function') ? window._byteLen(firstLine) : firstLine.length;
      const limit = window._LINE_HEAD_BYTES || 140;
      charCount.textContent = `${text.length}자 · 첫줄 ${headBytes}/${limit}byte`;
      charCount.style.color = (headBytes > limit) ? '#DC2626' : (text.length > 4900 ? '#DC2626' : 'var(--gray-500)');
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

    // 카테고리별 기본 설정 UI 초기화
    const catLabelMap = { stocktake:'재고조사', as:'AS', newjob:'신규', van:'VAN', supply:'소모품', memo:'메모' };
    const setDefaultChk = document.getElementById('lsComposerSetDefault');
    const setDefaultLbl = document.getElementById('lsComposerSetDefaultLabel');
    const curDefaultEl  = document.getElementById('lsComposerCurDefault');
    if (setDefaultChk) setDefaultChk.checked = false;
    if (setDefaultLbl) setDefaultLbl.textContent = `📌 [${catLabelMap[category]||category}] 기본 채팅방으로 설정`;
    if (curDefaultEl)  curDefaultEl.textContent = '';

    // 채팅방 옵션 로딩
    roomSel.innerHTML = '<option value="">— 로딩 중 —</option>';
    fetch('/api/line-rooms', { cache:'no-store' }).then(r => r.json()).then(d => {
      const rooms = Array.isArray(d.rooms) ? d.rooms : [];
      const catRooms = d.categoryRooms || {};
      const defaultRoom = opts.defaultTo || catRooms[category] || '';
      // 현재 기본 채팅방 표시
      if (curDefaultEl) {
        if (catRooms[category]) {
          const cur = rooms.find(r => r.id === catRooms[category]);
          curDefaultEl.textContent = `현재 기본: ${cur && cur.name ? cur.name : (catRooms[category].slice(0,12)+'…')}`;
        } else {
          curDefaultEl.textContent = '현재 기본 미설정';
          curDefaultEl.style.color = '#B45309';
        }
      }
      // composer state 에 기본값 저장 (submit 시 비교용)
      if (window._lineSendComposerState) {
        window._lineSendComposerState.currentDefaultRoom = catRooms[category] || '';
        window._lineSendComposerState.allCategoryRooms   = catRooms;
      }
      // 정렬: 매핑된 방 먼저, group → room → user
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
        opts2.splice(1, 0, `<option value="${_strEsc(defaultRoom)}" selected>🔒 (기본값: ${_strEsc(defaultRoom.slice(0,16))}…)</option>`);
      }
      roomSel.innerHTML = opts2.join('');
      if (!roomSel.value && roomSel.options.length > 1) {
        // 디폴트 옵션이 없으면 첫 매핑 방 자동 선택
        for (const opt of roomSel.options) {
          if (opt.value) { roomSel.value = opt.value; break; }
        }
      }
    }).catch(e => {
      roomSel.innerHTML = '<option value="">— 채팅방 목록 로딩 실패 —</option>';
      console.warn('line-rooms fetch failed', e);
    });

    // 상태 저장
    window._lineSendComposerState = {
      category, attachments, images, files,
      jobId: opts.jobId || '',
      onSent: typeof opts.onSent === 'function' ? opts.onSent : null,
      onCancel: typeof opts.onCancel === 'function' ? opts.onCancel : null,
    };
    sendBtn.disabled = false;
    { const lbl = sendBtn.querySelector('.ls-send-label'); if (lbl) lbl.textContent = 'LINE 발송'; else sendBtn.textContent = '📡 LINE 발송'; }

    showModal('lineSendComposerModal');
    setTimeout(() => { try { ta.focus(); } catch(_){} }, 100);
  };

  window._lineSendComposerCancel = function() {
    const st = window._lineSendComposerState || {};
    closeModal('lineSendComposerModal');
    if (typeof st.onCancel === 'function') { try { st.onCancel(); } catch(_){} }
    window._lineSendComposerState = null;
  };

  window._lineSendComposerSubmit = async function() {
    const st = window._lineSendComposerState || {};
    const ta = document.getElementById('lsComposerText');
    const roomSel = document.getElementById('lsComposerRoom');
    const sendBtn = document.getElementById('lsComposerSendBtn');
    const text = (ta?.value || '').trim();
    const to = roomSel?.value || '';
    if (!text) { if (typeof showToast==='function') showToast('⚠ 메시지를 입력하세요'); return; }
    if (!to) { if (typeof showToast==='function') showToast('⚠ 발송 채팅방을 선택하세요'); return; }
    sendBtn.disabled = true;
    { const lbl = sendBtn.querySelector('.ls-send-label'); if (lbl) lbl.textContent = '발송 중...'; }
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
        if (typeof showToast==='function') showToast(`📡 LINE 발송 완료 (${d.count||1}건)`);
        // 📌 기본 채팅방 저장 (체크 시 + 현재 기본과 다를 때)
        try {
          const setDefault = !!document.getElementById('lsComposerSetDefault')?.checked;
          if (setDefault && to && to !== st.currentDefaultRoom) {
            const pin = localStorage.getItem('line_admin_pin') || '';
            const updated = Object.assign({}, st.allCategoryRooms || {}, { [st.category]: to });
            const url = '/api/line-config' + (pin ? ('?admin='+encodeURIComponent(pin)) : '');
            fetch(url, {
              method:'POST',
              headers:{'content-type':'application/json'},
              body: JSON.stringify({ categoryRooms: updated }),
            }).then(rr => rr.json()).then(dd => {
              if (dd && dd.ok) {
                if (typeof showToast==='function') showToast(`📌 [${st.category}] 기본 채팅방 저장됨`);
              } else if (dd && dd.error === 'unauthorized') {
                if (typeof showToast==='function') showToast('⚠ 기본 저장 실패 — 관리자 PIN 필요');
              }
            }).catch(_=>{});
          }
        } catch(_){}
        if (typeof st.onSent === 'function') { try { st.onSent({ text, to, ok:true, count:d.count }); } catch(_){} }
        closeModal('lineSendComposerModal');
        window._lineSendComposerState = null;
      } else {
        if (typeof showToast==='function') showToast(`⚠ 발송 실패: ${d.error||r.status}${d.detail?(' / '+String(d.detail).slice(0,80)):''}`);
        sendBtn.disabled = false;
        { const lbl = sendBtn.querySelector('.ls-send-label'); if (lbl) lbl.textContent = '재시도'; }
      }
    } catch(e) {
      if (typeof showToast==='function') showToast('⚠ 발송 실패 (네트워크)');
      sendBtn.disabled = false;
      { const lbl = sendBtn.querySelector('.ls-send-label'); if (lbl) lbl.textContent = '재시도'; }
    }
  };

  function _strEsc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  /* ════════════════════════════════════════════════════════════
     _renderAttStrip — 첨부 미니 strip (목록/thread 공용 readonly 표시)
     반환: HTML 문자열 (innerHTML 으로 삽입 후 클릭 핸들러는 데이터 attribute 로 위임)
  ════════════════════════════════════════════════════════════ */
  window._renderAttStrip = function(attachments, opts){
    opts = opts || {};
    const limit = opts.limit || 5;
    const size  = opts.size  || 36;
    const arr   = Array.isArray(attachments) ? attachments.filter(a => a && a.url) : [];
    if (!arr.length) return '';
    const ext2cls = { pdf:'pdf', hwp:'hwp', hwpx:'hwp', xlsx:'xls', xls:'xls', docx:'doc', doc:'doc', pptx:'ppt', ppt:'ppt', zip:'zip', txt:'etc', csv:'etc' };
    const ext2color = { pdf:'#DC2626', hwp:'#1D4ED8', hwpx:'#1D4ED8', xlsx:'#15803D', xls:'#15803D', docx:'#2563EB', doc:'#2563EB', pptx:'#EA580C', ppt:'#EA580C', zip:'#6D28D9', txt:'#6B7280', csv:'#6B7280' };
    const groupId = '_ns_strip_' + Math.random().toString(36).slice(2,8);
    // 데이터 stash (라이트박스 호출용)
    window['__ns_strip_data_' + groupId] = arr;
    const visible = arr.slice(0, limit);
    const more = Math.max(0, arr.length - limit);
    const cells = visible.map((a, i) => {
      const ext = (a.ext || '').toLowerCase();
      if (a.kind === 'image') {
        return `<div class="ns-strip-thumb img" style="width:${size}px;height:${size}px;border-radius:5px;background:#1F2937 url('${a.url}') center/cover no-repeat;cursor:pointer" onclick="window._openAttStripAt('${groupId}',${i})" title="${(a.uploadedBy||'')}"></div>`;
      }
      const cls = ext2cls[ext] || 'etc';
      const color = ext2color[ext] || '#6B7280';
      return `<div class="ns-strip-thumb file" style="width:${size}px;height:${size}px;border-radius:5px;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.max(8,size*0.27)}px;cursor:pointer" onclick="window._openAttStripAt('${groupId}',${i})" title="${(a.name||'')}">${(ext||'?').toUpperCase().slice(0,4)}</div>`;
    }).join('');
    const moreCell = more > 0 ? `<div class="ns-strip-more" style="width:${size}px;height:${size}px;border-radius:5px;background:#F3F4F6;border:1px dashed #D1D5DB;display:flex;align-items:center;justify-content:center;font-size:11px;color:#6B7280;font-weight:700;cursor:pointer" onclick="window._openAttStripAt('${groupId}',${limit})">+${more}</div>` : '';
    return `<div class="ns-att-strip" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">${cells}${moreCell}</div>`;
  };
  window._openAttStripAt = function(groupId, idx){
    try {
      const arr = window['__ns_strip_data_' + groupId];
      if (Array.isArray(arr) && arr.length) window.NS_LIGHTBOX.open(arr, idx);
    } catch(_) {}
  };

  /* 전역 리렌더 — 'ns:data-changed' 발생 시 활성 화면 자동 갱신.
     화면별 renderer 가 호출되며, 모달/입력 상태는 renderer 가 자체적으로 보존해야 함.
     특정 화면이 갱신 중에 끊기는 게 싫다면 그 renderer 의 호출을 빼면 됨. */
  document.addEventListener('ns:data-changed', () => {
    try {
      // 대시보드는 늘 갱신 (가벼움)
      if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs();
    } catch(e){}
    // 현재 활성 화면별 갱신
    try {
      const active = document.querySelector('.screen.active');
      const sid = active ? active.id : '';
      if (sid === 'screen-newhub'      && typeof window.renderNewHub === 'function')      window.renderNewHub();
      if (sid === 'screen-ashub'       && typeof window.renderAsHub === 'function')       window.renderAsHub();
      if (sid === 'screen-vanhub'      && typeof window.renderVanHub === 'function')      window.renderVanHub();
      if (sid === 'screen-supplieshub' && typeof window.renderSuppliesHub === 'function') window.renderSuppliesHub();
      if (sid === 'screen-asmgmt'      && typeof hydrateAsMgmt === 'function')            hydrateAsMgmt();
    } catch(e){}
    // 점포 상세 모달이 열려 있으면 해당 매장만 재렌더
    try {
      const sdm = document.getElementById('storeDetailModal');
      if (sdm && sdm.style.display !== 'none' && sdm.classList.contains('active')) {
        const tr = window._currentStoreDetailRow;
        const sid = tr && tr.dataset && tr.dataset.storeId;
        if (sid && typeof window._reopenStoreDetail === 'function') window._reopenStoreDetail(sid, { keepTab:true });
      }
    } catch(e){}
  });

  /* ══════════════════════════════════════════════
     자동 백업 시스템
       - localStorage `ns_backups`: 최근 14개 롤링 스냅샷
       - 페이지 로드 시 마지막 백업 24시간 초과면 자동 1회
       - saveJobs/saveStores 시 디바운스 백업 (10초 모아서 1회)
       - 관리자 페이지에서 JSON 내보내기 / 복원 / 시점 복구
  ══════════════════════════════════════════════ */
  const BACKUP_KEY = 'ns_backups';
  const BACKUP_MAX = 14;
  let _backupTimer = null;

  function getBackups() {
    try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); } catch { return []; }
  }
  function saveBackups(arr) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(arr)); } catch (e) {
      // quota 초과 시 가장 오래된 것부터 삭제하며 재시도
      while (arr.length > 1) {
        arr.shift();
        try { localStorage.setItem(BACKUP_KEY, JSON.stringify(arr)); return; } catch(_){}
      }
      console.warn('백업 저장 실패: quota 초과');
    }
  }

  function createSnapshot() {
    return {
      ts: Date.now(),
      version: 1,
      stores:        JSON.parse(localStorage.getItem('ns_stores')         || '[]'),
      jobs:          JSON.parse(localStorage.getItem('ns_jobs')           || '[]'),
      users:         JSON.parse(localStorage.getItem('ns_users')          || '[]'),
      allowedEmails: JSON.parse(localStorage.getItem('ns_allowed_emails') || '[]'),
      comments:      JSON.parse(localStorage.getItem('ns_comments')       || '{}'),
    };
  }

  function pushSnapshot(snap) {
    const arr = getBackups();
    // 동일 분 단위 중복 방지
    const last = arr[arr.length - 1];
    if (last && Math.abs(snap.ts - last.ts) < 60_000) {
      arr[arr.length - 1] = snap;
    } else {
      arr.push(snap);
    }
    while (arr.length > BACKUP_MAX) arr.shift();
    saveBackups(arr);
    renderBackupStatus();
  }

  function scheduleAutoBackup(delayMs) {
    delayMs = (typeof delayMs === 'number') ? delayMs : 10_000;
    if (_backupTimer) clearTimeout(_backupTimer);
    _backupTimer = setTimeout(() => { pushSnapshot(createSnapshot()); }, delayMs);
  }

  function ensureDailyBackup() {
    const arr = getBackups();
    const last = arr[arr.length - 1];
    const day = 24 * 60 * 60 * 1000;
    if (!last || (Date.now() - last.ts) > day) {
      pushSnapshot(createSnapshot());
    }
  }

  function exportBackupFile() {
    const snap = createSnapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date(snap.ts).toISOString().replace(/[:T]/g,'-').slice(0,16);
    a.href = url;
    a.download = `neoretail-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    // 내보낸 시점도 스냅샷으로 기록
    pushSnapshot(snap);
    if (typeof showToast === 'function') showToast('📥 백업 파일 다운로드 완료');
  }
  window.exportBackupFile = exportBackupFile;

  function importBackupFile(input) {
    const file = input?.files?.[0];
    if (!file) return;
    if (!confirm('백업 JSON을 불러와 현재 데이터를 덮어씁니다.\n\n복원 직전 자동 스냅샷을 만들고 진행합니다. 계속하시겠습니까?')) {
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const snap = JSON.parse(String(e.target.result || '{}'));
        if (typeof snap !== 'object' || snap == null) throw new Error('형식 오류');
        // 복원 직전 자동 스냅샷
        pushSnapshot(createSnapshot());
        // 복원
        if (Array.isArray(snap.stores))        localStorage.setItem('ns_stores',         JSON.stringify(snap.stores));
        if (Array.isArray(snap.jobs))          localStorage.setItem('ns_jobs',           JSON.stringify(snap.jobs));
        if (Array.isArray(snap.users))         localStorage.setItem('ns_users',          JSON.stringify(snap.users));
        if (Array.isArray(snap.allowedEmails)) localStorage.setItem('ns_allowed_emails', JSON.stringify(snap.allowedEmails));
        if (snap.comments && typeof snap.comments === 'object') {
          localStorage.setItem('ns_comments', JSON.stringify(snap.comments));
        }
        alert('✅ 복원 완료. 페이지를 새로고침합니다.');
        setTimeout(() => location.reload(), 200);
      } catch (err) {
        alert('복원 실패: ' + (err.message || err));
      }
    };
    reader.readAsText(file, 'utf-8');
    input.value = '';
  }
  window.importBackupFile = importBackupFile;

  function restoreSnapshot(idx) {
    const arr = getBackups();
    const snap = arr[idx];
    if (!snap) return;
    if (!confirm(`${new Date(snap.ts).toLocaleString('ko-KR')} 시점으로 복원합니다.\n복원 직전 현재 상태도 자동 백업됩니다. 계속하시겠습니까?`)) return;
    pushSnapshot(createSnapshot());
    if (Array.isArray(snap.stores))        localStorage.setItem('ns_stores',         JSON.stringify(snap.stores));
    if (Array.isArray(snap.jobs))          localStorage.setItem('ns_jobs',           JSON.stringify(snap.jobs));
    if (Array.isArray(snap.users))         localStorage.setItem('ns_users',          JSON.stringify(snap.users));
    if (Array.isArray(snap.allowedEmails)) localStorage.setItem('ns_allowed_emails', JSON.stringify(snap.allowedEmails));
    if (snap.comments && typeof snap.comments === 'object') {
      localStorage.setItem('ns_comments', JSON.stringify(snap.comments));
    }
    alert('✅ 복원 완료. 페이지를 새로고침합니다.');
    setTimeout(() => location.reload(), 200);
  }
  window.restoreSnapshot = restoreSnapshot;

  /* ══════════════════════════════════════════════
     선택적 복원 — 오늘 AS 작업을 보존하면서 손실 데이터만 복구

     원칙:
     - 같은 id 의 작업이 양쪽에 있으면 — 현재 thread/memos union 보존,
       backup 에만 있는 installDate/softOpenDate/openDate/asTargets/equipment 등
       을 현재에 채워 넣음 (현재 값이 비어있는 경우만)
     - backup 에만 있고 현재에 없는 작업(=마이그레이션 삭제됨) → 그대로 추가
     - 현재에만 있는 작업(=오늘 새로 만든 것) → 그대로 보존
     - stores 도 동일하게 union 머지 (id 기준, 백업의 빈필드 보강 X, 누락된 매장만 추가)
     - users / allowedEmails / comments 는 건드리지 않음
  ══════════════════════════════════════════════ */
  function selectiveRestoreSnapshot(idx) {
    const arr = getBackups();
    const snap = arr[idx];
    if (!snap) return;
    const snapJobs = Array.isArray(snap.jobs) ? snap.jobs : [];
    const snapStores = Array.isArray(snap.stores) ? snap.stores : [];
    const curJobs = (function(){ try { return JSON.parse(localStorage.getItem('ns_jobs')||'[]'); } catch { return []; } })();
    const curStores = (function(){ try { return JSON.parse(localStorage.getItem('ns_stores')||'[]'); } catch { return []; } })();

    // 미리 보기 카운트
    const curJobIds = new Set(curJobs.map(j => j.id));
    const curStoreIds = new Set(curStores.map(s => s.id));
    const restoredJobs = snapJobs.filter(j => j && j.id && !curJobIds.has(j.id));
    const restoredStores = snapStores.filter(s => s && s.id && !curStoreIds.has(s.id));
    const fieldRestoreFields = ['installDate','softOpenDate','openDate','contractDate','jobDate','asReceivedAt','asDueDate','asTargets','equipment','equipTotal','engineer','assignee','memo','notes','lineParsed','lineRaw','lineCategory'];

    // 필드 보강 시뮬레이션 (현재에 빈 필드 카운트)
    let fieldFills = 0;
    const snapById = new Map(snapJobs.map(j => [j.id, j]));
    curJobs.forEach(j => {
      const b = snapById.get(j.id);
      if (!b) return;
      fieldRestoreFields.forEach(f => {
        const cur = j[f];
        const bak = b[f];
        const curEmpty = (cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0));
        const bakHas = !(bak === undefined || bak === null || bak === '' || (Array.isArray(bak) && bak.length === 0));
        if (curEmpty && bakHas) fieldFills++;
      });
    });

    const ts = new Date(snap.ts).toLocaleString('ko-KR');
    const msg = `[${ts}] 시점에서 선택적 복원합니다.\n\n` +
      `• 삭제된 작업 되살리기: ${restoredJobs.length}건\n` +
      `• 누락된 매장 되살리기: ${restoredStores.length}건\n` +
      `• 현재 작업의 빈 필드 채우기: ${fieldFills}건 (설치예정일/오픈일/장비 등)\n\n` +
      `오늘 추가한 AS 스레드/요청은 그대로 유지됩니다.\n계속하시겠습니까?`;
    if (!confirm(msg)) return;

    // 복원 직전 현재 상태 백업
    pushSnapshot(createSnapshot());

    // jobs 머지
    const merged = curJobs.slice();
    const mergedById = new Map(merged.map(j => [j.id, j]));
    snapJobs.forEach(b => {
      if (!b || !b.id) return;
      const cur = mergedById.get(b.id);
      if (!cur) {
        // 통째로 부활
        merged.push(b);
        mergedById.set(b.id, b);
      } else {
        // 필드 보강 — 현재가 비어있는 필드만
        fieldRestoreFields.forEach(f => {
          const c = cur[f];
          const bv = b[f];
          const curEmpty = (c === undefined || c === null || c === '' || (Array.isArray(c) && c.length === 0));
          const bakHas = !(bv === undefined || bv === null || bv === '' || (Array.isArray(bv) && bv.length === 0));
          if (curEmpty && bakHas) cur[f] = (Array.isArray(bv) ? bv.slice() : bv);
        });
        // type 복구 — 백업이 신규/오픈이고 현재가 'AS 처리' 면 백업 우선
        if (b.type && b.type !== cur.type) {
          const bIsNew = /신규|오픈|new|open/i.test(b.type);
          const curIsForcedAs = /^AS\s*처리$/.test(cur.type || '') || /^AS$/i.test(cur.type || '');
          if (!cur.type) cur.type = b.type;
          else if (bIsNew && curIsForcedAs) cur.type = b.type;
        }
        // 마이그레이션 흔적 제거
        if (cur._asAggregated && b.type && /신규|오픈|new|open/i.test(b.type)) {
          delete cur._asAggregated;
          delete cur._originalType;
        }
        // thread/memos 는 _mergeJobRecord 로 union (현재 우선)
        if (typeof _mergeJobRecord === 'function') {
          const m = _mergeJobRecord(cur, b);
          cur.thread = m.thread;
          cur.memos = m.memos;
          if (m.vandocs) cur.vandocs = m.vandocs;
        }
      }
    });

    // stores 머지 — 백업에만 있는 매장 추가, 기존 매장은 손대지 않음
    const finalStores = curStores.slice();
    const sById = new Map(finalStores.map(s => [s.id, s]));
    snapStores.forEach(b => {
      if (!b || !b.id) return;
      if (!sById.has(b.id)) { finalStores.push(b); sById.set(b.id, b); }
    });

    localStorage.setItem('ns_jobs', JSON.stringify(merged));
    localStorage.setItem('ns_stores', JSON.stringify(finalStores));

    // 즉시 cloud push (다른 PC 가 stale cloud 로 다시 덮지 않게)
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}

    alert(`✅ 선택적 복원 완료\n• 작업 ${restoredJobs.length}건 부활 · ${fieldFills}필드 보강\n• 매장 ${restoredStores.length}건 부활\n\n페이지를 새로고침합니다.`);
    setTimeout(() => location.reload(), 300);
  }
  window.selectiveRestoreSnapshot = selectiveRestoreSnapshot;

  // 파일에서 선택적 복원 — 다른 기기의 JSON 백업을 현재 데이터에 머지
  function selectiveImportBackupFile(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const snap = JSON.parse(String(e.target.result || '{}'));
        if (typeof snap !== 'object' || snap == null) throw new Error('형식 오류');
        // 임시로 ns_backups 마지막에 추가한 뒤 selectiveRestoreSnapshot 호출
        const arr = getBackups();
        arr.push(snap);
        const tempIdx = arr.length - 1;
        saveBackups(arr);
        renderBackupStatus();
        selectiveRestoreSnapshot(tempIdx);
      } catch (err) {
        alert('파일 복원 실패: ' + (err.message || err));
      }
    };
    reader.readAsText(file, 'utf-8');
    input.value = '';
  }
  window.selectiveImportBackupFile = selectiveImportBackupFile;

  function renderBackupStatus() {
    const wrap = document.getElementById('backupStatusBox');
    if (!wrap) return;
    const arr = getBackups();
    const last = arr[arr.length - 1];
    const lastTxt = last
      ? `마지막 자동 백업: <b>${new Date(last.ts).toLocaleString('ko-KR')}</b> · 점포 ${(last.stores||[]).length.toLocaleString()}건 · 작업 ${(last.jobs||[]).length.toLocaleString()}건`
      : '아직 백업이 없습니다.';
    const list = arr.slice().reverse().map((s, i) => {
      const realIdx = arr.length - 1 - i;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--gray-100);font-size:11px">
        <div>
          <b>${new Date(s.ts).toLocaleString('ko-KR')}</b>
          <span style="color:var(--gray-400);margin-left:8px">점포 ${(s.stores||[]).length} · 작업 ${(s.jobs||[]).length} · 직원 ${(s.users||[]).length}</span>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-sm" style="font-size:10px;padding:2px 8px;border-color:#16a34a;color:#15803d" onclick="selectiveRestoreSnapshot(${realIdx})" title="현재 작업 보존하면서 누락 데이터만 복구">🩹 선택복원</button>
          <button class="btn btn-outline btn-sm" style="font-size:10px;padding:2px 8px" onclick="restoreSnapshot(${realIdx})" title="이 시점으로 통째로 되돌림 (현재 작업 사라짐)">↺ 전체복원</button>
        </div>
      </div>`;
    }).join('') || '<div style="padding:12px;text-align:center;color:var(--gray-400);font-size:11px">백업 없음</div>';
    wrap.innerHTML = `
      <div style="font-size:11px;color:var(--gray-600);margin-bottom:6px">${lastTxt}</div>
      <details style="margin-top:8px">
        <summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--gray-700);padding:4px 0">📜 최근 ${arr.length}개 자동 백업 시점 목록</summary>
        <div style="margin-top:6px;max-height:240px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px">${list}</div>
      </details>
    `;
  }
  window.renderBackupStatus = renderBackupStatus;

  // 페이지 로드 시 일일 백업 보장
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => { try { ensureDailyBackup(); renderBackupStatus(); } catch(e){} }, 1000);
  });

  /* ══════════════════════════════════════════════
     AS 업무 매장당 집계 마이그레이션
     — 기존 산재된 AS jobs 를 매장당 1건으로 통합
     — thread[] 에 각 요청을 ROOT 로 누적
     — 자동 1회 실행 (localStorage._as_aggregate_migration_v2)
  ══════════════════════════════════════════════ */
  window.migrateAsJobsToAggregate = function(opts) {
    opts = opts || {};
    const force = !!opts.force;
    const FLAG = '_as_aggregate_migration_v2';
    if (!force && localStorage.getItem(FLAG) === 'done') {
      return { skipped: true, mergedStores: 0, removedJobs: 0 };
    }
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    if (jobs.length === 0) {
      localStorage.setItem(FLAG, 'done');
      return { skipped: false, mergedStores: 0, removedJobs: 0 };
    }
    const classifyFn = window.classifyJobCategory || (() => 'as');
    const isDoneFn = window._isJobDone || (j => j.completed || /완료/.test(j.status||''));
    const normFn = (typeof _normStoreKey === 'function')
                  ? _normStoreKey
                  : (s => String(s||'').toLowerCase().replace(/\s+/g,''));

    // 매장별 AS 업무 묶기 — 명시적 AS 시그널만 합병 대상 (신규 fallthrough 보호)
    const isExplicitAs = (j) => {
      const lc = String(j.lineCategory || '').toLowerCase();
      const tp = String(j.type || '').toLowerCase();
      const all = lc + ' ' + tp;
      return /pos_as|van_as|device_mgmt|as_pos|단말|a\/s|에이에스/.test(all) || /\bas\b/.test(all);
    };
    const groupsByStore = new Map();
    jobs.forEach((j, idx) => {
      if (classifyFn(j) !== 'as') return;
      if (!isExplicitAs(j)) return;  // 신규/기타가 fallthrough 로 끼는 사고 차단
      const key = j.storeId || ('name:' + normFn(j.storeName || j.store || ''));
      if (!key || key === 'name:') return;  // 식별 불가 매장 skip
      if (!groupsByStore.has(key)) groupsByStore.set(key, []);
      groupsByStore.get(key).push({ idx, j });
    });

    let mergedStores = 0;
    let removedJobs = 0;
    const toRemove = new Set();

    groupsByStore.forEach((items) => {
      if (items.length < 2) return;
      // 가장 오래된 업무를 canonical 로 보존 (createdAt 오름차순)
      items.sort((a, b) => (Number(a.j.createdAt)||0) - (Number(b.j.createdAt)||0));
      const canonical = items[0].j;
      const canonicalIdx = items[0].idx;
      const others = items.slice(1);

      // 이미 통합된 canonical 은 재통합하지 않음 (재-prefix/중복/불필요 churn 방지).
      //   부활한 원본만 tombstone 후 제거. (멱등성 가드)
      if (canonical._asAggregated) {
        others.forEach(o => {
          if (o.j && o.j.id && typeof _addTombstone === 'function') _addTombstone('job', o.j.id);
          toRemove.add(o.idx);
          removedJobs++;
        });
        return;
      }

      let mergedThread = Array.isArray(canonical.thread) ? canonical.thread.slice() : [];
      // canonical 자체에 thread 가 없으면 자기 자신의 asRequest/notes 로 ROOT 시드
      if (mergedThread.length === 0) {
        const t = (canonical.asRequest || canonical.notes || canonical.lineParsed || canonical.lineRaw || '').trim();
        if (t) {
          const ts = (canonical.asReceivedAt || '').slice(0,16).replace('T',' ')
                  || (canonical.createdAt ? new Date(canonical.createdAt).toISOString().slice(0,16).replace('T',' ') : '');
          const rootId = 'TR-mig-' + (canonical.id || Date.now());
          mergedThread.push({
            ts, author: canonical.engineer || canonical.assignee || '담당자',
            status: '요청접수', text: t,
            threadId: rootId, parentId: null,
          });
          // canonical 도 완료 상태였다면 완료 child 추가
          if (isDoneFn(canonical)) {
            const dts = (canonical.completedAt || canonical.doneAt || '').slice(0,16).replace('T',' ') || ts;
            mergedThread.push({
              ts: dts, author: canonical.completedBy || canonical.engineer || '담당자',
              status: '완료', text: '(완료 이력)',
              threadId: 'TR-mig-done-' + (canonical.id || Date.now()),
              parentId: rootId,
            });
          }
        }
      }

      others.forEach(o => {
        const oj = o.j;
        const oth = Array.isArray(oj.thread) ? oj.thread : [];
        if (oth.length > 0) {
          // 기존 thread 가 있으면 그대로 append (threadId 충돌 방지 위해 prefix 부여)
          oth.forEach(e => {
            const cp = Object.assign({}, e);
            if (cp.threadId) cp.threadId = 'TR-mig-' + oj.id + '-' + cp.threadId;
            if (cp.parentId) cp.parentId = 'TR-mig-' + oj.id + '-' + cp.parentId;
            mergedThread.push(cp);
          });
        } else {
          // ROOT 합성
          const t = (oj.asRequest || oj.notes || oj.lineParsed || oj.lineRaw || '').trim();
          if (t) {
            const ts = (oj.asReceivedAt || '').slice(0,16).replace('T',' ')
                    || (oj.createdAt ? new Date(oj.createdAt).toISOString().slice(0,16).replace('T',' ') : '');
            const rootId = 'TR-mig-' + (oj.id || Date.now());
            mergedThread.push({
              ts, author: oj.engineer || oj.assignee || '담당자',
              status: '요청접수', text: t,
              threadId: rootId, parentId: null,
            });
            if (isDoneFn(oj)) {
              const dts = (oj.completedAt || oj.doneAt || '').slice(0,16).replace('T',' ') || ts;
              mergedThread.push({
                ts: dts, author: oj.completedBy || oj.engineer || '담당자',
                status: '완료', text: '(완료 이력 — 마이그레이션)',
                threadId: 'TR-mig-done-' + (oj.id || Date.now()),
                parentId: rootId,
              });
            }
          }
        }

        // AS 메타 머지 (canonical 에 없는 값만)
        ['asReceivedAt','asDueDate','asDueTime','asRequest'].forEach(k => {
          if (!canonical[k] && oj[k]) canonical[k] = oj[k];
        });
        if (Array.isArray(oj.asTargets) && oj.asTargets.length) {
          const cur = Array.isArray(canonical.asTargets) ? canonical.asTargets : [];
          canonical.asTargets = Array.from(new Set(cur.concat(oj.asTargets)));
        }
        if (Array.isArray(oj.equipment) && oj.equipment.length) {
          canonical.equipment = (Array.isArray(canonical.equipment) ? canonical.equipment : []).concat(oj.equipment);
          canonical.equipTotal = (Number(canonical.equipTotal)||0) + (Number(oj.equipTotal)||0);
        }
        if (Array.isArray(oj.memos) && oj.memos.length) {
          canonical.memos = (Array.isArray(canonical.memos) ? canonical.memos : []).concat(oj.memos);
        }
        toRemove.add(o.idx);
        removedJobs++;
      });

      // 스레드 정규화 + 콘텐츠 중복 제거 (재-prefix 로 생긴 동일 내용 중복 collapse)
      if (typeof window._threadMigrate === 'function') {
        mergedThread = window._threadMigrate(mergedThread);
      }
      mergedThread = _dedupeThread(mergedThread);
      canonical.thread = mergedThread;

      // 상태 재평가
      const roots = mergedThread.filter(e => e.parentId === null);
      const hasIncomplete = roots.some(r => {
        const kids = mergedThread.filter(k => k.parentId === r.threadId);
        return !kids.some(k => k.status === '완료');
      });
      if (hasIncomplete) {
        canonical.completed = false;
        if (canonical.status === '완료' || canonical.status === '처리완료') canonical.status = '진행중';
      } else if (roots.length > 0) {
        canonical.completed = true;
        canonical.status = '완료';
      }
      canonical._asAggregated = true;
      // canonical 의 type 이 AS 카테고리에 어울리지 않으면 정규화 (예: type='신규'인데 lineCategory 로 AS 분류된 경우)
      if (!/AS|에이에스/i.test(canonical.type || '')) {
        if (!canonical._originalType) canonical._originalType = canonical.type || '';
        canonical.type = 'AS 처리';
      }
      jobs[canonicalIdx] = canonical;
      mergedStores++;
    });

    // 인덱스 내림차순으로 삭제 (안전) — 🪦 tombstone 등록으로 cloud union 부활 차단
    [...toRemove].sort((a,b)=>b-a).forEach(i => {
      const removedJob = jobs[i];
      if (removedJob && removedJob.id && typeof _addTombstone === 'function') {
        _addTombstone('job', removedJob.id);
      }
      jobs.splice(i, 1);
    });

    // v2 — AS 분류이고 + 명시적 AS 시그널 (lineCategory 가 AS 토큰) 인 경우만 type 정규화
    // classifyJobCategory 의 fallthrough(=default 'as') 로 신규 작업이 잘못 잡혀
    // type 이 'AS 처리' 로 덮어써지는 사고 방지
    let typeFixed = 0;
    jobs.forEach(j => {
      if (classifyFn(j) !== 'as') return;
      const lc = String(j.lineCategory || '').toLowerCase();
      const tp = String(j.type || '').toLowerCase();
      const explicitAs = /pos_as|van_as|device_mgmt|as_pos|단말|a\/s|에이에스/.test(lc + ' ' + tp)
                       || /\bas\b/.test(lc + ' ' + tp);
      if (!explicitAs) return;  // 신규/기타 작업이 AS 로 fallthrough 된 경우 보호
      if (!/AS|에이에스/i.test(j.type || '')) {
        if (!j._originalType) j._originalType = j.type || '';
        j.type = 'AS 처리';
        typeFixed++;
      }
    });

    if (typeof saveJobs === 'function') saveJobs(jobs);
    if (typeFixed > 0) console.info('[AS 마이그레이션] type 정규화', typeFixed, '건');
    localStorage.setItem(FLAG, 'done');
    return { skipped: false, mergedStores, removedJobs };
  };

  // ══════════════════════════════════════════════
  // 복구 도구 — AS 마이그레이션이 잘못 'AS 처리' 로 바꾼 type 을 _originalType 으로 되돌림
  // 콘솔: window.diagnoseTypeCoercion() / window.restoreOriginalJobType()
  // ══════════════════════════════════════════════
  window.diagnoseTypeCoercion = function() {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const affected = jobs.filter(j => j._originalType !== undefined);
    const newOrig = affected.filter(j => /신규|오픈|new|open/i.test(j._originalType || ''));
    const blankOrig = affected.filter(j => !j._originalType);
    const otherOrig = affected.filter(j => j._originalType && !/신규|오픈|new|open/i.test(j._originalType));
    console.group('[AS 마이그레이션 type 강제변경 진단]');
    console.log('총 type 변경된 작업:', affected.length);
    console.log('① 원본이 신규/오픈 계열:', newOrig.length, '건 ← 복구 후보');
    newOrig.forEach(j => console.log(`   ${j.id} | now:${j.type} | was:${j._originalType} | store:${j.storeName||j.store}`));
    console.log('② 원본이 빈 문자열:', blankOrig.length, '건');
    console.log('③ 기타 원본:', otherOrig.length, '건');
    otherOrig.forEach(j => console.log(`   ${j.id} | now:${j.type} | was:${j._originalType} | store:${j.storeName||j.store}`));
    console.groupEnd();
    return { affected, newOrig, blankOrig, otherOrig };
  };

  // ①번 (원본이 신규/오픈) 만 자동 복구. 다른 케이스는 옵션으로
  window.restoreOriginalJobType = function(opts) {
    opts = opts || {};
    const includeAll = !!opts.all;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    let restored = 0;
    jobs.forEach(j => {
      if (j._originalType === undefined) return;
      const orig = j._originalType || '';
      const isNewish = /신규|오픈|new|open/i.test(orig);
      if (!isNewish && !includeAll) return;
      if (!orig) return;
      j.type = orig;
      delete j._originalType;
      delete j._asAggregated;
      // lineCategory 도 신규 토큰으로 되돌림 (재분류 보장)
      if (isNewish && !/open_store|new_open|newopen|오픈|신규/i.test(j.lineCategory || '')) {
        j.lineCategory = 'open_store';
      }
      restored++;
    });
    if (restored > 0 && typeof saveJobs === 'function') {
      saveJobs(jobs);
      try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}
    }
    console.info('[type 복구 완료]', restored, '건');
    try { if (typeof showToast === 'function') showToast(`✅ ${restored}건의 작업 type 복구`); } catch(e){}
    return restored;
  };

  // 자동 1회 실행 — getJobs/saveJobs 가 정의된 후
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      try {
        // 부팅 시 자동 type 복구 — 신규 계열은 무조건 되돌림
        try { window.restoreOriginalJobType(); } catch(e){}
        if (typeof getJobs !== 'function' || typeof saveJobs !== 'function') return;
        // ⚠ AS 통합 마이그레이션 자동실행 폐지 (모델 A) — 모바일은 통합 안 해 PC↔모바일 건수 불일치 +
        //   비멱등 재-prefix 중복 + tombstone/ reconcile 충돌의 근원이었음. AS 는 요청별 작업으로 통일.
        //   기존 통합 canonical 데이터는 그대로 보존(thread 누적 유지). 수동 필요시 window.migrateAsJobsToAggregate().
        // const result = window.migrateAsJobsToAggregate();  // ← 자동실행 중단
      } catch(e) { console.warn('[AS 마이그레이션 skip]', e); }
    }, 1500);
  });

  /* ══════════════════════════════════════════════
     점포 등록 저장
  ══════════════════════════════════════════════ */
  function saveNewStore() {
    const name = (document.getElementById('f-name') || {}).value?.trim();
    if (!name) { showToast('점포명을 입력하세요'); document.getElementById('f-name')?.focus(); return; }

    // 사업자번호 표준 포맷화
    const bizRaw = (document.getElementById('f-biz') || {}).value?.trim() || '';
    const bizDigits = bizRaw.replace(/\D/g,'');
    const bizFmt = bizDigits.length === 10
      ? `${bizDigits.slice(0,3)}-${bizDigits.slice(3,5)}-${bizDigits.slice(5,10)}`
      : bizRaw;
    const todayYmd = new Date().toISOString().slice(0,10);

    // ⚠ 사업자번호 중복 매장 검사 (직영점 다중 등록 안전장치)
    if (bizDigits.length === 10) {
      const existing = getStores().filter(s => {
        const d = String(s.biz || s.bizno || '').replace(/\D/g,'');
        return d === bizDigits;
      });
      if (existing.length > 0) {
        const list = existing.slice(0, 8).map(s => `  • ${s.name}`).join('\n');
        const more = existing.length > 8 ? `\n  외 ${existing.length - 8}개...` : '';
        const ok = confirm(
          `이미 같은 사업자번호(${bizFmt})로 등록된 매장이 ${existing.length}개 있습니다:\n\n${list}${more}\n\n` +
          `법인 직영점이면 그대로 등록하셔도 됩니다.\n등록을 진행하시겠습니까?`
        );
        if (!ok) return;
      }
    }

    const store = {
      id: 'EC-' + Date.now().toString().slice(-5),
      name,
      ceo:  (document.getElementById('f-ceo')  || {}).value?.trim() || '',
      tel:  (document.getElementById('f-tel')  || {}).value?.trim() || '',
      biz:  bizFmt,
      addr: (document.getElementById('f-addr') || {}).value?.trim() || '',
      van:  (document.getElementById('f-van')  || {}).value || '',
      tid:  (document.getElementById('f-tid')  || {}).value?.trim() || '',
      date: (document.getElementById('f-date') || {}).value || '',
      pos:  (document.getElementById('f-pos')  || {}).value || '0',
      memo: (document.getElementById('f-memo') || {}).value?.trim() || '',
      status: '거래중',
      createdAt: Date.now(),
      storeRegDate: todayYmd,    // ← 매장 등록일 = 등록 당일
    };

    const stores = getStores();
    stores.unshift(store);
    saveStores(stores);

    // storeNameList datalist 갱신
    populateStoreNameList();

    closeModal('newStoreModal');
    showToast(`✅ ${name} 점포가 등록되었습니다`);

    // 입력 필드 초기화
    ['f-name','f-ceo','f-tel','f-biz','f-addr','f-tid','f-memo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const van = document.getElementById('f-van');
    if (van) van.value = '';
  }

  /* ══════════════════════════════════════════════
     작업 등록 저장
  ══════════════════════════════════════════════ */
  /* 미등록 가맹점 모드 토글 */
  let jobStoreUnregistered = false;
  function toggleUnregisteredStore() {
    jobStoreUnregistered = !jobStoreUnregistered;
    const btn = document.getElementById('unregBtn');
    const notice = document.getElementById('unregNotice');
    const inp = document.getElementById('jobStoreName');
    if (jobStoreUnregistered) {
      if (btn) {
        btn.textContent = '✓ 미등록 가맹점';
        btn.style.background = '#FEF3C7';
        btn.style.color = '#92400E';
        btn.style.borderColor = '#FCD34D';
      }
      if (notice) notice.style.display = 'block';
      if (inp) {
        inp.value = '';            // 미등록 모드 진입 시 입력값 초기화
        inp.placeholder = '미등록 가맹점명 직접 입력...';
        inp.removeAttribute('oninput');
        inp.removeAttribute('onfocus');
        try { inp.focus(); } catch(e){}
      }
      const panel = document.getElementById('jobStoreResults');
      if (panel) panel.style.display = 'none';
      // 이전에 선택했던 매장의 잔여 정보 모두 정리 (사업자/대표/주소/동일매장 미리보기)
      try { _resetStorePickInfo(); } catch(e){}
      const bizEl = document.getElementById('jobStorePickedBiz');
      const ceoEl = document.getElementById('jobStorePickedCeo');
      if (bizEl) bizEl.textContent = '-';
      if (ceoEl) ceoEl.textContent = '';
      const addrEl = document.getElementById('jobAddressInput');
      if (addrEl) addrEl.value = '';
      const simBanner = document.getElementById('jobSimilarBanner');
      if (simBanner) simBanner.style.display = 'none';
      const simList = document.getElementById('jobSimList');
      if (simList) simList.innerHTML = '';
    } else {
      if (btn) {
        btn.textContent = '+ 미등록 가맹점';
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
      }
      if (notice) notice.style.display = 'none';
      if (inp) {
        inp.placeholder = '점포명을 입력해 검색...';
        inp.setAttribute('oninput', 'runJobStoreSearch()');
        inp.setAttribute('onfocus', 'runJobStoreSearch()');
      }
    }
  }
  window.toggleUnregisteredStore = toggleUnregisteredStore;

  /* ════════════════════════════════════════════════════════════════════════
   * saveNewJob — 작업 등록 (newJobModal [작업 등록]/[완료] 클릭)
   *   ⚠ 안정화 규약 (docs/AS_ARCHITECTURE.md 참조)
   *   1. AS 등록은 '매장당 단일 job' — 동일 매장 AS 발견 시 별도 job 생성 X,
   *      기존 thread 에 새 ROOT append (완료된 AS 도 재사용; isDone 필터 금지)
   *   2. _asInlineEditJobId 가 설정되어 있으면 모달만 닫음 (이미 live 저장됨)
   *   3. AS 머지 발생 시 pushJobsToCloud() 즉시 호출 — debounce 갭 차단
   *   4. AS job 의 type 은 'AS 처리' 로 정규화 (분류기와 일관)
   * ════════════════════════════════════════════════════════════════════════ */
  function saveNewJob() {
    // 🛡 중복 등록 방지 — 진행 중이면 무시 (더블클릭/Enter 연타 가드)
    //   PC saveNewJob 은 동기 진입 후 push 까지 비동기. 가드 없으면 ID 다른 2건이 생김.
    if (window._saveNewJobBusy) {
      try { showToast('⏳ 저장 진행 중입니다…'); } catch(_){}
      return;
    }
    window._saveNewJobBusy = true;
    // 버튼 disable — 모달 footer 의 primary 버튼 (작업 등록 / 저장)
    const _saveBtns = Array.from(document.querySelectorAll('#newJobModal .modal-footer .btn.btn-primary'));
    _saveBtns.forEach(b => { b.disabled = true; b.dataset.savingOrig = b.textContent; b.textContent = '⏳ 저장 중...'; b.style.opacity = '0.6'; b.style.cursor = 'wait'; });
    // 1.5초 후 자동 해제 (실패/조기 return 대비 — 정상 저장 시는 모달 close 시 함께 해제됨)
    setTimeout(() => {
      window._saveNewJobBusy = false;
      _saveBtns.forEach(b => { b.disabled = false; if (b.dataset.savingOrig) b.textContent = b.dataset.savingOrig; b.style.opacity = ''; b.style.cursor = ''; });
    }, 2000);

    // AS 인라인 편집 모드 — 모든 thread 편집이 이미 live 저장되었으므로 모달만 닫음
    if (window._asInlineEditJobId) {
      const jid = window._asInlineEditJobId;
      try { closeModal('newJobModal'); } catch(e){}
      try { showToast('✅ 기존 AS 업무에 저장됨 (ID: ' + jid + ')'); } catch(e){}
      try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
      try { if (typeof hydrateNewopen === 'function') hydrateNewopen('all'); } catch(e){}
      try { if (typeof hydrateAsMgmt === 'function') hydrateAsMgmt(); } catch(e){}
      return;
    }
    const storeName = (document.getElementById('jobStoreName') || {}).value?.trim();
    if (!storeName) { showToast('점포명을 입력하세요'); document.getElementById('jobStoreName')?.focus(); return; }

    // F-2: 중복 감지 — 동일 매장+동일 카테고리 7일내 진행 중 업무 존재 시 확인
    // AS 는 자동 머지 정책이므로 confirm 스킵 (별도 업무 생성 X)
    try {
      const _candType = (document.getElementById('jobType') || {}).value || '';
      const _isAsCheck = /AS/i.test(_candType);
      if (!_isAsCheck) {
        const _dup = (typeof window.findSimilarRecentJob === 'function')
          ? window.findSimilarRecentJob(storeName, _candType, 7) : null;
        if (_dup) {
          const _date = _dup.date || (_dup.createdAt ? new Date(_dup.createdAt).toISOString().slice(0,10) : '');
          const _who = _dup.engineer || _dup.assignee || '담당자 미지정';
          const msg = `⚠️ 동일 매장에 최근 7일 내 같은 카테고리의 진행 중 업무가 있습니다.\n\n` +
                      `· ${storeName}\n· ${_dup.type || '업무'}${_date?' ('+_date+')':''}\n· ${_who}\n\n계속 등록하시겠습니까?`;
          if (!confirm(msg)) return;
        }
      }
    } catch(e) { console.warn('[saveNewJob] dup-check 실패', e); }

    // 등록된 점포 매칭 (미등록 모드면 강제로 unregistered:true)
    const storeMatch = jobStoreUnregistered ? null
      : (getStores() || []).find(s => (s.name || '').trim() === storeName) || null;

    // 투입 장비 행 정리 (수량 0인 행 제외, 이름 빈 행 제외)
    const equipment = (typeof equipRows !== 'undefined' && Array.isArray(equipRows))
      ? equipRows.filter(r => r.name && (Number(r.qty) || 0) > 0).map(r => {
          // 카탈로그 행이면 optionValues 객체 사용, 레거시면 variant 문자열
          const opts = r.optionValues && Object.keys(r.optionValues).length > 0 ? r.optionValues : null;
          const variantStr = opts ? Object.values(opts).join(' / ') : (r.variant || '');
          return {
            name: r.name,
            spec: r.spec || '',
            options: opts,                  // 다중 옵션 객체 (카탈로그)
            variant: variantStr,             // 표시/검색 호환
            size: r.size || '',
            extra: r.extra || '',
            fixed: !!r.fixed,
            fixedKey: r.fixedKey || '',
            condition: r.condition || 'new',
            qty: Number(r.qty) || 0,
            costPrice: Number(r.costPrice) || 0,
            salePrice: Number(r.salePrice) || 0,
            subtotal: (Number(r.qty)||0) * (Number(r.salePrice)||0),
          };
        })
      : [];
    const equipTotal = equipment.reduce((s, e) => s + (e.subtotal || 0), 0);

    // 작업 유형 — 신규 컨텍스트는 jobNewSubcat (단일 셀렉트), 그 외는 메인 jobType
    let jobType = (document.getElementById('jobType') || {}).value || '신규';
    const newSubEl = document.getElementById('jobNewSubcat');
    if (newSubEl && newSubEl.style.display !== 'none' && newSubEl.value) {
      jobType = newSubEl.value;  // '신규/오픈' | '신규/프로그램교체' | '신규/VAN변경'
    }
    // 🏷️ 소모품 컨텍스트는 picker 의 hidden input (suppliesPickedType) 우선
    //   jobType select 에는 '소모품/저울라벨' 등 option 이 없어서 sel.value 셋팅이 silent 실패함
    //   결과: type 이 이전 select 값 ('신규' 등) 그대로 남아 잘못 저장되는 버그 차단
    if (window._currentJobContext === 'supplies') {
      const pickedType = (document.getElementById('suppliesPickedType')||{}).value;
      if (pickedType) jobType = pickedType;
      else jobType = '소모품/기타';   // picker 미선택 시 기본
    }
    const isConsult = (jobType === '상담');
    const isAs = /AS/i.test(jobType);

    // AS 전용 필드 수집
    let asInfo = null;
    if (isAs) {
      const receivedAt = (document.getElementById('asReceivedAt') || {}).value || '';
      const dueDate = (document.getElementById('asDueDate') || {}).value || '';
      const dueTime = (document.getElementById('asDueTime') || {}).value || '';
      const request = (document.getElementById('asRequest') || {}).value?.trim() || '';
      const targets = [];
      if ((document.getElementById('asTargetVAN')||{}).checked) targets.push('VAN');
      if ((document.getElementById('asTargetPOS')||{}).checked) targets.push('POS');
      if ((document.getElementById('asTargetKIO')||{}).checked) targets.push('키오스크');
      if ((document.getElementById('asTargetETC')||{}).checked) targets.push('기타');
      asInfo = { receivedAt, dueDate, dueTime, request, targets };
    }

    // 신규 카테고리 — 분류기가 'new' 로 라우팅되도록 lineCategory 명시
    const isNewSub = /^신규\//.test(jobType);
    const isSupplies = (window._currentJobContext === 'supplies') || /^소모품/.test(jobType);
    const job = {
      id: 'JOB-' + Date.now().toString(36).toUpperCase(),
      type:      jobType,
      // lineCategory: 신규는 'open_store', 소모품은 'supplies' — classifyJobCategory 안정성 보장
      lineCategory: isNewSub ? 'open_store' : (isSupplies ? 'supplies' : undefined),
      category:    isSupplies ? 'supplies' : undefined,
      storeName,
      store: storeName, // alias
      storeId: storeMatch ? storeMatch.id : '',
      unregistered: jobStoreUnregistered || !storeMatch,
      engineer:  (document.getElementById('jobEngineer') || {}).value || '',
      consultDate:  (document.getElementById('jobConsultDate')   || {}).value || '',
      // AS 일 때는 매장 주요 일정 비움
      installDate:  isAs ? '' : ((document.getElementById('jobInstallDate')   || {}).value || ''),
      softOpenDate: isAs ? '' : ((document.getElementById('jobSoftOpenDate')  || {}).value || ''),
      openDate:     isAs ? '' : ((document.getElementById('jobOpenDate')      || {}).value || ''),
      // 🚚 소모품 발송일 — 글로벌 규칙: 모든 업무 기록은 날짜 필수. 빈 값이면 today 자동
      shipDate:     (function(){
        const v = (document.getElementById('jobShipDate') || {}).value;
        if (v) return v;
        if (window._currentJobContext !== 'supplies') return '';
        // 소모품에서 발송일이 비어있으면 today 강제
        return (typeof _kstNow === 'function') ? String(_kstNow()||'').slice(0,10) : new Date().toISOString().slice(0,10);
      })(),
      // 💳 소모품 처리 구분 — support / prepaid / postpaid
      supplyMode:   (document.querySelector('input[name="jobSupplyMode"]:checked')||{}).value || (window._currentJobContext === 'supplies' ? 'support' : undefined),
      // 💵 금액 — 지원은 0, 선불/후불은 입력값
      amount:       (function(){
        const mode = (document.querySelector('input[name="jobSupplyMode"]:checked')||{}).value || 'support';
        if (window._currentJobContext !== 'supplies') return undefined;
        if (mode === 'support') return 0;
        return parseInt(String((document.getElementById('jobSupplyAmount')||{}).value||'0').replace(/[^\d]/g,''), 10) || 0;
      })(),
      // 📦 수량 + 단위 (소모품 모드에서만 사용) — sub-card 표시용
      supplyQty:    (function(){
        if (window._currentJobContext !== 'supplies') return undefined;
        const n = parseInt(String((document.getElementById('jobSupplyQty')||{}).value||'1').replace(/[^\d]/g,''), 10);
        return (Number.isFinite(n) && n > 0) ? n : 1;
      })(),
      supplyUnit:   (function(){
        if (window._currentJobContext !== 'supplies') return undefined;
        return ((document.getElementById('jobSupplyUnit')||{}).value || '개').trim();
      })(),
      // ✏️ 기타 품목명 — type='소모품/기타' 일 때만 사용. LINE 메시지·발송 리스트의 품목명으로 사용됨
      supplyEtcName:(function(){
        if (window._currentJobContext !== 'supplies') return undefined;
        if (jobType !== '소모품/기타') return undefined;
        return ((document.getElementById('jobSupplyEtcName')||{}).value || '').trim();
      })(),
      // 💰 수금 예정일 — 후불 모드에서만 입력. 다른 모드면 빈 문자열
      arDueDate:    (function(){
        if (window._currentJobContext !== 'supplies') return undefined;
        const mode = (document.querySelector('input[name="jobSupplyMode"]:checked')||{}).value || 'support';
        if (mode !== 'postpaid') return '';
        return ((document.getElementById('jobSupplyArDue')||{}).value || '').slice(0,10);
      })(),
      // AS 전용
      asReceivedAt: asInfo ? asInfo.receivedAt : '',
      asDueDate:    asInfo ? asInfo.dueDate    : '',
      asDueTime:    asInfo ? asInfo.dueTime    : '',
      asTargets:    asInfo ? asInfo.targets    : [],
      asRequest:    asInfo ? asInfo.request    : '',
      address:   (document.getElementById('jobAddressInput') || {}).value?.trim() || '',
      contactName:  (document.getElementById('jobContactName')  || {}).value?.trim() || '',
      contactRole:  (document.getElementById('jobContactRole')  || {}).value?.trim() || '',
      contactPhone: (document.getElementById('jobContactPhone') || {}).value?.trim() || '',
      // AS 작업은 요청 내용을 notes 에도 복사 (AS 관리 테이블 호환)
      notes:     isAs
        ? (asInfo.request || ((document.getElementById('jobNotes')||{}).value?.trim() || ''))
        : ((document.getElementById('jobNotes') || {}).value?.trim() || ''),
      equipment,
      equipTotal,
      // 신규/AS/소모품 업무 — 요청사항/처리 기록 스레드 (그룹형)
      // AS: asRequest 가 있고 스레드가 비었으면 첫 ROOT 로 자동 시드
      // 소모품: jobSupplyRequest 가 있으면 ROOT 시드 + (바로 완료 체크 시) child '완료' 자동 추가
      thread: (() => {
        let draft = Array.isArray(window._jobThreadDraft) ? window._jobThreadDraft.slice() : [];
        const ts = (typeof _kstDateTimeStr === 'function') ? _kstDateTimeStr()
                  : new Date().toISOString().slice(0,16).replace('T',' ');
        const author = ((typeof _currentAuthName==='function') ? _currentAuthName() : '담당자') || '담당자';
        if (isAs && draft.length === 0 && asInfo && asInfo.request) {
          draft = [{ ts, author, status:'요청접수', text: asInfo.request,
                     threadId: 'TR-as-seed-' + Date.now(), parentId: null }];
        }
        // 🏷️ 소모품: 요청접수 textarea 내용이 있으면 ROOT 시드
        if (window._currentJobContext === 'supplies') {
          const supReqEl = document.getElementById('jobSupplyRequest');
          const supReq = supReqEl ? (supReqEl.value || '').trim() : '';
          if (supReq && draft.length === 0) {
            const rootId = 'TR-sup-seed-' + Date.now();
            draft = [{ ts, author, status:'요청접수', text: supReq, threadId: rootId, parentId: null }];
            // 바로 완료 체크 시 자식 '완료' entry 추가 → job 도 완료 상태로
            const doneNow = !!(document.getElementById('jobSupplyDoneNow')||{}).checked;
            if (doneNow) {
              draft.push({ ts, author, status:'완료', text:'(자동) 요청접수와 동시에 완료 처리',
                threadId: 'TR-sup-done-' + Date.now() + '-' + Math.random().toString(36).slice(2,5),
                parentId: rootId });
            }
          }
        }
        return (typeof window._threadMigrate === 'function')
                ? window._threadMigrate(draft) : draft;
      })(),
      // VAN 서류 진행 — 신규 폼은 read-only 표시이므로 매장 프로필 스냅샷 저장
      vandocs: (function(){
        const s = storeMatch;
        if (s) {
          const vp = s.vanProfile || {};
          const pp = s.payProfile || {};
          const vans = {};
          ['KOCES','NICE','KIS','KSNET'].forEach(b => {
            if (vp[b] && vp[b].tid) vans[b] = { status:'접수', tid:vp[b].tid, serial:vp[b].serial||'' };
          });
          return {
            vans,
            easy:  (pp['간편결제']   && pp['간편결제'].tid)   ? { status:'접수', tid: pp['간편결제'].tid }   : { status:'접수', tid:'' },
            kakao: (pp['카카오페이'] && pp['카카오페이'].tid) ? { status:'접수', tid: pp['카카오페이'].tid } : { status:'접수', tid:'' },
          };
        }
        return { vans:{}, easy:{status:'접수',tid:''}, kakao:{status:'접수',tid:''} };
      })(),
      // 🏷️ 소모품: 후불(미수) 은 수금 처리 전까지 자동 완료 X
      //   - 후불: 항상 '요청접수' (doneNow 체크 시에만 완료)
      //   - 그 외: 요청 비어있으면 자동 완료, 채워졌고 '바로 완료' 체크면 완료, 아니면 요청접수
      status: (() => {
        if (isConsult) return '상담중';
        if (isAs) return '접수';
        if (window._currentJobContext === 'supplies') {
          const supReq = ((document.getElementById('jobSupplyRequest')||{}).value || '').trim();
          const doneNow = !!(document.getElementById('jobSupplyDoneNow')||{}).checked;
          const supMode = (document.querySelector('input[name="jobSupplyMode"]:checked')||{}).value || 'support';
          if (supMode === 'postpaid') return doneNow ? '완료' : '요청접수';
          if (!supReq) return '완료';
          if (doneNow) return '완료';
          return '요청접수';
        }
        return '진행중';
      })(),
      completed: (() => {
        if (window._currentJobContext !== 'supplies') return undefined;
        const supReq = ((document.getElementById('jobSupplyRequest')||{}).value || '').trim();
        const doneNow = !!(document.getElementById('jobSupplyDoneNow')||{}).checked;
        const supMode = (document.querySelector('input[name="jobSupplyMode"]:checked')||{}).value || 'support';
        if (supMode === 'postpaid') return !!doneNow;
        return (!supReq) || doneNow;
      })(),
      doneAt: (() => {
        if (window._currentJobContext !== 'supplies') return undefined;
        const supReq = ((document.getElementById('jobSupplyRequest')||{}).value || '').trim();
        const doneNow = !!(document.getElementById('jobSupplyDoneNow')||{}).checked;
        const supMode = (document.querySelector('input[name="jobSupplyMode"]:checked')||{}).value || 'support';
        if (supMode === 'postpaid') return doneNow ? new Date().toISOString() : '';
        if ((!supReq) || doneNow) return new Date().toISOString();
        return '';
      })(),
      // 📷📎 첨부 (newJobUploader)
      attachments: (function(){
        try {
          if (window._newJobUploaderCtl) return window._newJobUploaderCtl.get() || [];
        } catch(_){}
        return [];
      })(),
      createdAt: Date.now()
    };

    const jobs = getJobs();

    // 🆕 AS 도 항상 새 작업으로 등록 — 자동 병합 제거 (2026-06-02)
    //   기존: 같은 매장 AS(완료 포함)에 병합 → 완료된 옛 작업(예: 4/11)에 붙어
    //   LINE 발송 시 옛 날짜·옛 작성자가 표기되는 사고. 이제 폼 제출은 항상 새 job.
    //   기존 작업의 추가 진행은 해당 작업 thread 에서 직접 기록(ts=오늘).
    //   (LINE 자동수입 approvePending 은 '진행 중에만 병합'으로 별도 유지)
    let mergedIntoExisting = null;

    if (!mergedIntoExisting) {
      jobs.unshift(job);
    }
    saveJobs(jobs);
    // 신규 폼에서 입력한 VAN/간편결제 정보 → store.vanProfile/payProfile 누적
    // (다음 신규/매장상세 화면에서 같은 데이터 재사용)
    try {
      const vd = job.vandocs;
      if (vd && job.storeId) {
        const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
        const sIdx = stores.findIndex(x => x.id === job.storeId);
        if (sIdx >= 0) {
          const s = stores[sIdx];
          let touched = false;
          // legacy vandocs.van → KOCES
          const legacy = vd.van;
          const vans = (vd.vans && typeof vd.vans === 'object') ? vd.vans : {};
          ['KOCES','NICE','KIS','KSNET'].forEach(b => {
            const src = vans[b] || (b === 'KOCES' ? legacy : null);
            if (!src || !src.tid) return;
            s.vanProfile = s.vanProfile || {};
            s.vanProfile[b] = Object.assign({}, s.vanProfile[b]||{}, {
              tid: src.tid, serial: src.serial || (s.vanProfile[b]?.serial),
              updatedAt: Date.now(), sourceJobId: job.id,
            });
            touched = true;
          });
          if (vd.easy && vd.easy.tid) {
            s.payProfile = s.payProfile || {};
            s.payProfile['간편결제'] = { tid: vd.easy.tid, updatedAt: Date.now(), sourceJobId: job.id };
            touched = true;
          }
          if (vd.kakao && vd.kakao.tid) {
            s.payProfile = s.payProfile || {};
            s.payProfile['카카오페이'] = { tid: vd.kakao.tid, updatedAt: Date.now(), sourceJobId: job.id };
            touched = true;
          }
          if (touched) {
            stores[sIdx] = s;
            if (typeof saveStores === 'function') saveStores(stores);
          }
        }
      }
    } catch(e) { console.warn('[saveNewJob vandoc→store sync]', e); }
    // 📇 입력한 연락처(이름/직책/전화/이메일/주소)를 매장에 누적 (다음 업무·매장상세에서 재사용)
    try { if (typeof ingestJobContactsToStore === 'function') ingestJobContactsToStore(job); } catch(e){ console.warn('[saveNewJob contacts→store]', e); }
    // AS 머지 저장은 1.5초 디바운스 대신 즉시 푸시 — stale cloud 가 머지된 thread 를 덮을 위험 차단
    if (mergedIntoExisting) {
      try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}
    }

    // 📡 LINE 발송 체크 상태 (모달 닫기 전에 읽어둠)
    const wantLine = !!document.getElementById('newJobLineSend')?.checked;
    const savedJob = mergedIntoExisting ? mergedIntoExisting : job;

    closeModal('newJobModal');
    if (mergedIntoExisting) {
      showToast(`✅ ${storeName} — 기존 AS 업무에 새 요청이 추가되었습니다`);
    } else {
      showToast(`✅ ${storeName} 작업이 등록되었습니다${job.unregistered ? ' (미등록 가맹점)' : ''}`);
    }

    // 대시보드/신규관리/상담조회 갱신
    try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
    try { if (typeof hydrateNewopen === 'function') hydrateNewopen('all'); } catch(e){}
    try { if (typeof hydrateConsult === 'function') hydrateConsult('active'); } catch(e){}
    try { if (typeof hydrateAsMgmt === 'function') hydrateAsMgmt(); } catch(e){}

    // 📡 LINE 발송 — 등록된 업무 전체 컨텍스트로 컴포저 열기
    if (wantLine && savedJob && savedJob.id) {
      try {
        // 저장된 jobs 에서 다시 조회 (최신 상태)
        const jobs2 = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        const fresh = jobs2.find(j => j.id === savedJob.id) || savedJob;
        if (typeof window._openLineForJob === 'function') {
          window._openLineForJob(fresh);
        }
      } catch(e) { console.warn('[saveNewJob LINE send]', e); }
    }

    // 입력 필드 초기화
    const storeEl = document.getElementById('jobStoreName');
    if (storeEl) storeEl.value = '';
    const notesEl = document.getElementById('jobNotes');
    if (notesEl) notesEl.value = '';
    const addrEl = document.getElementById('jobAddressInput');
    if (addrEl) addrEl.value = '';
    ['jobConsultDate','jobInstallDate','jobSoftOpenDate','jobOpenDate','jobContactName','jobContactRole','jobContactPhone','asReceivedAt','asDueDate','asDueTime','asRequest'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    // 👤 매장 담당자 picker 초기화 (매장 선택 시 다시 채워짐)
    { const cp = document.getElementById('jobContactPicker'); if (cp) { cp.innerHTML = '<option value="">+ 직접 입력</option>'; cp.style.display = 'none'; } window._jobContactPickList = []; }
    ['asTargetVAN','asTargetPOS','asTargetKIO','asTargetETC'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    if (jobStoreUnregistered) toggleUnregisteredStore(); // 모드 초기화
    // 장비 테이블 초기화
    if (typeof buildBallSelectors === 'function') buildBallSelectors();
  }

  /* 점포 datalist 채우기 (모달 열릴 때도 호출) */
  function populateStoreNameList() {
    const dl = document.getElementById('storeNameList');
    if (dl) {
      const stores = getStores();
      dl.innerHTML = stores.map(s => `<option value="${s.name.replace(/"/g,'&quot;')}">`).join('');
    }
    // 점포명 검색 결과 초기화
    const p = document.getElementById('jobStoreResults');
    if (p) { p.style.display = 'none'; p.innerHTML = ''; }
    // 담당 엔지니어 select 채우기
    populateEngineerSelect();
  }

  /* 새 작업 모달의 점포명 검색 — 통일 토큰 검색(_searchStores) 사용 (2026-06-19)
     상호+주소+사업자+대표+거래처코드 토큰 매칭(비연속·역순). 옛 범위 라디오(_matchStore) 폐기. */
  function runJobStoreSearch() {
    const inp = document.getElementById('jobStoreName');
    const panel = document.getElementById('jobStoreResults');
    if (!inp || !panel) return;
    const raw = String(inp.value || '');
    if (!raw.trim()) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
    let matches;
    if (typeof window._searchStores === 'function') {
      matches = window._searchStores(raw, 30) || [];
    } else {
      const q = _normalizeSearch(raw);
      matches = q ? getStores().filter(s => _matchStore(s, q, 'name_biz')).slice(0, 30) : [];
    }
    if (matches.length === 0) {
      panel.innerHTML = `<div style="padding:12px 14px;font-size:12px;color:var(--gray-400);text-align:center">검색 결과가 없습니다.</div>`;
      panel.style.display = 'block';
      return;
    }
    panel.innerHTML = matches.map(s => {
      const name = esc(s.name || '-');
      const signage = esc(s.signageName || '');
      const biz  = esc(s.biz || s.bizno || '');
      const ceo  = esc(s.ceo || s.owner || '');
      const tel  = esc(s.tel || s.phone || '');
      const addr = esc(s.addr || s.address || '');
      const sub = [ceo, biz, tel].filter(Boolean).join(' · ');
      const args = `${JSON.stringify(name).replace(/"/g,'&quot;')}, ${JSON.stringify(addr).replace(/"/g,'&quot;')}, ${JSON.stringify(biz).replace(/"/g,'&quot;')}, ${JSON.stringify(ceo).replace(/"/g,'&quot;')}`;
      return `<div class="js-store-result" onclick="pickJobStore(${args})" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--gray-100)" onmouseover="window._jobStoreHL&&window._jobStoreHL(this)" onmouseout="this.style.background=''">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
          <div style="font-size:13px;font-weight:700;color:var(--gray-800)">${name}${signage ? ` <span style="font-size:11.5px;color:#1d4ed8;font-weight:600">🪧 ${signage}</span>` : ''}</div>
          ${biz ? `<code style="font-size:11px;color:var(--gray-600);background:#F3F4F6;padding:1px 6px;border-radius:3px;font-family:monospace">${biz}</code>` : ''}
        </div>
        ${(ceo || tel) ? `<div style="font-size:11px;color:var(--gray-500);margin-top:2px">${[ceo, tel].filter(Boolean).join(' · ')}</div>` : ''}
        ${addr ? `<div style="font-size:11px;color:var(--gray-400);margin-top:1px">${addr}</div>` : ''}
      </div>`;
    }).join('');
    window._jobStoreActiveIdx = -1;
    panel.style.display = 'block';
  }

  /* 매장 검색 결과 키보드 네비 — ↓/↑/Tab 이동, Enter 선택, Esc 닫기 (runJobStoreSearch 패널) */
  window._jobStoreActiveIdx = -1;
  function _jobStoreResultEls() {
    const p = document.getElementById('jobStoreResults');
    return p ? Array.from(p.querySelectorAll('.js-store-result')) : [];
  }
  window._jobStoreHL = function(el) {
    const els = _jobStoreResultEls();
    const idx = els.indexOf(el);
    if (idx < 0) return;
    window._jobStoreActiveIdx = idx;
    els.forEach((e, i) => { e.style.background = (i === idx) ? '#EEF2FF' : ''; });
  };
  function _jobStoreMove(delta) {
    const els = _jobStoreResultEls();
    if (!els.length) return;
    let idx = window._jobStoreActiveIdx;
    idx = (idx < 0 && delta < 0) ? els.length - 1 : idx + delta;
    idx = ((idx % els.length) + els.length) % els.length;
    window._jobStoreActiveIdx = idx;
    els.forEach((e, i) => { e.style.background = (i === idx) ? '#EEF2FF' : ''; });
    try { els[idx].scrollIntoView({ block: 'nearest' }); } catch(_){}
  }
  window.runJobStoreKey = function(e) {
    const panel = document.getElementById('jobStoreResults');
    if (!panel || panel.style.display === 'none') return;
    const els = _jobStoreResultEls();
    if (!els.length) return;
    const k = e.key;
    if (k === 'ArrowDown' || (k === 'Tab' && !e.shiftKey)) { e.preventDefault(); _jobStoreMove(1); }
    else if (k === 'ArrowUp' || (k === 'Tab' && e.shiftKey)) { e.preventDefault(); _jobStoreMove(-1); }
    else if (k === 'Enter') {
      const idx = window._jobStoreActiveIdx;
      if (idx >= 0 && els[idx]) { e.preventDefault(); els[idx].click(); }
    } else if (k === 'Escape') { panel.style.display = 'none'; window._jobStoreActiveIdx = -1; }
  };

  function pickJobStore(name, address, biz, ceo) {
    const inp = document.getElementById('jobStoreName');
    if (inp) inp.value = name;
    const addrEl = document.getElementById('jobAddressInput');
    if (addrEl && address) addrEl.value = address;
    const panel = document.getElementById('jobStoreResults');
    if (panel) panel.style.display = 'none';
    // 사업자 정보 표시 — 혼선 방지
    const info = document.getElementById('jobStorePickedInfo');
    const bizEl = document.getElementById('jobStorePickedBiz');
    const ceoEl = document.getElementById('jobStorePickedCeo');
    if (info) {
      if (biz || ceo) {
        if (bizEl) bizEl.textContent = biz || '-';
        if (ceoEl) ceoEl.textContent = ceo ? ('대표 ' + ceo) : '';
        info.style.display = 'block';
      } else {
        info.style.display = 'none';
      }
    }
    // 매장 선택 시 — 같은 매장 진행 중 업무 미리보기 갱신
    try { _refreshJobSimilarBanner(name); } catch(e) { console.warn('[similar] ', e); }
    // AS 컨텍스트 + 기존 AS 업무 존재 → 인라인 편집 모드로 전환
    try { _applyAsInlineEditMode(name); } catch(e) { console.warn('[asInlineEdit] ', e); }
    // VAN/간편결제 프로필 표시 — store DB 에서 조회
    try { _renderJobStoreVanProfile(name, biz); } catch(e) { console.warn('[vanProfile] ', e); }
    // VAN 서류 진행 — 매장 정보로 read-only 표시 갱신
    try { _renderStoreVanInfoReadonly('jobVandocsContainer', name, biz); } catch(e) { console.warn('[vandocReadonly] ', e); }
    // 👤 매장 담당자 picker — 선택 매장의 기존 연락처를 드롭다운에 채움
    try { _populateJobContactPicker(name, biz); } catch(e) { console.warn('[contactPicker] ', e); }
  }
  window.pickJobStore = pickJobStore;

  /* 👤 요청접수 시 매장 담당자 선택 — 매장 store.contacts 를 드롭다운에 채워 고르면 자동 채움 (2026-06-19)
     (재고조사/소모품/VAN 확대 예정. 현재 newJobModal = 신규/AS 적용) */
  function _populateJobContactPicker(name, biz) {
    const sel = document.getElementById('jobContactPicker');
    if (!sel) return;
    let contacts = [];
    try {
      const st = (typeof _findStoreByNameOrBiz === 'function') ? _findStoreByNameOrBiz(name, biz) : null;
      if (st) {
        const tomb = new Set(Array.isArray(st.contactsDeleted) ? st.contactsDeleted : []);
        const keyOf = (c) => String(c.phone||'').replace(/\D/g,'') || ('n:' + String(c.name||'').trim() + '|' + String(c.role||'').trim());
        contacts = (Array.isArray(st.contacts) ? st.contacts : []).filter(c => c && (c.name || c.phone) && !tomb.has(keyOf(c)));
      }
    } catch(_){}
    window._jobContactPickList = contacts;
    const escFn = (typeof esc === 'function') ? esc : (s)=>String(s==null?'':s);
    if (!contacts.length) { sel.style.display = 'none'; sel.innerHTML = '<option value="">+ 직접 입력</option>'; return; }
    sel.innerHTML = '<option value="">+ 직접 입력</option>' + contacts.map((c,i) => {
      const label = [c.name || '(이름없음)', c.role, c.phone].filter(Boolean).join(' · ');
      return `<option value="${i}">${escFn(label)}</option>`;
    }).join('');
    sel.value = '';
    sel.style.display = 'block';
  }
  window._populateJobContactPicker = _populateJobContactPicker;
  function _onJobContactPick() {
    const sel = document.getElementById('jobContactPicker');
    if (!sel) return;
    const list = window._jobContactPickList || [];
    const idx = sel.value === '' ? -1 : parseInt(sel.value, 10);
    if (idx < 0 || !list[idx]) return;   // '직접 입력' — 기존 입력값 유지
    const c = list[idx];
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v || ''; };
    set('jobContactName', c.name);
    set('jobContactRole', c.role);
    set('jobContactPhone', c.phone);
  }
  window._onJobContactPick = _onJobContactPick;

  // 신규 폼 — 매장의 VAN/간편결제 정보를 read-only 카드로 표시
  // (편집 X — VAN 메뉴/매장 상세 모달에서만 편집. 신규 폼은 조회 전용)
  function _findStoreByNameOrBiz(name, biz) {
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const normFn = (typeof _normStoreKey === 'function') ? _normStoreKey : (s=>String(s||'').toLowerCase().replace(/\s+/g,''));
    const bNorm = String(biz||'').replace(/\D/g,'');
    if (bNorm && bNorm.length === 10) {
      const m = stores.find(s => String(s.biz||s.bizno||s.businessNumber||'').replace(/\D/g,'') === bNorm);
      if (m) return m;
    }
    if (name) {
      const nNorm = normFn(name);
      const m = stores.find(s => normFn(s.name||'') === nNorm);
      if (m) return m;
    }
    return null;
  }

  function _renderStoreVanInfoReadonly(containerId, name, biz) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const escH = (s) => String(s||'').replace(/[<>&]/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));
    if (!name && !biz) {
      root.innerHTML = `<div style="background:#F9FAFB;border:1px dashed var(--gray-300);border-radius:10px;padding:14px;text-align:center;color:var(--gray-400);font-size:12px">매장을 선택하면 등록된 VAN / 간편결제 / 카카오페이 정보가 표시됩니다.</div>`;
      return;
    }
    const store = _findStoreByNameOrBiz(name, biz);
    if (!store) {
      root.innerHTML = `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:12px;font-size:11.5px;color:#92400E">⚠ 매장 정보를 찾을 수 없습니다 (미등록 가맹점 모드이거나 이름이 일치하지 않을 수 있음)</div>`;
      return;
    }
    const vp = store.vanProfile || {};
    const pp = store.payProfile || {};
    const VAN_BRANDS = ['KOCES','NICE','KIS','KSNET'];
    const vBrands = VAN_BRANDS.filter(b => vp[b] && vp[b].tid);
    const pBrands = ['간편결제','카카오페이'].filter(b => pp[b] && pp[b].tid);
    if (vBrands.length === 0 && pBrands.length === 0) {
      root.innerHTML = `<div style="background:#F9FAFB;border:1px solid var(--gray-200);border-radius:10px;padding:12px 14px">
        <div style="font-weight:700;color:var(--gray-700);font-size:12.5px;margin-bottom:4px">📑 VAN / 간편결제 / 카카오페이 정보</div>
        <div style="font-size:11.5px;color:var(--gray-500)">이 매장에 등록된 VAN/간편결제 정보가 없습니다. VAN 메뉴에서 등록하세요.</div>
      </div>`;
      return;
    }
    const fmtTs = (t) => t ? new Date(t).toLocaleDateString('ko-KR') : '';
    const vCards = vBrands.map(b => {
      const e = vp[b];
      const showSerial = (b === 'KOCES');
      return `<div style="background:#fff;border:1px solid #BFDBFE;border-left:4px solid #1d4ed8;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <div style="font-weight:700;color:#1d4ed8;font-size:13px">💳 ${escH(b)}</div>
          <div style="font-size:10px;color:var(--gray-400)">${fmtTs(e.updatedAt)}</div>
        </div>
        <div style="display:grid;grid-template-columns:${showSerial?'1fr 1fr':'1fr'};gap:6px">
          <div>
            <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:2px">TID</div>
            <div style="padding:6px 8px;background:#F8FAFC;border:1px solid var(--gray-200);border-radius:6px;font-family:monospace;font-size:12px;color:var(--gray-800)">${escH(e.tid||'-')}</div>
          </div>
          ${showSerial ? `<div>
            <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:2px">Serial</div>
            <div style="padding:6px 8px;background:#F8FAFC;border:1px solid var(--gray-200);border-radius:6px;font-family:monospace;font-size:12px;color:var(--gray-800)">${escH(e.serial||'-')}</div>
          </div>` : ''}
        </div>
      </div>`;
    }).join('');
    const pCards = pBrands.map(b => {
      const e = pp[b];
      const icon = b === '간편결제' ? '📱' : '🟡';
      return `<div style="background:#fff;border:1px solid #FCD34D;border-left:4px solid #92400E;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <div style="font-weight:700;color:#92400E;font-size:13px">${icon} ${escH(b)}</div>
          <div style="font-size:10px;color:var(--gray-400)">${fmtTs(e.updatedAt)}</div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:2px">TID</div>
          <div style="padding:6px 8px;background:#F8FAFC;border:1px solid var(--gray-200);border-radius:6px;font-family:monospace;font-size:12px;color:var(--gray-800)">${escH(e.tid||'-')}</div>
        </div>
      </div>`;
    }).join('');
    root.innerHTML = `
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div style="font-weight:700;color:#1E40AF;font-size:13.5px">📑 VAN / 간편결제 / 카카오페이 정보</div>
          <div style="font-size:10.5px;color:#1E40AF;opacity:0.8">조회 전용 — 편집은 VAN 메뉴/매장 상세에서</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">${vCards}${pCards}</div>
      </div>`;
  }
  window._renderStoreVanInfoReadonly = _renderStoreVanInfoReadonly;

  // 신규 폼 — 선택된 매장의 VAN/간편결제 프로필 표시 (조회 전용)
  function _renderJobStoreVanProfile(name, biz) {
    const el = document.getElementById('jobStoreVanProfile');
    if (!el) return;
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const normFn = (typeof _normStoreKey === 'function') ? _normStoreKey : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
    const nNorm = normFn(name);
    const bNorm = String(biz||'').replace(/\D/g,'');
    // 매장 매칭 — 사업자번호 우선, 매장명 fallback
    let store = null;
    if (bNorm && bNorm.length === 10) {
      store = stores.find(s => String(s.biz||'').replace(/\D/g,'') === bNorm);
    }
    if (!store && name) {
      store = stores.find(s => normFn(s.name||'') === nNorm);
    }
    if (!store) { el.style.display = 'none'; el.innerHTML=''; return; }
    const vp = store.vanProfile || {};
    const pp = store.payProfile || {};
    const vBrands = ['KOCES','NICE','KIS','KSNET'].filter(b => vp[b] && vp[b].tid);
    const pBrands = Object.keys(pp).filter(b => pp[b] && pp[b].tid);
    if (vBrands.length === 0 && pBrands.length === 0) { el.style.display = 'none'; el.innerHTML=''; return; }
    const escH = (s) => String(s||'').replace(/[<>&]/g,'');
    const fmtTs = (t) => t ? new Date(t).toLocaleDateString('ko-KR') : '';
    const vChips = vBrands.map(b => {
      const e = vp[b];
      return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#fff;border:1px solid #BFDBFE;border-radius:12px;font-size:10.5px"><b style="color:#1d4ed8">${b}</b> <span style="font-family:monospace;color:var(--gray-700)">TID:${escH(e.tid)}</span>${e.serial?` <span style="color:var(--gray-500)">·SN:${escH(e.serial)}</span>`:''}</span>`;
    }).join(' ');
    const pChips = pBrands.map(b => {
      const e = pp[b];
      return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#fff;border:1px solid #FCD34D;border-radius:12px;font-size:10.5px"><b style="color:#92400E">${escH(b)}</b> <span style="font-family:monospace;color:var(--gray-700)">TID:${escH(e.tid)}</span></span>`;
    }).join(' ');
    el.innerHTML = `<div style="padding:8px 10px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px">
      <div style="font-size:11px;font-weight:700;color:#1e40af;margin-bottom:5px">📡 등록된 VAN / 간편결제 프로필 <span style="font-size:10px;color:var(--gray-500);font-weight:500">(이 매장에 이미 저장된 정보 — 신규 등록 시 참고)</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${vChips}${pChips}</div>
    </div>`;
    el.style.display = '';
  }
  window._renderJobStoreVanProfile = _renderJobStoreVanProfile;

  // AS 컨텍스트에서 매장 선택 시 — 기존 진행중 AS 업무가 있으면 그 thread 를 인라인 편집
  function _applyAsInlineEditMode(storeName) {
    const banner = document.getElementById('asInlineEditBanner');
    // 컨텍스트가 AS 가 아니면 — 인라인 편집 모드 해제 (draft 빈 thread 로)
    if (window._currentJobContext !== 'as' || !storeName || !storeName.trim()) {
      window._asInlineEditJobId = null;
      window._lastAsInlineStore = null;
      if (banner) banner.style.display = 'none';
      document.body.classList.remove('as-inline-edit-mode');
      if (window._currentJobContext === 'as') {
        try {
          window._jobThreadDraft = [];
          window._renderThreadGroups('jobThreadContainer', [], { editable:true, jobId:null, draftMode:true });
        } catch(e){}
      }
      return;
    }
    // Fix B: 동일 매장 재호출이면 draft/UI 보존
    const sameStoreAsLast = (window._lastAsInlineStore === storeName);
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const normFn = (typeof _normStoreKey === 'function') ? _normStoreKey : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
    const isDone = (typeof window._isJobDone === 'function') ? window._isJobDone : () => false;
    const classifyFn = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : () => 'as';
    const target = normFn(storeName);
    // Fix C: 완료 AS 도 후보로 포함, 진행중 우선
    const candidates = jobs.filter(j => {
      if (classifyFn(j) !== 'as') return false;
      const sn = (j.storeName || j.store || '').trim();
      if (!sn) return false;
      return normFn(sn) === target;
    });
    let existing = candidates.find(j => !isDone(j));
    if (!existing) {
      existing = candidates.slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0))[0];
    }
    window._lastAsInlineStore = storeName;
    if (!existing) {
      // 기존 AS 없음 — draft 모드 유지. 동일 매장 재호출이면 draft 보존
      window._asInlineEditJobId = null;
      if (banner) banner.style.display = 'none';
      document.body.classList.remove('as-inline-edit-mode');
      try {
        if (!sameStoreAsLast) {
          window._jobThreadDraft = [];
        }
        const openKey = '_threadOpen_draft';
        if (!sameStoreAsLast) window[openKey] = {};
        window[openKey] = window[openKey] || {};
        window[openKey]['__newroot__'] = true;
        window._renderThreadGroups('jobThreadContainer', window._jobThreadDraft || [],
          { editable:true, jobId:null, draftMode:true });
      } catch(e){}
      return;
    }
    // 기존 AS 발견 — 인라인 편집 모드 진입 (완료 상태였더라도 진행중 환원)
    window._asInlineEditJobId = existing.id;
    if (existing.completed || existing.status === '완료') {
      try {
        const _jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        const _i = _jobs.findIndex(x => x.id === existing.id);
        if (_i >= 0) {
          _jobs[_i].completed = false;
          _jobs[_i].status = '진행중';
          existing = _jobs[_i];
          if (typeof saveJobs === 'function') saveJobs(_jobs);
        }
      } catch(e){}
    }
    document.body.classList.add('as-inline-edit-mode');
    const rootCnt = (existing.thread||[]).filter(e => e && e.parentId == null).length;
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML =
        '<div style="font-size:13px;font-weight:800;color:#1E40AF;margin-bottom:4px">' +
        '📌 이 매장의 기존 AS 업무에 누적 기록 중 — ID: ' + (existing.id||'') + '</div>' +
        '<div style="font-size:11.5px;color:#1E40AF;line-height:1.5">' +
        '기존 요청 ' + rootCnt + '건 · 새 요청은 아래 <b>＋ 새 요청 접수</b> 로 추가하세요. ' +
        '편집 내용은 즉시 저장됩니다 — [완료] 를 눌러 모달을 닫으세요.</div>';
    }
    // 기존 job 의 thread 렌더 (draftMode:false, jobId 지정)
    try {
      window._renderThreadGroups('jobThreadContainer', existing.thread || [], { editable:true, jobId: existing.id, draftMode:false, maxRoots:5 });
      // 새 요청 접수 폼 자동 펼침
      const openKey = '_threadOpen_' + existing.id;
      window[openKey] = window[openKey] || {};
      window[openKey]['__newroot__'] = true;
      window._renderThreadGroups('jobThreadContainer', existing.thread || [], { editable:true, jobId: existing.id, draftMode:false, maxRoots:5 });
    } catch(e){ console.warn('[asInlineEdit] render', e); }
    // 푸터 [작업 등록] → [완료] 라벨 변경
    try {
      const footer = document.querySelector('#newJobModal .modal-footer .btn.btn-primary');
      if (footer) footer.textContent = '완료';
    } catch(e){}
  }
  window._applyAsInlineEditMode = _applyAsInlineEditMode;

  /* ─── 동일 매장 진행 업무 미리보기 (안전장치 ①) ─── */
  function _refreshJobSimilarBanner(storeName) {
    const banner = document.getElementById('jobSimilarBanner');
    if (!banner) return;
    if (!storeName || !storeName.trim()) {
      banner.style.display = 'none';
      return;
    }
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const normFn = (typeof _normStoreKey === 'function') ? _normStoreKey : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
    const target = normFn(storeName);
    const isDone = (typeof window._isJobDone === 'function') ? window._isJobDone : () => false;
    const classifyFn = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : () => 'as';
    const ctx = window._currentJobContext || '';
    const isNewCtx = (ctx === 'new');
    const isAsCtx  = (ctx === 'as');
    const isThreadCtx = isNewCtx || isAsCtx;
    let matches = jobs.filter(j => {
      if (isDone(j)) return false; // 진행 중만
      const s = (j.store || j.storeName || '').trim();
      if (!s) return false;
      return normFn(s) === target;
    });
    // 컨텍스트별 — 해당 카테고리 진행 중 업무만 노출
    if (isNewCtx) matches = matches.filter(j => classifyFn(j) === 'new');
    else if (isAsCtx) matches = matches.filter(j => classifyFn(j) === 'as');
    if (matches.length === 0) {
      banner.style.display = 'none';
      return;
    }
    document.getElementById('jobSimCount').textContent = matches.length;

    // 컨텍스트별 헤더/문구 조정
    const headerLbl = banner.querySelector('div[style*="font-size:12.5px"]');
    const subLbl = banner.querySelector('div[style*="line-height:1.5"]');
    if (isNewCtx) {
      if (headerLbl) headerLbl.innerHTML = `🆕 이 매장의 진행 중 <b>신규</b> 업무 <span id="jobSimCount" style="background:#92400e;color:#fff;font-size:10px;padding:1px 7px;border-radius:99px;margin-left:3px">${matches.length}</span>`;
      if (subLbl) subLbl.innerHTML = '기존 업무에 <b>요청접수를 추가</b>하거나 <b>진행 상태를 업데이트</b>할 수 있습니다. 신규 등록을 계속하려면 이 안내를 무시하고 아래에서 등록하세요.';
    } else if (isAsCtx) {
      if (headerLbl) headerLbl.innerHTML = `🔧 이 매장의 진행 중 <b>AS</b> 업무 <span id="jobSimCount" style="background:#92400e;color:#fff;font-size:10px;padding:1px 7px;border-radius:99px;margin-left:3px">${matches.length}</span>`;
      if (subLbl) subLbl.innerHTML = '진행 중인 AS 에 <b>요청접수를 추가</b>하거나 <b>처리 기록을 갱신</b>할 수 있습니다. 신규 AS 로 등록하려면 안내를 무시하고 아래에서 등록하세요.';
    } else {
      if (headerLbl) headerLbl.innerHTML = `⚠️ 이 매장의 진행 중 업무 <span id="jobSimCount" style="background:#92400e;color:#fff;font-size:10px;padding:1px 7px;border-radius:99px;margin-left:3px">${matches.length}</span>`;
      if (subLbl) subLbl.textContent = '새 업무 등록 전 같은 매장의 진행 중 업무를 확인하세요. 중복 등록 시 기존 업무에 기록을 추가하는 것이 효율적입니다.';
    }
    if (isThreadCtx) {
      // 자동 펼침
      const lst = document.getElementById('jobSimList');
      if (lst) lst.style.display = 'flex';
      const btn = document.getElementById('jobSimToggle');
      if (btn) btn.innerHTML = '접기 ▲';
    }

    const list = document.getElementById('jobSimList');
    if (list) {
      const escFn = (typeof esc === 'function') ? esc : (s)=>String(s||'');
      const catColor = c => ({ new:'#10B981', as:'#F59E0B', van:'#2563EB', supplies:'#8B5CF6', churn:'#EF4444' }[c] || '#6B7280');
      list.innerHTML = matches.slice(0, 5).map(j => {
        const cat = classifyFn(j);
        const date = j.date || (j.createdAt ? new Date(j.createdAt).toISOString().slice(0,10) : '');
        const who = j.engineer || j.assignee || '';
        // 진행 중 ROOT 수 (신규일 때만 의미 있음)
        const thread = Array.isArray(j.thread) ? j.thread : [];
        const rootCnt = thread.filter(e => e.parentId == null).length;
        const rootInfo = (isThreadCtx && rootCnt) ? `<span style="background:${isAsCtx?'#FEE2E2':'#DBEAFE'};color:${isAsCtx?'#991B1B':'#1E40AF'};font-size:10px;font-weight:700;padding:1px 6px;border-radius:99px;margin-left:4px">요청 ${rootCnt}건</span>` : '';
        // 액션 버튼 — 신규/AS 컨텍스트면 "+ 요청접수 추가"와 "이 업무 열기" 두 개
        const idEsc = escFn(j.id || '');
        const accentBg = isAsCtx ? '#B91C1C' : '#1E40AF';
        const actionBtns = !j.id ? '' : (isThreadCtx
          ? `<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-end">
               <button type="button" onclick="_jumpToJobThread('${idEsc}', true)" style="background:${accentBg};color:#fff;border:none;border-radius:5px;padding:4px 9px;font-size:10.5px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap">＋ 요청접수 추가</button>
               <button type="button" onclick="_jumpToJobThread('${idEsc}', false)" style="background:#fff;color:${accentBg};border:1px solid ${accentBg};border-radius:5px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">이 업무 열기</button>
             </div>`
          : `<button type="button" onclick="closeModal('newJobModal');setTimeout(()=>{try{editNewopen('${idEsc}')}catch(e){}},120)" style="background:#92400e;color:#fff;border:none;border-radius:5px;padding:4px 9px;font-size:10.5px;font-weight:800;cursor:pointer;font-family:inherit">이 업무로 이동</button>`);
        const cardBorder = isAsCtx ? '#FECACA' : (isNewCtx ? '#BFDBFE' : '#fde68a');
        return `<div style="background:#fff;border:1px solid ${cardBorder};border-radius:7px;padding:7px 10px;font-size:11.5px;display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;color:var(--gray-900)">
              <span style="background:${catColor(cat)};color:#fff;font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:99px;margin-right:4px">${escFn(j.type || cat)}</span>
              ${escFn(j.title || j.type || '업무')}${rootInfo}
            </div>
            <div style="font-size:10.5px;color:var(--gray-500);margin-top:2px">${date ? '📅 '+date+' · ' : ''}${who}</div>
          </div>
          ${actionBtns}
        </div>`;
      }).join('') + (matches.length > 5 ? `<div style="font-size:10.5px;color:${isAsCtx?'#B91C1C':(isNewCtx?'#1E40AF':'#92400e')};text-align:center;padding-top:4px">외 ${matches.length - 5}건...</div>` : '');
    }
    // 컨텍스트별 — 배너 톤 조정
    if (isNewCtx) {
      banner.style.background = '#EFF6FF';
      banner.style.borderColor = '#BFDBFE';
      banner.querySelectorAll('[style*="color:#92400e"]').forEach(el => {
        el.style.color = '#1E40AF';
        if (el.style.background.indexOf('#92400e') !== -1) el.style.background = '#1E40AF';
      });
    } else if (isAsCtx) {
      banner.style.background = '#FEF2F2';
      banner.style.borderColor = '#FECACA';
      banner.querySelectorAll('[style*="color:#92400e"]').forEach(el => {
        el.style.color = '#B91C1C';
        if (el.style.background.indexOf('#92400e') !== -1) el.style.background = '#B91C1C';
      });
    } else {
      banner.style.background = '#fffbeb';
      banner.style.borderColor = '#fde68a';
    }
    banner.style.display = 'block';
  }
  window._refreshJobSimilarBanner = _refreshJobSimilarBanner;

  // AS 접수정보 패널 — 접수 등록 버튼: 폼 값으로 요청접수 ROOT 를 스레드에 추가
  window._asReceiptRegister = function() {
    const req = (document.getElementById('asRequest')||{}).value?.trim() || '';
    if (!req) { try { showToast('AS 요청 내용을 입력하세요'); } catch(e){} const ta = document.getElementById('asRequest'); if (ta) ta.focus(); return; }
    const dueDate = (document.getElementById('asDueDate')||{}).value || '';
    const dueTime = (document.getElementById('asDueTime')||{}).value || '';
    const targets = [];
    if ((document.getElementById('asTargetVAN')||{}).checked) targets.push('VAN');
    if ((document.getElementById('asTargetPOS')||{}).checked) targets.push('POS');
    if ((document.getElementById('asTargetKIO')||{}).checked) targets.push('키오스크');
    if ((document.getElementById('asTargetETC')||{}).checked) targets.push('기타');
    const targetTxt = targets.length ? `[대상: ${targets.join(', ')}]` : '';
    const dueTxt = (dueDate || dueTime) ? `[처리예정: ${dueDate}${dueTime?' '+dueTime:''}]` : '';
    const headline = [dueTxt, targetTxt].filter(Boolean).join(' ');
    const text = headline ? (headline + '\n' + req) : req;
    const ts = (typeof _kstDateTimeStr === 'function') ? _kstDateTimeStr()
              : new Date().toISOString().slice(0,16).replace('T',' ');
    const author = ((typeof _currentAuthName==='function') ? _currentAuthName() : '담당자') || '담당자';
    const rootId = 'TR-as-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
    const entry = { ts, author, status:'요청접수', text, threadId: rootId, parentId: null };
    window._jobThreadDraft = Array.isArray(window._jobThreadDraft) ? window._jobThreadDraft : [];
    window._jobThreadDraft.push(entry);
    try { window._renderThreadGroups('jobThreadContainer', window._jobThreadDraft, { editable:true, jobId:null, draftMode:true }); } catch(e){}
    // 요청내용만 비움 (날짜/시간/대상은 다음 등록을 위해 유지)
    const ta = document.getElementById('asRequest'); if (ta) ta.value = '';
    try { showToast('📥 접수가 요청사항·처리기록에 등록되었습니다'); } catch(e){}
    // 스레드로 스크롤
    const cont = document.getElementById('jobThreadContainer');
    if (cont && cont.scrollIntoView) cont.scrollIntoView({ behavior:'smooth', block:'start' });
  };
  window._asReceiptClear = function() {
    ['asDueDate','asDueTime','asRequest'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['asTargetVAN','asTargetPOS','asTargetKIO','asTargetETC'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
  };

  // 신규 진행 중 업무의 스레드로 점프 — newJobModal 닫고 editNewopen 열어 새 요청 접수 폼 자동 펼침
  window._jumpToJobThread = function(jobId, openNewRoot) {
    if (!jobId) return;
    try { closeModal('newJobModal'); } catch(e){}
    // 잔존 body 모드 클래스 정리 — 이전 newJobModal 컨텍스트의 영향 차단
    try { document.body.classList.remove('new-mode','as-mode','consult-mode','supplies-mode'); } catch(e){}
    setTimeout(() => {
      try { editNewopen(jobId); } catch(e){}
      if (openNewRoot) {
        setTimeout(() => {
          try {
            const containerId = 'jobThreadContainerEdit-' + jobId;
            const openKey = '_threadOpen_' + jobId;
            window[openKey] = window[openKey] || {};
            window[openKey]['__newroot__'] = true;
            if (typeof window._renderThreadGroups === 'function') {
              const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
              const jx = jobs.find(x => x.id === jobId);
              window._renderThreadGroups(containerId, (jx && jx.thread) || [], { editable:true, jobId:jobId, draftMode:false });
            }
            // 스레드 영역으로 스크롤
            const el = document.getElementById(containerId);
            if (el && el.scrollIntoView) el.scrollIntoView({ behavior:'smooth', block:'start' });
          } catch(e){ console.warn('[jumpToThread] 펼침 실패', e); }
        }, 220);
      }
    }, 140);
  };

  window._toggleSimBanner = function() {
    const list = document.getElementById('jobSimList');
    const btn = document.getElementById('jobSimToggle');
    if (!list || !btn) return;
    const shown = list.style.display !== 'none';
    list.style.display = shown ? 'none' : 'flex';
    btn.innerHTML = shown ? '펼쳐보기 ▼' : '접기 ▲';
  };

  /* ─── AS 폼 투입 장비 — 팝업 기반 추가 ─── */
  // 작업 등록 폼이 열린 동안의 투입 장비 임시 저장
  window._asEquipDraft = [];

  function _renderAsEquipList() {
    const list = document.getElementById('asEquipList');
    const empty = document.getElementById('asEquipEmpty');
    const cnt = document.getElementById('asEquipCount');
    if (!list) return;
    const items = window._asEquipDraft || [];
    if (cnt) cnt.textContent = items.length ? '(' + items.length + '건)' : '';
    if (items.length === 0) {
      list.style.display = 'none';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.style.display = 'flex';
    const escFn = (typeof esc === 'function') ? esc : (s)=>String(s||'');
    list.innerHTML = items.map((e, idx) => {
      const optsTxt = e.options && Object.keys(e.options).length
        ? Object.entries(e.options).map(([k,v]) => `${k}: ${v}`).join(' · ')
        : '';
      const cond = e.condition === 'used' ? '<span style="background:#FEE2E2;color:#991B1B;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;font-weight:700">중고</span>' : '<span style="background:#DBEAFE;color:#1E40AF;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;font-weight:700">신품</span>';
      return `<div style="background:#fff;border:1px solid var(--gray-200);border-left:3px solid var(--primary);border-radius:7px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:12.5px;color:var(--gray-900)">
            ${escFn(e.name||'-')} × ${e.qty||1}
            ${cond}
            ${e.category ? `<span style="background:#F3F4F6;color:var(--gray-600);font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px;font-weight:700">${escFn(e.category)}</span>` : ''}
          </div>
          ${e.serialNo ? `<div style="font-size:10.5px;color:var(--gray-500);margin-top:2px">S/N: ${escFn(e.serialNo)}</div>` : ''}
          ${optsTxt ? `<div style="font-size:10.5px;color:var(--gray-500);margin-top:2px">${escFn(optsTxt)}</div>` : ''}
          ${e.installedAt ? `<div style="font-size:10.5px;color:var(--gray-500);margin-top:2px">설치 ${escFn(e.installedAt)}${e.installedBy?' · '+escFn(e.installedBy):''}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button type="button" onclick="_asEquipEdit(${idx})" style="background:none;border:1px solid var(--gray-300);border-radius:5px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit">✎</button>
          <button type="button" onclick="_asEquipRemove(${idx})" style="background:none;border:1px solid #fca5a5;color:var(--danger);border-radius:5px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:inherit">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  // AS 장비 추가 — 팝업 형태 (storeEquipEditorModal 재사용)
  window.openAsEquipAdd = function(editIdx) {
    const modal = (typeof _ensureStoreEquipModal === 'function') ? _ensureStoreEquipModal() : null;
    if (!modal) { alert('장비 입력 모달을 불러올 수 없습니다'); return; }
    const isEdit = typeof editIdx === 'number';
    const current = isEdit ? (window._asEquipDraft[editIdx] || {}) : {};
    document.getElementById('seemTitle').textContent = isEdit ? '🔧 AS 투입 장비 — 수정' : '🔧 AS 투입 장비 — 추가';
    document.getElementById('seemBody').innerHTML = _renderEquipFormFields('seem_as', current);
    document.getElementById('seemFooterLeft').innerHTML = '';
    const saveBtn = document.getElementById('seemSaveBtn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const data = _collectEquipForm('seem_as');
        if (!data.name) { alert('장비명을 입력하세요'); return; }
        if (!window._asEquipDraft) window._asEquipDraft = [];
        if (isEdit) window._asEquipDraft[editIdx] = data;
        else window._asEquipDraft.push(data);
        modal.classList.remove('show');
        _renderAsEquipList();
      };
    }
    modal.classList.add('show');
  };
  window._asEquipEdit = (idx) => window.openAsEquipAdd(idx);
  window._asEquipRemove = (idx) => {
    if (!confirm('이 장비를 목록에서 제거하시겠습니까?')) return;
    if (!window._asEquipDraft) return;
    window._asEquipDraft.splice(idx, 1);
    _renderAsEquipList();
  };
  window._renderAsEquipList = _renderAsEquipList;

  // 사용자가 다시 타이핑하면 선택 표시 숨김
  function _resetStorePickInfo() {
    const info = document.getElementById('jobStorePickedInfo');
    if (info) info.style.display = 'none';
  }
  window._resetStorePickInfo = _resetStorePickInfo;

  /* 담당 엔지니어 select: 등록된 직원만 표시 */
  function populateEngineerSelect() {
    const sel = document.getElementById('jobEngineer');
    if (!sel) return;
    const prev = sel.value;
    const users = (typeof getUsers === 'function' ? getUsers() : []) || [];
    const allowed = (typeof getAllowedEmails === 'function' ? getAllowedEmails() : []) || [];
    const admins = (typeof ADMIN_EMAILS !== 'undefined' ? ADMIN_EMAILS : []);
    // 이메일 기준 유니크 병합
    const seen = new Set();
    const items = [];
    users.forEach(u => {
      const e = (u.id || u.email || '').toLowerCase();
      if (!e || seen.has(e)) return;
      seen.add(e);
      items.push({ email: e, name: u.name || e, role: u.role || 'staff' });
    });
    [...admins, ...allowed].forEach(email => {
      const e = (email || '').toLowerCase();
      if (!e || seen.has(e)) return;
      seen.add(e);
      items.push({ email: e, name: e.split('@')[0], role: admins.includes(e) ? 'admin' : 'staff' });
    });
    let html = '<option value="">담당자 선택...</option>';
    if (items.length === 0) {
      html += '<option value="" disabled>등록된 직원 없음 — 관리자에서 이메일 추가</option>';
    } else {
      html += items.map(it => `<option value="${esc(it.name)}">${esc(it.name)}${it.role==='admin'?' (관리자)':''} — ${esc(it.email)}</option>`).join('');
    }
    sel.innerHTML = html;
    if (prev) sel.value = prev;
  }

  /* ══════════════════════════════════════════════
     새 작업/점포 DOM 주입 + 목록 하이드레이션
  ══════════════════════════════════════════════ */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function buildJobCardEl(job) {
    const typeIcon = { '신규':'🏪','POS교체':'🔄','VAN교체':'💳','AS':'🔧','기타':'📋' }[job.type] || '📋';
    const isJobDone = _isJobDone(job);
    const card = document.createElement('div');
    card.className = 'job-card';
    card.setAttribute('data-jobtype', job.type || '기타');
    card.dataset.jobId = job.id;
    card.style.cursor = 'pointer';
    card.style.position = 'relative';
    card.title = '클릭하여 상세 보기';
    card.onclick = () => { try { window.editNewopen && window.editNewopen(job.id); } catch(e){} };

    const badgeCls = isJobDone ? 'badge-green' : 'badge-blue';
    const closeBtn = isJobDone
      ? `<button class="btn btn-outline btn-sm" style="font-size:11px;padding:5px 10px;color:var(--gray-700);border-color:var(--gray-300);font-weight:700" onclick="event.stopPropagation();reopenNewopen('${job.id}')">↩ 되돌리기</button>`
      : `<button class="btn btn-primary btn-sm" style="background:var(--success);color:#fff;font-size:11px;padding:5px 10px;font-weight:700" onclick="event.stopPropagation();completeNewopen('${job.id}')">✓ 종료</button>`;

    card.innerHTML = `
      <div class="job-card-header">
        <div>
          <div class="job-type" style="color:var(--primary)">${typeIcon} ${esc(job.type||'기타')}</div>
          <div class="job-store">${esc(job.storeName||job.store||'-')}</div>
          <div class="job-addr">${esc(job.address||'')}</div>
        </div>
        <span class="badge ${badgeCls}"><span class="badge-dot"></span>${esc(job.status||'진행중')}</span>
      </div>
      <div style="font-size:12.5px;color:var(--gray-600);margin-top:8px;line-height:1.55">${esc(job.notes||'메모 없음')}</div>
      <div class="job-meta">
        <div class="job-meta-item"><div class="job-meta-label">작업일</div><div class="job-meta-value">${esc(job.date||'-')}</div></div>
        <div class="job-meta-item"><div class="job-meta-label">담당</div><div class="job-meta-value">${esc(job.engineer||'미배정')}</div></div>
        <div class="job-meta-item"><div class="job-meta-label">등록</div><div class="job-meta-value">${esc((job.createdAt? new Date(job.createdAt).toLocaleDateString('ko-KR'):'방금'))}</div></div>
        <div class="job-meta-item"><div class="job-meta-label">ID</div><div class="job-meta-value" style="font-size:10px">${esc(job.id)}</div></div>
      </div>
      <div style="margin-top:10px;display:flex;justify-content:flex-end">${closeBtn}</div>
    `;
    return card;
  }

  function injectJobCard(job) {
    const isAs = /AS/i.test(job.type || '');
    const grid = document.getElementById(isAs ? 'jobsAsGrid' : 'jobsGrid');
    if (!grid) return;
    const addBtn = document.getElementById(isAs ? 'newAsCardBtn' : 'newJobCardBtn');
    const card = buildJobCardEl(job);
    if (addBtn) grid.insertBefore(card, addBtn); else grid.appendChild(card);
  }

  function hydrateSavedJobs() {
    try {
      const jobs = (typeof getJobs === 'function') ? getJobs() : [];
      const openGrid = document.getElementById('jobsGrid');
      const asGrid   = document.getElementById('jobsAsGrid');
      if (!openGrid && !asGrid) return;
      // 최신 등록이 위로 오도록 역순으로 prepend
      jobs.slice().reverse().forEach(j => injectJobCard(j));
      // 카운트 라벨 갱신
      const openCount = jobs.filter(j => !/AS/i.test(j.type||'')).length;
      const asCount   = jobs.filter(j =>  /AS/i.test(j.type||'')).length;
      const lblOpen = document.getElementById('jobsOpenCount');
      const lblAs   = document.getElementById('jobsAsCount');
      if (lblOpen) lblOpen.textContent = openCount ? `${openCount}건` : '등록된 작업 없음';
      if (lblAs)   lblAs.textContent   = asCount   ? `${asCount}건`   : 'AS 접수 없음';
    } catch {}
  }

  function buildStoreRowEl(store) {
    const tr = document.createElement('tr');
    tr.dataset.storeId = store.id;
    tr.setAttribute('onclick','toggleStoreDetail(this)');
    const aliases = Array.isArray(store.aliases) ? store.aliases.filter(Boolean) : [];
    const aliasBadge = aliases.length
      ? `<div style="font-size:10px;color:var(--gray-500);margin-top:2px" title="이전 상호: ${esc(aliases.join(', '))}">↳ (구) ${esc(aliases[0])}${aliases.length>1?` 외 ${aliases.length-1}건`:''}</div>`
      : '';
    // 🪧 매장간판명 — 상호 옆에 파란색 강조 표시 (혼선 방지)
    const sigBadge = store.signageName
      ? `<div style="font-size:11px;color:#1d4ed8;font-weight:600;margin-top:2px">🪧 ${esc(store.signageName)}</div>`
      : '';
    // 매장 등록일 표시: 명시적 storeRegDate / ecountRegDate 만 표시
    // (createdAt 은 시스템 업로드 시각이라 실제 등록일 아님 → fallback 안 함)
    const regDateDisplay = store.storeRegDate || store.ecountRegDate || '';
    tr.innerHTML = `
      <td style="font-family:monospace;font-size:11px;color:${regDateDisplay?'var(--gray-700)':'var(--gray-300)'};white-space:nowrap" title="${regDateDisplay?'':'매장 등록일 미설정 — 이카운트 일괄 추가 또는 매장 상세에서 입력 가능'}">${esc(regDateDisplay || '—')}</td>
      <td><b>${esc(store.name)}</b>${sigBadge}${aliasBadge}</td>
      <td style="font-family:monospace;font-size:11px">${esc(store.biz||'-')}</td>
      <td>${esc(store.ceo||'-')}</td>
      <td style="font-size:11px;color:var(--gray-500)">${esc(store.tel||'-')}</td>
      <td style="font-size:11px;color:var(--gray-500)">${esc(store.addr||'-')}</td>
      <td>${store.van ? `<span class="badge badge-purple">${esc(store.van)}</span>` : '-'}</td>
      <td>
        <div class="pos-kiosk-badge">
          <span class="pk-chip" style="background:#DBEAFE;color:#1D4ED8">POS ${esc(store.pos||0)}</span>
        </div>
      </td>
      <td style="font-size:11px">-</td>
      <td><span class="badge badge-green">${esc(store.status||'거래중')}</span></td>
    `;
    return tr;
  }

  function injectStoreRow(store) {
    const tb = document.getElementById('storeListTbody');
    if (!tb) return;
    tb.insertBefore(buildStoreRowEl(store), tb.firstChild);
  }

  /* 정렬 상태 — null 이면 등록순(createdAt 내림차순), 그 외엔 {key, dir:'asc'|'desc'} */
  let _storeSort = null;

  function _storeFieldVal(s, key) {
    if (key === 'biz')  return String(s.biz || s.bizno || '');
    if (key === 'ceo')  return String(s.ceo || s.owner || '');
    if (key === 'addr') return String(s.addr || s.address || '');
    if (key === 'name') return String(s.name || '');
    if (key === 'van')  return String(s.van || '');
    if (key === 'regdate') {
      // 명시적 등록일만 사용 (createdAt fallback 안 함)
      return s.storeRegDate || s.ecountRegDate || '';
    }
    return '';
  }
  function _sortedStores(stores) {
    if (!_storeSort) {
      // 기본 정렬: 매장 등록일 내림차순 (최신 → 과거)
      // 등록일 없는 매장은 항상 맨 뒤로
      const dateOf = (s) => {
        const dr = s.storeRegDate || s.ecountRegDate;
        if (!dr) return -1;   // 없으면 음수 → 뒤로 배치
        const t = new Date(dr + 'T00:00:00').getTime();
        return isNaN(t) ? -1 : t;
      };
      return [...stores].sort((a,b) => dateOf(b) - dateOf(a));
    }
    const { key, dir } = _storeSort;
    const cmp = (a, b) => {
      if (key === 'regdate') {
        // 매장 등록일은 빈 값을 항상 뒤로
        const va = _storeFieldVal(a, key);
        const vb = _storeFieldVal(b, key);
        if (!va && !vb) return 0;
        if (!va) return 1;
        if (!vb) return -1;
        return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const va = _storeFieldVal(a, key);
      const vb = _storeFieldVal(b, key);
      const r = va.localeCompare(vb, 'ko');
      return dir === 'asc' ? r : -r;
    };
    return [...stores].sort(cmp);
  }
  function _updateSortIndicators() {
    document.querySelectorAll('.sort-ind').forEach(el => {
      const k = el.dataset.for;
      if (_storeSort && _storeSort.key === k) {
        el.textContent = _storeSort.dir === 'asc' ? '↑' : '↓';
        el.style.color = 'var(--primary)';
      } else {
        el.textContent = '↕';
        el.style.color = 'var(--gray-300)';
      }
    });
  }

  function setStoreSort(key) {
    if (_storeSort && _storeSort.key === key) {
      // 같은 컬럼 재클릭 → asc → desc → 등록순(해제) 순환
      if (_storeSort.dir === 'asc')      _storeSort = { key, dir: 'desc' };
      else                                _storeSort = null;
    } else {
      _storeSort = { key, dir: 'asc' };
    }
    _updateSortIndicators();
    try { hydrateSavedStores(); } catch(e){}
  }
  window.setStoreSort = setStoreSort;

  // 헤더 클릭 바인딩 (한 번만)
  (function bindStoreSortHeaders(){
    document.addEventListener('click', (ev) => {
      const th = ev.target.closest('#storeListTable thead th[data-sort]');
      if (!th) return;
      setStoreSort(th.dataset.sort);
    });
  })();

  /* ── 무한 스크롤(점진적 렌더) ──
     200개씩 끊어서 렌더하고, 하단 sentinel 행이 화면에 들어오면 다음 묶음을 이어 붙임.
     기본 목록·검색 결과 모두 공용. */
  const _STORE_PAGE = 200;
  const _storeRender = { rows: [], shown: 0, io: null, footFn: null };

  function _storeRenderNextPage() {
    const tb = document.getElementById('storeListTbody');
    if (!tb) return;
    // 이전 footer/sentinel 제거
    tb.querySelectorAll('tr.__store-foot').forEach(r => r.remove());
    const rows = _storeRender.rows;
    const start = _storeRender.shown;
    const end = Math.min(rows.length, start + _STORE_PAGE);
    for (let i = start; i < end; i++) {
      try { if (typeof buildStoreRowEl === 'function') tb.appendChild(buildStoreRowEl(rows[i])); } catch(e){}
    }
    _storeRender.shown = end;
    // 카운트 행
    const info = document.createElement('tr');
    info.className = '__store-foot';
    try { info.innerHTML = _storeRender.footFn ? _storeRender.footFn(end, rows.length) : ''; } catch(e){}
    tb.appendChild(info);
    // 더 남았으면 sentinel 추가 → IntersectionObserver 로 다음 페이지 트리거
    if (end < rows.length) {
      const sentinel = document.createElement('tr');
      sentinel.className = '__store-foot';
      sentinel.innerHTML = '<td colspan="10" style="height:1px;padding:0;border:0"></td>';
      tb.appendChild(sentinel);
      if (_storeRender.io) { try { _storeRender.io.disconnect(); } catch(e){} }
      _storeRender.io = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting)) _storeRenderNextPage();
      }, { rootMargin: '400px' });
      _storeRender.io.observe(sentinel);
    } else if (_storeRender.io) {
      try { _storeRender.io.disconnect(); } catch(e){}
      _storeRender.io = null;
    }
    try { _updateSortIndicators(); } catch(e){}
  }

  function _storeRenderList(sortedRows, footFn) {
    const tb = document.getElementById('storeListTbody');
    if (!tb) return;
    if (_storeRender.io) { try { _storeRender.io.disconnect(); } catch(e){} _storeRender.io = null; }
    _storeRender.rows = sortedRows || [];
    _storeRender.shown = 0;
    _storeRender.footFn = footFn;
    tb.innerHTML = '';
    _storeRenderNextPage();
  }

  function hydrateSavedStores() {
    try {
      const stores = (typeof getStores === 'function') ? getStores() : [];
      const tb = document.getElementById('storeListTbody');
      if (!tb) return;
      // 🔍 검색 중이면 기본 목록으로 덮어쓰지 않고 현재 검색 결과를 유지
      //  (30초 라이브 동기화 / 탭 포커스 시 재렌더가 조회 결과를 지우던 버그 fix)
      try {
        const _si = document.getElementById('storeSearchInput');
        const _q = (_si && _si.value || '').trim();
        // ⚠ 정규화 결과가 실제로 비어있지 않을 때만 재적용.
        //  "주식회사"·"(주)" 등은 정규화 시 빈 문자열이 되는데, 이때 재적용하면
        //  applyStoreFilter → hydrateSavedStores → applyStoreFilter 무한 재귀로 브라우저가 멈춤.
        const _qNorm = (typeof _normalizeSearch === 'function') ? _normalizeSearch(_q) : _q;
        if (_q.length >= 2 && _qNorm && typeof applyStoreFilter === 'function') {
          applyStoreFilter(_q, { toast: false });
          return;
        }
      } catch(e){}
      // 상단 카운트 라벨 갱신
      try {
        const lbl = document.getElementById('storeListCountLabel');
        if (lbl) lbl.innerHTML = `전체 <b style="color:var(--primary)">${(stores.length||0).toLocaleString()}</b>개 점포`;
      } catch(e){}
      if (stores.length > 0) {
        const sorted = _sortedStores(stores);
        const sortLabel = _storeSort
          ? ` · 정렬: ${({name:'점포명',biz:'사업자번호',ceo:'대표자',addr:'주소',van:'VAN사',regdate:'매장 등록일'})[_storeSort.key]} ${_storeSort.dir==='asc'?'오름차순↑':'내림차순↓'}`
          : ' · 정렬: 매장 등록일 최신순';
        _storeRenderList(sorted, (shown, total) =>
          `<td colspan="10" style="text-align:center;padding:10px;font-size:11px;background:#F9FAFB">총 ${total.toLocaleString()}개 점포 · ${shown.toLocaleString()}개 표시${shown < total ? ' · 스크롤 시 더 보기' : ''}${sortLabel}</td>`);
      } else {
        tb.innerHTML = `<tr id="storeListEmptyRow">
          <td colspan="10" style="text-align:center;padding:40px 20px;color:var(--gray-400);font-size:13px">
            <div style="font-size:36px;margin-bottom:10px">🏪</div>
            <div style="font-weight:700;color:var(--gray-500);margin-bottom:4px">등록된 점포가 없습니다</div>
            <div style="font-size:11px">상단 "엑셀 일괄 업로드"로 점포를 등록하세요.</div>
          </td>
        </tr>`;
      }
    } catch(e) { console.warn('hydrateSavedStores error', e); }
  }
  window.hydrateSavedStores = hydrateSavedStores;
  window.renderStores = hydrateSavedStores;

  /* 대시보드: 오늘 일정 / 최근 완료 / AS 미처리를 ns_jobs로 동적 렌더 */
  function hydrateDashboardJobs() {
    let jobs = [];
    try { jobs = (typeof getJobs === 'function') ? (getJobs() || []) : []; } catch(e) {}
    try { if (typeof refreshLinePendingBanner === 'function') refreshLinePendingBanner(); } catch(e) {}
    try { if (typeof checkHaikuMigrationBanner === 'function') checkHaikuMigrationBanner(); } catch(e) {}
    try { if (typeof loadNotices === 'function') loadNotices(); } catch(e) {}
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    const ym = todayStr.slice(0,7); // YYYY-MM

    /* ── 상단 통계 카드 ── */
    //  _isJobEffectivelyDone 사용 — thread ROOT 전체 완료 시 status 무관 done 처리
    //  (옛 AS 데이터의 stale status 가 카운트에 잡히던 버그 fix)
    const isDone = window._isJobEffectivelyDone || _isJobDone;
    // 이번달 신규 = 신규 카테고리 중 openDate 이번달 + 진행 중 (effectively-done 제외)
    //   hub(renderNewHub) 의 progress 필터와 일치하도록 정합 — 완료된 건은 별도 카운트
    //   classifyJobCategory 우선 사용 — type 문자열만으로는 '신규/VAN변경' 등도 잡혀 오분류
    const _classifyJob = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : null;
    const isNewCat = (j) => {
      if (_classifyJob) return _classifyJob(j) === 'new';
      return /신규|개업|오픈/.test(j.type||'');
    };
    const newAllThisMonth = jobs.filter(j => isNewCat(j) && (j.openDate||'').slice(0,7) === ym);
    const newOpenThisMonth = newAllThisMonth.filter(j => !isDone(j)).length;
    const newDoneThisMonth = newAllThisMonth.length - newOpenThisMonth;
    const inProgress = jobs.filter(j => !isDone(j)).length;
    // AS 카운트 — CLAUDE.md 규칙: type 텍스트 regex 금지, classifyJobCategory 사용 (AS hub 와 동일 기준)
    const isAsCat = (j) => _classifyJob ? _classifyJob(j) === 'as' : /as|에이에스/i.test(j.type||'');
    const asCount = jobs.filter(j => isAsCat(j) && !isDone(j)).length;
    const asOver48 = jobs.filter(j => {
      if (!isAsCat(j) || isDone(j)) return false;
      const ts = j.createdAt ? new Date(j.createdAt).getTime() : 0;
      return ts && (Date.now() - ts) > 48*3600*1000;
    }).length;
    // 오늘 예정 = 설치/가오픈/오픈 중 오늘인 미완료 작업
    const todoneToday = jobs.filter(j => {
      if (isDone(j)) return false;
      return [j.installDate, j.softOpenDate, j.openDate].some(d => (d||'').slice(0,10) === todayStr);
    }).length;

    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setText('statNewOpen', newOpenThisMonth);
    setText('statNewOpenSub',
      newOpenThisMonth === 0
        ? (newDoneThisMonth > 0 ? `완료 ${newDoneThisMonth}건` : '이번달 신규 없음')
        : `진행 ${newOpenThisMonth}건${newDoneThisMonth > 0 ? ` · 완료 ${newDoneThisMonth}건` : ''}`);
    setText('statInProgress', inProgress);
    setText('statInProgressSub', inProgress === 0 ? '등록된 작업 없음' : '오늘 예정 ' + todoneToday + '건');
    setText('statAsCount', asCount);
    setText('statAsCountSub', asCount === 0 ? '접수 내역 없음' : (asOver48 > 0 ? `48시간 초과 ${asOver48}건 ⚠️` : '정상 처리 중'));
    setText('statStockLow', 0);
    setText('statStockLowSub', '데이터 없음');

    // 신규/상담 현황 요약 (AI 분석 패널 자리)
    try { renderNeoSummary(); } catch(e){}

    // 오늘 일정 — 설치예정일/가오픈일/오픈일 중 오늘인 작업
    const todayBody = document.getElementById('dashTodayBody');
    if (todayBody) {
      const todayLabels = { installDate:'🔧 설치 예정', softOpenDate:'🌅 가오픈', openDate:'🎉 오픈' };
      const todays = [];
      jobs.forEach(j => {
        if (_isJobDone(j)) return;
        ['installDate','softOpenDate','openDate'].forEach(field => {
          if ((j[field] || '').slice(0,10) === todayStr) {
            todays.push({ ...j, _kind: field });
          }
        });
      });
      const _todaySig = 'today|' + JSON.stringify(todays.map(j=>[j.id,j._kind,j.status||'',j.store||j.storeName||'',j.engineer||j.assignee||'']));
      if (window._sigSkip && window._sigSkip(todayBody, _todaySig)) { /* 내용 동일 → 재구축 skip (어른거림 방지) */ }
      else if (todays.length > 0) {
        todayBody.innerHTML = todays.map(j => {
          const store = j.store || j.storeName || '-';
          const type = j.type || '작업';
          const eng = j.engineer || j.assignee || '미배정';
          const kindLbl = todayLabels[j._kind] || '';
          return `<div class="sched-row" style="padding:12px 18px;border-bottom:1px solid var(--gray-100);display:flex;gap:14px;align-items:flex-start;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background=''" onclick="window.editNewopen && window.editNewopen('${j.id}')" title="클릭 — 매장 상세 보기">
            <div style="font-size:12px;font-weight:700;color:var(--primary);width:75px;flex-shrink:0;padding-top:2px">${kindLbl}</div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:700;margin-bottom:3px">${esc(store)} — ${esc(type)}</div>
              <div style="font-size:12px;color:var(--gray-400)">담당: ${esc(eng)}</div>
            </div>
            <span class="badge badge-blue">${esc(j.status||'예정')}</span>
          </div>`;
        }).join('');
      } else {
        // 항상 빈 상태로 교체 (데모 잔존 방지)
        const msg = jobs.length === 0
          ? '등록된 일정이 없습니다.'
          : '오늘 예정된 일정이 없습니다.';
        todayBody.innerHTML = `<div style="padding:30px 20px;text-align:center;color:var(--gray-400);font-size:12px">
          <div style="font-size:28px;margin-bottom:8px">📭</div>
          <div>${msg}</div>
          <div style="margin-top:4px;font-size:11px">"+ 작업 등록"으로 추가하세요.</div>
        </div>`;
      }
    }

    // 최근 완료 작업 (jobs에서 status=완료, 최신 5건)
    const recentBody = document.getElementById('dashRecentBody');
    if (recentBody) {
      const done = jobs.filter(_isJobDone)
                       .sort((a,b)=> new Date(b.completedAt||b.date||b.createdAt||0) - new Date(a.completedAt||a.date||a.createdAt||0))
                       .slice(0, 5);
      const _recentSig = 'recent|' + JSON.stringify(done.map(j=>[j.id,j.status||'',j.completedAt||'',j.store||j.storeName||'',j.type||'',j.engineer||j.assignee||'']));
      if (window._sigSkip && window._sigSkip(recentBody, _recentSig)) { /* 내용 동일 → skip (어른거림 방지) */ }
      else if (done.length > 0) {
        recentBody.innerHTML = done.map(j => `
          <tr style="cursor:pointer" onclick="window.editNewopen && window.editNewopen('${j.id}')" title="클릭 — 매장 상세 보기">
            <td><b>${esc(j.store || j.storeName || '-')}</b></td>
            <td><span class="badge badge-blue">${esc(j.type || '작업')}</span></td>
            <td style="color:var(--gray-400)">${esc(jobDateStr(j).slice(5,10).replace('-','.') || '—')}</td>
            <td>${esc(j.engineer || j.assignee || '-')}</td>
          </tr>`).join('');
      } else {
        recentBody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px">완료된 작업이 없습니다.</td></tr>`;
      }
    }

    // AS 미처리 — _isJobEffectivelyDone 사용: thread ROOT 전체 완료 시 status 무관 제외
    //   (옛날 데이터의 stale status='접수' 인데 thread 는 다 끝난 경우도 정확히 걸러냄)
    const asBody = document.getElementById('dashAsBody');
    if (asBody) {
      const effectivelyDone = window._isJobEffectivelyDone || _isJobDone;
      const asJobs = jobs.filter(j => {
        // AS 판정을 classifyJobCategory 로 통일 (type 정규식 X) — AS관리탭·모바일과 동일 집합
        const cls = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
        if (cls !== 'as') return false;
        if (effectivelyDone(j)) return false;
        // 🛡 ghost 차단 — thread 모두 삭제된 (tombstone 된) AS 는 대시보드에서 숨김 (2026-05-22)
        try {
          const roots = (Array.isArray(j.thread) ? j.thread : []).filter(e => e && e.parentId == null);
          if (roots.length === 0) {
            const list = (typeof _getTombstones === 'function') ? _getTombstones() : [];
            const hadTomb = list.some(tn => tn && (tn.type === 'thread' || tn.type === 'thread-children' || tn.type === 'job') && tn.jobId === j.id);
            const isJobTomb = (typeof _isJobTombstoned === 'function') && _isJobTombstoned(j.id);
            if (hadTomb || isJobTomb) return false;
          }
        } catch(_){}
        return true;
      });
      const _dasAsSig = 'das-as|' + JSON.stringify(asJobs.map(j=>[j.id,j.status||'',j.updatedAt||0,(Array.isArray(j.thread)?j.thread.length:0),j.store||j.storeName||'']));
      if (window._sigSkip && window._sigSkip(asBody, _dasAsSig)) { /* 내용 동일 → skip (어른거림 방지) */ }
      else if (asJobs.length === 0) {
        asBody.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--gray-400);font-size:12px">미처리 AS가 없습니다.</div>`;
      } else {
        asBody.innerHTML = asJobs.map(j => {
          const recv = jobDateStr(j).slice(5,10).replace('-','.') || '미정';
          const hours = j.createdAt ? Math.round((Date.now() - new Date(j.createdAt).getTime())/3600000) : 0;
          const elapsedTxt = hours >= 72 ? `<span style="color:var(--danger);font-weight:700">${hours}시간 경과</span>`
                            : hours >= 48 ? `<span style="color:var(--warning);font-weight:700">${hours}시간 경과</span>`
                            : `${hours}시간 경과`;
          const content = j.asRequest || j.note || j.lineParsed || j.lineRequest || j.lineRaw || j.description || '-';
          const storeName = j.store || j.storeName || '-';
          return `<div style="cursor:pointer;border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;background:#fff;transition:all 0.15s"
                       onmouseenter="this.style.background='var(--gray-50)';this.style.borderColor='var(--primary)'"
                       onmouseleave="this.style.background='#fff';this.style.borderColor='var(--gray-200)'"
                       onclick="window.editNewopen && window.editNewopen('${j.id}')"
                       title="클릭 — 매장 상세 보기">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
              <b style="font-size:14px;color:var(--gray-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(storeName)}</b>
              <span class="badge badge-amber" style="flex-shrink:0">${esc(j.status || '접수')}</span>
            </div>
            <div style="font-size:12px;color:var(--gray-600);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(content)}">${esc(content)}</div>
            <div style="display:flex;gap:8px;font-size:11px;color:var(--gray-400);flex-wrap:wrap">
              <span>📅 ${esc(recv)}</span>
              <span>⏱ ${elapsedTxt}</span>
              <span>👤 ${esc(j.engineer || j.assignee || '미배정')}</span>
            </div>
          </div>`;
        }).join('');
      }
    }
  }
  window.hydrateDashboardJobs = hydrateDashboardJobs;

  /* 대시보드 통계 카드 클릭 — 작업 목록 모달 */
  function showDashList(kind) {
    const titleEl = document.getElementById('dashListTitle');
    const bodyEl = document.getElementById('dashListBody');
    if (!titleEl || !bodyEl) return;
    let jobs = [];
    try { jobs = (typeof getJobs === 'function') ? (getJobs() || []) : []; } catch(e){}
    const today = new Date();
    const ym = today.toISOString().slice(0,7);
    const isDone = window._isJobEffectivelyDone || _isJobDone;
    const _classifyJob2 = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : null;
    const isNewCat2 = (j) => _classifyJob2 ? _classifyJob2(j) === 'new' : /신규|개업|오픈/.test(j.type||'');

    let title = '목록';
    let list = [];
    let emptyMsg = '데이터가 없습니다.';

    if (kind === 'newOpen') {
      title = `🏪 이번달 신규 (${ym}) — 진행 중`;
      list = jobs.filter(j => isNewCat2(j) && (j.openDate||'').slice(0,7) === ym && !isDone(j))
                 .sort((a,b) => (a.openDate||'').localeCompare(b.openDate||''));
      emptyMsg = '이번달 신규 작업이 없습니다.';
    } else if (kind === 'inProgress') {
      title = '⚙️ 진행중 작업';
      list = jobs.filter(j => !isDone(j))
                 .sort((a,b) => {
                   const da = a.installDate || a.softOpenDate || a.openDate || a.date || '';
                   const db = b.installDate || b.softOpenDate || b.openDate || b.date || '';
                   return da.localeCompare(db);
                 });
      emptyMsg = '진행중인 작업이 없습니다.';
    } else if (kind === 'as') {
      title = '🔧 AS 접수';
      list = jobs.filter(j => /as|에이에스/i.test(j.type||'') && !isDone(j))
                 .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
      emptyMsg = '미처리 AS가 없습니다.';
    } else if (kind === 'stockLow') {
      title = '📦 장비 재고 부족';
      // 재고 추적 기능 없음 — 안내
      bodyEl.innerHTML = `<div style="padding:40px 24px;text-align:center;color:var(--gray-400);font-size:13px">
        <div style="font-size:36px;margin-bottom:12px">📦</div>
        <div style="font-weight:600;color:var(--gray-600);margin-bottom:6px">재고 추적 기능 준비중</div>
        <div style="font-size:12px">장비 재고 정보는 향후 업데이트 예정입니다.<br>현재는 장비 카탈로그 관리만 제공됩니다.</div>
        <button class="btn btn-outline btn-sm" style="margin-top:14px" onclick="closeModal('dashListModal');showScreen('equipment')">장비 재고 화면으로 이동</button>
      </div>`;
      titleEl.textContent = title;
      if (typeof showModal === 'function') showModal('dashListModal');
      return;
    }

    titleEl.textContent = `${title} — ${list.length}건`;

    if (list.length === 0) {
      bodyEl.innerHTML = `<div style="padding:40px 24px;text-align:center;color:var(--gray-400);font-size:13px">
        <div style="font-size:36px;margin-bottom:12px">📭</div>
        <div>${emptyMsg}</div>
      </div>`;
    } else {
      const fmtDate = (s) => (s||'').slice(5,10).replace('-','.');
      bodyEl.innerHTML = list.map(j => {
        const store = j.store || j.storeName || '-';
        const type = j.type || '작업';
        const eng = j.engineer || j.assignee || '미배정';
        const status = j.status || '예정';
        const dates = [];
        if (j.installDate) dates.push(`🔧 ${fmtDate(j.installDate)}`);
        if (j.softOpenDate) dates.push(`🌅 ${fmtDate(j.softOpenDate)}`);
        if (j.openDate) dates.push(`🎉 ${fmtDate(j.openDate)}`);
        const dateStr = dates.length ? dates.join(' · ') : (j.date ? fmtDate(j.date) : '일정 미정');
        const memo = j.notes || j.note || j.description || '';
        const unreg = j.unregistered ? '<span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:6px">미등록</span>' : '';
        return `<div onclick="closeModal('dashListModal');window.editNewopen && window.editNewopen('${j.id}')" style="padding:12px 18px;border-bottom:1px solid var(--gray-100);cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background=''" title="클릭 — 매장 상세 보기">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <div style="font-size:14px;font-weight:700;flex:1;min-width:0">${esc(store)}${unreg}</div>
            <span class="badge badge-blue" style="font-size:10px">${esc(type)}</span>
            <span class="badge" style="font-size:10px;background:#F3F4F6;color:var(--gray-600)">${esc(status)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--gray-500)">
            <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(dateStr)} · 담당 ${esc(eng)}</div>
          </div>
          ${memo ? `<div style="font-size:11px;color:var(--gray-400);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(memo)}</div>` : ''}
        </div>`;
      }).join('');
    }

    if (typeof showModal === 'function') showModal('dashListModal');
  }
  window.showDashList = showDashList;

