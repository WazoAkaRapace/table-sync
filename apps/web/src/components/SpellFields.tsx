/**
 * Panneau « Sort personnalisé » du pupitre du MD — plan « Contenus
 * personnalisés » (2026-11, PR3 sorts). L'ordre des champs suit la fiche de
 * sort SRD (reco plan frontend §6 Q1) : identité → incantation → classes →
 * effet → incantation supérieure → texte. « Toutes les classes » est encodée
 * en liste explicite des 13 classes SRD (position 6 du plan archi) — le
 * filtre du grimoire reste le seul chemin.
 *
 * L'éditeur d'effet reste SIMPLE (YAGNI) : dés à niveau natif + raccourci
 * « +Nd6 par cran », développé en table damage_at_slot_level/heal_at_slot_level
 * côté serveur — le CONTRAT exact que le CastSpellSheet lit déjà. La double
 * barrière valide à la frappe via parseDamageTemplate (orange), l'API
 * revalide à 400.
 *
 * Le draft vit dans le state du modal hôte (gabarit MonsterFields) ; l'aperçu
 * embarqué (pied de modal, porté par l'hôte) relit le damage_json construit
 * par buildSpellDamageJson via spellDamageAtLevel — même lecture que la
 * feuille d'incantation du joueur.
 */
import {
  DND_CLASSES,
  DAMAGE_TYPE_LABELS_FR,
  SPELL_SCHOOL_LABELS_FR,
  parseDamageTemplate,
} from '@table-sync/shared';
import { useTranslation } from 'react-i18next';
import { classNameLabel, schoolLabel } from '../i18n/labels';
import { Chip } from './ui';
import { Glyph } from './Glyph';
import type { Spell } from '@table-sync/shared';

/** Les 13 classes SRD — « Toutes les classes » = cette liste explicite. */
export const ALL_CLASSES = DND_CLASSES.map((c) => c.name);

const SCHOOL_KEYS = Object.keys(SPELL_SCHOOL_LABELS_FR) as (keyof typeof SPELL_SCHOOL_LABELS_FR)[];
/**
 * Types de dégâts du sélecteur — INDEX du damage_json (minuscules, le
 * CastSpellSheet lit damage_type.index) ; les libellés FR viennent de
 * DAMAGE_TYPE_LABELS_FR (clés capitalisées).
 */
const DAMAGE_TYPE_LABELS = Object.fromEntries(
  Object.entries(DAMAGE_TYPE_LABELS_FR).map(([k, v]) => [k.toLowerCase(), v]),
);
const DAMAGE_TYPE_KEYS = Object.keys(DAMAGE_TYPE_LABELS);
const DC_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const DC_ABILITY_SHORT: Record<string, string> = {
  str: 'FOR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'SAG',
  cha: 'CHA',
};

/** Brouillon de sort — porté par le state du modal hôte. */
export interface SpellDraft {
  name: string;
  level: number;
  school: string;
  castingTime: string;
  rangeText: string;
  duration: string;
  components: string[];
  material: string;
  concentration: boolean;
  ritual: boolean;
  classes: string[];
  attackType: '' | 'melee' | 'ranged';
  /** Dés de dégâts à niveau natif (« 3d6 ») — vide = pas de dégâts chiffrés. */
  damageDice: string;
  damageType: string;
  /** Raccourci d'upcast « +Nd6 par cran » — développé serveur en table. */
  upcastDice: string;
  healDice: string;
  healUpcastDice: string;
  healAddsModifier: boolean;
  dcAbility: '' | (typeof DC_ABILITIES)[number];
  dcSuccess: '' | 'half' | 'none' | 'other';
  description: string;
  higherLevel: string;
}

/** Draft vierge — l'hôte le pose à chaque ouverture en création. */
export const EMPTY_SPELL_DRAFT: SpellDraft = {
  name: '',
  level: 1,
  school: 'evocation',
  // Vides : les placeholders des champs portent les exemples SRD (i18n).
  castingTime: '',
  rangeText: '',
  duration: '',
  components: ['V', 'S'],
  material: '',
  concentration: false,
  ritual: false,
  classes: ['Magicien'],
  attackType: '',
  damageDice: '',
  damageType: 'fire',
  upcastDice: '',
  healDice: '',
  healUpcastDice: '',
  healAddsModifier: false,
  dcAbility: '',
  dcSuccess: '',
  description: '',
  higherLevel: '',
};

/** Le dés sont-ils valides (double barrière : l'API revalide à 400) ? */
function diceValid(v: string): boolean {
  const s = v.trim();
  return s === '' || parseDamageTemplate(s.replace(/\s+/g, '')) !== null;
}

/** Le draft parse-t-il ? (nom + classes + dés valides + DD cohérente). */
export function spellDraftValid(d: SpellDraft): boolean {
  if (!d.name.trim()) return false;
  if (d.classes.length === 0) return false;
  if (!diceValid(d.damageDice) || !diceValid(d.upcastDice)) return false;
  if (!diceValid(d.healDice) || !diceValid(d.healUpcastDice)) return false;
  if (d.damageDice.trim() !== '' && !d.damageType) return false;
  if ((d.dcAbility === '') !== (d.dcSuccess === '')) return false;
  return true;
}

/** Parse un damage_json servi → dés natifs + incrément par cran (si uniforme). */
function effectFromJson(
  damageJson: string | null,
  tableKey: 'damage_at_slot_level' | 'heal_at_slot_level',
  level: number,
): { dice: string; perSlot: string } {
  if (!damageJson) return { dice: '', perSlot: '' };
  try {
    const d = JSON.parse(damageJson) as Record<string, any>;
    const table = d?.[tableKey];
    if (!table || typeof table !== 'object') return { dice: '', perSlot: '' };
    const keys = Object.keys(table)
      .map(Number)
      .sort((a, b) => a - b);
    const dice = table[String(Math.max(level, keys[0]))] ?? '';
    // Incrément par cran : diff des dés entre niveaux consécutifs, s'il est
    // uniforme (« 8d6→9d6 » → « 1d6 ») ; sinon le raccourci reste vide (la
    // table explicite est conservée via spellDraftPayload → atSlotLevel).
    let perSlot = '';
    if (keys.length > 1) {
      const count = (tpl: string, faces: number): number => {
        const m = new RegExp(`(\\d+)d${faces}\\b`).exec(String(tpl).replace(/\s+/g, ''));
        return m ? parseInt(m[1], 10) : 0;
      };
      const facesMatch = /(\d+)d(\d+)/.exec(String(dice).replace(/\s+/g, ''));
      if (facesMatch) {
        const faces = parseInt(facesMatch[2], 10);
        let inc = -1;
        let uniform = true;
        for (let i = 1; i < keys.length; i++) {
          const a = count(table[String(keys[i - 1])], faces);
          const b = count(table[String(keys[i])], faces);
          if (a === 0 || b === 0 || b - a !== (inc === -1 ? b - a : inc)) uniform = false;
          inc = b - a;
        }
        if (uniform && inc > 0) perSlot = `${inc}d${faces}`;
      }
    }
    return { dice: String(dice), perSlot };
  } catch {
    return { dice: '', perSlot: '' };
  }
}

/** Hydrate le draft depuis un sort servi (édition MD). */
export function spellDraftFromSpell(s: Spell): SpellDraft {
  let dcAbility: SpellDraft['dcAbility'] = '';
  let dcSuccess: SpellDraft['dcSuccess'] = '';
  try {
    const dc = s.dcJson ? (JSON.parse(s.dcJson) as Record<string, any>) : null;
    if (dc?.dc_type?.index && DC_ABILITIES.includes(dc.dc_type.index)) {
      dcAbility = dc.dc_type.index;
      dcSuccess = (['half', 'none', 'other'].includes(dc.dc_success) ? dc.dc_success : '') as SpellDraft['dcSuccess'];
    }
  } catch {
    // dc_json illisible : champs vides
  }
  let damageType = EMPTY_SPELL_DRAFT.damageType;
  try {
    const d = s.damageJson ? (JSON.parse(s.damageJson) as Record<string, any>) : null;
    if (d?.damage_type?.index && DAMAGE_TYPE_KEYS.includes(d.damage_type.index)) {
      damageType = d.damage_type.index;
    }
  } catch {
    // damage_json illisible : type par défaut
  }
  const damage = effectFromJson(s.damageJson, 'damage_at_slot_level', s.level);
  const heal = effectFromJson(s.damageJson, 'heal_at_slot_level', s.level);
  let healAddsModifier = false;
  try {
    const d = s.damageJson ? (JSON.parse(s.damageJson) as Record<string, any>) : null;
    healAddsModifier = d?.heal_adds_modifier === true;
  } catch {
    healAddsModifier = false;
  }
  return {
    name: s.name,
    level: s.level,
    school: SCHOOL_KEYS.includes(s.school as keyof typeof SPELL_SCHOOL_LABELS_FR) ? s.school : 'evocation',
    castingTime: s.castingTime ?? '',
    rangeText: s.rangeText ?? '',
    duration: s.duration ?? '',
    components: (s.components ?? []).filter((c) => ['V', 'S', 'M'].includes(c)),
    material: s.material ?? '',
    concentration: s.concentration,
    ritual: s.ritual,
    classes: (s.classes ?? []).filter((c) => ALL_CLASSES.includes(c)),
    attackType: s.attackType === 'melee' || s.attackType === 'ranged' ? s.attackType : '',
    damageDice: damage.dice,
    damageType,
    upcastDice: damage.perSlot,
    healDice: heal.dice,
    healUpcastDice: heal.perSlot,
    healAddsModifier,
    dcAbility,
    dcSuccess,
    description: s.description ?? '',
    higherLevel: s.higherLevel ?? '',
  };
}

/** Champs prêts pour la payload POST/PATCH (miroir du contrat API). */
export function spellDraftPayload(d: SpellDraft) {
  const effect = (dice: string, perSlot: string) =>
    dice.trim() === '' && perSlot.trim() === ''
      ? undefined
      : {
          dice: dice.trim() === '' ? undefined : dice.trim(),
          ...(perSlot.trim() !== '' ? { perSlotLevel: perSlot.trim() } : {}),
        };
  return {
    name: d.name.trim(),
    level: d.level,
    school: d.school,
    castingTime: d.castingTime.trim() || null,
    rangeText: d.rangeText.trim() || null,
    duration: d.duration.trim() || null,
    components: d.components,
    material: d.components.includes('M') ? d.material.trim() || null : null,
    concentration: d.concentration,
    ritual: d.ritual,
    classes: d.classes,
    attackType: d.attackType || null,
    damageType: d.damageDice.trim() !== '' ? d.damageType : null,
    damage: effect(d.damageDice, d.upcastDice),
    heal: effect(d.healDice, d.healUpcastDice),
    healAddsModifier: d.healDice.trim() !== '' && d.healAddsModifier,
    dc:
      d.dcAbility && d.dcSuccess
        ? { ability: d.dcAbility, success: d.dcSuccess }
        : { ability: null, success: null },
    description: d.description.trim() || null,
    higherLevel: d.higherLevel.trim() || null,
  };
}

export function SpellFields({
  draft,
  onChange,
}: {
  draft: SpellDraft;
  onChange: (draft: SpellDraft) => void;
}) {
  const { t } = useTranslation();
  const allClasses = draft.classes.length === ALL_CLASSES.length;
  const damageInvalid = !diceValid(draft.damageDice) || !diceValid(draft.upcastDice);
  const healInvalid = !diceValid(draft.healDice) || !diceValid(draft.healUpcastDice);

  const toggleIn = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const toggleClass = (name: string) => {
    if (allClasses) {
      // « Toutes » armée : repartir de la liste explicite complète moins le clic.
      onChange({ ...draft, classes: ALL_CLASSES.filter((c) => c !== name) });
      return;
    }
    const next = toggleIn(draft.classes, name);
    onChange({ ...draft, classes: next });
  };

  const toggleAllClasses = () => {
    onChange({ ...draft, classes: allClasses ? [] : [...ALL_CLASSES] });
  };

  return (
    <div className="space-y-4">
      {/* --- Identité --- */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2 sm:col-span-1">
          <span className="label">{t('sortcustom.nom')}</span>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder={t('sortcustom.nom.exemple')}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="label">{t('sortcustom.niveau')}</span>
          <select
            id="spell-level-input"
            className="input"
            value={String(draft.level)}
            onChange={(e) => onChange({ ...draft, level: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
              <option key={l} value={l}>
                {l === 0 ? t('sorts.tour') : t('sorts.niveau.level', { level: l })}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('sortcustom.ecole')}</span>
          <select
            id="spell-school-input"
            className="input"
            value={draft.school}
            onChange={(e) => onChange({ ...draft, school: e.target.value })}
          >
            {SCHOOL_KEYS.map((key) => (
              <option key={key} value={key}>
                {schoolLabel(key)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* --- Incantation --- */}
      <div>
        <span className="section-title">{t('sortcustom.incantation.section')}</span>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="label">{t('sortcustom.incantation')}</span>
            <input
              id="spell-casting-time-input"
              className="input"
              value={draft.castingTime}
              onChange={(e) => onChange({ ...draft, castingTime: e.target.value })}
              placeholder="1 action"
            />
          </label>
          <label className="block">
            <span className="label">{t('sortcustom.portee')}</span>
            <input
              id="spell-range-input"
              className="input"
              value={draft.rangeText}
              onChange={(e) => onChange({ ...draft, rangeText: e.target.value })}
              placeholder="18 m"
            />
          </label>
          <label className="block">
            <span className="label">{t('sortcustom.duree')}</span>
            <input
              id="spell-duration-input"
              className="input"
              value={draft.duration}
              onChange={(e) => onChange({ ...draft, duration: e.target.value })}
              placeholder={t('sortcustom.duree.exemple')}
            />
          </label>
        </div>
        <div className="mt-2 space-y-2">
          <div>
            <span className="label">{t('sortcustom.composantes')}</span>
            <div className="flex flex-wrap gap-1.5">
              {(['V', 'S', 'M'] as const).map((c) => {
                const checked = draft.components.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      const next = toggleIn(draft.components, c);
                      onChange({ ...draft, components: next });
                    }}
                    aria-pressed={checked}
                    className={`min-h-11 px-4 rounded-full border text-xs font-medium transition-colors ${
                      checked
                        ? 'bg-ink-100 border-ink-300 text-ink-700 font-semibold'
                        : 'bg-parchment-100 border-parchment-300 text-ink-500 hover:bg-parchment-200'
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
          {draft.components.includes('M') && (
            <label className="block">
              <span className="label">{t('sortcustom.materiel')}</span>
              <input
                id="spell-material-input"
                className="input"
                value={draft.material}
                onChange={(e) => onChange({ ...draft, material: e.target.value })}
                placeholder={t('sortcustom.materiel.exemple')}
              />
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 min-h-11 text-sm text-ink-700">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.concentration}
                onChange={(e) => onChange({ ...draft, concentration: e.target.checked })}
              />
              <span aria-hidden className="text-indigo-500">
                <Glyph name="concentration" />
              </span>
              {t('sortcustom.concentration')}
            </label>
            <label className="flex items-center gap-2 min-h-11 text-sm text-ink-700">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.ritual}
                onChange={(e) => onChange({ ...draft, ritual: e.target.checked })}
              />
              {t('sortcustom.rituel')}
            </label>
          </div>
        </div>
      </div>

      {/* --- Classes autorisées : multi-select + « Toutes » (liste explicite) --- */}
      <div>
        <span className="section-title">{t('sortcustom.classes')}</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={toggleAllClasses}
            aria-pressed={allClasses}
            className={`min-h-11 px-4 rounded-full border text-xs font-medium transition-colors ${
              allClasses
                ? 'bg-gold-100 border-gold-300 text-gold-700 font-semibold'
                : 'bg-parchment-100 border-parchment-300 text-ink-500 hover:bg-parchment-200'
            }`}
          >
            {t('sortcustom.classes.toutes')}
          </button>
          {ALL_CLASSES.map((name) => {
            const checked = draft.classes.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleClass(name)}
                aria-pressed={checked}
                className={`min-h-11 px-3 rounded-full border text-xs font-medium transition-colors ${
                  checked
                    ? 'bg-ink-100 border-ink-300 text-ink-700 font-semibold'
                    : 'bg-parchment-100 border-parchment-300 text-ink-500 hover:bg-parchment-200'
                }`}
              >
                {classNameLabel(name)}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-ink-400 mt-1.5">
          {allClasses
            ? t('sortcustom.classes.toutes')
            : draft.classes.map((c) => classNameLabel(c)).join(' · ')}
        </p>
      </div>

      {/* --- Effet : dégâts / soins / DD (affichée, jamais jetée) --- */}
      <div>
        <span className="section-title">{t('sortcustom.effet')}</span>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">{t('sortcustom.degats')}</span>
            <input
              id="spell-damage-input"
              className={`input font-mono ${damageInvalid ? 'border-orange-400' : ''}`}
              value={draft.damageDice}
              onChange={(e) => onChange({ ...draft, damageDice: e.target.value })}
              placeholder="3d6"
              aria-invalid={damageInvalid || undefined}
              aria-describedby={damageInvalid ? 'spell-damage-error' : undefined}
            />
            {damageInvalid && (
              <span id="spell-damage-error" className="block text-xs text-orange-700 mt-1">
                {t('sortcustom.degats.invalide')}
              </span>
            )}
          </label>
          <label className="block">
            <span className="label">{t('sortcustom.degats.type')}</span>
            <select
              id="spell-damage-type-input"
              className="input"
              value={draft.damageType}
              onChange={(e) => onChange({ ...draft, damageType: e.target.value })}
            >
              {DAMAGE_TYPE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {DAMAGE_TYPE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('sortcustom.soins')}</span>
            <input
              id="spell-heal-input"
              className={`input font-mono ${healInvalid ? 'border-orange-400' : ''}`}
              value={draft.healDice}
              onChange={(e) => onChange({ ...draft, healDice: e.target.value })}
              placeholder="1d8"
              aria-invalid={healInvalid || undefined}
              aria-describedby={healInvalid ? 'spell-heal-error' : undefined}
            />
            {healInvalid && (
              <span id="spell-heal-error" className="block text-xs text-orange-700 mt-1">
                {t('sortcustom.degats.invalide')}
              </span>
            )}
          </label>
          <div className="flex items-end">
            <label className="flex items-center gap-2 min-h-11 text-sm text-ink-700">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.healAddsModifier}
                onChange={(e) => onChange({ ...draft, healAddsModifier: e.target.checked })}
              />
              {t('sortcustom.soins.mod')}
            </label>
          </div>
          <label className="block">
            <span className="label">{t('sortcustom.attaque')}</span>
            <select
              id="spell-attack-type-input"
              className="input"
              value={draft.attackType}
              onChange={(e) =>
                onChange({
                  ...draft,
                  attackType: e.target.value as SpellDraft['attackType'],
                })
              }
            >
              <option value="">{t('sortcustom.attaque.aucune')}</option>
              <option value="melee">{t('sortcustom.attaque.melee')}</option>
              <option value="ranged">{t('sortcustom.attaque.distance')}</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">{t('sortcustom.dd')}</span>
              <select
                id="spell-dc-ability-input"
                className="input"
                value={draft.dcAbility}
                onChange={(e) =>
                  onChange({ ...draft, dcAbility: e.target.value as SpellDraft['dcAbility'] })
                }
              >
                <option value="">—</option>
                {DC_ABILITIES.map((a) => (
                  <option key={a} value={a}>
                    {DC_ABILITY_SHORT[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">{t('sortcustom.dd.effet')}</span>
              <select
                id="spell-dc-success-input"
                className="input"
                value={draft.dcSuccess}
                onChange={(e) =>
                  onChange({ ...draft, dcSuccess: e.target.value as SpellDraft['dcSuccess'] })
                }
              >
                <option value="">—</option>
                <option value="half">{t('sortcustom.dd.effet.half')}</option>
                <option value="none">{t('sortcustom.dd.effet.none')}</option>
                <option value="other">{t('sortcustom.dd.effet.other')}</option>
              </select>
            </label>
          </div>
        </div>
        {draft.dcAbility && draft.dcSuccess && (
          <p className="text-xs text-ink-500 mt-1.5" role="note">
            {t('sortcustom.dd.apercu', {
              ability: DC_ABILITY_SHORT[draft.dcAbility],
              effet: t(`sortcustom.dd.effet.${draft.dcSuccess}`),
            })}
          </p>
        )}
      </div>

      {/* --- Incantation supérieure : raccourci « +NdX par cran » --- */}
      <div>
        <span className="section-title">{t('sortcustom.upcast')}</span>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">{t('sortcustom.upcast.degats')}</span>
            <input
              id="spell-upcast-damage-input"
              className="input font-mono"
              value={draft.upcastDice}
              onChange={(e) => onChange({ ...draft, upcastDice: e.target.value })}
              placeholder="1d6"
            />
          </label>
          <label className="block">
            <span className="label">{t('sortcustom.upcast.soins')}</span>
            <input
              id="spell-upcast-heal-input"
              className="input font-mono"
              value={draft.healUpcastDice}
              onChange={(e) => onChange({ ...draft, healUpcastDice: e.target.value })}
              placeholder="1d8"
            />
          </label>
        </div>
        {(draft.upcastDice.trim() !== '' || draft.healUpcastDice.trim() !== '') && (
          <p className="text-xs text-ink-500 mt-1.5">
            {draft.upcastDice.trim() !== '' && (
              <Chip tone="gold" className="mr-1.5">
                {t('sortcustom.upcast.par.cran', { dice: draft.upcastDice.trim() })}
              </Chip>
            )}
            {draft.healUpcastDice.trim() !== '' && (
              <Chip tone="gold">
                {t('sortcustom.upcast.par.cran', { dice: draft.healUpcastDice.trim() })}
              </Chip>
            )}
          </p>
        )}
      </div>

      {/* --- Texte --- */}
      <div className="space-y-3">
        <span className="section-title">{t('sortcustom.texte')}</span>
        <label className="block">
          <span className="label">{t('sortcustom.description')}</span>
          <textarea
            id="spell-description-input"
            className="input text-sm"
            rows={4}
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
            placeholder={t('sortcustom.description.exemple')}
          />
        </label>
        <label className="block">
          <span className="label">{t('sortcustom.niveaux.superieurs')}</span>
          <textarea
            id="spell-higher-level-input"
            className="input text-sm"
            rows={2}
            value={draft.higherLevel}
            onChange={(e) => onChange({ ...draft, higherLevel: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
