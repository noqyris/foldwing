/**
 * The Missions sheet — today's three, what each pays, and a way straight to
 * the place each one is done.
 *
 * Every unfinished row is a door, not a label: the Daily mission opens the
 * Daily, the campaign ones open Continue, and the medal and best-time ones open
 * Levels at the frontier, where a fold worth replaying is one tap away. A
 * finished row is a record and does nothing.
 *
 * The rows say which is which (QA round 1): they looked alike, finished or
 * not, with centred text beside a mark on the left, and nothing said the open
 * ones could be tapped. Now the text starts beside its mark; an open row is a
 * quiet face with a "›" at its right end; a finished row has no face, recedes
 * to 0.7, and carries the gold check and a gold "done · +1 reveal" — gold on
 * the paper itself, the one ground where `medalText` clears 4.5:1, and at full
 * strength for the same reason.
 *
 * Missions pay on completion, with no claim tap (§1.4), so the sheet only ever
 * reports. Owners have unlimited reveals, so their rows say ✓ rather than a
 * count that means nothing to them.
 *
 * Drawn at depth 70, under the toasts, like the Streak sheet.
 *
 * THE STRIP. The menu shows the same three as a strip (SPEC §5.1, the mock's
 * `.missions`): a 28 pt ring and two short lines each, then the day's gift —
 * what the three still pay, lit once all three have paid. Missions pay on
 * completion, one reveal each; the gift is that sum and nothing more, so it
 * never promises a reward the economy does not give. Owners have unlimited
 * reveals, so they get no gift to count. On the shortest shapes the strip
 * folds into one chip of three small rings in the top row (MenuLayout).
 */

import Phaser from 'phaser';
import { MISSION_TARGET, missionCopy, type MissionId, type MissionState } from '../core/Missions';
import { monetization } from '../config/monetization';
import { panel } from './Baked';
import { drawIcon, icon } from './Icons';
import { sheetBottomLimit, SHEET_TOP_LIMIT } from './StoreSheet';
import { BASE_WIDTH, dp, ms, pt, theme, ui, viewHeight } from './Theme';
import {
  button,
  buttonSubAlpha,
  cardBlocker,
  checkGlyph,
  dismissOnScrim,
  FONT,
  glassPanel,
  keepCentred,
  type Glyph,
  label,
  mainCameraOnly,
  RADIUS,
  scrim,
  sheetPanel,
  shieldInput,
  TYPE,
} from './UI';

export type MissionRoute = 'daily' | 'continue' | 'levels';

/**
 * The menu's toast for missions paid while the player was elsewhere — named
 * where it can only be one: "Mission done · fold today's Daily · +1 reveal".
 * A bare "Mission done" on launch had no referent. `count` missions were
 * paid; the name is read off today's record when exactly one slot there is
 * paid, which is the case the menu meets (a Daily folded before the day's
 * record was written). Anything less certain keeps the plain line.
 */
export function missionDoneLine(state: MissionState | null, count: number): string {
  const r = monetization.economy.missions.reward * count;
  const pays = `+${r} ${r === 1 ? 'reveal' : 'reveals'}`;
  if (count !== 1) return `${count} missions done · ${pays}`;
  const paid = state ? state.ids.filter((_, i) => state.paid[i] === true) : [];
  if (paid.length !== 1) return `Mission done · ${pays}`;
  const full = missionCopy(paid[0]).full;
  return `Mission done · ${full.charAt(0).toLowerCase()}${full.slice(1)} · ${pays}`;
}

/** Where a mission is done: the Daily, the next campaign fold, or the level grid. */
export function missionRoute(id: MissionId): MissionRoute {
  switch (id) {
    case 'daily':
      return 'daily';
    case 'wins3':
    case 'new2':
    case 'clean':
      return 'continue';
    case 'medal':
    case 'best':
      return 'levels';
  }
}

export interface MissionRow {
  readonly id: MissionId;
  readonly text: string;
  readonly sub: string;
  readonly done: boolean;
  readonly progress: number;
  readonly target: number;
}

/** The three rows, in slot order. Pure. */
export function missionRows(s: MissionState, owner: boolean): MissionRow[] {
  const reward = monetization.economy.missions.reward;
  const pays = `+${reward} ${reward === 1 ? 'reveal' : 'reveals'}`;
  return s.ids.map((id, i) => {
    const target = MISSION_TARGET[id];
    // The save is sanitised on load; this is drawn straight from it anyway.
    const raw = Number.isFinite(s.progress[i]) ? Math.trunc(s.progress[i]) : 0;
    const done = s.paid[i] === true || raw >= target;
    const progress = done ? target : Math.min(target, Math.max(0, raw));
    const sub = owner
      ? done
        ? 'done ✓'
        : `${progress}/${target}`
      : done
        ? `done · ${pays}`
        : `${progress}/${target} · ${pays}`;
    return { id, text: missionCopy(id).full, sub, done, progress, target };
  });
}

/**
 * How a row is drawn — the decision, apart from the drawing. Open: the quiet
 * face, a "›", tappable. Done: no face, the title at 0.7, the gold check and
 * the gold line at full strength (see the header), not tappable.
 */
export interface MissionRowStyle {
  readonly face: boolean;
  readonly chevron: boolean;
  readonly tappable: boolean;
  /** Alpha of the row's title. */
  readonly alpha: number;
  /** The second line: gold for a done row, else the ink of a button's second line. */
  readonly sub: { readonly gold: boolean; readonly alpha: number };
}

export function missionRowStyle(r: Pick<MissionRow, 'done'>): MissionRowStyle {
  return r.done
    ? { face: false, chevron: false, tappable: false, alpha: 0.7, sub: { gold: true, alpha: 1 } }
    : { face: true, chevron: true, tappable: true, alpha: 1, sub: { gold: false, alpha: buttonSubAlpha('secondary') } };
}

/** Where a row's text starts, from its left edge: the mark's centre and pt(14). */
export const MISSION_MARK_X = pt(24);
export const MISSION_TEXT_X = MISSION_MARK_X + pt(14);

/**
 * A mission's mark: a ring that fills with its progress, and a disc with a
 * check once it is done. Takes the caller's colour for the progress, so it
 * reads the same on a row and on the menu's strip. `r` is the ring's radius
 * and `stroke` its weight (the strip's is the mock's 10.5 pt and 3 pt).
 */
export function missionRing(frac: number, done: boolean, r = pt(6.5), stroke = pt(1.8)): Glyph {
  return (g, x, y, color, alpha) => {
    const u = ui();
    if (done) {
      g.fillStyle(color, alpha);
      g.fillCircle(x, y, r + stroke / 2);
      drawIcon(g, 'check', x, y, r * 1.45, u.onAccent, alpha, 2.8);
      return;
    }
    g.lineStyle(stroke, u.text, 0.12 * alpha);
    g.strokeCircle(x, y, r);
    const f = Math.min(1, Math.max(0, frac));
    if (f > 0) {
      const start = -Math.PI / 2;
      g.lineStyle(stroke, color, alpha);
      g.beginPath();
      g.arc(x, y, r, start, start + f * Math.PI * 2, false);
      g.strokePath();
      // The arc's round ends, as the mock's stroke-linecap: a disc at each.
      g.fillStyle(color, alpha);
      g.fillCircle(x, y - r, stroke / 2);
      const a = start + f * Math.PI * 2;
      g.fillCircle(x + Math.cos(a) * r, y + Math.sin(a) * r, stroke / 2);
    }
  };
}

/* ------------------------------------------------------------- the strip */

/** One mission on the menu's strip: its short name, and how it stands. */
export interface StripItem {
  readonly id: MissionId;
  readonly label: string;
  /** "not yet", "1 of 2", "done". */
  readonly sub: string;
  readonly frac: number;
  readonly done: boolean;
}

/** The day's gift: what the three still pay ("+2"), lit with the day's whole pay once all have paid. */
export interface StripGift {
  readonly text: string;
  readonly lit: boolean;
}

/** The strip's three items and its gift (null for owners, who have no count to add to). Pure. */
export function missionStrip(s: MissionState, owner: boolean): { items: StripItem[]; gift: StripGift | null } {
  const rows = missionRows(s, owner);
  const items = rows.map((r) => ({
    id: r.id,
    label: missionCopy(r.id).short,
    sub: r.done ? 'done' : r.progress === 0 && r.target === 1 ? 'not yet' : `${r.progress} of ${r.target}`,
    frac: r.target > 0 ? r.progress / r.target : 0,
    done: r.done,
  }));
  if (owner) return { items, gift: null };
  const reward = monetization.economy.missions.reward;
  const open = items.filter((i) => !i.done).length;
  const lit = open === 0;
  return { items, gift: { text: `+${(lit ? items.length : open) * reward}`, lit } };
}

/** The strip's ring: the mock's 28 pt box, a 10.5 pt radius drawn 3 pt wide. */
const STRIP_RING_R = dp(10.5);
const STRIP_RING_W = dp(3);
const GIFT = { w: dp(52), h: dp(40) } as const;

export interface MissionStrip {
  readonly container: Phaser.GameObjects.Container;
  /**
   * Fill the rings from what the menu last showed to what is true now
   * (500 ms, SPEC §5.1's return beat). A no-op for rings that have not moved;
   * under reduced motion they are simply where they end.
   */
  fillFrom(progress: readonly number[]): void;
}

/**
 * The menu's missions strip, centred on (x, y): one glass button, `w` × `h`,
 * that opens the Missions sheet. Three rings with their names, then the gift.
 */
export function drawMissionStrip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  s: MissionState,
  owner: boolean,
  onPress: () => void,
  maxTap: number
): MissionStrip {
  const t = theme();
  const u = ui();
  const { items, gift } = missionStrip(s, owner);
  const strip = button(scene, x, y, '', { width: w, height: h, variant: 'ghost', minTap: true, maxTap, onPress });
  strip.setName('mission-strip');
  strip.addAt(glassPanel(scene, 0, 0, w, h, 'e1', dp(18)), 0);

  const padL = dp(14);
  const padR = dp(8);
  const giftW = gift ? GIFT.w + dp(4) : 0;
  const cell = (w - padL - padR - giftW) / items.length;
  const ringBox = STRIP_RING_R * 2 + STRIP_RING_W;
  const rings: { g: Phaser.GameObjects.Graphics; x: number; item: StripItem }[] = [];
  items.forEach((item, i) => {
    const x0 = -w / 2 + padL + cell * i;
    const g = scene.add.graphics();
    const rx = x0 + ringBox / 2;
    missionRing(item.frac, item.done, STRIP_RING_R, STRIP_RING_W)(g, rx, 0, u.done, 1);
    rings.push({ g, x: rx, item });
    const textX = x0 + ringBox + dp(7);
    const room = cell - ringBox - dp(9);
    const name = label(scene, textX, -dp(8), item.label, {
      size: dp(12.5),
      weight: 600,
      color: item.done ? u.text2 : u.text,
    }).setOrigin(0, 0.5);
    const sub = label(scene, textX, dp(9), item.sub, { size: dp(11), weight: 500, color: u.text3 }).setOrigin(0, 0.5);
    for (const text of [name, sub]) if (text.width > room) text.setScale(room / text.width);
    strip.add([g, name, sub]);
  });

  if (gift) {
    const gx = w / 2 - padR - GIFT.w / 2;
    // Lit: the full accent, the reward in; else a wash, the reward still to come.
    strip.add(
      panel(scene, gift.lit ? 'mission-gift-lit' : 'mission-gift', gx, 0, GIFT.w, GIFT.h, {
        radius: dp(12),
        face: { kind: 'solid', color: t.accent, alpha: gift.lit ? 1 : 0.12 },
        ...(gift.lit ? { glow: { color: t.accent, alpha: 0.45, blur: dp(12), dy: dp(3) } } : {}),
      })
    );
    const ink = gift.lit ? u.onAccent : t.accentText;
    strip.add(icon(scene, gx, -dp(7), 'gift', { size: dp(17), color: ink }));
    strip.add(label(scene, gx, dp(10), gift.text, { size: dp(10.5), weight: 700, color: ink }).setOrigin(0.5));
  }

  return {
    container: strip,
    fillFrom(progress) {
      rings.forEach((r, i) => {
        const target = MISSION_TARGET[r.item.id];
        const from = Number.isFinite(progress[i]) ? Math.min(1, Math.max(0, progress[i] / target)) : r.item.frac;
        if (from >= r.item.frac || !r.g.scene) return;
        const clock = { f: from };
        const paint = (f: number, done: boolean): void => {
          r.g.clear();
          missionRing(f, done, STRIP_RING_R, STRIP_RING_W)(r.g, r.x, 0, u.done, 1);
        };
        paint(from, false);
        scene.tweens.add({
          targets: clock,
          f: r.item.frac,
          duration: ms(500),
          ease: 'Cubic.easeOut',
          onUpdate: () => {
            if (r.g.scene) paint(clock.f, false);
          },
          onComplete: () => {
            if (r.g.scene) paint(r.item.frac, r.item.done);
          },
        });
      });
    },
  };
}

/**
 * The strip folded into the top row (MenuLayout step 4): three small rings on
 * one glass chip, `h` tall, centred on (x, y). The same door to the sheet.
 */
export function drawMissionChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  h: number,
  s: MissionState,
  onPress: () => void,
  maxTap: number
): Phaser.GameObjects.Container {
  const u = ui();
  const { items } = missionStrip(s, true);
  const r = dp(7);
  const stroke = dp(2.2);
  const step = r * 2 + dp(8);
  const w = dp(12) * 2 + step * (items.length - 1) + r * 2 + stroke;
  const chip = button(scene, x, y, '', { width: w, height: h, variant: 'ghost', minTap: true, maxTap, onPress });
  chip.setName('mission-chip');
  chip.addAt(glassPanel(scene, 0, 0, w, h, 'e1', h / 2), 0);
  const g = scene.add.graphics();
  items.forEach((item, i) => {
    missionRing(item.frac, item.done, r, stroke)(g, -w / 2 + dp(12) + r + stroke / 2 + step * i, 0, u.done, 1);
  });
  chip.add(g);
  return chip;
}

export interface MissionsSheetOptions {
  readonly state: MissionState;
  readonly owner: boolean;
  /** An unfinished row was tapped: take the player where it is done. */
  readonly onRoute: (route: MissionRoute) => void;
  readonly onClose: () => void;
  readonly stillOpen: (sheet: Phaser.GameObjects.Container) => boolean;
}

const DEPTH = 70;
const CW = pt(300);
const ROW_W = CW - pt(30);
const ROW_H = pt(56);
const GAP = pt(9);
const PAD_TOP = pt(18);
const PAD_BOTTOM = pt(10);
const CLOSE_H = pt(44);

export function showMissionsSheet(scene: Phaser.Scene, o: MissionsSheetOptions): Phaser.GameObjects.Container {
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

  // The night's scrim, the page's bands dimmed with it (UI.scrim).
  const back = scrim(scene, BASE_WIDTH / 2, builtH / 2);
  dismissOnScrim(back, close);
  sheet.add(back);

  const rows = missionRows(o.state, o.owner);

  let y = PAD_TOP;
  const titleY = y + pt(14);
  y += pt(28) + pt(14);
  const rowYs = rows.map(() => {
    const c = y + ROW_H / 2;
    y += ROW_H + GAP;
    return c;
  });
  y += pt(4);
  const footY = y + pt(8);
  y += pt(16) + pt(8);
  const closeY = y + CLOSE_H / 2;
  y += CLOSE_H + PAD_BOTTOM;
  const height = y;

  const band = sheetBottomLimit(builtH) - SHEET_TOP_LIMIT;
  const top = SHEET_TOP_LIMIT + Math.max(0, (band - height) / 2);
  const cx = BASE_WIDTH / 2;
  const at = (v: number): number => top + v;

  sheet.add([sheetPanel(scene, cx, top + height / 2, CW, height, RADIUS.lg), cardBlocker(scene, cx, top + height / 2, CW, height)]);

  sheet.add(
    label(scene, cx - ROW_W / 2 + pt(3), at(titleY), "Today's three", {
      size: TYPE.heading,
      font: FONT.display,
      color: u.text,
    }).setOrigin(0, 0.5)
  );

  rows.forEach((r, i) => {
    const style = missionRowStyle(r);
    const row = button(scene, cx, at(rowYs[i]), '', {
      width: ROW_W,
      height: ROW_H,
      // A done row has no face: its gold line needs the paper under it.
      variant: style.face ? 'secondary' : 'ghost',
      minTap: true,
      // A point short of half the gap each side, so neighbours never share a spot.
      maxTap: ROW_H + GAP - pt(1),
      onPress: () => {
        if (r.done) return;
        shieldInput(scene);
        o.onRoute(missionRoute(r.id));
      },
    });
    // A finished row is a record, not a door.
    if (!style.tappable) row.disableInteractive();

    const left = -ROW_W / 2;
    const mark = scene.add.graphics();
    if (r.done) checkGlyph(mark, left + MISSION_MARK_X, 0, t.medal, 1);
    else missionRing(r.target > 0 ? r.progress / r.target : 0, false)(mark, left + MISSION_MARK_X, 0, t.accent, 1);
    // The text starts beside its mark; the chevron keeps its own room at the right.
    const room = ROW_W - MISSION_TEXT_X - (style.chevron ? pt(30) : pt(16));
    const title = label(scene, left + MISSION_TEXT_X, -pt(9), r.text, {
      size: TYPE.label,
      font: FONT.ui,
      weight: 600,
      alpha: 0.94 * style.alpha,
    }).setOrigin(0, 0.5);
    const sub = label(scene, left + MISSION_TEXT_X, pt(11), r.sub, {
      size: TYPE.label,
      weight: 500,
      color: style.sub.gold ? t.medalText : t.ink,
      alpha: style.sub.alpha,
    }).setOrigin(0, 0.5);
    for (const text of [title, sub]) if (text.width > room) text.setScale(room / text.width);
    row.add([mark, title, sub]);
    if (style.chevron) {
      row.add(icon(scene, ROW_W / 2 - pt(16), 0, 'arrow', { size: dp(16), color: u.text2 }));
    }
    sheet.add(row);
  });

  sheet.add(
    label(scene, cx, at(footY), 'new missions at midnight', { size: TYPE.micro, color: u.text3 }).setOrigin(0.5)
  );
  sheet.add(
    button(scene, cx, at(closeY), 'Close', {
      width: pt(140),
      height: CLOSE_H,
      variant: 'ghost',
      size: TYPE.label,
      minTap: true,
      maxTap: CLOSE_H + 2 * Math.min(pt(6), PAD_BOTTOM) - pt(1),
      onPress: close,
    })
  );
  return sheet;
}
