import React, { useState, useCallback } from 'react';
import { UploadIcon } from './icons/UploadIcon';

interface ImageUploaderProps {
  onImageSelect: (files: FileList) => void;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageSelect }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImageSelect(e.target.files);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onImageSelect(e.dataTransfer.files);
    }
  }, [onImageSelect]);

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center justify-center w-full h-80 px-4 transition-colors duration-300 border-2 border-dashed rounded-xl cursor-pointer
        ${isDragging ? 'border-brand-blue bg-blue-50' : 'border-gray-300 bg-white hover:border-brand-blue'}`}
      >
        <div className="flex flex-col items-center text-center">
            <UploadIcon className={`w-16 h-16 mb-4 transition-colors duration-300 ${isDragging ? 'text-brand-blue' : 'text-gray-400'}`} />
            <p className="mb-2 text-lg font-semibold text-gray-700">
            Bilder hierher ziehen oder klicken
            </p>
            <p className="text-sm text-gray-500">PNG, JPG, WEBP usw.</p>
        </div>
        <input
            type="file"
            className="hidden"
            accept="image/*"
            onChange={handleFileChange}
            multiple
        />
      </label>
    </div>
  );
};
