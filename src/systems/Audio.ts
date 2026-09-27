/**
 * Audio — one note per obstacle safely passed, and the pen on the paper.
 *
 * The scale climbs as the stroke does and resets each level, so a clean run
 * plays a rising phrase and the player hears their own progress before they see
 * it. Nothing plays on its own: every sound marks something the player did, or
 * something they were just given. The one sound that lasts — the pen bed — is
 * the player's own hand, and it is silent the moment the hand stops.
 *
 * On collision, a short damped thud. Not a buzzer — a buzzer is a punishment,
 * and this game asks you to fail dozens of times a minute. It has to sound like
 * a dropped pen, not an alarm.
 *
 * Synthesised through Web Audio rather than loaded as files: a handful of
 * notes and a thud would otherwise be as many HTTP requests and decodes on a
 * cold start that is currently under a second.
 */

/** Major pentatonic. No semitone clashes, so any two notes land well together. */
const PENTATONIC = [0, 2, 4, 7, 9];
const ROOT_HZ = 261.63; // C4

/**
 * How many octaves the phrase climbs before starting again.
 *
 * It used to climb without a ceiling, and the level set does not cooperate:
 * measured over the shipped 295, a level has a median of 21 obstacle rows and
 * as many as 33. Step 20 is 4186 Hz — with the "shine" partial an octave above
 * it, 8372 Hz — and step 32 asks the oscillator for about 21 kHz. So the reward
 * for finally clearing a hard level was the most piercing sound in the game,
 * and the top of the ladder was inaudible on a phone speaker anyway.
 *
 * Three octaves is C4 to A6: a real climb the ear can follow, that then rolls
 * over and climbs again rather than walking out of the register.
 */
const OCTAVES = 3;

export function semitone(step: number): number {
  const wrapped = step % (PENTATONIC.length * OCTAVES);
  const octave = Math.floor(wrapped / PENTATONIC.length);
  const degree = PENTATONIC[wrapped % PENTATONIC.length];
  return degree + octave * 12;
}

export const noteHz = (step: number): number =>
  ROOT_HZ * Math.pow(2, semitone(step) / 12);

/*
 * The voices, scheduled at an explicit time on an explicit context.
 *
 * They take `at` rather than reading `ctx.currentTime` so the replay video can
 * render the same sounds through an OfflineAudioContext, minutes of gameplay
 * laid out in one pass and encoded into the clip. Two synths would mean a video
 * that sounds nearly like the game, and "nearly" is what makes a thing feel
 * fake.
 */

export function scheduleTone(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  hz: number,
  seconds: number,
  peak: number,
  type: OscillatorType
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/** A mallet's attack, in seconds. */
const STRIKE_ATTACK = 0.003;

/**
 * A struck voice: a mallet's few-millisecond attack, then a free decay.
 *
 * Not `scheduleTone`, whose 10 ms swell is right for a note that sings and
 * wrong for one that is hit — at 10 ms the ear hears the onset as a fade-in,
 * and the marimba reads as a soft organ.
 */
function scheduleStrike(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  hz: number,
  seconds: number,
  peak: number
): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = hz;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + STRIKE_ATTACK);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/** How fast a burst with a body arrives, seconds: a tear starts at once, but not as a click. */
const NOISE_ATTACK = 0.004;

/**
 * A burst of noise through one filter, for the sounds that are paper rather
 * than pitch: the mallet's click, the tear.
 *
 * `grain` roughens the level into small steps (a fresh level every `grain`
 * seconds): smooth noise is air, stepped noise is fibres giving way. `body` is
 * the share of the burst that holds (falling only to 60%) before the final
 * decay: 0 is a strike, gone as soon as it lands; a tear needs a body, or it
 * is only a click.
 */
function scheduleNoise(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  seconds: number,
  gainPeak: number,
  filter: BiquadFilterType,
  hz: number,
  q: number,
  grain = 0,
  body = 0
): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const step = grain > 0 ? Math.max(1, Math.floor(ctx.sampleRate * grain)) : frames;
  let level = 1;
  for (let i = 0; i < frames; i++) {
    if (grain > 0 && i % step === 0) level = 0.35 + 0.65 * Math.random();
    // A strike also falls inside the buffer, so it ends at zero whatever the
    // gain automation is doing; a burst with a body is shaped by its gain.
    const fall = body > 0 ? 1 : 1 - i / frames;
    data[i] = (Math.random() * 2 - 1) * level * fall;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = hz;
  f.Q.value = q;

  const gain = ctx.createGain();
  if (body > 0) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(gainPeak, at + NOISE_ATTACK);
    gain.gain.linearRampToValueAtTime(gainPeak * 0.6, at + seconds * body);
  } else {
    gain.gain.setValueAtTime(gainPeak, at);
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);

  noise.connect(f).connect(gain).connect(out);
  noise.start(at);
  noise.stop(at + seconds);
}

/** SPEC §3.8: the marimba row voice. */
export const MARIMBA = {
  peak: 0.15,
  decay: 0.45,
  partial: 4,
  partialPeak: 0.035,
  partialDecay: 0.07,
  click: 0.005,
  clickPeak: 0.05,
} as const;

/**
 * One obstacle row cleared: the next note up the phrase, on a marimba.
 *
 * It used to be a triangle with an octave of shine, which is a bell: it rings
 * on after the row, so a quick run of rows smeared into a chord. A struck bar
 * dies fast and says "that one" — a sine fundamental, the ×4 partial a
 * marimba's bar is tuned to (bright, and gone in 70 ms), and a 5 ms click
 * of the mallet through a 3 kHz high-pass. It sounds like a toy you strike.
 *
 * The replay video plays the phrase through this same function, so the clip
 * changes voice with the game.
 */
export function scheduleNote(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  step: number
): void {
  const hz = noteHz(step);
  scheduleStrike(ctx, out, at, hz, MARIMBA.decay, MARIMBA.peak);
  scheduleStrike(ctx, out, at, hz * MARIMBA.partial, MARIMBA.partialDecay, MARIMBA.partialPeak);
  scheduleNoise(ctx, out, at, MARIMBA.click, MARIMBA.clickPeak, 'highpass', 3000, 0.7);
}

/**
 * "Close": a scrape survived. The row's note an octave up, a clean sine that
 * is over in 0.18 s — a glint of sound, well under the phrase (0.06 against
 * its 0.15) because it lands in the middle of it.
 */
export function scheduleTing(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  step: number
): void {
  scheduleStrike(ctx, out, at, noteHz(step) * 2, 0.18, 0.06);
}

/**
 * The tear's numbers. "0.05" in the spec is the level it is HEARD at, as it is
 * for every tone (a sine's gain is its peak). A 3 kHz band-pass keeps under
 * half of white noise's peak, so the gain that lands a 0.05 peak is higher:
 * measured in Chrome over 60 renders of this shape, output peak ÷ gain has a
 * median of 0.455 (0.36–0.71), so a gain of 0.11 is heard at 0.05.
 */
export const TEAR = { seconds: 0.06, gain: 0.11, heard: 0.05 } as const;

/**
 * The death, second half: paper tearing under the thud.
 *
 * The thud is the pen hitting the desk; the tear is what it did to the sheet.
 * Bandpassed at 3 kHz, where the thud has nothing, so the two read as one
 * event with a body and an edge rather than two sounds. Rough-grained, 60 ms,
 * and quiet (0.05) — detail, not a second blow.
 */
export function scheduleTear(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  scheduleNoise(ctx, out, at, TEAR.seconds, TEAR.gain, 'bandpass', 3000, 1.4, 0.004, 0.7);
}

/**
 * Ready again: the board has cleared and the dot is waiting. A soft, dry
 * 520 Hz knock — THUD … tock — so the ear knows the next try is open before
 * the eye has gone back to the dot.
 */
export function scheduleTock(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  scheduleStrike(ctx, out, at, 520, 0.06, 0.04);
}

/**
 * The phrase steps the stars punch in on: C6, D6, G6 (steps 10, 11, 13 of the
 * row ladder, so the win's notes are the level's own scale arriving).
 */
export const STAR_STEPS = [10, 11, 13] as const;

/**
 * Star `i` (0-based) punches into the result card.
 *
 * A triangle at 0.12 — one step under the win's own run, since it plays
 * straight after it. Only a ★★★ ever plays the third, so the third carries
 * the weight: the low fifth the medal used to put under the celebration,
 * here under the G6 that completes the set.
 */
export function scheduleStarNote(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  i: number
): void {
  const idx = Math.max(0, Math.min(STAR_STEPS.length - 1, Math.floor(i)));
  scheduleTone(ctx, out, at, noteHz(STAR_STEPS[idx]), 0.7, 0.12, 'triangle');
  if (idx === STAR_STEPS.length - 1) {
    scheduleTone(ctx, out, at, ROOT_HZ / 2, 1.6, 0.09, 'sine');
    scheduleTone(ctx, out, at, (ROOT_HZ / 2) * Math.pow(2, 7 / 12), 1.6, 0.07, 'sine');
  }
}

/** Collision: a dropped pen, not a buzzer. */
export function scheduleThud(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  // Body: a low tone that falls as it decays.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, at);
  osc.frequency.exponentialRampToValueAtTime(58, at + 0.16);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.3, at + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);

  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.24);

  // Transient: a very short filtered noise burst, which is what makes it read
  // as a physical knock rather than a synth blip.
  const frames = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.12, at);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);

  noise.connect(lp).connect(noiseGain).connect(out);
  noise.start(at);
  noise.stop(at + 0.06);
}

/**
 * A soft mark for the win, under the figure rather than over it.
 *
 * The game itself no longer plays it — the win takes `scheduleCelebration` —
 * but the replay video still closes each successful attempt on it, where a
 * quieter sound is right: the clip's own close comes a few seconds later.
 */
export function scheduleChime(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  const root = ROOT_HZ * 2;
  [0, 4, 7].forEach((semi, i) => {
    scheduleTone(ctx, out, at + i * 0.09, root * Math.pow(2, semi / 12), 0.9, 0.09, 'sine');
  });
}

/**
 * The level is beaten: a rising flourish, and a taller one for a medal.
 *
 * The old win sound was `scheduleChime` — three soft notes, deliberately "under
 * the figure rather than over it". That is the right instinct for the moment
 * the ink closes, and too quiet for the only thing in the game that says WELL
 * DONE. Casual puzzle games all escalate here, pitch and density rising with
 * the size of the achievement, because a reward that sounds the same whether
 * you scraped through or beat the par line teaches the player nothing.
 *
 * So: a run up the same pentatonic the level itself was playing, which makes it
 * read as the phrase the player was building finally arriving somewhere. A
 * medal adds two more notes and an octave doubling — audibly bigger, without
 * being a different sound.
 */
export function scheduleCelebration(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  medal: boolean
): void {
  const steps = medal ? [5, 7, 9, 11, 12, 14] : [5, 7, 9, 11];
  steps.forEach((step, i) => {
    const t = at + i * 0.075;
    const hz = noteHz(step);
    scheduleTone(ctx, out, t, hz, 0.7, 0.13, 'triangle');
    scheduleTone(ctx, out, t, hz * 2, 0.45, 0.04, 'sine');
  });

  // A medal gets a low fifth under the run — the weight that makes it land as
  // an event rather than a longer version of the same jingle.
  if (medal) {
    scheduleTone(ctx, out, at, ROOT_HZ / 2, 1.6, 0.09, 'sine');
    scheduleTone(ctx, out, at, (ROOT_HZ / 2) * Math.pow(2, 7 / 12), 1.6, 0.07, 'sine');
  }
}

/*
 * The reward sounds.
 *
 * Deliberately quieter than the win (peaks 0.06-0.07 against the celebration's
 * 0.13) and above its register, because they so often land ON it: a chapter
 * completed, a mission paid, the streak ticking up all happen while the win's
 * run is still ringing. Sitting over it rather than inside it keeps both
 * audible, and none of them can grow into a jingle that competes with the one
 * sound that says the level is beaten.
 */

/** A token landed on a counter: a short upward blip. */
export function schedulePop(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, at);
  osc.frequency.exponentialRampToValueAtTime(1320, at + 0.09);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.07, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);

  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.11);
}

/** Something was earned — a purchase, a chapter, a milestone: C6, E6, G6. */
export function scheduleReward(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  const c6 = ROOT_HZ * 4;
  [0, 4, 7].forEach((semi, i) => {
    scheduleTone(ctx, out, at + i * 0.06, c6 * Math.pow(2, semi / 12), 0.45, 0.07, 'triangle');
  });
}

/**
 * The streak went up: a breath of noise swelling into a G5.
 *
 * Not another arpeggio. It plays on the Daily's win, straight after the
 * celebration's run, and a second run of notes would blur into the first; a
 * swell has no pitch to clash with, and the one note it lands on is the fifth
 * of the key everything else is in.
 */
export function scheduleStreakUp(ctx: BaseAudioContext, out: AudioNode, at: number): void {
  const swell = 0.2;
  const frames = Math.floor(ctx.sampleRate * swell);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, at);
  noiseGain.gain.exponentialRampToValueAtTime(0.06, at + swell * 0.85);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, at + swell);

  noise.connect(lp).connect(noiseGain).connect(out);
  noise.start(at);
  noise.stop(at + swell);

  // The note the swell arrives at, entering as the swell peaks.
  const g5 = ROOT_HZ * 2 * Math.pow(2, 7 / 12);
  scheduleTone(ctx, out, at + swell * 0.7, g5, 0.6, 0.06, 'triangle');
}

/* ------------------------------------------------------- the pen on paper */

/*
 * The pen bed: the sound of the nib on the sheet, for as long as it moves.
 *
 * Nothing else in the game says "you are drawing" to the ear. Notes mark rows,
 * the thud marks a death, and between them the stroke — 95% of the game — was
 * silent. A looped strand of white noise through a bandpass is what a pen on
 * paper actually is: its level follows the speed (a fast stroke hisses, a slow
 * one whispers, a resting pen is silent) and so does its colour (1.8 kHz at a
 * crawl, 3.2 kHz at full speed, the way a quicker scratch sounds brighter).
 *
 * The reflection draws too, so it gets a copy: a quieter strand (×0.35) at
 * 0.97 of the rate — the same paper, a slightly different hand — panned to the
 * other side. The pen is always on the left half (the cursor is confined
 * there), so the pen sits at −0.3 and the mirror at +0.3: on headphones the two
 * halves of the fold are literally left and right. A WebView cannot tell
 * headphones from the speaker, and at ±0.3 the speaker case simply sounds
 * centred, so it pans always.
 *
 * Deliberately under the row notes (0.035 against their 0.15): it is a bed for
 * the phrase to sit on, never louder than the thing that says "progress".
 */

/** Base px per ms at which the bed is at full level: 1.1 pt/ms at PT = 2. */
export const PEN_FULL_SPEED = 2.2;
/** The bed's level at full speed. */
export const PEN_PEAK = 0.035;
/** Level = PEN_PEAK · (speed / full)^0.7: a slow stroke is audible, not silent. */
const PEN_CURVE = 0.7;
/** The bandpass centre at rest and at full speed, and its width. */
export const PEN_LOW_HZ = 1800;
export const PEN_HIGH_HZ = 3200;
const PEN_Q = 0.9;
/** Smoothing of every speed change, seconds (setTargetAtTime τ). */
export const PEN_TAU = 0.04;
/** How fast a lift, a death or a win silences it (τ). */
export const PEN_CUT_TAU = 0.03;
/** The reflection's copy: its rate, its share of the level, and the pan either side. */
export const MIRROR_RATE = 0.97;
export const MIRROR_SHARE = 0.35;
export const PEN_PAN = 0.3;
/** The noise strand's length. Long enough that no loop is ever heard. */
const NOISE_SECONDS = 2;
/**
 * How often a live speed reaches the audio graph, seconds.
 *
 * Pointer moves arrive at 60–120 Hz and each would book four automation
 * events; at τ = 40 ms nothing between two 30 ms updates is audible anyway.
 * Speeds that arrive in between are averaged into the next one, not dropped.
 */
const PEN_UPDATE_S = 0.03;
/**
 * A pen that stops moving sends no more moves, so the bed would hiss on at the
 * last speed for as long as the finger rests. After this long without a speed
 * it glides to silence on its own.
 */
export const PEN_STALL_MS = 90;

const unit = (v: number, full: number): number =>
  Number.isFinite(v) && v > 0 ? Math.min(1, v / full) : 0;

/** The bed's level for a pen moving at `v` base px/ms. */
export function penLevel(v: number): number {
  return PEN_PEAK * Math.pow(unit(v, PEN_FULL_SPEED), PEN_CURVE);
}

/** The bandpass centre for a pen moving at `v`: geometric, so equal steps in speed are equal steps in pitch. */
export function penCentre(v: number): number {
  return PEN_LOW_HZ * Math.pow(PEN_HIGH_HZ / PEN_LOW_HZ, unit(v, PEN_FULL_SPEED));
}

/** One 2 s strand of white noise per context, made once and looped by every stroke. */
const strands = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseStrand(ctx: BaseAudioContext): AudioBuffer {
  const cached = strands.get(ctx);
  if (cached) return cached;
  const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // White noise has no continuity to break, so the loop point cannot click.
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  strands.set(ctx, buffer);
  return buffer;
}

/** A pen bed in progress, on any context. */
export interface PenVoice {
  /**
   * The pen moves at `v` base px/ms as of `at` (context seconds). `mirror`:
   * whether the reflection's copy sounds too — in play it always does.
   */
  speed(v: number, at: number, mirror?: boolean): void;
  /** A lift, a death or a win: gone with τ = 30 ms, then the nodes are released. */
  cut(at: number): void;
}

/**
 * Start a pen bed at `at`, silent until its first speed.
 *
 * Built per stroke rather than kept running at zero: an idle graph still keeps
 * the audio hardware awake, which on a phone is battery. Eight nodes per
 * stroke, strokes seconds apart, costs nothing.
 */
export function startPenVoice(ctx: BaseAudioContext, out: AudioNode, at: number): PenVoice {
  const buffer = noiseStrand(ctx);

  const strand = (rate: number, pan: number) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = PEN_LOW_HZ;
    band.Q.value = PEN_Q;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, at);

    const nodes: AudioNode[] = [src, band, gain];
    src.connect(band).connect(gain);
    // Older WebKit has no StereoPanner; there the bed is simply centred.
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      gain.connect(panner).connect(out);
      nodes.push(panner);
    } else {
      gain.connect(out);
    }
    // A different place in the strand each stroke, so no two sound the same.
    src.start(at, Math.random() * NOISE_SECONDS);
    return { src, band, gain, nodes };
  };

  const pen = strand(1, -PEN_PAN);
  const mirror = strand(MIRROR_RATE, PEN_PAN);
  let done = false;

  return {
    speed(v, t, withMirror = true) {
      if (done) return;
      const level = penLevel(v);
      const hz = penCentre(v);
      pen.gain.gain.setTargetAtTime(level, t, PEN_TAU);
      mirror.gain.gain.setTargetAtTime(withMirror ? level * MIRROR_SHARE : 0, t, PEN_TAU);
      pen.band.frequency.setTargetAtTime(hz, t, PEN_TAU);
      mirror.band.frequency.setTargetAtTime(hz, t, PEN_TAU);
    },
    cut(t) {
      if (done) return;
      done = true;
      for (const s of [pen, mirror]) {
        s.gain.gain.setTargetAtTime(0, t, PEN_CUT_TAU);
        // Eight time constants is −70 dB: silent, and then gone.
        s.src.onended = () => {
          for (const n of s.nodes) {
            try {
              n.disconnect();
            } catch {
              /* already gone */
            }
          }
        };
        s.src.stop(t + PEN_CUT_TAU * 8);
      }
    },
  };
}

/**
 * A recorded stroke's pen bed, laid out ahead of time — the replay video's.
 *
 * `points` in base px and `times` in ms, as the recorder keeps them; `rate` is
 * the playback speed-up of the clip's phase (a miss shown at 2.2× is drawn
 * 2.2× faster, and sounds it). The stroke starts at `at` and the bed cuts at
 * its last sample, as the live one cuts at the lift, the death or the win.
 */
export function schedulePenStroke(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  times: readonly number[],
  rate = 1
): void {
  const n = Math.min(points.length, times.length);
  if (n < 2 || !(rate > 0)) return;
  const t0 = times[0];
  const when = (i: number): number => at + (times[i] - t0) / 1000 / rate;
  const voice = startPenVoice(ctx, out, at);

  // The same cadence the live bed updates at, and the same averaging: the
  // distance covered over each window, over the window's time.
  let from = 0;
  let travelled = 0;
  for (let i = 1; i < n; i++) {
    travelled += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const dt = times[i] - times[from];
    if (dt < PEN_UPDATE_S * 1000 && i < n - 1) continue;
    voice.speed(dt > 0 ? (travelled / dt) * rate : 0, when(i));
    from = i;
    travelled = 0;
  }
  voice.cut(when(n - 1));
}

/** The music bus's resting level: well under the effects master at 0.5. */
export const MUSIC_LEVEL = 0.14;

class AudioService {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private enabled = true;
  private step = 0;

  /** The live pen bed, from pen-down to its cut. */
  private pen: PenVoice | null = null;
  /** Context time the bed was last given a speed. */
  private penAt = Number.NEGATIVE_INFINITY;
  /** Speeds that arrived since then, averaged into the next update. */
  private penSum = 0;
  private penN = 0;
  private penStall: ReturnType<typeof setTimeout> | null = null;

  /**
   * The Sound switch. Turning it off mid-stroke silences the pen at once;
   * everything else is a one-shot that checks it as it plays.
   */
  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.penStop();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Create or resume the context. Must be called from inside a real user
   * gesture — iOS refuses to start audio any other way, and a context created
   * at boot arrives permanently suspended.
   *
   * It deliberately does NOT check `enabled`. Sound effects and music are two
   * separate switches, and they share one context: bailing out here when
   * effects are off left a player who wanted only music with no context to play
   * it through, so the music switch did nothing for them.
   */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** Back to the bottom of the scale. Called when a level loads. */
  resetScale(): void {
    this.step = 0;
  }

  /**
   * One obstacle cleared: the next note up. The older call, which counts the
   * rows itself; `rowNote(k)` names the row, so the fold's notch and the note
   * are provably the same one.
   */
  note(): void {
    this.rowNote(this.step);
  }

  /**
   * Row `k` of the phrase (0 = the first obstacle row) was crossed alive: its
   * marimba note. The phrase then continues from k + 1.
   */
  rowNote(k: number): void {
    const step = Math.max(0, Math.floor(k));
    this.step = step + 1;
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleNote(this.ctx, this.master, this.ctx.currentTime, step);
  }

  /**
   * "Close": a scrape survived. Row `k`'s note an octave up — by default the
   * row the phrase last played, which is the one the pen is climbing out of.
   */
  ting(k: number = this.step - 1): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleTing(this.ctx, this.master, this.ctx.currentTime, Math.max(0, Math.floor(k)));
  }

  /** Collision: a dropped pen. Pair it with `tear()` — see scheduleTear. */
  thud(): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleThud(this.ctx, this.master, this.ctx.currentTime);
  }

  /** The death's paper tear, played with the thud. */
  tear(): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleTear(this.ctx, this.master, this.ctx.currentTime);
  }

  /** The board has cleared after a death and the next try is open. */
  tock(): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleTock(this.ctx, this.master, this.ctx.currentTime);
  }

  /** Star `i` (0, 1, 2) punches into the result card: C6, D6, G6. */
  starNote(i: number): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleStarNote(this.ctx, this.master, this.ctx.currentTime, i);
  }

  /**
   * Pen-down: the bed starts, silent until the first speed. A bed still
   * running from a stroke that never reported its end is cut first, so two
   * can never stack.
   */
  penStart(): void {
    this.penStop();
    /*
     * Not `ready()`: that wants a RUNNING context, and the first stroke of a
     * cold start is the touch that is resuming it — the resume resolves a few
     * milliseconds after this. A bed built on a context that is still waking
     * simply starts sounding when it wakes; one that never wakes is cut at the
     * lift like any other.
     */
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state === 'closed') return;
    try {
      this.pen = startPenVoice(this.ctx, this.master, this.ctx.currentTime);
    } catch {
      // A bed that cannot start is a quiet stroke, never a broken one.
      this.pen = null;
    }
    this.penAt = Number.NEGATIVE_INFINITY;
    this.penSum = 0;
    this.penN = 0;
  }

  /**
   * The pen is moving at `v` base px/ms (distance over time between two
   * samples, as the recorder keeps them). Call it on every move; it averages
   * and throttles itself, and glides to silence on its own when the moves
   * stop. `mirror`: whether the reflection's copy sounds — in play, always.
   */
  penSpeed(v: number, mirror = true): void {
    const pen = this.pen;
    if (!pen || !this.ctx) return;
    if (Number.isFinite(v) && v >= 0) {
      this.penSum += v;
      this.penN += 1;
    }
    const now = this.ctx.currentTime;
    if (this.penN > 0 && now - this.penAt >= PEN_UPDATE_S) {
      pen.speed(this.penSum / this.penN, now, mirror);
      this.penAt = now;
      this.penSum = 0;
      this.penN = 0;
    }

    if (this.penStall !== null) clearTimeout(this.penStall);
    this.penStall = setTimeout(() => {
      this.penStall = null;
      if (this.pen !== pen || !this.ctx) return;
      // Not throttled: the first move after a rest should be heard at once.
      pen.speed(0, this.ctx.currentTime, mirror);
      this.penSum = 0;
      this.penN = 0;
    }, PEN_STALL_MS);
  }

  /** A lift, a death or a win: the bed goes with τ = 30 ms. Safe to call at any time. */
  penStop(): void {
    if (this.penStall !== null) {
      clearTimeout(this.penStall);
      this.penStall = null;
    }
    const pen = this.pen;
    this.pen = null;
    if (!pen || !this.ctx) return;
    try {
      pen.cut(this.ctx.currentTime);
    } catch {
      /* a closed context has nothing left to cut */
    }
  }

  /** Whether a pen bed is sounding (pen-down to cut). */
  get penning(): boolean {
    return this.pen !== null;
  }

  /** The level is beaten. Taller when they took the medal with it. */
  celebrate(medal: boolean): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleCelebration(this.ctx, this.master, this.ctx.currentTime, medal);
  }

  /** A reward token landed. UI.flyReward plays it on the first and last token only. */
  pop(): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    schedulePop(this.ctx, this.master, this.ctx.currentTime);
  }

  /** A purchase landed, a chapter completed, a milestone reached. */
  reward(): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleReward(this.ctx, this.master, this.ctx.currentTime);
  }

  /** The streak counter went up. */
  streakUp(): void {
    if (!this.ready() || !this.ctx || !this.master) return;
    scheduleStreakUp(this.ctx, this.master, this.ctx.currentTime);
  }

  /**
   * A bus on the SHARED context for a long-running voice.
   *
   * The music needs somewhere to play that is not the effects master, so its
   * level can sit under the effects without turning them down too, and so
   * muting one leaves the other alone. Returns null until a gesture has
   * unlocked the context — the caller is expected to ask again.
   */
  musicBus(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    if (!this.music) {
      this.music = this.ctx.createGain();
      // Well under the effects master at 0.5: this plays continuously, and a
      // bed you notice is a bed you turn off. Music.duck lowers it further
      // while the pen is down.
      this.music.gain.value = MUSIC_LEVEL;
      this.music.connect(this.ctx.destination);
    }
    return { ctx: this.ctx, out: this.music };
  }

  private ready(): boolean {
    return this.enabled && this.ctx !== null && this.ctx.state === 'running';
  }
}

export const Audio = new AudioService();
