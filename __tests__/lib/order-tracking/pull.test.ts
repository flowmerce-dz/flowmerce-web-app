// Modes d'intégration du suivi : polling et connecteurs (Flowmerce va chercher
// les statuts), et exclusivité avec le webhook.
//
// Le transport HTTP est simulé (son comportement réel est testé dans
// pinned-http.test.ts) ; l'ingestion, la base en mémoire et le chiffrement
// sont les vrais.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('@/__tests__/helpers/fake-tracking-db')).fakeDb,
}))
vi.mock('@/lib/env', () => ({
  env: {
    ORDER_TRACKING_SECRET_KEY: 'k'.repeat(40),
    CRON_SECRET:               'c'.repeat(40),
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
const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/order-tracking/pinned-http', async (original) => ({
  ...(await original<typeof import('@/lib/order-tracking/pinned-http')>()),
  resolveAddresses: async () => [{ address: '203.0.113.10', family: 4 }],
  pinnedGet:        fetchMock,
}))
// Le catalogue réel ne contient que des connecteurs à venir : un connecteur
// disponible est ajouté ici pour exercer la structure de bout en bout.
const fakePull = vi.hoisted(() => vi.fn())
vi.mock('@/lib/order-tracking/connectors', async (original) => {
  const actual = await original<typeof import('@/lib/order-tracking/connectors')>()
  const fake = {
    id: 'fake', name: 'Faux transporteur', family: 'carrier' as const, description: '',
    credentialFields: [{ key: 'api_key', label: 'Clé API' }],
    isAvailable: () => true,
    pull: fakePull,
  }
  return {
    ...actual,
    getConnector: (id: string | null | undefined) => (id === 'fake' ? fake : actual.getConnector(id)),
  }
})

import { resetDb, rowsOf, seedTrackingConfig, seedVendor } from '@/__tests__/helpers/fake-tracking-db'
import { PullError } from '@/lib/order-tracking/connectors'
import { computeSignature, decryptSecret, encryptSecret } from '@/lib/order-tracking/crypto'
import { isPrivateAddress, validatePollingUrl } from '@/lib/order-tracking/polling'
import { syncDueStores, syncStore } from '@/lib/order-tracking/pull'
import { processOrderWebhook } from '@/lib/order-tracking/webhook'

const URL_ = 'https://shop.example.com/api/flowmerce/order-events'
const NOW  = new Date('2026-11-15T12:00:00.000Z')
const T0   = new Date('2026-11-15T11:00:00.000Z') // branchement de la source
const json = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) })

function event(over: Record<string, unknown> = {}) {
  return {
    order_id:   'CMD-1',
    status:     'Expédiée',
    updated_at: '2026-11-15T11:30:00.000Z',
    customer:   { email: 'client@example.com', name: 'Amine' },
    ...over,
  }
}

function seedPollingStore(config: Record<string, unknown> = {}) {
  const seeded = seedVendor({ orderTrackingEnabled: true })
  seedTrackingConfig(seeded.vendorId, {
    integrationMode: 'POLLING',
    pollingUrl:      URL_,
    pollingTokenEnc: encryptSecret('tok-secret'),
    pullStartedAt:   T0,
    notifyStatuses:  ['SHIPPED'],
    ...config,
  })
  return seeded
}

const calledUrl = (n = 0) => new URL(String(fetchMock.mock.calls[n][0]))
const configOf  = (vendorId: string) => rowsOf('orderTrackingConfig').find((c) => c.vendorId === vendorId)!

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  fetchMock.mockReset()
})

// ─────────────────────────────────────────────────────────────

describe('URL de polling', () => {
  it('exige HTTPS et une adresse publique en production', () => {
    expect(validatePollingUrl(URL_, true)).toEqual({ ok: true, url: URL_ })
    for (const bad of [
      'http://shop.example.com/events', 'ftp://shop.example.com/events', 'pas une url', '',
      'https://localhost/events', 'https://127.0.0.1/events', 'https://10.1.2.3/events',
      'https://192.168.1.10/events', 'https://169.254.169.254/latest', 'https://[::1]/events',
      'https://app.internal/events', 'https://user:pass@shop.example.com/events',
    ]) {
      expect(validatePollingUrl(bad, true).ok, bad).toBe(false)
    }
  })

  it('admet une boutique locale hors production', () => {
    expect(validatePollingUrl('http://localhost:3001/api/events', false).ok).toBe(true)
  })

  it('reconnaît les adresses non routables', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
})

describe('synchronisation par polling', () => {
  it('lit les événements, crée la commande et met la notification en file', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock.mockResolvedValue(json({ events: [event()] }))

    const summary = await syncStore(vendorId, { now: NOW })

    expect(summary).toMatchObject({ status: 'ok', received: 1, processed: 1, duplicates: 0, notifications: 1 })
    expect(rowsOf('order')[0]).toMatchObject({ vendorId, externalId: 'CMD-1', status: 'SHIPPED', rawStatus: 'Expédiée' })
    expect(rowsOf('notificationJob')).toHaveLength(1)
    expect(rowsOf('webhookLog')[0]).toMatchObject({ source: 'POLLING', outcome: 'PROCESSED', externalOrderId: 'CMD-1' })
  })

  it('interroge la boutique avec since, limit et le jeton déchiffré', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock.mockResolvedValue(json({ events: [] }))

    await syncStore(vendorId, { now: NOW })

    expect(calledUrl().origin + calledUrl().pathname).toBe(URL_)
    expect(calledUrl().searchParams.get('since')).toBe(T0.toISOString())
    expect(calledUrl().searchParams.get('limit')).toBe('100')
    const options = fetchMock.mock.calls[0][1]
    expect(options.headers.authorization).toBe('Bearer tok-secret')
    // La requête ne peut joindre que les adresses contrôlées.
    expect(options.addresses).toEqual([{ address: '203.0.113.10', family: 4 }])
  })

  it('ne rejoue rien quand la même réponse est relue', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock.mockImplementation(async () => json({ events: [event()] }))

    await syncStore(vendorId, { now: NOW })
    const second = await syncStore(vendorId, { now: NOW })

    expect(second).toMatchObject({ status: 'ok', processed: 0, duplicates: 1, notifications: 0 })
    expect(rowsOf('orderStatusEvent')).toHaveLength(1)
    expect(rowsOf('notificationJob')).toHaveLength(1)
    expect(rowsOf('webhookLog')).toHaveLength(1)
    // La lecture suivante repart du dernier changement vu.
    expect(calledUrl(1).searchParams.get('since')).toBe('2026-11-15T11:30:00.000Z')
    expect(configOf(vendorId)).toMatchObject({ pullLastOk: true, pullLastEvents: 0, pullLockedAt: null })
  })

  it('utilise l’identifiant fourni par la boutique quand il existe', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock.mockResolvedValue(json({ events: [event({ event_id: 'evt_boutique_1' })] }))

    await syncStore(vendorId, { now: NOW })

    expect(rowsOf('orderStatusEvent')[0].eventId).toBe('evt_boutique_1')
  })

  it('n’annonce jamais un changement antérieur au branchement', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock.mockResolvedValue(json({ events: [event({ updated_at: '2026-11-10T09:00:00.000Z' })] }))

    const summary = await syncStore(vendorId, { now: NOW })

    expect(summary).toMatchObject({ status: 'ok', processed: 1, notifications: 0 })
    expect(rowsOf('order')).toHaveLength(1)
    expect(rowsOf('notificationJob')).toHaveLength(0)
  })

  it('écarte un événement invalide sans perdre les autres', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock.mockResolvedValue(json({ events: [{ order_id: 'CMD-9' }, 'n’importe quoi', event()] }))

    const summary = await syncStore(vendorId, { now: NOW })

    expect(summary).toMatchObject({ status: 'ok', received: 3, processed: 1, invalid: 2 })
    expect(rowsOf('webhookLog').map((l) => l.outcome).sort()).toEqual(['INVALID_PAYLOAD', 'INVALID_PAYLOAD', 'PROCESSED'])
  })

  it('accepte une réponse réduite au tableau d’événements', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock.mockResolvedValue(json([event()]))

    expect(await syncStore(vendorId, { now: NOW })).toMatchObject({ status: 'ok', processed: 1 })
  })

  it('suit la pagination avec le curseur de la boutique', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock
      .mockResolvedValueOnce(json({ events: [event()], next_cursor: 'page-2', has_more: true }))
      .mockResolvedValueOnce(json({ events: [event({ order_id: 'CMD-2' })], next_cursor: null, has_more: false }))

    const summary = await syncStore(vendorId, { now: NOW })

    expect(summary.processed).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(calledUrl(1).searchParams.get('cursor')).toBe('page-2')
  })

  it('enregistre l’échec quand la boutique répond une erreur, et libère le verrou', async () => {
    const { vendorId } = seedPollingStore()
    fetchMock.mockResolvedValue(json({ error: 'non' }, 401))

    const summary = await syncStore(vendorId, { now: NOW })

    expect(summary.status).toBe('error')
    expect(summary.error).toContain('401')
    expect(configOf(vendorId)).toMatchObject({ pullLastOk: false, pullLockedAt: null })
    expect(configOf(vendorId).pullLastError).toContain('jeton refusé')
    expect(rowsOf('webhookLog')[0]).toMatchObject({ source: 'POLLING', outcome: 'PULL_ERROR', httpStatus: 401 })
    expect(rowsOf('order')).toHaveLength(0)
  })

  it('traite comme un échec une réponse illisible, une redirection ou un délai dépassé', async () => {
    const { vendorId } = seedPollingStore()

    fetchMock.mockResolvedValueOnce({ status: 200, body: '<html>' })
    expect((await syncStore(vendorId, { now: NOW })).error).toContain('JSON')

    fetchMock.mockResolvedValueOnce({ status: 302, body: '' })
    expect((await syncStore(vendorId, { now: NOW })).error).toContain('redirection')

    fetchMock.mockRejectedValueOnce(new PullError('La boutique n’a pas répondu en 10 secondes'))
    const timedOut = await syncStore(vendorId, { now: NOW })
    expect(timedOut.error).toContain('pas répondu')
    expect(rowsOf('webhookLog').at(-1)).toMatchObject({ outcome: 'PULL_ERROR', httpStatus: 0 })
  })

  it('ne lance pas deux synchronisations en même temps, mais reprend un verrou abandonné', async () => {
    const { vendorId } = seedPollingStore({ pullLockedAt: new Date(NOW.getTime() - 60_000) })
    fetchMock.mockResolvedValue(json({ events: [] }))

    expect(await syncStore(vendorId, { now: NOW })).toMatchObject({ status: 'skipped', reason: 'locked' })
    expect(fetchMock).not.toHaveBeenCalled()

    configOf(vendorId).pullLockedAt = new Date(NOW.getTime() - 10 * 60_000)
    expect((await syncStore(vendorId, { now: NOW })).status).toBe('ok')
  })

  it('ne synchronise ni une boutique en mode webhook, ni un service désactivé, ni une source incomplète', async () => {
    const webhook = seedVendor({ orderTrackingEnabled: true })
    seedTrackingConfig(webhook.vendorId, { pollingUrl: URL_ })
    expect(await syncStore(webhook.vendorId)).toMatchObject({ status: 'skipped', reason: 'wrong_mode' })

    const off = seedVendor({ orderTrackingEnabled: false })
    seedTrackingConfig(off.vendorId, { integrationMode: 'POLLING', pollingUrl: URL_ })
    expect(await syncStore(off.vendorId)).toMatchObject({ status: 'skipped', reason: 'disabled' })

    const noUrl = seedPollingStore({ pollingUrl: null })
    expect(await syncStore(noUrl.vendorId)).toMatchObject({ status: 'skipped', reason: 'not_configured' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('le passage planifié ne prend que les boutiques en polling ou connecteur', async () => {
    seedPollingStore()
    seedPollingStore()
    const webhook = seedVendor({ orderTrackingEnabled: true })
    seedTrackingConfig(webhook.vendorId, {})
    fetchMock.mockImplementation(async () => json({ events: [] }))

    const run = await syncDueStores({ now: NOW })

    expect(run).toMatchObject({ stores: 2, ok: 2, failed: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('connecteurs', () => {
  it('un connecteur disponible alimente la même ingestion que le polling', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })
    seedTrackingConfig(vendorId, {
      integrationMode: 'CONNECTOR',
      connectorId:     'fake',
      connectorCredentialsEnc: encryptSecret(JSON.stringify({ api_key: 'k-123' })),
      pullStartedAt:   T0,
      notifyStatuses:  ['SHIPPED'],
    })
    fakePull.mockResolvedValue({ events: [event()], nextCursor: null, hasMore: false })

    const summary = await syncStore(vendorId, { now: NOW })

    expect(summary).toMatchObject({ status: 'ok', processed: 1, notifications: 1 })
    expect(fakePull).toHaveBeenCalledWith({ api_key: 'k-123' }, expect.objectContaining({ since: T0, cursor: null }))
    expect(rowsOf('webhookLog')[0]).toMatchObject({ source: 'CONNECTOR', outcome: 'PROCESSED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un connecteur à venir ne synchronise rien', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })
    seedTrackingConfig(vendorId, { integrationMode: 'CONNECTOR', connectorId: 'yalidine' })

    expect(await syncStore(vendorId)).toMatchObject({ status: 'skipped', reason: 'not_configured' })
  })
})

describe('une seule source à la fois', () => {
  async function send(vendorId: string, isTest = false) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const rawBody   = JSON.stringify(event({ updated_at: new Date().toISOString() }))
    return processOrderWebhook({
      vendorId, eventId: 'evt_w1', timestamp, rawBody, isTest,
      signature: computeSignature('whsec_s', timestamp, 'evt_w1', rawBody),
    })
  }

  it('refuse un webhook quand la boutique est en mode polling', async () => {
    const { vendorId } = seedPollingStore({ webhookSecretEnc: encryptSecret('whsec_s') })

    const result = await send(vendorId)

    expect(result.response.status).toBe(403)
    expect(await result.response.json()).toMatchObject({ code: 'INTEGRATION_MODE_MISMATCH' })
    expect(rowsOf('order')).toHaveLength(0)
    expect(rowsOf('webhookLog')[0]).toMatchObject({ outcome: 'WRONG_MODE', httpStatus: 403 })
  })

  it('laisse passer le webhook de test du tableau de bord', async () => {
    const { vendorId } = seedPollingStore({ webhookSecretEnc: encryptSecret('whsec_s') })
    expect((await send(vendorId, true)).response.status).toBe(200)
  })

  it('accepte toujours le webhook en mode webhook', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })
    seedTrackingConfig(vendorId, { webhookSecretEnc: encryptSecret('whsec_s') })
    expect((await send(vendorId)).response.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────

describe('réglages du mode d’intégration', () => {
  async function patch(vendorId: string, body: unknown) {
    mockSession.mockResolvedValue({ user: { id: `user_${vendorId}`, role: 'VENDOR' } })
    const { PATCH } = await import('@/app/api/order-tracking/settings/route')
    return PATCH(new NextRequest('http://localhost:3000/api/order-tracking/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
  }
  async function read(vendorId: string) {
    mockSession.mockResolvedValue({ user: { id: `user_${vendorId}`, role: 'VENDOR' } })
    const { GET } = await import('@/app/api/order-tracking/settings/route')
    return GET()
  }

  it('part du mode webhook et présente le catalogue des connecteurs', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })
    const { integration } = await (await read(vendorId)).json()

    expect(integration.mode).toBe('WEBHOOK')
    expect(integration.polling).toEqual({ url: null, tokenConfigured: false })
    expect(integration.connectors.length).toBeGreaterThan(0)
    expect(integration.connectors.every((c: { available: boolean }) => c.available === false)).toBe(true)
  })

  it('chiffre le jeton de polling et ne le renvoie jamais', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })

    expect((await patch(vendorId, { polling: { url: URL_, token: 'tok-secret' } })).status).toBe(200)

    const stored = configOf(vendorId)
    expect(stored.pollingUrl).toBe(URL_)
    expect(stored.pollingTokenEnc).not.toContain('tok-secret')
    expect(decryptSecret(stored.pollingTokenEnc)).toBe('tok-secret')
    // Enregistrer l'URL ne change pas de mode.
    expect(stored.integrationMode).toBe('WEBHOOK')

    const text = await (await read(vendorId)).text()
    expect(text).not.toContain('tok-secret')
    expect(text).not.toContain(stored.pollingTokenEnc)
    expect(JSON.parse(text).integration.polling).toEqual({ url: URL_, tokenConfigured: true })
  })

  it('n’active le polling qu’avec une URL, et repart alors de maintenant', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })

    expect((await patch(vendorId, { integrationMode: 'POLLING' })).status).toBe(400)

    await patch(vendorId, { polling: { url: URL_ } })
    configOf(vendorId).pullCursor = '{"since":"2020-01-01T00:00:00.000Z","cursor":"vieux"}'
    const before = Date.now()
    expect((await patch(vendorId, { integrationMode: 'POLLING' })).status).toBe(200)

    const stored = configOf(vendorId)
    expect(stored.integrationMode).toBe('POLLING')
    expect(stored.pullCursor).toBeNull()
    expect(stored.pullStartedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('refuse une URL de polling invalide', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })
    for (const url of ['ftp://shop.example.com/x', 'pas une url', 'https://u:p@shop.example.com/x']) {
      expect((await patch(vendorId, { polling: { url } })).status, url).toBe(400)
    }
    expect(rowsOf('orderTrackingConfig')).toHaveLength(0)
  })

  it('refuse un connecteur à venir ou inconnu, et le mode connecteur sans connecteur', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })

    expect((await patch(vendorId, { integrationMode: 'CONNECTOR' })).status).toBe(400)
    expect((await patch(vendorId, { connector: { id: 'yalidine', credentials: {} } })).status).toBe(400)
    expect((await patch(vendorId, { connector: { id: 'inconnu', credentials: {} } })).status).toBe(400)
  })

  it('enregistre chiffrés les identifiants d’un connecteur disponible', async () => {
    const { vendorId } = seedVendor({ orderTrackingEnabled: true })

    expect((await patch(vendorId, { connector: { id: 'fake', credentials: {} } })).status).toBe(400)
    const res = await patch(vendorId, {
      integrationMode: 'CONNECTOR',
      connector: { id: 'fake', credentials: { api_key: 'k-123', inconnu: 'x' } },
    })

    expect(res.status).toBe(200)
    const stored = configOf(vendorId)
    expect(stored).toMatchObject({ integrationMode: 'CONNECTOR', connectorId: 'fake' })
    expect(JSON.parse(decryptSecret(stored.connectorCredentialsEnc))).toEqual({ api_key: 'k-123' })
    expect(await (await read(vendorId)).text()).not.toContain('k-123')
  })

  it('revient au mode webhook sans perdre les réglages du polling', async () => {
    const { vendorId } = seedPollingStore()

    expect((await patch(vendorId, { integrationMode: 'WEBHOOK' })).status).toBe(200)
    expect(configOf(vendorId)).toMatchObject({ integrationMode: 'WEBHOOK', pollingUrl: URL_ })
  })
})

describe('routes de synchronisation', () => {
  it('le bouton du tableau de bord exige une session et un mode où Flowmerce lit les statuts', async () => {
    const { POST } = await import('@/app/api/order-tracking/sync/route')

    mockSession.mockResolvedValue(null)
    expect((await POST()).status).toBe(401)

    const webhook = seedVendor({ orderTrackingEnabled: true })
    mockSession.mockResolvedValue({ user: { id: `user_${webhook.vendorId}`, role: 'VENDOR' } })
    expect((await POST()).status).toBe(409)

    const polling = seedPollingStore()
    mockSession.mockResolvedValue({ user: { id: `user_${polling.vendorId}`, role: 'VENDOR' } })
    fetchMock.mockResolvedValue(json({ events: [event({ updated_at: new Date().toISOString() })] }))
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', processed: 1 })
  })

  it('le cron exige CRON_SECRET', async () => {
    const { GET } = await import('@/app/api/cron/order-polling/route')
    const call = (auth?: string) =>
      GET(new NextRequest('http://localhost:3000/api/cron/order-polling', {
        headers: auth ? { authorization: auth } : {},
      }))

    expect((await call()).status).toBe(401)
    expect((await call('Bearer mauvais')).status).toBe(401)

    seedPollingStore()
    fetchMock.mockResolvedValue(json({ events: [] }))
    const res = await call(`Bearer ${'c'.repeat(40)}`)
    expect(res.status).toBe(200)
    expect((await res.json()).sync).toMatchObject({ stores: 1, ok: 1 })
  })
})
