// /api/fraud/report-refusal — le refus de livraison est un évènement primaire.
//
// La route exigeait une trace préalable (Claim ou ReturnSession) de la commande
// chez le vendeur signalant. Or un refus à la livraison arrive AVANT toute
// réclamation : le seul moyen de le signaler était d'ouvrir un litige fictif.
// La trace qualifie désormais le signalement au lieu d'y donner accès, et
// l'anti-empoisonnement repose sur l'imputabilité, l'idempotence et un quota.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockPrisma = {
  claim:         { findFirst: vi.fn() },
  returnSession: { findFirst: vi.fn() },
  refusalReport: { findUnique: vi.fn() },
}

const mockFraud = { reportRefusal: vi.fn() }
const mockRateLimit = { checkRateLimit: vi.fn() }

const keyRecord = { id: 'key-1', vendorId: 'vendor-1', vendor: { status: 'APPROVED' } }

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/fraud-score', () => mockFraud)
vi.mock('@/lib/rate-limit', () => mockRateLimit)
vi.mock('@/lib/api-key-auth', () => ({
  validateApiKey: vi.fn().mockResolvedValue({ ok: true, keyRecord }),
}))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

function requete(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/fraud/report-refusal', {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'flw_test' },
    body:    JSON.stringify(body),
  })
}

const corps = {
  customer_email: 'client@example.com',
  customer_phone: '0555112233',
  order_id:       'CMD-1',
  refusal_reason: 'Client absent',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.claim.findFirst.mockResolvedValue(null)
  mockPrisma.returnSession.findFirst.mockResolvedValue(null)
  mockPrisma.refusalReport.findUnique.mockResolvedValue(null)
  mockRateLimit.checkRateLimit.mockResolvedValue(true)
  mockFraud.reportRefusal.mockResolvedValue({
    alreadyReported: false, newFraudScore: 10, distinctVendors: 1, totalRefusals: 1,
  })
})

describe('POST /api/fraud/report-refusal', () => {
  it('accepte un refus sans réclamation ni session de retour préalable', async () => {
    const { POST } = await import('@/app/api/fraud/report-refusal/route')
    const res  = await POST(requete(corps))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.verified).toBe(false)
    expect(mockFraud.reportRefusal).toHaveBeenCalledWith(
      expect.objectContaining({ vendorId: 'vendor-1', orderId: 'CMD-1', claimId: undefined }),
    )
  })

  it('marque le signalement vérifié quand une trace existe', async () => {
    mockPrisma.claim.findFirst.mockResolvedValue({
      id: 'claim-1', customerEmail: 'client@example.com', customerPhone: '0555112233',
    })

    const { POST } = await import('@/app/api/fraud/report-refusal/route')
    const res  = await POST(requete(corps))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.verified).toBe(true)
    expect(mockRateLimit.checkRateLimit).not.toHaveBeenCalled()
    expect(mockFraud.reportRefusal).toHaveBeenCalledWith(
      expect.objectContaining({ claimId: 'claim-1' }),
    )
  })

  it('refuse un identifiant qui ne correspond pas à la commande tracée', async () => {
    mockPrisma.claim.findFirst.mockResolvedValue({
      id: 'claim-1', customerEmail: 'autre@example.com', customerPhone: null,
    })

    const { POST } = await import('@/app/api/fraud/report-refusal/route')
    const res = await POST(requete(corps))

    expect(res.status).toBe(422)
    expect(mockFraud.reportRefusal).not.toHaveBeenCalled()
  })

  it('plafonne les signalements non tracés par un quota vendeur', async () => {
    mockRateLimit.checkRateLimit.mockResolvedValue(false)

    const { POST } = await import('@/app/api/fraud/report-refusal/route')
    const res = await POST(requete(corps))

    expect(res.status).toBe(429)
    expect(mockRateLimit.checkRateLimit).toHaveBeenCalledWith(
      'refusal:vendor-1', expect.any(Number), expect.any(Number),
    )
    expect(mockFraud.reportRefusal).not.toHaveBeenCalled()
  })

  it('ne consomme pas le quota pour un rejeu de la même commande', async () => {
    mockPrisma.refusalReport.findUnique.mockResolvedValue({ id: 'report-1' })
    mockFraud.reportRefusal.mockResolvedValue({
      alreadyReported: true, newFraudScore: 10, distinctVendors: 1, totalRefusals: 1,
    })

    const { POST } = await import('@/app/api/fraud/report-refusal/route')
    const res  = await POST(requete(corps))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.alreadyReported).toBe(true)
    expect(mockRateLimit.checkRateLimit).not.toHaveBeenCalled()
  })

  it('exige order_id et un identifiant client', async () => {
    const { POST } = await import('@/app/api/fraud/report-refusal/route')

    const sansOrder = await POST(requete({ customer_email: 'a@b.com' }))
    expect(sansOrder.status).toBe(422)

    const sansClient = await POST(requete({ order_id: 'CMD-2' }))
    expect(sansClient.status).toBe(422)
  })
})
