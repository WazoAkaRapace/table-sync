/**
 * Fixtures d'authentification E2E : chaque test démarre déjà connecté.
 *
 * La session vit dans les COOKIES du contexte (régime « plus rien en
 * localStorage ») : le cookie ts_access (JWT, Path=/api, HttpOnly) posé par
 * addCookies authentifie toutes les requêtes /api du navigateur, et le cache
 * user « dnd-inv-user » (addInitScript, AVANT le chargement de l'app) dit au
 * boot qu'une session existe à restaurer. PAS de ts_refresh : les JWT seedés
 * valent 24 h, aucune spec métier ne rafraîchit — et une rotation par page
 * consommerait la ligne du seed (family kill pour les specs suivantes).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright/test';
import { test as base } from 'playwright/test';
import { API_BASE, WEB_BASE } from './env';

// ---------------------------------------------------------------------------
// Le seed écrit par global-setup.ts
// ---------------------------------------------------------------------------

export interface SeedSession {
  id: number;
  username: string;
  displayName: string;
  password: string;
  token: string;
  user: { id: number; username: string; displayName: string };
}

export interface SeedData {
  password: string;
  gm: SeedSession;
  player: SeedSession;
  partyId: number;
  partyName: string;
  inviteCode: string;
  guerrier: { id: number; name: string; combatantId: number };
  clerc: { id: number; name: string };
  /** Objet personnalisé illustré (« Lettre du duc ») porté par le guerrier. */
  lettreId: number;
  encounterId: number;
  encounterName: string;
  gobelinIds: number[];
}

const seedPath = path.resolve(process.cwd(), 'e2e', '.seed.json');
let cached: SeedData | null = null;

/** Références de la campagne seedée (e2e/.seed.json, écrit au globalSetup). */
export function seed(): SeedData {
  if (!cached) {
    try {
      cached = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedData;
    } catch {
      throw new Error(
        `E2E : ${seedPath} illisible — le globalSetup doit tourner en premier (lance « npm run test:e2e »).`,
      );
    }
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Sessions injectées + helpers de navigation
// ---------------------------------------------------------------------------

/** Cookie ts_access sur l'origine du web (le proxy Vite sert /api) : mêmes
 *  attributs que le serveur pose au login — Path=/api suffit au navigateur
 *  pour le joindre à chaque requête API, HttpOnly ne gêne pas Playwright,
 *  et un cookie ignore le port (domain nu). Pour les contextes créés à la
 *  main par les specs (sync, messages). */
export async function addSessionCookies(ctx: BrowserContext, session: SeedSession) {
  await ctx.addCookies([
    {
      name: 'ts_access',
      value: session.token,
      domain: new URL(WEB_BASE).hostname,
      path: '/api',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}

async function injectSession(page: Page, session: SeedSession) {
  await addSessionCookies(page.context(), session);
  await page.addInitScript(
    ({ user }) => {
      localStorage.setItem('dnd-inv-user', JSON.stringify(user));
      // Pas de visite guidée au premier chargement de la fiche, ni des
      // visites propres d'onglet (tutorial.spec.ts les réarme explicitement).
      localStorage.setItem('dnd-inv-tour-seen', '1');
      localStorage.setItem(
        'dnd-inv-tour-tabs',
        JSON.stringify([
          'survival',
          'stats',
          'spells',
          'skills',
          'inventory',
          'features',
          'description',
          'npcs',
          'notes',
          'messages',
        ]),
      );
    },
    { user: session.user },
  );
}

/** Fixture auto : session de la JOUEUSE (lyra) injectée dans chaque page. */
export const playerTest = base.extend({
  playerSession: [
    async ({ page }, use) => {
      await injectSession(page, seed().player);
      await use(seed().player);
    },
    { auto: true },
  ],
});

/** Fixture auto : session du MAÎTRE DU JEU (maitre) injectée dans chaque page. */
export const gmTest = base.extend({
  gmSession: [
    async ({ page }, use) => {
      await injectSession(page, seed().gm);
      await use(seed().gm);
    },
    { auto: true },
  ],
});

/** URL d'une fiche de personnage. */
export function sheetUrl(charId: number): string {
  const s = seed();
  return `${WEB_BASE}/party/${s.partyId}/character/${charId}`;
}

/** Ouvre un onglet de la fiche sur mobile : dock direct, ou hub si secondaire. */
export async function openTab(page: Page, label: string) {
  const dockBtn = page.getByRole('button', { name: label, exact: true }).first();
  if (
    await dockBtn.waitFor({ state: 'visible', timeout: 4000 }).then(
      () => true,
      () => false,
    )
  ) {
    await dockBtn.click();
    return;
  }
  // Onglet secondaire : le hub central du dock s'appelle « Autres onglets »,
  // ou « Combat en cours » quand un combat est actif pour ce personnage.
  const hub = page
    .getByRole('button', { name: 'Autres onglets' })
    .or(page.getByRole('button', { name: 'Combat en cours' }))
    .first();
  await hub.click();
  await page.getByRole('button', { name: label, exact: true }).last().click();
}

/** GET authentifié d'un personnage (pour poller la persistance d'un PATCH). */
export async function fetchCharacter(charId: number): Promise<{
  currentHp: number;
  backstory: string | null;
  alliesOrganizations: string | null;
}> {
  const res = await fetch(`${API_BASE}/api/characters/${charId}`, {
    headers: { authorization: `Bearer ${seed().player.token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`E2E : GET personnage ${charId} → ${res.status}`);
  const body = await res.json();
  return body.character;
}
