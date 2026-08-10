/**
 * Audio — one note per obstacle safely passed.
 *
 * The scale climbs as the stroke does and resets each level, so a clean run
 * plays a rising phrase and the player hears their own progress before they see
 * it. Nothing loops, nothing plays on the menu: the sound only ever marks
 * something the player did.
 *
 * On collision, a short damped thud. Not a buzzer — a buzzer is a punishment,
 * and this game asks you to fail dozens of times a minute. It has to sound like
 * a dropped pen, not an alarm.
 *
 * Synthesised through Web Audio rather than loaded as files: five notes and a
 * thud would otherwise be five HTTP requests and a decode on a cold start that
 * is currently under a second.
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

class AudioService {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private step = 0;

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Create or resume the context. Must be called from inside a real user
   * gesture — iOS refuses to start audio any other way, and a context created
   * at boot arrives permanently suspended.
   */
  unlock(): void {
    if (!this.enabled) return;
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

  /** One obstacle cleared: the next note up. */
  note(): void {
    if (!this.ready()) return;
    const hz = ROOT_HZ * Math.pow(2, semitone(this.step) / 12);
    this.step += 1;
    this.tone(hz, 0.55, 0.16, 'triangle');
    // A quiet octave above gives the note a little shine without a second voice
    // being audible as a separate sound.
    this.tone(hz * 2, 0.32, 0.045, 'sine');
  }

  /** Collision: a dropped pen. */
  thud(): void {
    if (!this.ready()) return;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;

    // Body: a low tone that falls as it decays.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.16);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + 0.24);

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
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    noise.connect(lp).connect(noiseGain).connect(master);
    noise.start(now);
    noise.stop(now + 0.06);
  }

  /** A soft mark for the win, under the figure rather than over it. */
  chime(): void {
    if (!this.ready()) return;
    const root = ROOT_HZ * 2;
    [0, 4, 7].forEach((semi, i) => {
      window.setTimeout(() => {
        this.tone(root * Math.pow(2, semi / 12), 0.9, 0.09, 'sine');
      }, i * 90);
    });
  }

  private tone(
    hz: number,
    seconds: number,
    peak: number,
    type: OscillatorType
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + seconds + 0.02);
  }

  private ready(): boolean {
    return this.enabled && this.ctx !== null && this.ctx.state === 'running';
  }
}

export const Audio = new AudioService();
