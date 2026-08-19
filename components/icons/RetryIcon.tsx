
import React from 'react';

interface IconProps {
  className?: string;
}

export const RetryIcon: React.FC<IconProps> = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className} 
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor" 
    strokeWidth={2.5}
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      d="M20 4v5h-5M4 20v-5h5M4 12c0-4.418 3.582-8 8-8 1.933 0 3.697.685 5.071 1.828M20 12c0 4.418-3.582 8-8 8-1.933 0-3.697-.685-5.071-1.828" 
    />
  </svg>
);
