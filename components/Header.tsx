import React from 'react';
import {
  UsageData, calculateCosts, getGenerationLogs, clearGenerationLogs, GenerationLogEntry,
} from '../services/usageService';
import { connectedProviders, PROVIDERS, pricingByQuality, type Quality } from '../services/providers';

interface HeaderProps {
  modelProfile: Quality;
  onModelProfileChange: (profile: Quality) => void;
  budgetLimit: number;
  onBudgetLimitChange: (limit: number) => void;
  monthlyUsage: UsageData;
  hasApiKey: boolean;
  onConnectKey: () => void;
  onDisconnectKey: () => void;
  watermarkLogo: string | null;
  onWatermarkUpload: (base64: string) => void;
  onWatermarkRemove: () => void;
}

const PROFILE_META: Record<Quality, { icon: string; label: string; accent: string; active: string }> = {
  eco: {
    icon: '🌱', label: 'Eco Mode',
    accent: 'text-gray-500 hover:text-gray-800 hover:bg-white/40',
    active: 'bg-white text-green-700 border border-green-200 font-bold shadow-md ring-1 ring-green-100',
  },
  hd: {
    icon: '⚡', label: 'HD Balance',
    accent: 'text-gray-500 hover:text-brand-blue hover:bg-white/40',
    active: 'bg-brand-blue text-white font-bold shadow-md border border-brand-blue',
  },
  ultra: {
    icon: '👑', label: 'Ultra Pro',
    accent: 'text-gray-500 hover:text-gray-800 hover:bg-white/40',
    active: 'bg-white text-amber-700 border border-amber-300 font-bold shadow-md ring-1 ring-amber-100',
  },
};

const QUALITY_BADGE: Record<Quality, string> = {
  eco: 'bg-green-100 text-green-800',
  hd: 'bg-blue-100 text-brand-blue',
  ultra: 'bg-amber-100 text-amber-800',
};

export const Header: React.FC<HeaderProps> = ({
  modelProfile, onModelProfileChange, budgetLimit, onBudgetLimitChange, monthlyUsage,
  hasApiKey, onConnectKey, onDisconnectKey,
  watermarkLogo, onWatermarkUpload, onWatermarkRemove,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showLogsModal, setShowLogsModal] = React.useState(false);
  const [logs, setLogs] = React.useState<GenerationLogEntry[]>([]);

  const currentCost = calculateCosts(monthlyUsage);
  const budgetPercentage = budgetLimit > 0 ? Math.min((currentCost / budgetLimit) * 100, 100) : 0;
  const isNearLimit = currentCost >= budgetLimit * 0.8;
  const isOverBudget = currentCost >= budgetLimit;

  // Preise kommen aus der Registry statt aus drei hartkodierten Stellen –
  // sonst zeigt der Dialog bei einem zweiten Anbieter schlicht Falsches an.
  const pricing = React.useMemo(() => pricingByQuality(), [hasApiKey, showLogsModal]);
  const connected = React.useMemo(() => connectedProviders(), [hasApiKey, showLogsModal]);

  React.useEffect(() => {
    if (showLogsModal) setLogs(getGenerationLogs());
  }, [showLogsModal, monthlyUsage]);

  const handleClearLogs = () => {
    clearGenerationLogs();
    setLogs([]);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => onWatermarkUpload(reader.result as string);
    reader.readAsDataURL(file);
  };

  const cachedCount = logs.filter(l => l.cached).length;

  return (
    <header className="w-full max-w-6xl mx-auto py-5 mb-8 flex flex-col xl:flex-row items-stretch justify-between gap-6 bg-white text-gray-800 rounded-3xl p-6 shadow-[0_15px_40px_rgba(20,55,88,0.06)] border border-gray-100">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 xl:w-1/4">
        <div className="text-left">
          <h1 className="text-3xl font-extrabold text-brand-blue tracking-wide flex items-center gap-2">
            Remix<span className="text-brand-yellow font-black">360</span>Pro
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-brand-blue/10 text-brand-blue shadow-inner border border-brand-blue/10">
              v4.0
            </span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 font-medium">
            Immobilienfotos verzaubern &amp; optimieren
          </p>
        </div>
      </div>

      <div className="flex flex-col md:grid md:grid-cols-2 xl:flex xl:flex-row items-stretch md:items-center gap-4 xl:w-3/4">

        {/* Modellprofil */}
        <div className="flex flex-col gap-1.5 bg-gray-50/70 p-2.5 rounded-2xl border border-gray-100 shadow-sm flex-1">
          <span className="text-[10px] font-bold tracking-wider text-gray-400 uppercase px-1 pb-0.5">
            KI-Modell &amp; Kostenkontrolle
          </span>
          <div className="grid grid-cols-3 gap-1 bg-gray-200/40 p-1 rounded-xl">
            {pricing.map(({ quality, costEur }) => {
              const meta = PROFILE_META[quality];
              const active = modelProfile === quality;
              return (
                <button
                  key={quality}
                  type="button"
                  onClick={() => onModelProfileChange(quality)}
                  aria-pressed={active}
                  className={`flex flex-col items-center justify-center px-1.5 py-1 rounded-lg text-center transition-all duration-200 ${active ? meta.active : meta.accent}`}
                >
                  <span className="text-xs flex items-center gap-1 font-semibold">
                    {meta.icon} {meta.label}
                  </span>
                  <span className={`text-[9px] font-medium ${active && quality === 'hd' ? 'text-brand-yellow' : 'opacity-80'}`}>
                    ca. {(costEur * 100).toFixed(1).replace('.', ',')}¢ / Bild
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Kosten und Budget */}
        <div className="flex flex-col gap-1.5 bg-gray-50/70 p-2.5 rounded-2xl border border-gray-100 shadow-sm flex-1">
          <div className="flex items-center justify-between text-[10px] font-bold tracking-wider text-gray-400 uppercase">
            <span className="flex items-center gap-1">
              Kosten diesen Monat
              <button
                onClick={() => setShowLogsModal(true)}
                className="text-white bg-brand-blue hover:bg-brand-blue-hover hover:scale-105 active:scale-95 transition-all ml-1.5 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider shadow-sm"
                title="Einzelkosten und Protokoll ansehen"
                type="button"
              >
                📊 Log
              </button>
            </span>
            <span className={isOverBudget ? 'text-red-600 font-extrabold' : isNearLimit ? 'text-orange-600 font-bold' : 'text-green-600 font-bold'}>
              {currentCost.toFixed(3)} €
            </span>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-1.5 border border-gray-200 overflow-hidden mt-0.5">
            <div
              style={{ width: `${budgetPercentage}%` }}
              className={`h-full transition-all duration-300 ${isOverBudget ? 'bg-red-500' : isNearLimit ? 'bg-orange-500' : 'bg-green-500'}`}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
            <span className="font-semibold flex items-center gap-1">
              Limit:
              <select
                value={budgetLimit}
                onChange={e => onBudgetLimitChange(parseFloat(e.target.value))}
                className="bg-white border border-gray-200 text-gray-700 rounded-lg text-[10px] font-semibold py-0.5 px-1.5 shadow-sm focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue cursor-pointer"
              >
                {[1, 2, 5, 10, 20, 50].map(v => (
                  <option key={v} value={v}>{v.toFixed(2)} €</option>
                ))}
              </select>
            </span>
            <span className="text-[9px] text-gray-400 font-medium">
              {isOverBudget ? '⚠️ Eco-Rückfall aktiv' : `${connected.length} Anbieter verbunden`}
            </span>
          </div>
        </div>

        {/* Logo und Key */}
        <div className="flex items-center justify-between col-span-2 md:col-span-1 gap-2 bg-gray-50/70 p-2.5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-1.5 p-1 rounded-lg">
            <input type="file" ref={fileInputRef} onChange={handleLogoChange} accept="image/png" className="hidden" />
            {watermarkLogo ? (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-white border border-gray-200 p-0.5 overflow-hidden flex items-center justify-center shadow-inner">
                  <img src={watermarkLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
                </div>
                <button
                  onClick={onWatermarkRemove}
                  className="text-[9px] font-extrabold text-red-500 hover:text-red-700 uppercase tracking-tight"
                  title="Logo entfernen"
                  type="button"
                >
                  Entfernen
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                type="button"
                className="flex items-center gap-1 text-[9px] font-bold text-gray-500 hover:text-brand-blue uppercase tracking-wider"
              >
                <span>🖼️ Logo</span>
              </button>
            )}
          </div>

          <div className="h-6 w-px bg-gray-200" />

          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${hasApiKey ? 'bg-green-500' : 'bg-red-400'}`} />
            <span className="text-[10px] font-semibold text-gray-500 tracking-tight">
              {hasApiKey ? `Key: ${connected.map(id => PROVIDERS[id].label).join(', ')}` : 'Kein Key'}
            </span>
            <button
              onClick={onConnectKey}
              type="button"
              className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-gray-50 border border-gray-200 text-gray-600 hover:text-brand-blue font-bold text-[10px] uppercase tracking-tight shadow-sm transition-all"
            >
              {hasApiKey ? 'Verwalten' : 'Verbinden'}
            </button>
            {hasApiKey && (
              <button
                onClick={onDisconnectKey}
                type="button"
                className="p-1 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-red-600"
                title="Alle Schlüssel trennen"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Kosten-Protokoll */}
      {showLogsModal && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 font-sans text-gray-800">
          <div className="bg-white border border-gray-200 rounded-[2rem] w-full max-w-3xl overflow-hidden shadow-[0_25px_60px_rgba(20,55,88,0.15)] flex flex-col max-h-[85vh] animate-fade-in">
            <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-extrabold text-brand-blue flex items-center gap-2">📊 Kosten-Protokoll</h3>
                <p className="text-xs text-gray-500 mt-1 font-medium">
                  Was jede Aktion gekostet hat, und mit welchem Modell sie gelaufen ist.
                </p>
              </div>
              <button
                onClick={() => setShowLogsModal(false)}
                className="p-1 px-3.5 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors text-xs font-bold border border-gray-200 shadow-sm"
                type="button"
              >
                Schließen ✕
              </button>
            </div>

            <div className="p-6 bg-gray-50/20 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-gray-100">
              {pricing.map(({ quality, label, providerLabel, costEur }) => (
                <div key={quality} className="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm">
                  <div className="text-xs font-bold flex items-center justify-between gap-2">
                    <span>{PROFILE_META[quality].icon} {PROFILE_META[quality].label}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${QUALITY_BADGE[quality]}`}>
                      {providerLabel}
                    </span>
                  </div>
                  <div className="mt-2 text-lg font-black text-gray-900">
                    {costEur.toFixed(4)} €
                    <span className="text-xs font-normal text-gray-400"> / Bild</span>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 truncate" title={label}>{label}</p>
                </div>
              ))}
            </div>

            <div className="p-5 bg-gray-50/50 text-[11px] text-gray-600 flex items-start gap-3 border-b border-gray-100 leading-relaxed">
              <span className="text-base">💡</span>
              <div>
                <strong className="text-gray-800">Woraus sich die Kosten ergeben:</strong>
                <ul className="list-disc pl-4 mt-1.5 space-y-1 text-[10px]">
                  <li>
                    <span className="font-semibold">Mehrfachauswahl:</span> Drei Tageszeiten für ein Haus
                    sind drei separate Bilder und werden dreifach abgerechnet.
                  </li>
                  <li>
                    <span className="font-semibold">Nachbearbeitung:</span> Zoom Out, Schatten weicher,
                    Möblieren und jeder Freitext-Prompt sind jeweils ein neuer Auftrag.
                  </li>
                  <li>
                    <span className="font-semibold">Zwischenspeicher:</span> Eine identische Wiederholung
                    kommt aus dem Speicher und kostet nichts.
                    {cachedCount > 0 && ` In diesem Protokoll ${cachedCount} Mal genutzt.`}
                  </li>
                  <li>
                    <span className="font-semibold">Sparmodus:</span> Ist er aktiv, laufen Belichtung und
                    Himmel automatisch auf der günstigsten Stufe, unabhängig vom gewählten Profil.
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-white p-5 min-h-[220px]">
              <div className="flex items-center justify-between mb-3.5 text-xs font-bold text-gray-400">
                <span>PROTOKOLL ({logs.length} Einträge)</span>
                {logs.length > 0 && (
                  <button
                    onClick={handleClearLogs}
                    className="text-[10px] font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 transition-colors uppercase tracking-wider px-2 py-1 rounded-md border border-red-100"
                    type="button"
                  >
                    Verlauf leeren
                  </button>
                )}
              </div>

              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <span className="text-2xl mb-2 text-gray-400">📜</span>
                  <p className="text-xs text-gray-400 max-w-sm">
                    Noch nichts protokolliert. Sobald du Bilder bearbeitest, steht hier jede
                    einzelne Aktion mit ihren Kosten.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                        <th className="pb-2">Zeitstempel</th>
                        <th className="pb-2">Modell</th>
                        <th className="pb-2">Aktion</th>
                        <th className="pb-2 text-right">Kosten</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {logs.map(log => {
                        const quality = log.quality ?? 'eco';
                        return (
                          <tr key={log.id} className="hover:bg-gray-50/60 text-gray-600 font-medium whitespace-nowrap">
                            <td className="py-3 text-[10px] text-gray-400">{log.timestamp}</td>
                            <td className="py-3">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${QUALITY_BADGE[quality]}`}>
                                {PROFILE_META[quality].icon} {log.displayName}
                              </span>
                            </td>
                            <td className="py-3 max-w-[250px] truncate text-gray-700 font-semibold" title={log.action}>
                              {log.action}
                            </td>
                            <td className={`py-3 text-right font-mono text-[11px] font-bold ${log.cached ? 'text-emerald-600' : 'text-gray-900'}`}>
                              {log.costEUR.toFixed(4)} €
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between text-xs text-gray-400">
              <span className="font-medium">Geschätzte Preise, Umrechnung 1 USD ≈ 0,92 €</span>
              <button
                onClick={() => setShowLogsModal(false)}
                className="py-1.5 px-5 bg-brand-blue text-white font-bold hover:bg-brand-blue-hover rounded-xl shadow-sm transition-all"
                type="button"
              >
                Fertig
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
