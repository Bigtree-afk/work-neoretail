  /* ══════════════════════════════════════════════════════════
     🏷️ 소모품 전용 상세 모달 — _editSupplyJob(jobId)
     ─ 신규용 (설치/가오픈/오픈일/장비테이블/비고) 레이아웃 부적합 해소
     ─ 필드: 점포명 / 작업유형 / 발송일 / 처리구분 / 수량+단위 / 금액 / 수금예정일 / 요청접수 thread / 첨부
     ─ 푸터: ✓ 작업 종료 / ↩ 진행 되돌리기
     ══════════════════════════════════════════════════════════ */
  const _SUPPLY_TYPE_OPTIONS = ['소모품/POS용지','소모품/단말용지','소모품/가격라벨','소모품/프라이스텍','소모품/저울라벨','소모품/기타'];
  const _SUPPLY_UNIT_MAP_PC  = { '소모품/POS용지':'박스','소모품/단말용지':'롤','소모품/가격라벨':'롤','소모품/프라이스텍':'롤','소모품/저울라벨':'박스','소모품/기타':'개' };
  // 필드 단위 자동저장 헬퍼 — 모든 updater 공통
  function _patchJob(jobId, patch) {
    const jobs = getJobs();
    const i = jobs.findIndex(x => x.id === jobId);
    if (i < 0) return null;
    Object.assign(jobs[i], patch);
    jobs[i].updatedAt = Date.now();
    saveJobs(jobs);
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(_){}
    return jobs[i];
  }
  window.updateJobShipDate = function(jobId, v) {
    _patchJob(jobId, { shipDate: v || '' });
    if (typeof renderSuppliesHub === 'function') renderSuppliesHub();
  };
  window.updateJobSupplyType = function(jobId, v) {
    const unit = _SUPPLY_UNIT_MAP_PC[v] || '개';
    _patchJob(jobId, { type: v, supplyUnit: unit });
    if (typeof renderSuppliesHub === 'function') renderSuppliesHub();
    // 모달 재렌더 (단위 자동 갱신)
    if (typeof window._editSupplyJob === 'function') window._editSupplyJob(jobId);
  };
  window.updateJobSupplyMode = function(jobId, v) {
    const patch = { supplyMode: v };
    if (v === 'support') patch.amount = 0;
    _patchJob(jobId, patch);
    if (typeof renderSuppliesHub === 'function') renderSuppliesHub();
    if (typeof window._editSupplyJob === 'function') window._editSupplyJob(jobId);  // 금액 필드 토글
  };
  window.updateJobSupplyQty = function(jobId, v) {
    const n = parseInt(String(v||'1').replace(/[^\d]/g,''),10);
    _patchJob(jobId, { supplyQty: (Number.isFinite(n) && n > 0) ? n : 1 });
    if (typeof renderSuppliesHub === 'function') renderSuppliesHub();
  };
  window.updateJobSupplyAmount = function(jobId, v) {
    const n = parseInt(String(v||'0').replace(/[^\d]/g,''),10) || 0;
    _patchJob(jobId, { amount: n });
    if (typeof renderSuppliesHub === 'function') renderSuppliesHub();
  };
  window.updateJobArDueDate = function(jobId, v) {
    _patchJob(jobId, { arDueDate: v || '' });
  };
  // ✏️ 기타 품목명 — 편집 모드에서 사용
  window.updateJobSupplyEtcName = function(jobId, v) {
    _patchJob(jobId, { supplyEtcName: String(v||'').trim() });
    if (typeof renderSuppliesHub === 'function') renderSuppliesHub();
  };

  window._editSupplyJob = function(jobId) {
    const jobs = getJobs();
    const j = jobs.find(x => x.id === jobId);
    if (!j) { if (typeof showToast === 'function') showToast('작업을 찾을 수 없습니다'); return; }

    // 모달 shell — newopenDetailModal 재사용 (한번 만들어지면 그대로)
    let modal = document.getElementById('newopenDetailModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'newopenDetailModal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:760px;width:96%">
          <div class="modal-header" style="flex-direction:column;align-items:stretch;gap:8px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
              <div class="modal-title" id="newopenDetailTitle" style="flex:1;min-width:0">상세</div>
              <div style="display:flex;gap:4px;align-items:flex-start;flex-shrink:0">
                <button class="modal-close" title="창 최대화/복원" onclick="window._toggleNewopenMaximize&&window._toggleNewopenMaximize()">⛶</button>
                <button class="modal-close" title="닫기" onclick="document.getElementById('newopenDetailModal').classList.remove('show')">✕</button>
              </div>
            </div>
            <div id="newopenDetailFooterLeft" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"></div>
          </div>
          <div class="modal-body" id="newopenDetailBody"></div>
        </div>`;
      document.body.appendChild(modal);
    }

    const title = document.getElementById('newopenDetailTitle');
    const body  = document.getElementById('newopenDetailBody');
    const escFn = (typeof esc === 'function') ? esc : (s)=>String(s||'').replace(/[<>&]/g,'');
    const fmt = n => (Number(n)||0).toLocaleString();
    title.textContent = `🏷️ ${j.storeName || j.store || '-'} · ${j.type || '소모품'}`;

    const jid = j.id;
    const mode = j.supplyMode || ((j.amount > 0) ? 'prepaid' : 'support');
    const amt = Number(j.amount) || 0;
    const paid = Number(j.arPaidAmount) || 0;
    const remaining = Math.max(0, amt - paid);
    const isPostpaid = (mode === 'postpaid');
    const isDone = (typeof _isJobDone === 'function') ? _isJobDone(j) : false;
    const inputSty = 'padding:7px 9px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;background:#fff;font-family:inherit';

    // 메모 (j.memos) — 수금 이력 등 자동 기록만 표시 (편집 X)
    const memosList = Array.isArray(j.memos) ? j.memos : [];
    const memoHtml = memosList.length > 0
      ? `<div style="margin-top:12px;padding:9px 11px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:7px">
          <div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:5px">📒 처리 이력 (${memosList.length}건)</div>
          ${memosList.slice().reverse().map(m => `<div style="font-size:11.5px;color:#78350F;padding:3px 0;border-bottom:1px dotted #FCD34D"><span style="color:#92400E;font-size:10px">${escFn(m.at||'')}${m.author?' · '+escFn(m.author):''}</span><br>${escFn(m.text||'')}</div>`).join('')}
        </div>`
      : '';

    // 요청접수 thread — supplies 는 단순화: ROOT 만 노출 (수정 가능)
    const threadList = Array.isArray(j.thread) ? j.thread : [];
    const reqRoot = threadList.find(e => e && e.parentId === null);
    const threadHtml = reqRoot
      ? `<div style="margin-top:12px;padding:9px 11px;background:#fff;border:1px solid var(--gray-200);border-radius:7px">
          <div style="font-size:11px;font-weight:700;color:var(--gray-700);margin-bottom:5px">📝 요청접수 <span style="font-size:10px;color:var(--gray-400);font-weight:400">${escFn(reqRoot.ts||'')}${reqRoot.author?' · '+escFn(reqRoot.author):''}</span></div>
          <div style="font-size:12.5px;color:var(--gray-700);line-height:1.55;white-space:pre-wrap">${escFn(reqRoot.text||'(내용 없음)')}</div>
        </div>`
      : '';

    body.innerHTML = `
      <!-- 기본 정보 -->
      <div style="display:grid;grid-template-columns:2fr 2fr;gap:12px;margin-bottom:14px;padding:12px 14px;background:#F9FAFB;border-radius:10px;border:1px solid var(--gray-200)">
        <div>
          <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:3px">🏪 점포명</div>
          <input type="text" value="${escFn(j.storeName||j.store||'')}" onchange="updateJobStoreName('${escFn(jid)}',this.value)" style="${inputSty};width:100%;font-weight:700">
          <div style="font-size:10.5px;color:var(--gray-500);margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${j.storeId ? `<span style="color:#065F46">✓ 등록 매장 연결됨</span>` : `<span style="color:#92400E">⚠ 미등록 매장</span>`}
            <button class="btn btn-outline btn-sm" style="font-size:10.5px;padding:3px 9px;font-weight:700;${j.storeId?'':'background:#FEF3C7;color:#92400E;border-color:#FCD34D'}" onclick="linkRegisteredStore('${escFn(jid)}')">${j.storeId ? '🔁 매장 변경' : '🔗 매장 연결'}</button>
            ${j.storeId ? `<button class="btn btn-outline btn-sm" style="font-size:10.5px;padding:3px 8px;color:var(--gray-500)" onclick="unlinkStore('${escFn(jid)}')">🔓 연결 해제</button>` : ''}
            ${j.contactPhone ? `<span style="margin-left:auto">📞 ${escFn(j.contactPhone)}</span>` : ''}
          </div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:3px">🏷️ 작업 유형</div>
          <select onchange="updateJobSupplyType('${escFn(jid)}',this.value)" style="${inputSty};width:100%;font-weight:700">
            ${_SUPPLY_TYPE_OPTIONS.map(t => `<option value="${escFn(t)}" ${j.type===t?'selected':''}>${escFn(t)}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- ✏️ 기타 품목명 — type='소모품/기타' 일 때만 노출 -->
      ${j.type === '소모품/기타' ? `
      <div style="margin-bottom:14px;padding:9px 12px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px">
        <div style="font-size:10.5px;color:#92400E;font-weight:700;margin-bottom:4px">✏️ 기타 품목명 <span style="font-size:10px;color:#A16207;font-weight:400">— LINE 메시지·발송 리스트에 사용</span></div>
        <input type="text" maxlength="40" value="${escFn(j.supplyEtcName||'')}" placeholder="예: 영수증롤, 라벨링테이프 등" onchange="updateJobSupplyEtcName('${escFn(jid)}',this.value)" style="${inputSty};width:100%;border-color:#FCD34D">
      </div>
      ` : ''}

      <!-- 처리 구분 + 수량 + 단위 -->
      <div style="display:grid;grid-template-columns:2fr 1fr 0.7fr 1fr;gap:10px;margin-bottom:14px">
        <div>
          <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:5px">💳 처리 구분</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            ${[
              {v:'support',  l:'🎁 지원',  c:'#15803d', bg:'#F0FDF4'},
              {v:'prepaid',  l:'💰 선불',  c:'#06B6D4', bg:'#ECFEFF'},
              {v:'postpaid', l:'📌 후불',  c:'#F59E0B', bg:'#FFFBEB'},
            ].map(m => `<label style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:${mode===m.v?m.bg:'#fff'};border:2px solid ${mode===m.v?m.c:'var(--gray-200)'};border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:700;color:${mode===m.v?m.c:'var(--gray-700)'}">
              <input type="radio" name="supEditMode_${escFn(jid)}" value="${m.v}" ${mode===m.v?'checked':''} onchange="updateJobSupplyMode('${escFn(jid)}','${m.v}')" style="margin:0">${m.l}
            </label>`).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:3px">📦 수량</div>
          <input type="number" min="1" value="${Number(j.supplyQty)||1}" onchange="updateJobSupplyQty('${escFn(jid)}',this.value)" style="${inputSty};width:100%;text-align:right">
        </div>
        <div>
          <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:3px">단위</div>
          <input type="text" value="${escFn(j.supplyUnit || _SUPPLY_UNIT_MAP_PC[j.type] || '개')}" readonly style="${inputSty};width:100%;text-align:center;background:var(--gray-50)">
        </div>
        ${mode !== 'support' ? `<div>
          <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:3px">💵 금액</div>
          <input type="number" min="0" step="100" value="${amt}" onchange="updateJobSupplyAmount('${escFn(jid)}',this.value)" style="${inputSty};width:100%;text-align:right;font-weight:700">
        </div>` : '<div></div>'}
      </div>

      <!-- 일자: 발송일 + (후불일 때) 수금 예정일 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div>
          <div style="font-size:10.5px;color:var(--gray-500);font-weight:600;margin-bottom:3px">🚚 발송일 <span style="color:var(--danger)">*</span></div>
          <input type="date" value="${escFn((j.shipDate||'').slice(0,10))}" onchange="updateJobShipDate('${escFn(jid)}',this.value)" style="${inputSty};width:100%">
        </div>
        ${isPostpaid ? `<div>
          <div style="font-size:10.5px;color:#92400E;font-weight:700;margin-bottom:3px">💰 수금 예정일</div>
          <input type="date" value="${escFn((j.arDueDate||'').slice(0,10))}" onchange="updateJobArDueDate('${escFn(jid)}',this.value)" style="${inputSty};width:100%;border-color:#FCD34D;background:#FFFBEB">
        </div>` : '<div></div>'}
      </div>

      <!-- 후불 미수 상태 + 수금 처리 버튼 -->
      ${isPostpaid && amt > 0 ? `
      <div style="margin-bottom:14px;padding:11px 13px;background:${j.arPaid?'#F0FDF4':'#FFFBEB'};border:1px solid ${j.arPaid?'#86EFAC':'#FCD34D'};border-radius:9px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <div style="font-size:11px;font-weight:700;color:${j.arPaid?'#15803d':'#92400E'}">${j.arPaid ? '✅ 수금 완료' : '📌 미수금'}</div>
          <div style="font-size:13.5px;font-weight:800;color:${j.arPaid?'#15803d':'#92400E'};margin-top:2px">
            ${j.arPaid ? `${fmt(amt)}원` : `${fmt(remaining)}원 미수`}
            ${paid > 0 && !j.arPaid ? ` <span style="font-size:10.5px;font-weight:600;color:var(--gray-500)">(부분 ${fmt(paid)} / 총 ${fmt(amt)})</span>` : ''}
            ${j.arPaidAt ? ` <span style="font-size:10.5px;color:var(--gray-500)">${escFn(String(j.arPaidAt).slice(0,16).replace('T',' '))}</span>` : ''}
          </div>
        </div>
        ${j.arPaid
          ? `<button onclick="revertSupplyArPay('${escFn(jid)}')" style="background:var(--gray-200);color:var(--gray-700);border:none;border-radius:6px;padding:7px 13px;cursor:pointer;font-size:12px;font-weight:700">↩ 수금 되돌리기</button>`
          : `<button onclick="collectSupplyAr('${escFn(jid)}')" style="background:#15803d;color:#fff;border:none;border-radius:6px;padding:7px 13px;cursor:pointer;font-size:12px;font-weight:700">＋ 수금 처리</button>`}
      </div>
      ` : ''}

      <!-- 요청접수 thread (있을 때만) -->
      ${threadHtml}

      <!-- 처리 이력 메모 (수금 이력 등) -->
      ${memoHtml}

      <!-- 첨부 -->
      <div style="margin-top:14px">
        <div style="font-size:11px;color:var(--gray-500);font-weight:600;margin-bottom:4px">📷📎 첨부</div>
        <div id="jobAttUploader-${escFn(jid)}"></div>
      </div>

      <!-- 매장 일정 / 등록일 -->
      <div style="margin-top:12px;padding:8px 12px;background:var(--gray-50);border-radius:7px;font-size:11px;color:var(--gray-500);display:flex;gap:14px;flex-wrap:wrap">
        <span>등록 ${j.createdAt ? escFn(new Date(j.createdAt).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})) : '-'}</span>
        ${j.updatedAt ? `<span>· 수정 ${escFn(new Date(j.updatedAt).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))}</span>` : ''}
        ${j.completedAt ? `<span>· ✓ 종료 ${escFn(new Date(j.completedAt).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))}</span>` : ''}
        <span style="margin-left:auto;color:var(--gray-400)">ID ${escFn(jid)}</span>
      </div>
    `;

    // 푸터 — 작업 종료 / 진행 되돌리기
    const footerLeft = document.getElementById('newopenDetailFooterLeft');
    if (footerLeft) {
      const primaryBtn = isDone
        ? `<button class="btn btn-outline btn-sm" style="color:var(--gray-700);border-color:var(--gray-400);font-weight:700" onclick="reopenNewopen('${escFn(jid)}');setTimeout(()=>_editSupplyJob('${escFn(jid)}'),100)">↩ 진행으로 되돌리기</button>`
        : `<button class="btn btn-primary btn-sm" style="background:var(--success);font-weight:700" onclick="completeNewopen('${escFn(jid)}');document.getElementById('newopenDetailModal').classList.remove('show')">✓ 작업 종료</button>`;
      const deleteBtn = `<button class="btn btn-outline btn-sm" style="color:#DC2626;border-color:#DC2626;font-weight:700;margin-left:6px" onclick="window._deleteSupplyJob('${escFn(jid)}')">🗑 삭제</button>`;
      footerLeft.innerHTML = primaryBtn + deleteBtn;
    }

    // 첨부 uploader mount (편집 모드)
    try {
      const upBox = document.getElementById('jobAttUploader-' + jid);
      if (upBox && window.NS_UPLOAD) {
        window._jobUploaderCtls = window._jobUploaderCtls || {};
        window._jobUploaderCtls[jid] = window.NS_UPLOAD.mount(upBox, {
          initial: Array.isArray(j.attachments) ? j.attachments : [],
          category: 'supplies',
          jobId: jid,
          max: 30,
          onChange: (arr) => {
            try {
              const _jobs = getJobs();
              const idx = _jobs.findIndex(x => x.id === jid);
              if (idx < 0) return;
              _jobs[idx].attachments = arr.slice();
              if (typeof saveJobs === 'function') saveJobs(_jobs);
              try { if (typeof schedulePushJobsToCloud === 'function') schedulePushJobsToCloud(); } catch(_){}
            } catch(err) { console.warn('attachments save failed', err); }
          },
        });
      }
    } catch(e) { console.warn('[_editSupplyJob] uploader mount failed', e); }

    modal.classList.add('show');
  };

  // 🗑 소모품 출고 기록 삭제 — 모바일 onDeleteJob 과 동일 패턴 (tombstone 으로 부활 차단)
  window._deleteSupplyJob = function(jobId) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const ji = jobs.findIndex(x => x.id === jobId);
    if (ji < 0) { if (typeof showToast === 'function') showToast('작업을 찾을 수 없습니다'); return; }
    const j = jobs[ji];
    const label = `${j.storeName || j.store || '-'} · ${j.type || '소모품'}`;
    if (!confirm(`이 소모품 출고 기록을 삭제할까요?\n\n${label}\n\n클라우드의 다른 기기에서도 사라지며, 되돌릴 수 없습니다.`)) return;
    try { if (typeof _addTombstone === 'function') _addTombstone('job', jobId); } catch(_){}
    jobs.splice(ji, 1);
    if (typeof saveJobs === 'function') saveJobs(jobs);
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(_){}
    try { document.getElementById('newopenDetailModal').classList.remove('show'); } catch(_){}
    if (typeof showToast === 'function') showToast('🗑 소모품 출고 기록이 삭제됐습니다');
    try { _refreshAllHubsAfterThread(); } catch(_){}
  };

  // ⛶ 신규/AS/소모품 상세 모달 최대화/복원 (VAN _toggleVanMaximize 와 동일 패턴)
  window._toggleNewopenMaximize = function() {
    try { const m = document.querySelector('#newopenDetailModal .modal'); if (m) m.classList.toggle('nd-max'); } catch(e){}
  };

  function editNewopen(id) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const j = jobs.find(x => x.id === id);
    if (!j) { showToast && showToast('작업을 찾을 수 없습니다'); return; }

    // VAN 카테고리 — 전용 vanJobModal 로 라우팅 (편집 모드)
    try {
      const catRoute = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
      if (catRoute === 'van' && typeof window.openVanJobModal === 'function') {
        window.openVanJobModal(id);
        return;
      }
      // 🏷️ 소모품 카테고리 — 전용 슬림 모달로 라우팅 (신규용 레이아웃 부적합)
      if (catRoute === 'supplies' && typeof window._editSupplyJob === 'function') {
        window._editSupplyJob(id);
        return;
      }
    } catch(_){}

    let modal = document.getElementById('newopenDetailModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'newopenDetailModal';
      modal.className = 'modal-overlay';
      /* backdrop close disabled — use ✕ or ESC */
      modal.innerHTML = `
        <div class="modal" style="max-width:920px;width:96%">
          <div class="modal-header" style="flex-direction:column;align-items:stretch;gap:8px">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
              <div class="modal-title" id="newopenDetailTitle" style="flex:1;min-width:0">상세</div>
              <div style="display:flex;gap:4px;align-items:flex-start;flex-shrink:0">
                <button class="modal-close" title="창 최대화/복원" onclick="window._toggleNewopenMaximize&&window._toggleNewopenMaximize()">⛶</button>
                <button class="modal-close" title="닫기" onclick="document.getElementById('newopenDetailModal').classList.remove('show')">✕</button>
              </div>
            </div>
            <div id="newopenDetailFooterLeft" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"></div>
          </div>
          <div class="modal-body" id="newopenDetailBody"></div>
        </div>`;
      document.body.appendChild(modal);
    }

    const title = document.getElementById('newopenDetailTitle');
    const body  = document.getElementById('newopenDetailBody');
    title.textContent = `📋 ${j.storeName || j.store || '-'} · ${j.type || '-'}`;

    // 모달 푸터 좌측 — AS 는 thread(요청사항·처리기록) 기반이므로 옛 상태 픽커 제거
    // 신규/VAN/소모품 등은 기존 종료/되돌리기 버튼 유지
    const footerLeft = document.getElementById('newopenDetailFooterLeft');
    if (footerLeft) {
      const catFooter = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
      if (catFooter === 'as') {
        const _asDone = _isAsDone(j);
        footerLeft.innerHTML = _asDone
          ? `<span style="font-size:12px;color:#065F46;font-weight:700">✅ 처리완료<span style="font-weight:400;color:var(--gray-500);font-size:11px;margin-left:6px">${esc((j.completedAt||'').slice(0,16).replace('T',' '))}</span></span>`
          : `<span style="font-size:11.5px;color:var(--gray-500);line-height:1.5">✅ 완료는 아래 <b style="color:#1E40AF">📋 요청사항·처리 기록</b>에서 각 요청접수에 <b style="color:#065F46">✅ 완료</b> 처리를 추가하세요 — 모든 요청이 완료되면 자동으로 <b>처리완료</b>됩니다.</span>`;
      } else {
        const isJobDone = _isJobDone(j);
        footerLeft.innerHTML = isJobDone
          ? `<button class="btn btn-outline btn-sm" style="color:var(--gray-700);border-color:var(--gray-400);font-weight:700" onclick="reopenNewopen('${j.id}');document.getElementById('newopenDetailModal').classList.remove('show')">↩ 진행으로 되돌리기</button>
             <span style="margin-left:10px;font-size:11px;color:var(--gray-500)">완료: ${esc((j.completedAt||'').slice(0,16).replace('T',' '))}</span>`
          : `<button class="btn btn-primary btn-sm" style="background:var(--success);font-weight:700" onclick="completeNewopen('${j.id}');document.getElementById('newopenDetailModal').classList.remove('show')">✓ 작업 종료</button>`;
      }
    }

    // 🔧 PC↔모바일 equipment 호환 — j.equipment 가 hybrid 객체일 수도 있음
    //   - PC 가 array 로 저장: [{name,qty,...}, ...]
    //   - 모바일이 simple count 로 저장: {server:2, kiosk:1, ...}
    //   - 두 형식이 누적된 hybrid object: {"0":{...}, "1":{...}, "server":2, ...}
    // 캐노니컬 array 로 normalize — detailed 우선, simple count 는 placeholder row 로 추가
    const _MOBILE_EQ_NAMES_PC = { pc:'PC', server:'서버', pos:'포스', kiosk:'키오스크', fixedScan:'고정스캐너', handyTerm:'핸디터미널', labelPrint:'라벨프린터', posDaiL:'포스다이 좌타', posDaiR:'포스다이 우타', checker:'체크기', handyScan:'핸디스캐너' };
    const _PC_ALIAS = { client:'pc', fscanner:'fixedScan', posdai:'posDaiR' };
    const eq = (() => {
      const src = j.equipment;
      if (!src) return [];
      if (Array.isArray(src)) return src;
      if (typeof src !== 'object') return [];
      const detailed = [];
      const counts = {};
      Object.entries(src).forEach(([k,v]) => {
        if (v && typeof v === 'object') {
          if ((Number(v.qty)||0) > 0) detailed.push(v);
        } else {
          const n = Number(v)||0;
          if (n > 0) {
            const mk = _PC_ALIAS[k] || k;
            counts[mk] = (counts[mk]||0) + n;
          }
        }
      });
      // detailed 의 fixedKey 와 mobile alias 가 겹치면 simple count 에서 제외 — 중복 방지
      detailed.forEach(d => {
        const k = d.fixedKey || '';
        const mk = _PC_ALIAS[k] || k;
        if (mk in counts) delete counts[mk];
      });
      // simple count → placeholder row (모바일에서 추가한 설치 carry-in)
      Object.entries(counts).forEach(([k,n]) => {
        detailed.push({
          name: _MOBILE_EQ_NAMES_PC[k] || k,
          fixedKey: k,
          qty: n,
          condition: j.equipCondition === 'used' ? 'used' : 'new',
          costPrice: 0, salePrice: 0, subtotal: 0,
          _fromMobileCount: true,  // 추적용 — placeholder 인지 식별
        });
      });
      return detailed;
    })();
    const checked = j.equipmentChecked || {};
    const totalQty = eq.reduce((s, e) => s + (Number(e.qty) || 0), 0);
    const installedQty = eq.reduce((s, e, i) => s + (checked[i] ? (Number(e.qty) || 0) : 0), 0);
    const grandTotal = eq.reduce((s, e) => s + (e.subtotal || (Number(e.qty)||0)*(Number(e.salePrice)||0)), 0);

    const rows = eq.length === 0
      ? `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px">등록된 투입 장비가 없습니다. 우측 상단 [+ 장비 추가] 버튼으로 추가하세요.</td></tr>`
      : eq.map((e, i) => {
          const isChk = !!checked[i];
          const meta = (j.equipmentCheckedBy || {})[i];
          const tag = (txt, bg, fg) => `<span style="background:${bg};color:${fg};font-size:10px;padding:1px 6px;border-radius:4px;margin-left:4px">${esc(txt)}</span>`;
          // 다중 옵션 우선, 없으면 구버전 variant
          const variantTxt = (e.options && Object.keys(e.options).length > 0)
            ? Object.entries(e.options).map(([k,v]) => tag(`${k}: ${v}`, '#EFF6FF', '#1D4ED8')).join('')
            : (e.variant ? tag(e.variant, '#EFF6FF', '#1D4ED8') : '');
          const extraTxt   = e.extra   ? tag(e.extra,   '#F3E8FF', '#7E22CE') : '';
          const sizeTxt    = e.size    ? tag('📐 '+e.size, '#FEF3C7', '#92400E') : '';
          const condBadge  = e.condition === 'used'
            ? tag('중고', '#FEE2E2', '#991B1B')
            : tag('신품', '#D1FAE5', '#065F46');
          const checkInfo = isChk && meta
            ? `<div style="font-size:10px;color:var(--success);margin-top:2px">✓ ${esc(meta.name||'-')} · ${meta.at?new Date(meta.at).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</div>`
            : '';
          const qty   = Number(e.qty) || 0;
          const sale  = Number(e.salePrice) || 0;
          const sub   = qty * sale;
          const inputStyle = 'width:100%;padding:5px 8px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;text-align:right;background:#fff';
          return `<tr style="${isChk?'background:#F0FDF4':''}">
            <td style="padding:8px;border-bottom:1px solid var(--gray-100);text-align:center">
              <input type="checkbox" ${isChk?'checked':''} onchange="toggleEquipChecked('${j.id}',${i},this.checked); editNewopen('${j.id}')" style="width:16px;height:16px;cursor:pointer">
            </td>
            <td style="padding:8px;border-bottom:1px solid var(--gray-100)">
              <div style="font-weight:700">${esc(e.name||'-')}${condBadge}${variantTxt}${extraTxt}${sizeTxt}</div>
              ${e.spec ? `<div style="font-size:11px;color:var(--gray-500);margin-top:2px">${esc(e.spec)}</div>` : ''}
              ${checkInfo}
            </td>
            <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:right">
              <input type="number" min="0" value="${qty}" onchange="updateJobEquipField('${j.id}',${i},'qty',this.value)" style="${inputStyle}">
            </td>
            <td style="padding:8px;border-bottom:1px solid var(--gray-100);text-align:right;color:var(--gray-500)">${(Number(e.costPrice)||0).toLocaleString('ko-KR')}</td>
            <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:right">
              <input type="number" min="0" value="${sale}" onchange="updateJobEquipField('${j.id}',${i},'salePrice',this.value)" style="${inputStyle}">
            </td>
            <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:right">
              <input type="number" min="0" value="${sub}" onchange="updateJobEquipField('${j.id}',${i},'subtotal',this.value)" style="${inputStyle};font-weight:700;color:var(--primary)">
            </td>
            <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:center">
              <button title="삭제" onclick="if(confirm('이 장비를 삭제하시겠습니까?'))removeJobEquip('${j.id}',${i})" style="background:none;border:1px solid var(--gray-200);border-radius:5px;padding:4px 8px;cursor:pointer;font-size:13px;color:var(--danger)">×</button>
            </td>
          </tr>`;
        }).join('');

    // LINE 출처 작업이면 상단에 업무 내역 패널 추가
    const lineInfoHtml = (j.source === 'line' && (j.lineRaw || j.lineParsed)) ? (() => {
      const isAs = /AS|에이에스/i.test(j.type || '');
      const cat = j.lineCategory || '';
      const catLabel = (typeof LINE_TYPE_META === 'object' && LINE_TYPE_META[cat]) ? LINE_TYPE_META[cat].label : '';
      const isCompleted = (j.status === '완료' || j.status === '처리완료' || j.status === 'done');
      const panelLabel = isCompleted ? '✅ 처리 내역' : (isAs ? '🛠 업무 요청' : '📋 업무 내역');
      return `
        <div style="margin-bottom:14px;border:1.5px solid #06C755;border-radius:10px;overflow:hidden;background:#fff">
          <!-- 헤더: 카테고리·일자·시간·발신자 -->
          <div style="background:linear-gradient(135deg,#06C755,#04A047);color:#fff;padding:8px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px">
            <span style="font-weight:800">${panelLabel}</span>
            ${catLabel ? `<span style="background:rgba(255,255,255,0.25);padding:2px 8px;border-radius:10px;font-weight:700">${esc(catLabel)}</span>` : ''}
            <span style="margin-left:auto;display:flex;gap:10px;align-items:center;font-size:11px;opacity:0.95">
              <span>📅 ${esc(j.lineMsgAt || '-')}</span>
              <span>👤 ${esc(j.lineSender || '-')}</span>
              ${j.lineRoom ? `<span>💬 ${esc(j.lineRoom)}</span>` : ''}
            </span>
          </div>
          <!-- 본문: 요약 + 원문 -->
          <div style="padding:10px 12px;font-size:13px">
            ${j.lineParsed ? `<div style="font-weight:700;color:var(--gray-900);margin-bottom:6px;line-height:1.5">▸ ${esc(j.lineParsed)}</div>` : ''}
            ${j.lineRaw ? `<div style="background:#F3F4F6;border-left:3px solid #06C755;padding:8px 10px;border-radius:5px;font-size:12px;color:var(--gray-700);white-space:pre-wrap;line-height:1.5">${esc(j.lineRaw)}</div>` : ''}
            ${(j.lineRequest && j.lineRequest !== j.lineParsed) ? `<div style="margin-top:6px;font-size:11px;color:var(--gray-500)">핵심: ${esc(j.lineRequest)}</div>` : ''}
          </div>
        </div>`;
    })() : '';

    body.innerHTML = lineInfoHtml + `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;padding:14px;background:#F9FAFB;border-radius:10px;border:1px solid var(--gray-200)">
        <div>
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span>점포명</span>
            ${j.unregistered ? '<span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:700">미등록</span>' : '<span style="background:#D1FAE5;color:#065F46;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:700">등록 매장 연결됨</span>'}
            ${j.originalStoreName && j.originalStoreName !== (j.storeName||j.store) ? `<span style="font-size:10px;color:var(--gray-400)">최초: ${esc(j.originalStoreName)}</span>` : ''}
          </div>
          <input type="text" value="${esc(j.storeName || j.store || '')}" placeholder="점포명을 입력하세요" onchange="updateJobStoreName('${j.id}',this.value)" style="width:100%;padding:7px 9px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;font-weight:700;background:#fff;margin-bottom:6px">
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" style="color:${j.storeId?'var(--gray-700)':'var(--warning)'};border-color:${j.storeId?'var(--gray-400)':'var(--warning)'};font-size:11px;padding:4px 10px;font-weight:700" onclick="document.getElementById('newopenDetailModal').classList.remove('show');linkRegisteredStore('${j.id}')">🔗 ${j.storeId?'다른 매장으로 재매칭':'등록 매장 매칭'}</button>
            ${j.storeId ? `<button class="btn btn-outline btn-sm" style="color:var(--gray-600);border-color:var(--gray-300);font-size:11px;padding:4px 10px" onclick="document.getElementById('newopenDetailModal').classList.remove('show');unlinkStore('${j.id}')">🔓 연결 해제</button>` : ''}
          </div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;display:flex;align-items:center;gap:4px">
            작업 유형 <span style="font-size:10px;color:var(--gray-400)">— 변경 시 분류·필터에 반영</span>
          </div>
          <select onchange="updateJobType('${j.id}', this.value)"
                  style="width:100%;padding:7px 9px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;font-weight:700;background:#fff">
            ${(() => {
              const types = ['신규','신규가맹','POS교체','VAN교체','SW교체','AS 처리','상담','장비 추가','이동단말기 개통','이동단말기 해지','밴서류','정보변경','재신고','기타'];
              if (j.type && !types.includes(j.type)) types.push(j.type);
              return types.map(t => `<option value="${esc(t)}" ${j.type===t?'selected':''}>${esc(t)}</option>`).join('');
            })()}
          </select>
        </div>
        <div><div style="font-size:11px;color:var(--gray-500);margin-bottom:2px">👷 처리 담당</div><div style="font-size:11px;color:var(--gray-400)">요청별로 아래 스레드에서 지정</div></div>
        ${(() => {
          // 📌 매장 주요 일정(설치/가오픈/오픈) — AS 카테고리에서는 숨김
          const _cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
          if (_cat === 'as') return '';
          return `<div style="grid-column:1/-1">
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px">📌 매장 주요 일정 <span style="font-size:10px;color:var(--gray-400)">— 입력 즉시 자동 저장</span></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;background:#fff;padding:10px;border:1px solid var(--gray-200);border-radius:8px">
            <div>
              <div style="font-size:10px;color:var(--gray-500);margin-bottom:3px;font-weight:600">🔧 설치 예정일</div>
              <input type="date" value="${esc((j.installDate||'').slice(0,10))}" onchange="updateJobDate('${j.id}','installDate',this.value)" style="width:100%;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px">
            </div>
            <div>
              <div style="font-size:10px;color:var(--gray-500);margin-bottom:3px;font-weight:600">🌅 가오픈일</div>
              <input type="date" value="${esc((j.softOpenDate||'').slice(0,10))}" onchange="updateJobDate('${j.id}','softOpenDate',this.value)" style="width:100%;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px">
            </div>
            <div>
              <div style="font-size:10px;color:var(--gray-500);margin-bottom:3px;font-weight:600">🎉 오픈일</div>
              <input type="date" value="${esc((j.openDate||'').slice(0,10))}" onchange="updateJobDate('${j.id}','openDate',this.value)" style="width:100%;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px">
            </div>
          </div>
        </div>`;
        })()}
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;display:flex;align-items:center;gap:6px">
            📍 주소 <span style="font-size:10px;color:var(--gray-400)">— 입력 즉시 자동 저장</span>
          </div>
          <input type="text" value="${esc(j.address||'')}" placeholder="도로명 주소를 입력하세요" onchange="updateJobAddress('${j.id}',this.value)" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;background:#fff">
        </div>
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;display:flex;align-items:center;justify-content:space-between">
            <span>👤 매장 담당자 <span style="font-size:10px;color:var(--gray-400)">— ⭐별표를 클릭해 대표 연락망을 지정하세요. 메인 화면에는 대표만 노출됩니다.</span></span>
            <button class="btn btn-outline btn-sm" style="font-size:11px;padding:4px 10px;font-weight:700" onclick="addJobContact('${j.id}')">+ 담당자 추가</button>
          </div>
          <div style="background:#fff;padding:10px;border:1px solid var(--gray-200);border-radius:8px;display:flex;flex-direction:column;gap:6px">
            ${(() => {
              const list = getJobContacts(j);
              if (list.length === 0) {
                return `<div style="text-align:center;color:var(--gray-400);font-size:12px;padding:14px">담당자가 없습니다. 우측 상단 [+ 담당자 추가] 버튼을 누르세요.</div>`;
              }
              return list.map((c, idx) => `
                <div style="display:grid;grid-template-columns:36px 1fr 1fr 1fr 36px;gap:6px;align-items:center">
                  <button title="${c.primary?'대표 연락망':'대표로 지정'}" onclick="setPrimaryContact('${j.id}',${idx})" style="background:none;border:1px solid ${c.primary?'#F59E0B':'var(--gray-200)'};border-radius:6px;padding:6px;cursor:pointer;font-size:14px;color:${c.primary?'#F59E0B':'var(--gray-300)'}">${c.primary?'★':'☆'}</button>
                  <input type="text" value="${esc(c.name||'')}" placeholder="홍길동" onchange="updateJobContactAt('${j.id}',${idx},'name',this.value)" style="width:100%;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px">
                  <input type="text" value="${esc(c.role||'')}" placeholder="점장 / 사장 등" list="contactRoleList" onchange="updateJobContactAt('${j.id}',${idx},'role',this.value)" style="width:100%;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px">
                  <input type="tel" value="${esc(c.phone||'')}" placeholder="010-0000-0000" onchange="updateJobContactAt('${j.id}',${idx},'phone',this.value)" style="width:100%;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px">
                  <button title="삭제" onclick="if(confirm('이 담당자를 삭제하시겠습니까?'))removeJobContact('${j.id}',${idx})" style="background:none;border:1px solid var(--gray-200);border-radius:6px;padding:6px;cursor:pointer;font-size:13px;color:var(--danger)">×</button>
                </div>`).join('');
            })()}
          </div>
        </div>
        ${(() => {
          // 🗒 메모 — AS 카테고리에서는 숨김 (AS 는 thread 요청접수·처리기록으로 기록, CLAUDE.md 레이아웃 규칙)
          const _cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
          if (_cat === 'as') return '';
          const _memos = Array.isArray(j.memos) ? j.memos : [];
          const _memoListHtml = _memos.length === 0 ? '' : `<div style="margin-top:8px;background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px">
              <div style="font-size:11px;color:var(--gray-500);font-weight:600">🗓 메모 기록 (${_memos.length}건)</div>
              ${_memos.slice().reverse().map((m, revIdx) => {
                const idx = _memos.length - 1 - revIdx;
                return `<div style="display:grid;grid-template-columns:130px 1fr 28px;gap:6px;align-items:start;padding:6px;border:1px solid var(--gray-100);border-radius:6px;background:#FAFAFA">
                  <div style="font-size:11px;color:var(--gray-500);font-weight:600;white-space:nowrap">${esc(m.at||'')}<div style="font-size:10px;color:var(--gray-400);margin-top:2px;font-weight:400">${esc(m.author||'')}</div></div>
                  <textarea onchange="updateJobMemoAt('${j.id}',${idx},this.value)" style="width:100%;min-height:34px;padding:5px 7px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff;font-family:inherit;resize:vertical">${esc(m.text||'')}</textarea>
                  <button title="삭제" onclick="if(confirm('이 메모를 삭제하시겠습니까?'))removeJobMemo('${j.id}',${idx})" style="background:none;border:1px solid var(--gray-200);border-radius:5px;padding:4px 6px;cursor:pointer;font-size:12px;color:var(--danger)">×</button>
                </div>`;
              }).join('')}
            </div>`;
          return `
        <div style="grid-column:1/-1">
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;gap:8px">
            <span>🗒 메모 <span style="font-size:10px;color:var(--gray-400)">— 시간 순으로 누적 기록</span></span>
          </div>
          <div style="margin-top:0;display:flex;gap:6px;align-items:flex-start">
            <textarea id="jobMemoInput-${j.id}" placeholder="메모 입력 후 [추가] 클릭 — 줄바꿈 가능 (Shift+Enter)" style="flex:1;min-height:46px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;background:#fff;font-family:inherit;resize:vertical" onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();addJobMemo('${j.id}')}"></textarea>
            <button class="btn btn-primary btn-sm" style="font-size:12px;padding:8px 14px;font-weight:700;white-space:nowrap" onclick="addJobMemo('${j.id}')">+ 추가</button>
          </div>
          ${_memoListHtml}
        </div>`;
        })()}
        <div style="grid-column:1/-1">
          <div style="margin-top:10px;font-size:11px;color:var(--gray-500);margin-bottom:4px">📷📎 첨부 (작업 전체)</div>
          <div id="jobAttUploader-${j.id}"></div>
        </div>

        ${(() => {
          /* 📋 요청사항 · 처리 기록 (그룹) — 신규 + AS 공용
             📑 VAN 서류 진행 — 신규 전용 */
          const cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
          if (cat !== 'new' && cat !== 'as') return '';
          const vandocsBlock = (cat === 'new') ? `<div id="jobVandocsContainerEdit-${j.id}"></div>` : '';
          return `<div style="grid-column:1/-1;display:flex;flex-direction:column;gap:14px">
            <div id="jobThreadContainerEdit-${j.id}"></div>
            ${vandocsBlock}
          </div>`;
        })()}
      </div>

      ${(() => {
        // AS 카테고리는 처리 기록(child)의 equipment 가 진실의 원천 — 하단 장비 섹션 전체 숨김
        const _catEq = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
        if (_catEq === 'as') return '';
        /* 🏪 매장 누적 설치 장비 — 같은 매장의 모든 작업에서 '설치 완료' 표시된 장비 집계 */
        const storeKey = (j.storeId || '') + '|' + (j.storeName || j.store || '');
        const allJobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        const sameStore = allJobs.filter(o => {
          if (!o || o.id === j.id) return false;
          const k = (o.storeId || '') + '|' + (o.storeName || o.store || '');
          return k === storeKey && (o.storeName || o.store);
        });
        // 현재 job 도 포함해서 집계 (현재 설치 완료 항목까지)
        const allCandidates = [j, ...sameStore];
        const aggMap = new Map();
        allCandidates.forEach(o => {
          const oeq = Array.isArray(o.equipment) ? o.equipment : [];
          const ochk = o.equipmentChecked || {};
          oeq.forEach((e, i) => {
            if (!ochk[i]) return;
            const variant = e.variant || (e.options ? Object.entries(e.options).map(([k,v])=>`${k}:${v}`).join(' / ') : '');
            const key = `${e.name||''}__${variant}__${e.size||''}__${e.condition||''}`;
            if (!aggMap.has(key)) {
              aggMap.set(key, { name:e.name||'-', variant, size:e.size||'', condition:e.condition||'', qty:0, jobIds:[], lastDate:'' });
            }
            const a = aggMap.get(key);
            a.qty += Number(e.qty)||0;
            a.jobIds.push({id:o.id, type:o.type, date:o.installDate||o.softOpenDate||o.openDate||o.date||o.createdAt||''});
            const d = (o.completedAt||'').slice(0,10) || (o.installDate||'').slice(0,10) || '';
            if (d && (!a.lastDate || d > a.lastDate)) a.lastDate = d;
          });
        });
        const aggList = [...aggMap.values()].sort((a,b)=> (b.lastDate||'').localeCompare(a.lastDate||''));
        const totalInstalled = aggList.reduce((s,a)=>s+a.qty,0);
        const showCount = aggList.length;
        if (showCount === 0) return '';
        const itemsHtml = aggList.slice(0, 30).map(a => {
          const variantTag = a.variant ? `<span style="background:#EFF6FF;color:#1D4ED8;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:3px">${esc(a.variant)}</span>` : '';
          const sizeTag = a.size ? `<span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:3px">📐 ${esc(a.size)}</span>` : '';
          const condTag = a.condition === 'used' ? `<span style="background:#FEE2E2;color:#991B1B;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:3px">중고</span>` : '';
          const jobCount = a.jobIds.length > 1 ? ` <span style="color:var(--gray-400);font-size:10px">· ${a.jobIds.length}개 작업</span>` : '';
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fff;border:1px solid var(--gray-200);border-radius:6px;font-size:12px">
            <span style="font-weight:700;color:var(--gray-800);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}${condTag}${variantTag}${sizeTag}</span>
            <span style="color:var(--primary);font-weight:700;white-space:nowrap">${a.qty}대</span>
            ${a.lastDate ? `<span style="color:var(--gray-400);font-size:10px;white-space:nowrap">${esc(a.lastDate)}</span>` : ''}
            ${jobCount}
          </div>`;
        }).join('');
        const more = aggList.length > 30 ? `<div style="text-align:center;font-size:11px;color:var(--gray-400);padding:4px">... 외 ${aggList.length - 30}종</div>` : '';
        return `<div style="margin-bottom:14px;padding:10px 12px;background:#F0FDF4;border:1.5px solid #86EFAC;border-radius:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:10px;flex-wrap:wrap">
            <div style="font-size:13px;font-weight:700;color:#065F46">🏪 매장 누적 설치 장비 <span style="font-size:11px;color:#059669;font-weight:600">— ${showCount}종 · 총 ${totalInstalled}대 설치됨${sameStore.length>0?' · 관련 작업 '+(sameStore.length+1)+'건':''}</span></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px">${itemsHtml}</div>
          ${more}
        </div>`;
      })()}

      ${((typeof window.classifyJobCategory === 'function') && window.classifyJobCategory(j) === 'as') ? '' : `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:0 4px;gap:10px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:700;color:var(--gray-700)">📦 설치되어야 할 장비 (${eq.length}종 · 총 ${totalQty}대)</div>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:12px;color:var(--gray-500)">설치 완료: <b style="color:var(--success)">${installedQty}</b> / ${totalQty}대</div>
          <button class="btn btn-primary btn-sm" style="font-size:12px;padding:6px 12px;font-weight:700" onclick="toggleEquipPicker('${j.id}')">${equipPanelOpenForJobId === j.id ? '− 장비 추가 닫기' : '+ 장비 추가'}</button>
        </div>
      </div>

      <div style="overflow-x:auto;border:1px solid var(--gray-200);border-radius:10px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead style="background:#F3F4F6">
            <tr>
              <th style="padding:10px;width:60px;text-align:center;font-size:11px;font-weight:700">설치</th>
              <th style="padding:10px;text-align:left;font-size:11px;font-weight:700">품목 / 분류 / 상태</th>
              <th style="padding:10px;text-align:right;width:80px;font-size:11px;font-weight:700">수량</th>
              <th style="padding:10px;text-align:right;width:100px;font-size:11px;font-weight:700">입고가</th>
              <th style="padding:10px;text-align:right;width:110px;font-size:11px;font-weight:700">판매가</th>
              <th style="padding:10px;text-align:right;width:130px;font-size:11px;font-weight:700">합계</th>
              <th style="padding:10px;width:40px;text-align:center;font-size:11px;font-weight:700">삭제</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:#F9FAFB;font-weight:700">
              <td colspan="5" style="padding:10px;text-align:right;color:var(--gray-600)">총 합계</td>
              <td style="padding:10px;text-align:right;color:var(--primary);font-size:14px">${grandTotal.toLocaleString('ko-KR')}원</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      ${equipPanelOpenForJobId === j.id ? `
        <div id="equipPickerInline" style="margin-top:14px;border:2px solid var(--primary);border-radius:10px;background:#F8FAFC;overflow:hidden">
          <div style="background:var(--primary);color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
            <div style="font-weight:700;font-size:13px">📋 장비 카탈로그 — 옵션 선택 후 [추가] 버튼을 눌러 작업에 추가하세요</div>
            <button onclick="toggleEquipPicker('${j.id}')" style="background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:5px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:700">닫기</button>
          </div>
          <div style="max-height:480px;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px">
            ${(() => {
              const catalog = getEquipmentCatalog();
              if (catalog.length === 0) {
                return `<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px">등록된 장비가 없습니다. 마이페이지(관리자) → 장비 품목 관리에서 추가하세요.</div>`;
              }
              // 카테고리별 그룹핑
              const groups = {};
              catalog.forEach(def => {
                const c = def.category || '기타';
                (groups[c] = groups[c] || []).push(def);
              });
              const inputSty = 'padding:5px 7px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff';
              return Object.keys(groups).map(cat => `
                <div style="font-size:11px;font-weight:700;color:var(--gray-600);background:#E5E7EB;padding:4px 8px;border-radius:4px;margin-top:6px">${esc(cat)}</div>
                ${groups[cat].map(def => {
                  const dcost = Number(def.costPrice)||0;
                  const dsale = Number(def.salePrice)||0;
                  const opts = normalizeCatalogOptions(def);
                  const optionSelects = opts.map((g, gi) => `
                    <select id="pick-opt-${def.id}-${gi}" data-label="${esc(g.label)}" onchange="onPickerSubChange('${def.id}')" style="${inputSty}" title="${esc(g.label)}">
                      ${g.choices.map(c => `<option value="${esc(c)}">${esc(g.label)}: ${esc(c)}</option>`).join('')}
                    </select>`).join('');
                  return `
                    <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <div style="font-weight:700;font-size:13px;min-width:140px">${esc(def.name)}</div>
                      ${optionSelects}
                      <select id="pick-cond-${def.id}" style="${inputSty}">
                        <option value="new">신품</option>
                        <option value="used">중고</option>
                      </select>
                      <label style="font-size:10px;color:var(--gray-500);display:flex;align-items:center;gap:3px">수량
                        <input id="pick-qty-${def.id}" type="number" min="0" value="1" oninput="onPickerSubChange('${def.id}')" style="${inputSty};width:55px;text-align:right">
                      </label>
                      <label style="font-size:10px;color:var(--gray-500);display:flex;align-items:center;gap:3px">입고가
                        <input id="pick-cost-${def.id}" type="number" min="0" value="${dcost}" style="${inputSty};width:80px;text-align:right;color:var(--gray-500)">
                      </label>
                      <label style="font-size:10px;color:var(--gray-500);display:flex;align-items:center;gap:3px">판매가
                        <input id="pick-sale-${def.id}" type="number" min="0" value="${dsale}" oninput="onPickerSubChange('${def.id}')" style="${inputSty};width:90px;text-align:right">
                      </label>
                      <div style="margin-left:auto;font-size:11px;color:var(--gray-500);white-space:nowrap">합계 <b id="pick-total-${def.id}" style="color:var(--primary)">${(1*dsale).toLocaleString('ko-KR')}원</b></div>
                      <button onclick="addEquipFromCatalog('${j.id}','${def.id}')" style="background:var(--primary);color:#fff;border:none;border-radius:5px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">＋ 추가</button>
                    </div>`;
                }).join('')}
              `).join('');
            })()}
            <!-- 직접 입력 -->
            <div style="background:#FAFAFA;border:1px dashed var(--gray-300);border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <div style="font-weight:700;font-size:13px;min-width:120px;color:var(--gray-600)">📝 직접 입력</div>
              <input id="pick-name-__custom" type="text" placeholder="품목명" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff;width:130px">
              <input id="pick-spec-__custom" type="text" placeholder="규격/사양" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff;width:160px">
              <select id="pick-cond-__custom" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff">
                <option value="new">신품</option>
                <option value="used">중고</option>
              </select>
              <label style="font-size:10px;color:var(--gray-500);display:flex;align-items:center;gap:3px">수량
                <input id="pick-qty-__custom" type="number" min="0" value="1" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff;width:55px;text-align:right">
              </label>
              <label style="font-size:10px;color:var(--gray-500);display:flex;align-items:center;gap:3px">판매가
                <input id="pick-sale-__custom" type="number" min="0" value="0" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff;width:90px;text-align:right">
              </label>
              <button onclick="addEquipFromCatalog('${j.id}','__custom')" style="margin-left:auto;background:var(--gray-700);color:#fff;border:none;border-radius:5px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer">＋ 추가</button>
            </div>
          </div>
        </div>
      ` : ''}
      `}

      <!-- 📝 비고 / 특이사항 — 신규 카테고리에서는 숨김 (thread + memos 로 충분)
           AS / VAN / 소모품 등은 기존대로 유지 -->
      ${(() => {
        const _catNotes = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
        if (_catNotes === 'new') return '';
        return `<div style="margin-top:18px;padding:14px;background:#FAFAFA;border:1px solid var(--gray-200);border-radius:10px">
          <div style="font-size:12px;color:var(--gray-700);margin-bottom:6px;font-weight:700">📝 비고 / 특이사항 <span style="font-size:10px;color:var(--gray-400);font-weight:400">— 내용 수정 후 입력란 밖을 클릭하면 자동 저장</span></div>
          <textarea placeholder="VAN사 변경, 고객 요청, 현장 특이사항 등..." onchange="updateJobNotes('${j.id}',this.value)" style="width:100%;min-height:60px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;background:#fff;font-family:inherit;resize:vertical">${esc((j.notes && String(j.notes).trim() !== String(j.asRequest||'').trim()) ? j.notes : '')}</textarea>
        </div>`;
      })()}
    `;

    // 🔁 스레드 — 신규/AS 공용 / VAN서류 — 신규 전용
    try {
      const cat2 = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
      if (cat2 === 'new' || cat2 === 'as') {
        if (typeof window._renderThreadGroups === 'function') {
          // 기존 업무내역/접수정보를 첫 ROOT 로 자동 시드 — 스레드가 비었을 때만
          // 소스 우선순위: LINE 메시지 → AS 접수내용 → 비고
          let initialThread = j.thread || [];
          // 🛡 자동 시드 가드 — 사용자가 thread 를 명시적으로 비웠다면 (tombstone 또는 _threadCleared 플래그)
          //   다시 시드하지 않음. 그리고 시드해도 즉시 saveJobs 호출 금지 → 사용자가 명시적으로 입력해야 저장됨.
          //   (이전: 클릭만 해도 lineParsed/asRequest/notes 에서 새 ROOT 가 만들어져 ns_jobs 에 저장 → 부활)
          if (!initialThread || initialThread.length === 0) {
            const wasCleared = !!j._threadCleared;
            // 과거 이 job 의 ROOT 가 한 번이라도 tombstone 됐으면 시드 skip — 부활 차단
            let hadTombstonedRoot = false;
            try {
              const list = (typeof _getTombstones === 'function') ? _getTombstones() : [];
              hadTombstonedRoot = list.some(t => t && (t.type === 'thread' || t.type === 'thread-children') && t.jobId === j.id);
            } catch(_){}
            if (!wasCleared && !hadTombstonedRoot) {
              const parts = [];
              if (j.lineParsed && j.lineParsed.trim()) parts.push('📩 ' + j.lineParsed.trim());
              else if (j.lineRaw && j.lineRaw.trim()) parts.push('📩 ' + j.lineRaw.trim());
              const asText = (j.asRequest || '').trim();
              if (asText && !parts.some(p => p.includes(asText))) parts.push(asText);
              const notesText = (j.notes || '').trim();
              if (notesText && !parts.some(p => p.includes(notesText))) parts.push(notesText);
              if (parts.length > 0) {
                const seedTs = (j.lineMsgAt || '').slice(0,16).replace('T',' ')
                            || (j.asReceivedAt || '').slice(0,16).replace('T',' ')
                            || (j.createdAt ? new Date(j.createdAt).toISOString().slice(0,16).replace('T',' ') : '');
                const seedAuthor = j.lineSender || j.engineer || j.assignee || '담당자';
                const seedRoot = { ts: seedTs, author: seedAuthor, status: '요청접수',
                                   text: parts.join('\n\n'),
                                   threadId: 'TR-seed-' + (j.id||Date.now()), parentId: null };
                initialThread = [seedRoot];
                // ⚠️ 자동 저장 제거 — display-only. 사용자가 명시적으로 thread 편집/저장할 때만 영속.
              }
            }
          }
          // AS 는 최대 5건 (미완료 우선) 노출 + 전체보기 토글 / 신규는 전체 노출
          const _maxRoots = (cat2 === 'as') ? 5 : 0;
          window._renderThreadGroups('jobThreadContainerEdit-' + j.id, initialThread, { editable:true, jobId:j.id, draftMode:false, maxRoots: _maxRoots });
        }
      }
      if (cat2 === 'new') {
        // 신규 편집 모달의 VAN 섹션 — store.vanProfile/payProfile read-only 표시
        // job.vandocs 스냅샷이 비어있어도 매장에 등록된 현재 값을 가져와 표시
        try {
          let bizForRender = '';
          if (j.storeId) {
            const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
            const s = stores.find(x => x.id === j.storeId);
            bizForRender = s ? (s.biz || s.bizno || s.businessNumber || '') : '';
          }
          if (typeof window._renderStoreVanInfoReadonly === 'function') {
            window._renderStoreVanInfoReadonly('jobVandocsContainerEdit-' + j.id, j.storeName || j.store || '', bizForRender);
          } else if (typeof window._renderJobVandocs === 'function') {
            window._renderJobVandocs('jobVandocsContainerEdit-' + j.id, j.vandocs || {}, { editable:true, jobId:j.id, draftMode:false });
          }
        } catch(e) { console.warn('[editNewopen] vandocs readonly render', e); }
      }
      // 📷📎 job 레벨 첨부 uploader — 모든 카테고리 공통
      try {
        const upBox = document.getElementById('jobAttUploader-' + j.id);
        if (upBox && window.NS_UPLOAD) {
          window._jobUploaderCtls = window._jobUploaderCtls || {};
          window._jobUploaderCtls[j.id] = window.NS_UPLOAD.mount(upBox, {
            initial: Array.isArray(j.attachments) ? j.attachments : [],
            category: cat2 || 'job',
            jobId: j.id,
            max: 50,
            onChange: (arr) => {
              try {
                const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
                const idx = jobs.findIndex(x => x.id === j.id);
                if (idx < 0) return;
                jobs[idx].attachments = arr.slice();
                if (typeof saveJobs === 'function') saveJobs(jobs);
                // KV 일일 쓰기 한도 보호 — debounce 사용 (즉시 push 하지 않음)
                try { if (typeof schedulePushJobsToCloud === 'function') schedulePushJobsToCloud(); } catch(_){}
              } catch(err) { console.warn('attachments save failed', err); }
            },
          });
        }
      } catch(e) { console.warn('job uploader mount failed', e); }
    } catch(e){ console.warn('[editNewopen] thread/vandocs render 실패', e); }

    modal.classList.add('show');
  }
  window.editNewopen = editNewopen;

  /* ── 작업 장비 편집 — 인라인 카탈로그 패널 (팝업 X) ── */
  let equipPanelOpenForJobId = null;
  function toggleEquipPicker(jobId) {
    equipPanelOpenForJobId = (equipPanelOpenForJobId === jobId) ? null : jobId;
    try { editNewopen(jobId); } catch(e){}
    // 패널 열렸으면 부드럽게 스크롤
    setTimeout(() => {
      const el = document.getElementById('equipPickerInline');
      if (el && equipPanelOpenForJobId) el.scrollIntoView({ behavior:'smooth', block:'start' });
    }, 80);
  }
  window.toggleEquipPicker = toggleEquipPicker;

  // 카탈로그 행에서 [추가] 버튼 클릭 시 — DOM 입력값을 직접 읽어 push
  function addEquipFromCatalog(jobId, fixedKey) {
    const get = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : '';
    };
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    if (!Array.isArray(job.equipment)) job.equipment = [];

    let newItem;
    if (fixedKey === '__custom') {
      const name = (get(`pick-name-__custom`) || '').trim();
      if (!name) { if (typeof showToast === 'function') showToast('품목명을 입력하세요'); return; }
      const qty = Math.max(0, Math.round(Number(get(`pick-qty-__custom`)) || 0));
      if (qty <= 0) { if (typeof showToast === 'function') showToast('수량을 1 이상 입력하세요'); return; }
      newItem = {
        name,
        spec: (get(`pick-spec-__custom`)||'').trim(),
        condition: get(`pick-cond-__custom`) || 'new',
        qty,
        costPrice: 0,
        salePrice: Math.max(0, Math.round(Number(get(`pick-sale-__custom`))||0)),
      };
    } else {
      const cat = getEquipmentCatalog();
      const def = cat.find(d => d.id === fixedKey);
      if (!def) return;
      const qty = Math.max(0, Math.round(Number(get(`pick-qty-${fixedKey}`)) || 0));
      if (qty <= 0) { if (typeof showToast === 'function') showToast('수량을 1 이상 입력하세요'); return; }
      // 다단계 옵션 — 모든 그룹 선택값 수집
      const optDefs = normalizeCatalogOptions(def);
      const selectedOpts = {};
      optDefs.forEach((g, gi) => {
        const v = get(`pick-opt-${fixedKey}-${gi}`);
        if (v) selectedOpts[g.label] = v;
      });
      const variantTxt = Object.values(selectedOpts).join(' / ');
      newItem = {
        name: def.name,
        options:   selectedOpts,             // 다중 옵션 (구조)
        variant:   variantTxt,                // 표시/검색용 호환 — 슬래시 join
        condition: get(`pick-cond-${fixedKey}`) || 'new',
        qty,
        costPrice: Math.max(0, Math.round(Number(get(`pick-cost-${fixedKey}`))||0)),
        salePrice: Math.max(0, Math.round(Number(get(`pick-sale-${fixedKey}`))||0)),
      };
    }
    job.equipment.push(newItem);
    saveJobs(jobs);
    try { editNewopen(jobId); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
    if (typeof showToast === 'function') showToast(`✅ ${newItem.name} 추가됨`);
  }
  window.addEquipFromCatalog = addEquipFromCatalog;
  // 변형 변경 — 카탈로그 기반에서는 변형별 단가가 없어 가격 갱신 안 함 (합계만 갱신)
  function onPickerVariantChange(fixedKey) { onPickerSubChange(fixedKey); }
  window.onPickerVariantChange = onPickerVariantChange;
  // 수량/판매가 변경 시 합계 표시 라이브 갱신 (re-render 없이)
  function onPickerSubChange(fixedKey) {
    const q = Number((document.getElementById(`pick-qty-${fixedKey}`)||{}).value)||0;
    const p = Number((document.getElementById(`pick-sale-${fixedKey}`)||{}).value)||0;
    const t = document.getElementById(`pick-total-${fixedKey}`);
    if (t) t.textContent = (q*p).toLocaleString('ko-KR') + '원';
  }
  window.onPickerSubChange = onPickerSubChange;

  function updateJobEquipField(jobId, idx, field, value) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job || !Array.isArray(job.equipment)) return;
    const item = job.equipment[idx];
    if (!item) return;
    const num = Number(String(value).replace(/[^0-9.\-]/g,'')) || 0;
    if (field === 'qty') {
      item.qty = Math.max(0, Math.round(num));
    } else if (field === 'salePrice') {
      item.salePrice = Math.max(0, Math.round(num));
    } else if (field === 'subtotal') {
      // 합계 → 판매가 = 합계/수량 (수량이 0이면 무시)
      const q = Number(item.qty) || 0;
      if (q > 0) item.salePrice = Math.max(0, Math.round(num / q));
    }
    saveJobs(jobs);
    try { editNewopen(jobId); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
  }
  window.updateJobEquipField = updateJobEquipField;

  function removeJobEquip(jobId, idx) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job || !Array.isArray(job.equipment)) return;
    job.equipment.splice(idx, 1);
    // equipmentChecked / equipmentCheckedBy 인덱스 재정렬
    const shiftMap = (m) => {
      if (!m) return m;
      const out = {};
      Object.keys(m).forEach(k => {
        const ki = parseInt(k, 10);
        if (isNaN(ki)) return;
        if (ki < idx) out[ki] = m[k];
        else if (ki > idx) out[ki - 1] = m[k];
      });
      return out;
    };
    job.equipmentChecked   = shiftMap(job.equipmentChecked);
    job.equipmentCheckedBy = shiftMap(job.equipmentCheckedBy);
    saveJobs(jobs);
    try { editNewopen(jobId); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
    if (typeof showToast === 'function') showToast('🗑️ 장비 삭제됨');
  }
  window.removeJobEquip = removeJobEquip;

  /* 작업 날짜 필드 업데이트 (상세 모달에서 사용) */
  /* 작업 유형 변경 — type + lineCategory 자동 동기화 (필터/뱃지 일관성) */
  function updateJobType(jobId, value) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const oldType = job.type;
    job.type = value;
    // type → lineCategory 매핑 (작업/일정·신규/AS 화면 필터 일관성)
    if (/AS|에이에스|이동단말기/i.test(value)) {
      if (/이동단말기|단말기/i.test(value)) job.lineCategory = 'device_mgmt';
      else if (/VAN|밴|체크기|결제기|IC/i.test(value)) job.lineCategory = 'van_as';
      else job.lineCategory = 'pos_as';   // 기본은 POS A/S (이전 as_pos_van → pos_as)
    } else if (/신규가맹|밴서류|정보변경|재신고|상호변경|주소변경/i.test(value)) {
      job.lineCategory = 'van_doc';
    } else if (/신규|개업|오픈|POS교체|VAN교체|SW교체/i.test(value)) {
      job.lineCategory = 'open_store';
    }
    // 작업 카드에 변경 로그 메모 자동 추가
    if (!Array.isArray(job.memos)) job.memos = [];
    const now = new Date();
    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Seoul', year:'2-digit', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(now).replace('T',' ');
    const auth = (typeof getAuthState === 'function') ? getAuthState() : null;
    job.memos.push({
      at: stamp,
      author: auth?.name || auth?.email || '직원',
      text: `🔄 작업 유형 변경: ${oldType || '-'} → ${value}`,
    });
    saveJobs(jobs);
    try { pushJobsToCloud({ toast:false }); } catch(e){}
    if (typeof showToast === 'function') showToast(`✅ 작업 유형: ${oldType||'-'} → ${value}`);
    // 모든 관련 화면 갱신
    try { hydrateNewopen('all'); } catch(e){}
    try { hydrateAsMgmt(); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
    try { rebuildJobsGrid(); } catch(e){}
    try { renderCalendar(); } catch(e){}
    // 모달 다시 그려서 조건부 UI (AS 패널 등) 반영
    try { editNewopen(jobId); } catch(e){}
  }
  window.updateJobType = updateJobType;

  /* 직원(ns_users) → <option> 목록 — 요청 담당 select 용 (PC 는 m-core 미로드라 자체 구현) */
  function _jobStaffOptions(selected) {
    const sel = String(selected || '');
    const users = (typeof getUsers === 'function') ? (getUsers() || []) : [];
    const names = []; const seen = new Set();
    users.forEach(u => { const nm = ((u && (u.name || u.email)) || '').trim(); if (!nm || seen.has(nm)) return; seen.add(nm); names.push(nm); });
    if (sel && !seen.has(sel)) names.unshift(sel);  // 목록에 없는 현재 담당 보존
    let html = `<option value="">미배정</option>`;
    names.forEach(nm => { html += `<option value="${esc(nm)}" ${nm === sel ? 'selected' : ''}>${esc(nm)}</option>`; });
    return html;
  }
  window._jobStaffOptions = _jobStaffOptions;

  /* 요청(요청접수 ROOT)별 처리 담당 배정 — thread entry.assignee. 저장 job + draft 모두 처리 */
  window._threadSetAssignee = function(containerId, jobId, draftMode, threadId, name) {
    const val = String(name || '').trim();
    // 등록 폼 draft (저장 전) — 임시 thread 배열 갱신
    if (draftMode || !jobId) {
      try {
        const arr = _getThreadFor(jobId, draftMode, containerId) || [];
        const e = arr.find(x => x && x.threadId === threadId);
        if (e) e.assignee = val;
        _setThreadFor(jobId, draftMode, arr, containerId);
      } catch(err) { console.warn('[_threadSetAssignee draft]', err); }
      return;
    }
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job || !Array.isArray(job.thread)) return;
    const e = job.thread.find(x => x && x.threadId === threadId);
    if (!e || (e.assignee || '') === val) return;
    e.assignee = val;
    job.updatedAt = Date.now();
    saveJobs(jobs);
    try { pushJobsToCloud({ toast:false }); } catch(err){}
    if (typeof showToast === 'function') showToast(val ? `👷 처리 담당: ${val}` : '담당 해제됨');
    try { hydrateAsMgmt(); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
  };

  /* 요청(요청접수 ROOT)별 처리예정일 — thread entry.dueDate. 저장 job + draft 모두 처리 */
  window._threadSetReqDue = function(containerId, jobId, draftMode, threadId, value) {
    const v = String(value || '').slice(0, 10);
    if (draftMode || !jobId) {
      try {
        const arr = _getThreadFor(jobId, draftMode, containerId) || [];
        const e = arr.find(x => x && x.threadId === threadId);
        if (e) e.dueDate = v;
        _setThreadFor(jobId, draftMode, arr, containerId);
      } catch(err) { console.warn('[_threadSetReqDue draft]', err); }
      return;
    }
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job || !Array.isArray(job.thread)) return;
    const e = job.thread.find(x => x && x.threadId === threadId);
    if (!e || (e.dueDate || '') === v) return;
    e.dueDate = v;
    job.updatedAt = Date.now();
    saveJobs(jobs);
    try { pushJobsToCloud({ toast:false }); } catch(err){}
    if (typeof showToast === 'function') showToast(v ? `📅 처리예정 ${v}` : '처리예정 해제');
    try { hydrateAsMgmt(); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
  };

  function updateJobDate(jobId, field, value) {
    if (!['installDate','softOpenDate','openDate'].includes(field)) return;
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    job[field] = value || '';
    saveJobs(jobs);
    if (typeof showToast === 'function') {
      const labels = { installDate:'설치 예정일', softOpenDate:'가오픈일', openDate:'오픈일' };
      showToast(`✅ ${labels[field]} ${value ? value : '비움'} 저장됨`);
    }
    try { hydrateNewopen('all'); } catch(e) {}
    try { hydrateDashboardJobs(); } catch(e) {}
    try { renderCalendar(); } catch(e) {}
  }
  window.updateJobDate = updateJobDate;

  /* 작업 주소 업데이트 (상세 모달에서 직접 수정) */
  function updateJobAddress(jobId, value) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    job.address = (value || '').trim();
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('✅ 주소 저장됨');
    try { hydrateNewopen('all'); } catch(e){}
  }
  window.updateJobAddress = updateJobAddress;

  /* 작업의 점포명 수정 — 미등록·등록 작업 모두 가능. 등록 매장에 연결된 상태면 storeId 는 유지 */
  function updateJobStoreName(jobId, value) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const newName = String(value || '').trim();
    if (!newName) { showToast && showToast('점포명을 입력하세요'); return; }
    const prev = job.storeName || job.store || '';
    if (prev === newName) return;
    if (!job.originalStoreName) job.originalStoreName = prev;
    job.storeName = newName;
    job.store = newName;
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('✅ 점포명 저장됨');
    try { hydrateNewopen('all'); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
    try { rebuildJobsGrid(); } catch(e){}
    try { pushJobsToCloud({ toast: false }); } catch(e){}
  }
  window.updateJobStoreName = updateJobStoreName;

  /* 작업/일정 카드 그리드 재빌드 — 상태 변경 후 카드 UI 갱신 */
  function rebuildJobsGrid() {
    ['jobsGrid', 'jobsAsGrid'].forEach(gridId => {
      const grid = document.getElementById(gridId);
      if (!grid) return;
      Array.from(grid.querySelectorAll('.job-card')).forEach(c => {
        if (c.id !== 'newJobCardBtn' && c.id !== 'newAsCardBtn') c.remove();
      });
    });
    try { hydrateSavedJobs(); } catch(e){}
  }
  window.rebuildJobsGrid = rebuildJobsGrid;

  /* 신규 작업 종료(완료) 처리 — 진행 목록에서 사라지고 지난 완료 목록에 표시 */
  function completeNewopen(jobId) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    if (!confirm(`"${job.store || job.storeName || '이 작업'}" 을(를) 종료 처리하시겠습니까?\n진행 목록에서 사라지고 [지난 완료]에서 확인할 수 있습니다.`)) return;
    job.status = '완료';
    job.completedAt = new Date().toISOString();
    saveJobs(jobs);
    // Plan B — 완료된 작업의 설치 완료 장비를 매장 DB(store.equipment) 로 자동 적재
    let ingested = 0;
    try { ingested = (typeof ingestJobEquipmentToStore === 'function') ? ingestJobEquipmentToStore(job) : 0; } catch(e){}
    if (typeof showToast === 'function') {
      showToast(ingested > 0
        ? `✅ 종료 처리 완료 — 매장 장비 DB 에 ${ingested}건 자동 등록`
        : '✅ 종료 처리 완료 — [지난 완료] 에서 확인');
    }
    try { hydrateNewopen('all'); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
    try { rebuildJobsGrid(); } catch(e){}
    try { hydrateAsMgmt(); } catch(e){}
  }
  window.completeNewopen = completeNewopen;

  /* AS 전용 직접 완료 처리 — 모바일/PC 공통 완료 버튼 */
  function completeAsJobDirect(jobId) {
    const jobs = getJobs();
    const j = jobs.find(x => x.id === jobId);
    if (!j) return;
    const storeName = j.storeName || j.store || '이 작업';
    const note = prompt(`"${storeName}" AS 완료 처리\n\n처리 내용 (생략 가능):`, '');
    if (note === null) return; // 취소
    if (!Array.isArray(j.thread)) j.thread = [];
    const now = new Date();
    const ts = now.toISOString().slice(0,16).replace('T',' ');
    let userName = '담당자';
    try { userName = (typeof getCurrentUser==='function' && getCurrentUser()?.name) || '담당자'; } catch(_){}
    // 미완료 ROOT 가 있으면 그 아래 완료 child 추가, 없으면 완료 ROOT 생성
    const roots = j.thread.filter(t => !t.parentId);
    const incompleteRoot = roots.find(r => {
      const kids = j.thread.filter(t => t.parentId === r.threadId);
      return !kids.some(c => c.status === '완료');
    });
    const newId = 'TR-done-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    if (incompleteRoot) {
      j.thread.push({ threadId: newId, parentId: incompleteRoot.threadId,
        ts, author: userName, status: '완료', text: note || '처리 완료' });
    } else {
      j.thread.push({ threadId: newId, parentId: null,
        ts, author: userName, status: '완료', text: note || '처리 완료' });
    }
    j.status = '처리완료';
    j.completed = true;
    j.completedAt = now.toISOString();
    j.updatedAt = now.toISOString();
    saveJobs(jobs);
    try { if (typeof schedulePushJobsToCloud==='function') schedulePushJobsToCloud(); else if (typeof pushJobsToCloud==='function') pushJobsToCloud({toast:false}); } catch(e){}
    if (typeof showToast==='function') showToast(`✅ AS 완료 처리 — ${storeName}`);
    document.getElementById('newopenDetailModal')?.classList.remove('show');
    try { hydrateAsMgmt(); } catch(e){}
    try { if (typeof renderAsHub==='function') renderAsHub(); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
  }
  window.completeAsJobDirect = completeAsJobDirect;

  /* 종료 되돌리기 — 다시 진행 목록으로 */
  function reopenNewopen(jobId) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    job.status = '진행중';
    delete job.completedAt;
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('↩ 진행 목록으로 복귀');
    try { hydrateNewopen('done'); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
    try { rebuildJobsGrid(); } catch(e){}
    try { hydrateAsMgmt(); } catch(e){}
  }
  window.reopenNewopen = reopenNewopen;

  /* 비고(notes) 수정 */
  function updateJobNotes(jobId, value) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    job.notes = String(value || '');
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('✅ 비고 저장됨');
    try { hydrateNewopen('all'); } catch(e){}
  }
  window.updateJobNotes = updateJobNotes;

  /* 한국시간 포맷 — 'MM.DD HH:mm' */
  function _kstStamp() {
    const d = new Date();
    // toLocaleString 으로 KST 변환
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).reduce((a,p)=>{ a[p.type]=p.value; return a; }, {});
    return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
  }
  /* 초단위 KST 스탬프 — 매장 changeLog 전용(같은 필드 1분내 재편집 시 additive 머지 중복키 충돌 방지) */
  function _kstStampSec() {
    try {
      const p = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year:'2-digit', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
      }).formatToParts(new Date()).reduce((a,x)=>{ a[x.type]=x.value; return a; }, {});
      return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}:${p.second}`;
    } catch (_) {
      return new Date(Date.now()+9*3600*1000).toISOString().slice(0,19).replace('T',' ');
    }
  }

  /* 메모 추가 — 일자/시간 자동 기록 */
  function addJobMemo(jobId) {
    const inp = document.getElementById('jobMemoInput-' + jobId);
    if (!inp) return;
    const trimmed = String(inp.value || '').trim();
    if (!trimmed) {
      if (typeof showToast === 'function') showToast('메모 내용을 입력하세요');
      try { inp.focus(); } catch(e){}
      return;
    }
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    if (!Array.isArray(job.memos)) job.memos = [];
    let author = '';
    try {
      const auth = JSON.parse(localStorage.getItem('ns_auth') || 'null');
      author = (auth && (auth.name || auth.email)) || '';
    } catch(e){}
    job.memos.push({ at: _kstStamp(), author, text: trimmed });
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('✅ 메모 추가됨');
    try { editNewopen(jobId); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
  }
  window.addJobMemo = addJobMemo;

  /* 기존 메모 텍스트 수정 */
  function updateJobMemoAt(jobId, idx, value) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job || !Array.isArray(job.memos) || !job.memos[idx]) return;
    job.memos[idx].text = String(value || '');
    job.memos[idx].editedAt = _kstStamp();
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('✅ 메모 저장됨');
  }
  window.updateJobMemoAt = updateJobMemoAt;

  /* 메모 삭제 */
  function removeJobMemo(jobId, idx) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job || !Array.isArray(job.memos)) return;
    job.memos.splice(idx, 1);
    saveJobs(jobs);
    if (typeof showToast === 'function') showToast('🗑 메모 삭제됨');
    try { editNewopen(jobId); } catch(e){}
  }
  window.removeJobMemo = removeJobMemo;

  /* 매장 담당자 필드 업데이트 (상세 모달) — 단일 필드 (구버전 호환) */
  function updateJobContact(jobId, field, value) {
    if (!['contactName','contactRole','contactPhone'].includes(field)) return;
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    job[field] = (value || '').trim();
    saveJobs(jobs);
    if (typeof showToast === 'function') {
      const labels = { contactName:'담당자 이름', contactRole:'직책', contactPhone:'연락처' };
      showToast(`✅ ${labels[field]} 저장됨`);
    }
  }
  window.updateJobContact = updateJobContact;

  /* ── 매장 담당자 다중 관리 ── */
  // 작업의 담당자 배열을 안전하게 반환 (구버전 단일 필드는 자동 마이그레이션)
  function getJobContacts(j) {
    if (!j) return [];
    if (Array.isArray(j.contacts) && j.contacts.length > 0) return j.contacts;
    // 구버전 호환: contactName/Role/Phone 이 있으면 1개짜리 배열로 변환 (저장은 안 함, 읽기만)
    if (j.contactName || j.contactPhone || j.contactRole) {
      return [{ name: j.contactName||'', role: j.contactRole||'', phone: j.contactPhone||'', primary: true }];
    }
    return [];
  }
  // 대표 담당자 — primary === true 인 첫 번째, 없으면 배열 첫 번째
  function getPrimaryContact(j) {
    const list = getJobContacts(j);
    return list.find(c => c.primary) || list[0] || null;
  }
  // 작업의 담당자 배열을 정상화하여 저장 (한 명도 없으면 빈 배열)
  function _writeJobContacts(job, list) {
    job.contacts = list.map(c => ({
      name:  String(c.name||'').trim(),
      role:  String(c.role||'').trim(),
      phone: String(c.phone||'').trim(),
      primary: !!c.primary,
    }));
    // primary 정확히 1개 보장 (있으면 첫 primary 만 유지, 없으면 첫 번째를 primary 로)
    let firstPri = -1;
    job.contacts.forEach((c, i) => {
      if (c.primary && firstPri === -1) firstPri = i;
      else c.primary = false;
    });
    if (firstPri === -1 && job.contacts.length > 0) job.contacts[0].primary = true;
    // 구버전 단일 필드는 대표값으로 동기화 (외부 화면 호환)
    const p = job.contacts.find(c => c.primary) || job.contacts[0] || null;
    job.contactName  = p ? p.name  : '';
    job.contactRole  = p ? p.role  : '';
    job.contactPhone = p ? p.phone : '';
  }
  function addJobContact(jobId) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const list = getJobContacts(job).slice();
    list.push({ name:'', role:'', phone:'', primary: list.length === 0 });
    _writeJobContacts(job, list);
    saveJobs(jobs);
    try { editNewopen(jobId); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
  }
  window.addJobContact = addJobContact;
  function removeJobContact(jobId, idx) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const list = getJobContacts(job).slice();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    _writeJobContacts(job, list);
    saveJobs(jobs);
    try { editNewopen(jobId); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
  }
  window.removeJobContact = removeJobContact;
  function setPrimaryContact(jobId, idx) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const list = getJobContacts(job).slice();
    list.forEach((c, i) => c.primary = (i === idx));
    _writeJobContacts(job, list);
    saveJobs(jobs);
    try { editNewopen(jobId); } catch(e){}
    try { hydrateNewopen('all'); } catch(e){}
    if (typeof showToast === 'function') showToast('⭐ 대표 연락망 변경됨');
  }
  window.setPrimaryContact = setPrimaryContact;
  function updateJobContactAt(jobId, idx, field, value) {
    if (!['name','role','phone'].includes(field)) return;
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const list = getJobContacts(job).slice();
    if (idx < 0 || idx >= list.length) return;
    list[idx] = { ...list[idx], [field]: (value||'').trim() };
    _writeJobContacts(job, list);
    saveJobs(jobs);
    try { hydrateNewopen('all'); } catch(e){}
  }
  window.updateJobContactAt = updateJobContactAt;

  /* 📞 cross-store — 같은 전화번호가 담당자로 등록된 다른 매장 목록 모달 */
  window._showContactStores = function(phone, name) {
    const escF = (typeof esc === 'function') ? esc : (s)=>String(s||'');
    const pk = String(phone||'').replace(/\D/g,'');
    if (!pk) { if (typeof showToast === 'function') showToast('전화번호가 없습니다'); return; }
    let stores = []; try { stores = (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){}
    const hits = [];
    stores.forEach(s => {
      const cs = Array.isArray(s.contacts) ? s.contacts : [];
      const tomb = new Set(Array.isArray(s.contactsDeleted) ? s.contactsDeleted : []);
      const c = cs.find(x => {
        const xk = String(x.phone||'').replace(/\D/g,'');
        if (xk !== pk) return false;
        const key = xk || ('n:' + String(x.name||'').trim() + '|' + String(x.role||'').trim());
        return !tomb.has(key);
      });
      if (c) hits.push({ store: s.name||s.storeName||'(이름없음)', role: c.role||'', cname: c.name||'', addr: s.address||s.addr||'' });
    });
    hits.sort((a,b) => String(a.store).localeCompare(String(b.store), 'ko'));
    let modal = document.getElementById('contactStoresModal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'contactStoresModal'; modal.className = 'modal-overlay';
      modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
      document.body.appendChild(modal);
    }
    const rows = hits.length ? hits.map(h => `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 11px;border:1px solid var(--gray-200);border-radius:8px;background:#fff">
        <b style="font-size:13px">${escF(h.store)}</b>
        ${h.role ? `<span style="color:var(--gray-500);font-size:11.5px">${escF(h.role)}</span>` : ''}
        ${h.cname ? `<span style="color:var(--gray-400);font-size:11px">${escF(h.cname)}</span>` : ''}
        <span style="flex:1"></span>
        <span style="color:var(--gray-400);font-size:10.5px">${escF(String(h.addr||'').slice(0,28))}</span>
      </div>`).join('') : `<div style="padding:18px;text-align:center;color:var(--gray-400);font-size:12px">이 번호가 담당자로 등록된 매장이 없습니다</div>`;
    modal.innerHTML = `<div class="modal" style="max-width:480px;width:94%">
        <div class="modal-header">
          <div class="modal-title">📞 ${escF(name ? name + ' · ' : '')}${escF(phone || pk)}</div>
          <button class="modal-close" onclick="document.getElementById('contactStoresModal').classList.remove('show')">✕</button>
        </div>
        <div class="modal-body">
          <div style="font-size:11.5px;color:var(--gray-500);margin-bottom:8px">이 전화번호가 담당자로 등록된 매장 <b style="color:var(--gray-800)">${hits.length}곳</b></div>
          <div style="display:flex;flex-direction:column;gap:6px">${rows}</div>
        </div>
      </div>`;
    modal.classList.add('show');
  };

  /* 잘못 연결된 작업 → 연결 해제 (미등록 상태로 되돌림) */
  function unlinkStore(jobId) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const job = jobs.find(j => j.id === jobId);
    if (!job) { showToast && showToast('작업을 찾을 수 없습니다'); return; }
    const linkedName = job.storeName || job.store || '-';
    if (!confirm(`현재 "${linkedName}" 매장과의 연결을 해제하고 미등록 상태로 되돌립니다.\n\n원래 입력했던 이름이 있으면 복원합니다. 계속하시겠습니까?`)) return;
    // 원래 이름 복원 (있으면)
    if (job.originalStoreName) {
      job.storeName = job.originalStoreName;
      job.store = job.originalStoreName;
    }
    job.storeId = '';
    job.unregistered = true;
    job.unlinkedAt = Date.now();
    saveJobs(jobs);
    showToast && showToast('🔓 연결 해제됨 — 미등록 상태로 되돌림');
    try { hydrateNewopen('all'); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
  }
  window.unlinkStore = unlinkStore;

  /* 미등록 작업 → 등록된 가맹점에 연결 (모달 UI) */
  let _linkContextJobId = null;

  function linkRegisteredStore(jobId) {
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const job = jobs.find(j => j.id === jobId);
    if (!job) { showToast && showToast('작업을 찾을 수 없습니다'); return; }
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    if (stores.length === 0) {
      alert('먼저 점포를 등록(엑셀 업로드)해야 연결할 수 있습니다.');
      return;
    }
    _linkContextJobId = jobId;
    let modal = document.getElementById('linkStoreModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'linkStoreModal';
      modal.className = 'modal-overlay';
      /* backdrop close disabled — use ✕ or ESC */
      modal.innerHTML = `
        <div class="modal" style="max-width:640px;width:96%">
          <div class="modal-header">
            <div class="modal-title">🔗 가맹점 연결</div>
            <button class="modal-close" onclick="document.getElementById('linkStoreModal').classList.remove('show')">✕</button>
          </div>
          <div class="modal-body">
            <div id="linkStoreCurrentInfo" style="margin-bottom:14px;padding:10px 14px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;font-size:12px;color:#92400E"></div>
            <!-- 검색 한 줄: 범위 셀렉트(120px) + 입력란(flex) + 조회 버튼 — 화면 좁으면 자동 줄바꿈 -->
            <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:stretch">
              <select id="linkStoreScope" onchange="runLinkStoreSearch()" style="width:120px;flex:0 0 120px;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;background:#fff;font-weight:600;color:var(--gray-700)">
                <option value="name_biz">상호·사업자</option>
                <option value="ceo">대표자</option>
                <option value="addr">주소</option>
              </select>
              <input type="text" id="linkStoreSearchInput" placeholder="검색어 입력 (2자 이상 자동 검색)" autocomplete="off"
                     oninput="onLinkStoreInput(this.value)"
                     onkeydown="if(event.key==='Enter'){event.preventDefault();runLinkStoreSearch();}"
                     style="flex:1 1 200px;min-width:0;padding:8px 12px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
              <button class="btn btn-primary btn-sm" onclick="runLinkStoreSearch()" style="flex:0 0 auto;padding:8px 16px;white-space:nowrap">🔍 조회</button>
            </div>
            <div style="font-size:11px;color:var(--gray-400);margin-bottom:6px" id="linkStoreCountLabel">검색어를 입력하고 조회 또는 2자 이상 입력 시 자동 검색</div>
            <div id="linkStoreResults" style="max-height:360px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:8px"></div>
          </div>
          <div class="modal-footer" style="justify-content:flex-end">
            <button class="btn btn-outline" onclick="document.getElementById('linkStoreModal').classList.remove('show')">취소</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    // 현재 작업 정보 표시 + 검색어 프리필
    document.getElementById('linkStoreCurrentInfo').innerHTML =
      `<b>현재 미등록 매장:</b> ${esc(job.storeName || '-')} ${job.address ? `· <span style="color:#78350F">${esc(j_addr(job))}</span>` : ''}`;
    const inp = document.getElementById('linkStoreSearchInput');
    if (inp) {
      inp.value = job.storeName || '';
      // 결과 초기화 (프리필된 키워드로 자동 1회 검색)
      runLinkStoreSearch();
      setTimeout(() => inp.focus(), 100);
    }
    modal.classList.add('show');
  }
  window.linkRegisteredStore = linkRegisteredStore;

  function j_addr(job) { return job.address || ''; }

  let _linkSearchTimer = null;
  function onLinkStoreInput(val) {
    if (_linkSearchTimer) clearTimeout(_linkSearchTimer);
    const q = (val || '').trim();
    if (q.length === 0) {
      document.getElementById('linkStoreResults').innerHTML = '';
      document.getElementById('linkStoreCountLabel').textContent = '검색어를 입력하세요.';
      return;
    }
    if (q.length < 2) {
      document.getElementById('linkStoreCountLabel').textContent = '2자 이상 입력하면 자동 검색됩니다.';
      return;
    }
    _linkSearchTimer = setTimeout(runLinkStoreSearch, 150);
  }
  window.onLinkStoreInput = onLinkStoreInput;

  function runLinkStoreSearch() {
    const qRaw = document.getElementById('linkStoreSearchInput')?.value || '';
    const qNorm = _normalizeSearch(qRaw);
    const scope = (document.getElementById('linkStoreScope')||{}).value || 'name_biz';
    const stores = getStores() || [];
    const panel = document.getElementById('linkStoreResults');
    const lbl = document.getElementById('linkStoreCountLabel');
    if (!panel) return;
    if (!qNorm) {
      panel.innerHTML = '';
      if (lbl) lbl.textContent = '검색어를 입력하세요.';
      return;
    }
    const matches = stores.filter(s => _matchStore(s, qNorm, scope));
    if (lbl) lbl.textContent = `검색 결과: ${matches.length.toLocaleString()}건${matches.length > 100 ? ' (상위 100건만 표시)' : ''}`;
    if (matches.length === 0) {
      panel.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:12px">일치하는 점포가 없습니다.<br><span style="font-size:11px">검색어를 줄여서 다시 시도해 보세요.</span></div>`;
      return;
    }
    panel.innerHTML = matches.slice(0, 100).map((s) => {
      const tagBiz = s.biz || s.bizno ? `<span style="font-family:monospace;font-size:11px;color:var(--gray-500);margin-left:6px">${esc(s.biz || s.bizno)}</span>` : '';
      const sidAttr = String(s.id || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const sigName = s.signageName ? esc(s.signageName) : '';
      return `<div data-sid="${sidAttr}" onclick="confirmLinkStore(this.getAttribute('data-sid'))" style="padding:10px 14px;border-bottom:1px solid var(--gray-100);cursor:pointer;transition:background 0.1s" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background=''">
        <div style="font-size:13px;font-weight:700;color:var(--gray-800)">${esc(s.name||'-')}${sigName ? ` <span style="font-size:11.5px;color:#1d4ed8;font-weight:600">🪧 ${sigName}</span>` : ''}${tagBiz}</div>
        <div style="font-size:11px;color:var(--gray-500);margin-top:2px">
          ${s.ceo||s.owner ? `대표 ${esc(s.ceo || s.owner)}` : ''}
          ${s.tel ? ` · ${esc(s.tel)}` : ''}
        </div>
        ${s.addr || s.address ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px">${esc(s.addr || s.address)}</div>` : ''}
      </div>`;
    }).join('');
  }
  window.runLinkStoreSearch = runLinkStoreSearch;

  function confirmLinkStore(storeId) {
    const jobId = _linkContextJobId;
    if (!jobId) return;
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const picked = (getStores() || []).find(s => s.id === storeId);
    if (!picked) { showToast && showToast('선택한 점포를 찾을 수 없습니다'); return; }
    if (!confirm(`"${job.storeName||'-'}" → "${picked.name}" 으로 연결합니다.\n\n주소도 비어있으면 자동으로 채워집니다. 계속하시겠습니까?`)) return;
    if (!job.originalStoreName) {
      job.originalStoreName = job.storeName || job.store || '';
    }
    job.storeId = picked.id;
    job.storeName = picked.name;
    job.store = picked.name;
    job.address = job.address || picked.addr || picked.address || '';
    job.unregistered = false;
    job.linkedAt = Date.now();
    saveJobs(jobs);
    document.getElementById('linkStoreModal').classList.remove('show');
    _linkContextJobId = null;
    showToast && showToast(`✅ ${picked.name} 으로 연결됨`);
    try { hydrateNewopen('all'); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
    try { if (typeof window.renderSuppliesHub === 'function') window.renderSuppliesHub(); } catch(e){}
    try { if (typeof window.renderAsHub === 'function') window.renderAsHub(); } catch(e){}
    // 소모품 상세 모달이 열려 있으면 즉시 갱신 (매장 연결 상태 반영)
    try {
      const dm = document.getElementById('newopenDetailModal');
      if (dm && dm.classList.contains('show') && (typeof window.classifyJobCategory === 'function') && window.classifyJobCategory(job) === 'supplies' && typeof window._editSupplyJob === 'function') {
        window._editSupplyJob(jobId);
      }
    } catch(e){}
  }
  window.confirmLinkStore = confirmLinkStore;
  window.hydrateNewopen = hydrateNewopen;
  window.filterNewopen = filterNewopen;
  window.openNewopenJob = openNewopenJob;
  window.editNewopen = editNewopen;
  try { hydrateNewopen('all'); } catch(e) {}
  // 초기 로드
  try { hydrateDashboardJobs(); } catch(e) {}
  // ns_jobs 변경 시 자동 갱신
  window.addEventListener('storage', (e) => {
    if (e.key === 'ns_jobs') { try { hydrateDashboardJobs(); } catch(_){} }
  });

  /* 점포 리스트 tbody 클릭 위임 (데모 행 포함 전체 커버) */
  (function bindStoreListClick() {
    const tb = document.getElementById('storeListTbody');
    if (!tb || tb.dataset.clickBound === '1') return;
    tb.dataset.clickBound = '1';
    tb.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr');
      if (!tr || tr.parentElement !== tb) return;
      if (tr.querySelector('td[colspan]')) return; // 안내 행
      if (typeof window.toggleStoreDetail === 'function') window.toggleStoreDetail(tr);
    });
  })();

  /* saveNewJob / saveNewStore 훅: 저장 후 DOM 주입 */
  (function patchSavers() {
    if (typeof saveNewJob === 'function') {
      const _origJob = saveNewJob;
      window.saveNewJob = function() {
        const prev = (typeof getJobs === 'function') ? getJobs() : [];
        _origJob.apply(this, arguments);
        try {
          const now = getJobs();
          if (now.length > prev.length) injectJobCard(now[0]);
        } catch {}
      };
    }
    if (typeof saveNewStore === 'function') {
      const _origStore = saveNewStore;
      window.saveNewStore = function() {
        const prev = (typeof getStores === 'function') ? getStores() : [];
        _origStore.apply(this, arguments);
        try {
          const now = getStores();
          if (now.length > prev.length) injectStoreRow(now[0]);
        } catch {}
      };
    }
  })();

  /* 점포 행 클릭: 하이라이트 토글 (상세보기 스텁) */
  window.toggleStoreDetail = function(tr) {
    if (tr) window._currentStoreDetailRow = tr;
    const tb = tr.parentElement;
    Array.from(tb.querySelectorAll('tr')).forEach(r => r.style.outline = '');
    tr.style.outline = '2px solid var(--primary)';
    tr.style.outlineOffset = '-2px';

    // 행 셀에서 정보 추출 (컬럼: 점포명 / 사업자 / 대표 / 전화 / 주소 / VAN / POS·KIO / 담당 / 상태)
    const cells = tr.querySelectorAll('td');
    const getText = (i) => (cells[i]?.innerText || cells[i]?.textContent || '').trim();
    const code   = tr.dataset.storeId || '';
    const name   = (tr.querySelector('b')?.textContent || getText(0) || '선택된 점포').trim();
    const bizno  = getText(1);
    const ceo    = getText(2);
    const tel    = getText(3);
    const addr   = getText(4);
    const van    = (cells[5]?.querySelector('.badge')?.textContent || '').trim();
    const posTxt = (cells[6]?.querySelector('.pk-chip')?.textContent || '').trim();
    const status = (cells[8]?.querySelector('.badge')?.textContent || '거래중').trim();

    // 저장된 점포 데이터가 있으면 보강 (dataset.storeId 기반)
    let store = null;
    try {
      const sid = tr.dataset.storeId;
      if (sid && typeof getStores === 'function') {
        store = (getStores() || []).find(s => s.id === sid) || null;
      }
    } catch(e) {}

    const displayName = (store?.name) || name;
    const displayAddr = (store?.addr) || addr || '-';
    const displayCeo  = (store?.ceo)  || ceo  || '-';
    const displayTel  = (store?.tel)  || tel  || '-';
    const displayCeoTel = (store?.ceoTel) || '-';
    const displayBiz  = (store?.biz)  || bizno || '';
    const displayVan  = (store?.van)  || van;
    const displayPos  = (store?.pos)  ? `POS ${store.pos}대` : (posTxt || '');
    const displayStat = (store?.status) || status;

    const nameEl = document.getElementById('detailStoreName');
    const metaEl = document.getElementById('detailStoreMeta');
    const tagsEl = document.getElementById('detailStoreTags');
    if (nameEl) nameEl.textContent = displayName;
    if (metaEl) {
      const parts = [];
      if (displayAddr && displayAddr !== '-') parts.push(displayAddr);
      if (displayCeo && displayCeo !== '-') parts.push('대표: ' + displayCeo);
      if (displayTel && displayTel !== '-') parts.push(displayTel);
      if (displayBiz) parts.push('사업자 ' + displayBiz);
      if (code) parts.push('코드 ' + code);
      metaEl.textContent = parts.join(' | ') || '-';
    }
    if (tagsEl) {
      const tags = [];
      if (displayStat) tags.push(`<span class="badge">🟢 ${displayStat}</span>`);
      if (displayPos) tags.push(`<span class="badge">${displayPos}</span>`);
      if (displayVan) tags.push(`<span class="badge">${displayVan} VAN</span>`);
      tagsEl.innerHTML = tags.join(' ') || '<span class="badge">정보 없음</span>';
    }

    // sdv2 헤더 meta 는 ID·주소·연락처 한 줄
    if (metaEl) {
      const metaParts = [];
      if (displayAddr && displayAddr !== '-') metaParts.push(displayAddr);
      if (displayBiz) metaParts.push(displayBiz);
      if (code) metaParts.push('코드 ' + code);
      metaEl.textContent = metaParts.join(' · ') || '-';
    }

    /* ── 매장정보 탭: 기본 정보 카드 채우기 ── */
    const basicInfoEl = document.getElementById('detailBasicInfo');
    if (basicInfoEl) {
      const escSafe = (typeof esc === 'function') ? esc : (s)=>String(s||'');
      const sid = store?.id || '';
      // 읽기 전용 row
      const row = (k, v) => `<div class="sdv2-info-row"><div class="k">${k}</div><div class="v"><span class="sdv2-val">${escSafe(v||'-')}</span></div></div>`;
      // 편집 가능 row — 매장 id 필요
      const erow = (k, field, v, opts) => {
        opts = opts || {};
        const valHtml = opts.tel && v && v !== '-'
          ? `<a href="tel:${escSafe(v)}" class="sdv2-tel" onclick="event.stopPropagation()">${escSafe(v)}</a>`
          : escSafe(v||'-');
        const btn = sid ? `<button class="sdv2-edit-btn" title="${escSafe(k)} 수정" onclick="_sdv2EditField('${escSafe(sid)}','${field}','${escSafe(k)}',${opts.tel?'true':'false'})">✏</button>` : '';
        return `<div class="sdv2-info-row" data-sdv2-row="${field}"><div class="k">${escSafe(k)}</div><div class="v"><span class="sdv2-val">${valHtml}</span>${btn}</div></div>`;
      };
      // 🏷️ 태그 row 렌더 헬퍼
      const tagRow = (storeId) => {
        const tags = (store && Array.isArray(store.tags)) ? store.tags : [];
        const chipsHtml = tags.length
          ? tags.map(t => `<span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;margin:2px 2px">${escSafe(t)}</span>`).join('')
          : '<span style="color:var(--gray-400);font-size:12px">태그 없음</span>';
        const btn = storeId
          ? `<button class="sdv2-edit-btn" title="태그 편집" onclick="_sdv2EditTags('${escSafe(storeId)}')">✏</button>`
          : '';
        return `<div class="sdv2-info-row" data-sdv2-row="tags"><div class="k">태그</div><div class="v"><span class="sdv2-val">${chipsHtml}</span>${btn}</div></div>`;
      };
      basicInfoEl.innerHTML = [
        erow('매장명', 'name', displayName),
        erow('🪧 매장간판명', 'signageName', store?.signageName || ''),
        erow('대표자', 'ceo', displayCeo),
        erow('대표자 연락처', 'ceoTel', displayCeoTel, { tel:true }),
        erow('매장 연락처', 'tel', displayTel, { tel:true }),
        row('사업자번호', displayBiz),
        row('매장코드', code || (store && store.code) || '-'),
        row('VAN사', displayVan),
        erow('주소', 'addr', displayAddr),
        tagRow(sid),
        row('매장 등록일', store?.storeRegDate || '-'),
        row('이카운트 등록', store?.ecountRegDate || '-'),
        row('상태', displayStat),
      ].join('');
    }

    /* ── 인라인 편집 헬퍼 — 매장정보 기본 정보 row 편집 ──
       UX: ✏ 클릭 → 같은 자리 input 표시 → Enter/blur 저장 + Esc 취소
       저장: store[field] 갱신 + saveStoreInPlace + pushStoresToCloud
       전화필드(tel=true) 는 inputmode=tel + 저장 후 tel: 링크로 재렌더 */
    if (!window._sdv2EditField) window._sdv2EditField = function(storeId, field, label, isTel) {
      try {
        const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
        const ix = stores.findIndex(s => s.id === storeId);
        if (ix < 0) { if (typeof showToast === 'function') showToast('⚠ 매장을 찾을 수 없습니다'); return; }
        const cur = String(stores[ix][field] || '');
        const row = document.querySelector(`#detailBasicInfo .sdv2-info-row[data-sdv2-row="${field}"]`);
        if (!row) return;
        const valWrap = row.querySelector('.v');
        const btn = row.querySelector('.sdv2-edit-btn');
        const valSpan = row.querySelector('.sdv2-val');
        if (!valWrap || !valSpan) return;
        // 편집 input 생성
        const input = document.createElement('input');
        input.type = isTel ? 'tel' : 'text';
        input.className = 'sdv2-edit-input';
        input.value = cur;
        input.placeholder = label;
        if (isTel) input.inputMode = 'tel';
        valSpan.style.display = 'none';
        if (btn) btn.style.display = 'none';
        valWrap.insertBefore(input, valSpan);
        input.focus();
        input.select();
        let committed = false;
        const commit = (save) => {
          if (committed) return;
          committed = true;
          if (save) {
            const next = String(input.value || '').trim();
            // ⚠ stale capture 방지 — 커밋 시점에 최신 stores 재조회 (편집 중 sync 가 갱신했을 수 있음)
            const fresh = (typeof getStores === 'function') ? (getStores() || []) : stores;
            const fi = fresh.findIndex(s => s.id === storeId);
            // ⚠ 편집 중 매장이 fresh 에서 사라짐(병합/삭제 동기화) → orphan 객체에 써서 saveStores(fresh) 로
            //    유실되는 것 방지. 저장하지 말고 사용자에게 알림 후 원복.
            if (fi < 0) {
              if (typeof showToast === 'function') showToast('⚠ 저장 실패 — 편집 중 매장 정보가 변경되었습니다. 다시 시도해 주세요');
              input.remove(); valSpan.style.display=''; if (btn) btn.style.display='';
              return;
            }
            const tgt = fresh[fi];
            const beforeVal = String(tgt[field] || '');
            if (beforeVal === next) { input.remove(); valSpan.style.display=''; if (btn) btn.style.display=''; return; }
            tgt[field] = next;
            _touchStore(tgt, field);   // per-field mtime 스탬프 → 다른 필드 동시편집 보존 + revert 방지
            // changeLog 추가 — 모달과 동일 포맷(type/from/to) 으로 통일
            if (!Array.isArray(tgt.changeLog)) tgt.changeLog = [];
            const ts = (typeof _kstStampSec === 'function') ? _kstStampSec() : new Date(Date.now()+9*3600*1000).toISOString().slice(0,19).replace('T',' ');
            const by = (typeof _currentUserName === 'function') ? _currentUserName() : '';
            const _typeMap = { name:'상호 변경', storeName:'상호 변경', biz:'사업자 변경', bizno:'사업자 변경', ceo:'대표자 변경', addr:'주소 이전', address:'주소 이전', tel:'연락처 변경', phone:'연락처 변경', van:'VAN 변경' };
            tgt.changeLog.unshift({ at: ts, by, type: _typeMap[field] || `${label} 변경`, from: { [field]: beforeVal }, to: { [field]: next }, note: `${label} 수정` });
            saveStores(fresh);
            try { if (typeof pushStoresToCloud === 'function') pushStoresToCloud({ toast:false }); } catch(_){}
            if (typeof showToast === 'function') showToast(`✓ ${label} 저장`);
            // valSpan 갱신 — tel 필드는 링크로 재렌더
            const esc2 = (typeof esc === 'function') ? esc : (s)=>String(s||'');
            if (isTel && next) {
              valSpan.innerHTML = `<a href="tel:${esc2(next)}" class="sdv2-tel" onclick="event.stopPropagation()">${esc2(next)}</a>`;
            } else {
              valSpan.textContent = next || '-';
            }
          }
          input.remove();
          valSpan.style.display = '';
          if (btn) btn.style.display = '';
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(true); }
          else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        });
        input.addEventListener('blur', () => commit(true));
      } catch(e) {
        console.warn('[_sdv2EditField] failed', e);
      }
    };

    /* ── 🏷️ 태그 편집 ── */
    if (!window._sdv2EditTags) window._sdv2EditTags = function(storeId) {
      try {
        const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
        const ix = stores.findIndex(s => s.id === storeId);
        if (ix < 0) { if (typeof showToast === 'function') showToast('⚠ 매장을 찾을 수 없습니다'); return; }
        const curTags = Array.isArray(stores[ix].tags) ? stores[ix].tags : [];
        const cur = curTags.join(', ');
        const next = prompt('태그를 쉼표(,)로 구분해 입력하세요\n예: 중앙, 마트, 명동그룹', cur);
        if (next === null) return;  // 취소
        const newTags = next.split(',').map(t => t.trim()).filter(Boolean);
        stores[ix].tags = newTags;
        _touchStore(stores[ix], 'tags');   // per-field mtime 스탬프
        if (!Array.isArray(stores[ix].changeLog)) stores[ix].changeLog = [];
        const ts = (typeof _kstStampSec === 'function') ? _kstStampSec() : new Date(Date.now()+9*3600*1000).toISOString().slice(0,19).replace('T',' ');
        const by = (typeof _currentUserName === 'function') ? _currentUserName() : '';
        stores[ix].changeLog.push({ at:ts, by, field:'tags', before:cur, after:newTags.join(', '), note:'태그 수정' });
        saveStores(stores);
        try { if (typeof pushStoresToCloud === 'function') pushStoresToCloud({ toast:false }); } catch(_){}
        if (typeof showToast === 'function') showToast(`🏷 태그 저장: ${newTags.length}개`);
        // 태그 row 즉시 갱신
        const row = document.querySelector('#detailBasicInfo .sdv2-info-row[data-sdv2-row="tags"]');
        if (row) {
          const valSpan = row.querySelector('.sdv2-val');
          if (valSpan) {
            const esc2 = (typeof esc === 'function') ? esc : (s)=>String(s||'');
            valSpan.innerHTML = newTags.length
              ? newTags.map(t => `<span style="display:inline-block;background:#EFF6FF;color:#1D4ED8;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;margin:2px 2px">${esc2(t)}</span>`).join('')
              : '<span style="color:var(--gray-400);font-size:12px">태그 없음</span>';
          }
        }
      } catch(e) { console.warn('[_sdv2EditTags]', e); }
    };

    /* ── 특이사항 (store.notes[]) 렌더 + 추가 ── */
    (function renderStoreNotes(){
      const escSafe2 = (typeof esc === 'function') ? esc : (s)=>String(s||'');
      const listEl = document.getElementById('detailNotesList');
      const cntEl = document.getElementById('detailNotesCount');
      const addBtn = document.getElementById('detailNoteAddBtn');
      const inputBox = document.getElementById('detailNoteInputBox');
      const inputEl = document.getElementById('detailNoteInput');
      const saveBtn = document.getElementById('detailNoteSaveBtn');
      const cancelBtn = document.getElementById('detailNoteCancelBtn');
      if (!listEl) return;

      const sid = store?.id;
      let _editIdx = -1;   // 인라인 편집 중인 특이사항의 store.notes 인덱스 (-1 = 없음)
      const renderList = () => {
        const arr = Array.isArray(store?.notes) ? store.notes : [];
        cntEl.textContent = arr.length ? '(' + arr.length + ')' : '';
        if (arr.length === 0) {
          listEl.innerHTML = `<div style="padding:14px;text-align:center;color:var(--gray-400);font-size:11.5px;background:var(--gray-50);border:1px dashed var(--gray-200);border-radius:8px">등록된 특이사항이 없습니다 — "+ 특이사항 추가"로 기록</div>`;
          return;
        }
        // 최근순
        const sorted = arr.slice().sort((a,b) => String(b.at||'').localeCompare(String(a.at||'')));
        listEl.innerHTML = sorted.map((n) => {
          const origIdx = arr.indexOf(n);
          const editedMeta = n.editedAt ? ` · ✏ ${escSafe2(n.editedAt)}${n.editedBy ? '/' + escSafe2(n.editedBy) : ''}` : '';
          if (origIdx === _editIdx) {
            // 편집 모드 — textarea + 저장/취소
            return `<div style="background:#fffbeb;border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:6px;padding:9px 12px">
              <textarea class="sdv2-note-edit" data-noteidx="${origIdx}" style="width:100%;min-height:62px;padding:7px 9px;border:1px solid #fcd34d;border-radius:6px;font-size:12px;font-family:inherit;line-height:1.5;resize:vertical;box-sizing:border-box">${escSafe2(n.text||'')}</textarea>
              <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
                <button data-noteidx="${origIdx}" class="sdv2-note-save" style="background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:11.5px;font-weight:800;cursor:pointer">저장</button>
                <button class="sdv2-note-canceledit" style="background:none;border:1px solid var(--gray-300);color:var(--gray-600);border-radius:6px;padding:5px 12px;font-size:11.5px;font-weight:700;cursor:pointer">취소</button>
              </div>
            </div>`;
          }
          return `<div style="background:#fffbeb;border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:6px;padding:9px 12px;font-size:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;font-size:10.5px;color:var(--gray-500);font-weight:700">
              <div>📌 ${escSafe2(n.at || '')}${n.by ? ' · ' + escSafe2(n.by) : ''}${editedMeta}</div>
              <div style="display:flex;gap:2px;flex-shrink:0">
                <button data-noteidx="${origIdx}" class="sdv2-note-edit-btn" title="수정" style="background:none;border:none;color:var(--gray-400);font-size:13px;cursor:pointer;padding:0 4px">✏️</button>
                <button data-noteidx="${origIdx}" class="sdv2-note-del" title="삭제" style="background:none;border:none;color:var(--gray-400);font-size:14px;cursor:pointer;padding:0 4px">✕</button>
              </div>
            </div>
            <div style="color:#92400e;white-space:pre-wrap;line-height:1.5">${escSafe2(n.text||'')}</div>
          </div>`;
        }).join('');
        // 삭제 바인딩
        listEl.querySelectorAll('.sdv2-note-del').forEach(b => {
          b.onclick = () => {
            if (!confirm('이 특이사항을 삭제하시겠습니까?')) return;
            const i = parseInt(b.dataset.noteidx, 10);
            if (!isNaN(i) && Array.isArray(store.notes)) {
              store.notes.splice(i, 1);
              if (_editIdx === i) _editIdx = -1;
              if (typeof saveStoreInPlace === 'function') saveStoreInPlace(store);
              renderList();
            }
          };
        });
        // 편집 진입 바인딩
        listEl.querySelectorAll('.sdv2-note-edit-btn').forEach(b => {
          b.onclick = () => {
            const i = parseInt(b.dataset.noteidx, 10);
            if (!isNaN(i)) { _editIdx = i; renderList(); const ta = listEl.querySelector('.sdv2-note-edit'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
          };
        });
        // 편집 저장 바인딩
        listEl.querySelectorAll('.sdv2-note-save').forEach(b => {
          b.onclick = () => {
            const i = parseInt(b.dataset.noteidx, 10);
            const ta = listEl.querySelector('.sdv2-note-edit[data-noteidx="' + i + '"]');
            const txt = ta ? (ta.value || '').trim() : '';
            if (!txt) { alert('내용을 입력하세요'); return; }
            if (!isNaN(i) && Array.isArray(store.notes) && store.notes[i]) {
              store.notes[i].text = txt;
              store.notes[i].editedAt = _kstDateTimeStr ? _kstDateTimeStr() : new Date().toISOString().slice(0,16).replace('T',' ');
              store.notes[i].editedBy = (typeof _currentAuthName === 'function') ? _currentAuthName() : '';
              if (typeof saveStoreInPlace === 'function') saveStoreInPlace(store);
            }
            _editIdx = -1;
            renderList();
          };
        });
        // 편집 취소 바인딩
        listEl.querySelectorAll('.sdv2-note-canceledit').forEach(b => {
          b.onclick = () => { _editIdx = -1; renderList(); };
        });
      };

      // 추가 버튼
      if (addBtn) addBtn.onclick = () => {
        inputBox.style.display = 'block';
        inputEl.value = '';
        inputEl.focus();
      };
      if (cancelBtn) cancelBtn.onclick = () => { inputBox.style.display = 'none'; };
      if (saveBtn) saveBtn.onclick = () => {
        const txt = (inputEl.value || '').trim();
        if (!txt) { alert('내용을 입력하세요'); return; }
        if (!store.notes) store.notes = [];
        store.notes.push({
          text: txt,
          at: _kstDateTimeStr ? _kstDateTimeStr() : new Date().toISOString().slice(0,16).replace('T',' '),
          by: (typeof _currentAuthName === 'function') ? _currentAuthName() : '',
        });
        if (typeof saveStoreInPlace === 'function') saveStoreInPlace(store);
        inputBox.style.display = 'none';
        renderList();
      };

      renderList();
    })();

    /* ── 👤 담당자 (store.contacts[]) 렌더 + 추가/수정/삭제/대표 ── */
    (function renderStoreContacts(){
      const escC = (typeof esc === 'function') ? esc : (s)=>String(s||'');
      const card = document.getElementById('detailContactsCard');
      if (!card) return;
      const normP = (p) => String(p||'').replace(/\D/g,'');
      const keyOf = (c) => normP(c.phone) || ('n:' + String(c.name||'').trim() + '|' + String(c.role||'').trim());
      let _ed = -1;       // 편집 중인 store.contacts 인덱스
      let _adding = false;
      const save = () => { if (typeof saveStoreInPlace === 'function') saveStoreInPlace(store); };
      const inSty = 'height:30px;padding:0 8px;border:1px solid var(--gray-300);border-radius:6px;font-size:12px;font-family:inherit;box-sizing:border-box';
      const btnP = 'border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit';

      const visible = () => {
        const arr = Array.isArray(store && store.contacts) ? store.contacts : [];
        const tomb = new Set(Array.isArray(store && store.contactsDeleted) ? store.contactsDeleted : []);
        return arr.map((c,i)=>({c,i})).filter(o => !tomb.has(keyOf(o.c)));
      };

      const render = () => {
        // 미등록 매장(store.id 없음)은 누적 대상이 아님
        if (!store || !store.id) {
          card.innerHTML = `<h4>👤 담당자</h4><div style="padding:12px;text-align:center;color:var(--gray-400);font-size:11.5px;background:var(--gray-50);border:1px dashed var(--gray-200);border-radius:8px">미등록 매장입니다 — 등록 후 담당자를 관리할 수 있습니다</div>`;
          return;
        }
        const items = visible();
        const addForm = _adding ? `
          <div style="margin-bottom:10px;padding:10px;background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
            <input id="ccAddName" placeholder="이름" style="${inSty};flex:1;min-width:84px">
            <input id="ccAddRole" placeholder="직책" style="${inSty};width:84px">
            <input id="ccAddPhone" inputmode="tel" placeholder="연락처" style="${inSty};width:130px">
            <input id="ccAddEmail" placeholder="이메일(선택)" style="${inSty};width:140px">
            <button class="cc-add-save" style="${btnP};background:var(--primary);color:#fff">저장</button>
            <button class="cc-add-cancel" style="${btnP};background:var(--gray-100);color:var(--gray-700);border:1px solid var(--gray-200)">취소</button>
          </div>` : '';
        const list = items.length ? items.map(({c,i}) => {
          if (i === _ed) {
            return `<div style="padding:9px 11px;border:1px solid #c7d2fe;background:#eef2ff;border-radius:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
              <input id="ccEdName" value="${escC(c.name||'')}" placeholder="이름" style="${inSty};flex:1;min-width:84px">
              <input id="ccEdRole" value="${escC(c.role||'')}" placeholder="직책" style="${inSty};width:84px">
              <input id="ccEdPhone" inputmode="tel" value="${escC(c.phone||'')}" placeholder="연락처" style="${inSty};width:130px">
              <input id="ccEdEmail" value="${escC(c.email||'')}" placeholder="이메일" style="${inSty};width:140px">
              <button class="cc-ed-save" data-i="${i}" style="${btnP};background:var(--primary);color:#fff">저장</button>
              <button class="cc-ed-cancel" style="${btnP};background:#fff;color:var(--gray-600);border:1px solid var(--gray-300)">취소</button>
            </div>`;
          }
          const role = c.role ? `<span style="color:var(--gray-500);font-size:11.5px">${escC(c.role)}</span>` : '';
          const phone = c.phone ? `<a href="#" class="cc-phone" data-phone="${escC(c.phone)}" data-name="${escC(c.name||'')}" title="이 번호가 관여된 다른 매장 보기" style="color:#1d4ed8;text-decoration:none;font-weight:700">📞 ${escC(c.phone)}</a>` : '';
          const email = c.email ? `<span style="color:var(--gray-400);font-size:11px">✉ ${escC(c.email)}</span>` : '';
          const meta = (c.sourceJobType || c.addedBy) ? `<span style="color:var(--gray-300);font-size:10px">${c.sourceJobType?escC(c.sourceJobType):''}${c.sourceJobType&&c.addedBy?' · ':''}${c.addedBy?escC(c.addedBy):''}</span>` : '';
          return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 11px;border:1px solid var(--gray-200);border-left:3px solid ${c.primary?'#f59e0b':'var(--gray-200)'};border-radius:8px;background:#fff">
            <button class="cc-pri" data-i="${i}" title="${c.primary?'대표 담당자':'대표로 지정'}" style="background:none;border:none;cursor:pointer;font-size:15px;padding:0;line-height:1;color:${c.primary?'#f59e0b':'var(--gray-300)'}">${c.primary?'★':'☆'}</button>
            <b style="font-size:13px">${escC(c.name||'(이름없음)')}</b>
            ${role} ${phone} ${email} ${meta}
            <span style="flex:1"></span>
            <button class="cc-edit" data-i="${i}" title="수정" style="background:none;border:none;color:var(--gray-400);font-size:13px;cursor:pointer;padding:0 3px">✏️</button>
            <button class="cc-del" data-i="${i}" title="삭제" style="background:none;border:none;color:var(--gray-400);font-size:14px;cursor:pointer;padding:0 3px">✕</button>
          </div>`;
        }).join('') : `<div style="padding:12px;text-align:center;color:var(--gray-400);font-size:11.5px;background:var(--gray-50);border:1px dashed var(--gray-200);border-radius:8px">등록된 담당자가 없습니다 — 업무 등록 시 입력한 연락처가 자동 누적되며, "+ 담당자 추가"로 직접 등록할 수 있습니다</div>`;
        card.innerHTML = `<h4 style="display:flex;justify-content:space-between;align-items:center">
            <span>👤 담당자 <span style="margin-left:4px;font-size:11px;color:var(--gray-500);font-weight:600">${items.length?'('+items.length+')':''}</span></span>
            <button class="cc-add-btn" style="background:var(--primary);color:#fff;${btnP}">+ 담당자 추가</button>
          </h4>${addForm}<div style="display:flex;flex-direction:column;gap:6px">${list}</div>`;
        bind();
      };

      const bind = () => {
        const q = (sel) => card.querySelector(sel);
        const me = () => (typeof _currentAuthName === 'function') ? _currentAuthName() : '';
        const nowStamp = () => (typeof _kstDateTimeStr === 'function') ? _kstDateTimeStr() : new Date(Date.now()+9*3600*1000).toISOString().slice(0,16).replace('T',' ');
        const addBtn = q('.cc-add-btn'); if (addBtn) addBtn.onclick = () => { _adding = true; _ed = -1; render(); const i=q('#ccAddName'); if(i) i.focus(); };
        const addCancel = q('.cc-add-cancel'); if (addCancel) addCancel.onclick = () => { _adding = false; render(); };
        const addSave = q('.cc-add-save'); if (addSave) addSave.onclick = () => {
          const name=(q('#ccAddName').value||'').trim(), role=(q('#ccAddRole').value||'').trim(), phone=(q('#ccAddPhone').value||'').trim(), email=(q('#ccAddEmail').value||'').trim();
          if (!name && !phone) { alert('이름 또는 연락처를 입력하세요'); return; }
          if (!Array.isArray(store.contacts)) store.contacts = [];
          const k = normP(phone) || ('n:'+name+'|'+role);
          if (Array.isArray(store.contactsDeleted)) store.contactsDeleted = store.contactsDeleted.filter(x => x !== k);   // 재등록 시 tombstone 해제
          store.contacts.push({ name, role, phone, email, address:'', primary: visible().length===0, addedAt: nowStamp(), addedBy: me(), updatedAt: new Date().toISOString() });
          save(); _adding = false; render();
        };
        card.querySelectorAll('.cc-edit').forEach(b => b.onclick = () => { _ed = parseInt(b.dataset.i,10); _adding = false; render(); const i=q('#ccEdName'); if(i){ i.focus(); } });
        card.querySelectorAll('.cc-ed-cancel').forEach(b => b.onclick = () => { _ed = -1; render(); });
        card.querySelectorAll('.cc-ed-save').forEach(b => b.onclick = () => {
          const i = parseInt(b.dataset.i,10); if (isNaN(i) || !store.contacts[i]) return;
          const name=(q('#ccEdName').value||'').trim(), role=(q('#ccEdRole').value||'').trim(), phone=(q('#ccEdPhone').value||'').trim(), email=(q('#ccEdEmail').value||'').trim();
          if (!name && !phone) { alert('이름 또는 연락처를 입력하세요'); return; }
          Object.assign(store.contacts[i], { name, role, phone, email, updatedAt: new Date().toISOString(), updatedBy: me() });
          save(); _ed = -1; render();
        });
        card.querySelectorAll('.cc-del').forEach(b => b.onclick = () => {
          const i = parseInt(b.dataset.i,10); if (isNaN(i) || !store.contacts[i]) return;
          if (!confirm('이 담당자를 삭제하시겠습니까?')) return;
          const k = keyOf(store.contacts[i]);
          if (!Array.isArray(store.contactsDeleted)) store.contactsDeleted = [];
          if (!store.contactsDeleted.includes(k)) store.contactsDeleted.push(k);   // tombstone (동기화 부활 차단)
          store.contacts.splice(i,1);
          if (_ed === i) _ed = -1;
          save(); render();
        });
        card.querySelectorAll('.cc-pri').forEach(b => b.onclick = () => {
          const i = parseInt(b.dataset.i,10); if (isNaN(i)) return;
          store.contacts.forEach((c,j) => c.primary = (j === i));
          save(); render();
        });
        card.querySelectorAll('.cc-phone').forEach(a => a.onclick = (e) => { e.preventDefault(); if (window._showContactStores) window._showContactStores(a.dataset.phone, a.dataset.name); });
      };

      render();
    })();

    /* ── 메모 탭: 매장 일반 메모 입력 (store.storeMemos[]) ── */
    (function bindStoreMemoInput(){
      const inputEl = document.getElementById('detailStoreMemoInput');
      const btn = document.getElementById('detailStoreMemoAddBtn');
      if (!inputEl || !btn) return;
      btn.onclick = () => {
        const txt = (inputEl.value || '').trim();
        if (!txt) { alert('메모 내용을 입력하세요'); return; }
        if (!store.storeMemos) store.storeMemos = [];
        store.storeMemos.unshift({
          text: txt,
          at: _kstDateTimeStr ? _kstDateTimeStr() : new Date().toISOString().slice(0,16).replace('T',' '),
          by: (typeof _currentAuthName === 'function') ? _currentAuthName() : '',
        });
        if (typeof saveStoreInPlace === 'function') saveStoreInPlace(store);
        inputEl.value = '';
        // 메모 리스트 재렌더는 reopenStoreDetail() 사용
        if (typeof renderStoreDetailMemos === 'function') renderStoreDetailMemos(store);
      };
    })();

    /* ── 설치 장비 현황 — store.equipment[] (Plan B 정식 DB) ── */
    const equipBody = document.getElementById('detailEquipTbody');
    if (equipBody) {
      // 1) store.equipment[] (정식 DB) 우선 표시
      const items = (store && Array.isArray(store.equipment)) ? store.equipment : [];
      // status 가 in_use / replaced 만 메인, 나머지는 [이력]
      const active = items.filter(e => !e.status || e.status === 'in_use' || e.status === 'replaced');
      const archived = items.filter(e => e.status && e.status !== 'in_use' && e.status !== 'replaced');

      const rows = [];

      const renderInstanceRow = (e) => {
        const status = e.status || 'in_use';
        const meta = STORE_EQUIP_STATUS[status] || STORE_EQUIP_STATUS.in_use;
        const variantTxt = e.variant ? `<span style="background:#EFF6FF;color:#1D4ED8;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:3px">${esc(e.variant)}</span>` : '';
        const optsTxt = (e.options && typeof e.options === 'object' && Object.keys(e.options).length > 0)
          ? Object.entries(e.options).map(([k,v]) => `<span style="background:#F3E8FF;color:#7E22CE;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:3px">${esc(k)}: ${esc(v)}</span>`).join('')
          : '';
        const sizeTxt = e.size ? `<span style="background:#FEF3C7;color:#92400E;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:3px">📐 ${esc(e.size)}</span>` : '';
        const condTxt = (e.condition === 'used') ? `<span style="background:#FEE2E2;color:#991B1B;font-size:10px;padding:1px 5px;border-radius:3px;margin-left:3px">중고</span>` : '';
        const serialTxt = e.serialNo ? `<div style="font-size:10px;color:var(--gray-500);margin-top:2px">S/N: ${esc(e.serialNo)}</div>` : '';
        const installedTxt = (e.installedAt || e.installedBy)
          ? `<div style="font-size:10px;color:var(--gray-400);margin-top:2px">${esc(e.installedAt||'-')} ${e.installedBy?'· '+esc(e.installedBy):''}</div>`
          : '';
        const catLost = e.catalogId && !getEquipmentCatalog().find(c => c.id === e.catalogId);
        const catWarn = catLost ? `<span title="카탈로그에서 사라진 장비 — snapshot 기준 표시" style="font-size:10px;color:var(--warning);margin-left:4px">⚠</span>` : '';
        return `<tr data-instance="${esc(e.instanceId||'')}">
          <td>
            <div><b>${esc(e.name||'-')}</b>${catWarn}${condTxt}${variantTxt}${optsTxt}${sizeTxt}</div>
            ${serialTxt}
          </td>
          <td style="color:var(--gray-500);font-size:11px">${esc(e.category||'-')}</td>
          <td><b>${e.qty||0}</b>대</td>
          <td style="color:var(--gray-500);font-size:11px">${esc(e.installedAt||'-')}${installedTxt && e.installedBy ? '<div style=\"font-size:10px;color:var(--gray-400);margin-top:2px\">'+esc(e.installedBy)+'</div>' : ''}</td>
          <td>
            <span style="background:${meta.bg};color:${meta.color};font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px">${meta.label}</span>
            <div style="margin-top:4px;display:flex;gap:4px">
              <button title="편집" onclick="openStoreEquipEditor('${esc(e.instanceId||'')}')" style="background:none;border:1px solid var(--gray-200);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px">✎</button>
              <button title="상태 변경" onclick="openStoreEquipStatusPicker('${esc(e.instanceId||'')}')" style="background:none;border:1px solid var(--gray-200);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px">⤴</button>
            </div>
          </td>
        </tr>`;
      };

      if (active.length === 0 && archived.length === 0) {
        // store.equipment 가 비어 있으면 호환용 fallback 표시 + 마이그레이션 안내
        const posCount = parseInt(store?.pos, 10) || parseInt((posTxt.match(/\d+/) || [0])[0], 10) || 0;
        const kioCount = parseInt((cells[7]?.querySelectorAll('.pk-chip')[1]?.textContent.match(/\d+/) || [0])[0], 10) || 0;
        if (posCount > 0) rows.push(`<tr><td><b>POS 일체형</b> <span style="font-size:10px;color:var(--gray-400)">(이카운트 수량)</span></td><td style="color:var(--gray-400)">-</td><td>${posCount}대</td><td style="color:var(--gray-400)">-</td><td><span class="badge badge-green">정상</span></td></tr>`);
        if (kioCount > 0) rows.push(`<tr><td><b>키오스크</b> <span style="font-size:10px;color:var(--gray-400)">(이카운트 수량)</span></td><td style="color:var(--gray-400)">-</td><td>${kioCount}대</td><td style="color:var(--gray-400)">-</td><td><span class="badge badge-green">정상</span></td></tr>`);
        if (displayVan) rows.push(`<tr><td><b>카드단말 (VAN)</b></td><td style="color:var(--gray-400)">${esc(displayVan)}</td><td>${posCount || '-'}${posCount ? '대' : ''}</td><td style="color:var(--gray-400)">-</td><td><span class="badge badge-green">정상</span></td></tr>`);
        if (rows.length === 0) {
          rows.push(`<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--gray-400);font-size:12px">등록된 설치 장비가 없습니다.<br><button class="btn btn-primary btn-sm" style="margin-top:8px;font-size:11px;padding:5px 10px" onclick="openStoreEquipAdd()">+ 첫 장비 추가</button></td></tr>`);
        } else {
          rows.push(`<tr><td colspan="5" style="text-align:center;padding:10px;color:var(--gray-400);font-size:11px"><button class="btn btn-outline btn-sm" style="font-size:11px;padding:5px 10px" onclick="openStoreEquipAdd()">+ 상세 장비 추가</button></td></tr>`);
        }
      } else {
        active.forEach(e => rows.push(renderInstanceRow(e)));
        if (archived.length > 0) {
          rows.push(`<tr><td colspan="5" style="background:#F9FAFB;padding:6px 10px;font-size:11px;font-weight:700;color:var(--gray-500)">📦 이력 (${archived.length}건) — 교체/제거/폐기/이전</td></tr>`);
          archived.forEach(e => rows.push(renderInstanceRow(e)));
        }
        rows.push(`<tr><td colspan="5" style="background:#F9FAFB;padding:8px;text-align:right"><button class="btn btn-primary btn-sm" style="font-size:11px;padding:5px 10px" onclick="openStoreEquipAdd()">+ 장비 추가</button></td></tr>`);
      }
      equipBody.innerHTML = rows.join('');
      // 매장 컨텍스트 저장 (편집기 모달이 참조)
      window._currentStoreEquipCtx = { storeId: store?.id || store?.storeId, storeName: displayName, businessNumber: store?.businessNumber || store?.biz };
    }

    /* ── 작업 이력 (ns_jobs 기반)
       매칭 전략:
         1. storeId 정확 일치
         2. 매장명 또는 aliases 의 정규화 일치 (병합 시 rerouting 누락 안전망)
         3. fallback: 부분 문자열 포함 (옛 동작 호환)
    ── */
    const tlEl = document.getElementById('detailHistoryTimeline');
    if (tlEl) {
      let jobs = [];
      try { jobs = (typeof getJobs === 'function') ? (getJobs() || []) : []; } catch(e) {}
      const nameKey = (displayName || '').trim();
      // 매장의 모든 식별자 (id + 본명 + aliases) 의 정규화 set
      const normFn = (typeof _normStoreKey === 'function') ? _normStoreKey : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
      const aliasNames = Array.isArray(store?.aliases) ? store.aliases : [];
      const matchNorms = new Set([nameKey, ...aliasNames].filter(Boolean).map(normFn));
      const storeIdKey = store?.id || store?.storeId;
      // 매장DB의 유효 id 집합 — '다른 매장에 명시 연결된 작업' 판별용 (1회 계산)
      const _allStoreIds = (() => { try { return new Set(((typeof getStores === 'function') ? (getStores() || []) : []).map(s => s && s.id).filter(Boolean)); } catch(_) { return new Set(); } })();
      const matched = jobs.filter(j => {
        // (1) storeId 매칭 — storeId 가 진실의 원천
        if (storeIdKey && (j.storeId === storeIdKey)) return true;
        // (1b) 🛡 다른 '실존' 매장에 storeId 로 연결된 작업은 이름이 같아도 제외 —
        //      storeName/storeId 가 엇갈린 작업이 두 매장에 동시 노출되는 것 구조적 차단
        //      ("한 작업 = 정확히 한 매장"). storeId 가 매장DB에 없는 dangling 이면 이름 fallback 유지.
        if (j.storeId && storeIdKey && j.storeId !== storeIdKey && _allStoreIds.has(j.storeId)) return false;
        const s = (j.store || j.storeName || '').trim();
        if (!s) return false;
        // (2) 정규화 매칭 (본명 또는 aliases) — 정확 일치만
        if (matchNorms.has(normFn(s))) return true;
        // (3) ❌ 부분 문자열 포함 매칭 제거 — "오케이마트" ⊂ "여주오케이마트" 교차 오매칭 원인. 금지.
        return false;
      });
      // 최신순 정렬
      matched.sort((a,b) => {
        const da = new Date(a.date || a.createdAt || 0).getTime();
        const db = new Date(b.date || b.createdAt || 0).getTime();
        return db - da;
      });
      if (matched.length === 0) {
        tlEl.innerHTML = `
          <div style="padding:20px;text-align:center;color:var(--gray-400);font-size:12px">
            <div style="font-size:28px;margin-bottom:8px">📭</div>
            <div>이 점포에 등록된 작업 이력이 없습니다.</div>
            <div style="margin-top:4px;font-size:11px">상단의 "+ 작업 등록"으로 추가하세요.</div>
          </div>`;
      } else {
        // 디테일 렌더 — 조회 전용. 카테고리 태그 / thread 흐름 / 메모 / 일정 / 장비 모두 표시
        const esc2 = (typeof esc === 'function') ? esc : (s)=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
        const catOfJob = (j) => {
          const lc = String(j.lineCategory || '').toLowerCase();
          const tp = String(j.type || j.category || '').toLowerCase();
          const all = lc + ' ' + tp;
          if (/label|equip_out|delivery|라벨|영수증|프라이스텍|소모품|택배/.test(all)) return { key:'supplies', tag:'🏷️ 소모품', color:'#a16207', bg:'#FEF3C7' };
          if (/van_doc|밴서류|van.*신규|van.*재신고|van.*정산|van.*계약|van.*변경/.test(all)) return { key:'van', tag:'📑 VAN 서류', color:'#1d4ed8', bg:'#DBEAFE' };
          if (/open_store|오픈|신규|new_open|newopen/.test(all)) return { key:'new', tag:'🆕 신규', color:'#15803d', bg:'#DCFCE7' };
          if (/churn|폐업|매각|해지|이탈/.test(all)) return { key:'churn', tag:'🏪 이탈', color:'#7c2d12', bg:'#FED7AA' };
          if (/pos_as|van_as|device_mgmt|as_pos|단말|a\/s|에이에스/.test(all) || /\bas\b/.test(all)) return { key:'as', tag:'🔧 AS', color:'#b91c1c', bg:'#FEE2E2' };
          return { key:'etc', tag:'📋 업무', color:'#475569', bg:'#E2E8F0' };
        };
        const fmtDate = (v) => {
          if (!v) return '';
          if (typeof v === 'number') return new Date(v).toLocaleString('ko-KR');
          const s = String(v);
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace('T',' ').slice(0,16);
          try { return new Date(s).toLocaleString('ko-KR'); } catch(e){ return s; }
        };
        // 🔧 모바일↔PC 호환 — equipment 가 hybrid 객체 ({"0":{...}, "1":{...}, "server":2, ...}) 인 경우
        //   기존: Array.isArray 만 검사 → 객체면 그냥 무시 → PC 에서 장비 안보임
        //   변경: 객체에서 (a) 값이 object 인 항목 = detailed, (b) 값이 숫자 인 항목 = simple count 로 분리 후 함께 표시
        const MOBILE_EQ_NAMES = { pc:'PC', server:'서버', pos:'포스', kiosk:'키오스크', fixedScan:'고정스캐너', handyTerm:'핸디터미널', labelPrint:'라벨프린터', posDaiL:'포스다이 좌타', posDaiR:'포스다이 우타', checker:'체크기', handyScan:'핸디스캐너', client:'클라이언트PC', fscanner:'고정스캐너', posdai:'포스다이', monitor:'모니터' };
        const _normEqForPC = (eq) => {
          const detailed = []; const counts = {};
          if (!eq) return { detailed, counts };
          if (Array.isArray(eq)) { eq.forEach(it => { if (it && (Number(it.qty)||0) > 0) detailed.push(it); }); return { detailed, counts }; }
          if (typeof eq !== 'object') return { detailed, counts };
          Object.entries(eq).forEach(([k,v]) => {
            if (v && typeof v === 'object') { if ((Number(v.qty)||0) > 0) detailed.push(v); }
            else { const n = Number(v)||0; if (n > 0) counts[k] = (counts[k]||0) + n; }
          });
          return { detailed, counts };
        };
        const renderEquipList = (eq) => {
          const { detailed, counts } = _normEqForPC(eq);
          const countKeys = Object.keys(counts);
          if (detailed.length === 0 && countKeys.length === 0) return '';
          const detRows = detailed.map(e => {
            const name = esc2(e.name||e.item||'장비');
            const v = e.variant||e.option||e.options||'';
            const q = e.qty ? ` ×${e.qty}` : '';
            const cond = e.condition ? ` <span style="color:var(--gray-500)">[${esc2(e.condition)}]</span>` : '';
            return `<div style="margin-top:2px">• ${name}${v?' <span style="color:var(--gray-500)">'+esc2(v)+'</span>':''}${q}${cond}</div>`;
          }).join('');
          const cntRows = countKeys.map(k => {
            const nm = MOBILE_EQ_NAMES[k] || k;
            return `<div style="margin-top:2px">• ${esc2(nm)} ×${counts[k]}</div>`;
          }).join('');
          return `<div style="margin-top:6px;padding:6px 8px;background:#fff;border:1px dashed var(--gray-300);border-radius:6px;font-size:11px;color:var(--gray-700)">
            ${detRows ? `<b style="font-size:10px;color:var(--gray-500)">📦 판매·구입 장비 (${detailed.length})</b>${detRows}` : ''}
            ${cntRows ? `<div style="margin-top:${detRows?6:0}px"><b style="font-size:10px;color:var(--gray-500)">🚚 설치 요청 (${countKeys.length})</b>${cntRows}</div>` : ''}
          </div>`;
        };
        const renderThread = (j) => {
          const th = Array.isArray(j.thread) ? j.thread.slice() : [];
          if (th.length === 0) return '';
          // ts 오름차순 정렬 (시간 순서로 흐름 보이도록)
          th.sort((a,b)=>String(a.ts||'').localeCompare(String(b.ts||'')));
          const roots = th.filter(e => e && e.parentId === null);
          if (roots.length === 0) {
            // ROOT 없는 잔존 데이터 — flat 으로
            return `<div style="margin-top:8px">${th.map(e=>`<div style="padding:4px 0;font-size:12px"><b>${esc2(e.status||'')}</b> · ${esc2(e.author||'')} · ${esc2(fmtDate(e.ts))}<br><span style="color:var(--gray-700)">${esc2((e.text||'').slice(0,300))}</span></div>`).join('')}</div>`;
          }
          // ts 오름차순 → 최근 요청이 아래. 사용자 요청대로 접수→진행→완료 흐름을 자연스럽게 노출
          return `<div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">${roots.map((r,ri)=>{
            const kids = th.filter(e => e && e.parentId === r.threadId);
            const isDone = kids.some(k => k.status === '완료');
            const isProg = kids.some(k => k.status === '진행');
            const stateLabel = isDone ? '✅ 완료' : (isProg ? '🚗 진행중' : '📋 접수');
            const stateColor = isDone ? '#15803d' : (isProg ? '#b45309' : '#1d4ed8');
            return `<div style="border-left:3px solid ${stateColor};padding-left:10px;background:#FAFAFA;border-radius:0 8px 8px 0;padding:8px 10px">
              <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:6px;margin-bottom:6px">
                <div>
                  <span style="font-size:11px;font-weight:700;color:${stateColor}">📥 요청접수 #${ri+1}</span>
                  <span style="font-size:11px;color:var(--gray-500);margin-left:6px">${esc2(fmtDate(r.ts))} · ${esc2(r.author||'-')}</span>
                </div>
                <span style="font-size:10px;font-weight:700;padding:2px 8px;background:${stateColor};color:#fff;border-radius:10px">${stateLabel}</span>
              </div>
              <div style="font-size:12.5px;color:var(--gray-800);background:#fff;padding:6px 8px;border-radius:6px;border:1px solid var(--gray-200);white-space:pre-wrap;word-break:break-word">${esc2(r.text||'(내용 없음)')}</div>
              ${kids.length > 0 ? `<div style="margin-top:8px;padding-left:14px;border-left:2px dotted var(--gray-300)">${kids.map(c=>{
                const cColor = c.status === '완료' ? '#15803d' : (c.status === '진행' ? '#b45309' : '#475569');
                const cIcon = c.status === '완료' ? '✅' : (c.status === '진행' ? '🚗' : '•');
                return `<div style="margin-top:6px">
                  <div style="font-size:11px"><b style="color:${cColor}">${cIcon} ${esc2(c.status||'기록')}</b> <span style="color:var(--gray-500)">· ${esc2(fmtDate(c.ts))} · ${esc2(c.author||'-')}</span></div>
                  ${c.text ? `<div style="font-size:12px;color:var(--gray-700);margin-top:3px;padding:4px 6px;background:#fff;border:1px solid var(--gray-100);border-radius:4px;white-space:pre-wrap;word-break:break-word">${esc2(c.text)}</div>` : ''}
                  ${renderEquipList(c.equipment)}
                </div>`;
              }).join('')}</div>` : '<div style="font-size:10px;color:var(--gray-400);margin-top:6px">↳ 처리 기록 없음</div>'}
            </div>`;
          }).join('')}</div>`;
        };
        const renderMemos = (j) => {
          const m = Array.isArray(j.memos) ? j.memos : [];
          if (m.length === 0) return '';
          return `<div style="margin-top:8px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;padding:6px 8px">
            <div style="font-size:10px;font-weight:700;color:#92400E;margin-bottom:4px">📝 메모 ${m.length}건</div>
            ${m.slice().reverse().map(x=>`<div style="font-size:11.5px;color:#78350F;padding:3px 0;border-bottom:1px dotted #FCD34D"><span style="color:#92400E;font-size:10px">${esc2(fmtDate(x.at))} · ${esc2(x.by||'-')}</span><br>${esc2(x.text||'')}</div>`).join('')}
          </div>`;
        };
        const renderSchedule = (j, cat) => {
          if (cat.key !== 'new') return '';
          const parts = [];
          if (j.installDate)   parts.push(`<span style="color:var(--gray-600)">🔧 설치 <b>${esc2(j.installDate)}</b></span>`);
          if (j.softOpenDate)  parts.push(`<span style="color:var(--gray-600)">🌅 가오픈 <b>${esc2(j.softOpenDate)}</b></span>`);
          if (j.openDate)      parts.push(`<span style="color:var(--gray-600)">🎉 오픈 <b>${esc2(j.openDate)}</b></span>`);
          if (j.contractDate)  parts.push(`<span style="color:var(--gray-600)">📄 계약 <b>${esc2(j.contractDate)}</b></span>`);
          if (parts.length === 0) return '';
          return `<div style="margin-top:6px;font-size:11px;display:flex;flex-wrap:wrap;gap:10px">${parts.join('')}</div>`;
        };
        const renderVanDocs = (j) => {
          const vd = j.vandocs || {};
          const keys = Object.keys(vd).filter(k => vd[k]);
          if (keys.length === 0) return '';
          return `<div style="margin-top:6px;font-size:11px;color:var(--gray-700)"><b style="font-size:10px;color:var(--gray-500)">📑 첨부 서류</b> ${keys.map(k=>esc2(k)).join(' · ')}</div>`;
        };

        tlEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px">` + matched.map((j) => {
          const cat = catOfJob(j);
          const done = _isJobDone(j);
          const created = fmtDate(j.createdAt || j.date);
          const finished = done ? fmtDate(j.completedAt || j.doneAt) : '';
          const who = esc2(j.engineer || j.assignee || j._whoCreated || '-');
          const lineLabel = j.lineCategory && (typeof LINE_TYPE_META !== 'undefined') ? (LINE_TYPE_META[j.lineCategory]?.label || '') : '';
          const title = esc2(j.title || j.type || '업무');
          const desc = j.note || j.description || j.notes || j.asRequest || j.lineParsed || '';
          const hasThread = Array.isArray(j.thread) && j.thread.length > 0;
          return `<div style="background:#fff;border:1px solid var(--gray-200);border-left:4px solid ${cat.color};border-radius:8px;padding:12px 14px;box-shadow:0 1px 2px rgba(0,0,0,.03)">
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px;margin-bottom:6px">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="background:${cat.bg};color:${cat.color};font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px">${cat.tag}</span>
                ${lineLabel ? `<span style="font-size:10px;color:var(--gray-500);font-weight:700">${esc2(lineLabel)}</span>` : ''}
                <span style="font-size:13.5px;font-weight:700;color:var(--gray-800)">${title}</span>
              </div>
              <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;background:${done?'#DCFCE7':'#FEF3C7'};color:${done?'#15803d':'#92400E'}">${done?'✓ 완료':'● 진행중'}</span>
            </div>
            <div style="font-size:11px;color:var(--gray-500);display:flex;flex-wrap:wrap;gap:10px">
              ${created ? `<span>📅 등록 ${esc2(created)}</span>` : ''}
              ${finished ? `<span>✅ 완료 ${esc2(finished)}</span>` : ''}
              <span>👤 ${who}</span>
              <span style="color:var(--gray-400)">· ID ${esc2(j.id||'')}</span>
            </div>
            ${renderSchedule(j, cat)}
            ${desc && !hasThread ? `<div style="margin-top:8px;font-size:12.5px;color:var(--gray-700);background:#F9FAFB;padding:8px 10px;border-radius:6px;white-space:pre-wrap;word-break:break-word">${esc2(desc)}</div>` : ''}
            ${renderThread(j)}
            ${renderVanDocs(j)}
            ${(!hasThread && j.equipment && (Array.isArray(j.equipment) ? j.equipment.length : Object.keys(j.equipment).length)) ? renderEquipList(j.equipment) : ''}
            ${renderMemos(j)}
          </div>`;
        }).join('') + `</div>`;
      }

      /* ════════════════════════════════════════
         sdv2 — 8탭 카테고리 분류 + 진행 중 리스트
      ════════════════════════════════════════ */
      const sdvDoneFn = (typeof _isJobDone === 'function') ? _isJobDone : () => false;
      const sdvEsc = (typeof esc === 'function') ? esc : (s)=>String(s||'');

      // 카테고리 매핑 — j.lineCategory(LINE 분류) / j.type(jobType) / j.category 종합 판정
      const sdvCatOf = (j) => {
        const lc = String(j.lineCategory || '').toLowerCase();
        const tp = String(j.type || j.category || '').toLowerCase();
        // 소모품
        if (/label|equip_out|delivery|라벨|영수증|프라이스텍|소모품|택배/.test(lc + ' ' + tp)) return 'supplies';
        // VAN 서류
        if (/van_doc|밴서류|van.*신규|van.*재신고|van.*정산|van.*계약|van.*변경/.test(lc + ' ' + tp)) return 'van';
        // 신규 (오픈/프로그램교체/VAN신규)
        if (/open_store|오픈|신규|new_open|newopen/.test(lc + ' ' + tp)) return 'new';
        // 매장이탈
        if (/churn|폐업|매각|해지|이탈/.test(lc + ' ' + tp)) return 'churn';
        // AS / 단말기 (POS/VAN A/S, 단말기관리)
        if (/pos_as|van_as|device_mgmt|as_pos|단말|a\/s|as\s|에이에스/.test(lc + ' ' + tp)) return 'as';
        return 'as'; // 기본값 — 미분류는 AS 로
      };

      const sdvCatLabel = {
        new:      { tag:'🆕 신규',    color:'new' },
        as:       { tag:'🔧 AS',      color:'as' },
        van:      { tag:'📑 VAN',     color:'van' },
        supplies: { tag:'🏷️ 소모품',  color:'supplies' },
        churn:    { tag:'🏪 이탈',    color:'churn' },
      };

      const groups = { ongoing:[], new:[], as:[], van:[], supplies:[], churn:[] };
      matched.forEach(j => {
        const cat = sdvCatOf(j);
        // 진행 중 탭 — AS/신규는 미완료 ROOT 마다 1건씩 노출, 그 외는 job 단위
        if (cat === 'as' || cat === 'new') {
          const th = Array.isArray(j.thread) ? j.thread : [];
          const incompleteRoots = th.filter(e => e && e.parentId === null)
            .filter(r => !th.some(c => c && c.parentId === r.threadId && c.status === '완료'));
          if (incompleteRoots.length > 0) {
            incompleteRoots.forEach(r => groups.ongoing.push({ j, cat, r }));
          } else if (!sdvDoneFn(j) && th.filter(e => e && e.parentId === null).length === 0) {
            // thread 가 비어 있는 미완료 job (legacy) — job 단위로 표시
            groups.ongoing.push({ j, cat });
          }
        } else if (!sdvDoneFn(j)) {
          groups.ongoing.push({ j, cat });
        }
        groups[cat] = groups[cat] || [];
        groups[cat].push(j);
      });

      const sdvJobCard = (j, cat, root) => {
        const meta = sdvCatLabel[cat] || sdvCatLabel.as;
        const done = sdvDoneFn(j);
        const lineTag = j.lineCategory && (typeof LINE_TYPE_META !== 'undefined') ? (LINE_TYPE_META[j.lineCategory]?.label || j.lineCategory) : '';

        // root 가 주어지면 — 요청접수 ROOT 단위 표시 (AS/신규의 진행 중 탭에서 활용)
        let titleHtml, metaHtml, whenBadge;
        if (root) {
          const txt = (root.text || '').replace(/\s+/g,' ').slice(0, 90);
          titleHtml = sdvEsc(txt || '(내용 없음)');
          const author = root.author || '';
          const ts = root.ts || '';
          metaHtml = `${ts ? '📅 '+sdvEsc(ts)+' · ' : ''}${author?sdvEsc(author):''}`;
          // ROOT 의 진행 상태 — 자식 중 완료 여부
          const th = j.thread || [];
          const kids = th.filter(e => e && e.parentId === root.threadId);
          const rootDone = kids.some(e => e.status === '완료');
          const rootProg = kids.some(e => e.status === '진행');
          whenBadge = rootDone
            ? `<div class="when done">완료</div>`
            : (rootProg ? `<div class="when">진행 중</div>` : `<div class="when">요청접수</div>`);
        } else {
          const date = j.date || (j.createdAt ? new Date(j.createdAt).toISOString().slice(0,10) : '');
          const who = j.engineer || j.assignee || '';
          const memos = Array.isArray(j.memos) ? j.memos.length : 0;
          // 요청 내용 추출 — thread 의 최근 ROOT > asRequest > notes > description > lineParsed > memos[0]
          let reqText = '';
          if (Array.isArray(j.thread) && j.thread.length) {
            const roots = j.thread.filter(e => e && e.parentId === null);
            if (roots.length) {
              const sorted = roots.slice().sort((a,b) => String(b.ts||'').localeCompare(String(a.ts||'')));
              reqText = (sorted[0].text || '').trim();
            }
          }
          if (!reqText) reqText = (j.asRequest || j.notes || j.description || j.lineParsed || (j.memos && j.memos[0] && j.memos[0].text) || '').trim();
          // VAN 작업의 등록 요약 fallback (vanRegistration 가 있고 thread 없을 때)
          if (!reqText && j.vanRegistration) {
            const vr = j.vanRegistration;
            const parts = [];
            if (vr.vans && vr.vans.length) parts.push('📡 '+vr.vans.map(v=>v.brand).join(','));
            if (vr.pay && vr.pay.length) parts.push('📱 '+vr.pay.map(p=>p.brand).join(','));
            if (vr.cardAcquire && (vr.cardAcquire.applyDate || vr.cardAcquire.completeDate)) parts.push('💳 카드사가맹');
            reqText = parts.join(' · ');
          }
          // 우선순위: 요청 내용 > title > type (type 은 이미 카테고리 태그에 표시되므로 마지막)
          const typeFallback = (j.title || j.type || '업무').replace(/\s+/g,' ').slice(0, 120);
          const displayText = reqText ? reqText.replace(/\s+/g,' ').slice(0, 120) : typeFallback;
          titleHtml = sdvEsc(displayText);
          const rootCount = Array.isArray(j.thread) ? j.thread.filter(e=>e&&e.parentId===null).length : 0;
          const metaTypeLabel = (reqText && j.type && j.type !== reqText.slice(0,j.type.length)) ? `<span style="color:var(--gray-400);margin-right:6px">${sdvEsc(j.type)}</span>` : '';
          metaHtml = `${metaTypeLabel}${date ? '📅 '+date+' · ' : ''}${who?who+' · ':''}${rootCount?'요청 '+rootCount+'건 · ':''}${memos?'메모 '+memos+'건':''}`;
          if (done) {
            whenBadge = `<div class="when done">완료</div>`;
          } else {
            const sched = j.scheduleDate || j.date;
            if (sched) {
              const today = new Date(); today.setHours(0,0,0,0);
              const tgt = new Date(sched + 'T00:00:00');
              const diff = Math.round((tgt - today)/86400000);
              const txt = diff < 0 ? `D+${-diff}` : diff === 0 ? 'D-Day' : `D-${diff}`;
              const urgent = diff <= 2 && diff >= -3;
              whenBadge = `<div class="when ${urgent?'urgent':''}">${txt}</div>`;
            } else {
              whenBadge = `<div class="when">진행중</div>`;
            }
          }
        }

        const onclick = j.id ? `try{editNewopen('${sdvEsc(j.id)}')}catch(e){}` : '';
        const moveBtn = (j.id && !root) ? `<button type="button" title="카테고리 이동" onclick="event.stopPropagation();promptMoveJobCategory(event,'${sdvEsc(j.id)}')" style="background:transparent;border:1px solid var(--gray-300,#d1d5db);border-radius:6px;padding:2px 7px;font-size:12px;cursor:pointer;color:var(--gray-600,#4b5563);margin-right:6px">📂</button>` : '';
        return `<div class="sdv2-jobcard cat-${meta.color}" ${onclick?`onclick="${onclick}"`:''}>
          <div class="left">
            <span class="cat-tag ${meta.color}">${meta.tag}</span>
            ${lineTag ? `<span style="font-size:10px;color:var(--gray-500);font-weight:700">${sdvEsc(lineTag)}</span>` : ''}
            <div class="title">${titleHtml}</div>
            <div class="meta">${metaHtml}</div>
          </div>
          <div style="display:flex;align-items:center">${moveBtn}${whenBadge}</div>
        </div>`;
      };

      const sdvFill = (elId, jobs, cat) => {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!jobs || jobs.length === 0) {
          el.innerHTML = `<div class="sdv2-empty"><div class="ico">📭</div>등록된 업무가 없습니다</div>`;
          return;
        }
        el.innerHTML = jobs.map(j => sdvJobCard(j, cat || sdvCatOf(j))).join('');
      };

      // AS 탭 전용 — 모든 ROOT(요청접수) 를 매장 단위로 통합 표시
      // 노출 규칙:
      //  · 미완료 ROOT 는 전부 표시 (개수 무제한)
      //  · 미완료가 5건 미만이면 모자란 자리에 최근 완료 ROOT 채워 최대 5건
      //  · 모두 완료라면 최근 5건만, 전체보기 버튼으로 펼침
      const _sdvFillAsRootList = function(elId, asJobs) {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!asJobs || asJobs.length === 0) {
          el.innerHTML = `<div class="sdv2-empty"><div class="ico">📭</div>AS 이력이 없습니다</div>`;
          return;
        }
        // 모든 AS job 의 ROOT 모으기 — 각 ROOT 에 parent job 참조
        const allRoots = [];
        asJobs.forEach(j => {
          const th = Array.isArray(j.thread) ? j.thread : [];
          th.filter(e => e && e.parentId === null).forEach(r => {
            const isDone = th.some(e => e && e.parentId === r.threadId && e.status === '완료');
            const doneEntry = isDone ? th.filter(e => e && e.parentId === r.threadId && e.status === '완료').slice(-1)[0] : null;
            const lastChild = th.filter(e => e && e.parentId === r.threadId).slice(-1)[0];
            allRoots.push({ j, r, isDone, doneAt: doneEntry?.ts || lastChild?.ts || r.ts || '' });
          });
        });
        if (allRoots.length === 0) {
          el.innerHTML = `<div class="sdv2-empty"><div class="ico">📭</div>등록된 AS 요청이 없습니다</div>`;
          return;
        }
        const incomplete = allRoots.filter(x => !x.isDone)
          .sort((a,b) => String(b.r.ts||'').localeCompare(String(a.r.ts||'')));
        const completed  = allRoots.filter(x => x.isDone)
          .sort((a,b) => String(b.doneAt||b.r.ts||'').localeCompare(String(a.doneAt||a.r.ts||'')));
        // 노출 규칙 적용
        const MAX = 5;
        let visible = [];
        let hasMore = false;
        if (incomplete.length >= MAX) {
          visible = incomplete;  // 미완료가 많으면 미완료만 (개수 무제한)
        } else {
          visible = incomplete.concat(completed.slice(0, MAX - incomplete.length));
          hasMore = completed.length > (MAX - incomplete.length);
        }
        const cards = visible.map(x => _sdvAsRootCard(x.j, x.r, x.isDone, x.doneAt)).join('');
        const totalIncomplete = incomplete.length;
        const totalCompleted = completed.length;
        const summary = `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;margin-bottom:8px;font-size:11.5px">
          <div style="color:#991B1B;font-weight:700">🔧 AS 이력 — 미완료 ${totalIncomplete} · 완료 ${totalCompleted} · 총 ${allRoots.length}건</div>
          ${hasMore ? `<button type="button" onclick="window._sdvShowAllAs('${esc(asJobs[0]?.storeId||'')}','${esc(asJobs[0]?.storeName||asJobs[0]?.store||'')}')" style="background:#B91C1C;color:#fff;border:none;border-radius:5px;padding:4px 10px;font-size:10.5px;font-weight:800;cursor:pointer">📂 전체보기 (${totalCompleted}건 완료)</button>` : ''}
        </div>`;
        el.innerHTML = summary + cards;
      };

      // ROOT 카드 — 요청접수 단위 표시
      const _sdvAsRootCard = function(j, r, isDone, doneAt) {
        const meta = isDone
          ? { bg:'#D1FAE5', color:'#065F46', border:'#A7F3D0', icon:'✅', tag:'완료' }
          : { bg:'#DBEAFE', color:'#1E40AF', border:'#BFDBFE', icon:'📥', tag:'요청접수' };
        const txt = (r.text || '').replace(/\s+/g,' ').slice(0,90);
        const onclick = j.id ? `try{editNewopen('${sdvEsc(j.id)}')}catch(e){}` : '';
        return `<div class="sdv2-jobcard" ${onclick?`onclick="${onclick}"`:''} style="border-left:4px solid ${meta.color}">
          <div class="left">
            <span class="cat-tag" style="background:${meta.bg};color:${meta.color}">${meta.icon} ${meta.tag}</span>
            <div class="title" style="${isDone?'opacity:0.7':''}">${sdvEsc(txt || '(내용 없음)')}</div>
            <div class="meta">${r.ts ? '📅 '+sdvEsc(r.ts)+' · ' : ''}${sdvEsc(r.author||'담당자')}${isDone && doneAt ? ' · 완료 '+sdvEsc(doneAt) : ''}</div>
          </div>
          <div class="when ${isDone?'done':''}">${isDone?'완료':'진행중'}</div>
        </div>`;
      };

      // 전체보기 — AS 탭 인라인에서 모든 ROOT 펼침 (페이지 이동 대신 inline expand)
      window._sdvShowAllAs = function(storeId, storeName) {
        // 매장 상세 모달 활성화 상태에서 호출됨
        const el = document.getElementById('detailAsList');
        if (!el) return;
        const allJobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        const classifyFn = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : () => 'as';
        const normFn = (typeof _normStoreKey === 'function') ? _normStoreKey : (s => String(s||'').toLowerCase().replace(/\s+/g,''));
        const target = normFn(storeName||'');
        const asJobs = allJobs.filter(j => {
          if (classifyFn(j) !== 'as') return false;
          if (storeId && j.storeId === storeId) return true;
          const sn = (j.storeName || j.store || '');
          return sn && normFn(sn) === target;
        });
        const allRoots = [];
        asJobs.forEach(j => {
          const th = Array.isArray(j.thread) ? j.thread : [];
          th.filter(e => e && e.parentId === null).forEach(r => {
            const isDone = th.some(e => e && e.parentId === r.threadId && e.status === '완료');
            const doneEntry = isDone ? th.filter(e => e && e.parentId === r.threadId && e.status === '완료').slice(-1)[0] : null;
            allRoots.push({ j, r, isDone, doneAt: doneEntry?.ts || '' });
          });
        });
        // 미완료 먼저 (최신순), 완료 (최신순)
        const incomplete = allRoots.filter(x => !x.isDone).sort((a,b) => String(b.r.ts||'').localeCompare(String(a.r.ts||'')));
        const completed = allRoots.filter(x => x.isDone).sort((a,b) => String(b.doneAt||b.r.ts||'').localeCompare(String(a.doneAt||a.r.ts||'')));
        const all = incomplete.concat(completed);
        const summary = `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;margin-bottom:8px;font-size:11.5px">
          <div style="color:#991B1B;font-weight:700">🔧 AS 전체 이력 — 미완료 ${incomplete.length} · 완료 ${completed.length} · 총 ${all.length}건</div>
          <button type="button" onclick="window._sdvAsRefresh('${esc(storeId||'')}','${esc(storeName||'')}')" style="background:#fff;color:#B91C1C;border:1px solid #B91C1C;border-radius:5px;padding:3px 10px;font-size:10.5px;font-weight:700;cursor:pointer">⏎ 최근 5건만 보기</button>
        </div>`;
        el.innerHTML = summary + all.map(x => _sdvAsRootCard(x.j, x.r, x.isDone, x.doneAt)).join('');
      };
      window._sdvAsRefresh = function(storeId, storeName) {
        // 모달을 다시 열어 기본 5건 보기로 복귀
        if (storeId && typeof window._hubOpenStoreById === 'function') {
          window._hubOpenStoreById(storeId);
        } else {
          // storeId 없으면 그냥 5건 뷰로 재렌더 — 현재 매장 컨텍스트 사용
          // (간단 처리: 모달 닫기)
          try { document.getElementById('storeDetailModal')?.classList?.remove('show'); } catch(e){}
        }
      };

      // 진행 중
      const ongEl = document.getElementById('detailOngoingList');
      if (ongEl) {
        if (groups.ongoing.length === 0) {
          ongEl.innerHTML = `<div class="sdv2-empty"><div class="ico">✅</div>현재 진행 중인 업무가 없습니다</div>`;
        } else {
          ongEl.innerHTML = groups.ongoing.map(({j, cat, r}) => sdvJobCard(j, cat, r)).join('');
        }
      }
      const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      // ROOT(요청접수) 단위 카운트 헬퍼 — AS / 신규처럼 thread 그룹 사용 카테고리
      const _countRoots = (jobs) => jobs.reduce((s, j) => s + ((j.thread||[]).filter(e => e && e.parentId === null).length), 0);
      const _countIncompleteRoots = (jobs) => jobs.reduce((s, j) => {
        const th = j.thread || [];
        const roots = th.filter(e => e && e.parentId === null);
        const inc = roots.filter(r => !th.some(e => e && e.parentId === r.threadId && e.status === '완료'));
        return s + inc.length;
      }, 0);
      // 진행 중 — ROOT 단위 (job 단위 + 진행 중 ROOT 합산)
      const onAs = (groups.as||[]).concat(groups.churn||[]);
      const onNew = (groups.new||[]);
      const asRootIncomplete = _countIncompleteRoots(onAs);
      const newRootIncomplete = _countIncompleteRoots(onNew);
      const onTotal = groups.ongoing.length;  // job 단위 진행중
      // 진행 중 탭 표시 — job 단위가 아니라 ROOT 단위로 (AS+신규는 ROOT, 그 외는 job)
      const ongoingRootSum = asRootIncomplete + newRootIncomplete
        + (groups.van||[]).filter(j => !sdvDoneFn(j)).length
        + (groups.supplies||[]).filter(j => !sdvDoneFn(j)).length;
      setText('detailOngoingCount', ongoingRootSum || onTotal);
      setText('sdv2CntOngoing', ongoingRootSum || onTotal);
      // 카테고리 탭 — AS/신규는 ROOT 총합 / 나머지는 job 갯수
      setText('sdv2CntNew', _countRoots(onNew) || onNew.length);
      setText('sdv2CntAs', _countRoots(onAs) || onAs.length);
      setText('sdv2CntVan', (groups.van||[]).length);
      setText('sdv2CntLog', matched.length);
      setText('sdv2CntSupplies', (groups.supplies||[]).length);

      // 진행 중 탭 urgent 표시
      const ongTab = document.querySelector('.sdv2-tab[data-pane="ongoing"]');
      if (ongTab) ongTab.classList.toggle('urgent', groups.ongoing.length > 0);

      // 카테고리 탭 — AS 탭은 요청접수 ROOT 단위로 렌더 (매장의 모든 AS 이력 표시)
      sdvFill('detailNewList', groups.new||[], 'new');
      _sdvFillAsRootList('detailAsList', [...(groups.as||[]), ...(groups.churn||[])]);
      sdvFill('detailVanList', groups.van||[], 'van');
      // VAN/간편결제 프로필 렌더 (store.vanProfile / payProfile)
      try {
        const vpEl = document.getElementById('detailVanProfile');
        if (vpEl) {
          const vp = (store && store.vanProfile) || {};
          const pp = (store && store.payProfile) || {};
          const vBrands = ['KOCES','NICE','KIS','KSNET'].filter(b => vp[b] && vp[b].tid);
          const pBrands = Object.keys(pp).filter(b => pp[b] && pp[b].tid);
          if (vBrands.length === 0 && pBrands.length === 0) {
            vpEl.innerHTML = '';
          } else {
            const fmtTs = (t) => t ? new Date(t).toLocaleDateString('ko-KR') : '';
            const vCards = vBrands.map(b => {
              const e = vp[b];
              return `<div style="background:#fff;border:1px solid #BFDBFE;border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                <div><span style="font-weight:700;color:#1d4ed8;font-size:12.5px">${b}</span> <span style="font-size:11px;color:var(--gray-500)">${fmtTs(e.updatedAt)}</span></div>
                <div style="font-family:monospace;font-size:12px;color:var(--gray-700)">TID: <b>${(e.tid||'').replace(/[<>&]/g,'')}</b>${e.serial?` · SN: <b>${(e.serial||'').replace(/[<>&]/g,'')}</b>`:''}</div>
              </div>`;
            }).join('');
            const pCards = pBrands.map(b => {
              const e = pp[b];
              return `<div style="background:#fff;border:1px solid #FCD34D;border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                <div><span style="font-weight:700;color:#92400E;font-size:12.5px">${b}</span> <span style="font-size:11px;color:var(--gray-500)">${fmtTs(e.updatedAt)}</span></div>
                <div style="font-family:monospace;font-size:12px;color:var(--gray-700)">TID: <b>${(e.tid||'').replace(/[<>&]/g,'')}</b></div>
              </div>`;
            }).join('');
            vpEl.innerHTML = `
              <div style="background:#F9FAFB;border:1px solid var(--gray-200);border-radius:10px;padding:10px 12px">
                <div style="font-size:12px;font-weight:700;color:var(--gray-800);margin-bottom:8px">📡 등록된 VAN / 간편결제 프로필</div>
                ${vBrands.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:${pBrands.length?'8px':'0'}">${vCards}</div>` : ''}
                ${pBrands.length ? `<div style="display:flex;flex-direction:column;gap:6px">${pCards}</div>` : ''}
              </div>`;
          }
        }
      } catch(e){}
      sdvFill('detailSuppliesList', groups.supplies||[], 'supplies');

      /* ── 계약 완료 토글 바인딩 ── */
      (function bindContractToggle(){
        const chk = document.getElementById('detailContractCheck');
        const lab = document.getElementById('detailContractLabel');
        const sub = document.getElementById('detailContractSub');
        if (!chk) return;
        const isDone = !!(store && store.contractCompleted);
        chk.checked = isDone;
        chk.disabled = false;
        lab.textContent = isDone ? '✅ 완료' : '미완료';
        lab.style.color = isDone ? '#10B981' : 'var(--gray-700)';
        if (isDone && store.contractCompletedAt) {
          sub.textContent = `완료: ${store.contractCompletedAt}${store.contractCompletedBy ? ' · ' + store.contractCompletedBy : ''}`;
        }
        chk.onchange = function() {
          if (chk.checked) {
            if (!confirm('계약 완료로 표시하고 신규 일정에 "계약서 작성 완료"를 추가하시겠습니까?')) {
              chk.checked = false;
              return;
            }
            const now = (typeof _kstDateTimeStr === 'function') ? _kstDateTimeStr() : new Date().toISOString().slice(0,16).replace('T',' ');
            const today = (typeof _kstDateStr === 'function') ? _kstDateStr() : new Date().toISOString().slice(0,10);
            const by = (typeof _currentAuthName === 'function') ? _currentAuthName() : '';
            // 1) store 플래그 설정
            store.contractCompleted = true;
            store.contractCompletedAt = now;
            store.contractCompletedBy = by;
            if (typeof saveStoreInPlace === 'function') saveStoreInPlace(store);
            // 2) 신규 일정에 완료 항목 추가 (ns_jobs)
            try {
              const arr = (typeof getJobs === 'function') ? (getJobs() || []) : [];
              const newJob = {
                id: 'CONTRACT-' + Date.now().toString().slice(-9),
                type: '신규/계약 완료',
                lineCategory: 'open_store',
                title: '계약서 작성 완료',
                storeName: store.name,
                storeId: store.id,
                date: today,
                createdAt: Date.now(),
                completed: true,
                doneAt: now,
                engineer: by,
                description: '계약 완료 처리',
              };
              arr.unshift(newJob);
              if (typeof saveJobs === 'function') saveJobs(arr);
            } catch(e) { console.warn('[contract] 일정 추가 실패', e); }
            // 3) UI 갱신
            lab.textContent = '✅ 완료';
            lab.style.color = '#10B981';
            sub.textContent = `완료: ${now}${by ? ' · ' + by : ''}`;
            if (typeof showToast === 'function') showToast('✅ 계약 완료 처리 — 신규 일정에 추가되었습니다');
            // 매장 상세 다시 그리기 (새 job 도 반영되도록)
            setTimeout(() => { try { reopenStoreDetail(); } catch(e) {} }, 200);
          } else {
            if (!confirm('계약 완료 표시를 해제하시겠습니까?\n(추가된 일정은 별도로 삭제해야 합니다)')) {
              chk.checked = true;
              return;
            }
            store.contractCompleted = false;
            delete store.contractCompletedAt;
            delete store.contractCompletedBy;
            if (typeof saveStoreInPlace === 'function') saveStoreInPlace(store);
            lab.textContent = '미완료';
            lab.style.color = 'var(--gray-700)';
            sub.textContent = '체크 시 매장의 신규 일정에 "계약서 작성 완료" 항목이 완료 상태로 추가됩니다';
          }
        };
      })();

      /* ── 작업 메모 (해당 매장 관련 모든 작업의 메모 수집) ── */
      const memoListEl = document.getElementById('detailMemoList');
      const memoCountEl = document.getElementById('detailMemoCount');
      // 🔴 AS/VAN 의 j.notes 는 '요청문 미러'(thread 중복 — AS 저장 시 notes=asRequest 복제, 검색/AS관리 호환용)라
      //    매장상세 메모탭에 '비고'로 노출하면 매장 메모가 AS/VAN 요청 내용으로 오염됨(요청 삭제·완료 후에도 잔존).
      //    → 신규/소모품의 사용자 직접 입력 비고만 매장 메모로 표시. (2026-06-12 오염 fix)
      window._notesIsGenuineStoreMemo = function(j){
        const n = String((j && j.notes) || '').trim();
        if (!n) return false;
        let c = '';
        try { c = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : ''; } catch(_){}
        if (c === 'as' || c === 'van') return false;                       // 요청/비고 미러 — 매장 메모 아님
        if (n === String((j && j.asRequest) || '').trim()) return false;   // 요청문 중복 방어(구 데이터)
        return true;
      };
      // 메모 탭 재렌더 함수 — 외부에서도 호출 가능하게 만들기
      window.renderStoreDetailMemos = function(curStore) {
        const st = curStore || store;
        if (!memoListEl) return;
        const flatMemos2 = [];
        // 매장 일반 메모 (store.storeMemos)
        if (Array.isArray(st && st.storeMemos)) {
          st.storeMemos.forEach(m => flatMemos2.push({
            at: m.at || '', author: m.by || m.author || '', text: String(m.text||''),
            jobType: '매장 메모', jobId: null, isNotes: false, isStoreMemo: true,
          }));
        }
        matched.forEach(j => {
          if (window._notesIsGenuineStoreMemo(j)) {
            flatMemos2.push({ at: j.createdAt ? new Date(j.createdAt).toISOString().slice(0,16).replace('T',' ') : '', author: '', text: String(j.notes).trim(), jobType: j.type || '작업', jobId: j.id, isNotes: true });
          }
          if (Array.isArray(j.memos)) {
            j.memos.forEach(m => flatMemos2.push({ at: m.at || '', author: m.author || '', text: String(m.text || ''), jobType: j.type || '작업', jobId: j.id, isNotes: false }));
          }
        });
        flatMemos2.sort((a,b) => (b.at || '').localeCompare(a.at || ''));
        if (memoCountEl) memoCountEl.textContent = flatMemos2.length ? `${flatMemos2.length}건` : '';
        const memoCntTab2 = document.getElementById('sdv2CntMemo');
        if (memoCntTab2) memoCntTab2.textContent = flatMemos2.length;
        if (flatMemos2.length === 0) {
          memoListEl.innerHTML = `<div style="padding:24px 8px;text-align:center;color:var(--gray-400);font-size:12px"><div style="font-size:28px;margin-bottom:8px">🗒</div><div>등록된 메모가 없습니다.</div></div>`;
        } else {
          const escFn2 = (typeof esc === 'function') ? esc : (s)=>String(s||'');
          memoListEl.innerHTML = flatMemos2.map(m => `
            <div style="border:1px solid var(--gray-200);border-left:3px solid ${m.isStoreMemo ? '#3b82f6' : (m.isNotes ? '#9ca3af' : '#fbbf24')};border-radius:8px;padding:8px 12px;background:${m.isStoreMemo ? '#eff6ff' : (m.isNotes ? '#F9FAFB' : '#FFFDF7')};cursor:${m.jobId?'pointer':'default'}"
                 ${m.jobId ? `onclick="closeModal('storeDetailModal');setTimeout(()=>{try{editNewopen('${escFn2(m.jobId)}')}catch(e){}}, 100)" title="해당 작업 상세로 이동"` : ''}>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;font-size:11px;color:var(--gray-500)">
                <div><span style="background:${m.isStoreMemo?'#dbeafe':'#EFF6FF'};color:${m.isStoreMemo?'#1e40af':'#1D4ED8'};font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px">${escFn2(m.jobType)}</span></div>
                <div>${escFn2(m.at)}${m.author ? ` · ${escFn2(m.author)}` : ''}</div>
              </div>
              <div style="font-size:12.5px;color:var(--gray-700);white-space:pre-wrap">${escFn2(m.text)}</div>
            </div>`).join('');
        }
      };

      if (memoListEl) {
        const flatMemos = [];
        // 매장 일반 메모 (store.storeMemos)
        if (Array.isArray(store && store.storeMemos)) {
          store.storeMemos.forEach(m => flatMemos.push({
            at: m.at || '', author: m.by || m.author || '', text: String(m.text||''),
            jobType: '매장 메모', jobId: null, isNotes: false, isStoreMemo: true,
          }));
        }
        matched.forEach(j => {
          // 비고(notes) 본문도 메모처럼 표시 — 단 AS/VAN 요청 미러는 제외(매장 메모 오염 방지)
          if (window._notesIsGenuineStoreMemo(j)) {
            flatMemos.push({
              at: j.createdAt ? new Date(j.createdAt).toISOString().slice(0,16).replace('T',' ') : '',
              author: '',
              text: String(j.notes).trim(),
              jobType: j.type || '작업',
              jobId: j.id,
              isNotes: true,
            });
          }
          // 누적 메모 (j.memos 배열)
          if (Array.isArray(j.memos)) {
            j.memos.forEach(m => {
              flatMemos.push({
                at: m.at || '',
                author: m.author || '',
                text: String(m.text || ''),
                jobType: j.type || '작업',
                jobId: j.id,
                isNotes: false,
              });
            });
          }
        });
        // 최신순 정렬 (at 문자열 비교 — 'YY.MM.DD HH:mm' / 'YYYY-MM-DD HH:mm' 모두 정렬 가능)
        flatMemos.sort((a,b) => (b.at || '').localeCompare(a.at || ''));
        if (memoCountEl) memoCountEl.textContent = flatMemos.length ? `${flatMemos.length}건` : '';
        // 메모 탭 카운트
        const memoCntTab = document.getElementById('sdv2CntMemo');
        if (memoCntTab) memoCntTab.textContent = flatMemos.length;
        if (flatMemos.length === 0) {
          memoListEl.innerHTML = `<div style="padding:24px 8px;text-align:center;color:var(--gray-400);font-size:12px">
            <div style="font-size:28px;margin-bottom:8px">🗒</div>
            <div>등록된 작업 메모가 없습니다.</div>
            <div style="margin-top:4px;font-size:11px">매장 상세에서 메모를 추가하면 여기에 모입니다.</div>
          </div>`;
        } else {
          const escFn = (typeof esc === 'function') ? esc : (s)=>String(s||'');
          memoListEl.innerHTML = flatMemos.map(m => `
            <div style="border:1px solid var(--gray-200);border-left:3px solid ${m.isStoreMemo ? '#3b82f6' : (m.isNotes ? '#9ca3af' : '#fbbf24')};border-radius:8px;padding:8px 12px;background:${m.isStoreMemo ? '#eff6ff' : (m.isNotes?'#F9FAFB':'#FFFDF7')};cursor:${m.jobId?'pointer':'default'}"
                 ${m.jobId ? `onclick="closeModal('storeDetailModal');setTimeout(()=>{try{editNewopen('${escFn(m.jobId)}')}catch(e){}}, 100)" title="해당 작업 상세로 이동"` : ''}>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px;font-size:11px;color:var(--gray-500)">
                <div>
                  <span style="background:${m.isStoreMemo?'#dbeafe':'#EFF6FF'};color:${m.isStoreMemo?'#1e40af':'#1D4ED8'};font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px">${escFn(m.jobType)}</span>
                  ${m.isNotes ? '<span style="margin-left:4px;color:var(--gray-400)">비고</span>' : ''}
                </div>
                <div>${escFn(m.at)}${m.author ? ` · ${escFn(m.author)}` : ''}</div>
              </div>
              <div style="font-size:12.5px;color:var(--gray-700);white-space:pre-wrap">${escFn(m.text)}</div>
            </div>`).join('');
        }
      }
    }

    /* ── 정보 변경 이력 (changeLog) 렌더 ── */
    const clCard = document.getElementById('detailChangeLogCard');
    const clList = document.getElementById('detailChangeLogList');
    const clCount = document.getElementById('detailChangeCount');
    const log = (store && Array.isArray(store.changeLog)) ? store.changeLog : [];
    if (clCard && clList) {
      if (log.length === 0) {
        clCard.style.display = 'none';
      } else {
        clCard.style.display = '';
        if (clCount) clCount.textContent = `${log.length}건`;
        const escFn = (typeof esc === 'function') ? esc : (s)=>String(s||'');
        const sorted = log.slice().sort((a,b) => (b.at||'').localeCompare(a.at||''));
        const survivorIdLocal = store ? store.id : '';
        clList.innerHTML = sorted.map((l, sortedIdx) => {
          // 원본 인덱스 — undo 호출 시 필요
          const origIdx = log.indexOf(l);
          const diff = [];
          const before = l.from || {};
          const after  = l.to   || {};
          const labels = { name:'상호', storeName:'상호', signageName:'간판명', biz:'사업자', bizno:'사업자', ceo:'대표자', ceoTel:'대표자 연락처', addr:'주소', address:'주소', tel:'연락처', phone:'연락처', van:'VAN' };
          // from/to 에 실제 존재하는 모든 키를 표시 (고정 목록 X → signageName/ceoTel 등도 노출)
          Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).forEach(k => {
            if ((before[k]||'') !== (after[k]||'') && (before[k] || after[k])) {
              diff.push(`<div style="font-size:11px;color:var(--gray-700)"><b>${labels[k]||k}</b>: <span style="color:var(--gray-400);text-decoration:line-through">${escFn(before[k]||'-')}</span> → <span style="color:var(--success);font-weight:700">${escFn(after[k]||'-')}</span></div>`);
            }
          });
          const isMerge = l.type === '매장 병합';
          const canUndo = isMerge && l.mergedSnapshot && !l._undone;
          const undoneTag = l._undone ? '<span style="margin-left:6px;background:var(--gray-200);color:var(--gray-600);font-size:10px;padding:1px 6px;border-radius:4px">취소됨</span>' : '';
          const actionBtns = canUndo
            ? `<div style="margin-top:8px;display:flex;justify-content:flex-end">
                 <button class="btn btn-outline btn-sm" style="font-size:11px;padding:4px 10px;color:var(--warning);border-color:var(--warning);font-weight:700" onclick="confirmUndoStoreMerge('${escFn(survivorIdLocal)}',${origIdx})">↶ 병합 취소</button>
               </div>`
            : '';
          return `<div style="border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;background:${l._undone?'#F9FAFB':'#FFFDF7'};${l._undone?'opacity:0.7':''}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px">
              <div><span style="background:#7C3AED;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px">${escFn(l.type || '변경')}</span>${undoneTag}</div>
              <span style="font-size:11px;color:var(--gray-500)">${escFn(l.at||'')}${l.by?` · ${escFn(l.by)}`:''}</span>
            </div>
            ${diff.length ? `<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:6px">${diff.join('')}</div>` : ''}
            ${l.note ? `<div style="font-size:11.5px;color:var(--gray-600);background:#fff;padding:6px 8px;border-radius:6px;border:1px dashed var(--gray-200)">📝 ${escFn(l.note)}</div>` : ''}
            ${actionBtns}
          </div>`;
        }).join('');
      }
    }

    /* ── 정보 변경 / 매장 병합 버튼 바인딩 ── */
    const changeBtn = document.getElementById('storeDetailChangeBtn');
    const mergeBtn  = document.getElementById('storeDetailMergeBtn');
    if (changeBtn) changeBtn.onclick = () => openStoreChangeDialog(store ? store.id : null, store);
    if (mergeBtn)  mergeBtn.onclick  = () => openStoreMergeDialog(store ? store.id : null, store);

    // 상세 모달로 표시 (스크롤 대신 팝업)
    // sdv2 — 첫 탭(진행 중)으로 초기화
    try {
      const tabs = document.querySelectorAll('#storeDetailTabbar .sdv2-tab');
      const panes = document.querySelectorAll('#storeDetailModal .sdv2-pane');
      tabs.forEach(t => t.classList.toggle('active', t.dataset.pane === 'ongoing'));
      panes.forEach(p => p.classList.toggle('active', p.dataset.pane === 'ongoing'));
    } catch(e) {}

    if (typeof showModal === 'function') showModal('storeDetailModal');
  };

  /* sdv2 — 탭 클릭 전환 (한 번만 바인딩) */
  (function bindStoreDetailTabs(){
    const tabbar = document.getElementById('storeDetailTabbar');
    if (!tabbar || tabbar._sdv2Bound) return;
    tabbar._sdv2Bound = true;
    tabbar.addEventListener('click', (ev) => {
      const t = ev.target.closest('.sdv2-tab');
      if (!t) return;
      const key = t.dataset.pane;
      const tabs = tabbar.querySelectorAll('.sdv2-tab');
      const panes = document.querySelectorAll('#storeDetailModal .sdv2-pane');
      tabs.forEach(x => x.classList.toggle('active', x === t));
      panes.forEach(p => p.classList.toggle('active', p.dataset.pane === key));
      const body = document.querySelector('#storeDetailModal .sdv2-body');
      if (body) body.scrollTop = 0;
    });
  })();

