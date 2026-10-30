/**
 * Correctifs audit combat 2026-10-30 (audit/plans/PLAN-api.md) :
 *  1. Fuite du monsterSlug des monstres masqués en vue non-GM (GET /encounters/:id).
 *  2. Wild shape à 0 PV : le PJ reverti reste MOURANT (defeated=0), pas vaincu (#148)
 *     — 4 sites (traqueur, fiche, revert manuel, branche temp-HP).
 *  3. Repos court sans soin ne marque plus un PJ à 0 PV comme vaincu (#148).
 *  4. Le miroir PV du repos préserve la barre de forme sauvage du traqueur.
 *  5. next-turn sur une rencontre terminée → 400 (setup reste accepté : démarrage).
 *  6. PATCH /encounters/:id valide status / round / turnIndex → 400 propre (plus de 500).
 */

import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;
  const GM = fx.gm.token;
  const PLAYER = fx.player.token;
  let r: any;

  const goblin =
    srv.query(
      "SELECT slug FROM monsters WHERE name_fr LIKE '%obelin%' AND hit_dice IS NOT NULL LIMIT 1",
    ) ?? srv.query('SELECT slug FROM monsters WHERE hit_dice IS NOT NULL LIMIT 1');
  const wolf =
    srv.query(
      "SELECT slug FROM monsters WHERE name_fr LIKE '%oup%' AND hit_dice IS NOT NULL AND slug != ? LIMIT 1",
      goblin.slug,
    ) ??
    srv.query(
      'SELECT slug FROM monsters WHERE hit_dice IS NOT NULL AND slug != ? LIMIT 1',
      goblin.slug,
    );

  // ===== 1. Fuite monsterSlug en vue non-GM =====
  const encMask = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: GM,
      body: { name: 'Mystère audit' },
    })
  ).data.encounter;
  r = await api(base, 'POST', `/api/encounters/${encMask.id}/combatants/monster`, {
    token: GM,
    body: { monsterSlug: goblin.slug, count: 2, name: 'Ombre encapuchonnée', nameHidden: true },
  });
  eq(r.status, 201, '1 : groupe masqué créé');
  const masked1 = r.data.combatants[0];
  r = await api(base, 'POST', `/api/encounters/${encMask.id}/combatants/monster`, {
    token: GM,
    body: { monsterSlug: wolf.slug, count: 1 },
  });
  const openMon = r.data.combatants[0];
  await api(base, 'POST', `/api/encounters/${encMask.id}/combatants/player`, {
    token: GM,
    body: { characterId: fx.charBran.id },
  });

  // Vue joueur : nom masqué ET slug redacted
  r = await api(base, 'GET', `/api/encounters/${encMask.id}`, { token: PLAYER });
  const pMasked = r.data.encounter.combatants.find((c: any) => c.id === masked1.id);
  eq(pMasked.name, 'Créature inconnue', '1 : joueur lit le nom masqué');
  eq(pMasked.monsterSlug, null, '1 : le slug du monstre masqué est redacted aussi');
  ok(
    !JSON.stringify(r.data.encounter.combatants).includes(goblin.slug),
    '1 : le slug du gobelin n’apparaît nulle part dans le payload joueur',
  );
  ok(
    !JSON.stringify(r.data.encounter.combatants).includes('Ombre'),
    '1 : le vrai nom n’apparaît pas dans le payload joueur',
  );
  const pOpen = r.data.encounter.combatants.find((c: any) => c.id === openMon.id);
  eq(pOpen.monsterSlug, wolf.slug, '1 : monstre non masqué, slug conservé pour le joueur');

  // Vue GM : nom réel + slug conservés
  r = await api(base, 'GET', `/api/encounters/${encMask.id}`, { token: GM });
  const gMasked = r.data.encounter.combatants.find((c: any) => c.id === masked1.id);
  eq(gMasked.name, 'Ombre encapuchonnée', '1 : le GM lit le vrai nom');
  eq(gMasked.monsterSlug, goblin.slug, '1 : le GM garde le slug');

  // Liste des rencontres (roster) : aucune trace de monsterSlug
  r = await api(base, 'GET', `/api/parties/${P}/encounters`, { token: PLAYER });
  const maskSummary = r.data.encounters.find((e: any) => e.id === encMask.id);
  const maskEntry = maskSummary.roster.find((x: any) => x.name === 'Créature inconnue');
  ok(maskEntry && maskEntry.count === 2, '1 : le roster masque le groupe');
  eq(
    Object.keys(maskEntry).sort().join(','),
    'count,name,player',
    '1 : les entrées roster n’ont pas de champ monsterSlug',
  );

  // Révélation → le joueur revoit le slug
  r = await api(base, 'PATCH', `/api/combatants/${masked1.id}`, {
    token: GM,
    body: { nameHidden: false },
  });
  eq(r.status, 200, '1 : révélation par le MD');
  r = await api(base, 'GET', `/api/encounters/${encMask.id}`, { token: PLAYER });
  eq(
    r.data.encounter.combatants.find((c: any) => c.id === masked1.id).monsterSlug,
    goblin.slug,
    '1 : après révélation le joueur revoit le slug',
  );
  await api(base, 'DELETE', `/api/encounters/${encMask.id}`, { token: GM });

  // ===== 2. Wild shape à 0 PV → mourant, pas vaincu (#148) =====
  const druid = await createCharacter(base, GM, P, {
    name: 'Auditforme',
    characterClass: 'Druide',
    level: 2,
    dexterity: 14,
    maxHp: 17,
  });
  await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { druidCircle: 'lune' },
  });
  const beasts = srv.queryAll(
    "SELECT slug FROM monsters WHERE type = 'Bête' AND challenge_rating <= 1 AND hit_points >= 8 AND speed_json NOT LIKE '%fly%' AND speed_json NOT LIKE '%swim%' ORDER BY challenge_rating DESC, slug LIMIT 1",
  );
  ok(beasts.length === 1, '2 : une bête éligible disponible');
  await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { wildShapeSeen: [beasts[0].slug] },
  });
  // PV normaux à 1 : l’excès de dégâts retombe à coup sûr à 0
  await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { currentHp: 1 },
  });
  const encW = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: GM,
      body: { name: 'Forme audit' },
    })
  ).data.encounter;
  r = await api(base, 'POST', `/api/encounters/${encW.id}/combatants/player`, {
    token: GM,
    body: { characterId: druid.id },
  });
  const combW = r.data.combatants[0];

  // 2a — traqueur : la barre de forme tombe sous 0 → auto-revert, PJ mourant
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, '2a : transformation');
  const shapeHp = srv.query('SELECT wild_shape_hp AS h FROM characters WHERE id = ?', druid.id).h;
  ok(shapeHp > 0, '2a : barre de forme posée');
  r = await api(base, 'PATCH', `/api/combatants/${combW.id}`, {
    token: GM,
    body: { hitPoints: -(shapeHp + 5) },
  });
  eq(r.status, 200, '2a : PATCH traqueur sous 0');
  eq(r.data.combatant.defeated, false, '2a : PJ à 0 PV = mourant, pas vaincu');
  let row = srv.query('SELECT defeated, hit_points FROM combatants WHERE id = ?', combW.id);
  eq(row.defeated, 0, '2a : defeated=0 en DB');
  eq(
    row.hit_points,
    Math.max(0, 1 - (shapeHp + 5)),
    '2a : hit_points = max(0, current_hp − excès)',
  );
  eq(
    srv.query('SELECT wild_shape_slug AS s FROM characters WHERE id = ?', druid.id).s,
    null,
    '2a : forme annulée sur la fiche',
  );

  // 2b — fiche : currentHp négatif en forme → auto-revert, PJ mourant
  await api(base, 'POST', `/api/characters/${druid.id}/rest`, {
    token: GM,
    body: { type: 'short' },
  });
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, '2b : re-transformation');
  const shapeHp2 = srv.query('SELECT wild_shape_hp AS h FROM characters WHERE id = ?', druid.id).h;
  r = await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { currentHp: -(shapeHp2 + 3) },
  });
  eq(r.status, 200, '2b : PATCH fiche en forme');
  row = srv.query('SELECT defeated, hit_points FROM combatants WHERE id = ?', combW.id);
  eq(row.defeated, 0, '2b : defeated=0 en DB');
  eq(row.hit_points, Math.max(0, 0 - (shapeHp2 + 3)), '2b : hit_points = newHp');

  // 2c — revert manuel avec excès : PJ mourant
  await api(base, 'POST', `/api/characters/${druid.id}/rest`, {
    token: GM,
    body: { type: 'short' },
  });
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, '2c : re-transformation');
  r = await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { wildShapeHp: -4 },
  });
  eq(r.status, 200, '2c : wildShapeHp négatif posé');
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape/revert`, { token: GM });
  eq(r.status, 200, '2c : revert manuel');
  eq(r.data.hp, 0, '2c : hp = max(0, current_hp − 4)');
  eq(r.data.excessDamage, 4, '2c : excès de 4 remonté');
  row = srv.query('SELECT defeated, hit_points FROM combatants WHERE id = ?', combW.id);
  eq(row.defeated, 0, '2c : defeated=0 en DB');
  eq(row.hit_points, 0, '2c : hit_points = 0');

  // 2d — branche temp-HP (PJ non transformé) : absorption, PJ non vaincu
  r = await api(base, 'POST', `/api/encounters/${encW.id}/combatants/player`, {
    token: GM,
    body: { characterId: fx.charBran.id },
  });
  const combB = r.data.combatants.find((c: any) => c.characterId === fx.charBran.id);
  await api(base, 'PATCH', `/api/characters/${fx.charBran.id}`, {
    token: PLAYER,
    body: { tempHp: 5, currentHp: 10 },
  });
  r = await api(base, 'PATCH', `/api/combatants/${combB.id}`, {
    token: GM,
    body: { hitPoints: 0 },
  });
  eq(r.status, 200, '2d : PATCH traqueur à 0 avec PV temporaires');
  row = srv.query('SELECT hit_points, defeated FROM combatants WHERE id = ?', combB.id);
  eq(row.hit_points, 5, '2d : la temp absorbe, hit_points=5');
  eq(row.defeated, 0, '2d : defeated=0');
  row = srv.query('SELECT current_hp, temp_hp FROM characters WHERE id = ?', fx.charBran.id);
  eq(row.current_hp, 5, '2d : fiche current_hp=5');
  eq(row.temp_hp, 0, '2d : fiche temp_hp=0');

  // ===== 3. Repos court sans soin : un PJ à 0 PV reste mourant =====
  r = await api(base, 'PATCH', `/api/combatants/${combB.id}`, {
    token: GM,
    body: { hitPoints: 0 },
  });
  eq(r.status, 200, '3 : PJ mis à 0 PV');
  row = srv.query('SELECT defeated, hit_points FROM combatants WHERE id = ?', combB.id);
  eq(row.defeated, 0, '3 : à 0 PV le PJ est mourant (#148)');
  r = await api(base, 'POST', `/api/characters/${fx.charBran.id}/rest`, {
    token: PLAYER,
    body: { type: 'short' },
  });
  eq(r.status, 200, '3 : repos court sans soin');
  row = srv.query('SELECT defeated, hit_points FROM combatants WHERE id = ?', combB.id);
  eq(row.defeated, 0, '3 : le repos court ne marque pas le PJ vaincu');
  eq(row.hit_points, 0, '3 : hit_points reste 0');
  eq(
    srv.query('SELECT current_hp AS h FROM characters WHERE id = ?', fx.charBran.id).h,
    0,
    '3 : fiche current_hp=0',
  );
  r = await api(base, 'POST', `/api/characters/${fx.charBran.id}/rest`, {
    token: PLAYER,
    body: { type: 'long' },
  });
  eq(r.status, 200, '3 : repos long ensuite');
  row = srv.query('SELECT defeated, hit_points FROM combatants WHERE id = ?', combB.id);
  eq(row.hit_points, 12, '3 : repos long → PV max');
  eq(row.defeated, 0, '3 : repos long → non vaincu');

  // ===== 4. Le miroir PV du repos préserve la barre de forme sauvage =====
  await api(base, 'POST', `/api/characters/${druid.id}/rest`, {
    token: GM,
    body: { type: 'short' },
  });
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, '4 : transformation');
  const shapeHp4 = srv.query('SELECT wild_shape_hp AS h FROM characters WHERE id = ?', druid.id).h;
  eq(
    srv.query('SELECT hit_points AS h FROM combatants WHERE id = ?', combW.id).h,
    shapeHp4,
    '4 : le traqueur affiche la barre de forme',
  );
  r = await api(base, 'POST', `/api/characters/${druid.id}/rest`, {
    token: GM,
    body: { type: 'short', healedHp: 3 },
  });
  eq(r.status, 200, '4 : repos court avec soin');
  eq(
    srv.query('SELECT hit_points AS h FROM combatants WHERE id = ?', combW.id).h,
    shapeHp4,
    '4 : le miroir du repos n’écrase pas la barre de forme',
  );
  r = await api(base, 'POST', `/api/characters/${druid.id}/rest`, {
    token: GM,
    body: { type: 'long' },
  });
  eq(r.status, 200, '4 : repos long');
  eq(
    srv.query('SELECT wild_shape_slug AS s FROM characters WHERE id = ?', druid.id).s,
    null,
    '4 : le repos long annule la forme',
  );
  eq(
    srv.query('SELECT hit_points AS h FROM combatants WHERE id = ?', combW.id).h,
    17,
    '4 : repos long → le traqueur retombe sur currentHp (PV max)',
  );
  await api(base, 'DELETE', `/api/encounters/${encW.id}`, { token: GM });

  // ===== 5. next-turn sur une rencontre terminée → 400 =====
  const encN = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: GM,
      body: { name: 'Tour audit' },
    })
  ).data.encounter;
  await api(base, 'POST', `/api/encounters/${encN.id}/combatants/monster`, {
    token: GM,
    body: { monsterSlug: goblin.slug, count: 1 },
  });
  r = await api(base, 'POST', `/api/encounters/${encN.id}/next-turn`, { token: GM });
  eq(r.status, 200, '5 : next-turn en setup démarre le combat');
  eq(r.data.encounter.status, 'active', '5 : status passe à active');
  r = await api(base, 'POST', `/api/encounters/${encN.id}/next-turn`, { token: GM });
  eq(r.status, 200, '5 : next-turn en active avance');
  r = await api(base, 'PATCH', `/api/encounters/${encN.id}`, {
    token: GM,
    body: { status: 'ended' },
  });
  eq(r.status, 200, '5 : PATCH status=ended accepté');
  const before = srv.query('SELECT round, turn_index FROM encounters WHERE id = ?', encN.id);
  r = await api(base, 'POST', `/api/encounters/${encN.id}/next-turn`, { token: GM });
  eq(r.status, 400, '5 : next-turn sur rencontre terminée → 400');
  const after = srv.query('SELECT round, turn_index FROM encounters WHERE id = ?', encN.id);
  eq(after.round, before.round, '5 : round inchangé');
  eq(after.turn_index, before.turn_index, '5 : turnIndex inchangé');
  await api(base, 'DELETE', `/api/encounters/${encN.id}`, { token: GM });

  // ===== 6. PATCH /encounters/:id valide status / round / turnIndex =====
  const encV = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: GM,
      body: { name: 'Validation audit' },
    })
  ).data.encounter;
  r = await api(base, 'PATCH', `/api/encounters/${encV.id}`, {
    token: GM,
    body: { status: 'bogus' },
  });
  eq(r.status, 400, '6 : statut hors enum → 400 (plus de 500)');
  eq(
    srv.query('SELECT status FROM encounters WHERE id = ?', encV.id).status,
    'setup',
    '6 : la DB est inchangée après le 400',
  );
  r = await api(base, 'PATCH', `/api/encounters/${encV.id}`, {
    token: GM,
    body: { status: 'ended' },
  });
  eq(r.status, 200, '6 : status=ended accepté');
  r = await api(base, 'PATCH', `/api/encounters/${encV.id}`, { token: GM, body: { round: -1 } });
  eq(r.status, 400, '6 : round négatif → 400');
  r = await api(base, 'PATCH', `/api/encounters/${encV.id}`, { token: GM, body: { round: 2.5 } });
  eq(r.status, 400, '6 : round flottant → 400');
  r = await api(base, 'PATCH', `/api/encounters/${encV.id}`, { token: GM, body: { round: 3 } });
  eq(r.status, 200, '6 : round entier accepté');
  r = await api(base, 'PATCH', `/api/encounters/${encV.id}`, {
    token: GM,
    body: { turnIndex: -1 },
  });
  eq(r.status, 400, '6 : turnIndex négatif → 400');
  r = await api(base, 'PATCH', `/api/encounters/${encV.id}`, {
    token: GM,
    body: { turnIndex: '2' },
  });
  eq(r.status, 400, '6 : turnIndex chaîne → 400');
  r = await api(base, 'PATCH', `/api/encounters/${encV.id}`, { token: GM, body: { turnIndex: 2 } });
  eq(r.status, 200, '6 : turnIndex entier accepté');
  await api(base, 'DELETE', `/api/encounters/${encV.id}`, { token: GM });
}
