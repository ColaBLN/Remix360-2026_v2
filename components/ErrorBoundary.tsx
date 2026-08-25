import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Fängt Render-Fehler ab.
 *
 * Ohne diese Klammer hängt React bei einem Fehler die gesamte Oberfläche ab:
 * weißer Bildschirm, kein Hinweis. Zusammen mit der Ablage in IndexedDB heißt
 * ein Fehler jetzt: ärgerlich, aber die Arbeit ist noch da.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Remix360Pro] Render-Fehler:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-gray-100 p-8 text-center">
          <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0l-7.1 12.25A2 2 0 004.99 19z" />
            </svg>
          </div>

          <h1 className="text-xl font-bold text-gray-900 mb-2">Da ist etwas schiefgelaufen</h1>
          <p className="text-sm text-gray-600 mb-6 leading-relaxed">
            Die Oberfläche konnte nicht gezeichnet werden. Deine gespeicherten Bearbeitungen sind
            davon nicht betroffen und stehen nach dem Neuladen wieder zur Verfügung.
          </p>

          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-brand-blue text-white font-bold rounded-xl hover:bg-brand-blue-hover transition-colors"
          >
            Neu laden
          </button>

          <details className="mt-6 text-left">
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
              Technische Details
            </summary>
            <pre className="mt-2 text-[10px] text-gray-500 bg-gray-50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
