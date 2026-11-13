// lib/services/return-explorer.ts — Flowmerce
//
// Tableau « Détail des retours » (Analyses et statistiques) : lecture des
// filtres de l'URL et construction de la requête.
//
// Isolation : `vendorId` vient toujours de la session de l'appelant. Les
// filtres de l'URL ne font que RESTREINDRE ce périmètre, jamais l'élargir.

import { isReturnReason } from '@/lib/constants'

/** Longueur maximale d'un filtre texte : au-delà, la valeur est ignorée. */
const MAX_FILTER_LENGTH = 200

export interface ReturnFilters {
  /** Clé produit (`id:…` ou `name:…`), telle que calculée à l'ingestion. */
  product?: string
  /** Un des 10 motifs de RETURN_REASONS. */
  reason?: string
  /** Recherche libre sur le nom, l'e-mail ou le téléphone du client. */
  customer?: string
}

function clean(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim()
  if (!trimmed || trimmed.length > MAX_FILTER_LENGTH) return undefined
  return trimmed
}

/** Lit les filtres de l'URL ; une valeur invalide est ignorée, pas refusée. */
export function parseReturnFilters(params: {
  produit?: string | string[]
  motif?:   string | string[]
  client?:  string | string[]
}): ReturnFilters {
  const reason = clean(params.motif)
  return {
    product:  clean(params.produit),
    reason:   reason && isReturnReason(reason) ? reason : undefined,
    customer: clean(params.client),
  }
}

/**
 * Filtre Prisma des retours d'un vendeur. Les réclamations refusées d'office
 * par la politique sont exclues, comme dans l'analyse des retours produits.
 */
export function returnsWhere(vendorId: string, filters: ReturnFilters) {
  return {
    vendorId,
    policyRejected: false,
    ...(filters.product && { productKey: filters.product }),
    ...(filters.reason && { returnReason: filters.reason }),
    ...(filters.customer && {
      OR: [
        { customerName:  { contains: filters.customer, mode: 'insensitive' as const } },
        { customerEmail: { contains: filters.customer, mode: 'insensitive' as const } },
        { customerPhone: { contains: filters.customer } },
      ],
    }),
  }
}

/** Paramètres d'URL des filtres actifs, dans l'ordre du formulaire. */
export function filtersToQuery(filters: ReturnFilters): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.product)  query.produit = filters.product
  if (filters.reason)   query.motif   = filters.reason
  if (filters.customer) query.client  = filters.customer
  return query
}

export const RETURNS_TABLE_PATH = '/dashboard/analytics/returns'

/** Lien vers le tableau filtré ; `page` n'est ajoutée qu'au-delà de la 1re. */
export function returnsTableHref(filters: ReturnFilters, page = 1): string {
  const query = filtersToQuery(filters)
  if (page > 1) query.page = String(page)
  const qs = new URLSearchParams(query).toString()
  return qs ? `${RETURNS_TABLE_PATH}?${qs}` : RETURNS_TABLE_PATH
}

