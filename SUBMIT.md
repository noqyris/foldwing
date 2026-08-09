# Shipping Foldwing

App Store Connect app id **6794804195** · bundle `com.noqyris.foldwing` · team
`YMN45WC2QR` · version record **1.0** (`PREPARE_FOR_SUBMISSION`).

## Where the 1.0 submission stands

Everything below was set through the App Store Connect API and verified by
reading it back, not from memory.

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
| Ad units | **LIVE** in build 11 — see the table below |

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
(The IAP already has all 175; the app itself has none.)

**3. App Privacy.** Answer: 

- **Identifiers → Device ID** · used for **Third-Party Advertising** ·
  **Not linked** to identity · **Used for tracking**
- **Usage Data → Product Interaction** · used for **Third-Party Advertising** ·
  **Not linked** · **Used for tracking**

Nothing else is collected. Foldwing itself has no server, no account and sends
nothing anywhere; every one of those answers describes what **Google AdMob**
does inside the app, which is why the privacy policy names AdMob explicitly.
The label and the policy have to agree or review bounces it.

**4. Submit.** The build is already attached (build 11) and the release type is
already **MANUAL**, so approval will not auto-publish — you pick the moment.
Answer export compliance (**no** non-exempt encryption) when prompted.

### Before you submit: the purchase has never been run

Nobody has completed a sandbox purchase. App Review tests in-app purchases, so
a failure there is a rejection and a lost cycle. Three separate defects were
found and fixed in that path in one afternoon — the product had zero
territories, StoreKit asked for an Apple Account at startup, and a silent
restore on launch put a repeating sign-in dialog over the home screen. Every
one of them surfaced by running it, none by reading it.

Five minutes on build 10 with a Sandbox Apple ID covers what a reviewer will
do: buy, confirm ads stop, delete, reinstall, restore, relaunch twice.

## Ad units: which build is which

The tree is currently on **LIVE** units — this is the submission state.

| build | units | for |
|---|---|---|
| 10 | TEST | judging placement and frequency; ads actually render |
| 11 | LIVE | shipped in the 1.0 that is READY_FOR_SALE |
| 12 | LIVE | attached to the 1.1 review submission (100 hardened levels) |
| 13 | LIVE | the 300-bar-level set + menu fix — TestFlight |
| 14 | TEST | the MAZE set — TestFlight only, so the tester can SEE ads. **Flip both knobs back to LIVE before any App Store submission.** |

Live units barely fill until AdMob has reviewed the app, and AdMob only reviews
once the app is public — so a tester on a live build sees blank space and
cannot judge placement at all. That is why both builds exist.

**Shipping test ads to real users is an AdMob policy violation.** The two knobs
that must always agree, and must both be LIVE for any submission:

    src/config/monetization.ts   useTestAds: false
    ios/App/App/Info.plist       GADApplicationIdentifier -> ca-app-pub-3307486877162157~5033197766

`monetization.test.ts` reads the plist and fails if the two disagree, so they
cannot drift apart — but nothing stops both being left on TEST. Check this line
before every submission.

## The Remove Ads purchase

**It is now wired and in the build.** `cordova-plugin-purchase` drives StoreKit
and the whole store surface lives in `systems/Iap.ts`; the scenes are unchanged.
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

## Build and upload

    npm test                    # gate — never ship past a red suite
    npm run ios:sync            # web build + cap sync. MUST run before fastlane.
    set -a; source .env.appstore; set +a
    fastlane beta               # archive + upload to TestFlight

Forgetting `ios:sync` ships the *previous* build's UI inside a new binary,
which is the single easiest mistake to make here.

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
2. **A retry**, gated by every 5th failed attempt **and** 120s since the last
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
