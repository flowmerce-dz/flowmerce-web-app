// Routes du tableau de bord du suivi des commandes : secret webhook, réglages
// et webhook de test. Le point central : le secret n'atteint le navigateur
// qu'une fois, à sa génération.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockEnv = vi.hoisted(() => ({
  ORDER_TRACKING_SECRET_KEY: 'k'.repeat(40) as string | undefined,
  GMAIL_USER:                'flowmerce@example.com',
  NEXT_PUBLIC_BASE_URL:      'https://flowmerce.test',
}))
vi.mock('@/lib/env', () => ({ env: mockEnv }))
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('@/__tests__/helpers/fake-tracking-db')).fakeDb,
}))
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/mailer', () => ({
  createMailTransport: () => ({ sendMail: vi.fn().mockResolvedValue({}) }),
}))
const mockSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/getSession', () => ({
  getSessionFromRequest: () => mockSession(),
  getSessionServer:      () => mockSession(),
}))

import { resetDb, rowsOf, seedVendor } from '@/__tests__/helpers/fake-tracking-db'
import { computeSignature, decryptSecret } from '@/lib/order-tracking/crypto'
import { processOrderWebhook } from '@/lib/order-tracking/webhook'

let vendorId: string

const json = (method: string, url: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body:    body === undefined ? undefined : JSON.stringify(body),
  })

async function generateSecret() {
  const { POST } = await import('@/app/api/order-tracking/secret/route')
  return POST()
}
async function getSettings() {
  const { GET } = await import('@/app/api/order-tracking/settings/route')
  return GET()
}
async function patchSettings(body: unknown) {
  const { PATCH } = await import('@/app/api/order-tracking/settings/route')
  return PATCH(json('PATCH', '/api/order-tracking/settings', body))
}
async function sendTest(body: unknown = {}) {
  const { POST } = await import('@/app/api/order-tracking/test/route')
  return POST(json('POST', '/api/order-tracking/test', body))
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  mockEnv.ORDER_TRACKING_SECRET_KEY = 'k'.repeat(40)
  vendorId = seedVendor({ orderTrackingEnabled: true }).vendorId
  mockSession.mockResolvedValue({ user: { id: `user_${vendorId}`, role: 'VENDOR' } })
})

describe('secret webhook', () => {
  it('révèle le secret une seule fois et ne stocke que sa forme chiffrée', async () => {
    const res  = await generateSecret()
    const data = await res.json()

    expect(res.status).toBe(201)
    expect(data.secret).toMatch(/^whsec_/)
    expect(data.oneTimeReveal).toBe(true)

    const config = rowsOf('orderTrackingConfig')[0]
    expect(config.webhookSecretEnc).not.toContain(data.secret)
    expect(decryptSecret(config.webhookSecretEnc)).toBe(data.secret)
    expect(config.webhookSecretPrefix).toBe(data.secret.slice(0, 10))
  })

  it('n’est jamais renvoyé par les réglages, ni en clair ni chiffré', async () => {
    const { secret } = await (await generateSecret()).json()
    const res  = await getSettings()
    const text = JSON.stringify(await res.json())

    expect(res.status).toBe(200)
    expect(text).not.toContain(secret)
    expect(text).not.toContain(rowsOf('orderTrackingConfig')[0].webhookSecretEnc)
    expect(text).not.toContain('webhookSecretEnc')
    expect(JSON.parse(text).secret).toMatchObject({ configured: true, prefix: secret.slice(0, 10) })
    expect(JSON.parse(text).webhookUrl).toBe('https://flowmerce.test/api/v1/webhooks/orders')
  })

  it('régénérer invalide immédiatement l’ancien secret', async () => {
    const first  = (await (await generateSecret()).json()).secret
    const second = (await (await generateSecret()).json()).secret
    expect(second).not.toBe(first)

    const sign = (secret: string, eventId: string) => {
      const timestamp = String(Math.floor(Date.now() / 1000))
      const rawBody   = JSON.stringify({ order_id: 'A-1', status: 'Livrée', updated_at: new Date().toISOString() })
      return processOrderWebhook({
        vendorId, eventId, timestamp, rawBody,
        signature: computeSignature(secret, timestamp, eventId, rawBody),
      })
    }

    expect((await sign(first, 'evt_ancien')).response.status).toBe(401)
    expect((await sign(second, 'evt_nouveau')).response.status).toBe(200)
  })

  it('refuse la génération quand la clé de chiffrement manque, sans rien écrire', async () => {
    mockEnv.ORDER_TRACKING_SECRET_KEY = undefined
    const res = await generateSecret()

    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('SECRET_STORAGE_NOT_CONFIGURED')
    expect(rowsOf('orderTrackingConfig')).toHaveLength(0)
  })

  it('exige une session et un compte approuvé', async () => {
    mockSession.mockResolvedValue(null)
    expect((await generateSecret()).status).toBe(401)

    mockSession.mockResolvedValue({ user: { id: `user_${vendorId}`, role: 'VENDOR' } })
    rowsOf('vendor')[0].status = 'PENDING'
    expect((await generateSecret()).status).toBe(403)
  })
})

describe('réglages', () => {
  it('enregistre statuts notifiés, langue et correspondances', async () => {
    const res = await patchSettings({
      notifyStatuses:  ['SHIPPED', 'DELIVERED'],
      defaultLanguage: 'ar',
      mappings:        [{ externalStatus: 'Chez Yalidine', status: 'SHIPPED' }],
    })
    expect(res.status).toBe(200)

    expect(rowsOf('orderTrackingConfig')[0]).toMatchObject({
      notifyStatuses: ['SHIPPED', 'DELIVERED'], defaultLanguage: 'ar',
    })
    expect(rowsOf('storeStatusMapping')[0]).toMatchObject({
      vendorId, externalStatus: 'Chez Yalidine', normalizedKey: 'chez yalidine', status: 'SHIPPED',
    })
  })

  it('ne touche pas aux champs absents de la requête', async () => {
    await patchSettings({ notifyStatuses: ['SHIPPED'], defaultLanguage: 'ar' })
    await patchSettings({ notifyStatuses: ['DELIVERED'] })

    expect(rowsOf('orderTrackingConfig')[0]).toMatchObject({
      notifyStatuses: ['DELIVERED'], defaultLanguage: 'ar',
    })
  })

  it('reclasse les commandes non reconnues quand une correspondance les couvre', async () => {
    rowsOf('order').push({
      id: 'o1', vendorId, externalId: 'A-1', status: 'UNMAPPED',
      rawStatus: 'Chez Yalidine', statusUpdatedAt: new Date(),
    })
    const res = await patchSettings({ mappings: [{ externalStatus: 'chez yalidine', status: 'SHIPPED' }] })

    expect(await res.json()).toMatchObject({ reclassified: 1 })
    expect(rowsOf('order')[0].status).toBe('SHIPPED')
    // Un reclassement ne correspond à aucun événement : aucune notification.
    expect(rowsOf('notificationJob')).toHaveLength(0)
  })

  it('refuse un canal sans fournisseur, UNMAPPED comme cible et les doublons', async () => {
    expect((await patchSettings({ notificationChannel: 'WHATSAPP' })).status).toBe(400)
    expect((await patchSettings({ notifyStatuses: ['UNMAPPED'] })).status).toBe(400)
    expect((await patchSettings({ mappings: [{ externalStatus: 'x', status: 'UNMAPPED' }] })).status).toBe(400)
    expect((await patchSettings({
      mappings: [
        { externalStatus: 'Expédiée', status: 'SHIPPED' },
        { externalStatus: 'EXPEDIEE', status: 'DELIVERED' },
      ],
    })).status).toBe(400)
    expect((await patchSettings({ webhookSecretEnc: 'x' })).status).toBe(400)
    expect(rowsOf('storeStatusMapping')).toHaveLength(0)
  })

  it('personnalise un message, puis le rétablit par défaut', async () => {
    await patchSettings({ templates: { SHIPPED: { fr: { subject: 'Colis parti', body: 'Bonjour {{customer_name}}' } } } })
    let data = await (await getSettings()).json()
    expect(data.templates.SHIPPED.fr).toEqual({ subject: 'Colis parti', body: 'Bonjour {{customer_name}}', custom: true })
    expect(data.templates.SHIPPED.ar.custom).toBe(false)

    await patchSettings({ templates: { SHIPPED: { fr: null } } })
    data = await (await getSettings()).json()
    expect(data.templates.SHIPPED.fr.custom).toBe(false)
  })

  it('présente au vendeur les statuts reçus sans correspondance', async () => {
    rowsOf('orderStatusEvent').push(
      { id: 'e1', vendorId, orderId: 'o1', eventId: 'a', status: 'UNMAPPED', rawStatus: 'Chez Yalidine', receivedAt: new Date() },
      { id: 'e2', vendorId, orderId: 'o1', eventId: 'b', status: 'UNMAPPED', rawStatus: 'Chez Yalidine', receivedAt: new Date() },
    )
    let data = await (await getSettings()).json()
    expect(data.unmappedStatuses).toMatchObject([{ rawStatus: 'Chez Yalidine', count: 2 }])

    await patchSettings({ mappings: [{ externalStatus: 'Chez Yalidine', status: 'SHIPPED' }] })
    data = await (await getSettings()).json()
    expect(data.unmappedStatuses).toEqual([])
  })
})

describe('webhook de test', () => {
  it('réussit de bout en bout sans créer de commande ni de notification', async () => {
    await generateSecret()
    await patchSettings({ notifyStatuses: ['SHIPPED'] })

    const res  = await sendTest({ status: 'Expédiée' })
    const data = await res.json()

    expect(data).toMatchObject({ ok: true, httpStatus: 200, response: { test: true, status: 'SHIPPED', would_notify: true } })
    expect(rowsOf('order')).toHaveLength(0)
    expect(rowsOf('orderStatusEvent')).toHaveLength(0)
    expect(rowsOf('notificationJob')).toHaveLength(0)
    expect(rowsOf('webhookLog')[0]).toMatchObject({ isTest: true, outcome: 'TEST_OK' })
    // Ni le secret ni la signature ne reviennent au navigateur.
    expect(JSON.stringify(data)).not.toMatch(/whsec_|signature/i)
  })

  it('signale un statut sans correspondance', async () => {
    await generateSecret()
    const data = await (await sendTest({ status: 'Statut maison' })).json()
    expect(data.response).toMatchObject({ status: 'UNMAPPED', would_notify: false })
  })

  it('rapporte le refus quand aucun secret n’a été généré', async () => {
    const data = await (await sendTest()).json()
    expect(data).toMatchObject({ ok: false, httpStatus: 403, response: { code: 'WEBHOOK_SECRET_NOT_CONFIGURED' } })
  })

  it('rapporte le refus quand le suivi est désactivé', async () => {
    await generateSecret()
    rowsOf('vendor')[0].orderTrackingEnabled = false
    const data = await (await sendTest()).json()
    expect(data).toMatchObject({ ok: false, httpStatus: 403, response: { code: 'SERVICE_DISABLED' } })
    expect(rowsOf('webhookLog')).toHaveLength(0)
  })
})
