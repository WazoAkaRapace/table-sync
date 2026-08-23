/**
 * Annotations d'exemplaires (dessin/notes sur l'illustration) : la ligne
 * annotée se détache de l'objet de base et pointe une COPIE DÉRIVÉE qui
 * survit aux transferts. Portes (propriétaire/MD/hors-groupe), split qty>1,
 * écrasement sans second niveau, reset re-fusionné, survie au transfert et à
 * la suppression de la base (SET NULL), dérivés cachés de la recherche.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

// 1×1 JPEG header — le serveur ne décode pas, il sniffe les magic bytes.
const TINY_JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const TINY_JPEG_2 = Buffer.concat([
  Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
  Buffer.from('a5a5a5a5a5a5', 'hex'),
  Buffer.from('ffd9', 'hex'),
]);

// Même rotation d'IPs factices que mod-item-images (4xx volontaires).
let ipCounter = 0;
function nextIp(): string {
  ipCounter = (ipCounter % 250) + 1;
  return `198.51.100.${ipCounter}`;
}

async function postAnnotation(
  base: string,
  invId: number,
  token: string,
  buffer: Buffer,
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  form.append('image', new Blob([buffer]), 'annotation.jpg');
  const res = await fetch(`${base}/api/inventory/${invId}/annotation`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-real-ip': nextIp() },
    body: form,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function getImageBytes(
  base: string,
  path: string,
  etag?: string,
): Promise<{ bytes: Buffer | null; etag: string | null; status: number }> {
  const res = await fetch(`${base}${path}`, {
    headers: { 'x-real-ip': nextIp(), ...(etag ? { 'if-none-match': etag } : {}) },
  });
  if (res.status === 304) return { bytes: null, etag: res.headers.get('etag'), status: 304 };
  if (!res.ok) return { bytes: null, etag: null, status: res.status };
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    etag: res.headers.get('etag'),
    status: res.status,
  };
}

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;

  // Crée un objet custom illustré (MD) → renvoie son id.
  async function illustratedItem(name: string): Promise<number> {
    const r = await api(base, 'POST', `/api/parties/${P}/items`, {
      token: fx.gm.token,
      body: { name, description: 'Support d’annotation' },
    });
    eq(r.status, 201, `create ${name}`);
    const id = r.data.item.id;
    const form = new FormData();
    form.append('image', new Blob([TINY_JPEG]), 'illustration.jpg');
    const put = await fetch(`${base}/api/items/${id}/image`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${fx.gm.token}`, 'x-real-ip': nextIp() },
      body: form,
    });
    eq(put.status, 200, `attach image to ${name}`);
    return id;
  }

  // ---------- Dérivation qty=1 : swap d'item, même ligne ----------
  const baseId = await illustratedItem('Lettre annotable');
  const baseBytes = (await getImageBytes(base, `/api/items/${baseId}/image?token=${fx.gm.token}`))
    .bytes;
  ok(!!baseBytes, 'base image served before annotation');

  let r = await api(base, 'POST', `/api/characters/${fx.charBran.id}/inventory`, {
    token: fx.player.token,
    body: { itemId: baseId, quantity: 1 },
  });
  eq(r.status, 201, 'base item added to Bran (qty 1)');
  const invId = r.data.entry.id;

  // Portes : membre non propriétaire, hors-groupe → 403.
  let res = await postAnnotation(base, invId, fx.player2.token, TINY_JPEG);
  eq(res.status, 403, 'non-owner party member → 403');
  res = await postAnnotation(base, invId, fx.outsider.token, TINY_JPEG);
  eq(res.status, 403, 'outsider → 403');
  // Sans illustration, rien à annoter.
  {
    const plain = await api(base, 'POST', `/api/parties/${P}/items`, {
      token: fx.gm.token,
      body: { name: 'Parchemin muet' },
    });
    const added = await api(base, 'POST', `/api/characters/${fx.charBran.id}/inventory`, {
      token: fx.player.token,
      body: { itemId: plain.data.item.id, quantity: 1 },
    });
    const noImg = await postAnnotation(base, added.data.entry.id, fx.player.token, TINY_JPEG);
    eq(noImg.status, 400, 'item without illustration → 400');
  }

  // Propriétaire : dérivation.
  res = await postAnnotation(base, invId, fx.player.token, TINY_JPEG);
  eq(res.status, 200, 'owner annotates → 200');
  const derivedId = res.data.entry.itemId;
  ok(derivedId !== baseId, 'entry now points to the derived copy');
  eq(res.data.entry.id, invId, 'qty 1: same inventory row id (item swap, not a new row)');
  eq(res.data.entry.item.derivedFromItemId, baseId, 'derived item points back to the base');
  eq(res.data.entry.item.hasImage, true, 'derived carries the annotated image');
  ok(existsSync(join(srv.imagesDir, `${derivedId}.jpg`)), 'annotated JPEG written for the derived');
  const derivedRow = srv.query('SELECT party_id, source FROM items WHERE id = ?', derivedId);
  eq(derivedRow.party_id, P, 'derived is anchored to the character party (SRD base is NULL)');
  eq(derivedRow.source, 'custom', 'derived is a custom item');

  // La base est intacte : octets servis identiques, image_url inchangée.
  const baseAfter = (await getImageBytes(base, `/api/items/${baseId}/image?token=${fx.gm.token}`))
    .bytes;
  ok(baseAfter?.equals(baseBytes as Buffer), 'base image bytes untouched by annotation');

  // Le dérivé est invisible de la recherche et du catalogue custom du MD.
  r = await api(base, 'GET', `/api/items?search=${encodeURIComponent('Lettre annotable')}`, {
    token: fx.player.token,
  });
  const ids = (r.data.items as any[]).map((i) => i.id);
  ok(ids.includes(baseId), 'search still finds the base item');
  ok(!ids.includes(derivedId), 'derived copy hidden from item search');
  r = await api(base, 'GET', `/api/items?partyId=${P}&source=custom&limit=200`, {
    token: fx.gm.token,
  });
  ok(
    !(r.data.items as any[]).some((i) => i.id === derivedId),
    'derived copy hidden from the GM custom-items tab',
  );
  // … mais GET /items/:id le sert toujours (la fiche inventaire en dépend).
  r = await api(base, 'GET', `/api/items/${derivedId}`, { token: fx.player.token });
  eq(r.data.item.derivedFromItemId, baseId, 'GET /items/:id still serves the derived');

  // ---------- Écrasement : re-annoter le dérivé reste au même niveau ----------
  res = await postAnnotation(base, invId, fx.player.token, TINY_JPEG_2);
  eq(res.status, 200, 're-annotation of a derived row → 200');
  eq(res.data.entry.itemId, derivedId, 'overwrite keeps the SAME derived (no second level)');
  eq(res.data.entry.item.derivedFromItemId, baseId, 'still derived from the original base');
  const revAfter2nd = res.data.entry.item.imageRev;
  ok(!!revAfter2nd, 'entry payload carries item.imageRev (same shape as the ETag, unquoted)');
  const annotatedBytes = (
    await getImageBytes(base, `/api/items/${derivedId}/image?token=${fx.player.token}`)
  ).bytes;
  ok(annotatedBytes?.equals(TINY_JPEG_2), 'overwrite wrote the new JPEG bytes');

  // ---------- Révalidation ETag : la 2e édition doit être VISIBLE ----------
  // (leçon 2026-08-23 : 'immutable' épinglait la 1e édition dans le cache du
  // navigateur pour un an — la 2e annotation passait mais personne ne la
  // revoyait). Le client revalide : 304 tant que rien n'a changé, octets
  // frais dès que le fichier a été réécrit.
  const first = await getImageBytes(base, `/api/items/${derivedId}/image?token=${fx.player.token}`);
  ok(!!first.etag, 'derived image carries an ETag');
  const revalidated = await getImageBytes(
    base,
    `/api/items/${derivedId}/image?token=${fx.player.token}`,
    first.etag as string,
  );
  eq(revalidated.status, 304, 'If-None-Match with the current ETag → 304 (cache valid)');
  const res3 = await postAnnotation(base, invId, fx.player.token, TINY_JPEG);
  eq(res3.status, 200, 'third edit (re-annotate again)');
  ok(
    !!res3.data.entry.item.imageRev && res3.data.entry.item.imageRev !== revAfter2nd,
    'imageRev CHANGES on each edit — the <img> URL changes, the browser re-requests (leçon 2026-08-23 bis)',
  );
  const fresh = await getImageBytes(
    base,
    `/api/items/${derivedId}/image?token=${fx.player.token}`,
    first.etag as string,
  );
  eq(fresh.status, 200, 'stale ETag after a new edit → 200 with fresh bytes');
  ok(fresh.bytes?.equals(TINY_JPEG), 'the revalidating client sees the LATEST edit');

  // ---------- MD : porte ouverte sur la fiche d'un joueur ----------
  const gmBaseId = await illustratedItem('Plan du donjon');
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/inventory`, {
    token: fx.gm.token,
    body: { itemId: gmBaseId, quantity: 1 },
  });
  res = await postAnnotation(base, r.data.entry.id, fx.gm.token, TINY_JPEG);
  eq(res.status, 200, 'GM annotates a player sheet → 200');

  // ---------- Split qty>1 : la pile reste, l'exemplaire annoté naît à côté ----------
  const splitBaseId = await illustratedItem('Cartes de repérage');
  r = await api(base, 'POST', `/api/characters/${fx.charBran.id}/inventory`, {
    token: fx.player.token,
    body: { itemId: splitBaseId, quantity: 3 },
  });
  const splitInvId = r.data.entry.id;
  const splitLoc = srv.query(
    'SELECT storage_location_id AS loc FROM inventory WHERE id = ?',
    splitInvId,
  ).loc;
  res = await postAnnotation(base, splitInvId, fx.player.token, TINY_JPEG);
  eq(res.status, 200, 'annotating a stack → 200');
  const splitDerivedId = res.data.entry.itemId;
  ok(res.data.entry.id !== splitInvId, 'annotated copy is a NEW row (split)');
  eq(res.data.entry.quantity, 1, 'annotated row carries exactly one copy');
  eq(res.data.entry.equipped, false, 'annotated row is born unequipped');
  eq(res.data.entry.notes, null, 'annotated row is born note-free');
  const pileRow = srv.query('SELECT quantity, item_id FROM inventory WHERE id = ?', splitInvId);
  eq(pileRow.quantity, 2, 'original pile decremented to 2');
  eq(pileRow.item_id, splitBaseId, 'original pile stays on the base item');
  const newRow = srv.query(
    'SELECT storage_location_id AS loc FROM inventory WHERE id = ?',
    res.data.entry.id,
  );
  eq(newRow.loc, splitLoc, 'annotated copy sits at the SAME storage location');

  // ---------- Reset : re-fusion sur la pile de base, dérivé supprimé ----------
  const resetDerivedRow = res.data.entry.id;
  {
    const bad = await api(base, 'POST', `/api/inventory/${splitInvId}/annotation/reset`, {
      token: fx.player.token,
    });
    eq(bad.status, 400, 'reset a non-annotated row → 400');
  }
  r = await api(base, 'POST', `/api/inventory/${resetDerivedRow}/annotation/reset`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'reset the annotated copy → 200');
  eq(r.data.entry.id, splitInvId, 'quantity folded back onto the base row');
  eq(r.data.entry.itemId, splitBaseId, 'merged row points to the base item again');
  eq(r.data.entry.quantity, 3, 'pile restored to 3');
  eq(
    srv.query('SELECT id FROM items WHERE id = ?', splitDerivedId),
    undefined,
    'derived item deleted',
  );
  ok(!existsSync(join(srv.imagesDir, `${splitDerivedId}.jpg`)), 'derived image file unlinked');

  // ---------- Reset sans pile : la ligne reprend simplement la base ----------
  const loneBaseId = await illustratedItem('Billet plié');
  r = await api(base, 'POST', `/api/characters/${fx.charAlya.id}/inventory`, {
    token: fx.gm.token,
    body: { itemId: loneBaseId, quantity: 1 },
  });
  const loneInvId = r.data.entry.id;
  await postAnnotation(base, loneInvId, fx.gm.token, TINY_JPEG);
  r = await api(base, 'POST', `/api/inventory/${loneInvId}/annotation/reset`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'reset without an existing pile → 200');
  eq(r.data.entry.id, loneInvId, 'same row id (item swap back, no merge target)');
  eq(r.data.entry.itemId, loneBaseId, 'row swapped back to the base item');

  // ---------- L'annoté survit au transfert (LE gain du modèle dérivé) ----------
  const beforeTransfer = (
    await getImageBytes(base, `/api/items/${derivedId}/image?token=${fx.player.token}`)
  ).bytes;
  r = await api(base, 'POST', `/api/characters/${fx.charBran.id}/transfer`, {
    token: fx.player.token,
    body: { toCharacterId: fx.charAlya.id, inventoryId: invId, quantity: 1 },
  });
  eq(r.status, 200, 'transfer the annotated copy to Alya');
  r = await api(base, 'GET', `/api/characters/${fx.charAlya.id}/inventory`, {
    token: fx.gm.token,
  });
  const moved = (r.data.entries ?? []).find((e: any) => e.itemId === derivedId);
  ok(!!moved, 'annotated copy lives in Alya inventory after transfer');
  eq(moved.item.derivedFromItemId, baseId, 'still derived after the move');
  const afterTransfer = (
    await getImageBytes(base, `/api/items/${derivedId}/image?token=${fx.gm.token}`)
  ).bytes;
  ok(
    afterTransfer?.equals(beforeTransfer as Buffer),
    'annotated image byte-identical after transfer',
  );

  // ---------- Suppression de la base : le dérivé orphelin vit sa vie ----------
  r = await api(base, 'DELETE', `/api/items/${baseId}`, { token: fx.gm.token });
  eq(r.status, 204, 'GM deletes the base item');
  eq(
    srv.query('SELECT derived_from_item_id AS d FROM items WHERE id = ?', derivedId).d,
    null,
    'derived orphaned via SET NULL',
  );
  r = await api(base, 'GET', `/api/characters/${fx.charAlya.id}/inventory`, {
    token: fx.gm.token,
  });
  const orphan = (r.data.entries ?? []).find((e: any) => e.itemId === derivedId);
  ok(!!orphan, 'inventory row survives the base deletion');
  eq(orphan.item.derivedFromItemId, null, 'orphan no longer claims a base');
  const orphanImg = (
    await getImageBytes(base, `/api/items/${derivedId}/image?token=${fx.gm.token}`)
  ).bytes;
  ok(orphanImg?.equals(afterTransfer as Buffer), 'orphan derived still serves its annotated image');
  // Base disparue → plus rien à reset-er.
  {
    const reset = await api(base, 'POST', `/api/inventory/${moved.id}/annotation/reset`, {
      token: fx.gm.token,
    });
    eq(reset.status, 400, 'reset an orphaned derived → 400 (base gone)');
  }
}
