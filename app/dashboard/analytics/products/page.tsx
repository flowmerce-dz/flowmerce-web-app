// app/dashboard/analytics/products/page.tsx — Flowmerce
//
// Analyses et statistiques → Analyse des retours produits.
//
// Isolation : le vendeur est résolu depuis la SESSION, jamais depuis l'URL, et
// getProductReturnAnalytics filtre en base sur son vendorId. Aucun paramètre ne
// permet de lire les retours d'une autre boutique.
//
// Flowmerce ne connaît pas les commandes livrées : aucun taux de retour n'est
// affiché. Chaque pourcentage est une part des retours du produit.

import { redirect } from 'next/navigation'
import { BarChart3, Lightbulb, PackageSearch, Users, RotateCcw, Package } from 'lucide-react'
import { getSessionServer } from '@/lib/getSession'
import { prisma } from '@/lib/prisma'
import { checkVendorAccess } from '@/lib/vendorGuard'
import { Card, CardTitle, EmptyState, FOCUS, Notice, PageHeader, StatTile } from '@/components/dashboard/ui'
import {
  getProductReturnAnalytics,
  type ProductReturnStats,
} from '@/lib/services/product-issues'
import { returnsTableHref } from '@/lib/services/return-explorer'
import { ShowMoreList } from './ShowMoreList'

// Les produits sont déroulés par tranches, des plus retournés aux moins
// retournés : la page reste une analyse, la suite est à portée d'un clic.
const PRODUCTS_STEP = 10

const pct = (share: number) => `${Math.round(share * 100)} %`

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', {
    month: 'short', timeZone: 'UTC',
  })
}

export default async function ProductReturnsAnalyticsPage() {
  await checkVendorAccess()
  const session = await getSessionServer()
  if (!session) redirect('/auth/login')

  const vendor = await prisma.vendor.findUnique({
    where:  { userId: session.user.id },
    select: { id: true, companyName: true },
  })
  if (!vendor) redirect('/dashboard')

  const analytics = await getProductReturnAnalytics(vendor.id)
  const withIssue = analytics.products.filter(p => p.issues.length > 0).length

  return (
    <div className="w-full max-w-5xl p-5 sm:p-10">
      <PageHeader
        title="Analyse des retours produits"
        subtitle="Les produits les plus retournés, leurs motifs et les problèmes récurrents signalés par vos clients."
      />

      {analytics.totalReturns === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={PackageSearch}
            title="Aucun retour à analyser pour le moment"
            hint="Les statistiques apparaîtront dès que vos clients auront soumis leurs premières demandes de retour."
          />
        </Card>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Retours" value={analytics.totalReturns} icon={RotateCcw} />
            <StatTile label="Clients concernés" value={analytics.distinctCustomers} icon={Users} />
            <StatTile label="Produits retournés" value={analytics.products.length} icon={Package} />
            <StatTile
              label="Problèmes récurrents"
              value={withIssue}
              tone={withIssue > 0 ? 'warning' : 'neutral'}
              icon={Lightbulb}
              hint={withIssue > 0 ? 'Produits signalés par plusieurs clients' : undefined}
            />
          </div>

          <p className="text-[12px] leading-relaxed text-body">
            Flowmerce ne connaît pas vos ventes : les pourcentages sont calculés parmi les retours de
            chaque produit, et non sur les commandes livrées. Les retours enregistrés avant
            l’introduction des sous-raisons apparaissent avec leur motif, sans précision.
          </p>

          <ShowMoreList step={PRODUCTS_STEP} noun={{ one: 'produit', other: 'produits' }}>
            {analytics.products.map((product, i) => (
              <ProductCard key={product.productKey} product={product} rank={i + 1} months={analytics.months} />
            ))}
          </ShowMoreList>
        </div>
      )}
    </div>
  )
}

function ProductCard({
  product, rank, months,
}: {
  product: ProductReturnStats
  rank:    number
  months:  string[]
}) {
  const maxMonthly = Math.max(1, ...product.monthly.map(m => m.count))

  return (
    <Card>
      <CardTitle
        aside={
          <span className="text-[12px] tabular-nums text-faint">
            {product.returns} retour{product.returns > 1 ? 's' : ''} ·{' '}
            {product.distinctCustomers} client{product.distinctCustomers > 1 ? 's' : ''}
          </span>
        }
      >
        <span className="mr-1.5 text-faint tabular-nums">#{rank}</span>
        <a
          href={returnsTableHref({ product: product.productKey })}
          title={`Voir le détail des retours de ${product.productName}`}
          className={`rounded-control hover:text-brand-ink hover:underline ${FOCUS}`}
        >
          {product.productName}
        </a>
      </CardTitle>

      <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-[12px] text-body">Motif le plus fréquent</dt>
          <dd className="m-0 text-[14px] font-semibold text-ink">
            {product.topReason
              ? <>{product.topReason.reason} <span className="text-[12px] font-medium text-faint">{pct(product.topReason.share)}</span></>
              : <span className="font-normal text-faint">Non renseigné</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-body">Sous-raison la plus fréquente</dt>
          <dd className="m-0 text-[14px] font-semibold text-ink">
            {product.topDetail
              ? <>{product.topDetail.label} <span className="text-[12px] font-medium text-faint">{product.topDetail.count} · {pct(product.topDetail.share)}</span></>
              : <span className="font-normal text-faint">Non renseignée</span>}
          </dd>
        </div>
      </dl>

      {product.recommendations.length > 0 && (
        <div className="mb-6 space-y-3">
          {product.recommendations.map(text => (
            <Notice key={text} tone="warning" icon={Lightbulb} title="Recommandation Flowmerce">
              {text}
            </Notice>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Répartition des motifs et sous-raisons */}
        <div className="lg:col-span-2">
          <h3 className="mb-3 text-[12px] font-semibold text-ink">Répartition des motifs</h3>
          <ul className="m-0 list-none space-y-4 p-0">
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
                  className="flex h-2 overflow-hidden rounded-full bg-page"
                >
                  <div className="bg-brand" style={{ width: `${r.share * 100}%` }} />
                </div>
                {(r.details.length > 0 || r.withoutDetail > 0) && (
                  <ul className="m-0 mt-2 list-none space-y-1 border-l border-line p-0 pl-3">
                    {r.details.map(d => (
                      <li key={d.code} className="flex items-baseline justify-between gap-3 text-[12px]">
                        <span className="text-body">{d.label}</span>
                        <span className="tabular-nums text-ink">
                          {d.count}
                          <span className="ml-1 text-faint">
                            {pct(d.share)} · {d.distinctCustomers} client{d.distinctCustomers > 1 ? 's' : ''}
                          </span>
                        </span>
                      </li>
                    ))}
                    {r.withoutDetail > 0 && (
                      <li className="flex items-baseline justify-between gap-3 text-[12px]">
                        <span className="text-faint">Sans précision</span>
                        <span className="tabular-nums text-faint">{r.withoutDetail}</span>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            ))}
            {product.unknownReason > 0 && (
              <li className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-faint">Motif non renseigné</span>
                <span className="tabular-nums text-faint">{product.unknownReason}</span>
              </li>
            )}
          </ul>
        </div>

        {/* Évolution dans le temps */}
        <div>
          <h3 className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <BarChart3 size={13} strokeWidth={1.75} className="text-faint" aria-hidden />
            Retours par mois
          </h3>
          <div
            role="img"
            aria-label={product.monthly.map(m => `${monthLabel(m.month)} : ${m.count}`).join(', ')}
            className="flex h-24 items-end gap-2"
          >
            {product.monthly.map(m => (
              <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] tabular-nums text-faint">{m.count || ''}</span>
                <div
                  className={`w-full rounded-sm ${m.count > 0 ? 'bg-brand' : 'bg-page'}`}
                  style={{ height: `${Math.max((m.count / maxMonthly) * 100, 4)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2" aria-hidden>
            {months.map(m => (
              <span key={m} className="flex-1 text-center text-[11px] text-faint">{monthLabel(m)}</span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
