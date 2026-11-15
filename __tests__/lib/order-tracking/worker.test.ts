// Worker de la file de notifications (lib/order-tracking/worker.ts) :
// envoi, échec du fournisseur e-mail, relances à délai croissant, échec
// définitif et exclusivité de la prise en charge.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('@/__tests__/helpers/fake-tracking-db')).fakeDb,
}))
vi.mock('@/lib/env', () => ({ env: { GMAIL_USER: 'flowmerce@example.com' } }))
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const mockSendMail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mailer', () => ({
  createMailTransport: () => ({ sendMail: mockSendMail }),
}))

import { resetDb, rowsOf, seedTrackingConfig, seedVendor } from '@/__tests__/helpers/fake-tracking-db'
import {
  LOCK_TIMEOUT_MS,
  RETRY_DELAYS_SEC,
  processDueNotificationJobs,
  retryDelayMs,
} from '@/lib/order-tracking/worker'

let vendorId: string

function seedJob(over: Record<string, unknown> = {}) {
  const order = {
    id: 'o1', vendorId, externalId: 'CABA-10452', status: 'SHIPPED', rawStatus: 'Expédiée',
    statusUpdatedAt: new Date(), customerName: 'Amine B.', customerEmail: 'amine@example.com',
    trackingNumber: 'YAL-123456', carrier: 'yalidine', trackingUrl: null,
  }
  if (!rowsOf('order').length) rowsOf('order').push(order)

  const job = {
    id: `job_${rowsOf('notificationJob').length + 1}`,
    vendorId, orderId: 'o1', eventId: `e_${rowsOf('notificationJob').length + 1}`,
    channel: 'EMAIL', status: 'PENDING', orderStatus: 'SHIPPED',
    recipient: 'amine@example.com', language: 'fr',
    attempts: 0, maxAttempts: 5, nextAttemptAt: new Date(Date.now() - 1000),
    lockedAt: null, lastError: null, sentAt: null, createdAt: new Date(),
    ...over,
  }
  rowsOf('notificationJob').push(job)
  return job
}

const job = (i = 0) => rowsOf('notificationJob')[i]

/** Lance le worker assez loin dans le futur pour que toute relance soit due. */
const runLater = () => processDueNotificationJobs({ now: new Date(Date.now() + 24 * 3600 * 1000) })

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  mockSendMail.mockResolvedValue({})
  vendorId = seedVendor({ orderTrackingEnabled: true }).vendorId
  seedTrackingConfig(vendorId, {})
})

describe('envoi', () => {
  it('envoie l’e-mail et marque le travail SENT', async () => {
    seedJob()
    const summary = await processDueNotificationJobs()

    expect(summary).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 })
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail.mock.calls[0][0]).toMatchObject({
      to:      'amine@example.com',
      from:    '"Caba Store" <flowmerce@example.com>',
      subject: 'Caba Store — Commande CABA-10452 : Expédiée',
    })
    expect(job()).toMatchObject({ status: 'SENT', attempts: 1, lockedAt: null, lastError: null })
    expect(job().sentAt).toBeInstanceOf(Date)
  })

  it('ne prend pas un travail dont l’échéance n’est pas arrivée', async () => {
    seedJob({ nextAttemptAt: new Date(Date.now() + 60_000) })
    expect((await processDueNotificationJobs()).claimed).toBe(0)
    expect(mockSendMail).not.toHaveBeenCalled()
    expect(job().status).toBe('PENDING')
  })

  it('ne renvoie jamais un travail déjà envoyé', async () => {
    seedJob()
    await processDueNotificationJobs()
    await runLater()
    expect(mockSendMail).toHaveBeenCalledTimes(1)
  })
})

describe('échec du fournisseur e-mail', () => {
  it('remet le travail en attente avec l’erreur et une échéance repoussée', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP 421 service indisponible'))
    seedJob()

    const before  = Date.now()
    const summary = await processDueNotificationJobs()

    expect(summary).toEqual({ claimed: 1, sent: 0, retried: 1, failed: 0 })
    expect(job()).toMatchObject({
      status: 'PENDING', attempts: 1, lockedAt: null,
      lastError: 'SMTP 421 service indisponible', sentAt: null,
    })
    // Première relance : 1 minute.
    expect(job().nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 60_000)

    // Pas de relance avant l'échéance.
    await processDueNotificationJobs()
    expect(mockSendMail).toHaveBeenCalledTimes(1)
  })

  it('aboutit si le fournisseur revient avant la dernière tentative', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP indisponible')).mockResolvedValue({})
    seedJob()

    await processDueNotificationJobs()
    await runLater()

    expect(job()).toMatchObject({ status: 'SENT', attempts: 2, lastError: null })
  })

  it('espace les relances de plus en plus', () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual(RETRY_DELAYS_SEC.map((s) => s * 1000))
    expect(retryDelayMs(9)).toBe(RETRY_DELAYS_SEC[RETRY_DELAYS_SEC.length - 1] * 1000)
    expect([...RETRY_DELAYS_SEC]).toEqual([...RETRY_DELAYS_SEC].sort((a, b) => a - b))
  })

  it('passe en échec définitif une fois les tentatives épuisées, puis n’essaie plus', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP indisponible'))
    seedJob()

    const outcomes = []
    for (let i = 0; i < 5; i++) outcomes.push(await runLater())

    expect(outcomes.map((o) => (o.failed ? 'failed' : 'retried'))).toEqual([
      'retried', 'retried', 'retried', 'retried', 'failed',
    ])
    expect(job()).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'SMTP indisponible' })

    await runLater()
    expect(mockSendMail).toHaveBeenCalledTimes(5)
  })

  it('n’empêche pas les autres travaux d’être envoyés', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('boîte pleine')).mockResolvedValue({})
    seedJob()
    seedJob()

    expect(await processDueNotificationJobs()).toEqual({ claimed: 2, sent: 1, retried: 1, failed: 0 })
  })
})

describe('prise en charge exclusive', () => {
  it('n’envoie qu’une fois quand deux workers tournent en même temps', async () => {
    let release!: () => void
    mockSendMail.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    seedJob()

    const first  = processDueNotificationJobs()
    const second = processDueNotificationJobs()
    // Laisse les deux workers atteindre la prise en charge.
    await new Promise((r) => setTimeout(r, 20))
    release()
    const [a, b] = await Promise.all([first, second])

    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(a.claimed + b.claimed).toBe(1)
    expect(job()).toMatchObject({ status: 'SENT', attempts: 1 })
  })

  it('laisse en place un travail en cours dont le verrou est récent', async () => {
    seedJob({ status: 'PROCESSING', lockedAt: new Date(), attempts: 1 })
    expect((await processDueNotificationJobs()).claimed).toBe(0)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('reprend un travail abandonné par un worker interrompu', async () => {
    seedJob({ status: 'PROCESSING', lockedAt: new Date(Date.now() - LOCK_TIMEOUT_MS - 1000), attempts: 1 })

    expect(await processDueNotificationJobs()).toMatchObject({ claimed: 1, sent: 1 })
    expect(job()).toMatchObject({ status: 'SENT', attempts: 2 })
  })
})

describe('indépendance vis-à-vis de Retours-ML', () => {
  it('envoie la notification quand Retours-ML est désactivé', async () => {
    rowsOf('vendor')[0].returnsMLEnabled = false
    seedJob()

    expect((await processDueNotificationJobs()).sent).toBe(1)
  })

  it('n’envoie rien si le suivi a été désactivé entre-temps, sans relance', async () => {
    rowsOf('vendor')[0].orderTrackingEnabled = false
    seedJob()

    expect(await processDueNotificationJobs()).toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1 })
    expect(mockSendMail).not.toHaveBeenCalled()
    expect(job().status).toBe('FAILED')
  })
})
