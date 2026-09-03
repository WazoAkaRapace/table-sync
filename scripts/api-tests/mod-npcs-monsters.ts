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
  ok(r.data.monsters.length > 0, "accent-insensitive 'gobelin' search");

  r = await api(base, 'GET', `/api/monsters?search=${encodeURIComponent('humanoïde')}`, {
    token: fx.gm.token,
  });
  ok(r.data.monsters.length > 0, 'type search');

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
}
