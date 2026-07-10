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
   * 모바일 Google 로그인 — PC index.html 의 GIS 흐름 이식.
   *   ns_auth / ns_users / ns_allowed_emails / google_client_id 는
   *   PC 와 동일 origin localStorage 라 PC 로그인과 완전 호환.
   * ───────────────────────────────────────────────────────── */
  const _ADMIN_EMAILS = ['zoolex@gmail.com'];

  function _getGoogleClientId() {
    return localStorage.getItem('google_client_id') || '';
  }
  function _getAllowedEmails() {
    try { return JSON.parse(localStorage.getItem('ns_allowed_emails') || '[]'); } catch { return []; }
  }
  function _isEmailAllowed(email) {
    const e = String(email || '').toLowerCase();
    if (_ADMIN_EMAILS.includes(e)) return true;
    return _getAllowedEmails().map(x => String(x).toLowerCase()).includes(e);
  }
  function _decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      const decoded = decodeURIComponent(json.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(decoded);
    } catch (e) { return null; }
  }
  // /api/whitelist GET → google_client_id + 화이트리스트 + 사용자 동기화 (PC pullCloudWhitelist 이식)
  async function _pullAuthConfig() {
    try {
      const res = await fetch('/api/whitelist', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.googleClientId && !_getGoogleClientId()) {
        try { localStorage.setItem('google_client_id', String(data.googleClientId).trim()); } catch (_) {}
      }
      const remoteEmails = Array.isArray(data.emails) ? data.emails : [];
      const local = _getAllowedEmails().map(x => String(x).toLowerCase());
      const all = Array.from(new Set([...local, ...remoteEmails.map(x => String(x).toLowerCase())]));
      try { localStorage.setItem('ns_allowed_emails', JSON.stringify(all)); } catch (_) {}
      const remoteUsers = Array.isArray(data.users) ? data.users : [];
      if (remoteUsers.length) {
        const users = getUsers();
        const byEmail = new Map(users.map(u => [String(u.email || u.id || '').toLowerCase(), u]));
        remoteUsers.forEach(ru => {
          const key = String(ru.email || '').toLowerCase();
          if (!key) return;
          const prefix = key.split('@')[0];   // 이메일 앞부분(임시 표시이름 sentinel)
          const ex = byEmail.get(key);
          if (ex) {
            // 클라우드 이름이 정본 — 비었거나 '이메일 앞부분'으로 저장된 임시 이름이면 교정
            //   (zoolex@gmail.com 이 이름 없는 로그인/이메일폴백으로 'zoolex' 로 굳던 버그 fix)
            if (ru.name && (!ex.name || ex.name === prefix)) ex.name = ru.name;
            if (!ex.title) ex.title = ru.title;
          } else {
            users.push({ id: ru.email, email: ru.email, name: ru.name, title: ru.title, role: ru.role || 'staff', provider: 'google' });
          }
        });
        try { localStorage.setItem('ns_users', JSON.stringify(users)); } catch (_) {}
        // ns_auth 표시이름도 교정 — 이메일 앞부분으로 저장돼 있으면 정본 이름으로
        try {
          const a = JSON.parse(localStorage.getItem('ns_auth') || 'null');
          if (a && a.email) {
            const k = String(a.email).toLowerCase(), pfx = k.split('@')[0];
            const rec = users.find(u => String(u.email || u.id || '').toLowerCase() === k);
            if (rec && rec.name && (!a.name || a.name === pfx)) { a.name = rec.name; localStorage.setItem('ns_auth', JSON.stringify(a)); }
          }
        } catch (_) {}
      }
      return data;
    } catch (e) { console.warn('[_pullAuthConfig]', e); return null; }
  }
  // Google 프로필로 로그인 — ns_auth + ns_users 기록. { ok, reason, name, role }
  function _loginWithGoogleProfile(profile) {
    const email = String(profile && profile.email || '').toLowerCase();
    const name = (profile && profile.name) || (email ? email.split('@')[0] : '');
    const picture = (profile && profile.picture) || '';
    if (!email) return { ok: false, reason: 'no_email' };
    if (!_isEmailAllowed(email)) return { ok: false, reason: 'not_allowed', email };
    const role = _ADMIN_EMAILS.includes(email) ? 'admin' : 'staff';
    const users = getUsers();
    let u = users.find(x => String(x.id || x.email || '').toLowerCase() === email);
    if (!u) {
      u = { id: email, email, name, role, picture, provider: 'google', createdAt: Date.now() };
      users.push(u);
    } else {
      u.name = u.name || name;
      u.role = role;
      u.picture = picture || u.picture || '';
      u.provider = 'google';
    }
    try { localStorage.setItem('ns_users', JSON.stringify(users)); } catch (_) {}
    try { localStorage.setItem('ns_auth', JSON.stringify({ loggedIn: true, id: email, email, name: u.name, role, picture: u.picture || '' })); } catch (_) {}
    return { ok: true, name: u.name, role };
  }
  function _mobileLogout() {
    try { localStorage.removeItem('ns_auth'); } catch (_) {}
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (_) {}
  }

  // 전체 화면 로그인 게이트 — 미로그인 시 콘텐츠 차단 + 로그인 UI. 모든 m/ 페이지 공통(자동 실행).
  function _enforceMobileAuthGate() {
    let auth = null;
    try { auth = JSON.parse(localStorage.getItem('ns_auth') || 'null'); } catch (_) {}
    const existing = document.getElementById('nsMobileAuthGate');
    if (auth && auth.loggedIn) {
      if (existing) existing.remove();
      try { document.body.style.overflow = ''; } catch (_) {}
      return;
    }
    if (existing) return; // 이미 게이트 표시 중
    const ov = document.createElement('div');
    ov.id = 'nsMobileAuthGate';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:#0F172A;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px 22px;text-align:center;font-family:inherit;overflow:auto';
    ov.innerHTML =
      '<div style="font-size:40px;margin-bottom:8px">🔐</div>' +
      '<div style="font-size:18px;font-weight:800;margin-bottom:6px">로그인이 필요합니다</div>' +
      '<div style="font-size:12.5px;color:#94A3B8;line-height:1.6;max-width:300px;margin-bottom:22px">회사 Google 계정으로 로그인해야<br>업무 조회·작성이 가능합니다.</div>' +
      '<div id="nsGateBtn" style="display:flex;justify-content:center;min-height:44px"></div>' +
      '<div id="nsGateErr" style="display:none;margin-top:14px;font-size:12px;color:#FCA5A5;background:rgba(220,38,38,.15);border:1px solid rgba(248,113,113,.4);border-radius:8px;padding:9px 12px;line-height:1.5;max-width:300px"></div>' +
      '<div id="nsGateFallback" style="display:none;margin-top:14px"><button id="nsGateDevBtn" style="background:rgba(59,130,246,.18);color:#fff;border:1px solid #3B82F6;border-radius:8px;padding:11px 18px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">✉️ 이메일로 로그인</button><div style="font-size:11px;color:#94A3B8;margin-top:7px;line-height:1.5">구글 로그인(위)이 안 되면(LINE 인앱브라우저 등)<br>등록된 회사 이메일로 로그인하세요</div></div>';
    document.body.appendChild(ov);
    try { document.body.style.overflow = 'hidden'; } catch (_) {}

    const showErr = (m) => { const e = document.getElementById('nsGateErr'); if (e) { e.innerHTML = m; e.style.display = ''; } };

    document.getElementById('nsGateDevBtn').onclick = function () {
      const email = prompt('회사 구글 계정 이메일을 입력하세요:', '');
      if (!email || !email.includes('@')) return;
      const name = prompt('표시 이름:', email.split('@')[0]) || email.split('@')[0];
      const r = _loginWithGoogleProfile({ email: email.trim().toLowerCase(), name: name.trim(), picture: '' });
      if (!r || !r.ok) { showErr(r && r.reason === 'not_allowed' ? '❌ ' + email + ' 계정은 등록되지 않았습니다.' : '로그인 실패'); return; }
      location.reload();
    };

    let _gBtnRendered = false;
    function renderGoogleBtn() {
      const clientId = _getGoogleClientId();
      const box = document.getElementById('nsGateBtn');
      const fb = document.getElementById('nsGateFallback');
      if (!box) return;
      // Client ID + GSI 준비되면 → 정식 Google 로그인 버튼 (개발자 모드 숨김)
      if (clientId && window.google && google.accounts && google.accounts.id) {
        try {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: function (resp) {
              const e = document.getElementById('nsGateErr'); if (e) e.style.display = 'none';
              if (!resp || !resp.credential) { showErr('구글 로그인 응답이 비어 있습니다.'); return; }
              const info = _decodeJwt(resp.credential);
              if (!info || !info.email) { showErr('구글 토큰 해석 실패'); return; }
              const r = _loginWithGoogleProfile({ email: info.email, name: info.name || info.given_name || info.email.split('@')[0], picture: info.picture || '' });
              if (!r || !r.ok) { showErr(r && r.reason === 'not_allowed' ? '❌ ' + info.email + ' 계정은 등록되지 않았습니다.<br>관리자에게 권한을 요청하세요.' : '로그인 실패'); return; }
              location.reload();
            },
            auto_select: false, ux_mode: 'popup',
          });
          box.innerHTML = '';
          google.accounts.id.renderButton(box, { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'ko_KR' });
          _gBtnRendered = true;
          // 이메일 로그인 fallback 항상 노출 — LINE 인앱브라우저/사파리 등에서 구글 OAuth(gis_transform 400)
          //   가 막혀도 등록된 회사 이메일로 로그인 가능하게. (허용 이메일 목록으로 차단)
          if (fb) fb.style.display = '';
          return;
        } catch (e) { /* 아래 fallback 로 */ }
      }
      // Client ID 자체가 없을 때(로컬/미설정)만 즉시 개발자 모드 노출
      if (!clientId && fb) fb.style.display = '';
    }

    // client id·화이트리스트 동기화 후 버튼 렌더
    _pullAuthConfig().then(renderGoogleBtn).catch(renderGoogleBtn);
    // GSI 스크립트 동적 로드 (없으면)
    if (window.google && google.accounts && google.accounts.id) {
      renderGoogleBtn();
    } else {
      let s = document.getElementById('nsGsiScript');
      if (!s) {
        s = document.createElement('script');
        s.id = 'nsGsiScript';
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true; s.defer = true;
        s.onload = renderGoogleBtn;
        document.head.appendChild(s);
      }
      setTimeout(renderGoogleBtn, 1200);
      setTimeout(renderGoogleBtn, 2500);
    }
    // 최후의 보루: GSI 가 끝내 안 떠도(네트워크 차단 등) 개발자 모드로 로그인 가능하게
    setTimeout(function () { if (!_gBtnRendered) { const fb = document.getElementById('nsGateFallback'); if (fb) fb.style.display = ''; } }, 4500);
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
  // ⚡ 파싱 캐시 — raw 문자열 키. ns_stores 변경 시 자동 무효화. JSON.parse 반복 비용 제거.
  let _storesCacheRaw = null, _storesCacheArr = [];
  function getStores() {
    let raw; try { raw = localStorage.getItem('ns_stores') || '[]'; } catch { return []; }
    if (raw === _storesCacheRaw) return _storesCacheArr.slice();
    _storesCacheRaw = raw;
    try { _storesCacheArr = JSON.parse(raw); } catch { _storesCacheArr = []; }
    if (!Array.isArray(_storesCacheArr)) _storesCacheArr = [];
    return _storesCacheArr.slice();
  }
  // 🛟 quota 안전 setItem — QuotaExceededError 시 재구축 가능한 캐시(ns_jobs_snap) 비우고 1회 재시도.
  //   모바일 새로고침 시 동기화가 quota 로 깨지던 문제 차단. snap 은 _refreshJobsSnap 로 재생성됨.
  function _safeSetItem(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (e) {
      // 1차: 재구축 가능한 캐시 제거 후 재시도 — snap(해시) + etag. (다음 sync 가 재생성)
      ['ns_jobs_snap', 'ns_jobs_etag', 'ns_stores_etag'].forEach(k => { try { localStorage.removeItem(k); } catch(_){} });
      try { localStorage.setItem(key, value); return true; } catch(_){}
      // 2차: 레거시로 비대해진 ns_stores(이전 버전이 contacts 등 full 저장, ~5MB)를 lean 으로 재압축 후 재시도.
      //   syncStoresFromCloud 가 ETag 304 면 ns_stores 를 안 건드려 옛 bloat 가 영구 잔존 → 다른 키 저장이 quota 로 막힘.
      try {
        if (key !== 'ns_stores' && typeof _leanStores === 'function') {
          const raw = localStorage.getItem('ns_stores');
          if (raw) { const lean = JSON.stringify(_leanStores(JSON.parse(raw))); if (lean.length < raw.length) localStorage.setItem('ns_stores', lean); }
        }
      } catch(_){}
      try { localStorage.setItem(key, value); return true; }
      catch (e2) {
        try { console.warn('[storage] 용량 초과 — ' + key + ' 저장 실패'); } catch(_){}
        try { if (typeof showToast === 'function') showToast('⚠ 저장공간 부족 — 시크릿(비공개) 탭인지 확인하세요. 일반 탭에서 다시 시도해 주세요.', 6000); } catch(_){}
        return false;
      }
    }
  }
  global._safeSetItem = _safeSetItem;
  // 📦 모바일 localStorage 용량 보호 — 모바일 화면에서 안 읽는 무거운 매장 배열 제거.
  //   특히 contacts(~3.5MB) 누적으로 ns_stores 가 5MB 초과 → QuotaExceededError(저장 자체 불가).
  //   모바일은 contacts/equipment/changeLog/storeMemos/memos 를 안 읽음(코드 전수 확인). 클라우드/PC 는
  //   전체 보존 — 모바일 saveStores 는 cloud push 안 하고, 머지는 additive-by-id 라 안전. 해당 UI 도입 시 재검토.
  // 모바일 화면/검색에서 쓰지 않는 대용량 필드 — localStorage 캐시에서 제외(quota 보호).
  //   모바일은 stores 를 cloud 로 push 안 하므로(머지 additive/kv-wins) 다음 sync 에 클라우드가 재공급 → 안전.
  //   fieldUpdatedAt(머지 메타,~150KB) · ecountRegDate/storeRegDate(KV관리 등록일, 모바일 미표시) 추가.
  var _LEAN_STORE_DROP = ['contacts', 'equipment', 'changeLog', 'storeMemos', 'memos', 'fieldUpdatedAt', 'ecountRegDate', 'storeRegDate', 'history'];
  function _leanStores(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map(s => {
      if (!s || typeof s !== 'object') return s;
      let dropped = false;
      const o = {};
      for (const k in s) { if (_LEAN_STORE_DROP.indexOf(k) >= 0) { dropped = true; continue; } o[k] = s[k]; }
      return dropped ? o : s;
    });
  }
  global._leanStores = _leanStores;
  function saveStores(arr) {
    _safeSetItem('ns_stores', JSON.stringify(_leanStores(arr)));
  }
  // 🧹 레거시 ns_stores 즉시 재압축 (로드 1회) — 이전 버전이 저장한 full ns_stores(~5MB, contacts 포함)는
  //   syncStoresFromCloud 의 ETag 304 때문에 영구 잔존해 다른 키 저장을 quota 로 막음(저장공간 부족 토스트).
  //   lean(~0.7MB)보다 크면 즉시 lean 화해 공간 확보. (이미 lean 이면 skip — 임계값/길이비교로 불필요 쓰기 방지)
  try {
    const _rawS = localStorage.getItem('ns_stores');
    if (_rawS && _rawS.length > 1100000) {
      const _leanS = JSON.stringify(_leanStores(JSON.parse(_rawS)));
      if (_leanS.length < _rawS.length) _safeSetItem('ns_stores', _leanS);
    }
  } catch(_){}
  // 🧹 ns_backups(PC 자동백업) 도 슬림 — 옛 스냅샷의 stores(대용량, 스냅샷당 ~1.2MB)가 같은 origin
  //   localStorage 를 먹어 모바일에서도 '저장공간 부족' 유발. 로드 시 stores 제거 + 최근 6개로 제한.
  try {
    const _rawB = localStorage.getItem('ns_backups');
    if (_rawB && _rawB.length > 200000) {
      let _bk = JSON.parse(_rawB);
      if (Array.isArray(_bk)) {
        _bk = _bk.map(s => { if (s && s.stores !== undefined) { const c = Object.assign({}, s); delete c.stores; return c; } return s; });
        while (_bk.length > 6) _bk.shift();
        const _bj = JSON.stringify(_bk);
        if (_bj.length < _rawB.length) _safeSetItem('ns_backups', _bj);
      }
    }
  } catch(_){}

  // 매장 클라우드 풀 (모바일 첫 진입 시 PC 데이터 받기 위함) — index.html L4895 syncFromCloud
  function _isStoreTombstoned(storeId) { return _isTombstoned('store', storeId); }
  async function syncStoresFromCloud() {
    try {
      // ⚡ A-3 ETag/304 — 변경 없으면 본문(~1MB) 재다운로드 회피
      const _inm = (function(){ try { return localStorage.getItem('ns_stores_etag') || ''; } catch { return ''; } })();
      const res = await fetch('/api/stores', { cache: 'no-store', headers: _inm ? { 'If-None-Match': _inm } : undefined });
      if (res.status === 304) return;   // 변경 없음 → 그대로
      if (!res.ok) return;
      const _newEtag = res.headers.get('ETag') || '';
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
      try { if (_newEtag) localStorage.setItem('ns_stores_etag', _newEtag); } catch(_){}
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
  // ⚡ 파싱 캐시 — raw 문자열 키. ns_jobs 변경 시 자동 무효화. JSON.parse 반복 비용 제거.
  let _jobsCacheRaw = null, _jobsCacheArr = [];
  function getJobs() {
    let raw; try { raw = localStorage.getItem('ns_jobs') || '[]'; } catch { return []; }
    if (raw === _jobsCacheRaw) return _jobsCacheArr.slice();
    _jobsCacheRaw = raw;
    try { _jobsCacheArr = JSON.parse(raw); } catch { _jobsCacheArr = []; }
    if (!Array.isArray(_jobsCacheArr)) _jobsCacheArr = [];
    return _jobsCacheArr.slice();
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
    // ⚡ 짧은 해시 저장 (통짜 JSON 금지) — ns_jobs_snap 이 jobs 2벌이 돼 모바일 quota 압박하던 문제 해결
    try { const s = JSON.stringify(out); return (typeof _fastHash === 'function' ? _fastHash(s) : String(s.length)); } catch { return ''; }
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
    const _ok = _safeSetItem('ns_jobs', JSON.stringify(safe));
    scheduleAutoBackup();
    if (_ok) {
      schedulePushJobsToCloud();
    } else {
      // 🛟 로컬 저장 실패(용량초과) — 메모리 배열을 즉시 클라우드로 직접 전송해 소실 방지
      //   (push 는 평소 localStorage 를 읽으므로, 저장 실패 시 그대로 두면 새 작업이 영영 안 올라감)
      try { pushJobsToCloud({ force: true, jobsOverride: safe }); } catch(_){}
      try { if (typeof showToast === 'function') showToast('⚠ 기기 저장공간 부족 — 클라우드에는 전송했습니다. 앱 새로고침 후 확인하세요.', 6000); } catch(_){}
    }
  }

  /* ═══════════════════════════════════════════════════════════
   * TOMBSTONE — index.html L12879 ~ L12909
   * ═══════════════════════════════════════════════════════════ */
  function _addTombstone(type, id, jobId) {
    if (!type || !id) return;
    let wasNew = false;
    try {
      const key = 'ns_tombstones';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      // 🛡 중복 차단 — 같은 (type, id, jobId) 가 이미 있으면 push 안 함
      const targetJob = jobId || null;
      const dup = list.some(t => t.type === type && t.id === id
                                  && (t.jobId || null) === targetJob);
      wasNew = !dup;
      if (!dup) list.push({ type, id, jobId: targetJob, ts: Date.now() });
      const cutoff = Date.now() - 30*24*3600*1000;
      const fresh = list.filter(t => (t.ts||0) >= cutoff);
      if (!dup || fresh.length !== list.length) {
        localStorage.setItem(key, JSON.stringify(fresh));
      }
    } catch(e) { console.warn('[_addTombstone]', e); }
    // 🪦 job 삭제는 즉시 클라우드 전파 예약 (jobTombstones 동봉 push) → 다른 기기 자동 정합화
    if (type === 'job' && wasNew) {
      try { if (typeof schedulePushJobsToCloud === 'function') schedulePushJobsToCloud(); } catch(_){}
    }
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
  /* thread 콘텐츠 기반 중복 제거 — PC app.js 와 동일(SSOT). threadId 가 달라도
     (ts·text·status·author·ROOT여부) 동일하면 1개로, 드롭 항목은 parentId 재매핑. */
  function _dedupeThread(thread) {
    if (!Array.isArray(thread) || thread.length < 2) return thread;
    const keyOf = e => [e.ts||'', e.text||'', e.status||'', e.author||'', (e.parentId==null?'R':'C')].join('');
    const seen = new Map(), remap = new Map(), out = [];
    for (const e of thread) {
      if (!e) continue;
      const k = keyOf(e);
      const surv = seen.get(k);
      if (surv) { if (e.threadId && surv.threadId && e.threadId !== surv.threadId) remap.set(e.threadId, surv.threadId); continue; }
      seen.set(k, e); out.push(e);
    }
    if (remap.size) out.forEach(e => { if (e.parentId && remap.has(e.parentId)) e.parentId = remap.get(e.parentId); });
    return out;
  }

  function _mergeJobRecord(localJob, cloudJob) {
    if (!localJob) {
      // 🪦 cloud only — cascade 삭제 직후 cloud 받을 때도 thread tombstone 필터 적용
      //   (안 하면 사용자가 삭제한 ROOT 가 다음 sync 마다 영구 부활)
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
    // base = mtime 최신 레코드 scalar 우선 (2026-06-17 버그픽스, PC app-03 와 동일 정책).
    //   thread/memos/attachments union + 완료 sticky 는 아래에서 재적용 → base 방향 무관 보존.
    const _mMs = (j) => { const v = j && (j.updatedAt ?? j.lastEditedAt ?? j.createdAt); if (v==null||v==='') return 0; if (typeof v==='number') return v; const s=String(v); if (/^\d+$/.test(s)) return Number(s); const p=Date.parse(s); return Number.isFinite(p)?p:0; };
    const merged = (_mMs(cloudJob) > _mMs(localJob))
      ? Object.assign({}, localJob, cloudJob)
      : Object.assign({}, cloudJob, localJob);
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
          // 본문은 편집시각(editedAt) 최신 우선 — thread 수정이 동기화로 되돌려지던 문제 해결 (PC app-03 쌍둥이)
          const newAtts = mergeAttList(existing.attachments, e.attachments);
          const eStamp = Number(e.editedAt) || 0, exStamp = Number(existing.editedAt) || 0;
          if (eStamp > exStamp) {
            if (newAtts.length) e.attachments = newAtts;
            seen.set(e.threadId, e);
          } else if (newAtts.length) {
            existing.attachments = newAtts;
          }
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
    merged.thread = _dedupeThread(_merged.sort((a,b) => String(a.ts||'').localeCompare(String(b.ts||''))));
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
    // ── 완료 sticky (2026-06-11 보강): completed 플래그 OR 완료계열 status 가 한쪽에라도
    //   있으면 완료 유지. 옛 완료데이터(status='완료'·completed 플래그 없음)에서 local stale
    //   '진행중' 이 Object.assign 으로 cloud '완료' 를 덮어써 진행중 카운트가 기기마다 수렴
    //   안 하던 문제 차단. status 도 완료 신호로 인정. (PC app.js 와 동일 — CLAUDE.md 완료 sticky)
    const _isDoneStatusM = (s) => { s = String(s||''); return s === '완료' || s === '처리완료' || s === 'done'; };
    const _localDone = !!localJob.completed || _isDoneStatusM(localJob.status);
    const _cloudDone = !!cloudJob.completed || _isDoneStatusM(cloudJob.status);
    if (_localDone || _cloudDone) {
      merged.completed = true;
      const cat = (typeof classifyJobCategory === 'function') ? classifyJobCategory(merged) : '';
      const doneStr = (cat === 'as') ? '처리완료' : '완료';
      if (!_isDoneStatusM(merged.status)) merged.status = doneStr;
      if (localJob.completed && localJob.doneAt) merged.doneAt = localJob.doneAt;
      else if (cloudJob.completed && cloudJob.doneAt) merged.doneAt = cloudJob.doneAt;
      merged.completedAt = localJob.completedAt || cloudJob.completedAt || merged.completedAt || '';
    } else {
      merged.completed = !!(localJob.completed || cloudJob.completed);
    }
    // ── 매장 연결 sticky (2026-07-06): storeId/storeName 은 일반 mtime 이 아니라
    //   가장 최근의 명시적 연결/해제(linkedAt/unlinkedAt)를 따른다. (PC app-03 쌍둥이 — 리버트 차단)
    {
      const _act = (j) => Math.max(Number(j && j.linkedAt) || 0, Number(j && j.unlinkedAt) || 0);
      const la = _act(localJob), ca = _act(cloudJob);
      if (la || ca) {
        const win = (la >= ca) ? localJob : cloudJob;
        merged.storeId = win.storeId;
        merged.storeName = win.storeName;
        merged.store = win.store;
        if ('unregistered' in win) merged.unregistered = win.unregistered;
        if ('linkedAt' in win) merged.linkedAt = win.linkedAt;
        if ('unlinkedAt' in win) merged.unlinkedAt = win.unlinkedAt;
        if ('originalStoreName' in win) merged.originalStoreName = win.originalStoreName;
        if (win.address) merged.address = win.address;
      }
    }
    return merged;
  }

  async function syncJobsFromCloud() {
    try {
      // ⚡ A-3 ETag/304 — 변경 없으면 본문(수백 KB) 재다운로드 회피
      const _inm = (function(){ try { return localStorage.getItem('ns_jobs_etag') || ''; } catch { return ''; } })();
      const res = await fetch('/api/jobs', { cache:'no-store', headers: _inm ? { 'If-None-Match': _inm } : undefined });
      if (res.status === 304) return;   // 변경 없음 → 그대로
      if (!res.ok) return;
      const _newEtag = res.headers.get('ETag') || '';
      const data = await res.json();
      // 🔁 resync_token — 토큰 불일치 시 강제 정합화
      const cloudToken = String(data?.resyncToken || '');
      const localToken = (function(){ try { return localStorage.getItem('ns_resync_token') || ''; } catch { return ''; } })();
      if (cloudToken && cloudToken !== localToken) {
        const cloudJobsRaw = Array.isArray(data?.jobs) ? data.jobs : [];
        const cloudDeletedRaw = Array.isArray(data?.deleted) ? data.deleted : [];
        const delIds = new Set(cloudDeletedRaw.map(e => String(e && e.id || '')).filter(Boolean));
        const clean = cloudJobsRaw.filter(j => j && j.id && !delIds.has(j.id));
        _safeSetItem('ns_jobs', JSON.stringify(clean));
        try { localStorage.setItem('ns_resync_token', cloudToken); } catch(_){}
        try { _refreshJobsSnap(); } catch(_){}  // 🕐 snapshot 동기화
        for (const id of delIds) { try { _addTombstone('job', id); } catch(_){} }
        // 🪦 force-resync 시에도 thread tombstone 동기화 (보강 B)
        const ftThreads = Array.isArray(data?.deletedThreads) ? data.deletedThreads : [];
        const ftChildren = Array.isArray(data?.deletedThreadChildren) ? data.deletedThreadChildren : [];
        for (const e of ftThreads) { if (e && e.threadId) { try { _addTombstone('thread', e.threadId, e.jobId || null); } catch(_){} } }
        for (const e of ftChildren) { if (e && e.threadId) { try { _addTombstone('thread-children', e.threadId, e.jobId || null); } catch(_){} } }
        global._lastJobsPushHash = null;
        try { _selfHealJobStatuses(); } catch(_){}
        try { if (_newEtag) localStorage.setItem('ns_jobs_etag', _newEtag); } catch(_){}
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
      // 🪦 서버측 thread tombstone 레지스트리 (보강 B, 2026-05-28) — 다른 기기에서 삭제한
      //    thread / thread-children 을 이 기기에도 자동 등록 (중복 차단으로 누적 폭주 없음)
      const cloudDeletedThreads = Array.isArray(data?.deletedThreads) ? data.deletedThreads : [];
      const cloudDeletedThreadChildren = Array.isArray(data?.deletedThreadChildren) ? data.deletedThreadChildren : [];
      for (const e of cloudDeletedThreads) {
        if (e && e.threadId) { try { _addTombstone('thread', e.threadId, e.jobId || null); } catch(_){} }
      }
      for (const e of cloudDeletedThreadChildren) {
        if (e && e.threadId) { try { _addTombstone('thread-children', e.threadId, e.jobId || null); } catch(_){} }
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
        // ☁️ 클라우드 job 은 서버 deleted_jobs(cloudDeletedIds) 만으로 판단 — 로컬 tombstone 무시.
        //   (PC app.js 와 동일. 로컬 전용 stale tombstone 이 유효한 클라우드 job 을 가려 PC↔모바일
        //    ns_jobs 가 갈리던 근본원인 제거. 삭제 권위는 서버 deleted_jobs 레지스트리.)
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
      _safeSetItem('ns_jobs', JSON.stringify(merged));
      try { if (_newEtag) localStorage.setItem('ns_jobs_etag', _newEtag); } catch(_){}
      try { _refreshJobsSnap(); } catch(_){}  // 🕐 snapshot 동기화
      // 🩹 sync 후 status 와 thread 정합성 자동 보정 — 옛 데이터의 drift 자가 치료
      try { _selfHealJobStatuses(); } catch(_){}
      // 🛟 누락 안전망 — '로컬엔 있는데 클라우드엔 없는 최근(3일) 작업'을 id 집합으로 정확히 감지해 push.
      //   기존 count 비교는 로컬-only 와 cloud-only 가 개수로 상쇄되면 놓침. 서버 id-upsert+mtime+deleted 필터로
      //   중복/부활/덮어쓰기 불가. 최근·tombstone제외·deleted제외 → 옛 stale 대량 재등록·echo 차단.
      const _cloudIdSet = new Set(cloud.map(j => j && j.id).filter(Boolean));
      const _NOW = Date.now(), _RECENT_MS = 3*24*3600*1000;
      const _msOf = (v) => { const n = Number(v) || Date.parse(v); return n || 0; };
      const _hasUnpushedRecent = merged.some(j => j && j.id
        && !_cloudIdSet.has(j.id)
        && !cloudDeletedIds.has(j.id)
        && !_isJobTombstoned(j.id)
        && (_NOW - (_msOf(j.createdAt) || _msOf(j.updatedAt))) < _RECENT_MS);
      if (_hasUnpushedRecent || merged.length > cloud.length || mergedCount > 0) {
        schedulePushJobsToCloud();
      }
    } catch(e) { /* 네트워크 실패 무시 */ }
  }

  let _pushJobsTimer = null;
  function schedulePushJobsToCloud() {
    if (_pushJobsTimer) clearTimeout(_pushJobsTimer);
    _pushJobsTimer = setTimeout(() => { pushJobsToCloud(); }, 5000);
  }
  // 🔁 푸시 실패 시 자동 재시도 — 일시 오류(네트워크/서버)로 작업이 로컬에만 묶이는 것 방지.
  //   KV 한도초과는 제외(익일 해제). 최대 4회 백오프(8s,16s,24s,32s). 성공 시 카운터 리셋.
  function _scheduleJobPushRetry() {
    global._pushRetryN = (global._pushRetryN || 0) + 1;
    if (global._pushRetryN > 4) return;
    const delay = Math.min(60000, 8000 * global._pushRetryN);
    setTimeout(() => { try { pushJobsToCloud(); } catch(_){} }, delay);
  }
  async function pushJobsToCloud(opts) {
    // jobsOverride — 로컬 저장(quota) 실패 시 메모리 배열을 직접 전송해 소실 방지
    const jobs = (opts && Array.isArray(opts.jobsOverride))
      ? opts.jobsOverride
      : (function(){ try { return JSON.parse(localStorage.getItem('ns_jobs')||'[]'); } catch { return []; } })();
    // 🪦 threadTombstones — 로컬 ns_tombstones 의 thread / thread-children 자동 동봉
    //   서버가 deleted_threads / deleted_thread_children KV 에 union 등록 → 다른 PC 자동 차단
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
    //   ② reconcile 전이라도 '방금(10분 내) 사용자가 삭제한 건'은 전파 — 모바일에서 reconcile flag 가
    //      안 잡혀(데이터 초기화·캐시 등) 삭제가 통째로 안 올라가던 문제 fix. 옛 stale 대량삭제는 시간창으로 차단.
    let _reconciled = false; try { _reconciled = !!localStorage.getItem('ns_jobtomb_reconcile_v2'); } catch(_){}
    if (jobTombstones.length) {
      if (_reconciled) {
        _payload.jobTombstones = jobTombstones;
      } else {
        const _now = Date.now();
        const fresh = _allTombs
          .filter(t => t && t.type === 'job' && (_now - (t.ts || 0)) < 600000)   // 10분 내 = 사용자 명시 삭제
          .map(t => ({ id: t.id, deletedAt: t.ts ? new Date(t.ts).toISOString() : new Date().toISOString(), reason: t.reason || 'client-tombstone' }));
        if (fresh.length) _payload.jobTombstones = fresh;
      }
    }
    const body = JSON.stringify(_payload);
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
        if (!limitHit) _scheduleJobPushRetry();   // 일시 실패 → 자동 재시도 (한도초과 제외)
        return { ok:false, status:res.status, limitHit };
      }
      const data = await res.json();
      global._lastJobsPushHash = h;
      global._pushRetryN = 0;   // 성공 → 재시도 카운터 리셋
      if (opts && opts.toast) showToast(`☁ 동기화 완료 (${data.count}건)`);
      return { ok:true, ...data };
    } catch(e) {
      if (opts && opts.toast) showToast('⚠ 푸시 실패 (네트워크)');
      _scheduleJobPushRetry();   // 네트워크 오류 → 자동 재시도
      return { ok:false, error:String(e) };
    }
  }

  /* ═══════════════════════════════════════════════════════════
   * 분류 / 정규화 — index.html L5108 / L9881 / L22825
   * ═══════════════════════════════════════════════════════════ */
  function classifyJobCategory(j) {
    if (!j) return 'as';
    const lc = String(j.lineCategory || '').toLowerCase();
    // lineCategory 는 정규 8분류 코드 — 명시돼 있으면 type 자유텍스트보다 우선.
    //   (type="신규/VAN변경" 같은 혼합 텍스트가 open_store 신규를 VAN 으로 뒤집던 오분류 방지)
    if (lc === 'open_store' || lc === 'new_open' || lc === 'newopen') return 'new';
    if (lc === 'van_doc') return 'van';
    if (lc === 'label' || lc === 'equip_out' || lc === 'delivery') return 'supplies';
    if (lc === 'churn') return 'churn';
    if (lc === 'pos_as' || lc === 'van_as' || lc === 'device_mgmt' || lc === 'as_pos') return 'as';
    const tp = String(j.type || j.category || '').toLowerCase();
    const all = lc + ' ' + tp;
    if (/label|equip_out|delivery|라벨|영수증|프라이스텍|소모품|택배/.test(all)) return 'supplies';
    if (/van_doc|밴서류|van.*신규|van.*재신고|van.*정산|van.*계약|van.*변경/.test(all)) return 'van';
    if (/open_store|오픈|신규|new_open|newopen/.test(all)) return 'new';
    if (/churn|폐업|매각|해지|이탈/.test(all)) return 'churn';
    if (/pos_as|van_as|device_mgmt|as_pos|단말|a\/s|as\s|에이에스/.test(all)) return 'as';
    return 'as';
  }
  // 🛡 어른거림(flicker) 방지 — el 의 직전 렌더 시그니처(__rgSig)와 같으면 true(=재렌더 skip).
  //   주기적 동기화(30초)·storage 이벤트가 내용 동일한데도 innerHTML 통째 교체해 깜빡이던 문제 차단.
  //   PC app.js 의 window._sigSkip 와 동일.
  global._sigSkip = function(el, sig){
    if (!el) return true;
    if (el.__rgSig === sig && el.childElementCount > 0) return true;
    el.__rgSig = sig;
    return false;
  };

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
      _safeSetItem('ns_jobs', JSON.stringify(cleanJobs));
      _safeSetItem('ns_stores', JSON.stringify(_leanStores(cleanStores)));
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
  /* 🔑 매장 식별 키 — 소문자+공백 제거만, 법인표기 보존. (검색용 _normalizeSearch 와 구분 — PC SSOT 동일) */
  function _normStoreKey(s) {
    return String(s||'').toLowerCase().replace(/\s+/g, '');
  }

  /* 🔎 매장명 통합 검색 (PC app-02 와 동일 SSOT-쌍 — 둘이 항상 일치해야 함, 2026-06-19)
     규칙: 질의를 공백으로 토큰 분리 → 각 토큰을 상호/주소/사업자/대표/거래처코드/aliases
     에서 매칭(비연속·역순 OK). 전체 토큰 매칭이 상위 정렬. 신규/AS/VAN/재고조사/소모품
     모든 메뉴(PC·모바일)가 이 함수를 사용. */
  function _scoreStore(s, tokens) {
    const norm = (x) => String(x||'').toLowerCase().replace(/\s+/g,'');
    const name    = norm(s.name || s.storeName);
    const addr    = norm(s.address || s.addr);
    const bizNo   = String(s.bizNo || s.biz || s.bizno || '').replace(/\D/g,'');
    const ceo     = norm(s.ceo || s.ceoName);
    const code    = norm(s.code);
    const aliases = (Array.isArray(s.aliases) ? s.aliases : []).map(norm);
    let score = 0, matchedTokens = 0;
    for (const t of tokens) {
      const nt = norm(t); if (!nt) continue;
      const dt = String(t).replace(/\D/g,'');
      let hit = false;
      if (name === nt)            { score += 10; hit = true; }
      else if (name.includes(nt)) { score += 4;  hit = true; }
      if (aliases.some(a => a === nt))            { score += 8; hit = true; }
      else if (aliases.some(a => a.includes(nt))) { score += 3; hit = true; }
      if (addr.includes(nt))      { score += 2; hit = true; }
      if (code && code.includes(nt)) { score += 3; hit = true; }
      if (dt.length >= 3 && bizNo.includes(dt))   { score += (bizNo === dt ? 9 : 2); hit = true; }
      if (ceo.includes(nt))       { score += 1; hit = true; }
      if (hit) matchedTokens++;
    }
    if (matchedTokens === tokens.length && tokens.length >= 2) score += 5;   // 전체 토큰 매칭 보너스
    return { score, matchedTokens };
  }
  /* 🔢 전 메뉴 공통 작업 정렬 (GLOBAL_RULE: job-done-sort, 2026-06-19 — PC app-01 와 동일 SSOT-쌍)
     미완료 먼저(등록 desc) → 완료(완료시각 desc). 도메인 우선순위(미수/긴급) 미적용. */
  function _jobDoneSort(a, b) {
    const doneFn = (typeof global._isJobEffectivelyDone === 'function') ? global._isJobEffectivelyDone
                 : (typeof global._isJobDone === 'function') ? global._isJobDone
                 : (j => !!(j && (j.completed || /완료/.test(String(j.status||'')))));
    const aD = doneFn(a) ? 1 : 0, bD = doneFn(b) ? 1 : 0;
    if (aD !== bD) return aD - bD;                                  // 미완료 먼저
    const reg = (j) => Number(j.createdAt) || Date.parse(j.createdAt) || 0;
    const dts = (j) => Number(j.completedAt) || Date.parse(j.completedAt)
                    || Number(j.doneAt) || Date.parse(j.doneAt) || reg(j);
    return aD ? (dts(b) - dts(a)) : (reg(b) - reg(a));              // 완료: 완료시각desc / 미완료: 등록desc
  }
  function _searchStores(val, limit = 8) {
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    if (!val || !String(val).trim()) return [];
    // 구분자 분리: 공백 + / , · ; | (사업자번호 보존 위해 - . 은 분리 안 함). 순서 무관 토큰 매칭.
    const tokens = String(val).trim().split(/[\s/,·;|]+/).filter(t => t.length > 0);
    if (!tokens.length) return [];
    return stores.map(s => ({ s, ...(_scoreStore(s, tokens)) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || b.matchedTokens - a.matchedTokens)
      .slice(0, limit).map(x => x.s);
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
  const _LINE_HEAD_BYTES = 600;   // 처리내용 헤더 한도 — 200자(한글 기준 ≈600byte)까지 허용 (이전 140)
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
      // 🕐 KST 날짜 — 브라우저 타임존 무관 절대 보정 (UTC+9). getTimezoneOffset 방식은
      //   브라우저가 이미 KST 면 +9h 이중 적용 → 오후 등록이 다음날로 밀림. (2026-05-28 fix)
      return new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10);
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
    // 📩 발송자(현재 로그인 사용자) 이름을 맨 앞에 (neo_work 공용 계정 발송 시 누가 보냈는지 표시)
    (function(){
      let _dt = opts.defaultText || '';
      try {
        const _sender = (typeof _currentAuthName === 'function') ? (_currentAuthName() || '') : '';
        if (_sender && !_dt.startsWith('[' + _sender + ']')) _dt = '[' + _sender + '] ' + _dt;
      } catch(_){}
      ta.value = _dt;
    })();
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
  /* ───────────────────────────────────────────────────────────
   * _supplyItemSummary — 소모품 job 의 품목 표시 문자열 생성
   *   opts.withSpec : '3" POS용지' 처럼 규격 prefix
   *   opts.withMode : '🎁 지원' / '💰 선불' / '📌 후불' 처리구분 emoji 부착
   * ───────────────────────────────────────────────────────── */
  function _supplyItemSummary(job, opts) {
    if (!job) return '';
    opts = opts || {};
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
    let itemName = disp.name;
    if (typeKey === '소모품/기타') {
      const etc = String(job.supplyEtcName||'').trim();
      if (etc) itemName = etc;
    }
    let qty = Number(job.supplyQty);
    let unit = job.supplyUnit || '';
    if (!Number.isFinite(qty) || qty === 0) {
      const m = String(job.supplyQty||'').match(/(\d+(?:\.\d+)?)\s*(\S*)/);
      if (m) { qty = parseFloat(m[1])||0; if (!unit && m[2]) unit = m[2]; }
    }
    const qtyTxt = (qty > 0) ? `${qty}${unit||'개'}` : '';
    const headPart = (opts.withSpec && disp.spec) ? `${disp.spec} ${itemName}` : itemName;
    const namePart = qtyTxt ? `${headPart} ${qtyTxt}` : headPart;
    if (opts.withMode) {
      const mode = job.supplyMode || ((Number(job.amount)||0) > 0 ? 'prepaid' : 'support');
      const modeMap = { support:'🎁 지원', prepaid:'💰 선불', postpaid:'📌 후불' };
      const modeTxt = modeMap[mode] || '';
      return modeTxt ? `${namePart} ${modeTxt}` : namePart;
    }
    return namePart;
  }
  global._supplyItemSummary = _supplyItemSummary;

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

    // 담당자 우선순위 — (entry 발송 시) entry.author 우선 → owner→engineer→assignee→createdBy→_whoCreated
    //   병합/옛 job 메타가 아니라 "지금 보내는 요청" 작성자가 담당으로 찍히도록 (2026-06-02)
    let ownerRaw = (entry && entry.author) || job.owner || job.engineer || job.assignee || job.createdBy || job._whoCreated || '';
    if (ownerRaw && typeof _normalizeDisplayName === 'function') {
      try { ownerRaw = _normalizeDisplayName(ownerRaw) || ownerRaw; } catch(_){}
    }
    const rec = Object.assign({}, job, {
      storeName: job.storeName || job.store || '',
      status:    (entry && entry.status) || job.status || (job.completed ? '완료' : '진행중'),
      scheduleDate: job.scheduleDate || job.asDueDate || job.installDate || job.softOpenDate || job.openDate || job.date || '',
      // 거래처 담당 연락처 — 업무 등록 시 기록한 작업 연락처로 한정(매장 fallback 안 함)
      contactName: job.contactName || '',
      contactPhone: job.contactPhone || '',
      contactRole: job.contactRole || '',
      owner: ownerRaw,
      memo: headContent,
    });
    // 🏷️ 소모품 카테고리 — PC 와 동일한 매장명 [날짜] [규격 품목명 수량단위 처리구분] 담당 이름 형식
    let defaultText;
    if (category === 'supply' && typeof window._supplyItemSummary === 'function') {
      const sigName = job.signageName ? `${rec.storeName} ${job.signageName}` : rec.storeName;
      const shipDate = job.shipDate || job.date
                    || (job.createdAt ? new Date(job.createdAt).toISOString().slice(0,10) : '')
                    || (new Date()).toISOString().slice(0,10);
      const fullItem = window._supplyItemSummary(job, { withSpec: true, withMode: true });
      const ownerPart = rec.owner ? ` 담당 ${rec.owner}` : '';
      defaultText = `${sigName} [${shipDate}] [${fullItem}]${ownerPart}`;
    } else {
      // entry 발송 시 헤드라인 날짜는 그 entry 작성일(ts) 기준 — 병합된 옛 job 날짜 오염 방지 (2026-06-02)
      const entryDate = (entry && entry.ts) ? String(entry.ts).slice(0,10) : '';
      defaultText = _buildEnrichedLineText(rec, { scheduleLabel: scheduleLabelMap[category] || '📅 예정', headContent, processDate: entryDate || undefined });
    }
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

  /* ───────────────────────────────────────────────────────────
   * 처리 담당(engineer) 배정 — 모바일 공용 (select 기반)
   * ───────────────────────────────────────────────────────── */
  // 직원(ns_users) 목록으로 <option> 생성. selectedName 유지 + 미배정 빈 옵션.
  function _staffOptionsHtml(selectedName) {
    const sel = String(selectedName || '');
    const users = (typeof getUsers === 'function') ? (getUsers() || []) : [];
    const names = [];
    const seen = new Set();
    users.forEach(u => {
      const nm = (u && (u.name || u.email || '')).trim();
      if (!nm || seen.has(nm)) return;
      seen.add(nm); names.push(nm);
    });
    // 현재 담당이 직원 목록에 없으면(자유입력/퇴사 등) 옵션으로 보존
    if (sel && !seen.has(sel)) names.unshift(sel);
    let html = `<option value="">미배정</option>`;
    names.forEach(nm => {
      html += `<option value="${esc(nm)}" ${nm === sel ? 'selected' : ''}>${esc(nm)}</option>`;
    });
    return html;
  }
  // 요청(요청접수 ROOT) 처리 담당 설정 — thread entry.assignee 에 저장 (요청별 담당)
  function _setRequestAssignee(jobId, threadId, name) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const job = jobs.find(j => j && j.id === jobId);
    if (!job || !Array.isArray(job.thread)) return false;
    const entry = job.thread.find(e => e && e.threadId === threadId);
    if (!entry) return false;
    const newName = String(name || '').trim();
    if ((entry.assignee || '') === newName) return false;
    entry.assignee = newName;
    job.updatedAt = Date.now();
    if (typeof saveJobs === 'function') saveJobs(jobs);
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(_){}
    try { if (typeof showToast === 'function') showToast(newName ? '👷 처리 담당: ' + newName : '담당 해제됨'); } catch(_){}
    return true;
  }
  // 요청(요청접수 ROOT) 처리예정일 설정 — thread entry.dueDate
  function _setRequestDueDate(jobId, threadId, value) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const job = jobs.find(j => j && j.id === jobId);
    if (!job || !Array.isArray(job.thread)) return false;
    const entry = job.thread.find(e => e && e.threadId === threadId);
    if (!entry) return false;
    const v = String(value || '').slice(0, 10);
    if ((entry.dueDate || '') === v) return false;
    entry.dueDate = v;
    job.updatedAt = Date.now();
    if (typeof saveJobs === 'function') saveJobs(jobs);
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(_){}
    try { if (typeof showToast === 'function') showToast(v ? '📅 처리예정 ' + v : '처리예정 해제'); } catch(_){}
    return true;
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

  // 모바일 Google 로그인
  global._getGoogleClientId = _getGoogleClientId;
  global._isEmailAllowed = _isEmailAllowed;
  global._decodeJwt = _decodeJwt;
  global._pullAuthConfig = _pullAuthConfig;
  global._loginWithGoogleProfile = _loginWithGoogleProfile;
  global._mobileLogout = _mobileLogout;
  global._enforceMobileAuthGate = _enforceMobileAuthGate;

  // 처리 담당 배정 (요청별)
  global._staffOptionsHtml = _staffOptionsHtml;
  global._setRequestAssignee = _setRequestAssignee;
  global._setRequestDueDate = _setRequestDueDate;

  // 클라우드 동기화
  global._mergeJobRecord = _mergeJobRecord;
  global.syncJobsFromCloud = syncJobsFromCloud;
  global.pushJobsToCloud = pushJobsToCloud;
  global.schedulePushJobsToCloud = schedulePushJobsToCloud;

  /* ── 🔧 작업 삭제 정합화(B) — 로컬 전용 job tombstone(클라우드 미등록) 제거 → 클라우드 union 재구성 ──
     기기마다 다른 stale 로컬 삭제표식이 클라우드 작업을 숨겨 PC↔모바일 건수가 어긋나던 문제 해소.
     클라우드 deleted_jobs 에 등록된 진짜 삭제는 보존. 1회 자동(flag) + 수동 forceReconcileJobs(). */
  async function reconcileJobTombstones() {
    let cloudDel = new Set();
    let ok = false;
    try {
      const res = await fetch('/api/jobs', { cache:'no-store' });
      if (res.ok) { const d = await res.json(); (Array.isArray(d.deleted)?d.deleted:[]).forEach(e => { const id = String((e && e.id) || e || ''); if (id) cloudDel.add(id); }); ok = true; }
    } catch(_){}
    if (!ok) return { removed: 0, ok: false };   // 레지스트리 못 받으면 정리 안 함(legit 삭제 보호)
    let removed = 0;
    try {
      const list = JSON.parse(localStorage.getItem('ns_tombstones') || '[]');
      const kept = list.filter(t => { if (t && t.type === 'job' && !cloudDel.has(String(t.id))) { removed++; return false; } return true; });
      if (removed) localStorage.setItem('ns_tombstones', JSON.stringify(kept));
    } catch(_){}
    try { global._lastJobsPushHash = null; } catch(_){}
    try { await syncJobsFromCloud(); } catch(_){}
    return { removed, ok: true };
  }
  global.reconcileJobTombstones = reconcileJobTombstones;
  global.forceReconcileJobs = async function() {
    const r = await reconcileJobTombstones();
    if (!r.ok) { alert('정합화 실패 — 클라우드 연결을 확인하세요 (변경 없음)'); return r; }
    try { localStorage.setItem('ns_jobtomb_reconcile_v2', String(Date.now())); } catch(_){}
    alert('정합화 완료 — 로컬 전용 삭제표식 ' + r.removed + '건 제거 후 클라우드 기준 재동기화');
    return r;
  };
  /* 🔄 클라우드 기준 강제 동기화 (모바일) — PC forceCloudRepull 과 동일 정책. 토큰 불필요. */
  global.forceCloudRepull = async function(opts) {
    opts = opts || {};
    if (!opts.silent && !confirm('이 기기를 클라우드 기준으로 강제 동기화합니다.\n\n• 로컬 작업을 클라우드로 먼저 올린 뒤\n• 클라우드 전체를 다시 받아 맞춥니다.\n\n진행할까요?')) return;
    try { const r = await reconcileJobTombstones(); if (r && r.ok) localStorage.setItem('ns_jobtomb_reconcile_v2', String(Date.now())); } catch(e){}
    try { if (typeof pushJobsToCloud === 'function') await pushJobsToCloud({ force:true }); } catch(e){}
    let clean = null;
    try {
      const res = await fetch('/api/jobs', { cache:'no-store' });
      const r = await res.json();
      const del = new Set((r.deleted || []).map(e => String((e && e.id) || e)));
      clean = (r.jobs || []).filter(j => j && j.id && !del.has(j.id));
    } catch(e) { alert('⚠ 클라우드 작업 수신 실패 — 잠시 후 다시 시도하세요'); return; }
    try {
      const liveIds = new Set(clean.map(j => j.id));
      let tomb = JSON.parse(localStorage.getItem('ns_tombstones') || '[]');
      tomb = tomb.filter(t => !(t && t.type === 'job' && liveIds.has(t.id)));
      localStorage.setItem('ns_tombstones', JSON.stringify(tomb));
    } catch(_){}
    try { _safeSetItem('ns_jobs', JSON.stringify(clean)); } catch(_){}
    try { if (typeof _refreshJobsSnap === 'function') _refreshJobsSnap(); } catch(_){}
    try { if (typeof syncStoresFromCloud === 'function') await syncStoresFromCloud(); } catch(e){}
    alert('✅ 클라우드 기준 동기화 완료 — 새로고침합니다');
    setTimeout(() => location.reload(), 500);
  };
  setTimeout(async () => {
    try {
      const FLAG = 'ns_jobtomb_reconcile_v2';
      if (localStorage.getItem(FLAG)) return;
      const r = await reconcileJobTombstones();
      if (!r.ok) return;   // 실패 시 flag 미설정 → 다음 로드 재시도
      localStorage.setItem(FLAG, String(Date.now()));
      if (r.removed > 0) console.log('[reconcile] 로컬전용 삭제표식 ' + r.removed + '건 제거 → 클라우드 union 정합화');
    } catch(e) { console.warn('[reconcile]', e); }
  }, 4000);

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
  global._normStoreKey = _normStoreKey;
  global._searchStores = _searchStores;   // 매장명 통합 검색 SSOT (PC app-02 와 동일 로직)
  global._scoreStore = _scoreStore;
  global._jobDoneSort = _jobDoneSort;      // 작업 정렬 SSOT (PC app-01 와 동일 로직)

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

  // 미로그인 시 자동 로그인 게이트 — 모든 m/ 페이지 공통 (열람·작성 차단)
  function _gateBoot() { try { _enforceMobileAuthGate(); } catch (e) { console.warn('[authGate]', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _gateBoot);
  else _gateBoot();

  /* ── 🔄 새 버전 배포 감지 → 새로고침 안내 (모바일 공통) ──
     실행중 버전 = 로드된 m-core.js 의 ?v=, 최신 = 현재 m/ 페이지 HTML 을 no-store 로 받아 파싱.
     배포마다 bump 하는 ?v= 를 버전 마커로 사용. PC(app.js)와 동일 패턴. */
  function _setupVersionWatch(scriptName) {
    function readV(src) { const m = String(src || '').match(/[?&]v=([^&"'\s]+)/); return m ? m[1] : ''; }
    function currentV() {
      const tags = Array.prototype.slice.call(document.querySelectorAll('script[src]'));
      const t = tags.find(function(s){ return (s.getAttribute('src') || '').indexOf(scriptName) >= 0; });
      return t ? readV(t.getAttribute('src')) : '';
    }
    var RUNNING = currentV();
    if (!RUNNING) return;
    var notified = false;
    var timer = null;
    var re = new RegExp(scriptName.replace(/[.]/g, '\\.') + '\\?v=([^"\'&\\s]+)');
    // 🔄 무인 자동 새로고침 안전 판정 — 작성 중 입력(요청접수/메모/LINE 등)이 있으면 보류(배너로 대체)
    function _safeToAutoReload() {
      try {
        var tas = document.querySelectorAll('textarea');
        for (var i=0;i<tas.length;i++){ if (tas[i].offsetParent !== null && String(tas[i].value||'').trim()) return false; }
        var ae = document.activeElement;
        if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && String(ae.value||'').trim()) return false;
        if (location.hash && /form|compose|edit/i.test(location.hash)) return false;  // 폼/작성 화면
      } catch(e){}
      return true;
    }
    function check(auto) {
      if (notified) return;
      fetch(location.pathname + '?_vc=' + Date.now(), { cache: 'no-store' })
        .then(function(res){ return res.ok ? res.text() : ''; })
        .then(function(html){
          var m = html && html.match(re);
          var live = m ? m[1] : '';
          if (live && live !== RUNNING) {
            notified = true; if (timer) clearInterval(timer);
            try { sessionStorage.setItem('ns_version_stale', '1'); } catch(e){}  // 풀다운/새로고침에도 즉시 재표시
            // 탭 복귀(auto) + 미저장 입력 없음 → 무인 자동 새로고침, 아니면 배너
            if (auto && _safeToAutoReload()) { _hardReloadForUpdate(); }
            else { _showVersionBanner(); }
          } else if (live && live === RUNNING) {
            try { sessionStorage.removeItem('ns_version_stale'); } catch(e){}  // 진짜 최신 → 플래그 제거
          }
        })
        .catch(function(){});
    }
    // 직전 '구버전' 표시됐었다면 즉시 재확인(캐시된 옛 코드로 풀다운 새로고침해도 배너가 사라지지 않게)
    var _wasStale = false; try { _wasStale = sessionStorage.getItem('ns_version_stale') === '1'; } catch(e){}
    setTimeout(function(){ check(false); }, _wasStale ? 0 : 5000);          // 초기: 배너(놀람 방지)
    timer = setInterval(function(){ check(false); }, 5 * 60 * 1000);        // 사용 중: 배너
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) check(true); });  // 탭 복귀: 안전 시 자동
  }
  // 🔄 완전 새로고침(캐시 무력화) — 페이지 URL 에 _u 붙여 HTML 부터 새로 받음 → 새 ?v= 로드. iOS Safari 캐시 회피.
  function _hardReloadForUpdate() {
    try {
      var u = new URL(location.href);
      u.searchParams.set('_u', String(Date.now()));   // 기존 쿼리·해시 보존
      location.href = u.toString();
    } catch(e) { try { location.reload(); } catch(e2) { location.href = location.href; } }
  }
  // 모바일 — 상단 강제 배너 ('나중에' 없음). 풀다운 새로고침으로도 안 사라지고, '지금 업데이트' 눌러야 사라짐.
  function _showVersionBanner() {
    if (document.getElementById('nsVersionBanner')) return;
    var bar = document.createElement('div');
    bar.id = 'nsVersionBanner';
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483600;background:#1D4ED8;color:#fff;'
      + 'padding:calc(env(safe-area-inset-top, 0px) + 11px) 14px 11px;display:flex;flex-wrap:wrap;align-items:center;'
      + 'justify-content:center;gap:9px;font-size:13.5px;font-weight:700;box-shadow:0 2px 14px rgba(0,0,0,0.3)';
    bar.innerHTML = '🔄 새 버전이 나왔습니다 — 눌러서 업데이트하세요'
      + '<button id="nsVerReload" style="background:#fff;color:#1D4ED8;border:none;border-radius:7px;padding:8px 16px;font-weight:800;font-size:13px;cursor:pointer">지금 업데이트</button>';
    document.body.appendChild(bar);
    var rl = document.getElementById('nsVerReload');
    if (rl) rl.onclick = _hardReloadForUpdate;
  }
  global._showVersionBanner = _showVersionBanner;
  setTimeout(function(){ try { _setupVersionWatch('m-core.js'); } catch(e){} }, 100);

  /* 작성자 '닉네임 → 실명' 일괄 정리 (모바일) — PC app-08 migrateJobAuthorNicknames 와 동일.
     ns_users nicknames 레지스트리(_normalizeDisplayName) 기반. 미등록 이름은 보존.
     모바일도 jobs push 무인증이라 saveJobs 가 변경분 mtime bump + push → 클라우드 정합. */
  global.migrateJobAuthorNicknames = function(opts) {
    opts = opts || {};
    const FLAG = 'ns_author_nick_migrated_v1';
    if (!opts.force && localStorage.getItem(FLAG) === '1') return { skipped:true };
    if (typeof _normalizeDisplayName !== 'function') return { skipped:true };
    let jobs = []; try { jobs = getJobs() || []; } catch(e){ return { skipped:true }; }
    const FIELDS = ['author','createdBy','recordedBy','assignee','engineer','owner','_whoCreated','completedBy','lastEditedBy'];
    const fix = (v) => { if (!v || typeof v !== 'string') return v; const n = _normalizeDisplayName(v); return (n && n !== v) ? n : v; };
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
    if (changed > 0 && typeof saveJobs === 'function') saveJobs(jobs);   // mtime bump + push
    try { localStorage.setItem(FLAG, '1'); } catch(_){}
    return { ok:true, changed };
  };
  setTimeout(function(){
    try {
      const r = global.migrateJobAuthorNicknames();
      if (r && r.ok && r.changed > 0) {
        try { if (typeof showToast === 'function') showToast('📝 작성자 닉네임 ' + r.changed + '건 실명 정리', 4000); } catch(_){}
        try { window.dispatchEvent(new Event('hashchange')); } catch(_){}   // 현재 화면 갱신
      }
    } catch(e){}
  }, 4500);
})(window);
