/**
 * Monster catalog routes: search the French SRD bestiary, get a full stat block.
 * Monsters are global reference data (no party scoping), like spells.
 */

import type { Monster, MonsterAction, MonsterSummary } from '@table-sync/shared';
import {
  cleanMonsterActionTextEn,
  monsterDamageTypeEn,
  parseMonsterActionCombatInfo,
} from '@table-sync/shared';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db/index.ts';
import { normalizeText } from '../db/index.ts';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { combatants, encounters, monsters } from '../db/schema.ts';
import { isPartyGM, isPartyMember, requireUser } from './lib/membership.ts';
import {
  customMonsterSlug,
  mergeMonsterBody,
  monsterValues,
  validateMonsterFields,
} from './lib/monster-fields.ts';
import { sendCachedJson } from './httpCache.ts';
import { type AppLang, langFromReq } from './lang.ts';
import { apiMsg } from './messages.ts';
import { bus } from '../sync/bus.ts';
import { CustomMonsterBody, NoBody, UpdateMonsterBody } from '../validation.ts';

interface MonsterQuery {
  search?: string;
  limit?: string;
  /** Scope SRD + monstres personnalisés du groupe (membre uniquement). */
  partyId?: string;
  /** 'custom' = uniquement les monstres personnalisés du groupe (pupitre MD). */
  origin?: string;
}

/**
 * Fusionne les actions EN (name/desc) par-dessus les actions FR : les champs
 * calculés à l'import (bonus d'attaque, dés, type) devaient survivre au
 * changement de langue — ici ils sont recalculés depuis le texte EN nettoyé
 * (5e.tools), avec repli sur les valeurs FR quand le texte EN ne s'analyse
 * pas. Alignement indice à indice quand les listes correspondent, sinon
 * l'EN prime seul.
 */
function mergeLocalizedActions(
  fr: MonsterAction[],
  en: { name: string; desc: string }[],
): MonsterAction[] {
  const cleaned = en.map((e) => ({ ...e, desc: cleanMonsterActionTextEn(e.desc) }));
  const aligned = cleaned.length === fr.length;
  return cleaned.map((e, i) => {
    const parsed = parseMonsterActionCombatInfo(e.desc);
    const fallback = aligned ? fr[i] : undefined;
    return {
      ...(fallback ?? { name: e.name, desc: e.desc }),
      name: e.name,
      desc: e.desc,
      attackBonus: parsed.attackBonus ?? fallback?.attackBonus,
      damageDice: parsed.damageDice ?? fallback?.damageDice,
      damageType: parsed.damageType ?? monsterDamageTypeEn(fallback?.damageType),
    };
  });
}

/** Map a raw DB row to a full Monster stat block (parses JSON columns). */
type MonsterOverlay = {
  name?: string;
  traits?: { name: string; desc: string }[];
  actions?: { name: string; desc: string }[];
  bonusActions?: { name: string; desc: string }[];
  reactions?: { name: string; desc: string }[];
  legendaryActions?: { name: string; desc: string }[];
  senses?: string;
  languages?: string;
  speed?: string;
};

function parseOverlay(row: any): MonsterOverlay | null {
  const raw = row.overlay_en;
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? (parsed as MonsterOverlay) : null;
  } catch {
    return null;
  }
}

function mapMonster(row: any, lang: AppLang = 'fr'): Monster {
  const base: Monster = {
    slug: row.slug,
    name: row.name_fr,
    type: row.type ?? '',
    subtype: row.subtype ?? null,
    size: row.size ?? 'M',
    alignment: row.alignment ?? null,
    armorClass: row.armor_class ?? 10,
    armorDesc: row.armor_desc ?? null,
    hitPoints: row.hit_points ?? 10,
    hitDice: row.hit_dice ?? null,
    speed: parseJson(row.speed_json, {}),
    abilities: parseJson(row.abilities_json, {
      for: 10,
      dex: 10,
      con: 10,
      int: 10,
      sag: 10,
      cha: 10,
    }),
    savingThrows: parseJson(row.saving_throws_json, []),
    skills: parseJson(row.skills_json, []),
    languages: parseJson(row.languages_json, []),
    challengeRating: row.challenge_rating ?? 0,
    xp: row.xp ?? 0,
    senses: row.senses ?? null,
    telepathy: row.telepathy ?? null,
    damageResistances: parseJsonOrNull(row.damage_resistances_json),
    damageImmunities: parseJsonOrNull(row.damage_immunities_json),
    conditionImmunities: parseJsonOrNull(row.condition_immunities_json),
    traits: parseJson(row.traits_json, []),
    actions: parseJson(row.actions_json, []),
    legendaryActions: parseJson(row.legendary_actions_json, []),
    origin: row.origin === 'custom' ? 'custom' : 'srd',
  };
  const overlay = lang === 'en' ? parseOverlay(row) : null;
  if (!overlay) return base;
  if (overlay.name) base.name = overlay.name;
  if (overlay.traits) base.traits = mergeLocalizedActions(base.traits, overlay.traits);
  if (overlay.actions) base.actions = mergeLocalizedActions(base.actions, overlay.actions);
  if (overlay.legendaryActions) {
    base.legendaryActions = mergeLocalizedActions(base.legendaryActions, overlay.legendaryActions);
  }
  if (overlay.senses) base.senses = overlay.senses;
  if (typeof overlay.languages === 'string') {
    base.languages = overlay.languages
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
  }
  if (overlay.speed) base.speedText = overlay.speed;
  return base;
}

/** Map a raw DB row to a light MonsterSummary (no prose). */
function mapMonsterSummary(row: any, lang: AppLang = 'fr'): MonsterSummary {
  return {
    slug: row.slug,
    // Overlay parsé UNIQUEMENT en anglais (le JSON fait ~1,6 KB/monstre,
    // la requête ne le sélectionne même plus en FR).
    name: lang === 'en' ? (parseOverlay(row)?.name ?? row.name_fr) : row.name_fr,
    type: row.type ?? '',
    size: row.size ?? 'M',
    challengeRating: row.challenge_rating ?? 0,
    armorClass: row.armor_class ?? 10,
    hitPoints: row.hit_points ?? 10,
    origin: row.origin === 'custom' ? 'custom' : 'srd',
    ...(row.hit_dice !== undefined ? { hitDice: row.hit_dice ?? null } : {}),
    ...(row.xp !== undefined ? { xp: row.xp ?? 0 } : {}),
  };
}

function parseJson<T>(raw: any, fallback: T): T {
  if (!raw) return fallback;
  if (typeof raw !== 'string') return raw as T;
  try {
    const parsed = JSON.parse(raw);
    return (parsed === null ? fallback : parsed) as T;
  } catch {
    return fallback;
  }
}

function parseJsonOrNull(raw: any): any[] | null {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Préambule partagé PATCH/DELETE : charge le monstre par slug, exige un
 * CUSTOM appartenant à un groupe dont l'auteur de la requête est MD —
 * la réponse d'erreur est déjà partie, retourne null.
 */
function customMonsterForGM(
  req: FastifyRequest<{ Params: { slug: string } }>,
  reply: FastifyReply,
  userId: number,
  verb: 'modifiés' | 'supprimés',
): any | null {
  const monster = getDrizzle()
    .select(cols(monsters))
    .from(monsters)
    .where(eq(monsters.slug, req.params.slug))
    .get() as any;
  if (!monster) {
    reply.code(404).send({ error: apiMsg(req, 'Monstre introuvable') });
    return null;
  }
  if (monster.origin !== 'custom') {
    reply.code(403).send({
      error: apiMsg(req, `seuls les monstres personnalisés peuvent être ${verb}`),
    });
    return null;
  }
  if (!isPartyGM(monster.party_id, userId)) {
    reply.code(403).send({
      error: apiMsg(req, `seul le MD peut ${verb === 'modifiés' ? 'modifier' : 'supprimer'}`),
    });
    return null;
  }
  return monster;
}

export async function monsterRoutes(app: FastifyInstance) {
  // ---------- Search monsters (DB-filtered, accent-insensitive) ----------
  app.get(
    '/monsters',
    async (req: FastifyRequest<{ Querystring: MonsterQuery }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;

      const { search } = req.query || {};
      const lim = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

      // Scope groupe : SRD + monstres personnalisés du groupe (membre seul).
      // Sans partyId, le catalogue reste le SRD pur (les customs ne fuient
      // jamais entre tables) et garde sa fenêtre maxAge ; AVEC partyId le
      // périmètre peut porter du contenu mutable → ETag seul (Q11a).
      const partyIdRaw = req.query.partyId;
      const partyId = partyIdRaw !== undefined && partyIdRaw !== '' ? Number(partyIdRaw) : null;
      if (partyId !== null) {
        if (!Number.isInteger(partyId) || partyId <= 0) {
          return reply.code(400).send({ error: apiMsg(req, 'groupe invalide') });
        }
        if (!isPartyMember(partyId, userId)) {
          return reply.code(403).send({ error: apiMsg(req, 'pas membre du groupe') });
        }
      }
      const customsOnly = req.query.origin === 'custom' && partyId !== null;

      const lang = langFromReq(req);
      // Recherche sur la colonne PRÉCALCULÉE search_text (normalisée au
      // seed/backfill : nom FR + type + overlay EN concaténés) — l'ancienne
      // forme appelait l'UDF JS normalize() sur les trois colonnes de CHAQUE
      // ligne (dont l'overlay de ~1,6 KB), ~3000 appels JS par recherche.
      // Seul le MOTIF passe encore par normalize() (une fois par requête).
      // L'overlay EN n'est sélectionné que pour l'affichage anglais.
      const needle = search !== undefined && search !== '' ? search : null;
      const conditions: SQL[] = [];
      if (needle) {
        conditions.push(sql`${monsters.searchText} LIKE normalize(${`%${needle}%`})`);
      }
      if (partyId !== null) {
        conditions.push(
          customsOnly
            ? sql`${monsters.origin} = 'custom' AND ${monsters.partyId} = ${partyId}`
            : sql`(${monsters.origin} = 'srd' OR ${monsters.partyId} = ${partyId})`,
        );
      } else {
        // Catalogue global = SRD pur.
        conditions.push(sql`${monsters.origin} = 'srd'`);
      }
      // Le texte EN de l'overlay contient « damage » : une recherche
      // « mage » matchait 957/1061 monstres (sous-chaîne de « damage ») et
      // le tri par CR seul reléguait « Mage » en position ~640 — au-delà de
      // la limite. Deux étages : (1) le NOM porte le motif (name_search
      // prénormalisé) — sinon « mort » laissait les centaines de
      // « Mort-vivant » (TYPE) exclure « Avatar de la mort » (revue #273) ;
      // (2) position de la première occurrence (instr) — les hits au fond du
      // bloc EN restent en fin de liste.
      // NB : pas de repli `sql`0`` sans recherche — SQLite lit un entier nu
      // en ORDER BY comme un INDEX de colonne (« out of range »), pas une
      // constante : les termes n'entrent dans le tri QUE lorsqu'il y a un motif.
      const nameNeedle = needle !== null ? normalizeText(needle) : null;
      const relevance =
        needle !== null
          ? [
              sql`(${monsters.nameSearch} LIKE ${`%${nameNeedle}%`}) DESC`,
              sql`instr(${monsters.searchText}, normalize(${needle}))`,
            ]
          : [];

      const rows = getDrizzle()
        .select({
          slug: monsters.slug,
          name_fr: monsters.nameFr,
          ...(lang === 'en' ? { overlay_en: monsters.overlayEn } : {}),
          type: monsters.type,
          size: monsters.size,
          challenge_rating: monsters.challengeRating,
          armor_class: monsters.armorClass,
          hit_points: monsters.hitPoints,
          origin: monsters.origin,
          ...(customsOnly ? { hit_dice: monsters.hitDice, xp: monsters.xp } : {}),
        })
        .from(monsters)
        .where(and(...conditions))
        // La liste du pupitre se lit par nom ; la recherche SRD garde sa
        // pertinence nom-d'abord puis CR.
        .orderBy(
          ...relevance,
          ...(customsOnly ? [] : [monsters.challengeRating]),
          sql`${monsters.nameFr} COLLATE NOCASE ASC`,
        )
        .limit(lim)
        .all();

      const summaries = rows.map((r) => mapMonsterSummary(r, lang));
      // Méta « dans N rencontre(s) » pour le garde-fou de suppression du
      // pupitre : comptage des rencontres setup/actives référençant chaque
      // slug (une seule requête groupée).
      if (customsOnly && summaries.length > 0) {
        const counts = getDrizzle()
          .select({
            slug: combatants.monsterSlug,
            n: sql<number>`COUNT(DISTINCT ${encounters.id})`,
          })
          .from(combatants)
          .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
          .where(
            and(
              eq(encounters.partyId, partyId),
              inArray(encounters.status, ['setup', 'active']),
              inArray(
                combatants.monsterSlug,
                summaries.map((s) => s.slug),
              ),
            ),
          )
          .groupBy(combatants.monsterSlug)
          .all();
        const bySlug = new Map(counts.map((c) => [c.slug, Number(c.n)]));
        for (const s of summaries) s.encounterCount = bySlug.get(s.slug) ?? 0;
      }

      // Q11a : périmètre de groupe (contenu mutable) ⇒ ETag seul ; le
      // catalogue SRD pur garde sa fenêtre maxAge 3600.
      return sendCachedJson(
        req,
        reply,
        { monsters: summaries },
        { maxAge: partyId !== null ? undefined : 3600 },
      );
    },
  );

  // ---------- Get a full monster stat block ----------
  app.get(
    '/monsters/:slug',
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;

      const row = getDrizzle()
        .select(cols(monsters))
        .from(monsters)
        .where(eq(monsters.slug, req.params.slug))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'Monstre introuvable') });
      // Un monstre personnalisé n'est visible que des membres de son groupe.
      if (row.origin === 'custom' && !isPartyMember(row.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'pas membre du groupe') });
      }

      return reply.send({ monster: mapMonster(row, langFromReq(req)) });
    },
  );

  // ---------- Monstres personnalisés (PR2 « Contenus personnalisés ») ----------

  app.post(
    '/parties/:partyId/monsters',
    { onRequest: [(app as any).authenticate], schema: { body: CustomMonsterBody } },
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: Record<string, any> }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = Number(req.params.partyId);
      // MD SEUL (règle 3) : pas de branche joueur, pas de toggle.
      if (!isPartyGM(partyId, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'seul le MD peut créer des monstres') });
      }
      const checked = validateMonsterFields(req.body || {});
      if (typeof checked === 'string') {
        return reply.code(400).send({ error: apiMsg(req, checked) });
      }

      const drizzle = getDrizzle();
      // Unicité du slug : SELECT puis INSERT en transaction avec retry — la
      // clé primaire est le slug (pas d'autoincrement, pas de rowid fiable).
      const row = getDb().transaction(() => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const slug = customMonsterSlug(checked.nameFr);
          if (
            drizzle
              .select({ one: sql`1` })
              .from(monsters)
              .where(eq(monsters.slug, slug))
              .get()
          ) {
            continue;
          }
          return drizzle
            .insert(monsters)
            .values(monsterValues(slug, checked, partyId, userId))
            .returning(cols(monsters))
            .get() as any;
        }
        return null;
      })();
      if (!row) {
        return reply.code(409).send({ error: apiMsg(req, 'slug déjà pris') });
      }

      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'custom-monster',
        actorUserId: userId,
      });
      return reply.code(201).send({ monster: mapMonster(row, langFromReq(req)) });
    },
  );

  app.patch(
    '/monsters/:slug',
    { onRequest: [(app as any).authenticate], schema: { body: UpdateMonsterBody } },
    async (
      req: FastifyRequest<{ Params: { slug: string }; Body: Record<string, any> }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const monster = customMonsterForGM(req, reply, userId, 'modifiés');
      if (monster === null) return;

      const body = req.body || {};
      const checked = validateMonsterFields(mergeMonsterBody(monster, body));
      if (typeof checked === 'string') {
        return reply.code(400).send({ error: apiMsg(req, checked) });
      }
      if (Object.keys(body).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'requête invalide') });
      }

      drizzle
        .update(monsters)
        .set(monsterValues(monster.slug, checked, monster.party_id, monster.created_by))
        .where(eq(monsters.slug, monster.slug))
        .run();
      const row = drizzle
        .select(cols(monsters))
        .from(monsters)
        .where(eq(monsters.slug, monster.slug))
        .get() as any;

      bus.emitChange({
        type: 'party:change',
        partyId: monster.party_id,
        action: 'custom-monster',
        actorUserId: userId,
      });
      return reply.send({ monster: mapMonster(row, langFromReq(req)) });
    },
  );

  app.delete(
    '/monsters/:slug',
    { onRequest: [(app as any).authenticate], schema: { body: NoBody } },
    async (req: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const monster = customMonsterForGM(req, reply, userId, 'supprimés');
      if (monster === null) return;

      // Garde-fou Q6a : refuser tant qu'une rencontre setup/active référence
      // le slug — les combatants vivraient (snapshot) mais le bloc consultable
      // 404rait en pleine séance. Les rencontres terminées ne bloquent pas.
      // (DISTINCT : trois exemplaires groupés = UNE rencontre, pas trois.)
      const live = drizzle
        .selectDistinct({ id: encounters.id, name: encounters.name, status: encounters.status })
        .from(combatants)
        .innerJoin(encounters, eq(combatants.encounterId, encounters.id))
        .where(
          and(
            eq(combatants.monsterSlug, monster.slug),
            inArray(encounters.status, ['setup', 'active']),
          ),
        )
        .all();
      if (live.length > 0) {
        return reply.code(409).send({
          error: apiMsg(req, 'encore utilisé par des rencontres'),
          encounters: live,
        });
      }

      drizzle.delete(monsters).where(eq(monsters.slug, monster.slug)).run();
      bus.emitChange({
        type: 'party:change',
        partyId: monster.party_id,
        action: 'custom-monster',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
