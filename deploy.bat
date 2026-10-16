@echo off
rem Save and publish: double-click after making changes (by hand, or with Codex / ChatGPT editing the
rem files here). It saves any changed files to GitHub, gets anything newer from GitHub, builds the
rem site and publishes it to https://xurco.xyz. The licensed song, video and engine sounds are never
rem uploaded - .gitignore and the build both leave them out.
cd /d "%~dp0"
echo Saving your changes to GitHub...
git -c core.autocrlf=false add -A || goto :fail
git diff --cached --quiet || git commit -q -m "Update %date% %time:~0,5%" || goto :fail
git pull -q --rebase origin main || goto :fail
git push -q origin main || goto :fail
echo Installing / checking dependencies...
call npm install --no-audit --no-fund >nul || goto :fail
echo Building the site...
node scripts\build-pages.mjs xurco.xyz || goto :fail
echo Publishing...
pushd dist
git init -q -b gh-pages || goto :failpop
git -c core.autocrlf=false add -A || goto :failpop
git commit -q -m "Deploy" || goto :failpop
git push -q -f https://github.com/Xurcol/highway-dash.git gh-pages || goto :failpop
popd
echo.
echo Done - xurco.xyz updates in a minute or two (Ctrl+Shift+R to see it).
if "%1"=="" pause
exit /b 0
:failpop
popd
:fail
echo.
echo Something went wrong - see the message above.
if "%1"=="" pause
exit /b 1
