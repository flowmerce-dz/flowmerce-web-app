import { describe, it, expect, vi } from 'vitest'
import {
  EXTERNAL_RETURN_REASONS,
  RETURN_REASONS,
  RETURN_REASON_DETAILS,
  findReturnReasonDetail,
  formatReturnReasonDetail,
  isReasonDetailOf,
  isReturnReason,
} from '@/lib/constants'
import {
  buildReturnForm,
  REASON_COMMENT_FIELD_ID,
  REASON_DETAIL_FIELD_ID,
  REASON_FIELD_ID,
  type ReturnForm,
} from '@/lib/services/return-form-builder'
import { validateReturnFormAnswers } from '@/lib/services/return-form-validation'
import {
  applyAnswerChange,
  isAwaitingParent,
  isEmphasized,
  visibleOptions,
} from '@/lib/form-dependencies'

vi.mock('@/lib/env', () => ({
  env: { ML_API_URL: 'https://ml.example.com', ML_INTERNAL_SECRET: 'test-secret-12345' },
}))

// ─────────────────────────────────────────────────────────────
// 1. Les 10 motifs principaux sont intouchables
// ─────────────────────────────────────────────────────────────
describe('motifs principaux', () => {
  it('conserve exactement les 10 motifs, dans le même ordre', () => {
    expect(RETURN_REASONS).toEqual([
      'Produit défectueux',
      'Produit contrefait',
      'Produit endommagé livraison',
      "Changement d'avis",
      'Panne après utilisation',
      'Mauvaise taille',
      'Allergie/Réaction',
      'Ne correspond pas',
      'Erreur de commande vendeur',
      'Pièces manquantes',
    ])
  })

  it('ne touche pas aux motifs externes des API partenaires', () => {
    expect(EXTERNAL_RETURN_REASONS).toEqual(['DEFECTIVE', 'WRONG_ITEM', 'DESCRIPTION', 'CHANGE_MIND'])
  })

  it('reconnaît un motif exact, et rien d’autre', () => {
    expect(isReturnReason('Mauvaise taille')).toBe(true)
    expect(isReturnReason('mauvaise taille')).toBe(false)
    expect(isReturnReason('TOO_SMALL')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// 2. Les sous-raisons
// ─────────────────────────────────────────────────────────────
describe('sous-raisons', () => {
  it('chaque motif a ses sous-raisons, dont une seule « Autre »', () => {
    for (const reason of RETURN_REASONS) {
      const details = RETURN_REASON_DETAILS[reason]
      expect(details.length).toBeGreaterThanOrEqual(2)
      const others = details.filter(d => d.isOther)
      expect(others).toHaveLength(1)
      expect(others[0].label).toBe('Autre')
    }
  })

  it('des codes uniques tous motifs confondus, distincts des valeurs des motifs', () => {
    const codes = RETURN_REASONS.flatMap(r => RETURN_REASON_DETAILS[r].map(d => d.code))
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/)
      expect(RETURN_REASONS as readonly string[]).not.toContain(code)
    }
  })

  it('reprend les sous-raisons demandées pour « Mauvaise taille »', () => {
    expect(RETURN_REASON_DETAILS['Mauvaise taille'].map(d => [d.code, d.label])).toEqual([
      ['TOO_SMALL',           'Trop petit'],
      ['TOO_LARGE',           'Trop grand'],
      ['SIZE_GUIDE_MISMATCH', 'Ne correspond pas au guide des tailles'],
      ['OTHER_SIZE',          'Autre'],
    ])
  })

  it('rattache chaque code à son motif', () => {
    expect(isReasonDetailOf('Mauvaise taille', 'TOO_SMALL')).toBe(true)
    expect(isReasonDetailOf('Mauvaise taille', 'NOT_WORKING')).toBe(false)
    expect(isReasonDetailOf('Produit défectueux', 'NOT_WORKING')).toBe(true)
    expect(isReasonDetailOf('Mauvaise taille', 'INCONNU')).toBe(false)
    expect(findReturnReasonDetail('TOO_SMALL')?.reason).toBe('Mauvaise taille')
    expect(formatReturnReasonDetail('TOO_SMALL')).toBe('Trop petit')
    expect(formatReturnReasonDetail(null)).toBeNull()
  })

  it("« Changement d'avis » et « Autre » ne désignent jamais un défaut du produit", () => {
    for (const d of RETURN_REASON_DETAILS["Changement d'avis"]) expect(d.productRelated).toBe(false)
    for (const reason of RETURN_REASONS) {
      for (const d of RETURN_REASON_DETAILS[reason]) {
        if (d.isOther) expect(d.productRelated).toBe(false)
      }
    }
    expect(findReturnReasonDetail('TOO_SMALL')?.detail.productRelated).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// 3. Le formulaire : motif, puis sous-raison dépendante, puis commentaire
// ─────────────────────────────────────────────────────────────
const vendor = { companyName: 'Caba Store', website: null }

function policy(acceptedReturnReasons: string[]) {
  return { acceptedReturnReasons, acceptedTypes: [] } as unknown as Parameters<typeof buildReturnForm>[1]
}

function reasonFields(form: ReturnForm) {
  const section = form.sections.find(s => s.id === 'reason')!
  const by = (id: string) => section.fields.find(f => f.id === id)!
  return { section, reason: by(REASON_FIELD_ID), detail: by(REASON_DETAIL_FIELD_ID), comment: by(REASON_COMMENT_FIELD_ID) }
}

describe('formulaire : champs du motif', () => {
  it('motif, puis « Précisez la raison », puis le commentaire, dans cet ordre', () => {
    const { section } = reasonFields(buildReturnForm(vendor, null))
    expect(section.fields.map(f => f.id)).toEqual(['reason', 'reason_detail', 'reason_comment'])
  })

  it('les options du motif restent les valeurs exactes de RETURN_REASONS', () => {
    const { reason } = reasonFields(buildReturnForm(vendor, null))
    expect(reason.options.map(o => o.value)).toEqual([...RETURN_REASONS])
  })

  it('la sous-raison est obligatoire, dépend du motif, et chaque option porte son parent', () => {
    const { detail } = reasonFields(buildReturnForm(vendor, null))
    expect(detail.label).toBe('Précisez la raison')
    expect(detail.type).toBe('select')
    expect(detail.required).toBe(true)
    expect(detail.depends_on).toBe('reason')
    for (const o of detail.options) expect(RETURN_REASONS as readonly string[]).toContain(o.parent)
    expect(detail.options.filter(o => o.is_other)).toHaveLength(RETURN_REASONS.length)
  })

  it('le commentaire est facultatif, borné, et mis en avant par « Autre »', () => {
    const { comment } = reasonFields(buildReturnForm(vendor, null))
    expect(comment.type).toBe('textarea')
    expect(comment.required).toBe(false)
    expect(comment.validation.maxLength).toBe(1000)
    expect(comment.emphasized_by).toBe('reason_detail')
  })

  it('respecte le filtrage des motifs par la politique, sous-raisons comprises', () => {
    const form = buildReturnForm(vendor, policy(['Mauvaise taille', 'Produit défectueux']))
    const { reason, detail } = reasonFields(form)
    // Ordre de RETURN_REASONS conservé, motifs non autorisés absents.
    expect(reason.options.map(o => o.value)).toEqual(['Produit défectueux', 'Mauvaise taille'])
    expect(new Set(detail.options.map(o => o.parent))).toEqual(new Set(['Produit défectueux', 'Mauvaise taille']))
    expect(detail.options.map(o => o.value)).not.toContain('NO_LONGER_WANTED')
  })

  it('une politique sans restriction propose tous les motifs', () => {
    const { reason } = reasonFields(buildReturnForm(vendor, policy([])))
    expect(reason.options).toHaveLength(RETURN_REASONS.length)
  })
})

// ─────────────────────────────────────────────────────────────
// 4. Validation serveur de la combinaison motif / sous-raison
// ─────────────────────────────────────────────────────────────
describe('validation serveur : motif et sous-raison', () => {
  const base = {
    order_id: 'CMD-1', customer_name: 'Ahmed', customer_email: 'a@b.dz',
    product_name: 'Nike Air', desired_resolution: 'EXCHANGE', data_consent: true,
  }
  const form = buildReturnForm(vendor, null)
  const check = (answers: Record<string, unknown>, f = form) =>
    validateReturnFormAnswers(f, { ...base, ...answers })

  it('accepte une sous-raison du motif choisi', () => {
    expect(check({ reason: 'Mauvaise taille', reason_detail: 'TOO_SMALL' })).toBeNull()
  })

  it("refuse une sous-raison qui appartient à un autre motif", () => {
    expect(check({ reason: 'Mauvaise taille', reason_detail: 'NOT_WORKING' }))
      .toMatch(/reason_detail.*n'appartient pas/)
  })

  it('refuse une sous-raison inconnue', () => {
    expect(check({ reason: 'Mauvaise taille', reason_detail: 'TOO_TIGHT' }))
      .toMatch(/Valeur invalide pour le champ reason_detail/)
  })

  it('exige la sous-raison', () => {
    expect(check({ reason: 'Mauvaise taille' })).toMatch(/Champ requis manquant : reason_detail/)
  })

  it('refuse un motif non autorisé par la politique, même avec une sous-raison cohérente', () => {
    const restricted = buildReturnForm(vendor, policy(['Produit défectueux']))
    expect(check({ reason: 'Mauvaise taille', reason_detail: 'TOO_SMALL' }, restricted))
      .toMatch(/Valeur invalide pour le champ reason$/)
  })

  it('valide la longueur et le contenu du commentaire', () => {
    const ok = { reason: 'Mauvaise taille', reason_detail: 'OTHER_SIZE' }
    expect(check({ ...ok, reason_comment: 'Taille 42 trop juste au cou-de-pied' })).toBeNull()
    expect(check({ ...ok, reason_comment: 'x'.repeat(1001) })).toMatch(/maximum 1000/)
    expect(check({ ...ok, reason_comment: '<script>alert(1)</script>' })).toMatch(/HTML/)
  })
})

// ─────────────────────────────────────────────────────────────
// 5. Comportement du formulaire dépendant (page hébergée)
// ─────────────────────────────────────────────────────────────
describe('formulaire dépendant : affichage et réinitialisation', () => {
  const form = buildReturnForm(vendor, null)
  const fields = form.sections.flatMap(s => s.fields)
  const { detail, comment } = reasonFields(form)

  it("n'affiche aucune sous-raison tant que le motif n'est pas choisi", () => {
    expect(visibleOptions(detail, {})).toEqual([])
    expect(isAwaitingParent(detail, {})).toBe(true)
  })

  it('affiche uniquement les sous-raisons du motif sélectionné', () => {
    const shown = visibleOptions(detail, { reason: 'Mauvaise taille' })
    expect(shown.map(o => o.label)).toEqual([
      'Trop petit', 'Trop grand', 'Ne correspond pas au guide des tailles', 'Autre',
    ])
    expect(isAwaitingParent(detail, { reason: 'Mauvaise taille' })).toBe(false)
  })

  it('remplace les sous-raisons affichées quand le motif change', () => {
    let answers = applyAnswerChange(fields, {}, 'reason', 'Mauvaise taille')
    expect(visibleOptions(detail, answers).map(o => o.value)).toContain('TOO_SMALL')
    answers = applyAnswerChange(fields, answers, 'reason', 'Produit défectueux')
    const values = visibleOptions(detail, answers).map(o => o.value)
    expect(values).toEqual(['NOT_WORKING', 'BROKEN_OR_DAMAGED', 'MANUFACTURING_DEFECT', 'OTHER_DEFECTIVE'])
    expect(values).not.toContain('TOO_SMALL')
  })

  it("réinitialise l'ancienne sous-raison quand le motif change", () => {
    let answers = applyAnswerChange(fields, {}, 'reason', 'Mauvaise taille')
    answers = applyAnswerChange(fields, answers, 'reason_detail', 'TOO_SMALL')
    expect(answers.reason_detail).toBe('TOO_SMALL')

    answers = applyAnswerChange(fields, answers, 'reason', 'Produit défectueux')
    expect(answers.reason).toBe('Produit défectueux')
    expect(answers).not.toHaveProperty('reason_detail')
  })

  it('garde la sous-raison quand on resélectionne le même motif', () => {
    let answers = applyAnswerChange(fields, {}, 'reason', 'Mauvaise taille')
    answers = applyAnswerChange(fields, answers, 'reason_detail', 'TOO_LARGE')
    answers = applyAnswerChange(fields, answers, 'reason', 'Mauvaise taille')
    expect(answers.reason_detail).toBe('TOO_LARGE')
  })

  it('ne touche pas aux autres réponses', () => {
    const answers = applyAnswerChange(fields, { description: 'Déjà saisi' }, 'reason', 'Mauvaise taille')
    expect(answers.description).toBe('Déjà saisi')
  })

  it('met le commentaire en avant quand « Autre » est choisi', () => {
    expect(isEmphasized(comment, fields, { reason: 'Mauvaise taille', reason_detail: 'TOO_SMALL' })).toBe(false)
    expect(isEmphasized(comment, fields, { reason: 'Mauvaise taille', reason_detail: 'OTHER_SIZE' })).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────
// 6. Compatibilité du payload ML
// ─────────────────────────────────────────────────────────────
describe('payload ML', () => {
  const base = {
    customerId: null, shopName: 'Caba Store', productCategory: 'Shoes',
    productPrice: 5000, productQuantity: 1, orderTotal: 5000,
    paymentMethod: 'Cash on Delivery', shippingMethod: 'Standard', shippingCost: 400,
    customerGender: 'Unknown', customerAge: 30, customerWilaya: 'Alger',
    daysToReturn: 3, returnWindowDays: 14,
  }

  it('transmet chaque motif principal tel quel dans Return_Reason', async () => {
    const { buildMLPayload } = await import('@/lib/services/ml')
    for (const reason of RETURN_REASONS) {
      expect(buildMLPayload({ ...base, reason }).Return_Reason).toBe(reason)
    }
  })

  it("n'ajoute aucune clé au contrat : la sous-raison n'y figure pas", async () => {
    const { buildMLPayload } = await import('@/lib/services/ml')
    const keys = Object.keys(buildMLPayload({ ...base, reason: 'Mauvaise taille' })).sort()
    // Le schéma /predict de Flowmerce-ML est en extra="forbid" : une clé de
    // plus ferait échouer toutes les prédictions.
    expect(keys).toEqual([
      'Customer_Age', 'Customer_Gender', 'Customer_ID', 'Customer_Past_Returns', 'Customer_Wilaya',
      'Days_to_Return', 'Fraud_Score', 'Is_Suspicious', 'Order_Quantity', 'Payment_Method',
      'Product_Category', 'Product_Price_DA', 'Return_Reason', 'Shipping_Cost_DA',
      'Shipping_Method', 'Shop_Name', 'Shop_Return_Window_Days', 'Total_Amount_DA',
      'Within_Return_Policy',
    ])
  })
})
