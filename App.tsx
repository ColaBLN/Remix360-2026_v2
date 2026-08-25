import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { Gallery } from './components/Gallery';
import { ImageSelection, StagingConfigMap } from './components/ImageSelection';

import { runEditJob, type PipelineSettings } from './services/pipeline';
import { runPool } from './services/queue';
import {
  connectedProviders, getSelectedModelId, modelsForQuality, PROVIDERS,
  setKey, setSelectedModelId,
  type ProviderId, type Quality, type TaskKind,
} from './services/providers';
import { DEFAULT_OPTIONS, type OptimizationOptions, type Tageszeit } from './services/prompts';
import {
  addGenerationLog, calculateCosts, getMonthlyUsage, trackUsage, type UsageData,
} from './services/usageService';
import { hasVariant, type ImageJob, type ImageType, jobsReducer, makeJob } from './state/jobsReducer';
import {
  deleteJob, loadJobs, loadProjects, prune, requestPersistence,
  saveJob, saveProject, type StoredJob,
} from './services/db';
import { fromDataUrl, toDataUrl } from './utils/image';
import { safeLocalStorage, generateUUID } from './utils/safeStorage';

export type { ImageJob, ImageType } from './state/jobsReducer';
export type {
  OptimizationOptions, Tageszeit, StagingMode, RoomType, Jahreszeit,
} from './services/prompts';

/** Drei Bilder gleichzeitig. Höher provoziert bei den meisten Keys 429. */
const PARALLEL_JOBS = 3;

/** Zugangscode als SHA-256 in VITE_ACCESS_HASH. Leer = keine Abfrage. */
const ACCESS_HASH: string = (import.meta.env.VITE_ACCESS_HASH as string | undefined) ?? '';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<'select_type' | 'upload' | 'select_images' | 'gallery'>('select_type');
  const [isAuthorized, setIsAuthorized] = useState<boolean>(!ACCESS_HASH);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [selectedType, setSelectedType] = useState<ImageType | null>(null);

  const [jobs, dispatch] = useReducer(jobsReducer, []);
  const jobsRef = useRef<ImageJob[]>([]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const [optimizationOptions, setOptimizationOptions] = useState<OptimizationOptions>(DEFAULT_OPTIONS);
  const [selectedTageszeiten, setSelectedTageszeiten] = useState<Tageszeit[]>(['Original']);

  const [modelProfile, setModelProfile] = useState<Quality>(
    () => (safeLocalStorage.getItem('foto_magic_model_profile') as Quality) || 'hd'
  );
  const [budgetLimit, setBudgetLimit] = useState<number>(
    () => parseFloat(safeLocalStorage.getItem('foto_magic_budget_limit') || '') || 10
  );

  const [showKeyEntry, setShowKeyEntry] = useState(false);
  const [keyProvider, setKeyProvider] = useState<ProviderId>('gemini');
  const [keyDraft, setKeyDraft] = useState('');
  const [connected, setConnected] = useState<ProviderId[]>(() => connectedProviders());
  /** Nur um nach einer Modellwahl neu zu zeichnen. */
  const [modelChoiceTick, setModelChoiceTick] = useState(0);

  const [watermarkLogo, setWatermarkLogo] = useState<string | null>(
    () => safeLocalStorage.getItem('watermark_logo')
  );
  const [monthlyUsage, setMonthlyUsage] = useState<UsageData>(getMonthlyUsage());

  /**
   * Objekt der laufenden Sitzung. Ohne Verwaltungsoberfläche bekommt jede
   * Sitzung automatisch eines, benannt nach Datum und Uhrzeit.
   */
  const [projectId, setProjectId] = useState<string>(() => generateUUID());
  /** Wiederherstellbarer Stand aus einer früheren Sitzung. */
  const [resumable, setResumable] = useState<{ count: number; label: string } | null>(null);

  const hasApiKey = connected.length > 0;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Ohne diese Bitte darf iOS die Ablage jederzeit verwerfen.
      void requestPersistence();
      await prune();
      const stored = await loadJobs();
      if (cancelled || stored.length === 0) return;
      const projects = await loadProjects();
      const latest = projects[0];
      const done = stored.filter(j => j.status === 'completed').length;
      setResumable({
        count: done || stored.length,
        label: latest
          ? new Date(latest.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })
          : '',
      });
    })();
    return () => { cancelled = true; };
  }, []);

  /** Object-URLs wurden bisher nie freigegeben – bei langen Sitzungen ein Leck. */
  const objectUrls = useRef<string[]>([]);
  useEffect(() => () => { objectUrls.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  const settings = useMemo<PipelineSettings>(() => ({
    preferred: modelProfile,
    providerOrder: connected.length ? connected : (['gemini', 'fal'] as ProviderId[]),
    spentEur: calculateCosts(monthlyUsage),
    budgetEur: budgetLimit,
    useCache: true,
  }), [modelProfile, connected, monthlyUsage, budgetLimit, modelChoiceTick]);

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const optionsRef = useRef(optimizationOptions);
  useEffect(() => { optionsRef.current = optimizationOptions; }, [optimizationOptions]);

  /* ---------------------------------------------------------------- */
  /* Kern: eine Funktion für jede Bearbeitung                          */
  /* ---------------------------------------------------------------- */

  /** Legt einen Auftrag in der Ablage ab. Fehler hier dürfen nichts blockieren. */
  const persist = useCallback(async (
    job: ImageJob,
    patch: Partial<StoredJob> & { source: Blob | null; result: Blob | null }
  ) => {
    try {
      await saveProject({
        id: job.projectId,
        name: new Date().toLocaleString('de-DE', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        }),
        createdAt: Date.now(),
      });
      const { source, ...rest } = patch;
      if (!source) return;
      await saveJob({
        id: job.id,
        projectId: job.projectId,
        groupId: job.groupId,
        source,
        sourceName: job.file.name,
        result: null,
        status: 'completed',
        tageszeit: job.tageszeit,
        imageType: job.imageType,
        stagingOptions: job.stagingOptions,
        createdAt: Date.now(),
        ...rest,
      });
    } catch (e) {
      console.warn('[Ablage] Auftrag konnte nicht gespeichert werden', e);
    }
  }, []);

  /** Baut gespeicherte Aufträge zurück in den Arbeitszustand. */
  const restoreJobs = useCallback(async () => {
    const stored = await loadJobs();
    if (stored.length === 0) return;

    const jobs: ImageJob[] = stored.map(sj => {
      // Die verkleinerte Quelle wird wieder zu einer File – dadurch
      // funktionieren Original-Ansicht und „Nochmal versuchen" unverändert.
      const file = new File([sj.source], sj.sourceName || 'bild.jpg', { type: sj.source.type });
      const originalUrl = URL.createObjectURL(file);
      objectUrls.current.push(originalUrl);

      let generatedUrl: string | null = null;
      if (sj.result) {
        generatedUrl = URL.createObjectURL(sj.result);
        objectUrls.current.push(generatedUrl);
      }

      return {
        id: sj.id,
        projectId: sj.projectId,
        groupId: sj.groupId,
        file,
        originalUrl,
        generatedUrl,
        status: sj.result ? 'completed' : 'pending',
        error: sj.error,
        note: sj.note,
        tageszeit: sj.tageszeit,
        imageType: sj.imageType as ImageType,
        stagingOptions: sj.stagingOptions,
        modelLabel: sj.modelLabel,
        costEur: sj.costEur,
        cached: sj.cached,
        promptVersion: sj.promptVersion,
        restored: true,
      };
    });

    setProjectId(jobs[0].projectId);
    setSelectedType(jobs[0].imageType);
    dispatch({ type: 'replace', jobs });
    setResumable(null);
    setAppState('gallery');
  }, []);

  const discardStored = useCallback(async () => {
    const stored = await loadJobs();
    await Promise.all(stored.map(j => deleteJob(j.id)));
    setResumable(null);
  }, []);

  const taskForJob = (job: ImageJob): TaskKind => {
    if (job.imageType === 'staging') {
      return job.stagingOptions?.mode === 'empty' ? 'stage-empty' : 'stage-furnish';
    }
    if (job.imageType === 'interior') return 'interior';
    if (job.imageType === 'detail') return 'detail';
    if (job.imageType === 'auto') return 'auto';
    return 'exterior';
  };

  const describe = (task: TaskKind, job: ImageJob): string => {
    switch (task) {
      case 'interior': return `Innenraum-Veredelung (${job.tageszeit})`;
      case 'exterior': return `Außenbereich (Tageszeit: ${job.tageszeit})`;
      case 'auto': return `Automatik (Tageszeit: ${job.tageszeit})`;
      case 'stage-empty': return `Digital Staging (Raum leeren)`;
      case 'stage-furnish': return `Digital Staging (Möblieren als ${job.stagingOptions?.roomType ?? ''})`;
      case 'detail': return `Detail-Nahaufnahme (${job.tageszeit})`;
      case 'outdoor-furnish': return 'Möblieren / Outdoor Staging';
      case 'outpaint': return 'Zoom Out / Outpainting';
      case 'soften': return 'Schatten weicher machen';
      case 'custom': return 'Custom-Edit / KI-Pinsel';
    }
  };

  const process = useCallback(async (
    job: ImageJob,
    task: TaskKind,
    opts: {
      source?: Blob;
      force?: Quality;
      userPrompt?: string;
      signal?: AbortSignal;
      /** Folgeoperation: arbeitet auf dem bisherigen Ergebnis statt auf der Datei. */
      fromResult?: boolean;
      /** Wiederholung: erzwingt eine neue Fassung statt eines Cache-Treffers. */
      bypassCache?: boolean;
    } = {}
  ) => {
    dispatch({ type: 'patch', id: job.id, patch: { status: 'processing', error: undefined, note: undefined } });

    try {
      // Vorher wurde aus "task !== taskForJob(job)" geraten, ob auf dem
      // Ergebnis gearbeitet wird. Im Detail-Modul war Zoom In dieselbe Aufgabe
      // wie der Erstlauf – die Folgeoperation lief also wieder auf dem
      // Original, mit identischem Cache-Schlüssel, und lieferte sichtbar
      // dasselbe Bild zurück. Jetzt sagt der Aufrufer es explizit.
      let source: Blob = opts.source ?? job.file;
      if (opts.fromResult && job.generatedUrl) {
        const { base64, mimeType } = fromDataUrl(job.generatedUrl);
        source = await (await fetch(toDataUrl(base64, mimeType))).blob();
      }

      // Die verkleinerte Quelle wird für die Ablage aufgehoben: nicht die
      // Rohdatei aus der Kamera, sondern genau das, was zum Modell geht.
      let preparedSource: Blob | null = null;

      const result = await runEditJob({
        task,
        source,
        tageszeit: job.tageszeit,
        options: optionsRef.current,
        roomType: job.stagingOptions?.roomType,
        userPrompt: opts.userPrompt,
        force: opts.force,
        signal: opts.signal,
        bypassCache: opts.bypassCache,
      },
        settingsRef.current,
        note => dispatch({ type: 'patch', id: job.id, patch: { note } }),
        jpeg => { preparedSource = jpeg; }
      );

      if (!result.cached) trackUsage(result.modelId, result.costUsd);
      addGenerationLog(result.modelId, describe(task, job), {
        costUsd: result.costUsd,
        cached: result.cached,
      });
      setMonthlyUsage(getMonthlyUsage());

      dispatch({
        type: 'patch', id: job.id,
        patch: {
          status: 'completed',
          generatedUrl: toDataUrl(result.base64, result.mimeType),
          modelLabel: result.modelLabel,
          costEur: result.cached ? 0 : result.costUsd * 0.92,
          cached: result.cached,
          note: result.note,
          error: undefined,
        },
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        dispatch({ type: 'patch', id: job.id, patch: { status: 'pending' } });
        return;
      }
      dispatch({
        type: 'patch', id: job.id,
        patch: { status: 'failed', error: err instanceof Error ? err.message : 'Unbekannter Fehler' },
      });
    }
  }, []);

  const processBatch = useCallback(async (batch: ImageJob[]) => {
    if (batch.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setProgress({ current: 0, total: batch.length });
    dispatch({ type: 'patchMany', ids: batch.map(j => j.id), patch: { status: 'processing' } });

    await runPool(batch, job => process(job, taskForJob(job), { signal: controller.signal }), {
      concurrency: PARALLEL_JOBS,
      signal: controller.signal,
      onSettled: () => setProgress(p => ({ ...p, current: p.current + 1 })),
    });

    setIsProcessing(false);
    abortRef.current = null;
  }, [process]);

  const handleTransform = useCallback(() => {
    if (isProcessing) return;
    void processBatch(jobsRef.current.filter(j => j.status === 'pending'));
  }, [isProcessing, processBatch]);

  const handleCancel = useCallback(() => { abortRef.current?.abort(); }, []);

  /* ---------------------------------------------------------------- */
  /* Auswahl und Upload                                                */
  /* ---------------------------------------------------------------- */

  const handleTypeSelect = (type: ImageType) => {
    setSelectedType(type);
    setAppState('upload');
  };

  const handleImageUpload = (files: FileList) => {
    setPendingFiles(Array.from(files));
    setAppState('select_images');
  };

  const handleSelectionConfirm = (selectedIndices: number[], stagingConfigs: StagingConfigMap) => {
    if (selectedIndices.length === 0 || !selectedType) return;

    const initial: Tageszeit[] =
      selectedType === 'interior' ? ['Normal']
      : selectedType === 'staging' ? ['Digital Staging']
      : ['Original'];

    const newJobs: ImageJob[] = [];
    selectedIndices.forEach(idx => {
      const file = pendingFiles[idx];
      const groupId = generateUUID();
      const originalUrl = URL.createObjectURL(file);
      objectUrls.current.push(originalUrl);

      initial.forEach(tageszeit => newJobs.push(makeJob({
        projectId, groupId, file, originalUrl, tageszeit,
        imageType: selectedType,
        stagingOptions: selectedType === 'staging' ? stagingConfigs[idx] : undefined,
      })));
    });

    setSelectedTageszeiten(initial);
    dispatch({ type: 'replace', jobs: newJobs });
    setAppState('gallery');

    // Außenaufnahmen starten erst auf Knopfdruck, damit die Wetteroptionen
    // vorher gesetzt werden können.
    if (selectedType !== 'exterior' && selectedType !== 'auto') void processBatch(newJobs);
  };

  const handleTageszeitChange = (newSelection: Tageszeit[]) => {
    setSelectedTageszeiten(newSelection);
    const current = jobsRef.current;
    const processed = current.filter(j => j.status !== 'pending');

    const groups = new Map<string, ImageJob>();
    current.filter(j => j.status === 'pending').forEach(j => {
      if (!groups.has(j.groupId)) groups.set(j.groupId, j);
    });

    const next: ImageJob[] = [];
    groups.forEach((sample, groupId) => {
      newSelection.forEach(tageszeit => next.push(makeJob({
        projectId: sample.projectId,
        groupId,
        file: sample.file,
        originalUrl: sample.originalUrl,
        tageszeit,
        imageType: sample.imageType,
        stagingOptions: sample.stagingOptions,
      })));
    });

    dispatch({ type: 'replace', jobs: [...processed, ...next] });
  };

  /* ---------------------------------------------------------------- */
  /* Einzelaktionen                                                    */
  /* ---------------------------------------------------------------- */

  const byId = (id: string) => jobsRef.current.find(j => j.id === id);

  const handleRetry = useCallback((jobId: string, force?: Quality) => {
    const job = byId(jobId);
    if (!job) return;
    // Wiederholung heisst: neu rechnen, nicht den alten Treffer zeigen.
    void process({ ...job, generatedUrl: null }, taskForJob(job), {
      source: job.file, force, bypassCache: true,
    });
  }, [process]);

  const handleRedoWithPro = useCallback((jobId: string) => {
    if (!hasApiKey) return setShowKeyEntry(true);
    handleRetry(jobId, 'ultra');
  }, [hasApiKey, handleRetry]);

  const handleRedoWithHD = useCallback((jobId: string) => {
    if (!hasApiKey) return setShowKeyEntry(true);
    handleRetry(jobId, 'hd');
  }, [hasApiKey, handleRetry]);

  /** Ersetzt handleZoomOut, handleZoomIn, handleFurnish und handleSoftenEdges. */
  const followUp = useCallback((jobId: string, task: TaskKind, userPrompt?: string) => {
    const job = byId(jobId);
    if (!job?.generatedUrl) return;
    void process(job, task, { userPrompt, fromResult: true });
  }, [process]);

  const handleZoomOut = useCallback((id: string) => followUp(id, 'outpaint'), [followUp]);
  const handleZoomIn = useCallback((id: string) => followUp(id, 'detail'), [followUp]);
  const handleFurnish = useCallback((id: string) => followUp(id, 'outdoor-furnish'), [followUp]);
  const handleSoftenEdges = useCallback((id: string) => followUp(id, 'soften'), [followUp]);
  const handleCustomEdit = useCallback(
    (id: string, prompt: string) => followUp(id, 'custom', prompt), [followUp]);

  /** Ersetzt die drei identischen Sonnen-Handler. */
  const addVariant = useCallback((groupId: string, tageszeit: Tageszeit) => {
    const current = jobsRef.current;
    if (hasVariant(current, groupId, tageszeit)) return;
    const sample = current.find(j => j.groupId === groupId);
    if (!sample) return;

    const job = makeJob({
      projectId: sample.projectId,
      groupId,
      file: sample.file,
      originalUrl: sample.originalUrl,
      tageszeit,
      imageType: sample.imageType,
      stagingOptions: sample.stagingOptions,
    });
    dispatch({ type: 'add', jobs: [job] });
    void process(job, taskForJob(job));
  }, [process]);

  const handleIntenseSun = useCallback((g: string) => addVariant(g, 'Intensiv'), [addVariant]);
  const handleLessSun = useCallback((g: string) => addVariant(g, 'Subtil'), [addVariant]);
  const handleShallowSun = useCallback((g: string) => addVariant(g, 'ShallowSun'), [addVariant]);

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    objectUrls.current.forEach(u => URL.revokeObjectURL(u));
    objectUrls.current = [];
    dispatch({ type: 'reset' });
    setIsProcessing(false);
    setProgress({ current: 0, total: 0 });
    setSelectedTageszeiten(['Original']);
    setAppState('select_type');
    setPendingFiles([]);
    setSelectedType(null);
    setProjectId(generateUUID());
  }, []);

  /* ---------------------------------------------------------------- */
  /* Keys, Wasserzeichen, Zugang                                       */
  /* ---------------------------------------------------------------- */

  const handleSaveKey = () => {
    setKey(keyProvider, keyDraft);
    setConnected(connectedProviders());
    setKeyDraft('');
    setShowKeyEntry(false);
  };

  const handleDisconnectKey = () => {
    (Object.keys(PROVIDERS) as ProviderId[]).forEach(id => setKey(id, ''));
    setConnected([]);
    setModelProfile('eco');
    safeLocalStorage.removeItem('foto_magic_model_profile');
  };

  const handleWatermarkUpload = (base64: string) => {
    setWatermarkLogo(base64);
    safeLocalStorage.setItem('watermark_logo', base64);
  };

  const handleWatermarkRemove = () => {
    setWatermarkLogo(null);
    safeLocalStorage.removeItem('watermark_logo');
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = (await sha256(password.trim().toLowerCase())) === ACCESS_HASH;
    setIsAuthorized(ok);
    setPasswordError(!ok);
  };

  /* ---------------------------------------------------------------- */
  /* Ansichten                                                         */
  /* ---------------------------------------------------------------- */

  const MODULES: Array<{ type: ImageType; icon: string; title: string; subtitle: string; styles: string }> = [
    { type: 'interior', icon: '🛋️', title: 'Innenaufnahme', subtitle: 'Helligkeit & Sonnenlicht',
      styles: 'border-brand-blue text-brand-blue hover:bg-blue-50' },
    { type: 'exterior', icon: '☀️', title: 'Außenaufnahme', subtitle: 'Himmel-Austausch & Wetter',
      styles: 'border-brand-yellow text-gray-800 hover:bg-yellow-50' },
    { type: 'staging', icon: '✨', title: 'Digital Staging', subtitle: 'Raum leeren & Einrichten',
      styles: 'border-purple-500 text-purple-600 hover:bg-purple-50' },
    { type: 'detail', icon: '🔍', title: 'Zoom & Detail', subtitle: 'Findet & fokussiert Highlights',
      styles: 'border-emerald-500 text-emerald-600 hover:bg-emerald-50' },
    { type: 'auto', icon: '🪄', title: 'Automatik', subtitle: 'Erkennt innen oder außen selbst',
      styles: 'border-gray-800 text-gray-800 hover:bg-gray-100' },
  ];

  const renderContent = () => {
    if (!isAuthorized) {
      return (
        <div className="flex items-center justify-center min-h-[70vh] animate-fade-in px-4">
          <div className="w-full max-w-md p-10 bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(20,55,88,0.15)] border border-gray-50 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-blue via-brand-yellow to-brand-blue" />
            <div className="w-24 h-24 bg-brand-blue/5 rounded-3xl flex items-center justify-center mx-auto mb-8 transform rotate-3 hover:rotate-0 transition-transform duration-500">
              <div className="w-16 h-16 bg-brand-blue rounded-2xl flex items-center justify-center shadow-lg shadow-brand-blue/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>
            <h2 className="text-3xl font-extrabold text-brand-blue mb-2 tracking-tight">
              Remix<span className="text-brand-yellow">360</span>Pro
            </h2>
            <p className="text-gray-400 mb-10 text-sm font-medium uppercase tracking-widest">
              Bildbearbeitung für Immobilien
            </p>
            <form onSubmit={handlePasswordSubmit} className="space-y-6">
              <div className="relative">
                <input
                  type="password"
                  placeholder="Zugangscode"
                  aria-label="Zugangscode"
                  className={`w-full px-6 py-4 rounded-2xl border-2 ${passwordError ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50/50'} focus:outline-none focus:border-brand-blue focus:bg-white transition-all text-center text-lg font-semibold placeholder:text-gray-300 placeholder:font-normal`}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setPasswordError(false); }}
                  autoFocus
                />
                {passwordError && (
                  <div className="absolute -bottom-6 left-0 w-full text-center">
                    <p className="text-red-500 text-[10px] font-bold uppercase tracking-tight">
                      Code stimmt nicht. Nochmal versuchen.
                    </p>
                  </div>
                )}
              </div>
              <button type="submit" className="w-full py-4 bg-brand-blue text-white font-black rounded-2xl hover:bg-brand-blue-hover transform active:scale-[0.98] transition-all shadow-xl shadow-brand-blue/20 text-sm uppercase tracking-[0.2em]">
                Öffnen
              </button>
            </form>
            <div className="mt-12 pt-8 border-t border-gray-50">
              <p className="text-[9px] text-gray-300 uppercase tracking-[0.3em] font-bold">&copy; 2026 immo360grad</p>
            </div>
          </div>
        </div>
      );
    }

    if (showKeyEntry || !hasApiKey) {
      const provider = PROVIDERS[keyProvider];
      return (
        <div className="w-full max-w-2xl mx-auto p-10 bg-white rounded-2xl shadow-xl border border-gray-100 animate-fade-in">
          <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">Anbieter verbinden</h2>
          <p className="text-sm text-gray-500 mb-8 text-center">
            Der Schlüssel bleibt in diesem Browser und wird nirgendwo hochgeladen.
          </p>

          <div className="flex gap-2 mb-6 justify-center">
            {(Object.keys(PROVIDERS) as ProviderId[]).map(id => (
              <button
                key={id}
                onClick={() => { setKeyProvider(id); setKeyDraft(''); }}
                className={`px-5 py-2 rounded-xl text-sm font-bold transition-colors ${
                  keyProvider === id ? 'bg-brand-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {PROVIDERS[id].label}
                {connected.includes(id) && <span className="ml-2 text-emerald-400">●</span>}
              </button>
            ))}
          </div>

          <div className="max-w-md mx-auto space-y-4">
            <div className="flex gap-2">
              <input
                type="password"
                placeholder={provider.keyPlaceholder}
                aria-label={`API-Schlüssel für ${provider.label}`}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue"
                value={keyDraft}
                onChange={e => setKeyDraft(e.target.value)}
              />
              <button
                onClick={handleSaveKey}
                disabled={!keyDraft.trim()}
                className="px-5 py-3 bg-brand-blue text-white rounded-xl font-bold hover:bg-brand-blue-hover disabled:opacity-40 transition-colors"
              >
                Speichern
              </button>
            </div>

            <p className="text-xs text-gray-500">
              Schlüssel anlegen bei{' '}
              <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-brand-blue underline">
                {provider.label}
              </a>. Mehrere Anbieter gleichzeitig sind erlaubt – fällt einer aus, übernimmt der nächste.
            </p>

            <ul className="text-xs text-gray-500 bg-gray-50 rounded-xl p-4 space-y-1 list-disc list-inside">
              <li>Modelle mit hinterlegter Zahlungsmethode laufen ohne Tageslimit.</li>
              <li>Das Budget oben rechts begrenzt den Verbrauch pro Monat.</li>
              <li>Identische Wiederholungen kommen aus dem Zwischenspeicher und kosten nichts.</li>
            </ul>

            {connected.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-gray-700">Modell pro Stufe</p>
                {(['eco', 'hd', 'ultra'] as Quality[]).map(quality => {
                  const options = modelsForQuality(quality);
                  if (options.length === 0) return null;
                  const selected = getSelectedModelId(quality) ?? options[0].id;
                  const label = { eco: '🌱 Eco', hd: '⚡ HD', ultra: '👑 Ultra' }[quality];
                  return (
                    <label key={quality} className="flex items-center gap-3 text-xs">
                      <span className="w-16 flex-shrink-0 font-semibold text-gray-600">{label}</span>
                      <select
                        value={selected}
                        onChange={e => {
                          setSelectedModelId(quality, e.target.value);
                          setModelChoiceTick(t => t + 1);
                        }}
                        className="flex-1 bg-white border border-gray-200 rounded-lg py-1.5 px-2 text-xs font-medium text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-blue"
                      >
                        {options.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.label} · ca. {(m.costUsd * 0.92).toFixed(3)} €
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Nano Banana ist Googles Bildmodell auf fal-Infrastruktur – dieselbe Familie wie der
                  direkte Gemini-Zugang, nur über einen anderen Schlüssel.
                </p>
              </div>
            )}


            {hasApiKey && (
              <button
                onClick={() => setShowKeyEntry(false)}
                className="w-full py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition-all"
              >
                Zurück
              </button>
            )}
          </div>
        </div>
      );
    }

    switch (appState) {
      case 'select_type':
        return (
          <div className="w-full max-w-4xl mx-auto text-center animate-fade-in">
            {resumable && (
              <div className="mb-8 bg-white border border-brand-blue/20 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
                <div>
                  <p className="font-bold text-brand-blue">
                    Letzte Sitzung fortsetzen
                  </p>
                  <p className="text-sm text-gray-500">
                    {resumable.count} {resumable.count === 1 ? 'Bild' : 'Bilder'}
                    {resumable.label && ` vom ${resumable.label}`} liegen noch bereit.
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => void discardStored()}
                    className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    Verwerfen
                  </button>
                  <button
                    onClick={() => void restoreJobs()}
                    className="px-5 py-2 bg-brand-blue text-white text-sm font-bold rounded-xl hover:bg-brand-blue-hover transition-colors"
                  >
                    Fortsetzen
                  </button>
                </div>
              </div>
            )}

            <h2 className="text-2xl font-bold text-brand-blue mb-4">Was möchten Sie tun?</h2>
            <p className="text-gray-600 mb-8">Wählen Sie das passende Modul für Ihre Immobilienfotos.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
              {MODULES.map(m => (
                <button
                  key={m.type}
                  onClick={() => handleTypeSelect(m.type)}
                  className={`flex flex-col items-center justify-center text-center h-48 bg-white border-2 font-semibold py-4 px-6 rounded-xl shadow-sm hover:shadow-lg transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue transition-all duration-300 ${m.styles}`}
                >
                  <span className="text-3xl mb-2">{m.icon}</span>
                  <span className="text-xl">{m.title}</span>
                  <p className="text-sm font-normal mt-1 text-gray-500">{m.subtitle}</p>
                </button>
              ))}
            </div>
          </div>
        );

      case 'upload':
        return (
          <div className="animate-fade-in">
            <div className="text-center mb-6">
              <button
                onClick={() => setAppState('select_type')}
                className="text-sm text-gray-500 hover:text-brand-blue flex items-center justify-center gap-1 mx-auto mb-4"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Zurück zur Auswahl
              </button>
              <h2 className="text-2xl font-bold text-brand-blue">Fotos hochladen</h2>
              <p className="text-gray-500">Große Dateien werden vor dem Senden automatisch verkleinert.</p>
            </div>
            <ImageUploader onImageSelect={handleImageUpload} />
          </div>
        );

      case 'select_images':
        return (
          <ImageSelection
            files={pendingFiles}
            selectedType={selectedType!}
            onConfirm={handleSelectionConfirm}
            onBack={() => setAppState('upload')}
          />
        );

      case 'gallery':
        return (
          <Gallery
            jobs={jobs}
            isProcessing={isProcessing}
            onTransform={handleTransform}
            onCancel={handleCancel}
            onReset={handleReset}
            onRetry={handleRetry}
            onRedoWithPro={handleRedoWithPro}
            onRedoWithHD={handleRedoWithHD}
            onZoomOut={handleZoomOut}
            onZoomIn={handleZoomIn}
            onFurnish={handleFurnish}
            onIntenseSun={handleIntenseSun}
            onLessSun={handleLessSun}
            onShallowSun={handleShallowSun}
            onCustomEdit={handleCustomEdit}
            onSoftenEdges={handleSoftenEdges}
            optimizationOptions={optimizationOptions}
            onOptimizationChange={setOptimizationOptions}
            selectedTageszeiten={selectedTageszeiten}
            onTageszeitChange={handleTageszeitChange}
            progress={progress}
            watermarkLogo={watermarkLogo}
          />
        );

      default:
        return <ImageUploader onImageSelect={handleImageUpload} />;
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <main className="container mx-auto px-4 py-8">
        {isAuthorized && (
          <Header
            modelProfile={modelProfile}
            onModelProfileChange={(profile: Quality) => {
              setModelProfile(profile);
              safeLocalStorage.setItem('foto_magic_model_profile', profile);
            }}
            budgetLimit={budgetLimit}
            onBudgetLimitChange={limit => {
              setBudgetLimit(limit);
              safeLocalStorage.setItem('foto_magic_budget_limit', String(limit));
            }}
            monthlyUsage={monthlyUsage}
            hasApiKey={hasApiKey}
            onConnectKey={() => setShowKeyEntry(true)}
            onDisconnectKey={handleDisconnectKey}
            watermarkLogo={watermarkLogo}
            onWatermarkUpload={handleWatermarkUpload}
            onWatermarkRemove={handleWatermarkRemove}
          />
        )}
        {renderContent()}
      </main>
      <footer className="fixed bottom-4 right-4 text-xs text-gray-400 font-semibold p-2 bg-white/50 backdrop-blur-sm rounded-lg">
        Remix360Pro
      </footer>
    </div>
  );
};

export default App;
