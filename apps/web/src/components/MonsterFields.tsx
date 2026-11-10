/**
 * Panneau « Monstre personnalisé » du pupitre du MD — plan « Contenus
 * personnalisés » (2026-11, PR monstres). Statblock HYBRIDE (Q5a) : noyau
 * combat structuré (CA, PV/dés de vie, caracs 6, FP, vitesses, résistances)
 * + traits/actions en listes nom + texte libre. Le PX et le bonus de
 * maîtrise sont DÉRIVÉS du FP (tables SRD 5.1) et affichés en chips —
 * jamais saisis. Helper, pas automation : rien n'est jeté pour le MD.
 *
 * Le draft vit dans le state du modal hôte (gabarit WeaponFields) ; l'aperçu
 * embarqué (pied de modal) rend le VRAI MonsterStatBlock sur le bloc dérivé
 * du draft — le MD voit la fiche que le traqueur ouvrira.
 */
import {
  DND_CONDITIONS_FR,
  MONSTER_CR_VALUES,
  MONSTER_TYPES_FR,
  MONSTER_SIZE_LABELS_FR,
  abilityModifier,
  formatCR,
  monsterProficiencyBonus,
  monsterXpForCR,
} from '@table-sync/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from './ui';
import { Glyph } from './Glyph';

/** Types de dégâts SRD FR (résistances/immunités — affichage seul). */
const DAMAGE_TYPES_FR = [
  'contondant',
  'perforant',
  'tranchant',
  'acide',
  'froid',
  'feu',
  'foudre',
  'tonnerre',
  'nécrotique',
  'radiant',
  'psychique',
  'poison',
  'force',
] as const;

const ABILITY_KEYS = ['for', 'dex', 'con', 'int', 'sag', 'cha'] as const;
const SPEED_MODES = [
  { key: 'walk', label: 'monstrecustom.vitesse.marche' },
  { key: 'fly', label: 'bestiaire.vitesse.vol' },
  { key: 'swim', label: 'bestiaire.vitesse.nage' },
  { key: 'climb', label: 'bestiaire.vitesse.escalade' },
  { key: 'burrow', label: 'bestiaire.vitesse.creusement' },
] as const;

/** Ligne nom + texte libre (trait ou action). */
export interface MonsterEntryDraft {
  name: string;
  text: string;
}

/** Brouillon de monstre — porté par le state du modal hôte. */
export interface MonsterDraft {
  nameFr: string;
  type: string;
  size: string;
  alignment: string;
  armorClass: string;
  armorDesc: string;
  hitPoints: string;
  hitDice: string;
  speed: Record<(typeof SPEED_MODES)[number]['key'], string>;
  abilities: Record<(typeof ABILITY_KEYS)[number], string>;
  challengeRating: number;
  traits: MonsterEntryDraft[];
  actions: MonsterEntryDraft[];
  damageResistances: string[];
  damageImmunities: string[];
  conditionImmunities: string[];
  senses: string;
  languages: string;
}

/** Draft vierge — l'hôte le pose à chaque ouverture en création. */
export const EMPTY_MONSTER_DRAFT: MonsterDraft = {
  nameFr: '',
  type: 'Humanoïde',
  size: 'M',
  alignment: '',
  armorClass: '10',
  armorDesc: '',
  hitPoints: '10',
  hitDice: '',
  speed: { walk: '9', fly: '', swim: '', climb: '', burrow: '' },
  abilities: { for: '10', dex: '10', con: '10', int: '10', sag: '10', cha: '10' },
  challengeRating: 0,
  traits: [],
  actions: [],
  damageResistances: [],
  damageImmunities: [],
  conditionImmunities: [],
  senses: '',
  languages: '',
};

const HIT_DICE_RE = /^(\d{1,3})d(\d{1,2})([+-]\d{1,4})?$/;

/** Le noyau parse-t-il ? (double barrière : l'API revalide à 400.) */
export function monsterDraftValid(d: MonsterDraft): boolean {
  const ac = Number(d.armorClass);
  const hp = Number(d.hitPoints);
  if (!d.nameFr.trim()) return false;
  if (!Number.isInteger(ac) || ac < 1 || ac > 30) return false;
  if (!Number.isInteger(hp) || hp < 1) return false;
  const dice = d.hitDice.trim();
  if (dice !== '' && !HIT_DICE_RE.test(dice)) return false;
  for (const key of ABILITY_KEYS) {
    const v = Number(d.abilities[key]);
    if (!Number.isInteger(v) || v < 1 || v > 30) return false;
  }
  return true;
}

/** PV moyens dérivés des dés (« 10d8+20 » → 65) — chip mono, même règle que
 *  la colonne PV du bestiaire SRD. */
export function averageHp(dice: string, fallback: number): number | null {
  const m = HIT_DICE_RE.exec(dice.trim());
  if (!m) return null;
  const avg = (parseInt(m[1], 10) * (parseInt(m[2], 10) + 1)) / 2 + (m[3] ? parseInt(m[3], 10) : 0);
  return avg >= 1 ? Math.floor(avg) : fallback;
}

/** Hydrate le draft depuis un monstre servi (édition MD). */
export function monsterDraftFromMonster(m: {
  name: string;
  type: string;
  size: string;
  alignment?: string | null;
  armorClass: number;
  armorDesc?: string | null;
  hitPoints: number;
  hitDice?: string | null;
  speed?: Record<string, number>;
  abilities: Record<string, number>;
  challengeRating: number;
  traits?: { name: string; desc: string }[];
  actions?: { name: string; desc: string }[];
  damageResistances?: string[] | null;
  damageImmunities?: string[] | null;
  conditionImmunities?: string[] | null;
  senses?: string | null;
  languages?: string[];
}): MonsterDraft {
  const speed = { ...EMPTY_MONSTER_DRAFT.speed };
  for (const mode of SPEED_MODES) {
    const v = m.speed?.[mode.key];
    speed[mode.key] = v !== undefined && v !== null ? String(v) : '';
  }
  const abilities = { ...EMPTY_MONSTER_DRAFT.abilities };
  for (const key of ABILITY_KEYS) abilities[key] = String(m.abilities?.[key] ?? 10);
  return {
    nameFr: m.name,
    type: (MONSTER_TYPES_FR as readonly string[]).includes(m.type) ? m.type : 'Humanoïde',
    size: m.size in MONSTER_SIZE_LABELS_FR ? m.size : 'M',
    alignment: m.alignment ?? '',
    armorClass: String(m.armorClass),
    armorDesc: m.armorDesc ?? '',
    hitPoints: String(m.hitPoints),
    hitDice: m.hitDice ?? '',
    speed,
    abilities,
    challengeRating: m.challengeRating,
    traits: (m.traits ?? []).map((e) => ({ name: e.name, text: e.desc })),
    actions: (m.actions ?? []).map((e) => ({ name: e.name, text: e.desc })),
    damageResistances: [...(m.damageResistances ?? [])],
    damageImmunities: [...(m.damageImmunities ?? [])],
    conditionImmunities: [...(m.conditionImmunities ?? [])],
    senses: m.senses ?? '',
    languages: (m.languages ?? []).join(', '),
  };
}

/** Champs prêts pour la payload POST/PATCH (miroir du contrat API). */
export function monsterDraftPayload(d: MonsterDraft) {
  const speed: Record<string, number> = {};
  for (const mode of SPEED_MODES) {
    const v = Number(d.speed[mode.key]);
    if (d.speed[mode.key].trim() !== '' && Number.isFinite(v) && v > 0) speed[mode.key] = v;
  }
  const abilities: Record<string, number> = {};
  for (const key of ABILITY_KEYS) abilities[key] = Number(d.abilities[key]);
  return {
    nameFr: d.nameFr.trim(),
    type: d.type,
    size: d.size,
    alignment: d.alignment.trim() || null,
    armorClass: Number(d.armorClass),
    armorDesc: d.armorDesc.trim() || null,
    hitPoints: Number(d.hitPoints),
    hitDice: d.hitDice.trim() || null,
    speed,
    abilities,
    challengeRating: d.challengeRating,
    traits: d.traits.filter((e) => e.name.trim() && e.text.trim()),
    actions: d.actions.filter((e) => e.name.trim() && e.text.trim()),
    damageResistances: d.damageResistances,
    damageImmunities: d.damageImmunities,
    conditionImmunities: d.conditionImmunities,
    senses: d.senses.trim() || null,
    languages: d.languages,
  };
}

export function MonsterFields({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const { t } = useTranslation();
  const hitDiceInvalid = draft.hitDice.trim() !== '' && !HIT_DICE_RE.test(draft.hitDice.trim());
  const avgHp = useMemo(
    () => averageHp(draft.hitDice, Number(draft.hitPoints) || 0),
    [draft.hitDice, draft.hitPoints],
  );
  const xp = monsterXpForCR(draft.challengeRating);
  const prof = monsterProficiencyBonus(draft.challengeRating);

  const toggleIn = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const entryEditor = (entries: MonsterEntryDraft[], kind: 'trait' | 'action') => (
    <div className="space-y-2">
      {entries.map((entry, i) => (
        <div
          key={i}
          className="rounded-lg border border-parchment-200 bg-parchment-50 p-2 space-y-1.5"
        >
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={entry.name}
              onChange={(e) => {
                const next = [...entries];
                next[i] = { ...entry, name: e.target.value };
                onChange(
                  kind === 'trait' ? { ...draft, traits: next } : { ...draft, actions: next },
                );
              }}
              placeholder={t(kind === 'trait' ? 'monstrecustom.trait' : 'monstrecustom.action')}
              aria-label={`${t(kind === 'trait' ? 'monstrecustom.trait' : 'monstrecustom.action')} ${i + 1}`}
            />
            <button
              type="button"
              onClick={() =>
                onChange(
                  kind === 'trait'
                    ? { ...draft, traits: entries.filter((_, j) => j !== i) }
                    : { ...draft, actions: entries.filter((_, j) => j !== i) },
                )
              }
              className="btn-ghost text-ink-400 hover:text-red-700 min-w-11 min-h-11 shrink-0"
              aria-label={t('monstrecustom.retirer', {
                label: entry.name || `${i + 1}`,
              })}
            >
              <Glyph name="close" />
            </button>
          </div>
          <textarea
            className="input text-sm"
            rows={2}
            value={entry.text}
            onChange={(e) => {
              const next = [...entries];
              next[i] = { ...entry, text: e.target.value };
              onChange(kind === 'trait' ? { ...draft, traits: next } : { ...draft, actions: next });
            }}
            placeholder={t('monstrecustom.texte.libre')}
            aria-label={`${t('monstrecustom.texte.de', { label: entry.name || `${i + 1}` })}`}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange(
            kind === 'trait'
              ? { ...draft, traits: [...draft.traits, { name: '', text: '' }] }
              : { ...draft, actions: [...draft.actions, { name: '', text: '' }] },
          )
        }
        className="btn-secondary min-h-11 text-sm"
      >
        {t(kind === 'trait' ? 'monstrecustom.trait.ajouter' : 'monstrecustom.action.ajouter')}
      </button>
    </div>
  );

  const chipSelect = (
    label: string,
    options: readonly string[],
    selected: string[],
    onToggle: (v: string) => void,
  ) => (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const checked = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              aria-pressed={checked}
              className={`min-h-11 px-3 rounded-full border text-xs font-medium transition-colors ${
                checked
                  ? 'bg-ink-100 border-ink-300 text-ink-700 font-semibold'
                  : 'bg-parchment-100 border-parchment-300 text-ink-500 hover:bg-parchment-200'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* --- Identité --- */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2 sm:col-span-1">
          <span className="label">{t('monstrecustom.nom')}</span>
          <input
            className="input"
            value={draft.nameFr}
            onChange={(e) => onChange({ ...draft, nameFr: e.target.value })}
            placeholder={t('monstrecustom.nom.exemple')}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="label">{t('monstrecustom.type')}</span>
          <select
            className="input"
            value={draft.type}
            onChange={(e) => onChange({ ...draft, type: e.target.value })}
          >
            {MONSTER_TYPES_FR.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('monstrecustom.taille')}</span>
          <select
            className="input"
            value={draft.size}
            onChange={(e) => onChange({ ...draft, size: e.target.value })}
          >
            {Object.entries(MONSTER_SIZE_LABELS_FR).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('monstrecustom.alignement')}</span>
          <input
            className="input"
            value={draft.alignment}
            onChange={(e) => onChange({ ...draft, alignment: e.target.value })}
            placeholder={t('monstrecustom.alignement.exemple')}
          />
        </label>
      </div>

      {/* --- Noyau combat --- */}
      <div>
        <span className="section-title">{t('monstrecustom.noyau.combat')}</span>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">{t('monstrecustom.ca')}</span>
            <input
              type="number"
              inputMode="numeric"
              className="input"
              value={draft.armorClass}
              onChange={(e) => onChange({ ...draft, armorClass: e.target.value })}
              min={1}
              max={30}
            />
          </label>
          <label className="block">
            <span className="label">{t('monstrecustom.ca.desc')}</span>
            <input
              className="input"
              value={draft.armorDesc}
              onChange={(e) => onChange({ ...draft, armorDesc: e.target.value })}
              placeholder={t('monstrecustom.ca.desc.exemple')}
            />
          </label>
          <label className="block">
            <span className="label">{t('monstrecustom.pv')}</span>
            <input
              type="number"
              inputMode="numeric"
              className="input"
              value={draft.hitPoints}
              onChange={(e) => onChange({ ...draft, hitPoints: e.target.value })}
              min={1}
            />
          </label>
          <label className="block">
            <span className="label">{t('monstrecustom.des.de.vie')}</span>
            <input
              className={`input font-mono ${hitDiceInvalid ? 'border-orange-400' : ''}`}
              value={draft.hitDice}
              onChange={(e) => onChange({ ...draft, hitDice: e.target.value })}
              placeholder="10d8+20"
              aria-invalid={hitDiceInvalid || undefined}
              aria-describedby={hitDiceInvalid ? 'monster-hitdice-error' : undefined}
            />
            {hitDiceInvalid && (
              <span id="monster-hitdice-error" className="block text-xs text-orange-700 mt-1">
                {t('monstrecustom.des.de.vie.invalide')}
              </span>
            )}
          </label>
        </div>
        {avgHp !== null && !hitDiceInvalid && (
          <p className="text-xs text-ink-400 mt-1.5 font-mono">
            {t('monstrecustom.pv.moyens', { hp: avgHp })}
          </p>
        )}
      </div>

      {/* 6 caractéristiques : grille 2×3 sur mobile (reco plan §6 Q3),
          modificateurs dérivés en mono sous chaque score. */}
      <div>
        <span className="section-title">{t('monstrecustom.caracteristiques')}</span>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ABILITY_KEYS.map((key) => (
            <label key={key} className="block">
              <span className="label uppercase">{key}</span>
              <input
                type="number"
                inputMode="numeric"
                className="input text-center"
                value={draft.abilities[key]}
                onChange={(e) =>
                  onChange({ ...draft, abilities: { ...draft.abilities, [key]: e.target.value } })
                }
                min={1}
                max={30}
                aria-label={t('monstrecustom.carac.aria', { key })}
              />
              <span className="block text-center text-xs text-ink-400 mt-0.5 font-mono">
                {abilityModifier(Number(draft.abilities[key])) >= 0 ? '+' : ''}
                {abilityModifier(Number(draft.abilities[key]))}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* FP : PX et bonus de maîtrise DÉRIVÉS (chips mono, jamais saisis). */}
      <div>
        <span className="section-title">{t('monstrecustom.fp')}</span>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="block w-32">
            <span className="label">{t('monstrecustom.fp.court')}</span>
            <select
              className="input"
              value={String(draft.challengeRating)}
              onChange={(e) => onChange({ ...draft, challengeRating: Number(e.target.value) })}
            >
              {MONSTER_CR_VALUES.map((cr) => (
                <option key={cr} value={cr}>
                  {formatCR(cr)}
                </option>
              ))}
            </select>
          </label>
          <Chip tone="orange" soft title={t('monstrecustom.xp.aide')}>
            {xp.toLocaleString('fr-FR')} PX
          </Chip>
          <Chip tone="orange" soft title={t('monstrecustom.bonus.aide')}>
            {t('monstrecustom.bonus.derive', { n: prof })}
          </Chip>
        </div>
      </div>

      {/* --- Vitesse & perception --- */}
      <div>
        <span className="section-title">{t('monstrecustom.vitesses')}</span>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SPEED_MODES.map((mode) => (
            <label key={mode.key} className="block">
              <span className="label">{t(mode.label)}</span>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                value={draft.speed[mode.key]}
                onChange={(e) =>
                  onChange({ ...draft, speed: { ...draft.speed, [mode.key]: e.target.value } })
                }
                min={0}
                max={150}
                placeholder="0"
              />
            </label>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">{t('monstrecustom.sens')}</span>
            <input
              className="input"
              value={draft.senses}
              onChange={(e) => onChange({ ...draft, senses: e.target.value })}
              placeholder={t('monstrecustom.sens.exemple')}
            />
          </label>
          <label className="block">
            <span className="label">{t('monstrecustom.langues')}</span>
            <input
              className="input"
              value={draft.languages}
              onChange={(e) => onChange({ ...draft, languages: e.target.value })}
              placeholder={t('monstrecustom.langues.exemple')}
            />
          </label>
        </div>
      </div>

      {/* --- Défenses : affichage seul, jamais appliqué automatiquement --- */}
      <div className="space-y-3">
        <span className="section-title">{t('monstrecustom.defenses')}</span>
        {chipSelect(t('monstrecustom.resistances'), DAMAGE_TYPES_FR, draft.damageResistances, (v) =>
          onChange({ ...draft, damageResistances: toggleIn(draft.damageResistances, v) }),
        )}
        {chipSelect(
          t('monstrecustom.immunites.degats'),
          DAMAGE_TYPES_FR,
          draft.damageImmunities,
          (v) => onChange({ ...draft, damageImmunities: toggleIn(draft.damageImmunities, v) }),
        )}
        {chipSelect(
          t('monstrecustom.immunites.conditions'),
          DND_CONDITIONS_FR,
          draft.conditionImmunities,
          (v) =>
            onChange({ ...draft, conditionImmunities: toggleIn(draft.conditionImmunities, v) }),
        )}
      </div>

      {/* --- Traits & actions : listes nom + texte libre --- */}
      <div className="space-y-2">
        <span className="section-title">{t('monstrecustom.traits')}</span>
        {entryEditor(draft.traits, 'trait')}
      </div>
      <div className="space-y-2">
        <span className="section-title">{t('monstrecustom.actions')}</span>
        {entryEditor(draft.actions, 'action')}
      </div>
    </div>
  );
}
