# 이미지 등록 / 저장 아키텍처 — 계획서

> LINE 발송 기능 착수 전, 사이트 내 **이미지 첨부 UX + 저장소** 구조를 먼저 확정.

## 1. 이미지가 붙는 위치 (메뉴별 정리)

| 메뉴 | 위치 | 트리거 | 권장 매수 |
|---|---|---|---|
| 📦 재고조사 | 등록 폼 / 진행 추가 / 완료 처리 | 각 단계 메시지 패널 안 | 0–10 |
| 🔧 AS | 요청 ROOT / 진행 child / 완료 child | thread item 작성 시 | 0–6 |
| 🆕 신규 | 등록 / 일정 진행 / 오픈 완료 | 단계별 메시지 패널 | 0–10 |
| 📑 VAN | 가맹 진행 / 완료 (계약서·TID 화면) | 진행/완료 패널 | 0–6 |
| 🛒 소모품 | 출고 / 배송 / 수령 확인 | 단계별 패널 | 0–3 |
| 📞 일반 메모 | 매장 상세 — 메모 작성 | 메모 행 | 0–3 |

**공통 컴포넌트**: `_renderImageUploader(target, opts)` 1개로 모든 위치 재사용.

---

## 2. 저장소 선택지 비교

| 옵션 | 장점 | 단점 | 비용 |
|---|---|---|---|
| **A. localStorage base64** | 즉시 구현, 오프라인 가능 | 5MB 한도 / 동기화 어려움 / 사진 1–2장만 가능 | 0 |
| **B. IndexedDB base64** | 용량 ↑ (수백MB) / 오프라인 | 디바이스간 미동기화 / LINE 발송 시 별도 업로드 필요 | 0 |
| **C. Cloudflare R2** | 무제한 / 사이트와 동일 인프라 / 직접 URL | 사전 서명 URL or Worker 프록시 필요 | $0.015/GB · 무료 10GB |
| **D. Cloudflare Images** | 자동 리사이즈/변환 / CDN | 월 5,000장 무료, 초과 시 과금 | $5/100k 변환 |
| **E. LINE 임시 업로드** | LINE 발송만 목적이면 단순 | 사이트에서는 못 보여줌 / 24h 만료 | 0 |

**권장**: **C. Cloudflare R2** (이미 이미지 인프라로 사용 중)
+ 큰 원본 보관, 썸네일은 R2 image transform (또는 클라이언트 리사이즈)

---

## 3. 저장소 데이터 흐름 (권장안)

```
[사용자 PC/모바일] 
   ↓ 파일 선택 / 카메라
[브라우저: 클라이언트 리사이즈]  ← 원본 너무 크면 maxWidth=1600 으로 압축
   ↓ FormData
[/api/upload-image]  (Cloudflare Pages Function)
   ↓ R2 PUT
[R2 버킷: ns-images/{year}/{month}/{uuid}.jpg]
   ↓ 응답: { url, key, size, w, h }
[클라이언트: job/thread record 에 attach]
   ↓ 저장
[ns_jobs / cloud KV: image refs (URL+key+meta) ]
   ↓ LINE 발송 시
[/api/line-send] 가 R2 URL → LINE Image Message 로 변환
```

### 데이터 모델
```js
// thread item 또는 job record 에 images 배열 추가
{
  id: 'th-xxx',
  text: '창고 영역 완료',
  date: '2026-05-25',
  author: '김기사',
  status: '진행',
  images: [
    {
      key: 'ns-images/2026/05/abc123.jpg',
      url: 'https://img.neosolution.co.kr/2026/05/abc123.jpg',
      thumb: 'https://img.neosolution.co.kr/2026/05/abc123_thumb.jpg',
      w: 1600, h: 1200, size: 245000,
      uploadedAt: '2026-05-25T13:01:23+09:00',
      uploadedBy: 'kimgisa'
    }
  ],
  lineSent: { ts: '...', messageId: '...', success: true }
}
```

---

## 4. 업로드 UX (공통 컴포넌트)

### 모달/패널 내부 (현재 목업 그대로)
- 썸네일 그리드 (54px) + `[＋ 추가]` 버튼
- 각 썸네일 우상단 `[×]` 로 삭제
- 클릭 시 라이트박스 (원본 보기)

### 파일 선택 / 카메라
```html
<!-- PC + 모바일 동시 지원 -->
<input type="file" accept="image/*" multiple capture="environment">
```
- `capture="environment"` → 모바일은 후면 카메라 자동
- `multiple` → 여러 장 동시 선택
- 모바일 OS 가 자동으로 "촬영 / 사진 라이브러리" 선택지 띄움

### 클라이언트 사이드 리사이즈 (업로드 전 압축)
```js
async function compressImage(file, maxW=1600, quality=0.85) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
}
```
- 10MB iPhone 사진 → 약 200–400KB 로 압축
- 업로드 속도 + R2 비용 절감

### 진행률 표시
- 업로드 중: 썸네일에 spinner overlay
- 완료: 정상 표시
- 실패: 빨간 테두리 + 재시도 버튼

---

## 5. 보안 / 권한

| 항목 | 정책 |
|---|---|
| 업로드 권한 | 로그인 사용자만 (`ns_users` 검증) |
| 직접 R2 접근 | 차단 — 항상 Worker 프록시 통과 |
| URL 노출 | `img.neosolution.co.kr/{key}` — 키 자체가 UUID 라 추측 불가 |
| 삭제 | 작성자 + 관리자만. 실제 R2 삭제는 30일 후 cron (실수 복구 여유) |
| 용량 제한 | 업로드당 10MB, 1 job 최대 50장 |
| 파일 타입 | `image/jpeg`, `image/png`, `image/heic` (HEIC 는 서버에서 JPEG 변환) |

---

## 6. R2 비용 예상

- 평균 200KB × 매장 100곳 × 월 10장 = **200MB/월**
- R2 storage: $0.015/GB/월 = **거의 0원** (무료 10GB 안)
- R2 Class A (PUT): $4.50/M = **0원** (무료 100만 안)
- R2 Class B (GET): $0.36/M = **0원** (무료 1000만 안)
- Egress: **무료**

→ 현실적으로 **무료 한도 내 운영 가능**.

---

## 7. LINE 발송 시 이미지 처리

LINE Messaging API 의 Image Message:
```json
{
  "type": "image",
  "originalContentUrl": "https://img.neosolution.co.kr/.../abc.jpg",
  "previewImageUrl":   "https://img.neosolution.co.kr/.../abc_thumb.jpg"
}
```
- 두 URL 모두 **HTTPS + 공개 접근** 필수 (R2 custom domain)
- `originalContentUrl` ≤ 10MB, ≤ 4096×4096
- `previewImageUrl` ≤ 1MB, ≤ 240×240
- 발송 메시지 = 텍스트 1개 + 이미지 N개 (LINE 은 멀티 메시지 1회 발송)

---

## 8. 구현 단계 (Phase 분리 권장)

### Phase 1: 이미지 인프라 (LINE 보다 먼저)
- [ ] R2 버킷 `ns-images` 생성
- [ ] `img.neosolution.co.kr` custom domain 연결
- [ ] `/api/upload-image` Pages Function 작성
- [ ] 클라이언트 `_renderImageUploader()` 컴포넌트
- [ ] 클라이언트 리사이즈 `compressImage()` 헬퍼
- [ ] 라이트박스 (원본 보기 모달)

### Phase 2: 메뉴별 통합
- [ ] 재고조사 등록/진행/완료 폼에 uploader 삽입
- [ ] AS thread item 작성 시 uploader
- [ ] 신규 단계별 폼
- [ ] VAN / 소모품
- [ ] 매장 상세 메모

### Phase 3: LINE 발송 (별도)
- [ ] `/api/line-send` 에서 image refs → LINE Image Message 변환
- [ ] self-echo 차단 (텍스트 해시 + image key 해시)
- [ ] lineHistory 기록

### Phase 4: 운영
- [ ] 30일 휴지통 cron
- [ ] 사용량 대시보드
- [ ] 매장당 이미지 갤러리 뷰

---

## 9. 결정 필요 항목

1. **저장소**: R2 확정? 또는 IndexedDB 로컬 우선 (오프라인 우선) 후 R2 동기화?
2. **도메인**: `img.neosolution.co.kr` 신규 vs 기존 r2.dev URL 재사용?
3. **HEIC 변환**: 서버에서 처리 (Worker + libheif) vs 클라이언트 거부 (사용자가 jpg 로 다시 저장)?
4. **권한 단순화**: 일단 "로그인하면 누구나 업로드/삭제 가능" 으로 시작 vs 처음부터 작성자 제약?
5. **공개 여부**: 모든 이미지가 URL 만 알면 접근 가능 (LINE 발송 필요) vs 사이트 인증 후만 접근 (LINE 발송 시 임시 토큰)?

---

## 10. 다음 단계 제안

위 결정 항목 5개 확정 → `image-uploader-mockup.html` 작성 (실제 폼 UI + 업로드 진행 + 라이트박스)
→ Phase 1 인프라 구현 → 그 위에 LINE 발송 얹기.
