# Audit de résidu i18n — passe des agents (2026-08-28)

*Vérification exhaustive demandée après les revues UI : 5 agents ont lu
l'intégralité des fichiers web. **~690 sites FR codés en dur restants**
(au-delà du filet ratchet 1054 — les agents comptent les sites, pas les
caractères, et incluent les toasts/attributs/ternaires que l'extracteur
refuse). Ce document est la file de travail ; barrer ce qui est fait.*

## Bugs systémiques trouvés (corrigés dans le même commit)
- ✅ Onglets de la fiche : `tab.label` rendu SANS `t()` → clés brutes
  (« onglet.survie ») dans les DEUX langues (4 sites).
- ✅ CombatWidget:217 + SpellsTab:630 : `className={t('clé-inexistante')}`
  → classes Tailwind effondrées (tiroir combat + puces filtres sorts).

## Répartition par zone (sites restants après correctifs ci-dessus)

| Zone | Sites | Pires fichiers |
|---|---|---|
| Feuille — survie/stats/compétences | ~120 | SurvivalPanel 56, StateBand 21, SkillsTab 20 |
| Sorts/traits/description/PNJ/notes | ~185 | SpellsTab 47, FeaturesTab 37, NpcPage 30, CastSpellSheet 19 |
| Inventaire | ~112 | InventoryPage 41, ItemImageViewer 13, InventoryRow 18 |
| Combat + MD | ~183 | CombatPage 69, GmaAssistantTab 32, GmDashboardPage 38 |
| Auth/groupes/compte/création/shell | ~78 | CreatePage 24, PartiesPage 11, ui.tsx 11 |

## Catégories récurrentes (près de la moitié du total)
1. **Toast/erreurs** : `'Erreur'`, `'Erreur de mise à jour'`, apiError(...)
   — uniformisables en une clé partagée + interpolation.
2. **ConfirmButton** : `confirmChildren="Supprimer ?"` / `ariaLabel` non
   traduits partout (ui.tsx doit les prendre en charge par défaut).
3. **LoadingSpinner/EmptyState** : props label/hint FR dans ~30 sites.
4. **Helpers existants non branchés** : schoolLabel (menu écoles),
   classNameLabel (noms de classe affichés bruts ×12), abilityLabel
   (DND_ABILITIES bruts ×4), languageLabel (DND_LANGUAGES ×3),
   skillInfoLabel (read-mode SkillsTab).
5. **Tables FR sans miroir EN** : NPC_DISPOSITION/STATUS_LABELS_FR,
   CLASS_SUBCLASSES[].label (39), MULTICLASS_PROFICIENCIES_GAINED[].linesFr,
   TEMPLATE_VARIABLES[].description, LAND_CIRCLES[].label,
   FEELING_PHRASES (12), CARD_COLOR_NAMES, GMA_*_LABELS_FR (styles/moments),
   computeAC().source / computeSpeed().sources / damageTypeFr /
   unarmoredDefensesOf().label (moteur — phrases FR construites).
6. **PV/DD abréviations** : HP/DC — une clé partagée chacune.
7. **plural()** : ne marche qu'en français — remplacer les ~8 appels par
   des pluriels i18next.
8. **ErrorBoundary** : classe — 5 chaînes, passer par i18next.t global.
9. **Dates figées 'fr-FR'** : GmDashboardPage:569, ChroniclePage:24/31,
   CharacterNotesTab:284 → appLocale().
10. **« Sur moi »** (revue utilisateur) : toujours introuvable dans le code.

## Méthode
Agents : lecture intégrale, exclusion commentaires/===/CSS ; vérification
croisée catalogues (653 clés appelées, toutes résolues, interpolations
fr=en conformes — audit mécanique au même commit).
