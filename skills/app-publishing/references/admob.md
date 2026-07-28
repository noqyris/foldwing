# AdMob setup (Capacitor)

Plugin: `@capacitor-community/admob`.

## 1. Console: create ONE AdMob app per platform

iOS and Android are **separate AdMob apps** with separate IDs. You get:
- **App ID** — `ca-app-pub-XXXXXXXX~NNNNNNNN` (tilde `~`) → goes in the **native** config.
- **Ad unit IDs** — `ca-app-pub-XXXXXXXX/NNNNNNNN` (slash `/`) → go in **code**. Create one per format: banner, interstitial, rewarded.

Mixing up `~` (app) and `/` (unit), or using the iOS units on Android, is the classic silent-no-fill bug.

## 2. Wire the native app IDs

**iOS** — `ios/App/App/Info.plist`:
```xml
<key>GADApplicationIdentifier</key>
<string>ca-app-pub-XXXXXXXX~NNNNNNNN</string>
<key>NSUserTrackingUsageDescription</key>
<string>Used to show you more relevant ads.</string>
```
Also keep the `SKAdNetworkItems` array the SDK ships with (attribution).

**Android** — `android/app/src/main/AndroidManifest.xml`, inside `<application>`:
```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-XXXXXXXX~NNNNNNNN" />
```
A wrong/missing value here **crashes the app on launch** on Android.

## 3. Code: a test/live switch

Keep Google's official test units alongside your live ones and flip one flag. Test ads are safe to click; live ads are not.

```ts
const TESTING = false                    // true = Google test ads
const TEST_UNITS_IOS     = { banner: 'ca-app-pub-3940256099942544/2934735716', … }
const TEST_UNITS_ANDROID = { banner: 'ca-app-pub-3940256099942544/6300978111', … }
const LIVE_UNITS_IOS     = { /* yours */ }
const LIVE_UNITS_ANDROID = { /* yours */ }

const IS_ANDROID = Capacitor.getPlatform() === 'android'
const UNITS = TESTING ? (IS_ANDROID ? TEST_UNITS_ANDROID : TEST_UNITS_IOS)
                      : (IS_ANDROID ? LIVE_UNITS_ANDROID : LIVE_UNITS_IOS)
```
Pass `isTesting: TESTING` on every `showBanner` / `prepareInterstitial` / `prepareRewardVideoAd` call too.

## 4. Init, consent, ATT

```ts
await AdMob.initialize({ initializeForTesting: TESTING })
const info = await AdMob.requestConsentInfo()          // GDPR/UMP
if (info.isConsentFormAvailable) await AdMob.showConsentForm()
await AdMob.requestTrackingAuthorization()             // iOS 14.5+ ATT
```
Wrap each in try/catch — every one of these can fail offline and must not break the game.

## 5. Layout: reserve the banner strip

Listen for `BannerAdPluginEvents.SizeChanged` and reserve exactly that height so nothing draggable sits under the ad. Reserve a sane default *before* the banner loads to avoid a reflow jump.

## 6. Expect no-fill at first

A **new AdMob app is not approved until Google reviews it**, which normally happens once the app is live on the store. Until then live units return no-fill and **no ads show** — this is normal, not a bug. Code must treat no-fill as a silent no-op (banner stays hidden, interstitial skipped, cadence counter left armed so the next break retries).

## 7. Rules that protect the account

- Never click/tap your own live ads, and never ask others to.
- No ads at app launch, no two full-screen ads back to back, never on top of content.
- Don't place ads where a mis-tap is likely (next to buttons).
- Rewarded ads must be **opt-in** with the reward stated up front.

## Debug checklist when ads don't show

1. `TESTING` value and which unit set is actually selected at runtime.
2. Native app ID present and matching the platform.
3. AdMob app approved / ad serving enabled?
4. Device online; consent + ATT resolved?
5. Any exception swallowed by a try/catch — log it while debugging.
