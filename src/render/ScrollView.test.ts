/*
 * ScrollView's gestures, driven through a stand-in scene: a tap chooses, a
 * drag scrolls, a press outside the window (under the banner's air) does
 * nothing, a sideways swipe turns the page without moving the list, and a
 * horizontal list scrolls across.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  const Clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const Between = (x1: number, y1: number, x2: number, y2: number): number => Math.hypot(x2 - x1, y2 - y1);
  return {
    default: {
      Input: { Events: { POINTER_DOWN: 'pointerdown', POINTER_MOVE: 'pointermove', POINTER_UP: 'pointerup' } },
      Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown' } },
      Math: { Clamp, Distance: { Between } },
    },
  };
});
vi.mock('./UI', () => ({ TAP_SLOP: 28 }));

import { gestureAxis, ScrollView, SWIPE_MIN, swipeDirection, type ScrollRow } from './ScrollView';

type Fn = (...args: unknown[]) => void;

/** Just enough of a scene: input and scene events, and a clock. */
function fakeScene() {
  const make = () => {
    const map = new Map<string, { fn: Fn; ctx: unknown; once?: boolean }[]>();
    return {
      map,
      on(e: string, fn: Fn, ctx?: unknown) {
        map.set(e, [...(map.get(e) ?? []), { fn, ctx }]);
      },
      once(e: string, fn: Fn, ctx?: unknown) {
        map.set(e, [...(map.get(e) ?? []), { fn, ctx, once: true }]);
      },
      off(e: string, fn: Fn, ctx?: unknown) {
        map.set(
          e,
          (map.get(e) ?? []).filter((l) => l.fn !== fn || (ctx !== undefined && l.ctx !== ctx))
        );
      },
      emit(e: string, ...args: unknown[]) {
        for (const l of [...(map.get(e) ?? [])]) {
          if (l.once) this.off(e, l.fn, l.ctx);
          l.fn.apply(l.ctx, args);
        }
      },
      count(e: string) {
        return (map.get(e) ?? []).length;
      },
    };
  };
  return { input: make(), events: make(), time: { now: 0 } };
}

const pointer = (x: number, y: number, extra: object = {}) => ({ x, y, wasCanceled: false, ...extra });

let now = 0;
beforeEach(() => {
  now = 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

/** A vertical list of `n` rows 100 tall in a window from 200 to 600; returns the scene, content and taps. */
function list(n = 20, extra: Partial<ConstructorParameters<typeof ScrollView>[2]> = {}) {
  const scene = fakeScene();
  const content = { x: 0, y: 200 };
  const taps: number[] = [];
  const items: ScrollRow[] = Array.from({ length: n }, (_, i) => ({
    x: 375,
    y: 50 + i * 100,
    width: 300,
    height: 90,
    onTap: () => taps.push(i),
  }));
  const view = new ScrollView(scene as never, content as never, {
    top: 200,
    bottom: 600,
    contentHeight: n * 100,
    items,
    ...extra,
  });
  // Past the new list's arm delay.
  now += 1000;
  return { scene, content, taps, view };
}

function gesture(scene: ReturnType<typeof fakeScene>, from: [number, number], to: [number, number], steps = 6) {
  scene.input.emit('pointerdown', pointer(...from), []);
  for (let k = 1; k <= steps; k++) {
    scene.time.now += 16;
    const x = from[0] + ((to[0] - from[0]) * k) / steps;
    const y = from[1] + ((to[1] - from[1]) * k) / steps;
    scene.input.emit('pointermove', pointer(x, y));
  }
  scene.input.emit('pointerup', pointer(...to));
}

describe('a vertical list', () => {
  it('chooses the row a tap lands on', () => {
    const { scene, taps } = list();
    gesture(scene, [375, 360], [376, 362], 1);
    // Content y 160 is row 1 (110–190).
    expect(taps).toEqual([1]);
  });

  it('scrolls with a drag, and a drag is never a tap', () => {
    const { scene, content, taps, view } = list();
    gesture(scene, [375, 500], [375, 300]);
    expect(taps).toEqual([]);
    expect(view.scrolled).toBeCloseTo(200, 0);
    expect(content.y).toBe(200 - Math.round(view.scrolled));
  });

  it('takes no press below its window — the banner’s air — nor below a clip', () => {
    const { scene, taps, view } = list();
    gesture(scene, [375, 610], [375, 611], 1);
    expect(taps).toEqual([]);
    view.clip(500);
    gesture(scene, [375, 550], [375, 551], 1);
    expect(taps).toEqual([]);
    gesture(scene, [375, 450], [375, 451], 1);
    expect(taps).toEqual([2]);
  });

  it('stands aside for a press that landed on something interactive', () => {
    const { scene, taps } = list();
    scene.input.emit('pointerdown', pointer(375, 360), [{}]);
    scene.input.emit('pointerup', pointer(375, 360));
    expect(taps).toEqual([]);
  });

  it('turns no page without an owner for swipes: a sideways drag is only a drag', () => {
    const { scene, taps, view } = list();
    gesture(scene, [600, 400], [150, 410]);
    expect(taps).toEqual([]);
    expect(view.scrolled).toBeLessThan(0.5);
  });

  it('stops listening once destroyed', () => {
    const { scene, taps, view } = list();
    view.destroy();
    expect(scene.input.count('pointerdown')).toBe(0);
    expect(scene.events.count('update')).toBe(0);
    gesture(scene, [375, 360], [375, 360], 1);
    expect(taps).toEqual([]);
    // Twice is harmless.
    view.destroy();
  });

  it('ignores presses while it is new: the tap that opened the screen is not a choice', () => {
    const scene = fakeScene();
    const taps: number[] = [];
    new ScrollView(scene as never, { x: 0, y: 200 } as never, {
      top: 200,
      bottom: 600,
      contentHeight: 400,
      items: [{ x: 375, y: 50, width: 300, height: 90, onTap: () => taps.push(0) }],
    });
    gesture(scene, [375, 250], [375, 250], 1);
    expect(taps).toEqual([]);
  });
});

describe('a vertical list that turns pages', () => {
  it('hands a sideways swipe to its owner, and does not move', () => {
    const swipes: number[] = [];
    const { scene, taps, view } = list(20, { onSwipe: (d) => swipes.push(d) });
    gesture(scene, [600, 400], [150, 420]);
    expect(swipes).toEqual([1]);
    expect(view.scrolled).toBe(0);
    gesture(scene, [150, 400], [600, 380]);
    expect(swipes).toEqual([1, -1]);
    expect(taps).toEqual([]);
  });

  it('scrolls a mostly vertical drag and never turns the page on it', () => {
    const swipes: number[] = [];
    const { scene, view } = list(20, { onSwipe: (d) => swipes.push(d) });
    gesture(scene, [375, 550], [420, 300]);
    expect(swipes).toEqual([]);
    expect(view.scrolled).toBeGreaterThan(200);
  });

  it('turns nothing on a short sideways nudge', () => {
    const swipes: number[] = [];
    const { scene } = list(20, { onSwipe: (d) => swipes.push(d) });
    gesture(scene, [400, 400], [400 - SWIPE_MIN + 10, 400]);
    expect(swipes).toEqual([]);
  });

  it('turns nothing on a touch the system cancelled', () => {
    const swipes: number[] = [];
    const { scene } = list(20, { onSwipe: (d) => swipes.push(d) });
    scene.input.emit('pointerdown', pointer(600, 400), []);
    scene.input.emit('pointermove', pointer(300, 400));
    scene.input.emit('pointerup', pointer(150, 400, { wasCanceled: true }));
    expect(swipes).toEqual([]);
  });
});

describe('a horizontal list', () => {
  function strip() {
    const scene = fakeScene();
    const content = { x: 0, y: 180 };
    const taps: number[] = [];
    const items: ScrollRow[] = Array.from({ length: 15 }, (_, i) => ({
      x: 76 + i * 112,
      y: 75,
      width: 112,
      height: 150,
      onTap: () => taps.push(i),
    }));
    const view = new ScrollView(scene as never, content as never, {
      top: 180,
      bottom: 330,
      contentHeight: 0,
      items,
      horizontal: { left: 0, right: 750, contentWidth: 1720 },
    });
    now += 1000;
    return { scene, content, taps, view };
  }

  it('scrolls across with a drag and leaves its y alone', () => {
    const { scene, content, view } = strip();
    gesture(scene, [600, 250], [300, 255]);
    expect(view.scrolled).toBeCloseTo(300, 0);
    expect(content.x).toBe(-Math.round(view.scrolled));
    expect(content.y).toBe(180);
    expect(view.range).toBe(1720 - 750);
  });

  it('chooses the tile under a tap, in its own scrolled space', () => {
    const { scene, taps, view } = strip();
    view.scrollTo(224);
    // Screen x 300 is content x 524: tile 4 (468–580).
    gesture(scene, [300, 250], [300, 250], 1);
    expect(taps).toEqual([4]);
  });

  it('takes no press outside its band', () => {
    const { scene, taps } = strip();
    gesture(scene, [300, 150], [300, 150], 1);
    gesture(scene, [300, 340], [300, 340], 1);
    expect(taps).toEqual([]);
  });
});

describe('telling a swipe from a scroll', () => {
  it('decides on the first move past the slop, sideways only for a list that takes swipes', () => {
    expect(gestureAxis(40, 10, true)).toBe('swipe');
    expect(gestureAxis(10, 40, true)).toBe('scroll');
    expect(gestureAxis(40, 10, false)).toBe('scroll');
  });

  it('turns only on a long, mostly sideways release: +1 leftward, −1 rightward', () => {
    expect(swipeDirection(-SWIPE_MIN, 0)).toBe(1);
    expect(swipeDirection(SWIPE_MIN, 0)).toBe(-1);
    expect(swipeDirection(-SWIPE_MIN + 1, 0)).toBe(0);
    expect(swipeDirection(-100, 90)).toBe(0);
  });
});
