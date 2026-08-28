import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/ui';
import { useTranslation } from 'react-i18next';

export default function RegisterPage() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(username, password, displayName, email.trim());
      nav('/parties');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Inscription échouée');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="text-center mb-6">
          <img src="/icon-seal.svg" alt="" aria-hidden="true" className="w-20 h-20 mx-auto mb-3" />
          <h1 className="font-display text-2xl font-bold text-blood-700">
            {t('register.creer.un.compte')}
          </h1>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="register-display-name">
              {t('register.nom.affiche')}
            </label>
            <input
              id="register-display-name"
              name="displayName"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('register.le.md')}
              autoComplete="nickname"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="register-username">
              Nom d'utilisateur
            </label>
            <input
              id="register-username"
              name="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              minLength={3}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="register-email">
              Adresse e-mail
            </label>
            <input
              id="register-email"
              name="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('register.maitre.table.sync.fr')}
              autoComplete="email"
              inputMode="email"
              required
            />
            <p className="text-xs text-ink-400 mt-1">
              {t('register.pour.retrouver.votre.compte.si.vous')}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="register-password">
              Mot de passe (≥ 6 caractères)
            </label>
            <input
              id="register-password"
              name="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          {error && <ErrorMsg message={error} />}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Création…' : "S'inscrire"}
          </button>
        </form>
        <p className="text-center text-sm text-ink-400 mt-4">
          Déjà un compte ?{' '}
          <Link to="/login" className="text-blood-600 font-medium hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
