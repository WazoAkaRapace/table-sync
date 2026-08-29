/**
 * Spells: catalog search/filters/light/detail, character↔spell links
 * (learn/upsert/patch/forget), always-prepared domain spells.
 * Covers every .prepare site in routes/spells.ts, routes/character-spells.ts
 * and routes/domain-spells.ts.
 */
import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const A = fx.charAlya.id;

  // ---------- catalog ----------
  let r = await api(base, 'GET', '/api/spells', { token: fx.gm.token });
  eq(r.status, 200, 'list spells');
  ok(r.data.total > 300, 'full SRD catalog seeded');

  r = await api(base, 'GET', '/api/spells?class=Magicien&level=3', { token: fx.gm.token });
  ok(r.data.total > 0, 'class + level filter');
  ok(
    r.data.spells.every((s: any) => s.level === 3),
    'level filter consistent',
  );

  r = await api(base, 'GET', '/api/spells?school=evocation&limit=5', { token: fx.gm.token });
  ok(
    r.data.spells.every((s: any) => s.school === 'evocation'),
    'school filter',
  );

  r = await api(base, 'GET', `/api/spells?search=${encodeURIComponent('boule de feu')}`, {
    token: fx.gm.token,
  });
  ok(r.data.total >= 1, 'accent-free French search finds Boule de feu');

  r = await api(base, 'GET', '/api/spells/light', { token: fx.gm.token });
  ok(r.data.spells.length > 100, 'light catalog');
  ok(r.data.spells[0].name, 'light rows carry localized names (fr default)');

  const fireball = srv.query("SELECT id FROM spells WHERE srd_index = 'fireball'");
  ok(fireball, 'fireball seeded');
  r = await api(base, 'GET', `/api/spells/${fireball.id}`, { token: fx.gm.token });
  eq(r.status, 200, 'spell detail');
  eq(r.data.spell.level, 3, 'fireball level');
  r = await api(base, 'GET', '/api/spells/999999', { token: fx.gm.token });
  eq(r.status, 404, 'spell 404');

  // ---------- character spells ----------
  r = await api(base, 'POST', `/api/characters/${A}/spells`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'learn missing spellId → 400');
  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.gm.token,
    body: { spellId: 999999 },
  });
  eq(r.status, 404, 'learn unknown spell → 404');
  r = await api(base, 'POST', '/api/characters/999999/spells', {
    token: fx.gm.token,
    body: { spellId: fireball.id },
  });
  eq(r.status, 404, 'learn on unknown character → 404');
  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.outsider.token,
    body: { spellId: fireball.id },
  });
  eq(r.status, 403, 'learn by non-member → 403');
  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.player2.token,
    body: { spellId: fireball.id },
  });
  eq(r.status, 403, 'learn by member non-owner → 403');

  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.gm.token,
    body: { spellId: fireball.id, prepared: true },
  });
  eq(r.status, 201, 'learn fireball');
  eq(r.data.spell.prepared, true, 'learned prepared');
  const link = r.data.spell;

  // learn again → upsert toggles prepared
  r = await api(base, 'POST', `/api/characters/${A}/spells`, {
    token: fx.gm.token,
    body: { spellId: fireball.id, prepared: false },
  });
  eq(r.status, 201, 're-learn upserts');
  eq(r.data.spell.prepared, false, 'prepared toggled');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spells WHERE character_id = ?', A).c,
    1,
    'single link row',
  );

  // ---------- regression: UPSERT must return the ORIGINAL link ----------
  // A different link inserted between learn and re-learn makes a naive
  // lastInsertRowid stale (it would point at the newer row) — the route
  // must re-query by (character_id, spell_id).
  const missile = srv.query("SELECT id FROM spells WHERE srd_index = 'magic-missile'");
  ok(missile, 'magic missile seeded');
  const regChar = await createCharacter(base, fx.gm.token, fx.partyId, {
    name: 'Bibliophile',
    characterClass: 'Magicien',
    level: 2,
    maxHp: 10,
  });
  r = await api(base, 'POST', `/api/characters/${regChar.id}/spells`, {
    token: fx.gm.token,
    body: { spellId: fireball.id, prepared: true },
  });
  eq(r.status, 201, 'regression: learn fireball');
  const regLinkId = r.data.spell.id;
  r = await api(base, 'POST', `/api/characters/${regChar.id}/spells`, {
    token: fx.gm.token,
    body: { spellId: missile.id },
  });
  eq(r.status, 201, 'regression: learn a second spell in between');
  r = await api(base, 'POST', `/api/characters/${regChar.id}/spells`, {
    token: fx.gm.token,
    body: { spellId: fireball.id, prepared: false },
  });
  eq(r.status, 201, 'regression: re-learn fireball (conflict path)');
  eq(r.data.spell.id, regLinkId, 'upsert returns the ORIGINAL link id');
  eq(r.data.spell.spell.id, fireball.id, 'upsert returns the requested spell');
  eq(r.data.spell.prepared, false, 'upsert toggles prepared');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spells WHERE character_id = ?', regChar.id).c,
    2,
    'upsert created no duplicate row',
  );

  r = await api(base, 'GET', `/api/characters/${A}/spells`, { token: fx.player.token });
  eq(r.status, 200, 'list character spells (party member)');
  eq(r.data.spells.length, 1, 'one known spell');
  ok(r.data.spells[0].spell.name, 'joined spell payload');
  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}/spells`, {
    token: fx.player.token,
  });
  eq(r.status, 404, 'hidden char spells → 404');
  r = await api(base, 'GET', '/api/characters/999999/spells', { token: fx.gm.token });
  eq(r.status, 404, 'spells 404');

  r = await api(base, 'PATCH', `/api/character-spells/${link.id}`, {
    token: fx.gm.token,
    body: {},
  });
  eq(r.status, 400, 'patch link no fields → 400');
  r = await api(base, 'PATCH', '/api/character-spells/999999', {
    token: fx.gm.token,
    body: { prepared: true },
  });
  eq(r.status, 404, 'patch link 404');
  r = await api(base, 'PATCH', `/api/character-spells/${link.id}`, {
    token: fx.player2.token,
    body: { prepared: true },
  });
  eq(r.status, 403, 'patch link non-owner → 403');
  r = await api(base, 'PATCH', `/api/character-spells/${link.id}`, {
    token: fx.gm.token,
    body: { prepared: true, sortOrder: 2 },
  });
  eq(r.status, 200, 'patch link');
  eq(r.data.spell.sortOrder, 2, 'sort order stored');

  r = await api(base, 'DELETE', `/api/character-spells/${link.id}`, { token: fx.player2.token });
  eq(r.status, 403, 'forget non-owner → 403');
  r = await api(base, 'DELETE', '/api/character-spells/999999', { token: fx.gm.token });
  eq(r.status, 404, 'forget 404');
  r = await api(base, 'DELETE', `/api/character-spells/${link.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'forget spell');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spells WHERE character_id = ?', A).c,
    0,
    'link removed',
  );

  // ---------- domain spells (always prepared) ----------
  const clerc = await createCharacter(base, fx.gm.token, fx.partyId, {
    name: 'Sœur Foi',
    characterClass: 'Clerc',
    level: 3,
    maxHp: 18,
  });
  await api(base, 'PATCH', `/api/characters/${clerc.id}`, {
    token: fx.gm.token,
    body: { divineDomain: 'vie' },
  });

  r = await api(base, 'GET', `/api/characters/${clerc.id}/domain-spells`, { token: fx.gm.token });
  eq(r.status, 200, 'cleric domain spells');
  eq(r.data.domain, 'vie', 'domain echoed');
  ok(r.data.spells.length >= 2, 'domain spells resolved from the catalog');
  ok(r.data.spells[0].domainLevel >= 1, 'domain level attached');

  const druide = await createCharacter(base, fx.gm.token, fx.partyId, {
    name: 'Feuillage',
    characterClass: 'Druide',
    level: 3,
    maxHp: 16,
  });
  await api(base, 'PATCH', `/api/characters/${druide.id}`, {
    token: fx.gm.token,
    body: { druidCircle: 'terre', landCircle: 'forêt' },
  });
  r = await api(base, 'GET', `/api/characters/${druide.id}/domain-spells`, { token: fx.gm.token });
  eq(r.status, 200, 'druid land-circle bonus spells');

  r = await api(base, 'GET', `/api/characters/${clerc.id}/domain-spells`, {
    token: fx.player.token,
  });
  eq(r.status, 403, 'domain spells owner/GM only');
  r = await api(base, 'GET', '/api/characters/999999/domain-spells', { token: fx.gm.token });
  eq(r.status, 404, 'domain spells 404');
}
