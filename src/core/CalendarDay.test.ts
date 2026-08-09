import { describe, expect, it } from 'vitest';
import { daysBetween, ISO_DATE, shiftISO, todayISO } from './CalendarDay';

/*
 * Run a block with the machine pinned to a named timezone, then put the real
 * one back.
 *
 * Everything interesting about this module is invisible at offset zero: "the
 * local date wins" and "the UTC date wins" are the same sentence in a UTC test
 * box, and a DST step is not a step at all in a zone that has no DST. So the
 * tests that depend on a zone name one instead of trusting whatever the
 * developer's laptop or CI runner happens to be set to.
 *
 * The restore matters. Vitest reuses a worker process across test files, so a
 * leaked TZ would silently re-time every suite that ran after this one.
 */
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

describe('todayISO', () => {
  it('takes the local date even when UTC has already moved on', () => {
    // New York runs behind UTC: at 23:00 on the 9th, Greenwich already says
    // the 10th. This is the bug the module was written to end — the player
    // folding late on a Sunday evening is still owed Sunday's fold, and used
    // to be told a new one had landed while they were still playing the old.
    inZone('America/New_York', () => {
      const lateEvening = new Date(2026, 7, 9, 23, 0);
      expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-08-10');
      expect(todayISO(lateEvening)).toBe('2026-08-09');
    });
  });

  it('takes the local date even when UTC has not caught up', () => {
    // Auckland runs ahead: at 01:00 on the 9th, Greenwich still says the 8th.
    // The other direction of the same mistake, and the one that would hand a
    // player yesterday's fold for the first half of their morning.
    inZone('Pacific/Auckland', () => {
      const justAfterMidnight = new Date(2026, 7, 9, 1, 0);
      expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-08-08');
      expect(todayISO(justAfterMidnight)).toBe('2026-08-09');
    });
  });

  it('holds the local date across the turn of the year', () => {
    inZone('America/New_York', () => {
      const newYearsEve = new Date(2026, 11, 31, 23, 59);
      expect(newYearsEve.toISOString().slice(0, 10)).toBe('2027-01-01');
      expect(todayISO(newYearsEve)).toBe('2026-12-31');
    });
  });

  it('pads month and day so the strings sort as dates', () => {
    // Save keys, streak arithmetic and the daily cache all compare these as
    // plain strings; an unpadded '2026-9-5' would sort before '2026-12-01'.
    expect(todayISO(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    expect(todayISO(new Date(2026, 8, 5, 12, 0))).toBe('2026-09-05');
    expect(todayISO(new Date(2026, 11, 25, 12, 0))).toBe('2026-12-25');
  });

  it('reads the clock when handed no date, in the shape everything else expects', () => {
    expect(ISO_DATE.test(todayISO())).toBe(true);
  });
});

describe('shiftISO', () => {
  it('steps whole days in both directions', () => {
    expect(shiftISO('2026-08-09', 1)).toBe('2026-08-10');
    expect(shiftISO('2026-08-09', -1)).toBe('2026-08-08');
    expect(shiftISO('2026-08-09', 0)).toBe('2026-08-09');
    expect(shiftISO('2026-08-09', 7)).toBe('2026-08-16');
  });

  it('crosses month ends, including a leap February', () => {
    expect(shiftISO('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftISO('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftISO('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftISO('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftISO('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('crosses the turn of the year', () => {
    expect(shiftISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftISO('2027-01-01', -1)).toBe('2026-12-31');
    // 2027 is not a leap year, so a full 365 lands on the same date again.
    expect(shiftISO('2026-12-31', 365)).toBe('2027-12-31');
    expect(shiftISO('2026-12-31', 366)).toBe('2028-01-01');
  });

  it('is unmoved by a DST transition', () => {
    // America/New_York springs forward on 2026-03-08 and falls back on
    // 2026-11-01. Stepping in local time would add 86400000 ms to a 23-hour
    // day and land at 23:00 on the date it started from, so the streak would
    // read the same day twice in spring and skip one in autumn. Stepping in
    // UTC has no such discontinuity, which is why the function does.
    inZone('America/New_York', () => {
      expect(shiftISO('2026-03-07', 1)).toBe('2026-03-08');
      expect(shiftISO('2026-03-08', 1)).toBe('2026-03-09');
      expect(shiftISO('2026-03-09', -1)).toBe('2026-03-08');
      expect(shiftISO('2026-10-31', 1)).toBe('2026-11-01');
      expect(shiftISO('2026-11-01', 1)).toBe('2026-11-02');
      expect(shiftISO('2026-11-02', -1)).toBe('2026-11-01');
    });
  });

  it('does not drift over a walk that spans both DST transitions', () => {
    // A streak is built one day at a time, so single steps are the way this
    // is actually used. Four hundred of them must land exactly where one
    // four-hundred-day step lands, or a long run would slowly desynchronise
    // from the dates the saves are keyed by.
    inZone('America/New_York', () => {
      let walked = '2026-01-01';
      for (let i = 0; i < 400; i++) walked = shiftISO(walked, 1);
      expect(walked).toBe(shiftISO('2026-01-01', 400));
      expect(walked).toBe('2027-02-05');
    });
  });
});

describe('daysBetween', () => {
  it('is signed, and the same size in either direction', () => {
    expect(daysBetween('2026-08-09', '2026-08-12')).toBe(3);
    expect(daysBetween('2026-08-12', '2026-08-09')).toBe(-3);
    expect(daysBetween('2026-08-09', '2026-08-09')).toBe(0);
  });

  it('inverts shiftISO for any offset', () => {
    // Zero is left out only because negating it gives -0, which Object.is
    // calls a different value; the same-day case is covered above.
    for (const days of [-400, -31, -1, 1, 30, 365]) {
      const then = shiftISO('2026-08-09', days);
      expect(daysBetween('2026-08-09', then), `${days} days did not round-trip`).toBe(days);
      expect(daysBetween(then, '2026-08-09')).toBe(-days);
    }
  });

  it('counts calendar days across a year, leap or not', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
  });

  it('counts a DST week as whole days, not as 23- and 25-hour ones', () => {
    // The rounding in the implementation is load-bearing rather than
    // cosmetic: an hour of DST slop must never round up into a day, because
    // the streak treats a gap of two as a broken run.
    inZone('America/New_York', () => {
      expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
      expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    });
  });
});

describe('ISO_DATE', () => {
  it('accepts a zero-padded calendar date', () => {
    expect(ISO_DATE.test('2026-08-09')).toBe(true);
  });

  it('rejects the shapes that arrive from hand-editing and from other systems', () => {
    for (const bad of [
      '2026-8-9',
      'garbage',
      '20260809',
      '',
      '2026-08-09T00:00:00Z',
      '26-08-09',
      ' 2026-08-09',
      '2026-08-09 ',
    ]) {
      expect(ISO_DATE.test(bad), `'${bad}' was accepted as a date`).toBe(false);
    }
  });

  it('accepts everything this module produces', () => {
    expect(ISO_DATE.test(todayISO())).toBe(true);
    for (const days of [-400, -1, 0, 1, 400]) {
      expect(ISO_DATE.test(shiftISO('2026-08-09', days))).toBe(true);
    }
  });

  it('checks the shape only, and says nothing about whether the date exists', () => {
    // Documented on purpose. Callers reading dates back out of a save must
    // not treat a match as proof the date is real; the thirteenth month gets
    // through, and only parsing would catch it.
    expect(ISO_DATE.test('2026-13-45')).toBe(true);
  });
});
