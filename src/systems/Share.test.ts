/*
 * iOS titles the share sheet with the shared file's name and hands the same
 * name to whoever receives it — so the name is the first thing anyone sees of
 * a figure, and `foldwing-l1-1790060455955` said nothing a person could read.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: {} }));
vi.mock('@capacitor/share', () => ({ Share: {} }));

import { settlesWithin, SHARE_DISMISS_WAIT_MS, SHARE_QUIET_MS, shareFileName } from './Share';

describe('the shared file name', () => {
  it('reads as the game and the fold', () => {
    expect(shareFileName('First reflection', 'png')).toBe('Foldwing - First reflection.png');
    expect(shareFileName('Gate', 'mp4')).toBe('Foldwing - Gate.mp4');
  });

  it('carries no id and no timestamp', () => {
    expect(shareFileName('Slow arc', 'png')).not.toMatch(/\d{6,}|l\d+-/);
  });

  it('drops what a file system or a file URL would object to', () => {
    expect(shareFileName('a/b:c*d?"e"<f>|g\\h', 'png')).toBe('Foldwing - a b c d e f g h.png');
    expect(shareFileName('  two   spaces  ', 'png')).toBe('Foldwing - two spaces.png');
  });

  it('still names a fold whose name is empty or all punctuation', () => {
    expect(shareFileName('', 'png')).toBe('Foldwing - a fold.png');
    expect(shareFileName('///', 'mp4')).toBe('Foldwing - a fold.mp4');
  });

  it('keeps an absurdly long name to a sane length', () => {
    expect(shareFileName('x'.repeat(500), 'png').length).toBeLessThanOrEqual('Foldwing - .png'.length + 60);
  });
});

/*
 * The tap that closes an iOS 26 share sheet reaches the page too, BEFORE the
 * share settles. A ‹ tap that lands while a share is up waits to see whether
 * the share settles — it closed the sheet — or not — the share is stuck and the
 * player is leaving.
 */
describe('settlesWithin', () => {
  it('says yes for a share that resolves in time', async () => {
    vi.useFakeTimers();
    try {
      let done = (): void => undefined;
      const share = new Promise<void>((r) => (done = r));
      const verdict = settlesWithin(share, 1000);
      await vi.advanceTimersByTimeAsync(350);
      done();
      await expect(verdict).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says yes for a share that is cancelled in time — a rejection is settling too', async () => {
    vi.useFakeTimers();
    try {
      let cancel = (_e: unknown): void => undefined;
      const share = new Promise<void>((_r, j) => (cancel = j));
      const verdict = settlesWithin(share, 1000);
      await vi.advanceTimersByTimeAsync(300);
      cancel(new Error('Share canceled'));
      await expect(verdict).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says no for a share that never settles, so the way out still works', async () => {
    vi.useFakeTimers();
    try {
      const verdict = settlesWithin(new Promise<void>(() => undefined), 1000);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(verdict).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits longer than the quiet window, and not long enough to feel stuck', () => {
    expect(SHARE_DISMISS_WAIT_MS).toBeGreaterThan(SHARE_QUIET_MS);
    expect(SHARE_DISMISS_WAIT_MS).toBeLessThanOrEqual(1500);
  });
});
