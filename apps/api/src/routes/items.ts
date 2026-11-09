/**
 * Item catalog routes: search SRD + custom items, GM creates custom items.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateCustomItem } from '@table-sync/shared';
import {
  DAMAGE_TYPE_LABELS_FR,
  MUNDANE_WEAPONS,
  WEAPON_PROPERTY_LABELS_FR,
  parseDamageTemplate,
  resolveItemBases,
} from '@table-sync/shared';
import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getItemImagesDir } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { items, parties, partyMembers } from '../db/schema.ts';
import { bus } from '../sync/bus.ts';
import { isPartyGM, isPartyMember, mapItem, requireUser } from './helpers.ts';
import { sendCachedJson } from './httpCache.ts';
import { langFromReq } from './lang.ts';
import { apiMsg } from './messages.ts';

interface ItemQuery {
  search?: string;
  category?: string;
  rarity?: string;
  limit?: string;
  offset?: string;
  partyId?: string;
}

// Projection résumé du catalogue : les colonnes description/description_en
// (~750 o/article en moyenne) étaient lues PUIS jetées par mapItem(summary) —
// la recherche n'affiche jamais la prose. On ne descend que l'existence, le
// même drapeau que l'inventaire embarqué (contrat lazyDetails inchangé).
// L'onglet Objets custom du MD (source=custom) rend et édite la prose : il
// garde la ligne complète.
const ITEM_SUMMARY_COLS: Record<string, any> = {
  ...cols(items),
  has_description: sql<boolean>`(COALESCE(${items.description}, '') != '' OR COALESCE(${items.descriptionEn}, '') != '')`,
};
delete ITEM_SUMMARY_COLS.description;
delete ITEM_SUMMARY_COLS.description_en;

// ---------- Champs d'arme des objets custom (plan armes-custom 2026-11) ----------

/** Champs d'arme normalisés prêts à écrire en base (ou message d'erreur FR). */
interface WeaponFields {
  damageDice: string | null;
  damageType: string | null;
  twoHandedDice: string | null;
  magicBonus: number | null;
  baseWeapon: string | null;
  properties: string[];
}

/**
 * Valide les champs d'arme d'une payload POST/PATCH. `input` porte les champs
 * fournis (ou fusionnés avec la ligne existante pour un PATCH) ; tout champ
 * absent vaut null. Retourne le message d'erreur FR, ou les champs validés.
 * Le template deux mains n'est conservé que si la propriété Polyvalente est
 * cochée — les propriétés inconnues sont filtrées silencieusement (jamais
 * d'injection de clé arbitraire dans properties_json).
 */
function validateWeaponFields(input: {
  damageDice?: unknown;
  damageType?: unknown;
  twoHandedDice?: unknown;
  magicBonus?: unknown;
  baseWeapon?: unknown;
  properties?: unknown;
}): string | WeaponFields {
  const asTrimmed = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

  const damageDice = asTrimmed(input.damageDice);
  if (damageDice && parseDamageTemplate(damageDice) === null) return 'template de dégâts invalide';

  const damageType = asTrimmed(input.damageType);
  if (damageType && !(damageType in DAMAGE_TYPE_LABELS_FR)) return 'type de dégâts invalide';

  let properties: string[];
  if (input.properties === undefined || input.properties === null) properties = [];
  else if (Array.isArray(input.properties))
    properties = input.properties.filter(
      (p): p is string => typeof p === 'string' && p in WEAPON_PROPERTY_LABELS_FR,
    );
  else return 'propriétés invalides';

  const twoHandedDice = properties.includes('versatile') ? asTrimmed(input.twoHandedDice) : null;
  if (twoHandedDice && parseDamageTemplate(twoHandedDice) === null)
    return 'template de dégâts invalide';

  const rawBonus = input.magicBonus;
  if (rawBonus !== undefined && rawBonus !== null) {
    if (typeof rawBonus !== 'number' || ![0, 1, 2, 3].includes(rawBonus))
      return 'bonus magique invalide';
  }
  const magicBonus = rawBonus === undefined || rawBonus === null ? null : rawBonus;

  const baseWeapon = asTrimmed(input.baseWeapon);
  if (baseWeapon && !MUNDANE_WEAPONS.some((m) => m.nameEn === baseWeapon))
    return 'arme de base inconnue';

  return { damageDice, damageType, twoHandedDice, magicBonus, baseWeapon, properties };
}

export async function itemRoutes(app: FastifyInstance) {
  // ---------- Search catalog ----------
  app.get(
    '/items',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Querystring: ItemQuery }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;

      const {
        search,
        category,
        rarity,
        limit,
        offset,
        source,
        partyId: partyIdFilter,
      } = (req.query as any) || {};
      const lim = Math.min(parseInt(limit || '50', 10) || 50, 200);
      const off = Math.max(parseInt(offset || '0', 10) || 0, 0);

      const drizzle = getDrizzle();
      const where: Array<SQL | undefined> = [];

      // Les exemplaires annotés (objets dérivés) ne sont PAS du catalogue :
      // ni recherche joueur ni onglet Objets custom — chaque annotation ne
      // doit pas devenir un objet « ajoutable ». GET /items/:id les sert.
      where.push(isNull(items.derivedFromItemId));

      // A party context (inventory search, GM dashboard) scopes the catalog:
      // SRD items + THAT party's customs only — a member of several parties
      // never sees another party's items. Compose with source=custom for the
      // party's own items alone (GM dashboard custom-items tab).
      if (partyIdFilter) {
        if (!isPartyMember(Number(partyIdFilter), userId)) {
          return reply.code(403).send({ error: apiMsg(req, 'not a member') });
        }
        where.push(or(isNull(items.partyId), eq(items.partyId, Number(partyIdFilter))));
      } else {
        // Default: show global SRD items + custom items from the user's parties
        const userPartyIds = (
          drizzle
            .select({ party_id: partyMembers.partyId })
            .from(partyMembers)
            .where(eq(partyMembers.userId, userId))
            .all() as any[]
        ).map((r) => r.party_id);
        where.push(
          userPartyIds.length > 0
            ? or(isNull(items.partyId), inArray(items.partyId, userPartyIds))
            : isNull(items.partyId),
        );
      }

      if (search) {
        // Accent-insensitive search using a custom SQLite function registered in server.ts.
        // normalize() strips diacritics (é→e, è→e) and lowercases.
        const norm = search.replace(/-/g, ' ');
        where.push(
          or(
            sql`${items.name} LIKE ${`%${search}%`} ESCAPE '\\'`,
            sql`${items.nameFr} LIKE ${`%${search}%`} ESCAPE '\\'`,
            sql`${items.srdIndex} LIKE ${`%${search}%`} ESCAPE '\\'`,
            sql`normalize(${items.name}) LIKE normalize(${`%${norm}%`})`,
            sql`normalize(${items.nameFr}) LIKE normalize(${`%${norm}%`})`,
            sql`normalize(REPLACE(${items.name}, '-', ' ')) LIKE normalize(${`%${norm}%`})`,
            sql`normalize(COALESCE(${items.aliases}, '')) LIKE normalize(${`%${norm}%`})`,
          ),
        );
      }
      if (category) {
        where.push(eq(items.category, category));
      }
      if (rarity && rarity !== 'none') {
        where.push(eq(items.rarity, rarity));
      }
      if (source) {
        where.push(eq(items.source, source));
      }

      const filter = and(...where);
      // Résumés SANS description : la recherche joueur du catalogue n'affiche
      // jamais la prose. Exception : l'onglet Objets custom du MD (source=
      // custom) rend et édite les descriptions — il les garde.
      const summary = source !== 'custom';
      const rows = drizzle
        .select(summary ? ITEM_SUMMARY_COLS : cols(items))
        .from(items)
        .where(filter)
        .orderBy(sql`${items.name} COLLATE NOCASE ASC`)
        .limit(lim)
        .offset(off)
        .all() as any[];
      const total = (
        drizzle
          .select({ n: sql<number>`count(*)` })
          .from(items)
          .where(filter)
          .get() as any
      ).n;

      return sendCachedJson(req, reply, {
        items: rows.map((r: any) => mapItem(r, langFromReq(req), summary)),
        total,
        limit: lim,
        offset: off,
      });
    },
  );

  // ---------- Get single item ----------
  app.get(
    '/items/:id',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const row = getDrizzle()
        .select(cols(items))
        .from(items)
        .where(eq(items.id, Number(req.params.id)))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'item not found') });
      // Custom items are only visible to members of the owning party (SRD items have party_id NULL).
      if (row.party_id != null && !isPartyMember(row.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'not a member') });
      }
      return reply.send({ item: mapItem(row, langFromReq(req)) });
    },
  );

  // ---------- Create custom item (GM always; players when the party allows) ----------
  app.post(
    '/parties/:partyId/items',
    { onRequest: [(app as any).authenticate] },
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: CreateCustomItem }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      const drizzle = getDrizzle();
      if (!isPartyGM(partyId, userId)) {
        // Player-created items are a party setting the GM toggles — autonomy
        // for the players, the kill switch stays on the GM's dashboard.
        const allowed =
          isPartyMember(partyId, userId) &&
          !!(
            drizzle.select(cols(parties)).from(parties).where(eq(parties.id, partyId)).get() as any
          )?.players_create_items;
        if (!allowed) {
          return reply
            .code(403)
            .send({ error: apiMsg(req, 'only the GM can create custom items') });
        }
      }
      const body = req.body || ({} as CreateCustomItem);

      if (!body.name?.trim()) {
        return reply.code(400).send({ error: apiMsg(req, 'name is required') });
      }

      const category = body.category || 'custom';
      // Champs d'arme (category 'weapon' uniquement) : template de dégâts,
      // type SRD, bonus magique, propriétés, arme de base, dés 2M.
      let weapon: WeaponFields | null = null;
      if (category === 'weapon') {
        const checked = validateWeaponFields(body);
        if (typeof checked === 'string') {
          return reply.code(400).send({ error: apiMsg(req, checked) });
        }
        weapon = checked;
      }

      // Clés de base résolues à la création (découplage moteur/noms) — la clé
      // explicite « Basée sur » et le bonus magique de la payload sont
      // prioritaires sur le parse de nom.
      const bases = resolveItemBases({
        category,
        name: body.name.trim(),
        nameFr: body.nameFr || body.name.trim(),
        description: body.description || null,
        damageDice: weapon?.damageDice ?? null,
        baseWeapon: weapon?.baseWeapon ?? null,
        magicBonus: weapon?.magicBonus ?? null,
      });
      const row = drizzle
        .insert(items)
        .values({
          source: 'custom',
          partyId,
          createdBy: userId,
          category,
          name: body.name.trim(),
          nameFr: body.nameFr || null,
          rarity: body.rarity || 'none',
          weightKg: body.weightKg ?? null,
          costQty: body.costQty ?? null,
          costUnit: body.costUnit || null,
          description: body.description || null,
          baseWeapon: bases.baseWeapon,
          baseArmor: bases.baseArmor,
          armorFamily: bases.armorFamily,
          magicBonus: weapon ? (weapon.magicBonus ?? bases.magicBonus) : bases.magicBonus,
          damageDice: weapon?.damageDice ?? null,
          damageType: weapon?.damageType ?? null,
          twoHandedDice: weapon?.twoHandedDice ?? null,
          propertiesJson: JSON.stringify(weapon?.properties ?? []),
        })
        .returning(cols(items))
        .get() as any;
      bus.emitChange({ type: 'party:change', partyId, action: 'custom-item', actorUserId: userId });
      return reply.code(201).send({ item: mapItem(row, langFromReq(req)) });
    },
  );

  // ---------- GM: update a custom item ----------
  app.patch(
    '/items/:id',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const itemId = Number(req.params.id);
      const item = drizzle.select(cols(items)).from(items).where(eq(items.id, itemId)).get() as any;
      if (!item) return reply.code(404).send({ error: apiMsg(req, 'item not found') });
      if (item.source !== 'custom')
        return reply.code(403).send({ error: apiMsg(req, 'can only modify custom items') });

      // Check GM access
      if (!isPartyGM(item.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'only the GM can modify items') });
      }

      // PATCH partiel : clés dynamiques lues une à une ci-dessous (body[k]).
      const body: Record<string, any> = req.body || {};
      const values: Record<string, unknown> = {};
      if (body.name !== undefined) values.name = body.name.trim();
      if (body.category !== undefined) values.category = body.category;
      if (body.rarity !== undefined) values.rarity = body.rarity;
      if (body.weightKg !== undefined) values.weightKg = body.weightKg;
      if (body.costQty !== undefined) values.costQty = body.costQty;
      if (body.costUnit !== undefined) values.costUnit = body.costUnit;
      if (body.description !== undefined) values.description = body.description;

      // Champs d'arme : validés sur le contexte FUSIONNÉ (champs de la payload
      // + colonnes existantes) puis réécrits ; les clés de base sont
      // re-résolues quand un champ d'arme, le nom ou la catégorie bouge.
      const WEAPON_KEYS = [
        'damageDice',
        'damageType',
        'twoHandedDice',
        'magicBonus',
        'baseWeapon',
        'properties',
      ] as const;
      const hasWeaponKey = WEAPON_KEYS.some((k) => body[k] !== undefined);
      const category = (values.category as string | undefined) ?? item.category;
      if (
        category === 'weapon' &&
        (hasWeaponKey || values.name !== undefined || values.category !== undefined)
      ) {
        const checked = validateWeaponFields({
          damageDice: body.damageDice !== undefined ? body.damageDice : item.damage_dice,
          damageType: body.damageType !== undefined ? body.damageType : item.damage_type,
          twoHandedDice:
            body.twoHandedDice !== undefined ? body.twoHandedDice : item.two_handed_dice,
          magicBonus: body.magicBonus !== undefined ? body.magicBonus : item.magic_bonus,
          baseWeapon: body.baseWeapon !== undefined ? body.baseWeapon : item.base_weapon,
          properties:
            body.properties !== undefined
              ? body.properties
              : JSON.parse(item.properties_json || '[]'),
        });
        if (typeof checked === 'string') {
          return reply.code(400).send({ error: apiMsg(req, checked) });
        }
        const bases = resolveItemBases({
          category,
          name: ((values.name as string) ?? item.name) || null,
          nameFr: item.name_fr ?? null,
          description: ((values.description as string) ?? item.description) || null,
          damageDice: checked.damageDice,
          baseWeapon: checked.baseWeapon,
          magicBonus: checked.magicBonus,
        });
        values.damageDice = checked.damageDice;
        values.damageType = checked.damageType;
        values.twoHandedDice = checked.twoHandedDice;
        values.magicBonus = checked.magicBonus ?? bases.magicBonus;
        values.baseWeapon = bases.baseWeapon;
        values.baseArmor = bases.baseArmor;
        values.armorFamily = bases.armorFamily;
        values.propertiesJson = JSON.stringify(checked.properties);
      }

      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'no fields to update') });
      }

      drizzle.update(items).set(values).where(eq(items.id, itemId)).run();
      const row = drizzle.select(cols(items)).from(items).where(eq(items.id, itemId)).get() as any;
      bus.emitChange({
        type: 'party:change',
        partyId: item.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });
      return reply.send({ item: mapItem(row, langFromReq(req)) });
    },
  );

  // ---------- GM: delete a custom item ----------
  app.delete(
    '/items/:id',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const itemId = Number(req.params.id);
      const item = drizzle.select(cols(items)).from(items).where(eq(items.id, itemId)).get() as any;
      if (!item) return reply.code(404).send({ error: apiMsg(req, 'item not found') });
      if (item.source !== 'custom')
        return reply.code(403).send({ error: apiMsg(req, 'can only delete custom items') });

      // Check GM access
      if (!isPartyGM(item.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'only the GM can delete items') });
      }

      drizzle.delete(items).where(eq(items.id, itemId)).run();
      // Drop the attached illustration file too (the row is gone — leave no orphan).
      if (item.image_url) {
        const filePath = join(getItemImagesDir(), item.image_url);
        if (existsSync(filePath)) unlinkSync(filePath);
      }
      bus.emitChange({
        type: 'party:change',
        partyId: item.party_id,
        action: 'custom-item',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
