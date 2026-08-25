import type { AspectRatio } from '../services/providers/types';
import { clippedShare, dampenGlare } from './tone';

const RATIOS: Array<[AspectRatio, number]> = [
  ['21:9', 21 / 9], ['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3],
  ['5:4', 5 / 4], ['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4],
  ['2:3', 2 / 3], ['9:16', 9 / 16],
];

/**
 * Nächstliegendes unterstütztes Seitenverhältnis.
 *
 * Vorher stand in callGeminiApi für jede Aufgabe fest "16:9". Ein 4:3-Foto
 * wurde dadurch beschnitten oder das Modell dichtete Bildinhalt dazu.
 */
export function nearestAspectRatio(width: number, height: number): AspectRatio {
  const target = width / height;
  let best = RATIOS[0];
  let bestDelta = Infinity;
  for (const entry of RATIOS) {
    const delta = Math.abs(Math.log(target / entry[1]));
    if (delta < bestDelta) { bestDelta = delta; best = entry; }
  }
  return best[0];
}

export interface PreparedImage {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  aspectRatio: AspectRatio;
  bytes: number;
  /** Anteil ausgebrannter Fläche vor der Dämpfung, 0 bis 1. */
  clipped: number;
}

async function decode(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Berücksichtigt EXIF-Rotation, sonst kommen Hochkantfotos gedreht an.
      return await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch { /* Fallback unten */ }
  }
  const url = URL.createObjectURL(source);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Verkleinert auf maxEdge und kodiert als JPEG.
 *
 * Ein 12-MP-Handyfoto schrumpft von rund 4 MB auf etwa 350 KB. Das Neu-Encoden
 * über Canvas entfernt ausserdem alle EXIF-Daten inklusive GPS-Koordinaten –
 * Geodaten in Exposéfotos sind ein reales Leck.
 */
export async function prepareImage(
  source: Blob,
  maxEdge = 1568,
  quality = 0.92,
  /** Spitzlichter vor dem Upload herunterziehen. Siehe utils/tone.ts. */
  glare = 0
): Promise<PreparedImage> {
  const bitmap = await decode(source);
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas nicht verfügbar.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  if ('close' in bitmap) bitmap.close();

  const clipped = clippedShare(ctx, width, height);
  if (glare > 0) dampenGlare(ctx, width, height, { strength: glare });

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

  return {
    base64,
    mimeType: 'image/jpeg',
    width,
    height,
    aspectRatio: nearestAspectRatio(srcW, srcH),
    bytes: Math.round((base64.length * 3) / 4),
    clipped,
  };
}

/** Cache-Schlüssel aus Bildinhalt, Prompt und Modell. */
export async function hashRequest(parts: string[]): Promise<string> {
  const text = parts.join('\u0000');
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function toDataUrl(base64: string, mimeType = 'image/jpeg'): string {
  return `data:${mimeType};base64,${base64}`;
}

export function fromDataUrl(dataUrl: string): { base64: string; mimeType: string } {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return { base64: dataUrl, mimeType: 'image/jpeg' };
  return { base64: match[2], mimeType: match[1] || 'image/jpeg' };
}
