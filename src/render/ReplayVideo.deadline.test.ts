/*
 * iOS 26's AAC encoder reports "Cannot create array buffer for WebCodecs
 * encoder description" to its error callback and then never settles its flush.
 * The replay waited on that flush forever, under a modal card that covers the
 * back button. These pin the two things that stop it: every wait in the render
 * is bounded (and can be cancelled), and a soundtrack that will not encode
 * costs the clip its sound, never the clip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The painters the clip shares with the game reach the look kit, whose
// modules import Phaser at load; nothing here draws, so a stand-in will do.
vi.mock('phaser', () => ({ default: {} }));
import { encodeSoundtrack, settleWithin } from './ReplayVideo';

type Init = { output: (chunk: unknown, meta?: unknown) => void; error: (e: unknown) => void };

/** An AAC encoder that behaves: one chunk per AudioData, flush settles. */
class GoodEncoder {
  static closed = 0;
  encodeQueueSize = 0;
  constructor(private readonly init: Init) {}
  static async isConfigSupported(): Promise<{ supported: boolean }> {
    return { supported: true };
  }
  configure(): void {}
  encode(): void {
    this.init.output({ bytes: 1 }, { decoderConfig: {} });
  }
  async flush(): Promise<void> {}
  close(): void {
    GoodEncoder.closed += 1;
  }
}

/** iOS 26: an error on configure, and a flush that never settles. */
class HungEncoder {
  static closed = 0;
  encodeQueueSize = 0;
  constructor(private readonly init: Init) {}
  static async isConfigSupported(): Promise<{ supported: boolean }> {
    return { supported: true };
  }
  configure(): void {
    setTimeout(() => this.init.error(new Error('Cannot create array buffer for WebCodecs encoder description')), 5);
  }
  encode(): void {}
  flush(): Promise<void> {
    return new Promise(() => {});
  }
  close(): void {
    HungEncoder.closed += 1;
  }
}

/** Worse: no error at all, and still a flush that never settles. */
class SilentHungEncoder extends HungEncoder {
  override configure(): void {}
}

class FakeAudioData {
  close(): void {}
}

const second = { getChannelData: () => new Float32Array(44100) };
const g = globalThis as unknown as { AudioEncoder?: unknown; AudioData?: unknown };

describe('the soundtrack encode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    g.AudioData = FakeAudioData;
    GoodEncoder.closed = 0;
    HungEncoder.closed = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete g.AudioEncoder;
    delete g.AudioData;
  });

  it('hands back every chunk from an encoder that behaves, and closes it', async () => {
    g.AudioEncoder = GoodEncoder;
    const chunks = await encodeSoundtrack(second, 5000);
    expect(chunks?.length).toBe(10); // a tenth of a second per AudioData
    expect(GoodEncoder.closed).toBe(1);
  });

  it('gives up on an encoder that errors and never flushes — the iOS 26 case', async () => {
    g.AudioEncoder = HungEncoder;
    let result: unknown = 'pending';
    void encodeSoundtrack(second, 5000).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(10);
    // The error callback ends the wait at once; it is no longer swallowed.
    expect(result).toBeNull();
    expect(HungEncoder.closed).toBe(1);
  });

  it('gives up at its deadline on an encoder that never answers at all', async () => {
    g.AudioEncoder = SilentHungEncoder;
    let result: unknown = 'pending';
    void encodeSoundtrack(second, 5000).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(4999);
    expect(result).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
    expect(HungEncoder.closed).toBe(1);
  });

  it('stops the moment the player cancels', async () => {
    g.AudioEncoder = SilentHungEncoder;
    const stop = new AbortController();
    let result: unknown = 'pending';
    void encodeSoundtrack(second, 5000, stop.signal).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(100);
    stop.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBeNull();
  });

  it('answers null where there is no audio encoder at all', async () => {
    expect(await encodeSoundtrack(second, 5000)).toBeNull();
  });
});

describe('a bounded wait', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes a value through when the work settles in time', async () => {
    await expect(settleWithin(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it('rejects at the deadline when the work never settles', async () => {
    const waiting = settleWithin(new Promise(() => {}), 1000);
    const seen = waiting.then(() => 'resolved', () => 'rejected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await seen).toBe('rejected');
  });

  it('rejects on an abort, and at once when already aborted', async () => {
    const stop = new AbortController();
    const waiting = settleWithin(new Promise(() => {}), 60_000, stop.signal);
    const seen = waiting.then(() => 'resolved', () => 'rejected');
    stop.abort();
    expect(await seen).toBe('rejected');
    await expect(settleWithin(Promise.resolve(1), 1000, stop.signal)).rejects.toThrow();
  });
});
