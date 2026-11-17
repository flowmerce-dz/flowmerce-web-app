'use client'

// app/dashboard/analytics/products/ProductReturnsTable.tsx — Flowmerce
//
// Classement des produits retournés, au format du tableau des réclamations.
// Chaque ligne se déplie sur le détail du produit : répartition des motifs et
// retours par mois.
//
// Les données arrivent déjà calculées et sérialisées depuis la page (serveur) ;
// ce composant ne gère que la pagination et l'ouverture des lignes.

import { Fragment, useState } from 'react'
import { BarChart3, ChevronDown } from 'lucide-react'
import { FOCUS, Pagination } from '@/components/dashboard/ui'
import { segmentColor, RANK_COLORS } from './ReturnsDonut'

export interface ProductRow {
  productKey:        string
  productName:       string
  returns:           number
  /** Part des retours avec un produit identifié, entre 0 et 1. */
  share:             number
  distinctCustomers: number
  topReason:         { reason: string; share: number } | null
  reasons:           { reason: string; count: number; share: number }[]
  unknownReason:     number
  monthly:           { month: string; label: string; count: number }[]
  lastReturnLabel:   string
}

const PAGE_SIZE = 10

const pct = (share: number) => `${Math.round(share * 100)} %`

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

export function ProductReturnsTable({ products }: { products: ProductRow[] }) {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const rows = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  // Les barres de part sont à l'échelle du produit le plus retourné : elles
  // comparent les produits entre eux ; le pourcentage exact est écrit à côté.
  const maxShare = Math.max(...products.map(p => p.share), 0) || 1
  const firstRank = (page - 1) * PAGE_SIZE + 1

  function toggle(key: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">
            Produits retournés, du plus retourné au moins retourné, {products.length} au total, page {page}
          </caption>
          <thead>
            <tr className="border-b border-line bg-page">
              <Th>Rang</Th>
              <Th>Produit</Th>
              <Th align="right">Retours</Th>
              <Th>Part des retours</Th>
              <Th align="right">Clients</Th>
              <Th>Motif principal</Th>
              <Th align="right">Dernier retour</Th>
              <Th><span className="sr-only">Détail</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p, i) => {
              const rank     = firstRank + i
              const expanded = open.has(p.productKey)
              const detailId = `product-detail-${rank}`
              return (
                <Fragment key={p.productKey}>
                  <tr
                    onClick={() => toggle(p.productKey)}
                    className={`cursor-pointer transition-colors hover:bg-page/60 ${expanded ? 'bg-page/60' : ''}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3.5 text-[13px] font-semibold tabular-nums text-faint">
                      #{rank}
                    </td>
                    <td className="max-w-[280px] px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        {/* Même pastille que dans le cercle, pour les produits qui y figurent. */}
                        {rank <= RANK_COLORS.length && (
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: segmentColor(rank) }}
                          />
                        )}
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={e => { e.stopPropagation(); toggle(p.productKey) }}
                          className={`min-w-0 truncate rounded-control text-left text-[13px] font-semibold text-ink hover:text-brand-ink ${FOCUS}`}
                          title={p.productName}
                        >
                          {p.productName}
                        </button>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right text-[13px] font-bold tabular-nums text-ink">
                      {p.returns}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-page">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${(p.share / maxShare) * 100}%` }} />
                        </div>
                        <span className="text-[12px] font-semibold tabular-nums text-ink">{pct(p.share)}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right text-[13px] tabular-nums text-body">
                      {p.distinctCustomers}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-[13px] text-body">
                      {p.topReason ? (
                        <>
                          <span className="text-ink">{p.topReason.reason}</span>
                          <span className="ml-1.5 text-[11px] tabular-nums text-faint">{pct(p.topReason.share)}</span>
                        </>
                      ) : (
                        <span className="text-faint">Non renseigné</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right text-[12px] tabular-nums text-body">
                      {p.lastReturnLabel}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <ChevronDown
                        aria-hidden
                        size={16}
                        className={`inline text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
                      />
                    </td>
                  </tr>

                  {expanded && (
                    <tr id={detailId} className="bg-page/40">
                      <td colSpan={8} className="px-4 py-5 sm:px-6">
                        <ProductDetail product={p} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {products.length > PAGE_SIZE && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={products.length}
          label="produits"
          onPageChange={setPage}
        />
      )}
    </div>
  )
}

function ProductDetail({ product }: { product: ProductRow }) {
  const maxMonthly = Math.max(1, ...product.monthly.map(m => m.count))

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      {/* Répartition des motifs */}
      <div className="lg:col-span-2">
        <h3 className="mb-3 text-[12px] font-semibold text-ink">Répartition des motifs</h3>
        {product.reasons.length === 0 && product.unknownReason === 0 ? (
          <p className="text-[13px] text-faint">Aucun motif renseigné.</p>
        ) : (
          <ul className="m-0 list-none space-y-3.5 p-0">
            {product.reasons.map(r => (
              <li key={r.reason}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink">{r.reason}</span>
                  <span className="text-[13px] font-bold tabular-nums text-ink">
                    {r.count}
                    <span className="ml-1 text-[11px] font-medium text-faint">{pct(r.share)}</span>
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`${r.reason} : ${r.count} retour(s), ${pct(r.share)} des retours du produit`}
                  className="flex h-2 overflow-hidden rounded-full bg-surface"
                >
                  <div className="rounded-full bg-brand" style={{ width: `${r.share * 100}%` }} />
                </div>
              </li>
            ))}
            {product.unknownReason > 0 && (
              <li className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-faint">Motif non renseigné</span>
                <span className="tabular-nums text-faint">{product.unknownReason}</span>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Évolution dans le temps */}
      <div>
        <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <BarChart3 size={13} strokeWidth={1.75} className="text-faint" aria-hidden />
          Retours par mois
        </h3>
        <div
          role="img"
          aria-label={product.monthly.map(m => `${m.label} : ${m.count}`).join(', ')}
          className="flex h-24 items-end gap-2"
        >
          {product.monthly.map(m => (
            <div
              key={m.month}
              title={`${m.label} : ${m.count} retour${m.count > 1 ? 's' : ''}`}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-[11px] tabular-nums text-faint">{m.count || ''}</span>
              <div
                className={`w-full max-w-6 rounded-t-[4px] ${m.count > 0 ? 'bg-brand' : 'bg-line'}`}
                style={{ height: `${Math.max((m.count / maxMonthly) * 100, 4)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-2" aria-hidden>
          {product.monthly.map(m => (
            <span key={m.month} className="flex-1 text-center text-[11px] text-faint">{m.label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
