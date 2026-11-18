import { describe, it, expect, vi } from 'vitest'

// Seules les fonctions pures sont testées ici : Prisma n'est jamais appelé.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  aggregateCustomers,
  filterCustomers,
  parseCustomerQuery,
  riskOf,
  sortCustomers,
  type CustomerClaimRow,
} from '@/lib/services/customer-returns'

const NOW = new Date('2026-11-18T12:00:00Z')
let n = 0

function claim(overrides: Partial<CustomerClaimRow> = {}): CustomerClaimRow {
  n++
  return {
    id:            `c${n}`,
    orderId:       `o${n}`,
    customerName:  'Amine B.',
    customerEmail: 'amine@example.com',
    customerPhone: null,
    productName:   'Chaussure X',
    status:        'APPROVED',
    aiDecision:    'Exchange',
    fraudScore:    10,
    mlInput:       { Return_Reason: 'Mauvaise taille' },
    description:   '',
    createdAt:     new Date('2026-11-10T10:00:00Z'),
    ...overrides,
  }
}

describe('aggregateCustomers', () => {
  it('regroupe par e-mail, sans tenir compte de la casse', () => {
    const [c, ...rest] = aggregateCustomers([
      claim({ customerEmail: 'Amine@Example.com' }),
      claim({ customerEmail: 'amine@example.com' }),
    ])
    expect(rest).toHaveLength(0)
    expect(c.returns).toBe(2)
  })

  it('se rabat sur le téléphone sans e-mail, et ne fusionne jamais deux inconnus', () => {
    const customers = aggregateCustomers([
      claim({ customerEmail: '', customerPhone: '0550' }),
      claim({ customerEmail: '', customerPhone: ' 0550 ' }),
      claim({ customerEmail: '', customerPhone: null }),
      claim({ customerEmail: '', customerPhone: null }),
    ])
    expect(customers.map(c => c.returns).sort()).toEqual([1, 1, 2])
  })

  it('compte les issues et le taux de refus sur les retours tranchés', () => {
    const [c] = aggregateCustomers([
      claim({ status: 'APPROVED' }),
      claim({ status: 'REJECTED' }),
      claim({ status: 'REJECTED' }),
      claim({ status: 'PENDING' }),
    ])
    expect(c).toMatchObject({ returns: 4, approved: 1, rejected: 2, open: 1 })
    expect(c.rejectRate).toBeCloseTo(2 / 3)
  })

  it('n’a pas de taux de refus sans retour tranché', () => {
    const [c] = aggregateCustomers([claim({ status: 'PENDING' }), claim({ status: 'IN_PROGRESS' })])
    expect(c.rejectRate).toBeNull()
    expect(c.open).toBe(2)
  })

  it('garde le nom, le score et les retours du plus récent au plus ancien', () => {
    const [c] = aggregateCustomers([
      claim({ customerName: 'Amine', fraudScore: 20, createdAt: new Date('2026-10-01T00:00:00Z') }),
      claim({ customerName: 'Amine Benali', fraudScore: 55, createdAt: new Date('2026-11-01T00:00:00Z') }),
    ])
    expect(c.name).toBe('Amine Benali')
    expect(c.fraudScore).toBe(55)
    expect(c.claims.map(x => x.createdAt.toISOString().slice(0, 10))).toEqual(['2026-11-01', '2026-10-01'])
    expect(c.firstReturnAt).toEqual(new Date('2026-10-01T00:00:00Z'))
  })

  it('calcule le motif principal', () => {
    const [c] = aggregateCustomers([
      claim({ mlInput: { Return_Reason: 'Produit défectueux' } }),
      claim({ mlInput: { Return_Reason: 'Produit défectueux' } }),
      claim({ mlInput: { Return_Reason: 'Mauvaise taille' } }),
    ])
    expect(c.topReason).toBe('Produit défectueux')
  })
})

describe('parseCustomerQuery', () => {
  it('applique les valeurs par défaut', () => {
    expect(parseCustomerQuery({})).toEqual({
      q: undefined, risk: undefined, period: undefined, minReturns: undefined, status: undefined,
      sort: 'returns', dir: 'desc', page: 1,
    })
  })

  it('lit les filtres valides et ignore les invalides', () => {
    expect(parseCustomerQuery({
      q: ' amine ', risque: 'alert', periode: '90', min: '3', statut: 'open', tri: 'name', page: '2',
    })).toMatchObject({ q: 'amine', risk: 'alert', period: '90', minReturns: 3, status: 'open', sort: 'name', dir: 'asc', page: 2 })

    expect(parseCustomerQuery({ risque: 'x', periode: '7', min: '4', tri: 'hack', ordre: 'up', page: '-3' }))
      .toMatchObject({ risk: undefined, period: undefined, minReturns: undefined, sort: 'returns', dir: 'desc', page: 1 })
  })
})

describe('riskOf', () => {
  it('suit les seuils du tableau de bord', () => {
    expect(riskOf(null)).toBeNull()
    expect(riskOf(39)).toBe('low')
    expect(riskOf(40)).toBe('watch')
    expect(riskOf(70)).toBe('watch')
    expect(riskOf(71)).toBe('alert')
  })
})

describe('filterCustomers', () => {
  const customers = aggregateCustomers([
    claim({ customerName: 'Amine Benali', customerEmail: 'amine@x.com', fraudScore: 80, status: 'REJECTED', createdAt: new Date('2026-11-15T00:00:00Z') }),
    claim({ customerName: 'Amine Benali', customerEmail: 'amine@x.com', fraudScore: 80, createdAt: new Date('2026-11-01T00:00:00Z') }),
    claim({ customerName: 'Sara Kaci', customerEmail: 'sara@x.com', customerPhone: '0661', fraudScore: 10, status: 'PENDING', createdAt: new Date('2026-06-01T00:00:00Z') }),
  ])

  it('cherche dans le nom, l’e-mail et le téléphone, sans accents ni casse', () => {
    expect(filterCustomers(customers, { q: 'BENALI' }, NOW).map(c => c.name)).toEqual(['Amine Benali'])
    expect(filterCustomers(customers, { q: '0661' }, NOW).map(c => c.name)).toEqual(['Sara Kaci'])
    expect(filterCustomers(customers, { q: 'kaçi' }, NOW).map(c => c.name)).toEqual(['Sara Kaci'])
  })

  it('filtre par risque, période, nombre de retours et statut', () => {
    expect(filterCustomers(customers, { risk: 'alert' }, NOW).map(c => c.name)).toEqual(['Amine Benali'])
    expect(filterCustomers(customers, { period: '30' }, NOW).map(c => c.name)).toEqual(['Amine Benali'])
    expect(filterCustomers(customers, { minReturns: 2 }, NOW).map(c => c.name)).toEqual(['Amine Benali'])
    expect(filterCustomers(customers, { status: 'open' }, NOW).map(c => c.name)).toEqual(['Sara Kaci'])
    expect(filterCustomers(customers, { status: 'rejected' }, NOW).map(c => c.name)).toEqual(['Amine Benali'])
  })
})

describe('sortCustomers', () => {
  const customers = aggregateCustomers([
    claim({ customerName: 'Zoé', customerEmail: 'z@x.com', fraudScore: 30, createdAt: new Date('2026-11-10T00:00:00Z') }),
    claim({ customerName: 'Ali', customerEmail: 'a@x.com', fraudScore: null, createdAt: new Date('2026-11-12T00:00:00Z') }),
    claim({ customerName: 'Ali', customerEmail: 'a@x.com', fraudScore: null, createdAt: new Date('2026-11-01T00:00:00Z') }),
    claim({ customerName: 'Mehdi', customerEmail: 'm@x.com', fraudScore: 90, createdAt: new Date('2026-11-05T00:00:00Z') }),
  ])
  const names = (list: { name: string }[]) => list.map(c => c.name)

  it('trie par nombre de retours, puis par date', () => {
    expect(names(sortCustomers(customers, 'returns', 'desc'))).toEqual(['Ali', 'Zoé', 'Mehdi'])
  })

  it('trie par dernier retour', () => {
    expect(names(sortCustomers(customers, 'last', 'desc'))).toEqual(['Ali', 'Zoé', 'Mehdi'])
    expect(names(sortCustomers(customers, 'last', 'asc'))).toEqual(['Mehdi', 'Zoé', 'Ali'])
  })

  it('met toujours les scores absents en fin de liste', () => {
    expect(names(sortCustomers(customers, 'fraud', 'desc'))).toEqual(['Mehdi', 'Zoé', 'Ali'])
    expect(names(sortCustomers(customers, 'fraud', 'asc'))).toEqual(['Zoé', 'Mehdi', 'Ali'])
  })

  it('trie par nom', () => {
    expect(names(sortCustomers(customers, 'name', 'asc'))).toEqual(['Ali', 'Mehdi', 'Zoé'])
  })
})
