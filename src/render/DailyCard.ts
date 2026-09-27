/**
 * The Daily card — the menu's second row, and the whole retention loop in one
 * glance: today's fold, where the run stands, and the week behind it.
 *
 * It was a grey secondary row whose only trace of the streak was a sub-line,
 * so "6 day streak — keep it" and "solved · 7 day streak" looked the same and
 * nothing said when a streak was about to end. Now the card has a state, and
 * the state picks its face and its words (`dailyCardState`, pure and tested):
 *
 *   locked      a brand-new player, until the tutorial is done — a hard maze in
 *               the first session loses people (§0). Anyone with a Daily in the
 *               ledger is never locked.
 *   done        today's is folded.
 *   repairable  yesterday broke a run a repair can still keep, and today's is
 *               not folded yet. The tap opens the Streak sheet, which offers
 *               today's fold first and the repair under it.
 *   atRisk      a run is alive and today's is not folded yet.
 *   broken      no run, but there was one worth naming.
 *   fresh       no run worth naming.
 *
 * Done wins over repairable (QA round 1). With repairable first, a player who
 * folded today's Daily still saw "missed a day · keep it?" all day, and the
 * card's one door led to an ad offer rather than to anything they had done.
 * The repair stays a tap away on the streak chip, which wears the dot for as
 * long as the day can be kept.
 *
 * No countdowns, deliberately: "ends at midnight" after 18:00 is the whole of
 * the pressure the card applies, and only where it is true (no bookmark held
 * to cover the day). That one evening the card is lit — a dusk rim and glow,
 * the strongest thing on the page, over Continue — and never otherwise.
 *
 * NIGHT FOLD (SPEC §5.1, the mock's `.daily`): the Daily alone is dusk — a
 * violet-to-slate card, the evening ritual, told apart from the tangerine
 * campaign by colour as well as place. The caps say which fold ("DAILY FOLD ·
 * NO. 58"), Georgia says whose day it is ("Sunday's fold"), the week is seven
 * dusk dots, the run is a Georgia numeral beside the flame, and the Play pill
 * is the card's one call. The state's own line sits under the week.
 */

import Phaser from 'phaser';
import { daysBetween } from '../core/CalendarDay';
import { repairable, runBefore, streakFrom, longestFrom, weekStrip, type Day, type WeekDot } from '../core/Streak';
import { monetization } from '../config/monetization';
import { TUTORIAL_LEVELS } from '../data/tutorialLevels';
import { clock } from '../systems/NudgePlan';
import { streakSets, type SaveData } from '../systems/Progress';
import { panel, RADII, type PanelSpec } from './Baked';
import { icon, paintIcon, type IconName } from './Icons';
import { dailyCardLayout } from './MenuLayout';
import { dp, FONT_UI, hexCss, pt, rgba, theme, ui } from './Theme';
import { bookmarkGlyph, button, FONT, label } from './UI';

export type DailyKind = 'locked' | 'fresh' | 'atRisk' | 'done' | 'broken' | 'repairable';

/** The slice of the save the card reads. A whole SaveData fits. */
export type DailySave = Pick<
  Readonly<SaveData>,
  'daily' | 'bookmarked' | 'bookmarks' | 'lastRepair' | 'cleared' | 'unlockedIndex'
>;

export interface DailyCardState {
  readonly kind: DailyKind;
  readonly title: string;
  /** "Daily fold · No. 58": the kicker, drawn in caps. */
  readonly caps: string;
  /** "Sunday's fold": whose day it is, in the display face. */
  readonly heading: string;
  /** The weekday letters under the week, oldest first. */
  readonly letters: string[];
  /** "#53 · Tue 22 Sep". */
  readonly right: string;
  readonly sub: string;
  /** The last seven days, oldest first. */
  readonly strip: WeekDot[];
  readonly streak: number;
  /** The run a repair would keep — what a repairable card's flame counts. 0 otherwise. */
  readonly run: number;
  /** At risk after LATE_HOUR with nothing to cover the day: the card is filled. */
  readonly late: boolean;
  /** No week to show: the two lines sit centred (see `dailyCardBare`). */
  readonly bare: boolean;
}

/**
 * How the card is painted. Always dusk; what changes is how hard it calls.
 * Quiet when there is nothing to do today, or nothing yet: its pill is an
 * outline. The wash while there is: the pill is filled. Filled — lit, a dusk
 * rim and glow round the whole card — on the one evening a run ends at
 * midnight uncovered.
 */
export type DailyFace = 'quiet' | 'wash' | 'filled';

export function dailyCardFace(st: Pick<DailyCardState, 'kind' | 'late'>): DailyFace {
  if (st.kind === 'locked' || st.kind === 'done') return 'quiet';
  return st.kind === 'atRisk' && st.late ? 'filled' : 'wash';
}

/** Daily #1: the fold the share card numbers from. */
export const DAILY_EPOCH: Day = '2026-08-01';

/** From this local hour a run with nothing to cover today says it ends at midnight. */
export const LATE_HOUR = 18;

/** "#53": days since the epoch, counting it as #1. 0 for a date before it. */
export function dailyNumber(day: Day): number {
  const n = daysBetween(DAILY_EPOCH, day) + 1;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/*
 * Spelled out rather than asked of Intl. The game's words are English and its
 * card must say "Tue 22 Sep" on every phone: en-GB's own abbreviation has
 * become "Sept" in newer ICU data, and a device locale would put a foreign
 * weekday into an English line.
 */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Weekday of an ISO date, 0 = Sunday. Read at local noon, so no DST jump can move it. */
export function weekdayOf(day: Day): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getDay();
}

/** The narrow weekday letters of the seven days ending `today`, oldest first. */
export function weekLetters(today: Day): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) out.push(LETTERS[new Date(y, m - 1, d - i, 12).getDay()]);
  return out;
}

/** "Tue 22 Sep". */
export function dayLabel(day: Day): string {
  const [, m, d] = day.split('-').map(Number);
  return `${WEEKDAYS[weekdayOf(day)]} ${d} ${MONTHS[m - 1]}`;
}

/**
 * The Daily lock — the same rule as Progress.dailyUnlocked(), for a save
 * passed in rather than the live one: open with any Daily in the ledger, once
 * the last tutorial fold is cleared, or once any fold past the tutorial is
 * (a save migrated to v3 forgot its tutorial clears, not the player).
 * DailyCard.test.ts pins that the two agree; the menu passes the live answer.
 */
export function dailyOpenFor(save: Pick<DailySave, 'daily' | 'cleared'>): boolean {
  if (Object.keys(save.daily).length > 0) return true;
  const tutorial = TUTORIAL_LEVELS.map((l) => l.id);
  return save.cleared.some((id) => id === tutorial[tutorial.length - 1] || !tutorial.includes(id));
}

/** Tutorial folds between the player and the Daily: from the frontier to the last one, at least one. */
export function tutorialFoldsToGo(save: Pick<DailySave, 'unlockedIndex'>): number {
  const n = TUTORIAL_LEVELS.length;
  const at = Number.isFinite(save.unlockedIndex) ? Math.max(0, Math.trunc(save.unlockedIndex)) : 0;
  return Math.max(1, n - Math.min(at, n));
}

export const foldsToGo = (n: number): string => `${n} ${n === 1 ? 'fold' : 'folds'} to go`;

/**
 * The first session: the tutorial not done (the frontier short of where the
 * missions open) and no Daily ever folded. The menu holds the economy back
 * until it is over — no balance chip, no Store, no gift said out loud (the
 * gift still lands) — so the first screen has one thing to do: Play. The
 * store sells nothing before five wins anyway (the starter waits for them).
 */
export function firstSession(save: Pick<DailySave, 'unlockedIndex' | 'daily'>): boolean {
  return (
    save.unlockedIndex < monetization.economy.missions.unlockAfterIndex && Object.keys(save.daily).length === 0
  );
}

/** What the menu's streak chip shows: a count, whether it is faint, and the accent dot. */
export interface StreakChipState {
  readonly count: number;
  readonly faint: boolean;
  readonly dot: boolean;
}

/**
 * The streak chip: the run alive, faint at 0 — except when a repair can still
 * keep yesterday's run. Then it counts that run, faint, with the dot: the run
 * is waiting, not gone, and a "0" beside "keep your 12-day streak" read as the
 * loss the sheet was careful never to say (QA round 1). A run alive today — a
 * Daily folded beside a run still repairable — is never faint.
 */
export function streakChipState(
  save: Pick<DailySave, 'daily' | 'bookmarked' | 'bookmarks' | 'lastRepair'>,
  today: Day
): StreakChipState {
  const { done, marked } = streakSets(save);
  const streak = streakFrom(done, marked, today);
  const missed = repairable(done, marked, today, save.lastRepair, save.bookmarks, monetization.economy.repair);
  if (streak === 0 && missed) return { count: runBefore(done, marked, missed), faint: true, dot: true };
  return { count: streak, faint: streak === 0, dot: missed !== null };
}

export function dailyCardState(
  save: DailySave,
  today: Day,
  now: Date,
  unlocked: boolean = dailyOpenFor(save)
): DailyCardState {
  const { done, marked } = streakSets(save);
  const streak = streakFrom(done, marked, today);
  const best = longestFrom(done, marked);
  const strip = weekStrip(done, marked, today);
  const n = dailyNumber(today);
  const base = {
    title: 'Daily fold',
    caps: n > 0 ? `Daily fold · No. ${n}` : 'Daily fold',
    heading: `${WEEKDAY_NAMES[weekdayOf(today)]}'s fold`,
    letters: weekLetters(today),
    right: n > 0 ? `#${n} · ${dayLabel(today)}` : dayLabel(today),
    strip,
    streak,
    run: 0,
    late: false,
    bare: false,
  };

  if (!unlocked) {
    return {
      ...base,
      kind: 'locked',
      bare: dailyCardBare('locked', save),
      sub: `unlocks after the tutorial · ${foldsToGo(tutorialFoldsToGo(save))}`,
    };
  }

  // Folded today: said, whatever else the day holds (see the header).
  const result = save.daily[today];
  if (result) {
    return { ...base, kind: 'done', sub: `solved in ${clock(result.ms)} · next fold at midnight` };
  }

  const missed = repairable(done, marked, today, save.lastRepair, save.bookmarks, monetization.economy.repair);
  if (missed) {
    const run = runBefore(done, marked, missed);
    return { ...base, kind: 'repairable', run, sub: `${run}-day streak missed a day · keep it?` };
  }

  if (streak >= 1) {
    const late = now.getHours() >= LATE_HOUR && save.bookmarks <= 0 && streak >= 3;
    return {
      ...base,
      kind: 'atRisk',
      late,
      sub: late ? `your ${streak}-day streak ends at midnight` : `day ${streak + 1} · keeps your ${streak}-day streak`,
    };
  }

  if (best > 1) return { ...base, kind: 'broken', sub: `best streak ${best} · start a new one` };
  return { ...base, kind: 'fresh', bare: dailyCardBare('fresh', save), sub: 'one maze, everyone, today' };
}

/* -------------------------------------------------------------- drawing */

export interface DailyCardOptions {
  readonly width: number;
  readonly height: number;
  /** The tallest the tap area may grow (MenuLayout's). */
  readonly maxTap: number;
}

/** What the card's one call says, and how hard: pure, so each kind is pinned in the test. */
export interface DailyPill {
  readonly text: string;
  readonly icon: IconName;
  /** An outline, not a fill: nothing to do here today. */
  readonly quiet: boolean;
  /** The icon trails the word ("Play →") rather than leading it ("✓ Solved"). */
  readonly trailing: boolean;
}

export function dailyPill(st: Pick<DailyCardState, 'kind'>): DailyPill {
  switch (st.kind) {
    case 'locked':
      return { text: 'Locked', icon: 'lock', quiet: true, trailing: false };
    case 'done':
      return { text: 'Solved', icon: 'check', quiet: true, trailing: false };
    case 'repairable':
      return { text: 'Keep it', icon: 'arrow', quiet: false, trailing: true };
    default:
      return { text: 'Play', icon: 'arrow', quiet: false, trailing: true };
  }
}

/**
 * The run the card counts beside the flame, and whether it is faint: the run a
 * repair would keep (faint — waiting, not gone), else the live one. Zero: no
 * numeral at all — a "0" beside a flame reads as a loss.
 */
export function dailyStreakShown(st: Pick<DailyCardState, 'kind' | 'streak' | 'run' | 'bare'>): {
  readonly n: number;
  readonly faint: boolean;
} | null {
  if (st.bare) return null;
  const n = st.kind === 'repairable' ? st.run : st.streak;
  return n > 0 ? { n, faint: st.kind === 'repairable' } : null;
}

/**
 * Whether the card says its state in words. Not in the everyday state — a run
 * alive, today still to fold, or a fresh week — where the numeral beside the
 * flame already says it and the week wears its weekday letters, as the mock
 * does; always when the words carry what the card cannot show otherwise: shut
 * until the tutorial is done, solved and when, a missed day a repair can keep,
 * the evening a run ends, the best run kept.
 */
export function dailySubShown(st: Pick<DailyCardState, 'kind' | 'late' | 'bare'>): boolean {
  if (st.bare) return true;
  if (st.kind === 'fresh') return false;
  return !(st.kind === 'atRisk' && !st.late);
}

/** A check small enough to sit inside a pt(10) dot — the mission rings'. */
export function miniCheck(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  g.lineStyle(pt(1.4), color, 1);
  g.beginPath();
  g.moveTo(x - pt(2.3), y + pt(0.1));
  g.lineTo(x - pt(0.7), y + pt(1.7));
  g.lineTo(x + pt(2.4), y - pt(1.8));
  g.strokePath();
}

/** The colours a week is drawn in: the Daily's dusk, or the Streak sheet's tangerine. */
export interface WeekPalette {
  /** A folded day's disc, and today's ring. */
  readonly mark: number;
  /** The check on a disc. */
  readonly onMark: number;
  /** A missed day's ring, at `quietAlpha`. */
  readonly quiet: number;
  readonly quietAlpha: number;
}

export const duskWeek = (): WeekPalette => ({ mark: ui().dusk, onMark: ui().onDusk, quiet: ui().text, quietAlpha: 0.22 });
export const accentWeek = (): WeekPalette => ({
  mark: theme().accent,
  onMark: ui().onAccent,
  quiet: ui().text,
  quietAlpha: 0.22,
});

/**
 * One day of the week, into a Graphics (the Streak sheet's, which is up for a
 * moment). Done: a disc with a check. Covered by a bookmark: the bookmark.
 * Missed: a quiet ring. Today, open: a ring in the mark's colour. Today,
 * folded: the disc, ringed, so today still reads as today.
 */
export function drawWeekDot(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  dot: WeekDot,
  d: number = pt(10),
  p: WeekPalette = accentWeek()
): void {
  const r = d / 2;
  switch (dot) {
    case 'done':
    case 'today-done':
      g.fillStyle(p.mark, 1);
      g.fillCircle(x, y, r);
      miniCheck(g, x, y, p.onMark);
      if (dot === 'today-done') {
        g.lineStyle(pt(1), p.mark, 0.45);
        g.strokeCircle(x, y, r + pt(2.2));
      }
      return;
    case 'marked':
      bookmarkGlyph(g, x, y, p.mark, 0.9);
      return;
    case 'missed':
      g.lineStyle(pt(1.3), p.quiet, p.quietAlpha);
      g.strokeCircle(x, y, r - pt(0.65));
      return;
    case 'today-open':
      g.lineStyle(pt(1.6), p.mark, 1);
      g.strokeCircle(x, y, r - pt(0.8));
      return;
  }
}

/**
 * The week, painted once (tech G2): seven dots `d` across, `pitch` apart, the
 * first centred at `x0`, with each day's letter under it (mock: `.week`).
 * Today's letter is in the text colour, the others in the caption's.
 */
export function paintWeek(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y: number,
  dots: readonly WeekDot[],
  letters: readonly string[],
  d: number,
  pitch: number,
  p: WeekPalette = duskWeek()
): void {
  const u = ui();
  const r = d / 2;
  ctx.save();
  dots.forEach((dot, i) => {
    const x = x0 + i * pitch;
    const today = i === dots.length - 1;
    if (dot === 'done' || dot === 'today-done') {
      ctx.fillStyle = hexCss(p.mark);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      paintIcon(ctx, 'check', x, y, d * 0.62, hexCss(p.onMark), 3);
      if (dot === 'today-done') {
        ctx.strokeStyle = rgba(p.mark, 0.45);
        ctx.lineWidth = dp(1.2);
        ctx.beginPath();
        ctx.arc(x, y, r + dp(3), 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (dot === 'marked') {
      paintIcon(ctx, 'bookmark', x, y, d * 0.8, hexCss(p.mark));
    } else if (dot === 'today-open') {
      // Lit: a ring with a soft glow of its own colour, as the mock's.
      ctx.save();
      ctx.shadowColor = rgba(p.mark, 0.6);
      ctx.shadowBlur = dp(10);
      ctx.strokeStyle = hexCss(p.mark);
      ctx.lineWidth = dp(2);
      ctx.beginPath();
      ctx.arc(x, y, r - dp(1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = rgba(p.quiet, p.quietAlpha);
      ctx.lineWidth = dp(1.6);
      ctx.beginPath();
      ctx.arc(x, y, r - dp(1), 0, Math.PI * 2);
      ctx.stroke();
    }
    const letter = letters[i];
    if (letter) {
      ctx.fillStyle = hexCss(today ? u.text : u.text3);
      ctx.font = `600 ${dp(9.5)}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, x, y + r + dp(9));
    }
  });
  ctx.restore();
}

/** Texture pixels per base unit for the baked week: sharp at the 1.6× an iPhone draws the canvas at. */
const WEEK_RES = 2;

/** The week as an Image, its first dot's centre at (x0, y) — baked once per week string. */
function weekImage(
  scene: Phaser.Scene,
  x0: number,
  y: number,
  dots: readonly WeekDot[],
  letters: readonly string[],
  d: number,
  pitch: number
): Phaser.GameObjects.Image {
  const w = pitch * (dots.length - 1) + d + dp(12);
  const h = d + dp(24);
  const key = `fw-week-${dots.join('.')}-${letters.join('')}-${Math.round(d)}-${Math.round(pitch)}`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, Math.ceil(w * WEEK_RES), Math.ceil(h * WEEK_RES));
    if (tex) {
      const ctx = tex.getContext();
      ctx.scale(WEEK_RES, WEEK_RES);
      paintWeek(ctx, d / 2 + dp(6), d / 2 + dp(6), dots, letters, d, pitch);
      tex.refresh();
    }
  }
  return scene.add
    .image(x0 - d / 2 - dp(6), y - d / 2 - dp(6), scene.textures.exists(key) ? key : '__MISSING')
    .setOrigin(0, 0)
    .setScale(1 / WEEK_RES);
}

/** Set every child's alpha: `enter()` tweens the container itself to 1. */
export function setContentAlpha(c: Phaser.GameObjects.Container, alpha: number): void {
  for (const o of c.list) {
    const a = o as unknown as { setAlpha?: (v: number) => unknown };
    a.setAlpha?.(alpha);
  }
}

/**
 * The card has no week to show: locked (the player cannot open the Daily yet),
 * or fresh with no Daily ever folded. Its lines sit under the title instead.
 * 'fresh' alone is not enough: it also covers a player whose one Daily was
 * folded days ago, and that day's dot is theirs to see.
 */
export function dailyCardBare(kind: DailyKind, save: Pick<DailySave, 'daily'>): boolean {
  if (kind === 'locked') return true;
  return kind === 'fresh' && Object.keys(save.daily).length === 0;
}

/** The dusk face, at rest and lit (the late evening's rim and glow). */
export function duskFace(lit: boolean): PanelSpec {
  const u = ui();
  return {
    radius: RADII.card,
    face: { kind: 'diagonal', from: u.duskFrom, to: u.duskTo },
    elevation: 'e2',
    outline: lit ? { color: u.dusk, alpha: 0.9, width: dp(1.5) } : { color: 0xd2aaff, alpha: 0.1, width: 2 },
    ...(lit ? { glow: { color: u.dusk, alpha: 0.45, blur: dp(18) } } : {}),
  };
}

/**
 * The card, centred on (x, y), as one button: a tap anywhere on it is the
 * Play pill's. See the header for the face; `dailyPill` for the call.
 */
export function drawDailyCard(
  scene: Phaser.Scene,
  x: number,
  y: number,
  st: DailyCardState,
  onPress: () => void,
  o: DailyCardOptions
): Phaser.GameObjects.Container {
  const t = theme();
  const u = ui();
  const w = o.width;
  const h = o.height;
  const faceKind = dailyCardFace(st);
  const L = dailyCardLayout(w, h, st.bare);
  const card = button(scene, x, y, '', {
    width: w,
    height: h,
    variant: 'ghost',
    minTap: true,
    maxTap: o.maxTap,
    onPress,
  });
  card.setName('daily-card');
  // Under the ghost's pressed glass: the face stays, the thumb's glass lights it.
  const lit = faceKind === 'filled';
  card.addAt(panel(scene, lit ? 'daily-dusk-lit' : 'daily-dusk', 0, 0, w, h, duskFace(lit)), 0);

  const left = -w / 2 + L.pad;
  const top = -h / 2;
  const room = L.leftEnd - L.pad;
  const fit = (text: Phaser.GameObjects.Text, max: number): Phaser.GameObjects.Text => {
    if (text.width > max) text.setScale(max / text.width);
    return text;
  };

  card.add(
    fit(
      label(scene, left, top + L.capsY, st.caps, {
        size: dp(10),
        color: u.duskCaps,
        weight: 600,
        caps: true,
        letterSpacing: dp(1.5),
      }).setOrigin(0, 0.5),
      room
    )
  );
  card.add(
    fit(
      label(scene, left, top + L.titleY, st.heading, { size: dp(22), font: FONT.display, color: u.text }).setOrigin(0, 0.5),
      room
    )
  );

  /*
   * The week: not on a bare card (dailyCardBare) — a player who cannot open
   * the Daily yet, or never has, has no week, and seven hollow rings would
   * read as a week missed before they were ever offered one.
   */
  const words = dailySubShown(st);
  if (!st.bare) {
    // The weekday letters sit where the state's line goes; the line wins when it is shown.
    const letters = words ? [] : st.letters;
    card.add(weekImage(scene, -w / 2 + L.weekX, top + L.weekY, st.strip, letters, L.dot, L.dotPitch));
  }
  // The state's own line: what today asks, or keeps, or why it is shut.
  if (words) {
    card.add(
      fit(
        label(scene, left, top + L.subY, st.sub, { size: dp(12), color: u.text2, weight: 500 }).setOrigin(0, 0.5),
        room
      )
    );
  }

  // The run, in Georgia, beside a dusk flame, with DAY STREAK under it.
  const shown = dailyStreakShown(st);
  if (shown) {
    const alpha = shown.faint ? 0.5 : 1;
    const num = label(scene, 0, top + L.streakY, String(shown.n), {
      size: dp(34),
      font: FONT.display,
      color: u.text,
      alpha,
    }).setOrigin(0, 0.5);
    const flameW = dp(26);
    const rowW = flameW + dp(4) + num.width;
    const rowX = -w / 2 + L.streakX - rowW / 2;
    num.setX(rowX + flameW + dp(4));
    card.add(icon(scene, rowX + flameW / 2, top + L.streakY, 'flame', { size: flameW, color: u.dusk, alpha }));
    card.add(num);
    card.add(
      label(scene, -w / 2 + L.streakX, top + L.streakCapsY, 'day streak', {
        size: dp(10),
        color: u.text3,
        weight: 600,
        caps: true,
        letterSpacing: dp(1.2),
      }).setOrigin(0.5)
    );
  }

  // The one call: filled while there is something to do today, an outline when not.
  const pill = dailyPill(st);
  const ink = pill.quiet ? u.duskCaps : u.onDusk;
  const word = label(scene, 0, top + L.pillY, pill.text, { size: dp(14), color: ink, weight: 600 }).setOrigin(0, 0.5);
  const glyph = dp(15);
  const gap = dp(6);
  const pillW = Math.ceil(word.width + glyph + gap + dp(32));
  const pillX = -w / 2 + L.pillRight - pillW / 2;
  const spec: PanelSpec = pill.quiet
    ? { radius: L.pillH / 2, face: { kind: 'none' }, outline: { color: u.dusk, alpha: 0.6, width: dp(1.2) } }
    : {
        radius: L.pillH / 2,
        face: { kind: 'solid', color: u.dusk },
        glow: { color: u.dusk, alpha: 0.55, blur: dp(14), dy: dp(5) },
      };
  const pillFace = panel(scene, pill.quiet ? 'daily-pill-quiet' : 'daily-pill', pillX, top + L.pillY, pillW, L.pillH, spec);
  card.add(pillFace);
  const inner = word.width + gap + glyph;
  const startX = pillX - inner / 2;
  let pillIcon: Phaser.GameObjects.GameObject;
  if (pill.trailing) {
    word.setX(startX);
    pillIcon = icon(scene, startX + word.width + gap + glyph / 2, top + L.pillY, pill.icon, { size: glyph, color: ink });
  } else {
    pillIcon = icon(scene, startX + glyph / 2, top + L.pillY, pill.icon, { size: glyph, color: ink });
    word.setX(startX + glyph + gap);
  }
  card.add(pillIcon);
  card.add(word);

  if (st.kind === 'repairable') {
    // Something here wants a look — the same dot the streak chip wears.
    const dot = scene.add.graphics();
    const cx = w / 2 - pt(7);
    const cy = -h / 2 + pt(7);
    dot.fillStyle(t.paper, 1);
    dot.fillCircle(cx, cy, pt(5.5));
    dot.fillStyle(t.accent, 1);
    dot.fillCircle(cx, cy, pt(4));
    card.add(dot);
  }

  // Locked: only the control is dimmed. Dimming the whole card took its
  // "unlocks after the tutorial · 5 folds to go" to 3.5:1 on the dusk (QA) —
  // the one line that says when it opens.
  if (st.kind === 'locked') {
    for (const o of [pillFace, pillIcon, word]) (o as unknown as { setAlpha(v: number): unknown }).setAlpha(0.6);
  }
  return card;
}
