@echo off
node "%~dp0..\..\backend\cli.js" check-integrity 1>&2
exit /b %errorlevel%
