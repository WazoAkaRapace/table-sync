import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { AccentLink, AuthCard, ErrorMsg } from '../components/ui';

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
      setError(err.response?.data?.error || t('auth.inscription.echouee'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title={t('register.creer.un.compte')}>
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
            {t('auth.nom.d.utilisateur')}
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
            {t('auth.adresse.e.mail')}
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
            {t('auth.mot.de.passe.min')}
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
          {loading ? t('auth.creation.points') : t('auth.s.inscrire')}
        </button>
      </form>
      <p className="text-center text-sm text-ink-400 mt-4">
        {t('auth.deja.un.compte')} <AccentLink to="/login">{t('auth.se.connecter')}</AccentLink>
      </p>
    </AuthCard>
  );
}
