import { writeFile } from 'node:fs/promises';
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

export default defineConfig({
  plugins: [react(), versionJson()],
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
    // Production sourcemaps off: a 2.6 MB .map was shipping in dist/assets.
    // Dev sourcemaps come from the dev server and are unaffected by this flag.
    sourcemap: false,
  },
});
