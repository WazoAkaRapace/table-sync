/**
 * Validation + mapping des sorts personnalisés — plan « Contenus
 * personnalisés » (PR3 sorts). Gabarit de monster-fields.ts : `input` porte
 * les champs fournis (ou fusionnés avec la ligne existante pour un PATCH) ;
 * retourne le message d'erreur FR, ou les champs validés.
 *
 * Le sort custom pilote les colonnes SRD existantes mot pour mot — le
 * `damage_json` généré respecte le CONTRAT exact du CastSpellSheet
 * (damage_at_slot_level / heal_at_slot_level / heal_adds_modifier), le
 * `dc_json` la forme {dc_type:{index}, dc_success} — l'upcast, la
 * concentration et la DD s'affichent par construction, zéro changement
 * moteur. YAGNI : l'éditeur propose des dés/formules simples par niveau
 * (raccourci « +Nd6 par cran » développé serveur en table complète), pas
 * un éditeur complet.
 */

import { DND_CLASSES, DAMAGE_TYPE_LABELS_FR, parseDamageTemplate } from '@table-sync/shared';
import {
  buildSpellDamageJson,
  buildSpellDcJson,
  expandSpellSlotTable,
} from '@table-sync/shared';
import { randomBytes } from 'node:crypto';
import { spells } from '../../db/schema.ts';

/** Écoles SRD (clés stables du catalogue). */
const SCHOOLS = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
] as const;

/** Caractéristiques de sauvegarde (index courts du SRD — dc_json). */
const DC_ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const DC_SUCCESSES = ['half', 'none', 'other'] as const;
/**
 * Types de dégâts SRD — INDEX du damage_json (minuscules, contrat exact du
 * CastSpellSheet via SPELL_DAMAGE_TYPE_FR). NB : les CLÉS de
 * DAMAGE_TYPE_LABELS_FR sont capitalisées ('Poison') — ne pas les réutiliser
 * comme index.
 */
const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
];
const CLASS_NAMES = DND_CLASSES.map((c) => c.name);

/** Champs validés d'un sort personnalisé. */
export interface SpellFieldsChecked {
  name: string;
  level: number;
  school: string;
  castingTime: string | null;
  rangeText: string | null;
  duration: string | null;
  components: string[];
  material: string | null;
  concentration: boolean;
  ritual: boolean;
  classes: string[];
  attackType: string | null;
  damageDice: string | null;
  damageType: string | null;
  /** Table d'upcast EXPLICITE {niveau d'emplacement: template} (optionnelle). */
  damageAtSlotLevel: Record<string, string> | null;
  healDice: string | null;
  healAtSlotLevel: Record<string, string> | null;
  healAddsModifier: boolean;
  dcAbility: string | null;
  dcSuccess: string | null;
  description: string | null;
  higherLevel: string | null;
}

/** Champs d'effet acceptés (dés + table d'upcast, raccourci par cran). */
export interface SpellEffectInput {
  dice?: unknown;
  type?: unknown;
  atSlotLevel?: unknown;
  perSlotLevel?: unknown;
}

/** Valide un template de dés (dés et/ou bonus fixes — « 3d6 », « 1d8+3 », « 70 »). */
function validDiceTemplate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const src = v.replace(/\s+/g, '');
  if (parseDamageTemplate(src) === null) return null;
  return src;
}

/**
 * Développe le raccourci « +Nd6 par cran » en table damage/heal_at_slot_level
 * complète (niveau natif → 9) — shared, rejoué à l'identique par l'aperçu du
 * formulaire MD.
 */
function expandPerSlot(
  level: number,
  baseDice: string,
  perSlotLevel: string,
): Record<string, string> {
  return expandSpellSlotTable(level, baseDice, perSlotLevel);
}

/** Valide une table explicite {niveau: template} — clés 1-9, templates parsables. */
function validateSlotTable(raw: unknown): Record<string, string> | null | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const slot = Number(k);
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) return 'niveau d’emplacement invalide';
    const tpl = validDiceTemplate(v);
    if (tpl === null) return 'modèle de dés invalide';
    out[String(slot)] = tpl;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Extrait l'effet (dégâts OU soins) validé : dés, type absent pour les soins. */
function checkedEffect(
  effect: SpellEffectInput,
  level: number,
  label: string,
): { dice: string | null; table: Record<string, string> | null } | string {
  const dice = validDiceTemplate(effect.dice);
  if (effect.dice !== undefined && effect.dice !== null && effect.dice !== '' && dice === null) {
    return 'modèle de dés invalide';
  }
  const perSlot = validDiceTemplate(effect.perSlotLevel);
  if (
    effect.perSlotLevel !== undefined &&
    effect.perSlotLevel !== null &&
    effect.perSlotLevel !== '' &&
    perSlot === null
  ) {
    return `modèle de dés invalide (${label})`;
  }
  const explicit = validateSlotTable(effect.atSlotLevel);
  if (typeof explicit === 'string') return explicit;
  if (explicit !== null) return { dice, table: explicit };
  if (perSlot !== null) {
    if (dice === null) return 'dés à niveau natif requis pour l’upcast par cran';
    return { dice, table: expandPerSlot(level, dice, perSlot) };
  }
  return { dice, table: null };
}

/**
 * Valide les champs d'un sort personnalisé (l'école « enchantment » et les
 * types/classes SRD sont les clés STABLES du catalogue — les libellés FR ne
 * vivent que dans l'UI).
 */
export function validateSpellFields(input: Record<string, any>): string | SpellFieldsChecked {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return 'nom du sort requis';
  if (name.length > 120) return 'nom du sort trop long';

  const level = Number(input.level);
  if (!Number.isInteger(level) || level < 0 || level > 9) return 'niveau invalide';

  const school = typeof input.school === 'string' ? input.school : '';
  if (!SCHOOLS.includes(school as (typeof SCHOOLS)[number])) return 'école invalide';

  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null;
  const castingTime = text(input.castingTime);
  const rangeText = text(input.rangeText);
  const duration = text(input.duration);

  const rawComponents = Array.isArray(input.components) ? input.components : [];
  const components: string[] = [];
  for (const c of rawComponents) {
    if (typeof c !== 'string') continue;
    const up = c.toUpperCase();
    if (['V', 'S', 'M'].includes(up) && !components.includes(up)) components.push(up);
  }
  const material =
    components.includes('M') && typeof input.material === 'string' && input.material.trim()
      ? input.material.trim().slice(0, 120)
      : null;

  const rawClasses = Array.isArray(input.classes) ? input.classes : [];
  if (rawClasses.length === 0) return 'au moins une classe autorisée';
  const classes: string[] = [];
  for (const c of rawClasses) {
    if (typeof c !== 'string') return 'classe inconnue';
    // « Toutes les classes » = liste explicite des 13 classes SRD (position 6
    // du plan archi) — le filtre LIKE du grimoire reste le seul chemin.
    if (!CLASS_NAMES.includes(c)) return 'classe inconnue';
    if (!classes.includes(c)) classes.push(c);
  }

  const attackType =
    input.attackType === 'melee' || input.attackType === 'ranged' ? input.attackType : null;
  if (
    input.attackType !== undefined &&
    input.attackType !== null &&
    input.attackType !== '' &&
    attackType === null
  ) {
    return 'capacité d’attaque invalide';
  }

  const damageType =
    typeof input.damageType === 'string' && DAMAGE_TYPES.includes(input.damageType)
      ? input.damageType
      : null;
  if (
    input.damageType !== undefined &&
    input.damageType !== null &&
    input.damageType !== '' &&
    damageType === null
  ) {
    return 'type de dégâts invalide';
  }

  const damage = checkedEffect(input.damage ?? {}, level, 'dégâts');
  if (typeof damage === 'string') return damage;
  const heal = checkedEffect(input.heal ?? {}, level, 'soins');
  if (typeof heal === 'string') return heal;
  // Des dégâts chiffrés sans type SRD : la chip ⚔ du CastSpellSheet resterait
  // muette — le type accompagne TOUJOURS les dés de dégâts.
  if (damage.dice !== null && damageType === null) return 'type de dégâts requis';

  const rawDc =
    input.dc && typeof input.dc === 'object' && !Array.isArray(input.dc) ? input.dc : {};
  const dcAbility =
    typeof rawDc.ability === 'string' && DC_ABILITIES.includes(rawDc.ability as 'con')
      ? rawDc.ability
      : null;
  const dcSuccess =
    typeof rawDc.success === 'string' && DC_SUCCESSES.includes(rawDc.success as 'half')
      ? rawDc.success
      : null;
  if ((dcAbility === null) !== (dcSuccess === null)) {
    return 'sauvegarde invalide (caractéristique et effet requis ensemble)';
  }

  const description =
    typeof input.description === 'string' && input.description.trim()
      ? input.description.trim().slice(0, 20000)
      : null;
  const higherLevel =
    typeof input.higherLevel === 'string' && input.higherLevel.trim()
      ? input.higherLevel.trim().slice(0, 2000)
      : null;

  return {
    name,
    level,
    school,
    castingTime,
    rangeText,
    duration,
    components,
    material,
    concentration: input.concentration === true,
    ritual: input.ritual === true,
    classes,
    attackType,
    damageDice: damage.dice,
    damageType,
    damageAtSlotLevel: damage.table,
    healDice: heal.dice,
    healAtSlotLevel: heal.table,
    healAddsModifier: input.healAddsModifier === true,
    dcAbility,
    dcSuccess,
    description,
    higherLevel,
  };
}

/** Parse une colonne JSON de la ligne (tolérant). */
function json(raw: any, fallback: any) {
  if (raw === null || raw === undefined) return fallback;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return fallback;
  }
}

/** Extrait l'effet (dégâts ou soins) d'un damage_json existant → forme d'entrée. */
function effectFromDamageJson(damageJson: any, tableKey: string): SpellEffectInput {
  const d = json(damageJson, {});
  const table =
    d && typeof d === 'object' && d[tableKey] && typeof d[tableKey] === 'object'
      ? d[tableKey]
      : undefined;
  const slots = Object.keys(table ?? {}).map(Number).sort((a, b) => a - b);
  const native = slots.length > 0 ? table[String(slots[0])] : undefined;
  return { dice: native, atSlotLevel: table };
}

/**
 * Fusionne une payload PATCH partielle avec la ligne existante (re-validation
 * sur le contexte complet — le champ absent garde sa valeur en base).
 * `srd_index`/`source`/`party_id`/`created_by` ne sont JAMAIS patchables.
 */
export function mergeSpellBody(row: any, body: Record<string, any>): Record<string, any> {
  return {
    name: body.name !== undefined ? body.name : row.name_fr,
    level: body.level !== undefined ? body.level : row.level,
    school: body.school !== undefined ? body.school : row.school,
    castingTime: body.castingTime !== undefined ? body.castingTime : row.casting_time,
    rangeText: body.rangeText !== undefined ? body.rangeText : row.range_text,
    duration: body.duration !== undefined ? body.duration : row.duration,
    components: body.components !== undefined ? body.components : json(row.components, []),
    material: body.material !== undefined ? body.material : row.material,
    concentration: body.concentration !== undefined ? body.concentration : !!row.concentration,
    ritual: body.ritual !== undefined ? body.ritual : !!row.ritual,
    classes: body.classes !== undefined ? body.classes : json(row.classes_json, []),
    attackType: body.attackType !== undefined ? body.attackType : row.attack_type,
    damageType:
      body.damageType !== undefined
        ? body.damageType
        : json(row.damage_json, {}).damage_type?.index ?? null,
    damage:
      body.damage !== undefined
        ? body.damage
        : effectFromDamageJson(row.damage_json, 'damage_at_slot_level'),
    heal:
      body.heal !== undefined ? body.heal : effectFromDamageJson(row.damage_json, 'heal_at_slot_level'),
    healAddsModifier:
      body.healAddsModifier !== undefined
        ? body.healAddsModifier
        : json(row.damage_json, {}).heal_adds_modifier === true,
    dc:
      body.dc !== undefined
        ? body.dc
        : row.dc_json
          ? {
              ability: json(row.dc_json, {}).dc_type?.index ?? null,
              success: json(row.dc_json, {}).dc_success ?? null,
            }
          : { ability: null, success: null },
    description:
      body.description !== undefined ? body.description : (row.description_fr ?? row.description),
    higherLevel:
      body.higherLevel !== undefined ? body.higherLevel : (row.higher_level_fr ?? row.higher_level),
  };
}

/**
 * Index synthétique `custom-<partyId>-<hex6>` : la colonne srd_index reste
 * NOT NULL UNIQUE (pas de rebuild de table SQLite) ; le préfixe ne collisionne
 * jamais avec les 490 index seedés (forme `acid-arrow`) et l'annexe EN
 * (clé srdIndex) ne matchera jamais ⇒ repli FR champ par champ gratuit.
 */
export function customSpellIndex(partyId: number): string {
  return `custom-${partyId}-${randomBytes(3).toString('hex')}`;
}

/** damage_json + dc_json : délégués à shared (l'aperçu du formulaire MD
 * construit les MÊMES payloads pour relire via spellDamageAtLevel). */
export function buildDamageJson(f: SpellFieldsChecked): string | null {
  return buildSpellDamageJson({
    level: f.level,
    damageDice: f.damageDice,
    damageType: f.damageType,
    damageAtSlotLevel: f.damageAtSlotLevel,
    healDice: f.healDice,
    healAtSlotLevel: f.healAtSlotLevel,
    healAddsModifier: f.healAddsModifier,
    dcAbility: f.dcAbility,
    dcSuccess: f.dcSuccess,
  });
}

export function buildDcJson(f: SpellFieldsChecked): string | null {
  return buildSpellDcJson(f);
}

/** Colonnes d'écriture dérivées des champs validés (insertion ET mise à jour). */
export function spellValues(
  f: SpellFieldsChecked,
  srdIndex: string,
  partyId: number,
  createdBy: number,
): typeof spells.$inferInsert {
  return {
    srdIndex,
    name: f.name,
    nameFr: f.name,
    level: f.level,
    school: f.school,
    castingTime: f.castingTime,
    rangeText: f.rangeText,
    components: JSON.stringify(f.components),
    material: f.material,
    duration: f.duration,
    concentration: f.concentration ? 1 : 0,
    ritual: f.ritual ? 1 : 0,
    // Saisie FR seule (Q10a) : l'overlay EN vient de l'annexe clé srdIndex —
    // un index synthétique n'y figure jamais ⇒ repli FR champ par champ.
    description: null,
    descriptionFr: f.description,
    higherLevel: null,
    higherLevelFr: f.higherLevel,
    attackType: f.attackType,
    damageJson: buildDamageJson(f),
    dcJson: buildDcJson(f),
    classesJson: JSON.stringify(f.classes),
    source: 'custom',
    partyId,
    createdBy,
  };
}
