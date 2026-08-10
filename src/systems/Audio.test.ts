import { describe, expect, it } from 'vitest';
import { semitone } from './Audio';

const ROOT_HZ = 261.63;
const hz = (step: number): number => ROOT_HZ * Math.pow(2, semitone(step) / 12);

/*
 * One note per obstacle row crossed alive, climbing as the player gets further
 * up the maze. The ladder used to climb without a ceiling, and the level set
 * does not cooperate: a shipped level has a median of 21 rows and as many as
 * 33. Step 20 was 4186 Hz with its "shine" partial at 8372 Hz, and step 32
 * asked the oscillator for about 21 kHz — so the reward for finally clearing a
 * hard level was the most piercing sound in the game.
 */
describe('the note ladder', () => {
  it('starts on the root', () => {
    expect(semitone(0)).toBe(0);
    expect(hz(0)).toBeCloseTo(ROOT_HZ, 2);
  });

  it('climbs for the first few rows, which is the whole point', () => {
    for (let i = 1; i < 15; i++) {
      expect(semitone(i), `step ${i} did not rise`).toBeGreaterThan(semitone(i - 1));
    }
  });

  it('stays inside the register a phone speaker can play, at every level size', () => {
    // 33 is the largest gate count in the shipped set; go well past it.
    for (let step = 0; step <= 60; step++) {
      const f = hz(step);
      expect(f, `step ${step} is ${Math.round(f)} Hz`).toBeLessThan(1800);
      // The renderer adds a partial an octave up, so the fundamental has to
      // leave room for it too.
      expect(f * 2, `step ${step} shine partial`).toBeLessThan(3600);
    }
  });

  it('rolls the phrase over instead of walking out of the range', () => {
    // Three octaves of a five-note scale, then back to the root.
    expect(semitone(15)).toBe(semitone(0));
    expect(semitone(16)).toBe(semitone(1));
  });

  it('only ever plays notes from the pentatonic scale', () => {
    const allowed = new Set([0, 2, 4, 7, 9]);
    for (let step = 0; step <= 60; step++) {
      expect(allowed.has(semitone(step) % 12), `step ${step}`).toBe(true);
    }
  });
});
