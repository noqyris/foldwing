# Shipping Foldwing

App Store Connect app id **6794804195** · bundle `com.noqyris.foldwing` · team
`YMN45WC2QR`. The Xcode project is at **1.4, build 54** — `MARKETING_VERSION`
and `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`, which
is the only version fact this repo can prove. What App Store Connect holds is a
different question; the answers below say when and how each was read.

> **Do not press Submit.** Nothing in this file is an instruction to submit.
> The author decides when, and will say so. Everything here is preparation.

## Where the listing stands

**1.3 is on sale**: build 50, the Unity LevelPlay release, approved and released
2026-09-17 (release type AFTER_APPROVAL, the owner's choice for that one).
**1.4 is in preparation**: its version record was created through the API on
2026-09-23, with release type **MANUAL**, no build attached, nothing submitted.
Everything in the 1.4 column was set through the API that day and read back to
verify.

| | 1.3 (on sale) | 1.4 (in preparation) |
|---|---|---|
| Name | `Foldwing: Mirror Maze Puzzle` | `Foldwing: One Line Mirror Maze` (30/30) |
| Subtitle | `Draw one line, fold it in two` | `Drawing puzzle, hidden walls` (28/30) |
| Keywords (en-US) | `symmetry,reflection,labyrinth,brain,logic,teaser,zen,calm,minimal,ink,doodle,trace,daily,offline,iq` | `labyrinth,draw,stroke,single,symmetry,daily,minimalist,invisible,cozy,zen,logic,relaxing,offline` (96/100 bytes; no word from the name or subtitle, nothing of 2 characters) |
| Localizations | en-US | en-US, **en-GB** (an exact copy), **es-MX** (a second keyword set indexed on the US store), **hr** (the local language of the RS, HR, BA and ME stores). The game itself stays in English, and the es-MX and hr texts say so |
| Description / What's New | the 1.3 text | rewritten for 1.4 in all four (missions, bookmarks, chapter rewards, the result card, the new store, reminders at your time) |
| Promotional text | changed 2026-09-23 to a line that names only 1.3 features | the 1.4 line, set: "Draw one line; its mirror must clear walls you can't see. New in 1.4: …" |
| Screenshots | 4 × 6.7" | **not uploaded yet** — nine 1320×2868 frames are ready in `store/screenshots/1.4/` (see below) |
| Build | 50 | none yet — `npm run release:appstore` attaches it |
| Icon | the ShareCard mark | "Mirror Path" (new), plus the alternate "The Fold" in the binary for a later Product Page Optimization test |

Unchanged on both: support and marketing URL `https://www.noqyris.com/`, privacy
policy `https://www.noqyris.com/foldwing/privacy.html` (live), categories Games →
Puzzle, Casual · secondary Entertainment, age rating **4+**.

The name, subtitle and keyword field are on the **new app info**, which goes live
with 1.4; the 1.3 listing is untouched until then. The words were chosen from a
keyword study, and the reasoning — why "One Line" in the name, why `brain` and
`hard` are out — is kept in the session's ASO notes, not in this repo. Expect a few
days of ranking swings after the rename; the home-screen name
(`CFBundleDisplayName` "Foldwing") does not change.

### Still to do for 1.4, by hand, in this order

**1. Screenshots.** Upload `store/screenshots/1.4/01.png` … `09.png` to the en-US
6.9" set (`APP_IPHONE_67`, the slot 1.3 uses), in that order; the other locales
inherit them. Each frame is a real capture of the 1.4 game on an **ads-off** dev
server, every winning stroke a validator-proved route, never ∞, a price or an ad —
`scripts/screenshots/capture.mjs`, then `compose.py` for the caption band. If App
Store Connect refuses 1320×2868, recapture at 1290×2796 rather than resizing (the
aspect differs). If the 1.4 UI changes before release, recapture.

**2. The privacy page** (see *Before the submission: publish the web pages*). It
still says the optional reward videos "stay available" after Remove Ads; in 1.4 an
owner is offered none — skips and repairs are simply free. Fix that sentence, publish,
and run the curl checks.

**3. App Privacy — nothing to change for 1.4.** The reminders are local
notifications and the store is StoreKit; neither collects anything. The label, as
published on 2026-09-16 and live, for reference — every type below, and no fewer:

| Category → type | Purpose | Linked to identity | Used for tracking |
|---|---|---|---|
| **Location → Coarse Location** | Third-Party Advertising | Not linked | Yes |
| **Identifiers → Device ID** | Third-Party Advertising, Analytics, App Functionality | Not linked | Yes |
| **Usage Data → Product Interaction** | Third-Party Advertising | Not linked | Yes |
| **Usage Data → Advertising Data** | Third-Party Advertising | Not linked | Yes |
| **Diagnostics → Crash Data** | Analytics, App Functionality | Not linked | **No** |
| **Diagnostics → Performance Data** | Analytics, App Functionality | Not linked | **No** |
| **Diagnostics → Other Diagnostic Data** | Analytics, App Functionality | Not linked | **No** |

Foldwing itself has no server, no account and sends nothing anywhere; every
answer describes what the ad SDKs inside the app collect — Unity LevelPlay, Unity
Ads and ironSource's Ad Quality SDK, whose bundled privacy manifest brings the
Diagnostics rows and Device ID's Analytics and App Functionality. The privacy
policy must list the same data (approximate location, advertising identifier, ad
interaction, diagnostics) and name **Unity LevelPlay**. The label, the policy and
the bundled manifests have to agree or review bounces it.

**4. Submit — NOT YET, AND NOT BY ANYONE BUT THE AUTHOR.** This step is written
down for completeness. It is not a task, it is not the last box on a checklist
somebody else may tick, and no other piece of work implies it. The author will
say when. It comes after `npm run release:appstore` has finished **and** the web
pages are published and checked. When that day comes: confirm the version points
at the live build N (`fastlane attach_build` did it); **attach
`com.noqyris.foldwing.reveals25` to the same submission** (see the purchases
below — if it is left out, first drop the starter clause from What's New and change
the description's purchases sentence to "Reveal packs are also sold."); confirm the
release type is still **MANUAL** so approval cannot auto-publish; and answer export
compliance (**no** non-exempt encryption — `ITSAppUsesNonExemptEncryption` is
already `false` in `Info.plist`, which is what keeps the question off the upload).

The 1.0-era blockers — no price schedule, no territories on the app — were fixed
by hand for 1.0 and have held on every version since.

### Before you submit: no sandbox purchase is on record

No sandbox purchase has been recorded in this repo — not of Remove Ads, not of a
pack, and never of the starter, which StoreKit has not sold to anyone yet. App
Review approved the first four, but App Review tests in-app purchases on every
submission, so a failure there is a rejection and a lost cycle. Three separate
defects were found and fixed in that path in one afternoon in 1.0 — the product had
zero territories, StoreKit asked for an Apple Account at startup, and a silent
restore on launch put a repeating sign-in dialog over the home screen. Every one of
them surfaced by running it, none by reading it. 1.4 rewrote the delivery path
(credited once per transaction id, written to disk before `finish()`, Ask to Buy),
which is all the more reason to run it.

Ten minutes on a TestFlight build with a Sandbox Apple ID covers what a reviewer
will do: buy a pack from the store and confirm the stash rises by exactly that;
buy the starter (after five wins, and after its $0.99 price has propagated — up
to about an hour after an edit) and confirm it never shows again; kill the app
right after a purchase and relaunch — credited once; buy Remove Ads and confirm the
banner and interstitials stop and reveals read ∞; then delete, reinstall, **Restore
purchases** (Settings, or the store's footer), and relaunch twice with no repeat
sign-in prompt. The store's other paths — cancel, failure, Ask to Buy, every
restore outcome, the storefront fixtures — are walked in a browser on the fake
store (`npm run dev:mock`), which delivers through the same code.

## Ads: which build is which

**Ads come from Unity LevelPlay, and LevelPlay has no test inventory.** Its test
flag only unlocks the Test Suite; every build with the ad layer on serves the real
waterfall. So the AdMob-era idea of a "test ads" TestFlight build is gone — such a
build would put live ads on the owner's phone. There are exactly two kinds of
upload, and the rules are in [CLAUDE.md](CLAUDE.md):

| Build | Markers | Made by | For |
|---|---|---|---|
| live | `ADMODE:live` + `ADS:on` | `npm run ios:appstore` + `fastlane release_build` | the App Store submission. Never opened from TestFlight |
| ads-off | `ADMODE:test` + `ADS:off` | `npm run ios:testflight` + `fastlane beta_adsoff` | the default TestFlight build, including the one that must follow each live upload |
| mock | `ADMODE:test` + `ADS:mock` | `npm run ios:sync:mock` + `fastlane beta_mock` | a TestFlight build with fake ads, on the owner's request. Never attached or submitted |

To see ads — placement, frequency, rewards — use the **mock** build, which draws
fake ads in the page and calls no network: `npm run dev:mock` in a browser,
`npm run ios:sync:mock` for the simulator, plus `fastlane beta_mock` to put it on
TestFlight. It never reaches the store: `attach_build` refuses its build numbers.

### The AdMob-era ledger (history)

Builds up to 49 were AdMob binaries, and every one of them is now expired on
TestFlight. The ledger is kept for what it teaches about recording uploads; its
TEST/LIVE column describes AdMob unit sets that no longer exist.

| build | units | for |
|---|---|---|
| 10 | TEST | judging placement and frequency; ads actually render |
| 11 | LIVE | shipped in the 1.0 that is READY_FOR_SALE |
| 12 | LIVE | attached to the 1.1 review submission (100 hardened levels) |
| 13 | LIVE | the 300-bar-level set + menu fix — TestFlight |
| 14 | TEST | the MAZE set — TestFlight only, so the tester can SEE ads |
| 15–18 | **unknown** | not recorded at upload time, and unknowable now |
| 19 | **TEST when uploaded** | archived with Google's test publisher in the plist, and the suite green |
| 20 | LIVE | **2026-08-09, uploaded to TestFlight, not submitted.** `NSPhotoLibraryAddUsageDescription`, `PrivacyInfo.xcprivacy`, the v1→v2 save migration, the Daily's ad-grace / decoy / fallback / medal fixes, settings, level-1 onboarding, a campaign ending, and 1228 tests green. Verified by unzipping the ipa, not by trusting the archive |
| 21 | **TEST** | **2026-08-09, TestFlight only, NEVER SUBMIT.** Same code as 20, archived as a test-ads build |
| 22 | **TEST** | **2026-08-10, TestFlight only, NEVER SUBMIT.** The polish pass: paper launch screen (21 and earlier opened on Capacitor's white splash with its blue logo), dark status-bar content, a Remove Ads purchase that actually applies without a relaunch, purchase/restore feedback, win-screen overlay and tap fixes, a bounded note ladder, sticky teaching lines, reduced motion everywhere. 1234 tests green |
| 23 | **TEST** | **2026-08-10, TestFlight only, NEVER SUBMIT.** First build verified by actually PLAYING it: a harness draws the validator's proved route and asserts 45 things across the loop, the Daily, settings, the campaign end and the level grid. Fixes an ad listener leak, the web-daily end card showing a second share underneath itself, and its "Fold again" carrying the last run's deaths into the next score |
| 24 | **TEST** | **2026-08-10, TestFlight, internal only, NEVER SUBMIT.** Same code as 23; uploaded to prove the distribution fix end to end. `internal=IN_BETA_TESTING`, verified by unzipping |

**This ledger cannot tell you what is on TestFlight right now.** Nothing in the
repo can: the Xcode project carries a build number, but fastlane
derives the real one from App Store Connect at upload time, and nobody wrote
down what went out for 15 through 18. Rows are not invented here to fill the
gap — an invented row is worse than a missing one, because a missing row makes
you go and look. Go and look: App Store Connect → TestFlight → Builds.
### Uploaded is not the same as installable

Builds 19 to 22 all sat on App Store Connect as `VALID` and none of them ever
reached a phone. `upload_to_testflight` ran with
`skip_waiting_for_build_processing: true`, which returns as soon as the bytes
are accepted — and a build that has not finished processing cannot be
distributed, so it never was. The internal group compounds it: it was created
without `hasAccessToAllBuilds`, and that flag is **create-only** (Apple answers
"can not be included in a 'UPDATE' operation"), so the group only ever shows
builds handed to it explicitly.

Upload and distribution are two separate steps on purpose.
`upload_to_testflight(groups:)` looks like the obvious fix and is a trap: pilot's
distribute path calls `post_beta_app_review_submission`, so asking it to
distribute **asks Apple to review the build**. On build 24 that fired, and the
only reason a TestFlight-only build was not sent to Apple is that it failed on an
empty Beta App Description. The lane no longer asks pilot to distribute; that job goes
to `Build#add_beta_groups`, which touches no review queue:

    asc-tf-groups assign --app com.noqyris.foldwing

Check `internal=IN_BETA_TESTING`, not `processing=VALID`:
`asc-tf-groups builds --app com.noqyris.foldwing`.

**From now on the ledger is updated at upload time, in the same commit as the
version bump.** A row written afterwards is a row written from memory, and the
whole point of this table is that memory is what failed.

### The LevelPlay-era ledger

Builds are told apart by the markers the gates count, and fastlane keeps its own
record: `build/.live-build-number` (the live build, until it is expired) and
`build/.fake-ads-builds` (every mock build, which `attach_build` refuses).

| build | markers | for |
|---|---|---|
| 50 | `ADMODE:live` + `ADS:on` | **1.3**, submitted 2026-09-16, on sale since 2026-09-17. Expired on TestFlight the same day by `expire_real_ads` |
| 51 | `ADS:off` | the N+1 of the 1.3 release — the TestFlight build that made 50 safe |
| 52 | `ADS:mock` | 1.4 work in progress, fake ads, TestFlight only. **Archived with Xcode 27 and no scene manifest: it dies at launch on iOS 27.** Never install it |
| 53 | `ADS:mock` | 1.4 work in progress with the UIScene manifest, fake ads, TestFlight only |
| 54 | `ADS:mock` | **2026-09-23**, the 1.4 iteration — missions, bookmarks, store, reminders, Duo — with fake ads and the StoreKit sandbox, TestFlight only. NEVER SUBMIT |

### The guard, and what replaced it

Under AdMob, build 19 went out carrying Google's test publisher because the old
test only proved that two knobs — a TypeScript flag and the plist's app id —
**agreed**, and both on TEST agree perfectly. The fix then was to stop either knob
being a checked-in value. That whole mechanism (`useTestAds`,
`GADApplicationIdentifier`, the `build/.test-ads` marker, `fastlane beta_testads`)
went with AdMob.

What guards a release now reads what is actually inside the build:

- `scripts/check-ad-mode.mjs` counts the `ADMODE` and `ADS` markers baked into the
  bundle, exactly once each, against the target;
- `scripts/check-native-sync.mjs` proves, after the sync, that the native bundle is
  `dist/` and that CocoaPods installed LevelPlay and its Unity Ads adapter from the
  current Podfile;
- `scripts/check-no-google.mjs` refuses any AdMob plugin, pod, plist key,
  SKAdNetwork id or publisher id anywhere in the repo;
- `fastlane build_ipa` runs all three again, hands `AD_TARGET` to the Xcode
  "Ad-mode guard" phase, and reads the archived binary for the LevelPlay and Unity
  Ads adapter classes;
- since 1.4, `check-ad-mode` also refuses the browser's fake store ("FAKE
  PURCHASE") in every bundle but the mock one, and `check-native-sync`,
  `build_ipa` and `beta_upload` each refuse a build without the UIScene manifest
  — the defect that killed build 52 — or with `UIRequiresFullScreen`. A refused
  archive's ipa is deleted, so `beta_upload` cannot ship it.

After any lane, `git diff ios/` should show only the build-number and marketing
version the lane wrote — check it. That is also how the agvtool clobber described
under "Build and upload" gets caught.

## The purchases — five products, no new ids in 1.4

    com.noqyris.foldwing.removeads   non-consumable, $2.99, family-shareable   APPROVED
    com.noqyris.foldwing.reveals10   consumable, 10 reveals, $0.99            APPROVED
    com.noqyris.foldwing.reveals20   consumable, 20 reveals, $1.49            APPROVED
    com.noqyris.foldwing.reveals30   consumable, 30 reveals, $1.99            APPROVED
    com.noqyris.foldwing.reveals25   consumable, 25 reveals, $0.99            READY_TO_SUBMIT
                                     — THE STARTER: sold once per install, after the 5th win

`reveals25` was created when the ladder was 10/25, superseded when it moved to
10/20/30, and never sold. In 1.4 it is the one-time **starter pack**: ids are
permanent, it is the only unsold product, and its id already names its count. With
the 1.4 work its App Store Connect base price moved from $1.49 to **$0.99 (USA,
equalized)** — a price edit, not a review submission — because at $1.49 it became
€1.99, the same money as thirty reveals for twenty-five; at $0.99 it is the 10-pack's
tier everywhere, so "save 60%" is true in every storefront (and the app computes the
saving from real prices anyway, and hides the starter wherever it is not a deal).
Reference name "Starter 25 Reveals", display name "25 Reveals". **It must go to review
attached to the 1.4 submission**; until it is approved, production StoreKit does not
return it and the store simply has no starter row.

The ids live in `src/config/monetization.ts` (`products`, and `economy.starter`), the
store surface in `systems/Iap.ts`, and the sheet that sells them in
`render/StoreSheet.ts`.

Each of these has to be true for every product, the starter included, in App Store
Connect:

- the product exists and is **Ready to Submit** (or approved) — a consumable that is
  merely *Ready for Review* is not the same state and does not ship
- **territories**: all 175, explicitly. A product can report Ready to Submit
  with zero territories set — App Store Connect does not treat that as missing,
  and it would be unpurchasable everywhere. This happened once already
- **pricing** set on the product in its own right; nothing is inherited
- a **review screenshot** and review notes on each product, or the submission is
  rejected on metadata before anyone plays the game. The starter's note: "One-time
  starter pack; the app offers it once per install after the fifth win."
- a product not yet approved is **attached to the version** being submitted

The store offers the rewarded video first and the packs below it, never the other
way round: reveals have to stay earnable or the rewarded loop stops being an honest
deal. The free row is the only primary button, capped at five ad-paid reveals a day;
the starter follows it, then the rungs the local prices keep honest, then Remove Ads.
That ordering lives in `StoreSheet.storeOffers`, one definition for every screen that
sells.

### Remove Ads

**It is wired, in the build, and approved.** `cordova-plugin-purchase` drives
StoreKit and the whole store surface lives in `systems/Iap.ts`. Since 1.4 it also
makes skips and streak repairs free, and an owner is never offered an ad — the store's
second line says "no ads, unlimited reveals & skips".

Two things that were wrong and are worth remembering. The product reported
`READY_TO_SUBMIT` with **zero territories set**, which would have made it
unpurchasable everywhere — App Store Connect does not treat that as missing.
And `needAppReceipt` defaults to true, which verifies the app receipt at
startup; on a fresh install there is no receipt, so StoreKit asks the user to
sign in to their Apple Account before the player has touched anything. It is
set to false.

**Still unverified from this repo:** a real sandbox purchase (see *Before you
submit*). It cannot be done from this machine — it needs a Sandbox Apple ID on a
device.

## Two native files that are now submission blockers

Both are in the tree and both are pinned by `monetization.test.ts`, so neither
can quietly go missing. They are listed here because each prevents a specific,
expensive failure that has nothing to do with the game.

**`NSPhotoLibraryAddUsageDescription` in `Info.plist`** prevents a crash, not a
denial. Picking *Save Image* from the iOS share sheet runs the save inside this
app's process, and iOS terminates a process that reaches the photo library with
no add-only usage string — SIGABRT, on the spot, with no dialog to decline.
The share pill is reachable from the win screen, the gallery and the web-daily
end card, which makes it one of the first things a reviewer taps. A crash there
is a rejection.

**`ios/App/App/PrivacyInfo.xcprivacy`** prevents **ITMS-91053**, the automated
rejection email for undeclared required-reason APIs. `@capacitor/preferences`
reaches `UserDefaults` and `@capacitor/filesystem` reads file timestamps, and
neither plugin ships a privacy manifest of its own (verified: only
`@capacitor/ios` core has one), so the App target has to declare both —
`CA92.1` for UserDefaults, `C617.1` for file timestamps. The manifest declares
`NSPrivacyTracking: false` — true with no tracking domains is what Apple returned
as INVALID_BINARY for builds 36–39; the reasoning is in the file's own comment.
`NSPrivacyCollectedDataTypes` is deliberately **empty**: everything the App
Privacy label declares is collected by the ad SDKs (Unity LevelPlay and Unity
Ads), whose pods ship their own manifests, and declaring it twice would claim the
app touches data it never sees. The test
also greps the Xcode project for `PrivacyInfo.xcprivacy in Resources`, because a
manifest that is not in the Copy Bundle Resources phase is not in the bundle and
Apple will not see it.

## Build and upload

    nvm use                              # Node 22 — the Capacitor 8 CLI refuses older
    npm test                             # gate — never ship past a red suite
    set -a; source .env.appstore; set +a
    npm run release:appstore             # an App Store release: BOTH halves, in order

`release:appstore` runs, in this order:

1. `npm run ios:appstore` + `fastlane release_build` — build N, real ads,
   uploaded and recorded in `build/.live-build-number`. **Not** attached, not
   submitted, and no waiting for Apple's processing.
2. `npm run ios:sync:adsoff` + `fastlane beta_adsoff` — build N+1, ads off,
   handed to the internal group — straight away, so the newest thing on
   TestFlight is never the real-ads build. This half runs **even when
   `release_build` failed**; an extra ads-off build is harmless, a missing one is
   not.
3. `fastlane attach_build` — only if both halves passed — waits for N to be
   VALID and points the editable version at it. It attaches the recorded number
   or `build:N`, never "the newest build" (that is N+1, which loads no ad), and
   refuses any number that is not the recorded live build unless `force:true`.

The command exits non-zero if any step failed. `release_build` prints a "HALF
DONE" banner whether it succeeded or not, with the exact `attach_build build:N`
to finish with. Once N is `READY_FOR_SALE`, `fastlane expire_real_ads
confirm:true` expires every build but the newest; it refuses while the newest is
the live build, and refuses to expire a recorded live build that was never
attached.

### Before the submission: publish the web pages

The consent modal's *Privacy policy* button and the store listing both open
`https://www.noqyris.com/foldwing/privacy.html`, and ad buyers read
`https://www.noqyris.com/app-ads.txt`. Both files live in
`repository/web/noqyris-website` (`public/foldwing/privacy.html`,
`public/app-ads.txt`), which deploys on push — and the push needs the owner's
word. Between the uploads above and the review submission: commit and push them,
then check what is actually served:

    curl -s https://www.noqyris.com/foldwing/privacy.html | grep -c 'Unity LevelPlay'   # must be ≥ 1
    curl -s https://www.noqyris.com/foldwing/privacy.html | grep -c AdMob               # must be 0
    curl -s https://www.noqyris.com/app-ads.txt | grep -F 'unity.com, 144007920, DIRECT' # must match

A live page that still names AdMob is an inaccurate policy behind the exact
screen where consent is given; an `app-ads.txt` with no Unity line authorises no
seller for this listing. Neither is caught by review. Both were published and
checked for 1.3 and are live.

For 1.4 the page needs one more edit before it is pushed again: its *Purchases*
paragraph says that after Remove Ads the optional reward videos "stay available". In
1.4 no screen offers an owner an ad — skips and streak repairs are free for them —
so say what Remove Ads does now: no banner, no full-screen ads, no ads offered at
all, unlimited reveals. The reminders need no policy change: they are local
notifications, scheduled on the phone, and the page already says so.

Any other TestFlight build:

    npm run ios:testflight && fastlane beta_adsoff

The npm chains do the web build, `cap sync`, the second `pod install` and every
gate. Forgetting them ships the *previous* build's UI inside a new binary, which
is the single easiest mistake to make here — and `build_ipa` now refuses the
archive when the synced tree does not match what it was asked to build.

`build_ipa` prints the build number it took. **Write that number into a ledger
row before you close the terminal** — it is the only moment anyone will ever
know it, and builds 15 to 18 are the proof.

Uploading to TestFlight is not submitting for review. See step 4.
### Signing

Automatic signing does not work with this API key — the export fails with
*"Cloud signing permission error"*, because Xcode cloud signing needs rights the
key does not carry. `build_ipa` fetches the App Store profile through `sigh`
and signs manually against it. No browser and no Xcode UI needed.

If Apple's uploader 500s after a successful archive, use `fastlane beta_upload`
— it re-sends the existing ipa instead of burning another build number, after
unzipping it, checking its UIScene manifest, and accepting only a live build
(recorded, uploaded, not distributed), an ads-off one, or a mock one (recorded as
fake-ads, uploaded, distributed). `build/Foldwing.ipa` is only the last archive:
inside `release:appstore` the ads-off half overwrites the live ipa, so a live
upload that failed there is redone with a fresh `npm run release:appstore`.

## Unity LevelPlay

AdMob is gone: Google closed the owner's publisher account on 2026-08-18, and the
AdMob ids were removed from this repo. The ids now in use, all in
`src/systems/providers/levelplay.ts`:

| | |
|---|---|
| App key (iOS) | `282ab31c5` |
| Banner | `h0a7k5pjpr3ziohk` |
| Interstitial | `w4ocqufvnz4i9mbt` |
| Rewarded | `e5mt76phyqseoqpa` |
| Android | none — there is no LevelPlay Android app |

The demand is Unity Ads, added as an instance on each unit in the LevelPlay
dashboard; its Game ID and placements live on the dashboard only.

`app-ads.txt` has to authorise Unity on the **developer website the store listing
names** (`noqyris.com`): the `unity.com, 144007920, DIRECT` line plus the
dashboard's reseller list. The file is served from the noqyris-website repo, not
this one.

The consent modal runs before the SDK starts; a player who declines gets no ad SDK
and no ads at all. **Expect little fill at first** on a new LevelPlay app. Every ad
path treats no-fill as a silent no-op and leaves the cadence counter armed, so
nothing breaks; there is simply nothing to show. Say so in the App Review notes —
and make sure those notes, and the privacy policy, no longer mention AdMob.

**Never tap an ad, and never watch one on purpose — on any build.** Every build
with ads on serves the real waterfall, and Unity counts impressions as invalid
activity, not only taps. TestFlight gets the ads-off build, or the mock build's fake
ads when the owner asks to see them.

## Ad placement, and where it deliberately isn't

1. **Leaving a win**, after the figure, never over it. Every 3rd win.
2. **A retry**, gated by every 8th failed attempt **and** the session ladder's
   floor since the last
   ad — both, never either. A failed attempt lasts three to eight seconds, so a
   count alone would put an ad on screen every 25 seconds on a level someone is
   stuck on. AdMob's policy explicitly forbade triggering an interstitial "every
   time a user clicks" and disabled ad serving over it; the rule was kept as it
   was for LevelPlay, so that configuration still does not trade retention for
   revenue — it trades an account for nothing.
3. **The banner**, always on. `METRICS.inset.bottom` reserves its strip out of
   the playfield, so it covers paper margin and never a control; no store row,
   rescue pill or win-card button is ever drawn under it.
4. **Rewarded video**, opt-in, each saying what it gives before it plays: a reveal
   from the store, a reveal at three deaths, the skip at six, the streak repair,
   two more reveals on a chapter-complete card. The ones that pay reveals share a cap
   of five a day. The skip and the repair are rescues, and are free wherever no ad
   can play and for anyone who bought Remove Ads — who is never asked to watch one.

After a card that already asked for something — a reminder, the chapter doubler —
no interstitial follows and no review prompt appears: one interruption per moment.

`monetization.test.ts` pins the arithmetic — the cadence and the economy's sums — so
nobody can make the game more aggressive, or the free supply richer than a pack, by
editing one number in isolation.
