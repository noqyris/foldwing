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
