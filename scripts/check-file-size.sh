#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# 파일 크기 가드레일 점검 (CLAUDE.md "📏 파일 크기 가드레일" — 한 파일 4,000줄 초과 금지)
#
# 동작:
#   - 모든 소스(js/html/css) 줄 수 측정
#   - 4,000줄 초과 중 '알려진 분할 부채'(app.js 등)는 ⚠ 경고만 (별도 분할 계획 진행)
#   - 그 외 신규 초과 파일이 있으면 🔴 + exit 1  (= 새로 오버하는 파일 차단)
#
# 사용: bash scripts/check-file-size.sh   (배포/커밋 전 실행)
# ──────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

LIMIT=4000
WARN=3500
# 알려진 분할 부채 — 별도 계획(.claude/plans)으로 점진 분할. 신규 초과만 실패 처리.
KNOWN_DEBT=" app.js "

files=$(git ls-files '*.js' '*.html' '*.css' 2>/dev/null | grep -vE '^(node_modules|dist|vendor)/')

newover=0; debt=0; warned=0
echo "── 파일 크기 점검 (한도 ${LIMIT}줄) ──"
while IFS= read -r f; do
  [ -f "$f" ] || continue
  n=$(wc -l < "$f")
  if [ "$n" -gt "$LIMIT" ]; then
    if echo "$KNOWN_DEBT" | grep -q " $f "; then
      printf "  ⚠  %6d  %s   (알려진 분할 부채 — 별도 계획)\n" "$n" "$f"; debt=$((debt+1))
    else
      printf "  🔴 %6d  %s   (신규 초과 — 기능 단위 분할 필요)\n" "$n" "$f"; newover=$((newover+1))
    fi
  elif [ "$n" -gt "$WARN" ]; then
    printf "  ▵  %6d  %s   (한도 임박)\n" "$n" "$f"; warned=$((warned+1))
  fi
done <<< "$files"

echo ""
if [ "$newover" -gt 0 ]; then
  echo "🔴 신규 초과 ${newover}개 — CLAUDE.md '파일 크기 가드레일'에 따라 기능 단위로 분할하세요. (exit 1)"
  exit 1
fi
echo "✅ 신규 초과 없음 (알려진 부채 ${debt}개, 임박 ${warned}개). 부채는 분할 계획대로 진행."
exit 0
