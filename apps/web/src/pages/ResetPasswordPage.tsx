import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/ui';

// Atterrissage du lien e-mail : ?token=… — succès = auto-login (l'API renvoie
// {token, user} comme login) puis redirection vers les groupes.
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const { adoptSession } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError(t('reset.mots.de.passe.differents'));
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/api/auth/reset-password', { token, newPassword });
      adoptSession(res.data.token, res.data.user);
      nav('/parties');
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.connexion.echouee'));
    } finally {
      setLoading(false);
    }
  }

  const linkError = error !== '' && error !== t('reset.mots.de.passe.differents');

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="text-center mb-6">
          <img src="/icon-seal.svg" alt="" aria-hidden="true" className="w-20 h-20 mx-auto mb-3" />
          <h1 className="font-display text-2xl font-bold text-blood-700">{t('reset.titre')}</h1>
          <p className="text-ink-400 text-sm mt-1">{t('reset.description')}</p>
        </div>

        {token ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label" htmlFor="reset-password">
                {t('auth.mot.de.passe.min')}
              </label>
              <input
                id="reset-password"
                name="new-password"
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
              <label className="label" htmlFor="reset-confirm">
                {t('reset.confirmer')}
              </label>
              <input
                id="reset-confirm"
                name="confirm-password"
                type="password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            {error && <ErrorMsg message={error} />}
            {linkError && (
              <p className="text-sm text-ink-400 text-center">
                <Link
                  to="/mot-de-passe-oublie"
                  className="text-blood-600 font-medium hover:underline"
                >
                  {t('reset.redemander.un.lien')}
                </Link>
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? t('reset.points') : t('reset.bouton')}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-400">{t('reset.lien.absent')}</p>
            <Link to="/mot-de-passe-oublie" className="btn-primary w-full block text-center">
              {t('forgot.envoyer.le.lien')}
            </Link>
          </div>
        )}

        <p className="text-center text-sm text-ink-400 mt-4">
          <Link to="/login" className="text-blood-600 font-medium hover:underline">
            {t('forgot.retour.connexion')}
          </Link>
        </p>
      </div>
    </div>
  );
}
