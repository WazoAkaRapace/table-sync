/**
 * Character spell-effect routes (v1 : effets de sort sur la CA).
 *
 * Poser/lire/lever les états posés au lancement des 6 sorts v1
 * (Bouclier de la foi, Peau d'écorce, Hâte, Costume d'Outremonde,
 * Armure de mage, Bouclier). Une ligne par effet posé ; `active = 0`
 * conserve l'historique.
 *
 * Ownership rules:
 *  - GET    /characters/:id/spell-effects → tout membre du groupe (+ visibilité)
 *  - POST   /characters/:id/spell-effects → owner ou MD ; 409 si effet ACTIF
 *                                       du même sort déjà posé ; pose aussi
 *                                       concentrating = 1 si lié (même tx)
 *  - DELETE /spell-effects/:id            → owner ou MD ; désactive ; si lié
 *                                       et plus aucun effet actif concentré →
 *                                       concentrating = 0 (même tx)
 *
 * Les mutations émettent `character:change action 'stats'` (CA visible du
 * résumé du roster) ET resynchronisent la CA des combatants non terminés
 * (`mirrorAcToCombatants` → `combat:change action 'ac'` quand une ligne
 * bouge) — le traqueur suit la CA en continu, plus seulement à l'ajout.
 */

import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { characterSpellEffects, characters, combatants, encounters, spells } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import {
  characterVisibleTo,
  equippedAcRows,
  isPartyGM,
  isPartyMember,
  requireUser,
} from './helpers.ts';
import { type AppLang, langFromReq } from './lang.ts';
import { apiMsg } from './messages.ts';
import { abilityModifier, computeAC, SPELL_AC_EFFECTS } from '@table-sync/shared';

interface CreateSpellEffectPayload {
  spellId: number;
  /** v2 : cible fiche du même groupe (non cachée) — absent = self (v1). */
  targetCharacterId?: number;
  /** v2 « Autre » : nom libre de la cible sans fiche (trim non vide, ≤ 60). */
  targetLabel?: string;
}

function getCharacter(drizzle: ReturnType<typeof getDrizzle>, id: number): any {
  return drizzle
    .select(cols(characters))
    .from(characters)
    .where(eq(characters.id, id))
    .get() as any;
}

/** Returns true if the user is the owner or the GM of the character's party. */
function isOwnerOrGM(char: any, userId: number): boolean {
  return char.owner_id === userId || isPartyGM(char.party_id, userId);
}

/**
 * Effets CA actifs du personnage → forme consommée par computeAC (miroir
 * traqueur). v2 : un effet « Autre » (target_label rempli) vit sur la fiche
 * du LANCEUR pour ses chips mais ne touche PAS sa CA — filtré ici.
 */
export function activeAcEffectsOf(
  characterId: number,
): Array<{ effectKind: string; acValue: number }> {
  return getDrizzle()
    .select({
      effectKind: characterSpellEffects.effectKind,
      acValue: characterSpellEffects.acValue,
    })
    .from(characterSpellEffects)
    .where(
      and(
        eq(characterSpellEffects.characterId, characterId),
        isNull(characterSpellEffects.targetLabel),
        eq(characterSpellEffects.active, 1),
      ),
    )
    .all() as any[];
}

/**
 * Désactive les lignes d'effet liées à la concentration du personnage —
 * appelé par les voies de rupture CÔTÉ TRACKER (0 PV au PATCH combatant,
 * condition brisante posée par le MD) DANS la même transaction que le
 * `concentrating = 0`. Le miroir fiche (characters.ts) couvre ses propres
 * voies via `values.concentrating === 0`.
 *
 * v2 : la rupture se juge sur le LANCEUR — les lignes visées sont celles
 * CASTÉES par :characterId (caster_character_id), qu'il les porte ou les
 * ait posées sur autrui / « Autre ».
 */
export function deactivateConcentrationEffects(casterId: number): void {
  getDrizzle()
    .update(characterSpellEffects)
    .set({ active: 0 })
    .where(
      and(
        // Ciblage v2 : caster NULL = posé à la main par un MD sans lanceur
        // identifié — ces lignes ne dépendent d'aucune concentration.
        eq(characterSpellEffects.casterCharacterId, casterId),
        eq(characterSpellEffects.tiedToConcentration, 1),
        eq(characterSpellEffects.active, 1),
      ),
    )
    .run();
}

/**
 * Suite d'une rupture de concentration CÔTÉ TRACKER (combat.ts) : désactive
 * les lignes castées par le lanceur PUIS resynchronise la CA des combatants
 * de CHAQUE porteur fiche touché (la cible peut être en initiative — c'est
 * sa ligne traqueur qui doit retomber, pas seulement celle du lanceur).
 * Retourne les ids des porteurs fiche dont au moins une ligne est tombée
 * (l'appelant émet le character:change 'stats' de chacun).
 */
export function breakConcentrationEffectsOnTracker(
  casterId: number,
  actorUserId: number,
): number[] {
  const drizzle = getDrizzle();
  const dropped = drizzle
    .select({ characterId: characterSpellEffects.characterId })
    .from(characterSpellEffects)
    .where(
      and(
        eq(characterSpellEffects.casterCharacterId, casterId),
        eq(characterSpellEffects.tiedToConcentration, 1),
        eq(characterSpellEffects.active, 1),
      ),
    )
    .all() as any[];
  deactivateConcentrationEffects(casterId);
  const bearerIds = [...new Set(dropped.map((r) => r.characterId))];
  for (const bearerId of bearerIds) {
    // Les lignes « Autre » vivent sur la fiche du lanceur mais n'y portent
    // aucune CA ; le miroir est idempotent — sans combatant, rien ne bouge.
    mirrorAcToCombatants(bearerId, actorUserId, { emit: false });
  }
  return bearerIds;
}

/**
 * Effets éphémères (Bouclier — réaction « jusqu'au début de ton prochain
 * tour ») : désactivation à la FIN DU TOUR DU LANCEUR (approximation jouable
 * du RAW — fin de tour au lieu de début du prochain : jamais de CA fantôme
 * pendant les tours adverses), miroir CA du porteur, retour des ids à
 * rafraîchir (porteur + lanceur quand ils diffèrent).
 */
export function expireEphemeralEffects(casterId: number): number[] {
  const drizzle = getDrizzle();
  const dropped = drizzle
    .select({ id: characterSpellEffects.id, characterId: characterSpellEffects.characterId })
    .from(characterSpellEffects)
    .where(
      and(
        eq(characterSpellEffects.casterCharacterId, casterId),
        eq(characterSpellEffects.expiresOnTurnEnd, 1),
        eq(characterSpellEffects.active, 1),
      ),
    )
    .all() as any[];
  if (dropped.length === 0) return [];
  drizzle
    .update(characterSpellEffects)
    .set({ active: 0 })
    .where(
      inArray(
        characterSpellEffects.id,
        dropped.map((r) => r.id),
      ),
    )
    .run();
  const bearerIds = [...new Set(dropped.map((r) => r.characterId))];
  return bearerIds;
}

/**
 * CA effective du personnage TELLE QUE PORTÉE PAR UN COMBATTANT : équipement
 * + effets de sort actifs, l'override manuel GAGNE (même règle qu'à l'ajout
 * du combatant — combat.ts). Relu à chaque appel : les lignes d'effet et la
 * fiche viennent d'être écrites par l'appelant, la relecture les voit.
 */
export function trackerAcOf(char: any): number {
  const invRows = equippedAcRows(char.id);
  const acResult = computeAC(
    invRows.map((r: any) => ({
      item: {
        category: r.category,
        acBase: r.ac_base,
        strMin: r.str_min,
        nameFr: r.name_fr,
        name: r.name,
      },
      equipped: !!r.equipped,
    })),
    abilityModifier(char.dexterity ?? 10),
    char.fighting_style === 'defense',
    {
      constitution: char.constitution,
      wisdom: char.wisdom,
      characterClass: char.character_class,
    },
    'fr',
    activeAcEffectsOf(char.id),
  );
  return char.armor_class_override ?? acResult.ac;
}

/**
 * Fiche → traqueur : resynchronise la CA des combatants du personnage dans
 * les rencontres non terminées. Appelé par TOUTE écriture qui change une
 * entrée de la CA (effet posé/levé, rupture de concentration — y compris
 * depuis le traqueur, override manuel, DEX, équipement). Idempotent : ni
 * écriture ni événement si la CA calculée égale celle des lignes.
 * En forme sauvage, les miroirs wild shape possèdent la CA du combatant —
 * on n'y touche pas. `emit: false` quand la route appelante émet déjà son
 * combat:change chirurgical (PATCH combatant, qui porte l'encounterId).
 */
export function mirrorAcToCombatants(
  charId: number,
  actorUserId: number,
  options: { emit?: boolean } = {},
): void {
  const drizzle = getDrizzle();
  const char = getCharacter(drizzle, charId);
  if (!char || char.wild_shape_slug) return;
  const rows = drizzle
    .select({ id: combatants.id, armor_class: combatants.armorClass })
    .from(combatants)
    .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
    .where(
      and(
        eq(combatants.characterId, charId),
        eq(combatants.type, 'player'),
        ne(encounters.status, 'ended'),
      ),
    )
    .all() as any[];
  if (rows.length === 0) return;
  const ac = trackerAcOf(char);
  let changed = false;
  for (const row of rows) {
    if (row.armor_class === ac) continue;
    drizzle.update(combatants).set({ armorClass: ac }).where(eq(combatants.id, row.id)).run();
    changed = true;
  }
  if (changed && options.emit !== false) {
    bus.emitChange({ type: 'combat:change', partyId: char.party_id, action: 'ac', actorUserId });
  }
}

function mapSpellEffect(row: any, lang: AppLang) {
  return {
    id: row.id,
    characterId: row.character_id,
    casterCharacterId: row.caster_character_id,
    targetCharacterId: row.target_character_id ?? null,
    targetLabel: row.target_label,
    spellId: row.spell_id,
    effectKind: row.effect_kind,
    acValue: row.ac_value,
    tiedToConcentration: !!row.tied_to_concentration,
    expiresOnTurnEnd: !!row.expires_on_turn_end,
    active: !!row.active,
    createdAt: row.created_at,
    spell: row.spell_name
      ? {
          id: row.spell_id,
          // FR = COALESCE(nameFr, name) — même convention que le reste des
          // routes sorts (character-spells.ts) : `name` est le nom anglais
          // de la table spells, le français vit dans nameFr.
          name:
            lang === 'en'
              ? (row.spell_name_en ?? row.spell_name)
              : (row.spell_name_fr ?? row.spell_name),
          nameFr: row.spell_name_fr,
          srdIndex: row.spell_srd_index,
        }
      : null,
  };
}

export async function characterSpellEffectRoutes(app: FastifyInstance) {
  // ---------- Active spell effects (joined with the spell name) ----------
  app.get(
    '/characters/:id/spell-effects',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      // Personnage caché : 404 pour tout le monde sauf owner + MD.
      if (!characterVisibleTo(char, userId)) {
        return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      }
      const lang = langFromReq(req);
      // v2 : les effets PORTÉS par :id (SA CA) plus les effets CASTÉS par
      // :id vers autrui / « Autre » (les chips du lanceur) — role sur chaque
      // ligne pour l'UI. Une ligne self-castée est 'bearer' (le cas dominant).
      const rows = drizzle
        .select({
          id: characterSpellEffects.id,
          character_id: characterSpellEffects.characterId,
          caster_character_id: characterSpellEffects.casterCharacterId,
          target_label: characterSpellEffects.targetLabel,
          spell_id: characterSpellEffects.spellId,
          effect_kind: characterSpellEffects.effectKind,
          ac_value: characterSpellEffects.acValue,
          tied_to_concentration: characterSpellEffects.tiedToConcentration,
          expires_on_turn_end: characterSpellEffects.expiresOnTurnEnd,
          active: characterSpellEffects.active,
          created_at: characterSpellEffects.createdAt,
          spell_name: spells.name,
          spell_name_fr: spells.nameFr,
          spell_name_en: spells.name,
          spell_srd_index: spells.srdIndex,
          // v2 : le porteur EFFECTIF de la ligne quand il diffère du lanceur
          // (lignes castées sur autrui — l'UI en tire targetCharacterId pour
          // le nom de la cible). Pour « Autre », target_label fait foi.
          target_character_id: characterSpellEffects.characterId,
        })
        .from(characterSpellEffects)
        .innerJoin(spells, eq(spells.id, characterSpellEffects.spellId))
        .where(
          and(
            or(
              eq(characterSpellEffects.characterId, char.id),
              eq(characterSpellEffects.casterCharacterId, char.id),
            ),
            eq(characterSpellEffects.active, 1),
          ),
        )
        .orderBy(characterSpellEffects.createdAt, characterSpellEffects.id)
        .all();
      return reply.send({
        effects: rows.map((r: any) => ({
          ...mapSpellEffect(r, lang),
          // « Autre » vit sur la fiche du LANCEUR (character_id = lanceur,
          // colonne notNull) mais n'est PAS un effet porté : étiquetée, elle
          // ne touche aucune CA — role 'caster' pour les chips pense-bête.
          role: r.character_id === char.id && !r.target_label ? 'bearer' : 'caster',
        })),
      });
    },
  );

  // ---------- Cast: lay a spell effect (owner/GM) ----------
  app.post(
    '/characters/:id/spell-effects',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: CreateSpellEffectPayload }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const char = getCharacter(drizzle, Number(req.params.id));
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      if (!isOwnerOrGM(char, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can modify spell effects') });
      }
      const body = req.body || ({} as CreateSpellEffectPayload);
      if (typeof body.spellId !== 'number' || !Number.isInteger(body.spellId)) {
        return reply.code(400).send({ error: apiMsg(req, 'spellId is required') });
      }
      const spell = drizzle
        .select({ id: spells.id, srd_index: spells.srdIndex })
        .from(spells)
        .where(eq(spells.id, body.spellId))
        .get() as any;
      if (!spell) return reply.code(404).send({ error: apiMsg(req, 'spell not found') });
      const def = SPELL_AC_EFFECTS[spell.srd_index];
      if (!def) {
        return reply
          .code(422)
          .send({ error: apiMsg(req, 'ce sort ne pose pas d’effet sur la CA') });
      }

      // ---------- v2 : résolution de la cible ----------
      // Défaut (ni targetCharacterId ni targetLabel) = self, compatible v1.
      // Les deux à la fois est contradictoire (le contrat est fiche XOR Autre).
      let target:
        | { kind: 'self' }
        | { kind: 'character'; id: number }
        | { kind: 'label'; label: string } = {
        kind: 'self',
      };
      if (body.targetCharacterId !== undefined && body.targetLabel !== undefined) {
        return reply
          .code(400)
          .send({ error: apiMsg(req, 'cible exclusive : targetCharacterId ou targetLabel') });
      }
      if (body.targetCharacterId !== undefined) {
        if (
          typeof body.targetCharacterId !== 'number' ||
          !Number.isInteger(body.targetCharacterId)
        ) {
          return reply.code(400).send({ error: apiMsg(req, 'targetCharacterId is required') });
        }
        const targetChar = getCharacter(drizzle, body.targetCharacterId);
        // Le picker ne liste que des persos du même groupe non cachés — la
        // règle est répliquée côté API : autre groupe / caché / inexistant
        // → même 404 (un 404 ne divulgue pas l'existence d'une fiche secrète).
        if (!targetChar || targetChar.party_id !== char.party_id || targetChar.hidden) {
          return reply.code(404).send({ error: apiMsg(req, 'character not found') });
        }
        target = { kind: 'character', id: targetChar.id };
      } else if (body.targetLabel !== undefined) {
        const label = typeof body.targetLabel === 'string' ? body.targetLabel.trim() : '';
        if (!label || label.length > 60) {
          return reply.code(400).send({ error: apiMsg(req, 'targetLabel is required') });
        }
        target = { kind: 'label', label };
      }
      // Porteur de la ligne : la cible fiche, ou le LANCEUR pour « Autre »
      // (pas de fiche : la ligne vit sur sa feuille pour ses chips, sans
      // toucher sa CA — activeAcEffectsOf filtre target_label IS NULL).
      const bearerId = target.kind === 'character' ? target.id : char.id;

      // Pas de double : un effet ACTIF du même sort SUR LE MÊME PORTEUR →
      // 409 (self ou cible dédiée). Deux lanceurs différents peuvent chacun
      // bénir le même porteur — c'est le MD qui tranche (non-cumul RAW).
      const existing = drizzle
        .select({ id: characterSpellEffects.id })
        .from(characterSpellEffects)
        .where(
          and(
            eq(characterSpellEffects.characterId, bearerId),
            eq(characterSpellEffects.spellId, spell.id),
            eq(characterSpellEffects.active, 1),
          ),
        )
        .get();
      if (existing) {
        return reply.code(409).send({ error: apiMsg(req, 'cet effet est déjà actif') });
      }

      // NB : getDb().transaction(fn) RETOURNE la fonction transaction — il faut
      // l'invoquer (pattern `})();`).
      const inserted = getDb().transaction(() => {
        const row = drizzle
          .insert(characterSpellEffects)
          .values({
            characterId: bearerId,
            casterCharacterId: char.id,
            spellId: spell.id,
            effectKind: def.kind,
            acValue: def.value,
            tiedToConcentration: def.tiedToConcentration ? 1 : 0,
            expiresOnTurnEnd: def.expiresOnTurnEnd ? 1 : 0,
            targetLabel: target.kind === 'label' ? target.label : null,
            active: 1,
          })
          .returning({ id: characterSpellEffects.id })
          .get();
        // Concentration-dépendant : poser l'effet pose aussi la concentration
        // — sur le LANCEUR (même un sort posé sur autrui, c'est lui qui
        // concentre), même transaction, les deux tombent ensemble ou pas.
        if (def.tiedToConcentration && !char.concentrating) {
          drizzle
            .update(characters)
            .set({ concentrating: 1 })
            .where(eq(characters.id, char.id))
            .run();
        }
        // La CA des combatants du PORTEUR suit la pose — même transaction,
        // l'effet est visible de activeAcEffectsOf relu par le miroir. Pour
        // « Autre » le porteur de ligne est le lanceur, mais son effet est
        // étiqueté : aucun impact CA, le miroir ne bouge rien.
        mirrorAcToCombatants(bearerId, userId);
        return row;
      })();

      const row = drizzle
        .select({
          id: characterSpellEffects.id,
          character_id: characterSpellEffects.characterId,
          caster_character_id: characterSpellEffects.casterCharacterId,
          target_label: characterSpellEffects.targetLabel,
          spell_id: characterSpellEffects.spellId,
          effect_kind: characterSpellEffects.effectKind,
          ac_value: characterSpellEffects.acValue,
          tied_to_concentration: characterSpellEffects.tiedToConcentration,
          expires_on_turn_end: characterSpellEffects.expiresOnTurnEnd,
          active: characterSpellEffects.active,
          created_at: characterSpellEffects.createdAt,
          spell_name: spells.name,
          spell_name_fr: spells.nameFr,
          spell_srd_index: spells.srdIndex,
          target_character_id: characterSpellEffects.characterId,
        })
        .from(characterSpellEffects)
        .innerJoin(spells, eq(spells.id, characterSpellEffects.spellId))
        .where(eq(characterSpellEffects.id, inserted.id))
        .get();

      // v2 : quand l'effet vit sur une AUTRE fiche, la CIBLE (sa CA bouge)
      // ET le LANCEUR (ses chips / sa concentration) rafraîchissent chacun —
      // deux emitChange, chacun avec actorUserId. Pour « Autre » : le lanceur
      // seul (aucune fiche cible).
      const bearerRow = target.kind === 'character' ? getCharacter(drizzle, target.id) : null;
      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: bearerRow ? bearerRow.id : char.id,
        action: 'stats',
        actorUserId: userId,
      });
      if (bearerRow && bearerRow.id !== char.id) {
        bus.emitChange({
          type: 'character:change',
          partyId: char.party_id,
          characterId: char.id,
          action: 'stats',
          actorUserId: userId,
        });
      }
      return reply.code(201).send({ effect: mapSpellEffect(row, langFromReq(req)) });
    },
  );

  // ---------- Lift an effect (owner/GM) — deactivate + concentration follows ----------
  app.delete(
    '/spell-effects/:effectId',
    async (req: FastifyRequest<{ Params: { effectId: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const effect = drizzle
        .select(cols(characterSpellEffects))
        .from(characterSpellEffects)
        .where(eq(characterSpellEffects.id, Number(req.params.effectId)))
        .get() as any;
      if (!effect) return reply.code(404).send({ error: apiMsg(req, 'effect not found') });
      const char = getCharacter(drizzle, effect.character_id);
      if (!char) return reply.code(404).send({ error: apiMsg(req, 'character not found') });
      if (!isPartyMember(char.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      // Le porteur de ligne reste la porte d'entrée (le MD lève depuis la
      // fiche de la CIBLE comme depuis celle du lanceur — les deux voient
      // la ligne) : owner du porteur ou MD du groupe.
      if (!isOwnerOrGM(char, userId)) {
        return reply
          .code(403)
          .send({ error: apiMsg(req, 'only the owner or GM can modify spell effects') });
      }
      if (!effect.active) {
        return reply.code(409).send({ error: apiMsg(req, 'cet effet est déjà levé') });
      }
      // v2 : la concentration appartient au LANCEUR — la chute éventuelle se
      // juge sur LUI. Lignes sans lanceur (posées à la main par un MD) : la
      // concentration du porteur n'est plus gérée par ces lignes-là.
      const caster = effect.caster_character_id
        ? getCharacter(drizzle, effect.caster_character_id)
        : null;

      const stillConcentrating = getDb().transaction(() => {
        let casterConcentrating = caster ? !!caster.concentrating : false;
        drizzle
          .update(characterSpellEffects)
          .set({ active: 0 })
          .where(eq(characterSpellEffects.id, effect.id))
          .run();
        // La concentration du LANCEUR ne tombe que si PLUS AUCUN effet
        // actif CASTÉ PAR LUI ne la justifie (le joueur peut concentrer un
        // sort sans effet CA).
        if (effect.tied_to_concentration && caster) {
          const remaining = drizzle
            .select({ id: characterSpellEffects.id })
            .from(characterSpellEffects)
            .where(
              and(
                eq(characterSpellEffects.casterCharacterId, caster.id),
                eq(characterSpellEffects.tiedToConcentration, 1),
                eq(characterSpellEffects.active, 1),
              ),
            )
            .get();
          if (!remaining && caster.concentrating) {
            drizzle
              .update(characters)
              .set({ concentrating: 0 })
              .where(eq(characters.id, caster.id))
              .run();
            casterConcentrating = false;
          }
        }
        // La CA du PORTEUR suit la levée (l'effet étiqueté « Autre » ne
        // portait aucune CA — miroir idempotent, il ne bouge rien).
        mirrorAcToCombatants(char.id, userId);
        return casterConcentrating;
      })();

      // CIBLE (porteur — sa CA peut bouger) puis LANCEUR (ses chips / sa
      // concentration) : deux emitChange quand la ligne vivait chez autrui.
      bus.emitChange({
        type: 'character:change',
        partyId: char.party_id,
        characterId: char.id,
        action: 'stats',
        actorUserId: userId,
      });
      if (caster && caster.id !== char.id) {
        bus.emitChange({
          type: 'character:change',
          partyId: char.party_id,
          characterId: caster.id,
          action: 'stats',
          actorUserId: userId,
        });
      }
      return reply.send({ ok: true, concentrating: stillConcentrating });
    },
  );
}
