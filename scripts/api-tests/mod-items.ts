/**
 * Item catalog: search filters (accent-insensitive normalize(), category,
 * rarity, source, party scoping, pagination), custom item CRUD.
 * Covers every .prepare site in routes/items.ts.
 */
import { api, eq, type Fixtures, ok, registerUser, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;

  // ---------- search ----------
  let r = await api(base, 'GET', '/api/items', { token: fx.gm.token });
  eq(r.status, 200, 'list items');
  ok(r.data.items.length > 0, 'seeded items returned');
  ok(r.data.total >= r.data.items.length, 'total present');

  // Régime connectivité : listes en RÉSUMÉ (description à null + drapeau
  // hasDescription) et négociation ETag (304 sans corps) — la prose ne
  // descend qu'avec GET /items/:id.
  const withProse = r.data.items.filter((it: any) => it.hasDescription);
  ok(withProse.length > 0, 'some items flag hasDescription');
  ok(
    r.data.items.every((it: any) => it.description === null),
    'list serves description:null (summary mode)',
  );
  const etag = r.headers?.get('etag');
  ok(!!etag, 'items list carries an ETag');
  if (etag) {
    r = await api(base, 'GET', '/api/items', {
      token: fx.gm.token,
      headers: { 'If-None-Match': etag },
    });
    eq(r.status, 304, 'items list revalidates to 304');
  }
  if (withProse[0]) {
    r = await api(base, 'GET', `/api/items/${withProse[0].id}`, { token: fx.gm.token });
    ok(!!r.data.item?.description, 'item detail serves the prose');
  }

  r = await api(base, 'GET', '/api/items?search=longue', { token: fx.gm.token });
  ok(r.data.total > 0, "search 'longue' finds the longsword");

  // accent-insensitive: 'épée' (with diacritics) must match via normalize()
  r = await api(base, 'GET', `/api/items?search=${encodeURIComponent('épée')}`, {
    token: fx.gm.token,
  });
  ok(r.data.total > 0, "accented search 'épée' matches");

  // dashes in the query are treated as spaces
  const firstSword = srv.queryAll("SELECT name FROM items WHERE name LIKE '%sword%' LIMIT 1")[0];
  if (firstSword) {
    r = await api(
      base,
      'GET',
      `/api/items?search=${encodeURIComponent(firstSword.name.replace(' ', '-'))}`,
      {
        token: fx.gm.token,
      },
    );
    ok(r.data.total > 0, `dash search '${firstSword.name.replace(' ', '-')}' matches`);
  }

  const cat = srv.query(
    'SELECT category, COUNT(*) AS n FROM items GROUP BY category ORDER BY n DESC LIMIT 1',
  );
  r = await api(base, 'GET', `/api/items?category=${encodeURIComponent(cat.category)}`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'category filter');
  ok(
    r.data.items.every((i: any) => i.category === cat.category),
    'category filter consistent',
  );
  eq(r.data.total, cat.n, 'category count matches DB');

  const rare = srv.query(
    "SELECT rarity, COUNT(*) AS n FROM items WHERE rarity != 'none' GROUP BY rarity LIMIT 1",
  );
  r = await api(base, 'GET', `/api/items?rarity=${encodeURIComponent(rare.rarity)}`, {
    token: fx.gm.token,
  });
  eq(r.data.total, rare.n, 'rarity filter (none excluded)');

  r = await api(base, 'GET', '/api/items?source=srd', { token: fx.gm.token });
  ok(
    r.data.items.every((i: any) => i.source === 'srd'),
    'source filter',
  );

  r = await api(base, 'GET', '/api/items?limit=5&offset=0', { token: fx.gm.token });
  eq(r.data.items.length, 5, 'limit respected');

  // user with no parties sees only global SRD items (IS NULL branch)
  const frank = await registerUser(base, 'frank');
  r = await api(base, 'GET', '/api/items', { token: frank.token });
  eq(r.status, 200, 'no-party user lists items');
  ok(
    r.data.items.every((i: any) => i.partyId === null),
    'no-party user sees only SRD items',
  );

  // ---------- custom items ----------
  // player-created items: allowed by default (party setting), author recorded
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.player.token,
    body: { name: 'Fiole du joueur', description: 'Créé par un joueur' },
  });
  eq(r.status, 201, 'player creates a custom item when the party allows it');
  eq(r.data.item.createdBy, fx.player.userId, 'player creation records the author');

  // arme complète par un JOUEUR (setting on) — payload D1-D5 du plan
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.player.token,
    body: {
      name: 'Arc du joueur',
      category: 'weapon',
      damageDice: '1d8+DEX',
      damageType: 'Piercing',
      properties: ['ammunition'],
      baseWeapon: 'Shortbow',
    },
  });
  eq(r.status, 201, 'player creates a full custom weapon when the party allows it');

  // the GM's kill switch: once off, players are back to GM-only creation
  r = await api(base, 'PATCH', `/api/parties/${P}`, {
    token: fx.gm.token,
    body: { playersCreateItems: false },
  });
  eq(r.status, 200, 'GM disables player item creation');
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.player.token,
    body: { name: 'Interdit' },
  });
  eq(r.status, 403, 'player creation blocked once the setting is off');
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.player.token,
    body: { name: 'Interdite aussi', category: 'weapon', damageDice: '1d6' },
  });
  eq(r.status, 403, 'player WEAPON creation blocked once the setting is off');

  // non-members never create, whatever the setting
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.outsider.token,
    body: { name: 'Intrus' },
  });
  eq(r.status, 403, 'create custom item non-member → 403');

  r = await api(base, 'POST', `/api/parties/${P}/items`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'create custom item no name → 400');

  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: {
      name: 'Lame de test',
      category: 'weapon',
      rarity: 'rare',
      weightKg: 1.5,
      costQty: 100,
      costUnit: 'po',
      description: 'Une lame',
    },
  });
  eq(r.status, 201, 'create custom item');
  const custom = r.data.item;
  eq(custom.source, 'custom', 'custom source');
  eq(custom.partyId, P, 'attached to party');
  eq(custom.createdBy, fx.gm.userId, 'GM creation records the author');

  // ---------- armes personnalisées complètes (plan armes-custom 2026-11) ----------
  // Cas d'école utilisateur : « Épée à deux mains +2 », dés 4d6+FOR+2.
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: {
      name: 'Épée à deux mains +2',
      category: 'weapon',
      damageDice: '4d6+FOR+2',
      damageType: 'Slashing',
      magicBonus: 2,
      baseWeapon: 'Greatsword',
      properties: ['heavy', 'two-handed'],
    },
  });
  eq(r.status, 201, 'create full custom weapon');
  const epee = r.data.item;
  eq(epee.damageDice, '4d6+FOR+2', 'custom weapon stores the damage template');
  eq(epee.damageType, 'Slashing', 'custom weapon stores the SRD damage type');
  eq(epee.baseWeapon, 'Greatsword', 'custom weapon carries the stable base key');
  eq(epee.magicBonus, 2, 'explicit magic bonus kept with explicit dice');
  eq(epee.twoHandedDice, null, 'no two-handed dice without the versatile property');
  eq(epee.properties.sort().join(','), 'heavy,two-handed', 'weapon properties stored');
  const rowEpee = srv.query('SELECT * FROM items WHERE id = ?', epee.id);
  eq(rowEpee.two_handed_dice, null, 'two_handed_dice column null in DB');
  eq(rowEpee.magic_bonus, 2, 'magic_bonus column in DB');

  // polyvalente : les dés 2M ne sont conservés qu'avec la propriété
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: {
      name: 'Lame polyvalente',
      category: 'weapon',
      damageDice: '1d8+FOR',
      twoHandedDice: '1d10+FOR',
      properties: ['versatile'],
    },
  });
  eq(r.status, 201, 'create versatile custom weapon');
  eq(r.data.item.twoHandedDice, '1d10+FOR', 'versatile keeps the 2H template');
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: {
      name: 'Lame lourde 2M ignorée',
      category: 'weapon',
      damageDice: '2d6',
      twoHandedDice: '1d12',
      properties: ['heavy'],
    },
  });
  eq(r.status, 201, 'create non-versatile weapon with 2H dice');
  eq(r.data.item.twoHandedDice, null, '2H dice silently dropped without versatile');

  // propriétés inconnues filtrées silencieusement — jamais d'injection
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: {
      name: 'Dague étrange',
      category: 'weapon',
      damageDice: '1d4+FOR',
      properties: ['finesse', 'mwahaha'],
    },
  });
  eq(r.status, 201, 'unknown properties are filtered, not rejected');
  eq(r.data.item.properties.join(','), 'finesse', 'only SRD property keys stored');

  // validations → 400
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: { name: 'Invalide', category: 'weapon', damageDice: '4d6+FOO' },
  });
  eq(r.status, 400, 'invalid damage template → 400');
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: {
      name: 'Invalide 2M',
      category: 'weapon',
      damageDice: '1d8',
      twoHandedDice: '1d10+BAR',
      properties: ['versatile'],
    },
  });
  eq(r.status, 400, 'invalid 2H template → 400');
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: { name: 'Invalide bonus', category: 'weapon', damageDice: '1d8', magicBonus: 5 },
  });
  eq(r.status, 400, 'magic bonus out of +1/+2/+3 → 400');
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: { name: 'Invalide type', category: 'weapon', damageDice: '1d8', damageType: 'Plasma' },
  });
  eq(r.status, 400, 'non-SRD damage type → 400');
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: { name: 'Invalide base', category: 'weapon', damageDice: '1d8', baseWeapon: 'Excalibur' },
  });
  eq(r.status, 400, 'unknown base weapon → 400');

  // party context: SRD catalog + this party's customs — and nothing from
  // other parties, even for a user member of both (DM here, player there)
  r = await api(base, 'GET', `/api/items?partyId=${P}`, { token: fx.gm.token });
  eq(r.status, 200, 'party context lists items');
  ok(r.data.total > 1, 'party context includes the SRD catalog');
  ok(
    r.data.items.every((i: any) => i.partyId === null || i.partyId === P),
    'party context shows SRD + own customs only',
  );
  r = await api(base, 'GET', `/api/items?partyId=${P}&search=lame`, { token: fx.gm.token });
  ok(
    r.data.items.some((i: any) => i.id === custom.id),
    'own custom item present in its party context',
  );
  r = await api(base, 'GET', `/api/items?partyId=${P}&source=custom`, { token: fx.gm.token });
  eq(
    r.data.total,
    srv.query('SELECT COUNT(*) AS c FROM items WHERE party_id = ? AND source = ?', P, 'custom').c,
    'party + source=custom → own customs only (dashboard tab)',
  );
  // L'onglet custom du MD garde la PROSE (rendu + édition) — seule la
  // recherche résumé descend le drapeau d'existence.
  const fiole = r.data.items.find((i: any) => i.name === 'Fiole du joueur');
  ok(fiole?.description, 'source=custom list keeps the prose');
  r = await api(base, 'GET', `/api/items?partyId=${P}`, { token: fx.outsider.token });
  eq(r.status, 403, 'party filter non-member → 403');

  // cross-party: our GM joins zoe's party as a player — neither search may
  // leak the other party's custom items, and the inventory refuses them by id
  const zoe = await registerUser(base, 'zoe');
  r = await api(base, 'POST', '/api/parties', { token: zoe.token, body: { name: 'Autre groupe' } });
  const Z = r.data.party.id as number;
  const zoeInvite = r.data.party.inviteCode as string;
  r = await api(base, 'POST', '/api/parties/join', {
    token: fx.gm.token,
    body: { inviteCode: zoeInvite },
  });
  eq(r.status, 201, 'GM joins the other party as a player');
  r = await api(base, 'POST', `/api/parties/${Z}/items`, {
    token: zoe.token,
    body: { name: 'Relique de Zoe' },
  });
  eq(r.status, 201, 'zoe creates a custom item in her party');
  const zoeItem = r.data.item;

  r = await api(base, 'GET', `/api/items?partyId=${Z}&search=relique`, { token: fx.gm.token });
  ok(
    r.data.items.some((i: any) => i.id === zoeItem.id),
    "other party's custom shows in its own context",
  );
  ok(
    !r.data.items.some((i: any) => i.id === custom.id),
    "GM-as-player there does not see our party's custom item",
  );
  r = await api(base, 'GET', `/api/items?partyId=${P}&search=relique`, { token: fx.gm.token });
  ok(
    !r.data.items.some((i: any) => i.id === zoeItem.id),
    "our party context does not see the other party's item",
  );

  // inventory guard: another party's item cannot enter our characters (the
  // legit add path is covered by mod-inventory — a 201 here would also skew
  // its global 'add' transaction count)
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/inventory`, {
    token: fx.gm.token,
    body: { itemId: zoeItem.id, quantity: 1 },
  });
  eq(r.status, 403, 'adding another party item to inventory → 403');
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/inventory`, {
    token: fx.gm.token,
    body: { itemId: 999999, quantity: 1 },
  });
  eq(r.status, 404, 'adding an unknown item → 404');

  // single item: srd + custom + foreign custom
  const someItem = srv.query('SELECT id FROM items ORDER BY id LIMIT 1');
  r = await api(base, 'GET', `/api/items/${someItem.id}`, { token: fx.gm.token });
  eq(r.status, 200, 'get srd item');
  r = await api(base, 'GET', `/api/items/${custom.id}`, { token: fx.player.token });
  eq(r.status, 200, 'custom item visible to party member');
  r = await api(base, 'GET', `/api/items/${custom.id}`, { token: frank.token });
  eq(r.status, 403, 'custom item hidden from non-members');
  r = await api(base, 'GET', '/api/items/999999', { token: fx.gm.token });
  eq(r.status, 404, 'item 404');

  // ---------- update ----------
  r = await api(base, 'PATCH', `/api/items/${someItem.id}`, {
    token: fx.gm.token,
    body: { name: 'x' },
  });
  eq(r.status, 403, 'cannot modify srd item');

  r = await api(base, 'PATCH', `/api/items/${custom.id}`, {
    token: fx.player.token,
    body: { name: 'x' },
  });
  eq(r.status, 403, 'only GM modifies custom item');

  r = await api(base, 'PATCH', `/api/items/${custom.id}`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'patch item no fields → 400');

  r = await api(base, 'PATCH', `/api/items/${custom.id}`, {
    token: fx.gm.token,
    body: {
      name: 'Lame renommée',
      category: 'weapon',
      rarity: 'very-rare',
      weightKg: 2,
      costQty: 200,
      costUnit: 'po',
      description: 'Mieux',
    },
  });
  eq(r.status, 200, 'patch custom item');
  eq(r.data.item.name, 'Lame renommée', 'item renamed');

  // PATCH d'une arme custom : dés + propriétés + base changés → re-résolution
  r = await api(base, 'PATCH', `/api/items/${epee.id}`, {
    token: fx.gm.token,
    body: {
      damageDice: '2d6+FOR',
      properties: ['versatile'],
      twoHandedDice: '1d12',
      baseWeapon: 'Longsword',
    },
  });
  eq(r.status, 200, 'patch custom weapon fields');
  eq(r.data.item.damageDice, '2d6+FOR', 'patched template stored');
  eq(r.data.item.twoHandedDice, '1d12', 'patched 2H template stored');
  eq(r.data.item.baseWeapon, 'Longsword', 'base key re-resolved to the new base');
  eq(r.data.item.properties.join(','), 'versatile', 'patched properties stored');
  eq(r.data.item.magicBonus, 2, 'magic bonus preserved through re-resolution');
  r = await api(base, 'PATCH', `/api/items/${epee.id}`, {
    token: fx.gm.token,
    body: { damageDice: '2d6+OUPS' },
  });
  eq(r.status, 400, 'patch with invalid template → 400');
  r = await api(base, 'PATCH', '/api/items/999999', { token: fx.gm.token, body: { name: 'x' } });
  eq(r.status, 404, 'patch item 404');

  // ---------- delete ----------
  r = await api(base, 'DELETE', `/api/items/${someItem.id}`, { token: fx.gm.token });
  eq(r.status, 403, 'cannot delete srd item');
  r = await api(base, 'DELETE', `/api/items/${custom.id}`, { token: fx.player.token });
  eq(r.status, 403, 'only GM deletes custom item');
  r = await api(base, 'DELETE', '/api/items/999999', { token: fx.gm.token });
  eq(r.status, 404, 'delete item 404');
  r = await api(base, 'DELETE', `/api/items/${custom.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete custom item');
  // ---------- Découplage moteur/noms : clés de base + payload mono-locale ----------
  const keyStats = srv.query(
    `SELECT
       SUM(CASE WHEN category = 'weapon' AND base_weapon IS NOT NULL THEN 1 ELSE 0 END) AS w,
       SUM(CASE WHEN category = 'weapon' THEN 1 ELSE 0 END) AS wt,
       SUM(CASE WHEN category = 'armor' AND (base_armor IS NOT NULL OR armor_family IS NOT NULL) THEN 1 ELSE 0 END) AS a,
       SUM(CASE WHEN category = 'armor' THEN 1 ELSE 0 END) AS at
     FROM items WHERE source = 'srd'`,
  ) as { w: number; wt: number; a: number; at: number };
  ok(keyStats.w >= keyStats.wt * 0.9, `weapon base keys backfilled (${keyStats.w}/${keyStats.wt})`);
  ok(keyStats.a >= keyStats.at * 0.9, `armor base keys backfilled (${keyStats.a}/${keyStats.at})`);

  const frItem = srv.query(
    "SELECT id, COALESCE(name_fr, name) AS fr, name AS en FROM items WHERE srd_index = 'longsword'",
  ) as { id: number; fr: string; en: string };
  r = await api(base, 'GET', `/api/items/${frItem.id}`, { token: fx.player.token });
  eq(r.data.item.name, frItem.fr, 'default lang serves French name');
  ok(!('nameFr' in r.data.item), 'single-locale payload: no nameFr field');
  ok(r.data.item.baseWeapon === 'Longsword', 'payload carries baseWeapon key');
  r = await api(base, 'GET', `/api/items/${frItem.id}`, {
    token: fx.player.token,
    headers: { 'Accept-Language': 'en' },
  });
  eq(r.data.item.name, frItem.en, 'Accept-Language: en serves English name');
}
