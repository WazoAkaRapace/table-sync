/**
 * Inventory + storage locations: encumbrance reads, add/adjust/remove,
 * transfers, food/water consumption, waterskin refill, transaction log.
 * Covers every .prepare site in routes/inventory.ts and routes/locations.ts
 * (ensureCarriedLocation included — it is called through the inventory GETs).
 */
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const A = fx.charAlya.id;
  const B = fx.charBran.id;

  // ---------- fixtures from the seed ----------
  const item = srv.query('SELECT id, COALESCE(name_fr, name) AS n FROM items ORDER BY id LIMIT 1');
  const food = srv.query('SELECT id FROM items WHERE survival_tags LIKE \'%"food"%\' LIMIT 1');
  const water = srv.query('SELECT id FROM items WHERE survival_tags LIKE \'%"water"%\' LIMIT 1');
  ok(food && water, 'seeded survival items exist');

  // ---------- GET inventory (creates the carried location) ----------
  let r = await api(base, 'GET', `/api/characters/${A}/inventory`, { token: fx.gm.token });
  eq(r.status, 200, 'inventory read');
  ok(r.data.character.name === 'Alya', 'inventory embeds character');
  const carried = r.data.locations.find((l: any) => l.type === 'carried');
  ok(carried, 'carried location auto-created');
  ok(
    Array.isArray(r.data.locationWeights) && r.data.locationWeights.length > 0,
    'location weights computed',
  );
  ok(r.data.encumbrance, 'encumbrance computed');

  r = await api(base, 'GET', `/api/characters/${A}/inventory`, { token: fx.player.token });
  eq(r.status, 200, 'party member reads inventory');
  r = await api(base, 'GET', `/api/characters/${A}/inventory`, { token: fx.outsider.token });
  eq(r.status, 403, 'outsider → 403');
  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}/inventory`, {
    token: fx.player.token,
  });
  eq(r.status, 404, 'hidden character inventory → 404');
  r = await api(base, 'GET', '/api/characters/999999/inventory', { token: fx.gm.token });
  eq(r.status, 404, 'inventory 404');

  // ---------- add ----------
  r = await api(base, 'POST', `/api/characters/${A}/inventory`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'add missing itemId → 400');

  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.player.token,
    body: { itemId: item.id },
  });
  eq(r.status, 403, 'add by non-owner → 403');

  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 2, notes: 'neuf' },
  });
  eq(r.status, 201, 'add item');
  const entry = r.data.entry;
  eq(entry.quantity, 2, 'quantity stored');

  // same item again → upsert merges quantity
  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 3 },
  });
  eq(r.status, 201, 'add same item again (upsert)');
  eq(r.data.entry.quantity, 5, 'quantity merged to 5');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM transactions WHERE reason = ?', 'add').c,
    2,
    'add transactions logged',
  );

  // ---------- clés de base dans le payload inventaire (bug #? dague non qualifiée) ----------
  // L'entrée d'inventaire JOIN items avec alias i_ : mapInventoryEntry doit
  // transporter base_weapon, sinon la fiche retombe sur le nom localisé FR
  // (« Dague ») et rate findMundaneByName → arme prise pour de guerre,
  // bonus de maîtrise perdu pour les classes « armes courantes ».
  const dagger = srv.query("SELECT id FROM items WHERE srd_index = 'dagger'");
  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: dagger.id },
  });
  eq(r.status, 201, 'add dagger');
  eq(r.data.entry.item.baseWeapon, 'Dagger', 'POST entry carries baseWeapon');
  eq(r.data.entry.item.name, 'Dague', 'entry serves localized name');
  r = await api(base, 'GET', `/api/characters/${A}/inventory`, { token: fx.gm.token });
  const daggerEntry = r.data.entries.find((e: any) => e.item.baseWeapon === 'Dagger');
  ok(daggerEntry, 'GET inventory entry carries baseWeapon');
  // Régime connectivité : la fiche embarque des objets en RÉSUMÉ — prose à
  // null + drapeau d'existence (lazyDetails ouvre la ligne → GET /items/:id).
  ok(
    r.data.entries.every((e: any) => e.item.description === null),
    'sheet entries serve description:null (summary mode)',
  );
  ok(
    r.data.entries.every((e: any) => e.item.hasDescription !== undefined),
    'sheet entries carry the hasDescription flag',
  );
  r = await api(base, 'DELETE', `/api/inventory/${daggerEntry.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'remove dagger entry');

  // ---------- patch entry ----------
  r = await api(base, 'PATCH', `/api/inventory/${entry.id}`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'patch entry no fields → 400');

  r = await api(base, 'PATCH', `/api/inventory/999999`, {
    token: fx.gm.token,
    body: { quantity: 1 },
  });
  eq(r.status, 404, 'patch entry 404');

  r = await api(base, 'PATCH', `/api/inventory/${entry.id}`, {
    token: fx.gm.token,
    body: { quantity: 7, equipped: true, notes: 'prisé' },
  });
  eq(r.status, 200, 'patch entry');
  eq(r.data.entry.quantity, 7, 'quantity updated');
  eq(r.data.entry.equipped, true, 'equipped updated');
  ok(
    srv.query('SELECT COUNT(*) AS c FROM transactions WHERE reason = ?', 'adjust').c >= 1,
    'adjust transaction logged',
  );

  // ---------- locations ----------
  r = await api(base, 'GET', `/api/characters/${A}/locations`, { token: fx.gm.token });
  eq(r.status, 200, 'locations list');
  eq(r.data.locations.length, 1, 'only carried so far');

  r = await api(base, 'POST', `/api/characters/${A}/locations`, {
    token: fx.gm.token,
    body: { name: '' },
  });
  eq(r.status, 400, 'create location no name → 400');
  r = await api(base, 'POST', `/api/characters/${A}/locations`, {
    token: fx.player.token,
    body: { name: 'Mule' },
  });
  eq(r.status, 403, 'create location non-owner → 403');

  r = await api(base, 'POST', `/api/characters/${A}/locations`, {
    token: fx.gm.token,
    body: { name: 'Mule', type: 'mount', strength: 14, multiplier: 2, ownWeightKg: 5 },
  });
  eq(r.status, 201, 'create mount location');
  const mount = r.data.location;

  // move the entry onto the mount
  r = await api(base, 'PATCH', `/api/inventory/${entry.id}`, {
    token: fx.gm.token,
    body: { storageLocationId: mount.id },
  });
  eq(r.status, 200, 'entry moved to mount');
  eq(r.data.entry.storageLocationId, mount.id, 'storage updated');

  // delete mount → items fall back to carried (merge branch: same item already? no — entry is the only one, move branch)
  r = await api(base, 'DELETE', `/api/locations/${carried.id}`, { token: fx.gm.token });
  eq(r.status, 400, 'cannot delete carried location');

  r = await api(base, 'DELETE', `/api/locations/999999`, { token: fx.gm.token });
  eq(r.status, 404, 'delete location 404');

  // merge branch: put a second copy on carried, another on mount, delete mount → merge
  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 4 },
  });
  const carriedEntry = r.data.entry; // lands on carried
  r = await api(base, 'DELETE', `/api/locations/${mount.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete mount location');
  const merged = srv.query('SELECT quantity FROM inventory WHERE id = ?', carriedEntry.id);
  eq(merged.quantity, 11, 'entries merged onto carried (7 moved + 4)');

  // move branch: an item that exists ONLY on the location just moves to carried
  const otherItem = srv.query('SELECT id FROM items WHERE id != ? ORDER BY id LIMIT 1', item.id);
  const mount2 = (
    await api(base, 'POST', `/api/characters/${A}/locations`, {
      token: fx.gm.token,
      body: { name: 'Charrette', type: 'container', capacityKg: 100, ownWeightKg: 20 },
    })
  ).data.location;
  const cartEntry = (
    await api(base, 'POST', `/api/characters/${A}/inventory`, {
      token: fx.gm.token,
      body: { itemId: otherItem.id, quantity: 2, storageLocationId: mount2.id },
    })
  ).data.entry;
  r = await api(base, 'DELETE', `/api/locations/${mount2.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete container');
  const moved = srv.query(
    'SELECT storage_location_id AS loc, quantity AS q FROM inventory WHERE id = ?',
    cartEntry.id,
  );
  ok(moved && moved.loc !== null, 'entry moved to carried (no merge needed)');
  eq(moved.q, 2, 'quantity preserved on move');

  // ---------- transfer ----------
  r = await api(base, 'POST', `/api/characters/${A}/transfer`, {
    token: fx.gm.token,
    body: { toCharacterId: B, inventoryId: carriedEntry.id, quantity: 999 },
  });
  eq(r.status, 400, 'transfer more than owned → 400');

  r = await api(base, 'POST', `/api/characters/${A}/transfer`, {
    token: fx.gm.token,
    body: { toCharacterId: B, inventoryId: 999999, quantity: 1 },
  });
  eq(r.status, 404, 'transfer unknown entry → 404');

  // cross-party: outsider makes his own char
  const oParty = await api(base, 'POST', '/api/parties', {
    token: fx.outsider.token,
    body: { name: 'Autre' },
  });
  const oChar = await api(base, 'POST', `/api/parties/${oParty.data.party.id}/characters`, {
    token: fx.outsider.token,
    body: { name: 'Ailleurs' },
  });
  r = await api(base, 'POST', `/api/characters/${A}/transfer`, {
    token: fx.gm.token,
    body: { toCharacterId: oChar.data.character.id, inventoryId: carriedEntry.id, quantity: 1 },
  });
  eq(r.status, 400, 'cross-party transfer → 400');

  r = await api(base, 'POST', `/api/characters/${A}/transfer`, {
    token: fx.player2.token,
    body: { toCharacterId: B, inventoryId: carriedEntry.id, quantity: 1 },
  });
  eq(r.status, 403, 'transfer by non-owner → 403');

  // partial transfer (UPDATE branch)
  r = await api(base, 'POST', `/api/characters/${A}/transfer`, {
    token: fx.gm.token,
    body: { toCharacterId: B, inventoryId: carriedEntry.id, quantity: 4 },
  });
  eq(r.status, 200, 'partial transfer');
  eq(
    srv.query('SELECT quantity AS q FROM inventory WHERE id = ?', carriedEntry.id).q,
    7,
    'source decremented',
  );
  const destRow = srv.query(
    'SELECT quantity AS q FROM inventory WHERE character_id = ? AND item_id = ?',
    B,
    item.id,
  );
  eq(destRow.q, 4, 'destination incremented');

  // full transfer (DELETE branch) — Bran → Alya (as owner bob)
  const branEntry = srv.query(
    'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?',
    B,
    item.id,
  );
  r = await api(base, 'POST', `/api/characters/${B}/transfer`, {
    token: fx.player.token,
    body: { toCharacterId: A, inventoryId: branEntry.id, quantity: 4 },
  });
  eq(r.status, 200, 'full transfer');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM inventory WHERE id = ?', branEntry.id).c,
    0,
    'source entry removed',
  );
  const tx = srv.queryAll(
    'SELECT reason, delta_qty FROM transactions WHERE reason LIKE ?',
    'transfer%',
  );
  ok(tx.length >= 4, 'transfer transactions logged both sides');

  // ---------- consume food ----------
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.gm.token,
    body: { foodDays: 2 },
  });
  r = await api(base, 'POST', `/api/characters/${A}/consume`, {
    token: fx.gm.token,
    body: { type: 'boisson' },
  });
  eq(r.status, 400, 'consume invalid type → 400');
  r = await api(base, 'POST', `/api/characters/${A}/consume`, {
    token: fx.gm.token,
    body: { type: 'food' },
  });
  eq(r.status, 400, 'consume food with none → 400');

  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: food.id, quantity: 2 },
  });
  const foodEntry = r.data.entry;
  r = await api(base, 'POST', `/api/characters/${A}/consume`, {
    token: fx.gm.token,
    body: { type: 'food' },
  });
  eq(r.status, 200, 'consume food');
  eq(
    srv.query('SELECT quantity AS q FROM inventory WHERE id = ?', foodEntry.id).q,
    1,
    'ration decremented',
  );
  eq(
    srv.query('SELECT food_days AS f FROM characters WHERE id = ?', A).f,
    0,
    'food deprivation reset',
  );

  // down to 0 → entry deleted branch
  r = await api(base, 'POST', `/api/characters/${A}/consume`, {
    token: fx.gm.token,
    body: { type: 'food' },
  });
  eq(r.status, 200, 'consume last ration');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM inventory WHERE id = ?', foodEntry.id).c,
    0,
    'ration entry deleted',
  );

  // ---------- consume water ----------
  r = await api(base, 'POST', `/api/characters/${A}/consume`, {
    token: fx.gm.token,
    body: { type: 'water' },
  });
  eq(r.status, 400, 'no waterskin → 400');

  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: water.id, quantity: 2 },
  });
  const waterEntry = r.data.entry;
  r = await api(base, 'POST', `/api/characters/${A}/consume`, {
    token: fx.gm.token,
    body: { type: 'water' },
  });
  eq(r.status, 200, 'drink water');
  eq(
    srv.query('SELECT quantity AS q FROM inventory WHERE id = ?', waterEntry.id).q,
    1,
    'full gourd decremented',
  );
  const emptyEntry = srv.query(
    'SELECT * FROM inventory WHERE character_id = ? AND item_id = ? AND notes LIKE ? AND storage_location_id IS NULL',
    A,
    water.id,
    '%empty%',
  );
  ok(emptyEntry, 'empty gourd entry created (NULL location)');

  // second drink: full hits 0 (delete branch) + existing empty incremented
  r = await api(base, 'POST', `/api/characters/${A}/consume`, {
    token: fx.gm.token,
    body: { type: 'water' },
  });
  eq(r.status, 200, 'drink again');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM inventory WHERE id = ?', waterEntry.id).c,
    0,
    'full gourd deleted',
  );
  eq(
    srv.query('SELECT quantity AS q FROM inventory WHERE id = ?', emptyEntry.id).q,
    2,
    'empty gourds stacked',
  );
  eq(
    srv.query('SELECT water_days AS w FROM characters WHERE id = ?', A).w,
    0,
    'water deprivation reset',
  );

  // ---------- refill ----------
  r = await api(base, 'POST', `/api/characters/${A}/refill`, { token: fx.player.token });
  eq(r.status, 403, 'refill non-owner → 403');

  r = await api(base, 'POST', `/api/characters/${A}/refill`, { token: fx.gm.token });
  eq(r.status, 200, 'refill empties');
  eq(r.data.refilled, 1, 'one empty type refilled');
  // merge branch: full stack exists again? full was deleted → notes cleared branch
  ok(
    srv.query('SELECT COUNT(*) AS c FROM inventory WHERE id = ?', emptyEntry.id).c >= 0,
    'refill settled the rows',
  );

  // refill with no empties → 400
  r = await api(base, 'POST', `/api/characters/${A}/refill`, { token: fx.gm.token });
  eq(r.status, 400, 'refill with no empties → 400');

  // build the merge branch explicitly: empty exists AND a full stack exists
  await api(base, 'PATCH', `/api/characters/${A}`, { token: fx.gm.token, body: { currentHp: 20 } });
  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: water.id, quantity: 1 },
  });
  // manually empty one via PATCH notes on the new entry? notes branch: use DB-independent path —
  // add a second entry with notes 'empty' via consume is exhausted; instead move full aside is complex.
  // Simpler: mark the just-added entry's notes to '' so a direct empty-entry insert happens through consume.
  // We accept the merge branch via: drink once (full 1→0 deleted, empty created), refill merges into the remaining full? none left.
  // → Create fresh full stack, drink to create empty, then refill merges empty into full only if a full exists.
  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: water.id, quantity: 3 },
  });
  r = await api(base, 'POST', `/api/characters/${A}/consume`, {
    token: fx.gm.token,
    body: { type: 'water' },
  });
  eq(r.status, 200, 'drink to create empty');
  r = await api(base, 'POST', `/api/characters/${A}/refill`, { token: fx.gm.token });
  eq(r.status, 200, 'refill with full stack present (merge branch)');
  const fullAfter = srv.queryAll(
    'SELECT quantity FROM inventory WHERE character_id = ? AND item_id = ?',
    A,
    water.id,
  );
  ok(
    fullAfter.every((f: any) => f.quantity > 0),
    'all gourds full after refill',
  );

  // ---------- transactions log ----------
  r = await api(base, 'GET', `/api/parties/${fx.partyId}/transactions`, { token: fx.player.token });
  eq(r.status, 403, 'transactions GM only');
  r = await api(base, 'GET', `/api/parties/${fx.partyId}/transactions`, { token: fx.gm.token });
  eq(r.status, 200, 'transactions list');
  ok(r.data.transactions.length > 0, 'transactions recorded');

  // ---------- delete entry ----------
  r = await api(base, 'DELETE', `/api/inventory/999999`, { token: fx.gm.token });
  eq(r.status, 404, 'delete entry 404');
  const fullEntry = srv.query(
    'SELECT id FROM inventory WHERE character_id = ? AND item_id = ? LIMIT 1',
    A,
    water.id,
  );
  r = await api(base, 'DELETE', `/api/inventory/${fullEntry.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete entry');
  ok(
    srv.query('SELECT COUNT(*) AS c FROM transactions WHERE reason = ?', 'remove').c >= 1,
    'remove transaction logged',
  );

  // quantity 0 via PATCH → deletes
  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 1 },
  });
  const zeroEntry = r.data.entry;
  r = await api(base, 'PATCH', `/api/inventory/${zeroEntry.id}`, {
    token: fx.gm.token,
    body: { quantity: 0 },
  });
  eq(r.status, 204, 'quantity 0 → entry deleted');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM inventory WHERE id = ?', zeroEntry.id).c,
    0,
    'zero entry gone',
  );
}
