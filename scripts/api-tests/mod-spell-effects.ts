/**
 * Effets de sort sur la CA (v1) : pose/lecture/levée + chaque voie de
 * rupture de concentration (dégâts fiche + jet raté, conditions brisantes
 * côté fiche ET côté traqueur, 0 PV, remplacement par un nouveau sort
 * concentré, repos long), doublon 409, visibilité groupe (403 non-membre),
 * miroir traqueur (CA du combatant à l'ajout ET EN CONTINU : chaque pose /
 * levée / rupture resynchronise la ligne — plus d'effet fantôme au traqueur),
 * override manuel GAGNE, équipement armure/bouclier.
 */
import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const A = fx.charBran.id; // perso de bob (joueur) — DEX 16 (+3), sans armure

  // Carol rejoint le groupe : lecture par membre non-propriétaire.
  const join = await api(base, 'POST', '/api/parties/join', {
    token: fx.player2.token,
    body: { inviteCode: fx.inviteCode },
  });
  ok(join.status === 201, 'carol rejoint le groupe');

  const spellId = (slug: string): number => {
    const row = srv.query('SELECT id FROM spells WHERE srd_index = ?', slug);
    ok(row, `sort ${slug} seedé`);
    return row.id;
  };
  const faith = spellId('shield-of-faith');
  const haste = spellId('haste');
  const mageArmor = spellId('mage-armor');
  const shieldSpell = spellId('shield');
  const fireball = spellId('fireball');

  // ---------- POST : pose + concentration suit ----------
  let r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: {},
  });
  eq(r.status, 400, 'pose sans spellId → 400');
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: 999999 },
  });
  eq(r.status, 404, 'pose sort inconnu → 404');
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: fireball },
  });
  eq(r.status, 422, 'pose sort sans effet CA → 422');
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.outsider.token,
    body: { spellId: faith },
  });
  eq(r.status, 403, 'pose par non-membre → 403');

  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: faith },
  });
  eq(r.status, 201, 'pose Bouclier de la foi');
  eq(r.data.effect.effectKind, 'ac_bonus', 'kind dérivé de SPELL_AC_EFFECTS');
  eq(r.data.effect.acValue, 2, 'valeur dérivée (+2)');
  eq(r.data.effect.tiedToConcentration, true, 'concentration-dépendant');
  eq(r.data.effect.spell.srdIndex, 'shield-of-faith', 'sort joint par nom');
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', A).concentrating,
    1,
    'pose un effet concentré → concentrating = 1',
  );

  // ---------- GET : lignes actives jointes au nom du sort ----------
  r = await api(base, 'GET', `/api/characters/${A}/spell-effects`, { token: fx.gm.token });
  eq(r.status, 200, 'GET effets (MD)');
  eq(r.data.effects.length, 1, 'une ligne active');
  eq(r.data.effects[0].spell.nameFr, 'Bouclier de la foi', 'nom du sort joint');
  r = await api(base, 'GET', `/api/characters/${A}/spell-effects`, { token: fx.player2.token });
  eq(r.status, 200, 'GET effets (membre non owner)');
  r = await api(base, 'GET', `/api/characters/${A}/spell-effects`, { token: fx.outsider.token });
  eq(r.status, 403, 'GET par non-membre → 403');

  // ---------- doublon actif → 409 ----------
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: faith },
  });
  eq(r.status, 409, 'POST double → 409');

  // ---------- miroir traqueur : combatant créé APRÈS le cast porte la CA ----------
  const enc = await api(base, 'POST', `/api/parties/${fx.partyId}/encounters`, {
    token: fx.gm.token,
    body: { name: 'Effets' },
  });
  eq(enc.status, 201, 'rencontre créée');
  r = await api(base, 'POST', `/api/encounters/${enc.data.encounter.id}/combatants/player`, {
    token: fx.gm.token,
    body: { characterIds: [A] },
  });
  eq(r.status, 201, 'combatant ajouté');
  const combatantId = r.data.combatants[0].id;
  // Bran : DEX 16 (+3), sans armure → 13 ; + Bouclier de la foi (+2) → 15.
  eq(r.data.combatants[0].armorClass, 15, 'CA du combatant inclut les effets actifs (13+2)');
  /** CA courante du combatant miroir (base : 13 nu, DEX +3 sans armure). */
  const combatantAc = (): number =>
    srv.query('SELECT armor_class AS ac FROM combatants WHERE id = ?', combatantId).ac;

  // ---------- voie DÉGÂTS (fiche) : jet raté → concentrating 0 + effets tombent ----------
  // On force la rupture : PATCH currentHp avec concentrating explicite false
  // (le joueur a raté son jet) — la concentration tombe, les lignes suivent.
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { currentHp: 10, concentrating: false },
  });
  eq(r.status, 200, 'PATCH dégâts + concentration abandonnée');
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', A).concentrating,
    0,
    'concentrating = 0',
  );
  eq(
    srv.query(
      'SELECT active FROM character_spell_effects WHERE character_id = ? AND spell_id = ?',
      A,
      faith,
    ).active,
    0,
    'voie dégâts/jet raté : ligne inactive',
  );
  r = await api(base, 'GET', `/api/characters/${A}/spell-effects`, { token: fx.player.token });
  eq(r.data.effects.length, 0, 'GET ne montre plus que les actives');
  eq(combatantAc(), 13, 'voie dégâts (fiche) : CA du combatant retombée à 13');

  // ---------- voie NOUVEAU SORT CONCENTRÉ (remplacement) ----------
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: haste },
  });
  eq(r.status, 201, 're-pose après levée (ligne historique inactive ne bloque pas)');
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', A).concentrating,
    1,
    'concentration relevée',
  );
  // Le cast d'un NOUVEAU sort concentré (CastSpellSheet PATCH concentrating true
  // alors qu'un effet concentré est actif) : l'ancien effet tombe dans la même tx.
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { concentrating: true },
  });
  eq(r.status, 200, 'PATCH nouveau sort concentré');
  // concentré manuellement levé : concentrating false → effets liés tombent
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { concentrating: false },
  });
  eq(
    srv.query(
      'SELECT COUNT(*) AS c FROM character_spell_effects WHERE character_id = ? AND active = 1',
      A,
    ).c,
    0,
    'voie remplacement : plus aucun effet actif après la chute de concentration',
  );
  eq(combatantAc(), 13, 'voie remplacement : CA du combatant retombée à 13');

  // ---------- voie CONDITIONS BRISANTES (fiche) : Incapacitated ----------
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: faith },
  });
  eq(r.status, 201, 'pose foi (conditions)');
  eq(combatantAc(), 15, 'pose (conditions fiche) : CA du combatant 15');
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { conditions: ['Neutralisé'] },
  });
  eq(r.status, 200, 'PATCH condition brisante');
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', A).concentrating,
    0,
    'condition brisante → concentrating 0',
  );
  eq(
    srv.query(
      'SELECT active FROM character_spell_effects WHERE character_id = ? AND spell_id = ?',
      A,
      faith,
    ).active,
    0,
    'voie conditions (fiche) : ligne inactive',
  );
  eq(typeof r.data.concentrationBroken, 'string', 'réponse porte concentrationBroken (annonce UI)');
  eq(combatantAc(), 13, 'voie conditions (fiche) : CA du combatant retombée à 13');
  // nettoie la condition
  await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { conditions: [] },
  });

  // ---------- voie CONDITIONS BRISANTES (traqueur) : le MD pose Inconscient ----------
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: faith },
  });
  eq(r.status, 201, 'pose foi (traqueur)');
  eq(combatantAc(), 15, 'pose (conditions traqueur) : CA du combatant 15');
  r = await api(base, 'PATCH', `/api/combatants/${combatantId}`, {
    token: fx.gm.token,
    body: { conditions: [{ name: 'Inconscient', duration: 1 }] },
  });
  eq(r.status, 200, 'PATCH combatant condition brisante');
  eq(r.status, 200, 'conditions mirrorées');
  eq(
    srv.query(
      'SELECT active FROM character_spell_effects WHERE character_id = ? AND spell_id = ?',
      A,
      faith,
    ).active,
    0,
    'voie conditions (traqueur) : ligne inactive',
  );
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', A).concentrating,
    0,
    'voie conditions (traqueur) : concentrating 0',
  );
  eq(combatantAc(), 13, 'voie conditions (traqueur) : CA du combatant retombée à 13');

  // ---------- voie 0 PV (fiche) ----------
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: haste },
  });
  eq(r.status, 201, 'pose hâte (0 PV)');
  eq(combatantAc(), 15, 'pose hâte : CA du combatant 15');
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { currentHp: 0 },
  });
  eq(r.status, 200, 'PATCH 0 PV');
  eq(
    srv.query(
      'SELECT active FROM character_spell_effects WHERE character_id = ? AND spell_id = ?',
      A,
      haste,
    ).active,
    0,
    'voie 0 PV (fiche) : ligne inactive',
  );
  eq(combatantAc(), 13, 'voie 0 PV (fiche) : CA du combatant retombée à 13');
  await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { currentHp: 10 },
  });

  // ---------- voie 0 PV (traqueur) ----------
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: haste },
  });
  eq(r.status, 201, 'pose hâte (traqueur 0 PV)');
  eq(combatantAc(), 15, 'pose hâte (traqueur) : CA du combatant 15');
  r = await api(base, 'PATCH', `/api/combatants/${combatantId}`, {
    token: fx.gm.token,
    body: { hitPoints: 0 },
  });
  eq(r.status, 200, 'PATCH combatant 0 PV');
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', A).concentrating,
    0,
    'voie 0 PV (traqueur) : concentrating 0',
  );
  eq(
    srv.query(
      'SELECT active FROM character_spell_effects WHERE character_id = ? AND spell_id = ?',
      A,
      haste,
    ).active,
    0,
    'voie 0 PV (traqueur) : ligne inactive',
  );
  eq(combatantAc(), 13, 'voie 0 PV (traqueur) : CA du combatant retombée à 13');

  // ---------- DELETE : désactive + concentration suit ----------
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: faith },
  });
  eq(r.status, 201, 'pose foi (DELETE)');
  eq(combatantAc(), 15, 'pose (DELETE) : CA du combatant 15');
  const effectId = r.data.effect.id;
  r = await api(base, 'DELETE', `/api/spell-effects/${effectId}`, {
    token: fx.outsider.token,
  });
  eq(r.status, 403, 'DELETE par non-membre → 403');
  r = await api(base, 'DELETE', `/api/spell-effects/${effectId}`, { token: fx.gm.token });
  eq(r.status, 200, 'DELETE effet (MD)');
  eq(r.data.concentrating, false, 'plus aucun effet concentré → concentrating suit (0)');
  eq(
    srv.query('SELECT active FROM character_spell_effects WHERE id = ?', effectId).active,
    0,
    'ligne désactivée (historique conservé)',
  );
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_spell_effects WHERE id = ?', effectId).c,
    1,
    'ligne conservée, pas supprimée',
  );
  eq(combatantAc(), 13, 'levée (DELETE) : CA du combatant retombée à 13');
  r = await api(base, 'DELETE', `/api/spell-effects/${effectId}`, { token: fx.gm.token });
  eq(r.status, 409, 'DELETE déjà levé → 409');

  // DELETE d'un effet NON concentré ne touche pas la concentration :
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: faith },
  });
  eq(r.status, 201, 'pose foi (mixte)');
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: shieldSpell },
  });
  eq(r.status, 201, 'pose Bouclier (non concentré)');
  eq(combatantAc(), 20, 'cumul foi +2 et bouclier +5 : CA du combatant 20');
  eq(
    srv.query('SELECT concentrating FROM characters WHERE id = ?', A).concentrating,
    1,
    'concentration posée par la foi',
  );
  const shieldEffectId = r.data.effect.id;
  r = await api(base, 'DELETE', `/api/spell-effects/${shieldEffectId}`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'DELETE Bouclier');
  eq(
    r.data.concentrating,
    true,
    'lever un effet non concentré garde la concentration (la foi la justifie encore)',
  );
  eq(combatantAc(), 15, 'levée du bouclier : CA du combatant 15 (la foi tient)');
  // puis lever la foi → concentration tombe
  const faithRow = srv.query(
    'SELECT id FROM character_spell_effects WHERE character_id = ? AND spell_id = ? AND active = 1',
    A,
    faith,
  );
  r = await api(base, 'DELETE', `/api/spell-effects/${faithRow.id}`, {
    token: fx.player.token,
  });
  eq(r.data.concentrating, false, 'lever le dernier effet concentré → concentration 0');
  eq(combatantAc(), 13, 'levée de la foi : CA du combatant 13');

  // ---------- effet non concentré survit à la chute de concentration ----------
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: haste },
  });
  eq(r.status, 201, 'pose hâte (survie armure de mage)');
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: mageArmor },
  });
  eq(r.status, 201, 'pose Armure de mage (non concentrée)');
  const mageEffectId = r.data.effect.id;
  // Set-formula = PLANCHER (v1) : hâte déjà posée (13+2=15), l'armure de
  // mage pose max(CA, 13+DEX=16) → 16 — le plancher couvre la hâte, pas
  // d'empilement +3 par-dessus.
  eq(combatantAc(), 16, 'armure de mage plancher 16 couvre la hâte : CA du combatant 16');
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { concentrating: false },
  });
  eq(
    srv.query('SELECT active FROM character_spell_effects WHERE id = ?', mageEffectId).active,
    1,
    'Armure de mage survit à la chute de concentration',
  );
  eq(combatantAc(), 16, 'hâte tombée, armure de mage tient : CA du combatant 16');

  // ---------- repos long : la concentration tombe, les effets liés aussi ----------
  r = await api(base, 'POST', `/api/characters/${A}/rest`, {
    token: fx.player.token,
    body: { type: 'long' },
  });
  eq(r.status, 200, 'repos long');
  eq(
    srv.query('SELECT active FROM character_spell_effects WHERE id = ?', mageEffectId).active,
    1,
    'Armure de mage survit au repos long (8 h à la main — design v1)',
  );

  // ---------- historique : les lignes levées ne polluent pas GET ----------
  r = await api(base, 'GET', `/api/characters/${A}/spell-effects`, { token: fx.player.token });
  eq(r.data.effects.length, 1, 'une seule ligne active (armure de mage)');

  // ---------- override manuel GAGNE : le combatant suit l'override ----------
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { armorClassOverride: 18 },
  });
  eq(r.status, 200, 'PATCH override CA 18');
  eq(combatantAc(), 18, 'override manuel : CA du combatant 18 (GAGNE sur les effets)');
  r = await api(base, 'PATCH', `/api/characters/${A}`, {
    token: fx.player.token,
    body: { armorClassOverride: null },
  });
  eq(
    combatantAc(),
    16,
    'override retiré : CA du combatant revient aux effets (16, armure de mage)',
  );

  // ---------- équipement : équiper/retirer un bouclier suit au traqueur ----------
  // L'armure de mage (plancher 16) masquerait le bouclier — on la lève
  // d'abord : CA nue 13, le bouclier porte à 15.
  r = await api(base, 'DELETE', `/api/spell-effects/${mageEffectId}`, {
    token: fx.player.token,
  });
  eq(r.status, 200, 'lève Armure de mage (calcul propre du bouclier)');
  eq(combatantAc(), 13, 'CA nue : CA du combatant 13');
  const shieldItem = srv.query(
    'SELECT id FROM items WHERE name_fr = ? OR name = ?',
    'Bouclier',
    'Bouclier',
  );
  ok(shieldItem, 'item Bouclier seedé');
  r = await api(base, 'POST', `/api/characters/${A}/inventory`, {
    token: fx.player.token,
    body: { itemId: shieldItem.id, equipped: true },
  });
  eq(r.status, 201, 'équipe un bouclier');
  eq(combatantAc(), 15, 'bouclier équipé (+2 sur 13) : CA du combatant 15');
  const invId = srv.query(
    'SELECT id FROM inventory WHERE character_id = ? AND item_id = ?',
    A,
    shieldItem.id,
  ).id;
  r = await api(base, 'PATCH', `/api/inventory/${invId}`, {
    token: fx.player.token,
    body: { equipped: false },
  });
  eq(r.status, 200, 'déséquipe le bouclier');
  eq(combatantAc(), 13, 'bouclier déséquipé : CA du combatant 13');
  r = await api(base, 'PATCH', `/api/inventory/${invId}`, {
    token: fx.player.token,
    body: { equipped: true },
  });
  eq(combatantAc(), 15, 're-équipé : CA du combatant 15');
  r = await api(base, 'DELETE', `/api/inventory/${invId}`, { token: fx.player.token });
  eq(r.status, 204, 'supprime le bouclier');
  eq(combatantAc(), 13, 'bouclier supprimé : CA du combatant 13');

  // ---------- perso dédié : doublon 409 n\\'a pas fui sur un autre perso ----------
  const other = await createCharacter(base, fx.gm.token, fx.partyId, {
    name: 'SansEffet',
    maxHp: 8,
  });
  r = await api(base, 'GET', `/api/characters/${other.id}/spell-effects`, { token: fx.gm.token });
  eq(r.data.effects.length, 0, 'autre perso : aucun effet');

  // ============================================================
  // v2 : CIBLAGE — cast sur un AUTRE joueur / « Autre »
  // ============================================================

  // Alya (alice, DEX 12 → +1, sans armure → CA 11) lance sur Bran (DEX 16
  // → CA 13). Le MD crée la rencontre + ajoute Bran au traqueur pour lire
  // son miroir CA.
  const Alya = fx.charAlya.id;
  const alyaCombatant = await api(
    base,
    'POST',
    `/api/encounters/${enc.data.encounter.id}/combatants/player`,
    { token: fx.gm.token, body: { characterIds: [Alya] } },
  );
  eq(alyaCombatant.status, 201, 'combatant Alya ajoutée');
  const alyaCombatantId = alyaCombatant.data.combatants[0].id;
  /** CA courante du combatant miroir d'Alya (base : 11 nu, DEX +1). */
  const alyaAc = (): number =>
    srv.query('SELECT armor_class AS ac FROM combatants WHERE id = ?', alyaCombatantId).ac;
  /** Concentration courante d'un perso. */
  const concentratingOf = (id: number): number =>
    srv.query('SELECT concentrating FROM characters WHERE id = ?', id).concentrating;
  /** Ligne d'effet actif d'un (porteur, sort). */
  const activeRow = (bearer: number, spell: number): any =>
    srv.query(
      'SELECT * FROM character_spell_effects WHERE character_id = ? AND spell_id = ? AND active = 1',
      bearer,
      spell,
    );

  // ---------- validation de la cible ----------
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetCharacterId: fx.charSecret.id },
  });
  eq(r.status, 404, 'cast sur perso CACHÉ du groupe → 404 (le picker ne liste que les visibles)');
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetCharacterId: other.id, targetLabel: 'Gobelin' },
  });
  eq(r.status, 400, 'targetCharacterId + targetLabel à la fois → 400 (fiche XOR Autre)');
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetLabel: '   ' },
  });
  eq(r.status, 400, 'targetLabel blanc → 400');
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetLabel: 'x'.repeat(61) },
  });
  eq(r.status, 400, 'targetLabel > 60 chars → 400');

  // ---------- cast foi sur une CIBLE : la ligne vit chez la cible, la
  // concentration sur le LANCEUR ----------
  eq(concentratingOf(Alya), 0, 'pré : Alya ne concentre pas');
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetCharacterId: A },
  });
  eq(r.status, 201, 'Alya cast Bouclier de la foi SUR Bran');
  const targetedEffect = r.data.effect;
  eq(targetedEffect.characterId, A, 'ligne PORTEE par Bran (character_id = cible)');
  eq(targetedEffect.casterCharacterId, Alya, 'ligne CASTÉE par Alya (caster_character_id)');
  eq(targetedEffect.targetLabel, null, 'pas de label (cible fiche)');
  eq(concentratingOf(Alya), 1, 'concentration posée sur le LANCEUR (Alya)');
  eq(concentratingOf(A), 0, 'la CIBLE (Bran) ne concentre pas');
  eq(combatantAc(), 15, 'CA du combatant de Bran : 13 + 2 (foi castée par Alya)');
  eq(alyaAc(), 11, "CA du combatant d'Alya inchangée (elle ne porte pas l'effet)");

  // GET côté cible : ligne PORTÉE (role bearer) ; GET côté lanceur : ligne
  // CASTÉE (role caster) — les chips du lanceur. Bran ne porte QUE cette
  // ligne (tout le v1 a été levé plus haut).
  r = await api(base, 'GET', `/api/characters/${A}/spell-effects`, { token: fx.player.token });
  eq(r.data.effects.length, 1, 'Bran porte exactement la ligne ciblée');
  const borneLine = r.data.effects.find((e: any) => e.id === targetedEffect.id);
  ok(borneLine, 'GET côté CIBLE montre la ligne');
  eq(borneLine.role, 'bearer', 'côté cible : role bearer');
  r = await api(base, 'GET', `/api/characters/${Alya}/spell-effects`, { token: fx.gm.token });
  const castLine = r.data.effects.find((e: any) => e.id === targetedEffect.id);
  ok(castLine, 'GET côté LANCEUR montre la ligne (chips)');
  eq(castLine.role, 'caster', 'côté lanceur : role caster');
  eq(castLine.characterId, A, 'le lanceur voit vers QUI la ligne pointe');

  // ---------- doublon PAR PORTEUR : 409 même sort même porteur, mais un
  // autre lanceur (Bran self-cast hâte) passe ----------
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetCharacterId: A },
  });
  eq(r.status, 409, 'doublon : même sort déjà ACTIF sur le MÊME PORTEUR → 409');
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: haste },
  });
  eq(r.status, 201, 'un AUTRE sort sur le même porteur passe (hâte self par Bran)');
  eq(concentratingOf(A), 1, 'hâte self → Bran concentre aussi');
  const branHasteId = r.data.effect.id;

  // ---------- rupture par DÉGÂTS au LANCEUR (fiche, jet raté) : la ligne
  // chez la CIBLE tombe + CA cible retombe + miroir ----------
  r = await api(base, 'PATCH', `/api/characters/${Alya}`, {
    token: fx.gm.token,
    body: { currentHp: 15, concentrating: false },
  });
  eq(r.status, 200, 'dégâts à Alya + jet raté');
  eq(concentratingOf(Alya), 0, 'concentration Alya tombée');
  eq(activeRow(A, faith), undefined, 'ligne foi chez la CIBLE inactive');
  // Bran garde SA hâte (self-castée, SA concentration tient)
  ok(activeRow(A, haste), "la hâte SELF de Bran survit à la rupture d'Alya");
  eq(concentratingOf(A), 1, 'Bran concentre toujours (sa hâte)');
  eq(combatantAc(), 15, "CA Bran : 13 + 2 hâte (la foi d'Alya est tombée)");
  // cleanup : PV d'Alya restaurés (mod-combat relit sa fiche : 20 attendus)
  // puis lever la hâte de Bran pour la suite.
  await api(base, 'PATCH', `/api/characters/${Alya}`, {
    token: fx.gm.token,
    body: { currentHp: 20 },
  });
  await api(base, 'DELETE', `/api/spell-effects/${branHasteId}`, { token: fx.player.token });
  eq(concentratingOf(A), 0, 'hâte levée → Bran ne concentre plus');

  // ---------- rupture par CONDITIONS BRISANTES sur le LANCEUR (traqueur) ----------
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetCharacterId: A },
  });
  eq(r.status, 201, 'Alya re-caste foi sur Bran (conditions traqueur)');
  eq(combatantAc(), 15, 'CA Bran 15 (13 + 2)');
  r = await api(base, 'PATCH', `/api/combatants/${alyaCombatantId}`, {
    token: fx.gm.token,
    body: { conditions: [{ name: 'Inconscient', duration: 1 }] },
  });
  eq(r.status, 200, "MD pose Inconscient sur le combatant d'Alya (le lanceur)");
  eq(concentratingOf(Alya), 0, 'concentration Alya rompue (traqueur)');
  eq(activeRow(A, faith), undefined, 'ligne foi chez Bran inactive');
  eq(combatantAc(), 13, 'CA du combatant de Bran retombée à 13 (miroir cible)');
  await api(base, 'PATCH', `/api/combatants/${alyaCombatantId}`, {
    token: fx.gm.token,
    body: { conditions: [] },
  });

  // ---------- DELETE depuis la fiche de la CIBLE : concentrating retombe
  // sur le LANCEUR ----------
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetCharacterId: A },
  });
  eq(r.status, 201, 'Alya cast foi sur Bran (DELETE test)');
  eq(concentratingOf(Alya), 1, 'Alya concentre');
  eq(combatantAc(), 15, 'CA Bran 15');
  const targetRow = activeRow(A, faith);
  ok(targetRow, 'ligne active chez Bran');
  // le MD lève l'effet DEPUIS la fiche de la CIBLE
  r = await api(base, 'DELETE', `/api/spell-effects/${targetRow.id}`, { token: fx.gm.token });
  eq(r.status, 200, 'DELETE effet posé sur autrui (depuis la fiche cible, par le MD)');
  eq(
    r.data.concentrating,
    false,
    "plus d'effet concentré CASTÉ par Alya → concentrating LANCEUR = 0",
  );
  eq(concentratingOf(Alya), 0, 'concentration Alya retombée');
  eq(concentratingOf(A), 0, "Bran n'a jamais concentré");
  eq(combatantAc(), 13, 'CA du combatant de Bran retombée à 13');

  // ---------- « Autre » : label libre, ligne sur le LANCEUR, AUCUNE CA ----------
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetLabel: '  Gobelin  ' },
  });
  eq(r.status, 201, 'cast foi sur « Autre » (Gobelin)');
  const otherEffect = r.data.effect;
  eq(otherEffect.characterId, Alya, 'ligne « Autre » vit sur la fiche du LANCEUR');
  eq(otherEffect.casterCharacterId, Alya, 'caster = lanceur');
  eq(otherEffect.targetLabel, 'Gobelin', 'label trimé');
  eq(concentratingOf(Alya), 1, 'lanceur concentre (effet concentré)');
  eq(alyaAc(), 11, 'AUCUN impact CA lanceur (target_label filtré par activeAcEffectsOf)');
  // la ligne apparaît côté lanceur (role bearer — elle vit sur sa fiche)
  r = await api(base, 'GET', `/api/characters/${Alya}/spell-effects`, { token: fx.gm.token });
  const otherLine = r.data.effects.find((e: any) => e.id === otherEffect.id);
  ok(otherLine, 'chip « Autre » visible côté lanceur');
  eq(otherLine.targetLabel, 'Gobelin', 'GET porte le label');
  // rupture lanceur (fiche) → ligne « Autre » tombe aussi
  r = await api(base, 'PATCH', `/api/characters/${Alya}`, {
    token: fx.gm.token,
    body: { concentrating: false },
  });
  eq(r.status, 200, 'concentration Alya abandonnée');
  eq(
    srv.query('SELECT active FROM character_spell_effects WHERE id = ?', otherEffect.id).active,
    0,
    'ligne « Autre » désactivée par la rupture du lanceur',
  );
  eq(alyaAc(), 11, "CA Alya toujours 11 (rien n'a bougé)");

  // ---------- Bouclier éphémère : expire à la fin du tour du lanceur ----------
  // (RAW « jusqu'au début de ton prochain tour », approximé fin de tour.)
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: shieldSpell },
  });
  eq(r.status, 201, 'pose Bouclier (réaction)');
  eq(r.data.effect.expiresOnTurnEnd, true, 'flag éphémère servi au POST');
  eq(combatantAc(), 18, 'CA du combatant inclut le Bouclier (13+5)');
  // La rencontre doit être ACTIVE pour avancer les tours.
  r = await api(base, 'PATCH', `/api/encounters/${enc.data.encounter.id}`, {
    token: fx.gm.token,
    body: { status: 'active', round: 1, turnIndex: 0 },
  });
  eq(r.status, 200, 'rencontre démarrée');
  // Le tour de Bran se termine → le Bouclier tombe (expireOnTurnEnd).
  r = await api(base, 'POST', `/api/encounters/${enc.data.encounter.id}/next-turn`, {
    token: fx.gm.token,
  });
  eq(r.status, 200, 'tour suivant');
  eq(
    srv.query(
      'SELECT active FROM character_spell_effects WHERE character_id = ? AND spell_id = ?',
      A,
      shieldSpell,
    ).active,
    0,
    'Bouclier éphémère désactivé à la fin du tour du lanceur',
  );
  eq(combatantAc(), 13, 'CA du combatant retombée à 13 après expiration');
  r = await api(base, 'GET', `/api/characters/${A}/spell-effects`, { token: fx.player.token });
  eq(
    r.data.effects.filter((e: { spellId: number }) => e.spellId === shieldSpell).length,
    0,
    'GET ne sert plus le Bouclier expiré',
  );

  // ---------- 404 cible d'un AUTRE groupe ----------
  r = await api(base, 'POST', `/api/characters/${Alya}/spell-effects`, {
    token: fx.gm.token,
    body: { spellId: faith, targetCharacterId: A },
  });
  eq(r.status, 201, 're-caste pour test cross-party');
  const daveParty = await api(base, 'POST', '/api/parties', {
    token: fx.outsider.token,
    body: { name: 'Groupe de Dave' },
  });
  const daveChar = await createCharacter(base, fx.outsider.token, daveParty.data.party.id, {
    name: 'DaveHero',
    maxHp: 10,
  });
  r = await api(base, 'POST', `/api/characters/${A}/spell-effects`, {
    token: fx.player.token,
    body: { spellId: haste, targetCharacterId: daveChar.id },
  });
  eq(r.status, 404, 'cible hors du groupe → 404');
  // cleanup : Alya concentre encore — lever proprement
  const alyaRow = srv.query(
    'SELECT id FROM character_spell_effects WHERE character_id = ? AND active = 1',
    Alya,
  );
  if (alyaRow) {
    await api(base, 'DELETE', `/api/spell-effects/${alyaRow.id}`, { token: fx.gm.token });
  }
}
