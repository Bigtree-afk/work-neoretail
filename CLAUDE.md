# work.neoretail.net — 프로젝트 규칙

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
