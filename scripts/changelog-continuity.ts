/**
 * Continuité des versions calver d'un même jour (contrat changelog).
 *
 * Règles vérifiées sur les entrées VERSIONNÉES (version != null) :
 * - par jour (préfixe calver), les suffixes forment une séquence complète :
 *   base (sans suffixe), -2, -3… -N — jamais -1, jamais de trou, jamais de
 *   doublon (le doublon exact est déjà couvert par la gate unicité) ;
 * - la base du jour est obligatoire (la numérotation d'un jour démarre au
 *   calver nu) ;
 * - l'ordre DES ENTRÉES dans un groupe n'est pas contraint : il suit l'ordre
 *   de merge des PR (antichronologique), pas l'ordre de release — l'historique
 *   pré-contrat-par-tag (oct. 2026) mélange légitimement base au-dessus de -2 ;
 * - les groupes de jours doivent être contigus et descendants (un jour déjà
 *   refermé ne réapparaît pas plus bas).
 *
 * Utilisé par check-changelog.ts (gate CI, --check-format + selftest) et par
 * release-tag.ts (auto-contrôle APRÈS assignation — un stamp qui créerait un
 * trou échoue avant d'écrire).
 */
export type ContinuityEntry = { version: string | null };

const VER_DAY_RE = /^(\d{4}\.\d{2}\.\d{2})(?:-(\d+))?$/;

function label(suffix: number): string {
  return suffix === 0 ? 'base' : `-${suffix}`;
}

export function continuityErrors(entries: ContinuityEntry[]): string[] {
  const errs: string[] = [];
  const groups: { prefix: string; suffixes: number[] }[] = [];
  const seenDays = new Set<string>();
  let prevPrefix = '';

  entries.forEach((e, i) => {
    if (!e.version) return; // entrée en attente : versionnée au prochain tag
    const m = e.version.match(VER_DAY_RE);
    if (!m) return; // format invalide : déjà signalé par fmtErrors
    const prefix = m[1];
    const suffix = m[2] ? parseInt(m[2], 10) : 0;
    // Suffixe non canonique : -0 passerait pour la base, -1 n'existe jamais.
    if (m[2] && suffix < 2) {
      errs.push(`entrée ${i} : suffixe -${m[2]} interdit (-2 minimum).`);
    }
    let group = groups[groups.length - 1];
    if (!group || group.prefix !== prefix) {
      if (seenDays.has(prefix)) {
        errs.push(`entrée ${i} : jour ${prefix} non contigu (refermé plus haut dans le fichier).`);
      }
      if (prevPrefix && prefix > prevPrefix) {
        errs.push(`entrée ${i} : jour ${prefix} placé après ${prevPrefix} (les jours descendent).`);
      }
      seenDays.add(prefix);
      prevPrefix = prefix;
      group = { prefix, suffixes: [] };
      groups.push(group);
    }
    group.suffixes.push(suffix);
  });

  groups.forEach((g) => {
    const sorted = [...g.suffixes].sort((a, b) => b - a);
    if (!sorted.includes(0)) errs.push(`jour ${g.prefix} : version de base absente.`);
    if (sorted.includes(1)) errs.push(`jour ${g.prefix} : suffixe -1 interdit.`);
    for (let k = 0; k + 1 < sorted.length; k++) {
      const hi = sorted[k];
      const lo = sorted[k + 1];
      // Transition légale : k → k-1, et 2 → base (le -1 n'existe jamais).
      const legal = hi - lo === 1 || (hi === 2 && lo === 0);
      if (!legal) {
        errs.push(
          `jour ${g.prefix} : séquence discontinue (${label(hi)} puis ${label(lo)} — suffixe manquant).`,
        );
        break;
      }
    }
  });
  return errs;
}
