// Types i18next — options de typage du projet.
//
// i18next 27 active `strictInterpolationChecks` par défaut : `t()` exige alors
// les options pour toute chaîne contenant une variable, ce qui rend le `TFunction`
// non assignable aux signatures locales `(key: string, opts?) => string` des pages
// (aucune ressource typée ici — les clés sont de simples `string`). On garde le
// typage de la v26, comportement documenté par le guide de migration v27.
import 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    strictInterpolationChecks: false;
  }
}
