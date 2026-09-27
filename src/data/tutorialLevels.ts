/**
 * GENERATED — do not edit by hand. Run `npx vite-node scripts/genTutorialMazes.ts`.
 *
 * The tutorial arc, as five small mazes from src/core/MazeGen.ts. Each folds
 * only walls chosen to teach its one thing, measured on the line a hand can
 * draw (scripts/tutorialLessons.ts):
 *
 *   l1 First reflection — one folded wall, and it is the lie: the near half's
 *                         best line runs through it; the real one turns at it.
 *   l2 Zigzag           — three turns in a row alternate between a wall drawn
 *                         here and a reflection.
 *   l3 Gate             — the line threads a gap bounded by a drawn wall and a
 *                         reflection, which the near half shows 1.8× as wide.
 *   l4 Sacrifice        — the way the near half offers is a whole corridor away
 *                         from the way that works.
 *   l5 Tangle           — two or more folds, the sacrifice, and a zigzag or a
 *                         gate on the way.
 *
 * In every one the folds lengthen the best line by a clear margin, and that
 * line goes through the maze's corridors. Proved playable with room for a
 * hand; difficulty() strictly rising and below level 6. levels.test.ts
 * re-proves and re-measures them on every run.
 *
 * They live apart from `levels.ts` so that importing a tutorial level does
 * not drag in `generatedLevels.ts` with it: that file is 600 KB of maze
 * tables, and the Daily Fold — which needs a proved level to fall back on, and
 * nothing else from the shipped ladder — is also the whole of the web build.
 */
import type { Level } from './types';

export const TUTORIAL_LEVELS: readonly Level[] = [
  {
    id: 'l1',
    name: 'First reflection',
    start: { x: 0.0833, y: 0.92 },
    goal: { x: 0.0833, y: 0.07 },
    parPx: 1209,
    walls: [
      { x: 0.1532, y: 0.3855, w: 0.1936, h: 0.021 },
      { x: 0, y: 0.5135, w: 0.1667, h: 0.021 },
      { x: 0.1667, y: 0.7695, w: 0.3333, h: 0.021 },
      { x: 0.1667, y: 0.1295, w: 0.3333, h: 0.021 },
      { x: 0.3198, y: 0.1295, w: 0.027, h: 0.1385 },
      { x: 0.3198, y: 0.3855, w: 0.027, h: 0.2665 },
      { x: 0.1532, y: 0.268, w: 0.027, h: 0.1385 },
      { x: 0.6667, y: 0.6415, w: 0.3333, h: 0.021 },
    ],
  },
  {
    id: 'l2',
    name: 'Zigzag',
    start: { x: 0.4167, y: 0.92 },
    goal: { x: 0.4167, y: 0.07 },
    parPx: 1279,
    walls: [
      { x: 0.1667, y: 0.2575, w: 0.1801, h: 0.021 },
      { x: 0, y: 0.3855, w: 0.1667, h: 0.021 },
      { x: 0.1667, y: 0.6415, w: 0.1801, h: 0.021 },
      { x: 0, y: 0.7695, w: 0.3468, h: 0.021 },
      { x: 0, y: 0.1295, w: 0.3333, h: 0.021 },
      { x: 0.3198, y: 0.2575, w: 0.027, h: 0.2665 },
      { x: 0.3198, y: 0.6415, w: 0.027, h: 0.149 },
      { x: 0.5, y: 0.5135, w: 0.3333, h: 0.021 },
    ],
  },
  {
    id: 'l3',
    name: 'Gate',
    start: { x: 0.0833, y: 0.92 },
    goal: { x: 0.4167, y: 0.07 },
    parPx: 1317,
    walls: [
      { x: 0.1532, y: 0.2575, w: 0.1936, h: 0.021 },
      { x: 0, y: 0.5135, w: 0.1802, h: 0.021 },
      { x: 0.1532, y: 0.6415, w: 0.1801, h: 0.021 },
      { x: 0, y: 0.1295, w: 0.3333, h: 0.021 },
      { x: 0.1667, y: 0.7695, w: 0.3333, h: 0.021 },
      { x: 0.1532, y: 0.2575, w: 0.027, h: 0.1385 },
      { x: 0.1532, y: 0.5135, w: 0.027, h: 0.149 },
      { x: 0.3198, y: 0.2575, w: 0.027, h: 0.2665 },
      { x: 0.5, y: 0.5135, w: 0.1667, h: 0.021 },
    ],
  },
  {
    id: 'l4',
    name: 'Sacrifice',
    start: { x: 0.4167, y: 0.92 },
    goal: { x: 0.4167, y: 0.07 },
    parPx: 1300,
    walls: [
      { x: 0.1532, y: 0.2575, w: 0.1801, h: 0.021 },
      { x: 0.1532, y: 0.3855, w: 0.1801, h: 0.021 },
      { x: 0, y: 0.5135, w: 0.3468, h: 0.021 },
      { x: 0, y: 0.7695, w: 0.3333, h: 0.021 },
      { x: 0, y: 0.1295, w: 0.3333, h: 0.021 },
      { x: 0.1532, y: 0.2575, w: 0.027, h: 0.149 },
      { x: 0.1532, y: 0.652, w: 0.027, h: 0.1385 },
      { x: 0.3198, y: 0.5135, w: 0.027, h: 0.1385 },
      { x: 0.5, y: 0.3855, w: 0.1667, h: 0.021 },
    ],
  },
  {
    id: 'l5',
    name: 'Tangle',
    start: { x: 0.0833, y: 0.92 },
    goal: { x: 0.0833, y: 0.07 },
    parPx: 1365,
    walls: [
      { x: 0, y: 0.5135, w: 0.1667, h: 0.021 },
      { x: 0.1667, y: 0.6415, w: 0.1801, h: 0.021 },
      { x: 0.1667, y: 0.7695, w: 0.3333, h: 0.021 },
      { x: 0.1532, y: 0.1295, w: 0.3468, h: 0.021 },
      { x: 0.1532, y: 0.1295, w: 0.027, h: 0.1385 },
      { x: 0.3198, y: 0.396, w: 0.027, h: 0.2665 },
      { x: 0.6532, y: 0.3855, w: 0.3468, h: 0.021 },
      { x: 0.6532, y: 0.268, w: 0.027, h: 0.1385 },
    ],
  },
];
