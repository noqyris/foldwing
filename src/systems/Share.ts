/**
 * Share — putting a figure somewhere other people will see it.
 *
 * This is the growth loop, so it has to be one tap and it has to produce an
 * image that stands on its own in a feed. On device the PNG is written to cache
 * and handed to the native share sheet; on the web it falls back to the Web
 * Share API and then to a download, so the button is never dead.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share as NativeShare } from '@capacitor/share';

const isNative = (): boolean => Capacitor.isNativePlatform();

function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const base64 = stripDataUrl(dataUrl);
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: 'image/png' });
}

/**
 * The name a shared file goes out under: `Foldwing - First reflection.png`.
 *
 * iOS titles the share sheet with the file's name and hands the same name to
 * whoever receives the file, so `foldwing-l1-1790060455955` — an id and an epoch
 * — was the first thing anyone saw of a figure. The game and the fold read as
 * what they are. Only what a file system or a file URL would object to is
 * dropped; writing the same name twice just replaces a cache file that has
 * already been handed over.
 */
export function shareFileName(foldName: string, ext: 'png' | 'mp4'): string {
  const clean = foldName
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return `Foldwing - ${clean || 'a fold'}.${ext}`;
}

/**
 * How long a screen ignores taps after a share settles.
 *
 * iOS 26 presents the share sheet as a partial sheet with no dimming, and the
 * tap that dismisses it by touching the page above it ALSO reaches the page —
 * so "close the share sheet" was read as whatever that tap would otherwise
 * have meant: the next fold, or the card under the finger.
 */
export const SHARE_QUIET_MS = 400;

/**
 * How long a tap on a way OUT (‹) that lands while a share is up waits for the
 * share to settle before it is believed.
 *
 * That tap reaches the page before the share settles — the sheet reports its
 * dismissal only once it has animated away — so at the moment it lands, "the
 * tap that closed the sheet" and "a player leaving a share that never settled"
 * look the same. The first settles within this window; the second does not,
 * and ‹ still has to work then, or a stuck share traps the player. Measured on
 * the iOS 26.5 simulator: the share settles 0.56–0.58s after the dismissing
 * tap lifts (four of four, win screen and Gallery), so this is twice that.
 */
export const SHARE_DISMISS_WAIT_MS = 1200;

/**
 * Whether `pending` settles — either way — within `ms` of now.
 *
 * Wall clock: the game loop may be throttled while a system sheet is up, and a
 * scene timer would stretch with it.
 */
export function settlesWithin(pending: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    const settled = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    pending.then(settled, settled);
  });
}

export interface ShareRequest {
  readonly dataUrl: string;
  readonly title: string;
  readonly text: string;
  readonly fileName: string;
}

export interface VideoShareRequest {
  readonly blob: Blob;
  readonly title: string;
  readonly text: string;
  readonly fileName: string;
}

/**
 * A Blob as base64, in chunks.
 *
 * The native bridge takes base64, not bytes, and the obvious
 * `String.fromCharCode(...bytes)` blows the argument limit and throws on
 * anything above a few hundred kilobytes — which every video is.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

class ShareService {
  get available(): boolean {
    return (
      isNative() ||
      typeof navigator !== 'undefined' ||
      typeof document !== 'undefined'
    );
  }

  /** @returns true if the image reached a share sheet, false if it only saved. */
  async shareFigure(req: ShareRequest): Promise<boolean> {
    if (isNative()) return this.shareNative(req);
    return this.shareWeb(req);
  }

  /**
   * Send an MP4 to the share sheet.
   *
   * The same path the image takes, and deliberately so: the OS sheet is the
   * only universal share mechanism there is. It reaches TikTok, Instagram,
   * WhatsApp, Messages, Telegram, X, Discord and Save to Files without one line
   * of platform SDK, and every one of those composers accepts H.264 in MP4.
   * Per-platform kits only buy a deep link into one app's composer, at the cost
   * of an SDK, a registered key and their review — worth doing later, if the
   * numbers ask for it, and never instead of this.
   */
  async shareVideo(req: VideoShareRequest): Promise<boolean> {
    try {
      if (isNative()) {
        // Cache, not Documents: a derived artefact the player can regenerate
        // has no business surviving in their file provider.
        const written = await Filesystem.writeFile({
          path: req.fileName,
          data: await blobToBase64(req.blob),
          directory: Directory.Cache,
        });
        await NativeShare.share({
          title: req.title,
          text: req.text,
          files: [written.uri],
          dialogTitle: req.title,
        });
        return true;
      }

      const file = new File([req.blob], req.fileName, { type: 'video/mp4' });
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean;
        share?: (d: ShareData) => Promise<void>;
      };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ title: req.title, text: req.text, files: [file] });
        return true;
      }

      // No share sheet here — save it, so the button still does something.
      const url = URL.createObjectURL(req.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = req.fileName;
      a.click();
      URL.revokeObjectURL(url);
      return false;
    } catch {
      // A cancelled share sheet throws too, and that is not an error worth
      // showing anyone.
      return false;
    }
  }

  /**
   * Plain text, no image — for spoiler-safe results that should paste into a
   * group chat as text (the daily). Falls back to the clipboard on platforms
   * without a share sheet, so the button always yields something pasteable.
   */
  async shareText(title: string, text: string): Promise<boolean> {
    try {
      if (isNative()) {
        await NativeShare.share({ title, text, dialogTitle: title });
        return true;
      }
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (nav.share) {
        await nav.share({ title, text });
        return true;
      }
      await navigator.clipboard?.writeText(text);
      return false;
    } catch {
      return false;
    }
  }

  private async shareNative(req: ShareRequest): Promise<boolean> {
    try {
      // Cache, not Documents: this is a derived artefact the user can always
      // regenerate, so it has no business surviving in their file provider.
      const written = await Filesystem.writeFile({
        path: req.fileName,
        data: stripDataUrl(req.dataUrl),
        directory: Directory.Cache,
      });

      await NativeShare.share({
        title: req.title,
        text: req.text,
        files: [written.uri],
        dialogTitle: req.title,
      });
      return true;
    } catch {
      // A cancelled share sheet throws too, and that is not an error worth
      // showing anyone.
      return false;
    }
  }

  private async shareWeb(req: ShareRequest): Promise<boolean> {
    const blob = dataUrlToBlob(req.dataUrl);
    const file = new File([blob], req.fileName, { type: 'image/png' });

    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };

    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ title: req.title, text: req.text, files: [file] });
        return true;
      } catch {
        return false;
      }
    }

    // No share sheet here — save it, so the button still does something.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = req.fileName;
    a.click();
    URL.revokeObjectURL(url);
    return false;
  }
}

export const Share = new ShareService();
