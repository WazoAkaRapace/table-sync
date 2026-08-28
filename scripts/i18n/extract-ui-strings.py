#!/usr/bin/env python3
"""Extrait les chaînes FR d'un fichier TSX vers le catalogue i18next.

Remplace :
  - les nœuds texte JSX contenant du français  → >{t('cle')}<
  - les attributs aria-label/title/placeholder/alt FR  → ={t('cle')}
Les clés sont des slugs du texte FR (domaine préfixé par --domain) ; les
paires clé→FR sont collectées dans scripts/i18n/ui-strings-pending.json pour
traduction EN (merge manuel dans apps/web/src/i18n/locales/). Les hooks
`useTranslation` et imports sont ajoutés à la main là où tsc le signale —
tsc EST le filet de sécurité du codemod.

Usage : python3 scripts/i18n/extract-ui-strings.py apps/web/src/pages/LoginPage.tsx --domain login
"""
import json
import pathlib
import re
import sys
import unicodedata

PENDING = pathlib.Path('scripts/i18n/ui-strings-pending.json')
ACC = r'[àâçéèêëîïôùûüœÀÂÇÉÈÊËÎÏÔÙÛÜŒ]'
FR_WORDS = re.compile(
  r'\b(dans|avec|pour|les|des|une|est|sont|pas|vous|votre|votre|sur|son|ses|qui|que|quoi|donc|'
  r'ou|où|ni|car|ce|cet|cette|ces|au|aux|du|de|la|le|un|par|plus|tout|toute|tous|tres|très|'
  r'ajouter|fermer|annuler|enregistrer|supprimer|modifier|rechercher|charger|erreur|'
  r'requis|obligatoire|personnage|groupe|campagne|sorts|objet|objets|fiche|feuille)\b', re.I)

CONTRACTION = re.compile(r"[lndms]'[a-zà-ÿ]")

def is_fr(text):
  return re.search(ACC, text) or FR_WORDS.search(text) or CONTRACTION.search(text)

def slug_key(domain, text):
  t = unicodedata.normalize('NFKD', text)
  t = ''.join(c for c in t if not unicodedata.combining(c)).lower()
  t = re.sub(r"[^a-z0-9]+", ' ', t).strip()
  words = t.split()[:6]
  key = '.'.join(words)[:60]
  return f'{domain}.{key}'

def main():
  args = [a for a in sys.argv[1:] if not a.startswith('--')]
  domain = 'app'
  for a in sys.argv[1:]:
    if a.startswith('--domain='):
      domain = a.split('=', 1)[1]
  pending = json.loads(PENDING.read_text()) if PENDING.exists() else {}

  for path in args:
    s = pathlib.Path(path).read_text()
    pairs = {}

    def repl_jsx(m):
      text = m.group(1)
      # texte JSX seulement : aucun code (parenthèses, =, ;) et le < suivant
      # ouvre bien une balise — sinon ce sont des génériques TypeScript.
      if re.search(r'[()=;{}"]', text):
        return m.group(0)
      stripped = ' '.join(text.split())
      if not stripped or not is_fr(stripped):
        return m.group(0)
      key = slug_key(domain, stripped)
      pairs[key] = stripped
      return m.group(0).replace(text, "{t('%s')}" % key)

    def repl_attr(m):
      attr, val = m.group(1), m.group(2)
      if not is_fr(val):
        return m.group(0)
      key = slug_key(domain, val)
      pairs[key] = val
      return "{attr}={{t('{key}')}}".format(attr=attr, key=key)

    s = re.sub(r'>([^<>{}]*?)<(?=[/A-Za-z])', repl_jsx, s)
    s = re.sub(r'(aria-label|title|placeholder|alt)="([^"]*)"', repl_attr, s)

    pathlib.Path(path).write_text(s)
    pending.update(pairs)
    print(f'{path}: {len(pairs)} chaînes extraites')

  PENDING.write_text(json.dumps(pending, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
  print(f'pending total: {len(pending)} (scripts/i18n/ui-strings-pending.json)')

if __name__ == '__main__':
  main()
