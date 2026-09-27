/**
 * What counts as a session (mobile-game-playbook): a cold launch, OR a return
 * after 30 minutes or more, OR a return into a new local day. Each rule here
 * is pinned so that deleting it fails a test. Day keys are core/CalendarDay's
 * `todayISO`, the key the streak uses; the suite runs in Europe/Belgrade.
 */
import { describe, expect, it } from 'vitest';
import { todayISO } from './CalendarDay';
import { isNewSessionOnReturn, onHidden, onVisible, SESSION_GAP_MS } from './Session';

const MIN = 60_000;
/** 2026-09-27 12:00 local. */
const NOON = new Date(2026, 8, 27, 12, 0).getTime();
const DAY = todayISO(new Date(NOON));

describe('a return from the background', () => {
  it('is a new session after 30 minutes — the gap is exactly half an hour', () => {
    expect(SESSION_GAP_MS).toBe(30 * MIN);
  });

  it('is a new session at 30 minutes on the same day, and not a millisecond before', () => {
    expect(isNewSessionOnReturn({ hiddenAtMs: NOON, hiddenDay: DAY, nowMs: NOON + 30 * MIN, today: DAY })).toBe(true);
    expect(isNewSessionOnReturn({ hiddenAtMs: NOON, hiddenDay: DAY, nowMs: NOON + 30 * MIN - 1, today: DAY })).toBe(
      false
    );
    expect(isNewSessionOnReturn({ hiddenAtMs: NOON, hiddenDay: DAY, nowMs: NOON + 5 * 60 * MIN, today: DAY })).toBe(true);
  });

  /*
   * The midnight clause. 23:58 → 00:03 is five minutes, and a new session: the
   * night's player is back on a new day, whatever the clock between says.
   */
  it('is a new session when it lands on a new local day, however short the pause', () => {
    const late = new Date(2026, 8, 27, 23, 58).getTime();
    const back = late + 5 * MIN;
    expect(todayISO(new Date(back))).not.toBe(todayISO(new Date(late)));
    expect(
      isNewSessionOnReturn({
        hiddenAtMs: late,
        hiddenDay: todayISO(new Date(late)),
        nowMs: back,
        today: todayISO(new Date(back)),
      })
    ).toBe(true);
  });

  it('is not a pause when the clock was set back within the same day', () => {
    expect(isNewSessionOnReturn({ hiddenAtMs: NOON, hiddenDay: DAY, nowMs: NOON - 3 * 60 * MIN, today: DAY })).toBe(
      false
    );
  });

  it('is not a pause when the stamp is not a number — but a new day still is', () => {
    expect(isNewSessionOnReturn({ hiddenAtMs: Number.NaN, hiddenDay: DAY, nowMs: NOON, today: DAY })).toBe(false);
    expect(isNewSessionOnReturn({ hiddenAtMs: NOON, hiddenDay: DAY, nowMs: Number.NaN, today: DAY })).toBe(false);
    expect(isNewSessionOnReturn({ hiddenAtMs: Number.NaN, hiddenDay: DAY, nowMs: NOON, today: '2026-09-28' })).toBe(true);
  });
});

describe('the hidden stamp', () => {
  it('keeps the FIRST hide of a pause — a second hide must not move it', () => {
    const first = onHidden(null, NOON, DAY);
    expect(first).toEqual({ atMs: NOON, day: DAY });
    const again = onHidden(first, NOON + 29 * MIN, DAY);
    expect(again).toBe(first);
    // Measured from the first hide: 31 minutes, a new session. From the second
    // it would have been two.
    expect(onVisible(again, NOON + 31 * MIN, DAY).newSession).toBe(true);
  });

  it('keeps the day of the first hide too', () => {
    const first = onHidden(null, NOON, DAY);
    const again = onHidden(first, NOON + MIN, '2026-09-28');
    expect(again.day).toBe(DAY);
  });

  it('a visible with no hide before it is not a pause, however late it comes', () => {
    expect(onVisible(null, NOON + 10 * 60 * MIN, '2026-10-09')).toEqual({ stamp: null, newSession: false });
  });

  it('a short return is not a new session, and it clears the stamp', () => {
    const r = onVisible(onHidden(null, NOON, DAY), NOON + MIN, DAY);
    expect(r).toEqual({ stamp: null, newSession: false });
  });
});
