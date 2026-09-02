/// <reference types="vite/client" />

/** Version du build injectée par vite.config.ts (define) : SHA du commit
 *  en CI, « dev » en local — comparée à /version.json pour les mises à jour. */
declare const __APP_VERSION__: string;
