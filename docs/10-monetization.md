# Monetization: Ads, IAP, and the Gating Rules

## What this covers

Every code path where money touches Foldwing: the `monetization` config object and its
ad-unit resolution, the four ad placements with their exact gates, the reveal
currency arithmetic, the StoreKit purchase surface, the native `cordova-plugin-purchase`
patch, and the go-live checklist. Cadence policy lives in `src/config/monetization.ts`
and `src/systems/Ads.ts` only — no scene decides when an ad may fire.

## Source files

| Path | Lines | Role |
|---|---|---|
| `src/config/monetization.ts` | 182 | The single config object, ad unit tables, `admobUnits()`, `adsConfigured()` |
| `src/config/monetization.test.ts` | 109 | Pins unit-id shapes, plist agreement, and the cadence arithmetic |
| `src/systems/Ads.ts` | 302 | `AdsService` singleton: init/consent, banner, interstitial gate, rewarded |
| `src/systems/Iap.ts` | 206 | `IapService` interface, `StoreKitIapService`, `applyEntitlement()` |
| `src/systems/Progress.ts` | 304 | Persists `adsRemoved`, `reveals`, `winsSinceAd`, `attemptsSinceAd`, daily top-up |
| `src/systems/Rate.ts` | 38 | Review prompt; yields to a queued interstitial |
| `src/scenes/GameScene.ts` | 707 | All four ad call sites and the reveal/skip UI |
| `src/scenes/MenuScene.ts` | 216 | Buy / restore rows, reveal chip, banner call |
| `src/scenes/BootScene.ts` | 55 | Entitlement applied before any ad request; deferred store open |
| `src/render/Theme.ts` | 212 | `METRICS.bannerReserve`, `METRICS.inset` — the reserved banner strip |
| `patches/cordova-plugin-purchase+13.18.0.patch` | 27 | Removes the launch-time StoreKit observer |
| `ios/App/App/Info.plist` | 122 | `GADApplicationIdentifier`, ATT string, 45 SKAdNetwork ids |

---

## 1. The config object, verbatim and annotated

`src/config/monetization.ts:90` — declared `as const`, so every field is a literal type
and readonly.

```ts
export const monetization = {
  useTestAds: false,

  products: {
    removeAds: 'com.noqyris.foldwing.removeads',
  },

  ads: {
    interstitialFromLevel: 8,
    interstitialEveryNWins: 3,
    interstitialEveryNAttempts: 5,
    minSecondsBetweenInterstitials: 120,
    sessionWarmupSeconds: 90,
    maxInterstitialsPerSession: 4,
    muteAfterRewardedSeconds: 300,
  },

  reveals: {
    grantedPerRewarded: 1,
    freeDailyTopUp: 1,
    startingStash: 2,
    durationMs: 6000,
    offerSkipAfterAttempts: 6,
  },

  rate: {
    firstPromptAfterWins: 6,
  },
} as const;
```

| Field | Line | Value | Read by | Meaning / trap |
|---|---|---|---|---|
| `useTestAds` | 105 | `false` | `Ads.init`, every `prepare*`/`showBanner` call | Selects TEST vs LIVE unit tables **and** is passed as `isTesting` / `initializeForTesting`. Must agree with `GADApplicationIdentifier` in `Info.plist` — pinned by a test, see §3. |
| `products.removeAds` | 109 | `'com.noqyris.foldwing.removeads'` | `Iap.ts:44` | Non-consumable product id. Also the App Store Connect IAP id. |
| `ads.interstitialFromLevel` | 117 | `8` | `Ads.timingAllows` (`Ads.ts:162`) | Compared against the **0-based** `levelIndex`. Level index 8 is displayed as "9." (`GameScene.ts:666`). No interstitial on the first eight levels. |
| `ads.interstitialEveryNWins` | 119 | `3` | `Ads.wouldShowInterstitial` (`Ads.ts:178`) | Post-win path only. Compared against `Progress.data.winsSinceAd`. |
| `ads.interstitialEveryNAttempts` | 133 | `5` | `Ads.wouldShowOnAttempt` (`Ads.ts:196`) | HALF a gate. Compared against `Progress.data.attemptsSinceAd`. Useless alone — see §5.2. |
| `ads.minSecondsBetweenInterstitials` | 139 | `120` | `Ads.timingAllows` (`Ads.ts:168`) | The brake. Hard floor since `lastInterstitialAt`, applied to BOTH interstitial entry points. |
| `ads.sessionWarmupSeconds` | 142 | `90` | `Ads.timingAllows` (`Ads.ts:166`) | Measured from `sessionStartedAt`, which is re-stamped at the END of a successful `init()` (`Ads.ts:102`), not at process start. |
| `ads.maxInterstitialsPerSession` | 145 | `4` | `Ads.timingAllows` (`Ads.ts:163`) | Counter only increments when an ad actually rendered (`Ads.ts:233`). |
| `ads.muteAfterRewardedSeconds` | 147 | `300` | `Ads.showRewarded` (`Ads.ts:274`) | Sets `mutedUntil = Date.now() + 300_000` — only when `earned` is true. |
| `reveals.grantedPerRewarded` | 156 | `1` | `GameScene.doReveal` (`GameScene.ts:433`) | Banked via `Progress.grantReveals`, never auto-spent. |
| `reveals.freeDailyTopUp` | 157 | `1` | `Progress.applyDailyTopUp` (`Progress.ts:249`) | Applied inside `Progress.load()` only. |
| `reveals.startingStash` | 158 | `2` | `freshSave()` (`Progress.ts:77`) | See the off-by-one in §6: a genuinely new player launches with **3**, not 2. |
| `reveals.durationMs` | 159 | `6000` | `GameScene.ts:424` → `InkRenderer.showReveal` | Hold time only; on-screen total is 220 + 6000 + 420 ms (`InkRenderer.ts:246,252,253`). |
| `reveals.offerSkipAfterAttempts` | 161 | `6` | `GameScene.fail` (`GameScene.ts:321`) | Compared against `this.attempts`, a per-level-load counter, NOT `attemptsSinceAd`. See §5.4. |
| `rate.firstPromptAfterWins` | 166 | `6` | `Rate.shouldAsk` (`Rate.ts:25`) | Not money, but shares the "one interruption per moment" rule. |

---

## 2. AdUnits, the four tables, and resolution

```ts
export interface AdUnits {
  /** ca-app-pub-XXXX~NNNN — the tilde one. Goes in the NATIVE config, not here. */
  readonly appId: string;
  readonly banner: string;
  readonly interstitial: string;
  readonly rewarded: string;
}
```
`src/config/monetization.ts:38`

| Table | Line | appId | banner | interstitial | rewarded |
|---|---|---|---|---|---|
| `TEST_IOS` | 51 | `ca-app-pub-3940256099942544~1458002511` | `…/2934735716` | `…/4411468910` | `…/1712485313` |
| `TEST_ANDROID` | 58 | `ca-app-pub-3940256099942544~3347511713` | `…/6300978111` | `…/1033173712` | `…/5224354917` |
| `LIVE_IOS` | 76 | `ca-app-pub-3307486877162157~5033197766` | `…/6426316277` | `…/4373767928` | `…/5113234608` |
| `LIVE_ANDROID` | 83 | `''` | `''` | `''` | `''` |

Test-unit prefix is `ca-app-pub-3940256099942544` (Google's public test publisher);
live prefix is `ca-app-pub-3307486877162157`. Elided segments above are prefixed with
the same publisher id as their `appId`; full values are at the cited lines.

```ts
const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';

/** The unit set actually in force, resolved at call time so tests can vary it. */
export function admobUnits(): AdUnits {
  if (monetization.useTestAds) return isAndroid() ? TEST_ANDROID : TEST_IOS;
  return isAndroid() ? LIVE_ANDROID : LIVE_IOS;
}

/**
 * False until real unit ids exist for THIS platform — every ad path then no-ops
 * cleanly rather than firing requests that can only fail.
 */
export const adsConfigured = (): boolean => admobUnits().interstitial.length > 0;
```
`src/config/monetization.ts:170,173,182`

Consequences worth knowing:

- **Resolution is per call, not cached.** Nothing memoizes `admobUnits()`; every
  `showBanner`/`prepareInterstitial`/`prepareRewardVideoAd` re-resolves it
  (`Ads.ts:123,217,256`).
- **`adsConfigured()` probes only `interstitial`.** With `LIVE_ANDROID` all-empty and
  `useTestAds: false`, Android returns `false` and the whole ad layer no-ops:
  `Ads.enabled` (`Ads.ts:63`) and `Ads.rewardedAvailable` (`Ads.ts:71`) both go false, so
  no banner, no interstitial, no rewarded, and `GameScene` hides the skip offer
  (`GameScene.ts:323`) and dims the reveal pill (`GameScene.ts:671`). **Android is
  currently unshippable for ads by construction.** Filling in `LIVE_ANDROID` is the
  whole fix.
- **Under vitest** `Capacitor.getPlatform()` returns `'web'` (test env is `node`,
  `vite.config.ts`), so `isAndroid()` is false and the tests always exercise the iOS
  table.

---

## 3. The test that fails the build when config and Info.plist disagree

**Test name:** `keeps the native app id in step with useTestAds`
**Location:** `src/config/monetization.test.ts:45` (inside `describe('AdMob identifiers')`,
`monetization.test.ts:17`).

```ts
it('keeps the native app id in step with useTestAds', () => {
  const native = plistString('GADApplicationIdentifier');
  expect(native).toMatch(/^ca-app-pub-\d+~\d+$/);
  expect(native).toBe(admobUnits().appId);

  if (monetization.useTestAds) {
    expect(native).toBe('ca-app-pub-3940256099942544~1458002511');
  } else {
    expect(native).not.toContain('3940256099942544');
  }
});
```

Why it exists: `GADApplicationIdentifier` is a NATIVE value the SDK reads at launch, so
it cannot follow a TypeScript flag — it is hand-edited. Live app id + Google test units
(or the reverse) is an AdMob policy problem in both directions.

Mechanics and traps:

- `plistString()` (`monetization.test.ts:8`) does `readFileSync('ios/App/App/Info.plist')`
  with a **relative** path (`monetization.test.ts:5`). The suite therefore only works
  with cwd = repo root. `npm test` → `vitest run` satisfies this; running vitest from a
  subdirectory breaks both tests that read the plist — this one and
  `declares ATT and the SKAdNetwork list the SDK needs` (`monetization.test.ts:57`).
- The regex is `<key>KEY</key>\s*<string>([^<]*)</string>` — a plist that separates key
  and string with a comment or attribute would silently return `''`.
- **What it does NOT catch:** both sides left on TEST. `SUBMIT.md:86-88` states this
  explicitly. The test only proves *agreement*, never *liveness*.

Other pins in the same file:

| Test | Line | Asserts |
|---|---|---|
| `uses the right shape for app ids and unit ids` | 18 | `appId` matches `~`, all three units match `/` |
| `gives every format its own unit` | 28 | `new Set([banner, interstitial, rewarded]).size === 3` |
| `reports itself configured` | 34 | `adsConfigured() === true` — fails if `LIVE_IOS` is emptied |
| `declares ATT and the SKAdNetwork list the SDK needs` | 57 | `NSUserTrackingUsageDescription.length > 20`, plist contains `SKAdNetworkItems` and `cstr6suwn9.skadnetwork` |
| `protects onboarding` | 69 | `interstitialFromLevel >= 6` |
| `keeps interstitials rare, spaced and capped` | 73 | `everyNWins >= 3`, `minSeconds >= 120`, `maxPerSession <= 4`, `warmup >= 60` |
| `cannot fire on retries faster than the time floor allows` | 90 | see §5.2 |
| `stops taxing someone who just watched a rewarded ad` | 102 | `muteAfterRewardedSeconds >= 180` |
| `only offers a skip once the level has really resisted` | 106 | `offerSkipAfterAttempts >= 5` |

`Info.plist` currently carries `ca-app-pub-3307486877162157~5033197766`
(`Info.plist:63-64`) and 45 `SKAdNetworkIdentifier` entries (`Info.plist:75-119`).

---

## 4. AdsService: API and lifecycle

Singleton export: `export const Ads = new AdsService();` — `src/systems/Ads.ts:302`.
The class itself is not exported; there is one instance for the process.

### Public surface

```ts
setAdsRemoved(v: boolean): void                                          // Ads.ts:57
get enabled(): boolean                                                   // Ads.ts:63
get rewardedAvailable(): boolean                                         // Ads.ts:71
async init(): Promise<void>                                              // Ads.ts:75
async showBanner(): Promise<void>                                        // Ads.ts:117
async hideBanner(): Promise<void>                                        // Ads.ts:136
wouldShowInterstitial(levelIndex: number, winsSinceAd: number): boolean  // Ads.ts:175
wouldShowOnAttempt(levelIndex: number, attemptsSinceAd: number): boolean // Ads.ts:193
async showInterstitial(): Promise<boolean>                               // Ads.ts:211
async showRewarded(placement: string): Promise<boolean>                  // Ads.ts:250
```

Private: `timingAllows(levelIndex: number): boolean` (`Ads.ts:158`) and
`once(events: string[], timeoutMs: number): Promise<void>` (`Ads.ts:285`).

```ts
get enabled(): boolean {
  return isNative() && adsConfigured() && !this.adsRemoved;
}

/**
 * Opt-in rewarded stays available even to owners: it helps the player, and
 * taking it away would punish the person who paid.
 */
get rewardedAvailable(): boolean {
  return isNative() && adsConfigured();
}
```
`src/systems/Ads.ts:63,71` — note the asymmetry: **`rewardedAvailable` ignores
`adsRemoved` on purpose.**

### Internal state

| Field | Line | Initial | Notes |
|---|---|---|---|
| `ready` | 27 | `false` | Set true only after `AdMob.initialize()` resolves |
| `adsRemoved` | 28 | `false` | Mirrors `Progress.data.adsRemoved`; pushed in from BootScene/MenuScene |
| `bannerShown` | 29 | `false` | |
| `bannerWanted` | 39 | `false` | Replay flag — see below |
| `personalized` | 49 | `false` | Restrictive default; `npa: !personalized` on every request |
| `sessionStartedAt` | 51 | `Date.now()` at module load | Re-stamped at `Ads.ts:102` |
| `lastInterstitialAt` | 52 | `0` | So the very first eligible moment passes the floor |
| `mutedUntil` | 53 | `0` | |
| `interstitialsThisSession` | 54 | `0` | |
| `inFlight` | 55 | `false` | Shared by interstitial AND rewarded — one full-screen ad at a time |

### `init()` sequence — `Ads.ts:75`

```text
BootScene.create
  └ Progress.load().then(save)
      ├ Ads.setAdsRemoved(save.adsRemoved)   BootScene.ts:31  ← BEFORE any request
      ├ scene.start('Menu')                  BootScene.ts:32  ← menu never waits on ads
      ├ Ads.init()   (not awaited)           BootScene.ts:34
      │    1 guard: !isNative() || !adsConfigured() || ready  → return
      │    2 AdMob.initialize({ initializeForTesting: useTestAds })
      │    3 requestTrackingAuthorization()  then trackingAuthorizationStatus()
      │    4 requestConsentInfo(); if form available && status REQUIRED
      │        → showConsentForm() → requestConsentInfo() again
      │    5 personalized = att.status === 'authorized' && consent.status !== REQUIRED
      │      (steps 3–5 wrapped in try/catch: consent is best-effort)
      │    6 ready = true; sessionStartedAt = Date.now()
      │    7 if (bannerWanted) showBanner()   ← the replay
      └ Iap.init()   (a deliberate no-op)    BootScene.ts:52
```

The **replay** at `Ads.ts:103` is load-bearing. `MenuScene.create` calls `showBanner()`
(`MenuScene.ts:162`) synchronously, which almost always lands before `initialize()` has
resolved; the plugin refuses it. `showBanner` sets `bannerWanted = true` and returns at
`Ads.ts:120`, and `init` fires it again. Remove the replay and the banner appears only
when the network happens to be fast.

**Every method swallows its own errors** (`Ads.ts:8-9`). A no-fill, an offline device, or
a broken creative must never surface in the game loop.

---

## 5. The four placements and their exact gates

### 5.0 The shared gate: `timingAllows`

```ts
private timingAllows(levelIndex: number): boolean {
  if (!this.enabled) return false;

  const a = monetization.ads;
  if (levelIndex < a.interstitialFromLevel) return false;
  if (this.interstitialsThisSession >= a.maxInterstitialsPerSession) return false;

  const now = Date.now();
  if ((now - this.sessionStartedAt) / 1000 < a.sessionWarmupSeconds) return false;
  if (now < this.mutedUntil) return false;
  return (now - this.lastInterstitialAt) / 1000 >= a.minSecondsBetweenInterstitials;
}
```
`src/systems/Ads.ts:158`

It is split out from the count checks precisely so both entry points share exactly one
definition of "is an interruption allowed at all right now" — a third entry point added
later cannot accidentally skip it (`Ads.ts:149-157`).

### 5.1 Post-win interstitial — every 3rd win, AFTER the figure

Predicate (non-consuming):

```ts
wouldShowInterstitial(levelIndex: number, winsSinceAd: number): boolean {
  return (
    this.timingAllows(levelIndex) &&
    winsSinceAd >= monetization.ads.interstitialEveryNWins
  );
}
```
`src/systems/Ads.ts:175`

Call path:

| Step | Location |
|---|---|
| Win recorded, `winsSinceAd += 1` | `Progress.recordWin` → `Progress.ts:187` |
| Figure presented, hint "tap for the next fold" after `winHoldMs + winSettleMs + 250` | `GameScene.ts:359-363` |
| Player taps; tap ignored until `advanceReadyAt` | `GameScene.ts:195` |
| `advance()` — the ONE place a post-win ad may fire | `GameScene.ts:396` |
| `if (Ads.wouldShowInterstitial(levelIndex, Progress.data.winsSinceAd))` → `await Ads.showInterstitial()` | `GameScene.ts:402-403` |
| `if (shown) Progress.update({ winsSinceAd: 0, attemptsSinceAd: 0 })` | `GameScene.ts:406` |
| Then load next level (or `LevelSelect` if past the end) | `GameScene.ts:409-413` |

Invariants:

- The ad fires **after** the figure has been seen and dismissed, never over it
  (`monetization.ts:9-13`, `GameScene.ts:392-395`). The figure is the reward; an ad
  chaser spends the best moment in the game on the cheapest impression in it.
- **Counters are spent only when an ad actually rendered.** On no-fill `showInterstitial`
  returns `false`, `winsSinceAd` stays armed and the next natural break retries
  (`GameScene.ts:404-406`).
- A post-win ad also clears `attemptsSinceAd` (`GameScene.ts:406`). The retry path clears
  only `attemptsSinceAd` and leaves `winsSinceAd` armed (`GameScene.ts:451`). Neither the
  source nor the tests say why the reset is asymmetric.
- **Rate prompt yields.** `Rate.shouldAsk(adWillShow)` is called with the same predicate
  (`GameScene.ts:368-374`) and returns `false` when an ad is queued (`Rate.ts:22`). At
  most one interruption per moment.

### 5.2 Retry interstitial — BOTH axes, never either

```ts
wouldShowOnAttempt(levelIndex: number, attemptsSinceAd: number): boolean {
  return (
    this.timingAllows(levelIndex) &&
    attemptsSinceAd >= monetization.ads.interstitialEveryNAttempts
  );
}
```
`src/systems/Ads.ts:193`

**The count is a permission; the clock is the brake.** A failed attempt in Foldwing lasts
three to eight seconds. `interstitialEveryNAttempts: 5` on its own would put an ad on
screen roughly every 25 seconds on a level someone is stuck on. AdMob policy explicitly
forbids triggering an interstitial "every time a user clicks within the app" and disables
ad serving over it. So this configuration does not trade retention for revenue — it
trades an account for nothing (`monetization.ts:21-33`, `monetization.ts:121-132`,
`README.md:236-241`, `SUBMIT.md:160-165`).

The pin — `cannot fire on retries faster than the time floor allows`,
`src/config/monetization.test.ts:90`:

```ts
it('cannot fire on retries faster than the time floor allows', () => {
  expect(a.interstitialEveryNAttempts).toBeGreaterThanOrEqual(3);

  const fastestFailSeconds = 3;
  const soonestByCount = a.interstitialEveryNAttempts * fastestFailSeconds;
  expect(soonestByCount).toBeLessThan(a.minSecondsBetweenInterstitials);

  // Worst case a player can actually experience, in minutes between ads.
  const worstCaseGapMinutes = a.minSecondsBetweenInterstitials / 60;
  expect(worstCaseGapMinutes).toBeGreaterThanOrEqual(2);
});
```

Current arithmetic: `5 × 3 = 15 < 120` ✓, `120 / 60 = 2 >= 2` ✓. The count axis is pinned
only loosely — `interstitialEveryNAttempts` may rise as far as `39` (39 × 3 = 117 < 120)
and still pass, `40` fails. The clock axis is the tight one: **dropping
`minSecondsBetweenInterstitials` below 120 fails an assertion in two tests at once** —
`worstCaseGapMinutes >= 2` here (line 99) and `minSecondsBetweenInterstitials >= 120` in
`keeps interstitials rare, spaced and capped` (line 75). That is the intended
tamper-evidence: one number cannot be loosened in isolation.

Call path:

| Step | Location |
|---|---|
| Collision → `fail()`; `attemptsSinceAd += 1` | `GameScene.ts:300,309` |
| `failFlashMs` (400 ms) red flash timer | `GameScene.ts:312`, `METRICS.failFlashMs` `Theme.ts:179` |
| Timer fires → `resetToIdle()` → `maybeAdOnRetry()` | `GameScene.ts:314-316` |
| Re-guard `phase !== 'idle' \|\| advancing` → bail | `GameScene.ts:445` |
| `Ads.wouldShowOnAttempt(levelIndex, Progress.data.attemptsSinceAd)` | `GameScene.ts:446` |
| `await Ads.showInterstitial()`; `if (shown) Progress.update({ attemptsSinceAd: 0 })` | `GameScene.ts:448-451` |

**The ad fires only with the board already reset** — the player closes it into a level
ready to draw, not into a red flash (`GameScene.ts:315`, `GameScene.ts:439-443`). Firing
inside `fail()` instead of from the timer callback would be the naive change that breaks
this.

Note what an impatient player does to this. Reaching for the start dot during the flash
calls `resetToIdle()` early (`GameScene.ts:202`), and `resetToIdle()` removes the pending
fail timer as its first act (`GameScene.ts:378-379`) — so the queued `maybeAdOnRetry()`
never runs for that attempt. The retry ad can only fire when the player lets the 400 ms
flash expire on its own. The `phase !== 'idle' || advancing` re-guard
(`GameScene.ts:445`) is therefore belt-and-braces rather than the thing doing the work.

### 5.3 Banner — always on, over reserved paper

```ts
async showBanner(): Promise<void> {
  if (!this.enabled || this.bannerShown) return;
  this.bannerWanted = true;
  if (!this.ready) return; // replayed at the end of init()
  try {
    await AdMob.showBanner({
      adId: admobUnits().banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: monetization.useTestAds,
      npa: !this.personalized,
    });
    this.bannerShown = true;
  } catch {
    /* no banner is a fine outcome */
  }
}
```
`src/systems/Ads.ts:117`

Call sites: `MenuScene.ts:162` and `GameScene.ts:139`. **Nothing ever calls
`hideBanner()` except `setAdsRemoved(true)`** (`Ads.ts:59`) — verified by grep across
`src/`. The banner is a native view, so it survives every Phaser scene change; a banner
that disappears and reappears is worse than one that is simply always there
(`MenuScene.ts:192-194`).

How the strip is reserved — `src/render/Theme.ts`:

```ts
export const BASE_WIDTH = 750;   // Theme.ts:30
export const BASE_HEIGHT = 1334; // Theme.ts:31
export const PT = 2;             // Theme.ts:38
export function pt(points: number): number { return points * PT; } // Theme.ts:40

bannerReserve: pt(58),           // Theme.ts:195  = 116 base px

inset: {                         // Theme.ts:206
  top: pt(44),                   // = 88
  right: pt(12),                 // = 24
  bottom: pt(72),                // = 144
  left: pt(12),                  // = 24
},
```

`Playfield` subtracts the inset directly: `this.h = canvasH - inset.top - inset.bottom`
(`src/core/Playfield.ts:29`). So the drawable field ends 144 base px above the canvas
bottom, while the banner occupies roughly the bottom `bannerReserve` = 116 base px —
`inset.bottom > bannerReserve` by 28 base px of slack.

```text
y = 0        ┌──────────────────────────────┐
             │  inset.top   = pt(44) = 88   │  HUD: title, attempts, reveal pill
y = 88       ├──────────────────────────────┤
             │                              │
             │   PLAYFIELD (Playfield.h)    │  start dot, goal, walls, ink
             │   h = 1334 - 88 - 144 = 1102 │
y = 1190     ├──────────────────────────────┤  ← inset.bottom = pt(72) = 144
             │  paper margin (28 px slack)  │
y = 1218     ├──────────────────────────────┤  ← bannerReserve = pt(58) = 116
             │  NATIVE ADMOB BANNER strip   │  BOTTOM_CENTER, margin 0
y = 1334     └──────────────────────────────┘
```

Why this matters (`Theme.ts:186-205`, `Ads.ts:111-116`): the banner is a native view
pinned to the bottom of the SCREEN and knows nothing about the canvas. Phaser runs FIT +
CENTER_BOTH against 750×1334, which is 9:16 — the widest common portrait aspect — so on a
9:16 phone there is **no letterbox at all** and the banner sits directly on canvas. A
start dot or a button under an ad is unplayable *and* an accidental-click generator, and
accidental clicks are the fastest route to disabled ad serving.

Anything the scenes place near the bottom is anchored off `bannerReserve`, not off
`BASE_HEIGHT`: the share pill and the skip pill are both at
`BASE_HEIGHT - METRICS.bannerReserve - pt(34)` (`GameScene.ts:463,519`). MenuScene derives
its whole button stack from the row count for the same reason — hand-placed rows put
"Restore purchases" half off the bottom of the canvas (`MenuScene.ts:62-75,118-128`).

**Naive change that breaks things:** lowering `inset.bottom` to gain playfield. It moves
the start dot and goal ring under the ad. `inset` also feeds level validation and the
share card (`data/levels.test.ts:17`, `data/quality.test.ts:15`,
`render/ShareCard.ts:146`), so changing it re-scales every authored level's pixel
geometry.

### 5.4 Rewarded video — reveal (and skip)

```ts
async showRewarded(placement: string): Promise<'earned' | 'declined' | 'unavailable'>
```
Three outcomes, and the difference between the last two is load-bearing:

| Outcome | Means |
|---|---|
| `'earned'` | An ad played and the reward event fired. |
| `'declined'` | An ad played and the player closed it early. |
| `'unavailable'` | No ad could even be loaded — no fill, offline, or **any non-native build**. |

**Callers must decide `'unavailable'` deliberately.** A reward that costs the player
nothing may pass on it; a reward that hands over *currency* may not. The reveal refill
grants on `'earned'` only (`GameScene.earnReveal`) — it used to grant on anything but
`'declined'`, which turned the web Daily's "Watch an ad · +1" into an infinite reveal
dispenser that never showed an ad. `doSkip` still passes on `'unavailable'` on purpose:
a skip spends no currency, and a button that visibly does nothing reads as broken. Where
the reveal refill cannot pay out it says so with a hint instead of paying.

Implementation notes:

- Guarded by `rewardedAvailable`, which **ignores `adsRemoved`** — owners keep the option
  because taking it away would punish the person who paid (`Ads.ts:67-73`).
- Listener `RewardAdPluginEvents.Rewarded` sets a local `earned` flag (`Ads.ts:261-265`);
  the promise waits on `Dismissed`/`FailedToShow` with a **60000 ms** timeout
  (`Ads.ts:267-270`).
- On `earned`, `mutedUntil = Date.now() + muteAfterRewardedSeconds * 1000` = +300 s
  (`Ads.ts:274`) — someone who just volunteered their attention is not taxed again
  immediately.
- The `placement` parameter is **accepted and discarded** — `void placement;` in the
  `finally` block (`Ads.ts:279`). It exists as a hook for analytics that do not exist yet.

Two placements pass a placement string:

| Placement | Trigger | Reward |
|---|---|---|
| `'reveal'` | Reveal pill tapped with an empty stash, then "Watch an ad · +1" on the refill sheet | `Progress.grantReveals(1)` on `'earned'` **only** — banked, not auto-spent (`GameScene.earnReveal`) |
| `'skip'` (`GameScene.ts:540`) | "Skip this fold" pill, offered after `this.attempts >= 6` and only if `Ads.rewardedAvailable` (`GameScene.ts:320-326`) | `Progress.unlockThrough(levelIndex, LEVELS.length)` then jump to the next level — unlock **without** clearing, so no figure and no win are recorded (`GameScene.ts:543-547`, `Progress.ts:211`) |

The reveal itself — `InkRenderer.showReveal(mirroredWalls: readonly Rect[], durationMs: number): void`
(`src/render/InkRenderer.ts:230`) — paints the mirrored right-hand walls onto the left
half in `theme().fail` at alpha `0.16` (`InkRenderer.ts:236`), fading in over 220 ms,
holding `durationMs` (6000), fading out over 420 ms (`InkRenderer.ts:246,252,253`). It is
the right reward because it hands over exactly the information the game withholds: not
the answer, but where your own reflection is about to kill you. The player still has to
draw it (`InkRenderer.ts:223-229`).

**Two different attempt counters — do not conflate them:**

| Counter | Where | Incremented | Reset |
|---|---|---|---|
| `GameScene.attempts` | scene field, `GameScene.ts:99` | On every `pointerdown` that grabs the start dot (`GameScene.ts:216`) — including strokes released short of the goal | `loadLevel()` (`GameScene.ts:175`) |
| `Progress.data.attemptsSinceAd` | persisted save, `Progress.ts:56` | Only in `fail()`, i.e. only a real collision (`GameScene.ts:309`) | Only when an interstitial actually rendered (`GameScene.ts:406,451`) |

`offerSkipAfterAttempts` reads the first; `interstitialEveryNAttempts` reads the second.

### `showInterstitial()` and the Dismissed wait

```ts
async showInterstitial(): Promise<boolean>   // Ads.ts:211
```

`AdMob.showInterstitial()` resolves when the ad is **PRESENTED**, not when the player
closes it. Awaiting only that would carry on with the ad still covering the screen — and
if it never settled, the next level would never start and the close button would look
dead. So the service races `Dismissed` / `FailedToShow` against an **8000 ms** timeout
(`Ads.ts:222-228`) and only then stamps `lastInterstitialAt` and bumps
`interstitialsThisSession` (`Ads.ts:232-233`). Returns `true` only if it really rendered.

`private once(events: string[], timeoutMs: number): Promise<void>` (`Ads.ts:285`)
resolves on the first of several plugin events or on timeout.

---

## 6. Reveal banking and top-up arithmetic

State lives in `SaveData` (`src/systems/Progress.ts:38`):

```ts
/** Banked reveals. Spent by choice, never auto-consumed. */
reveals: number;                 // Progress.ts:46
/** ISO date (YYYY-MM-DD) of the last free daily top-up. */
lastTopUp: string;               // Progress.ts:48
/** True once Remove Ads is owned. Persisted so relaunch needs no store call. */
adsRemoved: boolean;             // Progress.ts:50
```

Operations:

```ts
get reveals(): number {          // Progress.ts:220
  return this.state.adsRemoved ? Number.POSITIVE_INFINITY : this.state.reveals;
}

grantReveals(n: number): void {  // Progress.ts:226
  this.update({ reveals: this.state.reveals + n });
}

/** False when the player has none left, so the caller can upsell instead. */
spendReveal(): boolean {         // Progress.ts:231
  if (this.state.adsRemoved) return true;
  if (this.state.reveals <= 0) return false;
  this.update({ reveals: this.state.reveals - 1 });
  return true;
}

private applyDailyTopUp(): void { // Progress.ts:244
  const today = new Date().toISOString().slice(0, 10);
  if (this.state.lastTopUp === today) return;
  this.update({
    lastTopUp: today,
    reveals: this.state.reveals + monetization.reveals.freeDailyTopUp,
  });
}
```

Arithmetic, exactly:

| Event | Effect on `state.reveals` |
|---|---|
| Fresh save | `= startingStash = 2` (`Progress.ts:77`) |
| `Progress.load()` — every launch | `+= 1` if `lastTopUp !== todayUTC`, then `lastTopUp = todayUTC` (`Progress.ts:153,244`) |
| Rewarded `'reveal'` earned | `+= grantedPerRewarded = 1` (`GameScene.ts:433`) |
| Reveal pill tapped with stash > 0 | `-= 1`, then `showReveal(...)` (`Progress.ts:234`, `GameScene.ts:423-427`) |
| Reveal pill tapped with stash 0 | no change; falls through to the rewarded offer (`GameScene.ts:429-431`) |
| `adsRemoved === true` | `spendReveal()` returns `true` **without decrementing**; `Progress.reveals` reads `Infinity` |

**Off-by-one worth knowing:** a genuinely new player does not start with 2. `freshSave()`
sets `reveals: 2` and `lastTopUp: ''`, then `load()` immediately calls `applyDailyTopUp()`,
`'' !== today`, so first launch shows **3** reveals. The HUD renders `Progress.reveals`
(`GameScene.ts:669`) and the menu chip renders `Progress.data.reveals`
(`MenuScene.ts:173`).

**Two further traps in the top-up:**

1. `new Date().toISOString()` is **UTC**. The "day" boundary is UTC midnight, not local
   midnight — a player in UTC+13 gets their top-up mid-afternoon.
2. `applyDailyTopUp` runs only inside `load()`, and `load()` runs once per launch
   (`BootScene.ts:28`). Keeping the app open across the boundary grants nothing until
   relaunch.

`grantReveals` writes the raw counter even for an owner, so an owner's `state.reveals`
drifts upward invisibly behind the `Infinity` getter. Harmless, but it is why the raw
field and the getter must not be used interchangeably.

**Remove Ads bundles unlimited reveals** (`Progress.ts:221-223`), which is what makes the
purchase worth roughly double at zero marginal cost (`README.md:249-251`).

---

## 7. IapService, StoreKitIapService, applyEntitlement

### The interface, verbatim

```ts
export interface StoreProduct {
  id: string;
  title: string;
  description: string;
  priceString: string;
}

export interface IapService {
  /** True when a purchase can actually be made right now. */
  readonly available: boolean;
  init(): Promise<void>;
  removeAdsProduct(): StoreProduct | null;
  /** @returns true if the entitlement is now owned. */
  buyRemoveAds(): Promise<boolean>;
  /** @returns true/false when authoritative, null when the store did not answer. */
  restore(): Promise<boolean | null>;
}
```
`src/systems/Iap.ts:26,33`

```ts
export const Iap: IapService = new StoreKitIapService();   // Iap.ts:197
const PRODUCT_ID = monetization.products.removeAds;         // Iap.ts:44
```

The export is typed as `IapService`, not as the class — the scenes are written against
`available` / `removeAdsProduct` / `buyRemoveAds` / `restore` and know nothing about
StoreKit (`Iap.ts:10-13`). Swapping in a different backend is a one-line change here.

### `StoreKitIapService` — `Iap.ts:46`

| Member | Line | Behaviour |
|---|---|---|
| `get available()` | 55 | `return Capacitor.isNativePlatform();` — **not** gated on having contacted the store |
| `init()` | 62 | Deliberate no-op (`/* no-op */`) — see BootScene rationale below |
| `private connect()` | 83 | Opens the store ONCE, lazily, on the first buy or restore |
| `removeAdsProduct()` | 157 | `null` when not native; otherwise the cached product, or a placeholder `{ id: PRODUCT_ID, title: 'Remove ads', description: '', priceString: '' }` |
| `buyRemoveAds()` | 163 | `connect()`, `offer.order()`, then **read the entitlement back** — a cancel and a failure look identical from `order()` |
| `restore()` | 180 | `connect()`, `store.restorePurchases()`; **`null` if it errored** |
| `private grant()` | 192 | `if (!Progress.data.adsRemoved) Progress.setAdsRemoved(true)` |

**The `null` protocol is the important part.** A transient store failure returns `null`
("not authoritative") rather than `false`, so a network blip can never silently downgrade
someone who bought the thing (`Iap.ts:6-9`, `Iap.ts:185`).

```ts
/**
 * Apply whatever the store says WITHOUT ever downgrading a local entitlement on
 * a non-authoritative answer. Owning something is sticky; not knowing is not
 * the same as not owning.
 */
export function applyEntitlement(storeSays: boolean | null): void {
  if (storeSays === true) Progress.setAdsRemoved(true);
}
```
`src/systems/Iap.ts:204` — one branch, no `else`. `false` and `null` are both no-ops.
Called from `MenuScene.restore()` (`MenuScene.ts:210`).

### What `connect()` does, in order — `Iap.ts:83`

1. `if (this.ready) return true;` / `if (!Capacitor.isNativePlatform()) return false;`
2. `store.verbosity = LogLevel.WARNING`
3. `store.register([{ id: PRODUCT_ID, type: ProductType.NON_CONSUMABLE, platform: Platform.APPLE_APPSTORE }])`
4. Wire handlers **before** `initialize()`:
   `.approved(t => { this.grant(); void t.finish(); }).verified(r => void r.finish())`
5. `await store.initialize([{ platform: Platform.APPLE_APPSTORE, options: { needAppReceipt: false } }])`
6. Cache the product with the **localised** price:
   `priceString: offer?.pricingPhases?.[0]?.price ?? ''`
7. `if (p && store.owned({...})) this.grant();`
8. `this.ready = true` (any throw ⇒ `ready = false`, return `false`)

Two things here are bug fixes, not preferences:

- **`finish()` is not optional.** An unfinished transaction is re-delivered by StoreKit on
  every launch, so the player keeps being shown a purchase they already completed.
  Granting inside `approved` rather than only inside `buyRemoveAds` is what makes a
  purchase that completes after the app was killed mid-flow still land on the next start
  (`Iap.ts:95-103`).
- **`needAppReceipt: false`.** The Apple adapter verifies the app receipt on startup by
  default; on a fresh install there is no receipt, so StoreKit asks the user to sign in to
  their Apple Account. Verified on a clean simulator: a login dialog over the home screen
  on cold launch, before the player had touched anything. The receipt only buys
  first-download analytics, side-load resistance and intro-price eligibility — this app
  wants none of the three (`Iap.ts:112-126`, `SUBMIT.md:99-102`).

There is **no receipt-validation server**; an approved transaction is finished locally.
For a single non-consumable that is the accepted trade — Apple has already authenticated
the purchase, and a validator would only add protection against a jailbroken device faking
a $0.99 unlock (`Iap.ts:15-18`).

### Why `init()` is a no-op, and why nothing restores at launch

`BootScene.ts:34-52` calls `Ads.init()` and `Iap.init()`; the latter does nothing on
purpose. A restore reaches StoreKit, StoreKit needs an Apple Account, and on a signed-out
device it puts a "Sign in to Apple Account" dialog over the app before the player has
touched anything — and it **reappears after Cancel**. A repeating login wall on first run
of a free game, for a purchase nobody asked for. Apple's own guidance says the same:
restoring is a user-initiated action, never automatic.

The cost: a reinstalling owner sees ads until they tap "Restore purchases", which is what
that button is for.

### Purchase surfaces in MenuScene

```ts
const selling = Iap.available && !save.adsRemoved;   // MenuScene.ts:76
```

`selling` drives the whole layout, not just visibility:

| Effect | Line |
|---|---|
| `rowGap = selling ? pt(7) : pt(11)`; `cursorY = selling ? pt(325) : pt(355)` | 77-80 |
| Reveal chip is rendered ONLY when `!selling` — it gives up its slot | 129-131 |
| "Remove ads[· price]" row `pt(44)` and "Restore purchases" row `pt(34)` appended | 133-154 |

The layout is derived from the row count because five rows plus the chip runs past the
banner line and off the bottom of the canvas — that is how "Restore purchases" once got
drawn half off-screen, and how the invisible "Remove ads" hit box once sat over the bottom
38 px of the live Gallery button (`MenuScene.ts:118-128`).

Purchase and restore handlers:

```ts
private async purchase(): Promise<void> {          // MenuScene.ts:198
  Haptics.tap();
  const owned = await Iap.buyRemoveAds();
  if (!owned) return;
  Progress.setAdsRemoved(true);
  Ads.setAdsRemoved(true);
  this.scene.restart();
}

private async restore(): Promise<void> {           // MenuScene.ts:207
  Haptics.tap();
  const result = await Iap.restore();
  applyEntitlement(result);
  if (result === true) {
    Ads.setAdsRemoved(true);
    this.scene.restart();
  }
}
```

`Ads.setAdsRemoved(true)` immediately calls `hideBanner()` (`Ads.ts:59`), so the banner
disappears in the same frame the purchase lands. `scene.restart()` re-runs `create()`, so
`selling` flips false and the reveal chip reclaims its slot reading "unlimited reveals".

### Current shipping state

`Iap.available === Capacitor.isNativePlatform()` — on device, the purchase rows **are**
shown, with a placeholder title and an empty price until `connect()` has run. Per
`SUBMIT.md:90-106`, the product is `READY_TO_SUBMIT` in all 175 territories and the code
is in build 11 (`SUBMIT.md:22,74`), but **no sandbox purchase has ever been completed**
(`SUBMIT.md:104-106`) — buy / restore / no-repeat-prompt are untested paths.

---

## 8. The cordova-plugin-purchase patch

File: `patches/cordova-plugin-purchase+13.18.0.patch` (27 lines).
Applied by `patch-package` via the `postinstall` script in `package.json`
(`"postinstall": "patch-package"`, `patch-package@^8.0.1` in `devDependencies`).
Target: `node_modules/cordova-plugin-purchase/src/ios/InAppPurchase.m`, inside
`-pluginInitialize`.

**The change is one deletion:**

```diff
-    [self _ensureInitialized];
+    // FOLDWING PATCH: do not touch StoreKit at app launch.
+    …
+    NSLog(@"[CdvPurchase.AppleAppStore.objc] Deferring init until setup: (Foldwing patch).");
```

Why: `_ensureInitialized` calls `[[SKPaymentQueue defaultQueue] addTransactionObserver:self]`
(`node_modules/cordova-plugin-purchase/src/ios/InAppPurchase.m:268`). That makes StoreKit
attach a storefront listener, which needs an Apple Account. On a signed-out device it puts
a "Sign in to Apple Account" dialog over the app before the user has touched anything,
and it **reappears after Cancel**.

Why it is safe: `_ensureInitialized` is idempotent (`g_lazyInitialized` guard, line 262)
and is still invoked from `-setup:` (line 343), which is what the JS
`store.initialize()` call reaches. Foldwing calls `store.initialize()` only from
`connect()` (`Iap.ts:127`), i.e. only when the player opens the purchase or restore flow.
The plugin already supports this lazy path — it is the route used when the SK2 Swift
plugin is detected and SK1 stands down — so the patch changes the *trigger*, not the
behaviour.

**Deployment chain — three steps, all required:**

```text
npm install            → postinstall → patch-package rewrites node_modules/…/InAppPurchase.m
npm run ios:sync       → npx cap sync ios → copies it to
                         ios/capacitor-cordova-ios-plugins/sources/CordovaPluginPurchase/InAppPurchase.m
xcodebuild / fastlane  → the patched .m is compiled into the app
```

The synced copy currently carries the patch (verified: `FOLDWING PATCH` at
`ios/capacitor-cordova-ios-plugins/sources/CordovaPluginPurchase/InAppPurchase.m:291`).
A fresh `npm install` without a following `cap sync` leaves the *old* file in the iOS
project — the launch dialog would come back with no visible change to `src/`.

---

## 9. No purchase can change what kills you — verified

**Claim:** nothing in the collision path reads `InkTheme`, so no skin, ink pack or
purchase can move the kill boundary.

**Verification performed for this document:**

```text
$ grep -rn "InkTheme" src --include="*.ts"
src/render/InkRenderer.ts:23,86   (type-only import; `function veil(ink: number, t: InkTheme)`)
src/render/Theme.ts:6,10,46,71,88,92,94   (doc comment, definition, palette, registry, accessor)
src/render/Theme.test.ts:85    (comment inside the pinning test)
```

`InkTheme` appears in exactly two runtime files, both under `src/render/`.
`src/core/CollisionSystem.ts` has a single import block (`CollisionSystem.ts:16-22`) and
it imports `mirrorPoint, segRect, segRectEntryT, type Rect, type Vec2` from `./Geometry`
— nothing from `../render/Theme`, no `theme()` call anywhere in the file.

Structural reason (`Theme.ts:4-12`): the file deliberately keeps two objects apart.
`InkTheme` is everything a cosmetic may change (paper, ink, nib width, opacities);
`METRICS` is everything that decides whether a stroke lives or dies. `METRICS.hitRadius`
= `pt(2.6)` (`Theme.ts:125`) is **LOCKED** and sits outside `InkTheme`.

**Pinned by:** `keeps collision forgiveness out of the cosmetic theme`,
`src/render/Theme.test.ts:84`:

```ts
it('keeps collision forgiveness out of the cosmetic theme', () => {
  // hitRadius must never migrate into InkTheme: a purchasable skin that moved
  // the kill boundary would be pay-to-win.
  expect(Object.keys(theme())).not.toContain('hitRadius');
  expect(METRICS.hitRadius).toBeGreaterThan(0);
});
```

Sibling pins in the same file: `ships 2.6pt of collision inside a 5pt nib`
(`Theme.test.ts:66`) and `places the kill boundary 0.2 base px outside the visible ink`
(`Theme.test.ts:79`).

One consequence to know before shipping a wide cosmetic nib (`Theme.ts:14-17`): collision
is measured from the centreline, so a fatter stroke survives nothing a thin one would not
— it merely renders ink over a wall it has legally cleared. Identical mechanics, worse
readability. Keep cosmetic nibs near 5pt.

The only thing `adsRemoved` changes in gameplay is the reveal stash becoming infinite
(`Progress.ts:220-236`). It touches no wall, no radius, no level.

---

## 10. Go-live checklist

Ordered, with the exact file and line for each edit.

**Code / build**

| # | Action | Location |
|---|---|---|
| 1 | Confirm `useTestAds: false` | `src/config/monetization.ts:105` |
| 2 | Confirm `GADApplicationIdentifier` = `ca-app-pub-3307486877162157~5033197766` | `ios/App/App/Info.plist:63-64` |
| 3 | `npm test` — must be green. The pin at `monetization.test.ts:45` fails if 1 and 2 disagree. **It cannot catch both being left on TEST** (`SUBMIT.md:86-88`) — check line 105 by eye. |  |
| 4 | Bump `CFBundleVersion` | `ios/App/App/Info.plist:21-22` (currently `11`) |
| 5 | `npm run ios:sync` — web build + `cap sync`. Forgetting it ships the *previous* build's UI inside a new binary (`SUBMIT.md:115-116`). Also the only thing that carries the purchase patch into the Xcode project (§8). | |
| 6 | `set -a; source .env.appstore; set +a` then `fastlane beta` | `SUBMIT.md:110-113` |
| 7 | If Apple's uploader 500s after a successful archive: `fastlane beta_upload` (re-sends the existing ipa instead of burning a build number) | `SUBMIT.md:125-126` |

**Verify on device before submitting** (`SUBMIT.md:55-65`) — none of this has been done:

- Sandbox Apple ID: buy → confirm ads stop → delete → reinstall → **Restore purchases** →
  relaunch twice. App Review tests IAP; a failure there is a rejection and a lost cycle.
- Cold-launch on a device signed OUT of the App Store: **no Apple Account dialog** should
  appear. That is the §8 patch and `needAppReceipt: false` working.

**App Store Connect — web UI only, in this order** (`SUBMIT.md:24-53`).
App id `6794804195`, bundle `com.noqyris.foldwing`, team `YMN45WC2QR`:

1. **Pricing → Free.** `appPriceSchedule` returns 404; a free app still needs an explicit
   price schedule. Hard submission blocker.
2. **Availability → all territories.** `appAvailabilityV2` also 404s. The IAP already has
   all 175; the app itself has none. Hard blocker.
3. **App Privacy** — must match the AdMob-driven reality or review bounces it:
   - Identifiers → Device ID · Third-Party Advertising · Not linked · **Used for tracking**
   - Usage Data → Product Interaction · Third-Party Advertising · Not linked · **Used for tracking**
   Nothing else. Foldwing has no server and no account; every one of those answers
   describes Google AdMob, which is why the privacy policy names AdMob explicitly.
4. **Submit.** Build attached, release type MANUAL. Export compliance: no non-exempt
   encryption (already declared by `ITSAppUsesNonExemptEncryption = false`,
   `Info.plist:50-51`).

**After 1.0 is public** (`SUBMIT.md:145-155`):

- Add the store link in the AdMob console to lift "Requires review / Limited ad serving".
  Until then live units return no-fill — every ad path treats that as a silent no-op and
  leaves the cadence counter armed, so nothing breaks; there is simply nothing to show.
- `app-ads.txt` at `noqyris.com` is live; AdMob finds it via the **marketing URL** on the
  store listing, which is why that field must stay populated.
- **Never tap your own live ads.** Invalid traffic is the most common way to lose an AdMob
  account, and the build carries live units on TestFlight too.

**Android:** `LIVE_ANDROID` is all empty strings (`monetization.ts:83`), so
`adsConfigured()` returns `false` on Android and the entire ad layer no-ops. Filling that
table in is a prerequisite for any Android release.

---

## 11. Known rough edges in this code

Not bugs that break the game — every one is contained by the swallow-all-errors rule —
but they are the things a reader would otherwise waste time re-deriving.

| Observation | Location |
|---|---|
| `once()` registers plugin listeners and never removes them; each interstitial/rewarded show leaks one listener per event name for the process lifetime. | `Ads.ts:285-298` |
| `showRewarded` adds a fresh `Rewarded` listener per call and never removes it; stale closures still fire and set dead `earned` flags. Harmless, but listener count grows with rewarded views. | `Ads.ts:265` |
| `sessionWarmupSeconds` is measured from the end of `init()`, not from process start, because `sessionStartedAt` is re-stamped there. A slow SDK init pushes the first possible ad later. | `Ads.ts:51,102,166` |
| A post-win ad resets both `winsSinceAd` and `attemptsSinceAd`; a retry ad resets only `attemptsSinceAd`. Neither the source nor the tests state why. | `GameScene.ts:406` vs `451` |
| Daily top-up uses UTC dates and only fires inside `load()`. | `Progress.ts:245,153` |
| A fresh player sees 3 reveals, not `startingStash: 2`. | `Progress.ts:77,153,244` |
| The `placement` argument to `showRewarded` is discarded (`void placement`). | `Ads.ts:279` |
| `MenuScene.ts:161` comments "the banner lives here and on level select", but `LevelSelectScene` never calls `showBanner()`. Behaviourally correct anyway — the native banner is never hidden, so it persists across scenes. | `MenuScene.ts:161`, grep of `showBanner` |

---

## See also

- [00-index.md](00-index.md) — documentation map
- [01-architecture.md](01-architecture.md) — where `systems/` sits relative to `core/` and `render/`
- [02-coordinate-system.md](02-coordinate-system.md) — normalized space, `BASE_WIDTH`/`BASE_HEIGHT`, and the inset
- [03-geometry-collision.md](03-geometry-collision.md) — `CollisionSystem`, `hitRadius`, and why §9 holds
- [05-rendering.md](05-rendering.md) — `InkRenderer.showReveal`, `METRICS`, `InkTheme` vs `Metrics`
- [06-scenes.md](06-scenes.md) — BootScene/MenuScene/GameScene call sites for every symbol above
- [09-systems.md](09-systems.md) — `Progress`, `Rate`, `Haptics`, `Audio`, `Share`
- [11-build-release.md](11-build-release.md) — `ios:sync`, fastlane, signing, patch-package
- [12-testing.md](12-testing.md) — the suite as a gate, and which invariants are pinned where
- [13-api-reference.md](13-api-reference.md) — full exported-symbol index
- [14-glossary.md](14-glossary.md) — reveal, fold, figure, band
- [15-change-recipes.md](15-change-recipes.md) — safe edits and the ones that need a LOCKED-value decision
- [../README.md](../README.md) — narrative rationale for the four placements (§"Where the money is, and where it deliberately isn't", lines 218-251)
- [../SUBMIT.md](../SUBMIT.md) — the live submission state, ad-unit table, and hand-only App Store Connect steps
