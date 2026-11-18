// app/dashboard/claims/[claimId]/page.tsx — Flowmerce
//
// Détail d'une réclamation.
//
//   1. En-tête : commande, statut, dates, action disponible (traiter tant que
//      la réclamation est ouverte, corriger une fois tranchée).
//   2. Bandeau de décision : décision actuelle, demande du client,
//      recommandation IA, risque de fraude, montant — ce qu'il faut voir pour
//      trancher, sans défiler.
//   3. Deux colonnes : à gauche le récit (description, analyse IA,
//      historique), à droite les fiches (client, commande, fraude).

import { getSessionServer }   from '@/lib/getSession'
import { prisma }             from '@/lib/prisma'
import { redirect, notFound } from 'next/navigation'
import Link                   from 'next/link'
import { checkVendorAccess }  from '@/lib/vendorGuard'
import { ClaimActions }       from '@/components/claims/ClaimActions'
import { AmendDecision }      from '@/components/claims/AmendDecision'
import { Card, CardTitle, FOCUS, Notice, StatusBadge, riskBand } from '@/components/dashboard/ui'
import { formatClaimType, formatDate } from '@/lib/utils'
import {
  CLAIM_STATUS_LABELS, VENDOR_DECISION_LABELS, formatCustomerGender,
  type ClaimStatusValue, type VendorDecision,
} from '@/lib/constants'
import { grantableResolutions } from '@/lib/claim-transitions'
import {
  AlertTriangle, ArrowLeft, Brain, FileText, History, Package, ShieldAlert, Sparkles, User,
} from 'lucide-react'

// Mêmes pastilles que le tableau des réclamations. 'Refund' n'apparaît que si
// le vendeur a tranché pour un remboursement — le modèle ne le recommande jamais.
const RESOLUTION_CONFIG: Record<string, { label: string; cls: string; dot: string }> = {
  Exchange: { label: 'Échange',       cls: 'text-blue-700 bg-blue-50 ring-1 ring-blue-200',          dot: 'bg-blue-500'    },
  Repair:   { label: 'Réparation',    cls: 'text-amber-700 bg-amber-50 ring-1 ring-amber-200',       dot: 'bg-amber-400'   },
  Refund:   { label: 'Remboursement', cls: 'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200', dot: 'bg-emerald-500' },
  Reject:   { label: 'Refus',         cls: 'text-red-700 bg-red-50 ring-1 ring-red-200',             dot: 'bg-red-500'     },
}

const RISK_BAR: Record<string, string> = {
  'text-risk-high': 'bg-risk-high',
  'text-risk-mid':  'bg-risk-mid',
  'text-risk-low':  'bg-risk-low',
}

const formatAmount = (n: number) =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DA`

const formatDateTime = (d: Date) =>
  d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ claimId: string }>
}) {
  await checkVendorAccess()
  const session = await getSessionServer()
  if (!session) redirect('/auth/login')

  const { claimId } = await params
  const user    = session.user
  const isAdmin = user?.role === 'ADMIN'

  let vendorId: string | undefined
  if (!isAdmin) {
    const vendor = await prisma.vendor.findUnique({ where: { userId: user.id } })
    if (!vendor) redirect('/auth/register')
    vendorId = vendor.id
  }

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      vendor:         { select: { companyName: true } },
      decisionEvents: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!claim) notFound()
  if (!isAdmin && claim.vendorId !== vendorId) notFound()
  // Hors politique : refusée d'office, invisible du vendeur jusque dans l'URL
  // directe — sinon elle resterait atteignable en devinant l'identifiant.
  if (!isAdmin && claim.policyRejected) notFound()

  const prediction   = claim.prediction as Record<string, unknown> | null
  const overrideData = prediction?.override as Record<string, unknown> | undefined
  const isOverridden = !!overrideData
  const displayDecision = typeof overrideData?.resolution === 'string'
    ? overrideData.resolution
    : claim.aiDecision

  const productPrice = typeof prediction?.productPrice    === 'number' ? prediction.productPrice    : null
  const productQty   = typeof prediction?.productQuantity === 'number' ? prediction.productQuantity : null
  const orderTotal   = typeof prediction?.orderTotal      === 'number' ? prediction.orderTotal      : null
  const amount       = productPrice != null ? productPrice * (productQty && productQty > 1 ? productQty : 1) : orderTotal

  // Données client transmises par la boutique / saisies dans le formulaire.
  const unknown = (v: unknown) =>
    typeof v === 'string' && v.trim() !== '' && v !== 'Unknown' ? v : null
  const customerWilaya = unknown(prediction?.customerWilaya)
  const paymentMethod  = unknown(prediction?.paymentMethod)
  const customerGender = formatCustomerGender(prediction?.customerGender)
  const customerAge    = typeof prediction?.customerAge === 'number' && prediction.customerAge > 0
    ? prediction.customerAge
    : null

  // Drapeau informatif calculé côté web app (jamais par le ML)
  const refundEligible = prediction?.refundEligible === true
  const confidence     = claim.aiScore != null ? Math.round(claim.aiScore * 100) : null
  const fraudScore     = claim.fraudScore != null ? Math.round(claim.fraudScore) : null
  const risk           = riskBand(fraudScore)

  // Arbitrage recommandation / résolutions autorisées, calculé côté serveur
  // (claim-decision). Le modèle a pu noter au plus haut une résolution que ce
  // vendeur n'offre pas : on affiche celle qu'il offre, et on dit pourquoi.
  const recommendation      = prediction?.recommendation as Record<string, unknown> | undefined
  const noAllowedResolution = recommendation?.reason === 'NO_ALLOWED_RESOLUTION'
  const mlTopLabel          = typeof recommendation?.mlTop === 'string' ? recommendation.mlTop : null
  const wasFiltered         = recommendation?.filtered === true && !noAllowedResolution && !!mlTopLabel
  // Recommandation d'origine du modèle : le bloc `recommendation` quand il
  // existe ; sinon la trace gardée par une révision, ou la décision elle-même
  // quand c'est le modèle qui l'a posée (réclamations plus anciennes).
  const mlRecommended =
    typeof recommendation?.resolution === 'string' ? recommendation.resolution
    : typeof overrideData?.mlDecision === 'string' ? overrideData.mlDecision
    : claim.resolutionSource === 'MODEL'           ? claim.aiDecision
    : null

  const isDecided = claim.status === 'APPROVED' || claim.status === 'REJECTED'

  // Résolutions qu'une correction peut accorder : même règle que le serveur
  // (lib/claim-transitions.ts), plus le refus, toujours possible.
  const returnPolicy = isDecided
    ? await prisma.returnPolicy.findUnique({ where: { vendorId: claim.vendorId }, select: { acceptedTypes: true } })
    : null
  const amendable: VendorDecision[] = [
    ...new Set<VendorDecision>([...grantableResolutions(returnPolicy?.acceptedTypes, claim.type), 'Reject']),
  ]
  const decision  = displayDecision ? RESOLUTION_CONFIG[displayDecision] : null
  const lastEvent = claim.decisionEvents.at(-1)

  return (
    <div className="w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">

      {/* ── Fil d'Ariane ── */}
      <Link
        href="/dashboard/claims"
        className={`mb-5 inline-flex items-center gap-1.5 rounded-control text-[13px] font-medium text-body transition-colors hover:text-ink ${FOCUS}`}
      >
        <ArrowLeft size={15} aria-hidden />
        Réclamations
      </Link>

      {/* ── En-tête ── */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-[-0.015em] text-ink">
              Réclamation <span className="font-mono">#{claim.orderId}</span>
            </h1>
            <StatusBadge status={claim.status} label={statusLabel(claim.status)} />
            {isAdmin && (
              <span className="rounded-full bg-page px-2.5 py-1 text-[11px] font-semibold text-body">
                {claim.vendor.companyName}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-body">
            Reçue le {formatDate(claim.createdAt)}
            {' · '}
            {claim.source === 'HOSTED_PAGE' ? 'page de retour' : 'API'}
            {claim.processedAt && <> · Traitée le {formatDate(claim.processedAt)}</>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isDecided ? (
            !claim.policyRejected && (
              <AmendDecision
                claimId={claim.id}
                currentDecision={claim.aiDecision}
                scope={isAdmin ? 'admin' : 'vendor'}
                allowed={amendable}
              />
            )
          ) : (
            <ClaimActions
              claimId={claim.id}
              currentStatus={claim.status}
              aiDecision={displayDecision}
              aiScore={claim.aiScore}
              claimType={claim.type}
            />
          )}
        </div>
      </header>

      {/* ── Bandeau de décision ── */}
      <section
        aria-label="Synthèse de la décision"
        className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-5"
      >
        <Summary label={isDecided ? 'Décision' : 'Décision proposée'} className="col-span-2 lg:col-span-1">
          {decision ? (
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold ${decision.cls}`}>
              <span aria-hidden className={`size-1.5 rounded-full ${decision.dot}`} />
              {decision.label}
            </span>
          ) : (
            <span className="text-[13px] text-faint">À trancher</span>
          )}
          {isDecided && lastEvent && (
            <p className="mt-1.5 text-[11px] text-faint">
              {actorShort(lastEvent.actorType, lastEvent.actor)}, {formatDateTime(lastEvent.createdAt)}
            </p>
          )}
        </Summary>

        <Summary label="Demande du client">
          <span className="text-[14px] font-semibold text-ink">{formatClaimType(claim.type)}</span>
        </Summary>

        <Summary label="Recommandation IA">
          {noAllowedResolution ? (
            <span className="text-[13px] text-faint">Aucune autorisée</span>
          ) : mlRecommended || confidence !== null ? (
            <>
              <span className="text-[14px] font-semibold text-ink">
                {mlRecommended ? (RESOLUTION_CONFIG[mlRecommended]?.label ?? mlRecommended) : '—'}
              </span>
              {confidence !== null && (
                <span className="ml-1.5 text-[12px] tabular-nums text-faint">{confidence} %</span>
              )}
            </>
          ) : (
            <span className="text-[13px] text-faint">—</span>
          )}
        </Summary>

        <Summary label="Risque de fraude">
          {risk ? (
            <span className={`text-[14px] font-semibold tabular-nums ${risk.text}`}>
              {fraudScore} <span className="font-medium">· {risk.label}</span>
            </span>
          ) : (
            <span className="text-[13px] text-faint">—</span>
          )}
        </Summary>

        <Summary label="Montant">
          <span className="text-[14px] font-semibold tabular-nums text-ink">
            {amount != null ? formatAmount(amount) : '—'}
          </span>
        </Summary>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* ═════ Colonne principale ═════ */}
        <div className="min-w-0 space-y-6 lg:col-span-2">

          {/* ── Description ── */}
          <Card>
            <CardTitle><TitleIcon icon={FileText} />Description du client</CardTitle>
            <blockquote className="m-0 border-l-2 border-brand/30 pl-4 text-[14px] leading-relaxed text-ink whitespace-pre-wrap">
              {claim.description}
            </blockquote>
          </Card>

          {/* ── Analyse IA ── */}
          {(claim.aiDecision || claim.aiScore != null || noAllowedResolution) && (
            <Card>
              <CardTitle><TitleIcon icon={Brain} />Analyse IA</CardTitle>
              <div className="space-y-5">
                {noAllowedResolution ? (
                  <p className="text-[13px] leading-relaxed text-body">
                    Le modèle n&apos;a proposé aucune résolution que votre politique de retour autorise
                    {mlTopLabel
                      ? ` (il plaçait en tête « ${RESOLUTION_CONFIG[mlTopLabel]?.label ?? mlTopLabel} »)`
                      : ''}. À vous de trancher.
                  </p>
                ) : decision && (
                  <div>
                    <p className="mb-1.5 text-[12px] text-body">
                      {isOverridden ? 'Décision retenue' : 'Décision recommandée'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold ${decision.cls}`}>
                        <span aria-hidden className={`size-1.5 rounded-full ${decision.dot}`} />
                        {decision.label}
                      </span>
                      {isOverridden && (
                        <span className="inline-flex items-center gap-1 text-[12px] text-amber-700">
                          <Sparkles size={12} aria-hidden />
                          Modifiée manuellement
                        </span>
                      )}
                    </div>
                    {wasFiltered && !isOverridden && (
                      <p className="mt-2 text-[12px] text-body">
                        Le modèle plaçait en tête « {RESOLUTION_CONFIG[mlTopLabel!]?.label ?? mlTopLabel} »,
                        que votre politique de retour ne propose pas.
                      </p>
                    )}
                  </div>
                )}

                {confidence !== null && (
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <p className="text-[12px] text-body">Confiance du modèle</p>
                      <span className="text-[13px] font-semibold tabular-nums text-ink">{confidence} %</span>
                    </div>
                    <div
                      role="img"
                      aria-label={`Confiance du modèle : ${confidence} %`}
                      className="h-1.5 overflow-hidden rounded-full bg-page"
                    >
                      <div className="h-full rounded-full bg-brand" style={{ width: `${confidence}%` }} />
                    </div>
                  </div>
                )}

                {refundEligible && (
                  <p className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                    <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
                    Remboursement envisageable — décision du vendeur
                  </p>
                )}

                {isOverridden && typeof overrideData?.note === 'string' && overrideData.note.trim() !== '' && (
                  <div>
                    <p className="mb-1 text-[12px] text-body">Note de révision</p>
                    <p className="text-[13px] italic text-ink">{overrideData.note}</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Historique (en ajout seul, audit RS-01) ── */}
          <Card>
            <CardTitle><TitleIcon icon={History} />Historique</CardTitle>
            <ol className="m-0 list-none p-0">
              <TimelineItem
                title="Réclamation reçue"
                meta={`${formatDateTime(claim.createdAt)} · ${claim.source === 'HOSTED_PAGE' ? 'page de retour' : 'API'}`}
                last={claim.decisionEvents.length === 0}
              />
              {claim.decisionEvents.map((event, i) => (
                <TimelineItem
                  key={event.id}
                  title={
                    <>
                      {event.previousStatus && <span className="font-normal text-body">{statusLabel(event.previousStatus)} → </span>}
                      {statusLabel(event.newStatus)}
                      {event.newDecision && <span className="font-normal text-body"> · {decisionLabel(event.newDecision)}</span>}
                    </>
                  }
                  meta={`${formatDateTime(event.createdAt)} · ${actorLabel(event.actorType, event.actor, event.origin)}`}
                  note={event.reason}
                  accent={event.origin === 'admin_amendment' || event.origin === 'vendor_amendment'}
                  last={i === claim.decisionEvents.length - 1}
                />
              ))}
            </ol>
          </Card>
        </div>

        {/* ═════ Colonne latérale ═════ */}
        <div className="min-w-0 space-y-6">

          {/* ── Client ── */}
          <Card>
            <CardTitle><TitleIcon icon={User} />Client</CardTitle>
            <dl className="m-0 divide-y divide-line">
              <Field label="Nom">{claim.customerName}</Field>
              <Field label="E-mail"><span className="break-all">{claim.customerEmail}</span></Field>
              {claim.customerPhone && <Field label="Téléphone">{claim.customerPhone}</Field>}
              {customerWilaya && <Field label="Wilaya">{customerWilaya}</Field>}
              {customerAge !== null && <Field label="Âge">{customerAge} ans</Field>}
              {customerGender && <Field label="Genre">{customerGender}</Field>}
              {claim.customerId && <Field label="ID client" mono>{claim.customerId}</Field>}
            </dl>
          </Card>

          {/* ── Commande ── */}
          <Card>
            <CardTitle><TitleIcon icon={Package} />Commande</CardTitle>
            <dl className="m-0 divide-y divide-line">
              <Field label="Produit">{claim.productName ?? '—'}</Field>
              <Field label="Commande" mono>{claim.orderId}</Field>
              {claim.orderDate && <Field label="Date">{formatDate(claim.orderDate)}</Field>}
              {productPrice != null && (
                <Field label="Prix unitaire">
                  {formatAmount(productPrice)}
                  {productQty && productQty > 1 && <span className="text-body"> × {productQty}</span>}
                </Field>
              )}
              {amount != null && <Field label="Montant">{formatAmount(amount)}</Field>}
              {paymentMethod && <Field label="Paiement">{paymentMethod}</Field>}
            </dl>
          </Card>

          {/* ── Fraude ── */}
          {fraudScore !== null && risk && (
            <Card>
              <CardTitle><TitleIcon icon={ShieldAlert} />Analyse de fraude</CardTitle>
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <p className="text-[12px] text-body">Score</p>
                    <span className={`text-[13px] font-semibold tabular-nums ${risk.text}`}>
                      {fraudScore}/100 · {risk.label}
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={`Score de fraude : ${fraudScore} sur 100, ${risk.label}`}
                    className="h-1.5 overflow-hidden rounded-full bg-page"
                  >
                    <div
                      className={`h-full rounded-full ${RISK_BAR[risk.text] ?? 'bg-brand'}`}
                      style={{ width: `${Math.min(fraudScore, 100)}%` }}
                    />
                  </div>
                </div>
                {claim.ipAddress && (
                  <dl className="m-0">
                    <Field label="Adresse IP" mono>{claim.ipAddress}</Field>
                  </dl>
                )}
              </div>
              {fraudScore > 70 && (
                <div className="mt-4">
                  <Notice tone="danger" icon={AlertTriangle} title="Vérification manuelle recommandée">
                    Score élevé : vérifiez l&apos;historique de ce client avant de trancher.
                  </Notice>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Pièces de la page ──────────────────────────────────────────────────────

function Summary({
  label, children, className = '',
}: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 bg-surface px-5 py-4 ${className}`}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</p>
      {children}
    </div>
  )
}

function TitleIcon({ icon: Icon }: { icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }> }) {
  return <Icon size={14} className="mr-2 inline-block -translate-y-px text-faint" aria-hidden />
}

function Field({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-[12px] text-body">{label}</dt>
      <dd className={`m-0 min-w-0 text-right text-[13px] font-medium text-ink ${mono ? 'font-mono text-[12px]' : ''}`}>
        {children}
      </dd>
    </div>
  )
}

function TimelineItem({
  title, meta, note, accent = false, last = false,
}: {
  title:   React.ReactNode
  meta:    string
  note?:   string | null
  accent?: boolean
  last?:   boolean
}) {
  return (
    <li className="relative pl-6">
      {!last && <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-line" />}
      <span
        aria-hidden
        className={`absolute left-0 top-1.5 size-[11px] rounded-full border-2 ${
          accent ? 'border-amber-500 bg-amber-50' : 'border-brand bg-surface'
        }`}
      />
      <div className={last ? '' : 'pb-5'}>
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[12px] text-faint">{meta}</p>
        {note && (
          <p className="mt-2 rounded-control bg-page px-3 py-2 text-[12px] italic leading-relaxed text-body">
            {note}
          </p>
        )}
      </div>
    </li>
  )
}

function statusLabel(status: string): string {
  return CLAIM_STATUS_LABELS[status as ClaimStatusValue] ?? status
}

function decisionLabel(decision: string): string {
  return VENDOR_DECISION_LABELS[decision as VendorDecision] ?? decision
}

const ORIGIN_LABELS: Record<string, string> = {
  auto_on_create:   'décision automatique à la réception',
  validation_mode:  'validation automatique activée',
  policy:           'hors politique de retour',
  dashboard:        'tableau de bord',
  admin_amendment:  'correction de décision',
  vendor_amendment: 'correction de décision',
}

function actorLabel(actorType: string, actor: string, origin: string): string {
  const where = ORIGIN_LABELS[origin] ?? origin
  if (actorType === 'SYSTEM') return `Flowmerce, ${where}`
  if (actorType === 'ADMIN')  return `Administrateur (${actor}), ${where}`
  return `${actor}, ${where}`
}

function actorShort(actorType: string, actor: string): string {
  if (actorType === 'SYSTEM') return 'Flowmerce'
  if (actorType === 'ADMIN')  return 'Administrateur'
  return actor
}
