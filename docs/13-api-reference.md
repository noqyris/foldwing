# API Reference — Every Exported Symbol

## What this covers

Every symbol exported from `src/` and `scripts/`: 120 in total, across 27 modules.
Organised by module path, alphabetical (case-insensitive) within each module.
Signatures, interface bodies and const values are copied verbatim from source.
`scripts/genLevels.ts` exports nothing — its apparent `export` is inside a template literal.
For *why* a symbol behaves as it does, follow the cross-references to the sibling docs.

## Source files

| path | lines | one-line role |
|---|---|---|
| `src/config/monetization.ts` | 182 | Ad unit ids, cadence policy, product id — the only money config |
| `src/core/CollisionSystem.ts` | 80 | Stroke + mirror tested against every wall, continuously |
| `src/core/DrawCursor.ts` | 40 | Finger position → ink position (touch thumb-lift offset) |
| `src/core/Geometry.ts` | 326 | Pure 2D math: vectors, rects, segment/rect/circle predicates |
| `src/core/LevelValidator.ts` | 337 | BFS solvability proof + clearance/interlock/difficulty metrics |
| `src/core/Playfield.ts` | 87 | The single normalized↔pixel conversion, and the axis clamp |
| `src/core/Ribbon.ts` | 185 | Speed-varying nib width → quads + discs (render only) |
| `src/core/StrokeRecorder.ts` | 238 | Raw sample capture; densify/Chaikin smoothing; closed figure |
| `src/data/generatedLevels.ts` | 1751 | Generated output: 95 `Level` literals, ids `l6`..`l100` |
| `src/data/levels.ts` | 95 | 5 hand-authored levels + generated set + wrapping accessor |
| `src/data/types.ts` | 34 | `Level` shape and the LOCKED coordinate-system contract |
| `src/main.ts` | 67 | Phaser `Game` construction + viewport refresh; **no exports** |
| `src/render/HitArea.ts` | 67 | Phaser hit-rect maths, Phaser-free so it can be unit tested |
| `src/render/InkRenderer.ts` | 432 | All in-game painting: level, stroke, fail, reveal, win figure |
| `src/render/ScrollView.ts` | 272 | Scene-level drag/tap discrimination + culling for grids |
| `src/render/ShareCard.ts` | 204 | 1080×1080 PNG export on a raw 2D canvas |
| `src/render/Theme.ts` | 212 | Base canvas, `pt()`, cosmetic `InkTheme`, gameplay `METRICS` |
| `src/render/UI.ts` | 372 | Phaser-primitive UI kit: type scale, button, wordmark, enter |
| `src/scenes/BootScene.ts` | 55 | Load save, start Menu, warm ad/store SDKs in background |
| `src/scenes/GalleryScene.ts` | 249 | Baked grid of every saved figure; tap to share |
| `src/scenes/GameScene.ts` | 707 | The core loop: idle → drawing → failed/won |
| `src/scenes/LevelSelectScene.ts` | 308 | Baked 3-column grid of 100 level preview cards |
| `src/scenes/MenuScene.ts` | 216 | Home page: wordmark, Play/Levels/Gallery, IAP rows |
| `src/systems/Ads.ts` | 302 | AdMob singleton; all cadence policy lives behind its gates |
| `src/systems/Audio.ts` | 173 | Web Audio synthesis: rising pentatonic notes, thud, chime |
| `src/systems/Haptics.ts` | 47 | Capacitor Haptics wrapper; no-op on web |
| `src/systems/Iap.ts` | 206 | `cordova-plugin-purchase` Remove-Ads non-consumable |
| `src/systems/Progress.ts` | 304 | Capacitor Preferences save: unlocks, reveals, figures |
| `src/systems/Rate.ts` | 38 | One-shot native review prompt |
| `src/systems/Share.ts` | 104 | Native share sheet / Web Share / download fallback |
| `scripts/genLevels.ts` | 467 | Side-effect script that writes `src/data/generatedLevels.ts` |

## Conventions used below

- **kind** is one of `function`, `class`, `const`, `interface`, `type`, `singleton` (an exported instance of a non-exported class).
- Signatures are verbatim, including parameter names, default values and return types. Multi-line declarations are reflowed onto one line **only** where no token changes.
- Computed constants (`pt(...)`) show both the source expression and the evaluated number; the evaluated number is marked "= N".
- "Pinned by" names the test file whose assertion fails if the value changes.

---

## `src/config/monetization.ts`

| symbol | kind | file:line |
|---|---|---|
| `admobUnits` | function | `src/config/monetization.ts:173` |
| `adsConfigured` | const (arrow fn) | `src/config/monetization.ts:182` |
| `AdUnits` | interface | `src/config/monetization.ts:38` |
| `monetization` | const (`as const`) | `src/config/monetization.ts:90` |

### `admobUnits` — `src/config/monetization.ts:173`

```ts
export function admobUnits(): AdUnits {
  if (monetization.useTestAds) return isAndroid() ? TEST_ANDROID : TEST_IOS;
  return isAndroid() ? LIVE_ANDROID : LIVE_IOS;
}
```

Resolved at call time, not module load, so tests can vary the platform. `isAndroid()` is the non-exported `(): boolean => Capacitor.getPlatform() === 'android'` (`:170`).

Non-exported unit sets it selects between:

| const | line | appId | banner | interstitial | rewarded |
|---|---|---|---|---|---|
| `TEST_IOS` | `:51` | `ca-app-pub-3940256099942544~1458002511` | `ca-app-pub-3940256099942544/2934735716` | `ca-app-pub-3940256099942544/4411468910` | `ca-app-pub-3940256099942544/1712485313` |
| `TEST_ANDROID` | `:58` | `ca-app-pub-3940256099942544~3347511713` | `ca-app-pub-3940256099942544/6300978111` | `ca-app-pub-3940256099942544/1033173712` | `ca-app-pub-3940256099942544/5224354917` |
| `LIVE_IOS` | `:76` | `ca-app-pub-3307486877162157~5033197766` | `ca-app-pub-3307486877162157/6426316277` | `ca-app-pub-3307486877162157/4373767928` | `ca-app-pub-3307486877162157/5113234608` |
| `LIVE_ANDROID` | `:83` | `''` | `''` | `''` | `''` |

`LIVE_IOS.appId` is duplicated in `ios/App/App/Info.plist` as `GADApplicationIdentifier`; `monetization.test.ts:45` fails the build if the two disagree or if the plist value does not match `useTestAds`.

### `adsConfigured` — `src/config/monetization.ts:182`

```ts
export const adsConfigured = (): boolean => admobUnits().interstitial.length > 0;
```

False on Android today (`LIVE_ANDROID` is all-empty), which makes every ad path no-op cleanly instead of firing requests that can only fail. Pinned true for the active platform by `monetization.test.ts:34`.

### `AdUnits` — `src/config/monetization.ts:38`

```ts
export interface AdUnits {
  /** ca-app-pub-XXXX~NNNN — the tilde one. Goes in the NATIVE config, not here. */
  readonly appId: string;
  readonly banner: string;
  readonly interstitial: string;
  readonly rewarded: string;
}
```

### `monetization` — `src/config/monetization.ts:90`

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

Bounds pinned by `src/config/monetization.test.ts`:

| field | assertion | line |
|---|---|---|
| `ads.interstitialFromLevel` | `>= 6` | `:70` |
| `ads.interstitialEveryNWins` | `>= 3` | `:74` |
| `ads.minSecondsBetweenInterstitials` | `>= 120` | `:75` |
| `ads.maxInterstitialsPerSession` | `<= 4` | `:76` |
| `ads.sessionWarmupSeconds` | `>= 60` | `:77` |
| `ads.interstitialEveryNAttempts` | `>= 3` **and** `× 3s < minSecondsBetweenInterstitials` | `:91`, `:95` |
| `ads.muteAfterRewardedSeconds` | `>= 180` | `:103` |
| `reveals.offerSkipAfterAttempts` | `>= 5` | `:107` |

The attempt counter is a *permission*, never a trigger on its own — see `Ads.wouldShowOnAttempt` and [10-monetization.md](10-monetization.md).

---

## `src/core/CollisionSystem.ts`

| symbol | kind | file:line |
|---|---|---|
| `CollisionSystem` | class | `src/core/CollisionSystem.ts:24` |

```ts
export class CollisionSystem {
  constructor(
    private readonly walls: readonly Rect[],
    private readonly hitRadius: number,
    private readonly axisX: number
  ) {}

  blocks(a: Vec2, b: Vec2): boolean;               // :37
  firstHitT(a: Vec2, b: Vec2): number | null;      // :55
  private sideBlocked(a: Vec2, b: Vec2): boolean;  // :74
}
```

| member | line | returns |
|---|---|---|
| `constructor` | `:30` | walls are in **playfield pixels, both halves**; `hitRadius` px; `axisX` px |
| `blocks` | `:37` | `true` if the segment **or its mirror** touches any wall |
| `firstHitT` | `:55` | earliest `t ∈ [0,1]` of contact across both sides, else `null` |

Invariants (LOCKED, see file header `:1-14`):

- Both the drawn and the mirrored segment are tested against the **full** wall list. A left-hand segment cannot geometrically reach a right-hand wall, so one code path covers both halves.
- Testing is continuous along the segment, never point-sampled — a flick puts consecutive samples hundreds of pixels apart.
- Reflection preserves a segment's parameterisation, so a `t` from the mirrored side is directly comparable to one from the original. `GameScene.onPointerMove` relies on this to decide whether a wall or the goal came first (`src/scenes/GameScene.ts:249`).
- `blocks(p, p)` on a zero-length segment is the "may the stroke be here" predicate `LevelValidator` uses for cell freedom (`src/core/LevelValidator.ts:70-73`).

`CollisionSystem.test.ts:119` asserts `firstHitT(...) !== null` agrees with `blocks(...)` on every segment.

---

## `src/core/DrawCursor.ts`

| symbol | kind | file:line |
|---|---|---|
| `CursorOptions` | interface | `src/core/DrawCursor.ts:24` |
| `drawCursor` | function | `src/core/DrawCursor.ts:35` |

### `CursorOptions` — `src/core/DrawCursor.ts:24`

```ts
export interface CursorOptions {
  /** True for touch/pen, false for mouse. */
  readonly touch: boolean;
  /** Straight-line distance from where this stroke's finger first landed. */
  readonly travelPx: number;
  /** How far above the finger the cursor settles, in pixels. */
  readonly offsetY: number;
  /** Finger travel over which the offset eases from nothing to full. */
  readonly rampPx: number;
}
```

### `drawCursor` — `src/core/DrawCursor.ts:35`

```ts
export function drawCursor(raw: Vec2, opts: CursorOptions): Vec2 {
  if (!opts.touch) return { x: raw.x, y: raw.y };

  const ramp = opts.rampPx <= 0 ? 1 : clamp(opts.travelPx / opts.rampPx, 0, 1);
  return { x: raw.x, y: raw.y - opts.offsetY * ramp };
}
```

- Never mutates `raw`; always returns a fresh object (`DrawCursor.test.ts:94`).
- `x` is never changed (`DrawCursor.test.ts:40`).
- The ramp is driven by **travel**, never by elapsed time. A time-based ease keeps moving the cursor while the finger is still, which draws — and collision-tests — ink the player never asked for.
- `rampPx <= 0` applies the whole offset immediately (`DrawCursor.test.ts:88`).

---

## `src/core/Geometry.ts`

| symbol | kind | file:line |
|---|---|---|
| `boundsOf` | function | `src/core/Geometry.ts:310` |
| `clamp` | function | `src/core/Geometry.ts:42` |
| `clonePoint` | function | `src/core/Geometry.ts:38` |
| `dist` | function | `src/core/Geometry.ts:52` |
| `distPointToSeg` | function | `src/core/Geometry.ts:299` |
| `distSq` | function | `src/core/Geometry.ts:46` |
| `inflate` | function | `src/core/Geometry.ts:85` |
| `isEmptyRect` | function | `src/core/Geometry.ts:97` |
| `lerpPoint` | function | `src/core/Geometry.ts:57` |
| `mirrorPath` | function | `src/core/Geometry.ts:78` |
| `mirrorPoint` | function | `src/core/Geometry.ts:74` |
| `mirrorX` | function | `src/core/Geometry.ts:64` |
| `pointInRect` | function | `src/core/Geometry.ts:102` |
| `Rect` | interface | `src/core/Geometry.ts:20` |
| `segCircleEntryT` | function | `src/core/Geometry.ts:272` |
| `segRect` | function | `src/core/Geometry.ts:167` |
| `segRectEntryT` | function | `src/core/Geometry.ts:209` |
| `segSeg` | function | `src/core/Geometry.ts:138` |
| `vec2` | function | `src/core/Geometry.ts:34` |
| `Vec2` | interface | `src/core/Geometry.ts:15` |

### Types

```ts
export interface Vec2 {          // :15
  x: number;
  y: number;
}

export interface Rect {          // :20
  x: number;
  y: number;
  w: number;
  h: number;
}
```

Neither is `readonly`; `Level` (in `src/data/types.ts`) re-exports both as types.

### Signatures

```ts
export function vec2(x: number, y: number): Vec2;                                    // :34
export function clonePoint(p: Vec2): Vec2;                                           // :38
export function clamp(v: number, lo: number, hi: number): number;                    // :42
export function distSq(a: Vec2, b: Vec2): number;                                    // :46
export function dist(a: Vec2, b: Vec2): number;                                      // :52
export function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2;                        // :57
export function mirrorX(x: number, axisX: number): number;                           // :64
export function mirrorPoint(p: Vec2, axisX: number): Vec2;                           // :74
export function mirrorPath(points: readonly Vec2[], axisX: number): Vec2[];          // :78
export function inflate(r: Rect, pad: number): Rect;                                 // :85
export function isEmptyRect(r: Rect): boolean;                                       // :97
export function pointInRect(p: Vec2, r: Rect, pad = 0): boolean;                     // :102
export function segSeg(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean;             // :138
export function segRect(a: Vec2, b: Vec2, r: Rect, pad = 0): boolean;                // :167
export function segRectEntryT(
  a: Vec2,
  b: Vec2,
  r: Rect,
  pad = 0
): number | null;                                                                    // :209
export function segCircleEntryT(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  radius: number
): number | null;                                                                    // :272
export function distPointToSeg(p: Vec2, a: Vec2, b: Vec2): number;                   // :299
export function boundsOf(points: readonly Vec2[]): Rect | null;                      // :310
```

### Semantics and traps

| symbol | detail |
|---|---|
| `clamp` | `v < lo ? lo : v > hi ? hi : v` — no validation that `lo <= hi` |
| `lerpPoint` | `t` is **not** clamped; `t > 1` extrapolates past `b` |
| `mirrorX` / `mirrorPoint` | `2 * axisX - x`; involution; `y` unchanged (`Geometry.test.ts:65`, `:75`) |
| `inflate` | `{ x: r.x - pad, y: r.y - pad, w: r.w + pad*2, h: r.h + pad*2 }`; accepts negative pad |
| `isEmptyRect` | `r.w < 0 \|\| r.h < 0`. Guards `segRect`/`segRectEntryT` against an inverted rect that the four-edge test would otherwise report crossings for. Only reachable with a **negative** pad — gameplay never does this, a validator that erodes cells would |
| `pointInRect` | Inclusive on all four edges: a point exactly on the boundary is inside |
| `segSeg` | CCW orientation test **including** collinear/endpoint-touching branches (`:151-154`). The textbook 3-line version reports "no hit" when a segment lies exactly along an edge, which is what happens when a player drags along a wall's flat top. The degenerate branches are load-bearing |
| `segRect` | THE function. Inflate → `isEmptyRect` reject → endpoint-inside accept → AABB separating-axis reject (`:175-176`, pure speed) → four-edge `segSeg` |
| `segRectEntryT` | Liang–Barsky slab clipping, exact for AABBs. Returns `0` when `a` is already inside. Guard at `:223` (`minX > maxX \|\| minY > maxY`) mirrors `isEmptyRect`, because slab clipping would otherwise swap reversed bounds back into a valid interval |
| **agreement invariant** | `segRect(a,b,r,pad) === (segRectEntryT(a,b,r,pad) !== null)`, stated at `:207` and pinned across negative pads by `Geometry.test.ts:146` |
| `segCircleEntryT` | Quadratic ray/circle; returns `0` if `a` is already inside (`cc <= 0`), `null` for a zero-length segment starting outside, `null` if `tEnter` falls outside `[0,1]` |
| `distPointToSeg` | Projects and clamps `t` to `[0,1]`; degenerates to `dist(p, a)` when the segment is shorter than `EPS` |
| `boundsOf` | `null` for an empty set; otherwise min/max box (`w`/`h` can be `0`) |

Non-exported internals worth knowing: `EPS = 1e-9` (`:32`), `orient` (`:117`), `withinSegBounds` (`:122`).

---

## `src/core/LevelValidator.ts`

| symbol | kind | file:line |
|---|---|---|
| `clearance` | function | `src/core/LevelValidator.ts:170` |
| `difficulty` | function | `src/core/LevelValidator.ts:275` |
| `interlock` | function | `src/core/LevelValidator.ts:207` |
| `interlockBands` | function | `src/core/LevelValidator.ts:234` |
| `PLAYABLE_CLEARANCE` | const | `src/core/LevelValidator.ts:310` |
| `pressure` | function | `src/core/LevelValidator.ts:320` |
| `validateLevel` | function | `src/core/LevelValidator.ts:52` |
| `ValidationResult` | interface | `src/core/LevelValidator.ts:27` |
| `ValidatorOptions` | interface | `src/core/LevelValidator.ts:39` |

### Types

```ts
export interface ValidationResult {          // :27
  readonly solvable: boolean;
  /** Cell path from start to goal, in pixels. Empty when unsolvable. */
  readonly path: Vec2[];
  /** Free cells reachable from the start — a rough measure of how open it is. */
  readonly reachable: number;
  /** Free cells in total. reachable/free near 1 means the level barely constrains. */
  readonly free: number;
  /** Why it failed, when it did. */
  readonly reason?: string;
}

export interface ValidatorOptions {          // :39
  /** Grid spacing in pixels. Smaller is slower and more permissive. */
  readonly cell?: number;
  readonly hitRadius?: number;
  readonly goalRadius?: number;
}
```

`reason` is one of exactly three strings: `'start is inside a wall'` (`:96`), `'goal is unreachable ground'` (`:100`), `'no path from start to goal'` (`:145`).

### Signatures and defaults

```ts
export function validateLevel(
  level: Level,
  pf: Playfield,
  opts: ValidatorOptions = {}
): ValidationResult;                                                    // :52

export function clearance(
  level: Level,
  pf: Playfield,
  opts: ValidatorOptions & { max?: number } = {}
): number;                                                              // :170

export function interlock(level: Level, samples = 1000): number;        // :207
export function interlockBands(level: Level, samples = 600): number;    // :234
export function difficulty(level: Level, pf: Playfield): number;        // :275
export const PLAYABLE_CLEARANCE = 6;                                    // :310
export function pressure(level: Level, pf: Playfield, cell = 8): number;// :320
```

`validateLevel` internal defaults (`:57-59`): `cell = opts.cell ?? 6`, `hitRadius = opts.hitRadius ?? 5.2`, `goalRadius = opts.goalRadius ?? 30`. Note `5.2` and `30` happen to equal `METRICS.hitRadius` and `METRICS.goalRadius` but are **hardcoded literals here**, not imports — changing `METRICS` does not change these defaults. Call sites pass them explicitly (`levels.test.ts:18`, `genLevels.ts:246`).

| function | behaviour |
|---|---|
| `validateLevel` | 8-neighbour BFS over a `cell`-spaced grid covering `pf.x … pf.axisX` × `pf.y … pf.bottom`. `cols = Math.floor((pf.axisX - pf.x) / cell) + 1`, `rows = Math.floor(pf.h / cell) + 1`. A cell is free iff `!collision.blocks(p, p)`; an edge is open iff `!collision.blocks(from, to)`. Start must be within `cell * 2` of the nearest free cell; goal within `goalRadius`. Deliberately **conservative**: the grid is coarser than a finger, so a pass means definitely solvable, a fail may mean merely very tight |
| `clearance` | How much fatter the stroke could be and still fit, in pixels. Returns `-1` if unsolvable at `+0`. Binary search of exactly 7 iterations between `lo = 0` and `hi = opts.max ?? 34`; returns `hi` immediately if `ok(hi)` |
| `interlock` | Fraction (0..1) of constrained heights where the near walls **and** the mirrored far walls both bite. `any === 0 → 0`. Works on normalized `y` only; `pf` is not needed |
| `interlockBands` | Count of contiguous `y` runs where both halves bite at once |
| `difficulty` | `0.4 * tight + 0.35 * mirror + 0.25 * plan`, where `tight = clamp01(1 - clearance/40)`, `mirror = 0.5 * clamp01(interlockBands/4) + 0.5 * clamp01(interlock/0.6)`, `plan = 0.5 * clamp01(walls.length/14) + 0.5 * clamp01(turns/10)`, `turns` = x-direction reversals along the BFS path. **Absolute, not pool-normalised**, so the generator and the test suite compute the same number |
| `PLAYABLE_CLEARANCE` | `6` base px — the least slack a level may ship with. ~3 css px per side on a 390pt phone |
| `pressure` | Fraction of drawable-half grid points blocked. Hardcodes `5.2` as the hit radius (`:322`). Descriptive statistic only — **no longer the sort key** (see `:255-261`) |

Pinned by: `levels.test.ts:159` (`min(clearance) >= PLAYABLE_CLEARANCE` and `< PLAYABLE_CLEARANCE * 3`), `levels.test.ts:222` (`difficulty` monotone non-decreasing across `GENERATED_LEVELS`), `levels.test.ts:184` (`interlock > 0.05` for every generated level), `levels.test.ts:191` (`interlock === 0` for tutorial levels 1–4, `> 0.1` for level 5), `levels.test.ts:198` (mean generated `interlock > 0.2`), `levels.test.ts:139` (every level solvable at `hitRadius + PLAYABLE_CLEARANCE`).

---

## `src/core/Playfield.ts`

| symbol | kind | file:line |
|---|---|---|
| `Inset` | interface | `src/core/Playfield.ts:12` |
| `Playfield` | class | `src/core/Playfield.ts:19` |

```ts
export interface Inset {          // :12
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
```

```ts
export class Playfield {
  readonly x: number;   // :20  = inset.left
  readonly y: number;   // :21  = inset.top
  readonly w: number;   // :22  = canvasW - inset.left - inset.right
  readonly h: number;   // :23  = canvasH - inset.top - inset.bottom

  constructor(canvasW: number, canvasH: number, inset: Inset);   // :25

  get right(): number;                    // :32  x + w
  get bottom(): number;                   // :36  y + h
  get axisX(): number;                    // :41  x + w * 0.5
  toScreen(p: Vec2): Vec2;                // :46
  toNormalized(p: Vec2): Vec2;            // :57
  toScreenRect(r: Rect): Rect;            // :62
  mirror(p: Vec2): Vec2;                  // :72
  clampToDrawable(p: Vec2): Vec2;         // :81
}
```

- The **one** place normalized level space becomes pixels; conversion happens once, when a level loads.
- `toNormalized` is the exact inverse of `toScreen`. Saved figures are stored normalized so they survive a change of device, playfield inset, or export size — a phone-drawn figure has to redraw at 1080×1080 in a share card.
- `clampToDrawable` clamps `x` to `[this.x, this.axisX]` and `y` to `[this.y, this.bottom]`. **LOCKED**: the axis is a soft wall — clamped, never rejected, so the stroke can slide along it but never cross. `x` is *not* clamped to `right`, only to `axisX`.
- The reference playfield used by tests, the generator, `ShareCard` and `GalleryScene` is always `new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)` → `x=24, y=88, w=702, h=1102`, `axisX=375`, `bottom=1190`.
- `Playfield.test.ts:53` pins `mirror` against the LOCKED normalized definition `mirror(p) = {1-x, y}`.

---

## `src/core/Ribbon.ts`

| symbol | kind | file:line |
|---|---|---|
| `buildRibbon` | function | `src/core/Ribbon.ts:118` |
| `DEFAULT_RIBBON` | const | `src/core/Ribbon.ts:32` |
| `Ribbon` | interface | `src/core/Ribbon.ts:101` |
| `ribbonOutline` | function | `src/core/Ribbon.ts:161` |
| `RibbonOptions` | interface | `src/core/Ribbon.ts:17` |
| `RibbonQuad` | interface | `src/core/Ribbon.ts:94` |
| `widthProfile` | function | `src/core/Ribbon.ts:48` |

### Types

```ts
export interface RibbonOptions {          // :17
  /** Nib width at normal drawing speed, in pixels. */
  readonly baseWidth: number;
  /** Multiplier at the slowest end. */
  readonly maxScale: number;
  /** Multiplier at the fastest end. */
  readonly minScale: number;
  /** Speed, in px/ms, treated as "hurrying". */
  readonly fastSpeed: number;
  /** How many samples the taper at each end spans. */
  readonly taperPoints: number;
  /** Passes of width smoothing. Raw per-sample speed is far too jittery. */
  readonly smoothPasses: number;
}

export interface RibbonQuad {             // :94
  readonly a: Vec2;
  readonly b: Vec2;
  readonly c: Vec2;
  readonly d: Vec2;
}

export interface Ribbon {                 // :101
  /** One quad per segment, in order. */
  readonly quads: RibbonQuad[];
  /** A disc at every sample, which is what rounds the joins and the caps. */
  readonly discs: { readonly p: Vec2; readonly r: number }[];
}
```

### `DEFAULT_RIBBON` — `src/core/Ribbon.ts:32`

```ts
export const DEFAULT_RIBBON: RibbonOptions = {
  baseWidth: 10,
  maxScale: 1.35,
  minScale: 0.45,
  fastSpeed: 2.2,
  taperPoints: 7,
  smoothPasses: 3,
};
```

`baseWidth: 10` equals `pt(5)`, i.e. the shipped `strokePt: 5`. Every call site overrides it with `pt(theme().strokePt)` anyway (`InkRenderer.ts:41`, `:336`, `:389`; `ShareCard.ts:104`).

### Functions

```ts
export function widthProfile(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions
): number[];                                                       // :48

export function buildRibbon(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions = DEFAULT_RIBBON
): Ribbon;                                                         // :118

export function ribbonOutline(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions = DEFAULT_RIBBON
): Vec2[];                                                         // :161
```

`widthProfile` returns **half-widths**, one per point:

- `n === 0 → []`; `n === 1 → [baseWidth / 2]`.
- Per-sample speed `dist(p[i-1], p[i]) / Math.max(1, times[i] - times[i-1])`; `speed[0] = speed[1]`. The `Math.max(1, …)` floor means a zero/negative dt is treated as 1 ms.
- `half * (maxScale + (minScale - maxScale) * clamp(s / fastSpeed, 0, 1))` — fast is thin, slow is thick.
- `smoothPasses` iterations of `[0.25, 0.5, 0.25]` over interior points.
- Taper spans `Math.min(taperPoints, Math.floor(n / 2))` samples at each end, multiplied by the smoothstep `f = k*k*(3-2*k)` with `k = (i+1)/(taper+1)`. Squared falloff reads as a pen leaving paper; linear reads as a cut-off.

`buildRibbon` emits a disc per point (`r = Math.max(0, widths[i])`) and a quad per segment, skipping segments shorter than `1e-9`. **Overlapping quads + discs, not one closed polygon**: a single outline polygon self-crosses at a sharp turn and any triangulator then punches a hole through the stroke. Overlap is invisible at full opacity, and it gives genuinely round joins and caps.

`ribbonOutline` walks down one side and back up the other (`[...left, ...right.reverse()]`), using the *central-difference* tangent `next - prev`. Used for the win figure's fill silhouette. Note it **skips** points whose central difference is degenerate, so the returned length can be less than `2 * points.length`.

**Ribbon is rendering only.** Collision runs on the raw samples at a fixed hit radius (LOCKED), so how thick the ink looks never changes what kills you.

---

## `src/core/StrokeRecorder.ts`

| symbol | kind | file:line |
|---|---|---|
| `chaikin` | function | `src/core/StrokeRecorder.ts:168` |
| `chaikinScalar` | function | `src/core/StrokeRecorder.ts:114` |
| `closedFigure` | function | `src/core/StrokeRecorder.ts:236` |
| `densify` | function | `src/core/StrokeRecorder.ts:140` |
| `densifyTimes` | function | `src/core/StrokeRecorder.ts:93` |
| `DrawnStroke` | interface | `src/core/StrokeRecorder.ts:205` |
| `renderPath` | function | `src/core/StrokeRecorder.ts:197` |
| `renderStroke` | function | `src/core/StrokeRecorder.ts:218` |
| `StrokeRecorder` | class | `src/core/StrokeRecorder.ts:13` |

### `StrokeRecorder` — `src/core/StrokeRecorder.ts:13`

```ts
export class StrokeRecorder {
  constructor(minDist: number);                 // :26   stores minDist ** 2

  begin(p: Vec2, tMs = 0): void;                // :31
  push(p: Vec2, tMs = 0): boolean;              // :44
  pushExact(p: Vec2, tMs = 0): void;            // :57
  get points(): readonly Vec2[];                // :62
  get times(): readonly number[];               // :67
  get last(): Vec2 | undefined;                 // :71
  get count(): number;                          // :75
  clear(): void;                                // :79
}
```

| member | behaviour |
|---|---|
| `begin` | Clears both arrays, then pushes a **clone** of `p` and `tMs` |
| `push` | Returns `false` and records nothing when `distSq(last, p) < minDist ** 2`; otherwise clones and returns `true`. Spacing is measured from the last **accepted** sample (`StrokeRecorder.test.ts:50`) |
| `pushExact` | Bypasses the spacing rule. Used for the exact wall-contact point and the exact goal-entry point, so the ink terminates where the event happened rather than at the last sample |
| `points` / `times` | Live `readonly` views onto the internal arrays — **not copies**. They mutate as the stroke grows |
| `last` | `undefined` when empty |

Critical invariant (file header `:1-9`): `points` holds the **raw** samples and collision runs on those. Smoothing is applied on the way to the screen only. Smoothing the collision path would round the player's corners and let them cut inside walls they visibly clipped.

Timestamps are a parallel `number[]`, not a fattened point type, because `raw` is handed straight to collision on every pointer move and must stay a plain `Vec2[]` with no per-sample allocation.

### Free functions

```ts
export function densifyTimes(
  points: readonly Vec2[],
  times: readonly number[],
  maxSpacing: number
): number[];                                                                     // :93

export function chaikinScalar(values: readonly number[], iterations: number): number[];  // :114
export function densify(points: readonly Vec2[], maxSpacing: number): Vec2[];    // :140
export function chaikin(points: readonly Vec2[], iterations: number): Vec2[];    // :168

export function renderPath(
  raw: readonly Vec2[],
  maxSpacing: number,
  iterations: number
): Vec2[];                                                                       // :197

export function renderStroke(
  raw: readonly Vec2[],
  times: readonly number[],
  maxSpacing: number,
  iterations: number
): DrawnStroke;                                                                  // :218

export function closedFigure(points: readonly Vec2[], axisX: number): Vec2[];    // :236
```

```ts
export interface DrawnStroke {          // :205
  readonly points: Vec2[];
  readonly times: number[];
}
```

| function | behaviour |
|---|---|
| `densify` | Splits every segment longer than `maxSpacing` into `Math.ceil(len / maxSpacing)` equal pieces. Inserted points lie **exactly** on the original segment — adds detail, never shape (`StrokeRecorder.test.ts:181`). Passes through unchanged (cloned) when `points.length < 2` or `maxSpacing <= 0` |
| `densifyTimes` | The scalar twin: linear interpolation with the identical `steps` computation, so index alignment with `densify` is exact |
| `chaikin` | Corner cutting: each pass replaces every segment with its 1/4 and 3/4 points and keeps both endpoints, roughly doubling the count. Breaks early when `current.length < 3` |
| `chaikinScalar` | Same 0.75/0.25 blend on a scalar series, same early break, so it stays index-aligned with `chaikin` |
| `renderPath` | `chaikin(densify(raw, maxSpacing), iterations)` |
| `renderStroke` | Points and times through both stages in lockstep. A width profile shifted by even a few samples reads as ink swelling in the wrong places |
| `closedFigure` | `[...points.map(clonePoint), ...mirrorPath(points, axisX).reverse()]` — out along the stroke, back along its mirror. Going **backwards** joins tip-to-tip and heel-to-heel: the difference between a butterfly and a bowtie. Output length is exactly `2 * points.length` (`StrokeRecorder.test.ts:296`) |

**Why `densify` exists at all** (`:129-139`): Chaikin's corner cut is proportional to the spacing it is handed, and during a flick raw samples land 80–300 px apart. Without densification the *rendered* line bows away from the raw path far enough to cross a wall the raw path cleared, and the player watches their stroke pass through an obstacle and live. `StrokeRecorder.test.ts:233` pins the drawn path to within a hit radius of the raw path at flick speed, and `:244` asserts that raw Chaikin alone blows that bound.

---

## `src/data/generatedLevels.ts`

| symbol | kind | file:line |
|---|---|---|
| `GENERATED_LEVELS` | const | `src/data/generatedLevels.ts:14` |

```ts
export const GENERATED_LEVELS: readonly Level[] = [ /* 95 object literals */ ];
```

Machine-written — **do not edit by hand**; regenerate with `npx vite-node scripts/genLevels.ts`. 95 entries, ids `l6` (line 16) through `l100` (line 1730), names from `nameFor()`. Every `start.y` is `0.92` and every `goal.y` is `0.07` (fixed by `makeCandidate`, `genLevels.ts:197-198`). Shape of one entry:

```ts
  {
    id: 'l6',
    name: 'First fold',
    start: { x: 0.129, y: 0.92 },
    goal: { x: 0.306, y: 0.07 },
    walls: [
      { x: 0.5, y: 0.805, w: 0.266, h: 0.057 },
      { x: 0, y: 0.632, w: 0.108, h: 0.057 },
      { x: 0.5, y: 0.632, w: 0.258, h: 0.057 },
      { x: 0, y: 0.475, w: 0.33, h: 0.057 },
      { x: 0.5, y: 0.314, w: 0.288, h: 0.057 },
      { x: 0.173, y: 0.162, w: 0.327, h: 0.057 },
    ],
  },
```

Count pinned at 95 by `levels.test.ts:27`.

---

## `src/data/levels.ts`

| symbol | kind | file:line |
|---|---|---|
| `LEVELS` | const | `src/data/levels.ts:89` |
| `levelAt` | function | `src/data/levels.ts:92` |
| `TUTORIAL_LEVELS` | const | `src/data/levels.ts:21` |

```ts
export const TUTORIAL_LEVELS: readonly Level[] = [ /* 5 entries, ids l1..l5 */ ];   // :21
export const LEVELS: readonly Level[] = [...TUTORIAL_LEVELS, ...GENERATED_LEVELS];  // :89

export function levelAt(index: number): Level {                                     // :92
  const n = LEVELS.length;
  return LEVELS[((index % n) + n) % n];
}
```

`levelAt` wraps in **both** directions, so level cycling never falls off either end (negative indices are legal).

`TUTORIAL_LEVELS` verbatim — these numbers are LOCKED; the generator appends after them and never touches them:

| # | id | name | start | goal | walls |
|---|---|---|---|---|---|
| 1 | `l1` | First reflection | `{ x: 0.14, y: 0.88 }` | `{ x: 0.14, y: 0.12 }` | `{0, 0.44, 0.3, 0.06}`, `{0.5, 0.64, 0.28, 0.06}` |
| 2 | `l2` | Zigzag | `{ x: 0.12, y: 0.9 }` | `{ x: 0.12, y: 0.1 }` | `{0, 0.72, 0.26, 0.05}`, `{0.5, 0.56, 0.3, 0.05}`, `{0, 0.4, 0.3, 0.05}`, `{0.5, 0.24, 0.34, 0.05}` |
| 3 | `l3` | Gate | `{ x: 0.1, y: 0.9 }` | `{ x: 0.4, y: 0.1 }` | `{0, 0.6, 0.22, 0.06}`, `{0.34, 0.6, 0.16, 0.06}`, `{0.5, 0.36, 0.22, 0.06}`, `{0.86, 0.36, 0.14, 0.06}` |
| 4 | `l4` | Sacrifice | `{ x: 0.1, y: 0.9 }` | `{ x: 0.1, y: 0.1 }` | `{0.5, 0.68, 0.38, 0.06}`, `{0, 0.5, 0.36, 0.06}`, `{0.62, 0.32, 0.38, 0.06}`, `{0.2, 0.18, 0.3, 0.06}` |
| 5 | `l5` | Tangle | `{ x: 0.08, y: 0.92 }` | `{ x: 0.08, y: 0.08 }` | 7 walls, `src/data/levels.ts:73-81` |

(Wall tuples are `{x, y, w, h}`.)

Pinned by `levels.test.ts:26` (`length === 5`), `:28` (`LEVELS.length === 100`), `:40` (`TUTORIAL_LEVELS[0]` deep-equals the literal above), `:50` (`[3].name === 'Sacrifice'`), `:51` (`[4].walls.length === 7`).

---

## `src/data/types.ts`

| symbol | kind | file:line |
|---|---|---|
| `Level` | interface | `src/data/types.ts:23` |
| `Rect` | type re-export | `src/data/types.ts:19` |
| `Vec2` | type re-export | `src/data/types.ts:19` |

```ts
export type { Rect, Vec2 } from '../core/Geometry';   // :19

export interface Level {                              // :23
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

`parMs` is declared and **never read anywhere in the codebase** — no level literal sets it and nothing consumes it.

The LOCKED coordinate contract lives in this file's header (`:1-18`) and is enforced by tests:

| rule | test |
|---|---|
| `start.x < 0.5` and `goal.x < 0.5` for every level | `levels.test.ts:56` |
| walls inside `[0,1]` with positive `w`/`h` (tolerance `1.0001`) | `levels.test.ts:64` |
| no level is mirror-symmetric (a symmetric level is contentless) | `levels.test.ts:86` |
| every level has at least one wall with `x + w > 0.5` | `levels.test.ts:97` |
| no two walls overlap in a level | `quality.test.ts:70` |
| every wall has `w > 0.02` and `h > 0.02` | `quality.test.ts:84` |
| no wall is inert (removing it must change reachability) | `quality.test.ts:31` |
| no two levels share a wall layout; every name unique | `quality.test.ts:51`, `:63` |

See [02-coordinate-system.md](02-coordinate-system.md).

---

## `src/main.ts`

**No exports.** Module side effects only, at `src/main.ts:10-67`:

| behaviour | line | detail |
|---|---|---|
| `new Phaser.Game({...})` | `:10` | `type: Phaser.AUTO`, `parent: 'app'`, `backgroundColor: theme().paper`, `scale: { mode: FIT, autoCenter: CENTER_BOTH, width: BASE_WIDTH, height: BASE_HEIGHT }`, `input: { activePointers: 3 }`, `render: { antialias: true, roundPixels: false, powerPreference: 'high-performance' }`, `fps: { target: 60 }` |
| scene order | `:36` | `[BootScene, MenuScene, LevelSelectScene, GalleryScene, GameScene]` — Boot runs first |
| `refresh` | `:47` | `game.scale.refresh()`, bound to `resize`, `orientationchange`, `visualViewport` `resize`/`scroll`, plus fixed timeouts at `[50, 250, 600, 1200]` ms |
| dev handle | `:58` | Under `import.meta.env.DEV`: `window.game = game` and `window.foldwing = { renderShareCard }`. Tree-shaken out of `vite build` |

`activePointers: 3` is load-bearing: Phaser allocates one touch Pointer by default, so the second hand reaching in during a 400 ms fail flash — while the drawing finger is still down — would find no free Pointer.

---

## `src/render/HitArea.ts`

| symbol | kind | file:line |
|---|---|---|
| `Box` | interface | `src/render/HitArea.ts:41` |
| `centredHitArea` | function | `src/render/HitArea.ts:37` |
| `HitRect` | interface | `src/render/HitArea.ts:26` |
| `liveBox` | function | `src/render/HitArea.ts:58` |
| `paintedBox` | function | `src/render/HitArea.ts:49` |

```ts
export interface HitRect {          // :26
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Box {              // :41
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export function centredHitArea(w: number, h: number): HitRect {                        // :37
  return { x: 0, y: 0, width: w, height: h };
}

export function paintedBox(cx: number, cy: number, w: number, h: number): Box;          // :49
export function liveBox(hit: HitRect, cx: number, cy: number, w: number, h: number): Box; // :58
```

`centredHitArea` returns `(0, 0, w, h)`, **not** the visually obvious `(-w/2, -h/2, w, h)`. Phaser's `InputManager.pointWithinHitArea` adds `displayOriginX/Y` back before running the containment callback, so hit areas are authored in **top-left** space regardless of where the object's origin sits. Passing the centred rectangle subtracts the half-extent twice: only the top-left quarter of a button responds, and its overhang steals taps from whatever sits above and left.

`liveBox` reproduces Phaser's derivation (`local = point − centre`, `+= displayOrigin (w/2, h/2)`, test against the hit rect) so the bug can be proved in a Node test rather than only in a browser. `HitArea.test.ts:45` reproduces the shipped bug (top-left quarter only) and `:60` its tap-stealing overhang; `:11`/`:26` assert the fixed rectangle covers the whole painted face including corners.

---

## `src/render/InkRenderer.ts`

| symbol | kind | file:line |
|---|---|---|
| `buildFigure` | function | `src/render/InkRenderer.ts:319` |
| `InkRenderer` | class | `src/render/InkRenderer.ts:96` |
| `paintFigureInto` | function | `src/render/InkRenderer.ts:368` |

### `InkRenderer` — `src/render/InkRenderer.ts:96`

```ts
export class InkRenderer {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly pf: Playfield
  );                                                                          // :104

  drawLevel(walls: readonly Rect[], startPx: Vec2, goalPx: Vec2): void;       // :122
  drawStroke(raw: readonly Vec2[], times: readonly number[], color?: number): void; // :170
  clearStroke(): void;                                                        // :191
  flashFail(raw: readonly Vec2[], times: readonly number[]): void;            // :203
  showReveal(mirroredWalls: readonly Rect[], durationMs: number): void;       // :230
  clearReveal(): void;                                                        // :261
  presentWin(raw: readonly Vec2[], times: readonly number[]): void;           // :274
  clearWin(): void;                                                           // :295
  destroy(): void;                                                            // :302
}
```

Private members: `levelG`, `revealG`, `mirrorG`, `strokeG`, `washG` (Graphics), `winLayer` (Container | null); `drawAxis` (`:143`), `drawStart` (`:154`), `drawGoal` (`:159`).

Depth constants (non-exported, `:25`): `level: 10, reveal: 15, mirror: 18, stroke: 20, win: 30, wash: 40`.

| method | behaviour |
|---|---|
| `drawLevel` | Takes **pixel-space** geometry, not level space. Draws the dashed axis, walls (corner radius `min(METRICS.wallCornerRadius, w/2, h/2)`), the mirrored start/goal at `theme().reflectionAlpha`, then the real start/goal at alpha 1 |
| `drawStroke` | Rebuilds both ribbons from the raw samples every call. `mirrorG` is forced to alpha 1 |
| `flashFail` | `drawStroke(..., theme().fail)` plus a full-canvas wash at alpha `0.1` tweened to 0 over `METRICS.failFlashMs` |
| `showReveal` | Paints `mirroredWalls` at `theme().fail, 0.16`, fades in over 220 ms, holds `durationMs`, fades out over 420 ms and clears |
| `presentWin` | Clears any previous win and the live stroke, builds the figure, sets scale `METRICS.winSettleFrom`, tweens to 1 after `METRICS.winHoldMs` over `METRICS.winSettleMs` |
| `destroy` | `clearWin()` then destroys all five Graphics objects |

**Two non-obvious rules encoded here:**

1. `veil()` (`:86`, non-exported) pre-blends the mirror's *colour* toward the paper instead of setting alpha. A ribbon is dozens of overlapping quads and discs, and Phaser applies a Graphics object's alpha **per draw command**, so `mirrorAlpha: 0.45` accumulated to a measured 0.95–0.97 and the reflection rendered as solid as the player's own line.
2. `nib()` (`:40`, non-exported) is the only place the theme's `strokePt` reaches the renderer: `{ ...DEFAULT_RIBBON, baseWidth: pt(theme().strokePt) }`. Nothing in collision reads `InkTheme`.

### `buildFigure` — `src/render/InkRenderer.ts:319`

```ts
export function buildFigure(
  scene: Phaser.Scene,
  stroke: DrawnStroke,
  axisX: number,
  opts?: Partial<RibbonOptions>
): Phaser.GameObjects.Container | null
```

Returns `null` when `boundsOf(closedFigure(...))` is null (empty stroke). The container is positioned at the figure's centre `(cx, cy)` with all child geometry rebased to local coordinates, so callers can scale/tween it about its own centre. Children in order: fill (`theme().ink` at `winFillAlpha`), mirrored ribbon (veiled colour), ink ribbon. Ribbon options are `{ ...DEFAULT_RIBBON, baseWidth: pt(t.strokePt), ...opts }` — `opts` wins.

Shared by the win moment and the gallery, so a saved figure is rendered by exactly the code that drew it when it was earned.

### `paintFigureInto` — `src/render/InkRenderer.ts:368`

```ts
export function paintFigureInto(
  g: Phaser.GameObjects.Graphics,
  raw: readonly Vec2[],
  times: readonly number[],
  axisX: number,
  box: Rect,
  alphaScale = 1
): void
```

Fits the closed figure uniformly into `box` (`scale = Math.min(box.w/bounds.w, box.h/bounds.h)`), returns early if bounds are missing or degenerate. Nib is `Math.max(1.5, pt(t.strokePt) * scale)`. Unlike the live stroke it paints through the non-exported `paintRibbonAlpha` (`:419`), which sets an explicit alpha — acceptable because at thumbnail size the overlap beading is sub-pixel and sharing one Graphics for the whole grid is worth more.

---

## `src/render/ScrollView.ts`

| symbol | kind | file:line |
|---|---|---|
| `ScrollRow` | interface | `src/render/ScrollView.ts:41` |
| `ScrollView` | class | `src/render/ScrollView.ts:72` |
| `ScrollViewOptions` | interface | `src/render/ScrollView.ts:64` |

```ts
export interface ScrollRow {          // :41
  /** Vertical centre of the row in CONTENT space (0 = top of the content). */
  readonly y: number;
  readonly height: number;
  /** Horizontal band, so a grid can put several rows side by side. */
  readonly x: number;
  readonly width: number;
  readonly view?: Phaser.GameObjects.GameObject;
  /** Absent for a row that is drawn but not selectable, e.g. a locked level. */
  readonly onTap?: () => void;
  /** Visual feedback while the finger is down on this item. */
  readonly onArm?: (armed: boolean) => void;
}

export interface ScrollViewOptions {  // :64
  /** Visible window in screen space. */
  readonly top: number;
  readonly bottom: number;
  readonly contentHeight: number;
  readonly items: readonly ScrollRow[];
}

export class ScrollView {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly content: Phaser.GameObjects.Container,
    private readonly opts: ScrollViewOptions
  );                                        // :83

  get scrollable(): boolean;                // :105   maxOffset > 0
  get progress(): number;                   // :110   0..1, or 0 when everything fits
  scrollTo(offset: number): void;           // :115   zeroes velocity, clamps, no rubber band
}
```

The constructor binds `POINTER_DOWN`/`POINTER_MOVE`/`POINTER_UP` on `scene.input` and `UPDATE` on `scene.events`, and unbinds all four on `SHUTDOWN` (`:97-102`). `maxOffset = Math.max(0, contentHeight - (bottom - top))`. Private members: `inWindow`, `hit`, `cull`, `setArmed`, `onDown`, `onMove`, `onUp`, `onUpdate`, `applyOffset`.

Motion constants (non-exported, `:24-39`):

| const | value | meaning |
|---|---|---|
| `FRAME_MS` | `1000 / 60` | the 60 Hz the constants are tuned against |
| `DECAY` | `0.92` | per-frame velocity retained while gliding |
| `SETTLE` | `0.25` | fraction of remaining overshoot removed per frame |
| `FLICK_MIX` | `0.35` | weight of the newest sample in smoothed throw speed |
| `MAX_FLICK` | `120` | px/frame ceiling on a single sample |
| `GLIDE_STOP` | `0.6` | above this speed a touch means "stop", not "choose" |

Rubber-band slack while dragging is `90` px (`:265`). `applyOffset` rounds `content.y` to whole pixels — a container on a fractional offset resamples every glyph and hairline each frame, which reads as shimmer.

Behavioural rules a naive change breaks:

- Input is handled at **scene** level with hand hit-testing, never per-row interactive objects: Phaser fires `pointerout` on a few pixels of drift, which cancels the press, and scrolling and tapping are the same gesture until the finger commits.
- A touch landing while `|velocity| > GLIDE_STOP` arms **nothing** — grabbing a fling to stop it must not open a card (`:180`, `:187`).
- Decay and settle are applied per unit of *time* (`steps = clamp(delta, 1, 50) / FRAME_MS`), not per frame, or the same flick travels twice as far at 120 Hz.
- `cull()` hides off-screen rows with one row of slack either side. Phaser does not cull inside a Container, so without this all 100 level cards are submitted every frame (measured: 5 fps).

---

## `src/render/ShareCard.ts`

| symbol | kind | file:line |
|---|---|---|
| `CARD_SIZE` | const | `src/render/ShareCard.ts:28` |
| `CardOptions` | interface | `src/render/ShareCard.ts:30` |
| `renderShareCard` | function | `src/render/ShareCard.ts:124` |

```ts
export const CARD_SIZE = 1080;          // :28

export interface CardOptions {          // :30
  readonly size?: number;
  readonly transparent?: boolean;
  /** Caption under the figure. Falsy hides the whole footer. */
  readonly caption?: string;
  readonly showWordmark?: boolean;
  /** Fraction of the side left as breathing room. Default 0.12. */
  readonly marginScale?: number;
  /** Multiplier on the nib. The app icon wants a far bolder line than a card. */
  readonly nibScale?: number;
  /** Skip the grain — wanted for an app icon, which must stay flat. */
  readonly flat?: boolean;
}

export function renderShareCard(figure: SavedFigure, opts: CardOptions = {}): string;  // :124
```

Returns a `image/png` data URL, or `''` if `canvas.getContext('2d')` returns null.

Defaults and derived geometry:

| value | expression | line |
|---|---|---|
| `size` | `opts.size ?? CARD_SIZE` (1080) | `:125` |
| `hasFooter` | `Boolean(opts.caption) \|\| opts.showWordmark !== false` | `:160` |
| `margin` | `size * (opts.marginScale ?? 0.12)` | `:161` |
| `footer` | `hasFooter && !opts.transparent ? size * 0.11 : 0` | `:162` |
| `scale` | `Math.min(boxW / max(bounds.w,1), boxH / max(bounds.h,1))` — **uniform** | `:168` |
| `nibWidth` | `pt(t.strokePt) * scale * (opts.nibScale ?? 1)` | `:173` |
| caption font | `${Math.round(size * 0.034)}px Georgia, "Times New Roman", serif` at `rgba(ink, 0.46)` | `:189` |
| wordmark font | `${Math.round(size * 0.042)}px Georgia, "Times New Roman", serif` at `rgba(ink, 0.8)`, text `'foldwing'` | `:196` |

Draw order: paper (or flat fill, or nothing when `transparent`) → outline fill at `winFillAlpha` → mirrored ribbon at `mirrorAlpha` → ink ribbon at alpha 1 → footer.

Key decisions:

- Drawn on a **raw 2D canvas**, not a Phaser WebGL snapshot: the export must be pixel-exact, identical on web and device, and available without a live scene (the gallery renders figures from earlier sessions).
- The figure is rebuilt in the reference playfield `new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)` (`:146`) through the **same** `renderStroke` the game used, so what is shared is what the player made — including where they hesitated.
- The grain (`layPaper`, `:58`) goes through an offscreen canvas and `drawImage`, **never** `putImageData`: `putImageData` overwrites destination alpha rather than compositing, which punched the opaque paper down to ~10% alpha.
- Default is the **card**, not transparent. A transparent PNG posted to a social app lands on whatever background that app uses — usually black — and the dark ink disappears.

---

## `src/render/Theme.ts`

| symbol | kind | file:line |
|---|---|---|
| `BASE_HEIGHT` | const | `src/render/Theme.ts:31` |
| `BASE_WIDTH` | const | `src/render/Theme.ts:30` |
| `InkTheme` | interface | `src/render/Theme.ts:46` |
| `METRICS` | const (`as const`) | `src/render/Theme.ts:113` |
| `PT` | const | `src/render/Theme.ts:38` |
| `pt` | function | `src/render/Theme.ts:40` |
| `rgba` | function | `src/render/Theme.ts:104` |
| `setTheme` | function | `src/render/Theme.ts:98` |
| `theme` | function | `src/render/Theme.ts:94` |
| `THEMES` | const | `src/render/Theme.ts:88` |

```ts
export const BASE_WIDTH = 750;                                    // :30
export const BASE_HEIGHT = 1334;                                  // :31
export const PT = 2;                                              // :38
export function pt(points: number): number { return points * PT; } // :40

export function theme(): InkTheme;                                // :94
export function setTheme(id: string): void;                       // :98
export function rgba(color: number, alpha: number): string;       // :104
```

`theme()` returns the module-level `active` (initialised to `PAPER`, `:92`). `setTheme(id)` is a **no-op for an unknown id** — it never blanks the game (`Theme.test.ts:58`). `rgba(0x16323c, 0.11)` → `'rgba(22,50,60,0.11)'` (`Theme.test.ts:53`).

### `InkTheme` — `src/render/Theme.ts:46`

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

### `THEMES` — `src/render/Theme.ts:88`

```ts
export const THEMES: Readonly<Record<string, InkTheme | undefined>> = {
  paper: PAPER,
};
```

`| undefined` in the value type keeps the lookup honest — an unknown id is a miss, not a phantom theme. The single theme (`PAPER`, non-exported, `:71`):

| field | value | pinned |
|---|---|---|
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

`capacitor.config.ts` hardcodes `backgroundColor: '#E9EBE4'` — the same paper, but as a separate literal that will not follow a theme change.

### `METRICS` — `src/render/Theme.ts:113`

```ts
export const METRICS = { /* … */ } as const;
```

| field | source expression | value | note / pin |
|---|---|---|---|
| `hitRadius` | `pt(2.6)` | `5.2` | **LOCKED.** Measured from the centreline against a 5 pt nib that reaches 2.5 pt, so contact fires **0.2 base px before** the visible ink touches — marginally strict, not forgiving. `Theme.test.ts:66`, `:79` |
| `sampleMinDist` | `pt(2.6)` | `5.2` | `<= hitRadius`, which is what makes dropping a near-duplicate sample safe. `Theme.test.ts:93` |
| `touchOffsetY` | `pt(42)` | `84` | `Theme.test.ts:100` |
| `touchOffsetRampPx` | `pt(21)` | `42` | Distance, not time. `Theme.test.ts:104` |
| `renderMaxSpacing` | `pt(5)` | `10` | `<= pt(strokePt)`. `Theme.test.ts:114` |
| `startRadius` | `pt(10)` | `20` | — |
| `startGrabFactor` | `2.4` | `2.4` | grab radius `= 48 = pt(24)`. `Theme.test.ts:121` |
| `goalRadius` | `pt(15)` | `30` | visual radius **and** the win threshold |
| `goalRingWidth` | `pt(2)` | `4` | — |
| `wallCornerRadius` | `pt(3)` | `6` | — |
| `axisWidth` | `pt(1)` | `2` | — |
| `axisDash` | `pt(7)` | `14` | — |
| `axisGap` | `pt(6)` | `12` | — |
| `smoothIterations` | `2` | `2` | Chaikin passes on the RENDERED stroke only. `Theme.test.ts:137` |
| `failFlashMs` | `400` | `400` | `Theme.test.ts:126` |
| `winHoldMs` | `180` | `180` | `Theme.test.ts:131` |
| `winSettleMs` | `350` | `350` | `Theme.test.ts:131` |
| `winSettleFrom` | `0.97` | `0.97` | `Theme.test.ts:131` |
| `bannerReserve` | `pt(58)` | `116` | vertical band at the canvas bottom menu chrome must not use |
| `inset.top` | `pt(44)` | `88` | — |
| `inset.right` | `pt(12)` | `24` | — |
| `inset.bottom` | `pt(72)` | `144` | clears `bannerReserve` |
| `inset.left` | `pt(12)` | `24` | — |

Structural anti-pay-to-win guarantee: `hitRadius` lives in `METRICS`, never in `InkTheme`, and nothing in `CollisionSystem` imports `Theme`. `Theme.test.ts:84` asserts `Object.keys(theme())` does not contain `hitRadius`.

---

## `src/render/UI.ts`

| symbol | kind | file:line |
|---|---|---|
| `button` | function | `src/render/UI.ts:186` |
| `ButtonOptions` | interface | `src/render/UI.ts:169` |
| `COLUMN` | const | `src/render/UI.ts:372` |
| `enter` | function | `src/render/UI.ts:349` |
| `FONT` | const (`as const`) | `src/render/UI.ts:41` |
| `label` | function | `src/render/UI.ts:113` |
| `RADIUS` | const (`as const`) | `src/render/UI.ts:67` |
| `roundRect` | function | `src/render/UI.ts:93` |
| `rule` | function | `src/render/UI.ts:302` |
| `softShadow` | function | `src/render/UI.ts:139` |
| `SPACE` | const (`as const`) | `src/render/UI.ts:58` |
| `TAP_SLOP` | const | `src/render/UI.ts:79` |
| `tappable` | function | `src/render/UI.ts:27` |
| `TextOptions` | interface | `src/render/UI.ts:104` |
| `TYPE` | const (`as const`) | `src/render/UI.ts:49` |
| `wordmark` | function | `src/render/UI.ts:319` |

### Tokens

```ts
export const FONT = {                                                              // :41
  display: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  ui: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
} as const;

export const TYPE = {                                                              // :49
  hero: pt(46),      // 92
  title: pt(27),     // 54
  heading: pt(19),   // 38
  body: pt(15),      // 30
  label: pt(12.5),   // 25
  micro: pt(10.5),   // 21
} as const;

export const SPACE = {                                                             // :58
  xs: pt(6),    // 12
  sm: pt(10),   // 20
  md: pt(16),   // 32
  lg: pt(24),   // 48
  xl: pt(36),   // 72
  xxl: pt(56),  // 112
} as const;

export const RADIUS = {                                                            // :67
  sm: pt(10),    // 20
  md: pt(16),    // 32
  lg: pt(22),    // 44
  pill: pt(999), // 1998
} as const;

export const TAP_SLOP = pt(14);                                                    // :79   = 28
export const COLUMN = BASE_WIDTH - METRICS.inset.left * 2 - pt(16) * 2;            // :372  = 638
```

(Comment values are computed, not present in source.) `RADIUS.pill` is deliberately absurd and **must** be passed through `roundRect`, which clamps it.

### `TextOptions` / `ButtonOptions`

```ts
export interface TextOptions {                     // :104
  size?: number;
  color?: number;
  alpha?: number;
  font?: string;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
}

export interface ButtonOptions {                   // :169
  width: number;
  height?: number;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: number;
  sub?: string;
  onPress: () => void;
}
```

### Functions

```ts
export function tappable(
  container: Phaser.GameObjects.Container,
  w: number,
  h: number
): void;                                                                     // :27

export function roundRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void;                                                                     // :93

export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: TextOptions = {}
): Phaser.GameObjects.Text;                                                  // :113

export function softShadow(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  strength = 1
): void;                                                                     // :139

export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: ButtonOptions
): Phaser.GameObjects.Container;                                             // :186

export function rule(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  alpha = 0.1
): Phaser.GameObjects.Graphics;                                              // :302

export function wordmark(
  scene: Phaser.Scene,
  x: number,
  y: number
): Phaser.GameObjects.Container;                                             // :319

export function enter(
  scene: Phaser.Scene,
  targets: Phaser.GameObjects.GameObject[],
  stagger = 45
): void;                                                                     // :349
```

| function | behaviour and trap |
|---|---|
| `tappable` | `container.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Rectangle.Contains)` via `centredHitArea`. **Always** go through this — a hand-built `(-w/2, -h/2, w, h)` makes only the top-left quarter live |
| `roundRect` | `fillRoundedRect(x, y, w, h, Math.max(0, Math.min(radius, w/2, h/2)))`. Phaser takes the radius on trust; a pill radius on a 60 px-tall chip sweeps arcs hundreds of pixels past the shape and paints full-height streaks. That shipped |
| `label` | Defaults: `font = FONT.ui`, `size = TYPE.body`, `color = theme().ink`, `alpha = 1`, `align = 'left'`. Colour is applied as `rgba(color, alpha)` — a Text's alpha is baked into its fill string, not `setAlpha` |
| `softShadow` | Three stacked translucent rounded rects: `{spread: pt(7), dy: pt(4), alpha: 0.05}`, `{pt(4), pt(2.5), 0.06}`, `{pt(1.5), pt(1), 0.07}`, each × `strength`. Phaser has no shadow primitive and a blur pipeline would cost a render target |
| `button` | Default height `opts.sub ? pt(66) : pt(54)`. Primary = ink fill + shadow, secondary = ink at 0.055 (0.09 pressed), ghost = ink at 0 (0.06 pressed). Press tween: scale `0.965` over 90 ms `Quad.easeOut`; release: scale 1 over 320 ms `Back.easeOut` |
| `rule` | Hairline `Math.max(1, pt(0.5))` tall, drawn from `x - w/2` |
| `wordmark` | `'foldwing'` at `TYPE.hero`/`FONT.display` with a `setScale(1, -1)` reflection at `t.mirrorAlpha * 0.42`, offset `pt(3)`. Both use origin `(0.5, 1)`, so the reflection hangs a full line-height **below** the baseline |
| `enter` | Each target is moved down `pt(14)` and to alpha 0, then tweened back over 420 ms `Cubic.easeOut` with `i * stagger` ms delay |

**`button`'s gesture rule is load-bearing** (`:245-294`): it arms on the container's own `pointerdown` but resolves on the **scene's** `POINTER_UP`. Firing on the button's `pointerup` and cancelling on `pointerout` is unusable on touch — a finger always slides a few pixels, Phaser emits `pointerout`, the press is cancelled, and the button needs two or three stabs. Movement is judged by `Phaser.Math.Distance.Between(...) > TAP_SLOP`, then the release is additionally required to land inside a rebuilt `container.getBounds()` box so dragging off to cancel still works. The scene listener is removed on the container's `destroy` (`:292`). `GameScene.buildRevealPill` re-implements the same pattern inline (`src/scenes/GameScene.ts:637-660`).

---

## `src/scenes/BootScene.ts`

| symbol | kind | file:line |
|---|---|---|
| `BootScene` | class | `src/scenes/BootScene.ts:19` |

```ts
export class BootScene extends Phaser.Scene {
  constructor();          // :20   super('Boot')
  create(): void;         // :24
}
```

`create()` sets the camera background, calls `Progress.installLifecycleFlush()`, then awaits **only** `Progress.load()`. Inside the `.then`: `Ads.setAdsRemoved(save.adsRemoved)` runs **before** `this.scene.start('Menu')` so an owner never sees an ad flash on the first frame; `Ads.init()` and `Iap.init()` are fired without awaiting.

No assets are preloaded — the whole game is vector primitives and system type. `Iap.init()` is deliberately a no-op; there is **no** silent restore at launch, because StoreKit puts a repeating "Sign in to Apple Account" dialog over a signed-out device before the player has touched anything.

---

## `src/scenes/GalleryScene.ts`

| symbol | kind | file:line |
|---|---|---|
| `GalleryScene` | class | `src/scenes/GalleryScene.ts:33` |

```ts
export class GalleryScene extends Phaser.Scene {
  constructor();        // :37   super('Gallery')
  create(): void;       // :41
}
```

Private: `pf: Playfield`, `busy: boolean`; `bakeFigures(figures, w, h): string` (`:159`), `buildCardArt(figure, w, h)` (`:193`), `share(figure)` (`:228`).

Layout constants (module-level, non-exported): `COLS = 3` (`:30`), `GAP = pt(10)` (`:31`). Card geometry: `margin = METRICS.inset.left + pt(10)`, `cardW = (gridW - GAP * (COLS-1)) / COLS`, `cardH = cardW * 1.12`. Scroll window `top = pt(126)`, `bottom = BASE_HEIGHT - METRICS.bannerReserve - pt(6)`.

Two performance rules that are the whole reason the scene works:

- **Bake, don't redraw.** A figure is dozens of `fillPoints` calls that Phaser replays and re-triangulates every frame. Measured: one saved figure took the Gallery from 16.7 ms/frame to 583 ms; 33 figures stopped it rendering. `bakeFigures` draws everything once into a RenderTexture keyed `'foldwing-gallery-cards'` and every card becomes an Image frame.
- **Remove the texture on SHUTDOWN.** `rt.destroy()` alone is not enough — `saveTexture` hands the TextureManager its own reference, so the memory outlives the scene (`:186-189`).

Clipping uses a second **camera** viewport (a GPU scissor), not a geometry mask (a full stencil pass every frame). The two cameras are told to ignore each other's objects, so anything added later must join one list or the other or it draws twice.

---

## `src/scenes/GameScene.ts`

| symbol | kind | file:line |
|---|---|---|
| `GameScene` | class | `src/scenes/GameScene.ts:77` |
| `GameSceneData` | interface | `src/scenes/GameScene.ts:60` |

```ts
export interface GameSceneData {          // :60
  levelIndex?: number;
}

export class GameScene extends Phaser.Scene {
  constructor();                          // :111   super('Game')
  create(data: GameSceneData): void;      // :115
}
```

`create` is the only public member. Everything else is private:

| private member | line |
|---|---|
| `loadLevel(index)` | `:144` |
| `onPointerDown(pointer)` | `:188` |
| `onPointerMove(pointer)` | `:228` |
| `ringGates(from, to)` | `:266` |
| `onPointerUp(pointer)` | `:277` |
| `cursorFor(pointer)` | `:284` |
| `fail(contact)` | `:300` |
| `win(entry)` | `:329` |
| `resetToIdle()` | `:377` |
| `advance()` | `:396` |
| `doReveal()` | `:419` |
| `maybeAdOnRetry()` | `:444` |
| `showShareOffer(delay)` / `clearShareOffer()` / `overSharePill(pointer)` / `shareCurrent()` | `:460`, `:476`, `:483`, `:496` |
| `showSkipOffer()` / `clearSkipOffer()` / `doSkip()` | `:518`, `:531`, `:538` |
| `buildHud()` / `buildRevealPill()` / `refreshHud()` / `showHint(msg, delay)` / `hideHint()` | `:552`, `:605`, `:665`, `:674`, `:686` |
| `bindDevKeys()` | `:693` |

Non-exported module members: `type Phase = 'idle' \| 'drawing' \| 'failed' \| 'won'` (`:58`) and `isTouchPointer(pointer)` (`:69`), which reads the native `pointerType` where the browser provides it and falls back to `pointer.wasTouch`.

State machine (file header `:4-10`):

```text
idle    --pointerdown within 2.4 × startRadius of start--> drawing
drawing --segment collides--------------------------------> failed
        --pointerup before the goal------------------------> idle   (attempt ended, no penalty)
        --path enters the goal-----------------------------> won
failed  --400ms red flash, auto-reset----------------------> idle
won     --tap (after advanceReadyAt)-----------------------> next level / LevelSelect
```

Load-bearing details:

- Collision is tested against `(prev, cursor)` — the **whole** segment, both sides — on every move (`:242`). Never against sampled points alone.
- When one segment reaches both a wall and the goal, `goalT < hitT` decides which actually happened (`:249`).
- The start-dot grab is tested against the **finger**, not the offset cursor (`:210`); the offset only exists once drawing begins. The stroke is then anchored on the dot itself, not under the finger (`:223`).
- `advanceReadyAt = now + (METRICS.winHoldMs + METRICS.winSettleMs + 250)` and the "tap for the next fold" hint use the **same** `readyIn` number (`:359-363`) — when they drift, the player's first obedient tap does nothing.
- The share pill carves itself out of the "tap anywhere = next" rule via `overSharePill` (`:194`).
- The retry interstitial fires only from the fail timer's completion, with the board already reset (`:312-317`, `:444`), and only when `Ads.wouldShowOnAttempt` agrees on **both** axes.
- Counters are spent only when an ad actually rendered (`:406`, `:451`), so a no-fill leaves the gate armed.
- `bindDevKeys` (DEV only): number keys `1..LEVELS.length` jump to a level, `r`/`R` reloads, `m`/`M` returns to Menu.

---

## `src/scenes/LevelSelectScene.ts`

| symbol | kind | file:line |
|---|---|---|
| `LevelSelectScene` | class | `src/scenes/LevelSelectScene.ts:35` |

```ts
export class LevelSelectScene extends Phaser.Scene {
  constructor();        // :36   super('LevelSelect')
  create(): void;       // :40
}
```

Private: `bakeCards(w, h): string` (`:174`), `buildCardArt(level, index, w, h)` (`:218`), `buildPreview(level, x, y, w, h, unlocked)` (`:271`).

Module constants (non-exported): `COLS = 3` (`:32`), `GAP = pt(10)` (`:33`). `cardH = cardW * 0.94`. Scroll window `top = pt(120)`, `bottom = BASE_HEIGHT - METRICS.bannerReserve - pt(6)` — short of the banner, because a card under a native banner view can be seen but never tapped.

- All 100 cards are baked into one texture keyed `'foldwing-level-cards'`, atlas columns `Math.max(1, Math.floor(2048 / slotW))` with `pad = pt(9)` for the shadow. Measured before baking: previews 30 ms/frame + card backgrounds 25 ms/frame against a 16 ms budget.
- The ~22 MB atlas is explicitly `textures.remove(key)`-ed on SHUTDOWN; `rt.destroy()` alone leaves it resident (`:204-214`).
- Every card is registered as a `ScrollRow` whether locked or not, because `ScrollView` is what culls them; a locked card left out would stay drawn for the whole scroll.
- Locked rows omit both `onTap` and `onArm`, which is exactly how `ScrollView.hit` skips them.
- Opens where the player is: if `unlockedIndex > COLS * 3`, `view.scrollTo(targetRow * (cardH + GAP) - (bottom - top) / 2)`.

---

## `src/scenes/MenuScene.ts`

| symbol | kind | file:line |
|---|---|---|
| `MenuScene` | class | `src/scenes/MenuScene.ts:30` |

```ts
export class MenuScene extends Phaser.Scene {
  constructor();        // :31   super('Menu')
  create(): void;       // :35
}
```

Private: `buildRevealChip(cx, y, figureCount)` (`:166`), `open(index)` (`:190`), `purchase()` (`:198`), `restore()` (`:207`).

- `nextIndex = Math.min(Math.max(0, save.unlockedIndex), LEVELS.length - 1)` (`:44`) — belt and braces over the sanitising in `Progress.coerce`, because an out-of-range index throws inside `create()`, which leaves **no** scene running at all: a blank screen with nothing to press.
- `resuming = nextIndex > 0 || save.totalWins > 0` (`:50`) is read from the same signal the button acts on. Reading it off `totalWins` alone made the button say "Play" and then open level 6 — the state a rewarded skip leaves.
- The action stack is laid out from a fixed top via `place(h)` rather than hand-placed rows, and the geometry depends on the row count: `selling ? pt(325) : pt(355)` start, `rowGap = selling ? pt(7) : pt(11)`, `tallRow = pt(66)`, `row = pt(54)`. With a purchase to offer there are five rows, and the reveal chip **gives up its slot** so the stack still ends above `bannerReserve`.
- `selling = Iap.available && !save.adsRemoved` (`:76`).
- `purchase()` and `restore()` both call `this.scene.restart()` on success so the whole layout recomputes.

---

## `src/systems/Ads.ts`

| symbol | kind | file:line |
|---|---|---|
| `Ads` | singleton (`AdsService`) | `src/systems/Ads.ts:302` |

```ts
export const Ads = new AdsService();      // :302
```

`AdsService` (`:26`) is not exported. Public surface:

```ts
setAdsRemoved(v: boolean): void;                                              // :57
get enabled(): boolean;                                                      // :63
get rewardedAvailable(): boolean;                                            // :71
async init(): Promise<void>;                                                 // :75
async showBanner(): Promise<void>;                                           // :117
async hideBanner(): Promise<void>;                                           // :136
wouldShowInterstitial(levelIndex: number, winsSinceAd: number): boolean;     // :175
wouldShowOnAttempt(levelIndex: number, attemptsSinceAd: number): boolean;    // :193
async showInterstitial(): Promise<boolean>;                                  // :211
async showRewarded(placement: string): Promise<boolean>;                     // :250
```

Private: `timingAllows(levelIndex)` (`:158`), `once(events, timeoutMs)` (`:285`). Private state: `ready`, `adsRemoved`, `bannerShown`, `bannerWanted`, `personalized`, `sessionStartedAt`, `lastInterstitialAt`, `mutedUntil`, `interstitialsThisSession`, `inFlight`.

| member | contract |
|---|---|
| `enabled` | `isNative() && adsConfigured() && !adsRemoved` — intrusive formats, suppressed by the purchase |
| `rewardedAvailable` | `isNative() && adsConfigured()` — **stays true for owners**; opt-in rewarded helps the player and taking it away would punish whoever paid |
| `init` | Initialises AdMob, runs ATT then UMP, sets `personalized = att.status === 'authorized' && consent.status !== REQUIRED`. Consent failures are swallowed, leaving `personalized = false` (non-personalised is the default, so a throwing consent call cannot silently start tracking people). Replays `showBanner()` if `bannerWanted` |
| `showBanner` | `ADAPTIVE_BANNER` at `BOTTOM_CENTER`, `margin: 0`, `npa: !this.personalized`. Records `bannerWanted = true` and returns early if `!ready` — BootScene starts the menu without waiting on AdMob, so the menu's call usually lands before `initialize()` resolves |
| `timingAllows` | `enabled` **and** `levelIndex >= interstitialFromLevel` **and** `interstitialsThisSession < maxInterstitialsPerSession` **and** session age `>= sessionWarmupSeconds` **and** `now >= mutedUntil` **and** time since last ad `>= minSecondsBetweenInterstitials` |
| `wouldShowInterstitial` | `timingAllows && winsSinceAd >= interstitialEveryNWins`. Non-consuming predicate — the rating prompt asks first and yields |
| `wouldShowOnAttempt` | `timingAllows && attemptsSinceAd >= interstitialEveryNAttempts`. **Both axes required.** Caller must only fire at a real transition, after the fail flash, never over it |
| `showInterstitial` | Returns `true` only if an ad really rendered. Waits for `Dismissed`/`FailedToShow` with an **8000 ms** timeout — `showInterstitial()` alone resolves when the ad is *presented*, not closed. Increments the session counter and stamps `lastInterstitialAt` only on success |
| `showRewarded` | Returns `true` only if the reward was earned. `Dismissed`/`FailedToShow` timeout is **60000 ms**. On earn, sets `mutedUntil = Date.now() + muteAfterRewardedSeconds * 1000`. `placement` is accepted and **discarded** (`void placement` at `:279`) — currently a documentation-only parameter |

`inFlight` guards both `showInterstitial` and `showRewarded` against overlap. Every method swallows its own errors: a no-fill, a network drop or a misbehaving creative must never break a level.

---

## `src/systems/Audio.ts`

| symbol | kind | file:line |
|---|---|---|
| `Audio` | singleton (`AudioService`) | `src/systems/Audio.ts:173` |

```ts
export const Audio = new AudioService();      // :173
```

```ts
setEnabled(v: boolean): void;      // :34
get isEnabled(): boolean;          // :38
unlock(): void;                    // :47
resetScale(): void;                // :68
note(): void;                      // :73
thud(): void;                      // :84
chime(): void;                     // :133
```

Private: `tone(hz, seconds, peak, type: OscillatorType)` (`:143`), `ready(): boolean` (`:168` — `enabled && ctx !== null && ctx.state === 'running'`).

Module constants (non-exported): `PENTATONIC = [0, 2, 4, 7, 9]` (`:19`), `ROOT_HZ = 261.63` (C4, `:20`), `semitone(step)` (`:22`).

| method | detail |
|---|---|
| `unlock` | Creates or resumes the `AudioContext` (falling back to `webkitAudioContext`), master gain `0.5`. **Must be called from inside a real user gesture** — iOS refuses otherwise, and a context created at boot arrives permanently suspended. `GameScene.onPointerDown` calls it first thing (`:189`) |
| `resetScale` | `step = 0`. Called when a level loads and on each `pointerdown` |
| `note` | `ROOT_HZ * 2 ** (semitone(step)/12)` as a `triangle` at peak `0.16` for `0.55 s`, plus a quiet `sine` octave above at peak `0.045` for `0.32 s`. Increments `step` |
| `thud` | `sine` from 150 Hz ramping to 58 Hz over 0.16 s, gain 0.3 decaying to 0.0001 by 0.22 s, plus a 0.05 s lowpassed (900 Hz) noise burst at 0.12. Not a buzzer — a buzzer is punishment, and this game asks you to fail dozens of times a minute |
| `chime` | Semitones `[0, 4, 7]` above `ROOT_HZ * 2`, 90 ms apart, `sine`, peak 0.09, 0.9 s |

Everything is synthesised rather than loaded: five notes and a thud as files would be five HTTP requests and a decode on a cold start that is currently under a second.

---

## `src/systems/Haptics.ts`

| symbol | kind | file:line |
|---|---|---|
| `Haptics` | singleton (`HapticsService`) | `src/systems/Haptics.ts:47` |

```ts
export const Haptics = new HapticsService();      // :47

setEnabled(v: boolean): void;      // :20
tick(): void;                      // :25   ImpactStyle.Light  — one obstacle safely passed
thud(): void;                      // :30   ImpactStyle.Medium — the stroke died
tap(): void;                       // :35   ImpactStyle.Light  — a button was pressed
```

Private `impact(style)` (`:39`) no-ops unless `enabled && Capacitor.isNativePlatform()`, and swallows rejections.

**There is deliberately no win haptic.** The figure settling is a visual beat; a buzz would step on it, and the absence of feedback exactly where the player expects some is what makes the moment feel calm.

---

## `src/systems/Iap.ts`

| symbol | kind | file:line |
|---|---|---|
| `applyEntitlement` | function | `src/systems/Iap.ts:204` |
| `Iap` | singleton (`StoreKitIapService`) | `src/systems/Iap.ts:197` |
| `IapService` | interface | `src/systems/Iap.ts:33` |
| `StoreProduct` | interface | `src/systems/Iap.ts:26` |

```ts
export interface StoreProduct {          // :26
  id: string;
  title: string;
  description: string;
  priceString: string;
}

export interface IapService {            // :33
  /** True when a purchase can actually be made right now. */
  readonly available: boolean;
  init(): Promise<void>;
  removeAdsProduct(): StoreProduct | null;
  /** @returns true if the entitlement is now owned. */
  buyRemoveAds(): Promise<boolean>;
  /** @returns true/false when authoritative, null when the store did not answer. */
  restore(): Promise<boolean | null>;
}

export const Iap: IapService = new StoreKitIapService();          // :197

export function applyEntitlement(storeSays: boolean | null): void {   // :204
  if (storeSays === true) Progress.setAdsRemoved(true);
}
```

`StoreKitIapService` (`:46`) implementation notes:

| member | line | behaviour |
|---|---|---|
| `available` | `:55` | `Capacitor.isNativePlatform()` — offered **without** having contacted the store |
| `init` | `:62` | Deliberately a **no-op** |
| `connect` (private) | `:83` | Opens the store once, only because the player asked. Registers `PRODUCT_ID` as `NON_CONSUMABLE` on `Platform.APPLE_APPSTORE`, wires `approved → grant() + t.finish()` and `verified → r.finish()` **before** `initialize()`, then initialises with `{ needAppReceipt: false }` |
| `removeAdsProduct` | `:157` | `null` when not `available`; otherwise the fetched product or the placeholder `{ id: PRODUCT_ID, title: 'Remove ads', description: '', priceString: '' }` — the menu row renders fine without a price |
| `buyRemoveAds` | `:163` | Orders the offer, then **reads `Progress.data.adsRemoved`** rather than trusting a return value: a cancel and a failure look identical here |
| `restore` | `:180` | Returns `null` (not `false`) when `store.restorePurchases()` reports an error or throws — never downgrade an entitlement on a network blip |
| `grant` (private) | `:192` | `Progress.setAdsRemoved(true)` if not already |

`PRODUCT_ID = monetization.products.removeAds` (`:44`).

Three decisions that must not be reverted:

1. `needAppReceipt: false`. The Apple adapter verifies the app receipt on startup by default, and on a fresh install there is no receipt — so StoreKit shows a sign-in dialog over the home screen on cold launch. Verified on a clean simulator.
2. `finish()` on approved transactions. An unfinished transaction is re-delivered on every launch, so the player keeps being shown a purchase they already completed.
3. Granting inside the `approved` handler, not only inside `buyRemoveAds`, so a purchase completing after the app was killed mid-flow still lands on the next start.

There is no receipt-validation server; an approved transaction is finished locally.

---

## `src/systems/Progress.ts`

| symbol | kind | file:line |
|---|---|---|
| `Progress` | singleton (`ProgressStore`) | `src/systems/Progress.ts:304` |
| `SavedFigure` | interface | `src/systems/Progress.ts:27` |
| `SaveData` | interface | `src/systems/Progress.ts:38` |

```ts
export interface SavedFigure {          // :27
  readonly levelId: string;
  readonly levelName: string;
  /** Normalized playfield coordinates, x < 0.5. */
  readonly points: readonly { x: number; y: number }[];
  /** Milliseconds from the first sample, parallel to `points`. */
  readonly times: readonly number[];
  readonly ms: number;
  readonly at: number;
}

export interface SaveData {             // :38
  /** Highest level index the player has unlocked. 0 = only the first. */
  unlockedIndex: number;
  /** Best completion time per level id, in ms. */
  bestMs: Record<string, number>;
  /** Level ids the player has ever cleared. */
  cleared: string[];
  /** Banked reveals. Spent by choice, never auto-consumed. */
  reveals: number;
  /** ISO date (YYYY-MM-DD) of the last free daily top-up. */
  lastTopUp: string;
  /** True once Remove Ads is owned. Persisted so relaunch needs no store call. */
  adsRemoved: boolean;
  /** Total wins, for ad cadence and the rating prompt. */
  totalWins: number;
  /** Wins since the last interstitial actually rendered. */
  winsSinceAd: number;
  /** Failed attempts since the last interstitial actually rendered. */
  attemptsSinceAd: number;
  /** True once the native review prompt has been spent. */
  ratePrompted: boolean;
  /** Every figure the player has ever drawn, newest last. */
  figures: SavedFigure[];
}
```

`SavedFigure.times` are **relative to the first sample** — `GameScene.win` subtracts `times[0]` before storing (`src/scenes/GameScene.ts:339-345`). `points` are normalized, not pixels, so the same figure redraws on any device and at 1080×1080 in a share card.

### `Progress` — `src/systems/Progress.ts:304`

```ts
export const Progress = new ProgressStore();

get data(): Readonly<SaveData>;                                                        // :142
async load(): Promise<SaveData>;                                                       // :146
update(patch: Partial<SaveData>): void;                                                // :158
isUnlocked(index: number): boolean;                                                    // :163
hasCleared(id: string): boolean;                                                       // :167
recordWin(levelId: string, levelIndex: number, elapsedMs: number, totalLevels: number): void; // :172
addFigure(figure: SavedFigure): void;                                                  // :198
get figures(): readonly SavedFigure[];                                                 // :206
unlockThrough(levelIndex: number, totalLevels: number): void;                          // :211
get reveals(): number;                                                                 // :220
grantReveals(n: number): void;                                                         // :226
spendReveal(): boolean;                                                                // :232
setAdsRemoved(owned: boolean): void;                                                   // :238
installLifecycleFlush(): void;                                                         // :262
async flush(): Promise<void>;                                                          // :289
async reset(): Promise<void>;                                                          // :298   dev only
```

Private: `applyDailyTopUp()` (`:244`), `scheduleFlush()` (`:281`).

Module-level (non-exported): `KEY = 'foldwing.save.v1'` (`:17`), `MAX_FIGURES = 120` (`:70`), `freshSave()` (`:72`), `coerce(raw)` (`:89`).

| member | contract |
|---|---|
| `data` | The live state object, typed `Readonly`. Not a copy |
| `load` | Never throws. A corrupt or absent save yields a fresh one — losing progress is bad, refusing to launch is worse. Applies the daily top-up before returning |
| `update` | `state = { ...state, ...patch }` then debounce a write. **Never awaited from the game loop** |
| `figures` | Returns a reversed **copy** — newest first, the order a gallery reads in |
| `reveals` | `Number.POSITIVE_INFINITY` when `adsRemoved` — unlimited reveals are the bundled perk that roughly doubles what the purchase is worth at no marginal cost |
| `spendReveal` | `true` immediately for owners; otherwise decrements and returns `true`, or returns `false` so the caller can upsell |
| `recordWin` | Keeps the minimum `bestMs`, appends to `cleared` if new, sets `unlockedIndex = min(max(current, levelIndex + 1), totalLevels - 1)`, bumps `totalWins` and `winsSinceAd` |
| `unlockThrough` | Same clamped unlock without clearing — what a rewarded skip buys |
| `addFigure` | Appends and trims to the last `MAX_FIGURES` (120). Every figure is kept, not just the best per level: the point of the gallery is that no two strokes are the same |
| `installLifecycleFlush` | Idempotent. Binds `document.visibilitychange` (when hidden) and `window.pagehide` to cancel the timer and flush now. DOM events, not `@capacitor/app`, so it covers native and web without a native dependency |
| `flush` | `Preferences.set(...)`, swallowing errors — a failed write must never surface as a crash mid-game |
| `scheduleFlush` | 250 ms debounce |

`freshSave()` defaults: `unlockedIndex: 0`, `bestMs: {}`, `cleared: []`, `reveals: monetization.reveals.startingStash` (2), `lastTopUp: ''`, `adsRemoved: false`, `totalWins: 0`, `winsSinceAd: 0`, `attemptsSinceAd: 0`, `ratePrompted: false`, `figures: []`.

**`coerce` treats the save as untrusted input.** `typeof n === 'number'` accepts `NaN`, `Infinity`, `-5` and `1.5`; a negative or fractional `unlockedIndex` reached `LEVELS[i].name` in MenuScene and threw during `create()`, which leaves **no** scene running — a blank canvas with no button to press, and the bad save is never rewritten, so every relaunch dies the same way. The `count` helper (`:105`) requires `Number.isFinite` and applies `Math.max(min, Math.trunc(n))`. Figures whose `points`/`times` are not arrays, or whose points are not `{x: number, y: number}`, are dropped rather than allowed to kill the scene.

Lifecycle flush exists because writes are coalesced 250 ms: measured, a clear landed on disk 394 ms after it happened, and a task-switch inside that window lets iOS kill the process with the win unsaved.

---

## `src/systems/Rate.ts`

| symbol | kind | file:line |
|---|---|---|
| `Rate` | singleton (`RateService`) | `src/systems/Rate.ts:38` |

```ts
export const Rate = new RateService();      // :38

shouldAsk(adWillShow: boolean): boolean;    // :20
async ask(): Promise<void>;                 // :28
```

`shouldAsk` returns `false` off-native, `false` if `adWillShow`, `false` if `Progress.data.ratePrompted`, else `totalWins >= monetization.rate.firstPromptAfterWins` (6).

`ask()` sets `ratePrompted: true` **before** calling `InAppReview.requestReview()`, and swallows the error. The OS gives no callback and throttles to roughly three prompts a year, so there is exactly one good ask and it has to land after a win — never after a failure, and never in the same beat as an ad. `GameScene.win` passes `Ads.wouldShowInterstitial(...)` as `adWillShow` (`src/scenes/GameScene.ts:368-374`) and delays the ask by `readyIn + 400` ms.

---

## `src/systems/Share.ts`

| symbol | kind | file:line |
|---|---|---|
| `Share` | singleton (`ShareService`) | `src/systems/Share.ts:104` |
| `ShareRequest` | interface | `src/systems/Share.ts:29` |

```ts
export interface ShareRequest {          // :29
  readonly dataUrl: string;
  readonly title: string;
  readonly text: string;
  readonly fileName: string;
}

export const Share = new ShareService();                        // :104

get available(): boolean;                                       // :37
/** @returns true if the image reached a share sheet, false if it only saved. */
async shareFigure(req: ShareRequest): Promise<boolean>;         // :46
```

Private: `shareNative(req)` (`:51`), `shareWeb(req)` (`:75`). Module helpers (non-exported): `stripDataUrl` (`:16`), `dataUrlToBlob` (`:21`).

- `available` is `isNative() || typeof navigator !== 'undefined' || typeof document !== 'undefined'` — effectively always `true` in a browser or webview.
- Native path writes the PNG to `Directory.Cache` (**not** Documents — a derived artefact the user can regenerate has no business surviving in their file provider), then calls `NativeShare.share({ title, text, files: [written.uri], dialogTitle: title })`.
- A **cancelled** share sheet throws, and that returns `false` rather than surfacing an error.
- Web path tries `navigator.share` guarded by `navigator.canShare({ files })`, then falls back to an `<a download>` click so the button is never dead. The download path returns `false`.

---

## `scripts/genLevels.ts`

**No exports.** A top-level side-effect script: `npx vite-node scripts/genLevels.ts` writes `src/data/generatedLevels.ts` (`:448`) and prints a summary plus a difficulty-band table (`:450-467`). The `export const GENERATED_LEVELS` at `:443` is text **inside the emitted-file template literal**, not a declaration in this module.

Module-level constants:

| name | line | value | role |
|---|---|---|---|
| `TARGET` | `:37` | `95` | levels emitted |
| `POOL` | `:43` | `1100` | candidates measured before choosing |
| `MIN_INTERLOCK` | `:49` | `0.12` | least `interlock()` a candidate may have |
| `pf` | `:50` | `new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)` | the shipped playfield |
| `VOPTS` | `:246` | `{ cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius }` | validator options |
| `ADJ_TIERS` | `:214` | 5 tiers × 5 adjectives, gentle → severe | name bands |
| `NOUN` | `:221` | 20 nouns | name nouns |
| `SKEW` | `:414` | `0.55` | exponent bending the pool sample toward the hard end |

Internal functions:

```ts
function rng(seed: number): () => number;                                   // :52   LCG 1664525/1013904223
const round = (n: number): number => Math.round(n * 1000) / 1000;           // :60
type RowKind = 'leftEdge' | 'axisLeft' | 'axisRight' | 'rightEdge' | 'gate' | 'interlock';  // :67
function buildRow(kind: RowKind, y: number, h: number, w: number, r: () => number, t: number): Rect[];  // :69
function makeCandidate(seed: number, t: number): Level;                     // :132
function nameFor(i: number, total: number): string;                         // :235
function stripInert(level: Level): Level;                                   // :265
function turnsIn(level: Level): number;                                     // :278
interface Scored { level: Level; clear: number; bands: number; inter: number;
                   walls: number; turns: number; press: number; score: number; }  // :294
```

Pipeline (`:313-419`):

1. `t = (seed * 0.6180339887498949) % 1` — the difficulty dial is spread by the golden ratio, **not** tied to how many levels have been accepted (the old scheme made the pool densest wherever acceptance was easy).
2. Reject if not solvable at `hitRadius + PLAYABLE_CLEARANCE` (`playable`, `:335`) — solvable-with-room, not merely solvable.
3. Reject if `interlock(cand) < MIN_INTERLOCK`.
4. `stripInert` removes walls whose removal leaves `reachable` unchanged, then **re-proves everything** — stripping a wall can move a corridor.
5. Reject if `pressure(cand, pf) < 0.205` (floor sits just under `Tangle`'s 0.241, so level 6 is a breather rather than a step backwards).
6. Score every pool entry with the **shared** `difficulty()` from `LevelValidator`, sort ascending, then sample position `i` as `pool[Math.round(Math.pow(i / (TARGET - 1), SKEW) * (pool.length - 1))]` and reassign `id: 'l' + (i + 6)`, `name: nameFor(i, TARGET)`.

Candidate shape (`makeCandidate`): `rows = Math.round(4 + t * 6)`, `h = round(0.05 + r() * 0.012)`, rows spanning `y` from `bottom = 0.8` up to `top = 0.16` with `±0.01` jitter, wall width `round(0.22 + t * 0.2 + r() * 0.12)` capped at `0.46`. Interlock rows are **reserved before anything else is rolled**: `want = Math.min(rows, 1 + Math.round(t * 4))`. Non-interlock kind roll: `<0.3 leftEdge`, `<0.5 axisRight`, `<0.68 rightEdge`, `<0.85 axisLeft`, else `gate` if `t > 0.35` else `leftEdge`. If no wall ends past `x = 0.5`, one is forcibly moved to `x: 0.5` (`:185-189`) — a level the player can read entirely off the screen is an ordinary obstacle-avoider.

The `interlock` row (`:95-128`) closes the corridor from both sides at the same height: `gap = 0.125 - t * 0.08 + r() * 0.025`, left wall `[0, a]`, right wall starting exactly on the axis so its reflection lands at `a + gap`. This is the row kind that makes the mirror the mechanic — 98 of 100 levels in an earlier set had the two halves never overlap in `y`.

Determinism: a fixed seed sequence means regenerating produces an identical file, so a diff shows real changes rather than reshuffled noise.

---

## Global name → module index

| symbol | module |
|---|---|
| `Ads` | `src/systems/Ads.ts:302` |
| `admobUnits` | `src/config/monetization.ts:173` |
| `adsConfigured` | `src/config/monetization.ts:182` |
| `AdUnits` | `src/config/monetization.ts:38` |
| `applyEntitlement` | `src/systems/Iap.ts:204` |
| `Audio` | `src/systems/Audio.ts:173` |
| `BASE_HEIGHT` | `src/render/Theme.ts:31` |
| `BASE_WIDTH` | `src/render/Theme.ts:30` |
| `BootScene` | `src/scenes/BootScene.ts:19` |
| `boundsOf` | `src/core/Geometry.ts:310` |
| `Box` | `src/render/HitArea.ts:41` |
| `buildFigure` | `src/render/InkRenderer.ts:319` |
| `buildRibbon` | `src/core/Ribbon.ts:118` |
| `button` | `src/render/UI.ts:186` |
| `ButtonOptions` | `src/render/UI.ts:169` |
| `CARD_SIZE` | `src/render/ShareCard.ts:28` |
| `CardOptions` | `src/render/ShareCard.ts:30` |
| `centredHitArea` | `src/render/HitArea.ts:37` |
| `chaikin` | `src/core/StrokeRecorder.ts:168` |
| `chaikinScalar` | `src/core/StrokeRecorder.ts:114` |
| `clamp` | `src/core/Geometry.ts:42` |
| `clearance` | `src/core/LevelValidator.ts:170` |
| `clonePoint` | `src/core/Geometry.ts:38` |
| `closedFigure` | `src/core/StrokeRecorder.ts:236` |
| `CollisionSystem` | `src/core/CollisionSystem.ts:24` |
| `COLUMN` | `src/render/UI.ts:372` |
| `CursorOptions` | `src/core/DrawCursor.ts:24` |
| `DEFAULT_RIBBON` | `src/core/Ribbon.ts:32` |
| `densify` | `src/core/StrokeRecorder.ts:140` |
| `densifyTimes` | `src/core/StrokeRecorder.ts:93` |
| `difficulty` | `src/core/LevelValidator.ts:275` |
| `dist` | `src/core/Geometry.ts:52` |
| `distPointToSeg` | `src/core/Geometry.ts:299` |
| `distSq` | `src/core/Geometry.ts:46` |
| `drawCursor` | `src/core/DrawCursor.ts:35` |
| `DrawnStroke` | `src/core/StrokeRecorder.ts:205` |
| `enter` | `src/render/UI.ts:349` |
| `FONT` | `src/render/UI.ts:41` |
| `GalleryScene` | `src/scenes/GalleryScene.ts:33` |
| `GameScene` | `src/scenes/GameScene.ts:77` |
| `GameSceneData` | `src/scenes/GameScene.ts:60` |
| `GENERATED_LEVELS` | `src/data/generatedLevels.ts:14` |
| `Haptics` | `src/systems/Haptics.ts:47` |
| `HitRect` | `src/render/HitArea.ts:26` |
| `Iap` | `src/systems/Iap.ts:197` |
| `IapService` | `src/systems/Iap.ts:33` |
| `inflate` | `src/core/Geometry.ts:85` |
| `InkRenderer` | `src/render/InkRenderer.ts:96` |
| `InkTheme` | `src/render/Theme.ts:46` |
| `Inset` | `src/core/Playfield.ts:12` |
| `interlock` | `src/core/LevelValidator.ts:207` |
| `interlockBands` | `src/core/LevelValidator.ts:234` |
| `isEmptyRect` | `src/core/Geometry.ts:97` |
| `label` | `src/render/UI.ts:113` |
| `Level` | `src/data/types.ts:23` |
| `levelAt` | `src/data/levels.ts:92` |
| `LEVELS` | `src/data/levels.ts:89` |
| `LevelSelectScene` | `src/scenes/LevelSelectScene.ts:35` |
| `lerpPoint` | `src/core/Geometry.ts:57` |
| `liveBox` | `src/render/HitArea.ts:58` |
| `MenuScene` | `src/scenes/MenuScene.ts:30` |
| `METRICS` | `src/render/Theme.ts:113` |
| `mirrorPath` | `src/core/Geometry.ts:78` |
| `mirrorPoint` | `src/core/Geometry.ts:74` |
| `mirrorX` | `src/core/Geometry.ts:64` |
| `monetization` | `src/config/monetization.ts:90` |
| `paintedBox` | `src/render/HitArea.ts:49` |
| `paintFigureInto` | `src/render/InkRenderer.ts:368` |
| `PLAYABLE_CLEARANCE` | `src/core/LevelValidator.ts:310` |
| `Playfield` | `src/core/Playfield.ts:19` |
| `pointInRect` | `src/core/Geometry.ts:102` |
| `pressure` | `src/core/LevelValidator.ts:320` |
| `Progress` | `src/systems/Progress.ts:304` |
| `PT` | `src/render/Theme.ts:38` |
| `pt` | `src/render/Theme.ts:40` |
| `RADIUS` | `src/render/UI.ts:67` |
| `Rate` | `src/systems/Rate.ts:38` |
| `Rect` | `src/core/Geometry.ts:20` (re-exported `src/data/types.ts:19`) |
| `renderPath` | `src/core/StrokeRecorder.ts:197` |
| `renderShareCard` | `src/render/ShareCard.ts:124` |
| `renderStroke` | `src/core/StrokeRecorder.ts:218` |
| `rgba` | `src/render/Theme.ts:104` |
| `Ribbon` | `src/core/Ribbon.ts:101` |
| `ribbonOutline` | `src/core/Ribbon.ts:161` |
| `RibbonOptions` | `src/core/Ribbon.ts:17` |
| `RibbonQuad` | `src/core/Ribbon.ts:94` |
| `roundRect` | `src/render/UI.ts:93` |
| `rule` | `src/render/UI.ts:302` |
| `SaveData` | `src/systems/Progress.ts:38` |
| `SavedFigure` | `src/systems/Progress.ts:27` |
| `ScrollRow` | `src/render/ScrollView.ts:41` |
| `ScrollView` | `src/render/ScrollView.ts:72` |
| `ScrollViewOptions` | `src/render/ScrollView.ts:64` |
| `segCircleEntryT` | `src/core/Geometry.ts:272` |
| `segRect` | `src/core/Geometry.ts:167` |
| `segRectEntryT` | `src/core/Geometry.ts:209` |
| `segSeg` | `src/core/Geometry.ts:138` |
| `setTheme` | `src/render/Theme.ts:98` |
| `Share` | `src/systems/Share.ts:104` |
| `ShareRequest` | `src/systems/Share.ts:29` |
| `softShadow` | `src/render/UI.ts:139` |
| `SPACE` | `src/render/UI.ts:58` |
| `StoreProduct` | `src/systems/Iap.ts:26` |
| `StrokeRecorder` | `src/core/StrokeRecorder.ts:13` |
| `TAP_SLOP` | `src/render/UI.ts:79` |
| `tappable` | `src/render/UI.ts:27` |
| `TextOptions` | `src/render/UI.ts:104` |
| `theme` | `src/render/Theme.ts:94` |
| `THEMES` | `src/render/Theme.ts:88` |
| `TUTORIAL_LEVELS` | `src/data/levels.ts:21` |
| `TYPE` | `src/render/UI.ts:49` |
| `ValidationResult` | `src/core/LevelValidator.ts:27` |
| `validateLevel` | `src/core/LevelValidator.ts:52` |
| `ValidatorOptions` | `src/core/LevelValidator.ts:39` |
| `Vec2` | `src/core/Geometry.ts:15` (re-exported `src/data/types.ts:19`) |
| `vec2` | `src/core/Geometry.ts:34` |
| `widthProfile` | `src/core/Ribbon.ts:48` |
| `wordmark` | `src/render/UI.ts:319` |

---

## See also

- [00-index.md](00-index.md) — map of this documentation set
- [01-architecture.md](01-architecture.md) — module graph and the layering rules
- [02-coordinate-system.md](02-coordinate-system.md) — the LOCKED normalized/pixel contract
- [03-geometry-collision.md](03-geometry-collision.md) — `Geometry` and `CollisionSystem` in depth
- [04-stroke-ribbon.md](04-stroke-ribbon.md) — sampling, smoothing, and the ribbon
- [05-rendering.md](05-rendering.md) — `InkRenderer`, `Theme`, `UI`, `ScrollView`, `ShareCard`
- [06-scenes.md](06-scenes.md) — scene lifecycles and transitions
- [07-levels-data.md](07-levels-data.md) — `Level` authoring and the shipped set
- [08-level-generation.md](08-level-generation.md) — `genLevels.ts` and `LevelValidator`
- [09-systems.md](09-systems.md) — `Progress`, `Audio`, `Haptics`, `Share`, `Rate`
- [10-monetization.md](10-monetization.md) — ad cadence, IAP, and the policy behind them
- [11-build-release.md](11-build-release.md) — Vite, Capacitor, and the iOS pipeline
- [12-testing.md](12-testing.md) — what each test file pins
- [14-glossary.md](14-glossary.md) — terms used across these docs
- [15-change-recipes.md](15-change-recipes.md) — step-by-step edits for common tasks
- [../README.md](../README.md) — narrative rationale for the design decisions
- [../SUBMIT.md](../SUBMIT.md) — submission checklist
