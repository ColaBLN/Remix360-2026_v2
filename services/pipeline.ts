import { hashRequest, prepareImage } from '../utils/image';
import { dampenGlareBlob } from '../utils/tone';
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
  /** Tatsächlich gelieferte Pixelmasse – nicht die versprochene. */
  outputSize?: { width: number; height: number };
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
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Ergebnis konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

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

  // Glanzdämpfung nur dort, wo sie hingehört: Innenräume und Automatik.
  // Bei Aussenaufnahmen sind helle Himmelsflächen erwünscht.
  const glareTasks: TaskKind[] = ['interior', 'auto', 'stage-empty', 'stage-furnish', 'detail', 'soften'];
  const glare =
    input.options?.glanzDaempfen !== false && glareTasks.includes(input.task) ? 1 : 0;

  // Keine Dämpfung mehr vor dem Upload (seit 5.5.0). Sie konnte ein helles
  // Fenster nicht von einem Glanzfleck unterscheiden und zog den Blick nach
  // draussen grau, bevor das Modell ihn überhaupt sah. Es bleibt die
  // vorsichtigere Nachbehandlung am Ergebnis weiter unten.
  const prepared = await prepareImage(input.source, route.model.uploadMaxEdge, 0.92, 0);
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

      // Die Vorbehandlung entschärft nur die Eingabe. Das Modell rendert
      // danach ein eigenes Bild und kann den Glanz neu erzeugen – deshalb
      // derselbe Schritt über das Ergebnis, nur vorsichtiger eingestellt.
      let outputSize: { width: number; height: number } | undefined;
      const raw = await (await fetch(`data:${result.mimeType};base64,${result.base64}`)).blob();
      try {
        const bmp = await createImageBitmap(raw);
        outputSize = { width: bmp.width, height: bmp.height };
        bmp.close();
      } catch { /* Anzeige ist optional */ }

      if (glare > 0) {
        const cleaned = await dampenGlareBlob(raw, { threshold: 0.90, maxDrop: 0.12, strength: 1 });
        if (cleaned !== raw) {
          result.base64 = await blobToBase64(cleaned);
          result.mimeType = 'image/jpeg';
        }
      }

      return {
        ...result,
        outputSize,
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
