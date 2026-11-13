// lib/security-headers.ts — Flowmerce
//
// En-têtes de sécurité HTTP, appliqués par next.config.ts. Isolés ici pour être
// testés (audit RedStone RS-02, RS-04).
//
// Importé par next.config.ts : pas d'alias `@/`, pas de dépendance applicative.

export interface HeaderRule {
  source:  string
  headers: { key: string; value: string }[]
}

/**
 * Content-Security-Policy (RS-04).
 *
 * `script-src 'unsafe-inline'` reste nécessaire : Next.js injecte des scripts
 * en ligne pour l'hydratation, et seule une CSP à nonce permet de s'en passer.
 * Une CSP à nonce impose un rendu dynamique de toutes les pages (plus de
 * pré-rendu statique) : elle est volontairement laissée pour une étape
 * ultérieure. Cette politique ferme déjà le reste : aucune origine externe pour
 * les scripts, les connexions et les cadres, ni plugin (`object-src`), ni
 * réécriture de `<base>`, ni envoi de formulaire ailleurs, ni intégration dans
 * un cadre tiers.
 */
export function contentSecurityPolicy(opts: { dev: boolean; preview: boolean }): string {
  const { dev, preview } = opts
  // Barre d'outils Vercel, injectée sur les déploiements de préversion.
  const vercelLive = preview ? ' https://vercel.live' : ''

  return [
    "default-src 'self'",
    // `unsafe-eval` : rechargement à chaud de Next.js, en développement seulement.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}${vercelLive}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "font-src 'self' data:",
    // ws: — WebSocket du rechargement à chaud en développement.
    `connect-src 'self'${dev ? ' ws: wss:' : ''}${vercelLive}`,
    `frame-src ${preview ? 'https://vercel.live' : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

export function securityHeaders(opts: { dev: boolean; preview: boolean }): HeaderRule[] {
  return [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy(opts) },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=()' },
        // HSTS — 2 ans. Volontairement sans `includeSubDomains` ni `preload` :
        // les deux sont retenus par le navigateur pendant toute la durée du
        // max-age, donc quasi irréversibles. Les ajouter une fois confirmé
        // qu'aucun sous-domaine ne sert en clair.
        { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
      ],
    },
    {
      // RS-02 — aucune réponse d'API ne doit être conservée par un cache
      // partagé : la plupart dépendent de la session ou de la clé API de
      // l'appelant. Sans en-tête, Vercel posait `public, max-age=0,
      // must-revalidate`. Une route peut toujours fixer le sien.
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
    },
  ]
}
