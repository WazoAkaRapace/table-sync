/**
 * Character features (catalog-aware counters) + character notes.
 * Covers every .prepare site in routes/character-features.ts and
 * routes/character-notes.ts.
 */
import { CLASS_FEATURES } from '@table-sync/shared';
import { api, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

const ALL_FEATURES = Object.values(CLASS_FEATURES).flat();

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const A = fx.charAlya.id;

  // ---------- features ----------
  let r = await api(base, 'GET', `/api/characters/${A}/features`, { token: fx.player.token });
  eq(r.status, 200, 'list features (empty)');
  eq(r.data.features.length, 0, 'no features yet');

  r = await api(base, 'POST', `/api/characters/${A}/features`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'create feature no title → 400');
  r = await api(base, 'POST', '/api/characters/999999/features', {
    token: fx.gm.token,
    body: { title: 'X' },
  });
  eq(r.status, 404, 'create feature unknown char → 404');
  r = await api(base, 'POST', `/api/characters/${A}/features`, {
    token: fx.outsider.token,
    body: { title: 'X' },
  });
  eq(r.status, 403, 'create feature non-member → 403');
  r = await api(base, 'POST', `/api/characters/${A}/features`, {
    token: fx.player2.token,
    body: { title: 'X' },
  });
  eq(r.status, 403, 'create feature member non-owner → 403');

  r = await api(base, 'POST', `/api/characters/${A}/features`, {
    token: fx.gm.token,
    body: {
      title: 'Vision dans le noir',
      category: 'racial',
      description: 'Vous voyez dans le noir jusqu’à 18 m.',
    },
  });
  eq(r.status, 201, 'create free-form feature');
  const feat = r.data.feature;
  eq(feat.category, 'racial', 'category stored');
  eq(feat.sortOrder, 0, 'first sort order');

  // catalog feature with a resource → counterMax derived from the SRD formula
  const withResource = ALL_FEATURES.find((f: any) => f.resource);
  ok(withResource, 'catalog has resource features');
  r = await api(base, 'POST', `/api/characters/${A}/features`, {
    token: fx.gm.token,
    body: {
      title: withResource.name,
      catalogId: withResource.id,
      category: 'class',
      resetType: 'short',
    },
  });
  eq(r.status, 201, 'create catalog feature');
  const catFeat = r.data.feature;
  ok(
    catFeat.counterMax !== null && catFeat.counterMax >= 1,
    `counterMax derived (${catFeat.counterMax})`,
  );
  eq(catFeat.counterCurrent, catFeat.counterMax, 'counter starts at max');
  eq(catFeat.catalogId, withResource.id, 'catalogId stored');
  eq(catFeat.resetType, 'short', 'resetType stored');

  r = await api(base, 'GET', `/api/characters/${A}/features`, { token: fx.player.token });
  eq(r.data.features.length, 2, 'features listed');
  // raw rows: catalog linkage + counter columns persist as the API reported them
  const catRow = srv.query(
    'SELECT title, catalog_id, counter_max, counter_current, reset_type, sort_order FROM character_features WHERE id = ?',
    catFeat.id,
  );
  eq(catRow.title, withResource.name, 'db: catalog feature title');
  eq(catRow.catalog_id, withResource.id, 'db: catalog_id stored');
  eq(catRow.counter_max, catFeat.counterMax, 'db: counter_max matches derived max');
  eq(catRow.counter_current, catFeat.counterMax, 'db: counter_current starts at max');
  eq(catRow.reset_type, 'short', 'db: reset_type stored');
  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}/features`, {
    token: fx.player.token,
  });
  eq(r.status, 404, 'hidden char features → 404');

  r = await api(base, 'PATCH', `/api/character-features/${feat.id}`, {
    token: fx.gm.token,
    body: {},
  });
  eq(r.status, 400, 'patch feature no fields → 400');
  r = await api(base, 'PATCH', '/api/character-features/999999', {
    token: fx.gm.token,
    body: { title: 'X' },
  });
  eq(r.status, 404, 'patch feature 404');
  r = await api(base, 'PATCH', `/api/character-features/${feat.id}`, {
    token: fx.player2.token,
    body: { title: 'X' },
  });
  eq(r.status, 403, 'patch feature non-owner → 403');

  // counterMax shrink below current → current resets to max
  r = await api(base, 'PATCH', `/api/character-features/${catFeat.id}`, {
    token: fx.gm.token,
    body: { counterMax: 2, title: 'Renommé' },
  });
  eq(r.status, 200, 'patch catalog feature');
  eq(r.data.feature.counterCurrent, 2, 'current clamped to new max');
  // removing the counter clears current
  r = await api(base, 'PATCH', `/api/character-features/${catFeat.id}`, {
    token: fx.gm.token,
    body: { counterMax: null },
  });
  eq(r.data.feature.counterCurrent, null, 'counter cleared when max removed');
  // plain current set
  r = await api(base, 'PATCH', `/api/character-features/${catFeat.id}`, {
    token: fx.gm.token,
    body: { counterMax: 3, counterCurrent: 1 },
  });
  eq(r.data.feature.counterCurrent, 1, 'counter set');
  const patchedRow = srv.query(
    'SELECT title, counter_max, counter_current FROM character_features WHERE id = ?',
    catFeat.id,
  );
  eq(patchedRow.title, 'Renommé', 'db: patched title persisted');
  eq(patchedRow.counter_max, 3, 'db: patched counter_max persisted');
  eq(patchedRow.counter_current, 1, 'db: patched counter_current persisted');

  // ---------- features: drag-to-reorder (one category group) ----------
  r = await api(base, 'POST', `/api/characters/${A}/features`, {
    token: fx.gm.token,
    body: { title: 'Agilité halfeline', category: 'racial' },
  });
  eq(r.status, 201, 'create second racial feature');
  const feat2 = r.data.feature;

  r = await api(base, 'PATCH', `/api/characters/${A}/features/order`, {
    token: fx.player2.token,
    body: { order: [feat2.id, feat.id] },
  });
  eq(r.status, 403, 'reorder features non-owner → 403');
  r = await api(base, 'PATCH', `/api/characters/${A}/features/order`, {
    token: fx.gm.token,
    body: { order: [] },
  });
  eq(r.status, 400, 'reorder features empty → 400');
  r = await api(base, 'PATCH', `/api/characters/${A}/features/order`, {
    token: fx.gm.token,
    body: { order: [feat2.id, 999999] },
  });
  eq(r.status, 400, 'reorder features foreign id → 400');

  r = await api(base, 'PATCH', `/api/characters/${A}/features/order`, {
    token: fx.gm.token,
    body: { order: [feat2.id, feat.id] },
  });
  eq(r.status, 200, 'reorder features');
  eq(r.data.ok, true, 'reorder features ok');
  r = await api(base, 'GET', `/api/characters/${A}/features`, { token: fx.player.token });
  const racialTitles = r.data.features
    .filter((f: any) => f.category === 'racial')
    .map((f: any) => f.title);
  eq(racialTitles.join('|'), 'Agilité halfeline|Vision dans le noir', 'racial group order swapped');
  eq(
    srv.query('SELECT sort_order FROM character_features WHERE id = ?', feat2.id).sort_order,
    0,
    'db: reordered feature sort_order 0',
  );
  eq(
    srv.query('SELECT sort_order FROM character_features WHERE id = ?', feat.id).sort_order,
    1,
    'db: reordered feature sort_order 1',
  );

  r = await api(base, 'DELETE', `/api/character-features/${feat.id}`, { token: fx.player2.token });
  eq(r.status, 403, 'delete feature non-owner → 403');
  r = await api(base, 'DELETE', '/api/character-features/999999', { token: fx.gm.token });
  eq(r.status, 404, 'delete feature 404');
  r = await api(base, 'DELETE', `/api/character-features/${feat.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete feature');
  eq(
    srv.query('SELECT COUNT(*) as n FROM character_features WHERE id = ?', feat.id).n,
    0,
    'db: feature row gone',
  );

  // ---------- notes ----------
  r = await api(base, 'GET', `/api/characters/${A}/notes`, { token: fx.player.token });
  eq(r.status, 200, 'list notes (empty)');

  r = await api(base, 'POST', `/api/characters/${A}/notes`, {
    token: fx.gm.token,
    body: { title: '' },
  });
  eq(r.status, 400, 'create note no title → 400');
  r = await api(base, 'POST', '/api/characters/999999/notes', {
    token: fx.gm.token,
    body: { title: 'X' },
  });
  eq(r.status, 404, 'create note unknown char → 404');
  r = await api(base, 'POST', `/api/characters/${A}/notes`, {
    token: fx.player2.token,
    body: { title: 'X' },
  });
  eq(r.status, 403, 'create note non-owner → 403');

  r = await api(base, 'POST', `/api/characters/${A}/notes`, {
    token: fx.gm.token,
    body: { title: 'Journal', content: 'Jour 1 : Port de Port Nyanzaru.' },
  });
  eq(r.status, 201, 'create note');
  const note = r.data.note;
  ok(note.createdAt, 'created_at set');

  r = await api(base, 'GET', `/api/characters/${A}/notes`, { token: fx.player.token });
  eq(r.data.notes.length, 1, 'note listed');
  const noteRow = srv.query(
    'SELECT title, content, created_at, updated_at FROM character_notes WHERE id = ?',
    note.id,
  );
  eq(noteRow.title, 'Journal', 'db: note title persisted');
  eq(noteRow.content, 'Jour 1 : Port de Port Nyanzaru.', 'db: note content persisted');
  ok(noteRow.created_at, 'db: created_at set');
  r = await api(base, 'GET', `/api/characters/${fx.charSecret.id}/notes`, {
    token: fx.player.token,
  });
  eq(r.status, 404, 'hidden char notes → 404');

  r = await api(base, 'PATCH', `/api/character-notes/${note.id}`, { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'patch note no fields → 400');
  r = await api(base, 'PATCH', '/api/character-notes/999999', {
    token: fx.gm.token,
    body: { title: 'X' },
  });
  eq(r.status, 404, 'patch note 404');
  r = await api(base, 'PATCH', `/api/character-notes/${note.id}`, {
    token: fx.player2.token,
    body: { title: 'X' },
  });
  eq(r.status, 403, 'patch note non-owner → 403');

  r = await api(base, 'PATCH', `/api/character-notes/${note.id}`, {
    token: fx.gm.token,
    body: { title: 'Journal (2)', content: 'Jour 2 : jungle.' },
  });
  eq(r.status, 200, 'patch note');
  ok(r.data.note.updatedAt, "updated_at refreshed via datetime('now')");
  const patchedNote = srv.query(
    'SELECT title, content, updated_at FROM character_notes WHERE id = ?',
    note.id,
  );
  eq(patchedNote.title, 'Journal (2)', 'db: patched note title persisted');
  eq(patchedNote.content, 'Jour 2 : jungle.', 'db: patched note content persisted');
  ok(patchedNote.updated_at, 'db: updated_at set');

  // ---------- notes: drag-to-reorder ----------
  r = await api(base, 'POST', `/api/characters/${A}/notes`, {
    token: fx.gm.token,
    body: { title: 'PNJ croisées' },
  });
  const note2 = r.data.note;
  r = await api(base, 'POST', `/api/characters/${A}/notes`, {
    token: fx.gm.token,
    body: { title: 'Quêtes' },
  });
  const note3 = r.data.note;

  r = await api(base, 'PATCH', `/api/characters/${A}/notes/order`, {
    token: fx.player2.token,
    body: { order: [note3.id, note2.id, note.id] },
  });
  eq(r.status, 403, 'reorder notes non-owner → 403');
  r = await api(base, 'PATCH', `/api/characters/${A}/notes/order`, {
    token: fx.gm.token,
    body: { order: [] },
  });
  eq(r.status, 400, 'reorder notes empty → 400');
  r = await api(base, 'PATCH', `/api/characters/${A}/notes/order`, {
    token: fx.gm.token,
    body: { order: [note.id, 999999] },
  });
  eq(r.status, 400, 'reorder notes foreign id → 400');

  const noteUpdatedBefore = srv.query(
    'SELECT updated_at FROM character_notes WHERE id = ?',
    note.id,
  ).updated_at;
  r = await api(base, 'PATCH', `/api/characters/${A}/notes/order`, {
    token: fx.gm.token,
    body: { order: [note3.id, note.id, note2.id] },
  });
  eq(r.status, 200, 'reorder notes');
  r = await api(base, 'GET', `/api/characters/${A}/notes`, { token: fx.player.token });
  eq(
    r.data.notes.map((n: any) => n.title).join('|'),
    'Quêtes|Journal (2)|PNJ croisées',
    'notes listed in new order',
  );
  eq(
    srv.query('SELECT updated_at FROM character_notes WHERE id = ?', note.id).updated_at,
    noteUpdatedBefore,
    'db: reorder leaves updated_at untouched',
  );

  r = await api(base, 'DELETE', `/api/character-notes/${note.id}`, { token: fx.player2.token });
  eq(r.status, 403, 'delete note non-owner → 403');
  r = await api(base, 'DELETE', '/api/character-notes/999999', { token: fx.gm.token });
  eq(r.status, 404, 'delete note 404');
  r = await api(base, 'DELETE', `/api/character-notes/${note.id}`, { token: fx.gm.token });
  eq(r.status, 204, 'delete note');
  eq(
    srv.query('SELECT COUNT(*) as n FROM character_notes WHERE id = ?', note.id).n,
    0,
    'db: note row gone',
  );
}
