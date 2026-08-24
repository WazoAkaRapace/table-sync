/**
 * API data-query test suite + raw-SQL gate.
 * Run: npm run test-api
 *
 * Boots a throwaway API server (fresh SQLite in a temp dir), runs the
 * domain modules sequentially, then verifies that ZERO .prepare(...) sites
 * remain in apps/api/src/routes/** and src/sync/** — the raw-SQL → Drizzle
 * migration completed 2026-08; every route query now goes through the
 * query builder on the shared better-sqlite3 connection. Any new raw site
 * is a regression. Exit non-zero on any failure.
 */
import { computeCoverage } from './api-tests/coverage.ts';
import {
  buildFixtures,
  type Fixtures,
  type ServerHandle,
  startServer,
} from './api-tests/harness.ts';
import { run as authParties } from './api-tests/mod-auth-parties.ts';
import { run as characters } from './api-tests/mod-characters.ts';
import { run as combat } from './api-tests/mod-combat.ts';
import { run as featuresNotes } from './api-tests/mod-features-notes.ts';
import { run as gma } from './api-tests/mod-gma.ts';
import { run as inventory } from './api-tests/mod-inventory.ts';
import { run as itemAnnotations } from './api-tests/mod-item-annotations.ts';
import { run as itemImages } from './api-tests/mod-item-images.ts';
import { run as items } from './api-tests/mod-items.ts';
import { run as multiclass } from './api-tests/mod-multiclass.ts';
import { run as npcsMonsters } from './api-tests/mod-npcs-monsters.ts';
import { run as spells } from './api-tests/mod-spells.ts';
import { run as syncWs } from './api-tests/mod-sync-ws.ts';
import { run as wildshapeRest } from './api-tests/mod-wildshape-rest.ts';

const MODULES: Array<{
  name: string;
  run: (base: string, fx: Fixtures, srv: ServerHandle) => Promise<void>;
}> = [
  { name: 'auth + parties', run: authParties },
  { name: 'characters', run: characters },
  { name: 'items', run: items },
  { name: 'inventory + locations', run: inventory },
  { name: 'item images', run: itemImages },
  { name: 'item annotations', run: itemAnnotations },
  { name: 'gm assistant', run: gma },
  { name: 'spells', run: spells },
  { name: 'features + notes', run: featuresNotes },
  { name: 'npcs + monsters', run: npcsMonsters },
  { name: 'combat', run: combat },
  { name: 'multiclassage', run: multiclass },
  { name: 'wild shape + rests', run: wildshapeRest },
  { name: 'websocket sync', run: syncWs },
];

async function main(): Promise<void> {
  console.log('[test-api] booting throwaway API server…');
  const srv = await startServer();
  let exitCode = 0;
  try {
    console.log('[test-api] building fixtures…');
    const fx = await buildFixtures(srv.base);

    for (const mod of MODULES) {
      const started = Date.now();
      try {
        await mod.run(srv.base, fx, srv);
        console.log(`  ✓ ${mod.name} (${Date.now() - started} ms)`);
      } catch (err) {
        exitCode = 1;
        console.log(`  ✗ ${mod.name} — ${(err as Error).message}`);
      }
    }

    // Gate BEFORE stop() — the harness deletes the temp dir (trace) on stop.
    const cov = computeCoverage(srv.tracePath);
    console.log(`\n[test-api] raw SQL sites in routes/ + sync/: ${cov.totalSites} (must be 0)`);
    if (cov.totalSites > 0) {
      console.log('  raw .prepare( is forbidden there — use the Drizzle query builder:');
      for (const site of cov.sites) {
        console.log(`    - ${site.file}:${site.line} [${site.kind}] "${site.sql.slice(0, 70)}"`);
      }
      exitCode = 1;
    }
  } finally {
    await srv.stop();
  }

  console.log(exitCode === 0 ? '\n[test-api] ALL GREEN' : '\n[test-api] FAILURES — see above');
  process.exit(exitCode);
}

main();
