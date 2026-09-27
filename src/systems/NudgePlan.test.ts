/*
 * A reminder is the one thing this game says when it is not on screen, and
 * iOS gives the player one switch for all of them: a reminder that repeats
 * itself, arrives at night, lies about the streak or tries to sell something
 * gets every future one switched off, and that is not recoverable. So the
 * whole plan is pinned here — the hour, the day, the count, and every
 * sentence — against the player shapes that differ.
 */
import { describe, expect, it } from 'vitest';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { todayISO } from '../core/CalendarDay';
import { LEVELS } from '../data/levels';
import {
  copyPool,
  DEFAULT_MINUTE,
  LEAD_MS,
  LINES,
  lineFor,
  localDayNumber,
  NUDGE_IDS,
  planNudges,
  reminderMinute,
  routeForTap,
  shouldSoftAsk,
  timeLabel,
  type NudgeKind,
  type NudgeState,
} from './NudgePlan';

/** See CalendarDay.test: a named zone for the block, the real one put back. */
function inZone<T>(tz: string, body: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** Tuesday 22 September 2026, 08:00 local: before any slot of the day. */
const MORNING = new Date(2026, 8, 22, 8, 0);

function state(o: Partial<NudgeState> = {}): NudgeState {
  return {
    now: MORNING,
    dailyOpen: true,
    doneToday: false,
    streak: 0,
    longest: 0,
    bookmarks: 0,
    lastDailyMs: null,
    sessionMinutes: [],
    adsRemoved: false,
    figures: 0,
    chapter: { index: 0, left: 20 },
    resume: null,
    ...o,
  };
}

type Extra = { route: string; kind: NudgeKind; forDay: string; template: string };
const extra = (n: LocalNotificationSchema): Extra => n.extra as Extra;
const when = (n: LocalNotificationSchema): Date => n.schedule!.at!;
const kinds = (plan: LocalNotificationSchema[]): NudgeKind[] => plan.map((n) => extra(n).kind);
const SAVERS: readonly NudgeKind[] = ['saver-today', 'saver+1'];

/** Every combination that changes the plan, at every hour that matters. */
function* grid(): Generator<NudgeState> {
  const hours = [
    [0, 5],
    [8, 0],
    [8, 45],
    [12, 0],
    [18, 59],
    [19, 10],
    [21, 0],
    [21, 29],
    [23, 50],
  ];
  for (const [h, m] of hours)
    for (const doneToday of [false, true])
      for (const streak of [0, 1, 2, 3, 12, 365])
        for (const bookmarks of [0, 1, 2])
          for (const adsRemoved of [false, true])
            for (const sessionMinutes of [[], [480], [700, 720, 1300], [60, 1400]])
              yield state({
                now: new Date(2026, 8, 22, h, m, 30),
                doneToday,
                streak,
                longest: Math.max(streak, 5),
                bookmarks,
                adsRemoved,
                sessionMinutes,
                lastDailyMs: doneToday ? 48_000 : null,
                figures: streak,
                resume: streak % 2 ? { index: 41, name: LEVELS[41].name } : null,
                chapter: adsRemoved ? { index: 2, left: bookmarks + 1 } : { index: 2, left: 14 },
              });
}

describe('the reminder hour', () => {
  it('is 19:00 until anything is known', () => {
    expect(reminderMinute([])).toBe(DEFAULT_MINUTE);
    expect(DEFAULT_MINUTE).toBe(19 * 60);
  });

  it('is half an hour before the median first open, on a quarter hour', () => {
    expect(reminderMinute([600])).toBe(570); // 10:00 → 09:30
    expect(reminderMinute([600, 700, 800])).toBe(675); // 11:40 − 30 = 11:10 → 11:15
    expect(reminderMinute([600, 700])).toBe(615); // median 10:50 − 30 = 10:20 → 10:15
    expect(reminderMinute([800, 600, 700])).toBe(675); // order is irrelevant
  });

  it('stays between 09:00 and 20:30', () => {
    expect(reminderMinute([420])).toBe(540); // a 07:00 riser still hears at 09:00
    expect(reminderMinute([1400])).toBe(1230); // a night owl hears at 20:30, not 22:50
    expect(reminderMinute([5])).toBe(540);
  });

  it('ignores anything that is not a minute of the day', () => {
    expect(reminderMinute([Number.NaN, -5, 2000, 1.5, 600])).toBe(570);
    expect(reminderMinute([Number.NaN])).toBe(DEFAULT_MINUTE);
  });
});

describe('the hour, as the surfaces say it', () => {
  it('reads like a person: "around 7 pm"', () => {
    expect(timeLabel(DEFAULT_MINUTE)).toBe('7 pm');
    expect(timeLabel(19 * 60 + 30)).toBe('7:30 pm');
    expect(timeLabel(9 * 60 + 15)).toBe('9:15 am');
    expect(timeLabel(12 * 60)).toBe('12 pm');
    expect(timeLabel(0)).toBe('12 am');
    expect(timeLabel(20 * 60 + 30)).toBe('8:30 pm');
    expect(timeLabel(Number.NaN)).toBe('7 pm');
  });
});

describe('the schedule', () => {
  it('holds at most 8, on ids 8101..8109, each slot once', () => {
    for (const s of grid()) {
      const plan = planNudges(s);
      expect(plan.length).toBeLessThanOrEqual(8);
      const ids = plan.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const n of plan) {
        expect(n.id).toBeGreaterThanOrEqual(8101);
        expect(n.id).toBeLessThanOrEqual(8109);
        expect(n.id).toBe(NUDGE_IDS[extra(n).kind]);
      }
    }
  });

  /*
   * Every line is about the Daily, and a tap would open the Menu with its card
   * still locked — so a player still in the tutorial hears nothing, even with
   * permission granted from the Settings switch.
   */
  it('plans nothing while the Daily is locked', () => {
    for (const s of grid()) expect(planNudges({ ...s, dailyOpen: false })).toEqual([]);
  });

  it('says one thing a day, plus the saver, and the saver only at a streak of 3 or more', () => {
    for (const s of grid()) {
      const byDay = new Map<string, NudgeKind[]>();
      for (const n of planNudges(s)) {
        const e = extra(n);
        byDay.set(e.forDay, [...(byDay.get(e.forDay) ?? []), e.kind]);
      }
      for (const [, ks] of byDay) {
        expect(ks.filter((k) => !SAVERS.includes(k)).length).toBeLessThanOrEqual(1);
        expect(ks.filter((k) => SAVERS.includes(k)).length).toBeLessThanOrEqual(1);
      }
      if (s.streak < 3) expect(kinds(planNudges(s)).some((k) => SAVERS.includes(k))).toBe(false);
    }
  });

  it('never lands before 08:30 or after 21:30, and never within a minute of now', () => {
    for (const s of grid()) {
      for (const n of planNudges(s)) {
        const at = when(n);
        const minute = at.getHours() * 60 + at.getMinutes();
        expect(minute).toBeGreaterThanOrEqual(8 * 60 + 30);
        expect(minute).toBeLessThanOrEqual(21 * 60 + 30);
        expect(at.getTime()).toBeGreaterThanOrEqual(s.now.getTime() + LEAD_MS);
      }
    }
  });

  it('lays out the whole tail for a player on a 3-day streak who has not folded today', () => {
    const plan = planNudges(state({ streak: 3, longest: 3 }));
    expect(kinds(plan)).toEqual([
      'ready-today',
      'saver-today',
      'ready+1',
      'lapse-2',
      'lapse-4',
      'lapse-8',
      'lapse-15',
      'lapse-30',
    ]);
    const days = plan.map((n) => extra(n).forDay);
    expect(days).toEqual([
      '2026-09-22',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-26',
      '2026-09-30',
      '2026-10-07',
      '2026-10-22',
    ]);
    for (const n of plan) {
      const at = when(n);
      expect(todayISO(at)).toBe(extra(n).forDay);
      expect([at.getHours(), at.getMinutes()]).toEqual(SAVERS.includes(extra(n).kind) ? [21, 30] : [19, 0]);
    }
  });

  it('drops today once the Daily is done, and keeps tomorrow evening for the streak', () => {
    const plan = planNudges(state({ doneToday: true, streak: 4, lastDailyMs: 48_000 }));
    expect(plan.some((n) => extra(n).forDay === '2026-09-22')).toBe(false);
    expect(kinds(plan).slice(0, 2)).toEqual(['ready+1', 'saver+1']);
  });

  it('has no saver tomorrow when today is not done: today’s saver is the one that matters', () => {
    expect(kinds(planNudges(state({ streak: 5 })))).not.toContain('saver+1');
    expect(kinds(planNudges(state({ streak: 5, doneToday: true })))).not.toContain('saver-today');
  });

  it('gives up on today’s reminder once its hour has passed, but keeps the saver', () => {
    const ks = kinds(planNudges(state({ streak: 5, now: new Date(2026, 8, 22, 20, 0) })));
    expect(ks).not.toContain('ready-today');
    expect(ks).toContain('saver-today');
    // Less than a minute before 21:30: the saver would fire the moment the
    // player looked away, so it is dropped too.
    const late = kinds(planNudges(state({ streak: 5, now: new Date(2026, 8, 22, 21, 29, 30) })));
    expect(late).not.toContain('saver-today');
    expect(late[0]).toBe('ready+1');
  });

  it('follows the learned hour', () => {
    const plan = planNudges(state({ sessionMinutes: [12 * 60, 12 * 60 + 10, 12 * 60 + 20] }));
    const at = when(plan[0]);
    expect([at.getHours(), at.getMinutes()]).toEqual([11, 45]);
  });

  it('carries the Daily route, the FOLD category and the quiet presentation on every one', () => {
    for (const s of grid()) {
      for (const n of planNudges(s)) {
        const e = extra(n);
        expect(e.route).toBe('daily');
        expect(e.forDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(n.actionTypeId).toBe('FOLD');
        expect(n.interruptionLevel).toBe('active');
        expect(n.sound).toBeUndefined();
        const daily = ['ready-today', 'saver-today', 'ready+1', 'saver+1'].includes(e.kind);
        expect(n.threadIdentifier).toBe(daily ? 'foldwing.daily' : 'foldwing.winback');
        expect(n.relevanceScore).toBe(SAVERS.includes(e.kind) ? 1 : daily ? 0.8 : 0.4);
        expect(n).not.toHaveProperty('badge');
      }
    }
  });
});

describe('daylight saving', () => {
  /*
   * `at` becomes a countdown on iOS, so the moment has to be right, not just
   * the wall clock: across a fall-back night, 19:00 tomorrow is 25 hours
   * away, and a plan that added 24 would remind at 18:00.
   */
  it('keeps the hour across the end of summer time in Belgrade (2026-10-25)', () => {
    inZone('Europe/Belgrade', () => {
      const plan = planNudges(state({ now: new Date(2026, 9, 24, 10, 0), streak: 4 }));
      const today = plan.find((n) => extra(n).kind === 'ready-today')!;
      const tomorrow = plan.find((n) => extra(n).kind === 'ready+1')!;
      expect(extra(tomorrow).forDay).toBe('2026-10-25');
      expect([when(tomorrow).getHours(), when(tomorrow).getMinutes()]).toEqual([19, 0]);
      expect(when(tomorrow).getTime() - when(today).getTime()).toBe(25 * 3600_000);
      for (const n of plan) expect(todayISO(when(n))).toBe(extra(n).forDay);
    });
  });

  it('keeps the hour across the end of daylight time in New York (2026-11-01)', () => {
    inZone('America/New_York', () => {
      const plan = planNudges(state({ now: new Date(2026, 9, 31, 12, 0), sessionMinutes: [600] }));
      const tomorrow = plan.find((n) => extra(n).kind === 'ready+1')!;
      expect(extra(tomorrow).forDay).toBe('2026-11-01');
      expect([when(tomorrow).getHours(), when(tomorrow).getMinutes()]).toEqual([9, 30]);
      for (const n of plan) {
        expect(todayISO(when(n))).toBe(extra(n).forDay);
        expect(when(n).getHours() * 60 + when(n).getMinutes()).toBe(570);
      }
    });
  });

  it('keeps the day on the morning the clocks change', () => {
    inZone('Europe/Belgrade', () => {
      const plan = planNudges(state({ now: new Date(2026, 9, 25, 8, 0) }));
      expect(extra(plan[0]).forDay).toBe('2026-10-25');
      expect(when(plan[0]).getHours()).toBe(19);
    });
  });
});

describe('what they say', () => {
  const titleAndBody = (n: { title: string; body: string }) => `${n.title} ${n.body}`;
  const ALL: readonly NudgeKind[] = Object.keys(NUDGE_IDS) as NudgeKind[];

  /** The longest thing any placeholder can hold. */
  const longestName = LEVELS.reduce((a, l) => (l.name.length > a.length ? l.name : a), '');
  const extreme = (o: Partial<NudgeState>) =>
    state({
      streak: 365,
      longest: 365,
      lastDailyMs: 59 * 60_000 + 59_000,
      figures: 1000,
      chapter: { index: 14, left: 9 },
      resume: { index: LEVELS.length - 1, name: longestName },
      ...o,
    });

  it('fits the lock screen: titles ≤ 45 and bodies ≤ 80, at n = 365 and the longest name', () => {
    for (const doneToday of [false, true])
      for (const adsRemoved of [false, true])
        for (const bookmarks of [0, 2])
          for (const streak of [0, 2, 365]) {
            const s = extreme({ doneToday, adsRemoved, bookmarks, streak });
            for (const k of ALL)
              for (const l of copyPool(k, s)) {
                expect(l.title.length, l.title).toBeLessThanOrEqual(45);
                expect(l.body.length, l.body).toBeLessThanOrEqual(80);
                expect(l.title.length, l.title).toBeGreaterThan(8);
                expect(l.body.length, l.body).toBeGreaterThan(20);
              }
          }
  });

  it('names the streak only from 3, and the day it continues', () => {
    const three = copyPool('ready-today', state({ streak: 3 }));
    expect(three.map((l) => l.title)).toContain('Day 4 is waiting');
    expect(three.some((l) => l.body.includes('3-day streak'))).toBe(true);
    const two = copyPool('ready-today', state({ streak: 2 }));
    expect(two.every((l) => !/streak|\bday \d/i.test(titleAndBody(l)))).toBe(true);
  });

  it('does not name a streak tomorrow that tonight will end', () => {
    // Not folded today, no bookmark: by tomorrow the run is gone.
    const gone = copyPool('ready+1', state({ streak: 9 }));
    expect(gone.some((l) => /streak|9/.test(titleAndBody(l)))).toBe(false);
    // With a bookmark the guard bridges today, so tomorrow still continues it.
    const kept = copyPool('ready+1', state({ streak: 9, bookmarks: 1 }));
    expect(kept.map((l) => l.title)).toContain('Day 10 is waiting');
  });

  it('rotates in last time’s clock after a folded day', () => {
    const pool = copyPool('ready+1', state({ doneToday: true, streak: 6, lastDailyMs: 48_000 }));
    expect(pool.map(titleAndBody)).toContain('A new maze for day 7 Yesterday took 0:48. See if today folds faster.');
    // It takes a turn rather than adding one: the pool rotates on the same
    // length as this morning's, or tonight's plan could repeat today's line.
    expect(pool).toHaveLength(copyPool('ready-today', state({ streak: 6 })).length);
    expect(copyPool('ready+1', state({ doneToday: true, streak: 2, lastDailyMs: 48_000 }))).toHaveLength(LINES.length);
    expect(copyPool('ready+1', state({ doneToday: true, streak: 1, lastDailyMs: 48_000 })).some((l) => l.key === 'ready.faster')).toBe(false);
  });

  /*
   * With a bookmark in hand the streak does NOT end at midnight — the guard
   * spends the bookmark — so "ends at midnight" would be a lie the next
   * morning proves.
   */
  it('tells a bookmark holder the truth', () => {
    for (const k of ['saver-today', 'saver+1'] as const) {
      const held = copyPool(k, state({ streak: 12, bookmarks: 1 }));
      expect(held.map((l) => l.key).sort()).toEqual(['saver.keep', 'saver.reserve']);
      for (const l of held) expect(titleAndBody(l)).not.toMatch(/midnight|ends/i);
      expect(held.some((l) => /bookmark/.test(l.body))).toBe(true);
      const none = copyPool(k, state({ streak: 12, bookmarks: 0 }));
      expect(none.map((l) => l.key).sort()).toEqual(['saver.ends', 'saver.going', 'saver.left']);
      expect(none.some((l) => l.title === 'Your 12-day streak ends at midnight')).toBe(true);
    }
  });

  it('never mentions reveals to a Remove Ads owner, and never sells', () => {
    for (const s of grid()) {
      for (const k of ALL)
        for (const l of copyPool(k, s)) {
          if (s.adsRemoved) expect(titleAndBody(l), l.key).not.toMatch(/reveal/i);
          expect(titleAndBody(l), l.key).not.toMatch(/\$|€|£|buy|sale|offer|discount|free trial|price/i);
        }
    }
    const owner = copyPool('lapse-4', state({ adsRemoved: true, chapter: { index: 4, left: 3 } }));
    expect(owner.map(titleAndBody)).toEqual(['Chapter 5 is 3 folds from done Pick up where you left off.']);
    expect(copyPool('lapse-4', state({ adsRemoved: true, chapter: { index: 4, left: 1 } }))[0].title).toBe(
      'Chapter 5 is 1 fold from done'
    );
    expect(copyPool('lapse-4', state({ adsRemoved: true, chapter: { index: 4, left: 12 } }))[0].title).toBe(
      'New folds are waiting'
    );
    expect(copyPool('lapse-4', state({ adsRemoved: false })).every((l) => /reveal/i.test(l.title))).toBe(true);
  });

  it('never guilts, and never claims everyone is playing at once', () => {
    for (const s of grid())
      for (const k of ALL)
        for (const l of copyPool(k, s)) {
          const said = titleAndBody(l);
          expect(said, l.key).not.toMatch(/miss(ed)? you|you lost|don’t let|disappoint|shame|at once|at the same (time|moment)|everyone else is|right now/i);
        }
  });

  /*
   * Every slot but the savers lands at T, which is anywhere from 09:00 to
   * 20:30. "A new fold at your midnight" was delivered at 19:15 on the
   * simulator; a title that names an hour reads wrong at every other one.
   */
  it('names no hour in a title that lands at T', () => {
    const atT = ALL.filter((k) => !SAVERS.includes(k));
    for (const s of grid())
      for (const k of atT)
        for (const l of copyPool(k, s))
          expect(l.title, l.key).not.toMatch(/\b(midnight|morning|noon|afternoon|evening|tonight|night)\b/i);
    expect(LINES.map((l) => l.title)).not.toContain('A new fold at your midnight');
  });

  /* The mode's name is "Daily fold", as on the Menu card; "the Daily" for short. */
  it('calls the mode the Daily fold, capital D, small f', () => {
    for (const s of grid())
      for (const k of ALL)
        for (const l of copyPool(k, s)) expect(titleAndBody(l), l.key).not.toMatch(/\bdaily folds?\b|\bDaily Folds?\b/);
    expect(LINES[0].title).toBe('Your Daily fold is ready');
    expect(copyPool('lapse-30', state())[0].body).toBe('The Daily fold keeps coming whenever you want it.');
    expect(copyPool('lapse-2', state({ longest: 2 }))[0].body).toBe('Two Daily folds since you last drew a line.');
  });

  it('fills in the win-back details', () => {
    const s = state({ longest: 12, figures: 1, resume: { index: 41, name: LEVELS[41].name } });
    expect(copyPool('lapse-2', s)[0].body).toBe('Your best run is 12 days. Today could start the next one.');
    expect(copyPool('lapse-2', state({ longest: 2 }))[0].title).toBe('Two new mazes');
    expect(copyPool('lapse-8', s).map((l) => l.body)).toContain(
      `Level 42, ${LEVELS[41].name}, is right where you left it.`
    );
    expect(copyPool('lapse-8', state()).map((l) => l.key)).toEqual(['lapse8.week']);
    expect(copyPool('lapse-15', s)[0].title).toBe('Your gallery has 1 figure');
    expect(copyPool('lapse-15', state({ figures: 37 }))[0].title).toBe('Your gallery has 37 figures');
    expect(copyPool('lapse-15', state())[0].title).toBe('Two weeks of mazes');
  });

  /*
   * The reason there are several lines per slot. Within one plan the day
   * after never says what the day before said, even where two pools share a
   * title ("A fresh fold" is both a plain line and a lapse-2 one).
   */
  it('never repeats a line on consecutive days within a plan', () => {
    for (const s of grid()) {
      const plan = planNudges(s);
      for (const a of plan)
        for (const b of plan) {
          const next = new Date(`${extra(a).forDay}T12:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          if (extra(b).forDay !== next.toISOString().slice(0, 10)) continue;
          expect(b.title, `${extra(a).kind} → ${extra(b).kind}`).not.toBe(a.title);
          expect(extra(b).template).not.toBe(extra(a).template);
        }
    }
  });

  it('never repeats a line on consecutive days for a player who opens it every morning', () => {
    for (const bookmarks of [0, 1]) {
      let streak = 0;
      let prev: string | null = null;
      for (let d = 0; d < 60; d++) {
        const now = new Date(2026, 8, 1 + d, 8, 0);
        const plan = planNudges(state({ now, streak, longest: streak, bookmarks }));
        const delivered = plan.find((n) => extra(n).kind === 'ready-today')!;
        expect(delivered.title, `day ${d}`).not.toBe(prev);
        prev = delivered.title;
        streak += 1; // folded later that day
      }
    }
  });

  /*
   * The engaged player's evening: this morning's plan put today's reminder
   * out at 19:00, they tapped it and folded, and the rebuild that follows
   * writes tomorrow's. It must not open with the line they just read.
   */
  it('never repeats across a rebuild: tomorrow’s line after tonight’s fold is not today’s', () => {
    inZone('Europe/Belgrade', () => {
      for (const [streak, bookmarks] of [[0, 0], [1, 0], [2, 0], [2, 1], [3, 0], [5, 0], [5, 1], [40, 2]])
        for (let d = 0; d < 60; d++) {
          const morning = planNudges(state({ now: new Date(2026, 9, 1 + d, 8, 0), streak, longest: 40, bookmarks }));
          const today = morning.find((n) => extra(n).kind === 'ready-today')!;
          const evening = planNudges(
            state({
              now: new Date(2026, 9, 1 + d, 19, 5),
              doneToday: true,
              streak: streak + 1,
              longest: 40,
              bookmarks,
              lastDailyMs: 48_000,
            })
          );
          const tomorrow = evening.find((n) => extra(n).kind === 'ready+1')!;
          const why = `${extra(today).forDay} ${today.title} → ${tomorrow.title}`;
          expect(extra(tomorrow).template, why).not.toBe(extra(today).template);
          expect(tomorrow.title, why).not.toBe(today.title);
        }
    });
  });

  /*
   * What a phone delivers on a day comes from whichever plan was pending at
   * the time, so the rule has to hold across any run of rebuilds. Forty
   * players over six weeks — opening at any hour or not for days, folding or
   * not, streaks and bookmarks that come and go — and wherever two days in a
   * row both delivered something, nothing delivered on the second reads like
   * anything delivered on the first.
   */
  it('never repeats a line on consecutive days, however the player comes and goes', () => {
    let seed = 20260922;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    const int = (n: number): number => Math.floor(rnd() * n);
    for (let run = 0; run < 40; run++) {
      const sessionMinutes = [[], [480], [700, 720, 1300], [1250, 1260]][int(4)];
      const delivered = new Map<string, LocalNotificationSchema[]>();
      const deliver = (plan: LocalNotificationSchema[], until: number): void => {
        for (const n of plan) {
          if (when(n).getTime() > until) continue;
          const day = extra(n).forDay;
          delivered.set(day, [...(delivered.get(day) ?? []), n]);
        }
      };
      let plan: LocalNotificationSchema[] = [];
      let streak = int(6);
      for (let d = 0; d < 42; d++) {
        const opens = rnd() < 0.4 ? [] : [int(1440), int(1440)].slice(0, 1 + int(2)).sort((a, b) => a - b);
        let doneToday = false;
        for (const minute of opens) {
          const now = new Date(2026, 8, 1 + d, Math.floor(minute / 60), minute % 60);
          deliver(plan, now.getTime());
          if (!doneToday && rnd() < 0.6) {
            doneToday = true;
            streak += 1;
          }
          plan = planNudges(
            state({
              now,
              doneToday,
              streak,
              longest: Math.max(streak, int(20)),
              bookmarks: int(3),
              lastDailyMs: rnd() < 0.8 ? 1000 + int(300_000) : null,
              sessionMinutes,
              adsRemoved: rnd() < 0.3,
              figures: int(3),
              chapter: { index: int(15), left: int(20) },
              resume: rnd() < 0.5 ? { index: 41, name: LEVELS[41].name } : null,
            })
          );
        }
        if (!doneToday && rnd() < 0.5) streak = 0;
      }
      deliver(plan, Number.POSITIVE_INFINITY);

      for (const [day, first] of delivered) {
        const next = delivered.get(todayISO(new Date(new Date(`${day}T12:00:00`).getTime() + 86_400_000)));
        if (!next) continue;
        for (const a of first)
          for (const b of next) {
            const why = `run ${run}: ${extra(a).forDay} ${extra(a).kind} "${a.title}" → ${extra(b).kind} "${b.title}"`;
            expect(extra(b).template, why).not.toBe(extra(a).template);
            expect(b.title, why).not.toBe(a.title);
          }
      }
    }
  });

  it('never repeats a line on consecutive days for a player who stopped', () => {
    // The whole tail is one plan; also check a lapse that crosses from the
    // plain lines into lapse-2 on every day of a month.
    for (let d = 0; d < 30; d++) {
      const plan = planNudges(state({ now: new Date(2026, 8, 1 + d, 8, 0), longest: 7 }));
      const t = plan.map((n) => n.title);
      for (let i = 1; i < t.length; i++) expect(t[i]).not.toBe(t[i - 1]);
    }
  });
});

describe('the plain lines', () => {
  it('are nine distinct messages', () => {
    expect(LINES).toHaveLength(9);
    expect(new Set(LINES.map((l) => l.title)).size).toBe(9);
    expect(new Set(LINES.map((l) => l.body)).size).toBe(9);
  });

  it('never read the same on two days running', () => {
    for (let d = 0; d < 120; d++) expect(lineFor(d).title, `day ${d}`).not.toBe(lineFor(d + 1).title);
  });

  it('cycle rather than running out', () => {
    const seen = new Set(Array.from({ length: 9 }, (_, i) => lineFor(i).title));
    expect(seen.size).toBe(9);
    expect(lineFor(9).title).toBe(lineFor(0).title);
  });

  /* Day numbers come from a clock, and a clock can hand back anything. */
  it('survive a negative day number', () => {
    expect(() => lineFor(-1)).not.toThrow();
    expect(LINES.map((l) => l.title)).toContain(lineFor(-1).title);
  });
});

describe('the day number', () => {
  /*
   * LOCAL days, not UTC ones. The Daily fold rolls over at the player's own
   * midnight, and a reminder that belongs to the wrong day is a reminder about
   * a maze they have already played.
   */
  it('changes at local midnight, not UTC midnight', () => {
    const lateEvening = new Date(2026, 7, 17, 23, 30);
    const justAfter = new Date(2026, 7, 18, 0, 30);
    expect(localDayNumber(justAfter) - localDayNumber(lateEvening)).toBe(1);
  });

  it('is stable across a single day', () => {
    expect(localDayNumber(new Date(2026, 7, 17, 6, 0))).toBe(localDayNumber(new Date(2026, 7, 17, 22, 0)));
  });
});

describe('a tap', () => {
  const open = { doneToday: false, unlockedIndex: 12, dailyUnlocked: true };

  it('opens today’s fold when there is one to play', () => {
    expect(routeForTap({ route: 'daily', kind: 'ready-today', forDay: '2026-09-21' }, open)).toBe('daily');
    expect(routeForTap({ route: 'daily' }, { doneToday: false, unlockedIndex: 5 })).toBe('daily');
  });

  it.each([
    ['today is folded', { route: 'daily' }, { ...open, doneToday: true }],
    ['still in the tutorial', { route: 'daily' }, { ...open, unlockedIndex: 4 }],
    ['the Daily is locked', { route: 'daily' }, { ...open, dailyUnlocked: false }],
    ['a hostile index', { route: 'daily' }, { ...open, unlockedIndex: Number.NaN }],
    ['no route', { kind: 'lapse-2' }, open],
    ['another route', { route: 'store' }, open],
    ['no extra', undefined, open],
    ['null', null, open],
    ['a string', 'daily', open],
  ])('goes to the menu when %s', (_why, extra, st) => {
    expect(routeForTap(extra, st)).toBe('menu');
  });
});

describe('the soft ask', () => {
  const fresh = { nudgeAsks: 0, nudgeAskedOn: '', reminders: true };
  const today = '2026-09-22';

  it('is offered to an undecided player who has not been asked', () => {
    expect(shouldSoftAsk(fresh, today, 'prompt')).toBe(true);
  });

  it('is never offered once iOS has the answer', () => {
    expect(shouldSoftAsk(fresh, today, 'granted')).toBe(false);
    expect(shouldSoftAsk(fresh, today, 'denied')).toBe(false);
  });

  it('stops at three', () => {
    expect(shouldSoftAsk({ ...fresh, nudgeAsks: 2, nudgeAskedOn: '2026-09-01' }, today, 'prompt')).toBe(true);
    expect(shouldSoftAsk({ ...fresh, nudgeAsks: 3, nudgeAskedOn: '2026-09-01' }, today, 'prompt')).toBe(false);
    expect(shouldSoftAsk({ ...fresh, nudgeAsks: Number.NaN }, today, 'prompt')).toBe(false);
  });

  it('waits a week between asks', () => {
    expect(shouldSoftAsk({ ...fresh, nudgeAsks: 1, nudgeAskedOn: '2026-09-16' }, today, 'prompt')).toBe(false);
    expect(shouldSoftAsk({ ...fresh, nudgeAsks: 1, nudgeAskedOn: '2026-09-15' }, today, 'prompt')).toBe(true);
    // A clock set back puts the last ask in the future: that is recent, not old.
    expect(shouldSoftAsk({ ...fresh, nudgeAsks: 1, nudgeAskedOn: '2026-12-01' }, today, 'prompt')).toBe(false);
  });

  it('is never offered to a player who switched Reminders off', () => {
    expect(shouldSoftAsk({ ...fresh, reminders: false }, today, 'prompt')).toBe(false);
  });
});
