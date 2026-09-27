/**
 * Missions — three small goals a day, each paying one reveal on completion.
 *
 * Pure. The set is a function of the local date (every phone agrees what
 * today's three are, and a relaunch never reshuffles them), the state is a
 * plain record the save keeps, and a win is a plain event. Progress owns the
 * paying; this file only says what a win moved.
 *
 * Slot one is always today's Daily, because it is the reason to open the game
 * at all. Slot two is a volume goal and slot three a quality goal, each drawn
 * from pools that only offer what this player can actually do: no "clear two
 * new folds" with one fold left, no "beat a best time" without three to beat.
 */

import type { Day } from './Streak';

export type MissionId = 'daily' | 'wins3' | 'new2' | 'clean' | 'medal' | 'best';

export interface MissionState {
  date: Day;
  ids: [MissionId, MissionId, MissionId];
  progress: [number, number, number];
  paid: [boolean, boolean, boolean];
}

/** What the pools may offer: counts of this player's cleared and uncleared levels. */
export interface MissionCtx {
  unclearedCount: number;
  clearedCount: number;
}

/**
 * A win, as missions see it. Every "new" fact — first clear, a best time
 * beaten — is read BEFORE the win is recorded; after it, every clear looks old.
 * `skipped` is the literal false: a skip is not a win and never gets here.
 */
export interface WinEvent {
  daily: boolean;
  todayDailyFirst: boolean;
  firstClear: boolean;
  /** The line earned two stars or more (≤ 1.25× par: Stars.starsFor ≥ 2). */
  medal: boolean;
  deaths: number;
  beatBest: boolean;
  /**
   * The fold the previous win was on, won again (a Retry, or picked again).
   * It is still a win for every other goal — a better line, a better time —
   * but not one more fold toward "Clear 3 folds": one-tap Retry made that
   * mission three wins of the same maze (QA).
   */
  repeat?: boolean;
  skipped: false;
}

export const MISSION_TARGET: Record<MissionId, number> = {
  daily: 1,
  wins3: 3,
  new2: 2,
  clean: 1,
  medal: 1,
  best: 1,
};

/** Which slot each id may fill. Also the strict check a saved record must pass. */
export const MISSION_SLOTS: readonly (readonly MissionId[])[] = [
  ['daily'],
  ['wins3', 'new2'],
  ['clean', 'medal', 'best'],
];

const COPY: Record<MissionId, { full: string; short: string }> = {
  daily: { full: "Fold today's Daily", short: 'Daily' },
  wins3: { full: 'Clear 3 folds', short: '3 folds' },
  new2: { full: 'Clear 2 new folds', short: '2 new' },
  clean: { full: 'Clear a fold without crashing', short: 'No crash' },
  // The id stays 'medal' (saved records name it); what it asks is the same
  // line ≤ 1.25× par, which the player now knows as the second star.
  medal: { full: 'Earn two stars on any fold', short: 'Two stars' },
  best: { full: 'Beat one of your best times', short: 'Best time' },
};

export function missionCopy(id: MissionId): { full: string; short: string } {
  return COPY[id];
}

/** FNV-1a over the date string: stable across engines, spread enough for a pick. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function missionsFor(date: Day, ctx: MissionCtx): MissionState {
  const h = hash(`missions:${date}`);
  const volume: MissionId[] = ctx.unclearedCount >= 2 ? ['wins3', 'new2'] : ['wins3'];
  const quality: MissionId[] = ctx.clearedCount >= 3 ? ['clean', 'medal', 'best'] : ['clean', 'medal'];
  return {
    date,
    ids: ['daily', volume[h % volume.length], quality[(h >>> 8) % quality.length]],
    progress: [0, 0, 0],
    paid: [false, false, false],
  };
}

/** How far one win moves mission `id`. */
function step(id: MissionId, e: WinEvent): number {
  if (id === 'daily') return e.daily && e.todayDailyFirst ? 1 : 0;
  // The pool slots are about the campaign: a Daily win moves none of them.
  if (e.daily) return 0;
  switch (id) {
    case 'wins3':
      return e.repeat ? 0 : 1;
    case 'new2':
      return e.firstClear ? 1 : 0;
    case 'clean':
      return e.deaths === 0 ? 1 : 0;
    case 'medal':
      return e.medal ? 1 : 0;
    case 'best':
      return e.beatBest ? 1 : 0;
  }
}

/**
 * Apply one win. `completed` lists the slots this win finished, each exactly
 * once in the life of the record — a finished slot is marked paid here, so the
 * caller pays for what is in `completed` and nothing else.
 */
export function advanceMissions(
  s: MissionState,
  e: WinEvent
): { state: MissionState; completed: number[] } {
  if (e.skipped) return { state: s, completed: [] };
  const progress = [...s.progress] as MissionState['progress'];
  const paid = [...s.paid] as MissionState['paid'];
  const completed: number[] = [];
  s.ids.forEach((id, i) => {
    if (paid[i]) return;
    const target = MISSION_TARGET[id];
    progress[i] = Math.min(target, progress[i] + step(id, e));
    if (progress[i] >= target) {
      paid[i] = true;
      completed.push(i);
    }
  });
  return { state: { ...s, progress, paid }, completed };
}

/** Whether every slot is finished — the strip's "all three done" state. */
export function allMissionsDone(s: MissionState): boolean {
  return s.paid.every(Boolean);
}
