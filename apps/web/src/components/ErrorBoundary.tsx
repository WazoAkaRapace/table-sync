import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import i18next from '../i18n';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Titre affiché dans la carte de secours (par défaut : message générique). */
  title?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Les error boundaries imposent un composant à classe : seules
// getDerivedStateFromError / componentDidCatch peuvent intercepter une
// exception levée pendant le rendu d'un sous-arbre.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Erreur de rendu interceptée :', error, info.componentStack);
  }

  handleRetry = () => {
    // Remet la frontière à zéro : le sous-arbre planté est remonté de zéro.
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { children, title } = this.props;
    const { error } = this.state;
    if (error) {
      return (
        <div className="flex min-h-dvh items-center justify-center p-4">
          <div className="card w-full max-w-md p-6" role="alert">
            <div className="mb-2 text-4xl" aria-hidden="true">
              🎲
            </div>
            <h1 className="section-title mb-2">{title ?? i18next.t('err.titre')}</h1>
            <p className="mb-4 text-sm text-ink-500">{i18next.t('err.corps')}</p>
            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-ink-400">
                {i18next.t('err.details')}
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-parchment-100 p-2 text-xs break-words whitespace-pre-wrap text-ink-700">
                {error.message}
              </pre>
            </details>
            <div className="flex gap-2">
              <button type="button" className="btn-primary flex-1" onClick={this.handleRetry}>
                {i18next.t('err.reessayer')}
              </button>
              <button type="button" className="btn-secondary flex-1" onClick={this.handleReload}>
                {i18next.t('err.recharger')}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return children;
  }
}
