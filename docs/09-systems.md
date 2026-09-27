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
> **1.4 (September 2026) added more here than anywhere else**, and those parts are
> current: every reveal now arrives through one grant path with events (§1.9), the
> save gained the economy's fields without a schema bump (§1.2, §1.5), the daily
> reveal is LOCAL and runs on every foreground, the review prompt asks once per
> version and only at a peak (§5), the win plays a haptic and `Audio.chime()` is gone
> (§2, §3), and two new sections cover the economy's rules — missions, streak
> bookmarks and repair, chapter marks (§6) — and the local reminders (§7). Money
> itself (the store, the cap, the ladder) is in
> [10-monetization.md](10-monetization.md).

---

# Systems: Progress, Audio, Haptics, Share, Rate, Nudges, Sessions

## What this covers

The cross-cutting singleton services under `src/systems/` that are not
monetization: save persistence, procedural audio, haptics, the share pipeline,
the store-review prompt and the reminders — plus the pure rules under `src/core/`
the 1.4 economy runs on (streaks, missions, chapters), and what counts as a
session (§8). For each: the exported
singleton, public API, internal state, native backing plugin, web fallback, and
behaviour when the native layer is absent. `Ads.ts` and `Iap.ts` live in
[10-monetization.md](10-monetization.md).

## Source files

| Path | Lines | Role |
| --- | --- | --- |
| `src/systems/Progress.ts` | — | Save data: schema, validation, debounced writes, unlock/reveal rules, figure store; since 1.4 the one grant path, the win settle, streak guard and repair, missions, chapter marks, session days |
| `src/systems/Audio.ts` | — | WebAudio synthesis: pentatonic note ladder, collision thud, win celebration, reward pop / chord / streak swell |
| `src/systems/Haptics.ts` | — | Capacitor Haptics wrapper, native-only, fire-and-forget; a throttle for reward bursts |
| `src/systems/Share.ts` | — | PNG data-URL → cache file → native share sheet; Web Share / download fallback |
| `src/systems/Rate.ts` | — | Native in-app review prompt: once per app version, only at a peak, never on an ad or another ask |
| `src/systems/Nudges.ts` / `NudgePlan.ts` | — | Local reminders: the plan (pure) and the service that writes it to the plugin, never prompting |
| `src/core/Session.ts` | — | What counts as a session, pure: `isNewSessionOnReturn`, `onHidden` (keeps the first hide), `onVisible`, `SESSION_GAP_MS` (§8) |
| `src/systems/SessionLifecycle.ts` | — | The app's one session service: the cold start, hide/visible from `main.ts`, the persisted count, `onSessionStart`, `renewedSinceLaunch`, and the ad layer's starter gate `whenAdLayerMayStart` (§8) |
| `src/core/Streak.ts`, `Missions.ts`, `Rewards.ts` | — | The 1.4 economy's rules, pure: streaks through bookmarks, the day's three missions, chapter marks |
| `src/config/monetization.ts` | — | Constants consumed by Progress (`reveals.*`, `economy.*`) |
| `src/render/ShareCard.ts` | 204 | `renderShareCard()` — produces the data URL `Share` consumes |
| `src/core/Playfield.ts` | 87 | `toNormalized` / `toScreen` — the transform that makes `SavedFigure` portable |

The six services export a single pre-constructed instance; there is no DI, no
factory, no reset hook except `Progress.reset()`. Importing a module is
sufficient to use it. The `core/` rules export functions only.

| Module | Export line | Exported symbol |
| --- | --- | --- |
| Progress | `src/systems/Progress.ts:304` | `export const Progress = new ProgressStore();` |
| Audio | `src/systems/Audio.ts:173` | `export const Audio = new AudioService();` |
| Haptics | `src/systems/Haptics.ts:47` | `export const Haptics = new HapticsService();` |
| Share | `src/systems/Share.ts:104` | `export const Share = new ShareService();` |
| Rate | `src/systems/Rate.ts` | `export const Rate = new RateService();` |
| Nudges | `src/systems/Nudges.ts` | `export const Nudges = new NudgeService();` |

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
  version: number;                      // what the level ids mean — SCHEMA, now 3 (§1.5)
  unlockedIndex: number;                // highest level index unlocked; 0 = only the first
  bestMs: Record<string, number>;       // best time per level id, ms
  cleared: string[];                    // level ids ever cleared
  reveals: number;                      // banked reveals; spent by choice, never auto-consumed
  lastTopUp: string;                    // LOCAL ISO date of the last free daily reveal
  adsRemoved: boolean;                  // persisted so relaunch needs no store call
  totalWins: number;                    // ad cadence, the starter's five-win gate
  winsSinceAd: number;                  // wins since the last interstitial actually rendered
  attemptsSinceAd: number;              // failed attempts since then
  ratePrompted: boolean;                // spent on ANY version; kept for builds before 1.4
  figures: SavedFigure[];               // newest last, at most 120
  daily: Record<string, DailyResult>;   // finished Daily Folds by ISO date: { ms, deaths, foldSense }
  medals: string[];                     // level ids won within 1.25× par
  foldSense: number;                    // 0..100 EMA of recent win scores; 0 = unrated
  sound: boolean; music: boolean; haptics: boolean; reducedMotion: boolean;
  capability: string;                   // what this webview can encode, stamped at boot (diagnostic)

  /* 1.4, additive: no SCHEMA bump, because no level id changed meaning. */
  bookmarks: number;                    // streak bookmarks held, 0..2
  bookmarked: string[];                 // missed days a bookmark or a repair covered — NOT played days
  lastRepair: string;                   // ISO date of the last streak repair, '' for never
  missions: MissionState | null;        // today's three; null until they unlock, or after a bad record
  chapterMarks: string[];               // chapter marks already paid, "c:10" / "c:20"
  starterBought: boolean;               // the one-time starter: never offered again
  starterSeen: boolean;                 // …and no NEW badge on the Store button
  rewardedDay: string;                  // the ad-paid reveal cap: the local day counted…
  rewardedToday: number;                //   …and how many were paid on it
  grantedTx: string[];                  // store transaction ids already credited — a redelivery pays once
  taught: Lesson[];                     // one-time lessons shown: 'mirror' | 'reveal'
  reminders: boolean;                   // the player's Reminders switch (permission is the OS's)
  nudgeAsks: number;                    // soft asks for notification permission so far (≤ 3)…
  nudgeAskedOn: string;                 //   …and the day of the last one
  sessionMinutes: number[];             // minute of day of the first foreground of each of the last 7 days
  lastSeen: string;                     // ISO date of the latest foreground
  playDays: number;                     // distinct local days played — the review prompt waits for the 2nd
  ratePromptedVersion: string;          // the app version the review prompt was spent on; '' for none
}
```
`src/systems/Progress.ts` (`SaveData`)

Fresh-save defaults (`freshSave()`):

| Field | Default | Note |
| --- | --- | --- |
| `version` | `SCHEMA` = `3` | |
| `unlockedIndex` | `0` | |
| `bestMs` / `daily` | `{}` | |
| `cleared` / `medals` / `figures` | `[]` | |
| `reveals` | `monetization.reveals.startingStash` = `2` | the day-one top-up makes it 3 |
| `lastTopUp` | `''` | empty ⇒ first `load()` always grants a top-up |
| `adsRemoved`, `ratePrompted` | `false` | |
| `totalWins` / `winsSinceAd` / `attemptsSinceAd` / `foldSense` | `0` | |
| `sound` / `music` / `haptics` | `true` | |
| `reducedMotion` | the OS setting | |
| `bookmarks`, `rewardedToday`, `nudgeAsks`, `playDays` | `0` | a 1.3 save with Daily history is seeded **one** bookmark (§1.5) |
| `bookmarked`, `chapterMarks`, `grantedTx`, `taught`, `sessionMinutes` | `[]` | |
| `lastRepair`, `rewardedDay`, `nudgeAskedOn`, `lastSeen`, `ratePromptedVersion`, `capability` | `''` | |
| `missions` | `null` | |
| `starterBought`, `starterSeen` | `false` | |
| `reminders` | `true` | the switch; nothing is scheduled without the OS permission (§7) |

## 1.3 Public API

The 1.3 surface, unchanged in meaning:

```ts
get data(): Readonly<SaveData>
async load(): Promise<SaveData>
update(patch: Partial<SaveData>): void
isUnlocked(index: number): boolean
hasCleared(id: string): boolean
recordWin(levelId: string, levelIndex: number, elapsedMs: number, totalLevels: number): void
addFigure(figure: SavedFigure): void
get figures(): readonly SavedFigure[]
unlockThrough(levelIndex: number, totalLevels: number): void
get reveals(): number
spendReveal(): boolean
recordDaily(dateISO: string, result: DailyResult): void
dailyResult(dateISO: string): DailyResult | null
hasDaily(dateISO: string): boolean
addMedal(levelId: string): void
hasMedal(levelId: string): boolean
installLifecycleFlush(): void
async flush(): Promise<boolean>          // true = written; false before load() or on a failed write
async reset(): Promise<void>
```

Added in 1.4:

```ts
// grants — the one path (§1.9)
grantReveals(n: number, reason: GrantReason = 'purchase'): boolean  // false for n ≤ 0, fractions, NaN, ∞, or before load()
onGrant(cb: GrantListener): () => void          // cb(g) after the balance is written; return true if you SHOWED it
takeUnshownGrants(): GrantEvent[]               // 'daily' / 'late-purchase' grants nobody showed; drained
creditTransaction(txId: string, n: number, reason?): boolean   // grant + tx id in one update (10 §7.3)
hasGrantedTx(txId: string): boolean
applyDailyTopUp(now?: Date): number             // 0 or 1; was private
adRevealsLeft(now?) / canAdPay(n?, now?) / payAdReveals(n?, now?) / recordAdReveal(now?, n?)   // the daily ad cap
setAdsRemoved(owned: boolean, reason?): void    // emits { 0, 0, reason, adsRemoved } on a change
markStarterSeen(): void; markStarterBought(): void
// streak (§6.2)
dailyStreak(today: string): number              // Streak.streakFrom: bridged days bridge but do not count
longestStreak(): number
get bookmarks(): number
applyStreakGuard(now?: Date): StreakGuard | null   // idempotent; spends bookmarks on missed days
takeStreakGuard(): StreakGuard | null           // what the guard spent since last asked; drained
repairableDay(today): Day | null; repairPays(today): readonly Milestone[]; repairStreak(today): boolean
dailyUnlocked(): boolean                        // the one Daily-lock rule
// missions and chapters (§6.3, §6.4)
missionsToday(now?: Date): MissionState | null  // null until missions unlock; rolls over at local midnight
settleChapterMarks(reason: GrantReason = 'backlog'): { marks: string[]; reveals: number }
// the win (§6.5)
snapshotForWin(levelId: string, levelIndex: number, now?: Date): WinBefore
settleWin(before: WinBefore, facts: WinFacts, now?: Date): WinOutcome
// sessions, reminders, lessons
markSeen(now?: Date): void                      // lastSeen, sessionMinutes, playDays
setReminders(on: boolean): void; recordNudgeAsk(today: string): void
teach(lesson: Lesson): boolean; isTaught(lesson: Lesson): boolean   // teach is true only the first time
get skipsSinceLaunch(): number                  // session only, never saved (Rate)
```

`GrantReason` = `'daily' | 'mission' | 'chapter' | 'streak' | 'rewarded' | 'purchase' |
'late-purchase' | 'backlog' | 'repair'`. `GrantEvent` = `{ reveals, bookmarks, reason,
adsRemoved? }`.

Internal state, beyond the three 1.3 fields (`state`, `flushTimer`, `lifecycleBound`):
`loaded`, the listener set, the unshown grants, the pending guard report, the `WeakSet`
of settled `WinBefore`s (settling one twice pays nothing) and the session skip count.

`data` returns the live object, not a copy — `Readonly<SaveData>` is a compile-
time guard only. `update()` replaces `this.state` with a shallow spread, so nested
objects passed in are aliased; `recordWin` copies `bestMs` before mutating for
exactly this reason.

## 1.4 Boot sequence — the only correct order

```text
BootScene.create()                       src/scenes/BootScene.ts:24
  Progress.installLifecycleFlush()       :27   (idempotent, guarded by lifecycleBound)
  Progress.load()  ──await──▶ save       :28
      Preferences.get({key})  →  JSON.parse  →  coerce()
        →  applyDailyTopUp()  →  applyStreakGuard()  →  markSeen()
  .then(save =>
      Ads.setAdsRemoved(save.adsRemoved) :31   entitlement BEFORE any ad request
      scene.start('Menu')                :32
      Ads.init(); Iap.init()             :34, :52   not awaited)
```

Nothing may read `Progress.data` before `load()` resolves — the first scene
(`Menu`) is started from inside that `.then`, and every other scene is reached
from it. `load()` is called exactly once, from `BootScene:28`. Every write that
pays something refuses before it (`grantReveals`, `creditTransaction`,
`payAdReveals` return false): the placeholder save is thrown away by `load()`, and
a purchase credited to it would be lost with it. After that, main.ts runs the same
three — top-up, streak guard, `markSeen` — on every return to the foreground, then
rebuilds the reminders and clears delivered ones.

## 1.5 Validation / migration — `coerce()`

`src/systems/Progress.ts:89-135`. The base strategy: **merge over
`freshSave()`**, so a save written by an older build never has holes, and every
field is re-validated on the way in.

**Versioned since the maze rewrite (this section predates it).** The save carries
`version` (absent ⇒ `1`), and `SCHEMA` is the version of what the level ids in it
*mean*. It is now **3**:

| version | what the ids name | what reading an older save drops |
| --- | --- | --- |
| 1 | bar tutorial `l1`–`l5` + bar levels `l6`–`l100` | — |
| 2 | bar tutorial `l1`–`l5` + maze ladder `l6`–`l300` | from v1: every id-keyed entry |
| 3 | tutorial mazes `l1`–`l5` + the same `l6`–`l300`, byte-identical | from v2: entries for `l1`–`l5` only |

"Id-keyed" means `cleared`, `bestMs` and `medals`, filtered through
`idSurvives(version, id)`. The v3 set is the literal `REAUTHORED_IN_V3 =
{'l1', …, 'l5'}`, written out rather than derived from `TUTORIAL_LEVELS`: the
table only knows what the ids mean now. Matching is exact, never by prefix, so
`l10` and `l100` survive. Everything else is kept: `unlockedIndex` (access is an
index, and taking it back would be unkind), figures (each one carries the walls
it was drawn through), reveals, purchase, dailies, `totalWins`. `version` is
written as `max(version, SCHEMA)` and never lowered, so a save from a newer
build is left alone, and a migrated save does not migrate again. `load()` does
not write, though: a relaunch before the first flush re-reads the old bytes and
migrates them again, with the same result.

Two knock-on rules. The level-1 "press the dot" hint keys on
`totalWins === 0`, not on `l1` being cleared, so an upgrading player is not
taught to press the dot again. The level-6 Reveal hint still keys on `l6`, which
v3 does not touch. Both migrations are pinned by `src/systems/Progress.test.ts`
(`the v1 to v2 migration`, `the v2 to v3 migration: the tutorial became mazes`).

```ts
const count = (n: unknown, fallback: number, min = 0): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : fallback;
```
`src/systems/Progress.ts:105-106`

| Field | Coercion | Line |
| --- | --- | --- |
| `unlockedIndex`, `reveals`, `totalWins`, `winsSinceAd`, `attemptsSinceAd` | `count(...)` — rejects `NaN`/`Infinity`, truncates fractions, floors at `0` | `:123`, `:126`, `:129-131` |
| `bestMs` | accepted whole if `typeof === 'object' && !== null`; **values are not validated** — *today each entry is kept only if its id survives the migration and its value is a finite number ≥ 0* | `:124` |
| `cleared` | array filtered to `typeof c === 'string'` — *today also filtered through `idSurvives`; `medals` likewise* | `:125` |
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

**The 1.4 fields** are additive — a 1.3 save simply lacks them and `coerce()` fills
them in — and every one is treated as hostile input (NaN, negative, over the cap,
bad strings, wrong types each have a case in `Progress.test.ts`):

| Field | Coercion |
| --- | --- |
| `bookmarks` | `count()`, clamped to `bookmarkMax` (2). **Missing and `daily` not empty ⇒ 1** — the seed for loyal 1.3 players, reapplied on every load until the first write |
| `bookmarked` | real calendar dates only (`isDay`: `'2026-02-30'` matches `ISO_DATE` and is still dropped), none in the future, deduplicated, sorted, at most 60, never trimmed inside the current run |
| `lastRepair`, `rewardedDay`, `nudgeAskedOn`, `lastSeen` | a real date or `''`; a date in the future is stamped back to today, never rewarded |
| `missions` | strict: an unknown mission id, a wrong length, a bad type or date nulls the whole record; a finished slot is marked paid and progress clamped to its target |
| `chapterMarks` | `^(\d\|1[0-4]):(10\|20)$`, deduplicated. Missing ⇒ `[]`, and the menu pays the backlog (§6.4) |
| `starterBought`, `starterSeen` | `=== true` |
| `rewardedToday` | `count()`, clamped to the cap |
| `grantedTx` | strings of 1–64 characters, the newest 100 (a longer id is stored by its last 64, or the next load would drop it and pay again) |
| `taught` | only `'mirror'` and `'reveal'` |
| `reminders` | `!== false` |
| `nudgeAsks` | 0..3 |
| `sessionMinutes` | integers 0..1439, the last 7 |
| `playDays` | `count()`; a missing one is seeded from what the save can date (Daily days, figure dates, `lastSeen`, session samples) so a 1.3 veteran does not wait a day for the 1.4 review prompt |
| `ratePromptedVersion` | a string of 32 characters or fewer, else `''` — so a pre-1.4 `ratePrompted: true` reads as "spent on an older version" and 1.4 may ask once |

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

## 1.9 Reveals, and the one grant path

| Rule | Behaviour |
| --- | --- |
| `get reveals()` | `Number.POSITIVE_INFINITY` when `adsRemoved`, else `state.reveals` |
| `spendReveal()` | `true` immediately if `adsRemoved`; `false` if `reveals <= 0` (the caller opens the refill sheet); otherwise decrements and returns `true` |
| `grantReveals(n, reason)` | refuses a non-positive, fractional or non-finite `n`, and any call before `load()`; otherwise `state.reveals + n` on the raw field, then announces it |
| Daily top-up | `applyDailyTopUp(now)`: `+monetization.reveals.freeDailyTopUp` (= `1`) on the first `load()` or foreground of each LOCAL day; returns what it paid; a `lastTopUp` in the future is stamped back to today and pays nothing |

**Every grant goes through one path.** No file outside Progress writes the balance —
daily top-up, missions, chapter marks, streak milestones, repairs, rewarded ads,
purchases, the backlog all end in the private `emit`, after the balance is written:

```ts
type GrantListener = (g: GrantEvent) => boolean | void;   // return true if you SHOWED it
Progress.onGrant(cb): () => void                           // subscribe in create(), unsubscribe on SHUTDOWN
```

Who presents what: the flow that caused a grant says it (the store sheet its
purchase, the win card its missions and marks, the Streak sheet its repair), so a
listener presents only what nobody else will — the day's free reveal (`'daily'`) and a
purchase that landed with no button waiting on it (`'late-purchase'`: Ask to Buy, a
redelivery after a crash). Those two, if no listener returns `true`, are kept (up to
20) for `takeUnshownGrants()`: `load()` pays the cold-launch gift before any scene
exists, so without the queue the menu could never show it. An event with 0 reveals and
0 bookmarks is a state change, not currency — `setAdsRemoved` on a change, a repair —
and exists for listeners that rebuild from the save: main.ts rebuilds the reminder
schedule on `adsRemoved`, `'repair'` and any bookmark, and never returns `true`
(returning true there would hide the daily gift from the menu).

**TRAP — `Progress.reveals` is not round-trippable.** The getter can be
`Infinity`; `JSON.stringify(Infinity)` is `"null"`, and `coerce`'s `count()`
would then reject it and reset the stash to `startingStash` (`2`). Every
internal writer therefore reads the raw field `this.state.reveals`, never the
getter. Never write `Progress.update({ reveals: Progress.reveals })`.

**The daily boundary is LOCAL now.** It ran on `new Date().toISOString()` — UTC —
while the Daily Fold rolled over locally, so west of Greenwich the pill's "one more
lands tomorrow" pointed at a different day than the fold it was offered on. It uses
`CalendarDay.todayISO` today, and main.ts calls it on every foreground, so an app left
open across midnight gets its reveal on the next return instead of the next launch.
Vitest runs in `Europe/Belgrade` (`vite.config.ts`) because on a UTC runner the tests
that catch this pass vacuously.

**Side effect of the top-up running inside `load()`:** on any first launch of a local
day it calls `update()`, which schedules a write — a fresh install therefore persists
its save ~250 ms after boot without the player doing anything.

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
| `ms` | `at - this.strokeStartedAt`, both input-event times (see 04-stroke-ribbon, "Wiring") — the same value passed to `recordWin` | `GameScene.win` |
| `at` | wall-clock `Date.now()`; the save's key for the figure (share file names are `Share.shareFileName`: "Foldwing - <level name>") | `GameScene.win` |
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
setEnabled(v: boolean): void
get isEnabled(): boolean
unlock(): void
resetScale(): void
note(): void
thud(): void
celebrate(medal: boolean): void     // the level is beaten; taller with the medal
pop(): void                         // 1.4: a reward token landed — sine 880→1320 Hz, 90 ms, peak 0.07
reward(): void                      // 1.4: a purchase, a chapter completed — C6/E6/G6 triangles 60 ms apart, peak 0.07
streakUp(): void                    // 1.4: the streak went up — a 200 ms low-passed noise swell under G5, peak 0.06
```

`chime()` is gone — it had no callers once `celebrate` took over the win. Its
`scheduleChime` stays, used only by the replay video's soundtrack. Each sound is a
pure `schedule*(ctx, out, at)` function the service calls, which is what lets
`Audio.test.ts` render them offline.

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
            scheduled with window.setTimeout at i * 90 ms, each 0.9 s / peak 0.09
            (the 1.3 win sound; now scheduleChime, for the replay video only)
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
| `celebrate(medal)` | `GameScene.win`, right after the figure is presented |
| `pop()` | `UI.flyReward` and the result card's tokens, on the first and last to land |
| `reward()` | a purchase landing (`StoreSheet`), a chapter completed on the win card |
| `streakUp()` | the Daily win card's streak flip, and a repair in the Streak sheet |

`setEnabled` is called from `BootScene` (the saved switch) and the Settings sheet's
Sound row.

---

# 3. Haptics

`src/systems/Haptics.ts`. Backed by `@capacitor/haptics`.

```ts
setEnabled(v: boolean): void
tick(): void      // ImpactStyle.Light  — a gate crossed mid-stroke
thud(): void      // ImpactStyle.Medium — the stroke died
tap(): void       // ImpactStyle.Light  — a button was pressed
land(): void      // 1.4: impact Light — the win figure has SETTLED (an ordinary win)
success(): void   // 1.4: notification Success — a medal, a purchase, the streak going up, a chapter complete
warn(): void      // 1.4: notification Warning — a refusal: a locked card, the locked Daily
select(): void    // 1.4: selection feedback — a Settings switch
reward(): void    // 1.4: impact Light through BurstThrottle(60 ms apart, 3 per burst) — a reward token landing
```

`BurstThrottle` exists because six tokens landing 45 ms apart asked for six taps in a
quarter of a second, which the Taptic Engine plays as one long buzz: three distinct
taps read as "several things arrived", six read as a fault. `select()` calls
`selectionStart`, `selectionChanged`, `selectionEnd` in turn — in the Capacitor 8
plugin on iOS, `selectionChanged` alone does nothing.

| Aspect | Behaviour |
| --- | --- |
| Native gate | `Capacitor.isNativePlatform()` |
| Web | complete no-op — the module never touches `navigator.vibrate` |
| Failure | promise rejection swallowed; never awaited, so the game loop cannot stall on it |
| Switch | `setEnabled` from `BootScene` (the saved switch) and the Settings sheet's Haptics row |

**The win has a haptic now, and where it lands is the point.** 1.3 kept the win
silent to the hand, on the reasoning that a buzz would step on the figure settling.
It still never fires when the ink closes: `land()` comes 530 ms in, when the figure
has settled — the end of that beat rather than an interruption of it — and a medal
takes `success()` instead, at the medal stamp. Things the player *receives* take
`success()` too, so the hand learns one feel for "you got something", and a refusal
takes `warn()` rather than the same light tap as a press that worked.

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

Caller pattern (identical in both scenes, `GameScene.shareCurrent` and
`GalleryScene.shareImage`; the videos use `shareVideo` the same way):

```ts
await Share.shareFigure({
  dataUrl,
  title: 'My foldwing',
  text: shareText(figure),
  fileName: shareFileName(figure.levelName, 'png'),   // "Foldwing - Sacrifice.png"
});
```

The file name is what the share sheet shows as the attachment's title, so it is
the fold's name, not an id and a timestamp: `shareFileName` strips characters
unsafe in a file name or URL, caps the name at 60 characters and falls back to
"a fold". Sharing the same fold again overwrites the cache file; a re-entrancy
flag (`this.sharing` / `this.busy`) keeps two shares from running at once.

A replay is rendered behind a modal progress card that always comes down:
`renderReplayVideo` bounds each of its own steps (soundtrack 5 s, then the clip
goes out silent; each encoder step 5 s; video flush 20 s), the card offers
**Cancel** after `REPLAY_CANCEL_AFTER_MS` (2 s), and the caller aborts at
`REPLAY_CEILING_MS` (45 s). The win screen then ignores board taps for
`SHARE_QUIET_MS` after any share settles.

---

# 5. Rate

`src/systems/Rate.ts`. Backed by `@capacitor-community/in-app-review`, whose entire
surface is `requestReview(): Promise<void>`. Rewritten in 1.4 around a pure rule:
**at most one automatic ask per app version, and only at a peak.** With zero ratings
in every storefront, this prompt is the biggest single ranking lever the game has, and
the 1.3 rule — once per install, ever, after six wins of any kind — spent it on
whatever the sixth win happened to be.

```ts
export const RATE_RULES = { medalFromIndex: 9, streakFrom: 3, fromPlayDay: 2, struggleAttempts: 6 };
export interface RateWin { levelIndex: number | null /* null = Daily */; medal: boolean;
                           todayDailyFirst: boolean; streakAfter: number; attempts: number }
export interface RateMoment { adWillShow: boolean; quiet?: boolean; win: RateWin }
export function isPeak(win: RateWin): boolean                                   // pure
export function shouldAskAt(moment: RateMoment, ctx: RateContext): boolean      // pure
Rate.shouldAsk(moment: RateMoment): boolean     // native only; gathers the context, then shouldAskAt
Rate.ask(): Promise<void>
Rate.openStoreListing(): Promise<void>          // the Settings row: the write-a-review page, spends nothing
```

`shouldAskAt`, in order — the first that matches stands down, and standing down spends
nothing, so the next peak asks instead:

| # | Stands down when | Why |
| --- | --- | --- |
| 1 | `adWillShow` or `quiet` | One interruption per moment: an interstitial is queued for the way out, or the card already asks something ([Remind me], the chapter doubler) |
| 2 | the build does not know its version, or `ratePromptedVersion` equals it | Once per version. A build that cannot name its version cannot keep that promise, so it does not ask at all |
| 3 | `playDays < 2` | Never on the day of the install |
| 4 | a skip or a purchase this session | A player just let past a level, or who just paid, is not at a peak whatever the win says |
| 5 | `attempts ≥ 6` on the level | Six strokes is where the rescue ladder offers the skip: the win is a relief, not a peak |
| 6 | not `isPeak(win)` | A peak is a **medal on level 10 or later** (index ≥ 9), or the **first finish of today's Daily taking the streak to 3 or more**. An ordinary clear is not one, however many there have been |

The service adds the rest: `Capacitor.isNativePlatform()` (web never prompts),
`Nudges.promptPending` (a review requested under the notification permission alert is
never shown, yet the version would be spent), and the session — `Progress.onGrant`
marks a `'purchase'` or `'late-purchase'` (restores included), `Progress.skipsSinceLaunch`
counts skips, and a new session — heard from `SessionLifecycle.onSessionStart`, the rule
the ad cadence hears too (§8): 30 minutes away, or back on a new day — forgets both.
Until 2026-09-27 Rate kept a private copy of that rule, which measured an absence from
the LAST hide and had no midnight clause.

`APP_VERSION` is `import.meta.env.VITE_APP_VERSION`, which `vite.config.ts` defines from
the first `MARKETING_VERSION` in the Xcode project (read, never written; package.json's
`version` as a fallback). The Settings footer shows the same string. Because fastlane's
`build_ipa` writes the App Store version into the project only after the web build, the
first build of a new version still says the previous one unless the project is bumped
first — safe (a player asked on 1.4 is simply not asked again until the next build), but
bump `MARKETING_VERSION` when opening a version.

```ts
async ask(): Promise<void> {
  if (Nudges.promptPending) return;           // checked again, a beat after shouldAsk
  Progress.update({ ratePrompted: true, ratePromptedVersion: APP_VERSION });
  try { await InAppReview.requestReview(); } catch { /* a nicety; never an error */ }
}
```

- The version is spent **before** the await, so it is spent even if the OS silently
  suppresses the prompt: `SKStoreReview` gives no callback and Apple allows three
  prompts in 365 days, so "did it appear?" is unknowable and retrying would burn the
  quota.
- `ratePrompted` is still written, so a pre-1.4 build that meets this save treats the
  ask as spent for good. A pre-1.4 save with `ratePrompted: true` and no
  `ratePromptedVersion` reads as "spent on an older version": 1.4 may ask once.
- `ask()` does **not** re-check `shouldAsk()`. The only correct invocation is the
  guarded one.

Trigger timing (`GameScene.win`):

```text
win()
  readyIn = ms(winHoldMs 180) + ms(winSettleMs 350) + ms(250)  ≈ 780 ms
  quiet = the card drew [Remind me] or the doubler
  adWillShow = !quiet && Ads.wouldShowInterstitial(onboardingIndex, winsSinceAd)
  win = { levelIndex (null on a Daily), medal, todayDailyFirst, streakAfter, attempts }
  if (Rate.shouldAsk({ adWillShow, quiet, win }))
      delayedCall(readyIn + 400 ≈ 1180 ms) → still this win, phase 'won', not advancing,
                                            no share sheet → Rate.ask()
```

The delay puts the prompt after the figure has settled and the card is up — a delight
peak, never over the reward, never in the same beat as an ad.

**Verifying it.** Apple's `requestReview` has no effect in an app installed from
TestFlight, and always shows in a development build. So it is checked on the mock build
from Xcode or `SIM=<udid> npm run ios:run`, with a save that has `playDays ≥ 2`, then a
first-try medal on level 10 or later (or today's Daily taking the streak to 3), no skip
or purchase in the last 30 minutes, and no [Remind me] or doubler on that card.

---

# 6. The 1.4 economy: missions, bookmarks, repair, chapter marks

What makes every earned thing visible. The rules are pure functions in `src/core/`
(`Streak.ts`, `Missions.ts`, `Rewards.ts`), tested with the date passed in, under
`TZ=Europe/Belgrade`, DST included; Progress applies them to the save and pays through
the one grant path (§1.9). The amounts are `monetization.economy` (see
[10-monetization.md](10-monetization.md) §1 and §6 for the money side). Everything
here is hidden on the web Daily (`WEB_DAILY`).

## 6.1 The Daily lock

`Progress.dailyUnlocked()` is the one rule the Daily card, the missions, the reminder
plan and a reminder tap all ask: the Daily is open to a player who has any Daily
history, has cleared `l5` (the last tutorial fold), or has cleared any level past the
tutorial. The last clause is for a save migrated to schema 3, which forgot its `l1`–`l5`
clears but not the player, who may be on level 57. A brand-new player's first session
therefore shows none of the economy: a locked Daily card ("unlocks after the tutorial ·
3 folds to go"), no balance chip, no Store, no gift said — the grants still land,
silently (`DailyCard.firstSession`).

## 6.2 Streak, bookmarks, milestones, repair (`core/Streak.ts`)

```ts
streakFrom(done, marked, today): number        // from today if folded, else yesterday, over done ∪ marked; counts done only
longestFrom(done, marked): number
guardPlan(done, marked, today, bookmarks, minRun): { bridge: Day[] }
repairDays(…) / repairable(done, marked, today, lastRepair, bookmarks, cfg): Day | null
runBefore(done, marked, day): number
milestoneFor(streak, bookmarksHeld, cfg) / milestonesBetween(from, to, bookmarksHeld, cfg) / nextMilestone(…)
weekStrip(done, marked, today): WeekDot[]      // the last 7 days, oldest first
```

**A bookmarked day bridges the streak but does not add to it.** Done Saturday, done
Sunday, bookmarked Monday, done Tuesday is a streak of 3. `bookmarked` is kept apart
from `daily` on purpose: everything that reads the ledger — Game Center's week
achievement, the share text — sees only days actually folded.

**The guard** (`Progress.applyStreakGuard`, run by `load()`, every foreground and
`snapshotForWin`; idempotent). The gap G is the days strictly between the last kept day
and today. It spends bookmarks on them only when `1 ≤ G ≤ bookmarks` **and** the run
ending at the last kept day is at least `guardMinRun` (2) long; otherwise it spends
nothing and keeps the bookmarks. What it spent waits in `takeStreakGuard()` for the
menu: "A bookmark kept your 12-day streak · 1 left", with the bookmark flying into the
streak chip. A bookmark spent on yesterday by a Daily that was opened before midnight
and finished after it is refunded when the finish lands on that very day.

**Earning.** Paid on the Daily that moves the streak (the first finish of today's, or
yesterday's finished after midnight), together with any milestone that day:

| Streak day | Pays |
| --- | --- |
| 3 | +1 bookmark |
| 7 | +2 reveals and a bookmark — "A week of folds · +2 reveals and a bookmark" |
| 14 | +3 reveals and a bookmark — "Two weeks folded · +3 reveals and a bookmark" |
| 21, 28, 35 … | +1 bookmark |
| 30 | +5 reveals — "A month of folds · +5 reveals" |
| 50 | +5 reveals |
| 100 | +10 reveals |
| every 50 after 100 | +5 reveals |

A bookmark earned at the cap of two pays **+1 reveal instead** ("… · bookmarks full, +1
reveal instead"). A jump — a repair, a guard bridge that joins today's run, a late
finish — pays every milestone day in `(from, to]` exactly once, where `from` is the
larger of the streak alive today and the run that ended the day before the first added
day (`runBefore`), so a repair can never pay day 3 twice. A 1.3 save with any Daily
history starts 1.4 holding one bookmark.

**The repair** — the rescue for a streak broken by a single day. `repairableDay(today)`
names a day when exactly one day was missed (`maxGapDays` 1), no bookmark is held to
cover it, the run before it was at least 2 days, and 14 days have passed since the last
repair. The Streak sheet then offers "Watch an ad → keep your 12-day streak" (rewarded
placement `'repair'`) or, with no ad to play or for a Remove Ads owner, "Keep your
12-day streak" for free; `'unavailable'` still keeps it. `repairStreak(today)` adds the
day to `bookmarked`, stamps `lastRepair`, emits one `'repair'` event carrying whatever
milestones the repair reached (`repairPays` previews them), and the sheet counts the
flame up. While today is still unfolded the sheet leads with a primary **Play today's
fold** above the repair, so the Daily is never behind it.

**The Streak sheet** (`render/StreakSheet.ts`, from the streak chip or a repairable
Daily card): "{n}-day streak" / "{run}-day streak · missed a day" / "Start a new streak"
/ "No streak yet", "best {L} days", the week strip (done, bookmarked, missed, today),
"Bookmarks {b} of 2 · each covers a missed day", the next milestone with a thin bar
("Day 14 · +3 reveals and a bookmark", 12/14), the repair row when there is one, and
"Remind me each day" while notification permission is undecided. Nothing ever says
"you lost".

**The Daily card** (`render/DailyCard.ts`, pure `dailyCardState`) has six faces:
locked, fresh ("one maze, everyone, today"), at risk ("day 13 · keeps your 12-day
streak"; after 18:00 with a streak of 3 or more and no bookmark, "your 12-day streak ends
at midnight" on a filled accent face), done ("solved in 0:48 · next fold at midnight"),
broken ("best streak 12 · start a new one") and repairable ("12-day streak missed a day ·
keep it?"). Done wins over repairable: a player who folded today sees it done, and
reaches the repair from the streak chip. No countdowns anywhere.

## 6.3 Daily missions (`core/Missions.ts`)

Three a day, dealt deterministically from the date (`missionsFor(date, ctx)`), slot one
always the Daily:

| Id | Slot | Copy | Target | Counts |
| --- | --- | --- | --- | --- |
| `daily` | 1 | Fold today's Daily | 1 | the first finish of **today's** Daily |
| `wins3` | 2 | Clear 3 folds | 3 | any campaign win, replays included |
| `new2` | 2 | Clear 2 new folds | 2 | first clears; dealt only with ≥ 2 levels uncleared |
| `clean` | 3 | Clear a fold without crashing | 1 | a campaign win with no death on it |
| `medal` | 3 | Earn a medal on any fold | 1 | a campaign win within 1.25× par |
| `best` | 3 | Beat one of your best times | 1 | a win faster than the best time read **before** `recordWin`; dealt only with ≥ 3 clears |

- A Daily win never advances slots 2 and 3; a skip advances nothing.
- Each pays **+1 reveal on completion**, automatically (reason `'mission'`) — no claim
  tap. Owners see a ✓.
- Open from `unlockedIndex ≥ 5` with the Daily unlocked; the win that opens them does not
  count toward them. `missionsToday(now)` is null until then, which hides the strip.
- The record rolls over at local midnight. One built after today's Daily was already
  folded (the day 1.4 is installed, or the day missions open) starts with slot one done,
  and pays it in the same update — the sheet says "done · +1 reveal", and that has to be
  true.

The menu strip sits under the top bar as one tap target; all three done reads "all
three done · new missions at midnight" with a gold check. The Missions sheet ("Today's
three") routes an unfinished row: the Daily to today's Daily, `wins3` / `new2` / `clean`
to Continue, `medal` / `best` to Levels at the frontier.

## 6.4 Chapter marks (`core/Rewards.ts`)

Fifteen chapters of `CHAPTER_SIZE` = 20 (`chapterOf(0..19) = 0`, `chapterOf(299) = 14`).
Each has two marks, `"c:10"` and `"c:20"`, paid once: **+1 reveal at 10 cleared, +2 at
20** — 3 a chapter, 45 across the game. Cleared means cleared: a skipped level counts
toward neither, which is the reason to go back to it. `settleWin` pays the won level's
chapter; `MenuScene.create` calls `settleChapterMarks('backlog')` once, which paid every
1.3 player for the chapters they had already finished ("4 chapters already folded · +12
reveals"). The Levels screen heads each chapter with its tally and the next unpaid mark
("Chapter 3 · 41–60 · 14/20 · ❖ 5", "+1 at 10" then "+2 at 20", a gold check at twenty
medals; no marker for owners), and the win card draws the chapter as a 20-cell bar.

## 6.5 The win: one snapshot, one settle

```ts
const before = Progress.snapshotForWin(level.id, levelIndex);   // runs the guard, reads what was "new"
// recordWin / addMedal / Fold Sense / recordDaily — as before
const outcome = Progress.settleWin(before, facts);              // missions, marks, streak — ONE update
```

`WinOutcome` = `{ reveals, bookmarks, lines, chapter, streak, missions }`: what the win
paid, the card's reward lines ("Halfway through chapter 3 · +1 reveal", "Chapter 3
complete · +2 reveals", "Mission done · +1 reveal", milestone lines), the chapter's
cells and the marks it crossed (null on a Daily), and the streak before and after
(set on any Daily that moved it). Settling the same `WinBefore` twice pays nothing. An
owner's reveals still accrue behind the ∞, and the lines say ✓. The web Daily does not
settle.

The card itself, and the timeline it runs on, are GameScene's — see
[06-scenes.md](06-scenes.md) §6.6.

## 6.6 One-time lessons

`taught` holds `'mirror'` and `'reveal'`, and `teach()` is true only the first time. The
first death on the reflection says "your reflection hit that wall", flashes that wall
twice and leaves the reflected stroke at ghost strength; the first visit to level 6
before it is cleared pulses the Reveal pill three times inside an accent ring — and is
recorded only once the pulse has actually played.

---

# 7. Nudges: local reminders

`src/systems/Nudges.ts` (the service) and `src/systems/NudgePlan.ts` (the plan, pure),
over `@capacitor/local-notifications`. **Local notifications only**: no remote push,
no APNs, no `aps-environment`. Everything a reminder needs is already on the phone.

## 7.1 The plan

`planNudges(state)` turns a snapshot of the player into at most eight notifications.
**T**, the reminder time, is the median of the last seven first-foreground minutes
(`sessionMinutes`) minus 30, kept between 09:00 and 20:30 and on a quarter hour; 19:00
when there is no history. **S** is the day of the latest session.

| Id | Slot | When | Only if | Thread |
| --- | --- | --- | --- | --- |
| 8101 | ready-today | S at T | today unfolded, T still ahead | `foldwing.daily` |
| 8102 | saver-today | S at 21:30 | unfolded, streak ≥ 3, T ≤ 20:30 | `foldwing.daily` |
| 8103 | ready+1 | S+1 at T | always | `foldwing.daily` |
| 8104 | saver+1 | S+1 at 21:30 | today folded, streak ≥ 3 | `foldwing.daily` |
| 8105 | lapse-2 | S+2 at T | — | `foldwing.winback` |
| 8106 | lapse-4 | S+4 at T | — | `foldwing.winback` |
| 8107 | lapse-8 | S+8 at T | — | `foldwing.winback` |
| 8108 | lapse-15 | S+15 at T | — | `foldwing.winback` |
| 8109 | lapse-30 | S+30 at T | — | `foldwing.winback` |

8101 and 8102 need today unfolded and 8104 needs it folded, so at most eight are ever
pending. Nothing lands before 08:30 or after 21:30, nothing within a minute of now, and
nothing at all while the Daily is locked (§6.1) — every line is about the Daily. After
S+30 the phone stays silent until the player comes back. A player who keeps opening the
game only ever sees the first slot or two; the tail is for the one who stopped.

Every notification carries `extra: { route: 'daily', kind, forDay, template }` and
`actionTypeId: 'FOLD'` (registered once a session, with "Daily fold" as the hidden-preview
placeholder), `interruptionLevel: 'active'`, no sound and no badge.
`capacitor.config.ts` sets `LocalNotifications.presentationOptions: []`, so a reminder
that arrives while the game is open shows no banner — it would land over a level, often
over the very Daily it is about.

**Copy.** Titles ≤ 45 characters and bodies ≤ 80, tested at a 365-day streak and the
longest level name. The daily thread rotates by date alone, so two plans built hours
apart agree about a day and no template runs two days in a row; the win-back lines step
around both neighbours. A streak is named only where it is true that day, and a player
holding a bookmark never reads "ends at midnight" (the game would disprove it the next
day). Owners never hear about reveals. No sales copy (guideline 4.5.4), no guilt, no
hour in a title that lands at T, and the mode is "the Daily fold".

## 7.2 Writing it: `rebuild()` never prompts

```ts
Nudges.rebuild(now?: Date): Promise<number>   // how many are pending
Nudges.request(): Promise<boolean>            // the ONLY path to the system alert
Nudges.permission(): Promise<'granted' | 'denied' | 'prompt'>
Nudges.clear(): Promise<void>                 // cancels 8100–9099
Nudges.clearDelivered(): Promise<void>
Nudges.installTapListener(onTap?): void
Nudges.takeRoute(now?): 'daily' | null
Nudges.takePendingRoute(registry, now?): 'daily' | null
Nudges.shouldSoftAsk(save, today, permission): boolean
```

**Plugin trap:** the local-notifications plugin's `schedule()` shows the permission
prompt by itself. So `rebuild()` asks `checkPermissions()` first and, unless it is
`'granted'` and the Reminders switch is on, schedules nothing; with the switch off it
clears. It does nothing before the save is read. Otherwise it cancels the whole
8100–9099 range (which also clears the 1.3 fourteen-evening horizon) and schedules the
plan. Runs are serialised and coalesced — asks made during a run join one more run — and
a run from the same inputs inside a second makes no plugin call at all.

It runs at boot (after `warm()`, with `clearDelivered()`), on every foreground, on a
first Daily finish, on the win that first opens the Daily, when the Settings switch
changes, when a soft ask is accepted, and — through a module-scope `onGrant` listener in
main.ts — when Remove Ads is bought or restored, after a repair, and when a bookmark is
earned.

## 7.3 A tap opens today's Daily

The action listener is installed at module scope in main.ts, before `new Phaser.Game`;
the plugin retains the event, so a tap that cold-launched the app is still delivered
(verified on the iOS 27 simulator; the native SceneDelegate fallback was not needed). A
tap calls `skipIntro()` — a reminder never sits through the film. After the entitlement
is known, `BootScene` reads `takeRoute()`: `routeForTap` says `'daily'` when today's
Daily is not folded, `unlockedIndex ≥ 5` and the Daily is unlocked, and Boot starts
`Game { daily: today }`; otherwise the Menu. A tap while the app is already running sets
the registry flag `PENDING_ROUTE`, and at the end of the next step main.ts restarts an
idle Menu (no sheet up, no ad busy), whose `create()` takes the route; with a sheet up
the route waits for it to close, and from inside a level it waits for the next Menu.
Nothing is set when the active Game is already on today's Daily. main.ts never starts the Game itself — that raced the rollover restart
into a Menu and a Daily both running.

The opening film is the portfolio's shared Noqyris sting (`@noqyris/splash`, aliased from
`repository/shared/noqyris-splash`, never copied; `Intro.ts` is a thin adapter). Since
2026-09-27 it plays on every cold launch on a phone, like the other apps — the owner's call —
and never in a browser or after a reminder tap. Reduced motion does not skip it, as in the other apps.

## 7.4 Asking for permission

The system alert only ever follows the player's own tap on [Remind me].

- **Soft asks, on the win card** — at most three in total, at least seven days apart,
  never once the permission is decided, never with the switch off, never on the web
  Daily (`shouldSoftAsk`, `nudgeAsks` / `nudgeAskedOn`): the first Daily ever finished
  and the Daily that takes the streak to three ("Tomorrow's fold lands at midnight."
  [Remind me]), and the chapter-1-complete card for a player never asked ("Want a nudge
  when the Daily fold is ready?"). A card with an ask draws no doubler and no
  interstitial follows it.
- **Always there:** "Remind me each day" in the Streak sheet while undecided, and the
  Settings **Reminders** row ("Daily fold · around 7 pm", or "off in iOS Settings" when
  denied; switching it on when denied says "Allow notifications for Foldwing in iOS
  Settings").
- After the answer: "Reminders on · around 7 pm" or "No reminders · change it in
  Settings anytime".

No reward is ever tied to allowing notifications (guideline 5.1.2(i)), and the review
prompt stands down while the alert is up (§5).

---

# 8. Sessions: what counts as one

A **session** is a cold launch, **or** a return from the background after **30 minutes
or more**, **or** a return into a **new local day** (mobile-game-playbook,
`references/monetization.md` → "What counts as a session — not just a cold launch").
iOS keeps a suspended WKWebView alive for days, so counting cold launches alone leaves a
player who never swipes the app away in one endless session: every per-session cap stays
spent. Reference implementation: KVIZKO `e9b972d`.

**Before (audited 2026-09-27).** Nothing counted sessions. Two private copies of "a new
session" existed, neither with the midnight clause: `SessionClock.show()` inside `Ads`
(30 min from the first hide) and `Rate.watchForNewSession` (30 min from the LAST hide —
a second hide moved the stamp). Both are gone; nothing else in the app decides it.

**The rule** — `src/core/Session.ts`, pure, no clock, no DOM:

| Function | Rule |
| --- | --- |
| `isNewSessionOnReturn({ hiddenAtMs, hiddenDay, nowMs, today })` | a different day key → always `true` (the midnight clause, however short the pause); else `nowMs − hiddenAtMs ≥ SESSION_GAP_MS` (30 min). A clock set back within the day is negative elapsed → not a pause; a non-number stamp → not a pause |
| `onHidden(prev, nowMs, day)` | keeps the **first** hide of a pause — a second hide without a return does not move it |
| `onVisible(prev, nowMs, today)` | a visible with no hide before it is not a pause; always clears the stamp |

The day key is `core/CalendarDay.todayISO` — the one the streak and the Daily use.

**The service** — `src/systems/SessionLifecycle.ts`, driven from `main.ts`:

- `startColdSession()` at module load in `main.ts` (a page hidden at boot is stamped as a
  hide at once); `noteHidden()` / `noteVisible()` from `main.ts`'s `visibilitychange`
  handler, **before** `Ads.foregrounded()` and the day's top-up.
- The count persists under its own Preferences key, `foldwing.sessions` (not in the save):
  the stored count plus this process's sessions, written on the cold start and on every
  renewing return. Nothing reads it yet.
- `onSessionStart((reason, n) => …)` — `'cold'` or `'return'`, synchronous inside the
  `visibilitychange` that decided it, so a per-session limit is reset before anything else
  on that return reads it. `renewedSinceLaunch()` says the launch's first session is over.
  No Foldwing rule is keyed to the first session (the Menu's `firstSession` is "the
  tutorial is not done", a progress rule), so it has no reader yet.

**On a new session**, exactly two listeners reset exactly what is per session:

| Listener | Resets | Leaves alone, on purpose |
| --- | --- | --- |
| `Ads.newSession()` | `interstitialsThisSession` (the cap of 8) and the session's foreground age (`SessionClock.start`, so the 180 s warm-up re-arms) | `lastInterstitialAt` (the 180/120 s floor — what keeps an ad off a return), `mutedUntil` (300 s after a rewarded view), `winsSinceAd` / `attemptsSinceAd` (in the save), the daily rewarded cap |
| `Rate` | `purchased`, `skipsBefore` ("not in a session with a skip or a purchase"), on a `'return'` only — the cold launch is the session Rate was born into, and its announcement erases nothing already heard in it | once per version, `playDays` |

A new session is **not** a new day: the daily reveal top-up, the streak guard, the
missions, `markSeen` and the reminders still go by the calendar, once a day. And neither
listener writes the save: `systems/SessionScope.test.ts` loads the real `Progress`, `Ads`
and `Rate` with the lifecycle, drives a 31-minute return and a 5-minute return across
midnight, and requires the save to come out unchanged — the daily rewarded cap
(`rewardedToday` / `rewardedDay`) and `winsSinceAd` / `attemptsSinceAd` by name. After
midnight the cap is fresh because `adRevealsLeft` reads yesterday's stamp, not because
anything reset it. The same file scans `src/` for `onSessionStart(` callers, so a new
listener anywhere has to be loaded there too.

`GameCenter.signIn` stays once per **process**, not per session: GameKit re-presents its
own authentication handler on foreground.

**The ATT trap and the one starter gate.** WKWebView fires `visibilitychange` on
willEnterForeground, while the app is still INACTIVE (`didBecomeActive` ~300 ms later);
a timer that came due in the background — the splash's 7 s cap, `main.ts`'s 9 s backstop —
fires in that same window. ATT asked then shows nothing and answers `notDetermined`, the
consent modal still appears, and LevelPlay starts with a zeroed IDFA.
`whenAdLayerMayStart()` waits for the film to be gone (`@noqyris/splash` `whenIntroDone`)
and **then** for the app to be active (`whenAppActive`: `@capacitor/app`
`getState().isActive`, else a one-shot `appStateChange` with `isActive === true`, with
`getState()` read again after the listener is registered; off-device it resolves at once).
Every route into the ad layer waits for it inside `Ads`, so no caller can skip it:
`Ads.init()` (before the consent-flow ceiling is armed), `Ads.foregrounded()` (the retry
that can re-ask ATT via `levelplay.retryInit → reaskConsent`) and
`Ads.openPrivacyOptions()`. The provider's own timed `initialize()` retries and its
consent watcher only ever run after a gated `init()`, with consent already GRANTED, and
ask nothing. Foldwing has no welcome sheet, Test Suite entry or ad-id capture build.

`@capacitor/app` (`^8.1.1`) is a new native dependency: the next `cap sync ios` +
`npm run ios:pods` (every release chain runs both) links `CapacitorApp`. A binary built
without it answers `getState()` with "not implemented", and the gate goes on rather than
hang.

**Tests** delete each rule in turn and fail (39 mutations, all killed, 2026-09-27 — the midnight clause, first hide, the 30-min edge both ways, the counter and its persistence, the per-session resets and the resets that must NOT happen, the end of the first session, every ACTIVE and film wait, the re-check, every gated route and the `main.ts` wiring):
`core/Session.test.ts` (midnight, first hide, the 30-min edge, clock set back, visible
without hide), `systems/SessionLifecycle.test.ts` (the count and its persistence, the
first-session lift, listeners, every ACTIVE wait, the re-check, film-then-active, and the
`main.ts` wiring), `systems/Ads.test.ts` (cap and warm-up reset on a 30-min and on a
midnight return; mute and floor kept; every route held by a shut gate),
`systems/adsLevelplay.test.ts` (end to end: no ATT request while inactive, at launch and
on a return), `systems/Rate.test.ts` (skip and purchase forgotten on a new session and a
new day, measured from the first hide, and kept through the cold announce),
`systems/SessionScope.test.ts` (no listener — in `Rate`, in `Ads`, in a module that
starts listening later — may reset the daily rewarded cap or the every-Nth counters).

---

# 9. Dead code, gaps, and things a test does NOT pin

**Every module on this page has a spec now.** `Progress.test.ts` (hostile saves,
both migrations, every 1.4 field, the grant path, the win settle, the guard and the
repair, missions, marks, the cap, play days), `Streak`, `Missions`, `Rewards`,
`Rate`, `Audio`, `Haptics`, `Share`, `NudgePlan` and `Nudges` each have their own, and
`monetization.test.ts` pins the economy's sums as well as the ad cadence. What is still
free-floating is the individual numbers where no sum reaches them —
`reveals.durationMs`, `startingStash`, `RATE_RULES.medalFromIndex`: change one and
nothing goes red. See [12-testing.md](12-testing.md).

Unreferenced (verified by grep across `src/` and `scripts/`):

| Symbol | Note |
| --- | --- |
| `Audio.isEnabled` | `setEnabled` has callers since the settings sheet; the getter has none |
| `Progress.reset` | marked "Dev only" |

Sharp edges worth knowing before editing:

1. `coerce` accepts any `bestMs` object without validating its values
   (`Progress.ts:124`) — a string value would flow into whatever formats best
   times.
2. `coerce`'s figure filter never checks `times.length === points.length`
   (`Progress.ts:113-118`). Safe today only because `src/core/Ribbon.ts:62` and
   `src/core/StrokeRecorder.ts:100-105` use `times[i] ?? 0`; any consumer that indexes
   `times` without a fallback would produce `NaN` geometry.
3. `Progress.figures` allocates a reversed copy per call (`:207`).
4. *(Gone with `Audio.chime()` in 1.4.)* It scheduled three `window.setTimeout`
   callbacks that were not cancelled on scene shutdown. Its replacements schedule
   on the audio clock.
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
