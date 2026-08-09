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

# Geometry & Collision

## What this covers

The pure math core: `Geometry.ts` (unit-agnostic 2D primitives, no Phaser),
`CollisionSystem.ts` (stroke + its reflection vs the full wall list), and
`DrawCursor.ts` (finger→ink offset). Includes the two independent
segment-vs-rect implementations and the property tests that pin them against
each other, plus the invariants a naive edit will break.

## Source files

| Path | Lines | Role |
|---|---|---|
| `src/core/Geometry.ts` | 326 | All 2D math. Pure functions on plain numbers. Zero imports. |
| `src/core/CollisionSystem.ts` | 80 | Class. Segment + mirrored segment vs every wall rect. |
| `src/core/DrawCursor.ts` | 40 | One pure function: pointer position → ink position. |
| `src/core/Geometry.test.ts` | 435 | 60 `it(` cases incl. 68 000 cross-check iterations. |
| `src/core/CollisionSystem.test.ts` | 134 | Mirror semantics, hit-radius symmetry, `blocks`↔`firstHitT` agreement. |
| `src/core/DrawCursor.test.ts` | 118 | Sign, monotonicity, travel-gating, shipped-metric pin. |
| `src/scenes/GameScene.ts` | (see 06) | Sole runtime consumer: lines 151, 210, 242–257, 284–296. |
| `src/core/LevelValidator.ts` | 337 | Second consumer, build/test time only (`scripts/genLevels.ts`, `src/data/levels.test.ts`, `src/data/quality.test.ts`): BFS solver gating every cell/edge through `CollisionSystem`. |

---

## 1. Types and module contract

```ts
export interface Vec2 { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }
```
`src/core/Geometry.ts:15` and `:20`. `Rect` is **origin + extent**, not
min/max — `inflate` and every slab computation assume `x + w` is the far edge.
Negative `w`/`h` is a legal but *empty* rect (see `isEmptyRect`).

`Geometry.ts` imports nothing. That is deliberate (`Geometry.ts:2-13`): the same
code path serves the player's stroke and its mirror, and the whole file is
testable without a browser. **Do not add a Phaser, Theme, or Playfield import
here** — normalized↔pixel conversion lives in `Playfield` (`src/core/Playfield.ts:46-69`)
and metric constants live in `Theme` (`src/render/Theme.ts:113-212`).

### EPS

```ts
const EPS = 1e-9;                                    // Geometry.ts:32
```
Module-private, not exported. Used four times, and **not uniformly**:

| Site | Compared quantity | Effective threshold |
|---|---|---|
| `Geometry.ts:231`, `:248` | `Math.abs(dx)`, `Math.abs(dy)` — a *length* | 1e-9 px |
| `Geometry.ts:287` | `aa` = squared segment length | 3.16e-5 px of length |
| `Geometry.ts:303` | `lenSq` = squared segment length | 3.16e-5 px of length |

Harmless at the 0..1500 px gameplay scale (`Geometry.ts:28-31`), but a reader
porting these to another unit scale must know two of the three are squared.

---

## 2. Geometry.ts — every exported symbol

Signatures verbatim. All are O(1) unless noted.

### Scalar / point helpers

```ts
export function vec2(x: number, y: number): Vec2                      // :34
export function clonePoint(p: Vec2): Vec2                             // :38
export function clamp(v: number, lo: number, hi: number): number      // :42
export function distSq(a: Vec2, b: Vec2): number                      // :46
export function dist(a: Vec2, b: Vec2): number                        // :52
export function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2          // :57
```

| Fn | Semantics / edge cases |
|---|---|
| `clamp` | Ternary chain, no `Math.min/max`. Both comparisons are false for `NaN`, so `clamp(NaN, lo, hi)` returns `NaN` — it does not sanitise. Closed interval pinned at `Geometry.test.ts:33-39`. |
| `distSq` | Use in hot loops to avoid `sqrt`. `StrokeRecorder` compares against `minDistSq` (`src/core/StrokeRecorder.ts:46`). |
| `lerpPoint` | **t is NOT clamped** (`Geometry.ts:56`). `GameScene` feeds it a `t` already known to be in [0,1] from `firstHitT`/`segCircleEntryT`. |
| `clonePoint` | The only defence against aliasing: `StrokeRecorder` clones every point it stores or hands out (`StrokeRecorder.ts:34,47,58,141,143,154,169,237`), because callers pass it objects they keep — e.g. `GameScene.ts:223` seeds a stroke with `this.startPx`. |

### Mirror

```ts
export function mirrorX(x: number, axisX: number): number             // :64
export function mirrorPoint(p: Vec2, axisX: number): Vec2             // :74
export function mirrorPath(points: readonly Vec2[], axisX: number): Vec2[]  // :78  O(n)
```

Three properties the rest of the game leans on (`Geometry.ts:68-73`):

1. **Involution** — `mirror(mirror(p)) === p`. Pinned `Geometry.test.ts:65-73` (500 seeded samples, `toBeCloseTo(…, 10)` on x, exact on y).
2. **y is never touched** — pinned `Geometry.test.ts:75-77`.
3. **Isometry ⇒ parameterisation-preserving.** A `t` measured on a mirrored segment names the same instant of the gesture as a `t` on the original. This is the *only* reason `CollisionSystem.firstHitT` can `min()` the two sides together (`CollisionSystem.ts:45-54`). If the mirror ever gained a scale or a non-vertical axis, `firstHitT` silently returns wrong parameters.

`mirrorPath` allocates a new array and new points; it does not mutate the source
(pinned `Geometry.test.ts:79-87`).

### Rects

```ts
export function inflate(r: Rect, pad: number): Rect                   // :85
export function isEmptyRect(r: Rect): boolean                         // :97
export function pointInRect(p: Vec2, r: Rect, pad = 0): boolean       // :102
```

- `inflate` grows **all four sides** by `pad`: `w + pad*2`, `h + pad*2`.
- `pointInRect` is **inclusive on all four edges** (`Geometry.ts:101`). A point exactly on the boundary is inside — `Geometry.test.ts:98-102`.
- `isEmptyRect` is the negative-pad guard. Its comment (`Geometry.ts:89-96`) explains the WHY: a rect shrunk past zero **inverts**, and the four-edge test in `segRect` would happily report crossings of a region containing no points, disagreeing with `pointInRect`. The game never passes a negative pad (`hitRadius` is always positive), but the predicate must stay coherent over its whole domain because a grid validator eroding cells will use it. Pinned `Geometry.test.ts:117-122` and `:131-156`.

### segSeg

```ts
export function segSeg(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean  // :138
```

CCW orientation test using module-private `orient` (`:117`, twice the signed
area of a triangle) and `withinSegBounds` (`:122`, bbox containment, only
meaningful when collinear).

Structure: proper-crossing branch (`:144-149`, requires strictly opposite signs
on **both** pairs), then four collinear/touching branches (`:151-154`).

**The degenerate branches are load-bearing, not pedantry** (`Geometry.ts:131-137`).
The textbook three-line version reports "no hit" when a segment lies exactly
along an edge — which is exactly what a player dragging along the flat top of a
wall produces. Pinned by:

| Case | Test |
|---|---|
| shared endpoint | `Geometry.test.ts:172-174` |
| T junction | `:176-178` |
| overlapping collinear | `:180-183` |
| disjoint collinear rejected | `:185-187` |
| collinear touching at one point | `:189-191` |
| degenerate point on a segment | `:193-196` |

Zero-length-segment note: when `p1 === p2`, `d3` and `d4` are identically 0, so
the last two branches reduce to "is `p3`/`p4` the same point". The first two
branches carry the real test.

### segRect — implementation A (orientation)

```ts
export function segRect(a: Vec2, b: Vec2, r: Rect, pad = 0): boolean   // :167
```

Algorithm, in order:

1. `e = inflate(r, pad)`; bail `false` if `isEmptyRect(e)` (`:168-169`).
2. Accept if **either endpoint** is inside `e` (`:171`).
3. Cheap AABB separating-axis reject (`:175-176`) — *pure speed, no semantics*: a segment whose bbox misses `e` cannot touch it.
4. `segSeg` against all four edges of `e`, whose corners are built as `tl/tr/br/bl` (`:183-186`) and walked in order (`:188-193`).

Steps 2 and 4 together are **exhaustive**: a segment meeting the rect either
crosses its boundary or lies wholly inside it (`Geometry.ts:159-166`).

Behaviour matrix (all pinned in `Geometry.test.ts:199-295`):

| Input | Result | Test line |
|---|---|---|
| ends exactly on the edge (`y=200` on wall top `200`) | `true` | `:227-229` |
| stops at `y=199.9` | `false` | `:223-225` |
| pad 5 vs 4.9 across a 5px gap | `true` / `false` | `:231-236` |
| collinear with the top edge | `true` | `:238-241` |
| clips only the `(100,200)` corner | `true` | `:243-248` |
| zero-length segment inside / outside / inside-with-pad | `true`/`false`/`true` | `:250-254` |
| zero-area rect `{w:0,h:0}` hit by a line through it | `true` | `:256-261` |

**LOCKED rule 2 — no tunnelling.** `Geometry.test.ts:263-294` is the anti-tunnel
suite: 1000px vertical swipe across an 8px wall, fast diagonal, near-horizontal
graze, plus 2000 seeded random crossings tested in **both** argument orders.

### segRectEntryT — implementation B (slab clipping)

```ts
export function segRectEntryT(
  a: Vec2,
  b: Vec2,
  r: Rect,
  pad = 0
): number | null                                                       // :209
```

Liang–Barsky slab clipping, exact for axis-aligned rects.

- Bounds computed **directly** from `r` and `pad` (`:215-218`), not via `inflate`.
- Inversion guard duplicated as `minX > maxX || minY > maxY` (`:223`) — algebraically identical to `isEmptyRect(inflate(r,pad))` since `minX > maxX ⟺ w + 2·pad < 0`. Without it the swap at `:238-242` would re-order the reversed bounds into a valid interval and report entry into empty space (`:220-222`).
- Degenerate-axis branches (`:231-234`, `:248-249`): when `|d| < EPS` the segment cannot leave that slab, so it only survives if `a` already lies inside it.
- Returns `t0` (`:263`), which starts at `0` (`:228`) and only ever increases toward `t1 ≤ 1` ⇒ **the return value is always in [0,1]**.
- Returns `0` when `a` is already inside — no slab pushes `t0` above its initial `0`. Stated in the docstring at `:206`, pinned `Geometry.test.ts:300-302`.

Contract with A (`Geometry.ts:206-207`):

```text
segRect(a,b,r,pad) === (segRectEntryT(a,b,r,pad) !== null)
```

### Why both exist

| | `segRect` | `segRectEntryT` |
|---|---|---|
| Question | "did it hit" | "where did it hit" |
| Algorithm | orientation / CCW tests | slab (Liang–Barsky) clipping |
| Path | hot — every pointermove, and every BFS edge in the validator | cold — only after a hit is already known |
| Runtime caller | `CollisionSystem.sideBlocked` (`CollisionSystem.ts:76`) | `CollisionSystem.firstHitT` (`:62`, `:65`) |
| Early exit | yes, first hit wins | **no** — must scan all walls for the minimum |

They are **two independent implementations of the same predicate**. Cross-checking
them is the closest thing to a proof this codebase can run: a bug in either would
have to be duplicated in the other to survive (`Geometry.test.ts:329-334`).

Cross-check tests:

| Test | Iterations | Domain | Line |
|---|---|---|---|
| random continuous | 30 000 | random rects, `pad = r()*10` | `Geometry.test.ts:335-349` |
| integer grid, sandwiched | 30 000 | 10px lattice, `pad ∈ {0,10,20}`, `d = 1e-6` | `:357-373` |
| negative pads | 8 000 | `pad = r()*40 - 30` (spans shrink-to-empty) | `:146-155` |

**The grazing caveat.** On an integer lattice, exact tangency (corner clips,
collinear edges) stops being measure-zero and the two algorithms may legally
disagree **by one ULP**. The integer test therefore sandwiches the comparison
with `d = 1e-6` rather than asserting equality (`:351-356`). Consequence for
runtime code: `blocks()` can be `true` while `firstHitT()` is `null` in that
1e-6 band — which is why `GameScene.ts:246` reads

```ts
const hitT = this.collision.firstHitT(prev, cursor) ?? 0;
```

The `?? 0` is not defensive noise; it is the fallback for the graze band, and
because `goalT` is never negative, `goalT < 0` is false and the stroke fails at
the start of the segment.

### segCircleEntryT

```ts
export function segCircleEntryT(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  radius: number
): number | null                                                       // :272
```

Quadratic ray/sphere solve. Note it takes a **radius, not a pad** — the circle's
radius *is* the tolerance.

Order of checks:
1. `cc = |a−c|² − radius²`; if `cc <= 0` return `0` — already inside at t=0 (`:281-282`).
2. `aa = |b−a|²`; if `aa < EPS` return `null` — zero-length segment and `a` is outside (`:286-287`).
3. `disc < 0` → `null` (`:290-291`).
4. `tEnter = (−bb − √disc) / (2·aa)`; return it only if `tEnter ∈ [0,1]`, else `null` (`:293-295`).

Only the **near** root is considered. That is sound: `cc > 0` at this point means
`a` is strictly outside, so `tEnter < 0 < tExit` is impossible.

Same anti-tunnelling reason as walls, sign flipped: point-sampling would let a
fast flick skip straight past the goal (`Geometry.ts:266-271`, pinned
`Geometry.test.ts:397-400`).

### distPointToSeg / boundsOf

```ts
export function distPointToSeg(p: Vec2, a: Vec2, b: Vec2): number      // :299
export function boundsOf(points: readonly Vec2[]): Rect | null         // :310  O(n)
```

- `distPointToSeg` clamps the projection parameter to [0,1], so it falls back to the nearer endpoint past the ends (`Geometry.test.ts:412-415`); degenerate segment → `dist(p, a)` (`:417-419`).
- `boundsOf` returns `null` for an empty set (`Geometry.ts:311`, pinned `:423-425`) and `{w:0,h:0}` for a single point (`:432-434`). Consumers: `InkRenderer.ts:327,379`, `ShareCard.ts:157`.

### Export usage map (dead-code flags)

| Symbol | Used in `src/` outside Geometry + tests? |
|---|---|
| `clamp`, `dist`, `distSq`, `lerpPoint`, `clonePoint`, `mirrorPoint`, `mirrorPath`, `segRect`, `segRectEntryT`, `segCircleEntryT`, `boundsOf` | yes |
| `inflate`, `isEmptyRect`, `pointInRect`, `segSeg` | **no** — internal to `segRect`; exported for testability only |
| `vec2` | **no** — test-only constructor |
| `mirrorX` (`:64`) | **no callers anywhere** — dead but tested (`Geometry.test.ts:56-59`) |
| `distPointToSeg` (`:299`) | **no callers anywhere** — dead but tested (`Geometry.test.ts:407-420`) |

---

## 3. CollisionSystem

```ts
export class CollisionSystem {                                          // CollisionSystem.ts:24
  constructor(
    private readonly walls: readonly Rect[],
    private readonly hitRadius: number,
    private readonly axisX: number
  ) {}                                                                  // :30-34

  blocks(a: Vec2, b: Vec2): boolean                                     // :37
  firstHitT(a: Vec2, b: Vec2): number | null                            // :55
  private sideBlocked(a: Vec2, b: Vec2): boolean                        // :74
}
```

Constructor params (`CollisionSystem.ts:25-29`):

| Param | Units | Runtime value |
|---|---|---|
| `walls` | playfield **pixels**, both halves, unmirrored | `level.walls.map(w => pf.toScreenRect(w))` (`GameScene.ts:148`) |
| `hitRadius` | pixels | `METRICS.hitRadius = pt(2.6) = 5.2` (`Theme.ts:125`, `PT = 2` at `:38`) |
| `axisX` | pixels | `pf.axisX = pf.x + pf.w*0.5` (`Playfield.ts:41-43`) |

There is no setter and no mutation path — a new instance is built per level
(`GameScene.ts:151`).

### What it tests against

```text
                 axis
  drawable half   |   forbidden half
  ---------------+-------------------
  a────b          |                     ← as drawn      } both tested against
        mirror(a)─|─mirror(b)           ← its reflection}  the FULL wall list
```

`blocks` runs `sideBlocked(a,b)`, and only if that is clear, `sideBlocked(mirror(a),
mirror(b))` (`:38-42`). Each pass is tested against the **full** wall list.

**Why the full list on both passes, and why you must not "optimise" it into
per-half wall buckets** (`CollisionSystem.ts:5-8`): a left-hand segment cannot
physically reach a right-hand wall, so testing it against right-hand walls is
free of false positives. One code path therefore covers both halves and nobody
has to track which walls belong to which side. Bucketing walls by side
reintroduces exactly that bookkeeping — and the bookkeeping is the bug surface.

`sideBlocked` (`:74-79`) early-exits on the first `segRect` hit. `firstHitT`
(`:55-72`) **cannot** early-exit: it must scan all `walls × 2 sides` to find the
minimum `t`. Adding a `break` there breaks the "returns the EARLIER of the two
sides" guarantee, pinned at `CollisionSystem.test.ts:96-100`.

Complexity: `blocks` ≤ 2·|walls| `segRect` calls; `firstHitT` exactly
2·|walls| `segRectEntryT` calls.

### How the pad enters

`hitRadius` is passed as the `pad` argument at all three call sites
(`:62`, `:65`, `:76`) — i.e. every wall is inflated by 5.2 px on all four sides
before testing. Two consequences:

- The stroke is treated as a **zero-width centreline** against a fattened wall — mathematically identical to a 5.2px-radius round nib against the true wall.
- The radius applies **identically to the drawn side and the mirrored side**. Pinned separately: drawn `CollisionSystem.test.ts:48-52`, mirrored `:54-58` (both use `hitRadius` 0 vs 6 across a 5px gap).

`hitRadius` lives in `METRICS`, **not** in `InkTheme` — a purchasable cosmetic
that widened your forgiveness would be pay-to-win. Pinned by
`src/render/Theme.test.ts:84-89` (`expect(Object.keys(theme())).not.toContain('hitRadius')`
at `:87`) and `:66-70`.

**Known, deliberate, LOCKED discrepancy.** `hitRadius = pt(2.6) = 5.2` measured
from the centreline vs a `strokePt = 5` nib reaching `pt(5)/2 = 5.0` from the
same centreline ⇒ contact fires **0.2 base px (0.1pt) before** the visible ink
touches the wall — strict, not forgiving, contrary to the LOCKED prose. See
`Theme.ts:114-124` and `README.md:257-269`. `Theme.test.ts:79-82` pins the 0.2
delta so the decision cannot drift silently.

### The continuous-along-segment invariant (LOCKED)

`CollisionSystem.ts:10-13`, `Geometry.ts:9-12`, `GameScene.ts:236-241`,
`README.md:205-207`. Stated once: pointer samples arrive **at best one per
frame**; during a fast flick consecutive samples land hundreds of pixels apart.
Any test that inspected only the sample points would report "clear" for every
one of them and the stroke would tunnel through the wall.

Therefore: **there is no point-vs-wall API.** `blocks` and `firstHitT` take a
segment. Do not add `blocks(p: Vec2)`. Anti-tunnel tests: `CollisionSystem.test.ts:66-79`
(drawn side, mirror-only vertical, mirror-only diagonal) and
`Geometry.test.ts:263-294`.

**The one sanctioned exception**: `LevelValidator` calls `collision.blocks(p, p)`
with a **zero-length** segment as an occupancy predicate — "may the stroke be
here" (`LevelValidator.ts:68-73`). This is sound because the validator separately
gates every *motion* between cells with a real segment
(`LevelValidator.ts:136: if (collision.blocks(from, at(nc, nr))) continue;`), and
because using the game's own predicate guarantees the validator can never permit
a cell the game forbids (`LevelValidator.ts:11-15`). `pressure()` does the same at
`LevelValidator.ts:333`. Zero-length-segment behaviour is pinned at
`Geometry.test.ts:250-254` and `:324-327`.

### blocks ↔ firstHitT agreement

`CollisionSystem.test.ts:119-132`: 20 000 seeded random segments over
`x ∈ [0,1000), y ∈ [0,1200)` with `hitRadius 5.2`, asserting
`firstHitT(a,b) !== null` equals `blocks(a,b)`. This lifts the
`segRect`/`segRectEntryT` cross-check to the class level.

`CollisionSystem.test.ts:106-117` additionally pins that the returned `t` lands
*on* the wall (`lerpPoint(a,b,t).y ≈ 300`) and that at `t − 1e-4` the stroke is
still alive.

### Mirror-axis edge case

A stroke exactly on the axis is its own reflection, so both checks coincide —
`CollisionSystem.test.ts:60-64`. The axis is a **soft wall** enforced upstream by
`Playfield.clampToDrawable` (`Playfield.ts:76-86`), which clamps `x` into
`[pf.x, pf.axisX]` rather than rejecting; the stroke slides along the axis but
never crosses it (LOCKED).

### Goal and start detection (not in CollisionSystem)

Neither lives in `CollisionSystem`. Both are in `GameScene`:

| | Where | Predicate |
|---|---|---|
| **Goal** | `GameScene.ts:243` | `segCircleEntryT(prev, cursor, this.goalPx, METRICS.goalRadius)` — continuous, `goalRadius = pt(15) = 30` (`Theme.ts:165`) |
| **Start** | `GameScene.ts:206,210` | `dist(touch, this.startPx) > grab` where `grab = METRICS.startRadius * METRICS.startGrabFactor = pt(10) * 2.4 = 48` (`Theme.ts:159,162`) |

Two notes the code makes explicit:

- The start grab is tested against the **raw finger**, not the offset cursor, "because the player aims at the dot they can see" (`GameScene.ts:208-210`). The offset only exists once drawing has begun.
- The goal is **not mirrored**. Only walls are. `CollisionSystem` never sees the goal.

**Wall-vs-goal race** (`GameScene.ts:242-257`): one long segment can reach both.
Resolution order:

```ts
const blocked = this.collision.blocks(prev, cursor);
const goalT   = segCircleEntryT(prev, cursor, this.goalPx, METRICS.goalRadius);
if (blocked) {
  const hitT = this.collision.firstHitT(prev, cursor) ?? 0;
  if (goalT !== null && goalT < hitT) this.win(lerpPoint(prev, cursor, goalT));
  else this.fail(lerpPoint(prev, cursor, hitT));
  return;
}
if (goalT !== null) { this.win(lerpPoint(prev, cursor, goalT)); return; }
```

Strict `<` means a simultaneous arrival (`goalT === hitT`) is a **fail**. This
comparison is only meaningful because both `t`s are in the *same* parameterisation
of `prev→cursor`, which for the mirrored side is guaranteed by `mirrorPoint`
being an isometry.

---

## 4. DrawCursor

```ts
export interface CursorOptions {
  readonly touch: boolean;      // true for touch/pen, false for mouse
  readonly travelPx: number;    // straight-line distance from this stroke's touchdown
  readonly offsetY: number;     // how far above the finger the cursor settles, px
  readonly rampPx: number;      // finger travel over which the offset eases in
}                                                                     // DrawCursor.ts:24-33

export function drawCursor(raw: Vec2, opts: CursorOptions): Vec2      // :35
```

Full body — the whole file is three lines of logic:

```ts
if (!opts.touch) return { x: raw.x, y: raw.y };
const ramp = opts.rampPx <= 0 ? 1 : clamp(opts.travelPx / opts.rampPx, 0, 1);
return { x: raw.x, y: raw.y - opts.offsetY * ramp };
```

| Behaviour | Line | Pinned by |
|---|---|---|
| mouse ⇒ zero offset, always, at any travel | `:36` | `DrawCursor.test.ts:14-25` |
| offset is **negative y** — cursor sits ABOVE the finger | `:39` | `:33-38` (sign is the acceptance criterion) |
| x is never changed | `:39` | `:40-42` |
| `travelPx = 0` ⇒ no offset (no teleport at pointerdown) | `:38` | `:44-46` |
| linear ease, clamped at 1 | `:38` | `:64-73` |
| `travelPx < 0` clamps to 0 | `clamp` at `:38` | `:84-86` |
| `rampPx <= 0` ⇒ full offset immediately | `:38` | `:88-92` |
| returns a **new** object; `raw` untouched | `:36`, `:39` | `:94-98` |
| monotonic: lift only ever increases | — | `:75-82` |
| lift ≤ `min(travelPx*2, offsetY)` | — | `:110-117` |

Runtime values: `offsetY = METRICS.touchOffsetY = pt(42) = 84`,
`rampPx = METRICS.touchOffsetRampPx = pt(21) = 42` (`Theme.ts:134,144`).
`DrawCursor.test.ts:100-108` pins the shipped lift at exactly `pt(42)`.
Because `rampPx = offsetY / 2`, the cursor moves at **twice finger speed** during
the ramp (`Theme.ts:136-143`).

### Why it is a pure function, and why the ramp is travel-gated

`DrawCursor.ts:10-20` states the reason, and it is a collision reason, not a
rendering one: a **time**-based ease keeps moving the cursor while the finger is
still. The cursor position *is* the stroke position, and every pixel of the
stroke is collision-tested — so a time-based ramp would draw, and kill you with,
ink the player never asked for. Gating on distance travelled makes a motionless
finger produce a motionless cursor by construction; the failure mode cannot
exist. Pinned at `DrawCursor.test.ts:48-62`.

Purity (no Phaser, no clock, no internal state) is what makes that testable at
all. The caller supplies `travelPx` as `dist(raw, this.touchAnchor)` where
`touchAnchor` is the pointerdown position for the current stroke
(`GameScene.ts:291`, anchor set at `:214`).

### Ordering trap

`GameScene.cursorFor` (`:284-296`) applies the lift **then** clamps:

```ts
return this.pf.clampToDrawable(drawCursor(raw, {...}));
```

Reversing this lets the 84px lift push the cursor above `pf.y` (outside the
playfield) after clamping. Keep offset-then-clamp.

---

## 5. How to add a new collision shape

The code admits exactly one pattern, visible in what already exists.

1. **Ship the boolean and the entry-parameter together, as a matched pair.**
   `segRect`/`segRectEntryT` exist as two implementations of one predicate whose
   agreement is the codebase's proof obligation (`Geometry.ts:206-207`). A new
   shape needs `segX(a, b, shape, pad = 0): boolean` and
   `segXEntryT(a, b, shape, pad = 0): number | null` with
   `segX(...) === (segXEntryT(...) !== null)`.
   *Exception actually taken in this repo:* `segCircleEntryT` has **no** boolean
   twin — `GameScene.ts:249,254` use `goalT !== null` as the boolean. That is legal
   when the shape has exactly one consumer and no hot path; do not do it for
   anything `CollisionSystem` iterates over per-frame.

2. **Both functions need the empty/degenerate guard**, and it must be
   algebraically the same guard. `segRect` uses `isEmptyRect(inflate(r,pad))`
   (`:169`); `segRectEntryT` open-codes `minX > maxX || minY > maxY` (`:223`).
   Skipping it in one desynchronises the pair only for negative pads — which no
   test would catch unless you add the negative-pad sweep.

3. **The entry-T must return a value in [0,1] measured on `a→b`.** `GameScene`
   compares it directly against `goalT` and feeds it to `lerpPoint`
   (`GameScene.ts:249-250`). Returning a distance, or a `t` on the shape's own
   parameterisation, breaks the race resolution silently.

4. **It must survive mirroring unchanged.** `CollisionSystem` mirrors the
   *segment*, never the shape (`:39-42`, `:56-57`). Any shape you add is stored
   in world coordinates and is hit by mirrored segments as-is.

5. **Wire it into `CollisionSystem` as a second list plus a second loop in both
   `blocks` and `firstHitT`.** The class currently holds exactly one shape list,
   `private readonly walls: readonly Rect[]` (`CollisionSystem.ts:31`).
   `sideBlocked` may early-exit; `firstHitT` may not.

6. **Add the cross-check property test** in the shape of
   `Geometry.test.ts:335-349` (random continuous), `:357-373` (integer lattice,
   sandwiched by `d = 1e-6` because exact tangency is ULP-sensitive), and
   `:146-155` (negative pads), all driven by the seeded LCG at
   `Geometry.test.ts:24-30`. Property tests must fail reproducibly or they are
   noise.

7. **Add an anti-tunnelling case.** Mandatory. Model on
   `Geometry.test.ts:283-293` — thin shape, long random segments with endpoints
   forced onto opposite sides, asserted in both argument orders.

---

## 6. Traps, in one list

| # | Trap | Consequence |
|---|---|---|
| 1 | Adding a point-vs-wall test anywhere on the input path | Tunnelling through walls on any flick. LOCKED rule 2. |
| 2 | `break`ing early in `firstHitT` | Wrong side wins the wall-vs-goal race; `CollisionSystem.test.ts:96-100` fails. |
| 3 | Splitting `walls` into per-half buckets | Reintroduces side bookkeeping; `CollisionSystem.ts:5-8` explains why it was rejected. |
| 4 | Changing `segRect` without `segRectEntryT` (or vice versa) | 68 000 cross-check assertions fail. |
| 5 | Removing `isEmptyRect`/the `minX > maxX` guard | Negative-pad callers (grid erosion) get hits inside inverted rects. |
| 6 | Deleting `segSeg`'s collinear branches | Dragging along a wall's flat top stops registering. |
| 7 | Dropping the `?? 0` at `GameScene.ts:246` | `hitT` becomes `number \| null` and TypeScript rejects `goalT < hitT` and `lerpPoint(…, hitT)`; assert the null away and the rare ULP graze (`blocks` true, `firstHitT` null) silently resolves as `t = 0` anyway, which is what the `?? 0` says out loud. |
| 8 | Making the `drawCursor` ramp time-based | Still finger moves the collision-tested stroke; `DrawCursor.test.ts:55-62` fails. |
| 9 | Flipping the sign in `drawCursor` | Thumb covers the live end of the stroke on every touch device; `DrawCursor.test.ts:33-38` fails. |
| 10 | Moving `hitRadius` into `InkTheme` | Pay-to-win; `Theme.test.ts:84-89` fails. |
| 11 | Clamping before offsetting in `cursorFor` | Cursor escapes the playfield vertically. |
| 12 | Changing `METRICS.hitRadius` without touching `LevelValidator` | `LevelValidator.ts:58` (`5.2`), `:175` (`5.2`), `:322` (`5.2`) and `:59` (`30`) are **hardcoded duplicates** of `METRICS.hitRadius`/`goalRadius`. `pressure()` and `difficulty()`→`clearance()` use the hardcoded values; the test suites pass `OPTS` explicitly and would not notice the drift. |

---

## See also

- [01-architecture.md](01-architecture.md) — where these modules sit in the layering
- [02-coordinate-system.md](02-coordinate-system.md) — `Playfield`, normalized↔pixel, the LOCKED `x = 0.5` axis
- [04-stroke-ribbon.md](04-stroke-ribbon.md) — `StrokeRecorder`, `Ribbon`, and why smoothing never touches collision
- [05-rendering.md](05-rendering.md) — `METRICS`, `InkTheme`, and the nib vs hit-radius separation
- [06-scenes.md](06-scenes.md) — `GameScene`'s use of `blocks`/`firstHitT`/`segCircleEntryT`
- [08-level-generation.md](08-level-generation.md) — `LevelValidator`, `clearance`, `difficulty`
- [12-testing.md](12-testing.md) — the property-test conventions and seeded LCG
- [13-api-reference.md](13-api-reference.md) — flat signature index
- [14-glossary.md](14-glossary.md) — pad, nib, gate, interlock, clearance
- [15-change-recipes.md](15-change-recipes.md) — step-by-step edits
- [../README.md](../README.md) — the three invariants (`README.md:200-211`) and the open LOCKED question (`:257-269`)
