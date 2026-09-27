/*
 * The Gallery card's caption — which fold, then the time — and where its
 * print sits. The cards themselves are painted and checked in the browser.
 */
import { describe, expect, it, vi } from 'vitest';

// The scene module draws with Phaser, which cannot load without a browser;
// nothing under test here reaches it or the systems below.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../render/UI', () => ({}));
vi.mock('../render/ScrollView', () => ({ ScrollView: class {} }));
vi.mock('../render/InkRenderer', () => ({}));
vi.mock('../render/ShareCard', () => ({}));
vi.mock('../render/ReplayVideo', () => ({}));
vi.mock('../systems/Ads', () => ({ Ads: {} }));
vi.mock('../systems/Haptics', () => ({ Haptics: {} }));
vi.mock('../systems/Progress', () => ({ Progress: {} }));
vi.mock('../systems/Share', () => ({}));

import { LEVELS } from '../data/levels';
import { figureCaption, printBox } from './GalleryScene';

describe('printBox — the print on an album card', () => {
  it('keeps the playfield’s own shape, centred across the card', () => {
    for (const [w, h] of [
      [217, 360],
      [200, 300],
      [260, 500],
    ]) {
      const b = printBox(10, 20, w, h);
      expect(b.h / b.w).toBeCloseTo(1102 / 702, 6);
      expect(b.x - 10).toBeCloseTo(10 + w - (b.x + b.w), 6);
    }
  });

  it('stays inside the card, above the caption’s band', () => {
    const b = printBox(0, 0, 217, 360);
    expect(b.x).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThan(0);
    expect(b.x + b.w).toBeLessThan(217);
    // The caption's band is at least 20 base units under the print.
    expect(360 - (b.y + b.h)).toBeGreaterThanOrEqual(20);
  });
});

describe('figureCaption', () => {
  it('names a campaign fold by its level number, then the time', () => {
    expect(figureCaption({ levelId: 'l12', ms: 7500 })).toBe('12 · 7.5 s');
    expect(figureCaption({ levelId: 'l1', ms: 1530 })).toBe('1 · 1.5 s');
    const last = LEVELS.length;
    expect(figureCaption({ levelId: `l${last}`, ms: 61_040 })).toBe(`${last} · 61.0 s`);
  });

  it('numbers the level by its position in LEVELS', () => {
    LEVELS.forEach((level, i) => {
      expect(figureCaption({ levelId: level.id, ms: 0 })).toBe(`${i + 1} · 0.0 s`);
    });
  });

  it('names a Daily by its share-card number: 2026-08-01 is #1', () => {
    expect(figureCaption({ levelId: 'd2026-08-01', ms: 9000 })).toBe('Daily #1 · 9.0 s');
    expect(figureCaption({ levelId: 'd2026-09-23', ms: 12_345 })).toBe('Daily #54 · 12.3 s');
    // Across the October DST change: whole days, not 24-hour blocks.
    expect(figureCaption({ levelId: 'd2026-10-26', ms: 4000 })).toBe('Daily #87 · 4.0 s');
  });

  it('says "Daily fold" for a Daily from before #1 rather than a zero or a negative number', () => {
    expect(figureCaption({ levelId: 'd2026-07-31', ms: 5000 })).toBe('Daily fold · 5.0 s');
    expect(figureCaption({ levelId: 'd2025-12-31', ms: 5000 })).toBe('Daily fold · 5.0 s');
  });

  it('gives the time alone for an id this build does not know', () => {
    expect(figureCaption({ levelId: `l${LEVELS.length + 1}`, ms: 7500 })).toBe('7.5 s');
    expect(figureCaption({ levelId: 'x9', ms: 7500 })).toBe('7.5 s');
    expect(figureCaption({ levelId: 'dtomorrow', ms: 7500 })).toBe('7.5 s');
    expect(figureCaption({ levelId: 'd2026-9-23', ms: 7500 })).toBe('7.5 s');
  });

  it('writes the time the way the win card does', () => {
    expect(figureCaption({ levelId: 'l3', ms: 7449 })).toBe('3 · 7.4 s');
    expect(figureCaption({ levelId: 'l3', ms: 7450 })).toBe('3 · 7.5 s');
    expect(figureCaption({ levelId: 'l3', ms: -20 })).toBe('3 · 0.0 s');
  });
});
