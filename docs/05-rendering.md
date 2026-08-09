# Rendering: Ink, Theme, UI Kit, ScrollView, HitArea, ShareCard

## What this covers

Every module under `src/render/` — the thing that paints the play surface
(`InkRenderer`), the palette and sizing tokens everything reads (`Theme`), the
Phaser-primitive UI kit (`UI`), the tap-geometry correction that fixed the
"buttons need three taps" bug (`HitArea`), the list scroller (`ScrollView`), and
the offscreen 1080×1080 PNG exporter (`ShareCard`). It also covers the two
render-texture atlases in `LevelSelectScene` / `GalleryScene`, because those are
rendering decisions that live in the scenes.

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `src/render/InkRenderer.ts` | 432 | Walls, axis, live stroke, mirror, fail flash, win figure; `buildFigure` / `paintFigureInto` |
| `src/render/Theme.ts` | 212 | `BASE_WIDTH/HEIGHT`, `PT`/`pt()`, `InkTheme` palette, `METRICS` (feel + collision constants) |
| `src/render/UI.ts` | 372 | `tappable`, `label`, `button`, `roundRect`, `softShadow`, `rule`, `wordmark`, `enter`, `FONT`/`TYPE`/`SPACE`/`RADIUS`/`TAP_SLOP`/`COLUMN` |
| `src/render/HitArea.ts` | 67 | Pure-maths hit-rectangle correction for centre-drawn containers |
| `src/render/ScrollView.ts` | 272 | Scene-level drag/tap discrimination, momentum, off-screen culling |
| `src/render/ShareCard.ts` | 204 | `renderShareCard` — figure → PNG data URL on a plain 2D canvas |
| `src/render/Theme.test.ts` | 140 | Pins the spec numbers and the LOCKED hit-radius consequence |
| `src/render/HitArea.test.ts` | 73 | Pins live-area == painted-area, and reproduces the shipped bug |
| `src/scenes/LevelSelectScene.ts` | 308 | Level-card atlas bake, camera-viewport clip, atlas lifetime |
| `src/scenes/GalleryScene.ts` | 249 | Figure-card atlas bake, same clip + lifetime pattern |

There is no `InkRenderer.test.ts`, `UI.test.ts`, `ScrollView.test.ts` or
`ShareCard.test.ts`. `vite.config.ts:15-20` sets `environment: 'node'` with the
comment "Phaser is never imported by a test" — that is why `HitArea.ts` exists
as a Phaser-free module: it is the only way that maths could be pinned.

---

## 1. Theme — the two-object split

`src/render/Theme.ts` deliberately separates **cosmetic** from **mechanical**
(`Theme.ts:1-18`). `InkTheme` is what a purchasable ink pack may change;
`METRICS` is what decides life and death. Nothing in `CollisionSystem` reads
`InkTheme`. This is the anti-pay-to-win guarantee, and it is structural.

### Base canvas

```ts
export const BASE_WIDTH = 750;   // Theme.ts:30
export const BASE_HEIGHT = 1334; // Theme.ts:31
export const PT = 2;             // Theme.ts:38
export function pt(points: number): number  // Theme.ts:40
```

750×1334 is a 2× iPhone-SE portrait. Phaser runs FIT + CENTER_BOTH against it,
so game coordinates never change with the device (`Theme.ts:22-29`). Taller
phones letterbox into the paper-coloured page background rather than
pillarboxing and stealing the width the mirror needs.

`Theme.test.ts:19-34` pins `BASE_WIDTH === 750`, `BASE_HEIGHT === 1334`,
`BASE_WIDTH / BASE_HEIGHT < 0.5626`, `PT === 2`.

### Palette

```ts
export interface InkTheme {          // Theme.ts:46-69
  readonly id: string;
  readonly name: string;
  readonly paper: number;
  readonly ink: number;
  readonly wall: number;
  readonly accent: number;
  readonly fail: number;
  readonly mirrorAlpha: number;
  readonly winFillAlpha: number;
  readonly axisAlpha: number;
  readonly reflectionAlpha: number;
  readonly strokePt: number;
}
```

The one shipped theme, `PAPER` (`Theme.ts:71-84`), verbatim:

| Field | Value | Pinned by |
| --- | --- | --- |
| `id` | `'paper'` | — |
| `name` | `'Paper'` | — |
| `paper` | `0xe9ebe4` | `Theme.test.ts:39` |
| `ink` | `0x16323c` | `Theme.test.ts:40` |
| `wall` | `0x9a9c90` | `Theme.test.ts:41` |
| `accent` | `0x8e3b62` | `Theme.test.ts:42` |
| `fail` | `0xb4463c` | `Theme.test.ts:43` |
| `mirrorAlpha` | `0.45` | `Theme.test.ts:48` |
| `winFillAlpha` | `0.11` | `Theme.test.ts:49` |
| `axisAlpha` | `0.16` | `Theme.test.ts:50` |
| `reflectionAlpha` | `0.3` | — |
| `strokePt` | `5` | `Theme.test.ts:68` |

```ts
export const THEMES: Readonly<Record<string, InkTheme | undefined>>  // Theme.ts:88
export function theme(): InkTheme        // Theme.ts:94
export function setTheme(id: string): void // Theme.ts:98
export function rgba(color: number, alpha: number): string // Theme.ts:104
```

- `theme()` returns a module-level mutable `active` (`Theme.ts:92`). Every
  drawing function calls `theme()` fresh at draw time, so a theme swap needs a
  redraw, not a re-instantiation.
- `setTheme` on an unknown id is a **no-op**, not a crash and not a blank game
  (`Theme.ts:98-101`, pinned by `Theme.test.ts:58-62`). The `| undefined` in the
  value type is what makes the lookup honest.
- `rgba(0x16323c, 0.11) === 'rgba(22,50,60,0.11)'` — pinned literally at
  `Theme.test.ts:53-56`.
- **Only caller of `setTheme`/`THEMES` outside `Theme.ts` is the test.** The
  cosmetic-pack path is plumbed but not wired to any product.

### METRICS (verbatim, `Theme.ts:113-212`)

| Key | Expression | Value (base px) | Notes |
| --- | --- | --- | --- |
| `hitRadius` | `pt(2.6)` | 5.2 | **LOCKED.** See below. |
| `sampleMinDist` | `pt(2.6)` | 5.2 | `<= hitRadius`, pinned `Theme.test.ts:97` |
| `touchOffsetY` | `pt(42)` | 84 | pinned `Theme.test.ts:101` |
| `touchOffsetRampPx` | `pt(21)` | 42 | distance-based ramp, pinned `Theme.test.ts:107-111` |
| `renderMaxSpacing` | `pt(5)` | 10 | `<= pt(strokePt)`, pinned `Theme.test.ts:115-119` |
| `startRadius` | `pt(10)` | 20 | |
| `startGrabFactor` | `2.4` | — | `startRadius * factor === pt(24)`, pinned `Theme.test.ts:121-124` |
| `goalRadius` | `pt(15)` | 30 | also the win threshold |
| `goalRingWidth` | `pt(2)` | 4 | |
| `wallCornerRadius` | `pt(3)` | 6 | |
| `axisWidth` | `pt(1)` | 2 | |
| `axisDash` | `pt(7)` | 14 | |
| `axisGap` | `pt(6)` | 12 | dash step = 26 |
| `smoothIterations` | `2` | — | Chaikin passes, render only |
| `failFlashMs` | `400` | — | pinned `Theme.test.ts:126-129` |
| `winHoldMs` | `180` | — | |
| `winSettleMs` | `350` | — | pinned `Theme.test.ts:131-135` |
| `winSettleFrom` | `0.97` | — | pinned `Theme.test.ts:132` |
| `bannerReserve` | `pt(58)` | 116 | native AdMob banner keep-out |
| `inset.top` | `pt(44)` | 88 | |
| `inset.right` | `pt(12)` | 24 | |
| `inset.bottom` | `pt(72)` | 144 | clears `bannerReserve` |
| `inset.left` | `pt(12)` | 24 | |

**LOCKED trap (`Theme.ts:114-125`, `Theme.test.ts:65-90`, README.md:257-269).**
`hitRadius = pt(2.6) = 5.2` is measured from the stroke **centreline**; a 5pt nib
reaches `pt(5)/2 = 5.0` from that same centreline. So the kill boundary sits
**0.2 base px OUTSIDE the visible ink** — marginally *strict* where the spec's
prose says the line should "forgive slightly". `Theme.test.ts:79-82` asserts that
0.2 delta explicitly so the discrepancy cannot be silently changed. Changing
`hitRadius` is the author's call, not a refactor.

`Theme.test.ts:84-89` additionally asserts `Object.keys(theme())` does **not**
contain `hitRadius` — migrating collision forgiveness into `InkTheme` would make
a purchasable skin pay-to-win, and that test is the guard.

**`bannerReserve` trap (`Theme.ts:186-211`).** The AdMob banner is a *native* view
pinned to the bottom of the screen; it knows nothing about the canvas. On a
letterboxed tall phone it lands in the paper band below the canvas (harmless);
on a 9:16 phone it covers the last stretch of canvas outright. Anything drawn in
that band is invisible, and a start dot under an ad is an accidental-click
generator. `inset.bottom = pt(72)` (144) already exceeds `bannerReserve` (116);
menu chrome additionally stops at `BASE_HEIGHT - METRICS.bannerReserve - pt(6)`
(= 1206) in both grid scenes (`LevelSelectScene.ts:75`, `GalleryScene.ts:92`).

---

## 2. InkRenderer

`src/render/InkRenderer.ts` is the **only** place smoothing and nib width are
applied (`InkRenderer.ts:1-12`). Collision runs on raw samples at a fixed hit
radius, so however thick the ink looks it never changes what kills you.

### Layers and depth

Private module constant (`InkRenderer.ts:25-32`, not exported):

```ts
const DEPTH = {
  level: 10,
  reveal: 15,
  mirror: 18,
  stroke: 20,
  win: 30,
  wash: 40,
} as const;
```

Five `Phaser.GameObjects.Graphics` created in the constructor
(`InkRenderer.ts:104-114`):

| Field | Depth | Initial alpha | Contents |
| --- | --- | --- | --- |
| `levelG` | 10 | 1 | axis + walls + start/goal + their reflections |
| `revealG` | 15 | **0** | rewarded-video mirror bands |
| `mirrorG` | 18 | 1 (opaque, by design) | reflected live stroke |
| `strokeG` | 20 | 1 | live stroke |
| `washG` | 40 | **0** | full-screen fail wash |

HUD objects in `GameScene` sit at depth 50 (`GameScene.ts:598`, `GameScene.ts:610`)
— above the wash.

### The alpha-accumulation trap → `veil()`

`InkRenderer.ts:70-94`, and repeated at `InkRenderer.ts:350-351`:

```ts
function veil(ink: number, t: InkTheme): number  // InkRenderer.ts:86
```

A ribbon is not one shape — it is dozens of **overlapping** quads plus a disc at
every sample (`Ribbon.ts:104`, design rationale `Ribbon.ts:108-117`). Phaser
applies a Graphics object's alpha per
*draw command*, not to the finished result, so every overlap composites over the
last. Setting `mirrorG.setAlpha(0.45)` produced a **measured 0.95-0.97 effective
alpha** (`InkRenderer.ts:78`) — the reflection rendered as solid as the player's
own line, destroying the exact distinction the game is built on.

The fix: pre-blend the *colour* toward the paper and draw one opaque pass.
`veil(0x16323c, PAPER)` evaluates to **`0x8a9898`** (verified by evaluating
`Theme.ts:79` + `InkRenderer.ts:86-94`). `drawStroke` even re-asserts
`mirrorG.setAlpha(1)` on every call (`InkRenderer.ts:179`) so nothing can leave
it partially transparent.

**Do not "simplify" this to `setAlpha(mirrorAlpha)`.** It looks correct and is
the bug.

### API

```ts
constructor(
  private readonly scene: Phaser.Scene,
  private readonly pf: Playfield
)                                                                 // InkRenderer.ts:104
drawLevel(walls: readonly Rect[], startPx: Vec2, goalPx: Vec2): void  // :122
drawStroke(raw: readonly Vec2[], times: readonly number[], color?: number): void // :170
clearStroke(): void                                               // :191
flashFail(raw: readonly Vec2[], times: readonly number[]): void    // :203
showReveal(mirroredWalls: readonly Rect[], durationMs: number): void // :230
clearReveal(): void                                               // :261
presentWin(raw: readonly Vec2[], times: readonly number[]): void   // :274
clearWin(): void                                                  // :295
destroy(): void                                                   // :302
```

Call sites, all in `GameScene`: `new InkRenderer` at `GameScene.ts:120`,
`destroy` at `:132`, `clearReveal` `:178`, `drawLevel` `:180`, `drawStroke`
`:224` and `:260`, `flashFail` `:307`, `presentWin` `:349`, `clearStroke` /
`clearWin` `:382-383`, `showReveal` `:424`.

### What each thing draws

**`drawLevel` (`:122-141`)** takes **pixel-space** geometry, not normalized —
converting is `Playfield`'s job and happens once per level load (`:118-121`).
Order matters: axis first, then walls, then the *reflected* start/goal at
`t.reflectionAlpha` (0.3), then the real start/goal at alpha 1
(`:136-140`). Reflections are drawn under the real markers so an overlap near the
axis never hides a target.

- Wall corner radius is clamped: `Math.min(METRICS.wallCornerRadius, w.w / 2, w.h / 2)`
  (`:131`). A thin wall would otherwise get arcs wider than the rect.

**`drawAxis` (`:143-152`)** — hand-rolled dashes. Steps by
`METRICS.axisDash + METRICS.axisGap` (14 + 12 = 26) from `pf.y` to `pf.bottom`,
each dash clamped by `Math.min(y + METRICS.axisDash, this.pf.bottom)` so the last
dash cannot overhang the playfield.

**`drawStart` (`:154-157`)** — `fillCircle(p.x, p.y, METRICS.startRadius)` in
`accent`.
**`drawGoal` (`:159-165`)** — ring at `METRICS.goalRadius` with
`METRICS.goalRingWidth`, plus a centre dot `fillCircle(..., pt(2.5))` at
`alpha * 0.55`.

**`drawStroke` (`:170-189`)** — clears both `strokeG` and `mirrorG`, forces
`mirrorG` opaque, returns early on `raw.length === 0`, then paints the mirror
**before** the ink so the player's line is always on top. `color` overrides
`t.ink`; the mirror is `veil(ink, t)` of whatever colour was passed — which is
how the fail flash tints both halves.

**`flashFail` (`:203-219`)** — re-draws the stroke in `t.fail`, fills
`washG` over the entire logical canvas `(0, 0, BASE_WIDTH, BASE_HEIGHT)` at
alpha `0.1`, kills existing tweens on it, and tweens alpha to 0 over
`METRICS.failFlashMs` (400) with `Quad.easeOut`. No modal, no dismiss tap — the
retry loop is the product (`:198-202`).

**`showReveal` (`:230-259`)** — the rewarded-video reward. Paints the *mirrored*
wall bands onto the left half in `t.fail` at alpha **0.16**, then a fixed
tween chain: fade in 220 ms `Quad.easeOut` → on complete, fade out after
`delay: durationMs` over 420 ms `Quad.easeIn` → `g.clear()`. `durationMs` comes
from `monetization.reveals.durationMs` (`GameScene.ts:424`). Note the reward is
*information*, not the answer — the player still has to draw it (`:223-229`).

**`presentWin` (`:274-293`)** — clears any previous win layer and the live
stroke, builds the closed figure via `buildFigure`, bails silently if that
returns `null`, sets depth 30 and scale `METRICS.winSettleFrom` (0.97), then
tweens scale → 1 with `delay: METRICS.winHoldMs` (180),
`duration: METRICS.winSettleMs` (350), `Cubic.easeOut`.

**`clearWin` (`:295-300`)** kills tweens then `destroy(true)` (destroys
children). **`destroy` (`:302-309`)** calls `clearWin` then destroys all five
Graphics. Note it does **not** explicitly kill tweens on `washG`/`revealG`; in
practice `GameScene.ts:132` destroys the renderer on scene shutdown.

### Internal helpers

```ts
function drawnPath(raw: readonly Vec2[], times: readonly number[]): DrawnStroke // :35
function nib(): RibbonOptions                                                   // :40
function paintRibbon(g, stroke, color, opts): void                              // :51
function mirrorStroke(stroke: DrawnStroke, axisX: number): DrawnStroke           // :66
function paintRibbonAlpha(g, stroke, color, alpha, opts): void                  // :419
```

- `drawnPath` = `renderStroke(raw, times, METRICS.renderMaxSpacing, METRICS.smoothIterations)`
  — densify-then-Chaikin, with the timestamps put through the scalar twins so
  the width profile stays index-aligned (`StrokeRecorder.ts:210-228`).
- `nib()` = `{ ...DEFAULT_RIBBON, baseWidth: pt(theme().strokePt) }` — the theme
  supplies **only** `baseWidth`; `maxScale`/`minScale`/`fastSpeed`/`taperPoints`/
  `smoothPasses` stay at `DEFAULT_RIBBON` (`Ribbon.ts:32-39`).
- Both ribbon painters skip discs with `d.r <= 0.25` (`:62`, `:430`,
  `ShareCard.ts:110`) — sub-quarter-pixel circles cost a draw call and paint
  nothing.

### `buildFigure`

```ts
export function buildFigure(
  scene: Phaser.Scene,
  stroke: DrawnStroke,
  axisX: number,
  opts?: Partial<RibbonOptions>
): Phaser.GameObjects.Container | null                       // InkRenderer.ts:319
```

Returns `null` when `boundsOf(closedFigure(...))` is null (empty path). The
container is placed at the figure's centre `(cx, cy)` and every point is rebased
to `p - centre` (`:330-332`), so the caller can scale/rotate it about its own
middle — that is why `presentWin` can tween `scale` and have it settle in place.

Child order inside the container (`:358`): `[fill, mirrorG, inkG]` — silhouette
fill at `t.winFillAlpha` (0.11), then the veiled mirror, then the ink.

It is shared by the win moment and (indirectly) the gallery so a saved figure is
rendered by exactly the code that drew it when it was earned (`:312-318`).

### `paintFigureInto`

```ts
export function paintFigureInto(
  g: Phaser.GameObjects.Graphics,
  raw: readonly Vec2[],
  times: readonly number[],
  axisX: number,
  box: Rect,
  alphaScale = 1
): void                                                       // InkRenderer.ts:368
```

Fits the figure into `box` with a **uniform** scale
(`Math.min(box.w / bounds.w, box.h / bounds.h)`, `:382`) and centres it. Bails on
`!bounds || bounds.w <= 0 || bounds.h <= 0`.

Two deliberate differences from `buildFigure`:

1. Nib is `Math.max(1.5, pt(t.strokePt) * scale)` (`:389`) — the floor keeps a
   thumbnail stroke visible at any card size.
2. It paints through `paintRibbonAlpha`, which sets a real per-command alpha
   (`alphaScale`) on the Graphics. `veil` is still used for the mirror's colour
   (`:399`) — the difference is the extra per-command alpha on top, which the
   live stroke never uses. The beading that motivates `veil` is sub-pixel at
   thumbnail size, and sharing **one** Graphics across the whole grid is worth
   far more than the artefact costs (`:411-418`). Only caller:
   `GalleryScene.ts:209`, into the card's own Graphics before it is baked into
   the atlas.

---

## 3. UI kit

`src/render/UI.ts`. Everything is built from Phaser primitives — **no font or
image assets**, which is what keeps cold start under a second (`UI.ts:11-13`).
The play surface's art direction is fixed; the "modern" feel is carried entirely
by the chrome around it (`UI.ts:1-10`).

### Tokens (verbatim)

```ts
export const FONT = {                                          // UI.ts:41-46
  display: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
} as const;

export const TYPE = {                                          // UI.ts:49-56
  hero: pt(46),
  title: pt(27),
  heading: pt(19),
  body: pt(15),
  label: pt(12.5),
  micro: pt(10.5),
} as const;

export const SPACE = {                                         // UI.ts:58-65
  xs: pt(6),
  sm: pt(10),
  md: pt(16),
  lg: pt(24),
  xl: pt(36),
  xxl: pt(56),
} as const;

export const RADIUS = {                                        // UI.ts:67-72
  sm: pt(10),
  md: pt(16),
  lg: pt(22),
  pill: pt(999),
} as const;

export const TAP_SLOP = pt(14);                                // UI.ts:79

export const COLUMN = BASE_WIDTH - METRICS.inset.left * 2 - pt(16) * 2; // UI.ts:372
```

Resolved base-pixel values:

| Token | px | | Token | px |
| --- | --- | --- | --- | --- |
| `TYPE.hero` | 92 | | `SPACE.xs` | 12 |
| `TYPE.title` | 54 | | `SPACE.sm` | 20 |
| `TYPE.heading` | 38 | | `SPACE.md` | 32 |
| `TYPE.body` | 30 | | `SPACE.lg` | 48 |
| `TYPE.label` | 25 | | `SPACE.xl` | 72 |
| `TYPE.micro` | 21 | | `SPACE.xxl` | 112 |
| `RADIUS.sm` | 20 | | `RADIUS.md` | 32 |
| `RADIUS.lg` | 44 | | `RADIUS.pill` | 1998 |
| `TAP_SLOP` | 28 | | `COLUMN` | **638** |

`COLUMN === 638` is the width used for every menu button (`MenuScene.ts:88`,
`:96`, `:107`, `:138`, `:147`) and is the same 638 that appears in the pinned
`HitArea.test.ts` cases — the test cases are real measurements of the shipped
menu, not invented numbers.

`RADIUS.pill = pt(999) = 1998` is only safe because `roundRect` clamps — see
below.

Usage census (grep over `src/`): `SPACE` is referenced exactly once
(`MenuScene.ts:179`, `SPACE.lg`); `RADIUS.lg` and `rule()` have **no callers at
all**.

### `tappable`

```ts
export function tappable(
  container: Phaser.GameObjects.Container,
  w: number,
  h: number
): void                                                        // UI.ts:27
```

The only sanctioned way to make a centre-drawn container interactive. Wraps
`centredHitArea(w, h)` in a `Phaser.Geom.Rectangle` with
`Phaser.Geom.Rectangle.Contains`. **Requires `container.setSize(w, h)` first** —
`Container.displayOriginX` is derived as `this.width * 0.5`
(`node_modules/phaser/src/gameobjects/container/Container.js:299-306`), and
without `setSize` the width is 0 and the correction does not apply. `UI.button`
does this at `UI.ts:242-243`; `GameScene.buildRevealPill` at `GameScene.ts:630-631`.

### `roundRect`

```ts
export function roundRect(
  g: Phaser.GameObjects.Graphics,
  x: number, y: number, w: number, h: number,
  radius: number
): void                                                        // UI.ts:93
```

Body: `g.fillRoundedRect(x, y, w, h, Math.max(0, Math.min(radius, w / 2, h / 2)))`.

**Why it exists (`UI.ts:83-92`).** Phaser's `fillRoundedRect` takes the radius on
trust and draws the corner arcs at whatever size it is given. A `RADIUS.pill`
(1998) passed to a 60px-tall chip sweeps arcs hundreds of pixels past the shape
and paints faint full-height streaks across the page. That bug shipped into the
menu and the in-game reveal button. **Never call `fillRoundedRect` directly.**

### `label`

```ts
export interface TextOptions {                                 // UI.ts:104-111
  size?: number;
  color?: number;
  alpha?: number;
  font?: string;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
}

export function label(
  scene: Phaser.Scene,
  x: number, y: number,
  text: string,
  opts: TextOptions = {}
): Phaser.GameObjects.Text                                     // UI.ts:113
```

Defaults: `font = FONT.ui`, `size = TYPE.body`, `color = theme().ink`,
`alpha = 1`, `align = 'left'`. Colour+alpha are collapsed into one CSS string via
`rgba()` (`UI.ts:124`) — there is no separate `setAlpha` call, so tweening a
label's alpha and reading `opts.alpha` are different mechanisms.
`setLetterSpacing` is applied only when `opts.letterSpacing` is truthy
(`UI.ts:128`), so `0` is a no-op.

### `softShadow`

```ts
export function softShadow(
  g: Phaser.GameObjects.Graphics,
  x: number, y: number, w: number, h: number,
  radius: number,
  strength = 1
): void                                                        // UI.ts:139
```

Three stacked translucent rounded rects, verbatim (`UI.ts:149-153`):

```ts
const layers = [
  { spread: pt(7),   dy: pt(4),   alpha: 0.05 },
  { spread: pt(4),   dy: pt(2.5), alpha: 0.06 },
  { spread: pt(1.5), dy: pt(1),   alpha: 0.07 },
];
```

Each layer is drawn at `(x - spread, y - spread + dy)` with size
`(w + spread*2, h + spread*2)` and radius `radius + spread`, in `theme().ink` at
`alpha * strength`. Phaser has no Graphics shadow primitive and a blur
post-pipeline would cost a render target for one card (`UI.ts:132-138`).

**Consequence for atlas baking:** the shadow reaches `pt(7) = 14` px past the
card box, which is exactly why both bake routines pad each atlas slot by
`pt(9) = 18` (`LevelSelectScene.ts:178-181`, `GalleryScene.ts:163-165`). Increase
the largest `spread` and the padding must follow or cards will clip each other.

### `button`

```ts
export interface ButtonOptions {                               // UI.ts:169-176
  width: number;
  height?: number;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: number;
  sub?: string;
  onPress: () => void;
}

export function button(
  scene: Phaser.Scene,
  x: number, y: number,
  text: string,
  opts: ButtonOptions
): Phaser.GameObjects.Container                                // UI.ts:186
```

Defaults: `variant = 'primary'`, `height = opts.sub ? pt(66) : pt(54)`
(132 or 108 base px, `UI.ts:196`), `size = TYPE.heading`.

Variant paint table (`UI.ts:201-216`), rest / pressed:

| Variant | Shadow | Fill |
| --- | --- | --- |
| `primary` | `softShadow(..., RADIUS.md, pressed ? 0.4 : 1)` | `t.ink` at `pressed ? 0.86 : 1` |
| `secondary` | none | `t.ink` at `pressed ? 0.09 : 0.055` |
| `ghost` | none | `t.ink` at `pressed ? 0.06 : 0` |

Label colour is `t.paper` on `primary`, `t.ink` otherwise; alpha `1` on primary,
`0.9` otherwise (`UI.ts:220-229`). With `sub`, the main label moves to `-pt(9)`
and the sub sits at `pt(13)`, `TYPE.label`, alpha `0.66` on ink / `0.5` off
(`UI.ts:222-240`).

Press feel: scale dip to `0.965` over 90 ms `Quad.easeOut` on down
(`UI.ts:272`); settle back to `1` over 320 ms `Back.easeOut` on up
(`UI.ts:264`). A scale dip rather than a colour flash, because on a page this
quiet motion reads as responsive where colour reads as noise (`UI.ts:182-185`).

**The gesture model — the second half of the "buttons need three taps" story
(`UI.ts:245-257`).** Arm on the container's own `pointerdown`, but resolve on the
**scene's** `POINTER_UP`. The obvious version (fire on the button's `pointerup`,
cancel on `pointerout`) is unusable on touch: a finger always slides a few pixels,
Phaser emits `pointerout` the instant it leaves the hit rectangle, and the press
is cancelled. Movement is therefore judged by **distance** against `TAP_SLOP`
(`UI.ts:280`), which is what UIKit does.

Release still has to land on the button, so dragging off to cancel keeps working
(`UI.ts:282-286`):

```ts
const b = container.getBounds();
b.setTo(container.x - w / 2, container.y - h / 2, w, h);
if (!b.contains(p.x, p.y)) return;
```

Traps in that block:
- `getBounds()` walks every child of the container and its result is immediately
  overwritten by `setTo` — wasted work on every armed release inside the slop.
- The rectangle is built from `container.x/y`, i.e. **local** coordinates. Correct
  only for a top-level container on a camera with zero scroll. A `button` nested
  inside a scrolling container, or on the grid camera, would test the wrong box.
- Nothing is re-checked between arm and release. Phaser's `inputCandidate`
  (`node_modules/phaser/src/input/InputManager.js:838-866`) does skip invisible
  and fully transparent objects, so a hidden button never *arms* — but a button
  armed on `pointerdown` and then hidden, disabled or moved before the release
  still fires `onPress`, because `onUp` only consults the slop distance and a
  rectangle it rebuilds from `container.x/y`.

Lifecycle: the scene-level listener is removed on the container's `destroy`
(`UI.ts:291-294`). `GameScene.buildRevealPill` (`GameScene.ts:604-663`)
reimplements this same arm/slop/bounds protocol by hand rather than reusing
`button`, with the same comment about `pointerout` (`GameScene.ts:633-636`).

### `rule`, `wordmark`, `enter`

```ts
export function rule(
  scene: Phaser.Scene, x: number, y: number, w: number, alpha = 0.1
): Phaser.GameObjects.Graphics                                 // UI.ts:302

export function wordmark(
  scene: Phaser.Scene, x: number, y: number
): Phaser.GameObjects.Container                                // UI.ts:319

export function enter(
  scene: Phaser.Scene,
  targets: Phaser.GameObjects.GameObject[],
  stagger = 45
): void                                                        // UI.ts:349
```

- `rule` fills `(x - w/2, y, w, Math.max(1, pt(0.5)))` in `theme().ink`. **No
  callers anywhere in `src/` — dead export.**
- `wordmark` draws "foldwing" at `TYPE.hero` in `FONT.display` with
  `letterSpacing: pt(0.5)`, plus a copy flipped with `setScale(1, -1)` at
  `alpha: t.mirrorAlpha * 0.42` (= 0.189) and `y = pt(3)`, both
  `setOrigin(0.5, 1)`. Children are added `[reflection, top]` so the upright
  wordmark is on top. The reflection hangs a **full line-height below the
  baseline**, which is why `MenuScene.ts:54-60` places the tagline well clear
  of it.
- `enter` mutates each target's `y` and `alpha` **before** tweening: it records
  `restY = o.y`, sets `o.y = restY + pt(14)` and `o.alpha = 0`, then tweens back
  over 420 ms `Cubic.easeOut` with `delay: i * stagger`. **Trap:** `enter` reads
  the object's current `y` as the rest position, so calling it twice on the same
  object, or calling it while another tween is animating `y`, bakes the offset in
  permanently. Callers: `MenuScene.ts:159` (default stagger 45),
  `LevelSelectScene.ts:155` (32), `GalleryScene.ts:143` (26).

---

## 4. HitArea — the top-3 trap in the repo

`src/render/HitArea.ts` is 67 lines and 24 of them are the explanation. Read
those 24 lines before touching any interactive object.

### The Phaser transform, exactly

`Phaser.Input.InputManager#pointWithinHitArea`
(`node_modules/phaser/src/input/InputManager.js:965-967`) does:

```js
//  Normalize the origin
x += gameObject.displayOriginX;
y += gameObject.displayOriginY;
```

...**after** the pointer has already been transformed into the object's local
space. For a Container, `displayOriginX` is a getter returning `this.width * 0.5`
(`node_modules/phaser/src/gameobjects/container/Container.js:299-306`), and
`setSize(w, h)` is what sets `width`.

So the pipeline for a container centred at `(cx, cy)` with `setSize(w, h)` is:

```text
screen point (px, py)
  → local  = (px - cx, py - cy)          // invert world transform
  → normal = local + (w/2, h/2)          // pointWithinHitArea adds displayOrigin
  → tested against the hit Rectangle
```

The normalized point is therefore in **top-left space** — the same space a
texture frame lives in — regardless of where the art is drawn.

### Why `Rectangle(-w/2, -h/2, w, h)` subtracts twice

The art is drawn at `(-w/2, -h/2, w, h)` because Graphics inside the container are
centred on the origin. Writing the *same* rectangle for the hit area reads as
obviously correct and is wrong: the `+= displayOrigin` step has **already**
converted the point out of centre space, so the rectangle's own `-w/2, -h/2`
shifts it a second time.

```text
w = 638, h = 108, centre (375, 918)

hit = (-319, -54, 638, 108)        // the version that shipped
originX = 375 - 319 = 56           // cx - w/2
live.left   = 56 + (-319) =  -263  // painted.left is 56
live.right  = 56 + (-319) + 638 = 375   == cx
live.top    = 864 + (-54) = 810    // painted.top is 864
live.bottom = 864 + (-54) + 108 = 918   == cy

→ live area is the painted area shifted (-w/2, -h/2).
→ overlap with the painted face = exactly 1/4 of it (the top-left quarter).
→ the other 3/4 of the live area hangs off the top-left, over whatever is there.
```

Measured on the shipped build: the menu's Levels button responded on **10 of 45**
probe points (`HitArea.ts:19-20`, README.md:181-182). That is the whole of "I have
to tap Play two or three times", and the overhang also *stole* taps meant for the
button above.

### The correction

```ts
export interface HitRect {                                     // HitArea.ts:26-31
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function centredHitArea(w: number, h: number): HitRect  // HitArea.ts:37
// → { x: 0, y: 0, width: w, height: h }

export interface Box {                                         // HitArea.ts:41-46
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export function paintedBox(cx: number, cy: number, w: number, h: number): Box // :49
export function liveBox(hit: HitRect, cx: number, cy: number, w: number, h: number): Box // :58
```

`liveBox` is a faithful re-implementation of Phaser's derivation, in plain
arithmetic (`HitArea.ts:59-66`):

```ts
const originX = cx - w / 2;
const originY = cy - h / 2;
return {
  left:   originX + hit.x,
  right:  originX + hit.x + hit.width,
  top:    originY + hit.y,
  bottom: originY + hit.y + hit.height,
};
```

The whole module is kept **free of Phaser** on purpose (`HitArea.ts:22-23`) so
the maths can be proved in a unit test rather than only in a browser — which
matters because `vite.config.ts:15-20` runs tests in a `node` environment where
Phaser cannot be imported.

### The test that pins it

`src/render/HitArea.test.ts`:

| Test | Lines | Asserts |
| --- | --- | --- |
| `${c.name} responds over its whole face` (4 cases) | `:19-24` | `liveBox(centredHitArea(w,h), …)` deep-equals `paintedBox(…)` |
| `covers every point of the face, corners included` | `:26-38` | 21×21 grid of probe points inside `CASES[1]` all fall in `[left, right)` × `[top, bottom)` |
| `responded only over the top-left quarter` | `:45-58` | for the shipped rect: `live.right === cx`, `live.bottom === cy`, `live.left === painted.left - w/2`, overlap area ratio `≈ 0.25` |
| `overhung its neighbour, stealing taps meant for the button above` | `:60-72` | Gallery's shipped live-top `=== 994 - 54 = 940`, which is `< ` Levels' painted bottom (972); the fixed version's top `>=` it |

The four pinned cases are the real shipped geometry (`HitArea.test.ts:12-17`):

```ts
{ name: 'menu primary',   cx: 375, cy: 776,  w: 638, h: 132 },
{ name: 'menu secondary', cx: 375, cy: 918,  w: 638, h: 108 },
{ name: 'reveal pill',    cx: 604, cy: 52,   w: 148, h: 68  },
{ name: 'back chevron',   cx: 80,  cy: 104,  w: 104, h: 88  },
```

The two menu cases reproduce **exactly** from `MenuScene.ts:77-106` in the
not-selling branch: `cursorY` starts at `pt(355) = 710`, `tallRow = pt(66) = 132`,
`row = pt(54) = 108`, `rowGap = pt(11) = 22`, so `place()` yields
`710 + 66 = 776`, then `864 + 54 = 918`, then `994 + 54 = 1048` — the last being
the Gallery centre the fourth test uses. Sizes come from `COLUMN = 638`.

Two fixture values have drifted from the code and are worth knowing before you
trust them as documentation of current geometry (the assertions are
translation-invariant, so nothing fails):

- `reveal pill` `cx: 604` — `GameScene.ts:609` now places it at
  `BASE_WIDTH - METRICS.inset.right - pt(42) = 642`. `cy`, `w`, `h` are current.
- `back chevron` `cx: 80` — `LevelSelectScene.ts:47` places it at
  `margin + pt(30) = 104`. `w`/`h` are current; `GalleryScene.ts:49` uses
  `cy = pt(56) = 112` rather than 104.

**Rule:** never call `setInteractive` with a hand-built rectangle. Go through
`tappable` (`UI.ts:27`). If you need a non-rectangular or offset hit area, extend
`HitArea.ts` and add a case to its test — that is where the invariant lives.

---

## 5. ScrollView

`src/render/ScrollView.ts`. A vertically draggable list. **All input is handled
at the SCENE level and hit-tested by hand** rather than giving each row its own
interactive object (`ScrollView.ts:1-18`), for two reasons:

1. A per-row `pointerup` cancels itself on a few pixels of drift — the same
   `pointerout` bug that made the menu buttons feel dead.
2. Scrolling and tapping are the **same gesture** until the finger has moved far
   enough to be one or the other. Only one place can make that call, and it has
   to be the thing that owns the drag.

### Motion constants (verbatim, `ScrollView.ts:23-39`)

```ts
const FRAME_MS = 1000 / 60;  // :24  one frame at the 60Hz the constants are tuned against
const DECAY = 0.92;          // :26  per-frame velocity retained during glide
const SETTLE = 0.25;         // :28  fraction of remaining overshoot removed per frame
const FLICK_MIX = 0.35;      // :30  how much of the newest sample enters the throw speed
const MAX_FLICK = 120;       // :32  px/frame ceiling on a single sample
const GLIDE_STOP = 0.6;      // :39  above this speed a touch means "stop", not "choose"
```

`GLIDE_STOP = 0.6` is deliberately well above the `0.1` px/frame at which the
glide is considered finished (`ScrollView.ts:243`), so a list that has *visually*
settled still accepts a tap (`ScrollView.ts:33-38`).

### API

```ts
export interface ScrollRow {                                   // ScrollView.ts:41-62
  readonly y: number;        // vertical centre in CONTENT space (0 = top of content)
  readonly height: number;
  readonly x: number;        // horizontal band, so a grid can put rows side by side
  readonly width: number;
  readonly view?: Phaser.GameObjects.GameObject;
  readonly onTap?: () => void;
  readonly onArm?: (armed: boolean) => void;
}

export interface ScrollViewOptions {                           // ScrollView.ts:64-70
  readonly top: number;      // visible window, screen space
  readonly bottom: number;
  readonly contentHeight: number;
  readonly items: readonly ScrollRow[];
}

constructor(
  private readonly scene: Phaser.Scene,
  private readonly content: Phaser.GameObjects.Container,
  private readonly opts: ScrollViewOptions
)                                                              // ScrollView.ts:83
get scrollable(): boolean                                      // :105
get progress(): number                                         // :110  0..1, or 0 when everything fits
scrollTo(offset: number): void                                 // :115  clamped, zeroes velocity
```

`maxOffset = Math.max(0, contentHeight - (bottom - top))` (`:89`). `y` is
**content** space, `x` is **screen** space — the mix is real and is what lets a
3-column grid share one `ScrollRow` list.

A row with no `onTap` is drawn but not selectable (locked levels); `hit()` skips
those entirely (`:130`). A row with no `view` is never culled.

### Lifecycle

Four scene-level listeners registered in the constructor (`:92-95`):
`POINTER_DOWN`, `POINTER_MOVE`, `POINTER_UP`, and `Scenes.Events.UPDATE`. All
four are removed on `Scenes.Events.SHUTDOWN` (`:97-102`). There is no `destroy()`
— the ScrollView's life is the scene's. `LevelSelectScene.ts:145` keeps the
instance only to call `scrollTo`; `GalleryScene.ts:140` discards it entirely.

### Tap-vs-drag discrimination

```text
POINTER_DOWN (:170)
  ├─ outside [top, bottom]?           → ignore entirely (dragging stays false)
  ├─ |velocity| > GLIDE_STOP (0.6)?   → arm NOTHING; this touch only stops the glide
  └─ otherwise                        → arm hit(px, py)
POINTER_MOVE (:190)
  ├─ !dragging                        → ignore
  ├─ travelled > TAP_SLOP (28)        → setArmed(-1): the gesture is now a scroll
  └─ !scrollable                      → return (no offset change, but the disarm above stands)
POINTER_UP (:217)
  └─ travelled <= TAP_SLOP AND armed >= 0 AND hit(px, py) === armed
       → velocity = 0; items[armed].onTap?.()
```

`travelled` is measured from the **pointerdown** point, not accumulated
(`:193`, `:221`) — so a wander-out-and-back gesture still counts as a tap if it
ends where it started.

**The glide-stop rule (`ScrollView.ts:172-179`) is load-bearing.** Arming the row
under the finger meant a flick followed by a grab — the ordinary way to halt a
fling — opened whatever card was sliding past. UIScrollView and RecyclerView both
swallow that gesture. This is the whole of the "scrolling opens levels" bug.

`setArmed` (`:163-168`) is idempotent and always fires `onArm(false)` on the
previous row before `onArm(true)` on the new one, so the highlight can never get
stuck on two rows.

### Momentum

Velocity is a smoothed throw speed, not the last delta (`:199-212`):

```ts
const dt = Math.max(FRAME_MS / 4, now - this.lastMoveAt);
const instant = Phaser.Math.Clamp((dy / dt) * FRAME_MS, -MAX_FLICK, MAX_FLICK);
this.velocity = this.velocity * (1 - FLICK_MIX) + instant * FLICK_MIX;
```

The `FRAME_MS / 4` floor (4.1667 ms) exists because **two pointer moves can share
a frame**: `scene.time.now` has not advanced, and a naive 1 ms floor turned a
20px delta into 320 px/frame and made the list jump (`:201-207`).

`onUpdate` (`:232-258`) integrates in units of TIME, not frames:

```ts
const steps = Phaser.Math.Clamp(delta, 1, 50) / FRAME_MS;
// glide
if (Math.abs(this.velocity) > 0.1) {
  this.applyOffset(this.offset - this.velocity * steps, true);
  this.velocity *= Math.pow(DECAY, steps);
}
// rubber-band
const k = 1 - Math.pow(1 - SETTLE, steps);
```

A fixed per-frame factor would make the same flick travel twice as far on a
120 Hz phone as on a 60 Hz one, and stutters would translate straight into uneven
deceleration (`:235-240`). The `Clamp(delta, 1, 50)` also stops a tab-restore
frame (`delta` in the hundreds of ms) from teleporting the list.

Rubber-band snaps to the exact target once within 0.5 px (`:256`), so the offset
cannot asymptote forever.

### `applyOffset` and the sub-pixel rule

```ts
private applyOffset(next: number, rubber: boolean): void       // ScrollView.ts:264
```

- `slack = rubber ? 90 : 0`, so `offset ∈ [-90, maxOffset + 90]` while the finger
  is down — hitting the end feels elastic rather than dead. (`90` is an unnamed
  magic number; every other motion constant in this file is a named `const`.)
- `this.content.y = Math.round(this.opts.top - this.offset)` — **`Math.round` is
  load-bearing** (`:267-269`). A container on a fractional offset resamples every
  glyph and hairline every frame, which reads as shimmer while scrolling.
- Every offset change calls `cull()`.

### Off-screen culling

```ts
private cull(): void                                           // ScrollView.ts:150
```

Shows a row when its box overlaps `[offset - slack, offset + windowH + slack]`
where `slack = it.height` — **one row of slack either side**, so a card is
already painted by the time it slides into view; popping in at the edge would
trade a frame-rate problem for a worse-looking one (`:143-149`). `setVisible` is
only called when the state actually changes (`:159`).

**Why it exists (`ScrollView.ts:50-56`).** Phaser does not cull inside a
Container, so all 100 level cards were submitted every frame — 202 Graphics and
103 Texts, about **300 draw calls**, for the ~15 rows a phone can show. Measured:
the grid ran at **5 fps** while the menu and the game held 60 in the same
browser.

---

## 6. The grid render-texture atlases

Culling alone got the level grid from 5 fps to 14. The remaining two fixes live
in the scenes. Measured numbers, all from README.md:185-194 and the scene
comments:

| Change | Effect | Source |
| --- | --- | --- |
| baseline: 100 cards of vector Graphics | **5 fps** | README.md:187 |
| `ScrollView` hides off-screen rows | 5 → **14 fps** | README.md:188 |
| cards baked into one render-texture atlas, drawn as quads | 14 → **42 fps** | README.md:188-190 |
| camera viewport instead of geometry mask | 42 → **61 fps** | README.md:190-191 |
| under an actual drag, dropped frames | 100% → **1.3%** | README.md:192 |

Per-frame costs that motivated the bake, measured with only the visible rows
drawn (`LevelSelectScene.ts:158-173`):

| Item | Cost/frame | Budget |
| --- | --- | --- |
| level previews (Graphics) | **30 ms** | 16 ms |
| card backgrounds (Graphics) | **25 ms** | |
| number labels (Text) | **~0** — a Text is already a textured quad | |

Gallery, worse because a figure is a whole ribbon (`GalleryScene.ts:146-158`):

| Saved figures | Frame time |
| --- | --- |
| 0 | 16.7 ms |
| 1 | **583 ms** |
| 6 | ~330 ms |
| 33 | stopped rendering at all |

The save keeps up to `MAX_FIGURES = 120` (`Progress.ts:70`), so this screen was
on a path to being unusable for exactly the players who had used it most.

### The bake

```ts
private bakeCards(w: number, h: number): string      // LevelSelectScene.ts:174
private bakeFigures(figures: readonly SavedFigure[], w: number, h: number): string // GalleryScene.ts:159
```

Both follow the same seven steps:

```text
1. key = 'foldwing-level-cards' | 'foldwing-gallery-cards'
   if textures.exists(key) → textures.remove(key)     // re-entry safety
2. pad = pt(9); slotW = ceil(w + pad*2); slotH = ceil(h + pad*2)
3. cols = max(1, floor(2048 / slotW)); rows = ceil(n / cols)   // GalleryScene
                                                               // wraps rows in max(1, …)
      2048 = "well inside the smallest max-texture-size we could meet"
4. rt = this.make.renderTexture({width: cols*slotW, height: rows*slotH}, false)
      the `false` means: do NOT add to the display list
5. for each item: build the card Container, position it at the slot centre,
   rt.draw(art), art.destroy()
6. rt.saveTexture(key); then tex.add(String(i), 0, sx, sy, slotW, slotH)
      → each card becomes a NAMED FRAME, indexed by its string index
7. register the SHUTDOWN teardown (below)
```

Cards are then plain Images: `this.add.image(x, y, atlas, String(i))`
(`LevelSelectScene.ts:95`, `GalleryScene.ts:109`). All 100 share one texture and
batch into a single draw call, and the 100 `Text` objects vanish into the bake
along with the canvas each was allocating (`LevelSelectScene.ts:169-173`).

Derived atlas size for the shipped level grid (arithmetic from
`LevelSelectScene.ts:32-33`, `:45`, `:77-79`, `:178-184`):

```text
margin  = inset.left + pt(10)          = 24 + 20      = 44
gridW   = 750 - 44*2                                   = 662
cardW   = (662 - 20*(3-1)) / 3                         = 207.333…
cardH   = cardW * 0.94                                 = 194.893…
slotW   = ceil(207.333 + 36) = 244    slotH = ceil(194.893 + 36) = 231
cols    = floor(2048 / 244)  = 8      rows  = ceil(100 / 8)      = 13
texture = 1952 × 3003 px  →  1952*3003*4 bytes = 23,447,424 = 22.36 MB
```

That confirms the "~22MB" figure at `LevelSelectScene.ts:205` and README.md:192.

### Atlas lifetime — why destroying the RenderTexture leaks

`LevelSelectScene.ts:204-214`, `GalleryScene.ts:184-189`:

```ts
this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
  rt.destroy();
  if (this.textures.exists(key)) this.textures.remove(key);
});
```

`rt.saveTexture(key)` registers the underlying texture with the **TextureManager**,
which keeps its **own reference**. Destroying the RenderTexture Game Object
therefore frees the Game Object and nothing else — verified: without the explicit
`textures.remove`, the 22 MB atlas was **still resident after returning to the
menu** (`LevelSelectScene.ts:204-210`).

Both halves are required. Both scenes also defensively `textures.remove(key)` at
the *start* of the bake (`LevelSelectScene.ts:176`, `GalleryScene.ts:161`) so a
re-entry with a stale atlas cannot collide on the key.

### Camera viewport, not geometry mask

`LevelSelectScene.ts:128-143` (and the same pattern, abbreviated, at
`GalleryScene.ts:133-138`):

```ts
const grid = this.cameras.add(0, top, BASE_WIDTH, bottom - top);
grid.setScroll(0, top);
grid.ignore([back, title, counter]);
this.cameras.main.ignore(content);
```

Both a geometry mask and a second camera hide the cards that would run under the
header or beneath the banner. A geometry mask costs a **full stencil pass every
frame — measured at ~8 ms here, half the entire frame budget** — whereas a camera
viewport is a GPU scissor rectangle and costs nothing.

**The trap this creates:** the two cameras must be told to ignore each other's
objects. Anything added to either of these scenes after this block **must** be
added to one `ignore` list or the other, or it draws **twice**
(`LevelSelectScene.ts:136-138`). Window geometry: `top = pt(120) = 240`,
`bottom = BASE_HEIGHT - METRICS.bannerReserve - pt(6) = 1206`.

`LevelSelectScene.ts:98-100` records a subtlety: **every** card is registered as
a `ScrollRow`, locked or not, because `ScrollView` is what hides the off-screen
ones — a locked card left out of `items` would have no `view` to cull and would
stay drawn for the whole scroll.

---

## 7. ShareCard

`src/render/ShareCard.ts`. Drawn on a **plain 2D canvas**, not through Phaser's
WebGL snapshot (`ShareCard.ts:1-19`). Three requirements a render-texture
readback cannot reliably meet: pixel-exact output, identical on web and device,
and available **without a live scene** (the gallery renders figures earned in an
earlier session).

```ts
export const CARD_SIZE = 1080;                                 // ShareCard.ts:28

export interface CardOptions {                                 // ShareCard.ts:30-42
  readonly size?: number;
  readonly transparent?: boolean;
  readonly caption?: string;        // falsy hides the whole footer
  readonly showWordmark?: boolean;
  readonly marginScale?: number;    // default 0.12
  readonly nibScale?: number;       // multiplier on the nib
  readonly flat?: boolean;          // skip the grain — for the app icon
}

export function renderShareCard(figure: SavedFigure, opts: CardOptions = {}): string // :124
```

Returns a PNG data URL, or `''` if `getContext('2d')` fails (`:132`).

Defaults: `size = CARD_SIZE` (1080), `marginScale = 0.12`, `nibScale = 1`,
`showWordmark` defaults **on** (the check is `opts.showWordmark !== false`, `:160`
and `:195`).

**Why the card, not the transparent PNG, is the default (`ShareCard.ts:16-18`):**
a transparent PNG posted to a social app lands on whatever background that app
uses — usually black — and the dark ink disappears into it. A shared image nobody
can see is not a share.

### Pipeline

```text
1. canvas = document.createElement('canvas'); size × size            :128-131
2. background (skipped when opts.transparent)                        :134-141
     opts.flat  → flat fillRect in t.paper
     otherwise  → layPaper() (paper + grain)
3. pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)        :146
     raw = figure.points.map(pf.toScreen)                            :147
     stroke = renderStroke(raw, figure.times,
                METRICS.renderMaxSpacing, METRICS.smoothIterations)  :148-153
4. mirrored = mirrorPath(stroke.points, pf.axisX)                    :155
   outline  = closedFigure(stroke.points, pf.axisX)                  :156
   bounds   = boundsOf(outline);  null → return the blank canvas     :157-158
5. layout                                                            :160-173
     hasFooter = Boolean(caption) || showWordmark !== false
     margin    = size * (marginScale ?? 0.12)                = 129.6 at 1080
     footer    = hasFooter && !transparent ? size * 0.11 : 0 = 118.8 at 1080
     boxW      = size - margin*2
     boxH      = size - margin*2 - footer
     scale     = min(boxW / max(bounds.w,1), boxH / max(bounds.h,1))   // UNIFORM
     offX      = size/2 - (bounds.x + bounds.w/2) * scale
     offY      = margin + (boxH - bounds.h*scale)/2 - bounds.y*scale
     nibWidth  = pt(t.strokePt) * scale * (nibScale ?? 1)
6. paint, in this order                                              :175-183
     fill    outline   at rgba(ink, winFillAlpha)   // silhouette first
     ribbon  mirrored  at rgba(ink, mirrorAlpha)
     ribbon  stroke    at rgba(ink, 1)
7. footer text (only when footer > 0)                                :185-201
     baseY = size - margin * 0.72
     caption  : round(size*0.034) px Georgia…, rgba(ink,0.46), centred,
                at baseY - size*0.055
     wordmark : round(size*0.042) px Georgia…, rgba(ink,0.8),  centred, at baseY
8. return canvas.toDataURL('image/png')                              :203
```

**Uniform scale is deliberate (`:166-167`):** the figure's proportions *are* the
drawing; stretching it to fill the square would make every player's figure the
same shape.

**Reference-playfield reconstruction (`:143-146`) is the reason figures are
stored normalized** (`Playfield.ts:50-56`). The saved figure is rebuilt in the
canonical 750×1334 playfield first and only *then* fitted to the card, so the
shape matches the game exactly regardless of which device drew it.

### `layPaper` and the `putImageData` trap

```ts
function layPaper(ctx: CanvasRenderingContext2D, size: number, paper: number): void // :58
```

Fills `paper`, then generates a **256×256** tile of 1-bit noise
(`Math.random() < 0.5 ? 0 : 255`) with **alpha byte 10** per pixel (`:71-79`),
`putImageData`s it into the offscreen tile, and stretches it over the card with
`globalAlpha = 0.5`, `imageSmoothingEnabled = true`, inside a `save`/`restore`
(`:82-86`). Returns early and silently if the offscreen 2D context is null
(`:69`).

**The trap, verbatim from `ShareCard.ts:52-56`:** the grain goes through an
offscreen canvas and `drawImage`, **NOT** `putImageData` onto the card.
`putImageData` does not composite — it *overwrites* destination pixels including
their alpha — so painting grain that way punched the opaque paper down to ~10%
alpha and every colour laid on top came out wrong.

The tile is small and stretched because full-resolution noise is "4MB of work for
a texture nobody can resolve at this alpha anyway" (`:62-63`).

### Callers

| Caller | Options |
| --- | --- |
| `GameScene.ts:503-505` | `{ caption: \`${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s\` }` |
| `GalleryScene.ts:234-236` | same caption shape |
| `main.ts:56-67` | dev-only `window.foldwing = { renderShareCard }`, behind `import.meta.env.DEV` so it is tree-shaken from `vite build` |

`main.ts:64-66` records that the **app icon is generated by asking the game to
draw a figure** — that is what `flat`, `nibScale`, `transparent` and
`marginScale` exist for. No in-repo caller passes any of them; they are driven
from the dev console via that handle.

---

## 8. Cross-cutting invariants and traps

| # | Invariant | Where | Breaks if |
| --- | --- | --- | --- |
| 1 | Ribbon alpha must be baked into the **colour**, never set on the Graphics object | `InkRenderer.ts:70-94`, `:178-179`, `:350-353` | you "simplify" to `setAlpha(mirrorAlpha)`; the reflection renders at an effective 0.95-0.97 |
| 2 | Hit areas are authored in **top-left** space | `HitArea.ts:1-24`, pinned `HitArea.test.ts` | you write `Rectangle(-w/2,-h/2,w,h)`; ¾ of the button dies and the rest steals neighbours' taps |
| 3 | `setSize(w,h)` **before** `tappable(c,w,h)` | `UI.ts:242-243`, Container.js:299-306 | `displayOriginX` is 0 and the correction silently does nothing |
| 4 | Never call `fillRoundedRect` directly; use `roundRect` | `UI.ts:83-102` | a pill radius on a short box paints full-height streaks across the page |
| 5 | Touch gestures are judged by **distance**, never by `pointerout` | `UI.ts:245-257`, `ScrollView.ts:190-196`, `GameScene.ts:633-636` | buttons need two or three stabs |
| 6 | A touch landing while the list glides only **stops** it | `ScrollView.ts:172-187` | flick-then-grab opens a random level |
| 7 | Content offset must be **rounded to whole pixels** | `ScrollView.ts:267-269` | text and hairlines shimmer during scroll |
| 8 | `saveTexture` requires `textures.remove(key)` on shutdown, not just `rt.destroy()` | `LevelSelectScene.ts:204-214`, `GalleryScene.ts:184-189` | 22 MB stays resident after leaving the screen |
| 9 | Every new object in a two-camera scene must be in exactly one `ignore` list | `LevelSelectScene.ts:136-138` | it draws twice |
| 10 | `hitRadius` must never migrate into `InkTheme` | `Theme.ts:1-18`, pinned `Theme.test.ts:84-89` | a purchasable skin becomes pay-to-win |
| 11 | Grid rows must not overlap `bannerReserve` | `Theme.ts:186-211`, `LevelSelectScene.ts:69-75` | visible-but-untappable rows; ad-policy risk from accidental clicks |
| 12 | Atlas slot padding must exceed `softShadow`'s largest spread (`pt(7)`) | `UI.ts:150`, `LevelSelectScene.ts:178-181` | adjacent cards clip each other's shadows |

### Dead / unwired code noticed while reading

- `UI.ts:302-313` `rule()` — exported, never called.
- `UI.ts:67-72` `RADIUS.lg` — never referenced.
- `UI.ts:58-65` `SPACE` — only `SPACE.lg` is used, once (`MenuScene.ts:179`).
- `Theme.ts:88-101` `THEMES` / `setTheme` — no production caller; the only
  invocation is `Theme.test.ts:60`.
- `ShareCard.ts:30-42` `transparent`, `flat`, `nibScale`, `marginScale`, `size` —
  no in-repo caller; reachable only through the dev-only `window.foldwing` handle.
- `GameScene.ts:601` `void t;` — a `theme()` result deliberately discarded.

---

## See also

- [01-architecture.md](01-architecture.md) — where the render layer sits in the whole
- [02-coordinate-system.md](02-coordinate-system.md) — normalized ↔ pixel, `Playfield`, the LOCKED axis
- [03-geometry-collision.md](03-geometry-collision.md) — `mirrorPath`, `boundsOf`, and why `hitRadius` is not a render concern
- [04-stroke-ribbon.md](04-stroke-ribbon.md) — `renderStroke`, `closedFigure`, `buildRibbon`, `DEFAULT_RIBBON`
- [06-scenes.md](06-scenes.md) — `GameScene`, `MenuScene`, `LevelSelectScene`, `GalleryScene` call order
- [09-systems.md](09-systems.md) — `Progress.SavedFigure`, `Share`, `Haptics`
- [10-monetization.md](10-monetization.md) — `reveals.durationMs`, the banner, and `bannerReserve`
- [12-testing.md](12-testing.md) — the node-environment constraint that shapes what can be tested here
- [13-api-reference.md](13-api-reference.md) — full exported-symbol index
- [../README.md](../README.md) — narrative rationale; §"Two things that look like polish and are not" (README.md:174-194) is the source of the measured fps figures, and README.md:257-269 states the open LOCKED-radius question
