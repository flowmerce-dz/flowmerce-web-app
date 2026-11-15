// lib/order-tracking/payload.ts — Flowmerce · Suivi des commandes
//
// Contrat du corps de `POST /api/v1/webhooks/orders`.
//
//   {
//     "order_id": "CABA-10452",              obligatoire
//     "status": "Expédiée",                  obligatoire — libellé de la boutique
//     "updated_at": "2026-11-14T17:20:00Z",  obligatoire — ISO-8601 avec fuseau
//     "customer": { "name", "email", "phone", "language" },
//     "tracking_number": "YAL-123456",
//     "carrier": "yalidine",
//     "tracking_url": "https://…",
//     "items": [{ "sku", "name", "qty" }]
//   }
//
// Trois champs structurent l'événement et sont stricts : sans eux la requête
// est refusée. Le reste décrit la commande et reste tolérant — une adresse
// e-mail mal saisie par un client ne doit pas faire perdre un changement de
// statut. Une valeur inexploitable y est écartée, et la raison est rapportée
// dans la réponse (`ignored`). Les champs inconnus sont ignorés : une boutique
// peut enrichir son envoi sans rompre le contrat.

import { z } from 'zod'
import { isLanguage, type Language } from './statuses'

/** Avance maximale tolérée pour `updated_at`, en millisecondes. */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const blankToUndefined = (v: unknown) =>
  v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional())

const ItemSchema = z.object({
  sku:  optionalText(200),
  name: z.string().trim().min(1).max(500),
  qty:  z.coerce.number().int().positive().max(100_000).default(1),
})

const PayloadSchema = z.object({
  order_id:   z.string().trim().min(1, 'order_id est obligatoire').max(200),
  status:     z.string().trim().min(1, 'status est obligatoire').max(100),
  updated_at: z.string().datetime({ offset: true, message: 'updated_at doit être une date ISO-8601 avec fuseau' }),

  customer: z
    .preprocess(
      blankToUndefined,
      z.object({
        name:     optionalText(200),
        // Validés plus bas, sans faire échouer la requête.
        email:    optionalText(254),
        phone:    optionalText(30),
        language: optionalText(10),
      }).optional(),
    ),

  tracking_number: optionalText(100),
  carrier:         optionalText(100),
  tracking_url:    optionalText(2000),

  items: z.preprocess(blankToUndefined, z.array(ItemSchema).max(200).optional()),
})

export interface OrderEventPayload {
  orderId:    string
  rawStatus:  string
  occurredAt: Date
  customer: {
    name?:     string
    email?:    string
    phone?:    string
    language?: Language
  }
  trackingNumber?: string
  carrier?:        string
  trackingUrl?:    string
  items?:          { sku?: string; name: string; qty: number }[]
  /** Champs facultatifs reçus mais écartés, avec la raison. */
  ignored: string[]
}

export type ParseResult =
  | { ok: true;  payload: OrderEventPayload }
  | { ok: false; error: string; details?: string[] }

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function parseOrderEvent(rawBody: string, now: Date = new Date()): ParseResult {
  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return { ok: false, error: 'Corps JSON invalide' }
  }
  return parseOrderEventObject(json, now)
}

/**
 * Même contrat, à partir d'un objet déjà décodé : c'est la forme sous laquelle
 * arrivent les événements lus par polling ou par un connecteur.
 */
export function parseOrderEventObject(json: unknown, now: Date = new Date()): ParseResult {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, error: 'Le corps doit être un objet JSON' }
  }

  const parsed = PayloadSchema.safeParse(json)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Corps de requête invalide',
      details: parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`),
    }
  }

  const d = parsed.data
  const occurredAt = new Date(d.updated_at)
  if (occurredAt.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) {
    return { ok: false, error: 'updated_at ne peut pas être dans le futur' }
  }

  const ignored: string[] = []

  let email = d.customer?.email?.toLowerCase()
  if (email && !EMAIL_RE.test(email)) {
    ignored.push('customer.email : adresse invalide')
    email = undefined
  }

  let language: Language | undefined
  if (d.customer?.language) {
    const candidate = d.customer.language.toLowerCase().slice(0, 2)
    if (isLanguage(candidate)) language = candidate
    else ignored.push('customer.language : valeurs acceptées « fr » ou « ar »')
  }

  let trackingUrl = d.tracking_url
  if (trackingUrl && !isHttpUrl(trackingUrl)) {
    ignored.push('tracking_url : URL http(s) attendue')
    trackingUrl = undefined
  }

  return {
    ok: true,
    payload: {
      orderId:    d.order_id,
      rawStatus:  d.status,
      occurredAt,
      customer: {
        name:  d.customer?.name,
        email,
        phone: d.customer?.phone,
        language,
      },
      trackingNumber: d.tracking_number,
      carrier:        d.carrier,
      trackingUrl,
      items:          d.items,
      ignored,
    },
  }
}
