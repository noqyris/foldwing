import { describe, expect, it } from 'vitest';
import {
  BASE_HEIGHT,
  BASE_WIDTH,
  METRICS,
  PT,
  pt,
  rgba,
  setTheme,
  theme,
} from './Theme';

/*
 * These are the spec's numbers, not incidental constants. Pinning them means a
 * later tweak to "just the look" cannot quietly retune the feel of the game,
 * and the LOCKED values announce themselves if anyone edits them.
 */

describe('base canvas', () => {
  it('is a fixed 9:16 portrait logical space', () => {
    expect(BASE_WIDTH).toBe(750);
    expect(BASE_HEIGHT).toBe(1334);
    // Wider than any common portrait phone, so tall devices letterbox into the
    // paper background instead of pillarboxing and stealing the mirror's width.
    expect(BASE_WIDTH / BASE_HEIGHT).toBeLessThan(0.5626);
  });

  it('converts logical points at 2x', () => {
    expect(PT).toBe(2);
    expect(pt(5)).toBe(10);
    expect(pt(2.6)).toBeCloseTo(5.2, 12);
    expect(pt(0)).toBe(0);
  });
});

describe('palette', () => {
  it('matches the spec, exactly', () => {
    const t = theme();
    expect(t.paper).toBe(0xe9ebe4);
    expect(t.ink).toBe(0x16323c);
    expect(t.wall).toBe(0x9a9c90);
    expect(t.accent).toBe(0x8e3b62);
    expect(t.fail).toBe(0xb4463c);
  });

  it('keeps the specified opacities', () => {
    const t = theme();
    expect(t.mirrorAlpha).toBe(0.45); // same ink, seen through glass
    expect(t.winFillAlpha).toBe(0.11); // rgba(22,50,60,.11)
    expect(t.axisAlpha).toBe(0.16); // rgba(22,50,60,.16)
  });

  it('renders ink at the win-fill alpha as the spec s rgba string', () => {
    expect(rgba(theme().ink, theme().winFillAlpha)).toBe('rgba(22,50,60,0.11)');
    expect(rgba(theme().ink, theme().axisAlpha)).toBe('rgba(22,50,60,0.16)');
  });

  it('ignores an unknown theme id rather than blanking the game', () => {
    const before = theme().id;
    setTheme('no-such-ink-pack');
    expect(theme().id).toBe(before);
  });
});

describe('LOCKED rule 3 — hit radius against the rendered nib', () => {
  it('ships 2.6pt of collision inside a 5pt nib', () => {
    expect(METRICS.hitRadius).toBe(pt(2.6));
    expect(theme().strokePt).toBe(5);
    expect(METRICS.hitRadius).toBeLessThan(pt(theme().strokePt));
  });

  /*
   * Documenting the consequence rather than asserting an intent. Collision is
   * measured from the centreline and the nib reaches half its width, so these
   * two numbers put the kill boundary 0.2 base px OUTSIDE the visible ink —
   * marginally strict, where the spec's prose asks for marginally forgiving.
   * Change hitRadius and this number moves; it is here so the change is loud.
   */
  it('places the kill boundary 0.2 base px outside the visible ink', () => {
    const halfNib = pt(theme().strokePt) / 2;
    expect(METRICS.hitRadius - halfNib).toBeCloseTo(0.2, 12);
  });

  it('keeps collision forgiveness out of the cosmetic theme', () => {
    // hitRadius must never migrate into InkTheme: a purchasable skin that moved
    // the kill boundary would be pay-to-win.
    expect(Object.keys(theme())).not.toContain('hitRadius');
    expect(METRICS.hitRadius).toBeGreaterThan(0);
  });
});

describe('feel constants', () => {
  it('samples no more often than the hit radius', () => {
    expect(METRICS.sampleMinDist).toBe(pt(2.6));
    // A rejected sample sits within a hit radius of one already tested, which
    // is what makes dropping it safe.
    expect(METRICS.sampleMinDist).toBeLessThanOrEqual(METRICS.hitRadius);
  });

  it('lifts the touch cursor 42pt clear of the finger', () => {
    expect(METRICS.touchOffsetY).toBe(pt(42));
  });

  it('eases the touch offset in over DISTANCE, not time', () => {
    // A time-based ramp moves the cursor while the finger is still, drawing —
    // and collision-testing — ink the player never made. The unit is the point.
    expect(METRICS.touchOffsetRampPx).toBe(pt(60));
    expect(METRICS.touchOffsetRampPx).toBeGreaterThan(0);
    /*
     * LONGER than the offset itself, on purpose. It was pt(21) — full lead
     * within a thumb-width, ink at double finger speed from the first
     * millimetre — and the recurring player report was dying on the first
     * obstacle "while still starting". Paired with DrawCursor's smoothstep,
     * pt(60) finishes the lift inside the level's start runway (every level
     * keeps ≥ pt(70) of wall-free ground above the start dot), so the lead is
     * complete before the first wall can be met but never dominates takeoff.
     */
    expect(METRICS.touchOffsetRampPx).toBeLessThanOrEqual(pt(70));
  });

  it('bounds render smoothing so the drawn line cannot lie about collision', () => {
    expect(METRICS.renderMaxSpacing).toBe(pt(5));
    // Chaikin's corner cut scales with the spacing it is handed; keeping that
    // spacing near the nib keeps the bow well inside the ink.
    expect(METRICS.renderMaxSpacing).toBeLessThanOrEqual(pt(theme().strokePt));
  });

  it('grabs the start dot at 2.4x its radius', () => {
    expect(METRICS.startGrabFactor).toBe(2.4);
    expect(METRICS.startRadius * METRICS.startGrabFactor).toBe(pt(24));
  });

  it('recovers from failure in well under a second, with no tap', () => {
    expect(METRICS.failFlashMs).toBe(400);
    expect(METRICS.failFlashMs).toBeLessThan(1000);
  });

  it('settles the win figure from 0.97 over 350ms', () => {
    expect(METRICS.winSettleFrom).toBe(0.97);
    expect(METRICS.winSettleMs).toBe(350);
    expect(METRICS.winHoldMs).toBeGreaterThan(0); // "hold for a beat, then..."
  });

  it('smooths the render but leaves collision alone', () => {
    expect(METRICS.smoothIterations).toBeGreaterThan(0);
  });
});
