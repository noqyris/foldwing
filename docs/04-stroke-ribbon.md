# Stroke Capture, Smoothing & the Ribbon

## What this covers

The full input-to-ink path: how pointer samples are recorded (`StrokeRecorder`), how
those raw samples become the polyline the player watches (`densify` → `chaikin`), how
per-sample timing is carried alongside so the nib can swell and thin (`densifyTimes` →
`chaikinScalar`), and how that timed polyline becomes drawable geometry (`Ribbon`).
Also: the win figure (`closedFigure`) and the hard rule that ink width is cosmetic only.

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `src/core/StrokeRecorder.ts` | 238 | Raw sample buffer + timing; `densify`/`chaikin` and their scalar twins; `renderPath`/`renderStroke`; `closedFigure`. |
| `src/core/Ribbon.ts` | 185 | `RibbonOptions`/`DEFAULT_RIBBON`, speed→width profile, quad+disc geometry, `ribbonOutline`. |
| `src/core/StrokeRecorder.test.ts` | 329 | Pins the sampling rule and the drawn-vs-tested distance bound. |
| `src/core/Ribbon.test.ts` | 168 | Pins width monotonicity, taper, smoothing, degenerate-input safety. |
| `src/core/Geometry.ts` | 326 | `clonePoint`, `distSq`, `dist`, `clamp`, `mirrorPath` — the only dependencies of both modules. |
| `src/render/Theme.ts` | 212 | `METRICS.sampleMinDist`, `renderMaxSpacing`, `smoothIterations`, `hitRadius`; `InkTheme.strokePt`. |
| `src/render/InkRenderer.ts` | 432 | The only production caller of `renderStroke` + `buildRibbon` in-game. |
| `src/render/ShareCard.ts` | 204 | Second production caller, on a plain 2D canvas for the 1080×1080 export. |
| `src/scenes/GameScene.ts` | 707 | Owns the `StrokeRecorder`; feeds `points`/`times` to collision and to the renderer. |

---

## 1. The one invariant everything else hangs off

`StrokeRecorder.points` holds the **raw** samples. Collision runs on those, and only
those. Every smoothing, densification and width computation in this document happens on
the way to the screen and is never fed back.

- `src/core/StrokeRecorder.ts:5-8` states it; `src/render/InkRenderer.ts:7-11` restates it
  from the renderer side; `src/core/Ribbon.ts:10-13` restates it from the ribbon side.
- `src/scenes/GameScene.ts:242` tests `this.collision.blocks(prev, cursor)` against the
  *pointer-derived* cursor, before any of this module runs.
- `src/core/CollisionSystem.ts` imports only `Geometry`. It does not import `Ribbon`,
  `StrokeRecorder`, or `Theme`'s `InkTheme`. There is no code path by which a wider nib
  reaches collision.

Why: smoothing the collision path would round off the player's corners and let a stroke
cut inside a wall it visibly clipped (`src/core/StrokeRecorder.ts:6-8`).

The obligation this creates runs the *other* way, and it is the reason `densify` exists:
the drawn line must never wander further than `METRICS.hitRadius` from the tested line,
or the player watches a stroke sail through a wall and survive. Pinned by
`src/core/StrokeRecorder.test.ts:233-274` (single flick case + 300 randomised strokes at
spacings from 4 px to 304 px).

---

## 2. `StrokeRecorder`

```ts
export class StrokeRecorder {
  private readonly raw: Vec2[] = [];
  private readonly stamps: number[] = [];
  private readonly minDistSq: number;

  constructor(minDist: number)
  begin(p: Vec2, tMs = 0): void
  push(p: Vec2, tMs = 0): boolean
  pushExact(p: Vec2, tMs = 0): void
  get points(): readonly Vec2[]
  get times(): readonly number[]
  get last(): Vec2 | undefined
  get count(): number
  clear(): void
}
```
`src/core/StrokeRecorder.ts:13-83`.

| Member | Line | Semantics |
| --- | --- | --- |
| `constructor(minDist)` | 26-28 | Stores `minDist * minDist`. The threshold is never re-derived, so `minDist` cannot be read back. |
| `begin(p, tMs)` | 31-36 | Truncates both arrays to length 0, then pushes one cloned point + one stamp. Never leaves an empty stroke. |
| `push(p, tMs)` | 44-50 | Rejects (returns `false`, records nothing) when `distSq(last, p) < minDistSq`. **Strictly less** — a sample exactly at the threshold is accepted (`StrokeRecorder.test.ts:43-48`). Returns `true` when accepted. With an empty buffer `last` is `undefined` and the sample is always accepted. |
| `pushExact(p, tMs)` | 57-60 | Bypasses the spacing rule entirely. |
| `points` / `times` | 62-69 | Live `readonly` views onto the internal arrays — **not copies**. They mutate under the caller on the next `push`. |
| `last` | 71-73 | Last *accepted* sample, not last offered. |
| `clear()` | 79-82 | `length = 0` on both arrays; the arrays themselves are `readonly` fields and are reused. |

### Traps

- **`stamps` is a parallel array, deliberately.** Not a field on `Vec2`
  (`src/core/StrokeRecorder.ts:15-22`): `raw` is handed straight to collision on every
  pointer move and must stay a plain `Vec2[]` with no per-sample allocation. Any change
  that fattens the point type pays that cost on the hot path.
- **Points are cloned on the way in** (`clonePoint`, lines 34/47/58). The caller may reuse
  a scratch `Vec2`. Pinned by `StrokeRecorder.test.ts:69-75`.
- **`push` returning `false` means "nothing was recorded"** — `times` did not grow either.
  `GameScene.ts:259-262` only redraws and rings gates when it returns `true`.
- Dropping a near-duplicate is safe *because* `METRICS.sampleMinDist === METRICS.hitRadius`
  (`Theme.ts:125,128`, pinned by `Theme.test.ts:93-98`): the rejected sample sits within
  the hit radius of one already tested. Raising `sampleMinDist` above `hitRadius` breaks
  that argument.

### Wiring in `GameScene`

| Site | Line | Note |
| --- | --- | --- |
| `new StrokeRecorder(METRICS.sampleMinDist)` | 119 | `pt(2.6)` = 5.2 base px. |
| `recorder.begin(this.startPx, this.time.now)` | 223 | Anchored on the **start dot**, not under the finger, so ink always begins where the level says. |
| `recorder.push(cursor, this.time.now)` | 259 | `cursor` is post-thumb-offset and post-clamp (`cursorFor`, lines 284-296). |
| `recorder.pushExact(contact, this.time.now)` | 301 | Exact wall contact point, so the ink terminates at the event. |
| `recorder.pushExact(entry, this.time.now)` | 330 | Exact goal-entry point. |
| `times` rebased to `t0` on save | 339-347 | Stored figures start at 0 ms. `widthProfile` only reads differences, so the rebase changes nothing visually; it keeps the persisted numbers small. |

Timestamps are Phaser scene time (`this.time.now`), i.e. milliseconds. The `tMs = 0`
defaults exist only for tests — production always passes a real clock.

---

## 3. The pipeline, in order

```text
pointer event
   │  DrawCursor (thumb lift) + Playfield.clampToDrawable      GameScene.cursorFor:284
   ▼
cursor : Vec2 ──► CollisionSystem.blocks(prev, cursor)         GameScene:242   ◄── RAW. no smoothing, ever.
   │
   ▼  StrokeRecorder.push  (reject if < sampleMinDist)         StrokeRecorder:44
raw : Vec2[]          times : number[]                          (parallel, index-for-index)
   │                     │
   │  densify(maxSpacing)│  densifyTimes(maxSpacing)            StrokeRecorder:140 / :93
   ▼                     ▼          ← SAME maxSpacing or the arrays desync
dense : Vec2[]        dense times
   │                     │
   │  chaikin(iters)     │  chaikinScalar(iters)                StrokeRecorder:168 / :114
   ▼                     ▼          ← SAME iters
DrawnStroke { points, times }                                   StrokeRecorder:205-208
   │
   ├──► mirrorPath(points, axisX)  → mirrored DrawnStroke       InkRenderer:66-68
   │        (times array is REUSED, not re-derived)
   ├──► closedFigure(points, axisX) → win-figure fill loop      StrokeRecorder:236
   │
   ▼  widthProfile(points, times, opts)  → half-widths          Ribbon:48
   ▼  buildRibbon → { quads[], discs[] }                        Ribbon:118
   ▼  Graphics.fillPoints / fillCircle                          InkRenderer:59-63
```

Production entry point in-game: `InkRenderer.drawnPath` (`src/render/InkRenderer.ts:35-37`)
calls `renderStroke(raw, times, METRICS.renderMaxSpacing, METRICS.smoothIterations)`.
Same call in `src/render/ShareCard.ts:148-153`.

### Constants that parameterise it

| Constant | Value | Location | Pinned by |
| --- | --- | --- | --- |
| `METRICS.renderMaxSpacing` | `pt(5)` = **10** base px | `Theme.ts:156` | `Theme.test.ts:114-119` (`=== pt(5)` and `<= pt(theme().strokePt)`) |
| `METRICS.smoothIterations` | **2** | `Theme.ts:176` | `Theme.test.ts:137-139` (`> 0` only) |
| `METRICS.sampleMinDist` | `pt(2.6)` = **5.2** | `Theme.ts:128` | `Theme.test.ts:93-98` |
| `METRICS.hitRadius` | `pt(2.6)` = **5.2** — LOCKED | `Theme.ts:125` | `Theme.test.ts:65-90` |
| `PT` | **2** | `Theme.ts:38` | `Theme.test.ts:28-33` |

---

## 4. `densify` and `densifyTimes`

```ts
export function densify(points: readonly Vec2[], maxSpacing: number): Vec2[]
```
`src/core/StrokeRecorder.ts:140-158`.

```ts
export function densifyTimes(
  points: readonly Vec2[],
  times: readonly number[],
  maxSpacing: number
): number[]
```
`src/core/StrokeRecorder.ts:93-111`.

Semantics:

- `steps = Math.ceil(Math.sqrt(distSq(a, b)) / maxSpacing)` per segment
  (`:148` and `:106` — identical expressions, which is what keeps the two outputs the
  same length).
- Emits `points[0]`, then per segment `steps - 1` interior points at `t = s / steps`
  followed by the segment's endpoint. Output length `= 1 + Σ max(1, steps_i)`
  (a zero-length segment gives `steps = 0`, the interior loop does not run, and the
  duplicate endpoint is still pushed).
- Every inserted point lies **exactly on** the source segment — this adds detail, never
  shape. Pinned by `StrokeRecorder.test.ts:181-187` (`distPointToSeg ≈ 0`).
- `densifyTimes` interpolates linearly with the same `s / steps`, so timestamps stay
  index-aligned with the densified points.
- Degenerate guard: `points.length < 2 || maxSpacing <= 0` → `densify` returns
  `points.map(clonePoint)` (`:141`), `densifyTimes` returns `[...times]` (`:98`).

### Why it exists

Chaikin's corner cut is proportional to the spacing it is handed. Raw pointer samples
during a flick land 80–300 px apart (`Theme.ts:147-155`). Without densify the *rendered*
line bows away from the raw path far enough to cross a wall the raw path cleared. This is
not a theory — `StrokeRecorder.test.ts:244-248` asserts the failure directly:
`chaikin(rawFlick, 2)` alone produces a point **further than `METRICS.hitRadius`** from
the raw polyline, and `renderPath` with densify does not.

### Traps

- `densify` and `densifyTimes` **must be called with the same `maxSpacing`**, or the
  point array and the time array end up different lengths and every width lands on the
  wrong sample. `renderStroke` (`:225-226`) is the only place that gets this right by
  construction.
- Both guard clauses can still desync the pair, because they bail on different arrays:
  `maxSpacing <= 0` with `points.length >= 2`, and `points.length < 2` with a `times`
  array of a different length — in either case `densify` returns `points.length` entries
  while `densifyTimes` returns `times.length` verbatim. Unreachable in production
  (`renderMaxSpacing` is 10 and the arrays are built in lockstep), reachable from a test
  or a new caller.
- `densifyTimes` iterates over `points.length`, not `times.length`, and reads
  `times[i] ?? 0`. A short `times` array therefore yields a correctly-sized output with
  zeros in the tail rather than a crash — relevant because `Progress`'s save validator
  checks only `Array.isArray(g.times)`, never length parity
  (`src/systems/Progress.ts:113-118`).

---

## 5. `chaikin` and `chaikinScalar`

```ts
export function chaikin(points: readonly Vec2[], iterations: number): Vec2[]
export function chaikinScalar(values: readonly number[], iterations: number): number[]
```
`src/core/StrokeRecorder.ts:168-186` and `:114-127`.

One pass, per segment `p→q`, emits the 1/4 and 3/4 points:

| Weights | Line (vector) | Line (scalar) |
| --- | --- | --- |
| `p * 0.75 + q * 0.25` | `:178` | `:120` |
| `p * 0.25 + q * 0.75` | `:179` | `:121` |

Both keep `current[0]` and `current[current.length - 1]` untouched, so the stroke still
starts on the start dot and ends at the goal (`:174`, `:181`; scalar `:118`, `:123`).

Exact length behaviour: a pass produces `1 + 2*(L-1) + 1 = 2L`. Both functions
`break` when `current.length < 3` (`:172`, `:117`), so paths of 0, 1 or 2 points pass
through unchanged. After `k` passes on `L ≥ 3` points the output is exactly `2^k · L`.
Pinned by `StrokeRecorder.test.ts:154-158` (10 → 20 → 40) and `:111-118` (short paths).

Because `densify` and `densifyTimes` produce equal lengths, `chaikin` and `chaikinScalar`
hit their `< 3` break at the same moment and stay aligned.

### Properties pinned by tests

| Property | Test |
| --- | --- |
| Endpoints preserved | `StrokeRecorder.test.ts:104-109` |
| `iterations = 0` is a no-op | `:120-123` |
| Source array not mutated (`points.map(clonePoint)` at `:169`) | `:125-133` |
| A straight line stays straight | `:135-138` |
| Output never leaves the source's bounding extremes; the apex is pulled in | `:140-152` |

### Why 2 iterations

`src/core/StrokeRecorder.ts:165-166`: two passes leave joins shallow enough that mitred
line joins are indistinguishable from round ones. Note the cost: at
`renderMaxSpacing = 10` and 2 passes, a 300 px raw segment becomes 31 densified points
and then **124** drawn points, with a post-pipeline gap of 2.5 px in the body and
0.625 px adjacent to each endpoint. Raising `smoothIterations` doubles the point count —
and therefore the quad and disc count — per pass.

---

## 6. `renderPath`, `renderStroke`, `DrawnStroke`

```ts
export function renderPath(
  raw: readonly Vec2[],
  maxSpacing: number,
  iterations: number
): Vec2[] {
  return chaikin(densify(raw, maxSpacing), iterations);
}

export interface DrawnStroke {
  readonly points: Vec2[];
  readonly times: number[];
}

export function renderStroke(
  raw: readonly Vec2[],
  times: readonly number[],
  maxSpacing: number,
  iterations: number
): DrawnStroke {
  return {
    points: chaikin(densify(raw, maxSpacing), iterations),
    times: chaikinScalar(densifyTimes(raw, times, maxSpacing), iterations),
  };
}
```
`src/core/StrokeRecorder.ts:197-228`, verbatim apart from the docstrings elided between
the three declarations.

- **Order is densify-then-smooth**, never the reverse. Smoothing first would already have
  bowed the line before any spacing bound applied.
- `renderPath` is the timing-free variant. It has **no production caller** — grep shows it
  only in `StrokeRecorder.ts` and `StrokeRecorder.test.ts`. It exists as the isolated
  subject of the distance-bound tests; `InkRenderer` and `ShareCard` both use
  `renderStroke`.
- `DrawnStroke.points` / `.times` are plain mutable arrays behind `readonly` fields.
  `InkRenderer` maps over them (`:344-348`, `:397-405`) rather than mutating.
- The reflection reuses `stroke.times` by reference (`InkRenderer.ts:67`,
  `:347`, `:397`). That is correct: `mirrorPoint` is `x ↦ 2·axisX − x`
  (`Geometry.ts:74-76`), an isometry, so consecutive distances are unchanged and
  `widthProfile` on the mirrored path returns the same numbers element for element. The
  reflection therefore has the identical nib profile to the stroke, which is what makes
  the win figure read as one drawing.

### The bound this section is here to protect

| Assertion | Test |
| --- | --- |
| Every drawn point is within `METRICS.hitRadius` of the raw polyline, at flick spacing | `StrokeRecorder.test.ts:233-242` |
| Chaikin *without* densify breaks that bound | `:244-248` |
| Bound holds over 300 pseudo-random 9-point strokes, spacing `4 + rand()*300` px | `:250-274` |
| `drawn[0]` and `drawn[n-1]` are deep-equal (`toEqual`) to the raw endpoints — fresh clones, not the same objects | `:276-280` |

If you change `renderMaxSpacing`, `smoothIterations`, or the order of operations, that
suite is what tells you whether the drawn line still tells the truth.

---

## 7. `closedFigure` — the win figure

```ts
export function closedFigure(points: readonly Vec2[], axisX: number): Vec2[] {
  return [...points.map(clonePoint), ...mirrorPath(points, axisX).reverse()];
}
```
`src/core/StrokeRecorder.ts:236-238`, verbatim.

- Output length is exactly `2 × points.length` (`StrokeRecorder.test.ts:296-299`).
- The mirror is walked **backwards**. That is the whole trick: forward+forward would join
  heel-to-heel across the middle and draw a bowtie; forward+reversed joins tip-to-tip and
  heel-to-heel and draws a butterfly (`StrokeRecorder.ts:230-235`).
- `.reverse()` is safe: `mirrorPath` (`Geometry.ts:78-80`) already returns a fresh array,
  so the in-place reverse cannot touch the caller's data. Pinned by
  `StrokeRecorder.test.ts:311-318`.
- Result is exactly symmetric: `fig[n-1-i].x === 2·axisX − fig[i].x` and
  `fig[n-1-i].y === fig[i].y` (`:301-309`).
- A stroke that rides the axis produces duplicated points rather than a degenerate error
  (`:320-328`). No dedupe pass exists.
- The loop is left **open** — the last point is `mirror(points[0])`, not `points[0]`.
  Every consumer closes it: `Graphics.fillPoints(..., true)` (`InkRenderer.ts:342`,
  `:393`) and `ctx.closePath()` (`ShareCard.ts:94`).

**It is applied to the SMOOTHED points, not the raw ones** — `InkRenderer.ts:326`,
`:378`, `ShareCard.ts:156` all pass `stroke.points` from `renderStroke`. The persisted
`SavedFigure` stores raw normalized points + times (`GameScene.ts:340-347`), and the
gallery/share path re-runs the identical `renderStroke` before `closedFigure`, so a
figure redrawn a month later is geometrically the same figure.

The fill uses the **centreline** loop, not the ribbon outline: `fillPoints(figure.map(rebase), true)`
at `InkRenderer.ts:341-342` and `fillPath(ctx, outline.map(place))` at `ShareCard.ts:176-177`.
The two ribbons are then painted on top and overhang that silhouette by a half-width —
which is why `winFillAlpha` is only `0.11` (`Theme.ts:80`).

---

## 8. `Ribbon` — options

```ts
export interface RibbonOptions {
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

export const DEFAULT_RIBBON: RibbonOptions = {
  baseWidth: 10,
  maxScale: 1.35,
  minScale: 0.45,
  fastSpeed: 2.2,
  taperPoints: 7,
  smoothPasses: 3,
};
```
`src/core/Ribbon.ts:17-39`, verbatim.

`baseWidth` is overridden at every production call site:

| Caller | Line | `baseWidth` |
| --- | --- | --- |
| `InkRenderer.nib()` | `:40-42` | `pt(theme().strokePt)` = `pt(5)` = **10** — identical to the default under the `paper` theme |
| `InkRenderer.buildFigure` | `:334-338` | `pt(t.strokePt)`, then spread with the caller's `Partial<RibbonOptions>` |
| `InkRenderer.paintFigureInto` | `:387-390` | `Math.max(1.5, pt(t.strokePt) * scale)` — the 1.5 px floor keeps a thumbnail ribbon visible |
| `ShareCard.paintRibbon` | `:104-107` | `pt(t.strokePt) * scale * (opts.nibScale ?? 1)` (`:173`) |

`Ribbon.test.ts:5` runs most assertions against `{ ...DEFAULT_RIBBON, taperPoints: 0, smoothPasses: 0 }`
so the raw speed→width mapping is observable without the taper and smoothing on top.

---

## 9. `widthProfile`

```ts
export function widthProfile(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions
): number[]
```
`src/core/Ribbon.ts:48-92`.

**Returns HALF-widths**, one per point. `half = opts.baseWidth / 2` (`:56`). Disc radius
and quad offset both use the value directly, so the visible full width is `2 × widths[i]`.

Four stages, in this order — the order is load-bearing:

**1. Per-sample speed, px/ms (`:60-65`)**

```ts
const dt = Math.max(1, (times[i] ?? 0) - (times[i - 1] ?? 0));
speed[i] = dist(points[i - 1], points[i]) / dt;
```
`speed[0] = speed[1] ?? 0` (`:65`) — the first sample inherits the second's speed.

The `Math.max(1, …)` floor is what keeps duplicate or non-monotonic timestamps from
producing `Infinity`/`NaN`. Pinned by `Ribbon.test.ts:54-62` (all timestamps identical →
every width finite and `>= 0`).

*Trap, derived from the shipped constants:* after `densify(10)` + 2 Chaikin passes the
post-pipeline gap is 2.5 px in the body of the stroke and 0.625 px next to each endpoint,
and `densifyTimes`/`chaikinScalar` scale `dt` by the same factors. The 1 ms floor
therefore only binds where the sub-interval `dt` falls under 1 ms. Simulating the exact
pipeline at 60 fps sample rate shows the floor changes no width in the body of the
stroke at any speed; it perturbs only indices `0..6` and the last six — entirely inside
the `taperPoints: 7` window that is already scaling them toward zero. Raising
`fastSpeed` past ~2.5, or lowering `renderMaxSpacing`, moves that boundary into the
visible body of the line.

**2. Speed → half-width (`:68-71`)**

```ts
const k = clamp(s / opts.fastSpeed, 0, 1);
return half * (opts.maxScale + (opts.minScale - opts.maxScale) * k);
```

Linear in `k`, clamped at both ends. With the defaults:

| Speed | `k` | half-width | full width (`baseWidth = 10`) |
| --- | --- | --- | --- |
| `0` px/ms (stopped) | 0 | `5 × 1.35` = 6.75 | **13.5 px** |
| `1.1` px/ms | 0.5 | `5 × 0.90` = 4.5 | 9.0 px |
| `≥ 2.2` px/ms | 1 | `5 × 0.45` = 2.25 | **4.5 px** |

Slow → thick, fast → thin. Pinned by `Ribbon.test.ts:34-40` (slow stroke thicker at the
midpoint than a fast one) and `:42-52` (never outside `half*minScale … half*maxScale`).

**3. Smoothing (`:73-79`)** — `smoothPasses` applications of the `[0.25, 0.5, 0.25]`
kernel over interior indices only. `next = widths.slice()` means index `0` and `n-1` are
never smoothed; the write-back loop copies `next` over `widths` before the next pass, so
passes are sequential, not simultaneous-then-merged. Purpose: one slow frame is a jitter,
not an intention (`:44-46`). Pinned by `Ribbon.test.ts:73-86` — injecting a single 120 ms
stall reduces the width spread with `smoothPasses: 4` versus `0`.

**4. Taper (`:83-89`)** — applied *after* smoothing, so it cannot be smoothed away.

```ts
const taper = Math.min(opts.taperPoints, Math.floor(n / 2));
for (let i = 0; i < taper; i++) {
  const k = (i + 1) / (taper + 1);
  const f = k * k * (3 - 2 * k);
  widths[i] *= f;
  widths[n - 1 - i] *= f;
}
```

- `f` is smoothstep. Squared falloff reads as a pen leaving paper; linear reads as a
  cut-off (`:81-82`).
- `k` never reaches 1, so even the innermost tapered sample is scaled slightly below its
  smoothed width.
- **The `Math.floor(n / 2)` cap is not a nicety.** Without it, `i` and `n - 1 - i` would
  overlap on a short path and those samples would be multiplied by `f` twice, squaring
  the falloff and pinching the middle of a short stroke to nothing. With the cap,
  `i < n/2 ≤ n-1-i` always holds and no index is touched twice.
- Pinned by `Ribbon.test.ts:64-71`: both ends thinner than the middle, and symmetric on a
  uniform-speed stroke.

Degenerate returns: `n === 0` → `[]`; `n === 1` → `[opts.baseWidth / 2]`
(`:54-57`, pinned by `Ribbon.test.ts:19-22`). Note the single-point case skips the taper,
so a one-point stroke draws a full-size disc.

---

## 10. `buildRibbon` — quads + discs

```ts
export interface RibbonQuad {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly c: Vec2;
  readonly d: Vec2;
}

export interface Ribbon {
  /** One quad per segment, in order. */
  readonly quads: RibbonQuad[];
  /** A disc at every sample, which is what rounds the joins and the caps. */
  readonly discs: { readonly p: Vec2; readonly r: number }[];
}

export function buildRibbon(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions = DEFAULT_RIBBON
): Ribbon
```
`src/core/Ribbon.ts:94-154`.

### Construction

```text
segment i  :  p = points[i]        q = points[i+1]
              wp = widths[i]       wq = widths[i+1]     (HALF-widths)
              d  = q - p           len = hypot(d)       skip if len < 1e-9   [Ribbon.ts:137]
              n̂  = (-dy/len, dx/len)                     unit normal to d    [Ribbon.ts:140-141]

                          + n̂ side
             a ●══════════════════════════● b            a = p + n̂·wp
               ║                          ║              b = q + n̂·wq
               ║                          ║
        p ●····╫··········►···············╫····● q       centreline (the TESTED line)
               ║           d              ║
               ║                          ║
             d ●══════════════════════════● c            d = p − n̂·wp
                          − n̂ side                       c = q − n̂·wq

  winding: a → b → c → d   (one closed convex quad per segment)
```

Whole strip, 4 points → 3 quads + 4 discs:

```text
                     p0        p1              p2                p3
                      ●─────────●───────────────●─────────────────●
    quads         [ ── Q0 ── ][ ─── Q1 ─── ][ ────── Q2 ────── ]
    discs         (r0)      (r1)          (r2)                (r3)     r_i = widths[i]

    at a turn:                    ┌───────┐
                          a───────┤ Q1    │           Q0.b and Q1.a are NOT the
                          │  Q0   │       │           same point once the direction
                          d───────┤  ( r1 )  ◄────    changes — the disc at p1 fills
                                  └───────┘           the wedge and rounds the join
```

- `discs` is built first, over **all** points, including the endpoints of skipped
  zero-length segments (`:127-129`). That is why the ink stays continuous even when a
  segment is dropped.
- `r: Math.max(0, widths[i])` (`:128`) is defensive; `widthProfile` cannot return a
  negative under any `RibbonOptions` with positive scales.
- `quads.length === points.length - 1` **minus** the number of degenerate segments.
  Pinned by `Ribbon.test.ts:90-95` (8 points → 7 quads, 8 discs) and `:97-108`
  (a duplicated point → 1 quad, all coordinates finite).

### Why quads + discs, not one outline polygon

`src/core/Ribbon.ts:108-117`: a single offset polygon self-intersects at a sharp turn —
the two offset sides cross, and a triangulator fills the knot inside-out and punches a
hole through the stroke. Overlapping quads plus a disc per joint cannot produce that
error; they only overlap, which at full opacity is invisible. Pinned by the hairpin case,
`Ribbon.test.ts:145-153`.

The direct consequence for the renderer: **the ribbon must be painted at alpha 1**.
Phaser applies a `Graphics` object's alpha per draw command, not to the finished result,
so every overlap composites again — `src/render/InkRenderer.ts:70-94` records a measured
0.45 accumulating to 0.95–0.97. The reflection is dimmed by pre-blending its *colour*
toward the paper (`veil`, `:86-94`) instead. `paintRibbonAlpha` (`:419-432`) deliberately
breaks that rule for gallery thumbnails, where the beading is sub-pixel (`:411-418`).
`ShareCard` breaks it too — its mirrored ribbon is painted with
`ctx.fillStyle = cssRgba(t.ink, t.mirrorAlpha)` (`ShareCard.ts:179-180`) rather than
through `veil` — so the same overlap-accumulation applies on the 2D canvas.

### Traps

- **`discs[i].p` aliases `points[i]`** — `buildRibbon` does not clone it (`:128`).
  Mutating a disc's `p` mutates the caller's path. `quads` corners are fresh objects.
- Consumers skip hairline discs: `if (d.r > 0.25)` in `InkRenderer.ts:62` and `:430`,
  `if (d.r <= 0.25) continue` in `ShareCard.ts:110`. Three separate copies of the same
  threshold; changing one and not the others makes the tapered tips disagree between the
  live figure, the thumbnail, and the shared PNG.
- `opts` defaults to `DEFAULT_RIBBON` (`:121`). A caller that forgets to pass
  `baseWidth: pt(theme().strokePt)` silently gets 10, which happens to be right today
  and will be wrong the moment a cosmetic ink pack ships a different `strokePt`.
- Both `[]` and `[p]` inputs are safe: `Ribbon.test.ts:128-138`.

---

## 11. `ribbonOutline`

```ts
export function ribbonOutline(
  points: readonly Vec2[],
  times: readonly number[],
  opts: RibbonOptions = DEFAULT_RIBBON
): Vec2[]
```
`src/core/Ribbon.ts:161-185`.

- Uses a **central** difference for the tangent — `prev = points[max(0, i-1)]`,
  `next = points[min(n-1, i+1)]` (`:171-172`) — where `buildRibbon` uses a per-segment
  forward difference. The two therefore do not produce identical offsets.
- Emits one left and one right point per non-degenerate sample and returns
  `[...left, ...right.reverse()]` (`:184`). The `continue` at `:176` skips both sides
  together, so the two halves always stay balanced. Length `= 2 × (non-degenerate points)`
  (`Ribbon.test.ts:157-160`, 6 points → 12).
- Safe on duplicate points (`Ribbon.test.ts:162-167`).

**Dead code.** Its docstring (`:156-160`) says "Used for the win figure's fill", but grep
across `src/` and `scripts/` finds `ribbonOutline` only in `Ribbon.ts` and
`Ribbon.test.ts`. The win figure's fill actually uses `closedFigure` — the centreline
loop — at `InkRenderer.ts:326,341-342` and `ShareCard.ts:156,176-177`. Treat the docstring
as stale, not as a spec.

---

## 12. Ribbon width is cosmetic — where that is guaranteed

Stated in three places (`Ribbon.ts:10-13`, `InkRenderer.ts:7-11`, `Theme.ts:9-12`), and
structurally enforced by:

1. `CollisionSystem` takes `hitRadius` as a constructor parameter
   (`src/core/CollisionSystem.ts:30-34`) and imports nothing from `Ribbon` or `Theme`.
2. `GameScene` constructs it with `METRICS.hitRadius`, never with anything derived from
   `InkTheme` (`src/scenes/GameScene.ts:151`).
3. `hitRadius` lives on `METRICS` (`Theme.ts:125`), not on `InkTheme` (`Theme.ts:46-69`).
   `Theme.test.ts:84-89` asserts `Object.keys(theme())` does **not** contain `hitRadius` —
   the anti-pay-to-win guarantee, pinned as a test rather than a promise.
4. `widthProfile` output flows only into `RibbonQuad` corners and disc radii, both of
   which are consumed exclusively by `Graphics`/`CanvasRenderingContext2D` fill calls.

Consequence worth knowing before shipping a wide nib (`Theme.ts:14-17`, and quantified by
`Theme.test.ts:79-83`): collision is measured from the centreline at 5.2 base px while a
`strokePt: 5` nib reaches only 5.0 px from it, so the kill boundary sits **0.2 base px
outside** the visible ink. A fatter nib does not survive anything a thin one would not —
it just renders ink over a wall it legally cleared. The `maxScale: 1.35` end of the
ribbon already pushes the drawn half-width to 6.75 px, past the 5.2 px hit radius, on any
slow stroke.

---

## See also

- [01-architecture.md](01-architecture.md) — where `core/` sits relative to `render/` and `scenes/`.
- [02-coordinate-system.md](02-coordinate-system.md) — `pt()`, `BASE_WIDTH/HEIGHT`, `Playfield` normalization used by `SavedFigure`.
- [03-geometry-collision.md](03-geometry-collision.md) — `Geometry` primitives, `CollisionSystem`, the LOCKED continuous-collision rule.
- [05-rendering.md](05-rendering.md) — `InkRenderer`, `veil`, `buildFigure`, `ShareCard`.
- [06-scenes.md](06-scenes.md) — `GameScene`'s phase machine around the recorder.
- [09-systems.md](09-systems.md) — `Progress.SavedFigure` persistence of points + times.
- [12-testing.md](12-testing.md) — how `vitest` is configured and which invariants are pinned.
- [13-api-reference.md](13-api-reference.md) — flat export index.
- [14-glossary.md](14-glossary.md) — nib, ribbon, fold, figure.
- [15-change-recipes.md](15-change-recipes.md) — safe ways to retune smoothing or the nib.
- [../README.md](../README.md) — narrative rationale for the smoothed-render / raw-collision split.
