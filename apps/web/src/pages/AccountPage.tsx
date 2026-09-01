import type { ChangePasswordPayload, UpdateProfilePayload } from '@table-sync/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, type Toast, ToastStack } from '../components/ui';
import { useHeaderOverride } from '../headerContext';
import { LANGUAGES, setAppLang } from '../i18n';
import {
  disablePush,
  enablePush,
  getPushSubscription,
  PushError,
  pushSecureContext,
  pushSupported,
} from '../push';
import { TUTORIAL_SEEN_KEY, TUTORIAL_TABS_DONE_KEY } from '../tutorial/TutorialHost';
import { formatSince } from '../utils';

/**
 * Mon compte — nom affiché, adresse e-mail (optionnelle pour les comptes
 * créés avant son ajout), mot de passe. L’identifiant @username est en
 * lecture seule : il sert à la connexion et ne change pas.
 */
export default function AccountPage() {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const nav = useNavigate();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Renvoi du lien de vérification d'adresse (état ci-dessous : les hooks
  // doivent rester au-dessus du garde `if (!user)`).
  const [resendingVerify, setResendingVerify] = useState(false);

  // Notifications push — état de CE navigateur. Le useEffect reste au-dessus
  // du garde `if (!user)` : les hooks doivent tourner avant tout retour anticipé.
  const [pushConfig, setPushConfig] = useState<{
    enabled: boolean;
    publicKey: string | null;
  } | null>(null);
  const [pushPermission, setPushPermission] = useState<string>('default');
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/api/push/config');
        if (alive) setPushConfig(res.data);
      } catch {
        if (alive) setPushConfig({ enabled: false, publicKey: null });
      }
      if (!pushSupported()) return;
      if (alive) setPushPermission(Notification.permission);
      const sub = await getPushSubscription();
      if (alive && sub) setPushSubscribed(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      kind === 'error' ? 6000 : 2500,
    );
  }, []);

  const onBack = useCallback(() => {
    nav('/parties');
  }, [nav]);
  useHeaderOverride(t('account.mon.compte'), onBack);

  if (!user) return null;

  const profileDirty = displayName !== user.displayName || email.trim() !== (user.email ?? '');
  const passwordsMatch = !confirmPassword || newPassword === confirmPassword;
  const passwordReady =
    !!currentPassword && newPassword.length >= 6 && !!confirmPassword && passwordsMatch;

  async function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError('');
    setSavingProfile(true);
    try {
      const body: UpdateProfilePayload = {};
      const name = displayName.trim();
      if (name !== user!.displayName) body.displayName = name;
      const mail = email.trim();
      if (mail !== (user!.email ?? '')) body.email = mail; // vide = retirer l’adresse
      await api.patch('/api/auth/me', body);
      await refreshUser();
      pushToast(t('account.profil.enregistre'));
    } catch (err: any) {
      setProfileError(err.response?.data?.error || t('account.enregistrement.impossible'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function resendVerification() {
    setResendingVerify(true);
    try {
      await api.post('/api/auth/verify-email/resend');
      pushToast(t('account.email.lien.renvoye'));
    } catch (err: any) {
      pushToast(err.response?.data?.error || t('account.email.renvoi.impossible'), 'error');
    } finally {
      setResendingVerify(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');
    setSavingPassword(true);
    try {
      const body: ChangePasswordPayload = { currentPassword, newPassword };
      await api.post('/api/auth/password', body);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      pushToast(t('account.mot.de.passe.mis.a.jour'));
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || t('account.changement.impossible'));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleEnablePush() {
    if (!pushConfig?.publicKey) return;
    setPushBusy(true);
    try {
      await enablePush(pushConfig.publicKey);
      setPushPermission(Notification.permission);
      setPushSubscribed(true);
      pushToast(t('account.notifications.activees'));
    } catch (err: any) {
      if (err instanceof PushError && err.code === 'permission') {
        setPushPermission(Notification.permission);
      } else {
        pushToast(err.response?.data?.error || t('account.notifications.impossible'), 'error');
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function handleDisablePush() {
    setPushBusy(true);
    try {
      await disablePush();
      setPushSubscribed(false);
      pushToast(t('account.notifications.desactivees'));
    } catch (err: any) {
      pushToast(err.response?.data?.error || t('account.notifications.impossible'), 'error');
    } finally {
      setPushBusy(false);
    }
  }

  async function handleTestPush() {
    setPushTesting(true);
    try {
      const res = await api.post('/api/push/test');
      if ((res.data?.sent ?? 0) > 0) pushToast(t('account.notifications.test.envoye'));
      else pushToast(t('account.notifications.test.echoue'), 'error');
    } catch (err: any) {
      pushToast(err.response?.data?.error || t('account.notifications.test.echoue'), 'error');
    } finally {
      setPushTesting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink-900 text-center">
        {t('account.mon.compte')}
      </h1>

      {/* ---------- Profil ---------- */}
      <section className="card p-5 sm:p-6" aria-labelledby="account-profil-title">
        <h2 id="account-profil-title" className="section-title mb-4">
          {t('account.profil')}
        </h2>
        <div className="flex items-center gap-4">
          <span
            className="w-14 h-14 rounded-full bg-parchment-100 border-2 border-blood-300 flex items-center justify-center font-display text-xl font-semibold text-ink-700 shrink-0 select-none"
            aria-hidden="true"
          >
            {user.displayName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-lg font-medium text-ink-900 truncate">{user.displayName}</p>
            <p className="text-sm text-ink-400 truncate">@{user.username}</p>
            <p className="text-xs text-ink-400">
              {' '}
              {t('account.membre', { since: formatSince(user.createdAt) })}
            </p>
          </div>
        </div>
        <p className="text-xs text-ink-400 mt-2 mb-5">
          {t('account.identifiant.servit.a.la', { username: user.username })}
        </p>
        <form onSubmit={submitProfile} className="space-y-4">
          <div>
            <label className="label" htmlFor="account-display-name">
              {t('account.nom.affiche')}
            </label>
            <input
              id="account-display-name"
              name="displayName"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              autoComplete="nickname"
              required
            />
            <p className="text-xs text-ink-400 mt-1">{t('account.c.est.le.nom.que.voit')}</p>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="label" htmlFor="account-email">
                {t('auth.adresse.e.mail')}
              </label>
              {user.email && user.emailVerifiedAt && !user.pendingEmail && (
                <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  ✓ {t('account.email.verifiee')}
                </span>
              )}
            </div>
            <input
              id="account-email"
              name="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('account.vous.exemple.fr')}
              autoComplete="email"
              inputMode="email"
              required
            />
            {user.pendingEmail ? (
              <div className="mt-2 rounded-lg border border-gold-300 bg-gold-100/60 px-3 py-2">
                <p className="text-xs text-ink-600">
                  {t('account.email.en.attente', { email: user.pendingEmail })}
                </p>
                <p className="text-xs text-ink-400 mt-1">{t('account.email.annuler.aide')}</p>
                <button
                  type="button"
                  className="text-xs font-medium text-blood-600 hover:underline mt-1"
                  onClick={resendVerification}
                  disabled={resendingVerify}
                >
                  {resendingVerify
                    ? t('account.email.renvoi.points')
                    : t('account.email.renvoyer.le.lien')}
                </button>
              </div>
            ) : user.email && !user.emailVerifiedAt ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-ink-400">{t('account.email.non.verifiee')}</p>
                <button
                  type="button"
                  className="text-xs font-medium text-blood-600 hover:underline shrink-0"
                  onClick={resendVerification}
                  disabled={resendingVerify}
                >
                  {resendingVerify
                    ? t('account.email.renvoi.points')
                    : t('account.email.renvoyer.le.lien')}
                </button>
              </div>
            ) : user.email ? (
              <p className="text-xs text-ink-400 mt-1">{t('account.email.non.retirable')}</p>
            ) : (
              <p className="text-xs text-ink-400 mt-1">{t('account.email.ajout.recommande')}</p>
            )}
          </div>
          {profileError && <ErrorMsg message={profileError} />}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={!profileDirty || savingProfile}
          >
            {savingProfile ? t('account.enregistrement') : t('account.enregistrer')}
          </button>
        </form>
      </section>

      {/* ---------- Langue ---------- */}
      <section className="card p-5 sm:p-6" aria-labelledby="account-lang-title">
        <h2 id="account-lang-title" className="section-title mb-4">
          {t('account.langue')}
        </h2>
        {/* biome-ignore lint/a11y/useSemanticElements: fieldset ajoute sa propre bordure/marge qui casse la rangée de pastilles compacte. */}
        <div
          className="inline-flex rounded-lg border border-ink-200 bg-parchment-100 p-1"
          role="group"
          aria-label={t('account.langue')}
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setAppLang(l.code)}
              aria-pressed={(i18n.resolvedLanguage ?? 'fr') === l.code}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                (i18n.resolvedLanguage ?? 'fr') === l.code
                  ? 'bg-ink-800 text-parchment-50 shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-400 mt-3">{t('account.langue.aide')}</p>
      </section>

      {/* ---------- Notifications push (par appareil) ---------- */}
      <section className="card p-5 sm:p-6" aria-labelledby="account-notif-title">
        <h2 id="account-notif-title" className="section-title mb-4">
          {t('account.notifications')}
        </h2>

        {!pushSecureContext() ? (
          <p className="text-sm text-ink-700">{t('account.notifications.contexte.non.securise')}</p>
        ) : !pushSupported() ? (
          <p className="text-sm text-ink-700">{t('account.notifications.non.supporte')}</p>
        ) : pushConfig && !pushConfig.enabled ? (
          <p className="text-sm text-ink-700">{t('account.notifications.desactivees.serveur')}</p>
        ) : pushPermission === 'denied' ? (
          <p className="text-sm text-ink-700">{t('account.notifications.permission.refusee')}</p>
        ) : pushSubscribed ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-700">{t('account.notifications.aide.actives')}</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestPush}
                disabled={pushTesting}
              >
                {pushTesting
                  ? t('account.notifications.test.encours')
                  : t('account.notifications.test')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleDisablePush}
                disabled={pushBusy}
              >
                {t('account.notifications.desactiver')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-700">{t('account.notifications.aide')}</p>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={handleEnablePush}
              disabled={pushBusy || !pushConfig}
            >
              {t('account.notifications.activer')}
            </button>
          </div>
        )}

        <p className="text-xs text-ink-400 mt-4">{t('account.notifications.appareil.note')}</p>
      </section>

      {/* ---------- Tutoriel — rejeu de la visite guidée (par navigateur) ---------- */}
      <section className="card p-5 sm:p-6" aria-labelledby="account-tutorial-title">
        <h2 id="account-tutorial-title" className="section-title mb-4">
          {t('account.tutoriel')}
        </h2>
        <p className="text-sm text-ink-700 mb-4">{t('account.tutoriel.aide')}</p>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.removeItem(TUTORIAL_SEEN_KEY);
              localStorage.removeItem(TUTORIAL_TABS_DONE_KEY);
            } catch {
              /* localStorage bloqué — le bouton reste sans effet visible */
            }
            pushToast(t('account.tutoriel.toast'));
          }}
          className="btn-secondary"
        >
          {t('account.tutoriel.bouton')}
        </button>
      </section>

      {/* ---------- Mot de passe ---------- */}
      <section className="card p-5 sm:p-6" aria-labelledby="account-password-title">
        <h2 id="account-password-title" className="section-title mb-4">
          {t('account.mot.de.passe')}
        </h2>
        <form onSubmit={submitPassword} className="space-y-4">
          <div>
            <label className="label" htmlFor="account-password-current">
              {t('account.mot.de.passe.actuel')}
            </label>
            <input
              id="account-password-current"
              name="currentPassword"
              type="password"
              className="input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="account-password-new">
              {t('auth.nouveau.mot.de.passe.min')}
            </label>
            <input
              id="account-password-new"
              name="newPassword"
              type="password"
              className="input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="account-password-confirm">
              {t('account.confirmer.le.nouveau.mot.de.passe')}
            </label>
            <input
              id="account-password-confirm"
              name="confirmPassword"
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            {!passwordsMatch && (
              <p className="text-xs text-red-600 mt-1">
                {t('account.les.deux.nouveaux.mots.de.passe')}
              </p>
            )}
          </div>
          {passwordError && <ErrorMsg message={passwordError} />}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={!passwordReady || savingPassword}
          >
            {savingPassword ? t('account.changement') : t('account.changer.le.mot.de.passe')}
          </button>
        </form>
      </section>

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
