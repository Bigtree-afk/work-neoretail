# 매장 머지 — per-field mtime 설계안 (동시 다른필드 편집 소실 해결)

> 상태: **설계 문서 (구현 전)**. 코드 리뷰 #1 대응. 구현은 승인 후 진행.
> 관련: CLAUDE.md "🔄 매장 데이터 동기화 — 정책 테이블 기반 머지", "🕐 per-job mtime".

## 1. 문제 (현재 동작)

`mergeStoreField` 의 `prefer-non-empty` 정책이 **매장(store) 단위 `updatedAt`** 하나로 충돌을 해소한다.

```
// 현재 (app.js / sync.js)
if (둘 다 값 있음) {
  const lt = loc.updatedAt||0, rt = rem.updatedAt||0;
  return lt (>|>=) rt ? lv : rv;   // 매장 전체를 한 번에 승/패
}
```

→ 같은 매장의 **서로 다른 필드**를 두 사람이 동시 편집하면, 더 최신 `updatedAt` 을 가진 쪽이
**자기가 안 건드린 필드까지 통째로** 가져오면서 상대 수정을 덮어쓴다.

**재현**
1. A·B 가 매장 S 를 `updatedAt=T0` 으로 동기화한 상태.
2. A 가 **대표자만** 수정 → `updatedAt=T1`, 푸시 → 클라우드 대표자 갱신.
3. B 가 (A 변경 미수신 상태에서) **주소만** 수정 → `updatedAt=T2(>T1)`, 푸시.
4. 서버 머지: 모든 prefer-non-empty 필드에서 `lt(T2) >= rt(T1)` → **B 가 전부 승** →
   B 의 **옛 대표자**가 A 의 새 대표자를 덮음 → **A 의 수정 영구 소실**.

## 2. 목표

- 필드 X 의 편집은 **필드 X 끼리만** 경쟁한다. 서로 다른 필드의 동시 편집은 **양쪽 모두 보존**.
- 같은 필드의 동시 편집은 여전히 last-writer-wins (CRDT 없이는 불가피, 허용 범위).
- **무손실 마이그레이션** — 기존 데이터/현재 per-store mtime 와 호환, 점진 적용.
- **SSOT** — 클라이언트(app.js) · 서버(sync.js) 동일 로직.

## 3. 선택지 비교

| 안 | 개요 | 장점 | 단점 |
|---|---|---|---|
| **A. per-field mtime (권장)** | 매장에 `fieldUpdatedAt:{필드:ts}` 추가, 머지를 필드별 ts 비교로 | 기존 정책테이블 머지에 **증분 적용**, 무손실 호환, 구현 작음 | 편집 지점마다 필드키 스탬프 필요, `fieldUpdatedAt` 자체 머지정책 1개 추가 |
| B. delta(patch) 푸시 | 클라가 **바뀐 필드만** 전송, 서버가 patch 적용 | stale 필드를 아예 안 보냄(근본적) | wholesale POST→delta 로 **동기화 모델 변경**(큰 공사) |
| C. CRDT/필드별 저널 | 필드별 변경 로그 병합 | 가장 견고 | 과투자 |

→ **A안 채택.** 현 머지 아키텍처(정책 테이블)에 자연스럽게 얹히고 위험 대비 효과 최적.
B안은 추후 별도 과제로 보류(이미 `/api/stores-patch-*` 선례 존재).

## 4. A안 상세 설계

### 4.1 데이터 모델

매장 객체에 선택 필드 추가:
```js
store.fieldUpdatedAt = {
  name: 1780559637492,
  addr: 1780559700000,
  ceo:  ...,
  // biz, tel, van, signageName, ceoTel, tags ... (prefer-non-empty 스칼라 필드만)
}
```
- **스칼라(prefer-non-empty) 필드만** 대상. 배열/additive 필드(equipment·contacts·memos·changeLog·aliases)는 이미 additive 머지라 per-field ts 불필요.
- `kv-wins`(storeRegDate·ecountRegDate)·`local-only` 은 영향 없음.
- `store.updatedAt` 은 **유지** (목록 정렬·일반 freshness·레거시 fallback 용).

### 4.2 비교 시각 헬퍼 (★ 핵심 — fallback 규칙이 정확성의 관건)

```js
function _fieldTs(store, key) {
  // fieldUpdatedAt 가 '있는' 매장: 키가 없으면 '그 필드는 내가 안 건드림' = 0
  if (store && store.fieldUpdatedAt && typeof store.fieldUpdatedAt === 'object') {
    return Number(store.fieldUpdatedAt[key]) || 0;
  }
  // fieldUpdatedAt 가 '아예 없는' 완전 레거시 매장: 매장 단위 mtime 으로 fallback
  return Number(store && store.updatedAt) || 0;
}
```

> **왜 중요한가**: `fieldUpdatedAt` 이 있는데 특정 키만 없을 때 `store.updatedAt` 으로 fallback 하면,
> "주소만 고친 B" 가 `updatedAt=T2` 때문에 **대표자까지 T2 로 이겨** 다시 #1 버그가 재현된다.
> 따라서 **fieldUpdatedAt 객체가 존재하면 누락 키는 무조건 0** 으로 본다(미편집 = 경쟁 안 함).

### 4.3 머지 로직 (prefer-non-empty)

```js
// 둘 다 값 있음 → 필드별 mtime
const lts = _fieldTs(loc, key), rts = _fieldTs(rem, key);
// 클라이언트: 동률/불명이면 KV(rem) 유지 →   lts >  rts ? lv : rv
// 서버:       동률이면 incoming(loc) 유지 → lts >= rts ? lv : rv
```
(현재의 `>` / `>=` 비대칭은 그대로 유지 — 클라는 클라우드에 양보, 서버는 writer 수용. 동률은 값이 같은 경우라 무손실.)

### 4.4 `fieldUpdatedAt` 자신의 머지 정책 (신규 `max-by-key`)

머지 결과 매장의 필드별 ts 가 **양쪽의 최신값(max)** 을 유지해야 이후 머지가 계속 정확하다.

```js
// STORE_FIELD_POLICY 에 추가
fieldUpdatedAt: 'max-by-key',

// mergeStoreField 에 case 추가 (app.js + sync.js 동일)
case 'max-by-key': {
  const lo = lv||{}, ro = rv||{}, out = {};
  new Set([...Object.keys(lo), ...Object.keys(ro)]).forEach(k => {
    out[k] = Math.max(Number(lo[k])||0, Number(ro[k])||0);
  });
  return Object.keys(out).length ? out : undefined;
}
```

### 4.5 편집 지점 스탬프 — 공유 헬퍼

누락 방지를 위해 단일 헬퍼로 통일(현재 흩어진 `store.updatedAt = Date.now()` 를 대체):

```js
function _touchStore(store, fields) {
  const now = Date.now();
  store.updatedAt = now;                       // 기존 호환 유지
  if (!store.fieldUpdatedAt) store.fieldUpdatedAt = {};
  (Array.isArray(fields) ? fields : [fields]).forEach(f => { if (f) store.fieldUpdatedAt[f] = now; });
}
```

스탬프 적용 위치(이번 세션에 `updatedAt` 넣은 곳 + 다중필드):
| 위치 | 스탬프할 필드 |
|---|---|
| `_sdv2EditField` (인라인 ✏) | 편집한 `field` 1개 |
| 태그 편집 | `'tags'` |
| `applyStoreChange` (정보변경 모달) | `changed[]` 의 각 필드 |
| `mergeStores` (병합) | `filledFields` 로 채워진 각 필드 |
| `undoStoreMerge` (병합 취소) | 되돌린 각 필드 |
| 신규 매장 등록 | (선택) 등록 시점 전 필드 — 신규는 충돌 없으니 필수는 아님 |

> **필드키 일관성 주의**: 매장은 `addr`/`address`, `tel`/`phone`, `biz`/`bizno`, `name`/`storeName` 혼용.
> **실제로 저장·머지되는 키**와 스탬프 키가 동일해야 한다(편집은 canonical `addr`/`tel`/`biz`/`name` 에 쓰므로 그 키로 스탬프).

## 5. 마이그레이션 / 호환성 (무손실)

데이터 일괄 변환 **불필요**. `fieldUpdatedAt` 은 선택 필드 — 없으면 `_fieldTs` 가 `store.updatedAt`(→ 현재 per-store 동작) → 최종적으로 레거시(0/0 동률) 동작으로 자연 fallback.

전이 시나리오 안전성 검증:
- **완전 레거시**(updatedAt·fieldUpdatedAt 모두 없음): 0/0 동률 → 클라=KV 유지, 서버=incoming 유지 = **현재와 동일**(회귀 없음).
- **per-store 만**(이번 세션 데이터, updatedAt 있고 fieldUpdatedAt 없음): 모든 필드가 store.updatedAt 로 fallback → **현재 per-store 동작 유지**, 편집이 일어나는 순간부터 그 필드만 per-field 로 승급.
- **per-field 로 승급된 매장에서 미편집 필드(ts=0)가 손해 보는가?** → 미편집 필드는 **값이 양쪽 동일**하므로 누가 이겨도 무손실. (값이 다르면 = 누군가 편집함 = ts 존재 = 정상 경쟁)

## 6. 엣지 케이스 / 한계 (명시)

1. **시계 오차(clock skew)**: per-field mtime 도 기기 `Date.now()` 에 의존 → 시계 틀린 기기는 항상 이기거나 짐. jobs mtime 과 동일 위험, 수용. (필요 시 서버 수신시각 보정은 별도 과제)
2. **같은 필드 동시 편집**: 여전히 LWW (설계 목표 밖, CRDT 필요).
3. **필드 비우기(클리어)**: prefer-non-empty 는 빈 값을 "없음" 취급 → 한쪽이 값 있으면 항상 이김 → **필드를 빈 값으로 만드는 변경은 전파가 어렵다**(기존 한계, 본 설계로 악화되지 않음). 진짜 삭제가 필요하면 tombstone-필드 방식 별도 검토.
4. `fieldUpdatedAt` 크기: 스칼라 필드당 ts 1개(~10키) → 무시 가능.

## 7. 구현 순서 (각 단계 검증)

1. `_fieldTs` + `_touchStore` 헬퍼 추가 (app.js). `max-by-key` case 추가 (app.js + sync.js).
2. `STORE_FIELD_POLICY` 에 `fieldUpdatedAt:'max-by-key'` 추가 (app.js + sync.js **둘 다**).
3. `mergeStoreField` prefer-non-empty 를 `_fieldTs` 비교로 교체 (app.js + sync.js).
4. 편집 지점 5곳을 `_touchStore(store, 필드)` 로 교체.
5. **단위 테스트**(node): 아래 시나리오 PASS 확인.
6. 프리뷰 검증 → 프로덕션. app.js `?v=` bump (서버 sync.js 변경 동반).

## 8. 테스트 시나리오 (필수 PASS)

| # | 상황 | 기대 |
|---|---|---|
| T1 | A=ceo수정(fieldTs.ceo=T1), B=addr수정(fieldTs.addr=T2), 서버 머지(incoming=B vs KV=A) | **ceo=A값 보존, addr=B값 보존** (둘 다 생존) |
| T2 | 같은 필드 ceo 를 A(T1)·B(T2) 편집 | ceo=B(최신) — LWW |
| T3 | 완전 레거시(필드맵 없음) 양쪽 | 현재 동작과 동일(클라 KV / 서버 incoming) |
| T4 | per-store만(updatedAt만) vs per-field | 미편집 필드 무손실(값 동일), 편집 필드 per-field 우선 |
| T5 | `fieldUpdatedAt` max-by-key 머지 | 각 키 max 유지 |
| T6 | stale 전체 푸시(옛 fieldTs) vs 최신 KV | KV(최신) 유지 — stale 가 못 덮음 |

## 9. 영향 / 위험 요약

- 변경 파일: `app.js`(머지+헬퍼+편집 5곳), `functions/api/sync.js`(머지+정책), `index.html`(`?v=`).
- 모바일 m-core.js 는 매장 머지를 하지 않으므로 변경 없음(매장 편집은 PC 중심). 단, 모바일이 store 를 편집/머지하게 되면 동일 적용 필요.
- 회귀 위험 낮음(레거시 fallback 으로 기존 동작 보존). 핵심 위험은 **편집 지점 스탬프 누락** → 공유 헬퍼 `_touchStore` 로 차단.
```
