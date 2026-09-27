/*
 * The Missions sheet's rows and where each one leads — the decision, not the
 * drawing (Phaser, checked in the browser). §1.4: the Daily mission opens the
 * Daily, the campaign ones Continue, the medal and best-time ones Levels.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { GameObjects: { Container: class {}, Text: class {}, Events: { DESTROY: 'destroy' } } },
}));
vi.mock('./StoreSheet', () => ({ SHEET_TOP_LIMIT: 0, sheetBottomLimit: () => 0 }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: () => Promise.resolve({ value: null }),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  },
}));

import { missionCopy, type MissionId, type MissionState } from '../core/Missions';
import {
  MISSION_MARK_X,
  MISSION_TEXT_X,
  missionDoneLine,
  missionRoute,
  missionRows,
  missionRowStyle,
  missionStrip,
} from './MissionsSheet';
import { blend, contrast, glassOver, pt, theme, ui } from './Theme';
import { buttonSubAlpha } from './UI';

const state = (p: Partial<MissionState> = {}): MissionState => ({
  date: '2026-09-23',
  ids: ['daily', 'wins3', 'medal'],
  progress: [0, 1, 0],
  paid: [false, false, false],
  ...p,
});

describe('missionRoute', () => {
  it('sends each mission where it is done', () => {
    const table: Record<MissionId, string> = {
      daily: 'daily',
      wins3: 'continue',
      new2: 'continue',
      clean: 'continue',
      medal: 'levels',
      best: 'levels',
    };
    for (const [id, route] of Object.entries(table)) expect(missionRoute(id as MissionId)).toBe(route);
  });
});

describe('missionRows', () => {
  it('gives the full copy, the progress and what it pays, in slot order', () => {
    const rows = missionRows(state(), false);
    expect(rows.map((r) => r.id)).toEqual(['daily', 'wins3', 'medal']);
    expect(rows[0].text).toBe(missionCopy('daily').full);
    expect(rows[1]).toMatchObject({ sub: '1/3 · +1 reveal', done: false, progress: 1, target: 3 });
  });

  it('marks a finished mission done, paid or not yet', () => {
    const rows = missionRows(state({ progress: [1, 3, 0], paid: [true, false, false] }), false);
    expect(rows[0]).toMatchObject({ done: true, sub: 'done · +1 reveal' });
    expect(rows[1]).toMatchObject({ done: true, sub: 'done · +1 reveal', progress: 3 });
    expect(rows[2].done).toBe(false);
  });

  it('says ✓ to owners, never a reveal count', () => {
    const rows = missionRows(state({ progress: [1, 1, 0], paid: [true, false, false] }), true);
    expect(rows[0].sub).toBe('done ✓');
    expect(rows[1].sub).toBe('1/3');
    for (const r of rows) expect(r.sub).not.toMatch(/reveal/);
  });

  it('clamps hostile progress instead of drawing it', () => {
    const hostile = state({
      progress: [Number.NaN, 99, -4] as unknown as MissionState['progress'],
      paid: ['yes', false, false] as unknown as MissionState['paid'],
    });
    const rows = missionRows(hostile, false);
    expect(rows[0]).toMatchObject({ done: false, progress: 0, sub: '0/1 · +1 reveal' });
    expect(rows[1]).toMatchObject({ done: true, progress: 3 });
    expect(rows[2]).toMatchObject({ done: false, progress: 0, sub: '0/1 · +1 reveal' });
    for (const r of rows) expect(Number.isFinite(r.progress)).toBe(true);
  });
});

/*
 * QA round 1: finished rows looked like open ones, the text was centred beside
 * a mark on the left, and nothing said an open row could be tapped.
 */
describe('missionRowStyle', () => {
  it('draws an open row as a door: the quiet face, a chevron, tappable', () => {
    expect(missionRowStyle({ done: false })).toEqual({
      face: true,
      chevron: true,
      tappable: true,
      alpha: 1,
      sub: { gold: false, alpha: buttonSubAlpha('secondary') },
    });
  });

  it('draws a done row as a record: no face, 0.7, gold at full strength, not tappable', () => {
    expect(missionRowStyle({ done: true })).toEqual({
      face: false,
      chevron: false,
      tappable: false,
      alpha: 0.7,
      sub: { gold: true, alpha: 1 },
    });
  });

  it('keeps every second line at 4.5:1 on the ground it is drawn on', () => {
    const t = theme();
    const u = ui();
    // Done: gold on the sheet itself, no face under it.
    expect(contrast(t.medalText, u.sheet, missionRowStyle({ done: true }).sub.alpha)).toBeGreaterThanOrEqual(4.5);
    // Open: the foreground on the secondary face — smoked glass over the opaque sheet.
    const face = glassOver(u.sheet);
    expect(contrast(t.ink, face, missionRowStyle({ done: false }).sub.alpha)).toBeGreaterThanOrEqual(4.5);
    // The title of a done row, receded to 0.7 of 0.94.
    expect(contrast(t.ink, u.sheet, 0.94 * missionRowStyle({ done: true }).alpha)).toBeGreaterThanOrEqual(4.5);
  });

  it('starts the text pt(14) past the mark', () => {
    expect(MISSION_TEXT_X - MISSION_MARK_X).toBe(pt(14));
  });
});

/*
 * QA round 1: a bare "Mission done" on launch had no referent. Named where it
 * can only be one mission.
 */
describe('missionDoneLine', () => {
  it('names the one mission paid', () => {
    const s = state({ progress: [1, 0, 0], paid: [true, false, false] });
    expect(missionDoneLine(s, 1)).toBe("Mission done · fold today's Daily · +1 reveal");
    const medal = state({ progress: [0, 1, 1], paid: [false, false, true] });
    expect(missionDoneLine(medal, 1)).toBe('Mission done · earn two stars on any fold · +1 reveal');
  });

  it('keeps the plain line where it cannot tell which one', () => {
    const two = state({ progress: [1, 3, 0], paid: [true, true, false] });
    expect(missionDoneLine(two, 1)).toBe('Mission done · +1 reveal');
    expect(missionDoneLine(null, 1)).toBe('Mission done · +1 reveal');
    expect(missionDoneLine(two, 2)).toBe('2 missions done · +2 reveals');
  });
});


/*
 * SPEC §5.1: the menu's strip — three rings with two short lines each, then
 * the day's gift. The gift is what the missions pay and nothing more (no new
 * reveal grants): the reveals still to earn, and the day's whole pay once lit.
 */
describe('missionStrip', () => {
  it('names each mission short, with where it stands', () => {
    const { items } = missionStrip(state({ ids: ['daily', 'new2', 'medal'], progress: [0, 1, 1], paid: [false, false, true] }), false);
    expect(items.map((i) => [i.label, i.sub, i.done])).toEqual([
      ['Daily', 'not yet', false],
      ['2 new', '1 of 2', false],
      ['Two stars', 'done', true],
    ]);
    expect(items[1].frac).toBe(0.5);
  });

  it('gifts what the open missions still pay, and lights with the whole day once all have paid', () => {
    expect(missionStrip(state(), false).gift).toEqual({ text: '+3', lit: false });
    expect(missionStrip(state({ progress: [1, 1, 0], paid: [true, false, false] }), false).gift).toEqual({
      text: '+2',
      lit: false,
    });
    const all = state({ progress: [1, 3, 1], paid: [true, true, true] });
    expect(missionStrip(all, false).gift).toEqual({ text: '+3', lit: true });
  });

  it('has no gift for an owner: unlimited reveals have no count to add to', () => {
    expect(missionStrip(state(), true).gift).toBeNull();
  });

  it('keeps its words and its gift readable on the strip', () => {
    const t = theme();
    const u = ui();
    // The strip is glass over the sky: its captions at text3, the gift's reward in ember on its wash.
    const strip = glassOver(u.sky);
    expect(contrast(u.text3, strip)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(u.text2, strip)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accentText, blend(t.accent, 0.12, strip))).toBeGreaterThanOrEqual(4.5);
    // Lit: the dark ink on the full accent.
    expect(contrast(u.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
