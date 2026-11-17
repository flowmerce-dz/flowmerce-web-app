// app/dashboard/analytics/products/page.tsx — Flowmerce
//
// Analyses → Produits les plus retournés.
//
//   1. Chiffres clés.
//   2. Cercle : part de chaque produit dans les retours.
//   3. Tableau des produits, du plus retourné au moins retourné ; chaque ligne
//      se déplie sur le détail du produit.
//
// Isolation : le vendeur est résolu depuis la SESSION, jamais depuis l'URL, et
// getProductReturnAnalytics filtre en base sur son vendorId. Aucun paramètre ne
// permet de lire les retours d'une autre boutique.
//
// Flowmerce ne connaît pas les commandes livrées : aucun taux de retour n'est
// affiché. Chaque pourcentage est une part des retours.

import { redirect } from 'next/navigation'
import { Package, PackageSearch, RotateCcw, Users } from 'lucide-react'
import { getSessionServer } from '@/lib/getSession'
import { prisma } from '@/lib/prisma'
import { checkVendorAccess } from '@/lib/vendorGuard'
import { formatDate } from '@/lib/utils'
import { Card, CardTitle, EmptyState, PageHeader, StatTile } from '@/components/dashboard/ui'
import { getProductReturnAnalytics, shareSegments } from '@/lib/services/product-returns'
import { ReturnsDonut } from './ReturnsDonut'
import { ProductReturnsTable, type ProductRow } from './ProductReturnsTable'

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
    select: { id: true },
  })
  if (!vendor) redirect('/dashboard')

  const analytics = await getProductReturnAnalytics(vendor.id)
  const identified = analytics.totalReturns - analytics.withoutProduct
  const segments   = shareSegments(analytics.products)

  // Données sérialisables pour le tableau (composant client).
  const rows: ProductRow[] = analytics.products.map(p => ({
    productKey:        p.productKey,
    productName:       p.productName,
    returns:           p.returns,
    share:             identified > 0 ? p.returns / identified : 0,
    distinctCustomers: p.distinctCustomers,
    topReason:         p.topReason && { reason: p.topReason.reason, share: p.topReason.share },
    reasons:           p.reasons,
    unknownReason:     p.unknownReason,
    monthly:           p.monthly.map(m => ({ ...m, label: monthLabel(m.month) })),
    lastReturnLabel:   formatDate(p.lastReturnAt),
  }))

  return (
    <div className="w-full max-w-6xl p-5 sm:p-10">
      <PageHeader
        title="Produits les plus retournés"
        subtitle="Les produits que vos clients retournent le plus, et pour quels motifs."
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
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label="Retours" value={analytics.totalReturns} icon={RotateCcw} />
            <StatTile label="Clients concernés" value={analytics.distinctCustomers} icon={Users} />
            <StatTile
              label="Produits retournés"
              value={analytics.products.length}
              icon={Package}
              hint={analytics.withoutProduct > 0
                ? `${analytics.withoutProduct} retour${analytics.withoutProduct > 1 ? 's' : ''} sans nom de produit`
                : undefined}
            />
          </div>

          {segments.length > 0 && (
            <Card>
              <CardTitle
                aside={
                  <span className="text-[12px] tabular-nums text-faint">
                    {identified} retour{identified > 1 ? 's' : ''} avec un produit identifié
                  </span>
                }
              >
                Répartition des retours par produit
              </CardTitle>
              <ReturnsDonut segments={segments} total={identified} />
            </Card>
          )}

          {rows.length > 0 && (
            <section aria-labelledby="products-table-title" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="products-table-title" className="text-[13px] font-semibold text-ink">
                  Tous les produits retournés
                </h2>
                <p className="text-[12px] text-faint">Cliquez sur un produit pour afficher son détail.</p>
              </div>
              <ProductReturnsTable products={rows} />
            </section>
          )}

          <p className="text-[12px] leading-relaxed text-body">
            Flowmerce ne connaît pas vos ventes : les pourcentages sont calculés parmi les retours,
            et non sur les commandes livrées.
          </p>
        </div>
      )}
    </div>
  )
}
