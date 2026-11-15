// Indépendance des deux services — Suivi des commandes et Retours-ML.
//
// Les routes réelles sont appelées avec la vraie authentification par clé API
// (lib/api-key-auth.ts), sur une base en mémoire. Une route de chaque service
// sert de témoin :
//
//   Suivi        POST /api/v1/webhooks/orders
//   Retours-ML   GET  /api/v1/return-form
//
// Les quatre configurations possibles sont vérifiées, puis la bascule d'un
// service sans effet sur l'autre.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('@/__tests__/helpers/fake-tracking-db')).fakeDb,
}))
vi.mock('@/lib/env', () => ({
  env: {
    ORDER_TRACKING_SECRET_KEY: 'k'.repeat(40),
    GMAIL_USER:                'flowmerce@example.com',
    NEXT_PUBLIC_BASE_URL:      'https://flowmerce.test',
    CRON_SECRET:               'c'.repeat(32),
  },
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

import { resetDb, rowsOf, seedTrackingConfig, seedVendor } from '@/__tests__/helpers/fake-tracking-db'
import { computeSignature, encryptSecret } from '@/lib/order-tracking/crypto'

const SECRET = 'whsec_secret_de_test'

let eventSeq = 0

function setup(flags: { returnsMLEnabled: boolean; orderTrackingEnabled: boolean }) {
  const { vendorId, rawKey } = seedVendor(flags)
  // Le secret est généré dans tous les cas : seul le drapeau du service décide.
  seedTrackingConfig(vendorId, { webhookSecretEnc: encryptSecret(SECRET), notifyStatuses: ['SHIPPED'] })
  mockSession.mockResolvedValue({ user: { id: `user_${vendorId}`, role: 'VENDOR' } })
  return { vendorId, rawKey }
}

async function sendWebhook(rawKey: string) {
  const { POST } = await import('@/app/api/v1/webhooks/orders/route')
  const body = JSON.stringify({
    order_id:   `CABA-${++eventSeq}`,
    status:     'Expédiée',
    updated_at: new Date(Date.now() - 60_000).toISOString(),
    customer:   { name: 'Amine B.', email: 'amine@example.com' },
  })
  const eventId   = `evt_${eventSeq}`
  const timestamp = String(Math.floor(Date.now() / 1000))

  return POST(new NextRequest('http://localhost:3000/api/v1/webhooks/orders', {
    method: 'POST',
    headers: {
      'content-type':          'application/json',
      'x-flowmerce-key':       rawKey,
      'x-flowmerce-event-id':  eventId,
      'x-flowmerce-timestamp': timestamp,
      'x-flowmerce-signature': computeSignature(SECRET, timestamp, eventId, body),
    },
    body,
  }))
}

async function fetchReturnForm(rawKey: string) {
  const { GET } = await import('@/app/api/v1/return-form/route')
  return GET(new NextRequest('http://localhost:3000/api/v1/return-form', {
    headers: { authorization: `Bearer ${rawKey}` },
  }))
}

async function patchServices(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/vendors/services/route')
  return PATCH(new NextRequest('http://localhost:3000/api/vendors/services', {
    method:  'PATCH',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  }))
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  eventSeq = 0
})

describe('les quatre configurations de services', () => {
  it('suivi uniquement : le webhook est accepté, Retours-ML est refusé', async () => {
    const { rawKey } = setup({ orderTrackingEnabled: true, returnsMLEnabled: false })

    expect((await sendWebhook(rawKey)).status).toBe(200)
    expect(rowsOf('order')).toHaveLength(1)
    expect(rowsOf('notificationJob')).toHaveLength(1)

    const returns = await fetchReturnForm(rawKey)
    expect(returns.status).toBe(403)
    expect(await returns.json()).toMatchObject({ code: 'SERVICE_DISABLED', service: 'returnsML' })
  })

  it('Retours-ML uniquement : Retours-ML répond, le webhook est refusé', async () => {
    const { rawKey } = setup({ orderTrackingEnabled: false, returnsMLEnabled: true })

    expect((await fetchReturnForm(rawKey)).status).toBe(200)

    const webhook = await sendWebhook(rawKey)
    expect(webhook.status).toBe(403)
    expect(await webhook.json()).toMatchObject({ code: 'SERVICE_DISABLED', service: 'orderTracking' })
    expect(rowsOf('order')).toHaveLength(0)
  })

  it('les deux services : les deux répondent', async () => {
    const { rawKey } = setup({ orderTrackingEnabled: true, returnsMLEnabled: true })

    expect((await sendWebhook(rawKey)).status).toBe(200)
    expect((await fetchReturnForm(rawKey)).status).toBe(200)
  })

  it('aucun service : les deux sont refusés', async () => {
    const { rawKey } = setup({ orderTrackingEnabled: false, returnsMLEnabled: false })

    expect((await sendWebhook(rawKey)).status).toBe(403)
    expect((await fetchReturnForm(rawKey)).status).toBe(403)
    expect(rowsOf('order')).toHaveLength(0)
  })

  it('le suivi fonctionne sans politique de retour ni configuration ML', async () => {
    // seedVendor ne crée aucune ReturnPolicy : `vendor.returnPolicy` vaut null.
    const { rawKey } = setup({ orderTrackingEnabled: true, returnsMLEnabled: false })
    const res = await sendWebhook(rawKey)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'SHIPPED', notification: 'queued' })
  })

  it('refuse le webhook sans clé API, ou avec une clé inconnue, avec 401', async () => {
    setup({ orderTrackingEnabled: true, returnsMLEnabled: true })
    expect((await sendWebhook('flk_inconnue')).status).toBe(401)
    expect((await sendWebhook('')).status).toBe(401)
  })
})

describe('bascule d’un service', () => {
  it('désactiver le suivi n’affecte pas Retours-ML', async () => {
    const { rawKey } = setup({ orderTrackingEnabled: true, returnsMLEnabled: true })

    const res = await patchServices({ orderTrackingEnabled: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ services: { returnsML: true, orderTracking: false } })

    expect(rowsOf('vendor')[0]).toMatchObject({ orderTrackingEnabled: false, returnsMLEnabled: true })
    expect((await fetchReturnForm(rawKey)).status).toBe(200)
    expect((await sendWebhook(rawKey)).status).toBe(403)
  })

  it('désactiver Retours-ML n’affecte pas le suivi', async () => {
    const { rawKey } = setup({ orderTrackingEnabled: true, returnsMLEnabled: true })

    const res = await patchServices({ returnsMLEnabled: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ services: { returnsML: false, orderTracking: true } })

    expect(rowsOf('vendor')[0]).toMatchObject({ orderTrackingEnabled: true, returnsMLEnabled: false })
    expect((await sendWebhook(rawKey)).status).toBe(200)
    expect((await fetchReturnForm(rawKey)).status).toBe(403)
  })

  it('n’écrit que le drapeau transmis', async () => {
    setup({ orderTrackingEnabled: false, returnsMLEnabled: true })
    const { fakeDb } = await import('@/__tests__/helpers/fake-tracking-db')
    const update = vi.spyOn(fakeDb.vendor, 'update')

    await patchServices({ orderTrackingEnabled: true })

    const [{ data }] = update.mock.calls[0] as [{ data: Record<string, unknown> }]
    expect(data).toEqual({ orderTrackingEnabled: true })
  })

  it('réactiver un service retrouve sa configuration intacte', async () => {
    const { rawKey, vendorId } = setup({ orderTrackingEnabled: true, returnsMLEnabled: true })

    await patchServices({ orderTrackingEnabled: false })
    await patchServices({ orderTrackingEnabled: true })

    expect(rowsOf('orderTrackingConfig')[0]).toMatchObject({ vendorId, notifyStatuses: ['SHIPPED'] })
    expect((await sendWebhook(rawKey)).status).toBe(200)
  })

  it('refuse un corps vide, un champ inconnu ou une valeur non booléenne', async () => {
    setup({ orderTrackingEnabled: false, returnsMLEnabled: true })

    expect((await patchServices({})).status).toBe(400)
    expect((await patchServices({ status: 'APPROVED' })).status).toBe(400)
    expect((await patchServices({ orderTrackingEnabled: 'oui' })).status).toBe(400)
    expect(rowsOf('vendor')[0]).toMatchObject({ orderTrackingEnabled: false, returnsMLEnabled: true, status: 'APPROVED' })
  })

  it('exige une session', async () => {
    setup({ orderTrackingEnabled: false, returnsMLEnabled: true })
    mockSession.mockResolvedValue(null)
    expect((await patchServices({ orderTrackingEnabled: true })).status).toBe(401)
  })
})
