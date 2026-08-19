
import React from 'react';

interface IconProps {
  className?: string;
}

export const LessSunIcon: React.FC<IconProps> = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className} 
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor" 
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m8.66 8.66l-.707-.707M12 20v1M4.05 12.05l-.707-.707M18.36 5.64l-.707.707M5.64 18.36l-.707.707" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.5 19c.707 0 1.346-.287 1.812-.75M17.5 19a2.5 2.5 0 01-2.5-2.5V16a5 5 0 00-10 0v.5A2.5 2.5 0 012.5 19h15z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
