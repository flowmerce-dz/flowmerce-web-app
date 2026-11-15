// lib/order-tracking/polling.ts — Flowmerce · Suivi des commandes
//
// Mode polling : Flowmerce interroge une URL exposée par la boutique.
//
//   GET <URL de la boutique>?since=<ISO-8601>&limit=100[&cursor=<curseur>]
//   Authorization: Bearer <jeton>          (si la boutique en a défini un)
//
//   200 { "events": [ { "event_id"?, "order_id", "status", "updated_at", … } ],
//         "next_cursor": "…" | null, "has_more": false }
//
// Chaque événement a le format du corps du webhook (cf. payload.ts). Une
// boutique peut aussi répondre par le tableau seul.
//
// L'URL est saisie par le vendeur : c'est Flowmerce qui émet la requête, depuis
// son propre réseau. Elle ne doit donc pas pouvoir servir à atteindre un
// service interne :
//
//   · HTTPS et hôte public exigés en production (`validatePollingUrl`) ;
//   · le nom est résolu une seule fois, ses adresses sont contrôlées, et la
//     connexion est forcée vers ces adresses-là (pinned-http.ts) — un nom qui
//     change de cible entre le contrôle et la connexion n'y change rien ;
//   · aucune redirection n'est suivie ;
//   · délai et taille de réponse bornés.

import { env } from '@/lib/env'
import { PullError, type PullInput, type PullPage } from './connectors'
import { isPrivateAddress, pinnedGet, resolveAddresses } from './pinned-http'

export { isPrivateAddress }

export const POLL_PAGE_LIMIT      = 100
export const POLL_MAX_EVENTS      = 500
export const POLL_TIMEOUT_MS      = 10_000
export const POLL_MAX_BYTES       = 1024 * 1024
export const POLL_MAX_URL_LENGTH  = 2000
export const POLL_MAX_TOKEN_SIZE  = 500
const MAX_CURSOR_SIZE = 500

const isProduction = () => env.NODE_ENV === 'production'

// ─────────────────────────────────────────────────────────────
// Contrôle de l'URL
// ─────────────────────────────────────────────────────────────

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string }

/**
 * Contrôle de forme de l'URL de polling. En production : HTTPS et hôte public.
 * Hors production, HTTP et les adresses locales sont admis, pour brancher une
 * boutique qui tourne sur le poste de développement.
 */
export function validatePollingUrl(raw: string, production: boolean = isProduction()): UrlCheck {
  const value = raw.trim()
  if (!value) return { ok: false, error: 'L’URL de polling est vide' }
  if (value.length > POLL_MAX_URL_LENGTH) return { ok: false, error: 'L’URL de polling est trop longue' }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, error: 'L’URL de polling n’est pas une URL valide' }
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) {
    return { ok: false, error: 'L’URL de polling doit commencer par https://' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'L’URL de polling ne doit pas contenir d’identifiants : utilisez le jeton' }
  }

  if (production) {
    const host = url.hostname.toLowerCase()
    if (
      host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal') ||
      isPrivateAddress(host)
    ) {
      return { ok: false, error: 'L’URL de polling doit pointer vers une adresse publique' }
    }
  }

  url.hash = ''
  return { ok: true, url: url.toString() }
}

// ─────────────────────────────────────────────────────────────
// Lecture d'une page
// ─────────────────────────────────────────────────────────────

export interface PollingSource {
  url:   string
  token: string | null
}

export async function fetchPollingPage(
  source: PollingSource,
  input:  PullInput,
  production: boolean = isProduction(),
): Promise<PullPage> {
  const check = validatePollingUrl(source.url, production)
  if (!check.ok) throw new PullError(check.error)

  const target = new URL(check.url)
  target.searchParams.set('since', input.since.toISOString())
  target.searchParams.set('limit', String(POLL_PAGE_LIMIT))
  if (input.cursor) target.searchParams.set('cursor', input.cursor)

  // Une seule résolution DNS : les adresses contrôlées ici sont les seules
  // que la requête pourra joindre.
  const addresses = await resolveAddresses(target.hostname, production)
  const res = await pinnedGet(target, {
    headers: {
      accept:       'application/json',
      'user-agent': 'Flowmerce-OrderTracking/1.0',
      ...(source.token ? { authorization: `Bearer ${source.token}` } : {}),
    },
    addresses,
    requirePublic: production,
    timeoutMs:     POLL_TIMEOUT_MS,
    maxBytes:      POLL_MAX_BYTES,
  })

  if (res.status >= 300 && res.status < 400) {
    throw new PullError(`La boutique a répondu par une redirection (${res.status}) : indiquez l’URL finale`, res.status)
  }
  if (res.status < 200 || res.status >= 300) {
    const hint = res.status === 401 || res.status === 403 ? ' : jeton refusé' : ''
    throw new PullError(`La boutique a répondu ${res.status}${hint}`, res.status)
  }

  let json: unknown
  try {
    json = JSON.parse(res.body)
  } catch {
    throw new PullError('Réponse illisible : du JSON est attendu', res.status)
  }

  const body = Array.isArray(json) ? { events: json } : json
  if (!body || typeof body !== 'object' || !Array.isArray((body as { events?: unknown }).events)) {
    throw new PullError('Réponse inattendue : un champ « events » (tableau) est attendu', res.status)
  }
  const { events, next_cursor, has_more } = body as {
    events: unknown[]; next_cursor?: unknown; has_more?: unknown
  }
  if (events.length > POLL_MAX_EVENTS) {
    throw new PullError(
      `Trop d’événements dans une réponse (${events.length}) : respectez le paramètre « limit »`,
      res.status,
    )
  }

  const nextCursor =
    typeof next_cursor === 'string' && next_cursor && next_cursor.length <= MAX_CURSOR_SIZE
      ? next_cursor
      : typeof next_cursor === 'number' ? String(next_cursor) : null

  return { events, nextCursor, hasMore: has_more === true }
}
