import { fromDataUrl, toDataUrl } from '../../utils/image';
import {
  ProviderError,
  type EditRequest, type EditResult, type ModelDescriptor, type Provider,
} from './types';

/**
 * fal.ai als Anbieter. Ohne SDK über REST, damit wir HTTP-Status-Codes direkt
 * für die Wiederholungslogik sehen.
 *
 * fal rät davon ab, den Key im Client zu halten. Das gilt für den Betreiber-Key
 * im Bundle. Hier gibt jeder Nutzer seinen eigenen Key ein, wie bei Gemini.
 */

/**
 * Die Endpunkte erwarten unterschiedliche Feldnamen. Das war die Ursache des
 * 422-Fehlers: wir haben überall image_url geschickt, aber alle Editoren ausser
 * FLUX Kontext erwarten image_urls als Array.
 */
interface FalShape {
  /** Feldname für das Eingangsbild. */
  imageField: 'image_url' | 'image_urls';
  /** Wie das Ausgabeformat gesteuert wird. */
  sizeField: 'aspect_ratio' | 'image_size' | 'none';
  /** Nur die Nano-Banana-2-Familie kennt diesen Schalter. */
  resolution?: '1K' | '2K' | '4K';
}

const SHAPES: Record<string, FalShape> = {
  'fal-ai/nano-banana/edit': { imageField: 'image_urls', sizeField: 'aspect_ratio' },
  'fal-ai/nano-banana-2/edit': { imageField: 'image_urls', sizeField: 'aspect_ratio', resolution: '2K' },
  'fal-ai/nano-banana-pro/edit': { imageField: 'image_urls', sizeField: 'aspect_ratio', resolution: '2K' },
  'fal-ai/bytedance/seedream/v4/edit': { imageField: 'image_urls', sizeField: 'image_size' },
  'fal-ai/bytedance/seedream/v4.5/edit': { imageField: 'image_urls', sizeField: 'image_size' },
  'fal-ai/flux-pro/kontext': { imageField: 'image_url', sizeField: 'aspect_ratio' },
};

const DEFAULT_SHAPE: FalShape = { imageField: 'image_urls', sizeField: 'aspect_ratio' };

/**
 * Kosten sind Schätzwerte pro Bild in USD, Stand August 2026.
 * Verbindlich ist immer das fal-Dashboard.
 *
 * Nano Banana ist Googles Bildmodell auf fal-Infrastruktur – dieselbe Familie
 * wie der direkte Gemini-Zugang, nur über einen anderen Schlüssel.
 */
export const FAL_MODELS: ModelDescriptor[] = [
  {
    id: 'fal:nano-banana',
    providerId: 'fal',
    nativeId: 'fal-ai/nano-banana/edit',
    label: 'Nano Banana (Gemini 2.5 Flash Image)',
    quality: 'eco',
    costUsd: 0.039,
    uploadMaxEdge: 1568,
    promptStyle: 'structured',
    supports: { outpaint: true, aspectRatio: true },
  },
  {
    id: 'fal:flux-kontext-pro',
    providerId: 'fal',
    nativeId: 'fal-ai/flux-pro/kontext',
    label: 'FLUX.1 Kontext [pro]',
    quality: 'eco',
    costUsd: 0.04,
    uploadMaxEdge: 1568,
    // Kontext folgt kurzen Anweisungen; lange Constraint-Blöcke führen dazu,
    // dass am Bild sichtbar nichts passiert.
    promptStyle: 'concise',
    supports: { outpaint: false, aspectRatio: true },
  },
  {
    id: 'fal:nano-banana-2',
    providerId: 'fal',
    nativeId: 'fal-ai/nano-banana-2/edit',
    label: 'Nano Banana 2',
    quality: 'hd',
    // 0.08 bei 1K, Faktor 1.5 für 2K.
    costUsd: 0.12,
    uploadMaxEdge: 2048,
    promptStyle: 'structured',
    supports: { outpaint: true, aspectRatio: true },
  },
  {
    id: 'fal:seedream-v4-edit',
    providerId: 'fal',
    nativeId: 'fal-ai/bytedance/seedream/v4/edit',
    label: 'Seedream V4 Edit',
    quality: 'hd',
    costUsd: 0.04,
    uploadMaxEdge: 2048,
    promptStyle: 'concise',
    supports: { outpaint: false, aspectRatio: true },
  },
  {
    id: 'fal:nano-banana-pro',
    providerId: 'fal',
    nativeId: 'fal-ai/nano-banana-pro/edit',
    label: 'Nano Banana Pro (Gemini 3 Pro Image)',
    quality: 'ultra',
    // 1K und 2K fallen bei Pro unter dieselbe Standardrate – 2K kostet also
    // nichts extra. Erst 4K verdoppelt auf 0.30.
    costUsd: 0.15,
    uploadMaxEdge: 2048,
    promptStyle: 'structured',
    supports: { outpaint: true, aspectRatio: true },
  },
];

function classify(status: number, body: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', 'fal lehnt den API-Schlüssel ab.', false);
  if (status === 429) return new ProviderError('rate-limit', 'fal drosselt gerade. Wird wiederholt.', true);
  if (status === 402) return new ProviderError('quota', 'Das fal-Guthaben ist aufgebraucht. Im fal-Dashboard aufladen.', false);
  if (status === 422) {
    // Eingabefelder passen nicht zum Endpunkt. Anderes Modell probieren,
    // statt den Auftrag hart scheitern zu lassen.
    return new ProviderError('unsupported',
      'Dieses fal-Modell erwartet ein anderes Eingabeformat.', false);
  }
  if (status >= 500) return new ProviderError('network', 'fal antwortet nicht. Wird wiederholt.', true);
  return new ProviderError('unknown', `fal-Fehler ${status}: ${body.slice(0, 160)}`, false);
}

export const falProvider: Provider = {
  id: 'fal',
  label: 'fal.ai',
  keyUrl: 'https://fal.ai/dashboard/keys',
  keyPlaceholder: 'fal-…',
  models: FAL_MODELS,

  async edit(model, req: EditRequest, apiKey: string): Promise<EditResult> {
    if (!apiKey) throw new ProviderError('auth', 'Kein fal-API-Schlüssel hinterlegt.', false);
    if (req.task === 'outpaint' && !model.supports.outpaint) {
      throw new ProviderError('unsupported',
        `${model.label} kann die Leinwand nicht erweitern. Für Zoom Out ein anderes Modell wählen.`, false);
    }

    const shape = SHAPES[model.nativeId] ?? DEFAULT_SHAPE;
    const dataUri = toDataUrl(req.imageBase64, req.mimeType);

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      num_images: 1,
      output_format: 'jpeg',
      // Liefert das Ergebnis direkt als Data-URI statt als CDN-Link.
      sync_mode: true,
    };

    body[shape.imageField] = shape.imageField === 'image_urls' ? [dataUri] : dataUri;

    if (shape.sizeField === 'aspect_ratio') {
      body.aspect_ratio = req.aspectRatio;
    } else if (shape.sizeField === 'image_size') {
      // Seedream erwartet image_size statt aspect_ratio.
      body.image_size = aspectToImageSize(req.aspectRatio);
    }
    if (shape.resolution) body.resolution = shape.resolution;

    const res = await fetch(`https://fal.run/${model.nativeId}`, {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify(body),
    });

    if (!res.ok) throw classify(res.status, await res.text().catch(() => ''));

    const json = (await res.json()) as { images?: Array<{ url?: string; content_type?: string }> };
    const image = json.images?.[0];
    if (!image?.url) throw new ProviderError('no-image', 'fal hat kein Bild zurückgegeben.', true);

    if (image.url.startsWith('data:')) {
      const { base64, mimeType } = fromDataUrl(image.url);
      return { base64, mimeType, modelId: model.id, costUsd: model.costUsd };
    }

    const blob = await fetch(image.url, { signal: req.signal }).then(r => r.blob());
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Ergebnisbild konnte nicht gelesen werden.'));
      reader.readAsDataURL(blob);
    });

    return { base64, mimeType: image.content_type || 'image/jpeg', modelId: model.id, costUsd: model.costUsd };
  },
};

/** Seedream kennt keine Seitenverhältnisse, nur benannte Grössen. */
function aspectToImageSize(aspect: string): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number);
  const long = 2048;
  return w >= h
    ? { width: long, height: Math.round((long * h) / w) }
    : { width: Math.round((long * w) / h), height: long };
}
