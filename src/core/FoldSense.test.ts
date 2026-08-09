import { describe, expect, it } from 'vitest';
import { foldExposure, nextProfileScore, winScore } from './FoldSense';
import { LEVELS } from '../data/levels';

const perfect = {
  parRatio: 1,
  attempts: 1,
  revealsUsed: 0,
  mirrorDeathShare: 0,
  foldExposure: 0.5,
};

describe('winScore', () => {
  it('a perfect blind run on a heavily folded maze is 100', () => {
    expect(winScore(perfect)).toBe(100);
  });

  it('stays within 0..100 whatever the inputs', () => {
    for (const s of [
      { parRatio: 5, attempts: 40, revealsUsed: 9, mirrorDeathShare: 1, foldExposure: 0 },
      { parRatio: 0.5, attempts: 1, revealsUsed: 0, mirrorDeathShare: 0, foldExposure: 1 },
      { parRatio: null, attempts: 1, revealsUsed: 0, mirrorDeathShare: 0.4, foldExposure: 0.3 },
    ]) {
      const v = winScore(s);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('punishes mirror deaths harder than visible-wall deaths', () => {
    const visible = winScore({ ...perfect, attempts: 3, mirrorDeathShare: 0 });
    const mirrored = winScore({ ...perfect, attempts: 3, mirrorDeathShare: 1 });
    expect(mirrored).toBeLessThan(visible);
  });

  it('each reveal costs, multiplicatively', () => {
    const none = winScore(perfect);
    const one = winScore({ ...perfect, revealsUsed: 1 });
    const three = winScore({ ...perfect, revealsUsed: 3 });
    expect(one).toBeLessThan(none);
    expect(three).toBeLessThan(one);
  });

  it('an unfolded level cannot score as high as a folded one, all else equal', () => {
    const folded = winScore(perfect);
    const open = winScore({ ...perfect, foldExposure: 0 });
    expect(open).toBeLessThan(folded);
  });

  it('is deterministic', () => {
    const s = { parRatio: 1.3, attempts: 4, revealsUsed: 1, mirrorDeathShare: 0.5, foldExposure: 0.35 };
    expect(winScore(s)).toBe(winScore(s));
  });
});

describe('foldExposure', () => {
  it('rises through the shipped set — late mazes hide more of themselves', () => {
    const mean = (ls: typeof LEVELS): number =>
      ls.reduce((a, l) => a + foldExposure(l), 0) / ls.length;
    const early = mean(LEVELS.slice(5, 35));
    const late = mean(LEVELS.slice(-30));
    expect(late).toBeGreaterThan(early * 1.5);
  });

  it('is a fraction', () => {
    for (const l of LEVELS) {
      const f = foldExposure(l);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('nextProfileScore', () => {
  it('starts at the first win', () => {
    expect(nextProfileScore(0, 62)).toBe(62);
  });

  it('moves a step toward the new win, not all the way', () => {
    const next = nextProfileScore(60, 100);
    expect(next).toBeGreaterThan(60);
    expect(next).toBeLessThan(100);
  });

  it('cannot be farmed upward by grinding wins below your level', () => {
    expect(nextProfileScore(80, 40)).toBeLessThan(80);
  });
});
