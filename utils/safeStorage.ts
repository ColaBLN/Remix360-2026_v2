const fallbackStorage: Record<string, string> = {};

export const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`[safeLocalStorage] Access blocked for key "${key}". Using InMemory fallback.`, e);
      return fallbackStorage[key] !== undefined ? fallbackStorage[key] : null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`[safeLocalStorage] Access blocked for key "${key}". Using InMemory fallback.`, e);
      fallbackStorage[key] = value;
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`[safeLocalStorage] Access blocked for key "${key}". Using InMemory fallback.`, e);
      delete fallbackStorage[key];
    }
  }
};

export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (e) {
      // safe fallback on error
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/** JSON-Komfort auf demselben Fallback-Mechanismus. */
export const safeJSON = {
  get<T>(key: string, fallback: T): T {
    const raw = safeLocalStorage.getItem(key);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : (parsed as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      safeLocalStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[safeJSON] konnte nicht serialisieren', e);
    }
  },
};
