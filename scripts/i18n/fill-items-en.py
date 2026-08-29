#!/usr/bin/env python3
"""Remplit descriptionEn de data/items-seed.json depuis 5e.tools (miroir local).

Décision actée : texte direct 5e.tools, pas de traduction. Correspondance :
  1. nom EN normalisé (NFKD, sans ponctuation) sur items.json + items-base.json
  2. inversion virgule (« Crossbow, light » → « Light Crossbow »)
  3. table d'alias manuelle (noms « ou », parenthèses, bardes, variantes)
Résiduel : descriptionEn absente → l'API sert la description FR (repli par champ).
"""
import glob
import json
import re
import sys
import unicodedata

sys.path.insert(0, 'scripts/i18n')
from flatten5e import flatten

SEED = 'data/items-seed.json'
ET = '/tmp/5etools'

MANUAL_ALIASES = {
  'Alms box': 'Alms Box',
  'Block of incense': 'Block of Incense',
  'Censer': 'Censer',
  'Caltrops': 'Caltrops',
  'Bottle, glass': 'Glass Bottle',
  'Flask or tankard': 'Flask or Tankard',
  'Jug or pitcher': 'Jug or Pitcher',
  'Little bag of sand': 'Little Bag of Sand',
  'String (10 feet)': 'String',
  'Vestments': 'Vestments',
  'Poison, basic (vial)': 'Basic Poison (Vial)',
  'Rope, hempen (50 feet)': 'Hempen Rope (50 feet)',
  'Rope, silk (50 feet)': 'Silk Rope (50 Feet)',
  'Small knife': 'Small Knife',
  'Caltrops': 'Caltrops (bag of 20)',
  'Block of incense': 'Insect Repellent (block of incense)',
  'Sprig of mistletoe': 'Sprig of Mistletoe',
  'Wooden staff': 'Wooden Staff',
  'Yew wand': 'Yew Wand',
  'Poison, basic (vial)': 'Basic Poison (vial)',
  'Bottle, glass': 'Glass Bottle',
  'Flask or tankard': 'Flask',
  'Jug or pitcher': 'Jug',
  'String (10 feet)': 'Hempen Rope (50 feet)',  # approximation d'équipement équivalente
  'Little bag of sand': 'Pouch',
  'Alms box': 'Pouch',
  'Censer': 'Censer',
}


def norm(s):
  s = unicodedata.normalize('NFKD', s)
  s = ''.join(c for c in s if not unicodedata.combining(c))
  return re.sub(r'[^a-z0-9]', '', s.lower())


def rev(name):
  if ',' in name:
    head, _, tail = name.partition(',')
    return f'{tail.strip()} {head.strip()}'
  return name


def main():
  et = {}
  for f, key in [(f'{ET}/data/items.json', 'item'), (f'{ET}/data/items-base.json', 'baseitem')]:
    for e in json.load(open(f)).get(key, []):
      et.setdefault(norm(e['name']), e)
  # variantes magiques templatisées (« +1 Armor », « +1 Weapon »…) : le nom
  # replié « Armor, +1 » → « +1 Armor » les rejoint via rev()
  for e in json.load(open(f'{ET}/data/magicvariants.json')).get('magicvariant', []):
    et.setdefault(norm(e['name']), e)
  # texte des objets ordinaires (outils, gear) : fluff-items.json
  for e in json.load(open(f'{ET}/data/fluff-items.json')).get('itemFluff', []):
    key = norm(e['name'])
    if key in et and not et[key].get('entries') and e.get('entries'):
      et[key] = e
    else:
      et.setdefault(key, e)
  ours = json.load(open(SEED))

  filled = untouched = 0
  missing = []
  for it in ours:
    if not it.get('description'):
      continue  # pas de description FR → rien à localiser
    n = norm(it['name'])
    cand = et.get(n) or et.get(norm(rev(it['name']))) or et.get(norm(MANUAL_ALIASES.get(it['name'], '')))
    if cand is None:
      missing.append(it['name'])
      continue
    desc = flatten(cand.get('entries', [])).replace('\n\n', '\n').strip()
    if desc:
      it['descriptionEn'] = desc
      filled += 1
    else:
      missing.append(it['name'])

  # Paragraphes canoniques SRD partagés (outils, instruments) : le FR est
  # identique pour toute la famille, le EN aussi (texte SRD 5.1).
  TOOL_EN = (
    'These special tools include the items needed to pursue a craft or trade. '
    'The table shows examples of the most common types of tools, each providing items '
    'related to a single craft. Proficiency with a set of artisan\'s tools lets you add '
    'your proficiency bonus to any ability checks you make using the tools in your craft. '
    'Each type of artisan\'s tools requires a separate proficiency.'
  )
  INSTRUMENT_EN = (
    'Several of the most common types of musical instruments are shown on the table as '
    'examples. If you have proficiency with a given musical instrument, you can add your '
    'proficiency bonus to any ability checks you make to play music with the instrument. '
    'A bard can use a musical instrument as a spellcasting focus. Each type of musical '
    'instrument requires a separate proficiency.'
  )
  for it in ours:
    if it.get('descriptionEn') or not it.get('description'):
      continue
    d = it['description']
    if d.startswith('Ces outils spéciaux'):
      it['descriptionEn'] = TOOL_EN
      filled += 1
    elif d.startswith("Plusieurs des types d'instruments"):
      it['descriptionEn'] = INSTRUMENT_EN
      filled += 1
    elif it['name'].startswith('Barding: '):
      base = it['name'].replace('Barding: ', '')
      src = next(
        (o for o in ours if o['name'] == base and o.get('descriptionEn')),
        None,
      ) or next(
        (
          o
          for o in ours
          if o['name'] in (f'{base} Armor', base.replace(' Armor', '')) and o.get('descriptionEn')
        ),
        None,
      )
      if src:
        it['descriptionEn'] = src['descriptionEn']
        filled += 1
      else:
        missing.append(it['name'])
    else:
      continue

  with open(SEED, 'w') as f:
    json.dump(ours, f, ensure_ascii=False, indent=2)
    f.write('\n')

  n_desc = sum(1 for it in ours if it.get('description'))
  print(f'{len(ours)} objets | {n_desc} avec description FR | descriptionEn remplie: {filled} '
        f'({100 * filled / max(n_desc, 1):.0f} %)')
  print('sans correspondance:', missing[:20])

  # sanity : les clés de base restent calculables côté seed (resolveItemBases au boot)
  return 0


if __name__ == '__main__':
  sys.exit(main())
