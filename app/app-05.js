  /* ══════════════════════════════════════════════
     📢 공지사항 (Notices)
     ─────────────────────────────────────────────
     - 대시보드 상단 2건 미리보기
     - 전체 보기 / 작성 / 상세 보기 / 삭제
     - 이미지/동영상 자동 표시
  ══════════════════════════════════════════════ */
  let _noticesCache = [];
  let _currentNoticeId = null;

  async function loadNotices() {
    try {
      const r = await fetch('/api/notices');
      const d = await r.json();
      _noticesCache = Array.isArray(d.items) ? d.items : [];
    } catch(e) {
      _noticesCache = [];
    }
    renderDashboardNotices();
  }
  window.loadNotices = loadNotices;

  function renderDashboardNotices() {
    const el = document.getElementById('dashNoticesBody');
    if (!el) return;
    const top2 = _noticesCache.slice(0, 2);
    // 🛡 어른거림 방지 — 공지 동일하면 재구축 skip
    if (window._sigSkip && window._sigSkip(el, 'notices|' + JSON.stringify(top2.map(n=>[n.id,n.createdAt||'',n.title||'',n.fileCount||0,n.hasVideo?1:0,n.hasImage?1:0])))) return;
    if (!top2.length) {
      el.innerHTML = `<div style="padding:18px 18px;color:var(--gray-400);font-size:12px;text-align:center">
        📭 등록된 공지가 없습니다 — [✏️ 작성] 으로 첫 공지를 등록하세요
      </div>`;
      return;
    }
    el.innerHTML = top2.map(n => {
      const date = (n.createdAt||'').slice(0,10);
      const time = (n.createdAt||'').slice(11,16);
      const mediaTag = n.hasVideo ? '🎬' : (n.hasImage ? '🖼' : '');
      const fileTag = n.fileCount > 0 ? `📎 ${n.fileCount}` : '';
      return `<div onclick="openNoticeDetail('${esc(n.id)}')"
                   style="padding:12px 18px;border-bottom:1px solid var(--gray-100);cursor:pointer;transition:background 0.15s"
                   onmouseover="this.style.background='#FAF5FF'"
                   onmouseout="this.style.background=''">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:13px;font-weight:700;color:var(--gray-900);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title||'(제목 없음)')}</span>
          ${mediaTag ? `<span style="font-size:13px">${mediaTag}</span>` : ''}
          ${fileTag ? `<span style="font-size:10px;color:var(--gray-500);font-weight:600">${fileTag}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--gray-500)">
          <span>${esc(n.author||'익명')}</span>
          <span style="color:var(--gray-300)">·</span>
          <span>${esc(date)}${time?' '+esc(time):''}</span>
          ${n.excerpt ? `<span style="color:var(--gray-300)">·</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.excerpt)}</span>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  window.renderDashboardNotices = renderDashboardNotices;

  /* 전체 보기 모달 */
  async function openNoticeList() {
    closeModal('noticeDetailModal');
    if (!_noticesCache.length) await loadNotices();
    const el = document.getElementById('noticeListBody');
    if (!el) return;
    if (!_noticesCache.length) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--gray-400);font-size:13px">📭 등록된 공지가 없습니다</div>`;
    } else {
      el.innerHTML = _noticesCache.map(n => {
        const date = (n.createdAt||'').slice(0,16).replace('T',' ');
        const mediaTag = n.hasVideo ? '🎬 동영상' : (n.hasImage ? '🖼 이미지' : '');
        return `<div onclick="openNoticeDetail('${esc(n.id)}')"
                     style="padding:14px 22px;border-bottom:1px solid var(--gray-100);cursor:pointer;transition:background 0.15s"
                     onmouseover="this.style.background='#FAF5FF'"
                     onmouseout="this.style.background=''">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
            <span style="font-size:14px;font-weight:700;color:var(--gray-900);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.title||'(제목 없음)')}</span>
            ${mediaTag ? `<span style="background:#F3E8FF;color:#5B21B6;font-size:10px;padding:1px 7px;border-radius:8px;font-weight:700">${mediaTag}</span>` : ''}
            ${n.fileCount>0 ? `<span style="font-size:11px;color:var(--gray-500);font-weight:600">📎 ${n.fileCount}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--gray-500)">
            <span>👤 ${esc(n.author||'익명')}</span>
            <span style="color:var(--gray-300)">·</span>
            <span>${esc(date)}</span>
          </div>
          ${n.excerpt ? `<div style="font-size:12px;color:var(--gray-600);margin-top:5px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(n.excerpt)}</div>` : ''}
        </div>`;
      }).join('');
    }
    if (typeof showModal === 'function') showModal('noticeListModal');
  }
  window.openNoticeList = openNoticeList;

  /* 상세 보기 */
  async function openNoticeDetail(id) {
    closeModal('noticeListModal');
    _currentNoticeId = id;
    const titleEl = document.getElementById('noticeDetailTitle');
    const metaEl  = document.getElementById('noticeDetailMeta');
    const bodyEl  = document.getElementById('noticeDetailBody');
    const delBtn  = document.getElementById('noticeDeleteBtn');
    if (titleEl) titleEl.textContent = '⏳ 로딩 중…';
    if (metaEl)  metaEl.textContent = '';
    if (bodyEl)  bodyEl.innerHTML = '';
    if (typeof showModal === 'function') showModal('noticeDetailModal');

    try {
      const r = await fetch('/api/notices?id=' + encodeURIComponent(id));
      if (!r.ok) throw new Error('not found');
      const n = await r.json();
      if (titleEl) titleEl.textContent = n.title || '(제목 없음)';
      const date = (n.createdAt||'').slice(0,16).replace('T',' ');
      const editedTag = n.editedAt ? ` · ✏️ ${(n.editedAt||'').slice(0,10)} 수정` : '';
      if (metaEl) metaEl.textContent = `👤 ${n.author||'익명'} · ${date}${editedTag}`;

      // 본문 + 첨부
      const files = Array.isArray(n.files) ? n.files : [];
      const images = files.filter(f => f.isImage);
      const videos = files.filter(f => f.isVideo);
      const others = files.filter(f => !f.isImage && !f.isVideo);

      // 본문 — XSS 방지를 위해 escape 먼저, 그 다음 URL/이메일 패턴을 <a> 로 변환
      const linkify = (escapedText) => {
        return escapedText
          // http/https URL — 단어 경계에서 시작, 공백·줄바꿈·괄호·꺾쇠 전까지
          .replace(/(\b(?:https?:\/\/|www\.)[^\s<>"')\]]+)/gi, (m) => {
            const href = m.startsWith('www.') ? 'http://' + m : m;
            return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#1D4ED8;text-decoration:underline;word-break:break-all">${m}</a>`;
          })
          // 이메일 — mailto 링크
          .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1" style="color:#1D4ED8;text-decoration:underline">$1</a>');
      };
      const bodyHtml = (n.body || '').split('\n').map(line => linkify(esc(line))).join('<br>');

      let mediaHtml = '';
      if (images.length) {
        mediaHtml += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:14px 0">${
          images.map(f => `<a href="${esc(f.url)}&download=1" target="_blank" style="display:block;border:1px solid var(--gray-200);border-radius:8px;overflow:hidden;background:#000">
            <img src="${esc(f.url)}" alt="${esc(f.name)}" style="width:100%;height:auto;display:block;max-height:400px;object-fit:contain">
          </a>`).join('')
        }</div>`;
      }
      if (videos.length) {
        mediaHtml += `<div style="display:flex;flex-direction:column;gap:12px;margin:14px 0">${
          videos.map(f => `<div style="background:#000;border-radius:8px;overflow:hidden">
            <video controls preload="metadata" style="width:100%;max-height:480px;display:block" src="${esc(f.url)}"></video>
            <div style="padding:8px 12px;color:#fff;font-size:11px;background:rgba(0,0,0,0.6)">🎬 ${esc(f.name)} (${_fmtBytes(f.size)})</div>
          </div>`).join('')
        }</div>`;
      }
      if (others.length) {
        mediaHtml += `<div style="margin-top:14px;padding:12px;background:#F9FAFB;border:1px solid var(--gray-200);border-radius:8px">
          <div style="font-size:11px;font-weight:700;color:var(--gray-700);margin-bottom:8px">📎 첨부 파일</div>
          <div style="display:flex;flex-direction:column;gap:5px">${
            others.map(f => `<a href="${esc(f.url)}&download=1" target="_blank" style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fff;border:1px solid var(--gray-200);border-radius:6px;text-decoration:none;color:var(--gray-700);font-size:12px;font-weight:500">
              <span style="font-size:14px">📄</span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
              <span style="font-size:10px;color:var(--gray-500)">${_fmtBytes(f.size)}</span>
            </a>`).join('')
          }</div>
        </div>`;
      }

      if (bodyEl) {
        bodyEl.innerHTML = `<div style="font-size:14px;line-height:1.7;color:var(--gray-800);white-space:pre-wrap">${bodyHtml}</div>${mediaHtml}`;
      }

      // 삭제 버튼 — 작성자 본인 또는 관리자만 표시 (간단히 항상 노출 + 권한은 서버단에서 막을 수 있음, 일단 노출)
      if (delBtn) {
        const me = _currentUserName();
        delBtn.style.display = (me === n.author || /admin|관리/.test(me)) ? '' : 'none';
      }
    } catch(e) {
      if (titleEl) titleEl.textContent = '⚠️ 공지를 찾을 수 없습니다';
      if (bodyEl)  bodyEl.innerHTML = `<div style="padding:20px;color:var(--danger)">${esc(e.message)}</div>`;
    }
  }
  window.openNoticeDetail = openNoticeDetail;

  /* 작성 모달 열기 */
  function openNoticeWrite() {
    document.getElementById('noticeWriteTitle').value = '';
    document.getElementById('noticeWriteBody').value = '';
    document.getElementById('noticeWriteFiles').value = '';
    document.getElementById('noticeWriteFilesPreview').innerHTML = '';
    if (typeof showModal === 'function') showModal('noticeWriteModal');
    setTimeout(()=>document.getElementById('noticeWriteTitle')?.focus(), 200);
  }
  window.openNoticeWrite = openNoticeWrite;

  /* 파일 선택 미리보기 */
  document.addEventListener('change', (ev) => {
    if (ev.target && ev.target.id === 'noticeWriteFiles') {
      const preview = document.getElementById('noticeWriteFilesPreview');
      if (!preview) return;
      const files = Array.from(ev.target.files || []);
      if (!files.length) { preview.innerHTML = ''; return; }
      preview.innerHTML = files.map(f => {
        const isImg = f.type.startsWith('image/');
        const isVid = f.type.startsWith('video/');
        const icon = isImg ? '🖼' : isVid ? '🎬' : '📄';
        return `<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;background:#F3E8FF;color:#5B21B6;border-radius:14px;font-size:11px;font-weight:600">
          ${icon} ${esc(f.name)} <span style="opacity:.7">(${_fmtBytes(f.size)})</span>
        </div>`;
      }).join('');
    }
  });

  /* 공지 등록 */
  async function submitNotice() {
    const title = document.getElementById('noticeWriteTitle')?.value.trim() || '';
    const body  = document.getElementById('noticeWriteBody')?.value.trim() || '';
    const filesInput = document.getElementById('noticeWriteFiles');
    const files = filesInput ? Array.from(filesInput.files || []) : [];
    if (!title) { showToast('⚠️ 제목을 입력하세요'); return; }
    if (!body && !files.length) { showToast('⚠️ 본문 또는 첨부가 필요합니다'); return; }

    const btn = document.getElementById('noticeWriteSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 업로드 중…'; }

    try {
      const form = new FormData();
      form.append('title', title);
      form.append('body', body);
      form.append('author', _currentUserName());
      for (const f of files) form.append('files', f, f.name);
      const r = await fetch('/api/notices', { method:'POST', body: form });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t);
      }
      const d = await r.json();
      showToast(`✅ 공지 등록됨${d.skipped?` (스킵 ${d.skipped}건)`:''}`);
      closeModal('noticeWriteModal');
      await loadNotices();
      // 작성한 글로 바로 이동
      if (d.id) openNoticeDetail(d.id);
    } catch(e) {
      showToast('❌ ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📢 공지 등록'; }
    }
  }
  window.submitNotice = submitNotice;

  /* 공지 삭제 */
  async function deleteNotice() {
    if (!_currentNoticeId) return;
    if (!confirm('이 공지사항을 삭제하시겠습니까?\n첨부 파일도 함께 삭제됩니다.')) return;
    try {
      const r = await fetch('/api/notices?id=' + encodeURIComponent(_currentNoticeId), { method:'DELETE' });
      if (!r.ok) throw new Error('delete failed');
      showToast('🗑 공지 삭제됨');
      closeModal('noticeDetailModal');
      _currentNoticeId = null;
      await loadNotices();
    } catch(e) {
      showToast('❌ ' + e.message);
    }
  }
  window.deleteNotice = deleteNotice;

  function _fmtBytes(n) {
    n = Number(n||0);
    if (n < 1024) return n + 'B';
    if (n < 1024*1024) return (n/1024).toFixed(1) + 'KB';
    return (n/1024/1024).toFixed(1) + 'MB';
  }

  /* ══════════════════════════════════════════════
     완료된 작업 전체 보기 — 카테고리 탭 + 그리드
  ══════════════════════════════════════════════ */
  // job → 카테고리 코드 추론 (lineCategory 우선, 없으면 type 으로 추론)
  function _doneJobCategory(j) {
    const lc = j.lineCategory;
    if (lc && LINE_TYPE_META[lc]) {
      // as_pos_van 호환
      return lc === 'as_pos_van' ? 'pos_as' : lc;
    }
    const t = (j.type || '') + ' ' + (j.title || '');
    if (/이동단말기|단말기/i.test(t)) return 'device_mgmt';
    if (/VAN|밴|체크기|결제기|IC/i.test(t)) return 'van_as';
    if (/AS|에이에스/i.test(t)) return 'pos_as';
    if (/신규가맹|밴서류|상호변경|주소변경|계좌변경|정보변경|재신고/i.test(t)) return 'van_doc';
    if (/신규|개업|오픈/i.test(t)) return 'open_store';
    if (/라벨/i.test(t)) return 'label';
    if (/택배|배송/i.test(t)) return 'delivery';
    if (/출고|발주|반품|장비/i.test(t)) return 'equip_out';
    return 'other';
  }

  // 탭 정의 — 표시 순서대로
  const _DONE_CAT_TABS = [
    { v:'all',         l:'🔁 전체' },
    { v:'pos_as',      l:'🖥 POS A/S' },
    { v:'van_as',      l:'💳 VAN A/S' },
    { v:'device_mgmt', l:'📱 단말기 A/S' },
    { v:'open_store',  l:'🏪 오픈 작업' },
    { v:'van_doc',     l:'📑 밴서류' },
    { v:'label',       l:'🏷 라벨지' },
    { v:'equip_out',   l:'📦 장비 출고' },
    { v:'delivery',    l:'🚚 택배' },
    { v:'other',       l:'⚪ 기타' },
  ];

  let _doneJobsActiveTab = 'all';
  function openDoneJobsModal(category) {
    _doneJobsActiveTab = category || 'all';
    _renderDoneJobsModal();
    if (typeof showModal === 'function') showModal('doneJobsModal');
  }
  window.openDoneJobsModal = openDoneJobsModal;

  function _renderDoneJobsModal() {
    let jobs = [];
    try { jobs = (typeof getJobs === 'function') ? (getJobs() || []) : []; } catch(e){}
    const doneJobs = jobs.filter(_isJobDone)
      .sort((a,b) => new Date(b.completedAt || b.date || b.createdAt || 0) - new Date(a.completedAt || a.date || a.createdAt || 0));

    // 카테고리별 카운트
    const counts = { all: doneJobs.length };
    for (const j of doneJobs) {
      const c = _doneJobCategory(j);
      counts[c] = (counts[c] || 0) + 1;
    }

    // 탭 렌더
    const tabsEl = document.getElementById('doneJobsTabs');
    if (tabsEl) {
      tabsEl.innerHTML = _DONE_CAT_TABS
        .filter(t => t.v === 'all' || (counts[t.v] || 0) > 0)   // 0건 카테고리는 숨김 (전체는 항상 표시)
        .map(t => {
          const active = t.v === _doneJobsActiveTab;
          const cnt = counts[t.v] || 0;
          const bg = active ? '#1A1614' : '#fff';
          const fg = active ? '#FFF8E7' : 'var(--gray-700)';
          const border = active ? '#1A1614' : 'var(--gray-300)';
          return `<button onclick="setDoneJobsTab('${t.v}')"
                    style="padding:6px 12px;border:1px solid ${border};background:${bg};color:${fg};border-radius:18px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all 0.15s">
                    ${esc(t.l)} <span style="opacity:.7;font-weight:500">${cnt}</span>
                  </button>`;
        }).join('');
    }

    // 그리드 렌더
    const gridEl = document.getElementById('doneJobsGrid');
    if (!gridEl) return;
    const filtered = _doneJobsActiveTab === 'all'
      ? doneJobs
      : doneJobs.filter(j => _doneJobCategory(j) === _doneJobsActiveTab);

    if (filtered.length === 0) {
      gridEl.innerHTML = `<div style="grid-column:1/-1;padding:40px 24px;text-align:center;color:var(--gray-400);font-size:13px">
        <div style="font-size:36px;margin-bottom:8px">📭</div>
        <div>완료된 작업이 없습니다</div>
      </div>`;
      return;
    }

    const fmtDate = (s) => {
      if (!s) return '—';
      const d = String(s).slice(0, 10);
      return d.length === 10 ? d.slice(5).replace('-','.') : d;
    };

    gridEl.innerHTML = filtered.map(j => {
      const cat = _doneJobCategory(j);
      const meta = LINE_TYPE_META[cat] || LINE_TYPE_META.ignore;
      const store = j.store || j.storeName || '-';
      const eng = j.engineer || j.assignee || '미배정';
      const doneDate = fmtDate(j.completedAt || j.date || j.createdAt);
      const memo = j.notes || j.note || j.description || '';
      const lineRaw = j.lineRaw || j.lineParsed || j.lineRequest || '';
      const isLine = j.source === 'line' || j.source === 'cron';
      return `<div onclick="closeModal('doneJobsModal');window.editNewopen && window.editNewopen('${j.id}')"
                   style="background:#fff;border:1px solid var(--gray-200);border-left:4px solid ${meta.color};border-radius:8px;padding:10px 12px;cursor:pointer;transition:all 0.15s;display:flex;flex-direction:column;gap:6px"
                   onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'"
                   onmouseout="this.style.boxShadow=''"
                   title="클릭 — 상세 보기">
        <div style="display:flex;align-items:flex-start;gap:6px">
          <div style="font-size:13px;font-weight:800;color:var(--gray-900);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(store)}</div>
          <span style="background:${meta.bg};color:${meta.color};font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;white-space:nowrap">${esc(meta.label)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--gray-600)">
          <span style="color:var(--gray-400)">✅ ${esc(doneDate)}</span>
          <span style="color:var(--gray-300)">·</span>
          <span>👤 ${esc(eng)}</span>
          ${isLine ? '<span style="margin-left:auto;background:#EFF6FF;color:#1E40AF;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700">LINE</span>' : ''}
        </div>
        ${memo || lineRaw ? `<div style="font-size:11px;color:var(--gray-500);line-height:1.4;max-height:36px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc((memo || lineRaw).slice(0, 120))}</div>` : ''}
      </div>`;
    }).join('');
  }

  function setDoneJobsTab(category) {
    _doneJobsActiveTab = category;
    _renderDoneJobsModal();
  }
  window.setDoneJobsTab = setDoneJobsTab;

  /* ══════════════════════════════════════════════
     VAN 서류 — 마이페이지 목록 + 대시보드 알림
  ══════════════════════════════════════════════ */
  async function fetchVandocsIndex(unackOnly) {
    try {
      const url = unackOnly ? '/api/vandocs?unack=1' : '/api/vandocs';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return { items: [] };
      return await res.json();
    } catch(e) { return { items: [] }; }
  }

  function _vdRowHtml(it) {
    const created = (it.createdAt || '').slice(0,16).replace('T',' ');
    const ackBadge = it.acknowledged
      ? `<span style="background:var(--gray-200);color:var(--gray-600);font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px">✓ 확인됨${it.acknowledgedBy?` · ${esc(it.acknowledgedBy)}`:''}</span>`
      : `<span style="background:#7C3AED;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px">NEW</span>`;
    const fileCount = it.count || 0;
    const dlBtn = fileCount > 0
      ? `<button class="btn btn-primary btn-sm" style="font-size:11px;padding:4px 10px;background:#7C3AED;border-color:#7C3AED" onclick="event.stopPropagation();window._vdQuickDownload('${esc(it.id)}', this)" title="모든 파일 다운로드">📥 다운로드 (${fileCount})</button>`
      : '';
    const ackBtn = it.acknowledged
      ? ''
      : `<button class="btn btn-outline btn-sm" style="font-size:11px;padding:4px 10px" onclick="event.stopPropagation();ackVandoc('${esc(it.id)}')">확인</button>`;
    // 👤 제출자 정보 — name + phone 분리 + 매장전화 + 이메일
    const contactBits = [];
    const subName  = it.submitterName  || (it.submitter && !it.submitterPhone ? it.submitter : '');
    const subPhone = it.submitterPhone || '';
    if (subName)  contactBits.push(`👤 ${esc(subName)}`);
    if (subPhone) contactBits.push(`📱 <a href="tel:${esc(subPhone)}" onclick="event.stopPropagation()" style="color:#1E40AF;text-decoration:none">${esc(subPhone)}</a>`);
    if (it.storePhone) contactBits.push(`☎ <a href="tel:${esc(it.storePhone)}" onclick="event.stopPropagation()" style="color:#1E40AF;text-decoration:none">${esc(it.storePhone)}</a>`);
    if (it.email) contactBits.push(`✉ <a href="mailto:${esc(it.email)}" onclick="event.stopPropagation()" style="color:#1E40AF;text-decoration:none">${esc(it.email)}</a>`);
    const contactHtml = contactBits.length
      ? `<div style="font-size:11px;color:var(--gray-700);display:flex;flex-wrap:wrap;gap:8px;background:#F9FAFB;border-radius:6px;padding:5px 9px;margin:2px 0">${contactBits.join(' · ')}</div>`
      : '';
    return `<div class="vd-row" style="border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:5px;transition:background 0.15s" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background='#fff'" onclick="openVandocDetail('${esc(it.id)}')">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="font-weight:700;font-size:13px;flex:1;min-width:0">${esc(it.store)} <span style="color:var(--gray-400);font-size:11px;font-weight:400">— ${esc(it.docType||'')}</span></div>
        ${ackBadge}
      </div>
      ${contactHtml}
      <div style="font-size:11px;color:var(--gray-500);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <span>${esc(it.category||'')}</span>
        <span>${esc(created)} · 파일 ${fileCount}개</span>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:6px">${dlBtn}${ackBtn}</div>
    </div>`;
  }

  /* 일괄 다운로드 — 현재 목록에 보이는 모든 서류의 파일을 매장별 폴더로 일괄 다운로드
     - 최신 브라우저 (Chrome/Edge): 부모 폴더 선택 → vandocs_YYYYMMDD/매장명_서류종류_날짜/file.ext
     - fallback: 평탄 다운로드 (매장명_서류종류_파일명) */
  window._vandocsDownloadAll = async function(btnEl) {
    const showAcked = !!document.getElementById('vanhubVandocsShowAcked')?.checked;
    const origLabel = btnEl ? btnEl.innerHTML : '';
    try {
      if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳ 목록 조회중...'; }
      const idxData = await fetchVandocsIndex(false);
      const allItems = idxData.items || [];
      const items = showAcked ? allItems : allItems.filter(it => !it.acknowledged);
      if (!items.length) {
        if (typeof showToast==='function') showToast('다운로드할 서류가 없습니다');
        return;
      }
      const totalFiles = items.reduce((sum, it) => sum + (it.count || 0), 0);
      if (!confirm(`${items.length}건의 서류 (총 ${totalFiles}개 파일) 을 다운로드합니다. 계속할까요?`)) return;

      const safe = (s) => String(s||'').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
      const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
      const rootName = `vandocs_${today}`;

      // 최신 브라우저: 폴더 선택 후 매장별 하위폴더 생성
      if (items.length > 1 && window.showDirectoryPicker) {
        try {
          if (typeof showToast==='function') showToast('📁 저장할 부모 폴더를 선택하세요');
          const parentHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
          const rootHandle = await parentHandle.getDirectoryHandle(rootName, { create: true });
          let okFiles = 0, okSubs = 0;
          for (let s = 0; s < items.length; s++) {
            const it = items[s];
            if (btnEl) btnEl.innerHTML = `⏳ ${s+1}/${items.length}...`;
            try {
              // submission 메타 조회
              const metaRes = await fetch('/api/vandocs?id=' + encodeURIComponent(it.id), { cache:'no-store' });
              if (!metaRes.ok) continue;
              const data = await metaRes.json();
              const files = data.files || [];
              if (!files.length) continue;
              const datePrefix = (data.createdAt || '').slice(0,10).replace(/-/g,'');
              const subName = `${safe(data.store)}_${safe(data.docType)}_${datePrefix}`;
              const subHandle = await rootHandle.getDirectoryHandle(subName, { create: true });
              const seen = {};
              for (let i = 0; i < files.length; i++) {
                const f = files[i];
                try {
                  const r = await fetch(`/api/vandocs?id=${encodeURIComponent(it.id)}&fileIdx=${i}&download=1`);
                  if (!r.ok) continue;
                  const blob = await r.blob();
                  let leaf = f.name || `file_${i}`;
                  const dot = leaf.lastIndexOf('.');
                  const base = dot > 0 ? leaf.slice(0, dot) : leaf;
                  const ext  = dot > 0 ? leaf.slice(dot) : '';
                  if (seen[leaf] != null) leaf = `${base}_${++seen[leaf]}${ext}`;
                  else seen[f.name || leaf] = 0;
                  const fh = await subHandle.getFileHandle(leaf, { create: true });
                  const w = await fh.createWritable();
                  await w.write(blob);
                  await w.close();
                  okFiles++;
                } catch(e) { /* 파일 단위 실패는 무시 */ }
              }
              okSubs++;
            } catch(e) { /* 제출 단위 실패는 무시 */ }
          }
          if (typeof showToast==='function') showToast(`✅ ${okSubs}건 · ${okFiles}개 파일 → [${rootName}] 에 저장 완료`);
          return;
        } catch(e) {
          if (e && e.name === 'AbortError') {
            if (typeof showToast==='function') showToast('취소됨');
            return;
          }
          // 그 외 오류 — 폴백 진행
        }
      }

      // 폴백: 평탄 다운로드
      if (typeof showToast==='function') showToast(`다운로드 시작 — ${items.length}건 / ${totalFiles}개 파일`);
      let okFiles = 0;
      for (let s = 0; s < items.length; s++) {
        const it = items[s];
        if (btnEl) btnEl.innerHTML = `⏳ ${s+1}/${items.length}...`;
        try {
          const metaRes = await fetch('/api/vandocs?id=' + encodeURIComponent(it.id), { cache:'no-store' });
          if (!metaRes.ok) continue;
          const data = await metaRes.json();
          const files = data.files || [];
          if (!files.length) continue;
          const storePrefix = safe(data.store) + '_' + safe(data.docType);
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            try {
              const r = await fetch(`/api/vandocs?id=${encodeURIComponent(it.id)}&fileIdx=${i}&download=1`);
              if (!r.ok) continue;
              const blob = await r.blob();
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${storePrefix}_${f.name || 'file_'+i}`;
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
              okFiles++;
              await new Promise(r => setTimeout(r, 250)); // 브라우저 다운로드 throttle
            } catch(e){}
          }
        } catch(e){}
      }
      if (typeof showToast==='function') showToast(`✅ ${okFiles}개 파일 다운로드 완료`);
    } catch(e) {
      console.warn('[_vandocsDownloadAll]', e);
      if (typeof showToast==='function') showToast('일괄 다운로드 실패: ' + e.message);
    } finally {
      if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; }
    }
  };

  /* 빠른 다운로드 — 목록에서 row 의 다운로드 버튼 클릭 시
     submission 메타 조회 → 모든 파일 일괄 다운로드 */
  window._vdQuickDownload = async function(id, btnEl) {
    const origLabel = btnEl ? btnEl.innerHTML : '';
    try {
      if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳ 준비중...'; }
      const res = await fetch('/api/vandocs?id=' + encodeURIComponent(id), { cache: 'no-store' });
      if (!res.ok) { if (typeof showToast==='function') showToast('서류를 찾을 수 없습니다'); return; }
      const data = await res.json();
      _vdCurrent = data;
      _vdCurrent.id = id;
      if (!data.files || !data.files.length) {
        if (typeof showToast==='function') showToast('다운로드할 파일이 없습니다');
        return;
      }
      const idxs = data.files.map((_, i) => i);
      await _downloadVdFiles(idxs);
    } catch(e) {
      console.warn('[_vdQuickDownload]', e);
      if (typeof showToast==='function') showToast('다운로드 실패: ' + e.message);
    } finally {
      if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; }
    }
  };

  async function loadVandocsList() {
    const area = document.getElementById('vandocsListArea');
    const badge = document.getElementById('vandocsBadge');
    if (!area) return;
    area.innerHTML = `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:12px">불러오는 중…</div>`;
    const showAcked = !!document.getElementById('vandocsShowAcked')?.checked;
    const data = await fetchVandocsIndex(false);
    const all = data.items || [];
    const unackCount = all.filter(it => !it.acknowledged).length;
    if (badge) badge.textContent = unackCount;
    const items = showAcked ? all : all.filter(it => !it.acknowledged);
    if (!items.length) {
      area.innerHTML = `<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px">${showAcked?'업로드된 서류가 없습니다.':'확인할 신규 서류가 없습니다.'}</div>`;
      return;
    }
    area.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">${items.map(_vdRowHtml).join('')}</div>`;
    // 대시보드 알림도 함께 갱신
    refreshDashVandocsAlert();
  }
  window.loadVandocsList = loadVandocsList;

  /* ─── VAN hub 인라인 접수서류 패널 (myPageModal 의 복제 — 같은 데이터/렌더링 재사용) ─── */
  window._vanhubToggleVandocs = function(forceState) {
    const panel = document.getElementById('vanhubVandocsPanel');
    if (!panel) return;
    const hidden = (panel.style.display === 'none');
    const open = (typeof forceState === 'boolean') ? forceState : hidden;
    panel.style.display = open ? '' : 'none';
    if (open) window._vanhubLoadDocs();
  };

  window._vanhubLoadDocs = async function() {
    const area = document.getElementById('vanhubVandocsArea');
    const badge = document.getElementById('vanhubVandocsBadge');
    const countLbl = document.getElementById('vanhubVandocsCountLbl');
    if (!area) return;
    area.innerHTML = `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:12px">불러오는 중…</div>`;
    const showAcked = !!document.getElementById('vanhubVandocsShowAcked')?.checked;
    let data;
    try { data = await fetchVandocsIndex(false); } catch(e) { data = { items: [] }; }
    const all = data.items || [];
    const unackCount = all.filter(it => !it.acknowledged).length;
    if (badge) badge.textContent = unackCount;
    const items = showAcked ? all : all.filter(it => !it.acknowledged);
    if (countLbl) countLbl.textContent = showAcked
      ? `(전체 ${all.length}건 · 미확인 ${unackCount}건)`
      : `(미확인 ${unackCount}건)`;
    if (!items.length) {
      area.innerHTML = `<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px">${showAcked?'업로드된 서류가 없습니다.':'확인할 신규 서류가 없습니다.'}</div>`;
      return;
    }
    area.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">${items.map(_vdRowHtml).join('')}</div>`;
    try { refreshDashVandocsAlert(); } catch(_){}
  };

  // VAN 접수서류 URL 복사 (고객 공유용)
  window._vanhubCopyVandocsUrl = async function(btnEl) {
    const url = (location.origin || 'https://work.neoretail.net') + '/vandocs.html';
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        // fallback (구형 브라우저)
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position='fixed'; ta.style.left='-9999px';
        document.body.appendChild(ta); ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      }
    } catch(e) { console.warn('[copyVandocsUrl]', e); }
    if (ok) {
      if (typeof showToast === 'function') showToast('🔗 접수 URL 이 복사되었습니다 — LINE/문자로 공유하세요');
      if (btnEl) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = '✓ 복사됨';
        btnEl.style.background = '#10B981';
        setTimeout(() => { btnEl.innerHTML = orig; btnEl.style.background = '#7C3AED'; }, 1500);
      }
    } else {
      // 복사 실패 시 prompt 로 보여줘 사용자가 직접 복사
      try { prompt('아래 URL 을 복사해 주세요:', url); } catch(_){}
    }
  };

  // VAN hub 진입 시 미확인 서류 카운트만 미리 갱신 (패널은 닫힘 유지)
  window._vanhubRefreshDocsBadge = async function() {
    const badge = document.getElementById('vanhubVandocsBadge');
    if (!badge) return;
    try {
      const data = await fetchVandocsIndex(false);
      const unack = (data.items || []).filter(it => !it.acknowledged).length;
      badge.textContent = unack;
    } catch(_){}
  };

  async function ackVandoc(id) {
    let by = '';
    try {
      const auth = JSON.parse(localStorage.getItem('ns_auth') || 'null');
      by = (auth && (auth.name || auth.email)) || '';
    } catch(e){}
    try {
      await fetch('/api/vandocs?ack=' + encodeURIComponent(id) + '&by=' + encodeURIComponent(by), {
        method: 'PUT'
      });
      if (typeof showToast === 'function') showToast('✅ 확인 처리됨');
      try { loadVandocsList(); } catch(e){}
      // VAN hub 인라인 패널이 열려있으면 함께 갱신
      try {
        const panel = document.getElementById('vanhubVandocsPanel');
        if (panel && panel.style.display !== 'none' && typeof window._vanhubLoadDocs === 'function') {
          window._vanhubLoadDocs();
        }
        if (typeof window._vanhubRefreshDocsBadge === 'function') window._vanhubRefreshDocsBadge();
      } catch(_){}
      refreshDashVandocsAlert();
    } catch(e) {
      if (typeof showToast === 'function') showToast('확인 실패: ' + e.message);
    }
  }
  window.ackVandoc = ackVandoc;

  async function ackAllVandocs() {
    const data = await fetchVandocsIndex(true);
    const items = data.items || [];
    if (!items.length) return;
    if (!confirm(`신규 서류 ${items.length}건을 모두 확인 처리하시겠습니까?`)) return;
    let by = '';
    try {
      const auth = JSON.parse(localStorage.getItem('ns_auth') || 'null');
      by = (auth && (auth.name || auth.email)) || '';
    } catch(e){}
    for (const it of items) {
      try {
        await fetch('/api/vandocs?ack=' + encodeURIComponent(it.id) + '&by=' + encodeURIComponent(by), { method: 'PUT' });
      } catch(e) {}
    }
    if (typeof showToast === 'function') showToast(`✅ ${items.length}건 확인 처리됨`);
    refreshDashVandocsAlert();
    try { loadVandocsList(); } catch(e){}
  }
  window.ackAllVandocs = ackAllVandocs;

  async function refreshDashVandocsAlert() {
    const el = document.getElementById('dashVandocsAlert');
    const body = document.getElementById('dashVandocsBody');
    const cnt = document.getElementById('dashVandocsCount');
    if (!el || !body) return;
    const data = await fetchVandocsIndex(true);
    const items = data.items || [];
    if (!items.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    if (cnt) cnt.textContent = items.length;
    body.innerHTML = items.slice(0, 5).map(it => {
      const created = (it.createdAt || '').slice(5,16).replace('T',' ').replace(/-/g,'.');
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fff;border:1px solid #FCD34D;border-radius:6px;padding:8px 10px;cursor:pointer" onclick="openVandocDetail('${esc(it.id)}')" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='#fff'">
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          <b style="font-size:13px">${esc(it.store)}</b>
          <span style="color:var(--gray-500);font-size:11px"> — ${esc(it.docType||'')} · ${esc(it.category||'')}</span>
        </div>
        <span style="font-size:11px;color:#92400E;white-space:nowrap">${esc(created)} · ${it.count||0}개</span>
        <button class="btn btn-outline btn-sm" style="font-size:10px;padding:3px 8px;color:#92400E;border-color:#92400E" onclick="event.stopPropagation();ackVandoc('${esc(it.id)}')">확인</button>
      </div>`;
    }).join('');
    if (items.length > 5) {
      body.innerHTML += `<div style="text-align:center;font-size:11px;color:#92400E;padding:4px">…외 ${items.length - 5}건 (마이페이지에서 전체 보기)</div>`;
    }
  }
  window.refreshDashVandocsAlert = refreshDashVandocsAlert;

  /* 서류 상세 — 파일 목록 + 체크박스 다운로드 */
  let _vdCurrent = null; // { id, store, docType, files: [...] }
  async function openVandocDetail(id) {
    try {
      const res = await fetch('/api/vandocs?id=' + encodeURIComponent(id), { cache: 'no-store' });
      if (!res.ok) { showToast && showToast('서류를 찾을 수 없습니다'); return; }
      const data = await res.json();
      _vdCurrent = data;
      _vdCurrent.id = id;

      const titleEl = document.getElementById('dashListTitle');
      const bodyEl = document.getElementById('dashListBody');
      if (!titleEl || !bodyEl) return;
      titleEl.textContent = `📑 ${data.store} — ${data.docType||''}`;
      const meta = `${esc(data.category||'')} · ${esc((data.createdAt||'').slice(0,16).replace('T',' '))}${data.submitter?` · ${esc(data.submitter)}`:''}`;
      const fileCount = (data.files || []).length;
      const filesHtml = (data.files || []).map((f, i) => {
        const url = `/api/vandocs?id=${encodeURIComponent(id)}&fileIdx=${i}&download=1`;
        const isImg = (f.type||'').startsWith('image/');
        const thumb = isImg
          ? `<img src="${url}" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid var(--gray-200)" alt="">`
          : `<div style="width:100%;height:140px;background:#FEE2E2;color:var(--danger);border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:1px solid var(--gray-200)"><div style="font-size:36px">📄</div><div style="font-size:11px">${(f.type||'').includes('pdf')?'PDF':'파일'}</div></div>`;
        return `<div class="vd-file" style="position:relative">
          <label style="position:absolute;top:6px;left:6px;background:rgba(255,255,255,0.95);border-radius:4px;padding:3px 6px;display:flex;align-items:center;gap:4px;cursor:pointer;z-index:1;font-size:11px;font-weight:600">
            <input type="checkbox" class="vd-file-chk" data-idx="${i}" checked onchange="updateVdSelectAll()" style="margin:0;cursor:pointer">
          </label>
          <a href="${url}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit">
            ${thumb}
            <div style="font-size:11px;color:var(--gray-600);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name||'')}</div>
            <div style="font-size:10px;color:var(--gray-400)">${formatBytesKB(f.size||0)}</div>
          </a>
        </div>`;
      }).join('');
      // 👤 제출자 / ☎ 매장 / ✉ 이메일 정보 카드
      const contactRows = [];
      const subName  = data.submitterName  || (data.submitter && !data.submitterPhone ? data.submitter : '');
      const subPhone = data.submitterPhone || '';
      if (subName || subPhone) {
        contactRows.push(`<div style="display:flex;gap:8px;align-items:center">
          <span style="min-width:78px;font-size:11px;color:var(--gray-500);font-weight:700">👤 제출자</span>
          <span style="font-size:13px;color:var(--gray-800);font-weight:600">${esc(subName||'-')}</span>
          ${subPhone?`<a href="tel:${esc(subPhone)}" style="font-size:13px;color:#1E40AF;text-decoration:none;font-weight:700;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:2px 9px">📱 ${esc(subPhone)}</a>`:''}
        </div>`);
      }
      if (data.storePhone) {
        contactRows.push(`<div style="display:flex;gap:8px;align-items:center">
          <span style="min-width:78px;font-size:11px;color:var(--gray-500);font-weight:700">☎ 매장전화</span>
          <a href="tel:${esc(data.storePhone)}" style="font-size:13px;color:#1E40AF;text-decoration:none;font-weight:700;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:2px 9px">${esc(data.storePhone)}</a>
        </div>`);
      }
      if (data.email) {
        contactRows.push(`<div style="display:flex;gap:8px;align-items:center">
          <span style="min-width:78px;font-size:11px;color:var(--gray-500);font-weight:700">✉ 이메일</span>
          <a href="mailto:${esc(data.email)}" style="font-size:13px;color:#1E40AF;text-decoration:none;font-weight:700;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:2px 9px">${esc(data.email)}</a>
        </div>`);
      }
      const contactCardHtml = contactRows.length
        ? `<div style="background:#F9FAFB;border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;flex-direction:column;gap:6px">${contactRows.join('')}</div>`
        : '';
      bodyEl.innerHTML = `<div style="padding:16px">
        <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">${meta}</div>
        ${contactCardHtml}
        ${data.note?`<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:6px;padding:8px 10px;font-size:12px;margin-bottom:10px">📝 ${esc(data.note)}</div>`:''}
        ${fileCount > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;background:#F9FAFB;border:1px solid var(--gray-200);border-radius:8px;padding:8px 12px;margin-bottom:10px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:600">
            <input type="checkbox" id="vdSelectAll" checked onchange="toggleVdSelectAll(this.checked)" style="cursor:pointer">
            전체 선택 <span id="vdSelectCount" style="color:var(--gray-500);font-weight:400">(${fileCount}/${fileCount})</span>
          </label>
          <div style="display:flex;gap:6px">
            <button class="btn btn-outline btn-sm" style="font-size:11px;padding:5px 10px" onclick="downloadVdSelected()">⬇ 선택 다운로드</button>
            <button class="btn btn-primary btn-sm" style="font-size:11px;padding:5px 10px" onclick="downloadVdAll()">⬇ 전체 다운로드</button>
          </div>
        </div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${filesHtml || '<div style="color:var(--gray-400);font-size:12px">파일 없음</div>'}</div>
        <div style="margin-top:14px;display:flex;gap:6px;justify-content:space-between;align-items:center;flex-wrap:wrap">
          <div style="font-size:10px;color:var(--gray-400)">
            ${data.acknowledged ? `🗑 확인 후 7일 경과 시 자동 삭제됩니다.` : '🔒 미확인 상태에서는 자동 삭제되지 않습니다.'}
          </div>
          <div style="display:flex;gap:6px">
            ${data.acknowledged ? `<span style="font-size:11px;color:var(--gray-500);align-self:center">✓ ${esc(data.acknowledgedBy||'')} ${esc((data.acknowledgedAt||'').slice(0,16).replace('T',' '))}</span>` : `<button class="btn btn-primary btn-sm" onclick="ackVandoc('${esc(id)}');closeModal('dashListModal')">확인 처리</button>`}
          </div>
        </div>
      </div>`;
      if (typeof showModal === 'function') showModal('dashListModal');
    } catch(e) {
      if (typeof showToast === 'function') showToast('상세 로드 실패: ' + e.message);
    }
  }
  window.openVandocDetail = openVandocDetail;

  function toggleVdSelectAll(checked) {
    document.querySelectorAll('.vd-file-chk').forEach(c => c.checked = checked);
    updateVdSelectAll();
  }
  window.toggleVdSelectAll = toggleVdSelectAll;

  function updateVdSelectAll() {
    const all = document.querySelectorAll('.vd-file-chk');
    const checked = Array.from(all).filter(c => c.checked).length;
    const total = all.length;
    const cntEl = document.getElementById('vdSelectCount');
    if (cntEl) cntEl.textContent = `(${checked}/${total})`;
    const sa = document.getElementById('vdSelectAll');
    if (sa) {
      sa.checked = checked === total && total > 0;
      sa.indeterminate = checked > 0 && checked < total;
    }
  }
  window.updateVdSelectAll = updateVdSelectAll;

  function _getSelectedVdIdxs() {
    return Array.from(document.querySelectorAll('.vd-file-chk'))
      .filter(c => c.checked)
      .map(c => Number(c.dataset.idx));
  }

  async function downloadVdSelected() {
    const idxs = _getSelectedVdIdxs();
    if (!idxs.length) { showToast && showToast('선택된 파일이 없습니다'); return; }
    await _downloadVdFiles(idxs);
  }
  window.downloadVdSelected = downloadVdSelected;

  async function downloadVdAll() {
    if (!_vdCurrent || !_vdCurrent.files) return;
    const idxs = _vdCurrent.files.map((_, i) => i);
    await _downloadVdFiles(idxs);
  }
  window.downloadVdAll = downloadVdAll;

  /* 선택된 파일들을 그대로 (압축 없이) 순차 다운로드
     - 복수 파일 + showDirectoryPicker 지원 시:
         사용자에게 폴더 선택 다이얼로그 → 그 안에 [매장명_서류종류_날짜] 하위 폴더 생성 → 파일 저장
     - 그 외 (단일/미지원): 일반 다운로드 (파일명에 매장명 prefix) */
  async function _downloadVdFiles(idxs) {
    const cur = _vdCurrent;
    if (!cur || !cur.files) return;

    const safe = (s) => String(s||'').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    const datePrefix = (cur.createdAt || '').slice(0,10).replace(/-/g, '');
    const folderName = `${safe(cur.store)}_${safe(cur.docType)}_${datePrefix}`;

    // 복수 파일 + File System Access API 가능 → 폴더 선택 후 하위폴더 생성
    if (idxs.length > 1 && window.showDirectoryPicker) {
      try {
        showToast && showToast(`📁 저장할 부모 폴더를 선택하세요`);
        const parentHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const subHandle = await parentHandle.getDirectoryHandle(folderName, { create: true });
        showToast && showToast(`다운로드 시작 — ${idxs.length}개 → ${folderName}/`);

        const seen = {};
        let okCount = 0;
        for (const i of idxs) {
          const f = cur.files[i];
          if (!f) continue;
          try {
            const res = await fetch(`/api/vandocs?id=${encodeURIComponent(cur.id)}&fileIdx=${i}&download=1`);
            if (!res.ok) continue;
            const blob = await res.blob();

            let leaf = f.name || `file_${i}`;
            const dot = leaf.lastIndexOf('.');
            const base = dot > 0 ? leaf.slice(0, dot) : leaf;
            const ext  = dot > 0 ? leaf.slice(dot) : '';
            if (seen[leaf] != null) leaf = `${base}_${++seen[leaf]}${ext}`;
            else seen[f.name || leaf] = 0;

            const fileHandle = await subHandle.getFileHandle(leaf, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            okCount++;
          } catch(e) { /* 파일 단위 실패는 무시 */ }
        }
        showToast && showToast(`✅ ${okCount}개 파일 → [${folderName}] 에 저장 완료`);
        return;
      } catch (e) {
        // 사용자가 폴더 선택 취소했거나 권한 거부 → 평탄 다운로드로 폴백
        if (e && e.name === 'AbortError') {
          showToast && showToast('취소됨');
          return;
        }
        // 그 외 오류는 폴백 진행
      }
    }

    // 폴백: 평탄 다운로드 (매장명_서류종류_원본 형식)
    showToast && showToast(`다운로드 시작 — ${idxs.length}개`);
    const seen = {};
    let okCount = 0;
    for (const i of idxs) {
      const f = cur.files[i];
      if (!f) continue;
      try {
        const res = await fetch(`/api/vandocs?id=${encodeURIComponent(cur.id)}&fileIdx=${i}&download=1`);
        if (!res.ok) continue;
        const blob = await res.blob();

        let baseName = f.name || `file_${i}`;
        const dot = baseName.lastIndexOf('.');
        const base = dot > 0 ? baseName.slice(0, dot) : baseName;
        const ext  = dot > 0 ? baseName.slice(dot) : '';
        let outName = `${safe(cur.store)}_${safe(cur.docType)}_${base}${ext}`;
        if (seen[outName] != null) outName = `${safe(cur.store)}_${safe(cur.docType)}_${base}_${++seen[outName]}${ext}`;
        else seen[outName] = 0;

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = outName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        okCount++;
        await new Promise(r => setTimeout(r, 250));
      } catch(e) {}
    }
    showToast && showToast(`✅ ${okCount}개 파일 다운로드 (파일명에 매장명 포함)`);
  }

  function formatBytesKB(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
    return (n/(1024*1024)).toFixed(1) + ' MB';
  }

  // 대시보드 진입 시 자동 갱신 — hydrateDashboardJobs 와 함께
  try { refreshDashVandocsAlert(); } catch(e){}
  // 5분마다 폴링
  try {
    setInterval(() => { try { refreshDashVandocsAlert(); } catch(e){} }, 5 * 60 * 1000);
  } catch(e){}

  /* ══════════════════════════════════════════════
     일정 캘린더 (ns_jobs 기반 동적 렌더)
  ══════════════════════════════════════════════ */
  const _calState = { year: new Date().getFullYear(), month: new Date().getMonth() };

  function renderCalendar() {
    const grid = document.getElementById('calGrid');
    const label = document.getElementById('calMonthLabel');
    if (!grid || !label) return;
    const { year, month } = _calState;
    label.textContent = `${year}년 ${month + 1}월`;

    // 🛡 어른거림 방지 — 해당 월 일정 데이터가 직전과 동일하면 그리드 재구축 skip
    {
      const _jall = (typeof getJobs === 'function') ? (getJobs() || []) : [];
      const _calSig = year + '-' + month + '|' + JSON.stringify(_jall.map(j=>[j.id,j.installDate||'',j.softOpenDate||'',j.openDate||'',j.asReceivedAt||'',j.shipDate||'',j.status||'',j.completed?1:0]));
      if (window._sigSkip && window._sigSkip(grid, _calSig)) return;
    }

    // 헤더 7개 유지하고 나머지 비움
    const headers = Array.from(grid.querySelectorAll('.cal-day-header'));
    grid.innerHTML = '';
    headers.forEach(h => grid.appendChild(h));

    const firstDayWeekday = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevLastDate = new Date(year, month, 0).getDate();

    // 작업 날짜별 그룹 (작업예정일 + 매장 주요 일정 3종)
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const byDate = {};
    const pushEvent = (date, j, kind) => {
      const d = (date || '').slice(0, 10);
      if (!d) return;
      (byDate[d] = byDate[d] || []).push({ ...j, _kind: kind });
    };
    jobs.forEach(j => {
      const isAs = /AS/i.test(j.type || '');
      if (isAs) {
        // AS 일정 — 처리예정일이 있으면, 없으면 접수일
        const asDate = (j.asDueDate || '').slice(0,10) ||
                       (j.asReceivedAt ? j.asReceivedAt.slice(0,10) : '');
        if (asDate) pushEvent(asDate, j, 'as');
      } else {
        // 매장 주요 일정 3종
        pushEvent(j.installDate,  j, 'install');
        pushEvent(j.softOpenDate, j, 'soft');
        pushEvent(j.openDate,     j, 'open');
      }
    });

    const today = new Date().toISOString().slice(0, 10);

    const eventStyle = (kind, type) => {
      // 매장 주요 일정 우선
      if (kind === 'install') return 'background:#FED7AA;color:#9A3412'; // 주황
      if (kind === 'soft')    return 'background:#FECACA;color:#991B1B'; // 분홍/빨강
      if (kind === 'open')    return 'background:#A7F3D0;color:#065F46;font-weight:800'; // 진한 초록
      if (kind === 'as')      return 'background:#FEF3C7;color:#92400E;font-weight:700'; // 노란 — AS
      // 작업 유형별
      const t = type || '';
      if (/AS/i.test(t))           return 'background:#FEF3C7;color:#92400E';
      if (/VAN/.test(t))           return 'background:#EDE9FE;color:#5B21B6';
      if (/POS.*교체|장비.*추가/.test(t)) return 'background:#D1FAE5;color:#065F46';
      if (/신규|개업|가맹|SW/.test(t))  return 'background:#DBEAFE;color:#1D4ED8';
      return 'background:#F3F4F6;color:#374151';
    };
    const kindIcon = (kind) => ({ install:'🔧', soft:'🌅', open:'🎉', as:'🛠' })[kind] || '';
    const kindLabel = (kind) => ({ install:'설치예정', soft:'가오픈', open:'오픈', as:'AS' })[kind] || '';

    // 이전 달 끝 날짜 (회색)
    for (let i = firstDayWeekday - 1; i >= 0; i--) {
      const d = document.createElement('div');
      d.className = 'cal-day other-month';
      d.innerHTML = `<div class="cal-day-num">${prevLastDate - i}</div>`;
      grid.appendChild(d);
    }
    // 이번 달
    for (let day = 1; day <= lastDate; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === today;
      const dayJobs = byDate[dateStr] || [];
      const cell = document.createElement('div');
      cell.className = 'cal-day' + (isToday ? ' today' : '');
      const events = dayJobs.slice(0, 4).map(j => {
        const kind = j._kind || 'work';
        const icon = kindIcon(kind);
        const klabel = kindLabel(kind);
        const storeName = (j.store || j.storeName || '-').slice(0, 8);
        const label = kind === 'work'
          ? `${storeName} ${(j.type || '').slice(0, 6)}`
          : `${icon} ${storeName} ${klabel}`;
        const tip = `${j.store||j.storeName||''} · ${kind==='work'?(j.type||''):klabel} · 담당 ${j.engineer||'미배정'}`;
        return `<div class="cal-event" style="${eventStyle(kind, j.type)};cursor:pointer" title="${esc(tip)}" onclick="event.stopPropagation();editNewopen('${j.id}')">${esc(label)}</div>`;
      }).join('');
      const more = dayJobs.length > 4 ? `<div style="font-size:10px;color:var(--gray-400);text-align:center;margin-top:2px">+${dayJobs.length - 4}건</div>` : '';
      cell.innerHTML = `<div class="cal-day-num"${isToday?' style="color:var(--primary)"':''}>${day}</div>${events}${more}`;
      grid.appendChild(cell);
    }
    // 다음 달 시작 (6주 채우기)
    const totalCells = firstDayWeekday + lastDate;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      const d = document.createElement('div');
      d.className = 'cal-day other-month';
      d.innerHTML = `<div class="cal-day-num">${i}</div>`;
      grid.appendChild(d);
    }
  }
  window.renderCalendar = renderCalendar;

  function moveCalMonth(delta) {
    if (delta === 0) {
      _calState.year = new Date().getFullYear();
      _calState.month = new Date().getMonth();
    } else {
      _calState.month += delta;
      if (_calState.month < 0) { _calState.month = 11; _calState.year--; }
      else if (_calState.month > 11) { _calState.month = 0; _calState.year++; }
    }
    renderCalendar();
  }
  window.moveCalMonth = moveCalMonth;

  /* ══════════════════════════════════════════════
     작업 워크플로 시스템 (작업 유형별 단계 + 진행상태)
  ══════════════════════════════════════════════ */
  const STEP_LABELS = {
    vanGam:     'VAN가맹',
    posAuth:    'POS인증',
    installPos: '장비설치(POS)',
    installVan: '장비설치(VAN)',
    bizDate:    '영업예정일',
    openDate:   '오픈예정일',
    workDate:   '작업예정일',
  };
  const WORKFLOW_TEMPLATES = {
    '신규가맹':       ['vanGam','posAuth','installPos','installVan','bizDate','openDate'],
    'SW 변경':        ['vanGam','posAuth','installPos','installVan','bizDate','openDate'],
    'VAN사 변경':     ['vanGam','posAuth','installPos','installVan','workDate'],
    '신규':           ['vanGam','posAuth','installPos','installVan','bizDate','openDate'],
    '당사매장 인수':  ['vanGam','posAuth','installPos','installVan','bizDate','openDate'],
    'POS 교체':       ['installPos','workDate'],
    '장비 추가':      ['installPos','workDate'],
    'AS 처리':        ['workDate'],
  };
  const STATUS_NEXT = { pending:'in_progress', in_progress:'completed', completed:'pending' };
  const STATUS_LABEL = { pending:'준비중', in_progress:'진행중', completed:'완료' };
  const STATUS_STYLE = {
    pending:    'background:#F3F4F6;color:#6B7280;border-color:#E5E7EB',
    in_progress:'background:#DBEAFE;color:#1D4ED8;border-color:#93C5FD',
    completed:  'background:#D1FAE5;color:#065F46;border-color:#6EE7B7',
  };

  function ensureWorkflow(job) {
    const tpl = WORKFLOW_TEMPLATES[job.type] || ['workDate'];
    if (!job.workflow || !Array.isArray(job.workflow.steps)) {
      job.workflow = { steps: tpl.map(k => ({ key: k, status: 'pending', updatedAt: 0, updatedBy: '' })) };
      return job.workflow;
    }
    // 작업 유형 변경 시 누락 단계 보강
    const have = new Set(job.workflow.steps.map(s => s.key));
    tpl.forEach(k => {
      if (!have.has(k)) job.workflow.steps.push({ key: k, status: 'pending', updatedAt: 0, updatedBy: '' });
    });
    // 순서 재정렬 (템플릿 순서대로)
    job.workflow.steps.sort((a,b) => tpl.indexOf(a.key) - tpl.indexOf(b.key));
    return job.workflow;
  }

  function recalcJobProgress(job) {
    const wf = ensureWorkflow(job);
    const done = wf.steps.filter(s => s.status === 'completed').length;
    job.progress = Math.round((done / wf.steps.length) * 100);
    return job.progress;
  }

  function getCurrentUserName() {
    try {
      const auth = JSON.parse(localStorage.getItem('ns_auth') || 'null');
      return (auth && (auth.name || auth.email)) || '관리자';
    } catch { return '관리자'; }
  }

  function cycleStepStatus(jobId, stepKey) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const wf = ensureWorkflow(job);
    const step = wf.steps.find(s => s.key === stepKey);
    if (!step) return;
    step.status = STATUS_NEXT[step.status || 'pending'] || 'pending';
    step.updatedAt = Date.now();
    step.updatedBy = getCurrentUserName();
    recalcJobProgress(job);
    saveJobs(jobs);
    try { hydrateNewopen('all'); } catch(e){}
    try { hydrateDashboardJobs(); } catch(e){}
  }
  window.cycleStepStatus = cycleStepStatus;

  function toggleStepDetail(jobId, stepKey) {
    const id = `wfdetail-${jobId}-${stepKey}`;
    const el = document.getElementById(id);
    if (!el) return;
    const visible = el.style.display !== 'none';
    // 같은 작업의 다른 detail은 닫음
    document.querySelectorAll(`[id^="wfdetail-${jobId}-"]`).forEach(e => e.style.display = 'none');
    el.style.display = visible ? 'none' : '';
  }
  window.toggleStepDetail = toggleStepDetail;

  function toggleEquipChecked(jobId, eqIdx, checked) {
    const jobs = getJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    if (!job.equipmentChecked) job.equipmentChecked = {};
    job.equipmentChecked[eqIdx] = !!checked;
    job.equipmentCheckedBy = job.equipmentCheckedBy || {};
    job.equipmentCheckedBy[eqIdx] = checked ? { name: getCurrentUserName(), at: Date.now() } : null;
    saveJobs(jobs);
    // 부분 업데이트만 (테이블 재렌더 시 펼침이 닫힘 방지 위해)
    const stat = document.getElementById(`equip-stat-${jobId}`);
    if (stat && Array.isArray(job.equipment)) {
      const total = job.equipment.length;
      const done = Object.values(job.equipmentChecked).filter(Boolean).length;
      stat.textContent = `${done} / ${total} 설치 완료`;
    }
  }
  window.toggleEquipChecked = toggleEquipChecked;

  function renderWorkflowRow(job, colspan, groupBg) {
    // groupBg: 같은 작업의 모든 보조 행에 같은 배경색 적용 (신규관리 그룹 구분용)
    const bg = groupBg || '#FCFCFD';
    const wf = ensureWorkflow(job);
    const pills = wf.steps.map(s => {
      const lbl = STEP_LABELS[s.key] || s.key;
      const sty = STATUS_STYLE[s.status || 'pending'];
      const stat = STATUS_LABEL[s.status || 'pending'];
      const isInstall = (s.key === 'installPos' || s.key === 'installVan');
      const expandIcon = isInstall ? ' ▾' : '';
      const onclick = isInstall
        ? `onclick="event.stopPropagation();toggleStepDetail('${job.id}','${s.key}')"`
        : `onclick="event.stopPropagation();cycleStepStatus('${job.id}','${s.key}')"`;
      const updated = s.updatedAt ? `<div style="font-size:9px;color:var(--gray-400);margin-top:2px">${s.updatedBy||'-'} · ${new Date(s.updatedAt).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>` : '';
      const cycleBtn = isInstall
        ? `<button onclick="event.stopPropagation();cycleStepStatus('${job.id}','${s.key}')" style="margin-left:4px;padding:2px 6px;background:${stat==='완료'?'#D1FAE5':stat==='진행중'?'#DBEAFE':'#F3F4F6'};border:none;border-radius:3px;font-size:9px;cursor:pointer">${stat}</button>`
        : '';
      return `<div ${onclick} style="cursor:pointer;border:1px solid;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:600;${sty};text-align:center;min-width:100px" title="클릭: ${isInstall?'장비 펼침':'상태 변경'}">
        <div style="font-size:11px;font-weight:700">${esc(lbl)}${expandIcon}</div>
        <div style="font-size:10px;margin-top:2px">${stat}${cycleBtn}</div>
        ${updated}
      </div>`;
    }).join('');

    // 장비설치 펼침 영역들
    const equipDetails = wf.steps.filter(s => s.key === 'installPos' || s.key === 'installVan').map(s => {
      const filterFn = s.key === 'installVan'
        ? (e) => /van|단말|카드/i.test(e.name||'') || /van|단말|카드/i.test(e.spec||'')
        : (e) => !/van|단말|카드/i.test(e.name||'') && !/van|단말|카드/i.test(e.spec||'');
      const items = (Array.isArray(job.equipment) ? job.equipment : []).filter(filterFn);
      const equipChecked = job.equipmentChecked || {};
      const total = items.length;
      const done = items.filter((_, i) => {
        const realIdx = (job.equipment || []).indexOf(items[i]);
        return equipChecked[realIdx];
      }).length;
      const rows = items.length === 0
        ? `<tr><td colspan="5" style="padding:10px;text-align:center;color:var(--gray-400);font-size:11px">해당 장비가 없습니다.</td></tr>`
        : items.map((it, i) => {
            const realIdx = (job.equipment || []).indexOf(it);
            const checked = !!equipChecked[realIdx];
            const meta = (job.equipmentCheckedBy || {})[realIdx];
            const checkedInfo = checked && meta ? `<div style="font-size:10px;color:var(--success)">✓ ${meta.name||'-'} · ${meta.at?new Date(meta.at).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</div>` : '';
            return `<tr style="${checked?'background:#F0FDF4':''}">
              <td style="padding:6px 8px;border-bottom:1px solid var(--gray-100);text-align:center">
                <input type="checkbox" ${checked?'checked':''} onchange="toggleEquipChecked('${job.id}',${realIdx},this.checked)" style="width:16px;height:16px;cursor:pointer">
              </td>
              <td style="padding:6px 8px;border-bottom:1px solid var(--gray-100);font-weight:600">${esc(it.name||'-')}${it.condition==='used'?' <span style="background:#FEF3C7;color:#92400E;font-size:9px;padding:1px 5px;border-radius:3px">중고</span>':''}</td>
              <td style="padding:6px 8px;border-bottom:1px solid var(--gray-100);font-size:11px;color:var(--gray-500)">${esc(it.spec||'-')}</td>
              <td style="padding:6px 8px;border-bottom:1px solid var(--gray-100);text-align:right;font-weight:600">${it.qty}대</td>
              <td style="padding:6px 8px;border-bottom:1px solid var(--gray-100);font-size:10px">${checkedInfo}</td>
            </tr>`;
          }).join('');
      return `<tr id="wfdetail-${job.id}-${s.key}" style="display:none;background:${bg}">
        <td colspan="${colspan}" style="padding:14px 18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:12px;font-weight:700;color:var(--gray-700)">📦 ${STEP_LABELS[s.key]} 체크리스트</div>
            <div style="font-size:11px;color:var(--gray-500)" id="equip-stat-${job.id}">${done} / ${total} 설치 완료</div>
          </div>
          <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden">
            <thead style="background:#F3F4F6">
              <tr>
                <th style="padding:6px;width:40px;text-align:center;font-size:11px">설치</th>
                <th style="padding:6px;text-align:left;font-size:11px">품목</th>
                <th style="padding:6px;text-align:left;font-size:11px">규격</th>
                <th style="padding:6px;text-align:right;font-size:11px;width:60px">수량</th>
                <th style="padding:6px;text-align:left;font-size:11px;width:140px">확인자/시각</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td>
      </tr>`;
    }).join('');

    return {
      pillRow: `<tr style="background:${bg}"><td colspan="${colspan}" style="padding:10px 18px"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start">${pills}</div></td></tr>`,
      detailRows: equipDetails,
    };
  }
  window.renderWorkflowRow = renderWorkflowRow;

  /* 대시보드 신규/상담 현황 요약 — AI 분석 자리 차지 */
  function renderNeoSummary() {
    const statsEl = document.getElementById('neoSummaryStats');
    const colsEl  = document.getElementById('neoSummaryColumns');
    if (!statsEl && !colsEl) return;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    // _isJobEffectivelyDone 사용 — thread ROOT 전체 완료도 done 처리 (옛 데이터 stale status 정확화)
    const isDone = window._isJobEffectivelyDone || _isJobDone;
    const today = new Date().toISOString().slice(0,10);
    const ym = today.slice(0,7);
    // classifyJobCategory(j) === 'new' 우선 — type 정규식보다 정확 (신규/VAN변경 등 변종 정확히 분류)
    const _cls = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory : null;
    const isNewCat = (j) => {
      if (!j || j.type === '상담') return false;
      if (_cls) return _cls(j) === 'new';
      return /신규|개업|오픈/.test(j.type||'');
    };

    const newopen = jobs.filter(isNewCat);
    const consult = jobs.filter(j => j && j.type === '상담');
    // 🛡 어른거림 방지 — 요약 데이터가 직전과 동일하면 재구축 skip
    {
      const _neoSig = 'neo|' + JSON.stringify(newopen.map(j=>[j.id,j.status||'',j.completed?1:0,j.openDate||'',j.updatedAt||0])) + '|' + JSON.stringify(consult.map(j=>[j.id,j.status||'',j.updatedAt||0]));
      if (window._sigSkip && window._sigSkip(statsEl || colsEl, _neoSig)) return;
    }

    const newopenActive = newopen.filter(j => !isDone(j));
    const consultActive = consult.filter(j => j.status === '상담중');
    const consultWon = consult.filter(j => j.status === '납품성공').length;
    const consultLost = consult.filter(j => j.status === '납품실패').length;
    // '이번달 오픈 예정' — 완료 제외 (이미 오픈된 매장은 '예정' 아님)
    const openThisMonth = newopen.filter(j => (j.openDate||'').slice(0,7) === ym && !isDone(j)).length;
    const installSoon = newopen.filter(j => {
      if (isDone(j)) return false;
      const d = (j.installDate||'').slice(0,10);
      if (!d) return false;
      return d >= today && d <= addDays(today, 14);
    }).length;

    if (statsEl) {
      const card = (label, value, sub, color) => `
        <div style="background:#fff;border:1px solid var(--gray-200);border-radius:8px;padding:10px 12px;border-top:3px solid ${color}">
          <div style="font-size:10px;color:var(--gray-500);font-weight:600">${label}</div>
          <div style="font-size:20px;font-weight:800;color:${color};margin-top:2px">${value}</div>
          <div style="font-size:10px;color:var(--gray-400);margin-top:2px">${sub}</div>
        </div>`;
      statsEl.innerHTML =
        card('신규 진행중', newopenActive.length, '완료/취소 제외', '#1D4ED8') +
        card('이번달 오픈 예정', openThisMonth, '오픈일 기준', '#16A34A') +
        card('14일 내 설치', installSoon, '설치예정일 기준', '#F59E0B') +
        card('상담 진행중', consultActive.length, '결정 대기', '#7C3AED') +
        card('상담 결정', consultWon, '신규 전환됨', '#059669') +
        card('상담 실패', consultLost, '누적', '#DC2626');
    }

    if (colsEl) {
      // 컬럼 1: 신규 진행중 (최근 5건)
      const topNew = newopenActive.slice().sort((a,b) =>
        new Date(a.openDate||a.installDate||a.softOpenDate||a.createdAt||0) -
        new Date(b.openDate||b.installDate||b.softOpenDate||b.createdAt||0)
      ).slice(0, 6);
      // 컬럼 2: 상담 진행중 (최근 5건, consultDate 기준 최신)
      const topConsult = consultActive.slice().sort((a,b) =>
        (b.consultDate || (b.createdAt||0)) > (a.consultDate || (a.createdAt||0)) ? 1 : -1
      ).slice(0, 6);

      const fmtItem = (j, kind) => {
        const store = esc(j.storeName || j.store || '-');
        const dateLabel = kind === 'new'
          ? (j.openDate ? `🎉 ${j.openDate.slice(5,10)}` : (j.installDate ? `🔧 ${j.installDate.slice(5,10)}` : '일정 미정'))
          : (j.consultDate ? `💬 ${j.consultDate.slice(5,10)}` : '상담중');
        const eqCount = Array.isArray(j.equipment) ? j.equipment.filter(e => (Number(e.qty)||0)>0).length : 0;
        const eqTxt = eqCount > 0 ? `<span style="background:#DBEAFE;color:#1D4ED8;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:700;margin-left:4px">${eqCount}품목</span>` : '';
        return `<div onclick="editNewopen('${j.id}')" style="padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;background:#fff;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;transition:background .12s" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background='#fff'">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${store}${eqTxt}</div>
            <div style="font-size:10px;color:var(--gray-500);margin-top:1px">${esc(j.type||'-')}${j.contactName ? ' · '+esc(j.contactName) : ''}</div>
          </div>
          <div style="font-size:11px;color:var(--gray-600);font-weight:600;white-space:nowrap">${dateLabel}</div>
        </div>`;
      };

      const newColHtml = topNew.length === 0
        ? `<div style="text-align:center;padding:18px;color:var(--gray-400);font-size:12px">진행중인 신규 작업이 없습니다</div>`
        : topNew.map(j => fmtItem(j, 'new')).join('');
      const consultColHtml = topConsult.length === 0
        ? `<div style="text-align:center;padding:18px;color:var(--gray-400);font-size:12px">진행중인 상담이 없습니다</div>`
        : topConsult.map(j => fmtItem(j, 'consult')).join('');

      colsEl.innerHTML = `
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--gray-700);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
            <span>📦 신규 진행중 (${newopenActive.length}건, 가까운 일정 순)</span>
            <a onclick="showScreen('newopen')" style="font-size:10px;color:#1D4ED8;cursor:pointer;font-weight:600">신규관리 →</a>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">${newColHtml}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--gray-700);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
            <span>💬 상담 진행중 (${consultActive.length}건, 최근순)</span>
            <a onclick="showScreen('consult')" style="font-size:10px;color:#7C3AED;cursor:pointer;font-weight:600">상담조회 →</a>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">${consultColHtml}</div>
        </div>`;
    }
  }
  function addDays(yyyymmdd, n) {
    const d = new Date(yyyymmdd);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0,10);
  }
  window.renderNeoSummary = renderNeoSummary;

  /* 신규관리 상단 — 이번주 + 다음주 2주 미니 캘린더 */
  function renderNewopenMiniCal() {
    const grid = document.getElementById('newopenMiniCalGrid');
    if (!grid) return;
    // 이번 주의 일요일 0:00 부터 14일치 셀 생성
    const today = new Date();
    today.setHours(0,0,0,0);
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay()); // 일요일로 이동

    // 🛡 어른거림 방지 — 2주치 일정 데이터 동일하면 재구축 skip
    {
      const _mcJobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
      const _mcSig = 'minical|' + start.toISOString().slice(0,10) + '|' + JSON.stringify(_mcJobs.map(j=>[j.id,j.installDate||'',j.softOpenDate||'',j.openDate||'',j.status||'',j.completed?1:0]));
      if (window._sigSkip && window._sigSkip(grid, _mcSig)) return;
    }

    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    // 날짜별 이벤트 매핑
    const byDate = {};
    const push = (dateStr, j, kind) => {
      const d = (dateStr||'').slice(0,10);
      if (!d) return;
      (byDate[d] = byDate[d] || []).push({ j, kind });
    };
    jobs.forEach(j => {
      // 신규/상담 모두 보이게
      push(j.installDate, j, 'install');
      push(j.softOpenDate, j, 'soft');
      push(j.openDate, j, 'open');
    });
    const kindIcon  = { install:'🔧', soft:'🌅', open:'🎉' };
    const kindColor = { install:{bg:'#FED7AA',fg:'#9A3412'}, soft:{bg:'#FECACA',fg:'#991B1B'}, open:{bg:'#A7F3D0',fg:'#065F46'} };
    const kindLabel = { install:'설치', soft:'가오픈', open:'오픈' };

    const cells = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const isToday = (d.getTime() === today.getTime());
      const dow = d.getDay();
      const events = byDate[dateStr] || [];
      const dayColor = dow === 0 ? '#DC2626' : (dow === 6 ? '#1D4ED8' : 'var(--gray-700)');
      const isCurrentWeek = (i < 7);
      const weekLabel = (i === 0) ? `<span style="font-size:9px;color:var(--gray-400);margin-left:4px">이번주</span>` :
                        (i === 7) ? `<span style="font-size:9px;color:var(--gray-400);margin-left:4px">다음주</span>` : '';
      const eventsHtml = events.map(({j, kind}) => {
        const c = kindColor[kind];
        const store = esc(j.storeName || j.store || '-');
        return `<div onclick="event.stopPropagation();editNewopen('${j.id}')"
                  title="${esc(j.storeName||j.store||'')} · ${kindLabel[kind]}"
                  style="background:${c.bg};color:${c.fg};font-size:10px;padding:3px 5px;border-radius:4px;font-weight:700;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2">
                  <span>${kindIcon[kind]}</span> ${store}
                </div>`;
      }).join('');
      cells.push(`
        <div style="background:${isToday?'#FEF9C3':'#fff'};border:${isToday?'2px solid #F59E0B':'1px solid var(--gray-200)'};border-radius:6px;padding:6px;min-height:90px;display:flex;flex-direction:column;gap:3px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;font-weight:700;color:${dayColor}">${d.getDate()}</span>
            ${weekLabel}
          </div>
          ${eventsHtml || '<div style="flex:1"></div>'}
        </div>`);
    }
    grid.innerHTML = cells.join('');
  }
  window.renderNewopenMiniCal = renderNewopenMiniCal;

  /* ── 신규관리 페이지 ── */
  function isNewopenJob(j) {
    if (!j) return false;
    if (j.type === '상담') return false; // 상담은 신규관리에서 제외
    const t = (j.type || '') + ' ' + (j.title || '');
    return /신규|개업|오픈|new\s*open/i.test(t);
  }
  function hydrateNewopen(filter) {
    let jobs = [];
    try { jobs = (typeof getJobs === 'function') ? (getJobs() || []) : []; } catch(e) {}
    const items = jobs.filter(isNewopenJob);
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    const ym = todayStr.slice(0,7);
    const isDone = _isJobDone;
    // 통계 — 미등록(미연결) 매장 작업도 동일하게 포함됨 (isNewopenJob 은 type 만 검사)
    const inProg = items.filter(j => !isDone(j) && (j.status === '진행중' || /설치|진행/i.test(j.status||''))).length;
    // 이번달 오픈 예정 = openDate 가 이번달인 작업 (등록/미등록 관계없이)
    const planned = items.filter(j => !isDone(j) && (j.openDate||'').slice(0,7) === ym).length;
    const waiting = items.filter(j => !isDone(j) && !(j.engineer || j.assignee)).length;
    // 이번달 완료 = openDate 가 이번달인 완료 작업 (없으면 installDate 로 fallback)
    const doneCnt = items.filter(j => isDone(j) && ((j.openDate||j.installDate||'').slice(0,7) === ym)).length;
    const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    setText('newopenInProgress', inProg);
    setText('newopenInProgressSub', inProg === 0 ? '진행중 작업 없음' : '진행중');
    setText('newopenThisMonth', planned);
    setText('newopenWaiting', waiting);
    setText('newopenDone', doneCnt);

    // 필터링 — 기본값 'all' 은 미완료(진행/예정)만 표시. 'done' 으로 지난 완료 보기
    let view = items.slice();
    const f = filter || 'all';
    if (f === 'all')      view = view.filter(j => !isDone(j));
    if (f === 'planned')  view = view.filter(j => !isDone(j) && j.status !== '진행중');
    if (f === 'progress') view = view.filter(j => !isDone(j) && (j.status === '진행중' || /설치|진행/i.test(j.status||'')));
    if (f === 'done')     view = view.filter(isDone);
    if (f === 'open')     view = view.filter(j => !isDone(j) && (j.lineCategory === 'open_store' || (!j.lineCategory && /신규|개업|오픈/.test(j.type||'') && !/가맹|밴|VAN/i.test(j.type||''))));
    if (f === 'vandoc')   view = view.filter(j => !isDone(j) && (j.lineCategory === 'van_doc'    || /가맹|밴|VAN/i.test(j.type||'')));
    view.sort((a,b)=> new Date(b.date||b.createdAt||0) - new Date(a.date||a.createdAt||0));

    const tb = document.getElementById('newopenTbody');
    if (!tb) return;
    // 🛡 어른거림 방지 — 필터+내용 동일하면 재구축 skip
    {
      const _noSig = 'newopen|' + (filter||'all') + '|' + JSON.stringify(view.map(j=>[j.id,j.status||'',j.completed?1:0,j.updatedAt||0,(Array.isArray(j.thread)?j.thread.length:0)]));
      if (window._sigSkip && window._sigSkip(tb, _noSig)) return;
    }
    // 디버그: 진단 정보 콘솔 출력
    try { console.log('[hydrateNewopen]', {totalJobs: jobs.length, newopenItems: items.length, viewAfterFilter: view.length, filter: filter||'all'}); } catch(e){}
    if (view.length === 0) {
      tb.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px 20px;color:var(--gray-400);font-size:13px">
        <div style="font-size:36px;margin-bottom:10px">🏗️</div>
        <div style="font-weight:700;color:var(--gray-500);margin-bottom:4px">신규 작업이 없습니다</div>
        <div style="font-size:11px">"+ 신규 등록"으로 추가하세요.</div>
      </td></tr>`;
      return;
    }
    const COLSPAN = 8;
    tb.innerHTML = view.map((j, idx) => {
      try {
        // 그룹 구분 — 매장별 배경색 번갈아 적용 (홀짝)
        const groupBg = (idx % 2 === 0) ? '#FFFFFF' : '#F1F5F9';
        const groupBorderTop = idx === 0 ? '' : 'border-top:3px solid #E2E8F0;';
      // 자동 진행률 계산 (워크플로 기반)
      const wfProg = recalcJobProgress(j);
      const status = j.status || '예정';
      let badgeCls = 'badge-blue';
      if (isDone(j)) badgeCls = 'badge-green';
      else if (/진행|설치/i.test(status) || wfProg > 0) badgeCls = 'badge-amber';
      const store = j.store || j.storeName || '-';
      const unregBadge = j.unregistered ? `<span style="margin-left:6px;background:#FEF3C7;color:#92400E;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:700">미등록</span>` : '';
      const typeBadge = `<span style="margin-left:6px;background:#EFF6FF;color:#1D4ED8;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:700">${esc(j.type||'-')}</span>`;
      // Line 출처 카테고리 뱃지 — 화면 안에서 오픈/밴서류 구분
      const lineCatBadge = (j.source === 'line' && j.lineCategory && LINE_TYPE_META[j.lineCategory])
        ? `<span style="margin-left:4px;background:${LINE_TYPE_META[j.lineCategory].bg};color:${LINE_TYPE_META[j.lineCategory].color};font-size:10px;padding:1px 6px;border-radius:4px;font-weight:700" title="Line 분류">${LINE_TYPE_META[j.lineCategory].label}</span>`
        : '';
      const addr = j.address || '-';
      const dt = jobDateStr(j).slice(0,10);
      const eng = j.engineer || j.assignee || '<span style="color:var(--danger)">미배정</span>';
      const posQty = (j.equipment && Array.isArray(j.equipment))
        ? j.equipment.filter(e => /pos|일체형/i.test(e.name||'')).reduce((s,e)=>s+(e.qty||0),0)
        : (j.posCount || j.pos || 0);
      const linkBtn = j.unregistered
        ? `<button class="btn btn-outline btn-sm" style="color:var(--warning);border-color:var(--warning);background:#FEF3C7;font-size:12px;padding:6px 10px;font-weight:700;white-space:nowrap" onclick="event.stopPropagation();linkRegisteredStore('${j.id||''}')">🔗 연결</button>`
        : (j.storeId ? `<button class="btn btn-outline btn-sm" style="color:var(--gray-700);border-color:var(--gray-400);font-size:12px;padding:6px 10px;font-weight:700;white-space:nowrap" onclick="event.stopPropagation();unlinkStore('${j.id||''}')" title="잘못 연결된 가맹점을 해제하고 미등록 상태로 되돌립니다">🔓 해제</button>` : '');
      const closeBtn = isDone(j)
        ? `<button class="btn btn-outline btn-sm" style="color:var(--gray-600);border-color:var(--gray-300);font-size:11px;padding:5px 8px;font-weight:700;white-space:nowrap" onclick="event.stopPropagation();reopenNewopen('${j.id||''}')" title="완료 처리를 되돌려 진행 목록으로 복귀">↩ 되돌리기</button>`
        : `<button class="btn btn-primary btn-sm" style="background:var(--success);color:#fff;font-size:11px;padding:5px 8px;font-weight:700;white-space:nowrap" onclick="event.stopPropagation();completeNewopen('${j.id||''}')" title="작업 종료 — 지난 완료 목록으로 이동">✓ 종료</button>`;

      // 매장 주요 일정 — 2줄 (1줄: 설치 / 2줄: 가오픈 + 오픈)
      const fmtDate = (s) => (s||'').slice(5,10).replace('-','.');
      const datePill = (label, val, color) => val
        ? `<div style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:5px;background:${color.bg};color:${color.fg};font-size:11px;font-weight:700;white-space:nowrap" title="${label} ${val}"><span style="font-weight:600">${label}</span><span>${fmtDate(val)}</span></div>`
        : `<div style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:5px;background:#F3F4F6;color:#9CA3AF;font-size:11px;font-weight:500;white-space:nowrap" title="${label} 미정"><span style="font-weight:600">${label}</span><span>—</span></div>`;
      const datesHtml = `
        <div style="display:flex;flex-direction:column;gap:4px;min-width:170px">
          <div>${datePill('설치',   j.installDate,  {bg:'#FED7AA',fg:'#9A3412'})}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            ${datePill('가오픈', j.softOpenDate, {bg:'#FECACA',fg:'#991B1B'})}
            ${datePill('오픈',   j.openDate,     {bg:'#A7F3D0',fg:'#065F46'})}
          </div>
        </div>`;

      // 담당 칸 — 대표 담당자(primary)만 노출, 다른 담당자가 더 있으면 +N 배지
      const _contactsArr = getJobContacts(j);
      const _primary = getPrimaryContact(j);
      const _moreCount = Math.max(0, _contactsArr.length - 1);
      const contactCellHtml = _primary && (_primary.name || _primary.phone)
        ? `<div style="font-size:11px;line-height:1.5">
            ${_primary.name ? `<div style="font-weight:700">⭐ ${esc(_primary.name)}${_primary.role ? ` <span style="color:var(--gray-500);font-weight:500">${esc(_primary.role)}</span>` : ''}${_moreCount > 0 ? ` <span style="background:#EFF6FF;color:#1D4ED8;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700;margin-left:2px">+${_moreCount}</span>` : ''}</div>` : ''}
            ${_primary.phone ? `<div style="color:var(--gray-600)"><a href="tel:${esc(_primary.phone)}" style="color:inherit;text-decoration:none">📞 ${esc(_primary.phone)}</a></div>` : ''}
            <div style="font-size:10px;color:var(--gray-400);margin-top:2px">엔지니어: ${eng}</div>
          </div>`
        : `<div style="font-size:12px">${eng}</div><div style="font-size:10px;color:var(--gray-400);margin-top:2px">매장 담당자 미입력</div>`;

      const wf = renderWorkflowRow(j, COLSPAN, groupBg);
      const cellBg = `background:${groupBg};${groupBorderTop}`;
      // 행 전체 클릭 시 매장 상세 — 액션 버튼은 stopPropagation 으로 분리
      return `<tr style="background:${groupBg};cursor:pointer" onclick="editNewopen('${j.id||''}')" title="클릭하여 상세 보기">
        <td style="${cellBg}"><span class="badge ${badgeCls}">${esc(status)}</span></td>
        <td style="${cellBg}">
          <b style="text-decoration:underline;text-decoration-color:transparent;transition:text-decoration-color .15s" onmouseover="this.style.textDecorationColor='currentColor'" onmouseout="this.style.textDecorationColor='transparent'">${esc(store)}</b>${unregBadge}${typeBadge}${lineCatBadge}
        </td>
        <td style="font-size:11px;color:var(--gray-500);${cellBg}">${esc(addr)}</td>
        <td style="${cellBg}">${datesHtml}</td>
        <td style="${cellBg}">${contactCellHtml}</td>
        <td style="text-align:center;font-weight:600;${cellBg}">${posQty ? posQty + '대' : '<span style="color:var(--gray-300)">—</span>'}</td>
        <td style="${cellBg}"><div style="background:var(--gray-100);border-radius:6px;height:8px;overflow:hidden;width:100%"><div style="background:var(--primary);height:100%;width:${wfProg}%"></div></div><div style="font-size:10px;color:var(--gray-400);margin-top:2px;text-align:right">${wfProg}%</div></td>
        <td style="text-align:center;${cellBg}" onclick="event.stopPropagation()">
          <div style="display:flex;flex-direction:column;gap:4px;align-items:center">
            ${closeBtn}
            ${linkBtn || ''}
          </div>
        </td>
      </tr>${wf.pillRow}${wf.detailRows}`;
      } catch(err) {
        try { console.error('[hydrateNewopen] row render error for job', j && j.id, err); } catch(e){}
        return `<tr><td colspan="8" style="padding:12px;background:#FEF2F2;color:#991B1B;font-size:12px">⚠️ 렌더링 에러 — ${esc(j&&j.id||'?')} / ${esc(j&&j.store||j&&j.storeName||'?')} : ${esc(String(err&&err.message||err))}</td></tr>`;
      }
    }).join('');
    // 모든 변경사항 저장 (workflow 자동 보강 결과)
    saveJobs(jobs);
    // 미니 캘린더도 함께 갱신
    try { renderNewopenMiniCal(); } catch(e){}
  }
  function filterNewopen(chip, filter) {
    chip.parentElement.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    hydrateNewopen(filter);
  }
  function openNewopenJob() {
    // 새 작업 모달 열고 유형을 신규으로 프리셋
    if (typeof showModal === 'function') showModal('newJobModal');
    setTimeout(() => {
      const sel = document.getElementById('jobType');
      if (sel) {
        for (const opt of sel.options) {
          if (/신규|개업|오픈/.test(opt.value || opt.textContent) && !/상담/.test(opt.value||opt.textContent)) { sel.value = opt.value || opt.textContent; break; }
        }
      }
      applyJobTypeMode();
    }, 50);
  }
  window.openNewopenJob = openNewopenJob;

  // 작업 유형에 따라 모달 모드 토글 (상담일 때 입고가 숨김 / AS 일 때 AS 패널 노출)
  function applyJobTypeMode() {
    const t = (document.getElementById('jobType')||{}).value || '';
    document.body.classList.toggle('consult-mode', t === '상담');
    const isAs = /AS/i.test(t);
    document.body.classList.toggle('as-mode', isAs);
    // 신규 모드 — 메인 jobType 이 신규 계열이거나, 신규 컨텍스트로 진입한 경우 (subcat 표시 중)
    const newSub = document.getElementById('jobNewSubcat');
    const newSubVisible = newSub && newSub.style.display !== 'none';
    const isNew = /^신규/.test(t) || t === '신규가맹' || t === 'POS 교체' || t === 'SW 변경' || t === '당사매장 인수' || newSubVisible || (window._currentJobContext === 'new');
    document.body.classList.toggle('new-mode', isNew);
    // 소모품 모드 — type 이 소모품 계열이거나 supplies 컨텍스트
    const isSupplies = /소모품|라벨|영수증|프라이스텍|택배|장비 추가/.test(t) || (window._currentJobContext === 'supplies');
    document.body.classList.toggle('supplies-mode', isSupplies);
    try { if (typeof _renderJobThread === 'function') _renderJobThread(); } catch(e){}
    // AS 세부 카테고리 셀렉트 — AS 처리 선택 시만 표시
    const asSub = document.getElementById('jobAsSubcat');
    if (asSub) asSub.style.display = isAs ? '' : 'none';
    if (isAs) {
      // AS 접수일/시간 — 모달 열 때마다 현재 시각으로 갱신
      const now = new Date();
      const parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', hour12:false,
      }).formatToParts(now).reduce((a,p)=>{ a[p.type]=p.value; return a; }, {});
      const isoLocal = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
      const recvHidden = document.getElementById('asReceivedAt');
      const recvDisp   = document.getElementById('asReceivedAtDisplay');
      if (recvHidden && !recvHidden.value) recvHidden.value = isoLocal;
      if (recvDisp) recvDisp.textContent = (recvHidden && recvHidden.value) || isoLocal;
    }
  }
  window.applyJobTypeMode = applyJobTypeMode;

  /* ─── 업무 등록 폼 — 컨텍스트 기반 카테고리 제한 ─── */
  // 호출 흐름:
  //   AS hub "+ AS 업무 등록" 클릭 → openNewJobFor('as') → 모달 표시 + applyJobFormContext('as')
  window.openNewJobFor = function(menuCat) {
    // 🛒 소모품 — 재설계된 전용 등록 폼(supplyRegModal)으로 라우팅 (app/supplies-reg.js)
    if (menuCat === 'supplies' && typeof window.openSupplyReg === 'function') {
      window._currentJobContext = 'supplies';
      window.openSupplyReg();
      return;
    }
    window._currentJobContext = menuCat;
    if (typeof showModal === 'function') showModal('newJobModal');
  };

  function applyJobFormContext(ctx) {
    const sel = document.getElementById('jobType');
    const badge = document.getElementById('jobTypeCtxBadge');
    const asSub = document.getElementById('jobAsSubcat');
    const newSub = document.getElementById('jobNewSubcat');
    const vanSub = document.getElementById('jobVanSubcat');
    if (!sel) return;
    // 메인 jobType 셀렉트 복원 (이전에 hide 됐을 수 있음)
    sel.style.display = '';
    // 일단 모든 서브 카테고리 셀렉트 숨김
    [asSub, newSub, vanSub].forEach(el => { if (el) { el.style.display = 'none'; el.value = ''; } });
    // jobType 셀렉트 옵션 활성/비활성
    Array.from(sel.options).forEach(o => { o.disabled = false; o.hidden = false; });

    if (!ctx) {
      if (badge) badge.style.display = 'none';
      return;
    }

    if (ctx === 'as') {
      // AS 처리만 활성, 다른 옵션 숨김
      Array.from(sel.options).forEach(o => {
        const isAs = /AS/i.test(o.value);
        o.disabled = !isAs;
        o.hidden = !isAs;
      });
      sel.value = 'AS 처리';
      if (asSub) asSub.style.display = '';
      if (badge) { badge.style.display = ''; badge.textContent = '🔧 AS 메뉴 진입 — AS 카테고리만 등록'; }
      applyJobTypeMode();
      // AS 진입 — 스레드의 ＋ 새 요청 접수 폼 자동 펼침 (매장 미선택 상태)
      try {
        window._jobThreadDraft = [];
        const openKey = '_threadOpen_draft';
        window[openKey] = window[openKey] || {};
        window[openKey]['__newroot__'] = true;
        if (typeof window._renderThreadGroups === 'function') {
          window._renderThreadGroups('jobThreadContainer', [], { editable:true, jobId:null, draftMode:true });
        }
      } catch(e){}
    } else if (ctx === 'new') {
      // 신규 메뉴 — 메인 jobType 셀렉트는 숨기고, jobNewSubcat 하나로 통합
      // 세부 옵션: 신규/오픈, 신규/프로그램교체, 신규/VAN변경
      sel.style.display = 'none';
      sel.value = '신규'; // 내부 호환 (saveNewJob 에서 subcat 우선)
      if (newSub) {
        newSub.style.display = '';
        newSub.style.marginTop = '0';
        if (!newSub.value) newSub.value = '신규/오픈';
      }
      if (badge) { badge.style.display = ''; badge.textContent = '🆕 신규 메뉴 진입 — 세부 카테고리 선택'; }
      applyJobTypeMode();
    } else if (ctx === 'van') {
      // VAN: 신규가맹 사용
      Array.from(sel.options).forEach(o => {
        const isVan = o.value === '신규가맹' || o.value === 'VAN사 변경';
        o.disabled = !isVan;
        o.hidden = !isVan;
      });
      sel.value = '신규가맹';
      if (vanSub) vanSub.style.display = '';
      if (badge) { badge.style.display = ''; badge.textContent = '📑 VAN 메뉴 진입 — VAN 카테고리만 등록'; }
      applyJobTypeMode();
    } else if (ctx === 'supplies') {
      // 소모품: 작업 유형 셀렉트 숨김 — 대신 품목 아이콘 카드로 type 결정
      // sel 자체 숨김 + 기본값 '소모품/기타' 로 (아이콘 클릭 시 덮어쓰기)
      sel.style.display = 'none';
      sel.value = '소모품/기타';
      // 모든 picker 카드 active 해제 + 발송일 오늘로 초기화
      document.querySelectorAll('#suppliesPicker .sup-pick').forEach(b => b.classList.remove('active'));
      const pickedTypeEl = document.getElementById('suppliesPickedType');
      if (pickedTypeEl) pickedTypeEl.value = '';
      const pickedLabel = document.getElementById('suppliesPickedLabel');
      if (pickedLabel) pickedLabel.textContent = '품목 미선택';
      const ship = document.getElementById('jobShipDate');
      if (ship && !ship.value) {
        const today = (typeof _kstNow === 'function') ? String(_kstNow()||'').slice(0,10) : new Date().toISOString().slice(0,10);
        ship.value = today;
      }
      if (badge) { badge.style.display = ''; badge.textContent = '🏷️ 소모품 등록 — 품목 선택 후 발송일 입력'; }
      // 처리 구분 기본 — 지원
      const supModeRd = document.querySelector('input[name="jobSupplyMode"][value="support"]');
      if (supModeRd) supModeRd.checked = true;
      if (typeof window.onSupplyModeChange === 'function') window.onSupplyModeChange();
      applyJobTypeMode();
    }
  }
  window.applyJobFormContext = applyJobFormContext;

  // 💳 처리 구분별 상세 모달 — 선불/후불/지원
  window.openSuppliesBreakdown = function(mode) {
    if (typeof _suppliesStats !== 'function') return;
    const stats = _suppliesStats();
    const title = document.getElementById('suppliesBreakdownTitle');
    const summary = document.getElementById('suppliesBreakdownSummary');
    const colAmt = document.getElementById('suppliesBreakdownColAmt');
    const colAct = document.getElementById('suppliesBreakdownColAct');
    const tbody = document.getElementById('suppliesBreakdownTbody');
    if (!tbody) return;
    const fmt = n => (Number(n)||0).toLocaleString();
    const escFn = (typeof esc === 'function') ? esc : (s)=>String(s||'');
    let rows = [];
    let titleTxt = '', sumTxt = '', amtCol = '금액', actCol = '';
    if (mode === 'prepaid') {
      titleTxt = '💰 판매 · 선불 상세';
      sumTxt = `${stats.prepaidRows.length}건 · 이번달 ${fmt(stats.prepaidThisMonth)}원 / 누적 ${fmt(stats.prepaidTotal)}원`;
      rows = stats.prepaidRows.slice().sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
      amtCol = '판매가';
      actCol = '';
    } else if (mode === 'postpaid') {
      titleTxt = '📌 판매 · 후불 (미수) 상세';
      sumTxt = `미수 ${stats.arRows.length}건 ${fmt(stats.arAmount)}원 · 수금완료 ${stats.postpaidPaidRows.length}건 ${fmt(stats.postpaidPaidTotal)}원`;
      // 미수 먼저, 수금완료 나중 — 같은 그룹은 발송일 최신순
      const ar = stats.arRows.slice().sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
      const paid = stats.postpaidPaidRows.slice().sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
      rows = ar.concat(paid);
      amtCol = '미수금 / 수금액';
      actCol = '수금 처리';
    } else if (mode === 'support') {
      titleTxt = '🎁 지원 (무상) 상세';
      sumTxt = `${stats.supportRows.length}건 · 이번달 ${stats.supportThisMonth}건 / 누적 ${stats.supportTotal}건`;
      rows = stats.supportRows.slice().sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
      amtCol = '구분';
      actCol = '';
    }
    if (title) title.textContent = titleTxt;
    if (summary) summary.textContent = sumTxt;
    if (colAmt) colAmt.textContent = amtCol;
    if (colAct) colAct.textContent = actCol;
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:30px;text-align:center;color:var(--gray-400);font-size:12px">데이터가 없습니다</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r => {
        const linkOpen = r.jobId ? `closeModal('suppliesBreakdownModal');setTimeout(()=>{try{editNewopen('${escFn(r.jobId)}')}catch(e){}},120)` : '';
        let amtCell = '';
        let actCell = '';
        if (mode === 'prepaid') {
          amtCell = `<b style="color:#06B6D4">${fmt(r.amount)}원</b>`;
        } else if (mode === 'postpaid') {
          if (r.isPaid) {
            amtCell = `<span style="color:var(--gray-500)">${fmt(r.paidAmt)}원 (수금완료)</span>`;
            actCell = `<button onclick="event.stopPropagation();revertSupplyArPay('${escFn(r.jobId)}')" style="background:var(--gray-200);color:var(--gray-700);border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:700">↩ 되돌리기</button>`;
          } else {
            const out = r.outstanding != null ? r.outstanding : r.amount;
            const partial = r.paidAmt > 0 ? ` <span style="font-size:10px;color:var(--gray-500)">(부분 ${fmt(r.paidAmt)})</span>` : '';
            amtCell = `<b style="color:#F59E0B">${fmt(out)}원</b>${partial}`;
            actCell = `<button onclick="event.stopPropagation();collectSupplyAr('${escFn(r.jobId)}')" style="background:#15803d;color:#fff;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:700">＋ 수금</button>`;
          }
        } else if (mode === 'support') {
          amtCell = `<span style="color:#15803d;font-weight:700">🎁 지원</span>`;
        }
        return `<tr style="border-bottom:1px solid var(--gray-100);cursor:${linkOpen?'pointer':'default'}" ${linkOpen?`onclick="${linkOpen}"`:''} onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background=''">
          <td style="padding:9px 12px"><b>${escFn(r.store)}</b></td>
          <td style="padding:9px 12px">${escFn(r.item)}</td>
          <td style="padding:9px 12px;font-size:11.5px;color:var(--gray-600)">${escFn(r.date||'-')}</td>
          <td style="padding:9px 12px;text-align:right">${amtCell}</td>
          <td style="padding:9px 12px;text-align:center">${actCell}</td>
        </tr>`;
      }).join('');
    }
    if (typeof showModal === 'function') showModal('suppliesBreakdownModal');
  };

  // 💵 수금 처리 — 후불(미수) 작업에 수금 금액 입력
  window.collectSupplyAr = function(jobId) {
    if (!jobId) return;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const i = jobs.findIndex(j => j.id === jobId);
    if (i < 0) { if (typeof showToast === 'function') showToast('⚠ 작업을 찾을 수 없습니다'); return; }
    const j = jobs[i];
    const totalAmt = Number(j.amount) || 0;
    const prevPaid = Number(j.arPaidAmount) || 0;
    const remaining = Math.max(0, totalAmt - prevPaid);
    const input = prompt(
      `💵 수금 금액 입력\n\n매장: ${j.storeName||j.store||'-'}\n품목: ${j.type||'-'}\n총 판매가: ${totalAmt.toLocaleString()}원\n기 수금: ${prevPaid.toLocaleString()}원\n남은 미수: ${remaining.toLocaleString()}원\n\n이번에 받은 금액을 입력하세요 (전액이면 ${remaining} 입력):`,
      String(remaining)
    );
    if (input == null) return;
    const collected = parseInt(String(input).replace(/[^\d]/g,''), 10);
    if (!Number.isFinite(collected) || collected <= 0) {
      if (typeof showToast === 'function') showToast('⚠ 0보다 큰 금액을 입력하세요');
      return;
    }
    const newPaid = Math.min(totalAmt, prevPaid + collected);
    j.arPaidAmount = newPaid;
    if (newPaid >= totalAmt) {
      j.arPaid = true;
      j.arPaidAt = new Date().toISOString();
      // 전액 수금 시 자동 완료 처리
      j.status = '완료';
      j.completed = true;
      j.completedAt = j.completedAt || new Date().toISOString();
      j.doneAt = j.doneAt || new Date().toISOString();
    } else {
      j.arPaid = false;  // 부분 수금만
    }
    // 메모 자동 기록
    if (!Array.isArray(j.memos)) j.memos = [];
    const ts = (typeof _kstStamp === 'function') ? _kstStamp() : new Date().toISOString().slice(0,16).replace('T',' ');
    const by = (typeof _currentUserName === 'function') ? _currentUserName() : '';
    j.memos.push({ at: ts, author: by, text: `💵 수금 ${collected.toLocaleString()}원 입금 (누적 ${newPaid.toLocaleString()}/${totalAmt.toLocaleString()})${newPaid >= totalAmt ? ' — 전액 수금 완료' : ''}` });
    j.updatedAt = Date.now();
    jobs[i] = j;
    if (typeof saveJobs === 'function') saveJobs(jobs);
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(_){}
    if (typeof showToast === 'function') {
      showToast(newPaid >= totalAmt
        ? `✅ 전액 수금 완료 — 작업 종료 처리됨`
        : `💵 ${collected.toLocaleString()}원 수금 — 잔액 ${(totalAmt-newPaid).toLocaleString()}원`);
    }
    // 모달 새로고침
    if (typeof window.openSuppliesBreakdown === 'function') window.openSuppliesBreakdown('postpaid');
    if (typeof window.renderSuppliesHub === 'function') window.renderSuppliesHub();
  };

  // ↩ 수금 되돌리기
  window.revertSupplyArPay = function(jobId) {
    if (!jobId) return;
    if (!confirm('이 작업의 수금 처리를 되돌리시겠습니까?\n미수금으로 환원되고 작업 상태도 진행중으로 돌아갑니다.')) return;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const i = jobs.findIndex(j => j.id === jobId);
    if (i < 0) return;
    const j = jobs[i];
    j.arPaid = false;
    j.arPaidAmount = 0;
    j.arPaidAt = '';
    // status 환원 — completedAt 은 흔적 유지 (감사용)
    j.status = '요청접수';
    j.completed = false;
    j.doneAt = '';
    if (!Array.isArray(j.memos)) j.memos = [];
    const ts = (typeof _kstStamp === 'function') ? _kstStamp() : new Date().toISOString().slice(0,16).replace('T',' ');
    const by = (typeof _currentUserName === 'function') ? _currentUserName() : '';
    j.memos.push({ at: ts, author: by, text: '↩ 수금 처리 되돌림 — 미수금 상태로 환원' });
    j.updatedAt = Date.now();
    jobs[i] = j;
    if (typeof saveJobs === 'function') saveJobs(jobs);
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(_){}
    if (typeof showToast === 'function') showToast('↩ 미수금으로 환원되었습니다');
    if (typeof window.openSuppliesBreakdown === 'function') window.openSuppliesBreakdown('postpaid');
    if (typeof window.renderSuppliesHub === 'function') window.renderSuppliesHub();
  };

  // 💳 처리 구분 변경 — 지원/선불/후불 chip + 금액 row + 수금예정일 row toggle
  window.onSupplyModeChange = function() {
    const mode = (document.querySelector('input[name="jobSupplyMode"]:checked') || {}).value || 'support';
    document.querySelectorAll('#supplyModeRow .sup-mode').forEach(lb => {
      lb.classList.toggle('active', lb.dataset.mode === mode);
    });
    const amtRow = document.getElementById('supplyAmountRow');
    if (amtRow) amtRow.style.display = (mode === 'support') ? 'none' : 'flex';
    const hint = document.getElementById('supplyAmountHint');
    if (hint) hint.textContent = mode === 'prepaid' ? '선불 — 즉시 매출 집계' : mode === 'postpaid' ? '후불 — 미수금 발생, 수금 후 완료' : '';
    // 수금 예정일 row — 후불일 때만 노출
    const dueRow = document.getElementById('supplyArDueRow');
    if (dueRow) dueRow.style.display = (mode === 'postpaid') ? 'flex' : 'none';
  };

  // 🏷️ 소모품 품목별 단위 매핑 — POS용지=박스, 나머지 라벨류=롤
  const SUPPLY_UNIT_MAP = {
    '소모품/POS용지':   '박스',
    '소모품/단말용지':  '롤',
    '소모품/가격라벨':  '롤',
    '소모품/프라이스텍':'롤',
    '소모품/저울라벨':  '박스',
    '소모품/기타':      '개',
  };
  // 🏷️ 소모품 picker — 아이콘 카드 클릭 시 jobType 설정 + 시각 active 표시 + 단위 자동
  window.pickSupplyItem = function(btn) {
    if (!btn) return;
    const type = btn.getAttribute('data-sup-type') || '소모품/기타';
    const name = btn.getAttribute('data-sup-name') || '기타 소모품';
    document.querySelectorAll('#suppliesPicker .sup-pick').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const sel = document.getElementById('jobType');
    if (sel) sel.value = type;
    const hidden = document.getElementById('suppliesPickedType');
    if (hidden) hidden.value = type;
    const label = document.getElementById('suppliesPickedLabel');
    if (label) label.textContent = `✓ 선택: ${name}`;
    // 단위 자동 셋팅
    const unitEl = document.getElementById('jobSupplyUnit');
    if (unitEl) unitEl.value = SUPPLY_UNIT_MAP[type] || '개';
    // 🏷️ 기타 품목명 입력란 — 기타 선택 시만 노출 + 포커스
    const etcRow = document.getElementById('suppliesEtcRow');
    const etcInp = document.getElementById('jobSupplyEtcName');
    if (etcRow) {
      if (type === '소모품/기타') {
        etcRow.style.display = 'block';
        if (etcInp) setTimeout(() => etcInp.focus(), 50);
      } else {
        etcRow.style.display = 'none';
        if (etcInp) etcInp.value = '';
      }
    }
  };

  /* ─── 폼 매장/입력 초기화 — 모달 열 때마다 호출 ─── */
  function _resetJobForm() {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); };
    // 매장
    setVal('jobStoreName', '');
    const bizEl = document.getElementById('jobStorePickedBiz');
    if (bizEl) bizEl.textContent = '-';
    const ceoEl = document.getElementById('jobStorePickedCeo');
    if (ceoEl) ceoEl.textContent = '';
    const pickedInfo = document.getElementById('jobStorePickedInfo');
    if (pickedInfo) pickedInfo.style.display = 'none';
    const vanProfileEl = document.getElementById('jobStoreVanProfile');
    if (vanProfileEl) { vanProfileEl.style.display = 'none'; vanProfileEl.innerHTML = ''; }
    const unregNotice = document.getElementById('unregNotice');
    if (unregNotice) unregNotice.style.display = 'none';
    // 동일 매장 배너 숨김 (매장이 비었으니 표시할 게 없음)
    const simBanner = document.getElementById('jobSimilarBanner');
    if (simBanner) simBanner.style.display = 'none';
    const simList = document.getElementById('jobSimList');
    if (simList) simList.style.display = 'none';
    const simToggle = document.getElementById('jobSimToggle');
    if (simToggle) simToggle.innerHTML = '펼쳐보기 ▼';
    // 일정/메모/AS 접수
    setVal('jobInstallDate', '');
    setVal('jobSoftOpenDate', '');
    setVal('jobOpenDate', '');
    setVal('jobShipDate', '');
    setVal('asReceivedAt', '');
    setVal('asProcessDate', '');
    setVal('jobNotes', '');
    setVal('jobConsultDate', '');
    // 소모품 picker 초기화
    document.querySelectorAll('#suppliesPicker .sup-pick').forEach(b => b.classList.remove('active'));
    setVal('suppliesPickedType', '');
    setVal('jobSupplyRequest', '');
    setVal('jobSupplyAmount', '');
    setVal('jobSupplyQty', '1');
    setVal('jobSupplyUnit', '박스');  // select 기본값 — 품목 클릭 시 매핑값으로 덮어씀
    setVal('jobSupplyArDue', '');
    setVal('jobSupplyEtcName', '');
    const etcRow = document.getElementById('suppliesEtcRow');
    if (etcRow) etcRow.style.display = 'none';
    const supDone = document.getElementById('jobSupplyDoneNow');
    if (supDone) supDone.checked = false;
    const supLbl = document.getElementById('suppliesPickedLabel');
    if (supLbl) supLbl.textContent = '품목 미선택';
    // 처리 구분 — 지원 기본
    const supRd = document.querySelector('input[name="jobSupplyMode"][value="support"]');
    if (supRd) supRd.checked = true;
    if (typeof window.onSupplyModeChange === 'function') window.onSupplyModeChange();
    // jobType select 표시 복원 (supplies 컨텍스트에서 숨겼던 경우 대비)
    const _jt = document.getElementById('jobType');
    if (_jt) _jt.style.display = '';
    // 서브 카테고리
    setVal('jobAsSubcat', '');
    setVal('jobNewSubcat', '');
    setVal('jobVanSubcat', '');
    // 담당자
    const eng = document.getElementById('jobEngineer'); if (eng) eng.value = '';
    // AS 투입 장비 임시 목록 초기화 + 렌더
    window._asEquipDraft = [];
    try { _renderAsEquipList(); } catch(e){}
    // 신규 — 요청사항 스레드 + VAN 서류 임시 목록 초기화 + 렌더
    window._jobThreadDraft = [];
    window._jobThreadJobId = null;
    window._jobVandocsDraft = { van:{status:'접수',tid:'',serial:''}, easy:{status:'접수',tid:''}, kakao:{status:'접수',tid:''} };
    try { if (typeof window._renderThreadGroups === 'function') window._renderThreadGroups('jobThreadContainer', window._jobThreadDraft, { editable:true, jobId:null, draftMode:true }); } catch(e){}
    // 신규 폼의 VAN 섹션은 read-only — 매장 선택 시 store.vanProfile/payProfile 표시
    try { if (typeof _renderStoreVanInfoReadonly === 'function') _renderStoreVanInfoReadonly('jobVandocsContainer', '', ''); } catch(e){}
    // 장비 카운터 (당구공) — buildBallSelectors 가 다시 그리지만 데이터 카운터는 별도
    try { if (typeof _resetEquipCounters === 'function') _resetEquipCounters(); } catch(e){}
    // 등록 직후 다시 열 때 잔여 selected store id 도 초기화
    try { window._currentJobPickedStoreId = null; } catch(e){}
  }
  window._resetJobForm = _resetJobForm;

  /* ══════════════════════════════════════════════
     VAN 업무 등록 전용 모달 — 신규 폼과 분리

     데이터 모델:
       job = {
         id, type:'VAN/신규등록'(또는 다른 카테고리), lineCategory:'van_doc',
         storeId, storeName, date(업무일), engineer,
         thread:[{ROOT 자동생성 — 등록 요약}],
         vanRegistration: {
           cardAcquire: { applyDate, completeDate, note },
           vans: [ { brand, tid, serial? } ],
           pay:  [ { brand, tid } ],
         },
         memo, createdAt, _whoCreated,
       }

     매장에도 누적 저장 (재사용 위해):
       store.vanProfile.<BRAND> = { tid, serial?, updatedAt, sourceJobId }
       store.payProfile.<BRAND> = { tid, updatedAt, sourceJobId }
  ══════════════════════════════════════════════ */
  let _vanPickedStore = null;       // 선택된 매장 객체
  let _vanUnregMode = false;

  window.openVanJobModal = function(jobId) {
    _resetVanJobForm();
    if (typeof showModal === 'function') showModal('vanJobModal');
    // 담당자 옵션 채우기 (newJobModal 의 jobEngineer 로직 재활용 — 간단 복제)
    try { _vanFillEngineerOptions(); } catch(e){}
    // 업무일 + 가맹 신청일 기본값: 오늘 (KST)
    const today = (function(){
      // 🕐 KST 날짜 — 브라우저 타임존 무관 절대 보정 (UTC+9). 기존 getTimezoneOffset 방식은
      //   브라우저가 이미 KST 면 +9h 이중 적용 → 오후 등록이 다음날로 밀리는 버그. (2026-05-28 fix)
      return new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10);
    })();
    const d = document.getElementById('vanJobDate');
    if (d && !d.value) d.value = today;
    const ca = document.getElementById('vanCardApply');
    if (ca && !ca.value) ca.value = today;

    // 편집 모드 — 기존 job 데이터 로드
    const editIdEl = document.getElementById('vanJobEditId');
    if (editIdEl) editIdEl.value = '';
    let initialAtts = [];
    let editJob = null;
    if (jobId) {
      try {
        const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        editJob = jobs.find(j => j.id === jobId) || null;
      } catch(_){}
      if (editJob) {
        if (editIdEl) editIdEl.value = jobId;
        // 카테고리 (VAN/신규등록/재신고/정산/계약/변경)
        try {
          const cat = (editJob.type || '').replace('VAN/','');
          document.querySelectorAll('#vanCatList .van-cat-chip').forEach(ch => {
            ch.classList.toggle('active', (ch.dataset.cat||'').includes(cat));
          });
        } catch(_){}
        // 매장
        try {
          if (editJob.storeId) {
            const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
            const s = stores.find(x => x.id === editJob.storeId);
            if (s) { _vanPickedStore = s; }
          }
          const nameEl = document.getElementById('vanStoreName');
          if (nameEl) nameEl.value = editJob.storeName || editJob.store || '';
          // 미등록 모드 복원
          if (editJob.unregStore) {
            _vanUnregMode = true;
            const unregForm = document.getElementById('vanUnregForm'); if (unregForm) unregForm.style.display = '';
            ['Name','Biz','Ceo','Tel','Addr'].forEach(k => {
              const el = document.getElementById('vanUnreg'+k);
              if (el) el.value = editJob.unregStore[k.toLowerCase()] || editJob.unregStore[k.charAt(0).toLowerCase()+k.slice(1)] || '';
            });
          }
        } catch(_){}
        // 업무일, 담당자
        if (d)  d.value  = editJob.date || today;
        const eng = document.getElementById('vanJobEngineer');
        if (eng) eng.value = editJob.engineer || editJob.assignee || '';
        // 거래처 담당자
        ['Name','Role','Phone'].forEach(k => {
          const el = document.getElementById('vanContact'+k);
          const key = 'contact'+k;
          if (el) el.value = editJob[key] || '';
        });
        // 카드 가맹
        const vr = editJob.vanRegistration || {};
        if (vr.cardAcquire) {
          if (ca) ca.value = vr.cardAcquire.applyDate || today;
          const cc = document.getElementById('vanCardComplete'); if (cc) cc.value = vr.cardAcquire.completeDate || '';
        }
        // VAN사
        (vr.vans || []).forEach(v => {
          const cb = document.querySelector(`#vanPickRow input[data-van="${v.brand}"]`);
          if (cb) { cb.checked = true; try { _vanFormToggleVan(v.brand, true); } catch(_){} }
          const tEl = document.querySelector(`#vanDetailList input[data-van-field="${v.brand}.tid"]`); if (tEl) tEl.value = v.tid || '';
          const sEl = document.querySelector(`#vanDetailList input[data-van-field="${v.brand}.serial"]`); if (sEl) sEl.value = v.serial || '';
        });
        // 간편결제
        (vr.pay || []).forEach(p => {
          if (p.brand === '간편결제') {
            const c = document.getElementById('payCheckSimple'); const i = document.getElementById('payInputSimple');
            if (c) { c.checked = true; } if (i) { i.disabled = false; i.value = p.tid || ''; }
          } else if (p.brand === '카카오페이') {
            const c = document.getElementById('payCheckKakao'); const i = document.getElementById('payInputKakao');
            if (c) { c.checked = true; } if (i) { i.disabled = false; i.value = p.tid || ''; }
          }
        });
        // 첨부
        initialAtts = Array.isArray(editJob.attachments) ? editJob.attachments : [];
        // 등록 버튼 라벨 변경
        try {
          const footer = document.querySelector('#vanJobModal .modal-footer .btn.btn-primary');
          if (footer) footer.textContent = '💾 변경 저장';
        } catch(_){}
      }
    } else {
      // 신규 등록 모드 — 버튼 원복
      try {
        const footer = document.querySelector('#vanJobModal .modal-footer .btn.btn-primary');
        if (footer) footer.textContent = '+ VAN 업무 등록';
      } catch(_){}
    }

    // 📷📎 uploader mount (편집 시 기존 첨부 로딩)
    try {
      const box = document.getElementById('vanJobUploader');
      if (box && window.NS_UPLOAD) {
        window._vanJobUploaderCtl = window.NS_UPLOAD.mount(box, {
          initial: initialAtts, category: 'van', max: 30,
        });
      }
    } catch(e){ console.warn('vanJob uploader mount failed', e); }

    // 📋 thread 렌더 — 신규 모드는 draft (등록 전 요청접수/진행/완료 입력 가능), 편집 모드는 실제 thread
    try {
      const threadBox = document.getElementById('vanJobThread');
      const notSaved  = document.getElementById('vanJobThreadNotSaved');
      if (notSaved) notSaved.style.display = 'none';  // 안내문은 항상 숨김 — draft 모드로 직접 입력 가능
      if (editJob && editJob.id) {
        if (threadBox && typeof window._renderThreadGroups === 'function') {
          window._renderThreadGroups('vanJobThread', editJob.thread || [], {
            editable: true,
            jobId: editJob.id,
            draftMode: false,
          });
        }
      } else {
        // 신규 모드 — draft 배열로 등록 전에도 요청접수/진행/완료 기록 가능 (_submitNewRoot 가 window._jobThreadDraft 사용)
        window._jobThreadDraft = [];
        if (threadBox && typeof window._renderThreadGroups === 'function') {
          window._renderThreadGroups('vanJobThread', window._jobThreadDraft, {
            editable: true,
            jobId: null,
            draftMode: true,
          });
        }
      }
    } catch(e){ console.warn('[openVanJobModal thread render]', e); }
  };

  function _resetVanJobForm() {
    _vanPickedStore = null;
    _vanUnregMode = false;
    const get = (id) => document.getElementById(id);
    ['vanStoreName','vanCardApply','vanCardComplete','payInputSimple','payInputKakao',
     'vanUnregName','vanUnregBiz','vanUnregCeo','vanUnregTel','vanUnregAddr',
     'vanContactName','vanContactRole','vanContactPhone'].forEach(id => { const el=get(id); if(el)el.value=''; });
    const pick = get('vanStorePickedInfo'); if(pick)pick.style.display='none';
    const unreg = get('vanUnregForm'); if(unreg)unreg.style.display='none';
    const unregBtn = get('vanUnregBtn'); if(unregBtn){unregBtn.style.background='none';unregBtn.style.color='var(--gray-500)';}
    // 카테고리 — 신규등록 active
    document.querySelectorAll('#vanCatList .van-cat-chip').forEach((c,i)=>c.classList.toggle('active', i===0));
    // VAN 사 체크 모두 해제 + detail 행 숨김
    document.querySelectorAll('#vanPickRow input[type=checkbox]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#vanDetailList .van-detail').forEach(r => r.style.display = 'none');
    document.querySelectorAll('#vanDetailList input[type=text]').forEach(i => i.value = '');
    // 간편결제 체크 해제
    ['payCheckSimple','payCheckKakao'].forEach(id => { const el=get(id); if(el){el.checked=false;} });
    if (get('payInputSimple')) get('payInputSimple').disabled = true;
    if (get('payInputKakao'))  get('payInputKakao').disabled = true;
    const lineChk = get('vanJobLineSend'); if (lineChk) lineChk.checked = false;
    const editIdEl = get('vanJobEditId'); if (editIdEl) editIdEl.value = '';
    // thread / 푸터 라벨 / 미등록 폼 초기화
    const threadBox = get('vanJobThread'); if (threadBox) threadBox.innerHTML = '';
    const notSaved  = get('vanJobThreadNotSaved'); if (notSaved) notSaved.style.display = 'none';
    // draft 비우기 — openVanJobModal 에서 다시 채움
    window._jobThreadDraft = [];
    try {
      const footer = document.querySelector('#vanJobModal .modal-footer .btn.btn-primary');
      if (footer) footer.textContent = '+ VAN 업무 등록';
    } catch(_){}
  }

  function _vanFillEngineerOptions() {
    const sel = document.getElementById('vanJobEngineer');
    if (!sel) return;
    sel.innerHTML = '<option value="">담당자 선택...</option>';
    try {
      const users = JSON.parse(localStorage.getItem('ns_users')||'[]');
      users.filter(u=>u && u.name).forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.name; opt.textContent = u.name;
        sel.appendChild(opt);
      });
      // 현재 사용자 이름 기본 선택
      const me = (typeof _currentAuthName === 'function') ? _currentAuthName() : '';
      if (me) sel.value = me;
    } catch(e){}
  }

  // 카테고리 칩 클릭
  document.addEventListener('click', (e) => {
    const c = e.target.closest('#vanCatList .van-cat-chip');
    if (!c) return;
    document.querySelectorAll('#vanCatList .van-cat-chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
  });

  window._vanFormToggleVan = function(brand, checked) {
    const row = document.querySelector(`#vanDetailList .van-detail[data-van="${brand}"]`);
    if (row) row.style.display = checked ? '' : 'none';
    if (!checked) row?.querySelectorAll('input[type=text]').forEach(i => i.value = '');
  };

  window.toggleVanUnregStore = function() {
    _vanUnregMode = !_vanUnregMode;
    const f = document.getElementById('vanUnregForm');
    const btn = document.getElementById('vanUnregBtn');
    const search = document.getElementById('vanStoreName');
    const pick = document.getElementById('vanStorePickedInfo');
    if (_vanUnregMode) {
      f.style.display = '';
      btn.style.background = '#92400E'; btn.style.color = '#fff'; btn.textContent = '× 미등록 모드';
      _vanPickedStore = null;
      if (search) search.value = '';
      if (pick) pick.style.display = 'none';
    } else {
      f.style.display = 'none';
      btn.style.background = 'none'; btn.style.color = 'var(--gray-500)'; btn.textContent = '+ 미등록 가맹점';
    }
  };

  window._resetVanStorePickInfo = function() {
    _vanPickedStore = null;
    const el = document.getElementById('vanStorePickedInfo');
    if (el) el.style.display = 'none';
  };

  window.runVanStoreSearch = function() {
    if (_vanUnregMode) return;
    const q = (document.getElementById('vanStoreName')?.value || '').trim();
    const scope = (document.querySelector('input[name="vanStoreScope"]:checked')?.value) || 'name_biz';
    const results = document.getElementById('vanStoreResults');
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
      return `<div onmousedown="event.preventDefault();_vanPickStore('${(s.id||'').replace(/'/g,'')}')" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--gray-100);font-size:12px" onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background=''">
        <div style="font-weight:700">${(s.name||'').replace(/[<>&]/g,'')}${sigName ? ` <span style="font-size:11px;color:#1d4ed8;font-weight:600">🪧 ${sigName}</span>` : ''}</div>
        <div style="font-size:10.5px;color:var(--gray-500)">${(s.biz||'-')} · ${(s.ceo||'-')} · ${(s.addr||'-').slice(0,40)}</div>
      </div>`;
    }).join('');
    results.style.display = 'block';
  };

  window._vanPickStore = function(storeId) {
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const s = stores.find(x => x.id === storeId);
    if (!s) return;
    _vanPickedStore = s;
    const input = document.getElementById('vanStoreName');
    if (input) input.value = s.name || '';
    const info = document.getElementById('vanStorePickedInfo');
    const biz = document.getElementById('vanStorePickedBiz');
    const ceo = document.getElementById('vanStorePickedCeo');
    if (info) info.style.display = '';
    if (biz) biz.textContent = s.biz || '-';
    if (ceo) ceo.textContent = s.ceo ? `대표: ${s.ceo}` : '';
    const results = document.getElementById('vanStoreResults');
    if (results) results.style.display = 'none';
    // 기존에 등록된 VAN/간편결제 프로필 prefill
    _vanPrefillFromStore(s);
  };

  function _vanPrefillFromStore(s) {
    if (!s) return;
    const vp = s.vanProfile || {};
    ['KOCES','NICE','KIS','KSNET'].forEach(b => {
      const entry = vp[b];
      if (entry && entry.tid) {
        const cb = document.querySelector(`#vanPickRow input[data-van="${b}"]`);
        if (cb && !cb.checked) { cb.checked = true; window._vanFormToggleVan(b, true); }
        const tid = document.querySelector(`#vanDetailList input[data-van-field="${b}.tid"]`);
        const ser = document.querySelector(`#vanDetailList input[data-van-field="${b}.serial"]`);
        if (tid) tid.value = entry.tid || '';
        if (ser) ser.value = entry.serial || '';
      }
    });
    const pp = s.payProfile || {};
    if (pp['간편결제'] && pp['간편결제'].tid) {
      document.getElementById('payCheckSimple').checked = true;
      const inp = document.getElementById('payInputSimple');
      inp.disabled = false; inp.value = pp['간편결제'].tid;
    }
    if (pp['카카오페이'] && pp['카카오페이'].tid) {
      document.getElementById('payCheckKakao').checked = true;
      const inp = document.getElementById('payInputKakao');
      inp.disabled = false; inp.value = pp['카카오페이'].tid;
    }
  }

  window.saveVanJob = function(opts) {
    opts = opts || {};
    const cat = document.querySelector('#vanCatList .van-cat-chip.active')?.dataset.cat || 'VAN/신규등록';
    let storeId = '', storeName = '', store = null;
    if (_vanUnregMode) {
      storeName = (document.getElementById('vanUnregName')?.value||'').trim();
      if (!storeName) { showToast && showToast('미등록 가맹점 점포명을 입력하세요'); return; }
    } else {
      if (!_vanPickedStore) { showToast && showToast('매장을 선택하세요'); return; }
      store = _vanPickedStore;
      storeId = store.id;
      storeName = store.name;
    }
    const date = document.getElementById('vanJobDate')?.value || '';
    const engineer = document.getElementById('vanJobEngineer')?.value || '';
    const cardAcquire = {
      applyDate:    document.getElementById('vanCardApply')?.value || '',
      completeDate: document.getElementById('vanCardComplete')?.value || '',
    };
    const vans = [];
    document.querySelectorAll('#vanPickRow input[type=checkbox]:checked').forEach(cb => {
      const b = cb.dataset.van;
      const tid = (document.querySelector(`#vanDetailList input[data-van-field="${b}.tid"]`)?.value || '').trim();
      const ser = (document.querySelector(`#vanDetailList input[data-van-field="${b}.serial"]`)?.value || '').trim();
      if (!tid && !ser) return;
      const v = { brand: b, tid };
      if (b === 'KOCES' && ser) v.serial = ser;
      vans.push(v);
    });
    const pay = [];
    if (document.getElementById('payCheckSimple')?.checked) {
      const t = (document.getElementById('payInputSimple')?.value||'').trim();
      if (t) pay.push({ brand:'간편결제', tid:t });
    }
    if (document.getElementById('payCheckKakao')?.checked) {
      const t = (document.getElementById('payInputKakao')?.value||'').trim();
      if (t) pay.push({ brand:'카카오페이', tid:t });
    }
    // 등록 요약 ROOT 텍스트 생성
    const parts = [];
    parts.push(cat.replace('VAN/',''));
    if (cardAcquire.applyDate || cardAcquire.completeDate) {
      const cp = [];
      if (cardAcquire.applyDate)    cp.push('신청 '+cardAcquire.applyDate);
      if (cardAcquire.completeDate) cp.push('완료 '+cardAcquire.completeDate);
      parts.push('💳 카드사: ' + cp.join(' / '));
    }
    if (vans.length) parts.push('📡 ' + vans.map(v => v.brand + '(TID:'+v.tid + (v.serial?',SN:'+v.serial:'') + ')').join(', '));
    if (pay.length) parts.push('📱 ' + pay.map(p => p.brand+'(TID:'+p.tid+')').join(', '));
    const summary = parts.join(' · ');
    const now = Date.now();
    const ts = new Date(now).toISOString().slice(0,16).replace('T',' ');
    const me = (typeof _currentAuthName === 'function') ? _currentAuthName() : '';
    const rootId = 'TR-'+now.toString(36)+Math.random().toString(36).slice(2,6);
    const newJob = {
      id: 'JOB-'+now.toString(36).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase(),
      type: cat,
      lineCategory: 'van_doc',
      status: '접수',   // 🐛 fix: status 미설정(undefined) → 화면/필터 누락되던 문제
      createdBy: (typeof _currentUserName === 'function' ? (_currentUserName() || '익명') : (me || '익명')),  // 🐛 fix: 작성자 표준 필드 기록
      storeId,
      storeName,
      store: storeName,
      date,
      engineer,
      assignee: engineer,
      vanRegistration: { cardAcquire, vans, pay },
      contactName:  (document.getElementById('vanContactName')?.value || '').trim(),
      contactRole:  (document.getElementById('vanContactRole')?.value || '').trim(),
      contactPhone: (document.getElementById('vanContactPhone')?.value || '').trim(),
      attachments: (function(){
        try { if (window._vanJobUploaderCtl) return window._vanJobUploaderCtl.get() || []; } catch(_){}
        return [];
      })(),
      thread: (function(){
        // 🚫 자동 ROOT 생성 제거 — 카테고리만으로 임의 '요청접수' 가 박히는 문제 방지
        //   카드 신청을 한 게 아닌데도 '신규등록 요청접수' 처럼 보여서 혼동을 유발했음.
        //   사용자가 thread 에 직접 입력한 draft 만 저장.
        //   요청접수가 필요하면 등록 후 [+ 새 요청 접수] 또는 등록 전 [+ 새 요청 접수] draft 로 명시 입력.
        const draft = Array.isArray(window._jobThreadDraft) ? window._jobThreadDraft.slice() : [];
        return (typeof window._threadMigrate === 'function') ? window._threadMigrate(draft) : draft;
      })(),
      completed: false,
      createdAt: now,
      _whoCreated: me,
    };
    // 미등록 가맹점 메타
    if (_vanUnregMode) {
      newJob.unregStore = {
        name: storeName,
        biz: (document.getElementById('vanUnregBiz')?.value||'').trim(),
        ceo: (document.getElementById('vanUnregCeo')?.value||'').trim(),
        tel: (document.getElementById('vanUnregTel')?.value||'').trim(),
        addr: (document.getElementById('vanUnregAddr')?.value||'').trim(),
      };
    }
    // 편집 모드 — 기존 job 업데이트, 아니면 unshift
    const editId = (document.getElementById('vanJobEditId')?.value || '').trim();
    let isEdit = false;
    try {
      const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
      if (editId) {
        const idx = jobs.findIndex(x => x.id === editId);
        if (idx >= 0) {
          isEdit = true;
          const existing = jobs[idx];
          // 기존 id/createdAt/thread 보존, 폼 값으로 덮어쓰기 (thread 는 별도 _setThreadFor 로 관리됨)
          newJob.id = existing.id;
          newJob.createdAt = existing.createdAt || newJob.createdAt;
          newJob.createdBy = existing.createdBy || newJob.createdBy;   // 작성자 보존
          newJob.status = existing.status || newJob.status;             // status 보존
          newJob.thread = Array.isArray(existing.thread) ? existing.thread : newJob.thread;
          newJob.memos  = Array.isArray(existing.memos)  ? existing.memos  : newJob.memos;
          newJob.lineHistory = Array.isArray(existing.lineHistory) ? existing.lineHistory : [];
          // unregStore 보존 (편집 모드에서 미등록 폼 안 보이는 경우)
          if (existing.unregStore && !newJob.unregStore) newJob.unregStore = existing.unregStore;
          jobs[idx] = newJob;
        }
      }
      if (!isEdit) jobs.unshift(newJob);
      if (typeof saveJobs === 'function') saveJobs(jobs);
    } catch(e) { console.warn('[saveVanJob] save failed:', e); }
    // 매장 프로필에 누적
    if (store) {
      try {
        const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
        const sIdx = stores.findIndex(x => x.id === storeId);
        if (sIdx >= 0) {
          const s = stores[sIdx];
          s.vanProfile = s.vanProfile || {};
          vans.forEach(v => {
            s.vanProfile[v.brand] = Object.assign({}, s.vanProfile[v.brand]||{}, {
              tid: v.tid, serial: v.serial || (s.vanProfile[v.brand]?.serial),
              updatedAt: now, sourceJobId: newJob.id,
            });
          });
          if (pay.length) {
            s.payProfile = s.payProfile || {};
            pay.forEach(p => {
              s.payProfile[p.brand] = { tid: p.tid, updatedAt: now, sourceJobId: newJob.id };
            });
          }
          stores[sIdx] = s;
          if (typeof saveStores === 'function') saveStores(stores);
        }
      } catch(e) { console.warn('[saveVanJob] store profile update failed:', e); }
    }
    // 📇 입력한 연락처(이름/직책/전화/이메일/주소)를 매장에 누적
    try { if (typeof ingestJobContactsToStore === 'function') ingestJobContactsToStore(newJob, { allowUpdate:true }); } catch(e){ console.warn('[saveVanJob contacts→store]', e); }
    // 즉시 cloud push (debounce 우회)
    try { if (typeof pushJobsToCloud === 'function') pushJobsToCloud(); } catch(e){}
    // 📡 LINE 발송 — opts.wantLine 우선(요청접수 [등록 후 LINE 발송] 버튼), 없으면 구 체크박스 fallback
    const wantLine = (typeof opts.wantLine === 'boolean')
      ? opts.wantLine
      : !!document.getElementById('vanJobLineSend')?.checked;
    const savedJobId = newJob.id;
    // draft 비우기 — 저장된 thread 와 중복 방지
    window._jobThreadDraft = [];
    if (opts.keepOpen) {
      // footer 없는 인라인 등록 — 모달 유지, 편집 모드로 전환해 진행/완료 이어서 기록
      try { const eidEl = document.getElementById('vanJobEditId'); if (eidEl) eidEl.value = savedJobId; } catch(_){}
      try {
        const jobs3 = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        const fresh3 = jobs3.find(j => j.id === savedJobId);
        if (fresh3 && typeof window._renderThreadGroups === 'function') {
          window._renderThreadGroups('vanJobThread', fresh3.thread || [], { editable:true, jobId: savedJobId, draftMode:false });
        }
      } catch(_){}
    } else {
      closeModal('vanJobModal');
    }
    showToast && showToast(isEdit ? `💾 VAN 업무 저장됨 — ${storeName}` : `✅ VAN 업무 등록 완료 — ${storeName}`);
    // 화면 갱신
    try { if (typeof hydrateDashboardJobs === 'function') hydrateDashboardJobs(); } catch(e){}
    try { if (typeof window.renderVanHub === 'function') window.renderVanHub(); } catch(e){}
    // 📡 LINE 발송 — 등록된 VAN 업무 전체 컨텍스트로 컴포저 열기
    if (wantLine && savedJobId) {
      try {
        const jobs2 = (typeof getJobs === 'function') ? (getJobs() || []) : [];
        const fresh = jobs2.find(j => j.id === savedJobId) || newJob;
        if (typeof window._openLineForJob === 'function') {
          window._openLineForJob(fresh, { category: 'van' });
        }
      } catch(e) { console.warn('[saveVanJob LINE send]', e); }
    }
  };

  // ✕ 닫기 — 편집 모드(기존 VAN job)면 폼 메타를 저장하고 닫음. 신규 미저장 draft 는 그냥 닫힘.
  window._vanCloseSave = function() {
    try {
      const editId = (document.getElementById('vanJobEditId')?.value || '').trim();
      if (editId && typeof window.saveVanJob === 'function') {
        window.saveVanJob({ keepOpen: true });   // 메타 저장(모달 유지 후 아래에서 닫음)
      }
    } catch(e) { console.warn('[_vanCloseSave]', e); }
    try { closeModal('vanJobModal'); } catch(_){}
  };

  // ⛶ 최대화/복원 토글
  window._toggleVanMaximize = function() {
    try {
      const modal = document.querySelector('#vanJobModal .modal');
      if (modal) modal.classList.toggle('van-max');
    } catch(e){}
  };

  /* ─── 요청사항/처리 기록 스레드 (그룹형 — ROOT '요청접수' + children '진행'/'완료') ─── */
  window._jobThreadDraft = window._jobThreadDraft || [];
  window._jobVandocsDraft = window._jobVandocsDraft || { van:{status:'접수',tid:'',serial:''}, easy:{status:'접수',tid:''}, kakao:{status:'접수',tid:''} };

  function _threadStatusMeta(s) {
    if (s === '완료') return { color:'#065F46', bg:'#D1FAE5', border:'#A7F3D0', icon:'✅' };
    if (s === '진행') return { color:'#92400E', bg:'#FEF3C7', border:'#FCD34D', icon:'🔄' };
    return { color:'#1E40AF', bg:'#DBEAFE', border:'#BFDBFE', icon:'📥' };  // 요청접수
  }

  // 상태 정규화 — 구버전 '접수' 를 '요청접수' 로 호환 처리
  function _normalizeStatus(s) {
    if (s === '접수') return '요청접수';
    return s || '요청접수';
  }

  // 마이그레이션 — 구버전 flat 스레드를 ROOT/child 구조로 정규화
  window._threadMigrate = function(arr) {
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
        // 이미 마이그된 항목
        if (e.parentId === null && e.status === '요청접수') lastRootId = e.threadId;
        out.push(e);
        continue;
      }
      // 신규 정규화
      if (e.status === '요청접수') {
        e.threadId = newId();
        e.parentId = null;
        lastRootId = e.threadId;
      } else {
        // 진행/완료 → 가장 가까운 ROOT 의 child
        if (!lastRootId) {
          // 고아 child — 합성 ROOT 생성
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
  };

  // 그룹의 resolved 상태
  function _groupStatus(root, children) {
    if (children.some(c => c.status === '완료')) return '완료';
    if (children.some(c => c.status === '진행')) return '진행';
    return '요청접수';
  }

  // 메인 렌더러 — newJobModal 과 editNewopen 양쪽에서 공유
  // 👤 새-요청접수 폼의 매장 담당자 드롭다운 선택 → 이름/직책/연락처 자동 채움 (옵션 B)
  window._nrContactPick = function(containerId) {
    const sel = document.getElementById(containerId + '__nrCPicker'); if (!sel) return;
    const list = window._nrContactList || [];
    const idx = sel.value === '' ? -1 : parseInt(sel.value, 10);
    if (idx < 0 || !list[idx]) return;   // '직접 입력' — 기존 입력 유지
    const c = list[idx];
    const set = (suf, v) => { const e = document.getElementById(containerId + suf); if (e) e.value = v || ''; };
    set('__nrCName', c.name); set('__nrCRole', c.role); set('__nrCPhone', c.phone);
  };

  window._renderThreadGroups = function(containerId, thread, opts) {
    const root = document.getElementById(containerId);
    if (!root) return;
    opts = opts || {};
    const editable = !!opts.editable;
    const jobId = opts.jobId || null;
    const draftMode = !!opts.draftMode;
    const escFn = (typeof esc === 'function') ? esc : (s)=>String(s||'');
    const normalized = window._threadMigrate(Array.isArray(thread) ? thread : []);
    // maxRoots 가 지정되면 컨테이너 단위로 보존 (재렌더 시 동일 제한 적용)
    if (typeof opts.maxRoots === 'number' && opts.maxRoots > 0) {
      window._threadMaxRootsMap = window._threadMaxRootsMap || {};
      window._threadMaxRootsMap[containerId] = opts.maxRoots;
    }

    // ROOTs — 미완료 우선(최신 → 오래된), 그 다음 완료(최신 → 오래된)
    const roots = normalized.filter(e => e.parentId === null);
    const childrenByRoot = new Map();
    for (const e of normalized) {
      if (e.parentId) {
        if (!childrenByRoot.has(e.parentId)) childrenByRoot.set(e.parentId, []);
        childrenByRoot.get(e.parentId).push(e);
      }
    }
    childrenByRoot.forEach(arr => arr.sort((a,b) => String(a.ts||'').localeCompare(String(b.ts||''))));
    // 각 ROOT 의 그룹 상태 캐싱
    const rootGroupStatus = new Map();
    roots.forEach(r => {
      rootGroupStatus.set(r.threadId, _groupStatus(r, childrenByRoot.get(r.threadId) || []));
    });
    roots.sort((a, b) => {
      const aDone = rootGroupStatus.get(a.threadId) === '완료' ? 1 : 0;
      const bDone = rootGroupStatus.get(b.threadId) === '완료' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;          // 미완료 먼저
      return String(b.ts||'').localeCompare(String(a.ts||'')); // 동일 그룹 내 최신 ts 먼저
    });

    // ── 노출 규칙 (opts.maxRoots 가 지정된 경우만 적용 — AS 인라인편집 등) ──
    //   미완료 ≥ MAX → 미완료만 (개수 무제한)
    //   미완료 < MAX → 미완료 + (MAX - 미완료) 최근 완료 = 최대 MAX 건
    //   모두 완료 → 최근 MAX 건만
    //   외 건수 있으면 '전체보기' 버튼 노출 (window._threadExpandAll[containerId] 로 토글)
    window._threadExpandAll = window._threadExpandAll || {};
    const expandAll = !!window._threadExpandAll[containerId];
    const maxRoots = Number(opts.maxRoots) || 0;
    const totalRoots = roots.length;
    const incompleteAll = roots.filter(r => rootGroupStatus.get(r.threadId) !== '완료');
    const completedAll = roots.filter(r => rootGroupStatus.get(r.threadId) === '완료');
    let limitedRoots = roots;
    let hiddenCount = 0;
    if (maxRoots > 0 && !expandAll) {
      if (incompleteAll.length >= maxRoots) {
        limitedRoots = incompleteAll;            // 미완료만 (개수 무제한)
        hiddenCount = completedAll.length;
      } else {
        const fillN = maxRoots - incompleteAll.length;
        limitedRoots = incompleteAll.concat(completedAll.slice(0, fillN));
        hiddenCount = completedAll.length - fillN;
      }
      // limitedRoots 도 미완료 우선 + 최신 ts 순서로 정렬 유지
      limitedRoots.sort((a, b) => {
        const aDone = rootGroupStatus.get(a.threadId) === '완료' ? 1 : 0;
        const bDone = rootGroupStatus.get(b.threadId) === '완료' ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return String(b.ts||'').localeCompare(String(a.ts||''));
      });
    }

    // 펼침 상태 캐시 (DOM 재렌더 사이 유지)
    const openKey = '_threadOpen_' + (jobId || 'draft');
    window[openKey] = window[openKey] || {};
    const openMap = window[openKey];

    const ctxAttr = `data-ctx="${draftMode?'draft':'edit'}" data-jobid="${escFn(jobId||'')}"`;

    // 헤더 — 총 건수 + (제한 적용 시) 표시 건수 + 전체보기 토글
    const countLabel = (maxRoots > 0 && hiddenCount > 0 && !expandAll)
      ? `(${limitedRoots.length}/${totalRoots}건 표시 · 완료 ${hiddenCount}건 숨김)`
      : `(요청 ${totalRoots}건)`;
    const expandBtn = (maxRoots > 0 && (hiddenCount > 0 || expandAll))
      ? `<button type="button" onclick="window._threadToggleExpandAll('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode})" style="background:#fff;color:#1E40AF;border:1px solid #1E40AF;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-right:6px">${expandAll?'⏎ 최근 '+maxRoots+'건만':'📂 전체보기 ('+totalRoots+'건)'}</button>`
      : '';
    const headerHtml = `
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px 10px 0 0;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="font-weight:700;color:#1E40AF;font-size:13.5px">📋 요청사항 · 처리 기록 <span style="font-size:11px;font-weight:600;opacity:0.8">${countLabel}</span></div>
        <div style="display:flex;align-items:center;gap:4px">
          ${expandBtn}
          <button type="button" class="btn btn-primary btn-sm" onclick="window._toggleNewRootForm('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode})" style="padding:5px 12px;font-size:11.5px;font-weight:800">＋ 새 요청 접수</button>
        </div>
      </div>`;

    // 새 ROOT 입력 폼 (토글)
    const newRootOpen = !!openMap['__newroot__'];
    const newRootAttId = containerId + '__newroot_att';
    // 👤 요청접수 시 매장 담당자 — AS 등록(jobThreadContainer)에서만 새-요청접수 폼 하위에 노출 (2026-06-19, 옵션 B)
    let _nrContactHtml = '';
    if (window._currentJobContext === 'as' && containerId === 'jobThreadContainer') {
      let _nrContacts = [];
      try {
        const _snm = (document.getElementById('jobStoreName') || {}).value || '';
        if (_snm && typeof window.getStoreContacts === 'function') {
          _nrContacts = (window.getStoreContacts({ storeName: _snm }) || []).filter(c => c && (c.name || c.phone));
        }
      } catch(_){}
      window._nrContactList = _nrContacts;
      const _opts = '<option value="">+ 직접 입력</option>' + _nrContacts.map((c,i) =>
        `<option value="${i}">${escFn([c.name||'(이름없음)', c.role, c.phone].filter(Boolean).join(' · '))}</option>`).join('');
      const _ist = 'width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--gray-200);border-radius:6px;font-family:inherit;box-sizing:border-box';
      _nrContactHtml = `
        <div style="margin-top:8px;padding:8px 10px;background:#F9FAFB;border:1px solid var(--gray-200);border-radius:6px">
          <div style="font-size:11px;color:var(--gray-600);font-weight:700;margin-bottom:5px">👤 이 요청의 매장 담당자 <span style="font-weight:400;color:var(--gray-400)">기존 연락처 선택 또는 직접 입력</span></div>
          <select id="${escFn(containerId)}__nrCPicker" onchange="window._nrContactPick&&window._nrContactPick('${escFn(containerId)}')" style="${_ist};margin-bottom:6px;border-color:var(--gray-300);${_nrContacts.length?'':'display:none'}">${_opts}</select>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
            <input type="text" id="${escFn(containerId)}__nrCName" placeholder="이름" autocomplete="off" style="${_ist}">
            <input type="text" id="${escFn(containerId)}__nrCRole" placeholder="직책" autocomplete="off" style="${_ist}">
            <input type="tel" id="${escFn(containerId)}__nrCPhone" placeholder="연락처" autocomplete="off" style="${_ist}">
          </div>
        </div>`;
    }
    const newRootFormHtml = newRootOpen ? `
      <div style="background:#fff;border:1px solid #BFDBFE;border-top:none;padding:10px 12px">
        <textarea id="${escFn(containerId)}__newroot" placeholder="새 요청 내용을 입력하세요..." style="width:100%;min-height:48px;padding:7px 9px;border:1px solid var(--gray-200);border-radius:6px;font-size:12.5px;font-family:inherit;resize:vertical"></textarea>
        <div id="${escFn(newRootAttId)}" style="margin-top:6px"></div>
        ${_nrContactHtml}
        <div style="margin-top:8px;display:flex;gap:7px">
          <button type="button" class="btn btn-primary btn-sm" onclick="window._submitNewRoot('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},false)" style="flex:1;padding:9px;font-size:12.5px;font-weight:800">등록</button>
          <button type="button" class="btn btn-sm" onclick="window._submitNewRoot('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},true)" style="flex:1;padding:9px;font-size:12.5px;font-weight:800;background:#06C755;color:#fff;border:none">📡 등록 후 LINE 발송</button>
        </div>
      </div>` : '';

    let bodyHtml = '';
    if (roots.length === 0) {
      bodyHtml = `<div style="background:#fff;border:1px solid #BFDBFE;border-top:none;border-radius:0 0 10px 10px;padding:18px;text-align:center;color:#64748B;font-size:11.5px">요청이 없습니다 — 위 [＋ 새 요청 접수] 버튼으로 첫 요청을 등록하세요</div>`;
    } else {
      bodyHtml = `<div style="background:#fff;border:1px solid #BFDBFE;border-top:none;border-radius:0 0 10px 10px;padding:10px 12px;display:flex;flex-direction:column;gap:10px">`;
      // 👤 job 레벨 연락처(기존 AS 호환) — ROOT 에 자체 contact 없을 때 첫 ROOT 에 1회 fallback 표시
      const _jobC = (function(){ try { const jj = (jobId && typeof getJobs === 'function') ? (getJobs()||[]).find(x => x.id === jobId) : null; if (jj && (jj.contactName || jj.contactPhone)) return { name: jj.contactName||'', role: jj.contactRole||'', phone: jj.contactPhone||'' }; } catch(_){} return null; })();
      let _jobCUsed = false;
      limitedRoots.forEach(r => {
        const kids = childrenByRoot.get(r.threadId) || [];
        const gStatus = _groupStatus(r, kids);
        const isCompleted = (gStatus === '완료');
        // 기본 펼침 상태: 미완료는 펼침, 완료는 접힘 — 사용자가 토글한 값 있으면 그것 사용
        const userExpanded = openMap[r.threadId];
        const expanded = (userExpanded === undefined) ? !isCompleted : !!userExpanded;
        const rootMeta = _threadStatusMeta('요청접수');
        const gMeta = _threadStatusMeta(gStatus);

        const summaryText = (r.text || '').replace(/\s+/g,' ').slice(0,120);
        // 헤더 1행 — 메타 + 상태 뱃지 + 펼침 화살표
        // 헤더 2행 — 요청 본문 요약 (완료/접힘 상태에서도 항상 노출 → 어떤 요청이었는지 즉시 파악)
        const headerLine = `
          <div onclick="window._toggleRoot('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(r.threadId)}')" style="cursor:pointer;background:${rootMeta.bg};border:1px solid ${rootMeta.border};border-left:4px solid ${rootMeta.color};border-radius:8px;padding:8px 11px;display:flex;flex-direction:column;gap:5px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="background:#fff;color:${rootMeta.color};border-radius:10px;padding:2px 9px;font-size:10.5px;font-weight:800">${rootMeta.icon} 요청접수</span>
              <span style="font-size:11px;color:var(--gray-700);font-weight:700">${escFn(r.author||'담당자')}</span>
              <span style="font-size:10.5px;color:var(--gray-500)">${escFn(r.ts||'')}</span>
              ${isCompleted ? `<span style="background:${gMeta.bg};color:${gMeta.color};border-radius:10px;padding:2px 9px;font-size:10.5px;font-weight:800">${gMeta.icon} 완료</span>` : (gStatus==='진행' ? `<span style="background:${gMeta.bg};color:${gMeta.color};border-radius:10px;padding:2px 9px;font-size:10.5px;font-weight:800">${gMeta.icon} 진행</span>` : '')}
              <span style="margin-left:auto;font-size:14px;color:${rootMeta.color}">${expanded?'▾':'▸'}</span>
            </div>
            <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;font-size:11px;color:var(--gray-600)">
              <span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><span style="font-weight:700">👷 처리 담당</span>
                <select onchange="window._threadSetAssignee('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(r.threadId)}',this.value)" style="padding:3px 7px;border:1px solid var(--gray-300);border-radius:6px;font-size:11.5px;font-weight:700;background:#fff;font-family:inherit;max-width:130px">${(typeof window._jobStaffOptions==='function')?window._jobStaffOptions(r.assignee||''):'<option value="">미배정</option>'}</select></span>
              <span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><span style="font-weight:700">📅 처리예정</span>
                <input type="date" value="${escFn((r.dueDate||'').slice(0,10))}" onchange="window._threadSetReqDue('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(r.threadId)}',this.value)" style="padding:3px 6px;border:1px solid var(--gray-300);border-radius:6px;font-size:11.5px;background:#fff;font-family:inherit"></span>
            </div>
            ${(function(){
              let rc = (r.contact && (r.contact.name || r.contact.phone)) ? r.contact : null;
              if (!rc && _jobC && !_jobCUsed) { rc = _jobC; _jobCUsed = true; }   // 기존 AS: 첫 ROOT 에 job 연락처 1회 표시
              if (!rc) return '';
              const parts = [rc.name, rc.role, rc.phone].filter(Boolean).map(x=>escFn(x)).join(' · ');
              return `<div style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#1d4ed8;background:#EFF6FF;border:1px solid #DBEAFE;border-radius:7px;padding:3px 9px;align-self:flex-start"><span style="font-weight:700">👤 매장담당</span> ${parts}</div>`;
            })()}
            ${(summaryText && !expanded) ? `<div style="font-size:12px;color:var(--gray-800);line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escFn(summaryText)}</div>` : ''}
          </div>`;

        let detail = '';
        if (expanded) {
          // 요청 본문
          detail += `<div style="background:#fff;border:1px solid ${rootMeta.border};border-left:4px solid ${rootMeta.color};border-radius:8px;padding:9px 11px;margin-top:6px">
            <div style="font-size:12.5px;color:var(--gray-800);line-height:1.55;white-space:pre-wrap">${escFn(r.text||'')}</div>
            ${(Array.isArray(r.attachments)&&r.attachments.length&&typeof window._renderAttStrip==='function')?window._renderAttStrip(r.attachments,{limit:8,size:40}):''}
            ${editable ? `<div style="margin-top:6px;text-align:right"><button type="button" onclick="window._removeThreadNode('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(r.threadId)}',true)" style="background:transparent;border:none;color:var(--gray-400);font-size:11px;cursor:pointer">요청 삭제</button></div>` : ''}
          </div>`;

          // children
          kids.forEach(c => {
            const cm = _threadStatusMeta(c.status);
            const cEq = Array.isArray(c.equipment) ? c.equipment : [];
            const eqSummary = cEq.length === 0 ? '' : `
              <div style="margin-top:6px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:6px 9px">
                <div style="font-size:10.5px;color:#065F46;font-weight:700;margin-bottom:3px">🔧 투입 장비 (${cEq.length}종)</div>
                ${cEq.map(eq => `<div style="font-size:11px;color:var(--gray-700)">· ${escFn(eq.name||'-')}${eq.variant?' · '+escFn(eq.variant):''}${eq.condition==='used'?' <span style="background:#FEE2E2;color:#991B1B;font-size:9.5px;padding:0 5px;border-radius:3px">중고</span>':''} <b style="color:var(--primary)">${Number(eq.qty)||0}대</b></div>`).join('')}
              </div>`;
            detail += `<div style="background:#fff;border:1px solid ${cm.border};border-left:4px solid ${cm.color};border-radius:8px;padding:9px 11px;margin-top:6px;margin-left:18px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:5px">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                  <span style="background:${cm.bg};color:${cm.color};border-radius:10px;padding:2px 9px;font-size:10.5px;font-weight:800">${cm.icon} ${escFn(c.status||'')}</span>
                  <span style="font-size:11px;color:var(--gray-600);font-weight:700">${escFn(c.author||'담당자')}</span>
                  <span style="font-size:10.5px;color:var(--gray-400)">${escFn(c.ts||'')}</span>
                </div>
                ${editable ? `<button type="button" onclick="if(confirm('이 기록을 삭제할까요?'))window._removeThreadNode('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(c.threadId)}',false)" title="삭제" style="background:transparent;border:none;color:var(--gray-400);font-size:13px;cursor:pointer;padding:0 4px">✕</button>` : ''}
              </div>
              <div style="font-size:12.5px;color:var(--gray-800);line-height:1.55;white-space:pre-wrap">${escFn(c.text||'')}</div>
              ${(Array.isArray(c.attachments)&&c.attachments.length&&typeof window._renderAttStrip==='function')?window._renderAttStrip(c.attachments,{limit:8,size:40}):''}
              ${eqSummary}
            </div>`;
          });

          // 진행/완료 추가 폼 — 완료 그룹은 잠금
          if (editable && !isCompleted) {
            const formId = containerId + '__add_' + r.threadId;
            // 이 폼에 임시 추가된 투입 장비 목록 렌더
            window._threadChildEquipDraft = window._threadChildEquipDraft || {};
            const eqDraft = window._threadChildEquipDraft[formId] || [];
            const eqListHtml = eqDraft.length === 0
              ? `<div style="text-align:center;color:var(--gray-400);font-size:11px;padding:6px;background:#fff;border:1px dashed var(--gray-200);border-radius:6px">투입 장비 없음 — 우측 [＋ 장비 추가]</div>`
              : eqDraft.map((eq, ei) => `
                <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:#fff;border:1px solid var(--gray-200);border-radius:6px;font-size:11.5px">
                  <span style="font-weight:700;color:var(--gray-800);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escFn(eq.name||'-')}${eq.variant?' · '+escFn(eq.variant):''}${eq.condition==='used'?' <span style="background:#FEE2E2;color:#991B1B;font-size:9.5px;padding:0 5px;border-radius:3px">중고</span>':''}</span>
                  <span style="color:var(--primary);font-weight:700;white-space:nowrap">${Number(eq.qty)||0}대</span>
                  <button type="button" onclick="window._removeChildEquip('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(r.threadId)}','${escFn(formId)}',${ei})" title="제거" style="background:transparent;border:none;color:var(--gray-400);font-size:13px;cursor:pointer;padding:0 2px">×</button>
                </div>`).join('');
            detail += `<div style="margin-top:8px;margin-left:18px;background:#F8FAFC;border:1px solid #CBD5E1;border-radius:8px;padding:9px 10px">
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center">
                <span style="font-size:11px;color:var(--gray-600);font-weight:700">상태:</span>
                <label style="display:inline-flex;align-items:center;gap:3px;padding:3px 9px;background:#fff;border:1px solid #CBD5E1;border-radius:14px;cursor:pointer;font-size:11.5px;font-weight:600">
                  <input type="radio" name="${escFn(formId)}_st" value="진행" checked style="margin:0"> 🔄 진행
                </label>
                <label style="display:inline-flex;align-items:center;gap:3px;padding:3px 9px;background:#fff;border:1px solid #CBD5E1;border-radius:14px;cursor:pointer;font-size:11.5px;font-weight:600">
                  <input type="radio" name="${escFn(formId)}_st" value="완료" style="margin:0"> ✅ 완료
                </label>
                <button type="button" onclick="window._openChildEquipAdd('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(r.threadId)}','${escFn(formId)}')" style="margin-left:auto;background:#fff;color:#1E40AF;border:1px solid #1E40AF;border-radius:14px;padding:3px 10px;font-size:11px;font-weight:700;cursor:pointer">🔧 ＋ 장비 추가</button>
              </div>
              <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:6px">${eqListHtml}</div>
              <textarea id="${escFn(formId)}_text" placeholder="처리 내용을 입력하세요..." style="width:100%;min-height:44px;padding:7px 9px;border:1px solid var(--gray-200);border-radius:6px;font-size:12.5px;font-family:inherit;resize:vertical"></textarea>
              <div id="${escFn(formId)}_att" style="margin-top:6px"></div>
              <div style="margin-top:8px;display:flex;gap:7px">
                <button type="button" class="btn btn-primary btn-sm" onclick="window._submitChild('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(r.threadId)}','${escFn(formId)}',false)" style="flex:1;padding:9px;font-size:12.5px;font-weight:800">등록</button>
                <button type="button" class="btn btn-sm" onclick="window._submitChild('${escFn(containerId)}','${escFn(jobId||'')}',${draftMode},'${escFn(r.threadId)}','${escFn(formId)}',true)" style="flex:1;padding:9px;font-size:12.5px;font-weight:800;background:#06C755;color:#fff;border:none">📡 등록 후 LINE 발송</button>
              </div>
            </div>`;
          }
        }

        bodyHtml += `<div ${ctxAttr} data-rootid="${escFn(r.threadId)}">${headerLine}${detail}</div>`;
      });
      bodyHtml += `</div>`;
    }

    root.innerHTML = headerHtml + newRootFormHtml + bodyHtml;

    // ─── 첨부 업로더 mount (새 ROOT + 각 child 추가 폼) ───
    try {
      window._threadFormUploaderCtl = window._threadFormUploaderCtl || {};
      window._threadFormAttachments = window._threadFormAttachments || {};
      if (newRootOpen && window.NS_UPLOAD) {
        const box = document.getElementById(newRootAttId);
        if (box) {
          const key = '__newroot__' + (jobId || 'draft');
          const initial = window._threadFormAttachments[key] || [];
          window._threadFormUploaderCtl[key] = window.NS_UPLOAD.mount(box, {
            initial,
            category: 'as',
            jobId: jobId || '',
            max: 30,
            onChange: (arr) => { window._threadFormAttachments[key] = arr; },
          });
        }
      }
      if (editable && window.NS_UPLOAD) {
        limitedRoots.forEach(r => {
          const kids = childrenByRoot.get(r.threadId) || [];
          const userExpanded = openMap[r.threadId];
          const isCompletedR = (rootGroupStatus.get(r.threadId) === '완료');
          const expandedR = (userExpanded === undefined) ? !isCompletedR : !!userExpanded;
          if (!expandedR || isCompletedR) return;
          const formId = containerId + '__add_' + r.threadId;
          const box = document.getElementById(formId + '_att');
          if (!box) return;
          const key = formId;
          const initial = window._threadFormAttachments[key] || [];
          window._threadFormUploaderCtl[key] = window.NS_UPLOAD.mount(box, {
            initial,
            category: 'as',
            jobId: jobId || '',
            threadId: r.threadId,
            max: 30,
            onChange: (arr) => { window._threadFormAttachments[key] = arr; },
          });
        });
      }
    } catch(e) { console.warn('thread uploader mount failed', e); }
  };

  // 5건 제한 ↔ 전체보기 토글
  window._threadToggleExpandAll = function(containerId, jobId, draftMode) {
    window._threadExpandAll = window._threadExpandAll || {};
    window._threadExpandAll[containerId] = !window._threadExpandAll[containerId];
    _rerenderThread(containerId, jobId, draftMode);
  };

  // 새 ROOT 폼 토글
  window._toggleNewRootForm = function(containerId, jobId, draftMode) {
    const openKey = '_threadOpen_' + (jobId || 'draft');
    window[openKey] = window[openKey] || {};
    window[openKey]['__newroot__'] = !window[openKey]['__newroot__'];
    _rerenderThread(containerId, jobId, draftMode);
  };

  // ROOT 펼침 토글
  window._toggleRoot = function(containerId, jobId, draftMode, rootId) {
    const openKey = '_threadOpen_' + (jobId || 'draft');
    window[openKey] = window[openKey] || {};
    // 현재 effective 상태 계산
    const thread = _getThreadFor(jobId, draftMode, containerId);
    const normalized = window._threadMigrate(thread);
    const root = normalized.find(e => e.threadId === rootId);
    if (!root) return;
    const kids = normalized.filter(e => e.parentId === rootId);
    const gStatus = _groupStatus(root, kids);
    const cur = window[openKey][rootId];
    const effective = (cur === undefined) ? (gStatus !== '완료') : !!cur;
    window[openKey][rootId] = !effective;
    _rerenderThread(containerId, jobId, draftMode);
  };

  function _threadEntityFor(containerId) {
    return (containerId && window._threadEntities && window._threadEntities[containerId]) || 'job';
  }
  function _getThreadFor(jobId, draftMode, containerId) {
    const entity = _threadEntityFor(containerId);
    if (entity === 'stocktake') {
      if (!jobId) return [];
      const all = (typeof window.getStocktakes === 'function') ? (window.getStocktakes() || []) : [];
      const s = all.find(x => x.id === jobId);
      return (s && Array.isArray(s.thread)) ? s.thread : [];
    }
    if (draftMode) return window._jobThreadDraft || [];
    if (!jobId) return [];
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const j = jobs.find(x => x.id === jobId);
    return (j && Array.isArray(j.thread)) ? j.thread : [];
  }

