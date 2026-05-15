# NeoRetail — 작업 계획 리스트

## ✅ 완료된 작업

### 인프라 / 안정성
- [x] LINE 파싱 cron **3중 방어** — Cloudflare Worker(주) + GitHub Actions(보조) + endpoint 내 watchdog
- [x] 라인 알림 (giveup / many_errors / no_api_key / overflow / cron_stale)

### 매장 장비 DB (Plan B)
- [x] `store.equipment[]` 인스턴스 단위 + snapshot 모델 (`STORE_EQUIP_SCHEMA_VER=1`)
- [x] 헬퍼: `getStoreEquipment` / `addStoreEquipment` / `updateStoreEquipment` / `transferStoreEquipment` / `ingestJobEquipmentToStore` / `migrateJobEquipmentToStore` / `findCatalogByName`
- [x] 매장 상세 모달의 장비 패널 풀 재작성 (활성/이력 분리 + [편집] [상태변경] [+ 추가])
- [x] 작업 완료시 자동 적재 hook (`completeNewopen`)
- [x] **서버사이드 일괄 마이그레이션 endpoint** (`/api/migrate-store-equipment`)
  - `includeUncheckedPending` / `createMissingStores` / `fixShape` 옵션
- [x] 기존 데이터 전수 적재: **8개 매장 / 36 인스턴스**
- [x] `sync.js` 의 `SERVER_PRESERVED_FIELDS` 에 `equipment` 추가

### UI 버그 수정
- [x] 대시보드 AS 미처리 → 풀폭 2열 카드 (모바일 1열)
- [x] 오늘 일정 클릭 시 중복 팝업 제거
- [x] 매장 상세에 ⚠ 카탈로그 끊김 표시

### Mockup 작성 (3개)
- [x] `preview/job-register-flow.html` — 5-step wizard
- [x] `preview/job-register-single.html` — 단일 페이지 PC 3-column + Mobile 폰프레임
- [x] `preview/store-detail-redesign.html` — 매장 상세 10-tab 재설계

---

## 🚧 진행 필요 작업

### A. 매장 병합 버그 수정 (지금 진행)
- [ ] 매장 병합시 `equipment[]` / `contacts[]` 등 모든 배열 데이터 흡수
- [ ] 작업 재라우팅 — 정확 일치 → **정규화 매칭 + aliases** 매칭
- [ ] 매장 상세 작업 이력 매칭 로직 — `aliases` 도 검사 (rerouting 누락 안전망)
- [ ] 매장 병합 취소(undo) 시 위 모든 데이터 복원

### B. 사용자가 정리할 부분 (개발 보류)
- [ ] **카테고리별 고유 필드 확정** — 매트릭스 (12 카테고리)
- [ ] 각 카테고리의 필수/선택 필드 결정
- [ ] 진행 단계(`status`) 흐름 카테고리별 표준 정의

### C. 업무 등록 단일 페이지 실제 구현 (mockup → 코드)
- [ ] PC 3-column 레이아웃 컴포넌트
- [ ] Mobile 수직 섹션 레이아웃 (반응형 분기)
- [ ] 카테고리 12개 chip + 카테고리별 동적 필드 분기
- [ ] 매장 자동완성 (`Autocomplete.register('store2', ...)`)
- [ ] 매장 선택 시 진행중 업무 자동 노출 + 갱신/신규 토글
- [ ] 거래처 담당 ↔ `store.contacts[]` 양방향 동기화
- [ ] 우선순위·일정·당사담당 입력
- [ ] LINE 메시지 자동 작성 (표준 포맷 + 사용자 override)
- [ ] LINE 그룹 자동 매칭 (카테고리 ↔ roomMap)

### D. LINE 메시지 발송 + 루프 차단 구현
- [ ] `/api/line-send` endpoint — LINE Messaging API push
- [ ] 발송 전 `sha256(roomId:text).slice(0,16)` 시그니처 KV 저장 (TTL 10분)
  - 키: `line_outbound_sig:<hash>`
  - 값: `{jobId, sentAt, by}`
- [ ] `line-webhook.js` 수신 시 시그니처 매칭 → `processedStatus='self_echo'`
- [ ] `line-parse-cron.js` 에서 `self_echo` skip
- [ ] 작업 상세에 **발송 이력 탭** 추가 (jobId ↔ message 양방향)

### E. 매장 상세 모달 재설계 구현
- [ ] 10-tab 구조 (진행 업무 / 매장정보 / 오픈·신규 / A/S / 밴서류 / 출고·택배 / 라벨 / 상담 / 설치장비 / 메모)
- [ ] 각 탭 lazy 렌더링 + URL hash 상태 보존
- [ ] 탭별 필터 (카테고리 / 완료여부 / 년도)
- [ ] 진행 업무 탭 — 모든 카테고리 통합 + 진행률 bar

### F. 자산 관리 강화 (Plan B 후속)
- [ ] stub 매장 정보 보완 UI — `autoCreated:true` 매장 모아보기 + 일괄 정정
- [ ] 매장 장비 이전 UI (`transferStoreEquipment` 호출)
- [ ] 장비 인스턴스 검색 (전체 매장 대상 — 시리얼/이름/카탈로그)

### G. 거래처 담당 통합 (Plan H — mockup 메모)
- [ ] `store.contacts[]` 스키마 정착 (이름·직책·전화·primary·linkedFrom)
- [ ] 작업 등록 폼의 거래처 담당 필드 → 매장 DB 자동 추가
- [ ] 매장 상세에 contacts 편집 UI

### H. 카테고리 v2 마이그레이션 (장기)
- [ ] `categoryV2` 추가 필드 도입 (구 `lineCategory` 유지)
- [ ] CATEGORY_MIGRATION_MAP 매핑 테이블
- [ ] 점진적 배치 마이그레이션 (cron)
- [ ] 관리자 v1/v2 토글 UI

---

## 🎯 권장 순서

```
1. (지금) 매장 병합 버그 수정          ← 데이터 무결성
2. 사용자: 카테고리 고유 필드 매트릭스 확정
3. 업무 등록 단일 페이지 구현           ← 사용자 최대 체감
4. LINE 발송 + 루프 차단 구현           ← 등록 흐름 완성
5. 매장 상세 탭 재설계 구현             ← 정보 정리 가시화
6. 거래처 담당 통합 + 자산 관리 강화
7. 카테고리 v2 (장기)
```
