/**
 * Module `emails transactionnels` de npm run test-api.
 *
 * Réinitialisation de mot de passe : réponse générique anti-énumération,
 * jeton stocké en SHA-256 (jamais brut), localisation fr/en figée à la
 * demande, cooldown d'une minute, lien basé sur Origin, consommation unique
 * + expiration, auto-login, purges au changement d'e-mail/mot de passe,
 * résilience à un échec provider, boot sans config.
 *
 * Vérification d'adresse : lien envoyé à l'inscription, consommation
 * publique (usage unique, expiration), changement DIRECT tant que l'adresse
 * n'est pas vérifiée, changement EN ATTENTE (pending_email) une fois qu'elle
 * l'est — la nouvelle ne prend le compte qu'au clic sur SON lien —, clash
 * d'adresse à la consommation, renvoi avec cooldown, reset qui vaut
 * vérification.
 */
import { createHash } from 'node:crypto';
import { api, eq, type Fixtures, ok, type ServerHandle, startServer } from './harness.ts';

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Tous les messages envoyés à une adresse (tous sujets confondus). */
function emailsTo(mj: ServerHandle['mailjet'], email: string): any[] {
  return mj.requests
    .filter((r) => r.body?.Messages?.[0]?.To?.[0]?.Email === email)
    .map((r) => r.body.Messages[0]);
}

/** Messages de RESET envoyés à une adresse (sujet fr ou en). */
function resetEmails(mj: ServerHandle['mailjet'], email: string): any[] {
  return emailsTo(mj, email).filter((m) =>
    /réinitialisation|reset your password/i.test(String(m.Subject)),
  );
}

/** Messages de VÉRIFICATION envoyés à une adresse. */
function verifyEmails(mj: ServerHandle['mailjet'], email: string): any[] {
  return emailsTo(mj, email).filter((m) =>
    /vérifie ton adresse|verify your email/i.test(String(m.Subject)),
  );
}

function tokenFrom(msg: any): string {
  return String(msg.HTMLPart).match(/token=([A-Za-z0-9_-]+)/)?.[1] ?? '';
}

async function register(base: string, username: string, email?: string) {
  const res = await api(base, 'POST', '/api/auth/register', {
    body: {
      username,
      password: 'password123',
      displayName: username.toUpperCase(),
      email: email ?? `${username}@example.com`,
    },
  });
  eq(res.status, 201, `register ${username}`);
  return res.data;
}

export async function run(base: string, fx: Fixtures, srv: ServerHandle): Promise<void> {
  const mj = srv.mailjet;
  const userRow = (username: string) =>
    srv.query(
      'SELECT email, email_verified_at, pending_email FROM users WHERE username = ?',
      username,
    );

  // ---------- validation ----------
  let res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'pas-un-email' },
  });
  eq(res.status, 400, 'forgot: e-mail invalide → 400');
  res = await api(base, 'POST', '/api/auth/forgot-password', { body: {} });
  eq(res.status, 400, 'forgot: e-mail manquant → 400');

  // ---------- anti-énumération ----------
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'inconnu@example.com' },
  });
  eq(res.status, 200, 'forgot: adresse inconnue → 200 générique');
  ok(res.data?.ok === true, 'forgot: réponse {ok:true}');
  await new Promise((r) => setTimeout(r, 300));
  eq(emailsTo(mj, 'inconnu@example.com').length, 0, 'forgot: adresse inconnue → aucun envoi');

  // ---------- inscription → lien de vérification ----------
  const reg1 = await register(base, 'verifreg');
  ok(reg1.user.emailVerifiedAt === null, 'register: adresse non vérifiée à la création');
  await waitFor(() => verifyEmails(mj, 'verifreg@example.com').length >= 1);
  const vmsg = verifyEmails(mj, 'verifreg@example.com').at(-1);
  eq(vmsg.To[0].Email, 'verifreg@example.com', 'verify: destinataire');
  eq(vmsg.From.Email, 'no-reply@test-table-sync.fr', 'verify: expéditeur configuré');
  ok(String(vmsg.Subject).includes('vérifie ton adresse'), 'verify: sujet FR');
  ok(String(vmsg.TextPart).includes('24 heures'), 'verify: TTL annoncé');
  ok(String(vmsg.HTMLPart).includes('/verifier-email?token='), 'verify: lien vers /verifier-email');
  const regToken = tokenFrom(vmsg);
  ok(regToken.length >= 40, `verify: jeton brut ≥ 40 caractères (${regToken.length})`);
  const vrow = srv.query(
    'SELECT user_id, token_hash, locale, expires_at FROM email_verification_tokens ORDER BY id DESC LIMIT 1',
  );
  eq(
    vrow.token_hash,
    createHash('sha256').update(regToken).digest('hex'),
    'verify: SHA-256 stocké, jamais le brut',
  );
  eq(vrow.user_id, reg1.user.id, 'verify: jeton lié au compte');
  eq(vrow.locale, 'fr', 'verify: locale figée');
  const vttlH = (Date.parse(`${vrow.expires_at.replace(' ', 'T')}Z`) - Date.now()) / 3_600_000;
  ok(vttlH > 23 && vttlH < 25, `verify: TTL ≈ 24 h (${vttlH.toFixed(1)})`);

  // ---------- alice : reset fr, lien basé Origin, hash en base ----------
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'alice@example.com', locale: 'fr' },
    headers: { Origin: 'http://table.example.com' },
  });
  eq(res.status, 200, 'forgot alice → 200');
  await waitFor(() => resetEmails(mj, 'alice@example.com').length >= 1);
  const msg = resetEmails(mj, 'alice@example.com').at(-1);
  ok(msg, 'mailjet: message de reset envoyé à alice');
  eq(msg.To[0].Email, 'alice@example.com', 'mailjet: destinataire');
  eq(msg.From.Email, 'no-reply@test-table-sync.fr', 'mailjet: expéditeur configuré');
  ok(String(msg.Subject).includes('réinitialisation'), 'mailjet: sujet FR');
  eq(
    mj.requests[mj.requests.length - 1].authorization,
    `Basic ${Buffer.from('test-mailjet-key:test-mailjet-secret').toString('base64')}`,
    'mailjet: Basic auth clé:secret',
  );
  const link = String(msg.HTMLPart).match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? '';
  ok(
    link.startsWith('http://table.example.com/reinitialiser-mot-de-passe?token='),
    `mailjet: lien absolu = Origin + chemin (${link.slice(0, 60)}…)`,
  );
  const rawToken = tokenFrom(msg);
  ok(rawToken.length >= 40, `jeton brut ≥ 40 caractères (${rawToken.length})`);

  const row = srv.query(
    'SELECT user_id, token_hash, locale, used_at, expires_at FROM password_reset_tokens ORDER BY id DESC LIMIT 1',
  );
  ok(row, 'DB: ligne de jeton créée');
  eq(
    row.token_hash,
    createHash('sha256').update(rawToken).digest('hex'),
    'DB: sha256 du jeton (le brut n’est jamais stocké)',
  );
  eq(row.user_id, fx.gm.userId, 'DB: jeton lié à alice');
  eq(row.locale, 'fr', 'DB: locale fr figée');
  ok(!row.used_at, 'DB: jeton non consommé');
  const ttlMin = (Date.parse(`${row.expires_at.replace(' ', 'T')}Z`) - Date.now()) / 60000;
  ok(ttlMin > 58 && ttlMin < 62, `DB: TTL ≈ 60 min (${ttlMin.toFixed(1)})`);

  // ---------- cooldown silencieux d'une minute ----------
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'alice@example.com' },
  });
  eq(res.status, 200, 'cooldown: re-demande immédiate → 200 identique');
  await new Promise((r) => setTimeout(r, 300));
  eq(
    resetEmails(mj, 'alice@example.com').length,
    1,
    'cooldown: pas de second e-mail dans la minute',
  );
  eq(
    srv.query('SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id = ?', fx.gm.userId).c,
    1,
    'cooldown: le jeton actif est conservé (pas remplacé)',
  );

  // ---------- bob : locale en ----------
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'bob@example.com', locale: 'en' },
  });
  eq(res.status, 200, 'forgot bob → 200');
  await waitFor(() => resetEmails(mj, 'bob@example.com').length >= 1);
  const bobMsg = resetEmails(mj, 'bob@example.com').at(-1);
  ok(/reset your password/i.test(String(bobMsg.Subject)), 'mailjet: sujet EN');
  ok(String(bobMsg.TextPart).includes('expires in 60 minutes'), 'mailjet: corps EN');

  // ---------- reset heureux (alice) : auto-login ----------
  res = await api(base, 'POST', '/api/auth/reset-password', {
    body: { token: rawToken, newPassword: 'nouveaumotdepasse1' },
  });
  eq(res.status, 200, 'reset: 200');
  ok(res.data?.token && res.data?.user?.id === fx.gm.userId, 'reset: auto-login {token, user}');
  const me = await api(base, 'GET', '/api/auth/me', { token: res.data.token });
  eq(me.status, 200, 'reset: le JWT renvoyé fonctionne sur /me');
  const loginNew = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'alice', password: 'nouveaumotdepasse1' },
  });
  eq(loginNew.status, 200, 'login: nouveau mot de passe accepté');
  const loginOld = await api(base, 'POST', '/api/auth/login', {
    body: { username: 'alice', password: 'password123' },
  });
  eq(loginOld.status, 401, 'login: ancien mot de passe refusé');
  ok(
    srv.query('SELECT used_at FROM password_reset_tokens WHERE user_id = ?', fx.gm.userId).used_at,
    'DB: jeton marqué consommé',
  );

  // réutilisation du jeton consommé
  res = await api(base, 'POST', '/api/auth/reset-password', {
    body: { token: rawToken, newPassword: 'autremotdepasse1' },
  });
  eq(res.status, 400, 'reset: réutilisation → 400');
  // jeton inconnu / mot de passe trop court
  res = await api(base, 'POST', '/api/auth/reset-password', {
    body: { token: 'nimporte-quoi', newPassword: 'autremotdepasse1' },
  });
  eq(res.status, 400, 'reset: jeton inconnu → 400');
  res = await api(base, 'POST', '/api/auth/reset-password', {
    body: { token: rawToken, newPassword: 'abc' },
  });
  eq(res.status, 400, 'reset: mot de passe trop court → 400');

  // ---------- expiration (carol, jeton backdaté) ----------
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'carol@example.com', locale: 'fr' },
  });
  eq(res.status, 200, 'forgot carol → 200');
  await waitFor(() => resetEmails(mj, 'carol@example.com').length >= 1);
  const carolToken = tokenFrom(resetEmails(mj, 'carol@example.com').at(-1));
  srv.exec(
    "UPDATE password_reset_tokens SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?",
    createHash('sha256').update(carolToken).digest('hex'),
  );
  res = await api(base, 'POST', '/api/auth/reset-password', {
    body: { token: carolToken, newPassword: 'motdepasseexpire1' },
  });
  eq(res.status, 400, 'reset: jeton expiré → 400');

  // ---------- vérification : consommation heureuse ----------
  res = await api(base, 'POST', '/api/auth/verify-email', { body: { token: regToken } });
  eq(res.status, 200, 'verify: 200');
  ok(res.data?.user?.emailVerifiedAt, 'verify: user renvoyé avec adresse vérifiée');
  ok(userRow('verifreg').email_verified_at, 'verify: DB email_verified_at renseigné');
  const meReg = await api(base, 'GET', '/api/auth/me', { token: reg1.token });
  eq(meReg.data?.user?.emailVerifiedAt !== null, true, 'verify: /me reflète l’état vérifié');
  res = await api(base, 'POST', '/api/auth/verify-email', { body: { token: regToken } });
  eq(res.status, 400, 'verify: réutilisation → 400');
  res = await api(base, 'POST', '/api/auth/verify-email', { body: {} });
  eq(res.status, 400, 'verify: jeton manquant → 400');

  // ---------- vérification : jeton expiré ----------
  await register(base, 'verifexp');
  await waitFor(() => verifyEmails(mj, 'verifexp@example.com').length >= 1);
  const expToken = tokenFrom(verifyEmails(mj, 'verifexp@example.com').at(-1));
  srv.exec(
    "UPDATE email_verification_tokens SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?",
    createHash('sha256').update(expToken).digest('hex'),
  );
  res = await api(base, 'POST', '/api/auth/verify-email', { body: { token: expToken } });
  eq(res.status, 400, 'verify: jeton expiré → 400');

  // ---------- un reset réussi vaut vérification ----------
  await register(base, 'verifreset');
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'verifreset@example.com' },
  });
  eq(res.status, 200, 'forgot verifreset → 200');
  await waitFor(() => resetEmails(mj, 'verifreset@example.com').length >= 1);
  const resetTok = tokenFrom(resetEmails(mj, 'verifreset@example.com').at(-1));
  res = await api(base, 'POST', '/api/auth/reset-password', {
    body: { token: resetTok, newPassword: 'nouveaumotdepasse2' },
  });
  eq(res.status, 200, 'reset verifreset: 200');
  ok(res.data?.user?.emailVerifiedAt, 'reset: le clic sur le lien e-mail vaut vérification');
  ok(userRow('verifreset').email_verified_at, 'reset: DB vérifiée');

  // ---------- changement DIRECT tant que l'adresse n'est pas vérifiée ----------
  const regDirect = await register(base, 'verifdirect');
  res = await api(base, 'PATCH', '/api/auth/me', {
    token: regDirect.token,
    body: { email: 'verifdirect-nouveau@example.com' },
  });
  eq(res.status, 200, 'PATCH /me (non vérifiée): 200');
  eq(
    res.data?.user?.email,
    'verifdirect-nouveau@example.com',
    'direct: adresse remplacée immédiatement',
  );
  ok(res.data?.user?.emailVerifiedAt === null, 'direct: toujours non vérifiée');
  ok(res.data?.user?.pendingEmail === null, 'direct: pas de pending');
  const directRow = userRow('verifdirect');
  eq(directRow.email, 'verifdirect-nouveau@example.com', 'direct: DB remplacée');
  ok(!directRow.email_verified_at && !directRow.pending_email, 'direct: DB vierge de vérification');
  await waitFor(() => verifyEmails(mj, 'verifdirect-nouveau@example.com').length >= 1);
  ok(
    String(verifyEmails(mj, 'verifdirect-nouveau@example.com').at(-1).TextPart).includes(
      'sécuriser ton compte',
    ),
    'direct: e-mail de vérification (variante compte, pas changement)',
  );

  // ---------- changement EN ATTENTE une fois l'adresse vérifiée ----------
  const regPend = await register(base, 'verifpend');
  await waitFor(() => verifyEmails(mj, 'verifpend@example.com').length >= 1);
  const pendToken1 = tokenFrom(verifyEmails(mj, 'verifpend@example.com').at(-1));
  res = await api(base, 'POST', '/api/auth/verify-email', { body: { token: pendToken1 } });
  eq(res.status, 200, 'pend: adresse initiale vérifiée');
  res = await api(base, 'PATCH', '/api/auth/me', {
    token: regPend.token,
    body: { email: 'verifpend-nouveau@example.com' },
  });
  eq(res.status, 200, 'pend: PATCH /me → 200');
  eq(res.data?.user?.email, 'verifpend@example.com', 'pend: l’ancienne adresse RESTE active');
  ok(res.data?.user?.emailVerifiedAt, 'pend: toujours vérifiée');
  eq(res.data?.user?.pendingEmail, 'verifpend-nouveau@example.com', 'pend: nouvelle en attente');
  await waitFor(() => verifyEmails(mj, 'verifpend-nouveau@example.com').length >= 1);
  const pendMsg = verifyEmails(mj, 'verifpend-nouveau@example.com').at(-1);
  ok(
    String(pendMsg.TextPart).includes('deviendra la nouvelle adresse'),
    'pend: e-mail de variante changement',
  );
  const pendToken2 = tokenFrom(pendMsg);
  res = await api(base, 'POST', '/api/auth/verify-email', { body: { token: pendToken2 } });
  eq(res.status, 200, 'pend: clic sur le lien de la nouvelle adresse');
  eq(res.data?.user?.email, 'verifpend-nouveau@example.com', 'pend: la nouvelle PREND le compte');
  ok(res.data?.user?.emailVerifiedAt, 'pend: vérifiée d’office (le lien l’a prouvée)');
  ok(res.data?.user?.pendingEmail === null, 'pend: plus de pending');
  eq(
    srv.query(
      'SELECT COUNT(*) c FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL',
      regPend.user.id,
    ).c,
    0,
    'pend: aucun jeton de vérification actif restant',
  );

  // ---------- clash : l'adresse en attente est claimée entre-temps ----------
  const regClash = await register(base, 'verifclash');
  await waitFor(() => verifyEmails(mj, 'verifclash@example.com').length >= 1);
  res = await api(base, 'POST', '/api/auth/verify-email', {
    body: { token: tokenFrom(verifyEmails(mj, 'verifclash@example.com').at(-1)) },
  });
  eq(res.status, 200, 'clash: adresse initiale vérifiée');
  res = await api(base, 'PATCH', '/api/auth/me', {
    token: regClash.token,
    body: { email: 'clashx@example.com' },
  });
  eq(res.status, 200, 'clash: changement mis en attente');
  await waitFor(() => verifyEmails(mj, 'clashx@example.com').length >= 1);
  const clashToken = tokenFrom(verifyEmails(mj, 'clashx@example.com').at(-1));
  // Un autre compte enregistre l'adresse pendant que le lien voyage.
  await register(base, 'verifclash2', 'clashx@example.com');
  res = await api(base, 'POST', '/api/auth/verify-email', { body: { token: clashToken } });
  eq(res.status, 409, 'clash: consommation → 409 (adresse prise entre-temps)');
  const clashRow = userRow('verifclash');
  eq(clashRow.email, 'verifclash@example.com', 'clash: l’ancienne adresse reste active');
  eq(clashRow.pending_email, 'clashx@example.com', 'clash: la demande en attente est conservée');
  eq(
    srv.query(
      'SELECT COUNT(*) c FROM email_verification_tokens WHERE user_id = ?',
      regClash.user.id,
    ).c,
    0,
    'clash: le lien est consommé (usage unique)',
  );

  // ---------- renvoi : cooldown puis plus rien à vérifier ----------
  const regResend = await register(base, 'verifresend');
  res = await api(base, 'POST', '/api/auth/verify-email/resend', { token: regResend.token });
  eq(res.status, 200, 'resend: 200');
  await new Promise((r) => setTimeout(r, 300));
  eq(
    verifyEmails(mj, 'verifresend@example.com').length,
    1,
    'resend: cooldown — un seul e-mail dans la minute',
  );
  res = await api(base, 'POST', '/api/auth/verify-email', {
    body: { token: tokenFrom(verifyEmails(mj, 'verifresend@example.com').at(-1)) },
  });
  eq(res.status, 200, 'resend: adresse vérifiée');
  res = await api(base, 'POST', '/api/auth/verify-email/resend', { token: regResend.token });
  eq(res.status, 400, 'resend: plus rien à vérifier → 400');

  // ---------- purges : changement d'e-mail (direct) ----------
  const purgeMail = await register(base, 'purgemail');
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'purgemail@example.com' },
  });
  eq(res.status, 200, 'forgot purgemail → 200');
  await waitFor(() => resetEmails(mj, 'purgemail@example.com').length >= 1);
  eq(
    srv.query('SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id = ?', purgeMail.user.id)
      .c,
    1,
    'purgemail: jeton reset en attente créé',
  );
  res = await api(base, 'PATCH', '/api/auth/me', {
    token: purgeMail.token,
    body: { email: 'purgemail-nouveau@example.com' },
  });
  eq(res.status, 200, 'PATCH /me: changement d’e-mail');
  eq(
    srv.query('SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id = ?', purgeMail.user.id)
      .c,
    0,
    'changement d’e-mail → jetons reset purgés',
  );

  // ---------- purges : changement de mot de passe ----------
  const purgePass = await register(base, 'purgepass');
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'purgepass@example.com' },
  });
  eq(res.status, 200, 'forgot purgepass → 200');
  await waitFor(() => resetEmails(mj, 'purgepass@example.com').length >= 1);
  res = await api(base, 'POST', '/api/auth/password', {
    token: purgePass.token,
    body: { currentPassword: 'password123', newPassword: 'changemotdepasse1' },
  });
  eq(res.status, 200, 'POST /password: changement de mot de passe');
  eq(
    srv.query('SELECT COUNT(*) c FROM password_reset_tokens WHERE user_id = ?', purgePass.user.id)
      .c,
    0,
    'changement de mot de passe → jetons purgés',
  );

  // ---------- résilience : échec provider n'échoue pas la requête ----------
  // purgepass : son jeton reset vient d'être purgé → pas de cooldown, une
  // nouvelle demande crée un jeton ET tente l'envoi — que le mock fait
  // échouer. La requête doit rester 200.
  mj.status = 500;
  mj.responseBody = '{"ErrorMessage":"boom"}';
  res = await api(base, 'POST', '/api/auth/forgot-password', {
    body: { email: 'purgepass@example.com' },
  });
  eq(res.status, 200, 'provider KO: la demande reste 200');
  await waitFor(() => resetEmails(mj, 'purgepass@example.com').length >= 2);
  eq(
    mj.status,
    500,
    'provider KO: la tentative a bien atteint le mock (échec loggé, requête intacte)',
  );
  mj.reset();

  // ---------- boot sans config Mailjet : dégradation propre ----------
  const off = await startServer({ withoutEmail: true });
  try {
    res = await api(off.base, 'POST', '/api/auth/forgot-password', {
      body: { email: 'alice@example.com' },
    });
    eq(res.status, 503, 'sans MAILJET_*: forgot → 503');
    ok(
      String(res.data?.error || '')
        .toLowerCase()
        .includes('désactiv'),
      'sans MAILJET_*: message « e-mails désactivés »',
    );
    res = await api(off.base, 'POST', '/api/auth/register', {
      body: {
        username: 'verifoff',
        password: 'password123',
        displayName: 'VerifOff',
        email: 'verifoff@example.com',
      },
    });
    eq(res.status, 201, 'sans MAILJET_*: l’inscription réussit quand même');
    res = await api(off.base, 'POST', '/api/auth/verify-email/resend', {
      token: res.data.token,
    });
    eq(res.status, 503, 'sans MAILJET_*: resend → 503');
  } finally {
    await off.stop();
  }
}
