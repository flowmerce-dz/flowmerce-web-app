// Correction d'une décision rendue — administrateur seul (audit RedStone RS-01).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { checkAdminAmendment } from '@/lib/claim-transitions'

const mockPrisma = {
  $transaction:       vi.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
  claim:              { findUnique: vi.fn(), updateMany: vi.fn() },
  claimDecisionEvent: { create: vi.fn() },
  returnPolicy:       { findUnique: vi.fn() },
}
const mockNotify  = vi.fn().mockResolvedValue(undefined)
const mockSession = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/services/notification', () => ({ notifyCustomer: mockNotify }))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/getSession', () => ({ getSessionServer: () => mockSession() }))

const admin  = { user: { id: 'admin-1', role: 'ADMIN',  email: 'admin@example.com' } }
const vendor = { user: { id: 'user-1',  role: 'VENDOR', email: 'vendeur@example.com' } }

const approved = {
  id: 'claim-1', vendorId: 'vendor-1', status: 'APPROVED', aiDecision: 'Exchange', type: 'EXCHANGE',
  prediction: { recommendation: { resolution: 'Exchange' } }, policyRejected: false,
  customerName: 'Client', customerEmail: 'client@example.com', customerPhone: null, orderId: 'o-1',
}

const REASON = 'Produit reçu en parfait état, le refus était une erreur.'

function post(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/admin/claims/claim-1/amend', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}
const params = Promise.resolve({ claimId: 'claim-1' })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue(admin)
  mockPrisma.claim.findUnique.mockResolvedValue(approved)
  mockPrisma.claim.updateMany.mockResolvedValue({ count: 1 })
  mockPrisma.returnPolicy.findUnique.mockResolvedValue(null)
})

describe('checkAdminAmendment', () => {
  const base = { currentDecision: 'Exchange', requestedType: 'EXCHANGE' as const, acceptedTypes: null, reason: REASON }

  it('ne corrige qu’une décision rendue', () => {
    expect(checkAdminAmendment({ ...base, from: 'PENDING', decision: 'Repair' }))
      .toMatchObject({ ok: false, error: { code: 'CLAIM_NOT_DECIDED' } })
  })

  it('exige un motif suffisant', () => {
    expect(checkAdminAmendment({ ...base, from: 'APPROVED', decision: 'Reject', reason: ' court ' }))
      .toMatchObject({ ok: false, error: { code: 'AMENDMENT_REASON_REQUIRED' } })
  })

  it('refuse une correction qui ne change rien', () => {
    expect(checkAdminAmendment({ ...base, from: 'APPROVED', decision: 'Exchange' }))
      .toMatchObject({ ok: false, error: { code: 'AMENDMENT_NO_CHANGE' } })
  })

  it('déduit le statut de la résolution', () => {
    expect(checkAdminAmendment({ ...base, from: 'APPROVED', decision: 'Reject' })).toEqual({ ok: true, to: 'REJECTED' })
    expect(checkAdminAmendment({ ...base, from: 'REJECTED', currentDecision: 'Reject', decision: 'Repair' }))
      .toEqual({ ok: true, to: 'APPROVED' })
  })

  it('contrôle la résolution avec la politique du vendeur', () => {
    expect(checkAdminAmendment({ ...base, acceptedTypes: ['EXCHANGE'], from: 'APPROVED', decision: 'Refund' }))
      .toMatchObject({ ok: false, error: { code: 'RESOLUTION_NOT_ALLOWED' } })
  })
})

describe('POST /api/admin/claims/[claimId]/amend', () => {
  it('est refusée à un vendeur', async () => {
    mockSession.mockResolvedValue(vendor)
    const { POST } = await import('@/app/api/admin/claims/[claimId]/amend/route')
    const res = await POST(post({ aiDecision: 'Reject', reason: REASON }), { params })

    expect(res.status).toBe(403)
    expect(mockPrisma.claim.updateMany).not.toHaveBeenCalled()
  })

  it('corrige la décision, la trace dans l’historique et prévient le client', async () => {
    const { POST } = await import('@/app/api/admin/claims/[claimId]/amend/route')
    const res = await POST(post({ aiDecision: 'Reject', reason: REASON }), { params })

    expect(res.status).toBe(200)
    const call = mockPrisma.claim.updateMany.mock.calls[0][0]
    // Verrou optimiste sur le statut ET la résolution lus.
    expect(call.where).toEqual({ id: 'claim-1', status: 'APPROVED', aiDecision: 'Exchange' })
    expect(call.data).toMatchObject({
      status: 'REJECTED', aiDecision: 'Reject', resolutionSource: 'HUMAN',
      resolvedBy: 'admin@example.com', exportedToML: false,
    })
    expect(call.data.prediction.override).toMatchObject({ resolution: 'Reject', mlDecision: 'Exchange', note: REASON })

    expect(mockPrisma.claimDecisionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousStatus: 'APPROVED', newStatus: 'REJECTED',
        previousDecision: 'Exchange', newDecision: 'Reject',
        actorType: 'ADMIN', actor: 'admin@example.com', origin: 'admin_amendment', reason: REASON,
      }),
    })
    // Le motif est interne : il n'est pas envoyé au client.
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ status: 'REJECTED', aiDecision: 'Reject', note: null }))
  })

  it('peut corriger sans prévenir le client', async () => {
    const { POST } = await import('@/app/api/admin/claims/[claimId]/amend/route')
    await POST(post({ aiDecision: 'Repair', reason: REASON, notifyCustomer: false }), { params })

    expect(mockPrisma.claim.updateMany).toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('exige un motif', async () => {
    const { POST } = await import('@/app/api/admin/claims/[claimId]/amend/route')
    const res = await POST(post({ aiDecision: 'Reject' }), { params })

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('AMENDMENT_REASON_REQUIRED')
    expect(mockPrisma.claim.updateMany).not.toHaveBeenCalled()
  })

  it('ne corrige pas un refus d’office par la politique', async () => {
    mockPrisma.claim.findUnique.mockResolvedValue({ ...approved, status: 'REJECTED', aiDecision: 'Reject', policyRejected: true })
    const { POST } = await import('@/app/api/admin/claims/[claimId]/amend/route')
    const res = await POST(post({ aiDecision: 'Exchange', reason: REASON }), { params })

    expect(res.status).toBe(409)
    expect(mockPrisma.claim.updateMany).not.toHaveBeenCalled()
  })

  it('n’écrase pas une modification concurrente', async () => {
    mockPrisma.claim.updateMany.mockResolvedValue({ count: 0 })
    const { POST } = await import('@/app/api/admin/claims/[claimId]/amend/route')
    const res = await POST(post({ aiDecision: 'Reject', reason: REASON }), { params })

    expect(res.status).toBe(409)
    expect(mockPrisma.claimDecisionEvent.create).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })
})
