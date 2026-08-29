/**
 * Floating combat widget for players.
 *
 * Appears bottom-left (minimized by default) when a combat is active or
 * in setup in one of the user's parties. Shows whose turn it is, and if
 * the player hasn't rolled initiative yet, provides an input.
 *
 * Only renders on the player's own character sheet page.
 * The GM uses the full CombatPage route.
 */

import type { Combatant, EncounterDetail } from '@table-sync/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { useSyncEvent } from '../sync';
import TurnSlash, { combatVibrate, useTurnSlash } from './TurnSlash';

interface ActiveCombat {
  encounter: EncounterDetail;
  partyId: number;
  partyName: string;
  myCombatant: Combatant | null;
  currentCombatant: Combatant | null;
}

function rollD20(bonus: number): number {
  return Math.floor(Math.random() * 20) + 1 + bonus;
}

export default function CombatWidget() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const [combats, setCombats] = useState<ActiveCombat[]>([]);
  const [collapsed, setCollapsed] = useState(true); // minimized by default
  const [initInput, setInitInput] = useState('');
  const [initError, setInitError] = useState(false);
  const loadSeq = useRef(0);

  // Only show on a character sheet route
  const charMatch = location.pathname.match(/^\/party\/(\d+)\/character\/(\d+)/);
  const isCharacterSheet = !!charMatch;
  const charId = charMatch ? Number(charMatch[2]) : null;

  const loadCombats = useCallback(async () => {
    if (!user) return;
    // Race guard: rapid sync events + the 30s poll can overlap; only the
    // latest run may commit its result, otherwise a stale (pre-add) response
    // could overwrite a fresh one and hide the widget.
    const seq = ++loadSeq.current;
    try {
      // Fetch all parties the user belongs to
      const partiesRes = await api.get('/api/parties');
      const parties = partiesRes.data.parties || [];
      const activeCombats: ActiveCombat[] = [];

      await Promise.all(
        parties.map(async (p: any) => {
          try {
            const encRes = await api.get(`/api/parties/${p.id}/encounters`);
            const encounters = encRes.data.encounters || [];
            // Find active encounters AND setup encounters (where initiative may be pending)
            const relevant = encounters.filter(
              (e: any) => e.status === 'active' || e.status === 'setup',
            );
            for (const encSummary of relevant) {
              const detailRes = await api.get(`/api/encounters/${encSummary.id}`);
              const encounter: EncounterDetail = detailRes.data.encounter;
              const currentCombatant = encounter.combatants[encounter.turnIndex] ?? null;
              activeCombats.push({
                encounter,
                partyId: p.id,
                partyName: p.name,
                myCombatant: null, // resolved below
                currentCombatant,
              });
            }
          } catch {
            // skip (e.g., 403 if not in the encounter)
          }
        }),
      );

      // For each combat, find the player's combatant (matching by party characters).
      // Filter out combats where the player has no combatant (not in the fight).
      for (const combat of activeCombats) {
        try {
          const partyRes = await api.get(`/api/parties/${combat.partyId}`);
          const myCharIds = (partyRes.data.characters || [])
            .filter((c: any) => c.ownerId === user.id)
            .map((c: any) => c.id);
          combat.myCombatant =
            combat.encounter.combatants.find(
              (c) => c.characterId !== null && myCharIds.includes(c.characterId),
            ) ?? null;
        } catch {
          // skip
        }
      }
      // Only keep combats where the player is actually a combatant
      const myCombats = activeCombats.filter((c) => c.myCombatant !== null);

      if (seq === loadSeq.current) setCombats(myCombats);
    } catch {
      if (seq === loadSeq.current) setCombats([]);
    }
  }, [user]);

  useEffect(() => {
    loadCombats();
    // Refresh every 30s as a fallback (sync events handle real-time)
    const interval = setInterval(loadCombats, 30000);
    return () => clearInterval(interval);
  }, [loadCombats]);

  useSyncEvent((event) => {
    if (event.type === 'combat:change') {
      loadCombats();
    }
  }, []);

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
      loadCombats();
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
      // listener reloads; loadCombats() again covers the event losing the race
      // (e.g. a 403 because the MD advanced the same turn a beat earlier).
      await loadCombats();
    } catch {
      await loadCombats();
    } finally {
      setEndingTurn(false);
    }
  };

  // Only show on the player's OWN character sheet
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

  // Priority: my turn > needs initiative > active combat
  // Nobody's turn is active while the encounter is still in setup.
  const myTurn = combats.find(
    (c) =>
      c.encounter.status === 'active' &&
      c.myCombatant &&
      c.currentCombatant?.id === c.myCombatant.id,
  );
  const isMyTurn = !!myTurn;

  // Haptic cue the moment initiative is requested (phone in pocket)
  const needsInitAnywhere = combats.some((c) => c.myCombatant?.initiative === null);
  const prevNeedsInit = useRef(false);
  useEffect(() => {
    const rising = needsInitAnywhere && !prevNeedsInit.current;
    prevNeedsInit.current = needsInitAnywhere;
    if (rising) combatVibrate([80, 40, 80]);
  }, [needsInitAnywhere]);

  // Sword-cut on the any-state → "your turn" transition (shared hook)
  const slashActive = useTurnSlash(isMyTurn);

  if (!user || !isCharacterSheet || !isMyCharacter || combats.length === 0) return null;

  const needsInit = combats.find((c) => c.myCombatant?.initiative === null);
  const combat = myTurn ?? needsInit ?? combats[0];
  const needsInitiative = combat.myCombatant?.initiative === null;
  const isSetup = combat.encounter.status === 'setup';

  if (collapsed) {
    // Vertical tab attached to the left edge of the screen, mid-height.
    // On your turn the static glow gives way to the pulsing combat-turn-glow.
    const glowColor = isMyTurn
      ? 'combat-turn-glow'
      : needsInitiative
        ? 'shadow-[0_0_0_3px_rgba(202,138,4,0.4),0_0_20px_rgba(202,138,4,0.6)]'
        : 'shadow-lg';
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className={`hidden lg:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 w-10 h-16 rounded-r-xl rounded-l-none shadow-lg items-center justify-center text-xl leading-none transition-all active:scale-95 border-2 border-l-0 border-parchment-50 ${
          isMyTurn
            ? 'bg-blood-600 hover:bg-blood-700 text-parchment-50'
            : needsInitiative
              ? 'bg-yellow-500 hover:bg-yellow-600 text-ink-900'
              : 'bg-ink-900 hover:bg-ink-800 text-parchment-50'
        } ${glowColor}`}
        title={
          isMyTurn
            ? t('widget.a.toi.de.jouer.title')
            : needsInitiative
              ? t('widget.saisis.ton.initiative')
              : t('widget.combat.en.cours')
        }
      >
        ⚔
        <TurnSlash active={slashActive} />
      </button>
    );
  }

  return (
    // Outer wrapper centers the drawer vertically; the inner card slides
    // out from the left edge on mount (drawer-enter animates the inner
    // element only, so the centering translate is never fought over).
    <div className="hidden lg:block fixed left-0 top-1/2 -translate-y-1/2 z-40">
      <div
        className={`relative w-72 max-h-[80vh] overflow-y-auto rounded-r-2xl rounded-l-none shadow-xl border-2 border-l-0 bg-white drawer-enter ${
          isMyTurn
            ? 'border-blood-500 combat-turn-glow'
            : needsInitiative
              ? 'border-yellow-500'
              : 'border-ink-300'
        }`}
      >
        <TurnSlash active={slashActive} />
        <div className="flex items-center justify-between p-3 border-b border-parchment-200">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚔</span>
            <div>
              <div className="text-xs font-semibold text-ink-700">{combat.partyName}</div>
              <div className="text-xs text-ink-400">
                {isSetup
                  ? t('widget.preparation')
                  : t('widget.tour.round', { round: combat.encounter.round })}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-ink-400 hover:text-ink-700 text-sm"
            title={t('widget.reduire')}
          >
            ◀
          </button>
        </div>

        <div className="p-3 space-y-2">
          {/* Initiative request banner */}
          {needsInitiative && (
            <div className="text-center py-2 px-3 rounded-lg bg-yellow-400 text-ink-900 font-bold">
              {t('widget.lance.ton.initiative')}
            </div>
          )}

          {/* My turn banner + the action that closes it */}
          {isMyTurn && (
            <>
              <div className="text-center py-2 px-3 rounded-lg bg-blood-600 text-parchment-50 font-bold">
                {t('widget.a.toi.de.jouer')}
              </div>
              <button
                type="button"
                onClick={() => endMyTurn(combat.encounter.id)}
                disabled={endingTurn}
                className="btn-primary w-full min-h-[44px] text-sm"
                aria-label={t('widget.terminer.mon.tour.passer.au.combattant')}
              >
                {t('widget.j.ai.fini.mon.tour')}
              </button>
            </>
          )}

          {/* Current actor (only during active combat) */}
          {combat.currentCombatant && !isMyTurn && !needsInitiative && (
            <div className="text-sm text-ink-600">
              {t('widget.au.tour.de')}
              <strong>{combat.currentCombatant.name}</strong>
              <span className="text-ink-400 ml-1">
                (init {combat.currentCombatant.initiative ?? '—'})
              </span>
            </div>
          )}

          {/* Initiative entry */}
          {needsInitiative && combat.myCombatant && (
            <div className="p-2 rounded-lg bg-yellow-50 border border-yellow-200">
              <p className="text-xs text-ink-600 mb-1">
                {t('widget.nom.saisis.ton.initiative', { name: combat.myCombatant.name })}
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={initInput}
                  onChange={(e) => {
                    setInitInput(e.target.value);
                    if (initError) setInitError(false);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return;
                    const v = parseInt(initInput, 10);
                    if (Number.isNaN(v)) return;
                    const ok = await setInitiative(combat.encounter.id, combat.myCombatant!.id, v);
                    if (ok) setInitInput('');
                  }}
                  placeholder="—"
                  aria-label={t('widget.mon.initiative')}
                  className="input input-compact text-sm py-1"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={async () => {
                    const v = parseInt(initInput, 10);
                    if (Number.isNaN(v)) return;
                    const ok = await setInitiative(combat.encounter.id, combat.myCombatant!.id, v);
                    if (ok) setInitInput('');
                  }}
                  className="btn-primary text-xs px-2 py-1"
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setInitiative(
                      combat.encounter.id,
                      combat.myCombatant!.id,
                      rollD20(combat.myCombatant!.initiativeBonus),
                    )
                  }
                  className="btn-secondary text-xs px-2 py-1"
                  title={t('widget.lancer.d20.dex')}
                >
                  🎲
                </button>
              </div>
              {initError && (
                <p className="text-xs text-red-600 mt-1" role="alert">
                  {t('widget.echec.de.l.enregistrement.reessaie')}
                </p>
              )}
            </div>
          )}

          {/* My combatant status */}
          {combat.myCombatant && !needsInitiative && (
            <div className="flex items-center justify-between text-xs text-ink-500">
              <span>
                {combat.myCombatant.name} · init {combat.myCombatant.initiative}
              </span>
              <span>
                ❤ {combat.myCombatant.hitPoints}/{combat.myCombatant.maxHitPoints}
              </span>
            </div>
          )}

          {/* Link to combat page — enc param opens the encounter directly
            (CombatPage reads it, then strips it from the URL) */}
          <Link
            to={`/party/${combat.partyId}/combat?enc=${combat.encounter.id}`}
            className="block text-center text-xs text-blood-600 hover:text-blood-700 pt-1"
          >
            {t('widget.voir.le.combat')}
          </Link>
        </div>
      </div>
    </div>
  );
}
