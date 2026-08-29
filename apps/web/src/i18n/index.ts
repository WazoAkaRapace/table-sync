// Cadre i18n de l'app — i18next + react-i18next.
//
// Langues : liste LANGUAGES (ajouter une entrée = ajouter un fichier
// locales/<code>.json + son import ci-dessous). Le défaut est 'fr' SANS
// détection navigateur : l'app est française par offre et les suites e2e
// tournent sous une locale système en-US — basculer automatiquement les
// casserait. L'utilisateur choisit explicitement via le sélecteur d'en-tête.
//
// Les payloads de l'API sont mono-locale : ce module alimente l'en-tête
// Accept-Language (voir api.ts) et l'API localise name/description/etc. —
// jamais les deux langues dans un même payload.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
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

export function setAppLang(lang: AppLangCode): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* stockage indisponible — la préférence ne survivra pas au rechargement */
  }
  document.documentElement.lang = lang;
  void i18next.changeLanguage(lang);
}

/** Locale BCP-47 pour Intl (dates, nombres) selon la langue active. */
export function appLocale(): string {
  return appLang() === 'en' ? 'en-US' : 'fr-FR';
}

// La langue du document suit la préférence persistée DÈS le chargement (et pas
// seulement au moment de setAppLang) : un utilisateur EN qui recharge garde
// <html lang="en"> pour les lecteurs d'écran et l'orthographe native.
document.documentElement.lang = appLang();

void i18next.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: appLang(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false }, // React échappe déjà
});

export default i18next;
