  /* ══════════════════════════════════════════════
     클라우드 KV 동기화 (Cloudflare Pages Functions)
     - 페이지 로드 시 /api/stores 에서 받아 ns_stores 와 머지
     - 관리자 "🔄 지금 동기화" 버튼이 다시 호출
  ══════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════════════════════════
     매장 데이터 머지 정책 (Single Source of Truth)
     ──────────────────────────────────────────────────────────────────────
     클라이언트(syncFromCloud) 와 서버(/api/sync.js) 가 동일 규칙 사용해야 함.
     변경 시 양쪽 모두 업데이트 — sync.js 의 STORE_FIELD_POLICY 와 동일하게 유지.

     정책 종류:
       'kv-wins'              — 서버 KV 값 항상 우선 (관리자 패치 필드)
       'prefer-non-empty'     — 둘 다 비어있지 않으면 KV 가 이김; 한쪽만 있으면 그 값
       'additive-by-id'       — 양쪽 모두 보존 (instanceId/phone 키로 dedupe)
       'additive-time-sorted' — 양쪽 합치고 at 기준 시간 정렬
       'aliases-union'        — 양쪽 합쳐 unique
       'local-only'           — KV 값 무시, 로컬 보존 (UI 임시 상태)
     기본: 'prefer-non-empty'
  ══════════════════════════════════════════════════════════════════════ */
  window.STORE_FIELD_POLICY = {
    // 서버 자동 패치 (이카운트 업로드 시각 등) — KV 가 진실
    storeRegDate:   'kv-wins',
    ecountRegDate:  'kv-wins',
    // 누적 인스턴스 컬렉션 — 양쪽 모두 보존
    equipment:      { type:'additive-by-id', idKey:'instanceId' },
    // contacts: phone 기준 dedup. 전화 없는 연락처는 fallbackKeys(이름+직책)로 dedup → phoneless doubling 차단.
    contacts:       { type:'additive-by-id', idKey:'phone', normalize:'phone', fallbackKeys:['name','role'] },
    contactsDeleted:'aliases-union',   // 삭제한 담당자 키(전화정규화 or 'n:이름|직책') 집합 — union 으로 부활 차단
    memos:          'additive-time-sorted',
    changeLog:      'additive-time-sorted',
    // 별칭 — 양쪽 합쳐서 유니크
    aliases:        'aliases-union',
    // per-field mtime — 필드별 편집 시각 맵(키별 max 유지) / 매장 mtime(최신값 유지)
    fieldUpdatedAt: 'max-by-key',
    updatedAt:      'max-number',
    // 그 외 (storeName, biz, ceo, address, phone, pos, kiosk 등) → 'prefer-non-empty' (기본)
  };

  // 빈 값 판별 (null/undefined/''/빈배열/빈객체)
  function _isEmptyValue(v) {
    if (v == null || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (typeof v === 'object' && Object.keys(v).length === 0) return true;
    return false;
  }
  // 전화번호 정규화 (숫자만)
  function _normPhone(p) { return String(p||'').replace(/\D/g,''); }
  // content dedup 키 — id(전화) 없는 인스턴스 fallback (서버 sync.js 와 동일)
  function _normContent(v) { return String(v||'').trim().toLowerCase().replace(/\s+/g,''); }

  /* per-field mtime 비교 시각 — prefer-non-empty 충돌 해소용.
     ★ fieldUpdatedAt 가 '있으면' 누락 키는 0(미편집=경쟁 안 함). '아예 없을' 때만 매장 updatedAt 로 fallback.
        (이 fallback 규칙이 핵심: 안 그러면 '주소만 고친 쪽'이 updatedAt 때문에 대표자까지 이김) */
  function _fieldTs(store, key) {
    if (store && store.fieldUpdatedAt && typeof store.fieldUpdatedAt === 'object') {
      return Number(store.fieldUpdatedAt[key]) || 0;
    }
    return Number(store && store.updatedAt) || 0;
  }
  /* 매장 편집 스탬프 — updatedAt(매장) + fieldUpdatedAt[field](필드별) 동시 기록. 편집 지점 공용. */
  function _touchStore(store, fields) {
    if (!store) return store;
    const now = Date.now();
    store.updatedAt = now;
    if (!store.fieldUpdatedAt || typeof store.fieldUpdatedAt !== 'object') store.fieldUpdatedAt = {};
    (Array.isArray(fields) ? fields : [fields]).forEach(f => { if (f) store.fieldUpdatedAt[f] = now; });
    return store;
  }
  window._touchStore = _touchStore;

  /* 단일 필드 머지 — 정책에 따라 loc/rem 합치기 */
  function mergeStoreField(loc, rem, key) {
    const policy = window.STORE_FIELD_POLICY[key] || 'prefer-non-empty';
    const ptype = typeof policy === 'string' ? policy : policy.type;
    const lv = loc[key], rv = rem[key];

    switch (ptype) {
      case 'local-only':
        return lv;   // KV 값 무시

      case 'kv-wins':
        if (!_isEmptyValue(rv)) return rv;
        return lv;

      case 'max-number': {
        // 두 숫자 중 큰 값 (updatedAt 등) — 머지 후 최신 시각 유지
        const mx = Math.max(Number(lv)||0, Number(rv)||0);
        return mx || undefined;
      }

      case 'max-by-key': {
        // {키:ts} 맵 — 키별 max 유지 (fieldUpdatedAt)
        const lo = (lv && typeof lv === 'object') ? lv : {};
        const ro = (rv && typeof rv === 'object') ? rv : {};
        const out = {};
        new Set([...Object.keys(lo), ...Object.keys(ro)]).forEach(k => {
          out[k] = Math.max(Number(lo[k])||0, Number(ro[k])||0);
        });
        return Object.keys(out).length ? out : undefined;
      }

      case 'prefer-non-empty':
      default: {
        const le = _isEmptyValue(lv), re = _isEmptyValue(rv);
        if (le && re) return undefined;
        if (le)  return rv;
        if (re)  return lv;
        // 둘 다 값 있음 → per-field mtime (fieldUpdatedAt[key]) 최신 쪽 우선.
        //   서로 다른 필드 동시편집 보존(#1). 없으면 매장 updatedAt fallback → 레거시 동작.
        //   동률/불명이면 KV(rem) 유지 = 기존 동작 보존(회귀 방지).
        const lts = _fieldTs(loc, key), rts = _fieldTs(rem, key);
        return lts > rts ? lv : rv;
      }

      case 'additive-by-id': {
        const idKey = policy.idKey || 'id';
        const norm  = policy.normalize === 'phone' ? _normPhone : (x => x);
        const fbKeys = Array.isArray(policy.fallbackKeys) ? policy.fallbackKeys : null;
        const out = [];
        const seen = new Set();
        const push = (item) => {
          if (!item) return;
          const id = norm(item[idKey] || '');
          let dk = id ? ('id:' + id) : '';
          // id(전화) 없으면 fallbackKeys(이름+직책) 내용 키로 dedup → phoneless doubling 차단
          if (!dk && fbKeys) {
            const fk = fbKeys.map(k => _normContent(item[k])).join('|');
            if (fk.replace(/\|/g,'')) dk = 'c:' + fk;
          }
          if (dk) {
            if (seen.has(dk)) return;
            seen.add(dk);
          }
          out.push(item);
        };
        (Array.isArray(lv) ? lv : []).forEach(push);   // 로컬 우선
        (Array.isArray(rv) ? rv : []).forEach(push);   // KV 추가
        return out.length > 0 ? out : undefined;
      }

      case 'additive-time-sorted': {
        const merged = [...(Array.isArray(lv) ? lv : []), ...(Array.isArray(rv) ? rv : [])];
        // at 기준 내림차순 + 중복 제거 (at + 본문 해시 정도로 충분)
        const seen = new Set();
        const out = [];
        merged.sort((a,b) => String(b?.at||'').localeCompare(String(a?.at||''))).forEach(m => {
          const key = String(m?.at||'') + '|' + String(m?.text||m?.note||'').slice(0,60);
          if (seen.has(key)) return;
          seen.add(key);
          out.push(m);
        });
        return out.length > 0 ? out : undefined;
      }

      case 'aliases-union': {
        const set = new Set();
        (Array.isArray(lv) ? lv : []).forEach(a => { if (a) set.add(a); });
        (Array.isArray(rv) ? rv : []).forEach(a => { if (a) set.add(a); });
        return set.size > 0 ? [...set] : undefined;
      }
    }
  }

  /* 매장 객체 통합 머지 — 모든 필드를 정책에 따라 처리 */
  function mergeStoreObjects(loc, rem) {
    if (!rem) return loc;
    if (!loc) return rem;
    const out = {};
    const allKeys = new Set([...Object.keys(loc), ...Object.keys(rem)]);
    for (const k of allKeys) {
      const v = mergeStoreField(loc, rem, k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  window.mergeStoreObjects = mergeStoreObjects;

  let _lastStoresAutoFetch = 0;
  async function syncFromCloud(opts) {
    opts = opts || {};
    // ⚡ A-2 자동 루프 중복 제거 — 자동 호출(opts.auto)만 12초 throttle. 수동/강제(force)는 항상 실행.
    if (opts.auto) { const _n = Date.now(); if (_n - _lastStoresAutoFetch < 12000) return; _lastStoresAutoFetch = _n; }
    try {
      // ⚡ A-3 ETag/304 — 변경 없으면 본문(~1MB) 재다운로드 회피
      const _inm = (function(){ try { return localStorage.getItem('ns_stores_etag') || ''; } catch { return ''; } })();
      const res = await fetch('/api/stores', { cache: 'no-store', headers: _inm ? { 'If-None-Match': _inm } : undefined });
      if (res.status === 304) return { ok:true, notModified:true };   // 변경 없음 → 그대로 (304 는 throw 아님)
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const _newEtag = res.headers.get('ETag') || '';
      const data = await res.json();
      const remote = Array.isArray(data.stores) ? data.stores : [];
      const meta = data.meta || {};
      const local = (typeof getStores === 'function') ? (getStores() || []) : [];
      // 🪦 서버 측 매장 삭제 레지스트리 — 동일 id 를 자기 localStorage 에서도 제거
      //   + 로컬 tombstone 등록해서 future sync 시 부활 차단
      const cloudDeletedStores = Array.isArray(data.deleted) ? data.deleted : [];
      const cloudDeletedStoreIds = new Set(cloudDeletedStores.map(e => String(e && e.id || '')).filter(Boolean));
      if (cloudDeletedStoreIds.size > 0 && typeof _addTombstone === 'function') {
        for (const id of cloudDeletedStoreIds) {
          try { _addTombstone('store', id); } catch(_){}
        }
      }
      // 다중 키 인덱스 (id / biz / code) — 한쪽이 결손이어도 매칭 가능
      const normBiz = (b) => String(b||'').replace(/\D/g, '');
      const indexBy = (arr) => {
        const m = { id:new Map(), biz:new Map(), code:new Map() };
        for (const s of arr) {
          if (s.id) m.id.set(s.id, s);
          const nb = normBiz(s.biz || s.bizno);
          if (nb && nb.length === 10) m.biz.set(nb, s);
          if (s.code) m.code.set(s.code, s);
        }
        return m;
      };
      const remoteIdx = indexBy(remote);
      const localIdx = indexBy(local);
      const findIn = (idx, s) => idx.id.get(s.id) || idx.biz.get(normBiz(s.biz||s.bizno)) || idx.code.get(s.code);

      // 정책 기반 통합 머지 사용 — window.mergeStoreObjects 가 모든 필드 처리
      // (정책: window.STORE_FIELD_POLICY 에서 명시. 새 필드는 정책만 추가하면 됨)
      const mergeStore = (loc, rem) => mergeStoreObjects(loc, rem);

      // 🪦 store tombstone 필터 — 로컬 tombstone 또는 서버 deleted 레지스트리 매칭 시 제외
      const isStoreTomb = (s) => {
        if (!s || !s.id) return false;
        if (cloudDeletedStoreIds.has(String(s.id))) return true;
        return (typeof _isTombstoned === 'function') && _isTombstoned('store', s.id);
      };
      const result = [];
      const seen = new Set();
      // 1) 로컬 매장 순회 — tombstone 된 매장은 skip, 나머지는 KV 매장과 머지
      for (const loc of local) {
        if (isStoreTomb(loc)) continue;
        const rem = findIn(remoteIdx, loc);
        result.push(mergeStore(loc, rem));
        if (rem?.id) seen.add('id:' + rem.id);
      }
      // 2) KV 에만 있는 매장 추가 — tombstone 된 매장은 skip
      for (const rem of remote) {
        if (isStoreTomb(rem)) continue;
        if (rem.id && seen.has('id:' + rem.id)) continue;
        if (findIn(localIdx, rem)) continue;
        result.push(rem);
      }
      const merged = result;
      // sync 결과 save 는 fromSync:true — dirty 안 켜고 echo push 안 함 (race-condition 재발방지)
      if (merged.length > 0 && typeof saveStores === 'function') saveStores(merged, { fromSync:true });
      try { if (_newEtag) localStorage.setItem('ns_stores_etag', _newEtag); } catch(_){}
      if (typeof hydrateSavedStores === 'function') hydrateSavedStores();
      // 로컬이 클라우드보다 많은 경우(엑셀 업로드 등)는 명시적으로 dirty + push
      if (merged.length > remote.length) {
        markStoresDirty();
        schedulePushStoresToCloud();
      }
      // 마지막 동기화 시각 표시
      const lbl = document.getElementById('lastSyncLabel');
      if (lbl) {
        if (meta.syncedAt) {
          const dt = new Date(meta.syncedAt);
          lbl.textContent = `마지막 동기화: ${dt.toLocaleString('ko-KR')} · ${meta.count || 0}건 (${meta.source || '-'})`;
          lbl.style.color = 'var(--gray-500)';
        } else {
          lbl.textContent = '아직 동기화된 데이터가 없습니다.';
          lbl.style.color = 'var(--gray-400)';
        }
      }
      if (opts.toast && typeof showToast === 'function') {
        showToast(`✅ 클라우드에서 ${remote.length}건 동기화`);
      }
      return { ok: true, count: remote.length, meta };
    } catch (e) {
      console.warn('[syncFromCloud] error', e);
      if (opts.toast && typeof showToast === 'function') {
        showToast('⚠ 동기화 실패: ' + (e.message || e));
      }
      return { ok: false, error: String(e) };
    }
  }
  window.syncFromCloud = syncFromCloud;

  /* ════════════════════════════════════════════════════════════
     🌤 상단 일시 + 날씨 위젯 (서울/KST 고정)
     - 일시: 1분마다 갱신
     - 날씨: Open-Meteo (https://open-meteo.com) — 무료, API key 불필요, CORS OK
            15분마다 갱신 + localStorage 캐시 (페이지 새로고침 깜빡임 방지)
     ════════════════════════════════════════════════════════════ */
  (function _initNavClock(){
    const DOW = ['일','월','화','수','목','금','토'];
    const SEOUL = { lat: 37.5665, lon: 126.9780 };
    // WMO weather codes → emoji + 한국어 라벨
    function wmoToEmoji(code, isDay){
      const d = isDay !== 0; // 1=day, 0=night
      if (code === 0) return { e: d ? '☀️' : '🌙', l: d ? '맑음' : '맑음(밤)' };
      if (code === 1) return { e: d ? '🌤' : '🌙', l: '대체로 맑음' };
      if (code === 2) return { e: d ? '⛅' : '☁️', l: '부분 흐림' };
      if (code === 3) return { e: '☁️', l: '흐림' };
      if (code === 45 || code === 48) return { e: '🌫', l: '안개' };
      if (code >= 51 && code <= 57) return { e: '🌦', l: '이슬비' };
      if (code >= 61 && code <= 67) return { e: '🌧', l: '비' };
      if (code >= 71 && code <= 77) return { e: '🌨', l: '눈' };
      if (code >= 80 && code <= 82) return { e: '🌦', l: '소나기' };
      if (code === 85 || code === 86) return { e: '🌨', l: '눈 소나기' };
      if (code >= 95 && code <= 99) return { e: '⛈', l: '뇌우' };
      return { e: '🌡', l: '날씨' };
    }
    function paintDateTime(){
      // KST 환산: Asia/Seoul ICU 직접 사용 (안정)
      const now = new Date();
      const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
      const y = kst.getFullYear();
      const m = String(kst.getMonth()+1).padStart(2,'0');
      const d = String(kst.getDate()).padStart(2,'0');
      const dow = DOW[kst.getDay()];
      const hh = String(kst.getHours()).padStart(2,'0');
      const mm = String(kst.getMinutes()).padStart(2,'0');
      const dateStr = `${y}. ${m}. ${d} (${dow})`;
      const timeStr = `${hh}:${mm}`;
      const navD = document.getElementById('navClockDate');
      const navT = document.getElementById('navClockTime');
      const tpD  = document.getElementById('topbarClockDate');
      const tpT  = document.getElementById('topbarClockTime');
      if (navD) navD.textContent = dateStr;
      if (navT) navT.textContent = timeStr;
      if (tpD)  tpD.textContent  = dateStr;
      if (tpT)  tpT.textContent  = timeStr;
    }
    function paintWeather(temp, code, isDay){
      const { e, l } = wmoToEmoji(code, isDay);
      const t = (typeof temp === 'number') ? `${Math.round(temp)}°C` : '--°';
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('navClockEmoji', e);
      set('navClockTemp', t);
      set('topbarClockEmoji', e);
      set('topbarClockTemp', t);
      const navWrap = document.getElementById('navClock');
      if (navWrap) navWrap.classList.remove('w-loading');
      // tooltip 에 한국어 라벨
      [document.getElementById('navClock'), document.getElementById('topbarClock')].forEach(el => {
        if (el) el.title = `서울 · ${l} ${t} · KST`;
      });
    }
    async function fetchWeather(){
      const CACHE_KEY = 'ns_weather_cache_v1';
      // 캐시 (15분) 우선 — 깜빡임 방지
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const c = JSON.parse(raw);
          if (c && Date.now() - c.at < 15 * 60 * 1000) {
            paintWeather(c.temp, c.code, c.isDay);
          }
        }
      } catch(_){}
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${SEOUL.lat}&longitude=${SEOUL.lon}&current=temperature_2m,weather_code,is_day&timezone=Asia%2FSeoul`;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const cur = j && j.current;
        if (!cur) throw new Error('no current');
        const temp = Number(cur.temperature_2m);
        const code = Number(cur.weather_code);
        const isDay = Number(cur.is_day);
        paintWeather(temp, code, isDay);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), temp, code, isDay })); } catch(_){}
      } catch(e) {
        // 실패해도 일시는 계속 표시 — 캐시 fallback 으로 충분
        console.warn('[weather] fetch 실패', e);
      }
    }
    function start(){
      paintDateTime();
      fetchWeather();
      // 일시: 매 분마다 (다음 정각 분 기준)
      const now = new Date();
      const msToNextMin = 60000 - (now.getSeconds()*1000 + now.getMilliseconds());
      setTimeout(() => {
        paintDateTime();
        setInterval(paintDateTime, 60000);
      }, msToNextMin);
      // 날씨: 15분마다
      setInterval(fetchWeather, 15 * 60 * 1000);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  })();

  // 페이지 로드 직후 1회 자동 동기화 + 모든 위젯 강제 재렌더 (데모 잔존 방지)
  document.addEventListener('DOMContentLoaded', () => {
    // 기존 AI 분석 결과(샘플 위험/주의 항목) 정리 — 의미없는 데이터 제거
    try {
      localStorage.removeItem('neo_analysis_result');
      localStorage.removeItem('neo_analysis_date');
    } catch(e){}

    // 매장 데이터 스키마 마이그레이션 — storeRegDate 검증/정리 (v3)
    // 이전 버그 업로드로 localStorage 의 storeRegDate 가 모두 같은 날짜로 채워진 경우 제거.
    // URL 에 ?force_resync=1 붙이면 강제로 다시 동기화 (Console 없이 클릭 한 번으로 해결)
    try {
      const SCHEMA_VERSION = 'stores-schema-v3-2026-05-12';
      const cur = localStorage.getItem('ns_stores_schema_ver');
      const forceResync = new URLSearchParams(location.search).has('force_resync');
      if (cur !== SCHEMA_VERSION || forceResync) {
        // 통째로 localStorage 매장 비우고 KV 에서 새로 받음 (가장 확실)
        localStorage.removeItem('ns_stores');
        localStorage.removeItem('ns_stores_meta');
        console.log('[migration v3] localStorage 매장 초기화 — KV 에서 신선한 데이터 재로드' + (forceResync ? ' (force_resync)' : ''));
        localStorage.setItem('ns_stores_schema_ver', SCHEMA_VERSION);
        if (forceResync) {
          // 깨끗한 URL 로 갱신 (파라미터 제거)
          try { history.replaceState(null, '', location.pathname + location.hash); } catch(e){}
        }
      }
    } catch(e) { console.warn('[migration]', e); }

    setTimeout(() => {
      syncFromCloud({ toast: false });
      try { if (typeof syncCatalogFromCloud === 'function') syncCatalogFromCloud(); } catch(e){}
      // 작업 클라우드 동기화 — 다른 PC 가 만든 신규관리 작업도 받아옴
      if (typeof syncJobsFromCloud === 'function') {
        syncJobsFromCloud().then(() => {
          try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
          try { if (typeof hydrateNewopen === 'function') hydrateNewopen('all'); } catch(e){}
          try { if (typeof renderCalendar === 'function') renderCalendar(); } catch(e){}
        });
      }
      try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
      try { if (typeof hydrateNewopen === 'function') hydrateNewopen('all'); } catch(e){}
      try { if (typeof hydrateSavedStores === 'function') hydrateSavedStores(); } catch(e){}
      try { if (typeof renderCalendar === 'function') renderCalendar(); } catch(e){}
    }, 600);

    /* ════════════════════════════════════════════════════════════
       🔄 다기기 라이브 동기화 (30초 폴링)
       - 다른 PC/모바일에서 등록·수정·삭제한 항목을 자동 반영
       - 탭이 보이지 않을 때는 idle (배터리/네트워크 절약)
       - localStorage hash 비교 → 변경 시에만 hub/dashboard 재렌더 (jitter 방지)
       - 페이지 visible 전환 시 즉시 1회 sync (탭 전환 stale 차단)
       ════════════════════════════════════════════════════════════ */
    (function _setupLiveSync(){
      let busy = false;
      const _hash = () => {
        try {
          const j = localStorage.getItem('ns_jobs') || '';
          const s = localStorage.getItem('ns_stores') || '';
          return (window._fastHash ? window._fastHash(j + '|' + s) : (j.length + ':' + s.length));
        } catch { return ''; }
      };
      async function tick() {
        if (busy) return;
        if (document.visibilityState !== 'visible') return;
        busy = true;
        try {
          const before = _hash();
          // 작업 + 매장 + LINE pending 모두 동기화
          const tasks = [];
          if (typeof syncJobsFromCloud === 'function') tasks.push(syncJobsFromCloud({ auto:true }));
          if (typeof syncFromCloud === 'function')     tasks.push(syncFromCloud({ toast:false, auto:true }));
          if (typeof syncLinePending === 'function')   tasks.push(syncLinePending());
          await Promise.allSettled(tasks);
          const after = _hash();
          if (before !== after) {
            // 변경 감지 — hub + dashboard 자동 재렌더
            try { if (typeof window._refreshAllHubsAfterThread === 'function') window._refreshAllHubsAfterThread(); } catch(_){}
            try { if (typeof renderCalendar === 'function') renderCalendar(); } catch(_){}
            try { if (typeof hydrateSavedStores === 'function') hydrateSavedStores(); } catch(_){}
          }
        } catch(e) { console.warn('[liveSync]', e); }
        finally { busy = false; }
      }
      // 30초 폴링
      setInterval(tick, 30000);
      // 탭이 다시 보일 때 즉시 1회 — 백그라운드에서 다른 기기 변경 사항 즉시 반영
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          setTimeout(tick, 100);
        }
      });
      // window focus 이벤트 — 다른 탭/창에서 돌아왔을 때
      window.addEventListener('focus', () => setTimeout(tick, 100));
    })();
  });
  // 추가 보강: window load 이벤트에서도 한 번 더
  window.addEventListener('load', () => {
    setTimeout(() => {
      try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
      try { if (typeof hydrateNewopen === 'function') hydrateNewopen('all'); } catch(e){}
    }, 100);
  });

  const titles = {
    dashboard: '대시보드',
    newopen: '신규/상담 (기존)',
    newhub: '🆕 신규',
    ashub: '🔧 AS',
    vanhub: '📑 VAN',
    supplieshub: '🏷️ 소모품',
    schedulehub: '📅 일정조회',
    stocktakehub: '📦 재고조사',
    improvements: '💡 사이트 개선안',
    consult: '상담 조회',
    stores: '점포관리',
    jobs: '작업/일정',
    calendar: '작업/일정',
    asmgmt: 'AS 관리 (기존)',
    equipment: '장비재고',
    quote: '견적 작성'
  };

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
    document.getElementById('pageTitle').textContent = titles[id];
    event.currentTarget && event.currentTarget.classList.add('active');
    // re-highlight nav
    document.querySelectorAll('.nav-item').forEach(n => {
      if (n.getAttribute('onclick') && n.getAttribute('onclick').includes(id)) {
        n.classList.add('active');
      }
    });
    // 댓글 패널 화면 동기화
    cmCurrentScreen = id;
    if (typeof renderCommentPanel === 'function') renderCommentPanel();
    // 신규관리 진입 시 데이터 갱신
    if (id === 'newopen' && typeof hydrateNewopen === 'function') {
      try { hydrateNewopen('all'); } catch(e) {}
      try { if (typeof renderNewopenMiniCal === 'function') renderNewopenMiniCal(); } catch(e) {}
    }
    // 상담 조회 진입 시 데이터 갱신
    if (id === 'consult' && typeof hydrateConsult === 'function') {
      try { hydrateConsult('active'); } catch(e) {}
    }
    // 작업/일정 진입 시 캘린더 + Line 등록 대기 패널 갱신
    if ((id === 'jobs' || id === 'calendar') && typeof renderCalendar === 'function') {
      try { renderCalendar(); } catch(e) {}
      try { if (typeof refreshLinePendingBanner === 'function') refreshLinePendingBanner(); } catch(e) {}
    }
    // 대시보드 진입 시 데이터 갱신 (데모 HTML 잔존 방지)
    if (id === 'dashboard' && typeof hydrateDashboardJobs === 'function') {
      try { hydrateDashboardJobs(); } catch(e) {}
      try { refreshDashVandocsAlert(); } catch(e) {}
    }
    // AS 관리 진입 시 갱신
    if (id === 'asmgmt' && typeof hydrateAsMgmt === 'function') {
      try { hydrateAsMgmt(); } catch(e) {}
    }
    // 점포관리 진입 시 갱신
    if (id === 'stores' && typeof hydrateSavedStores === 'function') {
      try { hydrateSavedStores(); } catch(e) {}
    }
    // 신규 hub 진입 시 매장별 그룹 렌더
    if (id === 'newhub' && typeof renderNewHub === 'function') {
      try { renderNewHub(); } catch(e) { console.warn('[newhub] render 실패', e); }
    }
    if (id === 'ashub' && typeof renderAsHub === 'function') {
      try { renderAsHub(); } catch(e) { console.warn('[ashub] render 실패', e); }
    }
    if (id === 'vanhub' && typeof renderVanHub === 'function') {
      try { renderVanHub(); } catch(e) { console.warn('[vanhub] render 실패', e); }
    }
    if (id === 'supplieshub' && typeof renderSuppliesHub === 'function') {
      try { renderSuppliesHub(); } catch(e) { console.warn('[supplieshub] render 실패', e); }
    }
    if (id === 'schedulehub' && typeof renderScheduleHub === 'function') {
      try { renderScheduleHub(); } catch(e) { console.warn('[schedulehub] render 실패', e); }
    }
    if (id === 'stocktakehub' && typeof renderStocktakeHub === 'function') {
      try { renderStocktakeHub(); } catch(e) { console.warn('[stocktakehub] render 실패', e); }
    }
    if (id === 'improvements' && typeof loadImprovements === 'function') {
      try { loadImprovements(); } catch(e) { console.warn('[improvements] load 실패', e); }
    }
  }

  /* ═══════════════ Hub 화면 공용 로직 ═══════════════ */
  // 업무 → 메뉴 카테고리 분류 (sdvCatOf 와 동일 — window 전역 노출)
  window.classifyJobCategory = function(j) {
    if (!j) return 'as';
    const lc = String(j.lineCategory || '').toLowerCase();
    // lineCategory 는 정규 8분류 코드 — 명시돼 있으면 type 자유텍스트보다 우선.
    //   (F-3 카테고리 이동도 lineCategory 토큰으로 동작. type="신규/VAN변경" 같은 혼합 텍스트가
    //    open_store 신규를 VAN 으로 뒤집던 오분류 방지)
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
  };

  // 🔢 사업자등록번호 표시용 포맷 — 10자리 숫자면 XXX-XX-XXXXX, 아니면 원본 그대로(비표준 값 보존)
  window._bizFmt = function(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 10) return d.slice(0,3) + '-' + d.slice(3,5) + '-' + d.slice(5);
    return String(v || '');
  };
  // 🔢 사업자등록번호 입력 자동 포맷 — 숫자만 입력해도 XXX-XX-XXXXX (3-2-5) 자동 삽입 (부분 입력도 단계 포맷)
  window._fmtBizNo = function(el) {
    if (!el) return;
    const d = String(el.value || '').replace(/\D/g, '').slice(0, 10);
    let out = d;
    if (d.length > 5)      out = d.slice(0,3) + '-' + d.slice(3,5) + '-' + d.slice(5);
    else if (d.length > 3) out = d.slice(0,3) + '-' + d.slice(3);
    el.value = out;
  };

  // 🔢 기존 매장 사업자번호 일괄 표준화 (1회, idempotent) — 이카운트 import 등으로 들어온
  //   미정규화(10자리 raw 등) biz 를 XXX-XX-XXXXX 로 변환. 변경된 매장만 fieldUpdatedAt.biz 갱신 후 저장(push)
  //   → 모든 표시 지점(목록/상세/검색)이 자동으로 규격화된 값을 보여줌.
  setTimeout(function _bizFmtMigrate() {
    try {
      if (localStorage.getItem('ns_biz_fmt_v1')) return;
      const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
      if (!stores.length) { return; }  // 아직 매장 로드 전 → 플래그 안 남기고 다음 기회에
      let changed = 0;
      stores.forEach(s => {
        if (!s) return;
        const cur = String(s.biz || s.bizno || '');
        const d = cur.replace(/\D/g, '');
        if (d.length === 10) {
          const fmt = d.slice(0,3) + '-' + d.slice(3,5) + '-' + d.slice(5);
          if (s.biz !== fmt) {
            s.biz = fmt;
            try { if (typeof _touchStore === 'function') _touchStore(s, ['biz']); } catch(_){}
            changed++;
          }
        }
      });
      localStorage.setItem('ns_biz_fmt_v1', String(Date.now()));
      if (changed > 0 && typeof saveStores === 'function') {
        saveStores(stores);   // dirty + push (per-field merge 로 다른 기기에도 전파)
        console.log('[bizfmt] 사업자번호 표준화 ' + changed + '개 매장');
        try { if (typeof hydrateSavedStores === 'function') hydrateSavedStores(); } catch(_){}
      }
    } catch(e) { console.warn('[bizfmt migrate]', e); }
  }, 4000);

  /* ── 카테고리 이동 (F-3) ── */
  // 잘못 분류된 업무를 다른 메뉴 카테고리로 이동
  // lineCategory 를 캐노니컬 토큰으로 강제 설정해 classifyJobCategory 결과를 바꿈
  window.JOB_CATEGORY_OPTIONS = [
    { key:'new',      label:'🆕 신규',     token:'open_store' },
    { key:'as',       label:'🔧 AS',       token:'pos_as'     },
    { key:'van',      label:'📑 VAN 서류', token:'van_doc'    },
    { key:'supplies', label:'🏷️ 소모품',   token:'label'      },
    { key:'churn',    label:'🏪 매장이탈', token:'churn'      },
  ];
  window.moveJobToCategory = function(jobId, targetKey) {
    if (!jobId || !targetKey) return false;
    const opt = window.JOB_CATEGORY_OPTIONS.find(o => o.key === targetKey);
    if (!opt) { try { showToast('알 수 없는 카테고리'); } catch(e){} return false; }
    const arr = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const idx = arr.findIndex(j => j.id === jobId);
    if (idx < 0) { try { showToast('업무를 찾을 수 없습니다'); } catch(e){} return false; }
    const j = arr[idx];
    const prevCat = window.classifyJobCategory(j);
    if (prevCat === targetKey) { try { showToast('이미 해당 카테고리입니다'); } catch(e){} return false; }
    j.lineCategory = opt.token;
    j._categoryMoved = { from: prevCat, to: targetKey, at: Date.now() };
    arr[idx] = j;
    if (typeof saveJobs === 'function') saveJobs(arr);
    try { showToast(`✅ ${opt.label} 카테고리로 이동했습니다`); } catch(e){}
    // 화면 갱신
    try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
    try { if (typeof window._reopenStoreDetail === 'function' && j.storeId) window._reopenStoreDetail(j.storeId); } catch(e){}
    try {
      const cur = document.querySelector('.screen.active');
      const sid = cur ? cur.id : '';
      if (sid === 'screen-newhub' && typeof window.renderNewHub === 'function') window.renderNewHub();
      if (sid === 'screen-ashub' && typeof window.renderAsHub === 'function') window.renderAsHub();
      if (sid === 'screen-vanhub' && typeof window.renderVanHub === 'function') window.renderVanHub();
      if (sid === 'screen-supplieshub' && typeof window.renderSuppliesHub === 'function') window.renderSuppliesHub();
    } catch(e){}
    return true;
  };

  // 카테고리 이동 프롬프트 — sdv2 카드의 📂 버튼에서 호출
  window.promptMoveJobCategory = function(ev, jobId) {
    try { ev && ev.stopPropagation && ev.stopPropagation(); } catch(e){}
    const arr = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const j = arr.find(x => x.id === jobId);
    if (!j) { try { showToast('업무를 찾을 수 없습니다'); } catch(e){} return; }
    const curCat = window.classifyJobCategory(j);
    const opts = window.JOB_CATEGORY_OPTIONS;
    // 미니 메뉴 팝업
    const old = document.getElementById('_jobCatMoveMenu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.id = '_jobCatMoveMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid var(--gray-300,#d1d5db);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:6px;min-width:180px';
    const x = ev && (ev.clientX || (ev.touches && ev.touches[0]?.clientX)) || 100;
    const y = ev && (ev.clientY || (ev.touches && ev.touches[0]?.clientY)) || 100;
    menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 280) + 'px';
    menu.innerHTML = `<div style="font-size:11px;color:var(--gray-500,#6b7280);padding:6px 10px;font-weight:700">📂 카테고리 이동</div>` +
      opts.map(o => {
        const active = o.key === curCat;
        return `<div data-key="${o.key}" style="padding:8px 12px;font-size:13px;border-radius:6px;cursor:${active?'default':'pointer'};color:${active?'var(--gray-400,#9ca3af)':'var(--gray-800,#1f2937)'};font-weight:${active?'500':'600'}" ${active?'':'onmouseover="this.style.background=\'#f3f4f6\'" onmouseout="this.style.background=\'\'"'}>${o.label}${active?' <span style="font-size:10px">(현재)</span>':''}</div>`;
      }).join('');
    document.body.appendChild(menu);
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-key]');
      if (!item) return;
      const key = item.dataset.key;
      if (key === curCat) return;
      menu.remove();
      if (confirm(`이 업무를 "${opts.find(o=>o.key===key).label}" 카테고리로 이동할까요?`)) {
        window.moveJobToCategory(jobId, key);
      }
    });
    setTimeout(() => {
      const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 50);
  };

  /* ── 중복 감지 (F-2) ── */
  // 신규 업무 저장 직전, 동일 매장 + 동일 타입 최근 7일 내 진행 중 업무 검색
  window.findSimilarRecentJob = function(storeName, jobType, withinDays) {
    if (!storeName) return null;
    const days = withinDays || 7;
    const now = Date.now();
    const cutoff = now - days * 86400000;
    const arr = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const doneFn = (typeof _isJobDone === 'function') ? _isJobDone : () => false;
    return arr.find(j => {
      const sn = String(j.storeName || j.store || '').trim();
      if (sn !== String(storeName).trim()) return false;
      if (doneFn(j)) return false;
      const created = j.createdAt || 0;
      if (created < cutoff) return false;
      const t1 = String(j.type || '').toLowerCase();
      const t2 = String(jobType || '').toLowerCase();
      // 동일 분류면 중복으로 간주
      const c1 = window.classifyJobCategory(j);
      const c2 = window.classifyJobCategory({ type: jobType });
      return c1 === c2 || t1 === t2;
    }) || null;
  };

  // 매장별 그룹화 — 카테고리 필터링 후 storeId/storeName 기준 묶기
  function _hubGroupByStore(filterFn) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const storeById = new Map();
    const storeByName = new Map();
    const normFn = (typeof _normStoreKey === 'function')
                  ? _normStoreKey
                  : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
    stores.forEach(s => {
      if (s.id) storeById.set(s.id, s);
      const n = (s.name||'').trim();
      if (n) storeByName.set(normFn(n), s);
    });

    const filtered = jobs.filter(filterFn);
    const groupMap = new Map();
    filtered.forEach(j => {
      const jName = (j.storeName || j.store || '').trim();
      // 매칭 우선순위:
      //   1) storeId 매칭 + 매장명이 일치하면 그대로 사용
      //   2) storeId 매칭됐지만 매장명이 다르면 → 매장명 매칭을 우선 (storeId 오염 보호)
      //   3) storeId 매칭 실패면 매장명 매칭
      let store = j.storeId ? storeById.get(j.storeId) : null;
      if (store && jName) {
        const storeNameNorm = normFn(store.name || '');
        const jNameNorm = normFn(jName);
        if (storeNameNorm !== jNameNorm) {
          const byName = storeByName.get(jNameNorm);
          if (byName) store = byName;  // 이름이 맞는 매장 우선
        }
      }
      if (!store && jName) store = storeByName.get(normFn(jName)) || null;
      // 그룹 키 — store 가 매칭됐으면 그 id, 아니면 정규화 매장명
      const key = (store && store.id) || ('name:' + normFn(jName));
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          storeId: (store && store.id) || j.storeId || null,
          storeName: (store && store.name) || jName || '(매장명 없음)',
          store: store || null,
          jobs: [],
        });
      }
      groupMap.get(key).jobs.push(j);
    });
    return [...groupMap.values()];
  }

  // 매장 정보 누락 진단 — 콘솔에서 window.diagnoseOrphanJobs() 실행
  window.diagnoseOrphanJobs = function() {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const idSet = new Set(stores.filter(s => s.id).map(s => s.id));
    const normFn = (typeof _normStoreKey === 'function')
                  ? _normStoreKey
                  : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
    const nameSet = new Set(stores.map(s => normFn(s.name||'')).filter(Boolean));
    const orphans = { byId:[], byName:[], noStore:[] };
    jobs.forEach(j => {
      const jn = (j.storeName || j.store || '').trim();
      const hasIdMatch = j.storeId && idSet.has(j.storeId);
      const hasNameMatch = jn && nameSet.has(normFn(jn));
      if (j.storeId && !hasIdMatch && !hasNameMatch) {
        orphans.byId.push(j);
      } else if (!j.storeId && jn && !hasNameMatch) {
        orphans.byName.push(j);
      } else if (!j.storeId && !jn) {
        orphans.noStore.push(j);
      }
    });
    console.group('[매장 정보 없음 진단]');
    console.log('총 작업', jobs.length, '/ 총 매장', stores.length);
    console.log('① storeId 가 매장 DB 에서 사라진 작업:', orphans.byId.length, '건');
    orphans.byId.forEach(j => console.log(`   ${j.id} | type:${j.type} | name:${j.storeName||j.store} | storeId:${j.storeId}`));
    console.log('② storeName 만 있고 매장 미등록인 작업:', orphans.byName.length, '건');
    orphans.byName.forEach(j => console.log(`   ${j.id} | type:${j.type} | name:${j.storeName||j.store}`));
    console.log('③ 매장명도 없는 작업:', orphans.noStore.length, '건');
    orphans.noStore.forEach(j => console.log(`   ${j.id} | type:${j.type} | createdAt:${j.createdAt}`));
    console.groupEnd();
    return orphans;
  };

  // 작업의 storeId 를 매장명 기준으로 재연결 (관리 도구)
  // 콘솔에서 window.relinkJobsByName() — orphans.byId 의 작업 중 매장명이 ns_stores 에 있는 항목을 자동 재연결
  window.relinkJobsByName = function() {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const normFn = (typeof _normStoreKey === 'function')
                  ? _normStoreKey
                  : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
    const storeByName = new Map();
    stores.forEach(s => { const n = (s.name||'').trim(); if (n) storeByName.set(normFn(n), s); });
    let fixed = 0;
    jobs.forEach(j => {
      const jn = (j.storeName || j.store || '').trim();
      if (!jn) return;
      const match = storeByName.get(normFn(jn));
      if (!match) return;
      // storeId 가 없거나 mismatch 면 재연결
      if (!j.storeId || j.storeId !== match.id) {
        const before = j.storeId || '(없음)';
        j.storeId = match.id;
        j.unregistered = false;
        fixed++;
        console.log(`  ${j.id} ${jn} : ${before} → ${match.id}`);
      }
    });
    if (fixed > 0) {
      if (typeof saveJobs === 'function') saveJobs(jobs);
      try { if (typeof showToast === 'function') showToast(`✅ ${fixed}건 작업의 storeId 재연결 완료`); } catch(e){}
    }
    console.log('[relinkJobsByName] 재연결:', fixed, '건');
    return fixed;
  };

  // hub 정렬·필터에서도 effectively-done 사용 — AS thread 완료 시 status 무관 done 처리
  const _hubDoneFn = (j) => {
    if (typeof window._isJobEffectivelyDone === 'function') return window._isJobEffectivelyDone(j);
    if (typeof window._isJobDone === 'function') return window._isJobDone(j);
    return false;
  };

  // D-day 계산
  function _hubDday(j) {
    // 🛡 완료 판정을 sched 체크보다 먼저 — sched 없는 작업 (소모품 등) 도 완료 표시되도록
    if (_hubDoneFn(j)) return { text:'완료', urgent:false, done:true };
    // 소모품 (shipDate) / AS (asReceivedAt) / 신규 (openDate) 도 fallback 으로 인식
    const sched = j.scheduleDate || j.date || j.shipDate
                  || j.installDate || j.softOpenDate || j.openDate
                  || (j.asReceivedAt ? String(j.asReceivedAt).slice(0,10) : '');
    if (!sched) return { text:'진행중', urgent:false, done:false };
    const today = new Date(); today.setHours(0,0,0,0);
    const tgt = new Date(sched + 'T00:00:00');
    const diff = Math.round((tgt - today)/86400000);
    const text = diff < 0 ? `D+${-diff}` : diff === 0 ? 'D-Day' : `D-${diff}`;
    const urgent = diff <= 2 && diff >= -3;
    return { text, urgent, done:false };
  }

  function _hubEsc(s) { return (typeof esc === 'function') ? esc(s) : String(s||''); }

  // 그룹 카드 렌더
  // 📡 hub-sj 카드의 LINE 발송 버튼 핸들러
  //   AS/신규/VAN/소모품 모두 jobs[] 의 job 객체 — _openLineForJob 으로 일임
  //   rootId 가 주어지면 해당 ROOT entry 를 본문에 사용
  window._hubLineSend = function(jobId, rootId) {
    if (!jobId) return;
    try {
      const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
      const job = jobs.find(j => j.id === jobId);
      if (!job) { if (typeof showToast==='function') showToast('⚠ 업무를 찾을 수 없습니다'); return; }
      let entry = null;
      if (rootId && Array.isArray(job.thread)) {
        entry = job.thread.find(e => e && e.threadId === rootId);
      }
      if (typeof window._openLineForJob === 'function') {
        window._openLineForJob(job, { entry });
      } else if (typeof showToast==='function') {
        showToast('⚠ LINE 컴포저가 로드되지 않았습니다');
      }
    } catch(e) {
      console.warn('[_hubLineSend]', e);
      if (typeof showToast==='function') showToast('⚠ LINE 발송 준비 실패');
    }
  };

  function _hubRenderGroup(g, cat, opts) {
    opts = opts || {};
    const escFn = _hubEsc;
    const s = g.store || {};
    const undone = g.jobs.filter(j => !_hubDoneFn(j)).length;
    const totalCnt = g.jobs.length;
    const allDone = undone === 0;

    // byRoots — ROOT(요청접수) 단위로 카운트/렌더
    let cntTxt, cntClass = '', badgesHtml = '', subsHtml = '';
    if (opts.byRoots) {
      const incRoots = _groupIncomplete(g);
      const allRoots = _groupRoots(g);
      const doneRoots = _groupCompleted(g);
      cntTxt = (incRoots.length === 0)
        ? `완료 (${doneRoots.length})`
        : `${incRoots.length} 요청 · 총 ${allRoots.length}건`;
      cntClass = (incRoots.length > 0 && opts.urgentIfPending) ? ' urgent' : '';

      // 뱃지 — 진행/완료 요약
      const tags = [];
      if (incRoots.length) tags.push(`<span class="gbtag ${cat}">📥 진행 ${incRoots.length}</span>`);
      if (doneRoots.length) tags.push(`<span class="gbtag ${cat}" style="opacity:0.6">✅ 완료 ${doneRoots.length}</span>`);
      badgesHtml = tags.join('');

      // 서브 카드 — ROOT 별로 표시 (진행 먼저, 완료 나중)
      const sortedRoots = [];
      g.jobs.forEach(j => {
        _jobRoots(j).forEach(r => sortedRoots.push({ j, r, done: _rootIsDone(j, r) }));
      });
      sortedRoots.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;  // 미완료 먼저
        return String(b.r.ts||'').localeCompare(String(a.r.ts||'')); // 최신 먼저
      });
      subsHtml = sortedRoots.slice(0, 8).map(({ j, r, done }) => {
        const txt = (r.text || '').replace(/\s+/g,' ').slice(0, 70);
        const meta = j.asDueDate ? `예정 ${j.asDueDate}${j.asDueTime?' '+j.asDueTime:''}` : '';
        const onclick = j.id ? `editNewopen('${escFn(j.id)}')` : '';
        const lineBtn = (j.id && !r._synthetic) ? `<button class="hub-line-btn" title="📡 이 요청 LINE 발송" onclick="event.stopPropagation();window._hubLineSend('${escFn(j.id)}','${escFn(r.threadId||'')}')">📡</button>` : '';
        return `<div class="hub-sj" onclick="${onclick}">
          <div class="sjl">
            <span class="sjtag ${cat}" style="${done?'opacity:0.6':''}">${done?'✅ 완료':'📥 요청접수'}</span>
            <div class="sjti">${escFn(txt || '(내용 없음)')}</div>
            <div class="sjmt">${r.ts ? '📅 '+escFn(r.ts)+' · ' : ''}${escFn(r.author||'')}${meta?' · '+meta:''}</div>
          </div>
          ${lineBtn}
          <div class="sjwn ${done?'done':''}">${done?'완료':'진행중'}</div>
        </div>`;
      }).join('') + (sortedRoots.length > 8 ? `<div style="text-align:center;font-size:11px;color:var(--gray-400);padding:6px">... 외 ${sortedRoots.length - 8}건 (열어서 모두 보기)</div>` : '');
    } else {
      cntClass = (undone > 0 && opts.urgentIfPending) ? ' urgent' : '';
      cntTxt = allDone ? `완료 (${totalCnt})` : `${undone} 업무`;
      // 카테고리 뱃지
      const subCats = [...new Set(g.jobs.map(j => j.type || j.category || ''))].filter(Boolean).slice(0, 3);
      badgesHtml = subCats.map(c => `<span class="gbtag ${cat}">${escFn(c)}</span>`).join('');
      // 🏷️ 소모품 매장 내 정렬 규칙 (GLOBAL_RULE: supplies-store-sort):
      //   ① 미수 (postpaid · 잔액 > 0 · arPaid=false) → 최상단
      //   ② 그 외 → updatedAt > createdAt > shipDate (분 단위까지) desc
      //   완료/미완료 섞여도 미수가 항상 위. createdAt/updatedAt 은 ms 정밀도라
      //   같은 일자라도 등록 시·분 단위로 안정 정렬됨.
      if (cat === 'supplies') {
        const _isOutstanding = (j) => {
          const mode = j.supplyMode || ((Number(j.amount)>0 && /(후불|미수)/i.test(String(j.payment||j.note||j.notes||''))) ? 'postpaid' : (Number(j.amount)>0 ? 'prepaid' : 'support'));
          if (mode !== 'postpaid') return false;
          if (j.arPaid) return false;
          const amt = Number(j.amount)||0;
          const paid = Number(j.arPaidAmount)||0;
          return Math.max(0, amt - paid) > 0;
        };
        const _touch = (j) => {
          let v = Number(j.updatedAt||0) || Number(j.createdAt||0);
          if (!v && j.shipDate) { const t = Date.parse(String(j.shipDate).replace(' ','T')); if (!isNaN(t)) v = t; }
          return v;
        };
        g.jobs = g.jobs.slice().sort((a,b) => {
          const ao = _isOutstanding(a) ? 0 : 1;
          const bo = _isOutstanding(b) ? 0 : 1;
          if (ao !== bo) return ao - bo;       // 미수 먼저
          return _touch(b) - _touch(a);         // 최신 먼저 (분 단위)
        });
      }
      subsHtml = g.jobs.map(j => {
        const dd = _hubDday(j);
        const wnCls = dd.urgent ? 'urgent' : (dd.done ? 'done' : '');
        const who = j.engineer || j.assignee || '';
        const memos = Array.isArray(j.memos) ? j.memos.length : 0;
        // 글로벌 규칙: 카테고리별 일자 fallback chain — 날짜 무조건 표시
        const date = j.shipDate || j.installDate || j.openDate
                  || (j.asReceivedAt ? String(j.asReceivedAt).slice(0,10) : '')
                  || j.date
                  || (j.createdAt ? new Date(j.createdAt).toISOString().slice(0,10) : '-');
        const onclick = j.id ? `editNewopen('${escFn(j.id)}')` : '';
        const lineBtn = j.id ? `<button class="hub-line-btn" title="📡 LINE 발송" onclick="event.stopPropagation();window._hubLineSend('${escFn(j.id)}','')">📡</button>` : '';
        // 🏷️ 소모품 — [날짜][품목규격 수량단위 처리구분] · 금액  상세 표시
        //   글로벌 규칙: list-detail-rule — 리스트는 한 줄에서 바로 처리 가능한 정보 모두 노출
        //   (품목명·규격·수량·단위·처리구분·금액·미수)
        let titleHtml;
        if (cat === 'supplies') {
          const fmt = n => (Number(n)||0).toLocaleString();
          // 품목 + 규격 매핑 — sub-card 에 "3" POS용지" 처럼 규격이 보이도록
          const SUPPLY_DISPLAY = {
            '소모품/POS용지':   { name: 'POS용지',   spec: '3"' },
            '소모품/단말용지':  { name: '이동단말기 용지', spec: '57×30' },
            '소모품/가격라벨':  { name: '가격라벨',  spec: '40×23' },
            '소모품/프라이스텍':{ name: '프라이스텍', spec: '70×35' },
            '소모품/저울라벨':  { name: '저울라벨',  spec: '58×40' },
            '소모품/기타':      { name: '기타',      spec: '' },
          };
          const typeKey = String(j.type||'');
          const disp = SUPPLY_DISPLAY[typeKey] || { name: typeKey.replace(/^소모품\//,'') || '소모품', spec: '' };
          // ✏️ '소모품/기타' 는 사용자 입력 supplyEtcName 우선
          let dispName = disp.name;
          if (typeKey === '소모품/기타' && j.supplyEtcName) {
            dispName = String(j.supplyEtcName).trim() || disp.name;
          }
          const itemShort = disp.spec ? `${disp.spec} ${dispName}` : dispName;
          // 수량 + 단위 — ① supplyQty 숫자 ② supplyQty 문자열("5 박스") ③ asRequest/notes 자연어 파싱 순
          let qty = Number(j.supplyQty);
          let unit = j.supplyUnit || '';
          if (!Number.isFinite(qty) || qty === 0) {
            const m = String(j.supplyQty||'').match(/(\d+(?:\.\d+)?)\s*(\S*)/);
            if (m) { qty = parseFloat(m[1])||0; if (!unit && m[2]) unit = m[2]; }
          }
          // ③ supplyQty 없으면 asRequest / lineParsed / notes 자연어에서 수량 파싱
          if (!qty) {
            const _qSrc = String(j.asRequest || j.lineParsed || j.notes || '');
            const _KNUM = {한:1,두:2,세:3,네:4,다섯:5,여섯:6,일곱:7,여덟:8,아홉:9,열:10};
            const _nm = _qSrc.match(/(\d+)\s*(박스|봉지|롤|장|개|묶음|set|세트)/i);
            if (_nm) { qty = parseInt(_nm[1])||0; if (!unit) unit = _nm[2]; }
            else {
              const _km = _qSrc.match(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(박스|봉지|롤|장|개|묶음)/);
              if (_km) { qty = _KNUM[_km[1]]||1; if (!unit) unit = _km[2]; }
            }
          }
          const qtyTxt = qty > 0 ? ` ${qty}${unit||''}` : '';
          // 처리 구분 라벨 + 색
          const mode = j.supplyMode || ((j.amount > 0) ? (/(후불|미수)/i.test(String(j.payment||j.note||j.notes||''))?'postpaid':'prepaid') : 'support');
          const amt = Number(j.amount)||0;
          const paid = Number(j.arPaidAmount)||0;
          const remaining = Math.max(0, amt - paid);
          let modeTxt = '', modeColor = 'var(--gray-600)', amtTxt = '';
          if (mode === 'support') {
            modeTxt = '🎁 지원'; modeColor = '#15803d';
          } else if (mode === 'prepaid') {
            modeTxt = '💰 선불'; modeColor = '#06B6D4';
            // 선불 = 판매(발송) 시 수금 → 수금일 함께 표기
            amtTxt = ` · ${fmt(amt)}원${date ? ` · 수금 ${escFn(date)}` : ''}`;
          } else if (mode === 'postpaid') {
            if (j.arPaid || (amt>0 && remaining === 0)) {
              modeTxt = '✅ 수금완료'; modeColor = '#15803d';
              amtTxt = ` · ${fmt(amt)}원`;
            } else {
              modeTxt = '📌 후불 미수'; modeColor = '#F59E0B';
              const partial = paid > 0 ? ` (부분 ${fmt(paid)})` : '';
              amtTxt = ` · ${fmt(remaining)}원${partial}`;
            }
          }
          // 최종: [날짜] [규격 품목명 N단위 처리구분] [요청 담당자] · 금액
          titleHtml = `<span style="color:var(--gray-500);font-weight:600">[${escFn(date)}]</span> `
                    + `<span style="color:var(--gray-800);font-weight:800">[${escFn(itemShort)}${escFn(qtyTxt)} </span>`
                    + `<span style="color:${modeColor};font-weight:700">${modeTxt}</span>`
                    + `<span style="color:var(--gray-800);font-weight:800">]</span>`
                    + `<span style="color:${modeColor};font-size:11px;font-weight:600">${amtTxt}</span>`
                    + (who ? ` <span style="color:var(--gray-600);font-size:11px;font-weight:700">[요청 ${escFn(who)}]</span>` : '');
        } else if (cat === 'as') {
          // AS 작업(job) 단위 카드 — 첫 ROOT(원본 요청) 우선 표시 + 미처리 요청 수 배지 + 예정일.
          //   완료된 건도 원본 요청을 보여줘 어떤 건이었는지 파악 가능 (CLAUDE.md 완료 노출 규칙)
          const _roots = _jobRoots(j);
          const _first = _roots.find(r => r && r.parentId === null) || _roots[0];
          const reqTxt = String((_first && _first.text) || j.asRequest || j.lineRequest || j.lineParsed || j.notes || j.memo || '(요청 내용 없음)').replace(/\s+/g,' ').slice(0,70);
          const _inc = _jobIncompleteRoots(j).length;
          const multiReq = (_roots.length > 1)
            ? ` <span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:1px 5px;border-radius:3px;font-weight:700;vertical-align:middle">요청 ${_roots.length}${_inc?` · 미처리 ${_inc}`:''}</span>`
            : '';
          const dueTxt = j.asDueDate ? ` <span style="color:#b45309;font-size:11px;font-weight:600">· 예정 ${escFn(j.asDueDate)}${j.asDueTime?' '+escFn(j.asDueTime):''}</span>` : '';
          titleHtml = `<span style="color:var(--gray-800);font-weight:700">${escFn(reqTxt)}</span>${multiReq}${dueTxt}`;
        } else {
          // 비-소모품 — 기존 표시
          titleHtml = `${escFn(j.title || j.type || '업무')}`;
        }
        // 🔗 소모품 미연결 가맹점 연결 버튼 — linkRegisteredStore() 재사용
        const storeLinkBtn = (cat === 'supplies' && j.id)
          ? ((j.unregistered || !j.storeId)
            ? `<button class="hub-line-btn" style="background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;border-radius:5px;padding:3px 8px;cursor:pointer;font-weight:700;font-size:11px;white-space:nowrap;margin-left:3px" title="등록된 가맹점에 연결" onclick="event.stopPropagation();linkRegisteredStore('${escFn(j.id)}')">🔗 연결</button>`
            : `<button class="hub-line-btn" style="color:var(--gray-400);border:1px solid var(--gray-200);border-radius:5px;padding:3px 6px;cursor:pointer;font-size:11px;white-space:nowrap;margin-left:3px" title="가맹점 연결 해제" onclick="event.stopPropagation();unlinkStore('${escFn(j.id)}')">🔓</button>`)
          : '';
        return `<div class="hub-sj" onclick="${onclick}">
          <div class="sjl">
            <span class="sjtag ${cat}">${escFn(j.type || cat)}</span>
            <div class="sjti">${titleHtml}${cat === 'supplies' && (j.unregistered || !j.storeId) ? ' <span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:1px 5px;border-radius:3px;font-weight:700;vertical-align:middle">미등록</span>' : ''}</div>
            <div class="sjmt">${cat !== 'supplies' && date ? '📅 '+escFn(date)+' · ' : ''}${cat !== 'supplies' && who ? escFn(who)+' · ' : ''}${memos?'메모 '+memos+'건':''}</div>
          </div>
          ${storeLinkBtn}${lineBtn}
          <div class="sjwn ${wnCls}">${dd.text}</div>
        </div>`;
      }).join('');
    }

    // 매장 클릭: 매장 상세 모달 열기 (toggleStoreDetail 가 row 를 요구 — 가짜 row 만들기)
    const sIdAttr = s.id ? `data-store-id="${escFn(s.id)}"` : '';
    const onStoreClick = s.id ? `event.stopPropagation();_hubOpenStoreById('${escFn(s.id)}')` : `event.stopPropagation();showToast('매장 정보 없음')`;
    const metaParts = [];
    if (s.biz) metaParts.push(escFn(s.biz));
    if (s.addr) metaParts.push(escFn(s.addr));
    if (s.van) metaParts.push(escFn(s.van) + ' VAN');
    const metaTxt = metaParts.join(' · ') || '';

    return `<div class="hub-group cat-${cat}" ${sIdAttr}>
      <div class="hub-ghead" onclick="this.parentElement.classList.toggle('expanded')">
        <div class="gleft">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="gname" onclick="${onStoreClick}">${escFn(g.storeName)}</span>
            ${s.status ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;background:#d1fae5;color:#065f46">${escFn(s.status)}</span>` : ''}
          </div>
          <div class="gmeta">${metaTxt}</div>
          <div class="gbadges">${badgesHtml}</div>
        </div>
        <div class="gright">
          <span class="gcnt${cntClass}">${cntTxt}</span>
          <span class="gchev">▶</span>
        </div>
      </div>
      <div class="hub-gjobs">${subsHtml}</div>
    </div>`;
  }

  // 매장 ID 로 상세 모달 열기 (가짜 row 만들어서 toggleStoreDetail 호출)
  // toggleStoreDetail 는 tr.parentElement.querySelectorAll('tr') 를 사용하므로
  // tr 을 tbody 안에 넣어둬야 함 — DOM 에는 안 붙여도 부모 관계만 있으면 OK
  window._hubOpenStoreById = function(storeId) {
    if (!storeId) return;
    if (typeof window.toggleStoreDetail !== 'function') {
      console.warn('[_hubOpenStoreById] toggleStoreDetail not loaded');
      return;
    }
    // 점포 테이블에서 row 찾기 우선 (있으면 그대로 사용 — 자연스러운 outline 효과)
    const realTr = document.querySelector(`#savedStoresTable tr[data-store-id="${storeId}"]`);
    if (realTr) {
      window.toggleStoreDetail(realTr);
      return;
    }
    // 가짜 row + tbody 컨테이너 만들기 (parentElement 가 null 이면 toggleStoreDetail 가 throw)
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const s = stores.find(x => x.id === storeId);
    if (!s) {
      if (typeof showToast === 'function') showToast('⚠ 매장 정보를 찾을 수 없습니다');
      return;
    }
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    tr.dataset.storeId = storeId;
    tr.innerHTML = `<td><b>${_hubEsc(s.name||'')}</b></td><td>${_hubEsc(s.biz||'')}</td><td>${_hubEsc(s.ceo||'')}</td><td>${_hubEsc(s.tel||'')}</td><td>${_hubEsc(s.addr||'')}</td><td><span class="badge">${_hubEsc(s.van||'')}</span></td><td><span class="pk-chip">POS ${s.pos||0}</span></td><td></td><td><span class="badge">${_hubEsc(s.status||'거래중')}</span></td>`;
    tbody.appendChild(tr);
    try {
      window.toggleStoreDetail(tr);
    } catch(e) {
      console.warn('[_hubOpenStoreById] toggleStoreDetail 실패:', e);
      if (typeof showToast === 'function') showToast('⚠ 매장 상세 모달 열기 실패: ' + e.message);
    }
  };

  // 신규 hub 렌더
  // 🛡 어른거림(flicker) 방지 공통 헬퍼 — el 의 직전 렌더 시그니처(__rgSig)와 같으면 true(=재렌더 skip).
  //   사용: if (window._sigSkip(el, sig)) return;  또는  if (!window._sigSkip(el, sig)) el.innerHTML = html;
  //   주기적 동기화(20~30초)·ns:data-changed·storage 이벤트가 내용 동일한데도 innerHTML 을 통째
  //   교체해 DOM 재생성 + CSS 펄스 애니메이션 재시작으로 깜빡이던 문제 차단.
  //   (_hubGenericRender 의 __hubSig 와 동일 원리를 가드 없는 렌더 함수들에 일괄 적용)
  window._sigSkip = function(el, sig){
    if (!el) return true;
    if (el.__rgSig === sig && el.childElementCount > 0) return true;
    el.__rgSig = sig;
    return false;
  };

  window.renderNewHub = function() {
    const container = document.getElementById('newhubContainer');
    if (!container) return;
    const search = (document.getElementById('newhubSearch')?.value || '').trim().toLowerCase();
    const filter = document.querySelector('#newhubFilters .hub-filter.active')?.dataset.filter || 'all';

    const groups = _hubGroupByStore(j => window.classifyJobCategory(j) === 'new');
    // 검색 필터
    let displayed = groups.filter(g => !search || g.storeName.toLowerCase().includes(search));
    // 상태 필터
    if (filter === 'progress') displayed = displayed.filter(g => g.jobs.some(j => !_hubDoneFn(j)));
    else if (filter === 'done') displayed = displayed.filter(g => g.jobs.every(j => _hubDoneFn(j)));

    // 카운트
    const cntAll = groups.length;
    const cntProg = groups.filter(g => g.jobs.some(j => !_hubDoneFn(j))).length;
    const cntDone = groups.filter(g => g.jobs.every(j => _hubDoneFn(j))).length;
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('newhubCntAll', cntAll);
    setTxt('newhubCntProg', cntProg);
    setTxt('newhubCntDone', cntDone);

    if (displayed.length === 0) {
      if (!window._sigSkip(container, 'newhub-empty|' + (search ? 's' : '')))
        container.innerHTML = `<div class="hub-empty"><div style="font-size:32px;margin-bottom:8px">📭</div>${search ? '검색 결과 없음' : '진행 중인 신규 업무가 없습니다'}</div>`;
      return;
    }
    // 진행 중 → 완료 순 정렬
    displayed.sort((a,b) => {
      const aUndone = a.jobs.some(j => !_hubDoneFn(j)) ? 0 : 1;
      const bUndone = b.jobs.some(j => !_hubDoneFn(j)) ? 0 : 1;
      return aUndone - bUndone;
    });
    // 🛡 어른거림 방지 — 내용 시그니처 동일하면 재구축 skip (펼침/스크롤 상태 유지)
    const _sig = JSON.stringify(displayed.map(g => [
      g.storeId || g.storeName,
      g.jobs.map(j => [j.id, j.status, j.completed?1:0, j.updatedAt||0, (Array.isArray(j.thread)?j.thread.length:0)])
    ]));
    if (window._sigSkip(container, 'newhub|' + _sig)) return;
    container.innerHTML = displayed.map(g => _hubRenderGroup(g, 'new', { urgentIfPending: true })).join('');
  };

  // 필터/검색 이벤트 바인딩 (한 번만)
  (function _bindNewHubEvents(){
    document.addEventListener('click', (ev) => {
      const f = ev.target.closest('#newhubFilters .hub-filter');
      if (!f) return;
      f.parentElement.querySelectorAll('.hub-filter').forEach(x => x.classList.remove('active'));
      f.classList.add('active');
      if (typeof renderNewHub === 'function') renderNewHub();
    });
    const sIn = document.getElementById('newhubSearch');
    if (sIn) sIn.addEventListener('input', () => { if (typeof renderNewHub === 'function') renderNewHub(); });
  })();

  /* ─── 공용 hub 렌더 generator (AS/VAN/Supplies 공유) ─── */
  // ROOT(요청접수) 단위 헬퍼 — AS/신규처럼 thread 그룹화된 카테고리에서 사용
  function _jobRoots(j) {
    if (!j) return [];
    const roots = (Array.isArray(j.thread) ? j.thread : []).filter(e => e && e.parentId === null);
    if (roots.length > 0) return roots;
    // thread ROOT 가 없는 skeleton(LINE/수동 등록 직후 thread=0) → 가상 ROOT 1개로 취급.
    //   AS/신규 Hub 가 ROOT 단위라 thread=0 작업이 카드·카운트에서 통째 누락되던 문제 해결.
    const txt = String(j.asRequest || j.notes || j.lineParsed || j.lineRequest || j.lineRaw || j.memo || '').replace(/\s+/g,' ').trim();
    let ts = (j.asReceivedAt || '').slice(0,16).replace('T',' ');
    if (!ts && j.createdAt) { const t = Number(j.createdAt) || Date.parse(j.createdAt); if (t) ts = new Date(t).toISOString().slice(0,16).replace('T',' '); }
    return [{ _synthetic: true, threadId: '_virt-' + (j.id||''), parentId: null, text: txt || '(요청 내용 없음)', ts, author: j.engineer || j.assignee || '' }];
  }
  function _rootIsDone(j, root) {
    // 가상 ROOT(thread=0 skeleton)는 job 자체의 완료 판정을 따름 (status/완료 정합)
    if (root && root._synthetic) {
      return !!(window._isJobEffectivelyDone ? window._isJobEffectivelyDone(j) : (j.completed || /완료/.test(j.status||'')));
    }
    return (j.thread||[]).some(e => e && e.parentId === root.threadId && e.status === '완료');
  }
  function _jobIncompleteRoots(j) { return _jobRoots(j).filter(r => !_rootIsDone(j, r)); }
  function _jobCompletedRoots(j) { return _jobRoots(j).filter(r =>  _rootIsDone(j, r)); }
  // 매장 그룹의 ROOT 총합/미완료/완료
  function _groupRoots(g)         { return g.jobs.flatMap(j => _jobRoots(j)); }
  function _groupIncomplete(g)    { return g.jobs.flatMap(j => _jobIncompleteRoots(j)); }
  function _groupCompleted(g)     { return g.jobs.flatMap(j => _jobCompletedRoots(j)); }

  function _hubGenericRender(opts) {
    // opts: { containerId, filtersId, searchId, cats:[...], cardCat, urgentIfPending, byRoots, includeChurn, extraFilter }
    const container = document.getElementById(opts.containerId);
    if (!container) return;
    const search = (document.getElementById(opts.searchId)?.value || '').trim().toLowerCase();
    const filter = document.querySelector(`#${opts.filtersId} .hub-filter.active`)?.dataset.filter || 'all';

    const catSet = new Set(opts.cats);
    const groups = _hubGroupByStore(j => catSet.has(window.classifyJobCategory(j)));

    let displayed = groups.filter(g => !search || g.storeName.toLowerCase().includes(search));
    // 소모품 카드 필터용 술어 (미수 / 발송대기) — 대시보드 카드 정의와 동일
    const _arFn = (j) => (typeof window._supIsOutstanding === 'function')
      ? window._supIsOutstanding(j)
      : /후불|미수|outstanding/i.test(String(j.payment||j.note||j.notes||''));
    const _shipFn = (j) => (typeof window._supIsPendingShip === 'function')
      ? window._supIsPendingShip(j)
      : (!j.shipDate && !_hubDoneFn(j));
    // ROOT 기반 필터 (AS/신규) — 그룹 안의 ROOT 가 진행/완료 인지로 판정
    if (opts.byRoots) {
      if (filter === 'progress') displayed = displayed.filter(g => _groupIncomplete(g).length > 0);
      else if (filter === 'done') displayed = displayed.filter(g => _groupRoots(g).length > 0 && _groupIncomplete(g).length === 0);
      else if (filter === 'urgent') displayed = displayed.filter(g => g.jobs.some(j => !_hubDoneFn(j) && _hubDday(j).urgent));
      else if (filter === 'ar') displayed = displayed.filter(g => g.jobs.some(_arFn));
    } else {
      if (filter === 'progress') displayed = displayed.filter(g => g.jobs.some(j => !_hubDoneFn(j)));
      else if (filter === 'done') displayed = displayed.filter(g => g.jobs.every(j => _hubDoneFn(j)));
      else if (filter === 'urgent') displayed = displayed.filter(g => g.jobs.some(j => !_hubDoneFn(j) && _hubDday(j).urgent));
      else if (filter === 'ar') displayed = displayed.filter(g => g.jobs.some(_arFn));
      else if (filter === 'ship') displayed = displayed.filter(g => g.jobs.some(_shipFn));
    }
    // 🏷️ 카드 필터(미수/발송대기) — '해당 내역만' 보이도록 그룹 내 작업도 매칭 건만 남김
    if (filter === 'ar' || filter === 'ship') {
      const _p = (filter === 'ar') ? _arFn : _shipFn;
      displayed = displayed.map(g => Object.assign({}, g, { jobs: g.jobs.filter(_p) })).filter(g => g.jobs.length);
    }

    // 카운트 갱신 — byRoots 면 ROOT 단위, 아니면 매장 단위
    let cnts;
    if (opts.byRoots) {
      const allRoots = groups.flatMap(_groupRoots);
      const progRoots = groups.flatMap(_groupIncomplete);
      const doneRoots = groups.flatMap(_groupCompleted);
      const urgentRoots = groups.flatMap(g => g.jobs.flatMap(j => _jobIncompleteRoots(j).filter(r => _hubDday(j).urgent)));
      cnts = {
        all: allRoots.length,
        prog: progRoots.length,
        done: doneRoots.length,
        urgent: urgentRoots.length,
        ar: groups.filter(g => g.jobs.some(j => /후불|미수/i.test(String(j.payment||j.note||j.notes||'')))).length,
      };
    } else if (opts.countByJob) {
      // 작업(job) 단위 카운트 — AS: 대시보드(메인)와 동일 기준으로 통일.
      //   한 작업에 미처리 요청(ROOT)이 여러 개여도 1건. (CLAUDE.md AS 카운트 단위 = 작업)
      const allJobs = groups.flatMap(g => g.jobs);
      cnts = {
        all: allJobs.length,
        prog: allJobs.filter(j => !_hubDoneFn(j)).length,
        done: allJobs.filter(j => _hubDoneFn(j)).length,
        urgent: allJobs.filter(j => !_hubDoneFn(j) && _hubDday(j).urgent).length,
        ar: groups.filter(g => g.jobs.some(j => /후불|미수/i.test(String(j.payment||j.note||j.notes||'')))).length,
      };
    } else {
      cnts = {
        all: groups.length,
        prog: groups.filter(g => g.jobs.some(j => !_hubDoneFn(j))).length,
        done: groups.filter(g => g.jobs.every(j => _hubDoneFn(j))).length,
        urgent: groups.filter(g => g.jobs.some(j => !_hubDoneFn(j) && _hubDday(j).urgent)).length,
        ar: groups.filter(g => g.jobs.some(_arFn)).length,
        ship: groups.filter(g => g.jobs.some(_shipFn)).length,
      };
    }
    if (opts.cntMap) Object.entries(opts.cntMap).forEach(([k, id]) => {
      const el = document.getElementById(id); if (el && cnts[k] !== undefined) el.textContent = cnts[k];
    });

    // 🛡 백그라운드 sync 재렌더 시 열려있던 매장 그룹의 expand 상태 보존
    //   - 재렌더 전: 현재 expanded 된 매장 storeId 수집
    //   - 재렌더 후: 같은 storeId 의 그룹에 'expanded' class 재부여
    const _prevExpanded = new Set();
    container.querySelectorAll('.hub-group.expanded[data-store-id]').forEach(g => {
      const sid = g.getAttribute('data-store-id');
      if (sid) _prevExpanded.add(sid);
    });
    // storeId 없는 그룹 (legacy 매장명 기반) — 매장명으로도 보존
    const _prevExpandedByName = new Set();
    container.querySelectorAll('.hub-group.expanded:not([data-store-id])').forEach(g => {
      const nameEl = g.querySelector('.gname');
      if (nameEl) _prevExpandedByName.add((nameEl.textContent||'').trim());
    });

    if (displayed.length === 0) {
      container.innerHTML = `<div class="hub-empty"><div style="font-size:32px;margin-bottom:8px">📭</div>${search ? '검색 결과 없음' : '진행 중인 업무가 없습니다'}</div>`;
      return;
    }
    // 정렬: ① 진행중 그룹 먼저, 완료 그룹 뒤 ② 같은 그룹 내에서는 최근 활동 desc
    // lastTouch = updatedAt / createdAt / thread 마지막 ts / doneAt 중 최대
    const _toMs = (v) => {
      if (!v) return 0;
      if (typeof v === 'number') return v;
      const t = Date.parse(String(v).replace(' ', 'T'));
      return isNaN(t) ? 0 : t;
    };
    const _groupLastTouch = (g) => {
      let max = 0;
      for (const j of g.jobs) {
        max = Math.max(max,
          _toMs(j.updatedAt), _toMs(j.createdAt),
          _toMs(j.completedAt), _toMs(j.doneAt));
        if (Array.isArray(j.thread)) {
          for (const e of j.thread) max = Math.max(max, _toMs(e?.ts));
        }
      }
      return max;
    };
    // 등록일 = 그룹 내 작업의 createdAt(없으면 첫 ROOT ts) 최대값
    const _groupRegTime = (g) => {
      let max = 0;
      for (const j of g.jobs) {
        let t = _toMs(j.createdAt) || _toMs(j.asReceivedAt);
        if (!t && Array.isArray(j.thread)) { const r = j.thread.find(e=>e&&e.parentId==null); if (r) t = _toMs(r.ts); }
        max = Math.max(max, t);
      }
      return max;
    };
    const _sortBy = opts.sortBy || 'recent';   // 'recent'(최근 등록순, 기본) | 'name'(매장명순)
    // 매장명 정렬 키 — 법인 표기(㈜/(주)/주식회사 등)·앞 기호 제거해 '의미있는 상호'로 정렬.
    //   예: "(주)비앤씨리테일" / "비앤씨리테일주식회사" → 둘 다 "비앤씨리테일" → 함께·가나다 정확.
    const _storeSortKey = (name) => {
      let s = String(name||'').trim();
      s = s.replace(/㈜/g,'')
           .replace(/\(\s*(주|유|재|사|합|특|복)\s*\)/g,'')
           .replace(/(주식회사|유한회사|유한책임회사|합자회사|합명회사|사단법인|재단법인|농업회사법인|영농조합법인)/g,'');
      s = s.replace(/^[\s()\[\]{}·.,\-_/＊*'"]+/,'').trim();
      return s || String(name||'').trim();
    };
    displayed.forEach(g => {
      g._lastTouch = _groupLastTouch(g);
      g._regTime = _groupRegTime(g);
      g._hasProg = g.jobs.some(j => !_hubDoneFn(j));
      g._nameKey = _storeSortKey(g.storeName);
    });
    displayed.sort((a,b) => {
      if (_sortBy === 'name') {
        // 매장명순 — 정규화 상호 기준 가나다(숫자 자연 정렬). 동일 상호면 진행중 우선.
        const c = a._nameKey.localeCompare(b._nameKey, 'ko', { numeric:true, sensitivity:'base' });
        if (c !== 0) return c;
        if (a._hasProg !== b._hasProg) return a._hasProg ? -1 : 1;
        return (b._regTime||0) - (a._regTime||0);
      }
      // 최근 등록순(기본): 진행중 우선 → 등록일 desc (없으면 최근 활동 desc)
      if (a._hasProg !== b._hasProg) return a._hasProg ? -1 : 1;
      return (b._regTime||0) - (a._regTime||0) || (b._lastTouch||0) - (a._lastTouch||0);
    });
    // 🛡 자글거림(flicker) 방지 — 렌더 결과가 직전과 동일하면 innerHTML 재구축 스킵.
    //   백그라운드 동기화(30초)마다 전체 재구축돼 깜빡이던 문제 해결. 카운트 badge 는 위에서 이미 갱신됨.
    //   signature = 필터/정렬/검색 반영된 displayed 의 핵심 식별자(매장·작업·상태·thread수·mtime).
    const _sig = JSON.stringify(displayed.map(g => [
      g.storeId || g.storeName, g._hasProg,
      g.jobs.map(j => [j.id, j.status, j.completed?1:0, j.updatedAt||0, (Array.isArray(j.thread)?j.thread.length:0)])
    ]));
    if (container.__hubSig === _sig && container.childElementCount > 0 && !container.querySelector('.hub-empty')) {
      return;  // 내용 동일 → 재구축·재정렬 스킵 (현재 DOM·펼침 상태 유지)
    }
    container.__hubSig = _sig;
    container.innerHTML = displayed.map(g => _hubRenderGroup(g, opts.cardCat, { urgentIfPending: !!opts.urgentIfPending, byRoots: !!opts.byRoots })).join('');
    // expand 상태 복원 — 사용자가 펼쳐둔 매장이 백그라운드 sync 로 닫히지 않도록
    if (_prevExpanded.size > 0 || _prevExpandedByName.size > 0) {
      container.querySelectorAll('.hub-group').forEach(g => {
        const sid = g.getAttribute('data-store-id');
        if (sid && _prevExpanded.has(sid)) { g.classList.add('expanded'); return; }
        if (!sid) {
          const nameEl = g.querySelector('.gname');
          const nm = nameEl ? (nameEl.textContent||'').trim() : '';
          if (nm && _prevExpandedByName.has(nm)) g.classList.add('expanded');
        }
      });
    }
  }

  /* ─── AS hub ─── */
  window.renderAsHub = function() {
    _hubGenericRender({
      containerId: 'ashubContainer',
      filtersId: 'ashubFilters',
      searchId: 'ashubSearch',
      cats: ['as', 'churn'],
      cardCat: 'as',
      urgentIfPending: true,
      byRoots: false,    // AS — 작업(job) 단위 카드 (대시보드와 카운트 통일)
      countByJob: true,  // 카운트도 작업 단위 = 메인 대시보드와 동일(18)
      sortBy: (window._asHubSort || 'recent'),  // 'recent'(최근 등록순) | 'name'(매장명순)
      cntMap: { all:'ashubCntAll', prog:'ashubCntProg', done:'ashubCntDone', urgent:'ashubCntUrg' },
    });
  };
  // AS hub 정렬 라디오 — 기본 최근 등록순, 매장명순 토글
  window._asHubSort = window._asHubSort || 'recent';
  window.setAsHubSort = function(mode) {
    window._asHubSort = (mode === 'name') ? 'name' : 'recent';
    document.querySelectorAll('#ashubFilters .ashub-sort').forEach(b =>
      b.classList.toggle('active', b.dataset.sort === window._asHubSort));
    if (typeof renderAsHub === 'function') renderAsHub();
  };
  (function _bindAsHubEvents(){
    document.addEventListener('click', (ev) => {
      const f = ev.target.closest('#ashubFilters .hub-filter');
      if (!f) return;
      f.parentElement.querySelectorAll('.hub-filter').forEach(x => x.classList.remove('active'));
      f.classList.add('active');
      if (typeof renderAsHub === 'function') renderAsHub();
    });
    const sIn = document.getElementById('ashubSearch');
    if (sIn) sIn.addEventListener('input', () => { if (typeof renderAsHub === 'function') renderAsHub(); });
  })();

  /* ─── 일정조회 (Schedule Hub) ─── */
  window._scheduleHubState = window._scheduleHubState || {
    year: null, month: null, // 0-based month
    cat: 'all',
    scope: 'all',       // 'all' 전체 일정 | 'mine' 내 일정
    selectedDate: null, // 'YYYY-MM-DD'
  };
  window._scheduleHubSetScope = function(el, scope) {
    const st = window._scheduleHubState;
    st.scope = scope;
    try {
      el.parentElement.querySelectorAll('.sched-scope').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    } catch(e){}
    window.renderScheduleHub();
  };
  // "내 일정" 판정 — 현재 사용자가 담당/생성/처리/thread 작성자/요청별 담당 중 하나
  window._scheduleHubIsMine = function(j) {
    const me = (typeof _currentUserName === 'function') ? _currentUserName() : '';
    if (!me || me === '익명') return false;
    if ([j.engineer, j.assignee, j.createdBy, j.completedBy, j.owner, j.lastEditedBy].some(x => x && x === me)) return true;
    if (Array.isArray(j.thread) && j.thread.some(e => e && (e.assignee === me || e.author === me))) return true;
    return false;
  };
  window._scheduleHubInitState = function() {
    const st = window._scheduleHubState;
    if (st.year === null || st.month === null) {
      const d = new Date();
      st.year = d.getFullYear();
      st.month = d.getMonth();
    }
  };
  window._scheduleHubNavMonth = function(delta) {
    const st = window._scheduleHubState;
    window._scheduleHubInitState();
    st.month += delta;
    while (st.month < 0) { st.month += 12; st.year -= 1; }
    while (st.month > 11) { st.month -= 12; st.year += 1; }
    st.selectedDate = null;
    window.renderScheduleHub();
  };
  window._scheduleHubGoToday = function() {
    const st = window._scheduleHubState;
    const d = new Date();
    st.year = d.getFullYear(); st.month = d.getMonth();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    st.selectedDate = `${d.getFullYear()}-${m}-${day}`;
    window.renderScheduleHub();
  };
  window._scheduleHubSetCat = function(el, cat) {
    const st = window._scheduleHubState;
    st.cat = cat;
    try {
      el.parentElement.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    } catch(e){}
    window.renderScheduleHub();
  };
  window._scheduleHubClearDate = function() {
    window._scheduleHubState.selectedDate = null;
    window.renderScheduleHub();
  };
  window._scheduleHubGetDate = function(j) {
    // 우선순위: scheduleDate, asDueDate, asReceivedAt(AS 접수일 — 예정일 없을 때 fallback),
    //          installDate, softOpenDate, openDate, date
    const keys = ['scheduleDate','asDueDate','asReceivedAt','installDate','softOpenDate','openDate','date'];
    for (const k of keys) {
      const v = j && j[k];
      if (v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
    }
    return null;
  };
  // 작업 → 캘린더 일정 entry 배열. AS 는 접수일·예정일을 모두 별도 entry 로 노출.
  window._scheduleHubGetDates = function(j) {
    const norm = (v) => (v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v.slice(0,10) : null;
    const cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
    if (cat === 'as') {
      const out = [];
      const rec = norm(j.asReceivedAt);
      const due = norm(j.asDueDate);
      if (rec) out.push({ ymd: rec, role: 'received' });
      if (due && due !== rec) out.push({ ymd: due, role: 'due' });
      if (out.length) return out;
    }
    const single = window._scheduleHubGetDate(j);
    return single ? [{ ymd: single, role: 'default' }] : [];
  };
  window._scheduleHubRoleLabel = function(role) {
    return ({ received: '📥 접수', due: '📅 예정' })[role] || '';
  };
  window._scheduleHubCatColor = function(cat) {
    return ({ new:'#3B82F6', as:'#EF4444', van:'#8B5CF6', supplies:'#F59E0B', churn:'#6B7280' })[cat] || '#9CA3AF';
  };
  window._scheduleHubCatLabel = function(cat) {
    return ({ new:'🆕 신규', as:'🔧 AS', van:'📑 VAN', supplies:'🏷️ 소모품', churn:'🏪 이탈' })[cat] || cat;
  };
  window._scheduleHubEsc = function(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  };
  window._scheduleHubOpenStore = function(ev, storeId, storeName) {
    try { ev && ev.stopPropagation && ev.stopPropagation(); } catch(e){}
    if (storeId && typeof window._hubOpenStoreById === 'function') {
      try { window._hubOpenStoreById(storeId); return; } catch(e){}
    }
    try { typeof showToast === 'function' && showToast(storeName ? `매장: ${storeName}` : '매장 정보 없음'); } catch(e){}
  };
  window._scheduleHubOpenJob = function(jobId) {
    if (!jobId) return;
    try { if (typeof editNewopen === 'function') { editNewopen(jobId); return; } } catch(e){}
    try { typeof showToast === 'function' && showToast('작업 편집 화면 없음'); } catch(e){}
  };
  window._scheduleHubSelectDate = function(ymd) {
    const st = window._scheduleHubState;
    st.selectedDate = (st.selectedDate === ymd) ? null : ymd;
    window.renderScheduleHub();
  };

  window.renderScheduleHub = function() {
    window._scheduleHubInitState();
    const st = window._scheduleHubState;
    const esc = window._scheduleHubEsc;
    const showDone = !!document.getElementById('scheduleHubShowDone')?.checked;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];

    // 헤더 라벨
    const label = `${st.year}년 ${st.month+1}월`;
    const lblEl = document.getElementById('scheduleHubMonthLabel');
    if (lblEl) lblEl.textContent = label;

    // 일정이 있는 작업만 추출 (날짜+카테고리 포함) — AS 는 접수일·예정일 각각 entry 생성
    const dated = [];
    for (const j of jobs) {
      const entries = window._scheduleHubGetDates(j);
      if (!entries.length) continue;
      const cat = window.classifyJobCategory(j);
      if (st.cat !== 'all' && cat !== st.cat) continue;
      if (st.scope === 'mine' && !window._scheduleHubIsMine(j)) continue;   // 내 일정만
      const done = (typeof window._isJobDone === 'function') ? !!window._isJobDone(j) : false;
      if (done && !showDone) continue;
      for (const e of entries) {
        dated.push({ j, ymd: e.ymd, cat, done, role: e.role });
      }
    }

    // 날짜별 그룹
    const byDate = {};
    for (const it of dated) {
      (byDate[it.ymd] = byDate[it.ymd] || []).push(it);
    }

    // 캘린더 빌드
    const firstDow = new Date(st.year, st.month, 1).getDay();
    const daysInMonth = new Date(st.year, st.month+1, 0).getDate();
    const today = new Date();
    const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate();

    const dows = ['일','월','화','수','목','금','토'];
    // 토·일 칸은 좁게(10%), 평일(월~금)은 넓게(16%) — 업무일 가독성 우선
    let calHtml = '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px">'
      + '<colgroup><col style="width:10%"><col style="width:16%"><col style="width:16%"><col style="width:16%"><col style="width:16%"><col style="width:16%"><col style="width:10%"></colgroup>'
      + '<thead><tr>';
    for (let i=0;i<7;i++) {
      const color = (i===0)?'#EF4444':(i===6?'#3B82F6':'var(--gray-700)');
      calHtml += `<th style="padding:6px 2px;font-size:11.5px;color:${color};font-weight:700;border-bottom:1.5px solid var(--gray-200)">${dows[i]}</th>`;
    }
    calHtml += '</tr></thead><tbody>';

    let day = 1;
    const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
    for (let i=0;i<totalCells;i++) {
      if (i % 7 === 0) calHtml += '<tr>';
      if (i < firstDow || day > daysInMonth) {
        calHtml += '<td style="height:96px;border:1px solid var(--gray-100);background:#FAFAFA"></td>';
      } else {
        const m = String(st.month+1).padStart(2,'0');
        const dd = String(day).padStart(2,'0');
        const ymd = `${st.year}-${m}-${dd}`;
        const isToday = (st.year===todayY && st.month===todayM && day===todayD);
        const isSel = (st.selectedDate === ymd);
        const items = byDate[ymd] || [];
        const dow = (i % 7);
        const dayColor = isToday ? '#fff' : (dow===0 ? '#EF4444' : (dow===6 ? '#3B82F6' : 'var(--gray-800)'));
        const dayBg = isToday ? 'background:#3B82F6;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-weight:700' : `color:${dayColor};font-weight:600`;
        const cellBorder = isSel ? '2px solid #3B82F6' : '1px solid var(--gray-100)';
        const cellBg = isSel ? '#EFF6FF' : '#fff';

        // 일정 칩 — 매장명 직접 표시 (미완료 먼저, 최대 3건 + 나머지 +N건)
        const sorted = items.slice().sort((a,b) => (a.done?1:0) - (b.done?1:0));
        const MAX_CHIPS = 3;
        let chipsHtml = '';
        for (const it of sorted.slice(0, MAX_CHIPS)) {
          const c = window._scheduleHubCatColor(it.cat);
          const nm = it.j.storeName || it.j.store || '(미지정)';
          const roleTxt = window._scheduleHubRoleLabel(it.role);
          const tip = `${window._scheduleHubCatLabel(it.cat)}${roleTxt ? ' · ' + roleTxt : ''} · ${nm}`;
          const doneSty = it.done ? 'opacity:0.45;text-decoration:line-through' : '';
          const rolePrefix = roleTxt ? `<span style="flex:0 0 auto;font-size:8.5px;color:${c};font-weight:700">${esc(roleTxt)}</span>` : '';
          chipsHtml += `<div onclick="event.stopPropagation();window._scheduleHubOpenJob('${esc(it.j.id||'')}')" title="${esc(tip)}" style="display:flex;align-items:center;gap:3px;margin-top:2px;padding:1px 3px;border-radius:3px;background:${c}1A;cursor:pointer;${doneSty}">
            <span style="flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:${c}"></span>
            ${rolePrefix}
            <span style="flex:1;min-width:0;font-size:9.5px;line-height:1.35;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nm)}</span>
          </div>`;
        }
        if (items.length > MAX_CHIPS) {
          chipsHtml += `<div style="margin-top:2px;font-size:9.5px;color:var(--gray-500);font-weight:600">+${items.length - MAX_CHIPS}건</div>`;
        }

        calHtml += `<td onclick="window._scheduleHubSelectDate('${ymd}')" style="height:96px;vertical-align:top;padding:3px 4px;border:${cellBorder};background:${cellBg};cursor:pointer;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center"><span style="${dayBg};font-size:11.5px">${day}</span></div>
          ${chipsHtml}
        </td>`;
        day++;
      }
      if (i % 7 === 6) calHtml += '</tr>';
    }
    calHtml += '</tbody></table>';
    const calEl = document.getElementById('scheduleHubCalendar');
    if (calEl) calEl.innerHTML = calHtml;

    // 리스트
    const listEl = document.getElementById('scheduleHubList');
    const headerEl = document.getElementById('scheduleHubListHeader');
    if (!listEl) return;

    // 결정: selectedDate 있으면 그 날짜만, 아니면 오늘 이후 7일
    let listItems = [];
    let listTitle = '📋 다가오는 일정';
    if (st.selectedDate) {
      listItems = (byDate[st.selectedDate] || []).slice();
      listTitle = `📋 ${st.selectedDate} 일정`;
    } else {
      const base = new Date(); base.setHours(0,0,0,0);
      const endBase = new Date(base); endBase.setDate(endBase.getDate()+7);
      for (const it of dated) {
        const d = new Date(it.ymd + 'T00:00:00');
        if (d >= base && d <= endBase) listItems.push(it);
      }
      listItems.sort((a,b) => a.ymd.localeCompare(b.ymd));
    }
    if (headerEl) {
      const showClear = !!st.selectedDate;
      headerEl.innerHTML = `<span>${esc(listTitle)} <span style="color:var(--gray-500);font-weight:500;font-size:11.5px">(${listItems.length})</span></span>` +
        (showClear ? `<button class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:11px" onclick="window._scheduleHubClearDate()">전체 보기</button>` : '');
    }

    if (!listItems.length) {
      listEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-500);font-size:12.5px">예정된 일정이 없습니다.</div>`;
      return;
    }

    // 날짜별 그룹 카드
    const grouped = {};
    for (const it of listItems) (grouped[it.ymd] = grouped[it.ymd] || []).push(it);
    const ymdList = Object.keys(grouped).sort();
    const todayYmd = (function(){
      const d = new Date(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
      return `${d.getFullYear()}-${m}-${dd}`;
    })();

    let html = '';
    for (const ymd of ymdList) {
      const dObj = new Date(ymd + 'T00:00:00');
      const diff = Math.round((dObj - new Date(todayYmd + 'T00:00:00')) / (1000*60*60*24));
      let dBadge = '';
      if (diff === 0) dBadge = '<span style="background:#3B82F6;color:#fff;padding:2px 6px;border-radius:6px;font-size:10.5px;font-weight:700">D-DAY</span>';
      else if (diff > 0) dBadge = `<span style="background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:6px;font-size:10.5px;font-weight:700">D-${diff}</span>`;
      else dBadge = `<span style="background:#FEE2E2;color:#991B1B;padding:2px 6px;border-radius:6px;font-size:10.5px;font-weight:700">D+${-diff}</span>`;
      const dow = ['일','월','화','수','목','금','토'][dObj.getDay()];
      html += `<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--gray-700);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
        <span>${esc(ymd)} (${dow})</span>${dBadge}
      </div>`;
      for (const it of grouped[ymd]) {
        const j = it.j;
        const cat = it.cat;
        const color = window._scheduleHubCatColor(cat);
        const catLabel = window._scheduleHubCatLabel(cat);
        const storeName = j.storeName || j.store || '(매장 미지정)';
        const sid = j.storeId || '';
        const engineer = j.engineer || j.assignee || '';
        // 시각: AS 예정 entry 는 asDueTime, 접수 entry 는 asReceivedAt 의 시:분
        let time = '';
        if (it.role === 'due') time = j.asDueTime || '';
        else if (it.role === 'received') { const t = String(j.asReceivedAt||'').slice(11,16); time = /^\d{2}:\d{2}$/.test(t) ? t : ''; }
        else time = j.asDueTime || '';
        const title = j.title || j.type || j.workType || '';
        const roleTxt = window._scheduleHubRoleLabel(it.role);
        const roleBadge = roleTxt ? `<span style="background:${color}1A;color:${color};padding:1.5px 6px;border-radius:5px;font-size:10.5px;font-weight:700">${esc(roleTxt)}</span>` : '';
        const doneBadge = it.done ? '<span style="background:#D1FAE5;color:#065F46;padding:1.5px 5px;border-radius:4px;font-size:10px;margin-left:4px">완료</span>' : '';
        html += `<div onclick="window._scheduleHubOpenJob('${esc(j.id||'')}')" style="background:#fff;border:1px solid var(--gray-200);border-left:4px solid ${color};border-radius:8px;padding:9px 11px;margin-bottom:6px;cursor:pointer;transition:all .12s" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background='#fff'">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
                <span style="background:${color};color:#fff;padding:1.5px 6px;border-radius:5px;font-size:10.5px;font-weight:700">${esc(catLabel)}</span>
                ${roleBadge}
                ${time ? `<span style="font-size:11px;color:var(--gray-600);font-weight:600">⏰ ${esc(time)}</span>` : ''}
                ${doneBadge}
              </div>
              <div onclick="window._scheduleHubOpenStore(event,'${esc(sid)}','${esc(storeName)}')" style="font-weight:700;font-size:13px;color:var(--gray-900);text-decoration:underline;text-decoration-color:var(--gray-300);text-underline-offset:2px">${esc(storeName)}</div>
              ${title ? `<div style="font-size:11.5px;color:var(--gray-600);margin-top:2px">${esc(title)}</div>` : ''}
              ${engineer ? `<div style="font-size:11px;color:var(--gray-500);margin-top:2px">👷 ${esc(engineer)}</div>` : ''}
            </div>
          </div>
        </div>`;
      }
      html += `</div>`;
    }
    listEl.innerHTML = html;
  };

  /* ─── 재고조사 Hub (Stocktake) ─── */
  window._stocktakeHubState = window._stocktakeHubState || { filter: 'all' };

  window.getStocktakes = function() {
    try { return JSON.parse(localStorage.getItem('ns_stocktake') || '[]'); } catch { return []; }
  };
  window.saveStocktakes = function(arr) {
    try {
      localStorage.setItem('ns_stocktake', JSON.stringify(arr));
      localStorage._storesDirty = '1';
    } catch(e){ console.warn('saveStocktakes failed', e); }
  };

  window._stEsc = function(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  };
  window._stWon = function(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('ko-KR') + '원';
  };
  window._stStatusColor = function(s) {
    return ({ '상담':'#6B7280', '일정확정':'#3B82F6', '조사완료':'#F59E0B', '정산':'#8B5CF6', '마감':'#16A34A' })[s] || '#6B7280';
  };

  window._stocktakeHubSetFilter = function(el, st) {
    window._stocktakeHubState.filter = st;
    try {
      el.parentElement.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    } catch(e){}
    window.renderStocktakeHub();
  };

  /* ─────────────────────────────────
     재고조사 서브탭 — 6 pane switch + 공통 기간 필터
     ───────────────────────────────── */
  window._stocktakeCurrentPane = 'list';
  window._stocktakePeriodGroup = 'month';
  window._stocktakeDateFilter = { from:'', to:'' };

  // 기간 필터 적용된 records 반환 (scheduleDate 우선, 없으면 consultDate / doneDate)
  window._stocktakeFilteredRecs = function() {
    const all = window.getStocktakes() || [];
    const f = window._stocktakeDateFilter || {};
    const from = f.from || '';
    const to   = f.to   || '';
    if (!from && !to) return all;
    return all.filter(r => {
      const d = r.scheduleDate || r.consultDate || r.doneDate || '';
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  };

  window._stocktakeApplyDateFilter = function() {
    const from = (document.getElementById('stDateFilterFrom')||{}).value || '';
    const to   = (document.getElementById('stDateFilterTo')||{}).value   || '';
    window._stocktakeDateFilter = { from, to };
    _stocktakeUpdateDateFilterLabel();
    // 현재 활성 pane 재렌더
    window._stocktakeSwitchPane(window._stocktakeCurrentPane);
  };

  function _stocktakeUpdateDateFilterLabel() {
    const el = document.getElementById('stDateFilterLabel');
    if (!el) return;
    const f = window._stocktakeDateFilter || {};
    if (!f.from && !f.to) { el.textContent = '검색 조건 없음 (전체)'; el.style.color='var(--gray-500)'; }
    else { el.textContent = `${f.from||'시작'} ~ ${f.to||'끝'}`; el.style.color='#1d4ed8'; }
  }

  window._stocktakeQuickRange = function(key) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const pad = (n)=>String(n).padStart(2,'0');
    const ymd = (d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    let from='', to='';
    if (key === 'this-month') {
      from = ymd(new Date(y, m, 1));
      to   = ymd(new Date(y, m+1, 0));
    } else if (key === 'last-month') {
      from = ymd(new Date(y, m-1, 1));
      to   = ymd(new Date(y, m, 0));
    }
    const fEl = document.getElementById('stDateFilterFrom');
    const tEl = document.getElementById('stDateFilterTo');
    if (fEl) fEl.value = from;
    if (tEl) tEl.value = to;
    window._stocktakeDateFilter = { from, to };
    _stocktakeUpdateDateFilterLabel();
    window._stocktakeSwitchPane(window._stocktakeCurrentPane);
  };

  function _stocktakeUpdateDate() {
    const el = document.getElementById('stocktakeTodayDate');
    if (!el) return;
    try {
      const d = new Date();
      const dow = ['일','월','화','수','목','금','토'][d.getDay()];
      el.textContent = `${d.getFullYear()}. ${String(d.getMonth()+1).padStart(2,'0')}. ${String(d.getDate()).padStart(2,'0')}. (${dow})`;
    } catch(e){}
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(_stocktakeUpdateDate, 300));
  window._stocktakeSwitchPane = function(pane) {
    window._stocktakeCurrentPane = pane;
    _stocktakeUpdateDate();
    document.querySelectorAll('#stocktakeSubtabs .st-subtab').forEach(b => b.classList.toggle('active', b.dataset.pane === pane));
    document.querySelectorAll('#screen-stocktakehub .st-pane').forEach(p => {
      const id = p.id || '';
      const show = (id === 'stPane-' + pane);
      p.style.display = show ? '' : 'none';
      p.classList.toggle('active', show);
    });
    // 기간 필터 — list 외 5개 pane 에서만 노출
    const filterEl = document.getElementById('stocktakeDateFilter');
    if (filterEl) {
      filterEl.style.display = (pane === 'list') ? 'none' : 'flex';
      _stocktakeUpdateDateFilterLabel();
      const f = window._stocktakeDateFilter || {};
      const fEl = document.getElementById('stDateFilterFrom'); if (fEl) fEl.value = f.from || '';
      const tEl = document.getElementById('stDateFilterTo');   if (tEl) tEl.value = f.to   || '';
    }
    // pane 별 렌더
    if (pane === 'list')       window.renderStocktakeHub();
    if (pane === 'byStore')    window._stocktakeRenderByStore();
    if (pane === 'byPeriod')   window._stocktakeRenderByPeriod();
    if (pane === 'receivable') window._stocktakeRenderReceivable();
    if (pane === 'labor')      window._stocktakeRenderLabor();
    if (pane === 'expense')    window._stocktakeRenderExpense();
  };
  window._stocktakePeriodMode = function(btn, mode) {
    window._stocktakePeriodGroup = mode;
    document.querySelectorAll('#stPane-byPeriod .st-period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === mode));
    window._stocktakeRenderByPeriod();
  };

  // 공통 — won 헬퍼는 _stWon, esc 는 _stEsc

  /* 매장별 집계 */
  window._stocktakeRenderByStore = function() {
    const el = document.getElementById('stByStoreBody');
    if (!el) return;
    const recs = window._stocktakeFilteredRecs();
    const won = window._stWon, esc = window._stEsc;
    const map = new Map();
    recs.forEach(r => {
      const key = r.storeId || ('name:' + (r.storeName||''));
      if (!map.has(key)) map.set(key, { storeId: r.storeId, storeName: r.storeName||'(매장 미지정)', cnt:0, fee:0, labor:0, expense:0, margin:0, collected:0, receivable:0 });
      const g = map.get(key);
      const fee = Number(r.fee)||0;
      const labor = Number(r.totalLabor)||0;
      const expense = Number(r.totalExpense)||0;
      const collected = Number(r.collected)||0;
      g.cnt++;
      g.fee += fee;
      g.labor += labor;
      g.expense += expense;
      g.margin += (fee - labor - expense);
      g.collected += collected;
      g.receivable += Math.max(0, fee - collected);
    });
    const rows = Array.from(map.values()).sort((a,b) => b.receivable - a.receivable || b.fee - a.fee);
    if (rows.length === 0) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400)">집계할 데이터가 없습니다</div>'; return; }
    const totalRow = rows.reduce((a,r)=>({cnt:a.cnt+r.cnt,fee:a.fee+r.fee,labor:a.labor+r.labor,expense:a.expense+r.expense,margin:a.margin+r.margin,collected:a.collected+r.collected,receivable:a.receivable+r.receivable}),{cnt:0,fee:0,labor:0,expense:0,margin:0,collected:0,receivable:0});
    el.innerHTML = `<table class="st-agg-table">
      <thead><tr><th>매장</th><th>건수</th><th>수수료</th><th>인건비</th><th>비용</th><th>수익</th><th>수금</th><th>미수금</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${esc(r.storeName)}</td>
        <td>${r.cnt}건</td>
        <td>${won(r.fee)}</td>
        <td style="color:#DC2626">${won(r.labor)}</td>
        <td style="color:#B45309">${won(r.expense)}</td>
        <td style="color:${r.margin>=0?'#16A34A':'#DC2626'};font-weight:700">${won(r.margin)}</td>
        <td>${won(r.collected)}</td>
        <td style="color:${r.receivable>0?'#B45309':'#15803d'};font-weight:700">${won(r.receivable)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr>
        <td>합계 (${rows.length}매장)</td>
        <td>${totalRow.cnt}건</td>
        <td>${won(totalRow.fee)}</td>
        <td>${won(totalRow.labor)}</td>
        <td>${won(totalRow.expense)}</td>
        <td>${won(totalRow.margin)}</td>
        <td>${won(totalRow.collected)}</td>
        <td>${won(totalRow.receivable)}</td>
      </tr></tfoot>
    </table>`;
  };

  /* 기간별 (월/주/일) */
  window._stocktakeRenderByPeriod = function() {
    const el = document.getElementById('stByPeriodBody');
    if (!el) return;
    const mode = window._stocktakePeriodGroup || 'month';
    const recs = window._stocktakeFilteredRecs();
    const won = window._stWon;
    const keyOf = (r) => {
      const d = r.scheduleDate || r.consultDate || r.doneDate || '';
      if (!d) return '미정';
      if (mode === 'month') return d.slice(0,7);
      if (mode === 'day')   return d.slice(0,10);
      if (mode === 'week') {
        const dt = new Date(d + 'T00:00:00'); if (isNaN(dt)) return d.slice(0,10);
        const tmp = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
        tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay()||7));
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1));
        const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1)/7);
        return tmp.getUTCFullYear() + '-W' + String(weekNo).padStart(2,'0');
      }
      return d;
    };
    const map = new Map();
    recs.forEach(r => {
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, { key:k, cnt:0, fee:0, labor:0, expense:0, margin:0, collected:0, receivable:0 });
      const g = map.get(k);
      const fee = Number(r.fee)||0, labor = Number(r.totalLabor)||0, expense = Number(r.totalExpense)||0, collected = Number(r.collected)||0;
      g.cnt++; g.fee += fee; g.labor += labor; g.expense += expense;
      g.margin += (fee - labor - expense); g.collected += collected;
      g.receivable += Math.max(0, fee - collected);
    });
    const rows = Array.from(map.values()).sort((a,b) => b.key.localeCompare(a.key));
    if (rows.length === 0) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400)">집계할 데이터가 없습니다</div>'; return; }
    const totalRow = rows.reduce((a,r)=>({cnt:a.cnt+r.cnt,fee:a.fee+r.fee,labor:a.labor+r.labor,expense:a.expense+r.expense,margin:a.margin+r.margin,collected:a.collected+r.collected,receivable:a.receivable+r.receivable}),{cnt:0,fee:0,labor:0,expense:0,margin:0,collected:0,receivable:0});
    el.innerHTML = `<table class="st-agg-table">
      <thead><tr><th>${mode==='month'?'월':mode==='week'?'주':'일'}</th><th>건수</th><th>수수료</th><th>인건비</th><th>비용</th><th>수익</th><th>수금</th><th>미수금</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${r.key}</td>
        <td>${r.cnt}건</td>
        <td>${won(r.fee)}</td>
        <td style="color:#DC2626">${won(r.labor)}</td>
        <td style="color:#B45309">${won(r.expense)}</td>
        <td style="color:${r.margin>=0?'#16A34A':'#DC2626'};font-weight:700">${won(r.margin)}</td>
        <td>${won(r.collected)}</td>
        <td style="color:${r.receivable>0?'#B45309':'#15803d'};font-weight:700">${won(r.receivable)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td>합계</td><td>${totalRow.cnt}건</td><td>${won(totalRow.fee)}</td><td>${won(totalRow.labor)}</td><td>${won(totalRow.expense)}</td><td>${won(totalRow.margin)}</td><td>${won(totalRow.collected)}</td><td>${won(totalRow.receivable)}</td></tr></tfoot>
    </table>`;
  };

  /* 정산/수금 — 미수금 record 만 + [+ 수금] 액션 */
  window._stocktakeRenderReceivable = function() {
    const el = document.getElementById('stReceivableBody');
    if (!el) return;
    const recs = window._stocktakeFilteredRecs().filter(r => Math.max(0,(Number(r.fee)||0)-(Number(r.collected)||0)) > 0);
    const won = window._stWon, esc = window._stEsc;
    if (recs.length === 0) { el.innerHTML = '<div style="padding:24px;text-align:center;color:#15803d;background:#DCFCE7;border-radius:8px;font-weight:700">🎉 모든 수수료가 수금 완료되었습니다</div>'; return; }
    recs.sort((a,b) => {
      const recA = (Number(a.fee)||0)-(Number(a.collected)||0);
      const recB = (Number(b.fee)||0)-(Number(b.collected)||0);
      return recB - recA;
    });
    const totalRecv = recs.reduce((a,r)=>a+Math.max(0,(Number(r.fee)||0)-(Number(r.collected)||0)),0);
    el.innerHTML = `<div style="margin-bottom:10px;padding:10px 14px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;color:#92400E;font-size:12.5px;font-weight:700">💰 미수금 총 ${won(totalRecv)} · ${recs.length}건</div>` +
      `<table class="st-agg-table">
        <thead><tr><th>매장</th><th>상태</th><th>예정일</th><th>수수료</th><th>수금</th><th>미수금</th><th>수금방식</th><th style="text-align:center">액션</th></tr></thead>
        <tbody>${recs.map(r => {
          const fee = Number(r.fee)||0, collected = Number(r.collected)||0, recv = Math.max(0, fee-collected);
          return `<tr>
            <td><span onclick="window._stocktakeOpenSmart('${esc(r.id)}')" style="color:var(--primary);cursor:pointer;text-decoration:underline;text-decoration-style:dotted">${esc(r.storeName||'-')}</span></td>
            <td><span style="background:${window._stStatusColor(r.status)};color:#fff;padding:1px 7px;border-radius:5px;font-size:10.5px;font-weight:700">${esc(r.status||'-')}</span></td>
            <td>${esc(r.scheduleDate||r.consultDate||'-')}</td>
            <td>${won(fee)}</td>
            <td>${won(collected)}</td>
            <td style="color:#B45309;font-weight:700">${won(recv)}</td>
            <td>${esc(r.paymentMethod||'-')}</td>
            <td style="text-align:center"><button class="btn btn-outline btn-sm" style="padding:3px 10px;font-size:11px;border-color:#16A34A;color:#15803d" onclick="window._stocktakeAddPayment('${esc(r.id)}')">+ 수금</button></td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td colspan="5">합계</td><td>${won(totalRecv)}</td><td colspan="2"></td></tr></tfoot>
      </table>`;
  };

  // + 수금 — prompt 로 금액 입력 → 누적 수금에 더하고 saveStocktakes + 재렌더
  window._stocktakeAddPayment = function(id) {
    const arr = window.getStocktakes() || [];
    const idx = arr.findIndex(r => r.id === id);
    if (idx < 0) return;
    const rec = arr[idx];
    const fee = Number(rec.fee)||0;
    const collected = Number(rec.collected)||0;
    const left = Math.max(0, fee - collected);
    const input = prompt(`[${rec.storeName||'-'}]\n수수료 ${fee.toLocaleString('ko-KR')}원\n기존 수금 ${collected.toLocaleString('ko-KR')}원\n미수금 ${left.toLocaleString('ko-KR')}원\n\n수금 금액을 입력하세요 (전액이면 그대로 ${left.toLocaleString('ko-KR')}):`, String(left));
    if (input == null) return;
    const amt = Number(String(input).replace(/[^\d]/g,'')) || 0;
    if (amt <= 0) return;
    rec.collected = collected + amt;
    rec.payments = rec.payments || [];
    rec.payments.push({ at: new Date().toISOString(), amount: amt });
    // 자동 마감 제안 (모두 수금)
    if (rec.collected >= fee && rec.status !== '마감') {
      if (confirm('전액 수금되었습니다. 상태를 [마감] 으로 변경할까요?')) rec.status = '마감';
    }
    arr[idx] = rec;
    window.saveStocktakes(arr);
    if (typeof showToast === 'function') showToast(`✅ ${amt.toLocaleString('ko-KR')}원 수금 기록`);
    window._stocktakeRenderReceivable();
    window.renderStocktakeHub();
  };

  /* 인건비 정산 — 사람별 누적 */
  window._stocktakeRenderLabor = function() {
    const el = document.getElementById('stLaborBody');
    if (!el) return;
    const recs = window._stocktakeFilteredRecs();
    const won = window._stWon, esc = window._stEsc;
    const map = new Map();
    recs.forEach(r => {
      (r.workers || []).forEach(w => {
        const key = (w.name||'').trim();
        if (!key) return;
        if (!map.has(key)) map.set(key, { name:key, cnt:0, totalPay:0, paid:0, unpaid:0, bank:w.bank||'', account:w.account||'' });
        const g = map.get(key);
        const p = Number(w.payTotal)||0;
        g.cnt++; g.totalPay += p;
        if (w.paid) g.paid += p; else g.unpaid += p;
        if (!g.bank && w.bank) g.bank = w.bank;
        if (!g.account && w.account) g.account = w.account;
      });
    });
    const rows = Array.from(map.values()).sort((a,b) => b.unpaid - a.unpaid || b.totalPay - a.totalPay);
    if (rows.length === 0) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400)">집계할 인건비 데이터가 없습니다</div>'; return; }
    const totalRow = rows.reduce((a,r)=>({cnt:a.cnt+r.cnt,totalPay:a.totalPay+r.totalPay,paid:a.paid+r.paid,unpaid:a.unpaid+r.unpaid}),{cnt:0,totalPay:0,paid:0,unpaid:0});
    el.innerHTML = `<table class="st-agg-table">
      <thead><tr><th>이름</th><th>참여 건수</th><th>총 수당</th><th>입금</th><th>미입금</th><th>은행</th><th>계좌</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${esc(r.name)}</td>
        <td>${r.cnt}건</td>
        <td>${won(r.totalPay)}</td>
        <td style="color:#15803d">${won(r.paid)}</td>
        <td style="color:${r.unpaid>0?'#DC2626':'#15803d'};font-weight:700">${won(r.unpaid)}</td>
        <td>${esc(r.bank||'-')}</td>
        <td style="font-family:monospace">${esc(r.account||'-')}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td>합계 (${rows.length}명)</td><td>${totalRow.cnt}건</td><td>${won(totalRow.totalPay)}</td><td>${won(totalRow.paid)}</td><td>${won(totalRow.unpaid)}</td><td colspan="2"></td></tr></tfoot>
    </table>`;
  };

  /* 비용 분석 — 분류별 / 기간별 */
  window._stocktakeRenderExpense = function() {
    const el = document.getElementById('stExpenseBody');
    if (!el) return;
    const recs = window._stocktakeFilteredRecs();
    const won = window._stWon, esc = window._stEsc;
    const byCat = new Map();
    const byStore = new Map();
    let grand = 0;
    recs.forEach(r => {
      (r.expenses || []).forEach(e => {
        const amt = Number(e.amount)||0;
        if (!amt) return;
        grand += amt;
        const c = e.category || '기타';
        byCat.set(c, (byCat.get(c)||0) + amt);
        const sk = r.storeName || '(매장 미지정)';
        if (!byStore.has(sk)) byStore.set(sk, { name:sk, 식사:0, 교통비:0, 기타:0, total:0 });
        const g = byStore.get(sk);
        g[c] = (g[c]||0) + amt;
        g.total += amt;
      });
    });
    if (grand === 0) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400)">비용 데이터가 없습니다. 등록 폼의 💸 비용 항목에서 추가하세요.</div>'; return; }
    // 분류별 칩
    const catChips = ['식사','교통비','기타'].map(c => {
      const v = byCat.get(c)||0;
      const pct = grand ? Math.round(v*100/grand) : 0;
      const icon = c==='식사'?'🍱':c==='교통비'?'🚗':'📦';
      return `<div style="flex:1;min-width:130px;padding:10px 12px;background:#fff;border:1px solid var(--gray-200);border-radius:8px"><div style="font-size:11px;color:var(--gray-500);font-weight:700">${icon} ${c}</div><div style="font-size:16px;font-weight:800;color:#B45309">${won(v)}</div><div style="font-size:10.5px;color:var(--gray-500)">${pct}%</div></div>`;
    }).join('');
    // 매장별
    const storeRows = Array.from(byStore.values()).sort((a,b) => b.total - a.total);
    const totalRow = storeRows.reduce((a,r)=>({식사:a.식사+r.식사,교통비:a.교통비+r.교통비,기타:a.기타+r.기타,total:a.total+r.total}),{식사:0,교통비:0,기타:0,total:0});
    el.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">${catChips}<div style="flex:1;min-width:130px;padding:10px 12px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px"><div style="font-size:11px;color:#92400E;font-weight:700">총 비용</div><div style="font-size:16px;font-weight:800;color:#92400E">${won(grand)}</div></div></div>
      <table class="st-agg-table">
        <thead><tr><th>매장</th><th>🍱 식사</th><th>🚗 교통비</th><th>📦 기타</th><th>합계</th></tr></thead>
        <tbody>${storeRows.map(r => `<tr>
          <td>${esc(r.name)}</td>
          <td>${won(r.식사||0)}</td>
          <td>${won(r.교통비||0)}</td>
          <td>${won(r.기타||0)}</td>
          <td style="font-weight:700;color:#B45309">${won(r.total)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td>합계</td><td>${won(totalRow.식사)}</td><td>${won(totalRow.교통비)}</td><td>${won(totalRow.기타)}</td><td>${won(totalRow.total)}</td></tr></tfoot>
      </table>`;
  };

  window.renderStocktakeHub = function() {
    const esc = window._stEsc;
    const won = window._stWon;
    const st = window._stocktakeHubState;
    const listEl = document.getElementById('stocktakeHubList');
    const sumEl = document.getElementById('stocktakeHubSummary');
    if (!listEl) return;

    const recs = window.getStocktakes() || [];
    // 상태별 카운트
    const cnts = { all: recs.length, '상담':0, '일정확정':0, '조사완료':0, '정산':0, '마감':0, '미수금':0 };
    recs.forEach(r => {
      if (cnts[r.status] !== undefined) cnts[r.status]++;
      const recv = Math.max(0, (Number(r.fee)||0) - (Number(r.collected)||0));
      if (recv > 0) cnts['미수금']++;
    });
    document.querySelectorAll('#stocktakeHubFilters .filter-chip').forEach(c => {
      const k = c.getAttribute('data-st');
      const lblBase = (k==='all'?'전체':k);
      const lbl = lblBase + ` (${cnts[k]||0})`;
      c.textContent = lbl;
      if (k === '미수금') c.textContent = '💰 미수금 (' + (cnts['미수금']||0) + ')';
    });

    // 요약 카드 (총합)
    const totalFee = recs.reduce((a,r)=>a+(Number(r.fee)||0),0);
    const totalLabor = recs.reduce((a,r)=>a+(Number(r.totalLabor)||0),0);
    const totalExpense = recs.reduce((a,r)=>a+(Number(r.totalExpense)||0),0);
    const totalMargin = totalFee - totalLabor - totalExpense;
    const totalCollected = recs.reduce((a,r)=>a+(Number(r.collected)||0),0);
    const totalReceivable = Math.max(0, totalFee - totalCollected);
    if (sumEl) {
      sumEl.innerHTML = `
        <div class="card" style="padding:10px 14px;flex:1;min-width:130px"><div style="font-size:11px;color:var(--gray-500);font-weight:600">총 건수</div><div style="font-size:18px;font-weight:800;color:var(--gray-800)">${recs.length}건</div></div>
        <div class="card" style="padding:10px 14px;flex:1;min-width:130px"><div style="font-size:11px;color:var(--gray-500);font-weight:600">총 수수료</div><div style="font-size:16px;font-weight:800;color:#3B82F6">${won(totalFee)}</div></div>
        <div class="card" style="padding:10px 14px;flex:1;min-width:130px"><div style="font-size:11px;color:var(--gray-500);font-weight:600">총 인건비</div><div style="font-size:16px;font-weight:800;color:#DC2626">${won(totalLabor)}</div></div>
        <div class="card" style="padding:10px 14px;flex:1;min-width:130px"><div style="font-size:11px;color:var(--gray-500);font-weight:600">총 비용</div><div style="font-size:16px;font-weight:800;color:#B45309">${won(totalExpense)}</div></div>
        <div class="card" style="padding:10px 14px;flex:1;min-width:130px"><div style="font-size:11px;color:var(--gray-500);font-weight:600">총 수익</div><div style="font-size:16px;font-weight:800;color:${totalMargin>=0?'#16A34A':'#DC2626'}">${won(totalMargin)}</div></div>
        <div class="card" style="padding:10px 14px;flex:1;min-width:130px"><div style="font-size:11px;color:var(--gray-500);font-weight:600">총 수금</div><div style="font-size:16px;font-weight:800;color:var(--gray-700)">${won(totalCollected)}</div></div>
        <div class="card" style="padding:10px 14px;flex:1;min-width:130px;border-left:3px solid #F59E0B"><div style="font-size:11px;color:var(--gray-500);font-weight:600">💰 미수금</div><div style="font-size:16px;font-weight:800;color:#B45309">${won(totalReceivable)}</div></div>
      `;
    }

    // 필터링
    let displayed = recs.slice();
    if (st.filter === '미수금') {
      displayed = displayed.filter(r => Math.max(0, (Number(r.fee)||0) - (Number(r.collected)||0)) > 0);
    } else if (st.filter !== 'all') {
      displayed = displayed.filter(r => r.status === st.filter);
    }
    // 정렬: 예정일/완료일/상담일 desc, 그다음 createdAt desc
    displayed.sort((a,b) => {
      const ka = a.scheduleDate || a.consultDate || a.doneDate || '';
      const kb = b.scheduleDate || b.consultDate || b.doneDate || '';
      if (ka !== kb) return kb.localeCompare(ka);
      return (b.createdAt||0) - (a.createdAt||0);
    });

    if (!displayed.length) {
      listEl.innerHTML = `<div style="padding:32px;text-align:center;color:var(--gray-500);font-size:13px;background:#fff;border:1.5px dashed var(--gray-200);border-radius:12px">📦 등록된 재고조사가 없습니다. <br><br><button class="btn btn-primary btn-sm" onclick="window._stocktakeOpenEditor()">+ 첫 재고조사 등록</button></div>`;
      return;
    }

    listEl.innerHTML = displayed.map(r => {
      const color = window._stStatusColor(r.status);
      const fee = Number(r.fee)||0;
      const labor = Number(r.totalLabor)||0;
      const expense = Number(r.totalExpense)||0;
      const margin = fee - labor - expense;
      const collected = Number(r.collected)||0;
      const receivable = Math.max(0, fee - collected);
      const expected = Number(r.expectedAmount)||0;
      const actual = Number(r.actualAmount)||0;
      const headcount = Number(r.headcount)||(r.workers?r.workers.length:0);
      return `
        <div class="card" style="padding:14px 16px;margin-bottom:10px;border-left:4px solid ${color}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="background:${color};color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">${esc(r.status||'상담')}</span>
                <span onclick="window._stocktakeOpenSmart('${esc(r.id)}')" title="${r.status==='마감'?'조회 (완료처리됨)':'클릭해서 수정'}" style="font-weight:700;font-size:14px;color:var(--primary);cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px">${esc(r.storeName||'(매장 미지정)')}</span>
              </div>
              <div style="font-size:11.5px;color:var(--gray-600);line-height:1.7">
                ${r.consultDate?`상담 ${esc(r.consultDate)} · `:''}${r.scheduleDate?`예정 ${esc(r.scheduleDate)} · `:''}${r.doneDate?`완료 ${esc(r.doneDate)}`:''}
              </div>
              <div style="font-size:11.5px;color:var(--gray-700);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
                ${r.area?`<span>📐 ${esc(r.area)}평</span>`:''}
                ${headcount?`<span>👥 ${headcount}명</span>`:''}
                ${expected?`<span>예상 ${won(expected)}</span>`:''}
                ${actual?`<span>실재고 <strong>${won(actual)}</strong></span>`:''}
              </div>
              <div style="font-size:11.5px;color:var(--gray-700);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">
                <span>수수료 <strong style="color:#3B82F6">${won(fee)}</strong></span>
                <span>인건비 <strong style="color:#DC2626">${won(labor)}</strong></span>
                ${expense?`<span>비용 <strong style="color:#B45309">${won(expense)}</strong></span>`:''}
                <span>수익 <strong style="color:${margin>=0?'#16A34A':'#DC2626'}">${won(margin)}</strong></span>
                ${receivable>0?`<span style="color:#B45309">미수 <strong>${won(receivable)}</strong></span>`:`<span style="color:#15803d">수금완료 ✓</span>`}
                ${r.paymentMethod?`<span style="color:var(--gray-500);font-size:10.5px">· ${esc(r.paymentMethod)}</span>`:''}
              </div>
              ${r.memo?`<div style="margin-top:6px;font-size:11.5px;color:var(--gray-500);font-style:italic">📝 ${esc(r.memo)}</div>`:''}
              ${(typeof window._renderAttStrip==='function'&&Array.isArray(r.attachments)&&r.attachments.length)?window._renderAttStrip(r.attachments,{limit:6,size:36}):''}
              ${(Array.isArray(r.lineHistory)&&r.lineHistory.length)?`<div style="margin-top:5px"><span style="background:#06C7551A;color:#04A047;border:1px solid #06C75533;border-radius:11px;padding:2px 9px;font-size:10.5px;font-weight:800">📡 LINE ${r.lineHistory.filter(h=>h.ok).length}회 발송</span></div>`:''}
            </div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" style="padding:4px 10px;font-size:11.5px" onclick="window._stocktakeShowWorkers('${esc(r.id)}')">명단보기</button>
              ${r.status==='마감'
                ? `<button class="btn btn-outline btn-sm" style="padding:4px 10px;font-size:11.5px;border-color:#F59E0B;color:#92400E;font-weight:700" onclick="window._stocktakeRevert('${esc(r.id)}')" title="완료처리 해제 후 수정 모드로 진입">🔓 되돌리기</button>`
                : `<button class="btn btn-outline btn-sm" style="padding:4px 10px;font-size:11.5px" onclick="window._stocktakeOpenEditor('${esc(r.id)}')">수정</button>`}
              ${r.status!=='마감'?`<button class="btn btn-outline btn-sm" style="padding:4px 10px;font-size:11.5px;border-color:#16A34A;color:#16A34A" onclick="window._stocktakeMarkDone('${esc(r.id)}')">완료처리</button>`:''}
              <button class="btn btn-outline btn-sm" style="padding:4px 10px;font-size:11.5px;border-color:#DC2626;color:#DC2626" onclick="window._stocktakeDelete('${esc(r.id)}')">삭제</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  };

  /* ── 매장명 클릭 분기: 완료(마감) 면 조회, 아니면 수정 ── */
  window._stocktakeOpenSmart = function(id) {
    const arr = window.getStocktakes() || [];
    const rec = arr.find(r => r.id === id);
    if (!rec) { if (typeof showToast === 'function') showToast('기록을 찾을 수 없습니다'); return; }
    const isDone = (rec.status === '마감');
    window._stocktakeOpenEditor(id, isDone);
  };

  /* ── 되돌리기: 마감 → 정산 으로 상태 변경 + 수정 모드 진입 ── */
  window._stocktakeRevert = function(id) {
    const arr = window.getStocktakes() || [];
    const idx = arr.findIndex(r => r.id === id);
    if (idx < 0) { if (typeof showToast === 'function') showToast('기록을 찾을 수 없습니다'); return; }
    const rec = arr[idx];
    if (rec.status !== '마감') { window._stocktakeOpenEditor(id); return; }
    if (!confirm(`완료처리를 해제하고 수정 모드로 진입합니다.\n\n· ${rec.storeName||'-'}\n· 상태: 마감 → 정산\n\n계속하시겠습니까?`)) return;
    rec.status = '정산';
    rec._revertedAt = Date.now();
    arr[idx] = rec;
    window.saveStocktakes(arr);
    if (typeof showToast === 'function') showToast('🔓 되돌리기 완료 — 수정 가능 상태');
    window.renderStocktakeHub();
    // 즉시 수정 모드로 진입
    window._stocktakeOpenEditor(id, false);
  };

  /* ── 단계 chip 인터페이스 — 클릭으로 현재 단계 설정, 시각적으로 past/current/future 표시 ── */
  window._ST_STAGES = ['상담','일정확정','조사완료','정산','마감'];
  window._stEditorSetStage = function(stage) {
    const stages = window._ST_STAGES;
    if (!stages.includes(stage)) stage = '상담';
    const hidden = document.getElementById('stEditorStatus');
    if (hidden) hidden.value = stage;
    const idx = stages.indexOf(stage);
    document.querySelectorAll('#stEditorStatusChips .st-stage-chip').forEach(chip => {
      const s = chip.getAttribute('data-stage');
      const i = stages.indexOf(s);
      chip.classList.remove('past','current');
      if (i < idx) chip.classList.add('past');
      else if (i === idx) chip.classList.add('current');
    });
  };

  /* ── Editor 로직 ── */
  window._stocktakeOpenEditor = function(id, readonly) {
    readonly = !!readonly;
    let rec;
    if (id) {
      const arr = window.getStocktakes();
      rec = arr.find(r => r.id === id);
    }
    if (!rec) {
      rec = { id:'', storeId:'', storeName:'', status:'상담', consultDate:'', scheduleDate:'', doneDate:'', area:'', expectedAmount:'', actualAmount:'', headcount:'', workers:[], totalLabor:0, collected:'', fee:'', memo:'' };
      document.getElementById('stocktakeEditorTitle').textContent = '재고조사 등록';
    } else {
      document.getElementById('stocktakeEditorTitle').textContent = readonly ? '📋 재고조사 조회 (완료처리됨)' : '재고조사 수정';
    }

    document.getElementById('stEditorId').value = rec.id || '';
    document.getElementById('stEditorStoreInput').value = rec.storeName || '';
    document.getElementById('stEditorStoreId').value = rec.storeId || '';
    // 매장 선택 정보 사전 채움
    try {
      if (rec.storeId) {
        const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
        const s = stores.find(x => x.id === rec.storeId);
        if (s) _stocktakePickStore(s);
      }
    } catch(e){}
    window._stEditorSetStage(rec.status || '상담');
    // 상담일 기본값 — 신규 등록 시 오늘 (KST), 수정 시 기존 값 유지
    const todayKst = (function(){
      // 🕐 KST 날짜 — 브라우저 타임존 무관 절대 보정 (UTC+9). 기존 getTimezoneOffset 방식은
      //   브라우저가 이미 KST 면 +9h 이중 적용 → 오후 등록이 다음날로 밀리는 버그. (2026-05-28 fix)
      return new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10);
    })();
    document.getElementById('stEditorConsultDate').value = rec.consultDate || (id ? '' : todayKst);
    document.getElementById('stEditorScheduleDate').value = rec.scheduleDate || '';
    // 담당자 정보 채우기 + 우리 담당자 옵션 목록 빌드
    try {
      const ownerSel = document.getElementById('stEditorOwner');
      if (ownerSel) {
        const users = (typeof getUsers === 'function') ? (getUsers() || []) : [];
        const opts = ['<option value="">— 선택 —</option>'];
        users.forEach(u => {
          const nm = String(u.name || u.email || '').trim();
          if (!nm) return;
          opts.push(`<option value="${_strEsc ? _strEsc(nm) : nm}">${nm}</option>`);
        });
        ownerSel.innerHTML = opts.join('');
        // 기본값 — 기록 owner 또는 현재 로그인 사용자
        const curOwner = rec.owner || (rec.id ? '' : (((typeof _currentAuthName==='function') ? _currentAuthName() : '') || ''));
        if (curOwner) {
          // 만약 현재 user 이름이 list 에 없으면 옵션 추가
          if (!Array.from(ownerSel.options).some(o => o.value === curOwner)) {
            const opt = document.createElement('option');
            opt.value = curOwner; opt.textContent = curOwner;
            ownerSel.appendChild(opt);
          }
          ownerSel.value = curOwner;
        }
      }
      const cn = document.getElementById('stEditorContactName');     if (cn) cn.value = rec.contactName || '';
      const cp = document.getElementById('stEditorContactPhone');    if (cp) cp.value = rec.contactPhone || '';
      const cr = document.getElementById('stEditorContactRole');     if (cr) cr.value = rec.contactRole || '';
    } catch(e){ console.warn('stocktake owner/contact init failed', e); }
    document.getElementById('stEditorDoneDate').value = rec.doneDate || '';
    document.getElementById('stEditorArea').value = rec.area || '';
    document.getElementById('stEditorHeadcount').value = rec.headcount || '';
    window._stSetMoneyInput(document.getElementById('stEditorExpected'), rec.expectedAmount);
    window._stSetMoneyInput(document.getElementById('stEditorActual'),   rec.actualAmount);
    window._stSetMoneyInput(document.getElementById('stEditorFee'),       rec.fee);
    window._stSetMoneyInput(document.getElementById('stEditorCollected'), rec.collected);
    document.getElementById('stEditorMemo').value = rec.memo || '';
    // 수금 방식
    const pmRadios = document.querySelectorAll('input[name="stPaymentMethod"]');
    pmRadios.forEach(r => { r.checked = (r.value === (rec.paymentMethod || '현금')); });
    // 일괄 입력 칸 초기화
    const bulk = document.getElementById('stBulkPayAmount'); if (bulk) bulk.value = '';
    // 📡 LINE 발송 체크박스 초기화 — 새 등록일 때만 기본 체크 (수정 시 OFF)
    const lineChk = document.getElementById('stEditorLineSend');
    if (lineChk) lineChk.checked = !id;

    // 미등록 가맹점 모드 reset
    window._stocktakeUnregMode = false;
    const unregForm = document.getElementById('stUnregForm');
    if (unregForm) unregForm.style.display = 'none';
    const unregBtn = document.getElementById('stUnregBtn');
    if (unregBtn) { unregBtn.style.background='none'; unregBtn.style.color='var(--gray-500)'; unregBtn.textContent='+ 미등록 가맹점'; }
    ['stUnregName','stUnregBiz','stUnregCeo','stUnregTel','stUnregAddr'].forEach(idd => { const el=document.getElementById(idd); if(el)el.value=''; });

    // 워커 행 렌더
    const tbody = document.getElementById('stEditorWorkersBody');
    tbody.innerHTML = '';
    (rec.workers || []).forEach(w => window._stocktakeAddWorkerRow(w));
    // 비용 항목 렌더
    const expBody = document.getElementById('stEditorExpensesBody');
    if (expBody) {
      expBody.innerHTML = '';
      (rec.expenses || []).forEach(e => window._stocktakeAddExpense(e.category||'기타', e));
    }
    window._stocktakeRecalcTotals();

    // 📷📎 첨부 uploader mount
    try {
      const upBox = document.getElementById('stEditorUploader');
      if (upBox && window.NS_UPLOAD) {
        window._stocktakeUploaderCtl = window.NS_UPLOAD.mount(upBox, {
          initial: Array.isArray(rec.attachments) ? rec.attachments : [],
          category: 'stocktake',
          jobId: rec.id || '',
          readonly: !!readonly,
          max: 50,
        });
      }
    } catch(e) { console.warn('uploader mount failed', e); }

    // 📝 진행 단계 thread mount — 등록된 후에만 활성
    try {
      const threadBox = document.getElementById('stEditorThread');
      const placeholder = document.getElementById('stEditorThreadNotSaved');
      const isNew = !rec.id;
      if (isNew) {
        if (threadBox) threadBox.style.display = 'none';
        if (placeholder) placeholder.style.display = '';
      } else {
        if (threadBox) threadBox.style.display = '';
        if (placeholder) placeholder.style.display = 'none';
        // 빈 thread 이면 첫 ROOT 자동 시드 (요청접수)
        if (!Array.isArray(rec.thread) || rec.thread.length === 0) {
          const seedText = (rec.memo || '').trim() || '재고조사 요청';
          const seedTs = (typeof _kstDateTimeStr === 'function') ? _kstDateTimeStr() : new Date().toISOString().slice(0,16).replace('T',' ');
          const author = ((typeof _currentAuthName==='function') ? _currentAuthName() : '담당자') || '담당자';
          rec.thread = [{
            ts: seedTs, author, status:'요청접수', text: seedText,
            threadId: 'TR-st-seed-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
            parentId: null,
          }];
          // persist
          const allRecs = window.getStocktakes() || [];
          const ix = allRecs.findIndex(x => x.id === rec.id);
          if (ix >= 0) { allRecs[ix].thread = rec.thread; window.saveStocktakes(allRecs); }
        }
        // entity 등록 — _setThreadFor / _getThreadFor 가 stocktake 경로로 분기
        window._threadEntities = window._threadEntities || {};
        window._threadEntities['stEditorThread'] = 'stocktake';
        window._renderThreadGroups('stEditorThread', rec.thread || [], {
          editable: !readonly,
          jobId: rec.id,   // stocktake.id 를 jobId 슬롯에 재사용 (entity='stocktake' 라 stocktake 저장소로 갑니다)
          draftMode: false,
        });
      }
    } catch(e) { console.warn('stocktake thread mount failed', e); }

    // readonly 모드 — 모든 입력 비활성, 저장 버튼 숨김
    _stocktakeApplyReadonly(readonly);

    showModal('stocktakeEditorModal');
  };

  function _stocktakeApplyReadonly(readonly) {
    const modal = document.getElementById('stocktakeEditorModal');
    if (!modal) return;
    modal.classList.toggle('st-readonly-mode', !!readonly);
    // 모든 input/textarea/select/button 비활성 + readonly 속성 (text 입력의 깜빡임 방지)
    modal.querySelectorAll('.modal-body input, .modal-body textarea, .modal-body select, .modal-body button').forEach(el => {
      el.disabled = !!readonly;
      // text/date/number 류는 readonly 도 함께 (브라우저별 차이 보강)
      if (el.tagName === 'INPUT' && /^(text|date|number)$/i.test(el.type||'')) {
        if (readonly) el.setAttribute('readonly','readonly'); else el.removeAttribute('readonly');
      }
    });
    // footer 저장 버튼 — 숨김
    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    if (saveBtn) saveBtn.style.display = readonly ? 'none' : '';
    // footer 취소/닫기 버튼은 항상 활성
    modal.querySelectorAll('.modal-footer button.btn-outline').forEach(b => { b.disabled = false; });
    modal.querySelectorAll('.modal-close').forEach(b => { b.disabled = false; });
    // 안내 배너
    let banner = modal.querySelector('.st-readonly-banner');
    if (readonly) {
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'st-readonly-banner';
        banner.style.cssText = 'background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 12px;border-radius:8px;font-size:12.5px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;line-height:1.5';
        banner.innerHTML = '🔒 완료처리된 기록입니다 — 수정 불가 (조회 전용).<br><span style="font-weight:500;font-size:11px">수정하려면 리스트의 <b>🔓 되돌리기</b> 버튼으로 상태를 해제하세요.</span>';
        const body = modal.querySelector('.modal-body');
        if (body) body.insertBefore(banner, body.firstChild);
      }
    } else if (banner) {
      banner.remove();
    }
  }

  // 매장 검색 / 선택 / 미등록 토글
  window._stocktakeUnregMode = false;
  window._stocktakePickedStore = null;
  window._resetStocktakeStorePickInfo = function() {
    window._stocktakePickedStore = null;
    const el = document.getElementById('stStorePickedInfo');
    if (el) el.style.display = 'none';
    const sid = document.getElementById('stEditorStoreId');
    if (sid) sid.value = '';
  };
  window.runStocktakeStoreSearch = function() {
    if (window._stocktakeUnregMode) return;
    const q = (document.getElementById('stEditorStoreInput')?.value || '').trim();
    const scope = (document.querySelector('input[name="stStoreScope"]:checked')?.value) || 'name_biz';
    const results = document.getElementById('stStoreResults');
    if (!results) return;
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const normFn = (typeof _normalizeSearch === 'function') ? _normalizeSearch : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
    const matchFn = (typeof _matchStore === 'function') ? _matchStore : null;
    let matched = stores;
    if (q.length >= 1) {
      const qNorm = normFn(q);
      if (matchFn) matched = stores.filter(s => matchFn(s, qNorm, scope));
      else matched = stores.filter(s => normFn(s.name||'').includes(qNorm) || normFn(s.biz||'').includes(qNorm));
    }
    matched = matched.slice(0, 30);
    if (matched.length === 0) {
      results.style.display = 'block';
      results.innerHTML = '<div style="padding:14px;text-align:center;color:var(--gray-400);font-size:11px">매칭 매장 없음</div>';
      return;
    }
    results.innerHTML = matched.map(s => {
      const sigName = (s.signageName||'').replace(/[<>&]/g,'');
      return `<div onmousedown="event.preventDefault();_stocktakePickStoreById('${(s.id||'').replace(/'/g,'')}')" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--gray-100);font-size:12px" onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background=''">
        <div style="font-weight:700">${(s.name||'').replace(/[<>&]/g,'')}${sigName ? ` <span style="font-size:11px;color:#1d4ed8;font-weight:600">🪧 ${sigName}</span>` : ''}</div>
        <div style="font-size:10.5px;color:var(--gray-500)">${(s.biz||'-')} · ${(s.ceo||'-')} · ${(s.addr||'-').slice(0,40)}</div>
      </div>`;
    }).join('');
    results.style.display = 'block';
  };
  function _stocktakePickStore(s) {
    if (!s) return;
    window._stocktakePickedStore = s;
    const input = document.getElementById('stEditorStoreInput');
    if (input) input.value = s.name || '';
    const sid = document.getElementById('stEditorStoreId');
    if (sid) sid.value = s.id || '';
    const info = document.getElementById('stStorePickedInfo');
    const biz = document.getElementById('stStorePickedBiz');
    const ceo = document.getElementById('stStorePickedCeo');
    if (info) info.style.display = '';
    if (biz) biz.textContent = s.biz || '-';
    if (ceo) ceo.textContent = s.ceo ? `대표: ${s.ceo}` : '';
    const results = document.getElementById('stStoreResults');
    if (results) results.style.display = 'none';
  }
  window._stocktakePickStoreById = function(storeId) {
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const s = stores.find(x => x.id === storeId);
    if (s) _stocktakePickStore(s);
  };
  window.toggleStocktakeUnregStore = function() {
    window._stocktakeUnregMode = !window._stocktakeUnregMode;
    const f = document.getElementById('stUnregForm');
    const btn = document.getElementById('stUnregBtn');
    const pick = document.getElementById('stStorePickedInfo');
    const search = document.getElementById('stEditorStoreInput');
    if (window._stocktakeUnregMode) {
      f.style.display = '';
      btn.style.background = '#92400E'; btn.style.color = '#fff'; btn.textContent = '× 미등록 모드';
      window._stocktakePickedStore = null;
      if (pick) pick.style.display = 'none';
      if (search) search.value = '';
      const sid = document.getElementById('stEditorStoreId');
      if (sid) sid.value = '';
    } else {
      f.style.display = 'none';
      btn.style.background = 'none'; btn.style.color = 'var(--gray-500)'; btn.textContent = '+ 미등록 가맹점';
    }
  };

  // 참여 숫자만큼 행을 한 번에 추가
  window._stocktakeAddMultipleWorkers = function() {
    const n = Math.max(1, parseInt(document.getElementById('stEditorAddCount')?.value || '1', 10));
    for (let i = 0; i < n; i++) window._stocktakeAddWorkerRow();
  };

  window._stocktakeAddWorkerRow = function(w) {
    // payTotal 만 사용 (시간×시급 제거). legacy: 옛 데이터의 hours*payRate 이 있으면 payTotal 로 변환
    let payTotal = Number(w?.payTotal) || 0;
    if (!payTotal && w && (w.hours || w.payRate)) {
      payTotal = Math.round((Number(w.hours)||0) * (Number(w.payRate)||0));
    }
    w = w || {};
    const tbody = document.getElementById('stEditorWorkersBody');
    const tr = document.createElement('tr');
    tr.className = 'st-worker-row';
    const payDisplay = payTotal ? payTotal.toLocaleString('ko-KR') : '';
    tr.innerHTML = `
      <td style="padding:3px 3px;text-align:center"><input class="stw-sel" type="checkbox"></td>
      <td style="padding:3px 3px"><input class="stw-name" type="text" value="${window._stEsc(w.name||'')}" list="stWorkerNamesList" style="width:100%;padding:5px 6px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px"></td>
      <td style="padding:3px 3px"><input class="stw-bank" type="text" value="${window._stEsc(w.bank||'')}" style="width:100%;padding:5px 6px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px"></td>
      <td style="padding:3px 3px"><input class="stw-account" type="text" value="${window._stEsc(w.account||'')}" style="width:100%;padding:5px 6px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px"></td>
      <td style="padding:3px 3px"><input class="stw-holder" type="text" value="${window._stEsc(w.holder||'')}" style="width:100%;padding:5px 6px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px"></td>
      <td style="padding:3px 3px"><input class="stw-pay" type="text" inputmode="numeric" data-money="1" value="${payDisplay}" placeholder="수당" style="width:120px;padding:5px 6px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;text-align:right"></td>
      <td style="padding:3px 3px;text-align:center"><input class="stw-paid" type="checkbox" ${w.paid?'checked':''}></td>
      <td style="padding:3px 3px;text-align:center"><button class="btn btn-outline btn-sm" style="padding:2px 7px;font-size:11px;border-color:#DC2626;color:#DC2626" onclick="this.closest('tr').remove();window._stocktakeRecalcTotals()">✕</button></td>
    `;
    tbody.appendChild(tr);

    window._stocktakeRefreshNamesDatalist();

    const $name = tr.querySelector('.stw-name');
    const $bank = tr.querySelector('.stw-bank');
    const $acct = tr.querySelector('.stw-account');
    const $hold = tr.querySelector('.stw-holder');
    const $pay  = tr.querySelector('.stw-pay');

    function autoFill() {
      const nm = String($name.value||'').trim().toLowerCase();
      if (!nm) return;
      const past = window._stocktakeFindWorkerByName(nm);
      if (!past) return;
      if (!$bank.value) $bank.value = past.bank || '';
      if (!$acct.value) $acct.value = past.account || '';
      if (!$hold.value) $hold.value = past.holder || past.name || '';
    }
    $name.addEventListener('blur', autoFill);
    $name.addEventListener('change', autoFill);
    $name.addEventListener('blur', () => { if (!$hold.value) $hold.value = $name.value || ''; });
    // 수당 입력 — 1,000 단위 포맷 + 합계 재계산
    $pay.addEventListener('input', () => {
      window._stFormatMoneyInput($pay);
      window._stocktakeRecalcTotals();
    });
  };

  /* ── 1,000 단위 포맷 헬퍼 ── */
  window._stReadMoney = function(el) {
    if (!el) return 0;
    return Number(String(el.value||'').replace(/[^\d]/g,'')) || 0;
  };
  window._stFormatMoneyInput = function(el) {
    if (!el) return;
    const raw = String(el.value||'').replace(/[^\d]/g,'');
    el.value = raw ? Number(raw).toLocaleString('ko-KR') : '';
  };
  window._stSetMoneyInput = function(el, n) {
    if (!el) return;
    n = Number(n) || 0;
    el.value = n ? n.toLocaleString('ko-KR') : '';
  };

  /* 수당 일괄 입력 — 체크된 행에만 적용 */
  window._stocktakeApplyBulkPay = function() {
    const bulk = document.getElementById('stBulkPayAmount');
    const amount = window._stReadMoney(bulk);
    if (!amount) { if (typeof showToast === 'function') showToast('금액을 입력하세요'); return; }
    const rows = document.querySelectorAll('#stEditorWorkersBody tr.st-worker-row');
    let cnt = 0;
    rows.forEach(tr => {
      const sel = tr.querySelector('.stw-sel');
      if (!sel || !sel.checked) return;
      const pay = tr.querySelector('.stw-pay');
      if (pay) window._stSetMoneyInput(pay, amount);
      cnt++;
    });
    window._stocktakeRecalcTotals();
    if (typeof showToast === 'function') showToast(`✅ ${cnt}명에게 ${amount.toLocaleString('ko-KR')}원 적용`);
  };

  /* 전체 선택 / 해제 */
  window._stocktakeToggleAllRows = function(checked) {
    document.querySelectorAll('#stEditorWorkersBody tr.st-worker-row .stw-sel').forEach(cb => { cb.checked = !!checked; });
  };

  /* ── 비용 항목 (식사 / 교통비 / 기타) ── */
  window._stocktakeAddExpense = function(category, e) {
    e = e || { category: category||'기타', note:'', amount:0 };
    const tbody = document.getElementById('stEditorExpensesBody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'st-expense-row';
    const catOptions = ['식사','교통비','기타'];
    const opts = catOptions.map(c => `<option value="${c}" ${e.category===c?'selected':''}>${c}</option>`).join('');
    tr.innerHTML = `
      <td style="padding:3px 3px"><select class="ste-cat" style="width:100%;padding:5px 6px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px">${opts}</select></td>
      <td style="padding:3px 3px"><input class="ste-note" type="text" value="${window._stEsc(e.note||'')}" placeholder="내역 (예: 점심 4인분)" style="width:100%;padding:5px 6px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px"></td>
      <td style="padding:3px 3px"><input class="ste-amt" type="text" inputmode="numeric" data-money="1" value="${e.amount?Number(e.amount).toLocaleString('ko-KR'):''}" placeholder="금액" style="width:100%;padding:5px 6px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;text-align:right"></td>
      <td style="padding:3px 3px;text-align:center"><button class="btn btn-outline btn-sm" style="padding:2px 7px;font-size:11px;border-color:#DC2626;color:#DC2626" onclick="this.closest('tr').remove();window._stocktakeRecalcTotals()">✕</button></td>
    `;
    tbody.appendChild(tr);
    const $amt = tr.querySelector('.ste-amt');
    $amt.addEventListener('input', () => { window._stFormatMoneyInput($amt); window._stocktakeRecalcTotals(); });
  };

  window._stocktakeRecalcExpenses = function() {
    let total = 0;
    document.querySelectorAll('#stEditorExpensesBody tr.st-expense-row').forEach(tr => {
      total += window._stReadMoney(tr.querySelector('.ste-amt'));
    });
    const el = document.getElementById('stEditorTotalExpense');
    if (el) el.textContent = total.toLocaleString('ko-KR') + '원';
    return total;
  };

  /* 모달 내 data-money 요소에 자동 포맷 바인딩 (DOMContentLoaded 후 1회) */
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      document.querySelectorAll('#stocktakeEditorModal [data-money="1"]').forEach(el => {
        el.addEventListener('input', () => window._stFormatMoneyInput(el));
      });
    }, 500);
  });

  window._stocktakeRefreshNamesDatalist = function() {
    let dl = document.getElementById('stWorkerNamesList');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'stWorkerNamesList';
      document.body.appendChild(dl);
    }
    const names = new Set();
    (window.getStocktakes() || []).forEach(r => {
      (r.workers || []).forEach(w => { if (w && w.name) names.add(w.name); });
    });
    dl.innerHTML = Array.from(names).map(n => `<option value="${window._stEsc(n)}"></option>`).join('');
  };

  window._stocktakeFindWorkerByName = function(nameLc) {
    const all = window.getStocktakes() || [];
    // 최신 record 부터 찾도록 뒤집기
    for (let i = all.length - 1; i >= 0; i--) {
      const ws = all[i].workers || [];
      for (const w of ws) {
        if (String(w.name||'').trim().toLowerCase() === nameLc && (w.bank || w.account)) return w;
      }
    }
    return null;
  };

  window._stocktakeRecalcTotals = function() {
    let total = 0;
    document.querySelectorAll('#stEditorWorkersBody tr.st-worker-row').forEach(tr => {
      total += window._stReadMoney(tr.querySelector('.stw-pay'));
    });
    document.getElementById('stEditorTotalLabor').textContent = total.toLocaleString('ko-KR') + '원';
    const totalExp = window._stocktakeRecalcExpenses();
    window._stocktakeRecalcMargin(total, totalExp);
  };

  window._stocktakeRecalcMargin = function(totalLabor, totalExpense) {
    if (totalLabor == null) {
      totalLabor = 0;
      document.querySelectorAll('#stEditorWorkersBody tr.st-worker-row').forEach(tr => {
        totalLabor += window._stReadMoney(tr.querySelector('.stw-pay'));
      });
    }
    if (totalExpense == null) totalExpense = window._stocktakeRecalcExpenses();
    const fee = window._stReadMoney(document.getElementById('stEditorFee'));
    const margin = fee - totalLabor - totalExpense;
    const mEl = document.getElementById('stEditorMargin');
    if (mEl) {
      mEl.textContent = margin.toLocaleString('ko-KR') + '원';
      mEl.style.color = margin >= 0 ? '#16A34A' : '#DC2626';
    }
  };

  window._stocktakeSaveEditor = function() {
    const id = document.getElementById('stEditorId').value;
    let storeName = '';
    let storeId = '';
    let unregMeta = null;
    if (window._stocktakeUnregMode) {
      storeName = String(document.getElementById('stUnregName')?.value || '').trim();
      if (!storeName) { if (typeof showToast === 'function') showToast('미등록 가맹점 점포명을 입력하세요'); return; }
      unregMeta = {
        name: storeName,
        biz: String(document.getElementById('stUnregBiz')?.value||'').trim(),
        ceo: String(document.getElementById('stUnregCeo')?.value||'').trim(),
        tel: String(document.getElementById('stUnregTel')?.value||'').trim(),
        addr: String(document.getElementById('stUnregAddr')?.value||'').trim(),
      };
    } else {
      const picked = window._stocktakePickedStore;
      if (picked && picked.id) { storeName = picked.name || ''; storeId = picked.id; }
      else {
        // fallback: 입력 텍스트 값 + 이름 매칭
        storeName = String(document.getElementById('stEditorStoreInput').value || '').trim();
        if (!storeName) { if (typeof showToast === 'function') showToast('매장을 선택하세요'); return; }
        try {
          const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
          const matched = stores.find(s => (s.name||s.storeName||'') === storeName);
          if (matched) storeId = matched.id || '';
        } catch(e){}
      }
    }

    const workers = [];
    document.querySelectorAll('#stEditorWorkersBody tr.st-worker-row').forEach(tr => {
      const name = String(tr.querySelector('.stw-name').value||'').trim();
      if (!name) return; // 빈 이름은 스킵
      const payTotal = window._stReadMoney(tr.querySelector('.stw-pay'));
      const paid = !!tr.querySelector('.stw-paid').checked;
      let holder = String(tr.querySelector('.stw-holder').value||'').trim();
      if (!holder) holder = name;
      workers.push({
        name,
        bank: String(tr.querySelector('.stw-bank').value||'').trim(),
        account: String(tr.querySelector('.stw-account').value||'').trim(),
        holder,
        payTotal,
        paid,
        paidAt: paid ? (new Date().toISOString().slice(0,10)) : '',
      });
    });
    const totalLabor = workers.reduce((a,w)=>a+(Number(w.payTotal)||0),0);
    // 비용 수집
    const expenses = [];
    document.querySelectorAll('#stEditorExpensesBody tr.st-expense-row').forEach(tr => {
      const amount = window._stReadMoney(tr.querySelector('.ste-amt'));
      const note = String(tr.querySelector('.ste-note').value||'').trim();
      if (!amount && !note) return;
      expenses.push({
        category: tr.querySelector('.ste-cat').value || '기타',
        note,
        amount,
      });
    });
    const totalExpense = expenses.reduce((a,e)=>a+(Number(e.amount)||0),0);
    const fee = window._stReadMoney(document.getElementById('stEditorFee'));
    const margin = fee - totalLabor - totalExpense;
    const paymentMethod = (document.querySelector('input[name="stPaymentMethod"]:checked')?.value) || '현금';

    // 기존 record 조회 (thread / lineHistory 보존용) — rec 빌드 전에 미리 가져옴
    const arr = window.getStocktakes();
    const existing = id ? arr.find(x => x.id === id) : null;

    const rec = {
      id: id || ('ST-' + Date.now().toString(36)),
      storeId,
      storeName,
      unregStore: unregMeta || undefined,
      status: document.getElementById('stEditorStatus').value || '상담',
      consultDate: document.getElementById('stEditorConsultDate').value || '',
      scheduleDate: document.getElementById('stEditorScheduleDate').value || '',
      doneDate: document.getElementById('stEditorDoneDate').value || '',
      area: Number(document.getElementById('stEditorArea').value) || 0,
      expectedAmount: window._stReadMoney(document.getElementById('stEditorExpected')),
      actualAmount:   window._stReadMoney(document.getElementById('stEditorActual')),
      headcount: Number(document.getElementById('stEditorHeadcount').value) || workers.length,
      workers,
      totalLabor,
      expenses,
      totalExpense,
      collected: window._stReadMoney(document.getElementById('stEditorCollected')),
      fee,
      margin,
      paymentMethod,
      memo: String(document.getElementById('stEditorMemo').value||''),
      // 담당자 정보
      owner:        String(document.getElementById('stEditorOwner')?.value || ''),
      contactName:  String(document.getElementById('stEditorContactName')?.value || '').trim(),
      contactPhone: String(document.getElementById('stEditorContactPhone')?.value || '').trim(),
      contactRole:  String(document.getElementById('stEditorContactRole')?.value || '').trim(),
      attachments: (function(){ try { return window._stocktakeUploaderCtl ? window._stocktakeUploaderCtl.get() : []; } catch(_) { return []; } })(),
      // 진행 단계 thread — 기존 record 의 thread 보존 (live 편집은 _setThreadFor 가 별도 저장)
      thread:      Array.isArray(existing && existing.thread)      ? existing.thread      : [],
      lineHistory: Array.isArray(existing && existing.lineHistory) ? existing.lineHistory : [],
      createdAt: Date.now(),
    };

    const idx = id ? arr.findIndex(r => r.id === id) : -1;
    if (idx >= 0) {
      rec.createdAt = arr[idx].createdAt || rec.createdAt;
      arr[idx] = rec;
    } else {
      arr.push(rec);
    }
    window.saveStocktakes(arr);
    // 📡 LINE 발송 처리 (체크박스 ON 시) — 자동 발송 대신 편집 컴포저 열기
    const wantLineSend = !!document.getElementById('stEditorLineSend')?.checked;
    closeModal('stocktakeEditorModal');
    if (typeof showToast === 'function') showToast(id ? '재고조사 저장됨' : '재고조사 등록됨');
    window.renderStocktakeHub();
    if (wantLineSend) {
      window._stocktakeOpenLineComposer(rec);
    }
  };

  /* 재고조사 LINE 발송 — 컴포저 모달 열기 (사용자가 본문/채팅방 확인 후 발송) */
  window._stocktakeOpenLineComposer = function(rec) {
    if (!rec) return;
    const status = rec.status || '';
    // 처리일 자동: 상태별
    const todayKst = (function(){
      // 🕐 KST 날짜 — 브라우저 타임존 무관 절대 보정 (UTC+9). 기존 getTimezoneOffset 방식은
      //   브라우저가 이미 KST 면 +9h 이중 적용 → 오후 등록이 다음날로 밀리는 버그. (2026-05-28 fix)
      return new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10);
    })();
    let processDate = '';
    if (status === '마감' || status === '정산' || status === '조사완료') processDate = rec.doneDate || rec.scheduleDate || todayKst;
    else if (status === '일정확정') processDate = rec.scheduleDate || rec.consultDate || todayKst;
    else processDate = rec.consultDate || todayKst;

    // 메시지 본문 (≤140byte) — memo 우선
    const memoHead = (rec.memo || '').replace(/\s+/g,' ').trim();
    const memo30 = (typeof window._sliceByByte === 'function')
                 ? window._sliceByByte(memoHead, window._LINE_HEAD_BYTES || 140)
                 : memoHead.slice(0, 140);
    let content;
    if (memo30) content = memo30;
    else if (status === '마감') content = '재고조사 마감 처리';
    else if (status === '조사완료' || status === '정산') content = '재고조사 완료';
    else if (status === '일정확정') content = '조사 일정 확정';
    else content = '재고조사 의뢰';

    // 공용 빌더 사용 (조사예정 라벨로)
    const defaultText = (typeof window._buildEnrichedLineText === 'function')
      ? window._buildEnrichedLineText(rec, {
          processDate,
          headContent: content,
          scheduleLabel: '📅 조사예정',
        })
      : `${rec.storeName} : ${processDate} ; ${content}`;

    const attachments = Array.isArray(rec.attachments) ? rec.attachments : [];

    if (typeof window._openLineSendComposer !== 'function') {
      if (typeof showToast === 'function') showToast('⚠ LINE 컴포저 컴포넌트가 로드되지 않았습니다');
      return;
    }

    window._openLineSendComposer({
      category: 'stocktake',
      categoryLabel: `📦 재고조사 — ${status || '등록'}`,
      defaultText,
      attachments,
      jobId: rec.id,
      onSent: (result) => {
        // 발송 이력 누적
        try {
          const arr = window.getStocktakes() || [];
          const i = arr.findIndex(x => x.id === rec.id);
          if (i >= 0) {
            arr[i].lineHistory = Array.isArray(arr[i].lineHistory) ? arr[i].lineHistory : [];
            arr[i].lineHistory.push({
              ts: new Date().toISOString(),
              text: result && result.text,
              to:   result && result.to,
              status,
              owner: rec.owner || '',
              ok: !!(result && result.ok),
            });
            window.saveStocktakes(arr);
            window.renderStocktakeHub();
          }
        } catch(_){}
      },
    });
  };

  window._stocktakeDelete = function(id) {
    if (!confirm('이 재고조사 기록을 삭제할까요?')) return;
    const arr = window.getStocktakes().filter(r => r.id !== id);
    window.saveStocktakes(arr);
    if (typeof showToast === 'function') showToast('삭제됨');
    window.renderStocktakeHub();
  };

  window._stocktakeMarkDone = function(id) {
    const arr = window.getStocktakes();
    const r = arr.find(x => x.id === id);
    if (!r) return;
    // 다음 상태로 진행: 상담→일정확정→조사완료→정산→마감
    const flow = ['상담','일정확정','조사완료','정산','마감'];
    const cur = flow.indexOf(r.status);
    r.status = (cur >= 0 && cur < flow.length - 1) ? flow[cur+1] : '마감';
    if (r.status === '조사완료' && !r.doneDate) r.doneDate = new Date().toISOString().slice(0,10);
    window.saveStocktakes(arr);
    if (typeof showToast === 'function') showToast(`상태 → ${r.status}`);
    window.renderStocktakeHub();
  };

  window._stocktakeShowWorkers = function(id) {
    const r = window.getStocktakes().find(x => x.id === id);
    if (!r) return;
    const esc = window._stEsc;
    const body = document.getElementById('stWorkersBody');
    const titleEl = document.getElementById('stWorkersTitle');
    if (titleEl) titleEl.textContent = `👥 ${r.storeName || '(매장)'} 인건비 명단`;
    const workers = r.workers || [];
    if (!workers.length) {
      body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-500);font-size:13px">등록된 명단이 없습니다.</div>';
    } else {
      const total = workers.reduce((a,w)=>a+(Number(w.payTotal)||0),0);
      body.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:12.5px">
          <thead><tr style="background:#F9FAFB"><th style="padding:6px;text-align:left;border-bottom:1px solid var(--gray-200)">이름</th><th style="padding:6px;text-align:left;border-bottom:1px solid var(--gray-200)">은행</th><th style="padding:6px;text-align:left;border-bottom:1px solid var(--gray-200)">계좌</th><th style="padding:6px;text-align:left;border-bottom:1px solid var(--gray-200)">예금주</th><th style="padding:6px;text-align:right;border-bottom:1px solid var(--gray-200)">시간</th><th style="padding:6px;text-align:right;border-bottom:1px solid var(--gray-200)">시급</th><th style="padding:6px;text-align:right;border-bottom:1px solid var(--gray-200)">합계</th><th style="padding:6px;text-align:center;border-bottom:1px solid var(--gray-200)">입금</th></tr></thead>
          <tbody>
            ${workers.map(w => `
              <tr>
                <td style="padding:6px;border-bottom:1px solid var(--gray-100)">${esc(w.name||'')}</td>
                <td style="padding:6px;border-bottom:1px solid var(--gray-100)">${esc(w.bank||'')}</td>
                <td style="padding:6px;border-bottom:1px solid var(--gray-100)">${esc(w.account||'')}</td>
                <td style="padding:6px;border-bottom:1px solid var(--gray-100)">${esc(w.holder||'')}</td>
                <td style="padding:6px;text-align:right;border-bottom:1px solid var(--gray-100)">${w.hours||0}</td>
                <td style="padding:6px;text-align:right;border-bottom:1px solid var(--gray-100)">${(Number(w.payRate)||0).toLocaleString('ko-KR')}</td>
                <td style="padding:6px;text-align:right;border-bottom:1px solid var(--gray-100);font-weight:600">${(Number(w.payTotal)||0).toLocaleString('ko-KR')}</td>
                <td style="padding:6px;text-align:center;border-bottom:1px solid var(--gray-100)">${w.paid?'<span style="color:#16A34A;font-weight:700">✓</span>':'<span style="color:#DC2626">미입금</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot><tr><td colspan="6" style="padding:8px 6px;text-align:right;font-weight:700">합계</td><td style="padding:8px 6px;text-align:right;font-weight:800;color:#DC2626">${total.toLocaleString('ko-KR')}원</td><td></td></tr></tfoot>
        </table>
      `;
    }
    showModal('stocktakeWorkersModal');
  };

  /* ─── VAN hub ─── */
  window.renderVanHub = function() {
    // 접수서류 미확인 카운트 배지 갱신 (백그라운드)
    try { if (typeof window._vanhubRefreshDocsBadge === 'function') window._vanhubRefreshDocsBadge(); } catch(_){}
    _hubGenericRender({
      containerId: 'vanhubContainer',
      filtersId: 'vanhubFilters',
      searchId: 'vanhubSearch',
      cats: ['van'],
      cardCat: 'van',
      cntMap: { all:'vanhubCntAll', prog:'vanhubCntProg', done:'vanhubCntDone' },
    });
  };
  (function _bindVanHubEvents(){
    document.addEventListener('click', (ev) => {
      const f = ev.target.closest('#vanhubFilters .hub-filter');
      if (!f) return;
      f.parentElement.querySelectorAll('.hub-filter').forEach(x => x.classList.remove('active'));
      f.classList.add('active');
      if (typeof renderVanHub === 'function') renderVanHub();
    });
    const sIn = document.getElementById('vanhubSearch');
    if (sIn) sIn.addEventListener('input', () => { if (typeof renderVanHub === 'function') renderVanHub(); });
  })();

  /* ─── 소모품 hub + 매출/미수 통계 + 미수 팝업 ─── */
  function _suppliesStats() {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const supplyJobs = jobs.filter(j => window.classifyJobCategory(j) === 'supplies');
    const now = new Date();
    const month = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');

    let salesThisMonth = 0, arAmount = 0, shipPending = 0;
    let prepaidThisMonth = 0, prepaidTotal = 0;
    let postpaidTotal = 0, postpaidPaidTotal = 0, postpaidPaidThisMonth = 0, supportThisMonth = 0, supportTotal = 0;
    let arRows = [], prepaidRows = [], supportRows = [], postpaidPaidRows = [];
    supplyJobs.forEach(j => {
      const amt = parseInt(String(j.amount||j.price||'0').replace(/[^\d]/g,''), 10) || 0;
      const date = j.shipDate || j.date || (j.createdAt ? new Date(j.createdAt).toISOString().slice(0,10) : '');
      // 신규 모델 우선: j.supplyMode. 없으면 legacy 텍스트 매칭
      let mode = j.supplyMode;
      if (!mode) {
        const blob = String(j.payment||j.note||j.notes||'');
        if (/후불|미수|postpaid/i.test(blob)) mode = 'postpaid';
        else if (amt > 0) mode = 'prepaid';
        else mode = 'support';
      }
      // 후불 수금 완료 여부: arPaid (신규) 또는 텍스트 legacy
      const isPaid = !!j.arPaid || /수금완료|입금완료|paid/i.test(String(j.note||j.notes||''));
      const paidAmt = (typeof j.arPaidAmount === 'number') ? j.arPaidAmount : (isPaid ? amt : 0);
      const isShipped = !!j.shipDate || /발송|배송|shipped/i.test(String(j.note||j.notes||'')) || j.shipped;

      // 품목 표시: 소모품 정규 type 이면 "규격 품목명 수량단위 처리구분" 상세 표시
      //   예: type='소모품/POS용지', supplyQty=2, supplyUnit='박스', mode='support'
      //       → '3" POS용지 2박스 🎁 지원'
      let itemDisp = j.title || j.type || '-';
      try {
        if (typeof window._supplyItemSummary === 'function') {
          const sum = window._supplyItemSummary(j, { withSpec: true, withMode: true });
          if (sum) itemDisp = sum;
        }
      } catch(_){}
      const row = { store: j.storeName||j.store||'-', item: itemDisp, date, amount: amt, jobId: j.id, mode, isPaid, paidAmt };

      // 🔢 건수는 모드만으로 집계(amount=0 선불/후불도 포함), 금액 합산은 amt>0 일 때만
      //   (2026-06-17 버그픽스: 금액 미입력 선불/후불이 어느 칸에도 안 잡혀 건수가 누락되던 문제)
      if (mode === 'prepaid') {
        if (amt > 0) {
          if (date.startsWith(month)) { prepaidThisMonth += amt; salesThisMonth += amt; }
          prepaidTotal += amt;
        }
        prepaidRows.push(row);
      } else if (mode === 'postpaid') {
        if (isPaid) {
          postpaidPaidTotal += paidAmt;
          postpaidPaidRows.push(row);
          // 이번 달 후불 수금 = 실제 수금일(arPaidAt) 기준 (없으면 발송일 fallback)
          const paidMonth = String(j.arPaidAt || '').slice(0,7) || String(date || '').slice(0,7);
          if (paidMonth === month) postpaidPaidThisMonth += paidAmt;
          if (date.startsWith(month)) salesThisMonth += paidAmt;
        } else {
          const out = Math.max(0, amt - paidAmt);   // 부분 수금 후 잔액
          arAmount += out;
          arRows.push({ ...row, outstanding: out });
        }
      } else if (mode === 'support') {
        if (date.startsWith(month)) supportThisMonth++;
        supportTotal++;
        supportRows.push(row);
      }
      if (!isShipped && !_hubDoneFn(j)) shipPending++;
    });
    return {
      salesThisMonth, arAmount, shipPending, totalCount: supplyJobs.length,
      prepaidThisMonth, prepaidTotal, postpaidTotal, postpaidPaidTotal, postpaidPaidThisMonth,
      supportThisMonth, supportTotal,
      arRows, prepaidRows, supportRows, postpaidPaidRows,
    };
  }

  /* ─── 소모품 판매·지원 집계 리포트 (기간 지정 조회) ─── */
  function _supplyReportRows(startYmd, endYmd) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const supplies = jobs.filter(j => window.classifyJobCategory(j) === 'supplies');
    const rows = [];
    for (const j of supplies) {
      const dRaw = j.shipDate || j.date || (j.createdAt ? new Date(Number(j.createdAt)||Date.parse(j.createdAt)||Date.now()).toISOString().slice(0,10) : '');
      const d10 = String(dRaw).slice(0,10);
      if (!d10) continue;
      if (startYmd && d10 < startYmd) continue;
      if (endYmd && d10 > endYmd) continue;
      const amt = parseInt(String(j.amount||j.price||'0').replace(/[^\d]/g,''),10) || 0;
      let mode = j.supplyMode;
      if (!mode) { const blob = String(j.payment||j.note||j.notes||''); mode = /후불|미수|postpaid/i.test(blob) ? 'postpaid' : (amt>0 ? 'prepaid' : 'support'); }
      const paid = Number(j.arPaidAmount)||0;
      const remaining = Math.max(0, amt - paid);
      const isPaid = !!j.arPaid || (amt>0 && remaining===0);
      let status, collectDate = '', outstanding = 0;
      if (mode === 'support') { status = '지원'; }
      else if (mode === 'prepaid') { status = '수금완료'; collectDate = d10; }   // 선불 = 발송(판매) 시 수금 → 수금일 = 발송일
      else { // postpaid
        if (isPaid) { status = '수금완료'; collectDate = j.arPaidAt ? String(j.arPaidAt).slice(0,10) : d10; }
        else { status = '미수'; outstanding = remaining; if (paid>0) collectDate = j.arPaidAt ? String(j.arPaidAt).slice(0,10) : ''; }
      }
      // 출고 품목 — ① 정규 소모품(소모품/POS용지 등): 규격+품목+수량 요약.
      //   ② 비정규(라벨지/택배/장비출고 등 LINE 유입): 요청접수 내용에 실제 품목이 있으므로 그걸로 표기.
      const typeLabel = String(j.type||'소모품').replace(/^소모품\//,'');
      let item = '';
      try { if (typeof window._supplyItemSummary==='function') { const s = window._supplyItemSummary(j, {withSpec:true, withMode:false}); if (s) item = s; } } catch(_){}
      if (!item) {
        const firstRoot = (Array.isArray(j.thread) ? j.thread.find(e=>e && e.parentId===null) : null);
        const reqText = String((firstRoot && firstRoot.text) || j.asRequest || j.lineParsed || j.lineRequest || j.notes || j.memo || j.lineRaw || '').replace(/\s+/g,' ').trim();
        // 수량/단위가 별도 필드에 있으면 덧붙임
        let qtyTxt = '';
        const q = Number(j.supplyQty);
        if (Number.isFinite(q) && q>0) qtyTxt = ` ${q}${j.supplyUnit||'개'}`;
        else { const m = String(j.supplyQty||'').match(/(\d+(?:\.\d+)?)\s*(\S*)/); if (m) qtyTxt = ` ${m[1]}${m[2]||''}`; }
        item = reqText ? `${typeLabel} · ${reqText.slice(0,70)}${qtyTxt}` : `${typeLabel}${qtyTxt}`;
      }
      rows.push({ id:j.id, date:d10, store:(j.storeName||j.store||'-'), item, typeLabel, mode, status, amount:amt, paid, outstanding, collectDate, owner:(j.engineer||j.assignee||'') });
    }
    rows.sort((a,b)=> b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
    return rows;
  }
  window.supReportQuick = function(which) {
    const now = new Date(); let y=now.getFullYear(), m=now.getMonth();
    if (which==='last') { m-=1; if(m<0){m=11;y-=1;} }
    const first = `${y}-${String(m+1).padStart(2,'0')}-01`;
    const last  = `${y}-${String(m+1).padStart(2,'0')}-${String(new Date(y,m+1,0).getDate()).padStart(2,'0')}`;
    const sEl=document.getElementById('supReportStart'); if(sEl) sEl.value=first;
    const eEl=document.getElementById('supReportEnd');   if(eEl) eEl.value=last;
    window.renderSuppliesReport();
  };
  window.renderSuppliesReport = function() {
    const escFn = (typeof esc==='function') ? esc : (s=>String(s==null?'':s));
    const fmt = n => (Number(n)||0).toLocaleString('ko-KR');
    const start = (document.getElementById('supReportStart')||{}).value || '';
    const end   = (document.getElementById('supReportEnd')||{}).value || '';
    const rows = _supplyReportRows(start, end);
    // 요약 집계
    let salesTotal=0, collected=0, outstandingTotal=0, supportCnt=0, paidCnt=0, arCnt=0;
    rows.forEach(r => {
      if (r.status==='지원') supportCnt++;
      else if (r.status==='수금완료') { paidCnt++; salesTotal+=r.amount; collected+=r.amount; }
      else if (r.status==='미수') { arCnt++; salesTotal+=r.amount; collected+=r.paid; outstandingTotal+=r.outstanding; }
    });
    const card = (label,val,color) => `<div style="flex:0 0 auto;background:#fff;border:1px solid var(--gray-200);border-left:3px solid ${color};border-radius:6px;padding:6px 10px"><div style="font-size:10.5px;color:var(--gray-500);font-weight:700">${label}</div><div style="font-size:14px;font-weight:800;color:${color};margin-top:1px">${val}</div></div>`;
    const sumEl = document.getElementById('supReportSummary');
    if (sumEl) sumEl.innerHTML =
        card('판매 총액', fmt(salesTotal)+'원', '#1D4ED8')
      + card('수금 완료', fmt(collected)+'원', '#15803d')
      + card('미수 잔액', fmt(outstandingTotal)+'원', '#B45309')
      + card('지원 건수', supportCnt+'건', '#0EA5E9')
      + card('판매/미수 건수', paidCnt+' / '+arCnt+'건', '#6B7280');
    const body = document.getElementById('supReportBody');
    if (body) {
      if (!rows.length) { body.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--gray-400);font-size:12px">해당 기간에 소모품 판매·지원 내역이 없습니다</td></tr>`; }
      else body.innerHTML = rows.map(r => {
        const c = r.status==='수금완료'?{bg:'#DCFCE7',co:'#15803d'}:(r.status==='미수'?{bg:'#FEF3C7',co:'#B45309'}:{bg:'#DBEAFE',co:'#1D4ED8'});
        return `<tr style="border-bottom:1px solid var(--gray-100)">
          <td style="padding:7px 8px;white-space:nowrap">${escFn(r.date)}</td>
          <td style="padding:7px 8px">${escFn(r.store)}</td>
          <td style="padding:7px 8px">${escFn(r.item)}${r.owner?` <span style="color:var(--gray-400);font-size:11px">· ${escFn(r.owner)}</span>`:''}</td>
          <td style="padding:7px 8px;text-align:right;font-weight:700">${r.amount?fmt(r.amount)+'원':'-'}</td>
          <td style="padding:7px 8px;text-align:center"><span style="background:${c.bg};color:${c.co};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${r.status}</span></td>
          <td style="padding:7px 8px;text-align:right;color:#B45309">${r.outstanding?fmt(r.outstanding)+'원':'-'}</td>
          <td style="padding:7px 8px;white-space:nowrap;color:var(--gray-600)">${escFn(r.collectDate||'-')}</td>
        </tr>`;
      }).join('');
    }
  };
  window.openSuppliesReport = function() {
    const sEl=document.getElementById('supReportStart'), eEl=document.getElementById('supReportEnd');
    if (sEl && !sEl.value) window.supReportQuick('this');  // 기본 당월
    if (typeof showModal==='function') showModal('suppliesReportModal');
    window.renderSuppliesReport();
  };

  // 소모품 술어 — 대시보드 카드(미수금/발송대기) 정의와 동일 (필터에서 재사용)
  window._supIsOutstanding = function(j) {
    let mode = j.supplyMode;
    if (!mode) {
      const blob = String(j.payment||j.note||j.notes||'');
      mode = /후불|미수|postpaid/i.test(blob) ? 'postpaid'
           : ((parseInt(String(j.amount||j.price||'0').replace(/[^\d]/g,''),10)||0) > 0 ? 'prepaid' : 'support');
    }
    if (mode !== 'postpaid' || j.arPaid) return false;
    const amt = parseInt(String(j.amount||j.price||'0').replace(/[^\d]/g,''),10) || 0;
    const paid = Number(j.arPaidAmount)||0;
    return (amt - paid) > 0;
  };
  window._supIsPendingShip = function(j) {
    const isShipped = !!j.shipDate || /발송|배송|shipped/i.test(String(j.note||j.notes||'')) || j.shipped;
    const done = (typeof window._isJobEffectivelyDone === 'function')
      ? window._isJobEffectivelyDone(j) : !!(j.completed || /완료/.test(String(j.status||'')));
    return !isShipped && !done;
  };
  // 상단 카드 클릭 → 리스트를 해당 필터로 전환 + 리스트로 스크롤
  window.supFilterCard = function(kind) {
    const f = (kind === 'ar') ? 'ar' : (kind === 'ship') ? 'ship' : 'all';
    const bar = document.getElementById('supplieshubFilters');
    if (bar) bar.querySelectorAll('.hub-filter').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
    if (typeof renderSuppliesHub === 'function') renderSuppliesHub();
    try { const c = document.getElementById('supplieshubContainer'); if (c) c.scrollIntoView({ behavior:'smooth', block:'start' }); } catch(_){}
  };

  window.renderSuppliesHub = function() {
    const stats = _suppliesStats();
    const fmt = n => (Number(n)||0).toLocaleString();
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setHTML = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
    setHTML('supSalesAmount', `${fmt(stats.salesThisMonth)}<span style="font-size:11px;font-weight:700;color:var(--gray-500);margin-left:3px">원</span>`);
    setHTML('supArAmount', `${fmt(stats.arAmount)}<span style="font-size:11px;font-weight:700;color:var(--gray-500);margin-left:3px">원</span>`);
    setText('supShipCount', stats.shipPending);
    setText('supTotalCount', stats.totalCount);
    setText('supSalesSub', stats.salesThisMonth > 0 ? '이번달 누적' : '데이터 없음');
    setText('supArSub', stats.arRows.length > 0 ? `${stats.arRows.length}건 미수` : '미수 없음');
    // 💳 처리 구분별 집계 표
    setText('supPrepaidCnt',         `${stats.prepaidRows.length}건`);
    setText('supPrepaidThisMonth',   `${fmt(stats.prepaidThisMonth)}원`);
    setText('supPrepaidTotal',       `${fmt(stats.prepaidTotal)}원`);
    setText('supPostpaidCnt',        `${stats.arRows.length + stats.postpaidPaidRows.length}건`);
    // '이번달' 칸 = 이번 달 후불 수금액 (선불/지원 행과 의미 통일). 미수 잔액은 누적 칸 + 상단 미수금 카드에 표시.
    setHTML('supPostpaidOutstanding',`${fmt(stats.postpaidPaidThisMonth)}원`);
    setHTML('supPostpaidPaid',       `수금 ${fmt(stats.postpaidPaidTotal)}원${stats.arAmount>0?` · <span style="color:#F59E0B;font-weight:700">미수 ${fmt(stats.arAmount)}원</span>`:''}`);
    setText('supSupportCnt',         `${stats.supportRows.length}건`);
    setText('supSupportThisMonth',   `${stats.supportThisMonth}건`);
    setText('supSupportTotal',       `${stats.supportTotal}건`);

    _hubGenericRender({
      containerId: 'supplieshubContainer',
      filtersId: 'supplieshubFilters',
      searchId: 'supplieshubSearch',
      cats: ['supplies'],
      cardCat: 'supplies',
      cntMap: { prog:'supplieshubCntProg', all:'supplieshubCntAll', done:'supplieshubCntDone', ar:'supplieshubCntAr', ship:'supplieshubCntShip' },
    });
  };
  (function _bindSuppliesHubEvents(){
    document.addEventListener('click', (ev) => {
      const f = ev.target.closest('#supplieshubFilters .hub-filter');
      if (!f) return;
      f.parentElement.querySelectorAll('.hub-filter').forEach(x => x.classList.remove('active'));
      f.classList.add('active');
      if (typeof renderSuppliesHub === 'function') renderSuppliesHub();
    });
    const sIn = document.getElementById('supplieshubSearch');
    if (sIn) sIn.addEventListener('input', () => { if (typeof renderSuppliesHub === 'function') renderSuppliesHub(); });
  })();

  // 미수금 상세 팝업
  window.openSuppliesArDetail = function() {
    const stats = _suppliesStats();
    const today = new Date();
    const tbody = document.getElementById('suppliesArTbody');
    const summary = document.getElementById('suppliesArSummary');
    if (!tbody) return;
    if (stats.arRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:30px;text-align:center;color:var(--gray-400);font-size:12px">미수금이 없습니다 ✅</td></tr>`;
      if (summary) summary.textContent = '0건 · 0원';
    } else {
      stats.arRows.sort((a,b) => (a.date || '').localeCompare(b.date || ''));
      tbody.innerHTML = stats.arRows.map(r => {
        let age = '';
        let ageColor = 'var(--gray-500)';
        if (r.date) {
          const days = Math.round((today - new Date(r.date+'T00:00:00')) / 86400000);
          age = `${days}일`;
          if (days >= 60) ageColor = 'var(--danger)';
          else if (days >= 30) ageColor = 'var(--warning)';
        }
        const onclick = r.jobId ? `closeModal('suppliesArModal');setTimeout(()=>{try{editNewopen('${_hubEsc(r.jobId)}')}catch(e){}},120)` : '';
        return `<tr style="border-bottom:1px solid var(--gray-100);cursor:${r.jobId?'pointer':'default'}" ${onclick?`onclick="${onclick}"`:''}>
          <td style="padding:9px 12px"><b>${_hubEsc(r.store)}</b></td>
          <td style="padding:9px 12px">${_hubEsc(r.item)}</td>
          <td style="padding:9px 12px;font-size:11.5px;color:var(--gray-600)">${_hubEsc(r.date)}</td>
          <td style="padding:9px 12px;color:${ageColor};font-weight:700;font-size:11.5px">${age}</td>
          <td style="padding:9px 12px;text-align:right;font-weight:800;color:var(--danger)">${r.amount.toLocaleString()}원</td>
        </tr>`;
      }).join('') + `<tr style="background:#fef2f2;font-weight:800"><td colspan="4" style="padding:11px;text-align:right">합계</td><td style="padding:11px;text-align:right;color:var(--danger);font-size:14px">${stats.arAmount.toLocaleString()}원</td></tr>`;
      if (summary) summary.textContent = `${stats.arRows.length}건 · ${stats.arAmount.toLocaleString()}원`;
    }
    if (typeof showModal === 'function') showModal('suppliesArModal');
  };

  function showModal(id) {
    document.getElementById(id).classList.add('show');
    if (id === 'lineImportModal') initLineImportModal();
    if (id === 'newJobModal') {
      // 인라인 편집 잔여 상태 초기화
      window._asInlineEditJobId = null;
      window._lastAsInlineStore = null;
      try { document.body.classList.remove('as-inline-edit-mode'); } catch(e){}
      try {
        const b = document.getElementById('asInlineEditBanner');
        if (b) { b.style.display = 'none'; b.innerHTML = ''; }
        const footer = document.querySelector('#newJobModal .modal-footer .btn.btn-primary');
        if (footer) footer.textContent = '작업 등록';
      } catch(e){}
      // 직전 입력값 초기화 — 매장 검색·메모·일정·장비 카운터 모두 리셋
      try { _resetJobForm(); } catch(e){ console.warn('[showModal] reset 실패', e); }
      buildBallSelectors();
      populateStoreNameList();
      // 카테고리 컨텍스트 적용 (AS hub / 신규 hub / VAN hub 에서 진입 시)
      try { applyJobFormContext(window._currentJobContext || null); } catch(e){}
      // AS 접수일 매번 초기화 → applyJobTypeMode 에서 현재 시각 설정
      try { const r = document.getElementById('asReceivedAt'); if (r) r.value = ''; } catch(e){}
      try { if (typeof applyJobTypeMode === 'function') applyJobTypeMode(); } catch(e){}
      try { _resetStorePickInfo(); } catch(e){}
      // 📷📎 첨부 uploader mount (새 작업 등록 폼)
      try {
        const box = document.getElementById('newJobUploader');
        if (box && window.NS_UPLOAD) {
          window._newJobUploaderCtl = window.NS_UPLOAD.mount(box, {
            initial: [],
            category: 'newjob',
            max: 50,
          });
        }
      } catch(e) { console.warn('newJob uploader mount failed', e); }
    }
    if (id === 'adminModal') {
      try { renderBackupStatus(); } catch(e){}
      try { renderCatalogAdmin(); } catch(e){}
    }
    if (id === 'myPageModal') {
      // 마이페이지 열릴 때 클라우드에서 최신 카탈로그 풀 + 렌더
      try { syncCatalogFromCloud().then(() => renderCatalogAdmin()); } catch(e){}
      try { renderCatalogAdmin(); } catch(e){}
      try { loadVandocsList(); } catch(e){}
    }
  }

  function closeModal(id) {
    // Fix E: 작성 중인 draft 가 있고 live 모드가 아니면 — 확인 후 닫기
    if (id === 'newJobModal'
        && Array.isArray(window._jobThreadDraft) && window._jobThreadDraft.length > 0
        && !window._asInlineEditJobId) {
      const n = window._jobThreadDraft.length;
      if (!confirm('작성 중인 요청이 ' + n + '건 있습니다. 저장하지 않고 닫으시겠습니까?')) return;
    }
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
    // newJobModal 닫힘 시 컨텍스트/입력값 초기화 (재오픈 시 stale 데이터 방지)
    if (id === 'newJobModal') {
      window._currentJobContext = null;
      window._asInlineEditJobId = null;
      window._lastAsInlineStore = null;
      try { document.body.classList.remove('as-inline-edit-mode'); } catch(e){}
      try {
        const b = document.getElementById('asInlineEditBanner');
        if (b) { b.style.display = 'none'; b.innerHTML = ''; }
      } catch(e){}
      try {
        const footer = document.querySelector('#newJobModal .modal-footer .btn.btn-primary');
        if (footer) footer.textContent = '작업 등록';
      } catch(e){}
      try { const chk = document.getElementById('newJobLineSend'); if (chk) chk.checked = false; } catch(e){}
      try { _resetJobForm(); } catch(e){}
      try { applyJobFormContext(null); } catch(e){}
      // newJob uploader ctl 정리
      try { if (window._newJobUploaderCtl && window._newJobUploaderCtl.destroy) window._newJobUploaderCtl.destroy(); } catch(_){}
      window._newJobUploaderCtl = null;
    }
  }
  window.closeModal = closeModal;

  /* 백드롭 클릭으로 모달이 닫히는 동작 비활성화
     — 모달 안에서 입력 도중 실수로 바깥쪽 클릭/포커스 이동 시 데이터 손실 방지
     — 닫기는 ✕ 버튼 또는 ESC 키로만 */
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    // 화면에 떠 있는 모달 중 가장 위(마지막에 열린 것) 닫기
    const open = Array.from(document.querySelectorAll('.modal-overlay.show'));
    if (!open.length) return;
    const top = open[open.length - 1];
    top.classList.remove('show');
    ev.preventDefault();
  });

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', function() {
      const parent = this.closest('.filter-row');
      parent.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
    });
  });

  /* ── 캡처 소스 탭 선택 ── */
  const captureHints = {
    ecount: '💡 이카운트 › 거래처 관리 › 거래처 상세 화면을 캡처하세요. 점포명·대표자·주소·사업자번호가 자동 입력됩니다.',
    kcp:    '💡 KCP 가맹점 포털 › 가맹점 정보 페이지를 캡처하세요. 사업자번호·터미널 ID·가맹점명이 자동 입력됩니다.',
    ksnet:  '💡 KSNET 파트너 포털 › 가맹점 조회 화면을 캡처하세요. 터미널 ID·대표자 정보가 자동 입력됩니다.',
    kicc:   '💡 KICC 파트너넷 › 가맹점 상세 화면을 캡처하세요. 사업자번호·가맹점코드가 자동 입력됩니다.',
    nice:   '💡 나이스페이 파트너 페이지 › 가맹점 정보 화면을 캡처하세요.',
    manual: '✏️ 직접 입력 모드입니다. 아래 양식에 점포 정보를 입력해 주세요.'
  };
  const captureSourceLabels = {
    ecount:'이카운트 — 거래처 상세', kcp:'KCP — 가맹점 정보',
    ksnet:'KSNET — 가맹점 조회', kicc:'KICC — 가맹점 상세',
    nice:'나이스페이 — 가맹점 정보', manual:'직접 입력'
  };
  let currentCaptureSource = 'ecount';

  function selectCaptureTab(el, src) {
    document.querySelectorAll('.capture-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    currentCaptureSource = src;
    document.getElementById('capture-hint').textContent = captureHints[src];
    if (src === 'manual') {
      document.getElementById('dropZone').style.display = 'none';
    } else {
      document.getElementById('dropZone').style.display = '';
      resetCapture();
    }
  }

