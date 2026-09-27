/**
 * NudgePlan — which reminders to leave on the phone, and what they say.
 *
 * Pure: a snapshot of the player in, a list of notifications out. No plugin,
 * no clock of its own, no save. Nudges.ts reads the save, calls this and hands
 * the result to the plugin; everything that can be wrong about a reminder —
 * the hour, the day, the wording, the count — is decided here, where a unit
 * test can see it.
 *
 * A SCHEDULE, REBUILT, NOT A HORIZON. The old code wrote fourteen identical
 * evenings after a Daily win and went quiet. This writes at most one reminder
 * a day from the latest session (S), a streak saver on the evening it matters,
 * and a short win-back tail at S+2, 4, 8, 15 and 30 — after which it stops
 * until the player comes back. Every foreground rebuilds it, so a player who
 * keeps opening the game only ever sees the first one or two slots, and the
 * tail exists for the player who stopped.
 *
 * THE HOUR IS THEIRS. T is half an hour before the minute they usually open
 * the game (the median of the last seven first-opens), kept between 09:00 and
 * 20:30 and on a quarter hour. Nothing lands before 08:30 or after 21:30.
 *
 * TRUE SENTENCES ONLY. A saver that says the streak "ends at midnight" to a
 * player holding a bookmark is a lie the game then disproves the next day, so
 * bookmark holders get their own wording. Remove Ads owners never hear about
 * reveals — theirs are unlimited. No sales copy (guideline 4.5.4), no guilt.
 */
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { daysBetween, shiftISO, todayISO } from '../core/CalendarDay';

/** Everything the plan needs to know about the player, read once. */
export interface NudgeState {
  now: Date;
  /**
   * The Daily is open to this player (Progress.dailyUnlocked). While it is
   * locked nothing is planned: every line is about the Daily, and a tap would
   * find it shut.
   */
  dailyOpen: boolean;
  /** Today's Daily is folded. */
  doneToday: boolean;
  /** Progress.dailyStreak(today): through today if done, else through yesterday. */
  streak: number;
  longest: number;
  bookmarks: number;
  /** The latest Daily's time; only read when today's is done ("yesterday took"). */
  lastDailyMs: number | null;
  /** First-foreground minute of each of the last few days (0..1439). */
  sessionMinutes: readonly number[];
  adsRemoved: boolean;
  /** Figures in the gallery. */
  figures: number;
  /** The frontier's chapter, 0-based, and the folds it still lacks. */
  chapter: { index: number; left: number } | null;
  /** The level Continue would open, 0-based; null before the first win or after the last. */
  resume: { index: number; name: string } | null;
}

export type NudgeKind =
  | 'ready-today'
  | 'saver-today'
  | 'ready+1'
  | 'saver+1'
  | 'lapse-2'
  | 'lapse-4'
  | 'lapse-8'
  | 'lapse-15'
  | 'lapse-30';

/**
 * One fixed id per slot. A rebuild cancels the whole range and writes these
 * again, so a slot is replaced rather than stacked however often it runs.
 */
export const NUDGE_IDS: Readonly<Record<NudgeKind, number>> = {
  'ready-today': 8101,
  'saver-today': 8102,
  'ready+1': 8103,
  'saver+1': 8104,
  'lapse-2': 8105,
  'lapse-4': 8106,
  'lapse-8': 8107,
  'lapse-15': 8108,
  'lapse-30': 8109,
};

/**
 * Every id this game has ever used for a reminder. 1.3 wrote 8100 + day%1000
 * for a fortnight ahead, so the range stays whole: cancelling it is what clears
 * the old set on the first 1.4 launch.
 */
export const NUDGE_ID_FIRST = 8100;
export const NUDGE_ID_LAST = 9099;

/** The reminder hour when nothing is known yet: 19:00. */
export const DEFAULT_MINUTE = 19 * 60;
/** T's clamp, 09:00..20:30 — both on the quarter hour, so rounding stays inside. */
export const EARLIEST_MINUTE = 9 * 60;
export const LATEST_MINUTE = 20 * 60 + 30;
/** The saver's minute, 21:30: late enough to be the last word, before bedtime. */
export const SAVER_MINUTE = 21 * 60 + 30;
/** Quiet hours: nothing before 08:30 or after 21:30, whatever the maths says. */
export const QUIET_UNTIL = 8 * 60 + 30;
export const QUIET_FROM = 21 * 60 + 30;
/**
 * A reminder due sooner than this is dropped. The plugin fires a past `at`
 * immediately, so a slot computed a moment too late would arrive the instant
 * the player backgrounds the app.
 */
export const LEAD_MS = 60_000;
/** The streak at which the streak gets named, and the saver starts. */
export const STREAK_COPY_AT = 3;
/**
 * The campaign index from which a tap may open the Daily: the tutorial is five
 * folds, and a player still inside it is not sent to a maze it has not taught.
 */
export const DAILY_ROUTE_MIN_INDEX = 5;

/** Slot → day offset from S, minute of day, thread and relevance. */
const SLOTS: readonly {
  kind: NudgeKind;
  offset: number;
  saver: boolean;
  thread: 'foldwing.daily' | 'foldwing.winback';
  relevance: number;
}[] = [
  { kind: 'ready-today', offset: 0, saver: false, thread: 'foldwing.daily', relevance: 0.8 },
  { kind: 'saver-today', offset: 0, saver: true, thread: 'foldwing.daily', relevance: 1 },
  { kind: 'ready+1', offset: 1, saver: false, thread: 'foldwing.daily', relevance: 0.8 },
  { kind: 'saver+1', offset: 1, saver: true, thread: 'foldwing.daily', relevance: 1 },
  { kind: 'lapse-2', offset: 2, saver: false, thread: 'foldwing.winback', relevance: 0.4 },
  { kind: 'lapse-4', offset: 4, saver: false, thread: 'foldwing.winback', relevance: 0.4 },
  { kind: 'lapse-8', offset: 8, saver: false, thread: 'foldwing.winback', relevance: 0.4 },
  { kind: 'lapse-15', offset: 15, saver: false, thread: 'foldwing.winback', relevance: 0.4 },
  { kind: 'lapse-30', offset: 30, saver: false, thread: 'foldwing.winback', relevance: 0.4 },
];

/**
 * When to remind: the median first-open minute, less half an hour, clamped to
 * 09:00..20:30 and rounded to 15. Half an hour early so the reminder is the
 * thing that starts the session rather than an echo of one already begun.
 * Anything that is not a minute of the day is ignored; nothing left is 19:00.
 */
export function reminderMinute(sessionMinutes: readonly number[]): number {
  const m = sessionMinutes
    .filter((v) => Number.isInteger(v) && v >= 0 && v < 1440)
    .slice()
    .sort((a, b) => a - b);
  if (m.length === 0) return DEFAULT_MINUTE;
  const mid = m.length >> 1;
  const median = m.length % 2 ? m[mid] : (m[mid - 1] + m[mid]) / 2;
  const clamped = Math.min(LATEST_MINUTE, Math.max(EARLIEST_MINUTE, median - 30));
  return Math.round(clamped / 15) * 15;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * A minute of the day as the surfaces say it: "7 pm", "7:30 pm", "9:15 am",
 * "12 pm". For "Reminders on · around 7 pm" and the Settings row; the copy is
 * English throughout, so the clock is too.
 */
export function timeLabel(minute: number): string {
  const m = mod(Math.round(Number.isFinite(minute) ? minute : DEFAULT_MINUTE), 1440);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

/* ------------------------------------------------------------------ copy */

export interface Line {
  /** Stable name of the template, for the no-repeat rule and the tests. */
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

/**
 * The plain lines, for a player with no streak worth naming. Nine, rotating by
 * day: a reminder that says the same sentence every evening stops being read
 * within a week and gets the app's notifications switched off.
 *
 * The fold changes at each player's own midnight (core/CalendarDay: local
 * wins), so a date's maze is everyone's, but not everyone is on the same date
 * at once. "Everyone at once" would promise a simultaneity the game does not
 * have.
 *
 * They land at T, anywhere from 09:00 to 20:30, so no title names an hour: "A
 * new fold at your midnight" arrived at 19:15. The mode is "the Daily fold".
 */
export const LINES: readonly { title: string; body: string }[] = [
  { title: 'Your Daily fold is ready', body: 'Everyone gets the same maze on the same day. Yours is waiting.' },
  { title: 'A maze you haven’t met yet', body: 'One maze a day, the same for the whole world.' },
  { title: 'Today’s fold is waiting', body: 'One line, two answers. See how close you get.' },
  { title: 'The mirror has a new maze', body: 'Draw one line and let the other half survive it.' },
  { title: 'Your fold is folded', body: 'Today’s maze is up. The clock starts when you do.' },
  { title: 'One maze, one line', body: 'The Daily fold resets at midnight. Yours is ready now.' },
  { title: 'Somebody has already beaten today', body: 'See what the fold looks like from your hand.' },
  { title: 'A fresh fold', body: 'The obstacles moved. The mirror did not.' },
  { title: 'Today’s fold is unplayed', body: 'It takes a minute, and it is different tomorrow.' },
];

/** Days since the epoch, in LOCAL time — the day the player is living in. */
export function localDayNumber(d: Date): number {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
}

/** Same plain line for the same day, and never the same on two days running. */
export function lineFor(dayNumber: number): { title: string; body: string } {
  return LINES[mod(dayNumber, LINES.length)];
}

const plainLines: readonly Line[] = LINES.map((l, i) => ({ key: `line.${i}`, ...l }));

/** 48000 → "0:48". Whole seconds, as the share text rounds them. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The ready pool when the streak is worth naming: `n` is the run the day continues. */
function streakLines(n: number): Line[] {
  return [
    { key: 'ready.day', title: `Day ${n + 1} is waiting`, body: `Today’s fold keeps your ${n}-day streak going.` },
    { key: 'ready.counting', title: `${n} days and counting`, body: 'Today’s maze is up. One line keeps the run alive.' },
    { key: 'ready.meets', title: 'Your streak meets a new maze', body: 'Same maze for everyone today. Yours is waiting.' },
  ];
}

function saverLines(n: number, bookmarks: number): Line[] {
  // With a bookmark in hand the streak does NOT end at midnight — the guard
  // spends it — so those players are told to save it instead.
  if (bookmarks > 0) {
    return [
      { key: 'saver.keep', title: `Keep your ${n}-day streak going`, body: 'Today’s fold is unplayed. Save your bookmark for a day you can’t.' },
      { key: 'saver.reserve', title: 'Today’s fold is still open', body: 'Play it and your bookmark stays in reserve.' },
    ];
  }
  return [
    { key: 'saver.ends', title: `Your ${n}-day streak ends at midnight`, body: 'Today’s fold is still unplayed. It takes about a minute.' },
    { key: 'saver.left', title: 'One fold left today', body: `Your ${n}-day streak needs today’s maze before midnight.` },
    { key: 'saver.going', title: `${n} days. Keep it going?`, body: 'Today’s fold is still open. One line keeps your streak.' },
  ];
}

/**
 * The run a ready slot on day S+offset continues, before that day's fold.
 *
 * Today, and tomorrow when today is folded, it is simply the streak. Tomorrow
 * with today unfolded it survives only if a bookmark can bridge today, which
 * the guard does for a run of two or more (Streak.guardPlan); otherwise the
 * streak is gone by then and must not be named.
 */
function runFor(s: NudgeState, offset: number): number {
  if (offset === 0 || s.doneToday) return s.streak;
  return s.bookmarks > 0 && s.streak >= 2 ? s.streak : 0;
}

/**
 * The turn "yesterday took 0:48" takes in tomorrow's rotation — it replaces
 * that line rather than joining the pool. A pool that grew would rotate on a
 * different length from the one this morning's plan used, and the rebuild
 * after tonight's fold could land tomorrow on the template today already said.
 */
const FASTER_TURN = 0;

/**
 * Every line a slot could say for this player, in rotation order. Exported for
 * the tests, which hold every template to the length limits and the rules.
 */
export function copyPool(kind: NudgeKind, s: NudgeState): Line[] {
  switch (kind) {
    case 'ready-today':
    case 'ready+1': {
      const n = runFor(s, kind === 'ready-today' ? 0 : 1);
      const lines = n >= STREAK_COPY_AT ? streakLines(n) : [...plainLines];
      // Tomorrow's, after today's fold: last time's clock is a reason to come
      // back that nothing else in the pool offers.
      if (kind === 'ready+1' && s.doneToday && s.streak >= 2 && s.lastDailyMs !== null && s.lastDailyMs > 0) {
        lines[FASTER_TURN] = {
          key: 'ready.faster',
          title: `A new maze for day ${s.streak + 1}`,
          body: `Yesterday took ${clock(s.lastDailyMs)}. See if today folds faster.`,
        };
      }
      return lines;
    }
    case 'saver-today':
    case 'saver+1':
      return saverLines(s.streak, s.bookmarks);
    case 'lapse-2':
      return [
        s.longest >= STREAK_COPY_AT
          ? { key: 'lapse2.best', title: 'A fresh fold', body: `Your best run is ${s.longest} days. Today could start the next one.` }
          : { key: 'lapse2.two', title: 'Two new mazes', body: 'Two Daily folds since you last drew a line.' },
        { key: 'lapse2.ready', title: 'Today’s fold is ready', body: 'One maze, the same for everyone. Yours is waiting.' },
      ];
    case 'lapse-4': {
      if (!s.adsRemoved) {
        return [
          { key: 'lapse4.reveal', title: 'A free reveal is waiting', body: 'One lands on every day you open Foldwing.' },
          { key: 'lapse4.daily', title: 'Your daily reveal is ready', body: 'Open Foldwing and it’s yours. Today’s fold is waiting too.' },
        ];
      }
      // Owners have unlimited reveals: a reveal is no reason for them to come.
      const c = s.chapter;
      if (c && c.left > 0 && c.left < 10) {
        return [
          {
            key: 'lapse4.chapter',
            title: `Chapter ${c.index + 1} is ${plural(c.left, 'fold', 'folds')} from done`,
            body: 'Pick up where you left off.',
          },
        ];
      }
      return [{ key: 'lapse4.new', title: 'New folds are waiting', body: 'Four daily mazes since your last visit.' }];
    }
    case 'lapse-8': {
      const lines: Line[] = [
        { key: 'lapse8.week', title: 'A week of new folds', body: 'Seven daily mazes since your last visit. Today’s is ready.' },
      ];
      if (s.resume) {
        lines.push({
          key: 'lapse8.resume',
          title: 'Your line is waiting',
          body: `Level ${s.resume.index + 1}, ${s.resume.name}, is right where you left it.`,
        });
      }
      return lines;
    }
    case 'lapse-15':
      return [
        s.figures > 0
          ? { key: 'lapse15.gallery', title: `Your gallery has ${plural(s.figures, 'figure', 'figures')}`, body: 'The next one is a single line away.' }
          : { key: 'lapse15.weeks', title: 'Two weeks of mazes', body: 'Fifteen Daily folds since you last played.' },
      ];
    case 'lapse-30':
      return [{ key: 'lapse30.last', title: 'Last reminder for now', body: 'The Daily fold keeps coming whenever you want it.' }];
  }
}

/** Epoch day number of an ISO date — the rotation's clock, free of DST. */
const dayNumberOf = (iso: string): number => daysBetween('1970-01-01', iso);

/** A pool's line for a day, by rotation alone. */
const turn = (lines: readonly Line[], day: number): Line => lines[mod(day, lines.length)];

/**
 * Pick by day number, stepping past the neighbours' lines.
 *
 * Rotation alone keeps one pool from repeating on consecutive days. Pools meet
 * too — "A fresh fold" is both a plain line and a lapse-2 title — so a pick
 * that matches a neighbour's key or title moves on to the next one.
 */
function pick(lines: readonly Line[], day: number, neighbours: readonly Line[]): Line {
  const clash = (l: Line): boolean => neighbours.some((y) => y.key === l.key || y.title === l.title);
  const start = mod(day, lines.length);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[(start + i) % lines.length];
    if (!clash(l)) return l;
  }
  return lines[start];
}

/**
 * What a ready slot on `day` opens with, in either pool, whichever plan writes
 * it. Only the numbers in a streak title depend on the player, and no win-back
 * title has that shape, so any run will do for the comparison.
 */
const readyTurns = (day: number): Line[] => [turn(plainLines, day), turn(streakLines(STREAK_COPY_AT), day)];

/** Local wall-clock `minute` on the ISO date `iso`; DST is the Date constructor's. */
function at(iso: string, minute: number): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minute / 60), minute % 60);
}

/** Which slots apply, before copy and before the clock drops the past ones. */
function wanted(kind: NudgeKind, s: NudgeState, t: number): boolean {
  switch (kind) {
    case 'ready-today':
      return !s.doneToday;
    case 'saver-today':
      return !s.doneToday && s.streak >= STREAK_COPY_AT && t <= LATEST_MINUTE;
    case 'saver+1':
      return s.doneToday && s.streak >= STREAK_COPY_AT;
    default:
      return true;
  }
}

/**
 * The reminders to leave on the phone: at most 8 (8101 and 8102 need today
 * unfolded, 8104 needs it folded), ids 8101..8109, nothing inside a minute from
 * now, nothing in quiet hours. Each carries `extra.route = 'daily'`, so a tap
 * opens today's fold (routeForTap). None while the Daily is locked.
 *
 * NO TEMPLATE ON TWO DAYS RUNNING, across rebuilds as well as within one.
 * What the phone delivers on a day comes from whichever plan was pending at
 * the time, and tonight's rebuild cannot see what this morning's put out. So
 * the daily thread goes by the date alone: two plans built hours apart agree
 * on it, the day after always takes the next turn of the same pool, and no two
 * of those pools share a line. A win-back line steps around its neighbours
 * instead — yesterday's, which is this plan's own, and tomorrow's, which
 * belongs to the plan the player's return will write, a ready line whose turn
 * is known in advance.
 */
export function planNudges(s: NudgeState): LocalNotificationSchema[] {
  if (!s.dailyOpen) return [];
  const t = reminderMinute(s.sessionMinutes);
  const S = todayISO(s.now);
  const earliest = s.now.getTime() + LEAD_MS;
  const said = new Map<string, Line[]>();
  const out: LocalNotificationSchema[] = [];

  for (const slot of SLOTS) {
    if (!wanted(slot.kind, s, t)) continue;
    const forDay = shiftISO(S, slot.offset);
    const minute = slot.saver ? SAVER_MINUTE : t;
    if (minute < QUIET_UNTIL || minute > QUIET_FROM) continue;
    const when = at(forDay, minute);
    if (when.getTime() < earliest) continue;

    const day = dayNumberOf(forDay);
    const pool = copyPool(slot.kind, s);
    const line =
      slot.thread === 'foldwing.daily'
        ? turn(pool, day)
        : pick(pool, day, [...(said.get(shiftISO(forDay, -1)) ?? []), ...readyTurns(day + 1)]);
    said.set(forDay, [...(said.get(forDay) ?? []), line]);
    out.push({
      id: NUDGE_IDS[slot.kind],
      title: line.title,
      body: line.body,
      schedule: { at: when, allowWhileIdle: false },
      extra: { route: 'daily', kind: slot.kind, forDay, template: line.key },
      actionTypeId: 'FOLD',
      threadIdentifier: slot.thread,
      relevanceScore: slot.relevance,
      interruptionLevel: 'active',
    });
  }
  return out;
}

/* ------------------------------------------------------------ tap, ask */

/**
 * Where a reminder tap goes: today's fold, when the tap is ours, the fold is
 * still unplayed and the player is past the tutorial with the Daily open
 * (Progress.dailyUnlocked — a player who skipped l5 has the index but not the
 * Daily). Anything else is the menu, which is never wrong.
 */
export function routeForTap(
  extra: unknown,
  st: { doneToday: boolean; unlockedIndex: number; dailyUnlocked?: boolean }
): 'daily' | 'menu' {
  if (!extra || typeof extra !== 'object') return 'menu';
  if ((extra as { route?: unknown }).route !== 'daily') return 'menu';
  if (st.doneToday) return 'menu';
  if (!(st.unlockedIndex >= DAILY_ROUTE_MIN_INDEX)) return 'menu';
  if (st.dailyUnlocked === false) return 'menu';
  return 'daily';
}

/** At most three soft asks in a save's life, at least a week apart. */
export const SOFT_ASK_MAX = 3;
export const SOFT_ASK_SPACING_DAYS = 7;

/**
 * Whether a surface may offer "Remind me" now.
 *
 * Never once iOS has the answer — a granted player needs nothing, and a denied
 * one can only change it in Settings, which is the Settings row's job. Never
 * for a player who switched Reminders off in the game either: that was a no.
 * A last ask dated in the future (a clock set back) counts as recent.
 */
export function shouldSoftAsk(
  save: { readonly nudgeAsks: number; readonly nudgeAskedOn: string; readonly reminders: boolean },
  today: string,
  permission: 'granted' | 'denied' | 'prompt'
): boolean {
  if (permission !== 'prompt') return false;
  if (!save.reminders) return false;
  if (!(save.nudgeAsks < SOFT_ASK_MAX)) return false;
  if (save.nudgeAskedOn && !(daysBetween(save.nudgeAskedOn, today) >= SOFT_ASK_SPACING_DAYS)) return false;
  return true;
}
