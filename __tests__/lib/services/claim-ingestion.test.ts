import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFraudRecord = {
  id: 'fraud-1',
  customerEmail: 'client@example.com',
  customerPhone: null,
  totalClaims: 0,
  totalRefusals: 0,
  distinctVendors: 1,
  lastClaimAt: null,
  lastRefusalAt: null,
  matchedBy: 'email',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockClaim = {
  id: 'claim-1',
  vendorId: 'vendor-1',
  orderId: 'order-1',
  customerName: 'Client Test',
  customerEmail: 'client@example.com',
  customerPhone: null,
  productName: 'Produit Test',
  type: 'EXCHANGE',
  status: 'PENDING',
  fraudScore: 0,
  aiDecision: null,
  aiScore: null,
  mlFailed: false,
  mlAttempts: 0,
  prediction: {},
  mlInput: null,
  source: 'API',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockPolicyData = {
  id: 'policy-1',
  vendorId: 'vendor-1',
  maxClaimDays: 14,
  acceptedTypes: ['EXCHANGE', 'REFUND', 'REPAIR'],
  validationMode: 'MANUAL' as const,
  nonRefundableCategories: [],
  exchangeOnlyCategories: [],
  acceptedReturnReasons: [],
  fraudScoreThreshold: 70,
  fraudReturnThreshold: 4,
  allowRefusalOnDelivery: false,
  partialRefundEnabled: false,
  partialRefundRules: null,
  processingDays: 5,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const baseInput = {
  vendor: { id: 'vendor-1', companyName: 'Ma Boutique' },
  orderId: 'order-1',
  customerName: 'Client Test',
  customerEmail: 'client@example.com',
  customerPhone: null,
  productName: 'Produit Test',
  description: 'Description',
  type: 'EXCHANGE' as const,
  source: 'API' as const,
  prediction: {},
}

const mockPrisma = {
  $transaction: vi.fn(),
  claim: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    // Transition de statut conditionnelle : `applyMLDecision` n'écrit le statut
    // que si la réclamation est encore PENDING (idempotence de la reprise).
    updateMany: vi.fn(),
  },
  customerFraudRecord: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  returnPolicy: {
    findUnique: vi.fn(),
  },
  apiKey: {
    update: vi.fn(),
  },
}

const mockFraudScore = {
  findOrCreateFraudRecord: vi.fn(),
  computeFraudScore: vi.fn(),
  recomputeNetworkSignals: vi.fn().mockResolvedValue(undefined),
  // Sans retour expliqué (discount 0), le score ajusté est le score brut : on
  // délègue au `computeFraudScore` simulé pour que les tests existants gardent
  // leur sens. Les cas d'ajustement sont couverts plus bas.
  computeAdjustedFraudScore: vi.fn((record: { totalClaims: number }, discount: number) => {
    const raw = mockFraudScore.computeFraudScore(record) as number
    return {
      rawScore:            raw,
      adjustedScore:       discount > 0 ? Math.max(raw - discount * 5, 0) : raw,
      pastReturns:         record.totalClaims,
      adjustedPastReturns: Math.max(record.totalClaims - discount, 0),
    }
  }),
}

const mockExplain = vi.fn()

const mockML = {
  callMLPredict: vi.fn(),
}

const mockReturnPolicy = {
  checkReturnPolicy: vi.fn(),
}

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/fraud-score', () => mockFraudScore)
vi.mock('@/lib/services/product-issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/product-issues')>()),
  explainCustomerPastReturns: (...args: unknown[]) => mockExplain(...args),
}))
vi.mock('@/lib/services/ml', () => mockML)
vi.mock('@/lib/services/return-policy', () => mockReturnPolicy)
vi.mock('@/lib/services/notification', () => ({ notifyCustomer: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

describe('ingestClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Par défaut, la transition de statut aboutit : la réclamation était bien
    // encore PENDING. Les tests d'idempotence renvoient explicitement count: 0.
    mockPrisma.claim.updateMany.mockResolvedValue({ count: 1 })
    mockExplain.mockResolvedValue({ discount: 0, explained: [] })
  })

  it('crée un claim basique sans payload ML', async () => {
    mockFraudScore.findOrCreateFraudRecord.mockResolvedValue({ record: mockFraudRecord, matchedBy: 'email' })
    mockFraudScore.computeFraudScore.mockReturnValue(0)

    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        claim: {
          updateMany: mockPrisma.claim.updateMany,
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(mockClaim),
        },
        customerFraudRecord: { update: vi.fn() },
        claimDecisionEvent: { create: vi.fn() },
      }
      return cb(tx)
    })

    const { ingestClaim } = await import('@/lib/services/claim-ingestion')
    const result = await ingestClaim(baseInput)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.claim.status).toBe('PENDING')
      expect(result.claim.aiDecision).toBeNull()
      expect(result.claim.autoApproved).toBe(false)
      expect(result.claim.autoRejected).toBe(false)
    }
  })

  it('détecte un doublon via (vendorId, orderId)', async () => {
    mockFraudScore.findOrCreateFraudRecord.mockResolvedValue({ record: mockFraudRecord, matchedBy: 'email' })
    mockFraudScore.computeFraudScore.mockReturnValue(0)

    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        claim: {
          updateMany: mockPrisma.claim.updateMany,
          findFirst: vi.fn().mockResolvedValue({ id: 'existing-claim' }),
          create: vi.fn(),
        },
        customerFraudRecord: { update: vi.fn() },
        claimDecisionEvent: { create: vi.fn() },
      }
      return cb(tx)
    })

    const { ingestClaim } = await import('@/lib/services/claim-ingestion')
    const result = await ingestClaim(baseInput)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('DUPLICATE_CLAIM')
    }
  })

  describe('avec payload ML', () => {
    beforeEach(() => {
      mockFraudScore.findOrCreateFraudRecord.mockResolvedValue({ record: mockFraudRecord, matchedBy: 'email' })
      mockFraudScore.computeFraudScore.mockReturnValue(0)

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          claim: {
          updateMany: mockPrisma.claim.updateMany,
            findFirst: vi.fn().mockResolvedValue(null),
            // La claim créée reflète les données envoyées — notamment `type`,
            // que la décision relit depuis la ligne persistée (et non depuis
            // l'input) pour partager exactement le même code que la reprise.
            create: vi.fn().mockImplementation(async ({ data }: any) => ({
              ...mockClaim,
              ...data,
            })),
          },
          customerFraudRecord: { update: vi.fn() },
        claimDecisionEvent: { create: vi.fn() },
        }
        return cb(tx)
      })
    })

    it('auto-approuve si ML dit Exchange/Repair et validationMode=AI_AUTO', async () => {
      mockPrisma.returnPolicy.findUnique.mockResolvedValue({ ...mockPolicyData, validationMode: 'AI_AUTO' })
      mockML.callMLPredict.mockResolvedValue({
        ok: true,
        prediction: {
          resolution: {
            prediction: 'Exchange',
            probabilities: { Exchange: 0.9, Repair: 0.1, Reject: 0 },
          },
        },
      })
      mockPrisma.claim.update.mockResolvedValue({ ...mockClaim, status: 'APPROVED', aiDecision: 'Exchange' })

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      const result = await ingestClaim({ ...baseInput, mlPayload: { some: 'data' } })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.claim.autoApproved).toBe(true)
        expect(result.claim.status).toBe('APPROVED')
      }
    })

    it("n'auto-approuve JAMAIS un remboursement (type=REFUND), même en AI_AUTO", async () => {
      mockPrisma.returnPolicy.findUnique.mockResolvedValue({ ...mockPolicyData, validationMode: 'AI_AUTO' })
      mockReturnPolicy.checkReturnPolicy.mockReturnValue({ ok: true, forceExchange: false })
      mockML.callMLPredict.mockResolvedValue({
        ok: true,
        prediction: {
          resolution: {
            prediction: 'Repair',
            probabilities: { Repair: 0.8, Exchange: 0.2, Reject: 0 },
          },
        },
      })
      mockPrisma.claim.update.mockResolvedValue({ ...mockClaim, status: 'PENDING', aiDecision: 'Repair' })

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      const result = await ingestClaim({ ...baseInput, type: 'REFUND', mlPayload: { some: 'data' } })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.claim.status).toBe('PENDING')
        expect(result.claim.aiDecision).toBe('Repair')
        expect(result.claim.autoApproved).toBe(false)
        expect(result.claim.autoRejected).toBe(false)
        expect(mockPrisma.claim.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ aiDecision: 'Repair' }) }),
        )
      }
    })

    it('auto-rejette un ref (REFUND) si ML prédit Reject', async () => {
      mockPrisma.returnPolicy.findUnique.mockResolvedValue({ ...mockPolicyData, validationMode: 'AI_AUTO' })
      mockML.callMLPredict.mockResolvedValue({
        ok: true,
        prediction: {
          resolution: {
            prediction: 'Reject',
            probabilities: { Reject: 0.95, Exchange: 0.05, Repair: 0 },
          },
        },
      })
      mockPrisma.claim.update.mockResolvedValue({ ...mockClaim, status: 'REJECTED', aiDecision: 'Reject' })

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      const result = await ingestClaim({ ...baseInput, type: 'REFUND', mlPayload: { some: 'data' } })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.claim.status).toBe('REJECTED')
        expect(result.claim.autoRejected).toBe(true)
        expect(result.claim.aiDecision).toBe('Reject')
      }
    })

    it('auto-rejette si ML prédit Reject', async () => {
      mockPrisma.returnPolicy.findUnique.mockResolvedValue(mockPolicyData)
      mockML.callMLPredict.mockResolvedValue({
        ok: true,
        prediction: {
          resolution: {
            prediction: 'Reject',
            probabilities: { Reject: 0.95, Exchange: 0.05, Repair: 0 },
          },
        },
      })
      mockPrisma.claim.update.mockResolvedValue({ ...mockClaim, status: 'REJECTED', aiDecision: 'Reject' })

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      const result = await ingestClaim({ ...baseInput, mlPayload: { some: 'data' } })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.claim.autoRejected).toBe(true)
        expect(result.claim.status).toBe('REJECTED')
        expect(result.claim.aiDecision).toBe('Reject')
      }
    })

    it('marque mlFailed si le ML échoue', async () => {
      mockPrisma.returnPolicy.findUnique.mockResolvedValue(mockPolicyData)
      mockML.callMLPredict.mockResolvedValue({
        ok: false,
        timedOut: true,
        error: 'Request timed out',
        retryable: true,
        attempts: 3,
      })

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      const result = await ingestClaim({ ...baseInput, mlPayload: { some: 'data' } })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.claim.aiDecision).toBeNull()
        expect(result.claim.autoApproved).toBe(false)
        expect(result.claim.autoRejected).toBe(false)
      }
    })
  })

  describe('motif, produit et ajustement du score', () => {
    // Capture du `data` passé à claim.create dans la transaction.
    let created: Record<string, any>

    beforeEach(() => {
      created = {}
      mockPrisma.returnPolicy.findUnique.mockResolvedValue(mockPolicyData)
      mockML.callMLPredict.mockResolvedValue({ ok: false, timedOut: false, error: 'off', retryable: true, attempts: 1 })
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb({
        claim: {
          updateMany: mockPrisma.claim.updateMany,
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
            created = data
            return { ...mockClaim, ...data }
          }),
        },
        customerFraudRecord: { update: vi.fn() },
        claimDecisionEvent: { create: vi.fn() },
      }))
    })

    it('enregistre séparément motif, sous-raison et commentaire', async () => {
      mockFraudScore.findOrCreateFraudRecord.mockResolvedValue({ record: mockFraudRecord, matchedBy: 'email' })
      mockFraudScore.computeFraudScore.mockReturnValue(0)

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      await ingestClaim({
        ...baseInput,
        productId:           ' SKU-42 ',
        returnReason:        'Mauvaise taille',
        returnReasonDetail:  'TOO_SMALL',
        returnReasonComment: 'Taille 42 trop juste',
      })

      expect(created.returnReason).toBe('Mauvaise taille')
      expect(created.returnReasonDetail).toBe('TOO_SMALL')
      expect(created.returnReasonComment).toBe('Taille 42 trop juste')
      expect(created.productId).toBe('SKU-42')
      expect(created.productKey).toBe('id:SKU-42')
    })

    it("retombe sur le nom normalisé quand aucun productId n'est transmis", async () => {
      mockFraudScore.findOrCreateFraudRecord.mockResolvedValue({ record: mockFraudRecord, matchedBy: 'email' })
      mockFraudScore.computeFraudScore.mockReturnValue(0)

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      await ingestClaim({ ...baseInput, productName: '  Nike   Air MAX ' })

      expect(created.productId).toBeNull()
      expect(created.productKey).toBe('name:nike air max')
    })

    it('sans retour expliqué : score brut, aucune trace d’ajustement', async () => {
      mockFraudScore.findOrCreateFraudRecord.mockResolvedValue({
        record: { ...mockFraudRecord, totalClaims: 4 }, matchedBy: 'email',
      })
      mockFraudScore.computeFraudScore.mockReturnValue(20)

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      await ingestClaim({ ...baseInput, mlPayload: { Return_Reason: 'Mauvaise taille' } })

      expect(created.fraudScore).toBe(20)
      expect(created.mlInput.Fraud_Score).toBe(20)
      expect(created.mlInput.Customer_Past_Returns).toBe(4)
      expect(created.mlInput.Is_Suspicious).toBe(1)   // 4 >= seuil 4
      expect(created).not.toHaveProperty('fraudAdjustment')   // colonne laissée NULL
    })

    it('ajuste Fraud_Score et Is_Suspicious, garde Customer_Past_Returns réel, et trace', async () => {
      mockFraudScore.findOrCreateFraudRecord.mockResolvedValue({
        record: { ...mockFraudRecord, totalClaims: 4 }, matchedBy: 'email',
      })
      mockFraudScore.computeFraudScore.mockReturnValue(20)
      mockExplain.mockResolvedValue({
        discount: 2,
        explained: [
          { claimId: 'c-own', vendorId: 'vendor-1', productKey: 'id:SKU-42', reasonDetail: 'TOO_SMALL', confidence: 'high', discount: 1 },
          { claimId: 'c-other', vendorId: 'vendor-2', productKey: 'id:X', reasonDetail: 'NOT_WORKING', confidence: 'high', discount: 1 },
        ],
      })

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      const result = await ingestClaim({ ...baseInput, mlPayload: { Return_Reason: 'Mauvaise taille' } })

      // Le payload ML garde son contrat : mêmes clés, Return_Reason intact.
      expect(created.mlInput.Return_Reason).toBe('Mauvaise taille')
      expect(created.mlInput).not.toHaveProperty('reason_detail')
      expect(created.mlInput.Customer_Past_Returns).toBe(4)   // fait réel
      expect(created.mlInput.Is_Suspicious).toBe(0)           // 4 - 2 = 2 < 4
      expect(created.mlInput.Fraud_Score).toBe(10)
      expect(created.fraudScore).toBe(10)
      expect(result.ok && result.claim.fraudScore).toBe(10)

      // Trace : montants complets ; les retours d'une autre boutique comptés,
      // jamais identifiés.
      expect(created.fraudAdjustment).toMatchObject({
        rawScore: 20, adjustedScore: 10, pastReturns: 4, adjustedPastReturns: 2, discount: 2,
        explainedOtherVendors: 1,
      })
      expect(created.fraudAdjustment.explained).toEqual([
        { claimId: 'c-own', productKey: 'id:SKU-42', reasonDetail: 'TOO_SMALL', confidence: 'high', discount: 1 },
      ])
      expect(JSON.stringify(created.fraudAdjustment)).not.toContain('c-other')
    })

    it("retombe sur le score brut si l'explication échoue", async () => {
      mockFraudScore.findOrCreateFraudRecord.mockResolvedValue({ record: mockFraudRecord, matchedBy: 'email' })
      mockFraudScore.computeFraudScore.mockReturnValue(15)
      mockExplain.mockRejectedValue(new Error('db down'))

      const { ingestClaim } = await import('@/lib/services/claim-ingestion')
      const result = await ingestClaim(baseInput)

      expect(result.ok).toBe(true)
      expect(created.fraudScore).toBe(15)
    })
  })
})
