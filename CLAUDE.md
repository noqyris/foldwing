# foldwing

House rules for this repo. Deep docs, if any, live alongside this file.

## ⚠️ Ad safety — the two-build release

**A real-ads upload is half a release. Shipping it alone is the bug.**

Apple makes an App Store build the **newest build on TestFlight** as soon as it
processes, and TestFlight offers the newest build first. There is no way off:
the internal tester group's `hasAccessToAllBuilds` is `true` and App Store Connect
refuses to change it. So a real-ads binary lands on the owner's own phone by
default — and one tap on it is what closed `pub-3307486877162157` on 2026-08-18,
killing ads in every app at once.

Every App Store release is **two uploads**. In this repo that is one command:

```sh
npm run release:appstore      # both halves — this is the one to use
```

which runs, in order:

1. `npm run ios:appstore` — gate must report **live** — then `fastlane
   release_build` uploads build **N** and attaches it to the editable version.
   It announces that the build carries real ads before uploading, and it does
   **not** submit for review.
2. `npm run ios:testflight` — gate must report **test** — then `fastlane
   beta_testads` uploads build **N+1** and hands it to the internal group. Only
   now is what TestFlight offers safe to open.
3. Once N is `READY_FOR_SALE`: `fastlane expire_build build:N`. Expiring does
   **not** touch the App Store — verified on `com.noqyris.kvizko` build 51,
   simultaneously `READY_FOR_SALE` for 1.2 and `expired: true` on TestFlight.

`fastlane beta` no longer exists — it distributed real ads to testers, which is
what closed the account. It is kept as a refusal that names the replacement.

The gate is `scripts/check-ad-mode.mjs`. It runs inside every sync script **and**
inside `build_ipa`, where it reads the synced bundle rather than the
`build/.test-ads` marker — a marker records which script ran last, and a raw
`vite build` (live by default) makes that a lie.

Step 2 is not homework for later: the gap between the two uploads is exactly when
the owner opens TestFlight to look at the new version. Never leave a real-ads build
as the newest one. Google Play has the same shape — follow a production rollout
with a test-ads build on the internal track.

No **TEST ADS** badge on screen means the build serves **real** ads. Do not play it.

Full procedure: the user-level `ad-safety` skill.
