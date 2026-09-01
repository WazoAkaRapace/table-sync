/**
 * Auth routes: register, login, me, logout, profile & password updates.
 * Passwords hashed with bcrypt. JWT issued on login/register.
 *
 * L'email est stocké normalisé (trim + minuscules) : l'unicité est
 * effectivement insensible à la casse sans COLLATE NOCASE, donc sans
 * rebuild de la table users (qui perdrait le NOCASE de `username`).
 */

import { createHash, randomBytes } from 'node:crypto';
import type {
  ChangePasswordPayload,
  ForgotPasswordPayload,
  ResetPasswordPayload,
  UpdateProfilePayload,
  User,
  VerifyEmailPayload,
} from '@table-sync/shared';
import bcrypt from 'bcryptjs';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDrizzle } from '../db/drizzle.ts';
import { getDb } from '../db/index.ts';
import { cols } from '../db/projections.ts';
import { emailVerificationTokens, passwordResetTokens, users } from '../db/schema.ts';
import { emailEnabled } from '../email/config.ts';
import { appLinkBase } from '../email/links.ts';
import { sendEmail } from '../email/send.ts';
import { buildResetPasswordEmail } from '../email/templates/reset-password.ts';
import { buildVerifyEmail } from '../email/templates/verify-email.ts';
import { langFromReq } from './lang.ts';
import { apiMsg } from './messages.ts';

const BCRYPT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Durée de validité d'un lien de réinitialisation. */
const RESET_TTL_MINUTES = 60;
/** Anti-bombardement : une demande par utilisateur et par fenêtre (silencieux). */
const RESET_COOLDOWN_SECONDS = 60;
/** Un lien de vérification vit plus longtemps : l'enjeu est moindre qu'un reset. */
const VERIFY_TTL_HOURS = 24;
const VERIFY_COOLDOWN_SECONDS = 60;

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

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
    emailVerifiedAt: row.email_verified_at ?? null,
    pendingEmail: row.pending_email ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Crée un jeton de vérification pour `email` et envoie le lien (fire-and-
 * forget). Un seul jeton actif par utilisateur — les précédents non
 * consommés sont remplacés. No-op silencieux si les e-mails sont désactivés
 * sur ce serveur : l'inscription ne doit jamais échouer pour ça, l'utilisateur
 * relancera la vérification depuis Mon compte une fois la config posée.
 */
function issueEmailVerification(
  drizzle: ReturnType<typeof getDrizzle>,
  userId: number,
  displayName: string,
  email: string,
  locale: 'fr' | 'en',
  req: FastifyRequest,
  change: boolean,
): void {
  if (!emailEnabled) return;
  drizzle.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId)).run();
  const rawToken = randomBytes(32).toString('base64url');
  drizzle
    .insert(emailVerificationTokens)
    .values({
      userId,
      tokenHash: sha256Hex(rawToken),
      locale,
      expiresAt: sql`datetime('now', ${`+${VERIFY_TTL_HOURS * 60} minutes`})`,
    })
    .run();
  const link = `${appLinkBase(req)}/verifier-email?token=${rawToken}`;
  void sendEmail({
    to: email,
    toName: displayName,
    ...buildVerifyEmail(displayName, link, locale, change),
  });
}

export async function authRoutes(app: FastifyInstance) {
  // ---------- Register ----------
  app.post('/register', async (req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply) => {
    const { username, password, displayName, email } = req.body || {};
    if (!username || !password || !displayName || !email) {
      return reply.code(400).send({
        error: apiMsg(req, 'nom d’utilisateur, mot de passe, nom affiché et adresse e-mail requis'),
      });
    }
    if (username.length < 3) {
      return reply
        .code(400)
        .send({ error: apiMsg(req, 'le nom d’utilisateur doit faire au moins 3 caractères') });
    }
    if (password.length < 6) {
      return reply
        .code(400)
        .send({ error: apiMsg(req, 'le mot de passe doit faire au moins 6 caractères') });
    }
    const badEmail = emailError(email);
    if (badEmail) return reply.code(400).send({ error: badEmail });

    const drizzle = getDrizzle();
    const existing = drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .get();
    if (existing)
      return reply.code(409).send({ error: apiMsg(req, 'ce nom d’utilisateur est déjà pris') });

    const emailClash = drizzle
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .get();
    if (emailClash) {
      return reply.code(409).send({ error: apiMsg(req, 'cette adresse e-mail est déjà utilisée') });
    }

    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    // users.username is COLLATE NOCASE at the column level (schema.sql) — the
    // uniqueness check above inherits it, no query-text collation needed.
    const normalizedEmail = normalizeEmail(email);
    const row = drizzle
      .insert(users)
      .values({ username, passwordHash: hash, displayName, email: normalizedEmail })
      .returning(cols(users))
      .get() as any;
    // L'adresse part non vérifiée : lien de vérification immédiat (no-op si
    // les e-mails sont désactivés — l'inscription ne doit jamais échouer).
    issueEmailVerification(
      drizzle,
      row.id,
      row.display_name,
      normalizedEmail,
      langFromReq(req),
      req,
      false,
    );
    const user = sanitizeUser(row);
    const token = app.jwt.sign({ sub: user.id, username: user.username });
    return reply.code(201).send({ token, user });
  });

  // ---------- Login ----------
  app.post('/login', async (req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return reply
        .code(400)
        .send({ error: apiMsg(req, 'nom d’utilisateur et mot de passe requis') });
    }

    const drizzle = getDrizzle();
    const row = drizzle
      .select(cols(users))
      .from(users)
      .where(eq(users.username, username))
      .get() as any;
    if (!row) return reply.code(401).send({ error: apiMsg(req, 'identifiants invalides') });

    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return reply.code(401).send({ error: apiMsg(req, 'identifiants invalides') });

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
      if (!userId) return reply.code(401).send({ error: apiMsg(req, 'non autorisé') });
      const row = getDrizzle()
        .select(cols(users))
        .from(users)
        .where(eq(users.id, userId))
        .get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'utilisateur introuvable') });
      return reply.send({ user: sanitizeUser(row) });
    },
  );

  // ---------- Update my profile (display name, email) ----------
  app.patch(
    '/me',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Body: UpdateProfilePayload }>, reply: FastifyReply) => {
      const userId = (req as any).user?.sub;
      if (!userId) return reply.code(401).send({ error: apiMsg(req, 'non autorisé') });
      const body = req.body || {};

      const drizzle = getDrizzle();
      const row = drizzle.select(cols(users)).from(users).where(eq(users.id, userId)).get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'utilisateur introuvable') });

      const values: {
        displayName?: string;
        email?: string | null;
        emailVerifiedAt?: string | null;
        pendingEmail?: string | null;
      } = {};
      // Post-traitement une fois la ligne mise à jour : adresse à vérifier
      // (changement direct ou en attente) et purges associées.
      let verifyTarget: string | null = null;
      let emailReplaced = false; // l'adresse ACTIVE a changé (ou effacée)
      if (body.displayName !== undefined) {
        const displayName = String(body.displayName).trim();
        if (!displayName || displayName.length > 40) {
          return reply
            .code(400)
            .send({ error: apiMsg(req, 'le nom affiché doit contenir entre 1 et 40 caractères') });
        }
        values.displayName = displayName;
      }
      if (body.email !== undefined) {
        // '' ou null efface l'email (optionnel pour les anciens comptes) —
        // la vérification et tout changement en attente partent avec.
        const raw = body.email === null ? '' : String(body.email).trim();
        if (!raw) {
          values.email = null;
          values.emailVerifiedAt = null;
          values.pendingEmail = null;
          emailReplaced = true;
        } else {
          const badEmail = emailError(raw);
          if (badEmail) return reply.code(400).send({ error: badEmail });
          const email = normalizeEmail(raw);
          if (email === row.email) {
            // Même adresse (la casse se normalise) : réécriture idempotente,
            // pas de nouvel envoi ni de dé-vérification.
            values.email = email;
          } else if (email === row.pending_email) {
            // Déjà en attente pour cette adresse : réécriture idempotente.
            values.pendingEmail = email;
          } else {
            const clash = drizzle
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, email))
              .get();
            if (clash) {
              return reply
                .code(409)
                .send({ error: apiMsg(req, 'cette adresse e-mail est déjà utilisée') });
            }
            if (row.email_verified_at) {
              // Adresse actuelle VÉRIFIÉE : elle reste active tant que la
              // nouvelle n'a pas prouvé sa boîte — changement en attente.
              values.pendingEmail = email;
              verifyTarget = email;
            } else {
              // Adresse actuelle absente ou non vérifiée : rien à protéger,
              // la nouvelle remplace directement et repart de zéro.
              values.email = email;
              values.emailVerifiedAt = null;
              values.pendingEmail = null;
              verifyTarget = email;
              emailReplaced = true;
            }
          }
        }
      }

      if (Object.keys(values).length === 0) {
        return reply.code(400).send({ error: apiMsg(req, 'aucun champ à mettre à jour') });
      }

      let updated: any;
      try {
        updated = drizzle
          .update(users)
          .set(values)
          .where(eq(users.id, userId))
          .returning(cols(users))
          .get() as any;
      } catch (err) {
        // Race sur users_pending_email_unique : un autre compte vient de
        // demander la même adresse — même message que le clash d'email.
        if (String(err).includes('users_pending_email_unique')) {
          return reply
            .code(409)
            .send({ error: apiMsg(req, 'cette adresse e-mail est déjà utilisée') });
        }
        throw err;
      }
      if (emailReplaced) {
        // L'adresse active a changé/effacé : les liens de reset en attente
        // pointent vers une boîte qui n'est plus rattachée au compte.
        drizzle.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId)).run();
      }
      if (verifyTarget) {
        issueEmailVerification(
          drizzle,
          userId,
          updated.display_name,
          verifyTarget,
          langFromReq(req),
          req,
          Boolean(values.pendingEmail),
        );
      }
      return reply.send({ user: sanitizeUser(updated) });
    },
  );

  // ---------- Change my password ----------
  app.post(
    '/password',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest<{ Body: ChangePasswordPayload }>, reply: FastifyReply) => {
      const userId = (req as any).user?.sub;
      if (!userId) return reply.code(401).send({ error: apiMsg(req, 'non autorisé') });
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return reply
          .code(400)
          .send({ error: apiMsg(req, 'mot de passe actuel et nouveau mot de passe requis') });
      }
      if (String(newPassword).length < 6) {
        return reply
          .code(400)
          .send({ error: apiMsg(req, 'le nouveau mot de passe doit faire au moins 6 caractères') });
      }

      const drizzle = getDrizzle();
      const row = drizzle.select(cols(users)).from(users).where(eq(users.id, userId)).get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'utilisateur introuvable') });

      if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
        return reply.code(400).send({ error: apiMsg(req, 'mot de passe actuel incorrect') });
      }

      const hash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
      drizzle.update(users).set({ passwordHash: hash }).where(eq(users.id, userId)).run();
      // Mot de passe changé depuis la session : toute demande de reset en
      // attente est obsolète.
      drizzle.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId)).run();
      return reply.send({ user: sanitizeUser(row) });
    },
  );

  // ---------- Forgot password (public) ----------
  // Réponse TOUJOURS générique 200 {ok:true} : ne pas révéler si l'adresse
  // correspond à un compte (anti-énumération). Le mail part en fire-and-forget.
  app.post(
    '/forgot-password',
    async (req: FastifyRequest<{ Body: ForgotPasswordPayload }>, reply: FastifyReply) => {
      const { email } = req.body || {};
      if (!email) {
        return reply.code(400).send({ error: apiMsg(req, 'adresse e-mail requise') });
      }
      const badEmail = emailError(String(email));
      if (badEmail) return reply.code(400).send({ error: badEmail });
      if (!emailEnabled) {
        return reply
          .code(503)
          .send({ error: apiMsg(req, 'les e-mails sont désactivés sur ce serveur') });
      }

      const requested = req.body?.locale;
      const locale: 'fr' | 'en' =
        requested === 'en' || requested === 'fr' ? requested : langFromReq(req);

      const drizzle = getDrizzle();
      const row = drizzle
        .select(cols(users))
        .from(users)
        .where(eq(users.email, normalizeEmail(String(email))))
        .get() as any;

      if (row?.email) {
        // Cooldown : une demande par utilisateur et par minute — la réponse
        // reste 200 identique, seul l'envoi est silencieusement sauté.
        const recent = drizzle
          .select({ id: passwordResetTokens.id })
          .from(passwordResetTokens)
          .where(
            and(
              eq(passwordResetTokens.userId, row.id),
              isNull(passwordResetTokens.usedAt),
              gt(
                passwordResetTokens.createdAt,
                sql`datetime('now', ${`-${RESET_COOLDOWN_SECONDS} seconds`})`,
              ),
            ),
          )
          .get();
        if (!recent) {
          // Un seul jeton actif : les précédents non consommés sont remplacés.
          drizzle.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.id)).run();
          const rawToken = randomBytes(32).toString('base64url');
          drizzle
            .insert(passwordResetTokens)
            .values({
              userId: row.id,
              tokenHash: sha256Hex(rawToken),
              locale,
              expiresAt: sql`datetime('now', ${`+${RESET_TTL_MINUTES} minutes`})`,
            })
            .run();

          // Base du lien : APP_URL configuré, sinon l'Origin de la requête
          // (correct en dev via le proxy Vite comme derrière nginx — le web
          // et l'API partagent l'origine publique).
          const link = `${appLinkBase(req)}/reinitialiser-mot-de-passe?token=${rawToken}`;
          void sendEmail({
            to: row.email,
            toName: row.display_name,
            ...buildResetPasswordEmail(row.display_name, link, locale),
          });
        }
      }
      return reply.send({ ok: true });
    },
  );

  // ---------- Reset password (public) ----------
  // Invalide/expiré/consommé/mot de passe trop court : même erreur 400 — rien
  // à révéler. Succès = AuthResponse (auto-login : l'utilisateur a prouvé la
  // maîtrise de l'adresse e-mail du compte).
  app.post(
    '/reset-password',
    async (req: FastifyRequest<{ Body: ResetPasswordPayload }>, reply: FastifyReply) => {
      const { token, newPassword } = req.body || {};
      if (!token || !newPassword) {
        return reply.code(400).send({ error: apiMsg(req, 'jeton et nouveau mot de passe requis') });
      }
      if (String(newPassword).length < 6) {
        return reply
          .code(400)
          .send({ error: apiMsg(req, 'le nouveau mot de passe doit faire au moins 6 caractères') });
      }

      const drizzle = getDrizzle();
      const resetRow = drizzle
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, sha256Hex(String(token))),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, sql`datetime('now')`),
          ),
        )
        .get() as any;
      const invalidLink = () =>
        reply.code(400).send({ error: apiMsg(req, 'lien de réinitialisation invalide ou expiré') });
      if (!resetRow) return invalidLink();

      const userRow = drizzle
        .select(cols(users))
        .from(users)
        .where(eq(users.id, resetRow.userId))
        .get() as any;
      if (!userRow) return invalidLink();

      const hash = bcrypt.hashSync(String(newPassword), BCRYPT_ROUNDS);
      // NB : getDb().transaction(fn) RETOURNE la fonction transaction — il faut
      // l'invoquer (pattern `})();`, cf. inventory.ts).
      getDb().transaction(() => {
        drizzle.update(users).set({ passwordHash: hash }).where(eq(users.id, userRow.id)).run();
        // Le clic sur le lien e-mail prouve la maîtrise de la boîte : un reset
        // réussi vaut vérification de l'adresse (si elle ne l'était pas).
        if (!userRow.email_verified_at) {
          drizzle
            .update(users)
            .set({ emailVerifiedAt: sql`datetime('now')` })
            .where(eq(users.id, userRow.id))
            .run();
          userRow.email_verified_at = 'now';
        }
        // Usage unique + hygiène : les autres demandes en attente meurent.
        drizzle
          .update(passwordResetTokens)
          .set({ usedAt: sql`datetime('now')` })
          .where(eq(passwordResetTokens.id, resetRow.id))
          .run();
        drizzle
          .delete(passwordResetTokens)
          .where(
            and(eq(passwordResetTokens.userId, userRow.id), isNull(passwordResetTokens.usedAt)),
          )
          .run();
      })();

      const user = sanitizeUser(userRow);
      const jwtToken = app.jwt.sign({ sub: user.id, username: user.username });
      return reply.send({ token: jwtToken, user });
    },
  );

  // ---------- Verify email (public) ----------
  // Atterrissage du lien de vérification. Le clic peut venir d'un appareil
  // déconnecté : pas d'auth requise — le jeton EST la preuve. Avec un
  // changement en attente, la nouvelle adresse ne prend le compte qu'ici.
  app.post(
    '/verify-email',
    async (req: FastifyRequest<{ Body: VerifyEmailPayload }>, reply: FastifyReply) => {
      const { token } = req.body || {};
      if (!token) {
        return reply.code(400).send({ error: apiMsg(req, 'jeton de vérification requis') });
      }

      const drizzle = getDrizzle();
      const tokenRow = drizzle
        .select()
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.tokenHash, sha256Hex(String(token))),
            isNull(emailVerificationTokens.usedAt),
            gt(emailVerificationTokens.expiresAt, sql`datetime('now')`),
          ),
        )
        .get() as any;
      const invalidLink = () =>
        reply.code(400).send({ error: apiMsg(req, 'lien de vérification invalide ou expiré') });
      if (!tokenRow) return invalidLink();

      const row = drizzle
        .select(cols(users))
        .from(users)
        .where(eq(users.id, tokenRow.userId))
        .get() as any;
      if (!row) return invalidLink();

      const applyChange = row.pending_email !== null;
      if (applyChange) {
        // La cible a pu être claimée par un autre compte entre la demande et
        // le clic — reverifié ici, dans la transaction, avant le remplacement.
        const clash = drizzle
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, row.pending_email))
          .get();
        if (clash) {
          // Le lien est consommé (usage unique) mais l'adresse ne peut pas
          // prendre le compte : le changement devra être redemandé.
          drizzle
            .delete(emailVerificationTokens)
            .where(eq(emailVerificationTokens.userId, row.id))
            .run();
          return reply
            .code(409)
            .send({ error: apiMsg(req, 'cette adresse e-mail est déjà utilisée') });
        }
      }

      try {
        getDb().transaction(() => {
          if (applyChange) {
            drizzle
              .update(users)
              .set({
                email: row.pending_email,
                emailVerifiedAt: sql`datetime('now')`,
                pendingEmail: null,
              })
              .where(eq(users.id, row.id))
              .run();
            // L'adresse active vient de changer : les liens de reset en
            // attente pointent vers l'ancienne boîte.
            drizzle.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.id)).run();
          } else {
            drizzle
              .update(users)
              .set({ emailVerifiedAt: sql`datetime('now')` })
              .where(eq(users.id, row.id))
              .run();
          }
          drizzle
            .update(emailVerificationTokens)
            .set({ usedAt: sql`datetime('now')` })
            .where(eq(emailVerificationTokens.id, tokenRow.id))
            .run();
          drizzle
            .delete(emailVerificationTokens)
            .where(
              and(
                eq(emailVerificationTokens.userId, row.id),
                isNull(emailVerificationTokens.usedAt),
              ),
            )
            .run();
        })();
      } catch (err) {
        if (String(err).includes('users_email_unique')) {
          return reply
            .code(409)
            .send({ error: apiMsg(req, 'cette adresse e-mail est déjà utilisée') });
        }
        throw err;
      }

      const fresh = drizzle
        .select(cols(users))
        .from(users)
        .where(eq(users.id, row.id))
        .get() as any;
      return reply.send({ user: sanitizeUser(fresh) });
    },
  );

  // ---------- Resend verification link (authenticated) ----------
  app.post(
    '/verify-email/resend',
    { onRequest: [(app as any).authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req as any).user?.sub;
      if (!userId) return reply.code(401).send({ error: apiMsg(req, 'non autorisé') });
      if (!emailEnabled) {
        return reply
          .code(503)
          .send({ error: apiMsg(req, 'les e-mails sont désactivés sur ce serveur') });
      }

      const drizzle = getDrizzle();
      const row = drizzle.select(cols(users)).from(users).where(eq(users.id, userId)).get() as any;
      if (!row) return reply.code(404).send({ error: apiMsg(req, 'utilisateur introuvable') });

      const target = row.pending_email ?? row.email;
      if (!target || (row.email_verified_at && !row.pending_email)) {
        return reply.code(400).send({ error: apiMsg(req, 'aucune adresse e-mail à vérifier') });
      }

      // Cooldown silencieux d'une minute (même convention que forgot/reset).
      const recent = drizzle
        .select({ id: emailVerificationTokens.id })
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.userId, userId),
            isNull(emailVerificationTokens.usedAt),
            gt(
              emailVerificationTokens.createdAt,
              sql`datetime('now', ${`-${VERIFY_COOLDOWN_SECONDS} seconds`})`,
            ),
          ),
        )
        .get();
      if (recent) return reply.send({ ok: true });

      issueEmailVerification(
        drizzle,
        userId,
        row.display_name,
        target,
        langFromReq(req),
        req,
        row.pending_email !== null,
      );
      return reply.send({ ok: true });
    },
  );

  // ---------- Logout ----------
  app.post('/logout', async (_req, reply) => {
    // Stateless JWT: client just discards the token. Return 204.
    return reply.code(204).send();
  });
}
