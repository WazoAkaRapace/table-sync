/**
 * Combat tracker: encounters, combatants (monsters grouped + players
 * multi-add), initiative, PATCH combatant (HP/temp-HP/concentration
 * mirrors, conditions sync), next-turn expiry, hidden-character purge,
 * deletes. Covers every .prepare site in routes/combat.ts and the two
 * condition-mirror helpers in routes/helpers.ts.
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

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;

  // ---------- create encounter ----------
  let r = await api(base, 'POST', `/api/parties/${P}/encounters`, {
    token: fx.player.token,
    body: { name: 'X' },
  });
  eq(r.status, 403, 'create encounter non-GM → 403');
  r = await api(base, 'POST', `/api/parties/${P}/encounters`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'create encounter no name → 400');

  r = await api(base, 'POST', `/api/parties/${P}/encounters`, {
    token: fx.gm.token,
    body: { name: 'Embuscade' },
  });
  eq(r.status, 201, 'create encounter');
  const enc = r.data.encounter;
  eq(enc.status, 'setup', 'starts in setup');

  // ---------- add monsters (grouped) ----------
  const goblin =
    srv.query(
      "SELECT slug, hit_dice FROM monsters WHERE name_fr LIKE '%obelin%' AND hit_dice IS NOT NULL LIMIT 1",
    ) ?? srv.query('SELECT slug, hit_dice FROM monsters WHERE hit_dice IS NOT NULL LIMIT 1');

  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/monster`, {
    token: fx.gm.token,
    body: {},
  });
  eq(r.status, 400, 'add monster no slug → 400');
  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/monster`, {
    token: fx.gm.token,
    body: { monsterSlug: 'pas-un-monstre' },
  });
  eq(r.status, 404, 'add unknown monster → 404');
  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/monster`, {
    token: fx.player.token,
    body: { monsterSlug: goblin.slug },
  });
  eq(r.status, 403, 'add monster non-GM → 403');

  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/monster`, {
    token: fx.gm.token,
    body: { monsterSlug: goblin.slug, count: 2 },
  });
  eq(r.status, 201, 'add 2 goblins');
  eq(r.data.combatants.length, 2, 'two combatants created');
  const gob1 = r.data.combatants[0];
  const gob2 = r.data.combatants[1];
  eq(gob1.groupId, gob2.groupId, 'goblins share a group');

  // same slug again → joins the existing group
  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/monster`, {
    token: fx.gm.token,
    body: { monsterSlug: goblin.slug, count: 1, name: 'Gobelin éclaireur' },
  });
  eq(r.status, 201, 'third goblin joins group');
  eq(r.data.combatants[0].groupId, gob1.groupId, 'inherits group id');

  // ---------- add players ----------
  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/player`, {
    token: fx.gm.token,
    body: {},
  });
  eq(r.status, 400, 'add player no ids → 400');
  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/player`, {
    token: fx.player.token,
    body: { characterId: fx.charAlya.id },
  });
  eq(r.status, 403, 'add player non-GM → 403');
  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/player`, {
    token: fx.gm.token,
    body: { characterId: 999999 },
  });
  eq(r.status, 404, 'add unknown character → 404');
  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/player`, {
    token: fx.gm.token,
    body: { characterId: fx.charSecret.id },
  });
  eq(r.status, 400, 'hidden character cannot join a fight');

  const oParty = await createParty(base, fx.outsider.token, 'Hors-groupe');
  const oChar = await createCharacter(base, fx.outsider.token, oParty.id, { name: 'Étranger' });
  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/player`, {
    token: fx.gm.token,
    body: { characterId: oChar.id },
  });
  eq(r.status, 400, 'character from another party → 400');

  r = await api(base, 'POST', `/api/encounters/${enc.id}/combatants/player`, {
    token: fx.gm.token,
    body: { characterIds: [fx.charAlya.id, fx.charBran.id] },
  });
  eq(r.status, 201, 'multi-add players');
  const alyaCombatant = r.data.combatants.find((c: any) => c.characterId === fx.charAlya.id);
  const branCombatant = r.data.combatants.find((c: any) => c.characterId === fx.charBran.id);
  ok(alyaCombatant && branCombatant, 'both players in the fight');
  eq(alyaCombatant.hitPoints, 20, 'combatant hp from sheet');

  // ---------- encounter list & detail ----------
  r = await api(base, 'GET', `/api/parties/${P}/encounters`, { token: fx.gm.token });
  eq(r.status, 200, 'GM encounter list');
  ok(r.data.encounters[0].roster.length > 0, 'roster aggregated');
  eq(r.data.encounters[0].combatantCount, 5, 'all combatants counted');

  r = await api(base, 'GET', `/api/parties/${P}/encounters`, { token: fx.player.token });
  ok(
    r.data.encounters.some((e: any) => e.id === enc.id),
    'player sees fights they are in',
  );

  await api(base, 'POST', '/api/parties/join', {
    token: fx.player2.token,
    body: { inviteCode: fx.inviteCode },
  });
  r = await api(base, 'GET', `/api/parties/${P}/encounters`, { token: fx.player2.token });
  eq(r.data.encounters.length, 0, 'player without combatant sees no fights');
  await api(base, 'DELETE', `/api/parties/${P}/members/${fx.player2.userId}`, {
    token: fx.gm.token,
  });

  r = await api(base, 'GET', `/api/encounters/${enc.id}`, { token: fx.gm.token });
  eq(r.status, 200, 'GM detail');
  ok(
    r.data.encounter.combatants.every((c: any) => c.hitPoints !== null),
    'GM sees all HP',
  );

  r = await api(base, 'GET', `/api/encounters/${enc.id}`, { token: fx.player.token });
  eq(r.status, 200, 'player detail (in encounter)');
  const own = r.data.encounter.combatants.find((c: any) => c.id === branCombatant.id);
  ok(own.hitPoints !== null, 'own combatant keeps HP');
  const otherPlayer = r.data.encounter.combatants.find((c: any) => c.id === alyaCombatant.id);
  eq(otherPlayer.hitPoints, null, "another player's HP redacted");
  const hiddenHp = r.data.encounter.combatants.find((c: any) => c.type === 'monster');
  eq(hiddenHp.hitPoints, null, 'monster HP redacted for players');
  ok(hiddenHp.feeling !== undefined, 'monster gets a feeling tier');

  r = await api(base, 'GET', `/api/encounters/${enc.id}`, { token: fx.outsider.token });
  eq(r.status, 403, 'detail non-member → 403');
  r = await api(base, 'GET', '/api/encounters/999999', { token: fx.gm.token });
  eq(r.status, 404, 'detail 404');

  // ---------- patch encounter ----------
  r = await api(base, 'PATCH', `/api/encounters/${enc.id}`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'patch encounter no fields → 400');
  r = await api(base, 'PATCH', '/api/encounters/999999', {
    token: fx.gm.token,
    body: { name: 'X' },
  });
  eq(r.status, 404, 'patch encounter 404');
  r = await api(base, 'PATCH', `/api/encounters/${enc.id}`, {
    token: fx.player.token,
    body: { name: 'X' },
  });
  eq(r.status, 403, 'patch encounter non-GM → 403');
  r = await api(base, 'PATCH', `/api/encounters/${enc.id}`, {
    token: fx.gm.token,
    body: { name: 'Embuscade gobeline' },
  });
  eq(r.status, 200, 'patch encounter name');
  eq(r.data.encounter.name, 'Embuscade gobeline', 'encounter renamed');

  // ---------- initiative ----------
  r = await api(
    base,
    'PATCH',
    `/api/encounters/${enc.id}/combatants/${branCombatant.id}/initiative`,
    {
      token: fx.player.token,
      body: { initiative: 15 },
    },
  );
  eq(r.status, 200, 'player sets own initiative');
  eq(
    srv.query('SELECT initiative AS i FROM combatants WHERE id = ?', branCombatant.id).i,
    15,
    'initiative stored',
  );

  r = await api(base, 'PATCH', `/api/encounters/${enc.id}/combatants/${gob1.id}/initiative`, {
    token: fx.player.token,
    body: { initiative: 18 },
  });
  eq(r.status, 403, "player cannot set a monster's initiative");

  r = await api(base, 'PATCH', '/api/encounters/999999/combatants/1/initiative', {
    token: fx.gm.token,
    body: { initiative: 5 },
  });
  eq(r.status, 404, 'initiative unknown encounter → 404');
  r = await api(base, 'PATCH', `/api/encounters/${enc.id}/combatants/999999/initiative`, {
    token: fx.gm.token,
    body: { initiative: 5 },
  });
  eq(r.status, 404, 'initiative unknown combatant → 404');
  r = await api(
    base,
    'PATCH',
    `/api/encounters/${enc.id}/combatants/${alyaCombatant.id}/initiative`,
    {
      token: fx.outsider.token,
      body: { initiative: 5 },
    },
  );
  eq(r.status, 403, 'initiative non-member → 403');

  // grouped monster: GM sets one goblin → whole group
  r = await api(base, 'PATCH', `/api/encounters/${enc.id}/combatants/${gob1.id}/initiative`, {
    token: fx.gm.token,
    body: { initiative: 10 },
  });
  eq(r.status, 200, 'GM sets group initiative');
  const groupRows = srv.queryAll(
    'SELECT initiative AS i FROM combatants WHERE group_id = ?',
    gob1.groupId,
  );
  ok(
    groupRows.every((g: any) => g.i === 10),
    'entire group shares initiative',
  );

  // single combatant set by GM (Alya — player-type, ungrouped)
  r = await api(
    base,
    'PATCH',
    `/api/encounters/${enc.id}/combatants/${alyaCombatant.id}/initiative`,
    {
      token: fx.gm.token,
      body: { initiative: 20 },
    },
  );
  eq(r.status, 200, 'GM sets single initiative');
  eq(
    srv.query('SELECT initiative AS i FROM combatants WHERE id = ?', alyaCombatant.id).i,
    20,
    'single initiative stored',
  );

  // ---------- patch combatant ----------
  r = await api(base, 'PATCH', '/api/combatants/999999', {
    token: fx.gm.token,
    body: { hitPoints: 5 },
  });
  eq(r.status, 404, 'patch combatant 404');
  r = await api(base, 'PATCH', `/api/combatants/${alyaCombatant.id}`, {
    token: fx.player.token,
    body: { hitPoints: 5 },
  });
  eq(r.status, 403, 'patch combatant non-GM → 403');
  r = await api(base, 'PATCH', `/api/combatants/${alyaCombatant.id}`, {
    token: fx.gm.token,
    body: {},
  });
  eq(r.status, 400, 'patch combatant no fields → 400');

  r = await api(base, 'PATCH', `/api/combatants/${gob1.id}`, {
    token: fx.gm.token,
    body: {
      name: 'Gobelin alpha',
      count: 2,
      armorClass: 15,
      maxHitPoints: 12,
      cardColor: '#ff0000',
      hitPoints: 12,
    },
  });
  eq(r.status, 200, 'patch monster fields');
  eq(r.data.combatant.defeated, false, 'hp > 0 clears defeated');
  eq(
    srv.query('SELECT card_color AS c FROM combatants WHERE id = ?', gob1.id).c,
    '#ff0000',
    'card color stored',
  );

  // HP 0 → defeated auto-set
  r = await api(base, 'PATCH', `/api/combatants/${gob1.id}`, {
    token: fx.gm.token,
    body: { hitPoints: 0 },
  });
  eq(r.data.combatant.defeated, true, 'hp 0 → defeated');

  // HP mirror to sheet: Alya takes damage via the tracker
  r = await api(base, 'PATCH', `/api/combatants/${alyaCombatant.id}`, {
    token: fx.gm.token,
    body: { hitPoints: 8 },
  });
  eq(
    srv.query('SELECT current_hp AS h FROM characters WHERE id = ?', fx.charAlya.id).h,
    8,
    'tracker damage mirrors to sheet',
  );
  r = await api(base, 'PATCH', `/api/combatants/${alyaCombatant.id}`, {
    token: fx.gm.token,
    body: { maxHitPoints: 25 },
  });
  eq(
    srv.query('SELECT max_hp AS h FROM characters WHERE id = ?', fx.charAlya.id).h,
    25,
    'tracker max hp mirrors',
  );

  // temp-HP absorption: Bran has 5 temp hp, tracker hit for 3 → absorbed
  await api(base, 'PATCH', `/api/characters/${fx.charBran.id}`, {
    token: fx.player.token,
    body: { tempHp: 5, currentHp: 12 },
  });
  r = await api(base, 'PATCH', `/api/combatants/${branCombatant.id}`, {
    token: fx.gm.token,
    body: { hitPoints: 9 },
  });
  eq(r.status, 200, 'temp-absorbed hit');
  eq(r.data.combatant.hitPoints, 12, 'fully absorbed hit leaves the tracker row unchanged');
  eq(
    srv.query('SELECT current_hp AS h FROM characters WHERE id = ?', fx.charBran.id).h,
    12,
    'sheet hp unchanged',
  );
  eq(
    srv.query('SELECT temp_hp AS t FROM characters WHERE id = ?', fx.charBran.id).t,
    2,
    'temp hp partially consumed',
  );

  // concentration: damage while concentrating → the save requirement travels
  // on the combat:change WS event (echo-exempt), not the HTTP response.
  await api(base, 'PATCH', `/api/characters/${fx.charBran.id}`, {
    token: fx.player.token,
    body: { concentrating: true, currentHp: 12 },
  });
  const ws = new WebSocket(
    `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(fx.gm.token)}`,
  );
  const wsMessages: any[] = [];
  ws.addEventListener('message', (ev) => wsMessages.push(JSON.parse(String(ev.data))));
  await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()));
  r = await api(base, 'PATCH', `/api/combatants/${branCombatant.id}`, {
    token: fx.gm.token,
    body: { hitPoints: 6 },
  });
  eq(r.status, 200, 'concentration-damage patch ok');
  const wsConc = await new Promise<any>((resolve, reject) => {
    const started = Date.now();
    const t = setInterval(() => {
      const hit = wsMessages.find((m) => m.type === 'combat:change' && m.concentration);
      if (hit) {
        clearInterval(t);
        resolve(hit.concentration);
      } else if (Date.now() - started > 5000) {
        clearInterval(t);
        reject(new Error('no concentration on ws'));
      }
    }, 25);
  });
  eq(wsConc.damage, 6, 'concentration save triggered (via WS)');
  eq(wsConc.dc, 10, 'dc 10 for 6 damage');
  ws.close();

  // unconscious via tracker → concentration auto-ends on the sheet
  r = await api(base, 'PATCH', `/api/combatants/${branCombatant.id}`, {
    token: fx.gm.token,
    body: { hitPoints: 0 },
  });
  eq(
    srv.query('SELECT concentrating AS c FROM characters WHERE id = ?', fx.charBran.id).c,
    0,
    'concentration ended at 0 hp',
  );

  // conditions tracker → sheet mirror
  r = await api(base, 'PATCH', `/api/combatants/${branCombatant.id}`, {
    token: fx.gm.token,
    body: { conditions: [{ name: 'Empoisonné', duration: 3 }], hitPoints: 10 },
  });
  ok(
    srv
      .query('SELECT conditions AS c FROM characters WHERE id = ?', fx.charBran.id)
      .c.includes('Empoisonné'),
    'condition mirrored to sheet',
  );
  r = await api(base, 'PATCH', `/api/combatants/${branCombatant.id}`, {
    token: fx.gm.token,
    body: { conditions: [] },
  });
  ok(
    !srv
      .query('SELECT conditions AS c FROM characters WHERE id = ?', fx.charBran.id)
      .c.includes('Empoisonné'),
    'condition removal mirrored',
  );

  // incapacitating condition via tracker breaks concentration
  await api(base, 'PATCH', `/api/characters/${fx.charBran.id}`, {
    token: fx.player.token,
    body: { concentrating: true },
  });
  r = await api(base, 'PATCH', `/api/combatants/${branCombatant.id}`, {
    token: fx.gm.token,
    body: { conditions: [{ name: 'Paralysé', duration: 1 }] },
  });
  eq(r.data.concentrationBroken, 'Paralysé', 'paralyzed breaks concentration');

  // conditions sheet → tracker mirror (helpers.ts)
  r = await api(base, 'PATCH', `/api/characters/${fx.charAlya.id}`, {
    token: fx.gm.token,
    body: { conditions: ['Aveuglé'] },
  });
  let combatantConds = JSON.parse(
    srv.query('SELECT conditions AS c FROM combatants WHERE id = ?', alyaCombatant.id).c,
  );
  ok(
    combatantConds.some((c: any) => c.name === 'Aveuglé'),
    'sheet condition mirrored to tracker',
  );
  r = await api(base, 'PATCH', `/api/characters/${fx.charAlya.id}`, {
    token: fx.gm.token,
    body: { conditions: [] },
  });
  combatantConds = JSON.parse(
    srv.query('SELECT conditions AS c FROM combatants WHERE id = ?', alyaCombatant.id).c,
  );
  ok(
    !combatantConds.some((c: any) => c.name === 'Aveuglé'),
    'sheet condition removal mirrored to tracker',
  );

  // sheet HP patch mirrors to combatants (characters.ts mirror branch)
  r = await api(base, 'PATCH', `/api/characters/${fx.charAlya.id}`, {
    token: fx.gm.token,
    body: { currentHp: 18, maxHp: 25 },
  });
  eq(
    srv.query('SELECT hit_points AS h FROM combatants WHERE id = ?', alyaCombatant.id).h,
    18,
    'sheet hp mirrors to tracker',
  );
  eq(
    srv.query('SELECT max_hit_points AS m FROM combatants WHERE id = ?', alyaCombatant.id).m,
    25,
    'sheet max mirrors',
  );

  // ---------- next-turn ----------
  r = await api(base, 'POST', `/api/encounters/${enc.id}/next-turn`, { token: fx.player.token });
  eq(r.status, 403, 'next-turn non-GM → 403');
  r = await api(base, 'POST', '/api/encounters/999999/next-turn', { token: fx.gm.token });
  eq(r.status, 404, 'next-turn 404');

  r = await api(base, 'POST', `/api/encounters/${enc.id}/next-turn`, { token: fx.gm.token });
  eq(r.status, 200, 'setup → active');
  eq(r.data.encounter.status, 'active', 'combat active');
  eq(r.data.encounter.round, 1, 'round 1');

  // end Alya's turn → Bran; Bran carries a duration-1 'Empoisonné' that expires on his end
  await api(base, 'PATCH', `/api/characters/${fx.charBran.id}`, {
    token: fx.player.token,
    body: { conditions: ['Empoisonné'] },
  });
  r = await api(base, 'POST', `/api/encounters/${enc.id}/next-turn`, { token: fx.gm.token });
  eq(r.data.encounter.turnIndex, 1, 'turn passes to Bran');

  // goblins carry a duration-2 condition that decrements when their turn ends
  await api(base, 'PATCH', `/api/combatants/${gob1.id}`, {
    token: fx.gm.token,
    body: { conditions: [{ name: 'Aveuglé', duration: 2 }], defeated: false, hitPoints: 5 },
  });

  r = await api(base, 'POST', `/api/encounters/${enc.id}/next-turn`, { token: fx.gm.token });
  // ends Bran's turn: his Empoisonné (sheet-added, duration null) stays until removed;
  // move to goblins
  eq(r.status, 200, 'next turn');
  const branConds = JSON.parse(
    srv.query('SELECT conditions AS c FROM combatants WHERE id = ?', branCombatant.id).c,
  );
  ok(
    branConds.some((c: any) => c.name === 'Empoisonné' && c.duration === null),
    'sheet-added condition has no duration',
  );

  // end the goblins' turn → their Aveuglé decrements to 1
  r = await api(base, 'POST', `/api/encounters/${enc.id}/next-turn`, { token: fx.gm.token });
  eq(r.data.encounter.round, 2, 'round wrapped after the group');
  const gobConds = JSON.parse(
    srv.query('SELECT conditions AS c FROM combatants WHERE id = ?', gob1.id).c,
  );
  eq(gobConds.find((c: any) => c.name === 'Aveuglé')?.duration, 1, 'duration decremented');

  // a duration-1 condition expires on turn end and leaves the player sheet
  await api(base, 'PATCH', `/api/combatants/${branCombatant.id}`, {
    token: fx.gm.token,
    body: { conditions: [{ name: 'Engourdi', duration: 1 }] },
  });
  // cycle turns until Bran's turn ends (round 2: Alya → Bran → goblins)
  await api(base, 'POST', `/api/encounters/${enc.id}/next-turn`, { token: fx.gm.token }); // end Alya
  r = await api(base, 'POST', `/api/encounters/${enc.id}/next-turn`, { token: fx.gm.token }); // end Bran → Engourdi expires
  ok(
    !srv
      .query('SELECT conditions AS c FROM characters WHERE id = ?', fx.charBran.id)
      .c.includes('Engourdi'),
    'expired condition leaves the sheet',
  );

  // all defeated → 400
  const encDead = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: fx.gm.token,
      body: { name: 'Duel' },
    })
  ).data.encounter;
  const deadMonster = (
    await api(base, 'POST', `/api/encounters/${encDead.id}/combatants/monster`, {
      token: fx.gm.token,
      body: { monsterSlug: goblin.slug },
    })
  ).data.combatants[0];
  await api(base, 'PATCH', `/api/combatants/${deadMonster.id}`, {
    token: fx.gm.token,
    body: { hitPoints: 0 },
  });
  r = await api(base, 'POST', `/api/encounters/${encDead.id}/next-turn`, { token: fx.gm.token });
  eq(r.status, 400, 'no active combatant → 400');

  // ---------- end-my-turn (player-initiated advance) ----------
  r = await api(base, 'POST', `/api/encounters/${encDead.id}/end-my-turn`, {
    token: fx.player.token,
  });
  eq(r.status, 400, 'end-my-turn before combat starts → 400');
  r = await api(base, 'POST', '/api/encounters/999999/end-my-turn', { token: fx.gm.token });
  eq(r.status, 404, 'end-my-turn 404');
  r = await api(base, 'POST', `/api/encounters/${enc.id}/end-my-turn`, {
    token: fx.player2.token,
  });
  eq(r.status, 403, 'end-my-turn without a combatant → 403');

  // Deterministic fight: goblin (init 20) acts before Bran (init 5, bob's
  // character) — so ending Bran's turn wraps the round.
  const encTurn = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: fx.gm.token,
      body: { name: 'Tour du joueur' },
    })
  ).data.encounter;
  const turnGob = (
    await api(base, 'POST', `/api/encounters/${encTurn.id}/combatants/monster`, {
      token: fx.gm.token,
      body: { monsterSlug: goblin.slug, count: 1 },
    })
  ).data.combatants[0];
  const turnBran = (
    await api(base, 'POST', `/api/encounters/${encTurn.id}/combatants/player`, {
      token: fx.gm.token,
      body: { characterId: fx.charBran.id },
    })
  ).data.combatants[0];
  await api(base, 'PATCH', `/api/encounters/${encTurn.id}/combatants/${turnGob.id}/initiative`, {
    token: fx.gm.token,
    body: { initiative: 20 },
  });
  await api(base, 'PATCH', `/api/encounters/${encTurn.id}/combatants/${turnBran.id}/initiative`, {
    token: fx.player.token,
    body: { initiative: 5 },
  });
  await api(base, 'POST', `/api/encounters/${encTurn.id}/next-turn`, { token: fx.gm.token }); // start: goblin
  await api(base, 'POST', `/api/encounters/${encTurn.id}/next-turn`, { token: fx.gm.token }); // → Bran

  // It IS Bran's turn, but the GM's characters aren't in this fight —
  // ownership of a current-turn combatant, not the GM role, opens the advance
  r = await api(base, 'POST', `/api/encounters/${encTurn.id}/end-my-turn`, {
    token: fx.gm.token,
  });
  eq(r.status, 403, "end-my-turn from a user whose character isn't in the turn → 403");

  // Bran's owner closes his turn: advance + round wrap by the player
  await api(base, 'PATCH', `/api/combatants/${turnBran.id}`, {
    token: fx.gm.token,
    body: { conditions: [{ name: 'Engourdi', duration: 1 }] },
  });
  r = await api(base, 'POST', `/api/encounters/${encTurn.id}/end-my-turn`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'player ends own turn');
  eq(r.data.encounter.round, 2, 'player advance wraps the round');
  const afterTurn = (
    await api(base, 'GET', `/api/encounters/${encTurn.id}`, { token: fx.gm.token })
  ).data.encounter;
  eq(afterTurn.combatants[afterTurn.turnIndex].id, turnGob.id, 'turn passed to the goblin');
  ok(
    !JSON.parse(
      srv.query('SELECT conditions AS c FROM combatants WHERE id = ?', turnBran.id).c,
    ).some((c: any) => c.name === 'Engourdi'),
    'player-ended turn expires tracker conditions',
  );
  ok(
    !srv
      .query('SELECT conditions AS c FROM characters WHERE id = ?', fx.charBran.id)
      .c.includes('Engourdi'),
    'expired condition leaves the sheet',
  );

  // Goblin holds the turn now — Bran's owner is locked out
  r = await api(base, 'POST', `/api/encounters/${encTurn.id}/end-my-turn`, {
    token: fx.player.token,
  });
  eq(r.status, 403, 'end-my-turn when not your turn → 403');
  await api(base, 'PATCH', `/api/encounters/${encTurn.id}`, {
    token: fx.gm.token,
    body: { status: 'ended' },
  });
  r = await api(base, 'POST', `/api/encounters/${encTurn.id}/end-my-turn`, {
    token: fx.gm.token,
  });
  eq(r.status, 400, 'end-my-turn after combat ended → 400');
  await api(base, 'DELETE', `/api/encounters/${encTurn.id}`, { token: fx.gm.token });

  // ---------- hidden character purge ----------
  const sneaky = await createCharacter(base, fx.gm.token, P, { name: 'Filou' });
  const enc2 = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: fx.gm.token,
      body: { name: 'Repérage' },
    })
  ).data.encounter;
  await api(base, 'POST', `/api/encounters/${enc2.id}/combatants/player`, {
    token: fx.gm.token,
    body: { characterId: sneaky.id },
  });
  ok(
    srv.query('SELECT COUNT(*) AS c FROM combatants WHERE encounter_id = ?', enc2.id).c === 1,
    'sneaky in encounter',
  );
  await api(base, 'PATCH', `/api/characters/${sneaky.id}`, {
    token: fx.gm.token,
    body: { hidden: true },
  });
  eq(
    srv.query('SELECT COUNT(*) AS c FROM combatants WHERE encounter_id = ?', enc2.id).c,
    0,
    'hidden character pulled from non-ended fights',
  );

  // ---------- GM name mask (hidden enemy names) ----------
  const encMask = (
    await api(base, 'POST', `/api/parties/${P}/encounters`, {
      token: fx.gm.token,
      body: { name: 'Mystère' },
    })
  ).data.encounter;

  // masked at add time — every group member carries the mask
  r = await api(base, 'POST', `/api/encounters/${encMask.id}/combatants/monster`, {
    token: fx.gm.token,
    body: { monsterSlug: goblin.slug, count: 2, name: 'Ombre encapuchonnée', nameHidden: true },
  });
  eq(r.status, 201, 'add masked monster group');
  ok(
    r.data.combatants.every((c: any) => c.nameHidden === true),
    'group created masked',
  );
  ok(
    r.data.combatants.every((c: any) => c.name === 'Ombre encapuchonnée'),
    'GM keeps the real name',
  );
  const masked1 = r.data.combatants[0];

  // an unmasked monster of another type stays readable
  const wolf =
    srv.query(
      "SELECT slug FROM monsters WHERE name_fr LIKE '%oup%' AND hit_dice IS NOT NULL LIMIT 1",
    ) ??
    srv.query(
      'SELECT slug FROM monsters WHERE hit_dice IS NOT NULL AND slug != ? LIMIT 1',
      goblin.slug,
    );
  const openMon = (
    await api(base, 'POST', `/api/encounters/${encMask.id}/combatants/monster`, {
      token: fx.gm.token,
      body: { monsterSlug: wolf.slug, count: 1 },
    })
  ).data.combatants[0];
  eq(openMon.nameHidden, false, 'plain add stays unmasked');

  // a player combatant so fx.player can read the detail
  await api(base, 'POST', `/api/encounters/${encMask.id}/combatants/player`, {
    token: fx.gm.token,
    body: { characterId: fx.charBran.id },
  });

  // player view: placeholder + flag, real name never leaves the server
  r = await api(base, 'GET', `/api/encounters/${encMask.id}`, { token: fx.player.token });
  const pMasked = r.data.encounter.combatants.find((c: any) => c.id === masked1.id);
  eq(pMasked.name, 'Créature inconnue', 'player reads the placeholder name');
  eq(pMasked.nameHidden, true, 'mask flag travels for UI marks');
  eq(
    r.data.encounter.combatants.find((c: any) => c.id === openMon.id).name,
    srv.query('SELECT name_fr AS n FROM monsters WHERE slug = ?', wolf.slug).n,
    'unmasked monster name stays readable',
  );
  ok(
    !JSON.stringify(r.data.encounter.combatants).includes('Ombre'),
    'real name absent from the player payload',
  );

  // GM view: real name + flag
  r = await api(base, 'GET', `/api/encounters/${encMask.id}`, { token: fx.gm.token });
  eq(
    r.data.encounter.combatants.find((c: any) => c.id === masked1.id).name,
    'Ombre encapuchonnée',
    'GM still reads the real name',
  );

  // roster: the register masks the group for players
  r = await api(base, 'GET', `/api/parties/${P}/encounters`, { token: fx.player.token });
  const maskSummary = r.data.encounters.find((e: any) => e.id === encMask.id);
  const maskEntry = maskSummary.roster.find((x: any) => x.name === 'Créature inconnue');
  ok(maskEntry && maskEntry.count === 2, 'roster masks the group');
  ok(!JSON.stringify(maskSummary.roster).includes('Ombre'), 'roster leaks nothing');

  // joining the masked group without the flag → whole group stays coherent
  r = await api(base, 'POST', `/api/encounters/${encMask.id}/combatants/monster`, {
    token: fx.gm.token,
    body: { monsterSlug: goblin.slug, count: 1, name: 'Ombre encapuchonnée' },
  });
  eq(r.data.combatants[0].nameHidden, true, 'late joiner inherits the group mask');

  // mask toggle is GM-only
  r = await api(base, 'PATCH', `/api/combatants/${masked1.id}`, {
    token: fx.player.token,
    body: { nameHidden: false },
  });
  eq(r.status, 403, 'mask toggle non-GM → 403');

  // reveal from the card → group-wide, player sees the name
  r = await api(base, 'PATCH', `/api/combatants/${masked1.id}`, {
    token: fx.gm.token,
    body: { nameHidden: false },
  });
  eq(r.data.combatant.nameHidden, false, 'reveal returns the state');
  const maskRows = srv.queryAll(
    'SELECT name_hidden AS n FROM combatants WHERE group_id = ?',
    masked1.groupId,
  );
  ok(
    maskRows.every((x: any) => x.n === 0),
    'whole group unmasked',
  );
  r = await api(base, 'GET', `/api/encounters/${encMask.id}`, { token: fx.player.token });
  eq(
    r.data.encounter.combatants.find((c: any) => c.id === masked1.id).name,
    'Ombre encapuchonnée',
    'player sees the revealed name',
  );

  // hide again → placeholder returns
  await api(base, 'PATCH', `/api/combatants/${masked1.id}`, {
    token: fx.gm.token,
    body: { nameHidden: true },
  });
  r = await api(base, 'GET', `/api/encounters/${encMask.id}`, { token: fx.player.token });
  eq(
    r.data.encounter.combatants.find((c: any) => c.id === masked1.id).name,
    'Créature inconnue',
    're-hidden → placeholder again',
  );
  await api(base, 'DELETE', `/api/encounters/${encMask.id}`, { token: fx.gm.token });

  // ---------- delete combatant ----------
  r = await api(base, 'DELETE', `/api/combatants/${gob1.id}`, { token: fx.player.token });
  eq(r.status, 403, 'delete combatant non-GM → 403');
  r = await api(base, 'DELETE', '/api/combatants/999999', { token: fx.gm.token });
  eq(r.status, 404, 'delete combatant 404');

  r = await api(base, 'DELETE', `/api/combatants/${gob1.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete grouped combatant');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM combatants WHERE group_id = ?', gob1.groupId).c,
    0,
    'whole group deleted',
  );

  r = await api(base, 'DELETE', `/api/combatants/${branCombatant.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete single combatant');

  // ---------- delete encounter ----------
  r = await api(base, 'DELETE', `/api/encounters/${enc2.id}`, { token: fx.player.token });
  eq(r.status, 403, 'delete encounter non-GM → 403');
  r = await api(base, 'DELETE', '/api/encounters/999999', { token: fx.gm.token });
  eq(r.status, 404, 'delete encounter 404');
  r = await api(base, 'DELETE', `/api/encounters/${enc2.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete encounter');

  // clean up: end the main encounter so later modules' mirrors skip it
  await api(base, 'PATCH', `/api/encounters/${enc.id}`, {
    token: fx.gm.token,
    body: { status: 'ended' },
  });
  await api(base, 'DELETE', `/api/encounters/${enc.id}`, { token: fx.gm.token });
}
