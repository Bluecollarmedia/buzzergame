# Native player app

`apps/player-mobile` is an Expo React Native app built with native components, not a WebView. It does what the browser player does, plus:

- scans the QR code with the camera (expo-camera). Permission is asked only when the player taps **Allow camera**, and typing the room code always works instead.
- keeps the player secret in the iOS Keychain or Android Keystore (expo-secure-store)
- opens `https://<your-domain>/j/<token>` links directly in the app (universal links and app links), plus the `crowdquiz://j/<token>` scheme
- keeps the screen awake during a game and uses haptic feedback

It uses the same `packages/shared` rules, API client and realtime sync as the website.

## Status

The app type-checks, and its iOS and Android JavaScript bundles build with `expo export`. It has **not** been run on a simulator or a real phone yet. Before release, work through the manual checklist below on real devices.

## Configure

```bash
cp apps/player-mobile/.env.example apps/player-mobile/.env
```

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Same public values as the website |
| `EXPO_PUBLIC_SITE_URL` | Your website, e.g. `https://crowdquiz.example.com`. Used for link handling and to accept only your QR codes. |
| `IOS_BUNDLE_ID` / `ANDROID_PACKAGE_NAME` | Your app identifiers, e.g. `com.yourcompany.crowdquiz` |
| `EAS_PROJECT_ID` | From `eas init` |

## Run in development

The camera and secure storage are native modules, so use a development build rather than Expo Go:

```bash
cd apps/player-mobile
npx expo run:android      # needs Android Studio
npx expo run:ios          # needs a Mac with Xcode
```

To point a phone at your local Supabase, set `EXPO_PUBLIC_SUPABASE_URL` to your computer's LAN address (e.g. `http://192.168.1.20:54321`), not `127.0.0.1`.

## Build with EAS

You need an Expo account. For the stores you also need an Apple Developer Program membership (paid, yearly) and a Google Play Console account (one-off fee).

```bash
npm install -g eas-cli
cd apps/player-mobile
eas login
eas init                         # creates the project and prints EAS_PROJECT_ID
eas build --profile preview --platform android   # installable APK for testing
eas build --profile production --platform all
eas submit --platform ios        # App Store Connect / TestFlight
eas submit --platform android    # Google Play
```

Set the `EXPO_PUBLIC_*` values as EAS environment variables (`eas env:create`) so cloud builds receive them.

## Universal links and app links

1. **iOS:** set `IOS_APP_ID` on the website to `<Apple Team ID>.<bundle id>`. The website serves `/.well-known/apple-app-site-association` from it. The app's associated domain comes from `EXPO_PUBLIC_SITE_URL`.
2. **Android:** set `ANDROID_PACKAGE_NAME` and `ANDROID_SHA256_CERT_FINGERPRINTS` on the website. The fingerprint comes from `eas credentials` or Play Console → App signing. The website serves `/.well-known/assetlinks.json`.
3. Redeploy the website, then reinstall the app so the operating system checks the links again.

If the app is not installed, the same link opens the browser player, so nobody gets stuck.

## Manual device checklist

- [ ] Fresh install → **Scan QR code** → permission prompt appears only then; declining still allows typing the room code
- [ ] Scan a game QR → name → lobby shows "You're in!"
- [ ] Scan a QR from another website → "isn't a CrowdQuiz game"
- [ ] Tapping a `https://<domain>/j/…` link in Messages opens the app
- [ ] Multiple Choice: buttons enable when the question opens, lock after answering, and the countdown matches the projector
- [ ] Color Buzzer: a wrong press shows the lockout; the first right press shows "You got it first!"
- [ ] Lock the phone mid-game, unlock → state catches up within a second or two
- [ ] Turn on airplane mode for 10 seconds, then off → reconnects; no duplicate player
- [ ] Force-quit and reopen the link → same player and score
- [ ] VoiceOver / TalkBack read the answer buttons by colour and letter
