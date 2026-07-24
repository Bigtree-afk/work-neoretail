/* ══════════════════════════════════════════════════════════════
   ONE — 개인 노트 앱 (필기장 › 섹션/그룹(무한 중첩) › 페이지/하위페이지)
   통합 사이드바: 섹션/그룹과 페이지를 한 트리에. 저장: /api/one (KV).
   접근: zoolex@gmail.com 전용 게이트.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const OWNER = 'zoolex@gmail.com';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => (p || 'n') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const NB_COLORS = ['#3B82F6', '#1AA79E', '#E1567A', '#E29B33', '#3FA95B', '#8B5CF6', '#64748B'];
  const SEC_COLORS = ['#8B5CF6', '#3B82F6', '#1AA79E', '#E1567A', '#E29B33', '#3FA95B', '#64748B'];
  const NB_ICONS = ['💼', '⌨️', '🌱', '📘', '🎯', '🗂️', '⭐'];

  /* ── Lucide 계열 인라인 SVG 아이콘 (외부 CDN 없음. stroke=currentColor 로 테마/hover 자동) ── */
  const ICON = {
    bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>',
    h1: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>',
    h2: '<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    olist: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 6h1v4M4 10h2"/><path d="M6 18H4c0-1 2-1.6 2-2.6S5 14.5 4 15"/>',
    quote: '<path d="M6 15q-1 0-1-1V9q0-1 1-1h3q1 0 1 1v3q0 3-3 4M15 15q-1 0-1-1V9q0-1 1-1h3q1 0 1 1v3q0 3-3 4"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M3 15h18M9 3v18M15 3v18"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    fontcolor: '<path d="M5 18 11 5l6 13"/><path d="M7.5 13.5h7"/><rect x="4" y="20.2" width="16" height="2.4" rx="1" fill="var(--accent)" stroke="none"/>',
    bucket: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
    bucketOff: '<path d="M12 3s5.5 5.5 5.5 9.5a5.5 5.5 0 0 1-11 0c0-1.3.6-2.7 1.4-4"/><path d="m4 4 16 16"/>',
    rowAbove: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 13h18"/><path d="M12 5.5v4M10 7.5h4"/>',
    rowBelow: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 11h18"/><path d="M12 14.5v4M10 16.5h4"/>',
    colLeft: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M13 3v18"/><path d="M8 10v4M6 12h4"/>',
    colRight: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M11 3v18"/><path d="M16 10v4M14 12h4"/>',
    rowDel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/><path d="M9 16.5h6"/>',
    colDel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M14.5 12h4"/>',
    merge: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h5M16 12h5"/><path d="M11 8l-3 4 3 4M13 8l3 4-3 4"/>',
    split: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M8 9l-2 3 2 3M16 9l2 3-2 3"/>',
    alignL: '<path d="M3 6h18M3 12h11M3 18h15"/>',
    alignC: '<path d="M3 6h18M6 12h12M5 18h14"/>',
    alignR: '<path d="M3 6h18M10 12h11M6 18h15"/>',
    valT: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8"/>',
    valM: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8"/>',
    valB: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 16h8"/>',
    header: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><rect x="3.5" y="3.5" width="17" height="5.5" rx="1.5" fill="var(--accent)" opacity="0.16" stroke="none"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    arrowL: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    arrowR: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    chevR: '<path d="m9 6 6 6-6 6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H21a2 2 0 0 1 1.94 2.5l-1.55 6A2 2 0 0 1 19.46 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>',
  };
  function ic(name, size) { const p = ICON[name]; if (!p) return ''; const s = size || 20; return `<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`; }

  /* ── 인증 게이트 ── */
  function authEmail() {
    try { const a = JSON.parse(localStorage.getItem('ns_auth') || 'null'); if (a && a.loggedIn) return String(a.id || a.email || '').toLowerCase(); } catch (_) {}
    return '';
  }
  function enforceGate() {
    const em = authEmail();
    if (em === OWNER) return true;
    const g = document.createElement('div'); g.className = 'gate';
    g.innerHTML = em
      ? `<div class="g-logo">◲</div><h1>소유자 전용</h1><p>이 노트(<b>ONE</b>)는 소유자만 볼 수 있습니다.<br>현재 계정(${esc(em)})은 접근 권한이 없습니다.</p><a class="g-btn" href="/?desktop=1">메인으로</a>`
      : `<div class="g-logo">◲</div><h1>ONE — 로그인 필요</h1><p>work.neoretail.net 에 먼저 로그인하면<br>이 노트를 사용할 수 있습니다.</p><a class="g-btn" href="/?desktop=1">로그인하러 가기</a>`;
    document.body.appendChild(g);
    return false;
  }

  /* ── 상태 ── */
  let DATA = { notebooks: [] };
  let curNb = null, curSecId = null, curPageId = null;
  const bodyCache = {};
  let treeEtag = '';

  /* ── 동기화 ── */
  let _treeT = null, _pageT = {};
  async function loadTree() {
    try {
      const r = await fetch('/api/one', { headers: treeEtag ? { 'If-None-Match': treeEtag } : {} });
      if (r.status === 304) return;
      const et = r.headers.get('ETag'); if (et) treeEtag = et;
      const d = await r.json();
      if (d && d.tree && d.tree.notebooks && d.tree.notebooks.length) DATA = d.tree; else seedDefault();
    } catch (_) { if (!DATA.notebooks.length) seedDefault(); }
  }
  function saveTree(now) {
    clearTimeout(_treeT);
    const doIt = async () => { try { const r = await fetch('/api/one', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tree: DATA }) }); const j = await r.json(); if (j && j.updatedAt) treeEtag = '"' + j.updatedAt + '"'; } catch (_) {} };
    if (now) return doIt(); _treeT = setTimeout(doIt, 900);
  }
  async function loadPage(id) {
    if (bodyCache[id]) return bodyCache[id];
    try { const r = await fetch('/api/one?page=' + encodeURIComponent(id)); const d = await r.json(); bodyCache[id] = (d && d.page) || { id, html: '', attachments: [] }; }
    catch (_) { bodyCache[id] = { id, html: '', attachments: [] }; }
    if (!bodyCache[id].attachments) bodyCache[id].attachments = [];
    return bodyCache[id];
  }
  function savePage(id, now) {
    clearTimeout(_pageT[id]); setSaveInd('saving');
    const doIt = async () => { const p = bodyCache[id]; if (!p) return; try { await fetch('/api/one', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: { id, html: p.html, attachments: p.attachments } }) }); setSaveInd('saved'); } catch (_) { setSaveInd('err'); } };
    if (now) return doIt(); _pageT[id] = setTimeout(doIt, 1000);
  }
  function setSaveInd(s) { const el = $('saveInd'); if (!el) return; el.className = 'save-ind' + (s === 'saving' ? ' saving' : ''); el.textContent = s === 'saving' ? '저장 중…' : s === 'err' ? '⚠ 저장 실패' : '✓ 저장됨'; }

  function seedDefault() {
    const secId = uid('s'), pgId = uid('p');
    DATA = { notebooks: [{ id: uid('nb'), name: '내 노트', color: NB_COLORS[0], ico: '📘',
      nodes: [{ id: secId, type: 'section', name: '첫 섹션', color: SEC_COLORS[0], open: true, pages: [{ id: pgId, title: '환영합니다 👋', updated: today(), tags: [], sub: [], open: true }] }] }] };
    bodyCache[pgId] = { id: pgId, attachments: [], html:
      '<h2>ONE 에 오신 걸 환영합니다</h2><p>왼쪽 사이드바에서 <b>섹션·그룹·페이지</b>를 만들고, 여기에 자유롭게 적으세요.</p>'
      + '<ul><li>이미지·엑셀 표를 <b>붙여넣기(Ctrl+V)</b> 하면 본문에 들어갑니다</li><li>상단 <b>⊞</b> 로 표를 만들고, 표 안을 클릭하면 <b>행·열 추가/삭제</b> 도구가 나옵니다</li><li><b>📎</b> 로 파일 첨부, 그룹 안에 그룹을 넣어 원하는 만큼 깊게 정리</li></ul>' };
    saveTree(true);
  }
  function today() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function nb() { return DATA.notebooks.find(n => n.id === curNb) || DATA.notebooks[0]; }

  /* ── 트리 탐색 ── */
  function walkNodes(nodes, fn) { for (const n of nodes) { fn(n, nodes); if (n.children) walkNodes(n.children, fn); } }
  function findNode(id) { let r = null; walkNodes(nb().nodes, n => { if (n.id === id) r = n; }); return r; }
  function findNodeParentList(id) { let r = null; walkNodes(nb().nodes, (n, list) => { if (n.id === id) r = list; }); return r; }
  function firstSection(nodes) { for (const n of nodes) { if (n.type === 'section') return n; if (n.children) { const f = firstSection(n.children); if (f) return f; } } return null; }
  function findPage(pages, id) { for (const p of pages) { if (p.id === id) return p; if (p.sub) { const f = findPage(p.sub, id); if (f) return f; } } return null; }
  function findPageParent(pages, id) { if (pages.some(x => x.id === id)) return pages; for (const p of pages) { if (p.sub) { const r = findPageParent(p.sub, id); if (r) return r; } } return null; }
  function pathToSection(nodes, secId, trail) { for (const n of nodes) { if (n.type === 'section') { if (n.id === secId) return [...trail, n]; } else { const r = pathToSection(n.children, secId, [...trail, n]); if (r) return r; } } return null; }
  function countPages(pages) { let c = 0; const w = a => a.forEach(p => { c++; if (p.sub) w(p.sub); }); w(pages || []); return c; }

  /* ── 렌더: 필기장 rail ── */
  function renderRail() {
    const r = $('rail');
    r.innerHTML = DATA.notebooks.map(n => `<div class="nb-ico ${n.id === curNb ? 'on' : ''}" style="background:${n.color}" title="${esc(n.name)}" data-nb="${n.id}">${n.ico || '📘'}</div>`).join('')
      + `<div class="spring"></div><button class="add" id="addNbBtn" title="새 필기장">${ic('plus', 18)}</button>`;
    r.querySelectorAll('[data-nb]').forEach(el => { el.onclick = () => { curNb = el.dataset.nb; curSecId = null; curPageId = null; selectFirst(); }; el.ondblclick = () => editNotebook(el.dataset.nb); });
    $('addNbBtn').onclick = () => editNotebook(null);
    const cur = nb(); $('nbName').textContent = cur ? cur.name : 'ONE'; if (cur) document.querySelector('#nbSwitch .dot').style.background = cur.color;
  }

  /* ── 렌더: 통합 사이드바 (섹션/그룹 + 페이지 한 트리) ── */
  function renderNav() {
    const host = $('tree'); const cur = nb();
    $('navHead').textContent = cur ? cur.name : '내용';
    host.innerHTML = (cur ? cur.nodes : []).map(n => nodeHtml(n, 0)).join('') || '<div class="empty-hint">＋ 로 섹션을 추가하세요</div>';
  }
  const ACT = (list) => `<span class="rowacts">${list.map(([a, t, icon, cls]) => `<button data-act="${a}" title="${t}"${cls ? ` class="${cls}"` : ''}>${ic(icon, 14)}</button>`).join('')}</span>`;
  function nodeHtml(n, depth) {
    const pad = 6 + depth * 13;
    if (n.type === 'group') {
      const acts = ACT([['addchild', '안에 추가', 'plus'], ['rename', '이름변경', 'pencil'], ['del', '삭제', 'x', 'del']]);
      let h = `<div class="node"><div class="row" data-node="${n.id}" data-kind="group" style="padding-left:${pad}px"><span class="chev ${n.open ? 'open' : ''}">${ic('chevR', 12)}</span><span class="gico">${ic(n.open ? 'folderOpen' : 'folder', 15)}</span><span class="label">${esc(n.name)}</span>${acts}</div>`;
      if (n.open && n.children && n.children.length) h += `<div class="children">${n.children.map(c => nodeHtml(c, depth + 1)).join('')}</div>`;
      return h + `</div>`;
    }
    // section
    const acts = ACT([['addpage', '페이지 추가', 'plus'], ['rename', '이름변경', 'pencil'], ['del', '삭제', 'x', 'del']]);
    const cnt = `<span class="count">${countPages(n.pages)}</span>`;
    let h = `<div class="node"><div class="row" data-node="${n.id}" data-kind="section" style="padding-left:${pad}px"><span class="chev ${n.open ? 'open' : ''}">${ic('chevR', 12)}</span><span class="sdot" style="background:${n.color}"></span><span class="label">${esc(n.name)}</span>${cnt}${acts}</div>`;
    if (n.open) h += `<div class="children">${(n.pages || []).map(p => pageRowHtml(p, depth + 1, n.id)).join('') || `<div class="empty-hint" style="padding:8px 12px;font-size:12px;text-align:left">＋ 페이지 추가</div>`}</div>`;
    return h + `</div>`;
  }
  function pageRowHtml(p, depth, secId) {
    const pad = 6 + depth * 13;
    const sel = curPageId === p.id;
    const hasSub = p.sub && p.sub.length;
    const chev = hasSub ? `<span class="chev ${p.open ? 'open' : ''}">${ic('chevR', 12)}</span>` : `<span class="chev leaf"></span>`;
    const acts = ACT([['promote', '상위로 올리기 (←)', 'arrowL'], ['demote', '하위로 내리기 (→)', 'arrowR'], ['addsub', '하위페이지 추가', 'plus'], ['rename', '이름변경', 'pencil'], ['del', '삭제', 'x', 'del']]);
    let h = `<div class="node"><div class="row prow ${sel ? 'sel' : ''}" data-page="${p.id}" data-sec="${secId}" style="padding-left:${pad}px">${chev}<span class="pgico">${ic('file', 15)}</span><span class="label">${esc(p.title || '제목 없음')}</span>${acts}</div>`;
    if (hasSub && p.open) h += `<div class="children">${p.sub.map(s => pageRowHtml(s, depth + 1, secId)).join('')}</div>`;
    return h + `</div>`;
  }
  function bindNav() {
    $('tree').addEventListener('click', (e) => {
      const actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        e.stopPropagation(); const row = actBtn.closest('.row'); const act = actBtn.dataset.act;
        if (row.dataset.node) { const id = row.dataset.node;
          if (act === 'addchild') addNode(id); else if (act === 'addpage') { curSecId = id; addPage(null); } else if (act === 'rename') renameNode(id); else if (act === 'del') deleteNode(id);
        } else if (row.dataset.page) { const id = row.dataset.page; curSecId = row.dataset.sec;
          if (act === 'addsub') addPage(id); else if (act === 'demote') demotePage(id, row.dataset.sec); else if (act === 'promote') promotePage(id, row.dataset.sec); else if (act === 'rename') renamePage(id, row.dataset.sec); else if (act === 'del') deletePage(id, row.dataset.sec);
        }
        return;
      }
      const row = e.target.closest('.row'); if (!row) return;
      if (row.dataset.node) { const node = findNode(row.dataset.node); node.open = !node.open; if (node.type === 'section') curSecId = node.id; saveTree(); renderNav(); return; }
      if (row.dataset.page) {
        if (e.target.classList.contains('chev')) { const pg = findPage(findNode(row.dataset.sec).pages, row.dataset.page); pg.open = !pg.open; saveTree(); renderNav(); return; }
        curSecId = row.dataset.sec; curPageId = row.dataset.page; renderNav(); openCanvas();
      }
    });
  }

  /* ── 캔버스 ── */
  async function openCanvas() {
    const cv = $('canvasArea'), crumb = $('crumb'), tb = $('toolbar');
    const sec = curSecId ? findNode(curSecId) : null;
    const page = sec && curPageId ? findPage(sec.pages, curPageId) : null;
    const cur = nb();
    let segs = [`<span class="seg">${cur ? cur.ico + ' ' + esc(cur.name) : ''}</span>`];
    if (sec) { const path = pathToSection(nb().nodes, sec.id, []) || []; path.forEach(n => segs.push(`<span class="sep">›</span><span class="seg">${n.type === 'group' ? '📁 ' : ''}${esc(n.name)}</span>`)); }
    if (page) segs.push(`<span class="sep">›</span><span class="seg cur">${esc(page.title || '제목 없음')}</span>`);
    crumb.innerHTML = segs.join('');
    if (!page) { tb.style.display = 'none'; cv.innerHTML = '<div class="empty-hint">페이지를 선택하거나 ＋ 로 새로 만드세요</div>'; return; }
    tb.style.display = 'flex';
    const body = await loadPage(page.id);
    cv.innerHTML = `<div class="canvas-inner">
      <div class="doc-title" id="docTitle" contenteditable="true" spellcheck="false">${esc(page.title || '')}</div>
      <div class="doc-sub"><span>수정 ${esc(page.updated || '')}</span></div>
      <div class="doc-body" id="docBody" contenteditable="true" spellcheck="false"></div>
      <div class="atts" id="atts"></div></div>`;
    const bodyEl = $('docBody'); bodyEl.innerHTML = sanitizeRich(body.html || '');
    const titleEl = $('docTitle');
    titleEl.oninput = () => { page.title = titleEl.textContent.trim(); page.updated = today(); renderNav(); saveTree(); const cseg = $('crumb').querySelector('.seg.cur'); if (cseg) cseg.textContent = page.title || '제목 없음'; };
    titleEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); bodyEl.focus(); } };
    bodyEl.oninput = () => { body.html = bodyEl.innerHTML; page.updated = today(); savePage(page.id); scheduleTouchTree(); };
    bodyEl.onpaste = onPaste;
    bodyEl.onkeydown = onBodyKeydown;
    bodyEl.onmousemove = rzHover;
    bodyEl.onmousedown = onBodyMousedown;
    renderAtts();
  }
  let _touchT = null; function scheduleTouchTree() { clearTimeout(_touchT); _touchT = setTimeout(() => saveTree(), 1500); }

  function renderAtts() {
    const box = $('atts'); if (!box) return;
    const body = bodyCache[curPageId]; const atts = (body && body.attachments) || [];
    if (!atts.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="atts-h">📎 첨부 (${atts.length})</div>` + atts.map((a, i) => {
      const isImg = /^image\//.test(a.type || '') && a.dataUrl;
      return `<span class="att">${isImg ? `<img class="thumb" src="${a.dataUrl}" data-open="${i}">` : '📄'}<span class="an" data-open="${i}">${esc(a.name)}</span><span class="as">${fsize(a.size)}</span><span class="ax" data-del="${i}">✕</span></span>`;
    }).join('');
    box.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openAtt(Number(el.dataset.open)));
    box.querySelectorAll('[data-del]').forEach(el => el.onclick = () => { atts.splice(Number(el.dataset.del), 1); savePage(curPageId); renderAtts(); });
  }

  /* ── 리치 에디터 ── */
  const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,%\s]+\)|[a-zA-Z]+)$/;
  function safeStyle(s) {
    if (!s) return '';
    const allow = { 'color': COLOR_RE, 'background-color': COLOR_RE, 'width': /^\d+(\.\d+)?(px|%)$/, 'height': /^\d+(\.\d+)?px$/, 'text-align': /^(left|center|right|justify)$/, 'vertical-align': /^(top|middle|bottom|baseline)$/, 'font-weight': /^(bold|[1-9]00)$/ };
    const out = [];
    String(s).split(';').forEach(rule => { const i = rule.indexOf(':'); if (i < 0) return; const k = rule.slice(0, i).trim().toLowerCase(), v = rule.slice(i + 1).trim(); if (allow[k] && allow[k].test(v) && !/url\(|expression|javascript:/i.test(v)) out.push(k + ':' + v); });
    return out.join(';');
  }
  const STYLED = { SPAN: 1, TD: 1, TH: 1, P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, LI: 1, TABLE: 1 };
  function sanitizeRich(html) {
    const src = String(html || ''); if (!src) return '';
    const idoc = document.implementation.createHTMLDocument('x'); idoc.body.innerHTML = src;
    const ALLOW = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, P: 1, DIV: 1, SPAN: 1, BR: 1, H1: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, A: 1, BLOCKQUOTE: 1, CODE: 1, PRE: 1 };
    const walk = (node) => { let out = ''; node.childNodes.forEach(ch => {
      if (ch.nodeType === 3) { out += esc(ch.nodeValue); return; }
      if (ch.nodeType !== 1) return; const tag = ch.tagName;
      if (tag === 'BR') { out += '<br>'; return; }
      if (tag === 'IMG') { const s = ch.getAttribute('src') || ''; if (/^data:image\//i.test(s)) out += `<img src="${s}">`; return; }
      if (tag === 'FONT') { const col = ch.getAttribute('color'); let st = safeStyle(ch.getAttribute('style')); if (!st && col && COLOR_RE.test(col)) st = 'color:' + col; out += `<span${st ? ` style="${st}"` : ''}>${walk(ch)}</span>`; return; }
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT') return;
      if (!ALLOW[tag]) { out += walk(ch); return; }
      let attrs = '';
      if (tag === 'A') { const h = ch.getAttribute('href') || ''; if (/^https?:|^mailto:/i.test(h)) attrs += ` href="${esc(h)}" target="_blank" rel="noopener"`; }
      if (tag === 'TD' || tag === 'TH') { const cs = parseInt(ch.getAttribute('colspan')) || 0, rs = parseInt(ch.getAttribute('rowspan')) || 0; if (cs > 1) attrs += ` colspan="${cs}"`; if (rs > 1) attrs += ` rowspan="${rs}"`; }
      if (tag === 'TABLE') attrs = ' class="one-rt"';
      if (STYLED[tag]) { const st = safeStyle(ch.getAttribute('style')); if (st) attrs += ` style="${st}"`; }
      const t = tag.toLowerCase(); out += `<${t}${attrs}>${walk(ch)}</${t}>`;
    }); return out; };
    return walk(idoc.body);
  }
  function compressImage(file, cb) {
    const fr = new FileReader();
    fr.onload = e => { const img = new Image(); img.onload = () => { try { const MAXW = 1400; let w = img.width, h = img.height; if (w > MAXW) { h = Math.round(h * MAXW / w); w = MAXW; } const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); cb(c.toDataURL('image/jpeg', 0.85)); } catch (_) { cb(e.target.result); } }; img.onerror = () => cb(null); img.src = e.target.result; };
    fr.readAsDataURL(file);
  }
  function rebuildTable(html) {
    const idoc = document.implementation.createHTMLDocument('x'); idoc.body.innerHTML = String(html || '');
    const tbl = idoc.body.querySelector('table'); if (!tbl) return null;
    let out = '<table class="one-rt">';
    tbl.querySelectorAll('tr').forEach(tr => { out += '<tr>'; tr.querySelectorAll('td,th').forEach(cell => { const t = cell.tagName === 'TH' ? 'th' : 'td'; const cs = parseInt(cell.getAttribute('colspan')) || 0, rs = parseInt(cell.getAttribute('rowspan')) || 0; const txt = esc(String(cell.textContent || '').replace(/\s+/g, ' ').trim()); out += `<${t}${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${txt || '<br>'}</${t}>`; }); out += '</tr>'; });
    return out + '</table>';
  }
  function onPaste(ev) {
    const cd = ev.clipboardData; if (!cd) return;
    const imgIt = [...(cd.items || [])].find(it => it.kind === 'file' && /^image\//.test(it.type));
    if (imgIt) { ev.preventDefault(); const f = imgIt.getAsFile(); if (f) compressImage(f, du => { if (du) { document.execCommand('insertHTML', false, `<img src="${du}"><br>`); afterEdit(); } }); return; }
    const html = cd.getData('text/html');
    if (html && /<table/i.test(html)) { ev.preventDefault(); const t = rebuildTable(html); if (t) { document.execCommand('insertHTML', false, t + '<br>'); afterEdit(); } return; }
    ev.preventDefault(); const text = cd.getData('text/plain'); if (text) document.execCommand('insertText', false, text);
  }
  function exec(cmd, val) { $('docBody').focus(); document.execCommand(cmd, false, val || null); afterEdit(); }
  function afterEdit() { const b = bodyCache[curPageId], el = $('docBody'); if (b && el) { b.html = el.innerHTML; savePage(curPageId); } }
  function insertTable() {
    const spec = prompt('표 크기 (행x열)', '3x3'); if (!spec) return;
    const m = spec.match(/(\d+)\s*[xX×*]\s*(\d+)/); if (!m) { alert('예: 3x3'); return; }
    const R = Math.min(40, +m[1] || 3), C = Math.min(16, +m[2] || 3);
    let t = '<table class="one-rt">'; for (let r = 0; r < R; r++) { t += '<tr>'; for (let c = 0; c < C; c++) t += '<td><br></td>'; t += '</tr>'; } t += '</table><p><br></p>';
    $('docBody').focus(); document.execCommand('insertHTML', false, t); afterEdit();
  }

  /* ── 표 편집 (현재 셀 기준) ── */
  let _curCell = null;
  function currentCell() { const sel = window.getSelection(); if (!sel || !sel.rangeCount) return null; let node = sel.anchorNode; while (node && node !== document.body) { if (node.nodeType === 1 && (node.tagName === 'TD' || node.tagName === 'TH') && node.closest('.one-rt') && node.closest('#docBody')) return node; node = node.parentNode; } return null; }
  function updateTableTools() {
    const tt = $('ttools'); if (!tt) return;
    const cell = currentCell();
    if (cell) _curCell = cell;                                   // 캐럿이 셀 안이면 현재 셀 갱신
    const active = !!cell || (_selCells && _selCells.length > 0); // 드래그 선택 중에도 도구 유지
    if (!active) _curCell = null;                                // 표 밖으로 나가면 해제
    tt.style.display = active ? 'inline-flex' : 'none';
  }
  const cellIndex = (cell) => [...cell.parentNode.children].indexOf(cell);
  const tableOf = (cell) => cell.closest('table');
  const rowsOf = (tbl) => [...tbl.querySelectorAll('tr')];
  function addRow(below) { if (!_curCell) return; const tr = _curCell.parentNode; const cols = tr.children.length; const nr = document.createElement('tr'); for (let i = 0; i < cols; i++) { const td = document.createElement('td'); td.innerHTML = '<br>'; nr.appendChild(td); } tr.parentNode.insertBefore(nr, below ? tr.nextSibling : tr); afterEdit(); }
  function addCol(right) { if (!_curCell) return; const idx = cellIndex(_curCell); rowsOf(tableOf(_curCell)).forEach(tr => { const ref = tr.children[idx]; const isH = ref && ref.tagName === 'TH'; const nc = document.createElement(isH ? 'th' : 'td'); nc.innerHTML = '<br>'; tr.insertBefore(nc, right ? (ref ? ref.nextSibling : null) : ref); }); afterEdit(); }
  function delRow() { if (!_curCell) return; const tbl = tableOf(_curCell); if (rowsOf(tbl).length <= 1) return delTable(true); _curCell.parentNode.remove(); _curCell = null; $('ttools').style.display = 'none'; afterEdit(); }
  function delCol() { if (!_curCell) return; const tbl = tableOf(_curCell); if (tbl.querySelector('tr').children.length <= 1) return delTable(true); const idx = cellIndex(_curCell); rowsOf(tbl).forEach(tr => { if (tr.children[idx]) tr.children[idx].remove(); }); _curCell = null; $('ttools').style.display = 'none'; afterEdit(); }
  function toggleHeadRow() { if (!_curCell) return; const firstRow = tableOf(_curCell).querySelector('tr'); [...firstRow.children].forEach(c => { const nn = document.createElement(c.tagName === 'TH' ? 'td' : 'th'); nn.innerHTML = c.innerHTML; [...c.attributes].forEach(a => nn.setAttribute(a.name, a.value)); c.replaceWith(nn); }); afterEdit(); }
  function delTable(skipConfirm) { if (!_curCell) return; if (!skipConfirm && !confirm('표를 삭제할까요?')) return; tableOf(_curCell).remove(); _curCell = null; $('ttools').style.display = 'none'; afterEdit(); }

  /* ── 셀 병합/분할 (grid 모델 기반) ── */
  function readGrid(tbl) {
    const rows = [...tbl.querySelectorAll('tr')]; const occ = []; const cells = [];
    rows.forEach((tr, r) => { occ[r] = occ[r] || []; let c = 0;
      [...tr.children].forEach(cell => { while (occ[r][c]) c++; const cs = cell.colSpan || 1, rs = cell.rowSpan || 1;
        const rec = { r0: r, c0: c, rs, cs, html: cell.innerHTML, tag: cell.tagName.toLowerCase(), style: cell.getAttribute('style') || '', _el: cell }; cells.push(rec);
        for (let dr = 0; dr < rs; dr++) { occ[r + dr] = occ[r + dr] || []; for (let dc = 0; dc < cs; dc++) occ[r + dr][c + dc] = rec; }
        c += cs;
      });
    });
    const grid = { cells }; rebuildOcc(grid); return grid;
  }
  function rebuildOcc(grid) {
    const occ = []; let ncols = 0;
    grid.cells.forEach(rec => { for (let dr = 0; dr < rec.rs; dr++) { const r = rec.r0 + dr; occ[r] = occ[r] || []; for (let dc = 0; dc < rec.cs; dc++) occ[r][rec.c0 + dc] = rec; } ncols = Math.max(ncols, rec.c0 + rec.cs); });
    grid.occ = occ; grid.nrows = occ.length; grid.ncols = ncols;
  }
  function writeGrid(tbl, grid) {
    let html = '';
    for (let r = 0; r < grid.nrows; r++) { html += '<tr>';
      for (let c = 0; c < grid.ncols; c++) { const rec = (grid.occ[r] || [])[c]; if (rec && rec.r0 === r && rec.c0 === c) { const sp = (rec.cs > 1 ? ` colspan="${rec.cs}"` : '') + (rec.rs > 1 ? ` rowspan="${rec.rs}"` : ''); const st = safeStyle(rec.style || ''); html += `<${rec.tag}${sp}${st ? ` style="${st}"` : ''}>${rec.html || '<br>'}</${rec.tag}>`; } }
      html += '</tr>';
    }
    tbl.innerHTML = html;
  }
  function restoreCaret(tbl, r, c) {
    const grid = readGrid(tbl); const rec = (grid.occ[r] || [])[c]; const el = rec && rec._el;
    if (el) { _curCell = el; try { const rng = document.createRange(); rng.selectNodeContents(el); rng.collapse(true); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng); } catch (_) {} }
    updateTableTools();
  }
  /* ── 드래그로 셀 범위 선택 → 선택 전체 병합 ── */
  let _selAnchor = null, _selDown = false, _selMoved = false, _selCells = [], _selRange = null;
  function clearCellSel() { document.querySelectorAll('#docBody .one-rt .cellsel').forEach(c => c.classList.remove('cellsel')); _selCells = []; _selRange = null; }
  function selectRange(a, b) {
    const tbl = a.closest('table'); if (!tbl || b.closest('table') !== tbl) return;
    const grid = readGrid(tbl); const A = grid.cells.find(r => r._el === a), B = grid.cells.find(r => r._el === b); if (!A || !B) return;
    let r0 = Math.min(A.r0, B.r0), c0 = Math.min(A.c0, B.c0), r1 = Math.max(A.r0 + A.rs - 1, B.r0 + B.rs - 1), c1 = Math.max(A.c0 + A.cs - 1, B.c0 + B.cs - 1);
    let changed = true; // 병합셀이 걸치면 사각형 확장
    while (changed) { changed = false; grid.cells.forEach(rec => { const rr1 = rec.r0 + rec.rs - 1, cc1 = rec.c0 + rec.cs - 1; if (rec.r0 <= r1 && rr1 >= r0 && rec.c0 <= c1 && cc1 >= c0) { if (rec.r0 < r0) { r0 = rec.r0; changed = true; } if (rr1 > r1) { r1 = rr1; changed = true; } if (rec.c0 < c0) { c0 = rec.c0; changed = true; } if (cc1 > c1) { c1 = cc1; changed = true; } } }); }
    clearCellSel(); const set = new Set();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const rec = (grid.occ[r] || [])[c]; if (rec && !set.has(rec._el)) { set.add(rec._el); rec._el.classList.add('cellsel'); _selCells.push(rec._el); } }
    _selRange = { r0, c0, r1, c1, tbl };
  }
  function mergeSelection() {
    if (_selCells.length < 2 || !_selRange) { alert('병합할 칸들을 마우스로 드래그해 선택한 뒤 눌러주세요.'); return; }
    const { r0, c0, r1, c1 } = _selRange; const tbl = _selRange.tbl;
    const grid = readGrid(tbl); const keep = (grid.occ[r0] || [])[c0]; if (!keep) return;
    let html = ''; const seen = new Set();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const rec = (grid.occ[r] || [])[c]; if (rec && !seen.has(rec)) { seen.add(rec); const t = (rec.html || '').trim(); if (t && t !== '<br>') html += (html ? '<br>' : '') + rec.html; } }
    keep.html = html || '<br>'; keep.rs = r1 - r0 + 1; keep.cs = c1 - c0 + 1;
    // 병합 셀은 여러 열/행을 걸치므로 단일-칸 너비/높이는 제거(다른 행의 셀이 열 너비 유지). 색·정렬은 보존.
    keep.style = String(keep.style || '').split(';').filter(s => { const k = (s.split(':')[0] || '').trim().toLowerCase(); return s.trim() && k !== 'width' && k !== 'height'; }).join(';');
    grid.cells = grid.cells.filter(rec => rec === keep || !(rec.r0 >= r0 && rec.r0 <= r1 && rec.c0 >= c0 && rec.c0 <= c1));
    rebuildOcc(grid); writeGrid(tbl, grid); restoreCaret(tbl, r0, c0); clearCellSel(); afterEdit();
  }
  function onBodyMousedown(e) {
    if (_rzHint) { rzStart(e); return; }
    const cell = e.target.closest && e.target.closest('.one-rt td, .one-rt th');
    clearCellSel(); _selAnchor = cell || null; _selDown = !!cell; _selMoved = false;
  }
  function onDocMouseMove(e) {
    if (_rz) { rzMove(e); return; }
    if (_selDown && _selAnchor) {
      let cell = e.target.closest && e.target.closest('.one-rt td, .one-rt th');
      if (!cell) { const el = document.elementFromPoint(e.clientX, e.clientY); cell = el && el.closest && el.closest('.one-rt td, .one-rt th'); }
      if (cell && cell.closest('table') === _selAnchor.closest('table') && (cell !== _selAnchor || _selMoved)) {
        _selMoved = true; e.preventDefault(); const s = window.getSelection(); if (s) s.removeAllRanges(); selectRange(_selAnchor, cell);
      }
    }
  }
  function onDocMouseUp() {
    if (_rz) rzEnd();
    if (_selDown) { _selDown = false; if (!_selMoved) clearCellSel(); else { _curCell = _selAnchor; updateTableTools(); } }
  }
  function splitCell() {
    if (!_curCell) return; const tbl = tableOf(_curCell);
    const grid = readGrid(tbl); const A = grid.cells.find(rec => rec._el === _curCell); if (!A) return;
    if (A.rs <= 1 && A.cs <= 1) { alert('병합된 셀이 아닙니다.'); return; }
    const { r0, c0, rs, cs, tag } = A; A.rs = 1; A.cs = 1;
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { if (dr === 0 && dc === 0) continue; grid.cells.push({ r0: r0 + dr, c0: c0 + dc, rs: 1, cs: 1, html: '<br>', tag }); }
    rebuildOcc(grid); writeGrid(tbl, grid); restoreCaret(tbl, r0, c0); afterEdit();
  }
  /* 표 셀 키보드: Ctrl+Enter=아래 행, Shift+Enter=오른쪽 열, Tab=다음 칸(끝이면 행 추가), Shift+Tab=이전 칸 */
  function onBodyKeydown(e) {
    const cell = currentCell();
    if (e.key === 'Tab') { if (!cell) return; e.preventDefault(); _curCell = cell; moveCell(cell, e.shiftKey ? -1 : 1); return; }
    if (e.key !== 'Enter') return;
    if (!cell) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); _curCell = cell; addRow(true); }
    else if (e.shiftKey) { e.preventDefault(); _curCell = cell; addCol(true); }
  }
  function focusCell(el) { if (!el) return; _curCell = el; try { const rng = document.createRange(); rng.selectNodeContents(el); rng.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng); } catch (_) {} updateTableTools(); }
  function moveCell(cell, dir) {
    const tbl = tableOf(cell); const cells = [...tbl.querySelectorAll('td,th')]; const i = cells.indexOf(cell);
    if (dir > 0) { if (i + 1 < cells.length) focusCell(cells[i + 1]); else { const tr = cell.parentNode; addRow(true); focusCell(tr.nextSibling && tr.nextSibling.children[0]); } }
    else { if (i - 1 >= 0) focusCell(cells[i - 1]); }
  }

  /* ── 색상: 글자색(선택 텍스트) / 칸 배경색(현재 셀) ── */
  function applyFontColor(color) {
    if (_selCells && _selCells.length) { _selCells.forEach(c => c.style.color = color); afterEdit(); return; }  // 드래그로 선택한 칸들: 칸 텍스트 전체 색
    const el = $('docBody'); el.focus(); try { document.execCommand('styleWithCSS', false, true); } catch (_) {} document.execCommand('foreColor', false, color); afterEdit();
  }
  function selectedCellsOr() { return (_selCells && _selCells.length) ? _selCells.slice() : (_curCell ? [_curCell] : []); }
  function applyCellColor(color) { const cells = selectedCellsOr(); if (!cells.length) { alert('표 안의 칸을 클릭(또는 드래그로 여러 칸 선택)하세요.'); return; } cells.forEach(c => c.style.backgroundColor = color); afterEdit(); }
  function clearCellColor() { const cells = selectedCellsOr(); if (!cells.length) return; cells.forEach(c => { c.style.backgroundColor = ''; if (!c.getAttribute('style')) c.removeAttribute('style'); }); afterEdit(); }
  // 표 칸 정렬 — 선택된 칸들(없으면 현재 칸)에 가로(textAlign)/세로(verticalAlign) 적용
  function alignCells(prop, val) {
    const cells = (_selCells && _selCells.length) ? _selCells.slice() : (_curCell ? [_curCell] : []);
    if (!cells.length) { alert('표 안의 칸을 클릭(또는 드래그로 여러 칸 선택)한 뒤 눌러주세요.'); return; }
    cells.forEach(c => { c.style[prop] = val; if (!c.getAttribute('style')) c.removeAttribute('style'); });
    afterEdit();
  }

  /* ── 표 테두리 드래그로 열 너비·행 높이 조절 ── */
  let _rz = null, _rzHint = null;
  function rzHover(e) {
    if (_rz) return; const el = $('docBody');
    const cell = e.target.closest && e.target.closest('.one-rt td, .one-rt th');
    if (!cell) { el.style.cursor = ''; _rzHint = null; return; }
    const r = cell.getBoundingClientRect();
    const nearRight = r.right - e.clientX < 6 && r.right - e.clientX >= -1;
    const nearBottom = r.bottom - e.clientY < 6 && r.bottom - e.clientY >= -1;
    if (nearRight) { el.style.cursor = 'col-resize'; _rzHint = { type: 'col', cell }; }
    else if (nearBottom) { el.style.cursor = 'row-resize'; _rzHint = { type: 'row', cell }; }
    else { el.style.cursor = ''; _rzHint = null; }
  }
  function rzStart(e) {
    if (!_rzHint) return; e.preventDefault();
    const cell = _rzHint.cell, r = cell.getBoundingClientRect(), tbl = cell.closest('table');
    if (_rzHint.type === 'col') _rz = { type: 'col', tbl, colIdx: [...cell.parentNode.children].indexOf(cell), startX: e.clientX, startW: r.width };
    else _rz = { type: 'row', tr: cell.parentNode, startY: e.clientY, startH: cell.parentNode.getBoundingClientRect().height };
    document.body.style.userSelect = 'none';
  }
  function rzMove(e) {
    if (!_rz) return;
    if (_rz.type === 'col') { const w = Math.max(30, Math.round(_rz.startW + (e.clientX - _rz.startX))); [..._rz.tbl.querySelectorAll('tr')].forEach(tr => { const c = tr.children[_rz.colIdx]; if (c) c.style.width = w + 'px'; }); }
    else { const h = Math.max(24, Math.round(_rz.startH + (e.clientY - _rz.startY))); [..._rz.tr.children].forEach(c => c.style.height = h + 'px'); }
  }
  function rzEnd() { if (!_rz) return; _rz = null; document.body.style.userSelect = ''; afterEdit(); }

  function attachFile() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.onchange = () => { const body = bodyCache[curPageId]; if (!body) return; body.attachments = body.attachments || [];
      [...inp.files].forEach(f => { if (f.size > 5 * 1024 * 1024) { alert('⚠ ' + f.name + ' — 5MB 초과, 첨부 안 됨'); return; } const r = new FileReader(); r.onload = e => { body.attachments.push({ name: f.name, type: f.type, size: f.size, dataUrl: e.target.result }); savePage(curPageId); renderAtts(); }; r.readAsDataURL(f); }); };
    inp.click();
  }
  function openAtt(i) {
    const a = (bodyCache[curPageId].attachments || [])[i]; if (!a || !a.dataUrl) return;
    if (/^image\//.test(a.type || '')) { const lb = document.createElement('div'); lb.className = 'lb'; lb.innerHTML = `<button class="x">✕ 닫기</button><img src="${a.dataUrl}">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); return; }
    try { const c = a.dataUrl.indexOf(','); const mime = (a.dataUrl.slice(0, c).match(/data:([^;]+)/) || [])[1] || a.type || 'application/octet-stream'; const bin = atob(a.dataUrl.slice(c + 1)); const arr = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k); const url = URL.createObjectURL(new Blob([arr], { type: mime })); const w = window.open(url, '_blank'); if (!w) { const el = document.createElement('a'); el.href = url; el.download = a.name; el.click(); } setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (_) { alert('열기 실패'); }
  }
  function fsize(n) { n = Number(n) || 0; return n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(0) + 'KB' : (n / 1048576).toFixed(1) + 'MB'; }

  /* ── CRUD ── */
  function editNotebook(id) {
    const ex = id ? DATA.notebooks.find(n => n.id === id) : null;
    dialog(ex ? '필기장 편집' : '새 필기장', [
      { key: 'name', label: '이름', value: ex ? ex.name : '' },
      { key: 'ico', label: '아이콘', type: 'icons', value: ex ? ex.ico : NB_ICONS[0] },
      { key: 'color', label: '색상', type: 'color', colors: NB_COLORS, value: ex ? ex.color : NB_COLORS[0] },
    ], (v) => { if (!v.name.trim()) return;
      if (ex) { ex.name = v.name.trim(); ex.ico = v.ico; ex.color = v.color; }
      else { const n = { id: uid('nb'), name: v.name.trim(), color: v.color, ico: v.ico, nodes: [] }; DATA.notebooks.push(n); curNb = n.id; curSecId = null; curPageId = null; }
      saveTree(); selectFirst();
    }, ex ? () => { if (DATA.notebooks.length <= 1) { alert('필기장이 하나뿐입니다.'); return; } if (!confirm('이 필기장을 삭제할까요? (안의 섹션·페이지 모두 목록에서 사라집니다)')) return; DATA.notebooks = DATA.notebooks.filter(n => n.id !== id); curNb = DATA.notebooks[0].id; curSecId = null; curPageId = null; saveTree(); selectFirst(); } : null);
  }
  function addNode(parentGroupId) {
    dialog('새로 만들기', [
      { key: 'type', label: '종류', type: 'select', options: [['section', '● 섹션 (페이지를 담음)'], ['group', '📁 그룹 (섹션·그룹을 담음)']], value: 'section' },
      { key: 'name', label: '이름', value: '' },
      { key: 'color', label: '색상 (섹션)', type: 'color', colors: SEC_COLORS, value: SEC_COLORS[0] },
    ], (v) => { if (!v.name.trim()) return;
      const node = v.type === 'group' ? { id: uid('g'), type: 'group', name: v.name.trim(), open: true, children: [] } : { id: uid('s'), type: 'section', name: v.name.trim(), color: v.color, open: true, pages: [] };
      if (parentGroupId) { const g = findNode(parentGroupId); g.open = true; g.children.push(node); } else nb().nodes.push(node);
      if (node.type === 'section') { curSecId = node.id; curPageId = null; }
      saveTree(); renderNav(); openCanvas();
    });
  }
  function renameNode(id) { const n = findNode(id);
    dialog('이름 변경', [{ key: 'name', label: '이름', value: n.name }].concat(n.type === 'section' ? [{ key: 'color', label: '색상', type: 'color', colors: SEC_COLORS, value: n.color }] : []),
      (v) => { if (!v.name.trim()) return; n.name = v.name.trim(); if (v.color) n.color = v.color; saveTree(); renderNav(); openCanvas(); });
  }
  function deleteNode(id) { const n = findNode(id);
    if (!confirm(`"${n.name}" ${n.type === 'group' ? '그룹(안의 모든 것 포함)' : '섹션(안의 페이지 포함)'}을(를) 삭제할까요?`)) return;
    const list = findNodeParentList(id); const i = list.indexOf(n); if (i >= 0) list.splice(i, 1);
    if (curSecId === id) { curSecId = null; curPageId = null; }
    saveTree(); selectFirst();
  }
  function addPage(parentPageId) {
    const sec = findNode(curSecId); if (!sec) { alert('먼저 섹션을 선택하세요'); return; }
    sec.open = true;
    const p = { id: uid('p'), title: '', updated: today(), tags: [], sub: [], open: true };
    bodyCache[p.id] = { id: p.id, html: '', attachments: [] };
    if (parentPageId) { const par = findPage(sec.pages, parentPageId); par.open = true; par.sub = par.sub || []; par.sub.push(p); } else sec.pages.push(p);
    curPageId = p.id; saveTree(); renderNav(); openCanvas();
    setTimeout(() => { const t = $('docTitle'); if (t) t.focus(); }, 30);
  }
  // 페이지 위치 찾기: { list, index, parentPage(null=최상위) }
  function locatePage(pages, id, parent) {
    const idx = pages.findIndex(p => p.id === id); if (idx >= 0) return { list: pages, index: idx, parentPage: parent || null };
    for (const p of pages) { if (p.sub && p.sub.length) { const r = locatePage(p.sub, id, p); if (r) return r; } }
    return null;
  }
  // → 하위로: 바로 위 형제 페이지의 하위페이지로
  function demotePage(id, secId) {
    const sec = findNode(secId || curSecId); const loc = locatePage(sec.pages, id); if (!loc) return;
    if (loc.index === 0) { alert('바로 위에 형제 페이지가 없어 하위로 내릴 수 없습니다.'); return; }
    const P = loc.list.splice(loc.index, 1)[0]; const prev = loc.list[loc.index - 1];
    prev.sub = prev.sub || []; prev.sub.push(P); prev.open = true;
    curPageId = P.id; curSecId = sec.id; saveTree(); renderNav(); openCanvas();
  }
  // ← 상위로: 부모와 같은 레벨(부모 바로 다음)으로
  function promotePage(id, secId) {
    const sec = findNode(secId || curSecId); const loc = locatePage(sec.pages, id); if (!loc) return;
    if (!loc.parentPage) { alert('이미 최상위 페이지입니다.'); return; }
    const P = loc.list.splice(loc.index, 1)[0];
    const ploc = locatePage(sec.pages, loc.parentPage.id);
    (ploc ? ploc.list : sec.pages).splice(ploc ? ploc.index + 1 : sec.pages.length, 0, P);
    curPageId = P.id; curSecId = sec.id; saveTree(); renderNav(); openCanvas();
  }
  function renamePage(id, secId) { const sec = findNode(secId || curSecId); const p = findPage(sec.pages, id);
    dialog('페이지 이름', [{ key: 'name', label: '제목', value: p.title || '' }], (v) => { p.title = v.name.trim(); p.updated = today(); saveTree(); renderNav(); if (curPageId === id) openCanvas(); });
  }
  function deletePage(id, secId) { const sec = findNode(secId || curSecId); const p = findPage(sec.pages, id);
    if (!confirm(`"${p.title || '제목 없음'}" 페이지를 삭제할까요?${(p.sub && p.sub.length) ? ' (하위 페이지 포함)' : ''}`)) return;
    const list = findPageParent(sec.pages, id) || sec.pages; const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1);
    const rm = (pg) => { fetch('/api/one', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deletePage: pg.id }) }).catch(() => {}); (pg.sub || []).forEach(rm); }; rm(p);
    if (curPageId === id) { curPageId = (sec.pages[0] && sec.pages[0].id) || null; curSecId = sec.id; }
    saveTree(); renderNav(); openCanvas();
  }

  /* ── 필기장 드롭다운 메뉴 ── */
  function toggleNbMenu() {
    let m = document.querySelector('.nb-menu'); if (m) { m.remove(); return; }
    m = document.createElement('div'); m.className = 'nb-menu';
    m.innerHTML = DATA.notebooks.map(n => `<div class="mi ${n.id === curNb ? 'on' : ''}" data-nb="${n.id}"><span class="d" style="background:${n.color}"></span>${n.ico || '📘'} ${esc(n.name)}</div>`).join('')
      + `<div class="msep"></div><div class="mi act" data-x="rename">✎ 현재 필기장 이름변경</div><div class="mi act" data-x="new">＋ 새 필기장</div>`;
    document.body.appendChild(m);
    const r = $('nbSwitch').getBoundingClientRect(); m.style.left = r.left + 'px'; m.style.top = (r.bottom + 6) + 'px';
    m.querySelectorAll('[data-nb]').forEach(el => el.onclick = () => { curNb = el.dataset.nb; curSecId = null; curPageId = null; m.remove(); selectFirst(); });
    m.querySelector('[data-x="rename"]').onclick = () => { m.remove(); editNotebook(curNb); };
    m.querySelector('[data-x="new"]').onclick = () => { m.remove(); editNotebook(null); };
    setTimeout(() => document.addEventListener('click', function h(ev) { if (!m.contains(ev.target) && !$('nbSwitch').contains(ev.target)) { m.remove(); document.removeEventListener('click', h); } }), 0);
  }

  /* ── 모달 dialog ── */
  function dialog(title, fields, onOk, onDelete) {
    const ov = document.createElement('div'); ov.className = 'ov'; const state = {}; fields.forEach(f => state[f.key] = f.value);
    const fieldHtml = fields.map(f => {
      if (f.type === 'select') return `<div class="fld"><label>${f.label}</label><select data-k="${f.key}">${f.options.map(([v, l]) => `<option value="${v}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      if (f.type === 'color') return `<div class="fld"><label>${f.label}</label><div class="color-pick" data-k="${f.key}">${f.colors.map(c => `<span class="c ${c === f.value ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div></div>`;
      if (f.type === 'icons') return `<div class="fld"><label>${f.label}</label><div class="color-pick" data-k="${f.key}">${NB_ICONS.map(ic => `<span class="c ${ic === f.value ? 'on' : ''}" data-c="${ic}" style="background:var(--chrome2);display:grid;place-items:center;font-size:15px">${ic}</span>`).join('')}</div></div>`;
      return `<div class="fld"><label>${f.label}</label><input data-k="${f.key}" value="${esc(f.value || '')}"></div>`;
    }).join('');
    ov.innerHTML = `<div class="dlg"><h3>${esc(title)}</h3>${fieldHtml}<div class="dlg-actions">${onDelete ? '<button class="btn btn-d" data-x="del">삭제</button>' : ''}<button class="btn btn-o" data-x="cancel">취소</button><button class="btn btn-p" data-x="ok">확인</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelectorAll('input,select').forEach(el => el.oninput = () => state[el.dataset.k] = el.value);
    ov.querySelectorAll('.color-pick').forEach(cp => cp.querySelectorAll('.c').forEach(c => c.onclick = () => { cp.querySelectorAll('.c').forEach(x => x.classList.remove('on')); c.classList.add('on'); state[cp.dataset.k] = c.dataset.c; }));
    const close = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) close(); };
    ov.querySelector('[data-x="cancel"]').onclick = close;
    ov.querySelector('[data-x="ok"]').onclick = () => { close(); onOk(state); };
    if (onDelete) ov.querySelector('[data-x="del"]').onclick = () => { close(); onDelete(); };
    const nameInp = ov.querySelector('[data-k="name"]'); if (nameInp) { nameInp.focus(); nameInp.select && nameInp.select(); nameInp.onkeydown = (e) => { if (e.key === 'Enter') { close(); onOk(state); } }; }
  }

  function selectFirst() {
    if (!curNb && DATA.notebooks[0]) curNb = DATA.notebooks[0].id;
    const sec = curSecId ? findNode(curSecId) : firstSection(nb().nodes);
    curSecId = sec ? sec.id : null;
    if (sec && !curPageId) curPageId = (sec.pages[0] && sec.pages[0].id) || null;
    renderRail(); renderNav(); openCanvas();
  }

  /* ═══════════════════════════════════════════════════════════
   * 🎙 회의 녹음 → 회의록
   *   - MediaRecorder 로 오디오 캡처(재전사·미리듣기용, 메모리 보관)
   *   - Web Speech API 로 실시간 전사(말하는 즉시 텍스트)
   *   - Whisper 재전사(/api/one-transcribe): 오디오를 16kHz mono WAV 청크로 잘라 순차 전송
   *   - 회의록 정리(/api/one-meeting): 전사 텍스트를 Claude 로 구조화
   * ═══════════════════════════════════════════════════════════ */
  const REC = {
    stream: null, mr: null, chunks: [], blob: null,
    rec: null, recActive: false, finalText: '', interim: '',
    t0: 0, timer: null, busy: false,
    wake: null, onBU: null, onVis: null,
  };
  const REC_DRAFT_KEY = 'one_rec_draft';
  function recSaveDraft() {
    try { localStorage.setItem(REC_DRAFT_KEY, JSON.stringify({ t: REC.finalText || '', at: Date.now(), page: curPageId || '' })); } catch (_) {}
  }
  function recClearDraft() { try { localStorage.removeItem(REC_DRAFT_KEY); } catch (_) {} }
  // 화면 꺼짐/백그라운드 폐기 방지용 wake lock (모바일에서 특히 중요)
  async function recAcquireWake() { try { if ('wakeLock' in navigator) REC.wake = await navigator.wakeLock.request('screen'); } catch (_) {} }
  function recReleaseWake() { try { REC.wake && REC.wake.release && REC.wake.release(); } catch (_) {} REC.wake = null; }
  function recArmGuards() {
    REC.onBU = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };  // 녹음 중 새로고침/이탈 경고
    window.addEventListener('beforeunload', REC.onBU);
    REC.onVis = () => { if (document.visibilityState === 'visible' && REC.recActive) { recAcquireWake(); try { REC.rec && REC.rec.start(); } catch (_) {} } };  // 복귀 시 인식 재개
    document.addEventListener('visibilitychange', REC.onVis);
  }
  function recDisarmGuards() {
    if (REC.onBU) { window.removeEventListener('beforeunload', REC.onBU); REC.onBU = null; }
    if (REC.onVis) { document.removeEventListener('visibilitychange', REC.onVis); REC.onVis = null; }
  }
  /* ── 녹음 오디오 IndexedDB 저장 — 앱 전환·탭 폐기에도 오디오 생존 → 정본(Whisper) 전사 복구 ── */
  const RIDB = { name: 'one_rec_audio', store: 'chunks', meta: 'meta' };
  function ridbOpen() {
    return new Promise((res) => { let done = false, fin = v => { if (!done) { done = true; res(v); } };
      try {
        if (!window.indexedDB) return fin(null);
        const rq = indexedDB.open(RIDB.name, 1);
        rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains(RIDB.store)) db.createObjectStore(RIDB.store, { autoIncrement: true }); if (!db.objectStoreNames.contains(RIDB.meta)) db.createObjectStore(RIDB.meta); };
        rq.onsuccess = () => fin(rq.result); rq.onerror = () => fin(null); setTimeout(() => fin(null), 3000);
      } catch (_) { fin(null); }
    });
  }
  async function ridbReset(mime) { const db = await ridbOpen(); if (!db) return; try { const tx = db.transaction([RIDB.store, RIDB.meta], 'readwrite'); tx.objectStore(RIDB.store).clear(); tx.objectStore(RIDB.meta).put({ mime: mime || 'audio/webm', at: Date.now(), page: curPageId || '' }, 'cur'); } catch (_) {} }
  function ridbAppend(blob) { ridbOpen().then(db => { if (!db) return; try { db.transaction(RIDB.store, 'readwrite').objectStore(RIDB.store).add(blob); } catch (_) {} }); }
  async function ridbAssemble() {
    const db = await ridbOpen(); if (!db) return null;
    return new Promise((res) => { try {
      const tx = db.transaction([RIDB.store, RIDB.meta], 'readonly');
      let mime = 'audio/webm'; const parts = [];
      tx.objectStore(RIDB.meta).get('cur').onsuccess = (e) => { if (e.target.result && e.target.result.mime) mime = e.target.result.mime; };
      const cur = tx.objectStore(RIDB.store).openCursor();
      cur.onsuccess = (e) => { const c = e.target.result; if (c) { parts.push(c.value); c.continue(); } else res(parts.length ? new Blob(parts, { type: mime }) : null); };
      cur.onerror = () => res(null);
    } catch (_) { res(null); } });
  }
  async function ridbClear() { const db = await ridbOpen(); if (!db) return; try { const tx = db.transaction([RIDB.store, RIDB.meta], 'readwrite'); tx.objectStore(RIDB.store).clear(); tx.objectStore(RIDB.meta).clear(); } catch (_) {} }
  async function ridbCount() { const db = await ridbOpen(); if (!db) return 0; return new Promise((res) => { try { const rq = db.transaction(RIDB.store, 'readonly').objectStore(RIDB.store).count(); rq.onsuccess = () => res(rq.result || 0); rq.onerror = () => res(0); } catch (_) { res(0); } }); }
  function recPanelHtml() {
    return `<div class="ov" id="recOv"></div>
    <div class="rec-panel" id="recPanel">
      <div class="rec-head">
        <span>🎙 회의 녹음</span>
        <button class="rec-x" id="recClose" title="닫기">${ic('x', 18) || '✕'}</button>
      </div>
      <div class="rec-status" id="recStatus"><span class="rec-dot" id="recDot"></span><span id="recStat">대기 중</span> <b id="recTime">00:00</b></div>
      <div class="rec-hint" id="recHint">아래 실시간 인식은 <b>대략적인 미리보기</b>입니다. <b>정지하면 녹음 전체를 자동으로 정확히 다시 전사(Whisper)</b>해 실시간의 누락을 보완합니다. ⚠ 녹음 중에는 이 탭을 <b>화면에 켜 둔 채</b>로 두세요(화면 꺼짐은 자동 방지). 앱을 전환해 녹음이 끊겨도 저장된 오디오로 복구 전사할 수 있어요.</div>
      <textarea class="rec-ta" id="recText" placeholder="여기에 전사 텍스트가 표시됩니다. 직접 수정해도 됩니다."></textarea>
      <div class="rec-ctrls">
        <button class="rec-btn rec-go" id="recStart">● 녹음 시작</button>
        <button class="rec-btn rec-stop" id="recStop" disabled>■ 정지</button>
        <audio class="rec-audio" id="recAudio" controls style="display:none"></audio>
      </div>
      <div class="rec-actions" id="recActions" style="display:none">
        <button class="rec-btn rec-primary" id="recWhisper">🎯 Whisper 정확 전사</button>
        <button class="rec-btn rec-primary" id="recMinutes">📋 회의록 정리</button>
        <button class="rec-btn" id="recInsert">📄 전사만 삽입</button>
        <a class="rec-btn rec-dl" id="recDownload" download="recording.webm">💾 오디오 저장</a>
      </div>
      <div class="rec-prog" id="recProg" style="display:none"></div>
    </div>`;
  }
  function openRecPanel() {
    if (!curPageId) { alert('먼저 페이지를 여세요.'); return; }
    if (document.getElementById('recPanel')) return;
    const wrap = document.createElement('div'); wrap.id = 'recWrap'; wrap.innerHTML = recPanelHtml();
    document.body.appendChild(wrap);
    $('recClose').onclick = closeRecPanel;
    // 녹음 중 배경 클릭으로 실수로 닫히지 않게 — 진행 중엔 확인
    $('recOv').onclick = () => { if (REC.recActive) { if (confirm('녹음 중입니다. 정말 닫을까요? (녹음이 중단됩니다)')) closeRecPanel(); } else closeRecPanel(); };
    $('recStart').onclick = recStart; $('recStop').onclick = recStop;
    $('recWhisper').onclick = recWhisper; $('recMinutes').onclick = recMinutes; $('recInsert').onclick = recInsertText;
    $('recText').oninput = () => { REC.finalText = $('recText').value; recSaveDraft(); };
    // 이전 세션(백그라운드 폐기 등)에서 남은 전사 복원
    try {
      const d = JSON.parse(localStorage.getItem(REC_DRAFT_KEY) || 'null');
      if (d && d.t && d.t.trim()) {
        $('recText').value = d.t; REC.finalText = d.t;
        $('recActions').style.display = 'flex';
        $('recHint').innerHTML = '↩ 이전에 인식된 전사를 <b>복원</b>했습니다. 그대로 [회의록 정리]하거나, <button id="recClearDraft" class="rec-btn" style="padding:2px 9px;font-size:11px">새로 시작</button> 하세요.';
        const cb = document.getElementById('recClearDraft');
        if (cb) cb.onclick = () => { recClearDraft(); ridbClear(); REC.finalText = ''; REC.blob = null; $('recText').value = ''; $('recActions').style.display = 'none'; $('recHint').textContent = '새로 녹음하세요.'; };
      }
    } catch (_) {}
    // 앱 전환·탭 폐기로 끊긴 녹음의 오디오가 IndexedDB 에 남아있으면 복구 전사 제안
    ridbCount().then(n => {
      if (n > 0 && document.getElementById('recPanel') && !REC.recActive) {
        const h = $('recHint'); if (!h) return;
        h.innerHTML += ' <div style="margin-top:7px;padding-top:7px;border-top:1px dashed var(--line)">💾 중단된 녹음의 <b>오디오가 저장</b>되어 있습니다. <button id="recRecover" class="rec-btn rec-primary" style="padding:4px 11px;font-size:12px">↩ 오디오로 정본 전사</button></div>';
        const rb = document.getElementById('recRecover'); if (rb) rb.onclick = recRecoverAudio;
      }
    });
  }
  function closeRecPanel() {
    if (REC.recActive) { try { recStop(); } catch (_) {} }
    try { if (REC.stream) REC.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    REC.stream = null;
    recReleaseWake(); recDisarmGuards();
    const w = document.getElementById('recWrap'); if (w) w.remove();
  }
  function recSetStat(txt, on) {
    const s = $('recStat'), d = $('recDot'); if (s) s.textContent = txt; if (d) d.classList.toggle('on', !!on);
  }
  function recTick() {
    const el = $('recTime'); if (!el) return;
    const s = Math.floor((Date.now() - REC.t0) / 1000);
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  async function recStart() {
    if (REC.recActive) return;
    // 노이즈 억제·에코 제거·자동 게인 — 인식 품질 향상(Web Speech·Whisper 공통)
    try { REC.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { alert('마이크 권한이 필요합니다: ' + e.message); return; }
    REC.chunks = []; REC.blob = null; REC.interim = '';
    if (!REC.finalText) REC.finalText = $('recText').value || '';
    // MediaRecorder — 오디오 저장(재전사·미리듣기). timeslice 로 3초마다 chunk flush.
    let mime = 'audio/webm'; try { if (!MediaRecorder.isTypeSupported(mime)) mime = ''; } catch (_) { mime = ''; }
    REC.mr = new MediaRecorder(REC.stream, mime ? { mimeType: mime } : undefined);
    await ridbReset(REC.mr.mimeType || mime || 'audio/webm');   // 새 세션 — 이전 오디오 청크 비우고 메타 기록
    REC.mr.ondataavailable = e => { if (e.data && e.data.size) { REC.chunks.push(e.data); ridbAppend(e.data); } };   // 메모리 + IndexedDB 동시 저장
    REC.mr.onstop = recOnAudioReady;
    REC.mr.start(3000);
    // Web Speech — 실시간 전사(미리보기)
    startSpeech();
    REC.recActive = true; REC.t0 = Date.now(); REC.timer = setInterval(recTick, 500); recTick();
    recSetStat('녹음 중 · 화면 켜 두세요', true);
    $('recStart').disabled = true; $('recStop').disabled = false;
    $('recActions').style.display = 'none'; $('recAudio').style.display = 'none';
    recAcquireWake(); recArmGuards();
  }
  function recStop() {
    if (!REC.recActive) return;
    REC.recActive = false;
    clearInterval(REC.timer);
    try { REC.rec && REC.rec.stop(); } catch (_) {}
    try { REC.mr && REC.mr.state !== 'inactive' && REC.mr.stop(); } catch (_) {}
    recSetStat('정지됨', false);
    $('recStart').disabled = false; $('recStop').disabled = true;
    recReleaseWake(); recDisarmGuards(); recSaveDraft();
  }
  function recOnAudioReady() {
    try { if (REC.stream) REC.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    REC.blob = new Blob(REC.chunks, { type: (REC.mr && REC.mr.mimeType) || 'audio/webm' });
    const url = URL.createObjectURL(REC.blob);
    const au = $('recAudio'); if (au) { au.src = url; au.style.display = 'block'; }
    const dl = $('recDownload'); if (dl) { dl.href = url; dl.download = 'meeting-' + today() + '.webm'; }
    $('recActions').style.display = 'flex';
    // 실시간 전사 결과를 textarea 로 (Whisper 정본 전사 전까지 임시 표시)
    $('recText').value = (REC.finalText || '').trim();
    // 정지 즉시 녹음 전체를 자동으로 정확히 재전사 → 실시간 인식의 누락 보완(정본)
    autoWhisperAfterStop();
  }
  async function autoWhisperAfterStop() {
    if (!REC.blob || REC.blob.size < 8000 || REC.busy) return;   // 너무 짧으면 skip
    REC.busy = true; recProg('🎯 정본 전사 생성 중(Whisper)… 녹음이 길면 잠시 걸립니다');
    try {
      const out = await transcribeBlob(REC.blob);
      if (out) { REC.finalText = out; $('recText').value = out; recSaveDraft(); recProg('✅ 정본 전사 완료 — 실시간보다 정확합니다'); }
      else recProg('정본 전사 결과가 없어 실시간 전사를 사용합니다');
      setTimeout(() => recProg(''), 3000);
    } catch (e) { recProg('정본 전사 실패 — 실시간 전사를 사용합니다 (' + e.message + ')'); setTimeout(() => recProg(''), 4000); }
    finally { REC.busy = false; }
  }
  /* Web Speech (webkitSpeechRecognition) — 실시간, 종료 시 자동 재시작 */
  function startSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('recHint').textContent = '⚠ 이 브라우저는 실시간 인식을 지원하지 않습니다(크롬/엣지 권장). 녹음 후 [Whisper 재전사]를 사용하세요.'; return; }
    const r = new SR(); REC.rec = r;
    r.lang = 'ko-KR'; r.continuous = true; r.interimResults = true;
    r.onresult = ev => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) REC.finalText += (REC.finalText && !/\s$/.test(REC.finalText) ? ' ' : '') + t.trim();
        else interim += t;
      }
      REC.interim = interim;
      const ta = $('recText'); if (ta) { ta.value = (REC.finalText + (interim ? ' ' + interim : '')).trim(); ta.scrollTop = ta.scrollHeight; }
      recSaveDraft();   // 백그라운드 폐기돼도 전사 텍스트는 살아남게 즉시 저장
    };
    r.onerror = () => {};
    r.onend = () => { if (REC.recActive) { try { r.start(); } catch (_) {} } };
    try { r.start(); } catch (_) {}
  }
  /* ── Whisper 전사 코어: 오디오 blob → 16kHz mono WAV 50초 청크 → 순차 전송 → 텍스트 ── */
  function recProg(msg) { const p = $('recProg'); if (p) { p.style.display = msg ? 'block' : 'none'; p.textContent = msg || ''; } }
  async function transcribeBlob(blob) {
    const buf = await blob.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const actx = new AC();
    const decoded = await actx.decodeAudioData(buf.slice(0));
    try { actx.close(); } catch (_) {}
    const mono16k = await resampleMono16k(decoded);   // Float32Array @16kHz
    const CHUNK_SEC = 50, SR = 16000, chunkLen = CHUNK_SEC * SR;
    const total = Math.ceil(mono16k.length / chunkLen);
    let out = '';
    for (let i = 0; i < total; i++) {
      recProg(`정본 전사 중… (${i + 1}/${total})`);
      const slice = mono16k.subarray(i * chunkLen, (i + 1) * chunkLen);
      const wav = encodeWav16(slice, SR);
      const b64 = bytesToB64(new Uint8Array(wav));
      const r = await fetch('/api/one-transcribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: b64, language: 'ko' }) });
      const d = await r.json();
      if (d && d.ok && d.text) out += (out ? ' ' : '') + d.text.trim();
      else if (d && d.error) throw new Error(d.error + (d.detail ? ': ' + d.detail : ''));
    }
    return out.trim();
  }
  async function recWhisper() {   // 수동 재전사 버튼 (메모리 blob 우선, 없으면 IndexedDB 복구)
    if (REC.busy) return;
    let blob = REC.blob;
    if (!blob) { recProg('저장된 오디오 불러오는 중…'); blob = await ridbAssemble(); if (blob) REC.blob = blob; }
    if (!blob) { alert('전사할 오디오가 없습니다. 먼저 녹음하세요.'); recProg(''); return; }
    REC.busy = true; recProg('오디오 디코딩 중…');
    try {
      const out = await transcribeBlob(blob);
      REC.finalText = out; $('recText').value = out; recSaveDraft();
      recProg(out ? '✅ 정본 전사 완료' : '⚠ 인식된 내용이 없습니다');
      setTimeout(() => recProg(''), 2500);
    } catch (e) {
      recProg('⚠ 전사 실패: ' + e.message); setTimeout(() => recProg(''), 4000);
    } finally { REC.busy = false; }
  }
  /* 앱 전환·탭 폐기로 끊긴 녹음의 오디오를 IndexedDB 에서 복구해 정본 전사 */
  async function recRecoverAudio() {
    if (REC.busy) return;
    recProg('이전 녹음 오디오 불러오는 중…');
    const blob = await ridbAssemble();
    if (!blob) { recProg('복구할 오디오가 없습니다'); setTimeout(() => recProg(''), 2500); return; }
    REC.blob = blob;
    const url = URL.createObjectURL(blob);
    const au = $('recAudio'); if (au) { au.src = url; au.style.display = 'block'; }
    const dl = $('recDownload'); if (dl) { dl.href = url; dl.download = 'meeting-' + today() + '.webm'; }
    $('recActions').style.display = 'flex';
    REC.busy = true; recProg('🎯 복구 오디오 정본 전사 중(Whisper)…');
    try {
      const out = await transcribeBlob(blob);
      if (out) { REC.finalText = out; $('recText').value = out; recSaveDraft(); }
      recProg(out ? '✅ 복구 전사 완료' : '⚠ 인식 결과가 없습니다(오디오 손상 가능)');
      setTimeout(() => recProg(''), 3000);
    } catch (e) { recProg('⚠ 복구 전사 실패: ' + e.message + ' — 저장된 실시간 전사를 사용하세요'); setTimeout(() => recProg(''), 5000); }
    finally { REC.busy = false; }
  }
  // AudioBuffer → 16kHz mono Float32 (OfflineAudioContext 리샘플)
  async function resampleMono16k(ab) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const dur = ab.duration, outLen = Math.ceil(dur * 16000);
    const oac = new OAC(1, outLen, 16000);
    const src = oac.createBufferSource(); src.buffer = ab; src.connect(oac.destination); src.start(0);
    const rendered = await oac.startRendering();
    return rendered.getChannelData(0);
  }
  // Float32 PCM → 16-bit WAV (ArrayBuffer)
  function encodeWav16(samples, sampleRate) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44; for (let i = 0; i < n; i++) { let s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2; }
    return buf;
  }
  // Uint8Array → base64 (스택오버플로 방지 청크 처리)
  function bytesToB64(bytes) {
    let bin = '', CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  /* ── 결과 삽입 ── */
  function recInsertText() {
    const t = ($('recText').value || '').trim(); if (!t) { alert('전사 내용이 없습니다.'); return; }
    const html = '<h3>🎙 회의 전사 (' + today() + ')</h3><p>' + esc(t).replace(/\n+/g, '</p><p>') + '</p><p><br></p>';
    insertToPage(html); recClearDraft(); ridbClear(); closeRecPanel();
  }
  async function recMinutes() {
    if (REC.busy) return;
    const t = ($('recText').value || '').trim();
    if (t.length < 10) { alert('전사 내용이 너무 짧습니다.'); return; }
    REC.busy = true; recProg('Claude 가 회의록을 정리하는 중…');
    try {
      const title = ((findNode(curPageId) || {}).title) || '';
      const r = await fetch('/api/one-meeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: t, title }) });
      const d = await r.json();
      if (d && d.ok && d.html) {
        insertToPage(d.html + '<p><br></p><details><summary>🎙 원본 전사</summary><p>' + esc(t).replace(/\n+/g, '</p><p>') + '</p></details><p><br></p>');
        recClearDraft(); ridbClear();
        recProg('✅ 회의록 삽입 완료'); setTimeout(closeRecPanel, 800);
      } else { throw new Error((d && (d.detail || d.error)) || '알 수 없는 오류'); }
    } catch (e) { recProg('⚠ 회의록 정리 실패: ' + e.message); setTimeout(() => recProg(''), 4000); }
    finally { REC.busy = false; }
  }
  function insertToPage(html) {
    const el = $('docBody'); if (!el) return;
    el.focus();
    // 커서가 본문 안이 아니면 끝에 삽입
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
    }
    document.execCommand('insertHTML', false, html);
    afterEdit();
  }

  /* ── 부트 ── */
  function paintStaticIcons() {
    // 정적 버튼 아이콘 주입 [id, icon, label?]
    const map = [
      ['tbBold', 'bold'], ['tbH1', 'h1'], ['tbH2', 'h2'], ['tbList', 'list'], ['tbOList', 'olist'], ['tbQuote', 'quote'],
      ['tbTable', 'table', '표'], ['tbAttach', 'clip', '첨부'],
      ['tbFontColorBtn', 'fontcolor'], ['tbCellColorBtn', 'bucket'], ['tbCellColorClear', 'bucketOff'],
      ['tbRowAbove', 'rowAbove'], ['tbRowBelow', 'rowBelow'], ['tbColLeft', 'colLeft'], ['tbColRight', 'colRight'], ['tbDelRow', 'rowDel'], ['tbDelCol', 'colDel'],
      ['tbMerge', 'merge', '병합'], ['tbSplit', 'split', '분할'],
      ['tbAlL', 'alignL'], ['tbAlC', 'alignC'], ['tbAlR', 'alignR'], ['tbVaT', 'valT'], ['tbVaM', 'valM'], ['tbVaB', 'valB'],
      ['tbHeadRow', 'header'], ['tbDelTable', 'trash'],
      ['navToggle', 'panel', , 18], ['themeBtn', 'theme', , 18], ['addSec', 'plus', , 17], ['newPageFab', 'plus', , 26],
    ];
    map.forEach(([id, name, label, size]) => { const el = $(id); if (el) el.innerHTML = ic(name, size || 18) + (label ? ` <span class="tlabel">${label}</span>` : ''); });
    const s = document.querySelector('.search span'); if (s) s.innerHTML = ic('search', 15);
    const chev = document.querySelector('#nbSwitch .chev'); if (chev) chev.innerHTML = ic('chevD', 13);
  }
  async function boot() {
    if (!enforceGate()) return;
    paintStaticIcons();
    $('addSec').onclick = () => addNode(null);
    $('newPageFab').onclick = () => addPage(null);
    $('navToggle').onclick = () => $('mainGrid').classList.toggle('nav-collapsed');
    $('nbSwitch').onclick = toggleNbMenu;
    $('themeBtn').onclick = () => { const cur = document.documentElement.getAttribute('data-theme'); const isDark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark'); try { localStorage.setItem('one_theme', isDark ? 'light' : 'dark'); } catch (_) {} };
    $('tbBold').onclick = () => exec('bold'); $('tbH1').onclick = () => exec('formatBlock', 'H1'); $('tbH2').onclick = () => exec('formatBlock', 'H2');
    $('tbList').onclick = () => exec('insertUnorderedList'); $('tbOList').onclick = () => exec('insertOrderedList'); $('tbQuote').onclick = () => exec('formatBlock', 'BLOCKQUOTE');
    $('tbTable').onclick = insertTable; $('tbAttach').onclick = attachFile;
    { const rb = $('tbRec'); if (rb) rb.onclick = openRecPanel; }
    $('tbRowAbove').onclick = () => addRow(false); $('tbRowBelow').onclick = () => addRow(true);
    $('tbColLeft').onclick = () => addCol(false); $('tbColRight').onclick = () => addCol(true);
    $('tbDelRow').onclick = delRow; $('tbDelCol').onclick = delCol; $('tbHeadRow').onclick = toggleHeadRow; $('tbDelTable').onclick = () => delTable(false);
    $('tbMerge').onclick = mergeSelection; $('tbSplit').onclick = splitCell;
    $('tbAlL').onclick = () => alignCells('textAlign', 'left'); $('tbAlC').onclick = () => alignCells('textAlign', 'center'); $('tbAlR').onclick = () => alignCells('textAlign', 'right');
    $('tbVaT').onclick = () => alignCells('verticalAlign', 'top'); $('tbVaM').onclick = () => alignCells('verticalAlign', 'middle'); $('tbVaB').onclick = () => alignCells('verticalAlign', 'bottom');
    // 색상
    $('tbFontColorBtn').onclick = () => $('tbFontColor').click();
    $('tbFontColor').oninput = (e) => applyFontColor(e.target.value);
    $('tbCellColorBtn').onclick = () => $('tbCellColor').click();
    $('tbCellColor').oninput = (e) => applyCellColor(e.target.value);
    $('tbCellColorClear').onclick = clearCellColor;
    document.addEventListener('selectionchange', updateTableTools);
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', onDocMouseUp);
    bindNav();
    const t = (function () { try { return localStorage.getItem('one_theme'); } catch (_) { return null; } })(); if (t) document.documentElement.setAttribute('data-theme', t);
    await loadTree(); curNb = DATA.notebooks[0].id; selectFirst(); setSaveInd('saved');
    setInterval(async () => { if (document.querySelector('.ov') || document.querySelector('.nb-menu')) return; const before = treeEtag; await loadTree(); if (treeEtag !== before) { renderRail(); renderNav(); } }, 20000);
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
