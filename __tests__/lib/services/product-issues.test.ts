import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CustomerFraudRecord } from '@prisma/client'

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { claim: { findMany: mockFindMany } } }))

import {
  aggregateProductReturns,
  customerIdentities,
  detectProductIssues,
  explainCustomerPastReturns,
  explainReturns,
  getProductReturnAnalytics,
  lastMonths,
  productKey,
  recommendationFor,
  type AnalyticsClaim,
  type ProductReturn,
} from '@/lib/services/product-issues'
import { computeAdjustedFraudScore, computeFraudScore } from '@/lib/fraud-score'

beforeEach(() => {
  vi.clearAllMocks()
})

// Fabrique de retours : `n` clients différents (ou le même, avec sameCustomer).
// Acceptés par défaut : c'est le cas où ils comptent comme preuve.
let seq = 0
function returns(
  n: number,
  reasonDetail: string | null,
  opts: {
    product?: string; reason?: string | null; sameCustomer?: string; vendorId?: string
    phone?: string | null; status?: string
  } = {},
) {
  return Array.from({ length: n }, () => {
    seq++
    return {
      id:                 `c${seq}`,
      vendorId:           opts.vendorId ?? 'v1',
      status:             opts.status ?? 'APPROVED',
      productKey:         opts.product ?? 'id:NIKE-AIR',
      productName:        'Chaussures Nike Air',
      returnReason:       opts.reason === undefined ? 'Mauvaise taille' : opts.reason,
      returnReasonDetail: reasonDetail,
      customerEmail:      opts.sameCustomer ?? `client${seq}@exemple.dz`,
      customerPhone:      opts.phone ?? null,
      createdAt:          new Date('2026-11-05T10:00:00Z'),
    }
  })
}

const asReturn = (c: ReturnType<typeof returns>[number]): ProductReturn => ({
  claimId:      c.id,
  productKey:   c.productKey,
  reason:       c.returnReason,
  reasonDetail: c.returnReasonDetail,
  identities:   customerIdentities(c.customerEmail, c.customerPhone),
  status:       c.status,
  createdAt:    c.createdAt,
})

// ─────────────────────────────────────────────────────────────
describe('clés de regroupement', () => {
  it("privilégie l'identifiant produit, sinon le nom normalisé", () => {
    expect(productKey('SKU-1', 'Nike')).toBe('id:SKU-1')
    expect(productKey(null, '  Nike   AIR ')).toBe('name:nike air')
    expect(productKey('  ', 'Nike')).toBe('name:nike')
    expect(productKey(null, '   ')).toBeNull()
  })

  it('identifie un client par son e-mail ET son téléphone', () => {
    expect(customerIdentities(' A@B.DZ ', '0555')).toEqual(['email:a@b.dz', 'phone:0555'])
    expect(customerIdentities(null, '0555')).toEqual(['phone:0555'])
    expect(customerIdentities(null, null)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
describe('détection des problèmes collectifs', () => {
  it("détecte « Trop petit » signalé par 14 clients sur 20 retours (confiance haute)", () => {
    const rs = [...returns(14, 'TOO_SMALL'), ...returns(6, 'TOO_LARGE')].map(asReturn)
    const issues = detectProductIssues(rs)
    const tooSmall = issues.find(i => i.reasonDetail === 'TOO_SMALL')!
    expect(tooSmall).toMatchObject({
      reason: 'Mauvaise taille', returns: 14, distinctCustomers: 14, productReturns: 20, confidence: 'high',
    })
    expect(tooSmall.share).toBeCloseTo(0.7)
  })

  it('retient une confiance moyenne entre les deux seuils', () => {
    const rs = [...returns(3, 'TOO_SMALL'), ...returns(5, 'NOT_WORKING', { reason: 'Produit défectueux' })].map(asReturn)
    const issue = detectProductIssues(rs).find(i => i.reasonDetail === 'TOO_SMALL')!
    expect(issue.confidence).toBe('medium')   // 3 clients, 37,5 %
  })

  it("ne confond pas plusieurs retours d'un même client avec plusieurs clients", () => {
    const rs = returns(10, 'TOO_SMALL', { sameCustomer: 'fraudeur@exemple.dz' }).map(asReturn)
    expect(detectProductIssues(rs)).toEqual([])
  })

  it('ignore une sous-raison trop minoritaire parmi les retours du produit', () => {
    const rs = [...returns(3, 'TOO_SMALL'), ...returns(17, 'NOT_WORKING', { reason: 'Produit défectueux' })].map(asReturn)
    expect(detectProductIssues(rs).map(i => i.reasonDetail)).toEqual(['NOT_WORKING'])
  })

  it("n'en fait jamais un problème produit pour « Changement d'avis » ou « Autre »", () => {
    const rs = [
      ...returns(8, 'NO_LONGER_WANTED', { reason: "Changement d'avis" }),
      ...returns(8, 'OTHER_SIZE'),
    ].map(asReturn)
    expect(detectProductIssues(rs)).toEqual([])
  })

  it('ne mélange pas deux produits', () => {
    const rs = [
      ...returns(2, 'TOO_SMALL', { product: 'id:A' }),
      ...returns(2, 'TOO_SMALL', { product: 'id:B' }),
    ].map(asReturn)
    expect(detectProductIssues(rs)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
describe('analyse des retours produits', () => {
  const now = new Date('2026-11-13T12:00:00Z')

  function dataset(): AnalyticsClaim[] {
    return [
      ...returns(15, 'TOO_SMALL'),
      ...returns(3, 'TOO_LARGE'),
      ...returns(2, 'SIZE_GUIDE_MISMATCH'),
      ...returns(3, 'DIFFERENT_FROM_LISTING', { reason: 'Ne correspond pas' }),
      ...returns(1, null, { reason: null }),
      ...returns(2, 'NOT_WORKING', { product: 'id:CASQUE', reason: 'Produit défectueux' }),
    ]
  }

  it('classe les produits par nombre de retours et compte les clients distincts', () => {
    const a = aggregateProductReturns(dataset(), now)
    expect(a.totalReturns).toBe(26)
    expect(a.products.map(p => [p.productKey, p.returns, p.distinctCustomers])).toEqual([
      ['id:NIKE-AIR', 24, 24],
      ['id:CASQUE', 2, 2],
    ])
  })

  it('répartit motifs et sous-raisons en part des retours du produit', () => {
    const nike = aggregateProductReturns(dataset(), now).products[0]
    expect(nike.productName).toBe('Chaussures Nike Air')
    expect(nike.reasons.map(r => [r.reason, r.count])).toEqual([
      ['Mauvaise taille', 20],
      ['Ne correspond pas', 3],
    ])
    expect(nike.unknownReason).toBe(1)
    expect(nike.reasons[0].share).toBeCloseTo(20 / 24)
    expect(nike.reasons[0].details.map(d => [d.code, d.count])).toEqual([
      ['TOO_SMALL', 15], ['TOO_LARGE', 3], ['SIZE_GUIDE_MISMATCH', 2],
    ])
    expect(nike.reasons[0].details[0].share).toBeCloseTo(15 / 24)
    expect(nike.topReason?.reason).toBe('Mauvaise taille')
    expect(nike.topDetail).toMatchObject({ code: 'TOO_SMALL', label: 'Trop petit', count: 15 })
  })

  it('compte à part les anciens retours sans sous-raison', () => {
    const claims = [...returns(2, 'TOO_SMALL'), ...returns(3, null)]
    const r = aggregateProductReturns(claims, now).products[0].reasons[0]
    expect(r.count).toBe(5)
    expect(r.withoutDetail).toBe(3)
    expect(r.details.map(d => d.count)).toEqual([2])
  })

  it("suit l'évolution mensuelle sur les 6 derniers mois", () => {
    expect(lastMonths(now)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
    const claims = [
      ...returns(2, 'TOO_SMALL').map(c => ({ ...c, createdAt: new Date('2026-09-10T00:00:00Z') })),
      ...returns(3, 'TOO_SMALL'),
    ]
    const monthly = aggregateProductReturns(claims, now).products[0].monthly
    expect(monthly.find(m => m.month === '2026-09')?.count).toBe(2)
    expect(monthly.find(m => m.month === '2026-11')?.count).toBe(3)
    expect(monthly.reduce((s, m) => s + m.count, 0)).toBe(5)
  })

  it('formule une recommandation à partir des chiffres réels', () => {
    const nike = aggregateProductReturns(dataset(), now).products[0]
    expect(nike.recommendations[0]).toBe(
      '15 clients différents signalent « Trop petit » (63 % des retours de ce produit). '
      + 'Nous recommandons de vérifier le guide des tailles et d’envisager de conseiller une taille au-dessus.',
    )
    // Aucun « taux de retour » : Flowmerce ne connaît pas les ventes.
    expect(nike.recommendations.join(' ')).not.toMatch(/taux|commandes livrées|ventes/i)
  })

  it('ne recommande rien sans problème collectif', () => {
    const claims = returns(2, 'TOO_SMALL')
    expect(aggregateProductReturns(claims, now).products[0].recommendations).toEqual([])
  })

  it('recommandation générique par motif quand la sous-raison n’a pas de conseil dédié', () => {
    const rs = returns(4, 'MISSING_ACCESSORY', { reason: 'Pièces manquantes' }).map(asReturn)
    expect(recommendationFor(detectProductIssues(rs)[0])).toMatch(/contenu des colis/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('isolation entre boutiques', () => {
  it("l'analyse ne lit que les réclamations du vendeur de la session", async () => {
    mockFindMany.mockResolvedValue([])
    await getProductReturnAnalytics('vendor-A')
    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(mockFindMany.mock.calls[0][0].where).toEqual({ vendorId: 'vendor-A', policyRejected: false })
  })

  it('un même produit chez deux vendeurs ne forme pas un problème commun', () => {
    // 2 clients chez A + 2 chez B : sous le seuil dans chaque boutique.
    const claims = [
      ...returns(2, 'TOO_SMALL', { vendorId: 'A', product: 'name:nike air' }),
      ...returns(2, 'TOO_SMALL', { vendorId: 'B', product: 'name:nike air' }),
    ]
    const customer = claims[0]
    expect(explainReturns([customer], claims).explained).toEqual([])
  })

  it('les problèmes sont détectés boutique par boutique', () => {
    const shopA = returns(4, 'TOO_SMALL', { vendorId: 'A' })
    const shopB = returns(1, 'TOO_SMALL', { vendorId: 'B' })
    const all = [...shopA, ...shopB]
    expect(explainReturns([shopA[0]], all).explained).toHaveLength(1)
    expect(explainReturns([shopB[0]], all).explained).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
describe('correction du score de fraude', () => {
  const record = (over: Partial<CustomerFraudRecord> = {}): CustomerFraudRecord => ({
    id: 'r', customerEmail: 'c@x.dz', customerPhone: null,
    totalClaims: 4, totalRefusals: 0, distinctVendors: 1,
    lastClaimAt: null, lastRefusalAt: null, matchedBy: 'email',
    createdAt: new Date(), updatedAt: new Date(), ...over,
  })

  it('explique les retours du client liés à un problème collectif', () => {
    const product = [...returns(6, 'TOO_SMALL'), ...returns(2, 'TOO_LARGE')]
    const customer = product[0]
    const e = explainReturns([customer], product)
    expect(e.explained).toEqual([expect.objectContaining({ claimId: customer.id, confidence: 'high', discount: 1 })])
    expect(e.discount).toBe(1)
  })

  it('compte à moitié un retour expliqué avec une confiance moyenne', () => {
    // 4 « Trop petit » dont celui du client : 3 AUTRES clients, 3/8 = 37,5 %.
    const product = [...returns(4, 'TOO_SMALL'), ...returns(5, 'NOT_WORKING', { reason: 'Produit défectueux' })]
    expect(explainReturns([product[0]], product).discount).toBe(0.5)
  })

  it("n'explique pas un retour sans lien avec le problème détecté", () => {
    const product = [...returns(6, 'TOO_SMALL'), ...returns(2, 'TOO_LARGE')]
    const unrelated = product[product.length - 1]   // TOO_LARGE : minoritaire
    expect(explainReturns([unrelated], product).explained).toEqual([])
  })

  it('neutralise la contribution des retours expliqués, et elle seule', () => {
    const r = record({ totalClaims: 4, totalRefusals: 2, distinctVendors: 3 })
    // brut : 4×5 + 2×10 + (3-1)×15 = 20 + 20 + 30 = 70
    expect(computeFraudScore(r)).toBe(70)
    const adj = computeAdjustedFraudScore(r, 3)
    expect(adj).toEqual({ rawScore: 70, adjustedScore: 55, pastReturns: 4, adjustedPastReturns: 1 })
  })

  it("ne fait pas baisser les autres signaux de fraude, même tout expliqué", () => {
    const adj = computeAdjustedFraudScore(record({ totalClaims: 2, totalRefusals: 3, distinctVendors: 2 }), 10)
    expect(adj.adjustedPastReturns).toBe(0)
    expect(adj.adjustedScore).toBe(30 + 15)   // refus + réseau intacts
  })

  it('sans retour expliqué, le score reste exactement le score brut', () => {
    const r = record()
    expect(computeAdjustedFraudScore(r, 0)).toEqual({
      rawScore: computeFraudScore(r), adjustedScore: computeFraudScore(r), pastReturns: 4, adjustedPastReturns: 4,
    })
    expect(computeAdjustedFraudScore(null, 2).adjustedScore).toBe(0)
  })

  it("ignore une remise invalide plutôt que d'inventer un score", () => {
    expect(computeAdjustedFraudScore(record(), Number.NaN).adjustedScore).toBe(20)
    expect(computeAdjustedFraudScore(record(), -3).adjustedScore).toBe(20)
  })

  it("lecture en base : cherche par identité du client, puis les retours des produits concernés", async () => {
    const product = [...returns(5, 'TOO_SMALL'), ...returns(1, 'TOO_LARGE')]
    const own = product[0]
    mockFindMany
      .mockResolvedValueOnce([own])
      .mockResolvedValueOnce(product)

    const e = await explainCustomerPastReturns(own.customerEmail, '0555')
    expect(e.explained.map(x => x.claimId)).toEqual([own.id])

    const first = mockFindMany.mock.calls[0][0].where
    expect(first.OR).toEqual([{ customerEmail: own.customerEmail }, { customerPhone: '0555' }])
    expect(first.policyRejected).toBe(false)
    const second = mockFindMany.mock.calls[1][0].where
    expect(second.OR).toEqual([{ vendorId: 'v1', productKey: 'id:NIKE-AIR' }])
  })

  it('lecture en base : les produits sont relus quel que soit le statut, pour relier les identités', async () => {
    const product = returns(4, 'TOO_SMALL')
    mockFindMany.mockResolvedValueOnce([product[0]]).mockResolvedValueOnce(product)
    await explainCustomerPastReturns(product[0].customerEmail, null)
    expect(mockFindMany.mock.calls[1][0].where).not.toHaveProperty('status')
  })

  it("sans identité client, aucune lecture et aucun ajustement", async () => {
    expect(await explainCustomerPastReturns(null, null)).toEqual({ discount: 0, explained: [] })
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
// Garde-fous anti-manipulation (revue de sécurité)
// ─────────────────────────────────────────────────────────────
describe("anti-manipulation : un client ne peut pas s'excuser lui-même", () => {
  it('fusionne en un seul client des e-mails différents partageant un téléphone', () => {
    // 5 « clients » qui sont un seul fraudeur : même téléphone, e-mails jetables.
    const rs = returns(5, 'TOO_SMALL', { phone: '0555000000' }).map(asReturn)
    expect(detectProductIssues(rs)).toEqual([])
    const analytics = aggregateProductReturns(returns(5, 'TOO_SMALL', { phone: '0555000000' }))
    expect(analytics.distinctCustomers).toBe(1)
  })

  it('relie les identités de proche en proche (téléphone puis e-mail)', () => {
    const [a] = returns(1, 'TOO_SMALL', { sameCustomer: 'a@x.dz', phone: '0551' })
    const [b] = returns(1, 'TOO_SMALL', { sameCustomer: 'b@x.dz', phone: '0551' })
    const [c] = returns(1, 'TOO_SMALL', { sameCustomer: 'b@x.dz', phone: '0552' })
    expect(aggregateProductReturns([a, b, c]).distinctCustomers).toBe(1)
  })

  it("n'utilise jamais les comptes liés au client comme preuve de son propre problème", () => {
    // Le fraudeur : son retour, plus 3 comptes jetables liés par son téléphone.
    // Deux vrais clients seulement : sous le seuil de 3 clients indépendants.
    const own    = returns(1, 'TOO_SMALL', { sameCustomer: 'fraudeur@x.dz', phone: '0559' })
    const sock   = returns(3, 'TOO_SMALL', { phone: '0559' })
    const honest = returns(2, 'TOO_SMALL')
    expect(explainReturns(own, [...own, ...sock, ...honest]).explained).toEqual([])
  })

  it('exclut une identité liée même par une réclamation qui ne compte pas comme preuve', () => {
    const own   = returns(1, 'TOO_SMALL', { sameCustomer: 'f@x.dz', phone: '0559' })
    // Le lien f ↔ g passe par une demande en attente (téléphone 0559)…
    const link  = returns(1, 'TOO_SMALL', { sameCustomer: 'g@x.dz', phone: '0559', status: 'PENDING' })
    // …et g signe ensuite des retours acceptés sous un autre téléphone.
    const sock  = returns(2, 'TOO_SMALL', { sameCustomer: 'g@x.dz', phone: '0777' })
    const honest = returns(2, 'TOO_SMALL')
    expect(explainReturns(own, [...own, ...link, ...sock, ...honest]).explained).toEqual([])
  })

  it('ne retient comme preuve que des réclamations acceptées par le marchand', () => {
    const own     = returns(1, 'TOO_SMALL')
    const pending = returns(4, 'TOO_SMALL', { status: 'PENDING' })
    const refused = returns(4, 'TOO_SMALL', { status: 'REJECTED' })
    expect(explainReturns(own, [...own, ...pending, ...refused]).explained).toEqual([])

    const accepted = returns(3, 'TOO_SMALL', { status: 'IN_PROGRESS' })
    expect(explainReturns(own, [...own, ...pending, ...accepted]).explained).toHaveLength(1)
  })

  it("n'excuse jamais un retour du client que le marchand a refusé", () => {
    const own    = returns(1, 'TOO_SMALL', { status: 'REJECTED' })
    const others = returns(6, 'TOO_SMALL')
    expect(explainReturns(own, [...own, ...others]).explained).toEqual([])
  })

  it("exclut aussi les identités portées par d'anciennes réclamations du client", () => {
    // Le client évalué a utilisé autrefois un autre e-mail avec son téléphone :
    // les retours signés de cet ancien e-mail sont aussi les siens.
    const own    = returns(1, 'TOO_SMALL', { sameCustomer: 'nouveau@x.dz', phone: '0559' })
    const older  = returns(1, 'TOO_SMALL', { sameCustomer: 'ancien@x.dz',  phone: '0559' })
    const asOld  = returns(2, 'TOO_SMALL', { sameCustomer: 'ancien@x.dz' })
    const honest = returns(2, 'TOO_SMALL')
    expect(explainReturns([...own, ...older], [...own, ...asOld, ...honest]).explained).toEqual([])
  })
})
