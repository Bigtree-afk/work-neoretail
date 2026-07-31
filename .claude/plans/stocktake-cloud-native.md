# 재고조사 클라우드 정본(cloud-native) 전환

## 배경
- 재고조사(`ns_stocktake`)는 **기기 로컬 전용** — 클라우드 sync 미구현. 김윤태 모바일 등록 2건이 PC/타기기에서 안 보임.
- 사용자 결정: 작업(jobs) 같은 "localStorage 원본 + 머지 sync" 말고 **클라우드 정본 + 레코드 단위 기록** (부활/에코/mtime/tombstone 버그 클래스 원천 차단).

## 구조
- **읽기**: GET `/api/stocktake` → 목록을 받아 로컬 캐시(`ns_stocktake`)를 **교체**(클라우드가 진실, 머지 없음) → 렌더.
- **쓰기(등록/수정)**: 바뀐 레코드 **1건만** POST → 서버가 id upsert(mtime).
- **삭제**: 그 id만 POST(deletedIds) → 서버 제거 + `deleted_stocktake` 레지스트리(부활 차단).
- localStorage 는 표시 캐시일 뿐(원본 아님). 실패 시 pending 큐로 재시도(쓰기 유실 방지).

## 김윤태 로컬 기록 업로드(백필)
- `syncStocktakeFromCloud()`: ① pending 큐 flush → ② GET → ③ **로컬에만 있고(id∉cloud, id∉deleted) 있는 레코드 업로드**(김윤태 2건) → ④ 캐시 = cloud ∪ 방금 업로드분. 멱등(업로드 후엔 cloud 에 있어 재업로드 안 함). 각 기기가 자기 로컬분을 최초 1회 올림.

## 파일
1. `functions/api/stocktake.js` (신규) — GET/POST, KV `stocktake`·`deleted_stocktake`, per-record mtime upsert, ETag.
2. 클라이언트 쌍둥이(PC `app/app-01.js` + 모바일 `m-core.js`): `saveStocktakes`(diff→push), `syncStocktakeFromCloud`, `_pushStocktakeDiff`, pending 큐.
3. 모바일 `m/stocktake/index.html`: init/30s poll/visibility 의 Promise.allSettled 에 `syncStocktakeFromCloud` 추가.
4. PC `app/app-04.js` NS_LIVE.sync + `app/app-01.js` 초기로드/ns:data-changed 렌더 연결.

## 안전장치
- 서버: omission≠삭제, deleted 레지스트리로 부활 차단, mtime upsert(동시편집 안전).
- 클라: 전체 덮어쓰기 안 함(레코드 단위). 네트워크 실패 시 pending 재시도.
