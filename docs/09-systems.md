# Systems: Progress, Audio, Haptics, Share, Rate

## What this covers

The five cross-cutting singleton services under `src/systems/` that are not
monetization: save persistence, procedural audio, haptics, the share pipeline,
and the store-review prompt. For each: the exported singleton, verbatim public
API, internal state, native backing plugin, web fallback, and behaviour when the
native layer is absent. `Ads.ts` and `Iap.ts` live in
[10-monetization.md](10-monetization.md).

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `src/systems/Progress.ts` | 304 | Save data: schema, validation, debounced writes, unlock/reveal rules, figure store |
| `src/systems/Audio.ts` | 173 | WebAudio synthesis: pentatonic note ladder, collision thud, win chime |
| `src/systems/Haptics.ts` | 47 | Capacitor Haptics wrapper, native-only, fire-and-forget |
| `src/systems/Share.ts` | 104 | PNG data-URL → cache file → native share sheet; Web Share / download fallback |
| `src/systems/Rate.ts` | 38 | One-shot native in-app review prompt, gated on wins and on "no ad this beat" |
| `src/config/monetization.ts` | 182 | Constants consumed by Progress (`reveals.*`) and Rate (`rate.*`) |
| `src/render/ShareCard.ts` | 204 | `renderShareCard()` — produces the data URL `Share` consumes |
| `src/core/Playfield.ts` | 87 | `toNormalized` / `toScreen` — the transform that makes `SavedFigure` portable |

All five modules export a single pre-constructed instance; there is no DI, no
factory, no reset hook except `Progress.reset()`. Importing a module is
sufficient to use it.

| Module | Export line | Exported symbol |
| --- | --- | --- |
| Progress | `src/systems/Progress.ts:304` | `export const Progress = new ProgressStore();` |
| Audio | `src/systems/Audio.ts:173` | `export const Audio = new AudioService();` |
| Haptics | `src/systems/Haptics.ts:47` | `export const Haptics = new HapticsService();` |
| Share | `src/systems/Share.ts:104` | `export const Share = new ShareService();` |
| Rate | `src/systems/Rate.ts:38` | `export const Rate = new RateService();` |

---

# 1. Progress

`src/systems/Progress.ts`. Backed by `@capacitor/preferences` (`^7.0.4`).

## 1.1 Storage key and backing

| Fact | Value | Source |
| --- | --- | --- |
| Key | `'foldwing.save.v1'` (module const `KEY`) | `src/systems/Progress.ts:17` |
| Payload | one `JSON.stringify(SaveData)` string, single key | `src/systems/Progress.ts:291` |
| iOS backing | `UserDefaults` (plist) via the Preferences plugin | documented `src/systems/Progress.ts:4-5`, `63-69` |
| Web backing | `window.localStorage` | `node_modules/@capacitor/preferences/dist/esm/web.js:59` |
| Web key actually written | `CapacitorStorage.foldwing.save.v1` — the plugin prefixes with its group | `node_modules/@capacitor/preferences/dist/esm/web.js:5`, `:61-69` |

There is no per-field storage and no secondary key. One read at boot, one
serialized blob per write.

## 1.2 Schemas (verbatim)

```ts
export interface SavedFigure {
  readonly levelId: string;
  readonly levelName: string;
  /** Normalized playfield coordinates, x < 0.5. */
  readonly points: readonly { x: number; y: number }[];
  /** Milliseconds from the first sample, parallel to `points`. */
  readonly times: readonly number[];
  readonly ms: number;
  readonly at: number;
}
```
`src/systems/Progress.ts:27-36`

```ts
export interface SaveData {
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
`src/systems/Progress.ts:38-61`

Fresh-save defaults (`freshSave()`, `src/systems/Progress.ts:72-86`):

| Field | Default | Note |
| --- | --- | --- |
| `unlockedIndex` | `0` | |
| `bestMs` | `{}` | |
| `cleared` | `[]` | |
| `reveals` | `monetization.reveals.startingStash` = `2` | `src/config/monetization.ts:158` |
| `lastTopUp` | `''` | empty ⇒ first `load()` always grants a top-up |
| `adsRemoved` | `false` | |
| `totalWins` / `winsSinceAd` / `attemptsSinceAd` | `0` | |
| `ratePrompted` | `false` | |
| `figures` | `[]` | |

## 1.3 Public API (verbatim signatures)

```ts
get data(): Readonly<SaveData>                                                  // :142
async load(): Promise<SaveData>                                                 // :146
update(patch: Partial<SaveData>): void                                          // :158
isUnlocked(index: number): boolean                                              // :163
hasCleared(id: string): boolean                                                 // :167
recordWin(levelId: string, levelIndex: number, elapsedMs: number, totalLevels: number): void  // :172
addFigure(figure: SavedFigure): void                                            // :198
get figures(): readonly SavedFigure[]                                           // :206
unlockThrough(levelIndex: number, totalLevels: number): void                    // :211
get reveals(): number                                                           // :220
grantReveals(n: number): void                                                   // :226
spendReveal(): boolean                                                          // :231
setAdsRemoved(owned: boolean): void                                             // :238
installLifecycleFlush(): void                                                   // :262
async flush(): Promise<void>                                                    // :289
async reset(): Promise<void>                                                    // :298
```

Private: `applyDailyTopUp(): void` (`:244`), `scheduleFlush(): void` (`:281`).

Internal state (`src/systems/Progress.ts:138-140`):

```ts
private state: SaveData = freshSave();
private flushTimer: ReturnType<typeof setTimeout> | null = null;
private lifecycleBound = false;
```

`data` returns the live object, not a copy — `Readonly<SaveData>` is a compile-
time guard only. `update()` replaces `this.state` with a shallow spread
(`:159`), so nested objects passed in are aliased; `recordWin` copies `bestMs`
before mutating for exactly this reason (`:174`).

## 1.4 Boot sequence — the only correct order

```text
BootScene.create()                       src/scenes/BootScene.ts:24
  Progress.installLifecycleFlush()       :27   (idempotent, guarded by lifecycleBound)
  Progress.load()  ──await──▶ save       :28
      Preferences.get({key})  →  JSON.parse  →  coerce()  →  applyDailyTopUp()
  .then(save =>
      Ads.setAdsRemoved(save.adsRemoved) :31   entitlement BEFORE any ad request
      scene.start('Menu')                :32
      Ads.init(); Iap.init()             :34, :52   not awaited)
```

Nothing may read `Progress.data` before `load()` resolves — the first scene
(`Menu`) is started from inside that `.then`, and every other scene is reached
from it. `load()` is called exactly once, from `BootScene:28`.

## 1.5 Validation / migration — `coerce()`

`src/systems/Progress.ts:89-135`. There is no versioned migration table. The
single strategy: **merge over `freshSave()`**, so a save written by an older
build never has holes, and every field is re-validated on the way in.

```ts
const count = (n: unknown, fallback: number, min = 0): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : fallback;
```
`src/systems/Progress.ts:105-106`

| Field | Coercion | Line |
| --- | --- | --- |
| `unlockedIndex`, `reveals`, `totalWins`, `winsSinceAd`, `attemptsSinceAd` | `count(...)` — rejects `NaN`/`Infinity`, truncates fractions, floors at `0` | `:123`, `:126`, `:129-131` |
| `bestMs` | accepted whole if `typeof === 'object' && !== null`; **values are not validated** | `:124` |
| `cleared` | array filtered to `typeof c === 'string'` | `:125` |
| `lastTopUp` | must be `string`, else `''` | `:127` |
| `adsRemoved`, `ratePrompted` | `=== true` (any other value ⇒ `false`) | `:128`, `:132` |
| `figures` | per-element filter (below) | `:109-120` |

Figure filter (`:110-119`) keeps an element only if it is a non-null object AND
`Array.isArray(points)` AND `Array.isArray(times)` AND `points.length > 0` AND
every point has numeric `x` and `y`. Note what is **not** checked: `times.length`
is never compared to `points.length`, and `levelId`/`levelName`/`ms`/`at` are not
validated at all.

**WHY the number guard exists (do not weaken it).** The in-source postmortem at
`src/systems/Progress.ts:94-104`: `typeof n === 'number'` accepts `NaN`,
`Infinity`, `-5` and `1.5`. A negative or fractional `unlockedIndex` reached
`LEVELS[i].name` in `MenuScene` and threw inside `create()`, which leaves **no
scene running** — blank canvas, no button, and because nothing re-writes the
save, every relaunch dies identically. Permanently bricked app from one bad
integer. Any new numeric field must go through `count()`.

## 1.6 Reads never throw

`load()` wraps `Preferences.get` + `JSON.parse` in try/catch and falls back to
`freshSave()` (`:147-152`). `flush()` swallows write failures (`:290-294`).
Losing progress is accepted; refusing to launch is not (`:8-9`).

## 1.7 Writes: debounce + lifecycle flush

| Mechanism | Value | Line |
| --- | --- | --- |
| Debounce window | `250` ms, reset on every `update()` | `:282-286` |
| Forced flush | `visibilitychange` → `hidden`, and `pagehide` | `:275-278` |
| Guard | `lifecycleBound` makes `installLifecycleFlush()` idempotent | `:263-264` |
| Manual flush | `Progress.flush()` before leaving Game → Menu | `src/scenes/GameScene.ts:564` |

**WHY DOM events, not `@capacitor/app`** (`:273-274`): WKWebView fires
`visibilitychange` on background and `pagehide` on teardown, so one code path
covers native and web without adding a native dependency that would require a
`cap sync` + rebuild.

**WHY the forced flush exists** (`:253-261`): the 250 ms coalescing window is a
window in which a win exists only in memory. Measured in this project: a clear
landed on disk **394 ms** after it happened. Task-switching inside that window
lets iOS kill the process with the win unsaved.

## 1.8 Unlock rules

```ts
isUnlocked(index) => index <= this.state.unlockedIndex          // :164
```

Both writers clamp identically:

```ts
unlockedIndex: Math.min(
  Math.max(this.state.unlockedIndex, levelIndex + 1),
  totalLevels - 1
)
```
`recordWin` `:182-185`, `unlockThrough` `:213-216`

- Monotonic: `Math.max` means a replay of an early level cannot lower it.
- Capped at `totalLevels - 1`; both call sites pass `LEVELS.length`
  (`src/scenes/GameScene.ts:335`, `:543`), so `unlockedIndex` never exceeds the
  last valid index. This is the guard that keeps `LevelSelectScene.ts:149`
  (`Math.min(Progress.data.unlockedIndex, LEVELS.length - 1)`) from being the
  only line standing between a shortened level list and a crash.
- `recordWin` additionally: keeps the strictly-better `bestMs` (`:175`),
  appends to `cleared` only if absent (`:179-181`), and increments `totalWins`
  and `winsSinceAd` (`:186-187`). It does **not** touch `attemptsSinceAd` — that
  is reset only when an interstitial actually rendered
  (`src/scenes/GameScene.ts:406`, `:451`).
- `unlockThrough` = unlock **without** clearing; this is what a rewarded skip
  buys (`src/scenes/GameScene.ts:543`), so the level stays absent from `cleared`
  and from `bestMs`.

## 1.9 Reveals

| Rule | Behaviour | Line |
| --- | --- | --- |
| `get reveals()` | returns `Number.POSITIVE_INFINITY` when `adsRemoved`, else `state.reveals` | `:220-224` |
| `spendReveal()` | `true` immediately if `adsRemoved`; `false` if `reveals <= 0` (caller upsells); otherwise decrements and returns `true` | `:231-236` |
| `grantReveals(n)` | `state.reveals + n`, raw field | `:226-228` |
| Daily top-up | inside `load()`; `+monetization.reveals.freeDailyTopUp` (= `1`) when `lastTopUp !== today` | `:244-251`, `src/config/monetization.ts:157` |

**TRAP — `Progress.reveals` is not round-trippable.** The getter can be
`Infinity`; `JSON.stringify(Infinity)` is `"null"`, and `coerce`'s `count()`
would then reject it and reset the stash to `startingStash` (`2`). Every
internal writer therefore reads the raw field `this.state.reveals`, never the
getter — `:227`, `:234`, `:249`. Never write `Progress.update({ reveals:
Progress.reveals })`.

**TRAP — the daily boundary is UTC, not local.** `new
Date().toISOString().slice(0, 10)` (`:245`) is a UTC date string, so the top-up
rolls over at UTC midnight regardless of the player's timezone.

**Side effect of `applyDailyTopUp` running inside `load()`:** on any first launch
of a (UTC) day it calls `update()`, which schedules a write — a fresh install
therefore persists its save ~250 ms after boot without the player doing anything.

## 1.10 Figures: how a stroke becomes a `SavedFigure`

Written at the win, `src/scenes/GameScene.ts:339-347`:

```ts
const t0 = this.recorder.times[0] ?? 0;
Progress.addFigure({
  levelId: this.level.id,
  levelName: this.level.name,
  points: this.recorder.points.map((p) => this.pf.toNormalized(p)),
  times: this.recorder.times.map((t) => t - t0),
  ms: elapsed,
  at: Date.now(),
});
```

| Step | What happens | Source |
| --- | --- | --- |
| Points | pixel → normalized: `{ x: (p.x - this.x) / this.w, y: (p.y - this.y) / this.h }` | `src/core/Playfield.ts:57-59` |
| Times | rebased to `0` at the first sample; these are `Phaser` scene times, so absolute values are meaningless across sessions — the deltas are the payload | `GameScene.ts:339`, `:344` |
| `ms` | `this.time.now - this.strokeStartedAt` (same value passed to `recordWin`) | `GameScene.ts:334-335` |
| `at` | wall-clock `Date.now()`, used in the share filename | `GameScene.ts:346`, `:511` |
| Raw source | `StrokeRecorder.points` are RAW samples, min spacing `METRICS.sampleMinDist = pt(2.6) = 5.2` base px; smoothing is applied only on the way to the screen | `src/core/StrokeRecorder.ts:44-50`, `src/render/Theme.ts:128`, `src/scenes/GameScene.ts:119` |

**WHY normalized + timed** (`src/systems/Progress.ts:19-26`,
`src/core/Playfield.ts:50-56`): the same figure must redraw on a different phone
and at 1080×1080 in a share card. Times ride along because they are what gave the
ink its weight — drop them and a shared figure comes back as a uniform tube
instead of the drawing the player made. Concretely: `src/core/Ribbon.ts:62` computes
`dt = Math.max(1, (times[i] ?? 0) - (times[i - 1] ?? 0))` per segment, so a
`SavedFigure` with an empty or short `times` array still renders (no crash) but
with a flat width profile.

Storage policy:

| Rule | Value | Line |
| --- | --- | --- |
| Cap | `const MAX_FIGURES = 120;` | `:70` |
| Eviction | `figures.slice(-MAX_FIGURES)` — drops the **oldest** | `:201` |
| Insert order | appended, newest **last**, in `state.figures` | `:199` |
| Read order | `get figures()` returns `[...state.figures].reverse()` — newest **first** | `:206-208` |
| Dedup | none: every win is kept, including repeats of the same level | `:191-197` |

**TRAP — two opposite orderings.** `Progress.data.figures` is newest-last;
`Progress.figures` is newest-first. `GameScene.shareCurrent()` relies on the
getter to mean "the figure just saved" (`src/scenes/GameScene.ts:497`) and
`GalleryScene` renders the getter directly (`src/scenes/GalleryScene.ts:65`).
Swapping one for the other silently shares the wrong drawing.

The getter allocates a reversed copy on every access — do not call it inside a
render loop.

## 1.11 Size and quota

Derived from verified inputs, not measured:

- Playfield in base units: `750×1334` minus insets `top pt(44)=88, right 24,
  bottom pt(72)=144, left 24` ⇒ `702 × 1102` px, drawable half-width `351`
  (`src/render/Theme.ts:30-31`, `:206-211`, `src/core/Playfield.ts:25-30`).
- Sample spacing floor `5.2` px (`pt(2.6)`, `src/render/Theme.ts:128`), so a
  stroke that merely crosses the field vertically is ≈ `1102 / 5.2` ≈ **212
  samples**.
- `JSON.stringify` emits full double precision: a point serializes as
  `{"x":0.1234567890123456,"y":0.9876543210987654}` ≈ 47 B, plus ≈ 6 B for the
  parallel time entry.

⇒ ≈ **11 KB per figure**, ≈ **1.3 MB** for a full 120-figure store, as a single
JSON string under one key.

Consequences that motivated `MAX_FIGURES` (`src/systems/Progress.ts:63-69`):

- The whole blob is parsed at boot (`JSON.parse` at `:149`), on the critical path
  before `MenuScene` starts. Unbounded growth is unbounded cold-start cost.
- `UserDefaults` is a plist, not a database — there is no partial read or write;
  every `flush()` re-serializes all 120 figures.
- On web the same blob is one `localStorage` value. Browser per-origin quota is
  commonly ~5 MB (UNVERIFIED against any source in this repo), so 1.3 MB is
  inside it but not comfortably; raising `MAX_FIGURES` is a quota decision, not a
  cosmetic one.

Cheapest lever if this ever needs to shrink: round the normalized coordinates
before storing (not currently done anywhere).

## 1.12 Progress consumers

| Call | Site |
| --- | --- |
| `installLifecycleFlush`, `load` | `src/scenes/BootScene.ts:27-28` |
| `data` (menu stats, reveal count, `adsRemoved`) | `src/scenes/MenuScene.ts:40`, `:172-173` |
| `setAdsRemoved(true)` after purchase | `src/scenes/MenuScene.ts:202`; also `src/systems/Iap.ts:193`, `:205` |
| `isUnlocked`, `hasCleared`, `data.cleared`, `data.unlockedIndex` | `src/scenes/LevelSelectScene.ts:63`, `:101`, `:149`, `:225-226` |
| `update({ attemptsSinceAd })` on fail | `src/scenes/GameScene.ts:309` |
| `recordWin`, `addFigure` | `src/scenes/GameScene.ts:335`, `:340` |
| `data.winsSinceAd` → ad gate; counters zeroed only when an ad rendered | `src/scenes/GameScene.ts:370`, `:402-406`, `:446-451` |
| `spendReveal`, `grantReveals`, `reveals` | `src/scenes/GameScene.ts:423`, `:433`, `:669` |
| `unlockThrough` after rewarded skip | `src/scenes/GameScene.ts:543` |
| `flush()` on leaving to Menu | `src/scenes/GameScene.ts:564` |
| `figures` (gallery, share) | `src/scenes/GalleryScene.ts:65`, `src/scenes/GameScene.ts:497` |

`Progress.reset()` (`:298`) is marked "Dev only" and has **no callers**.

---

# 2. Audio

`src/systems/Audio.ts`. No plugin, no asset files — pure WebAudio synthesis.
**WHY** (`:13-15`): five notes and a thud as files would be five HTTP requests
plus decode on a cold start that is currently under a second.

## 2.1 API (verbatim)

```ts
setEnabled(v: boolean): void        // :34
get isEnabled(): boolean            // :38
unlock(): void                      // :47
resetScale(): void                  // :68
note(): void                        // :73
thud(): void                        // :84
chime(): void                       // :133
```

Private: `tone(hz: number, seconds: number, peak: number, type: OscillatorType): void`
(`:143-148`), `ready(): boolean` (`:168`).

Internal state (`:29-32`):

```ts
private ctx: AudioContext | null = null;
private master: GainNode | null = null;
private enabled = true;
private step = 0;
```

## 2.2 The scale

```ts
const PENTATONIC = [0, 2, 4, 7, 9];
const ROOT_HZ = 261.63; // C4
```
`:19-20`

```ts
function semitone(step: number): number {
  const octave = Math.floor(step / PENTATONIC.length);
  const degree = PENTATONIC[step % PENTATONIC.length];
  return degree + octave * 12;
}
```
`:22-26`

`note()` plays `ROOT_HZ * Math.pow(2, semitone(this.step) / 12)` and then
increments `step` (`:75-76`). `step` is unbounded — step 5 is C5, step 10 is
C6, and so on; nothing clamps it, so a level with many obstacle rows simply keeps
climbing. Major pentatonic is chosen because it has no semitone clashes, so any
two notes land well together (`:18`).

**One note per obstacle ROW, not per obstacle.** `GameScene` builds gates by
deduping the vertical midpoints of the player's walls and the mirror bands
(`src/scenes/GameScene.ts:167-173`):

```text
mids = Set( round(w.y + w.h/2) for w in [...walls, ...mirrorBands] )
gates = [...mids] sorted DESC (bottom-most first), each { mid, passed:false }
```

`ringGates(from, to)` fires a note the first time a stroke segment crosses a
gate's midpoint (`GameScene.ts:266-275`), test `from.y > gate.mid !== to.y >
gate.mid`, with `gate.passed` making it once-only per attempt.

Reset points:

| Event | Call | Line |
| --- | --- | --- |
| Level load | `Audio.resetScale()` + all `gate.passed = false` implicitly via rebuild | `src/scenes/GameScene.ts:177` |
| Each new stroke (pointer down on the start dot) | `for (const gate of this.gates) gate.passed = false; Audio.resetScale();` | `src/scenes/GameScene.ts:221-222` |

So the phrase restarts from C4 on **every attempt**, which is what makes a clean
run play as a single rising phrase (`:1-8`).

## 2.3 Node graph

```text
unlock():   AudioContext ──▶ master GainNode (gain = 0.5) ──▶ ctx.destination     :56-59

note():     Osc(triangle, hz)      ──▶ Gain(env 0.16 peak, 0.55 s) ──▶ master     :77
            Osc(sine,    hz*2)     ──▶ Gain(env 0.045 peak, 0.32 s) ──▶ master    :80

thud():     Osc(sine) 150 Hz ─exp─▶ 58 Hz over 0.16 s
                               ──▶ Gain(0.0001 →exp 0.3 @6 ms →exp 0.0001 @220 ms) ──▶ master   :93-105
            BufferSource(white noise, sampleRate*0.05 frames, linear fade)
                               ──▶ BiquadFilter(lowpass, 900 Hz)
                               ──▶ Gain(0.12 →exp 0.0001 @60 ms) ──▶ master        :109-127

chime():    three tone() calls, semitones [0, 4, 7] over root = ROOT_HZ * 2,
            scheduled with window.setTimeout at i * 90 ms, each 0.9 s / peak 0.09  :133-141
```

Exact constants, verbatim:

| Sound | Constants | Line |
| --- | --- | --- |
| master gain | `0.5` | `:58` |
| note fundamental | `this.tone(hz, 0.55, 0.16, 'triangle')` | `:77` |
| note octave shine | `this.tone(hz * 2, 0.32, 0.045, 'sine')` | `:80` |
| thud body | `setValueAtTime(150, now)`, `exponentialRampToValueAtTime(58, now + 0.16)`; gain `0.0001 → 0.3 @ +0.006 → 0.0001 @ +0.22`; `osc.stop(now + 0.24)` | `:95-106` |
| thud transient | `frames = Math.floor(ctx.sampleRate * 0.05)`, noise `(Math.random() * 2 - 1) * (1 - i / frames)`, lowpass `900`, gain `0.12 → 0.0001 @ +0.06`, `stop(now + 0.06)` | `:109-129` |
| chime | `root = ROOT_HZ * 2`, `[0, 4, 7]`, `i * 90` ms, `tone(..., 0.9, 0.09, 'sine')` | `:135-140` |
| generic envelope | `0.0001 → peak @ +0.01 → 0.0001 @ +seconds`, `osc.stop(now + seconds + 0.02)` | `:159-165` |

**WHY `0.0001` and not `0`:** `exponentialRampToValueAtTime` cannot target zero.
The floor value is the standard workaround; changing it to `0` throws.

**WHY a thud and not a buzzer** (`:9-12`): the game asks the player to fail dozens
of times a minute. A buzzer reads as punishment; a damped low tone plus a short
filtered noise transient reads as a dropped pen. The noise burst is specifically
what makes it read as a physical knock rather than a synth blip (`:107-108`).

## 2.4 The iOS unlock requirement

```ts
unlock(): void   // :47-65
```

- Returns immediately if `enabled` is false (`:48`).
- Creates the context lazily, inside a real user gesture, using
  `window.AudioContext ?? webkitAudioContext` (`:51-55`); returns silently if
  neither exists.
- Calls `ctx.resume()` when `state === 'suspended'` (`:61`).
- Any throw nulls `this.ctx` (`:62-64`) — nothing propagates into the game loop.
  Because `unlock()` only builds a context when `this.ctx` is null, the next
  pointer-down retries construction from scratch; the failure is not sticky.

**WHY it cannot happen at boot** (`:42-46`): iOS refuses to start audio outside a
user gesture, and a context created at boot arrives permanently suspended.

`ready()` is the gate on every sound: `this.enabled && this.ctx !== null &&
this.ctx.state === 'running'` (`:168-170`). If the context is absent or still
suspended, every call is a no-op — this is the complete failure mode, there is no
fallback path.

**Only call site:** `Audio.unlock()` at `src/scenes/GameScene.ts:189`, the first
line of `onPointerDown`. Menu/level-select taps do not unlock audio — acceptable
because nothing plays outside `GameScene`. Consequence to be aware of:
`resume()` is asynchronous, so notes fired within the very first gesture of a
session can be dropped by `ready()`.

## 2.5 Audio call sites

| Call | Site |
| --- | --- |
| `unlock()` | `src/scenes/GameScene.ts:189` |
| `resetScale()` | `src/scenes/GameScene.ts:177` (level load), `:222` (stroke start) |
| `note()` | `src/scenes/GameScene.ts:272` (inside `ringGates`) |
| `thud()` | `src/scenes/GameScene.ts:306` (in `fail`, after `Haptics.thud()`) |
| `chime()` | `src/scenes/GameScene.ts:350` (in `win`) |

`setEnabled` / `isEnabled` have **no callers** — there is no sound-settings UI.
See §6.

---

# 3. Haptics

`src/systems/Haptics.ts`. Backed by `@capacitor/haptics` (`^7.0.5`).

```ts
setEnabled(v: boolean): void   // :20
tick(): void                   // :25   ImpactStyle.Light  — one obstacle passed
thud(): void                   // :30   ImpactStyle.Medium — the stroke died
tap(): void                    // :35   ImpactStyle.Light  — a button was pressed
```

Private: `impact(style: ImpactStyle): void` (`:39-44`). State: `private enabled = true` (`:18`).

```ts
private impact(style: ImpactStyle): void {
  if (!this.enabled || !isNative()) return;
  void Native.impact({ style }).catch(() => {
    /* ignore */
  });
}
```
`src/systems/Haptics.ts:39-44`

| Aspect | Behaviour |
| --- | --- |
| Native gate | `Capacitor.isNativePlatform()` (`:15`) |
| Web | complete no-op — the module never touches `navigator.vibrate` |
| Failure | promise rejection swallowed (`:41-43`); never awaited, so the game loop cannot stall on it |
| `ImpactStyle` values | `LIGHT` / `MEDIUM` / `HEAVY` (`node_modules/@capacitor/haptics/dist/esm/definitions.d.ts:59-71`); `Heavy` is never used here |

**WHY there is no haptic on the win** (`:1-8`): the figure settling is a visual
beat and a buzz would step on it. The absence of feedback at exactly the moment
the player expects some is what makes the win read as calm. `win()`
(`src/scenes/GameScene.ts:329-375`) contains no `Haptics` call — verify before
"fixing" that omission.

Call sites: `GameScene.ts:273` (`tick`), `:305` (`thud`), `:421`, `:500`, `:539`,
`:563` (`tap`); `MenuScene.ts:100`, `:111`, `:191`, `:199`, `:208`;
`LevelSelectScene.ts:53`, `:122`; `GalleryScene.ts:55`, `:231`.

`setEnabled` has **no callers**.

---

# 4. Share

`src/systems/Share.ts`. Backed by `@capacitor/share` (`^7.0.4`) and
`@capacitor/filesystem` (`^7.1.8`).

## 4.1 Request shape (verbatim)

```ts
export interface ShareRequest {
  readonly dataUrl: string;
  readonly title: string;
  readonly text: string;
  readonly fileName: string;
}
```
`src/systems/Share.ts:29-34`

```ts
get available(): boolean                                    // :37
async shareFigure(req: ShareRequest): Promise<boolean>      // :46
```

Private: `shareNative(req)` (`:51`), `shareWeb(req)` (`:75`). Module helpers:
`stripDataUrl(dataUrl: string): string` (`:16-19`), `dataUrlToBlob(dataUrl:
string): Blob` (`:21-27`). No instance state.

`shareFigure` returns **true only if the image reached a share sheet**, false if
it merely saved — or if the user cancelled (`:45`, `:68-72`). Cancellation and
failure are indistinguishable by design, and in practice nothing consumes the
distinction: both call sites `await` the promise and discard its value, clearing
their busy flag in a `finally` (`src/scenes/GameScene.ts:507-515`,
`src/scenes/GalleryScene.ts:239-247`).

## 4.2 Native path

```ts
const written = await Filesystem.writeFile({
  path: req.fileName,
  data: stripDataUrl(req.dataUrl),
  directory: Directory.Cache,
});

await NativeShare.share({
  title: req.title,
  text: req.text,
  files: [written.uri],
  dialogTitle: req.title,
});
```
`src/systems/Share.ts:55-66`

- `stripDataUrl` slices everything after the first `,`, leaving bare base64
  (`:16-19`). `encoding` is deliberately omitted: with no `encoding` the plugin
  writes the string as base64-decoded **binary**
  (`node_modules/@capacitor/filesystem/dist/esm/definitions.d.ts:139-146`).
  Passing `Encoding.UTF8` would write the base64 text and produce a corrupt PNG.
- `Directory.Cache`, not `Documents` (rationale `:53-54`, the argument `:58`): the card is a derived artefact
  the player can always regenerate, so it has no business surviving in their file
  provider. Nothing in this codebase deletes it — the OS reclaims the cache.
- `written.uri` (a native file URI) is what the share sheet receives, not the
  data URL.
- Everything is inside one try/catch (`:52-72`); the catch returns `false`
  (`:68-72`).

## 4.3 Web path

`:75-101`, in order:

1. `dataUrlToBlob` — `atob` the base64, copy into a `Uint8Array`, wrap as
   `Blob({ type: 'image/png' })` (`:21-27`); then `new File([blob], req.fileName,
   { type: 'image/png' })`.
2. If `navigator.share` exists **and** `navigator.canShare({ files: [file] })`
   returns true → `navigator.share({ title, text, files })`, `true` on success,
   `false` if it throws (cancel included) (`:84-91`).
3. Otherwise: create an object URL, synthesize an `<a download>`, `click()`,
   `URL.revokeObjectURL(url)`, return `false` (`:93-100`). "No share sheet here —
   save it, so the button still does something."

`available` (`:37-43`) returns true if native **or** `navigator` exists **or**
`document` exists — in any browser or webview this is unconditionally true. It is
effectively a no-op check and has no callers.

## 4.4 Producing the `dataUrl`

Both callers build it with `renderShareCard` from `src/render/ShareCard.ts:124`:

```ts
export function renderShareCard(figure: SavedFigure, opts: CardOptions = {}): string
```

- `CARD_SIZE = 1080` (`src/render/ShareCard.ts:28`); returns `''` when the 2D
  context is unavailable (`:132`) — both call sites bail on falsy
  (`GameScene.ts:506`, `GalleryScene.ts:237`).
- It rebuilds the figure through a reference `new Playfield(BASE_WIDTH,
  BASE_HEIGHT, METRICS.inset)` and the same ribbon/smoothing code the game used
  (`:146-153`), which is the payoff of storing figures normalized.

Caller pattern (identical in both scenes, `src/scenes/GameScene.ts:496-516` and
`src/scenes/GalleryScene.ts:228-248`):

```ts
await Share.shareFigure({
  dataUrl,
  title: 'My foldwing',
  text: `One line, mirrored. ${figure.levelName} in ${(figure.ms / 1000).toFixed(1)}s.`,
  fileName: `foldwing-${figure.levelId}-${figure.at}.png`,
});
```

`figure.at` in the filename is what makes concurrent shares of different figures
land on different cache files. A re-entrancy flag (`this.sharing` /
`this.busy`) guards double taps.

---

# 5. Rate

`src/systems/Rate.ts`. Backed by `@capacitor-community/in-app-review`
(`^7.1.0`), whose entire surface is `requestReview(): Promise<void>`
(`node_modules/@capacitor-community/in-app-review/dist/esm/definitions.d.ts:1-3`).

```ts
shouldAsk(adWillShow: boolean): boolean   // :20
async ask(): Promise<void>                // :28
```

No instance state — everything lives in `Progress.data.ratePrompted` and
`totalWins`.

```ts
shouldAsk(adWillShow: boolean): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  if (adWillShow) return false;
  const save = Progress.data;
  if (save.ratePrompted) return false;
  return save.totalWins >= monetization.rate.firstPromptAfterWins;
}
```
`src/systems/Rate.ts:20-26`

| Gate | Value | Source |
| --- | --- | --- |
| Native only | `Capacitor.isNativePlatform()` — web never prompts | `:21` |
| Not stacked on an ad | caller passes `Ads.wouldShowInterstitial(...)` | `:22`, `src/scenes/GameScene.ts:368-372` |
| Once ever | `ratePrompted` | `:24` |
| Enough wins | `monetization.rate.firstPromptAfterWins` = `6` | `:25`, `src/config/monetization.ts:166` |
| Only after a win | there is no call from `fail()` | `src/scenes/GameScene.ts:372` |

```ts
async ask(): Promise<void> {
  Progress.update({ ratePrompted: true });
  try {
    await InAppReview.requestReview();
  } catch {
    /* the prompt is a nicety; never let it surface as an error */
  }
}
```
`src/systems/Rate.ts:28-35`

- `ratePrompted` is set **before** the await, so the prompt is spent even if the
  plugin throws or the OS silently suppresses it. Intentional: `SKStoreReview`
  gives no callback and Apple throttles to roughly three prompts a year (`:1-7`),
  so "did it appear?" is unknowable and retrying would burn the quota anyway.
- `ask()` does **not** re-check `shouldAsk()`. Calling it directly spends the
  one-shot flag. The only correct invocation is the guarded one.

Trigger timing (`src/scenes/GameScene.ts:359-374`):

```text
win()
  readyIn = METRICS.winHoldMs (180) + METRICS.winSettleMs (350) + 250  = 780 ms
  adWillShow = Ads.wouldShowInterstitial(levelIndex, Progress.data.winsSinceAd)
  if (Rate.shouldAsk(adWillShow))
      delayedCall(readyIn + 400 = 1180 ms) → Rate.ask()
```

The delay puts the prompt after the figure has settled and after the "tap for the
next fold" hint appears — a delight peak, never over the reward, never in the same
beat as an ad. Constants: `src/render/Theme.ts:182-183`.

---

# 6. Dead code, gaps, and things a test does NOT pin

**No test file covers any of these five modules.** `grep` over `src/**/*.test.ts`
finds zero references to `Progress`, `Audio`, `Haptics`, `Share`, `Rate`. The
only test touching this area is `src/config/monetization.test.ts`, and what it
pins is AdMob identifier shape, the `Info.plist` ↔ `useTestAds` agreement, the ad
cadence constants, and `reveals.offerSkipAfterAttempts >= 5`
(`src/config/monetization.test.ts:106-108`) — **not**
`rate.firstPromptAfterWins`, **not** `reveals.startingStash` /
`reveals.freeDailyTopUp` / `reveals.durationMs`. Every constant quoted in §1 and
§5 is therefore free-floating: change it and nothing goes red. See
[12-testing.md](12-testing.md).

Unreferenced (verified by grep across `src/` and `scripts/`):

| Symbol | Line | Note |
| --- | --- | --- |
| `Audio.setEnabled` / `Audio.isEnabled` | `:34`, `:38` | no sound toggle in any scene; `enabled` is permanently `true` |
| `Haptics.setEnabled` | `:20` | same |
| `Share.available` | `:37` | and it would return `true` unconditionally anyway |
| `Progress.reset` | `:298` | marked "Dev only" |

Sharp edges worth knowing before editing:

1. `coerce` accepts any `bestMs` object without validating its values
   (`Progress.ts:124`) — a string value would flow into whatever formats best
   times.
2. `coerce`'s figure filter never checks `times.length === points.length`
   (`Progress.ts:113-118`). Safe today only because `src/core/Ribbon.ts:62` and
   `src/core/StrokeRecorder.ts:100-105` use `times[i] ?? 0`; any consumer that indexes
   `times` without a fallback would produce `NaN` geometry.
3. `Progress.figures` allocates a reversed copy per call (`:207`).
4. `Audio.chime()` schedules three `window.setTimeout` callbacks (`:137`) that
   are not cancelled on scene shutdown — leaving the level within 180 ms of a win
   still plays the remaining notes.
5. `shareWeb` calls `URL.revokeObjectURL(url)` on the line immediately after
   `a.click()` (`Share.ts:98-99`), synchronously; download start is
   browser-dependent.
6. `README.md:157` describes `BootScene.ts` as the "future home of preload +
   audio unlock". Stale — the audio unlock lives in
   `src/scenes/GameScene.ts:189`, and it has to, because it needs a user gesture.

## See also

- [00-index.md](00-index.md) — doc map
- [01-architecture.md](01-architecture.md) — module layering and boot order
- [02-coordinate-system.md](02-coordinate-system.md) — normalized ↔ pixel, the basis of `SavedFigure`
- [04-stroke-ribbon.md](04-stroke-ribbon.md) — how `points` + `times` become ink
- [05-rendering.md](05-rendering.md) — `ShareCard`, `InkRenderer`
- [06-scenes.md](06-scenes.md) — every call site listed above
- [10-monetization.md](10-monetization.md) — `Ads`, `Iap`, `config/monetization.ts`
- [12-testing.md](12-testing.md) — what is and is not covered
- [13-api-reference.md](13-api-reference.md) — flat symbol index
- [15-change-recipes.md](15-change-recipes.md) — safe edits
- [../README.md](../README.md) — rationale for the audio and share design
- [../SUBMIT.md](../SUBMIT.md) — store-review context for the rate prompt
