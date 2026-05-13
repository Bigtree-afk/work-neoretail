# work.neoretail.net — 프로젝트 규칙

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
