/**
 * Bandeau d'état — the player sheet's pinned state masthead.
 *
 * THESIS: la fiche s'ouvre sur l'état, pas sur le sac — PV, CA, tour, sorts et
 *   encombrement restent visibles au-dessus de chaque onglet ; le dock garde
 *   le moment fort du combat (glow + slash), le bandeau reste discret.
 * OWN-WORLD: surface réglée posée à même le parchemin (filets, pas de carte
 *   flottante) ; valeurs mesurées en mono, identité en Cinzel, couleurs de
 *   règle uniquement pour l'état de règle.
 * STORY: le joueur qui lève son téléphone sait en un coup d'œil où il en est —
 *   PV, CA, à qui le tour, initiative attendue, concentration — et agit en un
 *   geste quand c'est son tour.
 * FIRST VIEWPORT: bandeau épinglé sous l'en-tête : identité, phrase d'état
 *   (PV + CA + sorts + états), ligne de combat, encombrement compact.
 * FORM: anatomie d'état persistante sur des onglets réordonnés jeu d'abord
 *   (jet de surface 45afc21e).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, and DESIGN.md.
 */

import {
  abilityModifier,
  type Character,
  type ConcentrationCheck,
  classesOf,
  computeAC,
  computeSpellcastingPools,
  type EncumbranceState,
  fightingStylesOf,
  type InventoryEntry,
} from '@table-sync/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../api';
import { Chip, EncumbranceBar, HpBar } from './ui';

/** Combat snapshot relevant to the band (subset of the page's hubCombat). */
export interface StateBandCombat {
  encounterId: number;
  partyId: number;
  status: string;
  round: number;
  needsInitiative: boolean;
  isMyTurn: boolean;
  currentCombatantName: string | null;
}

type NavigateTarget = 'survival' | 'spells' | 'stats';

interface Props {
  character: Character;
  /** ALL inventory entries (not location-filtered) — AC is whole-character truth. */
  entries: InventoryEntry[];
  encumbrance: EncumbranceState;
  canEdit: boolean;
  combat: StateBandCombat | null;
  /** Deep link to the encounter (desktop initiative path). */
  combatHref: string | null;
  onNavigate: (tab: NavigateTarget) => void;
  /** Mobile: expand the dock card's inline initiative input. */
  onOpenInitiative: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  /** Damage while concentrating — the page surfaces the CON-save popup. */
  onConcentrationCheck: (check: ConcentrationCheck) => void;
}

export default function CharacterStateBand({
  character,
  entries,
  encumbrance,
  canEdit,
  combat,
  combatHref,
  onNavigate,
  onOpenInitiative,
  onSaved,
  onError,
  onNotice,
  onConcentrationCheck,
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Inline name editing (moved from the old header card)
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // HP quick-edit draft (steppers commit directly)
  const [hpDraft, setHpDraft] = useState<string | null>(null);
  // Rapid stepper clicks coalesce into ONE patch so the concentration check
  // sees the total damage (DD = max(10, ½ dégâts totaux)), not per-click bits.
  // Damage eats temp HP first — the queued patch may carry both fields.
  const [hpPending, setHpPending] = useState<number | null>(null);
  const [tempPending, setTempPending] = useState<number | null>(null);
  const hpPendingRef = useRef<number | null>(null);
  const tempPendingRef = useRef<number | null>(null);
  const hpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pinned twin: when the static band scrolls out from under the app header,
  // a compact fixed overlay takes over. The in-flow band NEVER changes height
  // on scroll — a shrinking in-flow band fights the browser's scroll anchoring
  // (the height delta pulls scrollY back below the collapse threshold and the
  // page oscillates, trapping the scroll).
  const [pinned, setPinned] = useState(false);
  const bandEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bandEndRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setPinned(!entry.isIntersecting), {
      rootMargin: '-64px 0px 0px 0px', // below the 56px app header, one breath
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const level = character.level ?? 1;

  // CA — same computation as the Caractéristiques tab
  const dexMod = abilityModifier(character.dexterity ?? 10);
  const acResult = computeAC(
    entries,
    dexMod,
    fightingStylesOf(character).has('defense'),
    character,
  );
  const effectiveAC = character.armorClassOverride ?? acResult.ac;

  // Emplacements : les DEUX pools (multiclassage — le pacte recharge au repos
  // court et vit sa vie à côté de l'incantation).
  const pools = computeSpellcastingPools(character);
  const slotsUsed = character.spellSlotsUsed ?? [];
  const pactUsed = character.pactSlotsUsed ?? [];
  const slotRows = pools.spellcasting
    .map((max, i) => ({
      level: i + 1,
      max,
      left: Math.max(0, max - (slotsUsed[i] ?? 0)),
      pact: false,
    }))
    .filter((s) => s.max > 0);
  const pactRows = pools.pact
    .map((max, i) => ({
      level: i + 1,
      max,
      left: Math.max(0, max - (pactUsed[i] ?? 0)),
      pact: true,
    }))
    .filter((s) => s.max > 0);
  const allSlotRows = [...slotRows, ...pactRows];
  const slotsLeft = allSlotRows.reduce((s, r) => s + r.left, 0);
  const slotsTotal = allSlotRows.reduce((s, r) => s + r.max, 0);
  const isCaster = slotsTotal > 0;

  // Wild shape: the bar shows the shape's HP; real HP rides beside as a chip
  const shaped =
    !!character.wildShapeSlug &&
    (character.wildShapeMaxHp ?? 0) > 0 &&
    character.wildShapeHp !== null;
  const hpNow = shaped ? (character.wildShapeHp ?? 0) : character.currentHp;
  const hpMax = shaped ? (character.wildShapeMaxHp ?? 1) : character.maxHp;
  /** Optimistic display value — the queued edit wins until the server catches up. */
  const displayHp = hpPending ?? hpNow;
  /** Same optimism for temp HP (queued absorption during damage bursts). */
  const displayTemp = shaped ? 0 : (tempPending ?? character.tempHp ?? 0);

  const conditions = character.conditions ?? [];
  const exhaustion = character.exhaustion ?? 0;
  const stateCount =
    conditions.length +
    (exhaustion > 0 ? 1 : 0) +
    (character.foodDays > 0 ? 1 : 0) +
    (character.waterDays > 0 ? 1 : 0);

  const commitName = async () => {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!trimmed || trimmed === character.name) return;
    try {
      await api.patch(`/api/characters/${character.id}`, { name: trimmed });
      onNotice(t('band.nom.mis.a.jour'));
      await onSaved();
    } catch {
      onError(t('band.erreur.de.mise.a.jour'));
    }
  };

  // While shaped the server routes currentHp to the shape's bar — one endpoint,
  // two truths. Typed values obey the max (same ceiling as the Survie tracker).
  // `temp` rides the same request when damage spilled past the temp HP.
  const patchHp = async (n: number, temp?: number) => {
    setHpDraft(null);
    const clamped = Math.max(0, Math.min(hpMax, Math.round(n)));
    if (clamped === hpNow && temp === undefined) {
      setHpPending(null);
      setTempPending(null);
      return;
    }
    try {
      const payload =
        temp === undefined ? { currentHp: clamped } : { currentHp: clamped, tempHp: temp };
      const res = await api.patch(`/api/characters/${character.id}`, payload);
      // Losing HP while concentrating requires a CON save — surface it immediately.
      if (res?.data?.concentrationCheck) onConcentrationCheck(res.data.concentrationCheck);
      if (res?.data?.concentrationBroken) {
        onNotice(
          `🌀 Concentration rompue : ${res.data.concentrationBroken} — le sort en cours est interrompu`,
        );
      }
      await onSaved();
    } catch {
      onError(t('band.erreur.de.mise.a.jour'));
    } finally {
      setHpPending(null);
      setTempPending(null);
    }
  };

  // Debounce window for stepper clicks: every click inside it joins the same
  // damage event. One patch → one concentration check on the total.
  const HP_DEBOUNCE_MS = 700;

  const flushHp = () => {
    if (hpTimerRef.current) {
      clearTimeout(hpTimerRef.current);
      hpTimerRef.current = null;
    }
    const target = hpPendingRef.current;
    const temp = tempPendingRef.current;
    hpPendingRef.current = null;
    tempPendingRef.current = null;
    if (target === null) return;
    void patchHp(target, temp ?? undefined);
  };

  const queueHp = (target: number, temp?: number) => {
    const clamped = Math.max(0, Math.min(hpMax, Math.round(target)));
    hpPendingRef.current = clamped;
    setHpPending(clamped);
    if (temp !== undefined) {
      tempPendingRef.current = Math.max(0, Math.round(temp));
      setTempPending(tempPendingRef.current);
    }
    if (hpTimerRef.current) clearTimeout(hpTimerRef.current);
    hpTimerRef.current = setTimeout(() => {
      hpTimerRef.current = null;
      flushHp();
    }, HP_DEBOUNCE_MS);
  };

  // Damage from the band eats temp HP first (SRD), mirroring the Survie tab's
  // hero: the absorbed part rides the same queued patch as the real loss.
  const damageHp = (amount: number) => {
    const temp = shaped ? 0 : (character.tempHp ?? 0);
    // During a click burst, keep absorbing from the already-queued temp value.
    const tempNow = hpTimerRef.current ? (tempPendingRef.current ?? temp) : temp;
    const absorbed = Math.min(tempNow, amount);
    queueHp((hpPending ?? hpNow) - (amount - absorbed), tempNow - absorbed);
  };

  // Explicit commit (typed value) sends immediately, carrying any queued total.
  // An emptied box rolls back instead — Number('') is 0, which would drop the
  // character to 0 PV on an accidental clear.
  const commitHpDraft = () => {
    if (hpDraft === null) return;
    const val = Number(hpDraft);
    setHpDraft(null);
    if (hpDraft.trim() !== '' && Number.isFinite(val)) {
      queueHp(val);
      flushHp();
    }
  };

  // A pending edit must never be lost to navigation — flush it on unmount
  // through the latest patchHp closure.
  const patchHpRef = useRef(patchHp);
  useEffect(() => {
    patchHpRef.current = patchHp;
  });
  useEffect(
    () => () => {
      if (hpTimerRef.current) clearTimeout(hpTimerRef.current);
      const target = hpPendingRef.current;
      const temp = tempPendingRef.current;
      hpPendingRef.current = null;
      tempPendingRef.current = null;
      if (target !== null) void patchHpRef.current(target, temp ?? undefined);
    },
    [],
  );

  const hpInputId = `band-hp-${character.id}`;

  return (
    <>
      <section
        aria-label={t('band.etat.du.personnage')}
        className="-mx-4 px-4 sm:mx-0 sm:px-0 border-b border-parchment-200"
      >
        <div className="py-2 sm:py-2.5 space-y-1.5">
          {/* Identity + vitals — one line on desktop, stacked on mobile */}
          <div className="lg:flex lg:items-center lg:gap-5">
            <div className="flex items-center gap-2 min-w-0 lg:flex-1">
              {character.portraitUrl && (
                <img
                  src={character.portraitUrl}
                  alt=""
                  className="rounded-full object-cover border-2 border-parchment-300 shrink-0 w-9 h-9"
                />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-lg sm:text-xl font-bold truncate flex items-center gap-2">
                  {editingName ? (
                    <input
                      type="text"
                      className="font-display text-lg font-bold bg-transparent border-b-2 border-blood-500 outline-none min-w-0 flex-1"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={commitName}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingName(false);
                      }}
                      autoFocus
                      aria-label={t('band.nom.du.personnage')}
                    />
                  ) : canEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNameDraft(character.name);
                        setEditingName(true);
                      }}
                      className="hover:text-blood-600 transition-colors truncate"
                      title={t('band.cliquer.pour.renommer')}
                    >
                      {character.name}
                    </button>
                  ) : (
                    <span className="truncate">{character.name}</span>
                  )}
                </h1>
                <p className="text-xs text-ink-500 truncate flex items-center gap-1.5">
                  <span>
                    {classesOf(character).length > 1
                      ? `${classesOf(character)
                          .map((c) => `${c.classKey} ${c.level}`)
                          .join(' / ')}`
                      : `${character.characterClass ?? '—'} · Niv ${level}`}
                    {character.race ? ` · ${character.race}` : ''}
                  </span>
                  {character.concentrating && (
                    <button
                      type="button"
                      onClick={() => onNavigate('survival')}
                      className="shrink-0 hover:scale-110 transition-transform"
                      aria-label={t('band.en.concentration.ouvrir.la.survie')}
                      title={t('band.concentration.en.cours')}
                    >
                      🌀
                    </button>
                  )}
                  {character.inspiration && (
                    <span
                      className="shrink-0"
                      title={t('band.inspiration')}
                      aria-label={t('band.inspiration.acquise')}
                      role="img"
                    >
                      ✨
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Vitals sentence */}
            <div className="flex items-center gap-1.5 mt-1 lg:mt-0 lg:justify-end">
              <span
                className="flex-1 min-w-0 lg:w-56 lg:flex-none"
                title={
                  shaped
                    ? `PV de la forme animale — PV réels : ${character.currentHp}/${character.maxHp}`
                    : `Points de vie : ${displayHp}/${hpMax}${displayTemp > 0 ? ` (+${displayTemp} temporaires)` : ''}`
                }
              >
                <HpBar current={displayHp} max={hpMax} temp={displayTemp} size="sm" showText />
              </span>
              {displayTemp > 0 && (
                <Chip tone="blue" title="PV temporaires">
                  +{displayTemp}
                </Chip>
              )}
              {shaped && (
                <Chip
                  tone="green"
                  title={t('band.pv.reels.du.personnage.character.currenthp', {
                    character_currentHp: character.currentHp,
                    character_maxHp: character.maxHp,
                  })}
                >
                  🐺 {character.currentHp}
                </Chip>
              )}
              {character.currentHp <= 0 && (character.tempHp ?? 0) <= 0 && (
                <Chip tone="red" title={t('band.0.pv.jets.de.sauvegarde.contre')}>
                  {t('band.a.terre')}
                </Chip>
              )}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => onNavigate('stats')}
                  className="font-mono text-sm font-semibold text-ink-800 bg-parchment-100 border border-parchment-200 rounded-md px-2 py-1 hover:border-blood-400 transition-colors"
                  title={character.armorClassOverride ? 'CA manuelle' : acResult.source}
                  aria-label={t('band.classe.d.armure.effectiveac.ouvrir.les', {
                    effectiveAC: effectiveAC,
                  })}
                >
                  🛡 {effectiveAC}
                </button>
              ) : (
                <span
                  className="font-mono text-sm font-semibold text-ink-800 bg-parchment-100 border border-parchment-200 rounded-md px-2 py-1"
                  title={character.armorClassOverride ? 'CA manuelle' : acResult.source}
                >
                  🛡 {effectiveAC}
                </span>
              )}
              {slotsTotal > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('spells')}
                  className="font-mono text-sm font-semibold text-gold-700 bg-gold-100/70 border border-gold-300 rounded-md px-2 py-1 hover:border-gold-500 transition-colors"
                  title={t('band.slotsleft.emplacements.de.sort.disponibles.sur', {
                    slotsLeft: slotsLeft,
                    slotsTotal: slotsTotal,
                  })}
                  aria-label={t('band.slotsleft.emplacements.de.sort.sur.slotstotal', {
                    slotsLeft: slotsLeft,
                    slotsTotal: slotsTotal,
                  })}
                >
                  ✨ {slotsLeft}/{slotsTotal}
                </button>
              )}
              {stateCount > 0 && (
                <Chip tone="amber">
                  ⚠ {stateCount} état{stateCount > 1 ? 's' : ''}
                </Chip>
              )}
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="shrink-0 w-8 h-8 rounded-lg text-ink-500 hover:bg-parchment-100 transition-colors flex items-center justify-center"
                aria-expanded={expanded}
                aria-label={t('band.details.de.l.etat.du.personnage')}
              >
                {expanded ? '⌃' : '⌄'}
              </button>
            </div>
          </div>

          {/* Combat line — the static copy is the live region (status changes
            announce themselves); the pinned twin stays silent to avoid double
            announcements. */}
          <CombatLine
            combat={combat}
            combatHref={combatHref}
            onNavigate={onNavigate}
            onOpenInitiative={onOpenInitiative}
            isCaster={isCaster}
            live
          />

          {/* Encumbrance — the derived display; its multiplier input lives in
            the Caractéristiques tab (Statistiques dérivées). Consequences
            appear only when a tier is breached. */}
          <EncumbranceBar encumbrance={encumbrance} compact />

          {/* Expanded detail: states, slots, quick HP edit */}
          {expanded && (
            <div className="border-t border-parchment-200 pt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {conditions.length === 0 && exhaustion === 0 && stateCount === 0 && (
                  <span className="text-xs text-ink-500">{t('band.aucun.etat.actif')}</span>
                )}
                {conditions.map((c) => (
                  <Chip key={c} tone="amber">
                    {c}
                  </Chip>
                ))}
                {exhaustion > 0 && (
                  <Chip tone="red" title={t('band.epuisement.malus.cumules.onglet.survie')}>
                    Épuisement {exhaustion}
                  </Chip>
                )}
                {character.foodDays > 0 && (
                  <Chip tone="amber" title="Jours sans nourriture (onglet Survie)">
                    🍽 {character.foodDays} j sans nourriture
                  </Chip>
                )}
                {character.waterDays > 0 && (
                  <Chip tone="red" title="Jours sans eau (onglet Survie)">
                    💧 {character.waterDays} j sans eau
                  </Chip>
                )}
                {character.inspiration && <Chip tone="gold">{t('band.inspiration')}</Chip>}
                {canEdit && stateCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onNavigate('survival')}
                    className="btn-ghost text-xs px-2 py-1"
                  >
                    {t('band.gerer.les.etats')}
                  </button>
                )}
              </div>
              {slotRows.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-ink-600">Emplacements :</span>
                  {allSlotRows.map((r) => (
                    <span
                      key={r.pact ? `p${r.level}` : `s${r.level}`}
                      className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                        r.pact
                          ? 'bg-gold-100 border-gold-300 text-gold-700'
                          : 'bg-parchment-100 border-parchment-200 text-ink-600'
                      }`}
                      title={t('band.r.pact.magie.de.pacte.niveau', {
                        r_pact____Magie_de_pacte: r.pact ? 'Magie de pacte' : 'Incantation',
                        r_level: r.level,
                        r_left: r.left,
                        r_max: r.max,
                      })}
                    >
                      {r.pact ? '☾' : 'N'}
                      {r.level} {r.left}/{r.max}
                    </span>
                  ))}
                </div>
              )}
              {canEdit && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor={hpInputId} className="text-xs font-medium text-ink-600 shrink-0">
                    {shaped ? 'PV (forme)' : 'PV'}
                  </label>
                  <button
                    type="button"
                    onClick={() => damageHp(5)}
                    className="w-11 h-11 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold flex items-center justify-center transition-colors"
                    aria-label={t('band.blesser.de.5')}
                  >
                    −5
                  </button>
                  <button
                    type="button"
                    onClick={() => damageHp(1)}
                    className="w-11 h-11 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold flex items-center justify-center transition-colors"
                    aria-label={t('band.blesser.de.1')}
                  >
                    −1
                  </button>
                  <input
                    id={hpInputId}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={hpMax}
                    className="input input-compact font-mono w-16 text-center"
                    value={hpDraft ?? String(displayHp)}
                    onChange={(e) => setHpDraft(e.target.value)}
                    onBlur={commitHpDraft}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => queueHp(displayHp + 1)}
                    className="w-11 h-11 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 font-semibold flex items-center justify-center transition-colors"
                    aria-label={t('band.soigner.de.1')}
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => queueHp(displayHp + 5)}
                    className="w-11 h-11 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 font-semibold flex items-center justify-center transition-colors"
                    aria-label={t('band.soigner.de.5')}
                  >
                    +5
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {/* Sentinel watched by the IntersectionObserver above: when it slides
          under the app header, the pinned twin takes over. */}
        <div ref={bandEndRef} aria-hidden="true" />
      </section>

      {/* Pinned twin — compact fixed overlay; the flow above never resizes. */}
      {pinned && (
        <div className="band-drop fixed top-14 inset-x-0 z-20">
          <div className="max-w-6xl mx-auto px-4">
            <section
              aria-label={t('band.etat.du.personnage.epingle')}
              className="-mx-4 px-4 sm:mx-0 sm:px-0 bg-parchment-50/95 backdrop-blur border-b border-parchment-200 shadow-md"
            >
              <div className="py-1.5 space-y-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  {character.portraitUrl && (
                    <img
                      src={character.portraitUrl}
                      alt=""
                      className="rounded-full object-cover border-2 border-parchment-300 shrink-0 w-6 h-6"
                    />
                  )}
                  <span className="font-display text-base font-bold truncate min-w-0">
                    {character.name}
                  </span>
                  <div className="flex items-center gap-1.5 ml-auto shrink-0">
                    <span
                      className="w-24 sm:w-28 shrink-0"
                      title={t('band.points.de.vie.displayhp.hpmax', {
                        displayHp: displayHp,
                        hpMax: hpMax,
                      })}
                    >
                      <HpBar
                        current={displayHp}
                        max={hpMax}
                        temp={displayTemp}
                        size="xs"
                        showText
                      />
                    </span>
                    <span className="font-mono text-sm font-semibold text-ink-800 bg-parchment-100 border border-parchment-200 rounded-md px-2 py-1">
                      🛡 {effectiveAC}
                    </span>
                    {slotsTotal > 0 && (
                      <span className="font-mono text-sm font-semibold text-gold-700 bg-gold-100/70 border border-gold-300 rounded-md px-2 py-1">
                        ✨ {slotsLeft}/{slotsTotal}
                      </span>
                    )}
                    {stateCount > 0 && (
                      <Chip tone="amber">
                        ⚠ {stateCount} état{stateCount > 1 ? 's' : ''}
                      </Chip>
                    )}
                  </div>
                </div>
                <CombatLine
                  combat={combat}
                  combatHref={combatHref}
                  onNavigate={onNavigate}
                  onOpenInitiative={onOpenInitiative}
                  isCaster={isCaster}
                />
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

/** The combat line shared by the static band (live region) and its pinned twin. */
function CombatLine({
  combat,
  combatHref,
  onNavigate,
  onOpenInitiative,
  isCaster,
  live = false,
}: {
  combat: StateBandCombat | null;
  combatHref: string | null;
  onNavigate: (tab: NavigateTarget) => void;
  onOpenInitiative: () => void;
  isCaster: boolean;
  live?: boolean;
}) {
  const { t } = useTranslation();
  if (!combat) return null;
  return (
    <div role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
      {combat.needsInitiative ? (
        <div className="band-rise flex gap-2">
          <button
            type="button"
            onClick={onOpenInitiative}
            className="btn-primary w-full py-2 lg:hidden"
          >
            {t('band.lance.ton.initiative')}
          </button>
          {combatHref && (
            <Link to={combatHref} className="btn-primary hidden lg:flex justify-center flex-1 py-2">
              {t('band.initiative.ouvrir.le.combat')}
            </Link>
          )}
        </div>
      ) : combat.isMyTurn ? (
        // The dock card already announces "À toi de jouer" loudly; the band
        // answers with two equal, quiet shortcuts (sr-only keeps the
        // live-region announcement).
        <div
          className={`band-rise grid gap-2 lg:flex lg:w-fit ${isCaster ? 'grid-cols-2' : 'grid-cols-1'}`}
        >
          <span className="sr-only">{t('band.a.toi.de.jouer')}</span>
          <button
            type="button"
            onClick={() => onNavigate('survival')}
            className="btn-secondary py-2"
            aria-label={t('band.attaquer.ouvrir.les.attaques')}
          >
            ⚔ Attaquer
          </button>
          {isCaster && (
            <button
              type="button"
              onClick={() => onNavigate('spells')}
              className="btn-secondary py-2"
              aria-label={t('band.lancer.un.sort.ouvrir.les.sorts')}
            >
              {t('band.lancer.un.sort')}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-500 truncate">
          {combat.status === 'active' && combat.currentCombatantName
            ? `⚔ Tour de ${combat.currentCombatantName} · Manche ${combat.round}`
            : '⚔ Combat en préparation'}
        </p>
      )}
    </div>
  );
}
