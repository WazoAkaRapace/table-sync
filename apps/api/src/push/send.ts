/**
 * Envoi Web Push à tous les appareils d'un utilisateur — point d'entrée unique
 * des déclencheurs (présent et futurs). Recette pour en ajouter un :
 *
 *   void sendPushToUser(userId, {
 *     kind: 'turn',
 *     title: { fr: 'À toi de jouer !', en: 'Your turn!' },
 *     body: { fr: `Tour de ${name}`, en: `${name}'s turn` },
 *     url: `/party/${partyId}/combat?enc=${encId}`,
 *     tag: `turn:${encId}`,        // remplace la notification précédente
 *   }, { ttl: 0, urgency: 'high' });  // ttl 0 : livrer maintenant ou jeter
 *
 * Règles :
 * - fire-and-forget côté routes métier (jamais awaité sur le chemin critique) ;
 * - 404/410 = abonnement mort côté push service → ligne supprimée ;
 * - titre/corps acceptent `{ fr, en }`, résolus par la langue de l'abonnement
 *   (le service worker affiche les chaînes reçues, il ne localise rien).
 */

import { eq, sql } from 'drizzle-orm';
import webpush, { type WebPushError } from 'web-push';
import { getDrizzle } from '../db/drizzle.ts';
import { pushSubscriptions } from '../db/schema.ts';
import { pushVapidConfig } from './config.ts';

/** Texte localisable : chaîne unique ou paire fr/en. */
export type LocalizedText = string | { fr: string; en: string };

export interface PushPayload {
  /** Nature de la notification ('test', 'turn', …) — informatie, pas branchée. */
  kind: string;
  title: LocalizedText;
  body: LocalizedText;
  /** Lien profond ouvert au clic (chemin interne, ex. /parties). */
  url: string;
  /** Regroupe les notifications d'un même sujet (la nouvelle remplace l'ancienne). */
  tag?: string;
}

export interface PushSendOptions {
  /** Secondes de rétention côté push service. 0 = livrer maintenant ou jeter. */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

export interface PushSendResult {
  sent: number;
  /** Abonnements morts (404/410) nettoyés au passage. */
  removed: number;
  /** Erreurs par appareil — remontées au bouton de test uniquement. */
  errors: string[];
}

function resolveLocalized(text: LocalizedText, locale: string): string {
  if (typeof text === 'string') return text;
  return locale === 'en' ? text.en : text.fr;
}

export async function sendPushToUser(
  userId: number,
  payload: PushPayload,
  options: PushSendOptions = {},
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, removed: 0, errors: [] };
  const config = pushVapidConfig();
  if (!config) return result;

  const drizzle = getDrizzle();
  const subs = drizzle
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .all();

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({
            kind: payload.kind,
            title: resolveLocalized(payload.title, sub.locale),
            body: resolveLocalized(payload.body, sub.locale),
            url: payload.url,
            ...(payload.tag ? { tag: payload.tag } : {}),
          }),
          {
            vapidDetails: config,
            TTL: String(options.ttl ?? 0),
            urgency: options.urgency ?? 'normal',
          },
        );
        result.sent += 1;
        drizzle
          .update(pushSubscriptions)
          .set({ lastUsedAt: sql`datetime('now')` })
          .where(eq(pushSubscriptions.id, sub.id))
          .run();
      } catch (err) {
        const statusCode = (err as WebPushError).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          drizzle.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
          result.removed += 1;
        } else {
          result.errors.push(`${sub.endpoint}: ${(err as Error).message}`);
        }
      }
    }),
  );
  return result;
}
