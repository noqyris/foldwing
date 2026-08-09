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
    npm test           # 1106 unit tests, incl. all 300 levels re-proved
    npm run build      # tsc --noEmit && vite build
    SIM=<udid> npm run ios:run   # build + install + launch on a simulator

Built and verified: the core loop, `Geometry` with 60 unit tests, home / level
select / gallery, progress persistence, audio and haptics, the share pipeline,
the Capacitor iOS shell, and AdMob + Remove Ads.

Still open from the original plan: the debug overlay (step 5).

**300 levels**, five hand-authored and 295 generated MAZES. Each is a
spanning-tree labyrinth carved over the drawable half — one true route from
start to goal, everything else a dead end — with a difficulty-growing fraction
of its walls emitted on the FAR half instead. Mirroring makes that a pure
visibility choice: a wall at `[a, a+w]` and a far wall at `[1−a−w, 1−a]`
constrain the stroke+reflection pair identically, so the maze the player must
solve is partly invisible where they draw, and the only way to tell a real
fork from a trap is to fold the far half across in their head. Every level is
*proved* solvable by `LevelValidator` — a BFS gated by the real
`CollisionSystem`, so the validator can never be more permissive than the game
— and forced to wind (route ≥ 1.5× the direct distance) with real decoy mass.
`levels.test.ts` re-proves all 300 on every run.

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

The generator measures a pool an order of magnitude larger than the set, then
ships a spread across its difficulty range **skewed toward the hard end**
(`SKEW = 0.55`): position 0 still takes the easiest candidate and position 94
the hardest, but the middle of the game samples from what a linear spread
called the top third. The set is built to be demanding — the warm-up lives in
the hand-authored tutorial, not in thirty roomy generated levels. After:
interlock ρ **−0.057 → ~0.8**, and clearance falls smoothly 30 → 8 base px
with no band-to-band cliff, against a proved playable floor of 6. Tests pin
all of it.

### Craft

Three things a measurement won't catch but a player will:

- **Inert walls.** Random placement produces obstacles whose constraint is
  already covered by something else, most often a far-half wall whose
  reflection lands inside a near wall. The player folds it in their head and
  finds it changes nothing — worse than an absent wall, because the level
  promised a problem that doesn't exist. 34 shipped across 30 levels. The
  generator strips them and `quality.test.ts` fails the build if one returns.
- **Names.** A flat word list picked by a coprime stride called the hardest
  level in the game "Soft bend". Adjectives are banded by tone now, so the name
  agrees with the ramp: *First fold* → *Severe edge*.
- **Duplicates, overlaps and slivers**, all pinned rather than eyeballed.

### The mirror has to be load-bearing

The generator emitted one kind of wall per row, at distinct heights. The
consequence took a player to spot: a near wall and the reflection of a far wall
essentially never occupied the same height, so the player cleared one, then the
other, one thought at a time. The mirror was decoration. Measured across the
100 shipped levels, **98 had zero overlap** between the two halves; the mean was
0.4%.

The fix is a row that closes the corridor from both sides at once — the left
edge of the gap is a wall you can see, the right edge is the reflection of a
wall on the far half, and neither alone says where the opening is. The
generator now reserves rows for it before rolling anything else, scaling with
difficulty, and *measures* the result rather than trusting the placement,
because a neighbouring row can swallow the corridor. Zero-overlap levels went
from 98 to 4, and those four are the hand-authored tutorial: 1–4 teach one
constraint at a time and 5 is where both arrive together. Mean overlap is 37%.

`interlock()` is the measure and `levels.test.ts` pins three things — every
generated level interlocks, the tutorial's teaching order is preserved, and the
*mean* stays high, so the bar cannot be cleared by a hair on every level.

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
went from 0.53 to 6.1 base px, about 3 css px of room for the hand on each side.
A test pins both ends — the minimum may not drop, and it may not run away
upwards either, because that would mean the hard end had quietly gone soft.

## The bit that travels

The ink is a **ribbon, not a line**: it swells where the hand slows and thins
where it hurries, and tapers off at both ends. That is why two players clearing
the same level produce visibly different figures — the drawing records how you
drew it, not just where you went. Collision is unaffected; the hit radius is
fixed, so a fat slow stroke is exactly as safe as a thin fast one.

Every clear is saved (normalized, with its timing) and redrawn in the gallery by
the same code that drew it live. Tapping one renders a **1080×1080 card** —
paper grain, the figure, the wordmark — and hands it to the native share sheet.

The app icon is generated by that same renderer from a hand-authored figure, so
the mark on the home screen is literally made of the mechanic:

    node scratch/make-icon.mjs   # see the scratchpad script in this session

## Sound

One note per obstacle row crossed alive, climbing a major pentatonic and
resetting each level, so a clean run plays a rising phrase. Collision is a
damped thud, not a buzzer — the game asks you to fail dozens of times a minute
and an alarm would be unbearable. Nothing loops, and the context is created on
the first real touch because iOS refuses to start audio any other way.

Remove Ads ($0.99, non-consumable, family-shareable) is wired to StoreKit via
`cordova-plugin-purchase` and was approved with 1.0. The whole store surface
lives in `systems/Iap.ts`; nothing touches StoreKit until the player opens the
purchase or restore flow, because a payment-queue observer at launch makes a
signed-out device demand an Apple Account before the first tap.

## Controls

Press and drag from the start dot. Release short of the goal and the attempt
just resets — no penalty, no screen. Hit a wall and you get 400ms of red and
then you are drawing again; no tap required.

In `npm run dev` only: keys `1`–`5` jump levels, `R` restarts. Tapping after a
win advances.

## Layout of the code

    src/
      main.ts                 Phaser config, viewport-settle handling
      scenes/BootScene.ts     entry point; future home of preload + audio unlock
      scenes/GameScene.ts     the core loop and the input state machine
      core/Geometry.ts        segment/rect/circle math — pure, no Phaser
      core/Playfield.ts       normalized level space -> pixels, and the axis
      core/StrokeRecorder.ts  raw sampling, Chaikin smoothing, mirroring
      core/CollisionSystem.ts stroke + reflection against the full wall list
      core/DrawCursor.ts      the touch finger-offset, as a pure function
      data/levels.ts          5 hand-authored + 295 generated = 300
      data/generatedLevels.ts GENERATED — run scripts/genLevels.ts
      core/LevelValidator.ts  BFS proof that a level can be finished
      core/Ribbon.ts          speed-driven variable-width ink
      data/types.ts           Level shape + the LOCKED coordinate system
      render/InkRenderer.ts   walls, axis, stroke, mirror, fail flash, win figure
      render/Theme.ts         palette, sizing tokens, base canvas
      render/HitArea.ts       why a centred hit rectangle must start at (0,0)
      render/ScrollView.ts    tap-vs-drag, momentum, and off-screen culling

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
   The ad fires *after* the figure, never over it. Every 3rd win.
2. **A retry, gated hard.** Every 5th failed attempt *and* at least 120s since
   the last ad — **both**, never either. This one needs the explanation below.
3. **The banner, always on.** `METRICS.inset.bottom` reserves its strip out of
   the playfield, so it covers paper margin and never a control. A start dot
   under an ad is unplayable and an accidental-click generator.
4. **A voluntary ask.** Rewarded video for a *reveal*, which paints the mirror's
   forbidden bands onto your half for six seconds — the exact thing the game
   withholds: not the answer, but where your own reflection is about to kill
   you. Rewards are banked, not auto-spent, with a free daily top-up.

### Why the retry ad needs two gates and not one

A failed attempt in this game lasts three to eight seconds. An attempt counter
on its own — "every 5th try" — would put an ad on screen roughly every 25
seconds on a level someone is stuck on. AdMob's policy explicitly forbids
triggering an interstitial "every time a user clicks within the app" and warns
that ad serving gets disabled over it, so that configuration does not trade
retention for revenue; it trades an account for nothing.

The count is therefore only a *permission* and the clock is the *brake*. This
matches the industry rule of two axes at once — minimum seconds AND minimum
actions since the last ad. `monetization.test.ts` pins the arithmetic: it
asserts that even with instant failures the count cannot outrun the time floor,
so nobody can make the game more aggressive by editing one number in isolation.

Remove Ads bundles unlimited reveals, so the purchase is worth roughly double at
no marginal cost. Nothing in `CollisionSystem` reads `InkTheme`, so no skin and
no purchase can change what kills you.

Going live is one switch — `useTestAds: false` — plus the matching native app id
in `Info.plist`, and a test fails the build if those two disagree. See
`SUBMIT.md`.

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
