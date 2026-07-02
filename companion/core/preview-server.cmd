@echo off
set PORT=3100
set DATABASE_PATH=%TEMP%\vap-ui-test.sqlite
set WEB_DIST=E:\Code-Projects\ValorantOCR Startup\web\dist
"%~dp0target\debug\server.exe"
