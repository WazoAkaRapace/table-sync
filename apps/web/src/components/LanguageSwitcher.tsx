// Sélecteur de langue d'entête — bascule i18next + l'en-tête Accept-Language
// des requêtes API (payloads mono-locale) et <html lang>.
import { useTranslation } from 'react-i18next';
import { LANGUAGES, setAppLang } from '../i18n';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'fr';
  return (
    <label className="flex items-center gap-1 text-xs text-ink-600">
      <span className="sr-only">{t('app.language')}</span>
      <select
        className="rounded border border-ink-300 bg-parchment px-1.5 py-0.5 text-xs"
        value={current}
        onChange={(e) => {
          const code = e.target.value;
          if (code !== current) setAppLang(code as (typeof LANGUAGES)[number]['code']);
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
