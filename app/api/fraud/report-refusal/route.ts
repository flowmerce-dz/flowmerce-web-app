// POST /api/fraud/report-refusal
//
// Signale un refus de livraison pour un client donné.
//
// Un refus à la livraison arrive AVANT toute réclamation : le colis est parti,
// le client l'a refusé au seuil de sa porte, il n'y a ni retour ouvert ni
// litige. Exiger une trace préalable (Claim ou ReturnSession) rendait donc
// l'endpoint inutilisable dans le seul cas où il sert — le vendeur devait
// fabriquer une réclamation pour pouvoir signaler. La trace est désormais un
// bonus de confiance, plus une condition d'accès.
//
// Sécurité anti-empoisonnement :
//   1. Auth via clé API → on connaît le vendorId signalant ; un signalement
//      est toujours imputable.
//   2. orderId obligatoire. Si une trace (Claim ou ReturnSession) existe chez
//      ce vendeur pour cette commande, le signalement est « vérifié » et
//      l'email/téléphone fourni doit correspondre à celui de la transaction.
//   3. Sans trace, le signalement est accepté mais compté : quota de
//      MAX_UNVERIFIED commandes distinctes par vendeur et par fenêtre — un
//      vendeur ne peut pas déverser des centaines de faux refus.
//   4. Insertion idempotente (unique vendorId+orderId) — pas de spam sur une
//      même commande.
//   5. Le score plafonne un signalant isolé (refus locaux max 40 points) : il
//      faut la confirmation d'autres marchands pour dépasser (cf. fraud-score.ts).
//
// Auth : x-api-key du vendeur (ou Authorization: Bearer)
// Body : { customer_email?, customer_phone?, order_id, refusal_reason? }
// Règle : customer_email OU customer_phone obligatoire

import { NextRequest, NextResponse } from 'next/server'
import { prisma }           from '@/lib/prisma'
import { validateApiKey }   from '@/lib/api-key-auth'
import { reportRefusal }    from '@/lib/fraud-score'
import { checkRateLimit }   from '@/lib/rate-limit'
import { log }              from '@/lib/logger'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Quota des signalements sans trace, par vendeur. Dimensionné pour couvrir
// largement les refus réels d'une boutique sur 24 h tout en rendant coûteuse
// la fabrication en masse.
const MAX_UNVERIFIED    = 30
const UNVERIFIED_WINDOW = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  // 1. Auth — on récupère le vendorId signalant
  const rawKey =
    req.headers.get('x-api-key') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    null

  const auth = await validateApiKey(rawKey)
  if (!auth.ok) return auth.response
  const { vendorId } = auth.keyRecord

  // 2. Body
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 })
  }

  const customerEmail = body.customer_email
    ? String(body.customer_email).trim().toLowerCase()
    : undefined
  const customerPhone = body.customer_phone
    ? String(body.customer_phone).trim()
    : undefined
  const orderId       = body.order_id ? String(body.order_id).trim() : undefined
  const refusalReason = body.refusal_reason ? String(body.refusal_reason).trim() : undefined

  // 3. Validation
  if (!orderId) {
    return NextResponse.json({ error: 'order_id requis' }, { status: 422 })
  }
  if (!customerEmail && !customerPhone) {
    return NextResponse.json(
      { error: 'customer_email ou customer_phone requis' },
      { status: 422 },
    )
  }
  if (customerEmail && !EMAIL_RE.test(customerEmail)) {
    return NextResponse.json({ error: 'Email invalide' }, { status: 422 })
  }

  // 4. Recherche d'une trace de la commande chez ce vendeur.
  //    Sa présence ne conditionne plus l'acceptation : elle qualifie le
  //    signalement (vérifié) et permet de contrôler l'identifiant client.
  const [claim, returnSession] = await Promise.all([
    prisma.claim.findFirst({
      where:  { vendorId, orderId },
      select: { id: true, customerEmail: true, customerPhone: true },
    }),
    prisma.returnSession.findFirst({
      where: {
        orderId,
        vendor: { vendorId },  // ReturnSession.vendor → ApiKey → vendorId
      },
      select: { id: true, customerEmail: true, customerPhone: true },
    }),
  ])

  const verified = Boolean(claim || returnSession)

  // 5. Trace présente : l'identifiant fourni doit correspondre à celui de la
  //    transaction (anti-fishing par email arbitraire).
  const knownEmail = claim?.customerEmail ?? returnSession?.customerEmail ?? null
  const knownPhone = claim?.customerPhone ?? returnSession?.customerPhone ?? null

  if (
    customerEmail &&
    knownEmail &&
    customerEmail !== knownEmail.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "customer_email ne correspond pas à la commande référencée" },
      { status: 422 },
    )
  }
  if (customerPhone && knownPhone && customerPhone !== knownPhone) {
    return NextResponse.json(
      { error: "customer_phone ne correspond pas à la commande référencée" },
      { status: 422 },
    )
  }

  // 6. Sans trace : quota par vendeur. Il n'est consommé que par une commande
  //    encore jamais signalée — un rejeu à l'identique reste idempotent et
  //    gratuit, sinon un client qui reclique brûlerait le quota du vendeur.
  if (!verified) {
    const existing = await prisma.refusalReport.findUnique({
      where:  { vendorId_orderId: { vendorId, orderId } },
      select: { id: true },
    })

    if (!existing) {
      const allowed = await checkRateLimit(
        `refusal:${vendorId}`,
        MAX_UNVERIFIED,
        UNVERIFIED_WINDOW,
      )
      if (!allowed) {
        log.warn('report-refusal.quota_exceeded', { vendorId, orderId })
        return NextResponse.json(
          {
            error:
              'Quota de signalements non rattachés à une commande connue atteint. Réessayez plus tard.',
          },
          { status: 429 },
        )
      }
    }
  }

  // 7. Insertion + recalcul score (idempotent sur vendorId+orderId)
  const result = await reportRefusal({
    vendorId,
    customerEmail: customerEmail ?? knownEmail ?? undefined,
    customerPhone: customerPhone ?? knownPhone ?? undefined,
    orderId,
    claimId: claim?.id,
    reason:  refusalReason,
  })

  return NextResponse.json(
    {
      ok:               true,
      verified,
      alreadyReported:  result.alreadyReported,
      newFraudScore:    result.newFraudScore,
      distinctVendors:  result.distinctVendors,
      totalRefusals:    result.totalRefusals,
    },
    { status: 200 },
  )
}
