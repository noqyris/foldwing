/**
 * Fold Sense — the game's skill score, 0..100.
 *
 * It measures the one ability this game is actually about: how well the
 * player reads the half of the maze they cannot see. Everything in it is
 * computed from REAL play signals — no claim about brains, hemispheres or
 * cognition is made or implied anywhere; this is a game rating in the same
 * sense chess Elo is, and marketing copy must keep it that way (see
 * MARKETING.md guardrails — the FTC/Lumosity precedent).
 *
 * Per-win inputs and what they say:
 *   parRatio         line length / proved-route length. Efficiency of plan.
 *   attempts         tries this level took. Persistence is fine; the score
 *                    honours getting it early.
 *   revealsUsed      folded walls shown on demand — outsourced fold-reading.
 *   mirrorDeathShare of this level's deaths, how many were the REFLECTION
 *                    dying — the direct signature of not reading the fold.
 *   foldExposure     how much of the level's wall length lives on the far
 *                    half. Reading a heavily folded maze blind is worth
 *                    more than reading a visible one.
 *
 * Pure and deterministic, so it is testable and the same play always scores
 * the same.
 */

import type { Level } from '../data/types';

export interface WinSignals {
  readonly parRatio: number | null;
  readonly attempts: number;
  readonly revealsUsed: number;
  /** mirrorDeaths / totalDeaths for this level; 0 when no deaths. */
  readonly mirrorDeathShare: number;
  readonly foldExposure: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Fraction of total wall length that sits on the far (folded) half. */
export function foldExposure(level: Level): number {
  let far = 0;
  let total = 0;
  for (const w of level.walls) {
    const len = Math.max(w.w, w.h);
    total += len;
    if (w.x + w.w > 0.5) far += len;
  }
  return total === 0 ? 0 : far / total;
}

export function winScore(s: WinSignals): number {
  // A line at par is perfect; twice par is a survived scribble.
  const line = s.parRatio === null ? 0.6 : clamp01(2 - s.parRatio);

  // First try is 1; the curve forgives a few deaths, not a siege.
  const clean = 1 / Math.sqrt(Math.max(1, s.attempts));

  // Deaths caused by the reflection are the fold going unread.
  const blind = 1 - 0.85 * clamp01(s.mirrorDeathShare);

  let score = 100 * (0.4 * line + 0.3 * clean + 0.3 * blind);

  // Reveals outsource exactly the skill being scored.
  score *= Math.pow(0.9, Math.max(0, s.revealsUsed));

  // The exposure multiplier CAPS at exactly 1: a fully folded maze keeps its
  // ceiling of 100 and everything more visible scores under it. A bonus
  // above 1 looked nicer but let the clamp swallow the reveal penalty at the
  // top — a perfect-looking 100 with three reveals spent is a lie.
  score *= 0.7 + 0.3 * clamp01(s.foldExposure / 0.5);

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * The profile score is an exponential moving average of recent wins: it
 * rewards current form, forgives history, and cannot be farmed by replaying
 * easy levels (their fold exposure keeps their ceiling low).
 */
export function nextProfileScore(previous: number, win: number): number {
  if (previous <= 0) return win;
  return Math.round(previous + 0.15 * (win - previous));
}
