# AS 업무 구조 — 안정화 문서 (2026-05-16)

> 본 문서는 오늘 진행한 AS 관련 리팩토링의 데이터 모델·UI 흐름·회귀 방지 체크리스트입니다.
> 코드 수정 시 이 문서의 가정을 깨지 않도록 주의하세요.

## 1. 핵심 원칙

| 원칙 | 의미 |
|---|---|
| **매장당 단일 AS 집계** | 한 매장의 모든 AS 요청은 ns_jobs 의 **단일 job 레코드** 에 누적 (완료 여부와 무관) |
| **ROOT 단위 카운트** | AS 1건 = 요청접수 ROOT 1건. job 갯수와 무관 |
| **등록 = 즉시 영구 저장** | "+ 새 요청 접수 → 등록" 클릭 순간 ns_jobs 에 저장 + 클라우드 푸시 (draft 미경유) |
| **장비는 처리 기록에 종속** | "+ 장비 추가" 는 child.equipment 에만 보관, job.equipment 미사용 |
| **thread 가 진실의 원천** | AS 상태/진행/완료는 thread 의 진행/완료 child 가 결정. 별도 status 픽커 없음 |

## 2. 데이터 모델

### `ns_jobs[].thread[]` (AS / 신규 공용)

```js
[
  // ROOT (요청접수) — parentId === null
  { threadId: 'TR-...', parentId: null, ts, author, status: '요청접수', text },

  // child (진행/완료) — parentId 가 부모 ROOT 의 threadId
  { threadId: 'TR-...', parentId: 'TR-rootid', ts, author, status: '진행', text,
    equipment: [ { name, variant, qty, condition, ... } ]  // optional
  },
  { threadId: '...', parentId: 'TR-rootid', ts, author, status: '완료', text },
]
```

### `_groupStatus(root, children)` — ROOT 의 종합 상태

- 자식 중 `'완료'` 있으면 → `'완료'`
- 자식 중 `'진행'` 있으면 → `'진행'`
- 아니면 → `'요청접수'`

### `job.completed` 동기화 규칙 (`_setThreadFor`)

- **모든 ROOT 가 완료 child 를 가질 때만** `completed = true`, `status = '완료'`
- 그 외에는 `completed = false`, `status = '진행중'`
- ⚠ 단일 ROOT 가 완료됐다고 job 전체가 completed 되면 안 됨 (이전 회귀 버그)

## 3. UI 흐름

### AS hub → newJobModal → 등록 흐름

```
[+ AS 업무 등록] (AS hub)
  ↓ openNewJobFor('as') → _currentJobContext = 'as'
[showModal newJobModal]
  ↓ applyJobFormContext('as')
  · body.as-mode + body.thread-mode 부여
  · jobType = 'AS 처리', AS 접수정보 노란박스는 display:none (deprecated)
  · _jobThreadDraft = [] + __newroot__ 폼 자동 펼침

[사용자 매장 선택] → pickJobStore
  ↓ _applyAsInlineEditMode(storeName)
  · 매장 그대로(_lastAsInlineStore) → draft 유지
  · 매장에 진행/완료 AS 있음 → _asInlineEditJobId = existing.id
    · body.as-inline-edit-mode (주소/일정/담당자 숨김)
    · 안내 배너 노출 "기존 AS 업무에 누적 기록 중"
    · 기존 thread 를 maxRoots:5 로 렌더 (전체보기 토글 가능)
    · 푸터 [작업 등록] → [완료]
  · 매장에 AS 없음 → draft + __newroot__ 자동 펼침

[사용자 "+ 새 요청 접수" → 텍스트 입력 → 등록]
  ↓ _submitNewRoot(containerId, '', true)
  · draftMode + ctx=='as' 분기:
    · 동일 매장 AS 검색 (진행/완료 무관, 진행 우선)
    · 발견 → existing.thread 에 ROOT append + 즉시 saveJobs + pushJobsToCloud
    · 없음 → 새 AS job 생성 + ns_jobs.unshift + 즉시 저장/푸시
    · _asInlineEditJobId 설정 → 인라인 편집 모드로 자동 전환
  · 토스트 + hydrate (대시보드/AS hub/AS관리 갱신)

[사용자 진행/완료 child 추가]
  ↓ _submitChild(containerId, jobId, false, rootId, formId)
  · child entry push + _setThreadFor → saveJobs + 즉시 push
  · 폼 임시 장비(_threadChildEquipDraft[formId]) → entry.equipment 에 저장
  · job.equipment 에는 누적 X (요청건 단위 추적)
  · 완료 child 추가 시 해당 ROOT 자동 접힘

[모달 닫기 (✕ / [완료])]
  ↓ closeModal
  · 잔여 draft 있고 인라인편집 아니면 confirm
  · _asInlineEditJobId / body class / footer label / banner 리셋
  · _jobThreadDraft = []
```

### 매장 정보 모달 — AS 탭 / 진행 중 탭

- **진행 중 탭** (`detailOngoingList`): AS/신규는 **미완료 ROOT 마다 1카드** (root.text 본문). VAN/소모품은 job 단위
- **🔧 AS 탭** (`detailAsList`): ROOT 단위 표시 + 5건 룰
  - 미완료 ≥ 5 → 미완료만 (무제한)
  - 미완료 < 5 → 미완료 + 최근 완료 채워 총 5건
  - 모두 완료 → 최근 5건 + `📂 전체보기 (N건 완료)` 인라인 펼침
  - 카드 클릭 → 해당 job 의 `editNewopen`

### AS hub 화면 — `_hubGenericRender(byRoots:true)`

- 카운트(전체/진행/완료/긴급): **ROOT 단위**
- 카드 헤더: `N 요청 · 총 M건`
- 매장 카드 안 서브 리스트: ROOT 별, 미완료 먼저, ts 최신순, 최대 8건

### 편집 모달 (`editNewopen`) — AS / 신규 공용

- 카테고리가 AS 면:
  - `📌 매장 주요 일정` (설치/가오픈/오픈) **숨김**
  - 하단 `🏪 누적 설치 장비` / `📦 설치되어야 할 장비` 테이블 / 장비 picker **모두 숨김**
  - 푸터 옛 4-state picker 제거 → 안내 문구만
  - 스레드 maxRoots = 5 적용 + 전체보기 토글
- 카테고리가 new/as 모두 `🗒 메모` 위치 유지
- `📝 비고 / 특이사항` 박스는 모달 최하단 (푸터 직전)

## 4. 데이터 동기화 안전장치

### Cloud 머지 정책 (`syncJobsFromCloud`)

- 동일 `id` 충돌 시 `_mergeJobRecord(local, cloud)` 로 **union 머지**:
  - thread: `threadId` 기준 dedupe (없으면 `ts|text`)
  - memos: `at|text` dedupe
  - vandocs: local 우선
  - `completed = local.completed || cloud.completed`
- 머지 발생 시 즉시 재푸시 → stale cloud 가 자동 복구

### 즉시 푸시 위치 (debounce 우회)

- `saveNewJob` AS-merge 분기
- `_setThreadFor` (편집 모드 thread 변경)
- 신규 AS job 생성 (`_submitNewRoot` draft → live 전환)

→ 이 세 곳은 1.5초 debounce 갭에서 stale cloud 가 덮어쓰는 사고 차단.

## 5. 마이그레이션

### `migrateAsJobsToAggregate` (자동 1회 실행)

- 플래그: `localStorage._as_aggregate_migration_v2`
- 매장별 AS job 그룹화 → 가장 오래된 job 을 canonical 로 보존
- 나머지 job 들의 thread/asRequest/notes/equipment/memos 를 canonical 에 merge
- 합병된 원본 jobs 는 ns_jobs 에서 삭제
- AS 분류이지만 type 이 AS 아닌 job 은 `type='AS 처리'` 로 정규화 (_originalType 백업)
- 결과 토스트 + dashboard/AS hub 갱신

### 수동 재실행:

```js
window.migrateAsJobsToAggregate({ force: true })
```

## 6. 진단 도구

```js
// 매장의 AS 상태 검사
window.diagnoseStoreJobs('정이가마트')
window.diagnoseStoreJobs('625-85-01902')

// 작성자 이름 일괄 치환 (옛 Live Wire 잔여 정리)
window.replaceAuthorName('Live Wire', '이동호')
```

## 7. 회귀 방지 체크리스트

코드 수정 시 다음 동작이 깨지지 않아야 합니다:

### A. 데이터 보존
- [ ] AS hub → 매장 선택 → "+ 새 요청 접수 → 등록" → 모달을 ✕ 로 닫아도 ns_jobs 에 저장됨
- [ ] "+ 새 요청 접수" 등록 시점에 즉시 cloud 푸시 (debounce 없이)
- [ ] 다른 PC 에서 cloud 가 stale 해도 새로고침 시 union 머지로 thread ROOT 손실 X

### B. 매장당 1 AS job
- [ ] 같은 매장에 두 번째 AS 등록 시 별도 job 생성되지 않고 기존 thread 에 ROOT append
- [ ] 완료된 AS 가 있어도 같은 매장의 새 요청은 그 job 의 thread 에 ROOT 추가 (isDone 필터 금지)
- [ ] 완료 child 추가 후에도 다른 ROOT 가 미완료면 `job.completed = false` 유지

### C. UI 일관성
- [ ] AS 편집 모달에 옛 `📋접수 / 🚗방문예정 / 🔁재방문필요 / ✅처리완료` 4-state picker 다시 나오면 안됨
- [ ] AS 편집 모달에 설치 예정일/가오픈일/오픈일 (신규 전용) 노출 X
- [ ] AS 편집 모달 하단에 `📦 설치되어야 할 장비` 테이블 노출 X
- [ ] 비고/특이사항 박스는 모달 최하단
- [ ] AS 스레드는 최대 5건 표시 (미완료 우선) + 전체보기 토글
- [ ] 완료된 ROOT 헤더에 요청 본문 한 줄 요약 표시

### D. 카운트 / 통계
- [ ] AS hub 카운트는 ROOT 단위 (매장 단위 X)
- [ ] 매장 정보 모달의 AS 탭 카운트는 ROOT 단위
- [ ] 매장 정보 모달 진행 중 탭에 미완료 ROOT 마다 1카드 (요청 본문 노출)

### E. 작성자
- [ ] `_whoNow()` 는 항상 `_currentAuthName()` 사용 (jobEngineer 무관)
- [ ] `_currentAuthName()` 은 ns_users 의 최신 이름 우선 조회
- [ ] 관리자 페이지에서 이름 변경 시 신규 기록부터 즉시 반영

## 8. 핵심 함수 위치 (line ranges — 2026-05-16 기준)

| 함수 | 라인 | 역할 |
|---|---|---|
| `_mergeJobRecord` | ~10818 | cloud/local job 안전 머지 |
| `syncJobsFromCloud` | ~10860 | 페이지 로드 시 머지 동기화 |
| `pushJobsToCloud` | ~10893 | 즉시 푸시 |
| `migrateAsJobsToAggregate` | ~11200 | AS 통합 마이그레이션 |
| `saveNewJob` | ~11407 | 등록 (AS 머지 정책 포함) |
| `_applyAsInlineEditMode` | ~11734 | 매장 선택 시 인라인 편집 진입 |
| `_refreshJobSimilarBanner` | ~11806 | 동일 매장 진행 업무 미리보기 |
| `_renderThreadGroups` | ~14251 | 스레드 렌더러 (maxRoots 지원) |
| `_submitNewRoot` | ~14550 | "+ 새 요청 접수" → 즉시 영구 저장 |
| `_submitChild` | ~14700 | 진행/완료 child + child.equipment |
| `_setThreadFor` | ~14400 | thread 저장 + completed 재평가 + 즉시 푸시 |
| `_threadMigrate` | ~14150 | flat → grouped 데이터 정규화 |
| `_sdvFillAsRootList` | ~16970 | 매장 정보 AS 탭 ROOT 렌더 |
| `sdvJobCard(j, cat, root)` | ~16828 | 진행 중 탭 카드 (ROOT 인자) |
| `editNewopen` | ~15280 | 작업 편집 모달 |
| `_whoNow` | ~14541 | 작성자 (항상 _currentAuthName) |
| `_currentAuthName` | ~16730 | 로그인 사용자 이름 (ns_users 우선) |

## 9. 알려진 제약

- AS 마이그레이션은 자동 1회만 실행. 새 중복이 다시 생기면 `migrateAsJobsToAggregate({force:true})` 로 재정리
- 미등록 매장(unregistered) 의 AS 는 매장 정규화 키로 그룹핑되므로 같은 매장명이어도 매장 등록 후엔 별도 키로 분리될 수 있음
- 옛 `Live Wire` 같은 박힌 작성자 이름은 `replaceAuthorName` 으로 일괄 치환 필요
