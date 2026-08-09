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
| `src/scenes/MenuScene.ts` | 216 | Home page: Continue/Play, Levels, Gallery, IAP rows |
| `src/scenes/LevelSelectScene.ts` | 308 | 100-card scrollable grid, baked into one atlas |
| `src/scenes/GameScene.ts` | 707 | The core loop and the input state machine |
| `src/scenes/GalleryScene.ts` | 249 | Every saved figure, baked into one atlas; tap to share |
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
   - `this.scene.start('Menu')` — `:32`
   - `void Ads.init()` — `:34`, fire-and-forget, after the handoff
   - `void Iap.init()` — `:52`, deliberately a **no-op** (`Iap.ts:62-64`)

Traps:

- Gameplay never waits on an ad SDK. Consequence: Menu's `showBanner()` usually
  lands before `AdMob.initialize()` resolves; `Ads` remembers the request in
  `bannerWanted` and replays it at the end of `init()` (`Ads.ts:30-39`, `:103`,
  `:120`).
- No silent restore at launch, by design — a StoreKit touch on a signed-out
  device puts a repeating "Sign in to Apple Account" wall over a free game
  (`BootScene.ts:35-51`, `Iap.ts:66-82`).
- Constructs nothing, destroys nothing, registers no SHUTDOWN handler.

---

## 3. MenuScene

`create()` (`MenuScene.ts:35-163`). Payload: none.

**Index clamping (`:44`)** — `nextIndex = Math.min(Math.max(0, save.unlockedIndex), LEVELS.length - 1)`.
Belt-and-braces on top of `coerce()` in Progress: an out-of-range index would
throw inside `create()`, which leaves **no scene running at all** — a blank
canvas with nothing to press, and the bad save is never rewritten, so every
relaunch dies identically (`Progress.ts:94-104`).

**Label/action coupling (`:50`)** — `resuming = nextIndex > 0 || save.totalWins > 0`.
Both the caption and the button target derive from `nextIndex`; reading
`resuming` off `totalWins` alone made the button say "Play" and then open level 6
(the state a rewarded skip leaves).

**Layout is a cursor stack, not hand-placed rows (`:76-85`)** — geometry derives
from the row count so it cannot drift past the banner line:

| Symbol | Value when `selling` | Value when not |
| --- | --- | --- |
| `selling` | `Iap.available && !save.adsRemoved` | — |
| `rowGap` | `pt(7)` | `pt(11)` |
| `tallRow` | `pt(66)` | `pt(66)` |
| `row` | `pt(54)` | `pt(54)` |
| `cursorY` start | `pt(325)` | `pt(355)` |

`place(h)` returns the row centre and advances `cursorY` by `h + rowGap`.

Objects built, in order: `wordmark` at `pt(215)` (`:52`), tagline at `pt(295)`
(`:56`, kept clear of the wordmark's reflection), primary button
`Continue`/`Play` with `sub` = `` `${nextIndex + 1}. ${LEVELS[nextIndex].name}` ``
(`:87-93`), `Levels` (`:95`), `Gallery` (`:106`), then **either** the reveal chip
(`:129-131`) **or** the two purchase rows `Remove ads[· price]` at `pt(44)` and
`Restore purchases` at `pt(34)` (`:133-154`). The chip gives up its slot when
there is something to sell — five rows plus the chip runs off the bottom of the
canvas, which is how "Restore purchases" once drew half-cut.

`enter(this, entering)` with the default 45 ms stagger (`:159`, `UI.ts:349-356`),
then `void Ads.showBanner()` (`:162`).

Reveal chip (`buildRevealChip`, `:166-188`): text is `unlimited reveals` when
`Progress.data.adsRemoved`, else `` `${n} ${n === 1 ? 'reveal' : 'reveals'}` ``;
`· ${figureCount} folded` is appended when `figureCount > 0`.

IAP handlers:

```ts
private async purchase(): Promise<void>   // MenuScene.ts:198
private async restore(): Promise<void>    // MenuScene.ts:207
```

- `purchase()`: `Haptics.tap()` → `await Iap.buyRemoveAds()` → if owned,
  `Progress.setAdsRemoved(true)`, `Ads.setAdsRemoved(true)`, `scene.restart()`.
- `restore()`: `Haptics.tap()` → `await Iap.restore()` → `applyEntitlement(result)`
  (never downgrades on `null`, `Iap.ts:204-206`) → only on `result === true`:
  `Ads.setAdsRemoved(true)` + `scene.restart()`.

Teardown: no SHUTDOWN handler. `button()` removes its own scene-level
`POINTER_UP` listener on container destroy (`UI.ts:292-294`).

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

`create()` (`GalleryScene.ts:41-144`). Payload: none. Same `COLS = 3` / `GAP = pt(10)`.
Owns a `Playfield` (`:44`) purely to map stored normalized figure points back to
pixels before refitting them into a card.

- Header: back `‹` at `pt(56)`, title `Gallery`, subtitle
  `'1 figure'` / `` `${figures.length} figures` `` at `pt(96)` (`:49-72`).
- `figures = Progress.figures` — the getter returns **newest first**
  (`Progress.ts:206-208`).
- Empty state (`:76-89`): two labels, `'Nothing folded yet.'` and
  `'Clear a level and its figure lands here.'`. **No grid, no second camera, no
  atlas, no ScrollView** are created in this branch.
- Populated branch (`:90-141`): `top = pt(126)`,
  `bottom = BASE_HEIGHT - METRICS.bannerReserve - pt(6)`, `cardH = cardW * 1.12`.
  Same bake → cameras → `ScrollView` sequence as LevelSelect. Every row has
  `onArm` and `onTap` (no locking).
- `enter(this, entering, 26)` (`:143`).

**Why the bake exists (`:146-158`)** — a figure is a ribbon of dozens of
`fillPoints` calls re-triangulated every frame. Measured: **one** saved figure
took the Gallery from 16.7 ms/frame to **583 ms**; six figures ~330 ms; 33
figures stopped it rendering at all. The save keeps up to `MAX_FIGURES = 120`
(`Progress.ts:70`).

Atlas key `'foldwing-gallery-cards'`; identical SHUTDOWN obligation
(`:186-189`). Card art (`:193-226`): shadow + paper + `t.ink` 0.022 wash,
`paintFigureInto` into the box inset by `pad = pt(9)` and `pt(14)` shorter at the
bottom, plus a `` `${(figure.ms / 1000).toFixed(1)}s` `` label.

`share(figure)` (`:228-248`): re-entrancy guarded by `this.busy`;
`Haptics.tap()` → `renderShareCard(figure, { caption })` → `Share.shareFigure({ dataUrl, title: 'My foldwing', text, fileName: \`foldwing-${figure.levelId}-${figure.at}.png\` })`,
with `busy` cleared in `finally`. If `renderShareCard` returns falsy the function
returns early (still clearing `busy`).

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
| `drawing` | `idle` | `pointerup` from the active pointer before the goal — **no penalty** | `:277-281` |
| `failed` | `idle` | `failTimer` after `METRICS.failFlashMs` (400) | `:312-317` |
| `failed` | `idle` | **any** `pointerdown` — abandons the flash immediately, same event then falls through to the idle grab test | `:202-203` |
| `won` | (next level) | `pointerdown` with `this.time.now >= this.advanceReadyAt` and not over the share pill | `:191-197` |
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

### 6.6 Win path — exact order (`win(entry: Vec2)`, `:329-375`)

1. `recorder.pushExact(entry, this.time.now)` — the ink terminates at the true
   goal-entry point, not at the last sample.
2. `phase = 'won'`, `activePointer = null`
3. `elapsed = this.time.now - this.strokeStartedAt`
4. `Progress.recordWin(this.level.id, this.levelIndex, elapsed, LEVELS.length)`
   — unlocks `levelIndex + 1` (clamped), keeps best ms, `totalWins++`,
   `winsSinceAd++` (`Progress.ts:172-189`)
5. `Progress.addFigure({...})` with points via `pf.toNormalized` and times
   rebased to `times[0]` — normalized so the same figure redraws at 1080×1080 in
   a share card
6. **`this.ink.presentWin(...)` — the figure is on screen**
7. `Audio.chime()`
8. `this.clearSkipOffer()`
9. `readyIn = METRICS.winHoldMs + METRICS.winSettleMs + 250` = `180 + 350 + 250` = **780 ms**;
   `advanceReadyAt = this.time.now + readyIn`. One number for both the tap gate
   and the prompt that invites the tap — when they drift, the game says "tap for
   the next fold" during a window where taps are still dropped.
10. `refreshHud()`
11. `showHint('tap for the next fold', readyIn)`
12. `showShareOffer(readyIn)`
13. `adWillShow = Ads.wouldShowInterstitial(this.levelIndex, Progress.data.winsSinceAd)`
    — **non-consuming predicate** (`Ads.ts:175-180`)
14. `if (Rate.shouldAsk(adWillShow)) this.time.delayedCall(readyIn + 400, () => void Rate.ask())`
    — at most one interruption per moment; the rating prompt stands down rather
    than stacking on an ad.

**The interstitial is NOT fired here.** It fires only in `advance()`
(`:396-414`), i.e. after the player has seen the figure and tapped to leave:

```ts
private async advance(): Promise<void> {
  if (this.advancing) return;
  this.advancing = true;
  const next = this.levelIndex + 1;
  if (Ads.wouldShowInterstitial(this.levelIndex, Progress.data.winsSinceAd)) {
    const shown = await Ads.showInterstitial();
    if (shown) Progress.update({ winsSinceAd: 0, attemptsSinceAd: 0 });
  }
  if (next >= LEVELS.length) { this.scene.start('LevelSelect'); return; }
  this.loadLevel(next);
}
```

Two invariants here: the counters are spent **only when an ad actually
rendered** (no-fill leaves them armed), and `advancing` is a re-entrancy latch
cleared only by `loadLevel` (`:176`).

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
is the failure mode that gets an AdMob account disabled; `monetization.test.ts:90-100`
pins the arithmetic (`interstitialEveryNAttempts * 3s < minSecondsBetweenInterstitials`,
and `minSecondsBetweenInterstitials / 60 >= 2`).

### 6.8 `resetToIdle()` (`:377-390`)

`failTimer?.remove()` + null → `recorder.clear()` → `ink.clearStroke()` →
`ink.clearWin()` → `phase = 'idle'` → `activePointer = null` →
`clearShareOffer()` → `hideHint()` → `refreshHud()`.

Note it does **not** clear the skip offer — the skip pill deliberately survives
retries and is removed only on win (`:351`) or level load (`:181`).

### 6.9 Reveal, skip, share

| Action | Entry | Flow |
| --- | --- | --- |
| Reveal | reveal pill tap → `doReveal()` `:419-437` | no-op while `phase === 'won'`; `Haptics.tap()`; if `Progress.spendReveal()` → `ink.showReveal(this.mirrorBands, monetization.reveals.durationMs /* 6000 */)` + `refreshHud()`; else if `Ads.rewardedAvailable` → `await Ads.showRewarded('reveal')`; on reward `Progress.grantReveals(monetization.reveals.grantedPerRewarded /* 1 */)` + `refreshHud()` — **banked, never auto-spent** |
| Skip | skip pill → `doSkip()` `:538-548` | `Haptics.tap()` → `await Ads.showRewarded('skip')` → on reward `Progress.unlockThrough(this.levelIndex, LEVELS.length)`, `clearSkipOffer()`, then `loadLevel(next)` or `scene.start('LevelSelect')` |
| Share | share pill → `shareCurrent()` `:496-516` | uses `Progress.figures[0]` (newest first); `sharing` re-entrancy latch; `renderShareCard(figure, { caption: \`${figure.levelName} · ${(figure.ms/1000).toFixed(1)}s\` })` → `Share.shareFigure({ dataUrl, title: 'My foldwing', text, fileName })` |

Both pills are placed at `BASE_HEIGHT - METRICS.bannerReserve - pt(34)`
(`:463`, `:519`) — the same slot, which is safe because the skip pill is cleared
before the share pill appears.

**The share pill has to carve itself out of the "tap anywhere = next" rule**
(`:191-197`, `overSharePill` `:483-494`), otherwise reaching for it would skip
past the figure. `overSharePill` reads `pill.width`/`pill.height`, which are real
because `UI.button` calls `container.setSize(w, h)` (`UI.ts:242`), and ignores
the pill while `pill.alpha < 0.5`.

### 6.10 HUD (`buildHud` `:552-602`, `buildRevealPill` `:605-663`, `refreshHud` `:665-672`)

| Object | Position | Depth | Content |
| --- | --- | --- | --- |
| back `‹` button | `(METRICS.inset.left + pt(18), pt(26))`, `pt(46)×pt(44)`, ghost | 50 | `Haptics.tap()` → `void Progress.flush()` → `scene.start('Menu')` |
| `titleText` | `(BASE_WIDTH/2, pt(26))`, `FONT.display`, `TYPE.body` | 50 | `` `${this.levelIndex + 1}. ${this.level.name}` `` |
| `revealPill` | `(BASE_WIDTH - METRICS.inset.right - pt(42), pt(26))`, `pt(74)×pt(34)` | 50 | eye glyph + count; alpha `1` when `n > 0 \|\| Ads.rewardedAvailable`, else `0.35` |
| `attemptText` | `(BASE_WIDTH/2, pt(47))`, `FONT.ui`, `TYPE.micro` | 50 | `` `attempt ${this.attempts}` `` when `attempts > 0`, else `''` |
| `hintText` | `(BASE_WIDTH/2, BASE_HEIGHT - METRICS.bannerReserve - pt(4))`, origin `(0.5, 1)`, alpha 0 | 50 | set by `showHint()` |

`revealCount` prints `'∞'` when `Progress.reveals === Number.POSITIVE_INFINITY`
— which is what owning Remove Ads produces (`Progress.ts:220-224`).

The reveal pill re-implements `UI.button`'s gesture rule rather than using it
(`:637-661`): arm on the container's `pointerdown`, resolve on the **scene's**
`POINTER_UP`, reject on `Phaser.Math.Distance.Between(...) > TAP_SLOP`
(`TAP_SLOP = pt(14)`, `UI.ts:79`), then a manual bounds test. Judging by
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
| `Ads.rewardedAvailable` | `:323`, `:429`, `:671` | gates the skip offer, the reveal upsell, the pill's dim state |
| `Ads.wouldShowInterstitial` | `:368` (predicate only), `:402` | asked in `win()` **only** to silence `Rate`; acted on in `advance()` |
| `Ads.showInterstitial()` | `:403`, `:448` | after the win figure is dismissed; after the fail flash + reset |
| `Ads.showRewarded('reveal' \| 'skip')` | `:430`, `:540` | opt-in only |
| `Progress.recordWin` / `addFigure` | `:335`, `:340` | before `presentWin` — the save is written first, the reward is drawn second |
| `Progress.update(attemptsSinceAd+1)` | `:309` | inside `fail()`, before the timer is armed |
| `Progress.flush()` | `:564` | back button, before leaving to Menu |
| `Audio.unlock()` | `:189` | first line of every `pointerdown` (browser autoplay gate) |
| `Audio.resetScale()` | `:177`, `:222` | on level load and on every new stroke |
| `Audio.note()` / `Haptics.tick()` | `:272-273` | per gate crossed, mid-stroke |
| `Haptics.thud()` / `Audio.thud()` | `:305-306` | `fail()`, before the flash is drawn |
| `Audio.chime()` | `:350` | immediately after `presentWin` |
| `Haptics.tap()` | `:420`, `:500`, `:539`, `:563` | reveal, share, skip, back |
| `Rate.shouldAsk` / `Rate.ask` | `:372-373` | `readyIn + 400` = 1180 ms after the win, and only when no ad is queued |
| `Share.shareFigure` | `:507` | user-initiated only |

---

## 7. Memory-cleanup obligations

| Scene | Registered SHUTDOWN work | Notes |
| --- | --- | --- |
| Boot | none | builds nothing |
| Menu | none | `UI.button` unbinds its own scene `POINTER_UP` on container destroy (`UI.ts:292-294`) |
| LevelSelect | `rt.destroy()` + `this.textures.remove('foldwing-level-cards')` (`:211-214`) | **Mandatory** — ~22 MB atlas; `saveTexture` gives the TextureManager its own reference, so destroying the RenderTexture alone leaks it. `ScrollView` removes its own four listeners (`ScrollView.ts:97-102`) |
| Gallery | `rt.destroy()` + `this.textures.remove('foldwing-gallery-cards')` (`:186-189`) | same reasoning; only registered in the non-empty branch |
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
   canvas; on 9:16 there is no letterbox, so anything drawn in the last
   `pt(58)` is visible-but-untappable (`Theme.ts:186-195`,
   `LevelSelectScene.ts:69-73`).
9. **GameScene mutates in place across levels.** New per-level state must be
   reset in `loadLevel()`; there is no scene restart to do it for you.
10. **`enter()` mutates `y` and `alpha` of its targets** and tweens them back
    (`UI.ts:349-368`) — objects passed to it must not be positioned again
    afterwards.

---

## 9. Defects and inconsistencies noticed while reading

- **Share-pill blind spot.** `advanceReadyAt` is `now + readyIn` (`:360`) but the
  pill's fade is `{ delay: readyIn, duration: 300 }` (`:473`), and
  `overSharePill` ignores the pill while `alpha < 0.5` (`:485`). So for roughly
  150 ms after the tap gate opens the pill is drawn (fading up from 0) yet the
  carve-out does not see it: a tap on it falls through to `advance()` and skips
  the figure, which is exactly what `overSharePill` exists to prevent. Whether
  `onPress` → `shareCurrent()` *also* fires depends on the ad path — with no
  interstitial queued, `advance()` runs to `loadLevel` synchronously and
  `clearShareOffer()` destroys the pill (unbinding its scene `POINTER_UP`)
  before the release, so only the advance happens.
- **HUD text colours are hardcoded, not themed.** `buildHud` takes
  `const t = theme()` (`:553`) and then discards it with `void t;` (`:601`);
  the three Text objects use literal `rgba(22,50,60,…)` strings (`:575`, `:586`,
  `:595`). That literal equals `PAPER.ink` (`0x16323c`), so any second ink pack
  added to `THEMES` would leave the HUD mis-coloured, and `Theme.rgba()`
  (`Theme.ts:104`) already exists for this.
- **`this.attempts` counts abandoned strokes.** It is incremented at
  `pointerdown` (`:216`), so lifting off before the goal still advances the skip
  offer's counter (`:321`), while `attemptsSinceAd` — incremented only in
  `fail()` (`:309`) — does not. The scene header comment calls a lift-off "no
  penalty" (`:7`), which is true for ads but not for the skip offer.
- **Dev key `m` skips the flush** that the on-screen back button performs
  (`:564` vs `:704`).
- **Dead range check** in `bindDevKeys`: `n <= LEVELS.length` (100) can never be
  exceeded by a single `event.key` character.
- **`LIVE_ANDROID` unit ids are empty strings** (`config/monetization.ts:83-88`),
  so with `useTestAds: false` every ad path no-ops on Android via
  `adsConfigured()` (`:182`). Intentional, but it means all GameScene ad
  branches are dead on Android in the current release configuration.
- `MenuScene` computes `figureCount` (`:105`) before the Gallery button but uses
  it only inside `buildRevealChip`, which is skipped entirely when `selling` is
  true — so owners-to-be see neither their reveal count nor their figure count.
- No test file covers any scene: the suite is `src/config/monetization.test.ts`,
  `src/core/*.test.ts`, `src/data/levels.test.ts`, `src/data/quality.test.ts`,
  `src/render/HitArea.test.ts`, `src/render/Theme.test.ts`. Scene behaviour is
  pinned only indirectly — via the metrics in `Theme.test.ts` and the ad
  arithmetic in `monetization.test.ts`.

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
