/**
 * GalleryScene — every figure the player has ever drawn.
 *
 * This is the reason the game is not another obstacle-avoider. The stroke is
 * freehand, so no two clears produce the same shape, and the wall of them is
 * both the reward for playing and the thing that leaves the phone when someone
 * shares one. Tap a figure to send it.
 */

import Phaser from 'phaser';
import { Playfield } from '../core/Playfield';
import { Haptics } from '../systems/Haptics';
import { Progress, type SavedFigure } from '../systems/Progress';
import { Share } from '../systems/Share';
import { ScrollView, type ScrollRow } from '../render/ScrollView';
import { paintFigureInto } from '../render/InkRenderer';
import { renderShareCard } from '../render/ShareCard';
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

export class GalleryScene extends Phaser.Scene {
  private pf!: Playfield;
  private busy = false;

  constructor() {
    super('Gallery');
  }

  create(): void {
    const t = theme();
    this.cameras.main.setBackgroundColor(t.paper);
    this.pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);

    const cx = BASE_WIDTH / 2;
    const margin = METRICS.inset.left + pt(10);

    const back = button(this, margin + pt(30), pt(56), '‹', {
      width: pt(52),
      height: pt(44),
      variant: 'ghost',
      size: TYPE.title,
      onPress: () => {
        Haptics.tap();
        this.scene.start('Menu');
      },
    });

    const title = label(this, cx, pt(56), 'Gallery', {
      size: TYPE.title,
      font: FONT.display,
    }).setOrigin(0.5, 0.5);

    const figures = Progress.figures;
    const subtitle = label(
      this,
      cx,
      pt(96),
      figures.length === 1 ? '1 figure' : `${figures.length} figures`,
      { size: TYPE.label, alpha: 0.4 }
    ).setOrigin(0.5, 0.5);

    const entering: Phaser.GameObjects.GameObject[] = [back, title, subtitle];

    if (figures.length === 0) {
      entering.push(
        label(this, cx, BASE_HEIGHT / 2 - pt(20), 'Nothing folded yet.', {
          size: TYPE.heading,
          alpha: 0.35,
          font: FONT.display,
        }).setOrigin(0.5)
      );
      entering.push(
        label(this, cx, BASE_HEIGHT / 2 + pt(16), 'Clear a level and its figure lands here.', {
          size: TYPE.label,
          alpha: 0.3,
        }).setOrigin(0.5)
      );
    } else {
      const top = pt(126);
      const bottom = BASE_HEIGHT - METRICS.bannerReserve - pt(6);
      const gridW = BASE_WIDTH - margin * 2;
      const cardW = (gridW - GAP * (COLS - 1)) / COLS;
      const cardH = cardW * 1.12;

      const content = this.add.container(0, top);
      const rows = Math.ceil(figures.length / COLS);
      const contentHeight = rows * (cardH + GAP) + GAP;
      const items: ScrollRow[] = [];
      const atlas = this.bakeFigures(figures, cardW, cardH);

      figures.forEach((figure, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = margin + col * (cardW + GAP) + cardW / 2;
        const y = GAP + row * (cardH + GAP) + cardH / 2;

        const card = this.add.image(x, y, atlas, String(i));
        content.add(card);

        items.push({
          x,
          y,
          width: cardW,
          height: cardH,
          // Each figure is a vector ribbon redrawn every frame, and this list
          // only grows as the player clears levels. Hide the off-screen ones.
          view: card,
          onArm: (armed) => {
            this.tweens.killTweensOf(card);
            this.tweens.add({
              targets: card,
              scale: armed ? 0.95 : 1,
              duration: armed ? 90 : 260,
              ease: armed ? 'Quad.easeOut' : 'Back.easeOut',
            });
          },
          onTap: () => void this.share(figure),
        });
      });

      // A camera viewport clips with a GPU scissor; a geometry mask costs a
      // stencil pass every frame. Same result, see LevelSelectScene.
      const grid = this.cameras.add(0, top, BASE_WIDTH, bottom - top);
      grid.setScroll(0, top);
      grid.ignore([back, title, subtitle]);
      this.cameras.main.ignore(content);

      new ScrollView(this, content, { top, bottom, contentHeight, items });
    }

    enter(this, entering, 26);
  }

  /**
   * Bake every figure card into ONE texture, once.
   *
   * A figure is a ribbon: dozens of quads and discs emitted as `fillPoints`
   * calls into a Graphics object, which Phaser replays and re-triangulates on
   * EVERY frame — nothing is cached just because nothing moved. Measured on
   * this scene: one saved figure took the Gallery from 16.7ms a frame to 583ms,
   * six figures to ~330ms, and 33 figures stopped it rendering at all. The save
   * keeps up to 120, so this screen was on a path to being unusable for exactly
   * the players who had used it most.
   *
   * The art is static, so it becomes a quad — the same fix as the level grid.
   */
  private bakeFigures(figures: readonly SavedFigure[], w: number, h: number): string {
    const key = 'foldwing-gallery-cards';
    if (this.textures.exists(key)) this.textures.remove(key);

    const pad = pt(9); // room for the drop shadow, which reaches past the card
    const slotW = Math.ceil(w + pad * 2);
    const slotH = Math.ceil(h + pad * 2);
    const cols = Math.max(1, Math.floor(2048 / slotW));
    const rows = Math.max(1, Math.ceil(figures.length / cols));

    const rt = this.make.renderTexture({ width: cols * slotW, height: rows * slotH }, false);

    figures.forEach((figure, i) => {
      const art = this.buildCardArt(figure, w, h);
      art.setPosition((i % cols) * slotW + slotW / 2, Math.floor(i / cols) * slotH + slotH / 2);
      rt.draw(art);
      art.destroy();
    });

    rt.saveTexture(key);
    const tex = this.textures.get(key);
    figures.forEach((_, i) => {
      tex.add(String(i), 0, (i % cols) * slotW, Math.floor(i / cols) * slotH, slotW, slotH);
    });

    // Destroying the RenderTexture is not enough — `saveTexture` hands the
    // TextureManager its own reference, so the memory outlives the scene.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      rt.destroy();
      if (this.textures.exists(key)) this.textures.remove(key);
    });
    return key;
  }

  private buildCardArt(
    figure: SavedFigure,
    w: number,
    h: number
  ): Phaser.GameObjects.Container {
    const t = theme();
    const c = this.add.container(0, 0);

    const g = this.add.graphics();
    softShadow(g, -w / 2, -h / 2, w, h, RADIUS.sm, 0.55);
    g.fillStyle(t.paper, 1);
    roundRect(g, -w / 2, -h / 2, w, h, RADIUS.sm);
    g.fillStyle(t.ink, 0.022);
    roundRect(g, -w / 2, -h / 2, w, h, RADIUS.sm);

    const pad = pt(9);
    paintFigureInto(
      g,
      figure.points.map((p) => this.pf.toScreen(p)),
      figure.times,
      this.pf.axisX,
      { x: -w / 2 + pad, y: -h / 2 + pad, w: w - pad * 2, h: h - pad * 2 - pt(14) }
    );
    c.add(g);

    c.add(
      label(this, 0, h / 2 - pt(11), `${(figure.ms / 1000).toFixed(1)}s`, {
        size: TYPE.micro,
        alpha: 0.32,
      }).setOrigin(0.5, 0.5)
    );

    return c;
  }

  private async share(figure: SavedFigure): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    Haptics.tap();

    try {
      const dataUrl = renderShareCard(figure, {
        caption: `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`,
      });
      if (!dataUrl) return;

      await Share.shareFigure({
        dataUrl,
        title: 'My foldwing',
        text: `One line, mirrored. ${figure.levelName} in ${(figure.ms / 1000).toFixed(1)}s.`,
        fileName: `foldwing-${figure.levelId}-${figure.at}.png`,
      });
    } finally {
      this.busy = false;
    }
  }
}
