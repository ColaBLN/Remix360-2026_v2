/**
 * Dauerhafte Ablage für Objekte und Aufträge.
 *
 * Getrennt vom Ergebnis-Cache in cache.ts: der ist inhaltsbasiert und weiss
 * nichts von Sitzungen. Hier liegt der Arbeitsstand.
 *
 * Gespeichert wird nicht die Rohdatei aus der Kamera, sondern die bereits auf
 * 2048 px verkleinerte Fassung — genau die, die auch zum Modell geht. Das
 * spart rund 85 Prozent Platz, und „Nochmal versuchen" liefert trotzdem
 * identische Ergebnisse.
 */
import type { RoomType, StagingMode, Tageszeit } from './prompts';

const DB_NAME = 'remix360-work';
const VERSION = 1;
const JOBS = 'jobs';
const PROJECTS = 'projects';

/** Ältere Einträge werden beim Start automatisch entfernt. */
export const RETENTION_DAYS = 30;

export interface StoredProject {
  id: string;
  name: string;
  createdAt: number;
}

export interface StoredJob {
  id: string;
  projectId: string;
  groupId: string;
  /** Verkleinerte Quelle, als Blob. Reicht für Wiederholungen. */
  source: Blob;
  sourceName: string;
  /** Ergebnis, als Blob statt base64 – spart rund ein Drittel Speicher. */
  result: Blob | null;
  status: 'pending' | 'completed' | 'failed';
  error?: string;
  note?: string;
  tageszeit: Tageszeit;
  imageType: string;
  stagingOptions?: { mode: StagingMode; roomType: RoomType };
  modelLabel?: string;
  costEur?: number;
  cached?: boolean;
  /** Mit welcher Prompt-Fassung das Bild entstand. */
  promptVersion?: string;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(JOBS)) {
        const s = db.createObjectStore(JOBS, { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(db => new Promise<T | null>(resolve => {
    if (!db) return resolve(null);
    try {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

/**
 * Bittet den Browser, die Ablage nicht bei Speicherdruck zu räumen.
 * Ohne das darf iOS die Daten jederzeit verwerfen.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function saveJob(job: StoredJob): Promise<void> {
  await run(JOBS, 'readwrite', s => s.put(job));
}

export async function deleteJob(id: string): Promise<void> {
  await run(JOBS, 'readwrite', s => s.delete(id));
}

export async function loadJobs(projectId?: string): Promise<StoredJob[]> {
  const all = (await run<StoredJob[]>(JOBS, 'readonly', s => s.getAll() as IDBRequest<StoredJob[]>)) ?? [];
  const list = projectId ? all.filter(j => j.projectId === projectId) : all;
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveProject(project: StoredProject): Promise<void> {
  await run(PROJECTS, 'readwrite', s => s.put(project));
}

export async function loadProjects(): Promise<StoredProject[]> {
  const all = (await run<StoredProject[]>(PROJECTS, 'readonly', s => s.getAll() as IDBRequest<StoredProject[]>)) ?? [];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** Löscht ein Objekt samt seiner Aufträge. */
export async function deleteProject(projectId: string): Promise<void> {
  const jobs = await loadJobs(projectId);
  await Promise.all(jobs.map(j => deleteJob(j.id)));
  await run(PROJECTS, 'readwrite', s => s.delete(projectId));
}

/** Entfernt alles, was älter als RETENTION_DAYS ist. */
export async function prune(): Promise<number> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const jobs = await loadJobs();
  const old = jobs.filter(j => j.createdAt < cutoff);
  await Promise.all(old.map(j => deleteJob(j.id)));

  const projects = await loadProjects();
  const remaining = new Set((await loadJobs()).map(j => j.projectId));
  await Promise.all(
    projects
      .filter(p => p.createdAt < cutoff && !remaining.has(p.id))
      .map(p => run(PROJECTS, 'readwrite', s => s.delete(p.id)))
  );
  return old.length;
}

/** Belegter Speicher in Megabyte, für die Anzeige. */
export async function usageMb(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ? Math.round((est.usage / 1024 / 1024) * 10) / 10 : null;
  } catch {
    return null;
  }
}
