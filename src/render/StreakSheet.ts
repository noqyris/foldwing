/**
 * The Streak sheet — what the flame on the menu is counting, and the one way
 * to keep a run that slipped.
 *
 * It answers the questions a streak raises and nothing else: how long, the
 * best so far, the week, the bookmarks held (and what they are for), how far
 * to the next reward — and, on the one day it applies, the repair. Never "you
 * lost" (QA round 1): a run a repair can keep is named by its length, "12-day
 * streak · missed a day", and the next reward counts from it; a run that is
 * over is "Start a new streak" beside the best one kept; "No streak yet" only
 * for a player who has never had one.
 *
 * THE DAILY IS NEVER BEHIND THE OFFER. The repairable Daily card opens this
 * sheet, so while today's fold is still to do the sheet leads with it — "Play
 * today's fold", the primary — and the repair sits under it, on the accent
 * face. Declining the repair costs the player nothing but the old run.
 *
 * THE REPAIR is a rescue placement (§0), so it follows the skip's rule, not a
 * reveal's: drawn FREE wherever no ad can play — the web, an ads-off build, a
 * player who withheld consent, an SDK that is not up — and for Remove Ads
 * owners, who paid not to be asked; an ad that fails to arrive ('unavailable')
 * keeps the streak anyway. A rewarded ad pays on the reward event only: a
 * close ('declined') keeps nothing. The row names the ad and what it keeps
 * before anyone taps it.
 *
 * Drawn at depth 70, under the toasts (80) and the reward tokens (85): what the
 * sheet causes — a milestone the repair reached, "Reminders on" — is said over
 * it, where the player is looking.
 *
 * Night Fold: the opaque sheet over the night's scrim, the week in the
 * Daily's dusk — the same week the Daily card and the Daily's result card
 * draw, in the same colour, so a done day looks like one thing everywhere.
 */

import Phaser from 'phaser';
import { monetization } from '../config/monetization';
import {
  longestFrom,
  milestoneFor,
  nextMilestone,
  repairable,
  runBefore,
  streakFrom,
  weekStrip,
  type Day,
  type Milestone,
  type WeekDot,
} from '../core/Streak';
import { Ads } from '../systems/Ads';
import { Audio } from '../systems/Audio';
import { todayISO } from '../systems/Daily';
import { Haptics } from '../systems/Haptics';
import type { NudgePermission } from '../systems/Nudges';
import { Progress, streakSets, type SaveData } from '../systems/Progress';
import { drawWeekDot, duskWeek, weekdayOf } from './DailyCard';
import { sheetBottomLimit, SHEET_TOP_LIMIT } from './StoreSheet';
import { BASE_WIDTH, pt, theme, ui, viewHeight } from './Theme';
import {
  bookmarkGlyph,
  button,
  cardBlocker,
  countUp,
  dismissOnScrim,
  FONT,
  keepCentred,
  label,
  mainCameraOnly,
  RADIUS,
  roundRect,
  scrim,
  sheetPanel,
  shieldInput,
  toastLines,
  type Tone,
  TYPE,
} from './UI';

const STREAK = monetization.economy.streak;
const REPAIR = monetization.economy.repair;

export type StreakSave = Pick<Readonly<SaveData>, 'daily' | 'bookmarked' | 'bookmarks' | 'lastRepair'>;

export interface StreakSheetEnv {
  /** An ad can play right now (Ads.rewardedAvailable), read at draw time. */
  readonly rewardedAvailable: boolean;
  readonly owner: boolean;
  /** What iOS has on record for notifications; null while it is being asked. */
  readonly permission: NudgePermission | null;
}

export interface StreakSheetModel {
  readonly streak: number;
  readonly best: number;
  readonly title: string;
  readonly sub: string;
  readonly dots: WeekDot[];
  /** Narrow weekday letters under the dots, oldest first. */
  readonly letters: string[];
  readonly bookmarksLine: string;
  /** The next reward, counted from the run a repair would keep while one is offered. */
  readonly next: { readonly text: string; readonly have: number; readonly need: number };
  /** The repair row, when a missed day can still be kept. */
  readonly repair: { readonly day: Day; readonly run: number; readonly free: boolean; readonly text: string } | null;
  /** "Play today's fold", above the repair: while one is offered and today's is not folded. */
  readonly play: boolean;
  /** "Remind me each day": only while the notification question is unanswered. */
  readonly remind: boolean;
}

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;
const reveals = (n: number): string => `+${n} ${n === 1 ? 'reveal' : 'reveals'}`;

/**
 * What a milestone gives, in the sheet's words: "+3 reveals and a bookmark",
 * "a bookmark", "+5 reveals". Owners have unlimited reveals, so a count of them
 * says nothing there; their line keeps the bookmark or just the day.
 *
 * With the bookmarks full, a day that would pay one pays a reveal instead, and
 * says so: "+3 reveals · bookmarks full, +1 reveal instead" (§1.3). Folded into
 * the count as "+4 reveals", nothing told the player why day 14 paid four here
 * and three everywhere else.
 */
export function milestoneReward(m: Milestone, owner: boolean): string {
  // The day would have paid a bookmark with room for it: this one overflowed.
  const overflow = m.bookmarks === 0 && (milestoneFor(m.day, 0, STREAK)?.bookmarks ?? 0) > 0;
  const table = owner ? 0 : overflow ? m.reveals - STREAK.overflowReveals : m.reveals;
  const parts: string[] = [];
  if (table > 0) parts.push(m.bookmarks > 0 ? `${reveals(table)} and a bookmark` : reveals(table));
  else if (m.bookmarks > 0) parts.push('a bookmark');
  if (overflow && !owner) parts.push(`bookmarks full, ${reveals(STREAK.overflowReveals)} instead`);
  return parts.join(' · ');
}

/** Everything the sheet says, from the save and the moment. Pure. */
export function streakSheetModel(save: StreakSave, today: Day, env: StreakSheetEnv): StreakSheetModel {
  const { done, marked } = streakSets(save);
  const streak = streakFrom(done, marked, today);
  const best = longestFrom(done, marked);
  // Spelled out, like the card's date (DailyCard): the game's words are English.
  const [ty, tm, td] = today.split('-').map(Number);
  const letters: string[] = [];
  for (let i = 6; i >= 0; i--) letters.push(LETTERS[new Date(ty, tm - 1, td - i, 12).getDay()]);
  const missed = repairable(done, marked, today, save.lastRepair, save.bookmarks, REPAIR);
  const todayDone = done.has(today);
  let repair: StreakSheetModel['repair'] = null;
  if (missed) {
    const run = runBefore(done, marked, missed);
    const free = !env.rewardedAvailable || env.owner;
    repair = {
      day: missed,
      run,
      free,
      text: free ? `Keep your ${run}-day streak` : `Watch an ad → keep your ${run}-day streak`,
    };
  }
  // While a repair is offered the next reward counts from the run it keeps
  // (with today's fold joined to it, once there is one): 12/14, not 0/3.
  const have = missed ? streakFrom(done, new Set([...marked, missed]), today) : streak;
  const m = nextMilestone(have, save.bookmarks, STREAK);
  const reward = milestoneReward(m, env.owner);
  const head = sheetHead(streak, best, repair, todayDone);
  return {
    streak,
    best,
    title: head.title,
    sub: head.sub,
    dots: weekStrip(done, marked, today),
    letters,
    bookmarksLine: `Bookmarks ${save.bookmarks} of ${STREAK.bookmarkMax} · each covers a missed day`,
    next: { text: reward ? `Day ${m.day} · ${reward}` : `Day ${m.day}`, have, need: m.day },
    repair,
    play: repair !== null && !todayDone,
    remind: env.permission === 'prompt',
  };
}

/**
 * The title and the line under it. A run a repair can keep is named by its
 * length — it is waiting, not gone — and that wins over the 1-day run a
 * Daily folded today starts beside it: "1-day streak" over "keep your 12-day
 * streak" was the contradiction QA read on this sheet.
 */
function sheetHead(
  streak: number,
  best: number,
  repair: StreakSheetModel['repair'],
  todayDone: boolean
): { title: string; sub: string } {
  if (repair) {
    return {
      title: `${repair.run}-day streak · missed a day`,
      sub: todayDone ? "keep it below, and today's fold joins it" : 'keep it below, or start fresh today',
    };
  }
  if (streak > 0) return { title: streakTitle(streak), sub: `best ${days(best)}` };
  if (best > 0) return { title: 'Start a new streak', sub: `best ${days(best)}` };
  return { title: 'No streak yet', sub: 'fold the Daily to start one' };
}

/** "12-day streak" — the title a run gets, and what the repair's count-up writes. */
export const streakTitle = (n: number): string => (n > 0 ? `${n}-day streak` : 'No streak yet');

/* ------------------------------------------------------------ the card */

export interface StreakRepaired {
  readonly before: number;
  readonly after: number;
  /** What reaching the restored length paid (usually nothing) — Progress.repairPays. */
  readonly milestones: readonly Milestone[];
}

export interface StreakSheetOptions {
  /** Where notification permission stands, re-read on every draw. */
  readonly permission: () => NudgePermission | null;
  /** Reminders can be offered here at all (Nudges.available). */
  readonly remindable: boolean;
  /** The missed day is kept; the menu moves its chips and says what it paid. */
  readonly onRepaired: (r: StreakRepaired) => void;
  /** [Play today's fold]: the sheet goes and today's Daily opens. */
  readonly onPlay: () => void;
  /** [Remind me each day]: the request → rebuild flow, and what to say after. */
  readonly onRemind: () => Promise<void>;
  readonly onNotice: (text: string, tone: Tone) => void;
  readonly onClose: () => void;
  readonly stillOpen: (sheet: Phaser.GameObjects.Container) => boolean;
}

const DEPTH = 70;
const CW = pt(300);
const ROW_W = CW - pt(36);
const PAD_TOP = pt(18);
const PAD_BOTTOM = pt(10);
const PLAY_H = pt(50);
const REPAIR_H = pt(50);
const REMIND_H = pt(44);
const CLOSE_H = pt(44);
const ROW_GAP = pt(10);
/** From one line of the next reward to the next, when it takes two. */
const NEXT_LINE = pt(16);

/**
 * Draw the sheet. It rebuilds itself after a repair or an answered reminder
 * question, so the week, the title and the rows always say what is true now.
 */
export function showStreakSheet(scene: Phaser.Scene, o: StreakSheetOptions): Phaser.GameObjects.Container {
  const t = theme();
  const u = ui();
  // Laid out for the world as it is now, and kept centred if it changes (keepCentred).
  const builtH = viewHeight();
  const sheet = keepCentred(scene.add.container(0, 0).setDepth(DEPTH));
  mainCameraOnly(scene, sheet);

  const close = (): void => {
    shieldInput(scene);
    o.onClose();
  };
  const alive = (): boolean => !!sheet.scene && o.stillOpen(sheet);

  // The night's scrim, the page's bands dimmed with it (UI.scrim).
  const back = scrim(scene, BASE_WIDTH / 2, builtH / 2);
  dismissOnScrim(back, close);
  sheet.add(back);

  let body: Phaser.GameObjects.Container | null = null;
  /** Said in the repair row's place once the day is kept. */
  let status: string | null = null;
  /** "Play today's fold" was offered: a repair made here keeps it, today is still to fold. */
  let playOffered = false;
  let busy = false;

  const env = (): StreakSheetEnv => ({
    rewardedAvailable: Ads.rewardedAvailable,
    owner: Progress.data.adsRemoved,
    permission: o.permission(),
  });

  const draw = (): { title: Phaser.GameObjects.Text; model: StreakSheetModel } => {
    body?.destroy(true);
    const b = scene.add.container(0, 0);
    body = b;
    sheet.add(b);

    const model = streakSheetModel(Progress.data, todayISO(), env());
    const showRepair = model.repair !== null && status === null;
    const showPlay = model.play || (playOffered && status !== null);
    playOffered ||= showPlay;
    const showRemind = o.remindable && model.remind;

    // The next reward and its count share a row; an overflow line that does
    // not fit beside the count breaks at its " · " onto a second line.
    const count = `${model.next.have}/${model.next.need}`;
    const probe = label(scene, 0, 0, count, { size: TYPE.label });
    const nextRoom = ROW_W - probe.width - pt(12);
    const nextLines = toastLines(model.next.text, (s) => probe.setText(s).width, nextRoom);
    probe.destroy();

    // Measured top to bottom first, then the card is drawn around it.
    let y = PAD_TOP;
    const titleY = y + pt(14);
    y += pt(28);
    const subY = y + pt(9);
    y += pt(18) + pt(16);
    const lettersY = y + pt(7);
    y += pt(14) + pt(6);
    const dotsY = y + pt(11);
    y += pt(22) + pt(16);
    const bookmarksY = y + pt(10);
    y += pt(20) + pt(14);
    const nextY = y + pt(9);
    y += pt(18) + (nextLines.length - 1) * NEXT_LINE + pt(6);
    const barY = y + pt(2);
    y += pt(4);
    let statusY: number | null = null;
    if (status !== null) {
      y += pt(14);
      statusY = y + pt(10);
      y += pt(20);
    }
    let playY: number | null = null;
    if (showPlay) {
      y += pt(16);
      playY = y + PLAY_H / 2;
      y += PLAY_H;
    }
    let repairY: number | null = null;
    if (showRepair) {
      y += showPlay ? ROW_GAP : pt(16);
      repairY = y + REPAIR_H / 2;
      y += REPAIR_H;
    }
    let remindY: number | null = null;
    if (showRemind) {
      y += showRepair ? ROW_GAP : pt(16);
      remindY = y + REMIND_H / 2;
      y += REMIND_H;
    }
    y += pt(12);
    const closeY = y + CLOSE_H / 2;
    y += CLOSE_H + PAD_BOTTOM;
    const height = y;

    const band = sheetBottomLimit(builtH) - SHEET_TOP_LIMIT;
    const top = SHEET_TOP_LIMIT + Math.max(0, (band - height) / 2);
    const cx = BASE_WIDTH / 2;
    const left = cx - ROW_W / 2;
    const right = cx + ROW_W / 2;
    const at = (v: number): number => top + v;

    b.add([sheetPanel(scene, cx, top + height / 2, CW, height, RADIUS.lg), cardBlocker(scene, cx, top + height / 2, CW, height)]);

    const title = label(scene, left, at(titleY), model.title, {
      size: TYPE.heading,
      font: FONT.display,
      color: u.text,
    }).setOrigin(0, 0.5);
    // "12-day streak · missed a day" in a long font fallback: scaled, never cut.
    if (title.width > ROW_W) title.setScale(ROW_W / title.width);
    b.add(title);
    b.add(label(scene, left, at(subY), model.sub, { size: TYPE.label, color: u.text2 }).setOrigin(0, 0.5));

    // The week: letters over dots, today last and in the text colour.
    const marks = scene.add.graphics();
    b.add(marks);
    const col = ROW_W / 7;
    model.dots.forEach((dot, i) => {
      const x = left + col * (i + 0.5);
      const today = i === model.dots.length - 1;
      b.add(
        label(scene, x, at(lettersY), model.letters[i], {
          size: TYPE.micro,
          weight: 600,
          color: today ? u.text : u.text3,
        }).setOrigin(0.5)
      );
      drawWeekDot(marks, x, at(dotsY), dot, pt(18), duskWeek());
    });

    bookmarkGlyph(marks, left + pt(4), at(bookmarksY), t.accentText, 1);
    const bm = label(scene, left + pt(14), at(bookmarksY), model.bookmarksLine, {
      size: TYPE.label,
      color: u.text2,
    }).setOrigin(0, 0.5);
    if (bm.width > ROW_W - pt(14)) bm.setScale((ROW_W - pt(14)) / bm.width);
    b.add(bm);

    // The next reward, and how far there is to go: a thin bar, 12 of 14.
    nextLines.forEach((line, i) => {
      const text = label(scene, left, at(nextY) + i * NEXT_LINE, line, { size: TYPE.label, weight: 500, color: u.text }).setOrigin(0, 0.5);
      // Two lines that still do not fit are scaled, never cut.
      if (text.width > nextRoom) text.setScale(nextRoom / text.width);
      b.add(text);
    });
    b.add(label(scene, right, at(nextY), count, { size: TYPE.label, color: u.text2 }).setOrigin(1, 0.5));
    const bar = scene.add.graphics();
    const barH = pt(4);
    bar.fillStyle(u.text, 0.08);
    roundRect(bar, left, at(barY) - barH / 2, ROW_W, barH, RADIUS.pill);
    const frac = model.next.need > 0 ? Math.min(1, model.next.have / model.next.need) : 0;
    if (frac > 0) {
      bar.fillStyle(t.accent, 0.9);
      roundRect(bar, left, at(barY) - barH / 2, Math.max(barH, ROW_W * frac), barH, RADIUS.pill);
    }
    b.add(bar);

    if (status !== null && statusY !== null) {
      b.add(
        label(scene, cx, at(statusY), status, { size: TYPE.label, weight: 600, color: t.accentText }).setOrigin(0.5)
      );
    }

    /*
     * Tap areas: the floor, capped a point short of half the gap on each side
     * (the card's own padding below the last row), so no two share a spot on a
     * canvas drawn small. Under about 0.42 that caps them under 44pt, as on
     * every other sheet.
     */
    const cap = (h: number, above: number, below: number): number => h + 2 * Math.min(above, below) - pt(1);

    if (showPlay && playY !== null) {
      b.add(
        button(scene, cx, at(playY), "Play today's fold", {
          width: ROW_W,
          height: PLAY_H,
          variant: 'primary',
          size: TYPE.body,
          minTap: true,
          maxTap: cap(PLAY_H, pt(8), showRepair || showRemind ? ROW_GAP / 2 : pt(6)),
          onPress: () => {
            if (busy) return;
            shieldInput(scene);
            o.onPlay();
          },
        })
      );
    }
    if (showRepair && model.repair && repairY !== null) {
      const r = model.repair;
      const run = r.run;
      b.add(
        // No mark on the left: the caption is the longest on the card, and it
        // already says "Watch an ad" in words. Under "Play today's fold" it
        // takes the accent face: one primary to a card.
        button(scene, cx, at(repairY), r.text, {
          width: ROW_W,
          height: REPAIR_H,
          variant: showPlay ? 'accent' : 'primary',
          size: TYPE.label,
          minTap: true,
          maxTap: cap(REPAIR_H, showPlay ? ROW_GAP / 2 : pt(8), showRemind ? ROW_GAP / 2 : pt(6)),
          onPress: () => void repair(r.free, r.day, run),
        })
      );
    }
    if (showRemind && remindY !== null) {
      b.add(
        button(scene, cx, at(remindY), 'Remind me each day', {
          width: ROW_W,
          height: REMIND_H,
          variant: 'secondary',
          size: TYPE.label,
          minTap: true,
          maxTap: cap(REMIND_H, showRepair ? ROW_GAP / 2 : pt(8), pt(6)),
          onPress: () => void remind(),
        })
      );
    }
    b.add(
      button(scene, cx, at(closeY), 'Close', {
        width: pt(140),
        height: CLOSE_H,
        variant: 'ghost',
        size: TYPE.label,
        minTap: true,
        maxTap: cap(CLOSE_H, pt(6), PAD_BOTTOM),
        onPress: close,
      })
    );
    return { title, model };
  };

  /** Keep the missed day: after the ad's reward, or free — see the header. */
  const repair = async (free: boolean, missed: Day, run: number): Promise<void> => {
    if (busy) return;
    busy = true;
    Haptics.tap();
    try {
      if (!free) {
        const result = await Ads.showRewarded('repair', () => alive() && scene.scene.isActive());
        // A rescue: no ad to be had keeps the streak anyway. A close keeps nothing.
        if (result !== 'earned' && result !== 'unavailable') return;
      }
      // Earned is owed whether or not the sheet is still up; the save is the truth.
      const today = todayISO();
      const before = Progress.dailyStreak(today);
      const milestones = Progress.repairPays(today);
      if (!Progress.repairStreak(today)) {
        o.onNotice('nothing left to keep · a new day has started', 'plain');
        return;
      }
      const after = Progress.dailyStreak(today);
      Haptics.success();
      Audio.streakUp();
      o.onRepaired({ before, after, milestones });
      if (!alive()) return;
      status = `Streak kept · ${WEEKDAY_NAMES[weekdayOf(missed)]} is bookmarked`;
      const { title } = draw();
      // From the run the title named, not from the 0 the gap left: the run was
      // never gone, and it counts on only by a day today's fold joins to it.
      countUp(scene, title, Math.min(run, after), after, streakTitle, 700);
    } finally {
      busy = false;
    }
  };

  const remind = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await o.onRemind();
    } finally {
      busy = false;
    }
    if (alive()) draw();
  };

  draw();
  return sheet;
}
