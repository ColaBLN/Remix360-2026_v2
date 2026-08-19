import { fromDataUrl, toDataUrl } from '../../utils/image';
import {
  ProviderError,
  type EditRequest, type EditResult, type ModelDescriptor, type Provider,
} from './types';

/**
 * fal.ai als zweiter Anbieter, ohne SDK über REST – so sehen wir die
 * HTTP-Status-Codes direkt für die Wiederholungslogik.
 *
 * fal rät davon ab, den Key im Client zu halten. Das gilt für den
 * Betreiber-Key im Bundle. Hier gibt jeder Nutzer seinen eigenen Key ein,
 * genau wie bei Gemini. CORS ist offen.
 *
 * WICHTIG: nativeId-Pfade vor dem Livegang gegen die Modellseite auf fal.ai
 * prüfen, die werden gelegentlich versioniert.
 */
export const FAL_MODELS: ModelDescriptor[] = [
  {
    id: 'fal:flux-kontext-pro',
    providerId: 'fal',
    nativeId: 'fal-ai/flux-pro/kontext',
    label: 'FLUX.1 Kontext [pro]',
    quality: 'eco',
    costUsd: 0.04,
    uploadMaxEdge: 1568,
    supports: { outpaint: false, aspectRatio: true },
  },
  {
    id: 'fal:seedream-v4-edit',
    providerId: 'fal',
    nativeId: 'fal-ai/bytedance/seedream/v4/edit',
    label: 'Seedream V4 Edit',
    quality: 'hd',
    costUsd: 0.04,
    uploadMaxEdge: 2048,
    supports: { outpaint: false, aspectRatio: true },
  },
  {
    id: 'fal:nano-banana-edit',
    providerId: 'fal',
    nativeId: 'fal-ai/nano-banana/edit',
    label: 'Nano Banana Edit',
    quality: 'ultra',
    costUsd: 0.08,
    uploadMaxEdge: 2048,
    supports: { outpaint: true, aspectRatio: true },
  },
];

function classify(status: number, body: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', 'fal lehnt den API-Key ab.', false);
  if (status === 429) return new ProviderError('rate-limit', 'fal drosselt gerade. Wird wiederholt.', true);
  if (status === 402) return new ProviderError('quota', 'Das fal-Guthaben ist aufgebraucht.', false);
  if (status >= 500) return new ProviderError('network', 'fal antwortet nicht. Wird wiederholt.', true);
  return new ProviderError('unknown', `fal-Fehler ${status}: ${body.slice(0, 200)}`, false);
}

export const falProvider: Provider = {
  id: 'fal',
  label: 'fal.ai',
  keyUrl: 'https://fal.ai/dashboard/keys',
  keyPlaceholder: 'fal-…',
  models: FAL_MODELS,

  async edit(model, req: EditRequest, apiKey: string): Promise<EditResult> {
    if (!apiKey) throw new ProviderError('auth', 'Kein fal-API-Key hinterlegt.', false);
    if (req.task === 'outpaint' && !model.supports.outpaint) {
      throw new ProviderError('unsupported',
        `${model.label} kann die Leinwand nicht erweitern. Für Zoom Out ein anderes Modell wählen.`, false);
    }

    const res = await fetch(`https://fal.run/${model.nativeId}`, {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify({
        prompt: req.prompt,
        image_url: toDataUrl(req.imageBase64, req.mimeType),
        aspect_ratio: req.aspectRatio,
        output_format: 'jpeg',
        sync_mode: true,
        num_images: 1,
      }),
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
