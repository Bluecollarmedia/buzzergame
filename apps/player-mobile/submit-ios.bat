@echo off
rem Uploads the newest finished build to App Store Connect / TestFlight.
cd /d "%~dp0"
set EAS_PROJECT_ID=c83228d6-3a73-4630-b2fc-0e0ad83671ed
call eas submit --platform ios
pause
