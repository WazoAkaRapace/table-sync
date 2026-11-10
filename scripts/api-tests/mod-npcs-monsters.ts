/**
 * NPCs (shared/private visibility, secrets) + monster catalog.
 * Covers every .prepare site in routes/npcs.ts and routes/monsters.ts.
 */
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;

  // ---------- npcs ----------
  let r = await api(base, 'GET', `/api/parties/${P}/npcs`, { token: fx.gm.token });
  eq(r.status, 200, 'list npcs (empty)');

  r = await api(base, 'POST', `/api/parties/${P}/npcs`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'create npc no name → 400');
  r = await api(base, 'POST', `/api/parties/${P}/npcs`, {
    token: fx.outsider.token,
    body: { name: 'X' },
  });
  eq(r.status, 403, 'create npc non-member → 403');

  r = await api(base, 'POST', `/api/parties/${P}/npcs`, {
    token: fx.player.token,
    body: {
      name: 'Wakanga O’tamu',
      role: 'Guide',
      location: 'Port Nyanzaru',
      faction: 'Marchands',
      disposition: 'amical',
      secret: 'Espionne les héros',
    },
  });
  eq(r.status, 201, 'create shared npc');
  const sharedNpc = r.data.npc;
  eq(sharedNpc.isShared, true, 'shared by default');
  eq(sharedNpc.secret, null, "a player's POST never stores a secret");

  r = await api(base, 'POST', `/api/parties/${P}/npcs`, {
    token: fx.player.token,
    body: { name: 'Contact discret', isShared: false },
  });
  const privateNpc = r.data.npc;
  eq(privateNpc.isShared, false, 'private npc');

  // The GM writes the secret afterwards — the creator must never see it again
  r = await api(base, 'PATCH', `/api/npcs/${sharedNpc.id}`, {
    token: fx.gm.token,
    body: { secret: 'Espionne les héros' },
  });
  eq(r.status, 200, 'GM sets the secret');
  eq(r.data.npc.secret, 'Espionne les héros', 'GM sees the secret');

  // player sees shared + own private; GM sees all; secrets gated to the GM ALONE
  r = await api(base, 'GET', `/api/parties/${P}/npcs`, { token: fx.gm.token });
  eq(r.data.npcs.length, 2, 'GM sees all npcs');
  eq(
    r.data.npcs.find((n: any) => n.id === sharedNpc.id).secret,
    'Espionne les héros',
    'GM sees the secret',
  );
  r = await api(base, 'GET', `/api/parties/${P}/npcs`, { token: fx.player.token });
  eq(r.data.npcs.length, 2, 'player sees shared + own private');
  eq(
    r.data.npcs.find((n: any) => n.id === sharedNpc.id).secret,
    null,
    'the creator never sees the secret',
  );
  eq(r.data.npcs[0].secret, null, 'secret field present (null) for players');

  // ETag : la page PNJ se revalide en silence sur tout party:change —
  // revalidation à l'identique → 304 sans corps. (Cross-appelant : MD et
  // joueur ne partagent un ETag QUE si leurs corps sont identiques octets
  // pour octets — ne pas assert 200 cross-token ici, voir mod-combat.)
  const npcEtag = r.headers?.get('etag');
  ok(!!npcEtag, 'npc list carries an ETag');
  if (npcEtag) {
    const r304 = await api(base, 'GET', `/api/parties/${P}/npcs`, {
      token: fx.player.token,
      headers: { 'If-None-Match': npcEtag },
    });
    eq(r304.status, 304, 'npc list revalidates to 304 (same viewer, unchanged)');
  }

  // A player PATCH carrying a secret is ignored on that field, others apply
  r = await api(base, 'PATCH', `/api/npcs/${sharedNpc.id}`, {
    token: fx.player.token,
    body: { role: 'Guide royal', secret: 'tentative d’écriture' },
  });
  eq(r.status, 200, 'creator patches non-secret fields');
  eq(r.data.npc.secret, null, 'player PATCH response carries no secret');
  eq(r.data.npc.role, 'Guide royal', 'other fields applied');
  r = await api(base, 'GET', `/api/parties/${P}/npcs`, { token: fx.gm.token });
  eq(
    r.data.npcs.find((n: any) => n.id === sharedNpc.id).secret,
    'Espionne les héros',
    "player's secret write ignored",
  );

  // another member (player2 is not a member anymore → rejoin for this check)
  await api(base, 'POST', '/api/parties/join', {
    token: fx.player2.token,
    body: { inviteCode: fx.inviteCode },
  });
  r = await api(base, 'GET', `/api/parties/${P}/npcs`, { token: fx.player2.token });
  eq(r.data.npcs.length, 1, 'other player sees only shared');
  eq(r.data.npcs[0].secret, null, "other player doesn't see the secret");

  r = await api(base, 'PATCH', `/api/npcs/${sharedNpc.id}`, {
    token: fx.player2.token,
    body: { name: 'X' },
  });
  eq(r.status, 403, 'patch npc by non-creator → 403');
  r = await api(base, 'PATCH', '/api/npcs/999999', { token: fx.gm.token, body: { name: 'X' } });
  eq(r.status, 404, 'patch npc 404');
  r = await api(base, 'PATCH', `/api/npcs/${sharedNpc.id}`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'patch npc no fields → 400');
  r = await api(base, 'PATCH', `/api/npcs/${sharedNpc.id}`, {
    token: fx.gm.token,
    body: { name: 'Wakanga', role: 'Mage', status: 'mort', isShared: false },
  });
  eq(r.status, 200, 'GM patches npc');
  eq(r.data.npc.status, 'mort', 'status updated');

  r = await api(base, 'DELETE', `/api/npcs/${sharedNpc.id}`, { token: fx.player2.token });
  eq(r.status, 403, 'delete npc non-creator → 403');
  r = await api(base, 'DELETE', '/api/npcs/999999', { token: fx.gm.token });
  eq(r.status, 404, 'delete npc 404');
  r = await api(base, 'DELETE', `/api/npcs/${privateNpc.id}`, { token: fx.player.token });
  eq(r.status, 204, 'creator deletes private npc');

  // ---------- npcs: édition par le groupe (allowMemberEdit) ----------
  // player2 est (re)membre du groupe depuis le bloc ci-dessus
  r = await api(base, 'POST', `/api/parties/${P}/npcs`, {
    token: fx.player.token,
    body: { name: 'Registre du comptoir', isShared: true, allowMemberEdit: true },
  });
  eq(r.status, 201, 'create shared + member-edit npc');
  const memberEditNpc = r.data.npc;
  eq(memberEditNpc.isShared, true, 'shared at creation');
  eq(memberEditNpc.allowMemberEdit, true, 'allowMemberEdit at creation');

  r = await api(base, 'POST', `/api/parties/${P}/npcs`, {
    token: fx.player.token,
    body: { name: 'Carnet intime', isShared: false, allowMemberEdit: true },
  });
  eq(r.status, 201, 'create private npc with grant attempted');
  eq(r.data.npc.allowMemberEdit, false, 'a private npc never carries the grant');

  // Le membre édite le contenu — le cœur de la demande
  r = await api(base, 'PATCH', `/api/npcs/${memberEditNpc.id}`, {
    token: fx.player2.token,
    body: { description: 'Prix mis à jour', secret: 'vol' },
  });
  eq(r.status, 200, 'member edits content when allowed');
  eq(r.data.npc.description, 'Prix mis à jour', 'member content edit applied');
  eq(r.data.npc.secret, null, "member's secret write still ignored");

  // Les drapeaux restent au créateur : portés par un membre, ils sont ignorés
  r = await api(base, 'PATCH', `/api/npcs/${memberEditNpc.id}`, {
    token: fx.player2.token,
    body: { role: 'Comptable', isShared: false, allowMemberEdit: false },
  });
  eq(r.status, 200, 'member patch with flags accepted');
  eq(r.data.npc.role, 'Comptable', 'content field applied');
  eq(r.data.npc.isShared, true, 'member cannot un-share');
  eq(r.data.npc.allowMemberEdit, true, 'member cannot revoke group edit');

  r = await api(base, 'DELETE', `/api/npcs/${memberEditNpc.id}`, { token: fx.player2.token });
  eq(r.status, 403, 'member cannot delete even with group edit');

  // Le créateur reprend la main : retrait du drapeau → le membre est verrouillé
  r = await api(base, 'PATCH', `/api/npcs/${memberEditNpc.id}`, {
    token: fx.player.token,
    body: { allowMemberEdit: false },
  });
  eq(r.status, 200, 'owner revokes group edit');
  eq(r.data.npc.allowMemberEdit, false, 'grant revoked');
  r = await api(base, 'PATCH', `/api/npcs/${memberEditNpc.id}`, {
    token: fx.player2.token,
    body: { description: 'X' },
  });
  eq(r.status, 403, 'member locked out after revoke');

  // Re-grant puis dé-partage : le drapeau tombe dans la même écriture
  await api(base, 'PATCH', `/api/npcs/${memberEditNpc.id}`, {
    token: fx.player.token,
    body: { allowMemberEdit: true },
  });
  r = await api(base, 'PATCH', `/api/npcs/${memberEditNpc.id}`, {
    token: fx.player.token,
    body: { isShared: false, allowMemberEdit: true },
  });
  eq(r.status, 200, 'owner un-shares');
  eq(r.data.npc.isShared, false, 'un-shared');
  eq(r.data.npc.allowMemberEdit, false, 'group edit drops with sharing');
  r = await api(base, 'PATCH', `/api/npcs/${memberEditNpc.id}`, {
    token: fx.player2.token,
    body: { description: 'X' },
  });
  eq(r.status, 403, 'member locked out once the npc is private');

  // ---------- monsters ----------
  const goblin =
    srv.query("SELECT slug FROM monsters WHERE name_fr LIKE '%obelin%' LIMIT 1") ??
    srv.query('SELECT slug FROM monsters LIMIT 1');
  r = await api(base, 'GET', '/api/monsters', { token: fx.gm.token });
  eq(r.status, 200, 'monster search (no query)');
  ok(r.data.monsters.length > 0, 'monsters returned');

  r = await api(base, 'GET', `/api/monsters?search=${encodeURIComponent('gobelin')}`, {
    token: fx.gm.token,
  });

  // Colonne search_text précalculée : insensible aux accents, couvre le nom
  // FR ET le texte de l'overlay EN (l'ancienne forme UDF couvrait pareil).
  ok(r.data.monsters.length > 0, "monsters search 'gobelin' matches via search_text");
  r = await api(base, 'GET', `/api/monsters?search=${encodeURIComponent('GOBELIN')}`, {
    token: fx.gm.token,
  });
  ok(r.data.monsters.length > 0, 'monster search is case-insensitive');
  ok(r.data.monsters.length > 0, "accent-insensitive 'gobelin' search");

  r = await api(base, 'GET', `/api/monsters?search=${encodeURIComponent('humanoïde')}`, {
    token: fx.gm.token,
  });
  ok(r.data.monsters.length > 0, 'type search');

  // Pertinence : « mage » est une sous-chaîne de « damage » dans l'overlay
  // EN (957 monstres matchaient) — les monstres NOMMÉS « mage » doivent
  // sortir en tête, pas être noyés sous les CR 0.
  r = await api(base, 'GET', `/api/monsters?search=${encodeURIComponent('mage')}`, {
    token: fx.gm.token,
  });
  ok(r.data.monsters.length > 0, "monsters search 'mage' matches");
  const names = (r.data.monsters as Array<{ name: string }>).map((m) => m.name);
  ok(
    names.slice(0, 6).some((n) => n === 'Mage' || n.startsWith('Drow, mage')),
    `'mage' : le Mage arrive en tête (reçu: ${names.slice(0, 3).join(', ')})`,
  );
  // « mort » : le TYPE « Mort-vivant » matche des centaines de monstres —
  // les NOMS portant « mort » (Avatar de la mort) doivent rester en tête.
  r = await api(base, 'GET', `/api/monsters?search=${encodeURIComponent('mort')}&limit=30`, {
    token: fx.gm.token,
  });
  const mortNames = (r.data.monsters as Array<{ name: string }>).map((m) => m.name);
  ok(
    mortNames
      .slice(0, 10)
      .some((n) => n.toLowerCase().includes('mort') && !n.toLowerCase().includes('mort-vivant')),
    `'mort' : un monstre NOMMÉ mort arrive en tête (reçu: ${mortNames.slice(0, 5).join(', ')})`,
  );

  r = await api(base, 'GET', `/api/monsters/${goblin.slug}`, { token: fx.gm.token });
  eq(r.status, 200, 'monster detail');
  ok(r.data.monster.abilities?.dex, 'abilities parsed');
  r = await api(base, 'GET', '/api/monsters/pas-un-monstre', { token: fx.gm.token });
  eq(r.status, 404, 'monster 404');

  // ---------- overlay EN : dés et bonus détectés malgré le texte anglais ----------
  r = await api(base, 'GET', `/api/monsters/${goblin.slug}?lang=en`, { token: fx.gm.token });
  eq(r.status, 200, 'monster detail EN');
  const scimitar = (r.data.monster.actions as Array<Record<string, unknown>>).find((a) =>
    /scimitar/i.test(String(a.name)),
  );
  ok(scimitar != null, 'EN overlay actions served');
  eq(scimitar?.attackBonus, 4, 'EN attack bonus parsed (mw N to hit)');
  eq(scimitar?.damageDice, '1d6+2', 'EN damage dice parsed + compactés');
  eq(scimitar?.damageType, 'slashing', 'EN damage type');
  ok(
    !(r.data.monster.actions as Array<Record<string, unknown>>).some((a) =>
      String(a.desc ?? '').includes('{@'),
    ),
    'descriptions EN nettoyées (plus de balises 5e.tools)',
  );

  // ---------- monstres personnalisés (PR2 « Contenus personnalisés ») ----------
  const ZALKIR = {
    nameFr: 'Zalkir, prêtre-serpent',
    type: 'Humanoïde',
    size: 'M',
    alignment: 'loyal mauvais',
    armorClass: 15,
    armorDesc: 'armure d’écailles',
    hitPoints: 65,
    hitDice: '10d8+20',
    speed: { walk: 9, swim: 6 },
    abilities: { for: 13, dex: 14, con: 14, int: 11, sag: 16, cha: 16 },
    challengeRating: 3,
    traits: [{ name: 'Volonté du serpent', text: 'Avantage aux sauvegardes contre la peur.' }],
    actions: [
      {
        name: 'Cimeterre',
        text: 'Attaque au corps à corps : +4 pour toucher, 5 (1d6+2) dégâts tranchants.',
      },
    ],
    damageResistances: ['poison'],
    conditionImmunities: ['Empoisonné'],
    senses: 'perception passive 13',
    languages: 'commun, aberrant',
  };

  // Création MD seule — le joueur (même toggle objets ouvert) prend 403.
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.player.token,
    body: ZALKIR,
  });
  eq(r.status, 403, 'create custom monster as player → 403');
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.outsider.token,
    body: ZALKIR,
  });
  eq(r.status, 403, 'create custom monster as outsider → 403');

  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.gm.token,
    body: ZALKIR,
  });
  eq(r.status, 201, 'GM creates custom monster');
  const zalkir = r.data.monster;
  ok(zalkir.slug.startsWith('custom-zalkir'), `slug serveur préfixé (reçu: ${zalkir.slug})`);
  eq(zalkir.origin, 'custom', 'origin badge served');
  eq(zalkir.xp, 700, 'XP dérivés du FP 3 (SRD)');
  eq(zalkir.languages.join(','), 'commun,aberrant', 'langues servies en liste');
  eq(zalkir.actions[0].attackBonus, 4, 'bonus d’attaque parsé au mieux');
  eq(zalkir.actions[0].damageDice, '1d6+2', 'dés parsés au mieux');
  // Colonnes précalculées remplies à l'insertion (recherche nom-d'abord).
  eq(
    srv.query('SELECT name_search FROM monsters WHERE slug = ?', zalkir.slug).name_search,
    'zalkir, pretre-serpent',
    'name_search calculé à l’insertion (accent-free)',
  );

  // Validations du noyau : chaque borne rend son message métier FR.
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'create without name → 400');
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.gm.token,
    body: { ...ZALKIR, hitDice: '10d8++20' },
  });
  eq(r.status, 400, 'hit dice formula invalide → 400');
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.gm.token,
    body: { ...ZALKIR, abilities: { ...ZALKIR.abilities, dex: 99 } },
  });
  eq(r.status, 400, 'ability hors bornes → 400');
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.gm.token,
    body: { ...ZALKIR, challengeRating: 3.5 },
  });
  eq(r.status, 400, 'CR hors table SRD → 400');
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.gm.token,
    body: { ...ZALKIR, type: 'Pokémon' },
  });
  eq(r.status, 400, 'type non-SRD → 400');
  // Corps non objet : le schéma TypeBox rejette, message FR mappé.
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.gm.token,
    body: [] as unknown as Record<string, unknown>,
  });
  eq(r.status, 400, 'body non objet → 400 (schéma TypeBox)');
  eq(r.data.error, 'nom du monstre requis', 'message FR mappé (validationMessage)');

  // Deux monstres de même nom : slugs distincts (suffixe aléatoire).
  r = await api(base, 'POST', `/api/parties/${P}/monsters`, {
    token: fx.gm.token,
    body: { ...ZALKIR, nameFr: 'Zalkir, prêtre-serpent' },
  });
  eq(r.status, 201, 'homonyme SRD/custom permis');
  ok(r.data.monster.slug !== zalkir.slug, 'slug unique par suffixe');
  const zalkir2 = r.data.monster;

  // Scoping de lecture : le catalogue du groupe mêle SRD + customs ; le
  // catalogue global reste SRD pur ; l'extérieur ne voit pas les customs.
  r = await api(base, 'GET', `/api/monsters?partyId=${P}&search=zalkir`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'member searches scoped catalog');
  ok(
    (r.data.monsters as any[]).some((m) => m.slug === zalkir.slug),
    'custom found via search_text (accents insensibles)',
  );
  ok(
    (r.data.monsters as any[]).some((m) => m.slug === zalkir.slug && m.origin === 'custom'),
    'summary du custom porte le badge origin',
  );
  r = await api(base, 'GET', `/api/monsters?search=zalkir`, { token: fx.gm.token });
  eq((r.data.monsters as any[]).length, 0, 'catalogue global : le custom ne fuit pas (SRD pur)');
  r = await api(base, 'GET', `/api/monsters?partyId=${P}&search=zalkir`, {
    token: fx.outsider.token,
  });
  eq(r.status, 403, 'scoped catalog non-membre → 403');
  r = await api(base, 'GET', `/api/monsters/${zalkir.slug}`, { token: fx.outsider.token });
  eq(r.status, 403, 'custom detail non-membre → 403');
  r = await api(base, 'GET', `/api/monsters/${zalkir.slug}`, { token: fx.player.token });
  eq(r.status, 200, 'custom detail member → 200');

  // Liste du pupitre : origin=custom + méta rencontres.
  r = await api(base, 'GET', `/api/monsters?partyId=${P}&origin=custom&limit=100`, {
    token: fx.gm.token,
  });
  eq(r.data.monsters.length, 2, 'pupitre liste les customs du groupe');
  eq(r.data.monsters[0].encounterCount, 0, 'méta rencontres à zéro avant usage');

  // Édition : PATCH re-valide fusionné, garde le slug, recalcul search_text.
  r = await api(base, 'PATCH', `/api/monsters/${zalkir.slug}`, {
    token: fx.outsider.token,
    body: { hitPoints: 70 },
  });
  eq(r.status, 403, 'patch custom monster outsider → 403');
  r = await api(base, 'PATCH', `/api/monsters/${goblin.slug}`, {
    token: fx.gm.token,
    body: { hitPoints: 70 },
  });
  eq(r.status, 403, 'patch un monstre SRD → 403');
  r = await api(base, 'PATCH', `/api/monsters/${zalkir.slug}`, {
    token: fx.gm.token,
    body: { hitPoints: 70, nameFr: 'Zalkir, hiérophante du serpent' },
  });
  eq(r.status, 200, 'GM patches custom monster');
  eq(r.data.monster.hitPoints, 70, 'hit points updated');
  eq(r.data.monster.hitDice, '10d8+20', 'champ absent conservé (contexte fusionné)');
  eq(r.data.monster.actions[0].name, 'Cimeterre', 'traits/actions conservés au PATCH');
  r = await api(base, 'GET', `/api/monsters?partyId=${P}&search=hierophante`, {
    token: fx.gm.token,
  });
  ok(
    (r.data.monsters as any[]).some((m) => m.slug === zalkir.slug),
    'search_text recalculé au renommage (sans accent)',
  );

  // Ajout en rencontre ×3 : PV roulés, groupe — un custom y est un SRD.
  r = await api(base, 'POST', `/api/parties/${P}/encounters`, {
    token: fx.gm.token,
    body: { name: 'Sanctuaire du serpent' },
  });
  eq(r.status, 201, 'encounter created');
  const encId = r.data.encounter.id;
  r = await api(base, 'POST', `/api/encounters/${encId}/combatants/monster`, {
    token: fx.gm.token,
    body: { monsterSlug: zalkir.slug, count: 3, nameHidden: true },
  });
  eq(r.status, 201, 'custom monster added ×3');
  const group = (r.data.combatants as any[])[0].groupId;
  ok(
    (r.data.combatants as any[]).every((c) => c.groupId === group),
    'groupe partagé',
  );
  ok(
    (r.data.combatants as any[]).every((c) => c.armorClass === 15),
    'CA snapshot copiée',
  );
  r = await api(base, 'GET', `/api/monsters?partyId=${P}&origin=custom`, { token: fx.gm.token });
  eq(
    r.data.monsters.find((m: any) => m.slug === zalkir.slug).encounterCount,
    1,
    'méta « dans 1 rencontre » après ajout',
  );

  // Garde de périmètre : le custom d'une AUTRE table n'entre pas.
  r = await api(base, 'POST', '/api/parties', {
    token: fx.outsider.token,
    body: { name: 'Autre table' },
  });
  eq(r.status, 201, 'second party created');
  const otherPartyId = r.data.party.id;
  r = await api(base, 'POST', `/api/parties/${otherPartyId}/monsters`, {
    token: fx.outsider.token,
    body: { ...ZALKIR, nameFr: 'Gardien d’une autre table' },
  });
  eq(r.status, 201, 'outsider GM creates custom in own party');
  const foreign = r.data.monster;
  r = await api(base, 'POST', `/api/encounters/${encId}/combatants/monster`, {
    token: fx.gm.token,
    body: { monsterSlug: foreign.slug, count: 1 },
  });
  eq(r.status, 404, 'custom d’un autre groupe → 404 à l’ajout');

  // Suppression : bloquée 409 tant qu'une rencontre setup/active référence
  // le slug (liste des rencontres servie), permise après `ended`.
  r = await api(base, 'DELETE', `/api/monsters/${zalkir.slug}`, { token: fx.gm.token });
  eq(r.status, 409, 'delete blocked while referenced');
  ok(
    (r.data.encounters as any[]).some((e) => e.id === encId && e.status === 'setup'),
    '409 liste les rencontres vivantes',
  );
  r = await api(base, 'PATCH', `/api/encounters/${encId}`, {
    token: fx.gm.token,
    body: { status: 'ended' },
  });
  ok(r.status === 200 || r.status === 204, 'encounter ended');
  r = await api(base, 'DELETE', `/api/monsters/${zalkir.slug}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete allowed once encounters ended');
  // Le combatant snapshot survit (historique dégradé assumé, Q6a).
  eq(
    srv.query('SELECT COUNT(*) as c FROM combatants WHERE monster_slug = ?', zalkir.slug).c,
    3,
    'combatants snapshots survivants',
  );
  // Nettoyage : l'autre table et ses restes disparaissent (le second zalkir
  // sert à la spec WS plus loin — il reste, lui).
  await api(base, 'DELETE', `/api/monsters/${foreign.slug}`, { token: fx.outsider.token });
  await api(base, 'DELETE', `/api/encounters/${encId}`, { token: fx.gm.token });
  ok(zalkir2.slug.startsWith('custom-'), 'second custom kept for the sync module');
}
