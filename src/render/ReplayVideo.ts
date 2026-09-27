/**
 * ReplayVideo — the whole run through a level, as a shareable MP4.
 *
 * NOT a screen recording. The game already stores every stroke as points and
 * the milliseconds they were sampled at, which is not a recording of a run —
 * it IS the run. So the video is reconstructed rather than captured, and that
 * is better on every axis that matters here:
 *
 *   - no permission prompt, where ReplayKit asks for one
 *   - no HUD, no banner, no status bar, no notch in the frame
 *   - 1080×1920 whatever the phone's screen happens to be
 *   - rendered faster than real time instead of taking the run's own length
 *   - the same run always produces the same file
 *
 * WHAT IS IN IT. The failed attempts, then the line that worked. A player who
 * dies six times and then threads it has a story, and the deaths are also the
 * only way a stranger learns the rule: the line that kills you is the one on
 * the other side of the fold. A clip of the solution alone teaches nobody why
 * it was hard.
 *
 * H.264 in MP4, because that is what every platform's composer accepts —
 * TikTok, Instagram, WhatsApp, Messages, everything the share sheet knows.
 * Encoded with WebCodecs, which reaches VideoToolbox, so the phone's hardware
 * encoder does the work.
 */

import type { Vec2 } from '../core/Geometry';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { SavedFigure } from '../systems/Progress';
import { layoutFigureCard, strokeUpTo, type CardLayout } from './FigureCard';
import { DEFAULT_RIBBON, ribbonSlice } from '../core/Ribbon';
import {
  CARD_MAZE_HEIGHT,
  CARD_SIZE,
  cssRgba,
  fillRibbon,
  GLOW_RES,
  laySky,
  lineLook,
  mirrorLook,
  paintBloomMax,
  paintBoard,
  paintFigureFill,
  paintFigureGlow,
  paintInk,
  paintLockup,
  scaleWidths,
  strokeWidths,
} from './ShareCard';
import { drawInAt, DRAW_IN } from './Logo';
import { BASE_HEIGHT, BASE_WIDTH, FONT_DISPLAY, METRICS, theme, ui } from './Theme';
import { Playfield } from '../core/Playfield';
import { mirrorBands, obstacleRows, rowCrossings } from '../core/Gates';
import {
  noteHz,
  scheduleChime,
  scheduleNote,
  schedulePenStroke,
  scheduleTear,
  scheduleThud,
  scheduleTone,
} from '../systems/Audio';

/** One stroke the player made on a level: where it went, when, and how it ended. */
export interface RunAttempt {
  /** Normalized playfield coordinates, x < 0.5. */
  readonly points: readonly Vec2[];
  /** Milliseconds from this attempt's first sample, parallel to `points`. */
  readonly times: readonly number[];
  readonly died: boolean;
}

/**
 * How many attempts the replay is built from, newest kept.
 *
 * A level someone is genuinely stuck on runs to dozens. Five deaths already
 * tell the story — past that the clip stops being a story and becomes a list,
 * and every extra one is seconds of watching somebody else lose.
 */
export const MAX_REPLAY_ATTEMPTS = 6;

/* ------------------------------------------------------------------ timing */

const FPS = 30;

/** The board alone, before anything moves. Lets the eye find the maze. */
const INTRO_MS = 450;
/**
 * Failures play FAST. They are context, not the subject, and a clip that spends
 * eight seconds on other people's mistakes is a clip nobody finishes.
 */
const FAIL_SPEED = 2.2;
const FAIL_MAX_MS = 1100;
/** The red flash, and the beat of empty board after it. */
const FLASH_MS = 200;
const CLEAR_MS = 90;

/**
 * The winning line plays at the speed it was actually drawn — that is the whole
 * point of keeping the times — but bounded at both ends. Under a second is a
 * flicker nobody can read; over eight is a clip people scroll past.
 */
const WIN_MIN_MS = 1200;
const WIN_MAX_MS = 8000;

/** The mirror closing into the figure, and the fill arriving. */
const SETTLE_MS = 700;
/**
 * The outro, staged rather than faded up as one block.
 *
 * This is the part a stranger sees last and remembers, so it is the part that
 * has to be made rather than merely displayed. It arrives in the order the eye
 * should read it — what this was and how fast, then the mark, then the dare —
 * and the mark does not fade in: it DRAWS. The word and the mark's dots set,
 * then the line runs out of its dot and its reflection follows across the
 * fold, which is the logo performing the mechanic in three quarters of a
 * second.
 *
 * The dare lands last and holds alone. It is the only line asking for anything.
 */
const OUTRO_CAPTION_MS = 420;
const OUTRO_MARK_MS = 380;
const OUTRO_FOLD_MS = 620;
const OUTRO_CHALLENGE_MS = 420;
const OUTRO_HOLD_MS = 1500;
const OUTRO_MS =
  OUTRO_CAPTION_MS + OUTRO_MARK_MS + OUTRO_FOLD_MS + OUTRO_CHALLENGE_MS + OUTRO_HOLD_MS;

/** How far the closing sequence has got, one number per element. */
export interface OutroStage {
  readonly caption: number;
  readonly mark: number;
  /** 0 dots only, 1 the mark fully drawn: the line and its reflection running out (Logo.drawInAt). */
  readonly fold: number;
  readonly challenge: number;
}

const NO_OUTRO: OutroStage = { caption: 0, mark: 0, fold: 0, challenge: 0 };

const ease = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return 1 - (1 - k) * (1 - k);
};

/** Where the closing sequence stands `ms` into the outro. */
export function outroStage(ms: number): OutroStage {
  let at = 0;
  const caption = ease((ms - at) / OUTRO_CAPTION_MS);
  at += OUTRO_CAPTION_MS;
  const mark = ease((ms - at) / OUTRO_MARK_MS);
  at += OUTRO_MARK_MS;
  const fold = ease((ms - at) / OUTRO_FOLD_MS);
  at += OUTRO_FOLD_MS;
  const challenge = ease((ms - at) / OUTRO_CHALLENGE_MS);
  return { caption, mark, fold, challenge };
}

/* --------------------------------------------------------------- capability */

interface VideoEncoderCtor {
  new (init: {
    output: (chunk: unknown, meta?: unknown) => void;
    error: (e: unknown) => void;
  }): {
    configure: (c: unknown) => void;
    encode: (frame: unknown, opts?: { keyFrame?: boolean }) => void;
    flush: () => Promise<void>;
    close: () => void;
    readonly encodeQueueSize: number;
  };
  isConfigSupported?: (c: unknown) => Promise<{ supported?: boolean }>;
}

interface VideoFrameCtor {
  new (
    source: CanvasImageSource,
    init: { timestamp: number; duration?: number }
  ): { close: () => void };
}

const encoderCtor = (): VideoEncoderCtor | undefined =>
  (globalThis as unknown as { VideoEncoder?: VideoEncoderCtor }).VideoEncoder;

const frameCtor = (): VideoFrameCtor | undefined =>
  (globalThis as unknown as { VideoFrame?: VideoFrameCtor }).VideoFrame;

/**
 * Whether this device can produce the video at all.
 *
 * Safari shipped the WebCodecs VIDEO interfaces — which is all this needs, the
 * clip being silent — in 16.4, and the rest of the API in 26. Older phones, and
 * any browser without it, get no replay button rather than a button that fails
 * after they tap it.
 */
export function replayVideoSupported(): boolean {
  return typeof encoderCtor() === 'function' && typeof frameCtor() === 'function';
}

/* ----------------------------------------------------------------- timeline */

interface Phase {
  /** Which attempt is being drawn, or null for the board-only phases. */
  readonly attempt: number | null;
  readonly kind: 'intro' | 'draw' | 'flash' | 'clear' | 'settle' | 'outro';
  readonly startMs: number;
  readonly durationMs: number;
  /** Real milliseconds of the attempt covered per millisecond of video. */
  readonly speed: number;
}

/**
 * Lay the clip out in time before drawing a single pixel.
 *
 * Separated from the rendering so the arithmetic — which is all of the pacing
 * decisions — can be read, and tested, without a canvas.
 */
export function buildTimeline(attempts: readonly RunAttempt[]): Phase[] {
  const phases: Phase[] = [];
  let at = INTRO_MS;
  phases.push({ attempt: null, kind: 'intro', startMs: 0, durationMs: INTRO_MS, speed: 1 });

  attempts.forEach((attempt, i) => {
    const real = attempt.times[attempt.times.length - 1] ?? 0;
    const last = i === attempts.length - 1;

    if (last && !attempt.died) {
      const durationMs = Math.min(WIN_MAX_MS, Math.max(WIN_MIN_MS, real));
      phases.push({ attempt: i, kind: 'draw', startMs: at, durationMs, speed: real / durationMs });
      at += durationMs;
      phases.push({ attempt: i, kind: 'settle', startMs: at, durationMs: SETTLE_MS, speed: 0 });
      at += SETTLE_MS;
      return;
    }

    const durationMs = Math.max(220, Math.min(FAIL_MAX_MS, real / FAIL_SPEED));
    phases.push({ attempt: i, kind: 'draw', startMs: at, durationMs, speed: real / durationMs });
    at += durationMs;
    phases.push({ attempt: i, kind: 'flash', startMs: at, durationMs: FLASH_MS, speed: 0 });
    at += FLASH_MS;
    phases.push({ attempt: i, kind: 'clear', startMs: at, durationMs: CLEAR_MS, speed: 0 });
    at += CLEAR_MS;
  });

  phases.push({ attempt: null, kind: 'outro', startMs: at, durationMs: OUTRO_MS, speed: 0 });
  return phases;
}

export const timelineDurationMs = (phases: readonly Phase[]): number => {
  const last = phases[phases.length - 1];
  return last ? last.startMs + last.durationMs : 0;
};

/* ------------------------------------------------------------------ drawing */

/** A figure standing in for one attempt, so the shared layout can place it. */
function asFigure(base: SavedFigure, attempt: RunAttempt): SavedFigure {
  return { ...base, points: attempt.points, times: attempt.times };
}

/**
 * Everything in the clip that never moves — the night sky and the board, its
 * sheet, walls and markers — painted ONCE per video (tech G11). Painting the
 * sky's gradient, its stars and the board's blurred shadow again for every
 * one of a few hundred frames was the one cost that grew with the clip's
 * length and nothing else, and the render has a ceiling (REPLAY_CEILING_MS).
 * Null when no second canvas can be had; the frames then paint it themselves.
 */
function bakeBackdrop(width: number, height: number, board: CardLayout): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  laySky(ctx, width, height);
  paintBoard(ctx, board);
  return canvas;
}

/** A canvas of w × h, or null. */
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

/**
 * How many samples behind the head a growing line's ribbon can still change
 * between frames: its end taper and its width smoothing. Everything before is
 * final, so a frame repaints only this tail (and one spare).
 */
export const MOVING_TAIL = DEFAULT_RIBBON.taperPoints + DEFAULT_RIBBON.smoothPasses + 2;

/**
 * What every frame draws with, made once per video: the baked backdrop, and
 * the ink so far kept between frames — the line and its moonlight on one
 * canvas, the bloom's MAX map on another at half resolution — so a frame
 * paints only what moved (MOVING_TAIL), not the whole line again. The
 * finished figure is painted once too. That is what keeps a long line under
 * REPLAY_CEILING_MS: level 300 repainted whole took most of the ceiling.
 */
class FrameKit {
  readonly backdrop: HTMLCanvasElement | null;
  private readonly ink: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null;
  /**
   * The hot core, on its own canvas over the line's: a repaint of the line's
   * moving tail throws its round joints back over the samples before it, and
   * on one canvas that punched the core out behind every frame's tail — a
   * dotted core down the whole line.
   */
  private readonly core: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null;
  private readonly glow: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null;
  /** Which attempt and phase the kept ink belongs to, and how much of it is final. */
  private owner = '';
  private painted = 0;
  private figure: { fill: HTMLCanvasElement; lines: HTMLCanvasElement; glow: HTMLCanvasElement } | null = null;
  private figureOf: CardLayout | null = null;

  constructor(
    private readonly width: number,
    private readonly height: number,
    board: CardLayout
  ) {
    this.backdrop = bakeBackdrop(width, height, board);
    this.ink = makeCanvas(width, height);
    this.core = makeCanvas(width, height);
    this.glow = makeCanvas(width * GLOW_RES, height * GLOW_RES);
  }

  /** Start keeping ink for `owner`, clearing whatever was kept for another. */
  private own(owner: string): boolean {
    if (this.owner === owner) return false;
    this.owner = owner;
    this.painted = 0;
    this.ink?.ctx.clearRect(0, 0, this.width, this.height);
    this.core?.ctx.clearRect(0, 0, this.width, this.height);
    if (this.glow) {
      this.glow.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.glow.ctx.clearRect(0, 0, this.glow.canvas.width, this.glow.canvas.height);
    }
    return true;
  }

  /**
   * Bring the kept ink up to `stroke` (and its reflection) in `color`: only
   * samples from MOVING_TAIL before the last frame's end are painted.
   */
  grow(owner: string, stroke: { points: readonly Vec2[] }, mirrored: { points: readonly Vec2[] }, widths: readonly number[], color: number, mirrorAlpha = 1): void {
    this.own(owner);
    const n = stroke.points.length;
    const from = Math.max(0, this.painted - MOVING_TAIL);
    if (n <= from) return;
    const look = lineLook(color);
    const ink = this.ink?.ctx;
    if (ink) {
      ink.fillStyle = cssRgba(mirrorLook(color === theme().line ? undefined : color).color, mirrorAlpha);
      fillRibbon(ink, ribbonSlice(mirrored.points, widths, from, n));
      ink.fillStyle = cssRgba(look.color, 1);
      fillRibbon(ink, ribbonSlice(stroke.points, widths, from, n));
    }
    const core = this.core?.ctx;
    if (core && look.core !== null) {
      core.fillStyle = cssRgba(look.core, 1);
      fillRibbon(core, ribbonSlice(stroke.points, scaleWidths(widths, look.coreWidth), from, n));
    }
    const g = this.glow?.ctx;
    if (g) {
      g.setTransform(GLOW_RES, 0, 0, GLOW_RES, 0, 0);
      paintBloomMax(g, stroke.points, widths, color, from, n);
    }
    this.painted = n;
  }

  /** Lay the kept ink over the frame: the bloom (screened), then the line and its moonlight. */
  show(ctx: CanvasRenderingContext2D, alpha = 1): void {
    if (!(alpha > 0)) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (this.glow) {
      ctx.globalCompositeOperation = 'screen';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.glow.canvas, 0, 0, this.width, this.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.ink) ctx.drawImage(this.ink.canvas, 0, 0);
    if (this.core) ctx.drawImage(this.core.canvas, 0, 0);
    ctx.restore();
  }

  /** The finished figure, painted once: its bloom and fill, then its line and moonlight. */
  paintFigure(ctx: CanvasRenderingContext2D, layout: CardLayout, k: number): void {
    if (this.figureOf !== layout || !this.figure) {
      const fill = makeCanvas(this.width, this.height);
      const lines = makeCanvas(this.width, this.height);
      const glow = makeCanvas(this.width * GLOW_RES, this.height * GLOW_RES);
      if (!fill || !lines || !glow) {
        paintClosedDirect(ctx, layout, k);
        return;
      }
      paintFigureGlow(fill.ctx, layout.outline);
      paintFigureFill(fill.ctx, layout.outline, layout.scale);
      const widths = strokeWidths(layout.stroke, layout.nib);
      paintInk(lines.ctx, layout.mirrored.points, widths, mirrorLook(), null);
      paintInk(lines.ctx, layout.stroke.points, widths, lineLook(), null);
      glow.ctx.setTransform(GLOW_RES, 0, 0, GLOW_RES, 0, 0);
      paintBloomMax(glow.ctx, layout.stroke.points, widths, theme().line);
      this.figure = { fill: fill.canvas, lines: lines.canvas, glow: glow.canvas };
      this.figureOf = layout;
    }
    const f = this.figure;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.drawImage(f.fill, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'screen';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(f.glow, 0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(f.lines, 0, 0);
    ctx.restore();
  }
}

/** The figure straight onto the frame, for a device that would not give a second canvas. */
function paintClosedDirect(ctx: CanvasRenderingContext2D, layout: CardLayout, k: number): void {
  paintFigureGlow(ctx, layout.outline, k);
  paintFigureFill(ctx, layout.outline, layout.scale, k);
  const widths = strokeWidths(layout.stroke, layout.nib);
  paintInk(ctx, layout.mirrored.points, widths, mirrorLook(), null);
  paintInk(ctx, layout.stroke.points, widths, lineLook(), null);
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  board: CardLayout,
  layouts: readonly (CardLayout | null)[],
  attempts: readonly RunAttempt[],
  phase: Phase,
  intoPhaseMs: number,
  footer: (stage: OutroStage) => void,
  kit: FrameKit
): void {
  const t = theme();
  if (kit.backdrop) {
    ctx.drawImage(kit.backdrop, 0, 0);
  } else {
    laySky(ctx, width, height);
    paintBoard(ctx, board);
  }

  /*
   * How many earlier attempts have left a mark. During the intro that is none —
   * the board has to open clean, or the clip gives away the whole run in its
   * first frame. During the outro it is all of them: by then the near-misses
   * are the record of how hard this was, and by the last attempt they draw
   * the shape of the corridor the player finally found — the same ghost the
   * game itself leaves after a death, for the same reason.
   */
  const upTo = phase.attempt ?? (phase.kind === 'intro' ? 0 : attempts.length);
  for (let i = 0; i < upTo; i++) {
    const layout = layouts[i];
    if (!layout || !attempts[i].died) continue;
    ghost(ctx, layout, t.ink, 0.16);
  }

  const active = phase.attempt;
  const layout = active === null ? null : layouts[active];
  if (!layout) {
    const last = layouts[attempts.length - 1];
    if (phase.kind === 'outro' && last) {
      kit.paintFigure(ctx, last, 1);
      footer(NO_OUTRO);
    }
    return;
  }

  if (phase.kind === 'draw') {
    // The line as far as the hand had got, its head tapering as it did live.
    const stroke = strokeUpTo(layout.stroke, intoPhaseMs * phase.speed);
    const mirrored = strokeUpTo(layout.mirrored, intoPhaseMs * phase.speed);
    kit.grow(`draw:${active}`, stroke, mirrored, strokeWidths(stroke, layout.nib), t.line);
    kit.show(ctx);
    return;
  }

  if (phase.kind === 'flash' || phase.kind === 'clear') {
    // The whole attempt, in the fail colour, fading out — the game's own 400ms
    // of red, compressed to the length this clip can afford. Painted once,
    // at the flash, and faded as a whole.
    const fade = phase.kind === 'flash' ? 1 : 1 - intoPhaseMs / Math.max(1, phase.durationMs);
    kit.grow(`fail:${active}`, layout.stroke, layout.mirrored, strokeWidths(layout.stroke, layout.nib), t.fail, 0.45);
    kit.show(ctx, fade);
    return;
  }

  if (phase.kind === 'settle') {
    const k = Math.min(1, intoPhaseMs / Math.max(1, phase.durationMs));
    kit.paintFigure(ctx, layout, k);
    footer(NO_OUTRO);
  }
}

function ghost(
  ctx: CanvasRenderingContext2D,
  layout: CardLayout,
  ink: number,
  alpha: number
): void {
  const pts = layout.stroke.points;
  if (pts.length < 2) return;
  ctx.strokeStyle = cssRgba(ink, alpha);
  ctx.lineWidth = Math.max(1, layout.nib * 0.22);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/* -------------------------------------------------------------- soundtrack */

interface AudioCtorLike {
  new (
    channels: number,
    length: number,
    sampleRate: number
  ): BaseAudioContext & {
    destination: AudioDestinationNode;
    startRendering: () => Promise<AudioBuffer>;
  };
}

const offlineCtor = (): AudioCtorLike | undefined =>
  (globalThis as unknown as { OfflineAudioContext?: AudioCtorLike }).OfflineAudioContext;

const audioEncoderCtor = (): VideoEncoderCtor | undefined =>
  (globalThis as unknown as { AudioEncoder?: VideoEncoderCtor }).AudioEncoder;

interface AudioDataCtor {
  new (init: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: Float32Array;
  }): { close: () => void };
}

const audioDataCtor = (): AudioDataCtor | undefined =>
  (globalThis as unknown as { AudioData?: AudioDataCtor }).AudioData;

export const SOUND_RATE = 44100;

/*
 * DEADLINES. Every await in the render is bounded, because the encoders are
 * the operating system's and they do not always answer.
 *
 * iOS 26 is the case that forced it: its AAC AudioEncoder reports "Cannot
 * create array buffer for WebCodecs encoder description" to the error callback
 * and then never settles its flush. The render waited on that flush forever,
 * under a modal card with the back button behind it — a share that could only
 * be escaped by killing the app. Now a step that overruns is given up: the
 * soundtrack is dropped and the clip goes out silent, or the render resolves
 * null and the caller falls back to the picture.
 *
 * Sized as ceilings, not estimates. The soundtrack is a few hundred kilobytes
 * of PCM and encodes in well under a second on a phone; the final video flush
 * waits on at most a few hundred queued frames.
 */
const SOUND_DEADLINE_MS = 5_000;
const STEP_DEADLINE_MS = 5_000;
const FLUSH_DEADLINE_MS = 20_000;

/**
 * Settle `work`, or give up — after `ms`, or the moment `signal` aborts,
 * whichever comes first. Giving up rejects; it cannot stop the work itself,
 * which is why every caller also closes the encoder it was waiting on.
 */
export function settleWithin<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (settle: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = (): void => finish(() => reject(new Error('replay: cancelled')));
    const timer = setTimeout(() => finish(() => reject(new Error('replay: timed out'))), ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => finish(() => resolve(v)),
      (e: unknown) => finish(() => reject(e))
    );
  });
}

/** One encoded AAC chunk and its metadata, held until the muxer exists. */
export interface EncodedAudio {
  readonly chunk: unknown;
  readonly meta: unknown;
}

/**
 * The soundtrack through the AAC encoder — collected, not muxed.
 *
 * Collected because whether the file gets an audio track at all depends on this
 * finishing: a muxer declared with an audio track that never receives a chunk
 * produces a file some players refuse. So the muxer is built afterwards, with a
 * track only if there are chunks to put in it.
 *
 * Resolves null — it never rejects and never hangs — when there is no encoder,
 * the encoder refuses the config, reports an error, or does not finish inside
 * `timeoutMs`. A silent replay is still the whole run.
 */
export async function encodeSoundtrack(
  buffer: { getChannelData(channel: number): Float32Array },
  timeoutMs: number,
  signal?: AbortSignal
): Promise<EncodedAudio[] | null> {
  const AudioEncoderClass = audioEncoderCtor();
  const AudioDataClass = audioDataCtor();
  if (!AudioEncoderClass || !AudioDataClass) return null;

  const chunks: EncodedAudio[] = [];
  let encoder: InstanceType<VideoEncoderCtor> | null = null;
  // The error callback is the ONLY thing a failing encoder is guaranteed to
  // call — so it ends the wait instead of being swallowed.
  let reportError: (e: unknown) => void = () => undefined;
  const errored = new Promise<never>((_, reject) => {
    reportError = reject;
  });

  const work = (async (): Promise<boolean> => {
    const audioConfig = {
      codec: 'mp4a.40.2',
      sampleRate: SOUND_RATE,
      numberOfChannels: 1,
      bitrate: 96_000,
    };
    const ok = await AudioEncoderClass.isConfigSupported?.(audioConfig);
    if (ok && ok.supported === false) return false;
    const audioEncoder = new AudioEncoderClass({
      output: (chunk, meta) => {
        chunks.push({ chunk, meta });
      },
      error: (e) => reportError(e),
    });
    encoder = audioEncoder;
    audioEncoder.configure(audioConfig);

    // A tenth of a second per AudioData: small enough that the encoder never
    // waits on a big copy, large enough that the queue is not the bottleneck.
    const channel = buffer.getChannelData(0);
    const CHUNK = Math.floor(SOUND_RATE / 10);
    for (let i = 0; i < channel.length; i += CHUNK) {
      const slice = channel.subarray(i, Math.min(i + CHUNK, channel.length));
      const frame = new AudioDataClass({
        format: 'f32-planar',
        sampleRate: SOUND_RATE,
        numberOfFrames: slice.length,
        numberOfChannels: 1,
        timestamp: Math.round((i / SOUND_RATE) * 1_000_000),
        // Copied, not passed by reference: the encoder takes ownership of the
        // buffer it is handed, and a subarray shares the whole recording's.
        data: new Float32Array(slice),
      });
      audioEncoder.encode(frame);
      frame.close();
      if (audioEncoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    }
    await audioEncoder.flush();
    return true;
  })();
  // Whichever of these loses the race still settles later (or never); neither
  // may surface as an unhandled rejection.
  work.catch(() => undefined);
  errored.catch(() => undefined);

  try {
    const finished = await settleWithin(Promise.race([work, errored]), timeoutMs, signal);
    return finished && chunks.length > 0 ? chunks : null;
  } catch {
    return null;
  } finally {
    try {
      (encoder as InstanceType<VideoEncoderCtor> | null)?.close();
    } catch {
      /* already closed by its own error */
    }
  }
}

/**
 * Whether the clip can carry sound.
 *
 * Safari shipped the VIDEO half of WebCodecs in 16.4 and the audio classes only
 * in 26, so on an older phone the picture encodes and the soundtrack cannot.
 * The clip goes out silent rather than not at all — a silent replay is still
 * the whole run, and refusing to make one because the phone is a year old would
 * be a worse trade.
 */
export function replaySoundSupported(): boolean {
  return (
    typeof audioEncoderCtor() === 'function' &&
    typeof audioDataCtor() === 'function' &&
    typeof offlineCtor() === 'function'
  );
}

/**
 * Render the run's own sound: the pen's bed under every stroke, a note for
 * every obstacle row crossed, a thud and a tear for every death, the chime on
 * the win.
 *
 * Through the SAME voices the game plays live (`systems/Audio`), scheduled on
 * an OfflineAudioContext instead of the live one — so the clip does not merely
 * have music, it has the sound the player actually heard, in the places they
 * heard it. The phrase climbs across the whole run exactly as it does in the
 * hand: the scale resets when a level loads, not when an attempt does, so a
 * player who dies on the sixth row and then threads it plays the same rising
 * line the game gave them.
 */
async function renderSoundtrack(
  req: ReplayRequest,
  attempts: readonly RunAttempt[],
  phases: readonly Phase[],
  totalMs: number
): Promise<AudioBuffer | null> {
  const Offline = offlineCtor();
  if (!Offline) return null;

  const walls = req.figure.walls;
  if (!walls || walls.length === 0) return null;

  const pf = new Playfield(BASE_WIDTH, BASE_HEIGHT, METRICS.inset);
  const pxWalls = walls.map((w) => pf.toScreenRect(w));
  const rows = obstacleRows(pxWalls, mirrorBands(pxWalls, pf.axisX, pf.x));

  /*
   * A short tail only. The chime lands with seconds of picture still to run, so
   * the 1.2s this used to reserve was an audio track a second longer than the
   * video — the clip appeared to freeze on its last frame while nothing played.
   * A quarter second covers the encoder's own padding and nothing else.
   */
  const seconds = totalMs / 1000 + 0.25;
  const ctx = new Offline(1, Math.ceil(seconds * SOUND_RATE), SOUND_RATE);
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  let step = 0;
  for (const phase of phases) {
    if (phase.kind !== 'draw' || phase.attempt === null) continue;
    const attempt = attempts[phase.attempt];
    const points = attempt.points.map((p) => pf.toScreen(p));
    // The pen on the paper under the whole stroke, at the phase's own speed —
    // the bed the hand heard, under the notes it crossed.
    schedulePenStroke(ctx, master, phase.startMs / 1000, points, attempt.times, phase.speed);

    for (const crossing of rowCrossings(points, attempt.times, rows)) {
      // Real milliseconds into the attempt, back through the phase's own speed:
      // a miss played at 2.2× has its notes 2.2× closer together, which is what
      // watching it sped up sounds like.
      const at = (phase.startMs + crossing.atMs / phase.speed) / 1000;
      if (at < seconds) scheduleNote(ctx, master, at, step);
      step += 1;
    }

    const endsAt = (phase.startMs + phase.durationMs) / 1000;
    if (attempt.died) {
      // The death as the game plays it: the knock and the paper tearing.
      scheduleThud(ctx, master, endsAt);
      scheduleTear(ctx, master, endsAt);
    } else scheduleChime(ctx, master, endsAt);
  }

  /*
   * THE CLOSE. The last four seconds used to be silence — the settle, the mark
   * folding, the dare, all mute — which is precisely the stretch a stranger
   * watches to the end and remembers. So the two moments that matter get a
   * sound, both from the game's own palette rather than anything new:
   *
   *   the mark    a low, short note under the mark drawing itself — the
   *               sound of the paper it is drawn on
   *   the dare    one clear note high in the phrase, landing with the line
   *
   * Quiet on purpose. This is a closing mark, not a sting; a clip that shouts
   * at the end is a clip people mute before they finish it.
   */
  const outro = phases[phases.length - 1];
  if (outro && outro.kind === 'outro') {
    const foldAt = (outro.startMs + OUTRO_CAPTION_MS + OUTRO_MARK_MS) / 1000;
    scheduleTone(ctx, master, foldAt, 98, 0.9, 0.12, 'sine');

    const dareAt =
      (outro.startMs + OUTRO_CAPTION_MS + OUTRO_MARK_MS + OUTRO_FOLD_MS) / 1000;
    scheduleTone(ctx, master, dareAt, noteHz(12), 1.1, 0.1, 'triangle');
  }

  try {
    return await ctx.startRendering();
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- encoding */

export interface ReplayRequest {
  /** The winning run, and the maze it was drawn through. */
  readonly figure: SavedFigure;
  /** Every attempt in order; the last one is the win. */
  readonly attempts: readonly RunAttempt[];
  /** Drawn in the footer, exactly as on the still card. */
  readonly caption: string;
  readonly challenge: string;
  readonly width?: number;
  readonly height?: number;
}

/**
 * The replay's outer ceiling, for the caller's AbortSignal. The render bounds
 * each of its own steps (see DEADLINES); this is the belt to those braces, so
 * that no encoder, however it fails, can hold a modal card up for longer than a
 * player would wait for it.
 */
export const REPLAY_CEILING_MS = 45_000;
/** How long the replay's progress card folds before it offers Cancel. */
export const REPLAY_CANCEL_AFTER_MS = 2_000;

export interface ReplayRenderOptions {
  /**
   * Give up at the next step: the player's Cancel, or the caller's own
   * ceiling. The render then resolves null.
   */
  readonly signal?: AbortSignal;
}

/**
 * Render and encode the clip. Resolves null when the device cannot encode,
 * when there is nothing to draw, when an encoder stops answering, or when
 * `signal` aborts — never left pending (see DEADLINES).
 *
 * `onProgress` is called with 0..1 so a button can say something while this
 * runs; the loop yields to the event loop between frames so the game does not
 * freeze behind it.
 */
export async function renderReplayVideo(
  req: ReplayRequest,
  onProgress?: (fraction: number) => void,
  opts: ReplayRenderOptions = {}
): Promise<Blob | null> {
  const { signal } = opts;
  const VideoEncoderClass = encoderCtor();
  const VideoFrameClass = frameCtor();
  if (!VideoEncoderClass || !VideoFrameClass) return null;

  const attempts = req.attempts.slice(-MAX_REPLAY_ATTEMPTS);
  if (attempts.length === 0) return null;

  const width = req.width ?? CARD_SIZE;
  const height = req.height ?? Math.round((width * CARD_MAZE_HEIGHT) / CARD_SIZE);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  const margin = width * 0.05;
  const footerHeight = height * 0.12;
  const box = {
    x: margin,
    y: margin,
    w: width - margin * 2,
    h: height - margin * 2 - footerHeight,
  };

  // One layout per attempt, all sharing the board's frame: the maze is the same
  // rectangle in every frame, so the line cannot swim under it between takes.
  const board = layoutFigureCard(req.figure, box);
  if (!board) return null;
  const layouts = attempts.map((a) => layoutFigureCard(asFigure(req.figure, a), box));

  const phases = buildTimeline(attempts);
  const totalMs = timelineDurationMs(phases);
  const frames = Math.max(1, Math.round((totalMs / 1000) * FPS));

  /*
   * The soundtrack is rendered AND encoded before the muxer is built, because
   * whether it exists decides whether the file has an audio track at all — and
   * a muxer declared with a track that never receives a chunk produces a file
   * some players refuse.
   *
   * Audio first, and all of it, before a single frame is drawn. It is a few
   * hundred kilobytes of PCM through a hardware AAC encoder — under a tenth of
   * the work the picture is — and doing it up front means the video loop is
   * never interleaved with it. A failure here, or an encoder that never
   * answers, drops the sound and keeps the clip, which is the right way round:
   * a silent replay is still the run.
   */
  let sound: AudioBuffer | null = null;
  if (replaySoundSupported()) {
    try {
      sound = await settleWithin(
        renderSoundtrack(req, attempts, phases, totalMs),
        SOUND_DEADLINE_MS,
        signal
      );
    } catch {
      sound = null;
    }
  }
  const audio = sound ? await encodeSoundtrack(sound, SOUND_DEADLINE_MS, signal) : null;
  if (signal?.aborted) return null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height },
    ...(audio
      ? { audio: { codec: 'aac' as const, numberOfChannels: 1, sampleRate: SOUND_RATE } }
      : {}),
    // Social composers start playing before the whole file is read; a moov at
    // the end means a clip that looks broken until it has fully downloaded.
    fastStart: 'in-memory',
  });
  for (const a of audio ?? []) muxer.addAudioChunk(a.chunk as never, a.meta as never);

  let failed = false;
  const encoder = new VideoEncoderClass({
    output: (chunk, meta) => muxer.addVideoChunk(chunk as never, meta as never),
    error: () => {
      failed = true;
    },
  });

  /*
   * High profile, level 4.0. 1080×1920 is 2,073,600 pixels against the level's
   * 2,097,152 ceiling — it fits, with almost nothing to spare, which is why the
   * level is spelled out rather than left to the encoder to guess.
   */
  const config = {
    codec: 'avc1.640028',
    width,
    height,
    framerate: FPS,
    /*
     * 2.4 Mbps, not 5.
     *
     * Flat colour on paper with one moving line compresses to almost nothing,
     * and at 5 Mbps a twelve-second clip came out at 7.2 MB — enough to make
     * some composers re-encode it, which is exactly how a crisp hairline turns
     * to mush on the way to somebody's feed. The bitrate that matters here is
     * whatever keeps the ink's edges clean, and that is far lower than moving
     * photography needs.
     */
    bitrate: 2_400_000,
    avc: { format: 'avc' as const },
  };

  const footerAt = makeFooterPainter(ctx, width, height, margin, req);
  const kit = new FrameKit(width, height, board);

  try {
    const check = await settleWithin(
      Promise.resolve(VideoEncoderClass.isConfigSupported?.(config)),
      STEP_DEADLINE_MS,
      signal
    );
    if (check && check.supported === false) return null;
    encoder.configure(config);

    let phaseIndex = 0;
    for (let f = 0; f < frames; f++) {
      if (failed || signal?.aborted) return null;
      const ms = (f / FPS) * 1000;
      while (
        phaseIndex < phases.length - 1 &&
        ms >= phases[phaseIndex].startMs + phases[phaseIndex].durationMs
      ) {
        phaseIndex++;
      }
      const phase = phases[phaseIndex];
      paintFrame(
        ctx,
        width,
        height,
        board,
        layouts,
        attempts,
        phase,
        ms - phase.startMs,
        phase.kind === 'outro' ? () => footerAt(outroStage(ms - phase.startMs)) : footerAt,
        kit
      );

      const frame = new VideoFrameClass(canvas, {
        timestamp: Math.round((f / FPS) * 1_000_000),
        duration: Math.round(1_000_000 / FPS),
      });
      // A keyframe every two seconds: enough for a composer to scrub, cheap
      // enough not to dominate a file this short.
      encoder.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
      frame.close();

      onProgress?.((f + 1) / frames);

      /*
       * Yield, and not only every frame — the encoder runs on its own thread
       * and the queue is what actually needs draining. Without this the whole
       * render blocks the game for as long as it takes, which on the win screen
       * means a share button that appears to have hung.
       */
      if (f % 4 === 3 || encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Bounded like every other wait here: a hardware encoder that stops
    // answering must cost the player the clip, not the app.
    await settleWithin(encoder.flush(), FLUSH_DEADLINE_MS, signal);
    muxer.finalize();
  } catch {
    return null;
  } finally {
    try {
      encoder.close();
    } catch {
      /* already closed by the error path */
    }
  }

  if (failed) return null;
  return new Blob([target.buffer], { type: 'video/mp4' });
}

/**
 * The same footer the still card draws, as a function of how far the outro
 * has got.
 *
 * Built once and reused per frame rather than recomputed: it is the only part
 * of the picture that never moves, and it is measured in text metrics.
 */
function makeFooterPainter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  margin: number,
  req: ReplayRequest
): (stage: OutroStage) => void {
  const u = ui();
  const serif = (px: number, italic = false): string =>
    `${italic ? 'italic ' : ''}${Math.round(px)}px ${FONT_DISPLAY}`;
  const markSize = width * 0.042;

  return (stage: OutroStage) => {
    if (stage.caption <= 0) return;
    ctx.textAlign = 'center';
    const cx = width / 2;
    const markBase = height - margin - markSize * 0.4;

    /*
     * THE MARK, DRAWING ITSELF.
     *
     * The word and the mark's two dots set first; then the line runs out of
     * its dot and the reflection follows it across the fold — the logo's own
     * draw-in (Logo.DRAW_IN), which is the game's mechanic performed by the
     * brand in under a second. It replaces the retired mirrored wordmark,
     * which folded out of the baseline here before.
     */
    if (stage.mark > 0) {
      paintLockup(ctx, cx, markBase, markSize, stage.mark, drawInAt(stage.fold * DRAW_IN.total));
      ctx.textAlign = 'center';
    }

    // The dare, last and alone, because it is the only line asking for
    // anything. It rises the last few pixels into place rather than appearing,
    // which is the difference between a caption and a closing line.
    if (stage.challenge > 0) {
      const y = markBase - height * 0.034 + (1 - stage.challenge) * height * 0.008;
      ctx.font = serif(width * 0.038, true);
      ctx.fillStyle = cssRgba(u.text, 0.9 * stage.challenge);
      ctx.fillText(req.challenge, cx, y);
    }

    ctx.font = serif(width * 0.032);
    ctx.fillStyle = cssRgba(u.text2, stage.caption);
    ctx.fillText(req.caption, cx, markBase - height * 0.062);
  };
}
