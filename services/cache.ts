/**
 * Ergebnis-Cache. Schlüssel ist ein Hash aus Bildinhalt, Prompt und Modell –
 * wer dieselbe Bearbeitung zweimal auslöst, zahlt sie einmal.
 *
 * IndexedDB statt localStorage, weil Bilder die 5-MB-Grenze sofort sprengen.
 * Ohne Bibliothek, damit keine weitere Abhängigkeit dazukommt.
 */
const DB_NAME = 'remix360';
const STORE = 'results';
const MAX_ENTRIES = 300;

export interface CachedResult {
  key: string;
  base64: string;
  mimeType: string;
  modelId: string;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(db => new Promise<T | null>(resolve => {
    if (!db) return resolve(null);
    try {
      const request = fn(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

export const getCached = (key: string) =>
  tx<CachedResult>('readonly', s => s.get(key) as IDBRequest<CachedResult>);

export async function putCached(entry: Omit<CachedResult, 'createdAt'>): Promise<void> {
  await tx('readwrite', s => s.put({ ...entry, createdAt: Date.now() }));
  void prune();
}

async function prune(): Promise<void> {
  const count = await tx<number>('readonly', s => s.count());
  if (!count || count <= MAX_ENTRIES) return;
  const db = await openDb();
  if (!db) return;
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  const cursorReq = store.index('createdAt').openCursor();
  let toDelete = count - MAX_ENTRIES;
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor || toDelete <= 0) return;
    cursor.delete();
    toDelete--;
    cursor.continue();
  };
}

export async function clearCache(): Promise<void> {
  await tx('readwrite', s => s.clear());
}
