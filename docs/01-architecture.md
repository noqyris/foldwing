> **Out of date. Written 7 August 2026, before the maze rewrite; banner added
> 9 August 2026.**
>
> This page describes the retired **100-level set of bar obstacles** and the
> generator that produced it. Neither still exists. The game now ships 300
> levels — five hand-authored and 295 spanning-tree mazes built by
> `src/core/MazeGen.ts`, which is also what the Daily Fold runs on the phone —
> so every level count below is wrong, and any passage about wall placement,
> interlock reservation or inert-wall stripping describes code that was
> deleted with the bar set.
>
> The "Source files" line-count tables are wrong too, and that matters more
> than it looks: the `file:line` citations throughout were counted against
> those tables, so treat every one of them as a hint about where to look
> rather than as a location. Read the source.
>
> Kept because the reasoning is still worth having. For what the game actually
> does now, see [../README.md](../README.md).

---

# Architecture & Runtime Flow

## What this covers

The whole-system map: the game's mechanic, the six source layers and the exact
import rules between them (verified by grep, not assumed), the `Phaser.Game`
boot config in `src/main.ts`, the scene-transition graph with its data
payloads, the seven module-singleton services and their initialisation order,
every DOM/native boundary, and the two runtime targets (Vite dev server, iOS
Capacitor WKWebView).

## Source files

| Path | Lines | Role |
|---|---|---|
| `src/main.ts` | 67 | `Phaser.Game` construction, scene registration, viewport-settle handler, DEV window hooks |
| `src/scenes/BootScene.ts` | 55 | Sole entry scene: loads the save, seeds the ad entitlement, starts `Menu` |
| `src/scenes/MenuScene.ts` | 216 | Home; routes to LevelSelect / Gallery / Game; hosts the IAP rows |
| `src/scenes/LevelSelectScene.ts` | 308 | 100-card scrollable grid, baked into one texture atlas |
| `src/scenes/GalleryScene.ts` | 249 | Saved-figure grid, baked into one texture atlas; tap to share |
| `src/scenes/GameScene.ts` | 707 | The core loop; owns Playfield/StrokeRecorder/CollisionSystem/InkRenderer |
| `index.html` | 61 | Viewport meta, fixed-position page lock, `#app` mount, module entry |
| `vite.config.ts` | 21 | `base: './'`, es2020 build, dev server, Vitest node-environment config |
| `tsconfig.json` | 23 | strict TS, `noEmit`, `include: ["src", "vite.config.ts"]` |
| `capacitor.config.ts` | 15 | `appId`/`webDir`/`backgroundColor`/`ios.contentInset` |
| `package.json` | 38 | Scripts and the dependency set that defines the native surface |
| `src/render/Theme.ts` | 212 | `BASE_WIDTH`/`BASE_HEIGHT`/`PT`/`pt()`/`theme()`/`METRICS`; `main.ts` imports `BASE_WIDTH`, `BASE_HEIGHT`, `theme` |
| `src/systems/*.ts` | 7 files | The singleton services (Progress, Ads, Iap, Audio, Haptics, Rate, Share) |
| `src/config/monetization.ts` | 182 | The single cross-cutting config object |
| `scripts/genLevels.ts` | 467 | Offline level generator (node, outside `src`, not typechecked by `npm run build`) |

---

## 1. What the game is

Draw one continuous line in the **left half** of the screen, from the start dot
to the goal ring; the line is mirrored across the vertical centre axis in real
time. Walls are placed asymmetrically across the full width, so a single
gesture must clear the left-hand walls **and** its reflection must clear the
right-hand walls simultaneously — a right-hand wall spanning `x ∈ [a,b]`
forbids the player `x ∈ [1-b, 1-a]` at the same `y` (`src/data/types.ts:16-17`).
On a win the stroke and its mirror close into a symmetric figure, which is
saved normalized and can be re-rendered as a 1080×1080 share card.

Shipped set: **100 levels** — 5 hand-authored (`src/data/levels.ts:21-83`,
LOCKED) plus 95 generated (`src/data/generatedLevels.ts:14`), concatenated at
`src/data/levels.ts:89`. Pinned by `src/data/levels.test.ts:25-30`.

---

## 2. Layer stack

```text
                    ┌───────────────────────────────────────┐
   entry            │            src/main.ts                │
                    │  new Phaser.Game({ scene: [...] })    │
                    └──────────────────┬────────────────────┘
                                       │
   scenes/          ┌──────────────────▼────────────────────┐
   (Phaser)         │ Boot · Menu · LevelSelect · Gallery ·  │
                    │ Game     — may import ANY layer        │
                    └───┬───────────┬──────────────┬────────┘
                        │           │              │
   render/          ┌───▼─────────┐ │              │
   (Phaser-aware,   │ InkRenderer │ │              │
    partly pure)    │ UI          │ │              │
                    │ ScrollView  │ │              │
                    │ Theme    ✱  │ │              │
                    │ HitArea  ✱  │ │              │
                    │ ShareCard ✱ │ │              │
                    └───┬─────────┘ │              │
                        │           │              │
   core/            ┌───▼───────────▼──┐           │
   (PURE — no       │ Geometry          │          │
    Phaser, no DOM, │ CollisionSystem   │          │
    no Capacitor)   │ StrokeRecorder    │          │
                    │ Ribbon            │          │
                    │ DrawCursor        │          │
                    │ Playfield         │          │
                    │ LevelValidator    │          │
                    └───┬───────────────┘          │
                        │ (type-only, both ways)   │
   data/            ┌───▼───────────────┐          │
   (plain data)     │ types · levels ·  │          │
                    │ generatedLevels   │          │
                    └───────────────────┘          │
                                                   │
   systems/         ┌───────────────────────────────▼──────┐
   (native/DOM      │ Progress · Ads · Iap · Audio ·        │
    singletons)     │ Haptics · Rate · Share               │
                    └───────────────┬──────────────────────┘
                                    │
   config/          ┌───────────────▼──────────────────────┐
   (cross-cutting)  │ monetization  (+ @capacitor/core)    │
                    └──────────────────────────────────────┘

   ✱ = file in render/ that does NOT import Phaser
```

### The import rule, per layer (grep-verified)

| Layer | May import | Actually imports (non-test) | Phaser? |
|---|---|---|---|
| `src/core/` | `core/`, type-only `data/types` | `./Geometry`, `./CollisionSystem`, `./Playfield`, `../data/types` (type-only, `LevelValidator.ts:25`) | **No** |
| `src/data/` | `data/`, type-only `core/Geometry` | `./types`, `./generatedLevels`, `../core/Geometry` (type-only, `types.ts:19,21`) | **No** |
| `src/config/` | `@capacitor/core` only | `Capacitor` (`monetization.ts:36`) | **No** |
| `src/systems/` | `config/`, sibling `systems/`, Capacitor/Cordova plugins | see §5 | **No** |
| `src/render/` | `core/`, sibling `render/`, `phaser`, type-only `systems/Progress` | `ShareCard.ts:26` imports `type { SavedFigure }` from `systems/Progress` | UI, ScrollView, InkRenderer only |
| `src/scenes/` | everything | all of the above | Yes, all five |
| `scripts/` | `node:fs`, `core/`, `render/Theme`, `data/types` | `genLevels.ts:23-35` | **No** (runs under node) |

### `core/` is pure — the verification

`grep -rn "phaser" src/core/ -i` returns **three hits, all inside comments**,
zero import statements:

- `src/core/Geometry.ts:4` — "Nothing here knows about Phaser…"
- `src/core/Ribbon.ts:116` — comment about Phaser's line renderer
- `src/core/DrawCursor.ts:18` — "Kept pure, with no Phaser and no clock…"

The same grep over `src/data/`, `src/config/` and `src/systems/` returns
**nothing at all**. Only `src/main.ts`, `src/render/{UI,ScrollView,InkRenderer}.ts`
and the five scene files carry `import Phaser from 'phaser'`.

**Why this matters:** `vite.config.ts:15-20` runs Vitest with
`environment: 'node'` and states "Phaser is never imported by a test". Every
`*.test.ts` file lives under `src/core/`, `src/render/` (Theme, HitArea),
`src/data/` or `src/config/` — i.e. only the Phaser-free files. **Adding a
`phaser` import to any of `core/`, `data/`, `config/`, `render/Theme.ts`,
`render/HitArea.ts` breaks the entire test suite**, because Phaser cannot be
imported in a bare node environment. That is the load-bearing reason for the
purity rule, not aesthetics.

### The type-only cycle between `core/` and `data/`

`src/data/types.ts:19,21` re-imports and re-exports `Rect`/`Vec2` from
`src/core/Geometry.ts`; `src/core/LevelValidator.ts:25` imports
`type { Level }` from `src/data/types`. Both directions are `import type`, so
they are erased at compile time and no runtime cycle exists. Converting either
to a value import would create a real ESM cycle.

### The other structural guarantee

`src/render/Theme.ts:1-18` splits the palette (`InkTheme`, cosmetic) from
`METRICS` (mechanical). `CollisionSystem` reads neither — it takes
`hitRadius` as a constructor argument (`src/core/CollisionSystem.ts:30-34`),
supplied by `GameScene.ts:151` from `METRICS.hitRadius`. No skin can change
what kills the player; that is structural, not a promise.

---

## 3. Boot sequence

### 3a. `src/main.ts:10-37` — the game config, verbatim shape

```ts
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: theme().paper,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
  },
  input: { activePointers: 3 },
  render: {
    antialias: true,
    roundPixels: false,
    powerPreference: 'high-performance',
  },
  fps: { target: 60 },
  scene: [BootScene, MenuScene, LevelSelectScene, GalleryScene, GameScene],
});
```

| Setting | Value | Why (from the source comments) |
|---|---|---|
| `parent` | `'app'` | matches `<div id="app">` at `index.html:58` |
| `backgroundColor` | `theme().paper` = `0xe9ebe4` (`Theme.ts:74`) | matches the page background (`index.html:23`, `#e9ebe4`) and `capacitor.config.ts:9` (`#E9EBE4`), so FIT's letterbox bars are invisible |
| `width`/`height` | `750` / `1334` (`Theme.ts:30-31`) | 2× iPhone-SE portrait, 9:16 — the widest common portrait aspect, so taller phones letterbox (invisible) rather than pillarbox and steal the width the mirror needs |
| `input.activePointers` | `3` | **Load-bearing.** Phaser allocates 1 touch pointer by default. A collision always happens mid-drag, so the drawing finger is still down through the 400 ms flash (`METRICS.failFlashMs = 400`); a second hand reaching in to restart would find no free Pointer. 3 also covers a stray palm. (`main.ts:22-29`) |
| `roundPixels` | `false` | sub-pixel ribbon geometry |
| `scene` array | Boot first | Phaser auto-starts only the first scene — Boot is the sole entry point |

Three of the four colour declarations for paper live outside `Theme.ts`
(`index.html:11` `theme-color`, `index.html:23` CSS, `capacitor.config.ts:9`).
Changing `PAPER.paper` (`Theme.ts:74`) alone leaves visible seams at the
letterbox edge.

### 3b. `src/main.ts:47-54` — the viewport-settle handler

```ts
const refresh = (): void => {
  game.scale.refresh();
};
window.addEventListener('resize', refresh);
window.addEventListener('orientationchange', refresh);
window.visualViewport?.addEventListener('resize', refresh);
window.visualViewport?.addEventListener('scroll', refresh);
for (const ms of [50, 250, 600, 1200]) setTimeout(refresh, ms);
```

**Why it exists (`main.ts:39-46`):** `game.scale.refresh()` recomputes the
canvas bounding rect, and that rect is what maps a touch to a game coordinate.
Inside a Capacitor WKWebView the real viewport settles **after** `new
Phaser.Game(...)` returns — status bar, safe areas, splash dismissal — and
frequently without firing a `window` `resize` event at all. A stale rect puts
every touch a few points from where the player aimed. In a game that is
nothing but a drawn line, a few points is the whole experience.

The four unconditional timeouts `[50, 250, 600, 1200]` are the belt to the
event listeners' braces: they fire whether or not any event arrives. Do not
"clean this up" by removing them.

The complementary half of the fix is CSS, not JS: `index.html:40-50` pins
`html`, `body` and `#app` to `position: fixed; inset 0`, removing every axis of
scroll/rubber-band that would shift the cached canvas rect
(`index.html:32-39`). `touch-action: none` and `overscroll-behavior: none`
(`index.html:29-30`, `:53`) complete it, and
`viewport-fit=cover, user-scalable=no, maximum-scale=1` at `index.html:5-8`
stop pinch-zoom from moving the rect at all.

### 3c. `src/main.ts:58-67` — DEV-only globals

`import.meta.env.DEV` is a compile-time constant, `false` under `vite build`,
so this block is tree-shaken out of the production bundle.

- `window.game` → the `Phaser.Game`
- `window.foldwing.renderShareCard` → the share-card renderer, used by asset
  tooling to draw the app icon from the game's own mechanic

`GameScene.ts:128` gates `bindDevKeys()` on the same constant
(number keys `1`..`LEVELS.length` jump to a level, `r`/`R` reloads, `m`/`M`
returns to Menu — `GameScene.ts:697-705`).

### 3d. `src/scenes/BootScene.ts:24-54` — ordered work

```text
1. cameras.main.setBackgroundColor(theme().paper)     BootScene.ts:25
2. Progress.installLifecycleFlush()                   BootScene.ts:27
3. void Progress.load().then((save) => {  ← the ONLY
     step anything waits on                           BootScene.ts:28
4.   Ads.setAdsRemoved(save.adsRemoved)               BootScene.ts:31
5.   this.scene.start('Menu')                         BootScene.ts:32
6.   void Ads.init()               (background)       BootScene.ts:34
7.   void Iap.init()               (deliberate no-op) BootScene.ts:52
```

Steps 4-7 all run inside the `then` callback; `create()` itself returns
immediately after step 3.

Invariants baked into this order:

- **Step 4 precedes step 5.** The entitlement reaches `Ads` before any scene
  can request an ad, so an owner never sees one flash on the first frame.
- **`Progress.load()` is the only call anything waits on.** Ads and purchases
  are optional; gameplay is not. There are no assets to preload — the whole
  game is vector primitives and system type (`BootScene.ts:4-5`), which is why
  cold start is fast.
- **`Iap.init()` is intentionally empty** (`src/systems/Iap.ts:62-64`). Any
  StoreKit contact at launch puts a "Sign in to Apple Account" dialog over a
  signed-out device before the player has touched anything — and it *reappears*
  after Cancel. The store opens on the first purchase or restore instead
  (`Iap.ts:83-155`). Making `init()` do work re-introduces a repeating login
  wall on first run.
- **Every scene must be reached from Boot.** `MenuScene.create()` reads
  `Progress.data` synchronously at `MenuScene.ts:40`; that is only correct
  because Boot awaited `load()`. Starting any other scene first yields
  `freshSave()` values.

---

## 4. Scene graph

Registered keys come from the `super(...)` call in each constructor:

| Class | Key | File:line |
|---|---|---|
| `BootScene` | `'Boot'` | `src/scenes/BootScene.ts:21` |
| `MenuScene` | `'Menu'` | `src/scenes/MenuScene.ts:32` |
| `LevelSelectScene` | `'LevelSelect'` | `src/scenes/LevelSelectScene.ts:37` |
| `GalleryScene` | `'Gallery'` | `src/scenes/GalleryScene.ts:38` |
| `GameScene` | `'Game'` | `src/scenes/GameScene.ts:112` |

```text
        (auto-start, first in scene[])
                  │
              ┌───▼────┐
              │  Boot  │
              └───┬────┘
                  │ start('Menu')                       BootScene.ts:32
                  │ no payload
              ┌───▼──────────┐
    ┌─────────┤     Menu     ├──────────┐
    │         └───┬────┬─────┘          │
    │ start        │    │ start          │ start('Game', {levelIndex})
    │('LevelSelect')│   │('Gallery')     │ MenuScene.ts:195
    │ MenuScene:101 │   │ MenuScene:112  │  index = clamp(save.unlockedIndex)
    │              │    │                │
┌───▼────────┐  ┌──▼────────┐        ┌───▼──────┐
│ LevelSelect│  │  Gallery  │        │   Game   │
└───┬───┬────┘  └────┬──────┘        └──┬───┬───┘
    │   │            │                   │   │
    │   │ start('Game', {levelIndex: i}) │   │ start('Menu')
    │   │ LevelSelectScene.ts:123 ───────┘   │ GameScene.ts:565 (back)
    │   │                                    │ GameScene.ts:704 (dev key M)
    │   │ start('Menu')  LevelSelectScene:54 │
    │   └────────────────────────────────────┤ start('LevelSelect')
    │                                        │ GameScene.ts:410  (advance past last)
    │      start('Menu') GalleryScene.ts:56  │ GameScene.ts:546  (skip past last)
    └────────────────────────────────────────┘

    Menu → Menu :  this.scene.restart()   MenuScene.ts:204 (after purchase)
                                          MenuScene.ts:213 (after restore == true)
    Game → Game :  NOT a scene change — loadLevel(next) in place
                                          GameScene.ts:413, :547
```

### Payload

The only scene that takes data:

```ts
export interface GameSceneData {
  levelIndex?: number;
}
```
`src/scenes/GameScene.ts:60-62`; consumed at `GameScene.ts:115` and defaulted
at `GameScene.ts:135` (`data.levelIndex ?? 0`).

The index is wrapped, not clamped, at `GameScene.ts:145`:
`((index % LEVELS.length) + LEVELS.length) % LEVELS.length` — negative and
out-of-range indices are legal and wrap in both directions, matching
`levelAt()` (`src/data/levels.ts:92-95`).

### Non-obvious scene facts

- **Level-to-level advance is not a scene restart.** `GameScene.advance()`
  calls `this.loadLevel(next)` in place (`GameScene.ts:413`), so the HUD, the
  input handlers and the `InkRenderer` survive. Only `next >= LEVELS.length`
  leaves the scene, to `'LevelSelect'` (`GameScene.ts:409-412`). Anything added
  to `create()` that must be reset per level has to be reset in `loadLevel()`
  (`GameScene.ts:175-183`) as well.
- **`MenuScene.restart()` after a purchase** is how the menu rebuilds itself
  without the "Remove ads" rows (`MenuScene.ts:76`, `:204`, `:213`).
- **LevelSelect and Gallery each add a second camera** (`LevelSelectScene.ts:140-143`,
  `GalleryScene.ts:135-138`) as a GPU scissor instead of a geometry mask
  (measured ~8 ms/frame for a stencil pass). **Trap:** the two cameras must be
  told to ignore each other's objects, so *anything added to those scenes later
  must join one ignore-list or it draws twice*.
- **Both grids bake into a render texture and must remove it on SHUTDOWN.**
  `saveTexture()` registers the texture with the TextureManager, which holds
  its own reference, so `rt.destroy()` alone leaks it — the level atlas is
  ~22 MB (`LevelSelectScene.ts:204-214`, `GalleryScene.ts:184-189`).

---

## 5. Singleton services

Every service is a module-level instance of a private class, created at import
time. There is no DI container and no reset hook (except `Progress.reset()`,
which has no callers).

| Singleton | Export site | Backing dependency | Native-only? |
|---|---|---|---|
| `Progress` | `src/systems/Progress.ts:304` | `@capacitor/preferences` | No (localStorage on web) |
| `Ads` | `src/systems/Ads.ts:302` | `@capacitor-community/admob` | Yes — `isNative() && adsConfigured()` |
| `Iap` | `src/systems/Iap.ts:197` | `cordova-plugin-purchase` (`CdvPurchase` global) | Yes — `available` is `Capacitor.isNativePlatform()` |
| `Audio` | `src/systems/Audio.ts:173` | Web Audio API (no plugin) | No |
| `Haptics` | `src/systems/Haptics.ts:47` | `@capacitor/haptics` | Yes — web is a no-op |
| `Rate` | `src/systems/Rate.ts:38` | `@capacitor-community/in-app-review` | Yes — `shouldAsk` returns false off-native |
| `Share` | `src/systems/Share.ts:104` | `@capacitor/{filesystem,share}` + Web Share fallback | No |
| `monetization` | `src/config/monetization.ts:90` | `as const` object literal | n/a |

Internal dependencies between singletons:

```text
  monetization ──▶ Progress   (Progress.ts:15, starting stash / daily top-up)
  monetization ──▶ Ads        (Ads.ts:22, all cadence gates)
  monetization ──▶ Iap        (Iap.ts:23, product id)
  monetization ──▶ Rate       (Rate.ts:11, firstPromptAfterWins)
  Progress     ──▶ Iap        (Iap.ts:24, grant/read entitlement)
  Progress     ──▶ Rate       (Rate.ts:12, ratePrompted / totalWins)
  Audio, Haptics, Share: no intra-systems dependencies
```

### Initialisation and state-machine order

- `Progress` starts with `freshSave()` in memory (`Progress.ts:138`) and only
  becomes real after `load()` (`Progress.ts:146-155`), which also applies the
  daily reveal top-up (`Progress.ts:244-251`). **Reads never throw** — a corrupt
  save yields a fresh one.
- `coerce()` (`Progress.ts:89-135`) treats the save as untrusted input. The
  documented failure it prevents: a negative or fractional `unlockedIndex`
  reached `LEVELS[i].name` in `MenuScene` and threw inside `create()`, which
  leaves **no scene running at all** — a blank canvas with nothing to press, and
  the bad save is never rewritten, so every relaunch dies identically.
  `MenuScene.ts:44` re-clamps as belt-and-braces.
- `Ads.init()` is idempotent and self-guarded (`Ads.ts:76`). It replays a
  banner request that arrived before the SDK was ready via the `bannerWanted`
  flag (`Ads.ts:39`, `:103`, `:119-120`) — without it the banner appears only
  when the network is fast.
- `Ads.personalized` defaults to `false` (`Ads.ts:49`); a consent call that
  throws leaves every request carrying `npa=1`. The restrictive default is
  deliberate.
- `Audio` has **no init at boot**. `Audio.unlock()` must run inside a real user
  gesture — iOS refuses otherwise, and a context created at boot arrives
  permanently suspended (`Audio.ts:42-46`). It is called from
  `GameScene.onPointerDown` (`GameScene.ts:189`) and nowhere else.
- `Iap.connect()` is the real initialiser and is lazy (`Iap.ts:83`). It wires
  `approved → grant → finish` **before** `store.initialize()` (`Iap.ts:104-110`),
  because an unfinished transaction is re-delivered on every launch.
  `needAppReceipt: false` (`Iap.ts:128`) is a bug fix, not an optimisation.
- `applyEntitlement(storeSays: boolean | null)` (`Iap.ts:204-206`) upgrades on
  `true` and does nothing otherwise. `restore()` returns `null` for
  "not authoritative" so a network blip can never downgrade a paying user.

### Interruption arbitration

Three things can interrupt the player, and they are ordered rather than
stacked:

1. `Ads.wouldShowInterstitial(levelIndex, winsSinceAd)` — `Ads.ts:175-180`
2. `Ads.wouldShowOnAttempt(levelIndex, attemptsSinceAd)` — `Ads.ts:193-198`
3. `Rate.shouldAsk(adWillShow)` — `Rate.ts:20-26`, stands down when an ad is queued
   (called from `GameScene.ts:368-374`)

Both `wouldShow*` predicates funnel through the private `timingAllows()`
(`Ads.ts:158-169`) so a third call site cannot skip the session warm-up, the
session cap, the rewarded mute or the 120 s floor.
`src/config/monetization.test.ts:90-100` **pins the arithmetic**:
`interstitialEveryNAttempts * 3s < minSecondsBetweenInterstitials`, and the
worst-case gap ≥ 2 minutes. Loosening either gate is an AdMob-account risk, not
a retention trade (`monetization.ts:21-33`).

---

## 6. DOM and native boundaries

Everything that leaves the Phaser world:

| Boundary | Site | Notes |
|---|---|---|
| `window` / `visualViewport` resize | `src/main.ts:50-54` | canvas-rect refresh, see §3b |
| `document.visibilitychange`, `window.pagehide` | `src/systems/Progress.ts:275-278` | flush-on-hide. Chosen over `@capacitor/app` deliberately — WKWebView fires both, so this covers native *and* web with no extra native dependency to sync and rebuild |
| Web Audio (`window.AudioContext` / `webkitAudioContext`) | `src/systems/Audio.ts:51-59` | synthesised; no audio files, no HTTP requests on cold start |
| `document.createElement('canvas')` | `src/render/ShareCard.ts:65`, `:128` | plain 2D canvas, **not** a Phaser WebGL snapshot — the export must be pixel-exact, identical web/device, and renderable with no live scene |
| `navigator.share` / `canShare`, `URL.createObjectURL`, `<a download>` | `src/systems/Share.ts:79-100` | web fallback chain, so the button is never dead |
| DOM `keydown`, via Phaser's `input.keyboard` plugin | `src/scenes/GameScene.ts:693-705` | DEV only; the handler is registered at `:697` |
| Capacitor `Preferences` | `src/systems/Progress.ts:148`, `:291` | UserDefaults / SharedPrefs / localStorage |
| Capacitor `Filesystem` + `Share` | `src/systems/Share.ts:55-66` | writes to `Directory.Cache`, not Documents — a derived artefact has no business surviving in the user's file provider |
| Capacitor `Haptics` | `src/systems/Haptics.ts:41` | fire-and-forget, `.catch(() => {})` |
| AdMob plugin | `src/systems/Ads.ts` throughout | every method swallows its own errors |
| `InAppReview` | `src/systems/Rate.ts:31` | OS gives no callback; throttled to ~3/year |
| `CdvPurchase` global | `src/systems/Iap.ts:88`, `:166`, `:183` | provided by `import 'cordova-plugin-purchase'` (`Iap.ts:22`) |
| `Capacitor.isNativePlatform()` / `getPlatform()` | `Ads.ts:24`, `Haptics.ts:15`, `Share.ts:14`, `Rate.ts:21`, `Iap.ts:56`, `monetization.ts:170` | the single platform predicate |
| Native config read **by a test** | `src/config/monetization.test.ts:5-15` | reads `ios/App/App/Info.plist` with `node:fs`, so `npm test` must run from the repo root and **fails if the iOS project is missing** |

Native values that are duplicated outside TypeScript and must be kept in sync
by hand:

| Value | TS site | Native site | Enforced by |
|---|---|---|---|
| AdMob app id | `monetization.ts:77` (`LIVE_IOS.appId`) | `ios/App/App/Info.plist` → `GADApplicationIdentifier` | `monetization.test.ts:45-55` |
| Paper colour `#E9EBE4` | `Theme.ts:74` | `index.html:11`, `index.html:23`, `capacitor.config.ts:9` | nothing — silent drift |
| App id `com.noqyris.foldwing` | `capacitor.config.ts:4`, `monetization.ts:109` (product prefix) | Xcode project, `package.json:16` (`ios:run`) | nothing |

---

## 7. Build and runtime targets

### Target A — web dev server

```
npm run dev        # vite, host: true, port 5173   (vite.config.ts:11-14)
```
`host: true` binds all interfaces so a phone on the LAN can load it. On the
web: `Capacitor.isNativePlatform()` is false, so `Ads`, `Haptics`, `Rate` and
`Iap` all no-op, `Progress` falls through to localStorage, and `Share` uses the
Web Share / download fallback. `import.meta.env.DEV` is true, enabling
`window.game`, `window.foldwing` and the GameScene dev keys.

### Target B — iOS Capacitor WKWebView

```
npm run build      # tsc --noEmit && vite build      (package.json:9)
npm run ios:sync   # build + npx cap sync ios        (package.json:14)
npm run ios:open   # npx cap open ios                (package.json:15)
SIM=<udid> npm run ios:run                           (package.json:16)
```

- `vite.config.ts:6` — `base: './'`. **Load-bearing:** the bundle is loaded
  from `capacitor://` inside the shell, where an absolute `/assets/...` path
  does not resolve.
- `vite.config.ts:8` — `target: 'es2020'`; `tsconfig.json:3` matches.
- `capacitor.config.ts:6` — `webDir: 'dist'`, the Vite output directory.
- `capacitor.config.ts:11` — `ios.contentInset: 'never'`, paired with
  `viewport-fit=cover` (`index.html:7`) so the paper reaches the physical edge.
- `npm run ios:run` builds with `CODE_SIGNING_ALLOWED=NO` into `.build/ios`,
  installs to `$SIM`, terminates any running instance, then launches.

### Test target

```
npm test           # vitest run                      (package.json:11)
npm run typecheck  # tsc --noEmit                    (package.json:13)
```
`vite.config.ts:15-20`: `environment: 'node'`, `include: ['src/**/*.test.ts']`.

**Trap:** `tsconfig.json:22` is `"include": ["src", "vite.config.ts"]`.
`scripts/genLevels.ts` is therefore **not typechecked** by `npm run build` or
`npm run typecheck`; it is run separately with `npx vite-node scripts/genLevels.ts`
(`scripts/genLevels.ts:20`). A type error there ships silently.

### Release

`fastlane/Fastfile` provides `verify`, `setup_app`, `build_ipa`, `beta`,
`beta_upload` against `ios/App/App.xcworkspace` with `export_method:
"app-store"`. See [11-build-release.md](11-build-release.md) and
[../SUBMIT.md](../SUBMIT.md).

---

## 8. Locked / load-bearing values reachable from this layer

| Thing | Value / rule | Where | Pinned by |
|---|---|---|---|
| Base canvas | `BASE_WIDTH = 750`, `BASE_HEIGHT = 1334`, `PT = 2` | `Theme.ts:30,31,38` | `Theme.test.ts:20-34` |
| Hit radius vs. nib | `hitRadius: pt(2.6)` against `strokePt: 5` — LOCKED | `Theme.ts:125`, `Theme.ts:83` | `Theme.test.ts:65-90` |
| Coordinate system | `x,y ∈ [0,1]` full playfield, axis at `x = 0.5`, `mirror(p) = {1-p.x, p.y}` — LOCKED | `data/types.ts:4-18` | `Playfield.test.ts:52-81` |
| Axis is a soft wall | `clampToDrawable` clamps, never rejects — LOCKED | `Playfield.ts:81-86` | `Playfield.test.ts:89-134` |
| Continuous collision | segment-swept, both sides, every wall — LOCKED | `CollisionSystem.ts:10-13` | `CollisionSystem.test.ts:66-79` |
| Hand-authored levels | the five `TUTORIAL_LEVELS` numbers — LOCKED | `levels.ts:21-83` | `levels.test.ts:38-52` |
| Level count | 5 + 95 = 100 | `levels.ts:89` | `levels.test.ts:25-30` |
| Ad cadence arithmetic | count gate must never outrun the time floor | `monetization.ts:112-148` | `monetization.test.ts:66-109` |
| Native AdMob app id ↔ `useTestAds` | must agree | `monetization.ts:77`, Info.plist | `monetization.test.ts:45-55` |
| Every level solvable | BFS through the real `CollisionSystem` | `core/LevelValidator.ts` | `levels.test.ts:112-123` |

---

## 9. Known contradictions between comment and code

Recorded here because a model reading only the comments would be misled.

1. **Banner placement.** `src/config/monetization.ts:14-15` says a banner lives
   on the menu and level select "and only here. During play a banner would
   either eat the playfield or sit exactly under the thumb."
   `src/scenes/MenuScene.ts:161` repeats "The banner lives here and on level
   select. Never over the playfield."
   The code disagrees: `Ads.showBanner()` is called from **`MenuScene.ts:162`
   and `GameScene.ts:139` only** — never from `LevelSelectScene` or
   `GalleryScene` — and `Ads.ts:111-116` documents it as "Always on, every
   scene." The banner is never hidden except by `setAdsRemoved(true)`
   (`Ads.ts:59`), so in practice it persists across every scene once shown. The
   newer comments (`MenuScene.ts:192-194`, `GameScene.ts:137-138`,
   `Theme.ts:186-195`) describe the shipped behaviour; the two above are stale.

---

## See also

- [00-index.md](00-index.md) — documentation map
- [02-coordinate-system.md](02-coordinate-system.md) — normalized space, the mirror, `Playfield`
- [03-geometry-collision.md](03-geometry-collision.md) — `Geometry`, `CollisionSystem`
- [04-stroke-ribbon.md](04-stroke-ribbon.md) — `StrokeRecorder`, `Ribbon`, `DrawCursor`
- [05-rendering.md](05-rendering.md) — `InkRenderer`, `Theme`, `UI`, `ScrollView`, `ShareCard`
- [06-scenes.md](06-scenes.md) — per-scene detail, HUD, the game state machine
- [07-levels-data.md](07-levels-data.md) — `Level`, `LEVELS`, the shipped set
- [08-level-generation.md](08-level-generation.md) — `LevelValidator`, `scripts/genLevels.ts`
- [09-systems.md](09-systems.md) — the singletons in depth
- [10-monetization.md](10-monetization.md) — ads, IAP, rate, the cadence gates
- [11-build-release.md](11-build-release.md) — Capacitor, Xcode, fastlane
- [12-testing.md](12-testing.md) — the suite and what each file pins
- [13-api-reference.md](13-api-reference.md) — exported symbols, verbatim signatures
- [14-glossary.md](14-glossary.md) — terms
- [15-change-recipes.md](15-change-recipes.md) — "how do I…" playbooks
- [../README.md](../README.md) — narrative rationale for the level ramp and the difficulty metric
- [../SUBMIT.md](../SUBMIT.md) — App Store submission checklist
