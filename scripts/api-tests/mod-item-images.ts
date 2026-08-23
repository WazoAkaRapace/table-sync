/**
 * Item illustrations: multipart PUT (same door as custom-item creation — GM
 * always, players when the party allows), public token'd GET (like /ws), GM
 * DELETE, and the responsiveness contract: payloads carry ONLY the derived
 * hasImage boolean — image bytes never ride in JSON.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

// 1×1 JPEG — minimal payload with a valid ffd8 magic header for the sniff gate.
const TINY_JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

// The harness api() helper only speaks JSON — raw fetch wrappers for the
// multipart PUT and the binary GET, with the same rotating fake IPs (the
// error-scoped rate limiter counts our deliberate 4xx probes).
let ipCounter = 0;
function nextIp(): string {
  ipCounter = (ipCounter % 250) + 1;
  return `198.51.100.${ipCounter}`;
}

interface RawResponse {
  status: number;
  headers: Headers;
  bytes: Buffer | null;
}

async function putImage(
  base: string,
  itemId: number,
  token: string,
  buffer: Buffer,
): Promise<{ status: number; data: any }> {
  const form = new FormData();
  form.append('image', new Blob([buffer]), 'illustration.jpg');
  const res = await fetch(`${base}/api/items/${itemId}/image`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'x-real-ip': nextIp() },
    body: form,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function getImage(base: string, path: string): Promise<RawResponse> {
  const res = await fetch(`${base}${path}`, { headers: { 'x-real-ip': nextIp() } });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    headers: res.headers,
    bytes: buf.length > 0 && res.headers.get('content-type')?.startsWith('image/') ? buf : null,
  };
}

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;

  // mod-items leaves playersCreateItems OFF — the state our 403 probes rely on.
  let r = await api(base, 'PATCH', `/api/parties/${P}`, {
    token: fx.gm.token,
    body: { playersCreateItems: false },
  });
  eq(r.status, 200, 'players item creation off');

  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: { name: 'Carte du marais', description: 'Un croquis à l’encre séchée' },
  });
  eq(r.status, 201, 'create the illustrated item');
  const itemId = r.data.item.id;
  eq(r.data.item.hasImage, false, 'fresh item has no image');

  // ---------- PUT: the creation door ----------
  let res = await putImage(base, itemId, fx.player.token, TINY_JPEG);
  eq(res.status, 403, 'player PUT image → 403 when the party forbids creation');

  res = await putImage(base, itemId, fx.outsider.token, TINY_JPEG);
  eq(res.status, 403, 'non-member PUT image → 403');

  const srdId = srv.query("SELECT id FROM items WHERE source = 'srd' LIMIT 1").id;
  res = await putImage(base, srdId, fx.gm.token, TINY_JPEG);
  eq(res.status, 403, 'cannot attach an image to an SRD item');

  res = await putImage(
    base,
    itemId,
    fx.gm.token,
    Buffer.concat([TINY_JPEG, Buffer.alloc(2 * 1024 * 1024 + 8, 0x61)]),
  );
  eq(res.status, 413, 'oversized image (> 2 MB) → 413');

  res = await putImage(base, itemId, fx.gm.token, Buffer.from('ceci nest pas une image', 'utf8'));
  eq(res.status, 400, 'non-image bytes → 400');

  res = await putImage(base, itemId, fx.gm.token, TINY_JPEG);
  eq(res.status, 200, 'GM PUT image ok');
  eq(res.data.ok, true, 'PUT returns ok');
  ok(existsSync(join(srv.imagesDir, `${itemId}.jpg`)), 'image file written to the images dir');

  // ---------- hasImage flips, bytes never ride in JSON ----------
  r = await api(base, 'GET', `/api/items/${itemId}`, { token: fx.gm.token });
  eq(r.data.item.hasImage, true, 'GET /items/:id hasImage true');
  ok(!('imageUrl' in r.data.item) && !('image_url' in r.data.item), 'no image path in payload');

  r = await api(base, 'GET', `/api/items?partyId=${P}&source=custom&limit=200`, {
    token: fx.gm.token,
  });
  const listed = r.data.items.find((i: any) => i.id === itemId);
  ok(listed?.hasImage === true, 'list payload carries hasImage');

  r = await api(base, 'POST', `/api/characters/${fx.charBran.id}/inventory`, {
    token: fx.player.token,
    body: { itemId, quantity: 1 },
  });
  eq(r.status, 201, 'illustrated item added to inventory');
  r = await api(base, 'GET', `/api/characters/${fx.charBran.id}/inventory`, {
    token: fx.player.token,
  });
  const entry = (r.data.entries ?? []).find((e: any) => e.itemId === itemId);
  ok(entry?.item?.hasImage === true, 'inventory payload carries hasImage');

  // ---------- GET: public token'd route ----------
  let img = await getImage(base, `/api/items/${itemId}/image?token=${fx.player.token}`);
  eq(img.status, 200, 'GET image with valid token');
  eq(img.headers.get('content-type'), 'image/jpeg', 'image served as image/jpeg');
  eq(
    img.headers.get('cache-control'),
    'private, no-cache',
    'image served private with revalidation (ETag) — content can change on the same URL',
  );
  ok(!!img.headers.get('etag'), 'image served with an ETag');
  ok(img.bytes?.equals(TINY_JPEG), 'image bytes round-trip identically');

  img = await getImage(base, `/api/items/${itemId}/image`);
  eq(img.status, 401, 'GET image without token → 401');

  img = await getImage(base, `/api/items/${itemId}/image?token=not-a-jwt`);
  eq(img.status, 401, 'GET image with bad token → 401');

  img = await getImage(base, `/api/items/999999/image?token=${fx.gm.token}`);
  eq(img.status, 404, 'GET image unknown item → 404');

  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.gm.token,
    body: { name: 'Sacoche vide' },
  });
  img = await getImage(base, `/api/items/${r.data.item.id}/image?token=${fx.gm.token}`);
  eq(img.status, 404, 'GET image for item without image → 404');

  img = await getImage(base, `/api/items/${itemId}/image?token=${fx.outsider.token}`);
  eq(img.status, 403, 'GET image by non-member → 403 (custom items stay in-party)');

  // ---------- players CAN attach when the party allows (same door as creation) ----------
  r = await api(base, 'PATCH', `/api/parties/${P}`, {
    token: fx.gm.token,
    body: { playersCreateItems: true },
  });
  eq(r.status, 200, 'players item creation re-enabled');
  r = await api(base, 'POST', `/api/parties/${P}/items`, {
    token: fx.player.token,
    body: { name: 'Lettre du duc' },
  });
  eq(r.status, 201, 'player creates an item when allowed');
  const playerItemId = r.data.item.id;
  res = await putImage(base, playerItemId, fx.player.token, TINY_JPEG);
  eq(res.status, 200, 'player PUT image follows the creation gate');

  // ---------- DELETE ----------
  {
    const del = await fetch(`${base}/api/items/${playerItemId}/image`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${fx.outsider.token}`, 'x-real-ip': nextIp() },
    });
    eq(del.status, 403, 'non-member DELETE image → 403');
  }
  {
    const del = await fetch(`${base}/api/items/${playerItemId}/image`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${fx.gm.token}`, 'x-real-ip': nextIp() },
    });
    eq(del.status, 200, 'GM DELETE image ok');
    eq((await del.json()).ok, true, 'DELETE returns ok');
  }
  ok(!existsSync(join(srv.imagesDir, `${playerItemId}.jpg`)), 'image file removed');
  r = await api(base, 'GET', `/api/items/${playerItemId}`, { token: fx.player.token });
  eq(r.data.item.hasImage, false, 'hasImage back to false after DELETE');
  img = await getImage(base, `/api/items/${playerItemId}/image?token=${fx.gm.token}`);
  eq(img.status, 404, 'GET image after DELETE → 404');

  // ---------- item deletion cleans the file up ----------
  res = await putImage(base, playerItemId, fx.gm.token, TINY_JPEG);
  eq(res.status, 200, 're-attach image before item deletion');
  r = await api(base, 'DELETE', `/api/items/${playerItemId}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete the item');
  ok(!existsSync(join(srv.imagesDir, `${playerItemId}.jpg`)), 'item deletion removes the file');

  // Restore the state mod-items left behind (creation off).
  r = await api(base, 'PATCH', `/api/parties/${P}`, {
    token: fx.gm.token,
    body: { playersCreateItems: false },
  });
  eq(r.status, 200, 'players item creation restored to off');
}
