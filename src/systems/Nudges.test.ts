/*
 * A reminder that repeats itself gets an app's notifications switched off, and
 * that is not recoverable — iOS shows the permission prompt once. The rotation
 * and the day arithmetic are therefore pinned here; the scheduling itself needs
 * a device and is not what goes wrong.
 */
import { describe, expect, it } from 'vitest';
import { HORIZON_DAYS, LINES, lineFor, localDayNumber, NUDGE_HOUR } from './Nudges';

describe('the lines', () => {
  it('are nine distinct messages', () => {
    expect(LINES).toHaveLength(9);
    expect(new Set(LINES.map((l) => l.title)).size).toBe(9);
    expect(new Set(LINES.map((l) => l.body)).size).toBe(9);
  });

  it('all say something', () => {
    for (const l of LINES) {
      expect(l.title.length, l.title).toBeGreaterThan(8);
      expect(l.body.length, l.body).toBeGreaterThan(20);
      // iOS truncates hard on the lock screen; a body nobody can read is noise.
      expect(l.title.length, l.title).toBeLessThan(45);
      expect(l.body.length, l.body).toBeLessThan(80);
    }
  });

  /*
   * The whole reason there are nine rather than one. A fortnight is the
   * scheduling horizon, so a fortnight is what must never repeat back to back.
   */
  it('never read the same on two days running, across a full horizon', () => {
    for (let d = 0; d < HORIZON_DAYS * 4; d++) {
      expect(lineFor(d).title, `day ${d}`).not.toBe(lineFor(d + 1).title);
    }
  });

  it('cycle rather than running out', () => {
    const seen = new Set(Array.from({ length: 9 }, (_, i) => lineFor(i).title));
    expect(seen.size).toBe(9);
    expect(lineFor(9).title).toBe(lineFor(0).title);
  });

  /* Day numbers come from a clock, and a clock can hand back anything. */
  it('survives a negative day number', () => {
    expect(() => lineFor(-1)).not.toThrow();
    expect(LINES.map((l) => l.title)).toContain(lineFor(-1).title);
  });
});

describe('the day number', () => {
  /*
   * LOCAL days, not UTC ones. The Daily Fold rolls over at the player's own
   * midnight, and a reminder that belongs to the wrong day is a reminder about
   * a maze they have already played.
   */
  it('changes at local midnight, not UTC midnight', () => {
    const lateEvening = new Date(2026, 7, 17, 23, 30);
    const justAfter = new Date(2026, 7, 18, 0, 30);
    expect(localDayNumber(justAfter) - localDayNumber(lateEvening)).toBe(1);
  });

  it('is stable across a single day', () => {
    const morning = new Date(2026, 7, 17, 6, 0);
    const night = new Date(2026, 7, 17, 22, 0);
    expect(localDayNumber(morning)).toBe(localDayNumber(night));
  });
});

describe('when they arrive', () => {
  it('is the evening, not the small hours', () => {
    expect(NUDGE_HOUR).toBeGreaterThanOrEqual(17);
    expect(NUDGE_HOUR).toBeLessThanOrEqual(21);
  });
});
