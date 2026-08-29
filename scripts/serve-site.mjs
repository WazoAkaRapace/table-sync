// Sert le site marketing (site/) en local pour vérification.
// Assemble d'abord site/assets/ depuis docs/ (logo + captures) — la seule
// source de vérité des images reste docs/, le déploiement GitHub Pages fait
// la même copie. Usage : npm run site [-- --port 4188] · --assemble-only
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const siteDir = join(root, 'site');
const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const port = portFlag !== -1 ? Number.parseInt(args[portFlag + 1], 10) : 4188;
const assembleOnly = args.includes('--assemble-only');

function assemble() {
  mkdirSync(join(siteDir, 'assets', 'screenshots'), { recursive: true });
  cpSync(join(root, 'docs', 'logo.png'), join(siteDir, 'assets', 'logo.png'));
  cpSync(join(root, 'docs', 'screenshots'), join(siteDir, 'assets', 'screenshots'), {
    recursive: true,
  });
  // Captures EN (optionnelles tant que --lang en n'a pas été régénéré)
  const shotsEn = join(root, 'docs', 'screenshots-en');
  if (existsSync(shotsEn)) {
    cpSync(shotsEn, join(siteDir, 'assets', 'screenshots-en'), { recursive: true });
  }
  console.log('📦 assets assemblés → site/assets/ (logo + captures depuis docs/)');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

assemble();
if (assembleOnly) process.exit(0);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path === '') path = '/index.html';
    const file = join(siteDir, path);
    if (!file.startsWith(siteDir)) throw new Error('chemin refusé');
    const body = await readFile(file);
    // no-cache : sans validateurs, Chromium garde la première version en cache
    // heuristique et on photographie un rendu périmé après une édition.
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`🌐 Site marketing : http://127.0.0.1:${port}/`);
});
