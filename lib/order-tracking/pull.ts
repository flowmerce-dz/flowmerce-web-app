// lib/order-tracking/pull.ts — Flowmerce · Suivi des commandes
//
// Synchronisation des boutiques en mode polling ou connecteur : Flowmerce va
// chercher les changements de statut au lieu de les recevoir.
//
// Seule la réception diffère du webhook. Chaque événement lu passe ensuite par
// la même ingestion transactionnelle (ingest.ts) : normalisation du statut,
// idempotence, chronologie, mise en file de la notification.
//
// Garanties propres à ce mode :
//
//   Idempotence      l'identifiant d'un événement est celui que la source
//                    fournit (`event_id`), sinon une empreinte de (commande,
//                    statut, date). Relire deux fois la même page ne crée rien.
//
//   Pas de rattrapage  un changement antérieur au branchement de la source est
//                    enregistré mais jamais annoncé au client : la première
//                    synchronisation ne réexpédie pas l'historique.
//
//   Exclusivité      un verrou par boutique empêche deux synchronisations
//                    simultanées (cron et bouton du tableau de bord).
//
//   Reprise          la position de lecture est enregistrée à chaque passage,
//                    réussi ou non : un échec reprend là où il s'est arrêté.

import { createHash } from 'node:crypto'
import type { OrderTrackingConfig } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import { isServiceEnabled } from '@/lib/services/vendor-services'
import { PullError, getConnector, type PullInput, type PullPage } from './connectors'
import { SecretStorageError, decryptSecret } from './crypto'
import { ingestOrderEvent } from './ingest'
import { isPullMode } from './integration'
import { parseOrderEventObject } from './payload'
import { fetchPollingPage } from './polling'
import { normalizeStatusKey } from './statuses'

/** Pages lues au plus par boutique et par passage. */
export const MAX_PAGES_PER_RUN = 3
/** Un verrou plus ancien est considéré comme abandonné. */
export const PULL_LOCK_TIMEOUT_MS = 5 * 60 * 1000
/** Lignes de journal écrites au plus pour les événements invalides d'un passage. */
const MAX_INVALID_LOGGED = 10

const EVENT_ID_RE = /^[\x21-\x7E]{1,200}$/

export type SkipReason = 'disabled' | 'wrong_mode' | 'not_configured' | 'locked'

export interface SyncSummary {
  status:        'ok' | 'error' | 'skipped'
  reason?:       SkipReason
  error?:        string
  /** Événements rendus par la source. */
  received:      number
  /** Événements nouveaux, enregistrés. */
  processed:     number
  duplicates:    number
  invalid:       number
  notifications: number
}

const emptySummary = (): Omit<SyncSummary, 'status'> => ({
  received: 0, processed: 0, duplicates: 0, invalid: 0, notifications: 0,
})

type Source = (input: PullInput) => Promise<PullPage>

/** Source de la boutique selon son mode, ou `null` si elle n'est pas prête. */
function resolveSource(config: OrderTrackingConfig): Source | null {
  if (config.integrationMode === 'POLLING') {
    if (!config.pollingUrl) return null
    const source = {
      url:   config.pollingUrl,
      token: config.pollingTokenEnc ? decryptSecret(config.pollingTokenEnc) : null,
    }
    return (input) => fetchPollingPage(source, input)
  }

  if (config.integrationMode === 'CONNECTOR') {
    const connector = getConnector(config.connectorId)
    if (!connector?.isAvailable() || !config.connectorCredentialsEnc) return null
    const credentials = JSON.parse(decryptSecret(config.connectorCredentialsEnc)) as Record<string, string>
    return (input) => connector.pull(credentials, input)
  }

  return null
}

// Position de lecture : la date du dernier changement vu, et le curseur opaque
// de la source si elle en fournit un.
interface Position { since: string; cursor: string | null }

function readPosition(raw: string | null, fallback: Date): { since: Date; cursor: string | null } {
  try {
    const p = JSON.parse(raw ?? '') as Partial<Position>
    const since = new Date(p.since ?? '')
    if (!Number.isNaN(since.getTime())) {
      return { since, cursor: typeof p.cursor === 'string' ? p.cursor : null }
    }
  } catch {
    // Position absente ou illisible : on repart du branchement.
  }
  return { since: fallback, cursor: null }
}

function derivedEventId(orderId: string, rawStatus: string, occurredAt: Date): string {
  const digest = createHash('sha256')
    .update(`${orderId}\n${normalizeStatusKey(rawStatus)}\n${occurredAt.toISOString()}`, 'utf8')
    .digest('hex')
  return `pull_${digest.slice(0, 40)}`
}

/** Synchronise une boutique. Ne lève jamais : l'échec est rendu dans le résumé. */
export async function syncStore(
  vendorId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<SyncSummary> {
  const skipped = (reason: SkipReason): SyncSummary => ({ status: 'skipped', reason, ...emptySummary() })

  const vendor = await prisma.vendor.findUnique({
    where:  { id: vendorId },
    select: { orderTrackingEnabled: true, returnsMLEnabled: true },
  })
  if (!vendor || !isServiceEnabled(vendor, 'orderTracking')) return skipped('disabled')

  const config = await prisma.orderTrackingConfig.findUnique({ where: { vendorId } })
  if (!config || !isPullMode(config.integrationMode)) return skipped('wrong_mode')

  let source: Source | null
  try {
    source = resolveSource(config)
  } catch (err) {
    log.error('order_tracking.pull_source_error', {
      vendorId,
      kind: err instanceof SecretStorageError ? 'secret_storage' : 'credentials',
      err:  err instanceof Error ? err.message : String(err),
    })
    source = null
  }
  if (!source) return skipped('not_configured')

  // Verrou : une seule synchronisation à la fois pour cette boutique.
  const { count } = await prisma.orderTrackingConfig.updateMany({
    where: {
      vendorId,
      OR: [
        { pullLockedAt: null },
        { pullLockedAt: { lt: new Date(now.getTime() - PULL_LOCK_TIMEOUT_MS) } },
      ],
    },
    data: { pullLockedAt: now },
  })
  if (count !== 1) return skipped('locked')

  const startedAt = config.pullStartedAt ?? now
  const position  = readPosition(config.pullCursor, startedAt)
  const totals    = emptySummary()
  const mode      = config.integrationMode
  let invalidLogged = 0
  let failure: PullError | null = null

  const writeLog = (data: {
    eventId?: string | null; externalOrderId?: string | null; rawStatus?: string | null
    outcome: string; httpStatus: number; error?: string | null
  }) =>
    prisma.webhookLog
      .create({ data: { vendorId, source: mode, ...data, error: data.error?.slice(0, 500) ?? null } })
      .catch((err) => log.error('order_tracking.pull_log_error', { vendorId, err: String(err) }))

  try {
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const result = await source({ since: position.since, cursor: position.cursor, now })
      totals.received += result.events.length

      for (const raw of result.events) {
        const parsed = parseOrderEventObject(raw, now)
        if (!parsed.ok) {
          totals.invalid++
          if (invalidLogged++ < MAX_INVALID_LOGGED) {
            const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
            await writeLog({
              externalOrderId: typeof item.order_id === 'string' ? item.order_id.slice(0, 200) : null,
              rawStatus:       typeof item.status === 'string' ? item.status.slice(0, 100) : null,
              outcome:         'INVALID_PAYLOAD',
              httpStatus:      400,
              error:           [parsed.error, ...(parsed.details ?? [])].join(' — '),
            })
          }
          continue
        }
        const { payload } = parsed

        const given   = (raw as { event_id?: unknown }).event_id
        const eventId = typeof given === 'string' && EVENT_ID_RE.test(given)
          ? given
          : derivedEventId(payload.orderId, payload.rawStatus, payload.occurredAt)

        const ingested = await ingestOrderEvent({
          vendorId,
          eventId,
          payload,
          // Antérieur au branchement : enregistré, jamais annoncé au client.
          settings: payload.occurredAt.getTime() < startedAt.getTime() ? null : config,
        })

        if (payload.occurredAt.getTime() > position.since.getTime()) position.since = payload.occurredAt

        if (ingested.outcome === 'DUPLICATE') {
          totals.duplicates++
          continue
        }
        totals.processed++
        if (ingested.notification === 'queued') totals.notifications++
        await writeLog({
          eventId,
          externalOrderId: payload.orderId,
          rawStatus:       payload.rawStatus,
          outcome:         ingested.outcome,
          httpStatus:      200,
        })
      }

      position.cursor = result.nextCursor
      if (!result.hasMore || result.events.length === 0) break
    }
  } catch (err) {
    failure = err instanceof PullError ? err : new PullError('Erreur interne pendant la synchronisation')
    if (!(err instanceof PullError)) {
      log.error('order_tracking.pull_error', {
        vendorId, err: err instanceof Error ? err.message : String(err),
      })
    }
    await writeLog({ outcome: 'PULL_ERROR', httpStatus: failure.httpStatus, error: failure.message })
  }

  await prisma.orderTrackingConfig.update({
    where: { vendorId },
    data: {
      pullLockedAt:   null,
      pullLastRunAt:  now,
      pullLastOk:     !failure,
      pullLastError:  failure ? failure.message.slice(0, 500) : null,
      pullLastEvents: totals.processed,
      pullCursor:     JSON.stringify({
        since:  position.since.toISOString(),
        cursor: position.cursor,
      } satisfies Position),
    },
  })

  log.info('order_tracking.pull_done', { vendorId, mode, ok: !failure, ...totals })

  return failure
    ? { status: 'error', error: failure.message, ...totals }
    : { status: 'ok', ...totals }
}

export interface SyncRunSummary {
  stores:        number
  ok:            number
  failed:        number
  skipped:       number
  processed:     number
  notifications: number
}

/**
 * Synchronise les boutiques en mode polling ou connecteur, en commençant par
 * celles qui attendent depuis le plus longtemps. S'arrête de prendre de
 * nouvelles boutiques une fois le budget de temps écoulé.
 */
export async function syncDueStores(
  { limit = 20, budgetMs = 240_000, now = new Date() }: { limit?: number; budgetMs?: number; now?: Date } = {},
): Promise<SyncRunSummary> {
  const began   = Date.now()
  const configs = await prisma.orderTrackingConfig.findMany({
    where:   { integrationMode: { in: ['POLLING', 'CONNECTOR'] } },
    orderBy: { pullLastRunAt: { sort: 'asc', nulls: 'first' } },
    take:    limit,
    select:  { vendorId: true },
  })

  const run: SyncRunSummary = { stores: 0, ok: 0, failed: 0, skipped: 0, processed: 0, notifications: 0 }
  for (const { vendorId } of configs) {
    if (Date.now() - began > budgetMs) break
    const summary = await syncStore(vendorId, { now })
    run.stores++
    if (summary.status === 'ok') run.ok++
    else if (summary.status === 'error') run.failed++
    else run.skipped++
    run.processed     += summary.processed
    run.notifications += summary.notifications
  }
  return run
}
