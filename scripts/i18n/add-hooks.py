#!/usr/bin/env python3
"""Ajoute `const { t } = useTranslation();` dans chaque fonction signalée par
tsc (TS2304 't') — inséré APRÈS la vraie accolade ouvrante (équilibre des
parenthèses, signatures multi-lignes incluses) + import react-i18next."""
import collections
import re
import subprocess
import sys

errors = subprocess.run(['npx', 'tsc', '-b'], cwd='apps/web', capture_output=True, text=True).stdout
by_file = collections.defaultdict(list)
for m in re.finditer(r'src/([\w/]+\.tsx)\((\d+),\d+\): error TS2304: Cannot find name \'t\'', errors):
    by_file[m.group(1)].append(int(m.group(2)))

for rel, lines in by_file.items():
    path = f'apps/web/src/{rel}'
    src = open(path).read()
    file_lines = src.split('\n')
    func_starts = set()
    for ln in lines:
        for i in range(ln - 1, -1, -1):
            if re.match(r'^(export )?(default )?function \w+', file_lines[i]):
                func_starts.add(i)
                break
    for i in sorted(func_starts, reverse=True):
        depth = 0
        j = i
        while j < len(file_lines):
            depth += file_lines[j].count('(') - file_lines[j].count(')')
            if depth <= 0 and file_lines[j].rstrip().endswith('{'):
                break
            j += 1
        file_lines.insert(j + 1, '  const { t } = useTranslation();')
    src = '\n'.join(file_lines)
    if "from 'react-i18next'" not in src:
        ls = src.split('\n')
        idxs = [k for k, l in enumerate(ls[:60]) if l.startswith('import ')]
        ls.insert(idxs[-1] + 1 if idxs else 0, "import { useTranslation } from 'react-i18next';")
        src = '\n'.join(ls)
    open(path, 'w').write(src)
    print(f'{rel}: {len(func_starts)} hook(s)')
sys.exit(0)
