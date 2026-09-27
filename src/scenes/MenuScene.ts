/**
 * MenuScene — the home page, in Night Fold (SPEC §5.1, `direction-B-1-menu.png`).
 *
 * It leads forward. The top row says what the player has — the streak and
 * the bookmarks that can keep it on the left, the reveals (and the door to
 * the Store) on the right — and the strip under it today's three missions.
 * The stacked logo draws itself in once a day. Then the Continue card: the
 * next maze as a thumbnail, its chapter as twenty beads, the stars it holds
 * or has to earn, and Continue across its foot — launch to drawing is one
 * tap. The Daily sits under it on its own dusk card, with the week and the
 * run, then Levels | Gallery | Store. The order is fixed (Continue, then the
 * Daily): muscle memory over a hero that swaps. MenuLayout places it all on
 * every shape, the banner never given way to.
 *
 * WHAT ARRIVED is said here, on entering, as toasts and never as a modal: a
 * bookmark that kept the streak, chapters folded before marks existed, the
 * day's free reveal, a purchase, the streak going up. Each is a `Moment`,
 * played one after another so no toast replaces another in the queue, with a
 * token flying into the chip it changes. The grants themselves are already in
 * the save; a moment only shows them. Back from a win, the page moves on from
 * what it last showed: the thumbnail crossfades to the next maze, the beads
 * advance, the mission rings fill (the return beats, `playReturn`).
 *
 * THE FIRST SESSION shows none of the economy (DailyCard.firstSession): no
 * balance chip, no Store, no gift said, no "+1 at 10". Until the tutorial is
 * done the first screen has one thing to do, and it is Play.
 *
 * EVERY TOAST goes through `say`: with a sheet up it is placed above the
 * sheet's card, never on its title or rows; and the answer to a tap is
 * `urgent`, shown at once rather than behind whatever news is on screen.
 */

import Phaser from 'phaser';
import type { Bead } from '../core/Chapters';
import type { MissionState } from '../core/Missions';
import { parseMark } from '../core/Rewards';
import type { Milestone } from '../core/Streak';
import { monetization } from '../config/monetization';
import { LEVELS } from '../data/levels';
import { Ads } from '../systems/Ads';
import { Audio } from '../systems/Audio';
import { Music } from '../systems/Music';
import { todayISO } from '../systems/Daily';
import { Haptics } from '../systems/Haptics';
import { Iap } from '../systems/Iap';
import { GameCenter } from '../systems/GameCenter';
import { Nudges, PENDING_ROUTE, type NudgePermission } from '../systems/Nudges';
import { Progress, type GrantEvent, type SaveData } from '../systems/Progress';
import { Rate } from '../systems/Rate';
import { LOOKS, panel, softDisc } from '../render/Baked';
import {
  dailyCardState,
  drawDailyCard,
  firstSession,
  foldsToGo,
  setContentAlpha,
  streakChipState,
  tutorialFoldsToGo,
} from '../render/DailyCard';
import { icon, type IconName } from '../render/Icons';
import { DRAW_IN, drawInAt, logo, MARK_BOX, markBleed, markColors, paintMark, SETTLED, type Logo, type MarkProgress } from '../render/Logo';
import { mazeThumb } from '../render/MazeThumb';
import {
  BALANCE_CHIP_RIGHT,
  BEAD_H,
  beadPitch,
  beadSignature,
  continueCardLayout,
  continueModel,
  DAILY_H,
  EDGE,
  liftedHold,
  markGap,
  MENU_COLUMN,
  menuFootLine,
  menuLayout,
  MORE_D,
  MORE_X,
  PILL_H,
  settingsWidth,
  pageToastSlot,
  pageToastY,
  sheetToastY,
  STREAK_CHIP_LEFT,
  ToastPacer,
  TOP_BAR_Y,
  TOP_CHIP_H,
  TOP_TAP_MAX,
  underToast,
  wordBox,
  type ContinueModel,
  type MenuLayout,
} from '../render/MenuLayout';
import {
  drawMissionChip,
  drawMissionStrip,
  missionDoneLine,
  showMissionsSheet,
  type MissionRoute,
  type MissionStrip,
} from '../render/MissionsSheet';
import { canvasBannerTop } from '../render/SafeArea';
import {
  grantNotice,
  restorePurchases,
  sheetBottomLimit,
  SHEET_TOP_LIMIT,
  showStoreSheet,
  storeSells,
  type StoreHooks,
  type StoreLanded,
} from '../render/StoreSheet';
import { showStreakSheet, type StreakRepaired } from '../render/StreakSheet';
import { BASE_WIDTH, dp, hexCss, MOTION, motionReduced, ms, pt, rgba, setMotionScale, theme, ui, viewHeight } from '../render/Theme';
import {
  breathe,
  button,
  cardBlocker,
  chip,
  chipWidth,
  COLUMN,
  countText,
  countUp,
  dismissOnScrim,
  clearToasts,
  enter,
  eyeGlyph,
  flameGlyph,
  flyReward,
  FONT,
  type Glyph,
  keepCentred,
  label,
  lockGlyph,
  minTap,
  pulse,
  RADIUS,
  roundRect,
  scrim,
  setButtonText,
  sheetPanel,
  shieldInput,
  toast,
  TOAST_H,
  TOAST_MAX_H,
  TOAST_TOP,
  toastLines,
  ToastQueue,
  type ToastItem,
  type ToastOptions,
  type Tone,
  TYPE,
  bookmarkGlyph,
} from '../render/UI';
import { warmLevels } from './LevelSelectScene';

/**
 * Registry key for a line the NEXT Menu build should say, as a toast. Kept as
 * the transport for any screen that wants the menu to say something on
 * arrival; the menu carries its own unshown moments whole (MENU_MOMENTS).
 */
export const MENU_NOTICE = 'menuNotice';

/**
 * Registry key: a purchase or restore that rebuilt the menu, for the rebuilt
 * one to celebrate — `{kind, n, text?}`. `kind` is 'removeAds' or 'restore'
 * (the chip flips from `n` to ∞), or 'reveals' (`n` of them fly in).
 */
export const MENU_CELEBRATE = 'menuCelebrate';

/**
 * Registry key: the streak before a Daily win, for the menu to tick the flame
 * chip up from. GameScene may set it; without it the menu compares with the
 * streak it last showed (MENU_STREAK_SHOWN), which covers the same win.
 */
export const MENU_STREAK_FROM = 'menuStreakFrom';

/** Registry key: the streak the last Menu build showed, and so counts up from. */
const MENU_STREAK_SHOWN = 'menuStreakShown';

/** Registry key: moments a build ended before showing, for the next build to play. */
const MENU_MOMENTS = 'menuMoments';

/**
 * The app's version for the Settings footer, and the build number beside it,
 * as the build says them (VITE_APP_VERSION, VITE_BUILD_NUMBER). The fallback
 * is this iteration's marketing version, for a build that says nothing.
 */
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || '1.4';
const BUILD_NUMBER = import.meta.env.VITE_BUILD_NUMBER as string | undefined;

/**
 * How long the canvas scale has to hold still before the menu rebuilds for a
 * new floor. A Split View divider drags through many sizes; one rebuild at the
 * end is enough, and the areas are capped in the meantime.
 */
const REFIT_SETTLE_MS = 250;

/**
 * How long one moment holds the stage: a toast's rise, its 2600 ms of reading
 * time and its fall, plus a beat. Real time — reading time is never shortened
 * by reduced motion, which is also why toasts hold for a fixed 2600.
 */
const MOMENT_MS = 3200;

/**
 * A menu toast, waiting its turn in `say`'s pacer. `y` is where it was put
 * once shown: undefined on the page's own line (the kit's default).
 */
interface MenuToast extends ToastItem {
  readonly opts: ToastOptions;
  y?: number;
  /** It was placed for a sheet (above or under its card), not on the page. */
  onSheet?: boolean;
}

/**
 * The Store, on the menu, at the depth of the other menu sheets: under the
 * toasts (UI's 80) and the moment tokens (79). StoreSheet draws it at 90, and
 * an answer said while it was up drew under its dim (verifier, fix round 1).
 */
const STORE_DEPTH = 70;

/** A moment's tokens leave from just under its toast's end — measured when it plays. */
const TOAST_FROM = 'toast';
/** A moment's tokens fly under the toasts (UI's 80) and over the Streak and Missions sheets (70). */
const TOKEN_DEPTH = 79;
/** Where a purchase flies from: the middle of the canvas, where the store's card was. */
const sheetFrom = (): { x: number; y: number } => ({ x: BASE_WIDTH / 2, y: viewHeight() / 2 });

/**
 * Stands in for "you have N" until the moment plays: what the chip will say
 * once it lands, counted then — a moment carried to a later build (after a
 * level spent some) must not quote the balance it was queued with.
 */
const YOU_HAVE = '{have}';

/** The bookmark's mark on the streak chip (the mock's 16 pt). */
const BOOKMARK_W = dp(16);
/** The streak chip's own dot, drawn apart so it keeps full strength on a faint chip. */
const CHIP_DOT = 'streak-dot';

/**
 * Settings, on the sheet recipe: the header (the title at pt(32), as on the
 * Streak and Missions sheets), then the rows; then the footer — the version
 * line, and [Close] under it.
 */
const SETTINGS_HEAD = pt(58);
const SETTINGS_TITLE_Y = pt(32);
const SETTINGS_PAD = pt(18);
const SETTINGS_VERSION_Y = pt(15);
const SETTINGS_VERSION_H = pt(20);
const SETTINGS_CLOSE_Y = pt(52);
const SETTINGS_CLOSE_H = pt(44);
const SETTINGS_FOOT = pt(84);

/**
 * Registry key: what the last build showed — the Continue level, its beads,
 * the missions' progress — so the next can move on from it (the return beats).
 */
const MENU_SHOWN = 'menuShown';

interface Shown {
  readonly index: number;
  readonly beads: Bead[];
  readonly date: string;
  readonly progress: number[];
}

/** localStorage: the local date the logo last drew itself in. A per-viewer nicety. */
const LOGO_DAY_KEY = 'foldwing.logoDay';

/**
 * localStorage: when the newest figure was drawn, as of the last time the
 * Gallery tile was opened — for its "something new" dot. A per-viewer nicety:
 * without storage there is simply never a dot, which is never a nag.
 */
export const GALLERY_SEEN_KEY = 'foldwing.galleryAt';

function galleryHasNew(newest: number): boolean {
  if (!(newest > 0)) return false;
  try {
    const raw = window.localStorage.getItem(GALLERY_SEEN_KEY);
    if (raw === null) {
      // First look: what is there now is not news.
      window.localStorage.setItem(GALLERY_SEEN_KEY, String(newest));
      return false;
    }
    return newest > Number(raw);
  } catch {
    return false;
  }
}

function markGallerySeen(newest: number): void {
  try {
    window.localStorage.setItem(GALLERY_SEEN_KEY, String(newest));
  } catch {
    /* the dot stays; harmless */
  }
}

/**
 * The logo's draw-in with the reflection in the SAME frame as the line (SPEC
 * §2.5.2 — the mirror never lags): Logo's own timeline for the line and its
 * dot, and the mirror given the line's.
 */
function logoDrawAt(at: number): MarkProgress {
  const p = drawInAt(at);
  return { line: p.line, lineDot: p.lineDot, mirror: p.line, mirrorDot: p.lineDot };
}

/**
 * Repaint a lockup's mark at `p` into its own texture, as Logo paints it (its
 * bleed and resolution read back off the Image). False — and nothing painted —
 * if the texture is not the shape Logo makes, so a change there falls back to
 * Logo's own draw-in rather than drawing the mark out of place.
 */
function paintLogo(l: Logo, p: MarkProgress): boolean {
  const tex = l.mark.texture;
  if (!(tex instanceof Phaser.Textures.CanvasTexture) || !(l.mark.scaleX > 0)) return false;
  const res = 1 / l.mark.scaleX;
  const bleed = Math.ceil(markBleed() * (l.markH / MARK_BOX.h)) + 2;
  if (tex.width !== Math.ceil((l.markW + bleed * 2) * res) || tex.height !== Math.ceil((l.markH + bleed * 2) * res)) {
    return false;
  }
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, tex.width, tex.height);
  paintMark(ctx, bleed * res, bleed * res, l.markH * res, p, markColors());
  tex.refresh();
  return true;
}

/** Texture pixels per base unit for the beads and the start dot: sharp at the 1.6× an iPhone draws at. */
const BEAD_RES = 2;
/** Room round the bead string for the current bead's glow, in texture pixels. */
const BEAD_PAD = dp(8) * BEAD_RES;

/**
 * The chapter's twenty beads as one baked texture (tech G2), per bead string
 * and width: 7 pt pills, 3 pt apart (the mock's `.segs`). Cleared in moonlit
 * cream, ★★★ in gold, the current one tangerine with its glow, a skipped one
 * a quiet outline, the rest sunk.
 */
function beadsTexture(scene: Phaser.Scene, beads: readonly Bead[], w: number): string {
  const key = `fw-beads-${beadSignature(beads)}-${Math.round(w)}`;
  if (scene.textures.exists(key)) return key;
  const t = theme();
  const u = ui();
  const r = BEAD_RES;
  const tex = scene.textures.createCanvas(key, Math.ceil(w * r + BEAD_PAD * 2), Math.ceil(BEAD_H * r + BEAD_PAD * 2));
  if (!tex) return '__MISSING';
  const ctx = tex.getContext();
  const { pitch, width } = beadPitch(w, beads.length);
  const pill = (x: number, fill: string | null, stroke?: string): void => {
    const rr = (BEAD_H * r) / 2;
    const px = BEAD_PAD + x * r;
    const py = BEAD_PAD;
    const pw = width * r;
    const ph = BEAD_H * r;
    ctx.beginPath();
    ctx.moveTo(px + rr, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, rr);
    ctx.arcTo(px + pw, py + ph, px, py + ph, rr);
    ctx.arcTo(px, py + ph, px, py, rr);
    ctx.arcTo(px, py, px + pw, py, rr);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5 * r;
      ctx.stroke();
    }
  };
  const cleared = hexCss(theme().mirror !== undefined ? blendCream(u.text, theme().mirror as number) : u.text);
  beads.forEach((b, i) => {
    const x = i * pitch;
    switch (b) {
      case 'gold':
        pill(x, hexCss(t.medal));
        return;
      case 'cleared':
        pill(x, cleared);
        return;
      case 'current':
        ctx.save();
        ctx.shadowColor = rgba(t.accent, 0.55);
        ctx.shadowBlur = dp(8) * r;
        pill(x, hexCss(t.accent));
        ctx.restore();
        return;
      case 'skipped':
        pill(x, rgba(u.text, 0.05), rgba(u.text, 0.28));
        return;
      default:
        pill(x, rgba(u.well, 0.9), rgba(u.text, 0.06));
    }
  });
  tex.refresh();
  return key;
}

/** Cleared beads: the cream a step toward moonlight — the mock's #D8E3DF. */
function blendCream(cream: number, moon: number): number {
  const mix = (sh: number): number => Math.round(((cream >> sh) & 0xff) * 0.55 + ((moon >> sh) & 0xff) * 0.45);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** The Continue button's glyph: the start dot, dark on the tangerine, in a faint ring (the mock's `.pdot`). */
function startDotTexture(scene: Phaser.Scene, d: number): string {
  const key = `fw-start-dot-${Math.round(d)}`;
  if (scene.textures.exists(key)) return key;
  const r = BEAD_RES;
  const ring = dp(4);
  const side = Math.ceil((d + ring * 2 + 2) * r);
  const tex = scene.textures.createCanvas(key, side, side);
  if (!tex) return '__MISSING';
  const ctx = tex.getContext();
  const c = side / 2;
  const u = ui();
  ctx.fillStyle = rgba(u.onAccent, 0.18);
  ctx.beginPath();
  ctx.arc(c, c, (d / 2 + ring) * r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexCss(u.onAccent);
  ctx.beginPath();
  ctx.arc(c, c, (d / 2) * r, 0, Math.PI * 2);
  ctx.fill();
  tex.refresh();
  return key;
}

type Icon = 'eye' | 'bookmark' | 'flame' | 'none';

const GLYPHS: Record<Icon, Glyph | undefined> = {
  eye: eyeGlyph,
  bookmark: bookmarkGlyph,
  flame: flameGlyph,
  none: undefined,
};

/**
 * Something that arrived, as the menu shows it. Plain data, so a restart can
 * hand the ones not yet shown to the rebuilt menu through the registry.
 */
interface Moment {
  /** The toast. Empty: no toast, only the chip moves. */
  readonly text: string;
  readonly tone: Tone;
  readonly icon: Icon;
  /** The balance chip counts up by this many when the moment lands. */
  readonly reveals?: number;
  /** Tokens that fly into a chip first; the moment lands with the last. */
  readonly fly?: {
    readonly to: 'balance' | 'streak';
    readonly glyph: Icon;
    readonly count: number;
    readonly from: { x: number; y: number } | typeof TOAST_FROM;
  };
  /** The streak chip counts up to this, from `streakFrom`. */
  readonly streakTo?: number;
  readonly streakFrom?: number;
  /** The balance chip flips to ∞: Remove Ads arrived. */
  readonly unlimited?: boolean;
}

interface Celebration {
  readonly kind: 'removeAds' | 'restore' | 'reveals';
  readonly n: number;
  readonly text?: string;
}

type ToggleKey = 'sound' | 'music' | 'haptics' | 'reducedMotion';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * A streak milestone as a toast. Owners have unlimited reveals, so a count of
 * them means nothing there: the line keeps the moment and any bookmark, and
 * says ✓ — the same words the win card uses (Progress).
 */
function milestoneLine(m: Milestone, owner: boolean): string {
  if (!owner || m.reveals === 0) return `${m.title} · ${m.body}`;
  return m.bookmarks > 0 ? `${m.title} · +1 bookmark ✓` : `${m.title} ✓`;
}

/** "4 chapters already folded", or the halfway marks when no chapter was finished. */
function backlogLine(marks: readonly string[]): string {
  const parsed = marks.map(parseMark).filter((p): p is NonNullable<typeof p> => p !== null);
  const full = new Set(parsed.filter((p) => p.at === 20).map((p) => p.chapter));
  if (full.size > 0) return `${plural(full.size, 'chapter', 'chapters')} already folded`;
  const half = [...new Set(parsed.map((p) => p.chapter))];
  return half.length === 1 ? `halfway through chapter ${half[0] + 1}` : `halfway through ${half.length} chapters`;
}

const isMoment = (v: unknown): v is Moment =>
  typeof v === 'object' && v !== null && typeof (v as Moment).text === 'string' && typeof (v as Moment).tone === 'string';

export class MenuScene extends Phaser.Scene {
  /** The one sheet up — Settings, Store, Streak or Missions — or null. */
  private sheet: Phaser.GameObjects.Container | null = null;
  /** A store round trip or a reminder question is in flight; a second tap must not start another. */
  private busy = false;
  /** The floor, foot line and world height this build was laid out for. See `refit`. */
  private builtFloor = 0;
  private builtFootLine = 0;
  private builtHeight = 0;
  /** The day this build shows. See `watchForRollover`. */
  private builtFor = '';
  /** The day turned while a sheet was up; closing it rebuilds. */
  private rolloverPending = false;
  /** This build says the campaign is over — carried across a restart. */
  private finished = false;
  /** The tutorial is not done: no balance chip, no Store, no gift said (DailyCard.firstSession). */
  private firstSession = false;
  private offGrant: (() => void) | null = null;

  private balanceChip: Phaser.GameObjects.Container | null = null;
  /** Whether the balance chip was built with its "+". */
  private balancePlus = false;
  /** What the balance chip says right now: behind the save while a moment is still to land. */
  private shownReveals = 0;
  private streakChip: Phaser.GameObjects.Container | null = null;
  private shownStreak = 0;
  /** The run the streak chip holds, faint, while a repair can keep it; null when it shows the streak. */
  private streakChipRun: number | null = null;
  private dailyCard: Phaser.GameObjects.Container | null = null;
  private layout: MenuLayout | null = null;
  private strip: MissionStrip | null = null;
  /** The stacked logo, when this build drew one with its mark. */
  private logo: Logo | null = null;
  /** The wordmark and the tagline: what a page toast takes the place of where the brand is tight. */
  private brandWords: Phaser.GameObjects.GameObject[] = [];
  private brandBack: Phaser.Time.TimerEvent | null = null;
  /** Back from a win: what crossfades when the stage opens (`playReturn`). */
  private returning: {
    thumbFrom: Phaser.GameObjects.Image;
    thumbTo: Phaser.GameObjects.Image;
    beadsFrom: Phaser.GameObjects.Image | null;
    beadsTo: Phaser.GameObjects.Image | null;
  } | null = null;
  /** The current bead's glow, and its breathing (null under reduced motion). */
  private currentGlow: Phaser.GameObjects.Image | null = null;
  private breath: Phaser.Tweens.Tween | null = null;
  private nextIndex = 0;
  private allCleared = false;
  /** Notification permission as iOS last said; null until asked this build. */
  private permission: NudgePermission | null = null;

  private moments: Moment[] = [];
  private playing: { moment: Moment; landed: boolean } | null = null;
  /** Every menu toast, handed to the kit one at a time and placed when shown — see `say`. */
  private toasts = new ToastPacer<MenuToast>(new ToastQueue<MenuToast>());
  /** News said while a sheet was up, for when it closes (see say). */
  private heldToasts: { text: string; opts: ToastOptions }[] = [];
  /** When the pacer hands over the next toast waiting. */
  private toastTimer: Phaser.Time.TimerEvent | null = null;
  /** Moments wait for the page's entrance, so tokens fly to chips that are in place. */
  private stageOpen = false;

  constructor() {
    super('Menu');
  }

  /**
   * Whether any sheet is up. main.ts reads it (duck-typed) before it restarts
   * the menu for a reminder tapped while the app was open, and `refit` waits
   * on it: nothing is torn down from under a sheet the player is reading.
   */
  get sheetOpen(): boolean {
    return this.sheet !== null;
  }

  create(): void {
    const t = theme();
    this.cameras.main.setBackgroundColor(t.paper);

    /*
     * Fields outlive a restart — the scene object is reused — and a sheet that
     * was open when the menu rebuilt itself is destroyed with the old display
     * list but was still recorded here, which left the Store door refusing to
     * open for the rest of the session.
     */
    this.sheet = null;
    this.busy = false;
    this.rolloverPending = false;
    this.moments = [];
    this.playing = null;
    // The kit dropped its toasts with the old scene; the scene clock, the timer.
    this.toasts.clear();
    this.toastTimer = null;
    this.stageOpen = false;
    this.permission = null;

    /*
     * A reminder tapped while the app was open (main.ts): today's fold, before
     * anything is drawn. Checked again against the save — a Daily folded in the
     * meantime routes nowhere. Grants stay for the next build to show.
     */
    if (Nudges.takePendingRoute(this.registry) === 'daily') {
      this.scene.start('Game', { daily: todayISO() });
      return;
    }

    const today = todayISO();
    this.builtFor = today;

    /*
     * Hear grants from here on, and for the moment collect rather than show:
     * the free reveal of the day and the streak guard run next, and what they
     * pay is played below with everything else that arrived, in order.
     */
    const arrivals: GrantEvent[] = [];
    let collecting = true;
    this.offGrant?.();
    this.offGrant = Progress.onGrant((g) => {
      if (!collecting) return this.onLiveGrant(g);
      arrivals.push(g);
      // Claimed: this build shows them, so Progress need not keep them.
      return g.reason === 'daily' || g.reason === 'late-purchase' || g.reason === 'mission';
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.offGrant?.();
      this.offGrant = null;
      /*
       * Moments not yet shown go to the next build, however this one ends: the
       * listener above claimed their grants, so Progress no longer keeps them,
       * and a Continue tapped during the entrance — or main.ts restarting the
       * menu for a reminder — would otherwise lose the day's gift unseen.
       */
      const carry = [...(this.playing && !this.playing.landed ? [this.playing.moment] : []), ...this.moments];
      if (carry.length > 0) this.registry.set(MENU_MOMENTS, carry);
      this.balanceChip = null;
      this.streakChip = null;
      this.dailyCard = null;
      this.strip = null;
      this.logo = null;
      this.returning = null;
      this.currentGlow = null;
      this.breath = null;
      this.playing = null;
      this.moments = [];
    });

    /*
     * The free reveal of the day and the streak guard, before anything reads
     * the stash. They used to run only at launch and when the day changed
     * UNDER a built menu, so a player whose phone kept the app alive overnight
     * in a level came back to a menu built after midnight and never got that
     * day's reveal. Then the chapter backlog: marks for chapters folded before
     * 1.4 are paid once, here.
     */
    Progress.applyDailyTopUp();
    Progress.applyStreakGuard();
    const guard = Progress.takeStreakGuard();
    const backlog = Progress.settleChapterMarks('backlog');
    const missions = Progress.missionsToday();
    collecting = false;
    const grants = [
      ...Progress.takeUnshownGrants(),
      ...arrivals.filter((g) => g.reason === 'daily' || g.reason === 'late-purchase' || g.reason === 'mission'),
    ];

    const save = Progress.data;
    const owner = save.adsRemoved;
    this.firstSession = firstSession(save);
    const streak = Progress.dailyStreak(today);
    /*
     * Every level cleared. The frontier is clamped to the last level, so the
     * primary button went on offering "Continue · 300" — the level just
     * finished — right under the line congratulating the player for finishing.
     * The Continue card's model reads both (MenuLayout.continueModel): its
     * index is clamped onto the ladder there, since an out-of-range value
     * would throw inside create() and leave no scene running at all.
     */
    const cleared = new Set(save.cleared);
    const allCleared = LEVELS.every((l) => cleared.has(l.id));
    this.allCleared = allCleared;

    const finished = this.registry.get('campaignComplete') === true;
    if (finished) this.registry.remove('campaignComplete');
    this.finished = finished;

    /* ------------------------------------------------ what arrived */

    const flip = this.takeCelebration();
    const entries = this.arrivalMoments(guard, backlog, grants, flip, owner, missions);
    const streakFrom = this.streakFrom(streak);
    if (streakFrom !== null) entries.push({ text: '', tone: 'plain', icon: 'none', streakFrom, streakTo: streak });
    /*
     * Carried moments can be stale by now. A tick counts to the streak of its
     * day, and one that no longer ends at today's would move the flame to a
     * wrong number; a flip to ∞ for a purchase since refunded would lie.
     */
    this.moments = entries.filter(
      (m) => (m.streakTo === undefined || m.streakTo === streak) && (!m.unlimited || owner)
    );

    // The chips start where the save was before these moments; each one moves them.
    const pending = this.moments.reduce((s, m) => s + (m.reveals ?? 0), 0);
    const flips = this.moments.some((m) => m.unlimited);
    this.shownReveals = owner && !flips ? Infinity : Math.max(0, save.reveals - (owner ? 0 : pending));
    this.shownStreak = this.moments.find((m) => m.streakTo !== undefined)?.streakFrom ?? streak;
    this.registry.set(MENU_STREAK_SHOWN, streak);

    /* ------------------------------------------------- the page */

    /*
     * Laid out for the world as it is now (Theme.viewHeight): the header hugs
     * the top of the screen, the stack hugs the thumb and the banner, and the
     * logo takes the room between (MenuLayout).
     */
    const height = viewHeight();
    const floor = minTap(this);
    const line = this.footLine();
    const L = menuLayout({ height, footLine: line, floor, missions: missions !== null });
    this.layout = L;
    this.builtFloor = floor;
    this.builtFootLine = line;
    this.builtHeight = height;
    const entering: Phaser.GameObjects.GameObject[] = [];

    // The top row: the streak (once there is one to show), the balance, •••.
    const top: Phaser.GameObjects.GameObject[] = [];
    if (Object.keys(save.daily).length > 0) {
      this.streakChip = this.buildStreakChip(this.shownStreak);
      top.push(this.streakChip);
    } else {
      this.streakChip = null;
    }
    // Not in the first session: no count of a currency the player has not met.
    this.balanceChip = this.firstSession ? null : this.buildBalanceChip(this.shownReveals);
    if (this.balanceChip) top.push(this.balanceChip);
    top.push(this.buildMore(L));
    if (missions && L.stripCollapsed) top.push(this.buildMissionChip(missions, L));
    entering.push(...top);

    this.strip = missions && L.strip ? this.buildMissionStrip(missions, L) : null;
    if (this.strip) entering.push(this.strip.container);

    /*
     * The end of the campaign is said once, here, in its place: clearing the
     * three-hundredth maze used to drop the player back on the level grid with
     * no acknowledgement at all. A player who has never won gets the rule of
     * the game instead of its motto — "one line. two answers." does not tell
     * anyone what to do.
     */
    const taglineText = finished
      ? `all ${LEVELS.length} folded. the Daily is still yours.`
      : save.totalWins === 0
        ? 'draw one line. its mirror must survive too.'
        : 'one line. two answers.';
    const brand = this.buildBrand(L, taglineText);
    if (brand) entering.push(brand);

    const model = continueModel(save, { allCleared, firstSession: this.firstSession, owner });
    this.nextIndex = model.index;
    const shown = this.takeShown(model, missions);
    entering.push(this.buildContinueCard(L, model, shown));

    this.dailyCard = this.buildDailyCard();
    entering.push(this.dailyCard);

    entering.push(this.buildTiles(L, owner));

    enter(this, entering);
    /*
     * Moments open once the page has arrived, so the chips are where tokens
     * fly — and once the opening film has gone. The menu is built behind it
     * (render/Intro.ts, its `data-intro` layer), and it plays on the first
     * launch of each version, which is when the day's gift can arrive too:
     * the toast and the flight used to play out under the film, unseen. The
     * return beats (the thumbnail, the beads, the rings) and the logo's
     * draw-in wait for the same moment, for the same reason.
     */
    const openStage = (): void => {
      if (document.querySelector('[data-intro]')) {
        this.time.delayedCall(200, openStage);
        return;
      }
      this.stageOpen = true;
      this.playReturn(shown);
      this.drawLogoIn();
      this.playMoments();
    };
    this.time.delayedCall(560, openStage);

    this.watchForRollover(today);
    this.watchScale();

    // The banner is on in every scene; each one keeps its strip clear
    // (METRICS.bannerReserve), so it never sits over anything tappable.
    void Ads.showBanner();

    if (Nudges.available) {
      void Nudges.permission().then((p) => {
        this.permission = p;
      });
    }

    /*
     * Sign in to Game Center here, and nowhere else — and not before the ad
     * consent flow is over.
     *
     * GameKit may put its own sheet on screen. On the menu that costs nothing;
     * during a level it would land over a stroke in progress and take the
     * attempt with it. That sheet also goes up on the very view controller the
     * consent alert is presented from, and UIKit silently refuses to present
     * over a controller that is already presenting: with the sheet up first,
     * the consent question never appeared and the session went without ads.
     * The menu is built behind the opening film, before consent is even asked,
     * so the sign-in waits for Ads.consentFlowDone (settled at once in a build
     * with no consent modal) — and happens only if the player is still on the
     * menu by then; if not, the next visit to the menu signs in.
     *
     * The store's prices are asked for at the same point, for the same reason:
     * StoreKit off the cold launch path, and prices ready before the Store is
     * opened. When they arrive the Store button learns whether the starter is
     * NEW, and the chip whether it has anything to sell.
     */
    void Ads.consentFlowDone.then(() => {
      if (this.scene.isActive()) void GameCenter.signIn();
    });
    void Ads.consentFlowDone.then(() => {
      if (!this.scene.isActive() || !Iap.available) return;
      void Iap.warm().then(() => {
        if (this.scene.isActive()) this.refreshStoreState();
      });
    });
    /*
     * The Levels page's kit and chapter strip, painted a second after the
     * menu has settled (under the film on a cold launch), so the session's
     * first visit to Levels opens as fast as every later one (tech G13). The
     * kit is painted once a session; the strip only when a win changed it.
     */
    this.time.delayedCall(1000, () => {
      if (this.scene.isActive()) warmLevels(this);
    });
  }

  /* ------------------------------------------------------------ arrivals */

  /** Take the purchase a restart was made for, if any. */
  private takeCelebration(): Celebration | null {
    const c = this.registry.get(MENU_CELEBRATE) as Celebration | undefined;
    if (c === undefined) return null;
    this.registry.remove(MENU_CELEBRATE);
    if (typeof c !== 'object' || c === null) return null;
    if (c.kind !== 'removeAds' && c.kind !== 'restore' && c.kind !== 'reveals') return null;
    return { kind: c.kind, n: Number.isFinite(c.n) ? Math.max(0, Math.trunc(c.n)) : 0, text: c.text };
  }

  /**
   * The streak to tick the chip up from after a Daily win, or null. GameScene's
   * word (MENU_STREAK_FROM) when it gave one; otherwise the streak the last
   * menu showed, when today's Daily is now folded and the run grew.
   */
  private streakFrom(streak: number): number | null {
    const given = this.registry.get(MENU_STREAK_FROM);
    if (given !== undefined) this.registry.remove(MENU_STREAK_FROM);
    if (typeof given === 'number' && Number.isFinite(given) && given >= 0 && given < streak) return given;
    const shown = this.registry.get(MENU_STREAK_SHOWN);
    if (typeof shown === 'number' && shown >= 0 && shown < streak && Progress.hasDaily(this.builtFor)) return shown;
    return null;
  }

  /**
   * Everything that arrived since the last build, in the order §1.8 plays it:
   * whatever a restart interrupted, then a bookmark that kept the streak, the
   * chapter backlog, the day's gift (with late purchases and a mission the
   * Daily finished), and the purchase the menu was rebuilt for.
   *
   * The first session says no gift: it lands in the balance all the same, and
   * the chip that would count it is not drawn yet.
   */
  private arrivalMoments(
    guard: ReturnType<typeof Progress.takeStreakGuard>,
    backlog: { marks: string[]; reveals: number },
    grants: readonly GrantEvent[],
    flip: Celebration | null,
    owner: boolean,
    missions: MissionState | null
  ): Moment[] {
    const out: Moment[] = [];
    const carried = this.registry.get(MENU_MOMENTS);
    if (carried !== undefined) this.registry.remove(MENU_MOMENTS);
    if (Array.isArray(carried)) out.push(...carried.filter(isMoment));

    const notice = this.registry.get(MENU_NOTICE);
    if (notice !== undefined) this.registry.remove(MENU_NOTICE);
    if (typeof notice === 'string' && notice) out.push({ text: notice, tone: 'plain', icon: 'none' });

    if (guard && guard.bridged.length > 0) {
      const n = guard.bridged.length;
      out.push({
        text: `${n === 1 ? 'A bookmark' : `${n} bookmarks`} kept your ${guard.streak}-day streak · ${guard.left} left`,
        tone: 'plain',
        icon: 'bookmark',
        fly: { to: 'streak', glyph: 'bookmark', count: n, from: TOAST_FROM },
      });
      // Already paid (reason 'streak'): a bridge that joined today's run.
      for (const m of guard.milestones) {
        out.push({ text: milestoneLine(m, owner), tone: 'reward', icon: 'flame', reveals: owner ? 0 : m.reveals });
      }
    }

    if (backlog.marks.length > 0 && backlog.reveals > 0) {
      const what = backlogLine(backlog.marks);
      out.push(
        owner
          ? { text: `${what} ✓`, tone: 'reward', icon: 'eye' }
          : {
              text: `${what} · +${plural(backlog.reveals, 'reveal', 'reveals')}`,
              tone: 'reward',
              icon: 'eye',
              reveals: backlog.reveals,
              fly: { to: 'balance', glyph: 'eye', count: backlog.reveals, from: TOAST_FROM },
            }
      );
    }

    // Missions paid while away, said once and named where they can be.
    let missionsPaid = 0;
    for (const g of grants) {
      if (g.reason === 'late-purchase') {
        const text = grantNotice(g);
        if (!text) continue;
        if (g.adsRemoved === true) {
          out.push({ text, tone: 'reward', icon: 'eye', unlimited: true });
          continue;
        }
        if (owner || g.reveals <= 0) continue;
        out.push({
          text,
          tone: 'reward',
          icon: 'eye',
          reveals: g.reveals,
          fly: { to: 'balance', glyph: 'eye', count: g.reveals, from: sheetFrom() },
        });
        continue;
      }
      // The gift and a mission the Daily finished are not shown to owners:
      // unlimited reveals have no count to add to.
      if (owner || g.reveals <= 0) continue;
      if (g.reason === 'mission') {
        missionsPaid += g.reveals;
        continue;
      }
      if (this.firstSession) continue;
      out.push({
        text: `+${plural(g.reveals, 'free reveal', 'free reveals')} for today · you have ${YOU_HAVE}`,
        tone: 'reward',
        icon: 'eye',
        reveals: g.reveals,
        fly: { to: 'balance', glyph: 'eye', count: g.reveals, from: TOAST_FROM },
      });
    }
    if (missionsPaid > 0) {
      const count = Math.max(1, Math.round(missionsPaid / monetization.economy.missions.reward));
      out.push({
        text: missionDoneLine(missions, count),
        tone: 'reward',
        icon: 'eye',
        reveals: missionsPaid,
        fly: { to: 'balance', glyph: 'eye', count: missionsPaid, from: TOAST_FROM },
      });
    }

    if (flip) {
      if (flip.kind === 'reveals') {
        if (flip.n > 0 && !owner) {
          out.push({
            text: flip.text ?? `+${plural(flip.n, 'reveal', 'reveals')} · you have ${YOU_HAVE}`,
            tone: 'reward',
            icon: 'eye',
            reveals: flip.n,
            fly: { to: 'balance', glyph: 'eye', count: flip.n, from: sheetFrom() },
          });
        }
      } else {
        out.push({
          text:
            flip.text ??
            (flip.kind === 'restore' ? 'restored · no ads, unlimited reveals' : 'ads removed · reveals are unlimited now'),
          tone: 'reward',
          icon: 'eye',
          unlimited: true,
        });
      }
    }
    return out;
  }

  /**
   * A grant while the menu is up. Only two are this listener's to show: the
   * day's gift when the day turns under a built menu that is still today's,
   * and a late purchase (an Ask to Buy approved, a redelivery). Everything else
   * is shown by the flow that caused it — the store sheet, the Streak sheet —
   * or by the next build.
   */
  private onLiveGrant(g: GrantEvent): boolean {
    if (!this.scene.isActive()) return false;
    const owner = Progress.data.adsRemoved;
    if (g.reason === 'daily') {
      // Built for another day: the rollover's rebuild shows it.
      if (todayISO() !== this.builtFor) return false;
      // Owners have no count to add to; the first session, no chip to count it.
      if (owner || g.reveals <= 0 || this.firstSession) return true;
      this.enqueue({
        text: `+${plural(g.reveals, 'free reveal', 'free reveals')} for today · you have ${YOU_HAVE}`,
        tone: 'reward',
        icon: 'eye',
        reveals: g.reveals,
        fly: { to: 'balance', glyph: 'eye', count: g.reveals, from: TOAST_FROM },
      });
      return true;
    }
    if (g.reason === 'late-purchase') {
      const text = grantNotice(g);
      if (!text) return false;
      if (g.adsRemoved === true) {
        this.celebrateOwnership({ kind: 'removeAds', n: this.shownReveals, text });
      } else if (owner || g.reveals <= 0) {
        this.say(text, { tone: 'reward', icon: eyeGlyph });
      } else {
        this.enqueue({
          text,
          tone: 'reward',
          icon: 'eye',
          reveals: g.reveals,
          fly: { to: 'balance', glyph: 'eye', count: g.reveals, from: sheetFrom() },
        });
      }
      return true;
    }
    return false;
  }

  private enqueue(m: Moment): void {
    this.moments.push(m);
    this.playMoments();
  }

  /**
   * Remove Ads arrived — bought, restored, or approved late. It changes which
   * rows the menu HAS (the Store third and the chip's "+" go), so the menu is
   * rebuilt and the rebuilt one flips the chip to ∞: `now` when the sheet up
   * is where it was bought, else once the sheet the player is reading closes
   * (closeSheet). A chip already at ∞ has nothing to flip — a restore of what
   * the player already owned — so that is only said.
   */
  private celebrateOwnership(c: Celebration, now = false): void {
    if (!Number.isFinite(this.shownReveals)) {
      if (c.text) this.say(c.text, { tone: 'reward', icon: eyeGlyph });
      return;
    }
    this.registry.set(MENU_CELEBRATE, c);
    if (now || !this.sheet) this.restartMenu();
  }

  /**
   * Play the next moment, if the stage is free: its toast, its tokens, and on
   * the last token the chip it changes. One at a time — the toast queue would
   * otherwise let a newer reward line replace a waiting one, and "4 chapters
   * already folded" would never be read.
   */
  private playMoments(): void {
    if (!this.stageOpen || this.playing || !this.scene.isActive()) return;
    const m = this.moments.shift();
    if (!m) {
      // The store's answer may have come while a moment held the chip.
      this.refreshStoreState();
      this.reconcile();
      return;
    }
    const slot = { moment: m, landed: false };
    this.playing = slot;
    // "you have N": what the chip will say once this one has landed.
    const text = m.text.replace(YOU_HAVE, countText(this.shownReveals + (m.reveals ?? 0)));
    const icon = GLYPHS[m.icon];
    // Where its toast goes if it shows now; `say` places it again when it does.
    const y = text ? this.toastLine(text, icon) : undefined;
    if (text) this.say(text, { tone: m.tone, icon });

    const land = (): void => {
      if (slot.landed) return;
      slot.landed = true;
      this.landMoment(m);
    };
    const target = m.fly ? (m.fly.to === 'balance' ? this.balanceChip : this.streakChip) : null;
    if (m.fly && target && m.fly.count > 0) {
      const to = m.fly.to;
      flyReward(this, {
        from: m.fly.from !== TOAST_FROM ? m.fly.from : text ? this.underToastAt(text, icon, y, to) : this.giftFrom(),
        // Under the toast (80), over the sheets (70): the words stay on top.
        depth: TOKEN_DEPTH,
        to: () => this.chipAnchor(to),
        count: m.fly.count,
        glyph: GLYPHS[m.fly.glyph] ?? eyeGlyph,
        target,
        onLand: land,
      });
    } else {
      this.time.delayedCall(220, land);
    }
    this.time.delayedCall(m.text ? MOMENT_MS : 900, () => {
      land();
      if (this.playing !== slot) return;
      this.playing = null;
      this.playMoments();
    });
  }

  /** The chip changes: the count, the flip to ∞, the flame. */
  private landMoment(m: Moment): void {
    if (!this.scene.isActive()) return;
    const reveals = m.reveals ?? 0;
    if (reveals > 0 && this.balanceChip && Number.isFinite(this.shownReveals)) {
      countUp(this, this.balanceChip, this.shownReveals, this.shownReveals + reveals);
      this.shownReveals += reveals;
    }
    // No chip to flip in the first session: it has none (see create).
    if (m.unlimited && Number.isFinite(this.shownReveals) && this.balanceChip) {
      // No "+" on an owner's chip: rebuilt without it, then flipped.
      this.balanceChip.destroy();
      this.balanceChip = this.buildBalanceChip(this.shownReveals);
      countUp(this, this.balanceChip, this.shownReveals, Infinity);
      pulse(this, this.balanceChip);
      this.shownReveals = Infinity;
    }
    if (m.streakTo !== undefined && this.streakChip) {
      countUp(this, this.streakChip, this.shownStreak, m.streakTo);
      fadeChip(this.streakChip, m.streakTo > 0 ? 1 : 0.45);
      pulse(this, this.streakChip);
      this.shownStreak = m.streakTo;
    }
    this.refreshStoreState();
  }

  /**
   * Once the moments are done, the chip says what the save says — whatever a
   * flight that never landed or a grant nobody announced left behind.
   */
  private reconcile(): void {
    if (!this.balanceChip) return;
    const truth = Progress.data.adsRemoved ? Infinity : Progress.data.reveals;
    if (truth === this.shownReveals) return;
    countUp(this, this.balanceChip, this.shownReveals, truth);
    this.shownReveals = truth;
  }

  /**
   * A toast, where it can be read — every toast on the menu goes through here.
   * With a sheet up it sits above the sheet's card (MenuLayout.sheetToastY),
   * never on the sheet's title or rows; else on the kit's line under the
   * strip. `urgent` for the answer to a tap (see UI.toast).
   *
   * Where is decided when the toast SHOWS: it waits its turn in the pacer
   * (MenuLayout.ToastPacer), not in the kit's queue, which keeps the line it
   * was given — a toast said on the page and shown after a sheet opened came
   * up on the sheet's title.
   */
  private say(text: string, opts: ToastOptions = {}): void {
    if (!this.scene.isActive()) return;
    // News said while a sheet is up waits for it to close: over the sheet's
    // scrim it drew at full brightness on whatever it found there (QA). The
    // answer to a tap (urgent) and a moment's own line still speak now.
    if (this.sheet && opts.urgent !== true && !this.playing) {
      this.heldToasts.push({ text, opts });
      return;
    }
    const t: MenuToast = { text, tone: opts.tone ?? 'plain', urgent: opts.urgent === true, opts };
    this.showToast(this.toasts.say(t, this.time.now));
  }

  /** Give the kit `t`, placed now, if there is one; then wait for the next one's turn. */
  private showToast(t: MenuToast | null): void {
    if (t && this.scene.isActive()) {
      t.y = t.opts.y ?? this.toastLine(t.text, t.opts.icon);
      t.onSheet = t.opts.y !== undefined || this.sheet !== null;
      if (!t.onSheet && this.layout && pageToastSlot(this.layout, this.toastPill(t.text, t.opts.icon).h).coversWord) {
        this.yieldBrand(this.toasts.onScreen(this.time.now)?.until ?? this.time.now + 3000);
      }
      toast(this, t.text, { ...t.opts, tone: t.tone, urgent: t.urgent, y: t.y });
    }
    this.toastTimer?.remove();
    const due = this.toasts.due;
    this.toastTimer =
      due === null
        ? null
        : this.time.delayedCall(Math.max(0, due - this.time.now), () =>
            this.showToast(this.toasts.next(this.time.now))
          );
  }

  /**
   * A page toast is centred on the wordmark (MenuLayout.pageToastSlot): the
   * word and its tagline fade out for as long as it shows, so the toast
   * takes their place rather than cutting them in half, and come back after.
   */
  private yieldBrand(until: number): void {
    const words = this.brandWords.filter((o) => o.scene);
    if (words.length === 0) return;
    this.tweens.killTweensOf(words);
    this.tweens.add({ targets: words, alpha: 0, duration: ms(160), ease: 'Sine.easeOut' });
    this.brandBack?.remove();
    this.brandBack = this.time.delayedCall(Math.max(0, until - this.time.now), () => {
      this.brandBack = null;
      const back = this.brandWords.filter((o) => o.scene);
      this.tweens.killTweensOf(back);
      this.tweens.add({ targets: back, alpha: 1, duration: ms(220), ease: 'Sine.easeInOut' });
    });
  }

  /**
   * A sheet just opened over a toast still on the page's line — the arrival
   * toast, most often, when the player taps a chip as it lands. That line is
   * where a sheet's title sits: the toast moves above the card for the rest
   * of its time, rather than cover the title (QA round 1, seen on the Streak
   * sheet over "Mission done"). Its copy goes over it as an urgent one does,
   * so the one on the page leaves in the kit's quick fade and the toasts
   * waiting keep their turn. VoiceOver reads the line again: the kit has no
   * way to move a toast it is showing.
   */
  private liftToast(): void {
    const now = this.time.now;
    const s = this.toasts.onScreen(now);
    if (!s || s.toast.onSheet || !this.sheet) return;
    const holdMs = liftedHold(s.until, now);
    if (holdMs < 400) return;
    // No paper over or under the card (a 9:16 phone's Store): the line it
    // would move to is the top row's chips (QA). News is not an answer — it
    // leaves now and is said again when the sheet closes.
    const line = this.toastLine(s.toast.text, s.toast.opts.icon);
    const h = this.toastPill(s.toast.text, s.toast.opts.icon).h;
    if (!s.toast.urgent && line !== undefined && line - h / 2 < TOP_BAR_Y + TOP_CHIP_H / 2) {
      clearToasts(this);
      this.heldToasts.push({ text: s.toast.text, opts: { ...s.toast.opts, holdMs } });
      return;
    }
    this.showToast(this.toasts.say({ ...s.toast, urgent: true, opts: { ...s.toast.opts, holdMs } }, now));
  }

  /**
   * The line the toast saying `text` is centred on right now: above the open
   * sheet's card, in the room its own height needs; or the kit's default.
   */
  private toastLine(text: string, icon: Glyph | undefined): number | undefined {
    const h = this.toastPill(text, icon).h;
    const box = this.sheet ? sheetCardBox(this.sheet) : null;
    if (box) return sheetToastY(box.top, h, { cardBottom: box.bottom, floor: this.layout?.bottom ?? viewHeight() });
    return this.layout ? pageToastY(this.layout, h) : undefined;
  }

  /**
   * The pill the kit will draw for `text`, measured as it lays one out
   * (UI.showNextToast: pt(16) each side, pt(22) for a mark, at most two lines,
   * never wider than the column).
   */
  private toastPill(text: string, icon: Glyph | undefined): { w: number; h: number } {
    const iconW = icon ? pt(22) : 0;
    const room = COLUMN - pt(16) * 2 - iconW;
    const probe = label(this, 0, 0, '', { size: TYPE.label });
    const measure = (s: string): number => probe.setText(s).width;
    const lines = toastLines(text, measure, room);
    const widest = Math.min(room, Math.max(...lines.map(measure)));
    probe.destroy();
    return { w: widest + pt(16) * 2 + iconW, h: lines.length > 1 ? TOAST_MAX_H : TOAST_H };
  }

  /** Where a moment's tokens leave from: just under its toast on `y`, at the end nearer `to`. */
  private underToastAt(
    text: string,
    icon: Glyph | undefined,
    y: number | undefined,
    to: 'balance' | 'streak'
  ): { x: number; y: number } {
    const pill = this.toastPill(text, icon);
    const line = y ?? (this.layout ? pageToastY(this.layout, pill.h) : TOAST_TOP + pill.h / 2);
    return underToast({ ...pill, y: line }, to === 'balance' ? 'right' : 'left');
  }

  /**
   * Where a token leaves from with no toast to leave from: the middle of the
   * logo's room, where the eye rests on arrival. The day's gifts leave from
   * under their own toast (`TOAST_FROM`).
   */
  private giftFrom(): { x: number; y: number } {
    return { x: BASE_WIDTH / 2, y: this.layout ? this.layout.brandMid : viewHeight() / 3 };
  }

  /** Where a token lands on a chip: its mark, at the left end. */
  private chipAnchor(which: 'balance' | 'streak'): { x: number; y: number } {
    const c = which === 'balance' ? this.balanceChip : this.streakChip;
    if (!c || !c.scene) return this.giftFrom();
    return { x: c.x - chipWidth(c) / 2 + pt(19), y: c.y };
  }

  /* ------------------------------------------------------------- top bar */

  /**
   * The reveal balance: the eye, the count, and a "+" wherever there is
   * something to buy. Owners see ∞ and no "+" — nothing is for sale to them.
   */
  private buildBalanceChip(shown: number): Phaser.GameObjects.Container {
    const plus = !Progress.data.adsRemoved && storeSells();
    this.balancePlus = plus;
    const c = chip(this, BALANCE_CHIP_RIGHT, TOP_BAR_Y, {
      glyph: eyeGlyph,
      text: countText(shown),
      plus,
      align: 'right',
      maxTap: TOP_TAP_MAX,
      onPress: () => this.pressBalance(),
    });
    c.setName('balance-chip');
    return c;
  }

  /**
   * The chip opens the store for anyone it could sell to. With nothing on the
   * shelf the store's own card says why — unreachable, payments off — which
   * a toast could not; only where there is no store at all (the web, a build
   * without payments) does `openStore` fall back to one. Owners are thanked.
   */
  private pressBalance(): void {
    if (this.sheet) return;
    if (!Progress.data.adsRemoved) {
      this.openStore();
      return;
    }
    Haptics.tap();
    this.say('unlimited reveals · thank you for supporting Foldwing', { icon: eyeGlyph, urgent: true });
  }

  /**
   * The streak: the flame and the run, then — when any are held — a hairline
   * and the bookmarks, counted (the mock's `6 | 🔖 1`): repair capacity beside
   * the flame, so a missed day reads as recoverable. Faint at 0 — the run
   * broke, and the chip stays as the way to the Streak sheet. While a missed
   * day can still be kept (DailyCard.streakChipState) it holds the run the
   * repair would keep, faint, with the accent dot at full strength over it:
   * "0" beside "keep your 12-day streak" read as a loss (QA round 1), and a
   * faint dot defeats the point of it.
   *
   * Sized for the larger of what it shows and the streak now, so a count-up
   * never outgrows it; the bookmarks sit after the text at that size.
   */
  private buildStreakChip(shown: number): Phaser.GameObjects.Container {
    const u = ui();
    const today = todayISO();
    const st = streakChipState(Progress.data, today);
    const holding = st.faint && st.dot;
    this.streakChipRun = holding ? st.count : null;
    const count = holding ? st.count : shown;
    const final = Math.max(count, Progress.dailyStreak(today));
    const held = Math.max(0, Math.min(Progress.bookmarks, monetization.economy.streak.bookmarkMax));
    // Measured on a throwaway chip, so the chip's own padding decides where the text ends.
    const probe = chip(this, 0, 0, { glyph: flameGlyph, text: String(final) });
    const fit = chipWidth(probe);
    const probeText = probe.list.find((o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text);
    const textEnd = probeText ? probeText.x + probeText.width + fit / 2 : fit - pt(14);
    probe.destroy(true);

    // The bookmark part: a hairline, the mark, the count.
    const heldText = held > 0 ? label(this, 0, 0, String(held), { size: TYPE.label, weight: 500, color: u.text3 }) : null;
    const extra = heldText ? dp(8) + 1 + dp(8) + BOOKMARK_W + dp(4) + heldText.width : 0;
    const width = fit + extra;
    const c = chip(this, STREAK_CHIP_LEFT, TOP_BAR_Y, {
      glyph: flameGlyph,
      text: String(count),
      width,
      dot: st.dot && !holding,
      align: 'left',
      maxTap: this.layout?.tapMax.top ?? TOP_TAP_MAX,
      onPress: () => this.openStreak(),
    });
    c.setName('streak-chip');
    if (heldText) {
      let x = -width / 2 + textEnd + dp(8);
      c.add(this.add.rectangle(x, 0, 1, dp(16), u.text, u.hairAlpha * 1.4).setOrigin(0, 0.5));
      x += 1 + dp(8);
      c.add(icon(this, x + BOOKMARK_W / 2, 0, 'bookmark', { size: BOOKMARK_W, color: u.text2 }));
      x += BOOKMARK_W + dp(4);
      c.add(heldText.setPosition(x, 0).setOrigin(0, 0.5));
    }
    if (holding) {
      fadeChip(c, 0.45);
      const t = theme();
      const dot = this.add.graphics().setName(CHIP_DOT);
      // Where the chip draws its own (UI.chip), ringed in the sky the same way.
      const dx = width / 2 - pt(5);
      const dy = -TOP_CHIP_H / 2 + pt(5);
      dot.fillStyle(t.paper, 1);
      dot.fillCircle(dx, dy, pt(5.5));
      dot.fillStyle(t.accent, 1);
      dot.fillCircle(dx, dy, pt(4));
      c.add(dot);
    } else if (shown <= 0 && !st.dot) {
      // Not while the dot is up: it is the one thing on the chip asking for a look.
      setContentAlpha(c, 0.45);
    }
    return c;
  }

  /** •••: Settings, as a round glass button the chips' height (the mock's `.round`). */
  private buildMore(L: MenuLayout): Phaser.GameObjects.Container {
    const more = button(this, MORE_X, TOP_BAR_Y, '', {
      width: MORE_D,
      height: MORE_D,
      variant: 'secondary',
      minTap: true,
      maxTap: L.tapMax.top,
      onPress: () => this.openSettings(),
    });
    more.add(icon(this, 0, 0, 'more', { size: dp(20), color: ui().text2 }));
    more.setName('more');
    return more;
  }

  /**
   * Today's three, as the strip under the top row: three rings and the gift,
   * one tap target that opens the Missions sheet (MissionsSheet.drawMissionStrip).
   */
  private buildMissionStrip(state: MissionState, L: MenuLayout): MissionStrip | null {
    if (!L.strip) return null;
    return drawMissionStrip(this, BASE_WIDTH / 2, L.strip.y, MENU_COLUMN, L.strip.h, state, Progress.data.adsRemoved, () => this.openMissions(), L.tapMax.strip);
  }

  /**
   * The strip folded into the top row (MenuLayout step 4), in the room
   * between the streak chip and the balance chip.
   */
  private buildMissionChip(state: MissionState, L: MenuLayout): Phaser.GameObjects.Container {
    const left = this.streakChip ? this.streakChip.x + chipWidth(this.streakChip) / 2 : STREAK_CHIP_LEFT - dp(8);
    const right = this.balanceChip ? this.balanceChip.x - chipWidth(this.balanceChip) / 2 : MORE_X - MORE_D / 2;
    return drawMissionChip(this, (left + right) / 2, TOP_BAR_Y, TOP_CHIP_H, state, () => this.openMissions(), L.tapMax.top);
  }

  /* ------------------------------------------------------------- the brand */

  /**
   * The stacked logo (Logo.ts) and the tagline, in the room MenuLayout gives
   * them: the mark and "foldwing", or the word alone once the mark has given
   * way, or nothing at all. Returns what enters with the page.
   */
  private buildBrand(L: MenuLayout, tagline: string): Phaser.GameObjects.Container | null {
    const b = L.brand;
    this.logo = null;
    this.brandWords = [];
    if (b.wordSize <= 0) return null;
    const cx = BASE_WIDTH / 2;
    const c = this.add.container(0, 0);
    if (b.markH > 0) {
      const lockup = logo(this, cx, L.brandTop, { markH: b.markH, wordSize: b.wordSize, gap: markGap(b) });
      c.add(lockup.container);
      this.logo = lockup;
      if (lockup.word) this.brandWords.push(lockup.word);
      // Drawn in once a day; until the stage opens it waits at its first frame (drawLogoIn).
      if (this.logoDue()) paintLogo(lockup, logoDrawAt(0));
    } else {
      const word = label(this, cx, L.brandTop + wordBox(b) / 2, 'foldwing', {
        size: b.wordSize,
        font: FONT.display,
        color: ui().text,
        letterSpacing: -Math.round(dp(0.3)),
      }).setOrigin(0.5);
      c.add(word);
      this.brandWords.push(word);
    }
    if (b.tagline) {
      const line = label(this, cx, L.taglineY, tagline, {
        size: dp(15),
        font: FONT.display,
        italic: true,
        color: ui().text2,
        letterSpacing: dp(0.2),
      }).setOrigin(0.5);
      c.add(line);
      this.brandWords.push(line);
    }
    return c;
  }

  /** The logo has not been drawn in today, and can be (motion allowed, a mark to draw). */
  private logoDue(): boolean {
    if (!this.logo || motionReduced()) return false;
    try {
      return window.localStorage.getItem(LOGO_DAY_KEY) !== todayISO();
    } catch {
      // No storage: a per-viewer nicety only, so the mark simply stands settled.
      return false;
    }
  }

  /**
   * Once a day, the mark draws itself in when the page opens: the dot lands and
   * the line leaves it, its reflection in the same frame (SPEC §2.5.2: the
   * mirror never lags). Any tap settles it — nothing waits for an animation.
   * Stamped when it starts, as the film is: a draw-in cut short was still seen.
   */
  private drawLogoIn(): void {
    const lockup = this.logo;
    if (!lockup || !this.logoDue()) return;
    try {
      window.localStorage.setItem(LOGO_DAY_KEY, todayISO());
    } catch {
      /* it draws in again next time, which is harmless */
    }
    if (!paintLogo(lockup, logoDrawAt(0))) {
      lockup.drawIn();
      return;
    }
    const clock = { at: 0 };
    const tween = this.tweens.add({
      targets: clock,
      at: DRAW_IN.line[1],
      duration: ms(DRAW_IN.line[1]),
      ease: 'Linear',
      onUpdate: () => {
        if (lockup.container.scene) paintLogo(lockup, logoDrawAt(clock.at));
      },
      onComplete: () => {
        if (lockup.container.scene) paintLogo(lockup, SETTLED);
      },
    });
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => {
      if (!tween.isPlaying()) return;
      tween.stop();
      if (lockup.container.scene) paintLogo(lockup, SETTLED);
    });
  }

  /* ------------------------------------------------------ the Continue card */

  /**
   * What the last build of the menu showed — the Continue level, its beads,
   * the missions' progress — for this one to move on from (the return beats),
   * and this build's, recorded for the next.
   */
  private takeShown(model: ContinueModel, missions: MissionState | null): Shown | null {
    const raw = this.registry.get(MENU_SHOWN) as Partial<Shown> | undefined;
    this.registry.set(MENU_SHOWN, {
      index: model.index,
      beads: model.beads,
      date: missions?.date ?? '',
      progress: missions ? [...missions.progress] : [],
    } satisfies Shown);
    if (!raw || typeof raw !== 'object') return null;
    const index = Number(raw.index);
    if (!Number.isInteger(index) || index < 0 || index >= LEVELS.length) return null;
    return {
      index,
      beads: Array.isArray(raw.beads) && raw.beads.length === model.beads.length ? (raw.beads as Bead[]) : model.beads,
      date: typeof raw.date === 'string' ? raw.date : '',
      progress: Array.isArray(raw.progress) ? raw.progress.map(Number) : [],
    };
  }

  /**
   * The hero (SPEC §5.1, the mock's `.hero`): the next maze, its chapter as
   * twenty beads, the stars it holds or has to earn, and Continue across the
   * foot. The whole card is the door — a tap anywhere on it is Continue's.
   */
  private buildContinueCard(L: MenuLayout, m: ContinueModel, shown: Shown | null): Phaser.GameObjects.Container {
    const t = theme();
    const u = ui();
    const w = MENU_COLUMN;
    const h = L.continue.h;
    const C = continueCardLayout(w, h, L.compact);
    const go = (): void => {
      if (this.allCleared) {
        Haptics.tap();
        this.scene.start('LevelSelect');
        return;
      }
      this.open(m.index);
    };
    const card = button(this, BASE_WIDTH / 2, L.continue.y, '', {
      width: w,
      height: h,
      variant: 'ghost',
      minTap: true,
      maxTap: h,
      onPress: go,
    });
    card.setName('continue-card');
    card.addAt(panel(this, 'continue-hero', 0, 0, w, h, { ...LOOKS.glassHero(), radius: dp(28) }), 0);
    const x0 = -w / 2;
    const y0 = -h / 2;

    // The maze itself, and — on a return from a win — the one before it, to crossfade from.
    const tx = x0 + C.thumb.x + C.thumb.w / 2;
    const ty = y0 + C.thumb.y + C.thumb.h / 2;
    const thumb = mazeThumb(this, tx, ty, LEVELS[m.index], C.thumb.w, C.thumb.h);
    card.add(thumb);
    const moved = shown !== null && shown.index !== m.index;
    if (moved && shown) {
      const was = mazeThumb(this, tx, ty, LEVELS[shown.index], C.thumb.w, C.thumb.h);
      card.add(was);
      thumb.setAlpha(0);
      this.returning = { thumbFrom: was, thumbTo: thumb, beadsFrom: null, beadsTo: null };
    } else {
      this.returning = null;
    }

    const infoL = x0 + C.infoX;
    const fitTo = (text: Phaser.GameObjects.Text, max: number): Phaser.GameObjects.Text => {
      if (text.width > max) text.setScale(max / text.width);
      return text;
    };
    card.add(
      fitTo(
        label(this, infoL, y0 + C.capsY, m.caps, { size: dp(10), weight: 600, caps: true, letterSpacing: dp(1.5), color: u.text3 }).setOrigin(0, 0.5),
        C.infoW
      )
    );
    // "48 First span": the number in the caption colour, a size down, on the name's baseline.
    const num = label(this, infoL, y0 + C.titleY, m.number, { size: dp(17), font: FONT.display, color: u.text3 }).setOrigin(0, 0.5);
    const name = label(this, infoL + num.width + dp(6), y0 + C.titleY, m.name, { size: dp(25), font: FONT.display, color: u.text }).setOrigin(0, 0.5);
    num.setY(y0 + C.titleY + (name.height - num.height) * 0.28);
    fitTo(name, C.infoW - num.width - dp(6));
    card.add([num, name]);

    // The chapter's twenty beads, baked; the current one breathes.
    const beadsY = y0 + C.beadsY;
    // The bake carries room for the current bead's glow round it: set back by that.
    const beadsX = infoL - BEAD_PAD / BEAD_RES;
    const beads = this.add.image(beadsX, beadsY, beadsTexture(this, m.beads, C.infoW)).setOrigin(0, 0.5).setScale(1 / BEAD_RES);
    card.add(beads);
    if (moved && shown && this.returning) {
      const was = this.add.image(beadsX, beadsY, beadsTexture(this, shown.beads, C.infoW)).setOrigin(0, 0.5).setScale(1 / BEAD_RES);
      card.add(was);
      beads.setAlpha(0);
      this.returning.beadsFrom = was;
      this.returning.beadsTo = beads;
    }
    const at = m.beads.indexOf('current');
    if (at >= 0) {
      const { pitch, width } = beadPitch(C.infoW);
      const glow = softDisc(this, infoL + at * pitch + width / 2, beadsY, dp(9), t.accent, 0.55);
      card.add(glow);
      this.currentGlow = glow;
      // The one living thing on the page (SPEC §2.5.4); held still under reduced
      // motion. Back from a win it waits for the beads to advance (playReturn).
      if (moved) glow.setAlpha(0);
      else this.breath = breathe(this, glow);
    }

    // "7 of 20 · ★ 17/60" on the left, "👁 +1 at 10" in ember on the right.
    const metaY = y0 + C.metaY;
    const parts = [
      label(this, 0, metaY, `${m.count} · `, { size: dp(12), weight: 500, color: u.text2 }),
      icon(this, 0, metaY, 'star', { size: dp(13), color: t.medal }),
      label(this, 0, metaY, ` ${m.stars.split('/')[0]}`, { size: dp(12), weight: 600, color: t.medalText }),
      label(this, 0, metaY, `/${m.stars.split('/')[1]}`, { size: dp(12), weight: 500, color: u.text2 }),
    ];
    let mx = infoL;
    for (const part of parts) {
      if (part instanceof Phaser.GameObjects.Text) part.setOrigin(0, 0.5).setX(mx);
      else part.setX(mx + dp(13) / 2);
      mx += part instanceof Phaser.GameObjects.Text ? part.width : dp(13);
    }
    card.add(parts);
    if (m.mark) {
      const mark = label(this, x0 + w - C.pad, metaY, m.mark, { size: dp(12), weight: 600, color: t.accentText }).setOrigin(1, 0.5);
      card.add([mark, icon(this, mark.x - mark.width - dp(4) - dp(7), metaY, 'eye', { size: dp(14), color: t.accentText })]);
    }

    // The stars this fold holds, and what the next takes — "☆☆☆ 3 to earn".
    if (C.pillY !== null) {
      const py = y0 + C.pillY;
      const star = dp(13);
      const text = label(this, 0, py, m.pill.text, { size: dp(11), weight: 600, color: t.medalText }).setOrigin(0, 0.5);
      const pw = Math.ceil(dp(7) + 3 * star + 2 * dp(2) + dp(6) + text.width + dp(9));
      card.add(
        panel(this, 'continue-pill', infoL + pw / 2, py, pw, PILL_H, {
          radius: PILL_H / 2,
          face: { kind: 'none' },
          outline: { color: t.medal, alpha: 0.45, width: dp(1.2) },
        })
      );
      for (let i = 0; i < 3; i++) {
        const name: IconName = i < m.pill.earned ? 'star' : 'starOutline';
        card.add(icon(this, infoL + dp(7) + star / 2 + i * (star + dp(2)), py, name, { size: star, color: t.medal }));
      }
      text.setX(infoL + dp(7) + 3 * star + 2 * dp(2) + dp(6));
      card.add(text);
    }

    // Continue: the primary, the start dot as its glyph. Its own press dips just the button.
    const cta = button(this, 0, y0 + C.ctaY, m.cta, {
      width: C.ctaW,
      height: C.ctaH,
      variant: 'primary',
      size: TYPE.button,
      minTap: true,
      maxTap: C.ctaH + 2 * (C.pad - 1),
      onPress: go,
    });
    const caption = cta.getByName('button-label');
    if (caption instanceof Phaser.GameObjects.Text) {
      const d = dp(12);
      const inner = d + dp(10) + caption.width;
      caption.setX(-inner / 2 + d + dp(10) + caption.width / 2);
      cta.add(this.add.image(-inner / 2 + d / 2, 0, startDotTexture(this, d)).setScale(1 / BEAD_RES));
    }
    card.add(cta);
    return card;
  }

  /**
   * The return beats (SPEC §5.1): back from a win, the thumbnail crossfades to
   * the next maze (300 ms), the beads advance, the mission rings fill (500 ms).
   * From what the last build showed; nothing moves on a first build or when
   * nothing changed. Under reduced motion each is a short crossfade (ms()).
   */
  private playReturn(shown: Shown | null): void {
    const r = this.returning;
    if (r) {
      const fade = (from: Phaser.GameObjects.Image | null, to: Phaser.GameObjects.Image | null): void => {
        if (!from || !to || !to.scene) return;
        this.tweens.add({ targets: to, alpha: 1, duration: ms(300), ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: from, alpha: 0, duration: ms(300), ease: 'Sine.easeInOut', onComplete: () => from.destroy() });
      };
      fade(r.thumbFrom, r.thumbTo);
      fade(r.beadsFrom, r.beadsTo);
      const glow = this.currentGlow;
      if (glow?.scene && !this.breath) {
        this.tweens.add({
          targets: glow,
          alpha: MOTION.breathe.alphaFrom,
          delay: ms(300),
          duration: ms(200),
          onComplete: () => {
            if (glow.scene) this.breath = breathe(this, glow);
          },
        });
      }
      this.returning = null;
    }
    const missions = Progress.missionsToday();
    if (shown && this.strip && missions && shown.date === missions.date) this.strip.fillFrom(shown.progress);
  }

  /* ---------------------------------------------------------------- tiles */

  /**
   * Levels | Gallery | Store (the mock's `.tiles`): places the player browses,
   * each a pen-line mark, a name and what is behind it. Levels | Gallery in
   * the first session, which the store has nothing to say to yet, and for an
   * owner, to whom it has nothing left to sell.
   *
   * A tangerine dot marks only something genuinely new — a figure drawn since
   * the Gallery was last opened from here — and never a sale (SPEC §5.1): the
   * 1.4 Store button's NEW badge for the starter pack is gone.
   */
  private buildTiles(L: MenuLayout, owner: boolean): Phaser.GameObjects.Container {
    const u = ui();
    const t = theme();
    const save = Progress.data;
    const selling = Iap.available && !owner && !this.firstSession;
    const cleared = new Set(save.cleared);
    const folded = LEVELS.filter((l) => cleared.has(l.id)).length;
    const figures = Progress.figures;
    const newest = figures.length > 0 ? figures[0].at : 0;
    const tiles: { icon: IconName; title: string; sub: string; dot: boolean; press: () => void }[] = [
      {
        icon: 'levels',
        title: 'Levels',
        sub: `${folded} of ${LEVELS.length}`,
        dot: false,
        press: () => {
          Haptics.tap();
          this.scene.start('LevelSelect');
        },
      },
      {
        icon: 'gallery',
        title: 'Gallery',
        sub: figures.length > 0 ? plural(figures.length, 'figure', 'figures') : 'your figures',
        dot: galleryHasNew(newest),
        press: () => {
          Haptics.tap();
          markGallerySeen(newest);
          this.scene.start('Gallery');
        },
      },
    ];
    if (selling) tiles.push({ icon: 'store', title: 'Store', sub: 'Reveals & more', dot: false, press: () => this.openStore() });

    const row = this.add.container(0, 0);
    const gap = dp(10);
    const tw = (MENU_COLUMN - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((tile, i) => {
      const x = EDGE + tw / 2 + i * (tw + gap);
      const b = button(this, x, L.tiles.y, '', {
        width: tw,
        height: L.tiles.h,
        variant: 'secondary',
        minTap: true,
        maxTap: L.tapMax.tiles,
        onPress: tile.press,
      });
      b.setName(`tile-${tile.icon}`);
      const left = -tw / 2 + dp(14);
      const glyph = dp(20);
      b.add(icon(this, left + glyph / 2, -dp(9), tile.icon, { size: glyph, color: t.accentText }));
      const title = label(this, left + glyph + dp(7), -dp(9), tile.title, { size: dp(15), weight: 600, color: u.text }).setOrigin(0, 0.5);
      const sub = label(this, left, dp(12), tile.sub, { size: dp(11.5), weight: 500, color: u.text3 }).setOrigin(0, 0.5);
      const room = tw - dp(28);
      for (const text of [sub]) if (text.width > room) text.setScale(room / text.width);
      if (title.x + title.width > tw / 2 - dp(10)) title.setScale((tw / 2 - dp(10) - title.x) / title.width);
      b.add([title, sub]);
      if (tile.dot) {
        b.add(
          panel(this, 'tile-dot', tw / 2 - dp(16), -L.tiles.h / 2 + dp(16), dp(8), dp(8), {
            radius: dp(4),
            face: { kind: 'solid', color: t.accent },
            glow: { color: t.accent, alpha: 0.5, blur: dp(6) },
          })
        );
      }
      row.add(b);
    });
    return row;
  }

  /* ----------------------------------------------------------- the Daily */

  private buildDailyCard(): Phaser.GameObjects.Container {
    const L = this.layout;
    const st = dailyCardState(Progress.data, todayISO(), new Date(), Progress.dailyUnlocked());
    const y = L ? L.daily.y : viewHeight() / 2;
    return drawDailyCard(this, BASE_WIDTH / 2, y, st, () => this.pressDaily(), {
      width: MENU_COLUMN,
      height: DAILY_H,
      maxTap: DAILY_H,
    });
  }

  /** A repair changed what the card says: redrawn in place, without the page's entrance. */
  private rebuildDailyCard(): void {
    if (!this.dailyCard) return;
    this.dailyCard.destroy(true);
    this.dailyCard = this.buildDailyCard();
  }

  private pressDaily(): void {
    if (this.sheet) return;
    // Re-derived at the tap, never captured: a phone left on this screen
    // overnight would otherwise open yesterday's fold.
    const today = todayISO();
    const st = dailyCardState(Progress.data, today, new Date(), Progress.dailyUnlocked());
    if (st.kind === 'locked') {
      Haptics.warn();
      this.say(`finish the tutorial first · ${foldsToGo(tutorialFoldsToGo(Progress.data))}`, {
        icon: lockGlyph,
        urgent: true,
      });
      return;
    }
    // The sheet leads with today's fold and offers the repair under it.
    if (st.kind === 'repairable') {
      this.openStreak();
      return;
    }
    Haptics.tap();
    this.scene.start('Game', { daily: today });
  }

  /* -------------------------------------------------------------- sheets */

  /**
   * Take the sheet down. Next frame — this runs inside the tap that closed it —
   * the menu catches up with whatever it was holding off for: a new day,
   * Remove Ads approved while the sheet was up, a reminder tapped while it was
   * up, the store's answer, a resize.
   *
   * The reminder is taken now, by the rebuild's create(), while the player
   * still remembers tapping it; left for "the next build", it waited for any
   * later return to the menu and sent the player into the Daily unasked.
   */
  private closeSheet(): void {
    this.sheet?.destroy(true);
    this.sheet = null;
    this.time.delayedCall(0, () => {
      if (!this.scene.isActive() || this.sheet) return;
      // What was said while the sheet was up, now that the page is the page.
      const held = this.heldToasts.splice(0);
      for (const h of held) this.say(h.text, h.opts);
      if (this.rolloverPending && todayISO() !== this.builtFor) {
        this.rolloverRestart();
        return;
      }
      const routed = this.registry.get(PENDING_ROUTE) !== undefined && !Ads.busy;
      if (routed || this.registry.get(MENU_CELEBRATE) !== undefined) {
        this.restartMenu();
        return;
      }
      this.refreshStoreState();
      if (!this.playing && this.moments.length === 0) this.reconcile();
      this.refit();
    });
  }

  /**
   * The store, opened from the menu. The same card the out-of-reveals moment
   * opens (StoreSheet), so the two cannot drift; only the title differs —
   * nothing has gone wrong here, the player came looking.
   */
  private openStore(): void {
    if (this.sheet || Ads.busy) return;
    Haptics.tap();
    const sheet = showStoreSheet(this, {
      title: 'Store',
      kind: 'store',
      hooks: this.storeHooks(),
      onClose: () => this.closeSheet(),
      stillOpen: (s) => this.sheet === s,
    });
    if (!sheet) {
      this.say('one free reveal lands each day', { icon: eyeGlyph, urgent: true });
      return;
    }
    this.sheet = sheet.setDepth(STORE_DEPTH);
    this.liftToast();
  }

  private storeHooks(): StoreHooks {
    return {
      onChange: (notice, landed) => this.storeLanded(notice, landed),
      // A cancel, a refusal, a purchase waiting: each answers the player's own tap.
      onNotice: (m, tone) => this.say(m, { tone: tone ?? 'plain', urgent: true }),
      // A rewarded ad that finishes loading after the player left the menu
      // must not land on the level they went to.
      stillWanted: () => this.scene.isActive(),
    };
  }

  /**
   * Something the store sold, or an ad paid, landed. The haptic and the sound
   * have played (StoreSheet). Reveals fly into the live chip; Remove Ads — or a
   * restore — is `celebrateOwnership`, at once: the purchase was made on the
   * sheet it takes down, and the sheet ends with it.
   */
  private storeLanded(notice?: string, landed?: StoreLanded): void {
    if (!this.scene.isActive()) return;
    if (landed?.kind === 'removeAds') {
      const kind = landed.reason === 'restore' ? 'restore' : 'removeAds';
      this.celebrateOwnership({ kind, n: this.shownReveals, text: notice }, true);
      return;
    }
    if (landed && landed.reveals > 0) {
      this.enqueue({
        text: notice ?? `+${plural(landed.reveals, 'reveal', 'reveals')} · you have ${YOU_HAVE}`,
        tone: 'reward',
        icon: 'eye',
        reveals: landed.reveals,
        fly: { to: 'balance', glyph: 'eye', count: landed.reveals, from: sheetFrom() },
      });
      return;
    }
    if (notice) this.say(notice, { tone: 'reward', icon: eyeGlyph });
  }

  /**
   * The chip's "+", once the store has answered or sold something. (The Store
   * tile no longer wears a NEW badge for the starter: a badge never advertises
   * a sale, SPEC §5.1.)
   */
  private refreshStoreState(): void {
    if (!this.scene.isActive()) return;
    const plus = !Progress.data.adsRemoved && storeSells();
    if (this.balanceChip && plus !== this.balancePlus && !this.playing) {
      this.balanceChip.destroy();
      this.balanceChip = this.buildBalanceChip(this.shownReveals);
    }
  }

  private openStreak(): void {
    if (this.sheet || Ads.busy) return;
    Haptics.tap();
    this.sheet = showStreakSheet(this, {
      permission: () => this.permission,
      remindable: Nudges.available,
      onRepaired: (r) => this.streakRepaired(r),
      // The mission row's path: the player picked where to go.
      onPlay: () => this.routeMission('daily'),
      onRemind: () => this.askReminders(),
      onNotice: (text, tone) => this.say(text, { tone, urgent: true }),
      onClose: () => this.closeSheet(),
      stillOpen: (s) => this.sheet === s,
    });
    this.liftToast();
  }

  /**
   * A missed day kept: the flame counts back up, the dot goes, the Daily card
   * stops asking. A milestone the restored run reached is said as the win card
   * would say it, and its reveals fly into the chip.
   */
  private streakRepaired(r: StreakRepaired): void {
    if (!this.scene.isActive()) return;
    const owner = Progress.data.adsRemoved;
    this.registry.set(MENU_STREAK_SHOWN, r.after);
    if (this.streakChip) {
      // From the run the chip held, faint — not from the 0 the gap left.
      const from = Math.min(this.streakChipRun ?? r.before, r.after);
      this.streakChip.destroy();
      this.streakChip = this.buildStreakChip(from);
      fadeChip(this.streakChip, 1);
      countUp(this, this.streakChip, from, r.after, countText, 700);
      pulse(this, this.streakChip);
    }
    this.shownStreak = r.after;
    for (const m of r.milestones) {
      this.enqueue({
        text: milestoneLine(m, owner),
        tone: 'reward',
        icon: 'flame',
        reveals: owner ? 0 : m.reveals,
        fly: !owner && m.reveals > 0 ? { to: 'balance', glyph: 'eye', count: m.reveals, from: TOAST_FROM } : undefined,
      });
    }
    this.rebuildDailyCard();
  }

  private openMissions(): void {
    if (this.sheet || Ads.busy) return;
    const state = Progress.missionsToday();
    if (!state) return;
    Haptics.tap();
    this.sheet = showMissionsSheet(this, {
      state,
      owner: Progress.data.adsRemoved,
      onRoute: (route) => this.routeMission(route),
      onClose: () => this.closeSheet(),
      stillOpen: (s) => this.sheet === s,
    });
    this.liftToast();
  }

  /**
   * An unfinished mission, tapped: where it is done. A reminder tapped while
   * the sheet was up is answered by this choice — the player picked where to
   * go — so it is not taken later, on some return to the menu.
   */
  private routeMission(route: MissionRoute): void {
    this.sheet?.destroy(true);
    this.sheet = null;
    this.registry.remove(PENDING_ROUTE);
    Haptics.tap();
    if (route === 'daily') {
      this.scene.start('Game', { daily: todayISO() });
    } else if (route === 'levels' || this.allCleared) {
      // Levels opens on the frontier's chapter.
      this.scene.start('LevelSelect');
    } else {
      this.scene.start('Game', { levelIndex: this.nextIndex });
    }
  }

  /**
   * Ask for reminders — only ever because the player tapped something that
   * asked for them (Nudges.request is the one path to the system alert) — and
   * say how it went, with the time they will land.
   */
  private async askReminders(): Promise<void> {
    Haptics.tap();
    Progress.setReminders(true);
    const granted = await Nudges.request();
    this.permission = await Nudges.permission();
    if (granted) void Nudges.rebuild();
    if (!this.scene.isActive()) return;
    if (granted) this.say(`Reminders on · around ${Nudges.reminderTimeLabel()}`, { tone: 'reward', urgent: true });
    else this.say('No reminders · change it in Settings anytime', { urgent: true });
  }

  /* ------------------------------------------------------------ settings */

  /**
   * Sound, music, haptics, reduced motion, reminders — then Game Center, the
   * rating and Restore, and Privacy choices where there is an SDK to consent
   * to. The footer says which version this is; five taps on it add what the
   * device can encode (the old "replay v1 a1 m1" line, which read as noise to
   * players and is now only there for a tester who knows to look).
   *
   * On the sheet recipe the Store, Streak and Missions cards share (QA round
   * 1): the title in the display face on the left, a card pt(300) wide where
   * every row fits in it, and a ghost [Close] at the foot — the scrim was the
   * only way out.
   */
  private openSettings(): void {
    if (this.sheet) return;
    Haptics.tap();

    const cx = BASE_WIDTH / 2;

    type Row =
      | { kind: 'toggle'; name: string; key: ToggleKey; apply: (v: boolean) => void }
      | { kind: 'reminders' }
      | { kind: 'pair'; left: [string, (b: Phaser.GameObjects.Container) => void]; right: [string, (b: Phaser.GameObjects.Container) => void] | null };
    const rows: Row[] = [
      // Sound and Music are separate switches on purpose — see SaveData.music.
      { kind: 'toggle', name: 'Sound', key: 'sound', apply: (v) => Audio.setEnabled(v) },
      { kind: 'toggle', name: 'Music', key: 'music', apply: (v) => Music.setEnabled(v) },
      { kind: 'toggle', name: 'Haptics', key: 'haptics', apply: (v) => Haptics.setEnabled(v) },
      { kind: 'toggle', name: 'Reduced motion', key: 'reducedMotion', apply: (v) => setMotionScale(v) },
    ];
    // Where a reminder can be delivered at all: a phone (or the DEV stand-in).
    if (Nudges.available) rows.push({ kind: 'reminders' });
    /*
     * Game Center, BOTH of its screens: the leaderboard used to be reachable
     * only from the Daily's win screen, and the eight achievements had no door
     * in the app at all. Hidden where GameKit does not exist rather than shown
     * dead. The answer goes ON the button pressed: the menu behind is covered.
     */
    if (GameCenter.available) {
      rows.push({
        kind: 'pair',
        left: [
          'Leaderboard',
          (b) =>
            void GameCenter.show().then((shown) => {
              if (!shown) this.sayOnButton(b, 'Leaderboard', 'not signed in');
            }),
        ],
        right: [
          'Achievements',
          (b) =>
            void GameCenter.showAchievements().then((shown) => {
              if (!shown) this.sayOnButton(b, 'Achievements', 'not signed in');
            }),
        ],
      });
    }
    /*
     * "Rate Foldwing" opens the App Store review page rather than the OS
     * prompt (Rate.openStoreListing): a deliberate tap has to do something
     * visible. Restore beside it, where there is a store to restore from —
     * it left the menu with the selling foot, and the store's footer has it too.
     */
    rows.push({
      kind: 'pair',
      left: ['Rate Foldwing', () => void Rate.openStoreListing()],
      right: Iap.available ? ['Restore purchases', () => void this.restore()] : null,
    });
    /*
     * "Privacy choices" — the way back from the ad-consent answer. Withdrawal
     * has to be as reachable as the consent was, and the consent modal's own
     * copy sends people here by name. Only where there is an SDK to consent to.
     */
    const privacy = Ads.privacyChoicesAvailable;
    const count = rows.length + (privacy ? 1 : 0);

    /*
     * The card's width: pt(300) where every row's widest need fits in it —
     * measured, because a long font fallback or a longer reminder time must
     * not run a switch off the card — else the column, as before.
     */
    const probe = label(this, 0, 0, '', { size: TYPE.body });
    const width = (s: string, size: number): number => probe.setFontSize(size).setText(s).width;
    const switchNeed = pt(16) + width('off', TYPE.body) + pt(8) + pt(30) + SETTINGS_PAD * 2;
    const captionNeed = (s: string): number => width(s, TYPE.label) + pt(24);
    const needs = rows.map((row) => {
      if (row.kind === 'toggle') return width(row.name, TYPE.body) + switchNeed;
      if (row.kind === 'reminders') {
        const subs = [this.reminderSub('granted'), this.reminderSub('denied')];
        return Math.max(width('Reminders', TYPE.body), ...subs.map((s) => width(s, TYPE.micro))) + switchNeed;
      }
      const halves = [row.left[0], ...(row.right ? [row.right[0]] : [])].map(captionNeed);
      return row.right ? Math.max(...halves) * 2 + pt(10) + pt(40) : halves[0] + pt(40);
    });
    if (privacy) needs.push(captionNeed('Privacy choices') + pt(40));
    probe.destroy();
    const w = settingsWidth(needs, COLUMN);

    /*
     * Row height: pt(46), or the thumb's floor and a pixel where the canvas is
     * drawn small enough for that to be more — and never so tall the card
     * leaves the band above the banner. Below a scale of about 0.42 that caps
     * the rows under 44pt, as on every sheet; a row under the ad would be worse.
     */
    const floor = minTap(this);
    const bottomLimit = sheetBottomLimit();
    const room = bottomLimit - SHEET_TOP_LIMIT - SETTINGS_HEAD - SETTINGS_FOOT;
    const rowH = Math.min(Math.max(pt(46), floor + 1), Math.floor(room / count));
    const tapCap = rowH - 1;
    const h = SETTINGS_HEAD + rowH * count + SETTINGS_FOOT;
    const band = bottomLimit - SHEET_TOP_LIMIT;
    const cy = SHEET_TOP_LIMIT + Math.max(0, (band - h) / 2) + h / 2;

    // Centred in the band, and kept there if the world's height changes (keepCentred).
    const sheet = keepCentred(this.add.container(cx, cy).setDepth(60));
    this.sheet = sheet;
    // The night's scrim (UI.scrim), never the cream foreground, which fogged the page grey.
    const back = scrim(this, 0, 0);
    // A tap outside, never the tail of the tap that opened it, and never a
    // press that began on a control — see `dismissOnScrim`.
    dismissOnScrim(back, () => {
      shieldInput(this);
      this.closeSheet();
    });
    // The card itself is not "outside": a missed toggle must not lose the sheet.
    sheet.add([back, sheetPanel(this, 0, 0, w, h, RADIUS.lg), cardBlocker(this, 0, 0, w, h)]);
    sheet.add(
      label(this, -w / 2 + SETTINGS_PAD, -h / 2 + SETTINGS_TITLE_Y, 'Settings', {
        size: TYPE.heading,
        font: FONT.display,
        color: ui().text,
      }).setOrigin(0, 0.5)
    );

    const rowY = (i: number): number => -h / 2 + SETTINGS_HEAD + rowH * i + rowH / 2;
    const small = {
      height: pt(38),
      minTap: true,
      maxTap: tapCap,
      variant: 'secondary' as const,
      size: TYPE.label,
    };
    rows.forEach((row, i) => {
      const y = rowY(i);
      if (row.kind === 'toggle') {
        const on = (): boolean => Progress.data[row.key] === true;
        sheet.add(
          this.toggleRow(y, w, rowH, row.name, null, on, (repaint) => {
            const next = !on();
            Progress.update({ [row.key]: next } as Partial<SaveData>);
            row.apply(next);
            // After the apply: turning Haptics off must not buzz on the way out.
            Haptics.select();
            repaint();
          })
        );
      } else if (row.kind === 'reminders') {
        sheet.add(
          this.toggleRow(
            y,
            w,
            rowH,
            'Reminders',
            () => this.reminderSub(this.permission),
            () => Progress.data.reminders && this.permission === 'granted',
            (repaint) => void this.toggleReminders(repaint)
          )
        );
      } else {
        const gap = pt(10);
        const inner = w - pt(40);
        if (row.right) {
          const halfW = (inner - gap) / 2;
          const left: Phaser.GameObjects.Container = button(this, -(halfW + gap) / 2, y, row.left[0], {
            ...small,
            width: halfW,
            onPress: () => {
              Haptics.tap();
              row.left[1](left);
            },
          });
          const [text, press] = row.right;
          const right: Phaser.GameObjects.Container = button(this, (halfW + gap) / 2, y, text, {
            ...small,
            width: halfW,
            onPress: () => {
              Haptics.tap();
              press(right);
            },
          });
          sheet.add([left, right]);
        } else {
          const only: Phaser.GameObjects.Container = button(this, 0, y, row.left[0], {
            ...small,
            width: inner,
            onPress: () => {
              Haptics.tap();
              row.left[1](only);
            },
          });
          sheet.add(only);
        }
      }
    });
    if (privacy) {
      sheet.add(
        button(this, 0, rowY(rows.length), 'Privacy choices', {
          ...small,
          width: w - pt(40),
          onPress: () => {
            Haptics.tap();
            void Ads.openPrivacyOptions();
          },
        })
      );
    }

    // The footer: which build this is, and on the fifth tap what it can encode.
    const rowsEnd = -h / 2 + SETTINGS_HEAD + rowH * count;
    const version = BUILD_NUMBER ? `Foldwing ${APP_VERSION} (${BUILD_NUMBER})` : `Foldwing ${APP_VERSION}`;
    const footY = rowsEnd + SETTINGS_VERSION_Y;
    const foot = label(this, 0, footY, version, { size: TYPE.micro, color: ui().text3 }).setOrigin(0.5);
    const zone = this.add.zone(0, footY, pt(220), SETTINGS_VERSION_H).setInteractive();
    let taps = 0;
    let last = 0;
    zone.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      const now = performance.now();
      taps = now - last < 1500 ? taps + 1 : 1;
      last = now;
      const cap = Progress.data.capability;
      if (taps >= 5 && cap) foot.setText(`${version} · replay ${cap}`);
    });
    sheet.add([zone, foot]);

    // [Close]: its tap area stops a point short of the version line above and
    // of the card's edge below, so the hidden five taps never close the sheet.
    const above = SETTINGS_CLOSE_Y - SETTINGS_CLOSE_H / 2 - (SETTINGS_VERSION_Y + SETTINGS_VERSION_H / 2);
    const below = SETTINGS_FOOT - SETTINGS_CLOSE_Y - SETTINGS_CLOSE_H / 2;
    sheet.add(
      button(this, 0, rowsEnd + SETTINGS_CLOSE_Y, 'Close', {
        width: pt(140),
        height: SETTINGS_CLOSE_H,
        variant: 'ghost',
        size: TYPE.label,
        minTap: true,
        maxTap: SETTINGS_CLOSE_H + 2 * Math.min(above, below) - pt(1),
        onPress: () => {
          shieldInput(this);
          this.closeSheet();
        },
      })
    );
    this.liftToast();
  }

  /** The Reminders row's second line, for the permission iOS has on record. */
  private reminderSub(permission: NudgePermission | null): string {
    return permission === 'denied' ? 'off in iOS Settings' : `Daily fold · around ${Nudges.reminderTimeLabel()}`;
  }

  /**
   * A switch row. Built on a ghost button, so it answers the way every other
   * control does — on release, within TAP_SLOP, never on the press — with the
   * row lit while it is held. `onToggle` gets the repaint to call.
   */
  private toggleRow(
    y: number,
    w: number,
    h: number,
    name: string,
    sub: (() => string) | null,
    isOn: () => boolean,
    onToggle: (repaint: () => void) => void
  ): Phaser.GameObjects.Container {
    const t = theme();
    const u = ui();
    const pad = pt(18);
    let repaint = (): void => {};
    const row = button(this, 0, y, '', {
      width: w,
      height: h,
      variant: 'ghost',
      minTap: true,
      maxTap: h,
      onPress: () => onToggle(repaint),
    });
    const nameY = sub ? -pt(7) : 0;
    const title = label(this, -w / 2 + pad, nameY, name, { size: TYPE.body, weight: 500, color: u.text }).setOrigin(0, 0.5);
    const subText = sub
      ? label(this, -w / 2 + pad, pt(10), '', { size: TYPE.micro, color: u.text2 }).setOrigin(0, 0.5)
      : null;

    /*
     * On and off told apart by a switch and a colour, not by how faint the
     * word is: "on" takes the ember, the track fills tangerine, and the switch
     * reads without reading. A live Graphics: it changes on every tap.
     */
    const swW = pt(30);
    const swH = pt(18);
    const swX = w / 2 - pad - swW;
    const sw = this.add.graphics();
    const state = label(this, swX - pt(8), 0, '', { size: TYPE.body, weight: 500 }).setOrigin(1, 0.5);
    repaint = (): void => {
      if (!sw.scene) return;
      const on = isOn();
      state.setText(on ? 'on' : 'off').setColor(rgba(on ? t.accentText : u.text2, 1));
      subText?.setText(sub ? sub() : '');
      sw.clear();
      sw.fillStyle(on ? t.accent : u.text, on ? 1 : 0.14);
      roundRect(sw, swX, -swH / 2, swW, swH, RADIUS.pill);
      sw.fillStyle(on ? u.onAccent : u.text, on ? 1 : 0.85);
      sw.fillCircle(on ? swX + swW - swH / 2 : swX + swH / 2, 0, swH / 2 - pt(2));
    };
    repaint();

    // A hairline between rows, not around them.
    const line = this.add.rectangle(0, h / 2 - 1, w - pad * 2, 1, u.text, u.hairAlpha).setOrigin(0.5, 0);
    row.add([title, ...(subText ? [subText] : []), state, sw, line]);

    // The permission is read when the menu is built; a sheet opened before it
    // came back fills in once it has.
    if (sub && this.permission === null && Nudges.available) {
      void Nudges.permission().then((p) => {
        this.permission = p;
        repaint();
      });
    }
    return row;
  }

  /**
   * The Reminders switch. Off: the reminders are cleared (the permission is
   * the player's, and stays). On: scheduled if iOS already allows it; asked
   * for if it never has; and if it was refused, the player is told where the
   * answer can be changed — the game cannot ask twice.
   */
  private async toggleReminders(repaint: () => void): Promise<void> {
    if (this.busy) return;
    Haptics.select();
    if (Progress.data.reminders && this.permission === 'granted') {
      Progress.setReminders(false);
      void Nudges.clear();
      repaint();
      return;
    }
    this.busy = true;
    try {
      const perm = await Nudges.permission();
      this.permission = perm;
      if (perm === 'denied') {
        this.say('Allow notifications for Foldwing in iOS Settings', { tone: 'warn', urgent: true });
        return;
      }
      if (perm === 'granted') {
        Progress.setReminders(true);
        void Nudges.rebuild();
        this.say(`Reminders on · around ${Nudges.reminderTimeLabel()}`, { tone: 'reward', urgent: true });
        return;
      }
      await this.askReminders();
    } finally {
      this.busy = false;
      repaint();
    }
  }

  /** Restore, from Settings: the same words as the store's footer (StoreSheet.restorePurchases). */
  private async restore(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await restorePurchases(this.storeHooks());
    } finally {
      this.busy = false;
    }
  }

  /**
   * Put a short answer on a button for a moment, then its caption back — for
   * a control on a sheet, where anything said behind it is out of sight.
   */
  private sayOnButton(btn: Phaser.GameObjects.Container, caption: string, message: string): void {
    setButtonText(btn, message);
    this.time.delayedCall(2600, () => setButtonText(btn, caption));
  }

  /* ------------------------------------------------------------ rebuilds */

  /**
   * Restart the menu, handing the rebuilt one the end of the campaign — the
   * same visit, so the line stays. Only here: carried on every shutdown it
   * would be said on every visit forever. Moments not yet shown are carried
   * by the SHUTDOWN handler, whatever ends the build.
   */
  private restartMenu(): void {
    if (this.finished) this.registry.set('campaignComplete', true);
    this.scene.restart();
  }

  /**
   * Rebuild the menu when the calendar day changes underneath it.
   *
   * The Daily card is rendered once in `create()`, and a Phaser scene is not
   * re-created when the app comes back from the background. A phone left on
   * this screen overnight therefore kept showing yesterday's "solved" against
   * today's unsolved fold — and the free reveal, the streak guard and the
   * missions, which are also keyed to the day, never ran. And at midnight
   * itself: a timer to just past the next local midnight, re-armed whenever a
   * check finds the day unchanged (a clock or time-zone change moves midnight).
   *
   * Not from under a sheet: the rebuild waits for it to close.
   */
  private watchForRollover(builtFor: string): void {
    let timer = 0;
    const arm = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, msToLocalMidnight() + 1000);
    };
    const check = (): void => {
      // Hidden: the visibilitychange back to visible checks again.
      if (document.visibilityState !== 'visible') return;
      if (todayISO() === builtFor) {
        arm();
        return;
      }
      if (this.sheet) {
        this.rolloverPending = true;
        return;
      }
      this.rolloverRestart();
    };
    document.addEventListener('visibilitychange', check);
    arm();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('visibilitychange', check);
      window.clearTimeout(timer);
    });
  }

  /**
   * The day turned. Stop listening first: the new day's gift must wait in
   * Progress for the rebuilt menu, not land on this one as it shuts down.
   */
  private rolloverRestart(): void {
    this.offGrant?.();
    this.offGrant = null;
    if (this.scene.isActive()) this.restartMenu();
  }

  /**
   * Rebuild when the thumb's floor or the banner's reach moves under a built
   * menu — the SE's safe area settling after launch, a Split View divider, the
   * Duo folding. Tap areas are capped at the room they were built with, so
   * nothing overlaps in between; this lays the page out again for the new
   * numbers. Never from under a sheet the player is reading: closing it asks
   * again.
   */
  private watchScale(): void {
    let settle: Phaser.Time.TimerEvent | null = null;
    const onResize = (): void => {
      settle?.remove();
      /*
       * Except a banner line that moved UP over the built stack: that is not
       * left to settle. The native banner is already at its new place, over
       * whatever the page still draws below its line, and a thumb aimed at
       * that row — Continue, the trio — presses the ad. So the page is laid
       * out again on the next step: not in this call, because one relayout
       * sends two RESIZEs (main.ts's setGameSize, then its refresh) and the
       * first measures the canvas before it has moved. With no banner there
       * is nothing to press, and the rebuild waits for the size to hold.
       */
      const shrunk =
        Ads.enabled && (viewHeight() < this.builtHeight || this.footLine() < this.builtFootLine);
      settle = this.time.delayedCall(shrunk ? 0 : REFIT_SETTLE_MS, () => {
        settle = null;
        this.refit();
      });
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    });
  }

  /**
   * A new world height (main.ts: a fold, Split View, a rotation) is a new
   * layout too — the page is anchored to both ends of the canvas — so it
   * rebuilds like any other stale number, the moments not yet shown carried
   * across (create's SHUTDOWN hands them on). An open sheet stays up and
   * centred (UI.keepCentred) with the page under its scrim as it was; closing
   * it rebuilds.
   */
  private refit(): void {
    if (!this.scene.isActive() || this.sheet) return;
    const stale =
      this.builtFloor !== minTap(this) ||
      this.builtFootLine !== this.footLine() ||
      this.builtHeight !== viewHeight();
    if (stale) this.restartMenu();
  }

  /**
   * The lowest a tap area may reach, measured now — see MenuLayout.menuFootLine.
   * With a banner (`Ads.enabled`, the banner's own condition) 8 pt over its
   * line or over the banner itself, whichever is higher; with none — a Remove
   * Ads owner, an ads-off build, consent withheld — the paper's own bottom, so
   * the page is the mock's whole page instead of keeping an empty strip.
   */
  private footLine(): number {
    const height = viewHeight();
    const banner = Ads.enabled;
    const top = banner ? canvasBannerTop(this.game.canvas, BASE_WIDTH, height) : null;
    return menuFootLine(height, banner, top, this.scale.displayScale.y);
  }

  private open(index: number): void {
    Haptics.tap();
    // The banner stays up through gameplay now, so it is never torn down and
    // rebuilt on a scene change — a banner that disappears and reappears is
    // worse than one that is simply always there.
    this.scene.start('Game', { levelIndex: index });
  }
}

/** A chip at `alpha`, all but its own dot (CHIP_DOT), which stays at full strength. */
function fadeChip(c: Phaser.GameObjects.Container, alpha: number): void {
  for (const o of c.list) {
    if (o.name === CHIP_DOT) continue;
    (o as unknown as { setAlpha?: (v: number) => unknown }).setAlpha?.(alpha);
  }
}

/**
 * A sheet's card, top and bottom, in world space: its card blocker
 * (UI.cardBlocker), which every sheet lays over its card at the card's own
 * size — the tallest interactive zone on the sheet. Null when there is none.
 */
function sheetCardBox(sheet: Phaser.GameObjects.Container): { top: number; bottom: number } | null {
  const card = { top: 0, h: 0 };
  const walk = (o: Phaser.GameObjects.GameObject): void => {
    if (o instanceof Phaser.GameObjects.Zone && o.input && o.displayHeight > card.h) {
      card.h = o.displayHeight;
      card.top = o.getWorldTransformMatrix().ty - card.h / 2;
    }
    if (o instanceof Phaser.GameObjects.Container) o.list.forEach(walk);
  };
  walk(sheet);
  return card.h > 0 ? { top: card.top, bottom: card.top + card.h } : null;
}

/** Milliseconds from `now` to the next local midnight. */
function msToLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}
