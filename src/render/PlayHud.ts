/**
 * PlayHud — everything in play that is not the board and not a control: the
 * header's kicker and title, the thread row with the live star meter, the
 * tray under the board, the hint line, and the two small tags a stroke earns
 * ("87% · furthest yet", "close").
 *
 * The screen, top to bottom (SPEC §5.2, drawn in B · Night Fold):
 *
 *   header   ‹ · CHAPTER III · 7 OF 20 / 48 First span · Reveal
 *   thread   ★★★ on pace · 1.04× par                Attempt 3 · beat 87%
 *   board    the proved 702×1102 playfield on its sheet, where boardDrop puts it
 *   tray                   7/20 ●●●●●●◉○○◌○○○…
 *   banner
 *
 * WHY THE METER IS AT THE TOP. Every maze starts at the bottom left, and the
 * hand that draws from there covers the bottom of the screen for the whole
 * stroke. The meter is the one thing worth reading WHILE drawing, so it sits
 * over the board, in the thread row — and so does the attempt line, at its
 * right end, in every state, so it never moves. The tray under the board
 * holds what frames the fold: the chapter's beads, or the Daily's streak.
 *
 * WHY THE TRAY HAS NO CONTROLS. It lives beside the banner. The Reveal pill
 * stays in the header where it has always been (SPEC §9: the bottom band is
 * the banner's neighbour, and on the SE it is 14 pt tall), so nothing in play
 * moves between phones except the board's height — and nothing tappable ever
 * sits near an ad.
 *
 * The positions are one pure function, `playHudLayout(H, bannerOn, …)`,
 * tested across the shape table (tech G6). Everything drawn here is text,
 * baked icons and one baked bead strip: no live Graphics but the one ring a
 * "close" flickers.
 */

import Phaser from 'phaser';
import type { Rect, Vec2 } from '../core/Geometry';
import type { Bead } from '../core/Chapters';
import { chapterNumeral, foldInChapter } from '../core/Chapters';
import { NEAR_MISS_FLOOR } from '../core/RouteProgress';
import { nextStarLine, ratioText, type StarCount } from '../core/Stars';
import { panel } from './Baked';
import { icon } from './Icons';
import {
  bannerLine,
  BASE_HEIGHT,
  BASE_WIDTH,
  boardDrop,
  dp,
  FONT_DISPLAY,
  METRICS,
  motionReduced,
  ms,
  pt,
  rgba,
  theme,
  ui,
} from './Theme';
import { label } from './UI';

/* ------------------------------------------------------------ the numbers */

/**
 * The play screen's measures, in base units. B-spec numbers are 402-wide
 * points through `dp()`; the rest are the proved board's own.
 */
export const PLAY_HUD = {
  /**
   * The header row's designed centre line: dp(23), as high as the header's
   * 44 pt tap band goes and still starts inside the canvas on an 18 Pro — the
   * thread row lives under it, and every point it gives back is air between
   * that row and the board (QA: the row sat 4 pt over the sheet). Where the
   * band would reach over the canvas's top (the SE's larger points), it drops
   * by just enough (`shift`, in playHudLayout).
   */
  headerY: dp(23),
  /** The round back button. */
  back: dp(40),
  /** The Reveal pill's height; its width is measured from its words at build. */
  revealH: dp(36),
  revealW: dp(100),
  /** The kicker above the title line and the title under it, from the header's centre. */
  kickerDy: -dp(14),
  titleDy: dp(7),
  /** Paper kept between the title and the controls either side of it. */
  titleGap: dp(8),
  /**
   * The title shrinks this far to stay centred on the fold between the
   * controls before it gives up the centre and slides toward the roomier side.
   */
  titleMinScale: 0.8,
  /** The thread row: one line of 15 pt stars and a caption. */
  threadH: dp(16),
  threadGap: dp(2),
  /** Where the paper over the board is deep, the row sits this far over the sheet. */
  threadHug: dp(10),
  /**
   * The least air between the row and the sheet under it, where there is
   * paper at all: centred in the 18 Pro's 24 pt of paper it sat 4 pt over the
   * sheet, squeezed against the board (QA). It rises into the header's tap
   * band for it — never onto the painted controls.
   */
  threadAir: dp(8),
  /** Where rows start and end across: the playfield's edge, a little in. */
  sideIn: dp(6),
  /**
   * The tray needs this much between the board sheet and `bannerLine() − 16`
   * (SPEC §5.2), and never reaches further than `trayReach` under the sheet:
   * it belongs to the board, not to the bottom of the screen.
   */
  trayMin: 44,
  trayBannerGap: 16,
  trayReach: dp(22),
  /** The board sheet around the playfield (SPEC §3.1). */
  sheetX: 11,
  sheetY: 22,
  /**
   * The highest thing any maze draws, over the playfield's top: the goal ring
   * of every one of the 300 levels and every Daily starts 47 base down (goal
   * y 0.07 × 1102 − goalRadius). The thread row never reaches it.
   */
  ringTop: 47,
  /** The hint line's lift off the banner line, where there is no tray. */
  hintLift: pt(4),
  /** The meter's stars, and their pitch. */
  star: dp(14),
  starPitch: dp(16),
  /** The least paper between the header's painted controls and the row's marks, where the row has to rise. */
  threadTuck: dp(1),
  /** The tray's beads: a dot, its pitch. */
  bead: dp(5.5),
  beadPitch: dp(8),
} as const;

/* ------------------------------------------------------------ the layout */

export interface PlayHudInput {
  /** Safe-area insets the canvas does not already clear, base units (SafeArea.canvasInsets). */
  readonly safeTop?: number;
  readonly safeBottom?: number;
  readonly safeLeft?: number;
  readonly safeRight?: number;
  /** The thumb's floor now, base units (`minTap`). pt(44) on a canvas drawn at 0.5. */
  readonly tap?: number;
  /** The Reveal pill's width as built. */
  readonly revealW?: number;
  /** The top of this maze's goal ring, when a level is placed; the measured highest otherwise. */
  readonly ringTop?: number;
  /** The web Daily: no back button, no thread row (SPEC §5.2). */
  readonly web?: boolean;
}

export interface TrayBox {
  /** Centre line of the tray's one row. */
  readonly y: number;
  /** The band it may use, top to bottom. */
  readonly top: number;
  readonly bottom: number;
}

export interface PlayHudLayout {
  readonly height: number;
  readonly bannerOn: boolean;
  /** The header row's centre line: the back button and the Reveal pill sit on it. */
  readonly headerY: number;
  /** Where the header's tap areas end, at the thumb's floor. */
  readonly headerBottom: number;
  readonly kickerY: number;
  readonly titleY: number;
  /** The back button's centre x, or null on the web Daily. */
  readonly backX: number | null;
  readonly revealX: number;
  /** The span the title may use between the controls, and its centre when it fits. */
  readonly titleLeft: number;
  readonly titleRight: number;
  /** The board: the playfield where boardDrop puts it, and the sheet around it. */
  readonly boardTop: number;
  readonly boardBottom: number;
  readonly sheetTop: number;
  readonly sheetBottom: number;
  /** The highest thing the maze draws. */
  readonly ringTop: number;
  /** The thread row's centre line; `threadOnSheet` when it has to sit over the sheet's margin. */
  readonly threadY: number;
  readonly threadOnSheet: boolean;
  /** Rows run from here to here across. */
  readonly left: number;
  readonly right: number;
  /** The tray, or null where it does not fit (the SE with a banner). */
  readonly tray: TrayBox | null;
  /** The hint line's BOTTOM where there is no tray: over the banner, as it always hung. */
  readonly hintBottom: number;
  /** The first y nothing of ours may reach: the banner line, or the canvas foot without one. */
  readonly floorY: number;
}

/**
 * The play screen for a world `H` tall. `bannerOn` is whether a banner can
 * show at all (`Ads.enabled`): without one the tray may use the banner's band,
 * which is otherwise the banner's and nobody else's.
 *
 * Pure — every number comes from its arguments and the locked board geometry.
 */
export function playHudLayout(H: number, bannerOn: boolean, o: PlayHudInput = {}): PlayHudLayout {
  const P = PLAY_HUD;
  const safeTop = Math.max(0, o.safeTop ?? 0);
  const safeBottom = Math.max(0, o.safeBottom ?? 0);
  const safeLeft = Math.max(0, o.safeLeft ?? 0);
  const safeRight = Math.max(0, o.safeRight ?? 0);
  const tap = Math.max(o.tap ?? pt(44), 1);
  const revealW = o.revealW ?? P.revealW;

  // The header drops only as far as its tap band must to clear an inset the
  // canvas runs under (the SE under its status bar), exactly as 1.4 did.
  const shift = Math.max(0, safeTop - (P.headerY - tap / 2));
  const headerY = P.headerY + shift;
  const headerBottom = headerY + Math.max(tap, P.back, P.revealH) / 2;

  const edge = METRICS.inset.left;
  const backX = o.web ? null : edge + P.back / 2 + safeLeft;
  const revealX = BASE_WIDTH - METRICS.inset.right - revealW / 2 - safeRight;
  const titleLeft = (backX === null ? edge + safeLeft : backX + P.back / 2) + P.titleGap;
  const titleRight = revealX - revealW / 2 - P.titleGap;

  const drop = boardDrop(H);
  const boardTop = METRICS.inset.top + drop;
  const boardBottom = boardTop + (BASE_HEIGHT - METRICS.inset.top - METRICS.inset.bottom);
  const sheetTop = boardTop - P.sheetY;
  const sheetBottom = boardBottom + P.sheetY;
  const ringTop = o.ringTop ?? boardTop + P.ringTop;

  // The thread row belongs to the board: in the paper between the header's
  // taps and the sheet, as close over the sheet as `threadHug` where the paper
  // is deep (a Split View pane), centred in it where it is not (an 18 Pro);
  // where there is no such paper, just under the taps, over the sheet's empty
  // top margin — and never down onto anything a maze draws.
  const rowH = P.threadH;
  const gap = P.threadGap;
  const free = sheetTop - headerBottom;
  let threadY: number;
  if (free >= rowH + 2) {
    threadY = Math.max((headerBottom + sheetTop) / 2, sheetTop - P.threadHug - rowH / 2);
    // Measured on what shows — the stars, the row's tallest marks — not the
    // row's box: the 18 Pro has 23 pt between its header's painted controls
    // and the sheet, and the air goes under the row, where the board is.
    const vis = P.star / 2;
    const airY = sheetTop - P.threadAir - vis;
    const painted = headerY + Math.max(P.back, P.revealH) / 2 + P.threadTuck + vis;
    if (threadY > airY) threadY = Math.max(airY, Math.min(threadY, painted));
  } else threadY = Math.min(headerBottom + gap + rowH / 2, ringTop - gap - rowH / 2);
  const threadOnSheet = threadY + rowH / 2 > sheetTop;

  // The tray: under the sheet, a row that never comes within trayBannerGap of
  // the banner line. Without a banner it may use the band, to the foot.
  const floorY = bannerOn ? bannerLine(H) - safeBottom : H - safeBottom;
  const trayTop = sheetBottom;
  const trayBottom = floorY - P.trayBannerGap;
  const room = trayBottom - trayTop;
  const tray: TrayBox | null =
    room >= P.trayMin
      ? { y: trayTop + Math.min(room / 2, Math.max(P.trayMin / 2, P.trayReach)), top: trayTop, bottom: trayBottom }
      : null;

  return {
    height: H,
    bannerOn,
    headerY,
    headerBottom,
    kickerY: headerY + P.kickerDy,
    titleY: headerY + P.titleDy,
    backX,
    revealX,
    titleLeft,
    titleRight,
    boardTop,
    boardBottom,
    sheetTop,
    sheetBottom,
    ringTop,
    threadY,
    threadOnSheet,
    left: edge + P.sideIn + safeLeft,
    right: BASE_WIDTH - METRICS.inset.right - P.sideIn - safeRight,
    tray,
    hintBottom: bannerLine(H) - P.hintLift - safeBottom,
    floorY,
  };
}

/**
 * Where a centred line `width` wide goes between `left` and `right`: on
 * `centre` (the fold) when it fits there, slid toward the roomier side when it
 * fits only off-centre, and scaled down only when it fits nowhere.
 */
export function fitLine(
  width: number,
  left: number,
  right: number,
  centre: number = BASE_WIDTH / 2
): { x: number; scale: number } {
  const room = right - left;
  if (!(room > 0)) return { x: centre, scale: 1 };
  if (width <= room) {
    return { x: Math.min(Math.max(centre, left + width / 2), right - width / 2), scale: 1 };
  }
  return { x: (left + right) / 2, scale: room / width };
}

/**
 * Where a title `width` wide goes between `left` and `right`: centred on
 * `centre` — the fold, the screen's axis — in the SYMMETRIC room the nearer
 * control leaves, shrunk as far as `minScale` to stay there. Only a title too
 * long for that gives up the centre (fitLine, at `minScale`). The controls
 * either side are not the same width (‹ and the Reveal pill), and a title
 * centred between THEM sat 13–16 pt left of the axis, crowding the pill (QA).
 */
export function fitCentred(
  width: number,
  left: number,
  right: number,
  centre: number = BASE_WIDTH / 2,
  minScale: number = PLAY_HUD.titleMinScale
): { x: number; scale: number } {
  const half = Math.min(centre - left, right - centre);
  if (!(width > 0)) return { x: centre, scale: 1 };
  if (half > 0) {
    const s = Math.min(1, (2 * half) / width);
    if (s >= minScale) return { x: centre, scale: s };
  }
  const f = fitLine(width * minScale, left, right, centre);
  return { x: f.x, scale: minScale * f.scale };
}

/**
 * The first of `candidates` (centres) where a `w` × `h` tag covers nothing in
 * `avoid`; failing that, the one whose weighted overlap is least. Every spot
 * is first pulled inside `bounds`.
 */
export function pickSpot(
  candidates: readonly Vec2[],
  w: number,
  h: number,
  avoid: readonly { readonly r: Rect; readonly weight: number }[],
  bounds: Rect
): Vec2 {
  const inside = (p: Vec2): Vec2 => ({
    x: bounds.w >= w ? Math.min(Math.max(p.x, bounds.x + w / 2), bounds.x + bounds.w - w / 2) : p.x,
    y: bounds.h >= h ? Math.min(Math.max(p.y, bounds.y + h / 2), bounds.y + bounds.h - h / 2) : p.y,
  });
  let best: Vec2 | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const p = inside(c);
    let score = 0;
    for (const a of avoid) {
      const ox = Math.min(p.x + w / 2, a.r.x + a.r.w) - Math.max(p.x - w / 2, a.r.x);
      const oy = Math.min(p.y + h / 2, a.r.y + a.r.h) - Math.max(p.y - h / 2, a.r.y);
      if (ox > 0 && oy > 0) score += ox * oy * a.weight;
    }
    if (score === 0) return p;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best ?? inside(candidates[0] ?? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
}

/* ------------------------------------------------------------- the words */

/** The Daily's number: the same count the share text prints ("Foldwing Daily #58"). */
export function dailyNo(dateISO: string): number {
  return Math.round((Date.parse(dateISO) - Date.parse('2026-08-01')) / 86400000) + 1;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Saturday’s fold" for the day a Daily belongs to. */
export function dailyTitle(dateISO: string): string {
  const t = Date.parse(`${dateISO}T12:00:00Z`);
  const day = Number.isFinite(t) ? WEEKDAYS[new Date(t).getUTCDay()] : null;
  return day ? `${day}’s fold` : 'Daily fold';
}

export interface TitleWords {
  /** Sentence case; drawn as tracked caps. */
  readonly kicker: string;
  /** The ember kicker of a win. */
  readonly won: boolean;
  /** "48", in the quieter step; null on the Daily. */
  readonly number: string | null;
  readonly name: string;
}

/**
 * The header's words: "Chapter III · 7 of 20" over "48 First span", "Daily
 * fold · No. 58" over "Saturday’s fold", and on a win "Folded · new figure"
 * (a first clear) or "Folded".
 */
export function titleWords(o: {
  readonly levelIndex: number;
  readonly name: string;
  readonly daily: string | null;
  readonly won?: boolean;
  readonly firstClear?: boolean;
}): TitleWords {
  const number = o.daily ? null : String(o.levelIndex + 1);
  const name = o.daily ? dailyTitle(o.daily) : o.name;
  if (o.won) return { kicker: o.firstClear ? 'Folded · new figure' : 'Folded', won: true, number, name };
  const kicker = o.daily
    ? `Daily fold · No. ${dailyNo(o.daily)}`
    : `Chapter ${chapterNumeral(Math.floor(o.levelIndex / 20))} · ${foldInChapter(o.levelIndex)} of 20`;
  return { kicker, won: false, number, name };
}

/** What the thread row's meter shows: filled stars (null: none at all), and its caption. */
export interface MeterView {
  readonly stars: number | null;
  readonly text: string;
}

/**
 * The meter between strokes: what the level holds, and what the next star
 * asks. A fresh level shows three outlines and the line that takes them all;
 * a level at ★★★ its best line. The Daily keeps no stars, so it shows none.
 */
export function meterIdle(o: { readonly daily: boolean; readonly stars: StarCount; readonly best: number | null }): MeterView {
  if (o.daily) return { stars: null, text: '' };
  if (o.stars === 0) return { stars: 0, text: `all three at ${ratioText(1.1)} par` };
  if (o.stars >= 3) return { stars: 3, text: o.best !== null ? `best ${ratioText(o.best)} par` : 'three stars' };
  const next = nextStarLine(o.stars);
  return { stars: o.stars, text: next ? `${next} par` : '' };
}

/** The furthest a death got, as the player reads it: 20 % up, never 100. */
export function furthestPct(furthest: number): number | null {
  if (!(furthest >= NEAR_MISS_FLOOR)) return null;
  return Math.min(99, Math.round(furthest * 100));
}

/**
 * The tray's line: "Attempt 3" and what to beat ("beat 87%"), or between
 * levels' first strokes the time to beat ("best 7.0 s").
 */
export function trayWords(o: {
  readonly attempts: number;
  readonly furthest: number;
  readonly bestMs: number | null;
}): { main: string; aside: string } {
  if (o.attempts > 0) {
    const pct = furthestPct(o.furthest);
    return { main: `Attempt ${o.attempts}`, aside: pct === null ? '' : `beat ${pct}%` };
  }
  return { main: '', aside: o.bestMs !== null ? `best ${(o.bestMs / 1000).toFixed(1)} s` : '' };
}

/** The death tag: "87% · furthest yet". */
export const deathTagText = (pct: number): string => `${pct}% · furthest yet`;

/* ------------------------------------------------------------- the beads */

const BEAD_RES = 2;
const BEADS_KEY = 'playhud-beads';

/**
 * Paint a chapter's beads into `ctx`, left to right from (x, cy): ink for a
 * clear, gold for ★★★, tangerine for this fold, a hollow for a skip, a sunk
 * well for one ahead — and a tangerine outline on the 10th and 20th while
 * their mark is still to come.
 */
export function paintBeads(
  ctx: CanvasRenderingContext2D,
  beads: readonly Bead[],
  x: number,
  cy: number,
  marksAhead: readonly number[],
  size: number = PLAY_HUD.bead,
  pitch: number = PLAY_HUD.beadPitch
): void {
  const t = theme();
  const u = ui();
  const r = size / 2;
  beads.forEach((b, i) => {
    const cx = x + r + i * pitch;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    switch (b) {
      case 'gold':
        ctx.fillStyle = rgba(t.medal, 1);
        ctx.fill();
        break;
      case 'cleared':
        ctx.fillStyle = rgba(t.ink, 0.82);
        ctx.fill();
        break;
      case 'current':
        ctx.fillStyle = rgba(t.accent, 1);
        ctx.fill();
        break;
      case 'skipped':
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(t.ink, 0.45);
        ctx.stroke();
        break;
      default:
        ctx.fillStyle = rgba(u.well, 1);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(t.ink, 0.16);
        ctx.stroke();
    }
    if (b === 'current' || marksAhead.includes(i + 1)) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(t.accent, b === 'current' ? 0.55 : 0.9);
      ctx.stroke();
    }
  });
}

/** The width a row of `n` beads takes. */
export const beadsWidth = (n: number): number =>
  n > 0 ? PLAY_HUD.bead + (n - 1) * PLAY_HUD.beadPitch : 0;

/* --------------------------------------------------------------- the HUD */

/**
 * The attempt line (`main` · `aside`) — said at the thread row's right end,
 * in EVERY state — and what the tray under the board holds: the chapter's
 * beads, or on the Daily its `note` (the streak, or the time it was solved in).
 */
export interface TrayView {
  readonly main: string;
  readonly aside: string;
  readonly beads: readonly Bead[] | null;
  /** "7/20" before the beads. */
  readonly count: string;
  /** Bead numbers (1-based) whose chapter mark is still to come. */
  readonly marksAhead: readonly number[];
  /** The Daily's line in the tray, where a level has its beads. */
  readonly note?: string;
}

/**
 * Text that has to sit over the board sheet (the thread row and the hint on a
 * short phone) wears a halo in the board's colour, which knocks the crease
 * out behind the letters. Over the sky it wears none: the lamp makes the sky
 * lighter than the board there, and a board-coloured halo would read as a
 * dark outline (tech G12).
 */
function setHalo(text: Phaser.GameObjects.Text, on: boolean): void {
  text.setStroke(rgba(theme().board, 1), on ? dp(3) : 0);
}

export class PlayHud {
  /** The pure layout, under the name the spec gives it. */
  static readonly layout = playHudLayout;

  readonly kicker: Phaser.GameObjects.Text;
  readonly titleNum: Phaser.GameObjects.Text;
  readonly titleName: Phaser.GameObjects.Text;
  /** The hint line; GameScene tweens its alpha (showHint / hideHint). */
  readonly hint: Phaser.GameObjects.Text;

  private readonly thread: Phaser.GameObjects.Container;
  private readonly starsOn: Phaser.GameObjects.Image[] = [];
  private readonly starsOff: Phaser.GameObjects.Image[] = [];
  private readonly pace: Phaser.GameObjects.Text;
  /** The thread row's right end: the attempt line where the tray cannot say it. */
  private readonly side: Phaser.GameObjects.Text;
  /** The web Daily's verdict on a win, centred in the row (it has no meter). */
  private readonly verdict: Phaser.GameObjects.Text;

  private readonly tray: Phaser.GameObjects.Container;
  private readonly trayMain: Phaser.GameObjects.Text;
  private readonly trayAside: Phaser.GameObjects.Text;
  private readonly trayCount: Phaser.GameObjects.Text;
  private beadsImg: Phaser.GameObjects.Image | null = null;
  private beadsSig = '';

  private readonly tags: Phaser.GameObjects.Container[] = [];
  private l: PlayHudLayout | null = null;
  private titleWon = false;
  private shownStars: number | null = -1;
  private trayView: TrayView = { main: '', aside: '', beads: null, count: '', marksAhead: [] };
  /** Why the tray is not showing its row right now, besides having no room. */
  private trayHeld = { hint: false, rescue: false, won: false };
  private threadHeld = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: { readonly web: boolean }
  ) {
    const t = theme();
    const u = ui();
    this.kicker = label(scene, BASE_WIDTH / 2, 0, '', {
      size: dp(10.5),
      caps: true,
      weight: 600,
      color: u.text3,
    })
      .setOrigin(0.5)
      .setDepth(50);
    this.titleNum = label(scene, 0, 0, '', { size: dp(21), font: FONT_DISPLAY, color: u.text3 })
      .setOrigin(0, 0.5)
      .setDepth(50);
    this.titleName = label(scene, 0, 0, '', { size: dp(21), font: FONT_DISPLAY, color: u.text })
      .setOrigin(0, 0.5)
      .setDepth(50);

    // The thread row: three stars, the pace, and the side line.
    this.thread = scene.add.container(0, 0).setDepth(50);
    for (let i = 0; i < 3; i++) {
      const off = icon(scene, 0, 0, 'starOutline', { size: PLAY_HUD.star, color: u.text3 });
      const on = icon(scene, 0, 0, 'star', { size: PLAY_HUD.star, color: t.medal }).setAlpha(0);
      this.starsOff.push(off);
      this.starsOn.push(on);
      this.thread.add([off, on]);
    }
    this.pace = label(scene, 0, 0, '', { size: dp(12), weight: 500, color: u.text2 }).setOrigin(0, 0.5);
    this.side = label(scene, 0, 0, '', { size: dp(12), weight: 500, color: u.text2 }).setOrigin(1, 0.5);
    this.verdict = label(scene, BASE_WIDTH / 2, 0, '', { size: dp(14), weight: 600, color: u.text2 })
      .setOrigin(0.5)
      .setVisible(false);
    this.thread.add([this.pace, this.side, this.verdict]);

    // The tray.
    this.tray = scene.add.container(0, 0).setDepth(50);
    this.trayMain = label(scene, 0, 0, '', { size: dp(15), weight: 600, color: u.text }).setOrigin(0, 0.5);
    this.trayAside = label(scene, 0, 0, '', { size: dp(13), weight: 500, color: u.text2 }).setOrigin(0.5, 0.5);
    this.trayCount = label(scene, 0, 0, '', { size: dp(12), weight: 600, color: u.text3 }).setOrigin(0, 0.5);
    this.tray.add([this.trayMain, this.trayAside, this.trayCount]);

    // The hint: the voice — Georgia italic, the quiet step of the text ladder.
    this.hint = label(scene, BASE_WIDTH / 2, 0, '', {
      size: dp(14.5),
      font: FONT_DISPLAY,
      italic: true,
      color: u.text2,
      align: 'center',
    })
      .setOrigin(0.5, 1)
      .setDepth(50)
      .setAlpha(0);

    if (opts.web) this.thread.setVisible(false);
  }

  get layoutNow(): PlayHudLayout | null {
    return this.l;
  }

  /** Where the tray row is, when it is up — the rescue pills and the tags keep clear of it. */
  get trayShown(): boolean {
    return this.tray.visible && this.tray.alpha > 0;
  }

  /** Put everything where `l` says. Cheap; run on every resize and level. */
  place(l: PlayHudLayout): void {
    this.l = l;
    this.kicker.setY(l.kickerY);
    this.titleNum.setY(l.titleY);
    this.titleName.setY(l.titleY);
    this.fitTitle();

    this.thread.setPosition(0, l.threadY);
    for (const text of [this.pace, this.side, this.verdict]) setHalo(text, l.threadOnSheet);
    this.placeThread();

    const tray = l.tray;
    if (tray) this.tray.setPosition(0, tray.y);
    this.placeTray();
    this.syncTray();

    // In the tray's place where there is one; over the banner, on the sheet's
    // foot, where there is not — as the hint always hung.
    if (tray) this.hint.setOrigin(0.5, 0.5).setY(tray.y);
    else this.hint.setOrigin(0.5, 1).setY(l.hintBottom);
    setHalo(this.hint, !tray);
  }

  /** The header's words. */
  setTitle(w: TitleWords): void {
    const t = theme();
    const u = ui();
    this.titleWon = w.won;
    this.kicker.setText(w.kicker.toUpperCase()).setColor(rgba(w.won ? t.accentText : u.text3, 1));
    this.titleNum.setText(w.number ? `${w.number} ` : '');
    this.titleName.setText(w.name);
    this.fitTitle();
  }

  /** Centre the kicker and the title on the screen's axis between the controls, each fitted on its own. */
  private fitTitle(): void {
    const l = this.l;
    if (!l) return;
    this.kicker.setScale(1);
    const k = fitCentred(this.kicker.width, l.titleLeft, l.titleRight);
    this.kicker.setX(k.x).setScale(k.scale);

    const numW = this.titleNum.width;
    const width = numW + this.titleName.width;
    const f = fitCentred(width, l.titleLeft, l.titleRight);
    const x0 = f.x - (width * f.scale) / 2;
    this.titleNum.setScale(f.scale).setX(x0);
    this.titleName.setScale(f.scale).setX(x0 + numW * f.scale);
  }

  /**
   * The meter. `fade` for a reading mid-stroke: a star that drops out fades to
   * its outline over 200 ms, quietly (SPEC §4). A new stroke, or the level's
   * own stars between strokes, set them at once.
   */
  setMeter(m: MeterView, fade = false): void {
    const want = m.stars;
    const had = this.shownStars;
    this.shownStars = want;
    const visible = want !== null;
    for (let i = 0; i < 3; i++) {
      this.starsOff[i].setVisible(visible);
      const on = this.starsOn[i];
      on.setVisible(visible);
      if (!visible) continue;
      const lit = i < (want ?? 0);
      const target = lit ? 1 : 0;
      if (on.alpha === target && !this.scene.tweens.isTweening(on)) continue;
      this.scene.tweens.killTweensOf(on);
      const dropping = fade && !lit && had !== null && had !== -1 && i < had;
      if (dropping) {
        this.scene.tweens.add({ targets: on, alpha: 0, duration: ms(200), ease: 'Sine.easeOut' });
      } else {
        on.setAlpha(target);
      }
    }
    this.pace.setText(m.text);
    this.placeThread();
  }

  /** The thread row's right end: the attempt line, where the tray cannot hold it; '' for none. */
  setSide(text: string): void {
    this.side.setText(text);
    this.placeThread();
  }

  private placeThread(): void {
    const l = this.l;
    if (!l) return;
    const P = PLAY_HUD;
    const starsShown = this.shownStars !== null;
    let x = l.left;
    for (let i = 0; i < 3; i++) {
      const cx = l.left + P.star / 2 + i * P.starPitch;
      this.starsOff[i].setPosition(cx, 0);
      this.starsOn[i].setPosition(cx, 0);
    }
    if (starsShown) x = l.left + 2 * P.starPitch + P.star + dp(6);
    this.pace.setPosition(x, 0).setScale(1);
    this.side.setPosition(l.right, 0).setScale(1);
    // The pace keeps its whole width; the side line gives way.
    const sideRoom = l.right - (x + this.pace.width) - dp(12);
    if (this.side.width > sideRoom && sideRoom > 0) this.side.setScale(sideRoom / this.side.width);
    this.side.setVisible(this.side.text !== '' && sideRoom > dp(24));
  }

  /** Hide the thread row (a win lifts the figure into its band; the web Daily has none). */
  setThreadShown(on: boolean): void {
    this.threadHeld = !on;
    this.thread.setVisible(on && !this.opts.web);
    this.syncTray();
  }

  /** The tray's words and beads. */
  setTray(v: TrayView): void {
    this.trayView = v;
    this.placeTray();
    this.syncSide();
  }

  /**
   * The tray: the chapter's beads, centred under the board like a page's
   * folio — or the Daily's note. The attempt line is NOT here: it lives at the
   * thread row's right end in every state (syncSide). It used to be here, and
   * a rescue pill standing in the tray's band sent it up to the thread row,
   * so the same line jumped between two places as the states changed (QA).
   */
  private placeTray(): void {
    const l = this.l;
    if (!l) return;
    const v = this.trayView;
    const centre = (l.left + l.right) / 2;
    this.trayMain.setText('');
    // The web Daily has no thread row: its attempt line stays in the tray.
    const words = v.main && v.aside ? `${v.main} · ${v.aside}` : v.main || v.aside;
    this.trayAside.setText(v.note ?? (this.opts.web ? words : '')).setPosition(centre, 0);

    const beads = v.beads;
    if (!beads || beads.length === 0) {
      this.beadsImg?.setVisible(false);
      this.trayCount.setText('');
      return;
    }
    const w = beadsWidth(beads.length);
    const key = this.bakeBeads(beads, v.marksAhead);
    if (!this.beadsImg) {
      this.beadsImg = this.scene.add.image(0, 0, key).setOrigin(0, 0.5).setScale(1 / BEAD_RES);
      this.tray.add(this.beadsImg);
    } else {
      this.beadsImg.setTexture(key).setVisible(true);
    }
    this.trayCount.setText(v.count);
    const gap = dp(8);
    const x0 = Math.round(centre - (this.trayCount.width + gap + w) / 2);
    this.trayCount.setPosition(x0, 0);
    // The strip is baked with a 4 px pad round the beads.
    const pad = 4;
    this.beadsImg.setPosition(x0 + this.trayCount.width + gap - pad, 0);
  }

  /** The bead strip, baked once per state into one reused canvas (G2). */
  private bakeBeads(beads: readonly Bead[], marksAhead: readonly number[]): string {
    const sig = `${beads.join(',')}|${marksAhead.join(',')}`;
    const textures = this.scene.textures;
    if (sig === this.beadsSig && textures.exists(BEADS_KEY)) return BEADS_KEY;
    const pad = 4;
    const w = Math.ceil((beadsWidth(beads.length) + 2 * pad) * BEAD_RES);
    const h = Math.ceil((PLAY_HUD.bead + 2 * pad) * BEAD_RES);
    let tex = textures.exists(BEADS_KEY) ? (textures.get(BEADS_KEY) as Phaser.Textures.CanvasTexture) : null;
    if (tex && (tex.width !== w || tex.height !== h)) {
      textures.remove(BEADS_KEY);
      tex = null;
    }
    tex = tex ?? textures.createCanvas(BEADS_KEY, w, h);
    if (!tex) return '__MISSING';
    const ctx = tex.getContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(BEAD_RES, 0, 0, BEAD_RES, 0, 0);
    paintBeads(ctx, beads, pad, pad + PLAY_HUD.bead / 2, marksAhead);
    tex.refresh();
    this.beadsSig = sig;
    return BEADS_KEY;
  }

  /**
   * Hold the tray's row back for a reason: a hint is being said in its place,
   * a rescue pill stands over it, or a win's card has the bottom of the screen.
   */
  holdTray(reason: 'hint' | 'rescue' | 'won', held: boolean): void {
    if (this.trayHeld[reason] === held) return;
    this.trayHeld[reason] = held;
    this.syncTray();
  }

  /** Whether the tray's row is up now: there is a tray, and nothing holds it. */
  private get trayUp(): boolean {
    const h = this.trayHeld;
    return !!this.l?.tray && !this.hintInTray && !h.rescue && !h.won;
  }

  /** A hint yields the tray only where it is said in the tray's place. */
  private get hintInTray(): boolean {
    return this.trayHeld.hint && !!this.l?.tray;
  }

  private syncTray(): void {
    const up = this.trayUp;
    this.scene.tweens.killTweensOf(this.tray);
    if (up) {
      this.tray.setVisible(true);
      if (this.tray.alpha < 1) this.scene.tweens.add({ targets: this.tray, alpha: 1, duration: ms(160) });
    } else {
      this.tray.setAlpha(0).setVisible(false);
    }
    this.syncSide();
  }

  /** The attempt line, at the thread row's right end — one place, in every state but a win. */
  private syncSide(): void {
    const v = this.trayView;
    const words = v.main && v.aside ? `${v.main} · ${v.aside}` : v.main || v.aside;
    this.setSide(!this.trayHeld.won && !this.threadHeld ? words : '');
  }

  /**
   * "87% · furthest yet" on a small sheet pill, beside where the stroke died:
   * on its own half, inside the board, never over the start dot. It goes at the
   * next stroke, or after a moment.
   *
   * `avoid` is what it must keep clear of, most important first: a mirror
   * death's arc arrow and its "your reflection" label (InkRenderer.arrowRects),
   * then the walls. Placed above the contact it landed on that label and cut
   * it in half (QA), so it now tries above, below and further out, and takes
   * the first spot that covers none of them — or the one that covers least.
   */
  deathTag(
    text: string,
    at: Vec2,
    board: { x: number; y: number; axisX: number; right: number; bottom: number },
    start: Vec2,
    avoid: { readonly arrow?: readonly Rect[]; readonly walls?: readonly Rect[] } = {}
  ): void {
    const u = ui();
    const caption = label(this.scene, 0, 0, text, {
      size: dp(14),
      font: FONT_DISPLAY,
      italic: true,
      color: u.text,
    }).setOrigin(0.5);
    const w = Math.ceil(caption.width) + dp(22);
    const h = dp(28);
    const half = at.x <= board.axisX ? { lo: board.x, hi: board.axisX } : { lo: board.axisX, hi: board.right };
    const x = Math.min(Math.max(at.x, half.lo + w / 2 + dp(4)), half.hi - w / 2 - dp(4));
    const grab = METRICS.startRadius * METRICS.startGrabFactor;
    const startBox: Rect = { x: start.x - grab, y: start.y - grab, w: 2 * grab, h: 2 * grab };
    const ys = [at.y - dp(30), at.y + dp(34), at.y - dp(30) - h - dp(10), at.y + dp(34) + h + dp(10)];
    const spot = pickSpot(
      ys.map((y) => ({ x, y })),
      w,
      h,
      [
        ...(avoid.arrow ?? []).map((r) => ({ r, weight: 100 })),
        { r: startBox, weight: 100 },
        ...(avoid.walls ?? []).map((r) => ({ r, weight: 1 })),
      ],
      { x: board.x, y: board.y, w: board.right - board.x, h: board.bottom - board.y }
    );
    this.tag('death', Math.round(spot.x), Math.round(spot.y), w, h, caption, 1600);
  }

  /**
   * "close": a survived scrape, said beside where it was tight (SPEC §3.5),
   * for 700 ms. `at` is the tight spot, `head` the pen now — 45 base on, the
   * way it is going — and `line` the stroke so far.
   *
   * Beside the nib, the pill covered the walls and the gap the player was
   * about to draw through (QA). It now takes the first of a few spots round
   * the tight one — either side of the line, then behind it — that covers
   * neither the pen and the way ahead of it, nor the line just drawn, nor a
   * wall; or, where every one covers something, the one that covers least.
   */
  closeTag(
    at: Vec2,
    axisX: number,
    top: number,
    o: {
      readonly head?: Vec2;
      readonly walls?: readonly Rect[];
      readonly line?: readonly Vec2[];
      readonly bottom?: number;
    } = {}
  ): void {
    const caption = label(this.scene, 0, 0, 'close', {
      size: dp(13.5),
      font: FONT_DISPLAY,
      italic: true,
      color: theme().accentText,
    }).setOrigin(0.5);
    const w = Math.ceil(caption.width) + dp(18);
    const h = dp(24);
    const toward = at.x <= axisX ? 1 : -1;
    const head = o.head ?? { x: at.x, y: at.y - dp(24) };
    // Back along the travel: the unit vector from the head through the tight spot.
    let bx = at.x - head.x;
    let by = at.y - head.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) {
      bx = 0;
      by = 1;
    } else {
      bx /= bl;
      by /= bl;
    }
    const side = w / 2 + dp(14);
    const reach = Math.max(w, h) / 2 + dp(16);
    const candidates: Vec2[] = [
      { x: at.x + toward * side, y: at.y + by * dp(8) },
      { x: at.x - toward * side, y: at.y + by * dp(8) },
      { x: at.x + toward * side, y: at.y + by * reach },
      { x: at.x - toward * side, y: at.y + by * reach },
      { x: at.x + bx * reach * 1.6, y: at.y + by * reach * 1.6 },
    ];
    // The pen's neighbourhood is the one place the tag may never sit: that is
    // where the player is steering.
    const ahead: Rect = { x: head.x - dp(26), y: head.y - dp(26), w: dp(52), h: dp(52) };
    const ink: { r: Rect; weight: number }[] = [];
    const line = o.line ?? [];
    const dot = dp(5);
    for (let i = Math.max(0, line.length - 160); i < line.length; i += 3) {
      const p = line[i];
      ink.push({ r: { x: p.x - dot, y: p.y - dot, w: 2 * dot, h: 2 * dot }, weight: 3 });
    }
    const spot = pickSpot(
      candidates,
      w,
      h,
      [{ r: ahead, weight: 100 }, ...ink, ...(o.walls ?? []).map((r) => ({ r, weight: 1 }))],
      { x: 0, y: top, w: BASE_WIDTH, h: (o.bottom ?? Infinity) - top }
    );
    this.tag('close', Math.round(spot.x), Math.round(spot.y), w, h, caption, 700);
  }

  /** A 9 pt tangerine ring that flickers at the nib: the eye is there, not on the far wall. */
  flicker(at: Vec2): void {
    if (motionReduced()) return;
    const g = this.scene.add.graphics().setDepth(46);
    g.lineStyle(pt(1.2), theme().accent, 0.55);
    g.strokeCircle(0, 0, dp(9));
    g.setPosition(at.x, at.y);
    this.scene.tweens.add({
      targets: g,
      scale: 1.35,
      alpha: 0,
      duration: 150,
      onComplete: () => g.destroy(),
    });
  }

  private tag(
    kind: 'death' | 'close',
    x: number,
    y: number,
    w: number,
    h: number,
    caption: Phaser.GameObjects.Text,
    holdMs: number
  ): void {
    // One of each kind at a time: a newer one replaces it.
    for (const c of [...this.tags]) if (c.name === kind) this.dropTag(c);
    const face = panel(this.scene, `playhud-tag-${h}`, 0, 0, w, h, {
      radius: h / 2,
      face: { kind: 'solid', color: ui().sheet },
      elevation: 'e1',
    });
    const c = this.scene.add.container(x, y, [face, caption]).setDepth(46).setName(kind).setAlpha(0);
    this.tags.push(c);
    // Crossfades only: no pop under reduced motion, and none needed without.
    this.scene.tweens.add({ targets: c, alpha: 1, duration: ms(140), ease: 'Sine.easeOut' });
    this.scene.tweens.add({
      targets: c,
      alpha: 0,
      delay: holdMs,
      duration: ms(220),
      onComplete: () => this.dropTag(c),
    });
  }

  private dropTag(c: Phaser.GameObjects.Container): void {
    const i = this.tags.indexOf(c);
    if (i >= 0) this.tags.splice(i, 1);
    this.scene.tweens.killTweensOf(c);
    c.destroy(true);
  }

  /** Take the tags down: a new stroke has begun, or the level changed. */
  clearTags(kind?: 'death' | 'close'): void {
    for (const c of [...this.tags]) if (!kind || c.name === kind) this.dropTag(c);
  }

  /** The web Daily's verdict on a win, in the thread row's place (it has no meter). */
  setVerdict(text: string, gold: boolean): void {
    const t = theme();
    this.verdict
      .setText(text)
      .setColor(rgba(gold ? t.medalText : ui().text2, 1))
      .setVisible(text !== '');
    const quiet = text !== '';
    for (const s of [...this.starsOn, ...this.starsOff, this.pace, this.side]) s.setVisible(!quiet && s !== this.side);
    this.thread.setVisible(quiet || (!this.opts.web && !this.threadHeld));
    if (!quiet) this.setMeter({ stars: this.shownStars, text: this.pace.text });
  }

  get won(): boolean {
    return this.titleWon;
  }

  destroy(): void {
    this.clearTags();
    this.thread.destroy(true);
    this.tray.destroy(true);
    this.kicker.destroy();
    this.titleNum.destroy();
    this.titleName.destroy();
    this.hint.destroy();
    // The canvas texture is the scene's to keep (reused at the next create);
    // it is one small strip.
  }
}
