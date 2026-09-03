/**
 * Carnet du MD — campaign clock (day/season/weather + countdowns + archived
 * days), DM notes and quests. Every route is GM-only; players get 403 and
 * nothing else. Covers routes/campaign.ts.
 */
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;

  // ---------- gate : le carnet n'existe que pour le MD ----------
  let r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: fx.player.token });
  eq(r.status, 403, 'carnet player → 403');
  r = await api(base, 'GET', '/api/parties/999999/campaign', { token: fx.gm.token });
  eq(r.status, 403, 'carnet party not member → 403');
  r = await api(base, 'POST', `/api/parties/${P}/campaign/advance`, {
    token: fx.player.token,
    body: {},
  });
  eq(r.status, 403, 'advance player → 403');

  // ---------- GET : état par défaut, ligne d'horloge créée au premier accès ----------
  r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: fx.gm.token });
  eq(r.status, 200, 'carnet GM');
  eq(r.data.campaign.state.day, 1, 'clock starts at day 1');
  eq(r.data.campaign.state.season, 'spring', 'clock starts in spring');
  eq(r.data.campaign.state.weather, null, 'no weather yet');
  eq(r.data.campaign.days.length, 0, 'empty days ledger');
  eq(r.data.campaign.notes.length, 0, 'empty notes');
  eq(r.data.campaign.quests.length, 0, 'empty quests');

  // ---------- PATCH état : validations puis heureux chemin ----------
  r = await api(base, 'PATCH', `/api/parties/${P}/campaign`, {
    token: fx.gm.token,
    body: { day: 0 },
  });
  eq(r.status, 400, 'day 0 → 400');
  r = await api(base, 'PATCH', `/api/parties/${P}/campaign`, {
    token: fx.gm.token,
    body: { season: 'hiver' },
  });
  eq(r.status, 400, 'french season key → 400');
  r = await api(base, 'PATCH', `/api/parties/${P}/campaign`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'empty patch → 400');

  r = await api(base, 'PATCH', `/api/parties/${P}/campaign`, {
    token: fx.gm.token,
    body: { day: 12, season: 'summer', weather: '⛈️ Orage' },
  });
  eq(r.status, 200, 'patch clock');
  eq(r.data.state.day, 12, 'day updated');
  eq(r.data.state.season, 'summer', 'season updated');
  eq(r.data.state.weather, '⛈️ Orage', 'weather updated');

  // Correction du jour : SANS archivage — la météo reste celle d'aujourd'hui
  r = await api(base, 'PATCH', `/api/parties/${P}/campaign`, {
    token: fx.gm.token,
    body: { day: 11 },
  });
  eq(r.data.state.day, 11, 'day corrected');
  eq(r.data.state.weather, '⛈️ Orage', 'weather kept on correction');
  await api(base, 'PATCH', `/api/parties/${P}/campaign`, {
    token: fx.gm.token,
    body: { day: 12 },
  });

  // ---------- +1 jour : le jour s'achève, sa météo est figée au registre ----------
  r = await api(base, 'POST', `/api/parties/${P}/campaign/advance`, {
    token: fx.gm.token,
    body: { steps: 0 },
  });
  eq(r.status, 400, 'steps 0 → 400');
  r = await api(base, 'POST', `/api/parties/${P}/campaign/advance`, {
    token: fx.gm.token,
    body: { steps: 31 },
  });
  eq(r.status, 400, 'steps 31 → 400');

  r = await api(base, 'POST', `/api/parties/${P}/campaign/advance`, {
    token: fx.gm.token,
    body: {},
  });
  eq(r.status, 200, 'advance default +1');
  eq(r.data.state.day, 13, 'day advanced');
  eq(r.data.state.weather, null, 'new day starts clear');
  const archived = srv.query(
    'SELECT weather FROM campaign_days WHERE party_id = ? AND day = 12',
    P,
  );
  eq(archived?.weather, '⛈️ Orage', 'day 12 archived with its weather');

  r = await api(base, 'POST', `/api/parties/${P}/campaign/advance`, {
    token: fx.gm.token,
    body: { steps: 3 },
  });
  eq(r.data.state.day, 16, 'bounded multi-day jump');

  r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: fx.gm.token });
  eq(r.data.campaign.days.length, 1, 'only weathered days enter the ledger');
  eq(r.data.campaign.days[0].day, 12, 'ledger newest first');

  // ---------- Comptes à rebours ----------
  r = await api(base, 'POST', `/api/parties/${P}/campaign/countdowns`, {
    token: fx.player.token,
    body: { label: 'X', targetDay: 20 },
  });
  eq(r.status, 403, 'countdown player → 403');
  r = await api(base, 'POST', `/api/parties/${P}/campaign/countdowns`, {
    token: fx.gm.token,
    body: { label: '  ', targetDay: 20 },
  });
  eq(r.status, 400, 'countdown empty label → 400');
  r = await api(base, 'POST', `/api/parties/${P}/campaign/countdowns`, {
    token: fx.gm.token,
    body: { label: 'Malédiction', targetDay: 0 },
  });
  eq(r.status, 400, 'countdown target 0 → 400');

  r = await api(base, 'POST', `/api/parties/${P}/campaign/countdowns`, {
    token: fx.gm.token,
    body: { label: 'Malédiction de la mort', targetDay: 30 },
  });
  eq(r.status, 201, 'countdown created');
  const countdown = r.data.countdown;
  eq(countdown.targetDay, 30, 'countdown target stored (absolute)');

  r = await api(base, 'PATCH', `/api/campaign-countdowns/${countdown.id}`, {
    token: fx.gm.token,
    body: { targetDay: 29, label: 'Malédiction' },
  });
  eq(r.status, 200, 'countdown patched');
  eq(r.data.countdown.targetDay, 29, 'countdown target updated');
  r = await api(base, 'PATCH', '/api/campaign-countdowns/999999', {
    token: fx.gm.token,
    body: { label: 'X' },
  });
  eq(r.status, 404, 'countdown 404');
  r = await api(base, 'PATCH', `/api/campaign-countdowns/${countdown.id}`, {
    token: fx.player.token,
    body: { label: 'X' },
  });
  eq(r.status, 403, 'countdown patch player → 403');

  // ---------- Notes du carnet ----------
  r = await api(base, 'POST', `/api/parties/${P}/dm-notes`, {
    token: fx.player.token,
    body: { title: 'Interdit' },
  });
  eq(r.status, 403, 'dm-note player → 403');
  r = await api(base, 'POST', `/api/parties/${P}/dm-notes`, {
    token: fx.gm.token,
    body: { title: '' },
  });
  eq(r.status, 400, 'dm-note empty title → 400');

  r = await api(base, 'POST', `/api/parties/${P}/dm-notes`, {
    token: fx.gm.token,
    body: { title: 'Intrigues de Nyanzaru', content: '**Sauvetage** de la **princesse**' },
  });
  eq(r.status, 201, 'dm-note created');
  const note1 = r.data.note;
  r = await api(base, 'POST', `/api/parties/${P}/dm-notes`, {
    token: fx.gm.token,
    body: { title: 'Pièges du donjon' },
  });
  const note2 = r.data.note;
  eq(note2.sortOrder, note1.sortOrder + 1, 'notes append at the end');

  r = await api(base, 'PATCH', `/api/dm-notes/${note1.id}`, {
    token: fx.gm.token,
    body: { content: 'Mis à jour' },
  });
  eq(r.status, 200, 'dm-note patched');
  eq(r.data.note.content, 'Mis à jour', 'dm-note content updated');
  r = await api(base, 'PATCH', '/api/dm-notes/999999', {
    token: fx.gm.token,
    body: { title: 'X' },
  });
  eq(r.status, 404, 'dm-note 404');

  r = await api(base, 'PATCH', `/api/parties/${P}/dm-notes/order`, {
    token: fx.gm.token,
    body: { order: [note2.id, note1.id] },
  });
  eq(r.status, 200, 'dm-notes reordered');
  r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: fx.gm.token });
  eq(r.data.campaign.notes[0].id, note2.id, 'order rewritten');
  r = await api(base, 'PATCH', `/api/parties/${P}/dm-notes/order`, {
    token: fx.gm.token,
    body: { order: [999999] },
  });
  eq(r.status, 400, 'foreign note id in order → 400');

  r = await api(base, 'DELETE', `/api/dm-notes/${note2.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'dm-note deleted');

  // ---------- Quêtes ----------
  r = await api(base, 'POST', `/api/parties/${P}/dm-quests`, {
    token: fx.player.token,
    body: { title: 'Interdite' },
  });
  eq(r.status, 403, 'dm-quest player → 403');
  r = await api(base, 'POST', `/api/parties/${P}/dm-quests`, {
    token: fx.gm.token,
    body: { title: 'X', status: 'unknown' },
  });
  eq(r.status, 400, 'dm-quest invalid status → 400');

  r = await api(base, 'POST', `/api/parties/${P}/dm-quests`, {
    token: fx.gm.token,
    body: { title: "Le trésor perdu d'Omu" },
  });
  eq(r.status, 201, 'dm-quest created');
  eq(r.data.quest.status, 'preparation', 'quest starts in preparation');
  const quest = r.data.quest;

  r = await api(base, 'PATCH', `/api/dm-quests/${quest.id}`, {
    token: fx.gm.token,
    body: { status: 'active', body: 'Trouver les **neuf morceaux** du cube' },
  });
  eq(r.status, 200, 'dm-quest activated');
  eq(r.data.quest.status, 'active', 'quest status updated');
  r = await api(base, 'PATCH', '/api/dm-quests/999999', {
    token: fx.gm.token,
    body: { status: 'done' },
  });
  eq(r.status, 404, 'dm-quest 404');

  r = await api(base, 'DELETE', `/api/dm-quests/${quest.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'dm-quest deleted');

  // ---------- payload final ----------
  r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: fx.gm.token });
  ok(r.data.campaign.countdowns.length === 1, 'countdowns served');
  ok(r.data.campaign.notes.length === 1, 'notes served');
  ok(r.data.campaign.quests.length === 0, 'quests emptied');
}
