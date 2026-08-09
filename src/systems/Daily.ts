/**
 * Daily Fold — one maze a day, the same for the whole world, no server.
 *
 * The maze generator is a pure function of a seed, so seed = date IS the
 * synchronization mechanism: every phone that computes today's fold computes
 * the identical level. The candidate loop applies the same acceptance gates
 * the shipped set uses (playable with room for a hand, mirror engaged, route
 * that winds), stepping the seed deterministically until one passes — the
 * same date can therefore never produce different mazes on different phones,
 * only the same first-accepted candidate.
 *
 * Difficulty sits mid-to-hard and wobbles by date. The daily is for players
 * who come back on purpose; it should never be the tutorial.
 */

import { makeCandidate } from '../core/MazeGen';
import {
  interlock,
  MIN_DECOY,
  MIN_INTERLOCK,
  MIN_WINDING,
  PLAYABLE_CLEARANCE,
  routeArc,
  validateLevel,
} from '../core/LevelValidator';
import { Playfield } from '../core/Playfield';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';
import { TUTORIAL_LEVELS } from '../data/tutorialLevels';
import type { Level } from '../data/types';

export { todayISO } from '../core/CalendarDay';

const VOPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };

/**
 * Seeds are spaced by the widest candidate run so two adjacent days can never
 * draw from the same stretch of the sequence. At 100 the tail of day N's window
 * was arithmetically the head of day N+1's — inert in practice, since the
 * accepted candidate is almost always the first or second, but it made
 * "different date, different maze" true by luck rather than by construction.
 */
const SEED_STRIDE = 1000;

export function dailySeed(dateISO: string): number {
  return Number(dateISO.replace(/-/g, ''));
}

/** Deterministic mid-to-hard difficulty dial for a given date, 0.5..0.8. */
export function dailyT(dateISO: string): number {
  const h = (Math.imul(dailySeed(dateISO), 2654435761) >>> 0) % 1000;
  return 0.5 + (h / 1000) * 0.3;
}

const cache = new Map<string, Level>();

export function dailyLevel(dateISO: string): Level {
  const hit = cache.get(dateISO);
  if (hit) return hit;

  const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
  const base = dailySeed(dateISO) * SEED_STRIDE;
  const t = dailyT(dateISO);

  /*
   * The fallback is a PROVED level, never a raw candidate.
   *
   * The old code ended `fallback ?? makeCandidate(base, t).level`, and that
   * right-hand side had passed no validator, no interlock check and no winding
   * check — the only path in the entire game that could put an unproven maze in
   * front of a player, in the one mode where every player in the world gets the
   * same one. Measured over 180 dates it never fired, which is exactly why it
   * would have been discovered by a player rather than by us.
   *
   * Now the loop cannot end without something `validateLevel` has cleared with
   * room for a hand, and if even that is impossible the daily falls back to a
   * hand-authored tutorial level rather than inventing one.
   */
  let playableOnly: Level | null = null;

  for (let k = 0; k < 200; k++) {
    const { level, decoy } = makeCandidate(base + k, t);
    const playable = validateLevel(level, pf, {
      ...VOPTS,
      hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
    }).solvable;
    if (!playable) continue;

    const route = routeArc(level, pf, VOPTS);
    if (!route) continue;

    // First maze that is merely playable, kept in case nothing clears the rest.
    playableOnly ??= finish(dateISO, level, Math.round(route.arc));

    if (interlock(level) < MIN_INTERLOCK) continue;
    if (route.arc / route.direct < MIN_WINDING) continue;
    if (decoy < MIN_DECOY) continue;

    return remember(dateISO, finish(dateISO, level, Math.round(route.arc)));
  }

  if (playableOnly) return remember(dateISO, playableOnly);

  // Two hundred unplayable candidates has never been observed and would mean
  // the generator itself is broken. Serving a proved hand-authored level beats
  // serving a maze nobody has proved anyone can finish.
  return remember(dateISO, finish(dateISO, TUTORIAL_LEVELS[4], undefined));
}

function finish(dateISO: string, level: Level, parPx: number | undefined): Level {
  return { ...level, id: `d${dateISO}`, name: 'Daily fold', parPx };
}

function remember(dateISO: string, level: Level): Level {
  cache.set(dateISO, level);
  return level;
}
