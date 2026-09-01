/**
 * Base absolue des liens posés dans les e-mails (reset, vérification…).
 * APP_URL configuré > en-tête Origin de la requête — correct dans les deux
 * topologies : dev (le proxy Vite :5173 laisse Origin = origine web) et prod
 * (nginx sert web et api sous la même origine publique).
 */
import type { FastifyRequest } from 'fastify';
import { emailConfig } from './config.ts';
import type { TemplateAssets } from './templates/layout.ts';

export function appLinkBase(req: FastifyRequest): string {
  const configured = emailConfig()?.appUrl;
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof req.headers.origin === 'string' && req.headers.origin) {
    return req.headers.origin.replace(/\/+$/, '');
  }
  return '';
}

/**
 * Assets absolus des templates (sceau de l'en-tête). Le PNG est servi par le
 * web à la même origine que le lien d'action — SVG proscrit : Gmail/Outlook
 * ne rendent pas le SVG en e-mail. Origine inconnue (appel API direct sans
 * Origin ni APP_URL) → en-tête typographique seul.
 */
export function appAssets(req: FastifyRequest): TemplateAssets {
  const base = appLinkBase(req);
  return base ? { logoUrl: `${base}/icon-192.png` } : {};
}
