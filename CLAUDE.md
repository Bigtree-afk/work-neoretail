# work.neoretail.net — 프로젝트 규칙

## 🎯 업무별 레이아웃 분리 규칙 (필수)

**원칙**: 등록 폼·상세 모달·hub sub-card 등 모든 UI 는 업무 카테고리에 맞는 필드만 노출. 다른 카테고리의 필드를 그대로 끼워 넣어 "통합 폼" 으로 만들면 사용자 혼란 + 데이터 오염 발생.

### 카테고리별 필수/금지 필드

| 카테고리 | 핵심 필드 | 표시 금지 |
|---|---|---|
| **신규** (`new`) | 설치일·가오픈일·오픈일, 매장 담당자(여러명), VAN 서류, 장비 테이블, thread (요청접수·처리기록), 메모 | — |
| **AS** (`as`) | asReceivedAt (접수시각), asDueDate, AS 대상, thread (요청접수·처리기록), 투입 장비 (요청별) | 설치/가오픈/오픈일, 매장 누적 장비 |
| **VAN** (`van`) | 업무일, VAN사 (KOCES/NICE/KIS/KSNET) TID/Serial, 카드 가맹 신청/완료일, 거래처 담당자, 메모 | 설치/가오픈/오픈일, 장비 테이블, thread |
| **소모품** (`supplies`) | 품목(POS용지/단말용지/가격라벨/프라이스텍/저울라벨), 처리구분(지원/선불/후불), 수량+단위, 금액, 발송일, (후불) 수금예정일+미수상태, 요청접수 (단순) | 설치/가오픈/오픈일, 장비 테이블, 비고, 담당 엔지니어, 매장 누적 장비 |
| **재고조사** (`stocktake`) | 조사일, 조사 단계 (상담→일정확정→조사완료→정산→마감), 수수료/인건비/비용/수익, 수금금액, 미수금 | 일반 작업 필드 |

### 구현 패턴

1. **등록 폼 (`newJobModal`)** — body class 토글로 분기
   ```js
   document.body.classList.toggle('supplies-mode', isSupplies);
   // CSS:
   //   body.supplies-mode .js-non-supplies { display: none !important; }
   //   body.supplies-mode .js-supplies-only { display: block !important; }
   ```

2. **상세 모달** — 카테고리별 short-circuit (큰 차이는 별도 함수)
   ```js
   function editNewopen(id) {
     const cat = classifyJobCategory(j);
     if (cat === 'van' && window.openVanJobModal) { openVanJobModal(id); return; }
     if (cat === 'supplies' && window._editSupplyJob) { _editSupplyJob(id); return; }
     // 신규/AS 는 공통 레이아웃 (필드 일부 .js-non-as 로 신규/AS 분기)
   }
   ```

3. **Hub sub-card** — 카테고리별 표시 포맷
   ```js
   if (cat === 'supplies') {
     titleHtml = `[${date}][${itemShort} ${modeLabel} ${qty}${unit}] · ${amount}원`;
   } else if (cat === 'as') {
     titleHtml = `${asRequest?.slice(0,60)} (${asDueDate})`;
   } else { /* 기본 */ }
   ```

### 점검 체크리스트 (신규 카테고리 추가 시)

- [ ] `classifyJobCategory()` 에 분기 추가 (m-core.js)
- [ ] 등록 폼: `.js-non-<cat>` / `.js-<cat>-only` CSS 규칙 + applyJobTypeMode 분기
- [ ] `_resetJobForm` 에 해당 필드 reset
- [ ] `applyJobFormContext('<cat>')` 에 초기값 셋팅
- [ ] `saveNewJob` 에 카테고리별 필드 저장 분기
- [ ] 상세 모달: 별도 함수 또는 editNewopen 분기 (`.js-non-<cat>` 클래스 활용)
- [ ] Hub sub-card: cat 분기 표시
- [ ] 카테고리별 hub 의 집계 표 (선불/후불/미수/매출 등 도메인 특화)

**금지**:
- "다음에 정리하지" 라고 일반 폼에 새 필드 추가 (다른 카테고리에 노이즈)
- 작업 유형 select 의 option 값으로 카테고리 판단 (`classifyJobCategory()` 사용 — type 텍스트만으로 판별 불가능한 경우 있음)
- 모든 카테고리에 동일한 일자 trio (설치/가오픈/오픈) 강제 (소모품은 발송일만 등)

**예외**:
- 공통 헤더 (점포명, 작업유형, 매장 검색) — 모든 등록 폼 공통
- 첨부 (`uploader`) — 모든 카테고리 공통
- thread (요청접수·처리기록) — 신규/AS/소모품 공통 (VAN 은 thread 없음)

## 📅 날짜 기록 규칙 (필수)

**원칙**: 모든 업무 기록(작업/메모/thread entry/상태 변경 등)에는 **날짜가 반드시 포함**되어야 한다.

- **새 작업 등록**: 반드시 일자 필드 셋팅 (`createdAt` 자동 + 카테고리별 일정 — 신규=`installDate/openDate`, AS=`asReceivedAt`, 소모품=`shipDate`)
- **thread entry**: `ts` 필수 (KST `YYYY-MM-DD HH:MM` 형식)
- **memo entry**: `at` 필수 (KST stamp)
- **상태 전환**: `doneAt`, `completedAt`, `arPaidAt` 등 변경 시점 기록
- **표시 (hub sub-card / 모달 / 리스트)**: 가능한 경우 모든 항목에 일자 prefix `[YYYY-MM-DD]` 또는 inline `📅 YYYY-MM-DD` 표시

**금지**:
- 날짜 없는 작업 등록 (빈 input 그대로 저장 X — 폼 단에서 today 자동 셋팅)
- 날짜 없는 sub-card 표시 (`createdAt` fallback 으로라도 표시)

**구현 시 권장 패턴**:
```js
// 표시: 카테고리별 일자 fallback chain
const date = j.shipDate || j.installDate || j.openDate || j.asReceivedAt?.slice(0,10) || j.date || (j.createdAt ? new Date(j.createdAt).toISOString().slice(0,10) : '');

// 저장: 빈 값일 때 today 자동
const today = (typeof _kstNow === 'function') ? String(_kstNow()||'').slice(0,10) : new Date().toISOString().slice(0,10);
job.shipDate = formShipDate || today;
```

### 🚨 타임존(KST) 함정 — 절대 금지 패턴 (필수 — 2026-05-28)

**사고 사례**: "오후에 등록한 작업이 다음날 날짜로 기록됨" — 직원 다수 신고.

**원인**: 날짜 기본값 계산에 아래 패턴 사용:
```js
// 🔴 절대 금지 — getTimezoneOffset 수동 보정
const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset() + 9*60);
return d.toISOString().slice(0,10);
```
이 코드는 "브라우저 = UTC" 를 가정한다. 그러나 한국 직원 브라우저는 KST(UTC+9)라
`getTimezoneOffset() = -540` → **+9시간이 이중 적용되어 +18시간**. KST 오전 6시 이후
등록(`H+18 ≥ 24`)이 전부 다음날로 밀린다. PC/모바일 6곳에서 발견·수정함.

**또 다른 금지 패턴**:
```js
// 🔴 금지 — UTC 날짜를 KST 인 양 사용. KST 새벽(00~09시)이면 전날로 어긋남
new Date().toISOString().slice(0,10)        // 날짜
new Date().toISOString()                     // thread ts (9시간 어긋남 + 새벽 전날)
```

**✅ 올바른 패턴 — 브라우저 타임존 무관 절대 보정**:
```js
// KST 날짜 (YYYY-MM-DD)
new Date(Date.now() + 9*3600*1000).toISOString().slice(0,10)

// KST 일시 (기록용 ts/at) — _kstDateTimeStr / _kstNow / _kstStamp 사용
//   이들은 Intl.DateTimeFormat({ timeZone:'Asia/Seoul' }) 기반이라 항상 정확
const ts = (typeof _kstNow === 'function') ? _kstNow() : new Date(Date.now()+9*3600*1000).toISOString().slice(0,16).replace('T',' ');
```

**점검 명령** (날짜/시각 코드 추가·수정 후 반드시 실행):
```bash
# 이중보정 패턴이 새로 들어왔는지
grep -rn "getTimezoneOffset" index.html m-core.js m/ | grep "setMinutes\|getMinutes"
# → 결과 0 이어야 함
```

**규칙 요약**:
| 용도 | ✅ 올바른 방법 | 🔴 금지 |
|---|---|---|
| KST 날짜 | `new Date(Date.now()+9*3600*1000).toISOString().slice(0,10)` | `getTimezoneOffset` 보정, `new Date().toISOString().slice(0,10)` |
| KST 일시(ts/at) | `_kstNow()` / `_kstDateTimeStr()` / `_kstStamp()` | `new Date().toISOString()` |
| 시각 절대 timestamp(정렬/계산 전용, 표시 X) | `new Date().toISOString()` 허용 | — |

## 🔢 카테고리별 hub 정렬 규칙 (필수)

**원칙**: 매장 그룹 내(하위 sub-card) 정렬은 도메인 의미에 맞게 — 사용자가 가장 먼저 처리해야 할 항목이 위에 와야 한다. 단순 createdAt desc 로는 부족.

| 카테고리 | 정렬 1순위 | 정렬 2순위 (tie-break) |
|---|---|---|
| **소모품** (`supplies`) | **미수 (postpaid · 잔액>0 · arPaid=false)** 먼저 | `updatedAt > createdAt > shipDate` desc (분 단위) |
| **AS** | 긴급 (urgent D-day) 먼저 | 접수일 desc |
| **신규** | 미완료 ROOT 있는 것 먼저, 그 안에서 오픈일 임박 우선 | createdAt desc |
| **VAN** | 진행중 먼저 | 업무일 desc |

**구현 위치**: `_hubRenderGroup` 의 `subsHtml = g.jobs.map(...)` 직전에 `g.jobs = g.jobs.slice().sort(...)` 로 정렬.

**시간 정밀도 (필수)**:
- 모든 작업/메모/thread entry 의 `createdAt` / `updatedAt` 은 **ms 단위 (`Date.now()`)** 로 저장 — 같은 일자 등록도 분·초 단위로 안정 정렬됨.
- `ts` (thread/memo) 는 KST `YYYY-MM-DD HH:MM` 표시용. 정렬 비교는 가능한 `updatedAt`/`createdAt` 의 ms 사용 (문자열 비교는 fallback).
- 일자 필드(`shipDate`/`openDate` 등)는 `YYYY-MM-DD` 만 — UI 표시·필터용. 정렬 tie-break 에 쓸 때는 `Date.parse(d+'T00:00:00')` 로 환산.

**저장 시 의무**:
- 신규 작업 등록 → `createdAt = Date.now()` (필수), `updatedAt = Date.now()` (필수)
- 수정 (edit/patch) → `updatedAt = Date.now()` 갱신 의무
- 상태 전환 (완료/수금) → `doneAt` / `arPaidAt` 등 시점 기록

**금지**:
- ms 정밀도 없는 일자 문자열(`YYYY-MM-DD`) 만으로 정렬 (같은 날 등록 건 순서 불안정)
- 매장 그룹 내 정렬을 카테고리 무관하게 `createdAt desc` 일괄 적용 (도메인 우선순위 무시)

## 📱 모바일 자동 리다이렉트 (2026-05-21 ~ 1주 테스트)

- **위치**: `index.html` 상단 IIFE
- **활성화 토글**: 같은 IIFE 의 `if (true)` ↔ `if (false)`
- **제외 경로**: `/m`, `/m.html`, `/m/*`
- **PC 강제 진입 (1회)**: `?desktop=1` URL 파라미터 → `sessionStorage.force_desktop=1` (현재 탭만)
  - 새 탭/창에서는 다시 자동 판정 → 모바일이면 `/m/` 으로
  - **2026-05-22 변경**: 이전 `localStorage` 영구 저장 → `sessionStorage` (sticky 버그 fix)
- **PC 강제 해제**: `?desktop=clear` URL 파라미터 또는 PC 상단의 "📱 모바일" 버튼
  - localStorage/sessionStorage 의 `force_desktop` 모두 제거 후 자동 판정
- **mobile 감지**: 화면 폭 **≤768** OR `Mobi|Android|iPhone|iPod|iPad|webOS|BlackBerry|IEMobile|Opera Mini` UA
  - 2026-05-22 변경: 640 → 768 (태블릿 세로 포함), `iPad` 추가
- **잔여물 자동 청소**: `m/index.html` 진입 시 옛 `localStorage.force_desktop` 자동 제거

**테스트 관찰 항목**:
- 모바일 SPA 에 누락된 기능이 있는지 (있으면 PC 로 fallback 가능한지 확인)
- `force_desktop=1` 영구 토글이 의도대로 동작
- 모바일 SPA 의 카테고리별 페이지(`/m/newjob/` `/m/as/` `/m/van/` `/m/supplies/` `/m/stocktake/`) 모두 진입 가능
- iPad 등 태블릿이 모바일로 잡혀 불편한지 — 필요 시 폭 임계값(640) 조정

**1주 후 결정**:
- 안정적이면 → 정식 적용 + 이 섹션을 "운영 중" 으로 갱신
- 문제 다발 → `if (false)` 로 임시 비활성화 + 원인 정리

## 🧭 모바일/PC 업무 카드 클릭 → 진입 화면 규칙 (필수)

**원칙**: **기존 업무 카드를 클릭하면 항상 thread(요청·처리 기록) 화면**으로 진입한다.
폼(메타 편집) 은 thread 화면 내 ✏️ 수정 버튼으로만 진입.

### 진입 경로 표

| 사용자 액션 | 도착 화면 | 이유 |
|---|---|---|
| 카드/리스트 항목 클릭 | **thread 뷰** (요청접수·진행·완료 기록) | 완료 처리, 추가 요청 기록 등 일상 액션이 thread 에서 일어남 |
| thread 의 ✏️ 수정 버튼 | 메타 편집 폼 (매장/일정/금액 등) | 등록 정보 변경 |
| 폼 저장 후 | **thread 뷰로 복귀** | 변경 결과 즉시 확인 |
| 신규 등록 후 | **thread 뷰** | 후속 처리·LINE 발송이 거기서 발생 |

### 모바일 SPA 통일 규칙 (m/<cat>/index.html)

카테고리별 `renderEntry()` 등 카드 렌더링 코드는 **반드시**:
```js
<div class="card ${cls}" onclick="location.hash='#thread/${esc(j.id)}'">
```
패턴 사용. **`#form/edit/` 직접 이동 금지** (사용자가 thread 못 봐서 완료 처리 불가능).

### 위반 사례 (2026-05-22 fix)
- `m/as/index.html` L671: `onclick="location.hash='#form/edit/${j.id}'"` → **사용자가 기존 AS thread 확인 불가 + 완료 처리 불가** → `#thread/` 로 수정
- 다른 4개 SPA (newjob/van/supplies/stocktake) 는 이미 `#thread/` 사용 — AS 만 예외였음

### 점검 체크리스트 (모바일 SPA 신규/수정 시)
- [ ] `renderEntry()` 카드 onclick 이 `#thread/<id>` 패턴인가
- [ ] thread 뷰 진입 시 빈 thread 라도 `등록 정보 합성 entry` 로 사용자 정보 노출 (m/supplies 의 `_synth` 패턴)
- [ ] thread 에 ✏️ 수정 버튼 존재 — 클릭 시 `#form/edit/<id>` 로
- [ ] 폼 저장 후 `location.hash = '#thread/' + savedJob.id` 로 복귀
- [ ] PC `editNewopen(id)` 도 동일 규칙 — 카테고리별 short-circuit (`_editSupplyJob`, `openVanJobModal` 등)

### 🚨 m-core.js / 공용 외부 자산 변경 시 cache-bust 의무 (필수 — 2026-05-28)

**증상**: 모바일 m-core.js 에 보강 B 패치 이식 후 deploy 했지만 iPhone Safari 에서만 동기화 단절. Android 는 정상.

**원인**: m/*.html 의 `<script src="/m-core.js?v=2026-05-22-..."></script>` 의 `?v=` 쿼리가 갱신 안 됨 → 같은 URL 이라 브라우저(특히 iOS Safari)가 캐시된 옛 버전 계속 사용.

**규칙**:
- `m-core.js` (또는 다른 공용 외부 JS/CSS) 한 줄이라도 수정 시 → **반드시** 모든 참조 페이지의 `?v=YYYY-MM-DD-keyword` 일괄 갱신 + deploy
- `?v=` 갱신 안 하면 변경이 일부 사용자에게만 적용되어 OS/브라우저별 동작 차이가 보임 → 디버깅 매우 어려움
- `app.css` 등 다른 외부 자산도 동일 원칙

**참조 페이지 목록** (m-core.js):
```
m/index.html
m/as/index.html
m/newjob/index.html
m/van/index.html
m/supplies/index.html
m/stocktake/index.html
m/schedule/index.html
m/settings/index.html
```

**자동화 스크립트**: `scripts/bump-mcore.sh` (또는 PowerShell `scripts/bump-mcore.ps1`)
```bash
# m-core.js 수정 후 한 줄로 일괄 갱신
bash scripts/bump-mcore.sh "thread-tomb"
# → 모든 m/*.html 의 ?v=YYYY-MM-DD-thread-tomb 으로 갱신
```

**OS 별 캐시 정책 차이 (참고)**:
- iOS Safari: `?v=` 같은 query string 으로만 cache busting. `Cache-Control: must-revalidate` 도 일부 무시 가능.
- Android Chrome: `Cache-Control` 비교적 잘 준수. 그러나 의존 X.
- 결론: **`?v=` 갱신이 유일하게 신뢰할 수 있는 cache busting 수단**.

**OS 별 차이 발견 시 디버깅 순서**:
1. 양쪽 OS 의 `view-source:` 또는 콘솔에서 `m-core.js` URL 의 `?v=` 비교 → 다르면 캐시 차이
2. 동일하다면 두 OS 에서 콘솔로 `getJobs()`, `localStorage.getItem('ns_tombstones')` 비교
3. 동일하다면 OS 별 JS API 차이 점검 (Optional chaining, `crypto.subtle`, `IntersectionObserver` 등)

### PC 측 동일 규칙
- 카드/리스트 클릭 → `editNewopen(id)` → 카테고리별 모달 (thread + 메타 통합 뷰)
- 카테고리별 short-circuit 으로 카테고리 맞는 레이아웃 분기 (CLAUDE.md "업무별 레이아웃 분리 규칙" 참조)

**규칙 위반의 비용**: 사용자가 기존 업무에 대한 요청·처리 이력을 볼 수 없게 되고, 완료 처리·새 요청접수 등 모든 후속 액션이 막힘. 매장 데이터는 잘 저장돼도 사용자 입장에선 "기능 망가짐" 으로 보이는 치명적 UX 버그.

## 📜 완료/done 항목 노출 규칙 (필수)

**원칙**: 카테고리별 리스트(hub/entry/대시보드)는 **진행 중 + 완료 항목을 함께 표시**한다. 완료된 항목도 사용자가 **원본 요청 내용을 확인할 수 있어야** 한다.

### 표시 정책

| 항목 | 규칙 |
|---|---|
| **리스트 정렬** | 미완료 먼저 (위), 완료 아래. 카테고리별 1순위 정렬 (미수/긴급) 도 진행 그룹 내에서 적용 |
| **카드 요약 텍스트** | **첫 ROOT(요청접수) 의 text 우선** — 완료된 항목도 원본 요청을 보여줘야 사용자가 어떤 건이었는지 파악 가능 |
| **fallback 체인** | `firstRoot.text → j.asRequest → j.lineRequest → j.lineParsed → j.memo → j.notes` |
| **완료 표시** | 카드 좌측 border `#10B981` (초록) + `✅ 완료` 배지 + 약한 음영 (`background:#FAFBFA`, `opacity:0.85`) |
| **상단 카운트 배지** | 진행 중만 카운트 (완료는 카드에는 표시되지만 배지 숫자에는 포함 안 함) |

### 위반 사례 (자주 발생 — 매번 지적)
- **카드 summary 가 `lastThread.text` 또는 "최신 entry"**: 완료된 건은 마지막 entry 가 "완료 처리" 같은 시스템 메시지라 의미 불명. **첫 ROOT 인 원본 요청을 보여줘야 함.**
- **`filter(!isDone)`** 만 적용: 완료 항목 자체가 안 보임 → 사용자 confused
- **`_isJobDone` 만 사용**: thread 완료지만 status 미동기화 옛 데이터가 진행 중으로 잘못 분류. **`_isJobEffectivelyDone` 사용 필수.**

### 구현 패턴
```js
// ✅ 올바른 패턴 (모바일 entry / PC hub 모두 동일)
const isDone = window._isJobEffectivelyDone || window._isJobDone;
const all = jobs.filter(j => cat(j) === '<CATEGORY>');
all.sort((a, b) => {
  const aD = isDone(a) ? 1 : 0;
  const bD = isDone(b) ? 1 : 0;
  if (aD !== bD) return aD - bD;       // 미완료 먼저
  // 그룹 내 정렬 (긴급/날짜 등)
});

// 카드 요약: 첫 ROOT 우선
const firstRoot = (j.thread||[]).find(e => e && e.parentId === null);
const summary = (firstRoot && firstRoot.text) || j.asRequest || j.lineRequest || j.lineParsed || j.memo || '';
```

### 점검 체크리스트
- [ ] 리스트 필터에 `!isDone(j)` 만 있는 경우 → 완료 항목도 포함하도록 변경
- [ ] 카드 summary 가 첫 ROOT(`firstRoot.text`) 우선인가
- [ ] 완료 카드 시각적 구분 (초록 border + 배지 + 음영)
- [ ] `_isJobDone` 대신 `_isJobEffectivelyDone` 사용 (status 와 thread 정합성 보장)

## 📝 리스트/sub-card 상세 표시 규칙 (필수)

**원칙**: hub/리스트의 sub-card 한 줄은 사용자가 **별도로 열어보지 않고도 즉시 판단 가능한 정보**를 모두 담는다. 카테고리별 핵심 식별자 + 도메인 수치 + 상태 라벨을 한 줄에 묶어 표시.

### 카테고리별 sub-card 라인 포맷

| 카테고리 | 한 줄 포맷 |
|---|---|
| **소모품** | `[YYYY-MM-DD] [규격 품목명 수량단위 처리구분] · 금액 · 미수 N원` |
| **AS** | `요청내용(60자) · 📅 접수 YYYY-MM-DD · 예정 YYYY-MM-DD HH:MM` |
| **신규** | `요청내용 · 📅 YYYY-MM-DD · 담당자 · 메모 N건 · D-day` |
| **VAN** | `VAN사 · TID · 신청/완료일 · 처리상태` |

### 소모품 품목 표시 매핑 (필수)

| `j.type` 값 | sub-card 표시명 |
|---|---|
| `소모품/POS용지` | `3" POS용지` |
| `소모품/단말용지` | `2" 단말용지` |
| `소모품/가격라벨` | `40×23 가격라벨` |
| `소모품/프라이스텍` | `70×35 프라이스텍` |
| `소모품/저울라벨` | `58×40 저울라벨` |
| `소모품/기타` | `기타` |

**필수 포함 요소**:
- **품목 + 규격** (예: `3" POS용지`) — 규격 없이 품목명만 표시 금지 (사용자가 어떤 규격인지 분간 못함)
- **수량 + 단위** (예: `3박스`) — 0/누락 시 표시 생략 가능
- **처리 구분** 라벨 + 색상 (🎁 지원 / 💰 선불 / 📌 후불 미수 / ✅ 수금완료)
- **금액** — 판매(선불/후불)일 때만. 후불 미수면 잔액 표시
- **날짜** — 항상 prefix `[YYYY-MM-DD]` (별도 규칙 — 날짜 기록 규칙 참조)

**금지**:
- 품목명만 표시 (`POS용지`) — 규격 누락
- 모드만 표시 (`지원`) — 수량/금액 누락
- 한 줄에 식별 정보 없이 모드 라벨만 (`[2026-05-21] [POS용지 🎁 지원]` ← 수량·규격 누락 사례)
- 두 줄로 쪼개서 한 줄당 한 정보 (좁은 폭 모바일은 예외)

**구현 위치**: `_hubRenderGroup` 의 `cat === 'supplies'` 분기 (sub-card titleHtml 생성).

**점검 체크리스트 (신규 품목/카테고리 추가 시)**:
- [ ] 카테고리별 sub-card 한 줄 포맷 정의
- [ ] 품목 → 규격 매핑 테이블 등록 (`SUPPLY_DISPLAY` 같은 상수)
- [ ] 빈 값 fallback (수량 0, 규격 없음 등)
- [ ] PC/모바일 양쪽 동일 표시 (m-core.js 에 공통 헬퍼 이상적)

## 📏 파일 크기 가드레일 (필수)

**원칙**: 한 파일 **4,000줄 초과 금지**. 초과가 예상되면 **그 자리에서 기능 단위로 자동 분할**한다 (미루지 않음).

| 임계 | 액션 |
|---|---|
| **신규 파일 작성** | 4,000줄 초과 예상 → **처음부터 기능 단위 모듈 분할** 설계 |
| **기존 파일 신규 코드 추가** | 추가 후 4,000줄 초과 → **그 작업 안에서 기능 단위로 분할** (새 기능/함수군을 별도 파일로 추출 후 로드). "다음에 정리" 금지 |
| **이미 4,000줄 초과인 파일** | 신규 코드 추가는 가능하되 **분할 부채 인식** + 신규 로직은 가능하면 별도 모듈로 빼서 추가 |
| **예외** | 자동 생성 데이터, vendor 번들, HTML 단일 SPA 의 마크업 (단 JS 로직은 외부 파일로 분리) |

**기능 단위 자동 분할 원칙 (필수)**:
- 분할 기준 = **기능/도메인 단위** (예: `sync` / `line` / `equipment` / `hub-render` / `supplies` / `van` …). 줄 수만 맞추려 임의 위치에서 자르지 말 것.
- 무빌드 구조: 분할 파일은 `<script src>` **순서 로드** (top-level 클래식 스크립트 → 전역 공유). 정의가 사용처보다 먼저, init 코드는 **맨 끝**.
- 분할은 **동작 보존**(순수 코드 이동) + 분리 파일 `?v=` **일괄 cache-bust** 의무.
- PC↔모바일 공유 로직은 아래 SSOT 규칙 준수 (`m-core.js`).

**현재 4,000줄 초과 파일** (분할 부채 — 실측 2026-06-10):
- `app.js` (**~21,700줄**) — PC 메인 스크립트. **유일한 초과 파일.** 분할 계획은 별도 수립 예정 (`.claude/plans/`).
- 그 외 `index.html`(~3,940) · `m-core.js`(~1,930) · `m/*`(1,500~1,960) · `app.css`(~1,230) — 모두 4,000 미만 (준수).
- 신규 `functions/api/*.js` — 전부 1,000 미만 (양호).

**도메인 로직 중복 방지 — Single Source of Truth**:
PC ↔ 모바일에서 동일하게 동작해야 하는 로직 (예: `_isNewJobClosed`, `classifyJobCategory`, openDate 가드, equipment 정규화) 은 **반드시 `m-core.js` 같은 공유 모듈에 정의 + 양쪽이 import/load**. 같은 규칙을 두 곳에 따로 구현하면 한 쪽만 고쳐서 불일치 발생 (예: 2026-05-21 엘마트 공릉점 PC↔모바일 종료 처리 불일치).

신규 함수가 PC + 모바일 양쪽에서 호출되면:
1. 우선 `m-core.js` 에 정의
2. PC index.html 은 `<script src="/m-core.js?v=...">` 로 로드 후 `window.x` 로 호출
3. 모바일 SPA 는 이미 m-core.js 로드 중

## UI 규칙 (글로벌 — 필수)

### 자동완성 / 검색 제안 드롭다운 — `Autocomplete` 헬퍼 사용 의무
새로운 input 자동완성·제안 드롭다운 UI 를 만들 때 **반드시** `index.html` 에 정의된 `Autocomplete` 헬퍼 사용. 다음 패턴 **금지**:

| 금지 패턴 | 이유 |
|---|---|
| HTML5 `<datalist>` | 모바일 클릭/터치 처리 불안정, JS 이벤트 가로채기 불가 |
| 직접 `onclick` 으로 항목 선택 | input `onblur → display:none` 이 먼저 발동해 클릭 누락 |
| 자체 dropdown state 관리 | blur/click race, 키보드 이동, ESC 닫기 등 동일 버그 반복 발생 |

**올바른 사용:**
```js
// 1) 한 번만 등록
Autocomplete.register('myKind', {
  search:     (q, key) => 결과배열,
  renderItem: (item, isActive) => '<div ...>내용</div>',
  onPick:     (item, key) => { /* 선택 처리 */ },
  maxItems:   8,                     // 선택 (기본 8)
  emptyMessage: '결과 없음',          // 선택
});

// 2) HTML 에서 표준 inline 핸들러 사용
//    input id 는 'myKindInput-${key}', dropdown div id 는 'myKindSuggest-${key}'
```
```html
<div style="position:relative">
  <input id="myKindInput-${key}"
         autocomplete="off"
         oninput="Autocomplete.live('myKind', '${key}', this)"
         onfocus="Autocomplete.live('myKind', '${key}', this)"
         onkeydown="Autocomplete.key('myKind', '${key}', event)"
         onblur="setTimeout(()=>Autocomplete.hide('myKind', '${key}'), 200)">
  <div id="myKindSuggest-${key}"
       style="display:none;position:absolute;top:100%;left:0;right:0;z-index:100;
              background:#fff;border:1px solid var(--gray-300);border-radius:5px;
              box-shadow:0 4px 12px rgba(0,0,0,0.1);max-height:240px;overflow-y:auto;margin-top:2px"></div>
</div>
```

**헬퍼가 자동 처리하는 항목:**
- ↑↓ 키보드 이동, Enter / Tab 선택, Esc 닫기
- 마우스 클릭 + 모바일 터치 (`onmousedown` + `ontouchstart` + `preventDefault` — input blur 차단)
- 활성 항목 하이라이트, `onmouseenter` 호버 변경
- 빈 결과 메시지

현재 등록된 kind: `store` (매장 검색), `assignee` (담당자 선택).

### Form 내 select + input 가로 배치 — `.search-row` 클래스 사용
검색 범위 셀렉트 + 검색어 입력 같은 한 줄 폼은 `<div class="search-row">` 로 감싸기. 전역 `select { width:100% }` 규칙 때문에 그냥 flex 로 묶으면 select 가 100% 폭을 차지하고 input 이 찌부러짐.

```html
<div class="search-row">
  <select>...</select>
  <input type="text">
</div>
```

### 촘촘한 업무형 레이아웃 — 정보 밀도 우선 (필수)

**원칙**: 이 사이트는 **업무형(내부 운영) 도구**다. 한 화면에서 많은 정보를 빠르게 보고 처리해야 하므로
**여백·폭을 최소화하고 정보 밀도를 높인다.** 컨슈머 랜딩페이지식 "넓고 시원한" 레이아웃 금지.

**필수 규칙:**

| 항목 | ✅ 올바름 | 🔴 금지 |
|---|---|---|
| **필터/검색 행** | 한 줄에 `display:inline-flex; gap:5~6px`, **내용 폭만큼만** 차지 | 한 줄을 꽉 채우거나(`width:100%`/`flex:1`) 항목마다 줄바꿈 |
| **기간(날짜 범위)** | `[기간] [시작일] ~ [종료일] [조회][당월]…` **한 줄**, date input 은 `width:135~140px` 고정 | 시작/종료를 두 줄로, 또는 date input 을 `width:100%` 로 늘림 |
| **input 폭** | 내용에 맞게 — date≈140px, 짧은 숫자/코드 80~120px, 검색어만 `flex:1` 허용 | 모든 input `width:100%` 남발 (전역 `select{width:100%}` 주의 — `.search-row` 사용) |
| **요약 카드/배지** | `flex:0 0 auto` 내용폭, padding 6~10px, 폰트 10.5~14px | `flex:1` 로 화면 전체에 균등 분할 |
| **버튼·라벨** | `btn-sm`, 폰트 11~12px, padding 4~10px | 큰 버튼/큰 폰트로 행 높이 키우기 |
| **카드/패딩** | padding 8~14px, gap 8~12px | padding 18px+ / gap 16px+ 로 한 화면에 몇 개 안 들어오게 |
| **그리드 리스트** | 행 padding 6~8px, 폰트 11.5~12px, 헤더 11px | 행 높이·폰트 과대 |

**레퍼런스 구현**: 소모품 판매 집계 모달(`suppliesReportModal` / `renderSuppliesReport`) — 필터 한 줄, date 140px, 요약 카드 내용폭.

**점검 체크리스트 (모든 신규 화면·폼·필터 작성 시 항상 확인):**
- [ ] 필터/기간 행이 **한 줄**이고 화면 폭을 꽉 채우지 않는가 (`inline-flex` + 내용폭)
- [ ] date/숫자 input 이 **내용 폭으로 고정**되었는가 (불필요한 `width:100%`/`flex:1` 없음)
- [ ] 요약 카드·배지가 `flex:1` 로 과하게 늘어나지 않는가
- [ ] 버튼·폰트·padding 이 업무형 밀도(작게)로 설정됐는가
- [ ] 한 화면(스크롤 1회 이내)에 충분한 정보가 들어오는가
- [ ] 모바일에서도 줄바꿈(`flex-wrap`)으로 깨지지 않는가

**금지**: 새 화면을 만들 때 "일단 넓게 잡고 나중에" — 처음부터 촘촘하게. 컨슈머식 hero/와이드 카드 레이아웃.

### 숫자·금액 입력/표시 — 1,000단위 구분기호 (필수)

**원칙**: 금액·수량 등 숫자 데이터는 **입력 중에도, 표시할 때도 1,000단위 콤마(`1,234,567`)** 를 적용한다. 사용자가 큰 금액을 자릿수 착오 없이 입력·확인할 수 있어야 한다.

| 상황 | 규칙 |
|---|---|
| **표시(읽기)** | 항상 `Number(v).toLocaleString('ko-KR')` 로 콤마 표기. 금액은 `… 원` 접미사. (예: `1,234,567원`) |
| **입력** | 🔴 `<input type="number">` **금지** — number 타입은 콤마를 못 넣는다. ✅ `type="text" inputmode="numeric"` + `oninput` 으로 입력 즉시 콤마 자동 삽입 |
| **저장** | 콤마 제거한 **순수 숫자**(`String(v).replace(/,/g,'')` → `Number`)로 저장. 콤마 포함 문자열을 그대로 저장 금지 |
| **소수** | 소수점(예: 반차 0.5일)이 필요한 칸은 정수부만 콤마, 소수부 보존 |

**입력 포맷 헬퍼 (권장 패턴)**:
```js
// 입력 중 콤마 자동 삽입 (소수점 1개 허용)
function fmtNum(el){
  let raw = String(el.value||'').replace(/[^0-9.]/g,'');
  const p = raw.split('.');
  let intp = p[0].replace(/^0+(?=\d)/,'');
  intp = intp ? Number(intp).toLocaleString('ko-KR') : '';
  el.value = p.length>1 ? (intp||'0')+'.'+p.slice(1).join('') : intp;
}
// 저장 직전: const num = Number(String(el.value).replace(/,/g,'')) || 0;
```
```html
<input type="text" inputmode="numeric" oninput="fmtNum(this)" placeholder="금액(원)">
```

**적용 대상**: 소모품 금액/수량, 재고조사 수수료·인건비·수금, 전자결재 금액 등 **모든 금액·수량 입력칸**. 신규 금액/수량 UI 추가 시 이 규칙 준수.

**금지**:
- `type="number"` 로 금액 입력 (콤마 미표시)
- 콤마 포함 문자열을 숫자 계산/저장에 그대로 사용 (NaN 위험 — 반드시 `replace(/,/g,'')` 후 `Number`)
- 표시 시 콤마 없는 raw 숫자 노출 (예: `1234567원`)

## 데이터 규칙 (필수)

### 작업 완료 판정 — `_isJobDone(j)` 헬퍼 사용
모든 작업의 "완료 여부" 판정은 **반드시** `window._isJobDone(j)` 함수 사용. 인라인 `j.status === '완료'` 체크 금지.

완료로 인정되는 상태값:
| 값 | 사용처 |
|---|---|
| `'완료'` | 신규/오픈/밴서류 등 일반 작업 |
| `'처리완료'` | A/S · POS · VAN · 단말기 처리 |
| `'done'` | 영문 호환 (구버전 데이터) |

**위치별 영향:** 진행중 카운트, AS 미처리 리스트, 신규관리 리스트, 최근 완료 작업, 완료 그리드 모달 — 모두 이 헬퍼 일관 사용. 새 종료 상태값(예: `'취소'`) 추가 시 이 헬퍼만 수정하면 전 화면 자동 적용.

### 담당자(engineer) vs 기록자(recordedBy) 분리
모든 작업 메모/상태 변경은 **두 사람을 구분해 기록**:

- **담당 (assignee/engineer)** = 실제 현장 처리자
- **기록 (recordedBy)** = 시스템에서 클릭한 사용자 (`_currentUserName()`)

두 사람이 다를 때 메모/일지에 `[담당 : *** / 기록 : ***]` 로 표시.
같을 때는 `[기록 : ***]` 로 간략화.

**저장 필드:**
- `job.createdBy` — 등록한 사용자
- `job.completedBy` — 완료 처리한 사용자
- `job.lastEditedBy` / `job.lastEditedAt` — 마지막 수정자/시각
- `job.memos[].assignee` / `job.memos[].recordedBy` — 메모별 두 사람 정보
- `pending.statusChangedBy` / `pending.statusChangedAt` — 등록 대기 상태 변경 추적

**공통 헬퍼:**
- `_currentUserName()` — 현재 로그인 사용자 이름 (없으면 '익명')
- `addJobMemo(job, text, opts)` — 표준 헤더 자동 부착 후 memos 추가

새 메모/이력 기록 시 `addJobMemo` 사용 권장. 직접 `job.memos.push()` 할 경우 위 필드들 수동 채워야 함.

### 🖥 매장 장비 DB — store.equipment[] (Plan B)
모든 매장 장비는 **인스턴스 단위** 로 `store.equipment[]` 에 저장. 카탈로그 변경/삭제와 무관하게 매장 데이터 영속.

**스키마 (v1):**
```js
{
  instanceId: 'eqi-{timestamp}-{rand}',  // 영구 안정 식별자 (이전/AS 연결 추적)
  catalogId:  'eq-server',                // 카탈로그 참조 (깨져도 OK)
  catalogVer: 1,                          // 등록 시점 스키마 버전
  // snapshot — 카탈로그 변경/삭제에 무관
  name, category, variant, options, size, condition,
  // 인스턴스
  qty, serialNo, costPrice, salePrice,
  // 라이프사이클 (절대 삭제 안 함)
  status: 'in_use'|'replaced'|'removed'|'disposed'|'transferred_out',
  installedAt, installedBy, sourceJobId, sourceJobItemIdx,
  history: [{at, kind, by, note}],
  updatedAt, updatedBy
}
```

**불변 규칙:**
- `instanceId` 는 절대 재사용/변경 금지
- `catalogId` 가 카탈로그에서 사라져도 매장 장비는 snapshot 으로 표시 (UI 에 ⚠ 표시)
- 카탈로그 이름/카테고리 변경 후 다시 매칭하고 싶으면 `findCatalogByName()` 호출 (자동 안 함)
- 폐기/제거시 `status` 만 변경, 데이터는 영구 보존 (audit trail)

**핵심 헬퍼 (모두 `window.*`):**
- `getStoreEquipment(storeRef)` — 매장 장비 목록
- `addStoreEquipment(storeRef, src, opts)` — 추가 (instanceId 자동)
- `updateStoreEquipment(storeRef, instanceId, patch, opts)` — 수정 (status 변경시 history 자동 추가)
- `transferStoreEquipment(fromStore, toStore, instanceIds)` — 매장간 이전 (양쪽 history 보존)
- `ingestJobEquipmentToStore(job)` — 작업의 checked 장비를 매장 DB 로 자동 적재
- `migrateJobEquipmentToStore()` — 1회성 마이그레이션 (페이지 로드시 자동, idempotent)
- `findCatalogByName(name)` — 이름으로 카탈로그 항목 매칭 (재배포/이름변경 대응)

**자동 트리거:**
- 페이지 로드 +1.5초: 마이그레이션 (한 번만)
- `completeNewopen()` 호출시: `ingestJobEquipmentToStore` 자동 실행
- `addStoreEquipment/update/transfer` 모두 `saveStores()` 호출 → 1.5초 debounce 후 `pushStoresToCloud()` → KV merge (sync.js `SERVER_PRESERVED_FIELDS` 에 `equipment` 포함)

**카테고리/카탈로그 재정리시:**
- 카탈로그 항목 ID(`eq-*`) 는 절대 변경/삭제 금지 — 변경하려면 신규 ID 발급 + 구 ID 는 그대로 두기
- 카탈로그 `category` 변경은 자유 — 매장 장비의 snapshot.category 는 영향 없음
- 새 분류 체계 도입시: `categoryV2` 같은 추가 필드 사용. 구 `category` 도 보존.
- 매장 장비 ↔ 카탈로그 재매칭이 필요하면 `findCatalogByName` 일괄 실행 후 catalogId 갱신

### 🔄 매장 데이터 동기화 — 정책 테이블 기반 머지 (필수 규칙)

매장 데이터 머지 정책은 **클라이언트와 서버가 동일** 해야 함. 양쪽 모두 `STORE_FIELD_POLICY` 사용.
- 클라이언트: `index.html` 의 `window.STORE_FIELD_POLICY`
- 서버: `functions/api/sync.js` 의 `STORE_FIELD_POLICY`

**정책 종류:**

| 정책 | 의미 | 예시 필드 |
|---|---|---|
| `kv-wins` | KV 가 항상 우선 (서버 자동 패치) | `storeRegDate`, `ecountRegDate` |
| `prefer-non-empty` | 비어있지 않은 쪽 우선 (기본) | `storeName`, `biz`, `ceo`, `address`, `phone` |
| `additive-by-id` | 인스턴스 추가 머지 (양쪽 보존) | `equipment` (instanceId), `contacts` (phone) |
| `additive-time-sorted` | 시간순 정렬 합본 | `memos`, `changeLog` |
| `aliases-union` | set union | `aliases` |
| `local-only` | KV 값 무시 (UI 임시 상태) | — |

**핵심 규칙:**
- **빈 배열 `[]` / 빈 객체 `{}` 는 '값 있음' 이 아니라 '없음' 처리** (이전 버그 반복 방지)
- 새 필드 추가 시: 정책 테이블에만 한 줄 추가하면 됨 (구현 변경 불필요)
- 클라이언트는 `window.mergeStoreObjects(loc, rem)` 사용
- 서버 `sync.js` 는 `mergeStoreObjects(incoming, kvOld)` 사용

**진단 도구:**
- `GET /api/sync-diagnostics` — 전체 매장 데이터 헬스 (빈 배열 카운트 등)
- `GET /api/sync-diagnostics?store=<name>` — 특정 매장 필드별 상태
- `POST /api/migrate-store-equipment` — 일괄 마이그레이션 (force/fixShape/createMissingStores 옵션)

**문제 발생 시 체크리스트:**
1. `/api/sync-diagnostics` 호출 — `shape` 가 `bare-array` 인지 확인
2. `emptyEquipment` / `emptyContacts` 카운트 확인 → 0 보다 크면 마이그레이션 endpoint 호출
3. 클라이언트와 서버의 `STORE_FIELD_POLICY` 가 동일한지 비교
4. 사용자에게 페이지 강제 새로고침 안내 (Ctrl+Shift+R)

### 🛡 동기화 무한 echo 차단 — dirty flag (필수)
이전에 client 가 sync 받자마자 1.5초 뒤 자동으로 같은 데이터를 KV 에 push 해서, 다른 endpoint (예: `/api/stores-patch-ecount`) 의 write 를 stale 데이터로 덮어쓰는 무한 echo loop 가 race condition 의 주된 원인이었음.

**규칙:**
- `saveStores(arr, opts)` — 사용자 편집은 그냥 호출 (`_storesDirty=true` + push 예약)
- `saveStores(arr, { fromSync:true })` — sync/server 에서 받아 저장할 때 (`dirty` 안 켜고 push 안 함)
- `pushStoresToCloud()` — `_storesDirty=true` 일 때만 실제 push 실행, push 성공시 dirty=false
- `pushStoresToCloud({ force:true })` — admin 강제 동기화 버튼 등 명시적 호출

**원리:**
- 사용자가 매장 데이터를 편집했을 때만 client → KV push 발생
- sync 로 KV 의 새 데이터를 받은 직후엔 push 안 함 → 다른 endpoint 의 작업물 보호
- Cloudflare KV PoP cache eventual consistency 한계를 client 측에서 회피

**위반시 증상:**
- bulk patch endpoint (예: `/api/stores-patch-ecount`) 결과가 client push 에 덮이는 race condition
- KV 의 신규 데이터가 30~60초간 사라졌다 나타났다 반복

### 🏪 매장 ↔ 작업 매칭 규칙 (필수 — 2026-06-10, 오케이마트 교차오염 사고)

**원칙**: 매장 상세·이력 등에서 "이 매장의 작업"을 고를 때 매칭은 **오직 두 가지만**:
1. **storeId 정확 일치** (`job.storeId === store.id`) — 유효한 storeId 가 **다른 실존 매장**을 가리키면 이름이 같아도 제외 (**한 작업 = 정확히 한 매장**)
2. **식별 키 정확 일치** (본명 또는 `aliases` — **`_normStoreKey`**(소문자+공백제거만) 후 `===`)

**🔴 절대 금지 ① — `_normalizeSearch` 를 식별 비교에 사용**:
`_normalizeSearch` 는 법인표기(주식회사/(주) 등)를 제거하는 **검색 전용** 함수다.
`_normStoreKey('오케이마트') ≠ _normStoreKey('오케이마트주식회사')` 이지만
`_normalizeSearch` 는 둘 다 `'오케이마트'` 로 만들어 **별개 매장이 이름으로 사실상 병합**된다
(2026-06-10 오케이마트(노원) ↔ 오케이마트주식회사(여주) 교차오염 — 양쪽에 같은 작업 노출, 한쪽 삭제 시 양쪽 소실).
매장 식별·그룹화·자동 재연결·AS 통합·병합 rerouting 은 **반드시 `_normStoreKey`**.

**🔴 절대 금지 ② — 부분 문자열 포함 매칭**:
```js
// 🔴 금지: 다른 매장 작업이 섞여 들어옴
if (s.includes(nameKey) || nameKey.includes(s)) return true;
```
- `"오케이마트"` ⊂ `"오케이마트주식회사"`, `"그린마트"` ⊂ `"현대그린마트(목동)"`, `"백제한우"` ⊂ `"백제한우 부평점"` 처럼 **상호가 다른 상호의 부분문자열인 모든 쌍**에서 교차오염 발생. (2026-06-10 감사: 작업 보유 매장 기준 **286쌍**이 영향권이었음 — 병합 안 했는데 합쳐져 보이는 사고.)

**storeId 무결성**: 작업의 `storeId` 는 **그 작업 storeName 과 정규화 이름이 일치하는 매장**을 가리켜야 한다. storeId 가 엉뚱한 매장을 가리키면(오연결) 정확일치 매칭에서도 잘못된 매장에 노출됨. 자동 연결·import 시 이름 검증 필수.

**점검 명령** (매장 매칭 코드 추가·수정 후 **반드시 실행** — 위반 시 exit 1):
```bash
bash scripts/check-store-key.sh
# → ① _normalizeSearch 식별 오용(=== / .has / storeByName build) 탐지
#   ② 통과 시 "✅ 매장 식별 정규화 정상"

# (수동) 부분일치 store 매칭이 새로 들어왔는지 (검색창 .includes(search) 제외)
grep -rnE "includes\(nameKey\)|nameKey\.includes|s\.includes\(.*[Ss]tore" app.js m-core.js
# → 매장-작업 매칭부에 0 이어야 함
```

**정규화 함수 2종 — 용도 엄수**:
| 함수 | 처리 | 용도 |
|---|---|---|
| `_normStoreKey(s)` | 소문자 + 공백 제거만 (**법인표기 보존**) | **매장 식별/매칭** (`===`, `Set.has`, `storeByName` 인덱스, 그룹 키, 자동 재연결, AS 통합, 병합 rerouting) |
| `_normalizeSearch(s)` | + `주식회사`·`(주)`·괄호·구두점 제거 | **검색 전용** (검색창 `.includes`, suggest 드롭다운) — 식별 비교에 쓰면 별개 매장 병합됨 |

**구현 위치**: 매장 상세 작업 이력(`_hubRenderGroup`/store detail `matched`), hub 그룹화(`_hubGroupByStore` — 이미 storeId/정규화 키), 신규/AS 자동 통합(`saveNewJob`/`approvePending` — 정규화 정확일치 사용).

## 운영 규칙

### 🚨 파싱 오류 알림 (필수)
LINE 메시지 파싱(`/api/line-parse-cron`) 에서 다음 상황 발생 시 **반드시** `line_config.alertRecipientId` 로 LINE Messaging API push 발송:

| 트리거 | kind | 발송 메시지 |
|---|---|---|
| 메시지 `MAX_RETRY`(3회) 재시도 후 영구 실패 | `giveup` | giveup 건수 + 메시지 샘플 3개 + 원인 안내 |
| 한 cron 에서 3개 이상 룸 파싱 실패 | `many_errors` | Claude API/네트워크 문제 가능성 안내 |
| Claude API 키 미설정 (503) | `no_api_key` | 설정 요청 |
| overflow 100건 이상 누적 | `overflow` | 다음 cron 이 이어 처리 안내 |

- 같은 `kind` 알림은 10분 내 중복 송신 차단 (`ALERT_THROTTLE_KEY = 'line_alert_lastsent'`)
- 알림 발송 헬퍼: `line-parse-cron.js` 의 `notifyLineAlert(env, cfg, kind, text)`
- 새로운 실패 케이스 추가 시 이 규칙 표에 행 추가 + `notifyLineAlert` 호출

### 업무 구분 (lineCategory) — 8개 분류
모든 LINE 메시지 파싱 결과는 다음 8개 카테고리 중 하나로 매핑:

| 코드 | 라벨 | 설명 |
|---|---|---|
| `pos_as` | 🖥 POS A/S | POS 단말기·키오스크·프린터 고장/수리 |
| `van_as` | 💳 VAN A/S | VAN 단말기(카드결제기) 통신·인식 오류·수리 |
| `device_mgmt` | 📱 단말기 A/S | 이동단말기(휴대용/무선) 수리·개통·전산등록·반품 |
| `open_store` | 🏪 오픈 작업 | 신규 매장 설치·세팅·가오픈/오픈 일정 |
| `van_doc` | 📑 밴서류 | 카드가맹 신청·심사·완료·상호/주소/계좌 변경 |
| `label` | 🏷 라벨지 | 라벨지 발주·출고·재고 |
| `equip_out` | 📦 장비 출고 | 장비 출고·발주·반품 |
| `delivery` | 🚚 택배 | 택배 발송·수령·반품 |
| `ignore` | ⚪ 기타/무시 | 잡담·인사·확인 등 업무 무관 |

**구버전 호환:** 이전 `as_pos_van` 값은 `pos_as` 로 마이그레이션 처리.

### 채팅방 분류 방식 (parseMode)
- `fixed` — 모든 메시지를 룸 타입으로 자동 분류 (Claude 미호출, 토큰 절약)
  - 적용 카테고리: `label`, `equip_out`, `delivery`
- `mixed` — Claude 가 메시지마다 분류 (AS·밴서류 등 혼합 룸)
  - 룸 type 은 분류 힌트로만 사용: `general`/`as`/`work`/`schedule`

### Cursor / 재시도 정책
- `MAX_MSGS_PER_RUN = 200` — 한 cron 당 최대 처리 메시지 수
- `MAX_RETRY = 3` — 재시도 한계
- cursor (`line_parse_lastrun`) 진행 규칙:
  - retry 대기 메시지의 (min ts − 1) 까지만 이동
  - retry 대기 없으면 fresh 중 max ts 로 이동
- 큐 아이템 메타 필드: `processedAt`, `parseAttempts`, `processedStatus`, `lastParseError`

### 🔁 Cron 이중화 — LINE 파싱 트리거
LINE 메시지 파싱 cron 은 **3중 방어** 구성:

| 계층 | 트리거 | 일정 (KST) | 비고 |
|---|---|---|---|
| 1차 | Cloudflare Worker `neoretail-cron` | 매시 45분 | 가장 안정적, Cloudflare 내부 |
| 1차-보완 | 같은 Worker (watchdog cron) | 매시 55분 | 1차가 실패해도 10분 후 자동 보완 |
| 2차 | GitHub Actions `line-parse.yml` | 매시 50분 | GHA 드롭 대비 백업 |
| 3차 | watchdog 알림 | endpoint 실행시 매번 | 90분 이상 묵은 메시지 감지 → LINE 푸시 |

- 모든 트리거가 동일한 endpoint `/api/line-parse-cron` 을 호출 — endpoint 가 idempotent
- 한 번 처리된 메시지는 `processedAt` 마크되어 중복 처리 안 됨
- Cloudflare Worker 배포: `cd cron-worker && npm install && npx wrangler deploy`
- Worker 시크릿: `npx wrangler secret put LINE_PARSE_SECRET` (= line_config.parseSecret)
- watchdog 알림 종류: `cron_stale` (10분 throttle)

## 배포

- Cloudflare Pages 자동 배포 (`master` push 후 1~2분)
- Cloudflare Worker `neoretail-cron` 는 수동 배포 (`wrangler deploy`) — cron 트리거만 사용
- 도메인: `work.neoretail.net`
- KV: `STORES_KV`
- 주요 KV 키: `stores`, `line_config`, `line_raw_queue`, `line_pending`, `line_parse_lastrun`, `line_parse_log_<YYYY-MM-DD>`, `line_alert_lastsent`

## 🚫 완료(done) 환원 금지 규칙 (2026-05-22 추가, 샤르르 reopen 루프)

**문제**: 멀티 디바이스 환경에서 한 기기가 AS/업무를 완료해도 다른 기기에서 다시 진행중으로 살아나는 reopen 루프.

**원인** (3가지 동시 발생):
1. `approvePending` (LINE→AS 자동 통합) 가 진행중 AS 후보 없으면 **가장 최근 완료건을 골라 thread 추가 + 상태 환원** → 새 ROOT 추가될 때마다 완료가 풀림.
2. `_selfHealJobStatuses` (모바일) 가 thread 미완료 ROOT 감지 시 **`완료 → 진행중` 자동 환원**. stale local thread (다른 기기 완료 child 미동기화) 가 cloud 완료를 덮어씀.
3. `_mergeJobRecord` 가 `Object.assign({}, cloudJob, localJob)` 로 **local 의 stale `status='진행중'` 이 cloud 의 `'완료'` 를 덮음** (completed 플래그만 union 되고 status 는 안 됨).

**해결 규칙 (필수, 절대 되돌리지 말 것)**:
- ❌ `approvePending` 은 **완료된 AS 에 절대 머지하지 않음** — 진행중 후보 없으면 새 job 등록.
- ❌ `_selfHealJobStatuses` 는 `완료 → 진행중` **자동 환원 금지** — 정방향(인 완료→완료)만 허용. 진짜 reopen 은 사용자 명시적 thread 편집 시에만.
- ✅ `_mergeJobRecord` 는 `completed===true` 면 `status` 도 완료계열(`'완료'`/`'처리완료'`)로 강제 동기화. local stale '진행중' 이 절대 cloud '완료' 를 덮지 못하도록.
- ✅ 완료 (`completed: true`) 는 **sticky** — 자동 헬퍼는 풀지 않음. 수동 reopen 만 가능.

**테스트**: 두 기기 A, B 에서 동일 AS 가 진행중일 때 A 에서 완료 처리 → 30초 후 B sync → B 의 카드도 완료로 표시 → A/B 모두 새로고침 후에도 유지.

## 🪦 삭제 부활(resurrection) 차단 규칙 (2026-05-22 추가, 샤르르 부활 루프)

**문제**: 한 PC에서 업무를 삭제해도 다른 PC의 localStorage 에 남아 있으면, 그 PC가 wholesale POST 할 때 cloud 에 다시 등록됨. 무한 부활.

**3중 방어선 (필수, 모두 유지)**:

1. **서버측 — `POST /api/jobs` 가 `deleted_jobs` 레지스트리 ID 를 자동 필터링** (`functions/api/jobs.js`). 어떤 클라이언트가 push 해도 등록된 ID 는 KV 에 저장되지 않음.

2. **클라이언트측 — `_addTombstone('job', id)` 호출 시 `_cloudDeleteJobIds([id])` 자동 호출** (`index.html`). SYNC_SECRET 토큰이 있는 PC 라면 `/api/admin-delete` 로 cloud 레지스트리 등록 + `resync_token` bump → 모든 기기 자동 정합화.

3. **`resync_token` 자동 정합화** (`functions/api/jobs.js`, `index.html`, `m-core.js`). admin-delete 가 토큰을 bump 하면 다른 기기는 sync 시 토큰 불일치 감지 → localStorage 강제 wipe & cloud pull.

**테스트**: 한 PC 에서 업무 X 를 삭제 → 다른 PC 에서 X 가 진행중이던 상태로 ANY edit & push → cloud `/api/jobs` 에 X 가 등록 안 됨 (서버 필터링). 30초 이내 다른 PC 도 X 가 사라짐 (resync_token bump).

**관리자 토큰 없는 PC** 라면: 그 PC 의 삭제는 cloud 레지스트리에 등록 안 되지만, 다른 토큰 보유 PC 가 같은 ID 를 한 번이라도 삭제하면 영구 차단됨. 또는 서버측 1차 방어선이 wholesale push 의 부활을 막음 (단, 등록 전까지는 일시적으로 살아날 수 있음).

## 📋 리스트·Hub 기본 표시 규칙 (필수 — 2026-05-22 추가)

**원칙**: 모든 메뉴(PC/모바일)에서 **진행 중(미완료) 건을 기본 화면에 표시**하고, 완료 건은 탭/필터 전환 시 확인.

### 기본 필터 (Default Filter)

| 화면 | 기본 필터 | 비고 |
|---|---|---|
| **AS 관리** (`asmgmt`) | `pending` (미처리) | `_asMgmtFilter = 'pending'` |
| **AS Hub** (`ashub`) | `progress` (진행 중) | `.hub-filter active` = `data-filter="progress"` |
| **신규 Hub** (`newhub`) | `progress` (진행 중) | 위 동일 |
| **VAN Hub** (`vanhub`) | `progress` (진행 중) | 위 동일 |
| **소모품 Hub** | `progress` (진행 중) | 위 동일 |

### 정렬 규칙 (Sort Order)

모든 리스트에서 공통 적용:

1. **미완료 건 → 위 (최신 접수 순 desc)**
2. **완료 건 → 아래 (최신 완료 순 desc)**

```js
view.sort((a, b) => {
  const doneA = isDone(a), doneB = isDone(b);
  if (doneA !== doneB) return doneA ? 1 : -1;   // 미완료 먼저
  if (!doneA) return mtime(b) - mtime(a);        // 미완료: 최신 접수 순
  return completedAt(b) - completedAt(a);         // 완료: 최신 완료 순
});
```

### AS 상세 모달 — 완료 버튼 (필수)

AS 카테고리 (`cat === 'as'`) 상세 모달 footer 에는 반드시:
- **미완료 상태**: `✅ AS 완료 처리` 버튼 → `completeAsJobDirect(jobId)` 호출
- **완료 상태**: `↩ 진행으로 되돌리기` 버튼 + 완료 시각 표시

단순 안내 텍스트만 두고 버튼 없이 두는 것 금지 — 모바일에서 완료 처리 불가.

### 금지 사항
- 전체(`all`) 필터를 기본값으로 설정 (완료 건이 상단을 채워 미완료 건 찾기 불편)
- 진행 중 건을 오래된 순(asc)으로 정렬 (가장 최근 접수 건을 아래 밀어버림)
- AS 상세 모달에 완료 버튼 없이 텍스트 안내만 표시

## 🔥 마지막 요청 삭제 → 업무 cascade 삭제 규칙 (2026-05-22 추가)

**문제**: AS 페이지에서 "요청 삭제" 누르면 thread ROOT 만 사라지고 job 본체는 `thread=[]` 인 채로 남음 → 대시보드/매장 정보에 ghost 카드로 표시됨 → 클릭 시 `editNewopen` 이 `lineParsed/asRequest/notes` 에서 자동 시드 + **즉시 saveJobs** → **부활**.

**해결 (필수)**:
1. `_removeThreadNode` (index.html:~20630): ROOT 삭제 결과 남은 ROOT 가 0개이고 카테고리가 AS/신규면 **job 전체 cascade 삭제** (`_addTombstone('job', id)` + splice + push). 모달 자동 닫힘.
2. `editNewopen` 자동 시드 (index.html:~21942): **즉시 `saveJobs` 호출 금지** — display-only. 그리고 같은 jobId 의 ROOT 가 한 번이라도 tombstone 됐으면 시드 자체를 skip.
3. `hydrateDashboardJobs` AS 필터 (index.html:~17141): `thread.length===0` 이고 같은 jobId 의 tombstone 이 존재하면 dashboard 에서 숨김 (defense-in-depth).

**테스트**: AS 페이지에서 마지막 요청 삭제 → AS 탭/대시보드 AS 미처리/매장 정보 AS 이력 모두에서 동시 제거. 다시 클릭해도 안 살아남.

## 🕐 per-job mtime + 서버측 머지 (2026-05-22 추가, 구조적 부활 차단)

**문제 본질**: wholesale POST + last-write-wins 구조에서는 stale 한 PC가 POST 하는 순간 cloud 가 stale 상태로 회귀. 누가 어떤 job 을 언제 수정했는지 서버가 모르기 때문에, 같은 job 의 새 버전 vs 옛 버전 구분 불가.

**해결 (구조 변경)**:

### 1. 클라이언트 — `saveJobs` 가 변경된 job 만 `updatedAt` 자동 스탬프
- `ns_jobs_snap` localStorage 키에 각 job 의 hash 저장 (`_jobHashForMtime` — `updatedAt` 필드 제외)
- `saveJobs(arr)` 호출 시 snapshot 과 비교, 해시 다른 job 만 `updatedAt = now()` 갱신
- 결과: 사용자가 실제로 수정한 job 만 mtime bump. cloud 에서 pull 한 job 은 그대로.

### 2. 클라이언트 sync — cloud 머지 후 snapshot 동기화 (`_refreshJobsSnap`)
- `syncJobsFromCloud` 가 merged 결과를 localStorage 에 쓴 직후 `_refreshJobsSnap()` 호출
- 결과: 다음 saveJobs 호출 시 cloud-pulled job 들이 "변경됨" 으로 오인되지 않음 → 불필요한 push 차단

### 3. 서버 — POST `/api/jobs` 는 per-job 머지 (`functions/api/jobs.js`)
- 기존 KV 의 jobs 를 읽음
- 각 incoming job 에 대해: 기존 cloud 의 같은 id 가 더 최신 `updatedAt` 이면 기존 유지, 아니면 incoming 으로 교체
- **클라이언트가 보내지 않은 cloud job 은 그대로 유지** (omission = 삭제 아님)
- 삭제는 `/api/admin-delete` + `deleted_jobs` 레지스트리로만 가능

**효과**: A PC 가 X 를 완료/삭제 → cloud 에 새 mtime 으로 기록. B PC 가 stale X 를 wholesale POST → 서버가 mtime 비교 후 기존 cloud 버전 유지 → B 의 stale push 가 cloud 를 덮어쓰지 못함. 다음 sync 에서 B 는 cloud 의 새 X 를 받음.

**테스트**: PC A 에서 업무 X 완료 → PC B (sync 안 함) 에서 다른 업무 Y 수정 후 자동 push → 서버 응답 `kept: N` (X 가 stale 이라서 keep) 확인. 30초 후 PC B sync → X 완료 상태로 동기화됨.

**관련 mtime 필드**: `updatedAt` (우선), `lastEditedAt`, `createdAt`. 서버 머지는 이 순서로 fallback.
