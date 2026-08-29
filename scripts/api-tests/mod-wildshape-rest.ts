/**
 * Wild Shape (forms / shape / revert, sheet- and tracker-side HP routing)
 * + rests (short/long, catalog counters, HP mirror).
 * Covers every .prepare site in routes/wildshape.ts and routes/rest.ts,
 * plus the wild-shape branches of characters.ts PATCH.
 */
import { CLASS_FEATURES } from '@table-sync/shared';
import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;
  const GM = fx.gm.token;

  // ---------- fixtures ----------
  const druid = await createCharacter(base, GM, P, {
    name: 'Génisse',
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
    "SELECT slug, name_fr, challenge_rating, armor_class FROM monsters WHERE type = 'Bête' AND challenge_rating <= 1 AND hit_points >= 8 AND speed_json NOT LIKE '%fly%' AND speed_json NOT LIKE '%swim%' ORDER BY challenge_rating DESC, slug LIMIT 2",
  );
  ok(beasts.length === 2, 'two low-CR beasts available');
  await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { wildShapeSeen: [beasts[0].slug, beasts[1].slug] },
  });

  // ---------- forms ----------
  let r = await api(base, 'GET', '/api/characters/999999/wild-shape/forms', { token: GM });
  eq(r.status, 404, 'forms 404');
  r = await api(base, 'GET', `/api/characters/${druid.id}/wild-shape/forms`, {
    token: fx.player.token,
  });
  eq(r.status, 403, 'forms reserved to owner/GM');

  r = await api(base, 'GET', `/api/characters/${druid.id}/wild-shape/forms`, { token: GM });
  eq(r.status, 200, 'forms list');
  ok(r.data.forms.length > 0, 'eligible forms');
  eq(r.data.uses, 2, '2 uses per short rest');
  eq(r.data.maxCR, 1, 'moon druid level 2 → CR 1');
  ok(
    r.data.forms.every((f: any) => f.seen === true || f.seen === false),
    'seen flag computed',
  );

  // Mono-locale : sous Accept-Language: en, le nom vient de l'overlay EN
  // (repli FR) — le sélecteur de forme suit la langue du reste de l'API.
  r = await api(base, 'GET', `/api/characters/${druid.id}/wild-shape/forms`, {
    token: GM,
    headers: { 'Accept-Language': 'en' },
  });
  eq(r.status, 200, 'forms list EN');
  const wolfFr = r.data.forms.find((f: any) => f.slug === 'loup');
  ok(wolfFr && wolfFr.name === 'Wolf', 'EN overlay name served (loup → Wolf)');
  ok(
    r.data.forms.every((f: any) => typeof f.name === 'string' && f.name.length > 0),
    'every form has a name in EN',
  );
  // FR (défaut) : nom FR servi tel quel
  r = await api(base, 'GET', `/api/characters/${druid.id}/wild-shape/forms`, { token: GM });
  const wolfEn = r.data.forms.find((f: any) => f.slug === 'loup');
  ok(wolfEn && wolfEn.name === 'Loup', 'FR name served by default (loup → Loup)');

  // ---------- shape ----------
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: fx.player.token,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 403, 'shape reserved to owner/GM');
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: 'pas-une-bete' },
  });
  eq(r.status, 404, 'unknown beast → 404');
  const unseen = srv.query(
    "SELECT slug FROM monsters WHERE type = 'Bête' AND challenge_rating > 1 AND slug NOT IN (?, ?) LIMIT 1",
    beasts[0].slug,
    beasts[1].slug,
  );
  if (unseen) {
    r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
      token: GM,
      body: { slug: unseen.slug },
    });
    eq(r.status, 400, 'unseen beast refused');
  }

  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, 'enter wild shape');
  ok(r.data.shape.hp > 0, 'shape hp rolled');
  const firstShapeHp = r.data.shape.hp;
  const row = srv.query(
    'SELECT wild_shape_slug, wild_shape_hp, wild_shape_uses FROM characters WHERE id = ?',
    druid.id,
  );
  eq(row.wild_shape_slug, beasts[0].slug, 'shape stored');
  eq(row.wild_shape_uses, 1, 'use consumed');
  eq(row.wild_shape_hp, firstShapeHp, 'shape hp stored');

  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[1].slug },
  });
  eq(r.status, 400, 'already shaped → 400');

  // ---- sheet-side HP routing while shaped (characters.ts branches) ----
  // The combatant must exist BEFORE shaping — the shape transform only
  // rewrites existing combatants.
  await api(base, 'POST', `/api/characters/${druid.id}/wild-shape/revert`, { token: GM });
  const enc = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: GM,
      body: { name: 'Forme animale' },
    })
  ).data.encounter;
  const comb = (
    await api(base, 'POST', `/api/encounters/${enc.id}/combatants/player`, {
      token: GM,
      body: { characterId: druid.id },
    })
  ).data.combatants[0];
  eq(comb.hitPoints, 17, 'combatant starts at normal hp');

  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, 'shape with a live combatant');
  const shapeHp = srv.query('SELECT wild_shape_hp AS h FROM characters WHERE id = ?', druid.id).h;
  const combBeast = srv.query(
    'SELECT name, hit_points, max_hit_points FROM combatants WHERE id = ?',
    comb.id,
  );
  ok(combBeast.name.includes(beasts[0].name_fr ?? beasts[0].slug), 'combatant became the beast');
  eq(combBeast.hit_points, shapeHp, 'combatant hp is the shape hp');

  // damage the shape from the SHEET: currentHp routes to wild_shape_hp
  r = await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { currentHp: Math.max(1, shapeHp - 4) },
  });
  eq(
    srv.query('SELECT wild_shape_hp AS h FROM characters WHERE id = ?', druid.id).h,
    shapeHp - 4,
    'sheet damage hits the shape bar',
  );
  eq(
    srv.query('SELECT current_hp AS h FROM characters WHERE id = ?', druid.id).h,
    17,
    'normal hp untouched',
  );
  eq(
    srv.query('SELECT hit_points AS h FROM combatants WHERE id = ?', comb.id).h,
    shapeHp - 4,
    'combatant follows the shape bar',
  );

  // currentHp-only patch while shaped returns early (rowAfter branch)
  r = await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { currentHp: shapeHp - 6 },
  });
  eq(r.status, 200, 'shaped hp-only patch');
  eq(r.data.character.wildShapeSlug, beasts[0].slug, 'still shaped in response');

  // drop the shape to 0 from the sheet → auto-revert with carry-over.
  // body.currentHp = -shapeHp → shape bar hits 0 with `shapeHp` excess damage.
  r = await api(base, 'PATCH', `/api/characters/${druid.id}`, {
    token: GM,
    body: { currentHp: -shapeHp },
  });
  eq(r.status, 200, 'shape dropped to 0');
  const reverted = srv.query(
    'SELECT wild_shape_slug, current_hp FROM characters WHERE id = ?',
    druid.id,
  );
  eq(reverted.wild_shape_slug, null, 'auto-reverted');
  eq(reverted.current_hp, Math.max(0, 17 - shapeHp), 'excess damage carried over to normal form');

  // ---- tracker-side while shaped (combat.ts branches) ----
  // uses are exhausted (two shapes so far) — short rest, then shape again
  await api(base, 'PATCH', `/api/characters/${druid.id}`, { token: GM, body: { currentHp: 17 } });
  await api(base, 'POST', `/api/characters/${druid.id}/rest`, {
    token: GM,
    body: { type: 'short' },
  });
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, 'shape for tracker-side tests');
  const shape2 = srv.query('SELECT wild_shape_hp AS h FROM characters WHERE id = ?', druid.id).h;

  r = await api(base, 'PATCH', `/api/combatants/${comb.id}`, {
    token: GM,
    body: { hitPoints: Math.max(1, shape2 - 3) },
  });
  eq(
    srv.query('SELECT wild_shape_hp AS h FROM characters WHERE id = ?', druid.id).h,
    shape2 - 3,
    'tracker damage hits shape bar',
  );

  // tracker drops the shape to 0 → revert with carry-over inside combat.ts
  r = await api(base, 'PATCH', `/api/combatants/${comb.id}`, {
    token: GM,
    body: { hitPoints: -2 },
  });
  const afterTrackerRevert = srv.query(
    'SELECT wild_shape_slug, current_hp, max_hp FROM characters WHERE id = ?',
    druid.id,
  );
  eq(afterTrackerRevert.wild_shape_slug, null, 'tracker kill reverts the shape');
  const combRow = srv.query(
    'SELECT name, hit_points, max_hit_points FROM combatants WHERE id = ?',
    comb.id,
  );
  eq(combRow.max_hit_points, 17, 'combatant back to normal max hp');
  ok(!combRow.name.includes('('), 'combatant name back to normal');

  // revert endpoint: not shaped → 400
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape/revert`, { token: GM });
  eq(r.status, 400, 'revert when not shaped → 400');
  r = await api(base, 'POST', `/api/characters/999999/wild-shape/revert`, { token: GM });
  eq(r.status, 404, 'revert 404');
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape/revert`, {
    token: fx.player.token,
  });
  eq(r.status, 403, 'revert reserved');

  // uses exhausted → short rest restores (see rest section below); here: shape after rest + manual revert
  await api(base, 'PATCH', `/api/characters/${druid.id}`, { token: GM, body: { currentHp: 17 } });
  await api(base, 'POST', `/api/characters/${druid.id}/rest`, {
    token: GM,
    body: { type: 'short' },
  });
  eq(
    srv.query('SELECT wild_shape_uses AS u FROM characters WHERE id = ?', druid.id).u,
    2,
    'short rest restores wild shape uses',
  );

  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, 'shaped again after rest');
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape/revert`, { token: GM });
  eq(r.status, 200, 'manual revert');
  eq(r.data.excessDamage, 0, 'no excess on voluntary revert');

  // no uses left → 400 (uses at 1 after two shapes… wait: rest reset to 2, shape → 1, revert keeps 1)
  // burn the remaining use then try to shape
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 201, 'burn last use');
  await api(base, 'POST', `/api/characters/${druid.id}/wild-shape/revert`, { token: GM });
  r = await api(base, 'POST', `/api/characters/${druid.id}/wild-shape`, {
    token: GM,
    body: { slug: beasts[0].slug },
  });
  eq(r.status, 400, 'no uses left → 400');

  // clean up the encounter
  await api(base, 'DELETE', `/api/encounters/${enc.id}`, { token: GM });

  // ---------- rest ----------
  r = await api(base, 'POST', '/api/characters/999999/rest', {
    token: GM,
    body: { type: 'short' },
  });
  eq(r.status, 404, 'rest 404');
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: fx.outsider.token,
    body: { type: 'short' },
  });
  eq(r.status, 403, 'rest by non-member → 403');
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: fx.player2.token,
    body: { type: 'short' },
  });
  eq(r.status, 403, 'rest by member non-owner → 403');
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: GM,
    body: { type: 'sieste' },
  });
  eq(r.status, 400, 'invalid rest type → 400');
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: GM,
    body: { type: 'short', hitDiceSpent: 1.5 },
  });
  eq(r.status, 400, 'non-integer hitDiceSpent → 400');
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: GM,
    body: { type: 'short', healedHp: -3 },
  });
  eq(r.status, 400, 'negative healedHp → 400');

  // short rest with hit-dice healing
  await api(base, 'PATCH', `/api/characters/${fx.charAlya.id}`, {
    token: GM,
    body: { currentHp: 10, maxHp: 25, hitDiceUsed: 2, conditions: ['Aveuglé'] },
  });
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: GM,
    body: { type: 'short', hitDiceSpent: 1, healedHp: 6 },
  });
  eq(r.status, 200, 'short rest');
  const alyaAfterShort = srv.query(
    'SELECT current_hp, hit_dice_used, conditions FROM characters WHERE id = ?',
    fx.charAlya.id,
  );
  eq(alyaAfterShort.current_hp, 16, 'healed hp applied (player-rolled dice)');
  eq(alyaAfterShort.hit_dice_used, 3, 'hit die spent');
  eq(r.data.diceSpent, 1, 'dice spent reported');
  ok(alyaAfterShort.conditions.includes('Aveuglé'), 'short rest keeps conditions');

  // short-rest feature counters (a catalog feature with a short-rest recharge)
  const shortRecharge = Object.values(CLASS_FEATURES)
    .flat()
    .find((f: any) => f.resource?.reset === 'short' && f.resource?.max);
  ok(shortRecharge, 'catalog has a short-rest feature with a max');
  const added = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/features`, {
    token: GM,
    body: { title: shortRecharge.name, catalogId: shortRecharge.id },
  });
  const featId = added.data.feature.id;
  await api(base, 'PATCH', `/api/character-features/${featId}`, {
    token: GM,
    body: { counterCurrent: 0 },
  });
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: GM,
    body: { type: 'short' },
  });
  ok(r.data.resetFeatures >= 1, 'feature counters reset');
  const afterReset = srv.query(
    'SELECT counter_max, counter_current FROM character_features WHERE id = ?',
    featId,
  );
  eq(
    afterReset.counter_current,
    afterReset.counter_max,
    'counter back to max (recomputed at current level)',
  );

  // long rest: full recovery
  await api(base, 'PATCH', `/api/characters/${fx.charAlya.id}`, {
    token: GM,
    body: {
      currentHp: 5,
      tempHp: 4,
      exhaustion: 2,
      spellSlotsUsed: [1, 2, 0, 0, 0, 0, 0, 0, 0],
      concentrating: true,
      deathSaveFailures: 2,
    },
  });
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: GM,
    body: { type: 'long' },
  });
  eq(r.status, 200, 'long rest');
  const alyaAfterLong = srv.query(
    'SELECT current_hp, temp_hp, exhaustion, spell_slots_used, concentrating, death_save_failures, hit_dice_used FROM characters WHERE id = ?',
    fx.charAlya.id,
  );
  eq(alyaAfterLong.current_hp, 25, 'full hp');
  eq(alyaAfterLong.temp_hp, 0, 'temp hp cleared');
  eq(alyaAfterLong.exhaustion, 1, 'exhaustion −1');
  eq(
    JSON.parse(alyaAfterLong.spell_slots_used).every((v: number) => v === 0),
    true,
    'slots restored',
  );
  eq(alyaAfterLong.concentrating, 0, 'concentration off');
  eq(alyaAfterLong.death_save_failures, 0, 'death saves cleared');
  // half level (5) → min 1... floor(5/2)=2 of 5 dice: used 3 + 2 back = but cap at level
  ok(alyaAfterLong.hit_dice_used < 3, 'hit dice partially restored');

  // long rest with an active combatant mirrors hp
  const enc3 = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: GM,
      body: { name: 'Long repos' },
    })
  ).data.encounter;
  const comb3 = (
    await api(base, 'POST', `/api/encounters/${enc3.id}/combatants/player`, {
      token: GM,
      body: { characterId: fx.charAlya.id },
    })
  ).data.combatants[0];
  await api(base, 'PATCH', `/api/characters/${fx.charAlya.id}`, {
    token: GM,
    body: { currentHp: 5 },
  });
  await api(base, 'PATCH', `/api/encounters/${enc3.id}`, { token: GM, body: { status: 'active' } });
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/rest`, {
    token: GM,
    body: { type: 'long' },
  });
  eq(
    srv.query('SELECT hit_points AS h FROM combatants WHERE id = ?', comb3.id).h,
    25,
    'rest heals the combatant too',
  );
  await api(base, 'DELETE', `/api/encounters/${enc3.id}`, { token: GM });
}
