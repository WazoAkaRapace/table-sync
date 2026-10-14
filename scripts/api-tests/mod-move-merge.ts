/**
 * Déplacement d'emplacement avec fusion (bug joueurs 2026-10) : PATCH
 * /inventory/:id avec storageLocationId vers un emplacement qui TIENT
 * DÉJÀ le même objet explosait la contrainte UNIQUE (character_id, item_id,
 * storage_location_id) en 500. Le chemin dédié FUSIONNE les quantités à
 * l'arrivée (même dialecte upsert que POST /inventory) ; moveQuantity
 * déplace une PARTIE seulement (le reste reste à l'origine).
 *
 * Perso dédié (pas Alya) : les modules partagent une seule base et
 * mod-inventory / mod-container-transfer lisent le même item du seed chez
 * Alya — polluer son inventaire casse leurs assertions en aval.
 */
import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  // Perso vierge porté par alice (GM de la fixture)
  const C = (await createCharacter(base, fx.gm.token, fx.partyId, { name: 'Muvharis', maxHp: 10 }))
    .id;

  // Emplacements : porté (auto) + un conteneur
  let r = await api(base, 'GET', `/api/characters/${C}/inventory`, { token: fx.gm.token });
  eq(r.status, 200, 'inventory read');
  const carried = r.data.locations.find((l: any) => l.type === 'carried');
  ok(carried, 'carried location auto-created');
  r = await api(base, 'POST', `/api/characters/${C}/locations`, {
    token: fx.gm.token,
    body: { name: 'Coffre', type: 'container', capacityKg: 50, ownWeightKg: 5 },
  });
  eq(r.status, 201, 'container created');
  const box = r.data.location;

  const item = srv.query('SELECT id FROM items ORDER BY id LIMIT 1');

  // ---------- LE bug : destination tient déjà le même objet ----------
  r = await api(base, 'POST', `/api/characters/${C}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 4 },
  });
  eq(r.status, 201, 'source seeded on carried');
  const src = r.data.entry;
  r = await api(base, 'POST', `/api/characters/${C}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 3, storageLocationId: box.id },
  });
  eq(r.status, 201, 'duplicate seeded in the box');

  r = await api(base, 'PATCH', `/api/inventory/${src.id}`, {
    token: fx.gm.token,
    body: { storageLocationId: box.id },
  });
  eq(r.status, 200, 'move onto duplicate → 200 (was 500 UNIQUE constraint)');
  eq(r.data.entry.storageLocationId, box.id, 'entry landed in the box');
  eq(r.data.entry.quantity, 7, 'quantities merged at destination (4 + 3)');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM inventory WHERE id = ?', src.id).c,
    0,
    'source row gone (full move)',
  );

  // ---------- moveQuantity : déplacement partiel ----------
  r = await api(base, 'POST', `/api/characters/${C}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 5 },
  });
  const partialSrc = r.data.entry; // sur le porté
  r = await api(base, 'PATCH', `/api/inventory/${partialSrc.id}`, {
    token: fx.gm.token,
    body: { storageLocationId: box.id, moveQuantity: 2 },
  });
  eq(r.status, 200, 'partial move accepted');
  eq(r.data.entry.quantity, 9, 'destination merged (7 + 2)');
  eq(
    srv.query('SELECT quantity AS q FROM inventory WHERE id = ?', partialSrc.id).q,
    3,
    'source kept the remainder',
  );

  // moveQuantity au-delà de la quantité → tout part (clamp)
  r = await api(base, 'PATCH', `/api/inventory/${partialSrc.id}`, {
    token: fx.gm.token,
    body: { storageLocationId: box.id, moveQuantity: 99 },
  });
  eq(r.status, 200, 'over-quantity move clamped');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM inventory WHERE id = ?', partialSrc.id).c,
    0,
    'source gone after moving everything',
  );

  // ---------- bornes ----------
  r = await api(base, 'POST', `/api/characters/${C}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 1 },
  });
  const boundSrc = r.data.entry;
  r = await api(base, 'PATCH', `/api/inventory/${boundSrc.id}`, {
    token: fx.gm.token,
    body: { storageLocationId: 999999 },
  });
  eq(r.status, 400, 'unknown location → 400');

  // emplacement d'un AUTRE personnage → 400 (jamais de saut de fiche)
  r = await api(base, 'POST', `/api/characters/${fx.charBran.id}/locations`, {
    token: fx.gm.token,
    body: { name: 'Sac à Bran', type: 'container' },
  });
  eq(r.status, 201, 'foreign location created');
  const foreignLoc = r.data.location;
  r = await api(base, 'POST', `/api/characters/${C}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 1 },
  });
  const foreignSrc = r.data.entry;
  r = await api(base, 'PATCH', `/api/inventory/${foreignSrc.id}`, {
    token: fx.gm.token,
    body: { storageLocationId: foreignLoc.id },
  });
  eq(r.status, 400, 'move to another character location → 400');

  // move vers le MÊME emplacement : inchangé (pas de doublon, pas de perte)
  r = await api(base, 'POST', `/api/characters/${C}/inventory`, {
    token: fx.gm.token,
    body: { itemId: item.id, quantity: 1 },
  });
  const sameSrc = r.data.entry;
  r = await api(base, 'PATCH', `/api/inventory/${sameSrc.id}`, {
    token: fx.gm.token,
    body: { storageLocationId: sameSrc.storageLocationId },
  });
  eq(r.status, 200, 'same-location move is a no-op PATCH');
  eq(r.data.entry.quantity, sameSrc.quantity, 'quantity untouched');
}
