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
import { useTranslation } from 'react-i18next';
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
import { formatCreated, toRoman } from '../utils';

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

function conditionsTitle(conditions: Combatant['conditions'], t: (key: string) => string): string {
  return conditions
    .map((c) => (c.duration == null ? c.name : `${c.name} (${c.duration} ${t('combat.tour.s')})`))
    .join(', ');
}

/** SQLite HP visibility: non-GM viewers get null HP/AC for combatants they don't own. */
function hpVisible(c: Combatant): boolean {
  return c.hitPoints !== null && c.maxHitPoints !== null;
}

// ---------- Apparent health (monsters, redacted views) ----------
// The tier comes from the server (stable jitter on its boundaries); the wording
// varies per monster so the field reads like a table call, not a gauge.

// Phrases indexées par palier d'état apparent — clés i18n, traduites au rendu.
const FEELING_PHRASES: string[][] = [
  [
    'combat.etat.a.l.agonie',
    'combat.etat.au.bord.de.l.effondrement',
    'combat.etat.il.tient.a.peine.debout',
  ],
  ['combat.etat.gravement.blesse', 'combat.etat.il.chancelle', 'combat.etat.couvert.de.sang'],
  ['combat.etat.blesse', 'combat.etat.touche', 'combat.etat.en.difficulte'],
  ['combat.etat.en.pleine.forme', 'combat.etat.frais.et.dispos', 'combat.etat.a.peine.egratigne'],
];
const FEELING_DOTS = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];

/** Stable word choice per monster + tier — no flicker between polls. */
function feelingPhraseKey(c: Combatant): string | null {
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
  const { t } = useTranslation();
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: dep narrowed to myCharacter?.id so the memoized action object keeps a stable identity across party refreshes; t rides along for language switches.
  const sheetAction = useMemo(
    () =>
      myCharacter && partyId
        ? {
            label: t('desc.ma.fiche'),
            short: '🧙',
            to: `/party/${partyId}/character/${myCharacter.id}`,
          }
        : null,
    [myCharacter?.id, partyId, t],
  );
  useHeaderOverride(
    activeEncounter ? activeEncounter.name : t('combat.combat'),
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
        setError(err.response?.data?.error || t('combat.erreur'));
      } finally {
        setLoading(false);
      }
    },
    [partyId, t],
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

  const loadEncounter = useCallback(
    async (id: number, silent = false) => {
      try {
        const res = await api.get(`/api/encounters/${id}`);
        setActiveEncounter(res.data.encounter);
      } catch {
        // Silent refreshes keep the stale view; a failed explicit open must say so.
        if (!silent) setError(t('combat.impossible.de.charger.la.rencontre'));
      }
    },
    [t],
  );

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
      setError(err.response?.data?.error || t('combat.erreur'));
    }
  };

  const patchEncounter = async (patch: Partial<EncounterDetail>) => {
    if (!activeEncounter) return;
    try {
      await api.patch(`/api/encounters/${activeEncounter.id}`, patch);
      // Response omits combatants — reload the full detail.
      await loadEncounter(activeEncounter.id, true);
    } catch (err: any) {
      pushToast(err.response?.data?.error || t('combat.erreur'), 'error');
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
      pushToast(err.response?.data?.error || t('combat.erreur'), 'error');
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
      pushToast(t('combat.le.tour.a.deja.change'), 'error');
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
      pushToast(err.response?.data?.error || t('combat.erreur'), 'error');
    } finally {
      setRollingInit(false);
    }
  };

  const addMonster = async (slug: string, count: number, name: string, nameHidden: boolean) => {
    if (!activeEncounter) return;
    try {
      await api.post(`/api/encounters/${activeEncounter.id}/combatants/monster`, {
        monsterSlug: slug,
        count,
        name,
        nameHidden,
      });
      await loadEncounter(activeEncounter.id);
    } catch (err: any) {
      setError(err.response?.data?.error || t('combat.erreur'));
    }
  };

  const addPlayers = async (characterIds: number[]) => {
    if (!activeEncounter || characterIds.length === 0) return;
    try {
      await api.post(`/api/encounters/${activeEncounter.id}/combatants/player`, { characterIds });
      await loadEncounter(activeEncounter.id);
      setShowAddPlayer(false);
    } catch (err: any) {
      setError(err.response?.data?.error || t('combat.erreur'));
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
      pushToast(err.response?.data?.error || t('combat.echec.de.la.mise.a.jour'), 'error');
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
      setError(err.response?.data?.error || t('combat.erreur'));
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
      setError(err.response?.data?.error || t('combat.erreur'));
    }
  };

  const deleteEncounter = async (id: number) => {
    try {
      await api.delete(`/api/encounters/${id}`);
      if (activeEncounter?.id === id) setActiveEncounter(null);
      await load(true);
    } catch (err: any) {
      pushToast(err.response?.data?.error || t('combat.erreur'), 'error');
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

  if (loading) return <LoadingSpinner label={t('combat.ouverture.du.registre')} />;
  if (error && !party) return <ErrorMsg message={error} />;
  if (!party) return <ErrorMsg message={t('combat.groupe.introuvable')} />;

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
                {t('combat.bloc.de.stats')}
                <p className="mt-1 text-xs">{t('combat.touchez.sur.un.monstre.pour.l')}</p>
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
        title={t('combat.nouvelle.rencontre')}
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
  const { t } = useTranslation();
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
          {t('combat.nom.de.la.rencontre')}
        </label>
        <input
          id="new-encounter-name"
          autoFocus={autoFocus}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('combat.ex.embuscade.gobeline')}
          className="input w-full"
        />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={!name.trim()}>
        {t('combat.creer.la.rencontre')}
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
  const { t } = useTranslation();
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
          <h1 className="font-display text-2xl font-bold sm:text-3xl">{t('combat.rencontres')}</h1>
          <p className="mt-1.5 text-ink-500">{t('combat.le.registre.des.combats.du.groupe')}</p>
        </header>

        <div aria-hidden="true">
          <div className="border-t-2 border-parchment-400" />
          <div className="mt-[3px] border-t border-parchment-300" />
        </div>

        {isGM ? (
          <section className="mx-auto max-w-md py-8">
            <h2 className="section-title">{t('combat.ouvrir.la.premiere.rencontre')}</h2>
            <p className="mt-1 text-sm text-ink-400">{t('combat.chaque.combat.a.sa.page.nomme')}</p>
            <NewEncounterForm onCreate={onCreate} autoFocus />
          </section>
        ) : (
          <EmptyState
            icon="⚔"
            title={t('combat.aucune.rencontre')}
            hint={t('combat.le.md.n.a.pas.encore.ouvert')}
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
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{t('combat.rencontres')}</h1>
        <p className="mt-1.5 text-sm text-ink-400">
          {t('combat.au.registre', { count: encounters.length })}
          {live.length > 0 && ` — ${t('combat.registre.en.cours', { count: live.length })}`}
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
                  isLive
                    ? t('combat.reprendre.la.rencontre.enc.name', { enc_name: enc.name })
                    : t('combat.ouvrir.la.rencontre.enc.name', { enc_name: enc.name })
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
                          {t('combat.tour', { round: enc.round })}
                        </span>
                      )}
                    </span>
                    {isLive && (
                      <span className="mt-1.5 block text-sm text-ink-500">
                        {t('combat.registre.en.cours.ligne', { count: enc.combatantCount })}
                      </span>
                    )}
                    {!isLive && !isDone && (
                      <span className="mt-0.5 block text-sm text-ink-400">
                        {t('combat.registre.preparation.ligne', { count: enc.combatantCount })}
                      </span>
                    )}
                    {isDone && (
                      <span className="mt-0.5 block text-sm text-ink-400">
                        {t('combat.terminee.tour.created', {
                          round: enc.round,
                          created: formatCreated(enc.createdAt, t('combat.creee')),
                        })}
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
                    title={t('combat.supprimer.la.rencontre')}
                    ariaLabel={t('combat.supprimer.la.rencontre.enc.name', { enc_name: enc.name })}
                    confirmChildren={t('combat.confirmer')}
                  >
                    {t('combat.supprimer')}
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
            {t('combat.nouvelle.rencontre')}
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
  const { t } = useTranslation();
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
      {t('combat.puis', { name: next.name })}
      {next.groupId !== null &&
        combatants.filter((c) => c.groupId === next.groupId).length > 1 &&
        ` (×${combatants.filter((c) => c.groupId === next.groupId).length})`}
    </span>
  ) : null;
  const stageFooter =
    isGM && status === 'active' ? (
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-parchment-200 pt-4">
        <button type="button" onClick={onNextTurn} className="btn-primary min-h-[44px] text-sm">
          {t('combat.tour.suivant')}
        </button>
        <button type="button" onClick={onEnd} className="btn-secondary min-h-[44px] text-sm">
          {t('combat.fin')}
        </button>
        <button type="button" onClick={onAddMonster} className="btn-secondary min-h-[44px] text-sm">
          {t('combat.monstre')}
        </button>
        {canAddPlayer && (
          <button
            type="button"
            onClick={onAddPlayer}
            className="btn-secondary min-h-[44px] text-sm"
          >
            {t('combat.pj')}
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
          aria-label={t('combat.terminer.mon.tour.passer.au.combattant')}
        >
          {t('combat.j.ai.fini.mon.tour')}
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
      <aside className="sticky top-[calc(var(--app-header-h)+env(safe-area-inset-top)+0.5rem)] z-20 -mx-1 bg-parchment-50/95 px-1 py-1 lg:sticky lg:top-[calc(var(--app-header-h)+env(safe-area-inset-top)+0.75rem)] lg:z-auto lg:mx-0 lg:max-h-[calc(100vh-var(--app-header-h)-env(safe-area-inset-top)-2rem)] lg:overflow-y-auto lg:bg-transparent lg:px-0 lg:py-0">
        <InitiativeRail
          combatants={combatants}
          turnIndex={encounter.turnIndex}
          status={status}
          isGM={isGM}
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
                {needsInitiative
                  ? t('combat.en.attente.d.initiative')
                  : t('combat.pret.a.demarrer')}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {needsInitiative && (
                  <button
                    type="button"
                    onClick={onRollAll}
                    disabled={rollingInit}
                    className="btn-secondary min-h-[44px] text-sm disabled:opacity-40"
                    title={t('combat.lancer.d20.dex.pour.toutes.les')}
                  >
                    {rollingInit ? t('combat.lances') : t('combat.tout.lancer')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onAddMonster}
                  className="btn-secondary min-h-[44px] text-sm"
                >
                  {t('combat.monstre')}
                </button>
                {canAddPlayer && (
                  <button
                    type="button"
                    onClick={onAddPlayer}
                    className="btn-secondary min-h-[44px] text-sm"
                  >
                    {t('combat.pj')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onNextTurn}
                  disabled={startDisabled}
                  className="btn-primary min-h-[44px] text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    needsInitiative
                      ? t('combat.tous.les.combattants.doivent.lancer')
                      : t('combat.demarrer.le.combat.tour.1')
                  }
                >
                  {t('combat.demarrer.le.combat')}
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
                  {t('combat.preparation')}
                </span>
              )}
              {status === 'active' && (
                <span className="rounded-full bg-blood-600 px-2.5 py-1 font-mono text-xs font-semibold text-parchment-50">
                  {t('combat.tour', { round: encounter.round })}
                </span>
              )}
            </div>
            <EmptyState
              icon="🎭"
              title={t('combat.aucun.combattant')}
              hint={
                isGM
                  ? t('combat.ajoute.des.monstres.et.des.personnages')
                  : t('combat.le.md.prepare.la.rencontre')
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
        <aside className="hidden lg:sticky lg:top-[calc(var(--app-header-h)+env(safe-area-inset-top)+0.75rem)] lg:block lg:max-h-[calc(100vh-var(--app-header-h)-env(safe-area-inset-top)-2rem)]">
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
  isGM,
  focusId,
  onFocus,
  targetMode,
  onApplyDamage,
}: {
  combatants: Combatant[];
  turnIndex: number;
  status: EncounterStatus;
  isGM: boolean;
  focusId: number | null;
  onFocus: (id: number | null) => void;
  targetMode: boolean;
  onApplyDamage: (id: number) => void;
}) {
  const { t } = useTranslation();
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
    <nav aria-label={t('combat.ordre.d.initiative')}>
      <h2 className="section-title mb-2 hidden text-base lg:block">{t('combat.initiative')}</h2>
      <ol className="list-none flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
        {combatants.map((c, idx) => {
          const label = labels[idx];
          const isCurrent = isCurrentDetent(c);
          const isFocused = focusId === c.id;
          const hp = hpVisible(c);
          const phraseKey = feelingPhraseKey(c);
          const phrase = phraseKey !== null ? t(phraseKey) : null;
          const ariaParts = [
            label,
            c.initiative === null
              ? t('combat.initiative.non.lancee')
              : t('combat.initiative.n', { n: c.initiative }),
          ];
          if (hp) ariaParts.push(`${c.hitPoints}/${c.maxHitPoints} ${t('combat.pv')}`);
          if (phrase) ariaParts.push(phrase.toLowerCase());
          if (c.conditions.length > 0)
            ariaParts.push(t('combat.compteurs.condition', { count: c.conditions.length }));
          if (c.defeated) ariaParts.push(t('combat.vaincu'));
          if (isCurrent) ariaParts.push(t('combat.tour.en.cours'));
          return (
            <li key={c.id} className="shrink-0 lg:w-full">
              <button
                type="button"
                onClick={() => (targetMode ? onApplyDamage(c.id) : onFocus(c.id))}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={ariaParts.join(', ')}
                className={`relative flex min-h-[52px] w-auto min-w-24 max-w-44 flex-col justify-center gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors lg:w-full lg:max-w-full ${
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
                  {isGM && c.nameHidden && (
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-xs"
                      title={t('combat.nom.masque.aide')}
                    >
                      🙈
                    </span>
                  )}
                  {c.conditions.length > 0 && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 text-[10px] font-semibold ${
                        isCurrent ? 'bg-parchment-50/25' : 'bg-orange-100 text-orange-700'
                      }`}
                      title={conditionsTitle(c.conditions, t)}
                    >
                      {c.conditions.length}
                    </span>
                  )}
                  {phrase && (
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${feelingDot(c)}`}
                      title={t('combat.etat.apparent.phrase', { phrase: phrase })}
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
  const { t } = useTranslation();
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
          title={applyMode ? t('combat.annuler.echap') : t('combat.appliquer.a.une.cible')}
        >
          {t('combat.chip.degats', { n: Math.floor(chip.value * (chip.half ? 0.5 : 1)) })}
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
          title={t('combat.demi.degats.resistance.sauvegarde.reussie')}
        >
          ½
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost min-h-[44px] min-w-[44px] p-2 text-sm text-ink-400 hover:text-ink-700"
          aria-label={t('combat.annuler.la.puce.de.degats')}
        >
          ✕
        </button>
        <span className="ml-auto text-xs text-ink-500">
          {applyMode ? t('combat.touchez.une.cible') : t('combat.touchez.la.puce.puis.une.cible')}
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

/** Color marks — i18n keys announced when picking a swatch. */
const CARD_COLOR_NAMES: Record<string, string> = {
  '#fef3c7': 'combat.couleur.ambre',
  '#dcfce7': 'combat.couleur.vert',
  '#dbeafe': 'combat.couleur.bleu',
  '#fce7f3': 'combat.couleur.rose',
  '#f3e8ff': 'combat.couleur.violet',
  '#fed7aa': 'combat.couleur.orange',
  '#fee2e2': 'combat.couleur.rouge',
  '#e0e7ff': 'combat.couleur.indigo',
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
  const { t } = useTranslation();
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
  // Mask pill tooltip/aria: what players currently see + the reveal action,
  // with the group note when the toggle covers more than this combatant.
  const maskHint =
    (combatant.nameHidden ? t('combat.nom.masque.aide') : t('combat.nom.masquer.aide')) +
    (groupMembers.length > 1 ? t('combat.nom.masque.groupe') : '');

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
                {t('combat.tour', { round: encounter.round })}
              </span>
            )}
            {status === 'setup' && (
              <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-medium text-yellow-700">
                {t('combat.preparation')}
              </span>
            )}
            {status === 'ended' && (
              <span className="rounded-full bg-parchment-200 px-2.5 py-1 text-xs font-medium text-ink-500">
                {t('combat.terminee.tour', { round: encounter.round })}
              </span>
            )}
            {!isCurrentTurn && status === 'active' && (
              <span className="rounded-full bg-parchment-200 px-2 py-0.5 text-[11px] font-medium text-ink-500">
                {t('combat.hors.tour')}
              </span>
            )}
            {combatant.defeated && (
              <span className="text-sm font-medium text-ink-400">{t('combat.mort.vaincu')}</span>
            )}
          </div>
          {/* The name carries its own mask — the toggle sits beside what it
              hides. Ink idiom (printed mark), never blood: not "now", a state. */}
          <h2 className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-display text-2xl font-bold leading-tight sm:text-3xl">
            {sheetPath ? (
              <Link
                to={sheetPath}
                className="hover:text-blood-600 hover:underline"
                title={t('combat.ouvrir.la.fiche.du.personnage')}
              >
                {label}
              </Link>
            ) : (
              label
            )}
            {isGM && combatant.type === 'monster' && (
              <button
                type="button"
                onClick={() => onPatch(combatant.id, { nameHidden: !combatant.nameHidden })}
                aria-pressed={combatant.nameHidden}
                title={maskHint}
                aria-label={maskHint}
                className={
                  combatant.nameHidden
                    ? 'rounded-full bg-ink-100 px-3 py-1.5 font-sans text-xs font-medium text-ink-600 transition-colors hover:bg-ink-300/50'
                    : 'rounded-full border border-parchment-300 px-3 py-1.5 font-sans text-xs font-medium text-ink-400 transition-colors hover:border-ink-300 hover:text-ink-600'
                }
              >
                <span aria-hidden="true">{combatant.nameHidden ? '🙈' : '👁'}</span>{' '}
                {combatant.nameHidden
                  ? t('combat.nom.masque.aux.joueurs')
                  : t('combat.nom.masquer.le.nom')}
              </button>
            )}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="rounded-lg border border-parchment-200 bg-parchment-100 px-2 py-1 font-mono text-sm font-semibold text-ink-700"
            title={t('combat.initiative')}
          >
            {t('combat.init.badge', { value: combatant.initiative ?? '—' })}
          </span>
          {combatant.armorClass !== null && (
            <span
              className="flex items-center gap-1 rounded-lg border border-parchment-200 bg-parchment-100 px-2 py-1 font-mono text-sm font-semibold text-ink-700"
              title={t('combat.classe.d.armure')}
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
                targetMode
                  ? t('combat.appliquer.les.degats.a.label', { label: memberLabel(m) })
                  : t('combat.voir.label', { label: memberLabel(m) })
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
        ) : feelingPhraseKey(combatant) !== null ? (
          // Redacted monster HP reads as a vague table call, never a gauge
          <p className="flex items-center gap-2 text-sm italic text-ink-500">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${feelingDot(combatant)}`}
            />
            {t(feelingPhraseKey(combatant) as string)}
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
                  ? t('combat.jusqu.a.dissipation')
                  : t('combat.tours.restants', { duration: cond.duration })
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
            {t('combat.initiative')}
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
            title={t('combat.saisir.l.initiative')}
          />
          {isGM && (
            <button
              type="button"
              onClick={() => onSetInitiative(combatant.id, rollD20(combatant.initiativeBonus))}
              className="btn-secondary text-sm"
              title={t('combat.lancer.l.initiative.d20.dex')}
            >
              {t('combat.lancer')}
            </button>
          )}
          <span className="text-xs text-ink-400">
            {groupMembers.length > 1
              ? t('combat.partagee.par.tout.le.groupe')
              : t('combat.bonus.dex', { bonus: signedBonus(combatant.initiativeBonus) })}
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
            title={t('combat.degats.soins.pv')}
          >
            {t('combat.degats')}
          </button>
          {!combatant.defeated && (
            <button
              type="button"
              onClick={() => setShowConditions(true)}
              className="btn-secondary flex items-center justify-center gap-1 py-3 text-sm"
              title={t('combat.conditions')}
            >
              ✎ <span>{t('combat.cond')}</span>
            </button>
          )}
          {combatant.monsterSlug && (
            <button
              type="button"
              onClick={() => onOpenStatBlock?.(combatant.monsterSlug!)}
              className="btn-secondary flex items-center justify-center gap-1 py-3 text-sm"
              title={t('combat.bloc.de.stats')}
            >
              📜 <span>{t('combat.stats')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowColor(true)}
            className="btn-secondary flex items-center justify-center gap-1 py-3 text-sm"
            title={t('combat.marque.de.couleur.relier.l.ecran')}
          >
            🎨 <span>{t('combat.marque')}</span>
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
            title={
              groupMembers.length > 1
                ? t('combat.supprimer.le.groupe')
                : t('combat.retirer.du.combat')
            }
            ariaLabel={t('combat.retirer.label.groupmembers.length.1.du', {
              label: label,
              grp: groupMembers.length > 1 ? ` ${t('combat.et.son.groupe')}` : '',
            })}
            confirmChildren={t('combat.sur')}
          >
            {groupMembers.length > 1
              ? t('combat.retirer.le.groupe')
              : t('combat.retirer.du.combat')}
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
        title={t('combat.marque.de.couleur')}
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
                title={color === null ? t('combat.par.defaut') : color}
                aria-label={
                  color === null
                    ? t('combat.marque.par.defaut')
                    : t('combat.marque.couleur', {
                        couleur: t(CARD_COLOR_NAMES[color] ?? 'combat.de.couleur'),
                      })
                }
              >
                {color === null && (
                  <span className="text-xs text-ink-400">{t('combat.defaut')}</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-400">
          {t('combat.la.marque.apparait.sur.le.combattant')}
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
  const { t } = useTranslation();
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
          {combatant.hitPoints}/{combatant.maxHitPoints} {t('combat.pv')}
        </p>
      )}
      <input
        type="number"
        value={damageInput}
        onChange={(e) => setDamageInput(e.target.value)}
        placeholder={t('combat.montant')}
        aria-label={t('combat.montant.degats.ou.soins')}
        className="input mb-3 w-full text-center text-lg"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => applyDamage(1)}
          className="btn-secondary bg-red-100 py-3 text-sm text-red-700 hover:bg-red-200"
        >
          {t('combat.degats')}
        </button>
        <button
          type="button"
          onClick={() => applyDamage(0.5)}
          className="btn-secondary bg-orange-100 py-3 text-sm text-orange-700 hover:bg-orange-200"
          title={t('combat.resistance.demi.degats')}
        >
          {t('combat.resist')}
        </button>
        <button
          type="button"
          onClick={applyHeal}
          className="btn-secondary bg-green-100 py-3 text-sm text-green-700 hover:bg-green-200"
        >
          {t('combat.soins')}
        </button>
        <button
          type="button"
          onClick={() => {
            onPatch(combatant.id, { defeated: !combatant.defeated });
            onClose();
          }}
          className="btn-secondary py-3 text-sm"
        >
          {combatant.defeated ? t('combat.reanimer') : t('combat.mort.vaincu')}
        </button>
      </div>

      {/* Direct HP / Max HP edit */}
      <div className="mt-3 border-t border-parchment-200 pt-3">
        <p className="mb-2 text-xs text-ink-400">{t('combat.modification.directe')}</p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-ink-500" htmlFor={`hp-edit-${combatant.id}`}>
              {t('combat.pv.actuels')}
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
              {t('combat.pv.max')}
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
