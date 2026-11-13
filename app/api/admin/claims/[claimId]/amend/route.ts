// app/api/admin/claims/[claimId]/amend/route.ts — Flowmerce
//
// Correction d'une décision déjà rendue — ADMIN uniquement.
//
// Les vendeurs ne peuvent plus modifier une réclamation approuvée ou refusée
// (machine à états, audit RedStone RS-01). Une erreur se corrige ici, par un
// circuit distinct que RedStone recommande :
//   · réservé au rôle ADMIN ;
//   · motif obligatoire, conservé dans l'historique (ClaimDecisionEvent) ;
//   · verrou optimiste sur le statut ET la résolution lus ;
//   · résolution contrôlée par la demande du client et la politique du vendeur.
//
// POST { aiDecision: 'Exchange'|'Repair'|'Refund'|'Reject', reason: string,
//        notifyCustomer?: boolean (défaut true) }

import { NextRequest, NextResponse } from 'next/server'
import { Prisma }                    from '@prisma/client'
import { prisma }                    from '@/lib/prisma'
import { getSessionServer }          from '@/lib/getSession'
import { notifyCustomer }            from '@/lib/services/notification'
import { recordDecisionEvent }       from '@/lib/services/claim-history'
import { checkAdminAmendment }       from '@/lib/claim-transitions'
import { VENDOR_DECISIONS, isVendorDecision } from '@/lib/constants'
import { log }                       from '@/lib/logger'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ claimId: string }> },
) {
  const session = await getSessionServer()
  if (!session?.user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  const user = session.user
  if (user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  let body: { aiDecision?: unknown; reason?: unknown; notifyCustomer?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }

  if (!isVendorDecision(body.aiDecision)) {
    return NextResponse.json(
      { error: `Décision invalide. Valeurs acceptées : ${VENDOR_DECISIONS.join(', ')}` },
      { status: 400 },
    )
  }
  const decision = body.aiDecision
  const reason   = typeof body.reason === 'string' ? body.reason : ''
  const notify   = body.notifyCustomer !== false

  const { claimId } = await params
  const claim = await prisma.claim.findUnique({
    where:  { id: claimId },
    select: {
      id: true, vendorId: true, status: true, aiDecision: true, type: true,
      prediction: true, policyRejected: true,
      customerName: true, customerEmail: true, customerPhone: true, orderId: true,
    },
  })
  if (!claim) {
    return NextResponse.json({ error: 'Réclamation introuvable' }, { status: 404 })
  }

  // Un refus d'office par la politique reste masqué au vendeur : l'approuver
  // ici créerait une réclamation acceptée qu'il ne verrait jamais.
  if (claim.policyRejected) {
    return NextResponse.json(
      {
        error: 'Cette réclamation a été refusée d’office par la politique de retour du vendeur : elle ne se corrige pas ici.',
        code:  'POLICY_REJECTED',
      },
      { status: 409 },
    )
  }

  const returnPolicy = await prisma.returnPolicy.findUnique({
    where:  { vendorId: claim.vendorId },
    select: { acceptedTypes: true },
  })

  const check = checkAdminAmendment({
    from:            claim.status,
    decision,
    currentDecision: claim.aiDecision,
    reason,
    requestedType:   claim.type,
    acceptedTypes:   returnPolicy?.acceptedTypes,
  })
  if (!check.ok) {
    return NextResponse.json(
      { error: check.error.message, code: check.error.code },
      { status: check.error.status },
    )
  }

  const now   = new Date()
  const actor = user.email ?? user.id
  const note  = reason.trim()

  // La décision affichée lit `prediction.override` en priorité : il porte
  // désormais la résolution corrigée, en gardant la recommandation d'origine.
  const prediction = (claim.prediction as Prisma.JsonObject | null) ?? {}
  const previousOverride = prediction.override as Prisma.JsonObject | undefined
  const recommendation   = prediction.recommendation as Prisma.JsonObject | undefined
  const updatedPrediction: Prisma.InputJsonValue = {
    ...prediction,
    aiDecision: decision,
    override: {
      resolution: decision,
      mlDecision: previousOverride?.mlDecision ?? recommendation?.resolution ?? claim.aiDecision,
      note,
      at: now.toISOString(),
      by: actor,
    },
  }

  const applied = await prisma.$transaction(async (tx) => {
    // Verrou optimiste : la correction ne s'applique qu'à la décision lue.
    const { count } = await tx.claim.updateMany({
      where: { id: claimId, status: claim.status, aiDecision: claim.aiDecision },
      data: {
        status:           check.to,
        aiDecision:       decision,
        prediction:       updatedPrediction,
        resolutionSource: 'HUMAN',
        resolvedBy:       actor,
        resolvedAt:       now,
        // Le label d'entraînement a changé : la réclamation repart à l'export
        // pour que le dataset ML reçoive la décision corrigée.
        exportedToML:     false,
        exportedAt:       null,
      },
    })
    if (count === 0) return false

    await recordDecisionEvent(tx, {
      claimId,
      previousStatus:   claim.status,
      newStatus:        check.to,
      previousDecision: claim.aiDecision,
      newDecision:      decision,
      actorType:        'ADMIN',
      actor,
      origin:           'admin_amendment',
      reason:           note,
    })
    return true
  })

  if (!applied) {
    return NextResponse.json(
      {
        error: 'Cette réclamation vient d’être modifiée par ailleurs. Rechargez la page avant de la corriger.',
        code:  'CONCURRENT_UPDATE',
      },
      { status: 409 },
    )
  }

  // Le motif est une note interne : le client reçoit la nouvelle décision.
  if (notify) {
    notifyCustomer({
      customerName:  claim.customerName,
      customerEmail: claim.customerEmail,
      customerPhone: claim.customerPhone,
      orderId:       claim.orderId,
      status:        check.to,
      aiDecision:    decision,
      claimType:     claim.type,
      note:          null,
    }).catch(err => log.error('claims.amendment_notification_error', { err: String(err) }))
  }

  log.info('claims.decision_amended', {
    claimId,
    from:     claim.status,
    to:       check.to,
    previous: claim.aiDecision,
    decision,
    by:       actor,
    notified: notify,
  })

  return NextResponse.json({ claim: { id: claimId, status: check.to, aiDecision: decision } })
}
