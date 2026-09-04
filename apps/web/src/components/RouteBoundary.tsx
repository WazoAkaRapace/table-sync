import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import i18next from '../i18n';

interface RouteBoundaryState {
  error: Error | null;
  /** Nombre de remontages tentés (auto-retry puis manuel). */
  attempts: number;
}

/** Le message d'un chunk dynamique qui échoue au chargement (connexion
 *  coupée à mi-téléchargement) — navigateurs Chromium et WebKit/Firefox. */
function isChunkLoadError(err: Error): boolean {
  const m = err?.message ?? '';
  return (
    m.includes('dynamically imported module') ||
    m.includes('Importing a module script failed') ||
    m.includes('error loading dynamically imported') ||
    m.includes('Failed to fetch dynamically imported')
  );
}

/**
 * Frontière d'erreur PAR ROUTE : un chunk lazy qui échoue au téléchargement
 * (tablette qui perd le réseau à mi-page) ne doit plus blanchir TOUTE l'app
 * (la frontière racine reste en dernier recours). Premier échec = re-tentative
 * automatique (le réseau revient souvent en une seconde) ; ensuite, bouton
 * Réessayer qui remonte la route.
 */
export class RouteBoundary extends Component<{ children: ReactNode }, RouteBoundaryState> {
  state: RouteBoundaryState = { error: null, attempts: 0 };

  static getDerivedStateFromError(error: Error): Partial<RouteBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RouteBoundary] Erreur de route interceptée :', error, info.componentStack);
  }

  componentDidUpdate(_prev: unknown, prevState: RouteBoundaryState) {
    // Auto-retry UNE fois : les échecs de chunk sont presque toujours
    // transitoires (latence/perte réseau d'une seconde).
    if (this.state.error && !prevState.error && isChunkLoadError(this.state.error)) {
      const t = setTimeout(
        () => this.setState({ error: null, attempts: this.state.attempts + 1 }),
        800,
      );
      return () => clearTimeout(t);
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card mx-auto mt-16 max-w-md p-6 text-center" role="alert">
        <div className="mb-2 text-4xl" aria-hidden="true">
          📶
        </div>
        <h1 className="section-title mb-2">{i18next.t('err.titre')}</h1>
        <p className="mb-4 text-sm text-ink-500">{i18next.t('err.chargement.module')}</p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => this.setState({ error: null, attempts: this.state.attempts + 1 })}
          >
            {i18next.t('err.reessayer')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
            {i18next.t('err.recharger')}
          </button>
        </div>
      </div>
    );
  }
}
