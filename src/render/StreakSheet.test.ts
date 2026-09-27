/*
 * What the Streak sheet says, and above all what its repair row offers — the
 * part of the sheet that is a decision rather than drawing. The repair is a
 * rescue placement (§0): free wherever no ad can play and for Remove Ads
 * owners, and when it does ask for an ad the row says so in words. The card
 * itself is Phaser and is checked in the browser.
 */
import { describe, expect, it, vi } from 'vitest';

// The sheet draws with Phaser, which cannot load without a browser; the model
// under test touches none of it. The ad layer and the store are stand-ins: the
// model is handed `rewardedAvailable`, it never reads it.
vi.mock('phaser', () => ({
  default: { GameObjects: { Container: class {}, Text: class {}, Events: { DESTROY: 'destroy' } } },
}));
vi.mock('../systems/Ads', () => ({ Ads: { rewardedAvailable: false, showRewarded: vi.fn() } }));
vi.mock('./StoreSheet', () => ({ SHEET_TOP_LIMIT: 0, sheetBottomLimit: () => 0 }));
vi.mock('../systems/Daily', () => ({ todayISO: () => '2026-09-23' }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: () => Promise.resolve({ value: null }),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  },
}));

import { shiftISO } from '../core/CalendarDay';
import { milestoneFor } from '../core/Streak';
import { monetization } from '../config/monetization';
import type { DailyResult } from '../systems/Progress';
import { milestoneReward, streakSheetModel, streakTitle, type StreakSave, type StreakSheetEnv } from './StreakSheet';

/** A Wednesday. */
const TODAY = '2026-09-23';

const played: DailyResult = { ms: 48_000, deaths: 0, foldSense: 50 };

/** `n` days folded, ending `end` days before today (0 = today). */
function run(n: number, end: number): Record<string, DailyResult> {
  const out: Record<string, DailyResult> = {};
  for (let i = 0; i < n; i++) out[shiftISO(TODAY, -(end + i))] = played;
  return out;
}

function save(p: Partial<StreakSave> = {}): StreakSave {
  return { daily: {}, bookmarked: [], bookmarks: 0, lastRepair: '', ...p };
}

const AD: StreakSheetEnv = { rewardedAvailable: true, owner: false, permission: 'granted' };

/** Folded Sat–Mon, missed yesterday (Tue): one missed day after a 3-day run. */
const MISSED_YESTERDAY = save({ daily: run(3, 2) });

describe('streakSheetModel: the repair row', () => {
  it('offers the missed day, naming the ad and the streak it keeps', () => {
    const r = streakSheetModel(MISSED_YESTERDAY, TODAY, AD).repair;
    expect(r).not.toBeNull();
    expect(r?.day).toBe('2026-09-22');
    expect(r?.run).toBe(3);
    expect(r?.free).toBe(false);
    expect(r?.text).toMatch(/^Watch an ad → keep your \d+-day streak$/);
    expect(r?.text).toBe('Watch an ad → keep your 3-day streak');
  });

  it('is free, and says nothing of an ad, where no ad can play', () => {
    const r = streakSheetModel(MISSED_YESTERDAY, TODAY, { ...AD, rewardedAvailable: false }).repair;
    expect(r?.free).toBe(true);
    expect(r?.text).toBe('Keep your 3-day streak');
    expect(r?.text).not.toMatch(/ad/i);
  });

  it('is free for a Remove Ads owner even when an ad could play', () => {
    const r = streakSheetModel(MISSED_YESTERDAY, TODAY, { ...AD, owner: true }).repair;
    expect(r?.free).toBe(true);
    expect(r?.text).toBe('Keep your 3-day streak');
  });

  it('is not offered when a held bookmark covers the day anyway', () => {
    expect(streakSheetModel({ ...MISSED_YESTERDAY, bookmarks: 1 }, TODAY, AD).repair).toBeNull();
  });

  it('waits out the cooldown', () => {
    const recent = { ...MISSED_YESTERDAY, lastRepair: shiftISO(TODAY, -5) };
    expect(streakSheetModel(recent, TODAY, AD).repair).toBeNull();
    const long = { ...MISSED_YESTERDAY, lastRepair: shiftISO(TODAY, -monetization.economy.repair.cooldownDays) };
    expect(streakSheetModel(long, TODAY, AD).repair?.day).toBe('2026-09-22');
  });

  it('is not offered for a 1-day run, two missed days, or a run that is alive', () => {
    expect(streakSheetModel(save({ daily: run(1, 2) }), TODAY, AD).repair).toBeNull();
    expect(streakSheetModel(save({ daily: run(3, 3) }), TODAY, AD).repair).toBeNull();
    expect(streakSheetModel(save({ daily: run(3, 1) }), TODAY, AD).repair).toBeNull();
  });
});

/*
 * QA round 1 (D1, D3, UX-1): the repairable card opens this sheet, which had
 * no way into the Daily and said "No streak yet · Day 3 · a bookmark 0/3"
 * right above "keep your 12-day streak".
 */
describe('streakSheetModel: while a repair is offered', () => {
  const TWELVE = save({ daily: run(12, 2) });

  it('names the run it keeps, never a loss, and counts the next reward from it', () => {
    const m = streakSheetModel(TWELVE, TODAY, AD);
    expect(m.streak).toBe(0);
    expect(m.title).toBe('12-day streak · missed a day');
    expect(m.sub).toBe('keep it below, or start fresh today');
    expect(m.next).toEqual({ text: 'Day 14 · +3 reveals and a bookmark', have: 12, need: 14 });
    for (const line of [m.title, m.sub, m.next.text]) expect(line).not.toMatch(/No streak|lost|yet/);
  });

  it('leads with "Play today\'s fold" while today is still to fold', () => {
    expect(streakSheetModel(TWELVE, TODAY, AD).play).toBe(true);
    expect(streakSheetModel(TWELVE, TODAY, { ...AD, rewardedAvailable: false }).play).toBe(true);
  });

  it('once today is folded: still the run, which today joins; no Play', () => {
    const daily = { ...run(12, 2), [TODAY]: played };
    const m = streakSheetModel(save({ daily }), TODAY, AD);
    expect(m.streak).toBe(1);
    expect(m.repair?.text).toBe('Watch an ad → keep your 12-day streak');
    expect(m.title).toBe('12-day streak · missed a day');
    expect(m.sub).toBe("keep it below, and today's fold joins it");
    expect(m.next).toEqual({ text: 'Day 14 · +3 reveals and a bookmark', have: 13, need: 14 });
    expect(m.play).toBe(false);
  });

  it('offers no Play without a repair: the Daily card opens the Daily itself then', () => {
    expect(streakSheetModel(save({ daily: run(12, 1) }), TODAY, AD).play).toBe(false);
    expect(streakSheetModel(save({ daily: run(12, 4) }), TODAY, AD).play).toBe(false);
    expect(streakSheetModel(save(), TODAY, AD).play).toBe(false);
  });
});

describe('streakSheetModel: the rest of the card', () => {
  it('names the run, the best, and the next milestone with its progress', () => {
    const m = streakSheetModel(save({ daily: run(12, 1) }), TODAY, AD);
    expect(m.streak).toBe(12);
    expect(m.title).toBe('12-day streak');
    expect(m.sub).toBe('best 12 days');
    expect(m.next).toEqual({ text: 'Day 14 · +3 reveals and a bookmark', have: 12, need: 14 });
  });

  it('keeps an owner’s milestone to the bookmark: a reveal count means nothing there', () => {
    const m = streakSheetModel(save({ daily: run(12, 1) }), TODAY, { ...AD, owner: true });
    expect(m.next.text).toBe('Day 14 · a bookmark');
  });

  it('says "No streak yet" only to a player who never had one, and still points at the first reward', () => {
    const none = streakSheetModel(save(), TODAY, AD);
    expect(none.title).toBe('No streak yet');
    expect(none.sub).toBe('fold the Daily to start one');
    expect(none.next).toEqual({ text: 'Day 3 · a bookmark', have: 0, need: 3 });
    expect(streakTitle(1)).toBe('1-day streak');
  });

  it('asks a player whose run is over to start a new one, beside the best kept', () => {
    const broken = streakSheetModel(save({ daily: run(5, 4) }), TODAY, AD);
    expect(broken.title).toBe('Start a new streak');
    expect(broken.sub).toBe('best 5 days');
    expect(broken.next).toEqual({ text: 'Day 3 · a bookmark', have: 0, need: 3 });
  });

  it('says what a full bookmark shelf pays instead (§1.3), not a bigger count', () => {
    const m = streakSheetModel(save({ daily: run(12, 1), bookmarks: 2 }), TODAY, AD);
    expect(m.next).toEqual({ text: 'Day 14 · +3 reveals · bookmarks full, +1 reveal instead', have: 12, need: 14 });
    const week = streakSheetModel(save({ daily: run(19, 1), bookmarks: 2 }), TODAY, AD);
    expect(week.next.text).toBe('Day 21 · bookmarks full, +1 reveal instead');
  });

  it('counts the bookmarks held against the cap', () => {
    const m = streakSheetModel(save({ daily: run(4, 0), bookmarks: 1 }), TODAY, AD);
    expect(m.bookmarksLine).toBe(`Bookmarks 1 of ${monetization.economy.streak.bookmarkMax} · each covers a missed day`);
  });

  it('draws the last seven days, oldest first, with their weekday letters', () => {
    const m = streakSheetModel(save({ daily: run(2, 0) }), TODAY, AD);
    expect(m.letters).toEqual(['T', 'F', 'S', 'S', 'M', 'T', 'W']);
    expect(m.dots).toHaveLength(7);
    expect(m.dots[6]).toBe('today-done');
    expect(m.dots[5]).toBe('done');
    expect(m.dots[4]).toBe('missed');
  });

  it('offers "Remind me each day" only while the question is unanswered', () => {
    expect(streakSheetModel(save(), TODAY, { ...AD, permission: 'prompt' }).remind).toBe(true);
    expect(streakSheetModel(save(), TODAY, { ...AD, permission: 'granted' }).remind).toBe(false);
    expect(streakSheetModel(save(), TODAY, { ...AD, permission: 'denied' }).remind).toBe(false);
    // Still being asked: nothing is offered until iOS answers.
    expect(streakSheetModel(save(), TODAY, { ...AD, permission: null }).remind).toBe(false);
  });
});

describe('milestoneReward', () => {
  const STREAK = monetization.economy.streak;
  /** The milestone a day really pays, with `held` bookmarks already on the shelf. */
  const m = (day: number, held = 0) => {
    const got = milestoneFor(day, held, STREAK);
    if (!got) throw new Error(`day ${day} pays nothing`);
    return got;
  };
  it('says what the day pays, in the sheet’s words', () => {
    expect(milestoneReward(m(7), false)).toBe('+2 reveals and a bookmark');
    expect(milestoneReward(m(50), false)).toBe('+5 reveals');
    expect(milestoneReward(m(3), false)).toBe('a bookmark');
    expect(milestoneReward(m(21), false)).toBe('a bookmark');
  });
  it('names the overflow when the bookmarks are full, and keeps the day’s own count', () => {
    expect(milestoneReward(m(7, 2), false)).toBe('+2 reveals · bookmarks full, +1 reveal instead');
    expect(milestoneReward(m(14, 2), false)).toBe('+3 reveals · bookmarks full, +1 reveal instead');
    expect(milestoneReward(m(21, 2), false)).toBe('bookmarks full, +1 reveal instead');
    // A day that pays no bookmark has nothing to overflow.
    expect(milestoneReward(m(50, 2), false)).toBe('+5 reveals');
  });
  it('drops the reveal count for owners, keeping the bookmark', () => {
    expect(milestoneReward(m(7), true)).toBe('a bookmark');
    expect(milestoneReward(m(50), true)).toBe('');
    expect(milestoneReward(m(21, 2), true)).toBe('');
  });
});
