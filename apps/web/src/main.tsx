import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider, useAuth } from './auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initI18n } from './i18n';
import { registerServiceWorker } from './push';
import { SyncProvider } from './sync';
import './index.css';

// Client unique au module : une seule instance partagée par l'app.
// staleTime 30 s + pas de refocus : la fraîcheur est pilotée par les
// événements WebSocket (character/inventory/combat:change → invalidation),
// pas par le cycle de vie de l'onglet. retry: 1 — au-delà, le toast d'erreur
// suffit à la table de jeu.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppWithSync() {
  const { user } = useAuth();
  return (
    <SyncProvider user={user}>
      <App />
    </SyncProvider>
  );
}

// Drapeau posé par la garde inline de index.html quand le navigateur est
// sous le plancher CSS du bundle (Safari 16.4 / Chromium 111 / Firefox 128).
declare global {
  interface Window {
    __TS_UNSUPPORTED__?: boolean;
  }
}

function boot() {
  // Service worker push-only (aucun cache) : pas critique, échec silencieux.
  void registerServiceWorker();

  // Le rendu n'a lieu qu'i18n prêt (FR : bundle statique, immédiat ; EN : un
  // chunk dynamique) — aucun composant ne peut s'afficher avec des clés brutes.
  initI18n().then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <AuthProvider>
                <AppWithSync />
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </ErrorBoundary>
      </React.StrictMode>,
    );
  });
}

// Navigateur trop ancien : l'écran statique posé par index.html reste en
// place — pas de boot React par-dessus.
if (!window.__TS_UNSUPPORTED__) boot();
