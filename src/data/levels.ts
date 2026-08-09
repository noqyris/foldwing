import type { Level } from './types';
import { GENERATED_LEVELS } from './generatedLevels';
import { TUTORIAL_LEVELS } from './tutorialLevels';

export { TUTORIAL_LEVELS };

/**
 * The shipped ladder: the five hand-authored tutorial levels, then 295
 * generated MAZES ordered by measured `difficulty()` — how narrow the tightest
 * corridor is, how often both halves squeeze at the same height, and how many
 * decisions the route contains. Every one is re-proved solvable AND playable by
 * levels.test.ts on each run.
 */
export const LEVELS: readonly Level[] = [...TUTORIAL_LEVELS, ...GENERATED_LEVELS];

/** Wraps in both directions, so level cycling never falls off either end. */
export function levelAt(index: number): Level {
  const n = LEVELS.length;
  return LEVELS[((index % n) + n) % n];
}
