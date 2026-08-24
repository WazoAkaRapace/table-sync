/**
 * GM Assistant integration: account key, campaign link, one-time init,
 * character resync (dryRun / apply / orphans / explicit delete / partial
 * failure), and the chronicle cache (TTL window, GM-only refresh flag,
 * stale-on-error, empty-cache outage). Runs against the in-process mock GMA
 * (mock-gma.ts) wired through GMA_BASE_URL — no real keys, no network.
 */
import {
  api,
  createCharacter,
  createParty,
  eq,
  type Fixtures,
  ok,
  type ServerHandle,
} from './harness.ts';
import { MOCK_GMA_EXISTING_CAMPAIGN_ID, MOCK_GMA_OTHER_CAMPAIGN_ID } from './mock-gma.ts';

const FULL_KEY = 'gma_test_full_good_key';
const READ_KEY = 'gma_test_read_key';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;
  const mock = srv.gma.state;

  // ---------- account key ----------
  let r = await api(base, 'GET', '/api/gma/status', { token: fx.gm.token });
  eq(r.status, 200, 'status before key');
  eq(r.data.linked, false, 'no key yet');
  eq(r.data.account, null, 'no account yet');

  r = await api(base, 'PUT', '/api/gma/key', {
    token: fx.gm.token,
    body: { apiKey: 'gma_wrong_wrong_wrong' },
  });
  eq(r.status, 401, 'rejected key is not stored');
  ok(String(r.data.message).includes('invalide'), 'French message for a rejected key');
  eq(
    srv.query('SELECT COUNT(*) AS n FROM user_gma_links WHERE user_id = ?', fx.gm.userId).n,
    0,
    'nothing stored on rejection',
  );

  r = await api(base, 'PUT', '/api/gma/key', { token: fx.gm.token, body: { apiKey: FULL_KEY } });
  eq(r.status, 200, 'good key stored');
  ok(String(r.data.account.email).startsWith('g***@'), 'email served masked');
  const keyRow = srv.query(
    'SELECT api_key_enc FROM user_gma_links WHERE user_id = ?',
    fx.gm.userId,
  );
  ok(!keyRow.api_key_enc.includes(FULL_KEY), 'key encrypted at rest, not plaintext');

  r = await api(base, 'GET', '/api/gma/status', { token: fx.gm.token });
  eq(r.data.linked, true, 'key present');
  eq(r.data.account.scope, null, 'scope unknown until the first write');
  r = await api(base, 'GET', '/api/gma/status', { token: fx.player.token });
  eq(r.data.linked, false, 'keys are per user');

  // ---------- link flow ----------
  r = await api(base, 'GET', `/api/parties/${P}/gma/campaigns`, { token: fx.player.token });
  eq(r.status, 403, 'campaigns picker is GM-only');

  r = await api(base, 'GET', `/api/parties/${P}/gma/campaigns`, { token: fx.gm.token });
  eq(r.status, 200, 'picker ok');
  ok(
    r.data.campaigns.some(
      (c: any) => c.id === MOCK_GMA_EXISTING_CAMPAIGN_ID && c.title === 'Campagne Existante',
    ),
    'seeded campaign listed',
  );

  r = await api(base, 'POST', `/api/parties/${P}/gma/link`, {
    token: fx.gm.token,
    body: { campaignId: 'not-a-uuid' },
  });
  eq(r.status, 400, 'non-UUID campaign id rejected');

  r = await api(base, 'POST', `/api/parties/${P}/gma/link`, {
    token: fx.gm.token,
    body: { campaignId: MOCK_GMA_EXISTING_CAMPAIGN_ID },
  });
  eq(r.status, 201, 'link created');

  r = await api(base, 'POST', `/api/parties/${P}/gma/link`, {
    token: fx.gm.token,
    body: { campaignId: MOCK_GMA_OTHER_CAMPAIGN_ID },
  });
  eq(r.status, 409, 'double link rejected');

  const party2 = await createParty(base, fx.gm.token, 'Compagnie B');
  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/link`, {
    token: fx.gm.token,
    body: { campaignId: MOCK_GMA_EXISTING_CAMPAIGN_ID },
  });
  eq(r.status, 409, 'campaign already claimed by another party');
  eq(r.data.error, 'campaign_taken', 'campaign_taken error code');

  r = await api(base, 'GET', `/api/parties/${P}/gma/link`, { token: fx.player.token });
  eq(r.status, 200, 'member reads the link');
  eq(r.data.linked, true, 'linked');
  eq(r.data.campaign.title, 'Campagne Existante', 'title cached');
  eq(r.data.accountOk, true, 'linking key present');

  r = await api(base, 'GET', `/api/parties/${P}/gma/link`, { token: fx.outsider.token });
  eq(r.status, 403, 'outsider cannot read the link');

  // ---------- chronicle: sessions + recaps ----------
  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions`, { token: fx.player.token });
  eq(r.status, 200, 'sessions for a member');
  eq(r.data.sessions.length, 3, 'cursor pagination followed (3 sessions across 2 pages)');
  eq(r.data.sessions[0].id, 'sess-1', 'user-arranged order respected');
  eq(r.data.stale, false, 'fresh after first fetch');
  eq(r.data.sessions[2].playedAt, null, 'null played_at round-trips');
  ok(!!r.data.fetchedAt, 'party-level fetch marker served');

  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions`, { token: fx.outsider.token });
  eq(r.status, 403, 'outsider sessions 403');

  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions/sess-1/recap`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'recap for a member');
  eq(r.data.recaps.length, 2, 'both styles cached');
  eq(r.data.recaps[0].style, 'default', 'default recap served first');
  ok(r.data.recaps[0].text.includes('Baldur'), 'default recap text');
  eq(r.data.moments.length, 2, 'memorable moments cached with the recaps');
  eq(r.data.moments[0].id, 'mom-1', 'moments in user-arranged order');
  eq(r.data.moments[0].isQuote, true, 'quote moment shaped');
  eq(r.data.moments[0].speaker, 'Rahadin', 'moment speaker round-trips');
  eq(r.data.moments[1].isQuote, false, 'highlight moment shaped');
  eq(r.data.moments[1].type, 'funny', 'moment type round-trips');

  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions/sess-999/recap`, {
    token: fx.gm.token,
  });
  eq(r.status, 404, 'unknown session 404');

  // TTL window: upstream mutation is invisible until refresh…
  mock.recaps.get('sess-1')!.find((e: any) => e.style === 'default')!.text = 'NOUVEAU TEXTE';
  mock.moments.get('sess-1')!.push({
    id: 'mom-3',
    is_quote: false,
    type: 'epic',
    description: 'Moment ajouté entre-temps.',
    speaker: null,
    context: null,
    order: 2,
  });
  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions/sess-1/recap`, {
    token: fx.player.token,
  });
  ok(r.data.recaps[0].text.includes('Baldur'), 'plain GET inside TTL serves the cache');
  eq(r.data.moments.length, 2, 'moments served from the cache inside the TTL');
  // …GM refresh bypasses it…
  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions/sess-1/recap?refresh=1`, {
    token: fx.gm.token,
  });
  ok(r.data.recaps[0].text.includes('NOUVEAU'), 'GM refresh refetches');
  eq(r.data.moments.length, 3, 'GM refresh refetches the moments too');
  // …a player's refresh flag is ignored.
  mock.recaps.get('sess-1')!.find((e: any) => e.style === 'default')!.text = 'ENCORE AUTRE';
  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions/sess-1/recap?refresh=1`, {
    token: fx.player.token,
  });
  ok(r.data.recaps[0].text.includes('NOUVEAU'), 'player refresh ignored (cache served)');

  // Stale-on-error: outage + refresh → 200 with the old cache, flagged.
  mock.failMode = 'down';
  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions?refresh=1`, { token: fx.gm.token });
  eq(r.status, 200, 'outage: sessions still served');
  eq(r.data.stale, true, 'flagged stale');
  eq(r.data.sessions.length, 3, 'old cache intact');
  mock.failMode = 'off';

  // Empty cache + outage → the honest upstream error.
  const partyOut = await createParty(base, fx.outsider.token, 'Compagnie Isolée');
  r = await api(base, 'PUT', '/api/gma/key', {
    token: fx.outsider.token,
    body: { apiKey: FULL_KEY },
  });
  eq(r.status, 200, 'outsider stores their own key');
  r = await api(base, 'POST', `/api/parties/${partyOut.id}/gma/link`, {
    token: fx.outsider.token,
    body: { campaignId: MOCK_GMA_OTHER_CAMPAIGN_ID },
  });
  eq(r.status, 201, 'outsider links the other campaign');
  mock.failMode = 'down';
  r = await api(base, 'GET', `/api/parties/${partyOut.id}/gma/sessions`, {
    token: fx.outsider.token,
  });
  eq(r.status, 502, 'no cache + outage → 502');
  ok(String(r.data.message).includes('injoignable'), 'network error translated');
  mock.failMode = 'off';

  // ---------- init (the one-time creation FROM the group) ----------
  r = await api(base, 'POST', `/api/parties/${P}/gma/init`, {
    token: fx.gm.token,
    body: { characterIds: [fx.charAlya.id] },
  });
  eq(r.status, 409, 'init on an already-linked party 409');

  const join2 = await api(base, 'POST', '/api/parties/join', {
    token: fx.player.token,
    body: { inviteCode: party2.inviteCode },
  });
  eq(join2.status, 201, 'bob joins party2');
  const charCedric = await createCharacter(base, fx.gm.token, party2.id, {
    name: 'Cedric',
    characterClass: 'Guerrier',
    level: 3,
  });
  r = await api(base, 'PATCH', `/api/characters/${charCedric.id}`, {
    token: fx.gm.token,
    body: {
      alignment: 'Loyal Bon',
      sex: 'F',
      age: '32 ans',
      height: '1,75 m',
      weight: '65 kg',
      skin: 'Mate',
      eyes: 'Vairons',
      hair: 'Roux, tressés',
      appearance: 'Cicatrice sur la pommette gauche.',
      personalityTraits: 'Je fonce sans calculer.',
      ideals: 'La liberté avant tout.',
      bonds: 'Ma sœur disparue à Chult.',
      flaws: 'Je ne supporte pas l’autorité.',
      backstory: 'Née à Port Nyanzaru, elle cherche sa sœur.',
    },
  });
  eq(r.status, 200, 'identity fields saved on Cedric');
  const charDora = await createCharacter(base, fx.player.token, party2.id, { name: 'Dora' });
  const charSneaky = await createCharacter(base, fx.gm.token, party2.id, {
    name: 'Sneaky',
    hidden: true,
  });

  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/init`, {
    token: fx.gm.token,
    body: { characterIds: [charCedric.id, charDora.id, charSneaky.id, 999999] },
  });
  eq(r.status, 201, 'init ok');
  eq(r.data.campaign.title, 'Compagnie B', 'campaign named after the party');
  eq(r.data.created.length, 2, 'hidden and unknown ids filtered out');
  ok(
    r.data.created.every((c: any) => c.name !== 'Sneaky'),
    'hidden (secret prep) character never pushed',
  );
  const campPost = mock.requests.find(
    (q) => q.method === 'POST' && q.path === '/campaigns' && q.body?.title === 'Compagnie B',
  );
  ok(!!campPost, 'campaign POST sent upstream');
  eq(campPost.body.ttrpg_system, 'dungeons and dragons', 'system set to D&D');
  eq(campPost.body.ttrpg_system_edition, '5e', 'edition set to 5e');
  const pcPost = mock.requests.find((q) => q.method === 'POST' && q.body?.name === 'Cedric');
  ok(!!pcPost, 'player-character POST sent');
  eq(pcPost.body.played_by, 'ALICE', 'played_by = owner displayName');
  const cedricDesc = String(pcPost.body.description);
  ok(
    cedricDesc.startsWith('Guerrier niveau 3 · Loyal Bon'),
    'description headlines class + alignment',
  );
  ok(
    cedricDesc.includes(
      'Apparence : F · 32 ans · 1,75 m · 65 kg · peau mate · yeux vairons · cheveux roux, tressés\nCicatrice sur la pommette gauche.',
    ),
    'physical quick-fields and appearance composed',
  );
  ok(
    cedricDesc.includes(
      'Personnalité : Je fonce sans calculer.\nIdéaux : La liberté avant tout.\nLiens : Ma sœur disparue à Chult.\nDéfauts : Je ne supporte pas l’autorité.',
    ),
    'personality quartet composed',
  );
  ok(
    cedricDesc.endsWith('Histoire :\nNée à Port Nyanzaru, elle cherche sa sœur.'),
    'backstory composed last',
  );
  eq(
    srv.queryAll('SELECT * FROM gma_pc_links WHERE party_id = ?', party2.id).length,
    2,
    'pc links recorded',
  );
  const party2Campaign = r.data.campaign.id as string;

  r = await api(base, 'GET', '/api/gma/status', { token: fx.gm.token });
  eq(r.data.account.scope, 'full_access', 'scope discovered after a successful write');

  // Read-scope key: the init write fails with the translated message.
  const party3 = await createParty(base, fx.gm.token, 'Compagnie C');
  r = await api(base, 'PUT', '/api/gma/key', { token: fx.gm.token, body: { apiKey: READ_KEY } });
  eq(r.status, 200, 'swap to the read-only key');
  r = await api(base, 'POST', `/api/parties/${party3.id}/gma/init`, {
    token: fx.gm.token,
    body: { characterIds: [] },
  });
  eq(r.status, 403, 'init with a read key 403');
  ok(String(r.data.message).includes('lecture seule'), 'scope message translated');
  r = await api(base, 'GET', '/api/gma/status', { token: fx.gm.token });
  eq(r.data.account.scope, 'read', 'scope recorded as read');
  r = await api(base, 'PUT', '/api/gma/key', { token: fx.gm.token, body: { apiKey: FULL_KEY } });
  eq(r.status, 200, 'restore the full key');

  // ---------- character resync ----------
  r = await api(base, 'PATCH', `/api/characters/${charCedric.id}`, {
    token: fx.gm.token,
    body: { name: 'Cédric II' },
  });
  eq(r.status, 200, 'rename character locally');
  const charEva = await createCharacter(base, fx.gm.token, party2.id, { name: 'Eva' });

  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: { dryRun: true },
  });
  eq(r.status, 200, 'dryRun ok');
  eq(r.data.applied, false, 'dryRun does not apply');
  eq(r.data.toUpdate.length, 1, 'one divergence detected');
  eq(r.data.toUpdate[0].name, 'Cédric II', 'update targets the renamed character');
  const nameChange = r.data.toUpdate[0].changes.find((c: any) => c.field === 'name');
  ok(
    nameChange && nameChange.from === 'Cedric' && nameChange.to === 'Cédric II',
    'name change diffed old → new',
  );
  eq(r.data.toCreate.length, 1, 'new character proposed for creation');
  eq(r.data.toCreate[0].name, 'Eva', 'Eva in toCreate');
  eq(r.data.upToDate, 1, 'Dora up to date');
  eq(r.data.orphans.length, 0, 'no orphans yet');

  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.player.token,
    body: {},
  });
  eq(r.status, 403, 'sync is GM-only');

  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: { createCharacterIds: [charEva.id] },
  });
  eq(r.status, 200, 'apply ok');
  eq(r.data.created.length, 1, 'Eva created upstream');
  eq(r.data.updated.length, 1, 'rename applied upstream');
  eq(r.data.failed.length, 0, 'no failures');
  const patchReq = [...mock.requests].reverse().find((q) => q.method === 'PATCH');
  ok(!!patchReq, 'PATCH sent as merge-patch');
  eq(patchReq.body.name, 'Cédric II', 'patch carries the new name');
  ok(!('description' in patchReq.body), 'patch limited to changed fields');

  // Identity edits flow through the composed description (GMA has no identity
  // fields of its own) and respect the 6000-char maxLength.
  r = await api(base, 'PATCH', `/api/characters/${charCedric.id}`, {
    token: fx.gm.token,
    body: { backstory: 'A'.repeat(7000) },
  });
  eq(r.status, 200, 'backstory grows past GMA maxLength');
  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: { dryRun: true },
  });
  const descChange = r.data.toUpdate
    .find((u: any) => u.characterId === charCedric.id)
    ?.changes.find((c: any) => c.field === 'description');
  ok(!!descChange, 'identity edit diffs the description');
  eq(descChange.to.length, 6000, 'description capped at GMA maxLength');
  ok(descChange.to.endsWith('…'), 'cap marked with an ellipsis');
  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: {},
  });
  eq(r.data.updated.length, 1, 'identity update applied upstream');

  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: { dryRun: true },
  });
  eq(r.data.toCreate.length, 0, 'converged: nothing left to create');
  eq(r.data.toUpdate.length, 0, 'converged: nothing left to update');
  eq(r.data.upToDate, 3, 'three characters up to date');

  // Orphan: the linked local sheet disappears → reported, NEVER auto-deleted.
  r = await api(base, 'DELETE', `/api/characters/${charEva.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete Eva locally');
  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: { dryRun: true },
  });
  eq(r.data.orphans.length, 1, 'Eva link orphaned');
  eq(r.data.orphans[0].nameAtSync, 'Eva', 'orphan identified by its sync-time name');
  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: {},
  });
  const evaPc = mock.pcs.get(party2Campaign)?.find((p: any) => p.name === 'Eva');
  ok(!!evaPc, 'Eva still on GM Assistant — the batch never deletes');

  // Explicit delete: GM-only, two doors (party + pc id).
  r = await api(base, 'DELETE', `/api/parties/${party2.id}/gma/characters/${evaPc.id}`, {
    token: fx.player.token,
  });
  eq(r.status, 403, 'orphan delete GM-only');
  r = await api(base, 'DELETE', `/api/parties/${party2.id}/gma/characters/${evaPc.id}`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'explicit orphan delete ok');
  ok(
    !mock.pcs.get(party2Campaign)?.some((p: any) => p.name === 'Eva'),
    'Eva removed upstream by the explicit gesture',
  );
  eq(
    srv.queryAll(
      'SELECT * FROM gma_pc_links WHERE party_id = ? AND character_id IS NULL',
      party2.id,
    ).length,
    0,
    'orphan link row removed',
  );
  r = await api(base, 'DELETE', `/api/parties/${party2.id}/gma/characters/pc-inconnu`, {
    token: fx.gm.token,
  });
  eq(r.status, 404, 'unknown pc 404');

  // GMA-side PC: reported, untouched.
  mock.pcs.get(party2Campaign)!.push({
    id: 'pc-direct',
    name: 'Arrivant',
    played_by: null,
    description: null,
    order: 9,
  });
  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: { dryRun: true },
  });
  eq(r.data.gmaOnly.length, 1, 'GMA-side PC reported');
  eq(r.data.gmaOnly[0].name, 'Arrivant', 'GMA-side PC named');
  mock.pcs.get(party2Campaign)!.splice(
    mock.pcs.get(party2Campaign)!.findIndex((p: any) => p.id === 'pc-direct'),
    1,
  );

  // Partial failure: one failed create reported, the batch continues.
  const charFinn = await createCharacter(base, fx.gm.token, party2.id, { name: 'Finn' });
  const charGus = await createCharacter(base, fx.gm.token, party2.id, { name: 'Gus' });
  mock.failNextPcPost = 'validation refusée';
  r = await api(base, 'POST', `/api/parties/${party2.id}/gma/characters/sync`, {
    token: fx.gm.token,
    body: { createCharacterIds: [charFinn.id, charGus.id] },
  });
  eq(r.data.failed.length, 1, 'one failed create reported');
  ok(
    String(r.data.failed[0].reason).includes('validation refusée'),
    'upstream failure reason surfaced',
  );
  eq(r.data.created.length, 1, 'the second create continued past the failure');

  // ---------- key deletion → link survives, flagged ----------
  r = await api(base, 'GET', `/api/parties/${party2.id}/gma/sessions`, { token: fx.gm.token });
  eq(r.status, 200, 'party2 sessions cached before the key goes away');
  eq(r.data.sessions.length, 0, 'fresh campaign has no sessions');
  ok(!!r.data.fetchedAt, 'empty-list fetch still stamped (no refetch loop)');

  r = await api(base, 'DELETE', '/api/gma/key', { token: fx.gm.token });
  eq(r.status, 200, 'key deleted');
  r = await api(base, 'GET', '/api/gma/status', { token: fx.gm.token });
  eq(r.data.linked, false, 'account unlinked from the key');
  r = await api(base, 'GET', `/api/parties/${party2.id}/gma/link`, { token: fx.gm.token });
  eq(r.data.linked, true, 'party link survives the key');
  eq(r.data.accountOk, false, 'account flagged not ok');
  r = await api(base, 'GET', `/api/parties/${party2.id}/gma/sessions?refresh=1`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'sessions still served without a key');
  eq(r.data.stale, true, 'flagged stale (refresh impossible)');

  // ---------- unlink ----------
  r = await api(base, 'DELETE', `/api/parties/${P}/gma/link`, { token: fx.player.token });
  eq(r.status, 403, 'unlink GM-only');
  r = await api(base, 'DELETE', `/api/parties/${P}/gma/link`, { token: fx.gm.token });
  eq(r.status, 200, 'unlink ok');
  r = await api(base, 'GET', `/api/parties/${P}/gma/link`, { token: fx.gm.token });
  eq(r.data.linked, false, 'unlinked');
  eq(
    srv.queryAll('SELECT * FROM gma_sessions WHERE party_id = ?', P).length,
    0,
    'sessions cache dropped',
  );
  eq(
    srv.queryAll('SELECT * FROM gma_recaps WHERE party_id = ?', P).length,
    0,
    'recaps cache dropped',
  );
  eq(
    srv.queryAll('SELECT * FROM gma_moments WHERE party_id = ?', P).length,
    0,
    'moments cache dropped',
  );
  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions`, { token: fx.gm.token });
  eq(r.status, 404, 'sessions 404 after unlink');

  // Mock state back to pristine for any later module.
  mock.reset();
}
