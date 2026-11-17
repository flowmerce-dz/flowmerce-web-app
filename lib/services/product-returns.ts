// lib/services/product-returns.ts — Flowmerce
//
// Analyse des retours par produit : quels produits sont les plus retournés, et
// pour quels motifs.
//
// Flowmerce gère les retours, pas les commandes : il ne connaît pas le nombre
// d'exemplaires vendus. Aucun taux de retour n'est donc calculé ici ; chaque
// pourcentage est une part des retours du produit.
//
// Lecture seule, sans migration : le produit vient de `Claim.productName`, le
// motif de `mlInput.Return_Reason` (à défaut, du « Motif : … » de la
// description, cf. return-submission.ts).

import { prisma } from '@/lib/prisma'
import { RETURN_REASONS, type ReturnReason } from '@/lib/constants'

/** Nombre de mois affichés dans l'évolution mensuelle, mois courant compris. */
export const MONTHS_SHOWN = 6

export interface ProductReturnRow {
  productName:   string | null
  customerEmail: string
  customerPhone: string | null
  mlInput:       unknown
  description:   string
  createdAt:     Date
}

export interface ReasonCount {
  reason: ReturnReason
  count:  number
  /** Part des retours du produit, entre 0 et 1. */
  share:  number
}

export interface ProductReturnStats {
  productKey:        string
  productName:       string
  returns:           number
  distinctCustomers: number
  reasons:           ReasonCount[]
  /** Retours dont le motif n'a pas pu être lu. */
  unknownReason:     number
  topReason:         ReasonCount | null
  /** Un point par mois de `months`, dans le même ordre. */
  monthly:           { month: string; count: number }[]
  lastReturnAt:      Date
}

export interface ProductReturnAnalytics {
  totalReturns:      number
  distinctCustomers: number
  /** Retours sans nom de produit : comptés dans le total, absents du classement. */
  withoutProduct:    number
  /** Mois affichés, format `YYYY-MM`, du plus ancien au plus récent. */
  months:            string[]
  /** Du plus retourné au moins retourné. */
  products:          ProductReturnStats[]
}

// ─────────────────────────────────────────────────────────────
// Extraction
// ─────────────────────────────────────────────────────────────

const REASON_SET = new Set<string>(RETURN_REASONS)

function asReason(value: unknown): ReturnReason | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return REASON_SET.has(v) ? (v as ReturnReason) : null
}

/** Motif du retour, ou `null` s'il ne correspond à aucun motif connu. */
export function extractReturnReason(mlInput: unknown, description: string): ReturnReason | null {
  if (mlInput && typeof mlInput === 'object' && !Array.isArray(mlInput)) {
    const fromMl = asReason((mlInput as Record<string, unknown>).Return_Reason)
    if (fromMl) return fromMl
  }
  const match = /Motif : (.*?)(?: — Détails : |$)/.exec(description ?? '')
  return match ? asReason(match[1]) : null
}

/**
 * Clé de regroupement d'un produit : nom sans espaces superflus, en minuscules,
 * pour que « Chaussure X » et « chaussure  x » soient un seul produit.
 */
export function productKey(name: string | null | undefined): string | null {
  const key = name?.trim().replace(/\s+/g, ' ').toLowerCase()
  return key || null
}

/** Un client est compté par e-mail, à défaut par téléphone. */
function customerKey(row: ProductReturnRow): string | null {
  const email = row.customerEmail?.trim().toLowerCase()
  if (email) return `email:${email}`
  const phone = row.customerPhone?.trim()
  return phone ? `phone:${phone}` : null
}

function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function lastMonths(now: Date, count = MONTHS_SHOWN): string[] {
  const months: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    months.push(monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))))
  }
  return months
}

// ─────────────────────────────────────────────────────────────
// Agrégation (pure)
// ─────────────────────────────────────────────────────────────

export function aggregateProductReturns(
  rows: readonly ProductReturnRow[],
  now:  Date = new Date(),
): ProductReturnAnalytics {
  const months = lastMonths(now)
  const allCustomers = new Set<string>()
  let withoutProduct = 0

  const groups = new Map<string, {
    names:     Map<string, number>
    customers: Set<string>
    anonymous: number
    reasons:   Map<ReturnReason, number>
    unknown:   number
    monthly:   Map<string, number>
    returns:   number
    last:      Date
  }>()

  for (const row of rows) {
    const customer = customerKey(row)
    if (customer) allCustomers.add(customer)

    const key = productKey(row.productName)
    if (!key) { withoutProduct++; continue }

    let g = groups.get(key)
    if (!g) {
      g = {
        names: new Map(), customers: new Set(), anonymous: 0,
        reasons: new Map(), unknown: 0, monthly: new Map(), returns: 0, last: row.createdAt,
      }
      groups.set(key, g)
    }

    g.returns++
    const label = row.productName!.trim().replace(/\s+/g, ' ')
    g.names.set(label, (g.names.get(label) ?? 0) + 1)
    if (customer) g.customers.add(customer)
    else g.anonymous++

    const reason = extractReturnReason(row.mlInput, row.description)
    if (reason) g.reasons.set(reason, (g.reasons.get(reason) ?? 0) + 1)
    else g.unknown++

    const month = monthOf(row.createdAt)
    g.monthly.set(month, (g.monthly.get(month) ?? 0) + 1)
    if (row.createdAt > g.last) g.last = row.createdAt
  }

  const products: ProductReturnStats[] = [...groups.entries()].map(([key, g]) => {
    const reasons: ReasonCount[] = [...g.reasons.entries()]
      .map(([reason, count]) => ({ reason, count, share: count / g.returns }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'fr'))

    // Nom affiché : l'orthographe la plus fréquente parmi les retours.
    const productName = [...g.names.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0][0]

    return {
      productKey:        key,
      productName,
      returns:           g.returns,
      distinctCustomers: g.customers.size + g.anonymous,
      reasons,
      unknownReason:     g.unknown,
      topReason:         reasons[0] ?? null,
      monthly:           months.map(month => ({ month, count: g.monthly.get(month) ?? 0 })),
      lastReturnAt:      g.last,
    }
  })

  products.sort((a, b) =>
    b.returns - a.returns
    || b.distinctCustomers - a.distinctCustomers
    || a.productName.localeCompare(b.productName, 'fr'),
  )

  return {
    totalReturns:      rows.length,
    distinctCustomers: allCustomers.size,
    withoutProduct,
    months,
    products,
  }
}

// ─────────────────────────────────────────────────────────────
// Lecture en base
// ─────────────────────────────────────────────────────────────

/**
 * Analyse des retours d'une boutique. Le filtre `vendorId` est appliqué en
 * base : l'appelant le tire de la session, jamais d'un paramètre d'URL.
 *
 * Les réclamations refusées d'office par la politique (`policyRejected`) sont
 * exclues, comme partout ailleurs côté vendeur.
 */
export async function getProductReturnAnalytics(vendorId: string): Promise<ProductReturnAnalytics> {
  const rows = await prisma.claim.findMany({
    where:  { vendorId, policyRejected: false },
    select: {
      productName:   true,
      customerEmail: true,
      customerPhone: true,
      mlInput:       true,
      description:   true,
      createdAt:     true,
    },
  })
  return aggregateProductReturns(rows)
}
