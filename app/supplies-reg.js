/* ═══════════════════════════════════════════════════════════════════════
 * 소모품 등록 폼 (재설계 v3) — PC 전용, 독립 모달 (supplyRegModal)
 *   - 상단 매장 검색(키보드 네비 = Autocomplete 'supplyStore') + 선택결과 옆 표시
 *   - 매장 담당자(이름/직책/연락처)
 *   - 소모품 그리드(품목·처리구분·수량·금액) — 행마다 별도 작업, 동일 품목 행 추가 가능
 *   - 등록 상태 라디오(요청접수 / 완료)
 *   - 여러 건을 한 LINE 메시지로(AS 스타일) 발송 또는 메시지 없이 등록
 *   진입: openNewJobFor('supplies') → openSupplyReg() 로 라우팅(app-04 에서 위임)
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
  const E = (s) => (typeof window.esc === 'function') ? window.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  const getVal = (id) => { const e = $(id); return e ? String(e.value || '').trim() : ''; };
  const setVal = (id, v) => { const e = $(id); if (e) e.value = v == null ? '' : v; };

  // 품목 카탈로그 (type → 표시명 + 단위). app-01 SUPPLY_DISPLAY / m/supplies SUPPLY_ITEMS 와 동일 규격.
  const CAT = [
    { type: '소모품/POS용지', label: '3" POS용지', unit: '박스' },
    { type: '소모품/단말용지', label: '2" 단말용지', unit: '박스' },
    { type: '소모품/가격라벨', label: '40×23 가격라벨', unit: '롤' },
    { type: '소모품/프라이스텍', label: '70×35 프라이스텍', unit: '롤' },
    { type: '소모품/저울라벨', label: '58×40 저울라벨', unit: '박스' },
    { type: '소모품/기타', label: '기타', unit: '개' },
  ];
  const CATBY = {}; CAT.forEach(c => CATBY[c.type] = c);
  const MODES = [
    { v: 'support', label: '🎁 지원' },
    { v: 'prepaid', label: '💰 선불' },
    { v: 'postpaid', label: '📌 후불' },
  ];
  const MODE_LABEL = { support: '🎁 지원', prepaid: '💰 선불', postpaid: '📌 후불' };

  let _store = null;          // { id, name, addr, biz, signageName }
  let _rows = [];             // [{ type, mode, qty, amount, etcName }]

  const _today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const _who = () => { try { return (typeof window._currentUserName === 'function' ? window._currentUserName() : '') || (typeof window._currentAuthName === 'function' ? window._currentAuthName() : '') || ''; } catch (_) { return ''; } };
  const _norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
  const _fmtComma = (n) => { const x = Number(String(n).replace(/[^\d.]/g, '')) || 0; return x.toLocaleString('ko-KR'); };
  const _toNum = (v) => Number(String(v || '').replace(/[^\d]/g, '')) || 0;
  const _blankRow = () => ({ type: CAT[0].type, mode: 'support', qty: 1, amount: 0, etcName: '' });

  function _searchStores(q) {
    // 우선 공용 토큰 검색(app-02) 사용 — 상호+주소+사업자+대표+aliases, 비연속 토큰 매칭
    if (typeof window._searchStores === 'function') { try { return window._searchStores(q, 8) || []; } catch (_) {} }
    // fallback — 공용 함수 미로드 시: 토큰 AND 매칭(상호+주소+사업자 통합 blob)
    const all = (typeof getStores === 'function' ? getStores() : []) || [];
    if (!q || !q.trim()) return [];
    const tokens = q.trim().split(/\s+/).map(_norm).filter(Boolean);
    if (!tokens.length) return [];
    return all.filter(s => {
      const blob = _norm([s.name, s.storeName, s.addr, s.address, s.biz, s.bizNo, s.ceo, ...(Array.isArray(s.aliases) ? s.aliases : [])].filter(Boolean).join(' '));
      const digits = String(s.biz || s.bizNo || '').replace(/\D/g, '');
      return tokens.every(t => blob.includes(t) || (/^\d+$/.test(t) && digits.includes(t)));
    }).slice(0, 8);
  }

  function _ensureAC() {
    if (window.__supplyRegACdone || !window.Autocomplete) return;
    window.Autocomplete.register('supplyStore', {
      search: (q) => _searchStores(q),
      renderItem: (s) => {
        const nm = s.name || s.storeName || '(이름없음)';
        const addr = s.addr || s.address || '';
        const biz = s.biz || s.bizNo || '';
        return `<div style="padding:8px 11px"><div style="font-size:13px;font-weight:700;color:var(--gray-800)">${E(nm)}</div><div style="font-size:11px;color:var(--gray-500)">${E([biz, addr].filter(Boolean).join(' · ').slice(0, 48))}</div></div>`;
      },
      onPick: (s) => _pickStore(s),
      emptyMessage: '매칭 매장 없음 — 2자 이상 입력',
    });
    window.__supplyRegACdone = true;
  }

  function _pickStore(s) {
    _store = { id: s.id || '', name: s.name || s.storeName || '', addr: s.addr || s.address || '', biz: s.biz || s.bizNo || '', signageName: s.signageName || '' };
    setVal('supplyStoreInput-reg', _store.name);
    try { window.Autocomplete.hide('supplyStore', 'reg'); } catch (_) {}
    // 매장 담당자는 자동 채움하지 않음 — 입력 담당(작성자)과 매장 담당자는 별개이고,
    //   매장 contacts 에 입력 담당 이름이 섞여 들어가 오표시되던 문제. 항상 빈 칸 → 직접 입력.
    setVal('supplyRegContactName', ''); setVal('supplyRegContactRole', ''); setVal('supplyRegContactPhone', '');
    _renderStoreResult();
    _updateHeader();
    _updatePreview();
  }

  function _renderStoreResult() {
    const el = $('supplyRegStoreResult'); if (!el) return;
    if (!_store) { el.innerHTML = '<span style="font-size:11.5px;color:var(--gray-400)">매장을 검색·선택하세요</span>'; return; }
    el.innerHTML = window._storePickLineHtml ? window._storePickLineHtml(_store)
      : `<span style="font-weight:700;color:#15803d">✓ 선택됨</span> <span style="font-size:11.5px;color:var(--gray-500)">📍 ${E((_store.addr || '').slice(0, 40))}${_store.biz ? ' · ' + E(_store.biz) : ''}</span>`;
  }

  function _updateHeader() {
    const t = $('supplyRegTitle');
    if (t) t.textContent = '🛒 ' + (_store ? (_store.name + ' · 소모품') : '소모품 등록');
  }

  function _lineSummary(r) {
    const c = CATBY[r.type] || { label: r.type, unit: '' };
    const name = (r.type === '소모품/기타' && r.etcName) ? r.etcName : c.label;
    const qty = Number(r.qty) || 0;
    const amt = Number(r.amount) || 0;
    const parts = [name, MODE_LABEL[r.mode] || r.mode, qty + (c.unit || '')];
    let s = parts.filter(Boolean).join(' ');
    if (r.mode !== 'support' && amt > 0) s += ` ${amt.toLocaleString('ko-KR')}원`;
    return s;
  }

  function _renderGrid() {
    const host = $('supplyRegGrid'); if (!host) return;
    const head = `<div style="display:grid;grid-template-columns:1.5fr 0.95fr 1fr 0.9fr 28px;gap:6px;padding:7px 9px;background:var(--gray-50);font-size:11px;color:var(--gray-500);border-bottom:1px solid var(--gray-200)"><div>품목</div><div>처리구분</div><div>수량</div><div style="text-align:right">금액</div><div></div></div>`;
    const rowsHtml = _rows.map((r, i) => {
      const c = CATBY[r.type] || { unit: '' };
      const isEtc = r.type === '소모품/기타';
      const itemCell = isEtc
        ? `<div style="display:flex;flex-direction:column;gap:3px"><select onchange="supplyRegRowChange(${i},'type',this.value)" style="height:32px">${CAT.map(x => `<option value="${x.type}" ${x.type === r.type ? 'selected' : ''}>${E(x.label)}</option>`).join('')}</select><input value="${E(r.etcName || '')}" oninput="supplyRegRowChange(${i},'etcName',this.value)" placeholder="기타 품목명" style="height:28px;font-size:11.5px"></div>`
        : `<select onchange="supplyRegRowChange(${i},'type',this.value)" style="height:32px">${CAT.map(x => `<option value="${x.type}" ${x.type === r.type ? 'selected' : ''}>${E(x.label)}</option>`).join('')}</select>`;
      return `<div style="display:grid;grid-template-columns:1.5fr 0.95fr 1fr 0.9fr 28px;gap:6px;padding:6px 9px;align-items:start;border-bottom:1px solid var(--gray-100)">
        ${itemCell}
        <select onchange="supplyRegRowChange(${i},'mode',this.value)" style="height:32px">${MODES.map(m => `<option value="${m.v}" ${m.v === r.mode ? 'selected' : ''}>${E(m.label)}</option>`).join('')}</select>
        <div style="display:flex;align-items:center;gap:3px"><input type="text" inputmode="numeric" value="${E(String(r.qty || ''))}" oninput="supplyRegRowChange(${i},'qty',this.value)" style="height:32px;text-align:right;width:100%;min-width:0"><span style="font-size:11px;color:var(--gray-400);white-space:nowrap">${E(c.unit || '')}</span></div>
        <input type="text" inputmode="numeric" value="${r.amount ? _fmtComma(r.amount) : ''}" oninput="supplyRegRowChange(${i},'amount',this.value)" ${r.mode === 'support' ? 'disabled' : ''} placeholder="${r.mode === 'support' ? '-' : '0'}" style="height:32px;text-align:right;${r.mode === 'support' ? 'background:var(--gray-50)' : ''}">
        <button type="button" aria-label="행 삭제" onclick="supplyRegRemoveRow(${i})" style="width:28px;height:28px;padding:0;border:1px solid var(--gray-200);background:#fff;border-radius:6px;cursor:pointer;color:var(--gray-400)">✕</button>
      </div>`;
    }).join('');
    host.innerHTML = head + rowsHtml;
  }

  function _updatePreview() {
    const valid = _rows.filter(r => (Number(r.qty) || 0) > 0);
    const total = valid.reduce((s, r) => s + (r.mode === 'support' ? 0 : (Number(r.amount) || 0)), 0);
    const cnt = $('supplyRegCount'); if (cnt) cnt.textContent = `총 ${valid.length}건 · 합계 ${total.toLocaleString('ko-KR')}원`;
    const pv = $('supplyRegLinePreview'); if (!pv) return;
    const owner = _who() || '담당자';
    const cName = getVal('supplyRegContactName'), cRole = getVal('supplyRegContactRole'), cPhone = getVal('supplyRegContactPhone');
    const sig = _store ? (_store.signageName ? `${_store.name} ${_store.signageName}` : _store.name) : '(매장)';
    const lines = valid.length ? valid.map(r => '· ' + _lineSummary(r)).join('\n') : '· (품목·수량 입력)';
    const contactLine = cName ? `\n👤 담당 ${owner} 매장담당 ${cName}${cRole ? '(' + cRole + ')' : ''}${cPhone ? ' ' + cPhone : ''}` : (owner ? `\n👤 담당 ${owner}` : '');
    pv.textContent = `[${owner}] ${sig} : ${_today()} ;\n${lines}${contactLine}`;
  }

  window.supplyRegRowChange = function (i, field, val) {
    if (!_rows[i]) return;
    if (field === 'qty') _rows[i].qty = _toNum(val);
    else if (field === 'amount') { _rows[i].amount = _toNum(val); }
    else if (field === 'mode') { _rows[i].mode = val; if (val === 'support') _rows[i].amount = 0; _renderGrid(); }
    else if (field === 'type') { _rows[i].type = val; _renderGrid(); }
    else _rows[i][field] = val;
    _updatePreview();
  };
  window.supplyRegAddRow = function () { _rows.push(_blankRow()); _renderGrid(); _updatePreview(); };
  window.supplyRegRemoveRow = function (i) { _rows.splice(i, 1); if (!_rows.length) _rows.push(_blankRow()); _renderGrid(); _updatePreview(); };
  window.supplyRegOnContactInput = function () { _updatePreview(); };

  function _ensureModal() {
    if (document.getElementById('supplyRegModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div class="modal-overlay" id="supplyRegModal" onclick="if(event.target===this)closeModal('supplyRegModal')">
  <div class="modal" style="max-width:640px;width:96%;max-height:90vh;display:flex;flex-direction:column;padding:0;overflow:hidden">
    <div style="position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;padding:13px 16px;border-bottom:1px solid var(--gray-200);background:#fff">
      <span style="font-size:15px;font-weight:800" id="supplyRegTitle">🛒 소모품 등록</span>
      <span style="flex:1"></span>
      <button class="modal-close" onclick="closeModal('supplyRegModal')" style="position:static;font-size:18px;background:transparent;border:none;cursor:pointer;color:var(--gray-500)">✕</button>
    </div>
    <div style="padding:14px 16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:13px">
      <div>
        <div style="font-size:12px;color:var(--gray-600);margin-bottom:5px;font-weight:700">매장</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="position:relative;flex:1;min-width:220px">
            <input id="supplyStoreInput-reg" autocomplete="off" placeholder="매장명 / 사업자번호 / 주소 검색"
                   oninput="Autocomplete.live('supplyStore','reg',this)" onfocus="Autocomplete.live('supplyStore','reg',this)"
                   onkeydown="Autocomplete.key('supplyStore','reg',event)" onblur="setTimeout(()=>Autocomplete.hide('supplyStore','reg'),200)"
                   style="width:100%;height:36px;padding:0 10px;border:1px solid var(--gray-300);border-radius:7px;font-size:13px;font-weight:600">
            <div id="supplyStoreSuggest-reg" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:#fff;border:1px solid var(--gray-300);border-radius:7px;box-shadow:0 4px 12px rgba(0,0,0,.1);max-height:240px;overflow-y:auto;margin-top:2px"></div>
          </div>
          <span id="supplyRegStoreResult" style="font-size:12px"></span>
        </div>
        <div style="margin-top:4px;font-size:11px;color:var(--gray-400)">↑↓ 이동 · Enter 선택 · 마우스 클릭도 가능</div>
      </div>
      <div>
        <div style="font-size:12px;color:var(--gray-600);margin-bottom:5px;font-weight:700">매장 담당자</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="supplyRegContactName" oninput="supplyRegOnContactInput()" placeholder="이름" style="flex:1;min-width:90px;height:34px;padding:0 9px;border:1px solid var(--gray-300);border-radius:6px;font-size:13px">
          <input id="supplyRegContactRole" oninput="supplyRegOnContactInput()" placeholder="직책" style="width:96px;height:34px;padding:0 9px;border:1px solid var(--gray-300);border-radius:6px;font-size:13px">
          <input id="supplyRegContactPhone" oninput="supplyRegOnContactInput()" placeholder="연락처" style="width:150px;height:34px;padding:0 9px;border:1px solid var(--gray-300);border-radius:6px;font-size:13px">
        </div>
      </div>
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:12px;color:var(--gray-600);font-weight:700">요청 내역 — 소모품</div>
          <span id="supplyRegCount" style="font-size:11px;color:var(--gray-400)">총 0건 · 합계 0원</span>
        </div>
        <div id="supplyRegGrid" style="border:1px solid var(--gray-200);border-radius:7px;overflow:hidden"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;gap:8px;flex-wrap:wrap">
          <button type="button" onclick="supplyRegAddRow()" style="font-size:13px;padding:6px 12px;border:1px solid var(--gray-300);background:#fff;border-radius:7px;cursor:pointer;font-weight:700">+ 품목 추가 <span style="color:var(--gray-400);font-size:11px;font-weight:400">— 동일 품목도 한 줄 더</span></button>
          <span style="font-size:11px;color:var(--gray-400)">ⓘ 각 행 = 별도 소모품 작업 · 후불은 매장별 미수관리 반영</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;padding:9px 12px;background:var(--gray-50);border-radius:7px">
        <span style="font-size:12px;color:var(--gray-600);font-weight:700">등록 상태</span>
        <label style="display:flex;align-items:center;gap:5px;font-size:13px;font-weight:700;cursor:pointer"><input type="radio" name="supplyRegStatus" value="요청접수" checked> 요청접수</label>
        <label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer"><input type="radio" name="supplyRegStatus" value="완료"> 완료 <span style="font-size:11px;color:var(--gray-400)">(등록과 동시에 완료)</span></label>
      </div>
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <div style="font-size:12px;color:var(--gray-600);font-weight:700">LINE 메시지 미리보기 <span style="color:var(--gray-400);font-weight:400">— 여러 건을 한 메시지로</span></div>
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer"><input type="checkbox" id="supplyRegLineSend" checked> LINE 발송</label>
        </div>
        <div id="supplyRegLinePreview" style="border:1px solid var(--gray-200);border-left:3px solid #06C755;border-radius:0 7px 7px 0;background:var(--gray-50);padding:10px 12px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;color:var(--gray-700);min-height:48px"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:2px;padding-bottom:4px">
        <button type="button" onclick="saveSupplyReg(false)" class="btn btn-outline" style="flex:1;height:42px;font-weight:800;font-size:14px">✓ 등록</button>
        <button type="button" onclick="saveSupplyReg(true)" class="btn" style="flex:1.2;height:42px;font-weight:800;font-size:14px;background:#06C755;color:#fff;border:none">📡 등록 후 LINE 발송</button>
      </div>
    </div>
  </div>
</div>`;
    const node = wrap.firstElementChild;
    document.body.appendChild(node);
  }

  window.openSupplyReg = function () {
    _ensureModal();
    _store = null; _rows = [_blankRow()];
    _ensureAC();
    setVal('supplyStoreInput-reg', ''); setVal('supplyRegContactName', ''); setVal('supplyRegContactRole', ''); setVal('supplyRegContactPhone', '');
    const r0 = document.querySelector('input[name="supplyRegStatus"][value="요청접수"]'); if (r0) r0.checked = true;
    const ls = $('supplyRegLineSend'); if (ls) ls.checked = true;
    _updateHeader(); _renderStoreResult(); _renderGrid(); _updatePreview();
    if (typeof showModal === 'function') showModal('supplyRegModal');
    setTimeout(() => { const i = $('supplyStoreInput-reg'); if (i) i.focus(); }, 120);
  };

  function _buildJob(r, contact, asDone, ts, author, idx) {
    const c = CATBY[r.type] || { unit: '' };
    const rid = 'TR-sup-' + Date.now().toString(36) + '-' + idx + Math.random().toString(36).slice(2, 5);
    const summary = _lineSummary(r);
    const thread = [{ ts, author, status: '요청접수', text: summary, threadId: rid, parentId: null }];
    if (asDone) thread.push({ ts, author, status: '완료', text: '(요청접수와 동시에 완료)', threadId: rid + '-d', parentId: rid });
    const job = {
      id: 'JOB-' + Date.now().toString(36).toUpperCase() + idx + Math.random().toString(36).slice(2, 4).toUpperCase(),
      type: r.type,
      category: 'supplies',
      storeName: _store.name, store: _store.name, storeId: _store.id || '',
      unregistered: !_store.id,
      address: _store.addr || '',
      contactName: contact.name || '', contactRole: contact.role || '', contactPhone: contact.phone || '',
      shipDate: _today(),
      supplyMode: r.mode,
      amount: r.mode === 'support' ? 0 : (Number(r.amount) || 0),
      supplyQty: Number(r.qty) || 0,
      supplyUnit: c.unit || '',
      supplyEtcName: (r.type === '소모품/기타' ? (r.etcName || '') : undefined),
      arDueDate: r.mode === 'postpaid' ? '' : undefined,
      thread: (typeof window._threadMigrate === 'function') ? window._threadMigrate(thread) : thread,
      status: asDone ? '완료' : '요청접수',
      completed: !!asDone,
      doneAt: asDone ? new Date().toISOString() : '',
      notes: '',
      createdAt: Date.now(),
      createdBy: author,
    };
    return job;
  }

  window.saveSupplyReg = function (withLine) {
    if (!_store) { alert('매장을 검색·선택하세요.'); const i = $('supplyStoreInput-reg'); if (i) i.focus(); return; }
    const valid = _rows.filter(r => (Number(r.qty) || 0) > 0);
    if (!valid.length) { alert('소모품 품목의 수량을 입력하세요.'); return; }
    const asDone = ((document.querySelector('input[name="supplyRegStatus"]:checked') || {}).value === '완료');
    const contact = { name: getVal('supplyRegContactName'), role: getVal('supplyRegContactRole'), phone: getVal('supplyRegContactPhone') };
    const author = _who() || '담당자';
    const ts = (typeof window._kstDateTimeStr === 'function') ? window._kstDateTimeStr() : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const created = [];
    valid.forEach((r, k) => { const job = _buildJob(r, contact, asDone, ts, author, k); jobs.unshift(job); created.push(job); });
    if (typeof saveJobs === 'function') saveJobs(jobs);
    try { created.forEach(j => { if (typeof window.ingestJobContactsToStore === 'function') window.ingestJobContactsToStore(j, { allowUpdate:true }); }); } catch (_) {}
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud({ toast: false }); } catch (_) {}
    if (typeof closeModal === 'function') closeModal('supplyRegModal');
    try { if (typeof window.renderSuppliesHub === 'function') window.renderSuppliesHub(); } catch (_) {}
    try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch (_) {}
    if (typeof showToast === 'function') showToast(`✅ 소모품 ${created.length}건 등록${asDone ? ' (완료)' : ''}`);
    if (withLine) _sendLine(valid, contact, author, created[0]);
  };

  function _sendLine(rows, contact, author, firstJob) {
    if (typeof window._openLineSendComposer !== 'function') { if (typeof showToast === 'function') showToast('⚠ LINE 컴포저 미로드'); return; }
    const sig = _store.signageName ? `${_store.name} ${_store.signageName}` : _store.name;
    const lines = rows.map(r => '· ' + _lineSummary(r)).join('\n');
    const contactLine = contact.name ? `\n👤 담당 ${author} 매장담당 ${contact.name}${contact.role ? '(' + contact.role + ')' : ''}${contact.phone ? ' ' + contact.phone : ''}` : (author ? `\n👤 담당 ${author}` : '');
    const defaultText = `${sig} : ${_today()} ;\n${lines}${contactLine}`;
    window._openLineSendComposer({
      category: 'supply',
      categoryLabel: `🛒 소모품 — ${rows.length}건`,
      defaultText,
      jobId: firstJob ? firstJob.id : '',
    });
  }
})();
