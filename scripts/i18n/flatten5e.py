#!/usr/bin/env python3
"""Aplatit les entrées 5e.tools (structure imbriquée + balises {@ref}) en texte plein.

Style calqué sur les descriptions EN déjà présentes dans nos seeds : paragraphes
plein texte séparés par des sauts de ligne, dés marqués « XdY », DD « DC N »,
recharge « (Recharge 5–6) ». Utilisé par fill-spells-en.py et match-monsters-v2.py.
"""
import re

REF = re.compile(r'\{@(\w+)\s+([^}]*)\}')


def _ref(match):
  tag, body = match.group(1), match.group(2)
  parts = [p.strip() for p in body.split('|')]
  text = parts[0]
  if tag in ('dice', 'damage', 'scaledice', 'scaleattack'):
    return text
  if tag in ('hit',):
    return text
  if tag in ('dc',):
    return f'DC {text}'
  if tag in ('recharge',):
    return f'(Recharge {text.replace("–", "-")})'
  if tag in ('h', 'note', 'filter', 'b', 'i', 'u', 'em', 'strong', 'kbd', 'sup', 'span',
             'color', 'link', 'footnote', 'areaRef', 'vehicle', 'book', 'adventure',
             'table', 'chance', 'coinflip', 'text', '5etools', 'loader', 'next', 'deity',
             'optfeature', 'language', 'sense', 'action', 'variant', 'variantInner',
             'variantrule', 'background', 'race', 'classFeature', 'subclassFeature',
             'deck', 'card', 'disease', 'status', 'item', 'spell', 'creature', 'condition',
             'itemProperty', 'itemType', 'skill', 'abilityCheck', 'check', 'bonus',
             'sense', 'magicItem', 'psionic'):
    # tous ces tags portent leur libellé affichable en premier champ
    return text
  return text


def flatten_str(s: str) -> str:
  return REF.sub(_ref, s)


def flatten(entries, depth=0) -> str:
  if entries is None:
    return ''
  if isinstance(entries, str):
    return flatten_str(entries)
  if isinstance(entries, (int, float)):
    return str(entries)
  if isinstance(entries, list):
    return '\n\n'.join(filter(None, (flatten(e, depth) for e in entries)))
  if isinstance(entries, dict):
    t = entries.get('type')
    name = entries.get('name')
    if t == 'entries':
      inner = flatten(entries.get('entries', []), depth)
      return f'{name}.\n{inner}' if name else inner
    if t == 'list':
      items = '\n'.join(f'- {flatten(i, depth)}' for i in entries.get('items', []))
      return items
    if t == 'table':
      cols = [flatten_str(c) if isinstance(c, str) else str(c.get('name', c.get('entry', '')))
              for c in entries.get('colLabels', [])]
      rows = []
      for r in entries.get('rows', []):
        cells = [flatten(c, depth).replace('\n', ' ') for c in r]
        rows.append(' | '.join(cells))
      header = ' | '.join(cols)
      sep = ' | '.join('-' * max(3, len(c) // 2 + 1) for c in cols)
      return '\n'.join([header, sep, *rows])
    if t == 'tableOptions':
      return flatten(entries.get('tables', []), depth)
    if t in ('item', 'itemSub', 'inline', 'inlineBlock'):
      return flatten(entries.get('entries', entries.get('items', [])), depth)
    if t == 'abilityDc':
      return f"Spell save DC = 8 + proficiency + ${entries.get('ability', '')}"
    if t == 'abilityAttackBonus':
      return f"Spell attack modifier = proficiency + ${entries.get('ability', '')}"
    if t == 'options':
      return flatten(entries.get('entries', []), depth)
    if t in ('hr', 'image', 'flowChart', 'gallery'):
      return ''
    # structures inconnues : meilleure tentative sur les champs texte
    for k in ('entries', 'items', 'text', 'description'):
      if k in entries:
        return flatten(entries[k], depth)
    return ''
  return ''
