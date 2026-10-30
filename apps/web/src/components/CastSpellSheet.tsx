import type { Spell } from '@table-sync/shared';
import {
  type CharacterClassSource,
  agonizingBlastBonus,
  applyAcEffects,
  classLevelOf,
  eldritchBlastRays,
  formatModifier,
  SPELL_AC_EFFECTS,
  spellDamageAtLevel,
  spellHealingAtLevel,
  spellSaveDC,
} from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { damageType } from '../i18n/labels';
import {
  defToEffect,
  effectModLabel,
  type TargetableMember,
  isTargetableAcSpell,
  previewAc,
} from '../spellEffects';
import { Chip } from './ui';
import TargetPickerSheet, { type CastTarget } from './TargetPickerSheet';

/**
 * Bottom sheet (mobile) / dialog (desktop) to cast a known spell:
 * pick the slot level (with upcast options), warn about concentration
 * conflicts, then consume the slot in one PATCH.
 *
 * Portaled to body — .card's backdrop-filter would break fixed positioning.
 * Local variant of BottomSheet (which has no desktop-dialog mode): same
 * Esc-to-close + body scroll-lock contract.
 */
export default function CastSpellSheet({
  spell,
  slots,
  slotsUsed,
  pactSlots,
  pactUsed,
  concentrating,
  castingMod,
  profBonus,
  charLevel,
  character,
  invocationIds,
  activeAcEffects,
  currentEffectiveAc,
  dexMod,
  freeCasts,
  targets,
  onClose,
  onCast,
}: {
  spell: Spell;
  /** Max slots per level 1-9 (index 0 = level 1) — Incantation pool. */
  slots: number[];
  slotsUsed: number[];
  /** Pact magic pool (Occultiste) — interchangeable with Incantation (SRD). */
  pactSlots?: number[];
  pactUsed?: number[];
  concentrating: boolean;
  /** For the DD / attack preview chips. */
  castingMod?: number;
  profBonus?: number;
  charLevel?: number;
  /** Fiche du lanceur — manifestations occultes : aperçu Décharge occulte
   *  (rayons par niveau de classe, +CHA de Décharge déchirante, portée de
   *  Lance occulte). Passe la fiche ENTIÈRE : classLevelOf lit les lignes
   *  de classe (multiclassage), pas le seul niveau total. */
  character?: CharacterClassSource & {
    charisma?: number | null;
    level?: number | null;
    name?: string | null;
    portraitUrl?: string | null;
  };
  /** Ids de manifestations connues (invocationIdsOf sur les traits chargés). */
  invocationIds?: string[];
  /** Effets de sort CA actifs (bandeau) — l'annonce part de la CA effective
   *  ACTUELLE, effets déjà posés inclus. */
  activeAcEffects?: Array<{ effectKind: string; acValue: number }>;
  /** CA effective actuelle (override manuel inclus) — base de l'annonce. */
  currentEffectiveAc?: number;
  /** Modificateur de DEX — formules « 13 + DEX » (Armure de mage). */
  dexMod?: number;
  /** Lancers gratuits 1/RL des manifestations free-cast et Arcanum : clé =
   * slug du sort, valeur = { featureId, counterCurrent, label }. */
  freeCasts?: Record<string, { featureId: number; counterCurrent: number; label: string }>;
  /** Autres membres du groupe non cachés, avec CA effective et DEX — picker
   *  de cible (v2 ciblage) pour les 5 sorts ciblables. Bouclier EXCLU
   *  (réaction self, pas de picker). */
  targets?: TargetableMember[];
  onClose: () => void;
  /** Called with the chosen slot level (0 = cantrip, no slot), whether it's
   *  a ritual cast (no slot either) and WHICH pool the slot comes from —
   *  SRD magie de pacte : les deux pools sont interchangeables, LE JOUEUR
   *  choisit (un emplacement de pacte lance le sort au niveau de SON dé).
   *  'free' : lancer sans emplacement (manifestation à volonté / compteur
   *  free-cast / Arcanum) — le parent décrémente le compteur du trait.
   *  target : cible choisie (v2) — self par défaut, fiche du groupe ou
   *  « Autre » à nom libre ; le parent enchaîne PATCH puis POST
   *  spell-effects avec targetCharacterId/targetLabel selon la sélection. */
  onCast: (
    level: number,
    ritual?: boolean,
    pool?: 'spellcasting' | 'pact' | 'free',
    target?: CastTarget,
  ) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const isCantrip = spell.level === 0;
  // Scalable à un niveau supérieur ? Les listes ne portent PLUS la prose
  // (mode résumé — higherLevel null) : la réponse fait foi par les TABLES
  // d'évolution du damage_json (dégâts/soins par emplacement), la vérité SRD
  // structurée, OU par le drapeau scalesAtHigherLevel (#171 — posé par l'API
  // depuis la prose higher_level : les sorts à évolution purement textuelle,
  // Aide/Héroïsme…, gardent leurs options d'upcast sans lazy-loader). La
  // prose reste en ceinture de sécurité (payloads détail).
  const scalesAtSlot = (() => {
    try {
      const d = spell.damageJson ? (JSON.parse(spell.damageJson) as any) : null;
      return !!(d?.damage_at_slot_level || d?.heal_at_slot_level);
    } catch {
      return false;
    }
  })();
  const canUpcast =
    !isCantrip && (scalesAtSlot || !!spell.scalesAtHigherLevel || !!spell.higherLevel);

  // Options d'emplacement : un bouton par dépense possible — Incantation
  // (le niveau du sort + les niveaux supérieurs quand il évolue) ET, si le
  // pool de pacte a un emplacement libre de niveau ≥ au sort, l'option pacte
  // (qui lance le sort AU NIVEAU de l'emplacement de pacte — SRD). Le joueur
  // choisit son pool, rien n'est automatique.
  const pactSlotsRef = pactSlots ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const pactUsedRef = pactUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const remainingAt = (lvl: number) => (slots[lvl - 1] ?? 0) - (slotsUsed[lvl - 1] ?? 0);

  // ---------- Manifestations occultes (Phase B) ----------
  // Lancers SANS emplacement : à volonté (sort de manifestation, illimité) et
  // 1/RL au compteur du trait (free-cast / Arcanum mystique). Ce sont des
  // OPTIONS du joueur, à côté des emplacements — rien d'automatique.
  const freeCast = freeCasts?.[spell.srdIndex] ?? null;
  const freeRemaining = freeCast ? Math.max(0, freeCast.counterCurrent) : 0;
  const atWill = !!freeCast && freeCast.label === 'at-will';
  // Aperçu Décharge occulte : rayons au niveau d'OCCULTISTE (cantrip scaling
  // par classe), +CHA de Décharge déchirante, portée de Lance occulte.
  const invocations = invocationIds ?? [];
  const warlockLevel = character ? classLevelOf(character, 'Occultiste') : 0;
  const isEldritchBlast = spell.srdIndex === 'eldritch-blast';
  const agonizing = isEldritchBlast && character ? agonizingBlastBonus(character, invocations) : 0;
  const blastRays = isEldritchBlast ? eldritchBlastRays(warlockLevel) : 0;
  const spearRange = isEldritchBlast && invocations.includes('occultiste-invo-lance-occulte');

  type CastOption = { key: string; level: number; pool: 'spellcasting' | 'pact' | 'free' };
  const castOptions: CastOption[] = [];
  if (!isCantrip) {
    if (atWill || freeRemaining > 0) {
      castOptions.push({ key: 'free', level: spell.level, pool: 'free' });
    }
    for (let lvl = spell.level; lvl <= 9; lvl++) {
      if (lvl > spell.level && !canUpcast) break;
      if (remainingAt(lvl) > 0)
        castOptions.push({ key: `s${lvl}`, level: lvl, pool: 'spellcasting' });
    }
    // Les emplacements de pacte partagent tous le même niveau : une option.
    const pactIdx = pactSlotsRef.findIndex((max, i) => max - (pactUsedRef[i] ?? 0) > 0);
    if (pactIdx >= 0 && pactIdx + 1 >= spell.level) {
      castOptions.push({ key: `p${pactIdx + 1}`, level: pactIdx + 1, pool: 'pact' });
    }
    // Le lancer gratuit d'abord (c'est la voie « gratuite »), puis par niveau.
    castOptions.sort(
      (a, b) =>
        (a.pool === 'free' ? -1 : b.pool === 'free' ? 1 : 0) ||
        a.level - b.level ||
        (a.pool === 'pact' ? 1 : -1),
    );
  }
  const pactRemaining = () => {
    const idx = pactSlotsRef.findIndex((max, i) => max - (pactUsedRef[i] ?? 0) > 0);
    return idx >= 0 ? pactSlotsRef[idx] - (pactUsedRef[idx] ?? 0) : 0;
  };

  const [chosenKey, setChosenKey] = useState<string>(
    isCantrip ? 'cantrip' : (castOptions[0]?.key ?? ''),
  );
  const chosenOption = castOptions.find((o) => o.key === chosenKey) ?? null;
  const [casting, setCasting] = useState(false);

  // ---------- Cible (v2 ciblage) ----------
  // Rangée « Cible » SOUS l'annonce CA pour les 5 sorts ciblables — Bouclier
  // EXCLU (réaction self, pas de picker). « Moi » pré-sélectionné (cas
  // dominant) ; la sélection est un état LOCAL de la feuille, confirmé au
  // cast — choisir une cible ne lance rien.
  const isTargetable = isTargetableAcSpell(spell.srdIndex);
  const [target, setTarget] = useState<CastTarget>({ kind: 'self' });
  const [pickerOpen, setPickerOpen] = useState(false);
  // Réarmé au changement de sort : la feuille vit pendant toute la session.
  useEffect(() => {
    setTarget({ kind: 'self' });
    setPickerOpen(false);
  }, [spell.id]);
  const targetName =
    target.kind === 'self'
      ? t('cast.cible.moi')
      : target.kind === 'character'
        ? target.name
        : target.label;
  const otherTargets = targets ?? [];
  const selectedMember =
    target.kind === 'character' ? (otherTargets.find((m) => m.id === target.id) ?? null) : null;

  // Same dialog contract as BottomSheet: Escape closes, body scroll locks.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const concConflict = spell.concentration && concentrating;

  // ---------- Annonce CA (effets de sort v1 + ciblage v2) ----------
  // « ⛨ CA 18 → 20 (+2, tant que concentré) » sous le résumé — or = magie,
  // AVANT consommation d'emplacement. La base est la CA effective ACTUELLE :
  // override manuel inclus (il gagne, la base reste la CA affichée), effets
  // déjà posés inclus (le parent passe la CA nue + les effets actifs).
  //
  // v2 ciblage : l'annonce suit la CIBLE —
  //  - « Moi » : CA effective du lanceur (comportement v1),
  //  - fiche du groupe : CA effective de la cible (roster) avec SA DEX
  //    (« CA 16 → 18 » devient la CA de Kael),
  //  - « Autre » : pas de chiffre, pas de fiche — « +2 · CA de Gobelin —
  //    tenu par votre concentration » (pense-bête de règle).
  const acEffectDef = SPELL_AC_EFFECTS[spell.srdIndex];
  const acEffect = acEffectDef ? defToEffect(acEffectDef) : null;
  const isMageArmor = spell.srdIndex === 'mage-armor';
  const selfAcFrom =
    currentEffectiveAc !== undefined && dexMod !== undefined
      ? activeAcEffects && activeAcEffects.length > 0
        ? applyAcEffects(currentEffectiveAc, activeAcEffects, dexMod)
        : currentEffectiveAc
      : undefined;
  let acFrom: number | undefined;
  if (target.kind === 'self') acFrom = selfAcFrom;
  else if (target.kind === 'character' && selectedMember) acFrom = selectedMember.ac ?? undefined;
  const acDexMod = target.kind === 'character' && selectedMember ? selectedMember.dexMod : dexMod;
  const acTo =
    acEffect && acFrom !== undefined && acDexMod !== undefined
      ? previewAc(acFrom, acDexMod, acEffect)
      : null;
  const acAnnouncement =
    acEffect && target.kind !== 'label' && acFrom !== undefined && acTo !== null && acTo !== acFrom
      ? { from: acFrom, to: acTo, mod: effectModLabel(acEffect) }
      : acEffect &&
          target.kind !== 'label' &&
          acFrom !== undefined &&
          acTo !== null &&
          acTo === acFrom
        ? { from: acFrom, to: acTo, mod: effectModLabel(acEffect), flat: true }
        : null;
  // « Autre » : annonce sans chiffre — la formule seule (« +2 », « 13 + DEX »).
  const otherAnnouncement =
    acEffect && target.kind === 'label' ? { mod: effectModLabel(acEffect) } : null;
  // Mention sous l'annonce : concentration = celle du LANCEUR (même posé sur
  // autrui) ; Armure de mage (touch, pas de concentration) se lève à la main.
  const mentionKey = acEffectDef?.tiedToConcentration
    ? ('cast.ca.annonce.tant.que.concentre' as const)
    : isTargetable && !acEffectDef?.tiedToConcentration
      ? ('cast.ca.annonce.a.lever.main' as const)
      : null;
  // Bouclier : réaction — le libellé du bouton principal le dit (données
  // déjà « 1 réaction », ici c'est la voix).
  const isShield = spell.srdIndex === 'shield';

  const cast = async (level: number, ritual = false, pool?: 'spellcasting' | 'pact' | 'free') => {
    setCasting(true);
    try {
      await onCast(level, ritual, pool, isTargetable ? target : undefined);
    } finally {
      setCasting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card w-full sm:max-w-md rounded-b-none sm:rounded-2xl p-4 sheet-enter bg-raised max-h-[88vh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('cast.lancer.spell.name', { spell_name: spell.name })}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h3 className="section-title">🪄 {spell.name}</h3>
            <p className="text-xs text-ink-400">
              {isCantrip
                ? t('cast.tour.de.magie')
                : t('cast.sort.de.niveau.level', { level: spell.level })}
              {spell.concentration && t('cast.concentration.suffixe')}
              {spell.ritual && t('cast.rituel.suffixe')}
            </p>
            {atWill && (
              <p className="text-[11px] text-gold-700 font-medium">
                {t('cast.a.volonte.manifestation')}
              </p>
            )}
            {freeCast && freeCast.label !== 'at-will' && freeRemaining > 0 && (
              <p className="text-[11px] text-gold-700 font-medium">
                {t('cast.gratuit.restant', { count: freeRemaining })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-ink-700 text-lg leading-none px-1"
            aria-label={t('cast.fermer')}
          >
            ✕
          </button>
        </div>

        {concConflict && (
          <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 mb-3 text-sm text-amber-900">
            <p className="font-semibold">{t('cast.concentration.en.cours')}</p>
            <p className="mt-0.5">
              {t('cast.tu.concentres.deja.un.sort.lancer')}
              <strong>{spell.name}</strong>
              {t('cast.mettra.fin.au.sort.precedent')}
            </p>
          </div>
        )}

        {/* Annonce de calcul AVANT consommation — or = magie. Flat : l'effet
            ne CHANGE pas la CA (plancher déjà atteint) mais se posera quand
            même (la ligne reste, la règle aussi). « Autre » : sans chiffre —
            pense-bête de règle sur une cible sans fiche. Armure de mage :
            la mention devient « jusqu'à 8 h — à lever à la main » (pas de
            concentration). */}
        {acAnnouncement && (
          <div
            className="rounded-lg bg-gold-50 border border-gold-300 p-3 mb-3 text-sm text-gold-800"
            aria-label={
              acAnnouncement.flat
                ? t('cast.ca.annonce.plate.from.mod.autant', {
                    from: acAnnouncement.from,
                    mod: acAnnouncement.mod,
                  })
                : t('cast.ca.annonce.from.to.mod', {
                    from: acAnnouncement.from,
                    to: acAnnouncement.to,
                    mod: acAnnouncement.mod,
                  })
            }
          >
            {acAnnouncement.flat ? (
              <p className="font-medium">
                ⛨{' '}
                {t('cast.ca.annonce.plate.from.mod.autant', {
                  from: acAnnouncement.from,
                  mod: acAnnouncement.mod,
                })}
              </p>
            ) : (
              <p className="font-medium">
                ⛨{' '}
                {t('cast.ca.annonce.from.to.mod', {
                  from: acAnnouncement.from,
                  to: acAnnouncement.to,
                  mod: acAnnouncement.mod,
                })}
              </p>
            )}
            {mentionKey && <p className="mt-0.5 text-xs text-gold-700">{t(mentionKey)}</p>}
          </div>
        )}
        {otherAnnouncement && (
          <div
            className="rounded-lg bg-gold-50 border border-gold-300 p-3 mb-3 text-sm text-gold-800"
            aria-label={t('cast.ca.annonce.autre.aria', {
              mod: otherAnnouncement.mod,
              name: (target.kind === 'label' && target.label) || '',
              spell: spell.name,
            })}
          >
            <p className="font-medium">
              ⛨ {t('cast.ca.annonce.autre', { mod: otherAnnouncement.mod, name: targetName })}
            </p>
            <p className="mt-0.5 text-xs text-gold-700">
              {isMageArmor
                ? t('cast.ca.annonce.a.lever.main')
                : t('cast.ca.annonce.tant.que.concentre')}
            </p>
          </div>
        )}

        {/* Rangée « Cible » (v2 ciblage) — sous l'annonce CA, AVANT les
            boutons d'emplacement. Pastille courante + ouverture du picker
            (BottomSheet portaled, mobileOnly={false} comme la mini-feuille
            de levée). Sélection = état local, confirmé au cast. */}
        {isTargetable && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-parchment-200 bg-parchment-50 hover:border-gold-400 px-3 min-h-11 py-2 text-left transition-colors"
              aria-label={t('cast.cible.ouvrir.aria', {
                spell: spell.name,
                target: targetName,
              })}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="text-xs font-medium text-ink-500">{t('cast.cible')}</span>
                <span className="truncate text-sm font-semibold text-gold-800">
                  {target.kind === 'self' ? t('cast.cible.moi.pastille') : targetName}
                </span>
              </span>
              <span className="shrink-0 text-ink-400" aria-hidden="true">
                ›
              </span>
            </button>
          </div>
        )}

        {isCantrip ? (
          <p className="text-sm text-ink-600 bg-parchment-100 rounded-lg p-3">
            {t('cast.les.tours.de.magie.se.lancent')}
          </p>
        ) : castOptions.length === 0 ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {t('cast.aucun.emplacement.de.sort.disponible.il')}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-500">{t('cast.emplacement.a.depenser')}</p>
            {castOptions.map((opt) => {
              const selected = chosenKey === opt.key;
              const isUpcast = opt.level > spell.level && canUpcast && opt.pool !== 'free';
              const isPact = opt.pool === 'pact';
              const isFree = opt.pool === 'free';
              return (
                <button
                  type="button"
                  key={opt.key}
                  onClick={() => setChosenKey(opt.key)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    isFree
                      ? selected
                        ? 'bg-gold-500 text-white border-gold-600'
                        : 'bg-gold-50 text-gold-800 border-gold-300 hover:border-gold-500'
                      : selected
                        ? 'bg-blood-600 text-white border-blood-700'
                        : 'bg-parchment-50 text-ink-700 border-parchment-200 hover:border-blood-400'
                  }`}
                  aria-pressed={selected}
                >
                  <span className="font-medium flex items-center gap-1.5 min-w-0">
                    {isFree ? (
                      <>
                        {t('cast.gratuit.manifestation')}
                        {freeCast?.label === 'at-will' ? (
                          <span
                            className={`text-[10px] font-semibold uppercase ${selected ? 'text-white' : 'text-gold-600'}`}
                          >
                            {t('sorts.a.volonte')}
                          </span>
                        ) : (
                          <span
                            className={`text-[10px] font-semibold uppercase ${selected ? 'text-gold-200' : 'text-gold-700'}`}
                          >
                            {freeCast?.label === 'arcanum'
                              ? t('cast.arcanum.mystique')
                              : t('cast.manifestation')}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {t('cast.niveau.level', { level: opt.level })}
                        {isUpcast && (
                          <span
                            className={`text-[10px] font-semibold uppercase ${selected ? 'text-gold-300' : 'text-blood-500'}`}
                          >
                            {t('cast.superieur')}
                          </span>
                        )}
                        {isPact && (
                          <span
                            className={`text-[10px] font-semibold uppercase ${selected ? 'text-gold-300' : 'text-gold-600'}`}
                            title={t('cast.emplacement.de.magie.de.pacte.recharge')}
                          >
                            {t('cast.pacte')}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  <span
                    className={`shrink-0 ${selected ? 'text-night-100' : isPact || isFree ? 'text-gold-700' : 'text-ink-400'}`}
                  >
                    {isFree ? (
                      freeCast?.label === 'at-will' ? (
                        t('cast.illimite')
                      ) : (
                        t('cast.restant', { count: freeRemaining })
                      )
                    ) : isPact ? (
                      <span title={t('cast.emplacement.de.pacte.recharge.au.repos')}>
                        {t('cast.pacte.restant', { count: pactRemaining() })}
                      </span>
                    ) : (
                      t('cast.restant', { count: remainingAt(opt.level) })
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Damage / healing / DD preview at the chosen level */}
        {(() => {
          const chosenLvl = isCantrip ? 0 : chosenOption?.level;
          const dmg = spellDamageAtLevel(spell, chosenLvl ?? -1, charLevel ?? 1);
          const healing = spellHealingAtLevel(spell, chosenLvl ?? -1, charLevel ?? 1);
          const hasPreview = dmg.dice || healing.dice || spell.dcJson || spell.attackType;
          if (!hasPreview || (!chosenOption && !isCantrip)) return null;
          // Décharge occulte : le damage_json donne le dé PAR RAYON — l'aperçu
          // multiplie par les rayons du niveau d'occultiste et ajoute le +CHA
          // de Décharge déchirante (mod brut), PAR RAYON (PHB 2014).
          const perRayBonus = agonizing;
          return (
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {!isCantrip && chosenOption && (
                <span className="text-xs text-ink-400">
                  {chosenOption.pool === 'pact'
                    ? t('cast.au.niveau.level.pacte.deux.points', { level: chosenOption.level })
                    : chosenOption.pool === 'free'
                      ? t('cast.sans.emplacement.deux.points')
                      : t('cast.au.niveau.level.deux.points', { level: chosenOption.level })}
                </span>
              )}
              {dmg.dice && (
                <Chip tone="orange" title={isEldritchBlast ? t('cast.par.rayon') : undefined}>
                  ⚔{' '}
                  {isEldritchBlast && blastRays > 1
                    ? `${blastRays} × ${dmg.dice}${perRayBonus ? formatModifier(perRayBonus) : ''}`
                    : `${dmg.dice}${isEldritchBlast && perRayBonus ? formatModifier(perRayBonus) : ''}`}
                  {dmg.typeFr
                    ? ` ${t('cast.degats.de.type', { type: damageType(dmg.typeFr) ?? dmg.typeFr })}`
                    : ''}
                  {isEldritchBlast && blastRays > 1 ? ` ${t('cast.par.rayon')}` : ''}
                </Chip>
              )}
              {isEldritchBlast && (
                <Chip tone="gold" title={t('cast.decharge.occulte.rayons.title')}>
                  ✦{' '}
                  {t('cast.rayons.count', {
                    count: blastRays,
                    rays: blastRays,
                  })}
                </Chip>
              )}
              {isEldritchBlast && perRayBonus !== 0 && (
                <Chip tone="gold" title={t('cast.decharge.dechirante.title')}>
                  ✦ {formatModifier(perRayBonus)} {t('cast.par.rayon.court')}
                </Chip>
              )}
              {spearRange && (
                <Chip tone="gold" title={t('cast.lance.occulte.title')}>
                  🎯 {t('cast.portee.45m')}
                </Chip>
              )}
              {healing.dice && (
                <Chip
                  tone="green"
                  title={
                    healing.addsModifier
                      ? t('sorts.points.de.vie.restaures.des.modificateur')
                      : t('sorts.points.de.vie.restaures')
                  }
                >
                  ✚ {healing.dice}
                  {healing.addsModifier && castingMod !== undefined
                    ? formatModifier(castingMod)
                    : ''}{' '}
                  {t('sorts.pv')}
                </Chip>
              )}
              {spell.dcJson && castingMod !== undefined && profBonus !== undefined && (
                <Chip tone="blue">
                  🛡 {t('sorts.dd')} {spellSaveDC(castingMod, profBonus)}
                </Chip>
              )}
              {spell.attackType && castingMod !== undefined && profBonus !== undefined && (
                <Chip tone="red">🎯 {formatModifier(castingMod + profBonus)}</Chip>
              )}
            </div>
          );
        })()}

        <button
          type="button"
          onClick={() => {
            if (isCantrip) cast(0);
            else if (chosenOption) cast(chosenOption.level, false, chosenOption.pool);
          }}
          disabled={casting || (!chosenOption && !isCantrip)}
          className="btn-primary w-full mt-4 py-2.5 disabled:opacity-40"
        >
          {casting
            ? '…'
            : isShield
              ? t('cast.reagir.bouclier')
              : concConflict
                ? t('cast.lancer.et.rompre.la.concentration')
                : isCantrip
                  ? t('cast.lancer.le.tour.de.magie')
                  : isTargetable && target.kind !== 'self'
                    ? t('cast.lancer.sur', { target: targetName })
                    : chosenOption?.pool === 'free'
                      ? freeCast?.label === 'at-will'
                        ? t('cast.lancer.a.volonte')
                        : t('cast.lancer.gratuit')
                      : t('cast.lancer.au.niveau.level', {
                          level: chosenOption ? chosenOption.level : '—',
                        })}
        </button>

        {/* Ritual cast: no slot consumed, +10 minutes */}
        {spell.ritual && (
          <button
            type="button"
            onClick={() => cast(spell.level, true)}
            disabled={casting}
            className="w-full mt-2 py-2.5 rounded-lg bg-purple-100 text-purple-800 border border-purple-300 hover:bg-purple-200 font-medium text-sm disabled:opacity-40 transition-colors"
          >
            {t('cast.rituel.10.minutes')}{' '}
            <span className="font-normal text-purple-500">{t('cast.sans.emplacement')}</span>
          </button>
        )}

        {/* Picker de cible (v2) — BottomSheet portaled DEUXIÈME niveau :
            « Moi » épinglé, membres non cachés, « Autre… » à nom libre. */}
        {isTargetable && (
          <TargetPickerSheet
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            spellName={spell.name}
            selfName={character?.name ?? ''}
            selfMeta={null}
            selfPortraitUrl={character?.portraitUrl ?? null}
            members={otherTargets}
            selected={target}
            onSelect={setTarget}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
