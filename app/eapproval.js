/* ════════════════════════════════════════════════════════════════
   전자결재 (eApproval) — PC 모듈
   - 데이터: 클라우드 동기화 (/api/eapproval), localStorage 캐시
   - 사용자: 실제 로그인 사용자(_currentAuthName) + ns_users 직원목록
   - LINE: 상신/승인/반려/완료 시 /api/eapproval-notify push
   - 모든 CSS 클래스 eap- 접두사 + #screen-eapproval 스코프 (메인 앱 충돌 차단)
   - 모든 inline 핸들러는 window.EAP.* 네임스페이스 (전역 함수 충돌 차단)
   진입점: window.renderEapprovalScreen()  (showScreen('eapproval') 에서 호출)
════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const EAP = window.EAP = window.EAP || {};

  // ── localStorage 키 ──
  const DOCS_LS = 'ns_eap_docs';
  const DOCS_ETAG = 'ns_eap_docs_etag';
  const CFG_LS = 'ns_eap_cfg';
  const DEL_LS = 'ns_eap_deleted';

  const ADMIN_EMAILS = ['zoolex@gmail.com'];

  // ── UI 상태 ──
  let TAB = 'appr', SUB = 'received', SCHSUB = 'up';
  let _execFrom = '', _execTo = '';
  let _doneTplFilter = 'all';
  // 자금관리 상태
  let FUNDSUB = 'daily', FUNDDATE = '', FUNDCTX = { co: '인토개인', dir: 'in' };
  let _built = false;
  let _pollTimer = null;
  let _listenersBound = false;

  /* ───────────── 공통 헬퍼 ───────────── */
  function esc(s) {
    if (window.esc && window.esc !== esc) { try { return window.esc(s); } catch (_) {} }
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // onclick 인자 안전 직렬화 — 큰따옴표를 &quot; 로 이스케이프해야 onclick="...${J(x)}..." 속성이 깨지지 않음
  const J = (v) => JSON.stringify(v).replace(/"/g, '&quot;');
  function toast(m) { try { if (window.showToast) return window.showToast(m); } catch (_) {} console.log('[eap]', m); }
  function kstDate() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function kstNow() {
    try { if (window._kstDateTimeStr) return window._kstDateTimeStr(); } catch (_) {}
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }
  function todayPlus(n) { return new Date(Date.now() + 9 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10); }
  function won(n) { return (Number(n) || 0).toLocaleString('ko-KR') + '원'; }
  function commaFmt(v) {
    if (v === '' || v == null) return '';
    const num = Number(String(v).replace(/,/g, ''));
    return isNaN(num) ? String(v) : num.toLocaleString('ko-KR');
  }
  function fsize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  }
  function genId(p) { return (p || 'D') + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  /* ───────────── 공휴일 / 근무일 계산 ───────────── */
  // 내장 공휴일(2026 대한민국 — 대체공휴일 포함, 검증 권장). 2027+ 는 /api/holidays(공공데이터포털)·관리자 편집으로 보강.
  const KR_HOLIDAYS_BUILTIN = [
    '2026-01-01', // 신정
    '2026-02-16', '2026-02-17', '2026-02-18', // 설날
    '2026-03-01', '2026-03-02', // 삼일절(일)+대체
    '2026-05-05', // 어린이날
    '2026-05-24', '2026-05-25', // 부처님오신날(일)+대체
    '2026-06-06', // 현충일
    '2026-08-15', '2026-08-17', // 광복절(토)+대체
    '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-28', // 추석+대체
    '2026-10-03', '2026-10-05', // 개천절(토)+대체
    '2026-10-09', // 한글날
    '2026-12-25', // 성탄절
  ];
  function effHolidaySet() {
    const s = new Set(KR_HOLIDAYS_BUILTIN);
    const cfg = getCfg();
    if (Array.isArray(cfg.holidays)) cfg.holidays.forEach(d => d && s.add(d));
    try { JSON.parse(localStorage.getItem('ns_eap_holidays') || '[]').forEach(d => s.add(d)); } catch (_) {}
    if (Array.isArray(cfg.holidayExcludes)) cfg.holidayExcludes.forEach(d => s.delete(d)); // 근무일로 처리(제외)
    return s;
  }
  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // 시작~종료 사이 근무일 수 (토·일 + 공휴일 제외)
  function workingDays(from, to) {
    if (!from) return 0;
    const start = new Date(from + 'T00:00:00'), end = new Date((to || from) + 'T00:00:00');
    if (isNaN(start) || isNaN(end) || end < start) return 0;
    const hol = effHolidaySet(); let n = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay(); if (dow === 0 || dow === 6) continue;
      if (hol.has(isoOf(d))) continue;
      n++;
    }
    return n;
  }
  // 외부(일정조회 캘린더 등)에서 쓰는 공휴일/비근무일 판정 — 'YYYY-MM-DD'
  EAP.isHoliday = function (ymd) { try { return effHolidaySet().has(ymd); } catch (_) { return false; } };
  EAP.isNonWorkingDay = function (ymd) {
    try {
      if (effHolidaySet().has(ymd)) return true;
      const d = new Date(ymd + 'T00:00:00'); const dow = d.getDay();
      return dow === 0 || dow === 6;
    } catch (_) { return false; }
  };
  // 공공데이터포털 등에서 수집된 공휴일을 로컬 캐시에 적재 (effHolidaySet 이 사용)
  async function pullHolidays() {
    try {
      const y = new Date(Date.now() + 9 * 3600 * 1000).getFullYear();
      const all = new Set();
      for (const yr of [y, y + 1]) {
        const r = await fetch('/api/holidays?year=' + yr);
        if (r.ok) { const j = await r.json(); (j.holidays || []).forEach(d => all.add(d)); }
      }
      if (all.size) localStorage.setItem('ns_eap_holidays', JSON.stringify([...all]));
    } catch (_) {}
  }

  /* ───────────── 사용자/권한 ───────────── */
  function getUsers() {
    try { return JSON.parse(localStorage.getItem('ns_users') || '[]'); } catch (_) { return []; }
  }
  function authState() {
    try { return JSON.parse(localStorage.getItem('ns_auth') || 'null'); } catch (_) { return null; }
  }
  function STAFF() {
    const names = getUsers().map(u => u && u.name).filter(Boolean);
    const me = ME();
    if (me && !names.includes(me)) names.unshift(me);
    return [...new Set(names)];
  }
  function ME() {
    try { if (window._currentAuthName) { const n = window._currentAuthName(); if (n) return n; } } catch (_) {}
    const a = authState();
    return (a && (a.name || a.email)) || '';
  }
  function isAdmin() {
    const a = authState();
    if (a && a.role === 'admin') return true;
    if (a && ADMIN_EMAILS.includes((a.id || a.email || '').toLowerCase())) return true;
    return false;
  }
  // 연차 일수(부여/사용) + 결재 루트를 관리할 수 있는 담당자 — 관리자 외 추가 권한
  const MANAGERS = ['이동호', '김혜연'];
  function canEditLeave() { return isAdmin() || MANAGERS.includes(ME()); }
  function canManageRoutes() { return isAdmin() || MANAGERS.includes(ME()); }
  // 생일/기념일 등록 권한 — 관리자 + 지정 사용자
  const BIRTH_EDITORS = ['김혜연'];
  function canEditBirth() { return isAdmin() || BIRTH_EDITORS.includes(ME()); }
  // 자금 집행완료 처리 권한 — 관리자 + 지정 담당자
  const FUND_EXECUTORS = ['김혜연'];
  function canExecFund() { return isAdmin() || FUND_EXECUTORS.includes(ME()); }
  // 자금관리(일일자금현황) 조회·관리 권한 — 지정 4명(+관리자). 그 외 직원은 탭 자체가 안 보임.
  const FUND_MEMBERS = ['정필성', '이동호', '김혜연', '오근례'];
  function canViewFund() { return isAdmin() || FUND_MEMBERS.includes(ME()); }
  function canManageFund() { return canViewFund(); }
  function userTitle(name) {
    const u = getUsers().find(u => u && u.name === name);
    return (u && u.title) || '';
  }

  /* ───────────── 데이터 레이어 (localStorage + cloud) ───────────── */
  function getDocs() {
    try { return JSON.parse(localStorage.getItem(DOCS_LS) || '[]'); } catch (_) { return []; }
  }
  function _writeDocs(arr) {
    try {
      if (window._safeSetItem) window._safeSetItem(DOCS_LS, JSON.stringify(arr));
      else localStorage.setItem(DOCS_LS, JSON.stringify(arr));
    } catch (_) {}
  }
  function setDocs(arr) { _writeDocs(arr); schedulePush(); }
  // 자금 거래(tx) — docs 와 동일한 per-id 머지 파이프라인
  const FUND_LS = 'ns_eap_fund';
  function getFundTx() { try { return JSON.parse(localStorage.getItem(FUND_LS) || '[]'); } catch (_) { return []; } }
  function _writeFundTx(arr) { try { if (window._safeSetItem) window._safeSetItem(FUND_LS, JSON.stringify(arr)); else localStorage.setItem(FUND_LS, JSON.stringify(arr)); } catch (_) {} }
  function setFundTx(arr) { _writeFundTx(arr); schedulePush(); }
  function getCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_LS) || '{}'); } catch (_) { return {}; }
  }
  function setCfg(c) {
    try { localStorage.setItem(CFG_LS, JSON.stringify(c)); } catch (_) {}
    schedulePush(true);
  }
  // config 키별 deep-merge — birth/routes/leave/lineMap 은 하위키 머지(cloud 우선),
  // holidays/holidayExcludes 는 union, tpl 은 id 기준 머지. (PC·서버·모바일 동일 규칙)
  // 자금 마감/해제 — 날짜별 "최근 액션(at) 우선" 머지 (KV stale·다기기·재푸시에도 해제 유지).
  //   신규: {closed,at,by,...} / 해제: {closed:false,at,by} / legacy: {balances,closedAt,by}(=마감).
  function _fundClosingAt(c) {
    if (c == null) return -1;
    if (typeof c === 'object') {
      if ('at' in c && c.at != null) return Number(c.at) || 0;
      if (c.closedAt) { const p = Date.parse(String(c.closedAt).replace(' ', 'T')); return Number.isFinite(p) ? p : 0; }
      return 0;
    }
    return 0;
  }
  function _mergeFundClosings(localC, cloudC) {
    localC = (localC && typeof localC === 'object') ? localC : {};
    cloudC = (cloudC && typeof cloudC === 'object') ? cloudC : {};
    const out = {}; const keys = new Set([...Object.keys(localC), ...Object.keys(cloudC)]);
    keys.forEach(k => {
      const inL = (k in localC), inR = (k in cloudC);
      if (inL && inR) out[k] = (_fundClosingAt(cloudC[k]) >= _fundClosingAt(localC[k])) ? cloudC[k] : localC[k];
      else out[k] = inR ? cloudC[k] : localC[k];
    });
    return out;
  }
  function mergeEapCfg(local, cloud) {
    local = local || {}; cloud = cloud || {};
    const out = Object.assign({}, local);
    for (const k of ['routes', 'birth', 'leave', 'lineMap']) {
      if (cloud[k] && typeof cloud[k] === 'object') out[k] = Object.assign({}, local[k] || {}, cloud[k]);
    }
    for (const k of ['holidays', 'holidayExcludes']) {
      const a = Array.isArray(local[k]) ? local[k] : [], b = Array.isArray(cloud[k]) ? cloud[k] : [];
      if (a.length || b.length) out[k] = [...new Set([...a, ...b])];
    }
    if (Array.isArray(cloud.tpl) && cloud.tpl.length) {
      const byId = new Map((Array.isArray(local.tpl) ? local.tpl : []).map(t => [t.id, t]));
      cloud.tpl.forEach(t => { if (t && t.id) byId.set(t.id, t); });
      out.tpl = [...byId.values()];
    }
    // fund 메타 — cats(전체 교체, 편집 드묾) / opening·closings(키별 머지) / openingDate(최신)
    if (cloud.fund && typeof cloud.fund === 'object') {
      const lf = local.fund || {}, cf = cloud.fund, nf = Object.assign({}, lf);
      if (cf.cats) nf.cats = cf.cats;
      if (cf.opening) nf.opening = Object.assign({}, lf.opening || {}, cf.opening);
      if (cf.openingDate) nf.openingDate = cf.openingDate;
      if (cf.closings) nf.closings = _mergeFundClosings(lf.closings, cf.closings);
      out.fund = nf;
    }
    out.updatedAt = Date.now();
    return out;
  }
  function getDeleted() {
    try { return JSON.parse(localStorage.getItem(DEL_LS) || '[]'); } catch (_) { return []; }
  }
  function addDeleted(id) {
    const d = getDeleted();
    if (!d.includes(id)) { d.push(id); try { localStorage.setItem(DEL_LS, JSON.stringify(d)); } catch (_) {} }
  }

  // config sub-getters
  function getTpls() { const t = getCfg().tpl; return Array.isArray(t) ? t : []; }
  function tplById(id) { return getTpls().find(t => t.id === id); }
  function getRoutes() { const r = getCfg().routes; return (r && typeof r === 'object') ? r : {}; }
  function myRoute(n) { const r = getRoutes()[n || ME()]; return Array.isArray(r) ? r.slice() : []; }
  function getBirths() { const b = getCfg().birth; return (b && typeof b === 'object') ? b : {}; }
  function getLeaveAll() { const l = getCfg().leave; return (l && typeof l === 'object') ? l : {}; }
  function getLeave(name) { const l = getLeaveAll()[name]; return l || { total: 15, used: 0 }; }
  function getLineMap() { const m = getCfg().lineMap; return (m && typeof m === 'object') ? m : {}; }

  function saveCfgKey(key, val) {
    const c = getCfg(); c[key] = val; c.updatedAt = Date.now(); setCfg(c);
  }

  /* ── 클라우드 push (debounce) ── */
  let _pushT = null, _pendingTombs = [];
  function schedulePush(cfgToo) {
    clearTimeout(_pushT);
    _pushT = setTimeout(() => doPush(cfgToo), 1200);
  }
  async function doPush(cfgToo) {
    try {
      const payload = { docs: getDocs(), fund: getFundTx() };
      if (cfgToo) payload.config = getCfg();
      if (_pendingTombs.length) { payload.tombstones = _pendingTombs.slice(); _pendingTombs = []; }
      const res = await fetch('/api/eapproval', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) { try { localStorage.removeItem(DOCS_ETAG); } catch (_) {} }
    } catch (e) { console.warn('[eap] push 실패', e); }
  }
  EAP._pushNow = (cfgToo) => doPush(cfgToo);

  /* ── 클라우드 pull + merge ── */
  let _syncing = false;
  async function syncFromCloud() {
    if (_syncing) return;
    _syncing = true;
    try {
      const etag = localStorage.getItem(DOCS_ETAG) || '';
      const res = await fetch('/api/eapproval', { headers: etag ? { 'If-None-Match': etag } : {} });
      if (res.status === 304) { _syncing = false; return; }
      if (!res.ok) { _syncing = false; return; }
      const newEtag = res.headers.get('ETag'); if (newEtag) localStorage.setItem(DOCS_ETAG, newEtag);
      const data = await res.json();
      const cloudDocs = Array.isArray(data.docs) ? data.docs : [];
      const cloudDel = Array.isArray(data.deleted) ? data.deleted : [];
      // 삭제 레지스트리 병합
      const delSet = new Set([...getDeleted(), ...cloudDel]);
      try { localStorage.setItem(DEL_LS, JSON.stringify([...delSet])); } catch (_) {}
      // docs per-id merge by updatedAt
      const local = getDocs();
      const byId = new Map();
      const mt = d => Number(d && (d.updatedAt || d.createdAt)) || 0;
      for (const d of local) if (d && d.id && !delSet.has(String(d.id))) byId.set(String(d.id), d);
      for (const d of cloudDocs) {
        if (!d || !d.id || delSet.has(String(d.id))) continue;
        const id = String(d.id); const ex = byId.get(id);
        if (!ex || mt(d) >= mt(ex)) byId.set(id, d);
      }
      _writeDocs([...byId.values()]);
      // fund tx per-id merge by updatedAt (docs 미러, 삭제 레지스트리 존중)
      const cloudFund = Array.isArray(data.fund) ? data.fund : [];
      const fById = new Map();
      for (const t of getFundTx()) if (t && t.id && !delSet.has(String(t.id))) fById.set(String(t.id), t);
      for (const t of cloudFund) {
        if (!t || !t.id || delSet.has(String(t.id))) continue;
        const id = String(t.id); const ex = fById.get(id);
        if (!ex || mt(t) >= mt(ex)) fById.set(id, t);
      }
      _writeFundTx([...fById.values()]);
      // config — 키별 deep-merge (cloud 값 채택). updatedAt 비교 폐기(서버 ISO ↔ 클라 숫자 불일치 버그).
      const merged = mergeEapCfg(getCfg(), data.config || {});
      try { localStorage.setItem(CFG_LS, JSON.stringify(merged)); } catch (_) {}
      ensureSeed();
      if (isScreenActive()) renderTab(true);
    } catch (e) { console.warn('[eap] sync 실패', e); }
    _syncing = false;
  }
  EAP._sync = syncFromCloud;

  /* ── 기본 템플릿 seed (cfg.tpl 비었을 때 1회) ── */
  function ensureSeed() {
    const cfg = getCfg();
    if (Array.isArray(cfg.tpl) && cfg.tpl.length) return;
    cfg.tpl = SEED_TPLS();
    cfg.updatedAt = Date.now();
    try { localStorage.setItem(CFG_LS, JSON.stringify(cfg)); } catch (_) {}
    schedulePush(true);
  }
  // 기존 cfg 양식 라벨 마이그레이션 (지출결의서 '작성 일자' → '지급 일자')
  function migrateTpls() {
    const cfg = getCfg(); if (!Array.isArray(cfg.tpl)) return;
    let changed = false;
    cfg.tpl.forEach(t => {
      if (t && t.id === 't-pay' && Array.isArray(t.fields)) {
        t.fields.forEach(f => { if (f && f.label === '작성 일자') { f.label = '지급 일자'; changed = true; } });
        const before = t.fields.length;
        t.fields = t.fields.filter(f => !(f && f.label === '수령 방법'));  // 수령 방법 제거(불필요)
        if (t.fields.length !== before) changed = true;
      }
    });
    // 출장결과보고서 복원 (이식 누락분) — id 없으면 추가
    if (!cfg.tpl.some(t => t && t.id === 't-trip-rep')) {
      const seed = SEED_TPLS().find(t => t.id === 't-trip-rep');
      if (seed) {
        const idx = cfg.tpl.findIndex(t => t && t.id === 't-trip-req');
        if (idx >= 0) cfg.tpl.splice(idx + 1, 0, seed); else cfg.tpl.push(seed);
        changed = true;
      }
    }
    if (changed) { cfg.updatedAt = Date.now(); try { localStorage.setItem(CFG_LS, JSON.stringify(cfg)); } catch (_) {} schedulePush(true); }
  }
  function SEED_TPLS() {
    return [
      { id: 't-basic', name: '일반 기안서', cat: 'gen', fields: [{ label: '제목', type: 'text' }, { label: '내용', type: 'textarea' }] },
      { id: 't-pay', name: '지출결의서', cat: 'pay', fields: [
        { label: '결제 방법', type: 'select', options: '현금,개인카드,법인카드,계좌입금' },
        { label: '사용 부서', type: 'text' }, { label: '은 행 명', type: 'text' },
        { label: '지급 일자', type: 'date' }, { label: '예 금 주', type: 'text' },
        { label: '계좌 번호', type: 'text' }, { label: '금   액', type: 'money' },
        { label: '사용 내역', type: 'textarea' },
      ] },
      { id: 't-buy', name: '구매요청서', cat: 'buy', fields: [
        { label: '품 명', type: 'text' }, { label: '수 량', type: 'number' },
        { label: '예상 금액', type: 'money' }, { label: '희망 납기', type: 'date' },
        { label: '구매 사유', type: 'textarea' },
      ] },
      { id: 't-leave', name: '연차신청서', cat: 'leave', fields: [
        { label: '휴가 종류', type: 'select', options: '연차,반차(오전),반차(오후),병가,경조' },
        { label: '시작일', type: 'date' }, { label: '종료일', type: 'date' },
        { label: '일 수', type: 'number' }, { label: '사 유', type: 'textarea' },
      ] },
      { id: 't-trip-req', name: '출장신청서', cat: 'gen', fields: [
        { label: '소 속', type: 'text' }, { label: '직 위', type: 'text' }, { label: '성 명', type: 'text' },
        { label: '출장 시작', type: 'date' }, { label: '출장 종료', type: 'date' },
        { label: '출장 장소', type: 'text' }, { label: '출장 목적', type: 'textarea' }, { label: '비 고', type: 'textarea' },
      ] },
      { id: 't-trip-rep', name: '출장결과보고서', cat: 'gen', fields: [
        { label: '소 속', type: 'text' }, { label: '직 위', type: 'text' }, { label: '성 명', type: 'text' },
        { label: '출장 시작', type: 'date' }, { label: '출장 종료', type: 'date' },
        { label: '출장 장소', type: 'text' }, { label: '출장 업무내역', type: 'textarea' }, { label: '참고 사항', type: 'textarea' },
      ] },
      { id: 't-holiday', name: '휴일근무일지', cat: 'gen', fields: [
        { label: '근무자', type: 'text' }, { label: '근무일', type: 'date' }, { label: '매 장', type: 'text' },
        { label: '근무 시간', type: 'text' }, { label: '근무 사유', type: 'textarea' }, { label: '비 고', type: 'textarea' },
      ] },
    ];
  }

  const KIND = {
    pay: { label: '💰 지출결의', cls: 'k-pay' },
    buy: { label: '🛒 구매요청', cls: 'k-buy' },
    leave: { label: '🌴 휴가', cls: 'k-leave' },
    gen: { label: '📄 일반', cls: 'k-gen' },
  };
  const FIELD_TYPES = [['text', '한 줄'], ['textarea', '여러 줄'], ['date', '날짜'], ['number', '숫자'], ['money', '금액(원)'], ['select', '선택목록']];

  /* ───────────── 권한 판정 ───────────── */
  function inParty(d) { const me = ME(); return d.drafter === me || (d.line || []).some(s => s.n === me) || (d.cc || []).includes(me); }
  function canView(d) { return isAdmin() || inParty(d); }
  function isMyTurn(d) { return d.status === 'wait' && d.line[d.step] && d.line[d.step].n === ME(); }
  function isCC(d) { const me = ME(); return (d.cc || []).includes(me) && d.drafter !== me && !(d.line || []).some(s => s.n === me); }

  /* ════════════════ 진입점 / 화면 셸 ════════════════ */
  function isScreenActive() {
    const sc = document.getElementById('screen-eapproval');
    return sc && sc.classList.contains('active');
  }

  window.renderEapprovalScreen = function () {
    injectStyle();
    const host = document.getElementById('eapContainer');
    if (!host) return;
    if (!_built) {
      host.innerHTML = shellHtml();
      _built = true;
    }
    ensureSeed();
    migrateTpls();
    bindTabs();
    renderTab();
    // 클라우드 동기화 + 공휴일 수집
    syncFromCloud();
    pullHolidays();
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { if (isScreenActive()) syncFromCloud(); }, 15000);  // 15초 폴링
    // 탭 복귀/포커스 시 즉시 동기화 (새로고침 없이 최신 결재상태 반영)
    if (!_listenersBound) {
      _listenersBound = true;
      document.addEventListener('visibilitychange', () => { if (!document.hidden && isScreenActive()) syncFromCloud(); });
      window.addEventListener('focus', () => { if (isScreenActive()) syncFromCloud(); });
      try { window.addEventListener('storage', e => { if (e && e.key === DOCS_LS && isScreenActive()) renderTab(true); }); } catch (_) {}
    }
    // 딥링크 ?doc=ID (PC 에서도 지원)
    try {
      const id = new URLSearchParams(location.search).get('doc');
      if (id && getDocs().some(d => d.id === id)) setTimeout(() => EAP.openDetail(id), 120);
    } catch (_) {}
  };

  function shellHtml() {
    return `
    <div class="eap-root">
      <div class="eap-tabbar">
        <button class="eap-tab on" data-tab="appr" onclick="EAP.switchTab('appr')">📋 결재함</button>
        <button class="eap-tab" data-tab="leave" onclick="EAP.switchTab('leave')">🌴 연차관리</button>
        <button class="eap-tab eap-fund-only" data-tab="fund" onclick="EAP.switchTab('fund')">💰 자금관리</button>
        <button class="eap-tab" data-tab="sch" onclick="EAP.switchTab('sch')">📅 일정</button>
        <button class="eap-tab eap-mgr-only" data-tab="tpl" onclick="EAP.switchTab('tpl')">⚙️ 양식·루트</button>
      </div>
      <div id="eap-view" class="eap-view"></div>
    </div>
    <div id="eapModalHost"></div>`;
  }

  function bindTabs() {
    const showMgr = isAdmin() || canManageRoutes();
    document.querySelectorAll('#eapContainer .eap-mgr-only').forEach(el => { el.style.display = showMgr ? '' : 'none'; });
    const showFund = canViewFund();
    document.querySelectorAll('#eapContainer .eap-fund-only').forEach(el => { el.style.display = showFund ? '' : 'none'; });
    if (!showMgr && TAB === 'tpl') TAB = 'appr';
    if (!showFund && TAB === 'fund') TAB = 'appr';
    document.querySelectorAll('#eapContainer .eap-tab').forEach(b => b.classList.toggle('on', b.getAttribute('data-tab') === TAB));
  }

  EAP.switchTab = function (t) {
    TAB = t;
    document.querySelectorAll('#eapContainer .eap-tab').forEach(b => b.classList.toggle('on', b.getAttribute('data-tab') === t));
    renderTab();
  };

  function renderTab(fromSync) {
    bindTabs();
    const v = document.getElementById('eap-view');
    if (!v) return;
    if (TAB === 'fund') {
      // 백그라운드(sync) 재렌더는 입력중 draft 를 지우지 않도록 가드
      if (fromSync) {
        if (fundDraftDirty()) return;
        const sig = fundSig();
        if (v.getAttribute('data-fundsig') === sig && v.childElementCount) return;
      }
      v.innerHTML = renderFund();
      v.setAttribute('data-fundsig', fundSig());
      if (FUNDSUB === 'daily') { const tb = document.getElementById('fundSheetBody'); if (tb) { fundRenumber(); EAP.fundSubtotal(); } }
      return;
    }
    if (TAB === 'appr') v.innerHTML = renderAppr();
    else if (TAB === 'leave') v.innerHTML = renderLeave();
    else if (TAB === 'sch') v.innerHTML = renderSch();
    else if (TAB === 'tpl') v.innerHTML = renderTpl();
  }
  EAP.render = renderTab;

  /* ════════════════ 결재함 (appr) ════════════════ */
  function renderAppr() {
    const docs = getDocs();
    const me = ME();
    const cntReceived = docs.filter(isMyTurn).length;
    const execPend = docs.filter(d => d.kind === 'pay' && d.status === 'ok' && d.execStatus !== 'done' && canView(d)).length;
    const subs = [
      ['received', '받은 결재', cntReceived],
      ['mine', '상신함', null],
      ['ref', '참조', null],
      ['exec', '자금집행', execPend],
      ['done', '완료/반려', null],
    ];
    if (isAdmin()) subs.push(['all', '전체', null]);

    let list;
    if (SUB === 'received') list = docs.filter(isMyTurn);
    else if (SUB === 'mine') list = docs.filter(d => d.drafter === me);
    else if (SUB === 'ref') list = docs.filter(d => (d.cc || []).includes(me) && d.drafter !== me && d.status === 'ok');  // 참조자는 결재 '완료' 후에만 열람(진행중 상신건은 숨김)
    else if (SUB === 'exec') list = docs.filter(d => d.kind === 'pay' && d.status === 'ok' && canView(d));
    else if (SUB === 'done') list = docs.filter(d => (d.status === 'ok' || d.status === 'rej') && canView(d));  // 완료·반려만 (진행중/회수 제외 — 재상신 시 자동 제외)
    else list = docs.slice();

    list.sort((a, b) => (Number(b.updatedAt || b.createdAt) || 0) - (Number(a.updatedAt || a.createdAt) || 0));

    const chips = subs.map(([k, label, n]) =>
      `<button class="eap-chip ${SUB === k ? 'on' : ''}" onclick="EAP.setSub(${J(k)})">${label}${n ? `<span class="n">${n}</span>` : ''}</button>`
    ).join('');

    // 완료/반려 페이지: 양식별 필터 티커
    let doneTickers = '';
    if (SUB === 'done') {
      const byTpl = {};
      list.forEach(d => { const key = d.tplId || d.tpl || d.kind || 'etc'; (byTpl[key] = byTpl[key] || { name: d.tpl || (KIND[d.kind] || {}).label || '기타', cnt: 0 }).cnt++; });
      const tk = [['all', '전체', list.length]].concat(Object.entries(byTpl).map(([k, v]) => [k, v.name, v.cnt]));
      doneTickers = '<div class="eap-chips" style="margin-bottom:10px">' + tk.map(([k, label, n]) =>
        `<button class="eap-chip ${_doneTplFilter === k ? 'on' : ''}" onclick="EAP.setDoneTpl(${J(k)})">${esc(label)} <span style="opacity:.55;font-weight:700">${n}</span></button>`).join('') + '</div>';
      if (_doneTplFilter !== 'all') list = list.filter(d => (d.tplId || d.tpl || d.kind || 'etc') === _doneTplFilter);
    }

    const body = list.length
      ? list.map(docCard).join('')
      : `<div class="eap-empty">📭 항목이 없습니다</div>`;

    const execSum = (SUB === 'exec') ? `<div id="eapExecSummary">${execSummaryHtml()}</div>` : '';

    return `
      <div class="eap-bar">
        <div class="eap-chips">${chips}</div>
        <button class="eap-btn eap-btn-p" onclick="EAP.openDraft()">✏️ 새 기안</button>
      </div>
      ${execSum}
      ${doneTickers}
      <div>${body}</div>`;
  }
  EAP.setSub = function (s) { SUB = s; _doneTplFilter = 'all'; renderTab(); };
  EAP.setDoneTpl = function (k) { _doneTplFilter = k; renderTab(); };

  // 자금집행 집계 — 지출결의(pay) 중 지급완료(execStatus done) 건만 기간(집행일) 집계
  function _thisMonthRange() {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, d.getMonth() + 1, 0).getDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, '0')}` };
  }
  function execSummaryHtml() {
    if (!_execFrom || !_execTo) { const r = _thisMonthRange(); _execFrom = r.from; _execTo = r.to; }
    const all = getDocs().filter(d => d.kind === 'pay' && d.status === 'ok' && canView(d));
    const done = all.filter(d => d.execStatus === 'done');
    const inRange = done.filter(d => { const dt = String(d.execAt || d.at || '').slice(0, 10); return dt >= _execFrom && dt <= _execTo; });
    const cnt = inRange.length, sum = inRange.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const pend = all.filter(d => d.execStatus !== 'done');
    const pendCnt = pend.length, pendSum = pend.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    return `
      <div style="background:#fff;border:1px solid var(--gray-200,#E2E8F0);border-radius:12px;padding:12px 14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-weight:800;font-size:13px">💸 자금집행 집계</span>
          <span class="eap-meta">기간(집행일)</span>
          <input type="date" class="eap-mini" style="max-width:140px" value="${_execFrom}" onchange="EAP.setExecPeriod('from',this.value)">
          <span class="eap-meta">~</span>
          <input type="date" class="eap-mini" style="max-width:140px" value="${_execTo}" onchange="EAP.setExecPeriod('to',this.value)">
          <button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.execThisMonth()">당월</button>
        </div>
        <table class="eap-table" style="margin-bottom:0">
          <thead><tr><th>구분</th><th style="text-align:right">건수</th><th style="text-align:right">금액 합계</th></tr></thead>
          <tbody>
            <tr><td><b>💸 지급완료</b></td><td style="text-align:right"><b>${cnt}</b>건</td><td style="text-align:right;font-weight:800;color:#166534">${won(sum)}</td></tr>
            <tr><td class="eap-meta">⏳ 집행대기 (전체)</td><td style="text-align:right" class="eap-meta">${pendCnt}건</td><td style="text-align:right" class="eap-meta">${won(pendSum)}</td></tr>
          </tbody>
        </table>
      </div>`;
  }
  EAP.setExecPeriod = function (which, val) {
    if (which === 'from') _execFrom = val; else _execTo = val;
    const el = document.getElementById('eapExecSummary'); if (el) el.innerHTML = execSummaryHtml();
  };
  EAP.execThisMonth = function () {
    const r = _thisMonthRange(); _execFrom = r.from; _execTo = r.to;
    const el = document.getElementById('eapExecSummary'); if (el) el.innerHTML = execSummaryHtml();
  };

  function lineHtml(d) {
    const steps = (d.line || []).map((s, i) => {
      let cls = '';
      if (d.status === 'rej' && i === d.step) cls = 'rej';
      else if (i < d.step || d.status === 'ok') cls = 'done';
      else if (i === d.step && d.status === 'wait') cls = 'cur';
      const icon = cls === 'done' ? '✓' : cls === 'cur' ? '⏳' : cls === 'rej' ? '✕' : '';
      return `<span class="eap-step ${cls}">${icon ? icon + ' ' : ''}${esc(s.n)}<span class="eap-role">${esc(s.role || '')}</span></span>`;
    });
    return `<div class="eap-line">${steps.join('<span class="eap-arr">→</span>')}</div>`;
  }
  function stBadge(d) {
    if (d.status === 'ok') return '<span class="eap-st s-ok">✅ 완료</span>';
    if (d.status === 'rej') return '<span class="eap-st s-rej">⛔ 반려</span>';
    if (d.status === 'recalled') return '<span class="eap-st s-rec">↩ 회수</span>';
    return '<span class="eap-st s-wait">진행중</span>';
  }
  function docCard(d) {
    const k = KIND[d.kind] || KIND.gen;
    const mine = isMyTurn(d);
    const amountStr = (d.kind === 'pay' || d.kind === 'buy') && d.amount ? ` · ${won(d.amount)}` : '';
    const leaveStr = d.kind === 'leave' && d.from ? ` · ${d.from}~${d.to || d.from} (${d.days || 1}일)` : '';
    const execBadge = (d.kind === 'pay' && d.status === 'ok')
      ? (d.execStatus === 'done' ? '<span class="eap-exec done">💸 집행완료</span>' : '<span class="eap-exec wait">💸 집행대기</span>') : '';
    return `
    <div class="eap-card" onclick="EAP.openDetail(${J(d.id)})">
      <div class="eap-ctop">
        <span class="eap-kind ${k.cls}">${k.label}</span>
        ${mine ? '<span class="eap-mine">🔔 내 차례</span>' : ''}
        ${isCC(d) ? '<span class="eap-ccflag">👁 참조</span>' : ''}
        ${execBadge}
        ${stBadge(d)}
      </div>
      <div class="eap-title">${esc(d.title || '(제목 없음)')}</div>
      <div class="eap-meta">기안 ${esc(d.drafter)} · ${esc((d.at || '').slice(0, 16))}${amountStr}${leaveStr}</div>
      ${lineHtml(d)}
    </div>`;
  }

  /* ════════════════ 상세 모달 ════════════════ */
  EAP.openDetail = function (id) {
    const d = getDocs().find(x => x.id === id);
    if (!d) { toast('문서를 찾을 수 없습니다'); return; }
    const k = KIND[d.kind] || KIND.gen;
    const t = tplById(d.tplId) || { id: d.tplId, name: d.tpl || k.label.replace(/^\S+\s/, ''), fields: (d.fields || []).map(f => ({ label: f.label, type: f.type })) };
    const vals = {}; (d.fields || []).forEach(f => { vals[f.label] = f.value; });
    if (!vals['제목']) vals['제목'] = d.title;  // 옛 문서: 제목 필드 없으면 doc.title 로 표시

    const histHtml = (d.history || []).map(h =>
      `<div class="eap-hist"><b>${esc(h.n)}</b> <span class="eap-hact ${h.act === '반려' ? 'rej' : ''}">${esc(h.act)}</span> <span class="eap-hts">${esc(h.at)}</span>${h.op ? `<div class="eap-hop">"${esc(h.op)}"</div>` : ''}</div>`
    ).join('') || '<div class="eap-meta">이력 없음</div>';

    let actions = '';
    if (isMyTurn(d)) {
      actions = `
        <textarea id="eapRejOp" class="eap-fld-ta" placeholder="반려 시 의견 (선택)"></textarea>
        <div class="eap-actrow">
          <button class="eap-btn eap-btn-ok" onclick="EAP.approve(${J(d.id)})">✅ 승인</button>
          <button class="eap-btn eap-btn-rej" onclick="EAP.reject(${J(d.id)})">⛔ 반려</button>
        </div>`;
    } else if (d.drafter === ME() && d.status === 'wait') {
      actions = `<button class="eap-btn eap-btn-o" onclick="EAP.recall(${J(d.id)})">↩ 회수</button>`;
    } else if (d.drafter === ME() && d.status === 'recalled') {
      actions = `<div class="eap-actrow"><button class="eap-btn eap-btn-o" onclick="EAP.openDraftEdit(${J(d.id)})">✏️ 수정 후 재상신</button><button class="eap-btn eap-btn-p" onclick="EAP.resubmit(${J(d.id)})">📤 그대로 재상신</button></div>`;
    } else if (d.drafter === ME() && d.status === 'rej') {
      actions = `<div class="eap-meta" style="margin-bottom:6px">반려된 기안입니다. 수정 후 다시 상신할 수 있습니다.</div><div class="eap-actrow"><button class="eap-btn eap-btn-o" onclick="EAP.openDraftEdit(${J(d.id)})">✏️ 수정 후 재상신</button><button class="eap-btn eap-btn-p" onclick="EAP.resubmit(${J(d.id)})">📤 그대로 재상신</button></div>`;
    }

    // 자금집행
    let execHtml = '';
    if (d.kind === 'pay' && d.status === 'ok') {
      if (d.execStatus === 'done') {
        execHtml = `<div class="eap-sech">자금집행</div><div class="eap-execbox done">✅ 집행완료 <span class="eap-meta">${esc(d.execBy || '')} · ${esc(d.execAt || '')}</span></div>`;
      } else {
        execHtml = `<div class="eap-sech">자금집행</div><div class="eap-execbox wait">⏳ 집행 대기 — 결재완료, 자금집행자 처리 대기${canExecFund() ? `<button class="eap-btn eap-btn-ok" style="width:100%;margin-top:8px" onclick="EAP.execDone(${J(d.id)})">💸 자금 집행완료 처리</button>` : '<div class="eap-meta" style="margin-top:6px">집행완료는 자금집행자가 처리합니다.</div>'}</div>`;
      }
    }

    const linkUrl = location.origin + '/m/eapproval/?doc=' + d.id + '&openExternalBrowser=1';
    const lineCard = (d.status === 'wait' && d.line[d.step]) ? `
      <div class="eap-linecard">
        <div class="eap-lh">💬 LINE 알림 — 받는사람: ${esc((d.line[d.step] || {}).n)}</div>
        <div class="eap-meta" style="margin:4px 0">[전자결재] "${esc(d.title)}" 결재 요청이 도착했습니다.</div>
        <div class="eap-linkrow"><span class="eap-linkbox">${esc(linkUrl)}</span><button class="eap-att-btn" onclick="EAP.copyLink(${J(d.id)})">복사</button></div>
      </div>` : '';

    const html = `
      <div class="eap-modal wide">
        <div class="eap-mhead">
          <div><span class="eap-kind ${k.cls}">${k.label}</span> ${stBadge(d)}</div>
          <button class="eap-x" onclick="EAP.closeModal()">✕</button>
        </div>
        ${docFormHtml(t, 'view', vals)}
        ${execHtml}
        <div class="eap-sech">결재선</div>
        ${lineHtml(d)}
        ${(d.cc && d.cc.length) ? `<div class="eap-meta" style="margin-top:6px">참조: ${d.cc.map(esc).join(', ')}</div>` : ''}
        ${attView(d.attachments)}
        ${lineCard}
        <div class="eap-sech">처리 이력</div>
        ${histHtml}
        <div class="eap-mactions">${actions}</div>
      </div>`;
    openModal(html);
  };

  /* ════════════════ 결재 액션 ════════════════ */
  function _save(docs) { _writeDocs(docs); schedulePush(); }
  function notify(to, ev, d) {
    if (!to) return;
    try {
      fetch('/api/eapproval-notify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, title: d.title, docId: d.id, kind: d.kind, event: ev, drafter: d.drafter }),
      }).then(r => r.json()).then(res => {
        if (res && res.ok === false) {
          toast('⚠ LINE 발송 실패(' + to + '): ' + (res.hint || res.detail || res.error || ('status ' + res.status)));
        }
      }).catch(() => {});
    } catch (_) {}
  }

  EAP.approve = function (id) {
    const docs = getDocs(); const d = docs.find(x => x.id === id);
    if (!d || !isMyTurn(d)) return;
    d.history = d.history || [];
    d.history.push({ n: ME(), act: '승인', at: kstNow() });
    d.step++;
    d.updatedAt = Date.now();
    if (d.step >= d.line.length) {
      d.status = 'ok';
      if (d.kind === 'leave' && d.days) {
        const all = getLeaveAll(); const cur = all[d.drafter] || { total: 15, used: 0 };
        cur.used = (Number(cur.used) || 0) + Number(d.days); all[d.drafter] = cur; saveCfgKey('leave', all);
      }
      _save(docs);
      notify(d.drafter, 'done', d);
      toast('✅ 최종 승인 완료');
    } else {
      _save(docs);
      notify((d.line[d.step] || {}).n, 'request', d);
      toast('✅ 승인 — 다음 결재자에게 전달');
    }
    EAP.closeModal(); renderTab();
  };
  EAP.reject = function (id) {
    const docs = getDocs(); const d = docs.find(x => x.id === id);
    if (!d || !isMyTurn(d)) return;
    const op = (document.getElementById('eapRejOp') || {}).value || '';
    d.history = d.history || [];
    d.history.push({ n: ME(), act: '반려', at: kstNow(), op });
    d.status = 'rej'; d.updatedAt = Date.now();
    _save(docs);
    notify(d.drafter, 'rejected', d);
    toast('⛔ 반려 처리'); EAP.closeModal(); renderTab();
  };
  EAP.recall = function (id) {
    const docs = getDocs(); const d = docs.find(x => x.id === id);
    if (!d || d.drafter !== ME() || d.status !== 'wait') return;
    d.status = 'recalled'; d.updatedAt = Date.now();
    d.history = d.history || []; d.history.push({ n: ME(), act: '회수', at: kstNow() });
    _save(docs); toast('↩ 회수 완료'); EAP.closeModal(); renderTab();
  };
  EAP.resubmit = function (id) {
    const docs = getDocs(); const d = docs.find(x => x.id === id);
    if (!d || d.drafter !== ME() || (d.status !== 'recalled' && d.status !== 'rej')) return;
    d.status = 'wait'; d.step = 1; d.updatedAt = Date.now();
    d.history = d.history || []; d.history.push({ n: ME(), act: '재상신', at: kstNow() });
    _save(docs); notify((d.line[1] || {}).n, 'request', d);
    toast('📤 재상신 완료'); EAP.closeModal(); renderTab();
  };
  EAP.execDone = function (id) {
    const docs = getDocs(); const d = docs.find(x => x.id === id);
    if (!d || d.kind !== 'pay' || d.status !== 'ok' || !canExecFund()) return;
    d.execStatus = 'done'; d.execBy = ME(); d.execAt = kstNow(); d.updatedAt = Date.now();
    _save(docs); notify(d.drafter, 'exec', d); toast('💸 자금 집행완료'); EAP.closeModal(); renderTab();
  };
  EAP.copyLink = function (id) {
    const url = location.origin + '/m/eapproval/?doc=' + id + '&openExternalBrowser=1';
    try { navigator.clipboard.writeText(url); toast('🔗 링크 복사됨'); } catch (_) { toast(url); }
  };

  /* ════════════════ 기안 작성 모달 ════════════════ */
  let draftTpl = null, draftLine = [], draftCC = [], draftAtts = [], _editDocId = null, _draftVals = {}, _editTpl = null;
  // 회수/작성 문서 수정 후 재상신 — 기존 doc 프리필 (문서의 필드 기준으로 렌더 — 템플릿 변경에도 안전)
  EAP.openDraftEdit = function (id) {
    const d = getDocs().find(x => x.id === id);
    if (!d) { toast('문서를 찾을 수 없습니다'); return; }
    if (d.drafter !== ME()) { toast('본인 기안만 수정할 수 있습니다'); return; }
    _editDocId = id;
    _draftVals = {}; (d.fields || []).forEach(f => { _draftVals[f.label] = f.value; });
    draftLine = (d.line || []).filter(s => s.role !== '기안').map(s => s.n);
    draftCC = (d.cc || []).slice();
    draftAtts = (d.attachments || []).slice();
    // 문서의 필드로 템플릿 구성(select 옵션은 원 템플릿에서 보강), 필드 없으면 원 템플릿 사용
    const t = tplById(d.tplId);
    const docFields = (d.fields && d.fields.length)
      ? d.fields.map(f => { const tf = (t && t.fields || []).find(x => x.label === f.label); return { label: f.label, type: f.type, options: tf ? tf.options : undefined }; })
      : ((t && t.fields) || []);
    _editTpl = { id: d.tplId, name: (t && t.name) || d.tpl || '문서', cat: d.kind || (t && t.cat) || 'gen', fields: docFields };
    _renderDraftModal(d.tplId, d.title || '');
  };
  EAP.openDraft = function (tplId) {
    _editDocId = null; _draftVals = {}; _editTpl = null;
    draftLine = myRoute().filter(n => n !== ME());
    draftCC = [];
    draftAtts = [];
    _renderDraftModal(tplId, '');
  };
  function _renderDraftModal(tplId, titleVal) {
    const tpls = getTpls();
    draftTpl = (_editDocId && _editTpl) ? _editTpl : (tplId ? tplById(tplId) : (tpls[0] || null));
    const tplOpts = tpls.map(t => `<option value="${esc(t.id)}" ${draftTpl && t.id === draftTpl.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const staff = STAFF().filter(n => n !== ME());
    const editing = !!_editDocId;
    const html = `
      <div class="eap-modal wide">
        <div class="eap-mhead"><h3>${editing ? '✏️ 수정 후 재상신' : '✏️ 새 기안'}</h3><button class="eap-x" onclick="EAP.closeModal()">✕</button></div>
        <div class="eap-fld"><label>문서 양식</label>
          <select id="eapTplSel" onchange="EAP.onTplChange(this.value)" ${editing ? 'disabled' : ''}>${tplOpts}</select></div>
        <div class="eap-fld"><label>제목</label><input id="eapTitle" type="text" placeholder="제목 입력" oninput="EAP.onTitleTop()"></div>
        <div id="eapDraftFields"></div>
        <div class="eap-fld"><label>📎 첨부 (이미지/파일)</label>
          <div class="eap-att-zone" onclick="document.getElementById('eapAttInput').click()">파일 선택 또는 여기 클릭</div>
          <input id="eapAttInput" type="file" multiple style="display:none" onchange="EAP.addAtt(this.files)">
          <div id="eapAttList" class="eap-att-list"></div></div>
        <div class="eap-fld"><label style="display:flex;align-items:center;gap:8px">결재선
          <button type="button" class="eap-att-btn" style="margin-left:auto" onclick="EAP.saveMyRoute()">💾 내 기본 결재선 저장</button></label>
          <div class="eap-picker" id="eapLinePick">${staff.map(n => `<span class="eap-pk ${draftLine.includes(n) ? 'on' : ''}" onclick="EAP.toggleLine(${J(n)})">${pkLabel(draftLine, n)}${esc(n)}</span>`).join('')}</div>
          <div class="eap-meta" id="eapLinePrev" style="margin-top:6px"></div></div>
        <div class="eap-fld"><label style="display:flex;align-items:center;gap:8px">참조
          <button type="button" class="eap-att-btn" style="margin-left:auto" onclick="EAP.toggleCCAll()">전체 선택</button></label>
          <div class="eap-picker" id="eapCCPick">${staff.map(n => `<span class="eap-pk ${draftCC.includes(n) ? 'on' : ''}" onclick="EAP.toggleCC(${J(n)})">${esc(n)}</span>`).join('')}</div></div>
        <div class="eap-mactions"><button class="eap-btn eap-btn-p" style="width:100%" onclick="EAP.submitDraft()">${editing ? '📤 수정 후 재상신' : '📤 상신'}</button></div>
      </div>`;
    openModal(html);
    const ti = document.getElementById('eapTitle'); if (ti) ti.value = titleVal || '';
    renderDraftFields();
    updateLinePreview();
    renderAttList();
  };
  function pkLabel(arr, n) { const i = arr.indexOf(n); return i >= 0 ? `<b>${i + 1}</b> ` : ''; }
  EAP.onTplChange = function (id) { draftTpl = tplById(id); _draftVals = {}; renderDraftFields(); };
  function renderDraftFields() {
    const box = document.getElementById('eapDraftFields');
    if (!box) return;
    box.innerHTML = draftTpl ? docFormHtml(draftTpl, 'input', _draftVals || {}) : '';
    if (!draftTpl) return;
    try { EAP.onTitleTop(); } catch (_) {}  // 상단 제목 → 내용부분 제목란 동기화
    if (draftTpl.cat === 'leave') {  // 연차: 시작/종료일·휴가종류 변경 시 일수 자동 계산
      box.querySelectorAll('input[type=date]').forEach(i => i.addEventListener('change', EAP.recalcLeaveDays));
      const sel = box.querySelector('[data-eapf="휴가 종류"]'); if (sel) sel.addEventListener('change', EAP.recalcLeaveDays);
    }
  }
  // 제목란 양방향 동기화
  EAP.onTitleForm = function (el) { const t = document.getElementById('eapTitle'); if (t) t.value = el.value; };
  EAP.onTitleTop = function () { const f = document.querySelector('#eapDraftFields [data-eapf="제목"]'); const t = document.getElementById('eapTitle'); if (f && t) f.value = t.value; };
  // 연차 일수 자동 계산 (시작일~종료일 근무일 수 — 토·일·공휴일 제외, 반차 0.5)
  EAP.recalcLeaveDays = function () {
    const box = document.getElementById('eapDraftFields'); if (!box) return;
    const dates = [...box.querySelectorAll('input[type=date]')].map(i => i.value).filter(Boolean).sort();
    if (!dates.length) return;
    const from = dates[0], to = dates[dates.length - 1];
    let days = workingDays(from, to);
    const sel = box.querySelector('[data-eapf="휴가 종류"]');
    if (sel && /반차/.test(sel.value) && from === to && days >= 1) days = 0.5;
    const dayInput = box.querySelector('[data-eapf="일 수"]') || [...box.querySelectorAll('[data-eapf]')].find(el => /일\s*수|일수/.test(el.getAttribute('data-eapf')));
    if (dayInput) dayInput.value = days;
  };
  EAP.toggleLine = function (n) {
    const i = draftLine.indexOf(n); if (i >= 0) draftLine.splice(i, 1); else draftLine.push(n);
    refreshLinePick(); updateLinePreview();
  };
  function refreshLinePick() {
    const box = document.getElementById('eapLinePick'); if (!box) return;
    box.querySelectorAll('.eap-pk').forEach(el => { });
    const staff = STAFF().filter(n => n !== ME());
    box.innerHTML = staff.map(n => `<span class="eap-pk ${draftLine.includes(n) ? 'on' : ''}" onclick="EAP.toggleLine(${J(n)})">${pkLabel(draftLine, n)}${esc(n)}</span>`).join('');
  }
  function updateLinePreview() {
    const el = document.getElementById('eapLinePrev'); if (!el) return;
    el.innerHTML = '결재선: <b>' + esc(ME()) + '</b>(기안)' + (draftLine.length ? ' → ' + draftLine.map(esc).join(' → ') : ' <span style="color:#cbd5e1">(결재자 미지정)</span>');
  }
  EAP.toggleCC = function (n) {
    const i = draftCC.indexOf(n); if (i >= 0) draftCC.splice(i, 1); else draftCC.push(n);
    refreshCCPick();
  };
  EAP.toggleCCAll = function () {
    const staff = STAFF().filter(n => n !== ME());
    draftCC = staff.every(n => draftCC.includes(n)) ? [] : staff.slice();
    refreshCCPick();
  };
  function refreshCCPick() {
    const box = document.getElementById('eapCCPick'); if (!box) return;
    const staff = STAFF().filter(n => n !== ME());
    box.innerHTML = staff.map(n => `<span class="eap-pk ${draftCC.includes(n) ? 'on' : ''}" onclick="EAP.toggleCC(${J(n)})">${esc(n)}</span>`).join('');
  }
  EAP.saveMyRoute = function () {
    const r = getRoutes(); r[ME()] = draftLine.slice(); saveCfgKey('routes', r); toast('💾 내 기본 결재선 저장');
  };
  const ATT_CAP = 2 * 1024 * 1024;   // 2MB — 이 이하 파일은 내용(dataUrl) 저장해 나중에 열람 가능
  EAP.addAtt = function (files) {
    [...files].forEach(f => {
      const item = { name: f.name, type: f.type, size: f.size };
      // 모든 파일 유형(PDF·문서·이미지 등) 내용 저장 — 2MB 초과만 메타만(열람 불가 안내)
      if (f.size <= ATT_CAP) {
        const r = new FileReader();
        r.onload = e => { item.dataUrl = e.target.result; renderAttList(); };
        r.readAsDataURL(f);
      } else {
        toast('⚠ ' + f.name + ' (' + fsize(f.size) + ') — 2MB 초과로 내용은 저장되지 않습니다');
      }
      draftAtts.push(item);
    });
    renderAttList();
  };
  EAP.rmAtt = function (i) { draftAtts.splice(i, 1); renderAttList(); };
  function renderAttList() {
    const box = document.getElementById('eapAttList'); if (!box) return;
    box.innerHTML = draftAtts.map((a, i) => {
      const isImg = /^image\//.test(a.type || '') && a.dataUrl;
      const icon = isImg ? `<img src="${a.dataUrl}">` : '📄';
      const noContent = !a.dataUrl ? ' <span class="eap-meta">(내용 미저장)</span>' : '';
      return `<div class="eap-att-item">${icon} <span>${esc(a.name)} ${fsize(a.size)}${noContent}</span> <span class="x" onclick="EAP.rmAtt(${i})">✕</span></div>`;
    }).join('');
  }
  EAP.submitDraft = function () {
    if (!draftTpl) { toast('양식을 선택하세요'); return; }
    // 필드 수집 (제목 포함 — effFields)
    const fields = [];
    effFields(draftTpl).forEach(f => {
      const el = document.querySelector(`#eapDraftFields [data-eapf="${cssEsc(f.label)}"]`);
      let val = el ? el.value : '';
      if (f.type === 'money' || f.type === 'number') val = String(val).replace(/,/g, '');
      fields.push({ label: f.label, type: f.type, value: val });
    });
    const titleField = fields.find(f => f.label === '제목');
    const title = (document.getElementById('eapTitle') || {}).value.trim() || (titleField && titleField.value.trim()) || draftTpl.name;
    const cat = draftTpl.cat || 'gen';
    const me = ME();
    const line = [{ n: me, role: '기안' }, ...draftLine.map(n => ({ n, role: '결재' }))];
    const applyCatFields = (d) => {
      delete d.amount; delete d.from; delete d.to; delete d.days;
      if (cat === 'pay' || cat === 'buy') {
        const amtF = fields.find(f => f.type === 'money'); d.amount = amtF ? Number(amtF.value) || 0 : 0;
        if (cat === 'pay' && d.execStatus !== 'done') d.execStatus = 'pending';
      }
      if (cat === 'leave') {
        const dates = fields.filter(f => f.type === 'date' && f.value).map(f => f.value).sort();
        const daysF = fields.find(f => f.label.includes('일') && f.type === 'number');
        d.from = dates[0] || kstDate(); d.to = dates[dates.length - 1] || d.from;
        d.days = daysF && daysF.value ? Number(daysF.value) : workingDays(d.from, d.to);
      }
    };

    const docs = getDocs();
    if (_editDocId) {
      // ── 수정 후 재상신 ── 기존 doc 갱신
      const d = docs.find(x => x.id === _editDocId);
      if (!d) { toast('문서를 찾을 수 없습니다'); _editDocId = null; return; }
      d.kind = cat; d.title = title; d.tpl = draftTpl.name; d.tplId = draftTpl.id;
      d.fields = fields; d.line = line; d.step = 1; d.status = 'wait';
      d.cc = draftCC.slice(); d.attachments = draftAtts.slice();
      applyCatFields(d);
      d.history = d.history || []; d.history.push({ n: me, act: '재상신', at: kstNow() });
      d.updatedAt = Date.now();
      _save(docs);
      if (d.line[1]) notify(d.line[1].n, 'request', d);
      const savedId = d.id; _editDocId = null;
      toast('📤 수정 후 재상신 완료'); EAP.closeModal(); SUB = 'mine'; renderTab();
      setTimeout(() => EAP.openDetail(savedId), 100);
      return;
    }

    const d = {
      id: genId('D'), kind: cat, title, drafter: me, at: kstNow(),
      tpl: draftTpl.name, tplId: draftTpl.id, fields,
      line, step: 1, status: 'wait', history: [{ n: me, act: '기안', at: kstNow() }],
      cc: draftCC.slice(), attachments: draftAtts.slice(),
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    applyCatFields(d);
    docs.push(d); _save(docs);
    if (d.line[1]) notify(d.line[1].n, 'request', d);
    toast('📤 상신 완료'); EAP.closeModal(); SUB = 'mine'; renderTab();
    setTimeout(() => EAP.openDetail(d.id), 100);
  };
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  /* ════════════════ 폼 렌더 (docFormHtml / ci) ════════════════ */
  function ci(label, type, vals, mode, opts) {
    const v = (vals && vals[label] != null) ? vals[label] : '';
    if (mode === 'view') {
      if (v === '' || v == null) return '<span class="eap-dash">-</span>';
      if (type === 'money') return '<b>' + commaFmt(v) + '원</b>';
      if (type === 'number') return commaFmt(v);
      return esc(v);
    }
    const da = `data-eapf="${esc(label)}"`;
    if (type === 'textarea') return `<textarea ${da}>${esc(v)}</textarea>`;
    if (type === 'select') {
      const o = String(opts || '').split(',').map(s => s.trim()).filter(Boolean);
      return `<select ${da}><option value="">선택</option>${o.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    }
    if (type === 'date') return `<input ${da} type="date" value="${esc(v || '')}">`;
    if (type === 'money' || type === 'number') return `<input ${da} type="text" inputmode="numeric" value="${esc(commaFmt(v))}" oninput="EAP.fmtNum(this)">`;
    if (label === '제목') return `<input ${da} type="text" value="${esc(v)}" placeholder="제목" oninput="EAP.onTitleForm(this)">`;  // 내용부분 제목란 ↔ 상단 제목란 동기화
    return `<input ${da} type="text" value="${esc(v)}">`;
  }
  // 모든 양식 내용부분에 '제목' 필드를 보장 (없으면 맨 앞에 추가)
  function effFields(t) {
    const fs = (t && Array.isArray(t.fields)) ? t.fields.slice() : [];
    if (!fs.some(f => f && f.label === '제목')) fs.unshift({ label: '제목', type: 'text' });
    return fs;
  }
  EAP.fmtNum = function (el) {
    let raw = String(el.value || '').replace(/[^0-9.]/g, '');
    const p = raw.split('.');
    let intp = p[0].replace(/^0+(?=\d)/, '');
    intp = intp ? Number(intp).toLocaleString('ko-KR') : '';
    el.value = p.length > 1 ? (intp || '0') + '.' + p.slice(1).join('') : intp;
  };

  function row(th, td, span) { return `<tr><th>${th}</th><td ${span ? `colspan="${span}"` : ''}>${td}</td></tr>`; }
  function cell(label, type, vals, mode, opts) { return `<td class="${mode === 'view' ? 'val' : ''}">${ci(label, type, vals, mode, opts)}</td>`; }

  function docFormHtml(t, mode, vals) {
    let inner; let cols4 = false;
    const byLabel = {}; (t.fields || []).forEach(f => { byLabel[f.label] = f; });
    const has = l => byLabel[l];
    const C = (l, m2) => has(l) ? ci(l, byLabel[l].type, vals, m2 || mode, byLabel[l].options) : '';

    if (t.id === 't-pay' && has('결제 방법')) { cols4 = true;
      inner = `<colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup>
        <tr><th>결제 방법</th><td>${C('결제 방법')}</td><th>지급 일자</th><td>${C('지급 일자')}</td></tr>
        <tr><th>사용 부서</th><td>${C('사용 부서')}</td><th>은 행 명</th><td>${C('은 행 명')}</td></tr>
        <tr><th>예 금 주</th><td>${C('예 금 주')}</td><th>계좌 번호</th><td>${C('계좌 번호')}</td></tr>
        <tr><th>금   액</th><td colspan="3">${C('금   액')}</td></tr>
        <tr><th>사용 내역</th><td colspan="3">${C('사용 내역')}</td></tr>`;
    } else if (t.id === 't-trip-req' && has('소 속')) { cols4 = true;
      inner = `<colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup>
        <tr><th>소 속</th><td>${C('소 속')}</td><th>직 위</th><td>${C('직 위')}</td></tr>
        <tr><th>성 명</th><td>${C('성 명')}</td><th>출장 장소</th><td>${C('출장 장소')}</td></tr>
        <tr><th>출장 시작</th><td>${C('출장 시작')}</td><th>출장 종료</th><td>${C('출장 종료')}</td></tr>
        <tr><th>출장 목적</th><td colspan="3">${C('출장 목적')}</td></tr>
        <tr><th>비 고</th><td colspan="3">${C('비 고')}</td></tr>`;
    } else if (t.id === 't-trip-rep' && has('출장 업무내역')) { cols4 = true;
      inner = `<colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup>
        <tr><th>소 속</th><td>${C('소 속')}</td><th>직 위</th><td>${C('직 위')}</td></tr>
        <tr><th>성 명</th><td>${C('성 명')}</td><th>출장 장소</th><td>${C('출장 장소')}</td></tr>
        <tr><th>출장 시작</th><td>${C('출장 시작')}</td><th>출장 종료</th><td>${C('출장 종료')}</td></tr>
        <tr><th>출장 업무내역</th><td colspan="3">${C('출장 업무내역')}</td></tr>
        <tr><th>참고 사항</th><td colspan="3">${C('참고 사항')}</td></tr>`;
    } else {
      // 자동 2-col
      inner = `<colgroup><col style="width:30%"><col></colgroup>` + (t.fields || []).map(f =>
        row(esc(f.label), cell(f.label, f.type, vals, mode, f.options).replace(/^<td[^>]*>|<\/td>$/g, ''))
      ).join('');
    }
    // 제목 필드가 양식에 없으면 colgroup 직후에 제목 행 추가 (모든 양식 내용부분에 제목란 보장)
    if (!has('제목')) {
      const span = cols4 ? ' colspan="3"' : '';
      const titleRow = `<tr><th>제목</th><td${span} class="${mode === 'view' ? 'val' : ''}">${ci('제목', 'text', vals, mode)}</td></tr>`;
      inner = inner.replace('</colgroup>', '</colgroup>' + titleRow);
    }
    return `<div class="eap-docform"><div class="eap-docform-title">${esc(t.name)}</div><div class="eap-tblwrap"><table class="eap-tbl">${inner}</table></div></div>`;
  }

  /* ════════════════ 첨부 보기 + 라이트박스 ════════════════ */
  let _lbImgs = [];
  let _detailAtts = [];
  function attView(atts) {
    atts = atts || [];
    if (!atts.length) return '';
    _detailAtts = atts;
    const isImg = a => /^image\//.test(a.type || '') && a.dataUrl;
    const imgs = atts.filter(isImg);
    _lbImgs = imgs.map(a => a.dataUrl);
    let filesHtml = '';
    atts.forEach((a, i) => {
      if (isImg(a)) return;
      filesHtml += a.dataUrl
        ? `<div class="eap-att-thumb"><a href="#" onclick="EAP.openAtt(${i});return false" style="color:#2563EB;font-weight:700;cursor:pointer">📄 ${esc(a.name)}</a> <span class="eap-meta">${fsize(a.size)}</span></div>`
        : `<div class="eap-att-thumb">📄 ${esc(a.name)} <span class="eap-meta">${fsize(a.size)} · 내용 미저장(구 첨부 — 다시 첨부 필요)</span></div>`;
    });
    return `<div class="eap-sech">📎 첨부 (${atts.length})</div>
      <div class="eap-att-imgs">${imgs.map((a, i) => `<img class="eap-att-pv" src="${a.dataUrl}" onclick="EAP.openImg(${i})">`).join('')}</div>
      ${filesHtml}`;
  }
  // 첨부 열기 — dataUrl → Blob → 새 탭(뷰). 팝업 차단 시 다운로드 fallback. (data: 직접이동은 Chrome 차단되므로 blob 사용)
  EAP.openAtt = function (i) {
    const a = (_detailAtts || [])[i];
    if (!a || !a.dataUrl) { toast('첨부 내용이 없습니다'); return; }
    try {
      const comma = a.dataUrl.indexOf(',');
      const meta = a.dataUrl.slice(0, comma);
      const b64 = a.dataUrl.slice(comma + 1);
      const mime = (meta.match(/data:([^;]+)/) || [])[1] || a.type || 'application/octet-stream';
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      const url = URL.createObjectURL(new Blob([arr], { type: mime }));
      const w = window.open(url, '_blank');
      if (!w) { const el = document.createElement('a'); el.href = url; el.download = a.name || 'attachment'; document.body.appendChild(el); el.click(); el.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast('첨부 열기 실패'); }
  };
  EAP.openImg = function (i) {
    const host = document.getElementById('eapModalHost');
    const lb = document.createElement('div');
    lb.className = 'eap-lb show'; lb.id = 'eapLb';
    lb.innerHTML = `<button class="eap-lb-x" onclick="EAP.closeImg()">✕ 닫기</button><img id="eapLbImg" src="${_lbImgs[i] || ''}">`;
    lb.onclick = e => { if (e.target === lb) EAP.closeImg(); };
    const img = lb.querySelector('#eapLbImg');
    img.onclick = () => img.classList.toggle('zoom');
    host.appendChild(lb);
  };
  EAP.closeImg = function () { const el = document.getElementById('eapLb'); if (el) el.remove(); };

  /* ════════════════ 연차관리 (leave) ════════════════ */
  function renderLeave() {
    const me = ME();
    const lv = getLeave(me);
    const remain = (Number(lv.total) || 0) - (Number(lv.used) || 0);
    const pct = lv.total ? Math.min(100, Math.round((lv.used / lv.total) * 100)) : 0;
    const myDocs = getDocs().filter(d => d.kind === 'leave' && d.drafter === me).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const canEdit = canEditLeave();
    const team = (isAdmin() || canEdit) ? STAFF().map(n => { const l = getLeave(n); const r = (Number(l.total) || 0) - (Number(l.used) || 0); return `<tr><td>${esc(n)}</td><td>${l.total}</td><td>${l.used}</td><td><b>${r}</b></td>${canEdit ? `<td><button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.openLeaveEdit(${J(n)})">✏️</button></td>` : ''}</tr>`; }).join('') : '';
    return `
      <div class="eap-bar"><div></div><button class="eap-btn eap-btn-p" onclick="EAP.openDraft('t-leave')">🌴 연차 신청</button></div>
      <div class="eap-lvcards">
        <div class="eap-lv"><div class="v">${lv.total}</div><div class="l">부여</div></div>
        <div class="eap-lv"><div class="v" style="color:#EA580C">${lv.used}</div><div class="l">사용</div></div>
        <div class="eap-lv"><div class="v" style="color:#16A34A">${remain}</div><div class="l">잔여</div></div>
      </div>
      <div class="eap-bar2"><div class="eap-prog"><i style="width:${pct}%"></i></div><span class="eap-meta">${pct}% 사용</span></div>
      <div class="eap-sech">내 연차 신청 내역</div>
      ${myDocs.length ? myDocs.map(docCard).join('') : '<div class="eap-empty">신청 내역 없음</div>'}
      ${(isAdmin() || canEdit) ? `<div class="eap-sech">팀 연차 현황${canEdit ? ' <span class="eap-meta">— ✏️ 부여/사용 일수 편집 가능</span>' : ''}</div><table class="eap-table"><thead><tr><th>직원</th><th>부여</th><th>사용</th><th>잔여</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>${team}</tbody></table>` : ''}`;
  }
  EAP.openLeaveEdit = function (n) {
    if (!canEditLeave()) { toast('연차 편집 권한이 없습니다'); return; }
    const l = getLeave(n);
    const html = `<div class="eap-modal">
      <div class="eap-mhead"><h3>🌴 ${esc(n)} 연차 일수</h3><button class="eap-x" onclick="EAP.closeModal()">✕</button></div>
      <div class="eap-fld"><label>부여 일수 (총 연차)</label><input id="eapLvTotal" type="text" inputmode="numeric" value="${esc(l.total)}" oninput="EAP.fmtNum(this)"></div>
      <div class="eap-fld"><label>사용 일수</label><input id="eapLvUsed" type="text" inputmode="numeric" value="${esc(l.used)}" oninput="EAP.fmtNum(this)"></div>
      <div class="eap-meta">잔여 = 부여 − 사용 (자동 계산)</div>
      <div class="eap-mactions"><button class="eap-btn eap-btn-p" style="width:100%" onclick="EAP.saveLeaveEdit(${J(n)})">저장</button></div>
    </div>`;
    openModal(html);
  };
  EAP.saveLeaveEdit = function (n) {
    if (!canEditLeave()) { toast('연차 편집 권한이 없습니다'); return; }
    const total = Number(String((document.getElementById('eapLvTotal') || {}).value || '0').replace(/,/g, '')) || 0;
    const used = Number(String((document.getElementById('eapLvUsed') || {}).value || '0').replace(/,/g, '')) || 0;
    const all = getLeaveAll(); all[n] = { total, used }; saveCfgKey('leave', all);
    EAP.closeModal(); renderTab(); toast('🌴 ' + n + ' 연차 ' + total + '일(사용 ' + used + ') 저장');
  };

  /* ════════════════ 일정 (sch) ════════════════ */
  // 지정 양력연도(y)에 해당하는 생일의 양력일. 음력이면 매년 정확히 변환.
  function birthSolarForYear(b, y) {
    if (!b || !b.date) return null;
    const parts = String(b.date).split('-');
    if (b.cal === 'lunar' && window.LunarKR) {
      const s = window.LunarKR.lunarBirthdayStr(Number(parts[1]), Number(parts[2]), y);
      if (s) return s;  // 변환 실패 시 아래 fallback
    }
    return `${y}-${parts[1]}-${parts[2]}`;
  }
  function birthThisYear(b) {
    return birthSolarForYear(b, new Date(Date.now() + 9 * 3600 * 1000).getFullYear());
  }
  function bdayEvents() { const b = getBirths(); return Object.entries(b).map(([who, v]) => ({ who, date: birthThisYear(v), cal: v.cal, raw: v.date })).filter(e => e.date); }
  function leaveEvents() { return getDocs().filter(d => d.kind === 'leave' && d.status === 'ok').map(d => ({ who: d.drafter, from: d.from, to: d.to || d.from, days: d.days || 1 })); }
  function renderSch() {
    const ym = kstDate().slice(0, 7);
    const bd = bdayEvents();
    const lv = leaveEvents();
    const bdThis = bd.filter(e => e.date && e.date.slice(0, 7) === ym).length;
    const lvThis = lv.filter(e => (e.from || '').slice(0, 7) === ym).length;
    const today = kstDate();
    const upBd = bd.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const nextBd = upBd[0];
    const myQ = getDocs().filter(isMyTurn).length;

    const items = [
      ...upBd.map(e => ({ date: e.date, type: 'bday', html: `<span class="d">${e.date.slice(5)}</span><span class="ic">🎂</span><div><b>${esc(e.who)}</b> 생일 <span class="${e.cal === 'lunar' ? 'eap-lunar' : 'eap-solar'}">${e.cal === 'lunar' ? '🌙 음력' : '☀️ 양력'}</span></div>` })),
      ...lv.filter(e => (e.to || e.from) >= today).map(e => ({ date: e.from, type: 'leave', html: `<span class="d">${(e.from || '').slice(5)}</span><span class="ic">🌴</span><div><b>${esc(e.who)}</b> 연차(${e.days}일) <span class="eap-meta">${e.from}~${e.to}</span></div>` })),
    ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const upHtml = items.length ? items.map(it => `<div class="eap-sch-item eap-sch-${it.type}">${it.html}</div>`).join('') : '<div class="eap-empty">예정된 일정 없음</div>';

    const bdayMgmt = (SCHSUB === 'bday')
      ? `<table class="eap-table"><thead><tr><th>직원</th><th>생일</th><th>구분</th>${canEditBirth() ? '<th></th>' : ''}</tr></thead><tbody>${STAFF().map(n => { const b = getBirths()[n]; return `<tr><td>${esc(n)}</td><td>${b ? esc(b.date) + (b.cal === 'lunar' ? ` <span class="eap-meta">→ 양력 ${esc((birthThisYear(b) || '').slice(5))}</span>` : '') : '<span class="eap-dash">미등록</span>'}</td><td>${b ? (b.cal === 'lunar' ? '🌙 음력' : '☀️ 양력') : '-'}</td>${canEditBirth() ? `<td><button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.openBday(${J(n)})">✏️</button></td>` : ''}</tr>`; }).join('')}</tbody></table>`
      : upHtml;

    return `
      <div class="eap-dash">
        <div class="eap-dcard"><div class="dl">🎂 이번달 생일</div><div class="dv">${bdThis}</div></div>
        <div class="eap-dcard"><div class="dl">🌴 이번달 연차</div><div class="dv">${lvThis}</div></div>
        <div class="eap-dcard"><div class="dl">📅 다음 생일</div><div class="dv" style="font-size:15px">${nextBd ? esc(nextBd.who) + ' ' + nextBd.date.slice(5) : '-'}</div></div>
        <div class="eap-dcard"><div class="dl">⏳ 내 결재 대기</div><div class="dv" style="color:#DC2626">${myQ}</div></div>
      </div>
      <div class="eap-chips">
        <button class="eap-chip ${SCHSUB === 'up' ? 'on' : ''}" onclick="EAP.setSchSub('up')">예정 일정</button>
        <button class="eap-chip ${SCHSUB === 'bday' ? 'on' : ''}" onclick="EAP.setSchSub('bday')">🎂 생일 관리</button>
      </div>
      <div style="margin-top:10px">${bdayMgmt}</div>`;
  }
  EAP.setSchSub = function (s) { SCHSUB = s; renderTab(); };
  EAP.openBday = function (n) {
    if (!canEditBirth()) { toast('생일 등록 권한이 없습니다'); return; }
    const b = getBirths()[n] || { date: '', cal: 'solar' };
    const html = `<div class="eap-modal">
      <div class="eap-mhead"><h3>🎂 ${esc(n)} 생일</h3><button class="eap-x" onclick="EAP.closeModal()">✕</button></div>
      <div class="eap-fld"><label>생년월일</label><input id="eapBdDate" type="date" value="${esc(b.date)}"></div>
      <div class="eap-fld"><label>구분</label>
        <div class="eap-picker"><span class="eap-pk ${b.cal !== 'lunar' ? 'on' : ''}" id="eapCalSolar" onclick="EAP.setCal('solar')">☀️ 양력</span><span class="eap-pk ${b.cal === 'lunar' ? 'on' : ''}" id="eapCalLunar" onclick="EAP.setCal('lunar')">🌙 음력</span></div></div>
      <div class="eap-mactions"><button class="eap-btn eap-btn-p" style="width:100%" onclick="EAP.saveBday(${J(n)})">저장</button></div>
    </div>`;
    openModal(html); EAP._calSel = b.cal || 'solar';
  };
  EAP.setCal = function (c) {
    EAP._calSel = c;
    document.getElementById('eapCalSolar').classList.toggle('on', c === 'solar');
    document.getElementById('eapCalLunar').classList.toggle('on', c === 'lunar');
  };
  EAP.saveBday = function (n) {
    if (!canEditBirth()) { toast('생일 등록 권한이 없습니다'); return; }
    const date = (document.getElementById('eapBdDate') || {}).value;
    if (!date) { toast('생일을 입력하세요'); return; }
    const b = getBirths(); b[n] = { date, cal: EAP._calSel || 'solar' }; saveCfgKey('birth', b);
    EAP.closeModal(); renderTab(); toast('🎂 저장됨');
  };

  /* ════════════════ 양식·루트 관리 (tpl) — 관리자 ════════════════ */
  function renderTpl() {
    const admin = isAdmin();
    if (!admin && !canManageRoutes()) return '<div class="eap-empty">관리자 전용 화면입니다</div>';
    const R = getRoutes();
    const routeRows = STAFF().map(n => {
      const r = (R[n] || []).filter(Boolean);
      return `<tr><td><b>${esc(n)}</b></td><td>${r.length ? esc(n) + '(기안) → ' + r.map(esc).join(' → ') : '<span class="eap-dash">미지정</span>'}</td><td><button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.openRoute(${J(n)})">✏️</button></td></tr>`;
    }).join('');
    const lineMap = getLineMap();
    const lineRows = STAFF().map(n => `<tr><td><b>${esc(n)}</b></td><td><input class="eap-mini" data-eaplm="${esc(n)}" value="${esc(lineMap[n] || '')}" placeholder="LINE userId (Uxxxx)"></td><td><button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.testLine(${J(n)})">테스트</button></td></tr>`).join('');
    const tplCards = getTpls().map(t => {
      const k = KIND[t.cat] || KIND.gen;
      return `<div class="eap-card" style="cursor:default">
        <div class="eap-ctop"><span class="eap-kind ${k.cls}">${k.label}</span><b>${esc(t.name)}</b>
          <span style="margin-left:auto;display:flex;gap:6px"><button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.openTpl(${J(t.id)})">수정</button><button class="eap-btn eap-btn-rej eap-btn-sm" onclick="EAP.delTpl(${J(t.id)})">삭제</button></span></div>
        <div class="eap-meta">${(t.fields || []).slice(0, 8).map(f => esc(f.label)).join(' · ')}</div></div>`;
    }).join('');
    const hY = new Date(Date.now() + 9 * 3600 * 1000).getFullYear();
    const yMin = hY + '-01-01', yMax = (hY + 1) + '-12-31';
    const effList = [...effHolidaySet()].filter(d => d >= yMin && d <= yMax).sort();
    const customSet = new Set(getCfg().holidays || []);
    const excl = (getCfg().holidayExcludes || []).slice().sort();
    const effChips = effList.length
      ? effList.map(d => `<span class="eap-pk" style="cursor:default">${esc(d)}${customSet.has(d) ? ' <span style="font-size:9px;color:#2563EB">직접</span>' : ''} <span style="cursor:pointer;color:#DC2626;font-weight:900" onclick="EAP.removeHoliday(${J(d)})" title="근무일로 처리(제외)">✕</span></span>`).join('')
      : '<span class="eap-meta">표시할 공휴일 없음</span>';
    const exclChips = excl.length
      ? `<div class="eap-meta" style="margin-top:8px">근무일로 제외된 날 (클릭 시 복원):</div><div class="eap-picker">${excl.map(d => `<span class="eap-pk" style="cursor:pointer;opacity:.75" onclick="EAP.restoreHoliday(${J(d)})">↩ ${esc(d)}</span>`).join('')}</div>`
      : '';
    const adminSections = (admin || canManageRoutes()) ? `
      <div class="eap-sech">📅 공휴일 관리 <span class="eap-meta">— 연차 계산 시 토·일 + 아래 공휴일 제외 (✕ = 근무일로 처리)</span></div>
      <div class="eap-meta" style="margin-bottom:6px">내장 + 자동수집(공공데이터포털) + 직접추가를 합산. 제헌절 등 평일로 둘 날은 ✕ 로 제외하세요. (${hY}~${hY + 1} 표시)</div>
      <div class="eap-picker" id="eapHolList">${effChips}</div>
      ${exclChips}
      <div style="display:flex;gap:6px;margin-top:8px"><input id="eapHolDate" type="date" class="eap-mini" style="max-width:170px"><button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.addHoliday()">+ 추가</button></div>
      <div class="eap-sech">💬 직원 LINE userId (결재 알림용) <span class="eap-meta">— 직원이 LINE 봇/단톡방에서 발언하면 자동 수집됨</span></div>
      <table class="eap-table"><thead><tr><th>직원</th><th>LINE userId</th><th></th></tr></thead><tbody>${lineRows}</tbody></table>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="eap-btn eap-btn-p eap-btn-sm" onclick="EAP.fillLineFromProfiles()">📥 LINE에서 자동 채우기</button>
        <button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.saveLineMap()">💾 LINE userId 저장</button>
      </div>
      <div class="eap-meta" id="eapLineFillMsg" style="margin-top:6px"></div>
      <div class="eap-sech">📄 문서 양식 <button class="eap-btn eap-btn-p eap-btn-sm" style="margin-left:8px" onclick="EAP.openTpl()">+ 새 양식</button></div>
      ${tplCards}` : '';
    return `
      <div class="eap-sech" style="display:flex;align-items:center;gap:8px;margin-top:0">🧭 사용자별 결재 루트 <span class="eap-meta">— 기안 시 자동 적용</span><button class="eap-btn eap-btn-p eap-btn-sm" style="margin-left:auto" onclick="EAP.openRouteBulk()">📋 일괄 설정</button></div>
      <table class="eap-table"><thead><tr><th>기안자</th><th>기본 결재선</th><th></th></tr></thead><tbody>${routeRows}</tbody></table>
      ${adminSections}`;
  }
  EAP.saveLineMap = function () {
    const map = {};
    document.querySelectorAll('#eapContainer [data-eaplm]').forEach(el => { const v = el.value.trim(); if (v) map[el.getAttribute('data-eaplm')] = v; });
    saveCfgKey('lineMap', map); toast('💾 LINE userId 저장됨');
  };
  // 직원별 LINE 연결 테스트 — 현재 입력칸의 userId 로 직접 발송, 정확한 결과 표시
  EAP.testLine = function (name) {
    if (!canManageRoutes()) { toast('권한이 없습니다'); return; }
    const el = document.querySelector('#eapContainer [data-eaplm="' + cssEsc(name) + '"]');
    const uid = el ? el.value.trim() : '';
    if (!uid) { toast(name + ' 의 LINE userId 가 비어있습니다'); return; }
    toast('💬 ' + name + ' 테스트 발송 중…');
    fetch('/api/eapproval-notify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: name, toUserId: uid, title: '[테스트] 전자결재 알림 연결 확인', event: 'request', drafter: '시스템' }),
    }).then(r => r.json()).then(res => {
      if (res && res.ok) toast('✅ ' + name + ' 발송 성공 — 본인 LINE 에서 수신 확인 부탁');
      else toast('❌ ' + name + ' 실패 (status ' + (res && res.status || '?') + '): ' + (res && (res.hint || res.detail || res.error) || ''));
    }).catch(e => toast('❌ 요청 실패: ' + e.message));
  };
  EAP.addHoliday = function () {
    if (!canManageRoutes()) { toast('권한이 없습니다'); return; }
    const v = (document.getElementById('eapHolDate') || {}).value; if (!v) { toast('날짜를 선택하세요'); return; }
    const c = getCfg(); const h = Array.isArray(c.holidays) ? c.holidays : [];
    if (!h.includes(v)) h.push(v);
    saveCfgKey('holidays', h.sort()); renderTab(); toast('📅 공휴일 추가: ' + v);
  };
  // 공휴일에서 제거: 직접 추가분이면 목록에서 삭제, 아니면(내장/자동수집) 제외목록에 추가 → 근무일 처리
  EAP.removeHoliday = function (d) {
    if (!canManageRoutes()) return;
    const c = getCfg();
    if (Array.isArray(c.holidays) && c.holidays.includes(d)) {
      c.holidays = c.holidays.filter(x => x !== d);
    } else {
      c.holidayExcludes = Array.isArray(c.holidayExcludes) ? c.holidayExcludes : [];
      if (!c.holidayExcludes.includes(d)) c.holidayExcludes.push(d);
    }
    c.updatedAt = Date.now(); setCfg(c); renderTab(); toast('🗓 근무일로 처리: ' + d);
  };
  EAP.restoreHoliday = function (d) {
    if (!canManageRoutes()) return;
    const c = getCfg(); c.holidayExcludes = (c.holidayExcludes || []).filter(x => x !== d);
    c.updatedAt = Date.now(); setCfg(c); renderTab(); toast('↩ 공휴일 복원: ' + d);
  };
  EAP.fillLineFromProfiles = async function () {
    const msg = document.getElementById('eapLineFillMsg');
    if (msg) msg.textContent = '⏳ LINE 프로필 불러오는 중…';
    try {
      const res = await fetch('/api/line-profiles');
      const data = await res.json();
      const profiles = data.profiles || {};   // { userId: displayName }
      // displayName(정규화) → userId 역매핑
      const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
      const nameToId = {};
      Object.entries(profiles).forEach(([uid, dn]) => { const k = norm(dn); if (k && !nameToId[k]) nameToId[k] = uid; });
      const users = getUsers();
      let filled = 0; const unmatched = [];
      document.querySelectorAll('#eapContainer [data-eaplm]').forEach(el => {
        const name = el.getAttribute('data-eaplm');
        if (el.value.trim()) return;  // 이미 입력된 건 보존
        let uid = nameToId[norm(name)];
        if (!uid) {  // 닉네임 매칭
          const u = users.find(u => u && u.name === name);
          if (u && Array.isArray(u.nicknames)) for (const nk of u.nicknames) { if (nameToId[norm(nk)]) { uid = nameToId[norm(nk)]; break; } }
        }
        if (!uid && norm(name).length >= 3) {
          // 부분 포함 매칭 — 표시명에 회사·직책이 붙은 경우(예: "티지테크 김용연차장" ⊃ "김용연").
          //   오매칭 방지: 직원명 3자 이상 + 그 이름을 포함하는 프로필이 정확히 1개일 때만.
          const hits = Object.entries(profiles).filter(([u, dn]) => norm(dn).includes(norm(name)));
          if (hits.length === 1) uid = hits[0][0];
        }
        if (uid) { el.value = uid; filled++; } else unmatched.push(name);
      });
      if (msg) msg.innerHTML = `✅ ${filled}명 자동 입력 (수집 ${data.count || 0}건)${unmatched.length ? ` · 미매칭: ${unmatched.map(esc).join(', ')}` : ''}<br><span style="color:#94A3B8">확인 후 <b>💾 저장</b> 을 눌러주세요. 미매칭 직원은 LINE 봇/단톡방에서 한 번 발언하면 수집됩니다.</span>`;
      toast(`📥 ${filled}명 자동 입력`);
    } catch (e) { if (msg) msg.textContent = '🔴 불러오기 실패: ' + e.message; }
  };

  // 단일 루트 편집
  let _routeUser = null, _routeLine = [];
  EAP.openRoute = function (n) {
    if (!canManageRoutes()) { toast('결재 루트 편집 권한이 없습니다'); return; }
    _routeUser = n; _routeLine = (getRoutes()[n] || []).filter(x => x && x !== n);
    renderRouteModal();
  };
  function renderRouteModal() {
    const staff = STAFF().filter(n => n !== _routeUser);
    const html = `<div class="eap-modal">
      <div class="eap-mhead"><h3>🧭 ${esc(_routeUser)} 결재 루트</h3><button class="eap-x" onclick="EAP.closeModal()">✕</button></div>
      <div class="eap-meta" style="margin-bottom:8px">순서대로 클릭</div>
      <div class="eap-picker">${staff.map(x => { const i = _routeLine.indexOf(x); return `<span class="eap-pk ${i >= 0 ? 'on' : ''}" onclick="EAP.toggleRouteStep(${J(x)})">${i >= 0 ? '<b>' + (i + 1) + '</b> ' : ''}${esc(x)}</span>`; }).join('')}</div>
      <div class="eap-meta" style="margin-top:8px">결재선: ${esc(_routeUser)}(기안)${_routeLine.length ? ' → ' + _routeLine.map(esc).join(' → ') : ' (없음)'}</div>
      <div class="eap-mactions"><button class="eap-btn eap-btn-p" style="width:100%" onclick="EAP.saveRoute()">저장</button></div>
    </div>`;
    openModal(html);
  }
  EAP.toggleRouteStep = function (x) { const i = _routeLine.indexOf(x); if (i >= 0) _routeLine.splice(i, 1); else _routeLine.push(x); renderRouteModal(); };
  EAP.saveRoute = function () { if (!canManageRoutes()) { toast('권한이 없습니다'); return; } const R = getRoutes(); R[_routeUser] = _routeLine.slice(); saveCfgKey('routes', R); EAP.closeModal(); renderTab(); toast('🧭 ' + _routeUser + ' 루트 저장'); };

  // 일괄 루트 편집
  let _bulkTargets = [], _bulkLine = [];
  EAP.openRouteBulk = function () { if (!canManageRoutes()) { toast('결재 루트 편집 권한이 없습니다'); return; } _bulkTargets = STAFF().slice(); _bulkLine = []; renderRouteBulk(); };
  function renderRouteBulk() {
    const staff = STAFF();
    const allOn = staff.every(n => _bulkTargets.includes(n));
    const html = `<div class="eap-modal wide">
      <div class="eap-mhead"><h3>📋 결재 루트 일괄 설정</h3><button class="eap-x" onclick="EAP.closeModal()">✕</button></div>
      <div class="eap-meta" style="margin-bottom:10px">선택한 직원들에게 동일 결재선을 한 번에 적용 (각 직원 라인에서 본인 자동 제외)</div>
      <div class="eap-fld"><label style="display:flex;align-items:center;gap:8px">① 적용 대상 <span class="eap-meta">${_bulkTargets.length}명</span><button type="button" class="eap-att-btn" style="margin-left:auto" onclick="EAP.bulkAll()">${allOn ? '전체 해제' : '전체 선택'}</button></label>
        <div class="eap-picker">${staff.map(n => `<span class="eap-pk ${_bulkTargets.includes(n) ? 'on' : ''}" onclick="EAP.bulkTarget(${J(n)})">${esc(n)}</span>`).join('')}</div></div>
      <div class="eap-fld"><label>② 적용할 결재선 (순서대로)</label>
        <div class="eap-picker">${staff.map(x => { const i = _bulkLine.indexOf(x); return `<span class="eap-pk ${i >= 0 ? 'on' : ''}" onclick="EAP.bulkLine(${J(x)})">${i >= 0 ? '<b>' + (i + 1) + '</b> ' : ''}${esc(x)}</span>`; }).join('')}</div>
        <div class="eap-meta" style="margin-top:8px">결재선: (각 기안자)${_bulkLine.length ? ' → ' + _bulkLine.map(esc).join(' → ') : ' (없음)'}</div></div>
      <div class="eap-mactions"><button class="eap-btn eap-btn-p" style="width:100%" onclick="EAP.saveRouteBulk()">💾 선택 ${_bulkTargets.length}명에 일괄 적용</button></div>
    </div>`;
    openModal(html);
  }
  EAP.bulkTarget = function (n) { const i = _bulkTargets.indexOf(n); if (i >= 0) _bulkTargets.splice(i, 1); else _bulkTargets.push(n); renderRouteBulk(); };
  EAP.bulkAll = function () { const staff = STAFF(); _bulkTargets = staff.every(n => _bulkTargets.includes(n)) ? [] : staff.slice(); renderRouteBulk(); };
  EAP.bulkLine = function (x) { const i = _bulkLine.indexOf(x); if (i >= 0) _bulkLine.splice(i, 1); else _bulkLine.push(x); renderRouteBulk(); };
  EAP.saveRouteBulk = function () {
    if (!canManageRoutes()) { toast('권한이 없습니다'); return; }
    if (!_bulkTargets.length) { toast('적용 대상을 선택하세요'); return; }
    const R = getRoutes(); _bulkTargets.forEach(n => { R[n] = _bulkLine.filter(x => x !== n); }); saveCfgKey('routes', R);
    EAP.closeModal(); renderTab(); toast('📋 ' + _bulkTargets.length + '명에 결재선 일괄 적용');
  };

  // 양식 편집기
  let _tplEdit = null, _tplFields = [];
  EAP.openTpl = function (id) {
    _tplEdit = id ? JSON.parse(JSON.stringify(tplById(id))) : { id: genId('t'), name: '', cat: 'gen', fields: [] };
    _tplFields = (_tplEdit.fields || []).slice();
    renderTplModal();
  };
  function renderTplModal() {
    const catOpts = Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${_tplEdit.cat === k ? 'selected' : ''}>${v.label}</option>`).join('');
    const fieldRows = _tplFields.map((f, i) => `
      <div class="eap-tplf">
        <input value="${esc(f.label)}" oninput="EAP.tplFLabel(${i},this.value)" placeholder="필드명" style="flex:1">
        <select onchange="EAP.tplFType(${i},this.value)">${FIELD_TYPES.map(([t, l]) => `<option value="${t}" ${f.type === t ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${f.type === 'select' ? `<input value="${esc(f.options || '')}" oninput="EAP.tplFOpts(${i},this.value)" placeholder="옵션,콤마구분" style="flex:1">` : ''}
        <button class="eap-btn eap-btn-rej eap-btn-sm" onclick="EAP.tplFRm(${i})">✕</button>
      </div>`).join('');
    const html = `<div class="eap-modal wide">
      <div class="eap-mhead"><h3>📄 양식 ${_tplEdit.id && tplById(_tplEdit.id) ? '수정' : '추가'}</h3><button class="eap-x" onclick="EAP.closeModal()">✕</button></div>
      <div class="eap-fld"><label>양식 이름</label><input id="eapTplName" value="${esc(_tplEdit.name)}" placeholder="예: 지출결의서"></div>
      <div class="eap-fld"><label>분류</label><select id="eapTplCat">${catOpts}</select></div>
      <div class="eap-sech">필드 <button class="eap-btn eap-btn-o eap-btn-sm" style="margin-left:8px" onclick="EAP.tplFAdd()">+ 추가</button></div>
      <div id="eapTplFields">${fieldRows || '<div class="eap-meta">필드를 추가하세요</div>'}</div>
      <div class="eap-mactions"><button class="eap-btn eap-btn-p" style="width:100%" onclick="EAP.saveTpl()">저장</button></div>
    </div>`;
    openModal(html);
  }
  EAP.tplFAdd = function () { _tplFields.push({ label: '', type: 'text' }); renderTplModal(); };
  EAP.tplFRm = function (i) { _tplFields.splice(i, 1); renderTplModal(); };
  EAP.tplFLabel = function (i, v) { _tplFields[i].label = v; };
  EAP.tplFType = function (i, v) { _tplFields[i].type = v; renderTplModal(); };
  EAP.tplFOpts = function (i, v) { _tplFields[i].options = v; };
  EAP.saveTpl = function () {
    const name = (document.getElementById('eapTplName') || {}).value.trim();
    if (!name) { toast('양식 이름을 입력하세요'); return; }
    _tplEdit.name = name;
    _tplEdit.cat = (document.getElementById('eapTplCat') || {}).value || 'gen';
    _tplEdit.fields = _tplFields.filter(f => f.label.trim());
    const tpls = getTpls(); const idx = tpls.findIndex(t => t.id === _tplEdit.id);
    if (idx >= 0) tpls[idx] = _tplEdit; else tpls.push(_tplEdit);
    saveCfgKey('tpl', tpls); EAP.closeModal(); renderTab(); toast('📄 양식 저장됨');
  };
  EAP.delTpl = function (id) {
    if (!confirm('이 양식을 삭제할까요?')) return;
    saveCfgKey('tpl', getTpls().filter(t => t.id !== id)); renderTab(); toast('삭제됨');
  };

  /* ════════════════ 자금관리 (fund) ════════════════ */
  const FUND_COS = ['인토개인', '인토법인', '네오솔루션', '세이브넷'];
  const FUND_CO_COLOR = { '인토개인': '#1D4ED8', '인토법인': '#7C3AED', '네오솔루션': '#047857', '세이브넷': '#B45309' };
  const SEED_FUND_IN = ['장비대금', '밴수익', '수리비', '재고조사', '라벨지', '프로그램사용료', '이자수익', '환입', '잡이익', '차입'];
  const SEED_FUND_OUT = ['인건비', '4대사회보험료', '장비대금', '상품(라벨지)', '수리비', '복리후생비', '임차료', '밴지원금', '세금과공과(부가세·원천세·지방세 등)', '인출금', '보험료', '기타', '차입상환'];

  function getFundMeta() {
    const c = getCfg(); const f = (c.fund && typeof c.fund === 'object') ? c.fund : {};
    return {
      cats: (f.cats && Array.isArray(f.cats.in) && Array.isArray(f.cats.out)) ? f.cats
        : { in: SEED_FUND_IN.map(n => ({ name: n, active: true })), out: SEED_FUND_OUT.map(n => ({ name: n, active: true })) },
      opening: (f.opening && typeof f.opening === 'object') ? f.opening : {},
      openingDate: f.openingDate || kstDate(),
      closings: (f.closings && typeof f.closings === 'object') ? f.closings : {},
    };
  }
  function saveFundMeta(patch) {
    const c = getCfg(); c.fund = Object.assign({}, c.fund || {}, patch); c.updatedAt = Date.now(); setCfg(c);
  }
  function ensureFundSeed() {
    const c = getCfg();
    if (c.fund && c.fund.cats && Array.isArray(c.fund.cats.in) && Array.isArray(c.fund.cats.out)) return;
    const f = Object.assign({}, c.fund || {});
    f.cats = { in: SEED_FUND_IN.map(n => ({ name: n, active: true })), out: SEED_FUND_OUT.map(n => ({ name: n, active: true })) };
    if (!f.opening) f.opening = {};
    if (!f.openingDate) f.openingDate = kstDate();
    if (!f.closings) f.closings = {};
    c.fund = f; c.updatedAt = Date.now();
    try { localStorage.setItem(CFG_LS, JSON.stringify(c)); } catch (_) {}
    schedulePush(true);
  }
  // 타임존 안전 날짜 가감 (UTC 기준 산술 — KST 브라우저에서도 어긋나지 않음)
  function fundAddDays(s, n) {
    const p = String(s || kstDate()).split('-').map(Number);
    const dt = new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1) + n * 86400000);
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }
  function fundBalAsOf(co, date) {
    const m = getFundMeta(); let b = Number(m.opening[co] || 0);
    getFundTx().forEach(t => { if (t && t.co === co && t.date >= m.openingDate && t.date <= date) b += (t.dir === 'in' ? (Number(t.amount) || 0) : -(Number(t.amount) || 0)); });
    return b;
  }
  function fundDayFlow(co, date, dir) { let s = 0; getFundTx().forEach(t => { if (t && t.co === co && t.date === date && t.dir === dir) s += (Number(t.amount) || 0); }); return s; }
  function fundTxOf(date) { return getFundTx().filter(t => t && t.date === date).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)); }
  function fundIsClosed(date) {
    const c = getFundMeta().closings[date];
    if (c == null) return false;
    if (typeof c === 'object') return ('closed' in c) ? !!c.closed : true;  // 신규:closed 플래그 / legacy object:마감
    return !!c;
  }
  function fundCatUsed(dir, name) { return getFundTx().filter(t => t && t.dir === dir && t.cat === name).length; }

  // 렌더 시그니처 (백그라운드 sync 재렌더 스킵용)
  function fundSig() {
    const tx = getFundTx(); const m = getFundMeta();
    let mt = 0; tx.forEach(t => { mt += (Number(t && t.updatedAt) || 0); });
    return [FUNDSUB, FUNDDATE, tx.length, mt, JSON.stringify(m.closings || {}).length,
      JSON.stringify(m.opening || {}), m.openingDate, JSON.stringify(m.cats || {}).length].join('|');
  }
  function fundDraftDirty() {
    const tb = document.getElementById('fundSheetBody'); if (!tb) return false;
    return [...tb.querySelectorAll('.fund-drow')].some(tr => ['rCat', 'rAmt', 'rMemo', 'rNote'].some(c => { const el = tr.querySelector('.' + c); return el && el.value; }));
  }
  function fundRenumber() { document.querySelectorAll('#fundSheetBody .fund-drow').forEach((tr, i) => { const n = tr.querySelector('.rNo'); if (n) n.textContent = i + 1; }); }
  function fundRowEmpty(tr) { return ['rCat', 'rAmt', 'rMemo', 'rNote'].every(c => { const el = tr.querySelector('.' + c); return !el || !el.value; }); }

  // 엑셀형 입력행 빌더
  function fundCatOpts(dir, sel) { const m = getFundMeta(); return '<option value="">항목 선택</option>' + (m.cats[dir] || []).filter(c => c.active).map(c => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join(''); }
  function fundCoOpts(sel) { return FUND_COS.map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join(''); }
  function fundDirOpts(dir) { return `<option value="in" ${dir === 'in' ? 'selected' : ''}>입금</option><option value="out" ${dir === 'out' ? 'selected' : ''}>출금</option>`; }
  function fundDraftRow(co, dir) {
    const k = ' onkeydown="EAP.fundCellKey(this,event)"';
    return `<tr class="fund-drow"><td class="rNo"></td>`
      + `<td><select class="rCo"${k}>${fundCoOpts(co)}</select></td>`
      + `<td><select class="rDir" onchange="EAP.fundRowDir(this)"${k}>${fundDirOpts(dir)}</select></td>`
      + `<td><select class="rCat" oninput="EAP.fundTouch(this)"${k}>${fundCatOpts(dir, '')}</select></td>`
      + `<td><input class="rAmt" inputmode="numeric" placeholder="0" oninput="EAP.fundAmt(this);EAP.fundTouch(this)"${k}></td>`
      + `<td><input class="rMemo" placeholder="통장 기록 내용" oninput="EAP.fundTouch(this)"${k}></td>`
      + `<td><input class="rNote" placeholder="비고"${k}></td>`
      + `<td style="text-align:center"><button class="eap-fund-x" onclick="EAP.fundDelRow(this)">×</button></td></tr>`;
  }

  function renderFund() {
    if (!canViewFund()) return '<div class="eap-empty">자금관리 권한이 없습니다</div>';
    if (!FUNDDATE) FUNDDATE = kstDate();
    ensureFundSeed();
    const subs = [['daily', '일일자금현황'], ['class', '분류 관리'], ['bal', '잔액 관리']];
    const chips = subs.map(([k, l]) => `<button class="eap-chip ${FUNDSUB === k ? 'on' : ''}" onclick="EAP.fundSub(${J(k)})">${l}</button>`).join('');
    const body = FUNDSUB === 'daily' ? renderFundDaily() : FUNDSUB === 'class' ? renderFundClass() : renderFundBal();
    return `<div class="eap-chips" style="margin-bottom:14px">${chips}</div>${body}`;
  }

  function renderFundDaily() {
    const date = FUNDDATE, closed = fundIsClosed(date), prev = fundAddDays(date, -1), m = getFundMeta();
    const P = {}, I = {}, O = {}, C = {}; let tP = 0, tI = 0, tO = 0, tC = 0;
    FUND_COS.forEach(co => { P[co] = fundBalAsOf(co, prev); I[co] = fundDayFlow(co, date, 'in'); O[co] = fundDayFlow(co, date, 'out'); C[co] = fundBalAsOf(co, date); tP += P[co]; tI += I[co]; tO += O[co]; tC += C[co]; });
    const head = FUND_COS.map(c => `<th style="text-align:right"><span class="fund-dot" style="background:${FUND_CO_COLOR[c]}"></span>${esc(c)}</th>`).join('') + `<th style="text-align:right" class="fund-tot">합계</th>`;
    const rl = (label, cls, src, tot, pre) => `<tr class="${cls}"><th>${label}</th>` + FUND_COS.map(c => `<td style="text-align:right">${pre || ''}${commaFmt(src[c])}</td>`).join('') + `<td style="text-align:right" class="fund-tot">${pre || ''}${commaFmt(tot)}</td></tr>`;
    const grid = `<div class="eap-tblscroll"><table class="eap-table fund-grid"><thead><tr><th>구분</th>${head}</tr></thead><tbody>`
      + rl('전일잔액', '', P, tP) + rl('입금 (+)', 'fund-in', I, tI, '+') + rl('출금 (-)', 'fund-out', O, tO, '-') + rl('당일잔액', 'fund-cur', C, tC) + `</tbody></table></div>`;

    let entry;
    if (closed) {
      entry = `<div class="eap-fund-note">🔒 ${date} 은 마감되었습니다 — 입력·삭제 잠금 (마감 해제 시 수정 가능)</div>`;
    } else if (canManageFund()) {
      const initRows = [0, 1, 2, 3].map(() => fundDraftRow(FUNDCTX.co, FUNDCTX.dir)).join('');
      entry = `<div class="fund-ctxbar"><span class="fund-lbl">회사</span><div class="fund-coradio">`
        + FUND_COS.map(c => `<label class="fund-coitem ${FUNDCTX.co === c ? 'on' : ''}"><input type="radio" name="fundCtxCo" value="${esc(c)}" ${FUNDCTX.co === c ? 'checked' : ''} onchange="EAP.fundCtxCo(this.value)"><span class="fund-dot" style="background:${FUND_CO_COLOR[c]}"></span>${esc(c)}</label>`).join('')
        + `</div>`
        + `<span class="fund-lbl">입출금</span><div class="fund-dirtog"><button class="fund-dseg fund-in ${FUNDCTX.dir === 'in' ? 'on' : ''}" onclick="EAP.fundCtxDir('in')">입금</button><button class="fund-dseg fund-out ${FUNDCTX.dir === 'out' ? 'on' : ''}" onclick="EAP.fundCtxDir('out')">출금</button></div>`
        + `<span class="eap-meta">↓ 여러 줄 입력 (회사·구분 행별 변경 가능 · ↑↓ 이동 · 마지막 줄 입력 시 새 줄 자동추가)</span></div>`
        + `<div class="eap-tblscroll"><table class="fund-sheet"><colgroup><col style="width:30px"><col style="width:110px"><col style="width:74px"><col style="width:160px"><col style="width:110px"><col><col style="width:110px"><col style="width:34px"></colgroup>`
        + `<thead><tr><th>#</th><th>회사</th><th>구분</th><th>항목(소분류)</th><th style="text-align:right">금액</th><th>내용(통장 기록)</th><th>비고</th><th></th></tr></thead>`
        + `<tbody id="fundSheetBody">${initRows}</tbody><tfoot><tr id="fundSheetFoot"></tr></tfoot></table></div>`
        + `<div class="fund-savebar"><button class="eap-btn eap-btn-p" onclick="EAP.fundSaveDraft()">저장 (내역 반영)</button><span class="eap-meta">항목+금액이 채워진 줄만 일괄 등록됩니다</span></div>`;
    } else {
      entry = `<div class="eap-fund-note">조회 전용 — 자금 입력 권한이 없습니다</div>`;
    }

    const rows = fundTxOf(date); let rIn = 0, rOut = 0;
    const list = rows.length ? rows.map(t => {
      if (t.dir === 'in') rIn += Number(t.amount) || 0; else rOut += Number(t.amount) || 0;
      return `<tr><td><span class="fund-dot" style="background:${FUND_CO_COLOR[t.co] || '#94A3B8'}"></span>${esc(t.co)}</td><td><span class="fund-tag ${t.dir}">${t.dir === 'in' ? '입금' : '출금'}</span></td><td>${esc(t.cat)}</td>`
        + `<td style="text-align:right;font-weight:800" class="${t.dir === 'in' ? 'fund-inc' : 'fund-outc'}">${t.dir === 'in' ? '+' : '-'}${commaFmt(t.amount)}</td><td>${esc(t.memo || '')}</td><td class="eap-meta">${esc(t.note || '')}</td>`
        + `<td style="text-align:center">${(closed || !canManageFund()) ? '' : `<button class="eap-fund-x" onclick="EAP.fundDel(${J(t.id)})">×</button>`}</td></tr>`;
    }).join('') : `<tr><td colspan="7" style="text-align:center;color:#94A3B8;padding:22px">이 날짜의 자금 내역이 없습니다</td></tr>`;

    const cl = m.closings[date] || {};
    const nav = `<div class="fund-toolbar"><button class="fund-nav" onclick="EAP.fundGoto(-1)">‹</button><input type="date" value="${date}" onchange="EAP.fundSetDate(this.value)"><button class="fund-nav" onclick="EAP.fundGoto(1)">›</button><button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.fundToday()">오늘</button><span style="margin-left:auto"></span>`
      + (closed ? `<span class="fund-stat closed">🔒 마감 · ${esc(cl.closedAt || '')} ${esc(cl.by || '')}</span>${canManageFund() ? `<button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.fundReopen()">마감 해제</button>` : ''}`
        : `<span class="fund-stat">진행중</span>${canManageFund() ? `<button class="eap-btn eap-btn-p eap-btn-sm" onclick="EAP.fundClose()">이 날짜 마감</button>` : ''}`)
      + `</div>`;

    return nav
      + `<div class="eap-sech">회사별 잔액 · 합계</div>` + grid
      + `<div class="eap-sech">자금 내역 입력 · 엑셀형</div>` + entry
      + `<div class="eap-sech" style="display:flex;justify-content:space-between;align-items:baseline">${date} 확정 내역 <span class="eap-meta" style="font-weight:400">입금 ${commaFmt(rIn)} · 출금 ${commaFmt(rOut)} · 순증감 ${(rIn - rOut) >= 0 ? '+' : ''}${commaFmt(rIn - rOut)}</span></div>`
      + `<div class="eap-tblscroll"><table class="eap-table fund-tx"><thead><tr><th>회사</th><th>구분</th><th>항목</th><th style="text-align:right">금액</th><th>내용</th><th>비고</th><th></th></tr></thead><tbody>${list}</tbody></table></div>`;
  }

  function renderFundClass() {
    const m = getFundMeta(), manage = canManageFund();
    const coPills = FUND_COS.map(c => `<span class="fund-pill" style="border-color:${FUND_CO_COLOR[c]}55;color:${FUND_CO_COLOR[c]}"><span class="fund-dot" style="background:${FUND_CO_COLOR[c]}"></span>${esc(c)}</span>`).join('');
    const table = (dir) => {
      const arr = m.cats[dir] || [];
      return `<div class="eap-tblscroll"><table class="eap-table"><thead><tr><th style="width:74px;text-align:center">순서</th><th>항목</th><th style="width:64px">사용</th><th style="width:86px;text-align:center">상태</th></tr></thead><tbody>`
        + arr.map((c, i) => `<tr${c.active ? '' : ' style="color:#94A3B8;background:#FAFAFA"'}>`
          + `<td style="text-align:center;white-space:nowrap">${manage ? `<button class="fund-ord" ${i === 0 ? 'disabled' : ''} onclick="EAP.fundMoveCat(${J(dir)},${J(c.name)},-1)">↑</button><button class="fund-ord" ${i === arr.length - 1 ? 'disabled' : ''} onclick="EAP.fundMoveCat(${J(dir)},${J(c.name)},1)">↓</button>` : '-'}</td>`
          + `<td>${esc(c.name)}${c.active ? '' : ' · <span style="color:#DC2626;font-weight:700">사용중지</span>'}</td>`
          + `<td class="eap-meta">${(() => { const u = fundCatUsed(dir, c.name); return u ? u + '건' : '미사용'; })()}</td>`
          + `<td style="text-align:center">${manage ? `<button class="eap-btn eap-btn-o eap-btn-sm" onclick="EAP.fundToggleCat(${J(dir)},${J(c.name)})">${c.active ? '무효화' : '재사용'}</button>` : '-'}</td></tr>`).join('')
        + `</tbody></table></div>`;
    };
    const addRow = (dir) => manage ? `<div class="fund-addrow"><input id="fundNewCat-${dir}" placeholder="새 ${dir === 'in' ? '입금' : '출금'} 항목"><button class="eap-btn eap-btn-p eap-btn-sm" onclick="EAP.fundAddCat(${J(dir)})">추가</button></div>` : '';
    return `<div class="eap-fund-note">사용된 소분류는 <b>삭제하지 않고 “무효화”</b>만 합니다 — 새 입력 목록에선 빠지지만 기존 자금 데이터는 그대로 유지됩니다. ↑↓ 로 순서 변경.</div>`
      + `<div class="eap-sech">회사 (대분류) · 고정 4개사</div><div class="fund-pills">${coPills}</div>`
      + `<div class="fund-classgrid"><div><div class="eap-sech" style="color:#047857">입금 항목 (소분류)</div>${table('in')}${addRow('in')}</div>`
      + `<div><div class="eap-sech" style="color:#B91C1C">출금 항목 (소분류)</div>${table('out')}${addRow('out')}</div></div>`;
  }

  function renderFundBal() {
    const m = getFundMeta(), manage = canManageFund(), today = kstDate();
    const rows = FUND_COS.map((c, i) => {
      const cur = fundBalAsOf(c, today);
      return `<tr><td><span class="fund-dot" style="background:${FUND_CO_COLOR[c]}"></span>${esc(c)}</td>`
        + `<td style="text-align:right">${manage ? `<input id="fundOpenBal-${i}" class="fund-balin" inputmode="numeric" value="${commaFmt(m.opening[c] || 0)}" oninput="EAP.fundAmt(this)">` : commaFmt(m.opening[c] || 0)}</td>`
        + `<td style="text-align:right;font-weight:800">${commaFmt(cur)}</td></tr>`;
    }).join('');
    const totOpen = FUND_COS.reduce((a, c) => a + (Number(m.opening[c]) || 0), 0);
    const totCur = FUND_COS.reduce((a, c) => a + fundBalAsOf(c, today), 0);
    return `<div class="eap-fund-note">🏦 <b>기초 잔액</b>은 자금 계산의 출발점 — <b>기준일의 통장 잔액</b>입니다. 평소엔 손대지 않지만 통장 실제 잔액과 어긋나면 여기서 <b>보정</b>하세요. 기준일 이후 증감은 일일 자금 내역으로 자동 반영됩니다.</div>`
      + `<div class="fund-toolbar"><span class="fund-lbl">기준일</span><input type="date" value="${m.openingDate}" ${manage ? `onchange="EAP.fundSetOpeningDate(this.value)"` : 'disabled'}><span class="eap-meta">이 날짜의 통장 잔액을 기초로 잡습니다</span></div>`
      + `<div class="eap-tblscroll"><table class="eap-table" style="max-width:660px"><thead><tr><th style="width:40%">회사</th><th style="text-align:right">기초 잔액 (통장잔액 보정)</th><th style="text-align:right">현재 잔액 (계산)</th></tr></thead><tbody>${rows}</tbody>`
      + `<tfoot><tr><th>합계</th><th style="text-align:right">${commaFmt(totOpen)}</th><th style="text-align:right;color:#2563EB">${commaFmt(totCur)}</th></tr></tfoot></table></div>`
      + (manage ? `<div class="fund-savebar"><button class="eap-btn eap-btn-p" onclick="EAP.fundSaveOpening()">기초 잔액 저장</button><span class="eap-meta">저장 시 현재 잔액이 재계산됩니다</span></div>` : '');
  }

  // ── 자금 핸들러 ──
  function fundNavGuard() { return !fundDraftDirty() || confirm('입력 중인 내역이 있습니다. 이동하면 지워집니다. 계속할까요?'); }
  EAP.fundSub = function (k) { if (!fundNavGuard()) return; FUNDSUB = k; renderTab(); };
  EAP.fundGoto = function (n) { if (!fundNavGuard()) return; FUNDDATE = fundAddDays(FUNDDATE, n); renderTab(); };
  EAP.fundSetDate = function (v) { if (!v) return; if (!fundNavGuard()) return; FUNDDATE = v; renderTab(); };
  EAP.fundToday = function () { if (!fundNavGuard()) return; FUNDDATE = kstDate(); renderTab(); };
  EAP.fundAmt = function (el) { const v = String(el.value || '').replace(/[^0-9]/g, ''); el.value = v ? Number(v).toLocaleString('ko-KR') : ''; };
  EAP.fundTouch = function (el) {
    const tb = document.getElementById('fundSheetBody'); if (!tb) return;
    const rows = [...tb.querySelectorAll('.fund-drow')]; const tr = el.closest('tr');
    if (tr === rows[rows.length - 1] && !fundRowEmpty(tr)) { tb.insertAdjacentHTML('beforeend', fundDraftRow(FUNDCTX.co, FUNDCTX.dir)); fundRenumber(); }
    EAP.fundSubtotal();
  };
  EAP.fundRowDir = function (sel) { const tr = sel.closest('tr'); tr.querySelector('.rCat').innerHTML = fundCatOpts(sel.value, ''); EAP.fundSubtotal(); };
  EAP.fundDelRow = function (btn) {
    const tr = btn.closest('tr'), tb = document.getElementById('fundSheetBody');
    if (tb.querySelectorAll('.fund-drow').length <= 1) { ['rCat', 'rAmt', 'rMemo', 'rNote'].forEach(c => { const el = tr.querySelector('.' + c); if (el) el.value = ''; }); }
    else tr.remove();
    fundRenumber(); EAP.fundSubtotal();
  };
  EAP.fundCtxCo = function (v) {
    FUNDCTX.co = v;
    document.querySelectorAll('#eap-view .fund-coradio .fund-coitem').forEach(l => { const i = l.querySelector('input'); l.classList.toggle('on', i && i.value === v); });
    document.querySelectorAll('#fundSheetBody .fund-drow').forEach(tr => { if (fundRowEmpty(tr)) tr.querySelector('.rCo').value = v; });
  };
  EAP.fundCtxDir = function (d) {
    FUNDCTX.dir = d;
    document.querySelectorAll('#eap-view .fund-dirtog .fund-dseg').forEach(b => b.classList.remove('on'));
    const on = document.querySelector('#eap-view .fund-dirtog .fund-' + d); if (on) on.classList.add('on');
    document.querySelectorAll('#fundSheetBody .fund-drow').forEach(tr => { if (fundRowEmpty(tr)) { tr.querySelector('.rDir').value = d; tr.querySelector('.rCat').innerHTML = fundCatOpts(d, ''); } });
  };
  EAP.fundSubtotal = function () {
    let i = 0, o = 0, n = 0;
    document.querySelectorAll('#fundSheetBody .fund-drow').forEach(tr => {
      const cat = tr.querySelector('.rCat').value, amt = Number((tr.querySelector('.rAmt').value || '').replace(/[^0-9]/g, '')) || 0;
      if (cat && amt) { n++; if (tr.querySelector('.rDir').value === 'in') i += amt; else o += amt; }
    });
    const f = document.getElementById('fundSheetFoot');
    if (f) f.innerHTML = `<td></td><td colspan="2" style="text-align:right">합계</td><td></td><td class="rAmt">입 ${commaFmt(i)} / 출 ${commaFmt(o)}</td><td colspan="2" class="eap-meta">저장 대상 ${n}건 · 순증감 ${(i - o) >= 0 ? '+' : ''}${commaFmt(i - o)}</td>`;
  };
  EAP.fundCellKey = function (el, ev) {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    const tr = el.closest('tr'); const mm = el.className.match(/r(Co|Dir|Cat|Amt|Memo|Note)/); if (!mm) return;
    const col = '.r' + mm[1];
    let target = ev.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
    if (ev.key === 'ArrowDown' && (!target || !target.classList.contains('fund-drow'))) {
      const tb = document.getElementById('fundSheetBody'); tb.insertAdjacentHTML('beforeend', fundDraftRow(FUNDCTX.co, FUNDCTX.dir)); fundRenumber(); target = tb.lastElementChild;
    }
    if (target && target.classList.contains('fund-drow')) { const cell = target.querySelector(col); if (cell) { cell.focus(); if (cell.select) { try { cell.select(); } catch (_) {} } } }
  };
  EAP.fundSaveDraft = function () {
    if (!canManageFund()) { toast('자금 입력 권한이 없습니다'); return; }
    if (fundIsClosed(FUNDDATE)) { toast('마감된 날짜입니다'); return; }
    const tx = getFundTx(); let n = 0; const now = Date.now(), me = ME();
    document.querySelectorAll('#fundSheetBody .fund-drow').forEach(tr => {
      const co = tr.querySelector('.rCo').value, dir = tr.querySelector('.rDir').value, cat = tr.querySelector('.rCat').value;
      const amount = Number((tr.querySelector('.rAmt').value || '').replace(/[^0-9]/g, '')) || 0;
      const memo = (tr.querySelector('.rMemo').value || '').trim(), note = (tr.querySelector('.rNote').value || '').trim();
      if (cat && amount) { tx.push({ id: genId('F'), date: FUNDDATE, co, dir, cat, amount, memo, note, by: me, createdAt: now, updatedAt: now }); n++; }
    });
    if (!n) { toast('입력된 내역이 없습니다 — 항목과 금액을 채워주세요'); return; }
    setFundTx(tx); toast(`💾 ${n}건 저장`); renderTab();
  };
  EAP.fundDel = function (id) {
    if (!canManageFund()) return;
    const tx = getFundTx(); const t = tx.find(x => x.id === id); if (!t) return;
    if (fundIsClosed(t.date)) { toast('마감된 날짜는 삭제할 수 없습니다'); return; }
    addDeleted(id); _pendingTombs.push({ id, deletedAt: new Date().toISOString(), reason: 'fund-del' });
    setFundTx(tx.filter(x => x.id !== id)); toast('삭제됨'); renderTab();
  };
  EAP.fundClose = function () {
    if (!canManageFund() || fundIsClosed(FUNDDATE)) return;
    const bal = {}; FUND_COS.forEach(c => bal[c] = fundBalAsOf(c, FUNDDATE));
    const closings = Object.assign({}, getFundMeta().closings);
    closings[FUNDDATE] = { closed: true, at: Date.now(), by: ME(), closedAt: kstNow(), balances: bal };
    saveFundMeta({ closings });
    try { if (EAP._pushNow) EAP._pushNow(true); } catch (_) {}   // 즉시 push
    toast('🔒 마감 완료'); renderTab();
  };
  EAP.fundReopen = function () {
    if (!canManageFund() || !fundIsClosed(FUNDDATE)) return;
    if (!confirm(FUNDDATE + ' 마감을 해제할까요?')) return;
    // 해제도 타임스탬프(at) 기록 → _mergeFundClosings 가 최근 액션(해제)을 우선 → KV stale·다기기·
    //   재푸시에도 마감으로 안 돌아감. (delete/null 은 additive 머지로 전파 안 돼 재잠금되던 문제 해결)
    const closings = Object.assign({}, getFundMeta().closings);
    closings[FUNDDATE] = { closed: false, at: Date.now(), by: ME(), reopenedAt: kstNow() };
    saveFundMeta({ closings });
    try { if (EAP._pushNow) EAP._pushNow(true); } catch (_) {}  // 즉시 config push
    toast('마감 해제'); renderTab();
  };
  EAP.fundAddCat = function (dir) {
    if (!canManageFund()) return;
    const el = document.getElementById('fundNewCat-' + dir); const nm = (el && el.value || '').trim(); if (!nm) return;
    const m = getFundMeta(); const cats = { in: (m.cats.in || []).slice(), out: (m.cats.out || []).slice() };
    if (cats[dir].some(c => c.name === nm)) { toast('이미 있는 항목입니다'); return; }
    cats[dir].push({ name: nm, active: true }); saveFundMeta({ cats }); renderTab(); toast('항목 추가');
  };
  EAP.fundToggleCat = function (dir, name) {
    if (!canManageFund()) return;
    const m = getFundMeta(); const cats = { in: (m.cats.in || []).map(c => Object.assign({}, c)), out: (m.cats.out || []).map(c => Object.assign({}, c)) };
    const c = cats[dir].find(x => x.name === name); if (c) { c.active = !c.active; saveFundMeta({ cats }); renderTab(); }
  };
  EAP.fundMoveCat = function (dir, name, delta) {
    if (!canManageFund()) return;
    const m = getFundMeta(); const cats = { in: (m.cats.in || []).map(c => Object.assign({}, c)), out: (m.cats.out || []).map(c => Object.assign({}, c)) };
    const arr = cats[dir]; const i = arr.findIndex(c => c.name === name); const j = i + delta;
    if (i < 0 || j < 0 || j >= arr.length) return;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t; saveFundMeta({ cats }); renderTab();
  };
  EAP.fundSetOpeningDate = function (v) { if (!canManageFund() || !v) return; saveFundMeta({ openingDate: v }); renderTab(); };
  EAP.fundSaveOpening = function () {
    if (!canManageFund()) return;
    const opening = Object.assign({}, getFundMeta().opening);
    FUND_COS.forEach((c, i) => { const el = document.getElementById('fundOpenBal-' + i); if (el) opening[c] = Number((el.value || '').replace(/[^0-9-]/g, '')) || 0; });
    saveFundMeta({ opening }); toast('🏦 기초 잔액 저장'); renderTab();
  };

  /* ════════════════ 모달 호스트 ════════════════ */
  function openModal(html) {
    const host = document.getElementById('eapModalHost');
    if (!host) return;
    const ov = document.createElement('div');
    ov.className = 'eap-ov show';
    ov.innerHTML = html;
    // 바깥(backdrop) 클릭으로는 닫지 않음 — ✕ 버튼으로만 닫기 (작성 중 실수 방지)
    host.innerHTML = '';
    host.appendChild(ov);
  }
  EAP.closeModal = function () {
    const host = document.getElementById('eapModalHost');
    if (host) { const lb = document.getElementById('eapLb'); host.innerHTML = ''; if (lb) lb.remove(); }
  };

  /* ════════════════ 스타일 주입 ════════════════ */
  function injectStyle() {
    if (document.getElementById('eap-style')) return;
    const s = document.createElement('style');
    s.id = 'eap-style';
    s.textContent = EAP_CSS;
    document.head.appendChild(s);
  }

  const EAP_CSS = `
  #screen-eapproval .eap-root{max-width:980px;margin:0 auto}
  #screen-eapproval .eap-tabbar{display:flex;gap:8px;margin-bottom:14px}
  #screen-eapproval .eap-tab{flex:1;padding:11px;border:1.5px solid #E2E8F0;background:#fff;border-radius:11px;font-weight:800;cursor:pointer;font-size:13.5px;color:#475569}
  #screen-eapproval .eap-tab.on{background:#2563EB;border-color:#2563EB;color:#fff}
  #screen-eapproval .eap-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  #screen-eapproval .eap-bar2{display:flex;align-items:center;gap:10px;margin:10px 0}
  #screen-eapproval .eap-chips{display:flex;gap:7px;flex-wrap:wrap}
  #screen-eapproval .eap-chip{padding:7px 13px;border-radius:20px;border:1.5px solid #E2E8F0;background:#fff;font-weight:700;cursor:pointer;font-size:12.5px;color:#475569}
  #screen-eapproval .eap-chip.on{background:#EFF6FF;border-color:#2563EB;color:#2563EB}
  #screen-eapproval .eap-chip .n{display:inline-block;background:#DC2626;color:#fff;font-size:10px;border-radius:10px;padding:0 5px;margin-left:4px}
  #screen-eapproval .eap-card{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:13px 15px;margin-bottom:10px;cursor:pointer}
  #screen-eapproval .eap-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.07)}
  #screen-eapproval .eap-ctop{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px}
  #screen-eapproval .eap-title{font-size:14.5px;font-weight:800;color:#0F172A;margin-bottom:3px}
  #screen-eapproval .eap-meta{font-size:11.5px;color:#64748B}
  #screen-eapproval .eap-kind{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:6px}
  #screen-eapproval .k-pay{background:#FEF3C7;color:#92400E}
  #screen-eapproval .k-buy{background:#DBEAFE;color:#1E40AF}
  #screen-eapproval .k-leave{background:#DCFCE7;color:#166534}
  #screen-eapproval .k-gen{background:#F3E8FF;color:#7E22CE}
  #screen-eapproval .eap-mine{font-size:10.5px;font-weight:800;background:#FEE2E2;color:#991B1B;padding:2px 8px;border-radius:6px}
  #screen-eapproval .eap-ccflag{font-size:10.5px;font-weight:700;background:#F1F5F9;color:#475569;padding:2px 8px;border-radius:6px}
  #screen-eapproval .eap-st{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:6px;margin-left:auto}
  #screen-eapproval .s-wait{background:#FEF3C7;color:#92400E}
  #screen-eapproval .s-ok{background:#DCFCE7;color:#166534}
  #screen-eapproval .s-rej{background:#FEE2E2;color:#991B1B}
  #screen-eapproval .s-rec{background:#E2E8F0;color:#475569}
  #screen-eapproval .eap-exec{font-size:10.5px;font-weight:800;border-radius:6px;padding:2px 8px}
  #screen-eapproval .eap-exec.done{background:#DCFCE7;color:#166534}
  #screen-eapproval .eap-exec.wait{background:#FEF3C7;color:#92400E}
  #screen-eapproval .eap-line{display:flex;align-items:center;gap:4px;margin-top:9px;flex-wrap:wrap}
  #screen-eapproval .eap-step{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:16px;background:#F1F5F9;color:#64748B}
  #screen-eapproval .eap-step.done{background:#DCFCE7;color:#166534}
  #screen-eapproval .eap-step.cur{background:#FEF3C7;color:#92400E;box-shadow:0 0 0 2px #FDE68A}
  #screen-eapproval .eap-step.rej{background:#FEE2E2;color:#991B1B}
  #screen-eapproval .eap-role{font-size:9px;opacity:.7;margin-left:2px}
  #screen-eapproval .eap-arr{color:#CBD5E1;font-size:11px}
  #screen-eapproval .eap-empty{text-align:center;color:#94A3B8;padding:40px 0;font-size:13px}
  #screen-eapproval .eap-btn{border:none;border-radius:10px;padding:10px 15px;font-size:13px;font-weight:800;cursor:pointer}
  #screen-eapproval .eap-btn-p{background:#2563EB;color:#fff}
  #screen-eapproval .eap-btn-o{background:#fff;color:#334155;border:1.5px solid #CBD5E1}
  #screen-eapproval .eap-btn-ok{background:#16A34A;color:#fff}
  #screen-eapproval .eap-btn-rej{background:#fff;color:#DC2626;border:1.5px solid #FCA5A5}
  #screen-eapproval .eap-btn-sm{padding:6px 11px;font-size:11.5px;border-radius:8px}
  #screen-eapproval .eap-table{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:10px}
  #screen-eapproval .eap-table th{background:#F1F5F9;border:1px solid #E2E8F0;padding:7px 9px;text-align:left;font-weight:800;color:#475569}
  #screen-eapproval .eap-table td{border:1px solid #E2E8F0;padding:7px 9px}
  #screen-eapproval .eap-mini{width:100%;border:1px solid #CBD5E1;border-radius:6px;padding:5px 8px;font-size:12px}
  #screen-eapproval .eap-lvcards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:6px}
  #screen-eapproval .eap-lv{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:14px;text-align:center}
  #screen-eapproval .eap-lv .v{font-size:26px;font-weight:900}
  #screen-eapproval .eap-lv .l{font-size:11.5px;color:#64748B;font-weight:700;margin-top:3px}
  #screen-eapproval .eap-prog{flex:1;height:9px;background:#E2E8F0;border-radius:6px;overflow:hidden}
  #screen-eapproval .eap-prog>i{display:block;height:100%;background:linear-gradient(90deg,#22C55E,#16A34A)}
  #screen-eapproval .eap-dash{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
  #screen-eapproval .eap-dcard{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:13px}
  #screen-eapproval .eap-dcard .dl{font-size:11px;color:#64748B;font-weight:700}
  #screen-eapproval .eap-dcard .dv{font-size:22px;font-weight:900;margin-top:3px}
  #screen-eapproval .eap-sch-item{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:9px 12px;margin-bottom:7px}
  #screen-eapproval .eap-sch-item .d{font-size:12px;font-weight:800;color:#334155;min-width:54px}
  #screen-eapproval .eap-sch-item .ic{font-size:16px}
  #screen-eapproval .eap-sch-bday{border-left:4px solid #EC4899}
  #screen-eapproval .eap-sch-leave{border-left:4px solid #16A34A}
  #screen-eapproval .eap-lunar{font-size:10px;font-weight:800;background:#FCE7F3;color:#9D174D;border-radius:5px;padding:1px 6px}
  #screen-eapproval .eap-solar{font-size:10px;font-weight:800;background:#DBEAFE;color:#1E40AF;border-radius:5px;padding:1px 6px}
  #screen-eapproval .eap-dash{ }
  @media(max-width:600px){#screen-eapproval .eap-dash{grid-template-columns:repeat(2,1fr)}}
  #screen-eapproval .eap-sech{font-size:12px;font-weight:800;color:#64748B;margin:16px 0 8px;letter-spacing:.3px}
  #screen-eapproval .eap-dash, #screen-eapproval .eap-dash *{}
  /* docform */
  #screen-eapproval .eap-docform, .eap-ov .eap-docform{border:1px solid #CBD5E1;border-radius:10px;padding:14px;background:#fff;margin-bottom:6px}
  .eap-ov .eap-docform-title{text-align:center;font-size:19px;font-weight:900;letter-spacing:5px;color:#111827;margin:2px 0 12px}
  .eap-ov .eap-tblwrap{border:2px solid #334155;border-radius:6px;overflow:hidden}
  .eap-ov .eap-tbl{width:100%;border-collapse:collapse;border:1px solid #475569;table-layout:fixed;background:#fff}
  .eap-ov .eap-tbl th{background:#E8EDF3;border:1px solid #475569;padding:9px 8px;font-size:12.5px;font-weight:800;text-align:center;color:#1F2937;word-break:keep-all;vertical-align:middle}
  .eap-ov .eap-tbl td{border:1px solid #475569;padding:0;vertical-align:middle}
  .eap-ov .eap-tbl td input,.eap-ov .eap-tbl td select,.eap-ov .eap-tbl td textarea{display:block;width:100%;height:100%;border:none;background:transparent;font-size:13.5px;outline:none;padding:9px 8px;color:#111827;box-sizing:border-box;font-family:inherit}
  .eap-ov .eap-tbl td input:focus,.eap-ov .eap-tbl td select:focus,.eap-ov .eap-tbl td textarea:focus{background:#FFFBEB;box-shadow:inset 0 0 0 2px #FCD34D}
  .eap-ov .eap-tbl td textarea{min-height:56px;resize:vertical;line-height:1.5}
  .eap-ov .eap-tbl td.val{white-space:pre-wrap;font-size:13.5px;color:#111827;padding:9px 8px}
  .eap-ov .eap-dash{font-size:13px;color:#CBD5E1}
  #screen-eapproval .eap-dash{ }
  /* modal */
  .eap-ov{position:fixed;inset:0;background:rgba(15,23,42,.55);display:none;align-items:flex-start;justify-content:center;z-index:9000;overflow:auto;padding:30px 14px}
  .eap-ov.show{display:flex}
  .eap-ov .eap-modal{background:#fff;width:100%;max-width:560px;border-radius:16px;padding:18px;margin:auto}
  .eap-ov .eap-modal.wide{max-width:860px}
  .eap-ov .eap-mhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;position:sticky;top:-18px;background:#fff;padding-top:4px;z-index:2}
  .eap-ov .eap-mhead h3{margin:0;font-size:16px;font-weight:900;color:#0F172A}
  .eap-ov .eap-x{border:none;background:#F1F5F9;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:15px;color:#475569;font-weight:900}
  .eap-ov .eap-fld{margin-bottom:12px}
  .eap-ov .eap-fld label{display:block;font-size:11.5px;font-weight:800;color:#64748B;margin-bottom:5px}
  .eap-ov .eap-fld input,.eap-ov .eap-fld select,.eap-ov .eap-fld textarea,.eap-ov #eapTitle,.eap-ov select{width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:9px;font-size:13.5px;background:#fff;box-sizing:border-box;font-family:inherit}
  .eap-ov .eap-fld-ta{width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:9px;font-size:13px;min-height:54px;box-sizing:border-box;margin-bottom:8px;font-family:inherit}
  .eap-ov .eap-picker{display:flex;flex-wrap:wrap;gap:6px}
  .eap-ov .eap-pk{padding:7px 11px;border-radius:18px;border:1.5px solid #CBD5E1;background:#fff;font-size:12px;font-weight:700;color:#475569;cursor:pointer}
  .eap-ov .eap-pk.on{background:#2563EB;border-color:#2563EB;color:#fff}
  .eap-ov .eap-att-btn{padding:5px 10px;border:1px solid #CBD5E1;background:#fff;border-radius:7px;font-size:11.5px;font-weight:700;color:#475569;cursor:pointer}
  .eap-ov .eap-att-zone{border:1.5px dashed #CBD5E1;border-radius:10px;padding:12px;background:#F8FAFC;text-align:center;cursor:pointer;font-size:12.5px;color:#64748B;font-weight:700}
  .eap-ov .eap-att-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
  .eap-ov .eap-att-item{border:1px solid #E2E8F0;border-radius:9px;background:#fff;padding:6px 9px;font-size:11.5px;font-weight:700;color:#475569;display:flex;align-items:center;gap:6px}
  .eap-ov .eap-att-item img{width:38px;height:38px;object-fit:cover;border-radius:6px}
  .eap-ov .eap-att-item .x{cursor:pointer;color:#DC2626;font-weight:900}
  .eap-ov .eap-att-imgs{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
  .eap-ov .eap-att-pv{max-width:160px;max-height:160px;border:1px solid #E2E8F0;border-radius:9px;cursor:zoom-in}
  .eap-ov .eap-att-thumb{font-size:12px;color:#475569;padding:4px 0}
  .eap-ov .eap-sech{font-size:12px;font-weight:800;color:#64748B;margin:14px 0 8px}
  .eap-ov .eap-execbox{border-radius:10px;padding:11px 13px;font-size:12.5px;font-weight:700}
  .eap-ov .eap-execbox.done{background:#F0FDF4;border:1px solid #BBF7D0;color:#166534}
  .eap-ov .eap-execbox.wait{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E}
  .eap-ov .eap-actrow{display:flex;gap:8px}
  .eap-ov .eap-actrow .eap-btn{flex:1}
  .eap-ov .eap-mactions{margin-top:14px}
  .eap-ov .eap-hist{font-size:12px;padding:6px 0;border-bottom:1px solid #F1F5F9}
  .eap-ov .eap-hact{font-weight:800;color:#16A34A;font-size:11px}
  .eap-ov .eap-hact.rej{color:#DC2626}
  .eap-ov .eap-hts{color:#94A3B8;font-size:11px;margin-left:4px}
  .eap-ov .eap-hop{color:#475569;font-size:11.5px;margin-top:2px;padding-left:8px;border-left:2px solid #FCA5A5}
  .eap-ov .eap-linecard{background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:11px;margin-top:10px}
  .eap-ov .eap-lh{font-size:12px;font-weight:800;color:#166534}
  .eap-ov .eap-linkrow{display:flex;gap:6px;align-items:center;margin-top:6px}
  .eap-ov .eap-linkbox{background:#F3F4F6;padding:3px 7px;border-radius:5px;font-family:monospace;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .eap-ov .eap-tplf{display:flex;gap:6px;align-items:center;margin-bottom:7px}
  .eap-ov .eap-tplf input,.eap-ov .eap-tplf select{padding:7px;font-size:12.5px}
  .eap-ov .eap-dash{font-size:13px;color:#CBD5E1}
  .eap-ov .eap-meta{font-size:11.5px;color:#64748B}
  .eap-dash{}
  .eap-ov b{font-weight:800}
  /* lightbox */
  .eap-lb{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9500;display:none;align-items:center;justify-content:center;overflow:auto;padding:30px}
  .eap-lb.show{display:flex}
  .eap-lb img{max-width:96vw;max-height:92vh;border-radius:6px;cursor:zoom-in}
  .eap-lb img.zoom{max-width:none;max-height:none;cursor:zoom-out}
  .eap-lb-x{position:fixed;top:16px;right:18px;background:rgba(255,255,255,.16);color:#fff;border:1.5px solid rgba(255,255,255,.5);border-radius:24px;padding:8px 16px;font-size:13px;font-weight:800;cursor:pointer}
  #screen-eapproval .eap-dash *{}
  #screen-eapproval span.eap-dash, .eap-ov span.eap-dash{color:#CBD5E1;font-size:inherit}
  /* 자금관리 */
  #screen-eapproval .eap-tblscroll{overflow-x:auto}
  #screen-eapproval .fund-dot{width:8px;height:8px;border-radius:2px;display:inline-block;vertical-align:middle;margin-right:5px}
  #screen-eapproval .fund-grid td,#screen-eapproval .fund-grid th{white-space:nowrap;font-variant-numeric:tabular-nums}
  #screen-eapproval .fund-grid tbody th{background:#F8FAFC;color:#475569}
  #screen-eapproval .fund-grid tr.fund-in td,#screen-eapproval .fund-grid tr.fund-in th{color:#047857}
  #screen-eapproval .fund-grid tr.fund-out td,#screen-eapproval .fund-grid tr.fund-out th{color:#B91C1C}
  #screen-eapproval .fund-grid tr.fund-cur th,#screen-eapproval .fund-grid tr.fund-cur td{font-weight:900;color:#0F172A;background:#F1F5F9}
  #screen-eapproval .fund-grid .fund-tot{background:#EEF2FF;font-weight:800}
  #screen-eapproval .fund-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  #screen-eapproval .fund-toolbar input[type=date]{padding:6px 9px;border:1px solid #CBD5E1;border-radius:7px;font-size:13px;font-family:inherit}
  #screen-eapproval .fund-nav{border:1px solid #CBD5E1;background:#fff;border-radius:7px;width:30px;height:32px;font-size:15px;cursor:pointer}
  #screen-eapproval .fund-lbl{font-size:11.5px;font-weight:800;color:#64748B}
  #screen-eapproval .fund-stat{font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:6px;border:1px solid #CBD5E1;color:#64748B}
  #screen-eapproval .fund-stat.closed{color:#B91C1C;border-color:#FCA5A5;background:#FEF2F2}
  #screen-eapproval .fund-ctxbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:8px}
  #screen-eapproval .fund-ctxbar select{padding:6px 9px;border:1px solid #CBD5E1;border-radius:7px;font-size:13px;font-family:inherit}
  #screen-eapproval .fund-coradio{display:inline-flex;flex-wrap:wrap;gap:6px}
  #screen-eapproval .fund-coitem{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border:1px solid #CBD5E1;border-radius:7px;font-size:12.5px;font-weight:700;color:#475569;cursor:pointer;background:#fff;user-select:none}
  #screen-eapproval .fund-coitem input{margin:0;cursor:pointer;accent-color:#2563EB}
  #screen-eapproval .fund-coitem.on{border-color:#2563EB;background:#EFF6FF;color:#1D4ED8}
  #screen-eapproval .fund-dirtog{display:flex;border:1px solid #CBD5E1;border-radius:7px;overflow:hidden}
  #screen-eapproval .fund-dseg{border:none;background:#fff;padding:6px 15px;font-size:12.5px;font-weight:800;color:#94A3B8;cursor:pointer}
  #screen-eapproval .fund-dseg.fund-in.on{background:#047857;color:#fff}
  #screen-eapproval .fund-dseg.fund-out.on{background:#B91C1C;color:#fff}
  #screen-eapproval .fund-sheet{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed;margin-bottom:8px;min-width:720px}
  #screen-eapproval .fund-sheet th{background:#F1F5F9;border:1px solid #E2E8F0;padding:7px 8px;text-align:left;font-weight:800;color:#475569}
  #screen-eapproval .fund-sheet td{border:1px solid #E2E8F0;padding:0}
  #screen-eapproval .fund-sheet select,#screen-eapproval .fund-sheet input{border:none;width:100%;padding:7px 8px;font-size:12.5px;font-family:inherit;background:#fff;color:#0F172A;box-sizing:border-box}
  #screen-eapproval .fund-sheet select:focus,#screen-eapproval .fund-sheet input:focus{outline:none;background:#FFFBEB;box-shadow:inset 0 0 0 2px #FCD34D}
  #screen-eapproval .fund-sheet .rAmt{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
  #screen-eapproval .fund-sheet .rNo{text-align:center;color:#94A3B8;font-size:11px}
  #screen-eapproval .fund-sheet tfoot td{background:#F1F5F9;font-weight:800;padding:7px 8px;font-variant-numeric:tabular-nums}
  #screen-eapproval .eap-fund-x{border:none;background:none;color:#DC2626;font-weight:900;font-size:15px;cursor:pointer;line-height:1}
  #screen-eapproval .fund-savebar{display:flex;align-items:center;gap:10px;margin:8px 0 4px;flex-wrap:wrap}
  #screen-eapproval .fund-tx td{font-size:12px}
  #screen-eapproval .fund-tx .fund-inc{color:#047857}
  #screen-eapproval .fund-tx .fund-outc{color:#B91C1C}
  #screen-eapproval .fund-tag{font-size:10px;font-weight:800;padding:1px 7px;border:1px solid;border-radius:4px}
  #screen-eapproval .fund-tag.in{color:#047857;border-color:#A7F3D0}
  #screen-eapproval .fund-tag.out{color:#B91C1C;border-color:#FCA5A5}
  #screen-eapproval .eap-fund-note{border:1px solid #CBD5E1;border-left:3px solid #2563EB;background:#F8FAFC;padding:9px 12px;font-size:12px;color:#475569;margin-bottom:12px;border-radius:0 7px 7px 0}
  #screen-eapproval .fund-classgrid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:680px){#screen-eapproval .fund-classgrid{grid-template-columns:1fr}}
  #screen-eapproval .fund-pills .fund-pill{font-size:12px;font-weight:700;padding:4px 10px;border:1px solid #CBD5E1;border-radius:6px;margin-right:6px;display:inline-block}
  #screen-eapproval .fund-ord{border:1px solid #CBD5E1;background:#fff;border-radius:4px;width:22px;height:22px;font-size:11px;cursor:pointer;margin:0 1px;padding:0;color:#334155}
  #screen-eapproval .fund-ord:disabled{opacity:.3;cursor:default}
  #screen-eapproval .fund-addrow{display:flex;margin-top:8px;border:1px solid #CBD5E1;border-radius:7px;overflow:hidden;max-width:360px}
  #screen-eapproval .fund-addrow input{flex:1;border:none;padding:8px 10px;font-size:13px;font-family:inherit}
  #screen-eapproval .fund-addrow input:focus{outline:none;background:#F8FAFC}
  #screen-eapproval .fund-balin{width:100%;max-width:220px;border:1px solid #CBD5E1;border-radius:6px;padding:6px 9px;font-size:13px;font-family:inherit;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;box-sizing:border-box}
  #screen-eapproval .fund-balin:focus{outline:none;background:#FFFBEB;box-shadow:inset 0 0 0 2px #FCD34D}
  /* ── 배경 제거(투명) + 촘촘 업무형 레이아웃 (2026-07-06) ── */
  #screen-eapproval{background:transparent;padding:14px 18px 44px}
  #screen-eapproval .eap-root{max-width:1040px}
  /* 탭: 언더라인형 컴팩트 (박스 → 밑줄) */
  #screen-eapproval .eap-tabbar{gap:2px;margin-bottom:12px;border-bottom:1px solid #E5E7EB}
  #screen-eapproval .eap-tab{flex:0 0 auto;padding:8px 15px;border:none;background:none;border-radius:0;border-bottom:2px solid transparent;font-size:13px;color:#64748B;margin-bottom:-1px}
  #screen-eapproval .eap-tab.on{background:none;color:#2563EB;border-bottom-color:#2563EB}
  #screen-eapproval .eap-tab:not(.on):hover{color:#0F172A}
  /* 칩·섹션 촘촘 */
  #screen-eapproval .eap-chips{gap:6px}
  #screen-eapproval .eap-chip{padding:5px 11px;font-size:12px}
  #screen-eapproval .eap-bar{margin-bottom:10px}
  #screen-eapproval .eap-sech{margin:13px 0 6px}
  /* 카드 촘촘 */
  #screen-eapproval .eap-card{padding:9px 12px;margin-bottom:7px;border-radius:9px}
  #screen-eapproval .eap-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
  #screen-eapproval .eap-ctop{gap:6px;margin-bottom:5px}
  #screen-eapproval .eap-title{font-size:13.5px;margin-bottom:2px}
  #screen-eapproval .eap-line{margin-top:6px;gap:3px}
  #screen-eapproval .eap-step{padding:2px 8px;font-size:10.5px}
  /* 버튼 촘촘 */
  #screen-eapproval .eap-btn{padding:8px 13px;font-size:12.5px;border-radius:8px}
  #screen-eapproval .eap-btn-sm{padding:5px 10px;font-size:11.5px}
  /* 대시보드/연차 카드 촘촘 */
  #screen-eapproval .eap-dash{gap:8px;margin-bottom:10px}
  #screen-eapproval .eap-dcard{padding:10px 12px}
  #screen-eapproval .eap-dcard .dv{font-size:19px}
  #screen-eapproval .eap-lvcards{gap:8px;margin-bottom:4px}
  #screen-eapproval .eap-lv{padding:11px}
  #screen-eapproval .eap-lv .v{font-size:22px}
  #screen-eapproval .eap-sch-item{padding:7px 11px;margin-bottom:6px}
  /* 자금 툴바/입력 촘촘 + 날짜폭 고정 */
  #screen-eapproval .fund-toolbar{gap:6px;margin-bottom:10px}
  #screen-eapproval .fund-toolbar input[type=date]{width:140px;padding:5px 8px}
  #screen-eapproval .fund-nav{width:28px;height:30px;font-size:14px}
  #screen-eapproval .fund-ctxbar{gap:7px;margin-bottom:7px}
  #screen-eapproval .eap-fund-note{padding:7px 11px;margin-bottom:10px}
  #screen-eapproval .fund-savebar{margin:7px 0 4px}
  /* 표 헤더 톤 (흰 배경 조화) */
  #screen-eapproval .eap-table th{background:#F8FAFC}
  #screen-eapproval .eap-table td{padding:6px 9px}
  /* ── 자금관리 배경 모두 흰색 (2026-07-06) ── */
  #screen-eapproval{background:#fff;min-height:calc(100vh - 56px)}
  #screen-eapproval .eap-table th{background:#fff}
  #screen-eapproval .fund-grid tbody th{background:#fff}
  #screen-eapproval .fund-grid tr.fund-cur th,#screen-eapproval .fund-grid tr.fund-cur td{background:#fff}
  #screen-eapproval .fund-grid .fund-tot{background:#fff}
  #screen-eapproval .fund-sheet th{background:#fff}
  #screen-eapproval .fund-sheet tfoot td{background:#fff}
  #screen-eapproval .eap-fund-note{background:#fff}
  `;

})();
