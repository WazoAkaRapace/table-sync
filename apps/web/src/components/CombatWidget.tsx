/**
 * Player combat strip, docked in the app header's right side (lg+).
 *
 * Persistent by design: the header is sticky, so the encounter, the current
 * actor, my initiative, the initiative input and "end my turn" stay visible
 * while the player scrolls and navigates their sheet — the old left-edge
 * drawer floated over the very content it was supposed to watch over.
 *
 * Only renders — and only loads — on the player's own character sheet,
 * scoped to that sheet's party (a player doesn't fight in two groups at
 * once). Below lg the in-page docked combat card owns this job; the GM uses
 * the full CombatPage route.
 */

import type { Combatant, EncounterDetail } from '@table-sync/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { invalidateCombat, useActiveEncounters } from '../combatLive';
import { useSyncEvent } from '../sync';
import TurnSlash, { combatVibrate, useTurnSlash } from './TurnSlash';

interface ActiveCombat {
  encounter: EncounterDetail;
  partyId: number;
  myCombatant: Combatant;
  currentCombatant: Combatant | null;
}

function rollD20(bonus: number): number {
  return Math.floor(Math.random() * 20) + 1 + bonus;
}

export default function CombatWidget() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  // The strip mounts inside the app header's right cluster (#header-combat-slot,
  // rendered by Nav, hidden below lg). Portal keeps the live widget state
  // flowing into it — the header never knows about combat.
  // The mount point only exists once the session has resolved (Nav renders
  // null while user is null), so probe after every render until it appears;
  // the setHeaderSlot(null) misses are React bail-out no-ops.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.getElementById('header-combat-slot');
    if (el) setHeaderSlot(el);
  });
  const [initInput, setInitInput] = useState('');
  const [initError, setInitError] = useState(false);

  // Only show on a character sheet route
  const charMatch = location.pathname.match(/^\/party\/(\d+)\/character\/(\d+)/);
  const isCharacterSheet = !!charMatch;
  const partyId = charMatch ? Number(charMatch[1]) : null;
  const charId = charMatch ? Number(charMatch[2]) : null;

  // Ownership probe: the widget may only render — and only load — on the
  // player's OWN sheet. On anyone else's (or off-sheet) it stays silent.
  const [isMyCharacter, setIsMyCharacter] = useState(false);
  useEffect(() => {
    if (!user || !charId) {
      setIsMyCharacter(false);
      return;
    }
    api
      .get(`/api/characters/${charId}`)
      .then((res) => setIsMyCharacter(res.data.character?.ownerId === user.id))
      .catch(() => setIsMyCharacter(false));
  }, [user, charId]);

  const canLoad = !!user && isCharacterSheet && isMyCharacter;

  // Cache PARTAGÉ avec la fiche (hub mobile) : useActiveEncounters déduplique
  // les cascades liste+détails (un combat:change = UNE cascade pour tout le
  // navigateur, staleTime 5 s contre les rafales) et la reconnexion WS
  // réinvalide TOUT (SyncProvider) — le resync dédié d'avant est couvert.
  const encountersQuery = useActiveEncounters(partyId, canLoad);
  const combats: ActiveCombat[] = useMemo(() => {
    if (!encountersQuery.data || !charId) return [];
    // The widget tracks THIS sheet's character (same rule as the
    // mobile combat card), not every character the user owns.
    return encountersQuery.data
      .map((encounter): ActiveCombat | null => {
        const myCombatant = encounter.combatants.find((c) => c.characterId === charId) ?? null;
        if (!myCombatant) return null;
        return {
          encounter,
          partyId: Number(partyId),
          myCombatant,
          currentCombatant: encounter.combatants[encounter.turnIndex] ?? null,
        };
      })
      .filter((c): c is ActiveCombat => c !== null);
  }, [encountersQuery.data, charId, partyId]);

  // Filet de sécurité 30 s — le temps réel vient des événements WS. Ne tourne
  // QUE visible + large écran (le bandeau vit dans un slot hidden lg:flex :
  // sur mobile il est invisible, la carte dockée de la fiche a la main, et
  // un onglet en arrière-plan n'a personne à prévenir).
  useEffect(() => {
    if (!canLoad) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!window.matchMedia('(min-width: 1024px)').matches) return;
      void encountersQuery.refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [canLoad, encountersQuery]);

  useSyncEvent(
    (event) => {
      if (event.type === 'combat:change' && event.partyId === partyId && canLoad) {
        invalidateCombat(queryClient, partyId);
      }
    },
    [canLoad, partyId, queryClient],
  );

  const setInitiative = async (
    encounterId: number,
    combatantId: number,
    value: number,
  ): Promise<boolean> => {
    try {
      await api.patch(`/api/encounters/${encounterId}/combatants/${combatantId}/initiative`, {
        initiative: value,
      });
      setInitError(false);
      invalidateCombat(queryClient, partyId);
      return true;
    } catch {
      // The player must know the roll didn't save — otherwise they wait for a
      // turn that never comes.
      setInitError(true);
      return false;
    }
  };

  // "J'ai fini mon tour" — closes the player's own turn from the drawer; the
  // server re-checks that the caller's combatant holds the current turn.
  const [endingTurn, setEndingTurn] = useState(false);
  const endMyTurn = async (encounterId: number) => {
    setEndingTurn(true);
    try {
      await api.post(`/api/encounters/${encounterId}/end-my-turn`);
      // combat:change is echo-exempt (GM tab + player tab), so our own sync
      // listener reloads; the invalidation below covers the event losing the race
      // (e.g. a 403 because the MD advanced the same turn a beat earlier).
      await invalidateCombat(queryClient, partyId);
    } catch {
      await invalidateCombat(queryClient, partyId);
    } finally {
      setEndingTurn(false);
    }
  };

  // Priority: my turn > needs initiative > active combat
  // Nobody's turn is active while the encounter is still in setup.
  const myTurn = combats.find(
    (c) => c.encounter.status === 'active' && c.currentCombatant?.id === c.myCombatant.id,
  );
  const isMyTurn = !!myTurn;

  // Haptic cue the moment initiative is requested (phone in pocket)
  const needsInitAnywhere = combats.some((c) => c.myCombatant.initiative === null);
  const prevNeedsInit = useRef(false);
  useEffect(() => {
    const rising = needsInitAnywhere && !prevNeedsInit.current;
    prevNeedsInit.current = needsInitAnywhere;
    if (rising) combatVibrate([80, 40, 80]);
  }, [needsInitAnywhere]);

  // Sword-cut on the any-state → "your turn" transition (shared hook)
  const slashActive = useTurnSlash(isMyTurn);

  if (!user || !isCharacterSheet || !isMyCharacter || combats.length === 0) return null;
  if (!headerSlot) return null;

  const needsInit = combats.find((c) => c.myCombatant.initiative === null);
  const combat = myTurn ?? needsInit ?? combats[0];
  const needsInitiative = combat.myCombatant.initiative === null;

  // One quiet instrument on the dark ink header: encounter (→ tracker) on the
  // left, live turn status, then the state's single action. Blood = your turn
  // (glow + sword-cut, same signature as the dock), gold = initiative owed.
  const statusText = needsInitiative
    ? t('widget.lance.ton.initiative')
    : isMyTurn
      ? t('widget.a.toi.de.jouer.title')
      : combat.currentCombatant
        ? t('widget.header.tour', {
            name: combat.currentCombatant.name,
            round: combat.encounter.round,
          })
        : combat.encounter.status === 'active'
          ? t('widget.tour.round', { round: combat.encounter.round })
          : t('widget.preparation');

  const submitInitiative = async () => {
    const v = parseInt(initInput, 10);
    if (Number.isNaN(v)) return;
    const ok = await setInitiative(combat.encounter.id, combat.myCombatant.id, v);
    if (ok) setInitInput('');
  };

  return createPortal(
    <div
      className={`combat-strip relative flex items-center gap-2 h-10 max-w-full pl-2.5 pr-1.5 rounded-lg border shadow-sm ${
        isMyTurn
          ? 'border-blood-500 bg-blood-900/40 combat-turn-glow'
          : needsInitiative
            ? 'border-yellow-500 bg-ink-800'
            : 'border-ink-600 bg-ink-800'
      }`}
    >
      <TurnSlash active={slashActive} />

      {/* Encounter — the door to the tracker (deep link opens it directly) */}
      <Link
        to={`/party/${combat.partyId}/combat?enc=${combat.encounter.id}`}
        title={t('widget.voir.le.combat')}
        className="group flex items-center gap-1.5 min-w-0 shrink"
      >
        <span className="text-base leading-none shrink-0" aria-hidden="true">
          ⚔
        </span>
        <span
          className="text-xs font-semibold text-parchment-100 truncate max-w-40 group-hover:text-parchment-50 transition-colors"
          title={combat.encounter.name}
        >
          {combat.encounter.name}
        </span>
      </Link>
      <span className="w-px h-5 bg-parchment-50/20 shrink-0" aria-hidden="true" />

      {/* Turn status — the live region (transitions announce themselves);
          controls stay OUTSIDE it so typing never re-announces */}
      <div role="status" aria-live="polite" className="flex items-center gap-2 min-w-0">
        <span
          className={`text-xs whitespace-nowrap truncate ${
            isMyTurn
              ? 'font-bold text-parchment-50'
              : needsInitiative
                ? 'font-bold text-yellow-300'
                : 'text-parchment-200'
          }`}
        >
          {statusText}
        </span>
        {combat.myCombatant.initiative !== null && (
          <span
            className="font-mono text-[11px] text-parchment-300 bg-ink-900/60 border border-ink-600 rounded px-1.5 py-0.5 shrink-0"
            title={t('widget.mon.initiative')}
          >
            init {combat.myCombatant.initiative}
          </span>
        )}
      </div>

      {/* Initiative entry — deployed for as long as the roll is owed */}
      {needsInitiative && (
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            min={1}
            max={40}
            value={initInput}
            onChange={(e) => {
              setInitInput(e.target.value);
              if (initError) setInitError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitInitiative();
            }}
            placeholder="—"
            aria-label={t('widget.mon.initiative')}
            autoFocus
            className="input input-compact"
          />
          <button type="button" onClick={() => void submitInitiative()} className="btn-primary">
            OK
          </button>
          <button
            type="button"
            onClick={() =>
              setInitiative(
                combat.encounter.id,
                combat.myCombatant.id,
                rollD20(combat.myCombatant.initiativeBonus),
              )
            }
            className="btn-secondary"
            title={t('widget.lancer.d20.dex')}
          >
            🎲
          </button>
          {initError && (
            <span
              className="text-sm leading-none text-red-400"
              title={t('widget.echec.de.l.enregistrement.reessaie')}
            >
              <span aria-hidden="true">⚠</span>
              <span className="sr-only" role="alert">
                {t('widget.echec.de.l.enregistrement.reessaie')}
              </span>
            </span>
          )}
        </div>
      )}

      {/* "J'ai fini mon tour" — closes the player's own turn from the strip;
          the server re-checks that the caller's combatant holds the turn */}
      {isMyTurn && (
        <button
          type="button"
          onClick={() => endMyTurn(combat.encounter.id)}
          disabled={endingTurn}
          className="btn-primary whitespace-nowrap shrink-0"
          aria-label={t('widget.terminer.mon.tour.passer.au.combattant')}
        >
          {t('widget.j.ai.fini.mon.tour')}
        </button>
      )}
    </div>,
    headerSlot,
  );
}
