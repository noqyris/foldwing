# Foldwing

Draw one continuous line from the start dot to the goal, in the **left half** of
the screen. It is mirrored across the vertical centre axis in real time. The
obstacles are asymmetric, so your stroke has to clear the left walls and its
reflection has to clear the right ones at the same time — one gesture, two sets
of constraints.

When you win, the stroke and its mirror close into a symmetric figure.

## Status

    npm install
    npm run dev        # http://localhost:5173
    npm test           # the whole level set is re-proved on every run
    npm run build      # typecheck, the suite, then vite build
    SIM=<udid> npm run ios:run   # build + install + launch on a simulator

No test count here on purpose. The one this line used to carry was stale, and a
number that goes wrong every time somebody adds a spec teaches the reader to
distrust the rest of the page. `npx vitest run` prints the real one.

What is worth knowing is that `npm test` takes minutes rather than seconds, and
the level re-proof is nearly all of it: each of the 300 levels goes through the
real BFS twice — once for solvability, once with the collision radius inflated
for playability — and the ramp assertions measure clearance by binary search on
top of that. It is slow because it is a proof and not a snapshot, and a
snapshot of a generated set would pin nothing.

Built and verified: the core loop, `Geometry` with 60 unit tests, home / level
select / gallery, progress persistence, audio and haptics, the share pipeline,
the Capacitor iOS shell, and ads + Remove Ads (AdMob then; Unity LevelPlay since
September 2026, after Google closed the AdMob account).

Shipped since that list was written, and none of it in it:

- **The Daily Fold.** One maze a day, the same one for everybody, with no
  server — the generator is a pure function of a seed, so `seed = date` *is*
  the synchronization. It is computed on the phone, gated by the same four
  acceptance rules the shipped set uses, and it carries a streak and a
  spoiler-safe text share.
- **Chapters of twenty** in the level select. Three hundred cards in one wall
  read as a featureless climb; twenty at a time gives it finish lines.
- **Par and medals.** The validator already proves a route, so its arc length
  is the par, stored per level as `parPx`. The attempt counter becomes the
  verdict on a win — `your line 1.31× par` — and turns gold at ≤1.25×.
  Every finished level becomes a score to come back for, at zero content cost.
- **A ghost of your last attempt** on the retry, so a death leaves information
  behind instead of just a reset.
- **Fold Sense**, a 0..100 rating of the one thing this game is about: reading
  the half of the maze you cannot see. Line-versus-par, tries, reveals spent,
  what share of your deaths were the *reflection* dying, and how much of the
  level is folded. It is a game rating in the sense Elo is one, and marketing
  copy must keep it that way (see `MARKETING.md`).
- **The reveal packs**, 10, 20 and 30 reveals, offered beside the rewarded
  video when the stash runs out — never instead of it.
- **The web daily**: one build flag turns the same codebase into an
  install-free page that boots straight into today's fold and points a
  finished player at the App Store.
- **A settings sheet** — sound, haptics, reduced motion — which is also the
  first time any of those three had a caller rather than a default.
- **The UIScene life cycle, on Capacitor 8.5.** Anything built with the iOS 27
  SDK must adopt it or it does not launch on iOS 27 at all. Adopted by hand —
  a `SceneDelegate` that forwards to Capacitor, the scene manifest, and the
  same `Main` storyboard — still on CocoaPods (see `docs/11-build-release.md`).
- **The game lives in the safe area.** `#app` is inset by
  `env(safe-area-inset-*)` on each side, so the board never sits under a status
  bar, a camera or the home indicator, and the paper still runs to every edge.
  That is what iPhone Duo needs — an 84pt status strip down one side of the
  outer display — and a rotation or fold mid-stroke now abandons the line like
  a lift instead of killing it through a wall.

And 1.4, whose one idea is that every earned thing should be visible:

- **Daily missions.** Three small goals a day — the first always today's Daily —
  each paying a reveal the moment it is done, with no claim button. They open
  after the tutorial, deal themselves from the date, and roll over at midnight.
- **Streak bookmarks and the repair.** The Daily streak earns bookmarks (one on
  day 3 and every 7th day, two held at most), and a bookmark spends itself on a
  missed day, so the streak protects instead of punishing. A streak broken by a
  single day can now and then be repaired with a short video — free with Remove
  Ads, or where no ad can play. Milestones on days 7, 14, 30, 50 and 100 pay
  reveals. Nothing ever says "you lost".
- **Chapter marks.** Every chapter of twenty pays a reveal halfway and two at the
  end — cleared levels only, so a skipped one is a reason to go back — and players
  who had finished chapters before 1.4 were paid for them once.
- **A result card after every win.** The board steps back, and the card says how
  close the line came to par, the time against your best, the chapter as a
  twenty-cell bar, and everything the win paid, each reward flying into the pill
  it lands in. A tap anywhere off the card still moves on.
- **A real store.** The reveal balance is always on the menu with a "+", the Store
  is a button beside Levels and Gallery, and one store sheet sells everywhere: a
  free rung (a video, five a day), a one-time starter pack after the fifth win,
  the packs the local prices make honest, and Remove Ads — which now also makes
  skips free. The browser's mock build sells through a fake store that says FAKE
  PURCHASE in large letters and never ships anywhere else.
- **Reminders that know the player.** Local notifications only: a little before
  the time you usually open the game, a streak saver on the evening it matters, a
  short win-back tail that stops after thirty days, and a tap that opens today's
  Daily. The permission is only ever asked after the player taps [Remind me].
- **A review prompt that waits for a peak** — once per app version, from the
  second day, on a late medal or a Daily that takes the streak to three, and never
  after a struggle, a skip, a purchase or in the same beat as anything else.
- **Failure that teaches.** A contact ring where the line died, the wall that did
  it flashing, a stronger ghost with an × at the death, the first reflection death
  explained once, a near-miss line ("furthest yet 74%"), and a ghost hand drawing
  the first stretch of level 1.
- **Duo-ready.** The touch offset is measured in on-glass points, so it stays a
  thumb's width in a small Split View pane; a board with 40pt of paper each side
  sits on a desk tone; and the scene manifest is proven in every build.
- **A new icon**, "Mirror Path", with one alternate in the binary for a store test.

Still open from the original plan: the debug overlay (step 5).

**300 levels**, all of them MAZES: a five-level tutorial and 295 generated
levels. Each is a spanning-tree labyrinth carved over the drawable half — one
true route from start to goal, everything else a dead end — with a
difficulty-growing fraction of its walls emitted on the FAR half instead.
Mirroring makes that a pure visibility choice: a wall at `[a, a+w]` and a far
wall at `[1−a−w, 1−a]` constrain the stroke+reflection pair identically, so the
maze the player must solve is partly invisible where they draw, and the only way
to tell a real fork from a trap is to fold the far half across in their head.
Every level is *proved* solvable by `LevelValidator` — a BFS gated by the real
`CollisionSystem`, so the validator can never be more permissive than the game
— and every generated one is forced to wind (route ≥ 1.35× the direct distance)
with real decoys. `levels.test.ts` re-proves all 300 on every run.

The tutorial comes out of the same `MazeGen`, driven differently. `MazeGen`
builds a maze in three stages: `carveMaze` (the tree and its closed edges),
then a fold decision per edge, then `emitMaze` (edges to wall rects).
`makeCandidate`, the driver for the ladder and the Daily Fold, rolls the folds
at random. `scripts/genTutorialMazes.ts` *chooses* them. Each tutorial maze
folds only the walls that teach its one lesson: the lie a single fold tells, a
zigzag, a gate that is only a gap on one side, the sacrifice, then all four at
once. Both the lesson and the maze are measured on the shortest line a hand can
actually draw, at the game's hit radius and with room for a hand to spare, not
on the maze grid, where a detour of two cells can cost the stroke nothing. A
maze is kept only if that line goes *through* its corridors — turning, changing
column, using the middle one, never up the undrawn left edge — with the drawn
walls joined into a maze rather than a comb of bars, and only if its folds make
the line at least 8–12% longer than the near half promises (11.8%, 15.6%,
11.3%, 17.0% and 24.3% at the game's radius). The five are picked to rise strictly in
`difficulty()` and hand over below level 6 (0.120 → 0.143, level 6 at 0.148),
winding further each time. The bar tutorial they replaced stepped
backwards twice, once into level 6. The first is too small to meet the
ladder's winding floor, so the tutorial is exempt from it. Regenerate with
`npx vite-node scripts/genTutorialMazes.ts`. The stages consume the random
stream in exactly the order the old single function did, so every seed still
carves the maze it always did. `levels.test.ts` fingerprints the 295 generated
levels and 60 Daily Folds to keep it that way.

The tutorial mazes took over the ids `l1`–`l5` from five hand-authored bar
levels in September 2026, so save schema 3 forgets clears, best times and
medals for those five ids and nothing else. `unlockedIndex` is a position, so
nobody is sent back, and a saved figure keeps the walls it was drawn through.

### Ordering by difficulty, not by density

The set used to be sorted by `pressure` — how much of the drawable half the
walls take away. That sounds like difficulty and is not. Measured against the
order it produced, the shipped index tracked **wall count at ρ=0.974** and
tracked interlock at **ρ=−0.057**: the game was sorted by how busy each level
looked, while the demand that makes it *this* game stayed flat from level 6 to
100. There was also a cliff — clearance fell 25.2 → 13.5px between levels 60 and
61, nearly doubling the precision required in one step.

`difficulty()` replaces it, over three axes the player actually feels: how
narrow the tightest corridor is, how often both halves squeeze at the same
height, and how many decisions the route contains. It is deliberately
*absolute* rather than normalised across the candidate pool, so the generator
and the test suite compute the same number and the shipped order can be checked
against the rule that produced it — a pool-relative rank blend reads better and
is untestable.

The generator measures a pool four times the size of the set (1200 candidates
for 295 slots), then ships a spread across its difficulty range **skewed toward
the hard end** (`SKEW = 0.8`): position 0 still takes the easiest candidate and
position 294 the hardest, but the halfway point samples the 57th percentile
rather than the 50th, so the opening third stays genuinely easy and the climb
steepens through the middle. After: interlock now tracks the shipped order at
ρ **0.583** where the old sort had it at −0.057, winding tracks it at 0.741,
and clearance falls smoothly from 33.2 base px across the opening ten levels to
9.7 across the closing twenty — no band-to-band cliff anywhere, against a
proved playable floor of 6. Tests pin all of it.

### Craft

Three things the solvability proof says nothing about, and a player notices in
the first minute:

- **Walls that are doing something.** The bar-era test for this was *inertness*
  — a wall is inert if removing it changes nothing the player can reach — and
  the generator stripped those. That criterion is meaningless for a maze, and
  quietly so: a spanning tree already reaches every cell, so no maze wall
  changes reachable area, and the check would pass every level for the wrong
  reason. A maze wall's job is to make the route long and the wrong turns real,
  so that is what is gated now. Four rules, all of them in
  `LevelValidator.ts` rather than in the generator script, because the Daily
  Fold has to apply exactly the same ones at runtime:
  the one true route must **wind** past the straight line (`MIN_WINDING` 1.35;
  the shipped minimum is 1.353, the maximum 2.83); at least 30% of the maze's
  cells must lie **off** that route as dead ends to explore and reject
  (`MIN_DECOY`, measured on the spanning tree, where the number is real);
  both halves must squeeze at the same height often enough to matter
  (`MIN_INTERLOCK` 0.08); and the route must survive the whole solvability
  proof again with the collision radius inflated by `PLAYABLE_CLEARANCE`.
  `quality.test.ts` re-measures winding and off-route ground on every shipped
  level and fails the build if either slips.
- **Names.** A flat word list picked by a coprime stride called the hardest
  level in the game "Soft bend". Adjectives are banded by tone now, so the name
  agrees with the ramp: *First fold* → *Closed edge*.
- **Duplicates, overlaps and slivers**, all pinned rather than eyeballed.

### The mirror has to be load-bearing

The generator emitted one kind of wall per row, at distinct heights. The
consequence took a player to spot: a near wall and the reflection of a far wall
essentially never occupied the same height, so the player cleared one, then the
other, one thought at a time. The mirror was decoration. Measured across the
100 shipped levels, **98 had zero overlap** between the two halves; the mean was
0.4%.

The fix is a corridor closed from both sides at once — the left edge of the gap
is a wall you can see, the right edge is the reflection of a wall on the far
half, and neither alone says where the opening is. The maze produces that
structurally rather than by arrangement: every wall sits on a shared grid line,
and `foldFraction` sends a difficulty-growing share of them to the far side, so
the two halves land at the same heights by construction. The generator does not
trust that — it *measures* every candidate with `interlock()` and throws away
anything under `MIN_INTERLOCK`. Zero-overlap levels went from 98 to 4, and those
four were the hand-authored bar tutorial, which taught one constraint at a time.
The tutorial mazes that replaced it interlock too, gently (2–5%, from one or two
chosen folds), so no level in the set has zero overlap now. Mean interlock
across the generated set is **58%**, with the quietest level at 8.8% and the
loudest at 94%.

`interlock()` is the measure and `levels.test.ts` pins two things — every
generated level interlocks, and the *mean* stays high, so the bar cannot be
cleared by a hair on every level. The tutorial's order is pinned by the
difficulty ramp instead, which it has to climb strictly into level 6.

### Solvable is not the same as playable

The second gap was real too. The BFS proves a
route exists for the stroke's *centreline*; it says nothing about how wide that
route is, and it happily passed corridors barely wider than the ink. Ten levels
shipped that way — the worst two left **0.3 css px** of margin on a phone, which
is not a hard level but an impossible one, and they sat at the hard end where
"I can't do it" reads as intended rather than broken.

So every level now has to survive the same proof with the collision radius
inflated by `PLAYABLE_CLEARANCE`, and the generator rejects candidates that
cannot. `clearance()` measures the real figure: the tightest level in the set
went from 0.53 to **9.0 base px**, about 4.7 css px of room for the hand on each
side, against a floor of 6. A test pins both ends — the minimum may not drop,
and it may not run away upwards either, because that would mean the hard end had
quietly gone soft.

## The bit that travels

The ink is a **ribbon, not a line**: it swells where the hand slows and thins
where it hurries, and tapers off at both ends. That is why two players clearing
the same level produce visibly different figures — the drawing records how you
drew it, not just where you went. Collision is unaffected; the hit radius is
fixed, so a fat slow stroke is exactly as safe as a thin fast one.

Every clear is saved (normalized, with its timing) and redrawn in the gallery by
the same code that drew it live. Tapping one renders a **1080×1080 card** —
paper grain, the figure, the wordmark — and hands it to the native share sheet.

Until 1.4 the app icon was generated by that same renderer from a hand-authored
figure, so the mark on the home screen was literally made of the mechanic —
`ShareCard` still carries the two options it needed, `nibScale` and `flat`. It read
as a pale smudge in a search list, though, beside navy, black and purple tiles. The
1.4 icon, "Mirror Path", is a drawn illustration of the rule instead: a line and its
mirror through different walls on each side, ink on tangerine, with rust walls and a
dark appearance. It is a picture of the idea, not a shipped level, and must never be
captioned as gameplay. A second icon, "The Fold" in plum, ships in the binary as an
alternate (`AppIcon-Fold`) only so the App Store can test one against the other.

Neither the old script (`scratch/make-icon.mjs`) nor the new icons' drawing and
recolouring scripts are committed. What is committed is their output, in
`Assets.xcassets`.

## Sound

One note per obstacle row crossed alive, climbing a major pentatonic and
resetting each level, so a clean run plays a rising phrase. Collision is a
damped thud, not a buzzer — the game asks you to fail dozens of times a minute
and an alarm would be unbearable. Nothing loops, and the context is created on
the first real touch because iOS refuses to start audio any other way.

Remove Ads ($2.99, non-consumable, family-shareable) and the reveal packs are
wired to StoreKit via `cordova-plugin-purchase` and approved; the one-time starter
(`reveals25`, $0.99) goes to review with 1.4. The whole store surface lives in
`systems/Iap.ts`; nothing touches StoreKit until a selling screen opens, because a
payment-queue observer at launch makes a signed-out device demand an Apple Account
before the first tap. Every purchase is credited once per transaction id and
written to disk before StoreKit is told it was delivered.

## Controls

Press and drag from the start dot. Release short of the goal and the attempt
just resets — no penalty, no screen. Hit a wall and you get 400ms of red and
then you are drawing again; no tap required.

In `npm run dev` only: keys `1`–`9` jump to those levels, `R` restarts the one
you are on, `M` goes back to the menu. Tapping after a win advances.

## Layout of the code

    src/
      main.ts                 Phaser config, viewport-settle handling
      scenes/BootScene.ts     the only entry: save, settings, ad + store warm-up
      scenes/GameScene.ts     the core loop and the input state machine
      scenes/GalleryScene.ts  every figure ever drawn; tap one to share it
      core/Geometry.ts        segment/rect/circle math — pure, no Phaser
      core/Playfield.ts       normalized level space -> pixels, and the axis
      core/StrokeRecorder.ts  raw sampling, Chaikin smoothing, mirroring
      core/CollisionSystem.ts stroke + reflection against the full wall list
      core/DrawCursor.ts      the touch finger-offset, as a pure function
      core/MazeGen.ts         the maze as a pure function of a seed — ONE copy
      core/CalendarDay.ts     the one answer to "what day is it", in LOCAL time
      core/FoldSense.ts       the 0..100 skill rating, from real play signals
      data/tutorialLevels.ts  GENERATED — run scripts/genTutorialMazes.ts
      data/levels.ts          5 tutorial + 295 generated = 300
      data/generatedLevels.ts GENERATED — run scripts/genLevels.ts
      core/LevelValidator.ts  BFS proof a level can be finished, plus the gates
      core/Ribbon.ts          speed-driven variable-width ink
      data/types.ts           Level shape + the LOCKED coordinate system
      render/InkRenderer.ts   walls, axis, stroke, mirror, fail flash, win figure
      render/Theme.ts         palette, sizing tokens, base canvas
      render/UI.ts            the Phaser-primitive shell: type, buttons, sheets
      render/ShareCard.ts     the 1080×1080 export, on a plain 2D canvas
      render/HitArea.ts       why a centred hit rectangle must start at (0,0)
      render/ScrollView.ts    tap-vs-drag, momentum, and off-screen culling
      systems/Daily.ts        today's fold — seed = date, so the world agrees
      systems/WebDaily.ts     the install-free browser build, as one build flag
      core/Streak.ts          streaks through bookmarks, milestones, the repair window
      core/Missions.ts        the day's three missions, dealt from the date
      core/Rewards.ts         chapters of twenty and their marks
      core/Rescue.ts          the three-death / six-death rescue ladder, and its place
      core/RouteProgress.ts   how far along the maze a failed line got
      systems/Progress.ts     the save, and every grant through one announced path
      systems/Iap.ts          StoreKit; systems/iapMock.ts, the browser's fake store
      systems/NudgePlan.ts    which reminders to leave on the phone, and what they say
      systems/Nudges.ts       writes that plan, never prompting; routes a tap
      systems/Rate.ts         the review prompt: once a version, at a peak
      render/StoreSheet.ts    the one store, from every screen that sells
      render/ResultCard.ts    the win card and its layout
      render/DailyCard.ts     the menu's Daily card, its six faces
      render/MenuLayout.ts    the menu as a pure layout, at every canvas scale
      render/SafeArea.ts      safe-area insets, banner lift, desk margins

## Two things that look like polish and are not

**Touch targets.** Phaser hit-tests by inverting the world transform and then
adding the display origin back, so hit areas are authored in top-left space even
for an object drawn around its centre. The visually obvious
`Rectangle(-w/2, -h/2, w, h)` therefore subtracts the half-extent twice: only
the top-left *quarter* of a button responds, and its overhang steals taps from
whatever sits above it. Measured on the shipped build, the menu's Levels button
fired on 10 of 45 probe points. That is the whole of "I have to tap it three
times". `HitArea.ts` owns the correction and a test pins it.

**The level grid.** Phaser re-runs a Graphics object's command list into the
batch every frame — nothing is cached just because nothing changed. 100 cards of
vector art ran the grid at **5fps** while the menu and the game held 60. The
fixes, each measured: `ScrollView` hides off-screen rows (5→14fps), the clipping
window is a camera viewport rather than a geometry mask (a GPU scissor instead
of a per-frame stencil pass), and the card art itself is tinted quads — the
chrome and three little discs bake once into two tiny shared textures, walls are
NineSlices of a 12×12 rounded square, and the only per-card raster is the number
label's Text canvas. An earlier iteration baked whole cards into one atlas;
that died at 300 levels, where the atlas passes 8192px (over MAX_TEXTURE_SIZE on
older iPhones) and ~70MB. The quad version measures a flat 8.3ms/frame during a
hard fling at 300 cards, and texture memory no longer grows with the level
count. (The Gallery still uses the atlas bake — figures are freehand ribbons,
not rectangles — and stays under the 4096px floor only because the save caps
stored figures at 120.)

`Playfield` is the one addition to the architecture in the spec: something has
to own the normalized-to-pixel conversion, and giving it a home keeps that
conversion in exactly one place instead of smeared across the scene.

## The three invariants

1. **Obstacles are asymmetric.** A wall authored on the right at `x ∈ [a,b]`
   forbids the player `x ∈ [1-b, 1-a]` on the left at the same `y`. That
   projection is the whole game.
2. **Collision is continuous along each segment.** Pointer samples arrive about
   once per frame, so during a flick two consecutive samples can be hundreds of
   pixels apart. Everything goes through `segRect`, never through a point test.
3. **The hit radius is smaller than the nib.** 2.6pt of collision inside 5pt of
   ink, so the line forgives slightly. `METRICS.hitRadius` is deliberately kept
   out of `InkTheme` — a cosmetic that widened your forgiveness would be
   pay-to-win.

`segRect` (orientation tests) and `segRectEntryT` (slab clipping) are two
independent implementations of the same predicate, and the suite cross-checks
them over 80,000 random cases. A bug in either would have to be duplicated in
the other to survive.

## Where the money is, and where it deliberately isn't

Four placements:

1. **Leaving a win.** The player has seen their figure and tapped to move on.
   The ad fires *after* the figure, never over it. Every 3rd win — and never
   after a card that already asked for something (a reminder, the chapter
   doubler): one interruption per moment.
2. **A retry, gated hard.** Every 8th failed attempt *and* the session ladder's
   floor since
   the last ad — **both**, never either. This one needs the explanation below.
3. **The banner, always on.** `METRICS.inset.bottom` reserves its strip out of
   the playfield, so it covers paper margin and never a control. A start dot
   under an ad is unplayable and an accidental-click generator.
4. **A voluntary ask.** Rewarded video for a *reveal*, which paints the mirror's
   forbidden bands onto your half for six seconds — the exact thing the game
   withholds: not the answer, but where your own reflection is about to kill
   you. Rewards are banked, not auto-spent. The offer is contextual: after
   three deaths on one level the game points at the fold, and only after six
   does it offer the way past — later still, at nine, for a player who could
   look and has not — so it visibly tries to teach before it offers to excuse.
   Ad-paid reveals stop at five a day; the skip and the streak repair are
   rescues, not currency, and are drawn free wherever no ad can play.

Reveals also arrive without an ad or a purchase — the daily top-up, three
missions a day, chapter marks, streak milestones — sized so an engaged player
gains four or five a day and never as many as the smallest pack holds.

One ladder, in one place — the store sheet, the same one whether it opens from
the menu or from an empty Reveal pill:

    Watch an ad         +1 reveal    free · 5 a day
    Starter, 25         $0.99        once, after the fifth win
    10 reveals          $0.99        9.90¢ each
    20 reveals          $1.49        7.45¢ each   (−25%)
    30 reveals          $1.99        6.63¢ each   (−33%)
    Remove ads          $2.99        once · no ads, unlimited reveals & skips

The free rung comes first and is the only primary button: reveals have to stay
earnable or watching the next ad stops being a fair deal. Everything below it
gets better value than the rung above, and the last rung is not a pack at all —
a dollar past the 30-pack buys reveals that never run out plus no ads, which
makes the permanent unlock the obvious end of the row rather than something the
player has to go and find on another screen. The starter sits outside the ladder
on purpose: sold once, and shown only where it is honestly cheaper per reveal
than every rung — at $0.99 for twenty-five it is, in every storefront.

Where Apple's price tiers break the ladder — Serbia's 20- and 30-packs are both
€1.99, the UK's 10 and 20 both £0.99 — the rung that has become a trap is simply
not drawn (`sellableLadder`); the product ids are permanent, so the fix is at
runtime.

Two rules hold the ladder together, and both are pinned by tests.

Every rung must beat the one below it on **unit price**. 25-at-$1.49 works
alone but not with 30-at-$1.99 above it: the bigger pack would cost more per
reveal than the smaller, and the row stops being a ladder and becomes a trap for
whoever does not do the arithmetic. That is why the counts are 10/20/30.

Every consumable must stay strictly **under** the price of unlimited. A pack
priced the same as unlimited-plus-no-ads cannot be bought by anyone who reads
both rows — that was the state when the 10-pack and Remove Ads both sat at
$0.99, and it is why the top of the ladder moved to $2.99 once a $1.99 pack sat
underneath it.

The "save 25%" badges are computed from `priceMicros`, never written into the
copy: Apple's tiers are not proportional across storefronts, so the same two
packs genuinely save different amounts in different currencies, and a hardcoded
percentage would be a false claim about a price in most of the world.

The count lives in the product id because a StoreKit id is immutable: changing
what a pack contains means a new product, and an id that still says 20 while the
code grants 10 is a player charged for something other than what the button
said.

### The replay video

The win screen offers two shares, because they are two different things to send.

**Share the replay** builds an MP4 of the whole run — the misses, then the line
that worked — and hands it to the system share sheet. It is not a screen
recording. The game already stores every stroke as points and the milliseconds
they were sampled at, which is not a record of a run, it *is* the run, so the
clip is reconstructed instead of captured. That is better on every axis: no
permission prompt, no HUD or banner or notch in frame, 1080×1920 whatever the
phone's screen is, rendered faster than real time, and the same run always
produces the same file. The failed attempts are in it on purpose — they are the
only way a stranger learns the rule, which is that the line killing you is the
one on the other side of the fold.

Encoded with WebCodecs (`VideoEncoder` → VideoToolbox → H.264 in MP4, muxed by
`mp4-muxer`). Safari shipped the video half of WebCodecs in 16.4, which is all a
silent clip needs. Where it is missing the button does not appear at all rather
than failing after the tap. Measured: ~11s of clip, 3.4 MB, under two seconds to
encode. Every step of the render is bounded — iOS 26's AAC encoder can fail
without ever answering, which now costs the clip its sound and nothing else —
and the progress card offers Cancel after two seconds, so it always comes down.

**Share this fold** is the still card, unchanged — a figure you made, pasted
into a chat as an image rather than something to press play on.

Both go through the OS share sheet, which is the only universal share mechanism
there is: TikTok, Instagram, WhatsApp, Messages, Telegram, X, Discord and Save
to Files, without a line of platform SDK. Per-platform kits only buy a deep link
into one app's composer, at the cost of an SDK, a registered key and their
review.

### Why the retry ad needs two gates and not one

A failed attempt in this game lasts three to eight seconds. An attempt counter
on its own — "every 5th try" — would put an ad on screen roughly every 25
seconds on a level someone is stuck on. AdMob's policy explicitly forbade
triggering an interstitial "every time a user clicks within the app" and warned
that ad serving gets disabled over it. The rule was kept unchanged when the game
moved to Unity LevelPlay: that configuration does not trade retention for
revenue; it trades an account for nothing.

The count is therefore only a *permission* and the clock is the *brake*. This
matches the industry rule of two axes at once — minimum seconds AND minimum
actions since the last ad. `monetization.test.ts` pins the arithmetic: it
asserts that even with instant failures the count cannot outrun the time floor,
so nobody can make the game more aggressive by editing one number in isolation.

Remove Ads bundles unlimited reveals and free skips, so the purchase is worth far
more than any pack at no marginal cost — and someone who paid to remove ads is never
asked to watch one. Nothing in `CollisionSystem` reads `InkTheme`, so no skin and no
purchase can change what kills you.

There is no "test ads" switch any more. Unity LevelPlay has no test inventory —
its test flag only unlocks the Test Suite, and every build with ads on serves the
real waterfall — so the builds are told apart by markers baked into the bundle
instead: the App Store gets `ADMODE:live` + `ADS:on` (`npm run ios:appstore`),
TestFlight gets `ADS:off`, where the ad layer never starts
(`npm run ios:testflight`), and ads are looked at on the mock build, which draws
fake ones and calls no network (`npm run dev:mock`, or on TestFlight with
`fastlane beta_mock` when the owner asks). Every App Store release is
two uploads, the live one and an ads-off one straight after it:
`npm run release:appstore`. The rules are in `CLAUDE.md`.

## One open question for the author

LOCKED rule 3 says the collision radius should be smaller than the rendered
width, "2.6px hit vs 5px visual", so the line "forgives slightly". Those two
numbers are shipped exactly as written, but they do not produce that outcome:
the radius is measured from the stroke's centreline, and a 5pt nib reaches only
2.5pt from that same centreline. Contact is therefore reported 0.1pt *before*
the visible ink touches the wall — a shade strict rather than forgiving.

Making it forgive as the prose intends means `METRICS.hitRadius: pt(2.0)` or
thereabouts. That is a change to a LOCKED value, so it is the author's call, not
this codebase's. `Theme.test.ts` pins the current number so the decision cannot
drift by accident.
