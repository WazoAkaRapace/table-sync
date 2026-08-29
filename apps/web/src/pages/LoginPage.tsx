import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/ui';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      nav('/parties');
    } catch (err: any) {
      setError(err.response?.data?.error || t('auth.connexion.echouee'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="text-center mb-6">
          <img src="/icon-seal.svg" alt="" aria-hidden="true" className="w-20 h-20 mx-auto mb-3" />
          <h1 className="font-display text-2xl font-bold text-blood-700">Table Sync</h1>
          <p className="text-ink-400 text-sm mt-1">
            {t('login.le.compagnon.de.campagne.partage.pour')}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="login-username">
              {t('auth.nom.d.utilisateur')}
            </label>
            <input
              id="login-username"
              name="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="login-password">
              {t('login.mot.de.passe')}
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <ErrorMsg message={error} />}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? t('auth.connexion.points') : t('auth.se.connecter')}
          </button>
        </form>
        <p className="text-center text-sm text-ink-400 mt-4">
          {t('auth.pas.de.compte')}{' '}
          <Link to="/register" className="text-blood-600 font-medium hover:underline">
            {t('login.creer.un.compte')}
          </Link>
        </p>
      </div>
    </div>
  );
}
