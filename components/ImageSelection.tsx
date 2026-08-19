
import React, { useState, useEffect } from 'react';
import { ImageType, StagingMode, RoomType } from '../App';

export type StagingConfigMap = Record<number, { mode: StagingMode; roomType: RoomType }>;

interface ImageSelectionProps {
  files: File[];
  selectedType: ImageType;
  onConfirm: (selectedIndices: number[], stagingConfigs: StagingConfigMap) => void;
  onBack: () => void;
}

export const ImageSelection: React.FC<ImageSelectionProps> = ({ files, selectedType, onConfirm, onBack }) => {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set(files.map((_, i) => i)));
  const [stagingConfigs, setStagingConfigs] = useState<StagingConfigMap>(
    files.reduce((acc, _, i) => ({ ...acc, [i]: { mode: 'furnished' as StagingMode, roomType: 'Wohnzimmer' as RoomType } }), {})
  );
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setThumbnails(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);

  const toggleIndex = (idx: number) => {
    const next = new Set(selectedIndices);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setSelectedIndices(next);
  };

  const updateStagingConfig = (idx: number, updates: Partial<{ mode: StagingMode; roomType: RoomType }>) => {
    setStagingConfigs(prev => ({
      ...prev,
      [idx]: { ...prev[idx], ...updates }
    }));
  };

  const selectAll = () => setSelectedIndices(new Set(files.map((_, i) => i)));
  const deselectAll = () => setSelectedIndices(new Set());

  const isStaging = selectedType === 'staging';

  return (
    <div className="w-full max-w-6xl mx-auto animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div className="text-left">
          <h2 className="text-2xl font-bold text-brand-blue">Bilder auswählen</h2>
          <p className="text-gray-500">
            {isStaging 
              ? 'Konfigurieren Sie jedes Bild individuell für das Digital Staging.' 
              : `Welche Bilder sollen bearbeitet werden? (${selectedIndices.size} ausgewählt)`}
          </p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={selectAll}
            className="text-sm font-semibold text-brand-yellow hover:underline bg-yellow-50 px-3 py-1 rounded"
          >
            Alle auswählen
          </button>
          <button 
            onClick={deselectAll}
            className="text-sm font-semibold text-gray-500 hover:underline bg-gray-100 px-3 py-1 rounded"
          >
            Auswahl aufheben
          </button>
        </div>
      </div>

      <div className={`grid gap-6 mb-10 ${isStaging ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'}`}>
        {thumbnails.map((url, idx) => {
          const isSelected = selectedIndices.has(idx);
          const config = stagingConfigs[idx];

          return (
            <div 
              key={idx}
              className={`flex flex-col bg-white rounded-2xl overflow-hidden border-4 transition-all duration-200 shadow-sm
                ${isSelected ? 'border-brand-yellow scale-[1.02]' : 'border-transparent opacity-80'}`}
            >
              <div className="relative aspect-video cursor-pointer group" onClick={() => toggleIndex(idx)}>
                <img src={url} alt={`Upload ${idx}`} className="w-full h-full object-cover" />
                
                <div className={`absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-md z-10
                  ${isSelected ? 'bg-brand-yellow text-white' : 'bg-white/90 text-gray-300'}`}>
                  {isSelected && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {!isSelected && <div className="absolute inset-0 bg-white/20"></div>}
              </div>

              {isStaging && isSelected && (
                <div className="p-4 space-y-4 bg-gray-50 border-t border-gray-100">
                  <div>
                    <div className="flex rounded-lg overflow-hidden border border-gray-200">
                      <button 
                        onClick={() => updateStagingConfig(idx, { mode: 'empty' })}
                        className={`flex-1 py-1.5 text-xs font-bold transition-colors ${config.mode === 'empty' ? 'bg-brand-blue text-white' : 'bg-white text-gray-500'}`}
                      >
                        Leeren
                      </button>
                      <button 
                        onClick={() => updateStagingConfig(idx, { mode: 'furnished' })}
                        className={`flex-1 py-1.5 text-xs font-bold transition-colors ${config.mode === 'furnished' ? 'bg-brand-blue text-white' : 'bg-white text-gray-500'}`}
                      >
                        Einrichten
                      </button>
                    </div>
                  </div>

                  {config.mode === 'furnished' && (
                    <div>
                      <select 
                        value={config.roomType}
                        onChange={(e) => updateStagingConfig(idx, { roomType: e.target.value as RoomType })}
                        className="w-full text-xs p-2 rounded border border-gray-200 focus:border-brand-blue outline-none font-semibold text-gray-700 bg-white"
                      >
                        <option value="Wohnzimmer">Wohnzimmer</option>
                        <option value="Balkon">Balkon</option>
                        <option value="Terrasse">Terrasse</option>
                        <option value="Schlafzimmer">Schlafzimmer</option>
                        <option value="Küche">Küche</option>
                        <option value="Kinderzimmer">Kinderzimmer</option>
                        <option value="Esszimmer">Esszimmer</option>
                        <option value="Bad">Bad</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <button
          onClick={onBack}
          className="w-full sm:w-48 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-6 rounded-lg transition-colors duration-200"
        >
          Zurück
        </button>
        <button
          onClick={() => onConfirm(Array.from(selectedIndices), stagingConfigs)}
          disabled={selectedIndices.size === 0}
          className="w-full sm:w-64 bg-brand-blue hover:bg-brand-blue-hover text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 disabled:bg-gray-400 disabled:scale-100 disabled:cursor-not-allowed shadow-lg"
        >
          Bearbeitung starten ({selectedIndices.size})
        </button>
      </div>
    </div>
  );
};
