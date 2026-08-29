// Négociation de langue des payloads : une seule locale par requête.
// ?lang= prime, puis l'en-tête Accept-Language (première préférence reconnue),
// sinon 'fr' — la langue de stockage et celle des tests e2e/API.
import type { FastifyRequest } from 'fastify';

export type AppLang = 'fr' | 'en';

export function langFromReq(req: FastifyRequest): AppLang {
  const query = req.query as { lang?: string } | undefined;
  if (query?.lang === 'en' || query?.lang === 'fr') return query.lang;
  const header = req.headers['accept-language'];
  if (typeof header === 'string') {
    const first = header.split(',')[0]?.trim().toLowerCase() ?? '';
    if (first.startsWith('en')) return 'en';
    if (first.startsWith('fr')) return 'fr';
  }
  return 'fr';
}

/** Choisit la valeur de la langue demandée avec repli sur l'autre langue. */
export function pickLocalized(lang: AppLang, en: unknown, fr: unknown): any {
  const a = lang === 'en' ? en : fr;
  const b = lang === 'en' ? fr : en;
  return a ?? b ?? null;
}
