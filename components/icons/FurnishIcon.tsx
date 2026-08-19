
import React from 'react';

interface IconProps {
  className?: string;
}

export const FurnishIcon: React.FC<IconProps> = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className} 
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor" 
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12V8a2 2 0 00-2-2H6a2 2 0 00-2 2v4m16 0h-3m3 0v7a1 1 0 01-1 1H5a1 1 0 01-1-1v-7m16 0H4m16 0h-3m-10 0H4m13 0V9a2 2 0 00-2-2H9a2 2 0 00-2 2v3m10 0h-3m-4 0h-3" />
  </svg>
);
