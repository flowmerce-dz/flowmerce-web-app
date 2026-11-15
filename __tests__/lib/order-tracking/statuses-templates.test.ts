// Normalisation des statuts, contrat du corps et rendu des messages.

import { describe, it, expect } from 'vitest'
import {
  MAPPABLE_STATUSES,
  ORDER_STATUSES,
  normalizeStatusKey,
  resolveStatus,
} from '@/lib/order-tracking/statuses'
import { parseOrderEvent } from '@/lib/order-tracking/payload'
import {
  defaultTemplate,
  effectiveTemplates,
  readStoreTemplates,
  renderMessage,
} from '@/lib/order-tracking/templates'

describe('statuts', () => {
  it('prévoit les dix statuts standards', () => {
    expect(ORDER_STATUSES).toEqual([
      'PENDING', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'OUT_FOR_DELIVERY',
      'DELIVERED', 'FAILED_DELIVERY', 'RETURNED', 'CANCELLED', 'UNMAPPED',
    ])
    expect(MAPPABLE_STATUSES).not.toContain('UNMAPPED')
  })

  it('ignore casse, accents et ponctuation', () => {
    expect(normalizeStatusKey('  Expédiée ')).toBe('expediee')
    expect(normalizeStatusKey('OUT_FOR_DELIVERY')).toBe('out for delivery')
    expect(normalizeStatusKey('Échec de livraison !')).toBe('echec de livraison')
  })

  it('reconnaît les libellés courants sans configuration', () => {
    expect(resolveStatus('Expédiée', [])).toBe('SHIPPED')
    expect(resolveStatus('LIVREE', [])).toBe('DELIVERED')
    expect(resolveStatus('out_for_delivery', [])).toBe('OUT_FOR_DELIVERY')
    expect(resolveStatus('تم الشحن', [])).toBe('SHIPPED')
  })

  it('fait primer la correspondance de la boutique sur celle par défaut', () => {
    const store = [{ normalizedKey: normalizeStatusKey('Expédiée'), status: 'PREPARING' as const }]
    expect(resolveStatus('expédiée', store)).toBe('PREPARING')
  })

  it('applique une correspondance propre à la boutique', () => {
    const store = [{ normalizedKey: normalizeStatusKey('Chez Yalidine'), status: 'SHIPPED' as const }]
    expect(resolveStatus('CHEZ YALIDINE', store)).toBe('SHIPPED')
  })

  it('range un statut inconnu ou vide dans UNMAPPED', () => {
    expect(resolveStatus('Statut maison', [])).toBe('UNMAPPED')
    expect(resolveStatus('***', [])).toBe('UNMAPPED')
  })
})

describe('contrat du corps', () => {
  const now  = new Date('2026-11-14T18:00:00Z')
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      order_id:   'CABA-10452',
      status:     'Expédiée',
      updated_at: '2026-11-14T17:20:00Z',
      customer:   { name: 'Amine B.', email: 'Amine@Example.com', phone: '+213550000000' },
      tracking_number: 'YAL-123456',
      carrier:    'yalidine',
      items:      [{ sku: 'CHS-39-NOIR', name: 'Chaussure X', qty: 1 }],
      ...over,
    })

  it('accepte le corps standard', () => {
    const r = parseOrderEvent(body(), now)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload).toMatchObject({
      orderId: 'CABA-10452', rawStatus: 'Expédiée', trackingNumber: 'YAL-123456', carrier: 'yalidine',
      customer: { name: 'Amine B.', email: 'amine@example.com', phone: '+213550000000' },
      ignored: [],
    })
    expect(r.payload.occurredAt.toISOString()).toBe('2026-11-14T17:20:00.000Z')
  })

  it('ignore les champs inconnus sans rompre le contrat', () => {
    expect(parseOrderEvent(body({ boutique_interne: { x: 1 } }), now).ok).toBe(true)
  })

  it('refuse un corps sans order_id, status ou updated_at', () => {
    for (const field of ['order_id', 'status', 'updated_at']) {
      expect(parseOrderEvent(body({ [field]: undefined }), now).ok).toBe(false)
      expect(parseOrderEvent(body({ [field]: '' }), now).ok).toBe(false)
    }
  })

  it('refuse un JSON illisible, une date sans fuseau ou dans le futur', () => {
    expect(parseOrderEvent('{', now).ok).toBe(false)
    expect(parseOrderEvent('[]', now).ok).toBe(false)
    expect(parseOrderEvent(body({ updated_at: '2026-11-14 17:20' }), now).ok).toBe(false)
    expect(parseOrderEvent(body({ updated_at: '2026-11-20T00:00:00Z' }), now).ok).toBe(false)
  })

  it('écarte une coordonnée inexploitable sans refuser l’événement', () => {
    const r = parseOrderEvent(
      body({ customer: { name: 'Amine', email: 'pas-un-email', language: 'de' }, tracking_url: 'javascript:alert(1)' }),
      now,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.customer.email).toBeUndefined()
    expect(r.payload.customer.language).toBeUndefined()
    expect(r.payload.trackingUrl).toBeUndefined()
    expect(r.payload.ignored).toHaveLength(3)
  })
})

describe('messages', () => {
  const ctx = {
    status: 'SHIPPED' as const, language: 'fr' as const, shopName: 'Caba Store',
    orderId: 'CABA-10452', customerName: 'Amine B.',
    trackingNumber: 'YAL-123456', carrier: 'yalidine', trackingUrl: 'https://suivi.example.com/YAL-123456',
  }

  it('remplace toutes les variables', () => {
    const m = renderMessage(ctx)
    expect(m.subject).toBe('Caba Store — Commande CABA-10452 : Expédiée')
    expect(m.text).toContain('Bonjour Amine B.,')
    expect(m.text).toContain('YAL-123456')
    expect(m.text).toContain('yalidine')
    expect(m.html).toContain('https://suivi.example.com/YAL-123456')
    expect(m.text).not.toContain('{{')
  })

  it('rend le message en arabe, de droite à gauche', () => {
    const m = renderMessage({ ...ctx, language: 'ar' })
    expect(m.html).toContain('dir="rtl"')
    expect(m.subject).toContain('تم الشحن')
  })

  it('utilise le message personnalisé de la boutique pour ce statut et cette langue', () => {
    const store = readStoreTemplates({
      SHIPPED: { fr: { subject: 'Colis {{order_id}} parti', body: 'Salut {{customer_name}} — suivi {{tracking_number}}' } },
    })
    const m = renderMessage(ctx, store)
    expect(m.subject).toBe('Colis CABA-10452 parti')
    expect(m.text).toContain('Salut Amine B. — suivi YAL-123456')
    // L'arabe n'est pas personnalisé : modèle par défaut.
    expect(renderMessage({ ...ctx, language: 'ar' }, store).text).toContain('تم شحن')
  })

  it('échappe tout contenu venu de la boutique ou du client', () => {
    const m = renderMessage({
      ...ctx,
      customerName: '<script>alert(1)</script>',
      shopName:     'Caba <b>Store</b>',
      trackingUrl:  'https://x.example/?a="><img src=x>',
    })
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<b>Store</b>')
    expect(m.html).not.toContain('"><img')
    expect(m.html).toContain('&lt;script&gt;')
  })

  it('garde l’objet sur une seule ligne', () => {
    const store = readStoreTemplates({ SHIPPED: { fr: { subject: 'Ligne 1\r\nBcc: x@y.z', body: 'ok' } } })
    expect(renderMessage(ctx, store).subject).not.toMatch(/[\r\n]/)
  })

  it('n’affiche pas de nom vide quand le client est inconnu', () => {
    expect(renderMessage({ ...ctx, customerName: null }).text).toContain('Bonjour cher client,')
  })

  it('ignore un modèle enregistré mal formé', () => {
    const store = readStoreTemplates({
      SHIPPED: { fr: { subject: '', body: 'x' }, de: { subject: 'a', body: 'b' } },
      UNMAPPED: { fr: { subject: 'a', body: 'b' } },
      INCONNU: 'x',
    })
    expect(store).toEqual({})
    expect(effectiveTemplates(store).SHIPPED.fr).toEqual({ ...defaultTemplate('SHIPPED', 'fr'), custom: false })
  })
})
