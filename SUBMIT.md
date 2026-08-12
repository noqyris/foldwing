# Shipping Foldwing

App Store Connect app id **6794804195** · bundle `com.noqyris.foldwing` · team
`YMN45WC2QR`. The Xcode project is at **1.1, build 24** — `MARKETING_VERSION`
and `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`, which
is the only version fact this repo can prove. What App Store Connect currently
holds is a different question, and the ledger below is honest about not
answering it.

> **Do not press Submit.** Nothing in this file is an instruction to submit.
> The author decides when, and will say so. Everything here is preparation.

## Where the listing stands

Everything below was set through the App Store Connect API and verified by
reading it back at 1.0 time, not from memory — and not re-read since, so treat
it as the last known good state rather than as today's.

| | |
|---|---|
| Name / subtitle | `Foldwing: Mirror Line Puzzle` · `Draw one line, fold it in two` |
| Keywords | 94/100 characters used, no word repeated from name or subtitle |
| Description / promo text | set, and **accurate** — see the IAP note below |
| Support URL | `https://www.noqyris.com/` |
| Marketing URL | `https://www.noqyris.com/` |
| Privacy policy | `https://www.noqyris.com/foldwing/privacy.html` (live) |
| Categories | Games → Puzzle, Casual · secondary Entertainment |
| Age rating | **4+** |
| Screenshots | 4 × 6.7" (1290×2796) uploaded |
| In-app purchases | `…removeads` (non-consumable) plus `…reveals10` / `…reveals20` / `…reveals30` (consumable) |
| Ad units | **LIVE** in the tree, and now guarded — see below |

### Still to do by hand — FOUR THINGS, IN THIS ORDER

The API key cannot reach any of these; all four are web-UI only, and the first
two are hard submission blockers that App Store Connect does not surface until
you try to submit. Discovered by attempting the submission through the API and
reading the refusal.

**1. Pricing — set the app to Free.** `appPriceSchedule` returns 404: the app
has no price of any kind. A free app still needs an explicit price schedule.
*Pricing and Availability → Price Schedule → Free.*

**2. Availability — choose territories.** `appAvailabilityV2` also returns 404.
*Pricing and Availability → Availability → All countries.*
(Remove Ads already has all 175; the app itself has none. Check each pack
separately — territories are per product, and a product can look ready with
none set. See the purchases section.)

**3. App Privacy.** Answer: 

- **Identifiers → Device ID** · used for **Third-Party Advertising** ·
  **Not linked** to identity · **Used for tracking**
- **Usage Data → Product Interaction** · used for **Third-Party Advertising** ·
  **Not linked** · **Used for tracking**

Nothing else is collected. Foldwing itself has no server, no account and sends
nothing anywhere; every one of those answers describes what **Google AdMob**
does inside the app, which is why the privacy policy names AdMob explicitly.
The label and the policy have to agree or review bounces it.

**4. Submit — NOT YET, AND NOT BY ANYONE BUT THE AUTHOR.** This step is written
down for completeness. It is not a task, it is not the last box on a checklist
somebody else may tick, and no other piece of work implies it. The author will
say when. When that day comes: attach the build, confirm the release type is
still **MANUAL** so approval cannot auto-publish, and answer export compliance
(**no** non-exempt encryption — `ITSAppUsesNonExemptEncryption` is already
`false` in `Info.plist`, which is what keeps the question off the upload).

### Before you submit: neither purchase has ever been run

Nobody has completed a sandbox purchase — not Remove Ads, and not the reveal
pack, which is newer and has therefore been run even less. App Review tests
in-app purchases, so a failure there is a rejection and a lost cycle. Three
separate defects were found and fixed in that path in one afternoon — the
product had zero territories, StoreKit asked for an Apple Account at startup,
and a silent restore on launch put a repeating sign-in dialog over the home
screen. Every one of them surfaced by running it, none by reading it.

Five minutes on a TestFlight build with a Sandbox Apple ID covers what a
reviewer will do: buy Remove Ads, confirm the banner and interstitials stop and
reveals go unlimited; buy the reveal pack from the out-of-reveals sheet and
confirm the stash goes up by 20; then delete, reinstall, restore, and relaunch
twice with no repeat sign-in prompt.

## Ad units: which build is which

The tree is currently on **LIVE** units — this is the submission state, and as
of build 19 it is enforced rather than remembered.

| build | units | for |
|---|---|---|
| 10 | TEST | judging placement and frequency; ads actually render |
| 11 | LIVE | shipped in the 1.0 that is READY_FOR_SALE |
| 12 | LIVE | attached to the 1.1 review submission (100 hardened levels) |
| 13 | LIVE | the 300-bar-level set + menu fix — TestFlight |
| 14 | TEST | the MAZE set — TestFlight only, so the tester can SEE ads |
| 15–18 | **unknown** | not recorded at upload time, and unknowable now |
| 19 | **TEST when uploaded** | archived with Google's test publisher id in the plist, and the suite green. The tree is back on LIVE — see the guard below |
| 20 | LIVE | **2026-08-09, uploaded to TestFlight, not submitted.** First build past the guard: live AdMob ids, `NSPhotoLibraryAddUsageDescription`, `PrivacyInfo.xcprivacy`, the v1→v2 save migration, the Daily's ad-grace / decoy / fallback / medal fixes, settings, level-1 onboarding, a campaign ending, and 1228 tests green. Verified by unzipping the ipa, not by trusting the archive |
| 21 | **TEST** | **2026-08-09, TestFlight only, NEVER SUBMIT.** Same code as 20, archived through `fastlane beta_testads` so the tester can actually SEE the ads — live units no-fill until AdMob reviews a public app. Nothing on disk changed to make it; see below |
| 22 | **TEST** | **2026-08-10, TestFlight only, NEVER SUBMIT.** The polish pass: paper launch screen (21 and earlier opened on Capacitor's white splash with its blue logo), dark status-bar content, a Remove Ads purchase that actually applies without a relaunch, purchase/restore feedback, win-screen overlay and tap fixes, a bounded note ladder, sticky teaching lines, reduced motion everywhere. 1234 tests green |
| 23 | **TEST** | **2026-08-10, TestFlight only, NEVER SUBMIT.** First build verified by actually PLAYING it: a harness draws the validator's proved route and asserts 45 things across the loop, the Daily, settings, the campaign end and the level grid. Fixes the AdMob listener leak, the web-daily end card showing a second share underneath itself, and its "Fold again" carrying the last run's deaths into the next score |
| 24 | **TEST** | **2026-08-10, TestFlight, internal only, NEVER SUBMIT.** Same code as 23; uploaded to prove the distribution fix end to end. `internal=IN_BETA_TESTING`, verified by unzipping (test app id, `useTestAds` true in the bundle) |

**This ledger cannot tell you what is on TestFlight right now.** Nothing in the
repo can: the Xcode project carries a build number (currently 24), but fastlane
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
only reason a test-ads build was not sent to Apple is that it failed on an empty
Beta App Description. The lane no longer asks pilot to distribute; that job goes
to `Build#add_beta_groups`, which touches no review queue:

    asc-tf-groups assign --app com.noqyris.foldwing

Check `internal=IN_BETA_TESTING`, not `processing=VALID`:
`asc-tf-groups builds --app com.noqyris.foldwing`.

**From now on the ledger is updated at upload time, in the same commit as the
version bump.** A row written afterwards is a row written from memory, and the
whole point of this table is that memory is what failed.

Live units barely fill until AdMob has reviewed the app, and AdMob only reviews
once the app is public — so a tester on a live build sees blank space and
cannot judge placement at all. That is why a TEST build was ever useful.

### The guard, and why build 19 needed one

**Shipping test ads to real users is an AdMob policy violation.** Two knobs
have to be LIVE together — which, until build 19, meant two literals somebody
had to remember to change back:

    src/config/monetization.ts   useTestAds: false
    ios/App/App/Info.plist       GADApplicationIdentifier -> ca-app-pub-3307486877162157~5033197766

The old check in `monetization.test.ts` only proved the two knobs **agreed**.
Both on TEST agree perfectly, so the suite stayed green, and that is exactly
how build 19 came to carry Google's test publisher id — `3940256099942544` —
inside a signed, uploadable ipa. "Check this line before every submission" was
the instruction, and it is the kind of instruction that works right up until
the night it matters.

The real fix was to stop either knob being a checked-in value at all. Neither
is one now:

    src/config/monetization.ts   useTestAds: import.meta.env.VITE_TEST_ADS === '1'
    ios/App/App/Info.plist       GADApplicationIdentifier -> $(GAD_APPLICATION_IDENTIFIER)
    project.pbxproj              GAD_APPLICATION_IDENTIFIER = <the live app id>

A test-ads build is therefore something you ASK FOR at the archive and cannot
leave behind. There is no cleanup step to forget, which matters because
forgetting the cleanup step is the entire history of this section.

Three tests hold it, none of which branch on anything:

- `never leaves Google test ad ids anywhere in the native project` greps BOTH
  the plist and the pbxproj for `3940256099942544`.
- `defaults to live ads when nothing asks for test ads` pins the shipped
  default of `useTestAds` to false.
- `ships the live publisher account, from a build setting the plist reads`
  pins the plist to the reference and both pbxproj defaults to the exact live
  app id, so a plausible-looking wrong publisher fails too.

### Making a build the tester can see ads in

    npm run ios:sync:testads     # typecheck + full suite + VITE_TEST_ADS=1 + cap sync
    fastlane beta_testads        # archives with GAD_APPLICATION_IDENTIFIER overridden

The two halves have to agree — the JavaScript picks the ad UNITS, the native id
picks which AdMob APP the SDK reports to — and they are set by two different
commands, so `npm run ios:sync:testads` drops a marker at `build/.test-ads`
(gitignored) and the lanes read it:

- `fastlane beta` **refuses** if the marker is there. A live archive over a
  test-ads bundle is the mismatch nobody notices until a tester reports blank
  space.
- `fastlane beta_testads` **refuses** if it is not.

`npm run ios:sync` clears the marker, so the ordinary path is self-healing.
After either lane, `git diff ios/` must be empty — check it. That is also how
the agvtool clobber described under "Build and upload" gets caught.

## The purchases — there are TWO now

    com.noqyris.foldwing.removeads   non-consumable, $2.99, family-shareable
    com.noqyris.foldwing.reveals10   consumable, 10 reveals, $0.99
    com.noqyris.foldwing.reveals20   consumable, 20 reveals, $1.49
    com.noqyris.foldwing.reveals30   consumable, 30 reveals, $1.99

    …reveals25 exists and is UNUSED — created, then superseded when the
    ladder moved to 10/20/30. Never sold. Delete it or leave it; it is not
    referenced by the app.

Both ids live in `src/config/monetization.ts` under `monetization.products`,
and the store surface for both is `systems/Iap.ts`.

The packs are newer than most of this file and are easy to forget, because
Remove Ads is the one everybody remembers. Each of these has to be done for it
as well as for Remove Ads, in App Store Connect:

- the product exists and is **Ready to Submit** — a consumable that is merely
  *Ready for Review* is not the same state and does not ship
- **territories**: all 175, explicitly. A product can report Ready to Submit
  with zero territories set — App Store Connect does not treat that as missing,
  and it would be unpurchasable everywhere. This happened once already
- **pricing** set on the consumable in its own right; it does not inherit
  anything from the non-consumable
- a **review screenshot** and review notes on each product, or the submission
  is rejected on metadata before anyone plays the game
- the consumable is **attached to the version** being submitted

The refill sheet offers the rewarded video first and the pack second, never the
other way round: reveals have to stay earnable or the rewarded loop stops being
an honest deal. That ordering is in `GameScene`, not in the store.

### Remove Ads

**It is wired and in the build.** `cordova-plugin-purchase` drives StoreKit and
the whole store surface lives in `systems/Iap.ts`; the scenes are unchanged.
The product is `READY_TO_SUBMIT` in all 175 territories.

Two things that were wrong and are worth remembering. The product reported
`READY_TO_SUBMIT` with **zero territories set**, which would have made it
unpurchasable everywhere — App Store Connect does not treat that as missing.
And `needAppReceipt` defaults to true, which verifies the app receipt at
startup; on a fresh install there is no receipt, so StoreKit asks the user to
sign in to their Apple Account before the player has touched anything. It is
set to false.

**Still unverified:** a real sandbox purchase. It cannot be done from this
machine — it needs a Sandbox Apple ID on a device. Until someone completes one,
buy / restore / no-repeat-prompt are untested code paths.

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
`CA92.1` for UserDefaults, `C617.1` for file timestamps. The manifest also
declares `NSPrivacyTracking: true`, because the app is what asks for ATT.
`NSPrivacyCollectedDataTypes` is deliberately **empty**: everything the App
Privacy label declares is collected by AdMob, whose SDK ships its own manifest,
and declaring it twice would claim the app touches data it never sees. The test
also greps the Xcode project for `PrivacyInfo.xcprivacy in Resources`, because a
manifest that is not in the Copy Bundle Resources phase is not in the bundle and
Apple will not see it.

## Build and upload

    npm test                    # gate — never ship past a red suite
    npm run ios:sync            # web build + cap sync. MUST run before fastlane.
    set -a; source .env.appstore; set +a
    fastlane beta               # archive + upload to TestFlight

Forgetting `ios:sync` ships the *previous* build's UI inside a new binary,
which is the single easiest mistake to make here.

`fastlane beta` prints the build number it took from App Store Connect. **Write
that number into the ledger above before you close the terminal** — it is the
only moment anyone will ever know it, and builds 15 to 18 are the proof.

Uploading to TestFlight is not submitting for review. See step 4.

### Signing

Automatic signing does not work with this API key — the export fails with
*"Cloud signing permission error"*, because Xcode cloud signing needs rights the
key does not carry. `build_ipa` fetches the App Store profile through `sigh`
and signs manually against it. No browser and no Xcode UI needed.

If Apple's uploader 500s after a successful archive, use `fastlane beta_upload`
— it re-sends the existing ipa instead of burning another build number.

## AdMob

Publisher `ca-app-pub-3307486877162157`. All four ids are in `LIVE_IOS` and
verified format-by-format against the console.

| | |
|---|---|
| App ID | `ca-app-pub-3307486877162157~5033197766` |
| Banner | `ca-app-pub-3307486877162157/6426316277` |
| Interstitial | `ca-app-pub-3307486877162157/4373767928` |
| Rewarded | `ca-app-pub-3307486877162157/5113234608` |

`app-ads.txt` was already live at `noqyris.com` with the right publisher line —
one line covers every app on the account. What was missing is that AdMob looks
for it at the **developer website on the store listing**, and Foldwing's
marketing URL was empty. It now points at `noqyris.com`, so the file counts.

**Expect no ads at first.** A new AdMob app shows *"Requires review / Limited
ad serving"* until Google reviews it, and Google reviews it once the app is
**public on the store** — TestFlight does not count. Until then live units
return no-fill. Every ad path treats no-fill as a silent no-op and leaves the
cadence counter armed, so nothing breaks; there is simply nothing to show.

Once 1.0 is live: add the store link in AdMob to lift the limit.

**Never tap your own live ads.** Invalid traffic is the most common way to get
an AdMob account banned. The build now carries live units, so this applies to
TestFlight too.

## Ad placement, and where it deliberately isn't

1. **Leaving a win**, after the figure, never over it. Every 3rd win.
2. **A retry**, gated by every 8th failed attempt **and** the session ladder's
   floor since the last
   ad — both, never either. A failed attempt lasts three to eight seconds, so a
   count alone would put an ad on screen every 25 seconds on a level someone is
   stuck on. AdMob policy explicitly forbids triggering an interstitial "every
   time a user clicks" and disables ad serving over it, so that configuration
   does not trade retention for revenue — it trades an account for nothing.
3. **The banner**, always on. `METRICS.inset.bottom` reserves its strip out of
   the playfield, so it covers paper margin and never a control.
4. **A rewarded video**, opt-in, for a reveal.

`monetization.test.ts` pins the arithmetic so nobody can make the game more
aggressive by editing one number in isolation.
