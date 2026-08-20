import { safeLocalStorage } from '../../utils/safeStorage';
import { falProvider } from './fal';
import { geminiProvider } from './gemini';
import {
  ProviderError,
  type EditRequest, type EditResult, type ModelDescriptor,
  type Provider, type ProviderId, type Quality, type TaskKind,
} from './types';

export * from './types';

export const PROVIDERS: Record<ProviderId, Provider> = {
  gemini: geminiProvider,
  fal: falProvider,
};

export const ALL_MODELS: ModelDescriptor[] = Object.values(PROVIDERS).flatMap(p => p.models);

/** Nur für die Anzeige. Bei Bedarf gegen einen Live-Kurs tauschen. */
export const USD_TO_EUR = 0.92;
export const costEur = (model: ModelDescriptor): number => model.costUsd * USD_TO_EUR;

/**
 * Sucht erst die interne ID ('gemini:2.5-flash-image'), dann die native
 * ('gemini-2.5-flash-image'). Der zweite Weg deckt Protokolleinträge aus der
 * alten Fassung ab, die noch native Namen gespeichert haben.
 */
export function findModel(id: string): ModelDescriptor | undefined {
  return ALL_MODELS.find(m => m.id === id) ?? ALL_MODELS.find(m => m.nativeId === id);
}

/* ---------------------------------------------------------------- */
/* Key-Verwaltung, pro Anbieter, nur lokal                           */
/* ---------------------------------------------------------------- */

const KEY_PREFIX = 'remix360.key.';
/** Key aus der alten Fassung übernehmen, damit niemand neu verbinden muss. */
const LEGACY_GEMINI_KEY = 'custom_gemini_api_key';

export function getKey(provider: ProviderId): string {
  const own = safeLocalStorage.getItem(KEY_PREFIX + provider);
  if (own) return own;
  if (provider === 'gemini') {
    const legacy = safeLocalStorage.getItem(LEGACY_GEMINI_KEY);
    if (legacy) {
      safeLocalStorage.setItem(KEY_PREFIX + 'gemini', legacy);
      return legacy;
    }
  }
  return '';
}

export function setKey(provider: ProviderId, key: string): void {
  const trimmed = key.trim();
  if (trimmed) safeLocalStorage.setItem(KEY_PREFIX + provider, trimmed);
  else {
    safeLocalStorage.removeItem(KEY_PREFIX + provider);
    if (provider === 'gemini') safeLocalStorage.removeItem(LEGACY_GEMINI_KEY);
  }
}

export function connectedProviders(): ProviderId[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).filter(id => getKey(id).length > 0);
}

/* ---------------------------------------------------------------- */
/* Modellauswahl pro Stufe                                           */
/* ---------------------------------------------------------------- */

const MODEL_PREFIX = 'remix360.model.';

/** Modelle einer Stufe, die mit den hinterlegten Schlüsseln nutzbar sind. */
export function modelsForQuality(quality: Quality): ModelDescriptor[] {
  const active = connectedProviders();
  const pool = active.length ? active.flatMap(id => PROVIDERS[id].models) : ALL_MODELS;
  return pool.filter(m => m.quality === quality);
}

export function getSelectedModelId(quality: Quality): string | null {
  return safeLocalStorage.getItem(MODEL_PREFIX + quality);
}

export function setSelectedModelId(quality: Quality, modelId: string | null): void {
  if (modelId) safeLocalStorage.setItem(MODEL_PREFIX + quality, modelId);
  else safeLocalStorage.removeItem(MODEL_PREFIX + quality);
}

/** Vom Nutzer gewähltes Modell, sofern es zur Stufe passt und nutzbar ist. */
function preferredModel(quality: Quality): ModelDescriptor | undefined {
  const id = getSelectedModelId(quality);
  if (!id) return undefined;
  return modelsForQuality(quality).find(m => m.id === id);
}

/** Preistafel im Kosten-Dialog: je Stufe das aktive Modell. */
export function pricingByQuality(): Array<{
  quality: Quality; label: string; providerLabel: string; costUsd: number; costEur: number;
}> {
  const active = connectedProviders();
  const pool = active.length ? active.flatMap(id => PROVIDERS[id].models) : PROVIDERS.gemini.models;
  return (['eco', 'hd', 'ultra'] as Quality[]).map(quality => {
    // Reihenfolge der Deklaration ist die kuratierte Empfehlung. Vorher wurde
    // nach Preis sortiert, wodurch HD auf Seedream statt Nano Banana 2 fiel.
    const model = preferredModel(quality) ?? pool.filter(m => m.quality === quality)[0];
    return {
      quality,
      label: model?.label ?? '—',
      providerLabel: model ? PROVIDERS[model.providerId].label : '—',
      costUsd: model?.costUsd ?? 0,
      costEur: model ? costEur(model) : 0,
    };
  });
}

/* ---------------------------------------------------------------- */
/* Routing                                                           */
/* ---------------------------------------------------------------- */

const RANK: Record<Quality, number> = { eco: 0, hd: 1, ultra: 2 };

export interface RouteContext {
  /** Wird für Modell-Fähigkeiten gebraucht, nicht mehr fürs Herabstufen. */
  task: TaskKind;
  preferred: Quality;
  force?: Quality;
  providerOrder: ProviderId[];
  /** Beide in EUR, passend zur Budgetauswahl in der Oberfläche. */
  spentEur: number;
  budgetEur: number;
}

export interface Route {
  model: ModelDescriptor;
  apiKey: string;
  note?: string;
}

export function resolveRoute(ctx: RouteContext): Route {
  const available = ctx.providerOrder.filter(id => getKey(id)).flatMap(id => PROVIDERS[id].models);
  if (available.length === 0) {
    throw new ProviderError('auth', 'Kein API-Key hinterlegt. Oben rechts einen Anbieter verbinden.', false);
  }

  let target: Quality = ctx.force ?? ctx.preferred;
  let note: string | undefined;

  // Budget schlägt alles. Vorher fiel die App still auf Eco zurück, ohne
  // dass der Nutzer erfuhr warum.
  if (ctx.spentEur >= ctx.budgetEur && !ctx.force) {
    target = 'eco';
    note = 'Budgetgrenze erreicht – es läuft die günstigste Stufe.';
  }

  const candidates = [...available].sort((a, b) => RANK[a.quality] - RANK[b.quality]);
  // Manuelle Wahl schlägt die Standardsortierung.
  const exact = preferredModel(target) ?? candidates.find(m => m.quality === target);
  const lower = [...candidates].reverse().find(m => RANK[m.quality] <= RANK[target]);
  const model = exact ?? lower ?? candidates[0];

  return { model, apiKey: getKey(model.providerId), note };
}

/** Ausweichkette: gleiche Stufe bei anderen Anbietern, dann günstiger. */
export function fallbacksFor(model: ModelDescriptor, providerOrder: ProviderId[]): ModelDescriptor[] {
  const pool = providerOrder
    .filter(id => getKey(id))
    .flatMap(id => PROVIDERS[id].models)
    .filter(m => m.id !== model.id);
  return [
    ...pool.filter(m => m.quality === model.quality),
    ...pool.filter(m => RANK[m.quality] < RANK[model.quality])
      .sort((a, b) => RANK[b.quality] - RANK[a.quality]),
  ];
}

export function runEdit(model: ModelDescriptor, req: EditRequest, apiKey: string): Promise<EditResult> {
  return PROVIDERS[model.providerId].edit(model, req, apiKey);
}
