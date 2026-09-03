import type { ConcentrationCheck } from '@table-sync/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import api from './api';
import { useAuth } from './auth';
import CombatWidget from './components/CombatWidget';
import ConcentrationAlert from './components/ConcentrationAlert';
import MessageAlert, { type MessageAlertPayload } from './components/MessageAlert';
import UpdateBanner from './components/UpdateBanner';
import { HeaderProvider, useHeaderState } from './headerContext';
import i18next from './i18n';
import { useSync, useSyncEvent } from './sync';

// Route pages are code-split: each lazy() becomes its own chunk so the login
// screen doesn't pay for the GM dashboard / combat tracker / spell catalog.
// The dynamic-import paths MUST stay stable (wave-2 keeps every page's default
// export at the same path).
const AccountPage = lazy(() => import('./pages/AccountPage'));
const CharacterCreatePage = lazy(() => import('./pages/CharacterCreatePage'));
const CharacterInventoryPage = lazy(() => import('./pages/CharacterInventoryPage'));
const ChroniclePage = lazy(() => import('./pages/ChroniclePage'));
const CombatPage = lazy(() => import('./pages/CombatPage'));
const DmNotebookPage = lazy(() => import('./pages/DmNotebookPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const GmDashboardPage = lazy(() => import('./pages/GmDashboardPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const MessagesInboxPage = lazy(() => import('./pages/MessagesInboxPage'));
const NpcPage = lazy(() => import('./pages/NpcPage'));
const PartiesPage = lazy(() => import('./pages/PartiesPage'));
const PartyPage = lazy(() => import('./pages/PartyPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));

function SyncIndicator() {
  const { status } = useSync();
  const { t } = useTranslation();
  const labels = {
    connected: t('app.sync.connected'),
    connecting: t('app.sync.connecting'),
    disconnected: t('app.sync.disconnected'),
  };
  const colors = {
    connected: 'bg-green-400',
    connecting: 'bg-yellow-400',
    disconnected: 'bg-red-400',
  };

  // Dot for the happy path; text appears whenever the table would care
  // (connecting/disconnected) so the state is never color-only.
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-ink-300"
      role="status"
      aria-live="polite"
    >
      <span
        className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`}
        title={labels[status]}
        role="img"
        aria-label={labels[status]}
      />
      {status !== 'connected' && (
        <span className={status === 'disconnected' ? 'text-red-400 font-medium' : ''}>
          {labels[status]}
        </span>
      )}
    </span>
  );
}

/** Derive the module title + back link from the current route. */
function useRouteTitle(pathname: string): { title: string; backTo?: string } | null {
  const partyMatch = pathname.match(/^\/party\/(\d+)\/(.*)$/);
  if (partyMatch) {
    const sub = partyMatch[2];
    const partyBase = `/party/${partyMatch[1]}`;
    if (sub === 'gm') return { title: i18next.t('nav.table.du.md'), backTo: partyBase };
    if (sub === 'npcs') return { title: i18next.t('nav.pnj'), backTo: partyBase };
    if (sub === 'combat') return { title: i18next.t('nav.combat'), backTo: partyBase };
    if (sub === 'carnet') return { title: i18next.t('nav.carnet'), backTo: partyBase };
    if (sub === 'messages') return { title: i18next.t('nav.correspondance'), backTo: partyBase };
    if (sub === 'create')
      return { title: i18next.t('create.nouveau.personnage'), backTo: partyBase };
    if (sub.startsWith('character/'))
      return { title: i18next.t('nav.personnage'), backTo: partyBase };
    return { title: i18next.t('nav.groupe'), backTo: '/parties' };
  }
  return null;
}

function Nav() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const { t } = useTranslation();
  const { override } = useHeaderState();

  const routeTitle = useRouteTitle(loc.pathname);
  if (!user) return null;

  // A page can override the header (e.g., CombatPage shows the encounter name).
  // override.onBack = function → custom back action (button).
  // override.onBack = null → use the default route-based back link.
  const headerTitle = override?.title ?? routeTitle?.title;
  const headerBack = override?.onBack
    ? { label: '←', onClick: override.onBack }
    : routeTitle?.backTo
      ? { label: '←', to: routeTitle.backTo }
      : null;

  return (
    <header className="sticky top-0 z-30 bg-ink-900 text-parchment-50 shadow-md pt-[env(safe-area-inset-top)]">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {headerBack ? (
            <>
              {headerBack.onClick ? (
                <button
                  type="button"
                  onClick={headerBack.onClick}
                  className="btn-ghost text-parchment-50 hover:bg-ink-700 text-sm shrink-0"
                  aria-label={i18next.t('nav.retour')}
                >
                  {headerBack.label}
                </button>
              ) : (
                <Link
                  to={headerBack.to!}
                  className="btn-ghost text-parchment-50 hover:bg-ink-700 text-sm shrink-0"
                  aria-label={i18next.t('nav.retour')}
                >
                  {headerBack.label}
                </Link>
              )}
              <span className="font-display text-lg font-semibold truncate">{headerTitle}</span>
            </>
          ) : (
            <Link
              to="/parties"
              className="font-display text-lg font-semibold flex items-center"
              aria-label={t('app.home')}
            >
              <img src="/icon.svg" alt="" aria-hidden="true" className="w-8 h-8" />
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {override?.action && (
            <Link
              to={override.action.to}
              className="btn-ghost text-parchment-50 hover:bg-ink-700 text-sm"
            >
              <span className="hidden sm:inline">{override.action.label}</span>
              <span className="sm:hidden">{override.action.short}</span>
            </Link>
          )}
          {loc.pathname.startsWith('/party/') && !routeTitle?.backTo && (
            <Link to="/parties" className="btn-ghost text-parchment-50 hover:bg-ink-700 text-sm">
              <span className="hidden sm:inline">{t('app.mes.groupes')}</span>
              <span className="sm:hidden">🏠</span>
            </Link>
          )}
          {/* Le nom affiché mène au compte (desktop) ; sur /parties un bouton
              icône prend le relais pour le mobile, où le nom est masqué. */}
          <Link
            to="/compte"
            className="text-sm text-parchment-200 hidden sm:inline hover:text-parchment-50 hover:underline underline-offset-4"
            title={t('app.mon.compte')}
          >
            {user.displayName}
          </Link>
          <SyncIndicator />
          {loc.pathname === '/parties' && (
            <Link
              to="/compte"
              className="btn-ghost text-parchment-50 hover:bg-ink-700 flex items-center justify-center w-11 h-11"
              title={t('app.mon.compte')}
              aria-label={t('app.mon.compte')}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
                className="block w-5 h-5"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
              </svg>
            </Link>
          )}
          {loc.pathname === '/parties' && (
            <button
              type="button"
              onClick={logout}
              className="btn-ghost text-parchment-50 hover:bg-ink-700 flex items-center justify-center w-11 h-11"
              title={t('app.logout')}
              aria-label={t('app.logout')}
            >
              {/* Not the ⏻ character (U+23FB): Android font bundles lack the
                  glyph and render tofu — draw it instead */}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
                className="block w-5 h-5"
              >
                <path d="M12 2v10" />
                <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-ink-400 animate-pulse">{t('app.chargement')}</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Shows a concentration banner when a sync event reports that one of the
 * current user's characters took damage while concentrating (e.g. the GM
 * lowered their HP from the combat tracker).
 */
function ConcentrationWatcher() {
  const { user } = useAuth();
  const [check, setCheck] = useState<ConcentrationCheck | null>(null);
  useSyncEvent(
    (event) => {
      const c = event.concentration;
      // Own damage is already surfaced by the Survie tab's HTTP response — skip the echo.
      if (c && user && c.ownerId === user.id && event.actorUserId !== user.id) setCheck(c);
    },
    [user?.id],
  );
  if (!check) return null;
  return <ConcentrationAlert check={check} onDone={() => setCheck(null)} />;
}

/**
 * Shows a correspondence banner when a message:new event targeted this user
 * (delivery is user-scoped server-side). Own sends are skipped — the echo of
 * your own POST is not news. 'read' reflows and 'delete' prunings never
 * banner; opening the thread dismisses its banner (window event from
 * MessageThread).
 */
function MessageWatcher() {
  const { user } = useAuth();
  const [notice, setNotice] = useState<MessageAlertPayload | null>(null);

  useSyncEvent(
    (event) => {
      // Only a LANDED message banners — reflows and deletions stay silent
      if (event.type !== 'message:new' || (event.action && event.action !== 'new')) return;
      if (!user || event.targetUserId !== user.id || event.actorUserId === user.id) return;
      setNotice({
        partyId: event.partyId,
        characterId: event.characterId ?? 0,
        characterName: event.messageCharacterName ?? '',
        fromGM: event.messageFromGM ?? false,
        senderName: event.messageSenderName ?? '',
      });
    },
    [user?.id],
  );

  // The thread just marked read → its banner retires without a tap
  useEffect(() => {
    const onRead = (e: Event) => {
      const charId = (e as CustomEvent).detail?.charId;
      setNotice((n) => (n && n.characterId === charId ? null : n));
    };
    window.addEventListener('table-sync:message-read', onRead);
    return () => window.removeEventListener('table-sync:message-read', onRead);
  }, []);

  if (!notice) return null;
  return <MessageAlert notice={notice} onDone={() => setNotice(null)} />;
}

/**
 * Records party opens: entering any /party/:id/* route bumps the member's
 * last_opened_at so the register (/parties) pins the last opened group
 * first. Fires once per party entry — navigating between a party's
 * sub-pages keeps the same partyId and doesn't re-fire.
 */
function PartyOpenTracker() {
  const { user } = useAuth();
  const loc = useLocation();
  const userId = user?.id;
  const partyId = loc.pathname.match(/^\/party\/(\d+)/)?.[1];
  useEffect(() => {
    if (!userId || !partyId) return;
    api.post(`/api/parties/${partyId}/open`).catch(() => {
      // Fire-and-forget: a failed open only means yesterday's register order.
    });
  }, [userId, partyId]);
  return null;
}

/** Suspense fallback shown while a lazy route chunk downloads. */
function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="card max-w-xs mx-auto mt-16 p-6 text-center" role="status" aria-live="polite">
      <span className="text-ink-400 animate-pulse">{t('app.chargement')}</span>
    </div>
  );
}

export default function App() {
  return (
    <HeaderProvider>
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
            <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
            <Route path="/verifier-email" element={<VerifyEmailPage />} />
            <Route
              path="/compte"
              element={
                <ProtectedRoute>
                  <AccountPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/parties"
              element={
                <ProtectedRoute>
                  <PartiesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId"
              element={
                <ProtectedRoute>
                  <PartyPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId/create"
              element={
                <ProtectedRoute>
                  <CharacterCreatePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId/character/:charId"
              element={
                <ProtectedRoute>
                  <CharacterInventoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId/gm"
              element={
                <ProtectedRoute>
                  <GmDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId/carnet"
              element={
                <ProtectedRoute>
                  <DmNotebookPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId/npcs"
              element={
                <ProtectedRoute>
                  <NpcPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId/chronique"
              element={
                <ProtectedRoute>
                  <ChroniclePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId/messages"
              element={
                <ProtectedRoute>
                  <MessagesInboxPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/party/:partyId/combat"
              element={
                <ProtectedRoute>
                  <CombatPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/parties" replace />} />
          </Routes>
        </Suspense>
      </main>
      <CombatWidget />
      <ConcentrationWatcher />
      <MessageWatcher />
      <UpdateBanner />
      <PartyOpenTracker />
    </HeaderProvider>
  );
}
