import { hashRequest, prepareImage } from '../utils/image';
import { getCached, putCached } from './cache';
import {
  fallbacksFor, resolveRoute, runEdit, getKey,
  ProviderError,
  type ModelDescriptor, type ProviderId, type Quality,
  type RouteContext, type TaskKind,
} from './providers';
import { buildPrompt, PROMPT_VERSION, type OptimizationOptions, type RoomType, type Tageszeit } from './prompts';
import { withRetry } from './queue';

export interface EditJobInput {
  task: TaskKind;
  /** Originaldatei beim ersten Lauf, Zwischenergebnis bei Folgeschritten. */
  source: Blob;
  tageszeit?: Tageszeit;
  options?: OptimizationOptions;
  roomType?: RoomType;
  userPrompt?: string;
  force?: Quality;
  signal?: AbortSignal;
  /**
   * Erzwingt einen echten Aufruf.
   *
   * Ohne das liefert „Nochmal versuchen" mit unveränderten Einstellungen den
   * identischen Cache-Schlüssel und damit exakt dasselbe Bild zurück – gemeint
   * ist aber eine neue Fassung.
   */
  bypassCache?: boolean;
}

export interface EditJobOutput {
  base64: string;
  mimeType: string;
  modelId: string;
  modelLabel: string;
  costUsd: number;
  /** true, wenn das Ergebnis aus dem Cache kam und nichts gekostet hat. */
  cached: boolean;
  note?: string;
  /** Fassung der Prompt-Bibliothek, mit der dieses Bild entstand. */
  promptVersion: string;
}

export interface PipelineSettings {
  preferred: Quality;
  providerOrder: ProviderId[];
  spentEur: number;
  budgetEur: number;
  useCache: boolean;
}

/**
 * Der komplette Weg für eine Bearbeitung: verkleinern, Cache prüfen, Modell
 * wählen, mit Backoff versuchen, bei hartem Fehler den Anbieter wechseln,
 * Ergebnis cachen.
 */
export async function runEditJob(
  input: EditJobInput,
  settings: PipelineSettings,
  onNote?: (note: string) => void,
  /** Liefert die verkleinerte Quelle heraus, damit sie gespeichert werden kann. */
  onPrepared?: (jpeg: Blob) => void
): Promise<EditJobOutput> {
  const routeCtx: RouteContext = {
    task: input.task,
    preferred: settings.preferred,
    force: input.force,
    providerOrder: settings.providerOrder,
    spentEur: settings.spentEur,
    budgetEur: settings.budgetEur,
  };

  const route = resolveRoute(routeCtx);
  if (route.note) onNote?.(route.note);

  const prepared = await prepareImage(input.source, route.model.uploadMaxEdge);
  if (onPrepared) {
    // Als Blob statt base64 – so landet nur ein Drittel des Volumens in der Ablage.
    const bytes = Uint8Array.from(atob(prepared.base64), c => c.charCodeAt(0));
    onPrepared(new Blob([bytes], { type: prepared.mimeType }));
  }

  const chain: ModelDescriptor[] = [route.model, ...fallbacksFor(route.model, settings.providerOrder)];
  let lastError: unknown;

  for (const model of chain) {
    // Der Prompt-Stil hängt am Modell: Gemini-artige Modelle bekommen die
    // gegliederte Fassung, instruktionsbasierte Editoren die Kurzform.
    const prompt = buildPrompt(input.task, {
      tageszeit: input.tageszeit,
      options: input.options,
      roomType: input.roomType,
      userPrompt: input.userPrompt,
      style: model.promptStyle,
    });

    const cacheKey = await hashRequest([prepared.base64, prompt, model.id, prepared.aspectRatio]);

    if (settings.useCache && !input.bypassCache) {
      const hit = await getCached(cacheKey);
      if (hit) {
        return {
          base64: hit.base64,
          mimeType: hit.mimeType,
          modelId: model.id,
          modelLabel: model.label,
          costUsd: 0,
          cached: true,
          note: route.note,
          promptVersion: PROMPT_VERSION,
        };
      }
    }

    try {
      const result = await withRetry(
        () => runEdit(model, {
          imageBase64: prepared.base64,
          mimeType: prepared.mimeType,
          prompt,
          aspectRatio: prepared.aspectRatio,
          task: input.task,
          signal: input.signal,
        }, getKey(model.providerId)),
        {
          signal: input.signal,
          onRetry: attempt => onNote?.(`Anbieter drosselt – Versuch ${attempt + 1}.`),
        }
      );

      if (settings.useCache) {
        void putCached({
          key: cacheKey,
          base64: result.base64,
          mimeType: result.mimeType,
          modelId: model.id,
        });
      }

      return {
        ...result,
        modelLabel: model.label,
        cached: false,
        note: model.id === route.model.id ? route.note : `Ausgewichen auf ${model.label}.`,
        promptVersion: PROMPT_VERSION,
      };
    } catch (err) {
      lastError = err;
      if (input.signal?.aborted) throw err;

      // Bei Auth-, Kontingent-, Nicht-unterstützt- und Netzfehlern lohnt der
      // Wechsel. Bei allem anderen liefert ein anderer Anbieter dasselbe.
      const kind = err instanceof ProviderError ? err.kind : 'unknown';
      if (!['auth', 'quota', 'unsupported', 'network'].includes(kind)) break;
      onNote?.(`${model.label} nicht verfügbar – nächster Anbieter.`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Bearbeitung fehlgeschlagen.');
}
