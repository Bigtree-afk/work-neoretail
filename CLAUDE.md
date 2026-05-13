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

## 배포

- Cloudflare Pages 자동 배포 (`master` push 후 1~2분)
- 도메인: `work.neoretail.net`
- KV: `STORES_KV`
- 주요 KV 키: `stores`, `line_config`, `line_raw_queue`, `line_pending`, `line_parse_lastrun`, `line_parse_log_<YYYY-MM-DD>`, `line_alert_lastsent`
