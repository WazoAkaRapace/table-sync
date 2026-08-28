/**
 * Auth + parties: register/login/me/logout, party CRUD, join/remove/ban/unban,
 * last-opened register ordering (/parties/:id/open).
 * Covers every .prepare site in routes/auth.ts and routes/parties.ts.
 */
import {
  api,
  createCharacter,
  createParty,
  eq,
  type Fixtures,
  mintToken,
  ok,
  registerUser,
  type ServerHandle,
} from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  // ---------- auth ----------
  const eve = await registerUser(base, 'eve');

  let r = await api(base, 'POST', '/api/auth/register', {
    body: {
      username: 'eve',
      password: 'password123',
      displayName: 'EVE',
      email: 'eve.autre@example.com',
    },
  });
  eq(r.status, 409, 'duplicate register → 409');

  r = await api(base, 'POST', '/api/auth/register', { body: { username: 'x' } });
  eq(r.status, 400, 'register missing fields → 400');

  // — email : requis à l'inscription, validé, unique (normalisé minuscules) —
  r = await api(base, 'POST', '/api/auth/register', {
    body: { username: 'sans-email', password: 'password123', displayName: 'SANS' },
  });
  eq(r.status, 400, 'register without email → 400');

  r = await api(base, 'POST', '/api/auth/register', {
    body: {
      username: 'email-invalide',
      password: 'password123',
      displayName: 'BAD',
      email: 'pas-un-email',
    },
  });
  eq(r.status, 400, 'register invalid email → 400');

  r = await api(base, 'POST', '/api/auth/register', {
    body: {
      username: 'email-clash',
      password: 'password123',
      displayName: 'CLASH',
      email: 'EVE@example.com',
    },
  });
  eq(r.status, 409, 'register duplicate email (insensible à la casse) → 409');

  r = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'eve', password: 'password123' },
  });
  eq(r.status, 200, 'login ok');
  ok(r.data.token, 'login returns a token');

  r = await api(base, 'POST', '/api/auth/login', { body: { username: 'eve', password: 'wrong!' } });
  eq(r.status, 401, 'login wrong password → 401');

  r = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'ghost', password: 'nope1' },
  });
  eq(r.status, 401, 'login unknown user → 401');

  r = await api(base, 'GET', '/api/auth/me', { token: eve.token });
  eq(r.status, 200, 'me ok');
  eq(r.data.user.username, 'eve', 'me returns the user');
  eq(r.data.user.email, 'eve@example.com', 'me returns the normalized email');

  r = await api(base, 'GET', '/api/auth/me', { token: mintToken(999_999) });
  eq(r.status, 404, 'me with forged token for deleted user → 404');

  r = await api(base, 'GET', '/api/auth/me', {});
  eq(r.status, 401, 'me without token → 401');

  r = await api(base, 'POST', '/api/auth/logout', { token: eve.token });
  eq(r.status, 204, 'logout → 204');

  // ---------- profil : PATCH /api/auth/me (nom affiché + email) ----------
  r = await api(base, 'PATCH', '/api/auth/me', {
    token: eve.token,
    body: { displayName: 'Ève la Roublarde' },
  });
  eq(r.status, 200, 'patch me displayName → 200');
  eq(r.data.user.displayName, 'Ève la Roublarde', 'patch me returns the new displayName');

  r = await api(base, 'PATCH', '/api/auth/me', { token: eve.token, body: { displayName: '   ' } });
  eq(r.status, 400, 'patch me blank displayName → 400');

  r = await api(base, 'PATCH', '/api/auth/me', {
    token: eve.token,
    body: { email: 'eve.perso@example.com' },
  });
  eq(r.status, 200, 'patch me email → 200');
  eq(r.data.user.email, 'eve.perso@example.com', 'patch me returns the new email');

  r = await api(base, 'PATCH', '/api/auth/me', {
    token: eve.token,
    body: { email: 'EVE.PERSO@EXAMPLE.COM' },
  });
  eq(r.status, 200, 'patch me same email other case → 200 (pas d’autocollision)');

  r = await api(base, 'PATCH', '/api/auth/me', {
    token: eve.token,
    body: { email: 'pas-un-email' },
  });
  eq(r.status, 400, 'patch me invalid email → 400');

  r = await api(base, 'PATCH', '/api/auth/me', {
    token: eve.token,
    body: { email: `${fx.gm.username}@example.com` },
  });
  eq(r.status, 409, 'patch me email taken by another user → 409');

  r = await api(base, 'PATCH', '/api/auth/me', { token: eve.token, body: { email: '' } });
  eq(r.status, 200, 'patch me clear email → 200');
  eq(r.data.user.email, null, 'cleared email is null');

  r = await api(base, 'PATCH', '/api/auth/me', { token: eve.token, body: {} });
  eq(r.status, 400, 'patch me empty body → 400');

  r = await api(base, 'PATCH', '/api/auth/me', {});
  eq(r.status, 401, 'patch me without token → 401');

  // ---------- mot de passe : POST /api/auth/password ----------
  const zora = await registerUser(base, 'zora');

  r = await api(base, 'POST', '/api/auth/password', {
    token: zora.token,
    body: { currentPassword: 'faux', newPassword: 'nouveau-secret-1' },
  });
  eq(r.status, 400, 'password wrong current → 400');

  r = await api(base, 'POST', '/api/auth/password', {
    token: zora.token,
    body: { currentPassword: 'password123', newPassword: 'abc' },
  });
  eq(r.status, 400, 'password short new → 400');

  r = await api(base, 'POST', '/api/auth/password', {
    token: zora.token,
    body: { newPassword: 'abc' },
  });
  eq(r.status, 400, 'password missing current → 400');

  r = await api(base, 'POST', '/api/auth/password', {
    token: zora.token,
    body: { currentPassword: 'password123', newPassword: 'nouveau-secret-1' },
  });
  eq(r.status, 200, 'password change → 200');

  r = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'zora', password: 'password123' },
  });
  eq(r.status, 401, 'login old password after change → 401');

  r = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'zora', password: 'nouveau-secret-1' },
  });
  eq(r.status, 200, 'login new password after change → 200');

  // ---------- parties: list / create / detail ----------
  r = await api(base, 'GET', '/api/parties', { token: fx.gm.token });
  eq(r.status, 200, 'list parties (GM)');
  const mine = r.data.parties.filter((p: any) => p.id === fx.partyId);
  eq(mine.length, 1, 'GM sees the test party');
  ok(mine[0].inviteCode, 'party carries invite code');
  eq(
    mine[0].inviteCode.length,
    6,
    'invite code is exactly 6 chars (matches the join input maxLength)',
  );
  // Hidden Ombre: GM sees it in characterNames
  ok(mine[0].characterNames.includes('Ombre'), 'GM sees hidden character name');

  r = await api(base, 'GET', '/api/parties', { token: fx.player.token });
  const bobParty = r.data.parties.find((p: any) => p.id === fx.partyId);
  ok(bobParty, 'bob sees the party');
  ok(!bobParty.characterNames.includes('Ombre'), "hidden character filtered from bob's roster");

  r = await api(base, 'POST', '/api/parties', { token: fx.gm.token, body: { name: '' } });
  eq(r.status, 400, 'create party empty name → 400');

  r = await api(base, 'POST', '/api/parties', {
    token: fx.gm.token,
    body: { name: 'Second', encumbranceMode: 'bogus' },
  });
  eq(r.status, 201, 'create second party (invalid mode falls back)');
  eq(r.data.party.encumbranceMode, 'variant', 'invalid encumbranceMode falls back to variant');

  r = await api(base, 'GET', `/api/parties/${fx.partyId}`, { token: fx.gm.token });
  eq(r.status, 200, 'party detail (GM)');
  eq(r.data.members.length, 2, 'alice + bob are members');
  ok(
    r.data.characters.some((c: any) => c.name === 'Ombre'),
    'GM detail shows hidden char',
  );

  r = await api(base, 'GET', `/api/parties/${fx.partyId}`, { token: fx.player.token });
  ok(!r.data.characters.some((c: any) => c.name === 'Ombre'), 'player detail hides hidden char');

  r = await api(base, 'GET', `/api/parties/${fx.partyId}`, { token: fx.outsider.token });
  eq(r.status, 403, 'party detail non-member → 403');

  r = await api(base, 'GET', '/api/parties/999999', { token: fx.gm.token });
  eq(r.status, 403, 'party detail unknown party → 403 (member check first)');

  // ---------- join ----------
  r = await api(base, 'POST', '/api/parties/join', {
    token: fx.player.token,
    body: { inviteCode: 'ZZZZZZ' },
  });
  eq(r.status, 404, 'join invalid code → 404');

  r = await api(base, 'POST', '/api/parties/join', {
    token: fx.player.token,
    body: { inviteCode: fx.inviteCode },
  });
  eq(r.status, 409, 'rejoin while member → 409');

  r = await api(base, 'POST', '/api/parties/join', {
    token: fx.player2.token,
    body: { inviteCode: fx.inviteCode.toLowerCase() },
  });
  eq(r.status, 201, 'carol joins (lowercase code normalized)');
  eq(r.data.partyId, fx.partyId, 'join returns party id');

  // ---------- remove member ----------
  r = await api(base, 'DELETE', `/api/parties/${fx.partyId}/members/${fx.player2.userId}`, {
    token: fx.player.token,
  });
  eq(r.status, 403, 'remove member by non-GM → 403');

  r = await api(base, 'DELETE', `/api/parties/${fx.partyId}/members/${fx.gm.userId}`, {
    token: fx.gm.token,
  });
  eq(r.status, 403, 'cannot remove the GM');

  r = await api(base, 'DELETE', `/api/parties/${fx.partyId}/members/999999`, {
    token: fx.gm.token,
  });
  eq(r.status, 404, 'remove unknown member → 404');

  r = await api(base, 'DELETE', `/api/parties/${fx.partyId}/members/${fx.player2.userId}`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'GM removes carol');

  // ---------- bans ----------
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/bans`, {
    token: fx.gm.token,
    body: { userId: 999999 },
  });
  eq(r.status, 404, 'ban non-member → 404');

  r = await api(base, 'POST', `/api/parties/${fx.partyId}/bans`, {
    token: fx.gm.token,
    body: { userId: fx.gm.userId },
  });
  eq(r.status, 403, 'cannot ban the GM');

  r = await api(base, 'POST', `/api/parties/${fx.partyId}/bans`, {
    token: fx.player.token,
    body: { userId: eve.userId },
  });
  eq(r.status, 403, 'ban by non-GM → 403');

  r = await api(base, 'POST', `/api/parties/${fx.partyId}/bans`, {
    token: fx.gm.token,
    body: { userId: eve.userId },
  });
  eq(r.status, 404, 'ban a non-member (eve not joined yet) → 404');

  // eve joins, then gets banned
  r = await api(base, 'POST', '/api/parties/join', {
    token: eve.token,
    body: { inviteCode: fx.inviteCode },
  });
  eq(r.status, 201, 'eve joins');
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/bans`, {
    token: fx.gm.token,
    body: { userId: eve.userId },
  });
  eq(r.status, 201, 'GM bans eve');
  const banRow = srv.query(
    'SELECT * FROM party_bans WHERE party_id = ? AND user_id = ?',
    fx.partyId,
    eve.userId,
  );
  ok(banRow, 'party_bans row exists');

  r = await api(base, 'GET', `/api/parties/${fx.partyId}`, { token: fx.gm.token });
  eq(r.data.banned.length, 1, 'party detail lists bans');

  r = await api(base, 'POST', '/api/parties/join', {
    token: eve.token,
    body: { inviteCode: fx.inviteCode },
  });
  eq(r.status, 403, 'banned eve cannot rejoin');

  r = await api(base, 'DELETE', `/api/parties/${fx.partyId}/bans/${eve.userId}`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'GM unbans eve');

  r = await api(base, 'DELETE', `/api/parties/${fx.partyId}/bans/${eve.userId}`, {
    token: fx.gm.token,
  });
  eq(r.status, 404, 'unban not-banned → 404');

  r = await api(base, 'POST', '/api/parties/join', {
    token: eve.token,
    body: { inviteCode: fx.inviteCode },
  });
  eq(r.status, 201, 'eve rejoins after unban');

  // ---------- last-opened ordering (the register pins the last OPENED group first) ----------
  // datetime('now') has 1s resolution: pause a second so the open below is
  // strictly newer than Troisième's created_at (the createdAt DESC tiebreak
  // would otherwise decide, making the assert flaky).
  const third = await createParty(base, eve.token, 'Troisième');
  r = await api(base, 'GET', '/api/parties', { token: eve.token });
  eq(r.data.parties[0].id, third.id, 'never-opened: newest created party leads');

  await new Promise((res) => setTimeout(res, 1100));
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/open`, { token: eve.token });
  eq(r.status, 200, 'open party → 200');
  eq(r.data.ok, true, 'open returns ok');
  ok(
    srv.query(
      'SELECT last_opened_at AS t FROM party_members WHERE party_id = ? AND user_id = ?',
      fx.partyId,
      eve.userId,
    ).t,
    'party_members.last_opened_at recorded',
  );
  r = await api(base, 'GET', '/api/parties', { token: eve.token });
  eq(r.data.parties[0].id, fx.partyId, 'opening an older party promotes it to the top');

  r = await api(base, 'POST', `/api/parties/${third.id}/open`, { token: eve.token });
  eq(r.status, 200, 're-open → 200');
  r = await api(base, 'GET', '/api/parties', { token: eve.token });
  eq(r.data.parties[0].id, third.id, 'the last opened party takes the lead');

  // Joining counts as an open — the freshly joined table leads the register.
  const fourth = await createParty(base, fx.gm.token, 'Quatrième');
  r = await api(base, 'POST', '/api/parties/join', {
    token: eve.token,
    body: { inviteCode: fourth.inviteCode },
  });
  eq(r.status, 201, 'eve joins the fourth party');
  r = await api(base, 'GET', '/api/parties', { token: eve.token });
  eq(r.data.parties[0].id, fourth.id, 'join bumps the party to the top');

  r = await api(base, 'POST', `/api/parties/${fx.partyId}/open`, { token: fx.outsider.token });
  eq(r.status, 403, 'open by non-member → 403');
  r = await api(base, 'POST', `/api/parties/${fx.partyId}/open`, {});
  eq(r.status, 401, 'open without token → 401');

  // eve cleanup: remove again so later modules see alice+bob+eve… keep eve, harmless.

  // ---------- patch party ----------
  r = await api(base, 'PATCH', `/api/parties/${fx.partyId}`, {
    token: fx.player.token,
    body: { name: 'Nope' },
  });
  eq(r.status, 403, 'patch party by non-GM → 403');

  r = await api(base, 'PATCH', `/api/parties/${fx.partyId}`, {
    token: fx.gm.token,
    body: { name: ' ' },
  });
  eq(r.status, 400, 'patch party empty name → 400');

  r = await api(base, 'PATCH', `/api/parties/${fx.partyId}`, {
    token: fx.gm.token,
    body: { encumbranceMode: 'pouet' },
  });
  eq(r.status, 400, 'patch party invalid mode → 400');

  r = await api(base, 'PATCH', `/api/parties/${fx.partyId}`, {
    token: fx.gm.token,
    body: { playersCreateItems: 'oui' },
  });
  eq(r.status, 400, 'patch party playersCreateItems non-boolean → 400');

  r = await api(base, 'PATCH', `/api/parties/${fx.partyId}`, {
    token: fx.gm.token,
    body: { name: 'Compagnie Renommée', encumbranceMode: 'standard' },
  });
  eq(r.status, 200, 'patch party name + mode');
  eq(r.data.party.name, 'Compagnie Renommée', 'name updated');
  eq(r.data.party.encumbranceMode, 'standard', 'mode updated');

  // playersCreateItems toggle: roundtrip + persisted in the party detail
  r = await api(base, 'PATCH', `/api/parties/${fx.partyId}`, {
    token: fx.gm.token,
    body: { playersCreateItems: false },
  });
  eq(r.status, 200, 'patch party playersCreateItems off');
  eq(r.data.party.playersCreateItems, false, 'playersCreateItems updated');
  r = await api(base, 'GET', `/api/parties/${fx.partyId}`, { token: fx.gm.token });
  eq(r.data.party.playersCreateItems, false, 'playersCreateItems persisted in detail');
  r = await api(base, 'PATCH', `/api/parties/${fx.partyId}`, {
    token: fx.gm.token,
    body: { playersCreateItems: true },
  });
  eq(r.data.party.playersCreateItems, true, 'playersCreateItems re-enabled');

  // ---------- disband party (GM only) — cascade deletes everything ----------
  // Throwaway party owned by eve — fx.partyId must survive for later modules.
  const doomed = await createParty(base, eve.token, 'Groupe Éphémère');
  r = await api(base, 'POST', '/api/parties/join', {
    token: fx.player2.token,
    body: { inviteCode: doomed.inviteCode },
  });
  eq(r.status, 201, 'carol joins the doomed party');

  const doomedChar = await createCharacter(base, eve.token, doomed.id, {
    name: 'Fantoche',
    maxHp: 8,
    classes: [{ classKey: 'Magicien', level: 1 }],
  });
  r = await api(base, 'POST', `/api/parties/${doomed.id}/items`, {
    token: eve.token,
    body: { name: 'Relique éphémère' },
  });
  eq(r.status, 201, 'doomed custom item created');
  const doomedItem = r.data.item;
  r = await api(base, 'POST', `/api/characters/${doomedChar.id}/inventory`, {
    token: eve.token,
    body: { itemId: doomedItem.id, quantity: 2 },
  });
  eq(r.status, 201, 'doomed inventory entry (creates a transaction)');
  r = await api(base, 'POST', `/api/parties/${doomed.id}/npcs`, {
    token: eve.token,
    body: { name: 'Guide perdu' },
  });
  eq(r.status, 201, 'doomed npc created');
  r = await api(base, 'POST', `/api/parties/${doomed.id}/encounters`, {
    token: eve.token,
    body: { name: 'Embuscade finale' },
  });
  eq(r.status, 201, 'doomed encounter created');
  const doomedEnc = r.data.encounter;
  const anyMonsterSlug = srv.query('SELECT slug FROM monsters LIMIT 1')?.slug;
  r = await api(base, 'POST', `/api/encounters/${doomedEnc.id}/combatants/monster`, {
    token: eve.token,
    body: { monsterSlug: anyMonsterSlug },
  });
  eq(r.status, 201, 'doomed monster combatant added');
  r = await api(base, 'POST', `/api/parties/${doomed.id}/bans`, {
    token: eve.token,
    body: { userId: fx.player2.userId },
  });
  eq(r.status, 201, 'carol banned from the doomed party (party_bans row)');

  // Pre-check: the doomed party really owns rows everywhere we assert below.
  eq(
    srv.query('SELECT COUNT(*) AS n FROM character_classes WHERE character_id = ?', doomedChar.id)
      .n,
    1,
    'doomed character has its class line',
  );
  ok(
    srv.query('SELECT 1 AS x FROM transactions WHERE party_id = ?', doomed.id),
    'doomed transaction exists',
  );

  // Permissions: GM only.
  r = await api(base, 'DELETE', `/api/parties/${doomed.id}`, {});
  eq(r.status, 401, 'disband without token → 401');
  r = await api(base, 'DELETE', `/api/parties/${doomed.id}`, { token: fx.player.token });
  eq(r.status, 403, 'disband by non-GM → 403');
  r = await api(base, 'DELETE', '/api/parties/999999', { token: eve.token });
  eq(r.status, 404, 'disband unknown party → 404');

  r = await api(base, 'DELETE', `/api/parties/${doomed.id}`, { token: eve.token });
  eq(r.status, 204, 'GM disbands → 204');

  // Cascade: every party-scoped table emptied for the doomed party.
  eq(srv.query('SELECT COUNT(*) AS n FROM parties WHERE id = ?', doomed.id).n, 0, 'party gone');
  eq(
    srv.query('SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?', doomed.id).n,
    0,
    'members gone',
  );
  eq(
    srv.query('SELECT COUNT(*) AS n FROM party_bans WHERE party_id = ?', doomed.id).n,
    0,
    'bans gone',
  );
  eq(
    srv.query('SELECT COUNT(*) AS n FROM characters WHERE party_id = ?', doomed.id).n,
    0,
    'characters gone',
  );
  eq(
    srv.query('SELECT COUNT(*) AS n FROM character_classes WHERE character_id = ?', doomedChar.id)
      .n,
    0,
    'class lines gone',
  );
  eq(
    srv.query('SELECT COUNT(*) AS n FROM inventory WHERE character_id = ?', doomedChar.id).n,
    0,
    'inventory gone',
  );
  eq(
    srv.query('SELECT COUNT(*) AS n FROM items WHERE party_id = ?', doomed.id).n,
    0,
    'custom items gone',
  );
  eq(srv.query('SELECT COUNT(*) AS n FROM npcs WHERE party_id = ?', doomed.id).n, 0, 'npcs gone');
  eq(
    srv.query('SELECT COUNT(*) AS n FROM transactions WHERE party_id = ?', doomed.id).n,
    0,
    'transactions gone',
  );
  eq(
    srv.query('SELECT COUNT(*) AS n FROM encounters WHERE party_id = ?', doomed.id).n,
    0,
    'encounters gone',
  );
  eq(
    srv.query('SELECT COUNT(*) AS n FROM combatants WHERE encounter_id = ?', doomedEnc.id).n,
    0,
    'combatants gone',
  );
  eq(
    srv.query('SELECT COUNT(*) AS n FROM character_spells WHERE character_id = ?', doomedChar.id).n,
    0,
    'character spells gone',
  );

  // The fixture party survives untouched, and the dead invite code is inert.
  ok(srv.query('SELECT 1 AS x FROM parties WHERE id = ?', fx.partyId), 'fixture party survives');
  eq(
    srv.query('SELECT COUNT(*) AS n FROM characters WHERE party_id = ?', fx.partyId).n,
    3,
    'fixture characters survive',
  );
  r = await api(base, 'POST', '/api/parties/join', {
    token: fx.player2.token,
    body: { inviteCode: doomed.inviteCode },
  });
  eq(r.status, 404, 'disbanded invite code → 404');
}
