// lib/services/customer-returns.ts — Flowmerce
//
// Clients d'une boutique qui ont fait au moins un retour : un client par
// ligne, avec ses retours, leur issue et son score de fraude, puis filtres et
// tris de la page /dashboard/customers.
//
// Un client est identifié par son e-mail (insensible à la casse), à défaut par
// son téléphone. Lecture seule, sans migration : tout vient de `Claim`.

import { prisma } from '@/lib/prisma'
import { extractReturnReason } from '@/lib/services/product-returns'
import type { ReturnReason } from '@/lib/constants'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CustomerClaimRow {
  id:            string
  orderId:       string
  customerName:  string
  customerEmail: string
  customerPhone: string | null
  productName:   string | null
  status:        string
  aiDecision:    string | null
  fraudScore:    number | null
  mlInput:       unknown
  description:   string
  createdAt:     Date
}

export interface CustomerClaim {
  id:          string
  orderId:     string
  productName: string | null
  reason:      ReturnReason | null
  status:      string
  aiDecision:  string | null
  createdAt:   Date
}

export interface CustomerStats {
  key:        string
  name:       string
  email:      string | null
  phone:      string | null
  returns:    number
  approved:   number
  rejected:   number
  /** En attente ou en cours. */
  open:       number
  /** Part des retours refusés parmi les retours tranchés, entre 0 et 1, ou null. */
  rejectRate: number | null
  /** Score de fraude du retour le plus récent. */
  fraudScore: number | null
  firstReturnAt: Date
  lastReturnAt:  Date
  topReason:  ReturnReason | null
  /** Du plus récent au plus ancien. */
  claims:     CustomerClaim[]
}

// ─────────────────────────────────────────────────────────────
// Agrégation (pure)
// ─────────────────────────────────────────────────────────────

function customerKey(row: Pick<CustomerClaimRow, 'customerEmail' | 'customerPhone' | 'id'>): string {
  const email = row.customerEmail?.trim().toLowerCase()
  if (email) return `email:${email}`
  const phone = row.customerPhone?.trim()
  if (phone) return `phone:${phone}`
  // Sans e-mail ni téléphone : un client à part, jamais fusionné.
  return `claim:${row.id}`
}

export function aggregateCustomers(rows: readonly CustomerClaimRow[]): CustomerStats[] {
  const groups = new Map<string, CustomerClaimRow[]>()
  for (const row of rows) {
    const key  = customerKey(row)
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  return [...groups.entries()].map(([key, list]) => {
    const sorted   = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const latest   = sorted[0]
    const approved = list.filter(c => c.status === 'APPROVED').length
    const rejected = list.filter(c => c.status === 'REJECTED').length
    const decided  = approved + rejected

    const claims: CustomerClaim[] = sorted.map(c => ({
      id:          c.id,
      orderId:     c.orderId,
      productName: c.productName,
      reason:      extractReturnReason(c.mlInput, c.description),
      status:      c.status,
      aiDecision:  c.aiDecision,
      createdAt:   c.createdAt,
    }))

    const reasonCounts = new Map<ReturnReason, number>()
    for (const c of claims) {
      if (c.reason) reasonCounts.set(c.reason, (reasonCounts.get(c.reason) ?? 0) + 1)
    }
    const topReason = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0]?.[0] ?? null

    // Coordonnées : les plus récentes connues.
    const phone = sorted.find(c => c.customerPhone?.trim())?.customerPhone?.trim() ?? null
    const email = latest.customerEmail?.trim() || null

    return {
      key,
      name:          latest.customerName?.trim() || email || phone || 'Client inconnu',
      email,
      phone,
      returns:       list.length,
      approved,
      rejected,
      open:          list.length - decided,
      rejectRate:    decided > 0 ? rejected / decided : null,
      fraudScore:    sorted.find(c => c.fraudScore != null)?.fraudScore ?? null,
      firstReturnAt: sorted[sorted.length - 1].createdAt,
      lastReturnAt:  latest.createdAt,
      topReason,
      claims,
    }
  })
}

// ─────────────────────────────────────────────────────────────
// Filtres et tris
// ─────────────────────────────────────────────────────────────

export const SORT_KEYS = ['returns', 'last', 'fraud', 'rejectRate', 'name'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'

/** Sens par défaut quand on choisit une colonne : du plus parlant au moins. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  returns:    'desc',
  last:       'desc',
  fraud:      'desc',
  rejectRate: 'desc',
  name:       'asc',
}

export const RISK_FILTERS = ['low', 'watch', 'alert'] as const
export type RiskFilter = (typeof RISK_FILTERS)[number]

export const PERIOD_FILTERS = ['30', '90', '365'] as const
export type PeriodFilter = (typeof PERIOD_FILTERS)[number]

export const MIN_RETURNS = ['2', '3', '5'] as const

export const STATUS_FILTERS = ['open', 'rejected'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

export interface CustomerQuery {
  q?:          string
  risk?:       RiskFilter
  period?:     PeriodFilter
  minReturns?: number
  status?:     StatusFilter
  sort:        SortKey
  dir:         SortDir
  page:        number
}

const MAX_SEARCH = 200

const pick = <T extends string>(allowed: readonly T[], value: string | undefined): T | undefined =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** Lit les paramètres de l'URL ; une valeur invalide est ignorée, pas refusée. */
export function parseCustomerQuery(params: Record<string, string | string[] | undefined>): CustomerQuery {
  const q      = first(params.q)?.trim()
  const sort   = pick(SORT_KEYS, first(params.tri)) ?? 'returns'
  const dir    = pick(['asc', 'desc'] as const, first(params.ordre)) ?? DEFAULT_DIR[sort]
  const min    = pick(MIN_RETURNS, first(params.min))
  const page   = Number.parseInt(first(params.page) ?? '1', 10)
  return {
    q:          q && q.length <= MAX_SEARCH ? q : undefined,
    risk:       pick(RISK_FILTERS, first(params.risque)),
    period:     pick(PERIOD_FILTERS, first(params.periode)),
    minReturns: min ? Number(min) : undefined,
    status:     pick(STATUS_FILTERS, first(params.statut)),
    sort,
    dir,
    page:       Number.isFinite(page) && page > 0 ? page : 1,
  }
}

/** Même découpage que le reste du tableau de bord (riskBand). */
export function riskOf(score: number | null): RiskFilter | null {
  if (score === null) return null
  if (score > 70) return 'alert'
  if (score >= 40) return 'watch'
  return 'low'
}

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function filterCustomers(
  customers: readonly CustomerStats[],
  query: Pick<CustomerQuery, 'q' | 'risk' | 'period' | 'minReturns' | 'status'>,
  now: Date = new Date(),
): CustomerStats[] {
  const needle = query.q ? normalize(query.q) : null
  const since  = query.period ? now.getTime() - Number(query.period) * 86_400_000 : null

  return customers.filter(c => {
    if (needle) {
      const haystack = normalize([c.name, c.email ?? '', c.phone ?? ''].join(' '))
      if (!haystack.includes(needle)) return false
    }
    if (query.risk && riskOf(c.fraudScore) !== query.risk) return false
    if (since !== null && c.lastReturnAt.getTime() < since) return false
    if (query.minReturns && c.returns < query.minReturns) return false
    if (query.status === 'open' && c.open === 0) return false
    if (query.status === 'rejected' && c.rejected === 0) return false
    return true
  })
}

export function sortCustomers(customers: readonly CustomerStats[], sort: SortKey, dir: SortDir): CustomerStats[] {
  const sign = dir === 'asc' ? 1 : -1
  // Une valeur absente (score, taux) va toujours en fin de liste.
  const nullable = (a: number | null, b: number | null) =>
    a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : sign * (a - b)

  return [...customers].sort((a, b) => {
    let cmp = 0
    switch (sort) {
      case 'returns':    cmp = sign * (a.returns - b.returns); break
      case 'last':       cmp = sign * (a.lastReturnAt.getTime() - b.lastReturnAt.getTime()); break
      case 'fraud':      cmp = nullable(a.fraudScore, b.fraudScore); break
      case 'rejectRate': cmp = nullable(a.rejectRate, b.rejectRate); break
      case 'name':       cmp = sign * a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }); break
    }
    // Départage stable : le plus récent d'abord, puis le nom.
    return cmp
      || b.lastReturnAt.getTime() - a.lastReturnAt.getTime()
      || a.name.localeCompare(b.name, 'fr')
  })
}

// ─────────────────────────────────────────────────────────────
// Lecture en base
// ─────────────────────────────────────────────────────────────

/**
 * Clients d'une boutique. Le filtre `vendorId` est appliqué en base :
 * l'appelant le tire de la session, jamais d'un paramètre d'URL. Les refus
 * d'office par la politique (`policyRejected`) sont exclus, comme partout
 * ailleurs côté vendeur.
 */
export async function getVendorCustomers(vendorId: string): Promise<CustomerStats[]> {
  const rows = await prisma.claim.findMany({
    where:  { vendorId, policyRejected: false },
    select: {
      id: true, orderId: true, customerName: true, customerEmail: true, customerPhone: true,
      productName: true, status: true, aiDecision: true, fraudScore: true,
      mlInput: true, description: true, createdAt: true,
    },
  })
  return aggregateCustomers(rows)
}
