/**
 * Fixtures d'authentification E2E : chaque test démarre déjà connecté.
 *
 * La session (localStorage « dnd-inv-token » + « dnd-inv-user », cf.
 * apps/web/src/auth.tsx) est injectée par addInitScript AVANT le chargement
 * de l'app — pas de dance de login dans l'UI pour les specs métier.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright/test';
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

async function injectSession(page: Page, session: SeedSession) {
  await page.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('dnd-inv-token', token);
      localStorage.setItem('dnd-inv-user', JSON.stringify(user));
      // Pas de visite guidée au premier chargement de la fiche.
      localStorage.setItem('dnd-inv-tour-seen', '1');
    },
    { token: session.token, user: session.user },
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
