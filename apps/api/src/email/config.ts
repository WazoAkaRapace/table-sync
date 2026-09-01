/**
 * Emails transactionnels — configuration provider-agnostique. Provider actuel :
 * Mailjet (API Send v3.1). MAILJET_API_KEY, MAILJET_API_SECRET et
 * EMAIL_FROM_ADDRESS sont requis ensemble (tout-ou-rien, comme VAPID) ; vars
 * absentes = fonctionnalité éteinte proprement : forgot-password répond 503,
 * l'envoi no-op, rien ne crashe. L'adresse expéditrice doit être vérifiée côté
 * Mailjet. Voir docs/transactional-emails.md.
 */

export type EmailProviderKind = 'mailjet';

export interface EmailConfig {
  provider: EmailProviderKind;
  apiKey: string;
  apiSecret: string;
  /** Surcharge pour les tests (mock local) ; défaut = API publique Mailjet. */
  apiUrl: string;
  fromAddress: string;
  fromName: string | null;
  /** Origine publique du frontend pour les liens absolus ; NULL = en-tête Origin. */
  appUrl: string | null;
}

const PROVIDER = (process.env.EMAIL_PROVIDER || 'mailjet') as EmailProviderKind;
const API_KEY = process.env.MAILJET_API_KEY || '';
const API_SECRET = process.env.MAILJET_API_SECRET || '';
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || '';
const FROM_NAME = process.env.EMAIL_FROM_NAME || '';

export const emailEnabled =
  PROVIDER === 'mailjet' && API_KEY !== '' && API_SECRET !== '' && FROM_ADDRESS !== '';

// Configuration partielle = erreur d'installation visible au boot.
if (!emailEnabled && (API_KEY || API_SECRET || FROM_ADDRESS)) {
  console.warn(
    '[email] configuration partielle — MAILJET_API_KEY, MAILJET_API_SECRET et EMAIL_FROM_ADDRESS sont requis ensemble ; emails désactivés',
  );
}

export function emailConfig(): EmailConfig | null {
  if (!emailEnabled) return null;
  return {
    provider: 'mailjet',
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    apiUrl: process.env.MAILJET_API_URL || 'https://api.mailjet.com/v3.1',
    fromAddress: FROM_ADDRESS,
    fromName: FROM_NAME || null,
    appUrl: process.env.APP_URL || null,
  };
}
