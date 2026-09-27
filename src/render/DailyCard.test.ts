/*
 * The Daily card's state — which face and which words, for every kind of day
 * a player can have. The drawing is Phaser and is checked in the browser; this
 * is the decision. Dates are spelled out, in Europe/Belgrade (vite.config.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// DailyCard draws with Phaser, which cannot load without a browser; the state
// under test touches none of it.
vi.mock('phaser', () => ({
  default: { GameObjects: { Container: class {}, Text: class {}, Events: { DESTROY: 'destroy' } } },
}));

const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: ({ key }: { key: string }) => Promise.resolve({ value: disk.get(key) ?? null }),
    set: ({ key, value }: { key: string; value: string }) => {
      disk.set(key, value);
      return Promise.resolve();
    },
    remove: ({ key }: { key: string }) => {
      disk.delete(key);
      return Promise.resolve();
    },
  },
}));

import { shiftISO } from '../core/CalendarDay';
import { LEVELS } from '../data/levels';
import { Progress, type DailyResult } from '../systems/Progress';
import {
  dailyCardBare,
  dailyCardFace,
  dailyCardState,
  dailyNumber,
  dailyOpenFor,
  dailyPill,
  dailyStreakShown,
  dailySubShown,
  dayLabel,
  firstSession,
  streakChipState,
  tutorialFoldsToGo,
  weekdayOf,
  weekLetters,
  type DailyKind,
  type DailySave,
} from './DailyCard';
import { blend, contrast, ui } from './Theme';

const TODAY = '2026-09-22';
const NOON = new Date(2026, 8, 22, 12, 0);

const played = (ms = 48_000): DailyResult => ({ ms, deaths: 0, foldSense: 50 });

/** `n` days folded, ending `end` days before today (0 = today). */
function run(n: number, end: number, today = TODAY): Record<string, DailyResult> {
  const out: Record<string, DailyResult> = {};
  for (let i = 0; i < n; i++) out[shiftISO(today, -(end + i))] = played();
  return out;
}

/** A player past the tutorial, with whatever the case sets on top. */
function save(p: Partial<DailySave> = {}): DailySave {
  return {
    daily: {},
    bookmarked: [],
    bookmarks: 0,
    lastRepair: '',
    cleared: ['l1', 'l2', 'l3', 'l4', 'l5'],
    unlockedIndex: 5,
    ...p,
  };
}

describe('dailyCardState', () => {
  it('names the fold and the date', () => {
    const st = dailyCardState(save(), TODAY, NOON);
    expect(st.title).toBe('Daily fold');
    expect(st.right).toBe('#53 · Tue 22 Sep');
    expect(dailyNumber('2026-08-01')).toBe(1);
    expect(dailyNumber('2026-07-31')).toBe(0);
  });

  it('says which fold in the caps, and whose day it is in the heading (the B card)', () => {
    const st = dailyCardState(save(), TODAY, NOON);
    expect(st.caps).toBe('Daily fold · No. 53');
    expect(st.heading).toBe("Tuesday's fold");
    expect(st.letters).toEqual(['W', 'T', 'F', 'S', 'S', 'M', 'T']);
    expect(weekLetters('2026-09-27')).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    // Before the epoch there is no number to give it.
    expect(dailyCardState(save(), '2026-07-20', NOON).caps).toBe('Daily fold');
  });

  it('is locked for a brand-new player, counting the folds left', () => {
    const fresh = save({ cleared: [], unlockedIndex: 0 });
    const st = dailyCardState(fresh, TODAY, NOON);
    expect(st.kind).toBe('locked');
    expect(st.sub).toBe('unlocks after the tutorial · 5 folds to go');
    expect(dailyCardState(save({ cleared: ['l1', 'l2'], unlockedIndex: 2 }), TODAY, NOON).sub).toBe(
      'unlocks after the tutorial · 3 folds to go'
    );
    expect(dailyCardState(save({ cleared: ['l1', 'l2', 'l3', 'l4'], unlockedIndex: 4 }), TODAY, NOON).sub).toBe(
      'unlocks after the tutorial · 1 fold to go'
    );
    // Skipped the last tutorial fold: still one to fold, never zero.
    expect(tutorialFoldsToGo({ unlockedIndex: 7 })).toBe(1);
    expect(tutorialFoldsToGo({ unlockedIndex: Number.NaN })).toBe(5);
  });

  it('never locks a player who has folded a Daily', () => {
    const st = dailyCardState(save({ cleared: [], unlockedIndex: 0, daily: run(1, 9) }), TODAY, NOON);
    expect(st.kind).not.toBe('locked');
  });

  it('never locks a player past the tutorial whose tutorial clears were migrated away', () => {
    const st = dailyCardState(save({ cleared: [LEVELS[56].id], unlockedIndex: 57 }), TODAY, NOON);
    expect(st.kind).toBe('fresh');
  });

  it('agrees with Progress.dailyUnlocked on every shape', async () => {
    const shapes: Partial<DailySave>[] = [
      { cleared: [], unlockedIndex: 0 },
      { cleared: ['l1', 'l2', 'l3', 'l4'], unlockedIndex: 4 },
      { cleared: ['l1', 'l2', 'l3', 'l4'], unlockedIndex: 5 },
      { cleared: ['l5'], unlockedIndex: 5 },
      { cleared: [LEVELS[40].id], unlockedIndex: 41 },
      { cleared: [], unlockedIndex: 0, daily: run(1, 3) },
    ];
    for (const s of shapes) {
      await Progress.reset();
      Progress.update({ ...save(s) });
      expect(dailyOpenFor(save(s))).toBe(Progress.dailyUnlocked());
    }
  });

  it('is fresh with no run to speak of', () => {
    expect(dailyCardState(save(), TODAY, NOON)).toMatchObject({ kind: 'fresh', sub: 'one maze, everyone, today', streak: 0 });
    // A single old day is not a run worth naming.
    expect(dailyCardState(save({ daily: run(1, 5) }), TODAY, NOON).kind).toBe('fresh');
  });

  it('says what today keeps while a run is alive', () => {
    const st = dailyCardState(save({ daily: run(12, 1) }), TODAY, NOON);
    expect(st).toMatchObject({ kind: 'atRisk', streak: 12, sub: 'day 13 · keeps your 12-day streak' });
  });

  describe('the 18:00 line', () => {
    const at = (h: number, m: number) => new Date(2026, 8, 22, h, m);

    it('turns at 18:00 local, not a minute before', () => {
      const s = save({ daily: run(12, 1) });
      expect(dailyCardState(s, TODAY, at(17, 59)).sub).toBe('day 13 · keeps your 12-day streak');
      expect(dailyCardState(s, TODAY, at(18, 0)).sub).toBe('your 12-day streak ends at midnight');
      expect(dailyCardState(s, TODAY, at(23, 59)).sub).toBe('your 12-day streak ends at midnight');
    });

    it('never says it when a bookmark would cover the day', () => {
      const s = save({ daily: run(12, 1), bookmarks: 1 });
      expect(dailyCardState(s, TODAY, at(20, 0)).sub).toBe('day 13 · keeps your 12-day streak');
    });

    it('never says it for a run under three days', () => {
      const s = save({ daily: run(2, 1) });
      expect(dailyCardState(s, TODAY, at(20, 0)).sub).toBe('day 3 · keeps your 2-day streak');
    });

    /*
     * QA round 1 (at-risk hierarchy): that evening the card is filled with the
     * accent, the strongest thing on the page — and on no other.
     */
    it('fills the card that evening, and only that evening', () => {
      const s = save({ daily: run(12, 1) });
      const late = dailyCardState(s, TODAY, at(18, 0));
      expect(late).toMatchObject({ kind: 'atRisk', late: true });
      expect(dailyCardFace(late)).toBe('filled');
      expect(dailyCardFace(dailyCardState(s, TODAY, at(17, 59)))).toBe('wash');
      expect(dailyCardFace(dailyCardState(save({ daily: run(12, 1), bookmarks: 1 }), TODAY, at(20, 0)))).toBe('wash');
      expect(dailyCardFace(dailyCardState(save({ daily: run(2, 1) }), TODAY, at(20, 0)))).toBe('wash');
      // Folded, or never at risk: never filled, however late.
      expect(dailyCardFace(dailyCardState(save({ daily: { ...run(12, 1), [TODAY]: played() } }), TODAY, at(20, 0)))).toBe('quiet');
      expect(dailyCardFace(dailyCardState(save({ daily: run(12, 4) }), TODAY, at(20, 0)))).toBe('wash');
    });

    it('keeps every word readable on the dusk card, at both ends of its gradient', () => {
      const u = ui();
      for (const ground of [u.duskFrom, blend(u.duskFrom, 0.5, u.duskTo), u.duskTo]) {
        expect(contrast(u.text, ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(u.text2, ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(u.text3, ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(u.duskCaps, ground)).toBeGreaterThanOrEqual(4.5);
        // The quiet pill's word and the done dots are dusk on the card.
        expect(contrast(u.dusk, ground)).toBeGreaterThanOrEqual(3);
      }
      // The filled pill's word, and the check on a folded day, are dark on the dusk.
      expect(contrast(u.onDusk, u.dusk)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('paints each kind on its face', () => {
    const faces: Record<DailyKind, string> = {
      locked: 'quiet',
      done: 'quiet',
      fresh: 'wash',
      broken: 'wash',
      repairable: 'wash',
      atRisk: 'wash',
    };
    for (const [kind, face] of Object.entries(faces)) {
      expect(dailyCardFace({ kind: kind as DailyKind, late: false })).toBe(face);
    }
  });

  /*
   * QA round 1: a player who has never folded a Daily saw seven hollow rings
   * and a "0" flame — a week missed before they were offered one.
   */
  it('shows no week on a locked card or a fresh one with no Daily folded, and the week on every other', () => {
    const none = save();
    expect(dailyCardBare('locked', none)).toBe(true);
    expect(dailyCardBare('fresh', none)).toBe(true);
    for (const kind of ['atRisk', 'done', 'broken', 'repairable'] as DailyKind[]) {
      expect(dailyCardBare(kind, save({ daily: run(3, 0) }))).toBe(false);
    }
    expect(dailyCardState(none, TODAY, NOON)).toMatchObject({ kind: 'fresh', bare: true });
    expect(dailyCardState(save({ cleared: [], unlockedIndex: 0 }), TODAY, NOON)).toMatchObject({
      kind: 'locked',
      bare: true,
    });
  });

  /*
   * Verifier, fix round 1: 'fresh' is "best ≤ 1", not "never played". One
   * Daily folded a few days ago is still fresh, and its done dot is the
   * player's own: the week stays.
   */
  it('keeps the week on a fresh card with a Daily folded before', () => {
    const st = dailyCardState(save({ daily: run(1, 3) }), TODAY, NOON);
    expect(st).toMatchObject({ kind: 'fresh', bare: false });
    expect(st.strip.filter((d) => d === 'done')).toHaveLength(1);
    expect(dailyCardBare('fresh', save({ daily: run(1, 12) }))).toBe(false);
  });

  it('is done once today is folded, with the time', () => {
    const daily = { ...run(3, 1), [TODAY]: played(48_000) };
    const st = dailyCardState(save({ daily }), TODAY, NOON);
    expect(st).toMatchObject({ kind: 'done', streak: 4, sub: 'solved in 0:48 · next fold at midnight' });
  });

  it('remembers the best run once one is broken', () => {
    const st = dailyCardState(save({ daily: run(12, 4) }), TODAY, NOON);
    expect(st).toMatchObject({ kind: 'broken', streak: 0, sub: 'best streak 12 · start a new one' });
  });

  describe('repairable', () => {
    it('offers to keep a run that missed exactly yesterday, counting that run', () => {
      const st = dailyCardState(save({ daily: run(12, 2) }), TODAY, NOON);
      expect(st).toMatchObject({ kind: 'repairable', sub: '12-day streak missed a day · keep it?', streak: 0, run: 12 });
    });

    /*
     * QA round 1 (D1): with repairable first, a player who folded today's
     * Daily read "missed a day · keep it?" all day. Folded wins; the repair
     * stays on the streak chip, which keeps its dot.
     */
    it('says today is folded once it is, with the repair still on the chip', () => {
      const daily = { ...run(12, 2), [TODAY]: played(48_000) };
      const st = dailyCardState(save({ daily }), TODAY, NOON);
      expect(st).toMatchObject({ kind: 'done', sub: 'solved in 0:48 · next fold at midnight', run: 0 });
      expect(streakChipState(save({ daily }), TODAY)).toEqual({ count: 1, faint: false, dot: true });
    });

    it('does not offer it inside the cooldown', () => {
      const s = save({ daily: run(12, 2), lastRepair: shiftISO(TODAY, -5) });
      expect(dailyCardState(s, TODAY, NOON).kind).toBe('broken');
    });

    it('does not sell the player a bookmark they already hold', () => {
      const s = save({ daily: run(12, 2), bookmarks: 1 });
      expect(dailyCardState(s, TODAY, NOON).kind).not.toBe('repairable');
    });

    it('does not offer it for a one-day run', () => {
      expect(dailyCardState(save({ daily: run(1, 2) }), TODAY, NOON).kind).toBe('fresh');
    });
  });

  it('calls hard only when there is something to do today', () => {
    const pill = (kind: DailyKind) => dailyPill({ kind });
    expect(pill('locked')).toMatchObject({ text: 'Locked', icon: 'lock', quiet: true });
    expect(pill('done')).toMatchObject({ text: 'Solved', icon: 'check', quiet: true });
    expect(pill('repairable')).toMatchObject({ text: 'Keep it', quiet: false, trailing: true });
    for (const k of ['fresh', 'atRisk', 'broken'] as DailyKind[]) expect(pill(k)).toMatchObject({ text: 'Play', quiet: false });
  });

  it('says its state in words only where the numeral and the week cannot', () => {
    const at = (h: number) => new Date(2026, 8, 22, h, 0);
    // The everyday states: the week wears its letters instead.
    expect(dailySubShown(dailyCardState(save({ daily: run(12, 1) }), TODAY, NOON))).toBe(false);
    expect(dailySubShown(dailyCardState(save({ daily: run(1, 5) }), TODAY, NOON))).toBe(false);
    // Everything else is said.
    expect(dailySubShown(dailyCardState(save({ daily: run(12, 1) }), TODAY, at(20)))).toBe(true);
    expect(dailySubShown(dailyCardState(save({ daily: run(12, 2) }), TODAY, NOON))).toBe(true);
    expect(dailySubShown(dailyCardState(save({ daily: run(12, 4) }), TODAY, NOON))).toBe(true);
    expect(dailySubShown(dailyCardState(save({ daily: { ...run(3, 1), [TODAY]: played() } }), TODAY, NOON))).toBe(true);
    expect(dailySubShown(dailyCardState(save(), TODAY, NOON))).toBe(true);
    expect(dailySubShown(dailyCardState(save({ cleared: [], unlockedIndex: 0 }), TODAY, NOON))).toBe(true);
  });

  it('counts the run beside the flame, faint while a repair can keep it, and no numeral at 0', () => {
    expect(dailyStreakShown(dailyCardState(save({ daily: run(12, 1) }), TODAY, NOON))).toEqual({ n: 12, faint: false });
    expect(dailyStreakShown(dailyCardState(save({ daily: run(12, 2) }), TODAY, NOON))).toEqual({ n: 12, faint: true });
    expect(dailyStreakShown(dailyCardState(save({ daily: run(12, 4) }), TODAY, NOON))).toBeNull();
    expect(dailyStreakShown(dailyCardState(save(), TODAY, NOON))).toBeNull();
  });

  it('draws the last seven days, oldest first, with bookmarked days as bookmarks', () => {
    const daily = run(3, 2); // 20, 19, 18 Sep
    const st = dailyCardState(save({ daily, bookmarked: [shiftISO(TODAY, -1)] }), TODAY, NOON);
    expect(st.strip).toEqual(['missed', 'missed', 'done', 'done', 'done', 'marked', 'today-open']);
  });

  it('keeps the week straight across the October DST change', () => {
    // Clocks go back on Sunday 25 October 2026 in Belgrade.
    const today = '2026-10-27';
    const daily = { '2026-10-24': played(), '2026-10-25': played(), '2026-10-26': played() };
    const st = dailyCardState(save({ daily }), today, new Date(2026, 9, 27, 9, 0));
    expect(st.strip).toEqual(['missed', 'missed', 'missed', 'done', 'done', 'done', 'today-open']);
    expect(st.streak).toBe(3);
    expect(weekdayOf('2026-10-25')).toBe(0);
    expect(dayLabel('2026-10-25')).toBe('Sun 25 Oct');
    expect(dayLabel(today)).toBe('Tue 27 Oct');
  });
});

/*
 * QA round 1 (UX-1): the chip said a faint "0" with the repair dot while the
 * card and the sheet said "keep your 12-day streak".
 */
describe('streakChipState', () => {
  it('holds the run a repair can keep, faint, with the dot', () => {
    expect(streakChipState(save({ daily: run(12, 2) }), TODAY)).toEqual({ count: 12, faint: true, dot: true });
  });

  it('shows a live run in full, and a broken one faint at 0 with no dot', () => {
    expect(streakChipState(save({ daily: run(12, 1) }), TODAY)).toEqual({ count: 12, faint: false, dot: false });
    expect(streakChipState(save({ daily: run(12, 4) }), TODAY)).toEqual({ count: 0, faint: true, dot: false });
    // Inside the cooldown there is nothing to keep: a broken run.
    const cooled = save({ daily: run(12, 2), lastRepair: shiftISO(TODAY, -5) });
    expect(streakChipState(cooled, TODAY)).toEqual({ count: 0, faint: true, dot: false });
  });
});

/*
 * QA round 1 (first session): the economy waits until the tutorial is done —
 * the frontier short of level 6 and no Daily ever folded.
 */
describe('firstSession', () => {
  it('lasts until the tutorial is done', () => {
    expect(firstSession({ unlockedIndex: 0, daily: {} })).toBe(true);
    expect(firstSession({ unlockedIndex: 4, daily: {} })).toBe(true);
    expect(firstSession({ unlockedIndex: 5, daily: {} })).toBe(false);
    expect(firstSession({ unlockedIndex: 57, daily: {} })).toBe(false);
  });

  it('is over for anyone who has folded a Daily', () => {
    expect(firstSession({ unlockedIndex: 0, daily: run(1, 9) })).toBe(false);
  });
});

beforeEach(() => disk.clear());
