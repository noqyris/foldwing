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
 *
 * Night Fold: an album of prints on smoked glass. Each card holds a little
 * board under the lamp — slate walls, the crease — with the player's line
 * burning in it and its reflection in moonlight, painted by the same hand as
 * the Levels journey's discs (LevelSelectScene.paintFigureArt), laid out by
 * the share card's own arithmetic (FigureCard), so the print in the album is
 * the picture that leaves the phone.
 */

import Phaser from 'phaser';
import { ISO_DATE } from '../core/CalendarDay';
import { LEVELS } from '../data/levels';
import { Ads } from '../systems/Ads';
import { Haptics } from '../systems/Haptics';
import { Progress, type SavedFigure } from '../systems/Progress';
import {
  settlesWithin,
  Share,
  SHARE_DISMISS_WAIT_MS,
  SHARE_QUIET_MS,
  shareFileName,
} from '../systems/Share';
import { listFade, ScrollView, type ScrollRow } from '../render/ScrollView';
import { paintPanel, roundRectPath, type PanelSpec } from '../render/Baked';
import { dailyNumber } from '../render/DailyCard';
import { layoutFigureCard } from '../render/FigureCard';
import { icon } from '../render/Icons';
import { CHALLENGE, renderShareCard, shareCardOptions, shareText } from '../render/ShareCard';
import {
  REPLAY_CANCEL_AFTER_MS,
  REPLAY_CEILING_MS,
  renderReplayVideo,
  replayVideoSupported,
} from '../render/ReplayVideo';
import { BASE_WIDTH, dp, FONT_UI, hexCss, ms, pt, rgba, theme, ui, viewHeight } from '../render/Theme';
import {
  button,
  cardBlocker,
  dismissOnScrim,
  enter,
  FONT,
  keepCentred,
  label,
  mainCameraOnly,
  minTap,
  RADIUS,
  progressCard,
  scrim,
  sheetPanel,
  shieldInput,
  TYPE,
  watchHeight,
} from '../render/UI';
import { browseHeader, cardArt, LV, paintFigureArt, windowBottom } from './LevelSelectScene';

const COLS = 3;
const GAP = dp(10);

/** The grid starts this far under the title's line. */
const GRID_TOP = LV.titleRow + dp(34);

/**
 * Card shape, as height ÷ width.
 *
 * The print is the playfield (702 × 1102, 1.57 tall) inside a thin glass
 * margin, with the caption's band under it. Three across: two would read
 * better per card and cost more than twice the texture memory for a full
 * gallery, which at 120 saved figures is the number that actually matters.
 */
const CARD_ASPECT = 1.66;

/** The glass margin around a print, and the caption's band under it. */
const PRINT_INSET = dp(6);
const CAPTION_BAND = dp(24);

/**
 * Main-thread time the card bake may take per frame, in ms. At least one card
 * is baked every frame whatever it costs, so a slow card still arrives.
 */
const BAKE_BUDGET_MS = 8;

const BLANK_KEY = 'foldwing-gallery-blank';
const CARD_KEY = 'foldwing-gallery-card';

/** A card's glass: the kit's e1 glass, rounded like a tile. */
const cardSpec = (): PanelSpec => ({ radius: dp(18), face: { kind: 'glass', extra: 0.012 }, elevation: 'e1' });

/** Room around a card's face for its shadow, the same on every side of the bake. */
const CARD_PAD = dp(12);

/** "7.5 s" — the win card's form (ResultCard), so a time reads the same everywhere. */
const seconds = (msTime: number): string => `${(Math.max(0, msTime) / 1000).toFixed(1)} s`;

/**
 * The line under a card: which fold, then the time — "12 · 7.5 s" for a
 * campaign level, "Daily #54 · 7.5 s" for a Daily. The time alone used to be
 * the whole caption, so the grid read as a list of numbers rather than a
 * record of the campaign.
 *
 * The number is the level's position, which is what its id has always named
 * (`l${i + 1}`), so a figure that outlived its maze's content still says
 * where the player drew it. A Daily is its share-card number (`d${date}`, see
 * Daily); one from before #1 says "Daily fold". An id this build does not know
 * gets the time alone rather than a number it cannot vouch for.
 */
export function figureCaption(figure: Pick<SavedFigure, 'levelId' | 'ms'>): string {
  const time = seconds(figure.ms);
  const id = figure.levelId;
  if (id.startsWith('d') && ISO_DATE.test(id.slice(1))) {
    const n = dailyNumber(id.slice(1));
    return `${n > 0 ? `Daily #${n}` : 'Daily fold'} · ${time}`;
  }
  const i = LEVELS.findIndex((l) => l.id === id);
  return i < 0 ? time : `${i + 1} · ${time}`;
}

/** The print's box inside a card `w` × `h` whose face starts at (x, y): the playfield's shape, centred. */
export function printBox(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const room = { w: w - PRINT_INSET * 2, h: h - PRINT_INSET - CAPTION_BAND };
  // The board's own aspect, fitted: a print never stretches the maze.
  const aspect = 1102 / 702;
  const pw = Math.min(room.w, room.h / aspect);
  const ph = pw * aspect;
  return { x: x + (w - pw) / 2, y: y + PRINT_INSET + (room.h - ph) / 2, w: pw, h: ph };
}

/**
 * Paint one album card, its face at (x, y) `w` × `h`: the print — a little
 * board with the maze and the player's line in it — and its caption. The
 * glass under it is `face`, painted once per visit and stamped here.
 */
export function paintGalleryCard(
  ctx: CanvasRenderingContext2D,
  figure: SavedFigure,
  x: number,
  y: number,
  w: number,
  h: number,
  face: CanvasImageSource | null
): void {
  const t = theme();
  const u = ui();
  if (face) ctx.drawImage(face, x - CARD_PAD, y - CARD_PAD);
  const box = printBox(x, y, w, h);
  const r = dp(12);
  // The board: the sheet under the lamp, lighter at its centre.
  ctx.save();
  roundRectPath(ctx, box.x, box.y, box.w, box.h, r);
  const g = ctx.createRadialGradient(
    box.x + box.w / 2,
    box.y + box.h * 0.42,
    0,
    box.x + box.w / 2,
    box.y + box.h / 2,
    box.h * 0.62
  );
  g.addColorStop(0, hexCss(t.boardCentre));
  g.addColorStop(1, hexCss(t.board));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // The far half, turned from the lamp.
  const far = ctx.createLinearGradient(box.x + box.w / 2, 0, box.x + box.w, 0);
  far.addColorStop(0, rgba(0x000000, u.farShade * 0.6));
  far.addColorStop(0.22, rgba(0x000000, u.farShadeMid * 0.6));
  far.addColorStop(1, rgba(0x000000, 0));
  ctx.fillStyle = far;
  ctx.fillRect(box.x + box.w / 2, box.y, box.w / 2, box.h);
  const L = layoutFigureCard(figure, { x: box.x + dp(3), y: box.y + dp(3), w: box.w - dp(6), h: box.h - dp(6) });
  if (L) paintFigureArt(ctx, cardArt(L), { lineWidth: Math.max(2.2, L.nib * 1.05), walls: true, markers: 'card' });
  ctx.restore();
  ctx.strokeStyle = rgba(u.glass, 0.08);
  ctx.lineWidth = 1;
  roundRectPath(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, r);
  ctx.stroke();

  // The caption, shrunk to fit a narrow card rather than run past it.
  const text = figureCaption(figure);
  let size = TYPE.micro * 1.05;
  ctx.font = `600 ${size}px ${FONT_UI}`;
  const room = w - dp(12);
  const width = ctx.measureText(text).width;
  if (width > room) {
    size *= room / width;
    ctx.font = `600 ${size}px ${FONT_UI}`;
  }
  ctx.fillStyle = hexCss(u.text2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h - CAPTION_BAND / 2 - dp(1));
}

export class GalleryScene extends Phaser.Scene {
  private busy = false;
  private sheet: Phaser.GameObjects.Container | null = null;
  /** The share in flight, settled when its sheet goes — see `pressBack`. */
  private shareSettled: Promise<void> | null = null;
  /** Taps are the share sheet's until then — see SHARE_QUIET_MS. */
  private shareQuietUntil = 0;
  /** A ‹ tap is waiting to learn whether it closed a share. */
  private backPending = false;
  /** Bumped by every visit: a late answer must not act on the next one. */
  private visit = 0;
  /** Rebuilds for a new world height, once nothing is open — see UI.watchHeight. */
  private heightCheck: () => void = () => undefined;

  constructor() {
    super('Gallery');
  }

  /**
   * `scroll`: this screen rebuilt for a new world height (UI.watchHeight) —
   * opened scrolled where it was, without the entrance.
   */
  create(data: { scroll?: number } = {}): void {
    const rebuilt = typeof data.scroll === 'number' && Number.isFinite(data.scroll) ? data.scroll : null;
    delete data.scroll;
    // Fields outlive the scene; a visit starts with nothing open or pending.
    this.sheet = null;
    this.busy = false;
    this.shareSettled = null;
    this.shareQuietUntil = 0;
    this.backPending = false;
    this.visit += 1;

    const u = ui();
    const cx = BASE_WIDTH / 2;
    const figures = Progress.figures;
    const { back, head } = browseHeader(this, 'Gallery', () => this.pressBack(), {
      row: [
        [
          {
            icon: 'gallery',
            iconColor: theme().accentText,
            text: figures.length === 1 ? '1 figure' : `${figures.length} figures`,
          },
        ],
      ],
    });
    const entering: Phaser.GameObjects.GameObject[] = [head, back];

    // The empty page is centred on the world as tall as it is.
    const cy = viewHeight() / 2;
    let view: ScrollView | null = null;
    if (figures.length === 0) {
      entering.push(icon(this, cx, cy - dp(64), 'gallery', { size: dp(44), color: u.text3 }));
      entering.push(
        label(this, cx, cy - pt(14), 'Nothing folded yet.', {
          size: TYPE.heading,
          color: u.text2,
          font: FONT.display,
        }).setOrigin(0.5)
      );
      entering.push(
        label(this, cx, cy + pt(18), 'Clear a level and its figure lands here.', {
          size: TYPE.label,
          color: u.text2,
        }).setOrigin(0.5)
      );
      entering.push(this.emptyCta(cx, cy + pt(88)));
    } else {
      const top = GRID_TOP;
      // `Ads.enabled` is the banner's own condition (see Ads.showBanner); the
      // window stops 8 pt on the glass above its line.
      const bannerOn = Ads.enabled;
      const bottom = windowBottom(viewHeight(), bannerOn, this.scale.displayScale.y);
      const gridW = BASE_WIDTH - LV.side * 2;
      const cardW = Math.floor((gridW - GAP * (COLS - 1)) / COLS);
      const cardH = Math.round(cardW * CARD_ASPECT);

      const content = this.add.container(0, top);
      const rows = Math.ceil(figures.length / COLS);
      const contentHeight = rows * (cardH + GAP) + GAP + dp(24);
      const items: ScrollRow[] = [];
      const cards: Phaser.GameObjects.Image[] = [];
      this.bakeBlank(cardW, cardH);

      figures.forEach((figure, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = LV.side + col * (cardW + GAP) + cardW / 2;
        const y = GAP + row * (cardH + GAP) + cardH / 2;

        // The bare glass until its print is baked — see `bakeFigures`.
        const card = this.add.image(x, y, BLANK_KEY);
        cards.push(card);
        content.add(card);

        items.push({
          x,
          y,
          width: cardW,
          height: cardH,
          // Hide the off-screen ones: this list only grows as the player clears levels.
          view: card,
          onArm: (armed) => {
            this.tweens.killTweensOf(card);
            this.tweens.add({
              targets: card,
              scale: armed ? 0.95 : 1,
              duration: ms(armed ? 90 : 260),
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
      grid.ignore([back, head]);
      this.cameras.main.ignore(content);
      /*
       * The grid renders FIRST and the main camera over it.
       *
       * The share sheet and the replay card are drawn by the main camera
       * alone (see `mainCameraOnly` — drawn by both, the scrim composited
       * twice inside this window). A camera added later renders later, so in
       * the default order the grid then painted the cards straight over the
       * sheet. With the main camera last its own fill would hide the grid the
       * same way, so it has none: the sky is drawn under every scene.
       */
      const cams = this.cameras.cameras;
      cams.splice(cams.indexOf(grid), 1);
      cams.unshift(grid);
      this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');

      // The window's soft edges, over the grid on its own camera (see listFade).
      const fades = { top: listFade(this, top, bottom, 'top'), bottom: listFade(this, top, bottom, 'bottom') };
      for (const f of [fades.top, fades.bottom]) {
        if (!f) continue;
        f.setDepth(5);
        this.cameras.main.ignore(f);
      }

      view = new ScrollView(this, content, {
        top,
        bottom,
        contentHeight,
        items,
        // Nothing behind the share sheet scrolls or arms while it is up.
        blocked: () => this.sheet !== null,
        fades,
      });
      if (rebuilt !== null) view.scrollTo(rebuilt);
      /*
       * A shorter world cuts the window to the banner's new line at once —
       * under the share sheet and through a share too, which the rebuild
       * waits out (below).
       */
      const list = view;
      const follow = (): void => {
        const now = Math.min(bottom, windowBottom(viewHeight(), bannerOn, this.scale.displayScale.y));
        grid.setSize(grid.width, Math.max(0, now - top));
        list.clip(now);
      };
      this.scale.on(Phaser.Scale.Events.RESIZE, follow);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, follow));
      this.bakeFigures(figures, cards, cardW, cardH);
    }

    /*
     * A new world height rebuilds the grid — its window and its clipping
     * camera are fixed at build — where it was. Not from under the share
     * sheet or a share in flight: the sheet stays centred (keepCentred), and
     * closing it, or the share settling, asks again.
     */
    const scrolled = view;
    this.heightCheck = watchHeight(
      this,
      () => this.scene.restart({ scroll: scrolled ? scrolled.scrolled : 0 }),
      () => this.sheet !== null || this.busy
    );

    if (rebuilt === null) enter(this, entering, 26);
  }

  /**
   * The way out of an empty gallery: into the level that would fill it.
   *
   * The empty screen used to end in a sentence, so the only move from it was ‹
   * and then Play from the Menu. The button says what the Menu's would — Play
   * level 1 for a new player, Continue at the frontier for one whose figures
   * are simply gone — and acts on the same index, clamped the same way (see
   * MenuScene). With every level already cleared there is no frontier to go
   * to, so it opens Levels instead.
   */
  private emptyCta(x: number, y: number): Phaser.GameObjects.Container {
    const save = Progress.data;
    const nextIndex = Math.min(Math.max(0, save.unlockedIndex), LEVELS.length - 1);
    const resuming = nextIndex > 0 || save.totalWins > 0;
    const allCleared = LEVELS.every((l) => Progress.hasCleared(l.id));
    const height = resuming ? pt(66) : pt(54);
    const go = (key: string, data?: object): void => {
      Haptics.tap();
      this.scene.start(key, data);
    };
    return button(
      this,
      x,
      y,
      allCleared ? 'Replay a fold' : resuming ? 'Continue' : 'Play level 1',
      {
        width: pt(260),
        height,
        variant: 'primary',
        sub: allCleared
          ? undefined
          : resuming
            ? `${nextIndex + 1}. ${LEVELS[nextIndex].name}`
            : undefined,
        // Alone on the page: the floor can grow freely, up to a band that
        // still clears the line of text above it.
        minTap: true,
        maxTap: height + pt(36),
        onPress: () =>
          allCleared ? go('LevelSelect') : go('Game', { levelIndex: nextIndex }),
      }
    );
  }

  /**
   * Bake every card — a few per frame, behind blanks.
   *
   * A card is a maze and a line: dozens of walls and a few hundred samples.
   * Drawn live as Graphics, Phaser replays and re-triangulates it on EVERY
   * frame — measured on this scene: one saved figure took the Gallery from
   * 16.7ms a frame to 583ms, and 33 stopped it rendering at all. The save
   * keeps up to 120. The art is static, so each card is painted once with
   * Canvas2D into its own texture and drawn as a quad; cards batch across
   * textures, so this costs no more draw calls than one atlas did.
   *
   * NOT all in create(). Baking every card before the first frame froze the
   * menu for the whole bake with nothing on screen — 2.8s in Chrome and 4.6s
   * in WebKit at 120 figures, on every visit. The grid appears at once with
   * bare glass, and each frame bakes what fits in BAKE_BUDGET_MS, the cards on
   * screen first, so what the player is looking at fills in within a few
   * frames and the rest arrives before anyone scrolls to it.
   */
  private bakeFigures(
    figures: readonly SavedFigure[],
    cards: readonly Phaser.GameObjects.Image[],
    w: number,
    h: number
  ): void {
    const slotW = Math.ceil(w + CARD_PAD * 2);
    const slotH = Math.ceil(h + CARD_PAD * 2);
    const face = this.textures.exists(CARD_KEY)
      ? (this.textures.get(CARD_KEY).getSourceImage() as HTMLCanvasElement)
      : null;
    const keys: string[] = [];
    const baked = new Array<boolean>(figures.length).fill(false);
    let left = figures.length;

    const bakeOne = (i: number): void => {
      baked[i] = true;
      left--;
      const key = `foldwing-gallery-${this.visit}-${i}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      const tex = this.textures.createCanvas(key, slotW, slotH);
      if (!tex) return;
      paintGalleryCard(tex.getContext(), figures[i], CARD_PAD, CARD_PAD, w, h, face);
      tex.refresh();
      keys.push(key);
      cards[i].setTexture(key);
    };

    // The cards the ScrollView is showing, then the rest top to bottom.
    const next = (): number => {
      let firstLeft = -1;
      for (let i = 0; i < baked.length; i++) {
        if (baked[i]) continue;
        if (cards[i].visible) return i;
        if (firstLeft < 0) firstLeft = i;
      }
      return firstLeft;
    };

    const step = (): void => {
      const started = performance.now();
      do {
        const i = next();
        if (i < 0) break;
        bakeOne(i);
      } while (left > 0 && performance.now() - started < BAKE_BUDGET_MS);
      if (left === 0) this.events.off(Phaser.Scenes.Events.UPDATE, step);
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, step);

    // Created textures live in the TextureManager until they are removed.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, step);
      for (const key of [...keys, BLANK_KEY, CARD_KEY]) {
        if (this.textures.exists(key)) this.textures.remove(key);
      }
    });
  }

  /**
   * The glass a print sits on, with no print yet: what shows until the card
   * is baked, and the face every bake stamps under its print.
   */
  private bakeBlank(w: number, h: number): void {
    const slotW = Math.ceil(w + CARD_PAD * 2);
    const slotH = Math.ceil(h + CARD_PAD * 2);
    for (const key of [CARD_KEY, BLANK_KEY]) {
      if (this.textures.exists(key)) this.textures.remove(key);
    }
    const face = this.textures.createCanvas(CARD_KEY, slotW, slotH);
    if (face) {
      paintPanel(face.getContext(), CARD_PAD, CARD_PAD, w, h, cardSpec());
      face.refresh();
    }
    const blank = this.textures.createCanvas(BLANK_KEY, slotW, slotH);
    if (!blank) return;
    const ctx = blank.getContext();
    if (face) ctx.drawImage(face.getSourceImage() as HTMLCanvasElement, 0, 0);
    // The print's place, dark and empty, so the grid reads as cards at once.
    const box = printBox(CARD_PAD, CARD_PAD, w, h);
    roundRectPath(ctx, box.x, box.y, box.w, box.h, dp(12));
    ctx.fillStyle = hexCss(theme().board);
    ctx.fill();
    blank.refresh();
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
    // Not from the tap that closed a share sheet — see SHARE_QUIET_MS.
    if (this.busy || this.sheet || performance.now() < this.shareQuietUntil) return;
    Haptics.tap();

    const sheet = keepCentred(this.add.container(0, 0).setDepth(90));
    this.sheet = sheet;
    // Main camera only — the grid camera drew it a second time inside its
    // window, see `mainCameraOnly`.
    mainCameraOnly(this, sheet);

    /*
     * Every tap that closes the sheet raises a short shield: the grid under
     * the sheet takes taps again the moment it is gone, and the second tap
     * of a double tap would open the card that was underneath.
     */
    const close = (): void => {
      shieldInput(this);
      this.closeSheet();
    };

    // The night scrim, the page's bands dimmed with it for as long as it lives.
    const cy = viewHeight() / 2;
    const dim = scrim(this, BASE_WIDTH / 2, cy);
    dismissOnScrim(dim, close);
    sheet.add(dim);

    const rows: [string, () => void][] = [];
    if (replayVideoSupported()) {
      rows.push(['Share the replay', () => void this.shareReplay(figure)]);
    }
    rows.push(['Share this fold', () => void this.shareImage(figure)]);

    const cw = pt(272);
    const ROW = pt(44);
    const GAP = pt(9);
    /*
     * The rows are tapped at the thumb's floor, which is in points: on a canvas
     * drawn under about 0.47 (an SE with Display Zoom draws it at 0.41, floor
     * 108) two areas grown from rows pt(53) apart overlapped, and a tap
     * between the two shares could send either. So the pitch opens to the
     * floor and a point of air wherever that is more — and so do the step
     * down to "Not now" and the card's edge under it. The areas are capped at
     * the room built here, so a later resize cannot grow them into each other.
     */
    const floor = minTap(this);
    const pitch = Math.max(ROW + GAP, floor + pt(1));
    const toNotNow = Math.max(ROW + pt(16), floor + pt(1));
    const underNotNow = Math.max(pt(28), floor / 2 + pt(1));
    const ch =
      pt(26) + pt(20) + pt(26) + ROW / 2 + (rows.length - 1) * pitch + toNotNow + underNotNow;
    const top = cy - ch / 2;

    // Opaque: a card over a scrim hides what is under it rather than showing it through.
    sheet.add(sheetPanel(this, BASE_WIDTH / 2, cy, cw, ch, RADIUS.lg));
    // The title, the padding and the gap above "Not now" are the sheet, not
    // the way out of it.
    sheet.add(cardBlocker(this, BASE_WIDTH / 2, cy, cw, ch));

    // The title in the win card's share sheet's form (GameScene), not the
    // caption's: the same figure's sheet reads the same from either screen.
    sheet.add(
      label(
        this,
        BASE_WIDTH / 2,
        top + pt(36),
        `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`,
        { size: TYPE.body, font: FONT.display, color: ui().text }
      ).setOrigin(0.5)
    );

    let rowY = top + pt(26) + pt(20) + pt(26) + ROW / 2;
    for (const [text, press] of rows) {
      sheet.add(
        button(this, BASE_WIDTH / 2, rowY, text, {
          width: cw - pt(30),
          height: ROW,
          // Drawn at 44pt, which is 44pt on the glass only at one scale.
          minTap: true,
          maxTap: pitch - pt(1),
          variant: 'secondary',
          size: TYPE.label,
          onPress: () => {
            close();
            press();
          },
        })
      );
      rowY += pitch;
    }

    rowY += toNotNow - pitch;
    sheet.add(
      button(this, BASE_WIDTH / 2, rowY, 'Not now', {
        width: cw - pt(30),
        height: pt(30),
        // 44pt to the thumb, still pt(16) clear of the row above and inside
        // the card's bottom edge.
        minTap: true,
        maxTap: Math.min(toNotNow - pt(1), 2 * underNotNow - pt(1)),
        variant: 'ghost',
        size: TYPE.label,
        onPress: close,
      })
    );
  }

  private closeSheet(): void {
    this.sheet?.destroy(true);
    this.sheet = null;
    /*
     * The world may have changed height under the sheet: rebuild now it is
     * gone — on the next step, not in this call. A share row closes the sheet
     * and THEN starts its share (runShare sets `busy` at once), so a check
     * made here saw nothing busy and queued a restart the share then ran
     * straight into: the new visit dropped the progress card's timers — the
     * Cancel offer, the REPLAY_CEILING_MS abort that guarantees the card comes
     * down — and let a second share start beside the first. By the next step
     * a share from the same tap holds `busy`, and settling it asks again.
     */
    this.time.delayedCall(0, () => this.heightCheck());
  }

  /**
   * ‹, told apart from the tap that closed a share sheet — the same problem,
   * and the same answer, as the win screen's (GameScene.pressBack). On iOS 26
   * that tap reaches the page while the share is still settling, and it used
   * to take the player out of the Gallery as it closed the sheet. It waits to
   * see: a share that settles was closed by it; one that does not is stuck,
   * and the way out still works.
   */
  private pressBack(): void {
    if (this.backPending || performance.now() < this.shareQuietUntil) return;
    const leave = (): void => {
      Haptics.tap();
      this.scene.start('Menu');
    };
    const share = this.shareSettled;
    if (!share) {
      leave();
      return;
    }
    this.backPending = true;
    const visit = this.visit;
    void settlesWithin(share, SHARE_DISMISS_WAIT_MS).then((settled) => {
      if (visit !== this.visit) return;
      this.backPending = false;
      if (!settled && this.sys.isActive()) leave();
    });
  }

  /**
   * Hold the screen's taps for a share: `busy` while it runs, the quiet window
   * once it settles, and a promise ‹ can wait on.
   */
  private async runShare(share: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const visit = this.visit;
    let settle = (): void => undefined;
    this.shareSettled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    try {
      await share();
    } finally {
      settle();
      if (visit === this.visit) {
        this.busy = false;
        this.shareSettled = null;
        this.shareQuietUntil = performance.now() + SHARE_QUIET_MS;
        this.heightCheck();
      }
    }
  }

  private shareImage(figure: SavedFigure): Promise<void> {
    return this.runShare(async () => {
      const dataUrl = renderShareCard(figure, shareCardOptions(figure));
      if (!dataUrl) return;

      await Share.shareFigure({
        dataUrl,
        title: 'My foldwing',
        text: shareText(figure),
        fileName: shareFileName(figure.levelName, 'png'),
      });
    });
  }

  /**
   * The card always comes down, as on the win screen (GameScene.shareReplay):
   * the render bounds its own steps, the card offers Cancel after a moment and
   * gives up by itself at REPLAY_CEILING_MS. A card that never came down left
   * a modal scrim over the whole Gallery and no way out but killing the app.
   */
  private shareReplay(figure: SavedFigure): Promise<void> {
    return this.runShare(async () => {
      const progress = progressCard(this, 'Folding your replay');
      const stop = new AbortController();
      let cancelled = false;
      // The failure line stays on the card for a moment; everything else takes
      // the card down at once — and so does Cancel, even on that line.
      let lingering = false;
      const offerCancel = this.time.delayedCall(REPLAY_CANCEL_AFTER_MS, () =>
        progress.offerCancel(() => {
          cancelled = true;
          stop.abort();
          if (lingering) progress.destroy();
        })
      );
      const ceiling = this.time.delayedCall(REPLAY_CEILING_MS, () => stop.abort());
      const takeDown = (): void => {
        offerCancel.remove();
        ceiling.remove();
        if (!lingering) progress.destroy();
      };

      try {
        const blob = await renderReplayVideo(
          {
            figure,
            // No misses to show: a saved figure is the solution, and that is
            // what this replay draws.
            attempts: [{ points: figure.points, times: figure.times, died: false }],
            caption: `${figure.levelName} · ${(figure.ms / 1000).toFixed(1)}s`,
            challenge: CHALLENGE,
          },
          (p) => progress.setProgress(p),
          { signal: stop.signal }
        );
        if (!this.sys.isActive()) return;
        if (!blob) {
          // The player's own Cancel needs no explaining.
          if (!cancelled) {
            lingering = true;
            offerCancel.remove();
            progress.setMessage('could not build the replay');
            this.time.delayedCall(1600, () => progress.destroy());
          }
          return;
        }
        takeDown();
        await Share.shareVideo({
          blob,
          title: 'My foldwing',
          text: shareText(figure),
          fileName: shareFileName(figure.levelName, 'mp4'),
        });
      } finally {
        takeDown();
      }
    });
  }
}
