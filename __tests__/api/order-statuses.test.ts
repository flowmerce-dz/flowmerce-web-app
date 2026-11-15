// Statuts propres à chaque boutique : déclaration par la boutique
// (PUT /api/v1/order-statuses) et filtrage du tableau de bord sur ces statuts.
//
// Aucune liste de boutique n'est codée en dur : les deux boutiques de ces
// tests ont des statuts différents et chacune ne voit que les siens.

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
import { buildStoreStatusView, sanitizeDeclaredStatuses } from '@/lib/order-tracking/store-statuses'
import { processOrderWebhook } from '@/lib/order-tracking/webhook'

const CABA = ['En attente', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Annulée']

async function declare(rawKey: string, body: unknown, headers: Record<string, string> = {}) {
  const { PUT } = await import('@/app/api/v1/order-statuses/route')
  return PUT(new NextRequest('http://localhost:3000/api/v1/order-statuses', {
    method:  'PUT',
    headers: { 'content-type': 'application/json', 'x-flowmerce-key': rawKey, ...headers },
    body:    JSON.stringify(body),
  }))
}

async function readDeclared(rawKey: string) {
  const { GET } = await import('@/app/api/v1/order-statuses/route')
  return GET(new NextRequest('http://localhost:3000/api/v1/order-statuses', {
    headers: { authorization: `Bearer ${rawKey}` },
  }))
}

async function settingsOf(vendorId: string) {
  mockSession.mockResolvedValue({ user: { id: `user_${vendorId}`, role: 'VENDOR' } })
  const { GET } = await import('@/app/api/order-tracking/settings/route')
  return (await GET()).json()
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
})

describe('déclaration des statuts par la boutique', () => {
  it('enregistre la liste et rend le statut normalisé de chaque libellé', async () => {
    const { vendorId, rawKey } = seedVendor({ orderTrackingEnabled: true })
    const res = await declare(rawKey, { statuses: CABA })

    expect(res.status).toBe(200)
    expect((await res.json()).statuses).toEqual([
      { label: 'En attente',     status: 'PENDING',   mapped: true },
      { label: 'Confirmée',      status: 'CONFIRMED', mapped: true },
      { label: 'En préparation', status: 'PREPARING', mapped: true },
      { label: 'Expédiée',       status: 'SHIPPED',   mapped: true },
      { label: 'Livrée',         status: 'DELIVERED', mapped: true },
      { label: 'Annulée',        status: 'CANCELLED', mapped: true },
    ])
    expect(rowsOf('orderTrackingConfig')[0]).toMatchObject({ vendorId, storeStatuses: CABA })
    expect(rowsOf('orderTrackingConfig')[0].storeStatusesDeclaredAt).toBeInstanceOf(Date)
  })

  it('remplace la liste précédente au lieu de l’étendre', async () => {
    const { rawKey } = seedVendor({ orderTrackingEnabled: true })
    await declare(rawKey, { statuses: CABA })
    await declare(rawKey, { statuses: ['Expédiée', 'Livrée'] })

    expect(rowsOf('orderTrackingConfig')).toHaveLength(1)
    expect(rowsOf('orderTrackingConfig')[0].storeStatuses).toEqual(['Expédiée', 'Livrée'])
    expect((await (await readDeclared(rawKey)).json()).statuses).toHaveLength(2)
  })

  it('signale un libellé sans correspondance, sans le refuser', async () => {
    const { rawKey } = seedVendor({ orderTrackingEnabled: true })
    const data = await (await declare(rawKey, { statuses: ['Expédiée', 'Chez Yalidine'] })).json()

    expect(data.statuses[1]).toEqual({ label: 'Chez Yalidine', status: 'UNMAPPED', mapped: false })
  })

  it('fusionne les doublons et écarte les libellés illisibles', () => {
    expect(sanitizeDeclaredStatuses([' Expédiée ', 'EXPEDIEE', '***', 'Livrée'])).toEqual(['Expédiée', 'Livrée'])
  })

  it('ne touche pas au secret ni aux réglages déjà enregistrés', async () => {
    const { vendorId, rawKey } = seedVendor({ orderTrackingEnabled: true })
    const enc = encryptSecret('whsec_x')
    seedTrackingConfig(vendorId, { webhookSecretEnc: enc, notifyStatuses: ['SHIPPED'], defaultLanguage: 'ar' })

    await declare(rawKey, { statuses: CABA })

    expect(rowsOf('orderTrackingConfig')[0]).toMatchObject({
      webhookSecretEnc: enc, notifyStatuses: ['SHIPPED'], defaultLanguage: 'ar', storeStatuses: CABA,
    })
  })

  it('une liste vide annule la déclaration', async () => {
    const { rawKey } = seedVendor({ orderTrackingEnabled: true })
    await declare(rawKey, { statuses: CABA })
    const res = await declare(rawKey, { statuses: [] })

    expect(res.status).toBe(200)
    expect(rowsOf('orderTrackingConfig')[0]).toMatchObject({ storeStatuses: [], storeStatusesDeclaredAt: null })
  })

  it('refuse un corps invalide avec 400', async () => {
    const { rawKey } = seedVendor({ orderTrackingEnabled: true })

    for (const body of [{}, { statuses: 'Expédiée' }, { statuses: [1] }, { statuses: [''] },
      { statuses: ['x'.repeat(101)] }, { statuses: Array(51).fill('s') }, { statuses: CABA, autre: 1 }]) {
      expect((await declare(rawKey, body)).status).toBe(400)
    }
    expect(rowsOf('orderTrackingConfig')).toHaveLength(0)
  })

  it('exige une clé API valide et le service de suivi activé — pas Retours-ML', async () => {
    expect((await declare('flk_inconnue', { statuses: CABA })).status).toBe(401)

    const off = seedVendor({ orderTrackingEnabled: false, returnsMLEnabled: true })
    const res = await declare(off.rawKey, { statuses: CABA })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'SERVICE_DISABLED', service: 'orderTracking' })

    const trackingOnly = seedVendor({ orderTrackingEnabled: true, returnsMLEnabled: false })
    expect((await declare(trackingOnly.rawKey, { statuses: CABA })).status).toBe(200)
  })
})

describe('tableau de bord — seuls les statuts de la boutique', () => {
  it('ne propose que les statuts déclarés, sous les libellés de la boutique', async () => {
    const { vendorId, rawKey } = seedVendor({ orderTrackingEnabled: true })
    await declare(rawKey, { statuses: CABA })

    const settings = await settingsOf(vendorId)

    expect(settings.activeStatuses).toEqual([
      'PENDING', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED',
    ])
    // Statuts standards absents de cette boutique.
    for (const absent of ['OUT_FOR_DELIVERY', 'FAILED_DELIVERY', 'RETURNED']) {
      expect(settings.activeStatuses).not.toContain(absent)
    }
    expect(settings.storeStatuses).toMatchObject({ declared: true })
    expect(settings.storeStatuses.items).toHaveLength(6)
    expect(settings.statusLabels.SHIPPED).toBe('Expédiée')
  })

  it('propose tous les statuts standards tant que rien n’est déclaré', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })
    const settings = await settingsOf(vendorId)

    expect(settings.storeStatuses.declared).toBe(false)
    expect(settings.activeStatuses).toHaveLength(9)
  })

  it('chaque boutique ne voit que ses propres statuts', async () => {
    const caba  = seedVendor({ orderTrackingEnabled: true })
    const autre = seedVendor({ orderTrackingEnabled: true })
    await declare(caba.rawKey,  { statuses: CABA })
    await declare(autre.rawKey, { statuses: ['Shipped', 'Out for delivery', 'Delivered', 'Returned'] })

    expect((await settingsOf(caba.vendorId)).activeStatuses).toEqual([
      'PENDING', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELLED',
    ])
    const other = await settingsOf(autre.vendorId)
    expect(other.activeStatuses).toEqual(['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED'])
    expect(other.statusLabels.OUT_FOR_DELIVERY).toBe('Out for delivery')
  })

  it('nomme un statut par le libellé propre à la boutique, une fois associé', async () => {
    const { vendorId, rawKey } = seedVendor({ orderTrackingEnabled: true })
    await declare(rawKey, { statuses: ['Chez Yalidine', 'Livrée'] })

    let settings = await settingsOf(vendorId)
    // Pas encore associé : à présenter au vendeur, et absent des statuts proposés.
    expect(settings.unmappedStatuses).toEqual([{ rawStatus: 'Chez Yalidine', count: 0, lastSeenAt: null }])
    expect(settings.activeStatuses).toEqual(['DELIVERED'])

    rowsOf('storeStatusMapping').push({
      id: 'm1', vendorId, externalStatus: 'Chez Yalidine', normalizedKey: 'chez yalidine', status: 'SHIPPED',
    })
    settings = await settingsOf(vendorId)
    expect(settings.unmappedStatuses).toEqual([])
    expect(settings.activeStatuses).toEqual(['SHIPPED', 'DELIVERED'])
    expect(settings.statusLabels.SHIPPED).toBe('Chez Yalidine')
  })

  it('garde visible un statut réellement reçu, même absent de la déclaration', () => {
    const view = buildStoreStatusView(['Expédiée', 'Livrée'], [], ['CANCELLED', 'UNMAPPED'])
    expect(view.activeStatuses).toEqual(['SHIPPED', 'DELIVERED', 'CANCELLED'])
    expect(view.labels.CANCELLED).toBe('Annulée')
  })
})

describe('la déclaration ne restreint pas le webhook', () => {
  it('accepte et normalise un statut non déclaré', async () => {
    const { vendorId, rawKey } = seedVendor({ orderTrackingEnabled: true })
    seedTrackingConfig(vendorId, { webhookSecretEnc: encryptSecret('whsec_s') })
    await declare(rawKey, { statuses: ['Expédiée', 'Livrée'] })

    const timestamp = String(Math.floor(Date.now() / 1000))
    const rawBody   = JSON.stringify({ order_id: 'A-1', status: 'Annulée', updated_at: new Date().toISOString() })
    const result = await processOrderWebhook({
      vendorId, eventId: 'evt_1', timestamp, rawBody,
      signature: computeSignature('whsec_s', timestamp, 'evt_1', rawBody),
    })

    expect(result.response.status).toBe(200)
    expect(rowsOf('order')[0].status).toBe('CANCELLED')
    // Reçu une fois, le statut apparaît désormais au tableau de bord.
    expect((await settingsOf(vendorId)).activeStatuses).toContain('CANCELLED')
  })
})
