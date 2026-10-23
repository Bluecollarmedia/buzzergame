# Buzzavid: App Store guide

Everything needed to put the Buzzavid iPhone app on the App Store. The code side is done; this page lists what the app already does to meet Apple's rules, and the steps only the account owner can do.

## Part 1. What only you can do

Work through these in order. Items marked **required** will get the app rejected or blocked if skipped.

### 1. Accounts and names

- [ ] **Apple Developer Program** membership (paid, yearly), signed in under the name that should appear as the seller. Individuals show their own name; a company needs a D-U-N-S number.
- [ ] In [App Store Connect](https://appstoreconnect.apple.com): Apps, **+**, New App. Name **Buzzavid**. If Apple says the name is taken, you can use a subtitle or add a word (for example "Buzzavid Quiz"). The name on the phone's home screen can stay "Buzzavid".
- [ ] Choose a **bundle ID** you own, in reverse-domain form (for example `com.yourname.buzzavid`). It cannot be changed later. Use the same value for `IOS_BUNDLE_ID` below.
- [ ] Expo account at expo.dev, then `npm install -g eas-cli`, `eas login`, and `eas init` inside `apps/player-mobile` (it prints `EAS_PROJECT_ID`).

### 2. Real contact details (required)

The privacy policy, terms and support pages are part of the website and read these settings. Until they are set, the pages show a placeholder address, which Apple will reject.

On the website's hosting, set:

| Variable | Example |
| --- | --- |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `support@yourdomain.com` (an inbox you read) |
| `NEXT_PUBLIC_OPERATOR_NAME` | `Your Name` or `Your Company LLC` |
| `NEXT_PUBLIC_OPERATOR_ADDRESS` | optional postal address |

Redeploy the website, then open `/privacy`, `/terms` and `/support` on your live domain and read them. These must be public web addresses (no sign-in).

The policy and terms make promises you must keep. Check you are happy with them: hosts must be 13+, reports are reviewed within about 24 hours, support replies within about one working day, finished games are deleted after 90 days, and accounts can be deleted in the app. Have a lawyer read both pages if you can; they are a sound starting point, not legal advice.

### 3. Database update (required)

Run `supabase/migrations/20261023000100_question_images_and_account_deletion.sql` on your Supabase project (SQL editor, or `supabase db push`). It adds photo questions, the photo storage bucket and in-app account deletion. A copy for pasting is in the project files as `deploy/buzzavid-app-update.sql`.

### 4. Build settings

Set these as EAS environment variables (`eas env:create`), or in `apps/player-mobile/.env` for local builds:

```
EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY   (same as the website)
EXPO_PUBLIC_SITE_URL        https://yourdomain.com  (serves join links, /privacy, /terms, /support)
EXPO_PUBLIC_SUPPORT_EMAIL   the same support address
IOS_BUNDLE_ID               your bundle ID
EAS_PROJECT_ID              from eas init
```

On the website also set `IOS_APP_ID` to `<Apple Team ID>.<bundle id>` so tapping a join link opens the app (see docs/mobile.md).

### 5. Reviewer account (required)

Apple reviewers must be able to use every feature. Create a host account for them (sign up in the app), then give it hosting access (Admin, issue yourself an access code, or grant access directly). Keep the password; you will paste it into App Store Connect.

The reviewer has one phone, so they cannot play and host at once. In the review notes (below) tell them they can host from the phone and open the "big screen" link in Safari, and attach a 30-second screen recording of a full game played with a friend's phone.

### 6. App Store Connect listing

- [ ] **Category:** Games, Trivia (or Entertainment).
- [ ] **Price:** Free. (Do not add any payment or "buy hosting" text inside the app. See "Access codes" below.)
- [ ] **Age rating:** answer the questionnaire. Expected result 4+ or 9+: no violence, mature content, gambling or web browsing. "User-generated content" is **Yes** (hosts write questions and players pick names; see Moderation).
- [ ] **Privacy Policy URL:** `https://yourdomain.com/privacy`. **Support URL:** `https://yourdomain.com/support`.
- [ ] **App Privacy:** use the answers in Part 3.
- [ ] **Screenshots** (required): at least the 6.9-inch iPhone size (1320 x 2868). Suggested set: join screen, countdown, answer buttons with the red timer, results, host quiz editor, host lobby with QR code. Take them on a real iPhone or Simulator. Light text on dark looks best, with the glass tab bar visible.
- [ ] **Description, keywords, promotional text:** see the starter copy below.
- [ ] **Export compliance:** already answered in the app (`ITSAppUsesNonExemptEncryption = false`; it uses only the system's standard HTTPS).
- [ ] **Content rights:** you own or have licence to everything in the app (the icon and artwork were made for this app).
- [ ] **Version release:** manual release is a good first choice.

### 7. Build, test, submit

```bash
cd apps/player-mobile
eas build --profile production --platform ios     # uses the newest Xcode (iOS 26 SDK), needed for Liquid Glass
eas submit --platform ios                         # uploads to App Store Connect / TestFlight
```

1. Install the build from **TestFlight** on a real iPhone and work through the checklist in Part 4. Do this before pressing Submit for Review.
2. In App Store Connect, choose the build, fill in the review notes, and **Submit for Review**. Typical review time is 1 to 3 days.

## Part 2. How the app meets Apple's rules

| Rule | What the app does |
| --- | --- |
| **5.1.1 Privacy policy** | Public policy at `/privacy`, linked in App Store Connect, on the sign-in screen and in the Account tab. It lists exactly what is collected. |
| **5.1.1(v) Delete account in the app** | Account tab, "Delete account", with two confirmations. It deletes the host's photos and then the account and everything it owns (`delete_my_account()` in the database). Guests have no account. |
| **5.1.1 Purpose strings** | Camera: "Buzzavid uses the camera only to scan a game's QR code…". Photos: "…only when you choose a picture to put on a quiz question." The camera is requested only when the player taps Scan; the photo picker is the system sheet that shows only the picture chosen. No microphone, location, contacts or tracking permissions. |
| **5.1.2 / App Tracking Transparency** | No tracking and no advertising or analytics code, so no tracking prompt is needed. The privacy manifest says `NSPrivacyTracking: false`. |
| **Privacy manifest** | `app.config.ts` declares the required-reason system APIs and the data types collected. Expo packages add their own. |
| **1.2 User-generated content** | (a) Rules in the Terms. (b) Reporting: Account tab, "Report a problem or a player" and the support page. (c) Hosts can remove any player instantly. (d) Games are private rooms that end and are deleted after 90 days. (e) Published contact details and a promise to review reports quickly. (f) Hosts can be disabled by an admin (Admin console). |
| **4.8 Sign in with Apple** | Not required: the app uses its own email and password only, no Google, Facebook or other social login. If you ever add social login, you must also add Sign in with Apple. |
| **2.1 App completeness** | Demo account (above), no placeholder content, all buttons work, no crashes on offline start (clear messages). |
| **2.5.x / 4.2 Minimum functionality** | A native app with its own interface (not a web view): native tab bar and navigation bars, haptics, camera scanner, secure storage, photo picker. |
| **Liquid Glass** | The tab bar, navigation bars and switches are Apple's own system controls, which become Liquid Glass on iOS 26. Buttons and cards use Apple's glass effect (`expo-glass-effect`) on iOS 26 and Apple's blur material on older iPhones. Builds use the newest Xcode (`ios.image: latest` in `eas.json`). |
| **3.1.1 Access codes** | Hosting access is switched on by the operator for specific accounts. The iPhone app has no purchase screen, no "redeem code" field and no prices or links to buy anything; if an account has no hosting access it simply says the account isn't set up to host. Keep it that way. Putting a paid plan on the website that unlocks features in the app would have to go through In-App Purchase (or Apple's current external-link rules for your country). Ask before adding it. |

## Part 3. App Privacy answers (App Store Connect)

"Data Used to Track You": **None**. Nothing is shared with advertisers or data brokers.

Data **linked to the user**, used only for **App Functionality**, never for tracking:

| Apple data type | Why |
| --- | --- |
| Contact Info: **Email Address** | Host sign-in and account emails |
| Contact Info: **Name** | Host display name, and the nickname a player types for a game |
| Identifiers: **User ID** | The host account id; the random per-game player id |
| User Content: **Photos or Videos** | A picture a host adds to a question |
| User Content: **Other User Content** | Quiz titles, questions and answers; player answers and scores |

Not collected: location, contacts, search or browsing history, purchases, health, financial info, diagnostics, device IDs, advertising data.

(If you later add crash reporting or analytics, update this table and `app.config.ts`.)

## Starter listing copy

- **Name:** Buzzavid
- **Subtitle (30 characters):** Live quiz buzzer for groups
- **Promotional text:** Scan the code, grab your phone, and race to buzz in. Feel the countdown in your hand.
- **Keywords:** trivia,quiz,buzzer,game night,party,classroom,pub quiz,team,live,multiplayer
- **Description:**

> Turn every phone in the room into a game-show buzzer.
>
> PLAY: Scan the QR code on the big screen (or type the room code) and you're in. No account needed. Pick your name, watch the screen, and hit your colour first. Your phone buzzes with the countdown, building from a gentle tap to a rapid rumble as time runs out.
>
> HOST: Write your own quizzes right on your phone with photo questions, and everything saves as you type. Start a game, show the big screen on a laptop or TV, and run it from your pocket: start, pause, skip, replay and see live scores.
>
> TWO GAME MODES: Multiple Choice with a timer, or Color Buzzer where the first right press wins.
>
> Designed for iPhone with Apple's Liquid Glass look. Your privacy matters: no ads, no tracking.

## Review notes (paste into App Store Connect)

> Buzzavid is a live quiz game. Players join with a QR code or 6-character room code and answer on their phones; a host runs the game and shows the questions on a big screen (a web page).
>
> **Demo host account:** email `REVIEWER_EMAIL`, password `REVIEWER_PASSWORD` (hosting access is already enabled). Go to the Host tab, open the sample quiz (or create one), and tap "Start a game". The lobby shows the QR code and room code. You can open the big-screen link from "Share big-screen link" in Safari.
> To see the player side without a second device, a short video is at `VIDEO_URL`. With two phones: host on one, then on the other tap Play, "Scan QR code".
>
> **Account deletion:** Account tab, "Delete account".
> **Reporting and moderation:** Account tab, "Report a problem or a player"; hosts can remove players from the game screen.
> **Camera:** used only to scan the join QR code. **Photos:** system picker, only when a host adds a picture to a question.
> The app has no purchases, ads or tracking.

## Part 4. Test on a real iPhone before submitting

I could not run the app on a phone or simulator from here: the code builds (iOS and Android bundles) and the shared logic and database are tested, but nothing below has been seen on a device yet. Please check each line, ideally on an iPhone with iOS 26 and, if you have one, an older iPhone.

**Look and feel**
- [ ] Tab bar at the bottom is the glass bar and shrinks when you scroll down (iOS 26)
- [ ] Headers on Host and Account are large titles that blur into the content
- [ ] Switches (Vibration, game settings) look like glass switches
- [ ] Buttons and cards show the glass effect; on an iPhone older than iOS 26 they show a blur, not a blank box
- [ ] Icon and launch screen look right; text is readable in bright light
- [ ] Nothing hides under the Dynamic Island, home bar or keyboard

**Playing**
- [ ] Scan QR: permission prompt appears only after tapping "Allow camera"; declining still lets you type the code
- [ ] Join, see "You're in!", a light double tap on joining
- [ ] 3-2-1 before a question gives a rising tap each second and a "go" burst when the question opens
- [ ] During a question: nothing until 10 s left, then soft taps (10, 8, 6), double taps (5, 4), triple heavy taps (3, 2), a fast rising buzz in the last second, and a hard buzz at zero. The red glow beats faster as time runs out
- [ ] Color Buzzer: buttons react the instant the finger lands; right answer gives a success pattern, wrong gives an error thump and a lockout
- [ ] Multiple Choice: the answer locks on release; reveal shows correct or not with the matching haptic
- [ ] Vibration off in Account silences everything
- [ ] Lock the phone mid-game, unlock: it catches up and does not replay a pile of old buzzes
- [ ] Airplane mode for 10 s then back: reconnects, no duplicate player

**Hosting**
- [ ] Sign up, confirm email, sign in; sign out; reset password
- [ ] New quiz, add questions, type, then swipe the app away mid-edit and reopen: nothing lost
- [ ] Add, change and remove a photo; the photo appears on the big screen during that question
- [ ] Start a game: QR and room code shown, players appear, Start, Next, Pause, Skip, Replay, End, Play again
- [ ] Account tab: Delete account removes everything and signs out; signing in again fails

**Store basics**
- [ ] `/privacy`, `/terms`, `/support` open from the Account tab inside the app
- [ ] Join links from Messages open the app (needs `IOS_APP_ID` on the website)

## What changes for Android later

The same code builds for Android (the bundle builds today). To release there you need a Google Play Console account ($25 one-time), the same privacy answers in the Data safety form, and the Android signing fingerprint on the website for app links. Android uses Google's native tab and navigation bars and a frosted look in place of Liquid Glass.
