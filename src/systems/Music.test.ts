/*
 * The bed has to stay OUT OF THE WAY, and that is a claim about pitch, not
 * taste. The gameplay phrase climbs from C4 upward as rows are cleared; if a
 * pad ever lands in that register the player hears the game answering itself,
 * and if a voicing wanders off the pentatonic it clashes with every note the
 * game is about to play.
 *
 * Both are properties of `chordAt` alone, so they can be proved rather than
 * listened for.
 */
import { describe, expect, it } from 'vitest';
import { BAR_SECONDS, chordAt } from './Music';

/** The set Audio plays from. A pad outside it can clash by a semitone. */
const PENTATONIC = [0, 2, 4, 7, 9];

/** Reduce a signed semitone offset to its degree within the octave. */
const degree = (semi: number): number => ((semi % 12) + 12) % 12;

const BARS = Array.from({ length: 4000 }, (_, i) => i);

describe('the generated bed', () => {
  it('never plays a note the gameplay scale does not contain', () => {
    for (const bar of BARS) {
      for (const semi of chordAt(bar)) {
        expect(PENTATONIC, `bar ${bar} played ${semi}`).toContain(degree(semi));
      }
    }
  });

  /*
   * The gameplay phrase starts at C4, which is offset 0. Everything here must
   * sit strictly below that, or a pad and a cleared-row note collide on the
   * same pitch — the one thing that would make the bed sound like a mistake
   * rather than an accompaniment.
   */
  it('stays below the register the gameplay notes climb through', () => {
    for (const bar of BARS) {
      for (const semi of chordAt(bar)) {
        expect(semi, `bar ${bar}`).toBeLessThan(0);
      }
    }
  });

  it('anchors every bar on the root or the fifth', () => {
    for (const bar of BARS) {
      const degrees = chordAt(bar).map(degree);
      expect(degrees.includes(0) || degrees.includes(7), `bar ${bar}`).toBe(true);
    }
  });

  it('never doubles a pitch inside one bar', () => {
    for (const bar of BARS) {
      const voices = chordAt(bar);
      expect(new Set(voices).size, `bar ${bar}`).toBe(voices.length);
    }
  });

  /*
   * The whole reason this is generated rather than looped: there must be no
   * point at which the ear can start predicting. Received wisdom puts conscious
   * loop detection somewhere past 90 seconds, so an hour of play is the bar
   * that matters.
   */
  it('does not settle into a short cycle', () => {
    const anHour = Math.ceil(3600 / BAR_SECONDS);
    const seen = new Set(
      Array.from({ length: anHour }, (_, i) => chordAt(i).join(',')).values()
    );
    expect(seen.size).toBeGreaterThan(8);

    // And specifically: no period short enough to hear as a loop.
    for (const period of [1, 2, 3, 4, 6, 8, 12, 16]) {
      const repeats = Array.from({ length: 200 }, (_, i) =>
        chordAt(i).join(',') === chordAt(i + period).join(',')
      );
      expect(repeats.every(Boolean), `period ${period} repeated exactly`).toBe(false);
    }
  });

  it('gives the same bar the same voicing every time', () => {
    for (const bar of [0, 1, 7, 99, 1234]) {
      expect(chordAt(bar)).toEqual(chordAt(bar));
    }
  });

  /* Slow enough to be weather. Anything brisk becomes a melody to follow. */
  it('moves slowly enough to sit behind the game', () => {
    expect(BAR_SECONDS).toBeGreaterThanOrEqual(6);
  });
});
