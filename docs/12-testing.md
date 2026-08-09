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

# Test Suite Map & Pinned Invariants

## What this covers

The entire automated safety net: 11 spec files, 506 tests, run by Vitest 2.1.9 in
the `node` environment. Which invariant each suite pins, where the fuzz/property
tests live and how many cases they really run, what the 100-level re-proof costs
in wall time, and — at the end — the large untested surface (all scenes, all
renderers, all native bridges) so a model knows exactly where it is flying blind.

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `src/core/Geometry.test.ts` | 435 | Primitive geometry; the segRect ↔ segRectEntryT cross-proof |
| `src/core/StrokeRecorder.test.ts` | 329 | Sampling threshold, Chaikin, densify, render-vs-collision bound |
| `src/data/levels.test.ts` | 262 | 100-level solvability + playability re-proof, difficulty ramp |
| `src/core/Ribbon.test.ts` | 168 | Speed→width profile, quad/disc tessellation |
| `src/core/CollisionSystem.test.ts` | 134 | Own-side + mirrored-side blocking, `firstHitT` |
| `src/core/Playfield.test.ts` | 134 | Normalized→screen mapping, the soft wall at the axis |
| `src/render/Theme.test.ts` | 140 | LOCKED palette and `METRICS` constants |
| `src/config/monetization.test.ts` | 109 | AdMob id shapes, plist agreement, ad-cadence arithmetic |
| `src/data/quality.test.ts` | 94 | No inert wall, no duplicate layout, no hairline geometry |
| `src/render/HitArea.test.ts` | 73 | Phaser hit-rect regression (buttons live over their whole face) |
| `src/core/DrawCursor.test.ts` | 118 | Touch cursor lift, distance-gated ramp |
| `vite.config.ts` | 21 | Vitest config lives here (`test.environment`, `test.include`) |
| `package.json` | 38 | `test` / `test:watch` / `typecheck` scripts |

---

## 1. How to run

```bash
npm test           # vitest run              — single pass, exits
npm run test:watch # vitest                  — watch mode
npm run typecheck  # tsc --noEmit            — not part of vitest
npm run build      # tsc --noEmit && vite build — typecheck gates the build
```

There is **no `vitest.config.ts`**. Config is inlined in `vite.config.ts:15-20`:

```ts
test: {
  environment: 'node',
  include: ['src/**/*.test.ts'],
},
```

Consequences:

- `environment: 'node'` — there is no DOM, no `window`, no canvas. **Phaser is
  never imported by any test.** Any module that transitively imports `phaser`
  is therefore untestable as written; that is why `src/core/*` and
  `src/render/{Theme,HitArea}.ts` are Phaser-free and everything else is not.
- `include` is `src/**/*.test.ts` only — `scripts/genLevels.ts` is not covered.
- `src/config/monetization.test.ts:11` does `readFileSync('ios/App/App/Info.plist')`
  with a **CWD-relative path**. Vitest must be launched from the repo root or
  that file fails with ENOENT. Trap for anyone running vitest from `src/`.

Useful subsets:

```bash
npx vitest run src/core                 # fast core only (~2s)
npx vitest run src/data/levels.test.ts  # the slow one (~36s alone)
npx vitest run --reporter=basic         # per-file counts + timings
npx vitest run --reporter=verbose       # per-test names + timings
```

## 2. Counts and cost

**Method:** counts and timings below are from an actual `npx vitest run
--reporter=basic` on this checkout (all 506 green), cross-checked against a
`grep -cE '^\s*(it|test)(\.each)?'` count of static declarations. The two differ
because `it.each` and one `for` loop expand at runtime; the "static" column is
what you see when reading the file, the "runtime" column is what Vitest reports.

| File | Static `it(` | Runtime tests | Wall time |
| --- | --- | --- | --- |
| `src/data/levels.test.ts` | 18 (2 are `it.each` × 100) | **216** | 45 223 ms |
| `src/data/quality.test.ts` | 5 (1 is `it.each` × 100) | **104** | 15 439 ms |
| `src/core/Geometry.test.ts` | 60 | **60** | 446 ms |
| `src/core/StrokeRecorder.test.ts` | 32 | **32** | 990 ms |
| `src/core/CollisionSystem.test.ts` | 17 | **17** | 228 ms |
| `src/render/Theme.test.ts` | 17 | **17** | 5 ms |
| `src/core/Ribbon.test.ts` | 16 | **16** | 6 ms |
| `src/core/DrawCursor.test.ts` | 14 | **14** | 6 ms |
| `src/core/Playfield.test.ts` | 13 | **13** | 213 ms |
| `src/config/monetization.test.ts` | 10 | **10** | 3 ms |
| `src/render/HitArea.test.ts` | 4 (1 in a `for` over 4 cases) | **7** | 13 ms |
| **Total** | — | **506** | 45.83 s wall / 62.57 s summed |

Wall time is less than summed test time because Vitest runs files in parallel
workers. **96 % of the cost is in two files** (`levels` + `quality` = 60.7 s of
the 62.6 s), and all of it is BFS grid search inside `LevelValidator`.

The four individually expensive tests, all in `src/data/levels.test.ts`:

| Test | file:line | ms |
| --- | --- | --- |
| `difficulty ramp > has no cliff — no ten-level band doubles the precision demand` | `src/data/levels.test.ts:246` | 17 827 |
| `difficulty ramp > never steps backwards within the generated set` | `src/data/levels.test.ts:222` | 11 049 |
| `playability > measures real slack on the tightest level, not just a pass` | `src/data/levels.test.ts:155` | 9 723 |
| `difficulty ramp > ramps the two axes that matter, not just the wall count` | `src/data/levels.test.ts:230` | 3 677 |

Why: each calls `clearance(level, pf, OPTS)` per level, and `clearance`
(`src/core/LevelValidator.ts:170-182`) **binary-searches** `validateLevel` over
the pad range `[0, opts.max ?? 34]`, so one `clearance` call is ~6 full BFS
solves. `has no cliff` does that for all 100 levels; `never steps backwards`
calls `difficulty` (`src/core/LevelValidator.ts:275`) which itself calls
`clearance` + `interlock(samples=1000)` + `interlockBands(samples=600)` +
`validateLevel` for each of the 95 generated levels.

Slowest outside `src/data/`: `renderPath > holds the bound over random strokes
at every speed` (`src/core/StrokeRecorder.test.ts:250`) at 957 ms.

## 3. The property / fuzz tests

All randomness is a **hand-rolled LCG seeded with a literal**, never
`Math.random()`. The generator body is identical everywhere:

```ts
s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
return s / 4294967296;
```

Stated rationale at `src/core/Geometry.test.ts:23`: *"property tests must fail
reproducibly or they are noise."* **Do not swap in `Math.random()`** — a flaky
red on level generation would be unreproducible and the suite would get muted.

| Fuzz test | file:line | Seed | Iterations | What it proves |
| --- | --- | --- | --- | --- |
| `segRectEntryT agrees with segRect over random continuous cases` | `src/core/Geometry.test.ts:335` | `rng(1234)` | **30 000** | Two independent algorithms agree on the same predicate |
| `segRectEntryT agrees with segRect over an integer grid, up to grazing` | `src/core/Geometry.test.ts:357` | `rng(5678)` | **30 000** | Same, on integers where exact tangency is common |
| `keeps the two implementations in agreement across negative pads` | `src/core/Geometry.test.ts:146` | `rng(31337)` | **8 000** | Agreement survives pads that shrink the rect past empty |
| `catches every crossing of a thin wall at every angle` | `src/core/Geometry.test.ts:283` | `rng(99)` | 2 000 (×2 orders) | No tunnelling through an 8 px wall at any angle |
| `mirror is an involution` | `src/core/Geometry.test.ts:65` | `rng(7)` | 500 | `mirror(mirror(p)) == p` |
| `firstHitT agrees with blocks() on every segment` | `src/core/CollisionSystem.test.ts:119` | `12345` | **20 000** | The t-returning path and the boolean path never disagree |
| `keeps every clamped point at or left of its own reflection` | `src/core/Playfield.test.ts:111` | `20260725` | 5 000 | Clamped point ≤ axis AND its mirror ≥ axis |
| `keeps every accepted sample at least the threshold apart` | `src/core/StrokeRecorder.test.ts:86` | `4242` | 3 000 pushes | Spacing rule holds under adversarial input |
| `holds the bound over random strokes at every speed` | `src/core/StrokeRecorder.test.ts:250` | `777` | 300 strokes × 9 pts | Rendered path stays within `hitRadius` of the tested path |

### The segRect ↔ segRectEntryT cross-proof — real numbers

**The total is 68 000 cross-check iterations, not 80 000.** It is split across
three tests, not one:

```text
src/core/Geometry.test.ts:146   8 000   negative pads, fixed rect, pad ∈ [-30, +10)
src/core/Geometry.test.ts:335  30 000   random continuous, random rect, pad ∈ [0, 10)
src/core/Geometry.test.ts:357  30 000   integer grid, fixed rect, pad ∈ {0,10,20}
                              ------
                               68 000
```

If you also count `src/core/CollisionSystem.test.ts:119` (`firstHitT` vs
`blocks`, 20 000 cases) the codebase runs **88 000** cross-implementation
agreement checks per `npm test`, in ~0.7 s.

Why the split matters:

- `segRect` (`src/core/Geometry.ts:167`) uses orientation / `segSeg` tests.
  `segRectEntryT` (`src/core/Geometry.ts:209`) uses slab clipping. They share no
  code. The comment at `src/core/Geometry.test.ts:329-333` calls this "the
  closest thing to a proof this codebase can run" — a bug must be duplicated in
  both implementations to survive.
- The **integer-grid** variant (`:357`) cannot assert plain equality. Integer
  coordinates make exact corner clips and collinear edges common instead of
  measure-zero, and there the two algorithms may legally differ by one ULP. So
  it sandwiches with `d = 1e-6` (`:359`): `entryT(pad − d) !== null ⇒
  segRect(pad)`, and `segRect(pad) && entryT(pad + d) === null` is a hard
  failure. The assertion still bites everywhere except within 1e-6 of a true
  tangency. **Do not "simplify" this back to `expect(a).toBe(b)`** — it will go
  flaky on grazing cases.
- The negative-pad test (`:146`) exists purely for domain coherence. The game
  never passes a negative pad (`METRICS.hitRadius` is positive), but
  `isEmptyRect` / `inflate` must stay sane for a future grid validator that
  erodes cells (`src/core/Geometry.test.ts:125-130`).
- `src/core/Geometry.test.ts:369-372` uses a bare `throw new Error(...)` instead
  of `expect`. It works, but the failure message is a JSON dump, not a Vitest
  diff.

## 4. The 100-level re-proof

`src/data/levels.test.ts` and `src/data/quality.test.ts` both build the *shipped*
geometry, not a fixture:

```ts
const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const OPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };
```
(`src/data/levels.test.ts:17-22`, `src/data/quality.test.ts:15-16`)

That coupling is the point: change `METRICS.hitRadius` or `METRICS.inset` and
these suites tell you which levels just became impossible. Three separate
`it.each` blocks each expand to 100 tests:

| Block | file:line | Cost | Assertion |
| --- | --- | --- | --- |
| `solvability > level %i is solvable` | `src/data/levels.test.ts:112-123` | 100 BFS | `validateLevel(...).solvable === true` and `path.length > 1` |
| `playability > level %i leaves room for the hand` | `src/data/levels.test.ts:139-153` | 100 BFS | same proof with `hitRadius + PLAYABLE_CLEARANCE` |
| `no wall is decoration > level %i` | `src/data/quality.test.ts:31-47` | 1 + N_walls BFS/level | removing any single wall must change `reachable` |

`PLAYABLE_CLEARANCE = 6` (`src/core/LevelValidator.ts:310`) — base pixels,
≈3 css px on a 390pt phone. The prose at `src/data/levels.test.ts:125-138`
records the incident: "Ten levels shipped that way, the worst leaving 0.3 css px
of margin on a phone". Solvable ≠ playable; the BFS proves the *centreline* has a
route and says nothing about its width.

`playability > measures real slack on the tightest level`
(`src/data/levels.test.ts:155-163`) is the guard on the guard. It pins the
tightest level's clearance into a **band**, not just a floor:

```ts
expect(tightest).toBeGreaterThanOrEqual(PLAYABLE_CLEARANCE);  // ≥ 6
expect(tightest).toBeLessThan(PLAYABLE_CLEARANCE * 3);        // < 18
```

The upper bound is deliberate: if `clearance` ever stopped discriminating, every
level would trivially pass the 100-test playability block. The `< 18` catches
that, and also catches "the hard end has quietly gone soft".

`no wall is decoration` (`src/data/quality.test.ts:31`) is O(Σ walls) full BFS
solves and is the single most expensive non-`levels` test at 15.4 s (worst level:
`l82`, 314 ms). The bar is deliberately strict — a wall is inert only when
`r.reachable === base.reachable` exactly, so a wall that merely narrows a
corridor is never flagged.

## 5. Master invariant table

| Invariant | Why it matters | Test name | file:line |
| --- | --- | --- | --- |
| **LOCKED**: mirror in normalized space is exactly `{1−x, y}` | Every level's authored coordinates mean this and nothing else | `agrees with the LOCKED normalized definition mirror(p) = {1-x, y}` | `src/core/Playfield.test.ts:53` |
| **LOCKED**: player may only draw where `x < 0.5` | If the clamp leaks, the reflection folds back into the left half and the mirror constrains nothing — the whole premise | `never lets a point cross the axis` | `src/core/Playfield.test.ts:92` |
| Clamped point ≤ axis ∧ its mirror ≥ axis | The reflection must land in the *right* half, never on top of the stroke | `keeps every clamped point at or left of its own reflection` | `src/core/Playfield.test.ts:111` |
| **LOCKED rule 1**: no level is mirror-symmetric | A symmetric level's reflection reveals nothing new → zero content | `every level is asymmetric about the mirror axis` | `src/data/levels.test.ts:86` |
| Every level has ≥1 wall with `x + w > 0.5` | Otherwise the reflection has nothing to clear | `gives every level at least one wall the reflection has to clear` | `src/data/levels.test.ts:97` |
| **LOCKED rule 2**: no tunnelling — swept segments, never point sampling | A flick delivers samples hundreds of px apart; per-point tests report "clear" for every one | `catches every crossing of a thin wall at every angle` | `src/core/Geometry.test.ts:283` |
| Tunnelling immunity survives the mirror too | The reflection is swept-tested with the same segment predicate | `catches a full-height flick that only the MIRROR intersects` | `src/core/CollisionSystem.test.ts:71` |
| Collision considers *both* the stroke and its mirror | This one assertion is the entire game | `blocks a segment whose MIRROR hits a wall` | `src/core/CollisionSystem.test.ts:38` |
| `firstHitT` reports t in the **original** parameterisation | The fail flash must be drawn where the player's finger was, not where the mirror was | `locates mirrored contact in the ORIGINAL parameterisation` | `src/core/CollisionSystem.test.ts:91` |
| `firstHitT` returns the **earlier** of the two sides | Contact point must be the first one, not whichever side is checked first | `returns the EARLIER of the two sides` | `src/core/CollisionSystem.test.ts:96` |
| `firstHitT() !== null` ⟺ `blocks()` | Two code paths, one predicate | `agrees with blocks() on every segment` | `src/core/CollisionSystem.test.ts:119` |
| **LOCKED rule 3**: `hitRadius = pt(2.6)` inside a `strokePt = 5` nib | Feel of the game; also the anti-pay-to-win boundary | `ships 2.6pt of collision inside a 5pt nib` | `src/render/Theme.test.ts:66` |
| Kill boundary sits exactly **0.2 base px outside** the visible ink | Documents a known deviation: spec asks for forgiving, ship is marginally strict. Change `hitRadius` and this test goes loud | `places the kill boundary 0.2 base px outside the visible ink` | `src/render/Theme.test.ts:79` |
| `hitRadius` must **never** appear in `InkTheme` | A purchasable skin that moved the kill boundary is pay-to-win | `keeps collision forgiveness out of the cosmetic theme` | `src/render/Theme.test.ts:84` |
| Rendered path stays within `hitRadius` of the raw path | The line the player *watches* must not lie about the line the game *tested* | `keeps the drawn path within the hit radius of the raw path at flick speed` | `src/core/StrokeRecorder.test.ts:233` |
| Raw Chaikin **alone** violates that bound | Proves the `densify` step is load-bearing, not decoration — deleting it is a silent regression this catches | `is the densify step that earns that — raw Chaikin alone blows the bound` | `src/core/StrokeRecorder.test.ts:244` |
| Bound holds at every stroke speed | Spacing 4 px (slow drag) → 304 px (full-screen flick) | `holds the bound over random strokes at every speed` | `src/core/StrokeRecorder.test.ts:250` |
| Render endpoints stay pinned to start dot and goal | Smoothing must not detach the stroke from the two things it must touch | `still keeps the endpoints pinned to the start dot and the goal` | `src/core/StrokeRecorder.test.ts:276` |
| Every inserted `densify` point lies exactly ON the raw segment | Densify adds detail, never shape — so it is geometrically free | `adds detail but never shape — every inserted point is ON the segment` | `src/core/StrokeRecorder.test.ts:181` |
| Sample spacing measured from last **accepted** point | Measuring from the last *offered* point would let a slow drift accumulate below threshold forever | `measures spacing from the last ACCEPTED sample, not the last offered` | `src/core/StrokeRecorder.test.ts:50` |
| `sampleMinDist ≤ hitRadius` | A dropped sample is within one hit radius of a tested one — that is what makes dropping it safe | `samples no more often than the hit radius` | `src/render/Theme.test.ts:93` |
| Touch cursor is lifted **above** the finger (smaller y) | Sign flip ⇒ the live end of the stroke sits under the thumb pad on every touch device | `lifts the cursor ABOVE the finger on touch` | `src/core/DrawCursor.test.ts:33` |
| Cursor offset ramps on **distance**, never time | A time ramp slides the collision-tested stroke while the finger is still, drawing ink the player never made | `does not move the cursor while the finger is still` | `src/core/DrawCursor.test.ts:55` |
| Ramp is monotonic and never overshoots below the finger | Nonsense/negative travel must not push the cursor past the finger | `is monotonic — the cursor only ever rises away from the finger`, `cannot be pushed below the finger by a nonsense travel value` | `src/core/DrawCursor.test.ts:75`, `:84` |
| Manufactured motion ≤ `min(2×travel, offsetY)` | Bounds how much the cursor can move that the finger did not | `never lifts the cursor further than the finger has travelled, plus the offset` | `src/core/DrawCursor.test.ts:110` |
| `BASE_WIDTH/BASE_HEIGHT < 0.5626` | Tall phones must letterbox into paper, not pillarbox and steal the mirror's width | `is a fixed 9:16 portrait logical space` | `src/render/Theme.test.ts:20` |
| Palette hex values are the spec's, exactly | `paper 0xe9ebe4`, `ink 0x16323c`, `wall 0x9a9c90`, `accent 0x8e3b62`, `fail 0xb4463c` | `matches the spec, exactly` | `src/render/Theme.test.ts:37` |
| Hand-authored tutorial level 1 is byte-for-byte frozen | **LOCKED** — the generator appends, it must never rewrite these | `keeps the hand-authored numbers exactly as tuned` | `src/data/levels.test.ts:38` |
| Set is exactly 5 tutorial + 95 generated = 100, `LEVELS[0].id === 'l1'` | Level-select UI, progress keys and store copy all assume 100 | `ships 100 levels, tutorial first` | `src/data/levels.test.ts:25` |
| Every level solvable against the **shipped** playfield + collision | An unsolvable level is invisible until someone wastes an evening on it | `level %i (%s "%s") is solvable` | `src/data/levels.test.ts:113` |
| Every level solvable with `hitRadius + 6` | Solvable ≠ playable; a corridor 2 px wider than the ink is undrawable | `level %i (%s "%s") leaves room for the hand` | `src/data/levels.test.ts:140` |
| Tightest level's clearance ∈ `[6, 18)` | Floor keeps it playable; ceiling proves `clearance` still discriminates | `measures real slack on the tightest level, not just a pass` | `src/data/levels.test.ts:155` |
| Every generated level has `interlock > 0.05` | Without overlap the level decomposes into "clear this, then that" and the mirror is decoration. Build 5 shipped with 98/100 at zero interlock | `makes every generated level squeeze from both halves at once` | `src/data/levels.test.ts:182` |
| Tutorial 1–4 have `interlock === 0`; level 5 `> 0.1` | Deliberate exemption: teach one constraint at a time, then combine | `teaches one half at a time first, then puts them together` | `src/data/levels.test.ts:189` |
| Mean generated interlock `> 0.2` | Stops a regression that clears the per-level bar by a hair on all 95 | `keeps the set substantially interlocked, not just past a threshold` | `src/data/levels.test.ts:196` |
| `difficulty` is non-decreasing across all 95 generated levels | The sort key is `difficulty`, **not** `pressure` — sorting by pressure ordered by how busy levels *looked* and left mirror demand at rho −0.057 | `never steps backwards within the generated set` | `src/data/levels.test.ts:222` |
| No 10-level band tightens by more than 45 % | A jump from 25 px slack to 13 px reads as the game breaking. That shipped once | `has no cliff — no ten-level band doubles the precision demand` | `src/data/levels.test.ts:246` |
| Last-20 clearance `< 0.6 ×` first-20; last-20 `interlockBands > 1.4 ×` first-20 | The ramp must raise precision *and* mirror demand, not just wall count | `ramps the two axes that matter, not just the wall count` | `src/data/levels.test.ts:230` |
| `pressure(LEVELS[0]) < 0.12`, `pressure(LEVELS[99]) > 0.4` | Opens gently, ends demanding | `opens gently and ends demanding` | `src/data/levels.test.ts:258` |
| Last-10 mean pressure `> 1.8 ×` first-10 | Aggregate ramp sanity | `rises overall from the first level to the last` | `src/data/levels.test.ts:206` |
| No wall is inert | 34 inert walls shipped across 30 levels; a wall that changes nothing promises a problem that does not exist | `level %i (%s) has no wall that changes nothing` | `src/data/quality.test.ts:31` |
| No two levels share a wall layout; no duplicate names | Machine-made sets repeat themselves | `has no two levels with the same wall layout`, `gives every level its own name` | `src/data/quality.test.ts:51`, `:63` |
| No two walls in a level overlap | Overlapping rects render as one blob and read as a fault | `never overlaps two walls into a single blob` | `src/data/quality.test.ts:70` |
| Every wall `w > 0.02` and `h > 0.02` normalized | Level-select previews draw walls a few px tall; a sliver looks like a rendering bug | `keeps every wall thick enough to read at card size` | `src/data/quality.test.ts:84` |
| Live hit area == painted area for centred buttons | The shipped build used `Rectangle(-w/2, -h/2, w, h)` and buttons responded on ~25 % of their face | `${c.name} responds over its whole face` (4 cases) | `src/render/HitArea.test.ts:20` |
| Fixed hit area does not overhang the neighbour above | The old bug let Gallery steal taps meant for Levels | `overhung its neighbour, stealing taps meant for the button above` | `src/render/HitArea.test.ts:60` |
| Native `GADApplicationIdentifier` == `admobUnits().appId` and matches `useTestAds` | Live app id + Google test units (or the reverse) is an AdMob policy violation; the plist is edited by hand and cannot follow the TS flag | `keeps the native app id in step with useTestAds` | `src/config/monetization.test.ts:45` |
| App id uses `~`, unit ids use `/`, all three units distinct | Swapping `~`/`/` or reusing one unit is the classic silent no-fill bug | `uses the right shape for app ids and unit ids`, `gives every format its own unit` | `src/config/monetization.test.ts:18`, `:28` |
| Retry interstitials cannot outrun the time floor | Count is a *permission*, clock is the *brake*. Attempt-count alone would fire an ad every ~25 s — AdMob disables ad serving over exactly this | `cannot fire on retries faster than the time floor allows` | `src/config/monetization.test.ts:90` |
| ATT string + SKAdNetwork list present, incl. `cstr6suwn9.skadnetwork` | Missing Google's own network makes installs unattributable | `declares ATT and the SKAdNetwork list the SDK needs` | `src/config/monetization.test.ts:57` |
| Ribbon width is speed-driven, clamped to `[minScale, maxScale]`, never NaN | Duplicate timestamps would divide by zero without the dt floor | `draws a slow hand thicker than a fast one`, `never returns a negative or NaN width` | `src/core/Ribbon.test.ts:34`, `:54` |
| Ribbon emits quads + discs, never a single self-intersecting outline | A hairpin folds an offset polygon through itself and a triangulator punches a hole in the ink | `survives a hairpin turn` | `src/core/Ribbon.test.ts:145` |
| `toScreenRect` scales `w` by playfield width and `h` by its **height** | The classic copy-paste (`h * this.w`) would silently change every wall's thickness and retune all 100 levels | `scales rect width by the playfield width and height by its height` | `src/core/Playfield.test.ts:39` |

### Monetization arithmetic, in detail

`src/config/monetization.test.ts:90-100` pins the retry-interstitial gate as an
**inequality between two config fields**, not as literal values:

```ts
expect(a.interstitialEveryNAttempts).toBeGreaterThanOrEqual(3);
const fastestFailSeconds = 3;
const soonestByCount = a.interstitialEveryNAttempts * fastestFailSeconds;
expect(soonestByCount).toBeLessThan(a.minSecondsBetweenInterstitials);
const worstCaseGapMinutes = a.minSecondsBetweenInterstitials / 60;
expect(worstCaseGapMinutes).toBeGreaterThanOrEqual(2);
```

With the shipped values (`src/config/monetization.ts:133,139`):
`interstitialEveryNAttempts = 5`, `minSecondsBetweenInterstitials = 120` →
`5 × 3 = 15 < 120` ✓ and `120/60 = 2 ≥ 2` ✓. **`worstCaseGapMinutes ≥ 2` has
zero headroom** — lowering `minSecondsBetweenInterstitials` by one second fails.

Shipped value vs the bound each cadence test enforces:

| Field | Shipped (`src/config/monetization.ts`) | Test bound | file:line | Headroom |
| --- | --- | --- | --- | --- |
| `interstitialFromLevel` | `8` (`:117`) | `≥ 6` | `:70` | 2 |
| `interstitialEveryNWins` | `3` (`:119`) | `≥ 3` | `:74` | **0** |
| `interstitialEveryNAttempts` | `5` (`:133`) | `≥ 3` | `:91` | 2 |
| `minSecondsBetweenInterstitials` | `120` (`:139`) | `≥ 120`, and `> 5×3` | `:75`, `:95` | **0** |
| `sessionWarmupSeconds` | `90` (`:142`) | `≥ 60` | `:77` | 30 |
| `maxInterstitialsPerSession` | `4` (`:145`) | `≤ 4` | `:76` | **0** |
| `muteAfterRewardedSeconds` | `300` (`:147`) | `≥ 180` | `:103` | 120 |
| `reveals.offerSkipAfterAttempts` | `6` (`:161`) | `≥ 5` | `:107` | 1 |

Three fields are pinned to their exact shipped value by a one-sided bound. Any
"make it slightly more aggressive" edit to `interstitialEveryNWins`,
`minSecondsBetweenInterstitials` or `maxInterstitialsPerSession` fails the suite
immediately — which is the intent (`src/config/monetization.ts:20-33`).

### `METRICS` pins, in detail (`src/render/Theme.test.ts`)

| Assertion | Value | Line |
| --- | --- | --- |
| `PT === 2`, `pt(5) === 10`, `pt(2.6) ≈ 5.2` | 2× logical points | `:28-33` |
| `METRICS.hitRadius === pt(2.6)` (= 5.2 base px) | LOCKED rule 3 | `:67` |
| `theme().strokePt === 5`, `hitRadius < pt(strokePt)` | Nib wider than the kill radius | `:68-69` |
| `hitRadius − pt(strokePt)/2 ≈ 0.2` | Kill boundary 0.2 base px outside the ink | `:81` |
| `METRICS.sampleMinDist === pt(2.6)` and `≤ hitRadius` | Dropped sample is always within one hit radius of a tested one | `:94-97` |
| `METRICS.touchOffsetY === pt(42)` | 42pt thumb clearance | `:101` |
| `METRICS.touchOffsetRampPx === pt(21)`, `> 0`, `≤ touchOffsetY` | Distance ramp, half the offset | `:107-111` |
| `METRICS.renderMaxSpacing === pt(5)`, `≤ pt(strokePt)` | Bounds Chaikin's corner cut to inside the nib | `:115-118` |
| `METRICS.startGrabFactor === 2.4`, `startRadius × 2.4 === pt(24)` | 24pt grab target on a 10pt dot | `:122-123` |
| `METRICS.failFlashMs === 400`, `< 1000` | Sub-second recovery, no modal, no tap | `:127-128` |
| `METRICS.winSettleFrom === 0.97`, `winSettleMs === 350`, `winHoldMs > 0` | Win figure hold-then-settle | `:132-134` |
| `METRICS.smoothIterations > 0` | Render smooths; collision does not | `:138` |
| `theme().mirrorAlpha === 0.45`, `winFillAlpha === 0.11`, `axisAlpha === 0.16` | Spec opacities | `:47-50` |
| `rgba(ink, 0.11) === 'rgba(22,50,60,0.11)'` | Exact CSS string the spec names | `:54` |

`src/core/DrawCursor.test.ts:100-108` independently re-pins the shipped lift:
feeding `METRICS.touchOffsetY` / `touchOffsetRampPx` through `drawCursor` must
produce a lift of exactly `pt(42)`. So `touchOffsetY` is pinned in two files.

## 6. What is NOT covered

Coverage is by *file pairing* (`X.ts` has an `X.test.ts` beside it). Of 7 690
non-test lines under `src/`, **6 178 (80 %) sit in 20 files with no spec file at
all** — 4 427 of those are logic, the remaining 1 751 are the
`generatedLevels.ts` data table (which is heavily validated, just not by a spec
of its own). Every claim about the files below must be verified by reading the
source or running the app.

| Untested file | Lines | Blind spot |
| --- | --- | --- |
| `src/scenes/GameScene.ts` | 707 | The entire play loop: input → stroke → collision → win/fail. No test drives a stroke end to end |
| `src/render/InkRenderer.ts` | 432 | All actual drawing. `Ribbon`'s geometry is tested; nothing renders it in a test |
| `src/render/UI.ts` | 372 | Buttons, labels, layout. Only `HitArea`'s pure maths is covered |
| `src/core/LevelValidator.ts` | 337 | **No dedicated spec, yet 320 of the 506 tests depend on it.** Its correctness is assumed, never proved |
| `src/scenes/LevelSelectScene.ts` | 308 | Grid, locking, previews |
| `src/systems/Progress.ts` | 304 | Save/load, unlock rules, migration. Untested persistence |
| `src/systems/Ads.ts` | 302 | The runtime that *consumes* the pinned `monetization` config. The config arithmetic is tested; the code enforcing it is not |
| `src/render/ScrollView.ts` | 272 | Momentum, clamping, tap-vs-drag disambiguation |
| `src/scenes/GalleryScene.ts` | 249 | Saved-figure browsing |
| `src/scenes/MenuScene.ts` | 216 | Menu, banner reserve |
| `src/systems/Iap.ts` | 206 | Purchase, restore, entitlement. **Untested money path** |
| `src/render/ShareCard.ts` | 204 | Share image composition |
| `src/systems/Audio.ts` | 173 | — |
| `src/systems/Share.ts` | 104 | Native share bridge |
| `src/main.ts` | 67 | Phaser bootstrap, scale config |
| `src/scenes/BootScene.ts` | 55 | — |
| `src/systems/Haptics.ts` | 47 | — |
| `src/systems/Rate.ts` | 38 | Rate-prompt trigger |
| `src/data/generatedLevels.ts` | 1751 | Data, not logic — but *validated* by `levels.test.ts` / `quality.test.ts` |
| `src/data/types.ts` | 34 | Types only |
| `scripts/genLevels.ts` | — | Excluded by `include: ['src/**/*.test.ts']`. The generator that produced the 95 levels is never exercised; only its output is checked |

Specific blind spots worth naming:

- **No integration test exists.** Nothing constructs a `GameScene`, feeds
  pointer events, and asserts a win or a fail. Every scene-level behaviour is
  verified by hand only.
- **No native bridge is stubbed or mocked.** `@capacitor/*`, `admob`,
  `cordova-plugin-purchase`, `in-app-review`, `haptics`, `filesystem`,
  `preferences`, `share` — none are exercised. `monetization.test.ts` reads the
  plist as *text*; it never calls the SDK.
- **The Android ad path is untested and currently broken-by-config.**
  `LIVE_ANDROID` is `{ appId: '', banner: '', interstitial: '', rewarded: '' }`
  (`src/config/monetization.ts:83-88`) and `useTestAds` is `false`
  (`:105`). `adsConfigured()` would return `false` on Android. The test
  `reports itself configured` (`src/config/monetization.test.ts:34`) passes only
  because `Capacitor.getPlatform()` returns `'web'` under vitest, so the
  `isAndroid()` branch of `admobUnits()` (`:174-175`) is never taken. **Do not
  read that green test as "ads work on Android".**
- **No persistence test.** `Progress.ts` writes via `@capacitor/preferences`; a
  save-format change has no regression net.
- **`setTheme` success path is untested.** `THEMES` contains only `paper`
  (`src/render/Theme.ts:88-90`), so `src/render/Theme.test.ts:58` only covers
  the *rejection* branch. Adding a second ink pack ships with no coverage.
- **`METRICS` ↔ `LevelValidator` defaults are duplicated, not pinned.**
  `validateLevel` defaults to `cell = 6`, `hitRadius = 5.2`, `goalRadius = 30`
  (`src/core/LevelValidator.ts:57-59`), `clearance` defaults to `5.2`
  (`:175`) and `pressure` hardcodes `new CollisionSystem(walls, 5.2, pf.axisX)`
  (`:322`). Those *happen* to equal `METRICS.hitRadius = pt(2.6)` and
  `METRICS.goalRadius = pt(15)`.
  `difficulty()` (`:275`) calls `clearance(level, pf)` and
  `validateLevel(level, pf)` **with no options**, so it always uses the
  hardcoded defaults regardless of `METRICS`. No test asserts the two stay in
  step: change `METRICS.hitRadius` and `solvability`/`playability` will react,
  but `difficulty` and `pressure` silently will not.

### Reading a green suite honestly

Green means: the geometry primitives agree with each other, the 100 shipped
levels are provably solvable *and* drawable with a real hand under the shipped
metrics, the LOCKED constants are unchanged, and the monetization config cannot
have been quietly loosened. Green says **nothing** about whether the game boots,
renders, saves, shows an ad, or completes a purchase.

## See also

- [00-index.md](00-index.md) — doc set entry point
- [01-architecture.md](01-architecture.md) — module layering and why `core/` is Phaser-free
- [02-coordinate-system.md](02-coordinate-system.md) — normalized vs base-pixel space, `PT`, `BASE_WIDTH/HEIGHT`
- [03-geometry-collision.md](03-geometry-collision.md) — `segRect` / `segRectEntryT` / `CollisionSystem` internals
- [04-stroke-ribbon.md](04-stroke-ribbon.md) — `StrokeRecorder`, `chaikin`, `densify`, `renderPath`, `Ribbon`
- [05-rendering.md](05-rendering.md) — `InkRenderer`, `Theme`, `HitArea`
- [06-scenes.md](06-scenes.md) — the untested scene layer
- [07-levels-data.md](07-levels-data.md) — `Level` shape, `TUTORIAL_LEVELS`, `GENERATED_LEVELS`
- [08-level-generation.md](08-level-generation.md) — `LevelValidator`, `difficulty`, `interlock`, `scripts/genLevels.ts`
- [09-systems.md](09-systems.md) — `Progress`, `Audio`, `Haptics`, `Share`, `Rate`
- [10-monetization.md](10-monetization.md) — `Ads`, `Iap`, the config the cadence tests pin
- [11-build-release.md](11-build-release.md) — `npm run build`, `ios:sync`, plist and version handling
- [13-api-reference.md](13-api-reference.md) — exact exported signatures
- [14-glossary.md](14-glossary.md) — interlock, clearance, pressure, reveal, nib
- [15-change-recipes.md](15-change-recipes.md) — which tests to expect red for a given change
- [../README.md](../README.md) — narrative rationale for the LOCKED rules
- [../SUBMIT.md](../SUBMIT.md) — release checklist
