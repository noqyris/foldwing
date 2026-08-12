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
import {
  CARD_MAZE_HEIGHT,
  CARD_SIZE,
  cssRgba,
  layPaper,
  paintMaze,
  paintRibbon,
} from './ShareCard';
import { BASE_HEIGHT, BASE_WIDTH, METRICS, theme, veiledInk } from './Theme';
import { Playfield } from '../core/Playfield';
import { mirrorBands, obstacleRows, rowCrossings } from '../core/Gates';
import { noteHz, scheduleChime, scheduleNote, scheduleThud, scheduleTone } from '../systems/Audio';

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
 * and the mark does not fade in: it FOLDS. The word sets, and its reflection
 * swings down from the baseline like a sheet of paper being creased, which is
 * the logo performing the mechanic in three quarters of a second.
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
  /** 0 flat, 1 fully creased down. The reflection swinging out of the baseline. */
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

function paintFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  board: CardLayout,
  layouts: readonly (CardLayout | null)[],
  attempts: readonly RunAttempt[],
  phase: Phase,
  intoPhaseMs: number,
  footer: (stage: OutroStage) => void
): void {
  const t = theme();
  ctx.clearRect(0, 0, width, height);
  layPaper(ctx, width, height, t.paper);
  paintMaze(ctx, board);

  /*
   * Every earlier failure stays on the board as a faint centreline — the same
   * ghost the game itself leaves after a death, for the same reason. It is the
   * record of how hard this was, and by the last attempt the near-misses draw
   * the shape of the corridor the player finally found.
   */
  /*
   * How many earlier attempts have left a mark. During the intro that is none —
   * the board has to open clean, or the clip gives away the whole run in its
   * first frame. During the outro it is all of them: by then the near-misses
   * are the record of how hard this was.
   */
  const upTo = phase.attempt ?? (phase.kind === 'intro' ? 0 : attempts.length);
  for (let i = 0; i < upTo; i++) {
    const layout = layouts[i];
    if (!layout || !attempts[i].died) continue;
    ghost(ctx, layout, t.ink, 0.1);
  }

  const active = phase.attempt;
  const layout = active === null ? null : layouts[active];
  if (!layout) {
    if (phase.kind === 'outro') paintClosed(ctx, board, layouts[attempts.length - 1], 1, footer);
    return;
  }

  const attempt = attempts[active as number];

  if (phase.kind === 'draw') {
    const stroke = strokeUpTo(layout.stroke, intoPhaseMs * phase.speed);
    const mirrored = strokeUpTo(layout.mirrored, intoPhaseMs * phase.speed);
    ctx.fillStyle = cssRgba(veiledInk(t.ink, t), 1);
    paintRibbon(ctx, mirrored, layout.nib);
    ctx.fillStyle = cssRgba(t.ink, 1);
    paintRibbon(ctx, stroke, layout.nib);
    return;
  }

  if (phase.kind === 'flash' || phase.kind === 'clear') {
    // The whole attempt, in the fail colour, fading out — the game's own 400ms
    // of red, compressed to the length this clip can afford.
    const fade = phase.kind === 'flash' ? 1 : 1 - intoPhaseMs / Math.max(1, phase.durationMs);
    ctx.fillStyle = cssRgba(t.fail, 0.45 * fade);
    paintRibbon(ctx, layout.mirrored, layout.nib);
    ctx.fillStyle = cssRgba(t.fail, fade);
    paintRibbon(ctx, layout.stroke, layout.nib);
    return;
  }

  if (phase.kind === 'settle') {
    const k = Math.min(1, intoPhaseMs / Math.max(1, phase.durationMs));
    paintClosed(ctx, board, layout, k, () => footer(NO_OUTRO));
    // The winning attempt is the one the outro rests on.
    void attempt;
  }
}

/** The finished figure: silhouette, reflection, line, then the footer over it. */
function paintClosed(
  ctx: CanvasRenderingContext2D,
  _board: CardLayout,
  layout: CardLayout | null,
  k: number,
  footer: (stage: OutroStage) => void
): void {
  if (!layout) return;
  const t = theme();

  ctx.fillStyle = cssRgba(t.ink, t.winFillAlpha * k);
  if (layout.outline.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(layout.outline[0].x, layout.outline[0].y);
    for (let i = 1; i < layout.outline.length; i++) {
      ctx.lineTo(layout.outline[i].x, layout.outline[i].y);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = cssRgba(veiledInk(t.ink, t), 1);
  paintRibbon(ctx, layout.mirrored, layout.nib);
  ctx.fillStyle = cssRgba(t.ink, 1);
  paintRibbon(ctx, layout.stroke, layout.nib);

  footer(NO_OUTRO);
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
 * Render the run's own sound: a note for every obstacle row crossed, a thud for
 * every death, the chime on the win.
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

    for (const crossing of rowCrossings(points, attempt.times, rows)) {
      // Real milliseconds into the attempt, back through the phase's own speed:
      // a miss played at 2.2× has its notes 2.2× closer together, which is what
      // watching it sped up sounds like.
      const at = (phase.startMs + crossing.atMs / phase.speed) / 1000;
      if (at < seconds) scheduleNote(ctx, master, at, step);
      step += 1;
    }

    const endsAt = (phase.startMs + phase.durationMs) / 1000;
    if (attempt.died) scheduleThud(ctx, master, endsAt);
    else scheduleChime(ctx, master, endsAt);
  }

  /*
   * THE CLOSE. The last four seconds used to be silence — the settle, the mark
   * folding, the dare, all mute — which is precisely the stretch a stranger
   * watches to the end and remembers. So the two moments that matter get a
   * sound, both from the game's own palette rather than anything new:
   *
   *   the crease  a low, short note under the mark folding open — the sound of
   *               the paper it is drawn on
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
 * Render and encode the clip. Resolves null when the device cannot encode, or
 * when there is nothing to draw.
 *
 * `onProgress` is called with 0..1 so a button can say something while this
 * runs; the loop yields to the event loop between frames so the game does not
 * freeze behind it.
 */
export async function renderReplayVideo(
  req: ReplayRequest,
  onProgress?: (fraction: number) => void
): Promise<Blob | null> {
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
   * The soundtrack is rendered BEFORE the muxer is built, because whether it
   * exists decides whether the file has an audio track at all — and a muxer
   * declared with a track that never receives a chunk produces a file some
   * players refuse.
   */
  const sound = replaySoundSupported()
    ? await renderSoundtrack(req, attempts, phases, totalMs)
    : null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height },
    ...(sound
      ? { audio: { codec: 'aac' as const, numberOfChannels: 1, sampleRate: SOUND_RATE } }
      : {}),
    // Social composers start playing before the whole file is read; a moov at
    // the end means a clip that looks broken until it has fully downloaded.
    fastStart: 'in-memory',
  });

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

  try {
    const check = await VideoEncoderClass.isConfigSupported?.(config);
    if (check && check.supported === false) return null;
    encoder.configure(config);
  } catch {
    return null;
  }

  /*
   * Audio first, and all of it, before a single frame is drawn.
   *
   * It is a few hundred kilobytes of PCM through a hardware AAC encoder — under
   * a tenth of the work the picture is — and doing it up front means the video
   * loop is never interleaved with it. A failure here drops the sound and keeps
   * the clip, which is the right way round: a silent replay is still the run.
   */
  if (sound) {
    try {
      await encodeSound(sound);
    } catch {
      /* the picture is worth more than the sound */
    }
  }

  const footerAt = makeFooterPainter(ctx, width, height, margin, req);

  async function encodeSound(buffer: AudioBuffer): Promise<void> {
    const AudioEncoderClass = audioEncoderCtor();
    const AudioDataClass = audioDataCtor();
    if (!AudioEncoderClass || !AudioDataClass) return;

    const audioEncoder = new AudioEncoderClass({
      output: (chunk, meta) => muxer.addAudioChunk(chunk as never, meta as never),
      error: () => undefined,
    });
    const audioConfig = {
      codec: 'mp4a.40.2',
      sampleRate: SOUND_RATE,
      numberOfChannels: 1,
      bitrate: 96_000,
    };
    const ok = await AudioEncoderClass.isConfigSupported?.(audioConfig);
    if (ok && ok.supported === false) return;
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
    audioEncoder.close();
  }

  try {
    let phaseIndex = 0;
    for (let f = 0; f < frames; f++) {
      if (failed) return null;
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
        phase.kind === 'outro' ? () => footerAt(outroStage(ms - phase.startMs)) : footerAt
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

    await encoder.flush();
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
 * The same footer the still card draws, as a function of one alpha.
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
  const t = theme();
  const serif = (px: number): string =>
    `${Math.round(px)}px Georgia, "Times New Roman", serif`;
  const markSize = width * 0.042;

  return (stage: OutroStage) => {
    if (stage.caption <= 0) return;
    ctx.textAlign = 'center';
    const cx = width / 2;
    const markBase = height - margin - markSize * 0.78;

    /*
     * THE MARK, FOLDING.
     *
     * The word sets first at its own weight, and only then does the reflection
     * swing down out of the baseline — `scale(1, -fold)` with the origin ON the
     * baseline, so at 0 the reflection is a flat crease under the type and at 1
     * it is the full mirrored word. That is the logo doing what the game does,
     * and it costs one transform.
     */
    if (stage.mark > 0) {
      ctx.font = serif(markSize);
      ctx.fillStyle = cssRgba(t.ink, 0.8 * stage.mark);
      ctx.fillText('foldwing', cx, markBase);

      if (stage.fold > 0) {
        ctx.save();
        ctx.translate(cx, markBase + markSize * 0.07);
        ctx.scale(1, -stage.fold);
        ctx.fillStyle = cssRgba(t.ink, t.mirrorAlpha * 0.42);
        ctx.fillText('foldwing', 0, 0);
        ctx.restore();
      }
    }

    // The dare, last and alone, because it is the only line asking for
    // anything. It rises the last few pixels into place rather than appearing,
    // which is the difference between a caption and a closing line.
    if (stage.challenge > 0) {
      const y = markBase - height * 0.03 + (1 - stage.challenge) * height * 0.008;
      ctx.font = serif(width * 0.038);
      ctx.fillStyle = cssRgba(t.ink, 0.62 * stage.challenge);
      ctx.fillText(req.challenge, cx, y);
    }

    ctx.font = serif(width * 0.032);
    ctx.fillStyle = cssRgba(t.ink, 0.46 * stage.caption);
    ctx.fillText(req.caption, cx, markBase - height * 0.058);
  };
}
