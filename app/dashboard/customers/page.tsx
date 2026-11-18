// app/dashboard/customers/page.tsx — Flowmerce
//
// Clients → tous les clients qui ont fait au moins un retour chez le vendeur,
// avec filtres (recherche, période, risque, nombre de retours, statut) et
// tris (retours, dernier retour, score de fraude, taux de refus, nom).
//
// Filtres, tri et page vivent dans l'URL : un lien partagé ou un retour
// arrière retrouve exactement la même vue.
//
// Isolation : le vendeur est résolu depuis la SESSION, jamais depuis l'URL, et
// getVendorCustomers filtre en base sur son vendorId.

import { redirect } from 'next/navigation'
import { AlertTriangle, Clock, Repeat, Search, Users, UsersRound } from 'lucide-react'
import { getSessionServer } from '@/lib/getSession'
import { prisma } from '@/lib/prisma'
import { checkVendorAccess } from '@/lib/vendorGuard'
import { formatDate } from '@/lib/utils'
import { CLAIM_STATUS_LABELS, VENDOR_DECISION_LABELS } from '@/lib/constants'
import {
  BTN_GHOST, BTN_PRIMARY, Card, EmptyState, FIELD, FOCUS, PageHeader, Pagination, StatTile, riskBand,
} from '@/components/dashboard/ui'
import {
  DEFAULT_DIR, filterCustomers, getVendorCustomers, parseCustomerQuery, sortCustomers,
  type SortKey,
} from '@/lib/services/customer-returns'
import { CustomersTable, type CustomerRow, type SortHeader } from './CustomersTable'

const PAGE_SIZE = 20

const SELECT = `${FIELD} pr-8`

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await checkVendorAccess()
  const session = await getSessionServer()
  if (!session) redirect('/auth/login')

  const vendor = await prisma.vendor.findUnique({
    where:  { userId: session.user.id },
    select: { id: true },
  })
  if (!vendor) redirect('/dashboard')

  const query     = parseCustomerQuery(await searchParams)
  const all       = await getVendorCustomers(vendor.id)
  const filtered  = sortCustomers(filterCustomers(all, query), query.sort, query.dir)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Une page hors bornes (filtre resserré, lien périmé) retombe sur la dernière.
  const page       = Math.min(query.page, totalPages)
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const repeat   = all.filter(c => c.returns >= 2).length
  const alert    = all.filter(c => (c.fraudScore ?? 0) > 70).length
  const openRets = all.reduce((sum, c) => sum + c.open, 0)

  const activeFilters = Boolean(query.q || query.risk || query.period || query.minReturns || query.status)

  // ── URL ──────────────────────────────────────────────────────────────────
  function buildUrl(overrides: Partial<Record<'q' | 'risque' | 'periode' | 'min' | 'statut' | 'tri' | 'ordre' | 'page', string | undefined>>): string {
    const base: Record<string, string | undefined> = {
      q:       query.q,
      risque:  query.risk,
      periode: query.period,
      min:     query.minReturns ? String(query.minReturns) : undefined,
      statut:  query.status,
      tri:     query.sort !== 'returns' ? query.sort : undefined,
      ordre:   query.dir !== DEFAULT_DIR[query.sort] ? query.dir : undefined,
    }
    const merged = { ...base, ...overrides }
    const qs = new URLSearchParams(
      Object.entries(merged).filter((e): e is [string, string] => !!e[1]),
    ).toString()
    return `/dashboard/customers${qs ? `?${qs}` : ''}`
  }

  function header(key: SortKey, label: string, align: 'left' | 'right' = 'left'): SortHeader {
    const isActive = query.sort === key
    const nextDir  = isActive ? (query.dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[key]
    return {
      key, label, align,
      active: isActive ? query.dir : null,
      // Changer de tri renvoie à la première page.
      href: buildUrl({
        tri:   key !== 'returns' ? key : undefined,
        ordre: nextDir !== DEFAULT_DIR[key] ? nextDir : undefined,
        page:  undefined,
      }),
    }
  }

  const headers: Record<string, SortHeader> = {
    name:       header('name', 'Client'),
    returns:    header('returns', 'Retours'),
    rejectRate: header('rejectRate', 'Taux de refus'),
    fraud:      header('fraud', 'Risque'),
    last:       header('last', 'Dernier retour'),
  }

  // ── Données sérialisables pour le tableau (composant client) ─────────────
  const rows: CustomerRow[] = pageItems.map(c => {
    const band = riskBand(c.fraudScore === null ? null : Math.round(c.fraudScore))
    return {
      key:        c.key,
      name:       c.name,
      email:      c.email,
      phone:      c.phone,
      returns:    c.returns,
      approved:   c.approved,
      rejected:   c.rejected,
      open:       c.open,
      rejectRate: c.rejectRate,
      fraudScore: c.fraudScore,
      riskLabel:  band?.label ?? null,
      riskText:   band?.text ?? null,
      topReason:  c.topReason,
      firstLabel: formatDate(c.firstReturnAt),
      lastLabel:  formatDate(c.lastReturnAt),
      claims: c.claims.map(claim => ({
        id:            claim.id,
        orderId:       claim.orderId,
        productName:   claim.productName,
        reason:        claim.reason,
        status:        claim.status,
        statusLabel:   CLAIM_STATUS_LABELS[claim.status as keyof typeof CLAIM_STATUS_LABELS] ?? claim.status,
        decisionLabel: claim.aiDecision
          ? VENDOR_DECISION_LABELS[claim.aiDecision as keyof typeof VENDOR_DECISION_LABELS] ?? claim.aiDecision
          : null,
        dateLabel:     formatDate(claim.createdAt),
      })),
    }
  })

  return (
    <div className="w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="Clients"
        subtitle="Tous les clients qui ont fait un retour chez vous, leur historique et leur niveau de risque."
      />

      {all.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={UsersRound}
            title="Aucun client pour le moment"
            hint="Vos clients apparaîtront ici dès leur première demande de retour."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* ── Chiffres clés ── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Clients" value={all.length} icon={Users} />
            <StatTile
              label="Clients récurrents"
              value={repeat}
              icon={Repeat}
              hint={all.length > 0 ? `${Math.round((repeat / all.length) * 100)} % ont fait 2 retours ou plus` : undefined}
            />
            <StatTile
              label="En alerte"
              value={alert}
              icon={AlertTriangle}
              tone={alert > 0 ? 'danger' : 'neutral'}
              hint={alert > 0 ? 'Score de fraude au-dessus de 70' : undefined}
            />
            <StatTile
              label="Retours en cours"
              value={openRets}
              icon={Clock}
              tone={openRets > 0 ? 'warning' : 'neutral'}
            />
          </div>

          {/* ── Filtres ── */}
          <form method="get" action="/dashboard/customers" className="rounded-card border border-line bg-surface p-4">
            {/* Le tri en cours survit à un changement de filtre. */}
            {query.sort !== 'returns' && <input type="hidden" name="tri" value={query.sort} />}
            {query.dir !== DEFAULT_DIR[query.sort] && <input type="hidden" name="ordre" value={query.dir} />}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
              <label className="relative block">
                <span className="sr-only">Rechercher un client</span>
                <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  name="q"
                  defaultValue={query.q ?? ''}
                  maxLength={200}
                  placeholder="Nom, e-mail ou téléphone"
                  className={`${FIELD} pl-9`}
                />
              </label>

              <FilterSelect label="Période" name="periode" value={query.period} options={[
                ['', 'Toute période'], ['30', '30 derniers jours'], ['90', '90 derniers jours'], ['365', '12 derniers mois'],
              ]} />
              <FilterSelect label="Risque" name="risque" value={query.risk} options={[
                ['', 'Tous les risques'], ['low', 'Faible'], ['watch', 'À surveiller'], ['alert', 'Alerte'],
              ]} />
              <FilterSelect label="Nombre de retours" name="min" value={query.minReturns ? String(query.minReturns) : undefined} options={[
                ['', 'Tous les clients'], ['2', '2 retours ou plus'], ['3', '3 retours ou plus'], ['5', '5 retours ou plus'],
              ]} />
              <FilterSelect label="Statut" name="statut" value={query.status} options={[
                ['', 'Tous les statuts'], ['open', 'Avec un retour en cours'], ['rejected', 'Avec un retour refusé'],
              ]} />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] tabular-nums text-body">
                <span className="font-semibold text-ink">{filtered.length}</span>{' '}
                client{filtered.length > 1 ? 's' : ''}
                {activeFilters && <> sur {all.length}</>}
              </p>
              <div className="flex items-center gap-2">
                {activeFilters && (
                  <a href={buildUrl({ q: undefined, risque: undefined, periode: undefined, min: undefined, statut: undefined, page: undefined })} className={BTN_GHOST}>
                    Réinitialiser
                  </a>
                )}
                <button type="submit" className={BTN_PRIMARY}>Filtrer</button>
              </div>
            </div>
          </form>

          {/* ── Tableau ── */}
          {filtered.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                icon={Search}
                title="Aucun client ne correspond à ces filtres"
                hint="Élargissez la période ou retirez un filtre."
              />
            </Card>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <CustomersTable customers={rows} headers={headers} />
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={filtered.length}
                label="clients"
                hrefFor={p => buildUrl({ page: p > 1 ? String(p) : undefined })}
              />
            </div>
          )}

          <p className="text-[12px] leading-relaxed text-body">
            Un client est reconnu par son e-mail, à défaut par son téléphone. Le risque affiché est le score de
            fraude calculé lors de son dernier retour. Cliquez sur un client pour voir ses retours.
          </p>
        </div>
      )}
    </div>
  )
}

function FilterSelect({
  label, name, value, options,
}: {
  label:   string
  name:    string
  value:   string | undefined
  options: [string, string][]
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value ?? ''} className={SELECT} aria-label={label}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  )
}

