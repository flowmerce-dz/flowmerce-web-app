// lib/form-dependencies.ts — Flowmerce
//
// Champs dépendants du formulaire de retour (`depends_on`), côté rendu.
//
// Logique pure, sans React ni import serveur : la page hébergée l'utilise pour
// afficher le formulaire, et tout moteur de rendu peut reproduire ces trois
// règles à partir du seul JSON de GET /api/v1/return-form :
//
//   1. un champ dépendant n'affiche que les options dont `parent` égale la
//      valeur courante de son champ parent — aucune tant que le parent est vide ;
//   2. quand le parent change, une valeur dépendante qui ne lui appartient plus
//      est effacée (en cascade, si un dépendant a lui-même des dépendants) ;
//   3. un champ `emphasized_by` est mis en avant quand l'option choisie dans le
//      champ désigné est une option « Autre » (`is_other`).
//
// Le serveur applique la même règle 1 à la soumission (validateDependency) :
// ces fonctions n'en sont que le reflet côté interface, jamais la garantie.

export interface DependencyOption {
  value:     string
  parent?:   string
  is_other?: boolean
}

export interface DependencyField {
  id:             string
  depends_on?:    string
  emphasized_by?: string
  options:        DependencyOption[]
}

export type AnswerValue = string | boolean

/** Options à afficher pour `field`, compte tenu des réponses courantes. */
export function visibleOptions<F extends DependencyField>(
  field:   F,
  answers: Record<string, AnswerValue | undefined>,
): F['options'] {
  if (!field.depends_on) return field.options
  const parentValue = answers[field.depends_on]
  if (typeof parentValue !== 'string' || parentValue === '') return []
  return field.options.filter(o => o.parent === parentValue)
}

/** Vrai si le champ dépendant attend encore que son parent soit renseigné. */
export function isAwaitingParent(
  field:   DependencyField,
  answers: Record<string, AnswerValue | undefined>,
): boolean {
  if (!field.depends_on) return false
  const parentValue = answers[field.depends_on]
  return typeof parentValue !== 'string' || parentValue === ''
}

/**
 * Nouvelles réponses après la saisie de `value` dans `fieldId`. Toute valeur
 * d'un champ dépendant qui n'appartient plus à son parent est retirée — c'est
 * ce qui empêche une sous-raison de « Produit défectueux » de survivre au
 * passage du motif à « Mauvaise taille ».
 */
export function applyAnswerChange(
  fields:  readonly DependencyField[],
  answers: Record<string, AnswerValue>,
  fieldId: string,
  value:   AnswerValue,
): Record<string, AnswerValue> {
  const next: Record<string, AnswerValue> = { ...answers, [fieldId]: value }

  // Cascade : on repasse tant qu'un effacement en provoque un autre. Le nombre
  // de passes est borné par le nombre de champs (pas de cycle possible au-delà).
  for (let pass = 0; pass < fields.length; pass++) {
    let changed = false
    for (const field of fields) {
      if (!field.depends_on || !(field.id in next)) continue
      const current = next[field.id]
      if (current === '' || current === undefined) continue
      const stillValid = visibleOptions(field, next).some(o => o.value === current)
      if (!stillValid) {
        delete next[field.id]
        changed = true
      }
    }
    if (!changed) break
  }

  return next
}

/** Vrai si `field` doit être mis en avant (option « Autre » choisie ailleurs). */
export function isEmphasized(
  field:   DependencyField,
  fields:  readonly DependencyField[],
  answers: Record<string, AnswerValue | undefined>,
): boolean {
  if (!field.emphasized_by) return false
  const source = fields.find(f => f.id === field.emphasized_by)
  if (!source) return false
  const chosen = answers[source.id]
  return source.options.some(o => o.value === chosen && o.is_other === true)
}
