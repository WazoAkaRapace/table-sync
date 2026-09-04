/**
 * Fil de correspondance secrète — le composant partagé des deux maisons :
 * l'onglet « Messages » de la fiche joueur et le volet de fil de la boîte MD.
 *
 * Registre du monde : pas de bulles de chat — les entrées se posent sur le
 * parchemin, séparées par des filets. Le MD parle avec son tampon (le même
 * dispositif que le roster), le personnage répond à l'encre sous son nom.
 * Le non-lu porte un point sang ; « Vu » (read_at du destinataire) coche les
 * messages de l'appelant. Le fil est un journal : rien ne s'édite — et seul
 * le MD peut rayer une ligne (la sienne comme celle du joueur), confirmée
 * au point de tap.
 */

import type { SecretMessage } from '@table-sync/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import { useAuth } from '../auth';
import { useSyncEvent } from '../sync';
import { formatMessageTime } from '../utils';
import { ConfirmButton, EmptyState, ErrorMsg, LoadingSpinner } from './ui';

const MAX_LENGTH = 2000;

interface Props {
  charId: number;
  characterName: string;
  /** Nom du joueur — affiché dans l'en-tête du volet MD. */
  ownerName?: string;
  /** Vue MD : chaque ligne porte sa suppression (confirmée sur place). */
  canModerate?: boolean;
  onError: (msg: string) => void;
}

export function useCharacterMessagesQueryKey(charId: number) {
  return ['character-messages', charId] as const;
}

/** Tampon du MD — le même dispositif que la table des matières du roster. */
function GmStamp() {
  return (
    <span className="rounded bg-blood-600 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-white">
      MD
    </span>
  );
}

export default function MessageThread({
  charId,
  characterName,
  ownerName,
  canModerate = false,
  onError,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = useCharacterMessagesQueryKey(charId);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get<{ messages: SecretMessage[]; unread: number }>(
        `/api/characters/${charId}/messages`,
      );
      return res.data;
    },
  });

  // Arrivée en direct : la livraison est ciblée (targetUserId) — l'événement
  // ne nous arrive que si c'est notre fil. Le marquage « lu » de l'autre camp
  // ('read') rafraîchit aussi (les « Vu » bougent).
  useSyncEvent(
    (event) => {
      if (event.type === 'message:new' && event.characterId === charId) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
    [charId],
  );

  const messages = query.data?.messages ?? [];
  const isGMView = ownerName !== undefined;

  // ---------- Read marking: this thread IS on screen, incoming side is read ----------
  const [markedUnread, setMarkedUnread] = useState(0);
  useEffect(() => {
    const unread = query.data?.unread ?? 0;
    if (unread === 0) {
      setMarkedUnread(0);
      return;
    }
    if (markedUnread === unread) return; // already marked this batch
    let cancelled = false;
    api
      .post(`/api/characters/${charId}/messages/read`)
      .then(() => {
        if (cancelled) return;
        setMarkedUnread(unread);
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: ['messages-unread'] });
        // Le registre de la boîte MD doit aussi retomber : l'événement WS
        // « lu » part à l'AUTRE camp — le lecteur n'a que cette invalidation
        // locale pour voir sa propre pastille s'éteindre.
        queryClient.invalidateQueries({ queryKey: ['message-threads'] });
        // Une bannière d'arrivée pour CE fil n'a plus de raison d'être
        window.dispatchEvent(new CustomEvent('table-sync:message-read', { detail: { charId } }));
      })
      .catch(() => {
        /* le non-lus restera — la prochaine ouverture retentera */
      });
    return () => {
      cancelled = true;
    };
  }, [query.data?.unread, charId, markedUnread, queryClient, queryKey]);

  // ---------- Composer ----------
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const justSent = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grandissement du composeur, plafonné (une main, clavier mobile) —
  // au geste (onChange) et au vidage programmatique après l'envoi.
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.post(`/api/characters/${charId}/messages`, { body: text });
      setDraft('');
      autoGrow();
      justSent.current = true;
      await queryClient.invalidateQueries({ queryKey });
      // L'envoi rafraîchit aussi le registre (aperçu + ordre) : l'écho WS ne
      // revient jamais à l'expéditeur.
      await queryClient.invalidateQueries({ queryKey: ['message-threads'] });
      await queryClient.invalidateQueries({ queryKey: ['messages-unread'] });
    } catch (err: any) {
      // Le brouillon reste en zone de saisie — jamais de perte silencieuse
      const tooLong = err?.response?.status === 400;
      onError(tooLong ? t('msgs.message.trop.long') : t('msgs.envoi.impossible'));
    } finally {
      setSending(false);
    }
  }, [draft, sending, charId, queryClient, queryKey, onError, t, autoGrow]);

  // Rature MD : la ligne disparaît des deux côtés (l'événement 'delete'
  // rafraîchit la vue ouverte de l'autre camp ; les compteurs dérivés
  // retombent seuls).
  const remove = useCallback(
    async (messageId: number) => {
      try {
        await api.delete(`/api/character-messages/${messageId}`);
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.invalidateQueries({ queryKey: ['message-threads'] });
        await queryClient.invalidateQueries({ queryKey: ['messages-unread'] });
      } catch {
        onError(t('msgs.suppression.impossible'));
      }
    },
    [queryClient, queryKey, onError, t],
  );

  // ---------- Auto-scroll : le plus récent vit en bas ----------
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const prevCount = useRef(0);
  useEffect(() => {
    if (messages.length === 0) return;
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      prevCount.current = messages.length;
      bottomRef.current?.scrollIntoView({ block: 'end' });
      return;
    }
    const grew = messages.length > prevCount.current;
    prevCount.current = messages.length;
    if (!grew) return;
    // Un lecteur remonté dans l'historique ne doit pas être rappelé au bas ;
    // ses propres envois, eux, y retombent toujours.
    const nearBottom =
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 200;
    if (justSent.current || nearBottom) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'end' });
    }
    justSent.current = false;
  }, [messages]);

  if (query.isPending) return <LoadingSpinner label={t('msgs.chargement')} />;
  if (query.error)
    return <ErrorMsg message={t('msgs.impossible.charger')} onRetry={() => void query.refetch()} />;

  const placeholder = isGMView
    ? t('msgs.ecrire.au.joueur', { name: characterName })
    : t('msgs.ecrire.au.md');

  return (
    <div className="card p-4 sm:p-5" data-tuto="messages-fil">
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h2 className="section-title">
          {isGMView ? t('msgs.avec.name', { name: characterName }) : t('msgs.avec.le.md')}
        </h2>
        {isGMView && <span className="shrink-0 text-xs text-ink-400 truncate">@{ownerName}</span>}
      </div>

      {messages.length === 0 ? (
        <EmptyState
          icon="✉️"
          title={isGMView ? t('msgs.aucun.message.md') : t('msgs.aucun.message')}
          hint={isGMView ? t('msgs.aide.vide.md') : t('msgs.aide.vide')}
        />
      ) : (
        <ol className="list-none">
          {messages.map((m) => {
            const mine = user !== null && m.senderUserId === user.id;
            const unread = !m.readAt && !mine;
            return (
              <li key={m.id} className="border-b border-parchment-200 py-3 last:border-b-0">
                <div className="flex items-center gap-2">
                  {m.fromGM ? (
                    <GmStamp />
                  ) : (
                    <span className="text-[10px] font-bold tracking-wide text-ink-500 uppercase">
                      {characterName}
                    </span>
                  )}
                  {unread && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-blood-600"
                      title={t('msgs.non.lu')}
                      aria-label={t('msgs.non.lu')}
                      role="img"
                    />
                  )}
                  <span className="min-w-2 flex-1" aria-hidden="true" />
                  <time className="font-mono text-[10px] text-ink-400">
                    {formatMessageTime(m.createdAt)}
                  </time>
                  {canModerate && (
                    <ConfirmButton
                      onConfirm={() => void remove(m.id)}
                      className="text-ink-400 hover:text-red-500 text-sm p-1 rounded-full transition-colors"
                      armedClassName="bg-red-600 hover:bg-red-700 text-white! px-2.5 py-1 font-semibold"
                      title={t('msgs.supprimer.message')}
                      ariaLabel={t('msgs.supprimer.message')}
                      confirmChildren={t('msgs.supprimer')}
                    >
                      ×
                    </ConfirmButton>
                  )}
                </div>
                <p
                  className={`mt-1.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    unread ? 'font-medium text-ink-900' : 'text-ink-800'
                  }`}
                >
                  {m.body}
                </p>
                {mine && m.readAt && (
                  <p className="mt-1 text-[10px] text-ink-400">{t('msgs.vu')} ✓</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div ref={bottomRef} aria-hidden="true" />

      {/* Composeur — épinglé sous le fil ; Entrée envoie (Maj+Entrée = saut de
          ligne), le bouton reste la voie principale sur mobile */}
      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            // Entrée envoie AU CLAVIER PHYSIQUE seulement : un clavier
            // virtuel n'a pas de Maj — Entrée doit y rester un saut de ligne.
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input min-h-[44px] flex-1 resize-none py-2.5 leading-6"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="btn-primary h-11 shrink-0 px-4 disabled:opacity-50"
        >
          {sending ? '…' : t('msgs.envoyer')}
        </button>
      </form>
    </div>
  );
}
