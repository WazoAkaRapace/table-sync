import type {
  Character,
  CharacterFeature,
  ConcentrationCheck,
  InventoryEntry,
} from '@table-sync/shared';
import {
  CONCENTRATION_BREAKING_CONDITIONS_FR,
  classesOf,
  classLevelOf,
  computeSpellcastingPools,
  computeUnarmedStats,
  computeWeaponStats,
  DND_CONDITIONS_FR,
  effectiveFeatureReset,
  extraAttacksOf,
  fightingStylesOf,
  findClass,
  findClassFeature,
  findClassFeatureClass,
  formatModifier,
  hitDiceByClassOf,
  proficiencyBonus,
  sneakAttackDice,
  type WildShapeFormSummary,
  wildShapeDurationHours,
  wildShapeMaxCR,
} from '@table-sync/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { CONDITION_ICONS } from '../../components/ConditionsEditor';
import MonsterStatBlock from '../../components/MonsterStatBlock';
import { BottomSheet, Chip, HpBar } from '../../components/ui';
import { abilityShort, conditionHintKey, conditionLabel, damageType } from '../../i18n/labels';
import { DeathSaveTracker } from './DeathSaveTracker';
import { DeprivationBox } from './DeprivationBox';
import { HpTracker } from './HpTracker';

// ---------- Survival panel (exhaustion, conditions, deprivation) ----------

function exhaustionColor(level: number): string {
  if (level <= 1) return 'text-green-600';
  if (level <= 3) return 'text-yellow-600';
  if (level <= 5) return 'text-orange-600';
  return 'text-red-600';
}

interface SurvivalPanelProps {
  character: Character;
  charId: number;
  entries: InventoryEntry[];
  /** Only the sheet owner or GM can use the survival actions. */
  canEdit: boolean;
  markLocalMutation: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
  onNotice?: (msg: string) => void;
  /** Damage-while-concentrating checks bubble to the page-level popup. */
  onConcentrationCheck: (check: ConcentrationCheck) => void;
}

export function SurvivalPanel({
  character,
  charId,
  entries,
  canEdit,
  markLocalMutation,
  onSaved,
  onError,
  onNotice,
  onConcentrationCheck,
}: SurvivalPanelProps) {
  const { t } = useTranslation();
  const [exhaustion, setExhaustion] = useState(character.exhaustion);
  const [conditions, setConditions] = useState<string[]>(character.conditions);
  const [conditionPickerOpen, setConditionPickerOpen] = useState(false);
  const [foodDays, setFoodDays] = useState(character.foodDays);
  const [waterDays, setWaterDays] = useState(character.waterDays);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [shapeForms, setShapeForms] = useState<WildShapeFormSummary[]>([]);
  const [shapeSearch, setShapeSearch] = useState('');
  const [shapeSeenOnly, setShapeSeenOnly] = useState(true);
  const [shapeStatBlock, setShapeStatBlock] = useState<string | null>(null);
  const [shapeHpDraft, setShapeHpDraft] = useState<string | null>(null);
  // Ressources de classe (traits du catalogue avec compteur) + repos
  const [resourceFeatures, setResourceFeatures] = useState<CharacterFeature[]>([]);
  const [restSheet, setRestSheet] = useState<'short' | 'long' | null>(null);
  const [restHitDice, setRestHitDice] = useState(0);
  // Soin annoncé par le joueur après avoir lancé ses dés de vie (repos court)
  const [restHealed, setRestHealed] = useState('');
  const [restBusy, setRestBusy] = useState(false);
  // Châtiment divin (Paladin) : arme de mêlée choisie + niveau d'emplacement
  const [smiteOpen, setSmiteOpen] = useState(false);
  const [smiteBusy, setSmiteBusy] = useState(false);

  // Traits du catalogue avec compteur → pips « Ressources de classe »
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch délibéré après un repos (compteurs rechargés côté API) ou un changement de niveau — pas seulement au montage.
  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/characters/${charId}/features`)
      .then((res) => {
        if (cancelled) return;
        const all: CharacterFeature[] = res.data?.features ?? [];
        setResourceFeatures(all.filter((f) => f.catalogId && f.counterMax && f.counterMax > 0));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [charId, character.hitDiceUsed, character.currentHp, character.level]);

  // Count available food/water from tagged inventory items
  // Water: skip items marked 'empty' in notes
  const foodCount = entries.reduce((sum, e) => {
    return sum + (e.item.survivalTags?.includes('food') ? e.quantity : 0);
  }, 0);
  const fullWaterCount = entries.reduce((sum, e) => {
    if (!e.item.survivalTags?.includes('water')) return sum;
    if (e.notes?.includes('empty')) return sum;
    return sum + e.quantity;
  }, 0);
  const emptyWaterCount = entries.reduce((sum, e) => {
    if (!e.item.survivalTags?.includes('water')) return sum;
    if (e.notes?.includes('empty')) return sum + e.quantity;
    return sum;
  }, 0);

  const consume = async (type: 'food' | 'water') => {
    markLocalMutation();
    try {
      await api.post(`/api/characters/${charId}/consume`, { type });
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || t('survie.erreur'));
    }
  };

  const refillWater = async () => {
    markLocalMutation();
    try {
      await api.post(`/api/characters/${charId}/refill`);
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || t('survie.erreur'));
    }
  };

  // Re-sync drafts when the character changes (e.g. remote sync, refresh)
  useEffect(() => {
    setExhaustion(character.exhaustion);
  }, [character.exhaustion]);
  useEffect(() => {
    setConditions(character.conditions);
  }, [character.conditions]);
  useEffect(() => {
    setFoodDays(character.foodDays);
  }, [character.foodDays]);
  useEffect(() => {
    setWaterDays(character.waterDays);
  }, [character.waterDays]);

  const patchCharacter = async (payload: Record<string, unknown>, errorMsg: string) => {
    markLocalMutation();
    try {
      const res = await api.patch(`/api/characters/${charId}`, payload);
      // Applying an incapacitating condition breaks concentration — tell the player.
      if (res?.data?.concentrationBroken) {
        onNotice?.(
          t('survie.concentration.rompue.condition', {
            condition: conditionLabel(res.data.concentrationBroken),
          }),
        );
      }
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || errorMsg);
    }
  };

  const setExhaustionLevel = async (level: number) => {
    if (level === exhaustion) return;
    setExhaustion(level);
    await patchCharacter({ exhaustion: level }, t('survie.erreur.de.mise.a.jour'));
  };

  const removeCondition = async (cond: string) => {
    const next = conditions.filter((c) => c !== cond);
    setConditions(next);
    await patchCharacter({ conditions: next }, t('survie.erreur.de.mise.a.jour'));
  };

  const addCondition = async (cond: string) => {
    if (!cond || conditions.includes(cond)) return;
    const next = [...conditions, cond];
    setConditions(next);
    await patchCharacter({ conditions: next }, t('survie.erreur.de.mise.a.jour'));
  };

  const openShapePicker = async () => {
    try {
      const res = await api.get(`/api/characters/${charId}/wild-shape/forms`);
      setShapeForms(res.data.forms ?? []);
      setShapeSearch('');
      setShapePickerOpen(true);
    } catch {
      onError(t('survie.erreur.du.bestiaire'));
    }
  };

  const toggleShapeSeen = async (slug: string, seen: boolean) => {
    markLocalMutation();
    try {
      const current = character.wildShapeSeen ?? [];
      const next = seen ? current.filter((x) => x !== slug) : [...current, slug];
      await api.patch(`/api/characters/${charId}`, { wildShapeSeen: next });
      setShapeForms((prev) => prev.map((f) => (f.slug === slug ? { ...f, seen: !seen } : f)));
      await onSaved();
    } catch {
      onError(t('survie.erreur.de.mise.a.jour'));
    }
  };

  const takeShape = async (slug: string) => {
    markLocalMutation();
    try {
      await api.post(`/api/characters/${charId}/wild-shape`, { slug });
      setShapePickerOpen(false);
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || t('survie.erreur.de.transformation'));
    }
  };

  const revertShape = async () => {
    markLocalMutation();
    try {
      await api.post(`/api/characters/${charId}/wild-shape/revert`);
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || t('survie.erreur.de.retour.a.la.normale'));
    }
  };

  const stepDays = async (kind: 'foodDays' | 'waterDays', delta: number) => {
    const next = Math.max(0, (kind === 'foodDays' ? foodDays : waterDays) + delta);
    if (kind === 'foodDays') setFoodDays(next);
    else setWaterDays(next);
    await patchCharacter({ [kind]: next }, t('survie.erreur.de.mise.a.jour'));
  };

  // --- Repos court / long (POST /rest — récupération SRD côté API) ---
  // Les dés de vie sont lancés PAR LE JOUEUR à la table : l'app compte les dés
  // dépensés et applique le total de PV annoncé.
  const doRest = async () => {
    if (!restSheet) return;
    setRestBusy(true);
    markLocalMutation();
    try {
      const announced = restSheet === 'short' ? Number(restHealed) : NaN;
      const res = await api.post(`/api/characters/${charId}/rest`, {
        type: restSheet,
        hitDiceSpent: restSheet === 'short' ? restHitDice : undefined,
        healedHp: restSheet === 'short' && Number.isFinite(announced) ? announced : undefined,
      });
      const healed = res.data?.healed ?? 0;
      const diceSpent = res.data?.diceSpent ?? 0;
      const resetCount = res.data?.resetFeatures ?? 0;
      const parts: string[] = [];
      if (diceSpent > 0) parts.push(t('survie.de.de.vie.depense', { count: diceSpent }));
      if (healed > 0) parts.push(t('survie.plus.healed.pv', { healed }));
      if (restSheet === 'long') parts.push(t('survie.pv.au.max.emplacements.et.ressources'));
      if (resetCount > 0) parts.push(t('survie.ressource.rechargee', { count: resetCount }));
      onNotice?.(
        `${t(restSheet === 'short' ? 'survie.repos.court.effectue' : 'survie.repos.long.effectue')}${
          parts.length ? ` — ${parts.join(' · ')}` : ''
        }`,
      );
      setRestSheet(null);
      setRestHitDice(0);
      setRestHealed('');
      await onSaved();
    } catch (err: any) {
      onError(err.response?.data?.error || t('survie.erreur.lors.du.repos'));
    } finally {
      setRestBusy(false);
    }
  };

  // --- Châtiment divin (Paladin) : consomme un emplacement de sort ---
  const smiteMaxSlots = computeSpellcastingPools(character).spellcasting;
  const smiteUsed = character.spellSlotsUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const smiteAvailable = smiteMaxSlots
    .map((max, i) => ({
      level: i + 1,
      max,
      used: smiteUsed[i] ?? 0,
      left: max - (smiteUsed[i] ?? 0),
    }))
    .filter((s) => s.left > 0 && s.level >= 1 && s.level <= 5);
  const doSmite = async (slotLevel: number) => {
    const next = [...smiteUsed];
    next[slotLevel - 1] = (next[slotLevel - 1] ?? 0) + 1;
    setSmiteBusy(true);
    markLocalMutation();
    try {
      await api.patch(`/api/characters/${charId}`, { spellSlotsUsed: next });
      const dice = 1 + slotLevel + 1; // 2d8 au niv. 1, +1d8 par niveau au-delà
      onNotice?.(t('survie.chatiment.divin.toast', { dice, slotLevel }));
      setSmiteOpen(false);
      await onSaved();
    } catch {
      onError(t('survie.erreur.lors.du.chatiment.divin'));
    } finally {
      setSmiteBusy(false);
    }
  };

  // --- Pips d'une ressource de classe (même UX que la forme sauvage) ---
  const stepResource = async (feature: CharacterFeature, value: number) => {
    const max = feature.counterMax ?? 0;
    const current = feature.counterCurrent ?? max;
    if (value === current || value < 0 || value > max) return;
    markLocalMutation();
    try {
      await api.patch(`/api/character-features/${feature.id}`, { counterCurrent: value });
      setResourceFeatures((prev) =>
        prev.map((f) => (f.id === feature.id ? { ...f, counterCurrent: value } : f)),
      );
      await onSaved();
    } catch {
      onError(t('survie.erreur.de.mise.a.jour'));
    }
  };

  return (
    <>
      {/* ---------- 1. Vitalité — PV, mort, inspiration/concentration ---------- */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">{t('survie.vitalite')}</h2>
        {/* While shaped, the hero tracks the beast's HP (routed server-side to wild_shape_hp) */}
        {character.wildShapeSlug ? (
          (() => {
            const shapeHp = character.wildShapeHp ?? 0;
            const shapeMax = character.wildShapeMaxHp ?? 1;
            const commitShapeHp = async () => {
              if (shapeHpDraft === null) return;
              const parsed = Number(shapeHpDraft);
              setShapeHpDraft(null);
              // Empty (or unparsable) → rollback to the displayed value, no write.
              if (shapeHpDraft.trim() === '' || !Number.isFinite(parsed)) return;
              // Same ceiling as the regular HP tracker: typed values obey the max.
              const n = Math.min(Math.max(0, Math.round(parsed)), shapeMax);
              if (n === shapeHp) return;
              markLocalMutation();
              try {
                await api.patch(`/api/characters/${charId}`, { currentHp: n });
                await onSaved();
              } catch {
                onError(t('survie.erreur'));
              }
            };
            // Shaped steppers patch immediately — shape HP never triggers a concentration check.
            const stepShapeHp = async (delta: number) => {
              const n = Math.max(0, shapeHp + delta);
              if (n === shapeHp) return;
              markLocalMutation();
              try {
                await api.patch(`/api/characters/${charId}`, { currentHp: n });
                await onSaved();
              } catch {
                onError(t('survie.erreur'));
              }
            };
            return (
              <div className="space-y-3">
                <p className="text-xs text-green-800 text-center">
                  🐾{' '}
                  <strong className="text-green-900">
                    {shapeForms.find((f) => f.slug === character.wildShapeSlug)?.name ??
                      character.wildShapeSlug}
                  </strong>{' '}
                  · {wildShapeDurationHours(character.level ?? 2)} h max
                </p>
                <div className="flex items-center justify-center gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => stepShapeHp(-5)}
                    className="w-11 h-11 max-[379px]:hidden rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold flex items-center justify-center transition-colors"
                    aria-label={t('survie.blesser.la.forme.de.5')}
                  >
                    −5
                  </button>
                  <button
                    type="button"
                    onClick={() => stepShapeHp(-1)}
                    className="w-11 h-11 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-semibold flex items-center justify-center transition-colors"
                    aria-label={t('survie.blesser.la.forme.de.1')}
                  >
                    <span className="max-[379px]:hidden">−1</span>
                    <span className="hidden max-[379px]:inline">−</span>
                  </button>
                  <input
                    type="number"
                    className="w-16 text-center text-lg font-bold font-mono bg-white border border-green-200 rounded-lg py-1 focus:outline-none focus:border-green-500 text-green-900"
                    value={shapeHpDraft ?? String(shapeHp)}
                    onChange={(e) => setShapeHpDraft(e.target.value)}
                    onBlur={commitShapeHp}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    aria-label={t('survie.points.de.vie.de.la.forme')}
                  />
                  <button
                    type="button"
                    onClick={() => stepShapeHp(1)}
                    className="w-11 h-11 rounded-lg bg-green-100 hover:bg-green-200 text-green-700 font-semibold flex items-center justify-center transition-colors"
                    aria-label={t('survie.soigner.la.forme.de.1')}
                  >
                    <span className="max-[379px]:hidden">+1</span>
                    <span className="hidden max-[379px]:inline">+</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => stepShapeHp(5)}
                    className="w-11 h-11 max-[379px]:hidden rounded-lg bg-green-100 hover:bg-green-200 text-green-700 font-semibold flex items-center justify-center transition-colors"
                    aria-label={t('survie.soigner.la.forme.de.5')}
                  >
                    +5
                  </button>
                  <span className="text-sm font-semibold font-mono text-green-700">
                    / {shapeMax}
                  </span>
                </div>
                <HpBar
                  current={shapeHp}
                  max={shapeMax}
                  size="sm"
                  trackClassName="bg-green-100 border border-green-200"
                />
                <p className="text-[10px] text-green-700 italic text-center">
                  {t('survie.a.0.pv.retour.automatique.a')}
                </p>
              </div>
            );
          })()
        ) : (
          <HpTracker
            character={character}
            charId={charId}
            markLocalMutation={markLocalMutation}
            onSaved={onSaved}
            onError={onError}
            onConcentrationCheck={onConcentrationCheck}
          />
        )}
        {/* Death saves live with the HP they belong to — the panel opens only
          when BOTH pools are empty: temp HP remaining means the hit hasn't
          put the character down yet. */}
        {character.currentHp <= 0 && (character.tempHp ?? 0) <= 0 && (
          <DeathSaveTracker
            character={character}
            charId={charId}
            markLocalMutation={markLocalMutation}
            onSaved={onSaved}
            onError={onError}
          />
        )}
        {/* Concentration breaks on damage — its toggle sits one row from the HP steppers.
            Glyph slot has a fixed width so toggling (✧→✨, ◌→🌀) never shifts the layout. */}
        <div className="flex items-center gap-2 max-[379px]:gap-1 flex-wrap">
          <button
            type="button"
            onClick={async () => {
              markLocalMutation();
              try {
                await api.patch(`/api/characters/${charId}`, {
                  inspiration: !character.inspiration,
                });
                await onSaved();
              } catch {
                onError(t('survie.erreur'));
              }
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 max-[379px]:px-1 max-[379px]:gap-1 rounded-lg text-sm max-[379px]:text-xs font-medium transition-colors border ${
              character.inspiration
                ? 'bg-gold-400/20 text-gold-700 border-gold-400'
                : 'bg-parchment-100 text-ink-400 border-parchment-300 hover:border-gold-400'
            }`}
            aria-pressed={character.inspiration}
            title={t('survie.l.inspiration.permet.de.relancer.un')}
          >
            <span className="inline-block w-5 text-center shrink-0 text-base max-[379px]:text-sm">
              {character.inspiration ? '✨' : '✧'}
            </span>
            {t('survie.inspiration')}
          </button>
          <button
            type="button"
            onClick={() =>
              patchCharacter(
                { concentrating: !character.concentrating },
                t('survie.erreur.de.mise.a.jour'),
              )
            }
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 max-[379px]:px-1 max-[379px]:gap-1 rounded-lg text-sm max-[379px]:text-xs font-medium transition-colors border ${
              character.concentrating
                ? 'bg-indigo-100 text-indigo-700 border-indigo-400'
                : 'bg-parchment-100 text-ink-400 border-parchment-300 hover:border-indigo-400'
            }`}
            aria-pressed={character.concentrating}
            title={t('survie.tu.concentres.un.sort.si.tu')}
          >
            <span className="inline-block w-5 text-center shrink-0 text-base max-[379px]:text-sm">
              {character.concentrating ? '🌀' : '◌'}
            </span>
            {t('survie.concentration')}
          </button>
        </div>
      </section>

      {/* ---------- 2. États — conditions + épuisement ---------- */}
      <section className="card p-4 sm:p-5 space-y-4">
        <h2 className="section-title">{t('survie.etats')}</h2>
        <div>
          <span className="text-sm font-medium text-ink-700 block mb-1.5">
            {t('survie.conditions')}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {conditions.length === 0 && (
              <span className="text-xs text-ink-400 italic">{t('survie.aucun.etat.actif')}</span>
            )}
            {conditions.map((cond) => (
              <span
                key={cond}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blood-50 text-blood-800 text-xs font-medium border border-blood-200"
              >
                {conditionLabel(cond)}
                <button
                  type="button"
                  onClick={() => removeCondition(cond)}
                  className="text-blood-500 hover:text-blood-700 font-semibold"
                  aria-label={t('survie.retirer.l.etat.conditionlabel.cond', {
                    conditionLabel: conditionLabel(cond),
                  })}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setConditionPickerOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border border-parchment-300 bg-parchment-100 text-ink-500 hover:border-blood-300 hover:text-blood-700 transition-colors"
              aria-haspopup="dialog"
            >
              {t('survie.ajouter.un.etat')}
            </button>
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-sm font-medium text-ink-700">{t('survie.epuisement')}</span>
            <span className={`text-xs font-semibold ${exhaustionColor(exhaustion)}`}>
              {t('survie.niveau.exhaustion.sur.6', { exhaustion })}
            </span>
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: fieldset would add its own border/margin styling and break the compact pips row. */}
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label={t('survie.niveau.d.epuisement')}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((level) => {
              const active = level <= exhaustion && level > 0;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => setExhaustionLevel(level)}
                  className={`text-2xl leading-none transition-colors ${exhaustionColor(level)} ${
                    active ? 'opacity-100' : 'opacity-30 hover:opacity-60'
                  }`}
                  aria-pressed={level === exhaustion}
                  aria-label={t('survie.niveau.d.epuisement.level', { level: level })}
                  title={t('survie.niveau.level.effet', {
                    level: level,
                    effect: t(`survie.etats.fatigue.${level}`),
                  })}
                >
                  {active ? '◆' : '◇'}
                </button>
              );
            })}
          </div>
          {exhaustion > 0 && (
            <p className="text-xs text-ink-500 mt-1">{t(`survie.etats.fatigue.${exhaustion}`)}</p>
          )}
        </div>
      </section>

      {/* ---------- 3. Ressources de classe — traits du catalogue avec compteur ---------- */}
      {resourceFeatures.length > 0 && (
        <section className="card p-4 sm:p-5 space-y-3">
          <h2 className="section-title">{t('survie.ressources.de.classe')}</h2>
          <div className="space-y-1.5">
            {resourceFeatures.map((feature) => {
              const def = findClassFeature(feature.catalogId ?? '');
              const max = feature.counterMax ?? 0;
              const current = feature.counterCurrent ?? max;
              const isPool = def?.resource?.unit === 'PV';
              // Recharge effective : choix du joueur, sinon règle SRD du catalogue
              // SRD multiclassage : la bascule court/long se juge au niveau de
              // la classe qui accorde la capacité, pas au niveau total.
              const owner = feature.catalogId ? findClassFeatureClass(feature.catalogId) : null;
              const ownerLevel = owner
                ? (classesOf(character).find((c) => c.classKey === owner)?.level ??
                  character.level ??
                  1)
                : (character.level ?? 1);
              const eff = effectiveFeatureReset(feature, ownerLevel);
              const resetTitle =
                eff === 'short'
                  ? t('survie.rechargement.repos.court.ou.long')
                  : eff === 'long'
                    ? t('survie.rechargement.repos.long')
                    : t('survie.rechargement.manuel');
              return (
                <div
                  key={feature.id}
                  className="flex items-center justify-between gap-2 bg-parchment-50 rounded-lg px-3 py-2 border border-parchment-200"
                >
                  <span className="text-sm font-medium text-ink-800 truncate flex items-center gap-1.5">
                    {isPool ? '❤️' : '⚡'} {feature.title}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => stepResource(feature, current - 1)}
                      disabled={current <= 0}
                      className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 text-sm font-medium flex items-center justify-center"
                      aria-label={t('survie.depenser.feature.title', {
                        feature_title: feature.title,
                      })}
                    >
                      −
                    </button>
                    <span className="text-sm font-bold tabular-nums text-ink-800 min-w-10 text-center">
                      {current}
                      <span className="text-ink-400 font-normal">
                        {' '}
                        / {max}
                        {isPool ? t('survie.pv.unite') : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => stepResource(feature, current + 1)}
                      disabled={current >= max}
                      className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 text-sm font-medium flex items-center justify-center"
                      aria-label={t('survie.recuperer.feature.title', {
                        feature_title: feature.title,
                      })}
                      title={resetTitle}
                    >
                      +
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---------- 4. Repos — dés de vie et boutons réunis (l'économie de récupération) ---------- */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">{t('survie.repos')}</h2>
        {(() => {
          // Dés de vie PAR LIGNE DE CLASSE (multiclassage SRD : le pool garde
          // ses types de dés). Le compteur dénormalisé suit la somme.
          const dice = hitDiceByClassOf(character).filter((d) => d.max > 0);
          const total = dice.reduce((sum, d) => sum + d.max, 0);
          const used = dice.reduce((sum, d) => sum + d.used, 0);
          const remaining = Math.max(0, total - used);
          const step = async (delta: number) => {
            markLocalMutation();
            try {
              await api.patch(`/api/characters/${charId}`, {
                hitDiceUsed: Math.min(total, Math.max(0, used + delta)),
              });
              await onSaved();
            } catch {
              onError(t('survie.erreur.de.mise.a.jour'));
            }
          };
          return (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium text-ink-700 flex items-center gap-1.5">
                {t('survie.des.de.vie')}
                {dice.length === 1 ? (
                  <span className="text-xs font-normal text-ink-400">d{dice[0].die}</span>
                ) : (
                  <span className="text-xs font-normal text-ink-400">
                    {dice.map((d) => `d${d.die}`).join(' + ')}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => step(1)}
                  disabled={remaining <= 0}
                  className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 text-sm font-medium flex items-center justify-center"
                  aria-label={t('survie.depenser.un.de.de.vie')}
                  title={t('survie.depenser.un.de.de.vie.repos')}
                >
                  −
                </button>
                <span
                  className={`text-sm font-bold tabular-nums ${remaining === 0 ? 'text-red-500' : 'text-ink-800'}`}
                >
                  {remaining}
                </span>
                <span className="text-xs text-ink-400">/ {total}</span>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  disabled={used <= 0}
                  className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 text-sm font-medium flex items-center justify-center"
                  aria-label={t('survie.recuperer.un.de.de.vie')}
                  title={t('survie.recuperer.un.de.repos.long.niveau')}
                >
                  +
                </button>
              </span>
            </div>
          );
        })()}
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setRestHitDice(0);
                setRestHealed('');
                setRestSheet('short');
              }}
              className="btn-rest-short"
              title={t('survie.emplacements.de.pacte.forme.sauvage.ressources')}
            >
              {t('survie.repos.court')}
            </button>
            <button
              type="button"
              onClick={() => setRestSheet('long')}
              className="btn-rest-long"
              title={t('survie.pv.au.maximum.tous.les.emplacements')}
            >
              {t('survie.repos.long')}
            </button>
          </div>
        )}
      </section>

      {/* ---------- 5. Forme sauvage (Druide ≥ 2) ---------- */}
      {findClass(character.characterClass)?.name === 'Druide' &&
        (character.level ?? 1) >= 2 &&
        (() => {
          const shaped = !!character.wildShapeSlug;
          return (
            <section className="card p-4 sm:p-5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="section-title">{t('survie.forme.sauvage')}</h2>
                {/* biome-ignore lint/a11y/useSemanticElements: fieldset would add its own border/margin styling and break the compact pips row. */}
                <span
                  className="flex items-center gap-0.5"
                  role="group"
                  aria-label={t('survie.utilisations.de.forme.sauvage')}
                >
                  {[1, 2].map((n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={async () => {
                        if ((character.wildShapeUses ?? 2) === n) return;
                        markLocalMutation();
                        try {
                          await api.patch(`/api/characters/${charId}`, { wildShapeUses: n });
                          await onSaved();
                        } catch {
                          onError(t('survie.erreur.de.mise.a.jour'));
                        }
                      }}
                      className={`text-base leading-none px-0.5 transition-opacity ${(character.wildShapeUses ?? 2) >= n ? 'opacity-100' : 'opacity-25 hover:opacity-60'}`}
                      aria-pressed={(character.wildShapeUses ?? 2) >= n}
                      aria-label={t('survie.n.utilisation.n.1.s.de', {
                        n: n,
                        s: n > 1 ? 's' : '',
                      })}
                      title={t('survie.regler.a.n.utilisation.n.1', {
                        n: n,
                        s: n > 1 ? 's' : '',
                      })}
                    >
                      🐾
                    </button>
                  ))}
                </span>
              </div>
              {shaped ? (
                <>
                  <div className="text-xs text-ink-600 flex items-center gap-1.5 flex-wrap">
                    <span>
                      {t('survie.forme.actuelle')}{' '}
                      <strong className="text-ink-900">
                        {shapeForms.find((f) => f.slug === character.wildShapeSlug)?.name ??
                          character.wildShapeSlug}
                      </strong>{' '}
                      · {wildShapeDurationHours(character.level ?? 2)} h max
                    </span>
                    <button
                      type="button"
                      onClick={() => setShapeStatBlock(character.wildShapeSlug)}
                      className="w-7 h-7 rounded-lg bg-parchment-100 hover:bg-gold-100 text-ink-500 hover:text-gold-600 border border-parchment-200 text-sm flex items-center justify-center transition-colors"
                      aria-label={t('survie.voir.le.bloc.de.stats.de', {
                        f_name:
                          shapeForms.find((f) => f.slug === character.wildShapeSlug)?.name ??
                          character.wildShapeSlug,
                      })}
                      title={t('survie.bloc.de.stats.de.la.forme')}
                    >
                      📜
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={revertShape}
                    className="btn-secondary text-xs w-full py-1.5"
                  >
                    {t('survie.revenir.a.la.forme.normale.action')}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-ink-600">
                    {t('survie.betes.jusqu.a.dd.cr', {
                      cr: (() => {
                        const cr = wildShapeMaxCR(character.level ?? 2, character.druidCircle);
                        return cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : cr;
                      })(),
                    })}
                    {character.druidCircle !== 'lune' &&
                      (character.level ?? 2) < 4 &&
                      t('survie.pas.de.nage')}
                    {character.druidCircle !== 'lune' &&
                      (character.level ?? 2) < 8 &&
                      t('survie.pas.de.vol')}
                    {(character.level ?? 2) >= 4 &&
                      character.druidCircle !== 'lune' &&
                      t('survie.nage.seule')}
                    {(character.level ?? 2) >= 8 &&
                      character.druidCircle !== 'lune' &&
                      t('survie.vol.seul')}
                    {t('survie.pv.lances.aux.des.de.la.forme')}
                  </p>
                  {character.druidCircle === 'lune' && (
                    <p className="text-[10px] text-ink-500">
                      {t('survie.lune.note')}
                      {(character.level ?? 2) >= 10 && t('survie.lune.formes.elementaires')}
                      {(character.level ?? 2) >= 6 && t('survie.lune.attaques.magiques')}.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={openShapePicker}
                    disabled={(character.wildShapeUses ?? 2) <= 0}
                    className="btn-primary text-xs w-full py-1.5 disabled:opacity-40"
                  >
                    {t('survie.prendre.une.forme')}
                  </button>
                </>
              )}
            </section>
          );
        })()}

      {/* ---------- 6. Attaques — options équipées, furtive, sans arme ---------- */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">{t('survie.attaques')}</h2>
        {(() => {
          const equippedWeapons = entries.filter((e) => e.equipped && e.item.category === 'weapon');
          if (equippedWeapons.length === 0) return null;
          return (
            <div className="space-y-1.5">
              {equippedWeapons.map((e) => {
                const stats = computeWeaponStats(e.item, character);
                const itemName = e.item.name;
                if (!stats) {
                  return (
                    <div
                      key={e.id}
                      className="flex items-center justify-between bg-parchment-50 rounded-lg px-3 py-2 border border-parchment-200"
                    >
                      <span className="text-sm font-medium text-ink-800 truncate">{itemName}</span>
                      <span className="text-xs text-ink-400">{t('survie.arme.non.resolue')}</span>
                    </div>
                  );
                }
                const abilityLabel =
                  stats.ability === 'dexterity'
                    ? abilityShort('dexterity')
                    : abilityShort('strength');
                const profBonus = proficiencyBonus(character.level ?? 1);
                // Attaque supplémentaire : NON cumulative (SRD multiclassage) — max
                const nAttacks = extraAttacksOf(character);
                const archery = fightingStylesOf(character).has('archery') && stats.ranged ? 2 : 0;
                const breakdown =
                  `d20 ${formatModifier(stats.attackBonus - (stats.proficient ? profBonus : 0) - stats.magicBonus - archery)} (${abilityLabel})` +
                  (stats.proficient ? ` + ${profBonus} ${t('survie.breakdown.maitrise')}` : '') +
                  (archery > 0 ? ` + ${archery} ${t('survie.breakdown.archerie')}` : '') +
                  (stats.magicBonus > 0
                    ? ` + ${stats.magicBonus} ${t('survie.breakdown.magique')}`
                    : '');
                return (
                  <div
                    key={e.id}
                    className="bg-parchment-50 rounded-lg px-3 py-2 border border-parchment-200 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink-800 truncate">{itemName}</span>
                      {!stats.proficient && (
                        <span className="text-[10px] font-semibold text-amber-600 shrink-0">
                          {t('survie.non.qualifie')}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip
                        tone={stats.proficient ? 'blood' : 'amber'}
                        title={t('survie.attaque.breakdown', { breakdown: breakdown })}
                      >
                        🎯 {formatModifier(stats.attackBonus)}
                      </Chip>
                      {nAttacks > 1 && (
                        <Chip
                          tone="blood"
                          className="font-semibold"
                          title={t('survie.nattacks.attaques.par.action.d.attaque', {
                            nAttacks: nAttacks,
                          })}
                        >
                          ×{nAttacks}
                        </Chip>
                      )}
                      {stats.damageStr && (
                        <Chip
                          tone="orange"
                          title={t('survie.degats.stats.damagestr.abilitylabel', {
                            stats_damageStr: stats.damageStr,
                            abilityLabel: abilityLabel,
                          })}
                        >
                          ⚔ {stats.damageStr}
                          {stats.damageTypeFr ? ` ${damageType(stats.damageTypeFr)}` : ''}
                        </Chip>
                      )}
                      {stats.versatileDamageStr && (
                        <Chip tone="orange" soft title={t('survie.degats.a.deux.mains')}>
                          {stats.versatileDamageStr}
                          {t('survie.deux.mains')}
                        </Chip>
                      )}
                      {stats.magicBonus > 0 && (
                        <Chip tone="gold" className="font-semibold">
                          ✨ +{stats.magicBonus}
                        </Chip>
                      )}
                      {stats.critRange < 20 && (
                        <Chip
                          tone="blood"
                          soft
                          title={t('survie.critique.ameliore.champion.touche.critique.sur', {
                            stats_critRange: stats.critRange,
                          })}
                        >
                          🩸 crit {stats.critRange}-20
                        </Chip>
                      )}
                      {findClass(character.characterClass)?.name === 'Paladin' &&
                        (character.level ?? 1) >= 2 &&
                        !stats.ranged &&
                        canEdit && (
                          <button
                            type="button"
                            onClick={() => setSmiteOpen(true)}
                            className="text-[11px] px-2 py-1 rounded-md border border-purple-300 bg-purple-50 text-purple-800 hover:border-purple-500 transition-colors"
                            title={t('survie.depenser.un.emplacement.de.sort.2d8')}
                          >
                            {t('survie.chatiment.divin')}
                          </button>
                        )}
                      {stats.presumedBase && (
                        <span className="text-[10px] text-ink-400 italic">
                          {t('survie.base.presumee')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        {/* Unarmed strike — always available */}
        {classLevelOf(character, 'Roublard') > 0 &&
          (() => {
            const hasFinesseWeapon = entries.some(
              (e) =>
                e.equipped &&
                e.item.category === 'weapon' &&
                (e.item.properties?.includes('finesse') ||
                  e.item.properties?.includes('ammunition')),
            );
            return (
              <div className="bg-parchment-50 rounded-lg px-3 py-2 border border-parchment-200 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink-800 truncate">
                    {t('survie.attaque.furtive')}
                  </span>
                  {!hasFinesseWeapon && (
                    <span className="text-[10px] text-ink-400 shrink-0">
                      {t('survie.arme.de.finesse.ou.a.distance')}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone="orange" title={t('survie.une.fois.par.tour.avec.avantage')}>
                    {t('survie.sneak.degats', {
                      dice: sneakAttackDice(classLevelOf(character, 'Roublard')),
                    })}
                  </Chip>
                  <span className="text-[10px] text-ink-400">{t('survie.une.fois.par.tour')}</span>
                </div>
              </div>
            );
          })()}
        <MonsterStatBlock
          open={!!shapeStatBlock}
          slug={shapeStatBlock}
          onClose={() => setShapeStatBlock(null)}
        />

        {(() => {
          const u = computeUnarmedStats(character);
          const abilityLabel =
            u.ability === 'dexterity' ? abilityShort('dexterity') : abilityShort('strength');
          return (
            <div className="bg-parchment-50 rounded-lg px-3 py-2 border border-parchment-200 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-800 truncate">
                  {t('survie.frappe.sans.arme')}
                </span>
                {u.monk && (
                  <span className="text-[10px] font-semibold text-indigo-600 shrink-0">
                    {t('survie.arts.martiaux')}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip
                  tone="blood"
                  title={t('survie.attaque.d20.formatmodifier.u.attackb.abilitylabel', {
                    formatModifier: formatModifier(
                      u.attackBonus - proficiencyBonus(character.level ?? 1),
                    ),
                    abilityLabel: abilityLabel,
                    proficiencyBonus: proficiencyBonus(character.level ?? 1),
                  })}
                >
                  🎯 {formatModifier(u.attackBonus)}
                </Chip>
                <Chip
                  tone="orange"
                  title={t('survie.degats.u.damagestr.abilitylabel', {
                    u_damageStr: u.damageStr,
                    abilityLabel: abilityLabel,
                  })}
                >
                  ⚔ {u.damageStr} {damageType(u.damageTypeFr)}
                </Chip>
                {u.bonusActionAttack && (
                  <Chip tone="indigo" title={t('survie.arts.martiaux.une.frappe.sans.arme')}>
                    {t('survie.action.bonus')}
                  </Chip>
                )}
              </div>
            </div>
          );
        })()}
      </section>

      {/* ---------- 7. Nourriture & eau ---------- */}
      <section className="card p-4 sm:p-5 space-y-3">
        <h2 className="section-title">{t('survie.nourriture.et.eau')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <DeprivationBox
              label={t('survie.sans.nourriture')}
              days={foodDays}
              icon="🍖"
              onStep={(d) => stepDays('foodDays', d)}
            />
            {foodCount > 0 && canEdit && (
              <button
                type="button"
                onClick={() => consume('food')}
                className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-800 hover:bg-green-200 transition-colors"
              >
                {t('survie.manger.rations', { count: foodCount })}
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <DeprivationBox
              label={t('survie.sans.eau')}
              days={waterDays}
              icon="💧"
              onStep={(d) => stepDays('waterDays', d)}
            />
            {fullWaterCount > 0 && canEdit && (
              <button
                type="button"
                onClick={() => consume('water')}
                className="text-xs px-2 py-1 rounded-lg bg-blue-100 text-blue-800 hover:bg-blue-200 transition-colors"
              >
                {t('survie.boire.pleines', { count: fullWaterCount })}
              </button>
            )}
            {emptyWaterCount > 0 && canEdit && (
              <button
                type="button"
                onClick={refillWater}
                className="text-xs px-2 py-1 rounded-lg bg-cyan-100 text-cyan-800 hover:bg-cyan-200 transition-colors"
              >
                {t('survie.remplir.vides', { count: emptyWaterCount })}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* --- Sheet repos court : dépense de dés de vie + résumé --- */}
      <BottomSheet
        open={restSheet === 'short'}
        onClose={() => setRestSheet(null)}
        title={t('survie.repos.court.1.h')}
        mobileOnly={false}
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={doRest}
              disabled={restBusy}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {restBusy ? '…' : t('survie.se.reposer')}
            </button>
            <button
              type="button"
              onClick={() => setRestSheet(null)}
              className="btn-ghost text-ink-700"
            >
              {t('survie.annuler')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-700">
          <p>{t('survie.recupere.apres.un.repos.court.emplacements')}</p>
          {(() => {
            const dice = hitDiceByClassOf(character).filter((d) => d.max > 0);
            const die = dice.length === 1 ? dice[0].die : 8;
            const total = dice.reduce((sum, d) => sum + d.max, 0);
            const remaining = Math.max(0, total - dice.reduce((sum, d) => sum + d.used, 0));
            const conMod = Math.floor(((character.constitution ?? 10) - 10) / 2);
            return (
              <div className="bg-parchment-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {t('survie.des.de.vie')}
                    {t('survie.des.de.vie.depenses', {
                      diceStr: `d${
                        dice.length === 1 ? die : dice.map((d) => `d${d.die}`).join('+')
                      }${conMod !== 0 ? ` ${conMod > 0 ? '+' : ''}${conMod}` : ''}`,
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setRestHitDice((n) => Math.max(0, n - 1))}
                      disabled={restHitDice <= 0}
                      className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 font-medium"
                      aria-label={t('survie.un.de.de.vie.de.moins')}
                    >
                      −
                    </button>
                    <span className="font-bold tabular-nums w-10 text-center">
                      {restHitDice}
                      <span className="text-ink-400 font-normal"> / {remaining}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setRestHitDice((n) => Math.min(remaining, n + 1))}
                      disabled={restHitDice >= remaining}
                      className="w-7 h-7 rounded-lg bg-parchment-200 hover:bg-parchment-300 disabled:opacity-30 font-medium"
                      aria-label={t('survie.un.de.de.vie.de.plus')}
                    >
                      +
                    </button>
                  </span>
                </div>
                {restHitDice > 0 && (
                  <label className="block">
                    <span className="text-xs font-medium text-ink-500">
                      {t('survie.lance.tes.des.puis.indique', {
                        dice: `${restHitDice}d${die}${
                          conMod !== 0 ? `${conMod > 0 ? '+' : ''}${conMod * restHitDice}` : ''
                        }`,
                      })}
                    </span>
                    <input
                      type="number"
                      min={0}
                      className="input py-1.5 text-sm mt-1"
                      value={restHealed}
                      onChange={(e) => setRestHealed(e.target.value)}
                      placeholder={t('survie.pv.regagnes.ex.23')}
                      inputMode="numeric"
                    />
                    <span className="text-[10px] text-ink-400 block mt-1">
                      {t('survie.le.compteur.de.des.est.mis')}
                    </span>
                  </label>
                )}
              </div>
            );
          })()}
        </div>
      </BottomSheet>

      {/* --- Sheet repos long : résumé de récupération --- */}
      <BottomSheet
        open={restSheet === 'long'}
        onClose={() => setRestSheet(null)}
        title={t('survie.repos.long.8.h')}
        mobileOnly={false}
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={doRest}
              disabled={restBusy}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {restBusy ? '…' : t('survie.se.reposer')}
            </button>
            <button
              type="button"
              onClick={() => setRestSheet(null)}
              className="btn-ghost text-ink-700"
            >
              {t('survie.annuler')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-700">
          <p>{t('survie.apres.un.repos.long.au.plus')}</p>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>{t('survie.tous.tes.pv.les.pv.temporaires')}</li>
            <li>{t('survie.tous.tes.emplacements.de.sort')}</li>
            <li>
              {t('survie.des.de.vie.la.moitie.du.niveau', {
                count: Math.max(1, Math.floor((character.level ?? 1) / 2)),
              })}
            </li>
            {character.exhaustion > 0 && <li>{t('survie.1.niveau.d.epuisement.en.moins')}</li>}
            <li>{t('survie.forme.sauvage.et.toutes.les.ressources')}</li>
            {(character.concentrating ?? false) && (
              <li>{t('survie.la.concentration.prend.fin')}</li>
            )}
          </ul>
          <p className="text-xs text-ink-400">{t('survie.les.etats.et.la.soif.faim')}</p>
        </div>
      </BottomSheet>

      {/* --- Sheet Châtiment divin (Paladin) --- */}
      <BottomSheet
        open={smiteOpen}
        onClose={() => setSmiteOpen(false)}
        title={t('survie.chatiment.divin')}
        mobileOnly={false}
        size="md"
      >
        <div className="space-y-3 text-sm text-ink-700">
          <p>
            {t('survie.quand.tu.touches.avec.une.arme')}
            <strong className="text-purple-800">{t('survie.2d8.degats.radiants')}</strong>
            {t('survie.1d8.par.niveau.d.emplacement.au')}
          </p>
          {smiteAvailable.length === 0 ? (
            <p className="text-ink-400 italic">
              {t('survie.aucun.emplacement.disponible.repos.long.requis')}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {smiteAvailable.map((s) => (
                <button
                  type="button"
                  key={s.level}
                  onClick={() => doSmite(s.level)}
                  disabled={smiteBusy}
                  className="rounded-lg border border-purple-200 bg-purple-50 hover:border-purple-400 px-3 py-2.5 text-left transition-colors disabled:opacity-50"
                >
                  <span className="block font-semibold text-purple-900">
                    {t('survie.emplacement.de.niv.level', { level: s.level })}
                  </span>
                  <span className="block text-xs text-purple-700">
                    {t('survie.d8.radiants.restants', { dice: 2 + s.level, count: s.left })}
                  </span>
                  <span className="block text-[10px] text-purple-500">
                    {t('survie.d8.vs.morts.vivants.fielons', { dice: 3 + s.level })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </BottomSheet>

      {/* --- Ajouter un état — picker 1 tap avec rappel de règle --- */}
      <BottomSheet
        open={conditionPickerOpen}
        onClose={() => setConditionPickerOpen(false)}
        title={t('survie.ajouter.un.etat')}
        mobileOnly={false}
        size="md"
      >
        <div className="space-y-1.5">
          {DND_CONDITIONS_FR.map((cond) => {
            const active = conditions.includes(cond);
            const breaksConcentration = CONCENTRATION_BREAKING_CONDITIONS_FR.includes(cond);
            return (
              <button
                type="button"
                key={cond}
                disabled={active}
                onClick={() => {
                  addCondition(cond);
                  setConditionPickerOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors bg-parchment-50 border-parchment-200 ${
                  active ? 'opacity-60 cursor-not-allowed' : 'hover:border-blood-300'
                }`}
              >
                <span className="text-lg shrink-0" aria-hidden="true">
                  {CONDITION_ICONS[cond] ?? '❓'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-800">
                    {conditionLabel(cond)}
                    {active && (
                      <span className="text-ink-400 font-normal">{t('survie.deja.actif')}</span>
                    )}
                  </span>
                  <span className="block text-xs text-ink-500">{t(conditionHintKey(cond))}</span>
                </span>
                {breaksConcentration && (
                  <span
                    className="text-sm shrink-0 text-indigo-600"
                    title={t('survie.interrompt.la.concentration')}
                  >
                    🌀
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* --- Choisir une forme — bestiaire du druide (BottomSheet partagé : Échap + scroll-lock) --- */}
      <BottomSheet
        open={shapePickerOpen}
        onClose={() => setShapePickerOpen(false)}
        title={t('survie.choisir.une.forme')}
        mobileOnly={false}
        size="md"
      >
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              placeholder={t('survie.rechercher.une.bete')}
              value={shapeSearch}
              onChange={(e) => setShapeSearch(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShapeSeenOnly((v) => !v)}
              className={`shrink-0 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                shapeSeenOnly
                  ? 'bg-green-100 text-green-800 border-green-300'
                  : 'bg-parchment-100 text-ink-500 border-parchment-300'
              }`}
              aria-pressed={shapeSeenOnly}
              title={t('survie.filtrer.sur.les.betes.deja.vues')}
            >
              {t('survie.vues')}
            </button>
          </div>
          <div className="space-y-1.5">
            {shapeForms
              .filter(
                (f) =>
                  (!shapeSeenOnly || f.seen) &&
                  (!shapeSearch.trim() || f.name.toLowerCase().includes(shapeSearch.toLowerCase())),
              )
              .map((f) => (
                <div
                  key={f.slug}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-parchment-200 ${f.seen ? 'bg-parchment-50' : 'bg-parchment-50/40'} transition-colors`}
                >
                  <button
                    type="button"
                    onClick={() => f.seen && takeShape(f.slug)}
                    disabled={!f.seen}
                    className={`min-w-0 flex-1 text-left ${f.seen ? 'hover:opacity-80' : 'cursor-not-allowed'}`}
                    title={f.seen ? t('survie.prendre.cette.forme') : t('survie.bete.non.vue')}
                  >
                    <span
                      className={`text-sm font-medium block truncate ${f.seen ? 'text-ink-800' : 'text-ink-400'}`}
                    >
                      {f.name}
                    </span>
                    <span className="text-[10px] text-ink-400">
                      {t('survie.dd.cr', {
                        cr:
                          f.challengeRating === 0.125
                            ? '1/8'
                            : f.challengeRating === 0.25
                              ? '1/4'
                              : f.challengeRating === 0.5
                                ? '1/2'
                                : f.challengeRating,
                      })}
                      {f.size ? ` · ${f.size}` : ''}
                      {f.fly ? t('survie.forme.vol') : ''}
                      {f.swim ? t('survie.forme.nage') : ''}
                      {!f.seen && t('survie.forme.non.vue')}
                    </span>
                  </button>
                  <span className="text-xs text-ink-500 shrink-0 text-right">
                    ❤ {f.hitPoints ?? '—'}
                    <br />🛡 {f.armorClass ?? '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShapeStatBlock(f.slug)}
                    className="shrink-0 w-8 h-8 rounded-lg bg-parchment-100 hover:bg-gold-100 text-ink-500 hover:text-gold-600 border border-parchment-200 text-sm flex items-center justify-center transition-colors"
                    aria-label={t('survie.voir.le.bloc.de.stats.de', { f_name: f.name })}
                    title={t('survie.bloc.de.stats')}
                  >
                    📜
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleShapeSeen(f.slug, !!f.seen)}
                    className={`shrink-0 w-8 h-8 rounded-lg text-base flex items-center justify-center transition-colors ${
                      f.seen
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-parchment-200 text-ink-400 hover:bg-parchment-300'
                    }`}
                    aria-label={
                      f.seen
                        ? t('survie.marquer.nom.comme.non.vue', { name: f.name })
                        : t('survie.marquer.nom.comme.vue', { name: f.name })
                    }
                    aria-pressed={f.seen}
                    title={
                      f.seen
                        ? t('survie.deja.vue.cliquer.pour.retirer')
                        : t('survie.marquer.comme.vue')
                    }
                  >
                    {f.seen ? '👁' : '⊘'}
                  </button>
                </div>
              ))}
            {shapeForms.length === 0 && (
              <p className="text-sm text-ink-400 italic text-center py-4">
                {t('survie.aucune.forme.disponible.a.ce.niveau')}
              </p>
            )}
            {shapeForms.length > 0 && shapeForms.every((f) => !f.seen) && shapeSeenOnly && (
              <p className="text-xs text-ink-400 italic text-center py-3">
                {t('survie.aucune.bete.marquee.comme.vue.desactivez')}
              </p>
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
