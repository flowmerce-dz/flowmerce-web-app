import { describe, it, expect, vi } from 'vitest'

// Seule l'agrégation (pure) est testée ici : Prisma n'est jamais appelé.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  aggregateProductReturns,
  extractReturnReason,
  lastMonths,
  productKey,
  type ProductReturnRow,
} from '@/lib/services/product-returns'

const NOW = new Date('2026-11-18T12:00:00Z')

function row(overrides: Partial<ProductReturnRow> = {}): ProductReturnRow {
  return {
    productName:   'Chaussure X',
    customerEmail: 'a@example.com',
    customerPhone: null,
    mlInput:       { Return_Reason: 'Mauvaise taille' },
    description:   'Chaussure X — Motif : Mauvaise taille',
    createdAt:     new Date('2026-11-10T10:00:00Z'),
    ...overrides,
  }
}

describe('extractReturnReason', () => {
  it('lit le motif dans mlInput', () => {
    expect(extractReturnReason({ Return_Reason: 'Produit défectueux' }, '')).toBe('Produit défectueux')
  })

  it('se rabat sur la description, avec ou sans détails', () => {
    expect(extractReturnReason(null, 'X — Motif : Pièces manquantes')).toBe('Pièces manquantes')
    expect(extractReturnReason(null, 'X — Motif : Pièces manquantes — Détails : il manque la vis'))
      .toBe('Pièces manquantes')
  })

  it('ignore un motif inconnu', () => {
    expect(extractReturnReason({ Return_Reason: 'Autre' }, 'X — Motif : Autre')).toBeNull()
    expect(extractReturnReason(null, 'texte libre')).toBeNull()
  })
})

describe('productKey', () => {
  it('normalise espaces et casse', () => {
    expect(productKey('  Chaussure   X ')).toBe('chaussure x')
    expect(productKey('chaussure x')).toBe('chaussure x')
  })

  it('renvoie null sans nom', () => {
    expect(productKey(null)).toBeNull()
    expect(productKey('   ')).toBeNull()
  })
})

describe('lastMonths', () => {
  it('renvoie les 6 derniers mois, mois courant compris, en traversant l\'année', () => {
    expect(lastMonths(new Date('2026-02-15T00:00:00Z'))).toEqual([
      '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    ])
  })
})

describe('aggregateProductReturns', () => {
  it('classe les produits du plus retourné au moins retourné', () => {
    const result = aggregateProductReturns([
      row({ productName: 'Sac', customerEmail: 'a@x.com' }),
      row({ productName: 'Chaussure X', customerEmail: 'a@x.com' }),
      row({ productName: 'chaussure  x', customerEmail: 'b@x.com' }),
      row({ productName: 'Chaussure X', customerEmail: 'c@x.com' }),
    ], NOW)

    expect(result.products.map(p => [p.productName, p.returns])).toEqual([
      ['Chaussure X', 3],
      ['Sac', 1],
    ])
    expect(result.totalReturns).toBe(4)
    expect(result.distinctCustomers).toBe(3)
  })

  it('compte un client une seule fois, e-mail insensible à la casse', () => {
    const [product] = aggregateProductReturns([
      row({ customerEmail: 'A@x.com' }),
      row({ customerEmail: 'a@x.com' }),
      row({ customerEmail: 'b@x.com' }),
    ], NOW).products
    expect(product.returns).toBe(3)
    expect(product.distinctCustomers).toBe(2)
  })

  it('répartit les motifs en parts des retours du produit', () => {
    const [product] = aggregateProductReturns([
      row({ mlInput: { Return_Reason: 'Mauvaise taille' } }),
      row({ mlInput: { Return_Reason: 'Mauvaise taille' } }),
      row({ mlInput: { Return_Reason: 'Produit défectueux' } }),
      row({ mlInput: null, description: 'sans motif' }),
    ], NOW).products

    expect(product.topReason).toEqual({ reason: 'Mauvaise taille', count: 2, share: 0.5 })
    expect(product.reasons.map(r => r.reason)).toEqual(['Mauvaise taille', 'Produit défectueux'])
    expect(product.unknownReason).toBe(1)
  })

  it('compte les retours sans produit dans le total, hors classement', () => {
    const result = aggregateProductReturns([row(), row({ productName: null }), row({ productName: ' ' })], NOW)
    expect(result.totalReturns).toBe(3)
    expect(result.withoutProduct).toBe(2)
    expect(result.products).toHaveLength(1)
  })

  it('remplit l\'évolution mensuelle et ignore les mois hors fenêtre', () => {
    const [product] = aggregateProductReturns([
      row({ createdAt: new Date('2026-11-01T00:00:00Z') }),
      row({ createdAt: new Date('2026-09-30T23:00:00Z') }),
      row({ createdAt: new Date('2025-01-01T00:00:00Z') }),
    ], NOW).products

    expect(product.monthly).toEqual([
      { month: '2026-06', count: 0 },
      { month: '2026-07', count: 0 },
      { month: '2026-08', count: 0 },
      { month: '2026-09', count: 1 },
      { month: '2026-10', count: 0 },
      { month: '2026-11', count: 1 },
    ])
    expect(product.returns).toBe(3)
    expect(product.lastReturnAt).toEqual(new Date('2026-11-01T00:00:00Z'))
  })

  it('affiche l\'orthographe la plus fréquente du nom', () => {
    const [product] = aggregateProductReturns([
      row({ productName: 'chaussure x' }),
      row({ productName: 'Chaussure X' }),
      row({ productName: 'Chaussure X' }),
    ], NOW).products
    expect(product.productName).toBe('Chaussure X')
  })

  it('renvoie une analyse vide sans retour', () => {
    const result = aggregateProductReturns([], NOW)
    expect(result.totalReturns).toBe(0)
    expect(result.products).toEqual([])
    expect(result.months).toHaveLength(6)
  })
})
