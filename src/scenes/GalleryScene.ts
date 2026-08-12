/**
 * GalleryScene — every maze the player has ever solved, with their solution
 * still in it.
 *
 * This is the reason the game is not another obstacle-avoider. The stroke is
 * freehand, so no two clears produce the same shape, and the wall of them is
 * both the reward for playing and the thing that leaves the phone when someone
 * shares one. Tap a card to send it.
 *
 * The cards used to show the closed figure alone, floating on paper. It was a
 * handsome grid and it told you nothing: which maze, how hard, how the line got
 * there. Showing the whole board turns each card into a record of a specific
 * puzzle — and makes the grid legible to whoever the player sends one to, which
 * a symmetric blot never was.
 */

import Phaser from 'phaser';
import { Haptics } from '../systems/Haptics';
import { Progress, type SavedFigure } from '../systems/Progress';
import { Share } from '../systems/Share';
import { ScrollView, type ScrollRow } from '../render/ScrollView';
import { paintFigureInto } from '../render/InkRenderer';
import { CHALLENGE, renderShareCard, shareCardOptions, shareText } from '../render/ShareCard';
import { renderReplayVideo, replayVideoSupported } from '../render/ReplayVideo';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, pt, theme } from '../render/Theme';
import {
  button,
  enter,
  FONT,
  label,
  RADIUS,
  roundRect,
  progressCard,
  softShadow,
  TYPE,
} from '../render/UI';

const COLS = 3;
const GAP = pt(10);

/**
 * Card shape, as height ÷ width.
 *
 * The playfield is 702 × 1102 base pixels, so a card at 1.57 would hold the
 * maze corner to corner. 1.5 gives the same board a hair of side margin plus
 * the strip the time sits in, and keeps three across — two would read better
 * per card and cost more than twice the texture memory for a full gallery,
 * which at 120 saved figures is the number that actually matters.
 */
const CARD_ASPECT = 1.5;

/**
 * Largest atlas dimension.
 *
 * 2048 is the floor guaranteed by every GPU this ships to. The old code capped
 * the WIDTH here and let the height run — 120 figures baked a 2025 × 4802
 * texture, past the 4096 limit of anything older than an A11, where the whole
 * grid comes back blank. Both axes are bounded now and the cards spill into as
 * many atlases as they need.
 */
const ATLAS_MAX = 2048;

export class GalleryScene extends Phaser.Scene {
  private busy = false;
  private sheet: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Gallery');
  }

  create(): void {
    const t = theme();
    this.cameras.main.setBackgroundColor(t.paper);

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
      const cardH = cardW * CARD_ASPECT;

      const content = this.add.container(0, top);
      const rows = Math.ceil(figures.length / COLS);
      const contentHeight = rows * (cardH + GAP) + GAP;
      const items: ScrollRow[] = [];
      const slots = this.bakeFigures(figures, cardW, cardH);

      figures.forEach((figure, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = margin + col * (cardW + GAP) + cardW / 2;
        const y = GAP + row * (cardH + GAP) + cardH / 2;

        const slot = slots[i];
        const card = this.add.image(x, y, slot.key, slot.frame);
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
          onTap: () => this.chooseShare(figure),
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
   * Bake every card into texture atlases, once.
   *
   * A card is a ribbon over a maze: dozens of quads and discs emitted as
   * `fillPoints` calls into a Graphics object, which Phaser replays and
   * re-triangulates on EVERY frame — nothing is cached just because nothing
   * moved. Measured on this scene: one saved figure took the Gallery from
   * 16.7ms a frame to 583ms, six figures to ~330ms, and 33 figures stopped it
   * rendering at all. The save keeps up to 120, so this screen was on a path to
   * being unusable for exactly the players who had used it most.
   *
   * The art is static, so it becomes a quad — the same fix as the level grid.
   *
   * Several atlases rather than one, because a single sheet outgrew what the
   * hardware will hold: see ATLAS_MAX.
   */
  private bakeFigures(
    figures: readonly SavedFigure[],
    w: number,
    h: number
  ): { key: string; frame: string }[] {
    const pad = pt(9); // room for the drop shadow, which reaches past the card
    const slotW = Math.ceil(w + pad * 2);
    const slotH = Math.ceil(h + pad * 2);
    const cols = Math.max(1, Math.floor(ATLAS_MAX / slotW));
    const rows = Math.max(1, Math.floor(ATLAS_MAX / slotH));
    const perSheet = cols * rows;

    const keys: string[] = [];
    const slots: { key: string; frame: string }[] = [];

    for (let first = 0; first < figures.length; first += perSheet) {
      const batch = figures.slice(first, first + perSheet);
      const key = `foldwing-gallery-cards-${first}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      keys.push(key);

      // Only as tall as this batch needs: the last sheet is usually a row or
      // two, and a full-height one would be megabytes of empty texture.
      const sheetRows = Math.ceil(batch.length / cols);
      const rt = this.make.renderTexture(
        { width: cols * slotW, height: sheetRows * slotH },
        false
      );

      batch.forEach((figure, i) => {
        const art = this.buildCardArt(figure, w, h);
        art.setPosition(
          (i % cols) * slotW + slotW / 2,
          Math.floor(i / cols) * slotH + slotH / 2
        );
        rt.draw(art);
        art.destroy();
      });

      rt.saveTexture(key);
      const tex = this.textures.get(key);
      batch.forEach((_, i) => {
        const frame = String(i);
        tex.add(frame, 0, (i % cols) * slotW, Math.floor(i / cols) * slotH, slotW, slotH);
        slots.push({ key, frame });
      });

      // Destroying the RenderTexture is not enough — `saveTexture` hands the
      // TextureManager its own reference, so the memory outlives the scene.
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => rt.destroy());
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const key of keys) {
        if (this.textures.exists(key)) this.textures.remove(key);
      }
    });

    return slots;
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

    // Tighter than the old figure-only padding: the maze already carries the
    // playfield's own page margins, so padding it again shrinks it twice.
    const pad = pt(5);
    paintFigureInto(g, figure, {
      x: -w / 2 + pad,
      y: -h / 2 + pad,
      w: w - pad * 2,
      h: h - pad * 2 - pt(14),
    });
    c.add(g);

    c.add(
      label(this, 0, h / 2 - pt(11), `${(figure.ms / 1000).toFixed(1)}s`, {
        size: TYPE.micro,
        alpha: 0.32,
      }).setOrigin(0.5, 0.5)
    );

    return c;
  }

  /**
   * Tapping a card asks which of the two to send.
   *
   * The win screen can put both on the board side by side; a grid of cards
   * cannot, and a hidden long-press for the better one is a feature nobody
   * finds. One extra tap is the right price here — the gallery is somewhere you
   * browse, not the two-second window after a win where a second tap costs the
   * share.
   *
   * A card carries no failed attempts: those live in memory for the level being
   * played and are never saved (`Progress` already parses a hundred and twenty
   * figures at every launch). So the replay from here is the solution drawing
   * itself, which is what a gallery entry is — the run is a live thing, the
   * figure is what you keep.
   */
  private chooseShare(figure: SavedFigure): void {
    if (this.busy || this.sheet) return;
    Haptics.tap();

    const t = theme();
    const sheet = this.add.container(0, 0).setDepth(90);
    this.sheet = sheet;

    const dim = this.add
      .rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, t.ink, 0.22)
      .setInteractive();
    dim.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.closeSheet());
    sheet.add(dim);

    const rows: [string, () => void][] = [];
    if (replayVideoSupported()) {
      rows.push(['Share the replay', () => void this.shareReplay(figure)]);
    }
    rows.push(['Share this fold', () => void this.shareImage(figure)]);

    const cw = pt(272);
    const ROW = pt(44);
    const GAP = pt(9);
    const ch = pt(26) + pt(20) + pt(26) + rows.length * ROW + (rows.length - 1) * GAP + pt(16) + pt(30) + pt(20);
    const cy = BASE_HEIGHT / 2;
    const top = cy - ch / 2;

    const card = this.add.graphics();
    softShadow(card, BASE_WIDTH / 2 - cw / 2, top, cw, ch, RADIUS.md, 0.8);
    card.fillStyle(t.paper, 1);
    roundRect(card, BASE_WIDTH / 2 - cw / 2, top, cw, ch, RADIUS.md);
    sheet.add(card);

    sheet.add(
      label(
        this,
        BASE_WIDTH / 2,
        top + pt(36),
        `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`,
        { size: TYPE.body, font: FONT.display, alpha: 0.8 }
      ).setOrigin(0.5)
    );

    let rowY = top + pt(26) + pt(20) + pt(26) + ROW / 2;
    for (const [text, press] of rows) {
      sheet.add(
        button(this, BASE_WIDTH / 2, rowY, text, {
          width: cw - pt(30),
          height: ROW,
          variant: 'secondary',
          size: TYPE.label,
          onPress: () => {
            this.closeSheet();
            press();
          },
        })
      );
      rowY += ROW + GAP;
    }

    rowY += pt(16) - GAP;
    sheet.add(
      button(this, BASE_WIDTH / 2, rowY, 'Not now', {
        width: cw - pt(30),
        height: pt(30),
        variant: 'ghost',
        size: TYPE.label,
        onPress: () => this.closeSheet(),
      })
    );
  }

  private closeSheet(): void {
    this.sheet?.destroy(true);
    this.sheet = null;
  }

  private async shareImage(figure: SavedFigure): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const dataUrl = renderShareCard(figure, shareCardOptions(figure));
      if (!dataUrl) return;

      await Share.shareFigure({
        dataUrl,
        title: 'My foldwing',
        text: shareText(figure),
        fileName: `foldwing-${figure.levelId}-${figure.at}.png`,
      });
    } finally {
      this.busy = false;
    }
  }

  private async shareReplay(figure: SavedFigure): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const progress = progressCard(this, 'Folding your replay');

    try {
      const blob = await renderReplayVideo(
        {
          figure,
          // No misses to show: a saved figure is the solution, and that is what
          // this replay draws.
          attempts: [{ points: figure.points, times: figure.times, died: false }],
          caption: `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`,
          challenge: CHALLENGE,
        },
        (p) => progress.setProgress(p)
      );
      if (!blob) {
        progress.setMessage('could not build the replay');
        this.time.delayedCall(1600, () => progress.destroy());
        return;
      }
      progress.destroy();
      await Share.shareVideo({
        blob,
        title: 'My foldwing',
        text: shareText(figure),
        fileName: `foldwing-${figure.levelId}-${figure.at}.mp4`,
      });
    } finally {
      progress.destroy();
      this.busy = false;
    }
  }
}
