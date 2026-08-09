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

# The Level Generator (`scripts/genLevels.ts`)

**What this covers.** How to run the generator, exactly what it destroys, and
every stage between a random candidate and an emitted level: candidate pool →
interlock reservation → wall rolls → inert-wall stripping → proof → clearance
gate → difficulty measurement → skewed spread → naming → emit. Also: the RNG and
why reruns are byte-identical, the constants that move the ramp, the traps that
make a naive edit ship a broken set, and a post-regeneration checklist.
The generator has **uncommitted working-tree changes**; both states are documented
and every difference is flagged.

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `scripts/genLevels.ts` | 467 | The whole generator: candidates, gates, scoring, selection, naming, emit. Not shipped in the bundle. |
| `src/core/LevelValidator.ts` | 337 | `validateLevel` / `clearance` / `interlock` / `interlockBands` / `difficulty` / `pressure` / `PLAYABLE_CLEARANCE`. The only measurement the generator owns is `turnsIn` (`:279-290`), a descriptive statistic that never gates or sorts. |
| `src/data/generatedLevels.ts` | 1751 (working tree), 1682 (HEAD) | The generator's only output. Overwritten in full on every run. |
| `src/data/levels.ts` | 95 | `TUTORIAL_LEVELS` (5, hand-authored, LOCKED) + `GENERATED_LEVELS` → `LEVELS` (100). |
| `src/data/levels.test.ts` | 262 | Re-proves all 100 levels; pins the ramp, the mirror demand and the playability floor. |
| `src/data/quality.test.ts` | 94 | Pins inert walls, duplicate layouts, wall overlap, sliver widths, unique names. |
| `src/render/Theme.ts` | 212 | `BASE_WIDTH` 750, `BASE_HEIGHT` 1334, `METRICS.inset`, `METRICS.hitRadius`. |
| `src/core/Playfield.ts` | 87 | Normalized → pixel conversion the validator runs against. |

---

## 1. Running it

```
npx vite-node scripts/genLevels.ts
```

| Fact | Detail |
| --- | --- |
| CWD | **Must be the repo root.** The emit path is relative: `writeFileSync('src/data/generatedLevels.ts', header)` (`scripts/genLevels.ts:448`). The imports are relative to the script file and resolve from anywhere, so only the write is CWD-sensitive: run from elsewhere and it throws `ENOENT` unless a `src/data/` happens to exist under that directory, in which case it overwrites *that* file after doing all the work. |
| Runner | `vite-node` 2.1.9, present only as a transitive dependency of `vitest` (`package-lock.json:2825`, `:2871`). It is **not** in `package.json` devDependencies and there is **no npm script** for generation. `npm test` never runs the generator. |
| Reads | Nothing from `src/data/`. It imports `Playfield`, `LevelValidator`, `Theme`, and the `Level`/`Rect` types only (`scripts/genLevels.ts:23-35`). It does **not** read the previous `generatedLevels.ts`, so a run is a total replacement, never an amendment. |
| Writes | `src/data/generatedLevels.ts`, whole file, no backup, no diff check, no confirmation prompt (`:448`). All 95 previously shipped levels are gone. |
| Does not touch | `src/data/levels.ts` — the five tutorial levels are in a different file and are LOCKED (pinned verbatim by `src/data/levels.test.ts:38-52`). |
| Exit behaviour | No exit code discipline, no assertion that the pool filled or that the emitted set is valid. Verification is the test suite's job, after the fact. |
| Prints | One summary line, then a five-row band table (`:450-467`), described in §11. |

**Recovery from an unwanted run:** `git checkout -- src/data/generatedLevels.ts`.
There is no other copy. Regeneration with the same script reproduces the same
file (§4), so an accidental run with an *unmodified* script is harmless.
**Right now that recovery is a trap**: `generatedLevels.ts` is itself uncommitted
(§2), so `git checkout --` restores HEAD's *older* set, not whatever was on disk
before the run. With the working-tree script in place, re-running the generator
is the reliable way back.

---

## 2. Working-tree state (UNCOMMITTED — read this before believing anything else)

`git diff scripts/genLevels.ts` is +24 / −10 at the time of writing. The
working-tree script is a **difficulty rebalance**: fewer roomy levels, more rows,
tighter corridors, and a sampling curve that reaches the hard end sooner.

Verified: `src/data/generatedLevels.ts` in the working tree was produced by the
**working-tree** script, not by HEAD's. Proof: it contains walls of width exactly
`0.46` (e.g. `{ x: 0, y: 0.533, w: 0.46, h: 0.061 }`, `generatedLevels.ts:1489`),
and `0.46` is the working-tree width cap; HEAD's cap is `0.44` and HEAD's file
tops out at exactly `0.44`.
`README.md` is likewise modified to describe `SKEW = 0.55`. So script, data and
README form one coherent uncommitted change set.

| Constant / expression | HEAD | Working tree | Line | Effect |
| --- | --- | --- | --- | --- |
| `MIN_INTERLOCK` | `0.08` | `0.12` | `:49` | Minimum fraction of constrained heights squeezed by both halves at once; a hard acceptance gate, applied twice. |
| gate gap | `0.1 + r() * 0.06` | `0.095 - t * 0.03 + r() * 0.05` | `:88` | Gate gaps now narrow with difficulty instead of being flat. |
| interlock gap | `0.145 - t * 0.06 + r() * 0.03` | `0.125 - t * 0.08 + r() * 0.025` | `:121` | Interlock corridor starts narrower and narrows faster. |
| row count | `Math.round(3 + t * 5)` (3–8) | `Math.round(4 + t * 6)` (4–10) | `:136` | More obstacle rows per level. **Removes a geometric safety margin — see §12.** |
| interlock rows wanted | `1 + Math.round(t * 3)` (1–4) | `1 + Math.round(t * 4)` (1–5) | `:151` | More reserved mirror rows at the hard end. (`t < 1`, so the top of each range needs `t ≥ 0.833` / `t ≥ 0.875`. The source comment at `:149` still says "three by the hard end" and is stale in both states.) |
| row width roll | `round(0.2 + t * 0.18 + r() * 0.12)` | `round(0.22 + t * 0.2 + r() * 0.12)` | `:173` | Wider walls throughout. |
| width cap | `Math.min(w, 0.44)` | `Math.min(w, 0.46)` | `:174` | Hard ceiling on single-wall rows. `0.5` would seal the half. |
| selection curve | `Math.round((i * (pool.length - 1)) / (TARGET - 1))` | `Math.pow(i / (TARGET - 1), SKEW)`, `SKEW = 0.55` | `:414-419`, `:454-456` | Samples the sorted pool with a bias toward the hard end. |

Measured consequence (both sets, same code paths, `cell: 6`,
`hitRadius: METRICS.hitRadius`, `goalRadius: METRICS.goalRadius`):

| Statistic over the 95 generated levels | HEAD set | Working-tree set |
| --- | --- | --- |
| clearance, mean of first 20 | `34.000` (all saturated, see §9) | `30.202` |
| clearance, mean of last 20 | `12.298` | `8.088` |
| clearance min / max | `6.375` / `34.000` | `6.109` / `34.000` |
| `difficulty()` first / last | `0.364` / `0.888` | `0.253` / `0.892` |
| `interlock()` min / mean / max | `0.400` / `0.464` / `0.571` | `0.200` / `0.424` / `0.502` |
| `interlockBands` mean, first 20 → last 20 | `2.000` → `4.000` | `1.950` → `4.000` |
| walls per level, min..max (mean) | `7..15` (`9.547`) | `6..14` (`10.274`) |
| distinct wall rows, min..max | `5..8` | `5..8` |
| backward steps in `difficulty()` | 0 | 0 |

Band report of the working-tree set (the same bands the generator prints):

```text
level range   score   clearance   bands   walls
  6- 24       0.432    30.337     1.947   7.421
 25- 43       0.574    23.277     2.632   9.158
 44- 62       0.678    14.414     3.000  10.737
 63- 81       0.734    11.240     3.053  11.158
 82-100       0.837     8.025     4.000  12.895
```

The working-tree set **passes** `src/data/levels.test.ts` and
`src/data/quality.test.ts` — 320 tests, ~39 s (`vitest run src/data/…`, verified).

---

## 3. Pipeline

```text
seed = 1, pool = []
│
└─► while pool.length < 1100 and tried < 400000            :313
    ├ t = (seed * 0.6180339887498949) % 1                  :321   difficulty dial, low-discrepancy
    ├ makeCandidate(seed++, t)                             :322
    │   ├ rows   = round(4 + t*6)                          :136
    │   ├ h      = round(0.05 + r()*0.012)  (one h/level)  :137
    │   ├ RESERVE want = min(rows, 1+round(t*4)) rows      :151-153  interlock, BEFORE any other roll
    │   ├ for each row: y = lerp(0.8 → 0.16) ± 0.01        :157
    │   │                kind = reserved ? interlock : roll :160-171
    │   │                w = min(round(0.22+t*0.2+r()*0.12), 0.46)  :173
    │   ├ (dead) force one wall past x=0.5                 :185-189  see §12
    │   └ start = (0.07+r()*0.08, 0.92), goal = (0.07+r()*0.3, 0.07)  :191-198
    ├ dedupe on JSON.stringify(walls)                      :324-325  ⚠ key mismatch, §12
    ├ GATE 1  playable: validateLevel at hitRadius+6       :335-344
    ├ GATE 2  interlock(cand) >= MIN_INTERLOCK             :345-348
    ├ CLEAN   stripInert(cand)                             :352      one pass, wall-by-wall
    ├ GATE 3  re-run GATE 1 and GATE 2 on the cleaned level :353-356
    ├ GATE 4  pressure(cand, pf) >= 0.205                  :358-365
    └ accept → pool.push({level, clear, bands, inter, walls, turns, press, score:0})  :367-377
│
├ score every pooled level with difficulty(level, pf)      :389-391  absolute, shared with tests
├ sort ascending by score                                  :393
├ pick 95: index = round((i/94)^0.55 * (pool.length-1))    :414-419
├ id = `l${i+6}`, name = nameFor(i, 95)                    :418
└ serialise + writeFileSync('src/data/generatedLevels.ts') :421-448
```

---

## 4. RNG and determinism — **yes, reruns reproduce the file byte for byte**

```ts
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
```
`scripts/genLevels.ts:52-58` — a 32-bit LCG (Numerical Recipes multiplier
`1664525`, increment `1013904223`, modulus 2^32).

Determinism argument, all of it verifiable in the file:

- `let seed = 1` (`:307`), incremented once per *tried* candidate at `:322`
  (`makeCandidate(seed++, t)`), including candidates that are later rejected. The
  sequence of seeds is therefore fixed by the code, not by acceptance timing.
- Each candidate gets its own generator, `rng(seed)` (`:133`). No shared stream,
  so a change to one candidate's roll count cannot shift another's — only the
  *set* of accepted candidates changes.
- `t = (seed * 0.6180339887498949) % 1` (`:321`) — the golden-ratio conjugate,
  a deterministic low-discrepancy sequence, not random. The comment at `:315-320`
  records why: the previous scheme raised `t` as the pool filled, so pool density
  tracked wherever acceptance happened to be easy.
- **No** `Math.random`, `Date`, `process.hrtime`, environment reads, filesystem
  reads or network anywhere in the script. Verified by reading all 467 lines.
- `Array.prototype.sort` at `:393` is stable in V8, and ties are broken by pool
  insertion order, which is itself deterministic.
- Every emitted number passes through `round()` (`:60`,
  `Math.round(n * 1000) / 1000`), so the serialised text has no float noise.

Consequence, and the reason it is worth this much prose: **a diff on
`generatedLevels.ts` after a rerun shows only real changes.** If you rerun
without editing the script and the file changes, something else changed —
`METRICS`, `Playfield`, `CollisionSystem`, `Geometry`, or `LevelValidator` — and
the diff is telling you the geometry moved under the level set.

---

## 5. Constants and dials

| Name | Line | Value | What it does / why it is that number |
| --- | --- | --- | --- |
| `TARGET` | `:37` | `95` | Levels emitted. Pinned by `levels.test.ts:25-30` (`GENERATED_LEVELS.length === 95`, `LEVELS.length === 100`). Changing it also changes the naming tiers (§10) and requires the test to change. |
| `POOL` | `:43` | `1100` | Candidates measured before choosing. Must stay ≳172 for the skewed spread to keep picking distinct levels (§10). |
| `MIN_INTERLOCK` | `:49` | `0.12` (HEAD `0.08`) | Gate on `interlock()`. Not the shipped floor — selection raises it to `0.200` measured. |
| tried cap | `:313` | `400000` | Escape hatch. **Silent**: if it trips with a short pool the script still emits (§12). |
| candidate row band | `:140-141` | `top = 0.16`, `bottom = 0.8` | Vertical span the rows are spread across, normalized. Start `y = 0.92`, goal `y = 0.07` sit outside it, so the first and last rows never sit on the dots. |
| row height | `:137` | `round(0.05 + r() * 0.012)` → `0.05…0.062` | One height per level, shared by every row. Floor is comfortably above the `w.h > 0.02` sliver bar (`quality.test.ts:89`). |
| row `y` jitter | `:157` | `(r() - 0.5) * 0.02` → ±0.01 | Breaks the ladder look. Interacts with row count — see §12. |
| row width | `:173-174` | `round(0.22 + t*0.2 + r()*0.12)`, capped `0.46` | Only used by the four single-wall kinds. |
| start x | `:191` | `round(0.07 + r() * 0.08)` → `0.07…0.15` | Always `< 0.5`, pinned by `levels.test.ts:56-62`. |
| goal x | `:192` | `round(0.07 + r() * 0.3)` → `0.07…0.37` | Same rule; the wider range is what makes some levels demand a lateral finish. |
| pressure floor | `:362` | `press < 0.205` → reject | Sits just under `pressure(Tangle) = 0.241` (verified; tutorial pressures are `0.086 0.142 0.110 0.190 0.241`). So level 6 is a small breather after the tutorial climax, never a step back below level 2 (`0.142`). |
| `PLAYABLE_CLEARANCE` | `LevelValidator.ts:310` | `6` | Base px the collision radius is inflated by for the proof. ≈3 css px per side on a 390pt phone. |
| `VOPTS` | `:246-250` | `{ cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius }` | Identical to the `OPTS` in both test files, which is why generator and CI agree. |
| `SKEW` | `:414` | `0.55` (HEAD: no skew) | Exponent of the pool sampling curve. |

`METRICS.hitRadius = pt(2.6) = 5.2`, `METRICS.goalRadius = pt(15) = 30`
(`Theme.ts:125`, `:165`, `PT = 2` at `:38`).

---

## 6. Row vocabulary

`type RowKind = 'leftEdge' | 'axisLeft' | 'axisRight' | 'rightEdge' | 'gate' | 'interlock'` (`:67`)

```ts
function buildRow(
  kind: RowKind,
  y: number,
  h: number,
  w: number,
  r: () => number,
  t: number
): Rect[]
```
`scripts/genLevels.ts:69-76`

| Kind | Rects emitted (verbatim) | Line | Constrains |
| --- | --- | --- | --- |
| `leftEdge` | `{ x: 0, y, w, h }` | `:79` | The stroke directly. |
| `axisLeft` | `{ x: round(0.5 - w), y, w, h }` | `:81` | The stroke, against the axis. |
| `axisRight` | `{ x: 0.5, y, w, h }` | `:83` | The **reflection** (projects to `x ∈ [0.5-w, 0.5]`). |
| `rightEdge` | `{ x: round(1 - w), y, w, h }` | `:85` | The reflection, at the player's left edge. |
| `gate` | `{ x: 0, y, w: left, h }` and `{ x: round(left + gap), y, w: round(0.5 - left - gap), h }`, `gap = 0.095 - t * 0.03 + r() * 0.05`, `left = round(Math.max(0.08, (0.5 - gap) * 0.55))` | `:86-94` | The stroke only — both walls are on the drawable half. |
| `interlock` | `{ x: 0, y, w: a, h }` and `{ x: 0.5, y, w: round(0.5 - a - gap), h }`, `gap = 0.125 - t * 0.08 + r() * 0.025`, `a = round(0.06 + r() * (0.5 - gap - 0.12))` | `:95-128` | **Both at once** — see §7. |

Roll distribution for unreserved rows (`:165-171`), verbatim thresholds:

| `roll` | Kind |
| --- | --- |
| `< 0.3` | `leftEdge` |
| `< 0.5` | `axisRight` |
| `< 0.68` | `rightEdge` |
| `< 0.85` | `axisLeft` |
| else | `gate` if `t > 0.35`, otherwise `leftEdge` |

Sliver safety is structural, not incidental: `gate.left ≥ 0.195` and
`gate` right wall `≥ 0.1598` for the achievable `gap` range, `interlock.a ≥ 0.06`
and its far wall `≥ 0.12`. All clear `quality.test.ts:84-93` (`w > 0.02`,
`h > 0.02`) by a wide margin.

---

## 7. The interlock row — the mechanism the whole set is built around

**The problem it fixes.** Every other row kind puts its walls at a height nothing
else occupies, so constraints arrive one at a time and the mirror becomes
decoration. Measured on the previous shipped set: **98 of 100 levels had zero
overlap** between the two halves; mean `interlock()` was 0.4 %
(`scripts/genLevels.ts:99-105`, `LevelValidator.ts:203-205`, README "The mirror
has to be load-bearing").

**The geometry.** The interlock row emits a near wall `[0, a]` and a far wall
starting exactly on the axis, `[0.5, 0.5 + (0.5 - a - gap)]`. Because the far
wall starts at `x = 0.5`, its reflection lands exactly at `a + gap`
(`:125-126`). The drawable corridor is `[a, a + gap]`: its left edge is visible,
its right edge is a reflection. Neither wall alone says where the opening is.

```text
own half     [0 ....... a]   gap   [a+gap ....... 0.5]
drawn as       left wall            reflection of the far wall
```

**Three design decisions that a reader will otherwise get wrong:**

1. **Reserved before anything else is rolled** (`:143-153`). `want = Math.min(rows, 1 + Math.round(t * 4))`
   row indices are drawn into a `Set` *before* the row loop runs. Left to chance
   the two halves essentially never share a height. This is why the ordering in
   `makeCandidate` is load-bearing: moving the reservation after the kind rolls
   silently reverts the game to an obstacle course.
2. **Scales with difficulty**, 1 at `t = 0` up to 5 as `t → 1` (HEAD: up to 4).
   The corridor also narrows continuously with `t` (`:121`) — count alone gave
   only three settings and left levels 6–62 flat (`:115-120`).
3. **Measured after placement, never trusted.** A neighbouring row's wall can
   swallow the corridor, so the level is scored with `interlock()` at `:345` and
   *again* after `stripInert` at `:353`. `interlock()` samples 1001 heights
   (`LevelValidator.ts:207-231`) and returns
   `both / any` — the fraction of *constrained* heights where the own-half clip
   and the reflected clip both bite.

**Thresholds that apply to interlock, and who enforces them:**

| Rule | Value | Enforced by |
| --- | --- | --- |
| Generator gate, pre- and post-strip | `>= 0.12` | `scripts/genLevels.ts:345`, `:353` |
| Every generated level | `> 0.05` | `levels.test.ts:182-187` |
| Mean over the generated set | `> 0.2` | `levels.test.ts:196-200` (measured: `0.424`) |
| Tutorial 1–4 exactly zero, tutorial 5 `> 0.1` | — | `levels.test.ts:189-194` (measured: `0 0 0 0 0.167`) |

**Side effect worth knowing:** `interlock(l) > 0` mathematically requires some
wall with `w.x + w.w > 0.5` (`LevelValidator.ts:221`). So the post-strip
interlock gate is what actually preserves the invariant pinned by
`levels.test.ts:97-102` ("at least one wall the reflection has to clear") after
walls have been removed.

---

## 8. Inert-wall stripping

```ts
function stripInert(level: Level): Level
```
`scripts/genLevels.ts:265-276`

- A wall is **inert** iff removing it leaves the level solvable *and* leaves
  `result.reachable` **exactly** unchanged (`:271`). A wall that merely narrows a
  corridor is never flagged — the bar is deliberately strict.
- Run at base `VOPTS` (hit radius `5.2`), not at the inflated playability radius.
  `quality.test.ts:16` uses the same options, so generator and test agree.
- **One pass, independent tests, simultaneous removal.** Each wall is tested
  against the *full* level, then all flagged walls are dropped together. Two
  walls that cover for each other are therefore both flagged and both removed,
  which can delete a constraint neither test predicted. That is why the caller
  re-proves everything afterwards (`:350-356`) — but note the re-proof only
  checks playability and interlock, not that the level stayed as hard.
- Guards: if the level was not solvable to begin with, or nothing was stripped,
  or *everything* was stripped, the original level is returned unchanged
  (`:266-267`, `:273-275`).

**The 34-across-30 figure.** The set that shipped before stripping existed
contained **34 inert walls across 30 levels** (`scripts/genLevels.ts:259`,
`quality.test.ts:24-25`, README "Craft"). The dominant case is a far-half wall
whose reflection lands inside a near wall: the player folds it in their head and
finds it changes nothing, which is worse than an absent wall because the level
promised a problem that does not exist. `quality.test.ts:31-47` fails the build
if one returns — it re-runs the same removal experiment on all 100 shipped
levels, one assertion per wall.

Cost: `stripInert` performs `1 + walls.length` full `validateLevel` calls per
candidate — the single most expensive step in the loop (§11).

---

## 9. The gates, in order, and why each exists

| # | Gate | Line | Rejection counter |
| --- | --- | --- | --- |
| 0 | Duplicate walls (pre-strip key) | `:324-325` | none (silent `continue`) |
| 1 | Solvable **with room to spare**: `validateLevel(l, pf, {...VOPTS, hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE})` | `:335-344` | `rejectedUnsolvable` |
| 2 | `interlock(cand) >= MIN_INTERLOCK` | `:345-348` | `rejectedFlat` |
| 3 | Re-run 1 and 2 on the stripped level | `:353-356` | `rejectedFlat` (conflated — see §12) |
| 4 | `pressure(cand, pf) >= 0.205` | `:358-365` | `rejectedTrivial` |

```ts
const playable = (l: Level): boolean =>
  validateLevel(l, pf, {
    ...VOPTS,
    hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
  }).solvable;
```
`scripts/genLevels.ts:335-339`

**Why gate 1 is not "is it solvable".** The BFS proves a route exists for the
*centreline*. Ten levels once shipped through corridors barely wider than the
ink; the worst two left 0.3 css px of margin — provably finishable, impossible to
draw (`LevelValidator.ts:157-169`, README "Solvable is not the same as
playable"). Inflating the radius by 6 base px is the same predicate the shipped
test applies (`levels.test.ts:139-153`).

**`clearance()` saturates at 34.** `clearance` binary-searches the extra radius
over `[0, opts.max ?? 34]` with **7** iterations and returns `hi` immediately if
the level survives at `+34` (`LevelValidator.ts:170-189`). Two consequences a
model must not miss:

- Reported clearances are multiples of `34 / 128 = 0.265625`, or the literal
  saturation value `34`. The measured minimum of the working-tree set,
  `6.109375`, is exactly `23 × 0.265625`.
- A returned value can undershoot the true threshold by up to `0.265625`.
  The generator's gate is a *boolean* at exactly `+6`, while
  `levels.test.ts:155-163` asserts the *measured* minimum is `>= PLAYABLE_CLEARANCE`
  and `< PLAYABLE_CLEARANCE * 3` (i.e. `[6, 18)`). The current set's minimum sits
  **one bisection step** above failure. Tightening `MIN_INTERLOCK`, the widths or
  the skew can push a level's measured clearance to `5.84375` and fail that test
  even though the generator's own gate passed it.
- In `difficulty()`, `tight = clamp01(1 - clearance/40)`, so every saturated
  level scores exactly `0.15` on the tight axis. HEAD's first 20 generated levels
  *all* saturate (mean exactly `34.000`) — that flat third of the game is
  precisely what the uncommitted `SKEW` was written to remove.

---

## 10. Scoring, selection, naming

**Score.** `difficulty(level, pf)` (`LevelValidator.ts:275-295`), applied to
every pooled level at `scripts/genLevels.ts:389-391`, then ascending sort at
`:393`.

```ts
export function difficulty(level: Level, pf: Playfield): number
// tight  = clamp01(1 - clearance(level, pf) / 40)
// bands  = clamp01(interlockBands(level) / 4)
// mirror = 0.5 * bands + 0.5 * clamp01(interlock(level) / 0.6)
// plan   = 0.5 * clamp01(level.walls.length / 14) + 0.5 * clamp01(turns / 10)
// return  0.4 * tight + 0.35 * mirror + 0.25 * plan
```

It is **absolute, not pool-relative**, on purpose (`:380-388`,
`LevelValidator.ts:264-274`): a rank-normalised blend cannot be recomputed from
the shipped 95, so no test could check the order against the rule that produced
it. `levels.test.ts:222-228` re-derives `difficulty()` for all 95 and asserts the
sequence never steps backwards — that assertion *is* the sort, re-run in CI.

Note `difficulty()` calls `clearance(level, pf)` and `validateLevel(level, pf)`
with **no options**, so it uses `LevelValidator`'s own defaults
(`cell = 6`, `hitRadius = 5.2`, `goalRadius = 30`, `:57-59`). Those happen to
equal `METRICS.hitRadius` and `METRICS.goalRadius` numerically. They are separate
literals; nothing keeps them in sync (§12).

**Selection.**

```ts
const SKEW = 0.55;
const out = Array.from({ length: TARGET }, (_, i) => {
  const f = Math.pow(i / (TARGET - 1), SKEW);
  const pick = pool[Math.round(f * (pool.length - 1))];
  return { ...pick.level, id: `l${i + 6}`, name: nameFor(i, TARGET) };
});
```
`scripts/genLevels.ts:414-419`

- Endpoints are exact: `i = 0 → index 0` (easiest in pool), `i = 94 → index 1099`
  (hardest). Monotone in between, so the ramp stays continuous.
- The curve is steep at the start: with `pool.length = 1100`, `i = 1` already
  lands on index **90** (linear would give 12); `i = 93` lands on **1093**.
- **Pool-size floor.** Spacing is tightest at the top: `d(index)/di ≈ 0.55 * (pool.length-1) / 94`.
  Distinct picks require `pool.length ≳ 172`. Below that the hard end starts
  repeating levels and `quality.test.ts:51-61` (no two identical layouts) fails.
  The linear HEAD version only needed `pool.length ≥ 95`.
- `id` is `l${i + 6}` — hardcodes the assumption that exactly 5 tutorial levels
  precede the block (`levels.ts:89`).

**Naming** (`:203-242`). Adjectives are banded by tone so the name agrees with
the ramp; the previous flat list called the hardest level in the game
"Soft bend".

```ts
const ADJ_TIERS = [
  ['First', 'Soft', 'Quiet', 'Slow', 'Gentle'],
  ['Open', 'Wide', 'Warm', 'Still', 'Pale'],
  ['Second', 'Long', 'Late', 'Early', 'Loose'],
  ['Narrow', 'Deep', 'Dark', 'Cold', 'Thin'],
  ['Sharp', 'Tight', 'Quick', 'Severe', 'Closed'],
];
const NOUN = [
  'fold', 'crease', 'wing', 'mirror', 'hinge', 'seam', 'pleat', 'turn',
  'pass', 'gate', 'thread', 'knot', 'sweep', 'arc', 'bend', 'lean', 'drift',
  'reach', 'edge', 'span',
];

function nameFor(i: number, total: number): string {
  const per = Math.ceil(total / ADJ_TIERS.length);
  const tier = Math.min(ADJ_TIERS.length - 1, Math.floor(i / per));
  const k = i - tier * per;
  const adj = ADJ_TIERS[tier][k % ADJ_TIERS[tier].length];
  const noun = NOUN[(k * 7 + tier * 3) % NOUN.length];
  return `${adj} ${noun}`;
}
```
`scripts/genLevels.ts:214-242`

Why it yields 95 unique names, and why that is fragile:
`per = ceil(95/5) = 19`, so each tier owns exactly 19 consecutive levels and
`k ∈ [0, 18]`. The noun stride `7` is coprime with `NOUN.length = 20`, so a tier
never repeats a noun; the adjective cycles with period 5, so `(adj, noun)` pairs
stay unique inside a tier; all 25 adjectives are distinct, so tiers cannot
collide. Verified endpoints in the shipped file: `l6` = `First fold`,
`l100` = `Severe edge`. Uniqueness is pinned by `quality.test.ts:63-66` and
`levels.test.ts:32-36`. **Change `TARGET` and the arithmetic changes**: if
`per * 5 > total` the last tier is short, and if `NOUN.length` stops being
coprime with the stride the tier repeats nouns.

---

## 11. Emit format and the run report

The emitted text must parse as the module the game imports. Exact template
(`scripts/genLevels.ts:421-446`):

```ts
const body = out.map((l) =>
  `  {\n    id: '${l.id}',\n    name: '${l.name}',\n    start: { x: ${l.start.x}, y: ${l.start.y} },\n    goal: { x: ${l.goal.x}, y: ${l.goal.y} },\n    walls: [\n${l.walls
    .map((w) => `      { x: ${w.x}, y: ${w.y}, w: ${w.w}, h: ${w.h} },`)
    .join('\n')}\n    ],\n  },`
).join('\n');
```

Produced file shape:

```text
/** GENERATED — do not edit by hand. Run `npx vite-node scripts/genLevels.ts`. … */
import type { Level } from './types';

export const GENERATED_LEVELS: readonly Level[] = [
  {
    id: 'l6',
    name: 'First fold',
    start: { x: 0.133, y: 0.92 },
    goal: { x: 0.349, y: 0.07 },
    walls: [
      { x: 0.208, y: 0.791, w: 0.292, h: 0.053 },
      …
    ],
  },
  …
];
```

Format facts that matter:

- Two-space indent, single-quoted strings, trailing commas everywhere — matches
  the repo's existing formatting, so a regeneration diff contains only numbers.
- `parMs` is never emitted, though `Level` allows it (`src/data/types.ts:33`).
- Numbers are raw `Number.prototype.toString` of already-rounded values, so every
  coordinate has at most 3 decimals. Values like `0.92` and `0.07` (start/goal
  `y`) are literals from `:197-198`.
- The export name and type — `export const GENERATED_LEVELS: readonly Level[]` —
  are what `src/data/levels.ts:2` imports. Renaming either breaks the game.
- **Stale text in the emitted header** (`:435-436`): it claims the levels are
  "ordered by measured pressure". They are ordered by `difficulty()`. Same stale
  claim at `scripts/genLevels.ts:12-15` and `src/data/levels.ts:85-87`.

Run report (`:450-467`):

```text
tried N · unsolvable N · trivial N · no interlock N · pool N · shipped N
band     score  clearance  bands  walls
  6- 24   …
```
Five bands of 19, labelled with shipped level numbers (`a + 6` … `b + 5`).
The band table re-derives the picks with its own copy of the selection
expression at `:454-456` — **edit `:415-417` and you must edit `:455` too**, or
the report describes a different set from the one on disk.

---

## 12. Traps, dead code and known defects

Ordered by how much damage a naive change does.

1. **Row count vs. row spacing (introduced by the uncommitted `:136`).**
   Rows are spread over `bottom - top = 0.64` with `±0.01` jitter each and a
   shared height up to `0.062`. With 8 rows the worst-case vertical gap is
   `0.64/7 - 0.02 = 0.0714 > 0.062` — overlap is impossible by construction.
   With 9 rows it is `0.06`, with 10 rows `0.0511`; both are **below** the
   maximum wall height, so two adjacent rows can overlap vertically, and if they
   also overlap horizontally `quality.test.ts:70-82` ("never overlaps two walls
   into a single blob") fails. The current file survives only because no selected
   level has more than 8 rows (measured). This is luck, not a guarantee.
2. **Dedupe key mismatch.** `:324` computes the key from the **pre-strip** walls
   and checks membership; `:367` inserts the key of the **post-strip** walls.
   Two different candidates that strip down to the same geometry are therefore
   both accepted, and `quality.test.ts:51-61` (duplicate layouts, rounded to 2
   decimals) is the only thing that would catch it.
3. **No guard on a short pool.** The loop can exit on `tried >= 400000` with
   `pool.length < POOL`, and the script emits anyway. Under ~172 the skewed
   selection starts repeating levels; at `pool.length === 0` it throws on
   `pick.level`. Nothing prints a warning — only the `pool N` figure in the
   report reveals it.
4. **Dead code: the mirror-guarantee fallback** (`:185-189`). It fires only when
   no wall satisfies `w.x + w.w > 0.5`. But `want >= 1` always (`:151`), every
   interlock row emits `{ x: 0.5, w: round(0.5 - a - gap) }` with
   `w >= 0.12` (`:122-126`), so some wall always crosses the axis. The branch
   cannot execute in the current configuration. It would also be unsafe if it
   did: it moves an existing wall to `x = 0.5` at the same `y`, which can create
   the overlapping pair that `quality.test.ts:70-82` forbids.
5. **`rejectedFlat` is overloaded.** `:353-356` increments it when the *stripped*
   level fails **either** the playability re-check or the interlock re-check, but
   the report prints it as "no interlock" (`:452`). The printed diagnosis can be
   wrong.
6. **Duplicated hit-radius/goal-radius literals.** `LevelValidator.ts:58-59`
   defaults to `5.2` / `30`, and `pressure()` hardcodes `5.2`
   (`LevelValidator.ts:322`). `difficulty()` calls `clearance` and `validateLevel`
   with no options, so it uses those literals. They currently equal
   `METRICS.hitRadius` and `METRICS.goalRadius`. README's open question proposes
   dropping `hitRadius` to `pt(2.0) = 4.0`; if that happens, `difficulty()` and
   `pressure()` keep scoring at `5.2` while the game plays at `4.0`, silently.
7. **Stale prose** — see §11. Three places still say the set is ordered by
   pressure.
8. **The strip is not idempotent-by-construction.** Simultaneous removal of
   mutually-covering walls can open a level up more than any single removal
   suggests; only playability and interlock are re-checked afterwards, not the
   score the candidate was about to be sorted by (the score is computed later,
   at `:389`, so the sort itself is honest — but the pressure gate at `:362`
   runs on the stripped level, which is correct, while the `seen` key does not).

---

## 13. Cost model (why a run is slow)

Playfield with `BASE_WIDTH = 750`, `BASE_HEIGHT = 1334`,
`inset = { top: 88, right: 24, bottom: 144, left: 24 }` (`Theme.ts:206-211`,
`PT = 2`): `pf.x = 24`, `pf.y = 88`, `pf.w = 702`, `pf.h = 1102`,
`pf.axisX = 375`.

| Measurement | Grid | Cells |
| --- | --- | --- |
| `validateLevel` (`cell = 6`) | `cols = floor((375-24)/6)+1 = 59`, `rows = floor(1102/6)+1 = 184` | `10856` |
| `pressure` (`cell = 8`) | `44 × 138` | `6072` |

`validateLevel` walks the full grid **three times** before the BFS —
`nearest(start)`, `nearest(goal)`, and the `free` count
(`LevelValidator.ts:78-92`, `:103-104`) — each cell calling
`collision.blocks(p, p)`, which tests the point and its mirror against every
wall. Per accepted candidate the generator spends roughly
`1 (gate 1) + 1 + walls (strip) + 1 (re-gate) + 1 (turnsIn) ≈ 14` full
`validateLevel` calls, plus scoring later: `clearance` costs up to 9 calls
(`ok(0)`, `ok(34)`, 7 bisection steps) and `difficulty` one more for the route.
Rejected candidates cost at least one. With `POOL = 1100` that is tens of
thousands of grid walks. For scale, the test suite performs a comparable amount
of work: `levels.test.ts` + `quality.test.ts` = 320 tests in ~39 s (measured).

---

## 14. Regeneration checklist

Run through this **every** time `src/data/generatedLevels.ts` changes.

1. **Know why you are running it.** The only legitimate reasons: you edited
   `scripts/genLevels.ts`, or you changed something the levels are proved
   against (`METRICS`, `Playfield`, `CollisionSystem`, `Geometry`,
   `LevelValidator`). Running it unchanged is a no-op by construction (§4).
2. `git status` must be clean for `src/data/generatedLevels.ts` before the run,
   so the diff afterwards is attributable.
3. Run from the repo root: `npx vite-node scripts/genLevels.ts`.
4. Read the report line. `pool` should be `1100`; anything less means the
   `tried < 400000` cap tripped and the ramp is being sampled from a short pool
   (§12.3). `shipped` must be `95`.
5. Read the band table: `score` must increase monotonically down the five rows,
   `clearance` must decrease, and no band-to-band clearance ratio may fall below
   `0.55` (that is the cliff test, `levels.test.ts:246-256`, applied to 10-level
   bands over all 100 levels).
6. `npx vitest run src/data` — 320 tests. In particular these must pass, and each
   pins a different generator behaviour:
   - `levels.test.ts:25-30` — still 95 generated / 100 total.
   - `levels.test.ts:112-123` and `:139-153` — every level solvable, and solvable
     at `hitRadius + PLAYABLE_CLEARANCE`.
   - `levels.test.ts:155-163` — measured tightest clearance in `[6, 18)`. The
     current margin above failure is one bisection step of `0.265625` (§9).
   - `levels.test.ts:182-200` — every generated level `interlock > 0.05`, mean
     `> 0.2`.
   - `levels.test.ts:222-228` — `difficulty()` never steps backwards. This is the
     sort key re-derived in CI.
   - `levels.test.ts:230-244` — last-20 clearance `< 0.6 ×` first-20; last-20
     `interlockBands` `> 1.4 ×` first-20.
   - `levels.test.ts:258-261` — `pressure(l1) < 0.12`, `pressure(l100) > 0.4`.
   - `quality.test.ts:31-47` — no inert walls (the 34-across-30 regression).
   - `quality.test.ts:51-66` — no duplicate layouts, no duplicate names.
   - `quality.test.ts:70-93` — no overlapping walls, no walls thinner than 0.02
     in either axis. Overlap is the failure the uncommitted row-count bump makes
     possible (§12.1).
7. `npm run build` (`tsc --noEmit && vite build`) — the emitted file is
   TypeScript and is type-checked, not parsed loosely.
8. Eyeball the first and last few levels in the app or in the level-select grid.
   Nothing in the suite checks that a level is *interesting*.
9. Commit `scripts/genLevels.ts` and `src/data/generatedLevels.ts` **together**.
   They are a matched pair: HEAD's script cannot reproduce the working tree's
   data, which is exactly the inconsistency this repo is carrying right now (§2).
10. If any README figure is quoted from a measurement (clearance range, interlock
    mean, band table), re-measure it — README currently states
    "clearance falls smoothly 30 → 8 base px", which matches the working-tree set
    (`30.202 → 8.088`) and not HEAD's (`34.000 → 12.298`).

---

## See also

- [00-index.md](00-index.md) — documentation map.
- [02-coordinate-system.md](02-coordinate-system.md) — the LOCKED normalized
  space the generator authors in, and the `x = 0.5` mirror rule.
- [03-geometry-collision.md](03-geometry-collision.md) — `segRect`,
  `CollisionSystem.blocks`, the predicate every validator cell is gated by.
- [07-levels-data.md](07-levels-data.md) — the shipped level set, the tutorial
  arc, and `LevelValidator`'s API in detail.
- [12-testing.md](12-testing.md) — the full suite, including the level and
  quality tests referenced throughout this document.
- [13-api-reference.md](13-api-reference.md) — exported signatures.
- [15-change-recipes.md](15-change-recipes.md) — task-shaped procedures.
- [../README.md](../README.md) — narrative rationale for the ordering rewrite,
  the inert-wall problem, and "solvable is not the same as playable".
