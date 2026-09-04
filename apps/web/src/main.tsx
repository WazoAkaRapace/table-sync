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
