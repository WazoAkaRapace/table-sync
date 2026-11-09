/**
 * Accès personnage — épingle le préambule partagé « fetch character +
 * membership/ownership + GM check » AVANT l'extraction routes/lib/access.ts
 * (phase 4b, dédup PR n°1). Chaque variante est testée pour SON statut ET SON
 * message exact — byte-identique obligatoire à travers la refactor :
 *   - member-visible (GET)  : 404 inexistant, 403 « not a member » hors groupe,
 *                             404 « character not found » sur caché (existence
 *                             non trahie), 200 owner/MD ;
 *   - owner-or-gm + membre (rest/spells/features/spell-effects) : 403
 *     « not a member » hors groupe PUIS 403 message métier si membre non
 *     autorisé ;
 *   - owner-or-gm SANS check membre (PATCH/DELETE fiche) : même 403 métier
 *     pour un hors-groupe (le message ne trahit pas l'existence).
 */
import {
  api,
  createCharacter,
  createParty,
  eq,
  ok,
  registerUser,
  type Fixtures,
  type ServerHandle,
} from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  // Mini-fixture dédiée : contrôle exact membre / non-membre / MD sans dépendre
  // de l'état laissé par les modules précédents.
  const owner = await registerUser(base, 'acc-owner'); // joueur propriétaire
  const gm = await registerUser(base, 'acc-gm'); // MD du groupe
  const member = await registerUser(base, 'acc-member'); // membre non propriétaire
  const outsider = await registerUser(base, 'acc-out'); // hors groupe
  const party = await createParty(base, gm.token, 'Accès personnage — test');
  ok(
    (
      await api(base, 'POST', '/api/parties/join', {
        token: owner.token,
        body: { inviteCode: party.inviteCode },
      })
    ).status === 201,
    'owner joins party',
  );
  ok(
    (
      await api(base, 'POST', '/api/parties/join', {
        token: member.token,
        body: { inviteCode: party.inviteCode },
      })
    ).status === 201,
    'member joins party',
  );
  const char = await createCharacter(base, owner.token, party.id, { name: 'Éponine', maxHp: 10 });
  const hidden = await createCharacter(base, owner.token, party.id, {
    name: 'Ombre',
    hidden: true,
    maxHp: 8,
  });
  const throwaway = await createCharacter(base, owner.token, party.id, {
    name: 'Pion',
    maxHp: 5,
  });

  // ---------- GET /characters/:id (member-visible, fetch avec owner) ----------
  let r = await api(base, 'GET', `/api/characters/${char.id}`, {});
  eq(r.status, 401, 'get sans JWT → 401');
  eq(r.data.error, 'unauthorized', 'get sans JWT : message 401');
  r = await api(base, 'GET', '/api/characters/999999', { token: member.token });
  eq(r.status, 404, 'get inexistant → 404');
  eq(r.data.error, 'character not found', 'get inexistant : message');
  r = await api(base, 'GET', `/api/characters/${char.id}`, { token: outsider.token });
  eq(r.status, 403, 'get hors groupe → 403');
  eq(r.data.error, 'not a member', 'get hors groupe : message');
  r = await api(base, 'GET', `/api/characters/${hidden.id}`, { token: member.token });
  eq(r.status, 404, 'get caché par un membre → 404 (existence non trahie)');
  eq(r.data.error, 'character not found', 'get caché : même message 404');
  r = await api(base, 'GET', `/api/characters/${hidden.id}`, { token: owner.token });
  eq(r.status, 200, 'get caché par son propriétaire → 200');
  r = await api(base, 'GET', `/api/characters/${hidden.id}`, { token: gm.token });
  eq(r.status, 200, 'get caché par le MD → 200');
  r = await api(base, 'GET', `/api/characters/${char.id}`, { token: member.token });
  eq(r.status, 200, 'get par un membre → 200');
  ok(r.data.character.ownerName, 'fiche complète : owner_name descend (JOIN users)');

  // ---------- PATCH /characters/:id (owner-or-gm SANS check membre) ----------
  r = await api(base, 'PATCH', `/api/characters/${char.id}`, {
    token: member.token,
    body: { name: 'X' },
  });
  eq(r.status, 403, 'patch par un membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can edit', 'patch membre : message métier');
  r = await api(base, 'PATCH', `/api/characters/${char.id}`, {
    token: outsider.token,
    body: { name: 'X' },
  });
  eq(r.status, 403, 'patch hors groupe → 403');
  eq(r.data.error, 'only the owner or GM can edit', 'patch hors groupe : même message métier');
  r = await api(base, 'PATCH', `/api/characters/${char.id}`, {
    token: gm.token,
    body: { name: 'Éponine la Vaillante' },
  });
  eq(r.status, 200, 'patch par le MD → 200');

  // ---------- DELETE /characters/:id (owner-or-gm SANS check membre) ----------
  r = await api(base, 'DELETE', `/api/characters/${char.id}`, { token: member.token });
  eq(r.status, 403, 'delete par un membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can delete', 'delete membre : message métier');
  r = await api(base, 'DELETE', `/api/characters/${char.id}`, { token: outsider.token });
  eq(r.status, 403, 'delete hors groupe → 403');
  eq(r.data.error, 'only the owner or GM can delete', 'delete hors groupe : même message métier');
  r = await api(base, 'DELETE', `/api/characters/${throwaway.id}`, { token: owner.token });
  eq(r.status, 204, 'delete par le propriétaire → 204');

  // ---------- POST /characters/:id/rest (owner-or-gm + check membre) ----------
  r = await api(base, 'POST', `/api/characters/${char.id}/rest`, {
    token: outsider.token,
    body: { type: 'short' },
  });
  eq(r.status, 403, 'rest hors groupe → 403');
  eq(r.data.error, 'not a member', 'rest hors groupe : message membre');
  r = await api(base, 'POST', `/api/characters/${char.id}/rest`, {
    token: member.token,
    body: { type: 'short' },
  });
  eq(r.status, 403, 'rest par un membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can rest', 'rest membre : message métier');
  r = await api(base, 'POST', `/api/characters/${char.id}/rest`, {
    token: gm.token,
    body: { type: 'short' },
  });
  eq(r.status, 200, 'rest par le MD → 200');

  // ---------- POST /characters/:id/spells (owner-or-gm + check membre) ----------
  const spell = srv.query("SELECT id FROM spells WHERE srd_index = 'magic-missile'");
  ok(spell, 'magic missile seeded');
  r = await api(base, 'POST', `/api/characters/${char.id}/spells`, {
    token: outsider.token,
    body: { spellId: spell.id },
  });
  eq(r.status, 403, 'learn hors groupe → 403');
  eq(r.data.error, 'not a member', 'learn hors groupe : message membre');
  r = await api(base, 'POST', `/api/characters/${char.id}/spells`, {
    token: member.token,
    body: { spellId: spell.id },
  });
  eq(r.status, 403, 'learn par un membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can modify spells', 'learn membre : message métier');
  r = await api(base, 'POST', `/api/characters/${char.id}/spells`, {
    token: owner.token,
    body: { spellId: spell.id },
  });
  eq(r.status, 201, 'learn par le propriétaire → 201');
  const linkId = r.data.spell.id;

  // ---------- PATCH/DELETE /character-spells/:linkId ----------
  r = await api(base, 'PATCH', '/api/character-spells/999999', {
    token: owner.token,
    body: { prepared: true },
  });
  eq(r.status, 404, 'patch lien inexistant → 404');
  eq(r.data.error, 'character spell not found', 'patch lien inexistant : message');
  r = await api(base, 'PATCH', `/api/character-spells/${linkId}`, {
    token: member.token,
    body: { prepared: true },
  });
  eq(r.status, 403, 'patch lien par un membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can modify spells', 'patch lien membre : message métier');
  r = await api(base, 'DELETE', `/api/character-spells/${linkId}`, { token: member.token });
  eq(r.status, 403, 'delete lien par un membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can modify spells', 'delete lien membre : message métier');
  r = await api(base, 'DELETE', `/api/character-spells/${linkId}`, { token: gm.token });
  eq(r.status, 204, 'delete lien par le MD → 204');

  // ---------- POST /characters/:id/spell-effects + DELETE /spell-effects/:id ----------
  const shield = srv.query("SELECT id FROM spells WHERE srd_index = 'shield'");
  ok(shield, 'shield seeded');
  r = await api(base, 'POST', `/api/characters/${char.id}/spell-effects`, {
    token: outsider.token,
    body: { spellId: shield.id },
  });
  eq(r.status, 403, 'effet hors groupe → 403');
  eq(r.data.error, 'not a member', 'effet hors groupe : message membre');
  r = await api(base, 'POST', `/api/characters/${char.id}/spell-effects`, {
    token: member.token,
    body: { spellId: shield.id },
  });
  eq(r.status, 403, 'effet par un membre non propriétaire → 403');
  eq(
    r.data.error,
    'only the owner or GM can modify spell effects',
    'effet membre : message métier',
  );
  r = await api(base, 'POST', `/api/characters/${char.id}/spell-effects`, {
    token: owner.token,
    body: { spellId: shield.id },
  });
  eq(r.status, 201, 'effet posé par le propriétaire → 201');
  const effectId = r.data.effect.id;
  r = await api(base, 'DELETE', '/api/spell-effects/999999', { token: owner.token });
  eq(r.status, 404, 'levée inexistant → 404');
  eq(r.data.error, 'effect not found', 'levée inexistant : message');
  r = await api(base, 'DELETE', `/api/spell-effects/${effectId}`, { token: member.token });
  eq(r.status, 403, 'levée par un membre non propriétaire → 403');
  eq(
    r.data.error,
    'only the owner or GM can modify spell effects',
    'levée membre : message métier',
  );
  r = await api(base, 'DELETE', `/api/spell-effects/${effectId}`, { token: owner.token });
  eq(r.status, 200, 'levée par le propriétaire → 200');

  // ---------- features (owner-or-gm + check membre) ----------
  r = await api(base, 'POST', `/api/characters/${char.id}/features`, {
    token: outsider.token,
    body: {},
  });
  eq(r.status, 403, 'feature hors groupe → 403');
  eq(r.data.error, 'not a member', 'feature hors groupe : message membre');
  r = await api(base, 'POST', `/api/characters/${char.id}/features`, {
    token: member.token,
    body: { title: 'Trait' },
  });
  eq(r.status, 403, 'feature par un membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can modify features', 'feature membre : message métier');
  r = await api(base, 'POST', `/api/characters/${char.id}/features`, {
    token: owner.token,
    body: { title: 'Trait' },
  });
  eq(r.status, 201, 'feature créée par le propriétaire → 201');
  const featureId = r.data.feature.id;
  r = await api(base, 'PATCH', '/api/character-features/999999', {
    token: owner.token,
    body: { title: 'X' },
  });
  eq(r.status, 404, 'patch feature inexistant → 404');
  eq(r.data.error, 'feature not found', 'patch feature inexistant : message');
  r = await api(base, 'PATCH', `/api/character-features/${featureId}`, {
    token: member.token,
    body: { title: 'X' },
  });
  eq(r.status, 403, 'patch feature membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can modify features', 'patch feature membre : message');
  r = await api(base, 'PATCH', `/api/characters/${char.id}/features/order`, {
    token: member.token,
    body: { order: [featureId] },
  });
  eq(r.status, 403, 'reorder features membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can modify features', 'reorder features membre : message');
  r = await api(base, 'DELETE', `/api/character-features/${featureId}`, { token: member.token });
  eq(r.status, 403, 'delete feature membre non propriétaire → 403');
  eq(r.data.error, 'only the owner or GM can modify features', 'delete feature membre : message');
  r = await api(base, 'DELETE', `/api/character-features/${featureId}`, { token: gm.token });
  eq(r.status, 204, 'delete feature par le MD → 204');

  // ---------- GET /characters/:id/inventory (member-visible, fetch étendu) ----------
  r = await api(base, 'GET', `/api/characters/${char.id}/inventory`, { token: outsider.token });
  eq(r.status, 403, 'inventaire hors groupe → 403');
  eq(r.data.error, 'not a member', 'inventaire hors groupe : message');
  r = await api(base, 'GET', `/api/characters/${hidden.id}/inventory`, { token: member.token });
  eq(r.status, 404, 'inventaire caché par un membre → 404');
  eq(r.data.error, 'character not found', 'inventaire caché : message');
  r = await api(base, 'GET', `/api/characters/${char.id}/inventory`, { token: member.token });
  eq(r.status, 200, 'inventaire par un membre → 200');
}
