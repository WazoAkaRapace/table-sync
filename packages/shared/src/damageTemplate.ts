/**
 * Moteur de template de dégâts des armes personnalisées (plan « Armes
 * personnalisées complètes », 2026-11). Texte libre « 4d6+FOR+2 » : les
 * mots-clés FOR/DEX/magie sont reconnus comme variables du porteur, le reste
 * est parsé en groupes de dés et bonus fixes. Un même système couvre le
 * rendu figé (« 4d6+6 », total littéral) et le rendu contextuel (mods du
 * personnage additionnés — jamais « 4d6+4+2 »).
 *
 * Grammaire : expr := term (('+'|'-') term)* ; term := NdM | FOR | DEX |
 * magie | entier. Un template invalide retourne null — le formulaire affiche
 * l'erreur inline, l'API répond 400, jamais de silence.
 */

/** Token d'un template de dégâts parsé. */
export type DamageToken =
  | { kind: 'dice'; count: number; faces: number } // 4d6
  | { kind: 'fixed'; value: number } // +2 / -1
  | { kind: 'str' } // FOR
  | { kind: 'dex' } // DEX
  | { kind: 'magic' }; // magie

export interface ParsedDamageTemplate {
  tokens: DamageToken[];
  /** Dés purs concaténés (« 4d6 », « 2d6+1d4 ») — null si aucun dé. */
  diceStr: string | null;
}

/** Variables du porteur, résolues au rendu. */
export interface DamageVars {
  strMod: number;
  dexMod: number;
  magicBonus: number;
}

/** Faces de dés autorisées (dés SRD 5e + d100 des tables). */
const DICE_FACES = new Set(['4', '6', '8', '10', '12', '20', '100']);

/** Plafond SRD raisonnable pour un modificateur fixe (±20 couvre tout le bestiaire). */
const MAX_FIXED_BONUS = 20;

/**
 * Parse « 4d6+FOR+2 ». Retourne null si l'expression est invalide (vide,
 * token inconnu, dé aux faces impossibles, bonus fixe au-delà de ±20).
 *
 * Compatible descendante : tout `damageDice` SRD existant (« 2d6 ») parse en
 * {dice, diceStr:'2d6'} — aucun seed ne contient de « + » (gardien Task 9).
 */
export function parseDamageTemplate(input: string): ParsedDamageTemplate | null {
  const src = (input ?? '').replace(/\s+/g, '');
  if (src === '') return null;
  // Signe explicite du premier terme (optionnel) puis termes signés.
  const expr = src.startsWith('+') || src.startsWith('-') ? src : `+${src}`;
  const tokens: DamageToken[] = [];
  const dice: string[] = [];
  const re = /([+-])([^+-]+)/g;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m.index !== consumed) return null; // caractères inconnus entre termes
    consumed = re.lastIndex;
    const negative = m[1] === '-';
    const term = m[2];

    // Dés : \d{1,2}d(4|6|8|10|12|20|100) — jamais négatifs.
    const dm = term.match(/^(\d{1,2})d(\d{1,3})$/i);
    if (dm) {
      if (negative || !DICE_FACES.has(dm[2])) return null;
      tokens.push({ kind: 'dice', count: parseInt(dm[1], 10), faces: parseInt(dm[2], 10) });
      dice.push(`${dm[1]}d${dm[2]}`);
      continue;
    }

    // Mots-clés (insensible casse) — jamais niés : le token n'a pas de signe.
    const kw = term.toUpperCase();
    if (kw === 'FOR' || kw === 'DEX' || kw === 'MAGIE') {
      if (negative) return null;
      tokens.push(
        kw === 'FOR' ? { kind: 'str' } : kw === 'DEX' ? { kind: 'dex' } : { kind: 'magic' },
      );
      continue;
    }

    // Entier fixe signé, plafonné à ±20.
    if (/^\d{1,3}$/.test(term)) {
      const value = negative ? -parseInt(term, 10) : parseInt(term, 10);
      if (Math.abs(value) > MAX_FIXED_BONUS) return null;
      tokens.push({ kind: 'fixed', value });
      continue;
    }

    return null; // token inconnu (4d6+FOO)
  }
  if (consumed !== expr.length) return null; // trame résiduelle (terme vide…)
  return { tokens, diceStr: dice.length > 0 ? dice.join('+') : null };
}

/**
 * Rendu : « 4d6+6 » (mods additionnés, jamais « 4d6+4+2 »). Négatif →
 * « 4d6-1 » ; nul → « 4d6 ». Sans dé, le total littéral seul (« 6 »).
 * `flatBonus` (style de combat Duel…) se fond dans la même somme.
 */
export function renderDamageTemplate(
  p: ParsedDamageTemplate,
  vars: DamageVars,
  flatBonus = 0,
): string {
  let mod = flatBonus;
  for (const t of p.tokens) {
    if (t.kind === 'fixed') mod += t.value;
    else if (t.kind === 'str') mod += vars.strMod;
    else if (t.kind === 'dex') mod += vars.dexMod;
    else if (t.kind === 'magic') mod += vars.magicBonus;
  }
  if (p.diceStr === null) return String(mod);
  if (mod === 0) return p.diceStr;
  return mod > 0 ? `${p.diceStr}+${mod}` : `${p.diceStr}${mod}`;
}
