import { safeJSON, safeLocalStorage, generateUUID } from '../utils/safeStorage';
import { costEur, findModel, USD_TO_EUR } from './providers';

/**
 * Schnittstelle bewusst kompatibel zur alten Fassung.
 * Neu: costEur wird beim Buchen mitgegeben statt aus einer hartkodierten
 * Tabelle geraten – die Preise leben jetzt am Modell in services/providers/.
 */
export interface UsageData {
  month: string;
  flashCalls: number;
  ecoCalls?: number;
  hdCalls?: number;
  proCalls: number;
  /** Tatsächlich aufgelaufene Kosten in EUR. */
  costEur?: number;
}

export interface DailyUsage {
  date: string;
  proCalls: number;
}

export interface GenerationLogEntry {
  id: string;
  timestamp: string;
  model: string;
  displayName: string;
  action: string;
  costEUR: number;
  cached?: boolean;
  /** Für die Farbmarkierung im Protokoll – ersetzt das Raten am Modellnamen. */
  quality?: 'eco' | 'hd' | 'ultra';
}

const STORAGE_KEY = 'foto_magic_usage';
const DAILY_STORAGE_KEY = 'foto_magic_daily_usage';
const LOGS_STORAGE_KEY = 'foto_magic_generation_logs';

const month = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

const empty = (): UsageData => ({
  month: month(), flashCalls: 0, ecoCalls: 0, hdCalls: 0, proCalls: 0, costEur: 0,
});

export function getMonthlyUsage(): UsageData {
  const all = safeJSON.get<UsageData[]>(STORAGE_KEY, []);
  if (!Array.isArray(all)) return empty();
  const found = all.find(d => d?.month === month());
  if (!found) return empty();
  return {
    ...found,
    ecoCalls: found.ecoCalls ?? found.flashCalls ?? 0,
    hdCalls: found.hdCalls ?? 0,
    costEur: found.costEur ?? 0,
  };
}

export function getDailyProUsage(): number {
  const daily = safeJSON.get<DailyUsage>(DAILY_STORAGE_KEY, { date: today(), proCalls: 0 });
  return daily?.date === today() ? daily.proCalls || 0 : 0;
}

export function trackUsage(modelId: string, costUsdOverride?: number): void {
  const model = findModel(modelId);
  const quality = model?.quality ?? 'eco';
  const eur = costUsdOverride !== undefined
    ? costUsdOverride * USD_TO_EUR
    : model ? costEur(model) : 0;

  const all = safeJSON.get<UsageData[]>(STORAGE_KEY, []);
  const list = Array.isArray(all) ? all : [];
  let current = list.find(d => d?.month === month());
  if (!current) { current = empty(); list.push(current); }
  current.ecoCalls ??= 0;
  current.hdCalls ??= 0;
  current.costEur ??= 0;

  if (quality === 'ultra') current.proCalls += 1;
  else if (quality === 'hd') current.hdCalls += 1;
  else { current.ecoCalls += 1; current.flashCalls += 1; }
  current.costEur += eur;
  safeJSON.set(STORAGE_KEY, list);

  if (quality === 'ultra') {
    const daily = safeJSON.get<DailyUsage>(DAILY_STORAGE_KEY, { date: today(), proCalls: 0 });
    const next = daily?.date === today() ? daily : { date: today(), proCalls: 0 };
    next.proCalls = (next.proCalls || 0) + 1;
    safeJSON.set(DAILY_STORAGE_KEY, next);
  }
}

/** Liefert EUR, passend zur Anzeige und zur Budgetauswahl im Header. */
export function calculateCosts(usage: UsageData): number {
  if (typeof usage.costEur === 'number' && usage.costEur > 0) return usage.costEur;
  // Altbestände ohne costEur näherungsweise umrechnen.
  const eco = usage.ecoCalls ?? usage.flashCalls ?? 0;
  return (eco * 0.039 + (usage.hdCalls ?? 0) * 0.11 + (usage.proCalls ?? 0) * 0.24) * USD_TO_EUR;
}

export function getGenerationLogs(): GenerationLogEntry[] {
  const raw = safeJSON.get<GenerationLogEntry[]>(LOGS_STORAGE_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

export function clearGenerationLogs(): void {
  safeLocalStorage.removeItem(LOGS_STORAGE_KEY);
}

export function addGenerationLog(
  modelId: string,
  action: string,
  opts: { costUsd?: number; cached?: boolean } = {}
): void {
  const model = findModel(modelId);
  const eur = opts.cached
    ? 0
    : opts.costUsd !== undefined ? opts.costUsd * USD_TO_EUR : model ? costEur(model) : 0;

  const entry: GenerationLogEntry = {
    id: generateUUID().slice(0, 8),
    timestamp: new Date().toLocaleString('de-DE'),
    model: modelId,
    displayName: model?.label ?? modelId,
    action: opts.cached ? `${action} (aus dem Zwischenspeicher)` : action,
    costEUR: Number(eur.toFixed(4)),
    cached: opts.cached,
    quality: model?.quality ?? 'eco',
  };

  safeJSON.set(LOGS_STORAGE_KEY, [entry, ...getGenerationLogs()].slice(0, 150));
}
