import type { Level } from './types';
import { GENERATED_LEVELS } from './generatedLevels';
import { TUTORIAL_LEVELS } from './tutorialLevels';

export { TUTORIAL_LEVELS };

/**
 * The shipped ladder: the five tutorial mazes (scripts/genTutorialMazes.ts,
 * folds chosen to teach), then 295 generated MAZES ordered by measured
 * `difficulty()` — how narrow the tightest corridor is, how often both halves
 * squeeze at the same height, and how many decisions the route contains. Every
 * one is re-proved solvable AND playable by levels.test.ts on each run.
 *
 * Ids are positions (`l${i + 1}`): the save keys clears by id and unlocks by
 * index. Giving an existing id new content is a save-schema bump (see
 * Progress.ts, schema 3).
 */
export const LEVELS: readonly Level[] = [...TUTORIAL_LEVELS, ...GENERATED_LEVELS];

/**
 * Levels per chapter — a finish line every twenty. Here, beside the ladder it
 * divides, because the level select draws the chapters and the chapter marks
 * (core/Rewards.ts) pay for them: two copies of the number would let the
 * header and the reward disagree about where a chapter ends.
 */
export const CHAPTER_SIZE = 20;

/** Wraps in both directions, so level cycling never falls off either end. */
export function levelAt(index: number): Level {
  const n = LEVELS.length;
  return LEVELS[((index % n) + n) % n];
}
