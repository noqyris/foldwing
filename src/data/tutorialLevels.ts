import type { Level } from './types';

/**
 * The tutorial arc. Each level teaches exactly one thing:
 *
 *   l1 First reflection — the mirror exists, and it has its own obstacles.
 *   l2 Zigzag          — alternating sides force a weave.
 *   l3 Gate            — you must thread a gap that is only a gap on one side.
 *   l4 Sacrifice       — THE design thesis. The player has to hug the far-left
 *                        edge purely to save the mirror, then swing hard right.
 *                        Every level past 5 should contain a beat like this.
 *   l5 Tangle          — all of the above, compounded.
 *
 * These numbers are tuned and LOCKED — the generator appends after them and
 * never touches them.
 *
 * They live apart from `levels.ts` so that importing a hand-authored level does
 * not drag in `generatedLevels.ts` with it: that file is 600 KB of maze tables,
 * and the Daily Fold — which needs a proved level to fall back on, and nothing
 * else from the shipped ladder — is also the whole of the web build.
 */
export const TUTORIAL_LEVELS: readonly Level[] = [
  {
    id: 'l1',
    name: 'First reflection',
    start: { x: 0.14, y: 0.88 },
    goal: { x: 0.14, y: 0.12 },
    walls: [
      { x: 0, y: 0.44, w: 0.3, h: 0.06 },
      { x: 0.5, y: 0.64, w: 0.28, h: 0.06 },
    ],
  },
  {
    id: 'l2',
    name: 'Zigzag',
    start: { x: 0.12, y: 0.9 },
    goal: { x: 0.12, y: 0.1 },
    walls: [
      { x: 0, y: 0.72, w: 0.26, h: 0.05 },
      { x: 0.5, y: 0.56, w: 0.3, h: 0.05 },
      { x: 0, y: 0.4, w: 0.3, h: 0.05 },
      { x: 0.5, y: 0.24, w: 0.34, h: 0.05 },
    ],
  },
  {
    id: 'l3',
    name: 'Gate',
    start: { x: 0.1, y: 0.9 },
    goal: { x: 0.4, y: 0.1 },
    walls: [
      { x: 0, y: 0.6, w: 0.22, h: 0.06 },
      { x: 0.34, y: 0.6, w: 0.16, h: 0.06 },
      { x: 0.5, y: 0.36, w: 0.22, h: 0.06 },
      { x: 0.86, y: 0.36, w: 0.14, h: 0.06 },
    ],
  },
  {
    id: 'l4',
    name: 'Sacrifice',
    start: { x: 0.1, y: 0.9 },
    goal: { x: 0.1, y: 0.1 },
    walls: [
      { x: 0.5, y: 0.68, w: 0.38, h: 0.06 },
      { x: 0, y: 0.5, w: 0.36, h: 0.06 },
      { x: 0.62, y: 0.32, w: 0.38, h: 0.06 },
      { x: 0.2, y: 0.18, w: 0.3, h: 0.06 },
    ],
  },
  {
    id: 'l5',
    name: 'Tangle',
    start: { x: 0.08, y: 0.92 },
    goal: { x: 0.08, y: 0.08 },
    walls: [
      { x: 0.5, y: 0.8, w: 0.32, h: 0.05 },
      { x: 0, y: 0.68, w: 0.3, h: 0.05 },
      { x: 0.74, y: 0.56, w: 0.26, h: 0.05 },
      { x: 0.38, y: 0.56, w: 0.12, h: 0.05 },
      { x: 0, y: 0.44, w: 0.34, h: 0.05 },
      { x: 0.5, y: 0.32, w: 0.36, h: 0.05 },
      { x: 0.24, y: 0.2, w: 0.26, h: 0.05 },
    ],
  },
];
