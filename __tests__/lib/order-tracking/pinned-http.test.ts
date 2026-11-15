// Transport du polling : la requête ne joint que les adresses contrôlées.
//
// Ces tests parlent à un vrai serveur HTTP local, sans simulation : c'est le
// comportement de la connexion elle-même qui est vérifié.

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PullError } from '@/lib/order-tracking/connectors'
import { pinnedGet, resolveAddresses } from '@/lib/order-tracking/pinned-http'

const LOOPBACK = [{ address: '127.0.0.1', family: 4 }]

let server: http.Server
let port: number
const seen: { host?: string; url?: string; auth?: string }[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, url: req.url, auth: req.headers.authorization })
    if (req.url?.startsWith('/redirect')) {
      res.writeHead(302, { location: 'http://127.0.0.1:1/interne' }).end()
    } else if (req.url?.startsWith('/big')) {
      res.writeHead(200).end('x'.repeat(5000))
    } else if (req.url?.startsWith('/slow')) {
      // Ne répond jamais.
    } else if (req.url?.startsWith('/error')) {
      res.writeHead(500).end('panne')
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"events":[]}')
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
})

const get = (path: string, over: Partial<Parameters<typeof pinnedGet>[1]> = {}) =>
  // « .invalid » ne se résout jamais : si la requête aboutit, c'est que le
  // client n'a fait aucune résolution et a joint l'adresse imposée.
  pinnedGet(new URL(`http://boutique.invalid:${port}${path}`), {
    headers: { authorization: 'Bearer tok' },
    addresses: LOOPBACK, requirePublic: false, timeoutMs: 2000, maxBytes: 1024,
    ...over,
  })

describe('connexion imposée à l’adresse contrôlée', () => {
  it('joint l’adresse fournie sans résoudre le nom, et garde le nom dans Host', async () => {
    const res = await get('/events?since=x')

    expect(res).toEqual({ status: 200, body: '{"events":[]}' })
    expect(seen.at(-1)).toEqual({
      host: `boutique.invalid:${port}`, url: '/events?since=x', auth: 'Bearer tok',
    })
  })

  it('coupe la connexion si l’adresse jointe est interne', async () => {
    const before = seen.length
    await expect(get('/events', { requirePublic: true })).rejects.toThrow(/adresse publique/)
    // La requête n'a pas été transmise au serveur interne.
    expect(seen).toHaveLength(before)
  })

  it('ne suit pas une redirection : elle est rendue à l’appelant', async () => {
    expect(await get('/redirect')).toEqual({ status: 302, body: '' })
  })

  it('rend le statut d’une erreur sans lire son corps', async () => {
    expect(await get('/error')).toEqual({ status: 500, body: '' })
  })

  it('refuse une réponse plus grosse que la limite', async () => {
    await expect(get('/big')).rejects.toThrow(/trop volumineuse/)
  })

  it('abandonne quand la boutique ne répond pas à temps', async () => {
    await expect(get('/slow', { timeoutMs: 150 })).rejects.toThrow(/pas répondu/)
  })

  it('signale une boutique injoignable', async () => {
    const closed = pinnedGet(new URL('http://boutique.invalid:1/x'), {
      headers: {}, addresses: LOOPBACK, requirePublic: false, timeoutMs: 2000, maxBytes: 1024,
    })
    await expect(closed).rejects.toBeInstanceOf(PullError)
  })
})

describe('résolution unique de l’hôte', () => {
  it('refuse une adresse interne quand une adresse publique est exigée', async () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]', 'localhost']) {
      await expect(resolveAddresses(host, true), host).rejects.toThrow(/adresse publique/)
    }
  })

  it('accepte une adresse publique, et une adresse locale hors production', async () => {
    expect(await resolveAddresses('8.8.8.8', true)).toEqual([{ address: '8.8.8.8', family: 4 }])
    expect((await resolveAddresses('127.0.0.1', false))[0].address).toBe('127.0.0.1')
  })

  it('signale un nom de domaine introuvable', async () => {
    await expect(resolveAddresses('boutique.invalid', true)).rejects.toThrow(/introuvable/)
  })
})
