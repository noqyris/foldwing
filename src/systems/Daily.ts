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
  PLAYABLE_CLEARANCE,
  routeArc,
  validateLevel,
} from '../core/LevelValidator';
import { Playfield } from '../core/Playfield';
import { BASE_HEIGHT, BASE_WIDTH, METRICS } from '../render/Theme';
import type { Level } from '../data/types';

const VOPTS = { cell: 6, hitRadius: METRICS.hitRadius, goalRadius: METRICS.goalRadius };

/** Local calendar date — a fold rolls over at the player's midnight. */
export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
  const base = dailySeed(dateISO) * 100;
  const t = dailyT(dateISO);

  let fallback: Level | null = null;
  for (let k = 0; k < 200; k++) {
    const { level } = makeCandidate(base + k, t);
    const playable = validateLevel(level, pf, {
      ...VOPTS,
      hitRadius: METRICS.hitRadius + PLAYABLE_CLEARANCE,
    }).solvable;
    if (!playable) continue;
    fallback = fallback ?? level;
    if (interlock(level) < 0.08) continue;
    const route = routeArc(level, pf, VOPTS);
    if (!route || route.arc / route.direct < 1.35) continue;

    const daily: Level = {
      ...level,
      id: `d${dateISO}`,
      name: 'Daily fold',
      parPx: Math.round(route.arc),
    };
    cache.set(dateISO, daily);
    return daily;
  }

  // Two hundred candidates without a full pass has never been observed; a
  // merely-playable maze is still a correct daily, and still deterministic.
  const last = fallback ?? makeCandidate(base, t).level;
  const daily: Level = { ...last, id: `d${dateISO}`, name: 'Daily fold' };
  cache.set(dateISO, daily);
  return daily;
}
