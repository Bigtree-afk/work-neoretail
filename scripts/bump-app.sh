#!/usr/bin/env bash
# app/app-0*.js 세그먼트 cache-bust 일괄 갱신 (app 세그먼트 수정 후 반드시 실행).
#   app.js 분할(2026-06-11) 이후 PC 메인 스크립트는 index.html 이 app/app-01~08.js 를
#   한 ?v= 로 로드 → 세그먼트 한 개라도 고치면 8개 전부 ?v= 갱신해야 캐시 무효화됨.
# 사용: bash scripts/bump-app.sh "keyword"   → ?v=YYYY-MM-DD-keyword
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
kw="${1:-bump}"
ver="$(date +%Y-%m-%d)-$kw"
perl -i -pe "s{(/app/app-0[0-9]\.js\?v=)[^\"'> ]+}{\${1}${ver}}g" index.html
echo "✅ app 세그먼트 ?v= → $ver"
grep -oE "/app/app-0[0-9]\.js\?v=[^\"'> ]+" index.html | sort -u
