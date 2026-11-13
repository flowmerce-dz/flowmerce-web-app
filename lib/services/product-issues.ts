// lib/services/product-issues.ts — Flowmerce
//
// Problèmes collectifs sur un produit, à partir des seuls retours enregistrés.
//
// Flowmerce gère les retours, pas les commandes : il ne connaît pas le nombre
// d'exemplaires vendus ou livrés. Aucun taux de retour n'est donc calculé ici.
// Toutes les proportions sont exprimées PARMI LES RETOURS du produit.
//
// Deux usages, une seule règle de détection :
//   • l'analyse des retours produits du vendeur (aggregateProductReturns) ;
//   • l'ajustement du score de fraude (explainCustomerPastReturns) : un retour
//     expliqué par un problème collectif ne doit pas pénaliser le client.
//
// Le « client » est compté par e-mail (sinon téléphone) : plusieurs retours d'un
// même client ne font jamais plusieurs clients signalant le même problème.

import { prisma } from '@/lib/prisma'
import {
  RETURN_REASONS,
  findReturnReasonDetail,
  isReturnReason,
  type ReturnReason,
} from '@/lib/constants'

// ─────────────────────────────────────────────────────────────
// Clés de regroupement
// ─────────────────────────────────────────────────────────────

/**
 * Clé produit des analyses : l'identifiant transmis par la boutique quand il
 * est connu, sinon le nom normalisé. Préfixée pour qu'un identifiant ne puisse
 * jamais se confondre avec un nom. La migration
 * 20261113120000_claim_return_reason_detail applique la même normalisation.
 */
export function productKey(
  productId?: string | null,
  productName?: string | null,
): string | null {
  const id = productId?.trim()
  if (id) return `id:${id}`
  const name = productName?.trim().replace(/\s+/g, ' ').toLowerCase()
  return name ? `name:${name}` : null
}

/**
 * Identifiants d'un client final : e-mail normalisé et téléphone. Les deux
 * comptent : le dossier anti-fraude rapproche un client par l'un OU l'autre,
 * et la détection doit l'identifier au moins aussi largement — sinon un même
 * client, avec deux e-mails et un téléphone, passerait pour deux clients.
 */
export function customerIdentities(email?: string | null, phone?: string | null): string[] {
  const ids: string[] = []
  const e = email?.trim().toLowerCase()
  if (e) ids.push(`email:${e}`)
  const p = phone?.trim()
  if (p) ids.push(`phone:${p}`)
  return ids
}

/**
 * Regroupe en un même client les retours qui partagent un e-mail ou un
 * téléphone, de proche en proche (union-find) : A et B partagent un téléphone,
 * B et C un e-mail → A, B et C sont un seul client. Un retour sans identité
 * reste un client à part, jamais fusionné avec un autre inconnu.
 */
export function resolveCustomers(returns: readonly Pick<ProductReturn, 'claimId' | 'identities'>[]) {
  const parent = new Map<string, string>()
  const add  = (x: string) => { if (!parent.has(x)) parent.set(x, x) }
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    for (let cur = x; cur !== root;) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    add(a); add(b)
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }

  for (const r of returns) {
    const node = `claim:${r.claimId}`
    add(node)
    for (const id of r.identities) union(node, id)
  }

  return {
    /** Client d'un retour. */
    ofClaim:    (claimId: string) => find(`claim:${claimId}`),
    /** Client portant cet identifiant, s'il apparaît parmi les retours. */
    ofIdentity: (id: string) => (parent.has(id) ? find(id) : null),
  }
}

// ─────────────────────────────────────────────────────────────
// Règle de détection
// ─────────────────────────────────────────────────────────────

// Un problème collectif est retenu quand une même sous-raison `productRelated`
// est signalée par au moins `minDistinctCustomers` clients DIFFÉRENTS et
// représente au moins `minShare` des retours du produit. Les deux conditions
// sont nécessaires : le nombre de clients écarte le hasard sur un petit volume,
// la part écarte le bruit de fond sur un produit très retourné.
export const PRODUCT_ISSUE_RULE = {
  minDistinctCustomers: 3,
  minShare:             0.3,
  high: { minDistinctCustomers: 5, minShare: 0.5 },
} as const

export type IssueConfidence = 'high' | 'medium'

// Part de la contribution « nombre de retours » retirée au score de fraude
// pour chaque retour expliqué : neutralisée en confiance haute, réduite de
// moitié en confiance moyenne.
export const CONFIDENCE_DISCOUNT: Record<IssueConfidence, number> = {
  high:   1,
  medium: 0.5,
}

export interface ProductReturn {
  claimId:      string
  productKey:   string | null
  reason:       string | null
  reasonDetail: string | null
  /** customerIdentities(email, phone) du client. */
  identities:   string[]
  /** Statut de la réclamation — lu seulement si `evidenceStatuses` est fourni. */
  status?:      string
  createdAt?:   Date
}

export interface ProductIssue {
  productKey:        string
  reason:            ReturnReason
  reasonDetail:      string
  label:             string
  returns:           number
  distinctCustomers: number
  productReturns:    number
  share:             number
  confidence:        IssueConfidence
  firstReportedAt:   Date | null
  lastReportedAt:    Date | null
}

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (k === null) continue
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

function dateRange(items: readonly ProductReturn[]): { first: Date | null; last: Date | null } {
  let first: Date | null = null
  let last:  Date | null = null
  for (const { createdAt } of items) {
    if (!createdAt) continue
    if (!first || createdAt < first) first = createdAt
    if (!last  || createdAt > last)  last  = createdAt
  }
  return { first, last }
}

export interface DetectOptions {
  /**
   * Identifiants d'un client à écarter de la preuve, avec tout ce qui lui est
   * rattaché par e-mail ou téléphone. Sert au score de fraude : un client ne
   * peut jamais contribuer au problème collectif qui excuserait ses propres
   * retours — ni sous son nom, ni sous une identité liée.
   */
  excludeIdentities?: readonly string[]
  /**
   * Statuts admis comme preuve. Appliqué APRÈS le rapprochement des identités :
   * une réclamation non retenue comme preuve sert encore à relier deux
   * identités d'une même personne.
   */
  evidenceStatuses?: readonly string[]
}

/**
 * Problèmes collectifs parmi des retours. Les retours doivent appartenir à UN
 * SEUL vendeur : une clé produit n'a de sens que dans sa boutique.
 */
export function detectProductIssues(
  returns: readonly ProductReturn[],
  opts:    DetectOptions = {},
): ProductIssue[] {
  const customers = resolveCustomers(returns)
  const excluded  = new Set(
    (opts.excludeIdentities ?? [])
      .map(customers.ofIdentity)
      .filter((root): root is string => root !== null),
  )
  const statuses = opts.evidenceStatuses
  const evidence = returns.filter(r =>
    !excluded.has(customers.ofClaim(r.claimId))
    && (!statuses || (r.status !== undefined && statuses.includes(r.status))))

  const issues: ProductIssue[] = []

  for (const [key, productReturns] of groupBy(evidence, r => r.productKey)) {
    const total = productReturns.length

    for (const [code, withDetail] of groupBy(productReturns, r => r.reasonDetail)) {
      const known = findReturnReasonDetail(code)
      if (!known?.detail.productRelated) continue

      const distinctCustomers = new Set(withDetail.map(r => customers.ofClaim(r.claimId))).size
      const share = withDetail.length / total
      if (distinctCustomers < PRODUCT_ISSUE_RULE.minDistinctCustomers) continue
      if (share < PRODUCT_ISSUE_RULE.minShare) continue

      const high = PRODUCT_ISSUE_RULE.high
      const { first, last } = dateRange(withDetail)
      issues.push({
        productKey:        key,
        reason:            known.reason,
        reasonDetail:      code,
        label:             known.detail.label,
        returns:           withDetail.length,
        distinctCustomers,
        productReturns:    total,
        share,
        confidence:
          distinctCustomers >= high.minDistinctCustomers && share >= high.minShare
            ? 'high'
            : 'medium',
        firstReportedAt: first,
        lastReportedAt:  last,
      })
    }
  }

  return issues.sort((a, b) => b.distinctCustomers - a.distinctCustomers || b.share - a.share)
}

// ─────────────────────────────────────────────────────────────
// Recommandations
// ─────────────────────────────────────────────────────────────

const ADVICE_BY_REASON: Record<ReturnReason, string> = {
  'Produit défectueux':
    'Nous recommandons de contrôler ce lot avec votre fournisseur et de tester le produit avant expédition.',
  'Produit contrefait':
    'Nous recommandons de vérifier l’authenticité de votre approvisionnement et la traçabilité du fournisseur.',
  'Produit endommagé livraison':
    'Nous recommandons de renforcer l’emballage et de vérifier les conditions de transport avec votre transporteur.',
  "Changement d'avis":
    'Nous recommandons de préciser la fiche produit pour que le client sache exactement ce qu’il achète.',
  'Panne après utilisation':
    'Nous recommandons de vérifier la fiabilité du produit avec votre fournisseur et de revoir sa fiche technique.',
  'Mauvaise taille':
    'Nous recommandons de vérifier le guide des tailles de ce produit.',
  'Allergie/Réaction':
    'Nous recommandons de vérifier la composition du produit et d’indiquer clairement les allergènes sur sa fiche.',
  'Ne correspond pas':
    'Nous recommandons de mettre à jour les photos et la description pour qu’elles correspondent au produit envoyé.',
  'Erreur de commande vendeur':
    'Nous recommandons de contrôler la préparation des commandes (référence, variante, quantité) avant expédition.',
  'Pièces manquantes':
    'Nous recommandons de vérifier le contenu des colis au moment du conditionnement.',
}

const ADVICE_BY_DETAIL: Record<string, string> = {
  TOO_SMALL:
    'Nous recommandons de vérifier le guide des tailles et d’envisager de conseiller une taille au-dessus.',
  TOO_LARGE:
    'Nous recommandons de vérifier le guide des tailles et d’envisager de conseiller une taille en dessous.',
  SIZE_GUIDE_MISMATCH:
    'Nous recommandons de mettre à jour le guide des tailles de ce produit.',
}

const pct = (share: number) => `${Math.round(share * 100)} %`

export function recommendationFor(issue: ProductIssue): string {
  const who = issue.distinctCustomers > 1
    ? `${issue.distinctCustomers} clients différents signalent`
    : '1 client signale'
  const advice = ADVICE_BY_DETAIL[issue.reasonDetail] ?? ADVICE_BY_REASON[issue.reason]
  return `${who} « ${issue.label} » (${pct(issue.share)} des retours de ce produit). ${advice}`
}

// ─────────────────────────────────────────────────────────────
// Analyse des retours produits (vue vendeur)
// ─────────────────────────────────────────────────────────────

export interface AnalyticsClaim {
  id:                 string
  productKey:         string | null
  productName:        string | null
  returnReason:       string | null
  returnReasonDetail: string | null
  customerEmail:      string | null
  customerPhone:      string | null
  createdAt:          Date
}

export interface DetailBreakdown {
  code:              string
  label:             string
  count:             number
  share:             number   // parmi les retours du produit
  distinctCustomers: number
}

export interface ReasonBreakdown {
  reason:            ReturnReason
  count:             number
  share:             number   // parmi les retours du produit
  distinctCustomers: number
  details:           DetailBreakdown[]
  /** Retours de ce motif sans sous-raison (antérieurs à leur introduction). */
  withoutDetail:     number
}

export interface MonthlyCount { month: string; count: number }

export interface ProductReturnStats {
  productKey:        string
  productName:       string
  returns:           number
  distinctCustomers: number
  reasons:           ReasonBreakdown[]
  /** Retours dont le motif n'est pas renseigné. */
  unknownReason:     number
  topReason:         ReasonBreakdown | null
  topDetail:         (DetailBreakdown & { reason: ReturnReason }) | null
  monthly:           MonthlyCount[]
  issues:            ProductIssue[]
  recommendations:   string[]
}

export interface ProductReturnAnalytics {
  totalReturns:      number
  distinctCustomers: number
  products:          ProductReturnStats[]
  months:            string[]
}

const MONTHS_SHOWN = 6

/** Les `count` derniers mois (UTC), du plus ancien au plus récent : "AAAA-MM". */
export function lastMonths(now: Date, count = MONTHS_SHOWN): string[] {
  const months: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push(d.toISOString().slice(0, 7))
  }
  return months
}

function toReturn(c: AnalyticsClaim): ProductReturn {
  return {
    claimId:      c.id,
    productKey:   c.productKey,
    reason:       c.returnReason,
    reasonDetail: c.returnReasonDetail,
    identities:   customerIdentities(c.customerEmail, c.customerPhone),
    createdAt:    c.createdAt,
  }
}

// Nom affiché d'un produit : le plus fréquent parmi ses retours (une même clé
// produit peut avoir été saisie avec des variantes de casse ou d'espaces).
function displayName(claims: readonly AnalyticsClaim[]): string {
  const counts = new Map<string, number>()
  for (const c of claims) {
    const name = c.productName?.trim()
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best = 'Produit sans nom'
  let max = 0
  for (const [name, n] of counts) {
    if (n > max) { best = name; max = n }
  }
  return best
}

/**
 * Agrégation pure des retours d'UN vendeur. L'appelant garantit l'isolation :
 * `claims` ne doit contenir que des réclamations de ce vendeur.
 */
export function aggregateProductReturns(
  claims: readonly AnalyticsClaim[],
  now:    Date = new Date(),
): ProductReturnAnalytics {
  const months = lastMonths(now)
  const returns = claims.map(toReturn)
  const issuesByProduct = groupBy(detectProductIssues(returns), i => i.productKey)
  // Un client = toutes ses identités liées : « clients concernés » ne compte
  // jamais deux fois la même personne sous deux e-mails.
  const customers  = resolveCustomers(returns)
  const distinctOf = (rs: readonly ProductReturn[]) => new Set(rs.map(r => customers.ofClaim(r.claimId))).size

  const products: ProductReturnStats[] = []

  for (const [key, productClaims] of groupBy(claims, c => c.productKey)) {
    const total = productClaims.length
    const productReturns = productClaims.map(toReturn)

    const reasons: ReasonBreakdown[] = []
    for (const [reason, withReason] of groupBy(productReturns, r => isReturnReason(r.reason) ? r.reason : null)) {
      const details: DetailBreakdown[] = []
      let withoutDetail = 0

      for (const r of withReason) if (!r.reasonDetail) withoutDetail++
      for (const [code, withDetail] of groupBy(withReason, r => r.reasonDetail)) {
        details.push({
          code,
          label:             findReturnReasonDetail(code)?.detail.label ?? code,
          count:             withDetail.length,
          share:             withDetail.length / total,
          distinctCustomers: distinctOf(withDetail),
        })
      }
      details.sort((a, b) => b.count - a.count)

      reasons.push({
        reason:            reason as ReturnReason,
        count:             withReason.length,
        share:             withReason.length / total,
        distinctCustomers: distinctOf(withReason),
        details,
        withoutDetail,
      })
    }
    // Ordre stable à égalité : celui de RETURN_REASONS.
    reasons.sort((a, b) =>
      b.count - a.count || RETURN_REASONS.indexOf(a.reason) - RETURN_REASONS.indexOf(b.reason))

    const unknownReason = total - reasons.reduce((s, r) => s + r.count, 0)

    let topDetail: ProductReturnStats['topDetail'] = null
    for (const r of reasons) {
      for (const d of r.details) {
        if (!topDetail || d.count > topDetail.count) topDetail = { ...d, reason: r.reason }
      }
    }

    const monthly = months.map(month => ({
      month,
      count: productClaims.filter(c => c.createdAt.toISOString().slice(0, 7) === month).length,
    }))

    const issues = issuesByProduct.get(key) ?? []

    products.push({
      productKey:        key,
      productName:       displayName(productClaims),
      returns:           total,
      distinctCustomers: distinctOf(productReturns),
      reasons,
      unknownReason,
      topReason:         reasons[0] ?? null,
      topDetail,
      monthly,
      issues,
      recommendations:   issues.map(recommendationFor),
    })
  }

  products.sort((a, b) => b.returns - a.returns || a.productName.localeCompare(b.productName))

  return {
    totalReturns:      claims.length,
    distinctCustomers: distinctOf(returns),
    products,
    months,
  }
}

const ANALYTICS_SELECT = {
  id:                 true,
  productKey:         true,
  productName:        true,
  returnReason:       true,
  returnReasonDetail: true,
  customerEmail:      true,
  customerPhone:      true,
  createdAt:          true,
} as const

/**
 * Analyse des retours d'un vendeur. Le filtre `vendorId` est appliqué ici, en
 * base : l'appelant le tire de la session, jamais d'un paramètre client.
 *
 * Les réclamations refusées d'office par la politique (`policyRejected`) sont
 * exclues, comme dans la liste des réclamations du vendeur : les chiffres
 * restent cohérents avec ce qu'il voit.
 */
export async function getProductReturnAnalytics(vendorId: string): Promise<ProductReturnAnalytics> {
  const claims = await prisma.claim.findMany({
    where:  { vendorId, policyRejected: false },
    select: ANALYTICS_SELECT,
  })
  return aggregateProductReturns(claims)
}

// ─────────────────────────────────────────────────────────────
// Score de fraude : retours précédents expliqués par un problème produit
// ─────────────────────────────────────────────────────────────

export interface ExplainedReturn {
  claimId:      string
  vendorId:     string
  productKey:   string
  reasonDetail: string
  confidence:   IssueConfidence
  discount:     number
}

export interface PastReturnsExplanation {
  /** Nombre de retours (pondéré par la confiance) à ne pas compter. */
  discount: number
  explained: ExplainedReturn[]
}

export const NO_EXPLANATION: PastReturnsExplanation = { discount: 0, explained: [] }

interface ExplainableClaim {
  id:                 string
  vendorId:           string
  status:             string
  productKey:         string | null
  returnReasonDetail: string | null
  customerEmail:      string | null
  customerPhone:      string | null
}

// Seules les réclamations ACCEPTÉES par le marchand prouvent un problème
// produit : une réclamation en attente n'a été examinée par personne, et une
// réclamation refusée a été jugée injustifiée. Sans ce filtre, des demandes
// fabriquées — jamais acceptées — suffiraient à faire baisser un score de
// fraude partagé entre toutes les boutiques.
export const EVIDENCE_STATUSES = ['APPROVED', 'IN_PROGRESS'] as const

/**
 * Partie pure : parmi les retours précédents du client, ceux qu'un problème
 * collectif sur le produit explique. `productClaims` contient les retours des
 * produits concernés, toutes boutiques confondues — la détection est faite
 * boutique par boutique.
 *
 * Garde-fous contre l'auto-disculpation :
 *   • la preuve ne retient que des réclamations acceptées (EVIDENCE_STATUSES) ;
 *   • le client évalué en est retiré, avec toute identité qui lui est liée par
 *     e-mail ou téléphone : il ne peut pas fabriquer le problème qui l'excuse ;
 *   • un retour du client que le marchand a refusé n'est jamais excusé.
 */
export function explainReturns(
  customerClaims: readonly ExplainableClaim[],
  productClaims:  readonly ExplainableClaim[],
  requester:      { email?: string | null; phone?: string | null } = {},
): PastReturnsExplanation {
  // Toutes les identités connues du client évalué : celles de la demande, et
  // celles portées par ses réclamations passées (retrouvées par e-mail OU
  // téléphone, donc éventuellement sous une autre adresse).
  const excludeIdentities = [
    ...customerIdentities(requester.email, requester.phone),
    ...customerClaims.flatMap(c => customerIdentities(c.customerEmail, c.customerPhone)),
  ]

  const issues = new Map<string, ProductIssue>()
  for (const [vendorId, vendorClaims] of groupBy(productClaims, c => c.vendorId)) {
    const detected = detectProductIssues(
      vendorClaims.map(c => ({
        claimId:      c.id,
        productKey:   c.productKey,
        reason:       null,
        reasonDetail: c.returnReasonDetail,
        identities:   customerIdentities(c.customerEmail, c.customerPhone),
        status:       c.status,
      })),
      { excludeIdentities, evidenceStatuses: EVIDENCE_STATUSES },
    )
    for (const issue of detected) {
      issues.set(`${vendorId}|${issue.productKey}|${issue.reasonDetail}`, issue)
    }
  }

  const explained: ExplainedReturn[] = []
  for (const c of customerClaims) {
    if (!c.productKey || !c.returnReasonDetail) continue
    if (c.status === 'REJECTED') continue
    const issue = issues.get(`${c.vendorId}|${c.productKey}|${c.returnReasonDetail}`)
    if (!issue) continue
    explained.push({
      claimId:      c.id,
      vendorId:     c.vendorId,
      productKey:   c.productKey,
      reasonDetail: c.returnReasonDetail,
      confidence:   issue.confidence,
      discount:     CONFIDENCE_DISCOUNT[issue.confidence],
    })
  }

  return {
    discount: explained.reduce((s, e) => s + e.discount, 0),
    explained,
  }
}

const EXPLAIN_SELECT = {
  id:                 true,
  vendorId:           true,
  status:             true,
  productKey:         true,
  returnReasonDetail: true,
  customerEmail:      true,
  customerPhone:      true,
} as const

/**
 * Retours précédents d'un client expliqués par un problème produit. Lecture
 * seule, toutes boutiques confondues — comme le dossier anti-fraude qu'elle
 * corrige. Rien de ce qui est lu ici n'est exposé à un autre vendeur : seul le
 * nombre de retours neutralisés sort de ce module.
 */
export async function explainCustomerPastReturns(
  email: string | null,
  phone: string | null,
): Promise<PastReturnsExplanation> {
  const identity: Array<Record<string, string>> = []
  if (email) identity.push({ customerEmail: email })
  if (phone) identity.push({ customerPhone: phone })
  if (identity.length === 0) return NO_EXPLANATION

  const customerClaims = await prisma.claim.findMany({
    where: {
      OR:                 identity,
      policyRejected:     false,
      productKey:         { not: null },
      returnReasonDetail: { not: null },
    },
    select: EXPLAIN_SELECT,
  })
  if (customerClaims.length === 0) return NO_EXPLANATION

  const products = new Map<string, { vendorId: string; productKey: string }>()
  for (const c of customerClaims) {
    if (c.productKey) products.set(`${c.vendorId}|${c.productKey}`, { vendorId: c.vendorId, productKey: c.productKey })
  }

  // Toutes les réclamations des produits, quel que soit leur statut : celles
  // qui ne comptent pas comme preuve servent encore à relier les identités.
  // Le tri preuve / non-preuve est fait dans explainReturns.
  const productClaims = await prisma.claim.findMany({
    where:  { OR: [...products.values()] },
    select: EXPLAIN_SELECT,
  })

  return explainReturns(customerClaims, productClaims, { email, phone })
}
