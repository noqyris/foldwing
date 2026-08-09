/**
 * LevelSelectScene — a scrollable grid of level cards.
 *
 * Each card draws the level itself in miniature: real walls at real normalized
 * positions, the mirror axis, the start and the goal. It costs nothing (vector
 * primitives, no assets) and it does something a number in a box cannot — you
 * can see the asymmetry before you commit.
 *
 * Input goes through ScrollView rather than per-card interactive objects,
 * because scrolling and tapping are the same gesture until the finger has
 * committed to one, and only the thing that owns the drag can tell them apart.
 *
 * RENDERING. A card is a handful of tinted quads off two tiny shared textures,
 * not baked art. The set used to be baked into one atlas — fine at 100 levels,
 * but atlas height grows linearly with the level count, and at 300 it passes
 * 8192px, which is over MAX_TEXTURE_SIZE on the older iPhones (and ~70MB of
 * texture besides). Everything a card shows is a rectangle or a disc, and a
 * rectangle needs no texture at all: walls are NineSlices of a 12×12 rounded
 * square, dots are frames of a one-off 30px atlas, and the only per-card
 * raster is the number label's own Text canvas. Memory stays constant no
 * matter how many levels ship; the visible rows batch just as they did before
 * because they all share the same two textures.
 */

import Phaser from 'phaser';
import { LEVELS } from '../data/levels';
import type { Level } from '../data/types';
import { Haptics } from '../systems/Haptics';
import { Progress } from '../systems/Progress';
import { ScrollView, type ScrollRow } from '../render/ScrollView';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, pt, theme } from '../render/Theme';
import {
  button,
  enter,
  FONT,
  label,
  RADIUS,
  roundRect,
  softShadow,
  TYPE,
} from '../render/UI';

const COLS = 3;
const GAP = pt(10);
/** Levels per chapter — a finish line every twenty. */
const CHAPTER_SIZE = 20;

export class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelect');
  }

  create(): void {
    const t = theme();
    this.cameras.main.setBackgroundColor(t.paper);

    const cx = BASE_WIDTH / 2;
    const margin = METRICS.inset.left + pt(10);

    const back = button(this, margin + pt(30), pt(52), '‹', {
      width: pt(52),
      height: pt(44),
      variant: 'ghost',
      size: TYPE.title,
      onPress: () => {
        Haptics.tap();
        this.scene.start('Menu');
      },
    });

    const title = label(this, cx, pt(52), 'Levels', {
      size: TYPE.title,
      font: FONT.display,
    }).setOrigin(0.5, 0.5);

    const cleared = Progress.data.cleared.length;
    const counter = label(this, cx, pt(90), `${cleared} of ${LEVELS.length} folded`, {
      size: TYPE.label,
      alpha: 0.4,
    }).setOrigin(0.5, 0.5);

    /*
     * The scroll window stops short of the banner. The banner is a native view
     * sitting over the canvas, so a card underneath it can be seen but never
     * tapped — and a row you can see but cannot press reads as a broken app.
     */
    const top = pt(120);
    const bottom = BASE_HEIGHT - METRICS.bannerReserve - pt(6);

    const gridW = BASE_WIDTH - margin * 2;
    const cardW = (gridW - GAP * (COLS - 1)) / COLS;
    const cardH = cardW * 0.94;

    const content = this.add.container(0, top);
    const items: ScrollRow[] = [];
    this.bakePrimitives(cardW, cardH);

    /*
     * CHAPTERS. Three hundred cards in one wall read as a featureless climb;
     * a finish line every twenty is what makes progress feel like progress.
     * Chapters are purely presentational — a header row between grids — so
     * the level order and the save format know nothing about them. All
     * offsets are computed, not accumulated: the scroll-to-position below
     * needs a level's y without walking the whole list.
     */
    const headerBlock = pt(34) + pt(4);
    const chapterGrid = Math.ceil(CHAPTER_SIZE / COLS) * (cardH + GAP);
    const chapterSpan = headerBlock + chapterGrid + GAP;
    const cardY = (i: number): number =>
      GAP +
      Math.floor(i / CHAPTER_SIZE) * chapterSpan +
      headerBlock +
      Math.floor((i % CHAPTER_SIZE) / COLS) * (cardH + GAP) +
      cardH / 2;

    for (let c = 0; c * CHAPTER_SIZE < LEVELS.length; c++) {
      const a = c * CHAPTER_SIZE;
      const b = Math.min(LEVELS.length, a + CHAPTER_SIZE);
      const clearedIn = LEVELS.slice(a, b).filter((l) => Progress.hasCleared(l.id)).length;
      const hy = GAP + c * chapterSpan + pt(17);
      const head = label(this, margin + pt(2), hy, `Chapter ${c + 1} · ${a + 1}–${b}`, {
        size: TYPE.label,
        alpha: 0.45,
      }).setOrigin(0, 0.5);
      const tally = label(this, BASE_WIDTH - margin - pt(2), hy, `${clearedIn}/${b - a}`, {
        size: TYPE.label,
        alpha: 0.3,
      }).setOrigin(1, 0.5);
      content.add([head, tally]);
      items.push({ x: cx, y: hy, width: gridW, height: pt(34), view: head });
      items.push({ x: cx, y: hy, width: 0, height: pt(34), view: tally });
    }

    LEVELS.forEach((level, i) => {
      // Column from the position WITHIN the chapter: twenty is not divisible
      // by three, so a global i % COLS would shift every chapter sideways.
      const col = (i % CHAPTER_SIZE) % COLS;
      const x = margin + col * (cardW + GAP) + cardW / 2;
      // Content space: y = 0 is the top of the scrollable content.
      const y = cardY(i);

      const card = this.buildCardArt(level, i, cardW, cardH);
      card.setPosition(x, y);
      content.add(card);

      // Every card is registered, locked or not, because ScrollView is what
      // hides the off-screen ones — a locked card left out of this list would
      // stay drawn for the whole scroll and cost exactly what it costs now.
      const locked = !Progress.isUnlocked(i);
      items.push({
        x,
        y,
        width: cardW,
        height: cardH,
        view: card,
        onArm: locked
          ? undefined
          : (armed) => {
              this.tweens.killTweensOf(card);
              this.tweens.add({
                targets: card,
                scale: armed ? 0.95 : 1,
                duration: armed ? 90 : 260,
                ease: armed ? 'Quad.easeOut' : 'Back.easeOut',
              });
            },
        onTap: locked
          ? undefined
          : () => {
              Haptics.tap();
              this.scene.start('Game', { levelIndex: i });
            },
      });
    });

    /*
     * Clip the grid to its window with a second CAMERA rather than a mask.
     *
     * Both hide the cards that would otherwise run under the header or out
     * beneath the banner, but a geometry mask costs a full stencil pass every
     * frame — measured at ~8ms here, half the entire frame budget — whereas a
     * camera viewport is a GPU scissor rectangle and costs nothing.
     *
     * The two cameras have to be told to ignore each other's objects, so
     * anything added to this scene later must be added to one list or the
     * other or it will draw twice.
     */
    const grid = this.cameras.add(0, top, BASE_WIDTH, bottom - top);
    grid.setScroll(0, top);
    grid.ignore([back, title, counter]);
    this.cameras.main.ignore(content);

    const contentHeight = cardY(LEVELS.length - 1) + cardH / 2 + GAP;
    const view = new ScrollView(this, content, { top, bottom, contentHeight, items });

    // Open where the player actually is. Someone 60 levels in should not have
    // to drag past everything they already finished.
    const reached = Math.min(Progress.data.unlockedIndex, LEVELS.length - 1);
    if (reached > COLS * 3) {
      view.scrollTo(cardY(reached) - (bottom - top) / 2);
    }

    enter(this, [back, title, counter], 32);
  }

  /**
   * Bake the two textures every card shares, once per screen.
   *
   * Phaser re-runs a Graphics object's command list into the batch on every
   * frame, so cards cannot be Graphics — that measured 55ms a frame at 100
   * levels. But they need almost nothing baked either: the only pieces of a
   * card that are not plain rectangles are the chrome (rounded corners and a
   * drop shadow, identical for every card of the same state) and three little
   * discs. Those bake into a couple of hundred kilobytes; the walls
   * themselves are NineSlices of a 12×12 rounded square and the axis is the
   * engine's own white pixel, so texture cost does not grow with the level
   * count at all.
   */
  private bakePrimitives(w: number, h: number): void {
    const t = theme();
    const pad = pt(9);
    const slotW = Math.ceil(w + pad * 2);
    const slotH = Math.ceil(h + pad * 2);

    for (const key of [CHROME_KEY, MARKS_KEY]) {
      if (this.textures.exists(key)) this.textures.remove(key);
    }

    // Chrome: 'lit' (unlocked, with shadow) and 'dim' (locked) side by side.
    const chrome = this.make.renderTexture({ width: slotW * 2, height: slotH }, false);
    const g = this.add.graphics();
    softShadow(g, pad, pad, w, h, RADIUS.sm, 0.6);
    g.fillStyle(t.paper, 1);
    roundRect(g, pad, pad, w, h, RADIUS.sm);
    g.fillStyle(t.ink, 0.028);
    roundRect(g, pad, pad, w, h, RADIUS.sm);
    g.fillStyle(t.paper, 1);
    roundRect(g, slotW + pad, pad, w, h, RADIUS.sm);
    g.fillStyle(t.ink, 0.015);
    roundRect(g, slotW + pad, pad, w, h, RADIUS.sm);
    chrome.draw(g);
    g.destroy();
    chrome.saveTexture(CHROME_KEY);
    const ctex = this.textures.get(CHROME_KEY);
    ctex.add('lit', 0, 0, 0, slotW, slotH);
    ctex.add('dim', 0, slotW, 0, slotW, slotH);

    // Marks: start dot, goal ring, done mark and the wall's rounded square,
    // each at exactly the size it is shown — scaling a disc without mipmaps
    // is what makes little circles shimmer. White, so tint decides the color.
    // Frames must not overlap or a neighbour's pixels bleed into the slice.
    const marks = this.make.renderTexture({ width: pt(32), height: pt(9) }, false);
    const m = this.add.graphics();
    m.fillStyle(0xffffff, 1);
    m.fillCircle(pt(3.5), pt(4), pt(2.4));
    m.lineStyle(Math.max(1, pt(0.9)), 0xffffff, 1);
    m.strokeCircle(pt(11.5), pt(4), pt(3.2));
    m.fillStyle(0xffffff, 1);
    m.fillCircle(pt(20), pt(4), pt(3.5));
    // The wall frame is the NineSlice source: exactly the rounded square, no
    // transparent margin, or the slice edges would show seams.
    roundRect(m, pt(25), pt(1.5), pt(6), pt(6), pt(1.2));
    marks.draw(m);
    m.destroy();
    marks.saveTexture(MARKS_KEY);
    const mtex = this.textures.get(MARKS_KEY);
    mtex.add('dot', 0, pt(0.5), pt(1), pt(6), pt(6));
    mtex.add('ring', 0, pt(7.5), 0, pt(8), pt(8));
    mtex.add('mark', 0, pt(16), 0, pt(8), pt(8));
    mtex.add('wall', 0, pt(25), pt(1.5), pt(6), pt(6));

    // saveTexture hands the pixels to the TextureManager, which keeps its own
    // reference — destroying the RenderTexture alone would leak them.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      chrome.destroy();
      marks.destroy();
      for (const key of [CHROME_KEY, MARKS_KEY]) {
        if (this.textures.exists(key)) this.textures.remove(key);
      }
    });
  }

  private buildCardArt(
    level: Level,
    index: number,
    w: number,
    h: number
  ): Phaser.GameObjects.Container {
    const t = theme();
    const unlocked = Progress.isUnlocked(index);
    const done = Progress.hasCleared(level.id);

    const c = this.add.container(0, 0);
    // Locked cards dim ELEMENT BY ELEMENT, never via container alpha: group
    // alpha makes every child translucent, and translucent walls double-paint
    // wherever maze joints deliberately overlap.
    c.add(
      this.add.image(0, 0, CHROME_KEY, unlocked ? 'lit' : 'dim').setAlpha(unlocked ? 1 : 0.5)
    );

    const padX = pt(10);
    const padTop = pt(24);
    const padBottom = pt(18);
    this.buildPreview(
      c,
      level,
      -(w - padX * 2) / 2,
      -h / 2 + padTop,
      w - padX * 2,
      h - padTop - padBottom,
      unlocked
    );

    c.add(
      label(this, -w / 2 + pt(9), -h / 2 + pt(6), `${index + 1}`, {
        size: TYPE.micro,
        // 0.13 ≈ the old 0.25 under the container's removed 0.5 group alpha.
        alpha: unlocked ? 0.5 : 0.13,
      })
    );

    if (done) {
      // Gold once the level fell at or under the medal ratio of par —
      // the cleared-mark quietly upgrading is the whole trophy case.
      const medal = Progress.hasMedal(level.id);
      c.add(
        this.add
          .image(w / 2 - pt(11), -h / 2 + pt(11), MARKS_KEY, 'mark')
          .setTint(medal ? 0xc9a227 : t.accent)
          .setAlpha(0.9)
      );
    }

    return c;
  }

  /** The level drawn at card scale, from the same normalized data the game uses. */
  private buildPreview(
    into: Phaser.GameObjects.Container,
    level: Level,
    x: number,
    y: number,
    w: number,
    h: number,
    unlocked: boolean
  ): void {
    const t = theme();
    // The locked factor folds the removed container alpha (0.5) into the
    // per-element dim (0.5): same look, no group translucency.
    const dim = unlocked ? 1 : 0.25;

    into.add(
      this.add
        .image(x + w / 2 - pt(0.5), y, '__WHITE')
        .setOrigin(0, 0)
        .setDisplaySize(Math.max(1, pt(0.5)), h)
        .setTint(t.ink)
        .setAlpha(0.1 * dim)
    );

    // Walls paint OPAQUE in a pre-blended color instead of translucent wall
    // color: maze joints overlap on purpose, and alpha would stamp a darker
    // patch on every junction of every card.
    const wallTint = blendToward(t.paper, t.wall, 0.85 * dim);
    const corner = pt(1.2);
    for (const wall of level.walls) {
      const rw = wall.w * w;
      const rh = Math.max(pt(1.6), wall.h * h);
      // A NineSlice keeps the rounded corners honest at any size, but needs
      // room for them; the rare sliver below that threshold ships square.
      const view =
        rw > corner * 2.5 && rh > corner * 2.5
          ? this.add.nineslice(0, 0, MARKS_KEY, 'wall', rw, rh, corner + 1, corner + 1, corner + 1, corner + 1)
          : this.add.image(0, 0, '__WHITE').setDisplaySize(rw, rh);
      view
        .setOrigin(0, 0)
        .setPosition(x + wall.x * w, y + wall.y * h)
        .setTint(wallTint);
      into.add(view);
    }

    const sy = y + level.start.y * h;
    const gy = y + level.goal.y * h;
    const dot = (px: number, py: number, frame: string, alpha: number) =>
      into.add(
        this.add.image(px, py, MARKS_KEY, frame).setTint(t.accent).setAlpha(alpha * dim)
      );

    dot(x + level.start.x * w, sy, 'dot', 0.9);
    dot(x + level.goal.x * w, gy, 'ring', 0.9);
    dot(x + (1 - level.start.x) * w, sy, 'dot', 0.26);
    dot(x + (1 - level.goal.x) * w, gy, 'ring', 0.26);
  }
}

const CHROME_KEY = 'foldwing-card-chrome';
const MARKS_KEY = 'foldwing-card-marks';

/** The color `over` would appear at alpha `a` composited onto `base`. */
function blendToward(base: number, over: number, a: number): number {
  const mix = (b: number, o: number): number => Math.round(b + (o - b) * a);
  return (
    (mix((base >> 16) & 0xff, (over >> 16) & 0xff) << 16) |
    (mix((base >> 8) & 0xff, (over >> 8) & 0xff) << 8) |
    mix(base & 0xff, over & 0xff)
  );
}
