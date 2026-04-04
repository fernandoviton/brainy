@echo off
node "%~dp0..\..\lib\cli.js" check-integrity 1>&2
exit /b %errorlevel%
