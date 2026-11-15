// lib/order-tracking/pinned-http.ts — Flowmerce · Suivi des commandes
//
// Requête GET vers une URL saisie par un vendeur, sans qu'elle puisse atteindre
// le réseau interne de Flowmerce.
//
// Vérifier l'hôte puis laisser le client HTTP le résoudre à nouveau ne suffit
// pas : entre les deux résolutions, le nom peut changer de cible (« DNS
// rebinding ») et pointer vers une adresse interne. Ici le nom n'est résolu
// qu'UNE fois ; les adresses obtenues sont contrôlées, puis la connexion est
// forcée vers ces adresses-là — le client ne refait aucune résolution. Le nom
// d'origine reste utilisé pour l'en-tête Host et pour TLS (SNI, certificat).
// L'adresse réellement jointe est contrôlée une dernière fois à la connexion.
//
// Les redirections ne sont jamais suivies (`http.request` ne les suit pas) :
// une réponse 3xx est rendue telle quelle à l'appelant.

import type { LookupAddress } from 'node:dns'
import { lookup as resolve } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { PullError } from './connectors'

/** Adresse non routable sur Internet : boucle locale, réseau privé, lien local… */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase()

  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }

  if (isIP(ip) === 6) {
    if (ip === '::' || ip === '::1') return true
    // IPv4 projetée en IPv6 (::ffff:10.0.0.1).
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return /^(fc|fd|fe[89ab]|ff)/.test(ip) || ip.startsWith('::ffff:')
  }

  return false
}

const NOT_PUBLIC = 'L’URL de polling doit pointer vers une adresse publique'

/**
 * Résout l'hôte une fois. Avec `requirePublic`, refuse dès qu'UNE des adresses
 * est interne : un nom qui répond à la fois par une adresse publique et une
 * adresse privée n'est pas digne de confiance.
 */
export async function resolveAddresses(hostname: string, requirePublic: boolean): Promise<LookupAddress[]> {
  const host   = hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)

  let addresses: LookupAddress[]
  if (family) {
    addresses = [{ address: host, family }]
  } else {
    try {
      addresses = await resolve(host, { all: true })
    } catch {
      throw new PullError('Le nom de domaine de la boutique est introuvable')
    }
  }

  if (addresses.length === 0) throw new PullError('Le nom de domaine de la boutique est introuvable')
  if (requirePublic && addresses.some((a) => isPrivateAddress(a.address))) throw new PullError(NOT_PUBLIC)
  return addresses
}

export interface PinnedResponse {
  status: number
  /** Corps d'une réponse 2xx ; vide sinon. */
  body:   string
}

export interface PinnedGetOptions {
  headers:       Record<string, string>
  /** Adresses déjà contrôlées (`resolveAddresses`) : les seules jointes. */
  addresses:     LookupAddress[]
  requirePublic: boolean
  timeoutMs:     number
  maxBytes:      number
}

export function pinnedGet(target: URL, options: PinnedGetOptions): Promise<PinnedResponse> {
  const { headers, addresses, requirePublic, timeoutMs, maxBytes } = options

  // Remplace la résolution DNS du client : il ne reçoit que les adresses
  // contrôlées, quel que soit le nom demandé.
  const pinned: LookupFunction = (_hostname, opts, callback) => {
    if (opts.all) callback(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  }

  return new Promise((resolvePromise, reject) => {
    let settled = false
    const fail = (error: PullError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.destroy()
      reject(error)
    }
    const done = (response: PinnedResponse) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(response)
    }

    const transport = target.protocol === 'https:' ? https : http
    const req = transport.request(
      target,
      // `agent: false` : une connexion neuve, jamais une connexion réutilisée
      // ouverte vers une autre adresse.
      { method: 'GET', headers, lookup: pinned, agent: false },
      (res) => {
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          res.resume()
          return done({ status, body: '' })
        }

        const tooLarge = () =>
          new PullError(`Réponse trop volumineuse (maximum ${maxBytes / 1024 / 1024} Mo)`, status)
        if (Number(res.headers['content-length'] ?? 0) > maxBytes) return fail(tooLarge())

        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > maxBytes) return fail(tooLarge())
          chunks.push(chunk)
        })
        res.on('end', () => done({ status, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', () => fail(new PullError('La réponse de la boutique a été interrompue', status)))
      },
    )

    // Dernier contrôle, sur l'adresse réellement jointe.
    req.on('socket', (socket) => {
      socket.once('connect', () => {
        if (requirePublic && isPrivateAddress(socket.remoteAddress ?? '')) fail(new PullError(NOT_PUBLIC))
      })
    })
    req.on('error', () => fail(new PullError('La boutique est injoignable à cette URL')))

    const timer = setTimeout(
      () => fail(new PullError(`La boutique n’a pas répondu en ${timeoutMs / 1000} secondes`)),
      timeoutMs,
    )
    req.end()
  })
}
