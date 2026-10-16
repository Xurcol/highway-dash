@echo off
rem Publishes the game to https://xurco.xyz by hand: gets the latest main from GitHub (including
rem anything merged there from Codex), builds the site, and pushes it to the gh-pages branch that
rem GitHub Pages serves. Normally the Deploy site action does this on every push to main; use this
rem while that action can't run.
cd /d "%~dp0"
echo Getting the latest version from GitHub...
git pull --ff-only origin main || goto :fail
echo Installing / checking dependencies...
call npm install --no-audit --no-fund >nul || goto :fail
echo Building the site...
node scripts\build-pages.mjs xurco.xyz || goto :fail
echo Publishing...
pushd dist
git init -q -b gh-pages || goto :failpop
git add -A || goto :failpop
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
echo Deploy failed - see the message above.
if "%1"=="" pause
exit /b 1
