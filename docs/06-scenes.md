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
> **1.4 (September 2026) rebuilt the Menu and the win.** §3 (MenuScene), §6.6 (the win
> path), §6.9–§6.10 (rescue and the Reveal pill) and §6.12 (call sites) are rewritten
> for it; the rest of this page is the 1.3 scene layer, whose line numbers are only
> hints. The rules the new surfaces show — missions, bookmarks, chapter marks,
> reminders — are in [09-systems.md](09-systems.md) §6–§7, the store in
> [10-monetization.md](10-monetization.md) §7.

---

# Scenes: Boot, Menu, LevelSelect, Game, Gallery

## What this covers

Screen-by-screen reference for the five Phaser scenes: lifecycle, payloads, what
each builds, every `scene.start()` it issues, and per-scene teardown duties.
GameScene is documented in depth — input state machine, win path, fail path,
dev keys, and the exact order in which Ads / Progress / Audio / Haptics / Rate /
Share are called relative to the visuals.

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `src/main.ts` | 67 | Phaser.Game config; scene registration order; ScaleManager refresh hooks |
| `src/scenes/BootScene.ts` | 55 | Load save, warm ad/store SDKs, hand off to Menu |
| `src/scenes/MenuScene.ts` | — | Home page: streak and balance chips, missions strip, Continue/Play, the Daily card, Levels \| Gallery \| Store, Settings and the sheets, the arrival moments |
| `src/scenes/LevelSelectScene.ts` | 308 | 100-card scrollable grid, baked into one atlas |
| `src/scenes/GameScene.ts` | 707 | The core loop and the input state machine |
| `src/scenes/GalleryScene.ts` | 300 | Every solved maze with its solution, baked into atlases; tap to share |
| `src/render/ScrollView.ts` | 272 | Drag/flick/tap arbitration + culling for both grids |
| `src/render/UI.ts` | 372 | `button`, `label`, `enter`, `tappable`, `TAP_SLOP` |
| `src/render/InkRenderer.ts` | 432 | Everything GameScene draws inside the playfield |

---

## 1. Registry and scene graph

Registration order (`src/main.ts:36`) — the first entry auto-starts:

```ts
scene: [BootScene, MenuScene, LevelSelectScene, GalleryScene, GameScene],
```

Scene keys are set in each constructor: `'Boot'` (`BootScene.ts:21`), `'Menu'`
(`MenuScene.ts:32`), `'LevelSelect'` (`LevelSelectScene.ts:37`), `'Gallery'`
(`GalleryScene.ts:38`), `'Game'` (`GameScene.ts:112`).

```text
                    ┌──────────┐
                    │   Boot   │  create() only; no preload, no assets
                    └────┬─────┘
                         │ after Progress.load() resolves  (BootScene.ts:32)
                         ▼
        ┌─────────────────────────────────┐
        │              Menu               │◄──── restart() on purchase/restore
        │  Continue|Play · Levels ·       │      (MenuScene.ts:204, :213)
        │  Gallery · [Remove ads·Restore] │
        └───┬──────────┬──────────┬───────┘
            │          │          │
   Game{idx}│  Levels  │  Gallery │
            │          ▼          ▼
            │   ┌────────────┐  ┌──────────┐
            │   │LevelSelect │  │ Gallery  │
            │   └──┬──────┬──┘  └────┬─────┘
            │      │ back │Game{i}   │ back
            │      ▼      │          ▼
            │    Menu     │        Menu
            ▼             ▼
        ┌───────────────────────────────────────────┐
        │                  Game                     │
        │  loadLevel(n+1) IN PLACE — no restart     │
        └───┬───────────────────────┬───────────────┘
            │ back btn / dev 'm'    │ next >= LEVELS.length
            ▼                       ▼
          Menu                  LevelSelect
```

Every `scene.start()` in the codebase:

| From | Line | Target | Payload | Trigger |
| --- | --- | --- | --- | --- |
| Boot | `BootScene.ts:32` | `Menu` | — | `Progress.load()` resolved |
| Menu | `MenuScene.ts:101` | `LevelSelect` | — | "Levels" press |
| Menu | `MenuScene.ts:112` | `Gallery` | — | "Gallery" press |
| Menu | `MenuScene.ts:195` | `Game` | `{ levelIndex: index }` | Play/Continue press → `open()` |
| Menu | `MenuScene.ts:204` | *self* `restart()` | — | `Iap.buyRemoveAds()` returned true |
| Menu | `MenuScene.ts:213` | *self* `restart()` | — | `Iap.restore()` returned `true` |
| LevelSelect | `LevelSelectScene.ts:54` | `Menu` | — | back chevron |
| LevelSelect | `LevelSelectScene.ts:123` | `Game` | `{ levelIndex: i }` | card tap (unlocked only) |
| Gallery | `GalleryScene.ts:56` | `Menu` | — | back chevron |
| Game | `GameScene.ts:410` | `LevelSelect` | — | `advance()` past the last level |
| Game | `GameScene.ts:546` | `LevelSelect` | — | `doSkip()` past the last level |
| Game | `GameScene.ts:565` | `Menu` | — | back chevron (after `Progress.flush()`) |
| Game | `GameScene.ts:704` | `Menu` | — | DEV key `m`/`M` |

### Facts that hold for all five scenes

- **No scene defines `init()`, `preload()`, or `update()`.** Only `create()`
  exists. There are no assets: everything is vector primitives and system fonts
  (`BootScene.ts:1-11`).
- Every `create()` starts by painting the camera with the theme's paper colour —
  `theme().paper` inline in Boot (`BootScene.ts:25`) and Game (`GameScene.ts:116`),
  via a local `const t = theme()` in Menu (`MenuScene.ts:36-37`), LevelSelect
  (`LevelSelectScene.ts:41-42`) and Gallery (`GalleryScene.ts:42-43`).
- Per-frame work is Phaser's tween/time managers plus `ScrollView`'s
  `Phaser.Scenes.Events.UPDATE` subscription (`ScrollView.ts:95`). No scene
  polls anything itself.
- `Ads.showBanner()` is called from **Menu** (`MenuScene.ts:162`) and **Game**
  (`GameScene.ts:139`) only. LevelSelect and Gallery never call it — the banner
  is deliberately never torn down between scenes (`MenuScene.ts:192-194`), so it
  simply persists. All four non-Boot scenes still reserve space for it via
  `METRICS.bannerReserve = pt(58)` (`Theme.ts:195`).

---

## 2. BootScene

`create()` (`BootScene.ts:24-54`), in exact order:

1. `this.cameras.main.setBackgroundColor(theme().paper)` — `:25`
2. `Progress.installLifecycleFlush()` — `:27`; binds `visibilitychange` +
   `pagehide` so the 250 ms debounced save is forced out on background
   (`Progress.ts:262-279`).
3. `Progress.load()` — the **only** awaited work. `.then(save => …)`:
   - `Ads.setAdsRemoved(save.adsRemoved)` — `:31`. **Order is load-bearing**:
     the entitlement must reach the ad layer before anything can request an ad,
     or an owner sees a banner flash on frame one.
   - the settings applied (sound, music, haptics, reduced motion, the film's too);
     on the web Daily, straight into today's fold
   - since 1.4: `Nudges.takeRoute()` — a reminder tap that launched the app routes
     to `Game { daily: today }` when today's Daily is open and unfolded; otherwise
     `this.scene.start('Menu')`
   - `void Iap.init()`, deliberately a **no-op**
   - `Nudges.warm()` then `Nudges.rebuild()`, and `Nudges.clearDelivered()` — the
     reminder plan rewritten from the save, never prompting
   - (`Ads.init()` is main.ts's, after the opening film)

Traps:

- Gameplay never waits on an ad SDK. Consequence: Menu's `showBanner()` usually
  lands before the SDK is up; `Ads` remembers the request in `bannerWanted` and
  replays it once the SDK starts. (Since the move to Unity LevelPlay, `Ads.init()`
  is called from `main.ts` after the opening film, not from `BootScene`: the ATT
  alert and the consent modal must not land on top of the film.)
- No silent restore at launch, by design — a StoreKit touch on a signed-out
  device puts a repeating "Sign in to Apple Account" wall over a free game
  (`BootScene.ts:35-51`, `Iap.ts:66-82`).
- Constructs nothing, destroys nothing, registers no SHUTDOWN handler.

---

## 3. MenuScene

`create()`. Payload: none. **Rewritten in 1.4** around one idea — the home page shows
what the player has and what they earned — and one layout for everyone.

**A reminder tap first.** Before anything draws, `Nudges.takePendingRoute(this.registry)`
takes a route a warm reminder tap left (`PENDING_ROUTE`); `'daily'` starts `Game
{ daily: today }` and returns.

**Index clamping** — `nextIndex = Math.min(Math.max(0, save.unlockedIndex), LEVELS.length - 1)`.
Belt-and-braces on top of `coerce()` in Progress: an out-of-range index would
throw inside `create()`, which leaves **no scene running at all** — a blank
canvas with nothing to press, and the bad save is never rewritten, so every
relaunch dies identically.

**Label/action coupling** — `resuming = nextIndex > 0 || save.totalWins > 0`. Both the
caption and the button target derive from `nextIndex`; reading `resuming` off
`totalWins` alone made the button say "Play" and then open level 6 (the state a
rewarded skip leaves).

**Layout is a pure function** — `MenuLayout.menuLayout(footLine, floor)`, tested at
canvas scales 0.317 to 0.626. The 1.3 menu grew a "selling foot" (Remove ads,
Restore) whenever something was for sale, which hid the reveal count from exactly the
players who had not paid; that branch is gone.

| Element | Where (base units) | What |
| --- | --- | --- |
| Streak chip | top bar, `TOP_BAR_Y` = pt(52), left | flame + streak + one bookmark glyph per bookmark; faint at 0; the repairable run faint with an accent dot; hidden until the first Daily finish; opens the Streak sheet |
| Balance chip | top bar, right-aligned | eye + count + an accent "+" where the store sells (`storeSells()`); ∞ for owners; opens the store. Hidden in the first session |
| ••• | top bar | Settings |
| Missions strip | `STRIP_Y` = pt(100), fixed under the bar | three tokens (ring or check + short label), one tap target, opens the Missions sheet; shown once missions are open |
| Wordmark / tagline | pt(211) / pt(285) | the reflecting wordmark; "draw one line. its mirror must survive too." before the first win |
| Play / Continue | `STACK_TOP` = pt(321), `PLAY_H` pt(66) | sub "N. Name · 9 of 20 in chapter 3" |
| Daily card | `DAILY_H` pt(88) | `DailyCard`: six faces, the week strip, "#53 · Tue 22 Sep" |
| Levels \| Gallery \| Store | `TRIO_H` pt(54), thirds | "Store" only where there is a store, not for owners, and not in the first session; NEW badge until the starter has been seen |
| Stats line | label, 0.75 | "Fold Sense 62 · 112 folded · 47 medals", counted against LEVELS; hidden while nothing is folded |

The stack lifts at most `PAGE_LIFT_MAX` (pt(30)) toward the top and then closes its row
gaps from pt(11) to pt(4) before the stats line goes; nothing ever crosses the foot
line above the banner, every row uses `minTap` capped by the layout's `tapMax`, and
the tagline keeps pt(16) clear of the primary button. **The first session**
(`DailyCard.firstSession`: tutorial not done, no Daily ever) shows none of the
economy: no balance chip, no Store, a locked Daily card, no gift said.

**What arrived is said on entering**, as toasts and never as a modal, one at a time, in
this order: a bookmark that kept the streak, chapters folded before marks existed (the
backlog, paid by `settleChapterMarks('backlog')` here), the day's free reveal, a
purchase or restore (`MENU_CELEBRATE`), the streak going up after a Daily
(`MENU_STREAK_FROM`). Each flies a token into the chip it changes. The grants are
already in the save — a moment only shows them — and unplayed moments carry across a
restart in the registry. The gift waits for the opening film to be gone. Every toast
goes through `say()`: with a sheet up it is placed above the sheet's card, and the
answer to a tap is `urgent`, shown at once rather than behind the news.

**Sheets** — Settings, Store, Streak, Missions — set `sheetOpen`, which `refit()`
(a resize), the midnight rollover and a warm reminder tap all wait on. Settings rows:
Sound, Music, Haptics, Reduced motion (toggles fire on release, with
`Haptics.select()`), Reminders (where a reminder can be delivered; "Daily fold · around
7 pm" or "off in iOS Settings"), Leaderboard | Achievements (with Game Center), Rate
Foldwing | Restore purchases (Restore where there is a store), Privacy choices (where
there is an ad SDK), then "Foldwing 1.4" — five taps on it show the diagnostic line —
and [Close].

**The midnight rollover** unsubscribes the grant listener *before* the new day's
top-up and restarts the scene, so the gift waits in `takeUnshownGrants()` for the
rebuilt menu instead of reaching one that is shutting down.

Teardown: the SHUTDOWN handler unsubscribes `onGrant` and carries unplayed moments.
`button()` removes its own scene-level `POINTER_UP` listener on container destroy.

---

## 4. LevelSelectScene

`create()` (`LevelSelectScene.ts:40-156`). Payload: none. Module constants:
`COLS = 3` (`:32`), `GAP = pt(10)` (`:33`).

Geometry:

| Name | Expression | Line |
| --- | --- | --- |
| `margin` | `METRICS.inset.left + pt(10)` | `:45` |
| `top` | `pt(120)` | `:74` |
| `bottom` | `BASE_HEIGHT - METRICS.bannerReserve - pt(6)` | `:75` |
| `cardW` | `(gridW - GAP * (COLS - 1)) / COLS` | `:78` |
| `cardH` | `cardW * 0.94` | `:79` |
| `contentHeight` | `rows * (cardH + GAP) + GAP` | `:83` |

Header: back chevron `‹` (`:47`), title `Levels` (`:58`), counter
`` `${cleared} of ${LEVELS.length} folded` `` (`:64`). `enter(this, [back, title, counter], 32)` (`:155`).

**Card atlas (`bakeCards`, `:174-216`)** — key `'foldwing-level-cards'`.
Every card is drawn once into one `RenderTexture` and each card becomes an
`Image` frame of it, so 100 cards are one texture and one draw call. Why:
Phaser replays a Graphics command list every frame, so with only the visible
rows drawn the previews cost **30 ms/frame** and the card backgrounds another
**25 ms**, against a 16 ms budget (`:158-173`). Slot size is `w + pad*2` /
`h + pad*2` with `pad = pt(9)` for the drop shadow; `cols = Math.max(1, Math.floor(2048 / slotW))`
keeps the atlas inside the smallest plausible max-texture-size.

**Two-camera clipping (`:128-143`)** — a second camera
`this.cameras.add(0, top, BASE_WIDTH, bottom - top)` with `setScroll(0, top)`
clips the grid via a GPU scissor. A geometry mask was measured at **~8 ms per
frame**, half the frame budget. **Invariant:** the cameras must ignore each
other's objects — `grid.ignore([back, title, counter])` and
`this.cameras.main.ignore(content)`. Anything added to this scene later must
join one list or the other or it draws twice.

**Input** goes through `ScrollView` (`:145`), never per-card interactives:
scrolling and tapping are the same gesture until the finger commits, and only
the object that owns the drag can tell them apart (`:9-12`). Locked cards are
still registered as rows with `onArm`/`onTap` left `undefined` (`:98-125`) —
`ScrollView.hit()` skips rows without `onTap` (`ScrollView.ts:130`), but the row
must exist so culling can hide it.

**Restore scroll position (`:149-153`)**: if `reached > COLS * 3` (i.e. > 9),
`view.scrollTo(targetRow * (cardH + GAP) - (bottom - top) / 2)`.

Card art (`buildCardArt`, `:218-268`) and the miniature level preview
(`buildPreview`, `:271-307`) draw from the same normalized `Level` data the game
uses: axis line at `x + w/2`, walls at `t.wall` alpha `0.85 * dim`, start disc
`pt(2.4)` and goal ring `pt(3.2)` at `t.accent` alpha `0.9 * dim`, plus their
reflections at `1 - level.start.x` / `1 - level.goal.x` with alpha `0.26 * dim`.
`dim = unlocked ? 1 : 0.5`; a locked card also gets `setAlpha(0.5)`.

**Teardown (`:211-214`) — mandatory.** The atlas is ~22 MB. Destroying the
`RenderTexture` is *not* enough: `saveTexture` registers the texture with the
TextureManager, which keeps its own reference. The SHUTDOWN handler does both
`rt.destroy()` and `this.textures.remove(key)`. Verified: without the explicit
remove the atlas was still resident after returning to the menu.

---

## 5. GalleryScene

`create()`. Payload: none. Same `COLS = 3` / `GAP = pt(10)`.

- Header: back `‹` at `pt(56)`, title `Gallery`, subtitle
  `'1 figure'` / `` `${figures.length} figures` `` at `pt(96)`.
- `figures = Progress.figures` — the getter returns **newest first**.
- Empty state: two labels, `'Nothing folded yet.'` and
  `'Clear a level and its figure lands here.'`. **No grid, no second camera, no
  atlas, no ScrollView** are created in this branch.
- Populated branch: `top = HEADER.listTop` (shared with LevelSelect),
  `bottom = listBottom(Ads.enabled)` — the banner reserve only where a banner
  can show — and `cardH = cardW * CARD_ASPECT` with `CARD_ASPECT = 1.5`. Cameras
  → `ScrollView` as LevelSelect, but the cards bake progressively behind blank
  placeholders (see 05-rendering §6), and the grid camera renders BEFORE the
  main one so sheets and cards drawn on the main camera land on top. Every row
  has `onArm` and `onTap` (no locking); the list ignores presses for its first
  300 ms and while a sheet is open.
- `enter(this, entering, 26)`.

**What a card shows.** The whole maze, the line that solved it, its reflection,
and the time. Not the closed figure alone: that was a handsome grid that told
you nothing — which maze, how hard, how the line got there — and it was
illegible to whoever the player sent one to. Layout comes from
`render/FigureCard.ts`, the same module the share card uses, so the card in the
grid is the card that leaves the phone. A figure saved before mazes were kept
carries no `walls` and falls back to the bare figure, cropped to its own ink.

**Why the bake exists** — a card is a ribbon of dozens of `fillPoints` calls
re-triangulated every frame. Measured: **one** saved figure took the Gallery
from 16.7 ms/frame to **583 ms**; six figures ~330 ms; 33 figures stopped it
rendering at all. The save keeps up to `MAX_FIGURES = 120`.

Atlas keys `'foldwing-gallery-cards-<first>'`, one sheet per `ATLAS_MAX = 2048`
square, with the same SHUTDOWN obligation. Several sheets rather than one
because the old code bounded only the WIDTH: 120 figures baked a 2025 × 4802
texture, past the 4096 limit of anything older than an A11, where the grid comes
back blank. Card art: shadow + paper + `t.ink` 0.022 wash, `paintFigureInto`
into the box inset by `pad = pt(5)` and `pt(14)` shorter at the bottom, plus a
`` `${(figure.ms / 1000).toFixed(1)}s` `` label.

A card tap opens `chooseShare(figure)` — a sheet with "Share the replay" (where
`replayVideoSupported()`) and "Share this fold", dimming the page with it. The
picture: re-entrancy guarded by `this.busy`;
`renderShareCard(figure, shareCardOptions(figure))` → `Share.shareFigure({ dataUrl, title: 'My foldwing', text: shareText(figure), fileName: shareFileName(figure.levelName, 'png') })`,
with `busy` cleared in `finally`. The replay renders behind `progressCard`,
which offers Cancel after 2 s and is aborted at 45 s (the same bounds as the
win screen's — see 09-systems, Share). If `renderShareCard` returns falsy the function
returns early (still clearing `busy`). `shareCardOptions` and `shareText` live in
`render/ShareCard.ts` and are shared with the win-screen share pill, so both
carry the same caption and the same "Can you beat me?".

---

## 6. GameScene

### 6.1 Payload

Verbatim (`GameScene.ts:58-62`):

```ts
type Phase = 'idle' | 'drawing' | 'failed' | 'won';

export interface GameSceneData {
  levelIndex?: number;
}
```

`create(data: GameSceneData)` uses `data.levelIndex ?? 0` (`:135`), and
`loadLevel` wraps it both ways: `((index % LEVELS.length) + LEVELS.length) % LEVELS.length`
(`:145`). A missing or negative payload can therefore never throw.

### 6.2 `create()` order (`:115-140`)

1. camera background ← `theme().paper`
2. `this.pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)`
3. `this.recorder = new StrokeRecorder(METRICS.sampleMinDist)`
4. `this.ink = new InkRenderer(this, this.pf)` — allocates the five Graphics
   layers at depths 10/15/18/20/40 (`InkRenderer.ts:25-32`, `:108-113`)
5. `this.buildHud()` — HUD objects at `setDepth(50)`, above every ink layer
6. three scene-level input bindings: `POINTER_DOWN`, `POINTER_MOVE`, `POINTER_UP`
7. `if (import.meta.env.DEV) this.bindDevKeys()`
8. one SHUTDOWN handler: `this.failTimer?.remove(); this.ink.destroy();`
9. `this.loadLevel(data.levelIndex ?? 0)`
10. `void Ads.showBanner()` — **after** the board is built

### 6.3 `loadLevel(index: number): void` (`:144-184`)

Levels advance **in place**; the scene is never restarted between levels. So
every piece of per-level state must be reset here explicitly — this is the
single most breakable invariant in the file.

Order: wrap index → `levelAt()` → walls to pixels via `pf.toScreenRect` →
`startPx`/`goalPx` → `new CollisionSystem(walls, METRICS.hitRadius, this.pf.axisX)`
→ `mirrorBands` → `gates` → `attempts = 0` → `advancing = false` →
`Audio.resetScale()` → `ink.clearReveal()` → `resetToIdle()` →
`ink.drawLevel(walls, startPx, goalPx)` → `clearSkipOffer()` →
`clearShareOffer()` → `refreshHud()`.

**Mirror bands (`:157-159`)** — every wall reflected across the axis, keeping
only those that land on the drawable (left) half:

```ts
this.mirrorBands = walls
  .map((w) => ({ x: 2 * axis - (w.x + w.w), y: w.y, w: w.w, h: w.h }))
  .filter((w) => w.x < axis && w.x + w.w > this.pf.x);
```

A left wall mirrors into the right half and drops out; a right wall mirrors onto
the player and *is* the constraint they cannot see. This array is exactly what a
reveal paints (`:424`).

**Gates (`:167-173`)** — one per obstacle *row*, deduped by rounded vertical
midpoint over walls ∪ mirrorBands, sorted **descending** (bottom-first), each
`{ mid, passed: false }`. Crossing a row alive earns a note, so a level plays as
a rising phrase.

Not reset by `loadLevel`: `advanceReadyAt`, `touchAnchor`, `touchInput`,
`strokeStartedAt`, `sharing`. All are written before they are next read, so this
is safe today — but adding a read path without a write path breaks it.

### 6.4 Input state machine

```text
                    pointerdown within
                    startRadius*startGrabFactor of startPx
        ┌──────┐    (tested against the FINGER, not the cursor)   ┌─────────┐
        │ idle │ ────────────────────────────────────────────────►│ drawing │
        └──────┘                                                  └────┬────┘
           ▲  ▲                                                        │
           │  │  pointerup, no goal reached (no penalty)               │
           │  └────────────────────────────────────────────────────────┤
           │                                                           │
           │  after METRICS.failFlashMs = 400ms                        │ pointermove
           │  OR immediately on any pointerdown                        │ segment vs
        ┌──┴─────┐                                                     │ walls+mirror
        │ failed │◄────────────────────────────────────────────────────┤ (continuous)
        └────────┘   collision.blocks(prev,cursor) and                 │
                     (goalT === null || goalT >= hitT)                 │
                                                                       │
        ┌─────┐      segCircleEntryT(prev,cursor,goalPx,goalRadius)     │
        │ won │◄─────────────────────────────────────────────────────── ┘
        └──┬──┘      !== null AND (not blocked OR goalT < hitT)
           │
           │ pointerdown, time.now >= advanceReadyAt, NOT over the share pill
           ▼
        advance() ──► [maybe interstitial] ──► loadLevel(n+1)  |  scene.start('LevelSelect')
```

| From | To | Trigger | Site |
| --- | --- | --- | --- |
| `idle` | `drawing` | `pointerdown` with `dist(finger, startPx) <= METRICS.startRadius * METRICS.startGrabFactor` = `pt(10) * 2.4` | `:205-217` |
| `idle` | `idle` | `pointerdown` farther than the grab radius — silently ignored | `:210` |
| `drawing` | `failed` | `collision.blocks(prev, cursor)` and not a goal-first segment | `:245-251` |
| `drawing` | `won` | `segCircleEntryT(prev, cursor, goalPx, METRICS.goalRadius) !== null`, or blocked-but-`goalT < hitT` | `:249`, `:254-257` |
| `drawing` | `idle` | `pointerup` from the active pointer before the goal — **no penalty**; also `POINTER_UP_OUTSIDE` (a mouse released off the canvas) and a move with no button held | `onPointerUp`, `onPointerMove` |
| `drawing` | `idle` | the canvas really moved or resized under the stroke (rotation, a fold, Split View — `onCanvasMoved` on `Scale.Events.RESIZE`, keyed on the rounded canvas bounds) — abandoned as a lift: no death, no flash. The next move would otherwise map to a different board point and join the two through a wall | `onCanvasMoved` |
| `failed` | `idle` | `failTimer` after `METRICS.failFlashMs` (400) | `:312-317` |
| `failed` | `idle` | **any** `pointerdown` — abandons the flash immediately, same event then falls through to the idle grab test | `:202-203` |
| `won` | (next level) | `pointerdown` with `this.time.now >= this.advanceReadyAt`, not over the share row, not in the header band, and not while a share is in flight or within `SHARE_QUIET_MS` (400) of one settling | `onPointerDown` |
| any | `idle` | `loadLevel()` → `resetToIdle()` | `:179` |

Pointer filtering: only events whose `pointer.id === this.activePointer` are
honoured in `pointermove`/`pointerup` (`:229`, `:278`). `activePointer` is set at
`:212` and cleared in `fail()` (`:303`), `win()` (`:332`), `resetToIdle()` (`:386`).
`main.ts:29` allocates `activePointers: 3` precisely so a *second* finger can
restart while the drawing finger is still down during the 400 ms flash.

### 6.5 Per-event / per-frame order

GameScene has **no `update()`**. Ordering is:

```text
Phaser frame
 ├─ input events  → onPointerDown / onPointerMove / onPointerUp
 │    onPointerMove (:228-263), the hot path, in this exact order:
 │      1. phase/pointer-id guard
 │      2. prev = recorder.last                        (raw sample, not smoothed)
 │      3. cursor = cursorFor(pointer)                 = clampToDrawable(drawCursor(raw))
 │      4. blocked = collision.blocks(prev, cursor)    CONTINUOUS, whole segment
 │      5. goalT   = segCircleEntryT(prev, cursor, goalPx, goalRadius)
 │      6. if blocked → compare goalT vs firstHitT → win() or fail()
 │      7. else if goalT !== null → win()
 │      8. else recorder.push() → ink.drawStroke() → ringGates()
 ├─ TimerEvents   → failTimer (400ms) → resetToIdle() → maybeAdOnRetry()
 │                  Rate delayedCall (readyIn + 400)
 ├─ Tweens        → fail wash fade, win settle, reveal in/out, hint fade,
 │                  share/skip pill fade, button scale dips
 └─ render by depth: level 10 · reveal 15 · mirror 18 · stroke 20 · win 30 ·
                     wash 40 · HUD 50
```

Steps 4–5 are **LOCKED** (`:236-241`): pointer samples arrive about once per
frame, so during a flick `prev` and `cursor` can be hundreds of pixels apart, and
anything that only inspected endpoints would wave the stroke through a wall.
Step 6 exists because one long segment can reach both a wall and the goal —
whichever the gesture arrived at *first* is what happened.

`cursorFor` (`:284-296`) feeds `travelPx: dist(raw, this.touchAnchor)` —
**travel, not elapsed time**. A finger resting on the glass must not drag the
collision-tested cursor with it.

`ringGates(from, to)` (`:266-275`): for each unpassed gate, `crossed = from.y > gate.mid !== to.y > gate.mid`;
on a crossing it sets `passed = true` and fires `Audio.note()` then
`Haptics.tick()`. Gates are re-armed at every `pointerdown` (`:221`).

### 6.6 Win path — exact order (`win(entry: Vec2)`, rewritten in 1.4)

1. `recorder.pushExact(entry, at)` — the ink terminates at the true
   goal-entry point, not at the last sample; `at` is the input event's time.
2. `phase = 'won'`, `activePointer = null`
3. `elapsed = at - this.strokeStartedAt`. On a Daily, `dailyFirstFinish =
   !Progress.hasDaily(date)` is read BEFORE the ledger records it: only a first
   finish submits to Game Center, rebuilds the reminders and counts toward
   `totalWins`/`winsSinceAd`; a replay's share describes the recorded run.
4. **`before = Progress.snapshotForWin(level.id, levelIndex)`** — everything that is
   "new" (first clear, a medal already held, the previous best, the streak, whether
   missions were open) is read before any write, and the streak guard runs first.
5. `Progress.recordWin(...)`, the medal, Fold Sense, `recordDaily` — as before.
6. **`outcome = Progress.settleWin(before, facts)`** — missions, chapter marks,
   streak milestones and bookmarks, in ONE update (not on the web Daily). A win that
   first opens the Daily also rebuilds the reminders.
7. `Progress.addFigure({...})` — normalized so the same figure redraws at 1080×1080 in
   a share card.
8. **`this.ink.presentWin(...)` — the figure is on screen**, with the accent
   `creaseSweep` down the axis, and `Audio.celebrate(medal)`.
9. `readyIn = ms(winHoldMs) + ms(winSettleMs) + ms(250)` ≈ **780 ms**;
   `advanceReadyAt = this.time.now + readyIn`. One number for the tap gate and the
   card's buttons going live.
10. `presentResult(outcome, …)` builds the result card and schedules its timeline
    (below), and returns `winQuiet`: whether the card asks for something itself.
    The web Daily keeps its old win screen — share row, verdict, win prompt — and
    none of this.
11. `adWillShow = !winQuiet && Ads.wouldShowInterstitial(onboardingIndex, winsSinceAd)`
    — a **non-consuming predicate** — and `Rate.shouldAsk({ adWillShow, quiet:
    winQuiet, win })` with the win's facts; at a peak, `Rate.ask()` after
    `readyIn + 400` if the player is still on this win.

**The timeline** (`WIN_BEAT`, every time through `ms()`, every timer guarded by the
level token and the win sequence):

| t (ms) | Event |
| --- | --- |
| 0 | the figure, the crease sweep, `Audio.celebrate` |
| 180–530 | the figure settles (as in 1.3) |
| 530 | droplets at the goal; `Haptics.land()` (not on a medal); the board steps back to 0.74 about (375, 88) — 0.70 on a Daily, less if a crowded card needs it, never below 0.5; `ui.winFrameScale: 1` turns the move off |
| 620–940 | the result card rises pt(12) and fades in |
| 700 | the medal stamp, `Haptics.success()` |
| ≈780 | the tap gate opens; the card's buttons go live |
| 940 | the chapter cell fills (a gold flash on 20/20 with `Audio.reward()`); on a Daily the streak number flips with `Audio.streakUp()` |
| 1200 | reward tokens fly to the Reveal pill (bookmarks to the flame) |

**The card** (`render/ResultCard.ts`; its layout is the pure, tested
`resultCardLayout`, which keeps its top clear of the scaled board and its bottom above
the banner). Campaign: the verdict ("Medal · the best line there is", "38% over the
best line · medal at 25%"), the time ("12.3 s · best 10.8 s", "new best · 9.4 s",
"replayed · best 10.8 s"), the chapter as a 20-cell bar with +1 / +2 markers, the
reward lines, and [Share] [Next fold] — a single [Next fold] on levels 1–3, "Finish" on
300. Crossing 20/20 makes "Chapter 3 complete" the first line. Daily: the flame and
"7-day streak" (a milestone day leads with its title, "A week of folds"), "Daily #53 ·
0:48 · 2 retries", the reward lines, and [Leaderboard] [Share] [Done]. One ask at most:
the soft reminder ask ("Tomorrow's fold lands at midnight." [Remind me]) or the chapter
doubler ("Watch an ad → +2 more reveals"), never both.

**Taps.** Before the gate, ignored. After it, a tap anywhere but the card's buttons —
the header band included, bar the back button and the Reveal pill — advances.

**The interstitial is NOT fired here.** It fires only in `advance()`, after the player
has seen the figure and chosen to leave:

```ts
private async advance(): Promise<void> {
  if (this.advancing) return;
  if (Ads.busy) return;
  this.advancing = true;
  this.resultCard?.setLive(false);          // no Share or [Remind me] under a loading ad
  if (!this.winQuiet && Ads.wouldShowInterstitial(this.onboardingIndex, Progress.data.winsSinceAd)) {
    const shown = await Ads.showInterstitial(stillWanted);
    if (shown) Progress.update({ winsSinceAd: 0, attemptsSinceAd: 0 });
  }
  // … the next level, or LevelSelect past the end
}
```

Three invariants here: the counters are spent **only when an ad actually rendered**
(no-fill leaves them armed), a card that asked something is never followed by an
interstitial, and `advancing` is a re-entrancy latch cleared only by `loadLevel`.
`installLevel` clears the card and, in DEV, asserts `ink.frameIsIdentity`: a board left
framed after Next is a bug.

### 6.7 Fail path — exact order (`fail(contact: Vec2)`, `:300-327`)

1. `recorder.pushExact(contact, this.time.now)` — ink stops at the contact point
2. `phase = 'failed'`, `activePointer = null`
3. `Haptics.thud()`
4. `Audio.thud()`
5. `this.ink.flashFail(...)` — redraws the stroke in `t.fail` and fades a
   full-screen wash from alpha `0.1` over `METRICS.failFlashMs`
   (`InkRenderer.ts:203-219`)
6. `Progress.update({ attemptsSinceAd: Progress.data.attemptsSinceAd + 1 })`
7. arm `failTimer = this.time.delayedCall(METRICS.failFlashMs, …)` → inside:
   `failTimer = null`, `resetToIdle()`, **then** `void this.maybeAdOnRetry()`
8. if `this.attempts >= monetization.reveals.offerSkipAfterAttempts` (6) **and**
   `!this.skipPill` **and** `Ads.rewardedAvailable` → `showSkipOffer()`

**No tap is required to retry.** After 400 ms the board is clear and `phase` is
`idle`; reaching for the start dot during the flash abandons it immediately
(`:202`). There is no modal and no defeat screen — the retry loop is the product
(`:12-13`, `InkRenderer.ts:199-202`).

`maybeAdOnRetry()` (`:444-452`):

```ts
if (this.phase !== 'idle' || this.advancing) return;
if (!Ads.wouldShowOnAttempt(this.levelIndex, Progress.data.attemptsSinceAd)) return;
const shown = await Ads.showInterstitial();
if (shown) Progress.update({ attemptsSinceAd: 0 });
```

The board is already reset when this runs, so the player closes the ad into a
level ready to draw, never into a red flash. `wouldShowOnAttempt` requires
**both** axes — `timingAllows()` (`enabled`, `levelIndex >= interstitialFromLevel`
= 8, session cap of 4, 90 s warm-up, rewarded mute, hard 120 s floor) **and**
`attemptsSinceAd >= monetization.ads.interstitialEveryNAttempts` (5)
(`Ads.ts:158-198`). Loosening either
is the failure mode that gets an ad account disabled (AdMob's then, LevelPlay's now); `monetization.test.ts:90-100`
pins the arithmetic (`interstitialEveryNAttempts * 3s < minSecondsBetweenInterstitials`,
and `minSecondsBetweenInterstitials / 60 >= 2`).

### 6.8 `resetToIdle()` (`:377-390`)

`failTimer?.remove()` + null → `recorder.clear()` → `ink.clearStroke()` →
`ink.clearWin()` → `phase = 'idle'` → `activePointer = null` →
`clearShareOffer()` → `hideHint()` → `refreshHud()`.

Note it does **not** clear the skip offer — the skip pill deliberately survives
retries and is removed only on win (`:351`) or level load (`:181`).

### 6.9 Reveal, rescue, share

| Action | Entry | Flow |
| --- | --- | --- |
| Reveal | reveal pill tap → `doReveal()` | no-op while `phase === 'won'` or `Ads.busy`; a tap while the bands are still up spends nothing; if `Progress.spendReveal()` → `ink.showReveal(...)` (the accent hatch, six seconds, with a draining underline on the pill); else `showRefillSheet()` — the shared store sheet as "Out of reveals" (`kind: 'refill'`). A reveal earned or bought there while the board is idle on the same level is **used at once**: it flies to the pill, the walls show, "+1 reveal · showing the folded walls". A late Ask to Buy pack that lands there is used the same way. A `null` sheet (no store at all) falls back to the hint "out of reveals — one more lands tomorrow" |
| Rescue | the ladder in `core/Rescue.ts`, after every death | at 3 deaths the reveal offer ("Show the folded walls · 1 of 7", "Show the folded walls" for an owner, "Watch an ad → see the folded walls", "See the folded walls?" to the refill sheet); at 6 the skip ("Watch an ad → skip this fold", or "Skip this fold" free) — unless the player could still look and has not on this level, when the reveal offer stays until 9. Never a skip on a Daily. See [10-monetization.md](10-monetization.md) §5.4 |
| Skip | skip pill → `doSkip()` | the pill keeps the promise it was drawn with (`Rescue.skipDrawnFree`): "Skip this fold" never plays an ad, and Remove Ads bought mid-level redraws an ad pill as free. `Ads.showRewarded('skip', stillWanted)`: `'declined'` / `'abandoned'` skip nothing; `'unavailable'` skips anyway; `'earned'` unlocks the level it was requested for even if the player has left. Then `loadLevel(next)` or `scene.start('LevelSelect')` |
| Share | the card's [Share] → `pressShare()` | the two-option chooser ("Share the replay" where WebCodecs can encode, "Share this fold") or straight to the figure; `Share.shareFigure({ dataUrl, title: 'My foldwing', text, fileName })` |

The rescue pills are placed by `Rescue.rescueSpot`: in the band between the start dot's
**grab zone** and the banner line, never over the board or the first stretch of the
last attempt's ghost — 1.3 put them in the runway above the dot, exactly where the ghost
leaves it — and never inside the grab zone, where a press starts a stroke instead of
answering the pill. They are hidden and disabled while a stroke is live, and re-laid
out on every resize.

**Failure that teaches.** A death draws a contact ring where the line died (at the
reflected point for a mirror death) and flashes the wall that did it; the ghost of the
last attempt is stronger (alpha 0.26) with an × at the death — two, for a mirror death.
The first mirror death ever also says "your reflection hit that wall", flashes it twice
and leaves the reflected stroke at ghost strength (`Progress.teach('mirror')`). A
near-miss line ("attempt 4 · furthest yet 74%") appears only on a new best of 20% or
more, from `core/RouteProgress.ts`'s distance field. Level 1 shows a ghost hand drawing
the first pt(90) of the proved route and its mirror until the first press. No screen
shake.

### 6.10 HUD (`buildHud` `:552-602`, `buildRevealPill` `:605-663`, `refreshHud` `:665-672`)

| Object | Position | Depth | Content |
| --- | --- | --- | --- |
| back `‹` button | `(METRICS.inset.left + pt(18), pt(26))` + `layoutHud`'s shift, ghost | 50 | `Haptics.tap()` → `void Progress.flush()` → `scene.start('Menu')` |
| `titleText` | `(BASE_WIDTH/2, pt(26))`, `FONT.display`, `TYPE.body` | 50 | `` `${this.levelIndex + 1}. ${this.level.name}` `` |
| `revealPill` | `(BASE_WIDTH - METRICS.inset.right - pt(42), pt(26))`, `pt(74)×pt(34)` | 50 | eye glyph + count: ≥ 3 plain; 1–2 in accent (not red); 0 — an accent "+" disc replaces the count, full opacity, and a tap opens the refill sheet, wherever something can refill it (else faded to 0.35); ∞ for an owner. The count counts up whenever the balance changes on screen |
| `attemptText` | `(BASE_WIDTH/2, pt(47))`, `FONT.ui`, `TYPE.micro`, ink 0.8 | 50 | `` `attempt ${this.attempts}` `` when `attempts > 0`, else `''`; the near-miss line takes it after a death |
| `hintText` | `(BASE_WIDTH/2, BASE_HEIGHT - METRICS.bannerReserve - pt(4))`, origin `(0.5, 1)`, alpha 0 | 50 | set by `showHint()` |

`layoutHud()` re-runs on every `Scale.Events.RESIZE` and level install. It
moves the header row down by whatever safe-area inset the canvas does not
already clear (`SafeArea.canvasInsets`) — which is 0 on every device now that
index.html fits the canvas into the safe area, so the row stays at its designed
place; the code remains as the guard. The HUD also repaints on every return to
the foreground, so a daily reveal topped up by main.ts shows at once.

`revealCount` prints `'∞'` when `Progress.reveals === Number.POSITIVE_INFINITY`
— which is what owning Remove Ads produces (`Progress.ts:220-224`).

The reveal pill re-implements `UI.button`'s gesture rule rather than using it
(`:637-661`): arm on the container's `pointerdown`, resolve on the **scene's**
`POINTER_UP`, reject on `Phaser.Math.Distance.Between(...) > TAP_SLOP`
(`TAP_SLOP = pt(14)`), then a manual bounds test against the 44pt tap
height. A touch the system cancelled (`pointer.wasCanceled` — a fold or
rotation under the finger) is not a tap, here and in `UI.button`. Judging by
distance rather than by `pointerout` is why buttons in this game stopped needing
two or three stabs. Its listener is unbound on container `destroy` (`:660`).

### 6.11 Dev-only keyboard shortcuts

Gated by `if (import.meta.env.DEV) this.bindDevKeys();` (`:128`).
`import.meta.env.DEV` is a Vite compile-time constant, `false` in `vite build`,
so the whole call and body are tree-shaken out of the production bundle — the
same mechanism used for the `window.game` handle (`main.ts:56-63`).

`bindDevKeys` (`:693-706`) attaches one `keydown` handler to
`this.input.keyboard` (returns early if the plugin is absent):

| Key | Effect | Line |
| --- | --- | --- |
| `1`–`9` | `loadLevel(n - 1)` — `Number.parseInt(event.key, 10)`, accepted when `Number.isInteger(n) && n >= 1 && n <= LEVELS.length` | `:698-702` |
| `r` / `R` | `loadLevel(this.levelIndex)` — restart the current level | `:703` |
| `m` / `M` | `scene.start('Menu')` — note: **no `Progress.flush()`**, unlike the back button | `:704` |

`event.key` is a single character per keystroke, so the `n <= LEVELS.length`
bound (100) is never actually reached; keys `1`–`9` are the practical range.

### 6.12 Monetization / systems call sites in GameScene

| System call | Where | When, relative to visuals |
| --- | --- | --- |
| `Ads.showBanner()` | `:139` | end of `create()`, after the board exists |
| `Ads.rewardedAvailable` | — | at draw time: whether the skip is drawn free, whether the three-death offer and the doubler are drawn at all |
| `Ads.wouldShowInterstitial` | — | asked in `win()` **only** to silence `Rate`; acted on in `advance()` unless the card was quiet |
| `Ads.showInterstitial(stillWanted)` | — | after the win is dismissed; after the fail flash + reset (not while a rescue pill is up) |
| `Ads.showRewarded('reveal-offer' \| 'skip' \| 'chapter-double')` | — | opt-in only; the store sheet's `'reveal'` and the Streak sheet's `'repair'` are the other two placements |
| `Progress.snapshotForWin` / `recordWin` / `settleWin` / `addFigure` | — | before `presentWin` — the save is written first, the reward is drawn second |
| `Progress.canAdPay` / `payAdReveals` | — | the three-death offer (1) and the doubler (2) — the daily ad cap |
| `Progress.onGrant` | `create()`, unsubscribed on SHUTDOWN | presents only the day's free reveal landing mid-level and a late purchase |
| `Progress.update(attemptsSinceAd+1)` | `:309` | inside `fail()`, before the timer is armed |
| `Progress.flush()` | `:564` | back button, before leaving to Menu |
| `Audio.unlock()` | `:189` | first line of every `pointerdown` (browser autoplay gate) |
| `Audio.resetScale()` | `:177`, `:222` | on level load and on every new stroke |
| `Audio.note()` / `Haptics.tick()` | `:272-273` | per gate crossed, mid-stroke |
| `Haptics.thud()` / `Audio.thud()` | `:305-306` | `fail()`, before the flash is drawn |
| `Audio.celebrate(medal)` | — | immediately after `presentWin` |
| `Haptics.land()` / `success()` | — | 530 ms (the figure settled) / the medal stamp, a chapter complete, the streak flip |
| `Haptics.tap()` | — | reveal, share, skip, back |
| `Rate.shouldAsk` / `Rate.ask` | — | `readyIn + 400` ≈ 1180 ms after the win, only at a peak, and only when no ad is queued and the card asked nothing |
| `Nudges.permission` / `request` / `rebuild` | — | the soft ask on the card ([Remind me]); `rebuild` on a first Daily finish and on the win that first opens the Daily |
| `Share.shareFigure` | — | user-initiated only |

---

## 7. Memory-cleanup obligations

| Scene | Registered SHUTDOWN work | Notes |
| --- | --- | --- |
| Boot | none | builds nothing |
| Menu | none | `UI.button` unbinds its own scene `POINTER_UP` on container destroy (`UI.ts:292-294`) |
| LevelSelect | `rt.destroy()` + `this.textures.remove('foldwing-level-cards')` (`:211-214`) | **Mandatory** — ~22 MB atlas; `saveTexture` gives the TextureManager its own reference, so destroying the RenderTexture alone leaks it. `ScrollView` removes its own four listeners (`ScrollView.ts:97-102`) |
| Gallery | `rt.destroy()` + `this.textures.remove(...)` per atlas sheet | same reasoning; only registered in the non-empty branch |
| Game | `this.failTimer?.remove(); this.ink.destroy();` (`:130-133`) | `InkRenderer.destroy()` clears the win layer and destroys all five Graphics (`InkRenderer.ts:302-310`). The reveal-pill listener is unbound on its own `destroy` (`:660`) |

Both atlas bakers also call `this.textures.remove(key)` **on entry** if the key
already exists (`LevelSelectScene.ts:176`, `GalleryScene.ts:161`), so a re-enter
never stacks two atlases.

---

## 8. Invariants and traps

1. **Continuous segment collision against walls *and* mirror bands is LOCKED**
   (`GameScene.ts:236-241`). Endpoint-only tests pass strokes through walls at
   flick speed.
2. **The interstitial never covers the win figure.** `win()` only *asks* whether
   an ad would fire (to silence the rating prompt); the ad is fired in
   `advance()`, after the player's dismissing tap
   (`GameScene.ts:392-395`, `config/monetization.ts:9-14`).
3. **Retry ads need both gates.** Count is permission, clock is the brake
   (`Ads.ts:182-198`); pinned by `src/config/monetization.test.ts:90-100`.
4. **Ad counters are spent only on a rendered ad** (`:406`, `:451`), so a
   no-fill leaves the next natural break armed.
5. **The start grab is tested against the finger, not the offset cursor**
   (`:208-210`). The touch offset only exists once drawing has begun.
6. **`activePointers: 3`** (`main.ts:29`) is required by the fast-retry loop: the
   drawing finger is still down during the fail flash.
7. **Two-camera scenes must partition their objects.** Any object added to
   LevelSelect/Gallery must be in `grid.ignore([...])` or
   `cameras.main.ignore(...)` or it renders twice
   (`LevelSelectScene.ts:136-143`, `GalleryScene.ts:137-138`).
8. **`bannerReserve` is not decoration.** The banner is a native view over the
   canvas, pinned to the safe-area bottom; anything drawn in the last `pt(58)`
   can be under it. It covers the banner only while the canvas scale is 0.43 or
   more; below that main.ts lifts the canvas (`--fw-banner-lift`).
9. **GameScene mutates in place across levels.** New per-level state must be
   reset in `loadLevel()`; there is no scene restart to do it for you.
10. **`enter()` mutates `y` and `alpha` of its targets** and tweens them back
    (`UI.ts:349-368`) — objects passed to it must not be positioned again
    afterwards.

---

## 9. Defects and inconsistencies noticed while reading

- *(Gone in 1.4.)* **Share-pill blind spot** — for about 150 ms after the tap gate
  opened, the fading share pill was drawn but not carved out of "tap anywhere =
  next". The campaign and app Daily share from the result card now, whose buttons go
  live with the gate; only the web Daily keeps the old pill.
- *(Fixed in 1.4.)* **HUD text colours were hardcoded** `rgba(22,50,60,…)` literals.
  They are `inkCss(alpha)` from the theme now, at the contrast floor (body ≥ 0.75,
  micro ≥ 0.8), and the gold is the theme's `medal` / `medalText`.
- **`this.attempts` counts abandoned strokes.** It is incremented at
  `pointerdown` (`:216`), so lifting off before the goal still advances the skip
  offer's counter (`:321`), while `attemptsSinceAd` — incremented only in
  `fail()` (`:309`) — does not. The scene header comment calls a lift-off "no
  penalty" (`:7`), which is true for ads but not for the skip offer.
- **Dev key `m` skips the flush** that the on-screen back button performs
  (`:564` vs `:704`).
- **Dead range check** in `bindDevKeys`: `n <= LEVELS.length` (100) can never be
  exceeded by a single `event.key` character.
- **There is no LevelPlay Android app**, so the Android app key and unit ids are
  empty strings (`systems/providers/levelplay.ts`) and every ad path no-ops on
  Android. Intentional, but it means all GameScene ad branches are dead on
  Android in the current release configuration.
- *(Gone in 1.4.)* The 1.3 menu hid the reveal count from every player it was
  selling to (`selling` gave the chip's slot to the purchase rows). The balance chip
  is always on the top bar now, for everyone past the tutorial.
- Only two scenes have a test file, and those cover pure helpers
  (`LevelSelectScene.chapterMarker`, `GalleryScene.figureCaption`). The scenes
  themselves are pinned indirectly — through the pure layouts and models they call
  (`MenuLayout`, `DailyCard`, `ResultCard`, `Rescue`, `StoreSheet`) — and exercised in
  a browser by the harness described in [12-testing.md](12-testing.md) §8.

---

## See also

- [01-architecture.md](01-architecture.md) — module layout and dependency rules
- [02-coordinate-system.md](02-coordinate-system.md) — `BASE_WIDTH/HEIGHT`, `pt()`, `Playfield`, insets
- [03-geometry-collision.md](03-geometry-collision.md) — `segRect`, `segCircleEntryT`, `CollisionSystem`
- [04-stroke-ribbon.md](04-stroke-ribbon.md) — `StrokeRecorder`, densify/Chaikin, ribbon build
- [05-rendering.md](05-rendering.md) — `InkRenderer` layers, `UI.ts`, `ScrollView`, `ShareCard`
- [07-levels-data.md](07-levels-data.md) — `Level`, `LEVELS`, `levelAt`
- [09-systems.md](09-systems.md) — `Progress`, `Audio`, `Haptics`, `Rate`, `Share`
- [10-monetization.md](10-monetization.md) — `Ads`, `Iap`, cadence gates
- [12-testing.md](12-testing.md) — what each test pins
- [13-api-reference.md](13-api-reference.md) — full exported signatures
- [15-change-recipes.md](15-change-recipes.md) — adding a scene, a HUD element, a level
- [../README.md](../README.md) — narrative rationale for the loop and the placements
