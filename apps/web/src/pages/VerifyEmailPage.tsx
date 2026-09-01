import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth';
import { ErrorMsg } from '../components/ui';

// Atterrissage du lien de vérification (?token=…). Peut venir d'un appareil
// déconnecté : la route API est publique, le jeton est la preuve. Si une
// session existe, elle est rafraîchie pour refléter l'état vérifié.
export default function VerifyEmailPage() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) {
      setState('error');
      setError(t('verify.lien.absent'));
      return;
    }
    api
      .post('/api/auth/verify-email', { token })
      .then(async () => {
        setState('ok');
        // Session présente sur CET appareil : Mon compte doit montrer l'état
        // vérifié sans reconnexion. Sans session, on ne touche PAS /me —
        // l'intercepteur 401 du client API redirigerait vers /login et
        // masquerait l'écran de succès.
        if (user) await refreshUser().catch(() => {});
      })
      .catch((err: any) => {
        setState('error');
        setError(err.response?.data?.error || t('verify.invalide'));
      });
  }, [t, user, refreshUser]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="text-center mb-6">
          <img src="/icon-seal.svg" alt="" aria-hidden="true" className="w-20 h-20 mx-auto mb-3" />
          <h1 className="font-display text-2xl font-bold text-blood-700">{t('verify.titre')}</h1>
        </div>

        {state === 'pending' && (
          <p className="text-sm text-ink-400 text-center">{t('verify.points')}</p>
        )}

        {state === 'ok' && (
          <div className="space-y-4">
            <p className="text-sm text-ink-400 text-center">{t('verify.succes')}</p>
            <Link to="/parties" className="btn-primary w-full block text-center">
              {t('verify.continuer')}
            </Link>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-4">
            <ErrorMsg message={error} />
            <p className="text-sm text-ink-400 text-center">{t('verify.aide')}</p>
            <Link to="/login" className="btn-secondary w-full block text-center">
              {t('forgot.retour.connexion')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
