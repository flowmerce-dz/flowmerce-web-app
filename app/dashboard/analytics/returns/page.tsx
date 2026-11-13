// app/dashboard/analytics/returns/page.tsx — Flowmerce
//
// Analyses et statistiques → Détail des retours : tableau des retours,
// filtrable par produit, par motif et par client.
//
// Isolation : le vendeur est résolu depuis la SESSION. Les filtres de l'URL
// (`produit`, `motif`, `client`) ne font que restreindre ses propres retours.
// Les filtres passent par un formulaire GET : l'URL reste partageable et la
// page d'analyse peut pointer directement sur le tableau filtré d'un produit.

import { redirect } from 'next/navigation'
import { ChevronRight, SearchX, Table2 } from 'lucide-react'
import { getSessionServer } from '@/lib/getSession'
import { prisma } from '@/lib/prisma'
import { checkVendorAccess } from '@/lib/vendorGuard'
import { CLAIM_STATUS_LABELS, formatDate } from '@/lib/utils'
import { RETURN_REASONS, formatReturnReasonDetail } from '@/lib/constants'
import {
  BTN_GHOST, BTN_PRIMARY, Card, EmptyState, FIELD, FOCUS, PageHeader, Pagination, StatusBadge,
} from '@/components/dashboard/ui'
import {
  parseReturnFilters, returnsTableHref, returnsWhere,
} from '@/lib/services/return-explorer'

const PAGE_SIZE = 10

const LABEL = 'mb-2 block text-[13px] font-semibold text-ink'

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
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

export default async function ReturnsTablePage({
  searchParams,
}: {
  searchParams: Promise<{
    produit?: string | string[]
    motif?:   string | string[]
    client?:  string | string[]
    page?:    string | string[]
  }>
}) {
  await checkVendorAccess()
  const session = await getSessionServer()
  if (!session) redirect('/auth/login')

  const vendor = await prisma.vendor.findUnique({
    where:  { userId: session.user.id },
    select: { id: true },
  })
  if (!vendor) redirect('/dashboard')

  const params  = await searchParams
  const filters = parseReturnFilters(params)
  const where   = returnsWhere(vendor.id, filters)
  const active  = Boolean(filters.product || filters.reason || filters.customer)

  const filteredCount = await prisma.claim.count({ where })
  const totalPages    = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))
  const rawPage       = Array.isArray(params.page) ? params.page[0] : params.page
  const requestedPage = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1)
  // Une page hors bornes (filtre resserré, lien périmé) retombe sur la dernière.
  const page          = Math.min(requestedPage, totalPages)

  const [returns, products] = await Promise.all([
    prisma.claim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
      select: {
        id: true, createdAt: true, status: true, orderId: true,
        customerName: true, customerEmail: true,
        productKey: true, productName: true,
        returnReason: true, returnReasonDetail: true, returnReasonComment: true,
      },
    }),
    // Liste du filtre produit : uniquement les produits de CE vendeur.
    prisma.claim.findMany({
      where:    { vendorId: vendor.id, policyRejected: false, productKey: { not: null } },
      distinct: ['productKey'],
      select:   { productKey: true, productName: true },
      orderBy:  { productKey: 'asc' },
    }),
  ])

  const productOptions = products
    .filter((p): p is { productKey: string; productName: string | null } => p.productKey !== null)
    .map(p => ({ value: p.productKey, label: p.productName?.trim() || p.productKey }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))

  // Lien périmé vers un produit absent de la liste : l'option reste affichée
  // pour que le filtre actif soit visible et puisse être retiré.
  if (filters.product && !productOptions.some(o => o.value === filters.product)) {
    productOptions.unshift({ value: filters.product, label: 'Produit sélectionné' })
  }
  const selectedProduct = productOptions.find(o => o.value === filters.product)

  return (
    <div className="w-full max-w-5xl p-5 sm:p-10">
      <PageHeader
        title="Détail des retours"
        subtitle={
          selectedProduct
            ? `Retours du produit « ${selectedProduct.label} ».`
            : 'Tous vos retours, filtrables par produit, par motif et par client.'
        }
      />

      <Card className="mb-6">
        <form method="get" action={returnsTableHref({})} className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="filter-product" className={LABEL}>Produit</label>
            <select id="filter-product" name="produit" defaultValue={filters.product ?? ''} className={FIELD}>
              <option value="">Tous les produits</option>
              {productOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-reason" className={LABEL}>Motif</label>
            <select id="filter-reason" name="motif" defaultValue={filters.reason ?? ''} className={FIELD}>
              <option value="">Tous les motifs</option>
              {RETURN_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-customer" className={LABEL}>Client</label>
            <input
              id="filter-customer"
              type="search"
              name="client"
              defaultValue={filters.customer ?? ''}
              placeholder="Nom, e-mail ou téléphone"
              maxLength={200}
              className={FIELD}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
            <button type="submit" className={BTN_PRIMARY}>Filtrer</button>
            {active && (
              <a href={returnsTableHref({})} className={BTN_GHOST}>Réinitialiser</a>
            )}
          </div>
        </form>
      </Card>

      {filteredCount === 0 ? (
        <Card padded={false}>
          {active ? (
            <EmptyState
              icon={SearchX}
              title="Aucun retour ne correspond à ces filtres"
              hint="Élargissez la recherche ou retirez un filtre."
              action={<a href={returnsTableHref({})} className={BTN_GHOST}>Réinitialiser les filtres</a>}
            />
          ) : (
            <EmptyState
              icon={Table2}
              title="Aucun retour pour le moment"
              hint="Les retours apparaîtront ici dès que vos clients auront soumis leurs premières demandes."
            />
          )}
        </Card>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">
                Retours, {filteredCount} au total, page {page}
              </caption>
              <thead>
                <tr className="border-b border-line bg-page">
                  <Th>Client</Th>
                  <Th>Produit</Th>
                  <Th>Motif</Th>
                  <Th>Statut</Th>
                  <Th align="right">Date</Th>
                  <Th align="right">Action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {returns.map(r => {
                  const detail = formatReturnReasonDetail(r.returnReasonDetail)
                  return (
                    <tr key={r.id} className="align-top transition-colors hover:bg-page">
                      {/* Client : le nom filtre le tableau sur ce client. */}
                      <td className="px-4 py-4">
                        <a
                          href={returnsTableHref({ ...filters, customer: r.customerEmail })}
                          title={`Voir les retours de ${r.customerName}`}
                          className={`rounded-control text-[13px] font-semibold text-ink hover:text-brand-ink hover:underline ${FOCUS}`}
                        >
                          {r.customerName}
                        </a>
                        <p className="mt-0.5 truncate text-[12px] text-body">{r.customerEmail}</p>
                        <p className="mt-1 font-mono text-[11px] text-faint">{r.orderId}</p>
                      </td>

                      {/* Produit : le nom filtre le tableau sur ce produit. */}
                      <td className="px-4 py-4">
                        {r.productKey ? (
                          <a
                            href={returnsTableHref({ ...filters, product: r.productKey })}
                            title={`Voir les retours de ${r.productName ?? 'ce produit'}`}
                            className={`block max-w-44 truncate rounded-control text-[13px] text-ink hover:text-brand-ink hover:underline ${FOCUS}`}
                          >
                            {r.productName ?? '—'}
                          </a>
                        ) : (
                          <span className="text-[13px] text-faint">{r.productName ?? '—'}</span>
                        )}
                      </td>

                      {/* Motif, sous-raison et commentaire du client. */}
                      <td className="px-4 py-4">
                        {r.returnReason ? (
                          <p className="text-[13px] text-ink">{r.returnReason}</p>
                        ) : (
                          <p className="text-[12px] text-faint">Non renseigné</p>
                        )}
                        {detail && <p className="mt-0.5 text-[12px] text-body">{detail}</p>}
                        {r.returnReasonComment && (
                          <p
                            className="mt-1 max-w-56 truncate text-[12px] italic text-faint"
                            title={r.returnReasonComment}
                          >
                            « {r.returnReasonComment} »
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        <StatusBadge status={r.status} label={CLAIM_STATUS_LABELS[r.status] ?? r.status} />
                      </td>

                      <td className="px-4 py-4 text-right text-[12px] tabular-nums text-body whitespace-nowrap">
                        {formatDate(r.createdAt)}
                      </td>

                      <td className="px-4 py-4 text-right">
                        <a
                          href={`/dashboard/claims/${r.id}`}
                          aria-label={`Détail de la réclamation de ${r.customerName}`}
                          className={`inline-flex items-center gap-0.5 rounded-control text-[12px] font-semibold text-brand-ink hover:underline ${FOCUS}`}
                        >
                          Détail
                          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={filteredCount}
            label="retours"
            hrefFor={(p) => returnsTableHref(filters, p)}
          />
        </div>
      )}
    </div>
  )
}
