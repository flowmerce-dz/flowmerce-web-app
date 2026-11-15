// lib/order-tracking/webhook.ts — Flowmerce · Suivi des commandes
//
// Traitement d'un webhook de commande, une fois la boutique identifiée par sa
// clé API et le service vérifié actif (cf. la route, via `validateApiKey`).
//
// Ordre des contrôles — chacun n'a lieu que si le précédent a réussi :
//
//   1. en-têtes présents et bien formés                              400 / 401
//   2. boutique en mode webhook, secret webhook configuré            403
//   3. signature HMAC-SHA256 (timestamp + eventId + corps brut)      401
//   4. horodatage dans la fenêtre de tolérance (anti-rejeu)          401
//   5. corps conforme au contrat                                     400
//   6. enregistrement transactionnel (idempotence, chronologie,
//      normalisation du statut, mise en file de la notification)     200 / 409
//
// La signature est vérifiée avant toute lecture du corps : un appelant qui ne
// détient pas le secret n'apprend rien de la validité de son contenu.
//
// Aucun e-mail ne part d'ici. La réponse est rendue dès que la transaction est
// validée ; l'envoi appartient au worker.
//
// Le même traitement sert le webhook de test du tableau de bord (`isTest`) :
// il traverse tous les contrôles et la normalisation du statut, mais n'écrit
// ni commande, ni historique, ni notification.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { log } from '@/lib/logger'
import {
  SecretStorageError,
  decryptSecret,
  isTimestampFresh,
  parseTimestamp,
  verifySignature,
} from './crypto'
import { ingestOrderEvent, type IngestResult } from './ingest'
import { isPullMode } from './integration'
import { parseOrderEvent } from './payload'
import { resolveStatus } from './statuses'

/** Taille maximale du corps accepté, en octets. */
export const MAX_BODY_BYTES = 256 * 1024

const EVENT_ID_RE = /^[\x21-\x7E]{1,200}$/

export type WebhookOutcome =
  | 'PROCESSED'
  | 'STALE'
  | 'UNMAPPED'
  | 'DUPLICATE'
  | 'TEST_OK'
  | 'INVALID_REQUEST'
  | 'INVALID_SIGNATURE'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_PAYLOAD'
  | 'NOT_CONFIGURED'
  | 'WRONG_MODE'
  | 'ERROR'

export interface WebhookInput {
  vendorId:  string
  signature: string | null
  eventId:   string | null
  timestamp: string | null
  rawBody:   string
  /** Webhook de test du tableau de bord : aucun enregistrement de commande. */
  isTest?:   boolean
  now?:      Date
}

export interface WebhookResult {
  response: NextResponse
  outcome:  WebhookOutcome
  /** Un événement a-t-il été enregistré ? (déclenche le réveil du worker) */
  accepted: boolean
}

interface LogFields {
  eventId?:         string | null
  externalOrderId?: string | null
  rawStatus?:       string | null
  error?:           string | null
}

export async function processOrderWebhook(input: WebhookInput): Promise<WebhookResult> {
  const startedAt = Date.now()
  const now       = input.now ?? new Date()
  const isTest    = input.isTest ?? false
  const { vendorId } = input

  const finish = async (
    outcome: WebhookOutcome,
    status:  number,
    body:    Record<string, unknown>,
    fields:  LogFields = {},
  ): Promise<WebhookResult> => {
    // Journal consultable par le vendeur. Son échec ne doit jamais faire
    // échouer un webhook par ailleurs traité.
    await prisma.webhookLog
      .create({
        data: {
          vendorId,
          eventId:         fields.eventId?.slice(0, 200) ?? null,
          externalOrderId: fields.externalOrderId ?? null,
          rawStatus:       fields.rawStatus ?? null,
          outcome,
          httpStatus:      status,
          error:           fields.error?.slice(0, 500) ?? null,
          isTest,
          durationMs:      Date.now() - startedAt,
        },
      })
      .catch((err) => log.error('order_tracking.webhook_log_error', { vendorId, err: String(err) }))

    return {
      response: NextResponse.json(body, { status }),
      outcome,
      accepted: status === 200 && !isTest,
    }
  }

  const fail = (
    outcome: WebhookOutcome,
    status:  number,
    code:    string,
    error:   string,
    fields:  LogFields = {},
    extra:   Record<string, unknown> = {},
  ) => finish(outcome, status, { error, code, ...extra }, { ...fields, error })

  // ── 1. En-têtes ────────────────────────────────────────────────────────
  const eventId = input.eventId?.trim() ?? ''
  if (!EVENT_ID_RE.test(eventId)) {
    return fail('INVALID_REQUEST', 400, 'INVALID_EVENT_ID',
      'En-tête X-Flowmerce-Event-Id manquant ou invalide (1 à 200 caractères ASCII sans espace)')
  }

  const timestamp = input.timestamp?.trim() ?? ''
  const sentAt    = parseTimestamp(timestamp)
  if (!sentAt) {
    return fail('INVALID_REQUEST', 400, 'INVALID_TIMESTAMP_FORMAT',
      'En-tête X-Flowmerce-Timestamp manquant ou invalide (secondes Unix attendues)', { eventId })
  }

  if (!input.signature) {
    return fail('INVALID_SIGNATURE', 401, 'MISSING_SIGNATURE',
      'En-tête X-Flowmerce-Signature manquant', { eventId })
  }

  if (Buffer.byteLength(input.rawBody, 'utf8') > MAX_BODY_BYTES) {
    return fail('INVALID_REQUEST', 400, 'PAYLOAD_TOO_LARGE',
      `Corps trop volumineux (maximum ${MAX_BODY_BYTES / 1024} Ko)`, { eventId })
  }

  // ── 2. Secret de la boutique ───────────────────────────────────────────
  let config
  let secret: string
  try {
    config = await prisma.orderTrackingConfig.findUnique({ where: { vendorId } })
    // Une seule source à la fois : si la boutique est synchronisée par polling
    // ou par un connecteur, un webhook décrirait une seconde fois les mêmes
    // changements et le client serait prévenu deux fois. Le webhook de test du
    // tableau de bord reste utilisable pour préparer un retour à ce mode.
    if (config && isPullMode(config.integrationMode) && !isTest) {
      return fail('WRONG_MODE', 403, 'INTEGRATION_MODE_MISMATCH',
        'Cette boutique n’est pas en mode webhook : ses statuts sont lus par Flowmerce', { eventId })
    }
    if (!config?.webhookSecretEnc) {
      return fail('NOT_CONFIGURED', 403, 'WEBHOOK_SECRET_NOT_CONFIGURED',
        'Aucun secret webhook n’a été généré pour cette boutique', { eventId })
    }
    secret = decryptSecret(config.webhookSecretEnc)
  } catch (err) {
    log.error('order_tracking.webhook_secret_error', {
      vendorId,
      kind: err instanceof SecretStorageError ? 'secret_storage' : 'database',
      err:  err instanceof Error ? err.message : String(err),
    })
    return fail('ERROR', 500, 'INTERNAL_ERROR', 'Erreur interne', { eventId })
  }

  // ── 3. Signature ───────────────────────────────────────────────────────
  if (!verifySignature(secret, input.signature, timestamp, eventId, input.rawBody)) {
    return fail('INVALID_SIGNATURE', 401, 'INVALID_SIGNATURE', 'Signature invalide', { eventId })
  }

  // ── 4. Anti-rejeu ──────────────────────────────────────────────────────
  if (!isTimestampFresh(sentAt, now)) {
    return fail('INVALID_TIMESTAMP', 401, 'TIMESTAMP_OUT_OF_RANGE',
      'Horodatage hors de la fenêtre de tolérance (5 minutes)', { eventId })
  }

  // ── 5. Corps ───────────────────────────────────────────────────────────
  const parsed = parseOrderEvent(input.rawBody, now)
  if (!parsed.ok) {
    return fail('INVALID_PAYLOAD', 400, 'INVALID_PAYLOAD', parsed.error, { eventId },
      parsed.details ? { details: parsed.details } : {})
  }
  const { payload } = parsed
  const fields: LogFields = {
    eventId,
    externalOrderId: payload.orderId,
    rawStatus:       payload.rawStatus,
  }

  // ── Webhook de test : contrôles et normalisation, sans rien enregistrer ─
  if (isTest) {
    const mappings = await prisma.storeStatusMapping.findMany({
      where:  { vendorId },
      select: { normalizedKey: true, status: true },
    })
    const status = resolveStatus(payload.rawStatus, mappings)
    return finish('TEST_OK', 200, {
      received: true,
      test:     true,
      event_id: eventId,
      order_id: payload.orderId,
      status,
      would_notify: status !== 'UNMAPPED' && config.notifyStatuses.includes(status),
    }, fields)
  }

  // ── 6. Enregistrement ──────────────────────────────────────────────────
  let result: IngestResult
  try {
    result = await ingestOrderEvent({ vendorId, eventId, payload, settings: config })
  } catch (err) {
    log.error('order_tracking.ingest_error', {
      vendorId, eventId, err: err instanceof Error ? err.message : String(err),
    })
    return fail('ERROR', 500, 'INTERNAL_ERROR', 'Erreur interne', fields)
  }

  if (result.outcome === 'DUPLICATE') {
    // Événement déjà reçu : rien n'a été rejoué. L'émetteur peut considérer
    // l'événement comme livré et ne doit pas le renvoyer.
    return fail('DUPLICATE', 409, 'DUPLICATE_EVENT', 'Événement déjà reçu', fields, {
      event_id: eventId,
      order_id: payload.orderId,
      status:   result.currentStatus,
    })
  }

  log.info('order_tracking.event_ingested', {
    vendorId, eventId, outcome: result.outcome, status: result.status,
    notification: result.notification,
  })

  return finish(result.outcome, 200, {
    received:     true,
    event_id:     eventId,
    order_id:     payload.orderId,
    // Statut normalisé de l'événement, et statut courant de la commande : ils
    // diffèrent quand l'événement est arrivé en retard ou n'est pas reconnu.
    event_status: result.status,
    status:       result.currentStatus,
    applied:      result.applied,
    outcome:      result.outcome.toLowerCase(),
    notification: result.notification,
    ...(payload.ignored.length ? { ignored: payload.ignored } : {}),
  }, fields)
}
