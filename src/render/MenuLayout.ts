/**
 * MenuLayout — where the home page's parts go, as numbers.
 *
 * The Night Fold menu (SPEC §5.1, `direction-B-1-menu.png`) reads top-down:
 * the top row (streak, reveals, •••), the missions strip, the stacked logo,
 * the Continue card, the Daily card and the three tiles. Every number here
 * is the mock's, in 402-wide design points through `dp()`.
 *
 * ONE FLEXIBLE GAP. The header hugs the top of the safe area and the stack
 * (Continue, Daily, tiles) hugs the bottom — the thumb and, when one shows,
 * the banner. The logo lives in the room between them, centred, and that
 * room is the only thing that grows or shrinks with the phone. When it is
 * too small the logo gives way in the spec's order (§5.1):
 *
 *   1. the mark and wordmark compress (66 → 44 pt, 46 → 38 pt) — the banner
 *      case on an iPhone 18 Pro;
 *   2. the tagline goes;
 *   3. the mark goes, the wordmark stays;
 *   4. the missions strip collapses into one chip in the top row;
 *   5. the Continue thumbnail shrinks to 72 × 92 (and its stars pill goes);
 *   6. the gaps between the cards close to 10 pt;
 *   7. and past all of that the wordmark goes too.
 *
 * THE BANNER NEVER GIVES WAY. `menuFootLine` is the lowest a tap area may
 * reach: 8 pt over the banner line (Theme.bannerLine), or over wherever the
 * native banner really reaches on a canvas drawn small, whichever is higher.
 * With no banner at all — a Remove Ads owner, an ads-off build, a player who
 * withheld consent (`Ads.enabled`) — it is the paper's own bottom less a
 * margin, which is the mock's page. Proved in MenuLayout.test.ts at every
 * shape of the tall-canvas table, with and without the banner.
 *
 * Tap areas: every control is tapped at the floor (`minTap`), capped so two
 * areas never share a spot. The cards and tiles are taller than the floor on
 * every phone; the top row stops a point short of the strip. Below a canvas
 * scale of about 0.42 (the Split View pane, an SE with Display Zoom) the top
 * row and the strip are tapped under 44 pt, which is accepted rather than let
 * controls overlap.
 */

import { chapterBeads, chapterTitle, frontierIndex, nextMark, type Bead } from '../core/Chapters';
import { chapterIndices, chapterOf } from '../core/Rewards';
import { chapterStarStats, MAX_STARS, nextStarLine, starsOf, type StarCount, type StarSave } from '../core/Stars';
import { monetization } from '../config/monetization';
import { LEVELS } from '../data/levels';
import { BASE_WIDTH, bannerLine, dp, ms, pt, PT } from './Theme';

const CHAPTER_ECONOMY = monetization.economy.chapter;

/* ------------------------------------------------------------- the frame */

/** The side margin of every chip, card and tile: 16 pt. */
export const EDGE = dp(16);
/** The column every card and the strip fill. */
export const MENU_COLUMN = BASE_WIDTH - 2 * EDGE;

/* ------------------------------------------------------------- top row */

/**
 * The top row's centre line: 22 pt under the top of the safe area, which is
 * where the canvas begins. The mock sets the chips at 19 pt; three more let
 * the row's tap area reach the thumb's 44 pt without leaving the canvas.
 */
export const TOP_BAR_Y = dp(22);
/** The chips' painted height (UI.chip). */
export const TOP_CHIP_H = dp(36);
/** The round ••• button, the same height as the chips. */
export const MORE_D = dp(36);
export const MORE_X = BASE_WIDTH - EDGE - MORE_D / 2;
/** The streak chip's left edge, and the balance chip's right edge (8 pt short of •••). */
export const STREAK_CHIP_LEFT = EDGE;
export const BALANCE_CHIP_RIGHT = MORE_X - MORE_D / 2 - dp(8);

/* ------------------------------------------------------- missions strip */

export const STRIP_TOP = dp(48);
export const STRIP_H = dp(56);
export const STRIP_Y = STRIP_TOP + STRIP_H / 2;

/**
 * The top row's tap area stops a point short of the strip's face, so the two
 * never share a spot; half of it hangs above the canvas, where no touch can
 * land, so what a thumb gets is TOP_BAR_Y plus half of this.
 */
export const TOP_TAP_MAX = 2 * (STRIP_TOP - 1 - TOP_BAR_Y);
/** The strip is tapped at its face: it cannot grow up into the top row's area. */
export const STRIP_TAP_MAX = STRIP_H;

/* ------------------------------------------------------------ the stack */

export const CARD_GAP = dp(16);
/** Where the gaps may close to, past every other give (step 6). */
export const MIN_CARD_GAP = dp(10);
export const CONTINUE_H = dp(236);
export const THUMB = { w: dp(104), h: dp(132) } as const;
export const THUMB_SMALL = { w: dp(72), h: dp(92) } as const;
/** The Continue card with the small thumbnail: shorter by the thumb's 40 pt (its stars pill goes too). */
export const CONTINUE_H_SMALL = CONTINUE_H - (THUMB.h - THUMB_SMALL.h);
export const DAILY_H = dp(128);
export const TILES_H = dp(74);
/** Paper under the tiles when no banner is below them: the mock's 14 pt over the home indicator. */
export const PAPER_AIR = dp(14);
/** Air, in POINTS on the glass, between the banner line and the lowest tap area (SPEC §2.1). */
export const BANNER_CLEAR_PT = 8;

/* ------------------------------------------------------------ the brand */

export interface BrandTier {
  /** The mark's height; 0 for none. */
  readonly markH: number;
  /** The wordmark's size; 0 for none. */
  readonly wordSize: number;
  readonly tagline: boolean;
}

/** The logo's sizes, largest first: the order it gives way in (the file header, steps 1–3). */
export const BRAND_TIERS: readonly BrandTier[] = [
  { markH: dp(66), wordSize: dp(46), tagline: true },
  { markH: dp(44), wordSize: dp(38), tagline: true },
  { markH: dp(44), wordSize: dp(38), tagline: false },
  { markH: 0, wordSize: dp(38), tagline: false },
];

/** The last resort (step 7): no logo at all. */
export const NO_BRAND: BrandTier = { markH: 0, wordSize: 0, tagline: false };

/**
 * The height Phaser gives a line of Georgia, per unit of font size: its
 * measured ascent and descent (Text's metrics), a little more than the CSS
 * line box of 1 the mock was drawn with. Measured in the browser at 71 and 86.
 */
export const WORD_BOX = 1.14;
/** From the mark's bottom to the wordmark's box: 14 pt, tightened to 8 once compressed (SPEC §5.1). */
export const markGap = (t: BrandTier): number => (t.markH >= dp(66) ? dp(14) : dp(8));
/** The tagline's line (Georgia italic 15), and the air over it. */
export const TAGLINE_H = dp(17);
export const TAGLINE_GAP = dp(7);
/** The least paper over and under the logo. */
export const BRAND_AIR = dp(6);

/** The wordmark's box for a tier. */
export const wordBox = (t: BrandTier): number => Math.round(t.wordSize * WORD_BOX);

/** The logo's whole height: the mark, the wordmark, the tagline. */
export function brandHeight(t: BrandTier): number {
  let h = 0;
  if (t.markH > 0) h += t.markH;
  if (t.wordSize > 0) h += (h > 0 ? markGap(t) : 0) + wordBox(t);
  if (t.tagline && h > 0) h += TAGLINE_GAP + TAGLINE_H;
  return h;
}

/* ------------------------------------------------------------ the layout */

/** A tap floor for a control `h` tall: its face, or the floor where that is taller, never past `cap`. */
export function tapHeight(h: number, floor: number, cap: number): number {
  return Math.max(h, Math.min(floor, cap));
}

/**
 * The lowest a tap area may reach, in whole base units — see the file header.
 * `bannerTop` is where the native banner really starts on the canvas (null
 * before the page can be measured) and `perPoint` the canvas's base units per
 * point on the glass (the ScaleManager's displayScale), for the 8 pt.
 */
export function menuFootLine(
  height: number,
  banner: boolean,
  bannerTop: number | null = null,
  perPoint: number = PT
): number {
  if (!banner) return Math.floor(height - PAPER_AIR);
  // Unmeasured: the 375 pt phone's 2, which is at least what every iPhone draws.
  const pp = Number.isFinite(perPoint) && perPoint > 0 ? Math.max(perPoint, 1) : PT;
  const clear = BANNER_CLEAR_PT * pp;
  let line = bannerLine(height) - clear;
  if (bannerTop !== null && Number.isFinite(bannerTop)) line = Math.min(line, bannerTop - clear);
  return Math.floor(line);
}

export interface MenuShape {
  /** The world's height (Theme.viewHeight). */
  readonly height: number;
  /** The lowest a tap area may reach (`menuFootLine`). */
  readonly footLine: number;
  /** The tap floor, base units (UI.minTap). */
  readonly floor: number;
  /** Today's missions exist to show (Progress.missionsToday). */
  readonly missions: boolean;
}

export interface Band {
  readonly top: number;
  readonly bottom: number;
}

export interface MenuRow {
  /** Centre: ready to draw at. */
  readonly y: number;
  /** Painted height. */
  readonly h: number;
}

export interface MenuLayout {
  readonly brand: BrandTier;
  /** The logo's top (the lockup's top-centre y), and the tagline's centre when there is one. */
  readonly brandTop: number;
  readonly taglineY: number;
  /** The middle of the room the logo sits in: where tokens leave from with no toast to leave from. */
  readonly brandMid: number;
  /** The missions strip; null when collapsed into the top row or with no missions. */
  readonly strip: MenuRow | null;
  /** The missions ride the top row as one chip (step 4). */
  readonly stripCollapsed: boolean;
  readonly continue: MenuRow;
  readonly thumb: { readonly w: number; readonly h: number };
  /** The Continue card's small form: small thumbnail, no stars pill. */
  readonly compact: boolean;
  readonly daily: MenuRow;
  readonly tiles: MenuRow;
  readonly gap: number;
  /** The tallest each control's tap area may grow — its `maxTap`. */
  readonly tapMax: { readonly top: number; readonly strip: number; readonly tiles: number };
  /** Everything a thumb can press, as bands: for the tests and the QA harness. */
  readonly bands: { readonly top: Band; readonly strip: Band | null; readonly continue: Band; readonly daily: Band; readonly tiles: Band };
  /** The lowest thing a thumb can press. */
  readonly bottom: number;
  /** False when even the last resort overflows (never in the shape table): the stack still keeps off the banner. */
  readonly fits: boolean;
}

interface Variant {
  readonly brand: BrandTier;
  readonly collapse: boolean;
  readonly compact: boolean;
  readonly gap: number;
}

/** Every layout the menu can take, in the order it gives way (the file header). */
function variants(missions: boolean): Variant[] {
  const out: Variant[] = BRAND_TIERS.map((brand) => ({ brand, collapse: false, compact: false, gap: CARD_GAP }));
  const word = BRAND_TIERS[BRAND_TIERS.length - 1];
  if (missions) out.push({ brand: word, collapse: true, compact: false, gap: CARD_GAP });
  out.push({ brand: word, collapse: missions, compact: true, gap: CARD_GAP });
  out.push({ brand: word, collapse: missions, compact: true, gap: MIN_CARD_GAP });
  out.push({ brand: NO_BRAND, collapse: missions, compact: true, gap: MIN_CARD_GAP });
  return out;
}

const band = (y: number, tap: number): Band => ({ top: y - tap / 2, bottom: y + tap / 2 });

function place(shape: MenuShape, v: Variant): MenuLayout {
  const { floor, footLine } = shape;
  const gap = v.gap;
  // The tiles may grow into half the gap over them, and never below the foot line.
  const tilesCap = TILES_H + gap - 2;
  const tilesTap = tapHeight(TILES_H, floor, tilesCap);
  const tilesY = footLine - tilesTap / 2;
  const tilesTop = tilesY - TILES_H / 2;
  const dailyY = tilesTop - gap - DAILY_H / 2;
  const contH = v.compact ? CONTINUE_H_SMALL : CONTINUE_H;
  const contY = dailyY - DAILY_H / 2 - gap - contH / 2;
  const contTop = contY - contH / 2;

  const strip = shape.missions && !v.collapse ? { y: STRIP_Y, h: STRIP_H } : null;
  const headerBottom = strip ? STRIP_TOP + STRIP_H : TOP_BAR_Y + TOP_CHIP_H / 2;
  const room = contTop - headerBottom;
  const bh = brandHeight(v.brand);
  const brandTop = headerBottom + Math.max(0, (room - bh) / 2);
  const hasWord = v.brand.wordSize > 0;
  const taglineY =
    v.brand.tagline && hasWord ? brandTop + bh - TAGLINE_H / 2 : brandTop + bh;

  const topTap = tapHeight(TOP_CHIP_H, floor, TOP_TAP_MAX);
  const stripTap = strip ? tapHeight(STRIP_H, floor, STRIP_TAP_MAX) : 0;
  return {
    brand: v.brand,
    brandTop,
    taglineY,
    brandMid: headerBottom + room / 2,
    strip,
    stripCollapsed: shape.missions && v.collapse,
    continue: { y: contY, h: contH },
    thumb: v.compact ? THUMB_SMALL : THUMB,
    compact: v.compact,
    daily: { y: dailyY, h: DAILY_H },
    tiles: { y: tilesY, h: TILES_H },
    gap,
    tapMax: { top: TOP_TAP_MAX, strip: STRIP_TAP_MAX, tiles: tilesCap },
    bands: {
      top: band(TOP_BAR_Y, topTap),
      strip: strip ? band(strip.y, stripTap) : null,
      continue: band(contY, contH),
      daily: band(dailyY, DAILY_H),
      tiles: band(tilesY, tilesTap),
    },
    bottom: tilesY + tilesTap / 2,
    fits: room >= bh + (bh > 0 ? 2 * BRAND_AIR : 0) && contTop > TOP_BAR_Y + topTap / 2,
  };
}

/**
 * The menu for a shape: the first layout, in the order things give way, whose
 * logo fits between the header and the stack. See the file header.
 */
export function menuLayout(shape: MenuShape): MenuLayout {
  const all = variants(shape.missions);
  for (const v of all) {
    const L = place(shape, v);
    if (L.fits) return L;
  }
  return place(shape, all[all.length - 1]);
}

/* ------------------------------------------------------ the Continue card */

/**
 * Where the Continue card's parts go, relative to its top-left, for a card
 * `w` wide (SPEC §5.1, the mock's `.hero`): the thumbnail on the left, the
 * chapter to its right, the Continue button across the foot.
 */
export interface ContinueCardLayout {
  readonly pad: number;
  readonly thumb: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** The text column's left edge and width. */
  readonly infoX: number;
  readonly infoW: number;
  readonly capsY: number;
  readonly titleY: number;
  readonly beadsY: number;
  readonly metaY: number;
  /** The stars pill's centre, or null in the compact card. */
  readonly pillY: number | null;
  readonly ctaY: number;
  readonly ctaH: number;
  readonly ctaW: number;
}

export const CTA_H = dp(60);
export const PILL_H = dp(24);
export const BEAD_H = dp(7);
export const BEAD_GAP = dp(3);

export function continueCardLayout(w: number, h: number, compact: boolean): ContinueCardLayout {
  const pad = dp(16);
  const thumb = compact ? THUMB_SMALL : THUMB;
  const infoX = pad + thumb.w + dp(16);
  // The compact card keeps every line but the pill, closer together.
  const s = compact ? { caps: dp(21), title: dp(45), beads: dp(70), meta: dp(88) } : { caps: dp(23), title: dp(50), beads: dp(79), meta: dp(98) };
  return {
    pad,
    thumb: { x: pad, y: pad, w: thumb.w, h: thumb.h },
    infoX,
    infoW: w - pad - infoX,
    capsY: s.caps,
    titleY: s.title,
    beadsY: s.beads,
    metaY: s.meta,
    pillY: compact ? null : dp(128),
    ctaY: h - pad - CTA_H / 2,
    ctaH: CTA_H,
    ctaW: w - 2 * pad,
  };
}

/** The beads' pitch in a text column `w` wide: twenty 7 pt pills with 3 pt between. */
export function beadPitch(w: number, count = 20): { pitch: number; width: number } {
  const width = Math.max(BEAD_H, (w - BEAD_GAP * (count - 1)) / count);
  return { pitch: width + BEAD_GAP, width };
}

/** What the Continue card says. Pure: from the save and the three flags the menu already holds. */
export interface ContinueModel {
  /** The level the card shows and the button opens (the last one once all are folded). */
  readonly index: number;
  /** "Chapter III · Hinge", drawn in caps. */
  readonly caps: string;
  /** "48", in the caption colour, before the name. */
  readonly number: string;
  readonly name: string;
  readonly beads: Bead[];
  /** "7 of 20": folds cleared in the chapter. */
  readonly count: string;
  /** "17/60": the chapter's stars. */
  readonly stars: string;
  /** "+1 at 10": the chapter mark still ahead; null past both, for owners, and in the first session. */
  readonly mark: string | null;
  /** The level's stars and what the next one takes; null in the compact card's place is the caller's. */
  readonly pill: { readonly earned: StarCount; readonly text: string };
  readonly cta: string;
}

export interface ContinueInput extends StarSave {
  readonly unlockedIndex: number;
  readonly totalWins: number;
}

/**
 * The Continue card, from the save. The index is the frontier (the level
 * the button ACTS on — Chapters.frontierIndex), and every word is read off it:
 * the caption used to come from totalWins while the button acted on
 * unlockedIndex, and said "Play" over a rewarded skip's level 6.
 */
export function continueModel(
  save: ContinueInput,
  o: { readonly allCleared: boolean; readonly firstSession: boolean; readonly owner: boolean }
): ContinueModel {
  const index = o.allCleared ? LEVELS.length - 1 : frontierIndex(save);
  const c = chapterOf(index);
  const stats = chapterStarStats(save, c);
  const size = chapterIndices(c).length;
  const earned = starsOf(save, LEVELS[index].id);
  const next = nextMark(stats.cleared, size);
  const reward = next ? (next.at === 20 ? CHAPTER_ECONOMY.fullReward : CHAPTER_ECONOMY.halfReward) : 0;
  const resuming = index > 0 || save.totalWins > 0;
  return {
    index,
    caps: chapterTitle(c),
    number: String(index + 1),
    name: LEVELS[index].name,
    beads: chapterBeads(save, c, o.allCleared ? null : index),
    count: `${stats.cleared} of ${size}`,
    stars: `${stats.stars}/${stats.max}`,
    // Reveals mean nothing to an owner, and the first session says no economy.
    mark: next && !o.owner && !o.firstSession ? `+${reward} at ${next.at}` : null,
    pill: {
      earned,
      text: earned === 0 ? `${MAX_STARS} to earn` : (nextStarLine(earned) ?? 'the best line there is'),
    },
    cta: o.allCleared ? 'Replay a fold' : resuming ? 'Continue' : 'Play',
  };
}

/** A bead string as a short signature, for the baked texture's key. */
export function beadSignature(beads: readonly Bead[]): string {
  const code: Record<Bead, string> = { gold: 'g', cleared: 'c', current: 'n', skipped: 's', open: 'o' };
  return beads.map((b) => code[b]).join('');
}

/* ----------------------------------------------------- the Daily card */

/** Where the Daily card's parts go, relative to its top-left (the mock's `.daily`). */
export interface DailyCardLayout {
  readonly pad: number;
  readonly capsY: number;
  readonly titleY: number;
  /** The week: the dots' centre line, their size and pitch, and the first dot's centre x. */
  readonly weekY: number;
  readonly dot: number;
  readonly dotPitch: number;
  readonly weekX: number;
  /** The state's line, under the week (or under the title on a bare card). */
  readonly subY: number;
  /** The streak block's centre x, its number's line and its caps line. */
  readonly streakX: number;
  readonly streakY: number;
  readonly streakCapsY: number;
  /** The Play pill: its right edge, centre line and height. */
  readonly pillRight: number;
  readonly pillY: number;
  readonly pillH: number;
  /** The left column's right edge: nothing on the left may run past it. */
  readonly leftEnd: number;
}

export function dailyCardLayout(w: number, h: number, bare: boolean): DailyCardLayout {
  const pad = dp(16);
  const streakW = dp(96);
  const pillH = dp(34);
  return {
    pad,
    capsY: dp(21),
    titleY: dp(45),
    weekY: dp(80),
    dot: dp(22),
    dotPitch: dp(33),
    weekX: pad + dp(13),
    subY: bare ? dp(72) : dp(108),
    streakX: w - pad - streakW / 2,
    streakY: dp(38),
    streakCapsY: dp(64),
    pillRight: w - pad,
    pillY: h - pad - pillH / 2,
    pillH,
    leftEnd: w - pad - streakW - dp(10),
  };
}

/* ------------------------------------------------------ toasts, sheets */

/** Air a toast keeps from what it sits between. */
export const TOAST_AIR = dp(4);

/**
 * Where a toast `toastH` tall goes while a sheet is up: centred in the paper
 * between the top row and the sheet's card (`cardTop`) when it fits there;
 * else from the top of the paper, over the dimmed top row — at worst into the
 * card's top padding, never onto its title or rows.
 * QA round 1: "Reminders on" sat on the Settings heading at a phone's size,
 * and on the Sound row in the Split View pane.
 */
export function sheetToastY(
  cardTop: number,
  toastH: number,
  below?: { readonly cardBottom: number; readonly floor: number }
): number {
  const top = TOP_BAR_Y + TOP_CHIP_H / 2 + TOAST_AIR;
  const bottom = cardTop - TOAST_AIR;
  if (bottom - top >= toastH) return (top + bottom) / 2;
  // No paper over the card (a 9:16 phone): under it, where there is room,
  // rather than on the top row's chips (QA: over the streak and reveal chips).
  if (below) {
    const from = below.cardBottom + TOAST_AIR;
    if (below.floor - from >= toastH) return from + toastH / 2;
  }
  return TOAST_AIR + toastH / 2;
}

/**
 * Where a toast `toastH` tall goes on the page itself, and whether it takes
 * the wordmark's place while it shows.
 *
 * Just over the Continue card, in the foot of the brand's room — over the
 * tagline where there is one, never on the mark (QA: "one free reveal lands
 * each day" sat across the middle of the stacked mark) and never up on the
 * top row or the strip. Where the wordmark's foot comes closer than that (a
 * brand compressed over a banner, the SE), a toast there would cut the word
 * in half; it is centred on the word instead, and the menu fades the word
 * (and its tagline) while it shows (`coversWord`).
 */
export function pageToastSlot(L: MenuLayout, toastH: number): { y: number; coversWord: boolean } {
  const contTop = L.continue.y - L.continue.h / 2;
  const headerBottom = L.strip ? L.strip.y + L.strip.h / 2 : TOP_BAR_Y + TOP_CHIP_H / 2;
  const floor = headerBottom + TOAST_AIR + toastH / 2;
  const low = contTop - TOAST_AIR - toastH / 2;
  const t = L.brand;
  if (t.wordSize > 0) {
    const wordTop = L.brandTop + (t.markH > 0 ? t.markH + markGap(t) : 0);
    const wordFoot = wordTop + wordBox(t);
    if (low - toastH / 2 < wordFoot) {
      // On the word, but never up onto the mark over it.
      const clear = t.markH > 0 ? L.brandTop + t.markH + TOAST_AIR + toastH / 2 : floor;
      const y = Math.min(Math.max(wordTop + wordBox(t) / 2, floor, clear), Math.max(low, floor));
      return { y, coversWord: true };
    }
  }
  return { y: Math.max(low, floor), coversWord: false };
}

/** The line a page toast is centred on (pageToastSlot). */
export function pageToastY(L: MenuLayout, toastH: number): number {
  return pageToastSlot(L, toastH).y;
}

/**
 * Where a moment's tokens leave from: just under the end of its toast pill
 * (`w` wide, `h` tall, centred across the page on `y`) on the side of the chip
 * they fly to — the right end for the balance, the left for the streak. They
 * used to leave from over the wordmark, which is where the arrival toast sits,
 * so the first frames of every flight crossed its words. (The menu flies them
 * under the toast's depth too: on their way up they pass behind the pill.)
 */
export function underToast(
  pill: { readonly w: number; readonly h: number; readonly y: number },
  side: 'left' | 'right'
): { x: number; y: number } {
  const end = pill.w / 2 - dp(16);
  return { x: BASE_WIDTH / 2 + (side === 'right' ? end : -end), y: pill.y + pill.h / 2 + dp(12) };
}

/*
 * The kit's toast timings (UI.showNextToast), in base ms: the rise and the
 * fade are motion and go through ms(); the hold is reading time, in real ms.
 */
const TOAST_RISE = 220;
const TOAST_HOLD = 2600;
const TOAST_HURRY = 120;
/** Past a toast's end before the next is handed over: the kit ends on a frame, not on the ms. */
export const TOAST_GAP = 50;

/**
 * How long the kit keeps a toast up, from the call that shows it to the end
 * of its fade: its rise, its hold, its fade — after the toast before it has
 * hurried off (`hurry`), when an urgent one is shown over it.
 */
export function toastSpan(holdMs: number | undefined, hurry: boolean): number {
  return (hurry ? ms(TOAST_HURRY) : 0) + ms(TOAST_RISE) + (holdMs ?? TOAST_HOLD) + ms(TOAST_RISE);
}

/**
 * The hold that ends a copy shown over the toast on screen (urgent, so after
 * a hurry) when the toast itself would have ended, at `until`.
 */
export function liftedHold(until: number, now: number): number {
  return until - TOAST_GAP - now - toastSpan(0, true);
}

/** What the pacer needs of a queue: UI's ToastQueue, so the kit's rules decide who waits. */
export interface ToastWaiting<T> {
  push(t: T): void;
  next(): T | null;
  readonly size: number;
  clear(): void;
}

/** What the pacer reads of a toast. */
export interface PacedToast {
  readonly urgent?: boolean;
  readonly opts: { readonly holdMs?: number };
}

/**
 * The menu's toasts, handed to the kit (UI.toast) one at a time.
 *
 * The kit queues a toast with the line it was given and shows it whenever the
 * one before it goes. The menu places a toast by what is up WHEN IT SHOWS —
 * above a sheet's card while one is open, else on the page's line — so one
 * queued before a sheet opened came up on the sheet's title, and the menu
 * could not tell when it had. So the menu's toasts wait here, in the kit's own
 * queue rules, and go to the kit once the one on screen is done: placed then,
 * and timed from then. An urgent one — the answer to a tap — goes at once, as
 * the kit shows it, and those waiting resume after it. Nothing waiting is
 * dropped for a sheet (verifier, fix round 1: the lift used to clear them).
 *
 * `now` is the scene clock's, in ms; the spans are the kit's (`toastSpan`).
 */
export class ToastPacer<T extends PacedToast> {
  private shown: { toast: T; until: number } | null = null;

  constructor(private readonly waiting: ToastWaiting<T>) {}

  /** `t` is said at `now`. The toast to hand the kit now: `t`, or null while it waits. */
  say(t: T, now: number): T | null {
    if (t.urgent) return this.show(t, now);
    this.waiting.push(t);
    return this.next(now);
  }

  /** The toast to hand the kit at `now`: the next waiting, once the one on screen is done. */
  next(now: number): T | null {
    if (this.onScreen(now)) return null;
    this.shown = null;
    const t = this.waiting.next();
    return t ? this.show(t, now) : null;
  }

  /** The toast on screen at `now`, and when it is gone; null when there is none. */
  onScreen(now: number): { readonly toast: T; readonly until: number } | null {
    return this.shown && now < this.shown.until ? this.shown : null;
  }

  /** When `next` has one to hand over; null with nothing waiting. */
  get due(): number | null {
    return this.waiting.size > 0 ? (this.shown?.until ?? 0) : null;
  }

  clear(): void {
    this.waiting.clear();
    this.shown = null;
  }

  private show(t: T, now: number): T {
    const hurry = this.onScreen(now) !== null;
    this.shown = { toast: t, until: now + toastSpan(t.opts.holdMs, hurry) + TOAST_GAP };
    return t;
  }
}

/** The Settings card: the width of every other sheet's card (the sheet recipe). */
export const SETTINGS_W = pt(300);

/** SETTINGS_W where every row's widest need fits in it, else the column (a long font fallback). */
export function settingsWidth(needs: readonly number[], column: number): number {
  return needs.every((n) => n <= SETTINGS_W) ? SETTINGS_W : column;
}
