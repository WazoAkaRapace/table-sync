/**
 * Spell catalog routes: list SRD spells with filters, get a single spell.
 * Spells are global SRD reference data (no party scoping), but still
 * require authentication (enforced by the global guard in server.ts).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { characterSpells, characters, spells } from '../db/schema.ts';
import { mapSpell } from './lib/mappers.ts';
import {
  denyUnlessCustomOfGM,
  isPartyMember,
  partyGMParamOr403,
  partyScopeFromQuery,
  requireUser,
} from './lib/membership.ts';
import {
  customSpellIndex,
  mergeSpellBody,
  spellValues,
  validateSpellFields,
} from './lib/spell-fields.ts';
import { retryInsertUnique } from './lib/unique-insert.ts';
import { sendCachedJson } from './httpCache.ts';
import { type AppLang, langFromReq, pickLocalized } from './lang.ts';
import { apiMsg } from './messages.ts';
import { bus } from '../sync/bus.ts';
import { CustomSpellBody, NoBody, UpdateSpellBody } from '../validation.ts';
import type { Spell } from '@table-sync/shared';

// ---------- English spell meta (data/spells-en-meta.json) ----------
//
// Le stockage des sorts est FR ; nom et description ont leur colonne EN en
// base, mais les champs méta (incantation, portée, matériel, durée, niveaux
// supérieurs) vivent dans un annexe chargé UNE fois au démarrage — même
// résolution de chemin que db/seed.ts (cwd puis racine du monorepo).

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SpellEnMeta {
  castingTime: string | null;
  rangeText: string | null;
  material: string | null;
  duration: string | null;
  higherLevel: string | null;
}

function resolveSeedPath(filename: string): string {
  const candidates = [
    resolve(process.cwd(), 'data', filename),
    resolve(__dirname, '..', '..', '..', '..', 'data', filename),
  ];
  for (const p of candidates) {
    try {
      readFileSync(p, 'utf8');
      return p;
    } catch {
      // candidat suivant
    }
  }
  throw new Error(`${filename} not found in: ${candidates.join(', ')}`);
}

function loadSpellEnMeta(): Record<string, SpellEnMeta> {
  try {
    return JSON.parse(readFileSync(resolveSeedPath('spells-en-meta.json'), 'utf8'));
  } catch {
    // Annexe absent : repli champ par champ sur le FR stocké.
    return {};
  }
}

const SPELL_EN_META = loadSpellEnMeta();

/**
 * Recouvre les champs méta d'un sort déjà mappé par leur version anglaise
 * (clé : srdIndex). Repli CHAMP PAR CHAMP sur la valeur existante (FR)
 * lorsqu'une entrée ou un champ manque — jamais de payload mixte cassé.
 */
export function withSpellEnMeta<T extends Spell>(spell: T, lang: AppLang): T {
  if (lang !== 'en') return spell;
  const meta = spell.srdIndex ? SPELL_EN_META[spell.srdIndex] : undefined;
  if (!meta) return spell;
  return {
    ...spell,
    castingTime: meta.castingTime ?? spell.castingTime,
    rangeText: meta.rangeText ?? spell.rangeText,
    material: meta.material ?? spell.material,
    duration: meta.duration ?? spell.duration,
    higherLevel: meta.higherLevel ?? spell.higherLevel,
  } as T;
}

interface SpellQuery {
  class?: string;
  level?: string;
  school?: string;
  search?: string;
  limit?: string;
  offset?: string;
  /** Scope SRD + sorts personnalisés du groupe (membre uniquement). */
  partyId?: string;
  /** 'custom' = uniquement les sorts personnalisés du groupe (pupitre MD). */
  source?: string;
}

export async function spellRoutes(app: FastifyInstance) {
  // ---------- List spells (paginated, filterable) ----------
  app.get(
    '/spells',
    async (req: FastifyRequest<{ Querystring: SpellQuery }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;

      const { class: klass, level, school, search } = req.query || {};
      const lim = Math.min(parseInt(req.query.limit || '30', 10) || 30, 200);
      const off = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

      // Scope groupe (Q4a/Q11a) : SRD + sorts personnalisés du groupe (membre
      // seul) ; sans partyId le catalogue reste le SRD pur (les customs ne
      // fuient jamais entre tables) et garde sa fenêtre maxAge.
      const partyId = partyScopeFromQuery(req.query.partyId, req, reply, userId);
      if (partyId === undefined) return;
      const customsOnly = req.query.source === 'custom' && partyId !== null;

      const where: Array<SQL | undefined> = [];
      where.push(
        customsOnly
          ? sql`${spells.source} = 'custom' AND ${spells.partyId} = ${partyId}`
          : partyId !== null
            ? sql`(${spells.source} = 'srd' OR ${spells.partyId} = ${partyId})`
            : sql`${spells.source} = 'srd'`,
      );

      // Class filter: classes_json LIKE (French class names, case-insensitive).
      // classes_json is stored as '["Magicien","Ensorceleur"]' so we match
      // against the quoted value. We wrap both sides in normalize() so accents
      // (é in "Magicien" is fine, but future-proof for accented names) match.
      if (klass) {
        // Multiclassage : le filtre accepte plusieurs classes (séparées par
        // des virgules) — UNION des listes de sorts.
        const classNames = String(klass)
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
        if (classNames.length > 0) {
          where.push(
            or(
              ...classNames.map(
                (name) => sql`normalize(${spells.classesJson}) LIKE normalize(${`%"${name}"%`})`,
              ),
            ),
          );
        }
      }

      // Level filter: exact match (0-9). 0 = cantrip.
      if (level !== undefined && level !== '') {
        const lv = parseInt(level, 10);
        if (!Number.isNaN(lv) && lv >= 0 && lv <= 9) {
          where.push(eq(spells.level, lv));
        }
      }

      // School filter: exact match (lowercase school key).
      if (school) {
        where.push(eq(spells.school, school.toLowerCase()));
      }

      // Search: accent-insensitive match on name OR name_fr.
      if (search) {
        where.push(
          or(
            sql`normalize(${spells.name}) LIKE normalize(${`%${search}%`})`,
            sql`normalize(${spells.nameFr}) LIKE normalize(${`%${search}%`})`,
          ),
        );
      }

      const filter = where.length > 0 ? and(...where) : undefined;

      const drizzle = getDrizzle();
      const rows = drizzle
        .select(cols(spells))
        .from(spells)
        .where(filter)
        .orderBy(spells.level, sql`COALESCE(${spells.nameFr}, ${spells.name}) COLLATE NOCASE ASC`)
        .limit(lim)
        .offset(off)
        .all() as any[];

      const total = (
        drizzle
          .select({ n: sql<number>`count(*)` })
          .from(spells)
          .where(filter)
          .get() as any
      ).n;

      const lang = langFromReq(req);
      const mapped = rows.map((r: any) => withSpellEnMeta(mapSpell(r, lang, true), lang));
      // Méta « Connu par N » pour le garde-fou de suppression du pupitre :
      // comptage des liens character_spells par sort (une requête groupée).
      if (customsOnly && mapped.length > 0) {
        const counts = getDrizzle()
          .select({ spell_id: characterSpells.spellId, n: sql<number>`COUNT(*)` })
          .from(characterSpells)
          .where(
            inArray(
              characterSpells.spellId,
              mapped.map((s: any) => s.id),
            ),
          )
          .groupBy(characterSpells.spellId)
          .all();
        const byId = new Map(counts.map((c) => [c.spell_id, Number(c.n)]));
        for (const s of mapped) s.knownBy = byId.get(s.id) ?? 0;
      }
      // Résumés sans prose (la fiche de sort charge GET /spells/:id à
      // l'ouverture). Q11a : périmètre de groupe (contenu mutable) ⇒ ETag
      // seul ; le catalogue SRD pur garde sa fenêtre max-age 300.
      return sendCachedJson(
        req,
        reply,
        {
          spells: mapped,
          total,
          limit: lim,
          offset: off,
        },
        { maxAge: partyId !== null ? undefined : 300 },
      );
    },
  );

  // ---------- Light catalog: id + French name + level for all spells ----------
  // Used for matching spell names in monster spellcasting entries. Small payload.
  // SRD SEUL : l'appariement par nom des sorts de monstres est fragile sur du
  // texte libre — les customs restent hors /spells/light (phase 2, spec §3.4).
  app.get('/spells/light', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = requireUser(req, reply);
    if (userId === null) return;
    const lang = langFromReq(req);
    const rows = getDrizzle()
      .select({ id: spells.id, name_fr: spells.nameFr, name: spells.name, level: spells.level })
      .from(spells)
      .where(sql`${spells.source} = 'srd'`)
      .orderBy(spells.level, sql`${spells.nameFr} COLLATE NOCASE ASC`)
      .all();
    return sendCachedJson(
      req,
      reply,
      {
        spells: rows.map((r: any) => ({
          id: r.id,
          name: pickLocalized(lang, r.name, r.name_fr),
          level: r.level,
        })),
      },
      { maxAge: 3600 },
    );
  });

  // ---------- Get single spell ----------
  app.get(
    '/spells/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const row = getDrizzle()
        .select(cols(spells))
        .from(spells)
        .where(eq(spells.id, Number(req.params.id)))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'spell not found') });
      // Un sort personnalisé n'est visible que des membres de son groupe.
      if (row.source === 'custom' && !isPartyMember(row.party_id, userId)) {
        return reply.code(403).send({ error: apiMsg(req, 'pas membre du groupe') });
      }
      return reply.send({
        spell: withSpellEnMeta(mapSpell(row, langFromReq(req)), langFromReq(req)),
      });
    },
  );

  // ---------- Sorts personnalisés (PR3 « Contenus personnalisés ») ----------

  /**
   * Préambule partagé PATCH/DELETE : charge le sort par id, exige un CUSTOM
   * appartenant à un groupe dont l'auteur de la requête est MD — la réponse
   * d'erreur est déjà partie, retourne null.
   */
  function customSpellForGM(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    userId: number,
    verb: 'modifiés' | 'supprimés',
  ): any | null {
    const spell = getDrizzle()
      .select(cols(spells))
      .from(spells)
      .where(eq(spells.id, Number(req.params.id)))
      .get() as any;
    if (!spell) {
      reply.code(404).send({ error: apiMsg(req, 'sort introuvable') });
      return null;
    }
    const ok = denyUnlessCustomOfGM(
      spell,
      spell.source === 'custom',
      userId,
      req,
      reply,
      `seuls les sorts personnalisés peuvent être ${verb}`,
      `seul le MD peut ${verb === 'modifiés' ? 'modifier' : 'supprimer'}`,
    );
    return ok ? spell : null;
  }

  app.post(
    '/parties/:partyId/spells',
    { onRequest: [(app as any).authenticate], schema: { body: CustomSpellBody } },
    async (
      req: FastifyRequest<{ Params: { partyId: string }; Body: Record<string, any> }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const partyId = partyGMParamOr403(req, reply, userId, 'seul le MD peut créer des sorts');
      if (partyId === undefined) return;
      const checked = validateSpellFields(req.body || {});
      if (typeof checked === 'string') {
        return reply.code(400).send({ error: apiMsg(req, checked) });
      }

      const drizzle = getDrizzle();
      // srd_index synthétique `custom-<partyId>-<hex6>` : unicité par retry
      // SELECT-then-INSERT en transaction (la colonne reste NOT NULL UNIQUE).
      const row = retryInsertUnique(
        () => customSpellIndex(partyId),
        (srdIndex) =>
          !!drizzle
            .select({ one: sql`1` })
            .from(spells)
            .where(eq(spells.srdIndex, srdIndex))
            .get(),
        (srdIndex) =>
          drizzle
            .insert(spells)
            .values(spellValues(checked, srdIndex, partyId, userId))
            .returning(cols(spells))
            .get() as any,
      );
      if (!row) {
        return reply.code(409).send({ error: apiMsg(req, 'index déjà pris') });
      }

      bus.emitChange({
        type: 'party:change',
        partyId,
        action: 'custom-spell',
        actorUserId: userId,
      });
      return reply.code(201).send({ spell: mapSpell(row, langFromReq(req)) });
    },
  );

  app.patch(
    '/spells/:id',
    { onRequest: [(app as any).authenticate], schema: { body: UpdateSpellBody } },
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: Record<string, any> }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const spell = customSpellForGM(req, reply, userId, 'modifiés');
      if (spell === null) return;

      const body = req.body || {};
      if (Object.keys(body).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'requête invalide') });
      }
      // srd_index/source/party_id/created_by ne sont jamais patchables : la
      // fusion ne les lit pas, spellValues les re-pose à l'identique.
      const checked = validateSpellFields(mergeSpellBody(spell, body));
      if (typeof checked === 'string') {
        return reply.code(400).send({ error: apiMsg(req, checked) });
      }

      drizzle
        .update(spells)
        .set(spellValues(checked, spell.srd_index, spell.party_id, spell.created_by))
        .where(eq(spells.id, spell.id))
        .run();
      const row = drizzle
        .select(cols(spells))
        .from(spells)
        .where(eq(spells.id, spell.id))
        .get() as any;

      bus.emitChange({
        type: 'party:change',
        partyId: spell.party_id,
        action: 'custom-spell',
        actorUserId: userId,
      });
      return reply.send({ spell: mapSpell(row, langFromReq(req)) });
    },
  );

  app.delete(
    '/spells/:id',
    { onRequest: [(app as any).authenticate], schema: { body: NoBody } },
    async (
      req: FastifyRequest<{ Params: { id: string }; Querystring: { force?: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = requireUser(req, reply);
      if (userId === null) return;
      const drizzle = getDrizzle();
      const spell = customSpellForGM(req, reply, userId, 'supprimés');
      if (spell === null) return;

      // Garde-fou Q7a/position 3 : par défaut, refuser tant que des
      // personnages connaissent le sort — la liste des porteurs part au
      // client (modal de conséquences) ; ?force=1 cascade les liens.
      const carriers = drizzle
        .select({
          characterId: characters.id,
          name: characters.name,
          className: characters.characterClass,
          level: characters.level,
        })
        .from(characterSpells)
        .innerJoin(characters, eq(characters.id, characterSpells.characterId))
        .where(eq(characterSpells.spellId, spell.id))
        .all();
      if (carriers.length > 0 && req.query.force !== '1') {
        return reply.code(409).send({
          error: apiMsg(req, 'encore connu par des personnages'),
          knownBy: carriers,
        });
      }

      drizzle.delete(spells).where(eq(spells.id, spell.id)).run();
      bus.emitChange({
        type: 'party:change',
        partyId: spell.party_id,
        action: 'custom-spell',
        actorUserId: userId,
      });
      return reply.code(204).send();
    },
  );
}
