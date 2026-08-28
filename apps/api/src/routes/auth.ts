/**
 * Auth routes: register, login, me, logout, profile & password updates.
 * Passwords hashed with bcrypt. JWT issued on login/register.
 *
 * L'email est stocké normalisé (trim + minuscules) : l'unicité est
 * effectivement insensible à la casse sans COLLATE NOCASE, donc sans
 * rebuild de la table users (qui perdrait le NOCASE de `username`).
 */

import type { ChangePasswordPayload, UpdateProfilePayload, User } from '@table-sync/shared';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { cols } from '../db/projections.ts';
import { users } from '../db/schema.ts';

const BCRYPT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthBody {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function emailError(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (!EMAIL_RE.test(email)) return 'adresse e-mail invalide';
  if (email.length > 254) return 'adresse e-mail trop longue';
  return null;
}

function sanitizeUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email ?? null,
    createdAt: row.created_at,
  };
}

export async function authRoutes(app: FastifyInstance) {
  // ---------- Register ----------
  app.post('/register', async (req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply) => {
    const { username, password, displayName, email } = req.body || {};
    if (!username || !password || !displayName || !email) {
      return reply
        .code(400)
        .send({ error: 'nom d’utilisateur, mot de passe, nom affiché et adresse e-mail requis' });
    }
    if (username.length < 3) {
      return reply
        .code(400)
        .send({ error: 'le nom d’utilisateur doit faire au moins 3 caractères' });
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: 'le mot de passe doit faire au moins 6 caractères' });
    }
    const badEmail = emailError(email);
    if (badEmail) return reply.code(400).send({ error: badEmail });

    const drizzle = getDrizzle();
    const existing = drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .get();
    if (existing) return reply.code(409).send({ error: 'ce nom d’utilisateur est déjà pris' });

    const emailClash = drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .get();
    if (emailClash) {
      return reply.code(409).send({ error: 'cette adresse e-mail est déjà utilisée' });
    }

    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    // users.username is COLLATE NOCASE at the column level (schema.sql) — the
    // uniqueness check above inherits it, no query-text collation needed.
    const row = drizzle
      .insert(users)
      .values({ username, passwordHash: hash, displayName, email: normalizeEmail(email) })
      .returning(cols(users))
      .get() as any;
    const user = sanitizeUser(row);
    const token = app.jwt.sign({ sub: user.id, username: user.username });
    return reply.code(201).send({ token, user });
  });

  // ---------- Login ----------
  app.post('/login', async (req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return reply.code(400).send({ error: 'nom d’utilisateur et mot de passe requis' });
    }

    const drizzle = getDrizzle();
    const row = drizzle
      .select(cols(users))
      .from(users)
      .where(eq(users.username, username))
      .get() as any;
    if (!row) return reply.code(401).send({ error: 'identifiants invalides' });

    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return reply.code(401).send({ error: 'identifiants invalides' });

    const user = sanitizeUser(row);
    const token = app.jwt.sign({ sub: user.id, username: user.username });
    return reply.send({ token, user });
  });

  // ---------- Me (current user) ----------
  app.get(
    '/me',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req as any).user?.sub;
      if (!userId) return reply.code(401).send({ error: 'non autorisé' });
      const row = getDrizzle()
        .select(cols(users))
        .from(users)
        .where(eq(users.id, userId))
        .get() as any;
      if (!row) return reply.code(404).send({ error: 'utilisateur introuvable' });
      return reply.send({ user: sanitizeUser(row) });
    },
  );

  // ---------- Update my profile (display name, email) ----------
  app.patch(
    '/me',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Body: UpdateProfilePayload }>, reply: FastifyReply) => {
      const userId = (req as any).user?.sub;
      if (!userId) return reply.code(401).send({ error: 'non autorisé' });
      const body = req.body || {};

      const drizzle = getDrizzle();
      const row = drizzle.select(cols(users)).from(users).where(eq(users.id, userId)).get() as any;
      if (!row) return reply.code(404).send({ error: 'utilisateur introuvable' });

      const values: { displayName?: string; email?: string | null } = {};
      if (body.displayName !== undefined) {
        const displayName = String(body.displayName).trim();
        if (!displayName || displayName.length > 40) {
          return reply
            .code(400)
            .send({ error: 'le nom affiché doit contenir entre 1 et 40 caractères' });
        }
        values.displayName = displayName;
      }
      if (body.email !== undefined) {
        // '' ou null efface l'email (optionnel pour les anciens comptes)
        const raw = body.email === null ? '' : String(body.email).trim();
        if (!raw) {
          values.email = null;
        } else {
          const badEmail = emailError(raw);
          if (badEmail) return reply.code(400).send({ error: badEmail });
          const email = normalizeEmail(raw);
          if (email !== row.email) {
            const clash = drizzle
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, email))
              .get();
            if (clash) {
              return reply.code(409).send({ error: 'cette adresse e-mail est déjà utilisée' });
            }
          }
          values.email = email;
        }
      }

      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: 'aucun champ à mettre à jour' });
      }

      const updated = drizzle
        .update(users)
        .set(values)
        .where(eq(users.id, userId))
        .returning(cols(users))
        .get() as any;
      return reply.send({ user: sanitizeUser(updated) });
    },
  );

  // ---------- Change my password ----------
  app.post(
    '/password',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Body: ChangePasswordPayload }>, reply: FastifyReply) => {
      const userId = (req as any).user?.sub;
      if (!userId) return reply.code(401).send({ error: 'non autorisé' });
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return reply
          .code(400)
          .send({ error: 'mot de passe actuel et nouveau mot de passe requis' });
      }
      if (String(newPassword).length < 6) {
        return reply
          .code(400)
          .send({ error: 'le nouveau mot de passe doit faire au moins 6 caractères' });
      }

      const drizzle = getDrizzle();
      const row = drizzle.select(cols(users)).from(users).where(eq(users.id, userId)).get() as any;
      if (!row) return reply.code(404).send({ error: 'utilisateur introuvable' });

      if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
        return reply.code(400).send({ error: 'mot de passe actuel incorrect' });
      }

      const hash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
      drizzle.update(users).set({ passwordHash: hash }).where(eq(users.id, userId)).run();
      return reply.send({ user: sanitizeUser(row) });
    },
  );

  // ---------- Logout ----------
  app.post('/logout', async (_req, reply) => {
    // Stateless JWT: client just discards the token. Return 204.
    return reply.code(204).send();
  });
}
