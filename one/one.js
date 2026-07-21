/* ══════════════════════════════════════════════════════════════
   ONE — 개인 노트 앱 (필기장 › 섹션/그룹(무한 중첩) › 페이지/하위페이지)
   저장: /api/one (KV). 접근: zoolex@gmail.com 전용 게이트.
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

  /* ── 인증 게이트 ── */
  function authEmail() {
    try { const a = JSON.parse(localStorage.getItem('ns_auth') || 'null'); if (a && a.loggedIn) return String(a.id || a.email || '').toLowerCase(); } catch (_) {}
    return '';
  }
  function enforceGate() {
    const em = authEmail();
    if (em === OWNER) return true;
    const g = document.createElement('div');
    g.className = 'gate';
    g.innerHTML = em
      ? `<div class="g-logo">◲</div><h1>소유자 전용</h1><p>이 노트(<b>ONE</b>)는 소유자만 볼 수 있습니다.<br>현재 계정(${esc(em)})은 접근 권한이 없습니다.</p><a class="g-btn" href="/?desktop=1">메인으로</a>`
      : `<div class="g-logo">◲</div><h1>ONE — 로그인 필요</h1><p>work.neoretail.net 에 먼저 로그인하면<br>이 노트를 사용할 수 있습니다.</p><a class="g-btn" href="/?desktop=1">로그인하러 가기</a>`;
    document.body.appendChild(g);
    return false;
  }

  /* ── 상태 ── */
  let DATA = { notebooks: [] };        // { notebooks:[{id,name,color,ico,nodes:[node]}] }
  let curNb = null, curSecId = null, curPageId = null;
  const bodyCache = {};                // { pageId: { id, html, attachments:[] } }
  let treeEtag = '';

  /* ── 동기화 ── */
  let _treeT = null, _pageT = {};
  async function loadTree() {
    try {
      const r = await fetch('/api/one', { headers: treeEtag ? { 'If-None-Match': treeEtag } : {} });
      if (r.status === 304) return;
      const et = r.headers.get('ETag'); if (et) treeEtag = et;
      const d = await r.json();
      if (d && d.tree && d.tree.notebooks && d.tree.notebooks.length) DATA = d.tree;
      else seedDefault();
    } catch (_) { if (!DATA.notebooks.length) seedDefault(); }
  }
  function saveTree(now) {
    clearTimeout(_treeT);
    const doIt = async () => {
      try { const r = await fetch('/api/one', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tree: DATA }) });
        const j = await r.json(); if (j && j.updatedAt) treeEtag = '"' + j.updatedAt + '"'; } catch (_) {}
    };
    if (now) return doIt();
    _treeT = setTimeout(doIt, 900);
  }
  async function loadPage(id) {
    if (bodyCache[id]) return bodyCache[id];
    try { const r = await fetch('/api/one?page=' + encodeURIComponent(id)); const d = await r.json();
      bodyCache[id] = (d && d.page) || { id, html: '', attachments: [] }; }
    catch (_) { bodyCache[id] = { id, html: '', attachments: [] }; }
    if (!bodyCache[id].attachments) bodyCache[id].attachments = [];
    return bodyCache[id];
  }
  function savePage(id, now) {
    clearTimeout(_pageT[id]);
    setSaveInd('saving');
    const doIt = async () => {
      const p = bodyCache[id]; if (!p) return;
      try { await fetch('/api/one', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: { id, html: p.html, attachments: p.attachments } }) }); setSaveInd('saved'); }
      catch (_) { setSaveInd('err'); }
    };
    if (now) return doIt();
    _pageT[id] = setTimeout(doIt, 1000);
  }
  function setSaveInd(s) {
    const el = $('saveInd'); if (!el) return;
    el.className = 'save-ind' + (s === 'saving' ? ' saving' : '');
    el.textContent = s === 'saving' ? '저장 중…' : s === 'err' ? '⚠ 저장 실패' : '✓ 저장됨';
  }

  function seedDefault() {
    const secId = uid('s');
    const pgId = uid('p');
    DATA = { notebooks: [{
      id: uid('nb'), name: '내 노트', color: NB_COLORS[0], ico: '📘',
      nodes: [{ id: secId, type: 'section', name: '첫 섹션', color: SEC_COLORS[0], open: true,
        pages: [{ id: pgId, title: '환영합니다 👋', updated: today(), tags: [], sub: [], open: true }] }],
    }] };
    bodyCache[pgId] = { id: pgId, attachments: [], html:
      '<h2>ONE 에 오신 걸 환영합니다</h2><p>왼쪽에서 <b>필기장 · 섹션 · 페이지</b>를 만들고, 여기에 자유롭게 적으세요.</p>'
      + '<ul><li>이미지·엑셀 표를 <b>붙여넣기(Ctrl+V)</b> 하면 본문에 들어갑니다</li><li>상단 <b>⊞</b> 로 표를 만들고, <b>📎</b> 로 파일을 첨부합니다</li><li>그룹 안에 그룹을 넣어 원하는 만큼 깊게 정리할 수 있어요</li></ul>' };
    saveTree(true);
  }
  function today() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function nb() { return DATA.notebooks.find(n => n.id === curNb) || DATA.notebooks[0]; }

  /* ── 트리 탐색 헬퍼 ── */
  function walkNodes(nodes, fn, parent) { for (const n of nodes) { fn(n, parent, nodes); if (n.children) walkNodes(n.children, fn, n); } }
  function findNode(id) { let r = null; walkNodes(nb().nodes, n => { if (n.id === id) r = n; }); return r; }
  function findNodeParentList(id) { let r = null; walkNodes(nb().nodes, (n, p, list) => { if (n.id === id) r = list; }); return r; }
  function firstSection(nodes) { for (const n of nodes) { if (n.type === 'section') return n; if (n.children) { const f = firstSection(n.children); if (f) return f; } } return null; }
  function findPage(pages, id) { for (const p of pages) { if (p.id === id) return p; if (p.sub) { const f = findPage(p.sub, id); if (f) return f; } } return null; }
  function findPageParent(pages, id) { for (const p of pages) { if (p.sub) { if (p.sub.some(x => x.id === id)) return p.sub; const r = findPageParent(p.sub, id); if (r) return r; } if (pages.some(x => x.id === id)) return pages; } return pages.some(x => x.id === id) ? pages : null; }
  function pathToSection(nodes, secId, trail) { for (const n of nodes) { if (n.type === 'section') { if (n.id === secId) return [...trail, n]; } else { const r = pathToSection(n.children, secId, [...trail, n]); if (r) return r; } } return null; }
  function countPages(pages) { let c = 0; const w = a => a.forEach(p => { c++; if (p.sub) w(p.sub); }); w(pages || []); return c; }

  /* ── 렌더: 필기장 rail ── */
  function renderRail() {
    const r = $('rail');
    r.innerHTML = DATA.notebooks.map(n => `<div class="nb-ico ${n.id === curNb ? 'on' : ''}" style="background:${n.color}" title="${esc(n.name)}" data-nb="${n.id}">${n.ico || '📘'}</div>`).join('')
      + `<div class="spring"></div><button class="add" id="addNbBtn" title="새 필기장">＋</button>`;
    r.querySelectorAll('[data-nb]').forEach(el => {
      el.onclick = () => { curNb = el.dataset.nb; curSecId = null; curPageId = null; selectFirst(); };
      el.ondblclick = () => editNotebook(el.dataset.nb);
    });
    $('addNbBtn').onclick = () => editNotebook(null);
    const cur = nb();
    $('nbName').textContent = cur ? cur.name : 'ONE';
    if (cur) document.querySelector('#nbSwitch .dot').style.background = cur.color;
  }

  /* ── 렌더: 섹션 트리(재귀) ── */
  function renderTree() {
    const host = $('tree');
    host.innerHTML = nb().nodes.map(n => nodeHtml(n, 0)).join('') || '<div class="empty-hint">＋ 로 섹션을 추가하세요</div>';
    host.querySelectorAll('.row').forEach(row => {
      const id = row.dataset.node;
      row.onclick = (e) => {
        if (e.target.closest('.rowacts')) return;
        const node = findNode(id);
        if (node.type === 'group') { node.open = !node.open; saveTree(); renderTree(); }
        else { curSecId = id; const s = findNode(id); curPageId = (s.pages && s.pages[0] && s.pages[0].id) || null; renderTree(); renderPages(); openCanvas(); }
      };
    });
  }
  function nodeHtml(n, depth) {
    const pad = 6 + depth * 14;
    const isSec = n.type === 'section';
    const sel = isSec && curSecId === n.id;
    const hasKids = !isSec && n.children && n.children.length;
    const chev = isSec ? `<span class="chev leaf"></span>` : `<span class="chev ${n.open ? 'open' : ''}">▶</span>`;
    const badge = isSec ? `<span class="sdot" style="background:${n.color}"></span>` : `<span class="gico">${n.open ? '📂' : '📁'}</span>`;
    const cnt = isSec ? `<span class="count">${countPages(n.pages)}</span>` : '';
    const acts = `<span class="rowacts">${isSec ? '' : `<button data-act="addin" title="안에 추가">＋</button>`}<button data-act="rename" title="이름변경">✎</button><button class="del" data-act="del" title="삭제">✕</button></span>`;
    let html = `<div class="node"><div class="row ${sel ? 'sel' : ''}" data-node="${n.id}" style="padding-left:${pad}px">${chev}${badge}<span class="label">${esc(n.name)}</span>${cnt}${acts}</div>`;
    if (!isSec && n.open && hasKids) html += `<div class="children">${n.children.map(c => nodeHtml(c, depth + 1)).join('')}</div>`;
    return html + `</div>`;
  }

  /* ── 렌더: 페이지 목록 ── */
  function renderPages() {
    const host = $('plist');
    const sec = curSecId ? findNode(curSecId) : null;
    $('pagesHead').textContent = sec ? sec.name : '페이지';
    if (!sec) { host.innerHTML = '<div class="empty-hint">섹션을 선택하세요</div>'; return; }
    host.innerHTML = (sec.pages || []).map(p => pageHtml(p, 0)).join('') || '<div class="empty-hint">＋ 로 페이지를 추가하세요</div>';
    host.querySelectorAll('.page').forEach(el => {
      const id = el.dataset.page;
      el.onclick = (e) => {
        if (e.target.classList.contains('pchev')) { const pg = findPage(sec.pages, id); pg.open = !pg.open; saveTree(); renderPages(); return; }
        if (e.target.closest('.pacts')) return;
        curPageId = id; renderPages(); openCanvas();
      };
    });
  }
  function pageHtml(p, depth) {
    const sel = curPageId === p.id;
    const cls = depth === 0 ? '' : ('sub' + (depth >= 3 ? 3 : depth));
    const hasSub = p.sub && p.sub.length;
    const chev = hasSub ? `<span class="pchev">${p.open ? '▾' : '▸'}</span>` : `<span class="pchev" style="visibility:hidden">▾</span>`;
    const meta = [p.updated, (p.tags && p.tags.length) ? p.tags.map(t => '#' + t).join(' ') : ''].filter(Boolean).join(' · ');
    const acts = `<span class="pacts"><button data-pact="addsub" title="하위페이지">＋</button><button class="del" data-pact="del" title="삭제">✕</button></span>`;
    let html = `<div class="page ${cls} ${sel ? 'sel' : ''}" data-page="${p.id}">${chev}<div class="pbody"><div class="p-title">${esc(p.title || '제목 없음')}</div><div class="p-meta">${esc(meta)}</div></div>${acts}</div>`;
    if (hasSub && p.open) html += p.sub.map(s => pageHtml(s, depth + 1)).join('');
    return html;
  }

  /* ── 렌더: 캔버스 ── */
  async function openCanvas() {
    const cv = $('canvasArea'), crumb = $('crumb'), tb = $('toolbar');
    const sec = curSecId ? findNode(curSecId) : null;
    const page = sec && curPageId ? findPage(sec.pages, curPageId) : null;
    // crumb
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
      <div class="atts" id="atts"></div>
    </div>`;
    const bodyEl = $('docBody');
    bodyEl.innerHTML = sanitizeRich(body.html || '');
    // title edit
    const titleEl = $('docTitle');
    titleEl.oninput = () => { page.title = titleEl.textContent.trim(); page.updated = today(); renderPages(); saveTree(); const cseg = $('crumb').querySelector('.seg.cur'); if (cseg) cseg.textContent = page.title || '제목 없음'; };
    titleEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); bodyEl.focus(); } };
    // body edit
    bodyEl.oninput = () => { body.html = bodyEl.innerHTML; page.updated = today(); savePage(page.id); scheduleTouchTree(page); };
    bodyEl.onpaste = onPaste;
    renderAtts();
  }
  let _touchT = null;
  function scheduleTouchTree() { clearTimeout(_touchT); _touchT = setTimeout(() => saveTree(), 1500); }

  function renderAtts() {
    const box = $('atts'); if (!box) return;
    const body = bodyCache[curPageId]; const atts = (body && body.attachments) || [];
    if (!atts.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="atts-h">📎 첨부 (${atts.length})</div>` + atts.map((a, i) => {
      const isImg = /^image\//.test(a.type || '') && a.dataUrl;
      const thumb = isImg ? `<img class="thumb" src="${a.dataUrl}" data-open="${i}">` : '📄';
      return `<span class="att">${thumb}<span class="an" data-open="${i}">${esc(a.name)}</span><span class="as">${fsize(a.size)}</span><span class="ax" data-del="${i}">✕</span></span>`;
    }).join('');
    box.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openAtt(Number(el.dataset.open)));
    box.querySelectorAll('[data-del]').forEach(el => el.onclick = () => { atts.splice(Number(el.dataset.del), 1); savePage(curPageId); renderAtts(); });
  }

  /* ── 리치 에디터: 정제 + 붙여넣기(이미지 압축/표 재구성) ── */
  function sanitizeRich(html) {
    const src = String(html || ''); if (!src) return '';
    const idoc = document.implementation.createHTMLDocument('x'); idoc.body.innerHTML = src;
    const ALLOW = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, P: 1, DIV: 1, SPAN: 1, BR: 1, H1: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, A: 1, BLOCKQUOTE: 1, CODE: 1, PRE: 1 };
    const walk = (node) => {
      let out = '';
      node.childNodes.forEach(ch => {
        if (ch.nodeType === 3) { out += esc(ch.nodeValue); return; }
        if (ch.nodeType !== 1) return;
        const tag = ch.tagName;
        if (tag === 'BR') { out += '<br>'; return; }
        if (tag === 'IMG') { const s = ch.getAttribute('src') || ''; if (/^data:image\//i.test(s)) out += `<img src="${s}">`; return; }
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT') return;
        if (!ALLOW[tag]) { out += walk(ch); return; }
        let attrs = '';
        if (tag === 'A') { const h = ch.getAttribute('href') || ''; if (/^https?:|^mailto:/i.test(h)) attrs += ` href="${esc(h)}" target="_blank" rel="noopener"`; }
        if (tag === 'TD' || tag === 'TH') { const cs = parseInt(ch.getAttribute('colspan')) || 0, rs = parseInt(ch.getAttribute('rowspan')) || 0; if (cs > 1) attrs += ` colspan="${cs}"`; if (rs > 1) attrs += ` rowspan="${rs}"`; }
        if (tag === 'TABLE') attrs = ' class="one-rt"';
        const t = tag.toLowerCase();
        out += `<${t}${attrs}>${walk(ch)}</${t}>`;
      });
      return out;
    };
    return walk(idoc.body);
  }
  function compressImage(file, cb) {
    const fr = new FileReader();
    fr.onload = e => { const img = new Image(); img.onload = () => { try {
      const MAXW = 1400; let w = img.width, h = img.height; if (w > MAXW) { h = Math.round(h * MAXW / w); w = MAXW; }
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.85));
    } catch (_) { cb(e.target.result); } }; img.onerror = () => cb(null); img.src = e.target.result; };
    fr.readAsDataURL(file);
  }
  function rebuildTable(html) {
    const idoc = document.implementation.createHTMLDocument('x'); idoc.body.innerHTML = String(html || '');
    const tbl = idoc.body.querySelector('table'); if (!tbl) return null;
    let out = '<table class="one-rt">';
    tbl.querySelectorAll('tr').forEach(tr => { out += '<tr>'; tr.querySelectorAll('td,th').forEach(cell => {
      const t = cell.tagName === 'TH' ? 'th' : 'td';
      const cs = parseInt(cell.getAttribute('colspan')) || 0, rs = parseInt(cell.getAttribute('rowspan')) || 0;
      const txt = esc(String(cell.textContent || '').replace(/\s+/g, ' ').trim());
      out += `<${t}${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${txt || '<br>'}</${t}>`;
    }); out += '</tr>'; });
    return out + '</table>';
  }
  function onPaste(ev) {
    const cd = ev.clipboardData; if (!cd) return;
    const imgIt = [...(cd.items || [])].find(it => it.kind === 'file' && /^image\//.test(it.type));
    if (imgIt) { ev.preventDefault(); const f = imgIt.getAsFile(); if (f) compressImage(f, du => { if (du) document.execCommand('insertHTML', false, `<img src="${du}"><br>`); }); return; }
    const html = cd.getData('text/html');
    if (html && /<table/i.test(html)) { ev.preventDefault(); const t = rebuildTable(html); if (t) document.execCommand('insertHTML', false, t + '<br>'); return; }
    ev.preventDefault(); const text = cd.getData('text/plain'); if (text) document.execCommand('insertText', false, text);
  }

  /* ── 툴바 동작 ── */
  function exec(cmd, val) { $('docBody').focus(); document.execCommand(cmd, false, val || null); afterEdit(); }
  function afterEdit() { const b = bodyCache[curPageId], el = $('docBody'); if (b && el) { b.html = el.innerHTML; savePage(curPageId); } }
  function insertTable() {
    const spec = prompt('표 크기 (행x열)', '3x3'); if (!spec) return;
    const m = spec.match(/(\d+)\s*[xX×*]\s*(\d+)/); if (!m) { alert('예: 3x3'); return; }
    const R = Math.min(40, +m[1] || 3), C = Math.min(16, +m[2] || 3);
    let t = '<table class="one-rt">'; for (let r = 0; r < R; r++) { t += '<tr>'; for (let c = 0; c < C; c++) t += '<td><br></td>'; t += '</tr>'; } t += '</table><p><br></p>';
    $('docBody').focus(); document.execCommand('insertHTML', false, t); afterEdit();
  }
  function attachFile() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.onchange = () => {
      const body = bodyCache[curPageId]; if (!body) return; body.attachments = body.attachments || [];
      [...inp.files].forEach(f => {
        if (f.size > 5 * 1024 * 1024) { alert('⚠ ' + f.name + ' — 5MB 초과, 첨부 안 됨'); return; }
        const r = new FileReader();
        r.onload = e => { body.attachments.push({ name: f.name, type: f.type, size: f.size, dataUrl: e.target.result }); savePage(curPageId); renderAtts(); };
        r.readAsDataURL(f);
      });
    };
    inp.click();
  }
  function openAtt(i) {
    const a = (bodyCache[curPageId].attachments || [])[i]; if (!a || !a.dataUrl) return;
    if (/^image\//.test(a.type || '')) { const lb = document.createElement('div'); lb.className = 'lb'; lb.innerHTML = `<button class="x">✕ 닫기</button><img src="${a.dataUrl}">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); return; }
    try { const c = a.dataUrl.indexOf(','); const mime = (a.dataUrl.slice(0, c).match(/data:([^;]+)/) || [])[1] || a.type || 'application/octet-stream';
      const bin = atob(a.dataUrl.slice(c + 1)); const arr = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      const url = URL.createObjectURL(new Blob([arr], { type: mime })); const w = window.open(url, '_blank');
      if (!w) { const el = document.createElement('a'); el.href = url; el.download = a.name; el.click(); } setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (_) { alert('열기 실패'); }
  }
  function fsize(n) { n = Number(n) || 0; return n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(0) + 'KB' : (n / 1048576).toFixed(1) + 'MB'; }

  /* ── CRUD: 필기장 ── */
  function editNotebook(id) {
    const existing = id ? DATA.notebooks.find(n => n.id === id) : null;
    dialog(existing ? '필기장 편집' : '새 필기장', [
      { key: 'name', label: '이름', value: existing ? existing.name : '' },
      { key: 'ico', label: '아이콘', type: 'icons', value: existing ? existing.ico : NB_ICONS[0] },
      { key: 'color', label: '색상', type: 'color', colors: NB_COLORS, value: existing ? existing.color : NB_COLORS[0] },
    ], (v) => {
      if (!v.name.trim()) return;
      if (existing) { existing.name = v.name.trim(); existing.ico = v.ico; existing.color = v.color; }
      else { const n = { id: uid('nb'), name: v.name.trim(), color: v.color, ico: v.ico, nodes: [] }; DATA.notebooks.push(n); curNb = n.id; curSecId = null; curPageId = null; }
      saveTree(); selectFirst();
    }, existing ? () => { if (DATA.notebooks.length <= 1) { alert('필기장이 하나뿐입니다.'); return; } if (!confirm('필기장 삭제? (안의 섹션·페이지 모두 목록에서 사라집니다)')) return; DATA.notebooks = DATA.notebooks.filter(n => n.id !== id); curNb = DATA.notebooks[0].id; curSecId = null; saveTree(); selectFirst(); } : null);
  }

  /* ── CRUD: 섹션/그룹 ── */
  function addNode(parentGroupId) {
    dialog('새로 만들기', [
      { key: 'type', label: '종류', type: 'select', options: [['section', '● 섹션 (페이지를 담음)'], ['group', '📁 그룹 (섹션·그룹을 담음)']], value: 'section' },
      { key: 'name', label: '이름', value: '' },
      { key: 'color', label: '색상 (섹션)', type: 'color', colors: SEC_COLORS, value: SEC_COLORS[0] },
    ], (v) => {
      if (!v.name.trim()) return;
      const node = v.type === 'group'
        ? { id: uid('g'), type: 'group', name: v.name.trim(), open: true, children: [] }
        : { id: uid('s'), type: 'section', name: v.name.trim(), color: v.color, open: true, pages: [] };
      const list = parentGroupId ? (findNode(parentGroupId).children) : nb().nodes;
      if (parentGroupId) findNode(parentGroupId).open = true;
      list.push(node);
      if (node.type === 'section') { curSecId = node.id; curPageId = null; }
      saveTree(); renderTree(); renderPages(); openCanvas();
    });
  }
  function renameNode(id) {
    const n = findNode(id);
    dialog('이름 변경', [{ key: 'name', label: '이름', value: n.name }].concat(n.type === 'section' ? [{ key: 'color', label: '색상', type: 'color', colors: SEC_COLORS, value: n.color }] : []),
      (v) => { if (!v.name.trim()) return; n.name = v.name.trim(); if (v.color) n.color = v.color; saveTree(); renderTree(); openCanvas(); });
  }
  function deleteNode(id) {
    const n = findNode(id);
    const kind = n.type === 'group' ? '그룹(안의 모든 것 포함)' : '섹션(안의 페이지 포함)';
    if (!confirm(`"${n.name}" ${kind}을(를) 삭제할까요?`)) return;
    const list = findNodeParentList(id); const i = list.indexOf(n); if (i >= 0) list.splice(i, 1);
    if (curSecId === id) { curSecId = null; curPageId = null; }
    saveTree(); selectFirst();
  }

  /* ── CRUD: 페이지 ── */
  function addPage(parentPageId) {
    const sec = findNode(curSecId); if (!sec) { alert('먼저 섹션을 선택하세요'); return; }
    const p = { id: uid('p'), title: '', updated: today(), tags: [], sub: [], open: true };
    bodyCache[p.id] = { id: p.id, html: '', attachments: [] };
    if (parentPageId) { const par = findPage(sec.pages, parentPageId); par.open = true; par.sub = par.sub || []; par.sub.push(p); }
    else sec.pages.push(p);
    curPageId = p.id; saveTree(); renderPages(); openCanvas();
    setTimeout(() => { const t = $('docTitle'); if (t) t.focus(); }, 30);
  }
  function deletePage(id) {
    const sec = findNode(curSecId); const p = findPage(sec.pages, id);
    if (!confirm(`"${p.title || '제목 없음'}" 페이지를 삭제할까요?${(p.sub && p.sub.length) ? ' (하위 페이지 포함)' : ''}`)) return;
    const list = findPageParent(sec.pages, id) || sec.pages; const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1);
    // 본문 삭제(재귀)
    const rmBodies = (pg) => { fetch('/api/one', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deletePage: pg.id }) }).catch(() => {}); (pg.sub || []).forEach(rmBodies); };
    rmBodies(p);
    if (curPageId === id) curPageId = (sec.pages[0] && sec.pages[0].id) || null;
    saveTree(); renderPages(); openCanvas();
  }

  /* ── 이벤트 위임: 트리/페이지 액션 버튼 ── */
  function bindActions() {
    $('tree').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation();
      const id = b.closest('.row').dataset.node;
      if (b.dataset.act === 'addin') addNode(id);
      else if (b.dataset.act === 'rename') renameNode(id);
      else if (b.dataset.act === 'del') deleteNode(id);
    });
    $('plist').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pact]'); if (!b) return; e.stopPropagation();
      const id = b.closest('.page').dataset.page;
      if (b.dataset.pact === 'addsub') addPage(id);
      else if (b.dataset.pact === 'del') deletePage(id);
    });
  }

  /* ── 모달 dialog ── */
  function dialog(title, fields, onOk, onDelete) {
    const ov = document.createElement('div'); ov.className = 'ov';
    const state = {}; fields.forEach(f => state[f.key] = f.value);
    const fieldHtml = fields.map(f => {
      if (f.type === 'select') return `<div class="fld"><label>${f.label}</label><select data-k="${f.key}">${f.options.map(([v, l]) => `<option value="${v}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
      if (f.type === 'color') return `<div class="fld"><label>${f.label}</label><div class="color-pick" data-k="${f.key}">${f.colors.map(c => `<span class="c ${c === f.value ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div></div>`;
      if (f.type === 'icons') return `<div class="fld"><label>${f.label}</label><div class="color-pick" data-k="${f.key}">${NB_ICONS.map(ic => `<span class="c ${ic === f.value ? 'on' : ''}" data-c="${ic}" style="background:var(--chrome2);display:grid;place-items:center;font-size:15px">${ic}</span>`).join('')}</div></div>`;
      return `<div class="fld"><label>${f.label}</label><input data-k="${f.key}" value="${esc(f.value || '')}" ${f.key === 'name' ? 'autofocus' : ''}></div>`;
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
    const nameInp = ov.querySelector('[data-k="name"]'); if (nameInp) { nameInp.focus(); nameInp.onkeydown = (e) => { if (e.key === 'Enter') { close(); onOk(state); } }; }
  }

  function selectFirst() {
    if (!curNb && DATA.notebooks[0]) curNb = DATA.notebooks[0].id;
    const sec = curSecId ? findNode(curSecId) : firstSection(nb().nodes);
    curSecId = sec ? sec.id : null;
    if (sec && !curPageId) curPageId = (sec.pages[0] && sec.pages[0].id) || null;
    renderRail(); renderTree(); renderPages(); openCanvas();
  }

  /* ── 부트 ── */
  async function boot() {
    if (!enforceGate()) return;
    // top bar
    $('addSec').onclick = () => addNode(null);
    $('addPage').onclick = () => addPage(null);
    $('newPageFab').onclick = () => addPage(null);
    $('themeBtn').onclick = () => { const cur = document.documentElement.getAttribute('data-theme'); const isDark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches; document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark'); try { localStorage.setItem('one_theme', isDark ? 'light' : 'dark'); } catch (_) {} };
    $('tbBold').onclick = () => exec('bold');
    $('tbH1').onclick = () => exec('formatBlock', 'H1');
    $('tbH2').onclick = () => exec('formatBlock', 'H2');
    $('tbList').onclick = () => exec('insertUnorderedList');
    $('tbOList').onclick = () => exec('insertOrderedList');
    $('tbQuote').onclick = () => exec('formatBlock', 'BLOCKQUOTE');
    $('tbTable').onclick = insertTable;
    $('tbAttach').onclick = attachFile;
    bindActions();
    const t = (function () { try { return localStorage.getItem('one_theme'); } catch (_) { return null; } })();
    if (t) document.documentElement.setAttribute('data-theme', t);
    await loadTree();
    curNb = DATA.notebooks[0].id;
    selectFirst();
    setSaveInd('saved');
    // 주기 동기화(다른 기기 반영) — 편집 중 아니면 트리 새로고침
    setInterval(async () => { if (document.querySelector('.ov')) return; const before = treeEtag; await loadTree(); if (treeEtag !== before) { renderRail(); renderTree(); renderPages(); } }, 20000);
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
