/**
 * full-session — simulation COMPLÈTE d'une partie de JDR, du début à la fin :
 * table montée (inscriptions + code d'invitation), fiches, équipement
 * (munitions, armure, potions, transferts d'objets / bourse / conteneur),
 * carnet du MD (horloge, notes, quêtes, rebours), combat complet (gobelins
 * groupés, initiative, tours, dégâts, conditions, concentration annoncée sur
 * le WS, masque de nom, pushes « lance ton initiative » / « À toi de jouer »),
 * forme sauvage, repos long, et fin de session (vue d'ensemble du roster,
 * cohérence fiches ↔ traqueur, suppression de la rencontre).
 *
 * MONDE 100 % AUTONOME : nouveaux users, nouvelle party, nouveaux personnages —
 * AUCUNE mutation sur le monde des fixtures (le module s'enregistre EN DERNIER
 * dans MODULES et ne doit pas casser les comptes épinglés des modules précédents).
 */
import { api, eq, type Fixtures, ok, registerUser, type ServerHandle } from './harness.ts';
import { decryptPushBody, makeSubscriptionKeys } from './mod-push.ts';
import type { MockPushRequest } from './mock-push.ts';

const PURSE_COLS = 'copper, silver, electrum, gold, platinum';

function purseRow(srv: ServerHandle, charId: number): number[] {
  const row = srv.query(`SELECT ${PURSE_COLS} FROM characters WHERE id = ?`, charId);
  return [row.copper, row.silver, row.electrum, row.gold, row.platinum];
}

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  void fx; // monde 100 % autonome — les fixtures du runner ne sont JAMAIS touchées

  // ---------- push : un abonnement réel par joueur (mock, clés P-256) ----------
  const keysPerceval = makeSubscriptionKeys();
  const keysKarzak = makeSubscriptionKeys();
  const endpointPerceval = `${srv.push.url}/perceval-fs`;
  const endpointKarzak = `${srv.push.url}/karzak-fs`;
  const seen = new Set<MockPushRequest>();
  const waitForPush = async (
    path: string,
    keys: { ecdh: ECDH; auth: string },
    kind: string,
    timeoutMs = 5000,
    matches?: (payload: any) => boolean,
  ): Promise<any> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (const req of srv.push.requests) {
        if (req.path !== path || seen.has(req)) continue;
        seen.add(req);
        const payload = decryptPushBody(keys.ecdh, keys.auth, req.body);
        if (payload.kind === kind && (!matches || matches(payload))) return payload;
      }
      if (Date.now() > deadline) throw new Error(`push '${kind}' jamais arrivé sur ${path}`);
      await new Promise((res) => setTimeout(res, 150));
    }
  };

  // ============================================================
  // 1. TABLE MONTÉE — inscriptions, party, code d'invitation
  // ============================================================
  let r = await api(base, 'POST', '/api/auth/register', {
    body: { username: 'sans-email-fs', password: 'password123', displayName: 'Incomplet' },
  });
  eq(r.status, 400, 'inscription sans email → 400 (l’adresse est obligatoire)');

  const gm = await registerUser(base, 'merlin-fs'); // le MD
  const perceval = await registerUser(base, 'perceval-fs'); // joueur 1
  const karzak = await registerUser(base, 'karzak-fs'); // joueur 2
  const talgos = await registerUser(base, 'talgos-fs'); // spectateur (autre table)

  r = await api(base, 'POST', '/api/parties', { token: gm.token, body: {} });
  eq(r.status, 400, 'création de groupe sans nom → 400');

  r = await api(base, 'POST', '/api/parties', {
    token: gm.token,
    body: { name: 'Les Boucliers d’Ambre' },
  });
  eq(r.status, 201, 'le MD monte la table');
  ok(r.data.party && typeof r.data.party.id === 'number', 'POST /parties → wrap {party:{id}}');
  ok(
    typeof r.data.party.inviteCode === 'string' && r.data.party.inviteCode.length > 0,
    'wrap {party:{inviteCode}} — le code d’invitation est servi',
  );
  const P = r.data.party.id;
  const inviteCode = r.data.party.inviteCode;

  r = await api(base, 'POST', '/api/parties/join', {
    token: perceval.token,
    body: { inviteCode },
  });
  eq(r.status, 201, 'perceval rejoint via le code d’invitation');
  r = await api(base, 'POST', '/api/parties/join', {
    token: karzak.token,
    body: { inviteCode },
  });
  eq(r.status, 201, 'karzak rejoint via le code d’invitation');

  // ============================================================
  // 2. FICHES — Guerrier / Clerc / Roublard, niveaux, accès
  // ============================================================
  r = await api(base, 'POST', `/api/parties/${P}/characters`, {
    token: karzak.token,
    body: {
      name: 'Karzak',
      characterClass: 'Guerrier',
      level: 5,
      strength: 16,
      dexterity: 10,
      maxHp: 44,
    },
  });
  eq(r.status, 201, 'fiche du Guerrier créée');
  ok(r.data.character && typeof r.data.character.id === 'number', 'création → wrap {character}');
  const guerrier = r.data.character.id;

  r = await api(base, 'POST', `/api/parties/${P}/characters`, {
    token: perceval.token,
    body: {
      name: 'Alune',
      characterClass: 'Clerc',
      level: 5,
      wisdom: 16,
      maxHp: 33,
    },
  });
  eq(r.status, 201, 'fiche du Clerc créée');
  const clerc = r.data.character.id;

  r = await api(base, 'POST', `/api/parties/${P}/characters`, {
    token: perceval.token,
    body: {
      name: 'Ruse',
      characterClass: 'Roublard',
      level: 5,
      dexterity: 18,
      maxHp: 30,
    },
  });
  eq(r.status, 201, 'fiche du Roublard créée');
  const roublard = r.data.character.id;

  // niveaux + override de CA (montée de niveau à la pause kebab)
  r = await api(base, 'PATCH', `/api/characters/${guerrier}`, {
    token: karzak.token,
    body: { level: 6, currentHp: 44 },
  });
  eq(r.status, 200, 'PATCH niveau Guerrier 5 → 6');
  r = await api(base, 'PATCH', `/api/characters/${roublard}`, {
    token: perceval.token,
    body: { armorClassOverride: 17 },
  });
  eq(r.status, 200, 'PATCH override de CA du Roublard');

  r = await api(base, 'GET', `/api/characters/${roublard}`, { token: perceval.token });
  eq(r.status, 200, 'le propriétaire lit sa fiche');
  eq(r.data.character.level, 5, 'niveau servi');
  eq(r.data.character.armorClassOverride, 17, 'override de CA persisté');
  r = await api(base, 'GET', `/api/characters/${guerrier}`, { token: karzak.token });
  eq(r.data.character.level, 6, 'Guerrier niveau 6 servi');

  // un joueur d'une AUTRE table n'y a pas accès
  r = await api(base, 'POST', '/api/parties', {
    token: talgos.token,
    body: { name: 'Cercle Lointain' },
  });
  eq(r.status, 201, 'la table rivale existe');
  r = await api(base, 'GET', `/api/characters/${guerrier}`, { token: talgos.token });
  eq(r.status, 403, 'fiche lue par un non-membre d’un autre groupe → 403');

  // ============================================================
  // 3. ÉQUIPEMENT — armes, munitions, armure, potions, transferts
  // ============================================================
  const item = (srdIndex: string): number => {
    const row = srv.query('SELECT id FROM items WHERE srd_index = ?', srdIndex);
    ok(row, `objet de catalogue « ${srdIndex} » présent au seed`);
    return row.id;
  };
  const epee = item('longsword');
  const fleches = item('arrow');
  const cotte = item('chain-mail');
  const potion = item('potion-of-healing-common');
  const sac = item('backpack');
  const torche = item('torch');

  const addInv = async (
    charId: number,
    token: string,
    itemId: number,
    quantity: number,
    extra: Record<string, unknown> = {},
  ): Promise<any> => {
    const res = await api(base, 'POST', `/api/characters/${charId}/inventory`, {
      token,
      body: { itemId, quantity, ...extra },
    });
    eq(res.status, 201, `objet ajouté à l’inventaire de ${charId}`);
    ok(res.data.entry && typeof res.data.entry.id === 'number', 'ajout → wrap {entry}');
    return res.data.entry;
  };

  r = await api(base, 'POST', `/api/characters/${guerrier}/inventory`, {
    token: karzak.token,
    body: {},
  });
  eq(r.status, 400, 'ajout d’objet sans itemId → 400');

  const entryEpee = await addInv(guerrier, karzak.token, epee, 1);
  const entryFleches = await addInv(guerrier, karzak.token, fleches, 20);
  const entryCotte = await addInv(guerrier, karzak.token, cotte, 1);
  await addInv(clerc, perceval.token, potion, 2);

  // munitions : un tir décrémente le lot (interception #143)
  r = await api(base, 'POST', `/api/characters/${guerrier}/consume`, {
    token: karzak.token,
    body: { type: 'ammo' },
  });
  eq(r.status, 400, 'tir sans genre de munition → 400');
  r = await api(base, 'POST', `/api/characters/${guerrier}/consume`, {
    token: karzak.token,
    body: { type: 'ammo', ammo: 'arrow' },
  });
  eq(r.status, 200, 'tir à l’arc : une flèche consommée');
  eq(
    srv.query('SELECT quantity AS q FROM inventory WHERE id = ?', entryFleches.id).q,
    19,
    'lot de flèches 20 → 19 après un tir',
  );
  eq(
    srv.query(
      "SELECT COUNT(*) AS n FROM transactions WHERE character_id = ? AND reason = 'consume-ammo'",
      guerrier,
    ).n,
    1,
    'le tir entre au journal',
  );

  // armure équipée : la CA dérivée suivra (recalcul au prochain miroir + roster)
  r = await api(base, 'PATCH', `/api/inventory/${entryCotte.id}`, {
    token: karzak.token,
    body: { equipped: true },
  });
  eq(r.status, 200, 'cotte de mailles équipée');
  eq(r.data.entry.equipped, true, 'drapeau équipé servi');
  await api(base, 'PATCH', `/api/inventory/${entryEpee.id}`, {
    token: karzak.token,
    body: { equipped: true },
  });

  // potion bue à la pause : une unité en moins (le soin s'applique à la main)
  const entryPotion = await addInv(guerrier, karzak.token, potion, 2);
  await api(base, 'PATCH', `/api/characters/${guerrier}`, {
    token: karzak.token,
    body: { currentHp: 26 },
  });
  r = await api(base, 'PATCH', `/api/inventory/${entryPotion.id}`, {
    token: karzak.token,
    body: { quantity: 1 },
  });
  eq(r.status, 200, 'une potion bue (2 → 1)');
  r = await api(base, 'GET', `/api/characters/${guerrier}`, { token: karzak.token });
  eq(r.data.character.currentHp, 26, 'le joueur applique le soin 2d4+2 à la main sur sa fiche');
  // avant l'embuscade, tout le monde est au complet
  await api(base, 'PATCH', `/api/characters/${guerrier}`, {
    token: karzak.token,
    body: { currentHp: 44 },
  });

  // transfert d'objets : Karzak file 5 flèches à Alune
  r = await api(base, 'POST', `/api/characters/${guerrier}/transfer`, {
    token: karzak.token,
    body: { toCharacterId: clerc, inventoryId: entryFleches.id, quantity: 5 },
  });
  eq(r.status, 200, 'transfert de 5 flèches accepté');
  eq(r.data.transferred, 5, 'réponse {transferred:5}');
  eq(
    srv.query(
      'SELECT quantity AS q FROM inventory WHERE character_id = ? AND item_id = ?',
      clerc,
      fleches,
    ).q,
    5,
    'Alune porte bien 5 flèches',
  );

  // transfert de bourse : casse minimale chez le donneur (#160)
  const setPurse = async (charId: number, token: string, coins: Record<string, number>) => {
    const res = await api(base, 'PATCH', `/api/characters/${charId}`, { token, body: coins });
    eq(res.status, 200, `bourse posée sur ${charId}`);
  };
  await setPurse(guerrier, karzak.token, {
    copper: 30,
    silver: 0,
    electrum: 0,
    gold: 2,
    platinum: 0,
  });
  await setPurse(clerc, perceval.token, {
    copper: 0,
    silver: 0,
    electrum: 0,
    gold: 0,
    platinum: 0,
  });
  r = await api(base, 'POST', `/api/characters/${guerrier}/transfer-coins`, {
    token: karzak.token,
    body: { toCharacterId: clerc, amounts: { sp: 7 } },
  });
  eq(r.status, 200, 'transfert de 7 PA accepté');
  eq(
    JSON.stringify(purseRow(srv, guerrier)),
    JSON.stringify([0, 6, 0, 1, 0]),
    'donneur : 30 PC payés, 1 PO cassée en 10 PA → rendu minimal 6 PA · 1 PO',
  );
  eq(
    JSON.stringify(purseRow(srv, clerc)),
    JSON.stringify([0, 7, 0, 0, 0]),
    'receveur crédité exactement de la répartition demandée (7 PA)',
  );

  // conteneur : le sac de Karzak part chez Alune AVEC son contenu
  r = await api(base, 'POST', `/api/characters/${guerrier}/locations`, {
    token: karzak.token,
    body: { name: 'Sac d’exploration', type: 'container', itemId: sac },
  });
  eq(r.status, 201, 'conteneur créé');
  const sacLoc = r.data.location;
  await addInv(guerrier, karzak.token, sac, 1);
  await addInv(guerrier, karzak.token, torche, 5, { storageLocationId: sacLoc.id });
  r = await api(base, 'POST', `/api/characters/${guerrier}/transfer-container`, {
    token: karzak.token,
    body: { toCharacterId: clerc, locationId: sacLoc.id },
  });
  eq(r.status, 200, 'conteneur transféré');
  eq(
    srv.query('SELECT character_id AS c FROM storage_locations WHERE id = ?', sacLoc.id).c,
    clerc,
    'le conteneur déménage chez le receveur',
  );
  eq(
    srv.query(
      'SELECT character_id AS c FROM inventory WHERE storage_location_id = ? AND item_id = ?',
      sacLoc.id,
      torche,
    ).c,
    clerc,
    'le contenu suit le conteneur',
  );

  // ============================================================
  // 4. CAMPAGNE DU MD — carnet, horloge, notes, quêtes, rebours
  // ============================================================
  r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: perceval.token });
  eq(r.status, 403, 'carnet réservé au MD → 403 joueur');
  r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: gm.token });
  eq(r.status, 200, 'carnet créé paresseusement au premier accès du MD');
  eq(r.data.campaign.state.day, 1, 'l’horloge démarre au jour 1');
  eq(r.data.campaign.state.weather, null, 'pas de météo au premier jour');

  r = await api(base, 'POST', `/api/parties/${P}/campaign/advance`, { token: gm.token, body: {} });
  eq(r.status, 200, 'le MD avance d’un jour');
  eq(r.data.state.day, 2, 'jour 1 → 2');
  eq(r.data.state.weather, null, 'nouveau jour : météo effacée');

  r = await api(base, 'PATCH', `/api/parties/${P}/campaign`, {
    token: gm.token,
    body: { weather: '🌧️ Orage de mi-saison', note: 'La piste des gobelins est piégée.' },
  });
  eq(r.status, 200, 'météo + note du jour posées');
  eq(r.data.state.weather, '🌧️ Orage de mi-saison', 'météo du jour 2');
  eq(r.data.state.note, 'La piste des gobelins est piégée.', 'note du jour 2');

  r = await api(base, 'POST', `/api/parties/${P}/campaign/advance`, { token: gm.token, body: {} });
  eq(r.data.state.day, 3, 'avance vers le jour 3');
  const day2 = r.data.state.day; // jour courant = 3, le jour 2 est archivé
  eq(day2, 3, 'le jour courant est bien le 3');
  eq(r.data.state.weather, null, 'le jour 3 démarre sans météo');

  // notes du carnet : CRUD + reorder
  r = await api(base, 'POST', `/api/parties/${P}/dm-notes`, {
    token: gm.token,
    body: { title: 'Le chef gobelin', content: 'Il **siffle** ses ordres.' },
  });
  eq(r.status, 201, 'note du MD créée');
  ok(r.data.note && typeof r.data.note.id === 'number', 'note → wrap {note}');
  const note1 = r.data.note;
  r = await api(base, 'POST', `/api/parties/${P}/dm-notes`, {
    token: gm.token,
    body: { title: 'Tribut du village' },
  });
  const note2 = r.data.note;
  eq(note2.sortOrder, note1.sortOrder + 1, 'les notes s’ajoutent à la fin');

  r = await api(base, 'PATCH', `/api/dm-notes/${note1.id}`, {
    token: gm.token,
    body: { content: 'Il siffle ses ordres — **embuscade coordonnée**.' },
  });
  eq(r.status, 200, 'note retouchée');
  eq(r.data.note.content, 'Il siffle ses ordres — **embuscade coordonnée**.', 'contenu mis à jour');

  r = await api(base, 'PATCH', `/api/parties/${P}/dm-notes/order`, {
    token: gm.token,
    body: { order: [note2.id, note1.id] },
  });
  eq(r.status, 200, 'notes réordonnées');
  r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: gm.token });
  eq(r.data.campaign.notes[0].id, note2.id, 'le nouvel ordre est servi');

  r = await api(base, 'DELETE', `/api/dm-notes/${note2.id}`, { token: gm.token });
  eq(r.status, 204, 'note supprimée');

  // quêtes : cycle preparation → active → done
  r = await api(base, 'POST', `/api/parties/${P}/dm-quests`, {
    token: gm.token,
    body: { title: 'Nettoyer la piste' },
  });
  eq(r.status, 201, 'quête créée');
  eq(r.data.quest.status, 'preparation', 'la quête démarre en préparation');
  const quest = r.data.quest;
  r = await api(base, 'PATCH', `/api/dm-quests/${quest.id}`, {
    token: gm.token,
    body: { status: 'active', body: 'Relever le camp gobelin au **kilomètre 4**.' },
  });
  eq(r.status, 200, 'quête activée');
  eq(r.data.quest.status, 'active', 'statut actif');
  r = await api(base, 'PATCH', `/api/dm-quests/${quest.id}`, {
    token: gm.token,
    body: { status: 'done' },
  });
  eq(r.status, 200, 'quête terminée');
  eq(r.data.quest.status, 'done', 'statut done');
  r = await api(base, 'DELETE', `/api/dm-quests/${quest.id}`, { token: gm.token });
  eq(r.status, 204, 'quête archivée supprimée');

  // compte à rebours
  r = await api(base, 'POST', `/api/parties/${P}/campaign/countdowns`, {
    token: gm.token,
    body: { label: 'Rituel du roi sorcier', targetDay: 9 },
  });
  eq(r.status, 201, 'compte à rebours créé');
  eq(r.data.countdown.targetDay, 9, 'cible absolue jour 9');
  const countdown = r.data.countdown;
  r = await api(base, 'PATCH', `/api/campaign-countdowns/${countdown.id}`, {
    token: gm.token,
    body: { targetDay: 8 },
  });
  eq(r.status, 200, 'rebours rapproché au jour 8');

  // lecture complète du carnet : état + registre + notes + quêtes + rebours
  r = await api(base, 'GET', `/api/parties/${P}/campaign`, { token: gm.token });
  eq(r.data.campaign.days.length, 1, 'le jour 2 (météo + note) est au registre');
  eq(r.data.campaign.days[0].day, 2, 'registre : le jour 2');
  eq(r.data.campaign.days[0].weather, '🌧️ Orage de mi-saison', 'météo figée avec le jour');
  ok(r.data.campaign.notes.length === 1, 'une seule note reste au carnet');
  eq(r.data.campaign.quests.length, 0, 'quêtes vidées');
  eq(r.data.campaign.countdowns[0].targetDay, 8, 'rebours servi dans le carnet complet');

  // ============================================================
  // 5. LE COMBAT — gobelins, initiative, tours, dégâts, concentration
  // ============================================================
  // abonnements push avant le geste (les déclencheurs partent à l'ajout)
  r = await api(base, 'POST', '/api/push/subscribe', {
    token: perceval.token,
    body: { endpoint: endpointPerceval, keys: keysPerceval },
  });
  eq(r.status, 201, 'perceval abonné aux notifications');
  r = await api(base, 'POST', '/api/push/subscribe', {
    token: karzak.token,
    body: { endpoint: endpointKarzak, keys: keysKarzak },
  });
  eq(r.status, 201, 'karzak abonné aux notifications');

  r = await api(base, 'POST', `/api/parties/${P}/encounters`, {
    token: perceval.token,
    body: { name: 'Tentative joueur' },
  });
  eq(r.status, 403, 'seul le MD crée une rencontre → 403');
  r = await api(base, 'POST', `/api/parties/${P}/encounters`, { token: gm.token, body: {} });
  eq(r.status, 400, 'rencontre sans nom → 400');

  r = await api(base, 'POST', `/api/parties/${P}/encounters`, {
    token: gm.token,
    body: { name: 'Embuscade gobeline' },
  });
  eq(r.status, 201, 'rencontre créée');
  ok(r.data.encounter && typeof r.data.encounter.id === 'number', 'rencontre → wrap {encounter}');
  eq(r.data.encounter.status, 'setup', 'la rencontre démarre en préparation');
  const enc = r.data.encounter.id;

  const goblin = srv.query(
    "SELECT slug, name_fr FROM monsters WHERE slug = 'gobelin' AND hit_dice IS NOT NULL",
  );
  ok(goblin, 'le gobelin existe au bestiaire (slug FR)');
  r = await api(base, 'POST', `/api/encounters/${enc}/combatants/monster`, {
    token: gm.token,
    body: { monsterSlug: 'pas-un-monstre' },
  });
  eq(r.status, 404, 'monstre inconnu → 404');
  r = await api(base, 'POST', `/api/encounters/${enc}/combatants/monster`, {
    token: gm.token,
    body: { monsterSlug: goblin.slug, count: 3 },
  });
  eq(r.status, 201, '3 gobelins ajoutés en groupe');
  ok(
    Array.isArray(r.data.combatants) && r.data.combatants.length === 3,
    'ajout de monstres → wrap {combatants:[…]} (3 lignes)',
  );
  const gobelins = r.data.combatants;
  ok(
    gobelins.every((c: any) => c.groupId === gobelins[0].groupId),
    'les 3 gobelins partagent un groupe',
  );
  ok(
    gobelins.every((c: any) => c.nameHidden === false),
    'name_hidden à false : pas de masque automatique',
  );
  ok(
    gobelins.every((c: any) => c.hitPoints > 0),
    'les PV de dé se sont lancés',
  );
  eq(
    srv.query('SELECT name_hidden AS n FROM combatants WHERE id = ?', gobelins[0].id).n,
    0,
    'name_hidden stocké à 0 en base',
  );

  r = await api(base, 'POST', `/api/encounters/${enc}/combatants/player`, {
    token: gm.token,
    body: { characterId: guerrier },
  });
  eq(r.status, 201, 'Guerrier ajouté au combat');
  const guerrierComb = r.data.combatants[0];
  eq(guerrierComb.hitPoints, 44, 'PV du combatant issus de la fiche (44)');
  r = await api(base, 'POST', `/api/encounters/${enc}/combatants/player`, {
    token: gm.token,
    body: { characterIds: [clerc, roublard] },
  });
  eq(r.status, 201, 'Clerc + Roublard ajoutés (multi-ajout)');
  const clercComb = r.data.combatants.find((c: any) => c.characterId === clerc);
  const roublardComb = r.data.combatants.find((c: any) => c.characterId === roublard);
  ok(clercComb && roublardComb, 'wrap {combatants} porte les deux PJ');
  eq(clercComb.hitPoints, 33, 'PV du Clerc miroir de sa fiche');

  // « lance ton initiative » : un push par propriétaire, deep-link fiche
  const initPerceval = await waitForPush('/perceval-fs', keysPerceval, 'initiative');
  eq(
    initPerceval.url,
    `/party/${P}/character/${clerc}?combat=init`,
    'push initiative deep-link Alune avec l’UI d’initiative déployée',
  );
  const initKarzak = await waitForPush('/karzak-fs', keysKarzak, 'initiative');
  eq(initKarzak.tag, `init:${enc}`, 'push initiative étiqueté par rencontre');

  // initiative : le joueur pose la sienne, le MD pose celle du groupe
  r = await api(base, 'PATCH', `/api/encounters/${enc}/combatants/${clercComb.id}/initiative`, {
    token: perceval.token,
    body: { initiative: 15 },
  });
  eq(r.status, 200, 'le joueur pose l’initiative de SON personnage');
  r = await api(base, 'PATCH', `/api/encounters/${enc}/combatants/${roublardComb.id}/initiative`, {
    token: karzak.token,
    body: { initiative: 10 },
  });
  eq(r.status, 403, 'un joueur ne pose pas l’initiative d’un autre → 403');
  r = await api(base, 'PATCH', `/api/encounters/${enc}/combatants/${guerrierComb.id}/initiative`, {
    token: karzak.token,
    body: { initiative: 18 },
  });
  eq(r.status, 200, 'Karzak pose son initiative (18)');
  r = await api(base, 'PATCH', `/api/encounters/${enc}/combatants/${gobelins[0].id}/initiative`, {
    token: gm.token,
    body: { initiative: 12 },
  });
  eq(r.status, 200, 'le MD pose l’initiative du groupe gobelin');
  ok(
    srv
      .queryAll('SELECT initiative AS i FROM combatants WHERE group_id = ?', gobelins[0].groupId)
      .every((g: any) => g.i === 12),
    'tout le groupe gobelin partage l’initiative (12)',
  );

  // démarrage : setup → actif, le Guerrier (18) ouvre la marche
  r = await api(base, 'POST', `/api/encounters/${enc}/next-turn`, { token: gm.token });
  eq(r.status, 200, 'le combat démarre');
  eq(r.data.encounter.status, 'active', 'rencontre active');
  eq(r.data.encounter.round, 1, 'round 1');
  eq(r.data.encounter.turnIndex, 0, 'le Guerrier tient le premier tour');
  const turnKarzak = await waitForPush('/karzak-fs', keysKarzak, 'turn');
  ok(String(turnKarzak.body).includes('Karzak'), '« À toi de jouer » nomme le Guerrier');
  eq(turnKarzak.tag, `turn:${enc}`, 'push de tour étiqueté par rencontre');

  // tour suivant : le Clerc
  r = await api(base, 'POST', `/api/encounters/${enc}/next-turn`, { token: gm.token });
  eq(r.data.encounter.turnIndex, 1, 'le tour passe au Clerc');
  // le joueur clôt LUI-MÊME son tour → le groupe gobelin enchaîne
  r = await api(base, 'POST', `/api/encounters/${enc}/end-my-turn`, { token: perceval.token });
  eq(r.status, 200, 'perceval clôt le tour d’Alune');
  r = await api(base, 'GET', `/api/encounters/${enc}`, { token: gm.token });
  eq(
    r.data.encounter.combatants[r.data.encounter.turnIndex].type,
    'monster',
    'après la clôture joueur, les gobelins ont la main',
  );

  // avance jusqu'au wrap de round 2 — l'ordre tourne
  let round = 1;
  for (let i = 0; i < 8 && round < 2; i++) {
    r = await api(base, 'POST', `/api/encounters/${enc}/next-turn`, { token: gm.token });
    eq(r.status, 200, 'avance de tour');
    ok(r.data.encounter.round >= round, 'le round ne recule jamais');
    round = r.data.encounter.round;
  }
  eq(round, 2, 'round 2 atteint — l’ordre tourne');
  eq(r.data.encounter.turnIndex, 0, 'round 2 : retour au sommet de l’initiative');
  r = await api(base, 'GET', `/api/encounters/${enc}`, { token: gm.token });
  eq(r.data.encounter.combatants[0].id, guerrierComb.id, 'le Guerrier rouvre le round 2');
  const turnPerceval = await waitForPush('/perceval-fs', keysPerceval, 'turn', 5000, (payload) =>
    String(payload.body).includes('Ruse'),
  );
  ok(String(turnPerceval.body).includes('Ruse'), 'le push de tour nomme le Roublard à son tour');

  // dégâts sur un gobelin : défaite à 0
  r = await api(base, 'PATCH', `/api/combatants/${gobelins[0].id}`, {
    token: gm.token,
    body: { hitPoints: 0 },
  });
  eq(r.status, 200, 'gobelin abattu');
  eq(r.data.combatant.defeated, true, 'PV à 0 → defeated');

  // dégâts sur un PJ : miroir vers la fiche
  r = await api(base, 'PATCH', `/api/combatants/${roublardComb.id}`, {
    token: gm.token,
    body: { hitPoints: 22 },
  });
  eq(r.status, 200, 'le Roublard encaisse au traqueur');
  r = await api(base, 'GET', `/api/characters/${roublard}`, { token: perceval.token });
  eq(r.data.character.currentHp, 22, 'miroir traqueur → fiche : 22 PV lus sur la fiche');

  // condition « Renversé » posée au traqueur : miroir traqueur ET fiche
  r = await api(base, 'PATCH', `/api/combatants/${roublardComb.id}`, {
    token: gm.token,
    body: { conditions: [{ name: 'Renversé', duration: 2 }] },
  });
  eq(r.status, 200, 'Renversé posé au traqueur');
  ok(
    srv
      .query('SELECT conditions AS c FROM characters WHERE id = ?', roublard)
      .c.includes('Renversé'),
    'la condition est miroir sur la fiche',
  );
  ok(
    JSON.parse(
      srv.query('SELECT conditions AS c FROM combatants WHERE id = ?', roublardComb.id).c,
    ).some((c: any) => c.name === 'Renversé'),
    'la condition est portée par le traqueur',
  );

  // concentration : Alune lance Bouclier de la foi (+2 CA), puis encaisse —
  // le jet de sauvegarde est ANNONCÉ sur le WebSocket (combat:change).
  const faith = srv.query("SELECT id FROM spells WHERE srd_index = 'shield-of-faith'");
  ok(faith, 'Bouclier de la foi seedé');
  r = await api(base, 'POST', `/api/characters/${clerc}/spell-effects`, {
    token: perceval.token,
    body: { spellId: faith.id },
  });
  eq(r.status, 201, 'Alune lance Bouclier de la foi');
  eq(r.data.effect.acValue, 2, 'l’effet vaut +2 CA');
  eq(
    srv.query('SELECT concentrating AS c FROM characters WHERE id = ?', clerc).c,
    1,
    'poser un effet concentré → concentration active',
  );
  eq(
    srv.query('SELECT armor_class AS ac FROM combatants WHERE id = ?', clercComb.id).ac,
    12,
    'CA du combatant 10 → 12 avec l’effet actif',
  );

  const ws = new WebSocket(
    `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(gm.token)}`,
  );
  const wsMessages: any[] = [];
  ws.addEventListener('message', (ev) => wsMessages.push(JSON.parse(String(ev.data))));
  // CodeRabbit #289 : l'ouverture doit avoir une limite — une connexion qui
  // échoue ne doit pas faire pendre la promesse (pattern mod-spell-effects).
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ouverture WS > 5 s')), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('connexion WS échouée'));
    });
  });
  r = await api(base, 'PATCH', `/api/combatants/${clercComb.id}`, {
    token: gm.token,
    body: { hitPoints: 30 },
  });
  eq(r.status, 200, 'Alune encaisse 3 dégâts en concentration');
  const wsConc = await new Promise<any>((resolve, reject) => {
    const started = Date.now();
    const t = setInterval(() => {
      const hit = wsMessages.find((m) => m.type === 'combat:change' && m.concentration);
      if (hit) {
        clearInterval(t);
        resolve(hit.concentration);
      } else if (Date.now() - started > 5000) {
        clearInterval(t);
        reject(new Error('aucune annonce de concentration sur le WS'));
      }
    }, 25);
  });
  eq(wsConc.damage, 3, 'le WS annonce les dégâts (3) pour le jet de concentration');
  eq(wsConc.dc, 10, 'DD 10 pour 3 dégâts');
  ws.close();
  // jet raté : Alune lâche le sort → l'effet tombe, la CA du combatant suit
  r = await api(base, 'PATCH', `/api/characters/${clerc}`, {
    token: perceval.token,
    body: { concentrating: false },
  });
  eq(r.status, 200, 'jet raté : concentration lâchée');
  eq(
    srv.query('SELECT armor_class AS ac FROM combatants WHERE id = ?', clercComb.id).ac,
    10,
    'CA du combatant retombée à 10',
  );
  r = await api(base, 'GET', `/api/characters/${clerc}/spell-effects`, { token: perceval.token });
  eq(r.data.effects.length, 0, 'plus aucun effet CA actif');

  // masque de nom : le MD cache un gobelin, le joueur voit « Créature inconnue »
  r = await api(base, 'PATCH', `/api/combatants/${gobelins[2].id}`, {
    token: gm.token,
    body: { nameHidden: true },
  });
  eq(r.status, 200, 'le MD masque le 3ᵉ gobelin');
  r = await api(base, 'GET', `/api/encounters/${enc}`, { token: perceval.token });
  const maskedForPlayer = r.data.encounter.combatants.find((c: any) => c.id === gobelins[2].id);
  eq(maskedForPlayer.name, 'Créature inconnue', 'le joueur lit « Créature inconnue »');
  eq(maskedForPlayer.nameHidden, true, 'le drapeau de masque voyage pour l’UI');
  r = await api(base, 'GET', `/api/encounters/${enc}`, { token: gm.token });
  eq(
    r.data.encounter.combatants.find((c: any) => c.id === gobelins[2].id).name,
    goblin.name_fr,
    'le MD lit toujours le vrai nom',
  );

  // ============================================================
  // 6. FORME SAUVAGE — le Druide se transforme en ours noir
  // ============================================================
  r = await api(base, 'POST', `/api/parties/${P}/characters`, {
    token: karzak.token,
    body: {
      name: 'Sylvestre',
      characterClass: 'Druide',
      level: 3,
      dexterity: 14,
      maxHp: 22,
    },
  });
  eq(r.status, 201, 'fiche du Druide créée');
  const druide = r.data.character.id;
  r = await api(base, 'PATCH', `/api/characters/${druide}`, {
    token: karzak.token,
    body: { druidCircle: 'lune', wildShapeSeen: ['ours-noir'], currentHp: 22 },
  });
  eq(r.status, 200, 'cercle de la Lune + ours noir vu');

  r = await api(base, 'POST', `/api/characters/${druide}/wild-shape`, {
    token: karzak.token,
    body: { slug: 'ours-noir' },
  });
  eq(r.status, 201, 'Sylvestre se transforme en ours noir (slug FR)');
  ok(r.data.shape.hp > 0, 'les PV de forme se lancent');
  const shapeHp = r.data.shape.hp;
  eq(
    srv.query(
      'SELECT wild_shape_slug AS s, wild_shape_hp AS h FROM characters WHERE id = ?',
      druide,
    ).s,
    'ours-noir',
    'la forme est stockée',
  );
  eq(
    srv.query('SELECT wild_shape_uses AS u FROM characters WHERE id = ?', druide).u,
    1,
    'un usage consommé (2 → 1)',
  );

  // dégâts reportés sur la barre de forme : la fiche saine ne bouge pas
  r = await api(base, 'PATCH', `/api/characters/${druide}`, {
    token: karzak.token,
    body: { currentHp: shapeHp - 5 },
  });
  eq(r.status, 200, 'l’ours encaisse 5 dégâts');
  eq(
    srv.query('SELECT wild_shape_hp AS h FROM characters WHERE id = ?', druide).h,
    shapeHp - 5,
    'les dégâts frappent la barre de forme',
  );
  eq(
    srv.query('SELECT current_hp AS h FROM characters WHERE id = ?', druide).h,
    22,
    'les PV normaux restent intacts',
  );

  // la forme tombe à 0 → revert automatique AVEC report d'excédent
  r = await api(base, 'PATCH', `/api/characters/${druide}`, {
    token: karzak.token,
    body: { currentHp: -shapeHp },
  });
  eq(r.status, 200, 'la barre de forme tombe à 0');
  const reverted = srv.query(
    'SELECT wild_shape_slug AS s, current_hp AS h FROM characters WHERE id = ?',
    druide,
  );
  eq(reverted.s, null, 'revert automatique de la forme');
  eq(
    reverted.h,
    Math.max(0, 22 - shapeHp),
    'l’excédent de dégâts est reporté sur la forme normale',
  );
  await api(base, 'PATCH', `/api/characters/${druide}`, {
    token: karzak.token,
    body: { currentHp: 22 },
  });

  // ============================================================
  // 7. REPOS — repos long du Guerrier + monnaie (don / dépense)
  // ============================================================
  await api(base, 'PATCH', `/api/characters/${guerrier}`, {
    token: karzak.token,
    body: { currentHp: 20, exhaustion: 1, conditions: ['Aveuglé'], hitDiceUsed: 3 },
  });
  r = await api(base, 'POST', `/api/characters/${guerrier}/rest`, {
    token: karzak.token,
    body: { type: 'long' },
  });
  eq(r.status, 200, 'repos long du Guerrier');
  const rested = srv.query(
    'SELECT current_hp AS hp, hit_dice_used AS hd, exhaustion AS ex, conditions AS c FROM characters WHERE id = ?',
    guerrier,
  );
  eq(rested.hp, 44, 'repos long : PV restaurés au max (44)');
  eq(rested.hd, 0, 'dés de vie restaurés (3 utilisés → 0)');
  eq(rested.ex, 0, 'épuisement effacé');
  eq(JSON.parse(rested.c).length, 0, 'les conditions sont effacées par le repos long');
  eq(r.data.character.conditions.length, 0, 'la réponse confirme l’état propre');

  // bourse : le MD « donne » 25 PO, Karzak dépense 1 PO 3 PA chez Ruse
  await setPurse(guerrier, karzak.token, {
    copper: 0,
    silver: 0,
    electrum: 0,
    gold: 25,
    platinum: 0,
  });
  await setPurse(roublard, perceval.token, {
    copper: 0,
    silver: 0,
    electrum: 0,
    gold: 0,
    platinum: 0,
  });
  r = await api(base, 'POST', `/api/characters/${guerrier}/transfer-coins`, {
    token: karzak.token,
    body: { toCharacterId: roublard, amounts: { gp: 1, sp: 3 } },
  });
  eq(r.status, 200, 'dépense de 1 PO 3 PA acceptée');
  eq(r.data.breaks.length, 1, 'une seule casse : 1 PO cassée pour les 3 PA');
  eq(r.data.breaks[0].unit, 'gp', 'la pièce cassée est une PO');
  eq(
    JSON.stringify(purseRow(srv, guerrier)),
    JSON.stringify([0, 7, 0, 23, 0]),
    'donneur : rendu minimal → 7 PA · 23 PO',
  );
  eq(
    JSON.stringify(purseRow(srv, roublard)),
    JSON.stringify([0, 3, 0, 1, 0]),
    'Ruse encaisse 1 PO · 3 PA',
  );

  // ============================================================
  // 8. FIN DE SESSION — vue d'ensemble, cohérence, rangement
  // ============================================================
  r = await api(base, 'GET', `/api/parties/${P}/roster-overview`, { token: gm.token });
  eq(r.status, 200, 'vue d’ensemble du roster servie');
  const overview = r.data.overview;
  eq(overview.length, 4, 'les 4 fiches sont résumées');
  const byId = new Map<number, any>(overview.map((o: any) => [o.characterId, o]));
  ok(
    [guerrier, clerc, roublard, druide].every((id) => byId.has(id)),
    'chaque personnage a sa ligne',
  );
  eq(byId.get(guerrier).ac, 16, 'Guerrier : cotte de mailles équipée → CA dérivée 16');
  eq(byId.get(clerc).ac, 10, 'Clerc sans armure : CA retombée à 10 (effet lâché)');
  eq(byId.get(roublard).foodCount, 0, 'les compteurs survie sont servis (0 ration)');

  // cohérence finale fiches ↔ traqueur avant le rangement
  const sheetHp = (id: number) =>
    srv.query('SELECT current_hp AS h FROM characters WHERE id = ?', id).h;
  const trackerHp = (id: number) =>
    srv.query('SELECT hit_points AS h FROM combatants WHERE id = ?', id).h;
  eq(trackerHp(guerrierComb.id), sheetHp(guerrier), 'Guerrier : fiche ↔ traqueur synchrones');
  eq(trackerHp(clercComb.id), sheetHp(clerc), 'Clerc : fiche ↔ traqueur synchrones');
  eq(trackerHp(roublardComb.id), sheetHp(roublard), 'Roublard : fiche ↔ traqueur synchrones');

  r = await api(base, 'DELETE', `/api/encounters/${enc}`, { token: perceval.token });
  eq(r.status, 403, 'suppression de rencontre réservée au MD → 403');
  r = await api(base, 'DELETE', `/api/encounters/${enc}`, { token: gm.token });
  eq(r.status, 204, 'le MD range la rencontre');
  r = await api(base, 'GET', `/api/encounters/${enc}`, { token: gm.token });
  eq(r.status, 404, 'la rencontre n’existe plus');

  // état propre : désabonnements push (plus de dispositifs résiduels)
  r = await api(base, 'POST', '/api/push/unsubscribe', {
    token: perceval.token,
    body: { endpoint: endpointPerceval },
  });
  eq(r.status, 204, 'perceval désabonné');
  r = await api(base, 'POST', '/api/push/unsubscribe', {
    token: karzak.token,
    body: { endpoint: endpointKarzak },
  });
  eq(r.status, 204, 'karzak désabonné');
}
