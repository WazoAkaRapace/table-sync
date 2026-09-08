import { readdir, readFile, writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Version du build : le SHA du commit (CI) ou « dev » en local. Injectée
 * dans le bundle (__APP_VERSION__) ET dans dist/version.json — le client
 * compare les deux pour proposer le rechargement quand le serveur sert un
 * build plus récent que celui qu'il exécute (banner de mise à jour).
 */
const APP_VERSION = process.env.APP_VERSION || 'dev';

/** Écrit <outDir>/version.json en fin de build (le cwd est apps/web,
 *  aussi bien en local que dans le Dockerfile). */
function versionJson(): Plugin {
  return {
    name: 'table-sync:version-json',
    async closeBundle() {
      await writeFile('dist/version.json', `${JSON.stringify({ version: APP_VERSION })}\n`);
    },
  };
}

/**
 * Précache de coquille du service worker : liste le contenu de dist/ et
 * injecte le manifeste (version + URLs) en tête de dist/sw.js — sous la clé
 * `self.__PRECACHE_MANIFEST__`, que public/sw.js lit avec un repli « dev ».
 * Chaque déploiement change les octets du SW → réinstallation → précache du
 * nouveau jeu dans un cache versionné (purge à l'activation). Les /api, /ws
 * et version.json n'y figurent jamais : le SW ne les intercepte pas.
 * closeBundle court après la copie de public/ : on réécrit la copie dist,
 * la source public/sw.js reste le manifeste vide de dev.
 */
function precacheSw(): Plugin {
  return {
    name: 'table-sync:precache-sw',
    apply: 'build',
    async closeBundle() {
      const [dist, assets] = await Promise.all([
        readdir('dist'),
        readdir('dist/assets').catch(() => [] as string[]),
      ]);
      const rootAssets = dist
        .filter((f) => /\.(png|svg)$/.test(f) || f === 'manifest.json')
        .sort()
        .map((f) => `/${f}`);
      const hashed = assets
        .filter((f) => /\.(js|css|woff2?|png|svg|jpe?g|webp|gif)$/.test(f))
        .sort()
        .map((f) => `/assets/${f}`);
      const manifest = { version: APP_VERSION, urls: ['/', ...rootAssets, ...hashed] };
      const swPath = 'dist/sw.js';
      let sw = await readFile(swPath, 'utf8');
      const line = `self.__PRECACHE_MANIFEST__ = ${JSON.stringify(manifest)};\n`;
      sw = /self\.__PRECACHE_MANIFEST__ = .*;\n/.test(sw)
        ? sw.replace(/self\.__PRECACHE_MANIFEST__ = .*;\n/, line)
        : line + sw;
      await writeFile(swPath, sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), versionJson(), precacheSw()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.DND_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.DND_API_TARGET || 'http://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Cible large pour les vieilles tablettes : le défaut Vite 8
    // (« baseline-widely-available » ≈ Chrome 107 / Safari 16) produirait un
    // bundle qu'un WebView plus ancien ne peut même pas parser.
    target: 'es2020',
    // Production sourcemaps off: a 2.6 MB .map was shipping in dist/assets.
    // Dev sourcemaps come from the dev server and are unaffected by this flag.
    sourcemap: false,
  },
});
