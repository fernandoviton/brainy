@echo off
node "%~dp0..\..\backend\cli.js" promote-scheduled 1>&2
exit /b %errorlevel%
