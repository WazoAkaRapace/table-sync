# Emails transactionnels (réinitialisation de mot de passe, vérification d'adresse)

Infrastructure d'envoi d'e-mails transactionnels, **provider-agnostique par contrat**
(`apps/api/src/email/types.ts`) : Mailjet est l'adapter n°1 (`providers/mailjet.ts`,
API Send v3.1 via `fetch` natif — zéro dépendance), un futur SMTP/Resend/SendGrid =
un fichier de plus dans `providers/` + sa sélection dans `config.ts`. Déclencheurs :
le lien de réinitialisation de mot de passe et la vérification d'adresse e-mail.

Comme pour le push, **tout-ou-rien** : `MAILJET_API_KEY` + `MAILJET_API_SECRET` +
`EMAIL_FROM_ADDRESS` absents = fonctionnalité éteinte proprement (`POST /api/auth/forgot-password`
répond 503 avec un message clair, l'envoi no-op, rien ne crashe). L'adresse
`EMAIL_FROM_ADDRESS` doit être **vérifiée chez Mailjet** (expéditeur ou domaine).

## Architecture

```
Navigateur ──POST /api/auth/forgot-password──▶ API ──sha256──▶ password_reset_tokens
   ▲                                             │
   │                                             └──fire-and-forget──▶ providers/mailjet.ts ──▶ Mailjet ──▶ boîte du joueur
   └────────── lien /reinitialiser-mot-de-passe?token=BRUT ◀────────────┘
```

- **Table `password_reset_tokens`** (migration 0016) : `token_hash` unique = SHA-256
  hexadécimal du jeton — **le jeton brut ne vit que dans le lien e-mail**, jamais en
  base. `locale` figée au moment de la demande (même principe que
  `push_subscriptions.locale`) localise sujet/corps sans colonne `users.locale`.
- **Jeton** : 32 octets aléatoires en base64url (256 bits), TTL **60 min**, usage
  unique (`used_at`), un seul jeton actif par utilisateur (les non-consommés sont
  supprimés à chaque nouvelle demande).
- **Anti-énumération** : `forgot-password` répond TOUJOURS `200 {ok:true}`, que
  l'adresse corresponde à un compte ou non. Anti-bombardement : cooldown silencieux
  d'une demande par utilisateur et par minute (la réponse reste 200 identique).
- **Auto-login au reset** : `reset-password` vérifie le jeton (hash + non expiré +
  non consommé), change le hash bcrypt et renvoie `{token, user}` comme login —
  l'utilisateur a prouvé la maîtrise de l'adresse e-mail du compte. **Un reset
  réussi vaut vérification** : le clic sur le lien e-mail prouve la boîte,
  `email_verified_at` est renseigné au passage.
- **Hygiène** : changement d'email (direct ou appliqué) et changement de mot de
  passe suppriment les jetons en attente concernés de l'utilisateur.
- **Lien absolu** : base = `APP_URL` si configurée, sinon l'en-tête `Origin` de la
  requête (correct en dev via le proxy Vite :5173 comme derrière nginx — le web et
  l'API partagent l'origine publique). Helper partagé : `email/links.ts`
  `appLinkBase(req)`.
- **Templates** (`templates/reset-password.ts`, `templates/verify-email.ts`) : fr/en,
  texte + HTML inline-CSS minimal dans l'univers parchemin/encre/sang (les webmails
  retirent classes et `<style>`).

## Vérification d'adresse e-mail

Toute adresse liée à un compte part **non vérifiée** (`users.email_verified_at`
NULL) et reçoit un lien de vérification (TTL **24 h**, mêmes règles de stockage :
SHA-256 seulement, usage unique, un seul actif, `locale` figée, cooldown de renvoi
d'une minute — table `email_verification_tokens`, migration 0017).

- **Inscription** : lien envoyé immédiatement (fire-and-forget). E-mails
  désactivés sur le serveur → no-op silencieux, l'inscription réussit toujours ;
  l'utilisateur relancera depuis Mon compte.
- **Changement d'adresse** (`PATCH /api/auth/me`) :
  - adresse actuelle **non vérifiée** (ou absente) : la nouvelle **remplace
    directement** et repart non vérifiée — rien à protéger ;
  - adresse actuelle **vérifiée** : elle **reste active** tant que la nouvelle
    n'a pas prouvé sa boîte — la nouvelle est posée dans `users.pending_email`
    (unique) et reçoit SON lien (« elle deviendra la nouvelle adresse du compte »).
    Au clic (`POST /api/auth/verify-email`) : `email = pending_email`,
    `email_verified_at = now`, `pending_email = NULL`, jetons reset purgés. Si
    l'adresse a été claimée par un autre compte entre-temps : **409**, l'ancienne
    adresse reste active, le lien est consommé.
- **Consommation publique** : le clic peut venir d'un appareil déconnecté — le
  jeton est la preuve, pas la session (`POST /api/auth/verify-email` est en
  allowlist). Renvoi authentifié : `POST /api/auth/verify-email/resend`
  (cooldown silencieux 1/min ; 503 si e-mails désactivés ; 400 si rien à vérifier).
- **UI** : « Mon compte » montre l'état (chip « Vérifiée », note « non vérifiée »
  + bouton Renvoyer, bandeau doré pour un changement en attente) ; la page
  publique `/verifier-email?token=…` consomme le lien (succès/erreur, rafraîchit
  la session locale SANS toucher à /me si personne n'est connecté — l'intercepteur
  401 du client API redirigerait vers /login).
- **Le mot de passe oublié reste ouvert aux adresses non vérifiées** : le clic
  sur le lien de reset prouve la boîte et vérifie l'adresse au passage —
  refuser le reset à une adresse non vérifiée enfermerait les comptes paresseux.

## Mise en route (MD / hébergeur)

1. Créer un compte Mailjet, récupérer la **clé API + clé secrète**
   (Account Settings → API keys).
2. Vérifier l'**adresse expéditrice** (ou le domaine) chez Mailjet — sinon les
   envois sont rejetés.
3. Renseigner `.env` (ou l'environ du conteneur API — les deux compose passent
   les variables) :

   ```
   MAILJET_API_KEY=…
   MAILJET_API_SECRET=…
   EMAIL_FROM_ADDRESS=no-reply@votre-domaine.fr
   EMAIL_FROM_NAME=Table Sync
   # APP_URL=https://table-sync.example.fr   # optionnel — défaut = en-tête Origin
   ```

4. Redémarrer l'API — le boot log `📧 Emails transactionnels: activé (mailjet)`
   confirme la prise en compte (`📭 … désactivés (MAILJET absent)` sinon).

Les joueurs utilisent le lien « Mot de passe oublié ? » de la page de connexion ;
le formulaire demande l'adresse e-mail du compte, l'e-mail reçu contient un bouton
(ou l'URL en clair) vers `/reinitialiser-mot-de-passe?token=…`.

## Ajouter un déclencheur (la recette)

```ts
import { sendEmail } from '../email/send.ts';
import { buildMonEmail } from '../email/templates/mon-email.ts';

// dans une route — fire-and-forget, jamais await :
void sendEmail({
  to: user.email,
  toName: user.displayName,
  ...buildMonEmail(détails, locale),
});
```

Règles :
- **fire-and-forget** côté routes métier (jamais awaité sur le chemin critique) ;
- un échec d'envoi ne fait **jamais** échouer la requête appelante (retourne
  `false`, logge un warning) ;
- sujet/texte/html dans un template de `templates/` (fr/en), jamais en ligne
  dans la route ;
- aucun type provider-spécifique ne fuit hors de `providers/`.

## API

| Route | Auth | Réponse |
|---|---|---|
| `POST /api/auth/forgot-password` `{email, locale?}` | publique | toujours `200 {ok:true}` ; `503` si emails désactivés ; `400` si e-mail invalide |
| `POST /api/auth/reset-password` `{token, newPassword}` | publique | `200 {token, user}` (auto-login) ; `400` « lien invalide ou expiré » (jeton inconnu/expiré/consommé ou mot de passe < 6 caractères) |
| `POST /api/auth/verify-email` `{token}` | publique | `200 {user}` (vérifiée — applique le pending le cas échéant) ; `400` lien invalide/expiré ; `409` adresse en attente claimée entre-temps |
| `POST /api/auth/verify-email/resend` | JWT | `200 {ok:true}` (cooldown silencieux 1/min) ; `400` rien à vérifier ; `503` emails désactivés |

Les routes publiques sont dans le **bucket serré** du rate limiter (5 échecs/min —
`TIGHT_ROUTES`, sauf le resend authentifié) et dans la allowlist publique du guard
JWT global (`server.ts`).

## Tests

- **`npm run test-api`**, module `emails transactionnels` (`scripts/api-tests/mod-email.ts`) :
  un faux Mailjet HTTP (`mock-mailjet.ts`) capte les requêtes — l'API est bootée
  avec `MAILJET_API_URL` pointant dessus (pas de danse TLS : le client est à nous).
  Couvre reset ET vérification : réponse générique + zéro envoi sur adresse
  inconnue, hash stocké ≠ jeton brut, sujets fr/en selon `locale` (les lookups du
  module filtrent par sujet : chaque inscription envoie désormais un e-mail de
  vérification), liens contenant le jeton brut, cooldowns, 503 sans config,
  reset heureux (nouveau mot de passe → login, ancien → 401, vaut vérification),
  rejets de réutilisation/expiration, auto-login valide, purges des jetons,
  changement direct (non vérifiée) vs en attente (vérifiée), clash d'adresse à
  la consommation, renvoi puis plus-rien-à-vérifier, résilience provider 500,
  second boot sans config (`withoutEmail`).
- **`npm run test:e2e`**, `e2e/password-reset.spec.ts` + `e2e/verify-email.spec.ts` :
  la stack e2e boote sans config Mailjet → états réels « désactivés » /
  « non vérifiée » ; les parcours complets (forgot → confirmation, reset →
  auto-login, verify → succès, chips/bandeau de Mon compte) sont couverts via
  stubs `page.route` — pour Mon compte, session seedée réelle + `/me` stubbé
  (un faux jeton ferait 401-redirecter les composants globaux).
- Manuel : clés réelles dans `.env`, `npm run dev`, parcourir
  `/mot-de-passe-oublie` et cliquer le lien reçu.

## Pièges connus

- **JWT stateless 7 jours** : un reset ne RÉVOQUE pas les sessions existantes
  (pas de denylist) — les tokens déjà émis vivent jusqu'à expiration. Documenté,
  assumé.
- **E-mails non délivrés** : vérifier l'expéditeur vérifié Mailjet, les quotas du
  plan gratuit (200/jour), et les logs Mailjet ; l'API ne logge que
  `[email] envoi échoué (mailjet): …`.
- **Cooldown vs UI** : le bouton « Envoyer le lien » de la page redescend à 60 s
  côté client, aligné sur le cooldown serveur — mais le serveur reste la limite
  réelle (silencieuse).
- **Contenu HTML minimal volontairement** : pas de classes ni `<style>` (les
  webmails les retirent) ; tout style est inline, la palette est dupliquée en dur
  (un e-mail n'emporte pas le CSS du thème).
- **`APP_URL` en prod multi-origines** : si l'API reçoit des requêtes de plusieurs
  origines web (rare), figer `APP_URL` pour des liens cohérents.
