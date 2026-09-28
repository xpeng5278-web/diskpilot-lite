@echo off
setlocal
chcp 65001 >nul
if not exist "%~dp0diskpilot-lite.ps1" goto unpack
set "DP_PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%DP_PS%" goto run
where powershell >nul 2>nul
if errorlevel 1 goto missing
set "DP_PS=powershell.exe"
:run
"%DP_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0diskpilot-lite.ps1"
if errorlevel 1 goto failed
exit /b 0
:unpack
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ({{ZH:请先右键解压，再双击}}); Write-Host ({{ZH:右键 zip →「全部解压缩」→ 打开解压出的文件夹 → 双击 一键扫描C盘.cmd}})"
if errorlevel 1 echo Qing xian jie ya. Extract the ZIP first, then open the extracted folder.
pause
exit /b 0
:missing
echo Zhao bu dao PowerShell. Windows PowerShell is unavailable.
echo Qing zai Windows zhong yun xing, an ren yi jian guan bi.
pause
exit /b 1
:failed
"%DP_PS%" -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Host ({{ZH:出错了。请把整个压缩包解压后重试；如仍失败，请保留上方错误信息。}})"
pause
exit /b 1
