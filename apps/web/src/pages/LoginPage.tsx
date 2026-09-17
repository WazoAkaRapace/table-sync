import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { AccentLink, AuthCard, ErrorMsg } from '../components/ui';

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
    <AuthCard title="Table Sync" subtitle={t('login.le.compagnon.de.campagne.partage.pour')}>
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
        <p className="text-center text-sm">
          <Link
            to="/mot-de-passe-oublie"
            className="text-ink-400 hover:underline inline-flex min-h-11 items-center"
          >
            {t('login.mot.de.passe.oublie')}
          </Link>
        </p>
      </form>
      <p className="text-center text-sm text-ink-400 mt-4">
        {t('auth.pas.de.compte')}{' '}
        <AccentLink to="/register">{t('login.creer.un.compte')}</AccentLink>
      </p>
    </AuthCard>
  );
}
