import type { ChangePasswordPayload, UpdateProfilePayload } from '@table-sync/shared';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { ErrorMsg, type Toast, ToastStack } from '../components/ui';
import { useHeaderOverride } from '../headerContext';
import { formatSince } from '../utils';

/**
 * Mon compte — nom affiché, adresse e-mail (optionnelle pour les comptes
 * créés avant son ajout), mot de passe. L’identifiant @username est en
 * lecture seule : il sert à la connexion et ne change pas.
 */
export default function AccountPage() {
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
  useHeaderOverride('Mon compte', onBack);

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
      pushToast('Profil enregistré');
    } catch (err: any) {
      setProfileError(err.response?.data?.error || 'Enregistrement impossible — réessayez.');
    } finally {
      setSavingProfile(false);
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
      pushToast('Mot de passe mis à jour');
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || 'Changement impossible — réessayez.');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink-900 text-center">
        Mon compte
      </h1>

      {/* ---------- Profil ---------- */}
      <section className="card p-5 sm:p-6" aria-labelledby="account-profil-title">
        <h2 id="account-profil-title" className="section-title mb-4">
          Profil
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
            <p className="text-xs text-ink-400">Membre {formatSince(user.createdAt)}</p>
          </div>
        </div>
        <p className="text-xs text-ink-400 mt-2 mb-5">
          L’identifiant @{user.username} sert à la connexion — il ne peut pas changer.
        </p>
        <form onSubmit={submitProfile} className="space-y-4">
          <div>
            <label className="label" htmlFor="account-display-name">
              Nom affiché
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
            <p className="text-xs text-ink-400 mt-1">C’est le nom que voit la table.</p>
          </div>
          <div>
            <label className="label" htmlFor="account-email">
              Adresse e-mail
            </label>
            <input
              id="account-email"
              name="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@exemple.fr"
              autoComplete="email"
              inputMode="email"
            />
            {user.email ? (
              <p className="text-xs text-ink-400 mt-1">Laissez vide pour retirer votre adresse.</p>
            ) : (
              <p className="text-xs text-ink-400 mt-1">
                Optionnelle — elle servira à retrouver votre compte si vous oubliez votre mot de
                passe.
              </p>
            )}
          </div>
          {profileError && <ErrorMsg message={profileError} />}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={!profileDirty || savingProfile}
          >
            {savingProfile ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </form>
      </section>

      {/* ---------- Mot de passe ---------- */}
      <section className="card p-5 sm:p-6" aria-labelledby="account-password-title">
        <h2 id="account-password-title" className="section-title mb-4">
          Mot de passe
        </h2>
        <form onSubmit={submitPassword} className="space-y-4">
          <div>
            <label className="label" htmlFor="account-password-current">
              Mot de passe actuel
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
              Nouveau mot de passe (≥ 6 caractères)
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
              Confirmer le nouveau mot de passe
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
                Les deux nouveaux mots de passe ne correspondent pas.
              </p>
            )}
          </div>
          {passwordError && <ErrorMsg message={passwordError} />}
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={!passwordReady || savingPassword}
          >
            {savingPassword ? 'Changement…' : 'Changer le mot de passe'}
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
