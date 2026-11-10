/**
 * Spells: catalog search/filters/light/detail, character↔spell links
 * (learn/upsert/patch/forget), always-prepared domain spells.
 * Covers every .prepare site in routes/spells.ts, routes/character-spells.ts
 * and routes/domain-spells.ts.
 */
import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const A = fx.charAlya.id;

  // ---------- catalog ----------
  let r = await api(base, 'GET', '/api/spells', { token: fx.gm.token });
  eq(r.status, 200, 'list spells');
  ok(r.data.total > 300, 'full SRD catalog seeded');

  r = await api(base, 'GET', '/api/spells?class=Magicien&level=3', { token: fx.gm.token });
  ok(r.data.total > 0, 'class + level filter');
  ok(
    r.data.spells.every((s: any) => s.level === 3),
    'level filter consistent',
  );

  r = await api(base, 'GET', '/api/spells?school=evocation&limit=5', { token: fx.gm.token });
  ok(
    r.data.spells.every((s: any) => s.school === 'evocation'),
    'school filter',
  );

  r = await api(base, 'GET', `/api/spells?search=${encodeURIComponent('boule de feu')}`, {
    token: fx.gm.token,
  });
  ok(r.data.total >= 1, 'accent-free French search finds Boule de feu');

  r = await api(base, 'GET', '/api/spells/light', { token: fx.gm.token });
  ok(r.data.spells.length > 100, 'light catalog');
  ok(r.data.spells[0].name, 'light rows carry localized names (fr default)');

  const fireball = srv.query("SELECT id FROM spells WHERE srd_index = 'fireball'");
  ok(fireball, 'fireball seeded');
  r = await api(base, 'GET', `/api/spells/${fireball.id}`, { token: fx.gm.token });
  eq(r.status, 200, 'spell detail');
  eq(r.data.spell.level, 3, 'fireball level');
  r = await api(base, 'GET', '/api/spells/999999', { token: fx.gm.token });
  eq(r.status, 404, 'spell 404');

  // ---------- character spells ----------
  r = await api(base, 'POST', `/api/characters/${A}/spells`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'learn missing spellId → 400');
  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.gm.token,
    body: { spellId: 999999 },
  });
  eq(r.status, 404, 'learn unknown spell → 404');
  r = await api(base, 'POST', '/api/characters/999999/spells', {
    token: fx.gm.token,
    body: { spellId: fireball.id },
  });
  eq(r.status, 404, 'learn on unknown character → 404');
  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.outsider.token,
    body: { spellId: fireball.id },
  });
  eq(r.status, 403, 'learn by non-member → 403');
  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.player2.token,
    body: { spellId: fireball.id },
  });
  eq(r.status, 403, 'learn by member non-owner → 403');

  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.gm.token,
    body: { spellId: fireball.id, prepared: true },
  });
  eq(r.status, 201, 'learn fireball');
  eq(r.data.spell.prepared, true, 'learned prepared');
  const link = r.data.spell;

  // learn again → upsert toggles prepared
  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.gm.token,
    body: { spellId: fireball.id, prepared: false },
  });
  eq(r.status, 201, 're-learn upserts');
  eq(r.data.spell.prepared, false, 'prepared toggled');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spells WHERE character_id = ?', A).c,
    1,
    'single link row',
  );

  // ---------- regression: UPSERT must return the ORIGINAL link ----------
  // A different link inserted between learn and re-learn makes a naive
  // lastInsertRowid stale (it would point at the newer row) — the route
  // must re-query by (character_id, spell_id).
  const missile = srv.query("SELECT id FROM spells WHERE srd_index = 'magic-missile'");
  ok(missile, 'magic missile seeded');
  const regChar = await createCharacter(base, fx.gm.token, fx.partyId, {
    name: 'Bibliophile',
    characterClass: 'Magicien',
    level: 2,
    maxHp: 10,
  });
  r = await api(base, 'POST', `/api/characters/${regChar.id}/spells`, {
    token: fx.gm.token,
    body: { spellId: fireball.id, prepared: true },
  });
  eq(r.status, 201, 'regression: learn fireball');
  const regLinkId = r.data.spell.id;
  r = await api(base, 'POST', `/api/characters/${regChar.id}/spells`, {
    token: fx.gm.token,
    body: { spellId: missile.id },
  });
  eq(r.status, 201, 'regression: learn a second spell in between');
  r = await api(base, 'POST', `/api/characters/${regChar.id}/spells`, {
    token: fx.gm.token,
    body: { spellId: fireball.id, prepared: false },
  });
  eq(r.status, 201, 'regression: re-learn fireball (conflict path)');
  eq(r.data.spell.id, regLinkId, 'upsert returns the ORIGINAL link id');
  eq(r.data.spell.spell.id, fireball.id, 'upsert returns the requested spell');
  eq(r.data.spell.prepared, false, 'upsert toggles prepared');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spells WHERE character_id = ?', regChar.id).c,
    2,
    'upsert created no duplicate row',
  );

  r = await api(base, 'GET', `/api/characters/${A}/spells`, { token: fx.player.token });
  eq(r.status, 200, 'list character spells (party member)');
  eq(r.data.spells.length, 1, 'one known spell');
  ok(r.data.spells[0].spell.name, 'joined spell payload');
  // Régime connectivité : la liste est en RÉSUMÉ (prose à null — chargée par
  // GET /spells/:id à l'ouverture, SpellProse) + ETag (elle redescend à CHAQUE
  // lancé de sort via character:change — inchangée → 304).
  eq(r.data.spells[0].spell.description, null, 'learned list serves description:null');
  eq(r.data.spells[0].spell.higherLevel, null, 'learned list serves higherLevel:null');
  const spellsEtag = r.headers?.get('etag');
  ok(!!spellsEtag, 'learned spells list carries an ETag');
  if (spellsEtag) {
    const r304 = await api(base, 'GET', `/api/characters/${A}/spells`, {
      token: fx.player.token,
      headers: { 'If-None-Match': spellsEtag },
    });
    eq(r304.status, 304, 'learned spells list revalidates to 304');
  }
  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}/spells`, {
    token: fx.player.token,
  });
  eq(r.status, 404, 'hidden char spells → 404');
  r = await api(base, 'GET', '/api/characters/999999/spells', { token: fx.gm.token });
  eq(r.status, 404, 'spells 404');

  r = await api(base, 'PATCH', `/api/character-spells/${link.id}`, {
    token: fx.gm.token,
    body: {},
  });
  eq(r.status, 400, 'patch link no fields → 400');
  r = await api(base, 'PATCH', '/api/character-spells/999999', {
    token: fx.gm.token,
    body: { prepared: true },
  });
  eq(r.status, 404, 'patch link 404');
  r = await api(base, 'PATCH', `/api/character-spells/${link.id}`, {
    token: fx.player2.token,
    body: { prepared: true },
  });
  eq(r.status, 403, 'patch link non-owner → 403');
  r = await api(base, 'PATCH', `/api/character-spells/${link.id}`, {
    token: fx.gm.token,
    body: { prepared: true, sortOrder: 2 },
  });
  eq(r.status, 200, 'patch link');
  eq(r.data.spell.sortOrder, 2, 'sort order stored');

  r = await api(base, 'DELETE', `/api/character-spells/${link.id}`, { token: fx.player2.token });
  eq(r.status, 403, 'forget non-owner → 403');
  r = await api(base, 'DELETE', '/api/character-spells/999999', { token: fx.gm.token });
  eq(r.status, 404, 'forget 404');
  r = await api(base, 'DELETE', `/api/character-spells/${link.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'forget spell');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spells WHERE character_id = ?', A).c,
    0,
    'link removed',
  );

  // ---------- scalesAtHigherLevel (#171 — drapeau structuré) ----------
  // Les sorts à upcast purement textuel (Aide : prose higher_level, AUCUNE
  // table damage_json) doivent porter le drapeau dans le régime RÉSUMÉ où la
  // prose n'est pas servie — c'est le bug qui bloquait Aide au niveau natif.
  const aid = srv.query("SELECT id FROM spells WHERE srd_index = 'aid'");
  ok(aid, 'aid seeded');
  const shield = srv.query("SELECT id FROM spells WHERE srd_index = 'shield'");
  ok(shield, 'shield (no upcast) seeded');

  r = await api(base, 'GET', `/api/spells/${aid.id}`, { token: fx.gm.token });
  eq(r.data.spell.scalesAtHigherLevel, true, 'detail: Aide flag=true (prose seule)');
  r = await api(base, 'GET', `/api/spells/${shield.id}`, { token: fx.gm.token });
  eq(r.data.spell.scalesAtHigherLevel, false, 'detail: Bouclier flag=false (ni prose ni table)');

  for (const sp of [aid, shield]) {
    r = await api(base, 'POST', `/api/characters/${A}/spells`, {
      token: fx.gm.token,
      body: { spellId: sp.id },
    });
    eq(r.status, 201, `learn srd_index=${sp.srd_index} for flag check`);
  }
  r = await api(base, 'GET', `/api/characters/${A}/spells`, { token: fx.player.token });
  eq(r.status, 200, 'list for flag check');
  const listed = (r.data.spells as any[]).filter(
    (s: any) => s.spell.id === aid.id || s.spell.id === shield.id,
  );
  eq(listed.length, 2, 'both flag-check spells in the summary list');
  const aidRow = listed.find((s: any) => s.spell.id === aid.id);
  const shieldRow = listed.find((s: any) => s.spell.id === shield.id);
  ok(aidRow && shieldRow, 'rows resolved');
  eq(aidRow.spell.higherLevel, null, 'summary regime still serves higherLevel:null');
  eq(aidRow.spell.scalesAtHigherLevel, true, 'summary: Aide flag=true (upcast textuel)');
  eq(shieldRow.spell.scalesAtHigherLevel, false, 'summary: Bouclier flag=false (aucun upcast)');

  // ---------- domain spells (always prepared) ----------
  const clerc = await createCharacter(base, fx.gm.token, fx.partyId, {
    name: 'Sœur Foi',
    characterClass: 'Clerc',
    level: 3,
    maxHp: 18,
  });
  await api(base, 'PATCH', `/api/characters/${clerc.id}`, {
    token: fx.gm.token,
    body: { divineDomain: 'vie' },
  });

  r = await api(base, 'GET', `/api/characters/${clerc.id}/domain-spells`, { token: fx.gm.token });
  eq(r.status, 200, 'cleric domain spells');
  eq(r.data.domain, 'vie', 'domain echoed');
  ok(r.data.spells.length >= 2, 'domain spells resolved from the catalog');
  ok(r.data.spells[0].domainLevel >= 1, 'domain level attached');

  const druide = await createCharacter(base, fx.gm.token, fx.partyId, {
    name: 'Feuillage',
    characterClass: 'Druide',
    level: 3,
    maxHp: 16,
  });
  await api(base, 'PATCH', `/api/characters/${druide.id}`, {
    token: fx.gm.token,
    body: { druidCircle: 'terre', landCircle: 'forêt' },
  });
  r = await api(base, 'GET', `/api/characters/${druide.id}/domain-spells`, { token: fx.gm.token });
  eq(r.status, 200, 'druid land-circle bonus spells');

  r = await api(base, 'GET', `/api/characters/${clerc.id}/domain-spells`, {
    token: fx.player.token,
  });
  eq(r.status, 403, 'domain spells owner/GM only');
  r = await api(base, 'GET', '/api/characters/999999/domain-spells', { token: fx.gm.token });
  eq(r.status, 404, 'domain spells 404');

  // ---------- Sorts personnalisés (PR3 « Contenus personnalisés ») ----------
  // Caractère DÉDIÉ (les modules partagent une DB) : les liens posés ici ne
  // doivent toucher ni charAlya ni les autres fixtures.
  const serpentine = await createCharacter(base, fx.player.token, fx.partyId, {
    name: 'Sœur Serpentine',
    characterClass: 'Clerc',
    level: 5,
    maxHp: 38,
  });
  const GRACE = {
    name: 'Grâce de la Serpente',
    level: 2,
    school: 'evocation',
    castingTime: '1 action',
    rangeText: '18 mètres',
    duration: 'Concentration, jusqu’à 1 minute',
    components: ['V', 'S', 'M'],
    material: 'une écaille de serpent',
    concentration: true,
    ritual: false,
    classes: ['Clerc', 'Druide'],
    attackType: null,
    damageType: 'poison',
    damage: { dice: '3d6', perSlotLevel: '1d6' },
    heal: undefined,
    healAddsModifier: false,
    dc: { ability: 'con', success: 'half' },
    description: 'Un serpent d’ombre verte s’enroule autour de la cible.',
    higherLevel: null,
  };

  // MD seul : joueur et outsider refusés, même membre.
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/spells`, {
    token: fx.player.token,
    body: GRACE,
  });
  eq(r.status, 403, 'create custom spell as player → 403');
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/spells`, {
    token: fx.outsider.token,
    body: GRACE,
  });
  eq(r.status, 403, 'create custom spell as outsider → 403');

  // Validations : nom, niveau, école, classe, template, type requis, DD paire.
  for (const [label, body] of [
    ['nom requis', { ...GRACE, name: '' }],
    ['niveau invalide', { ...GRACE, level: 12 }],
    ['école invalide', { ...GRACE, school: 'magie' }],
    ['classe inconnue', { ...GRACE, classes: ['Sorcier'] }],
    ['template invalide', { ...GRACE, damage: { dice: '3d7' } }],
    ['type de dégâts requis', { ...GRACE, damageType: null }],
    ['DD incomplète', { ...GRACE, dc: { ability: 'con', success: null } }],
  ] as [string, Record<string, unknown>][]) {
    r = await api(base, 'POST', `/api/parties/${fx.partyId}/spells`, {
      token: fx.gm.token,
      body,
    });
    eq(r.status, 400, `custom spell 400 : ${label}`);
  }

  r = await api(base, 'POST', `/api/parties/${fx.partyId}/spells`, {
    token: fx.gm.token,
    body: GRACE,
  });
  eq(r.status, 201, 'GM creates custom spell');
  const grace = r.data.spell;
  ok(grace.srdIndex.startsWith(`custom-${fx.partyId}-`), 'srd_index synthétique custom-<party>-<hex>');
  ok(grace.source === 'custom', 'source custom servie');
  eq(grace.name, GRACE.name, 'nom FR servi');
  ok(graceDamageTable(grace), 'damage_at_slot_level développée (2→3d6, 3→4d6, … 9→10d6)');
  eq(
    grace.dcJson,
    JSON.stringify({ dc_type: { index: 'con', name: 'CON' }, dc_success: 'half' }),
    'dc_json au contrat SRD (affichée, jamais jetée)',
  );
  eq(grace.concentration, true, 'concentration servie');

  // Homonymie SRD permise + second srd_index synthétique distinct.
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/spells`, {
    token: fx.gm.token,
    body: { ...GRACE, name: 'Boule de feu', level: 3, damage: { dice: '8d6', perSlotLevel: '1d6' } },
  });
  eq(r.status, 201, 'homonymie SRD permise');
  const homonym = r.data.spell;
  ok(homonym.srdIndex !== grace.srdIndex, 'deux créations de même nom → index distincts');

  // « Toutes les classes » = liste explicite des 13 classes SRD.
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/spells`, {
    token: fx.gm.token,
    body: {
      ...GRACE,
      name: 'Don du pacte serpentin',
      classes: [
        'Artificier', 'Barbare', 'Barde', 'Clerc', 'Druide', 'Ensorceleur', 'Guerrier',
        'Magicien', 'Moine', 'Occultiste', 'Paladin', 'Rôdeur', 'Roublard',
      ],
    },
  });
  eq(r.status, 201, 'sort « toutes les classes » créé');
  eq(r.data.spell.classes.length, 13, '« toutes » = liste explicite des 13 classes');
  // Le filtre classe du grimoire le trouve pour un Guerrier comme pour un Clerc.
  r = await api(base, 'GET', '/api/spells?partyId=' + fx.partyId + '&class=Guerrier&search=Don%20du%20pacte', {
    token: fx.player.token,
  });
  ok(
    (r.data.spells as any[]).some((s) => s.name === 'Don du pacte serpentin'),
    'filtre classes_json attrape la liste explicite',
  );

  // ---------- Scoping & caches ----------
  r = await api(base, 'GET', `/api/spells?partyId=${fx.partyId}&search=Serpente`, {
    token: fx.player.token,
  });
  ok(
    (r.data.spells as any[]).some((s) => s.id === grace.id && s.source === 'custom'),
    'membre : le custom fusionne dans le catalogue scopé',
  );
  r = await api(base, 'GET', `/api/spells?partyId=${fx.partyId}&search=Serpente`, {
    token: fx.outsider.token,
  });
  eq(r.status, 403, 'catalogue scopé hors groupe → 403');
  r = await api(base, 'GET', '/api/spells?search=Serpente', { token: fx.gm.token });
  eq(r.data.total, 0, 'catalogue global (sans partyId) reste SRD pur');
  r = await api(base, 'GET', `/api/spells/${grace.id}`, { token: fx.outsider.token });
  eq(r.status, 403, 'détail custom hors groupe → 403');
  r = await api(base, 'GET', '/api/spells/light', { token: fx.gm.token });
  ok(
    !(r.data.spells as any[]).some((s) => s.name === GRACE.name),
    '/spells/light exclut les customs (SRD seul)',
  );
  // Q11a/position 4 : partyId ⇒ ETag seul (pas de max-age) ; SRD pur ⇒ fenêtre.
  const scoped = await api(base, 'GET', `/api/spells?partyId=${fx.partyId}&limit=1`, {
    token: fx.gm.token,
  });
  const cacheScoped = scoped.headers?.get('cache-control') ?? '';
  ok(!cacheScoped.includes('max-age'), 'scope groupe servi ETag seul (sans max-age)');
  const globalCat = await api(base, 'GET', '/api/spells?limit=1', { token: fx.gm.token });
  ok(
    (globalCat.headers?.get('cache-control') ?? '').includes('max-age=300'),
    'catalogue SRD pur garde max-age=300',
  );

  // Overlay EN : l’annexe (clé srdIndex) ne matche jamais un index synthétique
  // ⇒ repli champ par champ sur le FR (Q10a par construction).
  r = await api(base, 'GET', `/api/spells/${grace.id}?lang=en`, { token: fx.gm.token });
  eq(r.data.spell.name, GRACE.name, 'interface EN : contenu FR tel quel (repli)');

  // ---------- Apprentissage joueur (libre, filtré par classes déclarées) ----------
  r = await api(base, 'POST', `/api/characters/${serpentine.id}/spells`, {
    token: fx.player.token,
    body: { spellId: grace.id },
  });
  eq(r.status, 201, 'joueur apprend le custom de son groupe');
  eq(r.data.spell.spell.source, 'custom', 'badge source servi dans le JOIN');

  // Garde inter-groupes (position 8) : le custom d'une AUTRE table → 403.
  r = await api(base, 'POST', '/api/parties', {
    token: fx.outsider.token,
    body: { name: 'Table étrangère' },
  });
  const otherPartyId = r.data.party.id;
  r = await api(base, 'POST', `/api/parties/${otherPartyId}/spells`, {
    token: fx.outsider.token,
    body: { ...GRACE, name: 'Secret d’une autre table' },
  });
  eq(r.status, 201, 'outsider GM crée dans SON groupe');
  const foreignSpellId = r.data.spell.id;
  r = await api(base, 'POST', `/api/characters/${serpentine.id}/spells`, {
    token: fx.player.token,
    body: { spellId: foreignSpellId },
  });
  eq(r.status, 403, 'apprendre le custom d’un autre groupe → 403');

  // Liste du pupitre : customs only + méta « connu par N ».
  r = await api(base, 'GET', `/api/spells?partyId=${fx.partyId}&source=custom`, {
    token: fx.gm.token,
  });
  const customList = r.data.spells as any[];
  ok(customList.length >= 3, 'liste du pupitre : au moins les 3 customs du module');
  const graceRow = customList.find((s) => s.id === grace.id);
  eq(graceRow.knownBy, 1, 'méta « connu par 1 »');

  // ---------- Édition MD → propagation au JOIN (Q7a) ----------
  r = await api(base, 'PATCH', `/api/spells/${grace.id}`, {
    token: fx.gm.token,
    body: { damage: { dice: '4d6', perSlotLevel: '1d6' } },
  });
  eq(r.status, 200, 'PATCH MD : dés corrigés');
  eq(
    JSON.stringify(JSON.parse(r.data.spell.damageJson).damage_at_slot_level),
    JSON.stringify(graceSlotTable('4d6')),
    'table recalculée sur PATCH (contexte fusionné)',
  );
  r = await api(base, 'GET', `/api/characters/${serpentine.id}/spells`, { token: fx.player.token });
  const learned = (r.data.spells as any[]).find((s) => s.spell.id === grace.id);
  ok(
    learned.spell.damageJson.includes('"2":"4d6"'),
    'la fiche suit au refetch (JOIN, aucune copie figée)',
  );
  r = await api(base, 'PATCH', `/api/spells/${grace.id}`, { token: fx.outsider.token, body: { name: 'X' } });
  eq(r.status, 403, 'PATCH par un non-MD → 403');
  r = await api(base, 'PATCH', `/api/spells/${fireball.id}`, { token: fx.gm.token, body: { name: 'X' } });
  eq(r.status, 403, 'PATCH d’un sort SRD → 403');
  r = await api(base, 'PATCH', `/api/spells/${homonym.id}`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'PATCH vide → 400');

  // ---------- Suppression : 409 + porteurs, puis ?force=1 CASCADE ----------
  r = await api(base, 'DELETE', `/api/spells/${grace.id}`, { token: fx.gm.token });
  eq(r.status, 409, 'suppression refusée tant qu’appris');
  ok(
    (r.data.knownBy as any[]).some((c) => c.characterId === serpentine.id && c.className === 'Clerc'),
    '409 liste les porteurs (personnage + classe)',
  );
  r = await api(base, 'DELETE', `/api/spells/${grace.id}?force=1`, { token: fx.gm.token });
  eq(r.status, 204, '?force=1 cascade les liens');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spells WHERE spell_id = ?', grace.id).c,
    0,
    'CASCADE : le lien du personnage est retiré',
  );
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spells WHERE character_id = ?', serpentine.id).c,
    0,
    'la fiche de Sœur Serpentine ne connaît plus le sort',
  );
  // Un sort sans porteur se supprime en un seul DELETE.
  r = await api(base, 'DELETE', `/api/spells/${homonym.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'sort sans porteur : suppression directe');
}

/** Table d’upcast attendue pour dés natifs + 1d6 par cran (niveau 2 → 9). */
function graceSlotTable(nativeDice: string): Record<string, string> {
  const table: Record<string, string> = {};
  const n = parseInt(nativeDice, 10);
  for (let slot = 2; slot <= 9; slot++) table[String(slot)] = `${n + (slot - 2)}d6`;
  return table;
}

function graceDamageTable(spell: any): boolean {
  const d = JSON.parse(spell.damageJson);
  return (
    d.damage_type?.index === 'poison' &&
    d.damage_at_slot_level?.['2'] === '3d6' &&
    d.damage_at_slot_level?.['3'] === '4d6' &&
    d.damage_at_slot_level?.['9'] === '10d6'
  );
}
