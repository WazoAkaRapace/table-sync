/**
 * Popup de diff au chargement — « ce qui a changé depuis ta dernière
 * visite ». Compare la dernière version VUE (localStorage ts-changelog-seen)
 * à la version du build (__APP_VERSION__) via l'embarqué __CHANGELOG__.
 *
 * Règles : jamais en dev, jamais à la première visite (stamp silencieux),
 * jamais si rien de nouveau. Paraît APRÈS le splash (~2,4 s) pour ne pas
 * l'écraser ; le stamp n'est posé qu'à la FERMETURE — un refresh accidentel
 * avant fermeture remontre le popup, c'est voulu (il n'a pas été lu).
 * « Tout voir » (lien discret) rouvre le dialog en mode full SANS stamp :
 * seule la fermeture du mode diff tamponne.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangelogDialog } from './ChangelogDialog';
import { diffEntries, SEEN_KEY, type ChangelogEntry } from '../changelog';

/** Après le splash (1,75 s plancher) + respiration. */
const SHOW_DELAY_MS = 2_400;

export function ChangelogPopup() {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<ChangelogEntry[] | null>(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    const current = __APP_VERSION__;
    if (current === 'dev') {
      // Dev : on enregistre la version pour ne pas rater le premier vrai
      // déploiement, sans jamais montrer de popup.
      return;
    }
    const seen = localStorage.getItem(SEEN_KEY);
    const entries = diffEntries(seen, current);
    if (!seen) {
      // Première visite : stamp silencieux, pas de popup.
      localStorage.setItem(SEEN_KEY, current);
      return;
    }
    if (entries.length === 0) return;
    const timer = setTimeout(() => setDiff(entries), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const closeDiff = () => {
    setDiff(null);
    localStorage.setItem(SEEN_KEY, __APP_VERSION__);
  };

  if (diff === null) {
    return showFull ? (
      <ChangelogDialog open onClose={() => setShowFull(false)} mode="full" />
    ) : null;
  }
  return (
    <>
      <ChangelogDialog open onClose={closeDiff} entries={diff} mode="diff" />
      {showFull && <ChangelogDialog open onClose={() => setShowFull(false)} mode="full" />}
      {!showFull && (
        <button
          type="button"
          onClick={() => setShowFull(true)}
          className="link text-xs text-ink-400 underline-offset-2 hover:underline"
          // posé SOUS le dialog (portal body) : discret, à côté du bouton Continuer
          style={{
            position: 'fixed',
            bottom: 'calc(1rem + env(safe-area-inset-bottom))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
          }}
        >
          {t('changelog.tout.voir')}
        </button>
      )}
    </>
  );
}
