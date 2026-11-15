// lib/order-tracking/ingest.ts — Flowmerce · Suivi des commandes
//
// Enregistrement d'un événement de commande déjà authentifié et validé.
//
// Tout se passe dans UNE transaction : la commande, la ligne d'historique et,
// le cas échéant, le travail de notification. Soit les trois existent, soit
// aucun — un événement enregistré sans sa notification, ou l'inverse, ne peut
// pas apparaître.
//
// Garanties :
//
//   Idempotence      un événement est identifié par (boutique, eventId). Reçu
//                    une seconde fois, il ne crée rien : ni historique, ni
//                    notification. La contrainte d'unicité en base tranche
//                    aussi le cas de deux requêtes simultanées.
//
//   Chronologie      le statut courant ne régresse jamais. Un événement plus
//                    ancien que celui qui a fixé le statut courant est conservé
//                    dans l'historique (`applied = false`) sans rien changer à
//                    la commande, et ne notifie personne.
//
//   Statut inconnu   conservé comme `UNMAPPED` avec son libellé d'origine. Il
//                    n'écrase pas un statut reconnu et ne notifie personne.
//
// Aucun envoi n'a lieu ici : la notification est seulement mise en file.

import { Prisma, type NotificationChannel, type OrderStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getChannel } from './channels'
import type { OrderEventPayload } from './payload'
import { isLanguage, resolveStatus, type TrackingStatus } from './statuses'

export interface IngestSettings {
  notifyStatuses:      OrderStatus[]
  notificationChannel: NotificationChannel
  defaultLanguage:     string
}

export type IngestOutcome = 'PROCESSED' | 'STALE' | 'UNMAPPED' | 'DUPLICATE'

export type NotificationDecision =
  | 'queued'               // travail créé
  | 'none'                 // événement sans effet sur le statut courant
  | 'not_selected'         // statut non coché par le vendeur
  | 'channel_unavailable'  // canal choisi sans fournisseur branché
  | 'no_recipient'         // pas de coordonnée exploitable pour ce canal

export interface IngestResult {
  outcome:       IngestOutcome
  /** Statut normalisé de l'événement. */
  status:        TrackingStatus
  /** Statut de la commande après traitement. */
  currentStatus: TrackingStatus
  applied:       boolean
  notification:  NotificationDecision
}

interface IngestInput {
  vendorId: string
  eventId:  string
  payload:  OrderEventPayload
  settings: IngestSettings | null
}

const MAX_RETRIES = 2

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/** Ne garde que les champs effectivement transmis : un champ absent ne vide rien. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

export async function ingestOrderEvent(input: IngestInput): Promise<IngestResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction((tx) => ingestInTransaction(tx, input))
    } catch (err) {
      // Deux requêtes simultanées ont voulu créer la même commande ou le même
      // événement : la contrainte d'unicité a annulé la perdante. On rejoue —
      // elle trouvera cette fois la ligne de la gagnante (commande à mettre à
      // jour, ou événement déjà reçu).
      if (isUniqueViolation(err) && attempt < MAX_RETRIES) continue
      throw err
    }
  }
}

async function ingestInTransaction(
  tx: Prisma.TransactionClient,
  { vendorId, eventId, payload, settings }: IngestInput,
): Promise<IngestResult> {
  // ── 1. Idempotence ─────────────────────────────────────────────────────
  const known = await tx.orderStatusEvent.findUnique({
    where:  { vendorId_eventId: { vendorId, eventId } },
    select: { status: true, applied: true, order: { select: { status: true } } },
  })
  if (known) {
    return {
      outcome:       'DUPLICATE',
      status:        known.status,
      currentStatus: known.order.status,
      applied:       known.applied,
      notification:  'none',
    }
  }

  // ── 2. Normalisation du statut ─────────────────────────────────────────
  const mappings = await tx.storeStatusMapping.findMany({
    where:  { vendorId },
    select: { normalizedKey: true, status: true },
  })
  const status = resolveStatus(payload.rawStatus, mappings)
  const mapped = status !== 'UNMAPPED'

  const info = defined({
    customerName:     payload.customer.name,
    customerEmail:    payload.customer.email,
    customerPhone:    payload.customer.phone,
    customerLanguage: payload.customer.language,
    trackingNumber:   payload.trackingNumber,
    carrier:          payload.carrier,
    trackingUrl:      payload.trackingUrl,
    items:            payload.items as Prisma.InputJsonValue | undefined,
  })

  // ── 3. Commande ────────────────────────────────────────────────────────
  const existing = await tx.order.findUnique({
    where: { vendorId_externalId: { vendorId, externalId: payload.orderId } },
  })

  let order:   { id: string; status: OrderStatus; customerEmail: string | null; customerPhone: string | null; customerLanguage: string | null }
  let applied: boolean

  if (!existing) {
    order = await tx.order.create({
      data: {
        vendorId,
        externalId:      payload.orderId,
        status,
        rawStatus:       payload.rawStatus,
        statusUpdatedAt: payload.occurredAt,
        ...info,
      },
    })
    applied = true
  } else if (!mapped) {
    // Un statut inconnu n'écrase pas un statut reconnu : l'événement reste
    // dans l'historique, la commande ne bouge pas.
    order   = existing
    applied = false
  } else {
    // Mise à jour conditionnelle : elle n'a lieu que si aucun événement plus
    // récent n'a déjà fixé le statut. La condition est évaluée par la base au
    // moment de l'écriture — deux événements traités en parallèle ne peuvent
    // pas se doubler.
    const { count } = await tx.order.updateMany({
      where: { id: existing.id, statusUpdatedAt: { lte: payload.occurredAt } },
      data: {
        status,
        rawStatus:       payload.rawStatus,
        statusUpdatedAt: payload.occurredAt,
        ...info,
      },
    })
    applied = count === 1
    order   = applied
      ? {
          id:               existing.id,
          status,
          customerEmail:    payload.customer.email    ?? existing.customerEmail,
          customerPhone:    payload.customer.phone    ?? existing.customerPhone,
          customerLanguage: payload.customer.language ?? existing.customerLanguage,
        }
      : existing
  }

  // ── 4. Historique ──────────────────────────────────────────────────────
  const event = await tx.orderStatusEvent.create({
    data: {
      vendorId,
      orderId:    order.id,
      eventId,
      status,
      rawStatus:  payload.rawStatus,
      occurredAt: payload.occurredAt,
      applied,
    },
  })

  // ── 5. Notification — mise en file uniquement ──────────────────────────
  const notification = await enqueueNotification(tx, {
    vendorId, order, eventRowId: event.id, status, applied, mapped, settings,
  })

  return {
    outcome:       !mapped ? 'UNMAPPED' : applied ? 'PROCESSED' : 'STALE',
    status,
    currentStatus: order.status,
    applied,
    notification,
  }
}

async function enqueueNotification(
  tx: Prisma.TransactionClient,
  args: {
    vendorId:   string
    order:      { id: string; customerEmail: string | null; customerPhone: string | null; customerLanguage: string | null }
    eventRowId: string
    status:     OrderStatus
    applied:    boolean
    mapped:     boolean
    settings:   IngestSettings | null
  },
): Promise<NotificationDecision> {
  const { vendorId, order, eventRowId, status, applied, mapped, settings } = args

  if (!applied || !mapped) return 'none'
  if (!settings || !settings.notifyStatuses.includes(status)) return 'not_selected'

  const channel = getChannel(settings.notificationChannel)
  if (!channel.isAvailable()) return 'channel_unavailable'

  const recipient = channel.channel === 'EMAIL' ? order.customerEmail : order.customerPhone
  if (!recipient || !channel.acceptsRecipient(recipient)) return 'no_recipient'

  const language = isLanguage(order.customerLanguage)
    ? order.customerLanguage
    : isLanguage(settings.defaultLanguage) ? settings.defaultLanguage : 'fr'

  await tx.notificationJob.create({
    data: {
      vendorId,
      orderId:     order.id,
      eventId:     eventRowId,
      channel:     channel.channel,
      orderStatus: status,
      recipient,
      language,
    },
  })
  return 'queued'
}
