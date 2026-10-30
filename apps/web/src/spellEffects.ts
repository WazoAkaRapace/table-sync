/**
 * Effets de sort sur la CA (v1) — contrat client des routes spell-effects.
 *
 * GET  /api/characters/:id/spell-effects → lignes ACTIVES jointes au nom du sort
 * POST /api/characters/:id/spell-effects { spellId }
 * DELETE /api/spell-effects/:id
 *
 * Le fetch est SILENCIEUX en échec (route absente = aucune puce, aucune
 * erreur : la fiche reste utilisable tant que le serveur n'a pas la
 * fonctionnalité). Persistance d'affichage : une requête, cache état local
 * côté page — pas de react-query, cohérent avec le reste du bandeau.
 */

import { applyAcEffects, type ActiveAcEffect } from '@table-sync/shared';
import api from './api';

/** Une ligne d'effet actif, telle que servie par le JOIN du GET.
 *  v2 ciblage : `role` distingue les effets PORTÉS par :id (« bearer », ils
 *  comptent dans SA CA) des effets CASTÉS par :id vers autrui (« caster »,
 *  chips du lanceur — la CA vit sur la fiche de la cible). `targetLabel`
 *  = cible « Autre » sans fiche (pense-bête, aucune CA calculée). */
export interface SpellEffectRow {
  id: number;
  spellId: number;
  spellName: string;
  effectKind: string;
  acValue: number;
  tiedToConcentration: boolean;
  expiresOnTurnEnd?: boolean;
  role?: 'bearer' | 'caster';
  targetCharacterId?: number | null;
  targetLabel?: string | null;
  targetName?: string | null;
  casterCharacterId?: number | null;
  casterName?: string | null;
}

/** Les 5 sorts à effet CA CIBLABLES (v2) — Bouclier EXCLU (réaction self
 *  par RAW, pas de picker). Miroir web de SPELL_AC_EFFECTS : clés srdIndex. */
export const TARGETABLE_AC_SPELL_SRD_INDEXES: ReadonlySet<string> = new Set([
  'shield-of-faith',
  'barkskin',
  'haste',
  'tasha-s-otherworldly-guise',
  'mage-armor',
]);

/** Ce sort ouvre-t-il le picker de cible ? (effet CA connu + ciblable) */
export function isTargetableAcSpell(srdIndex: string): boolean {
  return TARGETABLE_AC_SPELL_SRD_INDEXES.has(srdIndex);
}

/** Un membre du groupe proposé par le picker : fiche + CA effective (le
 *  roster la sert déjà calculée, effets de sort inclus) + DEX (formules
 *  « 13 + DEX » de la prévisualisation). */
export interface TargetableMember {
  id: number;
  name: string;
  portraitUrl: string | null;
  /** Classe/niveau — méta de la ligne réglée (ex. « Guerrier 3 »). */
  meta: string;
  /** CA effective actuelle (effets posés inclus), null = inconnue. */
  ac: number | null;
  dexMod: number;
}

/** Lignes qui comptent dans la CA du personnage consulté : portées par lui
 *  (role bearer) et SANS étiquette « Autre » (un effet étiqueté vit sur la
 *  fiche du lanceur comme pense-bête, il ne touche pas sa CA). */
export function bearerAcRows(rows: SpellEffectRow[]): SpellEffectRow[] {
  return rows.filter((r) => r.role !== 'caster' && !r.targetLabel);
}

/** Effets castés par ce personnage vers autrui (chips + mini-feuille). */
export function castOnOthersRows(rows: SpellEffectRow[]): SpellEffectRow[] {
  return rows.filter((r) => r.role === 'caster');
}

/** Colonnes admises côté client (camelCase attendu, snake_case toléré). */
interface RawSpellEffectRow {
  id?: unknown;
  spellId?: unknown;
  spell_id?: unknown;
  spellName?: unknown;
  spell_name?: unknown;
  nameFr?: unknown;
  name?: unknown;
  effectKind?: unknown;
  effect_kind?: unknown;
  acValue?: unknown;
  ac_value?: unknown;
  tiedToConcentration?: unknown;
  tied_to_concentration?: unknown;
  expiresOnTurnEnd?: unknown;
  expires_on_turn_end?: unknown;
  spell?: unknown;
  role?: unknown;
  targetCharacterId?: unknown;
  target_character_id?: unknown;
  targetLabel?: unknown;
  target_label?: unknown;
  targetName?: unknown;
  target_name?: unknown;
  casterCharacterId?: unknown;
  caster_character_id?: unknown;
  casterName?: unknown;
  caster_name?: unknown;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function normalizeRow(raw: RawSpellEffectRow): SpellEffectRow | null {
  const id = num(raw.id, NaN);
  if (!Number.isFinite(id)) return null;
  // Contrat réel (mapSpellEffect côté API) : le nom vit dans l'objet `spell`
  // imbriqué ({ name, nameFr, srdIndex }) ; les formes plates restent tolérées.
  const nested = raw.spell as { name?: unknown; nameFr?: unknown } | undefined;
  const spellName =
    (typeof raw.spellName === 'string' && raw.spellName) ||
    (typeof raw.spell_name === 'string' && raw.spell_name) ||
    (typeof nested?.name === 'string' && nested.name) ||
    (typeof nested?.nameFr === 'string' && nested.nameFr) ||
    (typeof raw.nameFr === 'string' && raw.nameFr) ||
    (typeof raw.name === 'string' && raw.name) ||
    '';
  const roleRaw = String(raw.role ?? '').toLowerCase();
  const role: SpellEffectRow['role'] =
    roleRaw === 'caster' ? 'caster' : roleRaw === 'bearer' ? 'bearer' : undefined;
  return {
    id,
    spellId: num(raw.spellId ?? raw.spell_id, 0),
    spellName,
    effectKind: String(raw.effectKind ?? raw.effect_kind ?? 'ac_bonus'),
    acValue: num(raw.acValue ?? raw.ac_value),
    tiedToConcentration: !!(raw.tiedToConcentration ?? raw.tied_to_concentration ?? false),
    expiresOnTurnEnd: !!(raw.expiresOnTurnEnd ?? raw.expires_on_turn_end ?? false),
    role,
    targetCharacterId: nullableNum(raw.targetCharacterId ?? raw.target_character_id),
    targetLabel: nullableStr(raw.targetLabel ?? raw.target_label),
    targetName: nullableStr(raw.targetName ?? raw.target_name),
    casterCharacterId: nullableNum(raw.casterCharacterId ?? raw.caster_character_id),
    casterName: nullableStr(raw.casterName ?? raw.caster_name),
  };
}

/** Lignes d'effets actifs du personnage — [] en cas d'erreur/route absente. */
export async function fetchSpellEffects(characterId: number): Promise<SpellEffectRow[]> {
  try {
    const res = await api.get(`/api/characters/${characterId}/spell-effects`);
    const data = res.data?.effects ?? res.data;
    if (!Array.isArray(data)) return [];
    return data
      .map((raw: RawSpellEffectRow) => normalizeRow(raw))
      .filter((r: SpellEffectRow | null): r is SpellEffectRow => r !== null);
  } catch {
    return [];
  }
}

/** Réduction au moteur : ce que computeAC/applyAcEffects consomment. */
export function toActiveAcEffects(rows: SpellEffectRow[]): ActiveAcEffect[] {
  return rows.map((r) => ({ effectKind: r.effectKind, acValue: r.acValue }));
}

/** Libellé court de la contribution : « +2 », « ≥ 16 », « 13 + DEX ». */
export function effectModLabel(effect: { effectKind: string; acValue: number }): string {
  if (effect.effectKind === 'ac_floor') return `≥ ${effect.acValue}`;
  if (effect.effectKind === 'ac_set_formula') return `${effect.acValue} + DEX`;
  return `${effect.acValue >= 0 ? '+' : ''}${effect.acValue}`;
}

/** CA après application d'UN effet (annonce de lancement — pure). */
export function previewAc(
  currentAc: number,
  dexMod: number,
  effect: { effectKind: string; acValue: number },
): number {
  return applyAcEffects(
    currentAc,
    [{ effectKind: effect.effectKind, acValue: effect.acValue }],
    dexMod,
  );
}

/** Ligne de SPELL_AC_EFFECTS (kind/value) → forme du moteur (effectKind/acValue). */
export function defToEffect(def: { kind: string; value: number }): {
  effectKind: string;
  acValue: number;
} {
  return { effectKind: def.kind, acValue: def.value };
}
