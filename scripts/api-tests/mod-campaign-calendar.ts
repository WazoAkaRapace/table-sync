/**
 * Calendrier partagé (#159) — GET /campaign/calendar pour tout membre (la
 * note MD masquée aux joueurs), avance du jour par tout membre, journal de
 * table partagé (upsert sans toucher météo/note MD), notes privées par
 * personnage/jour (owner-or-GM, isolation entre joueurs). Couvre
 * routes/campaign.ts. Le module vit sur des jours ∻ 1000 pour ignorer le
 * registre laissé par le module carnet.
 */
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;
  const cal = `/api/parties/${P}/campaign`;

  // ---------- portes : non-membre 403 ----------
  let r = await api(base, 'GET', `${cal}/calendar?from=1000&to=1007`, { token: fx.outsider.token });
  eq(r.status, 403, 'calendar non-membre → 403');
  r = await api(base, 'PUT', `${cal}/table-note`, {
    token: fx.outsider.token,
    body: { day: 1000, note: 'X' },
  });
  eq(r.status, 403, 'table-note non-membre → 403');
  r = await api(base, 'GET', `${cal}/day-note?characterId=${fx.charBran.id}&day=1000`, {
    token: fx.outsider.token,
  });
  eq(r.status, 403, 'day-note non-membre → 403');

  // ---------- lecture joueur : tableNote oui, note MD non ----------
  // horloge déplacée à 1000 (correction MD) : plage vierge du registre carnet
  r = await api(base, 'PATCH', cal, { token: fx.gm.token, body: { day: 1000 } });
  eq(r.status, 200, 'MD corrige le jour à 1000');
  eq(r.data.state.day, 1000, 'pointeur à 1000');

  r = await api(base, 'GET', `${cal}/calendar?from=1000&to=1002`, { token: fx.player.token });
  eq(r.status, 200, 'calendar joueur 200');
  eq(r.data.isGM, false, 'joueur : isGM false');
  eq(r.data.state.day, 1000, 'state.day servi');
  eq(r.data.state.season, 'summer', 'state.season servi (posé par le module carnet)');
  eq(r.data.state.weather, null, 'state.weather null avant tout');
  eq(r.data.days.length, 0, 'plage vierge : aucun jour au registre');

  // ---------- MD : écriture du jour courant, puis advance par le JOUEUR ----------
  r = await api(base, 'PATCH', cal, {
    token: fx.gm.token,
    body: { weather: '☀️ Dégagé', note: 'Embuscade préparée.' },
  });
  eq(r.status, 200, 'MD patch état');

  r = await api(base, 'POST', `${cal}/advance`, {
    token: fx.player.token,
    body: {},
  });
  eq(r.status, 200, 'advance par un joueur → 200 (#159)');
  eq(r.data.state.day, 1001, 'jour avancé à 1001');
  eq(r.data.state.weather, null, 'nouveau jour clair');
  const archived = srv.query(
    'SELECT weather, note FROM campaign_days WHERE party_id = ? AND day = 1000',
    P,
  );
  eq(archived?.weather, '☀️ Dégagé', 'le jour 1000 est archivé (météo)');
  eq(archived?.note, 'Embuscade préparée.', 'le jour 1000 est archivé (note MD)');

  // ---------- lecture : joueur voit tableNote+météo, dmNote null ; MD voit tout ----------
  r = await api(base, 'PUT', `${cal}/table-note`, {
    token: fx.player.token,
    body: { day: 1000, note: '  Nous avons survécu à une embuscade.  ' },
  });
  eq(r.status, 200, 'table-note par un joueur → 200');
  eq(r.data.day.tableNote, 'Nous avons survécu à une embuscade.', 'table-note trimée');

  r = await api(base, 'GET', `${cal}/calendar?from=1000&to=1007`, { token: fx.player.token });
  eq(r.data.days.length, 1, 'un seul jour existant servi (le client matérialise le reste)');
  const pDay = r.data.days[0];
  eq(pDay.day, 1000, 'jour 1000 servi');
  eq(pDay.weather, '☀️ Dégagé', 'météo visible du joueur');
  eq(pDay.tableNote, 'Nous avons survécu à une embuscade.', 'journal de table visible');
  eq(pDay.dmNote, null, 'note MD masquée au joueur');

  r = await api(base, 'GET', `${cal}/calendar?from=1000&to=1007`, { token: fx.gm.token });
  eq(r.data.isGM, true, 'MD : isGM true');
  const gDay = r.data.days[0];
  eq(gDay.dmNote, 'Embuscade préparée.', 'MD voit sa note privée');
  eq(gDay.tableNote, 'Nous avons survécu à une embuscade.', 'MD voit le journal de table');

  // ---------- upsert : update sans toucher météo ni note MD ----------
  r = await api(base, 'PUT', `${cal}/table-note`, {
    token: fx.gm.token,
    body: { day: 1000, note: 'Journal révisé.' },
  });
  eq(r.status, 200, 'table-note update');
  const row = srv.query(
    'SELECT weather, note, table_note FROM campaign_days WHERE party_id = ? AND day = 1000',
    P,
  );
  eq(row?.weather, '☀️ Dégagé', "l'upsert ne touche pas la météo");
  eq(row?.note, 'Embuscade préparée.', "l'upsert ne touche pas la note MD");
  eq(row?.table_note, 'Journal révisé.', 'table_note mise à jour');

  // création de ligne pour un jour SANS registre : météo/note MD restent null
  r = await api(base, 'PUT', `${cal}/table-note`, {
    token: fx.player.token,
    body: { day: 1004, note: 'Plan : traverser la rivière.' },
  });
  eq(r.status, 200, 'table-note crée la ligne du jour 1004');
  const row1004 = srv.query(
    'SELECT weather, note, table_note FROM campaign_days WHERE party_id = ? AND day = 1004',
    P,
  );
  eq(row1004?.weather, null, 'jour 1004 créé sans météo');
  eq(row1004?.note, null, 'jour 1004 créé sans note MD');
  eq(row1004?.table_note, 'Plan : traverser la rivière.', 'jour 1004 porte le journal');

  // validations : jour hors bornes, note trop longue
  r = await api(base, 'PUT', `${cal}/table-note`, {
    token: fx.gm.token,
    body: { day: 0, note: 'X' },
  });
  eq(r.status, 400, 'table-note day 0 → 400');
  r = await api(base, 'PUT', `${cal}/table-note`, {
    token: fx.gm.token,
    body: { day: 1000, note: 'X'.repeat(2001) },
  });
  eq(r.status, 400, 'table-note 2001 chars → 400');
  r = await api(base, 'PUT', `${cal}/table-note`, {
    token: fx.gm.token,
    body: { day: 1000, note: null },
  });
  eq(r.status, 400, 'table-note note non-string → 400');

  // ---------- plage : plafond 60 jours, bornes ----------
  r = await api(base, 'GET', `${cal}/calendar?from=1000&to=1060`, { token: fx.player.token });
  eq(r.status, 400, 'plage de 61 jours → 400');
  r = await api(base, 'GET', `${cal}/calendar?from=1007&to=1003`, { token: fx.player.token });
  eq(r.status, 400, 'from > to → 400');
  r = await api(base, 'GET', `${cal}/calendar?from=0&to=1007`, { token: fx.player.token });
  eq(r.status, 400, 'from 0 → 400');
  r = await api(base, 'GET', `${cal}/calendar?from=1000&to=1059`, { token: fx.player.token });
  eq(r.status, 200, 'plage de 60 jours ok');
  eq(
    r.data.days.map((d: any) => d.day).join(','),
    '1000,1004',
    'jours existants triés, trous absents',
  );
  r = await api(base, 'GET', `${cal}/calendar`, { token: fx.player.token });
  eq(r.status, 200, 'sans query : defaults sur le jour courant');
  eq(r.data.state.day, 1001, 'default from/to = jour courant');

  // ---------- notes privées par personnage ----------
  // le propriétaire écrit
  r = await api(base, 'PUT', `${cal}/day-note`, {
    token: fx.player.token, // bob, propriétaire de Bran
    body: { characterId: fx.charBran.id, day: 1001, note: '  Méfiance envers le marchand.  ' },
  });
  eq(r.status, 200, 'day-note PUT par le propriétaire');
  eq(r.data.note, 'Méfiance envers le marchand.', 'day-note trimée');

  // le propriétaire relit
  r = await api(base, 'GET', `${cal}/day-note?characterId=${fx.charBran.id}&day=1001`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'day-note GET propriétaire');
  eq(r.data.note, 'Méfiance envers le marchand.', 'day-note servie au propriétaire');

  // un AUTRE membre (carol rejoint, ni propriétaire ni MD) → 403 owner-or-GM.
  // 409 « déjà membre » est tout aussi bon : mod-spell-effects la fait
  // rejoindre plus tôt dans la suite SANS la retirer — être membre suffit.
  const join = await api(base, 'POST', '/api/parties/join', {
    token: fx.player2.token,
    body: { inviteCode: fx.inviteCode },
  });
  ok(join.status === 201 || join.status === 409, 'carol rejoint le groupe pour le test isolation');
  r = await api(base, 'GET', `${cal}/day-note?characterId=${fx.charBran.id}&day=1001`, {
    token: fx.player2.token,
  });
  eq(r.status, 403, 'day-note GET par un tiers → 403');
  r = await api(base, 'PUT', `${cal}/day-note`, {
    token: fx.player2.token,
    body: { characterId: fx.charBran.id, day: 1001, note: 'Espionnage ?' },
  });
  eq(r.status, 403, 'day-note PUT par un tiers → 403');

  // le MD peut lire/écrire la note d'un personnage (owner-or-GM)
  r = await api(base, 'GET', `${cal}/day-note?characterId=${fx.charBran.id}&day=1001`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'day-note GET par le MD');
  eq(r.data.note, 'Méfiance envers le marchand.', 'le MD voit la note privée');

  // upsert : mise à jour puis suppression par chaîne vide
  r = await api(base, 'PUT', `${cal}/day-note`, {
    token: fx.player.token,
    body: { characterId: fx.charBran.id, day: 1001, note: 'Version 2' },
  });
  eq(r.data.note, 'Version 2', 'day-note upsert');
  r = await api(base, 'PUT', `${cal}/day-note`, {
    token: fx.player.token,
    body: { characterId: fx.charBran.id, day: 1001, note: '' },
  });
  eq(r.data.note, null, 'day-note vide → null');
  const gone = srv.query(
    'SELECT id FROM campaign_day_notes WHERE party_id = ? AND character_id = ? AND day = 1001',
    P,
    fx.charBran.id,
  );
  ok(!gone, 'day-note vide = ligne supprimée');

  // personnage d'un autre groupe → 404
  r = await api(base, 'PUT', `${cal}/day-note`, {
    token: fx.gm.token,
    body: { characterId: 999999, day: 1001, note: 'X' },
  });
  eq(r.status, 404, 'day-note personnage introuvable → 404');

  // ---------- advance : validations inchangées + archivage préservé ----------
  r = await api(base, 'POST', `${cal}/advance`, {
    token: fx.player.token,
    body: { steps: 0 },
  });
  eq(r.status, 400, 'advance steps 0 → 400');
  r = await api(base, 'POST', `${cal}/advance`, {
    token: fx.player.token,
    body: { steps: 31 },
  });
  eq(r.status, 400, 'advance steps 31 → 400');
  r = await api(base, 'POST', `${cal}/advance`, {
    token: fx.outsider.token,
    body: {},
  });
  eq(r.status, 403, 'advance non-membre → 403');

  // ---------- #191 : les pré-écritures d'un jour futur survivent à l'avance ----------
  // Scénario du ticket : le MD note quelque chose sur un jour en AVANCE (via
  // la zone MD du calendrier — PATCH /campaign-days/:id), puis un JOUEUR
  // avance le jour. L'écriture doit rester lisible quand l'horloge ATTEINT le
  // jour pré-écrit, puis survivre à l'archivage quand le jour est quitté.
  const cal191 = `/api/parties/${P}/campaign`;

  // horloge à 2000, jour futur 2002 pré-écrit par le MD (météo + note MD +
  // journal de table déjà couverts plus haut — ici la pré-écriture MD).
  r = await api(base, 'PATCH', cal191, { token: fx.gm.token, body: { day: 2000 } });
  eq(r.status, 200, '#191 MD corrige le jour à 2000');
  r = await api(base, 'PUT', `${cal191}/table-note`, {
    token: fx.gm.token,
    body: { day: 2002, note: ' jour pré-écrit : garnison au col ' },
  });
  eq(r.status, 200, '#191 journal posé sur le jour futur 2002');
  let row2002 = srv.query('SELECT id FROM campaign_days WHERE party_id = ? AND day = 2002', P) as {
    id: number;
  };
  r = await api(base, 'PATCH', `/api/campaign-days/${row2002.id}`, {
    token: fx.gm.token,
    body: { weather: '❄️ Blizzard', note: 'Attente des renforts.' },
  });
  eq(r.status, 200, '#191 MD pré-écrit météo + note sur 2002');

  // un JOUEUR avance deux fois : l'horloge atteint 2001 puis 2002.
  r = await api(base, 'POST', `${cal191}/advance`, { token: fx.player.token, body: {} });
  eq(r.status, 200, '#191 avance 2000 → 2001');
  r = await api(base, 'POST', `${cal191}/advance`, { token: fx.player.token, body: {} });
  eq(r.status, 200, '#191 avance 2001 → 2002');
  eq(r.data.state.day, 2002, '#191 le jour pré-écrit 2002 devient courant');

  // l'horloge doit porter la pré-écriture (jour futur devenu courant) —
  // c'est le contrat du MD sur la zone réglée du jour courant.
  r = await api(base, 'GET', `${cal191}/calendar?from=2002&to=2002`, { token: fx.gm.token });
  eq(r.data.state.weather, '❄️ Blizzard', '#191 la météo pré-écrite devient celle du jour courant');
  r = await api(base, 'GET', cal191, { token: fx.gm.token });
  eq(r.data.campaign.state.weather, '❄️ Blizzard', '#191 horloge MD : météo pré-écrite');
  eq(r.data.campaign.state.note, 'Attente des renforts.', '#191 horloge MD : note pré-écrite');

  // un joueur avance encore : l'archivage de 2002 DOIT conserver la
  // pré-écriture (l'upsert d'archive écrasait weather/note avec l'horloge
  // vide — le MD perdait son travail sans même l'avoir vu).
  r = await api(base, 'POST', `${cal191}/advance`, { token: fx.player.token, body: {} });
  eq(r.status, 200, '#191 avance 2002 → 2003');
  const archived2002 = srv.query(
    'SELECT weather, note, table_note FROM campaign_days WHERE party_id = ? AND day = 2002',
    P,
  );
  eq(archived2002?.weather, '❄️ Blizzard', "#191 l'archivage garde la météo pré-écrite");
  eq(archived2002?.note, 'Attente des renforts.', "#191 l'archivage garde la note MD pré-écrite");
  eq(
    archived2002?.table_note,
    'jour pré-écrit : garnison au col',
    '#191 le journal de table pré-écrit reste intact',
  );

  // les autres molettes du carnet restent GM-only
  r = await api(base, 'PATCH', cal, {
    token: fx.player.token,
    body: { day: 1002 },
  });
  eq(r.status, 403, 'PATCH horloge joueur → 403 (toujours GM)');
  r = await api(base, 'POST', `${cal}/countdowns`, {
    token: fx.player.token,
    body: { label: 'X', targetDay: 1010 },
  });
  eq(r.status, 403, 'countdown joueur → 403 (toujours GM)');
}
