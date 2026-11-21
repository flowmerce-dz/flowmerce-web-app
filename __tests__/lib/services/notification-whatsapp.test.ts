import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockLog, sendMail, mockPrisma, sendWhatsAppTemplate, isWhatsAppConfigured } = vi.hoisted(() => ({
  mockLog:              { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sendMail:             vi.fn(),
  mockPrisma:           { vendor: { findUnique: vi.fn() } },
  sendWhatsAppTemplate: vi.fn(),
  isWhatsAppConfigured: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ env: { GMAIL_USER: 'flowmerce@gmail.com', GMAIL_APP_PASSWORD: 'x'.repeat(16) } }))
vi.mock('@/lib/logger', () => ({ log: mockLog }))
// Sur main, l'e-mail passe directement par nodemailer (pas de lib/mailer).
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/whatsapp/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/client')>()),
  sendWhatsAppTemplate: (...a: unknown[]) => sendWhatsAppTemplate(...a),
  isWhatsAppConfigured: () => isWhatsAppConfigured(),
}))

import { notifyCustomer, notifyVendorNewClaim } from '@/lib/services/notification'
import { buildDecisionParams, buildNewClaimParams } from '@/lib/whatsapp/claim-templates'

const decisionPayload = {
  customerName:  'Karim Benali',
  customerEmail: 'karim@example.com',
  customerPhone: '0555123456',
  orderId:       'CMD-10234',
  status:        'APPROVED' as const,
  aiDecision:    'Exchange' as const,
  claimType:     'EXCHANGE',
  note:          null,
}

beforeEach(() => {
  vi.clearAllMocks()
  sendMail.mockResolvedValue({})
  isWhatsAppConfigured.mockReturnValue(true)
  sendWhatsAppTemplate.mockResolvedValue({ ok: true, messageId: 'wamid.X' })
})

describe('notifyCustomer — WhatsApp', () => {
  it('envoie decision_reclamation et l’e-mail pour une décision finale', async () => {
    await notifyCustomer(decisionPayload)

    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to:         '0555123456',
      template:   'decision_reclamation',
      language:   'fr',
      bodyParams: buildDecisionParams({
        customerName: 'Karim Benali',
        orderId:      'CMD-10234',
        status:       'APPROVED',
        decision:     'Exchange',
      }),
    })
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('envoie aussi pour un refus', async () => {
    await notifyCustomer({ ...decisionPayload, status: 'REJECTED', aiDecision: 'Reject' })
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppTemplate.mock.calls[0][0].bodyParams[8]).toBe('Refusée')
  })

  it('n’envoie pas de WhatsApp pour « en cours de traitement »', async () => {
    await notifyCustomer({ ...decisionPayload, status: 'IN_PROGRESS', aiDecision: null })
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('n’envoie pas de WhatsApp sans numéro client', async () => {
    await notifyCustomer({ ...decisionPayload, customerPhone: null })
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('n’envoie pas de WhatsApp quand il n’est pas configuré', async () => {
    isWhatsAppConfigured.mockReturnValue(false)
    await notifyCustomer(decisionPayload)
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('un échec de l’e-mail n’empêche pas le WhatsApp', async () => {
    sendMail.mockRejectedValue(new Error('SMTP down'))
    await expect(notifyCustomer(decisionPayload)).resolves.toBeUndefined()
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1)
  })

  it('un échec du WhatsApp n’empêche pas l’e-mail et ne remonte pas', async () => {
    sendWhatsAppTemplate.mockResolvedValue({ ok: false, error: 'meta_190: expired' })
    await expect(notifyCustomer(decisionPayload)).resolves.toBeUndefined()
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('une exception inattendue du WhatsApp ne remonte pas', async () => {
    sendWhatsAppTemplate.mockRejectedValue(new Error('boom'))
    await expect(notifyCustomer(decisionPayload)).resolves.toBeUndefined()
    expect(sendMail).toHaveBeenCalledTimes(1)
  })
})

describe('notifyVendorNewClaim', () => {
  const claim = {
    claimId:      'claim-1',
    vendorId:     'vendor-1',
    orderId:      'CMD-10234',
    customerName: 'Karim B',
    returnReason: 'Produit défectueux',
    type:         'EXCHANGE' as const,
  }

  it('envoie nouvelle_reclamation au numéro du vendeur', async () => {
    mockPrisma.vendor.findUnique.mockResolvedValue({ phone: '0661 00 00 00' })

    await notifyVendorNewClaim(claim)

    expect(mockPrisma.vendor.findUnique).toHaveBeenCalledWith({
      where:  { id: 'vendor-1' },
      select: { phone: true },
    })
    expect(sendWhatsAppTemplate).toHaveBeenCalledWith({
      to:         '0661 00 00 00',
      template:   'nouvelle_reclamation',
      language:   'en',
      bodyParams: buildNewClaimParams(claim),
    })
  })

  it('vendeur introuvable : pas d’envoi, avertissement', async () => {
    mockPrisma.vendor.findUnique.mockResolvedValue(null)
    await notifyVendorNewClaim(claim)
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(mockLog.warn).toHaveBeenCalled()
  })

  it('lecture du vendeur en échec : ne lève pas', async () => {
    mockPrisma.vendor.findUnique.mockRejectedValue(new Error('db down'))
    await expect(notifyVendorNewClaim(claim)).resolves.toBeUndefined()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
    expect(mockLog.error).toHaveBeenCalled()
  })

  it('WhatsApp non configuré : aucune lecture en base', async () => {
    isWhatsAppConfigured.mockReturnValue(false)
    await notifyVendorNewClaim(claim)
    expect(mockPrisma.vendor.findUnique).not.toHaveBeenCalled()
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled()
  })
})
