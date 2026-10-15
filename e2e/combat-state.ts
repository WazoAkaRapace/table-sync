/**
 * Aides d'état combat pour les specs E2E : requêtes API au nom du MD et
 * normalisation « le tour appartient à Kael ». Module (pas une spec) —
 * Playwright refuse qu'une spec en importe une autre.
 */
import { expect } from 'playwright/test';
import { API_BASE } from './env';
import { seed } from './fixtures';

export async function gm<T>(method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${p}`, {
    method,
    headers: {
      // Sans corps, content-type: application/json ferait rejeter la requête
      // par Fastify (FST_ERR_CTP_EMPTY_JSON_BODY).
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${seed().gm.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`E2E (MD) : ${method} ${p} → ${res.status}`);
  return (res.status === 204 ? undefined : res.json()) as T;
}

interface EncDetail {
  encounter: {
    status: string;
    turnIndex: number;
    combatants: { id: number; name: string; type: string; groupId: number | null }[];
  };
}

const encId = () => seed().encounterId;
const kaelCombatantId = () => seed().guerrier.combatantId;

export async function detail(): Promise<EncDetail> {
  return gm<EncDetail>('GET', `/api/encounters/${encId()}`);
}

/** Nom du combattant courant (vérité API pour les assertions de tour). */
export async function currentName(): Promise<string> {
  const d = await detail();
  return d.encounter.combatants[d.encounter.turnIndex]?.name ?? '';
}

/**
 * Amène le tour sur Kael : initiatives déterministes si la rencontre est
 * encore en préparation (Kael 20, groupe gobelin 5 — un PATCH règle tout le
 * groupe), démarrage, puis Tour suivant MD jusqu'à ce que Kael tienne le tour
 * (une spec précédente a pu laisser la rencontre active à n'importe quel point).
 */
export async function ensureKaelTurn(): Promise<void> {
  let d = await detail();
  if (d.encounter.status === 'setup') {
    const gob = d.encounter.combatants.find((c) => c.type === 'monster');
    if (gob) {
      await gm('PATCH', `/api/encounters/${encId()}/combatants/${gob.id}/initiative`, {
        initiative: 5,
      });
    }
    await gm('PATCH', `/api/encounters/${encId()}/combatants/${kaelCombatantId()}/initiative`, {
      initiative: 20,
    });
    await gm('POST', `/api/encounters/${encId()}/next-turn`); // setup → actif
    d = await detail();
  }
  expect(d.encounter.status).toBe('active');
  for (let i = 0; i < 6; i++) {
    const cur = d.encounter.combatants[d.encounter.turnIndex];
    if (cur?.id === kaelCombatantId()) return;
    await gm('POST', `/api/encounters/${encId()}/next-turn`);
    d = await detail();
  }
  throw new Error("E2E : le tour n'atteint pas Kael");
}
