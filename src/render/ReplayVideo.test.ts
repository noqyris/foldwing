/**
 * The replay is the growth loop, and the two things that decide whether anyone
 * watches it to the end are pure functions: where the line had got to at a
 * given moment, and how long each part of the clip runs. Both are tested here
 * without a canvas, because neither needs one and a canvas test would only
 * prove that the browser can draw.
 *
 * The encoder itself is not tested. It is WebCodecs talking to VideoToolbox,
 * absent from this environment, and a mock of it would assert that the mock
 * was called.
 */

import { describe, expect, it } from 'vitest';
import { buildTimeline, outroStage, timelineDurationMs, type RunAttempt } from './ReplayVideo';
import { strokeUpTo } from './FigureCard';

const attempt = (ms: number, died: boolean): RunAttempt => ({
  points: [
    { x: 0.4, y: 0.9 },
    { x: 0.4, y: 0.5 },
    { x: 0.4, y: 0.1 },
  ],
  times: [0, ms / 2, ms],
  died,
});

describe('the stroke, part-way through', () => {
  const stroke = {
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ],
    times: [0, 100, 200],
  };

  it('gives back the whole line once the run is over', () => {
    expect(strokeUpTo(stroke, 200)).toBe(stroke);
    expect(strokeUpTo(stroke, 5000)).toBe(stroke);
  });

  it('starts at the first point rather than at nothing', () => {
    const s = strokeUpTo(stroke, 0);
    expect(s.points).toEqual([{ x: 0, y: 0 }]);
  });

  /*
   * The tip is interpolated, not snapped to the last sample. Samples land every
   * few pixels of TRAVEL, so a fast stretch leaves long gaps — snapping would
   * jump those in visible steps while the slow stretches crawled, which is
   * exactly backwards from what the recorded timing says happened.
   */
  it('puts the tip between samples, not on the last one', () => {
    const s = strokeUpTo(stroke, 150);
    expect(s.points).toHaveLength(3);
    expect(s.points[2]).toEqual({ x: 15, y: 0 });
    expect(s.times[2]).toBe(150);
  });

  it('advances smoothly rather than in sample-sized steps', () => {
    const tips = [110, 120, 130, 140].map((ms) => {
      const s = strokeUpTo(stroke, ms);
      return s.points[s.points.length - 1].x;
    });
    expect(tips).toEqual([11, 12, 13, 14]);
  });

  it('survives two samples sharing a millisecond', () => {
    const flat = { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], times: [0, 0] };
    expect(() => strokeUpTo(flat, 0)).not.toThrow();
  });

  it('has nothing to draw for an empty stroke', () => {
    expect(strokeUpTo({ points: [], times: [] }, 100).points).toEqual([]);
  });
});

describe('the clip timeline', () => {
  it('ends on the win, settling, and then the footer', () => {
    const phases = buildTimeline([attempt(3000, true), attempt(4000, false)]);
    const kinds = phases.map((p) => p.kind);
    expect(kinds[0]).toBe('intro');
    expect(kinds.slice(-3)).toEqual(['draw', 'settle', 'outro']);
  });

  it('leaves no gap or overlap between phases', () => {
    const phases = buildTimeline([attempt(2000, true), attempt(900, true), attempt(5000, false)]);
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i].startMs).toBe(phases[i - 1].startMs + phases[i - 1].durationMs);
    }
    expect(timelineDurationMs(phases)).toBeGreaterThan(0);
  });

  /*
   * Failures are context, not the subject. A clip that spends eight seconds on
   * somebody else's mistakes is a clip nobody finishes — so a death always
   * plays faster than it happened, and is capped however long it really took.
   */
  it('plays the misses fast and the winning line at its real speed', () => {
    const phases = buildTimeline([attempt(4000, true), attempt(4000, false)]);
    const draws = phases.filter((p) => p.kind === 'draw');
    expect(draws).toHaveLength(2);
    expect(draws[0].durationMs).toBeLessThan(4000);
    expect(draws[0].speed).toBeGreaterThan(1);
    expect(draws[1].durationMs).toBe(4000);
    expect(draws[1].speed).toBeCloseTo(1, 5);
  });

  it('stretches a win too fast to read and reins in one too slow to watch', () => {
    const quick = buildTimeline([attempt(300, false)]).find((p) => p.kind === 'draw')!;
    expect(quick.durationMs).toBeGreaterThanOrEqual(1200);
    expect(quick.speed).toBeLessThan(1);

    const slow = buildTimeline([attempt(40_000, false)]).find((p) => p.kind === 'draw')!;
    expect(slow.durationMs).toBeLessThanOrEqual(8000);
    expect(slow.speed).toBeGreaterThan(1);
  });

  /*
   * A death that lasted a fifth of a second still has to be visible. Without a
   * floor the draw phase rounds to a frame or two and the miss reads as a
   * flicker rather than as an attempt.
   */
  it('never lets a miss fall below a readable length', () => {
    const phases = buildTimeline([attempt(60, true), attempt(2000, false)]);
    expect(phases.filter((p) => p.kind === 'draw')[0].durationMs).toBeGreaterThanOrEqual(220);
  });

  it('keeps a whole run watchable end to end', () => {
    const run = [...Array(5)].map(() => attempt(3500, true));
    run.push(attempt(6000, false));
    const total = timelineDurationMs(buildTimeline(run));
    // Long enough to tell the story, short enough that it gets watched.
    expect(total).toBeGreaterThan(6000);
    expect(total).toBeLessThan(20_000);
  });

  it('handles a level cleared first try', () => {
    const phases = buildTimeline([attempt(2500, false)]);
    expect(phases.map((p) => p.kind)).toEqual(['intro', 'draw', 'settle', 'outro']);
  });
});

/*
 * The closing sequence is the part a stranger sees last, and the only part
 * asking them for anything. Its order is the whole design: what this was, then
 * the mark folding open, then the dare — and nothing arrives before the thing
 * above it has.
 */
describe('the closing sequence', () => {
  it('starts with nothing shown', () => {
    expect(outroStage(0)).toEqual({ caption: 0, mark: 0, fold: 0, challenge: 0 });
  });

  it('reveals in order and never runs one element ahead of the last', () => {
    for (let ms = 0; ms <= 4000; ms += 40) {
      const s = outroStage(ms);
      expect(s.caption).toBeGreaterThanOrEqual(s.mark);
      expect(s.mark).toBeGreaterThanOrEqual(s.fold);
      expect(s.fold).toBeGreaterThanOrEqual(s.challenge);
    }
  });

  it('never leaves an element part-way once the clip is holding', () => {
    const held = outroStage(4000);
    expect(held.caption).toBe(1);
    expect(held.mark).toBe(1);
    expect(held.fold).toBe(1);
    expect(held.challenge).toBe(1);
  });

  it('keeps every element inside 0..1 at every moment', () => {
    for (let ms = -500; ms <= 6000; ms += 37) {
      for (const v of Object.values(outroStage(ms))) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  /*
   * The mark has to be fully set before its reflection begins to swing down.
   * A word still fading in while it folds reads as a glitch rather than as a
   * crease.
   */
  it('sets the word before folding it', () => {
    for (let ms = 0; ms <= 4000; ms += 20) {
      const s = outroStage(ms);
      if (s.fold > 0) expect(s.mark).toBe(1);
    }
  });

  it('holds the finished frame long enough to be read', () => {
    const phases = buildTimeline([{ points: [], times: [0, 2000], died: false }]);
    const outro = phases[phases.length - 1];
    expect(outro.kind).toBe('outro');
    // Everything is revealed with time to spare before the clip ends.
    expect(outro.durationMs).toBeGreaterThan(2500);
  });
});
