#!/usr/bin/env python3
"""Recherche EXHAUSTIVE des monstres de data/monsters-seed.json sur le bestiaire
complet 2014.5e.tools (96 fichiers, 3809 monstres), puis écriture de l'overlay
anglais data/monsters-en.json + rapport scripts/i18n/monster-match-report.json.

Cascade de correspondance (toute acceptation est corroborée quand possible) :
  1. slug anglais exact
  2. empreinte stricte : taille+type+CR+6 caractéristiques (indépendant de la langue)
  3. lexique appris : nameFr→nameEn déduit des appariements 1-2, appliqué au résiduel
     avec vérification souple (taille+type+CR, PV à ±10 %)
  4. flou : empreinte à ≤2 caracs près (±2), candidat unique ou désambiguïsé par
     similarité de nom (cognats FR/EN translittérés) + PV concordants
Les correspondances restantes sont listées pour traduction manuelle.
"""
import difflib
import glob
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict

sys.path.insert(0, 'scripts/i18n')
from flatten5e import flatten

ET = '/tmp/5etools'
SEED = 'data/monsters-seed.json'
OUT = 'data/monsters-en.json'
REPORT = 'scripts/i18n/monster-match-report.json'

SIZE_MAP = {'M': 'M', 'G': 'L', 'P': 'S', 'TG': 'H', 'TP': 'T', 'Gig': 'G'}
TYPE_MAP = {
  'Humanoïde': 'humanoid', 'Bête': 'beast', 'Créature artificielle': 'construct',
  'Artificiel': 'construct', 'Démon': 'fiend', 'Fiélon': 'fiend', 'Dragon': 'dragon',
  'Élémentaire': 'elemental', 'Fée': 'fey', 'Géant': 'giant', 'Mort-vivant': 'undead',
  'Plante': 'plant', 'Vase': 'ooze', 'Aberration': 'aberration', 'Céleste': 'celestial',
  'Monstruosité': 'monstrosity', 'Créature monstrueuse': 'monstrosity', 'Nuée': 'swarm',
}


PLURAL_MAP = {'bêtes': 'beast', 'mort-vivants': 'undead', 'fiélons': 'fiend',
              'créatures monstrueuses': 'monstrosity', 'humanoïdes': 'humanoid',
              'démons': 'fiend', 'plantes': 'plant', 'vases': 'ooze',
              'aberrations': 'aberration', 'élémentaires': 'elemental', 'fées': 'fey',
              'géants': 'giant', 'célestes': 'celestial', 'dragons': 'dragon'}


def norm_type(t):
  t = t.replace('•', '-').split('(')[0]
  t = re.sub(r'de (Très )?(Grande|Petite) taille|de taille \w+|, .*', '', t).strip()
  if t.startswith('Nuée'):
    inner = ' '.join(re.sub(r'\b(TP|TG|G|P|Min|de|d’)\b', ' ', t[4:]).split())
    return PLURAL_MAP.get(inner) or TYPE_MAP.get(inner) or 'swarm'
  return TYPE_MAP.get(t)


def translit(s):
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
    return float(eval(cr))  # noqa: S307 — « 1/8 » → 0.125 exact
  return float(cr)


def load_5etools():
  monsters = []
  for f in sorted(glob.glob(f'{ET}/data/bestiary/bestiary-*.json')):
    monsters += json.load(open(f)).get('monster', [])
  for m in monsters:
    t = m.get('type')
    m['_type'] = t.get('type') if isinstance(t, dict) else t
    sz = m.get('size')
    m['_size'] = sz[0] if isinstance(sz, list) else sz
    try:
      m['_cr'] = cr_num(m.get('cr'))
    except Exception:
      m['_cr'] = None
    m['_slug'] = slugify(m['name'])
  return monsters


def our_fingerprint(m):
  a = m['abilities']
  return (SIZE_MAP.get(m['size']), norm_type(m['type']), float(m['challengeRating']),
          a['for'], a['dex'], a['con'], a['int'], a['sag'], a['cha'])


def fuzzy_close(k, c):
  return sum(1 for a, b in zip(k[3:], c[3:]) if abs(a - b) > 2) <= 2


def name_similarity(fr, en):
  return difflib.SequenceMatcher(None, translit(fr), translit(en)).ratio()


def to_overlay(m5):
  """Extrait le bloc de stat EN d'un monstre 5e.tools (texte uniquement)."""
  def blocks(key):
    out = []
    for e in m5.get(key, []):
      if isinstance(e, str):
        continue
      out.append({'name': e.get('name', ''), 'desc': flatten(e.get('entries', [])).strip()})
    return [x for x in out if x['desc']]
  sp = m5.get('speed', {})
  if isinstance(sp, dict):
    speed = ', '.join(f'{k} {v}' for k, v in sp.items() if k != 'notes')
  else:
    speed = str(sp)
  ov = {'name': m5['name'], 'source': m5.get('source')}
  if speed:
    ov['speed'] = speed
  if m5.get('senses'):
    ov['senses'] = m5['senses']
  if m5.get('languages'):
    ov['languages'] = m5['languages']
  for key, out_key in (('trait', 'traits'), ('action', 'actions'),
                       ('bonusAction', 'bonusActions'), ('reaction', 'reactions'),
                       ('legendary', 'legendaryActions')):
    b = blocks(key)
    if b:
      ov[out_key] = b
  return ov


# --- dictionnaire de noms FR→EN (connaissances SRD/ToA/Volo/MTF/DMG), vérifié par CR+type
NAME_MAP = {
  # MM / classique
  'Cultiste': 'Cultist', 'Cultiste fanatique': 'Cult Fanatic', 'Membre de secte': 'Cultist',
  'Garde': 'Guard', 'Guerrier tribal': 'Tribal Warrior', 'Molosse': 'Mastiff',
  'Rat géant': 'Giant Rat', 'Hibou': 'Owl', 'Hibou géant': 'Giant Owl',
  'Serpent venimeux': 'Poisonous Snake', 'Serpent volant': 'Flying Snake',
  'Poney': 'Pony', 'Chameau': 'Camel', 'Strige': 'Stirge', 'Crabe géant': 'Giant Crab',
  'Faucon de sang': 'Blood Hawk', 'Belette géante': 'Giant Weasel',
  'Nuée de chauves-souris': 'Swarm of Bats', 'Cheval de guerre lourd': 'Warhorse',
  'Gnoll, chef de meute': 'Gnoll Pack Lord', 'Gobelours, chef barbare': 'Bugbear Chief',
  'Drow, prêtresse': 'Drow Priestess of Lolth', 'Sahuagin, prêtresse de Mikala': 'Sahuagin Priestess',
  'Homme-poisson': 'Locathah', 'Avatar de la mort': 'Avatar of Death',
  'Mouche d\'ébène': 'Ebony Fly', 'Slaad, têtard': 'Slaad Tadpole',
  'Cerbère': 'Cerberus', 'Valkyrie': 'Valkyrie', 'Einherjar': 'Einherjar',
  'Hadrosaure': 'Hadrosaurus', 'Dévoreur arcanique': 'Devourer',
  'Crapaudonte': 'Froghemoth', 'Escargot écraseur': 'Flail Snail',
  'Nuée de larves de la pourriture': 'Swarm of Rot Grubs', 'Spinosaure': 'Spinosaurus', 'Stegosaure': 'Stegosaurus',
  'Ptérosaurien': 'Pteranodon', 'Allosaure': 'Allosaurus', 'Ankylosaure': 'Ankylosaurus',
  # Tome de l'Annihilation
  'Attrape-homme': 'Mantrap', 'Chef Végépygmée': 'Vegepygmy Chief', 'Végépygmée': 'Vegepygmy',
  'Gargouille géante à quatre bras': 'Four-Armed Gargoyle', 'Grung': 'Grung',
  'Grung guerrier d\'élite': 'Grung Elite Warrior', 'Grung sauvage': 'Grung Wildling',
  'Jacouli': 'Jaculi', 'Juggernaut de pierre': 'Stone Juggernaut',
  'Kobold ensorceleur des écailles': 'Kobold Scale Sorcerer',
  'Kobold inventeur': 'Kobold Inventor', 'Nuée de larves de la pourriture': 'Swarm of Rot Grubs',
  'Palmier trois-fleurs': 'Tri-flower Frond', 'Sauteur géant': 'Giant Strider',
  'Tortue serpentine géante': 'Giant Snapping Turtle', 'Zombi ankylosaure': 'Ankylosaurus Zombie',
  'Zombi girallon': 'Girallon Zombie', 'Zombi tyrannosaure': 'Tyrannosaurus Zombie',
  'Zorbo': 'Zorbo', 'Camazotz': 'Camazotz',
}
# Morphologie dragons MM : « Dragon X, âge » → « {Age} {X} Dragon »
DRAGON_COLORS = {'blanc': 'White', 'bleu': 'Blue', 'noir': 'Black', 'rouge': 'Red',
                 'vert': 'Green', 'd\'or': 'Gold', 'd\'argent': 'Silver',
                 'de cuivre': 'Copper', 'de bronze': 'Bronze', 'd\'airain': 'Brass'}
DRAGON_AGES = {'dragonnet': 'Wyrmling', 'jeune': 'Young', 'adulte': 'Adult', 'ancien': 'Ancient'}
for _c_fr, _c_en in DRAGON_COLORS.items():
    for _a_fr, _a_en in DRAGON_AGES.items():
        NAME_MAP[f'Dragon {_c_fr}, {_a_fr}'] = f'{_a_en} {_c_en} Dragon'


def main():
  et = load_5etools()
  ours = json.load(open(SEED))
  by_slug, by_fp = {}, {}
  for m in et:
    by_slug.setdefault(m['_slug'], m)
    if m['_cr'] is not None and isinstance(m['_type'], str) and isinstance(m['_size'], str):
      abils = [m.get(k) for k in ('str', 'dex', 'con', 'int', 'wis', 'cha')]
      if all(isinstance(a, int) for a in abils):
        fp = (m['_size'], m['_type'], m['_cr'], *abils)
        m['_fp'] = fp
        by_fp.setdefault(fp, m)

  result = {}   # slug → (methode, monstre 5etools)
  methods = Counter()

  # --- passes 1 & 2 : slug, empreinte stricte
  for m in ours:
    if m['slug'] in by_slug:
      result[m['slug']] = ('slug', by_slug[m['slug']])
    else:
      try:
        fp = our_fingerprint(m)
      except Exception:
        fp = None
      if fp and fp in by_fp:
        result[m['slug']] = ('fingerprint', by_fp[fp])
  methods.update(v[0] for v in result.values())

  # --- lexique appris (nameFr → nameEn) depuis les appariements sûrs
  lexicon = defaultdict(set)
  for m in ours:
    r = result.get(m['slug'])
    if r:
      lexicon[m['nameFr']].add(r[1]['name'])
  lexicon = {k: next(iter(v)) for k, v in lexicon.items() if len(v) == 1}

  def loose_ok(m5, m):
    if m5['_size'] != SIZE_MAP.get(m['size']) or m5['_type'] != norm_type(m['type']):
      return False
    if m5['_cr'] is None or abs(m5['_cr'] - float(m['challengeRating'])) > 0.01:
      return False
    hp = m5.get('hp', {}).get('average')
    if hp and m.get('hitPoints') and abs(hp - m['hitPoints']) > max(3, 0.15 * m['hitPoints']):
      return False
    return True

  # --- passe 3 : lexique
  for m in ours:
    if m['slug'] in result:
      continue
    en_name = lexicon.get(m['nameFr'])
    if not en_name:
      continue
    cands = [x for x in et if x['name'] == en_name]
    cands = [c for c in cands if loose_ok(c, m)]
    if len(cands) == 1:
      result[m['slug']] = ('lexicon', cands[0])
  methods = Counter(v[0] for v in result.values())


  # --- passe 3.5 : dictionnaire de noms (vérifié par CR + type)
  et_by_name = defaultdict(list)
  for m5 in et:
    et_by_name[m5['name'].lower()].append(m5)
  for m in ours:
    if m['slug'] in result:
      continue
    name_norm = ' '.join(m['nameFr'].split())
    en_names = [NAME_MAP[name_norm].lower()] if name_norm in NAME_MAP else []
    for extra in ([m['nameFr']] if translit(m['nameFr']).isascii() and len(en_names) == 0 else []):
      en_names.append(extra.lower())  # noms propres identiques EN/FR (Akyishigal…)
    hit = None
    for en in en_names:
      from_dict = ' '.join(m['nameFr'].split()) in NAME_MAP
      strict = [c for c in et_by_name.get(en, [])
                if c['_cr'] is not None and abs(c['_cr'] - float(m['challengeRating'])) < 0.01
                and (c['_type'] == norm_type(m['type'])
                     # identités vérifiées à la main : nom du dictionnaire + CR exact suffisent
                     or (from_dict and c['_size'] == SIZE_MAP.get(m['size'])))]
      if strict:
        pref = [c for c in strict if c['_size'] == SIZE_MAP.get(m['size'])] or strict
        hit = pref[0]
        method = 'named'
        break
      # tolérant : étiquette CR divergente côté 5e-drs — type d'accord + nom exact,
      # on préfère le candidat dont les PV collent
      loose = [c for c in et_by_name.get(en, []) if c['_type'] == norm_type(m['type'])]
      if loose:
        hp = lambda c: c.get('hp', {}).get('average') or 0
        pref = sorted(loose, key=lambda c: (abs(hp(c) - m.get('hitPoints', 0)) > max(3, 0.15 * m.get('hitPoints', 1)),
                                            c['_size'] != SIZE_MAP.get(m['size'])))
        hit = pref[0]
        method = 'named-lenient'
        break
    if hit:
      result[m['slug']] = (method, hit)

  # --- passe 4 : flou + score de nom
  by3 = defaultdict(list)
  for m5 in et:
    fp5 = m5.get('_fp')
    if fp5:
      by3[fp5[:3]].append(m5)
  for m in ours:
    if m['slug'] in result:
      continue
    try:
      fp = our_fingerprint(m)
    except Exception:
      continue
    if fp[:3] not in SIZE_MAP.values() and fp[1] is None:
      continue
    cands = [c for c in by3.get(fp[:3], []) if fuzzy_close(fp, c['_fp'])]
    if not cands:
      continue
    scored = sorted(cands, key=lambda c: -name_similarity(m['nameFr'], c['name']))
    best = scored[0]
    hp = best.get('hp', {}).get('average')
    hp_ok = hp and m.get('hitPoints') and abs(hp - m['hitPoints']) <= max(3, 0.15 * m['hitPoints'])
    sim = name_similarity(m['nameFr'], best['name'])
    if len(scored) == 1 and (hp_ok or sim > 0.55):
      result[m['slug']] = ('fuzzy-unique', best)
    elif sim > 0.62 and hp_ok:
      result[m['slug']] = ('fuzzy-named', best)
  methods = Counter(v[0] for v in result.values())

  # --- passe 5 : nom exact unique (divergences d'étiquettes CR/type côté 5e-drs tolérées)
  for m in ours:
    if m['slug'] in result:
      continue
    name_norm = ' '.join(m['nameFr'].split())
    en = NAME_MAP.get(name_norm, name_norm if translit(name_norm).isascii() else None)
    if not en:
      continue
    cands = et_by_name.get(en.lower(), [])
    same_size = [c for c in cands if c['_size'] == SIZE_MAP.get(m['size'])]
    if len(cands) == 1 and same_size:
      result[m['slug']] = ('named-unique', cands[0])
    elif len(same_size) == 1 and len(cands) <= 3:
      result[m['slug']] = ('named-unique', same_size[0])

  # --- écritures (les traductions manuelles priment sur tout)
  manual_path = 'data/monsters-en-manual.json'
  manual = json.load(open(manual_path)) if __import__('os').path.exists(manual_path) else {}
  overlay = {slug: to_overlay(m5) for slug, (_, m5) in result.items()}
  overlay.update(manual)
  residual = [
    {'slug': m['slug'], 'nameFr': m['nameFr'], 'source': m.get('source'),
     'cr': m['challengeRating'], 'type': m['type'], 'size': m['size']}
    for m in ours if m['slug'] not in result
  ]
  with open(OUT, 'w') as f:
    json.dump(overlay, f, ensure_ascii=False, indent=2)
    f.write('\n')
  residual = [r for r in residual if r['slug'] not in manual]
  report = {
    'total': len(ours), 'matched': len(result) + len(manual), 'manual': len(manual),
    'residual': len(residual),
    'methods': dict(methods), 'residual_list': residual,
  }
  with open(REPORT, 'w') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

  print(f"{len(ours)} monstres | appariés {len(result)} ({100 * len(result) / len(ours):.0f} %) "
        f"| résiduel {len(residual)}")
  print('méthodes:', dict(methods))
  print('résiduel (aperçu):', [(r['slug'], r['nameFr']) for r in residual[:15]])


if __name__ == '__main__':
  main()
