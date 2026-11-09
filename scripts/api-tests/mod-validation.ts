/**
 * Validation TypeBox des routes en écriture (phase 3 qualité backend) :
 * pilotes auth.ts + parties.ts.
 *
 * Prouve le contrat INTANGIBLE de la conversion :
 *
 *  1. Les 400 « champ manquant / mal formé » gardent le MÊME statut et le
 *     MÊME message apiMsg FR qu'avant la conversion (les checks manuels des
 *     handlers restaient la spec ; les schémas rejettent désormais avant
 *     la route, la table de mapping validationMessage du setErrorHandler
 *     restitue le message métier exact).
 *  2. La version EN (Accept-Language) passe toujours par apiMsg.
 *  3. AUCUN message technique ajv EN (« must be object », « must have
 *     required property »…) ne fuit vers le joueur — les corps mal typés
 *     rendent le message FR de la route (asserts « schéma » : rouges avant
 *     la conversion, verts après).
 *  4. Les routes en écriture SANS corps (logout, refresh, open, resend)
 *     acceptent toujours une requête sans body — leur schéma est
 *     délibérément permissif (NoBody).
 */
import { api, eq, type Fixtures, ok, registerUser, type ServerHandle } from './harness.ts';

export async function run(base: string, fx: Fixtures, _srv: ServerHandle): Promise<void> {
  // ---------- auth : 400 i18n inchangés (avant ET après conversion) ----------
  let r = await api(base, 'POST', '/api/auth/login', { body: {} });
  eq(r.status, 400, 'login vide → 400');
  eq(r.data.error, 'nom d’utilisateur et mot de passe requis', 'login vide : message FR inchangé');

  r = await api(base, 'POST', '/api/auth/login', {
    body: {},
    headers: { 'accept-language': 'en' },
  });
  eq(r.status, 400, 'login vide (EN) → 400');
  eq(r.data.error, 'username and password required', 'login vide : apiMsg EN toujours actif');

  r = await api(base, 'POST', '/api/auth/register', { body: { username: 'x' } });
  eq(r.status, 400, 'register incomplet → 400');
  eq(
    r.data.error,
    'nom d’utilisateur, mot de passe, nom affiché et adresse e-mail requis',
    'register incomplet : message FR inchangé',
  );

  r = await api(base, 'POST', '/api/auth/forgot-password', { body: {} });
  eq(r.status, 400, 'forgot sans e-mail → 400');
  eq(r.data.error, 'adresse e-mail requise', 'forgot sans e-mail : message FR inchangé');

  r = await api(base, 'POST', '/api/auth/reset-password', { body: { token: 'x' } });
  eq(r.status, 400, 'reset incomplet → 400');
  eq(r.data.error, 'jeton et nouveau mot de passe requis', 'reset incomplet : message FR inchangé');

  r = await api(base, 'POST', '/api/auth/verify-email', { body: {} });
  eq(r.status, 400, 'verify sans jeton → 400');
  eq(r.data.error, 'jeton de vérification requis', 'verify sans jeton : message FR inchangé');

  r = await api(base, 'POST', '/api/auth/password', { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'password incomplet → 400');
  eq(
    r.data.error,
    'mot de passe actuel et nouveau mot de passe requis',
    'password incomplet : message FR inchangé',
  );

  // ---------- PATCH /me : 400 métier inchangés ----------
  r = await api(base, 'PATCH', '/api/auth/me', { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'patch me vide → 400');
  eq(r.data.error, 'aucun champ à mettre à jour', 'patch me vide : message FR inchangé');

  r = await api(base, 'PATCH', '/api/auth/me', {
    token: fx.gm.token,
    body: { tutorialTabsDone: 'nope' },
  });
  eq(r.status, 400, 'patch me tutorialTabsDone non-tableau → 400');
  eq(
    r.data.error,
    'liste d’onglets de tutoriel invalide',
    'tutorialTabsDone : message FR inchangé',
  );

  r = await api(base, 'PATCH', '/api/auth/me', {
    token: fx.gm.token,
    body: { email: { pas: 'une adresse' } },
  });
  eq(r.status, 400, 'patch me e-mail non-chaîne → 400');
  eq(r.data.error, 'adresse e-mail invalide', 'e-mail non-chaîne : message FR inchangé');

  // ---------- parties : 400 métier inchangés ----------
  r = await api(base, 'POST', '/api/parties', { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'create party sans nom → 400');
  eq(r.data.error, 'name is required', 'create party sans nom : message inchangé');

  r = await api(base, 'POST', '/api/parties/join', { token: fx.gm.token, body: {} });
  eq(r.status, 400, 'join sans code → 400');
  eq(r.data.error, 'inviteCode is required', 'join sans code : message inchangé');

  r = await api(base, 'POST', `/api/parties/${fx.partyId}/bans`, {
    token: fx.gm.token,
    body: { userId: 'abc' },
  });
  eq(r.status, 400, 'ban userId non numérique → 400');
  eq(r.data.error, 'userId is required', 'ban userId non numérique : message inchangé');

  r = await api(base, 'PATCH', `/api/parties/${fx.partyId}`, {
    token: fx.gm.token,
    body: { encumbranceMode: 'weird' },
  });
  eq(r.status, 400, 'patch party mode invalide → 400');
  eq(r.data.error, 'invalid encumbranceMode', 'patch party mode invalide : message inchangé');

  // ---------- routes en écriture sans corps :toujours acceptées ----------
  r = await api(base, 'POST', '/api/auth/logout', { token: fx.gm.token });
  eq(r.status, 204, 'logout sans body → 204');

  r = await api(base, 'POST', '/api/auth/refresh');
  eq(r.status, 400, 'refresh sans cookie ni body → 400');
  eq(
    r.data.error,
    'jeton de rafraîchissement requis',
    'refresh : preuve attendue par cookie — le message métier prime (schéma permissif)',
  );

  r = await api(base, 'POST', `/api/parties/${fx.partyId}/open`, { token: fx.gm.token });
  eq(r.status, 200, 'open sans body → 200');
  eq(r.data.ok, true, 'open sans body : {ok:true}');

  // resend : utilisateur FRAIS (adresse non vérifiée) — le module emails a
  // pu vérifier l'adresse des fixtures entre-temps, et un compte vérifié
  // répond légitimement 400 « aucune adresse e-mail à vérifier ».
  const fresh = await registerUser(base, 'valresend');
  r = await api(base, 'POST', '/api/auth/verify-email/resend', { token: fresh.token });
  eq(r.status, 200, 'resend sans body → 200 (compte non vérifié, e-mails mockés)');

  // ---------- corps mal typés : AUCUNE fuite ajv EN vers le joueur ----------
  // (asserts « schéma » : rouges avant la conversion TypeBox, verts après —
  // le mapping validationMessage du setErrorHandler restitue le message
  // métier FR, jamais « must be object » / « must be string » d'ajv.)
  r = await api(base, 'POST', '/api/auth/login', {
    body: { username: { piège: 1 }, password: 'password123' },
  });
  eq(r.status, 400, 'login username objet → 400 (schéma)');
  eq(
    JSON.stringify(Object.keys(r.data)),
    '["error"]',
    'corps 400 de validation = { error } uniquement (pas de payload ajv)',
  );
  eq(
    r.data.error,
    'nom d’utilisateur et mot de passe requis',
    'login username objet : message FR métier, zéro fuite ajv',
  );

  r = await api(base, 'POST', '/api/auth/register', {
    body: {
      username: { piège: 1 },
      password: 'password123',
      displayName: 'X',
      email: 'x@example.com',
    },
  });
  eq(r.status, 400, 'register username objet → 400 (schéma, était 201 silencieux avant)');
  eq(
    r.data.error,
    'nom d’utilisateur, mot de passe, nom affiché et adresse e-mail requis',
    'register username objet : message FR métier, zéro fuite ajv',
  );

  r = await api(base, 'POST', '/api/parties/join', {
    token: fx.gm.token,
    body: { inviteCode: { piège: 1 } },
  });
  eq(r.status, 400, 'join inviteCode objet → 400 (schéma, était 404 avant)');
  eq(
    r.data.error,
    'inviteCode is required',
    'join inviteCode objet : message métier, zéro fuite ajv',
  );

  r = await api(base, 'PATCH', '/api/auth/me', {
    token: fx.gm.token,
    body: { displayName: { piège: 1 } },
  });
  eq(r.status, 400, 'patch me displayName objet → 400 (schéma, était 200 avant)');
  eq(
    r.data.error,
    'le nom affiché doit contenir entre 1 et 40 caractères',
    'displayName objet : message FR métier, zéro fuite ajv',
  );

  ok(
    !JSON.stringify(r.data).match(/must be|required property|ajv/i),
    'aucun fragment de message technique ajv dans la réponse',
  );
}
