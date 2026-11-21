import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  NEW_CLAIM_TEMPLATE,
  CLAIM_DECISION_TEMPLATE,
  buildNewClaimParams,
  buildDecisionParams,
} from '@/lib/whatsapp/claim-templates'
import { RETURN_REASONS } from '@/lib/constants'

describe('modèles déclarés chez Meta', () => {
  it('nom et langue de chaque modèle', () => {
    expect(NEW_CLAIM_TEMPLATE).toEqual({ name: 'nouvelle_reclamation', language: 'en' })
    expect(CLAIM_DECISION_TEMPLATE).toEqual({ name: 'decision_reclamation', language: 'fr' })
  })
})

describe('buildNewClaimParams', () => {
  it('reproduit l’exemple enregistré chez Meta', () => {
    expect(
      buildNewClaimParams({ orderId: 'CMD-10234', customerName: 'Karim B', returnReason: 'Produit défectueux' }),
    ).toEqual([
      'CMD-10234', 'Karim B', 'منتج معيب',
      'CMD-10234', 'Karim B', 'Defective product',
      'CMD-10234', 'Karim B', 'Produit défectueux',
    ])
  })

  it.each(RETURN_REASONS)('traduit le motif « %s » en arabe et en anglais', (reason) => {
    const p = buildNewClaimParams({ orderId: 'O', customerName: 'N', returnReason: reason })
    expect(p).toHaveLength(9)
    expect(p[8]).toBe(reason)
    expect(p[2]).not.toBe(reason)
    expect(p[5]).not.toBe(reason)
    expect(p[2]).not.toBe('-')
    expect(p[5]).not.toBe('-')
  })

  it('envoie tel quel un motif hors liste, dans les trois langues', () => {
    const p = buildNewClaimParams({ orderId: 'O', customerName: 'N', returnReason: 'Autre chose' })
    expect([p[2], p[5], p[8]]).toEqual(['Autre chose', 'Autre chose', 'Autre chose'])
  })

  it('sans motif, retombe sur le type demandé', () => {
    const p = buildNewClaimParams({ orderId: 'O', customerName: 'N', returnReason: null, type: 'REPAIR' })
    expect([p[2], p[5], p[8]]).toEqual(['إصلاح', 'Repair', 'Réparation'])
  })

  it('sans motif ni type, envoie « non précisé »', () => {
    const p = buildNewClaimParams({ orderId: 'O', customerName: 'N' })
    expect([p[2], p[5], p[8]]).toEqual(['غير محدد', 'Not specified', 'Non précisé'])
  })

  it('nettoie chaque valeur', () => {
    const p = buildNewClaimParams({ orderId: ' CMD-1 ', customerName: 'Karim\n  B', returnReason: 'Mauvaise taille' })
    expect(p[0]).toBe('CMD-1')
    expect(p[1]).toBe('Karim B')
  })
})

describe('buildDecisionParams', () => {
  it('reproduit l’exemple enregistré chez Meta, avec le prénom seul', () => {
    expect(
      buildDecisionParams({ customerName: 'Karim Benali', orderId: 'CMD-10234', status: 'APPROVED', decision: 'Exchange' }),
    ).toEqual([
      'Karim', 'CMD-10234', 'استبدال',
      'Karim', 'CMD-10234', 'Exchange',
      'Karim', 'CMD-10234', 'Échange',
    ])
  })

  it.each([
    ['Repair', 'APPROVED', 'إصلاح',          'Repair',   'Réparation'],
    ['Refund', 'APPROVED', 'استرداد المبلغ', 'Refund',   'Remboursement'],
    ['Reject', 'REJECTED', 'مرفوض',          'Rejected', 'Refusée'],
  ] as const)('traduit la décision %s', (decision, status, ar, en, fr) => {
    const p = buildDecisionParams({ customerName: 'K', orderId: 'O', status, decision })
    expect([p[2], p[5], p[8]]).toEqual([ar, en, fr])
  })

  it('refus sans décision enregistrée', () => {
    const p = buildDecisionParams({ customerName: 'K', orderId: 'O', status: 'REJECTED', decision: null })
    expect([p[2], p[5], p[8]]).toEqual(['مرفوض', 'Rejected', 'Refusée'])
  })

  it('un refus est annoncé comme refus, même si la décision portée est une autre résolution', () => {
    // PATCH { status: 'REJECTED' } sans aiDecision : la route retombe sur la
    // recommandation du ML (ex. Exchange). Le client ne doit pas lire « Échange ».
    const p = buildDecisionParams({ customerName: 'K', orderId: 'O', status: 'REJECTED', decision: 'Exchange' })
    expect([p[2], p[5], p[8]]).toEqual(['مرفوض', 'Rejected', 'Refusée'])
  })

  it('une approbation portant « Reject » est annoncée comme acceptée', () => {
    const p = buildDecisionParams({ customerName: 'K', orderId: 'O', status: 'APPROVED', decision: 'Reject' })
    expect([p[2], p[5], p[8]]).toEqual(['مقبول', 'Approved', 'Acceptée'])
  })

  it('approbation sans décision enregistrée', () => {
    const p = buildDecisionParams({ customerName: 'K', orderId: 'O', status: 'APPROVED', decision: null })
    expect([p[2], p[5], p[8]]).toEqual(['مقبول', 'Approved', 'Acceptée'])
  })

  it('extrait le prénom d’un nom mal formaté', () => {
    const p = buildDecisionParams({ customerName: '  Karim\n', orderId: 'O', status: 'APPROVED' })
    expect([p[0], p[3], p[6]]).toEqual(['Karim', 'Karim', 'Karim'])
  })

  it('nom vide : un tiret plutôt qu’un paramètre vide', () => {
    const p = buildDecisionParams({ customerName: '   ', orderId: 'O', status: 'APPROVED' })
    expect(p[0]).toBe('-')
  })
})
