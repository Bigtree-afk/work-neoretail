#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# 매장 식별 정규화 오용 점검 (오케이마트 교차오염 재발 방지 — 2026-06-11)
#
# 규칙: 매장 "식별/매칭" 비교는 반드시 _normStoreKey (소문자+공백제거, 법인표기 보존) 사용.
#       _normalizeSearch 는 법인표기('주식회사','(주)')를 제거해 '오케이마트'와
#       '오케이마트주식회사'를 같은 키로 만들므로 검색 전용. 식별에 쓰면 별개 매장이 병합됨.
#
# 사용: bash scripts/check-store-key.sh   (CI/배포 전 실행, 위반 시 exit 1)
# ──────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

FILES="app/ m-core.js m/as/index.html m/newjob/index.html m/van/index.html m/supplies/index.html m/stocktake/index.html m/index.html"

# 🔴 위험 패턴 — 매장 식별 비교에 _normalizeSearch 가 쓰인 경우
#   (a) 동치 비교:  _normalizeSearch(...) ===   /   === _normalizeSearch(...)
#   (b) 집합 멤버십: .has( _normalizeSearch(...)
#   (c) 이름→매장 인덱스 build: storeByName/nameSet/matchNorms ... _normalizeSearch
PATternA='_normalizeSearch\([^)]*\)[[:space:]]*===|===[[:space:]]*_normalizeSearch\('
PATternB='\.has\([[:space:]]*_normalizeSearch\('
PATternC='(storeByName|nameSet|matchNorms|_storeKeyByName)[[:space:]]*[.=].*_normalizeSearch'

viol=$(grep -rnE "$PATternA|$PATternB|$PATternC" $FILES 2>/dev/null || true)

if [ -n "$viol" ]; then
  echo "🔴 [check-store-key] 매장 식별에 _normalizeSearch 오용 발견 — _normStoreKey 로 바꾸세요:"
  echo "$viol"
  echo ""
  echo "   참고: CLAUDE.md '🏪 매장 ↔ 작업 매칭 규칙' — 식별=_normStoreKey, 검색=_normalizeSearch"
  exit 1
fi

echo "✅ [check-store-key] 매장 식별 정규화 정상 — 식별부에 _normalizeSearch 오용 없음"
