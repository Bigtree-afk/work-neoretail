# NeoRetail Changelog

## 2026-05-16 — AS 흐름 전면 개편 + 데이터 손실 차단

### 데이터 모델
- AS 업무가 **매장당 단일 job** 으로 통합 (요청은 thread ROOT 로 누적)
- `_as_aggregate_migration_v2` 자동 마이그레이션: 기존 산재된 AS jobs 를 매장당 1건으로 합병
- Thread 구조: `{ threadId, parentId, ts, author, status, text, equipment? }`

### Critical fix — 데이터 손실 차단
1. **Cloud sync** 가 동일 id 충돌 시 무조건 cloud 우선 → thread ROOT 손실
   → `_mergeJobRecord` 로 union 머지 (thread/memos/vandocs)
2. **"+ 새 요청 접수 → 등록" 이 draft 메모리만 수정** → 모달 ✕ 닫기 시 손실
   → 등록 클릭 즉시 ns_jobs 영구 저장 + cloud push (debounce 우회)
3. **완료 child 가 job 전체 completed 화** → 다음 ROOT 추가가 분리됨
   → `_setThreadFor` 가 '모든 ROOT 가 완료 child 보유' 일 때만 completed=true

### UI 정리
- AS 접수정보 노란 박스 제거 (요청사항·처리 기록 thread 가 1차 인터페이스)
- AS 편집 모달의 옛 `📋접수 / 🚗방문예정 / 🔁재방문필요 / ✅처리완료` 4-state picker 제거
- AS 편집 모달에서 설치 예정일/가오픈일/오픈일 (신규 전용) + 하단 장비 테이블 숨김
- 비고/특이사항 박스를 모달 최하단으로 이동
- 작성자 이름이 jobEngineer 가 아닌 항상 `_currentAuthName()` 사용 (Live Wire 잔존 해결)

### 노출 룰
- AS hub / 매장 정보 AS 탭 / 편집 모달 thread 모두 5건 룰 적용:
  - 미완료 ≥ 5 → 미완료만 (무제한)
  - 미완료 < 5 → 미완료 + 최근 완료 채워 총 5건
  - 모두 완료 → 최근 5건 + 📂 전체보기 토글
- 매장 정보 진행 중 탭 — AS/신규는 미완료 ROOT 마다 1카드 (요청 본문 노출)
- AS 카운트 — 매장 수가 아니라 요청접수 ROOT 단위

### 처리 장비
- "+ 장비 추가" 가 thread 의 진행/완료 child entry 에만 저장 (`child.equipment[]`)
- `job.equipment[]` 누적 X — 어느 요청 어느 처리에 어떤 장비를 투입했는지 1:1 매칭

### 진단 도구
```js
window.diagnoseStoreJobs('정이가마트')
window.replaceAuthorName('Live Wire', '이동호')
window.migrateAsJobsToAggregate({ force: true })
```

### 안정화 문서
- `docs/AS_ARCHITECTURE.md` — 데이터 모델 / UI 흐름 / 회귀 방지 체크리스트
- 핵심 함수에 안정화 규약 헤더 주석 추가 (saveNewJob, _setThreadFor)
