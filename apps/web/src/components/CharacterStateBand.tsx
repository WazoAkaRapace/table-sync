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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../api';
import { appLang } from '../i18n';
import { classNameLabel, conditionLabel } from '../i18n/labels';
import {
  bearerAcRows,
  castOnOthersRows,
  effectModLabel,
  fetchSpellEffects,
  type SpellEffectRow,
  toActiveAcEffects,
} from '../spellEffects';
import { BottomSheet, Chip, EncumbranceBar, HpBar, VitalButton } from './ui';

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
  /**
   * Signal « effets de sort changés » (cast depuis l'onglet Sorts) : nos
   * effets vivent en état LOCAL hors react-query, et l'écho WS du propre
   * cast est supprimé par l'anti-écho — ce compteur est le seul réveil.
   * Les LEVÉES locales (liftEffect) rechargent déjà d'elles-mêmes.
   */
  effectsVersion: number;
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
  effectsVersion,
}: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // Inline name editing (moved from the old header card)
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // HP quick-edit draft (steppers commit directly)
  const [hpDraft, setHpDraft] = useState<string | null>(null);
  // Temp-HP quick-edit draft — same typed-commit grammar as the PV box
  const [tempDraft, setTempDraft] = useState<string | null>(null);
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

  // CA — same computation as the Caractéristiques tab (source localisée).
  // Mémoïsée : computeAC balaie tout l'inventaire (résolutions d'armures
  // magiques incluses) et tournait à CHAQUE render du bandeau — le moindre
  // état local de la page la déclenchait.
  const dexMod = useMemo(() => abilityModifier(character.dexterity ?? 10), [character]);

  // ---------- Effets de sort sur la CA (v1) ----------
  // Une requête, cache état local — pas de react-query, cohérent avec le reste
  // du bandeau. Refetch sur onSaved (l'onglet Sorts vient de caster → PATCH +
  // POST effet → refreshInventory → la fiche redescend, la relance suit).
  const [spellEffects, setSpellEffects] = useState<SpellEffectRow[]>([]);
  const [effectsOpen, setEffectsOpen] = useState(false);
  const [liftingEffectId, setLiftingEffectId] = useState<number | null>(null);
  // v2 : id → nom des personnages du groupe — les lignes caster portent
  // targetCharacterId ; le nom vit côté client (roster léger, UNE requête).
  const [nameById, setNameById] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    let alive = true;
    api
      .get(`/api/parties/${character.partyId}/characters`)
      .then((res) => {
        if (!alive) return;
        const chars: Array<{ id: number; name: string; hidden?: boolean }> =
          res.data?.characters ?? [];
        setNameById(new Map(chars.filter((c) => !c.hidden).map((c) => [c.id, c.name])));
      })
      .catch(() => {
        /* silencieux : chips « → id » dégradées en nom inconnu */
      });
    return () => {
      alive = false;
    };
  }, [character.partyId]);
  const reloadEffects = useCallback(async () => {
    // Silencieux en échec (route absente / réseau) : pas de chips, pas
    // d'erreur — la fiche vit.
    setSpellEffects(await fetchSpellEffects(character.id));
  }, [character.id]);
  useEffect(() => {
    void reloadEffects();
  }, [reloadEffects]);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;
  // La concentration peut tomber ailleurs (dégâts via traqueur, conditions) :
  // la fiche redescend → les chips suivent. Idem pour un cast depuis l'onglet
  // Sorts : les emplacements consommés (spellSlotsUsed) changent sur la fiche
  // redescendue — c'est le signal « un sort vient d'être lancé » y compris
  // pour un effet NON concentré (Armure de mage, Bouclier), sinon la chip ne
  // apparaît qu'au prochain changement de PV/concentration.
  useEffect(() => {
    void reloadEffects();
  }, [reloadEffects, character.currentHp, character.concentrating, character.spellSlotsUsed]);

  // Signal page (cast depuis l'onglet Sorts) : les effets ont changé SANS que
  // PV/concentration/emplacements ne bougent nécessairement — re-tire.
  useEffect(() => {
    if (effectsVersion > 0) void reloadEffects();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signal volontaire : seul le numéro de version doit réveiller, reloadEffects est stable (useCallback [character.id]).
  }, [effectsVersion]);

  /** Lever un effet — DELETE ; le serveur retombe `concentrating` si plus
   *  rien ne le justifie (contrat Task 3). La ligne disparaît, la CA suit. */
  const liftEffect = async (row: SpellEffectRow) => {
    setLiftingEffectId(row.id);
    try {
      await api.delete(`/api/spell-effects/${row.id}`);
      await reloadEffects();
      await savedRef.current();
      onNotice(t('band.effets.leve', { name: row.spellName || t('band.effets.sort') }));
    } catch {
      onError(t('band.effets.erreur.de.levee'));
    } finally {
      setLiftingEffectId(null);
    }
  };

  // v2 ciblage : le GET renvoie les effets PORTÉS (bearer — ils comptent dans
  // la CA) ET les effets CASTÉS par ce personnage vers autrui (caster —
  // chips « → Kael »). Les lignes « Autre » étiquetées vivent côté lanceur
  // sans toucher sa CA.
  const bearerRows = useMemo(() => bearerAcRows(spellEffects), [spellEffects]);
  const castRows = useMemo(() => castOnOthersRows(spellEffects), [spellEffects]);
  /** Nom affiché d'une cible fiche — l'API ne joint pas le nom, le roster
   *  léger le donne (fallback : l'id, jamais vide). */
  const targetDisplayName = useCallback(
    (row: SpellEffectRow): string =>
      row.targetName ??
      (row.targetCharacterId != null
        ? (nameById.get(row.targetCharacterId) ?? `#${row.targetCharacterId}`)
        : ''),
    [nameById],
  );
  /** Nom du lanceur d'un effet porté (title « posé par X »). */
  const casterDisplayName = useCallback(
    (row: SpellEffectRow): string | null =>
      row.casterName ??
      (row.casterCharacterId != null ? (nameById.get(row.casterCharacterId) ?? null) : null),
    [nameById],
  );

  const activeEffects = useMemo(() => toActiveAcEffects(bearerRows), [bearerRows]);
  const acResult = useMemo(
    () =>
      computeAC(
        entries,
        dexMod,
        fightingStylesOf(character).has('defense'),
        character,
        appLang(),
        activeEffects,
      ),
    [entries, character, dexMod, activeEffects],
  );
  const hasAcOverride =
    character.armorClassOverride !== null && character.armorClassOverride !== undefined;
  const effectiveAC = hasAcOverride ? character.armorClassOverride : acResult.ac;

  // Emplacements : les DEUX pools (multiclassage — le pacte recharge au repos
  // court et vit sa vie à côté de l'incantation).
  const pools = useMemo(() => computeSpellcastingPools(character), [character]);
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
    (character.raging ? 1 : 0) +
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
  // `temp` rides the same request when damage spilled past the temp HP; a null
  // `n` is a temp-only gain (the expanded temp stepper).
  const patchHp = async (n: number | null, temp?: number) => {
    setHpDraft(null);
    setTempDraft(null);
    const clamped = n === null ? null : Math.max(0, Math.min(hpMax, Math.round(n)));
    const nextTemp = temp === undefined ? undefined : Math.max(0, Math.round(temp));
    if ((clamped === null || clamped === hpNow) && nextTemp === undefined) {
      setHpPending(null);
      setTempPending(null);
      return;
    }
    try {
      const payload: Record<string, number> = {};
      if (clamped !== null) payload.currentHp = clamped;
      if (nextTemp !== undefined) payload.tempHp = nextTemp;
      const res = await api.patch(`/api/characters/${character.id}`, payload);
      // Losing HP while concentrating requires a CON save — surface it immediately.
      if (res?.data?.concentrationCheck) onConcentrationCheck(res.data.concentrationCheck);
      if (res?.data?.concentrationBroken) {
        onNotice(
          t('survie.concentration.rompue.condition', {
            condition: conditionLabel(res.data.concentrationBroken),
          }),
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
    if (target === null && temp === null) return;
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

  // Temp GAINS queue on the same debounce window: a click burst coalesces into
  // one patch, and a damage burst arriving mid-flight absorbs from the queued
  // temp value (damageHp reads tempPendingRef while the timer runs).
  const queueTemp = (value: number) => {
    const n = Math.max(0, Math.round(value));
    tempPendingRef.current = n;
    setTempPending(n);
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

  // Explicit commit (typed temp value) — same contract as the PV box: emptied
  // rolls back instead of dropping the temp to 0.
  const commitTempDraft = () => {
    if (tempDraft === null) return;
    const val = Number(tempDraft);
    setTempDraft(null);
    if (tempDraft.trim() !== '' && Number.isFinite(val)) {
      queueTemp(val);
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
      if (target !== null || temp !== null) void patchHpRef.current(target, temp ?? undefined);
    },
    [],
  );

  const hpInputId = `band-hp-${character.id}`;
  const tempInputId = `band-temp-hp-${character.id}`;

  return (
    <>
      <section
        aria-label={t('band.etat.du.personnage')}
        data-tuto="band"
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
                      className="hover:text-blood-500 transition-colors truncate inline-flex items-center min-h-11"
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
                          .map((c) => `${classNameLabel(c.classKey)} ${c.level}`)
                          .join(' / ')}`
                      : character.characterClass
                        ? `${classNameLabel(character.characterClass)} ${t('band.niv.level', {
                            level,
                          })}`
                        : t('band.classe.a.definir')}
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
                  {character.raging && (
                    <button
                      type="button"
                      onClick={() => onNavigate('survival')}
                      className="shrink-0 hover:scale-110 transition-transform"
                      aria-label={t('band.en.rage.ouvrir.la.survie')}
                      title={t('band.rage.en.cours')}
                    >
                      🔥
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
                    ? t('band.pv.de.la.forme.animale', {
                        hp: character.currentHp,
                        maxHp: character.maxHp,
                      })
                    : `${t('band.points.de.vie.displayhp.hpmax', { displayHp, hpMax })}${
                        displayTemp > 0 ? t('band.plus.n.temporaires', { displayTemp }) : ''
                      }`
                }
              >
                <HpBar current={displayHp} max={hpMax} temp={displayTemp} size="sm" showText />
              </span>
              {displayTemp > 0 && (
                <Chip tone="blue" title={t('band.pv.temporaires')}>
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
                  onClick={() =>
                    bearerRows.length > 0 ? setEffectsOpen(true) : onNavigate('stats')
                  }
                  className={`font-mono text-sm font-semibold text-ink-800 bg-parchment-100 border rounded-md px-2 py-1 hover:border-blood-400 transition-colors inline-flex items-center min-h-11 ${
                    bearerRows.length > 0
                      ? 'border-gold-400 ring-1 ring-gold-300 hover:border-gold-500'
                      : 'border-parchment-200'
                  }`}
                  title={
                    bearerRows.length > 0
                      ? t('band.ca.effets.actifs.title', { count: bearerRows.length })
                      : character.armorClassOverride
                        ? t('band.ca.manuelle')
                        : acResult.source
                  }
                  aria-label={t('band.classe.d.armure.effectiveac.ouvrir.les', {
                    effectiveAC,
                  })}
                >
                  🛡 {effectiveAC}
                </button>
              ) : (
                <span
                  className={`font-mono text-sm font-semibold text-ink-800 bg-parchment-100 border rounded-md px-2 py-1 ${
                    bearerRows.length > 0
                      ? 'border-gold-400 ring-1 ring-gold-300'
                      : 'border-parchment-200'
                  }`}
                  title={character.armorClassOverride ? t('band.ca.manuelle') : acResult.source}
                >
                  🛡 {effectiveAC}
                </span>
              )}
              {slotsTotal > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigate('spells')}
                  className="font-mono text-sm font-semibold text-gold-700 bg-gold-100/70 border border-gold-300 rounded-md px-2 py-1 hover:border-gold-500 transition-colors inline-flex items-center min-h-11"
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
                <Chip tone="amber">{t('band.etats.count', { count: stateCount })}</Chip>
              )}
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="shrink-0 w-11 h-11 rounded-lg text-ink-500 hover:bg-parchment-100 transition-colors flex items-center justify-center"
                aria-expanded={expanded}
                aria-label={t('band.details.de.l.etat.du.personnage')}
              >
                {expanded ? '⌃' : '⌄'}
              </button>
            </div>
          </div>

          {/* Combat line — the static copy is the live region (status changes
              announce themselves); the pinned twin stays silent to avoid double
              announcements. Hidden at lg+: the header combat strip (CombatWidget)
              owns the wide-screen combat line — one instrument per surface. */}
          <CombatLine
            combat={combat}
            combatHref={combatHref}
            onNavigate={onNavigate}
            onOpenInitiative={onOpenInitiative}
            isCaster={isCaster}
            live
            className="lg:hidden"
          />

          {/* Encumbrance — the derived display; its multiplier input lives in
            the Caractéristiques tab (Statistiques dérivées). Consequences
            appear only when a tier is breached. */}
          <EncumbranceBar encumbrance={encumbrance} compact />

          {/* Chips d'effets de sort actifs — or = magie. L'override manuel
              GAGNE : chips affichées mais contribution non appliquée (la CA
              affichée reste la CA manuelle), avertissement orange règle.
              v2 : les effets posés SUR AUTRUI par ce personnage s'ajoutent
              en chips « → cible » (role caster) — les chips « Autre » ne
              portent AUCUN delta CA (pense-bête, pas de fiche). */}
          {(bearerRows.length > 0 || castRows.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setEffectsOpen(true)}
                  className="flex flex-wrap items-center gap-1.5 text-left min-h-11 py-1"
                  aria-label={t('band.ca.effets.actifs.count', {
                    count: bearerRows.length + castRows.length,
                  })}
                >
                  {bearerRows.map((row) => (
                    <Chip
                      key={row.id}
                      tone="gold"
                      title={
                        row.expiresOnTurnEnd
                          ? t('band.effet.chip.title.ephemere', {
                              name: row.spellName,
                              mod: effectModLabel(row),
                            })
                          : t('band.effet.chip.title', {
                              name: row.spellName,
                              mod: effectModLabel(row),
                            })
                      }
                    >
                      {effectModLabel(row)} · {row.spellName || t('band.effets.sort')}
                    </Chip>
                  ))}
                  {castRows.map((row) =>
                    row.targetLabel ? (
                      <Chip
                        key={row.id}
                        tone="gold"
                        title={t('band.effet.chip.caster.autre.title', {
                          name: row.spellName,
                          target: row.targetLabel,
                        })}
                      >
                        {row.spellName || t('band.effets.sort')} → {row.targetLabel}
                      </Chip>
                    ) : (
                      <Chip
                        key={row.id}
                        tone="gold"
                        title={t('band.effet.chip.caster.title', {
                          name: row.spellName,
                          mod: effectModLabel(row),
                          target: targetDisplayName(row),
                        })}
                      >
                        {effectModLabel(row)} · {row.spellName || t('band.effets.sort')} →{' '}
                        {targetDisplayName(row)}
                      </Chip>
                    ),
                  )}
                </button>
              ) : (
                <>
                  {bearerRows.map((row) => (
                    <Chip
                      key={row.id}
                      tone="gold"
                      title={
                        row.expiresOnTurnEnd
                          ? t('band.effet.chip.title.ephemere', {
                              name: row.spellName,
                              mod: effectModLabel(row),
                            })
                          : t('band.effet.chip.title', {
                              name: row.spellName,
                              mod: effectModLabel(row),
                            })
                      }
                    >
                      {effectModLabel(row)} · {row.spellName || t('band.effets.sort')}
                    </Chip>
                  ))}
                  {castRows.map((row) =>
                    row.targetLabel ? (
                      <Chip
                        key={row.id}
                        tone="gold"
                        title={t('band.effet.chip.caster.autre.title', {
                          name: row.spellName,
                          target: row.targetLabel,
                        })}
                      >
                        {row.spellName || t('band.effets.sort')} → {row.targetLabel}
                      </Chip>
                    ) : (
                      <Chip
                        key={row.id}
                        tone="gold"
                        title={t('band.effet.chip.caster.title', {
                          name: row.spellName,
                          mod: effectModLabel(row),
                          target: targetDisplayName(row),
                        })}
                      >
                        {effectModLabel(row)} · {row.spellName || t('band.effets.sort')} →{' '}
                        {targetDisplayName(row)}
                      </Chip>
                    ),
                  )}
                </>
              )}
              {hasAcOverride && (
                <Chip tone="orange" title={t('band.ca.manuelle.effet.non.applique.title')}>
                  {t('band.ca.manuelle.effet.non.applique')}
                </Chip>
              )}
            </div>
          )}

          {/* Expanded detail: states, slots, quick HP + temp edit */}
          {expanded && (
            <div className="border-t border-parchment-200 pt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {conditions.length === 0 && exhaustion === 0 && stateCount === 0 && (
                  <span className="text-xs text-ink-500">{t('band.aucun.etat.actif')}</span>
                )}
                {conditions.map((c) => (
                  <Chip key={c} tone="amber">
                    {conditionLabel(c)}
                  </Chip>
                ))}
                {exhaustion > 0 && (
                  <Chip tone="red" title={t('band.epuisement.malus.cumules.onglet.survie')}>
                    {t('band.epuisement.level', { level: exhaustion })}
                  </Chip>
                )}
                {character.raging && (
                  <Chip tone="red" title={t('band.rage.en.cours')}>
                    🔥 {t('band.rage')}
                  </Chip>
                )}
                {character.foodDays > 0 && (
                  <Chip tone="amber" title={t('band.jours.sans.nourriture')}>
                    {t('band.j.sans.nourriture', { days: character.foodDays })}
                  </Chip>
                )}
                {character.waterDays > 0 && (
                  <Chip tone="red" title={t('band.jours.sans.eau')}>
                    {t('band.j.sans.eau', { days: character.waterDays })}
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
                  <span className="text-xs font-medium text-ink-600">{t('band.emplacements')}</span>
                  {allSlotRows.map((r) => (
                    <span
                      key={r.pact ? `p${r.level}` : `s${r.level}`}
                      className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                        r.pact
                          ? 'bg-gold-100 border-gold-300 text-gold-700'
                          : 'bg-parchment-100 border-parchment-200 text-ink-600'
                      }`}
                      title={t('band.r.pact.magie.de.pacte.niveau', {
                        r_pact: r.pact ? t('sorts.magie.de.pacte') : t('sorts.incantation'),
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
                <div className="flex flex-wrap items-center gap-y-2 lg:flex-nowrap lg:gap-x-5">
                  <div className="flex items-center gap-1.5">
                    <label
                      htmlFor={hpInputId}
                      className="text-xs font-medium text-ink-600 shrink-0"
                    >
                      {shaped ? t('band.pv.forme') : t('band.pv')}
                    </label>
                    <VitalButton
                      onClick={() => damageHp(5)}
                      verb="harm"
                      label={t('band.blesser.de.5')}
                    >
                      −5
                    </VitalButton>
                    <VitalButton
                      onClick={() => damageHp(1)}
                      verb="harm"
                      label={t('band.blesser.de.1')}
                    >
                      −1
                    </VitalButton>
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
                    <VitalButton
                      onClick={() => queueHp(displayHp + 1)}
                      verb="heal"
                      label={t('band.soigner.de.1')}
                    >
                      +1
                    </VitalButton>
                    <VitalButton
                      onClick={() => queueHp(displayHp + 5)}
                      verb="heal"
                      label={t('band.soigner.de.5')}
                    >
                      +5
                    </VitalButton>
                  </div>

                  {/* Filet between the statement and the temp group — desktop only */}
                  <span className="hidden lg:block w-px h-7 bg-parchment-300" aria-hidden="true" />

                  {/* PV temporaires — gains only; the Blesser buttons above eat
                      temp first (SRD), same grammar as the Survie tracker.
                      Hidden while shaped: temp rides the real HP, not the shape. */}
                  {!shaped && (
                    <div className="flex items-center gap-1.5">
                      <label
                        htmlFor={tempInputId}
                        className="text-xs font-medium text-ink-600 shrink-0"
                      >
                        {t('hp.pv.temp')}
                      </label>
                      <input
                        id={tempInputId}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        className="input input-compact font-mono w-14 text-center"
                        value={tempDraft ?? String(displayTemp)}
                        onChange={(e) => setTempDraft(e.target.value)}
                        onBlur={commitTempDraft}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                      />
                      <VitalButton
                        temp
                        onClick={() => queueTemp(displayTemp + 1)}
                        verb="heal"
                        label={t('hp.ajouter.1.pv.temp')}
                      >
                        +
                      </VitalButton>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Sentinel watched by the IntersectionObserver above: when it slides
          under the app header, the pinned twin takes over. */}
        <div ref={bandEndRef} aria-hidden="true" />
      </section>

      {/* Mini-feuille des effets de sort actifs — portaled par BottomSheet
          (createPortal document.body : le backdrop-blur de .card casserait
          un fixed interne). « Lever » par ligne ≥ 44 px, aria verbal. */}
      <BottomSheet
        open={effectsOpen && canEdit}
        onClose={() => setEffectsOpen(false)}
        title={t('band.effets.titre')}
        mobileOnly={false}
        size="md"
      >
        <div className="space-y-2">
          {hasAcOverride && (
            <p className="rounded-lg bg-orange-50 border border-orange-300 px-3 py-2 text-sm text-orange-800">
              ⚠ {t('band.ca.manuelle.effet.non.applique')}
            </p>
          )}
          {bearerRows.length === 0 && castRows.length === 0 && (
            <p className="text-sm text-ink-500">{t('band.effets.aucun')}</p>
          )}
          {bearerRows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-2 bg-parchment-50 border border-parchment-200 rounded-lg px-3 min-h-[52px]"
              title={
                casterDisplayName(row)
                  ? t('band.effets.pose.par', { name: casterDisplayName(row) ?? '' })
                  : undefined
              }
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">
                  {row.spellName || t('band.effets.sort')}
                </p>
                <p className="text-xs text-gold-700 font-mono">
                  ⛨ {effectModLabel(row)}
                  {row.tiedToConcentration ? ` · ${t('band.effets.concentre')}` : ''}
                  {casterDisplayName(row)
                    ? ` · ${t('band.effets.pose.par.court', { name: casterDisplayName(row) ?? '' })}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => liftEffect(row)}
                disabled={liftingEffectId !== null}
                className="shrink-0 min-h-11 px-3 py-2 rounded-lg bg-parchment-200 hover:bg-parchment-300 text-sm font-medium text-ink-700 disabled:opacity-40 transition-colors"
                aria-label={t('band.effets.lever.name', {
                  name: row.spellName || t('band.effets.sort'),
                })}
              >
                {liftingEffectId === row.id ? '…' : t('band.effets.lever')}
              </button>
            </div>
          ))}

          {/* v2 : effets posés sur autrui — le lanceur voit ses sorts actifs
              chez les autres ; LEVER retombe `concentrating` si plus rien. */}
          {castRows.length > 0 && (
            <div className="pt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-1.5">
                {t('band.effets.sur.autrui')}
              </p>
              <div className="space-y-2">
                {castRows.map((row) => {
                  const who = row.targetLabel ?? targetDisplayName(row);
                  return (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 bg-gold-50 border border-gold-200 rounded-lg px-3 min-h-[52px]"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-800 truncate">
                          {row.spellName || t('band.effets.sort')} → {who}
                        </p>
                        <p className="text-xs text-gold-700 font-mono">
                          {row.targetLabel ? t('band.effets.sans.ca') : `⛨ ${effectModLabel(row)}`}
                          {row.tiedToConcentration
                            ? ` · ${t('band.effets.concentre')}`
                            : row.effectKind === 'ac_set_formula'
                              ? ` · ${t('band.effets.a.lever.main')}`
                              : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => liftEffect(row)}
                        disabled={liftingEffectId !== null}
                        className="shrink-0 min-h-11 px-3 py-2 rounded-lg bg-parchment-200 hover:bg-parchment-300 text-sm font-medium text-ink-700 disabled:opacity-40 transition-colors"
                        aria-label={t('band.effets.lever.name', {
                          name: `${row.spellName || t('band.effets.sort')} → ${who}`,
                        })}
                      >
                        {liftingEffectId === row.id ? '…' : t('band.effets.lever')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {hasAcOverride && bearerRows.length > 0 && (
            <p className="text-xs text-ink-400 leading-relaxed">{t('band.ca.manuelle.note')}</p>
          )}
        </div>
      </BottomSheet>

      {/* Pinned twin — compact fixed overlay; the flow above never resizes. */}
      {pinned && (
        <div className="band-drop fixed top-[calc(var(--app-header-h)+env(safe-area-inset-top))] inset-x-0 z-20">
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
                    <span
                      className={`font-mono text-sm font-semibold text-ink-800 bg-parchment-100 border rounded-md px-2 py-1 ${
                        spellEffects.length > 0
                          ? 'border-gold-400 ring-1 ring-gold-300'
                          : 'border-parchment-200'
                      }`}
                    >
                      🛡 {effectiveAC}
                    </span>
                    {slotsTotal > 0 && (
                      <span className="font-mono text-sm font-semibold text-gold-700 bg-gold-100/70 border border-gold-300 rounded-md px-2 py-1">
                        ✨ {slotsLeft}/{slotsTotal}
                      </span>
                    )}
                    {stateCount > 0 && (
                      <Chip tone="amber">{t('band.etats.count', { count: stateCount })}</Chip>
                    )}
                  </div>
                </div>
                <CombatLine
                  combat={combat}
                  combatHref={combatHref}
                  onNavigate={onNavigate}
                  onOpenInitiative={onOpenInitiative}
                  isCaster={isCaster}
                  className="lg:hidden"
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
  className,
}: {
  combat: StateBandCombat | null;
  combatHref: string | null;
  onNavigate: (tab: NavigateTarget) => void;
  onOpenInitiative: () => void;
  isCaster: boolean;
  live?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!combat) return null;
  return (
    <div
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
      className={className}
    >
      {combat.needsInitiative ? (
        <div className="band-rise flex gap-2">
          <button
            type="button"
            onClick={onOpenInitiative}
            className="btn-primary w-full min-h-11 py-2 lg:hidden"
          >
            {t('band.lance.ton.initiative')}
          </button>
          {combatHref && (
            <Link
              to={combatHref}
              className="btn-primary hidden lg:flex justify-center flex-1 min-h-11 py-2"
            >
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
            className="btn-secondary min-h-11 py-2"
            aria-label={t('band.attaquer.ouvrir.les.attaques')}
          >
            {t('band.attaquer')}
          </button>
          {isCaster && (
            <button
              type="button"
              onClick={() => onNavigate('spells')}
              className="btn-secondary min-h-11 py-2"
              aria-label={t('band.lancer.un.sort.ouvrir.les.sorts')}
            >
              {t('band.lancer.un.sort')}
            </button>
          )}
        </div>
      ) : (
        // État calme : plus de texte à l'écran — le rail d'initiative juste
        // sous le bandeau porte l'ordre (retour test 2026-10). La phrase
        // reste en sr-only dans la région vivante : le passage de tour
        // continue de s'annoncer aux lecteurs d'écran.
        <p className="sr-only">
          {combat.status === 'active' && combat.currentCombatantName
            ? t('band.tour.de.nom.manche.round', {
                name: combat.currentCombatantName,
                round: combat.round,
              })
            : t('band.combat.en.preparation')}
        </p>
      )}
    </div>
  );
}
