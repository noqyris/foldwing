import { afterEach, describe, expect, it, vi } from 'vitest';

// UI.ts builds on Phaser, which cannot load without a browser. What is under
// test here only listens for the Scale manager's RESIZE and the scene's
// SHUTDOWN and sets a timer; a stand-in carries those names (Phaser's own).
vi.mock('phaser', () => ({
  default: {
    GameObjects: { Container: class {}, Text: class {}, Events: { DESTROY: 'destroy' } },
    Scale: { Events: { RESIZE: 'resize' } },
    Scenes: { SHUTDOWN: 8, Events: { SHUTDOWN: 'shutdown' } },
  },
}));

import type Phaser from 'phaser';
import { BASE_HEIGHT, setViewHeight } from './Theme';
import { HEADER, holdListWindow, listBottom, REBUILD_SETTLE_MS, watchHeight } from './UI';

type Fn = () => void;

/** A scene with just what the two helpers touch, a clock that only moves when told, and a resize to send. */
function fakeScene() {
  const resize = new Set<Fn>();
  const shutdown: Fn[] = [];
  let now = 0;
  const timers: { at: number; fn: Fn; live: boolean }[] = [];
  const scene = {
    active: true,
    scale: {
      on: (e: string, fn: Fn) => e === 'resize' && resize.add(fn),
      off: (e: string, fn: Fn) => e === 'resize' && resize.delete(fn),
    },
    events: { once: (e: string, fn: Fn) => e === 'shutdown' && shutdown.push(fn) },
    time: {
      delayedCall: (delay: number, fn: Fn) => {
        const t = { at: now + delay, fn, live: true };
        timers.push(t);
        return { remove: () => (t.live = false) };
      },
    },
    sys: { isActive: () => scene.active },
  };
  return {
    scene: scene as unknown as Phaser.Scene & { active: boolean },
    raw: scene,
    /** main.ts's relayout: the height is set first, then the RESIZE goes out. */
    relayout(h: number): void {
      setViewHeight(h);
      for (const fn of [...resize]) fn();
    },
    advance(ms: number): void {
      now += ms;
      for (const t of timers) {
        if (t.live && t.at <= now) {
          t.live = false;
          t.fn();
        }
      }
    },
    shutdown(): void {
      shutdown.splice(0).forEach((fn) => fn());
    },
    get listening(): number {
      return resize.size;
    },
  };
}

function fakeCamera(width: number, height: number) {
  return {
    width,
    height,
    setSize(w: number, h: number) {
      this.width = w;
      this.height = h;
      return this;
    },
  };
}

afterEach(() => setViewHeight(BASE_HEIGHT));

/*
 * After a shrink the banner's reserve moves up over a list's last rows at
 * once, and so does the native banner; the rebuild waits for the height to
 * hold (and the Gallery's for a share to end). The window has to be cut to the
 * new line on the resize itself — a thumb aimed at a card drawn under the
 * banner presses the ad.
 */
describe('holdListWindow', () => {
  const top = HEADER.listTop;

  for (const bannerCanShow of [true, false]) {
    it(`cuts the window to the new line on the resize itself, never past the one built (banner: ${bannerCanShow})`, () => {
      setViewHeight(1451);
      const f = fakeScene();
      const bottom = listBottom(bannerCanShow);
      const camera = fakeCamera(750, bottom - top);
      const clip = vi.fn();
      holdListWindow(f.scene, camera as unknown as Phaser.Cameras.Scene2D.Camera, { clip }, top, bottom, bannerCanShow);

      // 18 Pro → the same phone 700pt tall: 1451 → 1334, with no time passing.
      f.relayout(BASE_HEIGHT);
      const cut = listBottom(bannerCanShow, BASE_HEIGHT);
      expect(cut).toBeLessThan(bottom);
      expect(camera.height).toBe(cut - top);
      expect(clip).toHaveBeenLastCalledWith(cut);
      expect(camera.width).toBe(750);

      // Taller than it was built: the rows below the built window do not exist yet.
      f.relayout(1700);
      expect(camera.height).toBe(bottom - top);
      expect(clip).toHaveBeenLastCalledWith(bottom);

      f.shutdown();
      expect(f.listening).toBe(0);
    });
  }

  it('keeps a banner’s window off the reserve at every height it can shrink to', () => {
    for (const [from, to] of [
      [1451, 1334],
      [1700, 1451],
      [1613, 1334],
    ]) {
      setViewHeight(from);
      const f = fakeScene();
      const bottom = listBottom(true);
      const camera = fakeCamera(750, bottom - top);
      holdListWindow(f.scene, camera as unknown as Phaser.Cameras.Scene2D.Camera, { clip: () => undefined }, top, bottom, true);
      f.relayout(to);
      expect(top + camera.height, `${from}→${to}`).toBeLessThanOrEqual(listBottom(true, to));
    }
  });
});

describe('watchHeight', () => {
  it('rebuilds once the height has held for REBUILD_SETTLE_MS, not before', () => {
    setViewHeight(1451);
    const f = fakeScene();
    const rebuild = vi.fn();
    watchHeight(f.scene, rebuild);
    f.relayout(1500);
    f.advance(REBUILD_SETTLE_MS - 1);
    f.relayout(BASE_HEIGHT);
    f.advance(REBUILD_SETTLE_MS - 1);
    expect(rebuild).not.toHaveBeenCalled();
    f.advance(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a height that came back to the one built', () => {
    setViewHeight(1451);
    const f = fakeScene();
    const rebuild = vi.fn();
    watchHeight(f.scene, rebuild);
    f.relayout(BASE_HEIGHT);
    f.relayout(1451);
    f.advance(REBUILD_SETTLE_MS);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('waits out `busy`, and the check it returns rebuilds once that ends', () => {
    setViewHeight(1451);
    const f = fakeScene();
    const rebuild = vi.fn();
    let busy = true;
    const check = watchHeight(f.scene, rebuild, () => busy);
    f.relayout(BASE_HEIGHT);
    f.advance(REBUILD_SETTLE_MS);
    expect(rebuild).not.toHaveBeenCalled();
    busy = false;
    check();
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the scene shuts down, and never rebuilds a scene that is not running', () => {
    setViewHeight(1451);
    const f = fakeScene();
    const rebuild = vi.fn();
    const check = watchHeight(f.scene, rebuild);
    f.relayout(BASE_HEIGHT);
    f.raw.active = false;
    f.advance(REBUILD_SETTLE_MS);
    check();
    expect(rebuild).not.toHaveBeenCalled();
    f.shutdown();
    expect(f.listening).toBe(0);
  });
});
