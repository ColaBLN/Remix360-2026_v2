import React from 'react';

/**
 * Bildmarke Remix360Pro.
 *
 * Der offene Ring steht für die 360-Grad-Drehung, die schräge Fläche für das
 * Sonnenlicht, das durchs Fenster auf den Boden fällt – die Kernaufgabe der
 * App. Zwei Formen, zwei Farben, keine Verläufe: bleibt bis auf Favicon-Größe
 * lesbar.
 *
 * Farben kommen aus der Marke (#143758 / #F7C047) und sind hier bewusst fest
 * verdrahtet, damit das Logo auch auf farbigem Grund und im Export stimmt.
 */
interface LogoProps {
  className?: string;
  /** Hell = für dunklen Untergrund: Ring wird weiß. */
  variant?: 'default' | 'light';
  title?: string;
}

export const Remix360Logo: React.FC<LogoProps> = ({
  className,
  variant = 'default',
  title = 'Remix360Pro',
}) => (
  <svg
    viewBox="0 0 100 100"
    className={className}
    role="img"
    aria-label={title}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="50"
      cy="50"
      r="40"
      fill="none"
      stroke={variant === 'light' ? '#FFFFFF' : '#143758'}
      strokeWidth="10"
      strokeLinecap="round"
      // Lücke oben rechts: die Öffnung macht aus dem Kreis eine Bewegung.
      strokeDasharray="188 63"
      transform="rotate(-52 50 50)"
    />
    <path d="M32 62 L54 34 L72 34 L50 62 Z" fill="#F7C047" />
  </svg>
);

/** Bildmarke plus Schriftzug, für Kopfbereiche. */
export const Remix360Wordmark: React.FC<{ className?: string; subtitle?: string }> = ({
  className,
  subtitle,
}) => (
  <div className={`flex items-center gap-3 ${className ?? ''}`}>
    <Remix360Logo className="h-11 w-11 flex-shrink-0" />
    <div className="leading-tight">
      <div className="text-3xl font-extrabold tracking-wide text-brand-blue">
        Remix<span className="font-black text-brand-yellow">360</span>Pro
      </div>
      {subtitle && <p className="text-sm text-gray-400 font-medium mt-0.5">{subtitle}</p>}
    </div>
  </div>
);
