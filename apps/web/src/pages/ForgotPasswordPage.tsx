import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../api';
import { AccentLink, AuthCard, ErrorMsg } from '../components/ui';
import { appLang } from '../i18n';

// Anti-énumération : l'API répond toujours {ok:true}, que l'adresse corresponde
// à un compte ou non — la page affiche donc le même message dans tous les cas.
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [serverOff, setServerOff] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { email, locale: appLang() });
      setCooldown(60);
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 503) {
        setServerOff(true);
      } else {
        setError(err.response?.data?.error || t('auth.connexion.echouee'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title={t('forgot.titre')} subtitle={t('forgot.description')}>
      {serverOff ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-400">{t('forgot.emails.desactives')}</p>
          <Link to="/login" className="btn-secondary w-full block text-center">
            {t('forgot.retour.connexion')}
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label" htmlFor="forgot-email">
                {t('auth.adresse.e.mail')}
              </label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            {error && <ErrorMsg message={error} />}
            <button type="submit" className="btn-primary w-full" disabled={loading || cooldown > 0}>
              {loading ? t('forgot.envoi.points') : t('forgot.envoyer.le.lien')}
            </button>
          </form>
          {cooldown > 0 && (
            <p className="text-sm text-ink-400 mt-4 text-center">
              {t('forgot.envoye')}{' '}
              <span className="text-ink-300">{t('forgot.renvoyer.dans', { s: cooldown })}</span>
            </p>
          )}
          <p className="text-center text-sm text-ink-400 mt-4">
            <AccentLink to="/login">{t('forgot.retour.connexion')}</AccentLink>
          </p>
        </>
      )}
    </AuthCard>
  );
}
