/**
 * Issue #189 — État Rage du barbare : colonne `raging` (jumeau de
 * `concentrating`), pose/reprise via PATCH fiche, drops automatiques
 * (0 PV fiche + traqueur, conditions incapacitantes fiche + traqueur,
 * repos long) et compteur de charges du catalogue barbare-rage.
 */

import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const P = fx.partyId;
  const GM = fx.gm.token;

  // ---------- fixtures : barbare DÉDIÉ (la suite partage UNE base) ----------
  const barb = await createCharacter(base, GM, P, {
    name: 'Brutanex-le-furieux',
    characterClass: 'Barbare',
    level: 5,
    strength: 16,
    maxHp: 20,
    currentHp: 20,
  });
  ok(barb.id > 0, 'dedicated barbarian created');
  let r = await api(base, 'GET', `/api/characters/${barb.id}`, { token: GM });
  eq(r.data.character.raging, false, 'raging defaults to false');

  // Trait Rage du catalogue → compteur 3/3 au niveau 5 (2@1 3@3 4@6 5@12 6@17)
  r = await api(base, 'POST', `/api/characters/${barb.id}/features`, {
    token: GM,
    body: { title: 'Rage', catalogId: 'barbare-rage', category: 'class' },
  });
  eq(r.status, 201, 'rage feature added');
  eq(r.data.feature.counterMax, 3, 'rage counterMax 3 at level 5');
  eq(r.data.feature.counterCurrent, 3, 'rage counter starts full');

  // ---------- pose / reprise via PATCH fiche ----------
  r = await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { raging: true },
  });
  eq(r.status, 200, 'PATCH raging true');
  eq(r.data.character.raging, true, 'state on');
  r = await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { raging: false },
  });
  eq(r.data.character.raging, false, 'state off (rompre, bonus action)');

  // ---------- drop : 0 PV côté fiche ----------
  await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { raging: true, currentHp: 20 },
  });
  r = await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { currentHp: 0 },
  });
  eq(r.data.character.raging, false, 'unconscious (0 PV) ends the rage');
  // PV temporaires restants = pas tombé → la rage tient
  await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { currentHp: 10, tempHp: 5, raging: true },
  });
  r = await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { currentHp: 0, tempHp: 3 },
  });
  eq(r.data.character.raging, true, 'temp HP cushioning keeps the rage');
  r = await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { currentHp: 0, tempHp: 0 },
  });
  eq(r.data.character.raging, false, 'temp HP exhausted at 0 PV ends the rage');

  // ---------- drop : condition incapacitante côté fiche ----------
  await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { currentHp: 20, tempHp: 0, raging: true, conditions: [] },
  });
  r = await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { conditions: ['Neutralisé'] },
  });
  eq(r.data.character.raging, false, 'Neutralisé ends the rage');
  eq(r.data.rageEnded, 'Neutralisé', 'rageEnded flag surfaces the cause');
  // Condition NON incapacitante : la rage tient
  await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { raging: true, conditions: [] },
  });
  r = await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { conditions: ['Aveuglé'] },
  });
  eq(r.data.character.raging, true, 'Aveuglé does not end the rage');
  // Un payload qui repose explicitement raging prime sur le drop
  r = await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { conditions: ['Inconscient'], raging: true },
  });
  eq(r.data.character.raging, true, 'explicit raging:true overrides the auto-drop');

  // ---------- drop : repos long ----------
  await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { raging: true, conditions: [] },
  });
  r = await api(base, 'POST', `/api/characters/${barb.id}/rest`, {
    token: GM,
    body: { type: 'long' },
  });
  eq(r.status, 200, 'long rest');
  r = await api(base, 'GET', `/api/characters/${barb.id}`, { token: GM });
  eq(r.data.character.raging, false, 'long rest ends the rage');
  // ...et recharge les charges du catalogue (3/3)
  r = await api(base, 'GET', `/api/characters/${barb.id}/features`, { token: GM });
  const rageRow = (r.data.features ?? []).find((f: any) => f.catalogId === 'barbare-rage');
  eq(rageRow.counterCurrent, 3, 'long rest refills rage charges');

  // ---------- drop : dégâts via le TRAQUEUR (GM frappe le joueur) ----------
  const enc = await api(base, 'POST', `/api/parties/${P}/encounters`, {
    token: GM,
    body: { name: 'Essai de la rage' },
  });
  const combatant = await api(
    base,
    'POST',
    `/api/encounters/${enc.data.encounter.id}/combatants/player`,
    {
      token: GM,
      body: { characterIds: [barb.id] },
    },
  );
  await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { raging: true, currentHp: 20 },
  });
  r = await api(base, 'PATCH', `/api/combatants/${combatant.data.combatants[0].id}`, {
    token: GM,
    body: { hitPoints: 0 },
  });
  eq(r.status, 200, 'tracker damage');
  r = await api(base, 'GET', `/api/characters/${barb.id}`, { token: GM });
  eq(r.data.character.raging, false, 'tracker knockout ends the rage');

  // ---------- drop : condition incapacitante via le traqueur ----------
  await api(base, 'PATCH', `/api/characters/${barb.id}`, {
    token: GM,
    body: { raging: true, currentHp: 20 },
  });
  r = await api(base, 'PATCH', `/api/combatants/${combatant.data.combatants[0].id}`, {
    token: GM,
    body: { conditions: [{ name: 'Paralysé' }] },
  });
  eq(r.status, 200, 'tracker condition');
  eq(r.data.rageEnded, 'Paralysé', 'tracker rageEnded flag');
  r = await api(base, 'GET', `/api/characters/${barb.id}`, { token: GM });
  eq(r.data.character.raging, false, 'tracker Paralysé ends the rage');

  // ---------- charge consumption (le stepper ⚡ existe déjà) ----------
  r = await api(base, 'GET', `/api/characters/${barb.id}/features`, { token: GM });
  const rageFeat = (r.data.features ?? []).find((f: any) => f.catalogId === 'barbare-rage');
  r = await api(base, 'PATCH', `/api/character-features/${rageFeat.id}`, {
    token: GM,
    body: { counterCurrent: 2 },
  });
  eq(r.data.feature.counterCurrent, 2, 'rage charge spent via counter stepper');

  // ---------- raw state sanity ----------
  const rows = srv.queryAll(`SELECT raging FROM characters WHERE id = ${barb.id}`);
  eq(rows[0].raging, 0, 'raging persisted as 0/1 int');
}
