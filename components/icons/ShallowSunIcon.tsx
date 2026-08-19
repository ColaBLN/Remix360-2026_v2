import React from 'react';

export const ShallowSunIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <circle cx="12" cy="7" r="3" />
    <path d="M12 2v2" />
    <path d="M16 4l-1.5 1.5" />
    <path d="M8 4l1.5 1.5" />
    <path d="M12 12v4" />
    <path d="M9 18h6" />
    <path d="M10 21h4" />
  </svg>
);
