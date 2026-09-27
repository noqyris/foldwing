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
> **1.4 (September 2026)** roughly quadrupled the suite: 50 spec files, most of the
> new ones pinning the economy, the store, the reminders and the pure layout of the
> new screens (§7). The browser QA that drove 1.4 through the real game is **not in the
> repo** — §8 says what it was and how to rebuild it — and the DEV switches it leaned on
> are listed there. The monetization numbers in §5 are brought up to date.

---

# Test Suite Map & Pinned Invariants

## What this covers

The entire automated safety net: 11 spec files and 506 tests when this page was
written, 50 spec files since 1.4 (`npx vitest run` prints the real count), run by
Vitest in the `node` environment. Which invariant each suite pins, where the fuzz/property
tests live and how many cases they really run, what the 100-level re-proof costs
in wall time, and — at the end — the large untested surface (all scenes, all
renderers, all native bridges) so a model knows exactly where it is flying blind.

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `src/core/Geometry.test.ts` | 435 | Primitive geometry; the segRect ↔ segRectEntryT cross-proof |
| `src/core/StrokeRecorder.test.ts` | 329 | Sampling threshold, Chaikin, densify, render-vs-collision bound |
| `src/data/levels.test.ts` | — | 300-level solvability + playability re-proof, difficulty ramp, the tutorial-maze pin, fingerprints of levels 6–300 and of the Daily Fold |
| `src/systems/Progress.test.ts` | — | Hostile saves, the v1→v2 and v2→v3 save migrations, bounded storage, reveals, the daily ledger and streak |
| `src/core/Ribbon.test.ts` | 168 | Speed→width profile, quad/disc tessellation |
| `src/core/CollisionSystem.test.ts` | 134 | Own-side + mirrored-side blocking, `firstHitT` |
| `src/core/Playfield.test.ts` | 134 | Normalized→screen mapping, the soft wall at the axis |
| `src/render/Theme.test.ts` | 140 | LOCKED palette and `METRICS` constants |
| `src/config/monetization.test.ts` | — | Native project free of Google ad identifiers, ATT + SKAdNetwork + consent-provider keys, ad-cadence arithmetic, reveal packs |
| `src/systems/providers/levelplay.test.ts`, `src/systems/adProvider.test.ts`, `src/systems/adsMock.test.ts` | — | LevelPlay ids per platform, consent before the SDK, the reward race, prefetch, the build-mode markers, no TEST ADS badge |
| `src/data/quality.test.ts` | 94 | No inert wall, no duplicate layout, no hairline geometry |
| `src/render/HitArea.test.ts` | 73 | Phaser hit-rect regression (buttons live over their whole face) |
| `src/core/DrawCursor.test.ts` | 118 | Touch cursor lift, distance-gated ramp |
| `src/core/{Streak,Missions,Rewards,Rescue,RouteProgress}.test.ts` | — | 1.4: streak through bookmarks and repair, the day's missions, chapter marks, the rescue ladder and its pill band, the near-miss distance field |
| `src/systems/{Iap,iapMock,Rate,NudgePlan,Nudges,Haptics}.test.ts` | — | 1.4: the store's credit-once path, the fake store, the review rule, the reminder plan and the never-prompting service, the reward-tap throttle |
| `src/systems/{Ads,adsLevelplay,Audio,Share,Music,GameCenter,Daily}.test.ts` | — | Paired since this page was written, before 1.4: the ad policy, the synthesised sounds, the share pipeline, Game Center, the Daily |
| `src/systems/SessionClock.test.ts` | — | The ad session's age counts foreground time only: an absence pauses it, `start()` (a new session) puts it back at zero; a start in the background, repeated hide/show events and a clock set back |
| `src/core/Session.test.ts`, `src/systems/SessionLifecycle.test.ts`, `src/systems/SessionScope.test.ts` | — | What counts as a session: ≥ 30 min from the FIRST hide, or a new local day; a visible without a hide and a clock set back are not pauses; the persisted count, the first-session lift, listeners, the ATT starter gate (film gone, then app active, re-checked after registering) and `main.ts`'s wiring; and what no session listener may touch — the save, the daily rewarded cap and the every-Nth counters included. Every rule mutation-checked — see [09-systems.md](09-systems.md) §8 |
| `src/render/{StoreSheet,ResultCard,DailyCard,MenuLayout,StreakSheet,MissionsSheet,SafeArea,UI.toast,InkRenderer}.test.ts`, `src/scenes/{LevelSelectScene,GalleryScene}.test.ts` | — | 1.4: the pure models and layouts behind every new screen (Phaser mocked where a module imports it) |
| `vite.config.ts` | — | Vitest config lives here (`test.environment`, `test.include`, `test.env.TZ`) |
| `package.json` | 38 | `test` / `test:watch` / `typecheck` scripts |

---

## 1. How to run

```bash
npm test           # vitest run              — single pass, exits
npm run test:watch # vitest                  — watch mode
npm run typecheck  # tsc --noEmit            — not part of vitest
npm run build      # tsc --noEmit && vite build — typecheck gates the build
```

There is **no `vitest.config.ts`**. Config is inlined in `vite.config.ts`:

```ts
test: {
  environment: 'node',
  include: ['src/**/*.test.ts'],
  env: { TZ: 'Europe/Belgrade' },
},
```

The zone is pinned on purpose: the Daily, the free reveal, the streak and the reminder
plan roll over at LOCAL midnight, and on a UTC runner the tests that catch a UTC slip
pass vacuously. Belgrade also has DST (2026-10-25), which the streak and reminder tests
cross. The same file's `define` sets `VITE_APP_VERSION` for the suite too, so
`Rate.test.ts` can pin it to the Xcode project's `MARKETING_VERSION`.

Consequences:

- `environment: 'node'` — there is no DOM, no `window`, no canvas. **The real
  Phaser is never imported by any test** (it cannot load in node). That is why
  `src/core/*` and the pure layout and model functions are Phaser-free, and why
  the 1.4 suites for modules that do import it — `UI.toast`, `StoreSheet`,
  `ResultCard`, `DailyCard`, `StreakSheet`, `MissionsSheet`, `InkRenderer`, the two
  scene tests — replace `phaser` with a `vi.mock` stub and test only the exported
  pure parts. Nothing in the suite draws.
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
| Tutorial maze `l1` deep-equals its generated literal; the five names are `First reflection`, `Zigzag`, `Gate`, `Sacrifice`, `Tangle` | The tutorial is generated by `scripts/genTutorialMazes.ts` from `MazeGen` (it replaced the LOCKED hand-authored bars in September 2026). A `MazeGen` change that would silently re-carve the player's first maze fails here | `keeps the tutorial mazes exactly as generated` | `src/data/levels.test.ts` |
| Set is exactly 5 tutorial + 295 generated = 300, `LEVELS[0].id === 'l1'` | Level-select UI, progress keys and store copy all assume 300 | `ships 300 levels, tutorial first` | `src/data/levels.test.ts:57` |
| Every id equals its position, `l${i + 1}` | The save keys `cleared` / `bestMs` / `medals` by id but unlocks by index; the schema-3 migration relies on the two meaning the same | `keys every level by its position, because the save stores ids` | `src/data/levels.test.ts` |
| sha256 of `GENERATED_LEVELS` is fixed, and `LEVELS.slice(5)` is that array | Levels 6–300 must not move under a `MazeGen` refactor: saved clears would land on different mazes | `keeps levels 6 to 300 byte-identical to the shipped set` | `src/data/levels.test.ts` |
| sha256 of 60 consecutive Daily Folds (from 2026-09-01) is fixed | Two phones on one date must get one puzzle, before and after any `MazeGen` change | `keeps every Daily Fold identical to the one players already had` | `src/data/levels.test.ts` |
| A v2 save forgets `cleared` / `bestMs` / `medals` for `l1`–`l5` only — exact ids, never a prefix, and only once — and keeps `unlockedIndex`, figures and everything not keyed by a level id | Save schema 3 gave `l1`–`l5` new content. Without it an upgrading player sees mazes they never played marked cleared, with bar-era best times on them | `the v2 to v3 migration: the tutorial became mazes` (11 cases) | `src/systems/Progress.test.ts:311` |
| Every level solvable against the **shipped** playfield + collision | An unsolvable level is invisible until someone wastes an evening on it | `level %i (%s "%s") is solvable` | `src/data/levels.test.ts:113` |
| Every level solvable with `hitRadius + 6` | Solvable ≠ playable; a corridor 2 px wider than the ink is undrawable | `level %i (%s "%s") leaves room for the hand` | `src/data/levels.test.ts:140` |
| Tightest level's clearance ∈ `[6, 18)` | Floor keeps it playable; ceiling proves `clearance` still discriminates | `measures real slack on the tightest level, not just a pass` | `src/data/levels.test.ts:155` |
| Every generated level has `interlock > 0.05` | Without overlap the level decomposes into "clear this, then that" and the mirror is decoration. Build 5 shipped with 98/100 at zero interlock | `makes every generated level squeeze from both halves at once` | `src/data/levels.test.ts:182` |
| Mean generated interlock `> 0.2` | Stops a regression that clears the per-level bar by a hair on all 95 | `keeps the set substantially interlocked, not just past a threshold` | `src/data/levels.test.ts:196` |
| `difficulty` never steps backwards from level 1 to level 300, and rises **strictly** from `l1` through `l6` | The sort key is `difficulty`, **not** `pressure` — sorting by pressure ordered by how busy levels *looked* and left mirror demand at rho −0.057. The bar tutorial was exempt and stepped backwards twice, once into level 6; the tutorial mazes are chosen to rise into it (0.120 → 0.143, level 6 at 0.148). The old `interlock === 0` pin on tutorial 1–4 went with the bars | `never steps backwards, from level 1 to level 300` | `src/data/levels.test.ts:301` |
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
| No Google ad identifier anywhere in the native project | The AdMob publisher account is closed for good; a Google id or plist key in the binary is zero revenue and a fresh policy record (the AdMob-era app-id ↔ `useTestAds` agreement test went with AdMob) | `carries no Google ad identifier of any kind` | `src/config/monetization.test.ts` |
| iOS has its own LevelPlay key and three distinct units; Android has none | Reusing one unit, or lending the iOS ids to another platform, reports the wrong inventory | `is configured on iOS, with its own key and three distinct units`, `keeps unit ids per platform, and never lends the iOS ones to Android` | `src/systems/providers/levelplay.test.ts` |
| Retry interstitials cannot outrun the time floor | Count is a *permission*, clock is the *brake*. Attempt-count alone would fire an ad every ~25 s — AdMob disabled ad serving over exactly this, and the rule was kept for LevelPlay | `cannot fire on retries faster than the time floor allows` | `src/config/monetization.test.ts:90` |
| ATT string + the SKAdNetwork ids LevelPlay and Unity Ads attribute through, and **not** Google's `cstr6suwn9` | Missing ids make installs unattributable; Google's id is refused by the no-Google gate | `declares ATT and the SKAdNetwork ids LevelPlay and Unity Ads attribute through` | `src/config/monetization.test.ts` |
| Ribbon width is speed-driven, clamped to `[minScale, maxScale]`, never NaN | Duplicate timestamps would divide by zero without the dt floor | `draws a slow hand thicker than a fast one`, `never returns a negative or NaN width` | `src/core/Ribbon.test.ts:34`, `:54` |
| Ribbon emits quads + discs, never a single self-intersecting outline | A hairpin folds an offset polygon through itself and a triangulator punches a hole in the ink | `survives a hairpin turn` | `src/core/Ribbon.test.ts:145` |
| `toScreenRect` scales `w` by playfield width and `h` by its **height** | The classic copy-paste (`h * this.w`) would silently change every wall's thickness and retune all 100 levels | `scales rect width by the playfield width and height by its height` | `src/core/Playfield.test.ts:39` |

### Monetization arithmetic, in detail

`src/config/monetization.test.ts` pins the retry-interstitial gate as an
**inequality between config fields**, not as literal values:

```ts
expect(a.interstitialEveryNAttempts).toBeGreaterThanOrEqual(3);
const fastestFailSeconds = 3;
const soonestByCount = a.interstitialEveryNAttempts * fastestFailSeconds;
expect(soonestByCount).toBeLessThan(a.lateSecondsBetweenInterstitials);
const worstCaseGapMinutes = a.lateSecondsBetweenInterstitials / 60;
expect(worstCaseGapMinutes).toBeGreaterThanOrEqual(2);
expect(a.interstitialEveryNAttempts).toBeGreaterThan(monetization.reveals.offerSkipAfterAttempts);
```

With the shipped values: `8 × 3 = 24 < 120` ✓, `120 / 60 = 2 ≥ 2` ✓ (**zero
headroom** on the late floor), and `8 > 6` — the count sits beyond the rescue ladder,
so a difficulty spike sells the rewarded offer, not an interstitial.

Shipped value vs the bound each cadence test enforces:

| Field | Shipped | Test bound | Headroom |
| --- | --- | --- | --- |
| `interstitialFromLevel` | `8` | `≥ 6` | 2 |
| `interstitialEveryNWins` | `3` | `≥ 3` | **0** |
| `interstitialEveryNAttempts` | `8` | `≥ 3`, `× 3 < lateSeconds`, `> offerSkipAfterAttempts` | 1 (against the ladder) |
| `minSecondsBetweenInterstitials` | `180` | `≥ 120`, `≥ lateSeconds` | 60 |
| `lateSecondsBetweenInterstitials` | `120` | `≥ 120`, and the worst-case gap `≥ 2` min | **0** |
| `sessionWarmupSeconds` | `180` | `≥ 120`, `< longSessionAfterSeconds` | 60 |
| `maxInterstitialsPerSession` | `8` | `≥` half of what the late floor allows in half an hour | a backstop, not the pacing |
| `muteAfterRewardedSeconds` | `300` | `≥ 180` | 120 |
| `reveals.offerSkipAfterAttempts` | `6` | `≥ 5` | 1 |

Two fields are pinned to their exact shipped value by a one-sided bound: any "make it
slightly more aggressive" edit to `interstitialEveryNWins` or
`lateSecondsBetweenInterstitials` fails the suite immediately — which is the intent.

The 1.4 **economy** is pinned the same way, as sums (`describe('the economy')`): the day's
top-up plus every mission's reward ≤ 4 and under the smallest pack; `3 ≤
rewardedRevealsPerDay ≤ 10`; a chapter pays ≤ 5; a streak's first 30 days pay ≤ 12
milestone reveals (≤ 15 at the bookmark cap, with the overflow); the starter is
`reveals25`, matches its count and is not a rung; the repair cooldown is ≥ 7 days; the
win frame scale is in (0.5, 1]. And the store's honesty functions against real
storefront fixtures (`the sellable ladder`, `the starter offer`): USD keeps 10/20/30 and
badges the 30, Serbia drops the 20, the UK drops the 10, nothing is judged before the
prices arrive, and a starter that is not cheaper per reveal than every rung is not shown.

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

Coverage is by *file pairing* (`X.ts` has an `X.test.ts` beside it). When this page
was written, 80 % of the non-test lines under `src/` sat in files with no spec at all;
1.4 paired most of the systems and every new pure model, but the scenes and the drawing
are still unpaired. Every claim about the files below must be verified by reading the
source or running the app — which, for these, means the browser harness in §8.

| Untested file | Blind spot |
| --- | --- |
| `src/scenes/GameScene.ts` | The entire play loop: input → stroke → collision → win/fail, the win card's timeline, the rescue pills, the refill auto-use. No test drives a stroke end to end; the pure pieces it calls (`Rescue`, `ResultCard`'s layout, `RouteProgress`, `settleWin`) are tested |
| `src/scenes/MenuScene.ts` | The menu, its moments and sheets. `MenuLayout`, `DailyCard`, `StreakSheet` and `MissionsSheet` models are tested; the scene that plays them is not |
| `src/render/InkRenderer.ts` | All actual drawing. `InkRenderer.test.ts` covers only its pure helpers |
| `src/render/UI.ts` | Buttons, chips, toasts, flights. `ToastQueue`, `countText`, `flyReward`'s zero/NaN landing and `pulse`'s rest scale are tested; the rest is Phaser |
| `src/core/LevelValidator.ts` | **No dedicated spec, yet every level test depends on it.** Its correctness is assumed, never proved |
| `src/render/ScrollView.ts` | Momentum, clamping, tap-vs-drag disambiguation |
| `src/main.ts` | Phaser bootstrap, the foreground hook, the warm reminder tap, desk mode |
| `src/scenes/BootScene.ts` | The cold reminder route, the entitlement handoff |
| `src/render/Intro.ts` | The once-a-day film and `skipIntro` |
| `src/data/generatedLevels.ts` | Data, not logic — but *validated* by `levels.test.ts` / `quality.test.ts` |
| `scripts/genLevels.ts` | Excluded by `include: ['src/**/*.test.ts']`. Only its output is checked |

Paired since this page was first written, and so no longer blind: `Progress`, `Ads`,
`Iap` (the credit-once path against the real Progress, flush before finish, the cancel
fast path, Ask to Buy, unreturned products), `Rate`, `Audio`, `Haptics`, `Share`,
`Nudges`, `Music`, `GameCenter`, `Daily`.

Specific blind spots worth naming:

- **No integration test exists in the repo.** Nothing in `npm test` constructs a
  `GameScene`, feeds pointer events, and asserts a win or a fail. Scene-level
  behaviour is verified in a real browser by the harness in §8, which lives outside
  the repo, and on the simulator and the owner's phone.
- **Few native bridges are stubbed.** `@capacitor/*`, `cordova-plugin-purchase`,
  `in-app-review`, `haptics`, `filesystem`, `preferences`, `share` are not
  exercised. The LevelPlay plugin is the exception: `providers/levelplay.test.ts`
  mocks `capacitor-levelplay-ads` to pin call order and event races — which proves
  the JavaScript contract, not that the native SDK fills. `monetization.test.ts`
  reads the plist as *text*; it never calls the SDK.
- **There is no Android ad path.** No LevelPlay Android app exists, so the
  Android key and units are empty and every ad path no-ops there by design;
  `providers/levelplay.test.ts` pins exactly that. **Do not read a green suite
  as "ads work on Android".**
- **Persistence is tested against an in-memory `@capacitor/preferences`.**
  `Progress.test.ts` round-trips real JSON through a `Map`, so hostile saves and
  both schema migrations (v1→v2 drops every id-keyed entry; v2→v3 drops `l1`–`l5`
  only, runs once, and leaves a newer build's save alone) are pinned. The native
  UserDefaults write itself is not exercised.
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

Green means: the geometry primitives agree with each other, the 300 shipped
levels are provably solvable *and* drawable with a real hand under the shipped
metrics, the LOCKED constants are unchanged, the monetization config and the economy's
sums cannot have been quietly loosened, a purchase is credited exactly once through the
code the phone runs, and the reminder plan never prompts and never lies. Green says
**nothing** about whether the game boots, renders, shows an ad, or completes a real
StoreKit purchase.

## 7. The 1.4 suites

What each new or extended suite pins, in one line each. The dates are passed in, never
read from the clock, so every one of them runs the same on any day.

| Suite | Pins |
| --- | --- |
| `core/Streak.test.ts` | A bookmarked day bridges the streak but does not count; `longest` counts through bridges; the guard spends only when the gap fits the bookmarks and the run is ≥ 2, never bridges a 1-day run, and is idempotent; the repair window is exactly one missed day, respects the 14-day cooldown and refuses a day a bookmark covers; the milestone table, with the bookmark overflow to a reveal; a jump pays each milestone day once; DST on 2026-10-25 |
| `core/Missions.test.ts` | The same date deals the same three, slot one always the Daily; `new2` and `best` only where they can be done; a Daily win never advances slots 2–3; a replay counts for `wins3` and `medal`, not `new2`; each pays once; an unknown id nulls the record |
| `core/Rewards.test.ts` | 15 chapters, `chapterOf(0..19) = 0`, `chapterOf(299) = 14`; the 9→10 and 19→20 crossings pay once each; a skip does not count and a replay pays nothing; the backlog sum on a seeded 1.3 save |
| `core/Rescue.test.ts`, `core/RouteProgress.test.ts` | The reveal-before-skip ladder (3 / 6 / 9) and the pill band under the start dot; the near-miss field never lets a dead end borrow a later corridor's number, and rises along the solver's path |
| `systems/Progress.test.ts` (extended) | Every 1.4 field against hostile values; the one grant path and `onGrant`; `settleWin` for a first clear, a replay, 9→10, 19→20, a medal, a Daily milestone, a rerun and an owner; the guard, the repair and the refund of a bookmark spent on a day folded after midnight; the ad cap and its clock-back rule; credited transaction ids; play days and the review-prompt fields; the bookmark seed for a 1.3 save; Game Center's week ignores bookmarked days |
| `systems/Iap.test.ts`, `systems/iapMock.test.ts` | Against the real Progress: five products in one `register`; a duplicate transaction credited once; on disk before `finish()`; a cancel answers in under 100 ms; Ask to Buy returns `'pending'` and lands later as a late purchase (Remove Ads too); an unreturned product is dropped; a store that failed to start is not "payments off". The mock is never selected on native or without the flag, sells the config's ids, and contains no ad-marker literal |
| `render/StoreSheet.test.ts` | Row order; the starter hidden when bought, for owners, before five wins, while pending, or when it is not a deal; the ad row gone at the cap and for owners, with "N left today"; the free row the only primary; every price line ≥ 4.5:1 at rest and pressed; the non-row states (owner, payments off, unreachable, the cap footnote) and when the sheet is null |
| `systems/NudgePlan.test.ts`, `systems/Nudges.test.ts` | At most one reminder a day plus the saver at streak ≥ 3; nothing in quiet hours or within a minute; ≤ 8, ids 8101–8109; nothing while the Daily is locked; bookmark-holder copy; no reveal copy for owners; T's median, clamp and rounding; DST in Belgrade and New York; length limits at a 365-day streak; no template or title on consecutive days, across rebuilds, over a 40-player simulation; `routeForTap`. `rebuild()` never schedules or requests while permission is undecided or the switch is off, cancels the range first, serialises, coalesces and dedupes; `shouldSoftAsk`'s cap, spacing and decided case |
| `systems/Rate.test.ts` | `isPeak` / `shouldAskAt` at every boundary; spent per version and still spent after a relaunch; a pre-1.4 `ratePrompted` save gets its ask; the second-day wait; purchases and skips stand it down, a new session (30 min from the first hide, or a new day) resets that and the cold launch's own announcement does not; `VITE_APP_VERSION` equals the pbxproj's `MARKETING_VERSION` |
| `render/ResultCard.test.ts`, `MenuLayout.test.ts`, `DailyCard.test.ts`, `StreakSheet.test.ts`, `MissionsSheet.test.ts`, `SafeArea.test.ts` | The pure layouts at canvas scales 0.317–0.626 (card above the banner, buttons at the tap floor, nothing past the menu's foot line, tap bands never overlapping); every Daily card kind, the 18:00 boundary, the tutorial lock; the Streak sheet's repair row, titles and next milestone; mission routes; `bannerLift` and desk mode on the iPhone Duo shapes |
| `render/UI.toast.test.ts`, `systems/Haptics.test.ts`, `systems/Audio.test.ts`, `render/Theme.test.ts` | `ToastQueue` (cap, same-tone replace, the urgent slot); `countText` and `flyReward`'s zero/NaN landing; the reward-tap throttle; the new sounds render offline; the medal golds and contrast tokens |
| `scenes/LevelSelectScene.test.ts`, `scenes/GalleryScene.test.ts` | The chapter header's next unpaid mark ("+1 at 10", then "+2 at 20", none for owners); gallery captions ("12 · 7.5 s", "Daily #54 · 7.5 s") |

---

## 8. Browser QA: the harness that is not in the repo

The 1.4 QA ran the real game in a real browser — every menu state, the store with the
fake store, the win cards, the rescue pills, reminders, Duo shapes — with a Playwright
harness that lived in the session scratchpad and was **never committed**. The repo's
`package.json` has no Playwright dependency. What is in the repo is
`scripts/screenshots/capture.mjs`, which carries the same proved-stroke code for the
store screenshots and is the place to start a rebuild (`FW_PLAYWRIGHT` points it at a
Playwright install anywhere).

**Rebuilding it, in the order that matters:**

1. **Serve the mock build** on a fixed port: `VITE_ADS=mock npx vite --port 5199
   --strictPort` (it is `npm run dev:mock` on a pinned port). Its ads are drawn in the
   page and call no network, so every ad surface is safe to tap, and it sells through
   the fake store. Never point a harness at an `ADS:on` build. Store screenshots are the
   exception the other way: they come from an **ads-off** server
   (`VITE_ADS=off VITE_AD_MODE=test npx vite --port 5200 --strictPort`), and
   `capture.mjs` refuses to continue unless the app reports `ADS:off`.
2. **Playwright outside the repo** (`npm i playwright` in a scratch folder), driving
   **headed real Chrome** — `chromium.launch({ channel: 'chrome', headless: false })`.
   Headless Chrome renders WebGL through SwiftShader: a blank canvas, or ~700 ms a frame.
   Keep the windows unoccluded; macOS throttles `requestAnimationFrame` in hidden ones.
3. **Seed the save before the app runs**: `context.addInitScript` writing
   `localStorage['CapacitorStorage.foldwing.save.v1']`. Never set it and reload —
   `Progress` flushes its in-memory save on `pagehide` and overwrites yours. The
   studio sting (`@noqyris/splash`) plays on phones only, so a browser run starts
   straight on the game.
4. **Use the app's own module instances.** Import the URL the page actually loaded —
   look it up in `performance.getEntriesByType('resource')` after raising the buffer —
   because after a Vite hot update the app has `…/Progress.ts?t=…`, and a plain
   `import('/src/systems/Progress.ts')` gets an empty second copy. And hand the page a
   `vite-hmr` WebSocket that never opens: several sessions edit this tree, and a hot
   swap once tore down a Game scene mid-run.
5. **Win only with proved routes.** Plan the validator's BFS path at `hitRadius + 7`,
   then `+6`, `+5` — never thinner by default — resample it to whole CSS pixels mapped
   back through Phaser's transform, run the game's own grab test, `cursorFor` (touch
   offset included), `collision` at the real `hitRadius` on both halves, goal test and
   recorder spacing over exactly those positions, check the drawn ink at radius 1, then
   send one input event per move and wait for a Phaser pointer to report it. A straight
   synthetic stroke is for an honest death only.
6. **Shapes**: 390×844 @3 (iPhone); the Duo's outer display 466×678 with
   `?safe=0,84,34,0`; inner tall 669×951 with `?safe=82,0,34,0`; inner wide 951×669 with
   `?safe=0,84,34,0`; a half 433×669; Split View panes 669×440 and 320×690 — and each
   once more with reduced motion (the OS setting and `save.reducedMotion`).
7. **Clock**: shift `Date` / `Date.now` to a chosen start and let it run (not frozen
   fake timers, which stall the game loop), then jump it to test 18:00 and midnight.

**DEV handles** (`import.meta.env.DEV` only; none reaches a bundle): `window.game` —
the Phaser game; `game.scene.getScene('Game')` exposes `level`, `pf`, `collision`,
`phase`, `recorder`, `cursorFor`, `levelIndex`, `dailyDate`, `resultCard`
(`buttonPoint('share' | 'double' | 'next' | 'done')`), `frameScale`, `winQuiet` — and
`window.foldwing`: `renderShareCard`, and `nudges`, the Nudges service
(`rebuild()`, `permission()`, `devPlugin.pending` — what a phone would hold —
`devPlugin.tap(extra?)` — a reminder tap). Observable state: `html[data-desk]` and the
`--fw-banner-lift` variable.

**Switches:**

| Switch | Where it works | Effect |
| --- | --- | --- |
| `?safe=t,r,b,l` | dev server | Pretends the phone has those safe-area insets, in points: sets `--fw-safe-*` on `<html>`, and the page and the game lay out inside them. The mock ads' and the fake store's DOM overlays still read the real `env()` |
| `?notif=granted\|denied\|prompt` | dev server, browser | The in-memory stand-in for the notifications plugin starts at that permission (default undecided) |
| `?notifAnswer=deny` | dev server, browser | The fake system alert refuses |
| `?iap=slow\|none\|restricted` | mock build, browser | The fake store answers after 8 s / with no products / with payments off |
| `?restore=true\|false\|cancelled\|error` | mock build, browser | What a restore comes back with |
| `?prices=usd\|srb\|gbr`, `window.__foldwingPrices` | mock build, dev server | Storefront price fixtures (a name, or `{ currency, removeAds, starter, packs }` in millionths) |
| `localStorage['foldwing.mockOwned']` | mock build, browser | Remove Ads "owned" for a restore; clear it to reset |
| keys `1`–`9`, `R`, `M` | dev server | Jump to a level, restart it, back to the menu |

Selectors on the fake store: `[data-foldwing-mock="purchase"] [data-action=buy|cancel|fail|pending]`,
and after Pending `[data-foldwing-mock="purchase-pending"] [data-action=approve|decline]`.

**On the simulator** (`SIM=<udid> npm run ios:run`, the mock build, the newest iOS
runtime): the app launches under UIScene; Safari Web Inspector's
`Capacitor.Plugins.LocalNotifications.getPending()` lists at most eight, ids 8101–8109;
a test notification with `extra.route = 'daily'`, tapped from the background and again
after a force-quit, opens today's Daily with no film; a notification in the foreground
shows no banner once `capacitor.config.json` is synced. There is no `.storekit` file, so
the store there says "isn't reachable" — StoreKit is tested with a Sandbox Apple ID on a
device. The review prompt shows only in a development build, never from TestFlight.

---

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
