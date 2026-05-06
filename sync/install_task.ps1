# 매일 KST 07:00 이카운트 동기화 자동 실행 (Windows 작업 스케줄러)
# 관리자 권한 PowerShell에서: .\install_task.ps1

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$bat  = Join-Path $here 'run_sync.bat'

$action  = New-ScheduledTaskAction -Execute $bat -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Daily -At 07:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries

Register-ScheduledTask `
  -TaskName 'EcountDailySync' `
  -Description '매일 07:00 이카운트 거래처 동기화' `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Force

Write-Host '[OK] EcountDailySync 작업이 등록되었습니다. 매일 07:00 자동 실행.'
Write-Host '수동 실행: Get-ScheduledTask EcountDailySync | Start-ScheduledTask'
