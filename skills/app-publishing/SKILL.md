---
name: app-publishing
description: End-to-end playbook for shipping and monetizing a mobile app (Capacitor / iOS / Android) — AdMob ads, Remove-Ads IAP, rate prompt, App Store Connect + fastlane, Google Play Console and its testing gates, store metadata/ASO, and the release pipeline. Use when wiring ads or IAP, writing a store listing, bumping versions, building a release, uploading to TestFlight or Play, or submitting for review.
---

# Shipping & monetizing a mobile app

Playbook distilled from real releases (Capacitor + TypeScript games, AdMob + one-time IAP, fastlane, Play Console). Read the section you need; deep detail lives in `references/`.

## The release pipeline (always this order)

1. **Code gate** — typecheck + unit tests + bundle. Never ship past a red gate.
2. **Bump versions** — iOS build number *and* marketing version; Android `versionCode` (must increase) + `versionName` (keep it equal to iOS).
3. **Sync native** — `npx cap sync ios|android` so the web bundle lands in the native project. *Forgetting this ships the previous build's UI.*
4. **Upload to a TEST track first** — TestFlight (iOS) / closed testing (Android). Never straight to production.
5. **Test on a real device** — including a **sandbox IAP purchase** and the ad cadence.
6. **Store metadata** — must match what the app actually does (see the honesty rule below).
7. **Submit → manual release** so *you* choose the go-live moment.

## Non-negotiables

- **Store copy must match reality.** If the app serves ads or has an IAP, the description/privacy answers must say so. Claiming "no ads / no in-app purchases / no data collection" while shipping AdMob is an App Review rejection (Apple 2.3) *and* a false privacy label. Fix the copy before submitting.
- **Declare ad data collection.** iOS App Privacy → Identifiers (IDFA) + Usage Data for Third-Party Advertising, *Not Linked*, *Used for Tracking*. Android Data safety → Device ID etc. This is separate from the IDFA question asked at submission time.
- **Never commit secrets** — `*.p8`, ASC API key JSON, `keystore.properties`, `*.jks`. Gitignore them; verify before every commit.
- **Manual release** (`automatic_release: false`) — approval ≠ launch.
- **Never click your own live ads** — invalid traffic gets the AdMob account banned.

## Platform quick-reference

| Task | How |
|---|---|
| Ads setup, test→live, ATT/consent | `references/admob.md` |
| iOS build, TestFlight, metadata, submit | `references/app-store.md` |
| Android build, Play gates, listing | `references/google-play.md` |
| Ad cadence, rewarded, IAP, rate prompt | `references/monetization.md` |

## Two gates that surprise people

- **Google Play, personal accounts** (created after Nov 2023): before your *first* production release you must run a **closed test with ≥12 testers for ≥14 continuous days**, then "Apply for production access". Internal testing does **not** count. It's an **account-level, one-time** unlock — later apps and all updates skip it. Organization accounts are exempt (needs business verification).
- **Apple version trains**: you cannot upload a build for a marketing version that's already `READY_FOR_SALE`. Bump `MARKETING_VERSION` first, or the upload fails with *"Invalid Pre-Release Train … is closed"* (90186/90062).

## Driving the store consoles

Prefer **CLI/API** over clicking:
- **iOS → fastlane + ASC API key.** Fully scriptable: create the version, push metadata, attach the build, submit. No browser.
- **Android → Play Console.** No service-account key by default, so either create one (for `supply`) or drive the console in a browser.
- **Browser automation caveat:** an automation browser may be *headless* (the user sees nothing) yet still hold a **persistent login** for some providers and not others. **Probe first** — navigate to the console and check whether the URL redirects to a sign-in page. Techniques for the Play Console SPA: `references/google-play.md`.
- **Read-only checks without logging in:** a live app's public store page shows its privacy label and listing — fetch it instead of authenticating.

## Health check before you submit

- [ ] Test flag off (`TESTING = false`) and **live** ad unit IDs per platform
- [ ] Native ad app IDs present (iOS `Info.plist`, Android `AndroidManifest.xml`)
- [ ] IAP product exists in the store and the product id matches the code
- [ ] Store description/keywords honest + within limits; privacy answers declare ad data
- [ ] Versions bumped, `cap sync` run, gate green
- [ ] Tested on a real device from the test track (incl. sandbox purchase)
- [ ] No secrets in the diff
