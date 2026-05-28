# bump-mcore.ps1 — m-core.js cache-bust 쿼리(?v=...) 일괄 갱신 (PowerShell)
#
# 사용법:
#   .\scripts\bump-mcore.ps1
#   .\scripts\bump-mcore.ps1 "thread-tomb"
#
# 왜 필요?
#   iOS Safari 등 일부 브라우저가 같은 URL JS 를 적극 캐시 → m-core.js 변경해도
#   ?v= 갱신 없으면 옛 버전 계속 사용 → OS 별 동작 차이 발생.
#   본 스크립트가 변경 시점마다 자동으로 강제 무효화.

param(
  [string]$Keyword = "mcore-update"
)

$ErrorActionPreference = 'Stop'
$date = Get-Date -Format "yyyy-MM-dd"
$newVer = "$date-$Keyword"

# m-core.js 를 참조하는 모든 m/*.html
$files = Get-ChildItem -Path "m" -Filter "*.html" -Recurse |
  Where-Object { (Get-Content $_.FullName -Raw) -match '/m-core\.js\?v=' }

if (-not $files) {
  Write-Host "✗ 대상 파일 없음" -ForegroundColor Red
  exit 1
}

Write-Host "🔧 m-core.js cache-bust 버전 갱신"
Write-Host "   새 버전: ?v=$newVer"
Write-Host "   대상 파일:"

$count = 0
foreach ($f in $files) {
  $content = Get-Content $f.FullName -Raw
  $old = ([regex]::Match($content, 'm-core\.js\?v=([^"]+)')).Groups[1].Value
  $new = $content -replace '/m-core\.js\?v=[^"]+', "/m-core.js?v=$newVer"
  [System.IO.File]::WriteAllText($f.FullName, $new, [System.Text.Encoding]::UTF8)
  Write-Host "   - $($f.FullName.Replace($PWD, '.'))  ($old → $newVer)"
  $count++
}

Write-Host ""
Write-Host "✓ $count 개 파일 갱신 완료" -ForegroundColor Green
Write-Host ""
Write-Host "다음 단계:"
Write-Host "  1) 변경 검증:    git diff -- 'm/*.html'"
Write-Host "  2) 배포:         npx wrangler pages deploy . --project-name work-neoretail --commit-dirty=true"
Write-Host "  3) 커밋:         git add m/ ; git commit -m 'bump m-core.js cache-bust → $newVer'"
