import { describe, expect, it, vi } from 'vitest';
import { dailyLevel, dailySeed, dailyT, MAX_CANDIDATES, SEED_STRIDE, todayISO } from './Daily';
import { Playfield } from '../core/Playfield';
import {
  interlock,
  MIN_DECOY,
  MIN_INTERLOCK,
  MIN_WINDING,
  PLAYABLE_CLEARANCE,
  routeArc,
  validateLevel,
} from '../core/LevelValidator';
import { makeCandidate, type MazeCandidate } from '../core/MazeGen';
import { shiftISO } from '../core/CalendarDay';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';
import { Progress } from './Progress';
import type { Level } from '../data/types';

const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
const OPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };

describe('the daily fold', () => {
  /*
   * Determinism IS the feature: there is no server, so "everyone plays the
   * same maze today" holds only if the same date computes the same level on
   * every device, every time.
   */
  it('computes the identical level for the same date', () => {
    const a = dailyLevel('2026-08-07');
    const b = dailyLevel('2026-08-07');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.id).toBe('d2026-08-07');
    expect(a.name).toBe('Daily fold');
  });

  it('computes different mazes on different days', () => {
    const a = dailyLevel('2026-08-07');
    const b = dailyLevel('2026-08-08');
    expect(JSON.stringify(a.walls)).not.toBe(JSON.stringify(b.walls));
  });

  it('is proved playable with room for a hand, like every shipped level', () => {
    for (const date of ['2026-08-07', '2026-08-08', '2026-12-25']) {
      const level = dailyLevel(date);
      const r = validateLevel(level, pf, {
        ...OPTS,
        hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
      });
      expect(r.solvable, `${date} shipped an unplayable daily`).toBe(true);
    }
  });

  it('carries a par for the win verdict', () => {
    const level = dailyLevel('2026-08-07');
    expect(level.parPx).toBeGreaterThan(0);
  });

  it('keeps the difficulty dial mid-to-hard', () => {
    for (const date of ['2026-01-01', '2026-06-15', '2027-03-09']) {
      const t = dailyT(date);
      expect(t).toBeGreaterThanOrEqual(0.5);
      expect(t).toBeLessThanOrEqual(0.8);
    }
  });

  it('derives the seed from the date alone', () => {
    expect(dailySeed('2026-08-07')).toBe(20260807);
  });

  it('formats today as a local ISO date', () => {
    expect(todayISO(new Date(2026, 7, 7, 23, 59))).toBe('2026-08-07');
    expect(todayISO(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

/*
 * A spread rather than a single date, because the daily is not one level: it
 * is a level per day forever, and a gate that holds on the three dates a
 * developer happened to type is not a gate. Thirty consecutive days is enough
 * to catch a gate that leaks at a few per cent — the decoy floor was missing
 * for 4.4% of dates, and this window contains two of them — while keeping the
 * file, which runs the real validator over every candidate it walks, inside
 * fifteen seconds. It crosses a month end so the seed jump from 20260131 to
 * 20260201 is exercised too.
 */
const SPREAD = Array.from({ length: 30 }, (_, i) => shiftISO('2026-01-05', i));

/** The geometry that actually reaches the player, with the naming stripped. */
const shapeOf = (level: Level): string =>
  JSON.stringify([level.start, level.goal, level.walls]);

/*
 * Recover the candidate a date accepted, so the properties that live on the
 * candidate rather than on the level can be checked.
 *
 * Decoy mass is measured on the spanning tree inside `makeCandidate` and is
 * thrown away by the time a Level exists — and it cannot be recomputed from
 * the walls, because off the validator grid it reads ~0.95 for every maze.
 * So the only honest route back is to replay the same seed window with the
 * same difficulty dial and find the candidate whose geometry is the one that
 * shipped. Failing to find it is itself a finding: it would mean the daily
 * came from somewhere other than the window it claims.
 */
const accepted = new Map<string, MazeCandidate>();

function acceptedCandidate(dateISO: string): MazeCandidate {
  const hit = accepted.get(dateISO);
  if (hit) return hit;

  const shipped = shapeOf(dailyLevel(dateISO));
  const base = dailySeed(dateISO) * SEED_STRIDE;
  const t = dailyT(dateISO);

  for (let k = 0; k < MAX_CANDIDATES; k++) {
    const candidate = makeCandidate(base + k, t);
    if (shapeOf(candidate.level) !== shipped) continue;
    accepted.set(dateISO, candidate);
    return candidate;
  }
  throw new Error(`the daily for ${dateISO} is not in its own seed window`);
}

describe('the daily fold across a month of dates', () => {
  /*
   * The decoy floor is the gate that was silently missing. The curator applied
   * four gates and the runtime applied three, so a date whose first playable,
   * interlocked, winding candidate happened to be a corridor with decoration
   * shipped it to every player in the world at once. Two dates in this window
   * (2026-01-08 and 2026-01-11) accept a different maze with the gate than
   * without it, so removing it again fails here rather than in the wild.
   */
  it('applies the decoy floor, not only the playability and mirror gates', () => {
    for (const date of SPREAD) {
      const { decoy } = acceptedCandidate(date);
      expect(decoy, `${date} shipped a maze with too little to explore`).toBeGreaterThanOrEqual(
        MIN_DECOY
      );
    }
  });

  it('proves every date playable with room for a hand, interlocked and winding', () => {
    for (const date of SPREAD) {
      const level = dailyLevel(date);

      const proof = validateLevel(level, pf, {
        ...OPTS,
        hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
      });
      expect(proof.solvable, `${date} shipped a daily with no room for a hand`).toBe(true);

      expect(
        interlock(level),
        `${date} shipped a daily the mirror never bites`
      ).toBeGreaterThanOrEqual(MIN_INTERLOCK);

      const route = routeArc(level, pf, OPTS);
      // Not an expectation: without a route there is nothing left to measure,
      // and the narrowed type is what the next assertion needs.
      if (!route) throw new Error(`${date} shipped a daily with no provable route`);
      expect(
        route.arc / route.direct,
        `${date} shipped a daily that barely winds`
      ).toBeGreaterThanOrEqual(MIN_WINDING);
    }
  });

  /*
   * Par is what the win screen measures a run against, and the path that used
   * to end the loop returned a raw candidate with no par at all — the verdict
   * silently fell back to "no par" on exactly the dates nobody had looked at.
   * A missing par here also means the loop reached the hand-authored tutorial
   * fallback, which over thirty dates would say the generator is broken.
   */
  it('carries a par on every date', () => {
    for (const date of SPREAD) {
      expect(dailyLevel(date).parPx, `${date} shipped a daily with no par`).toBeGreaterThan(0);
    }
  });

  it('gives each date a seed window no neighbour can reach into', () => {
    // Consecutive dates are at least one apart as numbers, so the closest two
    // bases can ever sit is one stride. The loop may walk MAX_CANDIDATES seeds
    // from its base, so the stride has to be the larger of the two or the tail
    // of one day's window is the head of the next day's. `acceptedCandidate`
    // has already proved each daily really does come out of the window this
    // arithmetic describes.
    for (let i = 1; i < SPREAD.length; i++) {
      const previous = dailySeed(SPREAD[i - 1]) * SEED_STRIDE;
      const current = dailySeed(SPREAD[i]) * SEED_STRIDE;
      expect(
        current - previous,
        `${SPREAD[i - 1]} and ${SPREAD[i]} draw from overlapping seeds`
      ).toBeGreaterThanOrEqual(MAX_CANDIDATES);
      acceptedCandidate(SPREAD[i]);
    }
  });

  it('never repeats a maze inside the window', () => {
    const shapes = new Set(SPREAD.map((date) => shapeOf(dailyLevel(date))));
    expect(shapes.size).toBe(SPREAD.length);
    for (let i = 1; i < SPREAD.length; i++) {
      expect(
        shapeOf(dailyLevel(SPREAD[i])),
        `${SPREAD[i]} repeats the maze from ${SPREAD[i - 1]}`
      ).not.toBe(shapeOf(dailyLevel(SPREAD[i - 1])));
    }
  });

  /*
   * The in-module cache makes determinism trivially true for a second call in
   * the same process, which is not the claim. The claim is that a phone that
   * has never computed this date computes the same maze as one that has, so
   * the cache has to be thrown away and the whole acceptance loop re-run.
   */
  it('recomputes an identical level once the cache has been thrown away', async () => {
    const first = dailyLevel('2026-01-08');
    vi.resetModules();
    const reloaded = await import('./Daily');
    const second = reloaded.dailyLevel('2026-01-08');

    // Different object: proof the second one was generated, not remembered.
    expect(second).not.toBe(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('the daily streak', () => {
  const seed = (dates: string[]): void => {
    Progress.update({
      daily: Object.fromEntries(
        dates.map((d) => [d, { ms: 1000, deaths: 0, foldSense: 50 }])
      ),
    });
  };

  it('counts consecutive finished days ending today', () => {
    seed(['2026-08-05', '2026-08-06', '2026-08-07']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(3);
  });

  it('does not break the run before today is over', () => {
    // Today unfinished: the streak the player is protecting is still alive.
    seed(['2026-08-05', '2026-08-06']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(2);
  });

  it('a gap ends the streak', () => {
    seed(['2026-08-03', '2026-08-05', '2026-08-06', '2026-08-07']);
    expect(Progress.dailyStreak('2026-08-07')).toBe(3);
  });

  it('no dailies, no streak', () => {
    seed([]);
    expect(Progress.dailyStreak('2026-08-07')).toBe(0);
  });

  it('spans a month boundary', () => {
    seed(['2026-07-30', '2026-07-31', '2026-08-01']);
    expect(Progress.dailyStreak('2026-08-01')).toBe(3);
  });
});
