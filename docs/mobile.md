# Buzzavid app (iPhone and Android)

`apps/player-mobile` is the Buzzavid app: an Expo React Native app built with native components, not a WebView. It is one app for two roles.

**Players** (no account)
- scan the QR code with the camera (expo-camera), or type the room code. Camera permission is asked only when the player taps **Allow camera**.
- see the answer buttons, a timer ring, a red edge glow that beats faster as time runs out, and results, with a haptic design described below
- keep the player secret in the iOS Keychain or Android Keystore (expo-secure-store), so closing the app never loses their place
- open `https://<your-domain>/j/<token>` links directly in the app (universal links and app links), plus the `buzzavid://` and `crowdquiz://` schemes

**Hosts** (email and password account, the same accounts as the website)
- write quizzes and questions in an editor where everything saves as you type (same server-side drafts as the website, plus a backup on the phone that is replayed if the app is killed mid-save)
- add one photo per question (system photo picker, resized to 1280 px and uploaded through the website to their own folder in the Cloudflare R2 photo bucket); it shows on the big screen
- start a game and run it from the phone: QR code and room code, live player list, start, pause, skip, replay, end, scores, play again
- delete their account from the Account tab (required by Apple)

It uses the same `packages/shared` rules, API client and realtime sync as the website.

## Design

- Dark, glowing backdrop with the four answer colours fixed (red A, blue B, green C, purple D), the same as the big screen.
- **Liquid Glass, Apple's own.** The tab bar (`expo-router/unstable-native-tabs`), navigation bars (native stack, transparent with large titles) and switches (React Native `Switch`) are the system controls, so on iOS 26 they are Liquid Glass with no custom drawing. Buttons and cards use `GlassView` from `expo-glass-effect` on iOS 26, Apple's system blur material on older iPhones, and a translucent surface on Android (`src/components/glass.tsx`). EAS builds use the newest Xcode image (`ios.image: "latest"`); building with an older SDK would switch the system controls back to the old look.
- Interactions use `react-native-reanimated` springs. Buzzer-mode buttons fire on touch-down, multiple-choice buttons on release.

## Haptics

The plan lives in `packages/shared/src/haptics.ts` (pure and unit-tested) and is played by `src/lib/haptics.ts` with `expo-haptics`. Beats are placed by time remaining, so a 15 s and a 60 s question feel the same in the last seconds.

| Time left | What you feel |
| --- | --- |
| Before the question | 3-2-1: light, medium, heavy tap, then a "go" burst when it opens |
| More than 10 s | Nothing |
| 10, 8, 6 s | One soft tap (slow heartbeat) |
| 5, 4 s | Double tap, once a second |
| 3, 2 s | Heavy triple tap, once a second |
| 1 s | A fast rising buzz across the whole last second |
| 0 s | Hard buzz and an error thump |
| Your answer | Press = medium tap; right = success; wrong = error; first to buzz = success then heavy taps |

If the phone was locked or offline, old beats are skipped, not replayed. Players can turn vibration off in the Account tab. iPhones play taps from the Taptic Engine; the intensity and spacing on Android depend on the phone's motor.

## Status

The app type-checks and its iOS and Android JavaScript bundles build with `expo export`. It has **not** been run on a simulator or a real phone yet. Before release, work through the checklist in [app-store.md](app-store.md).

## Configure

```bash
cp apps/player-mobile/.env.example apps/player-mobile/.env
```

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Same public values as the website |
| `EXPO_PUBLIC_SITE_URL` | Your website, e.g. `https://your-domain.com`. Used for link handling, to accept only your QR codes, and for the privacy, terms and support pages. |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | The support inbox shown in the app |
| `IOS_BUNDLE_ID` / `ANDROID_PACKAGE_NAME` | Your app identifiers, e.g. `com.yourname.buzzavid` |
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
