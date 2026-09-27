fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios verify

```sh
[bundle exec] fastlane ios verify
```

Verify API-key auth and whether the app record exists

### ios setup_app

```sh
[bundle exec] fastlane ios setup_app
```

Create the App Store Connect app record if missing

### ios build_ipa

```sh
[bundle exec] fastlane ios build_ipa
```

Archive a signed App Store build. ad_target:live, off or mock — nothing else

### ios beta

```sh
[bundle exec] fastlane ios beta
```

REMOVED — it distributed real ads to testers. Use beta_adsoff or release_build.

### ios beta_testads

```sh
[bundle exec] fastlane ios beta_testads
```

REMOVED — on LevelPlay a test-ads build serves REAL ads. Use beta_adsoff.

### ios beta_adsoff

```sh
[bundle exec] fastlane ios beta_adsoff
```

TestFlight build with ADS OFF — the ad layer never starts. The only kind of TestFlight build.

### ios beta_mock

```sh
[bundle exec] fastlane ios beta_mock
```

TestFlight build with FAKE ads (ADS:mock) — drawn in the page, no network. Never for the store.

### ios release_build

```sh
[bundle exec] fastlane ios release_build
```

Live-ads build N: uploaded and recorded, NOT attached or submitted. release:appstore attaches it after N+1

### ios attach_build

```sh
[bundle exec] fastlane ios attach_build
```

Attach the LIVE build to the editable App Store version: build:N or build/.live-build-number. Never guesses

### ios expire_build

```sh
[bundle exec] fastlane ios expire_build
```

Expire ONE TestFlight build so nobody can install it. Does NOT affect the App Store.

### ios expire_real_ads

```sh
[bundle exec] fastlane ios expire_real_ads
```

Step 3: expire every unexpired TestFlight build except the newest. Lists only, unless confirm:true

### ios beta_upload

```sh
[bundle exec] fastlane ios beta_upload
```

Re-upload build/Foldwing.ipa without rebuilding — a live store ipa, an ads-off ipa or a fake-ads ipa

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
