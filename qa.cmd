@echo off
REM Windows launcher. Mirrors ./qa on macOS and Linux.
REM   fast — plain Node, no TypeScript boot, for commands that drive the
REM          already-running browser session
REM   full — tsx, for commands needing the parser, sources or reporters
setlocal
cd /d "%~dp0"

set "CMDNAME=%~1"
set "ALLARGS=%*"

REM --record writes the results file, which only the TypeScript path owns
echo %ALLARGS% | findstr /C:"--record" >nul
if %errorlevel%==0 goto full

for %%c in (status detect doctor frames snapshot do play admin storefront shot viewport vars-reset stop) do (
  if /I "%CMDNAME%"=="%%c" goto fast
)
goto full

:fast
node "%~dp0bin\fast.mjs" %*
exit /b %errorlevel%

:full
npx tsx "%~dp0src\cli\index.ts" %*
exit /b %errorlevel%
