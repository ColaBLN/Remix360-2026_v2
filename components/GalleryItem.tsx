
import React, { useState } from 'react';
import { ImageJob, Tageszeit } from '../App';
import { Spinner } from './Spinner';
import { DownloadIcon } from './icons/DownloadIcon';
import { RetryIcon } from './icons/RetryIcon';
import { ZoomOutIcon } from './icons/ZoomOutIcon';
import { ZoomInIcon } from './icons/ZoomInIcon';
import { FurnishIcon } from './icons/FurnishIcon';
import { IntenseSunIcon } from './icons/IntenseSunIcon';
import { LessSunIcon } from './icons/LessSunIcon';
import { ShallowSunIcon } from './icons/ShallowSunIcon';
import { SoftenIcon } from './icons/SoftenIcon';
import { MagicWandIcon } from './icons/MagicWandIcon';
import { WatermarkIcon } from './icons/WatermarkIcon';
import { base64ToBlob } from '../utils/fileUtils';

const applyWatermark = (base64Image: string, watermarkUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // No crossOrigin needed for the main image if it's a data URL from our own app
        if (!base64Image.startsWith('data:')) {
            img.crossOrigin = "anonymous";
        }
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error("Could not get canvas context"));
                return;
            }
            ctx.drawImage(img, 0, 0);

            const watermark = new Image();
            // Critical for canvas: must have crossOrigin set to anonymous for external images
            watermark.crossOrigin = "anonymous";
            
            watermark.onload = () => {
                try {
                    // Full screen overlay, centered
                    // Since both are 16:9, we can just draw it over the whole area
                    ctx.globalAlpha = 1.0; // 100% opacity as requested
                    ctx.drawImage(watermark, 0, 0, img.width, img.height);
                    
                    resolve(canvas.toDataURL('image/jpeg', 0.95));
                } catch (e) {
                    console.error("Error drawing watermark:", e);
                    reject(e);
                }
            };
            
            watermark.onerror = (err) => {
                console.error("Watermark failed to load from URL:", watermarkUrl, err);
                reject(new Error("Watermark image failed to load. This is likely a CORS issue with the image host."));
            };
            
            // Use the proxied URL directly
            watermark.src = watermarkUrl;
        };
        
        img.onerror = (err) => {
            console.error("Main image failed to load:", err);
            reject(new Error("Main image failed to load"));
        };
        
        img.src = base64Image;
    });
};

interface GalleryItemProps {
  jobs: ImageJob[];
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
  onDeglare: (jobId: string) => void;
  watermarkLogo: string | null;
}

const tageszeitLabels: Record<Tageszeit, string> = {
    Original: 'Original',
    Sunrise: 'Sonnenaufgang',
    Mittags: 'Mittags',
    Nachmittags: 'Nachmittags',
    Sundown: 'Dämmerung',
    Nacht: 'Nacht',
    Normal: 'Freundlich & Hell',
    Intensiv: 'Intensive Sonne',
    Subtil: 'Weniger Sonne',
    ShallowSun: 'Sonne flach (EG)',
    'Digital Staging': 'Digital Staging',
    'Design & Material': 'Design & Material',
    'Licht & Atmosphäre': 'Licht & Atmosphäre',
    'Möbel & Deko': 'Möbel & Deko'
};

const TAGESZEIT_ORDER: Tageszeit[] = ['Original', 'Digital Staging', 'Normal', 'Subtil', 'ShallowSun', 'Intensiv', 'Sunrise', 'Mittags', 'Nachmittags', 'Sundown', 'Nacht', 'Design & Material', 'Licht & Atmosphäre', 'Möbel & Deko'];

export const GalleryItem: React.FC<GalleryItemProps> = ({ 
    jobs, onRetry, onRedoWithPro, onRedoWithHD, onZoomOut, onZoomIn, onFurnish, 
    onIntenseSun, onLessSun, onShallowSun, onCustomEdit, onSoftenEdges, onDeglare, watermarkLogo 
}) => {
    const firstJob = jobs[0];
    const isAuto = firstJob.imageType === 'auto';
    // In der Automatik steht erst nach der Generierung fest, was das Bild ist.
    // Deshalb beide Knopfgruppen zeigen – vorher fehlten sie dort komplett.
    const isInterior = firstJob.imageType === 'interior' || isAuto;
    const isExterior = firstJob.imageType === 'exterior' || isAuto;
    const hasIntense = jobs.some(j => j.tageszeit === 'Intensiv');
    const hasSubtil = jobs.some(j => j.tageszeit === 'Subtil');

    const handleSave = async (job: ImageJob) => {
        if (!job.generatedUrl) return;

        const fileName = `optimiert-${firstJob.file.name.split('.')[0]}-${job.tageszeit}.jpg`;

        if (navigator.share) {
            try {
                const base64Data = job.generatedUrl.split(',')[1];
                const blob = base64ToBlob(base64Data, 'image/jpeg');
                const file = new File([blob], fileName, { type: 'image/jpeg' });

                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Foto speichern',
                        text: 'Hier ist dein optimiertes foto.'
                    });
                    return;
                }
            } catch (error) {
                console.warn('Sharing failed, falling back to download:', error);
            }
        }

        const link = document.createElement('a');
        link.href = job.generatedUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    const handleSaveWithWatermark = async (job: ImageJob) => {
        if (!job.generatedUrl) return;

        // Vorher lag hier eine fest verdrahtete Google-Drive-Adresse als
        // Rückfall. Die wird beim Zeichnen auf Canvas praktisch immer von
        // CORS blockiert, wodurch still ohne Logo gespeichert wurde.
        if (!watermarkLogo) {
            alert('Kein Logo hinterlegt. Oben rechts im Kopfbereich unter „🖼️ Logo" eine PNG-Datei hochladen.');
            return;
        }

        try {
            const watermarkedBase64 = await applyWatermark(job.generatedUrl, watermarkLogo);
            const fileName = `optimiert-logo-${firstJob.file.name.split('.')[0]}-${job.tageszeit}.jpg`;

            const link = document.createElement('a');
            link.href = watermarkedBase64;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Watermark download failed:', error);
            // Fallback to normal save if watermark fails
            handleSave(job);
        }
    }

    return (
      <div className="w-full bg-gray-50 border border-gray-200 p-4 sm:p-6 rounded-xl shadow-md">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div>
            <h3 className="text-center text-lg font-semibold mb-3 text-gray-600 truncate" title={firstJob.file.name}>
              Original
            </h3>
            <div className="w-full">
              <img src={firstJob.originalUrl} alt={firstJob.file.name} className="w-full h-auto rounded-lg object-contain border border-gray-200 bg-white" />
            </div>
          </div>
          <div className="flex flex-col">
            <h3 className="text-center text-lg font-semibold mb-3 text-brand-blue">Verbessert</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-grow">
              {/* Kopie sortieren: .sort() verändert das Array an Ort und Stelle,
                  und das hier ist die Prop aus der Gallery. */}
              {[...jobs].sort((a,b) => TAGESZEIT_ORDER.indexOf(a.tageszeit) - TAGESZEIT_ORDER.indexOf(b.tageszeit)).map(job => (
                <ResultCard 
                    key={job.id} 
                    job={job} 
                    isInterior={isInterior} 
                    isExterior={isExterior} 
                    hasIntense={hasIntense} 
                    hasSubtil={hasSubtil}
                    hasShallow={jobs.some(j => j.tageszeit === 'ShallowSun')}
                    groupId={firstJob.groupId}
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
                    onDeglare={onDeglare}
                    onSave={handleSave}
                    onSaveWithWatermark={handleSaveWithWatermark}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
};

interface ResultCardProps {
    job: ImageJob;
    isInterior: boolean;
    isExterior: boolean;
    hasIntense: boolean;
    hasSubtil: boolean;
    hasShallow: boolean;
    groupId: string;
    onRetry: (id: string) => void;
    onRedoWithPro: (id: string) => void;
    onRedoWithHD: (id: string) => void;
    onZoomOut: (id: string) => void;
    onZoomIn: (id: string) => void;
    onFurnish: (id: string) => void;
    onIntenseSun: (groupId: string) => void;
    onLessSun: (groupId: string) => void;
    onShallowSun: (groupId: string) => void;
    onCustomEdit: (id: string, prompt: string) => void;
    onSoftenEdges: (id: string) => void;
    onDeglare: (id: string) => void;
    onSave: (job: ImageJob) => void;
    onSaveWithWatermark: (job: ImageJob) => void;
}

const ResultCard: React.FC<ResultCardProps> = ({ 
    job, isInterior, isExterior, hasIntense, hasSubtil, hasShallow, groupId,
    onRetry, onRedoWithPro, onRedoWithHD, onZoomOut, onZoomIn, onFurnish, onIntenseSun, onLessSun, onShallowSun, onCustomEdit, onSoftenEdges, onDeglare, onSave, onSaveWithWatermark 
}) => {
    const [editPrompt, setEditPrompt] = useState("");
    /** Ergebnis in voller Grösse ansehen – rein visuell, kostet nichts. */
    const [lightbox, setLightbox] = useState<string | null>(null);

    React.useEffect(() => {
        if (!lightbox) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [lightbox]);

    const handleEditSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (editPrompt.trim()) {
            onCustomEdit(job.id, editPrompt);
            setEditPrompt("");
        }
    };

    return (
        <div className="flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
            <h4 className="text-center text-md font-semibold my-2 text-gray-800">
                {job.stagingOptions ? `${job.stagingOptions.mode === 'empty' ? 'Raum leer' : job.stagingOptions.roomType}` : tageszeitLabels[job.tageszeit]}
            </h4>
            
            <div className="flex-grow flex justify-center items-center p-1 relative min-h-[160px]">
                {job.status === 'processing' && (
                    <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10 backdrop-blur-[2px]">
                        <Spinner />
                    </div>
                )}
                {job.status === 'failed' && (
                    <div className="p-2 text-center">
                        <p className="text-red-600 font-semibold text-sm">Fehler</p>
                        <p className="text-xs text-gray-500 mt-1 mb-2">{job.error}</p>
                    </div>
                )}
                {job.status === 'completed' && job.generatedUrl && (
                    <button
                        type="button"
                        onClick={() => setLightbox(job.generatedUrl)}
                        className="w-full h-full block cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-brand-blue rounded"
                        title="Groß ansehen"
                    >
                        <img src={job.generatedUrl} alt="Ergebnis" className="w-full h-auto object-contain" />
                    </button>
                )}
                {job.status === 'pending' && (
                    <div className="text-gray-400 text-sm p-2 text-center">Wartet...</div>
                )}
            </div>

            {/* Herkunft und Kosten pro Bild */}
            {job.status === 'completed' && job.modelLabel && (
                <div className="px-2 pt-1 flex items-center justify-between gap-2 text-[9px] text-gray-400 font-medium">
                    <span
                        className="truncate"
                        title={`${job.modelLabel}${job.promptVersion ? ` · Prompts ${job.promptVersion}` : ''}`}
                    >
                        {job.modelLabel}
                    </span>
                    {job.outputSize && (
                        <span
                            className={`flex-shrink-0 font-mono ${
                                job.outputSize.width * job.outputSize.height < 2_000_000
                                    ? 'text-amber-600 font-bold'
                                    : ''
                            }`}
                            title={`${job.outputSize.width} x ${job.outputSize.height} Pixel`}
                        >
                            {((job.outputSize.width * job.outputSize.height) / 1e6).toFixed(1)} MP
                        </span>
                    )}
                    <span className="flex-shrink-0 font-mono">
                        {job.cached
                            ? <span className="text-emerald-600 font-bold">aus dem Speicher · 0,0000 €</span>
                            : `${(job.costEur ?? 0).toFixed(4)} €`}
                    </span>
                </div>
            )}
            {job.note && job.status !== 'failed' && (
                <p className="px-2 pt-1 text-[9px] text-amber-700 leading-snug">{job.note}</p>
            )}

            {lightbox && (
                <div
                    className="fixed inset-0 z-[9998] bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in-fast"
                    onClick={() => setLightbox(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Ergebnis in voller Größe"
                >
                    <img
                        src={lightbox}
                        alt="Ergebnis in voller Größe"
                        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    />
                    <button
                        type="button"
                        onClick={() => setLightbox(null)}
                        className="absolute top-6 right-6 bg-white/90 hover:bg-white text-gray-800 rounded-full p-2 shadow-lg transition-colors"
                        aria-label="Schließen"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Individual Prompt Box */}
            {job.status === 'completed' && (
                <form onSubmit={handleEditSubmit} className="px-2 pb-2 mt-1">
                    <div className="relative flex items-center bg-gray-50 border border-gray-100 rounded-lg overflow-hidden focus-within:border-brand-blue/30 transition-colors">
                        <input 
                            type="text" 
                            placeholder="Bild anpassen..." 
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            className="w-full text-[11px] py-1.5 px-2 bg-transparent outline-none text-gray-700 font-medium"
                        />
                        <button 
                            type="submit"
                            disabled={!editPrompt.trim()}
                            className="p-1.5 text-brand-blue hover:text-brand-blue-hover disabled:opacity-30 transition-opacity"
                            title="Anpassung senden"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                            </svg>
                        </button>
                    </div>
                </form>
            )}

            <div className="p-2 border-t border-gray-200 bg-gray-50/30">
                {job.status === 'completed' && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            onClick={() => onSave(job)}
                            className="flex-grow min-w-[80px] bg-brand-blue hover:bg-brand-blue-hover text-white font-bold py-2 px-2 rounded-lg transition-colors duration-200 flex items-center justify-center text-sm"
                            title="Speichern"
                        >
                            <DownloadIcon className="w-4 h-4 mr-1" />
                            <span className="text-xs">Speichern</span>
                        </button>

                        <button
                            onClick={() => onSaveWithWatermark(job)}
                            className="flex-grow min-w-[80px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-2 rounded-lg transition-colors duration-200 flex items-center justify-center text-sm"
                            title="Speichern mit Logo"
                        >
                            <WatermarkIcon className="w-4 h-4 mr-1" />
                            <span className="text-xs">Logo</span>
                        </button>
                        
                        <div className="flex flex-wrap gap-1.5 w-full mt-1.5">
                            <button 
                                onClick={() => onZoomOut(job.id)}
                                className="flex-shrink-0 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center"
                                aria-label="Weitwinkel erzeugen"
                                title="Weitwinkel: Bildausschnitt erweitern (erzeugt ein neues Bild)"
                            >
                                <ZoomOutIcon className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => onZoomIn(job.id)}
                                className="flex-shrink-0 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center"
                                aria-label="Detailaufnahme erzeugen"
                                title="Detailaufnahme: Nahaufnahme eines Merkmals (erzeugt ein neues Bild)"
                            >
                                <ZoomInIcon className="w-4 h-4" />
                            </button>
                            
                            {isInterior && (
                                <button 
                                    onClick={() => onSoftenEdges(job.id)}
                                    className="flex-shrink-0 bg-purple-100 hover:bg-purple-200 text-purple-600 font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center"
                                    aria-label="Kanten weichzeichnen"
                                    title="Schattenkanten abmildern (Weicher)"
                                >
                                    <SoftenIcon className="w-4 h-4" />
                                </button>
                            )}

                            {isInterior && (
                                <button
                                    onClick={() => onDeglare(job.id)}
                                    className="flex-shrink-0 bg-sky-100 hover:bg-sky-200 text-sky-700 font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center"
                                    aria-label="Glanz entfernen"
                                    title="Glanz & Spiegelungen entfernen: retuschiert nur den Boden, ohne die Beleuchtung anzufassen (erzeugt ein neues Bild)"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 17h16M6 13h12M9 9h6" />
                                        <circle cx="12" cy="5" r="2" />
                                    </svg>
                                </button>
                            )}

                            {isInterior && !hasIntense && (
                                <button 
                                    onClick={() => onIntenseSun(groupId)}
                                    className="flex-shrink-0 bg-orange-100 hover:bg-orange-200 text-orange-600 font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center"
                                    aria-label="Intensive Sonne"
                                    title="Intensive Sonne anfordern"
                                >
                                    <IntenseSunIcon className="w-4 h-4" />
                                </button>
                            )}
                            {isInterior && !hasSubtil && (
                                <button 
                                    onClick={() => onLessSun(groupId)}
                                    className="flex-shrink-0 bg-blue-100 hover:bg-blue-200 text-blue-600 font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center"
                                    aria-label="Weniger Sonne"
                                    title="Weniger Sonne anfordern"
                                >
                                    <LessSunIcon className="w-4 h-4" />
                                </button>
                            )}
                            {isInterior && !hasShallow && (
                                <button 
                                    onClick={() => onShallowSun(groupId)}
                                    className="flex-shrink-0 bg-yellow-100 hover:bg-yellow-200 text-yellow-600 font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center"
                                    aria-label="Sonne flach"
                                    title="Sonne flach (nicht so weit in den Raum)"
                                >
                                    <ShallowSunIcon className="w-4 h-4" />
                                </button>
                            )}
                            {isExterior && (
                                <button
                                    onClick={() => onFurnish(job.id)}
                                    className="flex-shrink-0 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center"
                                    aria-label="Einrichten"
                                    title="Einrichten (Balkon/Terrasse)"
                                >
                                <FurnishIcon className="w-4 h-4" />
                                </button>
                            )}
                            <button 
                                onClick={() => onRetry(job.id)}
                                className="flex-shrink-0 bg-brand-yellow hover:bg-brand-yellow-hover text-brand-blue font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center transform hover:scale-105"
                                aria-label="Wiederholen"
                                title="Wiederholen (🌱 Eco-Modus)"
                            >
                                <RetryIcon className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => onRedoWithHD(job.id)}
                                className="flex-shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-1.5 rounded-lg transition-all duration-200 flex justify-center items-center shadow-md text-[10px] tracking-tight transform hover:scale-105 font-black px-2 py-1 leading-none"
                                aria-label="Redo with HD"
                                title="Wiederholen (⚡ HD Balance)"
                            >
                                HD
                            </button>
                            <button 
                                onClick={() => onRedoWithPro(job.id)}
                                className="flex-shrink-0 bg-brand-blue text-white hover:bg-brand-blue-hover font-bold p-1.5 rounded-lg transition-all duration-200 flex items-center justify-center transform hover:scale-105 shadow-sm"
                                aria-label="Redo with Pro"
                                title="Wiederholen (👑 Ultra Pro-Modus)"
                            >
                                <MagicWandIcon className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
                {job.status === 'failed' && (
                    <div className="flex gap-1">
                        <button 
                            onClick={() => onRetry(job.id)}
                            className="flex-1 bg-brand-yellow hover:bg-brand-yellow-hover text-brand-blue font-bold py-2 px-1 rounded-lg transition-all duration-200 flex items-center justify-center text-xs transform hover:scale-105"
                            title="Wiederholen (🌱 Eco-Modus)"
                        >
                            <RetryIcon className="w-3.5 h-3.5 mr-0.5" />
                            Eco
                        </button>
                        <button 
                            onClick={() => onRedoWithHD(job.id)}
                            className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 font-bold py-2 px-1 rounded-lg transition-all duration-200 flex items-center justify-center text-xs transform hover:scale-105"
                            title="Wiederholen (⚡ HD Balance)"
                        >
                            <span className="text-[10px] font-black mr-0.5">HD</span>
                            HD Retr.
                        </button>
                        <button 
                            onClick={() => onRedoWithPro(job.id)}
                            className="flex-1 bg-brand-blue text-white hover:bg-brand-blue-hover font-bold py-2 px-1 rounded-lg transition-all duration-200 flex items-center justify-center text-xs transform hover:scale-105"
                            title="Wiederholen (👑 Ultra Pro-Modus)"
                        >
                            <MagicWandIcon className="w-3.5 h-3.5 mr-0.5" />
                            Pro
                        </button>
                    </div>
                )}
                {(job.status === 'pending' || job.status === 'processing') && (
                    <div className="h-[44px]"></div>
                )}
            </div>
        </div>
    );
};
