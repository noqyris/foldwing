/**
 * Music — a slow bed, generated rather than looped.
 *
 * WHY GENERATED. A file would be the obvious answer and is the wrong one here.
 * Nothing else in this game ships as audio: the notes, the thud and the chime
 * are all synthesised, which is why a cold start is under a second and why the
 * replay video can re-render the exact same sounds offline. A track would also
 * be the single largest asset in the bundle, and licensed music is a liability
 * that outlives whoever chose it.
 *
 * The received wisdom for a slow puzzle screen is a 60–120 second loop: long
 * enough to have an arc before it returns. A generated bed has no return at
 * all, so there is no loop point for the ear to catch and start waiting for —
 * which is the actual failure mode of background music in a game people play
 * for forty minutes at a stretch.
 *
 * IT SHARES THE GAME'S KEY. The pads are built from the same pentatonic set and
 * the same root as `Audio`'s gameplay notes, an octave or two below them. So
 * the phrase a player hears as they clear obstacle rows lands in key over the
 * bed instead of against it — the music and the game are one instrument, not
 * two playing at once.
 *
 * IT IS DELIBERATELY QUIET AND SLOW. A bed you notice is a bed you turn off.
 */
import { Audio, MUSIC_LEVEL } from './Audio';
import { gameLoopPaused } from './gameLoop';

/** Same set and root as the gameplay voice — see Audio. */
const PENTATONIC = [0, 2, 4, 7, 9];
const ROOT_HZ = 261.63; // C4

/**
 * Two octaves below the gameplay phrase, which climbs from C4 to A6.
 *
 * The bed has to sit under that without ever crossing it, or a pad note and a
 * cleared-row note land on the same pitch and the player hears the game answer
 * itself.
 */
const BASS_OCTAVE = -2;
const PAD_OCTAVE = -1;

/** Slow enough to be weather rather than melody. */
export const BAR_SECONDS = 7.5;
/**
 * Long attack and release, so consecutive bars overlap into one wash.
 *
 * SUSTAIN is longer than BAR_SECONDS on purpose: each bar is still ringing when
 * the next swells in, which is what makes the bed continuous rather than a
 * sequence of separate chords.
 */
const ATTACK = 2.2;
const RELEASE = 2.8;
const SUSTAIN = 9.5;
/** Per-voice peak. The music bus is already well under the effects master. */
const VOICE_PEAK = 0.055;

/**
 * Deterministic pseudo-randomness from the bar number.
 *
 * Not `Math.random`: the same bar has to sound the same every time so the
 * progression can be reasoned about and tested, while still never repeating
 * audibly. A hash of the index gives both.
 */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000;
}

/**
 * The voicing for one bar, as semitone offsets from the root.
 *
 * Always anchored: the root or the fifth is always present, so consecutive bars
 * never drift into sounding like a different key. The two upper voices move
 * within the pentatonic set, which cannot produce a semitone clash against
 * anything the gameplay plays.
 */
export function chordAt(bar: number): number[] {
  const anchor = hash(bar) < 0.62 ? 0 : 7;
  const a = PENTATONIC[Math.floor(hash(bar * 3 + 1) * PENTATONIC.length)];
  const b = PENTATONIC[Math.floor(hash(bar * 7 + 2) * PENTATONIC.length)];
  const voices = [anchor + BASS_OCTAVE * 12, a + PAD_OCTAVE * 12, b + PAD_OCTAVE * 12];
  // A duplicated pitch is a wasted voice and a doubled level, not a chord.
  return [...new Set(voices)];
}

/**
 * One pad voice: swell in, hold, fall away.
 *
 * It does NOT reuse `scheduleTone`. That envelope reaches full level in 10ms,
 * which is right for a note that marks an event and wrong for a bed — struck
 * pads read as a bell every seven seconds, which is the opposite of weather.
 * The attack here is measured in seconds, and consecutive bars overlap on their
 * tails so the bed never actually stops and restarts.
 *
 * A lowpass takes the edge off the sine's upper partials; without it the higher
 * voices sit forward of the gameplay notes they are supposed to sit behind.
 */
function schedulePad(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  hz: number
): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = hz;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.max(500, hz * 4);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(VOICE_PEAK, at + ATTACK);
  gain.gain.setValueAtTime(VOICE_PEAK, at + SUSTAIN - RELEASE);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + SUSTAIN);

  osc.connect(lp).connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + SUSTAIN + 0.05);
}

/** Lay one bar down on any context. */
export function scheduleBar(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  bar: number
): void {
  for (const semi of chordAt(bar)) {
    schedulePad(ctx, out, at, ROOT_HZ * Math.pow(2, semi / 12));
  }
}

/**
 * How far ahead the scheduler writes, and how often it wakes.
 *
 * Web Audio is sample-accurate only for events booked in advance, and a phone
 * that throttles timers in the background would otherwise leave audible gaps.
 * Booking two bars ahead means a tab can miss several wake-ups and still not
 * stutter.
 */
const LOOKAHEAD_SECONDS = BAR_SECONDS * 2;
const TICK_MS = 1000;

/**
 * How long `stop` takes to bring what is already booked down to silence.
 *
 * Short, because the lookahead is not: two bars ahead at nine and a half
 * seconds each is up to twenty-four seconds of bed that "stop scheduling" alone
 * would leave playing — under a full-screen ad, chords that had not even begun
 * yet swelled in over it. Long enough not to click.
 */
const STOP_FADE_SECONDS = 0.3;

/*
 * THE DUCK. While the pen is down the bed steps back — the music bus from
 * 0.14 to half that over 150 ms — so the pen on the paper and the phrase of
 * row notes come forward: for those seconds they are the music. It comes back
 * only after 600 ms of the pen being up, because a death and the retry that
 * follows it are one breath, and a bed that surged up and down between every
 * attempt would pump like a compressor.
 *
 * The bus, not this service's own bed node: `stop` fades the bed node to
 * silence and a start makes a fresh one, and a duck on it would be lost to
 * either. The bus outlives both.
 */
export const DUCK_LEVEL = MUSIC_LEVEL / 2;
export const DUCK_DOWN_SECONDS = 0.15;
export const DUCK_HOLD_MS = 600;
/** The return is slower than the dip: a swell back, not a jump. */
export const DUCK_UP_SECONDS = 0.4;

class MusicService {
  private enabled = false;
  private timer: number | null = null;
  private nextBar = 0;
  private nextAt = 0;
  private watching = false;
  /**
   * The node every booked bar plays through: made fresh by the first tick after
   * a start, faded out and dropped by stop. Owning it is what makes a stop
   * cancel bars that were booked seconds ahead — and what keeps a restart from
   * booking a second bed on top of one that is still waiting to play.
   */
  private bed: { ctx: BaseAudioContext; gain: GainNode } | null = null;
  /** Whether the bus is down (or on its way down) for a stroke. */
  private ducked = false;
  private duckReturn: ReturnType<typeof setTimeout> | null = null;

  setEnabled(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v;
    if (v) this.start();
    else this.stop();
  }

  /**
   * Stop scheduling while the app is not on screen.
   *
   * iOS suspends the context on its own, so this is not about silence — it is
   * about not waking a timer every second in a backgrounded app for hours. On
   * return the clock has run on without us, which `tick` re-anchors.
   */
  private watchVisibility(): void {
    if (this.watching || typeof document === 'undefined') return;
    this.watching = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.enabled) return;
      if (document.hidden) {
        this.stop();
        return;
      }
      /*
       * Resume the context, not just the timer.
       *
       * The browser suspends an AudioContext when the app goes to the
       * background, and a suspended context is one the bus refuses to hand
       * out — so without this the scheduler would wake up, find no bus, and
       * quietly do nothing for the rest of the session. The music would stop
       * for good the first time the player took a phone call, and nothing
       * about that would look like a bug from the outside.
       *
       * `unlock` resumes an existing context and is safe to call repeatedly.
       */
      Audio.unlock();
      this.start();
    });
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Begin, or pick up where the schedule left off.
   *
   * Safe to call repeatedly and safe to call before a gesture has unlocked the
   * context: with no bus yet it simply keeps waiting, and the first tick after
   * the player touches anything starts the bed.
   */
  start(): void {
    this.watchVisibility();
    if (!this.enabled || this.timer !== null) return;
    /*
     * Never under a full-screen ad. The ad layer pauses the game loop for
     * exactly as long as one owns the screen, and the bed is part of the game.
     * A trip to the background and back while the ad was still up used to
     * restart it here, from the visibility handler, under the ad; the ad
     * layer's own start, once the ad is gone, is the one that counts.
     */
    if (gameLoopPaused()) return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nextAt = 0;
    // What is already booked goes too, on a short fade rather than a cut — see
    // STOP_FADE_SECONDS. The next start books onto a fresh node.
    const bed = this.bed;
    this.bed = null;
    if (!bed) return;
    try {
      const now = bed.ctx.currentTime;
      const level = bed.gain.gain;
      level.cancelScheduledValues(now);
      level.setValueAtTime(level.value, now);
      level.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
    } catch {
      /* a closed context has nothing left to fade */
    }
    // Wall time, not audio time: a suspended context never reaches the end of
    // its ramp, and the node has to go either way.
    setTimeout(() => {
      try {
        bed.gain.disconnect();
      } catch {
        /* already gone */
      }
    }, STOP_FADE_SECONDS * 1000 + 100);
  }

  /**
   * The pen is down (`true`) or up (`false`) — see THE DUCK.
   *
   * Down only when there is something to make room for: with the Sound switch
   * off there is no pen and no phrase, and a bed that dipped for nothing would
   * sound like a fault. Up always comes back, whatever the switches did in
   * between, so the bus can never be left at half.
   */
  duck(on: boolean): void {
    if (this.duckReturn !== null) {
      clearTimeout(this.duckReturn);
      this.duckReturn = null;
    }
    if (on) {
      if (!Audio.isEnabled) return;
      this.ducked = true;
      this.rampBus(DUCK_LEVEL, DUCK_DOWN_SECONDS);
      return;
    }
    if (!this.ducked) return;
    this.duckReturn = setTimeout(() => {
      this.duckReturn = null;
      this.ducked = false;
      this.rampBus(MUSIC_LEVEL, DUCK_UP_SECONDS);
    }, DUCK_HOLD_MS);
  }

  /** Glide the music bus to `level` from wherever it is now. */
  private rampBus(level: number, seconds: number): void {
    const bus = Audio.musicBus();
    if (!bus) return;
    try {
      const now = bus.ctx.currentTime;
      const g = bus.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(level, now + seconds);
    } catch {
      /* a closed context has no bus to move */
    }
  }

  /** The node this run's bars play through, made on first use. */
  private bedFor(ctx: BaseAudioContext, out: AudioNode): GainNode {
    if (this.bed && this.bed.ctx === ctx) return this.bed.gain;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(out);
    this.bed = { ctx, gain };
    return gain;
  }

  private tick(): void {
    if (!this.enabled) return;
    const bus = Audio.musicBus();
    if (!bus) {
      // Either no gesture has happened yet, or the context suspended while we
      // were away. The second is recoverable and the first is not, and calling
      // unlock costs nothing in the case where it cannot help.
      Audio.unlock();
      return;
    }

    const { ctx, out } = bus;
    const now = ctx.currentTime;
    // A first start, or a return from a suspend that ran the clock on without
    // us. Re-anchor rather than booking a burst of bars that are already late.
    if (this.nextAt < now) this.nextAt = now + 0.05;

    const bed = this.bedFor(ctx, out);
    while (this.nextAt < now + LOOKAHEAD_SECONDS) {
      scheduleBar(ctx, bed, this.nextAt, this.nextBar);
      this.nextBar += 1;
      this.nextAt += BAR_SECONDS;
    }
  }
}

export const Music = new MusicService();

/** How long after the last bar begins the bed is finally silent. */
export const BAR_TAIL_SECONDS = SUSTAIN;
