/**
 * Characters: create/list/get/delete + the big PATCH (dynamic SET builder,
 * JSON fields, concentration flows). Combat-mirror branches of PATCH are
 * exercised in mod-combat / mod-wildshape (they need live encounters).
 * Covers every .prepare site in routes/characters.ts.
 */
import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;

  // ---------- create ----------
  let r = await api(base, 'POST', `/api/parties/${P}/characters`, {
    token: fx.gm.token,
    body: { name: '' },
  });
  eq(r.status, 400, 'create empty name → 400');

  r = await api(base, 'POST', `/api/parties/${P}/characters`, {
    token: fx.gm.token,
    body: { name: 'X', strength: 99 },
  });
  eq(r.status, 400, 'create ability out of range → 400');

  r = await api(base, 'POST', `/api/parties/${P}/characters`, {
    token: fx.gm.token,
    body: { name: 'X', maxHp: 0 },
  });
  eq(r.status, 400, 'create maxHp 0 → 400');

  r = await api(base, 'POST', `/api/parties/${P}/characters`, {
    token: fx.outsider.token,
    body: { name: 'Intrus' },
  });
  eq(r.status, 403, 'create by non-member → 403');

  const zed = await createCharacter(base, fx.player.token, P, {
    name: 'Zed',
    characterClass: 'Roublard',
    race: 'Half-elfe',
    background: 'Criminel',
    level: 4,
    skillProficiencies: ['stealth'],
    languages: ['commun', 'elfe'],
    maxHp: 22,
    hidden: false,
  });
  ok(zed.id > 0, 'create full character');

  // ---------- list ----------
  r = await api(base, 'GET', `/api/parties/${P}/characters`, { token: fx.gm.token });
  eq(r.status, 200, 'list characters (GM)');
  const names = r.data.characters.map((c: any) => c.name);
  ok(names.includes('Ombre'), 'GM list includes hidden');
  ok(names.includes('Zed'), 'list includes new char');

  r = await api(base, 'GET', `/api/parties/${P}/characters`, { token: fx.player.token });
  ok(!r.data.characters.some((c: any) => c.name === 'Ombre'), 'player list hides hidden');

  r = await api(base, 'GET', `/api/parties/${P}/characters`, { token: fx.outsider.token });
  eq(r.status, 403, 'list by non-member → 403');

  // ---------- get single ----------
  r = await api(base, 'GET', `/api/characters/${zed.id}`, { token: fx.player.token });
  eq(r.status, 200, 'get character');
  eq(r.data.character.name, 'Zed', 'character name');
  eq(r.data.character.copper, 0, 'coin purse present');
  // Vitesse dérivée de l'espèce à la création (Demi-elfe → 9 m)
  eq(r.data.character.speed, 9, 'create derives speed from species (Demi-elfe 9 m)');

  // ---------- vitesse : dérivation espèce + suivi au changement ----------

  // Petite race à la création → 7,5 m (Halfelin), sans vitesse explicite.
  const pip = await createCharacter(base, fx.player.token, P, {
    name: 'Pip',
    race: 'Halfelin',
  });
  r = await api(base, 'GET', `/api/characters/${pip.id}`, { token: fx.player.token });
  eq(r.data.character.speed, 7.5, 'create Halfelin → 7.5 m (species-derived)');

  // Sous-espèce : Elfe des bois → 10,5 m.
  const lego = await createCharacter(base, fx.player.token, P, {
    name: 'Légolas',
    race: 'Elfe des bois',
  });
  r = await api(base, 'GET', `/api/characters/${lego.id}`, { token: fx.player.token });
  eq(r.data.character.speed, 10.5, 'create Elfe des bois → 10.5 m (subrace override)');

  // Vitesse explicite : elle gagne sur l'espèce (fiche libre).
  const bolt = await createCharacter(base, fx.player.token, P, {
    name: 'Bolt',
    race: 'Halfelin',
    speed: 12,
  });
  r = await api(base, 'GET', `/api/characters/${bolt.id}`, { token: fx.player.token });
  eq(r.data.character.speed, 12, 'create explicit speed wins over species');

  // Changer d'espèce sans avoir touché la vitesse → la vitesse suit.
  r = await api(base, 'PATCH', `/api/characters/${pip.id}`, {
    token: fx.player.token,
    body: { race: 'Humain' },
  });
  eq(r.status, 200, 'patch race only → 200');
  eq(r.data.character.speed, 9, 'speed follows species change (Halfelin → Humain: 7.5 → 9)');

  // Vitesse personnalisée → un changement d'espèce ne l'écrase PAS.
  r = await api(base, 'PATCH', `/api/characters/${bolt.id}`, {
    token: fx.player.token,
    body: { race: 'Humain' },
  });
  eq(r.status, 200, 'patch race with custom speed → 200');
  eq(r.data.character.speed, 12, 'custom speed survives species change');

  // Espèce inconnue → repli 9 m à la création.
  const xeno = await createCharacter(base, fx.player.token, P, {
    name: 'Xéno',
    race: 'Klingon',
  });
  r = await api(base, 'GET', `/api/characters/${xeno.id}`, { token: fx.player.token });
  eq(r.data.character.speed, 9, 'create unknown species → fallback 9 m');

  r = await api(base, 'GET', '/api/characters/999999', { token: fx.gm.token });
  eq(r.status, 404, 'get 404');

  r = await api(base, 'GET', `/api/characters/${zed.id}`, { token: fx.outsider.token });
  eq(r.status, 403, 'get by non-member → 403');

  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}`, { token: fx.player.token });
  eq(r.status, 404, 'hidden char 404 for other player (existence not betrayed)');
  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}`, { token: fx.gm.token });
  eq(r.status, 200, 'hidden char visible to GM');

  // ---------- patch ----------
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, { token: fx.player.token, body: {} });
  eq(r.status, 400, 'patch no fields → 400');

  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.outsider.token,
    body: { name: 'H4x' },
  });
  eq(r.status, 403, 'patch by outsider → 403');

  r = await api(base, 'PATCH', `/api/characters/${fx.charBran.id}`, {
    token: fx.gm.token,
    body: { hidden: false },
  });
  eq(r.status, 403, "GM cannot flip another owner's hidden flag");

  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { speed: -1 },
  });
  eq(r.status, 400, 'patch invalid speed → 400');

  // ---------- coin purse clamping (server-side: whole, non-negative counts) ----------
  const purseChar = await createCharacter(base, fx.player.token, P, { name: 'Tirelire' });
  r = await api(base, 'PATCH', `/api/characters/${purseChar.id}`, {
    token: fx.player.token,
    body: { gold: -50 },
  });
  eq(r.status, 200, 'patch negative gold accepted (clamped)');
  eq(
    srv.query('SELECT gold FROM characters WHERE id = ?', purseChar.id).gold,
    0,
    'negative gold clamped to 0',
  );
  r = await api(base, 'PATCH', `/api/characters/${purseChar.id}`, {
    token: fx.player.token,
    body: { silver: 12.9 },
  });
  eq(r.status, 200, 'patch fractional silver accepted (truncated)');
  eq(
    srv.query('SELECT silver FROM characters WHERE id = ?', purseChar.id).silver,
    12,
    'fractional silver truncated to whole coins',
  );
  r = await api(base, 'PATCH', `/api/characters/${purseChar.id}`, {
    token: fx.player.token,
    body: { copper: 'beaucoup' },
  });
  eq(r.status, 400, 'patch non-numeric coin → 400');
  r = await api(base, 'DELETE', `/api/characters/${purseChar.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'purse clamp test char deleted');

  // Big multi-field patch: JSON arrays, booleans, null weapon proficiencies,
  // subclass columns, coins, wild shape seen list.
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: {
      name: 'Zed le Rusé',
      level: 5,
      speed: 7.5,
      conditions: ['Aveuglé'],
      skillProficiencies: ['stealth', 'acrobatics'],
      skillExpertise: ['stealth'],
      toolProficiencies: ['outils_de_voleur'],
      toolExpertise: ['outils_de_voleur'],
      languages: ['commun', 'voleurs'],
      savingThrowProficiencies: ['dex'],
      weaponProficiencies: null,
      armorProficiencies: ['light', 'shields'],
      fightingStyle: 'archerie',
      spellSlotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0],
      alignment: 'Neutre',
      personalityTraits: 'Méfiant',
      armorClassOverride: 16,
      deathSaveSuccesses: 1,
      inspiration: true,
      concentrating: true,
      wildShapeSeen: ['loup'],
      druidCircle: 'lune',
      subclass: 'voleur',
      gold: 120,
    },
  });
  eq(r.status, 200, 'big patch ok');
  const row = srv.query('SELECT * FROM characters WHERE id = ?', zed.id);
  eq(row.name, 'Zed le Rusé', 'name persisted');
  eq(row.level, 5, 'level persisted');
  eq(JSON.parse(row.skill_proficiencies).length, 2, 'JSON array persisted');
  eq(row.weapon_proficiencies, null, 'weaponProficiencies null = class default');
  eq(JSON.parse(row.armor_proficiencies).length, 2, 'armorProficiencies JSON persisted');
  eq(
    JSON.stringify(r.data.character.armorProficiencies),
    '["light","shields"]',
    'response maps armorProficiencies back',
  );
  eq(row.inspiration, 1, 'boolean coerced to int');
  eq(row.concentrating, 1, 'concentrating coerced');
  eq(JSON.parse(row.wild_shape_seen_json)[0], 'loup', 'wildShapeSeen mapped to json column');
  eq(row.subclass, 'voleur', 'subclass column');
  eq(r.data.character.inspiration, true, 'response maps boolean back');

  // armorProficiencies: null → back to class default (literal NULL, like weapons)
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { armorProficiencies: null },
  });
  eq(r.status, 200, 'armor proficiency reset patch ok');
  eq(
    srv.query('SELECT armor_proficiencies FROM characters WHERE id = ?', zed.id)
      .armor_proficiencies,
    null,
    'armorProficiencies null = class default',
  );

  // GM (non-owner) can patch — no hidden key
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.gm.token,
    body: { notes: 'Vu en ville' },
  });
  eq(r.status, 200, 'GM can patch a character they do not own');

  // owner can flip hidden
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { hidden: true },
  });
  eq(r.status, 200, 'owner sets hidden');
  r = await api(base, 'GET', `/api/characters/${zed.id}`, { token: fx.gm.token });
  eq(r.status, 200, 'GM still sees newly hidden');
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { hidden: false },
  });
  eq(r.status, 200, 'owner unsets hidden');

  // ---------- concentration: damage while concentrating ----------
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { currentHp: 22, concentrating: true },
  });
  eq(r.status, 200, 'set hp + concentrating');
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { currentHp: 12 },
  });
  eq(r.status, 200, 'take 10 damage while concentrating');
  eq(r.data.concentrationCheck.damage, 10, 'concentration check carries damage');
  eq(r.data.concentrationCheck.dc, 10, 'dc = max(10, dmg/2)');

  // big damage → dc = half
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { currentHp: 22, concentrating: true },
  });
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { currentHp: 1 }, // 21 damage
  });
  eq(r.data.concentrationCheck.dc, 10, 'dc floor check (21 dmg → 10.5 → 10)');

  // dropped to 0 while concentrating → concentration auto-ends (literal SET)
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { currentHp: 10, concentrating: true },
  });
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { currentHp: 0 },
  });
  eq(r.status, 200, 'drop to 0');
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', zed.id).concentrating,
    0,
    'concentration auto-ended at 0 hp',
  );

  // incapacitating condition breaks concentration
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { currentHp: 15, concentrating: true },
  });
  r = await api(base, 'PATCH', `/api/characters/${zed.id}`, {
    token: fx.player.token,
    body: { conditions: ['Inconscient'] },
  });
  eq(r.data.concentrationBroken, 'Inconscient', 'incapacitating condition reported broken');
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', zed.id).concentrating,
    0,
    'concentration cleared',
  );

  r = await api(base, 'PATCH', '/api/characters/999999', {
    token: fx.gm.token,
    body: { name: 'x' },
  });
  eq(r.status, 404, 'patch 404');

  // ---------- delete ----------
  r = await api(base, 'DELETE', '/api/characters/999999', { token: fx.gm.token });
  eq(r.status, 404, 'delete 404');

  const temp = await createCharacter(base, fx.player.token, P, { name: 'Jetable' });
  r = await api(base, 'DELETE', `/api/characters/${temp.id}`, { token: fx.player2.token });
  eq(r.status, 403, 'delete by non-owner non-GM → 403');
  r = await api(base, 'DELETE', `/api/characters/${temp.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'GM can delete');
}
