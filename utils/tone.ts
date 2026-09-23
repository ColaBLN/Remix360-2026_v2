/**
 * Glanzdämpfung.
 *
 * Warum das kein Prompt-Problem ist: In typischen Handyaufnahmen ist der
 * Sonnenfleck auf lackiertem Parkett auf 255,255,255 ausgebrannt. Dort steckt
 * keine Information mehr. Ein Bildmodell kann diese Maserung nur erfinden — und
 * genau das verbieten wir ihm im selben Prompt. Ausserdem liest sich reines
 * Weiss für das Modell als korrekt belichtet; es sieht keinen Fehler.
 *
 * Deshalb wird der Glanz vor dem Upload heruntergezogen. Das Modell bekommt
 * dann eine hellgraue Fläche statt eines weissen Lochs. Auf Grau malt es
 * bereitwillig Struktur, auf Weiss nicht.
 *
 * Läuft lokal auf Canvas: kostenlos, sofort, deterministisch.
 */

/** Rec. 709 – entspricht der menschlichen Helligkeitswahrnehmung. */
function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface GlareOptions {
  /** Ab welcher Helligkeit überhaupt geprüft wird. */
  threshold?: number;
  /** Maximaler Abzug in Helligkeitsanteilen. */
  maxDrop?: number;
  /** 0 = aus, 1 = volle Wirkung. */
  strength?: number;
}

/**
 * Erzeugt eine grobe Karte der lokalen Durchschnittshelligkeit.
 *
 * Das ist das Merkmal, das eine weisse Wand von einem Spiegelglanz trennt:
 * Eine Wand ist grossflächig gleichmässig hell, ihr Wert entspricht also der
 * lokalen Umgebung. Ein Sonnenfleck auf dem Boden ist deutlich heller als
 * alles um ihn herum. Eine reine Helligkeitskurve kann beides nicht
 * auseinanderhalten und würde weisse Wände mit vergrauen.
 */
function localMeanMap(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): { data: Uint8ClampedArray; w: number; h: number } | null {
  const w = Math.max(1, Math.round(width / 24));
  const h = Math.max(1, Math.round(height / 24));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d');
  if (!sctx) return null;
  // Das Herunterskalieren übernimmt die Mittelwertbildung.
  sctx.drawImage(canvas, 0, 0, w, h);
  return { data: sctx.getImageData(0, 0, w, h).data, w, h };
}

/**
 * Zieht Spitzlichter herunter, ohne Farben oder Wände zu verfälschen.
 *
 * Gedämpft wird nur, was deutlich heller ist als seine Umgebung. Der Abzug ist
 * oberhalb der Übergangszone konstant, dadurch bleibt die lokale Steigung bei
 * eins und die verbliebene Maserung erhalten.
 */
export function dampenGlare(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  { threshold = 0.82, maxDrop = 0.16, strength = 1 }: GlareOptions = {},
  /** Nur für Tests: ersetzt die aus dem Canvas gewonnene Umgebungskarte. */
  meanOverride?: { data: Uint8ClampedArray; w: number; h: number } | null
): void {
  if (strength <= 0) return;

  const mean = meanOverride ?? localMeanMap(ctx.canvas, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;

  // Helligkeit der Umgebungskarte einmal vorab berechnen.
  let meanL: Float32Array | null = null;
  if (mean) {
    meanL = new Float32Array(mean.w * mean.h);
    for (let k = 0; k < meanL.length; k++) {
      const mi = k * 4;
      meanL[k] = luminance(mean.data[mi], mean.data[mi + 1], mean.data[mi + 2]);
    }
  }

  for (let y = 0; y < height; y++) {
    // Bilinear statt nächster Nachbar.
    //
    // Bis 5.4.0 bekam jeder 24 x 24-Pixel-Block denselben Vergleichswert.
    // An einem scharfkantigen Sonnenfleck sprang die Dämpfung dadurch an den
    // Blockgrenzen um bis zu 45 Helligkeitsstufen – sichtbar als kleine
    // Vierecke genau in den neu erzeugten Lichtflächen. Mit weicher
    // Überblendung verschwindet das Muster (gemessen 8 statt 45 Stufen,
    // gleichauf mit dem übrigen Bild).
    let fy = 0, y0 = 0, y1 = 0, ay = 0;
    if (mean) {
      fy = Math.min(mean.h - 1, Math.max(0, (y + 0.5) * mean.h / height - 0.5));
      y0 = Math.floor(fy);
      y1 = Math.min(mean.h - 1, y0 + 1);
      ay = fy - y0;
    }

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const l = luminance(r, g, b);
      if (l <= threshold) continue;

      let localL = 0;
      if (mean && meanL) {
        const fx = Math.min(mean.w - 1, Math.max(0, (x + 0.5) * mean.w / width - 0.5));
        const x0 = Math.floor(fx);
        const x1 = Math.min(mean.w - 1, x0 + 1);
        const ax = fx - x0;
        const top = meanL[y0 * mean.w + x0] * (1 - ax) + meanL[y0 * mean.w + x1] * ax;
        const bottom = meanL[y1 * mean.w + x0] * (1 - ax) + meanL[y1 * mean.w + x1] * ax;
        localL = top * (1 - ay) + bottom * ay;
      }

      // Wie stark hebt sich der Punkt von seiner Umgebung ab?
      const excess = l - localL;
      if (excess <= 0) continue;

      const standsOut = smoothstep(0.05, 0.18, excess);
      // Übergangszone früh gesättigt: darüber wirkt nur der konstante Abzug,
      // sonst würde die Restmaserung mitzusammengedrückt.
      const isBright = smoothstep(threshold, Math.min(1, threshold + 0.08), l);
      const amount = standsOut * isBright * strength;
      if (amount <= 0) continue;

      const factor = Math.max(0, l - maxDrop * amount) / l;
      d[i] = Math.min(255, r * factor);
      d[i + 1] = Math.min(255, g * factor);
      d[i + 2] = Math.min(255, b * factor);
    }
  }

  ctx.putImageData(img, 0, 0);
}

/** Anteil der Bildfläche, der als ausgebrannt gilt – für Hinweise in der Oberfläche. */
export function clippedShare(ctx: CanvasRenderingContext2D, width: number, height: number): number {
  const d = ctx.getImageData(0, 0, width, height).data;
  let clipped = 0;
  const total = width * height;
  // Grobes Raster reicht für eine Schätzung und ist deutlich schneller.
  for (let i = 0; i < d.length; i += 4 * 8) {
    if (luminance(d[i], d[i + 1], d[i + 2]) > 0.97) clipped++;
  }
  return clipped / (total / 8);
}

/**
 * Wendet die Dämpfung auf ein fertiges Bild an.
 *
 * Die Vorbehandlung allein reicht nicht: Das Modell rendert anschliessend ein
 * eigenes, helleres Bild und kann den Glanz dabei neu erzeugen. Deshalb läuft
 * derselbe Schritt auch über das Ergebnis — dort aber deutlich vorsichtiger,
 * damit ein sauber gezeichneter Sonnenfleck nicht flach wird. Angefasst wird
 * nur, was praktisch ausgebrannt ist.
 */
export async function dampenGlareBlob(
  blob: Blob,
  opts: GlareOptions = { threshold: 0.90, maxDrop: 0.12, strength: 1 }
): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    dampenGlare(ctx, canvas.width, canvas.height, opts);

    return await new Promise<Blob>(resolve =>
      canvas.toBlob(b => resolve(b ?? blob), 'image/jpeg', 0.94)
    );
  } catch {
    // Im Zweifel lieber unverändert als kaputt.
    return blob;
  }
}
