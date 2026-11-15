// lib/order-tracking/worker.ts — Flowmerce · Suivi des commandes
//
// Worker de la file de notifications.
//
// Cycle de vie d'un travail :
//
//   PENDING ──prise en charge──▶ PROCESSING ──envoi réussi──▶ SENT
//      ▲                              │
//      └──échec, tentatives restantes─┤   (nextAttemptAt repoussé)
//                                     └──échec définitif──▶ FAILED
//
// Prise en charge exclusive : un travail passe de PENDING à PROCESSING par une
// mise à jour conditionnelle (`WHERE status = 'PENDING'`). La base n'en laisse
// réussir qu'une — deux workers lancés au même instant ne peuvent pas obtenir
// le même travail, donc jamais envoyer deux fois le même message.
//
// Un worker interrompu en plein envoi laisse son travail en PROCESSING. Passé
// LOCK_TIMEOUT, le verrou est considéré comme abandonné et le travail est
// repris, selon la même règle d'exclusivité.
//
// Relance : délai croissant (1 min, 5 min, 30 min, 2 h), puis FAILED une fois
// `maxAttempts` atteint. `lastError` garde la dernière erreur du fournisseur.
//
// Le worker est réveillé après chaque webhook accepté et par le cron
// /api/cron/order-notifications ; il n'envoie rien pendant la requête HTTP du
// webhook lui-même.

import type { NotificationJob } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { isServiceEnabled } from '@/lib/services/vendor-services'
import { getChannel } from './channels'
import { isLanguage, isMappableStatus } from './statuses'
import { readStoreTemplates, renderMessage } from './templates'

/** Délai avant la tentative suivante, selon le nombre de tentatives déjà faites. */
export const RETRY_DELAYS_SEC = [60, 300, 1800, 7200] as const

/** Au-delà, un travail resté en PROCESSING est considéré comme abandonné. */
export const LOCK_TIMEOUT_MS = 10 * 60 * 1000

const DEFAULT_BATCH = 20

export function retryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAYS_SEC.length) - 1
  return RETRY_DELAYS_SEC[index] * 1000
}

export interface WorkerSummary {
  claimed: number
  sent:    number
  retried: number
  failed:  number
}

/** Échec qu'une nouvelle tentative ne corrigera pas. */
class PermanentFailure extends Error {}

// ─────────────────────────────────────────────────────────────
// Prise en charge exclusive
// ─────────────────────────────────────────────────────────────

async function claimJob(jobId: string, now: Date): Promise<NotificationJob | null> {
  const claim = { status: 'PROCESSING' as const, lockedAt: now, attempts: { increment: 1 } }

  const fresh = await prisma.notificationJob.updateMany({
    where: { id: jobId, status: 'PENDING', nextAttemptAt: { lte: now } },
    data:  claim,
  })

  if (fresh.count !== 1) {
    // Verrou abandonné par un worker interrompu.
    const stale = await prisma.notificationJob.updateMany({
      where: {
        id:       jobId,
        status:   'PROCESSING',
        lockedAt: { lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) },
      },
      data: claim,
    })
    if (stale.count !== 1) return null
  }

  return prisma.notificationJob.findUnique({ where: { id: jobId } })
}

// ─────────────────────────────────────────────────────────────
// Envoi
// ─────────────────────────────────────────────────────────────

async function deliver(job: NotificationJob): Promise<void> {
  const [order, vendor] = await Promise.all([
    prisma.order.findUnique({ where: { id: job.orderId } }),
    prisma.vendor.findUnique({
      where:  { id: job.vendorId },
      select: {
        companyName:          true,
        orderTrackingEnabled: true,
        orderTrackingConfig:  { select: { messageTemplates: true } },
      },
    }),
  ])

  if (!order || !vendor) throw new PermanentFailure('Commande ou boutique introuvable')
  // Seul le drapeau du suivi compte ici : l'état de Retours-ML n'entre pas en jeu.
  if (!isServiceEnabled(vendor, 'orderTracking')) {
    throw new PermanentFailure('Suivi des commandes désactivé pour cette boutique')
  }
  if (!isMappableStatus(job.orderStatus)) {
    throw new PermanentFailure(`Statut non notifiable : ${job.orderStatus}`)
  }

  const channel = getChannel(job.channel)
  if (!channel.isAvailable()) throw new Error(`Canal ${job.channel} indisponible`)

  const message = renderMessage(
    {
      status:         job.orderStatus,
      language:       isLanguage(job.language) ? job.language : 'fr',
      shopName:       vendor.companyName,
      orderId:        order.externalId,
      customerName:   order.customerName,
      trackingNumber: order.trackingNumber,
      carrier:        order.carrier,
      trackingUrl:    order.trackingUrl,
    },
    readStoreTemplates(vendor.orderTrackingConfig?.messageTemplates),
  )

  await channel.send({ recipient: job.recipient, shopName: vendor.companyName, message })
}

type JobResult = 'sent' | 'retried' | 'failed'

async function runJob(job: NotificationJob): Promise<JobResult> {
  // Toute écriture de fin est conditionnée à l'état PROCESSING : si le verrou
  // a été repris entre-temps, ce worker n'écrase pas le résultat de l'autre.
  const settle = (data: Parameters<typeof prisma.notificationJob.updateMany>[0]['data']) =>
    prisma.notificationJob.updateMany({ where: { id: job.id, status: 'PROCESSING' }, data })

  // Travail repris après abandon alors que toutes ses tentatives étaient
  // consommées : on n'envoie plus.
  if (job.attempts > job.maxAttempts) {
    await settle({ status: 'FAILED', lockedAt: null, lastError: job.lastError ?? 'Tentatives épuisées' })
    return 'failed'
  }

  try {
    await deliver(job)
    await settle({ status: 'SENT', sentAt: new Date(), lockedAt: null, lastError: null })
    log.info('order_tracking.notification_sent', {
      jobId: job.id, vendorId: job.vendorId, channel: job.channel, attempt: job.attempts,
    })
    return 'sent'
  } catch (err) {
    const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    const definitive = err instanceof PermanentFailure || job.attempts >= job.maxAttempts

    if (definitive) {
      await settle({ status: 'FAILED', lockedAt: null, lastError })
      log.error('order_tracking.notification_failed', {
        jobId: job.id, vendorId: job.vendorId, attempts: job.attempts, err: lastError,
      })
      return 'failed'
    }

    await settle({
      status:        'PENDING',
      lockedAt:      null,
      lastError,
      nextAttemptAt: new Date(Date.now() + retryDelayMs(job.attempts)),
    })
    log.warn('order_tracking.notification_retry', {
      jobId: job.id, vendorId: job.vendorId, attempt: job.attempts, err: lastError,
    })
    return 'retried'
  }
}

// ─────────────────────────────────────────────────────────────
// Entrée publique
// ─────────────────────────────────────────────────────────────

export async function processDueNotificationJobs(
  { limit = DEFAULT_BATCH, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<WorkerSummary> {
  const summary: WorkerSummary = { claimed: 0, sent: 0, retried: 0, failed: 0 }

  const candidates = await prisma.notificationJob.findMany({
    where: {
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', lockedAt: { lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } },
      ],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take:    limit,
    select:  { id: true },
  })

  for (const { id } of candidates) {
    const job = await claimJob(id, now)
    if (!job) continue // pris par un autre worker

    summary.claimed++
    const result = await runJob(job).catch((err) => {
      // Échec de l'écriture de fin elle-même : le travail reste en PROCESSING
      // et sera repris à l'expiration du verrou.
      log.error('order_tracking.worker_error', { jobId: id, err: String(err) })
      return null
    })
    if (result === 'sent') summary.sent++
    else if (result === 'retried') summary.retried++
    else if (result === 'failed') summary.failed++
  }

  if (summary.claimed > 0) log.info('order_tracking.worker_batch', { ...summary })
  return summary
}
