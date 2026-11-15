// Traitement d'un webhook de commande (lib/order-tracking/webhook.ts +
// ingest.ts), sur une base en mémoire : signature, rejeu, idempotence,
// chronologie, statut inconnu et mise en file des notifications.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('@/__tests__/helpers/fake-tracking-db')).fakeDb,
}))
vi.mock('@/lib/env', () => ({
  env: { ORDER_TRACKING_SECRET_KEY: 'k'.repeat(40), GMAIL_USER: 'flowmerce@example.com' },
}))
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
// Le webhook ne doit jamais envoyer d'e-mail : tout appel au transport est une
// faute, que ce test relève.
const mockSendMail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mailer', () => ({
  createMailTransport: () => ({ sendMail: mockSendMail }),
}))

import { fakeDb, resetDb, rowsOf, seedTrackingConfig, seedVendor } from '@/__tests__/helpers/fake-tracking-db'
import { computeSignature, encryptSecret } from '@/lib/order-tracking/crypto'
import { normalizeStatusKey } from '@/lib/order-tracking/statuses'
import { processOrderWebhook } from '@/lib/order-tracking/webhook'

const SECRET = 'whsec_secret_de_test'
const NOW    = new Date('2026-11-14T18:00:00Z')
const TS     = String(Math.floor(NOW.getTime() / 1000))

let vendorId: string
let eventSeq = 0

function payload(over: Record<string, unknown> = {}) {
  return {
    order_id:   'CABA-10452',
    status:     'Expédiée',
    updated_at: '2026-11-14T17:20:00Z',
    customer:   { name: 'Amine B.', email: 'amine@example.com', phone: '+213550000000' },
    tracking_number: 'YAL-123456',
    carrier:    'yalidine',
    items:      [{ sku: 'CHS-39-NOIR', name: 'Chaussure X', qty: 1 }],
    ...over,
  }
}

/** Envoie un webhook correctement signé, sauf surcharge explicite. */
async function send(
  body: Record<string, unknown> = payload(),
  over: { eventId?: string; signature?: string | null; timestamp?: string; secret?: string; isTest?: boolean } = {},
) {
  const rawBody   = JSON.stringify(body)
  const eventId   = over.eventId ?? `evt_${++eventSeq}`
  const timestamp = over.timestamp ?? TS
  const signature = over.signature !== undefined
    ? over.signature
    : computeSignature(over.secret ?? SECRET, timestamp, eventId, rawBody)

  const result = await processOrderWebhook({
    vendorId, signature, eventId, timestamp, rawBody, isTest: over.isTest, now: NOW,
  })
  return { ...result, status: result.response.status, json: await result.response.json(), eventId }
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  eventSeq = 0
  vendorId = seedVendor({ orderTrackingEnabled: true }).vendorId
  seedTrackingConfig(vendorId, {
    webhookSecretEnc: encryptSecret(SECRET),
    notifyStatuses:   ['SHIPPED', 'DELIVERED'],
  })
})

describe('webhook — signature valide', () => {
  it('enregistre la commande, l’événement et met la notification en file', async () => {
    const res = await send()

    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({
      received: true, order_id: 'CABA-10452', status: 'SHIPPED', event_status: 'SHIPPED',
      applied: true, outcome: 'processed', notification: 'queued',
    })

    expect(rowsOf('order')).toHaveLength(1)
    expect(rowsOf('order')[0]).toMatchObject({
      vendorId, externalId: 'CABA-10452', status: 'SHIPPED', rawStatus: 'Expédiée',
      customerEmail: 'amine@example.com', trackingNumber: 'YAL-123456', carrier: 'yalidine',
    })
    expect(rowsOf('orderStatusEvent')).toHaveLength(1)
    expect(rowsOf('notificationJob')).toHaveLength(1)
    expect(rowsOf('notificationJob')[0]).toMatchObject({
      status: 'PENDING', channel: 'EMAIL', orderStatus: 'SHIPPED',
      recipient: 'amine@example.com', attempts: 0,
    })
    expect(rowsOf('webhookLog')[0]).toMatchObject({ outcome: 'PROCESSED', httpStatus: 200, isTest: false })
  })

  it('n’envoie aucun e-mail pendant la requête', async () => {
    await send()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('met à jour la même commande aux événements suivants', async () => {
    await send()
    const res = await send(payload({ status: 'Livrée', updated_at: '2026-11-14T17:50:00Z' }))

    expect(res.json).toMatchObject({ status: 'DELIVERED', applied: true })
    expect(rowsOf('order')).toHaveLength(1)
    expect(rowsOf('order')[0].status).toBe('DELIVERED')
    expect(rowsOf('orderStatusEvent')).toHaveLength(2)
    expect(rowsOf('notificationJob')).toHaveLength(2)
  })

  it('sépare les commandes de deux boutiques portant le même identifiant', async () => {
    await send()
    const other = seedVendor({ orderTrackingEnabled: true }).vendorId
    seedTrackingConfig(other, { webhookSecretEnc: encryptSecret(SECRET) })
    vendorId = other
    // Même identifiant d'événement et même commande : aucune collision.
    const res = await send(payload(), { eventId: 'evt_1' })

    expect(res.status).toBe(200)
    expect(rowsOf('order')).toHaveLength(2)
  })
})

describe('webhook — signature invalide', () => {
  it('refuse une signature fausse avec 401 et n’enregistre rien', async () => {
    const res = await send(payload(), { secret: 'whsec_mauvais_secret' })

    expect(res.status).toBe(401)
    expect(res.json.code).toBe('INVALID_SIGNATURE')
    expect(rowsOf('order')).toHaveLength(0)
    expect(rowsOf('orderStatusEvent')).toHaveLength(0)
    expect(rowsOf('notificationJob')).toHaveLength(0)
    expect(rowsOf('webhookLog')[0]).toMatchObject({ outcome: 'INVALID_SIGNATURE', httpStatus: 401 })
  })

  it('refuse une requête sans signature avec 401', async () => {
    const res = await send(payload(), { signature: null })
    expect(res.status).toBe(401)
    expect(res.json.code).toBe('MISSING_SIGNATURE')
  })

  it('refuse un corps modifié après signature', async () => {
    const rawBody   = JSON.stringify(payload())
    const signature = computeSignature(SECRET, TS, 'evt_x', rawBody)
    const result = await processOrderWebhook({
      vendorId, signature, eventId: 'evt_x', timestamp: TS, now: NOW,
      rawBody: rawBody.replace('Expédiée', 'Livrée'),
    })
    expect(result.response.status).toBe(401)
  })

  it('refuse un horodatage hors fenêtre, même correctement signé (rejeu)', async () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 600)
    const res = await send(payload(), { timestamp: old })

    expect(res.status).toBe(401)
    expect(res.json.code).toBe('TIMESTAMP_OUT_OF_RANGE')
    expect(rowsOf('order')).toHaveLength(0)
  })

  it('répond 400 quand un en-tête obligatoire manque ou est mal formé', async () => {
    expect((await send(payload(), { eventId: '' })).status).toBe(400)
    expect((await send(payload(), { eventId: 'avec espace' })).status).toBe(400)
    expect((await send(payload(), { timestamp: 'hier' })).status).toBe(400)
  })

  it('répond 400 sur un corps invalide, après vérification de la signature', async () => {
    const res = await send(payload({ order_id: '' }))
    expect(res.status).toBe(400)
    expect(res.json.code).toBe('INVALID_PAYLOAD')
    expect(rowsOf('order')).toHaveLength(0)
  })

  it('répond 403 tant qu’aucun secret n’a été généré', async () => {
    rowsOf('orderTrackingConfig')[0].webhookSecretEnc = null
    const res = await send()
    expect(res.status).toBe(403)
    expect(res.json.code).toBe('WEBHOOK_SECRET_NOT_CONFIGURED')
  })

  it('répond 500 si le secret stocké est indéchiffrable', async () => {
    rowsOf('orderTrackingConfig')[0].webhookSecretEnc = 'v1.x.y.z'
    const res = await send()
    expect(res.status).toBe(500)
    expect(rowsOf('order')).toHaveLength(0)
  })
})

describe('webhook — événement envoyé deux fois', () => {
  it('répond 409 et ne crée ni second événement ni seconde notification', async () => {
    const first  = await send(payload(), { eventId: 'evt_dup' })
    const second = await send(payload(), { eventId: 'evt_dup' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(second.json.code).toBe('DUPLICATE_EVENT')
    expect(second.accepted).toBe(false)

    expect(rowsOf('order')).toHaveLength(1)
    expect(rowsOf('orderStatusEvent')).toHaveLength(1)
    expect(rowsOf('notificationJob')).toHaveLength(1)
    expect(rowsOf('webhookLog').map((l) => l.outcome)).toEqual(['PROCESSED', 'DUPLICATE'])
  })

  it('reste idempotent quand deux envois identiques arrivent en même temps', async () => {
    const [a, b] = await Promise.all([
      send(payload(), { eventId: 'evt_race' }),
      send(payload(), { eventId: 'evt_race' }),
    ])

    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(rowsOf('order')).toHaveLength(1)
    expect(rowsOf('orderStatusEvent')).toHaveLength(1)
    expect(rowsOf('notificationJob')).toHaveLength(1)
  })

  it('s’en remet à la contrainte d’unicité quand le contrôle préalable a manqué le doublon', async () => {
    await send(payload(), { eventId: 'evt_p2002' })

    // La seconde requête ne voit pas encore l'événement de la première au
    // moment du contrôle : c'est la contrainte en base qui l'arrête.
    vi.spyOn(fakeDb.orderStatusEvent, 'findUnique').mockResolvedValueOnce(null)
    const second = await send(payload(), { eventId: 'evt_p2002' })

    expect(second.status).toBe(409)
    expect(rowsOf('orderStatusEvent')).toHaveLength(1)
    expect(rowsOf('notificationJob')).toHaveLength(1)
    // La transaction perdante a été annulée en entier : la commande est intacte.
    expect(rowsOf('order')[0]).toMatchObject({ status: 'SHIPPED' })
  })
})

describe('webhook — événement ancien reçu en retard', () => {
  it('le conserve dans l’historique sans faire régresser le statut ni notifier', async () => {
    await send(payload({ status: 'Livrée', updated_at: '2026-11-14T17:30:00Z' }))
    const late = await send(payload({ status: 'Expédiée', updated_at: '2026-11-14T10:00:00Z' }))

    expect(late.status).toBe(200)
    expect(late.json).toMatchObject({
      outcome: 'stale', applied: false, event_status: 'SHIPPED', status: 'DELIVERED',
      notification: 'none',
    })

    expect(rowsOf('order')[0]).toMatchObject({ status: 'DELIVERED', rawStatus: 'Livrée' })
    const events = rowsOf('orderStatusEvent')
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ status: 'SHIPPED', applied: false })
    // Une seule notification : celle de la livraison.
    expect(rowsOf('notificationJob')).toHaveLength(1)
    expect(rowsOf('notificationJob')[0].orderStatus).toBe('DELIVERED')
  })
})

describe('webhook — statut inconnu', () => {
  it('conserve le statut comme UNMAPPED avec son libellé, sans notifier', async () => {
    const res = await send(payload({ status: 'Chez le transporteur' }))

    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ outcome: 'unmapped', status: 'UNMAPPED', notification: 'none' })
    expect(rowsOf('order')[0]).toMatchObject({ status: 'UNMAPPED', rawStatus: 'Chez le transporteur' })
    expect(rowsOf('orderStatusEvent')[0]).toMatchObject({ status: 'UNMAPPED', rawStatus: 'Chez le transporteur' })
    expect(rowsOf('notificationJob')).toHaveLength(0)
    expect(rowsOf('webhookLog')[0].outcome).toBe('UNMAPPED')
  })

  it('n’écrase pas un statut reconnu par un statut inconnu', async () => {
    await send()
    const res = await send(payload({ status: 'Statut maison', updated_at: '2026-11-14T17:40:00Z' }))

    expect(res.json).toMatchObject({ outcome: 'unmapped', applied: false, status: 'SHIPPED' })
    expect(rowsOf('order')[0].status).toBe('SHIPPED')
    expect(rowsOf('orderStatusEvent')).toHaveLength(2)
  })

  it('reconnaît le statut une fois la correspondance configurée par la boutique', async () => {
    rowsOf('storeStatusMapping').push({
      id: 'm1', vendorId, externalStatus: 'Chez le transporteur',
      normalizedKey: normalizeStatusKey('Chez le transporteur'), status: 'SHIPPED',
    })
    const res = await send(payload({ status: 'CHEZ LE TRANSPORTEUR' }))
    expect(res.json).toMatchObject({ outcome: 'processed', status: 'SHIPPED', notification: 'queued' })
  })

  it('n’accepte jamais un statut transmis comme valeur interne sans passer par la correspondance', async () => {
    // « UNMAPPED » et un code inventé ne sont que des libellés à normaliser.
    const res = await send(payload({ status: 'SUPER_ADMIN' }))
    expect(rowsOf('order')[0].status).toBe('UNMAPPED')
    expect(res.json.status).toBe('UNMAPPED')
  })
})

describe('webhook — notification non activée pour un statut', () => {
  it('enregistre l’événement sans créer de notification', async () => {
    const res = await send(payload({ status: 'Confirmée' }))

    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ status: 'CONFIRMED', applied: true, notification: 'not_selected' })
    expect(rowsOf('orderStatusEvent')).toHaveLength(1)
    expect(rowsOf('notificationJob')).toHaveLength(0)
  })

  it('ne crée pas de notification sans adresse e-mail exploitable', async () => {
    const res = await send(payload({ customer: { name: 'Amine', email: 'pas-un-email' } }))

    expect(res.status).toBe(200)
    expect(res.json.notification).toBe('no_recipient')
    expect(res.json.ignored).toEqual(['customer.email : adresse invalide'])
    expect(rowsOf('notificationJob')).toHaveLength(0)
  })

  it('ne crée pas de notification quand le canal choisi n’a pas de fournisseur', async () => {
    rowsOf('orderTrackingConfig')[0].notificationChannel = 'WHATSAPP'
    const res = await send()
    expect(res.json.notification).toBe('channel_unavailable')
    expect(rowsOf('notificationJob')).toHaveLength(0)
  })

  it('choisit la langue du client, sinon celle de la boutique', async () => {
    rowsOf('orderTrackingConfig')[0].defaultLanguage = 'ar'
    await send()
    await send(payload({ order_id: 'CABA-2', customer: { email: 'b@example.com', language: 'fr' } }))

    expect(rowsOf('notificationJob').map((j) => j.language)).toEqual(['ar', 'fr'])
  })
})

describe('webhook de test', () => {
  it('traverse tous les contrôles sans rien enregistrer d’autre que le journal', async () => {
    const res = await send(payload(), { isTest: true })

    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ test: true, status: 'SHIPPED', would_notify: true })
    expect(res.accepted).toBe(false)
    expect(rowsOf('order')).toHaveLength(0)
    expect(rowsOf('orderStatusEvent')).toHaveLength(0)
    expect(rowsOf('notificationJob')).toHaveLength(0)
    expect(rowsOf('webhookLog')[0]).toMatchObject({ outcome: 'TEST_OK', isTest: true })
  })

  it('échoue comme un envoi réel si la signature est fausse', async () => {
    const res = await send(payload(), { isTest: true, secret: 'whsec_autre' })
    expect(res.status).toBe(401)
  })
})
