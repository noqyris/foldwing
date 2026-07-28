/**
 * LevelSelectScene — a scrollable grid of 100 level cards.
 *
 * Each card draws the level itself in miniature: real walls at real normalized
 * positions, the mirror axis, the start and the goal. It costs nothing (vector
 * primitives, no assets) and it does something a number in a box cannot — you
 * can see the asymmetry before you commit.
 *
 * Input goes through ScrollView rather than per-card interactive objects,
 * because scrolling and tapping are the same gesture until the finger has
 * committed to one, and only the thing that owns the drag can tell them apart.
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
    const rows = Math.ceil(LEVELS.length / COLS);
    const contentHeight = rows * (cardH + GAP) + GAP;

    const items: ScrollRow[] = [];
    const atlas = this.bakeCards(cardW, cardH);

    LEVELS.forEach((_level, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = margin + col * (cardW + GAP) + cardW / 2;
      // Content space: y = 0 is the top of the scrollable content.
      const y = GAP + row * (cardH + GAP) + cardH / 2;

      const card = this.add.image(x, y, atlas, String(i));
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

    const view = new ScrollView(this, content, { top, bottom, contentHeight, items });

    // Open where the player actually is. Someone 60 levels in should not have
    // to drag past everything they already finished.
    const reached = Math.min(Progress.data.unlockedIndex, LEVELS.length - 1);
    if (reached > COLS * 3) {
      const targetRow = Math.floor(reached / COLS);
      view.scrollTo(targetRow * (cardH + GAP) - (bottom - top) / 2);
    }

    enter(this, [back, title, counter], 32);
  }

  /**
   * Bake every card into ONE texture, once.
   *
   * Phaser re-runs a Graphics object's command list into the batch on every
   * frame — nothing about a card is cached just because nothing about it
   * changed. Measured on the 100-level grid with only the visible rows drawn:
   * the level previews cost 30ms per frame and the card backgrounds another
   * 25ms, against a 16ms budget, while the number labels cost nothing at all
   * because a Text is already a textured quad.
   *
   * So the cards become quads too. The art is drawn once into a single render
   * texture and every card is an Image pointing at its own frame of it, which
   * also means all 100 share one texture and batch into one draw call. The
   * 100 Text objects disappear into the bake as well, along with the canvas
   * each of them was allocating.
   */
  private bakeCards(w: number, h: number): string {
    const key = 'foldwing-level-cards';
    if (this.textures.exists(key)) this.textures.remove(key);

    // Room for the drop shadow, which reaches past the card's own box.
    const pad = pt(9);
    const slotW = Math.ceil(w + pad * 2);
    const slotH = Math.ceil(h + pad * 2);
    // Stay well inside the smallest max-texture-size we could meet.
    const cols = Math.max(1, Math.floor(2048 / slotW));
    const rows = Math.ceil(LEVELS.length / cols);

    const rt = this.make.renderTexture(
      { width: cols * slotW, height: rows * slotH },
      false
    );

    LEVELS.forEach((level, i) => {
      const art = this.buildCardArt(level, i, w, h);
      art.setPosition((i % cols) * slotW + slotW / 2, Math.floor(i / cols) * slotH + slotH / 2);
      rt.draw(art);
      art.destroy();
    });

    rt.saveTexture(key);
    const tex = this.textures.get(key);
    LEVELS.forEach((_, i) => {
      tex.add(String(i), 0, (i % cols) * slotW, Math.floor(i / cols) * slotH, slotW, slotH);
    });

    /*
     * The atlas is ~22MB; it must not outlive the screen. Destroying the
     * RenderTexture is NOT enough — `saveTexture` registers the underlying
     * texture with the TextureManager, which keeps its own reference, so the
     * memory survives the Game Object. Verified: without the explicit remove,
     * the atlas was still resident after returning to the menu.
     */
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      rt.destroy();
      if (this.textures.exists(key)) this.textures.remove(key);
    });
    return key;
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
    const g = this.add.graphics();

    if (unlocked) softShadow(g, -w / 2, -h / 2, w, h, RADIUS.sm, 0.6);
    g.fillStyle(t.paper, 1);
    roundRect(g, -w / 2, -h / 2, w, h, RADIUS.sm);
    g.fillStyle(t.ink, unlocked ? 0.028 : 0.015);
    roundRect(g, -w / 2, -h / 2, w, h, RADIUS.sm);
    c.add(g);

    const padX = pt(10);
    const padTop = pt(24);
    const padBottom = pt(18);
    c.add(
      this.buildPreview(
        level,
        -(w - padX * 2) / 2,
        -h / 2 + padTop,
        w - padX * 2,
        h - padTop - padBottom,
        unlocked
      )
    );

    c.add(
      label(this, -w / 2 + pt(9), -h / 2 + pt(6), `${index + 1}`, {
        size: TYPE.micro,
        alpha: unlocked ? 0.5 : 0.25,
      })
    );

    if (done) {
      const mark = this.add.graphics();
      mark.fillStyle(t.accent, 0.9);
      mark.fillCircle(w / 2 - pt(11), -h / 2 + pt(11), pt(3.5));
      c.add(mark);
    }

    if (!unlocked) c.setAlpha(0.5);
    return c;
  }

  /** The level drawn at card scale, from the same normalized data the game uses. */
  private buildPreview(
    level: Level,
    x: number,
    y: number,
    w: number,
    h: number,
    unlocked: boolean
  ): Phaser.GameObjects.Graphics {
    const t = theme();
    const g = this.add.graphics();
    const dim = unlocked ? 1 : 0.5;

    g.fillStyle(t.ink, 0.1 * dim);
    g.fillRect(x + w / 2 - pt(0.5), y, Math.max(1, pt(0.5)), h);

    g.fillStyle(t.wall, 0.85 * dim);
    for (const wall of level.walls) {
      const rw = wall.w * w;
      const rh = Math.max(pt(1.6), wall.h * h);
      roundRect(g, x + wall.x * w, y + wall.y * h, rw, rh, pt(1.2));
    }

    const sy = y + level.start.y * h;
    const gy = y + level.goal.y * h;

    g.fillStyle(t.accent, 0.9 * dim);
    g.fillCircle(x + level.start.x * w, sy, pt(2.4));
    g.lineStyle(Math.max(1, pt(0.9)), t.accent, 0.9 * dim);
    g.strokeCircle(x + level.goal.x * w, gy, pt(3.2));

    g.fillStyle(t.accent, 0.26 * dim);
    g.fillCircle(x + (1 - level.start.x) * w, sy, pt(2.4));
    g.lineStyle(Math.max(1, pt(0.9)), t.accent, 0.26 * dim);
    g.strokeCircle(x + (1 - level.goal.x) * w, gy, pt(3.2));

    return g;
  }
}
