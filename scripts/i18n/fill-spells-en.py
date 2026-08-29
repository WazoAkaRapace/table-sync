#!/usr/bin/env python3
"""Corrige et complète l'anglais de data/spells-seed.json depuis 5e.tools.

Décisions actées (revue du plan i18n) :
  1. Les sorts aux noms SRD (Arcane Hand, Arcane Sword, Arcanist's Magic Aura) sont
     gardés tels quels — texte SRD déjà correct.
  2. Les descriptions EN françaises (lot XGE/TCE/FTD, 154 entrées) sont remplacées par
     le texte 5e.tools direct (aplatti) — pas de traduction LLM.
  3. Les noms corrompus par la perte d'apostrophe (« Tasha s caustic brew ») reprennent
     le nom canonique 5e.tools.
  4. Les 3 sorts AideDD absents de 5e.tools sont traduits à la main (table ci-dessous).
"""
import glob
import json
import re
import sys
import unicodedata

sys.path.insert(0, 'scripts/i18n')
from flatten5e import flatten

SEED = 'data/spells-seed.json'
ET_DIR = '/tmp/5etools'

# Sorts absents de 5e.tools (suppléments AideDD) : traduction maison.
HAND_TRANSLATED = {
  'projectile-elementaire': {
    'name': 'Elemental Projectile',
    'description': (
      'You create a projectile of elemental magical energy and hurl it at a creature in range. '
      'Make a ranged spell attack against the target. On a hit, the creature takes damage of a '
      'type you choose when you cast this spell (acid, cold, fire, lightning, or thunder).'
    ),
  },
  'vents-contraires': {
    'name': 'Adverse Winds',
    'description': (
      'In reaction to a creature that enters the spell\u2019s range, and before it attacks, you '
      'can force it to make a Strength saving throw. On a failed save, the creature is pushed '
      'back and knocked prone; winds whip against it for the duration.'
    ),
  },
  'invocation-d-ombres': {
    'name': 'Summon Shadows',
    'description': (
      'You open a portal to the Shadowfell, allowing shadows to come through. The targeted area '
      'must be dark, and direct sunlight must not reach it. The shadows obey your commands until '
      'the spell ends.'
    ),
  },
}

# Mots de début typiquement français : le champ `description` doit être en anglais.
FRENCH_START = re.compile(
  r'^(Vous|Une? |Le |La |Les |Crée|Imprègne|Au |En |Jusqu|Pendant|Pour |Tant |Le sort|Sort |'
  r'Vos |Cible|Chaque|Durée|Portée|Formez|Invoque|É|Si )')
# Noms EN dont l'apostrophe a été écrasée (« X s Y »).
BROKEN_NAME = re.compile(r'\bs\s+\w')


def norm(s):
  s = unicodedata.normalize('NFKD', s)
  s = ''.join(c for c in s if not unicodedata.combining(c))
  return re.sub(r'[^a-z0-9]', '', s.lower())


def load_5etools():
  et = {}
  for f in sorted(glob.glob(f'{ET_DIR}/data/spells/spells-*.json')):
    for s in json.load(open(f)).get('spell', []):
      et.setdefault(norm(s['name']), s)  # premier fichier trié = première source
  by_suffix = {}
  for k in et:
    for cut in range(1, len(k)):
      by_suffix.setdefault(k[cut:], []).append(et[k])
  return et, by_suffix


def find(et, by_suffix, spell):
  n = norm(spell['name'])
  if n in et:
    return et[n]
  if len(n) > 4 and n in by_suffix and len(by_suffix[n]) == 1:
    return by_suffix[n][0]  # « Floating Disk » → suffixe de « Tenser's Floating Disk »
  return None


def main():
  et, by_suffix = load_5etools()
  spells = json.load(open(SEED))
  stats = {'desc_filled': 0, 'name_fixed': 0, 'hand_translated': 0, 'untouched': 0, 'no_match': []}

  for s in spells:
    if s.get('srdIndex') in HAND_TRANSLATED:
      tr = HAND_TRANSLATED[s['srdIndex']]
      s['name'] = tr['name']
      s['description'] = tr['description']
      if not s.get('higherLevel') and 'higherLevel' in s:
        s['higherLevel'] = None
      stats['hand_translated'] += 1
      continue

    match = find(et, by_suffix, s)
    changed = False
    if match:
      if BROKEN_NAME.search(s['name']):
        s['name'] = match['name']
        stats['name_fixed'] += 1
        changed = True
      if FRENCH_START.match(s.get('description', '')) or s.get('description') == s.get('descriptionFr'):
        desc = flatten(match.get('entries', [])).replace('\n\n', '\n').strip()
        if desc:
          s['description'] = desc
          hl = flatten(match.get('entriesHigherLevel', [])).replace('\n\n', '\n').strip()
          if hl:
            s['higherLevel'] = hl
          elif 'higherLevel' in s:
            s['higherLevel'] = None
          stats['desc_filled'] += 1
          changed = True
    else:
      stats['no_match'].append(s['name'])

    if not changed:
      stats['untouched'] += 1

  with open(SEED, 'w') as f:
    json.dump(spells, f, ensure_ascii=False, indent=2)
    f.write('\n')

  n = len(spells)
  print(f"{n} sorts | descriptions EN remplies: {stats['desc_filled']} | "
        f"noms corrigés: {stats['name_fixed']} | traduits à la main: {stats['hand_translated']} | "
        f"intacts: {stats['untouched']}")
  if stats['no_match']:
    print('sans correspondance 5e.tools:', stats['no_match'])
  return 0


if __name__ == '__main__':
  sys.exit(main())
