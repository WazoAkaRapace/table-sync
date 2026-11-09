/**
 * Fiche personnage — lignes de classe / multiclassage : report des champs
 * « plats » hérités (characterClass, level, subclass, hitDiceUsed…) sur les
 * lignes character_classes, qui font foi pour le moteur.
 * Découpage 2026-11 (phase 4) : bloc déplacé tel quel depuis le PATCH de
 * routes/characters.ts (extraction mécanique — le corps est inchangé).
 */

import type { PatchCharacterPayload } from '@table-sync/shared';
import { CLASS_SUBCLASSES } from '@table-sync/shared/classFeatures';
import { eq } from 'drizzle-orm';
import { getDrizzle } from '../../db/drizzle.ts';
import { cols } from '../../db/projections.ts';
import { characterClasses } from '../../db/schema.ts';
import { replaceCharacterClasses, validateClassEntries } from '../helpers.ts';

export function applyLegacyClassFields(char: any, body: PatchCharacterPayload): void {
  // --- Champs de classe « plats » (rétrocompat mono-classe) : les reporter
  // sur les lignes de classe, qui font foi pour le moteur (multiclassage).
  // Une fiche multiclassée s'édite via classes[] — un `level` seul sur une
  // telle fiche est ambigu et ne touche pas les lignes.
  const legacyClassFields = [
    'characterClass',
    'level',
    'subclass',
    'divineDomain',
    'druidCircle',
    'sacredOath',
    'fightingStyle',
    'hitDiceUsed',
  ] as const;
  const changedLegacy = legacyClassFields.filter((f) => (body as any)[f] !== undefined);
  const classRows = getDrizzle()
    .select(cols(characterClasses))
    .from(characterClasses)
    .where(eq(characterClasses.characterId, char.id))
    .orderBy(characterClasses.position, characterClasses.id)
    .all() as any[];
  if (changedLegacy.length > 0) {
    const entries =
      classRows.length > 0
        ? classRows.map((r) => ({
            classKey: r.class_key as string,
            level: r.level as number,
            subclassKey: (r.subclass_key as string | null) ?? null,
            hitDiceUsed: (r.hit_dice_used as number) ?? 0,
            fightingStyle: (r.fighting_style as string | null) ?? null,
          }))
        : [
            {
              classKey: (body.characterClass ?? char.character_class ?? '') as string,
              level: (body.level ?? char.level ?? 1) as number,
              subclassKey: (body.divineDomain ??
                char.divine_domain ??
                body.druidCircle ??
                char.druid_circle ??
                body.sacredOath ??
                char.sacred_oath ??
                body.subclass ??
                char.subclass ??
                null) as string | null,
              hitDiceUsed: (char.hit_dice_used as number) ?? 0,
              fightingStyle: (body.fightingStyle ?? char.fighting_style ?? null) as string | null,
            },
          ];
    const first = entries[0];
    if (body.characterClass !== undefined) first.classKey = body.characterClass;
    if (body.level !== undefined) {
      // `level` plat = niveau TOTAL : le delta va sur la DERNIÈRE ligne
      // (la classe en cours d'avancement — convention du multiclassage ;
      // mono-classe, c'est simplement la ligne unique). Une sous-classe
      // qui passe sous son palier RAW est retirée de la ligne.
      const delta = body.level - entries.reduce((sum, e) => sum + e.level, 0);
      const last = entries[entries.length - 1];
      last.level = Math.max(1, last.level + delta);
      for (const e of entries) {
        if (!e.subclassKey) continue;
        const def = (CLASS_SUBCLASSES[e.classKey] ?? []).find((s) => s.key === e.subclassKey);
        if (def && def.level > e.level) e.subclassKey = null;
      }
    }
    if (entries.length === 1) {
      if (first.classKey === 'Clerc' && body.divineDomain !== undefined) {
        first.subclassKey = body.divineDomain;
      } else if (first.classKey === 'Druide' && body.druidCircle !== undefined) {
        first.subclassKey = body.druidCircle;
      } else if (first.classKey === 'Paladin' && body.sacredOath !== undefined) {
        first.subclassKey = body.sacredOath;
      } else if (body.subclass !== undefined) {
        first.subclassKey = body.subclass;
      }
    }
    if (body.fightingStyle !== undefined) first.fightingStyle = body.fightingStyle;
    if (body.hitDiceUsed !== undefined && Number.isFinite(body.hitDiceUsed)) {
      // `hitDiceUsed` plat = TOTAL dépensé : le delta se répartit en FIFO
      // sur les lignes (mêmes conventions qu'applyRest — on dépense dans
      // l'ordre des lignes, on récupère front-loaded). Sans cette
      // répercussion, la fiche (qui lit les lignes via hitDiceByClassOf)
      // ignorait le compteur plat : les +/− de Survie semblaient inertes,
      // et le prochain replaceCharacterClasses écrasait la colonne
      // dénormalisée avec la somme des lignes restées figées.
      const currentTotal = entries.reduce((sum, e) => sum + (e.hitDiceUsed ?? 0), 0);
      const maxTotal = entries.reduce((sum, e) => sum + e.level, 0);
      let delta =
        Math.max(0, Math.min(Math.trunc(body.hitDiceUsed as number), maxTotal)) - currentTotal;
      for (const e of entries) {
        if (delta === 0) break;
        if (delta > 0) {
          const take = Math.min(e.level - (e.hitDiceUsed ?? 0), delta);
          if (take > 0) {
            e.hitDiceUsed = (e.hitDiceUsed ?? 0) + take;
            delta -= take;
          }
        } else {
          const regain = Math.min(e.hitDiceUsed ?? 0, -delta);
          if (regain > 0) {
            e.hitDiceUsed = (e.hitDiceUsed ?? 0) - regain;
            delta += regain;
          }
        }
      }
    }
    const validated = validateClassEntries(entries);
    // Une fiche héritée peut dévier du catalogue (sous-classe hors palier) :
    // on synchronise seulement l'état valide, sans rejeter l'écriture.
    if (validated.ok) replaceCharacterClasses(char.id, validated.entries);
  }
}
