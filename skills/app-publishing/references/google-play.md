# Google Play Console (Android)

## The gates (know these before promising a launch date)

1. **Closed-testing requirement — personal accounts** created after Nov 2023: run a **closed test with ≥12 opted-in testers for ≥14 continuous days**, then **"Apply for production access"**. Google reviews it.
   - **Internal testing does NOT count** — it must be the *closed* track.
   - It is an **account-level, one-time** unlock: later apps and all updates skip it.
   - **Organization accounts are exempt** (requires business verification / D-U-N-S).
   - Testers must actually *opt in* via the link, so line up a couple more than 12.
2. **Android developer verification** — separate program: apps installed on certified Android devices must come from a verified developer, **regardless of distribution channel**. For Play-distributed apps it's satisfied automatically; you only register package names manually for apps you ship **outside** Play.
3. **App content** must be complete before any release: privacy policy, ads declaration, content rating, target audience, **Data safety**, plus store listing, app category and contact email.

## Building a signed AAB

```bash
npm run build                       # web bundle (typecheck + tests + vite)
npx cap sync android                # copy web assets into the native project
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

**JAVA_HOME gotcha (macOS):** gradle fails with *"Unable to locate a Java Runtime"* because macOS ships no JDK. Use Android Studio's bundled JBR:
```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
```
Only the gradle step needs it.

**Signing** — `android/keystore.properties` + the `.jks` (both **gitignored**):
```properties
storeFile=keystore/upload-keystore.jks
storePassword=…
keyAlias=upload
keyPassword=…
```
Get the upload key's SHA-256 (public info, sometimes requested by Play):
```bash
keytool -list -v -keystore keystore/upload-keystore.jks -alias upload
```
SHA-**256** is the long one; don't paste the shorter SHA-1 into a SHA-256 field.

**Versions:** `versionCode` must strictly increase per upload; keep `versionName` equal to the iOS marketing version.

## Store listing & ASO

| Field | Limit | Notes |
|---|---|---|
| App name | 30 | brand + main keyword |
| Short description | 80 | **Play indexes this heavily** — lead with the genre keyword |
| Full description | 4000 | Play indexes the body text too, so use natural keyword repetition |

Unlike Apple there's no separate keyword field — the descriptions *are* the keywords.

**Data safety** with AdMob: data **is** collected/shared — *Device or other IDs* (Advertising), typically *App activity*; encrypted in transit; not linked to an account. Answering "no data collected" while shipping ads is a policy violation.

## Uploading

- **With a service account** (`fastlane supply` / gradle-play-publisher): create it in Google Cloud, enable the *Google Play Android Developer API*, download the JSON key, then grant it access in Play Console → Users and permissions. Afterwards uploads and listing pushes are fully scriptable.
- **Without one**: upload through the Console UI (manual or browser automation).
- Upload to the **closed testing** track first, add the tester list, then promote to production once you have production access.

## Driving the Console with browser automation

Play Console is an **Angular Material SPA** and fights naive automation. What works:

- **Probe auth first** — navigate and check whether the URL redirects to a sign-in page. An automation browser can be headless yet still hold a valid Google session.
- **Assign a temporary id, then act on it:** `el.id = 'tmp-x'` via an evaluate call, then click/type against `#tmp-x`. Survives element-ref churn and duplicate/hidden buttons (Play renders hidden twins — pick the one with `offsetParent !== null`).
- **Read state cheaply** with `document.body.innerText` slices or `[role="group"][aria-label="…"]`, instead of dumping huge accessibility snapshots.
- **Typing must be real.** Manually dispatching `input` events does **not** register in Angular's form model. The reliable signal that a value landed: the floating **Save** bar (or a dialog's **Apply**) flips from *disabled* → *enabled*. Still disabled = Angular didn't see it.
- **Chip inputs** (tester email lists): fill the whole comma-separated string, then press **Enter** to convert it into chips. Don't slow-type long strings — automation backends often cap a single call at ~5s and truncate mid-string.
- **Save with a real click**, not a scripted `.click()`. If a floating action bar intercepts, target that exact button by id. **"Save and publish"** opens a *"Publish change on Google Play?"* confirmation — confirm it. For a draft app this only applies config; it does not make the app public.
- **Verify by reloading.** In-page state lies: a field can look empty while the change already saved server-side. Reload and re-read the dashboard's setup checklist.
- **URLs:** app dashboard `/console/u/0/developers/<devId>/app/<appId>/app-dashboard`; get `<appId>` from the app-list "View <app>" link. Direct track URLs like `/tracks/closed-testing` sometimes 500 — go via `/test-and-release` or the numeric track id `/tracks/<n>?tab=testers`.

## Monetization notes

- The Remove-Ads IAP needs a **Google Payments profile** (bank + tax) before it can be sold — that's the developer's own legal/financial data, so it must be completed by them.
- Android AdMob ads typically don't fill until the AdMob app is approved, which usually follows the app going live. Plan for delayed Android ad revenue.
