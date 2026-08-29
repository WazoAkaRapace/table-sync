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
  r'\b(fermer|ajouter|annuler|enregistrer|supprimer|modifier|rechercher|créer|voir|ouvrir|retirer|'
  r'afficher|valider|envoyer|confirmer|quitter|rester|retour|nouveau|nouvelle|aucun|aucune|'
  r'tous|toutes|vide|prêt|chargement|erreur|nom|niveau|niveaux|valeur|valeurs|quantité|poids|'
  r'taille|rôle|sorts?|objets?|armes?|armures?|outils?|langues?|maîtrises?|compétences?|'
  r'classe|classes|sous-classe|personnages?|groupes?|combattants?|rencontres?|monstres?|'
  r'bêtes?|joueurs?|adresse|compte|mot de passe|invitations?|membres?|listes?|recherche|'
  r'filtre|filtrer|résultats?|disponible|disponibles|actif|inactif|caché|visible|'
  r'préparation|réaction|rounds?|initiative|dégâts|soins|points de vie|'
  r'sauvegarde|sauvegardes|repos|courte?|longue?|inspiration|concentration|états?|'
  r'épuisement|formes?|sauvage|montures?|équipement|équipé|équiper|déséquiper|portage|'
  r'encombré|encombrement|maximum|minimum|libre|restant|restants|restantes|utilisé|utilisée|'
  r'utilisations?|jour|semaine|mois|heures?|minutes?|permanent|permanente|temporaire|'
  r'dans|avec|pour|vous|votre|sur|son|ses|qui|que|quoi|donc|où|ni|car|ce|cet|cette|ces|'
  r'au|aux|du|par|plus|tout|toute|sont|une|des|le|la|les|ne)\b', re.I)

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


def repl_prop_tmpl(m, domain, pairs):
  prop, tmpl = m.group(1), m.group(2)
  key, vars = tmpl_to_key(domain, tmpl, pairs)
  args = ', '.join(f'{k}: {v}' for k, v in vars.items())
  return "{prop}={{t('{key}', {{ {args} }})}}".format(prop=prop, key=key, args=args)


def tmpl_to_key(domain, tmpl, pairs):
  """`${`expr`}` → `{{var}}` avec un nom dérivé ; retourne (key, vars)."""
  vars = {}

  def sub_expr(m):
    expr = m.group(1).strip()
    name = re.sub(r'[^a-zA-Z0-9]', '_', expr)[:24].strip('_') or 'v'
    if not re.match(r'[a-zA-Z]', name):
      name = f'v_{name}'
    var, n = name, 2
    while var in vars.values():
      var = f'{name}{n}'
      n += 1
    vars[var] = expr
    return '{{' + var + '}}'

  iw = re.sub(r'\$\{([^}]+)\}', sub_expr, tmpl)
  key = slug_key(domain, iw)
  pairs[key] = tmpl
  return key, vars

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
      # texte JSX : le lookahead « < ouvre une balise » garantit la position
      # JSX (les génériques TS ne peuvent y apparaître).
      if re.search(r'[{}=/]', text) or '/*' in text or '*/' in text:
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

    # v2 — attributs en template literal interpolé : aria-label={`X ${y} Z`}
    def repl_attr_tmpl(m):
      attr, tmpl = m.group(1), m.group(2)
      if not is_fr(tmpl):
        return m.group(0)
      key, vars = tmpl_to_key(domain, tmpl, pairs)
      args = ', '.join(f'{k}: {v}' for k, v in vars.items())
      return "{attr}={{t('{key}', {{ {args} }})}}".format(attr=attr, key=key, args=args)

    s = re.sub(r'(aria-label|title|placeholder|alt)=\{`([^`]*)`\}', repl_attr_tmpl, s)

    # v2 — template literal interpolé en position JSX {`…`} ou prop label={`…`}
    def repl_expr_tmpl(m):
      tmpl = m.group(1)
      if not is_fr(tmpl) or re.search(r'\b(rounded|px-|py-|bg-|border-|hover:|active:|flex|shrink|font-|transition)', tmpl):
        return m.group(0)
      key, vars = tmpl_to_key(domain, tmpl, pairs)
      args = ', '.join(f'{k}: {v}' for k, v in vars.items())
      return "{{t('{key}', {{ {args} }})}}".format(key=key, args=args)

    s = re.sub(r'(\w+)=\{`([^`]*)`\}', lambda m: m.group(0) if m.group(1) in ('className', 'style', 'key', 'to', 'id', 'value', 'onChange', 'onClick', 'src', 'href') else repl_prop_tmpl(m, domain, pairs), s)
    s = re.sub(r'\{`([^`]*)`\}', lambda m: m.group(0) if not is_fr(m.group(1)) else repl_expr_tmpl(m), s)

    # v3 — littéraux simples dans des réceptacles d'affichage connus :
    # onNotice('…'), setToast('…'), label: '…', text: '…', title: '…', hint: '…'
    s = re.sub(r"((?:onNotice|onError|onSuccess|setToast|setNotice)\()([^'\n]*)('\))", lambda m: m.group(0), s)  # no-op garde
    def repl_sink_call(m):
      val = m.group(2)
      if not is_fr(val):
        return m.group(0)
      key = slug_key(domain, val)
      pairs[key] = val
      return m.group(1) + "(t('%s'))" % key
    s = re.sub(
      r"(onNotice|onError|onSuccess)\((?:\w+, )?('[^']*[àâçéèêëîïôùûüœ][^']*')\)",
      repl_sink_call,
      s,
    )

    pathlib.Path(path).write_text(s)
    pending.update(pairs)
    print(f'{path}: {len(pairs)} chaînes extraites')

  PENDING.write_text(json.dumps(pending, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
  print(f'pending total: {len(pending)} (scripts/i18n/ui-strings-pending.json)')

if __name__ == '__main__':
  main()
