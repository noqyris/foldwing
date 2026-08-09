# Coordinate Systems, Metrics & the LOCKED Contract

## What this covers

The three coordinate spaces (normalized level space, base canvas / playfield
pixels, device CSS pixels), the exact conversions between them, the complete
`Playfield` API, `BASE_WIDTH`/`BASE_HEIGHT`/`PT`/`pt()`, the full `METRICS`
object, `InkTheme`/`THEMES`, the structural separation of `METRICS.hitRadius`
from the cosmetic theme, every `LOCKED` marker in the repo, and which test pins
which constant. Read this before changing any number in `Theme.ts`.

## Source files

| path | lines | role |
| --- | --- | --- |
| `src/data/types.ts` | 34 | `Level` shape; the LOCKED coordinate-system contract in prose |
| `src/core/Playfield.ts` | 87 | the only normalized→pixel converter; owns `axisX` and the soft wall |
| `src/render/Theme.ts` | 212 | `BASE_WIDTH`/`BASE_HEIGHT`/`PT`/`pt()`, `InkTheme`, `THEMES`, `METRICS` |
| `src/render/Theme.test.ts` | 140 | pins base canvas, palette, and every feel constant |
| `src/core/Playfield.test.ts` | 134 | pins the axis, the mirror involution, and the drawable clamp |
| `src/core/Geometry.ts` | 326 | `Vec2`/`Rect`, `clamp`, `mirrorPoint` — the primitives Playfield delegates to |
| `src/main.ts` | 67 | Phaser `FIT` + `CENTER_BOTH` against the base canvas; viewport-settle refresh |
| `index.html` | 61 | `position:fixed` lock that keeps the canvas rect and pointer transform in sync |

---

## 1. The three spaces

```text
  NORMALIZED LEVEL SPACE                 x,y ∈ [0,1], y down, axis at x = 0.5
  (data/types.ts, levels.ts, SavedFigure.points)
        │
        │  Playfield.toScreen / toScreenRect      ← the ONLY sanctioned edge
        │  Playfield.toNormalized (inverse)
        ▼
  BASE CANVAS PIXELS                     750 × 1334, origin top-left of canvas
  (everything: collision, rendering, input, METRICS, pt())
   └─ PLAYFIELD PIXELS is a sub-rect of it: x=24 y=88 w=702 h=1102
        │
        │  Phaser Scale.FIT + CENTER_BOTH  (main.ts:16-21) — not code you call
        ▼
  DEVICE CSS PIXELS                      whatever the webview reports
  (never appears in game code; pointer.x/y arrive already converted back)
```

### 1.1 Normalized level space

Defined verbatim at `src/data/types.ts:4-18`:

> COORDINATE SYSTEM — LOCKED.
> Levels are authored in normalized coordinates across the FULL playfield:
> x ∈ [0,1] spans the entire width, y ∈ [0,1] the entire height, y growing
> downward. The mirror axis is x = 0.5.

Rules, all from that header:

| rule | source |
| --- | --- |
| player may only draw where `x < 0.5`; the axis is a **soft wall** — clamped, never rejected | `src/data/types.ts:9-10` |
| `mirror(p) = { x: 1 - p.x, y: p.y }` | `src/data/types.ts:11` |
| `start` and `goal` always authored with `x < 0.5`; their mirrors are drawn at reduced opacity and are **not** reachable targets | `src/data/types.ts:12-14` |
| a wall on the right at `x ∈ [a,b]` forbids the player `x ∈ [1-b, 1-a]` at the same `y` — "that projection is the entire game" | `src/data/types.ts:16-17` |

Level shape, verbatim (`src/data/types.ts:23-34`):

```ts
export interface Level {
  readonly id: string;
  readonly name: string;
  /** Normalized, x < 0.5. */
  readonly start: Vec2;
  /** Normalized, x < 0.5. */
  readonly goal: Vec2;
  /** Normalized, full-playfield coords. Asymmetric by design — LOCKED. */
  readonly walls: readonly Rect[];
  /** Target completion time, for a later "par" display. Not used yet. */
  readonly parMs?: number;
}
```

`Rect` and `Vec2` are re-exported from Geometry (`src/data/types.ts:19`); they
are plain mutable structs (`src/core/Geometry.ts:15-25`):

```ts
export interface Vec2 { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }
```

Normalized space is also the **storage format for saved figures**
(`src/systems/Progress.ts:27-36`), for the stated reason at
`src/core/Playfield.ts:53-55`: a figure drawn on a phone must redraw correctly at
1080×1080 in a share card.

### 1.2 Base canvas pixels

`src/render/Theme.ts:30-31`:

```ts
export const BASE_WIDTH = 750;
export const BASE_HEIGHT = 1334;
```

Rationale, verbatim from `src/render/Theme.ts:22-29`: Phaser runs FIT +
CENTER_BOTH against this fixed size, so game coordinates never change with the
device; 750×1334 is a 2× iPhone-SE portrait — 9:16, the widest common portrait
aspect, so taller phones **letterbox** into the paper-coloured page background
rather than **pillarboxing** and stealing the width the mirror needs.

`750 / 1334 = 0.5622188905547226`, which is why `Theme.test.ts:25` asserts
`BASE_WIDTH / BASE_HEIGHT < 0.5626` — a bound set fractionally *above* 9:16 =
0.5625, so the actual aspect (a hair narrower than 9:16) passes.

Everything downstream of `Playfield` — collision, rendering, input, every
`METRICS` value — is in base canvas pixels. There is no second unit in the
gameplay code.

**Playfield pixels** are base canvas pixels offset by the inset; they are not a
separate unit, just a sub-rectangle. `Playfield.x/y` is its origin.

### 1.3 `pt` — logical points

`src/render/Theme.ts:33-42`:

```ts
export const PT = 2;

export function pt(points: number): number {
  return points * PT;
}
```

Meaning (`src/render/Theme.ts:34-37`): the spec's sizes ("5px stroke", "42px
finger offset") are **points** — what a designer measures on a 375pt-wide screen
— so every one of them goes through `pt()` rather than being hardcoded at 2×.
`pt(n)` returns **base canvas pixels**, not CSS pixels. `PT = 2` because 750 base
px = 375 design points.

Pinned by `Theme.test.ts:29-32`: `PT === 2`, `pt(5) === 10`,
`pt(2.6) ≈ 5.2` (12 digits), `pt(0) === 0`.

### 1.4 Device CSS pixels

No game code converts to or from this space. It exists only in Phaser's scale
manager, configured once at `src/main.ts:16-21`:

```ts
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
  },
```

FIT gives `scale = min(cssWidth / 750, cssHeight / 1334)` uniformly on both axes.
The repo states the practical number at `src/core/LevelValidator.ts:300`:
**0.52 css px per base px on a 390pt-wide phone** (390 / 750 = 0.52). Because the
base aspect is slightly *wider* than any common portrait phone, the width term
almost always wins and the leftover height becomes an invisible paper-coloured
letterbox band (`src/main.ts:13-15` sets `backgroundColor: theme().paper`;
`index.html` paints the page the same `#e9ebe4`).

Two things keep this space from leaking into a bug, and both are load-bearing:

| mechanism | location | what breaks without it |
| --- | --- | --- |
| `game.scale.refresh()` on `resize`, `orientationchange`, `visualViewport` resize/scroll, and at 50/250/600/1200 ms | `src/main.ts:47-54` | inside a Capacitor webview the size settles *after* game creation without firing `resize`; a stale canvas rect puts every touch a few points off target |
| `position: fixed; inset 0` on `html, body, #app` | `index.html` (the `#app` block) | a rubber-banding iOS webview shifts the canvas bounding rect Phaser caches for input, so touches land offset from the visuals |

Consequence for reading the code: `pointer.x` / `pointer.y` inside a scene
(`src/scenes/GameScene.ts:205`, `:285`) are **already base canvas pixels**. Never
multiply them by anything.

`src/main.ts:32` sets `roundPixels: false`, so nothing snaps to integers —
positions stay float end to end.

---

## 2. `Playfield` — the single conversion point

`src/core/Playfield.ts:1-8` states the contract: levels are normalized, everything
downstream is playfield pixels, "so this conversion happens exactly once, when a
level loads."

### 2.1 Full API, verbatim

```ts
export interface Inset {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
```
(`src/core/Playfield.ts:12-17`)

```ts
export class Playfield {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;

  constructor(canvasW: number, canvasH: number, inset: Inset)

  get right(): number
  get bottom(): number
  get axisX(): number

  toScreen(p: Vec2): Vec2
  toNormalized(p: Vec2): Vec2
  toScreenRect(r: Rect): Rect
  mirror(p: Vec2): Vec2
  clampToDrawable(p: Vec2): Vec2
}
```

| member | line | body (verbatim) | notes |
| --- | --- | --- | --- |
| `x, y, w, h` | `:20-23`, set `:26-29` | `x = inset.left`, `y = inset.top`, `w = canvasW - inset.left - inset.right`, `h = canvasH - inset.top - inset.bottom` | immutable after construction |
| `right` | `:32-34` | `this.x + this.w` | |
| `bottom` | `:36-38` | `this.y + this.h` | |
| `axisX` | `:40-43` | `this.x + this.w * 0.5` | the mirror axis in pixels — normalized `x = 0.5` |
| `toScreen` | `:45-48` | `{ x: this.x + p.x * this.w, y: this.y + p.y * this.h }` | no clamping, no rounding |
| `toNormalized` | `:50-59` | `{ x: (p.x - this.x) / this.w, y: (p.y - this.y) / this.h }` | exact inverse of `toScreen` |
| `toScreenRect` | `:61-69` | `x`/`y` as `toScreen`; `w: r.w * this.w`, `h: r.h * this.h` | **`h` scales by `this.h`, not `this.w`** |
| `mirror` | `:71-74` | `mirrorPoint(p, this.axisX)` → `{ x: 2*axisX - p.x, y: p.y }` (`Geometry.ts:74-76`) | takes **pixels**, returns pixels |
| `clampToDrawable` | `:76-86` | `{ x: clamp(p.x, this.x, this.axisX), y: clamp(p.y, this.y, this.bottom) }` | returns a new object; does not mutate |

`clamp` is `src/core/Geometry.ts:42-44`: `v < lo ? lo : v > hi ? hi : v`.

### 2.2 Traps in this class

- **`toScreenRect` height must scale by `this.h`.** The copy-paste that scales `h`
  by `this.w` would silently change every wall's thickness and retune all 100
  levels. `Playfield.test.ts:39-49` exists solely to catch that, with a comment
  saying so.
- **`clampToDrawable` clamps `x` to `[this.x, this.axisX]` — it does NOT clamp to
  `this.right`.** The right half is unreachable by construction, not by
  filtering. This is the soft wall.
- **The clamp permits `x === axisX` exactly** (`Playfield.test.ts:98-100`,
  "lets a point rest exactly ON the axis"). So a *stroke* point can land at
  normalized `x = 0.5`, even though *authored* `start`/`goal` are strictly
  `< 0.5`. `Progress.ts:30` says saved figure points are `x < 0.5`; the true
  bound is `x <= 0.5`.
- **`mirror` takes pixels, `types.ts`'s `mirror(p) = {1-x, y}` takes normalized.**
  They agree — `Playfield.test.ts:52-66` proves it by round-tripping through
  `toScreen` for four sample points — but mixing the two by feeding a normalized
  point to `Playfield.mirror` produces silent garbage near the origin.
- **`Playfield` never sees the banner.** The banner is reserved through
  `METRICS.inset.bottom`, which the constructor consumes like any other inset.

### 2.3 Construction sites (all identical except the test)

| site | arguments |
| --- | --- |
| `src/scenes/GameScene.ts:118` | `new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)` |
| `src/scenes/GalleryScene.ts:44` | same |
| `src/render/ShareCard.ts:146` | same — "the reference playfield so the shape matches the game exactly" |
| `src/data/levels.test.ts:17` | same |
| `src/data/quality.test.ts:15` | same |
| `scripts/genLevels.ts:50` | same |
| `src/core/Playfield.test.ts:5-13` | deliberately **asymmetric** inset `{ top: 80, right: 20, bottom: 40, left: 10 }` "so any axis or origin mistake shows up as a wrong number rather than cancelling itself out" |

Because the shipped inset has `left === right`, `axisX` in the real game equals
`BASE_WIDTH / 2` exactly. **That is a coincidence of the inset, not a definition.**
Make the horizontal insets unequal and the axis moves off canvas centre — which
is correct behaviour (the axis follows the *playfield*), but anything that
hardcodes `375` or `BASE_WIDTH / 2` instead of `pf.axisX` will break. Nothing in
`src/` uses either **as the axis** today: every `BASE_WIDTH / 2` in the tree
(`MenuScene.ts:39`, `LevelSelectScene.ts:44`, `GalleryScene.ts:46`,
`GameScene.ts:463`, `:520`, `:572`, `:583`, `:592`) is HUD centring on the
canvas, which is what it should be.

---

## 3. Worked numeric example

Inputs, all verified: `METRICS.inset` = `{ top: pt(44), right: pt(12), bottom:
pt(72), left: pt(12) }` (`Theme.ts:206-211`), `PT = 2`, base canvas 750×1334.

```text
inset in base px   top = 88   right = 24   bottom = 144   left = 24

pf.x      = 24
pf.y      = 88
pf.w      = 750 - 24 - 24   = 702
pf.h      = 1334 - 88 - 144 = 1102
pf.right  = 24 + 702        = 726
pf.bottom = 88 + 1102       = 1190
pf.axisX  = 24 + 702 * 0.5  = 375
```

Level `l1`'s second wall, pinned verbatim at `src/data/levels.test.ts:47`:
`{ x: 0.5, y: 0.64, w: 0.28, h: 0.06 }`.

```text
toScreenRect({x:0.5, y:0.64, w:0.28, h:0.06}):
  x = 24 + 0.5  * 702  = 375
  y = 88 + 0.64 * 1102 = 88 + 705.28 = 793.28
  w =       0.28 * 702 = 196.56          (float: 196.56000000000003)
  h =       0.06 * 1102 = 66.12
  → occupies base px x ∈ [375, 571.56], y ∈ [793.28, 859.40]
```

Its reflection — the band the player's own stroke must avoid on the left, built
at `src/scenes/GameScene.ts:156-159` as `{ x: 2*axis - (w.x + w.w), y, w, h }`
(then filtered to the bands that actually overlap the drawable half):

```text
  x = 2 * 375 - (375 + 196.56) = 750 - 571.56 = 178.44
  → forbidden band, base px x ∈ [178.44, 375], y ∈ [793.28, 859.40]
  → normalized                x ∈ [0.22, 0.5]      (= 1 - 0.78, 1 - 0.5)
```

The same wall on a 390pt-wide phone (scale 0.52): the band spans
`178.44 * 0.52 = 92.7888` to `375 * 0.52 = 195` CSS px.

`l1`'s start `{x: 0.14, y: 0.88}` → `toScreen` → `x = 24 + 98.28 = 122.28`,
`y = 88 + 969.76 = 1057.76`. (Floating point: JS yields `122.28000000000002`.
Nothing rounds; `roundPixels: false` at `main.ts:32`.)

---

## 4. `METRICS`, verbatim

`src/render/Theme.ts:113-212`. Reproduced with comments stripped; the `as const`
is load-bearing (every value is a literal type).

```ts
export const METRICS = {
  hitRadius: pt(2.6),
  sampleMinDist: pt(2.6),
  touchOffsetY: pt(42),
  touchOffsetRampPx: pt(21),
  renderMaxSpacing: pt(5),
  startRadius: pt(10),
  startGrabFactor: 2.4,
  goalRadius: pt(15),
  goalRingWidth: pt(2),
  wallCornerRadius: pt(3),
  axisWidth: pt(1),
  axisDash: pt(7),
  axisGap: pt(6),
  smoothIterations: 2,
  failFlashMs: 400,
  winHoldMs: 180,
  winSettleMs: 350,
  winSettleFrom: 0.97,
  bannerReserve: pt(58),
  inset: {
    top: pt(44),
    right: pt(12),
    bottom: pt(72),
    left: pt(12),
  },
} as const;
```

| key | line | value (base px / raw) | controls | why this number |
| --- | --- | --- | --- | --- |
| `hitRadius` | `:125` | `pt(2.6)` = **5.2** | collision radius passed to `CollisionSystem` (`GameScene.ts:151`) and to every level validator | LOCKED. Measured from the stroke **centreline**; see §6 |
| `sampleMinDist` | `:128` | `pt(2.6)` = **5.2** | minimum travel before `StrokeRecorder` keeps a new raw sample (`GameScene.ts:119`) | equal to `hitRadius`, so a rejected sample always sits within one hit radius of a tested one — that is what makes dropping it safe (`Theme.test.ts:93-98`) |
| `touchOffsetY` | `:134` | `pt(42)` = **84** | how far ABOVE the finger the drawing cursor sits on touch (`GameScene.ts:292`) | the thumb must never cover the live end of the stroke on a 375pt-wide screen |
| `touchOffsetRampPx` | `:144` | `pt(21)` = **42** | finger **travel** (not time) over which that offset eases in (`GameScene.ts:293`) | a time-based ramp slides the cursor while the finger is still and draws — and collision-tests — ink nobody asked for. During the ramp the cursor moves at twice finger speed |
| `renderMaxSpacing` | `:156` | `pt(5)` = **10** | longest gap fed to the renderer's smoothing pass (`InkRenderer.ts:36`, `ShareCard.ts:151`) | Chaikin cuts corners in proportion to spacing; flick samples land 80–300px apart, so the smoothed line would visibly bow through a corner the RAW path legally cleared. Splitting first is geometrically free (inserted points lie exactly on the raw path) |
| `startRadius` | `:159` | `pt(10)` = **20** | visual radius of the start dot (`InkRenderer.ts:156`) | |
| `startGrabFactor` | `:162` | **2.4** (unitless) | multiplier on `startRadius` for how close a pointerdown must land to begin a stroke (`GameScene.ts:206`) | grab radius = `pt(24)` = 48 base px, pinned at `Theme.test.ts:123` |
| `goalRadius` | `:165` | `pt(15)` = **30** | visual radius of the goal ring **and the win threshold** (`GameScene.ts:243`, `InkRenderer.ts:162`) | one number for both, so what you see is what you must reach |
| `goalRingWidth` | `:167` | `pt(2)` = **4** | goal ring line width (`InkRenderer.ts:161`) | |
| `wallCornerRadius` | `:169` | `pt(3)` = **6** | wall corner rounding, clamped by `min(r, w.w/2, w.h/2)` (`InkRenderer.ts:131`, `:238`) | **visual only** — collision uses the un-rounded AABB |
| `axisWidth` | `:171` | `pt(1)` = **2** | dashed centre axis line width (`InkRenderer.ts:148`) | |
| `axisDash` | `:172` | `pt(7)` = **14** | dash length (`InkRenderer.ts:146`, `:150`) | |
| `axisGap` | `:173` | `pt(6)` = **12** | gap length; step = dash + gap = 26 (`InkRenderer.ts:146`) | |
| `smoothIterations` | `:176` | **2** | Chaikin passes applied to the RENDERED stroke only, never to collision (`InkRenderer.ts:36`, `ShareCard.ts:152`) | the render/collision split is deliberate and LOCKED (`StrokeRecorder.test.ts:219`) |
| `failFlashMs` | `:179` | **400** | fail flash duration and the delay before auto-reset (`GameScene.ts:312`, `InkRenderer.ts:216`) | failure must be recoverable in well under a second — no modal, no tap |
| `winHoldMs` | `:182` | **180** | delay before the win figure settles (`InkRenderer.ts:289`) | |
| `winSettleMs` | `:183` | **350** | settle tween duration (`InkRenderer.ts:290`) | |
| `winSettleFrom` | `:184` | **0.97** | scale the win figure starts at (`InkRenderer.ts:283`) | |
| `bannerReserve` | `:195` | `pt(58)` = **116** | bottom band of the canvas menu chrome must not use (`LevelSelectScene.ts:75`, `GalleryScene.ts:92`, `GameScene.ts:463`, `:519`, `:592`) | the AdMob banner is a NATIVE view pinned to the bottom of the **screen**, not a game object; on a 9:16 phone there is no letterbox and it covers real canvas |
| `inset.top` | `:207` | `pt(44)` = **88** | playfield top margin | |
| `inset.right` | `:208` | `pt(12)` = **24** | playfield right margin | equal to `left`, which is what puts `axisX` at 375 |
| `inset.bottom` | `:209` | `pt(72)` = **144** | playfield bottom margin | must clear `bannerReserve` (144 > 116). "A start dot under an ad is both unplayable and an accidental-click generator, which is the fastest way to lose ad serving" (`Theme.ts:203-204`) |
| `inset.left` | `:210` | `pt(12)` = **24** | playfield left margin | |

Derived constants worth memorising: playfield = `24, 88, 702 × 1102`;
`axisX = 375`; drawable half width = `375 - 24 = 351` base px.

---

## 5. `InkTheme` and `THEMES`

```ts
export interface InkTheme {
  readonly id: string;
  readonly name: string;
  /** Page colour. Also the Phaser background, so letterboxing disappears. */
  readonly paper: number;
  /** The player's stroke, at full opacity. */
  readonly ink: number;
  /** Obstacles. Quiet — no outline, no texture. The ink is the loud thing. */
  readonly wall: number;
  /** Start dot and goal ring. */
  readonly accent: number;
  /** Collision flash. */
  readonly fail: number;
  /** The mirrored stroke: same ink, seen through glass. */
  readonly mirrorAlpha: number;
  /** Fill of the closed win figure. */
  readonly winFillAlpha: number;
  /** The dashed centre axis. */
  readonly axisAlpha: number;
  /** Mirrored start/goal markers — reflections, not targets. */
  readonly reflectionAlpha: number;
  /** Nib width, in points. A cosmetic may change this; hit radius never moves. */
  readonly strokePt: number;
}
```
(`src/render/Theme.ts:46-69`)

The one shipped theme, verbatim (`src/render/Theme.ts:71-84`):

```ts
const PAPER: InkTheme = {
  id: 'paper',
  name: 'Paper',
  paper: 0xe9ebe4,
  ink: 0x16323c,
  wall: 0x9a9c90,
  accent: 0x8e3b62,
  fail: 0xb4463c,
  mirrorAlpha: 0.45,
  winFillAlpha: 0.11,
  axisAlpha: 0.16,
  reflectionAlpha: 0.3,
  strokePt: 5,
};
```

Registry and accessors (`src/render/Theme.ts:88-109`):

```ts
export const THEMES: Readonly<Record<string, InkTheme | undefined>> = {
  paper: PAPER,
};

let active: InkTheme = PAPER;

export function theme(): InkTheme
export function setTheme(id: string): void
export function rgba(color: number, alpha: number): string
```

- `THEMES`'s value type includes `undefined` deliberately (`Theme.ts:86-87`): an
  unknown id is a **miss**, not a phantom theme.
- `setTheme` is a no-op on an unknown id (`Theme.ts:99-100`, `if (next) active = next`),
  pinned by `Theme.test.ts:58-62` — "ignores an unknown theme id rather than
  blanking the game."
- `rgba(0x16323c, 0.11)` → `'rgba(22,50,60,0.11)'`, pinned exactly at
  `Theme.test.ts:53-56`.
- Adding a purchasable ink pack must be "a JSON object dropped into `THEMES`,
  never a code change" (`Theme.ts:6-8`).
- `strokePt` is in **points**; consumers multiply by `pt()`
  (`InkRenderer.ts:41`: `baseWidth: pt(theme().strokePt)`; `ShareCard.ts:173`:
  `pt(t.strokePt) * scale * (opts.nibScale ?? 1)`).

`0xe9ebe4` is duplicated as a literal in `index.html` (`background: #e9ebe4` and
`<meta name="theme-color" content="#E9EBE4">`) because HTML cannot import TS.
That copy is intentional and must be kept in sync if `paper` ever changes.

---

## 6. Why `hitRadius` lives in `METRICS` and not `InkTheme`

The rationale is stated as a structural guarantee, not a promise
(`src/render/Theme.ts:4-12`):

> `InkTheme`  Everything a cosmetic is allowed to change: paper, ink colour, nib
> width, opacities. […]
> `Metrics`  Everything that decides whether a stroke lives or dies. Nothing in
> CollisionSystem reads InkTheme, so no skin can change what kills you — that is
> the anti-pay-to-win guarantee, and it is structural rather than a promise.

Verified: `src/core/CollisionSystem.ts` imports only from `./Geometry`
(`:16-22`) and receives `hitRadius` as a constructor parameter
(`CollisionSystem.ts:30-34`). It has no reference to `Theme` at all.
`src/core/Ribbon.ts:10-12` repeats the guarantee from the render side: "this is
rendering only. Collision runs on the raw samples at a fixed hit radius (LOCKED),
so how thick the ink happens to look never changes what kills you."

Pinned by `Theme.test.ts:84-89`:

```ts
    expect(Object.keys(theme())).not.toContain('hitRadius');
    expect(METRICS.hitRadius).toBeGreaterThan(0);
```

with the comment "hitRadius must never migrate into InkTheme: a purchasable skin
that moved the kill boundary would be pay-to-win."

Secondary consequence, stated at `Theme.ts:14-17`: because collision is measured
from the **centreline**, a fatter cosmetic nib does not survive anything a thin
one would not — it just renders ink over a wall it legally cleared. Identical
mechanics, worse readability. "Keep cosmetic nibs near 5pt."

---

## 7. The open question: `hitRadius` vs the nib

The spec's LOCKED rule 3 says the collision radius should be **smaller than the
rendered width** ("2.6px hit vs 5px visual") so the line "forgives slightly".
Both numbers ship exactly as written. They do not produce that outcome.

```text
hitRadius        = pt(2.6) = 5.2 base px   (from the CENTRELINE)
half nib         = pt(5)/2 = 5.0 base px   (from the same centreline)
kill boundary    = 5.2 - 5.0 = 0.2 base px OUTSIDE the visible ink  (= 0.1pt)
```

So contact is reported **0.1pt before** the visible ink touches the wall — a
shade *stricter* than pixel-perfect, where the prose asks for forgiving.

- Documented in code at `src/render/Theme.ts:114-124`.
- Documented in the README at `README.md:257-269`.
- Pinned, deliberately, by `src/render/Theme.test.ts:79-82`:
  ```ts
    const halfNib = pt(theme().strokePt) / 2;
    expect(METRICS.hitRadius - halfNib).toBeCloseTo(0.2, 12);
  ```
  The test comment (`Theme.test.ts:72-78`) says it documents the consequence
  rather than asserting an intent: "Change hitRadius and this number moves; it is
  here so the change is loud."
- The suggested fix, if the author wants the prose behaviour, is
  `METRICS.hitRadius: pt(2.0)` "or thereabouts" (`Theme.ts:122`,
  `README.md:266-267`). **It is a LOCKED value — do not change it without the
  author.**

Note the weaker sibling assertion at `Theme.test.ts:69`,
`expect(METRICS.hitRadius).toBeLessThan(pt(theme().strokePt))` — that compares
5.2 against the **full** nib width 10, not the half-width, which is exactly why
it passes while the geometry is still strict. Do not read it as proof of
forgiveness.

Changing `hitRadius` also re-runs three build gates: solvability
(`levels.test.ts:112-123`), playability at `hitRadius + PLAYABLE_CLEARANCE`
(`levels.test.ts:139-153`), and "no wall is decoration" (`quality.test.ts:18-48`).
`levels.test.ts:109` says it outright: "Change the hit radius or the playfield
inset and this is what tells you a level just became impossible."

---

## 8. Every `LOCKED` marker in the repo

Grepped across `*.ts`, `*.md`, `*.json`, `*.html` (excluding `node_modules`).

| location | quoted text (trimmed) |
| --- | --- |
| `src/data/types.ts:4` | `COORDINATE SYSTEM — LOCKED.` |
| `src/data/types.ts:30` | `/** Normalized, full-playfield coords. Asymmetric by design — LOCKED. */` |
| `src/core/Playfield.ts:5` | `axis at x = 0.5 (see data/types.ts, LOCKED). Everything downstream —` |
| `src/core/Playfield.ts:79` | `stroke can slide along but not pass (LOCKED).` |
| `src/core/CollisionSystem.ts:10` | `Testing is CONTINUOUS along the segment (LOCKED). Pointer samples arrive one` |
| `src/core/Ribbon.ts:11` | `fixed hit radius (LOCKED), so how thick the ink happens to look never changes` |
| `src/render/Theme.ts:115` | `LOCKED. Collision radius 2.6pt against a 5pt rendered nib.` |
| `src/render/Theme.ts:123` | `LOCKED value and so is the author's call, not this file's.` |
| `src/data/levels.ts:18` | `The five hand-authored levels. These numbers are tuned and LOCKED — the` |
| `src/scenes/GameScene.ts:238` | `walls — LOCKED. Pointer samples arrive about once per frame, so during a` |
| `src/core/Geometry.test.ts:264` | `LOCKED rule 2. A flick across the screen delivers pointer samples hundreds` |
| `src/core/Playfield.test.ts:53` | `it('agrees with the LOCKED normalized definition mirror(p) = {1-x, y}', ...)` |
| `src/core/Playfield.test.ts:84` | `LOCKED: the player may only draw where x < 0.5. The axis is a SOFT wall — the` |
| `src/core/StrokeRecorder.test.ts:219` | `The renderer smooths; collision does not. That split is deliberate and LOCKED` |
| `src/render/Theme.test.ts:16` | `and the LOCKED values announce themselves if anyone edits them.` |
| `src/render/Theme.test.ts:65` | `describe('LOCKED rule 3 — hit radius against the rendered nib', ...)` |
| `src/data/levels.test.ts:39` | `// LOCKED. The generator appends; it must never rewrite these.` |
| `src/data/levels.test.ts:57` | `// LOCKED: the player may only draw where x < 0.5.` |
| `src/data/levels.test.ts:82` | `LOCKED rule 1: obstacles must be asymmetric. If the right half mirrored the` |
| `README.md:168` | `data/types.ts           Level shape + the LOCKED coordinate system` |
| `README.md:259` | `LOCKED rule 3 says the collision radius should be smaller than the rendered` |
| `README.md:267` | `thereabouts. That is a change to a LOCKED value, so it is the author's call, not` |

The three numbered LOCKED rules, as named by the tests and README (`README.md:200-211`):

| rule | statement | enforced by |
| --- | --- | --- |
| 1 | obstacles are asymmetric about `x = 0.5` | `levels.test.ts:86-95` (per level, over all 100) |
| 2 | collision is continuous along each segment, never a point test | `Geometry.test.ts:264…`, `CollisionSystem.ts:10` |
| 3 | hit radius is smaller than the nib | `Theme.test.ts:65-90` — see §7 for the caveat |

---

## 9. Test pin table

| constant / behaviour | exact assertion | test | line |
| --- | --- | --- | --- |
| `BASE_WIDTH === 750` | `toBe(750)` | Theme.test.ts | `:21` |
| `BASE_HEIGHT === 1334` | `toBe(1334)` | Theme.test.ts | `:22` |
| aspect < 9:16 | `BASE_WIDTH / BASE_HEIGHT` `toBeLessThan(0.5626)` | Theme.test.ts | `:25` |
| `PT === 2`, `pt(5) === 10`, `pt(2.6) ≈ 5.2`, `pt(0) === 0` | 4 asserts | Theme.test.ts | `:29-32` |
| palette hexes `paper/ink/wall/accent/fail` | `toBe(0xe9ebe4 / 0x16323c / 0x9a9c90 / 0x8e3b62 / 0xb4463c)` | Theme.test.ts | `:39-43` |
| `mirrorAlpha 0.45`, `winFillAlpha 0.11`, `axisAlpha 0.16` | `toBe` | Theme.test.ts | `:48-50` |
| `rgba()` output strings | `'rgba(22,50,60,0.11)'`, `'rgba(22,50,60,0.16)'` | Theme.test.ts | `:54-55` |
| unknown theme id is a no-op | id unchanged after `setTheme('no-such-ink-pack')` | Theme.test.ts | `:58-62` |
| `hitRadius === pt(2.6)`, `strokePt === 5`, `hitRadius < pt(strokePt)` | 3 asserts | Theme.test.ts | `:67-69` |
| kill boundary is `+0.2` base px outside the ink | `toBeCloseTo(0.2, 12)` | Theme.test.ts | `:81` |
| `hitRadius` is not a key of `InkTheme` | `not.toContain('hitRadius')` | Theme.test.ts | `:87` |
| `sampleMinDist === pt(2.6)` and `<= hitRadius` | 2 asserts | Theme.test.ts | `:94, :97` |
| `touchOffsetY === pt(42)` | `toBe` | Theme.test.ts | `:101` |
| `touchOffsetRampPx === pt(21)`, `> 0`, `<= touchOffsetY` | 3 asserts | Theme.test.ts | `:107-111` |
| `renderMaxSpacing === pt(5)` and `<= pt(strokePt)` | 2 asserts | Theme.test.ts | `:115, :118` |
| `startGrabFactor === 2.4`; `startRadius * factor === pt(24)` | 2 asserts | Theme.test.ts | `:122-123` |
| `failFlashMs === 400` and `< 1000` | 2 asserts | Theme.test.ts | `:127-128` |
| `winSettleFrom === 0.97`, `winSettleMs === 350`, `winHoldMs > 0` | 3 asserts | Theme.test.ts | `:132-134` |
| `smoothIterations > 0` | `toBeGreaterThan(0)` | Theme.test.ts | `:138` |
| playfield inset arithmetic (`x,y,w,h,right,bottom`) | exact numbers for the 80/20/40/10 test inset | Playfield.test.ts | `:16-24` |
| `axisX` is normalized `x = 0.5` | `toBe(370)`; `toScreen(0.5,·).x === axisX` | Playfield.test.ts | `:28-29` |
| unit square maps to playfield corners | 3 `toEqual` | Playfield.test.ts | `:32-37` |
| `toScreenRect` scales `h` by `pf.h` | `toEqual({x:10,y:687,w:360,h:607})` | Playfield.test.ts | `:43-48` |
| pixel mirror == normalized `1-x` | 4 sample points, 9 digits | Playfield.test.ts | `:52-66` |
| mirror is an involution and fixes the axis | `mirror(mirror(p)) === p` | Playfield.test.ts | `:68-75` |
| clamp never crosses the axis (incl. `axisX + 0.001`, `1e9`) | 3 asserts | Playfield.test.ts | `:92-96` |
| a point may rest exactly ON the axis | `toBe(pf.axisX)` | Playfield.test.ts | `:98-100` |
| clamped point is always at or left of its own reflection | 5000 seeded-LCG samples (seed `20260725`) | Playfield.test.ts | `:111-127` |
| `clampToDrawable` does not mutate its argument | `toEqual({x:9999,y:9999})` | Playfield.test.ts | `:129-133` |
| `METRICS.inset` / `bannerReserve` | **not pinned directly** — pinned indirectly by every level's solvability and playability run against `new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)` | levels.test.ts, quality.test.ts | `:17`, `:15` |

---

## 10. Other places that map normalized → pixels (bypassing or re-framing `Playfield`)

`Playfield` claims to be the only converter. One render path does its own affine
mapping instead and two apply a second fit on top of `Playfield`, all for good
reasons; know they exist before you "fix" them.

| site | what it does | why not `Playfield` |
| --- | --- | --- |
| `src/scenes/LevelSelectScene.ts:270-307` (`buildPreview`) | maps `wall.x * w`, `wall.y * h`, `level.start.x * w`, and the reflections `(1 - start.x) * w` into a card-sized rect | a thumbnail has its own aspect; there is no playfield inset inside a card. `:284` draws the axis at `x + w/2 - pt(0.5)`, i.e. normalized 0.5, so the mirror reads correctly |
| `src/render/ShareCard.ts:146-172` | rebuilds through the **reference** `Playfield`, then applies a second uniform fit (`scale`, `offX`, `offY`) into the 1080 square | the figure must match the game's shape exactly first (`ShareCard.ts:143-145`), then be framed. `CARD_SIZE = 1080` (`ShareCard.ts:28`); scale is uniform on purpose — "stretching it to fill the square would make every player's figure the same shape" (`:166-167`) |
| `src/scenes/GalleryScene.ts:209-215` | `pf.toScreen` per point, then `paintFigureInto` re-frames into a card rect | same two-stage pattern as ShareCard |

---

## 11. Change checklist

Before touching anything in this document's scope:

1. **`METRICS.hitRadius`** — LOCKED. Author's call only. Re-runs 100 solvability,
   100 playability, and 100 "no inert wall" checks.
2. **`METRICS.inset`** — changes `pf.w/h/axisX`, therefore every wall's pixel
   position, therefore every BFS route. `levels.test.ts` and `quality.test.ts`
   will fail loudly if a level becomes unsolvable or unplayable.
3. **`inset.left !== inset.right`** — legal, but moves `axisX` off canvas centre.
   Verify no new code assumes `BASE_WIDTH / 2`.
4. **`inset.bottom < bannerReserve`** — puts playable content under a native ad
   view. Nothing in the test suite catches this today. Currently `144 > 116`.
5. **`BASE_WIDTH` / `BASE_HEIGHT`** — pinned by `Theme.test.ts:21-25`; the aspect
   assertion also encodes the letterbox-not-pillarbox decision.
6. **`InkTheme.strokePt`** — purely cosmetic, but `Theme.test.ts:118`
   (`renderMaxSpacing <= pt(strokePt)`) fails if the active theme drops below
   5pt, and `Theme.test.ts:81` fails if it moves at all while `hitRadius` stays.
7. **Adding a theme** — append to `THEMES` (`Theme.ts:88-90`). Never add a
   gameplay-affecting field to `InkTheme`; `Theme.test.ts:87` is the guard.

---

## See also

- [00-index.md](00-index.md) — documentation map
- [01-architecture.md](01-architecture.md) — module graph and data flow
- [03-geometry-collision.md](03-geometry-collision.md) — `segRect`, `segRectEntryT`, `CollisionSystem`, LOCKED rule 2
- [04-stroke-ribbon.md](04-stroke-ribbon.md) — sampling, Chaikin, `renderMaxSpacing`, ribbon widths
- [05-rendering.md](05-rendering.md) — `InkRenderer`, share card, level-card atlas
- [06-scenes.md](06-scenes.md) — `GameScene` input state machine and the cursor pipeline
- [07-levels-data.md](07-levels-data.md) — `Level` authoring and the hand-tuned five
- [08-level-generation.md](08-level-generation.md) — `scripts/genLevels.ts`, `LevelValidator`, `PLAYABLE_CLEARANCE`
- [10-monetization.md](10-monetization.md) — banner placement and `bannerReserve`
- [12-testing.md](12-testing.md) — full suite layout
- [13-api-reference.md](13-api-reference.md) — every exported signature
- [14-glossary.md](14-glossary.md) — pt, nib, band, fold, gate
- [15-change-recipes.md](15-change-recipes.md) — step-by-step edits
- [../README.md](../README.md) — narrative rationale; §"The three invariants" (`:200-211`) and §"One open question for the author" (`:257-269`)
