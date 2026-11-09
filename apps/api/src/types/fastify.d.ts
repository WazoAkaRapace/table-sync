/**
 * Typage du payload JWT réel (auth/refresh.ts / routes/auth.ts) :
 * `app.jwt.sign({ sub: user.id, username: user.username })` — sub est bien
 * le nombre (l'id users), pas la chaîne JWT standard.
 *
 * Le point d'extension est l'interface FastifyJWT de @fastify/jwt : c'est
 * ELLE qui déclare `request.user` (type par défaut `string | object |
 * Buffer`). Redéclarer `user` directement sur `interface FastifyRequest`
 * de 'fastify' produirait des déclarations conflictuelles (TS2717).
 * Avec cette augmentation, `request.user` est typé `{ sub, username? }`
 * partout (verifyAccess positionne le payload décodé, header ou cookie).
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number; username?: string };
    user: { sub: number; username?: string };
  }
}

export {};
