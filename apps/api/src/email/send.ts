/**
 * Envoi d'un e-mail transactionnel — point d'entrée unique des déclencheurs
 * (présent et futurs). Recette pour en ajouter un :
 *
 *   void sendEmail({
 *     to: user.email,
 *     ...buildMonEmail(détails, locale),  // template dans templates/
 *   });
 *
 * Règles :
 * - fire-and-forget côté routes métier (jamais awaité sur le chemin critique) ;
 * - un échec d'envoi ne fait JAMAIS échouer la requête appelante (retourne
 *   false, logge un warning) — l'utilisateur ne peut rien y faire ;
 * - sujet/texte/html sont construits par un template de templates/ (fr/en),
 *   jamais en ligne dans la route ;
 * - provider résolu une fois au premier envoi (emailConfig() figé au boot).
 */
import { emailConfig } from './config.ts';
import { createMailjetProvider } from './providers/mailjet.ts';
import type { EmailMessage, EmailProvider } from './types.ts';

let provider: EmailProvider | null | undefined;

function resolveProvider(): EmailProvider | null {
  if (provider !== undefined) return provider;
  const config = emailConfig();
  provider = config?.provider === 'mailjet' ? createMailjetProvider(config) : null;
  return provider;
}

/** @returns true si envoyé, false si désactivé ou échoué (déjà loggé). */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const p = resolveProvider();
  if (!p) return false;
  try {
    await p.send(message);
    return true;
  } catch (err) {
    console.warn(`[email] envoi échoué (${p.name}): ${(err as Error).message}`);
    return false;
  }
}
