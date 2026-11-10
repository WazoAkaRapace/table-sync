/**
 * INSERT à clé naturelle GÉNÉRÉE (srd_index synthétique des sorts custom,
 * slug des monstres custom — plan « Contenus personnalisés ») : retry
 * SELECT-then-INSERT en transaction (jamais lastInsertRowid, piège documenté
 * AGENTS.md — la clé primaire/clé unique décide, la collision retente).
 */

import { getDb } from '../../db/index.ts';

export function retryInsertUnique<T>(
  generateKey: () => string,
  keyTaken: (key: string) => boolean,
  insertRow: (key: string) => T,
): T | null {
  // Convention DB du repo : la transaction native se garde en fermeture et
  // s'exécute à l'appel (drizzle joint la transaction ambiante).
  const run = getDb().transaction(() => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = generateKey();
      if (keyTaken(key)) continue;
      return insertRow(key);
    }
    return null;
  });
  return run();
}
