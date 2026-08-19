import { ProviderError } from './providers/types';

/**
 * Bisher lief die Stapelverarbeitung streng nacheinander: 10 Bilder mit je
 * 3 Tageszeiten sind 30 Aufrufe in Serie, bei ~15 s pro Bild über sieben
 * Minuten Wartezeit.
 */
export interface PoolOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onSettled?: () => void;
}

export async function runPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  { concurrency = 3, signal, onSettled }: PoolOptions = {}
): Promise<void> {
  let cursor = 0;
  async function lane(): Promise<void> {
    while (cursor < items.length) {
      if (signal?.aborted) return;
      const index = cursor++;
      try {
        await worker(items[index], index);
      } finally {
        onSettled?.();
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

const isRetryable = (err: unknown): boolean =>
  err instanceof ProviderError ? err.retryable : false;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

/**
 * Exponentielles Backoff mit Jitter. Auf dem Gratis-Kontingent ist 429 der
 * häufigste Fehler überhaupt; ohne Wiederholung fällt in einem Stapel
 * regelmässig die Hälfte der Bilder aus.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseDelayMs = 1200, signal, onRetry }: RetryOptions = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (signal?.aborted || attempt === retries || !isRetryable(err)) throw err;
      const delay = Math.round(baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5));
      onRetry?.(attempt + 1, delay, err);
      await sleep(delay, signal);
    }
  }
  throw lastError;
}
