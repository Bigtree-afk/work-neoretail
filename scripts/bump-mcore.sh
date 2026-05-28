#!/usr/bin/env bash
# bump-mcore.sh — m-core.js 의 cache-bust 쿼리(`?v=...`)를 모든 m/*.html 에 일괄 갱신
#
# 사용법:
#   bash scripts/bump-mcore.sh [keyword]
#   keyword 생략 시 자동으로 'mcore-update'
#
# 결과:
#   m/*.html 의 `<script src="/m-core.js?v=YYYY-MM-DD-keyword">` 일괄 변경
#
# 왜 필요?
#   iOS Safari 등 일부 브라우저가 같은 URL JS 를 적극 캐시 → m-core.js 변경해도
#   ?v= 갱신 없으면 옛 버전 계속 사용 → OS 별 동작 차이 발생. 본 스크립트가
#   변경 시점마다 자동으로 강제 무효화.

set -euo pipefail

KEYWORD="${1:-mcore-update}"
DATE=$(date +%Y-%m-%d)
NEW_VER="${DATE}-${KEYWORD}"

# 변경 대상: m-core.js 를 직접 참조하는 모든 m/*.html
FILES=$(grep -lr '/m-core\.js?v=' m/ 2>/dev/null || true)

if [ -z "$FILES" ]; then
  echo "✗ 대상 파일 없음 (m/ 하위에 m-core.js 참조 X)"
  exit 1
fi

echo "🔧 m-core.js cache-bust 버전 갱신"
echo "   새 버전: ?v=${NEW_VER}"
echo "   대상 파일:"

COUNT=0
for f in $FILES; do
  OLD_VER=$(grep -o 'm-core\.js?v=[^"]*' "$f" | head -1 | cut -d'=' -f2 || echo '?')
  sed -i "s|/m-core\.js?v=[^\"]*|/m-core.js?v=${NEW_VER}|g" "$f"
  echo "   - $f  ($OLD_VER → $NEW_VER)"
  COUNT=$((COUNT+1))
done

echo ""
echo "✓ ${COUNT}개 파일 갱신 완료"
echo ""
echo "다음 단계:"
echo "  1) 변경 검증:    git diff -- 'm/*.html'"
echo "  2) 배포:         npx wrangler pages deploy . --project-name work-neoretail --commit-dirty=true"
echo "  3) 커밋:         git add m/ && git commit -m 'bump m-core.js cache-bust → ${NEW_VER}'"
