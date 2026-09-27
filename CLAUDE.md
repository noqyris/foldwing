# foldwing

House rules for this repo. Deep docs, if any, live alongside this file.

## ⚠️ Ad safety — LevelPlay has no test ads

**Every `ADS:on` build serves real ads.** Ads come from Unity LevelPlay, which
has no test inventory: its test flag (`ADMODE:test`, the default whenever
`VITE_AD_MODE` is not `live`) only unlocks the Test Suite, the same unit ids
ship in both modes, and the waterfall behind them is live. There is no
**TEST ADS** badge, and nothing may ever draw one. Never tap an ad — on any
build, on any phone — and never deliberately look at one either: Unity counts
impressions as invalid activity, not just taps. The dashboard test-device pin
narrows the source for about an hour; it makes nothing safe.

Every bundle bakes two markers, each exactly once, and the gates count them:

| Build | Markers | Made by | Goes to |
|---|---|---|---|
| live | `ADMODE:live` + `ADS:on` | `npm run ios:appstore` | the App Store, nowhere else |
| ads-off | `ADMODE:test` + `ADS:off` | `npm run ios:sync:adsoff` (= `ios:testflight`) | **TestFlight — the default, and N+1 of every release** |
| mock | `ADMODE:test` + `ADS:mock` | `npm run dev:mock`, `npm run ios:sync:mock` / `ios:run`; `fastlane beta_mock` | this machine, or TestFlight when the owner asks to see ads on the phone; fake ads in the page, **never the store** |

`ADS:off` means the ad layer never initialises: no consent prompt, no SDK, no
banner, nothing to see. Ad flows (placement, cadence, rewards) are tested on
the **mock** build, which draws fake ads and calls no network, so every
surface is safe to tap. `npm run ios:sync:mock && fastlane beta_mock` puts it on
TestFlight (the owner asked for that on 2026-09-22); the live target refuses its
markers, and `attach_build` refuses every build number `beta_mock` recorded in
`build/.fake-ads-builds`, even with `force:true`. It is never the build that
follows a live upload — that is always `beta_adsoff`. `npm run ios:sync` is test mode with `ADS:on` — the real
waterfall — for running the Test Suite from Xcode, never for an archive.

Consent comes BEFORE the SDK: ATT, then the plugin's consent modal, then
`getConsentData()`; only `GRANTED` initialises LevelPlay — declined or unknown
means no SDK and no ads. A rewarded ad pays out on the reward event only, never
on close.

## ⚠️ The two-build release

**A real-ads upload is half a release. Shipping it alone is the bug.**

Apple makes an App Store build the **newest build on TestFlight** as soon as it
processes, and TestFlight offers the newest build first. Foldwing's internal
group reports `hasAccessToAllBuilds=false` today, but that flag is `true` on
other apps in this portfolio and no release step asserts it — so assume the
dangerous value: a real-ads binary lands on the owner's own phone by default.
One tap on one is what closed the owner's AdMob publisher account on
2026-08-18, killing ads in every app at once.

Every App Store release is **two uploads**. In this repo that is one command:

```sh
npm run release:appstore      # both halves — this is the one to use
```

which runs, in order:

1. `npm run ios:appstore` — gates must report **live** — then `fastlane
   release_build` uploads build **N** and records its number in
   `build/.live-build-number`. It announces that the build carries real ads
   before uploading. It does **not** wait for processing, attach or submit.
2. **Immediately, whatever step 1's exit status:** `npm run ios:sync:adsoff` —
   gates must report **off** — then `fastlane beta_adsoff` uploads build
   **N+1** and hands it to the internal group. Only now is what TestFlight
   offers safe to open. If N+1 is still processing after 15 minutes the lane
   warns and passes (the upload is the protection; `asc-tf-groups assign`
   finishes the hand-out).
3. Only if both halves passed: `fastlane attach_build` waits for N to be VALID
   and attaches it to the editable version. It attaches `build:N` or the
   recorded number and nothing else — never "the newest build", which after
   step 2 is the ads-off one — and refuses a number that is not the recorded
   live build unless `force:true`.

The chain exits non-zero if any step failed. After it, and before anything is
submitted:

4. **Publish the web pages the review and the consent modal link to** —
   `privacy.html` and `app-ads.txt` in `repository/web/noqyris-website`, which
   deploys on push (the push needs the owner's word) — then check the live site:
   ```sh
   curl -s https://www.noqyris.com/foldwing/privacy.html | grep -c 'Unity LevelPlay'  # ≥ 1
   curl -s https://www.noqyris.com/foldwing/privacy.html | grep -c AdMob              # 0
   curl -s https://www.noqyris.com/app-ads.txt | grep -F 'unity.com, 144007920, DIRECT'  # a match
   ```
5. Submit for review — a separate step, on the owner's word only.
6. Once N is `READY_FOR_SALE`: `fastlane expire_real_ads` lists every unexpired
   build but the newest, and `fastlane expire_real_ads confirm:true` expires
   them. It refuses — even when it is the only unexpired build — if the newest
   is live (attached to a version, or the recorded live build: step 2 never
   landed), if a build still belongs to a version that is not released yet, or
   if the recorded live build was never attached. Expiring does **not** touch
   the App Store — verified on `com.noqyris.kvizko` build 51, simultaneously
   `READY_FOR_SALE` for 1.2 and `expired: true` on TestFlight.

Step 2 is not homework for later: the gap between the two uploads is exactly when
the owner opens TestFlight to look at the new version. Never leave a real-ads build
as the newest one. Once `release_build` has started, `release:appstore` runs the
ads-off half even when it fails, and the lane's "HALF DONE" banner prints either
way. If `ios:appstore` itself fails after its sync, or `release_build` was run on
its own, `ios/App/App/public` still holds a LIVE bundle — run `npm run
ios:sync:adsoff` before doing anything else. Keep `build/.live-build-number`
until N is expired: it is the only record of which build is live. Any other
TestFlight build is `npm run ios:testflight && fastlane beta_adsoff`, or, when
the owner wants to see ads on the phone, `npm run ios:sync:mock && fastlane
beta_mock`.

`fastlane beta` and `fastlane beta_testads` no longer exist — one distributed
real ads to testers, the other would now do the same under a safer-sounding
name. Both are kept as refusals that name `beta_adsoff`. `build_ipa` accepts
`ad_target:live`, `ad_target:off` or `ad_target:mock` and nothing else, and the
Xcode guard archives ADS:mock only when `AD_TARGET=mock` names it.

## The gates

- `scripts/check-ad-mode.mjs <live|off|mock|test> [dir]` — exact marker counts
  per target; refuses Test Suite and ad-id capture bundles outright.
- `scripts/check-no-google.mjs` — no AdMob plugin, pod, plist key, build
  setting, SKAdNetwork id (`cstr6suwn9`), AdMob app/unit id or the terminated
  publisher id anywhere in the repo, **docs included**. The gate knows that id
  only as a hash; do not write it back into this repo.
- `scripts/check-native-sync.mjs ios <target>` — after the sync: `App/public`
  is exactly `dist/`, and `Podfile.lock` resolves `CapacitorLevelplayAds`,
  `IronSourceSDK` and every adapter in the Podfile's `LEVELPLAY-ADAPTERS` block,
  was installed from the current Podfile, equals `Pods/Manifest.lock`, and holds
  no Google pod.

Every npm sync chain runs all three. `fastlane build_ipa` runs them again on the
synced tree, passes `AD_TARGET` to the Xcode "Ad-mode guard" phase, and after
archiving runs `check-ad-mode <target>` again on the bundle packed inside
`App.app` and reads the binary for `LPMInitRequestBuilder` and
`ISUnityAdsAdapter` (and against the plugin's no-op branch). `beta_upload`
re-reads the ipa and accepts only a live build (recorded, uploaded, not
distributed) or an ads-off one. The ads-off and mock chains pin
`VITE_AD_MODE=test` themselves, so a `VITE_AD_MODE=live` left exported in the
shell cannot turn them into a live bundle.

## Native: Node 22, CocoaPods

- **Node 22** (`.nvmrc`). The Capacitor 8 CLI refuses Node 21, which is this
  machine's default: `nvm use` before any `npm run` that syncs.
- **Stay on CocoaPods.** Never `npx cap migrate` (it floats every dependency);
  never `npx cap add ios` without `--packagemanager CocoaPods`.
- **UIScene is adopted, by hand, on Capacitor 8.5.** An app built with Xcode 27
  (the iOS 27 SDK) must use the scene life cycle, or iOS 27 refuses to launch
  it: black screen, back to the home screen, "UIScene life cycle is required"
  in the log. TestFlight 1.4 (52) shipped without it. What makes up the
  migration: `ios/App/App/SceneDelegate.swift`, `UIApplicationSceneManifest` in
  `Info.plist` (`UISceneStoryboardFile` = `Main`), and `configurationForConnecting`
  in `AppDelegate.swift`, which no longer has a window or URL handlers.
  `Main.storyboard` creates `FoldwingBridgeViewController` exactly once, and
  `SceneDelegate` builds no controller. The 8.5 template's SceneDelegate does
  build one, a plain `CAPBridgeViewController` without the Game Center plugin,
  so never copy it in. Before archiving with a new Xcode, launch the mock build
  on a simulator running the newest iOS (`SIM=<udid> npm run ios:run`).
- `cap sync ios` runs its own `pod install` **before** the `capacitor:sync:after`
  hook writes the LevelPlay adapter pods into the Podfile, so that install never
  sees them and the build still passes — with no ad network linked. That is why
  every chain runs `npm run ios:pods` after the sync and `check-native-sync`
  after that. A hand-run `npx cap sync ios` needs `npm run ios:pods` too.
- The ad SDK versions are pinned deliberately: `IronSourceSDK` and `UnityAds` in
  the Podfile, **outside** the hook's `LEVELPLAY-ADAPTERS` block (the hook
  rewrites that block, unversioned, on every sync), and everything else by
  `Podfile.lock`. Commit the lock; a changed lock is a changed ad stack.

Background: the user-level `mobile-game-playbook` skill. Where it disagrees with
this file, this file wins.
