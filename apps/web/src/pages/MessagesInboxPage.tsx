/**
 * Boîte de réception MD — la quatrième page réglée : le registre énumère les
 * volumes (un fil par personnage), la plus fraîche correspondance tient
 * l'ordinal sang. Desktop ≥lg : deux volets (registre à gauche, fil ouvert à
 * droite) ; mobile : le registre empile, une entrée ouvre le fil, retour
 * réglé au-dessus.
 */

import type { MessageThreadSummary } from '@table-sync/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import MessageThread from '../components/MessageThread';
import { EmptyState, ErrorMsg, LoadingSpinner } from '../components/ui';
import { useSyncEvent } from '../sync';
import { formatMessageTime, toRoman } from '../utils';

export default function MessagesInboxPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { partyId } = useParams<{ partyId: string }>();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [threadError, setThreadError] = useState('');

  const roleQuery = useQuery({
    queryKey: ['party-role', Number(partyId), user?.id ?? null],
    enabled: !!partyId && !!user,
    queryFn: async () => {
      const res = await api.get<{ members: { userId: number; role: string }[] }>(
        `/api/parties/${partyId}`,
      );
      return res.data.members.some((m) => m.userId === user?.id && m.role === 'gm');
    },
  });

  const threadsQuery = useQuery({
    queryKey: ['message-threads', Number(partyId)],
    enabled: !!partyId && !!user && roleQuery.data === true,
    queryFn: async () => {
      const res = await api.get<{ threads: MessageThreadSummary[] }>(
        `/api/parties/${partyId}/message-threads`,
      );
      return res.data.threads;
    },
  });

  // Livraison ciblée : la boîte n'entend que les événements qui la visent,
  // n'importe quel fil du groupe.
  useSyncEvent(
    (event) => {
      if (event.type === 'message:new' && event.partyId === Number(partyId)) {
        queryClient.invalidateQueries({ queryKey: ['message-threads', Number(partyId)] });
      }
    },
    [partyId],
  );

  // Sur desktop, le premier fil (le plus frais) s'ouvre d'emblée — la boîte
  // commence à travailler ; sur mobile, le registre reste la porte.
  useEffect(() => {
    if (selectedId !== null || !threadsQuery.data?.length) return;
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSelectedId(threadsQuery.data[0].characterId);
    }
  }, [threadsQuery.data, selectedId]);

  // Un échec d'envoi se dit puis se tait (la ligne d'erreur ne séjourne pas).
  useEffect(() => {
    if (!threadError) return;
    const timer = setTimeout(() => setThreadError(''), 6000);
    return () => clearTimeout(timer);
  }, [threadError]);

  if (roleQuery.isPending) return <LoadingSpinner label={t('app.chargement')} />;
  if (roleQuery.data !== true) return <Navigate to={`/party/${partyId}`} replace />;

  const threads = threadsQuery.data ?? [];
  const totalUnread = threads.reduce((sum, th) => sum + th.unread, 0);
  const selected = threads.find((th) => th.characterId === selectedId) ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="register-rise pb-6 pt-2 text-center">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{t('nav.correspondance')}</h1>
        <p className="mt-1.5 text-sm text-ink-400">
          {t('msgs.boite.meta', { n: threads.length, m: totalUnread })}
        </p>
      </header>

      {/* Ledger double head rule */}
      <div aria-hidden="true">
        <div className="border-t-2 border-parchment-400" />
        <div className="mt-[3px] border-t border-parchment-300" />
      </div>

      {threadsQuery.isPending ? (
        <p className="py-8 text-center text-sm text-ink-400 animate-pulse">
          {t('msgs.chargement')}
        </p>
      ) : threads.length === 0 ? (
        <div className="card mx-auto mt-6 max-w-md p-8">
          <EmptyState icon="✉️" title={t('msgs.correspondance')} hint={t('msgs.aucun.message.md')} />
        </div>
      ) : (
        // Deux volets — sur desktop ils descendent SOUS la double règle :
        // une carte levée ne se pose jamais à ras d'un filet réglé.
        <div className="lg:grid lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)] lg:gap-8 lg:pt-6">
          {/* ---------- Le registre des fils — épinglé SOUS l'en-tête (formule
              maison), défilement interne quand la table s'agrandit ---------- */}
          <ol
            className="list-none lg:sticky lg:top-[calc(var(--app-header-h)+env(safe-area-inset-top)+0.75rem)] lg:z-20 lg:-mx-1 lg:max-h-[calc(100vh-var(--app-header-h)-env(safe-area-inset-top)-2rem)] lg:self-start lg:overflow-y-auto lg:bg-parchment-50/95 lg:px-1 lg:py-1"
            data-tuto="messages-boite"
          >
            {threads.map((th, i) => {
              const isOpen = th.characterId === selectedId;
              const courant = i === 0;
              return (
                <li key={th.characterId} className="border-b border-parchment-200">
                  <button
                    type="button"
                    onClick={() => setSelectedId(th.characterId)}
                    aria-current={isOpen ? 'true' : undefined}
                    aria-label={t('msgs.vue.boite', { name: th.characterName })}
                    className={`group -mx-3 flex w-[calc(100%+1.5rem)] items-start gap-4 rounded-lg px-3 ${
                      isOpen
                        ? 'py-4 bg-parchment-100'
                        : 'py-3.5 transition-colors hover:bg-parchment-100/70'
                    } text-left`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-10 shrink-0 text-right font-display ${
                        courant ? 'pt-0.5 text-lg text-blood-500' : 'pt-0.5 text-lg text-ink-400'
                      }`}
                    >
                      {toRoman(i + 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline justify-between gap-2">
                        <span
                          className={`truncate font-display text-lg leading-snug ${
                            th.unread > 0 ? 'font-bold text-ink-900' : 'font-semibold text-ink-700'
                          }`}
                        >
                          {th.characterName}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {th.unread > 0 && (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blood-600 px-1 text-[10px] font-bold text-white">
                              {th.unread > 9 ? '9+' : th.unread}
                            </span>
                          )}
                          {th.lastMessage && (
                            <time className="font-mono text-[10px] text-ink-400">
                              {formatMessageTime(th.lastMessage.createdAt)}
                            </time>
                          )}
                        </span>
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                        {th.hidden && (
                          <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                            {t('party.cache')}
                          </span>
                        )}
                        <span className="truncate text-sm text-ink-400">
                          {th.lastMessage
                            ? `${th.lastMessage.fromGM ? 'MD' : th.characterName} : ${th.lastMessage.body}`
                            : `@${th.ownerName} — ${t('msgs.aucun.message.md')}`}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* ---------- Le fil ouvert ---------- */}
          <div className="mt-6 lg:mt-0">
            {selected ? (
              <div className="space-y-3">
                {/* Retour réglé mobile — desktop garde le registre épinglé */}
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="btn-ghost text-sm text-ink-500 lg:hidden"
                >
                  ← {t('nav.correspondance')}
                </button>
                {threadError && <ErrorMsg message={threadError} />}
                <MessageThread
                  key={selected.characterId}
                  charId={selected.characterId}
                  characterName={selected.characterName}
                  ownerName={selected.ownerName}
                  canModerate
                  onError={setThreadError}
                />
              </div>
            ) : (
              <p className="hidden pt-8 text-center text-sm text-ink-400 lg:block">
                {t('msgs.boite.choisir')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
