import { describe, expect, it } from 'vitest'
import {
  parseReturnFilters,
  returnsTableHref,
  returnsWhere,
} from '@/lib/services/return-explorer'

describe('parseReturnFilters', () => {
  it('lit les trois filtres et retire les espaces', () => {
    expect(parseReturnFilters({
      produit: ' name:casque ', motif: 'Produit défectueux', client: ' alice ',
    })).toEqual({ product: 'name:casque', reason: 'Produit défectueux', customer: 'alice' })
  })

  it('ignore un motif hors des 10 motifs', () => {
    expect(parseReturnFilters({ motif: 'Inventé' }).reason).toBeUndefined()
  })

  it('ignore les valeurs vides ou trop longues', () => {
    expect(parseReturnFilters({ produit: '   ', client: 'x'.repeat(201) }))
      .toEqual({ product: undefined, reason: undefined, customer: undefined })
  })

  it('prend la première valeur d’un paramètre répété', () => {
    expect(parseReturnFilters({ client: ['a', 'b'] }).customer).toBe('a')
  })
})

describe('returnsWhere', () => {
  it('reste limité au vendeur et exclut les refus hors politique, sans filtre', () => {
    expect(returnsWhere('v1', {})).toEqual({ vendorId: 'v1', policyRejected: false })
  })

  it('ne peut pas élargir le périmètre du vendeur', () => {
    const where = returnsWhere('v1', { product: 'id:42', reason: 'Mauvaise taille', customer: 'bob' })
    expect(where.vendorId).toBe('v1')
    expect(where.policyRejected).toBe(false)
    expect(where.productKey).toBe('id:42')
    expect(where.returnReason).toBe('Mauvaise taille')
  })

  it('cherche le client par nom, e-mail ou téléphone', () => {
    expect(returnsWhere('v1', { customer: 'bob' }).OR).toEqual([
      { customerName:  { contains: 'bob', mode: 'insensitive' } },
      { customerEmail: { contains: 'bob', mode: 'insensitive' } },
      { customerPhone: { contains: 'bob' } },
    ])
  })
})

describe('returnsTableHref', () => {
  it('renvoie le tableau sans paramètre quand rien n’est filtré', () => {
    expect(returnsTableHref({})).toBe('/dashboard/analytics/returns')
  })

  it('encode la clé produit et n’ajoute la page qu’au-delà de la première', () => {
    expect(returnsTableHref({ product: 'name:casque bleu' }))
      .toBe('/dashboard/analytics/returns?produit=name%3Acasque+bleu')
    expect(returnsTableHref({ reason: 'Mauvaise taille' }, 1))
      .toBe('/dashboard/analytics/returns?motif=Mauvaise+taille')
    expect(returnsTableHref({ customer: 'a@b.c' }, 3))
      .toBe('/dashboard/analytics/returns?client=a%40b.c&page=3')
  })

  it('produit un lien que parseReturnFilters relit à l’identique', () => {
    const filters = { product: 'id:é/42', reason: 'Produit défectueux', customer: 'Zoé' }
    const qs = new URLSearchParams(returnsTableHref(filters).split('?')[1])
    expect(parseReturnFilters({
      produit: qs.get('produit') ?? undefined,
      motif:   qs.get('motif') ?? undefined,
      client:  qs.get('client') ?? undefined,
    })).toEqual(filters)
  })
})
