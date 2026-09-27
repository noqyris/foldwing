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
> **The ad network changed too.** Google closed the owner's AdMob publisher
> account on 2026-08-18, and in September 2026 Foldwing moved to **Unity
> LevelPlay**. The cadence policy in §5 survived unchanged. Everything that was
> AdMob-specific — the `useTestAds` flag, the unit tables and the plist test
> (§2–§3), the AdMob calls in §4–§5 and the go-live checklist (§10) — has been
> rewritten for LevelPlay below. The ad layer now lives in `src/systems/Ads.ts`
> (policy), `src/systems/adProvider.ts` (the provider contract and build-mode
> markers) and `src/systems/providers/levelplay.ts` / `mock.ts`.
>
> **And the store and the economy changed in 1.4 (September 2026).** The menu's
> selling foot and its one-product purchase rows are gone: every screen sells
> through one Store sheet (`src/render/StoreSheet.ts`, §7), the one product that
> was never sold (`reveals25`) is now a one-time starter pack at $0.99, reveals
> also arrive from daily missions, chapter marks and streak milestones (§6),
> ad-paid reveals are capped at five a local day (§5.4), and the browser's mock
> build sells through a fake store that the release gate keeps out of every
> other bundle (§7). §1, §5.4, §6 and §7 are rewritten for 1.4. The rules behind
> the non-money faucets — missions, bookmarks, the streak repair, chapter marks —
> are in [09-systems.md](09-systems.md) §6. Ads, the cadence and `Ads.ts` did not
> change.

---

# Monetization: Ads, IAP, and the Gating Rules

## What this covers

Every code path where money touches Foldwing: the `monetization` config object and its
ad-unit resolution, the ad placements with their exact gates, the reveal currency and
the economy around it, the StoreKit purchase surface and the store sheet that sells
through it, the fake store of the mock build, the native `cordova-plugin-purchase`
patch, and the go-live checklist. Cadence policy lives in `src/config/monetization.ts`
and `src/systems/Ads.ts` only — no scene decides when an ad may fire.

## Source files

| Path | Lines | Role |
|---|---|---|
| `src/config/monetization.ts` | — | The single config object: products, cadence, reveals, the economy; `sellableLadder`, `bestValueId`, `starterWorthShowing`. No ad ids any more |
| `src/config/monetization.test.ts` | — | Pins the cadence arithmetic, the economy's sums, the ladder fixtures and the native project's ad-free-of-Google state |
| `src/systems/Ads.ts` | — | `AdsService` singleton: the cadence gates, banner, interstitial, rewarded — network-agnostic |
| `src/core/Session.ts` | — | What counts as a session, pure: a return after ≥ 30 min or into a new local day (§5.0, "What counts as a session") |
| `src/systems/SessionLifecycle.ts` | — | The app's one session service, and `whenAdLayerMayStart` — the starter gate every route into the ad layer waits for (film gone, app active) |
| `src/systems/SessionClock.ts` | — | The session's AGE in foreground time, for the warm-up and the long-session floor; decides no new session |
| `src/systems/adProvider.ts` | — | The `AdProvider` contract, `adsOff()`, and the `ADS:on/off/mock` marker |
| `src/systems/providers/levelplay.ts` | — | Unity LevelPlay: app key and unit ids, consent → SDK start, prefetch, reward race, `ADMODE` marker |
| `src/systems/providers/mock.ts` | — | Fake ads drawn in the page for `VITE_ADS=mock` — no network |
| `src/systems/Iap.ts` | — | `IapService`, `StoreKitIapService`, `creditPurchase()` (the one delivery path), `applyEntitlement()`; picks the fake store in a browser mock build |
| `src/systems/iapMock.ts` | — | The FAKE store the browser's mock build sells through — never on a phone, refused by the gate in every other bundle |
| `src/render/StoreSheet.ts` | — | Store v2: which rows are sold, their order and wording, purchase / restore / rewarded flows, the card |
| `src/systems/Progress.ts` | — | Persists `adsRemoved`, `reveals`, the cadence counters, the rewarded cap and the credited transaction ids; every grant goes through it and out through `onGrant` |
| `src/core/Rescue.ts` | — | The three-death / six-death rescue ladder, and where its pills are drawn |
| `src/systems/Rate.ts` | — | Review prompt; once per version, at a peak; yields to a queued interstitial and to the win card's own ask |
| `src/scenes/GameScene.ts` | — | The interstitial call sites, the reveal pill, the rescue pills, the chapter doubler, the refill sheet |
| `src/scenes/MenuScene.ts` | — | Balance chip with "+", the Store button, Restore in Settings, the banner call |
| `src/render/StreakSheet.ts` | — | The streak repair's rewarded row |
| `src/scenes/BootScene.ts` | — | Entitlement applied before any ad request |
| `src/render/Theme.ts` | 212 | `METRICS.bannerReserve`, `METRICS.inset` — the reserved banner strip |
| `patches/cordova-plugin-purchase+13.18.0.patch` | 27 | Removes the launch-time StoreKit observer |
| `ios/App/App/Info.plist` | — | ATT string, the LevelPlay/Unity SKAdNetwork ids, `LevelPlayCMPProvider = custom` |

---

## 1. The config object, verbatim and annotated

`src/config/monetization.ts` — declared `as const`, so every field is a literal type
and readonly. Comments stripped; the source carries the reasoning for every number.

```ts
export const monetization = {
  products: {
    removeAds: 'com.noqyris.foldwing.removeads',   // $2.99, non-consumable
    revealPacks: [                                 // the ladder, cheapest first
      { id: 'com.noqyris.foldwing.reveals10', count: 10 },   // $0.99
      { id: 'com.noqyris.foldwing.reveals20', count: 20 },   // $1.49
      { id: 'com.noqyris.foldwing.reveals30', count: 30 },   // $1.99
    ],                                             // then Remove Ads at $2.99
  },

  ads: {
    interstitialFromLevel: 8,
    interstitialEveryNWins: 3,
    interstitialEveryNAttempts: 8,
    // The session ladder — see §5.1.
    sessionWarmupSeconds: 180,
    minSecondsBetweenInterstitials: 180,
    longSessionAfterSeconds: 600,
    lateSecondsBetweenInterstitials: 120,
    maxInterstitialsPerSession: 8,
    muteAfterRewardedSeconds: 300,
  },

  reveals: {
    grantedPerRewarded: 1,
    freeDailyTopUp: 1,
    startingStash: 2,
    durationMs: 6000,
    offerRevealAfterAttempts: 3,
    offerSkipAfterAttempts: 6,
  },

  economy: {
    rewardedRevealsPerDay: 5,
    missions: { count: 3, reward: 1, unlockAfterIndex: 5 },
    chapter: { size: 20, halfReward: 1, fullReward: 2 },
    streak: {
      bookmarkMax: 2,
      bookmarkAt: [3],
      bookmarkEvery: 7,
      guardMinRun: 2,
      overflowReveals: 1,
      milestones: { 7: 2, 14: 3, 30: 5, 50: 5, 100: 10 },
      everyFiftyAfter100: 5,
    },
    repair: { maxGapDays: 1, cooldownDays: 14, minRun: 2 },
    starter: { id: 'com.noqyris.foldwing.reveals25', count: 25, afterWins: 5 },
  },

  ui: { winFrameScale: 0.74, winFrameScaleDaily: 0.7 },
} as const;
```

The `rate` block is gone. The review prompt's numbers are not money, and since 1.4
they live beside the rule that reads them, as `RATE_RULES` in `src/systems/Rate.ts`
(see [09-systems.md](09-systems.md) §5).

| Field | Line | Value | Read by | Meaning / trap |
|---|---|---|---|---|
| `products.removeAds` | — | `'com.noqyris.foldwing.removeads'` | `Iap.ts` | Non-consumable, $2.99. Also the App Store Connect IAP id. Its second line in the store says what it buys: "no ads, unlimited reveals & skips". |
| `products.revealPacks` | — | 10 / 20 / 30 | `Iap.ts`, `sellableLadder` | Consumables at $0.99 / $1.49 / $1.99. The count is in the id because an id is permanent. A rung that another rung dominates in the local currency is not drawn — see §7. |
| `ads.interstitialFromLevel` | 117 | `8` | `Ads.timingAllows` (`Ads.ts:162`) | Compared against the **0-based** `levelIndex`. Level index 8 is displayed as "9." (`GameScene.ts:666`). No interstitial on the first eight levels. |
| `ads.interstitialEveryNWins` | 119 | `3` | `Ads.wouldShowInterstitial` (`Ads.ts:178`) | Post-win path only. Compared against `Progress.data.winsSinceAd`. |
| `ads.interstitialEveryNAttempts` | — | `8` | `Ads.wouldShowOnAttempt` | HALF a gate. Compared against `Progress.data.attemptsSinceAd`. Useless alone — see §5.2. Sits BEYOND the rescue ladder (skip fires at 6) so the rewarded offer, worth ~3× an interstitial, wins the difficulty spike. |
| `ads.sessionWarmupSeconds` | — | `180` | `Ads.timingAllows` | Rewarded only while the session is this young. Measured in FOREGROUND time by `SessionClock` (`src/systems/SessionClock.ts`): a locked phone warms nobody up. The clock restarts at the END of `init()`, success or failure, not at process start. |
| `ads.minSecondsBetweenInterstitials` | — | `180` | `Ads.gapSeconds` | The early floor since `lastInterstitialAt`, applied to BOTH entry points. |
| `ads.longSessionAfterSeconds` | — | `600` | `Ads.gapSeconds` | Past this much foreground time in a session the floor drops to the value below. Time in the background does not bring it closer. |
| `ads.lateSecondsBetweenInterstitials` | — | `120` | `Ads.gapSeconds` | The late floor. Must never exceed the early one — pinned by a test. |
| `ads.maxInterstitialsPerSession` | — | `8` | `Ads.timingAllows` | A backstop, not the pacing mechanism. Counter only increments when an ad actually rendered. |
| ~~`ads.newSessionAfterAwaySeconds`~~ | — | removed 2026-09-27 | — | What a session is is not a knob: the app's one rule is `core/Session` (`SESSION_GAP_MS`, 30 min, plus the new-day clause). See §5.0, "What counts as a session". |
| `ads.muteAfterRewardedSeconds` | 147 | `300` | `Ads.showRewarded` (`Ads.ts:274`) | Sets `mutedUntil = Date.now() + 300_000` — only when `earned` is true. |
| `reveals.grantedPerRewarded` | — | `1` | `StoreSheet.earnReveal`, `GameScene` (the three-death offer) | Paid through `Progress.payAdReveals`, on `'earned'` only, and counted against the daily cap. |
| `reveals.freeDailyTopUp` | — | `1` | `Progress.applyDailyTopUp` | On the first `load()` or foreground of each LOCAL day (main.ts calls it on every return to the foreground). |
| `reveals.startingStash` | — | `2` | `freshSave()` | See the off-by-one in §6: a genuinely new player launches with **3**, not 2. |
| `reveals.durationMs` | — | `6000` | `GameScene` → `InkRenderer.showReveal` | Hold time only; on-screen total is 220 + 6000 + 420 ms. |
| `reveals.offerRevealAfterAttempts` | — | `3` | `GameScene` → `Rescue.rescueOffer` | Deaths on the level before the reveal offer. |
| `reveals.offerSkipAfterAttempts` | — | `6` | `GameScene` → `Rescue.rescueOffer` | Deaths before the skip. Compared against `this.attempts`, a per-level-load counter, NOT `attemptsSinceAd`. A player who can still reveal and has not on this level waits until 9 — see §5.4. |
| `economy.rewardedRevealsPerDay` | — | `5` | `Progress.canAdPay` / `payAdReveals` | Ad-paid reveals per local day, across every placement that pays reveals. The skip and the repair are rescues and are not counted. |
| `economy.missions` | — | `{ 3, 1, 5 }` | `Progress.missionsToday`, `settleWin` | Three a day, +1 reveal each, paid on completion. Open from `unlockedIndex ≥ 5` with the Daily unlocked. |
| `economy.chapter` | — | `{ 20, 1, 2 }` | `Progress.settleChapterMarks`, `settleWin` | +1 at 10 cleared in a chapter, +2 at 20. Skipped levels count toward neither. |
| `economy.streak` | — | see above | `core/Streak.ts` through Progress | Bookmarks (hold 2, earn one at day 3 and every 7th day) and milestone reveals. |
| `economy.repair` | — | `{ 1, 14, 2 }` | `Progress.repairableDay` / `repairStreak` | One missed day, a run of 2 or more before it, 14 days between repairs. |
| `economy.starter` | — | `reveals25`, 25, after 5 wins | `Iap.ts`, `StoreSheet` | The one-time starter pack. Not in `revealPacks`, so it never becomes a rung. |
| `ui.winFrameScale` / `winFrameScaleDaily` | — | `0.74` / `0.7` | `GameScene.presentResult` | How far the board steps back behind the win card. `1` turns the move off. |

**`useTestAds` is gone.** It chose between Google's test units and live ones, and
LevelPlay has no such pair. The ad mode is now decided at build time by two
environment variables and baked into the bundle as markers — see §2.

---

## 2. LevelPlay: the app, the units, and the build modes

### Identifiers

Everything lives in `src/systems/providers/levelplay.ts` (`APP_KEYS`,
`UNITS_BY_PLATFORM`), resolved at call time so tests can vary the platform.

| Platform | App key | Banner | Interstitial | Rewarded |
|---|---|---|---|---|
| iOS | `282ab31c5` | `h0a7k5pjpr3ziohk` | `w4ocqufvnz4i9mbt` | `e5mt76phyqseoqpa` |
| Android | `''` | `''` | `''` | `''` |

- **There is no Android app in LevelPlay** (and no `android/` folder). An empty key
  makes every ad path a clean no-op on that platform; never borrow the iOS ids.
- **The demand behind the units is Unity Ads**, wired on the dashboard only: Game
  ID `800374852`, placements `BP_Banner_iOS` / `BP_Interstitial_iOS` /
  `BP_Rewarded_iOS`, each added as an *instance* on its LevelPlay unit. None of
  those names belong in code.
- **The same ids ship in every build.** LevelPlay has no test/live id pair, so
  grepping ids proves nothing about which build is which — that is what the
  markers below are for.

### No test inventory

`VITE_AD_MODE !== 'live'` makes a build `ADMODE:test`, and the only thing test
mode does is pass `isTesting`, which unlocks the LevelPlay **Test Suite**. It does
not select test creatives: every build with the ad layer on serves the **real
waterfall**. So there is no "test ads" build to hand a tester, no TEST ADS badge
(`Ads.isTestAds` / the provider's `testing` are hard-wired `false`), and no build
of Foldwing in which tapping — or deliberately watching — an ad is safe.

### Build modes and markers

The bundle carries two literals, each exactly once, which the release gates count:

| Build | `VITE_AD_MODE` | `VITE_ADS` | Markers | What happens | Where it may go |
|---|---|---|---|---|---|
| live | `live` | — | `ADMODE:live` `ADS:on` | Real ads | App Store only (`npm run ios:appstore`) |
| ads-off | `test` (pinned) | `off` | `ADMODE:test` `ADS:off` | The ad layer never initialises: no consent prompt, no SDK, no banner; rewarded placements grant for free | TestFlight — every TestFlight build (`npm run ios:sync:adsoff`) |
| mock | `test` (pinned by `ios:sync:mock` / `build:mock`) | `mock` | `ADMODE:test` `ADS:mock` | `providers/mock.ts` draws fake banner, interstitial and rewarded ads in the page; no network. In a browser it also sells through the fake store (§7); on a phone it uses the real StoreKit sandbox | This machine: `npm run dev:mock`, `npm run ios:sync:mock`; TestFlight on the owner's request (`fastlane beta_mock`). Never the store |
| test | — | — | `ADMODE:test` `ADS:on` | Real waterfall plus the Test Suite | Xcode Run only; no lane archives it |

The provider is chosen inline (`VITE_ADS === 'mock' ? mock : levelplay`) so Vite
tree-shakes the mock out of every other build.

### Consent before the SDK

LevelPlay must not start before consent. `providers/levelplay.ts` runs, in order:
the ATT prompt, then the plugin's own consent modal (`consentProvider: "custom"`
in `package.json`, patched at install by `scripts/patch-levelplay-consent.mjs`
so a decline is not read back as consent), then `getConsentData()`. **Only
`GRANTED` starts the SDK.** Declined or unknown means no SDK and therefore no ads
of any kind — `Ads.rewardedAvailable` goes false, so no "Watch an ad" row is
drawn. A later `GRANTED` (from Settings → Privacy choices) starts it then. CCPA
and child-directed flags are set before `initialize()`; the app is general
audience (`CHILD_DIRECTED = false`, matching the dashboard's COPPA setting).

---

## 3. What replaced the plist test

The AdMob-era test (`keeps the native app id in step with useTestAds`) compared a
native app id with a TypeScript flag. LevelPlay reads no app id from the plist, so
that pair no longer exists and the test went with it. What guards the ad setup
now:

| Guard | Where | Proves |
|---|---|---|
| `scripts/check-ad-mode.mjs <target>` | every build/sync chain | exact `ADMODE`/`ADS` marker counts for the target; no Test Suite or ad-id capture bundle; **`FAKE PURCHASE` only in mock** — the fake store's sheet title (matched as `/FAKE\s+PURCHASE/i`, whatever the markers say) fails `live`, `off` and `test` |
| `scripts/check-no-google.mjs` | every sync chain, `fastlane build_ipa` | no AdMob plugin, pod, `GADApplicationIdentifier`, Google SKAdNetwork id (`cstr6suwn9`), AdMob id, or the terminated publisher id — anywhere, docs included |
| `scripts/check-native-sync.mjs ios <target>` | after every `cap sync` + `pod install`, `fastlane build_ipa` | the synced bundle is `dist/`; the same fake-store refusal on it for every target but mock; `Podfile.lock` resolves LevelPlay and every adapter from the current Podfile; the UIScene manifest is in `Info.plist` (see [11-build-release.md](11-build-release.md)) |
| `fastlane build_ipa` binary check | after archiving | `LPMInitRequestBuilder` and `ISUnityAdsAdapter` are in the binary; the plugin's no-op branch is not |
| `src/config/monetization.test.ts` | `npm test` | the native project carries no AdMob key or id; ATT string present |
| `src/systems/providers/levelplay.test.ts`, `adProvider.test.ts`, `adsMock.test.ts` | `npm test` | consent ordering, the badge never lighting, the reward race, prefetch, marker literals |

The cadence pins listed below are unchanged:

| Test | Asserts |
|---|---|
| `protects onboarding` | `interstitialFromLevel >= 6` |
| `keeps interstitials rare and spaced` | `everyNWins >= 3`, both floors `>= 120`, `warmup >= 120` |
| `gets no stricter with time, only more permissive` | `lateSeconds <= minSeconds`, `longSessionAfter > warmup` |
| `caps above what the time floors alone would allow` | the cap is a backstop, not the pacing mechanism |
| `cannot fire on retries faster than the time floor allows` | see §5.2 |
| `stops taxing someone who just watched a rewarded ad` | `muteAfterRewardedSeconds >= 180` |
| `only offers a skip once the level has really resisted` | `offerSkipAfterAttempts >= 5` |

And since 1.4 the economy is pinned the same way, as sums rather than as literals:

| Test | Asserts |
|---|---|
| `gives an engaged player less in a day than the smallest pack holds` | daily top-up + every mission's reward ≤ 4, and < the 10-pack |
| `caps ad-paid reveals at a daily number that keeps the packs worth buying` | `3 ≤ rewardedRevealsPerDay ≤ 10` |
| `pays a chapter no more than five` | `halfReward + fullReward ≤ 5` |
| `pays at most twelve milestone reveals in the first month of a streak` | the table's first 30 days ≤ 12; at the bookmark cap, ≤ 15 with the overflow reveals |
| `sells the starter as reveals25, once, off the ladder` | the starter id ends in `.reveals25`, matches its count and is not a rung |
| `the sellable ladder`, `the starter offer` | USD keeps 10/20/30 and badges the 30; Serbia drops the 20, the UK the 10; nothing is judged before prices arrive; the starter shows only where it is cheaper per reveal than every rung on sale |

---

## 4. AdsService: API and lifecycle

Singleton export: `export const Ads = new AdsService();` — `src/systems/Ads.ts`.
The class itself is not exported; there is one instance for the process.

> The signatures and line numbers in this section describe the AdMob-era class.
> The public API was kept through the LevelPlay rewrite so no call site changed,
> but `showRewarded(placement, stillWanted?)` now returns `'earned' | 'declined' |
> 'unavailable' | 'abandoned'`, `showInterstitial(stillWanted?)` asks its caller
> again once the ad has loaded, and the class gained `foregrounded()` (retry a
> failed SDK start on return to the foreground), `openPrivacyOptions()` (Settings →
> Privacy choices), `busy` (an ad is loading or on screen) and the read-only
> `isTestAds` (always `false`). Read the source for the current shape.

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
`adsRemoved` on purpose.** Since 1.4 the callers decide instead: no screen offers an
owner a rewarded ad, and the rescues an ad used to buy are free for them (§5.4).

### Internal state

| Field | Line | Initial | Notes |
|---|---|---|---|
| `ready` | 27 | `false` | AdMob era: set after `AdMob.initialize()`. Now: the provider reports the SDK up only after consent was `GRANTED` and `initialize()` resolved |
| `adsRemoved` | 28 | `false` | Mirrors `Progress.data.adsRemoved`; pushed in from BootScene/MenuScene |
| `bannerShown` | 29 | `false` | |
| `bannerWanted` | 39 | `false` | Replay flag — see below |
| `personalized` | 49 | `false` | **Removed.** AdMob's `npa` flag has no LevelPlay equivalent: no consent means no SDK at all |
| `session` | — | a `SessionClock`, started in the constructor | The session's age in foreground time. Restarted at the end of `init()`; paused while `document.hidden`; back to zero on every new session (`newSession()`, heard from `SessionLifecycle`). Replaced `sessionStartedAt`, whose wall-clock age counted a locked phone as play |
| `lastInterstitialAt` | 52 | `0` | So the very first eligible moment passes the floor |
| `mutedUntil` | 53 | `0` | |
| `interstitialsThisSession` | 54 | `0` | |
| `inFlight` | 55 | `false` | Shared by interstitial AND rewarded — one full-screen ad at a time |

### `init()` sequence

```text
main.ts, once the saved entitlement is known
  └ Ads.init()   (not awaited; only the first call does anything)
       1 guard: !adsSupported() || !configured() || already started → return
         (adsSupported() is false on the web and in an ADS:off build)
       1a await whenAdLayerMayStart(): the opening film gone, THEN the app ACTIVE
         (SessionLifecycle — the ATT trap; the consent ceiling is armed only after)
       2 provider.init():
           a ATT prompt (requestTrackingAuthorization), with its own ceiling
           b the plugin's consent modal (requestConsent), with a longer ceiling
           c getConsentData() → only GRANTED continues; anything else returns
             and leaves a watcher that starts the SDK on a later GRANTED
           d CCPA + child-directed flags, then LevelPlay initialize(appKey)
           e prefetch one interstitial and one rewarded
       3 on failure: retry after 30 s / 60 s / 120 s, and on every foreground
       4 SDK up → the session clock restarts at zero (and waits, if the app is
         in the background); replay a banner a scene asked for
```

It moved out of `BootScene` because `BootScene` runs while the opening film is
still playing, and the ATT alert and the consent modal are system dialogs that
would land on top of it.

The **replay** is load-bearing. `MenuScene.create` calls `showBanner()`
(`MenuScene.ts:162`) synchronously, which almost always lands before the SDK is up —
before consent has even been asked; the plugin refuses it. `showBanner` sets `bannerWanted = true` and returns at
`Ads.ts:120`, and `init` fires it again. Remove the replay and the banner appears only
when the network happens to be fast.

**Every method swallows its own errors** (`Ads.ts:8-9`). A no-fill, an offline device, or
a broken creative must never surface in the game loop.

---

## 5. The placements and their exact gates

### 5.0 The shared gate: `timingAllows`

```ts
private timingAllows(levelIndex: number): boolean {
  if (!this.enabled) return false;

  const a = monetization.ads;
  if (levelIndex < a.interstitialFromLevel) return false;
  if (this.interstitialsThisSession >= a.maxInterstitialsPerSession) return false;

  const now = Date.now();
  // Two clocks on purpose. The session's age is time spent PLAYING — a
  // phone locked for twenty minutes has not warmed anyone up. The mute and
  // the floor since the last ad are real elapsed time, and time away
  // counts toward them just the same.
  const sessionSeconds = this.session.ageSeconds(now);
  if (sessionSeconds < a.sessionWarmupSeconds) return false;
  if (now < this.mutedUntil) return false;
  return (now - this.lastInterstitialAt) / 1000 >= this.gapSeconds(sessionSeconds);
}
```

It is split out from the count checks precisely so both entry points share exactly one
definition of "is an interruption allowed at all right now" — a third entry point added
later cannot accidentally skip it.

**THE SESSION LADDER.** `gapSeconds` is not a constant, and the reason is that one
interval cannot serve both ends of a session:

| Where in the session (minutes played) | Interstitials |
|---|---|
| first 3 minutes | none at all — rewarded still works |
| 3 to 10 minutes | at most one every 3 minutes |
| past 10 minutes | at most one every 2 minutes |
| any point | at most 8, and never over a live rewarded offer |
| away < 30 min, same day | the session's age pauses and resumes where it was; the gap since the last ad keeps running |
| away ≥ 30 min, or back on a new local day | a new session: the ladder and the cap start over; the gap since the last ad and the rewarded mute do not |

The model this replaced was a flat 90s warm-up, a flat 120s floor and a cap of four.
That shape front-loaded every ad it would ever show into the first ten minutes and then
went silent for the rest of the session — heaviest exactly where first-session churn
happens, and nothing at all from the players least likely to leave. It is also what
"the ads between levels feel too frequent" described.

Two measured findings drive it. Interstitial frequency is the strongest correlate of
first-session churn in casual puzzle — showing one per level costs 15–25% of players
inside the first session — while rewarded video at a difficulty spike *lifts* retention,
because the player reaches for a free continue instead of quitting. So the opening of a
session sells only the format that helps, and the interstitial waits until someone has
decided to stay.

#### What counts as a session

A **session** is a cold launch, **or** a return from the background after **30 minutes
or more**, **or** a return into a **new local day** (mobile-game-playbook,
`references/monetization.md` → "What counts as a session"; reference implementation
KVIZKO `e9b972d`). The rule is `src/core/Session.ts`, pure; the service is
`src/systems/SessionLifecycle.ts`, driven by `main.ts` (`startColdSession()` at boot,
`noteHidden()` / `noteVisible()` from its `visibilitychange` handler), with the count
persisted under `foldwing.sessions`. The absence is measured from the **first** hide; a
visible with no hide before it is not a pause; a clock set back within the day is not a
pause; a new day always is one. Full reference: [09-systems.md](09-systems.md) §8.

"Session" first meant the lifetime of the process — a phone that sat in a pocket all
afternoon came back with the cap already spent and showed nothing until it was
force-quit. Then `Ads` and `Rate` each got a private 30-minute rule (`SessionClock.show`,
`Rate.watchForNewSession`, the second measured from the LAST hide), neither with the
midnight clause. Since 2026-09-27 there is one rule and both listen to it:

- `Ads.newSession()` resets **only** what is per session: `interstitialsThisSession`
  and the session's foreground age (so the warm-up re-arms). It leaves
  `lastInterstitialAt` (the floor — what keeps an interstitial off a return),
  `mutedUntil`, the save's `winsSinceAd` / `attemptsSinceAd` and the daily rewarded cap
  alone: none of them is per session.
- `Rate` forgets the session's skip and purchase.
- A new session is **not** a new day: the daily top-up, the streak and the missions roll
  over by the calendar, once a day.

**The ATT trap.** `visibilitychange` fires on willEnterForeground, while the app is still
INACTIVE; the splash's 7 s cap and `main.ts`'s 9 s backstop, if they came due in the
background, fire in the same window. ATT requested then shows nothing and answers
`notDetermined`. So `Ads.init()`, `Ads.foregrounded()` (its retry can re-ask ATT via
`levelplay.retryInit → reaskConsent`) and `Ads.openPrivacyOptions()` all wait, inside
`Ads`, for the one starter gate `whenAdLayerMayStart()`: the film gone (`whenIntroDone`),
then the app active (`@capacitor/app` `getState().isActive`, else a one-shot
`appStateChange` with `isActive === true`, re-checking `getState()` after registering).

**The ladder runs on time played, not time elapsed.** The session's age is foreground
time only (`SessionClock`): time with the page hidden does not accumulate, and a return
under 30 minutes resumes the session at the age it had when it left. On the wall
clock, a player who played one minute, locked the phone for twenty and came back read
as twenty-one minutes in — warm-up skipped, already past the long-session mark, and on
the tighter 2-minute floor, the heaviest pacing the game has for someone who had played
for one. Now they are one minute in, with two minutes of warm-up left. The two floors
that are NOT about the session stay on the wall clock on purpose: the gap since the
last interstitial and the mute after a rewarded ad are real elapsed time, and time away
counts toward them just the same.

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
| Win recorded, `winsSinceAd += 1` | `Progress.recordWin` |
| Figure presented; the board steps back and the result card rises; the tap gate opens at `readyIn` = `winHoldMs + winSettleMs + 250` ≈ 780 ms (the web Daily keeps the old win prompt instead of a card) | `GameScene.win` → `presentResult` |
| Player taps anywhere but the card's buttons, or presses [Next fold]; taps before `advanceReadyAt` are ignored | `GameScene.onPointerDown` |
| `advance()` — the ONE place a post-win ad may fire. It returns early while `Ads.busy`, and card buttons go dead the moment it starts | `GameScene.advance` |
| unless the card drew its own ask (`winQuiet`: the chapter doubler or the soft reminder ask), `if (Ads.wouldShowInterstitial(...))` → `await Ads.showInterstitial(stillWanted)` | `GameScene.advance` |
| `if (shown) Progress.update({ winsSinceAd: 0, attemptsSinceAd: 0 })` | `GameScene.advance` |
| Then load next level (or `LevelSelect` if past the end) | `GameScene.advance` |

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
- **One interruption per moment.** `Rate.shouldAsk({ adWillShow, quiet, win })` is
  called with the same predicate and returns `false` when an ad is queued or when the
  card already asks for something (`quiet`). And a card that drew the chapter doubler
  or the soft reminder ask makes `advance()` skip the interstitial, leaving
  `winsSinceAd` armed for the next natural break.

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
three to eight seconds. `interstitialEveryNAttempts` on its own would put an ad on
screen roughly every 25 seconds on a level someone is stuck on. AdMob's policy explicitly
forbade triggering an interstitial "every time a user clicks within the app" and disabled
ad serving over it, and the rule was carried unchanged to LevelPlay, whose networks read
repeated, accidental exposure as invalid activity too. So this configuration does not
trade retention for revenue — it trades an account for nothing (`monetization.ts:21-33`, `monetization.ts:121-132`,
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

`showBanner()` keeps its AdMob-era shape — return if not `enabled` or already shown,
remember `bannerWanted`, return if the SDK is not up (the replay above), swallow every
error — but the call is now the provider's `createBanner` with LevelPlay's **fixed
320×50 `BANNER` size at `BOTTOM`**. Not `ADAPTIVE`: an adaptive banner's height varies
by device, and the reserved strip below is 58 pt, which only a fixed 50 pt banner is
guaranteed to fit. While an interstitial or rewarded ad is on screen the banner is
hidden, the Phaser loop and the music are paused, and all three come back when it
closes.

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
             │  NATIVE LEVELPLAY BANNER     │  320×50 BANNER, BOTTOM
y = 1334     └──────────────────────────────┘
```

Why this matters (`Theme.ts`, `Ads.ts`): the banner is a native view pinned to the
safe-area bottom, centred on the safe area, and knows nothing about the canvas. Phaser
runs FIT + CENTER_BOTH against 750×1334 inside the safe area (index.html), so on a
9:16 phone there is **no letterbox at all** and the banner sits directly on canvas.
`bannerReserve` (116 base px) covers the 50pt banner while the canvas is drawn at 0.43
or more — every iPhone and every measured iPhone Duo shape; in a smaller window (a
stacked Split View pane on Duo) main.ts lifts the canvas by the shortfall instead
(`--fw-banner-lift`), so the banner never sits on the start dot. A
start dot or a button under an ad is unplayable *and* an accidental-click generator, and
accidental clicks are the fastest route to disabled ad serving.

Anything the scenes place near the bottom is anchored off where the banner actually
begins, not off `BASE_HEIGHT`. The rescue pills go in the band between the start dot's
grab zone and the banner line (`Rescue.rescueSpot`), the win card is laid out by
`resultCardLayout` to end at least `pt(6)` above the banner top, the store card is
centred in the band `[pt(44), BASE_HEIGHT − bannerReserve − pt(8)]` so no purchase row
sits under the ad, and the menu takes its whole stack from `MenuLayout.menuLayout`,
which never crosses the foot line. The 1.3 menu placed rows by hand and once drew
"Restore purchases" half off the bottom of the canvas.

**Naive change that breaks things:** lowering `inset.bottom` to gain playfield. It moves
the start dot and goal ring under the ad. `inset` also feeds level validation and the
share card (`data/levels.test.ts:17`, `data/quality.test.ts:15`,
`render/ShareCard.ts:146`), so changing it re-scales every authored level's pixel
geometry.

### 5.4 Rewarded video — five placements, two kinds

```ts
async showRewarded(placement: string, stillWanted?: () => boolean): Promise<RewardedOutcome>
```
Four outcomes, and the differences are load-bearing:

| Outcome | Means |
|---|---|
| `'earned'` | An ad played and the reward event fired. |
| `'declined'` | An ad played and the player closed it early. |
| `'unavailable'` | No ad could even be loaded — no fill, offline, or **any non-native build**. |
| `'abandoned'` | The ad loaded, but `stillWanted()` said no right before it would go on screen — the player left the level, started drawing, or won while it loaded. Nothing shown, nothing owed, and not the network's fault: a caller that skips for free on `'unavailable'` must not on this. The in-level placements, the repair row and the store sheet all pass one. |

**Callers must decide `'unavailable'` deliberately**, and since 1.4 the placements come
in two kinds with one rule each:

- **Rescues** — the skip and the streak repair — hand over no currency. Each is drawn
  *free* ("Skip this fold", "Keep your 12-day streak") where no ad can play at draw
  time (`!Ads.rewardedAvailable`) or the player owns Remove Ads, and `'unavailable'`
  still grants: a button that visibly does nothing reads as broken, and a rescue must
  never wall a player in. A pill keeps the promise it was drawn with
  (`Rescue.skipDrawnFree`): an SDK that comes up after "Skip this fold" was drawn does
  not turn it into an ad.
- **Currency** — the store row, the three-death offer, the chapter doubler — is simply
  **not drawn** where no ad can play or today's cap has no room, and pays on `'earned'`
  only. Currency is never granted on `'unavailable'`. The refill used to grant on
  anything but `'declined'`, which turned the web Daily's "Watch an ad · +1" into an
  infinite reveal dispenser that never showed an ad.

On an ads-off build every rescue is free and no currency placement is drawn, so no
level and no streak is ever blocked there.

| Placement | Where | Drawn when | Pays |
|---|---|---|---|
| `'reveal'` | "Watch an ad" row of the store / "Out of reveals" sheet (`StoreSheet.earnReveal`) | `rewardedAvailable`, not an owner, `Progress.canAdPay(1)` | `Progress.payAdReveals(1)` on `'earned'` only. Banked — except from the refill sheet opened by tapping an empty Reveal pill, where a reveal that lands while the board is idle on the same level is spent at once ("+1 reveal · showing the folded walls"). A late Ask to Buy pack that lands there is used the same way |
| `'reveal-offer'` | the three-death pill "Watch an ad → see the folded walls" (`GameScene.revealByAd`) | balance 0, `rewardedAvailable`, `canAdPay(1)`, not an owner | `payAdReveals(1)` on `'earned'`, then spent when the token lands (unless the level was won meanwhile) |
| `'skip'` | the skip pill "Watch an ad → skip this fold" (`GameScene.doSkip`) | the ladder below; never on a Daily | `Progress.unlockThrough(levelIndex, LEVELS.length)`, then the next level — unlock **without** clearing, so no figure and no win are recorded. A rescue: free for owners and where no ad can play |
| `'repair'` | the Streak sheet row "Watch an ad → keep your 12-day streak" (`StreakSheet`) | `Progress.repairableDay(today)` names a day | `Progress.repairStreak(today)`. A rescue, like the skip |
| `'chapter-double'` | "Watch an ad → +2 more reveals" in place of [Share] on a chapter-complete card (`GameScene.doDouble`) | `rewardedAvailable`, `canAdPay(2)`, not an owner, `onboardingIndex ≥ interstitialFromLevel`, and no soft reminder ask on that card | `payAdReveals(2)` on `'earned'`; the button then reads "✓ +2 more" and is dead |

**The rewarded cap.** `economy.rewardedRevealsPerDay` = 5 ad-paid reveals per local day,
across the three currency placements together. `Progress.canAdPay(n)` is the draw-time
gate — `adRevealsLeft() >= n`, which is why the doubler needs two left and not one: a
gate of one left would pay six in a day. `Progress.payAdReveals(n)` grants
(reason `'rewarded'`) and counts in one update and refuses, paying nothing, past the
cap. The count is `rewardedDay` / `rewardedToday` in the save; a day in the future is
read as today, keeps its count, and is stamped back to today by the next top-up — the
same clock-back rule as the free reveal. The store row says how many are left ("+1
reveal · free · 4 left today"); at the cap it is not drawn and the card says "free
reveals are back tomorrow". Without a cap an ad is a better deal than every pack,
forever.

**The rescue ladder** (`core/Rescue.ts`; `GameScene` passes reveal after 3 deaths, skip
after 6, skip anyway after 9). One pill at a time, and each names its cost:

| At | Pill | On tap |
|---|---|---|
| 3 deaths, stash > 0 | "Show the folded walls · 1 of 7" (eye) | spends one |
| 3, owner | "Show the folded walls" | reveals |
| 3, stash 0, an ad can pay | "Watch an ad → see the folded walls" (video) | `'reveal-offer'` |
| 3, stash 0, no ad, a store here | "See the folded walls?" | opens the refill sheet |
| 3, none of those | nothing | — |
| 6 | the skip — unless the player could still look (a stash, or Remove Ads) and has not revealed on this level: then the reveal offer stays | `'skip'`, or free |
| 9 | the skip, whatever the player holds | |

Currency comes first because a skip bought with an ad before the player has used the
tool the economy is built around teaches them to skip. The pills sit under the start
dot, in the band between its grab zone and the banner line (`Rescue.rescueSpot`) — never
over the board, never over the first stretch of the last attempt's ghost, and never
inside the grab zone, where a press starts a stroke instead of answering the pill.

Implementation notes:

- Guarded by `rewardedAvailable`, which still **ignores `adsRemoved`** (`Ads.ts` did not
  change in 1.4). The callers check ownership themselves, and since 1.4 an owner is
  never asked to watch an ad: no store rows, a free skip and a free repair, the
  three-death pill reveals without one, no doubler. Someone who paid to remove ads is
  not the person to ask to watch one.
- **The reward is granted on the reward event only, never on close.** LevelPlay adapters
  can deliver *closed* before *rewarded*, so after the close the service waits a further
  **800 ms** (`REWARD_AFTER_CLOSE_MS`) for a late reward before answering `'declined'`.
  Listeners are attached before `show`, and the show is raced against a dismissal
  watcher with a 180 s ceiling, so a skipped ad can never freeze the game.
- `'unavailable'` now also covers a player who withheld consent — but
  `rewardedAvailable` is false for them, so no currency placement is drawn in the first
  place and the rescues are drawn free.
- On `earned`, `mutedUntil = Date.now() + muteAfterRewardedSeconds * 1000` = +300 s —
  someone who just volunteered their attention is not taxed again immediately.
- The `placement` parameter is **accepted and discarded** — `void placement;` in the
  `finally` block. It exists as a hook for analytics that do not exist yet; the five
  strings above are what it would report.

The reveal itself — `InkRenderer.showReveal(mirroredWalls: readonly Rect[], durationMs: number): void`
— paints the mirrored right-hand walls onto the left half as an **accent hatch**: a 0.25
accent tint and a 45° hatch at 0.6, clipped to the bands by one geometry mask, fading in
over 220 ms, holding `durationMs` (6000), fading out over 420 ms. Until 1.4 it borrowed
the fail red, which read as a second failure. A thin accent underline on the Reveal pill
drains over the same six seconds (static under reduced motion) — a gauge, not a
countdown number. It is the right reward because it hands over exactly the information
the game withholds: not the answer, but where your own reflection is about to kill you.
The player still has to draw it.

**Two different attempt counters — do not conflate them:**

| Counter | Where | Incremented | Reset |
|---|---|---|---|
| `GameScene.attempts` | scene field, `GameScene.ts:99` | On every `pointerdown` that grabs the start dot (`GameScene.ts:216`) — including strokes released short of the goal | `loadLevel()` (`GameScene.ts:175`) |
| `Progress.data.attemptsSinceAd` | persisted save, `Progress.ts:56` | Only in `fail()`, i.e. only a real collision (`GameScene.ts:309`) | Only when an interstitial actually rendered (`GameScene.ts:406,451`) |

`offerSkipAfterAttempts` reads the first; `interstitialEveryNAttempts` reads the second.

### `showInterstitial()` and the Dismissed wait

```ts
async showInterstitial(stillWanted?: () => boolean): Promise<boolean>
```

`stillWanted` is asked once the ad is loaded, right before it goes on screen; a no (or
a throw) shows nothing and records nothing — no counters, no time floor. The retry ad
passes: scene active, same level, board idle, no finger down, no sheet, no rescue
offer; `advance()` passes the same level token. The mock's interstitial load resolves
at once, as LevelPlay's cache lookup does.

An interstitial's `show` resolves when the ad is **presented**, not when the player
closes it. Awaiting only that would load the next level under the ad. So the service
first takes a prefetched ad from the provider's cache (joining an in-flight load for up
to 15 s rather than loading at the tap), resolves on *displayed*, then waits for the
dismissal watcher — with a **180 s** ceiling, because the AdMob-era 8 s timeout
reported every video interstitial as "never rendered" while it was still on screen.
Only then does it stamp `lastInterstitialAt` and bump `interstitialsThisSession`.
Returns `true` only if it really rendered; silence (no fill, display failure) stamps the
time floor but spends no counter.

---

## 6. Reveal banking and the economy

State lives in `SaveData` (`src/systems/Progress.ts`):

```ts
reveals: number;          // banked reveals; spent by choice, never auto-consumed
lastTopUp: string;        // LOCAL ISO date of the last free daily reveal
adsRemoved: boolean;      // persisted so a relaunch needs no store call
rewardedDay: string;      // the ad-paid cap: the local day counted…
rewardedToday: number;    //   …and how many were paid on it
grantedTx: string[];      // store transaction ids already credited, newest 100
```

Operations:

```ts
get reveals(): number                           // Infinity for an owner, else state.reveals
grantReveals(n: number, reason = 'purchase'): boolean   // refuses n ≤ 0, fractions, NaN, and any call before load()
spendReveal(): boolean                          // owner: true, nothing spent; 0 left: false (the caller opens the refill sheet)
applyDailyTopUp(now?: Date): number             // 0 or 1
adRevealsLeft(now?) / canAdPay(n, now?) / payAdReveals(n, now?)   // the daily cap, §5.4
creditTransaction(txId: string, n: number, reason): boolean       // a purchase, credited once per transaction id (§7)
onGrant(cb: GrantListener): () => void          // every grant announced; returns the unsubscribe
takeUnshownGrants(): GrantEvent[]               // 'daily' / 'late-purchase' grants no listener showed
```

**Every grant takes one path.** No file outside Progress writes the balance. Each grant
is written, then announced to the `onGrant` listeners as `{ reveals, bookmarks, reason }`
with `reason` one of `'daily' | 'mission' | 'chapter' | 'streak' | 'rewarded' | 'purchase'
| 'late-purchase' | 'backlog' | 'repair'`. Scenes subscribe in `create()` and
unsubscribe on SHUTDOWN, and a listener returns `true` when it showed the grant. The
flow that caused a grant presents it (the store sheet its purchase, the win card its
missions and marks), so listeners present only what nobody else will: the day's free
reveal and a late purchase. Those two, when no listener claimed them, are kept (up to
20) for `takeUnshownGrants()`, because the cold-launch gift is paid inside `load()`,
before any scene exists. An event with nothing granted announces a state change
instead — Remove Ads changing hands (`adsRemoved` set), a repair — for listeners that
rebuild from the save, like the reminder schedule.

### The faucets

| Faucet | Effect on `state.reveals` | Builds |
|---|---|---|
| Fresh save | `= startingStash = 2`, then the day-one top-up, so **3** | all |
| First `load()` or foreground of a local day | `+1` (`freeDailyTopUp`) | all |
| A daily mission completed | `+1`, up to 3 a day, from level 5 on (reason `'mission'`) | all |
| Chapter marks | `+1` at 10 cleared, `+2` at 20: 3 a chapter, **45** across the 15. Skipped levels count toward neither. 1.3 players were paid their backlog once, on the first 1.4 menu (reason `'backlog'`) | all |
| Streak milestones | day 7 `+2`, 14 `+3`, 30 `+5`, 50 `+5`, 100 `+10`, then `+5` every 50; a bookmark earned at the cap of two pays `+1` instead | all |
| Rewarded (`'reveal'`, `'reveal-offer'`, `'chapter-double'`) | `+1` each (the doubler `+2`), **5 a local day** in all | live / mock |
| Starter | `+25`, once per install, $0.99 | IAP |
| Packs | `+10` / `+20` / `+30` at $0.99 / $1.49 / $1.99 | IAP |
| Remove Ads | reads as `Infinity`, spends nothing, and makes skips and repairs free — $2.99 | IAP |

**One sink.** A reveal shows the fold for six seconds; nothing else spends reveals. The
skip costs an ad or nothing, never a reveal.

**What a day looks like** (estimates from the 1.4 spec; spend grows with the chapter):
a typical player in chapters 1–4 — four first clears, the Daily, two missions — gains
about **3.9** non-ad reveals a day and uses one or two, so the stash grows. By chapters
5–10 spend has caught up (3–6 a day), and a heavy player in chapters 11–15 gains about
**5.5** plus five from ads against 6–12 used — the window where packs and Remove Ads
sell. With ads off (an ads-off build, a dead network, withheld consent) the same non-ad
faucets run, no ad row is drawn, and the skip and the repair are free, so nothing is
ever blocked; the late-chapter shortfall is what the packs are for, and the ads-off
build still sells them through the sandbox. The sums are pinned (§3): a day's free
supply (top-up plus missions) stays at 4 or less, under the smallest pack, so the pack
stays something worth buying.

### The top-up

```ts
applyDailyTopUp(now: Date = new Date()): number {
  if (!this.loaded) return 0;
  const today = todayISO(now);                       // LOCAL, CalendarDay's
  if (this.state.rewardedDay > today) this.update({ rewardedDay: today });
  if (this.state.lastTopUp === today) return 0;
  if (this.state.lastTopUp > today) {                // a clock that went back
    this.update({ lastTopUp: today });
    return 0;
  }
  const n = monetization.reveals.freeDailyTopUp;
  this.update({ lastTopUp: today, reveals: this.state.reveals + n });
  if (n > 0) this.emit({ reveals: n, bookmarks: 0, reason: 'daily' });
  return n;
}
```

Three things changed here in 1.4, each a fix:

1. **The day is LOCAL**, the Daily Fold's own clock (`CalendarDay.todayISO`). It used to
   be UTC, so west of Greenwich the pill's "one more lands tomorrow" pointed at a
   different day than the fold it was offered on.
2. **It runs on every foreground**, not only at launch: `load()` calls it, and so does
   main.ts on every return to the foreground. An app kept open across midnight used to
   grant nothing until a relaunch.
3. **A date in the future is repaired, not rewarded.** The old `!==` test paid on every
   launch, forever, once the clock had been set forward and back.

It is visible now, too: it returns what it paid and announces it. The menu plays the
gift ("+1 free reveal for today · you have 4", an eye flying into the balance chip), a
level shows "+1 free reveal for today" with a flight to the Reveal pill, and an owner
sees nothing — their reveals are unlimited.

**Off-by-one worth knowing:** a genuinely new player does not start with 2. `freshSave()`
sets `reveals: 2` and `lastTopUp: ''`, then `load()` immediately tops up, so first launch
shows **3**.

`grantReveals` writes the raw counter even for an owner, so an owner's `state.reveals`
drifts upward invisibly behind the `Infinity` getter. Harmless, but it is why the raw
field and the getter must not be used interchangeably — and never write
`Progress.update({ reveals: Progress.reveals })`: `JSON.stringify(Infinity)` is `null`.

**Remove Ads bundles unlimited reveals and free skips** (`Progress.reveals`,
`Rescue.skipDrawnFree`), which is what makes the purchase worth far more than any pack
at zero marginal cost.

---

## 7. The store: `Iap`, the store sheet, and the fake store

### 7.1 The products

| Product | Type | Price (USD base) | Role |
|---|---|---|---|
| `com.noqyris.foldwing.removeads` | non-consumable, family-shareable | $2.99 | The top of the ladder: no banner, no interstitials, unlimited reveals, free skips and repairs |
| `com.noqyris.foldwing.reveals10` | consumable | $0.99 | Rung |
| `com.noqyris.foldwing.reveals20` | consumable | $1.49 | Rung — not drawn where it is a trap (§7.3) |
| `com.noqyris.foldwing.reveals30` | consumable | $1.99 | Rung |
| `com.noqyris.foldwing.reveals25` | consumable | $0.99 | **The starter**, sold once per install after the fifth win. Never sold before 1.4 |

**No new product id in 1.4.** Ids are permanent, so the starter reuses the one product
that was never sold, and whose id already names its count. Its App Store Connect base
price moved from $1.49 to $0.99 (a price edit, not a review submission): at $1.49 it
became €1.99 — the same money as thirty reveals for twenty-five — which made it a trap;
at the $0.99 tier it is €0.99 or £0.99 wherever the 10-pack is, so "save 60%" holds in
every storefront. App Review has approved the other four; `reveals25` is
`READY_TO_SUBMIT` and has to go to review attached to the 1.4 submission. Until it is
approved, production StoreKit does not return it, and the store simply has no starter
row.

### 7.2 `IapService`

```ts
export type PurchaseResult = 'bought' | 'cancelled' | 'pending' | 'failed';
export type RestoreResult = boolean | null | 'cancelled';

export interface IapService {
  readonly available: boolean;            // a store to talk to: native, or the browser mock
  readonly kind: 'storekit' | 'mock';
  init(): Promise<void>;                  // still a deliberate no-op
  warm(): Promise<void>;                  // open the store in the background; shared, never throws
  canPurchase(): boolean;                 // false where the device refuses payments
  removeAdsProduct(): StoreProduct | null;
  revealPacks(): RevealPack[];            // unpriced placeholders until the store answers, then only what it returned
  starterProduct(): RevealPack | null;    // only once StoreKit returned reveals25
  isPending(id: string): boolean;         // an Ask to Buy for this id is waiting
  buyRemoveAds(): Promise<PurchaseResult>;
  buyRevealPack(id: string): Promise<PurchaseResult>;
  buyStarter(): Promise<PurchaseResult>;
  restore(): Promise<RestoreResult>;
}

export const Iap: IapService =
  import.meta.env.VITE_ADS === 'mock' && !Capacitor.isNativePlatform()
    ? createMockIap(creditPurchase)
    : new StoreKitIapService();

export function creditPurchase(productIds, txId, reason: 'purchase' | 'late-purchase'): boolean;
export function applyEntitlement(storeSays: boolean | null, reason = 'purchase'): void;
```

`StoreProduct` carries `priceMicros` beside the localised `priceString`: the string cannot
be compared ("1,49 €", "$1.49", "¥250"), and every "save N%" in the store is computed from
the number.

The selection is inline so every other build tree-shakes the mock away. **The TestFlight
mock build runs on a phone, so it uses the real StoreKit sandbox**; the fake store exists
only in a browser.

### 7.3 `StoreKitIapService`

**Opening the store.** `warm()` runs `connect()`, shared by every caller in flight, which
opens the store once: one `store.register` call for all five products (Remove Ads as
NON_CONSUMABLE; the three rungs and the starter as CONSUMABLE), the `approved` /
`pending` / `verified` handlers wired **before** `store.initialize(… needAppReceipt:
false …)`, then the products read back with their localised prices. It is warmed when a
selling surface opens — `GameScene.create`, the menu once the consent flow has finished,
the store sheet itself — never at launch (§8, and "Why `init()` is a no-op" below).

- Any `initialize` error other than `INVALID_PRODUCT_ID` sets `setupFailed`, and
  `canPurchase()` then stays **true**: a store that did not start is "The store isn't
  reachable right now", not "Purchases are turned off on this iPhone". `INVALID_PRODUCT_ID`
  is only a product StoreKit did not return, which is normal for `reveals25` in
  production.
- After the answer, a product StoreKit did not return is simply not listed — no dead,
  priceless row.
- Remove Ads found owned as the store opens (a transaction a crash left unfinished, an
  Ask to Buy approved while the app was closed) is applied as a `'late-purchase'`.

**The approved handler** is where money becomes reveals, and each step is a fix:

```text
approved(t) →
  late = no buy*() is waiting on any of t's product ids
  creditPurchase(ids, t.transactionId, late ? 'late-purchase' : 'purchase')
      Remove Ads → applyEntitlement(true, reason)
      starter    → Progress.markStarterBought()   (before the grant is announced)
      reveals    → Progress.creditTransaction(txId, count, reason)   (grant + tx id in ONE update)
      → may finish only if Progress.hasGrantedTx(txId)
  await Progress.flush()   → false: leave t unfinished
  t.finish()
```

- **Credited once per transaction id.** StoreKit redelivers anything unfinished and the
  plugin re-fires `approved` for the same transaction after a minute; `grantedTx` (the
  newest 100, ids over 64 characters kept by their last 64) makes a redelivery pay
  nothing. Before `load()` the credit is refused and the transaction is left unfinished,
  so StoreKit hands it over again once the save is in.
- **On disk before `finish()`.** A crash between a finish and the debounced write would
  have lost a purchase Apple considers delivered.
- **`order()` is read.** `PAYMENT_CANCELLED` answers `'cancelled'` at once instead of
  after the six-second settle.
- **Ask to Buy** answers `'pending'` ("waiting for approval · it lands here once it's
  approved"). The approval can come minutes or days later, through the same handler, as
  a `'late-purchase'` — "+10 reveals arrived". While one is waiting for the starter,
  `isPending` keeps the starter row away: every request a child sends is paid in full.
  It is not marked bought on `'pending'`, so a parent's No does not lose the offer (on a
  phone a declined starter stays hidden until the next launch — StoreKit says nothing
  about a decline).

`restore()` is unchanged in shape — `null` when the store did not answer, `'cancelled'`
for a dismissed sign-in — and consumables restore nothing. **The `null` protocol is the
important part:** a transient failure is "not authoritative", never `false`, so a
network blip can never silently downgrade someone who bought the thing.

```ts
export function applyEntitlement(storeSays: boolean | null, reason = 'purchase'): void {
  if (storeSays !== true) return;
  Progress.setAdsRemoved(true, reason);   // announced through onGrant
  Ads.setAdsRemoved(true);                // banner down in the same frame
}
```

One branch, no `else`; the single choke point for the ad layer too, because the grant
that runs inside the approved handler used to never reach `Ads` at all — ads kept coming
for the rest of the session after the player had paid to stop them.

There is **no receipt-validation server**; an approved transaction is finished locally.
Apple has already authenticated the purchase, and a validator would only add protection
against a jailbroken device faking a $0.99 unlock.

### Why `init()` is a no-op, and why nothing restores at launch

`BootScene` calls `Iap.init()`, which does nothing on purpose. StoreKit needs an Apple
Account to attach a storefront listener, and on a signed-out device it puts a "Sign in to
Apple Account" dialog over the app before the player has touched anything — and it
**reappears after Cancel**. A repeating login wall on first run of a free game, for a
purchase nobody asked for. Apple's own guidance says the same: restoring is a
user-initiated action, never automatic. `needAppReceipt: false` is the same fix one layer
down: the Apple adapter otherwise verifies the app receipt on startup, and a fresh
install has none.

The cost: a reinstalling owner sees ads until they tap **Restore purchases** (Settings,
or the store's footer), and an interrupted transaction is delivered when the player next
opens a selling screen rather than at launch — as a late purchase, credited once.

### 7.4 The store sheet (`src/render/StoreSheet.ts`)

One definition, used from every screen that sells, so the prices, the savings, the order
of the rungs and every caption exist once. It opens as **"Store"** from the menu (the
balance chip's "+", and the third button of the Levels | Gallery | Store row) and as
**"Out of reveals"** from a tap on an empty Reveal pill or the three-death "See the
folded walls?" — with the sub-line "a reveal shows the folded walls for 6 seconds".
Header: the title in the display font, and on the right the eye and "you have 7" (∞ for
an owner). Card `pt(300)`, depth 90, centred above the banner band.

Rows, top to bottom — `storeOffers(hooks, now)` builds them before the card is drawn, and
only rows that can do something:

| Row | Face | Drawn when |
|---|---|---|
| **Watch an ad** — "+1 reveal · free · 4 left today" | primary, video glyph | `rewardedAvailable`, not an owner, `canAdPay(1)`. The only primary: reveals must stay earnable, and no purchase is promoted when the free row is missing |
| **25 reveals** — "$0.99 · once · save 60%" | secondary with an accent outline, `STARTER` tag | not an owner, `!starterBought`, `totalWins ≥ 5`, StoreKit returned it, no Ask to Buy waiting for it, and `starterWorthShowing` |
| **10 / 20 / 30 reveals** — "$1.99 · save 33%" | secondary, eye glyph, `BEST VALUE` on one rung at most | the rungs `sellableLadder` keeps |
| **Remove ads** — "$2.99 once · no ads, unlimited reveals & skips" | `accent`, taller (`pt(62)`), `ONE-TIME` tag | the store returned it and payments are on |
| footer: [Restore purchases] · [Not now] | ghost | Restore wherever `Iap.available` |

The honest-ladder functions, pure, in `monetization.ts`:

- `sellableLadder(packs)` — when every rung is priced, drop every rung another rung
  dominates (as many or more for as little or less), then keep only rungs whose price
  per reveal strictly falls as they grow. Apple's tiers are not proportional across
  currencies: in Serbia the 20-pack and the 30-pack are both €1.99, in the UK the
  10-pack and the 20-pack are both £0.99, and shown as-is one row there sells fewer
  reveals for the same money as the row beside it. Unpriced, the list comes back
  untouched and nothing is judged.
- `bestValueId(kept)` — the rung with the lowest unit price, only among two or more and
  only when it saves at least 15% on the smallest kept rung. There is no "most popular":
  nothing here has sales data.
- `starterWorthShowing(starter, kept)` — strictly cheaper per reveal than every kept rung;
  false when anything is unpriced or no rung is on sale.

Every "save N%" is `packSaving` on `priceMicros`, never a string literal.

Other states: an owner gets "Remove ads is yours · reveals are unlimited" and the
footer, with no rows; a row whose price has not arrived is drawn waiting ("…", faded,
not pressable) and reads "price unavailable" after 6 s (still filling in if the answer
comes later); no products and no ad row: "The store isn't reachable right now";
payments off: "Purchases are turned off on this iPhone", with the ad row (if any) and
Restore; at the cap, the footnote "free reveals are back tomorrow". The sheet returns
`null` only where there is no store at all, and the caller says so in its own words
("one free reveal lands each day").

**Who says what landed.** A purchase, a restore or a rewarded ad started from the sheet
is reported through `hooks.onChange(notice, landed)` — "+10 reveals · you have 17",
"ads removed · reveals are unlimited now", "restored · no ads, unlimited reveals" —
after `Haptics.success()` and `Audio.reward()` have played; the scene flies the eyes
into the chip or the pill and counts up. A cancel, a failure, a pending purchase or a
missing ad comes through `hooks.onNotice(text, tone)` ("purchase cancelled", "the
purchase didn't go through"). Listeners on `onGrant` present only `'late-purchase'`,
through `grantNotice(g)`, so no purchase is ever announced twice. The menu restarts
only when ownership changes — Remove Ads bought or restored, since the Store button
and the chip's "+" go away — and a reveal purchase lands on the live menu.

Menu helpers: `storeSells()` (false for owners and wherever nothing could be sold —
drives the chip's "+"), `starterOnOffer()` (with `!starterSeen`, the NEW badge on the
Store button), `restorePurchases(hooks)` (the one restore flow, from the footer and from
Settings).

### 7.5 The fake store (`src/systems/iapMock.ts`)

Selected only by `VITE_ADS=mock` in a **browser** (`npm run dev:mock`). It proves OUR
side, not StoreKit's: every purchase is delivered through `creditPurchase`, the function
the approved handler calls, so the credit-once record, the starter's once-per-install
rule, the entitlement and every grant event are the ones the phone runs. `available` is
true; the store "answers" 250 ms after `warm()` with $0.99 / $1.49 / $1.99, the starter
at $0.99 and Remove Ads at $2.99.

Every buy puts up a DOM sheet titled **"FAKE PURCHASE — no money"**
(`data-foldwing-mock="purchase"`, buttons `data-action="buy|cancel|fail|pending"`).
**Pending** leaves a pill (`data-foldwing-mock="purchase-pending"`,
`data-action="approve|decline"`); Approve delivers the purchase as a `'late-purchase'`.
"Owned" lives in `localStorage['foldwing.mockOwned']` and is read only by a restore; it is
not re-granted at `warm()`, because StoreKit here has no receipt validation and Apple says
not to auto-restore. Clear the key to reset it.

Query switches: `?iap=slow` (the answer takes 8 s), `?iap=none` (no products),
`?iap=restricted` (payments off), `?restore=true|false|cancelled|error`; on the dev server
only, `?prices=usd|srb|gbr` or `window.__foldwingPrices` (a fixture name or
`{ currency, removeAds, starter, packs: { 10: micros, … } }`) for the storefront
fixtures.

**The gate.** The file never contains the literal ad markers, and `check-ad-mode.mjs`
refuses `/FAKE\s+PURCHASE/i` in every bundle but mock — live, off and test fail it
whatever their markers say (§3), and `check-native-sync.mjs` repeats the refusal on the
synced tree. Keep that string in `iapMock.ts` and nowhere else: a toast or a log line
saying "fake purchase" anywhere else would fail every store build. Comments are fine;
the minifier strips them.

### 7.6 Current shipping state

The four 1.3 products are approved and on sale. **No sandbox purchase has been recorded
in this repo** for any of them, the starter included; App Review tests IAPs, and the
checklist in §10 runs them on a TestFlight build with a Sandbox Apple ID. The starter
row cannot be seen in production until `reveals25` is approved with 1.4.

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

What `adsRemoved` changes in play is the reveal stash becoming infinite
(`Progress.reveals`, `spendReveal`) and the skip and the streak repair coming free. It
touches no wall, no radius, no level — and nothing the economy grants does either: a
reveal is information about the fold, never a change to it.

---

## 10. Go-live checklist

For LevelPlay. The authoritative procedure is the two-build release in
[../CLAUDE.md](../CLAUDE.md); this is the money-specific part of it.

**Code / build**

| # | Action | Where |
|---|---|---|
| 1 | `nvm use` (Node 22), `npm install` — the consent patch must print ✅ | `.nvmrc`, `scripts/patch-levelplay-consent.mjs` |
| 2 | `npm test` from the repo root — green | `package.json` |
| 3 | Load credentials: `set -a; source .env.appstore; set +a` | `.env.appstore.example` |
| 4 | `npm run release:appstore` — the live build N (`ios:appstore` + `fastlane release_build`: uploaded and recorded in `build/.live-build-number`, **not** attached or submitted), then immediately the ads-off build N+1 (`ios:sync:adsoff` + `fastlane beta_adsoff`, run even if `release_build` failed), then `fastlane attach_build` (only if both halves passed: N, by its recorded number, onto the editable version). Exits non-zero if any step failed | `package.json`, `fastlane/Fastfile` |
| 5 | If Apple's uploader 500s after a successful archive: `fastlane beta_upload` — it re-reads the ipa and accepts only a live or an ads-off build | `fastlane/Fastfile` |
| 6 | Publish `privacy.html` and `app-ads.txt` from `repository/web/noqyris-website` (a push is a deploy — owner's word), then curl the live site: the policy contains `Unity LevelPlay` and no `AdMob`; `app-ads.txt` contains `unity.com, 144007920, DIRECT` | `../SUBMIT.md` |
| 7 | Submit for review only on the owner's word — with `com.noqyris.foldwing.reveals25` (the starter: $0.99, review screenshot, all territories) attached to the same submission, or the starter stays invisible in production | `../SUBMIT.md` |
| 8 | Once N is `READY_FOR_SALE`: `fastlane expire_real_ads` (lists), then `fastlane expire_real_ads confirm:true` — every unexpired build but the newest; refuses while the newest is the live build, even as the only one | `fastlane/Fastfile` |

If `ios:appstore` fails after its sync, `ios/App/App/public` holds a LIVE bundle and
nothing else in the chain runs: run `npm run ios:sync:adsoff` before anything else.
Once `release_build` has started, the chain does that itself.

**Verify before submitting** — on the **ads-off** TestFlight build for everything that
is not an ad, and on the **mock** build (`npm run dev:mock`, `npm run ios:sync:mock` in the
simulator) for placements, cadence and rewards. Never on a live or test-mode build.

- Sandbox Apple ID: buy a pack, the starter (once its $0.99 price has propagated, up to
  about an hour after an edit) and Remove Ads → confirm ads stop and reveals read ∞ →
  kill the app right after a purchase and relaunch: credited once → delete → reinstall →
  **Restore purchases** (Settings or the store's footer) → relaunch twice. App Review
  tests IAP; a failure there is a rejection and a lost cycle.
- The store's own paths — cancel, fail, Ask to Buy then approval, restore outcomes,
  storefront fixtures, the daily cap — are walked on the browser's fake store
  (`npm run dev:mock`, §7.5), which delivers through the same `creditPurchase`.
- Cold-launch on a device signed OUT of the App Store: **no Apple Account dialog** should
  appear. That is the §8 patch and `needAppReceipt: false` working.

**Dashboards and store — outside this repo**

- **LevelPlay** (`platform.ironsrc.com`): the Foldwing iOS app, its three units, and a
  Unity Ads *instance* on each unit (a network enabled on the account is not a network
  in the waterfall).
- **`app-ads.txt`** on the developer site the store listing names must carry Unity's
  `unity.com, 144007920, DIRECT` line plus the dashboard's reseller list. It is served
  from the noqyris-website repo, not this one, which is why `check-no-google.mjs` only
  notes it.
- **Privacy policy** (`https://www.noqyris.com/foldwing/privacy.html`) must name Unity
  LevelPlay, say that declining consent means no ad SDK at all, and state exactly what
  Remove Ads stops (banner and interstitials; since 1.4 an owner is not offered rewarded
  ads either — skips and repairs are free). The page as deployed for 1.3 still says the
  optional reward videos "stay available" after the purchase; that sentence has to
  change before 1.4 is submitted. The consent
  modal's *Privacy policy* button opens this exact URL, so the deployed page — not the
  file in the website repo — is what has to be right before submitting.
- **App Review notes** must not mention AdMob. A new LevelPlay app may fill little at
  first; say so in the notes rather than hoping review sees an ad.
- **App Privacy label** (published 2026-09-16): Location → Coarse Location; Identifiers →
  Device ID; Usage Data → Product Interaction and Advertising Data (all Third-Party
  Advertising, not linked, used for tracking; Device ID also Analytics and App
  Functionality); **plus Diagnostics → Crash Data, Performance Data, Other Diagnostic
  Data** (Analytics and App Functionality, not linked, not used for tracking). The LevelPlay pod graph links ironSource's Ad
  Quality SDK, whose bundled manifest declares diagnostics, and the privacy policy lists
  them. Full table in `../SUBMIT.md`, step 3.

**Never tap an ad, and never deliberately look at one**, on any build and any phone.
Unity counts impressions as invalid activity, not only taps, and every `ADS:on` build is
the real waterfall.

**Android:** there is no LevelPlay Android app; `APP_KEYS.android` is `''`, so the whole
ad layer no-ops there. Creating that app and filling the key and units is a prerequisite
for any Android release — and its closed/internal tracks get ads-off builds only.

---

## 11. Known rough edges in this code

Not bugs that break the game — every one is contained by the swallow-all-errors rule —
but they are the things a reader would otherwise waste time re-deriving.

The `once()` and `Rewarded`-listener rows describe the AdMob-era `Ads.ts` and went with
it; the LevelPlay provider attaches and detaches its listeners per show.

| Observation | Location |
|---|---|
| `once()` registers plugin listeners and never removes them; each interstitial/rewarded show leaks one listener per event name for the process lifetime. | `Ads.ts:285-298` |
| `showRewarded` adds a fresh `Rewarded` listener per call and never removes it; stale closures still fire and set dead `earned` flags. Harmless, but listener count grows with rewarded views. | `Ads.ts:265` |
| `sessionWarmupSeconds` is measured from the end of `init()`, not from process start, because the session clock is restarted there. A slow SDK init pushes the first possible ad later. | `Ads.init`, `SessionClock.start` |
| A post-win ad resets both `winsSinceAd` and `attemptsSinceAd`; a retry ad resets only `attemptsSinceAd`. Neither the source nor the tests state why. | `GameScene.ts:406` vs `451` |
| *(Fixed in 1.4.)* The daily top-up used UTC dates and fired only inside `load()`; it is LOCAL now and runs on every foreground. | `Progress.applyDailyTopUp` |
| A fresh player sees 3 reveals, not `startingStash: 2`. | `Progress.ts:77,153,244` |
| The `placement` argument to `showRewarded` is discarded (`void placement`). | `Ads.ts:279` |
| Only `MenuScene` and `GameScene` call `showBanner()`; Levels and the Gallery rely on the native banner never being hidden, so it persists across scenes. Correct, but a scene reached first some other way would show none. | grep of `showBanner` |

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
- [../SUBMIT.md](../SUBMIT.md) — the submission state, the LevelPlay ids, and hand-only App Store Connect steps
- [../CLAUDE.md](../CLAUDE.md) — ad safety and the two-build release: the rules, not the history
