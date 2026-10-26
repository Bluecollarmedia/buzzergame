@echo off
rem Builds Buzzavid for the App Store. Run it by typing: build-ios.bat
rem It asks for two values from Supabase (Project Settings -> API), saves
rem them to Expo's servers, and starts the build. See docs/app-store.md.
cd /d "%~dp0"
set EAS_PROJECT_ID=c83228d6-3a73-4630-b2fc-0e0ad83671ed

echo.
echo If this is the first run, have these ready from supabase.com
echo (your project, gear icon, API): the Project URL and the anon public key.
echo If the values are already saved, just press Enter twice to skip.
echo.
set SURL=
set SKEY=
set /p SURL="Paste your Supabase Project URL, then press Enter: "
set /p SKEY="Paste your Supabase anon public key, then press Enter: "

if defined SURL call eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "%SURL%" --environment production --visibility plaintext
if defined SKEY call eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "%SKEY%" --environment production --visibility plaintext

echo.
echo Starting the build. Say yes to the Apple sign-in and certificate questions.
call eas build --profile production --platform ios
pause
