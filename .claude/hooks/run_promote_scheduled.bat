@echo off
node "%~dp0..\..\lib\cli.js" promote-scheduled 1>&2
exit /b %errorlevel%
