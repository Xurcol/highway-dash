@echo off
rem Opens Codex (ChatGPT's coding agent) in this folder, so it can edit the game's files directly.
rem Type what you want changed. When it's done, double-click deploy.bat to save it and put it live.
cd /d "%~dp0"
call codex
