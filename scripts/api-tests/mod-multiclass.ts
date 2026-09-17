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

  // ---------- PATCH plat hitDiceUsed : répercuté sur les lignes (FIFO) ----------
  // Les +/− de Survie patchent le compteur dénormalisé ; les lignes de classe
  // sont la source de vérité de la fiche (hitDiceByClassOf) — le delta doit
  // les atteindre, sinon le compteur affiché ne bouge pas.
  r = await api(base, 'PATCH', `/api/characters/${morrigan.id}`, {
    token: GM,
    body: { hitDiceUsed: 2 },
  });
  eq(r.status, 200, 'PATCH plat hitDiceUsed');
  eq(r.data.character.hitDiceUsed, 2, 'compteur plat = 2');
  eq(
    r.data.character.classes.reduce((sum: number, c: any) => sum + c.hitDiceUsed, 0),
    2,
    'somme des lignes dans la réponse = 2',
  );
  classDice = srv.query(
    'SELECT hit_dice_used FROM character_classes WHERE character_id = ? AND class_key = ?',
    morrigan.id,
    'Occultiste',
  );
  eq(classDice.hit_dice_used, 2, 'dépense FIFO sur la première ligne (Occultiste)');
  row = srv.query('SELECT hit_dice_used FROM characters WHERE id = ?', morrigan.id);
  eq(row.hit_dice_used, 2, 'colonne dénormalisée resynchronisée = somme des lignes');

  // Sur-dépense : clampée au pool (Occultiste 6 + Magicien 5 = 11 dés)
  r = await api(base, 'PATCH', `/api/characters/${morrigan.id}`, {
    token: GM,
    body: { hitDiceUsed: 99 },
  });
  eq(r.status, 200, 'PATCH plat hitDiceUsed au-delà du pool');
  row = srv.query('SELECT hit_dice_used FROM characters WHERE id = ?', morrigan.id);
  eq(row.hit_dice_used, 11, 'clamp au pool total (11 dés)');

  // Récupération intégrale front-loaded
  r = await api(base, 'PATCH', `/api/characters/${morrigan.id}`, {
    token: GM,
    body: { hitDiceUsed: 0 },
  });
  eq(r.status, 200, 'PATCH plat hitDiceUsed à 0');
  classDice = srv.queryAll(
    'SELECT hit_dice_used FROM character_classes WHERE character_id = ? ORDER BY position',
    morrigan.id,
  );
  eq(
    classDice.reduce((sum: number, c: any) => sum + c.hit_dice_used, 0),
    0,
    'récupération intégrale sur toutes les lignes',
  );

  // ---------- Repos court : dépense PAR TYPE DE DÉ (SRD) ----------
  // Le pool de morrigan est plein (Occultiste 6 / Magicien 5, 0 dépensé).
  // La fiche multiclassée choisit ses dés : seuls les d6 (Magicien) partent.
  r = await api(base, 'PATCH', `/api/characters/${morrigan.id}`, {
    token: GM,
    body: { currentHp: 30 },
  });
  eq(r.status, 200, 'PV abaissés avant le repos');
  r = await api(base, 'POST', `/api/characters/${morrigan.id}/rest`, {
    token: GM,
    body: {
      type: 'short',
      hitDiceSpentByClass: [{ classKey: 'Magicien', count: 2 }],
      healedHp: 7,
    },
  });
  eq(r.status, 200, 'repos court : dépense par type de dé');
  eq(r.data.diceSpent, 2, 'deux d6 comptés');
  eq(r.data.healed, 7, 'soin annoncé appliqué');
  classDice = srv.queryAll(
    'SELECT class_key, hit_dice_used FROM character_classes WHERE character_id = ? ORDER BY position',
    morrigan.id,
  );
  eq(classDice[0].hit_dice_used, 0, 'ligne Occultiste (d8) intacte');
  eq(classDice[1].hit_dice_used, 2, 'ligne Magicien (d6) dépensée');
  row = srv.query('SELECT hit_dice_used FROM characters WHERE id = ?', morrigan.id);
  eq(row.hit_dice_used, 2, 'compteur plat = somme des lignes');

  // Payloads invalides
  r = await api(base, 'POST', `/api/characters/${morrigan.id}/rest`, {
    token: GM,
    body: { type: 'short', hitDiceSpentByClass: [{ classKey: 'Magicien' }] },
  });
  eq(r.status, 400, 'hitDiceSpentByClass sans count → 400');
  r = await api(base, 'POST', `/api/characters/${morrigan.id}/rest`, {
    token: GM,
    body: { type: 'short', hitDiceSpentByClass: [{ classKey: 'Magicien', count: -1 }] },
  });
  eq(r.status, 400, 'hitDiceSpentByClass négatif → 400');
  r = await api(base, 'POST', `/api/characters/${morrigan.id}/rest`, {
    token: GM,
    body: { type: 'short', hitDiceSpentByClass: 'nope' },
  });
  eq(r.status, 400, 'hitDiceSpentByClass hors tableau → 400');

  // ---------- Repos long : les PLUS GROS dés d'abord ----------
  // Lignes réordonnées : d6 (Magicien) en position 0, d8 (Occultiste) en 1.
  // Tout est dépensé (5 + 6 = 11), budget ⌊11/2⌋ = 5 : l'ancien FIFO par
  // position rendait les d6 d'abord — ce sont les d8 qui doivent partir.
  r = await api(base, 'PATCH', `/api/characters/${morrigan.id}`, {
    token: GM,
    body: {
      classes: [
        { classKey: 'Magicien', level: 5, hitDiceUsed: 5 },
        { classKey: 'Occultiste', level: 6, hitDiceUsed: 6 },
      ],
    },
  });
  eq(r.status, 200, 'classes[] réordonnées (d6 en tête)');
  r = await api(base, 'POST', `/api/characters/${morrigan.id}/rest`, {
    token: GM,
    body: { type: 'long' },
  });
  eq(r.status, 200, 'repos long gros dés d’abord');
  classDice = srv.queryAll(
    'SELECT class_key, hit_dice_used FROM character_classes WHERE character_id = ? ORDER BY position',
    morrigan.id,
  );
  eq(classDice[0].hit_dice_used, 5, 'les d6 (position 0) ne récupèrent RIEN');
  eq(classDice[1].hit_dice_used, 1, 'les d8 encaissent le budget (6 − 5 = 1)');
  row = srv.query('SELECT hit_dice_used FROM characters WHERE id = ?', morrigan.id);
  eq(row.hit_dice_used, 6, 'compteur plat = somme des lignes');

  // ---------- Cas ordinaire : mono-classe (une seule ligne) ----------
  // Toute fiche créée avec une classe porte SA ligne unique — le stepper
  // plat des +/− de Survie doit l'atteindre (le FIFO dégénère sur 1 ligne).
  const yvon = await createCharacter(base, GM, fx.partyId, {
    name: 'Yvon',
    characterClass: 'Guerrier',
    level: 5,
    maxHp: 45,
  });
  r = await api(base, 'PATCH', `/api/characters/${yvon.id}`, {
    token: GM,
    body: { hitDiceUsed: 2 },
  });
  eq(r.status, 200, 'PATCH plat hitDiceUsed mono-classe');
  row = srv.query('SELECT hit_dice_used FROM characters WHERE id = ?', yvon.id);
  eq(row.hit_dice_used, 2, 'mono-classe : colonne dénormalisée = 2');
  classDice = srv.query(
    'SELECT hit_dice_used FROM character_classes WHERE character_id = ?',
    yvon.id,
  );
  eq(classDice.hit_dice_used, 2, 'mono-classe : ligne Guerrier synchronisée');

  // ---------- Fiche héritage sans lignes de classe ----------
  // Alya (fixtures) n'a NI characterClass NI classes[] : aucune ligne à
  // synchroniser — la colonne plat reste la seule source (fallback de
  // classesOf/hitDiceByClassOf), et le PATCH ne matérialise pas de ligne.
  r = await api(base, 'PATCH', `/api/characters/${fx.charAlya.id}`, {
    token: GM,
    body: { hitDiceUsed: 3 },
  });
  eq(r.status, 200, 'PATCH plat hitDiceUsed fiche sans lignes de classe');
  row = srv.query('SELECT hit_dice_used FROM characters WHERE id = ?', fx.charAlya.id);
  eq(row.hit_dice_used, 3, 'sans lignes : colonne plat mise à jour');
  eq(
    srv.query('SELECT COUNT(*) AS c FROM character_classes WHERE character_id = ?', fx.charAlya.id)
      .c,
    0,
    'sans lignes : aucune ligne matérialisée par le PATCH',
  );

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
