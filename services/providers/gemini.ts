import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION } from '../prompts';
import {
  ProviderError,
  type EditRequest, type EditResult, type ModelDescriptor, type Provider,
} from './types';

/**
 * Kosten sind Schätzwerte pro Bild in USD, Stand August 2026.
 * Gemini rechnet Bildausgabe über Token ab; die 2K-Stufe kostet mehr als 1K.
 */
export const GEMINI_MODELS: ModelDescriptor[] = [
  {
    id: 'gemini:3.1-flash-image',
    providerId: 'gemini',
    nativeId: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image',
    quality: 'hd',
    costUsd: 0.11,
    uploadMaxEdge: 2048,
    outputMp: 4.2,
    promptStyle: 'structured',
    supports: { outpaint: true, aspectRatio: true },
  },
  {
    id: 'gemini:3-pro-image',
    providerId: 'gemini',
    nativeId: 'gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image',
    quality: 'ultra',
    costUsd: 0.24,
    uploadMaxEdge: 2048,
    outputMp: 4.2,
    promptStyle: 'structured',
    supports: { outpaint: true, aspectRatio: true },
  },
];

/**
 * 2K statt 4K als Standard. 4K verdoppelt die Kosten, und für Exposéfotos
 * auf Portalen bringt es nichts – die skalieren ohnehin herunter.
 */
function imageSizeFor(_model: ModelDescriptor): '1K' | '2K' {
  return '2K';
}

function classify(err: unknown): ProviderError {
  const status = (err as { status?: number })?.status;
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();

  if (status === 429 || msg.includes('429') || msg.includes('rate limit')) {
    return new ProviderError('rate-limit', 'Zu viele Anfragen. Wird automatisch wiederholt.', true, err);
  }
  if (status === 401 || status === 403 || msg.includes('permission') || msg.includes('api key')) {
    return new ProviderError('auth',
      'Der API-Key wird für dieses Modell abgelehnt. Meist fehlt im Google-Projekt eine hinterlegte Zahlungsmethode.',
      false, err);
  }
  if (msg.includes('quota') || msg.includes('exhausted')) {
    return new ProviderError('quota', 'Das Kontingent dieses Keys ist aufgebraucht.', false, err);
  }
  if ((status && status >= 500) || msg.includes('fetch') || msg.includes('network')) {
    return new ProviderError('network', 'Der Anbieter antwortet gerade nicht. Wird wiederholt.', true, err);
  }
  return new ProviderError('unknown', raw || 'Unbekannter Fehler.', false, err);
}

export const geminiProvider: Provider = {
  id: 'gemini',
  label: 'Google Gemini',
  keyUrl: 'https://aistudio.google.com/apikey',
  keyPlaceholder: 'AIza…',
  models: GEMINI_MODELS,

  async edit(model, req: EditRequest, apiKey: string): Promise<EditResult> {
    if (!apiKey) throw new ProviderError('auth', 'Kein API-Key hinterlegt.', false);

    const ai = new GoogleGenAI({ apiKey });
    let response;
    try {
      response = await ai.models.generateContent({
        model: model.nativeId,
        contents: {
          parts: [
            { inlineData: { data: req.imageBase64, mimeType: req.mimeType } },
            { text: req.prompt },
          ],
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          abortSignal: req.signal,
          imageConfig: {
            // Kam bisher fest als "16:9".
            aspectRatio: req.aspectRatio,
            ...(imageSizeFor(model) ? { imageSize: imageSizeFor(model) } : {}),
          },
        },
      });
    } catch (err) {
      if (req.signal?.aborted) throw err;
      throw classify(err);
    }

    const candidate = response.candidates?.[0];

    // Vorher wurde candidate.content.parts ungeprüft gelesen. Bei einer
    // Sicherheitsblockade ist content undefined – das gab einen TypeError
    // statt einer verwertbaren Meldung.
    if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(String(candidate.finishReason))) {
      throw new ProviderError('safety',
        `Das Modell hat abgebrochen (${candidate.finishReason}). Meist hilft ein anderes Ausgangsbild.`,
        false);
    }

    for (const part of candidate?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/jpeg',
          modelId: model.id,
          costUsd: model.costUsd,
        };
      }
    }

    const text = response.text?.trim();
    throw new ProviderError('no-image',
      text ? `Die KI hat kein Bild geliefert: ${text}` : 'Die KI hat kein Bild geliefert.', true);
  },
};
