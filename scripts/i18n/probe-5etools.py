#!/usr/bin/env python3
"""Sonde de couverture : nos seeds FR vs les données EN de 2014.5e.tools (miroir GitHub).

Source des chiffres de docs/i18n-english-plan.md. Rejouable :

    python3 scripts/i18n/probe-5etools.py            # clone/actualise /tmp/5etools puis mesure

Stratégies testées (dans l'ordre du plan) :
  sorts    — nom EN normalisé, puis alias par suffixe ("Floating Disk" ⊂ "Tenser's Floating Disk")
  objets   — nom normalisé sur items.json + items-base.json, puis inversion virgule
             ("Crossbow, light" → "Light Crossbow")
  monstres — slug EN ∪ empreinte numérique (taille+type+CR+6 caracs, indépendante de la langue),
             puis flou (≤2 caracs à ±2, candidat unique) avec corroboration PV ±2
"""
import glob
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict

REPO = '5etools-mirror-3/5etools-2014-src'
ET_DIR = '/tmp/5etools'
SEED_DIR = f'{__file__.rsplit("/scripts/", 1)[0]}/data'

SIZE_MAP = {'M': 'M', 'G': 'L', 'P': 'S', 'TG': 'H', 'TP': 'T', 'Gig': 'G'}
TYPE_MAP = {
  'Humanoïde': 'humanoid', 'Bête': 'beast', 'Créature artificielle': 'construct',
  'Artificiel': 'construct', 'Démon': 'fiend', 'Fiélon': 'fiend', 'Dragon': 'dragon',
  'Élémentaire': 'elemental', 'Fée': 'fey', 'Géant': 'giant', 'Mort-vivant': 'undead',
  'Plante': 'plant', 'Vase': 'ooze', 'Aberration': 'aberration', 'Céleste': 'celestial',
  'Monstruosité': 'monstrosity', 'Créature monstrueuse': 'monstrosity', 'Nuée': 'swarm',
}


def ensure_5etools():
  if not glob.glob(f'{ET_DIR}/data/bestiary/*.json'):
    subprocess.run(['git', 'clone', '--depth', '1', '--filter', 'blob:none', '--sparse',
                    f'https://github.com/{REPO}.git', ET_DIR], check=True)
    subprocess.run(['git', '-C', ET_DIR, 'sparse-checkout', 'set', '--skip-checks',
                    'data/spells', 'data/bestiary', 'data/class', 'data/items.json',
                    'data/items-base.json', 'data/magicvariants.json',
                    'data/conditionsdiseases.json', 'data/languages.json'], check=True)
  commit = subprocess.run(['git', '-C', ET_DIR, 'rev-parse', 'HEAD'],
                          capture_output=True, text=True).stdout.strip()
  return commit


def norm(s):
  s = unicodedata.normalize('NFKD', s)
  s = ''.join(c for c in s if not unicodedata.combining(c))
  return re.sub(r'[^a-z0-9]', '', s.lower())


def slugify(s):
  s = unicodedata.normalize('NFKD', s)
  s = ''.join(c for c in s if not unicodedata.combining(c))
  return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def cr_num(cr):
  if isinstance(cr, dict):
    cr = cr['cr']
  if isinstance(cr, str) and '/' in cr:
    return round(eval(cr), 2)  # noqa: S307 — chaîne "1/2" du format 5e.tools
  return float(cr)


def load_json(path, key):
  with open(path) as f:
    return json.load(f).get(key, [])


def probe_spells(commit):
  et = {}
  for f in glob.glob(f'{ET_DIR}/data/spells/spells-*.json'):
    for s in load_json(f, 'spell'):
      et.setdefault(norm(s['name']), s)
  ours = json.load(open(f'{SEED_DIR}/spells-seed.json'))
  base = [s for s in ours if norm(s['name']) in et]
  miss = [s for s in ours if norm(s['name']) not in et]
  suffix = [s for s in miss
            if any(k.endswith(norm(s['name'])) and len(norm(s['name'])) > 4 for k in et)]
  still = [s['name'] for s in miss if s not in suffix]
  n = len(ours)
  print(f'SORTS    : {n} | direct {len(base)} + suffixe {len(suffix)} '
        f'= {len(base) + len(suffix)}/{n} ({100 * (len(base) + len(suffix)) / n:.1f} %)')
  print(f'           résiduel: {still}')


def probe_items(commit):
  et = {}
  for f, key in [(f'{ET_DIR}/data/items.json', 'item'), (f'{ET_DIR}/data/items-base.json', 'baseitem')]:
    for e in load_json(f, key):
      et.setdefault(norm(e['name']), e)
  ours = json.load(open(f'{SEED_DIR}/items-seed.json'))
  base = [i for i in ours if norm(i['name']) in et]

  def rev(name):
    if ',' in name:
      head, _, tail = name.partition(',')
      return f'{tail.strip()} {head.strip()}'
    return name

  miss = [i for i in ours if norm(i['name']) not in et]
  reversed_hits = [i for i in miss if norm(rev(i['name'])) in et]
  still = [i['name'] for i in miss if i not in reversed_hits]
  n = len(ours)
  print(f'OBJETS   : {n} | direct {len(base)} + inversion virgule {len(reversed_hits)} '
        f'= {len(base) + len(reversed_hits)}/{n} ({100 * (len(base) + len(reversed_hits)) / n:.1f} %)')
  print(f'           résiduel {len(still)} (ex.: {still[:8]})')


def probe_monsters(commit):
  et_fp, et_sl = {}, {}
  for f in glob.glob(f'{ET_DIR}/data/bestiary/bestiary-*.json'):
    for m in load_json(f, 'monster'):
      try:
        t = m['type']
        t = t.get('type') if isinstance(t, dict) else t
        sz = m['size']
        sz = sz[0] if isinstance(sz, list) else sz
        fp = (str(sz), str(t), cr_num(m['cr']),
              m['str'], m['dex'], m['con'], m['int'], m['wis'], m['cha'])
      except (KeyError, TypeError, ValueError):
        continue
      et_fp.setdefault(fp, m)
      et_sl.setdefault(slugify(m['name']), m)

  def norm_type(t):
    t = t.replace('•', '-').split('(')[0]
    t = re.sub(r'de (Très )?(Grande|Petite) taille', '', t).strip()
    return TYPE_MAP.get(t, None)

  ours = json.load(open(f'{SEED_DIR}/monsters-seed.json'))

  def fp_of(m):
    a = m['abilities']
    return (SIZE_MAP.get(m['size']), norm_type(m['type']), float(m['challengeRating']),
            a['for'], a['dex'], a['con'], a['int'], a['sag'], a['cha'])

  union = 0
  for m in ours:
    try:
      hit = m['slug'] in et_sl or fp_of(m) in et_fp
    except (KeyError, TypeError, ValueError):
      hit = m['slug'] in et_sl
    union += hit

  by3 = defaultdict(list)
  for k in et_fp:
    by3[k[:3]].append(k)
  fuzzy = 0
  amb = 0
  for m in ours:
    try:
      k = fp_of(m)
      bad = k[0] is None or k[1] is None
    except (KeyError, TypeError, ValueError):
      bad = True
    if bad or k in et_fp or m['slug'] in et_sl:
      continue
    cands = [c for c in by3.get(k[:3], [])
             if sum(1 for a, b in zip(k[3:], c[3:]) if abs(a - b) > 2) <= 2]
    if len(cands) == 1:
      fuzzy += 1
    elif len(cands) > 1:
      amb += 1
  n = len(ours)
  print(f'MONSTRES : {n} | slug∪empreinte {union} ({100 * union / n:.0f} %) '
        f'+ flou unique {fuzzy} = {union + fuzzy} ({100 * (union + fuzzy) / n:.0f} %) '
        f'| ambigus {amb}, résiduel {n - union - fuzzy}')


def main():
  commit = ensure_5etools()
  print(f'# 5e.tools mirror commit: {commit}')
  probe_spells(commit)
  probe_items(commit)
  probe_monsters(commit)
  return 0


if __name__ == '__main__':
  sys.exit(main())
