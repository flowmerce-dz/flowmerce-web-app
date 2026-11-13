// En-têtes de sécurité (audit RedStone RS-02, RS-04, RS-05).

import { describe, expect, it } from 'vitest'
import nextConfig from '@/next.config'
import { contentSecurityPolicy, securityHeaders } from '@/lib/security-headers'

const prod = { dev: false, preview: false }

function header(rules: ReturnType<typeof securityHeaders>, source: string, key: string) {
  return rules.find((r) => r.source === source)?.headers.find((h) => h.key === key)?.value
}

describe('Cache-Control des API (RS-02)', () => {
  it('interdit tout cache partagé sur /api', () => {
    expect(header(securityHeaders(prod), '/api/:path*', 'Cache-Control')).toBe('private, no-store')
  })
})

describe('Content-Security-Policy (RS-04)', () => {
  const csp = contentSecurityPolicy(prod)

  it('pose les directives de verrouillage', () => {
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ]) {
      expect(csp).toContain(directive)
    }
  })

  it('n’autorise pas eval ni le WebSocket de développement en production', () => {
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/connect-src[^;]*ws:/)
  })

  it('n’ouvre la barre d’outils Vercel que sur les préversions', () => {
    expect(csp).not.toContain('vercel.live')
    expect(contentSecurityPolicy({ dev: false, preview: true })).toContain('https://vercel.live')
  })

  it('s’applique à toutes les pages', () => {
    expect(header(securityHeaders(prod), '/(.*)', 'Content-Security-Policy')).toBe(csp)
  })
})

describe('X-Powered-By (RS-05)', () => {
  it('est désactivé', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })
})
