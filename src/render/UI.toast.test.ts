import { describe, expect, it, vi } from 'vitest';

// UI.ts builds on Phaser, which cannot load without a browser. The queue under
// test touches none of it; a stand-in keeps the import from reaching the real
// module. The two classes are there for countUp's instanceof checks below, the
// scene states for toast()'s shut-down check (Phaser's own numbers).
vi.mock('phaser', () => ({
  default: {
    GameObjects: { Container: class {}, Text: class {} },
    Scenes: { SHUTDOWN: 8, Events: { SHUTDOWN: 'shutdown' } },
  },
}));

import Phaser from 'phaser';
import type { Vec2 } from '../core/Geometry';
import { panelFace } from './Baked';
import { blend, contrast, glassOver, ms, pt, setMotionScale, theme, ui } from './Theme';
import {
  buttonSubAlpha,
  COLUMN,
  countText,
  countUp,
  flameGlyph,
  flameGlyphOn,
  flyReward,
  PRESS_TINT,
  breathe,
  buttonFace,
  buttonInk,
  checkGlyph,
  compositeDims,
  CORNER_SEGMENTS,
  eyeGlyph,
  glyphIcon,
  glyphOf,
  label,
  lockGlyph,
  medalGlyph,
  roundRectPoints,
  pulse,
  setRestScale,
  toast,
  TOAST_H,
  TOAST_MAX_H,
  TOAST_TOP,
  toastLines,
  ToastQueue,
  type Tone,
} from './UI';

const item = (text: string, tone: Tone = 'plain') => ({ text, tone });

const drain = (q: ToastQueue): string[] => {
  const out: string[] = [];
  for (let t = q.next(); t; t = q.next()) out.push(t.text);
  return out;
};

describe('ToastQueue', () => {
  it('hands toasts out in the order they came', () => {
    const q = new ToastQueue();
    q.push(item('bookmark used', 'plain'));
    q.push(item('+1 free reveal', 'reward'));
    q.push(item('finish the tutorial first', 'warn'));
    expect(q.size).toBe(3);
    expect(drain(q)).toEqual(['bookmark used', '+1 free reveal', 'finish the tutorial first']);
    expect(q.next()).toBeNull();
    expect(q.size).toBe(0);
  });

  /*
   * Two reward lines queued are the same news twice, and the older one carries
   * a stale count ("you have 4" when there are now 5). The newer one replaces
   * it and takes its turn at the back, so what is shown stays in the order it
   * happened.
   */
  it('replaces a queued toast of the same tone with the newer one, at the back', () => {
    const q = new ToastQueue();
    q.push(item('+1 reveal · you have 4', 'reward'));
    q.push(item('streak saved', 'plain'));
    q.push(item('+2 reveals · you have 6', 'reward'));
    expect(q.size).toBe(2);
    expect(drain(q)).toEqual(['streak saved', '+2 reveals · you have 6']);
  });

  it('never lets one tone push out another', () => {
    const q = new ToastQueue();
    q.push(item('purchase cancelled', 'warn'));
    for (let i = 1; i <= 10; i++) q.push(item(`+${i}`, 'reward'));
    expect(drain(q)).toEqual(['purchase cancelled', '+10']);
  });

  it('holds at most three', () => {
    const q = new ToastQueue();
    const tones: Tone[] = ['plain', 'reward', 'warn'];
    for (let i = 0; i < 30; i++) q.push(item(`#${i}`, tones[i % 3]));
    expect(q.size).toBeLessThanOrEqual(3);
    // The three most recent, one of each tone, oldest first.
    expect(drain(q)).toEqual(['#27', '#28', '#29']);
  });

  it('drops the oldest when a smaller cap is passed', () => {
    const q = new ToastQueue(2);
    q.push(item('a', 'plain'));
    q.push(item('b', 'reward'));
    q.push(item('c', 'warn'));
    expect(q.size).toBe(2);
    expect(drain(q)).toEqual(['b', 'c']);
  });

  it('empties on clear', () => {
    const q = new ToastQueue();
    q.push(item('a'));
    q.push(item('b', 'reward'));
    q.clear();
    expect(q.size).toBe(0);
    expect(q.next()).toBeNull();
  });

  it('carries whatever else the caller queued with the text', () => {
    const q = new ToastQueue<{ text: string; tone: Tone; y: number }>();
    q.push({ text: 'x', tone: 'plain', y: 280 });
    expect(q.next()).toEqual({ text: 'x', tone: 'plain', y: 280 });
  });

  /*
   * QA round 1, D2: the answer to a tap on the locked Daily waited ~2 s behind
   * the entry gift toast. An urgent toast is a tap's answer; it goes first.
   */
  const urgent = (text: string, tone: Tone = 'warn') => ({ text, tone, urgent: true });

  it('puts an urgent toast ahead of everything waiting', () => {
    const q = new ToastQueue();
    q.push(item('+1 free reveal', 'reward'));
    q.push(item('streak saved', 'plain'));
    q.push(urgent('finish the tutorial first'));
    expect(q.size).toBe(3);
    expect(drain(q)).toEqual(['finish the tutorial first', '+1 free reveal', 'streak saved']);
  });

  it('keeps only the latest tap answer, whatever its tone', () => {
    const q = new ToastQueue();
    q.push(item('+1 free reveal', 'reward'));
    q.push(urgent('finish the tutorial first', 'warn'));
    q.push(urgent('unlimited reveals', 'plain'));
    expect(drain(q)).toEqual(['unlimited reveals', '+1 free reveal']);
  });

  it('never drops or replaces queued news for an urgent toast', () => {
    const q = new ToastQueue(2);
    q.push(item('+1 reveal · you have 4', 'reward'));
    q.push(item('purchase cancelled', 'warn'));
    // Same tone as a queued one, and past the cap: neither rule applies to it.
    q.push(urgent('nothing to restore', 'warn'));
    expect(q.size).toBe(3);
    expect(drain(q)).toEqual([
      'nothing to restore',
      '+1 reveal · you have 4',
      'purchase cancelled',
    ]);
  });

  it('empties the urgent slot on clear', () => {
    const q = new ToastQueue();
    q.push(urgent('a'));
    q.clear();
    expect(q.size).toBe(0);
    expect(q.next()).toBeNull();
  });
});

/*
 * The toast's text, set in at most two lines of the column. A character is one
 * unit wide here, so the numbers read as lengths.
 */
describe('toastLines', () => {
  const len = (s: string): number => s.length;

  it('keeps a text that fits on one line', () => {
    expect(toastLines('+1 free reveal', len, 20)).toEqual(['+1 free reveal']);
    expect(toastLines('exactly twenty chars', len, 20)).toEqual(['exactly twenty chars']);
  });

  it('breaks at a separator first, and drops the dot there', () => {
    // A space break would fit too ('Mission done · +1' / 'reveal'); the
    // separator is the game's own seam, so it wins.
    expect(toastLines('Mission done · +1 reveal', len, 20)).toEqual(['Mission done', '+1 reveal']);
  });

  it('picks the most even separator break that fits', () => {
    expect(toastLines('a · bbbbbbbb · cccccccc', len, 15)).toEqual(['a · bbbbbbbb', 'cccccccc']);
    expect(toastLines('aaaaaaa · bbbbbbb · cc', len, 15)).toEqual(['aaaaaaa', 'bbbbbbb · cc']);
  });

  it('breaks at the most even space when no separator break fits', () => {
    expect(toastLines('thank you for supporting Foldwing', len, 20)).toEqual([
      'thank you for',
      'supporting Foldwing',
    ]);
    // The owner's line QA measured past the column: its separator break fits.
    expect(toastLines('unlimited reveals · thank you for supporting Foldwing', len, 40)).toEqual([
      'unlimited reveals',
      'thank you for supporting Foldwing',
    ]);
  });

  it('hands back its most even pair when nothing fits, for the caller to scale', () => {
    expect(toastLines('aaaaaaaaaa bbbbbbbbbbbb', len, 5)).toEqual(['aaaaaaaaaa', 'bbbbbbbbbbbb']);
    expect(toastLines('x'.repeat(30), len, 10)).toEqual(['x'.repeat(30)]);
  });

  it('never runs to a third line, and never starts or ends a line on a dot', () => {
    const texts = [
      'Mission done · fold today’s Daily · +1 reveal',
      'Chapter 1 complete · +2 reveals · you have 7',
      'a · b · c · d · e · f · g · h · i · j · k · l',
      'unlimited reveals · thank you for supporting Foldwing',
    ];
    for (const text of texts) {
      for (const room of [4, 8, 12, 20, 30]) {
        const lines = toastLines(text, len, room);
        expect(lines.length, `${text} @${room}`).toBeLessThanOrEqual(2);
        for (const l of lines) {
          expect(l.trim(), `${text} @${room}`).toBe(l);
          expect(l.startsWith('·') || l.endsWith('·'), `${text} @${room}: "${l}"`).toBe(false);
        }
      }
    }
  });
});

/*
 * toast() itself, against a scene that records what it was asked to draw and
 * animate. Tweens finish when a test calls their onComplete.
 */
interface Recorded {
  op: string;
  args: unknown[];
}
type Recorder = Phaser.GameObjects.Graphics & { calls: Recorded[] };

/** A graphics stand-in: every call is recorded, and every call chains. */
const recorder = (): Recorder => {
  const calls: Recorded[] = [];
  const g: Recorder = new Proxy({} as Recorder, {
    get: (_o, k) =>
      k === 'calls'
        ? calls
        : (...args: unknown[]) => {
            calls.push({ op: String(k), args });
            return g;
          },
  });
  return g;
};

/** A text 12 base px a character wide: enough to lay a toast out by. */
class FakeLine {
  x = 0;
  y = 0;
  scaleX = 1;
  constructor(public text: string) {}
  get width(): number {
    return this.text.length * 12;
  }
  setOrigin(): this {
    return this;
  }
  setText(s: string): this {
    this.text = s;
    return this;
  }
  setScale(k: number): this {
    this.scaleX = k;
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
}

class FakePill {
  alpha = 1;
  readonly children: unknown[] = [];
  constructor(
    public scene: unknown,
    public x: number,
    public y: number
  ) {}
  setDepth(): this {
    return this;
  }
  setAlpha(a: number): this {
    this.alpha = a;
    return this;
  }
  add(o: unknown): this {
    this.children.push(...[o].flat());
    return this;
  }
  destroy(): void {
    this.scene = undefined;
  }
  get lines(): string[] {
    return this.children.filter((o): o is FakeLine => o instanceof FakeLine).map((l) => l.text);
  }
  /** The toast's face: the baked panel the pill was built on, at the size it was asked for. */
  get face(): { w: number; h: number } {
    for (const o of this.children) {
      const f = panelFace(o as object);
      if (f) return f;
    }
    return { w: Number.NaN, h: Number.NaN };
  }
}

/** A baked face stand-in: what `Baked.bakedPanel` makes on a renderer that cannot slice. */
class FakeImage {
  constructor(public x: number, public y: number, public key: string) {}
  setScale(): this {
    return this;
  }
  setAlpha(): this {
    return this;
  }
}

const toastScene = () => {
  const tweens: FakeTween[] = [];
  const killed: unknown[] = [];
  const pills: FakePill[] = [];
  const scene = {
    sys: { settings: { status: 5 }, game: { renderer: null } },
    events: { once: () => {} },
    cameras: { main: {}, cameras: [] },
    // Bakes paint into a recorder: the look is judged in the browser, the layout here.
    textures: {
      exists: () => false,
      createCanvas: () => ({ getContext: () => recorder(), refresh: () => {} }),
    },
    tweens: {
      add: (cfg: FakeTween['cfg']): FakeTween => {
        const tw = { cfg, stop: () => {} };
        tweens.push(tw);
        return tw;
      },
      killTweensOf: (target: unknown) => killed.push(target),
    },
    add: {
      container: (x: number, y: number): FakePill => {
        const c = new FakePill(scene, x, y);
        pills.push(c);
        return c;
      },
      graphics: recorder,
      text: (_x: number, _y: number, s: string) => new FakeLine(s),
      image: (x: number, y: number, key: string) => new FakeImage(x, y, key),
    },
  };
  /** Play the pill's latest tween to its end. */
  const finish = (pill: FakePill): void => {
    const tw = [...tweens].reverse().find((t) => t.cfg.targets === pill);
    tw?.cfg.onComplete?.();
  };
  return { scene: scene as unknown as Phaser.Scene, tweens, killed, pills, finish };
};

describe('toast', () => {
  it('shows an urgent toast now: the one on screen leaves in a quick fade', () => {
    const { scene, tweens, killed, pills, finish } = toastScene();
    toast(scene, '+1 free reveal for today · you have 3', { tone: 'reward' });
    const gift = pills[0];
    finish(gift); // in; its hold-and-leave is now scheduled
    toast(scene, 'streak saved'); // news: waits its turn
    expect(pills).toHaveLength(1);

    toast(scene, 'finish the tutorial first · 5 folds to go', { tone: 'warn', urgent: true });
    // The gift's hold is cancelled and a fade of at most 120 ms takes it off.
    expect(killed).toContain(gift);
    const hurry = tweens[tweens.length - 1].cfg;
    expect(hurry).toMatchObject({ targets: gift, alpha: 0, duration: ms(120) });
    expect(hurry.delay ?? 0).toBe(0);
    expect(hurry.duration as number).toBeLessThanOrEqual(120);

    finish(gift);
    expect(gift.scene).toBeUndefined();
    expect(pills[1].lines).toEqual(['finish the tutorial first · 5 folds to go']);

    // The news resumes after the answer.
    finish(pills[1]);
    finish(pills[1]);
    expect(pills[2].lines).toEqual(['streak saved']);
    finish(pills[2]);
    finish(pills[2]);
    expect(pills).toHaveLength(3);
  });

  it('shows an urgent toast at once when nothing is up', () => {
    const { scene, pills, killed } = toastScene();
    toast(scene, 'unlimited reveals', { urgent: true });
    expect(pills).toHaveLength(1);
    expect(killed).toHaveLength(0);
  });

  it('answers only the latest of two quick taps, with one fade', () => {
    const { scene, tweens, pills, finish } = toastScene();
    toast(scene, '+1 free reveal', { tone: 'reward' });
    const before = tweens.length;
    toast(scene, 'first answer', { urgent: true });
    toast(scene, 'second answer', { urgent: true });
    expect(tweens.length - before).toBe(1);
    finish(pills[0]);
    expect(pills[1].lines).toEqual(['second answer']);
    finish(pills[1]);
    finish(pills[1]);
    expect(pills).toHaveLength(2);
  });

  it('fades out on the reduced-motion clock', () => {
    setMotionScale(true);
    try {
      const { scene, tweens, pills } = toastScene();
      toast(scene, 'a');
      toast(scene, 'b', { urgent: true });
      expect(tweens[tweens.length - 1].cfg).toMatchObject({ targets: pills[0], duration: ms(120) });
      expect(ms(120)).toBeLessThan(120);
    } finally {
      setMotionScale(false);
    }
  });

  /* QA round 1: the owner's thank-you toast ran 19 px past the column. */
  it('is never wider than the column, and wraps to two centred lines', () => {
    const { scene, pills } = toastScene();
    toast(scene, 'unlimited reveals · thank you for supporting Foldwing');
    const pill = pills[0];
    expect(pill.lines).toEqual(['unlimited reveals', 'thank you for supporting Foldwing']);
    expect(pill.face.w).toBeLessThanOrEqual(COLUMN);
    expect(pill.face.h).toBe(TOAST_MAX_H);
    const [a, b] = pill.children.filter((o): o is FakeLine => o instanceof FakeLine);
    expect(a.x).toBe(0);
    expect(b.x).toBe(0);
    expect(a.y).toBe(-b.y);
    expect(b.y).toBeGreaterThan(0);
  });

  it('keeps a short text on one pill-height line', () => {
    const { scene, pills } = toastScene();
    toast(scene, 'bookmark used');
    expect(pills[0].lines).toEqual(['bookmark used']);
    expect(pills[0].face.h).toBe(TOAST_H);
    expect(pills[0].face.w).toBe('bookmark used'.length * 12 + pt(32));
  });

  /*
   * QA round 1, second pass: centred on pt(140), the two-line owner toast
   * reached up flush against the menu's mission strip.
   */
  it('hangs from one top edge by default, so a second line grows down', () => {
    const { scene, tweens, pills, finish } = toastScene();
    const restY = (pill: FakePill): number =>
      tweens.find((tw) => tw.cfg.targets === pill)?.cfg.y as number;
    toast(scene, 'bookmark used');
    toast(scene, 'unlimited reveals · thank you for supporting Foldwing');
    finish(pills[0]);
    finish(pills[0]);
    const [one, two] = pills;
    expect(two.face.h).toBe(TOAST_MAX_H);
    expect(restY(one)).toBe(pt(140));
    expect(restY(one) - one.face.h / 2).toBe(TOAST_TOP);
    expect(restY(two) - two.face.h / 2).toBe(TOAST_TOP);
    // It rises into place from below, as a one-line toast does.
    expect(two.y).toBe(restY(two) + pt(8));
  });

  it('centres on a line the caller names, whatever its height', () => {
    const { scene, tweens, pills } = toastScene();
    toast(scene, 'unlimited reveals · thank you for supporting Foldwing', { y: pt(300) });
    expect(pills[0].face.h).toBe(TOAST_MAX_H);
    expect(tweens.find((tw) => tw.cfg.targets === pills[0])?.cfg.y).toBe(pt(300));
  });

  it('scales down what cannot wrap, rather than cut it or run past the column', () => {
    const { scene, pills } = toastScene();
    toast(scene, 'x'.repeat(90), { icon: () => {} });
    const [line] = pills[0].children.filter((o): o is FakeLine => o instanceof FakeLine);
    expect(line.text).toBe('x'.repeat(90));
    expect(line.scaleX).toBeLessThan(1);
    expect(pills[0].face.w).toBeCloseTo(COLUMN, 6);
  });
});

/*
 * The kit's edges that a corrupt save or a stray NaN could reach. A scene
 * stand-in records the tweens asked for and lets a test finish them by hand.
 */
interface FakeTween {
  cfg: Record<string, unknown> & { onComplete?: () => void };
  stop: () => void;
}

const fakeScene = () => {
  const tweens: FakeTween[] = [];
  const scene = {
    tweens: {
      add: (cfg: FakeTween['cfg']): FakeTween => {
        const tw = { cfg, stop: () => {} };
        tweens.push(tw);
        return tw;
      },
    },
  } as unknown as Phaser.Scene;
  return { scene, tweens };
};

const lastOf = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

class FakeText extends (Phaser.GameObjects.Text as unknown as new () => object) {
  text = '';
  scene = {};
  scaleX = 1;
  scaleY = 1;
  setText(s: string): this {
    this.text = s;
    return this;
  }
  setScale(x: number, y = x): this {
    this.scaleX = x;
    this.scaleY = y;
    return this;
  }
}

const asText = (t: FakeText) => t as unknown as Phaser.GameObjects.Text;

describe('the unlimited sign', () => {
  // ∞ is what a Remove Ads owner paid for. A broken number must never wear it.
  it('is shown for +Infinity only', () => {
    expect(countText(Infinity)).toBe('∞');
    expect(countText(NaN)).toBe('0');
    expect(countText(-Infinity)).toBe('0');
    expect(countText(3.6)).toBe('4');
  });

  it('is never reached by counting to NaN', () => {
    const { scene, tweens } = fakeScene();
    const t = new FakeText();
    countUp(scene, asText(t), 3, NaN);
    // A plain count down to 0, not a flip: nothing folds the text shut.
    expect(tweens.some((tw) => tw.cfg.targets === t)).toBe(false);
    lastOf(tweens)?.cfg.onComplete?.();
    expect(t.text).toBe('0');

    countUp(scene, asText(t), NaN, NaN);
    expect(t.text).toBe('0');
  });

  it('flips in for a real infinity', () => {
    const { scene, tweens } = fakeScene();
    const t = new FakeText();
    countUp(scene, asText(t), 3, Infinity);
    expect(tweens[0].cfg).toMatchObject({ targets: t, scaleY: 0 });
    tweens[0].cfg.onComplete?.();
    expect(t.text).toBe('∞');
  });
});

describe('flyReward', () => {
  // The caller moves its counter in onLand; a count that is no number must
  // not leave it unmoved.
  it('lands at once when there is nothing to fly', () => {
    const { scene } = fakeScene();
    for (const count of [0, -2, NaN]) {
      const onLand = vi.fn();
      flyReward(scene, {
        from: { x: 0, y: 0 },
        to: () => ({ x: 0, y: 0 }),
        count,
        glyph: () => {},
        onLand,
      });
      expect(onLand, `count ${count}`).toHaveBeenCalledTimes(1);
    }
  });
});

describe('pulse', () => {
  const target = (s: number) => ({
    scene: {},
    scaleX: s,
    scaleY: s,
    setScale(x: number, y = x) {
      this.scaleX = x;
      this.scaleY = y;
      return this;
    },
  });
  const run = (tweens: FakeTween[]) => {
    for (let i = 0; i < tweens.length; i++) tweens[i].cfg.onComplete?.();
  };

  /*
   * A token landing while a finger holds a chip down finds it at the press
   * dip. The chip rests at 1, so the pulse must settle at 1, not at the dip,
   * whichever of it and the release finishes last.
   */
  it('settles a pressable at its rest scale, not at the dip it found', () => {
    const { scene, tweens } = fakeScene();
    const chip = target(0.965);
    setRestScale(chip);
    pulse(scene, chip as unknown as Phaser.GameObjects.Components.Transform, 0.1);
    expect(tweens[0].cfg.scaleX).toBeCloseTo(1.1, 9);
    run(tweens);
    expect(lastOf(tweens)?.cfg).toMatchObject({ scaleX: 1, scaleY: 1 });
  });

  it('takes the scale it finds as the rest for anything else', () => {
    const { scene, tweens } = fakeScene();
    const mark = target(0.5);
    pulse(scene, mark as unknown as Phaser.GameObjects.Components.Transform, 0.1);
    // A second landing mid-swell swells from the same rest: no ratchet.
    mark.setScale(0.53);
    pulse(scene, mark as unknown as Phaser.GameObjects.Components.Transform, 0.1);
    expect(tweens[1].cfg.scaleX).toBeCloseTo(0.55, 9);
    run(tweens);
    expect(lastOf(tweens)?.cfg).toMatchObject({ scaleX: 0.5, scaleY: 0.5 });
  });
});

/*
 * QA round 1, UX-2: the prices live on a button's second line, and read at
 * 4.1:1 on the secondary face. Every face is held to the 4.5:1 body floor, at
 * rest and pressed, on every surface a button sits on — the sky's base, the
 * lamp's shoulder, the deep edge, a sheet — and the line stays a step under
 * its caption.
 */
describe('button second line', () => {
  const t = theme();
  const u = ui();
  /** What a baked face's tint does to its colour: a per-channel multiply. */
  const tinted = (c: number, tint: number): number => {
    const ch = (s: number): number => Math.round((((c >> s) & 0xff) * ((tint >> s) & 0xff)) / 255);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  const SURFACES = { sky: u.sky, shoulder: 0x11303a, edge: u.skyEdge, sheet: u.sheet };
  for (const [where, under] of Object.entries(SURFACES)) {
    const faces = {
      // The gradient's darker end is the one dark ink reads worst on.
      primary: { text: u.onAccent, rest: u.accentBottom, pressed: tinted(u.accentBottom, PRESS_TINT.light) },
      secondary: { text: t.ink, rest: glassOver(under), pressed: tinted(glassOver(under), PRESS_TINT.dark) },
      accent: {
        text: t.accentText,
        rest: blend(t.accent, t.accentWash, under),
        pressed: tinted(blend(t.accent, t.accentWash, under), PRESS_TINT.dark),
      },
      // Bare at rest; glass under the thumb.
      ghost: { text: t.ink, rest: under, pressed: glassOver(under) },
    } as const;

    for (const [variant, f] of Object.entries(faces)) {
      it(`clears the body floor on the ${variant} face, over the ${where}`, () => {
        const a = buttonSubAlpha(variant as keyof typeof faces);
        expect(contrast(f.text, f.rest, a)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(f.text, f.pressed, a)).toBeGreaterThanOrEqual(4.5);
        // And the caption, at full strength, all the more.
        expect(contrast(f.text, f.rest)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('dips a light face only a little under the thumb, a dark one more', () => {
    // A darker tint on the tangerine would take the dark caption under the floor.
    expect(PRESS_TINT.light).toBeGreaterThan(PRESS_TINT.dark);
  });

  it('sits a step under the caption where the colour allows it', () => {
    // The caption is 0.94 of the foreground on the quiet faces.
    expect(buttonSubAlpha('secondary')).toBeGreaterThanOrEqual(0.78);
    expect(buttonSubAlpha('secondary')).toBeLessThan(0.94);
    expect(buttonSubAlpha()).toBe(buttonSubAlpha('primary'));
  });
});

/*
 * QA round 1, polish P1: the flame read as a water drop at 25 base px. What
 * only a flame has — a leaning outline with two tongues and the notch between
 * them — is pinned here on the pen-line flame; the look was judged in the
 * browser.
 */
describe('flameGlyph', () => {
  const draw = (glyph = flameGlyph, alpha = 0.9) => {
    const g = recorder();
    glyph(g, 100, 50, theme().accent, alpha);
    const fills = g.calls.filter((c) => c.op === 'fillStyle').map((c) => c.args);
    const [outer] = g.calls.filter((c) => c.op === 'strokePoints').map((c) => c.args[0] as Vec2[]);
    const [body] = g.calls.filter((c) => c.op === 'fillPoints').map((c) => c.args[0] as Vec2[]);
    const discs = g.calls.filter((c) => c.op === 'fillCircle').map((c) => c.args as number[]);
    return { g, fills, outer, body, discs };
  };

  const inside = (p: Vec2, poly: readonly Vec2[]): boolean => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        hit = !hit;
      }
    }
    return hit;
  };

  it('stands about pt(13) tall, centred on its point', () => {
    const { outer } = draw();
    const ys = outer.map((p) => p.y);
    const xs = outer.map((p) => p.x);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(h).toBeGreaterThan(pt(12));
    expect(h).toBeLessThan(pt(15));
    expect(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - 50)).toBeLessThan(pt(1));
    expect(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - 100)).toBeLessThan(pt(1));
  });

  it('has two tongues, the taller one right of centre', () => {
    const { outer } = draw();
    const n = outer.length;
    // Tips are where the outline turns back down on both sides (y grows down).
    const tips = outer.filter(
      (p, i) => p.y < outer[(i + n - 1) % n].y && p.y < outer[(i + 1) % n].y
    );
    expect(tips).toHaveLength(2);
    const [tall, short] = [...tips].sort((a, b) => a.y - b.y);
    const mid = (Math.max(...outer.map((p) => p.x)) + Math.min(...outer.map((p) => p.x))) / 2;
    expect(tall.x).toBeGreaterThan(mid + pt(0.5));
    expect(short.x).toBeLessThan(mid);
    // A second tongue, not a bump: the notch between the two is cut well below its tip.
    const midY = (Math.max(...outer.map((p) => p.y)) + Math.min(...outer.map((p) => p.y))) / 2;
    const notches = outer.filter(
      (p, i) => p.y < midY && p.y > outer[(i + n - 1) % n].y && p.y > outer[(i + 1) % n].y
    );
    expect(notches).toHaveLength(1);
    expect(notches[0].x).toBeGreaterThan(short.x);
    expect(notches[0].x).toBeLessThan(tall.x);
    expect(notches[0].y - short.y).toBeGreaterThan(pt(1.5));
  });

  it('is a pen line round a warm body of its own colour, burning from an ember', () => {
    const { fills, outer, body, discs } = draw();
    // The body: the same colour, a quarter of the line's strength.
    expect(fills[0]).toEqual([theme().accent, 0.9 * 0.25]);
    expect(body.length).toBeGreaterThan(8);
    // The ember: a disc of its own inside the flame, low in the bowl.
    const ember = discs[discs.length - 1];
    expect(inside({ x: ember[0], y: ember[1] }, outer)).toBe(true);
    expect(ember[1]).toBeGreaterThan(50);
  });

  it('draws the same flame on any face: the pen-line flame has no cut-out', () => {
    const a = draw(flameGlyph).g.calls;
    const b = draw(flameGlyphOn(theme().accent)).g.calls;
    expect(b).toEqual(a);
  });

  it('draws nothing at all when invisible', () => {
    const { g } = draw(flameGlyph, 0);
    expect(g.calls).toHaveLength(0);
  });
});


/*
 * G2: a live rounded rect is eight chords a corner — Phaser's own cut about a
 * hundred and re-triangulated them every frame — and its radius is clamped to
 * the box, which is what the old streaks across the page were.
 */
describe('roundRectPoints', () => {
  it('cuts each corner into eight chords, clockwise from the top-right', () => {
    const pts = roundRectPoints(0, 0, 100, 60, 20);
    expect(CORNER_SEGMENTS).toBe(8);
    expect(pts).toHaveLength(4 * (CORNER_SEGMENTS + 1));
    expect(pts[0].x).toBeCloseTo(80, 9);
    expect(pts[0].y).toBeCloseTo(0, 9);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(60 + 1e-9);
    }
  });

  it('clamps a pill radius to what the box can hold', () => {
    const pts = roundRectPoints(0, 0, 200, 40, 999);
    const xs = pts.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(200, 9);
    for (const p of pts) expect(p.y).toBeGreaterThanOrEqual(-1e-9);
  });

  it('is a plain box with no radius', () => {
    expect(roundRectPoints(1, 2, 3, 4, 0)).toHaveLength(4);
  });
});

/*
 * The page behind the canvas is a gradient now, so a scrim dims it with a
 * translucent layer (index.html body::after) rather than by recolouring it:
 * every open scrim composites into that one layer.
 */
describe('compositeDims', () => {
  it('is nothing with nothing open, and the layer itself with one', () => {
    expect(compositeDims([])).toEqual({ alpha: 0, color: 0 });
    expect(compositeDims([{ alpha: 0.5, color: 0x112233 }])).toEqual({ alpha: 0.5, color: 0x112233 });
  });

  it('stacks like the canvas does: alphas compound, the top colour weighs most', () => {
    const two = compositeDims([
      { alpha: 0.5, color: 0x000000 },
      { alpha: 0.5, color: 0xffffff },
    ]);
    expect(two.alpha).toBeCloseTo(0.75, 9);
    // Over any page p: black ½ then white ½ gives ¼p + 0.5·255 → as one layer of ¾ in 170.
    expect((two.color >> 16) & 0xff).toBe(170);
    // Over a page of 0 and one of 255 the stack and the single layer agree.
    for (const page of [0, 255]) {
      const stacked = (page * 0.5 + 0) * 0.5 + 255 * 0.5;
      const single = page * (1 - two.alpha) + ((two.color >> 16) & 0xff) * two.alpha;
      expect(single).toBeCloseTo(stacked, 0);
    }
  });
});

describe('breathe', () => {
  const target = () => ({ scaleX: 1, alpha: 1, setAlpha(a: number) { this.alpha = a; return this; } });
  const scene = () => {
    const tweens: Record<string, unknown>[] = [];
    return { tweens, s: { tweens: { add: (cfg: Record<string, unknown>) => (tweens.push(cfg), cfg) } } };
  };

  it('loops the one living thing: 2.4 s sine, 1 → 1.06, 0.6 → 1', () => {
    const { tweens, s } = scene();
    const t = target();
    const tw = breathe(s as unknown as Phaser.Scene, t as never);
    expect(tw).not.toBeNull();
    expect(tweens[0]).toMatchObject({ scaleX: 1.06, scaleY: 1.06, alpha: 1, yoyo: true, repeat: -1, duration: 1200 });
    expect(t.alpha).toBe(0.6);
  });

  // G7: every `repeat: -1` sits behind motionReduced().
  it('does not loop at all under reduced motion, and leaves the target settled', () => {
    setMotionScale(true);
    try {
      const { tweens, s } = scene();
      const t = target();
      t.alpha = 0.3;
      expect(breathe(s as unknown as Phaser.Scene, t as never)).toBeNull();
      expect(tweens).toHaveLength(0);
      expect(t.alpha).toBe(1);
    } finally {
      setMotionScale(false);
    }
  });
});

describe('glyphs are the pen-line family', () => {
  it('names the icon every kit glyph draws, so the kit can use the baked one', () => {
    expect(glyphIcon(eyeGlyph)).toBe('eye');
    expect(glyphIcon(flameGlyph)).toBe('flame');
    expect(glyphIcon(lockGlyph)).toBe('lock');
    expect(glyphIcon(checkGlyph)).toBe('check');
    expect(glyphIcon(medalGlyph)).toBe('medal');
    expect(glyphIcon(() => {})).toBeUndefined();
  });

  it('hands back one glyph per icon', () => {
    expect(glyphOf('gift')).toBe(glyphOf('gift'));
    expect(glyphIcon(glyphOf('share'))).toBe('share');
  });
});

describe('button faces', () => {
  it('bakes the primary as the tangerine gradient with its lamp, glass for secondary, a wash for accent', () => {
    const u = ui();
    expect(buttonFace('primary')).toMatchObject({ face: { kind: 'vertical', top: u.accentTop, bottom: u.accentBottom } });
    expect(buttonFace('primary')?.glow?.color).toBe(theme().accent);
    expect(buttonFace('secondary')).toMatchObject({ face: { kind: 'glass' }, elevation: 'e1' });
    expect(buttonFace('accent')).toMatchObject({ face: { kind: 'solid', color: theme().accent, alpha: theme().accentWash } });
    expect(buttonFace('ghost')).toBeNull();
  });

  it('writes dark ink on the tangerine, ember on the wash, cream on glass', () => {
    expect(buttonInk('primary')).toBe(ui().onAccent);
    expect(buttonInk('accent')).toBe(theme().accentText);
    expect(buttonInk('secondary')).toBe(theme().ink);
    expect(buttonInk('ghost')).toBe(theme().ink);
  });
});

describe('label', () => {
  const scene = () => {
    const made: { text: string; style: Record<string, unknown>; spacing: number }[] = [];
    return {
      made,
      s: {
        add: {
          text: (_x: number, _y: number, text: string, style: Record<string, unknown>) => {
            const o = { text, style, spacing: 0, setLetterSpacing(v: number) { o.spacing = v; return o; } };
            made.push(o);
            return o;
          },
        },
      },
    };
  };

  it('sets caps upper-cased and tracked, and weights through the font style', () => {
    const { made, s } = scene();
    label(s as unknown as Phaser.Scene, 0, 0, 'Day streak', { caps: true, weight: 600 });
    expect(made[0].text).toBe('DAY STREAK');
    expect(made[0].spacing).toBeGreaterThan(0);
    expect(made[0].style.fontStyle).toBe('600');
    label(s as unknown as Phaser.Scene, 0, 0, 'one line.', { italic: true, font: 'Georgia' });
    expect(made[1].style.fontStyle).toBe('italic');
    expect(made[1].style.fontFamily).toBe('Georgia');
  });

  it('writes in the foreground by default, on the system stack', () => {
    const { made, s } = scene();
    label(s as unknown as Phaser.Scene, 0, 0, 'x');
    expect(made[0].style.color).toBe(`rgba(244,237,225,1)`);
    expect(String(made[0].style.fontFamily)).toContain('"Helvetica Neue"');
    expect(made[0].style.fontStyle).toBeUndefined();
  });
});
