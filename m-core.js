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
      return a.name || a.email || '';
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
    return merged;
  }

  async function syncJobsFromCloud() {
    try {
      const res = await fetch('/api/jobs', { cache:'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const local = (function(){ try { return JSON.parse(localStorage.getItem('ns_jobs')||'[]'); } catch { return []; } })();
      const cloud = Array.isArray(data?.jobs) ? data.jobs : [];
      const byId = new Map();
      local.forEach(j => { if (j && j.id && !_isJobTombstoned(j.id)) byId.set(j.id, j); });
      let mergedCount = 0;
      cloud.forEach(j => {
        if (!j || !j.id) return;
        if (_isJobTombstoned(j.id)) return;
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
    const defaultText = _buildEnrichedLineText(rec, { scheduleLabel: scheduleLabelMap[category] || '📅 예정', headContent });

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
  global._isThreadChildOfTombstonedRoot = _isThreadChildOfTombstonedRoot;

  // 분류 / 정규화
  global.classifyJobCategory = classifyJobCategory;
  global._isJobDone = _isJobDone;
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
