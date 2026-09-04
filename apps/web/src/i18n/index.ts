// Cadre i18n de l'app — i18next + react-i18next.
//
// Langues : liste LANGUAGES (ajouter une entrée = ajouter un fichier
// locales/<code>.json ci-dessous). Le défaut est 'fr' SANS détection
// navigateur : l'app est française par offre et les suites e2e tournent sous
// une locale système en-US — basculer automatiquement les casserait.
// L'utilisateur choisit explicitement via le sélecteur d'en-tête.
//
// Les payloads de l'API sont mono-locale : ce module alimente l'en-tête
// Accept-Language (voir api.ts) et l'API localise name/description/etc. —
// jamais les deux langues dans un même payload.
//
// La locale FR (langue par offre) est liée statiquement — chemin critique du
// premier rendu, zéro requête supplémentaire. La locale EN (~110 KB) est un
// chunk dynamique : chargé avant le premier rendu si la préférence enregistrée
// est 'en', puis à la volée au basculement (initI18n/setAppLang).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr.json';

export const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
] as const;

export type AppLangCode = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'dnd-inv-lang';

export function appLang(): AppLangCode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
}

async function loadLocale(code: AppLangCode): Promise<Record<string, unknown>> {
  if (code === 'en') return (await import('./locales/en.json')).default;
  return fr;
}

export async function initI18n(): Promise<void> {
  const lang = appLang();
  const resources: Record<string, { translation: Record<string, unknown> }> = {
    fr: { translation: fr },
  };
  if (lang === 'en') {
    resources.en = { translation: await loadLocale('en') };
  }
  await i18next.use(initReactI18next).init({
    resources,
    lng: lang,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false }, // React échappe déjà
  });
}

export function setAppLang(lang: AppLangCode): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* stockage indisponible — la préférence ne survivra pas au rechargement */
  }
  document.documentElement.lang = lang;
  void (async () => {
    if (!i18next.hasResourceBundle(lang, 'translation')) {
      i18next.addResourceBundle(lang, 'translation', await loadLocale(lang));
    }
    await i18next.changeLanguage(lang);
  })();
}

/** Locale BCP-47 pour Intl (dates, nombres) selon la langue active. */
export function appLocale(): string {
  return appLang() === 'en' ? 'en-US' : 'fr-FR';
}

// La langue du document suit la préférence persistée DÈS le chargement (et pas
// seulement au moment de setAppLang) : un utilisateur EN qui recharge garde
// <html lang="en"> pour les lecteurs d'écran et l'orthographe native.
document.documentElement.lang = appLang();

export default i18next;
