/**
 * Rescue — which help a stuck player is offered, and where it is drawn.
 *
 * Two rules the Game scene applies after every death, kept here, free of
 * Phaser, so they can be proved rather than only watched.
 *
 * The ladder. Three deaths point at the fold (the reveal offer); six offer
 * the way past (the skip). Currency comes first: a player who can still see
 * the folded walls — a reveal in the stash, or an owner's unlimited ones — and
 * has not looked on this level keeps being offered the look until nine,
 * because a skip bought with an ad before the player has used the tool the
 * economy is built around teaches them to skip. With nothing to spend the
 * skip comes at six, as it always has.
 *
 * The place. The pills used to sit in the runway above the start dot, which
 * is exactly where the last attempt's ghost leaves the dot, and at small
 * scales on the lowest wall row. They go under the dot now, in the band the
 * hint line has above the banner: nothing a maze draws is there. Under the
 * dot's grab zone, not just the dot: a press there starts a stroke, so a
 * pill drawn inside it would be pressed and not answer.
 */

/**
 * The three-death rescue, by what the player can do right now: spend one of
 * their reveals, reveal freely (Remove Ads), watch an ad for one, or open the
 * refill sheet.
 */
export type RevealOfferKind = 'spend' | 'owner' | 'ad' | 'store';

export interface LadderState {
  /** Strokes on this level so far: the counter the offers have always used. */
  readonly attempts: number;
  /** Reveals spent on this level, from the pill, the offer or a refill. */
  readonly revealsUsed: number;
  /** The reveal offer that could be drawn now, or null for none. */
  readonly revealOffer: RevealOfferKind | null;
  /** The Daily: there is nothing to skip to. */
  readonly daily: boolean;
}

export interface LadderRules {
  readonly revealAfter: number;
  readonly skipAfter: number;
  /** The skip comes by here whatever the player still holds. */
  readonly skipAnywayAfter: number;
}

export type RescueOffer = 'reveal' | 'skip' | null;

/**
 * The one offer the ladder wants now. Never both: the caller keeps a skip
 * already drawn, and draws a reveal offer only where no skip is up.
 */
export function rescueOffer(s: LadderState, rules: LadderRules): RescueOffer {
  const canLook = s.revealOffer === 'spend' || s.revealOffer === 'owner';
  const skipDue =
    !s.daily &&
    s.attempts >= rules.skipAfter &&
    (!canLook || s.revealsUsed > 0 || s.attempts >= rules.skipAnywayAfter);
  if (skipDue) return 'skip';
  if (s.attempts >= rules.revealAfter && s.revealOffer !== null) return 'reveal';
  return null;
}

/**
 * Whether the skip pill is drawn free — "Skip this fold" — rather than as
 * "Watch an ad → skip this fold". A new pill promises an ad only where one can
 * play. A pill built again to fit a new place (a resize, a ghost that dipped
 * under the dot) passes what it was drawn saying as `drawn`, and keeps it: the
 * ad SDK coming up meanwhile must not turn a free skip into an ad. Remove Ads
 * turns either free — the owner paid not to be asked.
 */
export function skipDrawnFree(
  drawn: boolean | null,
  rewardedAvailable: boolean,
  adsRemoved: boolean
): boolean {
  if (adsRemoved) return true;
  return drawn ?? !rewardedAvailable;
}

export interface RescueBand {
  /** The start dot's centre, base units. */
  readonly startY: number;
  /** How far from that centre a press starts a stroke: the dot's grab zone. */
  readonly grabRadius: number;
  /** The first base y the native banner may cover. */
  readonly bannerTop: number;
  /** The thumb's floor now: `minTap(scene)`. */
  readonly floor: number;
  /** The pill's designed face height. */
  readonly faceH: number;
  /** The shortest face that still carries its label; below it there is no band. */
  readonly minFaceH: number;
  /** Paper kept between the face and the grab zone above it, and the banner below it. */
  readonly gap: number;
  /**
   * The lowest point of the last attempt's first stretch that lies in the
   * pill's columns, when the stroke dipped below the dot before it turned.
   */
  readonly ghostLow?: number | null;
  /**
   * The board sheet's foot. Where the band between it and the banner holds a
   * face, the face goes there, wholly under the sheet — not straddling its
   * edge (see rescueSpot).
   */
  readonly sheetBottom?: number | null;
}

export interface RescueSpot {
  /** Centre line of the face and of its tap area. */
  readonly y: number;
  /** Painted height. */
  readonly h: number;
  /** Tap height: the floor where the band has room for it, the band where not. */
  readonly tap: number;
}

/**
 * Where a rescue pill goes in the band under the start dot, or null where the
 * band cannot hold a face of `minFaceH` (a Duo shape whose home-indicator
 * inset the canvas does not clear lifts the banner line to within a few
 * points of the grab zone).
 *
 * The band runs from the bottom of the dot's grab zone to the banner line.
 * The face sits in it, a `gap` from each end (and under any ghost that dipped
 * below the dot), shrunk to fit. The TAP area keeps the floor wherever the
 * band has room for it, and gives way to the band where it does not — the
 * same cap rule as every other control built with `maxTap`. On a phone it
 * does not: the band is 34pt, so the face is 26pt and the tap the whole band.
 *
 * Neither reaches into the grab zone. When the band was measured from the
 * dot's painted edge, the top 10pt of the face lay inside it, in the dot's
 * column: a press on the visible "Watch an ad → skip this fold" started a
 * stroke instead — an attempt spent, the pill gone. Nor does the tap reach
 * under the banner, where a thumb aiming for the pill would land on an ad.
 */
export function rescueSpot(b: RescueBand): RescueSpot | null {
  const grabBottom = b.startY + b.grabRadius;
  const under = b.sheetBottom === undefined || b.sheetBottom === null ? null : underSheet(b, b.sheetBottom, grabBottom);
  if (under) return under;
  const faceTop = Math.max(grabBottom, b.ghostLow ?? -Infinity) + b.gap;
  const faceBottom = b.bannerTop - b.gap;
  const room = faceBottom - faceTop;
  if (!(room >= b.minFaceH)) return null;
  const h = Math.min(b.faceH, room);

  // Aim the tap area first — as tall as the floor, as the band allows — then
  // keep the face inside its own band.
  const want = Math.max(h, Math.min(b.floor, b.bannerTop - grabBottom));
  const middle = (faceTop + faceBottom) / 2;
  const aimed = Math.min(Math.max(middle, grabBottom + want / 2), b.bannerTop - want / 2);
  const y = Math.min(Math.max(aimed, faceTop + h / 2), faceBottom - h / 2);
  const tap = Math.max(h, Math.min(b.floor, 2 * Math.min(b.bannerTop - y, y - grabBottom)));
  return { y, h, tap };
}

/**
 * The band under the board sheet, when it holds a face: the pill hugs the
 * sheet's foot, a `gap` under it, shrunk to fit over the banner — the tray's
 * band, which the pill takes while it is up.
 *
 * Measured from the grab zone alone, the band began inside the sheet (every
 * start dot sits near its foot), and the face centred in it straddled the
 * sheet's edge by 20 pt on an 18 Pro (QA). The TAP area may still reach up
 * over the sheet's empty foot margin, as far as the grab zone.
 */
function underSheet(b: RescueBand, sheetBottom: number, grabBottom: number): RescueSpot | null {
  const faceTop = Math.max(sheetBottom, grabBottom, b.ghostLow ?? -Infinity) + b.gap;
  const faceBottom = b.bannerTop - b.gap;
  const room = faceBottom - faceTop;
  if (!(room >= b.minFaceH)) return null;
  const h = Math.min(b.faceH, room);
  const want = Math.max(h, Math.min(b.floor, b.bannerTop - grabBottom));
  const aimed = Math.min(Math.max(faceTop + h / 2, grabBottom + want / 2), b.bannerTop - want / 2);
  const y = Math.min(Math.max(aimed, faceTop + h / 2), faceBottom - h / 2);
  const tap = Math.max(h, Math.min(b.floor, 2 * Math.min(b.bannerTop - y, y - grabBottom)));
  return { y, h, tap };
}

/**
 * The lowest point, within `reach` of arc length from its start, where a
 * stroke lies inside the columns [left, right] — what `rescueSpot` keeps the
 * face under. Null for a stroke that never enters them there.
 */
export function ghostHeadLow(
  points: readonly { readonly x: number; readonly y: number }[],
  reach: number,
  left: number,
  right: number
): number | null {
  let low: number | null = null;
  let travelled = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (travelled > reach) break;
    }
    const p = points[i];
    if (p.x >= left && p.x <= right) low = low === null ? p.y : Math.max(low, p.y);
  }
  return low;
}
