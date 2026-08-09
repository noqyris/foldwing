# Level Data Model & the Solvability Proof

## What this covers

The `Level` data contract (normalized coordinates, the mirror-projection rule, what
is LOCKED), how the shipped 100-level ladder is composed, and the whole of
`LevelValidator` — the BFS that proves each level finishable, the inflated-radius
second proof that it is finishable *by a hand*, and the five measurement functions
(`clearance`, `interlock`, `interlockBands`, `difficulty`, `pressure`) that order
and gate the set. Ends with a full invariant → test index.

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `src/data/types.ts` | 34 | `Level` interface + the LOCKED coordinate-system contract |
| `src/data/levels.ts` | 95 | `TUTORIAL_LEVELS` (5, hand-authored), `LEVELS`, `levelAt()` |
| `src/data/generatedLevels.ts` | 1751 | `GENERATED_LEVELS` — 95 levels, GENERATED OUTPUT, never hand-edit |
| `src/core/LevelValidator.ts` | 337 | `validateLevel`, `clearance`, `interlock`, `interlockBands`, `difficulty`, `pressure`, `PLAYABLE_CLEARANCE` |
| `src/core/Playfield.ts` | 87 | normalized ↔ pixels; supplies `axisX` to the validator |
| `src/core/CollisionSystem.ts` | 80 | the predicate the validator gates every cell and edge with |
| `src/data/levels.test.ts` | 262 | set composition, authoring invariants, solvability, playability, ramp |
| `src/data/quality.test.ts` | 94 | craft gates: no inert wall, no repeats, no overlaps, no slivers |
| `scripts/genLevels.ts` | 467 | produces `generatedLevels.ts` (detailed in `08-level-generation.md`) |

---

## 1. The `Level` contract

Verbatim, `src/data/types.ts:23-34`:

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

`Rect` and `Vec2` are re-exported from `src/core/Geometry` at `src/data/types.ts:19`
(`{ x, y, w, h }` and `{ x, y }`, `src/core/Geometry.ts:15-25`).

| Field | Space | Units | Range in shipped data | Notes |
| --- | --- | --- | --- | --- |
| `id` | — | string | `l1`…`l100` | unique; `l1`–`l5` tutorial, `l6`–`l100` generated. Used as the Progress key (`GameScene.ts:335`) |
| `name` | — | string | non-empty, unique | shown as `${index+1}. ${name}` (`GameScene.ts:666`) |
| `start` | full playfield | normalized, y down | x ∈ [0.071, 0.148], y ∈ [0.88, 0.92] | must satisfy x < 0.5 |
| `goal` | full playfield | normalized, y down | x ∈ [0.07, 0.4], y ∈ [0.07, 0.12] | reached when the stroke comes within `METRICS.goalRadius` px (`GameScene.ts:243`) |
| `walls` | full playfield | normalized | 2–14 rects per level; `h` ∈ [0.05, 0.061] (10 distinct values across the set) | authored on **both** halves; the right-half ones only ever constrain via the mirror |
| `parMs` | — | ms | — | **declared but never read anywhere in `src/` or `scripts/`. Dead field.** |

**Coordinate space (LOCKED, `src/data/types.ts:4-18`).** `x ∈ [0,1]` spans the *entire*
playfield width, `y ∈ [0,1]` the entire height, y growing downward. The mirror axis is
`x = 0.5`. Walls are authored in this full-width space — a wall at `x: 0.5, w: 0.38` sits
on the right half, which the player can never draw in.

Conversion happens exactly once, on level load, through `Playfield`
(`src/core/Playfield.ts:46-69`, called from `GameScene.ts:148-150` and from the validator
at `LevelValidator.ts:61,75-76`). For the shipped canvas (`BASE_WIDTH = 750`,
`BASE_HEIGHT = 1334`, `src/render/Theme.ts:30-31`; `METRICS.inset` = `pt(44)/pt(12)/pt(72)/pt(12)`
with `PT = 2`, `src/render/Theme.ts:38,206-210`):

| Quantity | Value (base px) |
| --- | --- |
| `pf.x`, `pf.y` | 24, 88 |
| `pf.w`, `pf.h` | 702, 1102 |
| `pf.right`, `pf.bottom` | 726, 1190 |
| `pf.axisX` | 375 |
| `METRICS.hitRadius` = `pt(2.6)` | 5.2 |
| `METRICS.goalRadius` = `pt(15)` | 30 |

So 1 normalized x unit = 702 px, 1 normalized y unit = 1102 px. The stroke's 5.2 px hit
radius is **0.00741 normalized in x** and **0.00472 normalized in y** — the amount every
wall is silently fattened by before any test.

---

## 2. The asymmetry projection rule

**Statement.** Let a wall occupy `x ∈ [a, b]` (i.e. `{x: a, w: b - a}`) over `y ∈ [c, d]`.
Because `mirror(p) = { x: 1 - p.x, y: p.y }` (`src/data/types.ts:11`; in pixels
`mirrorPoint`, `src/core/Geometry.ts:74-76`), the player's stroke at left-half position
`p` puts its reflection at `1 - p.x`. The reflection hits that wall when
`1 - p.x ∈ [a, b]`, i.e.

```text
  wall on [a, b] × [c, d]   forbids the drawn stroke from   x ∈ [1-b, 1-a]  for y ∈ [c, d]
```

Padded by the hit radius the forbidden band is actually
`x ∈ [1-b - 0.00741, 1-a + 0.00741]` over `y ∈ [c - 0.00472, d + 0.00472]`.

**Why one code path covers both halves.** `CollisionSystem.blocks` tests the segment and
its mirror against the **full** wall list (`src/core/CollisionSystem.ts:37-43`). A left-half
segment cannot physically reach a right-half wall and vice-versa, so no bookkeeping about
which wall belongs to which side is needed anywhere — including in the validator, which
reuses the same object (`LevelValidator.ts:62`).

**Consequences for authoring / editing:**

- A wall placed at `x: 0.5, w: W` projects onto `x ∈ [0.5 - W, 0.5]` — it eats the strip
  immediately left of the axis. A wall at `x: 1 - W, w: W` (right edge) projects onto
  `x ∈ [0, W]` — the left edge. Those two are the `axisRight` and `rightEdge` members of the
  generator's six-member row vocabulary (`RowKind` = `leftEdge`, `axisLeft`, `axisRight`,
  `rightEdge`, `gate`, `interlock`; `scripts/genLevels.ts:67`).
- A level whose walls are mirror-symmetric is **contentless**: every reflected constraint
  lands exactly on a visible one. Pinned false by `levels.test.ts:86-95`.
- A level with **no** wall crossing into the right half has no reflected constraint at all.
  Pinned by `levels.test.ts:97-102` (`w.x + w.w > 0.5` for at least one wall).
- The axis is a *soft wall*: the cursor is clamped to it, never rejected
  (`Playfield.clampToDrawable`, `src/core/Playfield.ts:81-86`, LOCKED). A stroke may slide
  along `x = 0.5` — which is exactly where a right-half wall's projection bites hardest.

---

## 3. The shipped ladder

### `TUTORIAL_LEVELS` — 5 hand-authored, LOCKED

`src/data/levels.ts:21-83`. The header comment (`levels.ts:4-16`) states the teaching arc;
measured values below come from running the shipped metrics against the shipped playfield.

| id | name | lines | walls | start → goal | `interlock` | `clearance` | `difficulty` | `pressure` | Teaches |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `l1` | First reflection | `levels.ts:22-31` | 2 | (0.14, 0.88) → (0.14, 0.12) | 0.0000 | ≥34 (capped) | 0.115 | 0.086 | the mirror exists and has its own obstacles |
| `l2` | Zigzag | `levels.ts:32-43` | 4 | (0.12, 0.90) → (0.12, 0.10) | 0.0000 | ≥34 (capped) | 0.158 | 0.142 | alternating sides force a weave |
| `l3` | Gate | `levels.ts:44-55` | 4 | (0.10, 0.90) → (0.40, 0.10) | 0.0000 | ≥34 (capped) | 0.158 | 0.110 | thread a gap that is only a gap on one side |
| `l4` | Sacrifice | `levels.ts:56-67` | 4 | (0.10, 0.90) → (0.10, 0.10) | 0.0000 | ≥34 (capped) | 0.158 | 0.190 | **the design thesis** — hug the far-left edge purely to save the mirror, then swing hard right |
| `l5` | Tangle | `levels.ts:68-82` | 7 | (0.08, 0.92) → (0.08, 0.08) | 0.1667 | 30.281 | 0.340 | 0.241 | all of the above compounded; first level where both halves bite at one height |

The zero-interlock of `l1`–`l4` is **deliberate and pinned** (`levels.test.ts:189-194`):
the tutorial teaches one half at a time, then `l5` puts them together. Do not "fix" it.

`l1`'s exact numbers are deep-equality-pinned at `levels.test.ts:40-49`; `l4.name` at
`levels.test.ts:50`; `l5.walls.length === 7` at `levels.test.ts:51`. The generator appends
and must never rewrite these (`levels.ts:17-20`).

### `GENERATED_LEVELS` — 95, generated output

`src/data/generatedLevels.ts:14`. Ids `l6` (line 16) … `l100` (line 1730). Shape of the file:

```text
lines 1-11    header comment: "GENERATED — do not edit by hand."
line  12      import type { Level } from './types';
line  14      export const GENERATED_LEVELS: readonly Level[] = [
lines 15-1750 95 object literals, id/name/start/goal/walls, all numbers rounded to 3 dp
line  1751    ];
```

- **Never hand-edit.** Regenerate with `npx vite-node scripts/genLevels.ts`
  (`scripts/genLevels.ts:448` writes the file wholesale). The generator is seeded and
  deterministic, so regenerating without a source change produces a byte-identical file.
- Every emitted level was already proved playable *inside* the generator at
  `hitRadius + PLAYABLE_CLEARANCE` (`scripts/genLevels.ts:335-344`) before being written.
- Measured across the 95: `interlock` ∈ [0.2000, 0.5021], mean 0.4243; `difficulty` rises
  monotonically 0.2532 (`l6`) → 0.8916 (`l100`).
- **The file's own header is stale.** Lines 4-7 claim the set is "ordered by measured
  pressure". It is not — `scripts/genLevels.ts:390,393` scores with `difficulty()` and sorts
  by that. See §8.

### `LEVELS` and `levelAt`

```ts
export const LEVELS: readonly Level[] = [...TUTORIAL_LEVELS, ...GENERATED_LEVELS];
```
`src/data/levels.ts:89` — 100 entries, tutorial first. Composition pinned at
`levels.test.ts:25-30`.

```ts
export function levelAt(index: number): Level {
  const n = LEVELS.length;
  return LEVELS[((index % n) + n) % n];
}
```
`src/data/levels.ts:92-95`. The double-modulo wraps in **both** directions, so negative
indices and overshoot both land in range instead of returning `undefined`. Callers that
also need the *canonical* index compute it themselves — `GameScene.ts:145-146` repeats the
same expression before calling `levelAt`, because the index is stored in `Progress` and an
out-of-range value there would surface as a crash in `MenuScene` (`MenuScene.ts:42-44`,
`Progress.ts:100`).

---

## 4. `validateLevel` — the proof

### Signatures (verbatim, `src/core/LevelValidator.ts:27-56`)

```ts
export interface ValidationResult {
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

export interface ValidatorOptions {
  /** Grid spacing in pixels. Smaller is slower and more permissive. */
  readonly cell?: number;
  readonly hitRadius?: number;
  readonly goalRadius?: number;
}

export function validateLevel(
  level: Level,
  pf: Playfield,
  opts: ValidatorOptions = {}
): ValidationResult
```

Defaults (`LevelValidator.ts:57-59`): `cell = 6`, `hitRadius = 5.2`, `goalRadius = 30`.
These duplicate `METRICS.hitRadius` and `METRICS.goalRadius` numerically but are **not read
from `Theme`** — see the trap in §4.4.

### 4.1 Algorithm

| Step | Lines | What it does |
| --- | --- | --- |
| 1 | `61-62` | `level.walls.map(pf.toScreenRect)`, then build a real `CollisionSystem(walls, hitRadius, pf.axisX)` |
| 2 | `64-66` | grid over the **drawable half only**: `cols = floor((pf.axisX - pf.x)/cell) + 1`, `rows = floor(pf.h/cell) + 1`, `at(c,r) = {x: pf.x + c*cell, y: pf.y + r*cell}` |
| 3 | `70-73` | `freeCell(c,r) = !collision.blocks(p, p)` — a **zero-length segment**, the identical predicate the game uses for "may the stroke be here" |
| 4 | `78-92` | `nearest(target, within)` — full grid scan for the closest free cell; `null` if the closest is farther than `within` |
| 5 | `94-101` | start cell within `cell * 2` px, else `reason: 'start is inside a wall'`; goal cell within `goalRadius` px, else `'goal is unreachable ground'` |
| 6 | `103-104` | third full grid sweep to count `free` |
| 7 | `106-142` | BFS, 8-neighbour, every **edge** gated by `collision.blocks(from, to)` |
| 8 | `144-146` | not found → `reason: 'no path from start to goal'` |
| 9 | `148-154` | walk `prev[]` back from goal, reverse, return the pixel path |

At the shipped playfield with `cell = 6`: **cols = 59, rows = 184, 10 856 cells**.

### 4.2 Why the validator can never be more permissive than the game

Both gates route through the *same* `CollisionSystem` instance built from the *same*
`Playfield`:

- **Cell gate**: `blocks(p, p)`. `segRect` accepts immediately when an endpoint is inside
  the wall inflated by `hitRadius` (`Geometry.ts:171`), so a cell is free iff neither `p`
  nor `mirror(p)` is inside any padded wall — the exact condition under which the game
  would let the stroke's centreline sit there.
- **Edge gate**: `blocks(from, to)` is the *continuous* segment test (`Geometry.ts:167-194`),
  so a BFS step is only taken if the player could actually draw that straight move,
  reflection included.

Therefore *reachable ⟹ drawable*. The converse is false, and deliberately so
(`LevelValidator.ts:17-19`): the grid is coarser than a finger, so a gap it cannot thread
may still be threadable by hand. **A level it passes is definitely solvable; a level it
fails might merely be very tight.**

Additional sources of conservatism (all safe-direction):

- The rightmost column is at `x = 24 + 58*6 = 372`, **3 px short of the axis at 375**. The
  validator never proves the player can use the last strip beside the mirror line, even
  though `clampToDrawable` permits it.
- The bottom row is at `y = 88 + 183*6 = 1186`, 4 px above `pf.bottom = 1190`.
- `nearest()` returns only *the single closest* free cell to the goal, not any free cell
  within `goalRadius`. If that one cell happens to be walled off while another within 30 px
  is reachable, the level is reported unsolvable.
- `segRect` pads with a **square** inflate, not a disc (`Geometry.ts:85-87`), so wall
  corners are stricter than a true circular hit radius.

### 4.3 What the return fields actually mean

- `path` is the BFS-tree path in **pixels**, one entry per grid cell, start-first. It is a
  reachability witness, not a nice route: 8-neighbour BFS with a fixed neighbour order
  (`dc = -1..1`, `dr = -1..1`, `LevelValidator.ts:128-129`) produces a deterministic but
  arbitrary-looking staircase. `l1` yields a 141-cell path.
- `free` is the honest total of free cells (`l1`: 9946 of 10 856).
- **`reachable` is NOT what its doc comment says.** The BFS `break`s the instant the goal is
  dequeued (`LevelValidator.ts:120-123`) and `reachable++` happens on dequeue
  (`LevelValidator.ts:119`), so `reachable` counts *cells expanded before and including the
  goal*, not the full reachable set. `l1` reports 8606 with `free = 9946`. The documented
  reading ("reachable/free near 1 means the level barely constrains",
  `LevelValidator.ts:33`) is therefore wrong. It is still a **deterministic fingerprint**,
  which is all `quality.test.ts:41-44` needs it to be — see §7.

### 4.4 Traps

| Trap | Where | Why it matters |
| --- | --- | --- |
| Defaults are hardcoded, not imported from `Theme` | `LevelValidator.ts:57-59` | Changing `METRICS.hitRadius` does **not** change validator defaults. Every caller in the test suite and generator passes them explicitly (`levels.test.ts:18-22`, `quality.test.ts:16`, `genLevels.ts:246-250`) — but `difficulty()` calls `clearance(level, pf)` with **no opts** (`LevelValidator.ts:279`), so difficulty silently keeps 5.2/30/6 if the theme moves. |
| Redundant cell check inside the BFS | `LevelValidator.ts:135` vs `:136` | `blocks(from, to)` already returns true whenever `to` is inside a padded wall, so `!freeCell(nc, nr)` is implied by the edge test. Harmless, but do not read it as an extra constraint. |
| Three full grid sweeps before the BFS | `:81-90` ×2, `:104` | `validateLevel` is ~3×(59·184) `blocks` calls plus the BFS. `clearance()` runs it up to 9 times; `difficulty()` up to 10. This is the dominant cost of `npm test`. |
| `start` cell tolerance is `cell * 2` | `:94` | 12 px at the shipped grid. A start dot buried 13 px inside a wall reports `'start is inside a wall'`, one 11 px inside silently snaps out. |
| Empty `path` on failure | `:96, :100, :145` | `difficulty()` consumes `route.path` without checking `solvable` (`:284-291`), so an unsolvable level yields `turns = 0`. |
| `prev` is `Int32Array(...).fill(-1)` | `:108` | `-1` is the terminator for path walk-back; a plain zero-init would loop forever at cell 0. |

---

## 5. `PLAYABLE_CLEARANCE` and the second proof

```ts
export const PLAYABLE_CLEARANCE = 6;
```
`src/core/LevelValidator.ts:310`. Units: **base pixels of extra collision radius**.

Rationale (`LevelValidator.ts:297-309`): at 0.52 css px per base px on a 390 pt-wide phone,
6 base px ≈ 3 css px of error margin on each side of the stroke — roughly a millimetre of
glass. The levels this rule was written to catch left 0.3 css px.

**The second proof** is the same BFS run with the collision radius inflated:

```ts
validateLevel(level, pf, { ...OPTS, hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE })
```
`levels.test.ts:144-147`, and identically inside the generator at `scripts/genLevels.ts:336-339`.
A level must survive it, i.e. the route must be wide enough that the stroke could be
`2 × 6 = 12` px fatter and still fit.

Key properties:

- Raising `PLAYABLE_CLEARANCE` can only ever **reject** levels; it can never make a level
  unsolvable in the game (`LevelValidator.ts:307-309`).
- "Solvable" and "playable" are separate gates with separate test blocks
  (`levels.test.ts:112-123` vs `:139-164`). The README calls this out at
  *Solvable is not the same as playable*.
- The measured minimum across the shipped 100 is **6.109** base px (see §6.1), against a
  test floor of `PLAYABLE_CLEARANCE = 6` and a ceiling of `PLAYABLE_CLEARANCE * 3 = 18`
  (`levels.test.ts:159,162`).

---

## 6. The five metrics

| Function | Returns | Units | Range | Cost | Used for |
| --- | --- | --- | --- | --- | --- |
| `clearance` | slack | base px of **extra** radius | `-1`, else `[0, max]` (default max 34) | ≤9 × `validateLevel` | precision demand; the playability floor |
| `interlock` | fraction | dimensionless | `[0, 1]` | 1001 y-samples × walls | how often both halves bite at one height |
| `interlockBands` | count | integer bands | `0 …` (measured 0–4 in the set: 0 for `l1`–`l4`, 1–4 for the rest) | 601 y-samples × walls | how many *separate* heights do it |
| `difficulty` | score | dimensionless | `[0, 1]` (effectively `[0.06, 1]`) | ≤10 × `validateLevel` | **the ordering key for the whole set** |
| `pressure` | fraction | dimensionless | `[0, 1]` | 1 grid sweep | descriptive density statistic only |

### 6.1 `clearance`

```ts
export function clearance(
  level: Level,
  pf: Playfield,
  opts: ValidatorOptions & { max?: number } = {}
): number
```
`src/core/LevelValidator.ts:170-189`.

- `base = opts.hitRadius ?? 5.2`; `ok(extra)` = `validateLevel(level, pf, { ...opts, hitRadius: base + extra }).solvable`.
- Returns `-1` immediately if `!ok(0)` — i.e. an unsolvable level (`:179`).
- Returns `hi` (default `34`) immediately if `ok(hi)` — **the value saturates**. `34` means
  "≥ 34", not "exactly 34" (`:181-182`).
- Otherwise 7 bisection steps on `[lo, hi]` and returns `lo` (`:183-188`). Resolution is
  `34 / 2^7 = 0.265625` px; every non-saturated result is a multiple of that.
- **`clearance()` measures extra radius, not corridor width.** The tightest corridor's
  half-width is `hitRadius + clearance`.
- The predicate `ok()` is *almost* monotone (inflating walls only removes free cells and
  edges) but not strictly: `nearest()` picks a single goal cell, and a larger radius can
  move that pick. In practice this has never bitten; treat a bisection result as
  ±0.265625 px.

Measured across `LEVELS` with `{cell: 6, hitRadius: 5.2, goalRadius: 30}`: **min 6.109375**,
max 34 (saturated; all four of `l1`–`l4` saturate, and so do generated `l6`, `l7`, `l8`,
`l10`, `l12`, `l17` — 10 of the 100). Generated levels 6–25 mean **30.202**; levels 81–100
mean **8.088**.

### 6.2 `interlock`

```ts
export function interlock(level: Level, samples = 1000): number
```
`src/core/LevelValidator.ts:207-231`. Samples `y = i / samples` for `i = 0 … samples`
inclusive — **1001 samples** at spacing 0.001. For each y, over every wall whose vertical
span contains y (`y >= w.y && y <= w.y + w.h`, inclusive both edges, `:217`):

```text
own       := min(0.5, w.x + w.w)       > max(0, w.x)                 // wall meets the drawable half
reflected := min(0.5, 1 - w.x)         > max(0, 1 - (w.x + w.w))     // its projection meets it
```

`any` counts heights with at least one of the two; `both` counts heights with both.
Returns `both / any`, or `0` when `any === 0` (`:230`).

Reading: **the fraction of constrained heights at which the corridor is bounded on one
side by something visible and on the other by something the player has to fold in their
head.** That is the only moment the mirror is the mechanic rather than decoration.

The doc comment (`:204-205`) records the historical failure: the build-5 set measured 0.4%
across 100 levels with 98 at exactly zero. The current generated set measures min 0.2000,
max 0.5021, mean 0.4243.

### 6.3 `interlockBands`

```ts
export function interlockBands(level: Level, samples = 600): number
```
`src/core/LevelValidator.ts:234-251`. Same `own`/`ref` predicates, 601 samples at spacing
1/600. Counts **rising edges** of `both` as y descends from 0 to 1 (`:247-248`), with
`inside` initialised `false`, so a band that starts at `y = 0` counts. Units: number of
separate interlocked heights. Measured: generated levels 6–25 mean 1.950, levels 81–100
mean 4.000. Across the 95 generated levels the histogram is 1 band ×1, 2 bands ×25,
3 bands ×49, 4 bands ×20.

`interlock` answers *how much*; `interlockBands` answers *how many distinct decisions*.
Both feed `difficulty`.

### 6.4 `difficulty` — the ordering key

```ts
export function difficulty(level: Level, pf: Playfield): number
```
`src/core/LevelValidator.ts:275-295`. Verbatim body structure:

```ts
const tight = clamp01(1 - clearance(level, pf) / 40);

const bands  = clamp01(interlockBands(level) / 4);
const mirror = 0.5 * bands + 0.5 * clamp01(interlock(level) / 0.6);

// turns := sign changes of dx along validateLevel(level, pf).path
const plan = 0.5 * clamp01(level.walls.length / 14) + 0.5 * clamp01(turns / 10);

return 0.4 * tight + 0.35 * mirror + 0.25 * plan;
```

| Axis | Weight | Formula | Saturates at |
| --- | --- | --- | --- |
| `tight` | 0.40 | `1 - clearance/40` | clearance 0 → 1; **clearance is capped at 34, so `tight` never falls below 0.15** |
| `mirror` | 0.35 | `0.5·min(bands/4,1) + 0.5·min(interlock/0.6,1)` | 4 bands, interlock 0.6 |
| `plan` | 0.25 | `0.5·min(walls/14,1) + 0.5·min(turns/10,1)` | 14 walls, 10 direction changes |

Weights sum to exactly 1.0, so the range is `[0, 1]`; the `tight` floor makes the practical
minimum `0.4 × 0.15 = 0.06`. Measured: `l1` = 0.1154, `l5` = 0.3395, `l6` = 0.2532,
`l100` = 0.8916.

`turns` (`:285-291`) counts sign changes of `Math.sign(path[i].x - path[i-1].x)` along the
**BFS path**, ignoring zero steps. It is deterministic but is a property of the BFS tree,
not of any route a human would draw. It is nonetheless a stable proxy for "how many
commitments the route contains".

Note the internal inconsistency: the comment at `:278` says "~40px of slack is as open as
this playfield gets", but `clearance`'s default `max` is 34 (`:181`), so the 40 divisor can
never be reached. Changing either number reorders the whole set.

### 6.5 `pressure` — descriptive only

```ts
export function pressure(level: Level, pf: Playfield, cell = 8): number
```
`src/core/LevelValidator.ts:320-337`. Builds its own `CollisionSystem` with a **hardcoded
5.2** hit radius (`:322`), sweeps a `cell = 8` grid over the drawable half
(44 × 138 = 6072 samples at the shipped playfield), and returns `blocked / total`.

Reading: the fraction of the drawable half the player is *not* allowed to use, counting the
squeeze from both the near walls and the reflected ones. Measured: `l1` = 0.0856,
`l100` = 0.4932; first-10 mean 0.1869, last-10 mean 0.4606.

---

## 7. Why `pressure` was abandoned as the sort key

Recorded at `LevelValidator.ts:256-261` and `levels.test.ts:212-221`, with the narrative in
README *Ordering by difficulty, not by density*:

- Sorting by `pressure` produced an order that tracked **wall count at ρ = 0.974** and
  tracked **`interlock` at ρ = −0.057**. The game was sorted by how *busy* a level looked,
  while the demand that makes it this game rather than an obstacle course stayed flat from
  level 6 to level 100.
- `pressure` is kept as a descriptive statistic — it is still asserted in aggregate
  (`levels.test.ts:206-210, 258-261`) where it is honest, and the generator still uses it as
  a *floor* to reject trivial candidates (`press < 0.205`, `scripts/genLevels.ts:362`; the
  floor sits just under `l5` Tangle's 0.2408, and `l6` lands at 0.2120 — a breather, not a
  step backwards).
- The monotonicity assertion moved to `difficulty()` (`levels.test.ts:222-228`).

**Why `difficulty()` is absolute, not pool-normalised** (`LevelValidator.ts:271-273`,
`scripts/genLevels.ts:380-391`): an earlier generator rank-normalised each axis across its
candidate pool. That reads well but **cannot be reproduced from the shipped 95** — the ranks
depend on which candidates happened to be generated, so no test could ever re-derive the
order from the shipped file. Making the score absolute means the generator and the test
suite compute the identical number, and `levels.test.ts:222-228` can check the shipped order
against the definition that produced it. Any change to the weights, divisors or `clamp01`
bounds in `difficulty()` invalidates the shipped ordering and will fail that test until
`generatedLevels.ts` is regenerated.

---

## 8. Invariant → test index

### `src/data/levels.test.ts`

Harness: `pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset)` (`:17`),
`OPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius }` (`:18-22`).

| Invariant | Assertion | Location |
| --- | --- | --- |
| exactly 5 tutorial levels | `TUTORIAL_LEVELS.length === 5` | `levels.test.ts:26` |
| exactly 95 generated levels | `GENERATED_LEVELS.length === 95` | `levels.test.ts:27` |
| exactly 100 shipped levels | `LEVELS.length === 100` | `levels.test.ts:28` |
| tutorial comes first | `LEVELS[0].id === 'l1'` | `levels.test.ts:29` |
| ids unique | `new Set(ids).size === LEVELS.length` | `levels.test.ts:34` |
| every level named | `l.name.length > 0` | `levels.test.ts:35` |
| **`l1` numbers LOCKED** | deep equality against the literal | `levels.test.ts:40-49` |
| `l4` is still "Sacrifice" | `TUTORIAL_LEVELS[3].name === 'Sacrifice'` | `levels.test.ts:50` |
| `l5` still has 7 walls | `TUTORIAL_LEVELS[4].walls.length === 7` | `levels.test.ts:51` |
| **start on drawable half** | `l.start.x < 0.5` | `levels.test.ts:59` |
| **goal on drawable half** | `l.goal.x < 0.5` | `levels.test.ts:60` |
| start/goal in bounds | `p.x >= 0`, `p.y >= 0`, `p.y <= 1` | `levels.test.ts:67-69` |
| wall left edge in bounds | `w.x >= 0` | `levels.test.ts:72` |
| walls have positive extent | `w.w > 0`, `w.h > 0` | `levels.test.ts:73-74` |
| walls inside playfield | `w.x + w.w <= 1.0001`, `w.y + w.h <= 1.0001` | `levels.test.ts:75-76` |
| **no level is mirror-symmetric** | 3-dp key set vs its `x → 1-x-w` image | `levels.test.ts:86-95` |
| **every level constrains the mirror** | some `w.x + w.w > 0.5` | `levels.test.ts:97-102` |
| **every level solvable** (per-level case) | `validateLevel(level, pf, OPTS).solvable` | `levels.test.ts:119` |
| the proof produced a real route | `result.path.length > 1` | `levels.test.ts:120` |
| **every level playable** (per-level case) | solvable at `hitRadius + PLAYABLE_CLEARANCE` | `levels.test.ts:144-151` |
| tightest level ≥ the floor | `min(clearance) >= PLAYABLE_CLEARANCE` | `levels.test.ts:159` |
| hard end has not gone soft | `min(clearance) < PLAYABLE_CLEARANCE * 3` | `levels.test.ts:162` |
| every generated level interlocks | `interlock(l) > 0.05` | `levels.test.ts:185` |
| tutorial teaches one half at a time | `interlock(l1..l4) === 0` | `levels.test.ts:191` |
| `l5` is the turn | `interlock(l5) > 0.1` | `levels.test.ts:193` |
| interlock is substantial, not marginal | mean over generated `> 0.2` | `levels.test.ts:199` |
| pressure rises across the set | `lastTen > firstTen * 1.8` | `levels.test.ts:209` |
| **generated set is monotone in `difficulty`** | `d[i] >= d[i-1] - 1e-9` | `levels.test.ts:222-228` |
| precision demand ramps | mean `clearance` of last 20 `< 0.6 ×` first 20 | `levels.test.ts:237-239` |
| mirror demand ramps | mean `interlockBands` of last 20 `> 1.4 ×` first 20 | `levels.test.ts:241-243` |
| no difficulty cliff | each 10-level band's mean clearance `> 0.55 ×` the previous band's | `levels.test.ts:246-256` |
| opens gently | `pressure(LEVELS[0]) < 0.12` | `levels.test.ts:259` |
| ends demanding | `pressure(LEVELS[99]) > 0.4` | `levels.test.ts:260` |

### `src/data/quality.test.ts`

Harness identical (`quality.test.ts:15-16`).

| Invariant | Assertion | Location |
| --- | --- | --- |
| baseline solvable before wall-removal probe | `base.solvable === true` | `quality.test.ts:36` |
| **no wall is inert** | for each wall `k`: `!(r.solvable && r.reachable === base.reachable)` | `quality.test.ts:38-46` |
| no two levels share a wall layout | 2-dp `x,y,w` key set, sorted, joined | `quality.test.ts:51-61` |
| every level name unique | `new Set(names).size === names.length` | `quality.test.ts:63-66` |
| no two walls overlap | `!(overlapX > 1e-6 && overlapY > 1e-6)` | `quality.test.ts:69-82` |
| no hairline wall | `w.h > 0.02` | `quality.test.ts:89` |
| no sliver wall | `w.w > 0.02` | `quality.test.ts:90` |

**On the inert-wall test.** The bar is strict on purpose (`quality.test.ts:27-29`): a wall
counts as inert only when the player can reach *exactly* as much ground without it, so a
wall that merely narrows a corridor is never flagged. Note that the quantity compared,
`reachable`, is the early-break expansion count (§4.3), not the true reachable-set size —
which makes the fingerprint *more* sensitive (it also notices when a wall changes the shape
of the route), and works in the test's favour. Note also that in practice the `r.solvable &&`
half of the conjunction is always true: removing a wall only frees cells and edges, and
across all 100 shipped levels no single-wall removal produces an unsolvable result. It is
not a theorem — `nearest()` picks one goal cell, and freeing cells can move that pick — so
the guard stays.

---

## 9. Contradictions and dead code found while reading

| Item | Location | Detail |
| --- | --- | --- |
| Stale header in generated file | `src/data/generatedLevels.ts:4-7` | claims ordering "by measured pressure"; the generator sorts by `difficulty()` (`scripts/genLevels.ts:390,393`) |
| Stale comment | `src/data/levels.ts:86-87` | same claim, "ordered by measured pressure" |
| Stale comment | `scripts/genLevels.ts:12-15` | "SORTED by how much of the drawable half they take away" |
| `reachable` doc vs behaviour | `LevelValidator.ts:31-33` vs `:117-123` | doc describes the full reachable set; code breaks at the goal |
| 40 vs 34 | `LevelValidator.ts:278-279` vs `:181` | `tight` divides by 40 but `clearance` saturates at 34, so `tight` floors at 0.15 |
| Dead field | `src/data/types.ts:33` | `parMs` is never read anywhere in `src/` or `scripts/` |
| Redundant check | `LevelValidator.ts:135` | `!freeCell(nc, nr)` is implied by the edge test on the next line |
| Hardcoded radii | `LevelValidator.ts:57-59, 322` | validator/`pressure` defaults duplicate `METRICS` numerically without importing them; `difficulty()` relies on those defaults |

---

## See also

- [02-coordinate-system.md](02-coordinate-system.md) — normalized space, the axis, `Playfield` conversions
- [03-geometry-collision.md](03-geometry-collision.md) — `segRect`, `segRectEntryT`, `CollisionSystem`, the continuous-test invariant
- [08-level-generation.md](08-level-generation.md) — `scripts/genLevels.ts`: row vocabulary, pool, skew, inert-wall stripping, naming
- [06-scenes.md](06-scenes.md) — `GameScene` level load, `LevelSelectScene` grid, `MenuScene` resume clamping
- [09-systems.md](09-systems.md) — `Progress` and how `LEVELS.length` bounds `unlockedIndex`
- [12-testing.md](12-testing.md) — how the suite is run and what it costs
- [13-api-reference.md](13-api-reference.md) — full exported-symbol index
- [../README.md](../README.md) — the rationale narrative (ordering by difficulty, solvable-vs-playable, the mirror mattering)
