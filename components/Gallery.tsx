import React from 'react';
import { ImageJob, Jahreszeit, OptimizationOptions, Tageszeit } from '../App';
import { GalleryItem } from './GalleryItem';
import { MagicWandIcon } from './icons/MagicWandIcon';

interface GalleryProps {
  jobs: ImageJob[];
  isProcessing: boolean;
  onTransform: () => void;
  /** Neu: bricht den laufenden Stapel ab, fertige Bilder bleiben erhalten. */
  onCancel: () => void;
  onReset: () => void;
  onRetry: (jobId: string) => void;
  onRedoWithPro: (jobId: string) => void;
  onRedoWithHD: (jobId: string) => void;
  onZoomOut: (jobId: string) => void;
  onZoomIn: (jobId: string) => void;
  onFurnish: (jobId: string) => void;
  onIntenseSun: (groupId: string) => void;
  onLessSun: (groupId: string) => void;
  onShallowSun: (groupId: string) => void;
  onCustomEdit: (jobId: string, prompt: string) => void;
  onSoftenEdges: (jobId: string) => void;
  optimizationOptions: OptimizationOptions;
  onOptimizationChange: (options: OptimizationOptions) => void;
  selectedTageszeiten: Tageszeit[];
  onTageszeitChange: (tageszeiten: Tageszeit[]) => void;
  progress: { current: number; total: number };
  watermarkLogo: string | null;
}

const TAGESZEIT_OPTIONS: Tageszeit[] = ['Original', 'Sunrise', 'Mittags', 'Nachmittags', 'Sundown', 'Nacht'];

/** Fokus-Varianten des Detail-Moduls – waren bisher nicht auswählbar. */
const DETAIL_OPTIONS: Tageszeit[] = ['Original', 'Design & Material', 'Licht & Atmosphäre', 'Möbel & Deko'];

export const tageszeitLabels: Record<Tageszeit, string> = {
  Original: 'Original',
  Sunrise: 'Sonnenaufgang',
  Mittags: 'Mittags',
  Nachmittags: 'Nachmittags',
  Sundown: 'Dämmerung / Blaue Stunde',
  Nacht: 'Nacht',
  Normal: 'Freundlich & Hell',
  Intensiv: 'Intensive Sonne',
  Subtil: 'Weniger Sonne',
  ShallowSun: 'Sonne flach (EG)',
  'Digital Staging': 'Digital Staging',
  'Design & Material': 'Design & Material',
  'Licht & Atmosphäre': 'Licht & Atmosphäre',
  'Möbel & Deko': 'Möbel & Deko',
};

const SEASONS: Array<{ value: Jahreszeit; label: string; icon: string }> = [
  { value: 'none', label: 'Original', icon: '🚫' },
  { value: 'fruehling', label: 'Frühling', icon: '🌱' },
  { value: 'sommer', label: 'Sommer', icon: '☀️' },
  { value: 'herbst', label: 'Herbst', icon: '🍁' },
  { value: 'winter', label: 'Winter', icon: '❄️' },
];

export const Gallery: React.FC<GalleryProps> = ({
  jobs, isProcessing, onTransform, onCancel, onReset, onRetry, onRedoWithPro, onRedoWithHD,
  onZoomOut, onZoomIn, onFurnish, onIntenseSun, onLessSun, onShallowSun,
  onCustomEdit, onSoftenEdges, optimizationOptions, onOptimizationChange,
  selectedTageszeiten, onTageszeitChange, progress, watermarkLogo,
}) => {
  const hasPendingJobs = jobs.some(job => job.status === 'pending');
  const firstType = jobs.length > 0 ? jobs[0].imageType : null;
  const isAuto = firstType === 'auto';
  // Die Automatik zeigt die Aussen-Optionen: Innenaufnahmen laufen dort auf
  // dem Standard, Aussenaufnahmen brauchen die Auswahl.
  const isExterior = firstType === 'exterior' || isAuto;
  const isStaging = firstType === 'staging';
  const isDetail = firstType === 'detail';

  const toggleTageszeit = (tageszeit: Tageszeit) => {
    // In der Automatik genau eine Tageszeit: Innenaufnahmen ignorieren sie,
    // mehrere Varianten würden dort mehrfach abgerechnet ohne Unterschied.
    if (isAuto) {
      onTageszeitChange([tageszeit]);
      return;
    }
    if (selectedTageszeiten.includes(tageszeit)) {
      onTageszeitChange(selectedTageszeiten.filter(t => t !== tageszeit));
      return;
    }
    if (selectedTageszeiten.length >= 3) return;
    onTageszeitChange([...selectedTageszeiten, tageszeit]);
  };

  const jobGroups = React.useMemo(
    () => jobs.reduce((acc, job) => {
      (acc[job.groupId] ||= []).push(job);
      return acc;
    }, {} as Record<string, ImageJob[]>),
    [jobs]
  );

  // Schnee entfernen und Winter widersprechen sich; im Prompt gewinnt der Schnee.
  const seasonConflict = optimizationOptions.entferneSchnee && optimizationOptions.jahreszeit === 'winter';

  const checkbox = (key: keyof OptimizationOptions, label: string, accent = false) => (
    <label className="flex items-center space-x-3 cursor-pointer p-2 rounded-md hover:bg-gray-200 transition-colors">
      <input
        type="checkbox"
        checked={Boolean(optimizationOptions[key])}
        onChange={e => onOptimizationChange({ ...optimizationOptions, [key]: e.target.checked })}
        className="h-5 w-5 rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
      />
      <span className={`select-none ${accent ? 'font-semibold text-brand-blue' : 'text-gray-700'}`}>{label}</span>
    </label>
  );

  return (
    <div className="w-full animate-fade-in">
      {hasPendingJobs && (
        <div className={`grid grid-cols-1 ${isExterior ? 'lg:grid-cols-2' : ''} gap-6 max-w-4xl mx-auto mb-8`}>
          {isExterior && (
            <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-800 mb-3 text-center">
                Tageszeit{' '}
                <span className="text-sm font-normal text-gray-500">
                  {isAuto ? '(eine)' : '(max. 3)'}
                </span>
              </h3>
              {isAuto && (
                <p className="text-[11px] text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2 mb-3 leading-relaxed">
                  Gilt nur für Bilder, die als Außenaufnahme erkannt werden.
                  Innenaufnahmen laufen automatisch auf „Freundlich &amp; Hell".
                </p>
              )}
              <div className="space-y-3">
                {TAGESZEIT_OPTIONS.map(option => (
                  <label key={option} className="flex items-center space-x-3 cursor-pointer p-2 rounded-md hover:bg-gray-200 transition-colors">
                    <input
                      type={isAuto ? 'radio' : 'checkbox'}
                      name={isAuto ? 'auto-tageszeit' : undefined}
                      checked={selectedTageszeiten.includes(option)}
                      onChange={() => toggleTageszeit(option)}
                      disabled={!isAuto && !selectedTageszeiten.includes(option) && selectedTageszeiten.length >= 3}
                      className={`h-5 w-5 border-gray-300 text-brand-blue focus:ring-brand-blue disabled:opacity-50 ${isAuto ? '' : 'rounded'}`}
                    />
                    <span className="text-gray-700 select-none">{tageszeitLabels[option]}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-gray-500 mt-3 text-center leading-relaxed">
                {isAuto
                  ? 'Ein Bild pro Foto. Innenaufnahmen ignorieren die Tageszeit.'
                  : 'Jede Auswahl erzeugt ein eigenes Bild und wird einzeln abgerechnet.'}
              </p>
            </div>
          )}

          <div className="space-y-6">
            {isAuto && (
              <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800 mb-2 text-center">🪄 Automatik</h3>
                <p className="text-[11px] text-gray-600 leading-relaxed text-center">
                  Jedes Bild wird einzeln geprüft: Außenaufnahmen bekommen die hier gewählte
                  Tageszeit und die Optionen, Innenaufnahmen die Standard-Lichtveredelung.
                  Am zuverlässigsten mit den Nano-Banana-Modellen.
                </p>
              </div>
            )}
            {isDetail && (
              <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800 mb-3 text-center">🔍 Detail-Fokus</h3>
                <div className="grid grid-cols-2 gap-2">
                  {DETAIL_OPTIONS.map(option => {
                    const active = selectedTageszeiten.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onTageszeitChange([option])}
                        className={`p-3 rounded-lg border text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-brand-blue ${
                          active
                            ? 'bg-brand-blue/15 border-brand-blue text-brand-blue ring-2 ring-brand-blue/15'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        {option === 'Original' ? 'Automatisch' : tageszeitLabels[option]}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-500 mt-2 text-center leading-relaxed">
                  Bestimmt, worauf die Nahaufnahme sich konzentriert. Automatisch sucht selbst das
                  markanteste Merkmal.
                </p>
              </div>
            )}

            <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-800 mb-3 text-center">Optimierungsoptionen</h3>
              <div className="space-y-3">
                {checkbox('verbessereHelligkeitKontrast', 'Helligkeit/Kontrast')}
                {checkbox('verbessereFarbe', 'Farbe verbessern')}
                {isExterior && (
                  <>
                    {checkbox('verbessereWetter', 'Wetter verbessern')}
                    {checkbox('fügeSonneHinzu', 'Sonne hinzufügen')}
                    {checkbox('fügeSonneMitLensflaresHinzu', 'Sonne + Lensflares')}
                    {checkbox('verbessereRasen', 'Rasen verbessern')}
                  </>
                )}
                {checkbox('entferneSchnee', '❄️ Schnee entfernen', true)}
              </div>
              {isExterior && !optimizationOptions.verbessereWetter && (
                <p className="text-[10px] text-gray-500 mt-3 leading-relaxed">
                  Der Himmel bleibt unverändert, solange „Wetter verbessern" aus ist.
                </p>
              )}
            </div>

            {!isStaging && !isDetail && (
              <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800 mb-3 text-center">🍂 Jahreszeit anpassen</h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {SEASONS.map(season => {
                    const active = (optimizationOptions.jahreszeit || 'none') === season.value;
                    return (
                      <button
                        key={season.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onOptimizationChange({ ...optimizationOptions, jahreszeit: season.value })}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-blue ${
                          active
                            ? 'bg-brand-blue/15 border-brand-blue text-brand-blue ring-2 ring-brand-blue/15 shadow-sm'
                            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        <span className="text-xl mb-1">{season.icon}</span>
                        <span>{season.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-500 mt-2 text-center font-medium leading-relaxed">
                  Passt Blätter, Bäume und Sträucher an. Es kommen keine neuen Pflanzen oder Beete dazu.
                </p>
                {seasonConflict && (
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 leading-relaxed">
                    Winter und „Schnee entfernen" widersprechen sich. Der Schnee wird entfernt, die
                    Jahreszeit bleibt außen vor.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
        {hasPendingJobs && (
          <button
            onClick={onTransform}
            disabled={isProcessing || (isExterior && selectedTageszeiten.length === 0)}
            className="w-full sm:w-auto flex-1 sm:max-w-xs bg-brand-blue hover:bg-brand-blue-hover text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-3"
          >
            <MagicWandIcon className="w-6 h-6" />
            Magie entfesseln
          </button>
        )}
        <button
          onClick={onReset}
          className="w-full sm:w-auto flex-1 sm:max-w-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-6 rounded-lg transition-colors duration-200"
        >
          Neu beginnen
        </button>
      </div>

      {isProcessing && progress.total > 0 && (
        <div className="my-8 max-w-4xl mx-auto px-2">
          <div className="flex justify-between items-center mb-2">
            <span className="text-base font-semibold text-brand-blue">Bilder werden verarbeitet …</span>
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-brand-blue">
                {progress.current} / {progress.total}
              </span>
              <button
                onClick={onCancel}
                type="button"
                className="text-xs font-bold text-gray-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 shadow-inner">
            <div
              className="bg-brand-yellow h-3 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
              role="progressbar"
              aria-valuenow={progress.current}
              aria-valuemin={0}
              aria-valuemax={progress.total}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            Drei Bilder laufen gleichzeitig. Fertige Bilder bleiben beim Abbrechen erhalten.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {Object.values(jobGroups).map(jobGroup => (
          <GalleryItem
            key={jobGroup[0].groupId}
            jobs={jobGroup}
            onRetry={onRetry}
            onRedoWithPro={onRedoWithPro}
            onRedoWithHD={onRedoWithHD}
            onZoomOut={onZoomOut}
            onZoomIn={onZoomIn}
            onFurnish={onFurnish}
            onIntenseSun={onIntenseSun}
            onLessSun={onLessSun}
            onShallowSun={onShallowSun}
            onCustomEdit={onCustomEdit}
            onSoftenEdges={onSoftenEdges}
            watermarkLogo={watermarkLogo}
          />
        ))}
      </div>
    </div>
  );
};
