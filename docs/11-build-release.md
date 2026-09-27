> **Out of date. Written 7 August 2026, before the maze rewrite; banner added
> 9 August 2026.**
>
> This page describes the retired **100-level set of bar obstacles** and the
> generator that produced it. Neither still exists. The game now ships 300
> spanning-tree mazes built by `src/core/MazeGen.ts`, which is also what the
> Daily Fold runs on the phone — so every level count below is wrong, and any
> passage about wall placement, interlock reservation or inert-wall stripping
> describes code that was deleted with the bar set. The tutorial went too: the
> five hand-authored bar levels, LOCKED wherever they appear below, were
> replaced in September 2026 by five small mazes from
> `scripts/genTutorialMazes.ts`, and save schema 3 forgets clears of the old ones.
>
> The "Source files" line-count tables are wrong too, and that matters more
> than it looks: the `file:line` citations throughout were counted against
> those tables, so treat every one of them as a hint about where to look
> rather than as a location. Read the source.
>
> Kept because the reasoning is still worth having. For what the game actually
> does now, see [../README.md](../README.md).
>
> **The release pipeline changed in September 2026.** AdMob is gone (Google closed
> the owner's publisher account on 2026-08-18); ads come from Unity LevelPlay, the
> project is on Capacitor 8 and Node 22 and still on CocoaPods, and every release is
> two uploads — a live App Store build followed at once by an ads-off TestFlight
> build. §1, §4–§8 and §11 have been rewritten for that; the house rules are in
> [../CLAUDE.md](../CLAUDE.md), and where this page and CLAUDE.md disagree,
> CLAUDE.md wins.
>
> **1.4 (September 2026)** added gates rather than steps: the UIScene manifest is now
> proven after every sync and again in the archive and before any re-upload (§4),
> the fake store of the mock build is refused in every other bundle (§6), and the
> binary carries a new icon plus one alternate for Product Page Optimization (§5). The
> identity, `Info.plist` and submission sections (§5, §6, §8) are brought up to 1.4.

---

# Build, iOS Shell & Release Pipeline

## What this covers

Everything between a source edit and a binary on the App Store: the npm scripts,
the Vite/TypeScript settings that change behaviour, the `patch-package`
postinstall, the Capacitor shell and `cap sync`, the Xcode project's identity and
`Info.plist` keys, the fastlane lanes and their App Store Connect API-key auth,
the current submission state, and the local `skills/app-publishing/`
reference set. Ends with an ordered release checklist.

## Source files

| Path | Lines | Role |
|---|---|---|
| `package.json` | — | Every npm script, the exact dependency set that ends up in the Podfile, and the `levelplay` block the sync hook reads |
| `.nvmrc` | 1 | `22` — the Capacitor 8 CLI refuses older Node |
| `scripts/check-ad-mode.mjs` | — | Release gate: the bundle's `ADMODE`/`ADS` markers match the target, exactly once; the fake store (`FAKE PURCHASE`) only in mock |
| `scripts/check-no-google.mjs` | — | Release gate: no AdMob/Google ad surface anywhere in the build inputs |
| `scripts/check-native-sync.mjs` | — | Release gate, after the sync: native bundle = `dist/` (and no fake store outside mock), LevelPlay pods installed from the current Podfile, the UIScene manifest in `Info.plist` and no `UIRequiresFullScreen` |
| `scripts/patch-levelplay-consent.mjs` | — | postinstall: fixes the plugin's custom-consent path reading a decline as consent |
| `ios/App/ad-mode-guard.sh` | — | Xcode "Ad-mode guard" build phase: refuses to archive a live bundle unless `AD_TARGET=live` |
| `vite.config.ts` | — | Bundler + Vitest config in one file; defines `VITE_APP_VERSION` from the Xcode project |
| `tsconfig.json` | 23 | Strictness flags; `include` decides what `npm run build` typechecks |
| `capacitor.config.ts` | — | Source of truth for `appId`, `webDir`, iOS shell background, and no banner for a reminder while the app is open |
| `index.html` | — | Vite entry; viewport/scroll lock that keeps Phaser's pointer transform honest; `#app` inset by the safe area, desk margins |
| `patches/cordova-plugin-purchase+13.18.0.patch` | 27 | Removes StoreKit init from Cordova plugin load |
| `ios/App/Podfile` | — | Local `:path =>` pods from `cap sync`, the ad SDK version pins, and the hook's `LEVELPLAY-ADAPTERS` block |
| `ios/App/Podfile.lock` | — | Resolved native SDK versions (LevelPlay, the Unity Ads adapter, …) — the pin |
| `ios/App/App.xcodeproj/project.pbxproj` | — | Bundle id, team, versions, device family, the app icon and its alternate |
| `ios/App/App/Assets.xcassets/` | — | `AppIcon` (default, with a dark appearance) and `AppIcon-Fold` (the alternate), the splash |
| `ios/App/App/Info.plist` | — | ATT string, LevelPlay/Unity SKAdNetwork list, `LevelPlayCMPProvider`, `UIApplicationSceneManifest`, orientation, export compliance |
| `ios/App/App/AppDelegate.swift` | 44 | Capacitor 8.5 delegate: `configurationForConnecting` only, no window, no URL handlers |
| `ios/App/App/SceneDelegate.swift` | 45 | The UIScene delegate; the window comes from `Main.storyboard`, the rest goes to `SceneDelegateProxy` |
| `ios/App/App/config.xml` | 10 | Generated by `cap sync`; registers the Cordova `InAppPurchase` feature |
| `ios/App/App/capacitor.config.json` | 18 | Generated by `cap sync`; carries `packageClassList` |
| `fastlane/Appfile` | 6 | App identity, all from env vars |
| `fastlane/Fastfile` | — | `verify`, `setup_app`, `build_ipa`, `release_build`, `beta_adsoff`, `beta_mock`, `attach_build`, `expire_build`, `expire_real_ads`, `beta_upload`, and the `beta` / `beta_testads` refusals |
| `fastlane/README.md` | 64 | Auto-generated lane list; regenerated on every fastlane run |
| `.env.appstore.example` | 8 | Names of the six env vars fastlane needs |
| `.gitignore` / `ios/.gitignore` | 28 / 13 | What must never be committed (keys, profiles, generated native config) |
| `SUBMIT.md` | — | Live submission state and the manual steps the API cannot reach |
| `skills/app-publishing/SKILL.md` + `references/*.md` | 58 + 311 | Portable playbook this pipeline was built from |
| `src/config/monetization.test.ts` | — | Reads `Info.plist` and the pbxproj from disk and fails the suite on any Google ad identifier |

---

## 1. npm scripts

From `package.json`. Every script that syncs needs **Node 22** (`nvm use`).

| Script | Command | When to use |
|---|---|---|
| `dev` | `vite` | Local dev server. In a browser the ad layer is off (`adsSupported()` is false on the web). |
| `dev:mock` | `VITE_ADS=mock vite` | Local dev server with **fake ads drawn in the page** — the way to see placements, cadence and rewards without a network. |
| `build` | `npm run typecheck && npm test && vite build` | Web bundle into `dist/`, after the typecheck and the suite. |
| `build:test` / `build:adsoff` / `build:mock` / `build:live` | `build` with the matching env, then `check-ad-mode.mjs <target>` | A gated web bundle of one mode. `build:adsoff` and `build:mock` pin `VITE_AD_MODE=test` themselves. `build:live` has no no-Google gate — never a store build on its own. |
| `test` / `test:fast` / `test:watch` | `vitest run` / without `src/data/**` / `vitest` | The suite. Run from the repo root — see §1.1. |
| `typecheck` | `tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json` | Both projects. |
| `postinstall` | `patch-package && node scripts/patch-levelplay-consent.mjs` | Runs after `npm install`. See §3. |
| `capacitor:sync:after` | `node node_modules/capacitor-levelplay-ads/scripts/levelplay-manifest.js` | Capacitor's hook, run by `cap sync` **after** its own `pod install`. See §4. |
| `ads:check` / `ads:nogoogle` | the two gates, by hand | |
| `ios:pods` | `pod install --project-directory=ios/App` | The second pod install every chain needs. See §4. |
| `ios:appstore` | `VITE_AD_MODE=live` build → `check-ad-mode live` → `check-no-google` → `cap sync ios` → `ios:pods` → `check-native-sync ios live` | **The App Store build (N).** Real ads. |
| `ios:sync:adsoff` / `ios:testflight` | `VITE_AD_MODE=test VITE_ADS=off` build → `check-ad-mode off` → `check-no-google` → `cap sync ios` → `ios:pods` → `check-native-sync ios off` | **The default TestFlight build**, and N+1 of every release. |
| `ios:sync:mock` | the same chain with `VITE_AD_MODE=test VITE_ADS=mock` and target `mock` | Fake ads in the simulator or an Xcode Run, or on TestFlight with `fastlane beta_mock`. Never the store. |
| `ios:sync` | the same chain, target `test` | Test mode with `ADS:on` — the **real** waterfall plus the Test Suite. Xcode Run only. |
| `ios:open` | `npx cap open ios` | Opens `ios/App/App.xcworkspace` in Xcode. |
| `ios:run` | see §1.2 | Mock build round-trip in the simulator. Requires `SIM`. |
| `release:appstore` | `npm run ios:appstore && { fastlane release_build; live=$?; npm run ios:sync:adsoff && fastlane beta_adsoff && [ $live -eq 0 ] && fastlane attach_build; }` | **The release.** Both halves, then the attach. See §1.3, §7 and §11. |

Release chains export `VITE_*` into the `npm test` step of `build`, so a test that
describes a normal build must stub those variables itself (`vi.stubEnv`) or it fails
inside the ads-off and live chains only.

The ads-off and mock chains set `VITE_AD_MODE=test` explicitly rather than relying on
the default. Vite lets an exported variable win over `.env` files, so a
`VITE_AD_MODE=live` left in the shell (or in a `.env.local`) used to turn
`ios:sync:adsoff` into `ADMODE:live + ADS:off` — which `check-ad-mode off` refuses,
stopping the release with the live build already uploaded.

### 1.1 `npm test` is cwd-sensitive

`src/config/monetization.test.ts` reads `ios/App/App/Info.plist` and the pbxproj
off disk with paths resolved from the repo root. Running the suite from anywhere
else fails the native-project tests with ENOENT rather than a real assertion.
There is no `root` override in `vite.config.ts`.
### 1.2 `ios:run`, decomposed

`package.json` holds it as one line. Split at the operators:

```text
1  npm run ios:sync:mock
       → VITE_ADS=mock npm run build   (typecheck, tests, vite build → dist/)
       → check-ad-mode mock, check-no-google
       → npx cap sync ios        (copies dist/ into ios/App/App/public/,
                                  regenerates capacitor.config.json + config.xml,
                                  re-copies Cordova plugin sources, runs pod install,
                                  then the LevelPlay hook edits the Podfile)
       → npm run ios:pods        (the install that picks up the hook's adapters)
       → check-native-sync ios mock
&&
2  rm -rf .build/ios/Build/Products
&&
3  xcodebuild -workspace ios/App/App.xcworkspace \
              -scheme App \
              -configuration Debug \
              -sdk iphonesimulator \
              -destination "id=$SIM" \
              -derivedDataPath .build/ios \
              CODE_SIGNING_ALLOWED=NO \
              build  >/dev/null
&&
4  xcrun simctl install "$SIM" .build/ios/Build/Products/Debug-iphonesimulator/App.app
&&
5  { xcrun simctl terminate "$SIM" com.noqyris.foldwing 2>/dev/null || true; }
&&
6  xcrun simctl launch "$SIM" com.noqyris.foldwing
```

Non-obvious details, in order:

- **`SIM` is a required env var**, an unquoted simulator UDID. `README.md:17`
  documents the invocation as `SIM=<udid> npm run ios:run`. There is no default
  and no error message if it is unset — `xcodebuild` fails on an empty
  `-destination "id="`.
- **`-workspace`, never `-project`.** CocoaPods integration means the `.xcodeproj`
  alone does not link the pods. `ios/App/App.xcworkspace/contents.xcworkspacedata`
  lists `App.xcodeproj` and `Pods/Pods.xcodeproj`.
- **`CODE_SIGNING_ALLOWED=NO`** — simulator builds need no signing, and skipping
  it avoids every provisioning-profile failure mode on the fast inner loop.
- **`-derivedDataPath .build/ios`** pins the product path so step 4 can name
  `App.app` literally. `.build/` is gitignored (`.gitignore:19`).
- **Step 2 throws the previous products away, and it matters.** An incremental
  build only adds to `App.app`. It never removes a resource bundle whose pod has
  left the Podfile. Until this step existed, every simulator app still carried
  `GoogleMobileAdsResources.bundle` and `UserMessagingPlatformResources.bundle`
  from the AdMob era. Only `Build/Products` goes: the compiled objects under
  `Build/Intermediates.noindex` stay, so the rebuild re-links and re-copies
  rather than recompiling everything.
- **`>/dev/null` on step 3 only.** Xcode's build log is thousands of lines;
  errors still reach stderr and still fail the `&&` chain.
- **Step 5 swallows `simctl terminate`'s exit status.** It exits non-zero when
  the app is not running, which is the normal case on a first install. A failed
  build still stops the chain before step 6. Until 2026-09-22 a bare `;` stood
  there, and it launched whatever older app was installed after a failed build.
- The bundle id `com.noqyris.foldwing` is hard-coded twice in this line and is
  not read from `capacitor.config.ts`.

### 1.3 `release:appstore`, decomposed

```sh
npm run ios:appstore && {
  fastlane release_build; live=$?
  npm run ios:sync:adsoff && fastlane beta_adsoff && [ $live -eq 0 ] && fastlane attach_build
}
```

(one line in `package.json`; plain POSIX `sh`, which is what npm runs it with.)

| Fails | What still runs | Exit |
|---|---|---|
| `ios:appstore` | nothing — no archive, no upload (the tree may hold the live bundle: run `ios:sync:adsoff`) | ≠ 0 |
| `release_build` (anywhere: a gate, the archive, the upload) | **the whole ads-off half** — an extra ads-off build is harmless, a live build left newest is not. No attach. | ≠ 0 |
| `ios:sync:adsoff` or `beta_adsoff` | nothing after it; no attach — the version is not armed while N+1 is missing | ≠ 0 |
| `attach_build` | — (both uploads landed; finish with the `attach_build build:N` it prints) | ≠ 0 |
| nothing | all five steps | 0 |

The attach comes last on purpose. Attaching needs N to be VALID, and waiting for that
between the two uploads kept N the newest build for its whole processing time plus
the ads-off build's, on every release. `beta_adsoff` still waits up to 15 minutes for
N+1 so it can hand it to the internal group, but a timeout there only warns: the
upload is what makes N+1 the newest build, and failing would skip the attach over a
build that is merely slow (`asc-tf-groups assign` finishes the hand-out). An App Store
Connect error there does fail, and the attach is skipped.

---

## 2. Vite and TypeScript settings that matter

### `vite.config.ts`

| Setting | Value | Why |
|---|---|---|
| `define` | `import.meta.env.VITE_APP_VERSION` = the first `MARKETING_VERSION` in `project.pbxproj` (read, never written; package.json's `version` as a fallback) | The Settings footer and the review prompt's once-per-version rule read the same string. fastlane writes the App Store version into the project only **after** the web build, so bump `MARKETING_VERSION` when opening a new version or its first build still says the old one. There is no build number in the bundle |
| `base` (`:6`) | `'./'` | **Load-bearing for iOS.** Capacitor serves the bundle from `capacitor://localhost` over a copied directory; an absolute `/assets/...` base resolves wrong inside the WKWebView and the app boots to a white screen. |
| `build.target` (`:8`) | `'es2020'` | Matches `tsconfig` `target`. iOS deployment target is 14.0. |
| `build.chunkSizeWarningLimit` (`:9`) | `2000` | The Phaser-bearing main chunk is ~1.7 MB (`dist/assets/index-*.js`); the default 500 kB warning is pure noise here. |
| `server.host` (`:12`) | `true` | Binds all interfaces so a phone on the LAN can hit the dev server. |
| `server.port` (`:13`) | `5173` | Referenced in `README.md:14`. |
| `test.environment` (`:18`) | `'node'` | Not jsdom. Every test is pure math; **Phaser is never imported by a test** — importing it from a test would break the suite, not just slow it. |
| `test.include` (`:19`) | `['src/**/*.test.ts']` | Tests live next to their subject. Nothing outside `src/` is collected. |
| `test.env` | `{ TZ: 'Europe/Belgrade' }` | A non-UTC zone with DST: the Daily, the top-up, the streak and the reminder plan roll over at LOCAL midnight, and on a UTC runner the tests that catch the difference pass vacuously |

`/// <reference types="vitest" />` at `vite.config.ts:1` is what makes the `test`
key typecheck inside `defineConfig`.

### `tsconfig.json`

```jsonc
"strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
"noImplicitOverride": true, "noImplicitReturns": true,
"noFallthroughCasesInSwitch": true, "forceConsistentCasingInFileNames": true,
"isolatedModules": true, "useDefineForClassFields": true, "noEmit": true
```

Consequences worth knowing before editing:

- **`noUnusedLocals` / `noUnusedParameters`** make `npm run build` fail on a
  commented-out call site that leaves an import or a parameter dangling. This is
  the most common reason a "harmless" edit breaks the build.
- **`isolatedModules`** forbids re-exporting a type without `export type`.
- **`useDefineForClassFields: true`** means class fields are defined with
  `Object.defineProperty` semantics, not assignment — a subclass field
  declaration *shadows* rather than assigns over a base-class value.
- **`types: ["vite/client"]`** — Vitest globals are **not** enabled. Every test
  must import `describe`/`it`/`expect` from `'vitest'` explicitly
  (`monetization.test.ts:2`).
- **`include: ["src", "vite.config.ts"]` (`tsconfig.json:22`) excludes
  `scripts/`.** `scripts/genLevels.ts` is therefore **not** typechecked by
  `npm run build` or `npm run typecheck`; it is run ad hoc with
  `npx vite-node scripts/genLevels.ts` (`scripts/genLevels.ts:20`). A breaking
  change to `LevelValidator` or `Theme` will not surface until someone runs the
  generator.

### `index.html`

Not a build setting, but it is part of what ships. The `position: fixed; inset 0`
lock on `html, body, #app` (`index.html:40-50`) exists because a rubber-banding
WKWebView shifts the canvas bounding rect Phaser caches for input, putting every
touch off by the scroll offset — see the comment at `index.html:32-39` and the
`game.scale.refresh()` handlers in `src/main.ts:47-54`. `background: #e9ebe4`
(`index.html:23`) is the same value as `capacitor.config.ts:9` and
`index.html:11`'s `theme-color`, so the FIT letterbox bands are invisible.

---

## 3. `patch-package` via `postinstall`

`package.json:17` → `"postinstall": "patch-package"`, with `patch-package@^8.0.1`
in `devDependencies` (`package.json:33`).

One patch exists: `patches/cordova-plugin-purchase+13.18.0.patch` (27 lines). It
edits `node_modules/cordova-plugin-purchase/src/ios/InAppPurchase.m` around line
288, replacing a single call:

```diff
-    [self _ensureInitialized];
+    // FOLDWING PATCH: do not touch StoreKit at app launch.
+    NSLog(@"[CdvPurchase.AppleAppStore.objc] Deferring init until setup: (Foldwing patch).");
```

**What breaks without it.** `config.xml:5-8` registers the plugin with
`<param name="onload" value="true"/>`, so the Cordova bridge instantiates
`InAppPurchase` at webview load. The stock `_ensureInitialized` call registers a
StoreKit payment-queue observer, which makes StoreKit attach a storefront
listener, which requires an Apple Account. On a signed-out device that raises a
"Sign in to Apple Account" dialog over the home screen ~3s after launch —
**before the player has touched anything — and it reappears after Cancel**. A
repeating login wall on first run of a free game. Verified on a clean simulator;
see the patch body (`patches/cordova-plugin-purchase+13.18.0.patch:10-24`) and
the parallel explanation at `src/systems/Iap.ts:66-82`.

The observer is still registered, just later: `-setup:` calls
`_ensureInitialized`, and JS `store.initialize()` invokes it. `Iap.init()` is a
deliberate no-op (`src/systems/Iap.ts:62-64`); the real work lives in the private
`connect()` (`src/systems/Iap.ts:83-155`, which is what calls
`store.initialize()`), and its only two call sites are `buyRemoveAds`
(`src/systems/Iap.ts:164`) and `restore` (`src/systems/Iap.ts:181`) — so nothing
touches StoreKit until the player opens buy or restore.

**The patch must reach the native project, and it does so through `cap sync`.**
The chain is:

```text
npm install → postinstall → patch-package
   → node_modules/cordova-plugin-purchase/src/ios/InAppPurchase.m   (patched, line 291)
npx cap sync ios
   → ios/capacitor-cordova-ios-plugins/sources/CordovaPluginPurchase/InAppPurchase.m
                                                                    (patched, line 291)
   → Podfile pod 'CordovaPlugins', :path => '../capacitor-cordova-ios-plugins'
```

Both copies currently carry the `FOLDWING PATCH` marker at line 291. Order
matters: a `cap sync` run against an unpatched `node_modules` copies the stock
file into the native tree and the login-wall regression ships.
`ios/capacitor-cordova-ios-plugins/` is gitignored (`.gitignore:13`,
`ios/.gitignore:9`), so a fresh clone has no cached copy to hide the mistake —
but it also means the patched native source is never reviewed in a diff.

---

## 4. Capacitor config and `cap sync`

`capacitor.config.ts` is the source of truth:

```ts
const config: CapacitorConfig = {
  appId: 'com.noqyris.foldwing',
  appName: 'Foldwing',
  webDir: 'dist',
  backgroundColor: '#E9EBE4',
  ios: {
    contentInset: 'never',
  },
  plugins: {
    LocalNotifications: {
      presentationOptions: [],
    },
  },
};
```

- `webDir: 'dist'` ties the sync to Vite's default output directory. Changing
  `build.outDir` without changing this ships an empty shell.
- `backgroundColor: '#E9EBE4'` matches `index.html` and `theme().paper`
  (`src/main.ts:15`) so the letterbox is invisible.
- `ios.contentInset: 'never'` stops WKWebView adding safe-area insets to the
  scroll view; combined with the `position: fixed` lock it keeps the canvas rect
  stable.
- `plugins.LocalNotifications.presentationOptions: []` (1.4): a reminder that arrives
  while the game is open shows no banner, no sound and no badge — it would land over
  a level, often over the very Daily it is about. The default is all of them. Like
  everything here it reaches the phone only through `cap sync`, as
  `capacitor.config.json`.

`npx cap sync ios` produces `ios/App/App/capacitor.config.json` (18 lines), which
is the same object plus a generated `packageClassList`:

```json
"packageClassList": [
  "InAppReviewPlugin", "FilesystemPlugin", "HapticsPlugin",
  "LocalNotificationsPlugin", "PreferencesPlugin", "SharePlugin",
  "LevelPlayAdsPlugin", "CDVPlugin"
]
```

Both `capacitor.config.json` and `config.xml` are **generated and gitignored**
(`ios/.gitignore:11-13`, `.gitignore:12`). Never hand-edit them; the next sync
overwrites them. If a plugin is added to `package.json` but the app cannot find
it at runtime, the missing entry is here and the fix is another sync.

### The one mistake this pipeline is built around

> Forgetting `ios:sync` ships the *previous* build's UI inside a new binary,
> which is the single easiest mistake to make here. — `SUBMIT.md:115-116`

`cap sync` copies `dist/` into `ios/App/App/public/` (gitignored,
`.gitignore:8`). Xcode builds whatever is sitting in that folder. It does not
know or care that your TypeScript changed. Nothing in the fastlane lanes runs
the web build — `Fastfile:12-14` says so explicitly and gives the second reason:
CocoaPods misbehaves under fastlane's bundled Ruby, so the sync stays in the
shell.

The failure is silent and passes every test: the suite runs against `src/`, the
archive succeeds, TestFlight accepts it, and the build boots the old UI.

### The second mistake: the adapter pods arrive one install late

`cap sync ios` runs `pod install` inside its update step and only **then** runs the
`capacitor:sync:after` hook, `levelplay-manifest.js` from `capacitor-levelplay-ads`.
That hook is what writes the mediation adapters (`levelplay.networks` in
`package.json` → `pod 'IronSourceUnityAdsAdapter'`) into a marked
`LEVELPLAY-ADAPTERS` block in the Podfile. So the sync's own install never sees
them. Xcode's `[CP] Check Pods Manifest.lock` phase only compares the two lock
files with each other, so the build still passes — and links the LevelPlay SDK
with **no ad network behind it**.

Hence `npm run ios:pods` after every `cap sync`, and `check-native-sync.mjs` after
that: it fails unless `Podfile.lock` resolves `CapacitorLevelplayAds`,
`IronSourceSDK` and every adapter in the block, its `PODFILE CHECKSUM` matches the
Podfile as it is now, it equals `Pods/Manifest.lock`, and no Google pod is left.

The same hook also rewrites `Info.plist` on every sync (it always sets
`LevelPlayCMPProvider`, re-serialising the file with 2-space indents and no
comments) and **only adds** SKAdNetwork ids — it never removes one. It writes the
adapter pods unversioned and rewrites its block on every run, which is why the
SDK version pins sit outside the block and `Podfile.lock` is committed.

Stay on CocoaPods. `npx cap migrate` floats every dependency; `npx cap add ios`
without `--packagemanager CocoaPods` creates an SPM project.

### UIScene (Capacitor 8.5, adopted by hand)

Xcode 27 builds against the iOS 27 SDK, and iOS 27 will not launch an app built
with that SDK unless it uses the scene life cycle. UIKit logs
`Application failed to launch: UIScene life cycle is required for apps built
with this SDK` and the process exits with SIGTRAP after about a second of black
screen. TestFlight 1.4 (52) was archived that way and has no scene manifest.
The migration follows <https://capacitorjs.com/docs/updating/8-5> by hand,
without `cap migrate`:

- `SceneDelegate.swift`: forwards `willConnectTo`, `openURLContexts` and
  `continue userActivity` to `SceneDelegateProxy`. It creates **no** window
  and **no** controller.
- `Info.plist` `UIApplicationSceneManifest`: one `Default Configuration`,
  `UISceneDelegateClassName` `$(PRODUCT_MODULE_NAME).SceneDelegate`,
  `UISceneStoryboardFile` `Main`. The LevelPlay hook re-serialises the plist on
  every sync and keeps the manifest.
- `AppDelegate.swift`: `configurationForConnecting` returns that configuration
  by name. The window property, the two `ApplicationDelegateProxy` URL
  forwards and the `applicationDidBecomeActive` family are gone, because
  UIKit no longer calls them.
- `Main.storyboard` still names `FoldwingBridgeViewController`, so UIKit
  creates it exactly once, as the scene window's root. The 8.5 template's
  SceneDelegate also builds a `CAPBridgeViewController()` in `willConnectTo`.
  Here that would be a second bridge, and one without the Game Center plugin.

**Gated, three times, since 1.4** — because nothing in the build, the upload or
Apple's processing says a thing when the manifest is missing, and because the
LevelPlay hook re-serialises `Info.plist` on every sync:

1. `check-native-sync.mjs ios <target>` (every npm chain, and `build_ipa` before it
   archives) reads the source plist with `plutil -convert json` and refuses unless
   `UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0]`
   has a `UISceneDelegateClassName` ending in `.SceneDelegate` (it reads
   `$(PRODUCT_MODULE_NAME).SceneDelegate` there) and `UISceneStoryboardFile` `Main`. A
   missing, unreadable or malformed plist is a refusal too. It prints
   `scene: $(PRODUCT_MODULE_NAME).SceneDelegate + Main.storyboard`.
2. `build_ipa`, after archiving, runs `assert_scene_manifest!` on the `Info.plist` the
   archive **packed** (`plutil -extract … raw`, where the delegate reads
   `App.SceneDelegate`), beside the binary check. If either post-archive check refuses,
   the exported `build/Foldwing.ipa` is deleted, so `beta_upload` cannot ship it.
3. `beta_upload` runs the same check on the re-uploaded ipa's
   `Payload/App.app/Info.plist`, before any marker check or credential: an ipa that
   never went through `build_ipa` cannot ship without the manifest either.

All three also refuse **`UIRequiresFullScreen`**, in the archive whatever its value: it
opts the app out of Split View and of the iPhone Duo's window sizes, and an
`INFOPLIST_KEY_UIRequiresFullScreen` build setting would add it to the archived plist
and to no source plist. Keep `UISupportedInterfaceOrientations` portrait-only (the Duo's
inner display ignores it and the game resizes live instead) and never add the key.

Before archiving with a new Xcode, launch the mock build on a simulator running the
newest iOS (`SIM=<udid> npm run ios:run`); `devicectl process launch` reporting
"Launched" proves nothing about the app staying up.

The CLI's own detector (`migrate-uiscene.js`) classifies this project as
`already-migrated`, so an accidental `cap migrate` would at least leave the
scene files alone. Capacitor 8.5 also moved the `pause` and `resume` document
events to `UIScene` notifications. The game does not use them: it listens to
the DOM's `visibilitychange`, which WKWebView fires on its own.

---

## 5. iOS project layout and identity

### Tracked vs generated

`git ls-files ios` returns exactly 17 paths. Everything else under `ios/` is
generated or vendored.

| Tracked | Generated / ignored |
|---|---|
| `App/App.xcodeproj/project.pbxproj` | `App/App/public/` (web bundle) |
| `App/App.xcworkspace/contents.xcworkspacedata` | `App/App/capacitor.config.json` |
| `App/App/AppDelegate.swift`, `App/App/SceneDelegate.swift` | `App/App/config.xml` |
| `App/App/Info.plist` | `App/Pods/` |
| `App/App/Assets.xcassets/**` (icon + splash PNGs) | `App/build/`, `App/output/`, `DerivedData` |
| `App/App/Base.lproj/{LaunchScreen,Main}.storyboard` | `ios/capacitor-cordova-ios-plugins/` |
| `App/Podfile`, `App/Podfile.lock` | `xcuserdata` |
| `App/App.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist`, `ios/.gitignore` | |

`AppDelegate.swift` and `SceneDelegate.swift` are Capacitor 8.5 boilerplate
(see "UIScene" above), with no ad SDK init, no StoreKit and no URL handling of
their own. Apart from the Game Center plugin in `GameCenterPlugin.swift`, all
app behaviour lives in TypeScript.

### Identity (`project.pbxproj`, Debug at `:359-379`, Release at `:380-399` — identical except the Pods xcconfig reference and the Swift flags: Debug alone carries `OTHER_SWIFT_FLAGS` and `SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG`)

| Setting | Value | Line (Debug / Release) |
|---|---|---|
| `PRODUCT_BUNDLE_IDENTIFIER` | `com.noqyris.foldwing` | 372 / 392 |
| `DEVELOPMENT_TEAM` | `YMN45WC2QR` | 366 / 387 |
| `MARKETING_VERSION` | `1.4` — `build_ipa` writes the editable App Store version here before it archives; `vite.config.ts` reads it for `VITE_APP_VERSION` | — |
| `CURRENT_PROJECT_VERSION` | `54` in the tree (the last archive); `build_ipa` sets the real number at archive time, through Xcodeproj | — |
| `ASSETCATALOG_COMPILER_APPICON_NAME` | `AppIcon` | — |
| `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` | `AppIcon-Fold` (1.4) — both configurations of the App target | — |
| `IPHONEOS_DEPLOYMENT_TARGET` | `15.0` — the floor of Capacitor 8 and of the LevelPlay plugin's podspec | 368 / 389 |
| `TARGETED_DEVICE_FAMILY` | `1` (iPhone only) | 376 / 396 |
| `CODE_SIGN_STYLE` | `Automatic` | 364 / 385 |
| `INFOPLIST_FILE` | `App/Info.plist` | 367 / 388 |
| `SWIFT_VERSION` | `5.0` | 375 / 395 |

`Podfile:3` pins `platform :ios, '15.0'` to match (`pod install` refuses the plugin below it), with `use_frameworks!`
(`Podfile:4`) and `install! 'cocoapods', :disable_input_output_paths => true`
(`Podfile:9`) — the latter is the Capacitor-recommended workaround for Xcode
caching Pods after a new Cordova plugin is installed.

Resolved native SDK versions at the LevelPlay migration (September 2026, CocoaPods
`1.16.2`). `ios/App/Podfile.lock` is the authority; these move only deliberately:

| Pod | Version |
|---|---|
| Capacitor / CapacitorCordova / CordovaPlugins | 8.5.2 |
| CapacitorLevelplayAds | 0.1.42 (Core subspec only — custom consent) |
| IronSourceSDK | 9.6.0.0 (→ IronSourceAdQualitySDK 9.9.0) |
| IronSourceUnityAdsAdapter | 5.11.0.0 (→ UnityAds 4.20.0, UnityCoherenceLib 0.1.0) |
| CapacitorCommunityInAppReview | 8.0.0 |
| CapacitorFilesystem | 8.1.3 (→ IONFilesystemLib 1.1.2) |
| CapacitorHaptics | 8.0.2 |
| CapacitorLocalNotifications | 8.3.1 |
| CapacitorPreferences | 8.0.1 |
| CapacitorShare | 8.0.1 |

No `-ObjC` in the pbxproj: CocoaPods puts it in `Pods-App.*.xcconfig` for the static
IronSource libraries, and the App target inherits it. Never give the App target an
`OTHER_LDFLAGS` without `$(inherited)` — without `-ObjC` the Unity Ads adapter class is
dropped at link time and nothing fills.

Assets. The app icon is a **single** 1024×1024 PNG per appearance, `"idiom":
"universal", "platform": "ios"`: `AppIcon.appiconset` holds `AppIcon-512@2x.png` and,
since 1.4, a dark appearance `AppIcon-dark.png` (`"appearances": [{ "appearance":
"luminosity", "value": "dark" }]`). The tinted and clear appearances are left to the
system, which generates what an icon does not provide. Splash is three 2732×2732 PNGs
at 1×/2×/3×.

**The 1.4 icon** is "Mirror Path": a line and its mirror through different walls on each
side, on a tangerine ground, with rust walls (2.02:1 against the ground; 2.06:1 on the
dark variant) — chosen in the ASO work so the listing stands out in a search list of
navy, black and purple tiles and says "a line puzzle with a twist" at 60 px. It is a
hand-made illustration of the rule, not a shipped level; never caption it as gameplay.
It is not generated by `ShareCard` as the earlier icon was, and the scripts that drew
and recoloured it live in the session scratchpad, not in the repo: the PNGs in
`Assets.xcassets` are the source.

**One alternate icon ships in the binary, for a Product Page Optimization test.** Apple
only lets PPO test icons that are part of the current App Store version's binary, built
with alternate icons in the asset catalog. `AppIcon-Fold.appiconset` ("The Fold", plum,
with its own dark appearance) is compiled as an alternate by
`ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "AppIcon-Fold"`; actool then writes it
into the built `Info.plist` as `CFBundleIcons → CFBundleAlternateIcons → AppIcon-Fold`
(the source plist carries no `CFBundleIcons`). Nothing in the app switches icons — the
alternate exists only for the store test. Check the archive's `Info.plist` for the
`CFBundleAlternateIcons` entry before submitting; a local actool run lists it.

### The provisioning profile

`AppStore_com.noqyris.foldwing.mobileprovision` sits in the **working directory
but is NOT committed** — `.gitignore:28` matches `*.mobileprovision`, confirmed
by `git check-ignore`. Decoded contents:

| Field | Value |
|---|---|
| Name | `com.noqyris.foldwing AppStore` |
| UUID | `98fe1e30-5936-4385-bcfe-f4ce34851da3` |
| `application-identifier` | `YMN45WC2QR.com.noqyris.foldwing` |
| TeamName | `Djordje Subotic` |
| `get-task-allow` | `false` (distribution profile) |
| CreationDate | 2026-07-26 07:34:41 +0000 |
| ExpirationDate | **2027-04-08 10:26:36 +0000** |

`build_ipa` re-fetches (or creates) this profile through `sigh` on every run
(`Fastfile:86-91`), so the on-disk copy is a convenience, not a dependency. A
fresh clone signs fine without it.

---

## 6. `Info.plist` — the keys that matter

`ios/App/App/Info.plist` (the LevelPlay hook re-serialises it on every sync, so line
numbers below are from the 1.1 file and only a hint). Beyond the stock `CFBundle*` keys:

| Key | Value | Line | Why it is there |
|---|---|---|---|
| `CFBundleDisplayName` | `Foldwing` | 7-8 | Home-screen name. **Independent of the App Store listing name**, which plain "Foldwing" could never be (it was taken): `Foldwing: Mirror Line Puzzle` at 1.0, `Foldwing: Mirror Maze Puzzle` by 1.3, `Foldwing: One Line Mirror Maze` on the 1.4 version. Renaming the listing never touches this key. |
| `CFBundleVersion` | `$(CURRENT_PROJECT_VERSION)` | 21-22 | Follows the build setting `build_ipa` writes. It was a literal once, and agvtool rewrites the reference to one — see the trap in §10. |
| `CFBundleShortVersionString` | `$(MARKETING_VERSION)` | 19-20 | Follows the build setting (currently `1.4`). |
| `UIApplicationSceneManifest` | one `Default Configuration`: `$(PRODUCT_MODULE_NAME).SceneDelegate`, storyboard `Main` | — | Mandatory for an iOS 27 SDK build (§4, "UIScene"), and gated three times. |
| `NSPhotoLibraryAddUsageDescription` | the add-only photo string | — | *Save Image* from the share sheet runs in this process; without the string iOS kills it (see `SUBMIT.md`). |
| `UISupportedInterfaceOrientations` | `[UIInterfaceOrientationPortrait]` only | 40-43 | The mirror axis is vertical and the playfield is authored 9:16; landscape makes the drawable half unusable. Apple rejects an iPad-capable build that does not offer all four orientations (rejection code **90474**), so the app drops iPad (`TARGETED_DEVICE_FAMILY = 1`) rather than dropping portrait. Reasoning at `Info.plist:34-39`. |
| `ITSAppUsesNonExemptEncryption` | `<false/>` | 50-51 | Stops TestFlight and App Store uploads asking the encryption question on every single build. |
| `NSUserTrackingUsageDescription` | `Allows Foldwing to show ads that are more relevant to you. Declining keeps the ads, just less relevant.` | — | ATT prompt copy, shown before the plugin's consent modal. The same string is `levelplay.userTrackingDescription` in `package.json`; the hook only inserts it when missing. |
| `SKAdNetworkItems` | Unity's LevelPlay partner list plus ironSource's `su67r6k2v3` | — | Attribution for the mediated networks. Google's `cstr6suwn9` must **not** be in it — `check-no-google.mjs` refuses it, and the hook never removes an id. |
| `LevelPlayCMPProvider` | `custom` | — | Written by the sync hook from `levelplay.consentProvider`: the plugin's own consent modal, no Usercentrics SDK. |

There is no `GADApplicationIdentifier` any more, and no `GAD_APPLICATION_IDENTIFIER`
build setting; both are refused by `check-no-google.mjs`.

### What replaced the plist↔code lock

The AdMob pipeline had to keep a native app id and a TypeScript flag in agreement.
LevelPlay has neither a native app id nor a test/live unit pair — the same ids ship
in every build, and every `ADS:on` build serves the real waterfall — so what has to
be proven is **which bundle is inside the binary**. The app bakes two markers, each
exactly once:

| Build | Markers | Made by | Goes to |
|---|---|---|---|
| live | `ADMODE:live` + `ADS:on` | `npm run ios:appstore` | App Store only |
| ads-off | `ADMODE:test` + `ADS:off` | `npm run ios:sync:adsoff` | TestFlight — the default, and N+1 of every release |
| mock | `ADMODE:test` + `ADS:mock` | `npm run ios:sync:mock`, `dev:mock`; `fastlane beta_mock` | this machine, or TestFlight on request; never the store (`attach_build` refuses its numbers) |
| test | `ADMODE:test` + `ADS:on` | `npm run ios:sync` | Xcode Run only (real waterfall + Test Suite) |

and three layers count them: `check-ad-mode.mjs` on `dist/` in every chain,
`check-native-sync.mjs` on `ios/App/App/public` after the sync, and again both inside
`fastlane build_ipa`; the Xcode "Ad-mode guard" phase refuses an archive of a live
bundle unless `AD_TARGET=live` was stated. `monetization.test.ts` pins the native
project free of Google ad identifiers and the ATT string present.

The mock build's browser bundle also carries a **fake store** (`iapMock.ts`, 1.4) whose
purchase sheet is titled "FAKE PURCHASE — no money". The same two gates refuse
`/FAKE\s+PURCHASE/i` in every bundle but mock — `live`, `off` and `test` fail it
whatever their markers say — so a store build can never ship a sheet that grants
reveals for nothing. The string must stay in `iapMock.ts` alone (comments are fine;
the minifier strips them). A phone build of the mock never selects the fake store — it
uses the StoreKit sandbox — but Vite only drops it where `VITE_ADS` is not `mock`, so
the mock bundle keeps it and passes.

There is no build in which ads are safe to tap, or to watch on purpose. Placement and
cadence are judged on the **mock** build.

---

## 7. fastlane

No `Gemfile` exists, so fastlane runs as the system install (`fastlane <lane>`,
not `bundle exec`). Run lanes from the **project root** (or from `fastlane/`):
lane bodies run with Ruby's cwd set to `fastlane/`, so every path a lane builds
itself resolves against `ROOT = File.expand_path("..", __dir__)`. The AdMob-era
Fastfile ran `node scripts/check-ad-mode.mjs` from `fastlane/`, found no script,
and so refused every archive.

### Constants

```ruby
ROOT       = File.expand_path("..", __dir__)
WORKSPACE  = "ios/App/App.xcworkspace"
SCHEME     = "App"
APP_ID     = "com.noqyris.foldwing"
TEAM       = "YMN45WC2QR"
IPA        = "build/Foldwing.ipa"
ASSETS     = "ios/App/App/public/assets"
AD_TARGETS = %w[live off mock]
LIVE_BUILD_RECORD = "build/.live-build-number"
FAKE_ADS_RECORD   = "build/.fake-ads-builds"
```

### Auth helpers

`asc_key` wraps `app_store_connect_api_key(key_id:, issuer_id:, key_filepath:)`
with `ENV.fetch` (not `ENV[]`) — a missing variable raises immediately instead of
producing a confusing auth failure ten seconds later. `asc_app` builds a real
`Spaceship::ConnectAPI::Token` (not the hash `asc_key` returns) and finds the app.
An API key means **no Apple-ID password and no 2FA prompt** anywhere.

### Environment variables

From `.env.appstore.example`. The real `.env.appstore` is gitignored and the `.p8`
key itself lives in `~/.appstoreconnect/private_keys` and is **never** committed.

| Var | Consumed by | Notes |
|---|---|---|
| `ASC_KEY_ID` | `asc_key`, `asc_app` | |
| `ASC_ISSUER_ID` | `asc_key`, `asc_app` | |
| `ASC_KEY_PATH` | `asc_key`, `asc_app` | Path to the `.p8` |
| `APPLE_ID` | `Appfile` | Apple account email |
| `APPLE_TEAM_ID` | `Appfile` | Public team identifier, pre-filled in the example |
| `ASC_TEAM_ID` | `Appfile` | App Store Connect team id, usually the same |

Load them with `set -a; source .env.appstore; set +a` — `set -a` is required because
`source` alone creates shell variables, not exported ones, and fastlane runs in a
child process.

### Lanes

| Lane | Does |
|---|---|
| `verify` | Reads the latest TestFlight build number. Read-only proof the key works. |
| `setup_app` | One-time `produce`. Already done — app id **6794804195**. |
| `build_ipa ad_target:live\|off\|mock` | Refuses any other target (a "test" LevelPlay build is a real-ads build). Runs `check-ad-mode <target> ios/App/App/public/assets`, `check-native-sync ios <target>` and `check-no-google --bundle ios/App/App/public/assets` before reading a credential. Sets the build number to `max(latest TestFlight, FOLDWING_BUILD_NUMBER, build/.last-build-number) + 1` and `MARKETING_VERSION` from the editable App Store version, fetches the profile, archives with manual signing and `AD_TARGET=<target>` in `xcargs`, then reads the archive: `check-ad-mode <target>` on the bundle packed in `App.app/public/assets` (absolute path) — a sync from another session that landed after the gates and the Xcode guard is refused here, before any upload — and the binary: `LPMInitRequestBuilder` and `ISUnityAdsAdapter` must be in it, the plugin's "IronSourceSDK is not available" no-op string must not — and the archived `Info.plist`: the UIScene manifest (`*.SceneDelegate` + `Main`) must be there and `UIRequiresFullScreen` must not (`assert_scene_manifest!`, §4). If either post-archive check refuses, the exported `build/Foldwing.ipa` is deleted before the lane fails, so nothing can re-upload it. |
| `release_build` | **N.** Loud REAL ADS banner → deletes any old `build/.live-build-number` → `build_ipa(ad_target: "live")` → records N in `build/.live-build-number` → upload (no group). **No attach, no processing wait, no submit.** The "HALF DONE" banner prints from `ensure` — on success and on failure — worded for what happened (nothing uploaded / upload failed part-way / uploaded) and naming `npm run ios:sync:adsoff && fastlane beta_adsoff` and `fastlane attach_build build:N`. |
| `beta_adsoff` | **N+1, and every other TestFlight build.** `build_ipa(ad_target: "off")` → upload → wait for VALID (15 min) → hand to the internal group. A processing timeout warns and passes; an App Store Connect error fails. |
| `beta_mock` | A TestFlight build with **fake** ads, on the owner's request. `build_ipa(ad_target: "mock")` → the number recorded in `build/.fake-ads-builds` **before** the upload → upload and hand to the internal group. Its ads are drawn in the page and call no network, so every surface is safe to tap; its store is the StoreKit sandbox. `attach_build` refuses every recorded number even with `force:true`. Never the build that follows a live upload — that is always `beta_adsoff`. 1.4's TestFlight builds 52–54 went out this way |
| `beta`, `beta_testads` | Refusals that name `beta_adsoff` and `release:appstore`. |
| `attach_build [build:N] [force:true]` | **The last step of `release:appstore`**, and the way to finish one. Takes `build:N`, else `build/.live-build-number`, else refuses — it never picks "the newest build", which after a release is N+1 and loads no ad. Refuses a number that is not the recorded live build unless `force:true`, and refuses the old `FOLDWING_BUILD_NUMBER=N` spelling. Then waits up to 15 min for N to be VALID and points the editable version at it. A timeout or a missing editable version **fails**, with `fastlane attach_build build:N` in the message. Does not submit. |
| `expire_build build:N` | Expire one TestFlight build. |
| `expire_real_ads [confirm:true]` | Last step of a release, once N is `READY_FOR_SALE`: lists every unexpired build except the newest and, with `confirm:true`, expires them. Only builds numbered below the kept one are ever expired. Refuses — **including when it is the only unexpired build** — if the newest is live (attached to an App Store version, or the recorded live build: the ads-off half never landed); if a build to expire belongs to a version that is not released yet (in preparation, in review, pending release, rejected and awaiting resubmission); or if a build to expire is the recorded live build and is attached to nothing. It knows "live" only by attachment and the record: a live build that is neither looks ads-off to it. |
| `beta_upload` | Re-upload `build/Foldwing.ipa` after an uploader 500. Unzips it, runs the scene check on its `Info.plist` first (§4), and accepts only `ADMODE:live + ADS:on` (recorded as the live build, uploaded, not distributed, "HALF DONE" and `attach_build build:N` printed) or `ADMODE:test + ADS:off` (uploaded and distributed) or `ADMODE:test + ADS:mock` (recorded in `build/.fake-ads-builds`, uploaded and distributed); refuses everything else. |

Non-obvious reasons, all documented in the Fastfile comments:

- **The build number is written with Xcodeproj, not `increment_build_number`**:
  agvtool also rewrites the plist's `$(CURRENT_PROJECT_VERSION)` reference back to a
  literal.
- **The number is a max of three sources** because the two halves of a release are
  separate fastlane runs minutes apart, and App Store Connect does not list N yet
  when N+1 asks for "latest" — N+1 now starts right after N's upload.
- **Which build is live is recorded, not inferred.** App Store Connect cannot say
  which bundle a build carries, and after a release the newest build is the ads-off
  one. `build/.live-build-number` (gitignored) is written before N's upload and read
  by `attach_build` and `expire_real_ads`; keep it until N is expired.
- **Manual signing is mandatory.** Automatic signing fails with *"Cloud signing
  permission error"* because Xcode cloud signing needs rights this API key does not
  carry; `sigh` creates the profile over a different path and the export uses it.
- **Distribution is `Build#add_beta_groups`, never `upload_to_testflight(groups:)`**:
  pilot's distribute path submits the build for beta review.
- **`release_build` uploads but does not distribute**, and still is not safe alone:
  the protection is the ads-off upload that follows it — which is why
  `release:appstore` runs that upload even when `release_build` fails.

```ruby
build_app(
  workspace: WORKSPACE, scheme: SCHEME,
  export_method: "app-store",
  output_directory: "build", output_name: "Foldwing.ipa",
  xcargs: "-allowProvisioningUpdates AD_TARGET=#{target}",
  export_options: {
    signingStyle: "manual",
    teamID: TEAM,
    provisioningProfiles: { APP_ID => profile }
  }
)
```

### What fastlane deliberately does NOT do here

- No `upload_to_app_store` lane, no `fastlane/metadata/`, no review submission.
  Submitting is a decision, taken on the owner's word.
- No web build, no `cap sync`, no `pod install` — CocoaPods misbehaves under
  fastlane's bundled Ruby, so the sync stays in the npm chains; `build_ipa` only
  verifies what they left behind.
- No test run. `npm run build` runs the suite inside every chain.
- `fastlane/README.md` is auto-generated and rewritten on every fastlane run;
  never edit it by hand.

---

## 8. Submission state (from `SUBMIT.md`)

App Store Connect app id **6794804195** · bundle `com.noqyris.foldwing` · team
`YMN45WC2QR`. `SUBMIT.md` is the authority and says how each fact was verified; this
is the shape of it on 2026-09-23.

| | |
|---|---|
| On sale | **1.3** — build 50 (the LevelPlay release), approved and released 2026-09-17; build 50 is expired on TestFlight and 51 (ads-off) followed it |
| In preparation | **1.4** — version record created 2026-09-23, `PREPARE_FOR_SUBMISSION`, release type MANUAL, **no build attached**, nothing submitted |
| TestFlight, 1.4 | 52, 53, 54 — all mock builds (`beta_mock`, fake ads). **52 has no scene manifest and dies at launch on iOS 27** (§4); 53 and 54 carry it |
| Name / subtitle (1.4) | `Foldwing: One Line Mirror Maze` / `Drawing puzzle, hidden walls` — set on the new app info, which goes live with 1.4 |
| Keywords (en-US, 1.4) | `labyrinth,draw,stroke,single,symmetry,daily,minimalist,invisible,cozy,zen,logic,relaxing,offline` (96/100 bytes) |
| Localizations (1.4) | en-US, plus en-GB (a copy), es-MX and hr, each with name, subtitle, keywords, description and What's New |
| Support / Marketing URL | `https://www.noqyris.com/` |
| Privacy policy | `https://www.noqyris.com/foldwing/privacy.html` (live) |
| Categories | Games → Puzzle, Casual · secondary Entertainment (unchanged) |
| Age rating | 4+ |
| In-app purchases | `removeads`, `reveals10/20/30` approved; `reveals25` (the starter, $0.99) `READY_TO_SUBMIT`, to go with 1.4 |

Still to do for 1.4, none of it a lane: upload the nine 1320×2868 screenshots in
`store/screenshots/1.4/` to the en-US 6.9" set; the archive via `npm run
release:appstore`; the privacy page's sentence about rewarded ads after Remove Ads
(`10-monetization.md` §10); and, on the owner's word only, the submission with
`reveals25` attached.

**App Privacy** is app-level and needs nothing from 1.4. Seven declarations, all
describing what the **ad SDKs** collect (Unity LevelPlay, Unity Ads, ironSource's Ad
Quality SDK) — Foldwing itself has no server, no account, and sends nothing anywhere;
the reminders are local notifications:

- Location → **Coarse Location** · Third-Party Advertising · **Not linked** ·
  **Used for tracking**
- Identifiers → **Device ID** · Third-Party Advertising, Analytics, App
  Functionality · **Not linked** · **Used for tracking**
- Usage Data → **Product Interaction** · Third-Party Advertising · **Not
  linked** · **Used for tracking**
- Usage Data → **Advertising Data** · Third-Party Advertising · **Not linked** ·
  **Used for tracking**
- Diagnostics → **Crash Data**, **Performance Data**, **Other Diagnostic Data** ·
  Analytics, App Functionality · **Not linked** · **Not used for tracking**

Published 2026-09-16 and live. `IronSourceSDK/AdQuality` links
`IronSourceAdQualitySDK`, whose bundled manifest declares Device ID, Performance Data
and Other Diagnostic Data. The label, the policy and the bundled manifests must agree
or review bounces it; the policy must also name Unity LevelPlay.

**The 1.0-era blockers are history.** Pricing (Free) and availability were set by hand
for 1.0 — `appPriceSchedule` and `appAvailabilityV2` returned 404 through the API until
they were — and every version since has shipped with them.

### Known-untested before submission

**No sandbox purchase is recorded in this repo**, for any product — the starter least of
all, since StoreKit has never sold it. App Review tests IAPs, so a failure there is a
rejection and a lost cycle. Three separate defects were found and fixed in that path in
one afternoon in 1.0 — zero territories on the product, StoreKit asking for an Apple
Account at startup, and a silent restore on launch putting a repeating sign-in dialog
over the home screen. Every one surfaced by *running* it, none by reading it. The
coverage that matches what a reviewer does is in `10-monetization.md` §10, on a device
with a Sandbox Apple ID (it cannot be done on the simulator).

### LevelPlay (replaces the AdMob section)

| | |
|---|---|
| App key (iOS) | `282ab31c5` |
| Banner | `h0a7k5pjpr3ziohk` |
| Interstitial | `w4ocqufvnz4i9mbt` |
| Rewarded | `e5mt76phyqseoqpa` |
| Android | none — no LevelPlay Android app exists |

All in `src/systems/providers/levelplay.ts`. Demand is Unity Ads (Game ID and
placements on the dashboard only).

- **`app-ads.txt`** must carry `unity.com, 144007920, DIRECT` plus the dashboard's
  reseller list on the developer site the store listing names. It is served from the
  noqyris-website repo.
- **Expect little fill at first** on a new LevelPlay app. Every ad path treats no-fill
  as a silent no-op and leaves the cadence counter armed.
- **Never tap an ad or watch one on purpose**, on any build: every `ADS:on` build is the
  real waterfall, and TestFlight gets `ADS:off`, or the fake ads of `ADS:mock` when the
  owner asks.

---

## 9. `skills/app-publishing/` — the local reference set

A self-contained playbook checked into the repo (`SKILL.md` + four references,
369 lines total). It is the *generic* source these decisions were made from;
`SUBMIT.md` is the project-specific state. Read the skill when doing something
this pipeline does not already automate.

| File | Lines | Covers |
|---|---|---|
| `SKILL.md` | 58 | The seven-step release pipeline in order; five non-negotiables (store copy must match reality, declare ad data collection, never commit secrets, manual release, never click your own live ads); a platform routing table; the two gates that surprise people (Play's 12-tester/14-day closed test for personal accounts, Apple's closed version trains); a pre-submit health check |
| `references/app-store.md` | 101 | ASC API key setup and `set_spaceship_token`; marketing version vs build number and the **90186 / 90062 "Invalid Pre-Release Train … is closed"** rule; `agvtool new-version -all N`; example `build_and_upload` / `prep` / `submit` lanes with full `submission_information`; export compliance; the metadata file/limit table (`name.txt` 30, `subtitle.txt` 30, `keywords.txt` 100, `promotional_text.txt` 170, `description.txt` 4000); ASO rules (never repeat name/subtitle words, use singulars, `games` as a multiplier); App Privacy answers; IAP rules incl. *don't grant off `store.owned()`*; TestFlight `PROCESSING → VALID` |
| `references/admob.md` | 80 | **History — AdMob is no longer used.** One AdMob app per platform; `~` = app id (native) vs `/` = unit id (code) and why mixing them is the classic silent-no-fill bug; the exact iOS `Info.plist` and Android manifest keys; the `TESTING` flag pattern and per-platform unit sets; `initialize` / `requestConsentInfo` / `showConsentForm` / `requestTrackingAuthorization` and wrapping each in try/catch; reserving the banner strip via `BannerAdPluginEvents.SizeChanged`; why new apps no-fill; account-safety rules; a five-step debug checklist |
| `references/monetization.md` | 52 | Interstitial cadence as a hybrid gate with a table of typical values (onboarding grace ~level 8, every 3rd win, ≥180s spacing, ~90s warm-up, ≤3/session, ~5min mute after rewarded, never on a finale); "implement the gate as a single non-consuming predicate"; only spend the counter when an ad actually rendered; rewarded-ad banking and daily top-up; Remove-Ads IAP bundling and upsell timing; the one-shot rating prompt at a delight peak, never paired with an ad; at most one interruption at a time; measure D1/D7 alongside ARPDAU |
| `references/google-play.md` | 78 | Not yet used by this project — no `android/` directory exists. Closed-testing gate details, signed-AAB build, the macOS `JAVA_HOME` gotcha, keystore properties, Play listing limits and Data safety, service-account uploads, and a long section on driving the Play Console SPA with browser automation |

Cross-check: this repo follows `SKILL.md` on secrets, manual release, never tapping
live ads and the `cap sync` warning; its ad-network material is AdMob-era — for
LevelPlay use the user-level `mobile-game-playbook` skill; it **diverges** by not implementing the
metadata/submit lanes (`app-store.md:32-51`) and by using `key_filepath` rather
than the `key_content` JSON layout `app-store.md:7-11` recommends.

---

## 10. Traps, contradictions and dead ends

Flagged from reading; confirm before acting.

1. *(Resolved.)* `MARKETING_VERSION` once read `1.1` while the open App Store version
   record was `1.0`, and a binary whose short version does not match the open record
   cannot be attached to it. `build_ipa` now writes the editable App Store version into
   the project before it archives (the tree reads `1.4`), and `vite.config.ts` reads it
   back for the bundle — so bump it by hand when a new version opens, or the first
   build's Settings footer and review-prompt key still say the old one (§2).
2. *(Resolved, and still a trap.)* `CFBundleVersion` was a literal in `Info.plist`, so
   a build-setting bump produced a second binary carrying the old number. The plist
   reads `$(CURRENT_PROJECT_VERSION)` now, and `build_ipa` writes the setting through
   Xcodeproj rather than `increment_build_number`, whose agvtool backend rewrites the
   reference back to a literal. After any lane, `git diff ios/` must show only the
   version and build number the lane meant to write. `monetization.test.ts` pins the
   plist reference (`lets the build number come from the build setting fastlane
   increments`).
3. *(Resolved.)* `README.md` once said Remove Ads "was approved with 1.0" while it sat at
   `READY_TO_SUBMIT`. It has been approved since, with the three packs; the starter
   (`reveals25`) is the product still waiting for review.
4. *(AdMob era, resolved.)* The plist carried a stale comment about which AdMob
   app id was current. The plist no longer carries an ad app id at all.
5. *(AdMob era, resolved.)* The plist/flag test could not catch "both on TEST".
   LevelPlay has no test inventory; the marker gates in §6 replaced it.
6. **`scripts/` is outside `tsconfig.json`'s `include`.** It has its own project,
   `tsconfig.scripts.json`, which `npm run typecheck` (and so `npm run build`) runs
   second; `vite.config.ts` still collects no tests from `scripts/`.
7. **`npm test` must be run from the repo root** — see §1.1.
8. **`fastlane/report.xml` exists in the working tree and is gitignored**
   (`.gitignore:25`). `fastlane/README.md` *is* tracked but is machine-generated.
9. **Prebuilt artefacts are whatever the last local run left.** `dist/`,
   `build/Foldwing.ipa`, `build/Foldwing.app.dSYM.zip`, `.build/ios/` and
   `ios/App/App/public/` are all gitignored and all describe the last build or sync on
   this machine — which may be a mock or a live one. The gates re-read them; never
   trust them by name. `build/.live-build-number` and `build/.fake-ads-builds` are
   records, not artefacts: keep them.

---

## 11. Release checklist

Ordered. The rules behind it are in [../CLAUDE.md](../CLAUDE.md).

1. **`nvm use`** — Node 22. The Capacitor 8 CLI refuses Node 21.
2. **`npm install`** — `postinstall` runs `patch-package` and
   `patch-levelplay-consent.mjs`; both must report success. Confirm the purchase
   patch landed:
   `grep -c 'FOLDWING PATCH' node_modules/cordova-plugin-purchase/src/ios/InAppPurchase.m`
   must be ≥ 1.
3. **`npm test`** from the repo root. Every chain runs it again inside `build`.
   With a new Xcode, launch the mock build on a simulator running the newest iOS first
   (`SIM=<udid> npm run ios:run`): TestFlight 52 was archived without the scene
   manifest and never opened on iOS 27.
4. **Load credentials:** `set -a; source .env.appstore; set +a`.
5. **`fastlane verify`** — cheap read-only proof the API key still works.
6. **`npm run release:appstore`** — in order (§1.3):
   1. `npm run ios:appstore` (gates report **live**) → `fastlane release_build`:
      build N uploaded and recorded in `build/.live-build-number` — **not**
      attached, not submitted, no processing wait.
   2. Immediately, **even if `release_build` failed**: `npm run ios:sync:adsoff`
      (gates report **off**) → `fastlane beta_adsoff`: build N+1 uploaded and
      handed to the internal group.
   3. Only if both halves passed: `fastlane attach_build` — waits for N to be
      VALID and attaches the recorded build to the editable version.
   The command exits non-zero if any step failed; finish with what the lanes
   print (`fastlane attach_build build:N`, `asc-tf-groups assign`). If
   `ios:appstore` failed after its sync, run `npm run ios:sync:adsoff` before
   anything else — `ios/App/App/public` still holds the LIVE bundle. On an Apple
   uploader 500 after a successful archive, use `fastlane beta_upload` — only
   while `build/Foldwing.ipa` is still that archive; the ads-off half overwrites it.
7. **Wait for `PROCESSING → VALID`**, then test the ads-off build N+1 from TestFlight
   on a device. Never install or open N.
8. **Run the sandbox-purchase pass** with a Sandbox Apple ID on N+1: buy, confirm
   ads stop (on ads-off there are none to stop — check the entitlement and the
   reveal stash instead), delete, reinstall, restore, relaunch twice.
9. **Publish and verify the web pages** — between the uploads and the submission,
   on the owner's word (a push to `repository/web/noqyris-website` is a Vercel
   deploy): commit and push `public/foldwing/privacy.html` and `public/app-ads.txt`,
   then check what is served:
   ```sh
   curl -s https://www.noqyris.com/foldwing/privacy.html | grep -c 'Unity LevelPlay'   # ≥ 1
   curl -s https://www.noqyris.com/foldwing/privacy.html | grep -c AdMob               # 0
   curl -s https://www.noqyris.com/app-ads.txt | grep -F 'unity.com, 144007920, DIRECT' # a match
   ```
   The consent modal's *Privacy policy* button opens that page.
10. **Before submitting:** App Review notes name Unity LevelPlay (not AdMob); the App
    Privacy label carries the full set in §8, Diagnostics included; the version points
    at the live build N, whose `Info.plist` lists `AppIcon-Fold` under
    `CFBundleIcons → CFBundleAlternateIcons` (the PPO icon test needs it in the
    binary); the screenshots for the version are uploaded; `reveals25` is attached to
    the submission; and the privacy page no longer says rewarded ads stay available
    after Remove Ads.
11. **Submit for review only on the owner's word.** Release type is MANUAL.
12. **Once N is `READY_FOR_SALE`:** `fastlane expire_real_ads`, check the list, then
    `fastlane expire_real_ads confirm:true`.
13. **Never tap an ad, and never watch one on purpose**, on any build.

---

## See also

- [00-index.md](00-index.md) — documentation map
- [01-architecture.md](01-architecture.md) — module graph and boot order
- [09-systems.md](09-systems.md) — `Ads`, `Iap`, `Rate`, `Share`, `Progress` runtime wiring
- [10-monetization.md](10-monetization.md) — `src/config/monetization.ts`, LevelPlay, ad cadence, the reveal economy
- [../CLAUDE.md](../CLAUDE.md) — ad safety and the two-build release
- [12-testing.md](12-testing.md) — the full suite, including `monetization.test.ts`
- [08-level-generation.md](08-level-generation.md) — `scripts/genLevels.ts`, the file `tsconfig` does not typecheck
- [13-api-reference.md](13-api-reference.md) — exported symbols
- [15-change-recipes.md](15-change-recipes.md) — task-shaped procedures
- [../README.md](../README.md) — narrative rationale for the design decisions
- [../SUBMIT.md](../SUBMIT.md) — the authoritative, mutable submission state
