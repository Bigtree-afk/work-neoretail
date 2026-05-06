@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo [setup] Python venv 생성 중...
  python -m venv .venv
  .venv\Scripts\python.exe -m pip install --quiet --upgrade pip
  .venv\Scripts\python.exe -m pip install --quiet -r requirements.txt
)
.venv\Scripts\python.exe sync_ecount.py >> sync.log 2>&1
echo === sync.log 마지막 30줄 ===
powershell -NoProfile -Command "Get-Content sync.log -Tail 30"
endlocal
