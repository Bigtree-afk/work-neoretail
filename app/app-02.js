  /* ══════════════════════════════════
     Claude Sonnet API 연동
  ══════════════════════════════════ */

  const CLAUDE_MODEL = 'claude-sonnet-4-5';

  function getApiKey() {
    // 구버전 키('anthropic_api_key')가 있으면 자동 마이그레이션 → 'neo_api_key'
    const v = localStorage.getItem('neo_api_key') || localStorage.getItem('anthropic_api_key') || '';
    if (v && !localStorage.getItem('neo_api_key')) {
      localStorage.setItem('neo_api_key', v);
      try { localStorage.removeItem('anthropic_api_key'); } catch(e){}
    }
    return v;
  }
  function saveApiKey(key) { localStorage.setItem('neo_api_key', String(key||'').trim()); }

  async function callClaude(messages, maxTokens = 1500) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('API_KEY_MISSING');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, messages })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API 오류 (${res.status})`);
    }
    const data = await res.json();
    return data.content[0].text;
  }

  /* ── 설정 모달 ── */
  function toggleApiKeyVisibility() {
    const inp = document.getElementById('settingsApiKey');
    const btn = inp.nextElementSibling;
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '숨기기'; }
    else { inp.type = 'password'; btn.textContent = '보기'; }
  }

  function showModal_settings() {
    document.getElementById('settingsApiKey').value = getApiKey();
    showModal('settingsModal');
  }

  async function testApiKey() {
    const key = document.getElementById('settingsApiKey').value.trim();
    if (!key) { showApiStatus('error', '⚠️ API 키를 먼저 입력하세요'); return; }
    const btn = document.getElementById('testApiBtn');
    btn.disabled = true; btn.textContent = '테스트 중…';
    const origKey = getApiKey();
    saveApiKey(key); // 임시 저장
    try {
      await callClaude([{ role: 'user', content: '안녕? 한 문장으로 응답해.' }], 50);
      showApiStatus('success', '✅ 연결 성공 — Claude Sonnet 사용 가능');
    } catch (e) {
      saveApiKey(origKey); // 실패 시 복원
      showApiStatus('error', '❌ ' + (e.message === 'API_KEY_MISSING' ? '키가 비어 있습니다' : e.message));
    }
    btn.disabled = false; btn.textContent = '연결 테스트';
  }

  function showApiStatus(type, msg) {
    const el = document.getElementById('apiKeyStatus');
    el.style.display = '';
    el.style.background = type === 'success' ? '#D1FAE5' : '#FEE2E2';
    el.style.color = type === 'success' ? '#065F46' : '#991B1B';
    el.textContent = msg;
  }

  function saveSettings() {
    const key = document.getElementById('settingsApiKey').value.trim();
    saveApiKey(key);
    closeModal('settingsModal');
    if (key) showToast('Claude Sonnet API 키가 저장되었습니다 ✅');
  }

  /* ── 토스트 메시지 ── */
  function showToast(msg) {
    let t = document.getElementById('neoToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'neoToast';
      t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1F2937;color:#fff;padding:10px 20px;border-radius:24px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);transition:opacity .3s;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
  }

  /* ══════════════════════════════════
     스크린샷 → Claude Vision 분석
  ══════════════════════════════════ */

  let capturedImageData = null; // base64

  function simulateCapture() {
    // API 키 있으면 파일 선택, 없으면 데모 실행
    if (getApiKey()) {
      document.getElementById('imageFileInput').click();
    } else {
      runDemoCapture();
    }
  }

  function handleImageFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      capturedImageData = e.target.result; // data:image/...;base64,...
      runClaudeCapture(capturedImageData);
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  async function runClaudeCapture(dataUrl) {
    const dz = document.getElementById('dropZone');
    const analyzing = document.getElementById('aiAnalyzing');
    const result = document.getElementById('aiResult');
    const preview = document.getElementById('previewThumb');

    result.style.display = 'none';
    preview.style.display = 'none';
    dz.style.display = 'none';
    analyzing.style.display = '';

    const statusEl = document.getElementById('analyzeStatus');
    const detailEl = document.getElementById('analyzeDetail');
    const pf = document.getElementById('progressFill');
    pf.style.animation = 'none'; void pf.offsetWidth;
    pf.style.animation = 'progress-bar 3s ease forwards';

    statusEl.textContent = 'Claude Sonnet 분석 중...';
    detailEl.textContent = '이미지 → 텍스트 인식 → 필드 매핑';

    try {
      // base64 데이터 추출
      const base64 = dataUrl.split(',')[1];
      const mediaType = dataUrl.match(/data:(image\/[^;]+)/)?.[1] || 'image/png';

      const prompt = `이 이미지는 마트/점포 관련 화면 캡처입니다. 이미지에서 점포 정보를 추출해주세요.

반드시 아래 JSON 형식으로만 응답하세요 (설명 없이 JSON만):
{
  "store_name": "점포명",
  "owner": "대표자명",
  "phone": "전화번호(예:031-000-0000)",
  "biz_no": "사업자번호(예:123-45-67890)",
  "address": "전체 주소",
  "contract_date": "YYYY-MM-DD 형식 날짜",
  "confidence": "high|medium|low"
}

찾을 수 없는 필드는 빈 문자열("")로 두세요.`;

      statusEl.textContent = '텍스트 추출 중...';
      detailEl.textContent = 'OCR → 필드 분류';

      const text = await callClaude([{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }], 500);

      statusEl.textContent = '필드 매핑 중...';
      detailEl.textContent = '점포명·주소·사업자번호 매핑';

      // JSON 파싱
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('응답 파싱 실패');
      const parsed = JSON.parse(jsonMatch[0]);

      analyzing.style.display = 'none';
      document.getElementById('captureSourceLabel').textContent = captureSourceLabels[currentCaptureSource] + ' (Claude Sonnet 분석)';
      preview.style.display = '';
      result.style.display = '';

      applyAutoFillFromClaude(parsed);

    } catch (e) {
      analyzing.style.display = 'none';
      if (e.message === 'API_KEY_MISSING') {
        dz.style.display = '';
        showToast('⚙️ 설정에서 API 키를 먼저 입력하세요');
      } else {
        // 오류 시 데모 폴백
        document.getElementById('captureSourceLabel').textContent = captureSourceLabels[currentCaptureSource] + ' (데모 결과)';
        preview.style.display = '';
        result.style.display = '';
        applyAutoFill();
        showToast('⚠️ API 오류 — 데모 데이터 사용: ' + e.message.slice(0, 60));
      }
    }
  }

  function applyAutoFillFromClaude(data) {
    const fieldMap = {
      'f-name': data.store_name,
      'f-ceo':  data.owner,
      'f-tel':  data.phone,
      'f-biz':  data.biz_no,
      'f-addr': data.address,
      'f-date': data.contract_date
    };
    const warnFields = ['f-biz', 'f-tid'];
    const badgeMap = {'f-name':'badge-name','f-ceo':'badge-ceo','f-tel':'badge-tel','f-biz':'badge-biz','f-addr':'badge-addr','f-date':'badge-date'};
    let filled = 0;

    Object.entries(fieldMap).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val) {
        el.value = val; filled++;
        el.classList.add(warnFields.includes(id) ? 'field-warn' : 'field-auto');
      }
    });
    Object.entries(badgeMap).forEach(([fid, bid]) => {
      const badge = document.getElementById(bid);
      if (badge) badge.style.display = fieldMap[fid] ? 'inline' : 'none';
    });

    // 결과 텍스트 업데이트
    const resultEl = document.getElementById('aiResult');
    resultEl.querySelector('span[style*="font-weight:700"]').textContent =
      `${filled}개 항목 자동 입력 완료 — Claude Sonnet 분석`;
  }

  /* ── 데모 캡처 (API 키 없을 때) ── */
  function runDemoCapture() {
    const dz = document.getElementById('dropZone');
    const analyzing = document.getElementById('aiAnalyzing');
    const result = document.getElementById('aiResult');
    const preview = document.getElementById('previewThumb');

    result.style.display = 'none';
    preview.style.display = 'none';
    dz.style.display = 'none';
    analyzing.style.display = '';

    const steps = [
      ['화면 이미지 인식 중...', '텍스트 영역 탐지'],
      ['텍스트 추출 중...', 'OCR → 필드 분류'],
      ['필드 매핑 중...', '점포명·주소·사업자번호 매핑'],
      ['주소 정규화 중...', '행정 구역 표준화'],
      ['완료 ✅', '결과 적용 중...']
    ];
    let stepIdx = 0;
    const statusEl = document.getElementById('analyzeStatus');
    const detailEl = document.getElementById('analyzeDetail');
    const pf = document.getElementById('progressFill');
    pf.style.animation = 'none'; void pf.offsetWidth;
    pf.style.animation = 'progress-bar 2.2s ease forwards';

    const stepTimer = setInterval(() => {
      if (stepIdx < steps.length) {
        statusEl.textContent = steps[stepIdx][0];
        detailEl.textContent = steps[stepIdx][1];
        stepIdx++;
      }
    }, 450);

    setTimeout(() => {
      clearInterval(stepTimer);
      analyzing.style.display = 'none';
      document.getElementById('captureSourceLabel').textContent = captureSourceLabels[currentCaptureSource] + ' (데모)';
      preview.style.display = '';
      result.style.display = '';
      applyAutoFill();
    }, 2400);
  }

  function applyAutoFill() {
    const autoData = {
      'f-name': '웰빙마트 고양점',
      'f-ceo': '이정민',
      'f-tel': '031-900-0000',
      'f-biz': '123-45-67890',
      'f-addr': '경기도 고양시 일산동구 장항동 856',
      'f-date': '2024-02-01'
    };
    const warnFields = ['f-biz', 'f-tid'];
    const badgeMap = {'f-name':'badge-name','f-ceo':'badge-ceo','f-tel':'badge-tel','f-biz':'badge-biz','f-addr':'badge-addr','f-date':'badge-date','f-tid':'badge-tid'};

    Object.entries(autoData).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = val;
        el.classList.add(warnFields.includes(id) ? 'field-warn' : 'field-auto');
      }
    });
    Object.entries(badgeMap).forEach(([fid, bid]) => {
      const badge = document.getElementById(bid);
      if (badge) badge.style.display = autoData[fid] !== undefined ? 'inline' : 'none';
    });
    document.getElementById('badge-tid').style.display = 'inline';
  }

  function resetCapture() {
    document.getElementById('dropZone').style.display = '';
    document.getElementById('aiAnalyzing').style.display = 'none';
    document.getElementById('aiResult').style.display = 'none';
    document.getElementById('previewThumb').style.display = 'none';
    // 폼 초기화
    ['f-name','f-ceo','f-tel','f-biz','f-addr','f-date'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.classList.remove('field-auto','field-warn'); }
    });
    ['badge-name','badge-ceo','badge-tel','badge-biz','badge-addr','badge-date','badge-tid'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  /* ── 당구공 선택기 ── */
  /* ── 고정 투입 장비 정의 (변형 옵션 포함) ── */
  // costPriceBy/salePriceBy: 변형(variant)별 단가가 다른 경우 사용
  // hasSize: 사이즈 입력 칸 표시 (포스 다이 등)
  const FIXED_EQUIPMENT = [
    { key:'server',     name:'서버PC',           costPrice:650000,  salePrice:850000  },
    { key:'client',     name:'클라이언트PC',      costPrice:480000,  salePrice:650000  },
    { key:'allinone',   name:'일체형포스',        variants:['유통','외식'], costPrice:495000, salePrice:1100000 },
    { key:'kiosk',      name:'키오스크',          variants:['유통','외식'], costPrice:0,     salePrice:1800000 },
    { key:'fscanner',   name:'고정스캐너',        costPrice:0,       salePrice:0       },
    { key:'rprinter',   name:'포스프린터',        variants:['시리얼','패러럴'], costPrice:0, salePrice:0 },
    { key:'plukey',     name:'PLU키보드',         costPrice:0,       salePrice:0       },
    { key:'handy',      name:'핸디터미널',        variants:['930','970'],
      costPriceBy:{'930':300000,'970':480000}, salePriceBy:{'930':650000,'970':800000} },
    { key:'handystand', name:'핸디터미널거치대',   variants:['수직형','I/O박스'],
      costPriceBy:{'수직형':80000,'I/O박스':40000}, salePriceBy:{'수직형':200000,'I/O박스':120000} },
    { key:'lprinter',   name:'라벨프린터',        costPrice:0,       salePrice:0       },
    { key:'posdai',     name:'포스 다이',         variants:['전동','무전동'], hasSize:true, costPrice:0, salePrice:0 },
    { key:'monitor',    name:'모니터',            variants:['사무용','포스 듀얼'], costPrice:0, salePrice:0 },
    { key:'scale',      name:'전자저울',          variants:['일반','정육'], costPrice:0, salePrice:0 },
    { key:'kbdai',      name:'키보드 다이',       costPrice:0,       salePrice:0       },
    { key:'checker',    name:'체크기',
      variants:['K501','K4200','SCS500','K400','P500'],
      extraToggle:{ label:'구성', options:['세트','단품'] },
      costPrice:0, salePrice:0 },
    { key:'hscanner',   name:'핸디스캐너',        costPrice:0,       salePrice:0       },
  ];

  /* ── 장비 카탈로그 (사용자 관리 가능) ──
     스키마: { id, category, name, variants[], costPrice, salePrice }
     기본값: 기존 FIXED_EQUIPMENT 에서 시드 — 마이페이지에서 수정/추가/삭제 가능
     localStorage: ns_equipment_catalog
     클라우드: /api/catalog (모든 직원 PC 자동 동기화) */
  const DEFAULT_EQUIPMENT_CATALOG = [
    { id:'eq-server',      category:'컴퓨터',   name:'서버PC',          variants:[],                      costPrice:650000, salePrice:850000 },
    { id:'eq-client',      category:'컴퓨터',   name:'클라이언트PC',     variants:[],                      costPrice:480000, salePrice:650000 },
    { id:'eq-allinone',    category:'POS',     name:'일체형포스',       variants:['유통','외식'],          costPrice:495000, salePrice:1100000 },
    { id:'eq-kiosk',       category:'POS',     name:'키오스크',         variants:['유통','외식'],          costPrice:0,      salePrice:1800000 },
    { id:'eq-fscanner',    category:'주변기기', name:'고정스캐너',        variants:[],                      costPrice:0,      salePrice:0 },
    { id:'eq-rprinter',    category:'주변기기', name:'포스프린터',        variants:['시리얼','패러럴'],      costPrice:0,      salePrice:0 },
    { id:'eq-plukey',      category:'주변기기', name:'PLU키보드',         variants:[],                      costPrice:0,      salePrice:0 },
    { id:'eq-handy930',    category:'POS',     name:'핸디터미널 930',    variants:[],                      costPrice:300000, salePrice:650000 },
    { id:'eq-handy970',    category:'POS',     name:'핸디터미널 970',    variants:[],                      costPrice:480000, salePrice:800000 },
    { id:'eq-handystand-v',category:'주변기기', name:'핸디거치대 수직형', variants:[],                      costPrice:80000,  salePrice:200000 },
    { id:'eq-handystand-i',category:'주변기기', name:'핸디거치대 I/O박스',variants:[],                      costPrice:40000,  salePrice:120000 },
    { id:'eq-lprinter',    category:'주변기기', name:'라벨프린터',        variants:[],                      costPrice:0,      salePrice:0 },
    { id:'eq-posdai',      category:'가구',    name:'포스 다이',
      options:[
        { label:'손잡이 방향', choices:['좌타','우타'] },
        { label:'길이(mm)',    choices:['1500','1800','2000','2300','2500'] },
        { label:'형태',        choices:['일자','ㄱ자'] },
        { label:'동력',        choices:['전동','무전동'] },
      ], costPrice:0, salePrice:0 },
    { id:'eq-monitor',     category:'주변기기', name:'모니터',            variants:['사무용','포스 듀얼'],   costPrice:0,      salePrice:0 },
    { id:'eq-scale',       category:'주변기기', name:'전자저울',          variants:['일반','정육'],          costPrice:0,      salePrice:0 },
    { id:'eq-kbdai',       category:'가구',    name:'키보드 다이',       variants:[],                      costPrice:0,      salePrice:0 },
    { id:'eq-checker-k501', category:'체크기', name:'체크기 K501',       variants:['세트','단품'],          costPrice:0,      salePrice:0 },
    { id:'eq-checker-k4200',category:'체크기', name:'체크기 K4200',      variants:['세트','단품'],          costPrice:0,      salePrice:0 },
    { id:'eq-checker-scs500',category:'체크기',name:'체크기 SCS500',     variants:['세트','단품'],          costPrice:0,      salePrice:0 },
    { id:'eq-checker-k400', category:'체크기', name:'체크기 K400',       variants:['세트','단품'],          costPrice:0,      salePrice:0 },
    { id:'eq-checker-p500', category:'체크기', name:'체크기 P500',       variants:['세트','단품'],          costPrice:0,      salePrice:0 },
    { id:'eq-hscanner',    category:'주변기기', name:'핸디스캐너',        variants:[],                      costPrice:0,      salePrice:0 },
  ];
  // 옵션 저장 포맷: 단일 텍스트 — 한 줄 = 한 단계, 형식 "이름: 선택1, 선택2, ..."
  function parseOptionsText(text) {
    if (!text) return [];
    return String(text).split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        // 첫 ':' 또는 ':' 기준 분리
        const m = line.match(/^([^:：]+)[:：](.*)$/);
        if (!m) return null;
        const label = m[1].trim();
        const choices = m[2].split(/[,，]/).map(s => s.trim()).filter(Boolean);
        if (!label || choices.length === 0) return null;
        return { label, choices };
      }).filter(Boolean);
  }
  function serializeOptionsToText(options) {
    return (options||[]).map(g => {
      const label = String(g.label||'').trim();
      const choices = (g.choices||[]).map(c => String(c||'').trim()).filter(Boolean);
      if (!label || choices.length === 0) return null;
      return `${label}: ${choices.join(', ')}`;
    }).filter(Boolean).join('\n');
  }
  // 카탈로그 항목의 옵션 그룹 배열 — 모든 스키마 자동 정상화
  // 우선순위: optionsText (텍스트) > options[] > variants[]
  function normalizeCatalogOptions(item) {
    if (!item) return [];
    if (typeof item.optionsText === 'string' && item.optionsText.trim()) {
      return parseOptionsText(item.optionsText);
    }
    if (Array.isArray(item.options) && item.options.length > 0) {
      return item.options.map(g => ({
        label: String(g.label||'옵션').trim() || '옵션',
        choices: Array.isArray(g.choices) ? g.choices.map(c => String(c||'').trim()).filter(Boolean) : [],
      })).filter(g => g.choices.length > 0);
    }
    if (Array.isArray(item.variants) && item.variants.length > 0) {
      return [{ label:'옵션', choices: item.variants.slice() }];
    }
    return [];
  }
  // 항목의 현재 옵션 텍스트 표현 — 편집창에 띄울 값
  function getOptionsText(item) {
    if (!item) return '';
    if (typeof item.optionsText === 'string') return item.optionsText;
    return serializeOptionsToText(normalizeCatalogOptions(item));
  }
  function getEquipmentCatalog() {
    try {
      const v = JSON.parse(localStorage.getItem('ns_equipment_catalog') || 'null');
      if (Array.isArray(v) && v.length > 0) return v;
    } catch {}
    return DEFAULT_EQUIPMENT_CATALOG.slice();
  }
  function setEquipmentCatalogLocal(arr) {
    localStorage.setItem('ns_equipment_catalog', JSON.stringify(arr));
  }
  // 클라우드 → 로컬 동기화 (페이지 로드 시 한 번)
  async function syncCatalogFromCloud() {
    try {
      const res = await fetch('/api/catalog', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.items) && data.items.length > 0) {
        setEquipmentCatalogLocal(data.items);
      }
    } catch(e) { /* 네트워크 실패 무시 — 로컬 기본값 사용 */ }
  }
  // 로컬 → 클라우드 푸시 (인증 없음 — 누구나 저장 가능)
  // 빠른 djb2 해시 — KV 한도 절감 (content-skip 용)
  window._fastHash = window._fastHash || function(s) {
    let h = 5381; const len = s.length;
    for (let i = 0; i < len; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };
  async function pushCatalogToCloud(items, opts) {
    const body = JSON.stringify({ items });
    // content-skip
    const h = window._fastHash(body);
    if (!opts?.force && h && window._lastCatalogPushHash === h) {
      return { ok:true, skipped:true };
    }
    try {
      const res = await fetch('/api/catalog', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body,
      });
      if (!res.ok) {
        let txt = ''; try { txt = await res.text(); } catch(_){}
        const limitHit = /KV put.*limit exceeded/i.test(txt);
        if (limitHit && !window._kvLimitToastShown) {
          window._kvLimitToastShown = true;
          try { if (typeof showToast === 'function') showToast('⚠ 클라우드 동기화 한도 초과 — 한국 시간 익일 09:00 자동 해제 (로컬 저장은 정상)'); } catch(_){}
        } else if (opts && opts.toast && typeof showToast === 'function') showToast(`⚠ 클라우드 푸시 실패 (${res.status}): ${txt.slice(0,80)}`);
        return { ok:false, status:res.status, limitHit };
      }
      const data = await res.json();
      if (h) window._lastCatalogPushHash = h;
      if (opts && opts.toast && typeof showToast === 'function') showToast(`☁ 카탈로그 동기화 완료 (${data.count}건)`);
      return { ok:true, ...data };
    } catch(e) {
      if (opts && opts.toast && typeof showToast === 'function') showToast('⚠ 클라우드 푸시 실패 (네트워크)');
      return { ok:false, error:String(e) };
    }
  }
  function saveEquipmentCatalog(arr, opts) {
    setEquipmentCatalogLocal(arr);
    pushCatalogToCloud(arr, opts);
  }
  window.getEquipmentCatalog = getEquipmentCatalog;

  /* ═════════════════════════════════════════════════════════════════
     매장별 설치 장비 정식 DB — store.equipment[] (Plan B)
     ─────────────────────────────────────────────────────────────────
     설계 원칙:
       1. 매장 장비는 인스턴스 단위 ('eqi-...') — 매장간 이전 / AS 연결 추적
       2. catalogId 는 참조용. 카탈로그가 변경 / 삭제되어도 매장 장비 데이터는
          snapshot (name/category/options 등) 으로 표시 가능
       3. 라이프사이클 status — in_use / replaced / removed / disposed / transferred_out
          삭제는 안 함 (audit trail)
       4. 카탈로그 ID 매핑: getEquipmentCatalog() 에서 사라진 catalogId 는
          findCatalogByName() 으로 다시 매칭 시도 (이름 변경 / 재배포 대응)
     ═════════════════════════════════════════════════════════════════ */
  const STORE_EQUIP_SCHEMA_VER = 1;
  const STORE_EQUIP_STATUS = {
    in_use:          { label:'정상',    color:'#10B981', bg:'#D1FAE5' },
    replaced:        { label:'교체됨',  color:'#3B82F6', bg:'#DBEAFE' },
    removed:         { label:'제거됨',  color:'#6B7280', bg:'#E5E7EB' },
    disposed:        { label:'폐기',    color:'#EF4444', bg:'#FEE2E2' },
    transferred_out: { label:'이전됨',  color:'#F59E0B', bg:'#FEF3C7' },
  };
  function genInstanceId() {
    return 'eqi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function findCatalogByName(name) {
    if (!name) return null;
    const list = getEquipmentCatalog() || [];
    const norm = s => String(s||'').replace(/\s+/g,'').toLowerCase();
    const n = norm(name);
    // 정확 매칭 우선
    let hit = list.find(c => norm(c.name) === n);
    if (hit) return hit;
    // 부분 포함
    hit = list.find(c => norm(c.name).includes(n) || n.includes(norm(c.name)));
    return hit || null;
  }
  function buildEquipInstance(src) {
    /* src 에서 store.equipment 인스턴스 생성 — 카탈로그 매칭 시도 + snapshot 보존 */
    const catalog = src.catalogId ? (getEquipmentCatalog().find(c => c.id === src.catalogId)) : null;
    const matched = catalog || findCatalogByName(src.name);
    return {
      instanceId: src.instanceId || genInstanceId(),
      catalogId:  matched ? matched.id : null,
      catalogVer: STORE_EQUIP_SCHEMA_VER,
      // snapshot (카탈로그 변경에 무관)
      name:      src.name      || (matched && matched.name)     || '-',
      category:  src.category  || (matched && matched.category) || '기타',
      variant:   src.variant   || '',
      options:   src.options   || {},
      size:      src.size      || '',
      condition: src.condition || 'new',
      // 인스턴스별
      qty:       Number(src.qty) || 1,
      serialNo:  src.serialNo  || '',
      costPrice: Number(src.costPrice) || 0,
      salePrice: Number(src.salePrice) || 0,
      // 라이프사이클
      status:        src.status || 'in_use',
      installedAt:   src.installedAt || (new Date()).toISOString().slice(0,10),
      installedBy:   src.installedBy || (typeof _currentUserName === 'function' ? _currentUserName() : ''),
      sourceJobId:   src.sourceJobId || '',
      history:       Array.isArray(src.history) ? src.history.slice() : [{
        at: new Date().toISOString(),
        kind: src.sourceJobId ? 'installed_via_job' : 'manually_added',
        by:  (typeof _currentUserName === 'function' ? _currentUserName() : ''),
        note: src.note || '',
      }],
      updatedAt: new Date().toISOString(),
      updatedBy: (typeof _currentUserName === 'function' ? _currentUserName() : ''),
    };
  }
  function _findStoreInList(stores, store) {
    /* store 매칭 — id 우선, 사업자, 상호 순 */
    const sid    = store.storeId || store.id;
    const sbiz   = store.businessNumber || store.biz;
    const sname  = (store.storeName || store.store || store.name || '').trim();
    if (sid)   { const m = stores.find(s => (s.id || s.storeId) === sid); if (m) return m; }
    if (sbiz)  { const m = stores.find(s => (s.businessNumber || s.biz) === sbiz); if (m) return m; }
    if (sname) {
      const m = stores.find(s => (s.storeName || s.name || '').trim() === sname);
      if (m) return m;
    }
    return null;
  }
  function getStoreEquipment(storeRef) {
    /* storeRef = { storeId? storeName? businessNumber? } 또는 매장 객체 */
    if (!storeRef) return [];
    let stores = [];
    try { stores = (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){}
    const s = _findStoreInList(stores, storeRef);
    return (s && Array.isArray(s.equipment)) ? s.equipment.slice() : [];
  }
  function addStoreEquipment(storeRef, src, opts) {
    let stores = [];
    try { stores = (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){}
    const s = _findStoreInList(stores, storeRef);
    if (!s) return null;
    if (!Array.isArray(s.equipment)) s.equipment = [];
    const inst = buildEquipInstance(src);
    s.equipment.push(inst);
    if (typeof saveStores === 'function') saveStores(stores);
    else localStorage.setItem('ns_stores', JSON.stringify(stores));
    if (opts && opts.toast && typeof showToast === 'function') showToast(`✓ ${inst.name} 추가됨`);
    return inst;
  }
  function updateStoreEquipment(storeRef, instanceId, patch, opts) {
    let stores = [];
    try { stores = (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){}
    const s = _findStoreInList(stores, storeRef);
    if (!s || !Array.isArray(s.equipment)) return false;
    const i = s.equipment.findIndex(e => e.instanceId === instanceId);
    if (i < 0) return false;
    const before = JSON.parse(JSON.stringify(s.equipment[i]));
    Object.assign(s.equipment[i], patch, {
      updatedAt: new Date().toISOString(),
      updatedBy: (typeof _currentUserName === 'function' ? _currentUserName() : ''),
    });
    // 상태 변경시 history 추가
    if (patch.status && patch.status !== before.status) {
      s.equipment[i].history = s.equipment[i].history || [];
      s.equipment[i].history.push({
        at: new Date().toISOString(),
        kind: 'status_change',
        by: (typeof _currentUserName === 'function' ? _currentUserName() : ''),
        note: `${before.status} → ${patch.status}` + (patch.statusNote ? ' / ' + patch.statusNote : ''),
      });
    }
    if (typeof saveStores === 'function') saveStores(stores);
    else localStorage.setItem('ns_stores', JSON.stringify(stores));
    if (opts && opts.toast && typeof showToast === 'function') showToast('✓ 장비 정보 수정됨');
    return true;
  }
  function transferStoreEquipment(fromStore, toStore, instanceIds, opts) {
    /* 매장간 장비 이전 — fromStore 의 인스턴스 status='transferred_out' + toStore 에 신규 추가 */
    let stores = [];
    try { stores = (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){}
    const sFrom = _findStoreInList(stores, fromStore);
    const sTo   = _findStoreInList(stores, toStore);
    if (!sFrom || !sTo) return { ok:false, error:'매장 못 찾음' };
    if (!Array.isArray(sFrom.equipment)) sFrom.equipment = [];
    if (!Array.isArray(sTo.equipment))   sTo.equipment   = [];
    const me = (typeof _currentUserName === 'function' ? _currentUserName() : '');
    const moved = [];
    instanceIds.forEach(id => {
      const i = sFrom.equipment.findIndex(e => e.instanceId === id);
      if (i < 0) return;
      const inst = sFrom.equipment[i];
      // 원본은 transferred_out 처리, 이력만 보존
      inst.status = 'transferred_out';
      inst.updatedAt = new Date().toISOString();
      inst.updatedBy = me;
      inst.history = inst.history || [];
      inst.history.push({ at:new Date().toISOString(), kind:'transferred_out',
        by:me, note:`→ ${sTo.storeName || sTo.name || ''}` });
      // 새 매장에 새 인스턴스 (이력 보존)
      const newInst = buildEquipInstance({ ...inst, instanceId: genInstanceId(), status:'in_use', sourceJobId:'',
        history: [...(inst.history||[]), { at:new Date().toISOString(), kind:'transferred_in', by:me,
                                            note:`← ${sFrom.storeName || sFrom.name || ''}` }] });
      sTo.equipment.push(newInst);
      moved.push(newInst);
    });
    if (typeof saveStores === 'function') saveStores(stores);
    else localStorage.setItem('ns_stores', JSON.stringify(stores));
    if (opts && opts.toast && typeof showToast === 'function') showToast(`✓ ${moved.length}건 이전 완료`);
    return { ok:true, moved };
  }
  // 작업 → 매장 장비 적재
  //   완료 작업: equipment[] 전체 (모두 설치된 것으로 간주)
  //   진행 작업: equipmentChecked[i]=true 만
  //   sourceJobId + sourceJobItemIdx 로 중복 방지 (재실행 안전)
  function ingestJobEquipmentToStore(job) {
    if (!job || !Array.isArray(job.equipment) || job.equipment.length === 0) return 0;
    const storeRef = { storeId: job.storeId, storeName: job.storeName || job.store };
    if (!storeRef.storeName && !storeRef.storeId) return 0;
    let stores = [];
    try { stores = (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){}
    const s = _findStoreInList(stores, storeRef);
    if (!s) return 0;
    // s.equipment 는 push 직전에 lazy 초기화 (빈 배열로 두지 않음 — 클라우드 머지 시 KV 값 보존)
    const checked   = job.equipmentChecked   || {};
    const checkedBy = job.equipmentCheckedBy || {};
    const isDone = (typeof _isJobDone === 'function') ? _isJobDone(job) : false;
    let added = 0;
    job.equipment.forEach((e, i) => {
      // 적재 조건: (a) 명시적 체크 OR (b) 완료된 작업이면 무조건
      if (!checked[i] && !isDone) return;
      // 중복 방지 — equipment 배열 미초기화 가드
      const existing = Array.isArray(s.equipment) ? s.equipment : [];
      const dupe = existing.find(x => x.sourceJobId === job.id && x.sourceJobItemIdx === i);
      if (dupe) return;
      const meta = checkedBy[i] || {};
      const inst = buildEquipInstance({
        catalogId: e.catalogId || e.fixedKey || null,
        name:      e.name,
        category:  e.category || '',
        variant:   e.variant,
        options:   e.options,
        size:      e.size,
        condition: e.condition,
        qty:       e.qty,
        costPrice: e.costPrice,
        salePrice: e.salePrice,
        sourceJobId:    job.id,
        // 설치일: 체크한 시점 > 완료일 > 설치일자 > job 등록일
        installedAt:    (meta.at || job.completedAt || job.installDate || job.openDate || job.createdAt || '').slice(0, 10) || undefined,
        installedBy:    meta.name || job.engineer || job.assignee || '',
        note:           checked[i] ? '체크박스로 설치 확인' : (isDone ? '완료 작업에서 자동 적재' : ''),
      });
      inst.sourceJobItemIdx = i;
      if (!Array.isArray(s.equipment)) s.equipment = [];  // lazy init — push 직전에만
      s.equipment.push(inst);
      added++;
    });
    if (added > 0) {
      if (typeof saveStores === 'function') saveStores(stores);
      else localStorage.setItem('ns_stores', JSON.stringify(stores));
    }
    return added;
  }
  // 마이그레이션 — 모든 job.equipment 를 일괄 store.equipment 로 이전
  // 버전 v2 (적재 정책 변경: 완료 작업 = 무조건 / 진행중 = checked 만)
  // 다른 사용자의 변경분과 충돌하지 않도록 ingest 가 sourceJobId+idx 중복 차단
  function migrateJobEquipmentToStore(opts) {
    const FLAG_VER = 2;
    const flag = 'ns_store_equip_migrated_v' + FLAG_VER;
    if (!(opts && opts.force) && localStorage.getItem(flag) === '1') {
      return { skipped:true, reason:'already migrated v' + FLAG_VER };
    }
    let jobs = [];
    try { jobs = (typeof getJobs === 'function') ? (getJobs() || []) : []; } catch(e){}
    let total = 0, stores = 0, noStoreMatched = 0;
    const seenStores = new Set();
    jobs.forEach(j => {
      if (!Array.isArray(j.equipment) || j.equipment.length === 0) return;
      const added = ingestJobEquipmentToStore(j);
      if (added > 0) {
        total += added;
        const key = (j.storeId || '') + '|' + (j.storeName || j.store || '');
        if (!seenStores.has(key)) { seenStores.add(key); stores++; }
      } else {
        // equipment 는 있지만 매장 매칭 실패 — 통계용
        const ref = { storeId: j.storeId, storeName: j.storeName || j.store };
        if (!ref.storeName && !ref.storeId) return;
        let allStores = [];
        try { allStores = getStores() || []; } catch(e){}
        if (!_findStoreInList(allStores, ref)) noStoreMatched++;
      }
    });
    localStorage.setItem(flag, '1');
    // v1 flag 가 있으면 함께 정리
    localStorage.removeItem('ns_store_equip_migrated_v1');
    // 클라우드 즉시 동기화 (debounce 우회)
    if (total > 0) {
      try { if (typeof pushStoresToCloud === 'function') pushStoresToCloud({ toast:false }); } catch(e){}
    }
    return { ok:true, added: total, stores, noStoreMatched, version: FLAG_VER };
  }
  window.getStoreEquipment = getStoreEquipment;
  window.addStoreEquipment = addStoreEquipment;
  window.updateStoreEquipment = updateStoreEquipment;
  window.transferStoreEquipment = transferStoreEquipment;
  window.ingestJobEquipmentToStore = ingestJobEquipmentToStore;
  window.migrateJobEquipmentToStore = migrateJobEquipmentToStore;
  window.STORE_EQUIP_STATUS = STORE_EQUIP_STATUS;
  window.findCatalogByName = findCatalogByName;
  window.STORE_EQUIP_SCHEMA_VER = STORE_EQUIP_SCHEMA_VER;

  /* ── 📇 매장 연락처 누적 (장비 적재 패턴 미러링) ──
     업무(AS/소모품/신규/VAN)에서 입력한 연락처(이름/직책/전화/이메일/주소)를 store.contacts[] 에 누적.
     STORE_FIELD_POLICY: contacts = additive-by-id(phone) → 클라우드 머지로 자동 누적·중복제거.
     dedupe/upsert = 전화번호 정규화 기준(없으면 이름). 빈 필드만 보강(기존값 안 덮음). idempotent. */
  function _contactPhoneKey(p) { return String(p || '').replace(/\D/g, ''); }
  function getStoreContacts(storeRef) {
    if (!storeRef) return [];
    let stores = [];
    try { stores = (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){}
    const s = _findStoreInList(stores, storeRef);
    return (s && Array.isArray(s.contacts)) ? s.contacts.slice() : [];
  }
  function ingestJobContactsToStore(job, opts) {
    opts = opts || {};
    if (!job) return 0;
    const list = (typeof getJobContacts === 'function') ? getJobContacts(job) : [];
    if (!list.length) return 0;
    const storeRef = { storeId: job.storeId, storeName: job.storeName || job.store };
    if (!storeRef.storeId && !storeRef.storeName) return 0;
    // opts.storesArr: 배치 호출(migrate) 시 공유 배열 — 작업마다 저장 안 하고 caller 가 1회 저장
    let stores = opts.storesArr || (function(){ try { return (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){ return []; } })();
    const s = _findStoreInList(stores, storeRef);
    if (!s) return 0;
    if (!Array.isArray(s.contacts)) s.contacts = [];   // lazy init (push 직전 — 빈배열 머지오염 방지)
    const me = (typeof _currentUserName === 'function') ? _currentUserName() : '';
    const jobAddr = String(job.address || '').trim();
    const srcType = String(job.lineCategory || job.type || '').trim();
    let added = 0, updated = 0;
    const tomb = new Set(Array.isArray(s.contactsDeleted) ? s.contactsDeleted : []);  // 삭제된 담당자 재적재 차단
    list.forEach(c => {
      const name  = String(c.name  || '').trim();
      const phone = String(c.phone || '').trim();
      const role  = String(c.role  || c.title || '').trim();
      const email = String(c.email || '').trim();
      const addr  = String(c.address || jobAddr || '').trim();
      if (!name && !phone) return;   // 빈 연락처 skip
      const pk = _contactPhoneKey(phone);
      const tkey = pk || ('n:' + name + '|' + role);
      if (tomb.has(tkey)) return;    // 사용자가 매장상세에서 삭제한 담당자 → 다시 적재하지 않음
      // 한 매장 내 중복등록 금지 — 전화번호(정규화) 기준 dedupe. 같은 사람이면 한 건으로 모음.
      //   ① 전화 매칭 → 그 항목에 빈 필드만 보강 (전화만 있던 항목에 이름/직책/이메일 나중 입력 시 갱신)
      //   ② 전화 매칭 실패 + 이름 있음 → 같은 이름의 '전화 없는' 항목에 병합 (이름만 있던 항목에 전화 추가)
      //   ③ 전화 없는 새 입력 → 같은 이름 항목에 병합
      //   (매장이 다르면 별개 — 동일인이 여러 매장에 등록되는 건 허용)
      let ex = null;
      if (pk) {
        ex = s.contacts.find(x => _contactPhoneKey(x.phone) === pk);
        if (!ex && name) ex = s.contacts.find(x => !_contactPhoneKey(x.phone) && String(x.name||'').trim() === name);
      } else if (name) {
        ex = s.contacts.find(x => String(x.name||'').trim() === name);
      }
      if (ex) {
        let ch = false;
        if (!ex.name && name)    { ex.name = name; ch = true; }
        if (!ex.phone && phone)  { ex.phone = phone; ch = true; }
        if (!ex.role && role)    { ex.role = role; ch = true; }
        if (!ex.email && email)  { ex.email = email; ch = true; }
        if (!ex.address && addr) { ex.address = addr; ch = true; }
        if (ch) { ex.updatedAt = new Date().toISOString(); ex.updatedBy = me; updated++; }
      } else {
        s.contacts.push({ name, role, phone, email, address: addr, primary: !!c.primary,
          sourceJobId: job.id || '', sourceJobType: srcType,
          addedAt: new Date().toISOString(), addedBy: me, updatedAt: new Date().toISOString() });
        added++;
      }
    });
    if ((added > 0 || updated > 0) && !opts.storesArr) {   // 단독 호출만 저장 (배치는 caller 가 1회 저장)
      if (typeof saveStores === 'function') saveStores(stores);
      else localStorage.setItem('ns_stores', JSON.stringify(stores));
    }
    return added;
  }
  // 전체 작업 → 매장 연락처 일괄 누적 (배치 1회 저장). 매 로드 호출(idempotent, 전화 dedupe)
  //   → 모바일 생성 작업도 클라우드→PC 동기화 후 PC 가 흡수. 새 누적분 있을 때만 saveStores+push.
  function migrateJobContactsToStore() {
    let stores = []; try { stores = (typeof getStores === 'function') ? (getStores() || []) : []; } catch(e){}
    let jobs = [];   try { jobs   = (typeof getJobs   === 'function') ? (getJobs()   || []) : []; } catch(e){}
    let total = 0;
    jobs.forEach(j => { try { total += ingestJobContactsToStore(j, { storesArr: stores }) || 0; } catch(_){} });
    if (total > 0) {
      if (typeof saveStores === 'function') saveStores(stores);
      else localStorage.setItem('ns_stores', JSON.stringify(stores));
      try { if (typeof pushStoresToCloud === 'function') pushStoresToCloud({ toast:false }); } catch(e){}
    }
    return { ok:true, added: total };
  }
  window.getStoreContacts = getStoreContacts;
  window.ingestJobContactsToStore = ingestJobContactsToStore;
  window.migrateJobContactsToStore = migrateJobContactsToStore;

  /* 카탈로그 CRUD — 모든 사용자 접근 가능 (마이페이지) */
  let catalogExpandedIdx = -1; // 옵션 편집 패널 펼친 행
  let catalogDraftText = '';   // 편집 중인 옵션 텍스트 (단일 문자열)
  function renderCatalogAdmin() {
    const tbodies = document.querySelectorAll('.js-catalog-tbody');
    if (!tbodies.length) return;
    const list = getEquipmentCatalog();
    let html;
    if (list.length === 0) {
      html = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px">등록된 장비가 없습니다. 우측 상단 [+ 장비 추가] 버튼을 눌러 추가하세요.</td></tr>`;
    } else {
      const inputSty = 'padding:5px 7px;border:1px solid var(--gray-200);border-radius:5px;font-size:12px;background:#fff;width:100%';
      html = list.map((it, i) => {
        const opts = normalizeCatalogOptions(it);
        const groupCount = opts.length;
        const totalChoices = opts.reduce((s,g)=>s+g.choices.length,0);
        const optBtnLabel = groupCount === 0
          ? '+ 옵션 그룹'
          : `${groupCount}단계 / ${totalChoices}항목`;
        const isExpanded = catalogExpandedIdx === i;
        const mainRow = `
          <tr>
            <td style="padding:5px"><input type="text" value="${esc(it.category||'')}" placeholder="POS / 컴퓨터 / 주변기기..." onchange="updateCatalogField(${i},'category',this.value)" style="${inputSty}"></td>
            <td style="padding:5px"><input type="text" value="${esc(it.name||'')}" placeholder="장비명" onchange="updateCatalogField(${i},'name',this.value)" style="${inputSty}"></td>
            <td style="padding:5px;text-align:center">
              <button onclick="toggleCatalogExpand(${i})" style="background:${isExpanded?'#DBEAFE':'#F3F4F6'};color:${isExpanded?'#1D4ED8':'var(--gray-700)'};border:1px solid ${isExpanded?'#93C5FD':'var(--gray-200)'};border-radius:5px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:600;width:100%">${isExpanded?'▼':'▶'} ${optBtnLabel}</button>
            </td>
            <td style="padding:5px"><input type="number" min="0" value="${Number(it.costPrice)||0}" onchange="updateCatalogField(${i},'costPrice',this.value)" style="${inputSty};text-align:right"></td>
            <td style="padding:5px"><input type="number" min="0" value="${Number(it.salePrice)||0}" onchange="updateCatalogField(${i},'salePrice',this.value)" style="${inputSty};text-align:right"></td>
            <td style="padding:5px;text-align:center">
              <button title="삭제" onclick="if(confirm('이 장비 품목을 삭제하시겠습니까?'))removeCatalogItem(${i})" style="background:none;border:1px solid var(--gray-200);border-radius:5px;padding:5px 9px;cursor:pointer;font-size:13px;color:var(--danger)">×</button>
            </td>
          </tr>`;
        if (!isExpanded) return mainRow;
        // 편집 중이면 드래프트 텍스트, 아니면 항목의 현재 텍스트
        const curText = (catalogExpandedIdx === i) ? catalogDraftText : getOptionsText(it);
        // 미리보기 — 텍스트를 파싱해 보여줌 (단계별로)
        const preview = parseOptionsText(curText);
        const previewHtml = preview.length === 0
          ? `<div style="font-size:11px;color:var(--gray-400);padding:8px;background:#fff;border-radius:6px;border:1px dashed var(--gray-300);text-align:center">옵션 단계가 없습니다 — 좌측 입력칸에 추가하세요</div>`
          : preview.map((g, gi) => `
              <div style="background:#fff;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="background:#1D4ED8;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">${gi+1}단계</span>
                <span style="font-weight:700;font-size:12px;color:var(--gray-700);min-width:90px">${esc(g.label)}</span>
                <div style="display:flex;flex-wrap:wrap;gap:4px;flex:1">
                  ${g.choices.map(c => `<span style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:600">${esc(c)}</span>`).join('')}
                </div>
                <span style="font-size:10px;color:var(--gray-400)">(${g.choices.length})</span>
              </div>
            `).join('');
        const expandRow = `
          <tr style="background:#F1F5F9">
            <td colspan="6" style="padding:16px 22px">
              <div style="background:#1D4ED8;color:#fff;padding:10px 14px;border-radius:6px;margin-bottom:12px;font-size:12px;font-weight:700">
                📐 옵션 단계 편집 — 한 줄에 한 단계, <code style="background:rgba(255,255,255,.2);padding:1px 6px;border-radius:3px">옵션이름: 선택1, 선택2, 선택3</code> 형식으로 입력하세요. 빈 줄은 무시됩니다.
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
                <div style="display:flex;flex-direction:column;gap:6px">
                  <div style="font-size:11px;color:var(--gray-600);font-weight:600">✏️ 입력</div>
                  <textarea oninput="updateDraftOptionsText(this.value,${i})" placeholder="예시:&#10;손잡이 방향: 좌타, 우타&#10;길이(mm): 1500, 1800, 2000, 2300, 2500&#10;형태: 일자, ㄱ자&#10;동력: 전동, 무전동" rows="${Math.max(6, curText.split(/\\r?\\n/).length + 1)}" style="width:100%;padding:10px 12px;border:1px solid var(--gray-300);border-radius:6px;font-size:13px;background:#fff;font-family:'Pretendard',monospace,sans-serif;resize:vertical;line-height:1.7">${esc(curText)}</textarea>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px">
                  <div style="font-size:11px;color:var(--gray-600);font-weight:600">👁️ 미리보기 (저장 후 사용자에게 보이는 모습)</div>
                  <div id="catalog-preview-${i}" style="display:flex;flex-direction:column;gap:4px;background:#F9FAFB;padding:8px;border-radius:6px;min-height:160px">${previewHtml}</div>
                </div>
              </div>
              <div style="margin-top:14px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
                <button onclick="saveCatalogOptions(${i})" class="btn btn-primary" style="font-size:13px;padding:9px 24px;font-weight:700">✓ 저장하고 닫기</button>
                <button onclick="cancelCatalogOptions()" class="btn btn-outline" style="font-size:13px;padding:9px 20px;font-weight:600;color:var(--gray-600)">취소</button>
              </div>
            </td>
          </tr>`;
        return mainRow + expandRow;
      }).join('');
    }
    tbodies.forEach(tb => { tb.innerHTML = html; });
  }
  window.renderCatalogAdmin = renderCatalogAdmin;
  function toggleCatalogExpand(i) {
    if (catalogExpandedIdx === i) { saveCatalogOptions(i); return; }
    catalogExpandedIdx = i;
    const list = getEquipmentCatalog();
    catalogDraftText = getOptionsText(list[i]);
    renderCatalogAdmin();
    // 미리보기 갱신을 위한 textarea oninput 디바운스 핸들러는 별도 — 여기서는 초기 1회 렌더만
  }
  window.toggleCatalogExpand = toggleCatalogExpand;

  // textarea 입력 — 드래프트 갱신 + 미리보기 div 만 부분 업데이트 (textarea 안 건드림 = 포커스 유지)
  function updateDraftOptionsText(value, i) {
    catalogDraftText = String(value||'');
    const preview = document.getElementById(`catalog-preview-${i}`);
    if (!preview) return;
    const parsed = parseOptionsText(catalogDraftText);
    if (parsed.length === 0) {
      preview.innerHTML = `<div style="font-size:11px;color:var(--gray-400);padding:8px;background:#fff;border-radius:6px;border:1px dashed var(--gray-300);text-align:center">옵션 단계가 없습니다 — 좌측 입력칸에 추가하세요</div>`;
      return;
    }
    preview.innerHTML = parsed.map((g, gi) => `
      <div style="background:#fff;padding:8px 10px;border:1px solid var(--gray-200);border-radius:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="background:#1D4ED8;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">${gi+1}단계</span>
        <span style="font-weight:700;font-size:12px;color:var(--gray-700);min-width:90px">${esc(g.label)}</span>
        <div style="display:flex;flex-wrap:wrap;gap:4px;flex:1">
          ${g.choices.map(c => `<span style="background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:600">${esc(c)}</span>`).join('')}
        </div>
        <span style="font-size:10px;color:var(--gray-400)">(${g.choices.length})</span>
      </div>`).join('');
  }
  window.updateDraftOptionsText = updateDraftOptionsText;

  function saveCatalogOptions(i) {
    const list = getEquipmentCatalog();
    if (i < 0 || i >= list.length) { catalogExpandedIdx = -1; renderCatalogAdmin(); return; }
    // 텍스트 → 정상화된 텍스트로 재직렬화 (빈 단계 자동 정리)
    const parsed = parseOptionsText(catalogDraftText);
    list[i].optionsText = serializeOptionsToText(parsed);
    // 구버전 필드 정리 (혼동 방지)
    delete list[i].options;
    delete list[i].variants;
    saveEquipmentCatalog(list);
    catalogExpandedIdx = -1;
    catalogDraftText = '';
    renderCatalogAdmin();
    if (typeof showToast === 'function') showToast(`✅ ${parsed.length}단계 옵션 저장됨`);
  }
  window.saveCatalogOptions = saveCatalogOptions;

  function cancelCatalogOptions() {
    catalogExpandedIdx = -1;
    catalogDraftText = '';
    renderCatalogAdmin();
  }
  window.cancelCatalogOptions = cancelCatalogOptions;

  function addCatalogItem() {
    const list = getEquipmentCatalog();
    list.unshift({
      id: 'eq-' + Date.now().toString(36) + Math.random().toString(36).slice(2,7),
      category: '', name: '', variants: [], costPrice: 0, salePrice: 0,
    });
    saveEquipmentCatalog(list);
    renderCatalogAdmin();
  }
  window.addCatalogItem = addCatalogItem;

  function updateCatalogField(idx, field, value) {
    const list = getEquipmentCatalog();
    if (idx < 0 || idx >= list.length) return;
    if (field === 'variants') {
      list[idx].variants = String(value||'').split(',').map(s => s.trim()).filter(Boolean);
    } else if (field === 'costPrice' || field === 'salePrice') {
      list[idx][field] = Math.max(0, Math.round(Number(value)||0));
    } else {
      list[idx][field] = String(value||'').trim();
    }
    saveEquipmentCatalog(list);
    // 입력 후 일관성 위해 즉시 재렌더는 안 함 (포커스 유지)
  }
  window.updateCatalogField = updateCatalogField;

  function removeCatalogItem(idx) {
    const list = getEquipmentCatalog();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    saveEquipmentCatalog(list);
    renderCatalogAdmin();
    if (typeof showToast === 'function') showToast('🗑️ 장비 삭제됨');
  }
  window.removeCatalogItem = removeCatalogItem;

  function pushCatalogNow() {
    pushCatalogToCloud(getEquipmentCatalog(), { toast:true });
  }
  window.pushCatalogNow = pushCatalogNow;

  // 마이페이지 열기 — 모든 사용자(직원/관리자) 가능
  function openMyPage() {
    if (typeof showModal === 'function') showModal('myPageModal');
  }
  window.openMyPage = openMyPage;

  function resetCatalogToDefault() {
    if (!confirm('카탈로그를 기본값으로 초기화하시겠습니까?\n현재 등록된 모든 사용자 정의 항목이 사라집니다.')) return;
    const def = DEFAULT_EQUIPMENT_CATALOG.slice();
    saveEquipmentCatalog(def);
    renderCatalogAdmin();
    if (typeof showToast === 'function') showToast('✅ 기본 카탈로그로 초기화됨');
  }
  window.resetCatalogToDefault = resetCatalogToDefault;

  /* ── 투입 장비 행 관리 ──
     행은 { id, fixed:true, fixedKey, name, variant, size, condition, qty, costPrice, salePrice }
     또는  { id, fixed:false, name, spec, condition, qty, costPrice, salePrice } */
  let equipRows = [];
  let equipRowSeq = 0;

  function fmt(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }

  function buildBallSelectors() { // 호환용 이름 유지
    equipRows = [];
    equipRowSeq = 0;
    // 1순위: 사용자 카탈로그 (마이페이지에서 추가/수정한 항목)
    let catalog = [];
    try { catalog = (typeof getEquipmentCatalog === 'function') ? getEquipmentCatalog() : []; } catch(e){}
    if (Array.isArray(catalog) && catalog.length > 0) {
      catalog.forEach(def => {
        const opts = (typeof normalizeCatalogOptions === 'function') ? normalizeCatalogOptions(def) : [];
        // 옵션 그룹별 첫 번째 선택지를 기본값으로
        const optionValues = {};
        opts.forEach(g => { if (g.choices.length > 0) optionValues[g.label] = g.choices[0]; });
        equipRows.push({
          id: ++equipRowSeq,
          fixed: true,
          fixedKey: def.id || def.name,    // 카탈로그 id
          catalog: true,                    // 카탈로그 기반 행 표시
          name: def.name,
          category: def.category || '',
          options: opts,                    // [{label, choices:[...]}] — 렌더용
          optionValues,                     // {label: 선택값} — 사용자 선택
          condition: 'new',
          qty: 0,
          costPrice: Number(def.costPrice)||0,
          salePrice: Number(def.salePrice)||0,
        });
      });
    } else {
      // Fallback: 카탈로그 비었으면 기존 FIXED_EQUIPMENT 사용
      FIXED_EQUIPMENT.forEach(def => {
        const variant = def.variants ? def.variants[0] : '';
        const cost = def.costPriceBy ? (def.costPriceBy[variant] || 0) : (def.costPrice || 0);
        const sale = def.salePriceBy ? (def.salePriceBy[variant] || 0) : (def.salePrice || 0);
        equipRows.push({
          id: ++equipRowSeq, fixed: true, fixedKey: def.key, name: def.name,
          variant, size: '', extra: def.extraToggle ? def.extraToggle.options[0] : '',
          condition: 'new', qty: 0, costPrice: cost, salePrice: sale,
        });
      });
    }
    renderEquipTable();
  }
  // 카탈로그 행에서 옵션 그룹 select 변경
  function onEquipOptionChange(rowId, label, value) {
    const r = equipRows.find(x => x.id === rowId);
    if (!r || !r.optionValues) return;
    r.optionValues[label] = value;
  }
  window.onEquipOptionChange = onEquipOptionChange;

  function addEquipRow() {
    equipRows.push({
      id: ++equipRowSeq,
      fixed: false,
      name:'', spec:'', condition:'new', qty:1, costPrice:0, salePrice:0,
    });
    renderEquipTable();
  }

  function removeEquipRow(id) {
    const r = equipRows.find(x => x.id === id);
    if (r && r.fixed) return; // 고정 행은 삭제 불가
    equipRows = equipRows.filter(x => x.id !== id);
    renderEquipTable();
  }

  function getFixedDef(key) { return FIXED_EQUIPMENT.find(d => d.key === key); }

  function onVariantChange(id, val) {
    const r = equipRows.find(x => x.id === id);
    if (!r) return;
    r.variant = val;
    const def = getFixedDef(r.fixedKey);
    if (def) {
      if (def.costPriceBy) r.costPrice = def.costPriceBy[val] || 0;
      if (def.salePriceBy) r.salePrice = def.salePriceBy[val] || 0;
    }
    renderEquipTable();
  }
  window.onVariantChange = onVariantChange;

  function renderEquipTable() {
    const tb = document.getElementById('equipTbody');
    if (!tb) return;
    const fixedRows = equipRows.filter(r => r.fixed);
    const customRows = equipRows.filter(r => !r.fixed);

    function rowHTML(r) {
      const total = (Number(r.qty) || 0) * (Number(r.salePrice) || 0);
      const isUnused = (Number(r.qty) || 0) === 0;
      const def = r.fixed ? getFixedDef(r.fixedKey) : null;

      // 품목 셀
      let nameCell;
      if (r.fixed && r.catalog) {
        // 카탈로그 기반 행 — 옵션 그룹별 select 자동 렌더
        const optionSelects = (r.options||[]).map(g => `
          <div style="margin-top:4px">
            <select onchange="onEquipOptionChange(${r.id}, '${(g.label||'').replace(/'/g,"\\'")}', this.value)" style="width:100%;padding:5px;border:1px solid var(--gray-200);border-radius:6px;font-size:11px">
              ${g.choices.map(c => `<option value="${escAttr(c)}" ${r.optionValues[g.label]===c?'selected':''}>${esc(g.label)}: ${esc(c)}</option>`).join('')}
            </select>
          </div>`).join('');
        const catBadge = r.category ? `<span style="background:#E5E7EB;color:#374151;font-size:9px;padding:1px 6px;border-radius:4px;margin-left:6px;font-weight:600">${esc(r.category)}</span>` : '';
        nameCell = `<div style="font-weight:700;color:${isUnused?'var(--gray-500)':'var(--gray-800)'}">${esc(r.name)}${catBadge}</div>${optionSelects}`;
      } else if (r.fixed) {
        // 레거시 FIXED_EQUIPMENT 행 — fallback 경로
        const variantSelect = (def && def.variants)
          ? `<select onchange="onVariantChange(${r.id}, this.value)" style="margin-top:4px;width:100%;padding:5px;border:1px solid var(--gray-200);border-radius:6px;font-size:11px">
              ${def.variants.map(v => `<option value="${v}" ${r.variant===v?'selected':''}>${v}</option>`).join('')}
            </select>` : '';
        const extraToggle = (def && def.extraToggle)
          ? `<div style="display:flex;gap:8px;margin-top:4px;font-size:11px">
              <span style="color:var(--gray-500);font-weight:600">${def.extraToggle.label}:</span>
              ${def.extraToggle.options.map(o => `<label style="display:inline-flex;align-items:center;gap:3px;cursor:pointer">
                <input type="radio" name="extra-${r.id}" ${r.extra===o?'checked':''} onchange="onEquipField(${r.id},'extra','${o}')">${o}
              </label>`).join('')}
            </div>` : '';
        const sizeInput = (def && def.hasSize)
          ? `<input type="text" placeholder="사이즈 (예: 1800×600)" value="${escAttr(r.size||'')}" oninput="onEquipField(${r.id},'size',this.value)" style="margin-top:4px;width:100%;padding:5px;border:1px solid var(--gray-200);border-radius:6px;font-size:11px">` : '';
        nameCell = `<div style="font-weight:700;color:${isUnused?'var(--gray-500)':'var(--gray-800)'}">🔒 ${esc(r.name)}</div>${variantSelect}${extraToggle}${sizeInput}`;
      } else {
        nameCell = `<input type="text" placeholder="품목명 (직접 입력)" value="${escAttr(r.name)}" oninput="onEquipField(${r.id},'name',this.value)" style="width:100%;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px">
          <input type="text" placeholder="규격 (선택)" value="${escAttr(r.spec||'')}" oninput="onEquipField(${r.id},'spec',this.value)" style="width:100%;margin-top:4px;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:11px">`;
      }

      const removeBtn = r.fixed
        ? '<span style="font-size:12px;color:var(--gray-300)" title="고정 품목은 삭제 불가">🔒</span>'
        : `<button type="button" onclick="removeEquipRow(${r.id})" title="행 삭제" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px">✕</button>`;

      return `<tr data-row="${r.id}" style="${isUnused?'background:#FAFAFA':''}">
        <td style="padding:6px;border-bottom:1px solid var(--gray-100);vertical-align:top">${nameCell}</td>
        <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:center;vertical-align:top">
          <label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;margin-right:4px">
            <input type="radio" name="cond-${r.id}" ${r.condition==='new'?'checked':''} onchange="onEquipField(${r.id},'condition','new')">신품
          </label>
          <label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;cursor:pointer">
            <input type="radio" name="cond-${r.id}" ${r.condition==='used'?'checked':''} onchange="onEquipField(${r.id},'condition','used')"><span style="color:var(--warning);font-weight:600">중고</span>
          </label>
        </td>
        <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:right;vertical-align:top">
          <input type="number" min="0" step="1" value="${r.qty}" oninput="onEquipField(${r.id},'qty',this.value)" style="width:60px;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;text-align:right">
        </td>
        <td class="js-cost-col" style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:right;vertical-align:top">
          <input type="number" min="0" step="100" value="${r.costPrice}" oninput="onEquipField(${r.id},'costPrice',this.value)" style="width:100px;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;text-align:right">
        </td>
        <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:right;vertical-align:top">
          <input type="number" min="0" step="100" value="${r.salePrice}" oninput="onEquipField(${r.id},'salePrice',this.value)" style="width:100px;padding:6px;border:1px solid var(--gray-200);border-radius:6px;font-size:12px;text-align:right">
        </td>
        <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:right;font-weight:700;color:var(--primary);vertical-align:top">${fmt(total)}</td>
        <td style="padding:6px;border-bottom:1px solid var(--gray-100);text-align:center;vertical-align:top">${removeBtn}</td>
      </tr>`;
    }

    let html = '';
    if (fixedRows.length) {
      html += `<tr style="background:#EFF6FF"><td colspan="7" style="padding:8px 12px;font-size:11px;font-weight:700;color:#1D4ED8">🔒 고정 품목 (수량만 입력)</td></tr>`;
      html += fixedRows.map(rowHTML).join('');
    }
    if (customRows.length) {
      html += `<tr style="background:#FEF3C7"><td colspan="7" style="padding:8px 12px;font-size:11px;font-weight:700;color:#92400E">＋ 추가 품목 (수기 입력)</td></tr>`;
      html += customRows.map(rowHTML).join('');
    }
    tb.innerHTML = html;

    // 합계
    const grand = equipRows.reduce((s, r) => s + (Number(r.qty)||0) * (Number(r.salePrice)||0), 0);
    const totalEl = document.getElementById('equipTotal');
    if (totalEl) totalEl.textContent = fmt(grand) + ' 원';
    updateJobSummary();
  }

  function onEquipPick() {} // legacy

  function onEquipField(id, field, val) {
    const r = equipRows.find(x => x.id === id);
    if (!r) return;
    if (['qty','costPrice','salePrice'].includes(field)) {
      r[field] = Math.max(0, parseInt(val, 10) || 0);
    } else {
      r[field] = val;
    }
    // 합계만 다시 계산 (포커스 보존을 위해 전체 재렌더는 피함)
    const tr = document.querySelector(`#equipTbody tr[data-row="${id}"]`);
    if (tr) {
      const totalCell = tr.children[6];
      if (totalCell) totalCell.textContent = fmt((Number(r.qty)||0) * (Number(r.salePrice)||0));
    }
    const grand = equipRows.reduce((s, x) => s + (Number(x.qty)||0) * (Number(x.salePrice)||0), 0);
    const totalEl = document.getElementById('equipTotal');
    if (totalEl) totalEl.textContent = fmt(grand) + ' 원';
    updateJobSummary();
  }

  function updateJobSummary() {
    const filled = equipRows.filter(r => r.name && r.qty > 0);
    const el = document.getElementById('job-equip-summary');
    if (!el) return;
    if (filled.length === 0) { el.textContent = '장비 미선택'; return; }
    const grand = filled.reduce((s, r) => s + (Number(r.qty)||0) * (Number(r.salePrice)||0), 0);
    const previewItems = filled.slice(0, 3).map(r => `${r.name}${r.condition==='used'?'(중고)':''} ${r.qty}`).join(' · ');
    const more = filled.length > 3 ? ` 외 ${filled.length - 3}` : '';
    el.textContent = `📦 ${previewItems}${more} · 합계 ${fmt(grand)}원`;
  }

  // 호환 alias (기존 코드가 호출 가능)
  window.selectBall = function(){};
  window.setCustomBall = function(){};
  window.addEquipRow = addEquipRow;
  window.removeEquipRow = removeEquipRow;
  window.onEquipPick = onEquipPick;
  window.onEquipField = onEquipField;

  function escAttr(s) { return String(s||'').replace(/"/g,'&quot;'); }

  /* ── 등록된 점포 (중복 체크용 시뮬레이션 데이터) ── */
  const registeredStores = new Set([
    '03275', '09913', '09361'  // 이미 등록된 거래처코드 예시
  ]);

  /* ── 기존 점포 전체 삭제 ── */
  function clearAllStores() {
    let cnt = 0;
    try { cnt = (JSON.parse(localStorage.getItem('ns_stores') || '[]')).length; } catch(e) {}
    if (!confirm(`저장된 점포 ${cnt.toLocaleString()}개를 모두 삭제하고 페이지를 새로고침합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`)) return;
    try {
      localStorage.removeItem('ns_stores');
      localStorage.setItem('ns_stores', '[]');
    } catch(e) {}
    try {
      const tb = document.getElementById('storeListTbody');
      if (tb) tb.innerHTML = '';
    } catch(e) {}
    alert(`🗑 ${cnt.toLocaleString()}개 점포를 모두 삭제했습니다. 페이지를 새로고침합니다.`);
    setTimeout(() => { location.reload(); }, 200);
  }

  /* ── 테스트 데이터 초기화 ── */
  function resetTestData(scope) {
    const KEYS = {
      stores: ['ns_stores'],
      jobs:   ['ns_jobs', 'ns_comments'],
      users:  ['ns_users', 'ns_allowed_emails'],
      all:    ['ns_stores', 'ns_jobs', 'ns_comments', 'ns_users', 'ns_allowed_emails'],
    };
    const labels = { stores:'점포', jobs:'일정/작업/AS', users:'직원/이메일', all:'전체 데이터' };
    const targets = KEYS[scope] || KEYS.all;
    const label = labels[scope] || '데이터';
    // 현재 카운트
    const counts = {};
    targets.forEach(k => {
      try {
        const v = localStorage.getItem(k);
        if (!v) { counts[k] = 0; return; }
        const arr = JSON.parse(v);
        counts[k] = Array.isArray(arr) ? arr.length : (v ? 1 : 0);
      } catch(e) { counts[k] = 0; }
    });
    const summary = targets.map(k => {
      const friendly = { ns_stores:'점포', ns_jobs:'일정/작업/AS', ns_comments:'작업 댓글', ns_users:'직원', ns_allowed_emails:'허용 이메일' }[k] || k;
      return `· ${friendly}: ${counts[k].toLocaleString()}건`;
    }).join('\n');
    if (!confirm(`${label}을(를) 모두 삭제합니다.\n\n${summary}\n\n이 작업은 되돌릴 수 없으며, 삭제 후 페이지가 새로고침됩니다.\n\n계속하시겠습니까?`)) return;
    // 한 번 더 확인 (전체일 때)
    if (scope === 'all' && !confirm('정말 모든 데이터를 삭제하시겠습니까? 마지막 확인입니다.')) return;
    targets.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
    alert(`✅ ${label} 초기화 완료. 페이지를 새로고침합니다.`);
    setTimeout(() => { location.reload(); }, 200);
  }
  window.resetTestData = resetTestData;

  /* ── 📥 전체 가맹점 엑셀 다운로드 (실제 .xlsx — SheetJS, 이미 로드됨) ── */
  window.exportStoresToExcel = function() {
    try {
      if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리 로드 실패 — 새로고침 후 다시 시도하세요.'); return; }
      const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
      if (!stores.length) { alert('내보낼 매장이 없습니다.'); return; }
      const fmtBiz = (typeof window._bizFmt === 'function') ? window._bizFmt : (v => String(v || ''));
      const rows = stores.map(s => ({
        '코드':           s.code || '',
        '점포명':         s.name || s.storeName || '',
        '간판명':         s.signageName || '',
        '사업자번호':     fmtBiz(s.biz || s.bizNo || s.bizno || ''),
        '대표자':         s.ceo || '',
        '대표자 연락처':  s.ceoTel || '',
        '매장 연락처':    s.tel || s.phone || '',
        '주소':           s.addr || s.address || '',
        'VAN사':          s.van || '',
        '상태':           s.status || '',
        '매장 등록일':    s.storeRegDate || '',
        '이카운트 등록일': s.ecountRegDate || '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{wch:10},{wch:24},{wch:16},{wch:14},{wch:10},{wch:15},{wch:15},{wch:36},{wch:8},{wch:8},{wch:12},{wch:13}];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '가맹점');
      const today = new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10);
      XLSX.writeFile(wb, `가맹점목록_${today}_${stores.length}개.xlsx`);
      try { if (typeof showToast === 'function') showToast(`📥 전체 가맹점 ${stores.length}개 엑셀 다운로드`); } catch(_){}
    } catch (e) {
      console.error('[exportStoresToExcel]', e);
      alert('엑셀 다운로드 실패: ' + (e.message || e));
    }
  };

  /* ── 엑셀 업로드 (실제 파일 + 진행 애니메이션) ── */
  function handleExcelFile(inputOrEvent) {
    const files = inputOrEvent.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    // 확장자 확인
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      alert('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }

    const dz = document.getElementById('excelDropZone');

    // ① 스피너 표시
    dz.innerHTML = `
      <div class="upload-spinner"></div>
      <div style="font-size:13px;font-weight:700;color:#166534;margin-top:2px">${file.name}</div>
      <div style="font-size:11px;color:#4ADE80;margin-top:4px">파일 읽는 중...</div>
      <div class="upload-progress-bar" style="width:200px;margin:10px auto 0">
        <div class="upload-progress-fill" id="excelProgressFill"></div>
      </div>
      <div style="font-size:10px;color:#86EFAC;margin-top:6px" id="excelProgressLabel">읽는 중 (${(file.size/1024).toFixed(0)} KB)</div>
    `;

    // ② FileReader로 실제 파일 읽기
    const reader = new FileReader();

    reader.onprogress = function(e) {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        const lbl = document.getElementById('excelProgressLabel');
        if (lbl) lbl.textContent = `읽는 중... ${pct}%`;
      }
    };

    reader.onload = function(e) {
      // ③ 읽기 완료 → 분석 중 메시지
      dz.innerHTML = `
        <div class="upload-spinner"></div>
        <div style="font-size:13px;font-weight:700;color:#166534;margin-top:2px">${file.name}</div>
        <div style="font-size:11px;color:#4ADE80;margin-top:4px">데이터 분석 중 · 중복 거래처코드 검사...</div>
      `;

      // ④ 파일 바이너리에서 행 수 추정 (실제 파싱 라이브러리 없이 근사치)
      const data = e.target.result;
      const bytes = new Uint8Array(data);
      // ZIP 시그니처(XLSX) 또는 XLS 시그니처 확인
      const isXlsx = bytes[0] === 0x50 && bytes[1] === 0x4B; // "PK"
      const isXls  = bytes[0] === 0xD0 && bytes[1] === 0xCF; // BIFF (OLE)
      // 이카운트 특성: HTML/XML 로 내보낸 .xls 파일도 허용
      let head = '';
      try {
        const sliceLen = Math.min(bytes.length, 2048);
        head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, sliceLen)).toLowerCase();
      } catch { head = ''; }
      const isHtmlXls = /<html|<table|<?xml|<workbook|mso-application/.test(head);

      if (!isXlsx && !isXls && !isHtmlXls) {
        dz.style.display = '';
        resetExcelUploadUI();
        alert('올바른 엑셀 파일(.xlsx/.xls)이 아닌 것 같습니다. 파일을 확인해 주세요.');
        return;
      }

      // 실제 XLSX 파싱 (SheetJS)
      let parsedRows = [];
      try {
        if (typeof XLSX === 'undefined') throw new Error('XLSX 라이브러리 로드 실패');
        const wb = XLSX.read(bytes, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        parsedRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      } catch (err) {
        dz.style.display = '';
        resetExcelUploadUI();
        alert('엑셀 파싱 실패: ' + err.message);
        return;
      }

      // 헤더 행 찾기 (이카운트는 1행 회사명 → 2행 헤더 → 3행~ 데이터인 경우가 있음)
      let headerIdx = -1;
      for (let i = 0; i < Math.min(parsedRows.length, 5); i++) {
        const joined = (parsedRows[i] || []).join('|');
        if (/거래처|점포|상호|사업자|대표/.test(joined)) { headerIdx = i; break; }
      }
      if (headerIdx < 0) headerIdx = 0;
      const header = (parsedRows[headerIdx] || []).map(h => String(h || '').trim());
      const dataRows = parsedRows.slice(headerIdx + 1).filter(r => (r || []).some(c => String(c || '').trim()));

      // 컬럼 인덱스 매핑
      const findCol = (patterns) => header.findIndex(h => patterns.some(p => h.includes(p)));
      const idxCode    = findCol(['거래처코드', '코드']);
      const idxName    = findCol(['거래처명', '점포명', '상호']);
      const idxSignage = findCol(['매장간판명', '간판명', '간판', '표시명']);
      const idxOwner   = findCol(['대표자', '대표']);
      const idxBizno   = findCol(['사업자번호', '사업자등록', '사업자']);
      const idxAddr    = findCol(['주소', '소재지']);
      const idxPhone   = findCol(['전화', '연락처', '휴대']);

      // 파싱된 점포 객체 목록
      const parsedStores = dataRows.map(r => ({
        code:        idxCode    >= 0 ? String(r[idxCode]    || '').trim() : '',
        name:        idxName    >= 0 ? String(r[idxName]    || '').trim() : '',
        signageName: idxSignage >= 0 ? String(r[idxSignage] || '').trim() : '',
        owner:       idxOwner   >= 0 ? String(r[idxOwner]   || '').trim() : '',
        bizno:       idxBizno   >= 0 ? String(r[idxBizno]   || '').trim() : '',
        address:     idxAddr    >= 0 ? String(r[idxAddr]    || '').trim() : '',
        phone:       idxPhone   >= 0 ? String(r[idxPhone]   || '').trim() : '',
      })).filter(s => s.name || s.code);

      const safeRows = parsedStores.length;

      // 다음 버튼용으로 임시 저장
      window._pendingImportStores = parsedStores;

      setTimeout(() => {
        // 기존 저장소와 중복 체크 (거래처코드 기준)
        const existing = getStores();
        const existingCodes = new Set(existing.map(s => (s.code || '').trim()).filter(Boolean));
        const duplicates = parsedStores
          .filter(s => s.code && existingCodes.has(s.code))
          .slice(0, 10)  // 상위 10건만 미리보기
          .map(s => ({ code: s.code, name: s.name, reason: '거래처코드 중복' }));
        const totalDupCount = parsedStores.filter(s => s.code && existingCodes.has(s.code)).length;

        const newCount = Math.max(0, safeRows - totalDupCount);

        dz.style.display = 'none';
        const preview = document.getElementById('excelPreview');
        preview.style.display = '';

        // 파일명 + 행수 업데이트
        const rowLabel = preview.querySelector('[style*="✅"]') || preview.querySelector('div[style*="font-size:12px"]');
        const firstInfoDiv = preview.querySelector('div[style*="justify-content:space-between"] div:first-child');
        if (firstInfoDiv) firstInfoDiv.textContent = `✅ ${safeRows.toLocaleString()}개 행 인식됨 — ${file.name}`;

        const dupWarning = document.getElementById('excelDupWarning');
        if (dupWarning && totalDupCount > 0) {
          dupWarning.innerHTML = `
            <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:12px 16px;margin-bottom:12px">
              <div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:8px">⚠ 중복 감지 — 총 ${totalDupCount}건은 등록하지 않음${duplicates.length < totalDupCount ? ` (아래 ${duplicates.length}건만 표시)` : ''}</div>
              ${duplicates.map(d => `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px;color:#92400E">
                  <span style="background:#FCD34D;color:#78350F;padding:1px 6px;border-radius:4px;font-weight:700;font-family:monospace">${d.code}</span>
                  <span style="font-weight:600">${d.name}</span>
                  <span style="color:#B45309">${d.reason}</span>
                </div>
              `).join('')}
              <div style="font-size:11px;color:#B45309;margin-top:8px;padding-top:8px;border-top:1px solid #FCD34D">
                ✅ 나머지 <b>${newCount.toLocaleString()}개</b> 점포는 정상 등록됩니다.
              </div>
            </div>
          `;
        } else if (dupWarning) {
          dupWarning.innerHTML = '';
        }

        const importBtn = document.getElementById('excelImportBtn');
        importBtn.style.display = '';
        importBtn.onclick = runExcelImport;
        importBtn.textContent = totalDupCount > 0
          ? `${newCount.toLocaleString()}개 점포 등록 (${totalDupCount}건 제외)`
          : `${safeRows.toLocaleString()}개 점포 일괄 등록`;
        document.getElementById('excelResetBtn').style.display = '';

        // 파일 input 초기화 (같은 파일 재선택 가능하게)
        document.getElementById('excelFileInput').value = '';
      }, 600);
    };

    reader.onerror = function() {
      dz.style.display = '';
      resetExcelUploadUI();
      alert('파일 읽기 오류가 발생했습니다. 다시 시도해 주세요.');
    };

    // 바이너리로 읽기 (파일 포맷 확인용)
    reader.readAsArrayBuffer(file);
  }

  function resetExcelUploadUI() {
    document.getElementById('excelFileInput').value = '';
  }

  /* ── 엑셀 일괄 등록 실행 (프로그래스 바 포함) ── */
  async function runExcelImport() {
    const pending = window._pendingImportStores || [];
    if (pending.length === 0) { alert('등록할 점포 데이터가 없습니다.'); return; }

    const existing = getStores();
    const existingCodes = new Set(existing.map(s => (s.code || '').trim()).filter(Boolean));
    const toInsert = pending.filter(s => !s.code || !existingCodes.has(s.code));
    const total = toInsert.length;
    if (total === 0) { alert('등록할 신규 점포가 없습니다 (모두 중복).'); return; }

    // 프로그래스 바 UI 주입
    const preview = document.getElementById('excelPreview');
    const importBtn = document.getElementById('excelImportBtn');
    const resetBtn = document.getElementById('excelResetBtn');
    if (importBtn) importBtn.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'none';

    let progressWrap = document.getElementById('excelImportProgress');
    if (!progressWrap) {
      progressWrap = document.createElement('div');
      progressWrap.id = 'excelImportProgress';
      progressWrap.style.cssText = 'margin-top:14px;padding:16px;border:1px solid var(--gray-200);border-radius:10px;background:#F9FAFB';
      preview.appendChild(progressWrap);
    }
    progressWrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;color:var(--gray-700)">📥 점포 등록 진행중...</div>
        <div style="font-size:12px;font-weight:700;color:var(--primary)" id="excelImportCountLabel">0 / ${total.toLocaleString()}</div>
      </div>
      <div style="width:100%;height:10px;background:var(--gray-200);border-radius:5px;overflow:hidden">
        <div id="excelImportBar" style="width:0%;height:100%;background:linear-gradient(90deg,#22C55E,#16A34A);transition:width 0.1s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <div style="font-size:11px;color:var(--gray-500)" id="excelImportPctLabel">0%</div>
        <div style="font-size:11px;color:var(--gray-400)" id="excelImportEtaLabel">남은 시간 계산 중...</div>
      </div>
      <div style="font-size:11px;color:var(--gray-500);margin-top:4px" id="excelImportCurrentLabel">—</div>
    `;

    const bar = document.getElementById('excelImportBar');
    const cntLbl = document.getElementById('excelImportCountLabel');
    const pctLbl = document.getElementById('excelImportPctLabel');
    const etaLbl = document.getElementById('excelImportEtaLabel');
    const curLbl = document.getElementById('excelImportCurrentLabel');

    const startTime = Date.now();
    const store = existing.slice();
    const batchSize = Math.max(1, Math.min(100, Math.ceil(total / 200)));

    const todayYmd = new Date().toISOString().slice(0,10);
    for (let i = 0; i < total; i++) {
      const s = toInsert[i];
      // 사업자번호 표준 포맷화 (10자리만)
      const bizDigits = String(s.bizno || '').replace(/\D/g,'');
      const bizFmt = bizDigits.length === 10
        ? `${bizDigits.slice(0,3)}-${bizDigits.slice(3,5)}-${bizDigits.slice(5,10)}`
        : (s.bizno || '');
      store.push({
        id: s.code ? ('EC-' + s.code) : ('EC-' + Date.now().toString().slice(-5) + i),
        code: s.code || '',
        name: s.name || '',
        signageName: s.signageName || '',  // 🪧 매장간판명 (이카운트 C열) — 검색·표시·매칭 보조키
        ceo:  s.owner || '',
        tel:  s.phone || '',
        biz:  bizFmt,
        addr: s.address || '',
        van:  '',
        tid:  '',
        pos:  '0',
        memo: '이카운트 일괄 업로드',
        status: '거래중',
        createdAt: Date.now(),
        storeRegDate: todayYmd,    // ← 매장 등록일 = 업로드 당일
      });

      if ((i + 1) % batchSize === 0 || i === total - 1) {
        const done = i + 1;
        const pct = (done / total) * 100;
        bar.style.width = pct.toFixed(1) + '%';
        cntLbl.textContent = `${done.toLocaleString()} / ${total.toLocaleString()}`;
        pctLbl.textContent = pct.toFixed(1) + '%';
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = done / Math.max(0.1, elapsed);
        const remain = Math.max(0, (total - done) / rate);
        etaLbl.textContent = `⏱ 남은 시간: 약 ${remain < 1 ? '1초' : Math.ceil(remain) + '초'} · ${Math.round(rate).toLocaleString()} 건/초`;
        curLbl.textContent = '현재: ' + (s.name || s.code || '—');
        // 매 배치마다 UI 이벤트 루프에 양보
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // 최종 저장
    saveStores(store);
    // 점포 목록 DOM 즉시 갱신
    try { if (typeof hydrateSavedStores === 'function') hydrateSavedStores(); } catch(e) {}

    // 완료 UI
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    progressWrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px">
        <div style="font-size:28px">✅</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:800;color:#166534">${total.toLocaleString()}개 점포 등록 완료</div>
          <div style="font-size:11px;color:#15803D;margin-top:2px">소요시간: ${elapsed}초 · 전체 저장된 점포: ${store.length.toLocaleString()}개</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="closeModal('excelUploadModal');hydrateSavedStores&&hydrateSavedStores();">점포 목록 보기</button>
      </div>
    `;

    if (typeof showToast === 'function') showToast(`✅ ${total}개 점포 등록 완료`);
    window._pendingImportStores = null;
  }

  function resetExcelUpload() {
    const dz = document.getElementById('excelDropZone');
    dz.style.display = '';
    dz.innerHTML = `
      <div style="font-size:36px;margin-bottom:10px">📊</div>
      <div style="font-size:14px;font-weight:700;color:#166534">ESA001M 엑셀을 여기에 끌어다 놓으세요</div>
      <div style="font-size:11px;color:#4ADE80;margin-top:4px">.xlsx · .xls 지원 · 1행 회사명 헤더 자동 건너뜀</div>
      <div style="font-size:11px;color:#86EFAC;margin-top:6px">또는</div>
      <button onclick="event.stopPropagation();document.getElementById('excelFileInput').click()" style="margin-top:8px;padding:6px 18px;background:#22C55E;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">파일 선택</button>
    `;
    document.getElementById('excelPreview').style.display = 'none';
    document.getElementById('excelResetBtn').style.display = 'none';
    document.getElementById('excelImportBtn').style.display = 'none';
    const dupWarning = document.getElementById('excelDupWarning');
    if (dupWarning) dupWarning.innerHTML = '';
  }

  function simulateExcelDownload() {
    alert('서식 파일 다운로드: ESA001M_template.xlsx\n\n이카운트 → 거래처관리 → 내보내기(ESA001M) 파일을 그대로 사용하셔도 됩니다.');
  }

  /* ── 모바일 드롭다운 메뉴 ── */
  // 로고 클릭 — 모바일에선 메뉴 토글, 데스크톱에선 대시보드
  // 모바일에서 로고 클릭 동작:
  //  - 메뉴 닫힌 상태 → 메뉴 열기
  //  - 메뉴 열린 상태 → 대시보드로 이동 (메뉴 닫힘)
  // 데스크톱: 항상 대시보드로 이동
  function onLogoClick() {
    if (window.innerWidth <= 768) {
      const menu = document.getElementById('mobileMenu');
      const isOpen = menu && menu.classList.contains('open');
      if (isOpen) {
        // 두 번째 탭 — 대시보드로 이동
        closeMenu();
        showScreen('dashboard');
      } else {
        // 첫 번째 탭 — 메뉴 열기
        toggleMenu();
      }
    } else {
      showScreen('dashboard');
    }
  }
  window.onLogoClick = onLogoClick;

  function toggleMenu() {
    const menu = document.getElementById('mobileMenu');
    const overlay = document.getElementById('menuOverlay');
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      menu.classList.remove('open');
      overlay.classList.remove('show');
      document.body.style.overflow = '';
    } else {
      menu.classList.add('open');
      overlay.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
  }
  function closeMenu() {
    document.getElementById('mobileMenu').classList.remove('open');
    document.getElementById('menuOverlay').classList.remove('show');
    document.body.style.overflow = '';
  }

  /* ── 음성 인식 (Web Speech API) ── */
  function startVoiceInput(inputId, btnEl) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('이 브라우저는 음성 인식을 지원하지 않습니다.\n(Chrome 모바일 권장)');
      return;
    }
    const recog = new SpeechRecognition();
    recog.lang = 'ko-KR';
    recog.interimResults = false;
    recog.maxAlternatives = 1;

    btnEl.classList.add('listening');
    btnEl.textContent = '🔴';

    recog.start();

    recog.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      const input = document.getElementById(inputId);
      if (input) input.value = transcript;
    };
    recog.onerror = (e) => {
      console.warn('음성 인식 오류:', e.error);
    };
    recog.onend = () => {
      btnEl.classList.remove('listening');
      btnEl.textContent = '🎙';
    };
  }

  /* ── 모바일: 음성 버튼 자동 표시 ── */
  function checkMobileVoice() {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
    document.querySelectorAll('.voice-btn.mobile-only').forEach(btn => {
      btn.style.display = isMobile ? 'flex' : 'none';
    });
  }
  checkMobileVoice();
  window.addEventListener('resize', checkMobileVoice);

  /* ── Ctrl+V 클립보드 붙여넣기 감지 ── */
  document.addEventListener('paste', function(e) {
    if (!document.getElementById('newStoreModal').classList.contains('show')) return;
    if (document.getElementById('dropZone').style.display === 'none') return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (!blob) { simulateCapture(); break; }
        const reader = new FileReader();
        reader.onload = (ev) => {
          capturedImageData = ev.target.result;
          if (getApiKey()) {
            runClaudeCapture(capturedImageData);
          } else {
            runDemoCapture();
          }
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  });

  /* ══════════════════════════════════
     대시보드 AI 분석 (하루 1회)
  ══════════════════════════════════ */

  function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function canRunAnalysis() {
    const lastRun = localStorage.getItem('neo_analysis_date');
    return lastRun !== getTodayStr();
  }

  // 페이지 로드 시 재분석 버튼 상태 초기화
  (function initAnalysisBtn() {
    if (!canRunAnalysis()) {
      const btn = document.getElementById('aiReanalysisBtn');
      if (btn) {
        btn.disabled = true;
        btn.title = '오늘 이미 분석했습니다. 내일 다시 사용 가능합니다.';
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
      }
      const saved = localStorage.getItem('neo_analysis_result');
      if (saved) {
        try { renderAnalysisResult(JSON.parse(saved)); } catch(e) {}
      }
    }
  })();

  async function runDashboardAnalysis() {
    if (!getApiKey()) {
      showToast('⚙️ 설정에서 Anthropic API 키를 먼저 입력하세요');
      showModal('settingsModal');
      return;
    }
    if (!canRunAnalysis()) {
      showToast('오늘 이미 분석 완료했습니다. 내일 다시 사용 가능합니다.');
      return;
    }

    const body = document.getElementById('aiAnalysisBody');
    const loading = document.getElementById('aiReanalysisLoading');
    const btn = document.getElementById('aiReanalysisBtn'); // 없을 수 있음 (관리자 페이지에서만 존재)
    const pf = document.getElementById('dashProgressFill');

    if (body) body.style.display = 'none';
    if (loading) loading.style.display = '';
    if (btn) btn.disabled = true;
    if (pf) {
      pf.style.animation = 'none'; void pf.offsetWidth;
      pf.style.animation = 'progress-bar 8s ease forwards';
    }

    const contextData = `
[현재 작업 현황]
- 이번달 신규: 7건 (지난달 대비 +2)
- 진행중 작업: 12건 (오늘 완료 예정 3건)
- AS 접수: 5건 (48시간 초과 2건 미배정)
- 장비 재고 부족: 3개 품목

[오늘 일정]
- 09:00 K-1마트 안중점 신규 설치 (POS 5대+저울+계산대 / 담당: 김현장) - 4/6단계 진행중
- 14:00 웰빙마트 신림점 VAN 교체 (KIS→KCP 단말 3대 / 담당: 이기사) - 예정
- 16:30 ECJ마트 AS 처리 (영수프린터 용지 걸림 / 담당: 박기사)

[AS 미처리 현황]
- 가평1번가마트: 바코드 스캐너 인식 불량 / 접수 04.17 / 72시간 경과 / 미배정 / 긴급
- ECJ마트: 영수프린터 용지 걸림 / 접수 04.18 / 48시간 경과 / 박기사 / 처리중

[재고 부족 품목]
- 서버용 PC 신품 (Intel i7-11세대): 재고 0 / 납기 7일
- 바코드프린터 (SRP-770 II): 재고 0
- 전자저울 (CAS DB-II 15kg): 재고 2개 (최소 재고 기준 미달)

[최근 완료 작업]
- 365할인마트 광적: 신규 04.18 / 김현장
- K-마트 오창점: POS교체 04.17 / 이기사
- L-마트 반포점: VAN교체 04.16 / 박기사
`;

    const prompt = `당신은 POS/VAN 설치 관리 회사의 운영 AI 어시스턴트입니다.
아래 현황 데이터를 분석하고 즉각적인 조치가 필요한 위험 항목과 주의 항목을 파악해주세요.

${contextData}

다음 JSON 형식으로만 응답해주세요:
{
  "summary": "한 문장 요약 (위험 N건, 주의 M건 식별 형식)",
  "items": [
    {
      "level": "danger|warning|info",
      "text": "구체적인 분석 내용 (2-3문장, 원인+영향+권고조치 포함)"
    }
  ]
}`;

    try {
      const text = await callClaude([{ role: 'user', content: prompt }], 1500);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('응답 파싱 실패');
      const result = JSON.parse(jsonMatch[0]);

      // 저장 (하루 1회)
      localStorage.setItem('neo_analysis_date', getTodayStr());
      localStorage.setItem('neo_analysis_result', JSON.stringify(result));
      document.getElementById('sampleDataBanner').style.display = 'none';

      renderAnalysisResult(result);

      // 버튼 비활성화 (요소 있을 때만)
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.title = '오늘 분석 완료. 내일 다시 사용 가능합니다.';
      }

    } catch(e) {
      console.error('[runDashboardAnalysis]', e);
      showToast('❌ 분석 오류: ' + (e && e.message ? e.message.slice(0, 100) : String(e).slice(0,100)));
    } finally {
      // 어떤 경우에도 loading 은 반드시 숨김 — 무한 분석중 상태 방지
      if (loading) loading.style.display = 'none';
      if (body) body.style.display = '';
      if (btn) btn.disabled = !canRunAnalysis();
    }
  }

  function renderAnalysisResult(result) {
    // 요약
    document.getElementById('aiSummaryBox').innerHTML = result.summary || '';
    document.getElementById('aiAnalysisTime').textContent =
      'Claude Sonnet • ' + new Date().toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) + ' 분석';

    // 항목 렌더링
    const container = document.getElementById('aiAnalysisItems');
    container.innerHTML = result.items.map(item => {
      const isDanger = item.level === 'danger';
      const bg = isDanger ? '#FEF2F2' : '#FFFBEB';
      const border = isDanger ? '#FECACA' : '#FDE68A';
      const iconBg = isDanger ? '#EF4444' : '#F59E0B';
      const textColor = isDanger ? '#7F1D1D' : '#78350F';
      const icon = isDanger ? '!' : '△';
      return `<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:${bg};border-radius:8px;border:1px solid ${border}">
        <div style="flex-shrink:0;width:22px;height:22px;background:${iconBg};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:800;margin-top:1px">${icon}</div>
        <div style="font-size:13px;color:${textColor};line-height:1.65">${item.text}</div>
      </div>`;
    }).join('');
  }

  /* ── 샘플 데이터 초기화 ── */
  function confirmClearSampleData() {
    if (!confirm('샘플 데이터를 모두 삭제하시겠습니까?\n\n• AI 분석 패널이 비워집니다\n• 저장된 분석 기록이 삭제됩니다\n\n이 작업은 되돌릴 수 없습니다.')) return;
    clearSampleData();
  }

  function clearSampleData() {
    // 분석 저장 데이터 삭제
    localStorage.removeItem('neo_analysis_result');
    localStorage.removeItem('neo_analysis_date');

    // 패널 초기화
    document.getElementById('aiAnalysisItems').innerHTML =
      `<div style="text-align:center;padding:28px;color:var(--gray-400)">
        <div style="font-size:28px;margin-bottom:8px">📊</div>
        <div style="font-size:13px;font-weight:600">분석 데이터가 없습니다</div>
        <div style="font-size:11px;margin-top:4px">↻ 재분석 버튼을 눌러 Claude Sonnet으로 분석을 시작하세요</div>
      </div>`;
    document.getElementById('aiSummaryBox').innerHTML = '재분석 버튼을 눌러 AI 분석을 시작하세요.';
    document.getElementById('sampleDataBanner').style.display = 'none';
    document.getElementById('aiAnalysisTime').textContent = 'Claude Sonnet · 분석 대기 중';

    // 재분석 버튼 활성화
    const btn = document.getElementById('aiReanalysisBtn');
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.title = '';

    showToast('샘플 데이터가 삭제되었습니다 ✅');
  }

  /* ══════════════════════════════════════════
     LINE 메시지 가져오기
  ══════════════════════════════════════════ */

  // 기본 채팅방 설정
  const DEFAULT_LINE_ROOMS = [
    { id: 'r1', name: 'AS접수방',    type: 'as' },
    { id: 'r2', name: '일정관리방',  type: 'schedule' },
    { id: 'r3', name: '업무지시방',  type: 'work' },
  ];

  function getLineRooms() {
    try {
      const saved = localStorage.getItem('neo_line_rooms');
      return saved ? JSON.parse(saved) : DEFAULT_LINE_ROOMS;
    } catch(e) { return DEFAULT_LINE_ROOMS; }
  }

  function saveLineRooms(rooms) {
    localStorage.setItem('neo_line_rooms', JSON.stringify(rooms));
  }

  let selectedRoomId = null;
  let lineParseData   = [];   // 분석 결과 저장

  function renderLineRoomChips() {
    const rooms = getLineRooms();
    const container = document.getElementById('lineRoomChips');
    if (!container) return;
    if (!selectedRoomId && rooms.length) selectedRoomId = rooms[0].id;

    const typeIcon = { as:'🔧', schedule:'📅', work:'📋', general:'💬' };
    container.innerHTML = rooms.map(r => `
      <div class="line-room-chip ${r.id === selectedRoomId ? 'active' : ''}"
           onclick="selectLineRoom('${r.id}')" id="chip-${r.id}">
        ${typeIcon[r.type] || '💬'} ${r.name}
        <span class="remove-btn" onclick="event.stopPropagation();removeLineRoom('${r.id}')" title="삭제">✕</span>
      </div>
    `).join('');
  }

  function selectLineRoom(id) {
    selectedRoomId = id;
    renderLineRoomChips();
  }

  function showAddRoomUI() {
    const f = document.getElementById('addRoomForm');
    f.style.display = f.style.display === 'none' ? '' : 'none';
    if (f.style.display !== 'none') document.getElementById('newRoomName').focus();
  }

  function addLineRoom() {
    const name = document.getElementById('newRoomName').value.trim();
    const type = document.getElementById('newRoomType').value;
    if (!name) { showToast('채팅방 이름을 입력하세요'); return; }
    const rooms = getLineRooms();
    const id = 'r' + Date.now();
    rooms.push({ id, name, type });
    saveLineRooms(rooms);
    selectedRoomId = id;
    document.getElementById('newRoomName').value = '';
    document.getElementById('addRoomForm').style.display = 'none';
    renderLineRoomChips();
    showToast(`'${name}' 채팅방이 추가되었습니다`);
  }

  function removeLineRoom(id) {
    if (!confirm('이 채팅방을 삭제하시겠습니까?')) return;
    const rooms = getLineRooms().filter(r => r.id !== id);
    saveLineRooms(rooms);
    if (selectedRoomId === id) selectedRoomId = rooms[0]?.id || null;
    renderLineRoomChips();
  }

  function initLineImportModal() {
    renderLineRoomChips();
    document.getElementById('lineParseResults').style.display = 'none';
    document.getElementById('lineParseLoading').style.display = 'none';
    document.getElementById('lineRegisterBtn').style.display = 'none';
    document.getElementById('lineRegisterCount').style.display = 'none';
    document.getElementById('lineAnalyzeBtn').style.display = '';
    document.getElementById('lineAnalyzeHint').style.display = '';
    lineParseData = [];
  }

  async function runLineImport() {
    const text = document.getElementById('linePasteArea').value.trim();
    if (!text) { showToast('대화 내용을 붙여넣어 주세요'); return; }
    if (!selectedRoomId) { showToast('채팅방을 먼저 선택하세요'); return; }
    if (!getApiKey()) {
      showToast('⚙️ AI 설정에서 API 키를 먼저 입력하세요');
      closeModal('lineImportModal');
      setTimeout(() => showModal('settingsModal'), 300);
      return;
    }

    const rooms = getLineRooms();
    const room  = rooms.find(r => r.id === selectedRoomId);
    const roomTypeLabel = { as:'AS/작업 접수 목적', schedule:'일정 관리 목적', work:'업무 지시 목적', general:'일반 대화', equip_out:'장비 출고 목적', delivery:'택배 관리 목적', label:'라벨지 작업 목적' }[room?.type] || '일반';

    // UI 전환
    document.getElementById('lineAnalyzeBtn').style.display = 'none';
    document.getElementById('lineAnalyzeHint').style.display = 'none';
    document.getElementById('lineParseLoading').style.display = '';
    document.getElementById('lineParseResults').style.display = 'none';
    const pf = document.getElementById('lineProgressFill');
    pf.style.animation = 'none'; void pf.offsetWidth;
    pf.style.animation = 'progress-bar 6s ease forwards';

    const prompt = `당신은 POS/VAN 설치·AS 관리 회사의 운영 어시스턴트입니다.
아래는 '${room?.name || '채팅방'}' (${roomTypeLabel}) Line 그룹 채팅 내용입니다.

각 메시지를 분석해서 업무적으로 의미 있는 항목을 추출하고 8개 카테고리 중 하나로 분류해 주세요.

## 카테고리 (필수)
1. **pos_as** — POS A/S: POS 단말기·키오스크 고장, 영수증/주방프린터 이슈, POS SW 오류, 매장 방문 수리 요청·완료 등
2. **van_as** — VAN A/S: 카드결제기(VAN 단말기) 통신 오류, IC/리더기 인식 불량, 체크기 오류, 결제 단말 교체 등
3. **device_mgmt** — 단말기 A/S: 이동단말기(휴대용/무선) AS·수리완료·대체품 회수/발송·신규개통·전산등록·발주·반품·SN 관리, 라우터 설치 등
4. **open_store** — 오픈 작업: 신규 매장 설치, 키오스크/POS 설치·세팅, 가오픈/오픈 일정, 미설치 잔여 작업, 인터넷 연결 후 재방문 등 매장 오픈 관련 모든 진행 업무
5. **van_doc** — 밴서류 작업: 신용카드 가맹점 신청·심사·완료, 가맹점번호 발급, 결제계좌 변경, 상호변경, 주소변경, 대표자 변경, 제신고, [Web발신] 자동완료 알림 등 서류성 업무
6. **label** — 라벨지: 라벨지 발주·출고·재고 관련
7. **equip_out** — 장비 출고: 장비 출고·발주·반품 (단말기 외 일반 장비)
8. **delivery** — 택배: 택배 발송·수령·반품
9. **ignore** — 단순 인사, 확인 응답, 관련 없는 잡담, 파일 공유 알림

## A/S 구분 가이드
- POS 본체/키오스크/영수증프린터 → **pos_as**
- 카드결제기/VAN 통신/IC 리더기 → **van_as**
- 이동단말기/무선단말기/핸드스캐너/PDA → **device_mgmt**
- "체크기" 단독 표현은 보통 VAN 단말기 → **van_as**

## 단일 매장에 여러 카드사 상태가 묶인 경우 (예: "우리 - 심사중 / 나머지 완료")
→ **하나의 항목**으로 처리 (van_doc), parsed 필드에 모든 카드사 상태를 요약

## 정형 양식 (단말기 A/S 수리완료) — 번호 매김 1~8 으로 시작하는 블록
→ **device_mgmt** + status='완료' 로 분류, parsed 에 모델/SN/증상 요약

## 핵심 규칙
- 헤더 메시지(예: "* 신규", "* 제신고") 그 자체는 ignore, 다음 메시지의 분류 힌트로만 사용
- 같은 매장 + 같은 작업의 후속 보고(예: "10:15 단말기 5대 추가 검토" 후속) → 같은 항목으로 묶어도 됨
- 시간/날짜는 'HH:MM' 또는 'YY.MM.DD' 형식으로 추출
- status 는 '신규접수' / '진행중' / '완료' / '재방문필요' / '심사중' 중 하나

## JSON 응답 형식 (다른 텍스트 없이 JSON만, 최대 20개)
{
  "summary": "총 N건: POS A/S A · VAN A/S B · 단말기 C · 오픈 D · 밴서류 E · 라벨지 F · 장비출고 G · 택배 H",
  "items": [
    {
      "type": "pos_as|van_as|device_mgmt|open_store|van_doc|label|equip_out|delivery|ignore",
      "status": "신규접수|진행중|완료|재방문필요|심사중",
      "sender": "발신자",
      "time": "HH:MM",
      "store": "매장명 (추출 가능 시, 없으면 null)",
      "assignee": "담당자/엔지니어 (있으면, 없으면 null)",
      "device": "단말기 모델·SN (해당 시, 없으면 null)",
      "request": "요청·증상 내용 요약 (80자 이내)",
      "parsed": "핵심 요약: 매장·내용·상태·후속조치 (120자 이내)",
      "original": "원문 첫 60자"
    }
  ]
}

채팅 내용:
${text.slice(0, 4000)}`;

    try {
      const response = await callClaude([{ role:'user', content: prompt }], 8000);
      console.log('[Line Import] Claude 응답:', response);

      // 코드펜스 제거 + JSON 추출
      let raw = String(response || '').trim();
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const startIdx = raw.indexOf('{');
      if (startIdx < 0) {
        console.error('[Line Import] JSON 미발견 응답:', response);
        throw new Error('Claude 응답에 JSON이 없습니다');
      }
      let jsonStr = raw.slice(startIdx);
      let result;
      try { result = JSON.parse(jsonStr); }
      catch (pe) {
        console.warn('[Line Import] 1차 파싱 실패, 복구 시도:', pe.message);
        // 잘림 복구: 마지막 완전한 } 까지만 사용 + 배열·객체 닫기
        const salvaged = _salvageJson(jsonStr);
        try {
          result = JSON.parse(salvaged);
          console.log('[Line Import] 복구 성공');
        } catch (pe2) {
          console.error('[Line Import] 복구 실패:', pe2, salvaged.slice(-200));
          throw new Error('JSON 파싱 실패 (응답 잘림): ' + pe.message);
        }
      }

      lineParseData = (result.items || []).map((item, i) => {
        // 자동 매칭 — 동일 매장의 기존 미완료 작업이 있으면 update 액션 추천
        let matchedJob = null;
        try { matchedJob = _findMatchingJob(item); }
        catch (me) { console.warn('[Line Import] 매칭 실패:', me, item); }
        let action = 'new';
        if (item.type === 'ignore')      action = 'skip';
        else if (matchedJob)             action = 'update';
        return {
          ...item,
          id: i,
          checked: item.type !== 'ignore',
          action,
          targetJobId: matchedJob ? matchedJob.id : '',
          targetJobLabel: matchedJob ? `${matchedJob.store||matchedJob.storeName||''} · ${matchedJob.type||''}` : '',
        };
      });

      renderLineParseResults(result.summary);

    } catch(e) {
      console.error('[Line Import] 분석 오류:', e);
      const msg = (e && e.message) ? String(e.message) : String(e);
      showToast('❌ 분석 오류: ' + msg.slice(0,120));
      document.getElementById('lineAnalyzeBtn').style.display = '';
      document.getElementById('lineAnalyzeHint').style.display = '';
      document.getElementById('lineParseLoading').style.display = 'none';
    }

    document.getElementById('lineParseLoading').style.display = 'none';
  }

  // Line 카테고리 → 기존 메뉴 매핑
  //   menu: 'asmgmt' 또는 'newopen' — 등록 후 어느 화면에서 보일지
  //   jobType: 화면 필터 정규식과 매칭되어야 함 (/as|에이에스/i 또는 /신규|개업|오픈/)
  //   lineCategory: job 객체에 저장되어 화면 안에서 세부 구분 뱃지로 표시
  const LINE_TYPE_META = {
    pos_as:       { label:'🖥 POS A/S',       bg:'#FEF3C7', color:'#92400E', jobType:'AS 처리',     menu:'asmgmt' },
    van_as:       { label:'💳 VAN A/S',       bg:'#FFE4E6', color:'#9F1239', jobType:'AS 처리',     menu:'asmgmt' },
    device_mgmt:  { label:'📱 단말기 A/S',    bg:'#D1FAE5', color:'#065F46', jobType:'AS 처리',     menu:'asmgmt' },
    open_store:   { label:'🏪 오픈 작업',     bg:'#DBEAFE', color:'#1D4ED8', jobType:'신규',         menu:'newopen' },
    van_doc:      { label:'📑 밴서류',        bg:'#EDE9FE', color:'#5B21B6', jobType:'신규가맹',     menu:'newopen' },
    label:        { label:'🏷 라벨지',        bg:'#FEE2E2', color:'#991B1B', jobType:'라벨지',       menu:'jobs' },
    equip_out:    { label:'📦 장비 출고',     bg:'#FFEDD5', color:'#9A3412', jobType:'장비출고',     menu:'jobs' },
    delivery:     { label:'🚚 택배',          bg:'#FAE8FF', color:'#86198F', jobType:'택배',         menu:'jobs' },
    ignore:       { label:'⚪ 기타',          bg:'#F3F4F6', color:'#6B7280', jobType:null,          menu:null },
    // 구버전 호환 — 기존 데이터 표시용
    as_pos_van:   { label:'🛠 A/S (POS/VAN)', bg:'#FEF3C7', color:'#92400E', jobType:'AS 처리',     menu:'asmgmt' },
  };
  // 구버전 → 신버전 마이그레이션 (저장 시 변환)
  function migrateLineCategory(v){
    return v === 'as_pos_van' ? 'pos_as' : v;
  }

  /* 잘린 JSON 복구 — 마지막 완전한 항목까지 살린 뒤 배열·객체 닫기 */
  function _salvageJson(s) {
    // 마지막 완전한 } 위치 찾기 (문자열 내부 무시)
    let depth = 0, inStr = false, esc = false, lastGoodObjEnd = -1;
    let arrayStart = -1, objStart = s.indexOf('{');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '[' && arrayStart < 0) arrayStart = i;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 1 && arrayStart >= 0) lastGoodObjEnd = i; }
    }
    if (lastGoodObjEnd < 0) {
      // items 배열 시작 전에 잘림 — 빈 items 반환
      return '{"summary":"부분 응답","items":[]}';
    }
    // 마지막 완전한 항목까지 자르고 ]} 닫기
    let truncated = s.slice(0, lastGoodObjEnd + 1) + ']}';
    return truncated;
  }

  /* Line 항목에 매칭되는 기존 미완료 작업 찾기 — 동일 매장 + 호환 유형 */
  function _findMatchingJob(item) {
    if (!item || !item.store) return null;
    const wantNorm = String(item.store||'').toLowerCase().replace(/\s+/g,'');
    if (!wantNorm) return null;
    const jobs = (typeof getJobs === 'function') ? (getJobs() || []) : [];
    const isDone = (j) => /완료|done|처리완료/i.test(j.status||'');

    // 카테고리 → 작업 유형 매핑 (호환 가능한 유형 집합)
    const compatTypes = {
      pos_as:      [/POS\s*AS|AS|에이에스/i],
      van_as:      [/VAN\s*AS|AS|에이에스/i],
      as_pos_van:  [/AS|에이에스/i],   // 구버전 호환
      open_store:  [/신규|개업|오픈|POS\s*교체|VAN\s*변경|SW\s*변경|당사매장/i],
      van_doc:     [/신규가맹|신규|VAN|밴서류|상호변경|주소변경|계좌변경|정보변경|재신고/i],
      device_mgmt: [/장비|단말|개통|이동단말기|AS|에이에스/i],
      label:       [/라벨/i],
      equip_out:   [/출고|발주|반품|장비/i],
      delivery:    [/택배|배송/i],
    };
    const pats = compatTypes[item.type] || [];

    // 매장명 매칭 + 미완료 + 호환 유형 — 최근 createdAt 우선
    const candidates = jobs.filter(j => {
      if (isDone(j)) return false;
      const aliases = Array.isArray(j.aliases) ? j.aliases : [];
      const names = [j.store, j.storeName, ...aliases].filter(Boolean);
      const nameMatch = names.some(n => {
        const nn = String(n).toLowerCase().replace(/\s+/g,'');
        return nn === wantNorm || nn.includes(wantNorm) || wantNorm.includes(nn);
      });
      if (!nameMatch) return false;
      return pats.some(p => p.test(j.type||''));
    });
    if (candidates.length === 0) return null;
    candidates.sort((a,b) => (Number(b.createdAt)||0) - (Number(a.createdAt)||0));
    return candidates[0];
  }
  window._findMatchingJob = _findMatchingJob;

  function renderLineParseResults(summary) {
    document.getElementById('lineResultSummary').textContent = summary || '';
    document.getElementById('lineParseResults').style.display = '';

    document.getElementById('lineItemList').innerHTML = lineParseData.map(item => {
      const meta = LINE_TYPE_META[item.type] || LINE_TYPE_META.ignore;
      const isIgnore = item.type === 'ignore';
      // 액션 선택기 — 매칭된 기존 작업이 있으면 update 옵션 노출
      const hasMatch = !!item.targetJobId;
      const actionSelector = isIgnore ? '' : `
        <div style="display:flex;align-items:center;gap:5px;margin-top:4px;flex-wrap:wrap" onclick="event.stopPropagation()">
          <span style="font-size:11px;color:var(--gray-500);font-weight:600">처리:</span>
          <select onchange="setLineAction(${item.id}, this.value)" style="font-size:11px;padding:3px 6px;border:1px solid var(--gray-300);border-radius:6px;background:#fff;font-weight:600">
            <option value="new"    ${item.action==='new'?'selected':''}>＋ 새 작업으로 등록</option>
            ${hasMatch ? `<option value="update" ${item.action==='update'?'selected':''}>↻ 기존 작업 업데이트 (${esc(item.targetJobLabel)})</option>` : ''}
            <option value="skip"   ${item.action==='skip'?'selected':''}>✕ 건너뛰기</option>
          </select>
          ${hasMatch && item.action==='update' ? `<span style="font-size:10px;color:var(--success);font-weight:600">→ ${esc(item.targetJobLabel)} 기록 추가</span>` : ''}
          ${hasMatch && item.action==='new' ? `<span style="font-size:10px;color:var(--warning);font-weight:600">⚠ 동일 매장 기존 작업이 있습니다</span>` : ''}
        </div>`;
      // 카테고리 변경 드롭다운 — 분류 버튼 클릭 시 다른 카테고리로 즉시 전환
      const catSelector = `
        <select onclick="event.stopPropagation()" onchange="setLineCategory(${item.id}, this.value)"
                style="background:${meta.bg};color:${meta.color};font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid ${meta.color};cursor:pointer">
          <option value="pos_as"      ${item.type==='pos_as'||item.type==='as_pos_van'?'selected':''}>🖥 POS A/S</option>
          <option value="van_as"      ${item.type==='van_as'?'selected':''}>💳 VAN A/S</option>
          <option value="device_mgmt" ${item.type==='device_mgmt'?'selected':''}>📱 단말기 A/S</option>
          <option value="open_store"  ${item.type==='open_store'?'selected':''}>🏪 오픈 작업</option>
          <option value="van_doc"     ${item.type==='van_doc'?'selected':''}>📑 밴서류</option>
          <option value="label"       ${item.type==='label'?'selected':''}>🏷 라벨지</option>
          <option value="equip_out"   ${item.type==='equip_out'?'selected':''}>📦 장비 출고</option>
          <option value="delivery"    ${item.type==='delivery'?'selected':''}>🚚 택배</option>
          <option value="ignore"      ${item.type==='ignore'?'selected':''}>⚪ 기타/무시</option>
        </select>`;
      return `
      <div class="line-parse-item ${item.checked ? 'checked' : ''}"
           style="border-left:4px solid ${meta.color};${item.checked && !isIgnore?'background:#F0FDF4':''}"
           id="litem-${item.id}" onclick="toggleLineItem(${item.id})">
        <input type="checkbox" ${item.checked ? 'checked' : ''}
               onclick="event.stopPropagation();toggleLineItem(${item.id})"
               style="margin-top:3px;flex-shrink:0;width:15px;height:15px;accent-color:#06C755">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
            ${catSelector}
            ${item.status ? `<span style="background:#fff;border:1px solid var(--gray-300);color:var(--gray-700);font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px">${esc(item.status)}</span>` : ''}
            <span class="line-msg-sender">${esc(item.sender || '')}${item.time ? ' · ' + esc(item.time) : ''}</span>
            ${item.store ? `<span style="font-size:11px;background:#EEF2FF;color:#3730A3;padding:1px 7px;border-radius:8px;font-weight:600">🏪 ${esc(item.store)}</span>` : ''}
            ${item.assignee ? `<span style="font-size:11px;background:#FEF3C7;color:#92400E;padding:1px 7px;border-radius:8px;font-weight:600">👤 ${esc(item.assignee)}</span>` : ''}
            ${item.device ? `<span style="font-size:11px;background:#F0FDF4;color:#065F46;padding:1px 7px;border-radius:8px;font-weight:600;font-family:monospace">📱 ${esc(item.device)}</span>` : ''}
          </div>
          ${item.parsed ? `<div class="line-msg-parsed" style="font-size:12px;color:var(--gray-700);margin-bottom:2px">→ ${esc(item.parsed)}</div>` : ''}
          <div class="line-msg-text" style="font-size:11px;color:var(--gray-400)">${esc(item.original || item.request || '')}</div>
          ${actionSelector}
        </div>
      </div>`;
    }).join('');

    updateLineRegisterCount();
  }

  function toggleLineItem(id) {
    const item = lineParseData.find(i => i.id === id);
    if (!item) return;
    item.checked = !item.checked;
    const el = document.getElementById('litem-' + id);
    if (el) {
      el.classList.toggle('checked', item.checked);
      el.querySelector('input[type=checkbox]').checked = item.checked;
    }
    updateLineRegisterCount();
  }

  /* 개별 항목 카테고리 변경 — A/S, 오픈, 밴서류, 단말기 사이 자유 전환 */
  function setLineCategory(id, type) {
    const item = lineParseData.find(i => i.id === id);
    if (!item) return;
    item.type = type;
    if (type === 'ignore') {
      item.checked = false;
      item.action = 'skip';
      item.targetJobId = '';
      item.targetJobLabel = '';
    } else {
      // 카테고리가 바뀌면 매칭 재시도
      const match = (typeof _findMatchingJob === 'function') ? _findMatchingJob(item) : null;
      item.targetJobId = match ? match.id : '';
      item.targetJobLabel = match ? `${match.store||match.storeName||''} · ${match.type||''}` : '';
      item.action = match ? 'update' : 'new';
      item.checked = true;
    }
    renderLineParseResults(document.getElementById('lineResultSummary').textContent);
  }
  window.setLineCategory = setLineCategory;

  /* 개별 항목 처리 방식 변경 — '신규/업데이트/건너뛰기' */
  function setLineAction(id, action) {
    const item = lineParseData.find(i => i.id === id);
    if (!item) return;
    item.action = action;
    if (action === 'skip') item.checked = false;
    else item.checked = true;
    renderLineParseResults(document.getElementById('lineResultSummary').textContent);
  }
  window.setLineAction = setLineAction;

  function selectAllLineItems(val) {
    lineParseData.forEach(item => { item.checked = val; });
    renderLineParseResults(document.getElementById('lineResultSummary').textContent);
  }

  function updateLineRegisterCount() {
    const checked = lineParseData.filter(i => i.checked && i.type !== 'ignore');
    const countEl = document.getElementById('lineRegisterCount');
    const btnEl   = document.getElementById('lineRegisterBtn');
    if (checked.length > 0) {
      countEl.textContent = `${checked.length}건 선택됨`;
      countEl.style.display = '';
      btnEl.style.display = '';
    } else {
      countEl.style.display = 'none';
      btnEl.style.display = 'none';
    }
  }

  /* 파싱된 항목을 즉시 등록하지 않고 'Line 등록 대기 큐'에 푸시 — 직원 검토 후 승인 */
  async function registerLineItems() {
    const toRegister = lineParseData.filter(i => i.checked && i.action !== 'skip' && i.type !== 'ignore');
    if (!toRegister.length) { showToast('등록할 항목이 없습니다'); return; }

    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const kstNow = (() => {
      const d = new Date();
      const p = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(d);
      return p.replace('T',' ').replace(',',' ');
    })();
    const room = (getLineRooms() || []).find(r => r.id === selectedRoomId);

    // 매장 자동 매칭 (이름 기반)
    const norm = (s) => String(s||'').toLowerCase().replace(/\s+/g,'');
    const findStore = (name) => {
      if (!name) return null;
      const wn = norm(name);
      return stores.find(s => {
        if (norm(s.name) === wn || norm(s.name).includes(wn) || wn.includes(norm(s.name))) return true;
        const aliases = Array.isArray(s.aliases) ? s.aliases : [];
        return aliases.some(a => norm(a) === wn);
      }) || null;
    };

    // 라인 메시지 시각 → ISO 추정 (HH:MM 만 있으면 오늘 KST 로 합성)
    const buildLineMsgAt = (item) => {
      const t = String(item.time||'').trim();
      const todayKst = kstNow.slice(0,10);
      if (/^\d{2}:\d{2}$/.test(t)) return `${todayKst} ${t}`;
      if (/^\d{2}\.\d{2}\.\d{2}/.test(t)) {
        const [d, hm] = t.split(/\s+/);
        const [y, mo, da] = d.split('.');
        return `20${y}-${mo}-${da} ${hm||'00:00'}`;
      }
      return kstNow;
    };

    const pendingItems = toRegister.map((item, idx) => {
      const storeMatch = findStore(item.store);
      // 상태 정규화 (라인 status → 진행상태 토글)
      let status = '접수';
      if (item.status === '완료') status = '완료';
      else if (item.status === '진행중') status = '진행중';
      else if (item.status === '재방문필요' || item.status === '심사중') status = '추가처리';

      return {
        id: `pend-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2,6)}`,
        lineMsgAt:    buildLineMsgAt(item),
        lineSender:   item.sender || '',
        lineRoom:     room?.name || selectedRoomId || '',
        lineRoomId:   selectedRoomId || '',
        lineCategory: item.type,
        lineRaw:      item.original || '',
        lineParsed:   item.parsed || '',
        lineRequest:  item.request || '',
        lineDevice:   item.device || '',
        store:        item.store || '',
        storeId:      storeMatch ? storeMatch.id : '',
        assignee:     item.assignee || '',
        status,
        memo:         '',
        action:       item.action || 'new',
        targetJobId:  item.targetJobId || '',
      };
    });

    try {
      const res = await fetch('/api/line-pending', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: pendingItems }),
      });
      const data = await res.json();
      showToast(`✅ ${data.added || pendingItems.length}건 등록 대기 큐에 추가됨 — 대시보드에서 검토`);
      closeModal('lineImportModal');
      refreshLinePendingBanner();
    } catch(e) {
      console.error('[Line Pending] add 실패:', e);
      showToast('❌ 등록 대기 큐 저장 실패: ' + e.message);
    }
  }

  /* ════════════════════════════════════════
     Line 등록 대기 큐 — 대시보드 배너 + 검토 모달
  ════════════════════════════════════════ */
  let _linePending = [];
  let _linePendingFilter = 'all';   // Line 등록대기 — 카테고리 필터 (all | lineCategory)
  window.setLinePendingFilter = function(cat) {
    _linePendingFilter = cat || 'all';
    try { renderLinePendingList(); } catch(_){}
  };

  async function refreshLinePendingBanner() {
    try {
      const res = await fetch('/api/line-pending');
      const data = await res.json();
      _linePending = data.items || [];
      // 대시보드 배너
      const banner = document.getElementById('linePendingBanner');
      const countEl = document.getElementById('linePendingCount');
      if (banner && countEl) {
        if (_linePending.length > 0) {
          banner.style.display = 'flex';
          countEl.textContent = _linePending.length;
        } else {
          banner.style.display = 'none';
        }
      }
      // 작업/일정 페이지 패널
      const jobsPanel = document.getElementById('jobsLinePendingPanel');
      const jobsCount = document.getElementById('jobsLinePendingCount');
      const jobsPreview = document.getElementById('jobsLinePendingPreview');
      if (jobsPanel && jobsCount) {
        if (_linePending.length > 0) {
          jobsPanel.style.display = '';
          jobsCount.textContent = _linePending.length;
          if (jobsPreview) {
            // 카테고리별 카운트
            const byCat = {};
            _linePending.forEach(p => { byCat[p.lineCategory] = (byCat[p.lineCategory]||0)+1; });
            const chips = Object.entries(byCat).map(([cat, n]) => {
              const m = LINE_TYPE_META[cat] || LINE_TYPE_META.ignore;
              return `<span style="background:rgba(255,255,255,0.25);padding:3px 9px;border-radius:10px;font-weight:600">${m.label} ${n}</span>`;
            }).join('');
            // 최근 매장 미리보기 (최대 3건)
            const recent = _linePending.slice(0,3).map(p => esc(p.store || '?')).join(' · ');
            jobsPreview.innerHTML = chips + (recent ? `<span style="opacity:0.8;margin-left:auto">최근: ${recent}</span>` : '');
          }
        } else {
          jobsPanel.style.display = 'none';
        }
      }
    } catch(e) { console.warn('[Line Pending] 배너 조회 실패:', e); }
  }
  window.refreshLinePendingBanner = refreshLinePendingBanner;

  /* 페이지 로드 후 5분마다 자동 폴링 — 다른 사용자가 cron 으로 추가한 항목도 자동 반영 */
  let _linePendingPollTimer = null;
  function startLinePendingPolling() {
    if (_linePendingPollTimer) return;
    refreshLinePendingBanner();
    _linePendingPollTimer = setInterval(refreshLinePendingBanner, 5 * 60 * 1000);
  }
  // 로그인 후 자동 시작 — DOMContentLoaded 또는 즉시
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(startLinePendingPolling, 2000));
  } else {
    setTimeout(startLinePendingPolling, 2000);
  }

  async function refreshLinePending() {
    await refreshLinePendingBanner();
    renderLinePendingList();
  }
  window.refreshLinePending = refreshLinePending;

  async function openLinePendingReview() {
    showModal('linePendingReviewModal');
    await refreshLinePending();
  }
  window.openLinePendingReview = openLinePendingReview;

  const PENDING_STATUS_CYCLE = ['접수', '진행중', '추가처리', '완료'];
  const PENDING_STATUS_META = {
    '접수':   { bg:'#FEF3C7', color:'#92400E', icon:'📨' },
    '진행중': { bg:'#DBEAFE', color:'#1D4ED8', icon:'⚙️' },
    '추가처리':{ bg:'#FCE7F3', color:'#9D174D', icon:'🔄' },
    '완료':   { bg:'#D1FAE5', color:'#065F46', icon:'✅' },
  };

  /* ── 글로벌 헬퍼 ─────────────────────────────────────────────
     모든 작업의 "완료 여부" 판정은 반드시 이 함수 사용.
     완료 상태 종류:
       - '완료'      : 신규/오픈/밴서류 등 일반 작업의 완료
       - '처리완료'  : A/S·단말기·POS·VAN 처리의 완료
       - 'done'      : 영문 호환 (구버전)
     [규칙] j.status === '완료' 같은 인라인 체크 금지 — _isJobDone(j) 사용
  ─────────────────────────────────────────────────────────────*/
  /* 🎯 _isJobEffectivelyDone(j) — status 문자열 OR thread ROOT 전체 완료 검사
     예: AS job 의 모든 ROOT 가 child '완료' 가지면 status='접수' 라도 effectively done.
     사용처: 대시보드/리스트의 미완료 필터 — 옛날 데이터의 stale status 도 정확히 처리.
     단, 신규(new) 카테고리는 openDate 가드 적용 (미래/오늘이면 effectively done 아님). */
  window._isJobEffectivelyDone = function(j) {
    if (!j) return false;
    // 1) status 가 명시적으로 완료면 done
    const s = String(j.status || '');
    if (s === '완료' || s === '처리완료' || s === 'done') return true;
    // 2) thread 기반 검사 — 모든 ROOT 가 child '완료' 가짐
    const thread = Array.isArray(j.thread) ? j.thread : [];
    if (thread.length === 0) return false;
    const norm = (typeof window._threadMigrate === 'function') ? window._threadMigrate(thread) : thread;
    const roots = norm.filter(e => e && e.parentId == null);
    if (roots.length === 0) return false;
    const allRootsDone = roots.every(r => {
      const kids = norm.filter(e => e.parentId === r.threadId);
      return kids.some(k => k.status === '완료');
    });
    if (!allRootsDone) return false;
    // 3) 신규 openDate 가드
    try {
      const cat = (typeof window.classifyJobCategory === 'function') ? window.classifyJobCategory(j) : '';
      if (cat === 'new') {
        const todayStr = (typeof _kstNow === 'function')
          ? String(_kstNow()||'').slice(0,10)
          : new Date().toISOString().slice(0,10);
        const od = String(j.openDate||'').slice(0,10);
        if (od && od >= todayStr) return false;  // openDate 가 미래/오늘이면 미완료 유지
      }
    } catch(_){}
    return true;
  };

  window._isJobDone = function(j) {
    if (!j) return false;
    const s = String(j.status || '');
    return s === '완료' || s === '처리완료' || s === 'done';
  };

  /* 현재 사용자 이름 — 기록자/감사 로그용 */
  window._currentUserName = function() {
    try {
      const auth = (typeof getAuthState === 'function') ? getAuthState() : null;
      if (auth) {
        // ns_users 의 최신 이름 우선 (관리자 페이지에서 이름 변경 즉시 반영)
        try {
          const users = JSON.parse(localStorage.getItem('ns_users') || '[]');
          const me = users.find(u => (u.id||'').toLowerCase() === (auth.id||auth.email||'').toLowerCase());
          if (me && me.name) return me.name;
        } catch(_){}
        // 이메일 매칭 실패 시 표시이름/닉네임 fallback — 닉네임은 실명으로 정규화 (예: '미디'→'박재민')
        const raw = auth.name || auth.displayName || auth.email || '익명';
        return (typeof window._normalizeDisplayName === 'function') ? (window._normalizeDisplayName(raw) || raw) : raw;
      }
    } catch(e) {}
    return '익명';
  };

  /* ══════════════════════════════════════════════
     💡 사이트 개선안 (모두 공유 / 논의) — myPageModal
     ══════════════════════════════════════════════ */
  function _impEsc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function _impTime(iso){
    try { const d=new Date(iso); return new Date(d.getTime()+9*3600*1000).toISOString().slice(0,16).replace('T',' '); } catch(_){ return ''; }
  }
  function _impFilesHtml(files){
    if (!Array.isArray(files) || !files.length) return '';
    const cells = files.map(f => {
      const url = _impEsc(f.url || '');
      if (f.isImage) {
        return `<a href="${url}" target="_blank" rel="noopener" title="${_impEsc(f.name)}"><img src="${url}" alt="${_impEsc(f.name)}"></a>`;
      }
      return `<a href="${url}" target="_blank" rel="noopener" class="imp-file">📎 ${_impEsc(f.name)}</a>`;
    }).join('');
    return `<div class="imp-files">${cells}</div>`;
  }

  async function loadImprovements(){
    const area = document.getElementById('improvementsArea');
    // 작성자 자동 채집
    try { const a=document.getElementById('impAuthor'); if (a) a.value = _currentUserName(); } catch(_){}
    if (area) area.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:12px">불러오는 중…</div>';
    try {
      const r = await fetch('/api/improvements', { cache:'no-store' });
      const data = await r.json();
      renderImprovements(data.items || []);
    } catch(e){
      if (area) area.innerHTML = '<div style="text-align:center;padding:20px;color:#DC2626;font-size:12px">목록을 불러오지 못했습니다.</div>';
    }
  }
  window.loadImprovements = loadImprovements;

  function renderImprovements(items){
    const area = document.getElementById('improvementsArea');
    const badge = document.getElementById('improvementsBadge');
    if (badge) badge.textContent = items.length;
    if (!area) return;
    if (!items.length){
      area.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px">아직 등록된 개선안이 없습니다. 위 폼에서 첫 개선안을 등록해보세요.</div>';
      return;
    }
    const me = _currentUserName();
    let html = '<table class="imp-table">'
      + '<thead><tr>'
      + '<th style="width:120px">작성자</th>'
      + '<th style="width:120px">업무 구분</th>'
      + '<th>개선할 내용</th>'
      + '<th style="min-width:260px">개선의견 논의</th>'
      + '<th style="width:44px"></th>'
      + '</tr></thead><tbody>';
    for (const it of items){
      const comments = Array.isArray(it.comments) ? it.comments : [];
      const cHtml = comments.map(c =>
        `<div class="imp-cmt"><span class="imp-cmt-by">${_impEsc(c.author)}</span><span class="imp-cmt-at">${_impTime(c.at)}</span><span class="imp-cmt-text">${_impEsc(c.text)}</span>${_impFilesHtml(c.files)}</div>`
      ).join('');
      const canDelete = (it.author && it.author === me);
      html += `<tr>
        <td><span class="imp-author">${_impEsc(it.author)}</span><span class="imp-when">${_impTime(it.createdAt)}</span></td>
        <td><span class="badge badge-green">${_impEsc(it.category||'-')}</span></td>
        <td><span class="imp-content">${_impEsc(it.content)}</span>${_impFilesHtml(it.files)}</td>
        <td>
          <div class="imp-thread">${cHtml || '<span class="imp-none">아직 의견이 없습니다</span>'}</div>
          <div class="imp-compose">
            <input type="text" id="impC-${it.id}" placeholder="의견 입력…" onkeydown="if(event.key==='Enter'){addImprovementComment('${it.id}')}">
            <button class="btn btn-outline btn-sm" onclick="addImprovementComment('${it.id}')">등록</button>
          </div>
          <label class="imp-compose-file">📎 첨부<input type="file" id="impCF-${it.id}" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.txt,.zip"></label>
        </td>
        <td style="text-align:center">${canDelete ? `<button class="imp-del" onclick="deleteImprovement('${it.id}')" title="삭제">🗑</button>` : ''}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    area.innerHTML = html;
  }

  async function submitImprovement(){
    const author = _currentUserName();
    const category = (document.getElementById('impCategory')?.value || '').trim();
    const content = (document.getElementById('impContent')?.value || '').trim();
    const discuss = (document.getElementById('impDiscuss')?.value || '').trim();
    const fileInput = document.getElementById('impFiles');
    const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
    if (!content){ alert('개선할 내용을 입력하세요.'); return; }
    try {
      const fd = new FormData();
      fd.append('author', author);
      fd.append('category', category);
      fd.append('content', content);
      for (const f of files) fd.append('files', f);
      const r = await fetch('/api/improvements', { method:'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      // 논의내용을 함께 입력했으면 첫 의견으로 등록
      if (discuss) {
        try {
          const data = await r.json();
          const id = data && data.item && data.item.id;
          if (id) {
            await fetch('/api/improvements', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({action:'comment', id, author, text: discuss}) });
          }
        } catch(_){}
      }
      document.getElementById('impContent').value = '';
      document.getElementById('impCategory').value = '';
      const dEl = document.getElementById('impDiscuss'); if (dEl) dEl.value = '';
      if (fileInput) fileInput.value = '';
      if (typeof showToast==='function') showToast('💡 개선안이 등록되었습니다');
      loadImprovements();
    } catch(e){ alert('등록 실패: ' + e.message); }
  }
  window.submitImprovement = submitImprovement;

  async function addImprovementComment(id){
    const inp = document.getElementById('impC-' + id);
    const text = (inp?.value || '').trim();
    const fEl = document.getElementById('impCF-' + id);
    const files = fEl && fEl.files ? Array.from(fEl.files) : [];
    if (!text && !files.length) return;
    const author = _currentUserName();
    try {
      let r;
      if (files.length) {
        const fd = new FormData();
        fd.append('action', 'comment');
        fd.append('id', id);
        fd.append('author', author);
        fd.append('text', text);
        for (const f of files) fd.append('files', f);
        r = await fetch('/api/improvements', { method:'POST', body: fd });
      } else {
        r = await fetch('/api/improvements', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({action:'comment', id, author, text}) });
      }
      if (!r.ok) throw new Error(await r.text());
      loadImprovements();
    } catch(e){ alert('의견 등록 실패: ' + e.message); }
  }
  window.addImprovementComment = addImprovementComment;

  async function deleteImprovement(id){
    if (!confirm('이 개선안을 삭제하시겠습니까?')) return;
    try {
      const r = await fetch('/api/improvements?id=' + encodeURIComponent(id), { method:'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      if (typeof showToast==='function') showToast('삭제되었습니다');
      loadImprovements();
    } catch(e){ alert('삭제 실패: ' + e.message); }
  }
  window.deleteImprovement = deleteImprovement;

  /* 작업 메모 추가 (시스템 로그용) — 담당자(engineer)와 기록자(현재 사용자) 다르면 둘 다 기록
     ⚠️ 사용자 입력 메모 추가는 L11977 의 addJobMemo(jobId) 사용. 이름 충돌 방지를 위해
        이 헬퍼는 appendJobMemoLog 로 명명.
     usage: appendJobMemoLog(job, '상태 변경: 진행중 → 처리완료', { tag:'status' })
  */
  window.appendJobMemoLog = function(job, text, opts) {
    if (!job) return;
    if (!Array.isArray(job.memos)) job.memos = [];
    opts = opts || {};
    const now = new Date();
    const kstAt = new Date(now.getTime()+9*3600*1000).toISOString().slice(0,16).replace('T',' ');
    const recordedBy = opts.recordedBy || _currentUserName();
    const assignee = opts.assignee || job.engineer || job.assignee || '';
    let header;
    if (assignee && assignee !== recordedBy) {
      header = `담당 : ${assignee} / 기록 : ${recordedBy}`;
    } else if (recordedBy) {
      header = `기록 : ${recordedBy}`;
    } else {
      header = '';
    }
    job.memos.push({
      at:        kstAt,
      author:    recordedBy,
      assignee:  assignee || '',
      recordedBy,
      text:      header ? `[${header}] ${text}` : text,
      tag:       opts.tag || '',
    });
  };

  function renderLinePendingList() {
    const list = document.getElementById('linePendingList');
    const totalEl = document.getElementById('linePendingTotal');
    if (totalEl) totalEl.textContent = _linePending.length;
    if (!list) return;
    if (!_linePending.length) {
      list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray-400)">
        <div style="font-size:48px;margin-bottom:12px">📭</div>
        <div style="font-weight:700;color:var(--gray-500);font-size:14px">등록 대기 업무가 없습니다</div>
        <div style="font-size:11px;margin-top:4px">Line 메시지를 가져오면 여기에 표시됩니다</div>
      </div>`;
      return;
    }

    // ── 카테고리 필터 바 (현재 대기 항목에 존재하는 카테고리 + 전체) — 담당자가 카테고리별로 처리 ──
    const _catCount = {};
    _linePending.forEach(p => { const c = p.lineCategory || 'ignore'; _catCount[c] = (_catCount[c]||0) + 1; });
    const _catOrder = ['pos_as','van_as','device_mgmt','open_store','van_doc','label','equip_out','delivery','ignore','as_pos_van'];
    const _present = _catOrder.filter(c => _catCount[c]);
    const _chip = (key, label, count, active, color, bg) => {
      const sty = active
        ? `background:${color||'#1D4ED8'};color:#fff;border-color:${color||'#1D4ED8'}`
        : `background:${bg||'#fff'};color:${color||'var(--gray-700)'};border-color:var(--gray-300)`;
      return `<button onclick="window.setLinePendingFilter('${key}')" style="${sty};border:1.5px solid;border-radius:14px;padding:4px 12px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap">${label} <span style="opacity:0.8">${count}</span></button>`;
    };
    let _barHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center">';
    _barHtml += _chip('all', '전체', _linePending.length, _linePendingFilter === 'all', '#374151');
    _present.forEach(c => { const m = LINE_TYPE_META[c] || LINE_TYPE_META.ignore; _barHtml += _chip(c, m.label, _catCount[c], _linePendingFilter === c, m.color, m.bg); });
    _barHtml += '</div>';

    // 필터 적용
    const _view = (_linePendingFilter === 'all') ? _linePending : _linePending.filter(p => (p.lineCategory || 'ignore') === _linePendingFilter);
    if (!_view.length) {
      list.innerHTML = _barHtml + `<div style="text-align:center;padding:40px 20px;color:var(--gray-400);font-size:12px">이 카테고리에 대기 업무가 없습니다 — '전체'로 보기</div>`;
      return;
    }

    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    const users = (typeof getUsers === 'function') ? (getUsers() || []) : [];

    // 매장 옵션 (datalist 자동완성 — 상호명·사업자번호·주소·별칭 검색 지원)
    const storeOpts = stores.map(s => {
      const aliases = Array.isArray(s.aliases) ? s.aliases.join(' ') : '';
      const label = `${s.name || ''}${s.bizNo ? ' · '+s.bizNo : ''}${s.ceo ? ' · '+s.ceo : ''}${s.address ? ' · '+s.address.slice(0,20) : ''}`;
      return `<option value="${esc(label)}" data-id="${esc(s.id)}" data-name="${esc(s.name||'')}" data-aliases="${esc(aliases)}">${esc(label)}</option>`;
    }).join('');
    // 담당자 옵션 (사용자 + 자유 입력)
    const userOpts = users.map(u => `<option value="${esc(u.name||u.email||'')}">${esc(u.name||u.email||'')}</option>`).join('');

    list.innerHTML = _barHtml + _view.map((p, idx) => {
      const meta = LINE_TYPE_META[p.lineCategory] || LINE_TYPE_META.ignore;
      const stMeta = PENDING_STATUS_META[p.status] || PENDING_STATUS_META['접수'];
      const isUpdate = p.action === 'update' && p.targetJobId;
      return `
      <div style="border:1.5px solid var(--gray-200);border-left:5px solid ${meta.color};border-radius:8px;padding:12px;margin-bottom:10px;background:#fff">
        <!-- 헤더 -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;font-size:11px">
          <span style="background:${meta.bg};color:${meta.color};padding:3px 8px;border-radius:4px;font-weight:700">${meta.label}</span>
          ${isUpdate ? `<span style="background:#FEF3C7;color:#92400E;padding:3px 8px;border-radius:4px;font-weight:700">↻ 기존 작업 업데이트</span>` : `<span style="background:#EFF6FF;color:#1D4ED8;padding:3px 8px;border-radius:4px;font-weight:700">＋ 신규 등록</span>`}
          <span style="color:var(--gray-500)">🕒 ${esc(p.lineMsgAt||'-')}</span>
          <span style="color:var(--gray-500)">·</span>
          <span style="color:var(--gray-700);font-weight:600">${esc(p.lineSender||'-')}</span>
          ${p.lineRoom ? `<span style="color:var(--gray-400)">@ ${esc(p.lineRoom)}</span>` : ''}
        </div>

        <!-- 라인 원문 -->
        <div style="background:#F9FAFB;border:1px solid var(--gray-200);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:var(--gray-700)">
          ${p.lineParsed ? `<div style="font-weight:700;margin-bottom:2px;color:var(--gray-800)">→ ${esc(p.lineParsed)}</div>` : ''}
          <div style="font-size:11px;color:var(--gray-500)">${esc(p.lineRaw||p.lineRequest||'-')}</div>
        </div>

        <!-- 편집 그리드 -->
        <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px">
          <!-- 매장 — 2단 레이아웃: (1) 현재 연결 매장 표시  (2) 검색해서 변경 -->
          <div>
            <label style="font-size:10px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:2px">🏪 매장</label>
            <!-- 1단: 현재 연결 상태 (storeId 가 실제 매장과 매칭되는지 검증) -->
            <div id="storeStatus-${p.id}" style="margin-bottom:3px">
              ${(() => {
                const linkedStore = p.storeId ? stores.find(x => x.id === p.storeId) : null;
                if (linkedStore) {
                  return _renderConnectedStorePanel(p.id, linkedStore, p.storeOriginal);
                }
                if (p.storeId) {
                  return `<div style="padding:5px 8px;background:#FEE2E2;border:1px solid var(--danger);border-radius:5px;font-size:11px;color:#991B1B;display:flex;align-items:center;gap:6px">
                    <span style="font-weight:700">⚠ 잘못된 연결</span>
                    <span style="flex:1">존재하지 않는 매장 ID — 원문: <b>${esc(p.store || '없음')}</b></span>
                    <button onclick="clearPendingStore('${p.id}')" style="font-size:10px;padding:2px 8px;background:var(--danger);color:#fff;border:none;border-radius:3px;cursor:pointer;font-weight:700">🔧 정리</button>
                  </div>`;
                }
                return `<div style="padding:5px 8px;background:#FFFBEB;border:1px solid var(--warning);border-radius:5px;font-size:11px;color:#92400E">
                  ⚠ 미연결 — 원문: <b>${esc(p.store || '없음')}</b>
                </div>`;
              })()}
            </div>
            <!-- 2단: 검색 입력 + 커스텀 드롭다운 -->
            <div style="position:relative">
              <input type="text"
                     id="storeInput-${p.id}"
                     value=""
                     autocomplete="off"
                     placeholder="🔍 매장 변경 검색 — 클릭/탭 또는 ↑↓ + Enter 선택"
                     oninput="Autocomplete.live('store', '${p.id}', this)"
                     onkeydown="Autocomplete.key('store', '${p.id}', event)"
                     onfocus="Autocomplete.live('store', '${p.id}', this)"
                     onblur="setTimeout(()=>Autocomplete.hide('store', '${p.id}'), 200)"
                     style="width:100%;padding:5px 6px;border:1px solid var(--gray-300);border-radius:5px;font-size:12px">
              <!-- 라이브 검색 결과 — input 바로 아래 떠 있는 dropdown 형태 -->
              <div id="storeSuggest-${p.id}"
                   style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:#fff;border:1px solid var(--gray-300);border-radius:5px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:240px;overflow-y:auto;margin-top:2px"></div>
            </div>
          </div>
          <!-- 카테고리 -->
          <div>
            <label style="font-size:10px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:2px">📂 업무 구분</label>
            <select onchange="updatePending('${p.id}', {lineCategory:this.value})"
                    style="width:100%;padding:5px 6px;border:1px solid var(--gray-300);border-radius:5px;font-size:12px;background:${meta.bg};color:${meta.color};font-weight:700">
              <option value="pos_as"      ${p.lineCategory==='pos_as'||p.lineCategory==='as_pos_van'?'selected':''}>🖥 POS A/S</option>
              <option value="van_as"      ${p.lineCategory==='van_as'?'selected':''}>💳 VAN A/S</option>
              <option value="device_mgmt" ${p.lineCategory==='device_mgmt'?'selected':''}>📱 단말기 A/S</option>
              <option value="open_store"  ${p.lineCategory==='open_store'?'selected':''}>🏪 오픈 작업</option>
              <option value="van_doc"     ${p.lineCategory==='van_doc'?'selected':''}>📑 밴서류</option>
              <option value="label"       ${p.lineCategory==='label'?'selected':''}>🏷 라벨지</option>
              <option value="equip_out"   ${p.lineCategory==='equip_out'?'selected':''}>📦 장비 출고</option>
              <option value="delivery"    ${p.lineCategory==='delivery'?'selected':''}>🚚 택배</option>
            </select>
          </div>
          <!-- 담당자 — 공통 Autocomplete 사용 -->
          <div style="position:relative">
            <label style="font-size:10px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:2px">👤 담당자</label>
            <input type="text"
                   id="assigneeInput-${p.id}"
                   value="${esc(p.assignee||'')}"
                   autocomplete="off"
                   oninput="Autocomplete.live('assignee', '${p.id}', this)"
                   onfocus="Autocomplete.live('assignee', '${p.id}', this)"
                   onkeydown="Autocomplete.key('assignee', '${p.id}', event)"
                   onblur="setTimeout(()=>Autocomplete.hide('assignee', '${p.id}'), 200); updatePending('${p.id}', {assignee:this.value})"
                   style="width:100%;padding:5px 6px;border:1px solid var(--gray-300);border-radius:5px;font-size:12px"
                   placeholder="이름 클릭 또는 입력">
            <div id="assigneeSuggest-${p.id}"
                 style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;background:#fff;border:1px solid var(--gray-300);border-radius:5px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:200px;overflow-y:auto;margin-top:2px"></div>
          </div>
          <!-- 진행 상황 -->
          <div>
            <label style="font-size:10px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:2px">📊 진행 상황</label>
            <div style="display:flex;gap:3px;flex-wrap:wrap">
              ${PENDING_STATUS_CYCLE.map(s => {
                const m = PENDING_STATUS_META[s];
                const active = p.status === s;
                return `<button onclick="cyclePendingStatus('${p.id}', '${s}')"
                          style="flex:1;font-size:10px;padding:4px 2px;border:1px solid ${active?m.color:'var(--gray-300)'};background:${active?m.bg:'#fff'};color:${active?m.color:'var(--gray-500)'};border-radius:4px;font-weight:${active?700:500};cursor:pointer"
                          title="${esc(s)}">${m.icon}</button>`;
              }).join('')}
            </div>
            <div style="font-size:10px;text-align:center;margin-top:2px;color:${stMeta.color};font-weight:700">${stMeta.icon} ${esc(p.status)}</div>
          </div>
        </div>

        <!-- 추가 메모 (추가처리 일 때 필수 안내) -->
        <div style="margin-bottom:8px">
          <label style="font-size:10px;color:var(--gray-500);font-weight:700;display:block;margin-bottom:2px">📝 추가 메모 ${p.status==='추가처리'?'<span style="color:#9D174D">(추가처리 시 필수 권장)</span>':''}</label>
          <textarea oninput="updatePending('${p.id}', {memo:this.value}, true)"
                    onblur="updatePending('${p.id}', {memo:this.value})"
                    placeholder="검토자 메모 — 추가 정보, 처리 방향, 특이사항"
                    style="width:100%;min-height:36px;padding:6px 8px;border:1px solid var(--gray-300);border-radius:5px;font-size:12px;resize:vertical;font-family:inherit">${esc(p.memo||'')}</textarea>
        </div>

        <!-- 액션 버튼 -->
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button onclick="deletePending('${p.id}')" style="font-size:12px;padding:6px 12px;background:#fff;color:var(--danger);border:1px solid var(--danger);border-radius:5px;font-weight:700;cursor:pointer">🗑 삭제</button>
          <button onclick="approvePending('${p.id}')" style="font-size:12px;padding:6px 14px;background:#06C755;color:#fff;border:none;border-radius:5px;font-weight:700;cursor:pointer">✅ 등록</button>
        </div>
      </div>`;
    }).join('');
  }

  /* 매장 검색 — 토큰 단위 매칭 + 점수 (이름·주소·별칭 함께)
     "자연들 오이도" → "자연들마트 오이도점" 같은 케이스 우선
     점수: 이름 일치 +3, 주소 일치 +2, 별칭 일치 +2, 부분 +1, 위치 보너스 */
  function _scoreStore(s, tokens) {
    const norm = (x) => String(x||'').toLowerCase().replace(/\s+/g,'');
    const name  = norm(s.name);
    const addr  = norm(s.address);
    const bizNo = norm(s.bizNo);
    const ceo   = norm(s.ceo);
    const aliases = (Array.isArray(s.aliases) ? s.aliases : []).map(norm);

    let score = 0;
    let matchedTokens = 0;
    for (const t of tokens) {
      if (!t) continue;
      const nt = norm(t);
      if (!nt) continue;
      let hit = false;
      if (name === nt)            { score += 10; hit = true; }
      else if (name.includes(nt)) { score += 4;  hit = true; }
      if (aliases.some(a => a === nt))            { score += 8; hit = true; }
      else if (aliases.some(a => a.includes(nt))) { score += 3; hit = true; }
      if (addr.includes(nt))      { score += 2;  hit = true; }
      if (bizNo === nt)           { score += 9;  hit = true; }
      else if (bizNo.includes(nt)){ score += 2;  hit = true; }
      if (ceo.includes(nt))       { score += 1;  hit = true; }
      if (hit) matchedTokens++;
    }
    // 모든 토큰이 매칭되면 큰 보너스 ("자연들 오이도" 둘 다 매칭)
    if (matchedTokens === tokens.length && tokens.length >= 2) score += 5;
    return { score, matchedTokens };
  }

  function _searchStores(val, limit = 5) {
    const stores = (typeof getStores === 'function') ? (getStores() || []) : [];
    if (!val.trim()) return [];
    const tokens = val.trim().split(/\s+/).filter(t => t.length > 0);
    const scored = stores.map(s => ({ s, ...(_scoreStore(s, tokens)) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || b.matchedTokens - a.matchedTokens);
    return scored.slice(0, limit).map(x => x.s);
  }

