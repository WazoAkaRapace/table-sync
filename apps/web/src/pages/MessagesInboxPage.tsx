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
import MessageThread from '../components/MessageThread';
import { EmptyState, ErrorMsg, LoadingSpinner } from '../components/ui';
import { useSyncEvent } from '../sync';
import { usePartyRole } from '../usePartyRole';
import { formatMessageTime, toRoman } from '../utils';

export default function MessagesInboxPage() {
  const { t } = useTranslation();
  const { partyId } = useParams<{ partyId: string }>();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [threadError, setThreadError] = useState('');

  const roleQuery = usePartyRole(partyId ? Number(partyId) : null);

  const threadsQuery = useQuery({
    queryKey: ['message-threads', Number(partyId)],
    enabled: !!partyId && roleQuery.data?.isGM === true,
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

  // Sur desktop, le premier fil VISIBLE (le plus frais — les cachés restent
  // en préparation repliée) s'ouvre d'emblée — la boîte commence à
  // travailler ; sur mobile, le registre reste la porte.
  useEffect(() => {
    if (selectedId !== null || !threadsQuery.data?.length) return;
    const first = threadsQuery.data.find((th) => !th.hidden);
    if (!first) return;
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSelectedId(first.characterId);
    }
  }, [threadsQuery.data, selectedId]);

  // Un échec d'envoi se dit puis se tait (la ligne d'erreur ne séjourne pas).
  useEffect(() => {
    if (!threadError) return;
    const timer = setTimeout(() => setThreadError(''), 6000);
    return () => clearTimeout(timer);
  }, [threadError]);

  // Personnages cachés : repliés par défaut — la préparation secrète ne
  // prend pas la place des volumes de la table.
  const [hiddenOpen, setHiddenOpen] = useState(false);

  if (roleQuery.isPending) return <LoadingSpinner label={t('app.chargement')} />;
  // Un échec de chargement n'est pas un « tu n'es pas le MD » : la connexion
  // se dit, le bouton retente — jamais de renvoi muet au groupe.
  if (roleQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-3">
        <ErrorMsg message={t('msgs.impossible.charger')} />
        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={() => roleQuery.refetch()}>
            {t('party.reessayer')}
          </button>
        </div>
      </div>
    );
  }
  if (roleQuery.data?.isGM !== true) return <Navigate to={`/party/${partyId}`} replace />;

  const threads = threadsQuery.data ?? [];
  const visibleThreads = threads.filter((th) => !th.hidden);
  const hiddenThreads = threads.filter((th) => th.hidden);
  const hiddenUnread = hiddenThreads.reduce((sum, th) => sum + th.unread, 0);
  const totalUnread = threads.reduce((sum, th) => sum + th.unread, 0);
  const selected = threads.find((th) => th.characterId === selectedId) ?? null;

  /** Ouvre un volume ; sur mobile le fil REMPLACE le registre — on repart
   *  de la tête du fil, pas du bas de la liste qu'on vient de parcourir. */
  const openThread = (id: number) => {
    setSelectedId(id);
    if (!window.matchMedia('(min-width: 1024px)').matches) window.scrollTo({ top: 0 });
  };

  /** Une entrée du registre ; `inHidden` omet la pastille « Caché » —
   *  le repli qui la porte l'a déjà dite. Les entrées se posent sous la
   *  règle comme au registre des groupes (register-rise, stagger plafonné) ;
   *  dépliés, les volumes cachés rejoignent la même phrase. */
  const renderEntry = (th: MessageThreadSummary, i: number, inHidden = false) => {
    const isOpen = th.characterId === selectedId;
    const courant = i === 0;
    const rank = inHidden ? i - visibleThreads.length : i;
    return (
      <li
        key={th.characterId}
        className="register-rise border-b border-parchment-200"
        style={{ animationDelay: `${Math.min(rank + 1, inHidden ? 3 : 5) * 60}ms` }}
      >
        <button
          type="button"
          onClick={() => openThread(th.characterId)}
          aria-current={isOpen ? 'true' : undefined}
          aria-label={t('msgs.vue.boite', { name: th.characterName })}
          className={`group -mx-3 flex w-[calc(100%+1.5rem)] items-start gap-4 rounded-lg px-3 transition-colors ${
            isOpen ? 'py-4 bg-parchment-100' : 'py-3.5 hover:bg-parchment-100/70'
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
              {th.hidden && !inHidden && (
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
  };

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
              maison), défilement interne quand la table s'agrandit.
              MOBILE : ouvrir un volume REMPLACE le registre (retour « ←
              Correspondance ») — sinon il fallait défiler toute la liste
              pour atteindre le fil. Desktop : deux volets, registre maintenu.
              Les personnages cachés (préparation secrète) se replient sous
              une ligne de conduite — ils ne prennent pas la place des volumes
              de la table, et une pastille signale ce qui y attend.
              px-3 (pas -mx-1/px-1) : la nappe -mx-3 des entrées déborde de
              12 px — dans un conteneur overflow-y-auto, l'axe X passe en
              auto et ce débordement faisait Barre de défilement horizontale ;
              le padding l'absorbe (scrollWidth == clientWidth). ---------- */}
          <ol
            className={`list-none ${
              selectedId !== null ? 'hidden lg:block ' : ''
            }lg:sticky lg:top-[calc(var(--app-header-h)+env(safe-area-inset-top)+0.75rem)] lg:z-20 lg:max-h-[calc(100vh-var(--app-header-h)-env(safe-area-inset-top)-2rem)] lg:self-start lg:overflow-y-auto lg:bg-parchment-50/95 lg:px-3 lg:py-1`}
            data-tuto="messages-boite"
          >
            {visibleThreads.map((th, i) => renderEntry(th, i))}
            {hiddenThreads.length > 0 && (
              <li
                className="register-rise border-b border-parchment-200"
                style={{ animationDelay: `${Math.min(visibleThreads.length + 1, 5) * 60}ms` }}
              >
                <button
                  type="button"
                  onClick={() => setHiddenOpen((o) => !o)}
                  aria-expanded={hiddenOpen}
                  className="group -mx-3 flex min-h-11 w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-parchment-100/70"
                >
                  {/* Chevron maison des replis (groupes d'inventaire) : ▼
                      pivoté fermé. La rotation vit sur une boîte ÉTROITE
                      qui épouse le glyph — sur la colonne w-10 entière, le
                      ▼ aligné à droite décrivait un quart de cercle au
                      lieu de pivoter sur place. */}
                  <span
                    aria-hidden="true"
                    className="w-10 shrink-0 text-right text-sm text-ink-400"
                  >
                    <span
                      className={`inline-block w-4 text-center chevron ${
                        hiddenOpen ? 'is-open' : 'is-closed'
                      }`}
                    >
                      ▼
                    </span>
                  </span>
                  <span className="text-sm font-medium text-ink-500">
                    {t(
                      hiddenThreads.length === 1
                        ? 'msgs.personnage.cache'
                        : 'msgs.personnages.caches',
                    )}{' '}
                    ({hiddenThreads.length})
                  </span>
                  {hiddenUnread > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blood-600 px-1 text-[10px] font-bold text-white">
                      {hiddenUnread > 9 ? '9+' : hiddenUnread}
                    </span>
                  )}
                  <span className="min-w-2 flex-1" aria-hidden="true" />
                </button>
              </li>
            )}
            {hiddenOpen &&
              hiddenThreads.map((th, idx) => renderEntry(th, visibleThreads.length + idx, true))}
          </ol>

          {/* ---------- Le fil ouvert ---------- */}
          <div className="mt-6 lg:mt-0">
            {selected ? (
              <div className="space-y-3">
                {/* Retour réglé mobile — desktop garde le registre épinglé */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    if (!window.matchMedia('(min-width: 1024px)').matches) {
                      window.scrollTo({ top: 0 });
                    }
                  }}
                  className="btn-ghost text-sm text-ink-500 lg:hidden"
                >
                  ← {t('nav.correspondance')}
                </button>
                {threadError && <ErrorMsg message={threadError} />}
                {/* Le geste qui travaille — le registre est l'échelle, le fil
                    est la scène : changer de volume fait entrer la scène par
                    stage-swap (le même verbe que le théâtre du tour, clé sur
                    le volume ouvert — un seul moment par ouverture). */}
                <div key={selected.characterId} className="stage-swap">
                  <MessageThread
                    charId={selected.characterId}
                    characterName={selected.characterName}
                    ownerName={selected.ownerName}
                    canModerate
                    onError={setThreadError}
                  />
                </div>
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
