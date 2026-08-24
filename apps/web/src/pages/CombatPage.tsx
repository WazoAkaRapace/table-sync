/**
 * LE THÉÂTRE DU TOUR — direction contract (seed ddd4a715, assigned surface candidate 3)
 * THESIS: The combat page is a stage with an initiative rail — the current
 * combatant owns the center, the whole field stays visible in one strip — and
 * the encounter list is a scribe's register with the live fight as the
 * expanded current entry. Refuses the equal-card pile where turn state drowns.
 * OWN-WORLD: register dialect for the list (double rule, filets, Roman
 * ordinals, blood on the live entry); stage + rail for the fight — blood
 * carries "now + primary action", rail states are printed marks (filled
 * current, struck defeated), HpBar for every life, mono for every measure.
 * STORY: The GM lands on the register, cannot miss the live fight, resumes
 * it, and runs the round from one screen — next turn, damage, conditions,
 * stat blocks — seconds per action, the field never leaving the viewport.
 * FIRST VIEWPORT: register — live entry expanded with its roster; or stage —
 * current combatant large under the blood-marked rail, Tour suivant at the
 * stage foot.
 * FORM: stage + rail over the established parchment world (light-only).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with
 * the finish review, the verdict, and DESIGN.md
 */

import type {
  Combatant,
  EncounterDetail,
  EncounterRosterEntry,
  EncounterStatus,
  EncounterSummary,
  PartyDetail,
} from '@table-sync/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import AddMonsterModal from '../components/AddMonsterModal';
import AddPlayerModal from '../components/AddPlayerModal';
import ConditionsEditor from '../components/ConditionsEditor';
import MonsterStatBlock from '../components/MonsterStatBlock';
import {
  BottomSheet,
  ConfirmButton,
  EmptyState,
  ErrorMsg,
  HpBar,
  LoadingSpinner,
  Modal,
  type Toast,
  ToastStack,
} from '../components/ui';
import { useHeaderOverride } from '../headerContext';
import { useSyncEvent } from '../sync';
import { formatCreated, plural, toRoman } from '../utils';

// ---------- Small combat helpers ----------

function rollD20(bonus: number): number {
  return Math.floor(Math.random() * 20) + 1 + bonus;
}

/** Signed initiative bonus, e.g. "+3" / "-1". */
function signedBonus(bonus: number): string {
  return `${bonus >= 0 ? '+' : ''}${bonus}`;
}

/**
 * Next combatant to act after the current one (mirrors the server's
 * next-turn skips: whole groups act together, defeated combatants are
 * skipped with their group). Null when nobody else can act.
 */
function findNext(combatants: Combatant[], turnIndex: number): Combatant | null {
  const cur = combatants[turnIndex];
  if (!cur) return null;
  const inCurrentTurn = (c: Combatant) =>
    cur.groupId !== null ? c.groupId === cur.groupId : c.id === cur.id;

  let i = turnIndex + 1;
  if (cur.groupId !== null) {
    while (i < combatants.length && combatants[i]?.groupId === cur.groupId) i++;
  }
  let guard = 0;
  const maxGuard = combatants.length * 2 + 2;
  while (guard++ < maxGuard) {
    if (i >= combatants.length) i = 0;
    const c = combatants[i];
    if (c && !c.defeated && !inCurrentTurn(c)) return c;
    const g = c?.groupId ?? null;
    i++;
    if (g !== null) {
      while (i < combatants.length && combatants[i]?.groupId === g) i++;
    }
  }
  return null;
}

/** Roster preview label: characters plain, monster groups as "Nom ×N". */
function rosterLine(roster: EncounterRosterEntry[]): string {
  return roster
    .map((r) => (r.player || r.count <= 1 ? r.name : `${r.name} ×${r.count}`))
    .join(' · ');
}

function conditionsTitle(conditions: Combatant['conditions']): string {
  return conditions
    .map((c) => (c.duration == null ? c.name : `${c.name} (${c.duration} tour(s))`))
    .join(', ');
}

/** SQLite HP visibility: non-GM viewers get null HP/AC for combatants they don't own. */
function hpVisible(c: Combatant): boolean {
  return c.hitPoints !== null && c.maxHitPoints !== null;
}

// ---------- Apparent health (monsters, redacted views) ----------
// The tier comes from the server (stable jitter on its boundaries); the wording
// varies per monster so the field reads like a table call, not a gauge.

const FEELING_PHRASES: string[][] = [
  ['À l’agonie', 'Au bord de l’effondrement', 'Il tient à peine debout'],
  ['Gravement blessé', 'Il chancelle', 'Couvert de sang'],
  ['Blessé', 'Touché', 'En difficulté'],
  ['En pleine forme', 'Frais et dispos', 'À peine égratigné'],
];
const FEELING_DOTS = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];

/** Stable word choice per monster + tier — no flicker between polls. */
function feelingPhrase(c: Combatant): string | null {
  if (c.feeling == null) return null;
  const tier = Math.max(0, Math.min(3, Math.round(c.feeling)));
  const variants = FEELING_PHRASES[tier];
  return variants[(c.id * 7 + tier * 3) % variants.length];
}

function feelingDot(c: Combatant): string | null {
  if (c.feeling == null) return null;
  return FEELING_DOTS[Math.max(0, Math.min(3, Math.round(c.feeling)))];
}

export default function CombatPage() {
  const { partyId } = useParams();
  const { user } = useAuth();
  const [party, setParty] = useState<PartyDetail | null>(null);
  const [encounters, setEncounters] = useState<EncounterSummary[]>([]);
  const [activeEncounter, setActiveEncounter] = useState<EncounterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddMonster, setShowAddMonster] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showNewEncounter, setShowNewEncounter] = useState(false);

  // Stage focus: which combatant the stage shows. Null = follow the turn.
  const [focusId, setFocusId] = useState<number | null>(null);
  const [rollingInit, setRollingInit] = useState(false);

  // Damage chip: the rolled damage waiting to be applied. Tapping a combatant
  // card while armed applies floor(value × half?0.5:1) and consumes the chip.
  const [damageChip, setDamageChip] = useState<{
    value: number;
    source: string;
    half: boolean;
  } | null>(null);
  const [applyMode, setApplyMode] = useState(false);

  // Stat block: docked side panel on desktop, bottom-sheet modal on mobile.
  const [statPanelSlug, setStatPanelSlug] = useState<string | null>(null);
  const [statModalSlug, setStatModalSlug] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Toasts for combat mutations (optimistic rollback, applied damage…)
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const pushToast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts, { id, message, kind }]);
    setTimeout(
      () => setToasts((ts) => ts.filter((t) => t.id !== id)),
      kind === 'error' ? 6000 : 2500,
    );
  }, []);

  const currentPartyId = Number(partyId);
  const isGM = party?.members.some((m) => m.userId === user?.id && m.role === 'gm') ?? false;

  // Override app Nav header: when inside an encounter, show its name + back to
  // list. Players also get a shortcut back to their own character sheet.
  const backToList = useCallback(() => {
    setFocusId(null);
    setStatPanelSlug(null);
    setStatModalSlug(null);
    setActiveEncounter(null);
  }, []);
  // "Ma fiche" targets the ACTIVE sheet: hidden (secret prep) characters are
  // skipped — the shortcut always returns to a character the table can see.
  const myCharacter = party?.characters.find((c) => c.ownerId === user?.id && !c.hidden) ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: dep narrowed to myCharacter?.id so the memoized action object keeps a stable identity across party refreshes.
  const sheetAction = useMemo(
    () =>
      myCharacter && partyId
        ? { label: 'Ma fiche', short: '🧙', to: `/party/${partyId}/character/${myCharacter.id}` }
        : null,
    [myCharacter?.id, partyId],
  );
  useHeaderOverride(
    activeEncounter ? activeEncounter.name : '⚔ Combat',
    activeEncounter ? backToList : null,
    sheetAction,
  );

  const load = useCallback(
    async (silent = false) => {
      if (!partyId) return;
      if (!silent) setLoading(true);
      try {
        const [partyRes, encRes] = await Promise.all([
          api.get(`/api/parties/${partyId}`),
          api.get(`/api/parties/${partyId}/encounters`),
        ]);
        setParty(partyRes.data);
        setEncounters(encRes.data.encounters || []);
        setError('');
      } catch (err: any) {
        setError(err.response?.data?.error || 'Erreur');
      } finally {
        setLoading(false);
      }
    },
    [partyId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Real-time sync — combat:change is exempt from echo suppression on purpose
  // (one user can be GM in a tab and player in another), so own changes also
  // arrive here; a silent reload reconciles with what we already applied.
  useSyncEvent(
    (event) => {
      if (event.partyId === currentPartyId && event.type === 'combat:change') {
        load(true);
        if (activeEncounter) loadEncounter(activeEncounter.id, true);
      }
    },
    [currentPartyId, activeEncounter?.id],
  );

  const loadEncounter = useCallback(async (id: number, silent = false) => {
    try {
      const res = await api.get(`/api/encounters/${id}`);
      setActiveEncounter(res.data.encounter);
    } catch {
      // Silent refreshes keep the stale view; a failed explicit open must say so.
      if (!silent) setError('Impossible de charger la rencontre');
    }
  }, []);

  const selectEncounter = async (id: number) => {
    setFocusId(null);
    setDamageChip(null);
    setApplyMode(false);
    // A docked stat block belongs to its encounter — never carry it across.
    setStatPanelSlug(null);
    setStatModalSlug(null);
    await loadEncounter(id);
  };

  // Deep link: /combat?enc=ID opens the encounter directly
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinked = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectEncounter is omitted on purpose — it is recreated every render and the deepLinked ref guards against double loads.
  useEffect(() => {
    if (deepLinked.current || loading || encounters.length === 0) return;
    const encParam = searchParams.get('enc');
    if (encParam) {
      const id = Number(encParam);
      if (encounters.some((e) => e.id === id)) {
        deepLinked.current = true;
        selectEncounter(id);
        searchParams.delete('enc');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [searchParams, setSearchParams, loading, encounters]);

  const createEncounter = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await api.post(`/api/parties/${partyId}/encounters`, { name: trimmed });
      setShowNewEncounter(false);
      await load(true);
      await selectEncounter(res.data.encounter.id);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur');
    }
  };

  const patchEncounter = async (patch: Partial<EncounterDetail>) => {
    if (!activeEncounter) return;
    try {
      await api.patch(`/api/encounters/${activeEncounter.id}`, patch);
      // Response omits combatants — reload the full detail.
      await loadEncounter(activeEncounter.id, true);
    } catch (err: any) {
      pushToast(err.response?.data?.error || 'Erreur', 'error');
    }
  };

  const nextTurn = async () => {
    if (!activeEncounter) return;
    try {
      // The server recomputes turn order, round and condition expiry — the
      // response skips combatants, so reload the full detail once.
      setFocusId(null);
      await api.post(`/api/encounters/${activeEncounter.id}/next-turn`);
      await loadEncounter(activeEncounter.id, true);
    } catch (err: any) {
      pushToast(err.response?.data?.error || 'Erreur', 'error');
    }
  };

  // Player-side close: same advance as nextTurn, but the server allows it only
  // from the owner of a combatant holding the current turn.
  const [endingTurn, setEndingTurn] = useState(false);
  const endMyTurn = async () => {
    if (!activeEncounter || endingTurn) return;
    setEndingTurn(true);
    setFocusId(null);
    try {
      await api.post(`/api/encounters/${activeEncounter.id}/end-my-turn`);
      await loadEncounter(activeEncounter.id, true);
    } catch {
      // Most likely the MD advanced the same turn a beat earlier — resync
      // quietly so the stage shows whose turn it actually is.
      pushToast('Le tour a déjà changé', 'error');
      await loadEncounter(activeEncounter.id, true);
    } finally {
      setEndingTurn(false);
    }
  };

  /** GM convenience in setup: roll every missing initiative (one per group). */
  const rollAllInitiatives = async () => {
    if (!activeEncounter) return;
    setRollingInit(true);
    try {
      const seenGroups = new Set<number>();
      for (const c of activeEncounter.combatants) {
        if (c.initiative !== null || c.defeated) continue;
        if (c.groupId !== null) {
          if (seenGroups.has(c.groupId)) continue;
          seenGroups.add(c.groupId);
        }
        await api.patch(`/api/encounters/${activeEncounter.id}/combatants/${c.id}/initiative`, {
          initiative: rollD20(c.initiativeBonus),
        });
      }
      await loadEncounter(activeEncounter.id, true);
    } catch (err: any) {
      pushToast(err.response?.data?.error || 'Erreur', 'error');
    } finally {
      setRollingInit(false);
    }
  };

  const addMonster = async (slug: string, count: number, name: string) => {
    if (!activeEncounter) return;
    try {
      await api.post(`/api/encounters/${activeEncounter.id}/combatants/monster`, {
        monsterSlug: slug,
        count,
        name,
      });
      await loadEncounter(activeEncounter.id);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur');
    }
  };

  const addPlayers = async (characterIds: number[]) => {
    if (!activeEncounter || characterIds.length === 0) return;
    try {
      await api.post(`/api/encounters/${activeEncounter.id}/combatants/player`, { characterIds });
      await loadEncounter(activeEncounter.id);
      setShowAddPlayer(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur');
    }
  };

  const patchCombatant = async (id: number, patch: Partial<Combatant>) => {
    if (!activeEncounter) return;
    // Optimistic: apply locally now, reconcile with the server's combatant,
    // roll back visually if the patch fails.
    const snapshot = activeEncounter;
    setActiveEncounter({
      ...snapshot,
      combatants: snapshot.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
    try {
      const res = await api.patch(`/api/combatants/${id}`, patch);
      const updated: Combatant | undefined = res.data?.combatant;
      if (updated) {
        setActiveEncounter((enc) =>
          enc
            ? { ...enc, combatants: enc.combatants.map((c) => (c.id === id ? updated : c)) }
            : enc,
        );
      }
    } catch (err: any) {
      setActiveEncounter(snapshot);
      pushToast(err.response?.data?.error || 'Échec de la mise à jour', 'error');
    }
  };

  const setInitiative = async (id: number, initiative: number) => {
    if (!activeEncounter) return;
    try {
      await api.patch(`/api/encounters/${activeEncounter.id}/combatants/${id}/initiative`, {
        initiative,
      });
      await loadEncounter(activeEncounter.id);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur');
    }
  };

  const deleteCombatant = async (id: number) => {
    try {
      await api.delete(`/api/combatants/${id}`);
      if (activeEncounter) {
        if (focusId === id) setFocusId(null);
        await loadEncounter(activeEncounter.id);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur');
    }
  };

  const deleteEncounter = async (id: number) => {
    try {
      await api.delete(`/api/encounters/${id}`);
      if (activeEncounter?.id === id) setActiveEncounter(null);
      await load(true);
    } catch (err: any) {
      pushToast(err.response?.data?.error || 'Erreur', 'error');
    }
  };

  // ---------- Damage chip flow ----------

  /** A damage roll in a stat block (panel or modal) creates a fresh chip. */
  const handleDamageRolled = useCallback((total: number, source: string) => {
    setDamageChip({ value: total, source, half: false });
    setApplyMode(false);
  }, []);

  /** Tap the chip → arm; tap again → disarm. */
  const toggleChip = () => setApplyMode((a) => !a);

  const applyDamageTo = (combatantId: number) => {
    if (!damageChip || !activeEncounter) return;
    const target = activeEncounter.combatants.find((c) => c.id === combatantId);
    if (!target) return;
    const dealt = Math.floor(damageChip.value * (damageChip.half ? 0.5 : 1));
    const max = target.maxHitPoints ?? 0;
    const cur = target.hitPoints ?? 0;
    const newHp = Math.max(0, Math.min(max, cur - dealt));
    setDamageChip(null);
    setApplyMode(false);
    patchCombatant(combatantId, { hitPoints: newHp });
  };

  const cancelChip = useCallback(() => {
    setDamageChip(null);
    setApplyMode(false);
  }, []);

  // Escape cancels apply mode
  useEffect(() => {
    if (!applyMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelChip();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [applyMode, cancelChip]);

  /** Stat blocks dock on desktop, open as modal on mobile. */
  const openStatBlock = useCallback(
    (slug: string) => {
      if (isDesktop) setStatPanelSlug(slug);
      else setStatModalSlug(slug);
    },
    [isDesktop],
  );

  if (loading) return <LoadingSpinner label="Ouverture du registre…" />;
  if (error && !party) return <ErrorMsg message={error} />;
  if (!party) return <ErrorMsg message="Groupe introuvable" />;

  const availableChars = party.characters.filter(
    (c) => !c.hidden && !activeEncounter?.combatants.some((com) => com.characterId === c.id),
  );

  return (
    <div className={activeEncounter ? 'w-full' : 'mx-auto w-full max-w-3xl'}>
      {error && !activeEncounter && <ErrorMsg message={error} />}

      {!activeEncounter && (
        <EncounterRegister
          encounters={encounters}
          isGM={isGM}
          onOpen={selectEncounter}
          onDelete={deleteEncounter}
          onCreate={createEncounter}
          onOpenModal={() => setShowNewEncounter(true)}
        />
      )}

      {activeEncounter && (
        <CombatTheatre
          encounter={activeEncounter}
          party={party}
          userId={user?.id ?? 0}
          isGM={isGM}
          focusId={focusId}
          onFocus={setFocusId}
          onPatch={patchCombatant}
          onDelete={deleteCombatant}
          onSetInitiative={setInitiative}
          onRollAll={rollAllInitiatives}
          rollingInit={rollingInit}
          onNextTurn={nextTurn}
          onEndMyTurn={endMyTurn}
          endMyTurnBusy={endingTurn}
          onEnd={() => patchEncounter({ status: 'ended' })}
          onAddMonster={() => setShowAddMonster(true)}
          onAddPlayer={() => setShowAddPlayer(true)}
          canAddPlayer={availableChars.length > 0}
          statDock={
            statPanelSlug ? (
              <MonsterStatBlock
                open
                variant="panel"
                slug={statPanelSlug}
                onClose={() => setStatPanelSlug(null)}
                onDamageRolled={handleDamageRolled}
              />
            ) : (
              <div className="card p-6 text-center text-sm text-ink-400">
                📜 Bloc de stats
                <p className="mt-1 text-xs">
                  Touchez 📜 sur un monstre pour l’amarrer ici pendant la rencontre.
                </p>
              </div>
            )
          }
          damageChip={damageChip}
          applyMode={applyMode}
          onToggleChip={toggleChip}
          onToggleHalf={() => setDamageChip((c) => (c ? { ...c, half: !c.half } : c))}
          onCancelChip={cancelChip}
          onApplyDamage={applyDamageTo}
          onOpenStatBlock={isGM ? openStatBlock : undefined}
        />
      )}

      {/* Mobile stat-block modal */}
      <MonsterStatBlock
        open={statModalSlug !== null}
        slug={statModalSlug}
        onClose={() => setStatModalSlug(null)}
        onDamageRolled={handleDamageRolled}
      />

      {/* New encounter modal (register foot action) */}
      <Modal
        open={showNewEncounter}
        onClose={() => setShowNewEncounter(false)}
        title="Nouvelle rencontre"
      >
        <NewEncounterForm onCreate={createEncounter} />
      </Modal>

      {/* Add monster modal */}
      <AddMonsterModal
        open={showAddMonster}
        onClose={() => setShowAddMonster(false)}
        onAdd={addMonster}
      />

      {/* Add player modal */}
      <AddPlayerModal
        open={showAddPlayer}
        onClose={() => setShowAddPlayer(false)}
        characters={availableChars}
        onAdd={addPlayers}
      />

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LE REGISTRE DES RENCONTRES — the list state, ruled like Mes groupes
// ══════════════════════════════════════════════════════════════════════════

function NewEncounterForm({
  onCreate,
  autoFocus = false,
}: {
  onCreate: (name: string) => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(name);
        setName('');
      }}
      className="mt-4 space-y-3"
    >
      <div>
        <label className="label" htmlFor="new-encounter-name">
          Nom de la rencontre
        </label>
        <input
          id="new-encounter-name"
          autoFocus={autoFocus}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex : Embuscade gobeline"
          className="input w-full"
        />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={!name.trim()}>
        Créer la rencontre
      </button>
    </form>
  );
}

function EncounterRegister({
  encounters,
  isGM,
  onOpen,
  onDelete,
  onCreate,
  onOpenModal,
}: {
  encounters: EncounterSummary[];
  isGM: boolean;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
  onCreate: (name: string) => void;
  onOpenModal: () => void;
}) {
  // Lifecycle hierarchy: the live fight(s) first as expanded entries, then
  // prepared encounters, finished ones compacted at the foot of the page.
  const live = encounters.filter((e) => e.status === 'active');
  const prepared = encounters.filter((e) => e.status === 'setup');
  const done = encounters.filter((e) => e.status === 'ended');
  const ordered = [...live, ...prepared, ...done];

  // ---------- Virgin register ----------
  if (encounters.length === 0) {
    return (
      <div className="register-rise">
        <header className="pb-6 pt-2 text-center">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">Rencontres</h1>
          <p className="mt-1.5 text-ink-500">Le registre des combats du groupe est vierge.</p>
        </header>

        <div aria-hidden="true">
          <div className="border-t-2 border-parchment-400" />
          <div className="mt-[3px] border-t border-parchment-300" />
        </div>

        {isGM ? (
          <section className="mx-auto max-w-md py-8">
            <h2 className="section-title">Ouvrir la première rencontre</h2>
            <p className="mt-1 text-sm text-ink-400">
              Chaque combat a sa page — nomme-la comme l'épisode de la soirée, puis ajoute monstres
              et personnages sur le banc de préparation.
            </p>
            <NewEncounterForm onCreate={onCreate} autoFocus />
          </section>
        ) : (
          <EmptyState
            icon="⚔"
            title="Aucune rencontre"
            hint="Le MD n'a pas encore ouvert le registre des combats."
          />
        )}

        <div aria-hidden="true" className="border-b border-parchment-200" />
      </div>
    );
  }

  // ---------- The register with entries ----------
  return (
    <div>
      <header className="register-rise pb-6 pt-2 text-center">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Rencontres</h1>
        <p className="mt-1.5 text-sm text-ink-400">
          {plural(encounters.length, 'rencontre')} au registre
          {live.length > 0 && ` — ${plural(live.length, 'combat')} en cours`}
        </p>
      </header>

      <div aria-hidden="true">
        <div className="border-t-2 border-parchment-400" />
        <div className="mt-[3px] border-t border-parchment-300" />
      </div>

      <ol className="list-none">
        {ordered.map((enc, i) => {
          const isLive = enc.status === 'active';
          const isDone = enc.status === 'ended';
          const delay = `${Math.min(i + 1, 5) * 60}ms`;
          return (
            <li
              key={enc.id}
              className="register-rise border-b border-parchment-200"
              style={{ animationDelay: delay }}
            >
              <button
                type="button"
                onClick={() => onOpen(enc.id)}
                className={`-mx-3 block w-full rounded-lg px-3 text-left transition-colors hover:bg-parchment-100/70 ${
                  isLive ? 'py-6' : isDone ? 'py-3' : 'py-4'
                }`}
                aria-label={
                  isLive ? `Reprendre la rencontre ${enc.name}` : `Ouvrir la rencontre ${enc.name}`
                }
              >
                <span className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className={`w-10 shrink-0 text-right font-display ${
                      isLive
                        ? 'pt-1 text-2xl text-blood-500'
                        : isDone
                          ? 'pt-0.5 text-base text-ink-300'
                          : 'pt-0.5 text-lg text-ink-400'
                    }`}
                  >
                    {toRoman(i + 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span
                        className={`truncate font-display leading-tight ${
                          isLive
                            ? 'text-2xl font-bold'
                            : isDone
                              ? 'text-base font-semibold'
                              : 'text-lg font-semibold'
                        }`}
                      >
                        {enc.name}
                      </span>
                      {isLive && (
                        <span className="shrink-0 rounded-full bg-blood-600 px-2.5 py-1 font-mono text-xs font-semibold text-parchment-50">
                          Tour {enc.round}
                        </span>
                      )}
                    </span>
                    {isLive && (
                      <span className="mt-1.5 block text-sm text-ink-500">
                        🔴 En cours · {plural(enc.combatantCount, 'combattant')}
                      </span>
                    )}
                    {!isLive && !isDone && (
                      <span className="mt-0.5 block text-sm text-ink-400">
                        ⚪ Préparation · {plural(enc.combatantCount, 'combattant')}
                      </span>
                    )}
                    {isDone && (
                      <span className="mt-0.5 block text-sm text-ink-400">
                        ⚫ Terminée · tour {enc.round} · {formatCreated(enc.createdAt)}
                      </span>
                    )}
                    {enc.roster.length > 0 && !isDone && (
                      <span
                        className={`block leading-relaxed text-ink-700 ${
                          isLive
                            ? 'mt-4 border-t border-parchment-200 pt-4'
                            : 'mt-1 truncate text-sm text-ink-500'
                        }`}
                      >
                        {rosterLine(enc.roster)}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              {isGM && (
                <div className={`pl-14 ${isLive ? 'pb-5' : isDone ? 'pb-2' : 'pb-3'}`}>
                  <ConfirmButton
                    onConfirm={() => onDelete(enc.id)}
                    className="text-xs text-ink-400 hover:text-red-600"
                    armedClassName="font-semibold text-red-700"
                    title="Supprimer la rencontre"
                    ariaLabel={`Supprimer la rencontre ${enc.name}`}
                    confirmChildren="Confirmer ?"
                  >
                    Supprimer
                  </ConfirmButton>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {isGM && (
        <div className="flex items-center justify-center pt-6">
          <button type="button" className="btn-ghost text-ink-500" onClick={onOpenModal}>
            ＋ Nouvelle rencontre
          </button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LE THÉÂTRE DU TOUR — rail (the whole field) + stage (the current turn)
// ══════════════════════════════════════════════════════════════════════════

function CombatTheatre({
  encounter,
  party,
  userId,
  isGM,
  focusId,
  onFocus,
  onPatch,
  onDelete,
  onSetInitiative,
  onRollAll,
  rollingInit,
  onNextTurn,
  onEndMyTurn,
  endMyTurnBusy,
  onEnd,
  onAddMonster,
  onAddPlayer,
  canAddPlayer,
  damageChip,
  applyMode,
  onToggleChip,
  onToggleHalf,
  onCancelChip,
  onApplyDamage,
  onOpenStatBlock,
  statDock,
}: {
  encounter: EncounterDetail;
  party: PartyDetail;
  userId: number;
  isGM: boolean;
  focusId: number | null;
  onFocus: (id: number | null) => void;
  onPatch: (id: number, patch: Partial<Combatant>) => void;
  onDelete: (id: number) => void;
  onSetInitiative: (id: number, initiative: number) => void;
  onRollAll: () => void;
  rollingInit: boolean;
  onNextTurn: () => void;
  onEndMyTurn: () => void;
  endMyTurnBusy: boolean;
  onEnd: () => void;
  onAddMonster: () => void;
  onAddPlayer: () => void;
  canAddPlayer: boolean;
  damageChip: { value: number; source: string; half: boolean } | null;
  applyMode: boolean;
  onToggleChip: () => void;
  onToggleHalf: () => void;
  onCancelChip: () => void;
  onApplyDamage: (id: number) => void;
  onOpenStatBlock?: (slug: string) => void;
  statDock: ReactNode;
}) {
  const combatants = encounter.combatants;
  const status = encounter.status;
  const current = combatants[encounter.turnIndex];
  const focused = combatants.find((c) => c.id === focusId) ?? current;
  const isCurrentTurn =
    !!focused &&
    status === 'active' &&
    !!current &&
    (current.groupId !== null ? focused.groupId === current.groupId : focused.id === current.id);
  const targetMode = isGM && applyMode && !!damageChip;
  const needsInitiative =
    status === 'setup' && combatants.some((c) => !c.defeated && c.initiative === null);
  const next = status === 'active' ? findNext(combatants, encounter.turnIndex) : null;

  const canSetInitiative = (c: Combatant) =>
    !!c.characterId &&
    party.characters.some((ch) => ch.id === c.characterId && ch.ownerId === userId);

  // Does the CURRENT turn belong to one of the viewer's own characters?
  // (group-aware, mirroring the server's same-turn rule)
  const currentIsMine =
    status === 'active' &&
    !!current &&
    combatants.some(
      (c) =>
        canSetInitiative(c) &&
        (current.groupId !== null ? c.groupId === current.groupId : c.id === current.id),
    );

  const sheetPath = (c: Combatant) =>
    c.characterId && party.characters.some((ch) => ch.id === c.characterId)
      ? `/party/${encounter.partyId}/character/${c.characterId}`
      : undefined;

  // Turn controls + add actions, staged at the combatant's foot (active) or on
  // the bench bar (setup).
  const startDisabled = combatants.length === 0 || needsInitiative;
  const nextHint = next ? (
    <span className="ml-auto text-sm text-ink-400">
      Puis : {next.name}
      {next.groupId !== null &&
        combatants.filter((c) => c.groupId === next.groupId).length > 1 &&
        ` (×${combatants.filter((c) => c.groupId === next.groupId).length})`}
    </span>
  ) : null;
  const stageFooter =
    isGM && status === 'active' ? (
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-parchment-200 pt-4">
        <button type="button" onClick={onNextTurn} className="btn-primary min-h-[44px] text-sm">
          ▶ Tour suivant
        </button>
        <button type="button" onClick={onEnd} className="btn-secondary min-h-[44px] text-sm">
          ⏹ Fin
        </button>
        <button type="button" onClick={onAddMonster} className="btn-secondary min-h-[44px] text-sm">
          + Monstre
        </button>
        {canAddPlayer && (
          <button
            type="button"
            onClick={onAddPlayer}
            className="btn-secondary min-h-[44px] text-sm"
          >
            + PJ
          </button>
        )}
        {nextHint}
      </div>
    ) : !isGM && currentIsMine ? (
      // Player foot — the mirror of the MD's: the owner closes their own turn,
      // handing it to the announced next combatant
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-parchment-200 pt-4">
        <button
          type="button"
          onClick={onEndMyTurn}
          disabled={endMyTurnBusy}
          className="btn-primary min-h-[44px] text-sm"
          aria-label="Terminer mon tour — passer au combattant suivant"
        >
          ✓ J'ai fini mon tour
        </button>
        {nextHint}
      </div>
    ) : null;

  return (
    <div
      className={`register-rise lg:grid lg:items-start lg:gap-4 ${
        isGM ? 'lg:grid-cols-[15rem_minmax(0,1fr)_340px]' : 'lg:grid-cols-[15rem_minmax(0,1fr)]'
      }`}
    >
      {/* The rail — the whole field, always visible */}
      <aside className="sticky top-2 z-30 -mx-1 bg-parchment-50/95 px-1 py-1 lg:sticky lg:top-3 lg:z-auto lg:mx-0 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:bg-transparent lg:px-0 lg:py-0">
        <InitiativeRail
          combatants={combatants}
          turnIndex={encounter.turnIndex}
          status={status}
          focusId={focusId}
          onFocus={onFocus}
          targetMode={targetMode}
          onApplyDamage={onApplyDamage}
        />
      </aside>

      {/* The stage */}
      <div className="mt-3 min-w-0 space-y-3 lg:mt-0">
        {/* Damage chip dock — the rolled damage waits here until applied */}
        {isGM && damageChip && (
          <DamageChipDock
            chip={damageChip}
            applyMode={applyMode}
            onToggle={onToggleChip}
            onToggleHalf={onToggleHalf}
            onCancel={onCancelChip}
          />
        )}

        {/* Bench bar — assembly controls while the fight is not started */}
        {isGM && status === 'setup' && (
          <div className="card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  needsInitiative ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                }`}
              >
                {needsInitiative ? '⚪ En attente d’initiative' : '✅ Prêt à démarrer'}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {needsInitiative && (
                  <button
                    type="button"
                    onClick={onRollAll}
                    disabled={rollingInit}
                    className="btn-secondary min-h-[44px] text-sm disabled:opacity-40"
                    title="Lancer d20 + DEX pour toutes les initiatives manquantes"
                  >
                    {rollingInit ? '🎲 Lancés…' : '🎲 Tout lancer'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onAddMonster}
                  className="btn-secondary min-h-[44px] text-sm"
                >
                  + Monstre
                </button>
                {canAddPlayer && (
                  <button
                    type="button"
                    onClick={onAddPlayer}
                    className="btn-secondary min-h-[44px] text-sm"
                  >
                    + PJ
                  </button>
                )}
                <button
                  type="button"
                  onClick={onNextTurn}
                  disabled={startDisabled}
                  className="btn-primary min-h-[44px] text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    needsInitiative
                      ? 'Tous les combattants doivent lancer leur initiative'
                      : 'Démarrer le combat — tour 1, premier combattant'
                  }
                >
                  ▶ Démarrer le combat
                </button>
              </div>
            </div>
          </div>
        )}

        {combatants.length === 0 ? (
          <div className="card p-4 sm:p-5">
            {/* The bench carries its encounter's name — a fresh fight is not an anonymous void */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-parchment-200 pb-3">
              <h2 className="font-display text-2xl font-bold leading-tight">{encounter.name}</h2>
              {status === 'setup' && (
                <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700">
                  ⚪ Préparation
                </span>
              )}
              {status === 'active' && (
                <span className="rounded-full bg-blood-600 px-2.5 py-1 font-mono text-xs font-semibold text-parchment-50">
                  Tour {encounter.round}
                </span>
              )}
            </div>
            <EmptyState
              icon="🎭"
              title="Aucun combattant"
              hint={
                isGM
                  ? 'Ajoute des monstres et des personnages pour commencer.'
                  : 'Le MD prépare la rencontre.'
              }
            />
          </div>
        ) : (
          focused && (
            <div key={focused.id} className="stage-swap">
              <StagePanel
                encounter={encounter}
                combatant={focused}
                isCurrentTurn={isCurrentTurn}
                isGM={isGM}
                canSetInitiative={canSetInitiative(focused)}
                sheetPath={sheetPath(focused)}
                onPatch={onPatch}
                onDelete={onDelete}
                onSetInitiative={onSetInitiative}
                targetMode={targetMode}
                onApplyDamage={onApplyDamage}
                onFocus={onFocus}
                onOpenStatBlock={onOpenStatBlock}
                footer={stageFooter}
              />
            </div>
          )
        )}
      </div>

      {/* Docked stat block (desktop) — rolls feed the damage chip above */}
      {isGM && (
        <aside className="hidden max-h-[calc(100vh-6rem)] lg:sticky lg:top-3 lg:block">
          {statDock}
        </aside>
      )}
    </div>
  );
}

// ---------- The initiative rail ----------

function InitiativeRail({
  combatants,
  turnIndex,
  status,
  focusId,
  onFocus,
  targetMode,
  onApplyDamage,
}: {
  combatants: Combatant[];
  turnIndex: number;
  status: EncounterStatus;
  focusId: number | null;
  onFocus: (id: number | null) => void;
  targetMode: boolean;
  onApplyDamage: (id: number) => void;
}) {
  // Number group members ("Gobelin 1", "Gobelin 2"…) in sorted order.
  const labels = useMemo(() => {
    const counters = new Map<number, number>();
    return combatants.map((c) => {
      if (c.groupId === null) return c.name;
      const n = (counters.get(c.groupId) ?? 0) + 1;
      counters.set(c.groupId, n);
      return `${c.name} ${n}`;
    });
  }, [combatants]);

  const currentRef = status === 'active' ? combatants[turnIndex] : undefined;
  const isCurrentDetent = (c: Combatant) =>
    !!currentRef &&
    (currentRef.groupId !== null ? c.groupId === currentRef.groupId : c.id === currentRef.id);

  return (
    <nav aria-label="Ordre d'initiative">
      <h2 className="section-title mb-2 hidden text-base lg:block">Initiative</h2>
      <ol className="list-none flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
        {combatants.map((c, idx) => {
          const label = labels[idx];
          const isCurrent = isCurrentDetent(c);
          const isFocused = focusId === c.id;
          const hp = hpVisible(c);
          const phrase = feelingPhrase(c);
          const ariaParts = [
            label,
            c.initiative === null ? 'initiative non lancée' : `initiative ${c.initiative}`,
          ];
          if (hp) ariaParts.push(`${c.hitPoints}/${c.maxHitPoints} PV`);
          if (phrase) ariaParts.push(phrase.toLowerCase());
          if (c.conditions.length > 0)
            ariaParts.push(`${plural(c.conditions.length, 'condition')}`);
          if (c.defeated) ariaParts.push('vaincu');
          if (isCurrent) ariaParts.push('tour en cours');
          return (
            <li key={c.id} className="shrink-0 lg:w-full">
              <button
                type="button"
                onClick={() => (targetMode ? onApplyDamage(c.id) : onFocus(c.id))}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={ariaParts.join(', ')}
                className={`relative flex min-h-[52px] w-24 flex-col justify-center gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors lg:w-full lg:flex-row lg:items-center lg:gap-2 ${
                  isCurrent
                    ? 'border-blood-600 bg-blood-600 text-parchment-50 shadow-sm'
                    : isFocused
                      ? 'border-ink-500 bg-parchment-100'
                      : 'border-parchment-200 bg-parchment-50/80 hover:border-parchment-300 hover:bg-parchment-100'
                } ${c.defeated ? 'opacity-55' : ''} ${targetMode ? 'combat-target' : ''}`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span
                    className={`w-5 shrink-0 text-center font-mono text-sm font-bold ${
                      isCurrent ? '' : c.initiative === null ? 'text-ink-300' : 'text-ink-500'
                    }`}
                  >
                    {c.initiative ?? '—'}
                  </span>
                  {c.cardColor && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full border border-black/10"
                      style={{ backgroundColor: c.cardColor }}
                    />
                  )}
                  <span
                    className={`truncate text-xs font-medium lg:text-sm ${
                      c.defeated ? 'line-through' : ''
                    }`}
                  >
                    {label}
                  </span>
                  {c.conditions.length > 0 && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 text-[10px] font-semibold ${
                        isCurrent ? 'bg-parchment-50/25' : 'bg-orange-100 text-orange-700'
                      }`}
                      title={conditionsTitle(c.conditions)}
                    >
                      {c.conditions.length}
                    </span>
                  )}
                  {phrase && (
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${feelingDot(c)}`}
                      title={`État apparent : ${phrase}`}
                    />
                  )}
                  {c.defeated && (
                    <span aria-hidden="true" className="shrink-0 text-xs">
                      💀
                    </span>
                  )}
                </span>
                {hp && (
                  <HpBar
                    current={c.hitPoints ?? 0}
                    max={c.maxHitPoints ?? 1}
                    size="xs"
                    className="lg:w-24 lg:shrink-0"
                    trackClassName={isCurrent ? 'bg-blood-800/40' : 'bg-parchment-200'}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------- The damage chip dock ----------

function DamageChipDock({
  chip,
  applyMode,
  onToggle,
  onToggleHalf,
  onCancel,
}: {
  chip: { value: number; source: string; half: boolean };
  applyMode: boolean;
  onToggle: () => void;
  onToggleHalf: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={`card p-2.5 ${applyMode ? 'ring-2 ring-blood-400' : ''}`} role="status">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className={`flex min-h-[44px] items-center rounded-lg px-3 py-2 font-mono text-sm font-bold transition-all active:scale-95 ${
            applyMode
              ? 'bg-blood-600 text-parchment-50 shadow-md'
              : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
          }`}
          title={applyMode ? 'Annuler (Échap)' : 'Appliquer à une cible'}
        >
          ⚔ {Math.floor(chip.value * (chip.half ? 0.5 : 1))} dégâts
          <span className="ml-1.5 font-sans text-xs font-normal opacity-75">{chip.source}</span>
        </button>
        <button
          type="button"
          onClick={onToggleHalf}
          className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
            chip.half
              ? 'bg-ink-900 text-parchment-50'
              : 'bg-parchment-100 text-ink-600 hover:bg-parchment-200'
          }`}
          aria-pressed={chip.half}
          title="Demi-dégâts (résistance, sauvegarde réussie)"
        >
          ½
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost min-h-[44px] min-w-[44px] p-2 text-sm text-ink-400 hover:text-ink-700"
          aria-label="Annuler la puce de dégâts"
        >
          ✕
        </button>
        <span className="ml-auto text-xs text-ink-500">
          {applyMode ? 'Touchez une cible…' : 'Touchez la puce, puis une cible'}
        </span>
      </div>
    </div>
  );
}

// ---------- The stage ----------

const CARD_COLORS = [
  null, // default
  '#fef3c7', // amber
  '#dcfce7', // green
  '#dbeafe', // blue
  '#fce7f3', // pink
  '#f3e8ff', // purple
  '#fed7aa', // orange
  '#fee2e2', // red
  '#e0e7ff', // indigo
];

/** French names for the color marks — announced when picking a swatch. */
const CARD_COLOR_NAMES: Record<string, string> = {
  '#fef3c7': 'ambre',
  '#dcfce7': 'vert',
  '#dbeafe': 'bleu',
  '#fce7f3': 'rose',
  '#f3e8ff': 'violet',
  '#fed7aa': 'orange',
  '#fee2e2': 'rouge',
  '#e0e7ff': 'indigo',
};

function StagePanel({
  encounter,
  combatant,
  isCurrentTurn,
  isGM,
  canSetInitiative,
  sheetPath,
  onPatch,
  onDelete,
  onSetInitiative,
  targetMode,
  onApplyDamage,
  onFocus,
  onOpenStatBlock,
  footer,
}: {
  encounter: EncounterDetail;
  combatant: Combatant;
  isCurrentTurn: boolean;
  isGM: boolean;
  canSetInitiative: boolean;
  sheetPath?: string;
  onPatch: (id: number, patch: Partial<Combatant>) => void;
  onDelete: (id: number) => void;
  onSetInitiative: (id: number, initiative: number) => void;
  targetMode: boolean;
  onApplyDamage: (id: number) => void;
  onFocus: (id: number | null) => void;
  onOpenStatBlock?: (slug: string) => void;
  footer?: ReactNode;
}) {
  const [showDamage, setShowDamage] = useState(false);
  const [showConditions, setShowConditions] = useState(false);
  const [showColor, setShowColor] = useState(false);
  const [initInput, setInitInput] = useState(
    combatant.initiative !== null ? String(combatant.initiative) : '',
  );
  // StagePanel remounts on focus change (keyed wrapper), so this only needs
  // to reconcile the input when a reload brings a new initiative for the
  // combatant already on stage.
  useEffect(() => {
    setInitInput(combatant.initiative !== null ? String(combatant.initiative) : '');
  }, [combatant.initiative]);

  const combatants = encounter.combatants;
  const groupMembers =
    combatant.groupId !== null ? combatants.filter((c) => c.groupId === combatant.groupId) : [];
  const memberLabel = (m: Combatant) =>
    `${m.name} ${groupMembers.findIndex((g) => g.id === m.id) + 1}`;
  const status = encounter.status;
  const label = groupMembers.length > 1 ? memberLabel(combatant) : combatant.name;
  const hp = hpVisible(combatant);

  const submitInitiative = () => {
    const v = parseInt(initInput, 10);
    if (!Number.isNaN(v)) onSetInitiative(combatant.id, Math.max(0, Math.min(40, v)));
  };

  return (
    <article className="card relative p-4 sm:p-5">
      {/* Header — who is on stage */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {status === 'active' && (
              <span className="rounded-full bg-blood-600 px-2.5 py-1 font-mono text-xs font-semibold text-parchment-50">
                Tour {encounter.round}
              </span>
            )}
            {status === 'setup' && (
              <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700">
                ⚪ Préparation
              </span>
            )}
            {status === 'ended' && (
              <span className="rounded-full bg-parchment-200 px-2.5 py-1 text-xs font-medium text-ink-500">
                ⚫ Terminée · tour {encounter.round}
              </span>
            )}
            {!isCurrentTurn && status === 'active' && (
              <span className="rounded-full bg-parchment-200 px-2 py-0.5 text-[11px] font-medium text-ink-500">
                Hors tour
              </span>
            )}
            {combatant.defeated && (
              <span className="text-sm font-medium text-ink-400">💀 Vaincu</span>
            )}
          </div>
          <h2 className="mt-1 font-display text-2xl font-bold leading-tight sm:text-3xl">
            {sheetPath ? (
              <Link
                to={sheetPath}
                className="hover:text-blood-600 hover:underline"
                title="Ouvrir la fiche du personnage"
              >
                {label}
              </Link>
            ) : (
              label
            )}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="rounded-lg border border-parchment-200 bg-parchment-100 px-2 py-1 font-mono text-sm font-semibold text-ink-700"
            title="Initiative"
          >
            Init {combatant.initiative ?? '—'}
          </span>
          {combatant.armorClass !== null && (
            <span
              className="flex items-center gap-1 rounded-lg border border-parchment-200 bg-parchment-100 px-2 py-1 font-mono text-sm font-semibold text-ink-700"
              title="Classe d'armure"
            >
              <span aria-hidden="true">🛡</span>
              {combatant.armorClass}
            </span>
          )}
        </div>
      </div>

      {/* Group member strip — switch focus within the group, apply chip damage */}
      {groupMembers.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {groupMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => (targetMode ? onApplyDamage(m.id) : onFocus(m.id))}
              aria-label={
                targetMode ? `Appliquer les dégâts à ${memberLabel(m)}` : `Voir ${memberLabel(m)}`
              }
              className={`relative flex min-h-[44px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                m.id === combatant.id
                  ? 'border-ink-500 bg-parchment-100 font-semibold'
                  : 'border-parchment-200 bg-parchment-50 hover:bg-parchment-100'
              } ${m.defeated ? 'opacity-55' : ''} ${targetMode ? 'combat-target' : ''}`}
            >
              <span className={m.defeated ? 'line-through' : ''}>{memberLabel(m)}</span>
              {hpVisible(m) && (
                <span className="font-mono text-[11px] text-ink-500">
                  {m.hitPoints}/{m.maxHitPoints}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Life — the biggest measure on the stage */}
      <div className="mt-4">
        {hp ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-ink-400" aria-hidden="true">
              ❤
            </span>
            <HpBar
              current={combatant.hitPoints ?? 0}
              max={combatant.maxHitPoints ?? 1}
              size="md"
              showText
              className="flex-1"
            />
          </div>
        ) : feelingPhrase(combatant) ? (
          // Redacted monster HP reads as a vague table call, never a gauge
          <p className="flex items-center gap-2 text-sm italic text-ink-500">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${feelingDot(combatant)}`}
            />
            {feelingPhrase(combatant)}
          </p>
        ) : null}
      </div>

      {/* Conditions */}
      {combatant.conditions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {combatant.conditions.map((cond) => (
            <span
              key={cond.name}
              className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700"
              title={
                cond.duration == null
                  ? "Jusqu'à dissipation"
                  : `${cond.duration} tour(s) restant(s)`
              }
            >
              {cond.name}
              {cond.duration != null && <span className="ml-1 font-mono">{cond.duration}t</span>}
            </span>
          ))}
        </div>
      )}

      {/* Initiative entry — GM for anyone, player for their own. Also mid-fight:
          a PJ added after the start arrives without initiative and must still
          be able to enter it (the incumbent rows allowed the same). */}
      {(status === 'setup' || combatant.initiative === null) && (isGM || canSetInitiative) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-parchment-200 bg-parchment-50 p-2.5">
          <label
            className="text-sm font-medium text-ink-600"
            htmlFor={`stage-init-${combatant.id}`}
          >
            Initiative
          </label>
          <input
            id={`stage-init-${combatant.id}`}
            type="number"
            value={initInput}
            onChange={(e) => setInitInput(e.target.value)}
            onBlur={submitInitiative}
            onKeyDown={(e) => e.key === 'Enter' && submitInitiative()}
            placeholder="—"
            className="input input-compact w-20 text-center"
            title="Saisir l'initiative"
          />
          {isGM && (
            <button
              type="button"
              onClick={() => onSetInitiative(combatant.id, rollD20(combatant.initiativeBonus))}
              className="btn-secondary text-sm"
              title="Lancer l'initiative (d20 + DEX)"
            >
              🎲 Lancer
            </button>
          )}
          <span className="text-xs text-ink-400">
            {groupMembers.length > 1
              ? 'Partagée par tout le groupe'
              : `Bonus DEX ${signedBonus(combatant.initiativeBonus)}`}
          </span>
        </div>
      )}

      {/* GM actions — combat-sized verbs */}
      {isGM && (
        <div
          className={`mt-4 grid grid-cols-2 gap-2 ${combatant.monsterSlug ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
        >
          <button
            type="button"
            onClick={() => setShowDamage(true)}
            className="btn-secondary flex items-center justify-center gap-1 py-3 text-sm"
            title="Dégâts / soins / PV"
          >
            ⚔ <span>Dégâts</span>
          </button>
          {!combatant.defeated && (
            <button
              type="button"
              onClick={() => setShowConditions(true)}
              className="btn-secondary flex items-center justify-center gap-1 py-3 text-sm"
              title="Conditions"
            >
              ✎ <span>Cond.</span>
            </button>
          )}
          {combatant.monsterSlug && (
            <button
              type="button"
              onClick={() => onOpenStatBlock?.(combatant.monsterSlug!)}
              className="btn-secondary flex items-center justify-center gap-1 py-3 text-sm"
              title="Bloc de stats"
            >
              📜 <span>Stats</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowColor(true)}
            className="btn-secondary flex items-center justify-center gap-1 py-3 text-sm"
            title="Marque de couleur (relier l'écran aux figurines)"
          >
            🎨 <span>Marque</span>
          </button>
        </div>
      )}

      {/* GM remove */}
      {isGM && (
        <div className="mt-3 text-right">
          <ConfirmButton
            onConfirm={() => onDelete(combatant.id)}
            className="text-xs text-ink-400 hover:text-red-600"
            armedClassName="font-semibold text-red-700"
            title={groupMembers.length > 1 ? 'Supprimer le groupe' : 'Retirer du combat'}
            ariaLabel={`Retirer ${label}${groupMembers.length > 1 ? ' et son groupe' : ''} du combat`}
            confirmChildren="Sûr ?"
          >
            {groupMembers.length > 1 ? 'Retirer le groupe' : 'Retirer du combat'}
          </ConfirmButton>
        </div>
      )}

      {footer}

      {/* Damage / heal sheet */}
      <DamageSheet
        open={showDamage}
        onClose={() => setShowDamage(false)}
        combatant={combatant}
        label={label}
        onPatch={onPatch}
      />

      {/* Conditions editor */}
      <ConditionsEditor
        open={showConditions}
        onClose={() => setShowConditions(false)}
        conditions={combatant.conditions}
        onSave={(conds) => onPatch(combatant.id, { conditions: conds })}
        combatantName={label}
      />

      {/* Color mark picker */}
      <BottomSheet
        open={showColor}
        onClose={() => setShowColor(false)}
        title="Marque de couleur"
        size="md"
        mobileOnly={false}
      >
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {CARD_COLORS.map((color) => {
            const isSelected = combatant.cardColor === color;
            return (
              <button
                type="button"
                key={color ?? 'default'}
                onClick={() => {
                  onPatch(combatant.id, { cardColor: color });
                  setShowColor(false);
                }}
                className={`h-12 rounded-lg border-2 transition-all ${
                  isSelected
                    ? 'border-blood-600 ring-2 ring-blood-300'
                    : 'border-parchment-200 hover:border-parchment-300'
                } ${color === null ? 'bg-white' : ''}`}
                style={color ? { backgroundColor: color } : undefined}
                title={color === null ? 'Par défaut' : color}
                aria-label={
                  color === null
                    ? 'Marque par défaut'
                    : `Marque ${CARD_COLOR_NAMES[color] ?? 'de couleur'}`
                }
              >
                {color === null && <span className="text-xs text-ink-400">Défaut</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-400">
          La marque apparaît sur le combattant dans l'échelle d'initiative — même couleur que la
          figurine sur la table.
        </p>
      </BottomSheet>
    </article>
  );
}

// ---------- Damage / heal sheet (GM) ----------

function DamageSheet({
  open,
  onClose,
  combatant,
  label,
  onPatch,
}: {
  open: boolean;
  onClose: () => void;
  combatant: Combatant;
  label: string;
  onPatch: (id: number, patch: Partial<Combatant>) => void;
}) {
  const [damageInput, setDamageInput] = useState('');
  const [editHp, setEditHp] = useState('');
  const [editMaxHp, setEditMaxHp] = useState('');

  const applyDamage = (multiplier: number) => {
    const val = parseInt(damageInput, 10);
    if (Number.isNaN(val) || val <= 0) return;
    const max = combatant.maxHitPoints ?? 0;
    const cur = combatant.hitPoints ?? 0;
    const delta = Math.floor(val * multiplier);
    const newHp = Math.max(0, Math.min(max, cur - delta));
    onPatch(combatant.id, { hitPoints: newHp });
    setDamageInput('');
    onClose();
  };

  const applyHeal = () => {
    const val = parseInt(damageInput, 10);
    if (Number.isNaN(val) || val <= 0) return;
    const max = combatant.maxHitPoints ?? 0;
    const cur = combatant.hitPoints ?? 0;
    const newHp = Math.max(0, Math.min(max, cur + val));
    // Auto-revive when healing a defeated creature above 0 HP
    const patch: Partial<Combatant> = { hitPoints: newHp };
    if (newHp > 0 && combatant.defeated) patch.defeated = false;
    onPatch(combatant.id, patch);
    setDamageInput('');
    onClose();
  };

  /** Apply direct HP/max HP edit. Revives if HP > 0 and was defeated. */
  const applyDirectHp = () => {
    const patch: Partial<Combatant> = {};
    if (editMaxHp.trim() !== '') {
      patch.maxHitPoints = Math.max(1, parseInt(editMaxHp, 10));
    }
    if (editHp.trim() !== '') {
      const max = patch.maxHitPoints ?? combatant.maxHitPoints ?? 1;
      const hp = Math.max(0, Math.min(max, parseInt(editHp, 10)));
      patch.hitPoints = hp;
      // Auto-revive if HP > 0
      if (hp > 0 && combatant.defeated) patch.defeated = false;
      // Auto-defeat if HP = 0
      if (hp === 0) patch.defeated = true;
    }
    if (Object.keys(patch).length === 0) return;
    onPatch(combatant.id, patch);
    setEditHp('');
    setEditMaxHp('');
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={label} mobileOnly={false} size="md">
      {combatant.hitPoints !== null && (
        <p className="mb-3 text-center font-mono text-lg font-semibold text-ink-700">
          {combatant.hitPoints}/{combatant.maxHitPoints} PV
        </p>
      )}
      <input
        type="number"
        value={damageInput}
        onChange={(e) => setDamageInput(e.target.value)}
        placeholder="Montant"
        aria-label="Montant (dégâts ou soins)"
        className="input mb-3 w-full text-center text-lg"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => applyDamage(1)}
          className="btn-secondary bg-red-100 py-3 text-sm text-red-700 hover:bg-red-200"
        >
          ⚔ Dégâts
        </button>
        <button
          type="button"
          onClick={() => applyDamage(0.5)}
          className="btn-secondary bg-orange-100 py-3 text-sm text-orange-700 hover:bg-orange-200"
          title="Résistance : demi-dégâts"
        >
          🛡 Résist
        </button>
        <button
          type="button"
          onClick={applyHeal}
          className="btn-secondary bg-green-100 py-3 text-sm text-green-700 hover:bg-green-200"
        >
          ❤ Soins
        </button>
        <button
          type="button"
          onClick={() => {
            onPatch(combatant.id, { defeated: !combatant.defeated });
            onClose();
          }}
          className="btn-secondary py-3 text-sm"
        >
          {combatant.defeated ? '✨ Réanimer' : '💀 Vaincu'}
        </button>
      </div>

      {/* Direct HP / Max HP edit */}
      <div className="mt-3 border-t border-parchment-200 pt-3">
        <p className="mb-2 text-xs text-ink-400">Modification directe</p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-ink-500" htmlFor={`hp-edit-${combatant.id}`}>
              PV actuels
            </label>
            <input
              id={`hp-edit-${combatant.id}`}
              type="number"
              value={editHp}
              onChange={(e) => setEditHp(e.target.value)}
              placeholder={combatant.hitPoints !== null ? String(combatant.hitPoints) : '—'}
              className="input w-full text-center text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-ink-500" htmlFor={`hp-max-${combatant.id}`}>
              PV max
            </label>
            <input
              id={`hp-max-${combatant.id}`}
              type="number"
              value={editMaxHp}
              onChange={(e) => setEditMaxHp(e.target.value)}
              placeholder={combatant.maxHitPoints !== null ? String(combatant.maxHitPoints) : '—'}
              className="input w-full text-center text-sm"
            />
          </div>
          <button
            type="button"
            onClick={applyDirectHp}
            disabled={editHp.trim() === '' && editMaxHp.trim() === ''}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-40"
          >
            OK
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
