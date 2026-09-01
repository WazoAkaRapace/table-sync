/**
 * Base absolue des liens posés dans les e-mails (reset, vérification…).
 * APP_URL configuré > en-tête Origin de la requête — correct dans les deux
 * topologies : dev (le proxy Vite :5173 laisse Origin = origine web) et prod
 * (nginx sert web et api sous la même origine publique).
 */
import type { FastifyRequest } from 'fastify';
import { emailConfig } from './config.ts';

export function appLinkBase(req: FastifyRequest): string {
  const configured = emailConfig()?.appUrl;
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof req.headers.origin === 'string' && req.headers.origin) {
    return req.headers.origin.replace(/\/+$/, '');
  }
  return '';
}
