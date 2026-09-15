/**
 * GM Assistant integration: account key, campaign link, one-time init,
 * character resync (dryRun / apply / orphans / explicit delete / partial
 * failure), the chronicle cache (TTL window, GM-only refresh flag,
 * stale-on-error, empty-cache outage), and the « PNJ repérés » entities rail
 * (cache + import/link/pull/unlink, append-on-link, visibility). Runs against
 * the in-process mock GMA (mock-gma.ts) wired through GMA_BASE_URL — no real
 * keys, no network.
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

  // ---------- entities (« PNJ repérés ») ----------
  // Own party + own campaign: the NPCs created here must stay out of P —
  // the later npcs module asserts P's registry from scratch.
  const CAMPAIGN_ENTITIES = '33333333-3333-3333-3333-333333333333';
  const now = new Date().toISOString();
  const party4 = await createParty(base, fx.gm.token, 'Compagnie des Repérés');
  await api(base, 'POST', '/api/parties/join', {
    token: fx.player.token,
    body: { inviteCode: party4.inviteCode },
  });
  mock.campaigns.set(CAMPAIGN_ENTITIES, {
    id: CAMPAIGN_ENTITIES,
    title: 'Campagne Repérés',
    created_at: now,
    updated_at: now,
  });
  mock.sessions.set(CAMPAIGN_ENTITIES, [
    { id: 'sess-e1', title: 'L’arrivée', played_at: '2026-07-01', order: 0 },
    { id: 'sess-e2', title: 'Le marché', played_at: null, order: 1 },
  ]);
  mock.npcs.set(CAMPAIGN_ENTITIES, [
    {
      id: 'ent-rahadinE',
      name: 'Rahadin',
      description: 'Chambellan spectral. Ne quitte jamais son clavecin.',
      order: 0,
    },
    {
      id: 'ent-wakangaE',
      name: 'Wakanga O’tamu',
      description: 'Mage guide de Port Nyanzaru.',
      order: 1,
    },
    { id: 'ent-muetE', name: 'Silence d’outre-tombe', description: null, order: 2 },
  ]);
  // Appearances live per-session — separate records matched by name.
  mock.sessionNpcs.set('sess-e1', [
    { id: 'sn-e1', name: 'Rahadin', order: 0 },
    { id: 'sn-e2', name: 'Wakanga O’tamu', order: 1 },
  ]);
  mock.sessionNpcs.set('sess-e2', [
    { id: 'sn-e3', name: 'Rahadin', order: 0 },
    // Session-only NPC — no campaign counterpart: derived into the rail.
    {
      id: 'sn-e4',
      name: 'Blink',
      description: 'Une gamine des rues, yeux vifs, mains plus vite encore.',
      order: 1,
    },
  ]);

  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.player.token,
  });
  eq(r.status, 404, 'entities 404 before the party is linked');

  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/link`, {
    token: fx.gm.token,
    body: { campaignId: CAMPAIGN_ENTITIES },
  });
  eq(r.status, 201, 'party4 linked for entities tests');

  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.outsider.token,
  });
  eq(r.status, 403, 'outsider entities 403');

  // Import (player gesture) against a COLD cache — the route warms it once
  // (same robustness as the recap route), then shared NPC + link + copy.
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-rahadinE/import`, {
    token: fx.player.token,
  });
  eq(r.status, 201, 'player imports an entity (cold cache warmed)');
  eq(r.data.npc.name, 'Rahadin', 'npc created under the entity name');
  eq(r.data.npc.isShared, true, 'imported npc is shared');
  eq(r.data.npc.disposition, 'unknown', 'imported npc is met, not judged');
  eq(
    r.data.npc.description,
    'Chambellan spectral. Ne quitte jamais son clavecin.',
    'description copied',
  );
  const importedNpcId = r.data.npc.id;
  const importLink = srv.query(
    'SELECT * FROM gma_npc_links WHERE gma_entity_id = ?',
    'ent-rahadinE',
  );
  ok(!!importLink, 'link row recorded');
  ok(!!importLink.description_hash, 'import counts as a pull (hash recorded)');
  eq(importLink.npc_id, importedNpcId, 'link targets the new npc');

  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-rahadinE/import`, {
    token: fx.gm.token,
  });
  eq(r.status, 409, 'double import 409');

  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-inconnu/import`, {
    token: fx.player.token,
  });
  eq(r.status, 404, 'unknown entity 404');

  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'member reads the entities rail');
  eq(r.data.stale, false, 'fresh after first fetch');
  eq(r.data.campaignTitle, 'Campagne Repérés', 'campaign title served');
  eq(r.data.entities.length, 4, 'campaign NPCs + session-only NPCs served');
  const railBlink = r.data.entities.find((e: any) => e.name === 'Blink');
  ok(!!railBlink, 'session-only NPC derived into the rail');
  eq(railBlink.id, 'sn:blink', 'synthetic id from the normalized name');
  eq(
    railBlink.description,
    'Une gamine des rues, yeux vifs, mains plus vite encore.',
    'session description carried over',
  );
  eq(railBlink.sessions.length, 1, 'seen in the session that reported it');
  eq(railBlink.sessions[0].ordinal, 2, 'appearance ordinal derived');
  const railRahadin = r.data.entities.find((e: any) => e.id === 'ent-rahadinE');
  ok(!!railRahadin, 'Rahadin on the rail');
  eq(railRahadin.linkedNpc?.id, importedNpcId, 'already linked by the import above');
  eq(railRahadin.linkedNpc?.linkedByName, 'BOB', 'linker display name served');
  eq(railRahadin.sessions.length, 2, 'both appearances served');
  eq(railRahadin.sessions[0].ordinal, 1, 'first session ordinal');
  eq(railRahadin.sessions[1].ordinal, 2, 'appearances in chronicle order');
  eq(railRahadin.sessions[0].title, 'L’arrivée', 'session title served');

  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.gm.token,
  });
  eq(
    r.data.entities.find((e: any) => e.id === 'ent-rahadinE').linkedNpc?.id,
    importedNpcId,
    'link state served to the GM',
  );

  // Link: content untouched unless append is asked for…
  r = await api(base, 'POST', `/api/parties/${party4.id}/npcs`, {
    token: fx.gm.token,
    body: { name: 'Zantanivyr', description: 'Marchand taciturne.' },
  });
  const zantaId = r.data.npc.id;
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-wakangaE/link`, {
    token: fx.gm.token,
    body: { npcId: zantaId, appendDescription: true },
  });
  eq(r.status, 201, 'link with append');
  eq(r.data.appended, true, 'append reported');
  eq(
    r.data.npc.description,
    'Marchand taciturne.\n\nMage guide de Port Nyanzaru.',
    'GMA text appended after the player’s own words',
  );

  // …and append needs content-edit rights on the NPC (link alone stays legal).
  // ent-charterE (with a description) joins the rail first — an entity
  // WITHOUT one never triggers the append question.
  mock.npcs.get(CAMPAIGN_ENTITIES)!.push({
    id: 'ent-charterE',
    name: 'Charte du port',
    description: 'Scellée de cire verte.',
    order: 4,
  });
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities?refresh=1`, {
    token: fx.gm.token,
  });
  eq(r.data.entities.length, 5, 'GM refresh refetches entities');
  r = await api(base, 'POST', `/api/parties/${party4.id}/npcs`, {
    token: fx.player.token,
    body: { name: 'Potion rouge', description: 'Base.' },
  });
  const potionId = r.data.npc.id;
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-charterE/link`, {
    token: fx.player.token,
    body: { npcId: zantaId, appendDescription: true },
  });
  eq(r.status, 403, 'append on someone else’s npc 403');
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-muetE/link`, {
    token: fx.player.token,
    body: { npcId: potionId },
  });
  eq(r.status, 201, 'link without append stays legal for any member');
  eq(r.data.appended, false, 'no append reported');
  ok(
    !srv.query('SELECT description_hash FROM gma_npc_links WHERE gma_entity_id = ?', 'ent-muetE')
      .description_hash,
    'link-only records no pull',
  );

  // Link target must be VISIBLE to the actor (404, never a leak).
  r = await api(base, 'POST', `/api/parties/${party4.id}/npcs`, {
    token: fx.gm.token,
    body: { name: 'Cale secrète', isShared: false },
  });
  const caleId = r.data.npc.id;
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-inconnu/link`, {
    token: fx.player.token,
    body: { npcId: caleId },
  });
  eq(r.status, 404, 'unknown entity 404 (link)');
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-charterE/link`, {
    token: fx.player.token,
    body: { npcId: caleId },
  });
  eq(r.status, 404, 'link to an invisible npc 404 (no leak)');

  // Pull: replace after a GMA-side edit, append on a link-only row.
  mock.npcs.get(CAMPAIGN_ENTITIES)!.find((e: any) => e.id === 'ent-wakangaE')!.description =
    'Mage guide, gravement inquiet.';
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities?refresh=1`, {
    token: fx.gm.token,
  });
  const wakangaNow = r.data.entities.find((e: any) => e.id === 'ent-wakangaE');
  eq(wakangaNow.linkedNpc.descriptionUpdated, true, 'GMA-side edit flagged');
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-wakangaE/pull`, {
    token: fx.gm.token,
    body: { npcId: zantaId },
  });
  eq(r.status, 200, 'pull replace');
  eq(
    r.data.npc.description,
    'Mage guide, gravement inquiet.',
    'replace overwrites the GMA text only',
  );
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.gm.token,
  });
  eq(
    r.data.entities.find((e: any) => e.id === 'ent-wakangaE').linkedNpc.descriptionUpdated,
    false,
    'flag cleared after the pull',
  );

  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-charterE/link`, {
    token: fx.gm.token,
    body: { npcId: caleId },
  });
  eq(r.status, 201, 'GM links their private npc (link-only)');
  // The private link is invisible to the player: the entity leaves their rail.
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.player.token,
  });
  ok(
    !r.data.entities.some((e: any) => e.id === 'ent-charterE'),
    'privately-linked entity hidden from other members',
  );
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-charterE/pull`, {
    token: fx.gm.token,
    body: { npcId: caleId, append: true },
  });
  eq(r.status, 200, 'pull append on a link-only row');
  eq(r.data.npc.description, 'Scellée de cire verte.', 'append onto an empty description');
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-muetE/pull`, {
    token: fx.player.token,
    body: { npcId: potionId },
  });
  eq(r.status, 400, 'pull with no GMA description 400');

  // Unlink: MD, npc creator, or the linker — nobody else.
  r = await api(base, 'DELETE', `/api/parties/${party4.id}/gma/entities/ent-wakangaE/link`, {
    token: fx.player.token,
  });
  eq(r.status, 403, 'unlink by an unrelated member 403');
  r = await api(base, 'DELETE', `/api/parties/${party4.id}/gma/entities/ent-rahadinE/link`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'unlink by the npc creator/linker');
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.player.token,
  });
  eq(
    r.data.entities.find((e: any) => e.id === 'ent-rahadinE').linkedNpc,
    null,
    'entity back on the rail after unlink',
  );
  eq(
    srv.queryAll('SELECT * FROM gma_npc_links WHERE gma_entity_id = ?', 'ent-rahadinE').length,
    0,
    'link row removed (npc kept)',
  );
  r = await api(base, 'GET', `/api/parties/${party4.id}/npcs`, { token: fx.gm.token });
  ok(
    r.data.npcs.some((n: any) => n.id === importedNpcId),
    'the imported npc survives its unlink',
  );

  // Réconciliation: a SECOND entity may join an npc that already carries one
  // (GMA re-catalogues the same person every session) — one npc, n sightings.
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-rahadinE/link`, {
    token: fx.gm.token,
    body: { npcId: zantaId },
  });
  eq(r.status, 201, 'reconciliation: second entity onto a carried npc 201');
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.gm.token,
  });
  eq(
    r.data.entities.filter((e: any) => e.linkedNpc?.id === zantaId).length,
    2,
    'both entities reconcile onto the same npc',
  );
  eq(
    srv.queryAll('SELECT * FROM gma_npc_links WHERE npc_id = ?', zantaId).length,
    2,
    'two link rows on one npc',
  );
  // Unlinking one sighting leaves the other untouched.
  r = await api(base, 'DELETE', `/api/parties/${party4.id}/gma/entities/ent-rahadinE/link`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'unlink one reconciled sighting');
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.gm.token,
  });
  eq(
    r.data.entities.find((e: any) => e.id === 'ent-wakangaE').linkedNpc.id,
    zantaId,
    'the other sighting keeps its link',
  );

  // Stale-on-error: the rail keeps serving the cache through an outage.
  mock.failMode = 'down';
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities?refresh=1`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'outage: entities still served');
  eq(r.data.stale, true, 'flagged stale');
  eq(r.data.entities.length, 5, 'old cache intact');
  mock.failMode = 'off';

  // ---------- discard (« Écarter ») ----------
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-muetE/discard`, {
    token: fx.outsider.token,
  });
  eq(r.status, 403, 'outsider discard 403');
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-muetE/discard`, {
    token: fx.player.token,
  });
  eq(r.status, 201, 'member discards an entity');
  r = await api(base, 'POST', `/api/parties/${party4.id}/gma/entities/ent-muetE/discard`, {
    token: fx.gm.token,
  });
  eq(r.status, 201, 'double discard idempotent');
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.player.token,
  });
  eq(r.data.entities.find((e: any) => e.id === 'ent-muetE').discarded, true, 'discard flag served');
  eq(
    r.data.entities.find((e: any) => e.id === 'ent-wakangaE').discarded,
    false,
    'others unaffected',
  );
  // The discard survives a cache refresh (own table, not a cache flag).
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities?refresh=1`, {
    token: fx.gm.token,
  });
  eq(
    r.data.entities.find((e: any) => e.id === 'ent-muetE').discarded,
    true,
    'discard survives refresh',
  );
  r = await api(base, 'DELETE', `/api/parties/${party4.id}/gma/entities/ent-muetE/discard`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'restore ok');
  r = await api(base, 'GET', `/api/parties/${party4.id}/gma/entities`, {
    token: fx.player.token,
  });
  eq(
    r.data.entities.find((e: any) => e.id === 'ent-muetE').discarded,
    false,
    'restored entity back to normal',
  );

  // One discard in P so the unlink purge assertion below has teeth.
  r = await api(base, 'POST', `/api/parties/${P}/gma/entities/ent-rahadin/discard`, {
    token: fx.player.token,
  });
  eq(r.status, 201, 'discard in P recorded');

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
  eq(
    srv.queryAll('SELECT * FROM gma_entities WHERE party_id = ?', P).length,
    0,
    'entities cache dropped',
  );
  eq(
    srv.queryAll('SELECT * FROM gma_entity_sessions WHERE party_id = ?', P).length,
    0,
    'entity appearances dropped',
  );
  eq(
    srv.queryAll('SELECT * FROM gma_npc_links WHERE party_id = ?', P).length,
    0,
    'npc links dropped',
  );
  eq(
    srv.queryAll('SELECT * FROM gma_entity_discards WHERE party_id = ?', P).length,
    0,
    'discards dropped',
  );
  r = await api(base, 'GET', `/api/parties/${P}/gma/sessions`, { token: fx.gm.token });
  eq(r.status, 404, 'sessions 404 after unlink');

  // Mock state back to pristine for any later module.
  mock.reset();
}
