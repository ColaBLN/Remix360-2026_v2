
import React from 'react';

interface IconProps {
  className?: string;
}

export const IntenseSunIcon: React.FC<IconProps> = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className} 
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor" 
    strokeWidth={2}
  >
    <circle cx="12" cy="12" r="4" />
    <path strokeLinecap="round" d="M12 2v3m0 14v3M2 12h3m14 0h3m-3.07-7.07l-2.12 2.12m-9.19 9.19l-2.12 2.12m0-13.43l2.12 2.12m9.19 9.19l2.12 2.12M12 7V5m0 14v-2M7 12H5m14 0h-2m-1.41-5.59l-1.42 1.42M8.41 15.59l-1.42 1.42m0-8.48l1.42 1.42m8.48 8.48l1.42 1.42" />
  </svg>
);
