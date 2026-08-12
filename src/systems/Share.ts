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
