# neoretail-cron — LINE 메시지 파싱 cron Worker

Cloudflare Workers 의 Cron Triggers 를 사용해 `https://work.neoretail.net/api/line-parse-cron` 을 매시 45분/55분 호출.

GitHub Actions cron 보다 훨씬 안정적 (Cloudflare 내부 인프라 — 드롭 거의 없음). GitHub Actions 워크플로우는 백업으로 유지.

## 최초 1회 설치

```bash
cd cron-worker
npm install

# 1) Cloudflare 로그인
npx wrangler login

# 2) PARSE_SECRET 입력 (관리자 페이지 → LINE 설정 → parseSecret)
npx wrangler secret put LINE_PARSE_SECRET

# 3) 배포
npx wrangler deploy
```

배포 성공 시 출력:
```
✨ Success! Deployed neoretail-cron triggers
  - schedule: 45 23 * * 0-4
  - schedule: 45 0-8 * * 1-5
  - schedule: 55 23 * * 0-4
  - schedule: 55 0-8 * * 1-5
```

## 동작 확인

```bash
# 수동 트리거 (즉시 파싱)
curl -X POST https://neoretail-cron.<your-account>.workers.dev/run

# 실시간 로그 보기
npx wrangler tail
```

## 일정

| 시각 (UTC) | 시각 (KST) | source |
|---|---|---|
| 45분 매시 | 매시 45분 | primary (메인) |
| 55분 매시 | 매시 55분 | watchdog (보완) |

watchdog 은 메인이 어떤 이유로 실패했어도 10분 뒤 같은 endpoint 를 한 번 더 호출. endpoint 가 idempotent 이므로 중복 호출은 안전 (이미 처리된 메시지는 skip).

## 시크릿 변경

```bash
npx wrangler secret put LINE_PARSE_SECRET
```
