/*
 * The session's age decides when the first interstitial may come and when the
 * tighter floor takes over, so an age that runs while the phone is locked
 * hands the heaviest pacing to a player who has barely played. Every
 * timestamp is passed in, so each case here is spelled out in seconds and
 * runs the same on any clock.
 *
 * Whether a return STARTS a new session is not this clock's call any more —
 * core/Session.test.ts pins the rule, SessionLifecycle.test.ts the service, and
 * Ads.test.ts drives both through the real listeners. Here a new session is
 * simply `start()`.
 */
import { describe, expect, it } from 'vitest';
import { monetization } from '../config/monetization';
import { SessionClock } from './SessionClock';

const A = monetization.ads;

/** An arbitrary but plausible epoch, and seconds after it. */
const T0 = Date.parse('2026-09-26T10:00:00Z');
const s = (seconds: number): number => T0 + seconds * 1000;

/** A clock started with the page on screen at T0. */
const playing = (): SessionClock => {
  const clock = new SessionClock();
  clock.start(s(0), true);
  return clock;
};

describe('the session clock', () => {
  it('counts from zero while the page is on screen', () => {
    const clock = playing();
    expect(clock.ageSeconds(s(0))).toBe(0);
    expect(clock.ageSeconds(s(90))).toBe(90);
    // A read is only a read.
    expect(clock.ageSeconds(s(90))).toBe(90);
  });

  /*
   * The owner's example, and the reason this module exists: on the wall clock
   * this player read as 21 minutes in — warm-up skipped, and past the
   * long-session mark, so the tighter floor applied.
   */
  it('does not count a 20-minute lock after one minute of play', () => {
    const clock = playing();
    clock.hide(s(60));
    expect(clock.ageSeconds(s(60 + 20 * 60))).toBe(60);

    clock.show(s(60 + 20 * 60));
    expect(clock.ageSeconds(s(60 + 20 * 60))).toBe(60);
    // The warm-up is still armed, and the late floor nowhere near.
    expect(clock.ageSeconds(s(60 + 20 * 60))).toBeLessThan(A.sessionWarmupSeconds);
    expect(clock.ageSeconds(s(60 + 20 * 60))).toBeLessThan(A.longSessionAfterSeconds);

    // And it resumes from there.
    expect(clock.ageSeconds(s(60 + 20 * 60 + 30))).toBe(90);
  });

  it('resumes after any absence — however long — until it is started again', () => {
    const clock = playing();
    clock.hide(s(120));
    clock.show(s(120 + 5 * 3600));
    expect(clock.ageSeconds(s(120 + 5 * 3600))).toBe(120);
    // The new session, when the app's rule says there is one.
    clock.start(s(120 + 5 * 3600), true);
    expect(clock.ageSeconds(s(120 + 5 * 3600 + 45))).toBe(45);
  });

  it('adds up several short absences without counting any of them', () => {
    const clock = playing();
    clock.hide(s(100));
    clock.show(s(400));
    clock.hide(s(450));
    clock.show(s(1000));
    expect(clock.ageSeconds(s(1010))).toBe(100 + 50 + 10);
  });

  it('restarts the age when the session is started again — the SDK-ready re-stamp', () => {
    const clock = playing();
    expect(clock.ageSeconds(s(40))).toBe(40);
    clock.start(s(40), true);
    expect(clock.ageSeconds(s(40))).toBe(0);
    expect(clock.ageSeconds(s(100))).toBe(60);
  });

  /*
   * The SDK can settle with the app in the background: the player left while
   * the network was slow. The session begins at age zero, and stays there
   * until they are back.
   */
  it('holds a session started in the background at zero until the page returns', () => {
    const clock = playing();
    clock.hide(s(30));
    clock.start(s(60), false);
    expect(clock.ageSeconds(s(600))).toBe(0);

    clock.show(s(600));
    expect(clock.ageSeconds(s(600))).toBe(0);
    expect(clock.ageSeconds(s(700))).toBe(100);
  });

  it('holds a restart told "hidden" at zero even if no hide was ever reported', () => {
    const clock = playing();
    clock.start(s(50), false);
    expect(clock.ageSeconds(s(500))).toBe(0);
    clock.show(s(500));
    expect(clock.ageSeconds(s(520))).toBe(20);
  });

  it('counts nothing on a cold launch that starts in the background', () => {
    const clock = new SessionClock();
    clock.start(s(0), false);
    expect(clock.ageSeconds(s(299))).toBe(0);

    clock.show(s(300));
    expect(clock.ageSeconds(s(360))).toBe(60);
  });

  it('reads zero, not a guess, before it has been started', () => {
    const clock = new SessionClock();
    expect(clock.ageSeconds(s(500))).toBe(0);
    clock.show(s(500));
    expect(clock.ageSeconds(s(507))).toBe(7);
  });

  /*
   * visibilitychange is a DOM event, and the webview does not promise it
   * alternates. A repeated hide must not bank the stretch twice; a repeated
   * show must not throw the stretch away.
   */
  it('ignores a second hide in a row', () => {
    const clock = playing();
    clock.hide(s(100));
    clock.hide(s(100 + 20 * 60));
    expect(clock.ageSeconds(s(100 + 25 * 60))).toBe(100);
  });

  it('ignores a second show in a row', () => {
    const clock = playing();
    clock.hide(s(100));
    clock.show(s(200));
    clock.show(s(260));
    expect(clock.ageSeconds(s(300))).toBe(100 + 100);
  });

  describe('with a clock that goes backwards', () => {
    it('banks nothing, rather than a negative stretch', () => {
      const clock = playing();
      clock.hide(s(100));
      clock.show(s(200));
      clock.hide(s(150)); // set back 50 s while on screen
      expect(clock.ageSeconds(s(150))).toBe(100);
    });

    it('never reads younger than what is banked', () => {
      const clock = playing();
      clock.hide(s(100));
      clock.show(s(200));
      expect(clock.ageSeconds(s(120))).toBe(100);
      expect(clock.ageSeconds(s(0))).toBe(100);
    });

    it('never reads below zero right after a start', () => {
      const clock = playing();
      expect(clock.ageSeconds(s(-60))).toBe(0);
    });
  });
});
