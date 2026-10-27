@echo off
rem Sends an over-the-air update to iPhones running the App Store build.
rem Run it by typing: update-ios.bat   See docs/app-store.md.
rem Only for changes to screens, text and logic. New permissions or native
rem packages still need build-ios.bat and a new App Store release.
cd /d "%~dp0"
set EAS_PROJECT_ID=c83228d6-3a73-4630-b2fc-0e0ad83671ed
set EXPO_PUBLIC_SITE_URL=https://buzgame.netlify.app
set EXPO_PUBLIC_SUPPORT_EMAIL=forsakaspotify1@gmail.com
set IOS_BUNDLE_ID=com.buzzavid.app

set MSG=
set /p MSG="Describe this update in a few words, then press Enter: "
if not defined MSG set MSG=App update

call eas update --channel production --environment production --platform ios --message "%MSG%"
pause
