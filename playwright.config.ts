/**
 * Suite E2E navigateur (Playwright) — même contrat que npm run screenshots :
 * une stack jetable entièrement isolée (API tsx + SQLite neuf, vite dev avec
 * proxy /api + /ws), jamais les bases dev ni Docker.
 *
 * - L'API s'auto-migre et sème le catalogue AVANT d'écouter : /api/health
 *   vert dans webServer.url ⇒ catalogue prêt, le globalSetup peut seeder.
 * - Base neuve à CHAQUE lancement (contrat du globalSetup, qui suppose un
 *   état vierge) : on supprime e2e.sqlite ici, avant tout démarrage.
 * - workers: 1 — une seule stack partagée et une seule base : du parallélisme
 *   ferait courir les specs l'une contre l'autre sur l'état partagé.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'playwright/test';
import { API_BASE, E2E_API_PORT, E2E_WEB_PORT, WEB_BASE } from './e2e/env';

// Base de données neuve par lancement — data/db/ est gitignoré.
// ⚠ Nettoyage garde-fou : Playwright ré-importe ce module dans CHAQUE worker —
// n'exécuter le rmSync qu'une fois, dans le process principal, sinon un worker
// efface la base (et les illustrations seedées par globalSetup) sous les pieds
// du serveur lancé par webServer (leçon e2e 2026-08-23 : GET /image → 404).
const isMainProcess = !process.env.TEST_WORKER_INDEX;
const dbPath = path.resolve(process.cwd(), 'data', 'db', 'e2e.sqlite');
if (isMainProcess) {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
  // Illustrations d'objets : même contrat, dir jetable sous data/db/ (gitignoré).
  const imagesPath = path.resolve(process.cwd(), 'data', 'db', 'e2e-images');
  rmSync(imagesPath, { recursive: true, force: true });
}
const imagesPath = path.resolve(process.cwd(), 'data', 'db', 'e2e-images');

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Une seule stack partagée + une seule base : pas de parallélisme.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_BASE,
    // Mobile-first : même viewport 390×844 que l'outil de captures.
    viewport: { width: 390, height: 844 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'on-first-retry',
  },
  // Deux projets, une seule stack/base partagée (workers: 1, passage
  // séquentiel) : Chromium joue TOUTE la suite ; WebKit — le moteur des
  // iPad/Safari de la table, là où les bugs de rendu se cachent — rejoue le
  // sous-ensemble « @smoke » : specs LECTURE SEULE, sûres de repasser après
  // la passe Chromium (les specs qui attendent un état seedé intact — combat
  // « en attente » par ex. — ne passent qu'une fois par base). Tagger un
  // titre de test « @smoke » l'ajoute au balayage WebKit.
  projects: [{ name: 'chromium' }, { name: 'webkit', grep: /@smoke/ }],
  webServer: [
    {
      // L'API (migrations + seed du catalogue) avant listen — santé = prête.
      command: 'npx tsx apps/api/src/server.ts',
      url: `${API_BASE}/api/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        PORT: String(E2E_API_PORT),
        DATABASE_PATH: dbPath,
        ITEM_IMAGES_PATH: imagesPath,
        JWT_SECRET: 'e2e-test-secret',
        // Tout le trafic vient de 127.0.0.1 : assouplir les seaux d'erreurs
        // du rate limiter pour éviter les flakes sur les asserts 4xx.
        RATE_LIMIT_ERROR_MAX: '500',
        RATE_LIMIT_AUTH_FAIL_MAX: '100',
      },
    },
    {
      // Web — vite dev, proxy /api + /ws vers l'API ci-dessus.
      command: `npx vite --port ${E2E_WEB_PORT} --strictPort --host 127.0.0.1`,
      url: WEB_BASE,
      timeout: 90_000,
      reuseExistingServer: false,
      cwd: 'apps/web',
      env: {
        DND_API_TARGET: API_BASE,
      },
    },
  ],
});
