// Modèle d'authentification de chaque route d'API (audit RedStone RS-03).
//
// Flowmerce a deux familles de routes qui ne doivent jamais se mélanger :
//   · session  — tableau de bord vendeur et admin (cookie NextAuth) ;
//   · api-key  — API partenaires, appelée de serveur à serveur par les
//                boutiques (`Authorization: Bearer <clé>`).
// S'y ajoutent les routes publiques (jeton de retour, formulaire de contact,
// santé, NextAuth), le cron (CRON_SECRET) et les routes réservées à l'admin.
//
// Ce test lit le code de chaque route et vérifie qu'il applique exactement le
// modèle déclaré ici. Une nouvelle route fait échouer le test tant qu'elle n'a
// pas été classée : son modèle d'authentification est une décision explicite.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

type AuthModel =
  | 'session'        // cookie de session, vendeur ou admin
  | 'session-admin'  // cookie de session, rôle ADMIN exigé
  | 'api-key'        // clé API partenaire
  | 'partner'        // clé API partenaire OU jeton d'intégration (return-credentials)
  | 'cron'           // secret du cron Vercel
  | 'public'         // pas d'authentification (jeton dans l'URL, NextAuth, santé…)

const ROUTES: Record<string, AuthModel> = {
  'admin/claims':                 'session-admin',
  'admin/claims/[claimId]/amend': 'session-admin',
  'admin/claims/export':          'session-admin',
  'admin/claims/save-claim':      'session-admin',
  'api-keys':                     'session',
  'api-keys/[keyId]':             'session',
  'auth/[...nextauth]':           'public',
  'claims/[claimId]':             'session',
  'claims/validation-mode':       'session',
  'contact':                      'public',
  'cron/order-notifications':     'cron',
  'cron/order-polling':           'cron',
  'cron/retry-ml':                'cron',
  'fraud/report-refusal':         'api-key',
  'health':                       'public',
  // Suivi des commandes — réglages du tableau de bord.
  'order-tracking/activity':      'session',
  'order-tracking/secret':        'session',
  'order-tracking/settings':      'session',
  'order-tracking/sync':          'session',
  'order-tracking/test':          'session',
  'predict':                      'api-key',
  'return-policy':                'session',
  'return-policy/advanced':       'session',
  // API partenaire historique, hors de /api/v1 : appelée par les boutiques
  // pour générer un lien de retour hébergé, jamais par le tableau de bord.
  'return-sessions':              'api-key',
  'return/[token]':               'public',
  'return/[token]/vendor-info':   'public',
  // Suivi des commandes — statuts déclarés par la boutique.
  'v1/order-statuses':            'api-key',
  'v1/return-form':               'api-key',
  'v1/returns':                   'partner',
  // Suivi des commandes — clé API de la boutique, puis signature HMAC.
  'v1/webhooks/orders':           'api-key',
  'vendors/[vendorId]':           'session-admin',
  'vendors/create-profile':       'session',
  'vendors/documents':            'session',
  'vendors/documents/[documentId]': 'session-admin',
  'vendors/documents/view':       'session',
  'vendors/me':                   'session',
  'vendors/register':             'public',
  'vendors/services':             'session',
}

const API_DIR = join(process.cwd(), 'app', 'api')

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return name === 'route.ts' ? [path] : []
  })
}

const routes = routeFiles(API_DIR).map((file) => ({
  route:  relative(API_DIR, file).split(sep).slice(0, -1).join('/'),
  source: readFileSync(file, 'utf8'),
}))

const usesSession = (s: string) => /getSessionServer|getSessionFromRequest|\bauth\(\)/.test(s)
const usesApiKey  = (s: string) => /validateApiKey|requireApiKey/.test(s)
const usesPartner = (s: string) => /resolveSubmissionContext/.test(s)
const usesCron    = (s: string) => /CRON_SECRET/.test(s)
const checksAdmin = (s: string) => /role\s*[!=]==\s*['"]ADMIN['"]|requireAdmin/.test(s)

describe('modèle d’authentification des routes d’API', () => {
  it('chaque route est classée', () => {
    const unclassified = routes.map((r) => r.route).filter((r) => !(r in ROUTES))
    expect(unclassified).toEqual([])
  })

  it('aucune route classée n’a disparu sans mise à jour de la liste', () => {
    const existing = new Set(routes.map((r) => r.route))
    expect(Object.keys(ROUTES).filter((r) => !existing.has(r))).toEqual([])
  })

  for (const { route, source } of routes) {
    const model = ROUTES[route]
    if (!model) continue

    it(`${route} → ${model}`, () => {
      switch (model) {
        case 'session':
          expect(usesSession(source)).toBe(true)
          expect(usesApiKey(source)).toBe(false)
          break
        case 'session-admin':
          expect(usesSession(source)).toBe(true)
          expect(checksAdmin(source)).toBe(true)
          expect(usesApiKey(source)).toBe(false)
          break
        case 'api-key':
          expect(usesApiKey(source)).toBe(true)
          expect(usesSession(source)).toBe(false)
          break
        case 'partner':
          expect(usesPartner(source)).toBe(true)
          expect(usesSession(source)).toBe(false)
          break
        case 'cron':
          expect(usesCron(source)).toBe(true)
          expect(usesSession(source)).toBe(false)
          break
        case 'public':
          expect(usesApiKey(source)).toBe(false)
          break
      }
    })
  }

  it('les routes partenaires /api/v1 n’acceptent jamais une session', () => {
    for (const { route, source } of routes.filter((r) => r.route.startsWith('v1/'))) {
      expect(usesSession(source), route).toBe(false)
    }
  })
})
