'use client'

// app/dashboard/customers/CustomersTable.tsx — Flowmerce
//
// Un client par ligne ; chaque ligne se déplie sur ses retours, avec un lien
// vers le détail de chaque réclamation. Tri, filtres et pagination sont dans
// l'URL (page serveur) : ce composant ne gère que l'ouverture des lignes.

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { FOCUS, StatusBadge } from '@/components/dashboard/ui'

export interface CustomerRow {
  key:          string
  name:         string
  email:        string | null
  phone:        string | null
  returns:      number
  approved:     number
  rejected:     number
  open:         number
  rejectRate:   number | null
  fraudScore:   number | null
  riskLabel:    string | null
  riskText:     string | null
  topReason:    string | null
  firstLabel:   string
  lastLabel:    string
  claims: {
    id:            string
    orderId:       string
    productName:   string | null
    reason:        string | null
    status:        string
    statusLabel:   string
    decisionLabel: string | null
    dateLabel:     string
  }[]
}

export interface SortHeader {
  key:      string
  label:    string
  href:     string
  /** Sens actif sur cette colonne, ou null si elle ne trie pas la liste. */
  active:   'asc' | 'desc' | null
  align?:   'left' | 'right'
}

const pct = (share: number) => `${Math.round(share * 100)} %`

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function SortTh({ header }: { header: SortHeader }) {
  const right = header.align === 'right'
  return (
    <th
      scope="col"
      aria-sort={header.active === 'asc' ? 'ascending' : header.active === 'desc' ? 'descending' : undefined}
      className={`whitespace-nowrap px-4 py-3 ${right ? 'text-right' : 'text-left'}`}
    >
      <a
        href={header.href}
        className={`inline-flex items-center gap-1 rounded-control text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
          header.active ? 'text-ink' : 'text-faint hover:text-ink'
        } ${FOCUS}`}
      >
        {header.label}
        <span aria-hidden className={header.active ? 'text-brand-ink' : 'opacity-0'}>
          {header.active === 'asc' ? '↑' : '↓'}
        </span>
      </a>
    </th>
  )
}

export function CustomersTable({
  customers, headers,
}: {
  customers: CustomerRow[]
  /** Colonnes triables : returns, last, fraud, rejectRate, name. */
  headers:   Record<string, SortHeader>
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  function toggle(key: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <caption className="sr-only">Clients ayant fait au moins un retour</caption>
        <thead>
          <tr className="border-b border-line bg-page">
            <SortTh header={headers.name} />
            <SortTh header={headers.returns} />
            <Th>Issue</Th>
            <SortTh header={headers.rejectRate} />
            <SortTh header={headers.fraud} />
            <Th>Motif principal</Th>
            <SortTh header={headers.last} />
            <Th><span className="sr-only">Détail</span></Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {customers.map((c, i) => {
            const expanded = open.has(c.key)
            const detailId = `customer-detail-${i}`
            return (
              <Fragment key={c.key}>
                <tr
                  onClick={() => toggle(c.key)}
                  className={`cursor-pointer transition-colors hover:bg-page/60 ${expanded ? 'bg-page/60' : ''}`}
                >
                  <td className="max-w-[260px] px-4 py-3.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      onClick={e => { e.stopPropagation(); toggle(c.key) }}
                      className={`block max-w-full rounded-control text-left ${FOCUS}`}
                    >
                      <span className="block truncate text-[13px] font-semibold text-ink hover:text-brand-ink">{c.name}</span>
                      <span className="block truncate text-[12px] text-faint">{c.email ?? c.phone ?? '—'}</span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[13px] font-bold tabular-nums text-ink">
                    {c.returns}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[12px] tabular-nums">
                    <span className="text-green-700" title="Approuvés">{c.approved} ✓</span>
                    <span className="mx-1.5 text-line">|</span>
                    <span className="text-red-700" title="Refusés">{c.rejected} ✕</span>
                    {c.open > 0 && (
                      <>
                        <span className="mx-1.5 text-line">|</span>
                        <span className="text-amber-700" title="En attente ou en cours">{c.open} en cours</span>
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[13px] tabular-nums text-body">
                    {c.rejectRate !== null ? pct(c.rejectRate) : <span className="text-faint">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[12px] font-semibold tabular-nums">
                    {c.fraudScore !== null && c.riskText
                      ? <span className={c.riskText}>{Math.round(c.fraudScore)} · {c.riskLabel}</span>
                      : <span className="font-normal text-faint">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[13px] text-body">
                    {c.topReason ?? <span className="text-faint">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-[12px] tabular-nums text-body">
                    {c.lastLabel}
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
                      <CustomerDetail customer={c} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CustomerDetail({ customer }: { customer: CustomerRow }) {
  return (
    <div className="space-y-4">
      <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2 text-[12px]">
        {customer.email && <Info label="E-mail">{customer.email}</Info>}
        {customer.phone && <Info label="Téléphone">{customer.phone}</Info>}
        <Info label="Premier retour">{customer.firstLabel}</Info>
        <Info label="Dernier retour">{customer.lastLabel}</Info>
      </dl>

      <div className="overflow-hidden rounded-control border border-line bg-surface">
        <table className="w-full text-left">
          <caption className="sr-only">Retours de {customer.name}</caption>
          <thead>
            <tr className="border-b border-line">
              <Th>Date</Th>
              <Th>Commande</Th>
              <Th>Produit</Th>
              <Th>Motif</Th>
              <Th>Statut</Th>
              <Th><span className="sr-only">Lien</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {customer.claims.map(claim => (
              <tr key={claim.id}>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12px] tabular-nums text-body">{claim.dateLabel}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink">{claim.orderId}</td>
                <td className="max-w-[220px] truncate px-4 py-2.5 text-[13px] text-ink">{claim.productName ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-[12px] text-body">{claim.reason ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={claim.status} label={claim.statusLabel} />
                    {claim.decisionLabel && <span className="text-[12px] text-body">{claim.decisionLabel}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <a
                    href={`/dashboard/claims/${claim.id}`}
                    aria-label={`Détail de la réclamation ${claim.orderId}`}
                    className={`inline-flex items-center gap-0.5 rounded-control text-[12px] font-semibold text-brand-ink hover:underline ${FOCUS}`}
                  >
                    Détail
                    <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-faint">{label}</dt>
      <dd className="m-0 font-medium text-ink">{children}</dd>
    </div>
  )
}
