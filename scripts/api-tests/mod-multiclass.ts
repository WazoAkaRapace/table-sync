/**
 * Multiclassage (SRD 5.1) : création/édition des lignes de classe, pools
 * d'emplacements (incantation + pacte séparés), dés de vie par type de dé,
 * sorts avec classe d'origine, sorts de domaine multi-sources, repos.
 */
import { api, createCharacter, eq, type Fixtures, ok, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const GM = fx.gm.token;

  // Index redondants retirés (0029) : les uniques (character_id, class_key) /
  // (character_id, spell_id) couvrent le préfixe gauche — la migration a dû
  // les déposer au boot, et les lignes de classe se lisent quand même.
  eq(
    srv.query(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name IN ('idx_character_classes_character', 'idx_character_spells_char')",
    ).c,
    0,
    'redundant prefix indexes dropped by migration',
  );

  // ---------- Création multiclassée + dénormalisés ----------
  const siofra = await createCharacter(base, GM, fx.partyId, {
    name: 'Siofra',
    strength: 13,
    charisma: 14,
    maxHp: 40,
    classes: [
      { classKey: 'Paladin', level: 2 },
      { classKey: 'Ensorceleur', level: 3, subclassKey: 'draconique' },
    ],
  });

  let r = await api(base, 'GET', `/api/characters/${siofra.id}`, { token: GM });
  eq(r.status, 200, 'GET multiclass character');
  eq(r.data.character.level, 5, 'niveau total = somme des lignes');
  eq(r.data.character.characterClass, 'Paladin', 'classe de départ dénormalisée');
  eq(r.data.character.classes.length, 2, 'deux lignes de classe');
  eq(
    r.data.character.classes[1].subclassKey,
    'draconique',
    'sous-classe portée par la ligne de classe',
  );
  const rows = srv.queryAll(
    'SELECT class_key, level, subclass_key, position FROM character_classes WHERE character_id = ? ORDER BY position',
    siofra.id,
  );
  eq(rows.length, 2, 'lignes persistées en base');
  eq(rows[0].class_key, 'Paladin', 'position 0 = classe de départ');

  // ---------- Validation ----------
  r = await api(base, 'PATCH', `/api/characters/${siofra.id}`, {
    token: GM,
    body: {
      classes: [
        { classKey: 'Guerrier', level: 5 },
        { classKey: 'Guerrier', level: 3 },
      ],
    },
  });
  eq(r.status, 400, 'classe en double → 400');

  r = await api(base, 'PATCH', `/api/characters/${siofra.id}`, {
    token: GM,
    body: {
      classes: [
        { classKey: 'Guerrier', level: 12 },
        { classKey: 'Roublard', level: 9 },
      ],
    },
  });
  eq(r.status, 400, 'niveau total > 20 → 400');

  r = await api(base, 'PATCH', `/api/characters/${siofra.id}`, {
    token: GM,
    body: { classes: [{ classKey: 'Magicien', level: 1, subclassKey: 'evocation' }] },
  });
  eq(r.status, 400, 'sous-classe sous son palier RAW → 400');

  r = await api(base, 'PATCH', `/api/characters/${siofra.id}`, {
    token: GM,
    body: { classes: [{ classKey: 'Nain', level: 2 }] },
  });
  eq(r.status, 400, 'classe inconnue → 400');

  // ---------- Occultiste mixte : deux pools + dés de vie par type ----------
  const morrigan = await createCharacter(base, GM, fx.partyId, {
    name: 'Morrigan',
    charisma: 16,
    intelligence: 14,
    maxHp: 50,
    classes: [
      { classKey: 'Occultiste', level: 5 },
      { classKey: 'Magicien', level: 5 },
    ],
  });

  r = await api(base, 'PATCH', `/api/characters/${morrigan.id}`, {
    token: GM,
    body: {
      pactSlotsUsed: [0, 0, 1, 0, 0, 0, 0, 0, 0],
      spellSlotsUsed: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    },
  });
  eq(r.status, 200, 'PATCH des deux pools');

  // Sort avec classe d'origine
  const fireball = srv.query("SELECT id FROM spells WHERE srd_index = 'fireball'");
  r = await api(base, 'POST', `/api/characters/${morrigan.id}/spells`, {
    token: GM,
    body: { spellId: fireball.id, prepared: true, classSource: 'Magicien' },
  });
  eq(r.status, 201, 'sort ajouté avec classe d’origine');
  eq(r.data.spell.classSource, 'Magicien', 'classe d’origine renvoyée');

  r = await api(base, 'POST', `/api/characters/${morrigan.id}/spells`, {
    token: GM,
    body: { spellId: fireball.id, classSource: 'Barde' },
  });
  eq(r.status, 400, 'classe d’origine hors fiche → 400');

  // Repos court : le pool de PACTE seul se recharge
  r = await api(base, 'POST', `/api/characters/${morrigan.id}/rest`, {
    token: GM,
    body: { type: 'short', hitDiceSpent: 2, healedHp: 9 },
  });
  eq(r.status, 200, 'repos court multiclassé');
  let row = srv.query(
    'SELECT pact_slots_used, spell_slots_used, hit_dice_used FROM characters WHERE id = ?',
    morrigan.id,
  );
  eq(row.pact_slots_used, '[0,0,0,0,0,0,0,0,0]', 'repos court : pacte réinitialisé');
  eq(row.spell_slots_used, '[4,3,0,0,0,0,0,0,0]', 'repos court : pool incantation intact');
  eq(row.hit_dice_used, 2, 'dés dépensés (compteur dénormalisé = somme)');

  let classDice = srv.queryAll(
    'SELECT class_key, hit_dice_used FROM character_classes WHERE character_id = ? ORDER BY position',
    morrigan.id,
  );
  eq(classDice[0].hit_dice_used, 2, 'dés dépensés sur la ligne Occultiste (FIFO)');

  // Repos long : les deux pools + budget de dés ⌊10/2⌋ = 5
  r = await api(base, 'POST', `/api/characters/${morrigan.id}/rest`, {
    token: GM,
    body: { type: 'long' },
  });
  eq(r.status, 200, 'repos long multiclassé');
  row = srv.query(
    'SELECT pact_slots_used, spell_slots_used, hit_dice_used FROM characters WHERE id = ?',
    morrigan.id,
  );
  eq(row.pact_slots_used, '[0,0,0,0,0,0,0,0,0]', 'repos long : pacte réinitialisé');
  eq(row.spell_slots_used, '[0,0,0,0,0,0,0,0,0]', 'repos long : incantation réinitialisée');
  eq(row.hit_dice_used, 0, 'budget 5 dés regagnés (2 dépensés)');

  // ---------- Édition classes[] : les dés dépensés survivent ----------
  r = await api(base, 'PATCH', `/api/characters/${morrigan.id}`, {
    token: GM,
    body: {
      classes: [
        { classKey: 'Occultiste', level: 6, hitDiceUsed: 1 },
        { classKey: 'Magicien', level: 5, hitDiceUsed: 0 },
      ],
    },
  });
  eq(r.status, 200, 'PATCH classes[]');
  eq(r.data.character.level, 11, 'niveau total resynchronisé');
  classDice = srv.query(
    'SELECT hit_dice_used FROM character_classes WHERE character_id = ? AND class_key = ?',
    morrigan.id,
    'Occultiste',
  );
  eq(classDice.hit_dice_used, 1, 'dés dépensés préservés par ligne');

  // ---------- Sorts de domaine multi-sources (Clerc + Paladin) ----------
  const ternes = await createCharacter(base, GM, fx.partyId, {
    name: 'Ternes',
    wisdom: 14,
    charisma: 12,
    maxHp: 30,
    classes: [
      { classKey: 'Clerc', level: 3, subclassKey: 'vie' },
      { classKey: 'Paladin', level: 3, subclassKey: 'devotion' },
    ],
  });
  r = await api(base, 'GET', `/api/characters/${ternes.id}/domain-spells`, { token: GM });
  eq(r.status, 200, 'domain-spells multiclassé');
  // Clerc Vie 3 : 2 paliers (niv. 1+2) = 4 sorts ; Serment de Dévotion 3 : 2 sorts
  eq(r.data.spells.length, 6, 'sorts toujours préparés des DEUX classes');
  ok(
    r.data.spells.every((s: any) => s.domainLevel > 0),
    'chaque sort porte son palier de domaine',
  );

  // ---------- Parité mono-classe : PATCH plat (legacy) ----------
  r = await api(base, 'PATCH', `/api/characters/${ternes.id}`, {
    token: GM,
    body: { level: 4 },
  });
  eq(r.status, 200, 'PATCH level legacy');
  // `level` plat = total : le delta (4-6 = -2) va sur la DERNIÈRE ligne
  row = srv.query(
    'SELECT level FROM character_classes WHERE character_id = ? AND position = 0',
    ternes.id,
  );
  eq(row.level, 3, 'première ligne inchangée (Clerc 3)');
  row = srv.query(
    'SELECT level, hit_dice_used FROM character_classes WHERE character_id = ? AND position = 1',
    ternes.id,
  );
  eq(row.level, 1, 'delta reporté sur la dernière ligne (Paladin 3→1)');
  eq(row.hit_dice_used, 0, 'dés de ligne intacts');
  row = srv.query('SELECT level FROM characters WHERE id = ?', ternes.id);
  eq(row.level, 4, 'niveau total dénormalisé cohérent');
}
