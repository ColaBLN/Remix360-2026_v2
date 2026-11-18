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
  // Nachfolger von fal-ai/nano-banana-2/edit. Andere Namensraum-Vorsilbe
  // (google/ statt fal-ai/), aber identisches Eingabeschema: image_urls,
  // aspect_ratio, resolution 1K|2K|4K, output_format, num_images, sync_mode.
  // Deshalb ist der Tausch ohne Schema-Risiko möglich.
  'google/nano-banana-2.1/edit': { imageField: 'image_urls', sizeField: 'aspect_ratio', resolution: '2K' },
  'fal-ai/nano-banana-2/edit': { imageField: 'image_urls', sizeField: 'aspect_ratio', resolution: '2K' },
  'fal-ai/nano-banana-pro/edit': { imageField: 'image_urls', sizeField: 'aspect_ratio', resolution: '2K' },
  'fal-ai/bytedance/seedream/v4/edit': { imageField: 'image_urls', sizeField: 'image_size' },
  'fal-ai/bytedance/seedream/v4.5/edit': { imageField: 'image_urls', sizeField: 'image_size' },
  'fal-ai/flux-pro/kontext': { imageField: 'image_url', sizeField: 'aspect_ratio' },
};

const DEFAULT_SHAPE: FalShape = { imageField: 'image_urls', sizeField: 'aspect_ratio' };

/**
 * Kosten sind Schätzwerte pro Bild in USD, Stand 18. November 2026.
 * Verbindlich ist immer das fal-Dashboard.
 *
 * Nano Banana ist Googles Bildmodell auf fal-Infrastruktur – dieselbe Familie
 * wie der direkte Gemini-Zugang, nur über einen anderen Schlüssel.
 */
export const FAL_MODELS: ModelDescriptor[] = [
  {
    id: 'fal:seedream-v4-edit',
    providerId: 'fal',
    nativeId: 'fal-ai/bytedance/seedream/v4/edit',
    label: 'Seedream V4 Edit',
    quality: 'eco',
    costUsd: 0.04,
    uploadMaxEdge: 2048,
    // Nimmt eine explizite Zielgrösse entgegen, wir fordern 2048 lange Kante an.
    outputMp: 3.1,
    promptStyle: 'concise',
    supports: { outpaint: false, aspectRatio: true },
  },
  {
    // Löst fal:nano-banana-2 ab. Das Vorgängermodell (Gemini 3.1 Flash Image)
    // ist seit dem 6. Oktober 2026 abgekündigt – ohne Abschaltdatum, aber
    // Google verweist ausdrücklich auf 2.1. Eingabeschema identisch, deshalb
    // war der Wechsel ohne Test möglich.
    id: 'fal:nano-banana-2.1',
    providerId: 'fal',
    nativeId: 'google/nano-banana-2.1/edit',
    label: 'Nano Banana 2.1',
    quality: 'hd',
    // fal rechnet dieses Modell tokenbasiert ab, wie Google selbst. Schätzwert
    // für 2K inklusive Eingabebild; die reine Ausgabe liegt bei 0,0504.
    costUsd: 0.06,
    uploadMaxEdge: 2048,
    outputMp: 4.2,
    promptStyle: 'structured',
    supports: { outpaint: true, aspectRatio: true, extremeAspect: true },
  },
  {
    id: 'fal:nano-banana-pro',
    providerId: 'fal',
    nativeId: 'fal-ai/nano-banana-pro/edit',
    label: 'Nano Banana Pro (Gemini 3 Pro Image)',
    quality: 'ultra',
    costUsd: 0.15,
    uploadMaxEdge: 2048,
    outputMp: 4.2,
    promptStyle: 'structured',
    supports: { outpaint: true, aspectRatio: true },
  },
];

/*
 * Bewusst entfernt, weil beide nur rund ein Megapixel ausgeben:
 *
 *   fal-ai/flux-pro/kontext   1344 x 768
 *   fal-ai/nano-banana/edit   ebenfalls 1K-Klasse
 *
 * Sie standen preislich gleichauf mit Modellen, die viermal so viele Pixel
 * liefern. Für ein Exposé-Titelbild ist 1 MP zu wenig – das Portal skaliert
 * dann von einer zu kleinen Vorlage, und das Ergebnis wirkt unscharf, obwohl
 * es pro Pixel sogar knackiger ist.
 *
 * Bewusst noch NICHT aufgenommen, obwohl inhaltlich interessant:
 *
 *   openai/gpt-image-2.5/flare/edit
 *     Wirbt genau mit dem, was uns seit 5.7.0 beschäftigt: ändert nur das
 *     Angefragte und lässt Motiv, Komposition und Hintergrund stehen. In einem
 *     unabhängigen Test gehörte es zu den Modellen, die nichts umbauten,
 *     während Nano Banana 2 für denselben Effekt Teile des Raums neu
 *     erfunden hat. Wäre der Hebel, um die FIDELITY-Regeln wieder zu lockern.
 *
 *   bytedance/seedream/v5/pro/edit
 *     Nachfolger unseres Eco-Modells, regionengenaues Editing.
 *
 * Beide fehlen hier aus einem einzigen Grund: fal gibt ihre Eingabeschemata
 * nicht maschinenlesbar heraus (robots-gesperrt), und geratene Feldnamen waren
 * schon einmal die Ursache einer 422-Serie. Erst nachsehen, dann aufnehmen.
 */

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
