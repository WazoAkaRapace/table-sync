/**
 * Hachage de jetons — partagé entre les routes d'auth et les jetons de
 * rafraîchissement. Jamais de jeton brut en base : SHA-256 hexadécimal
 * uniquement (le brut ne vit que chez le client ou dans le lien e-mail).
 */
import { createHash } from 'node:crypto';

export function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
