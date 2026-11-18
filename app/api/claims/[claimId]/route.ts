// app/api/claims/[claimId]/route.ts — Flowmerce
//
// Décision d'un vendeur (ou d'un admin) sur une réclamation.
//
// Intégrité de la décision (audit RedStone RS-01) :
//   · machine à états (lib/claim-transitions.ts) — une réclamation approuvée
//     ou refusée ne change plus de décision ;
//   · cohérence statut / résolution, et résolution contrôlée par la politique
//     de retour et la demande du client ;
//   · verrou optimiste — l'écriture n'a lieu que si le statut lu est toujours
//     celui en base ; sinon 409, sans écraser la décision concurrente ;
//   · historique en ajout seul (ClaimDecisionEvent), écrit dans la même
//     transaction que le changement de statut.

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@/lib/prisma'
import { Prisma }                    from '@prisma/client'
import { getSessionServer }          from '@/lib/getSession'
import { notifyCustomer }            from '@/lib/services/notification'
import { log }                       from '@/lib/logger'
import { VENDOR_DECISIONS, isVendorDecision, type VendorDecision } from '@/lib/constants'
import { checkVendorDecision }       from '@/lib/claim-transitions'
import { recordDecisionEvent }       from '@/lib/services/claim-history'

const ALLOWED_STATUSES = ['APPROVED', 'REJECTED', 'IN_PROGRESS'] as const
type AllowedStatus = (typeof ALLOWED_STATUSES)[number]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ claimId: string }> },
) {
  const session = await getSessionServer()
  if (!session?.user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }

  const user    = session.user
  const isAdmin = user.role === 'ADMIN'
  const { claimId } = await params

  const claim = await prisma.claim.findUnique({
    where:  { id: claimId },
    select: {
      id:            true,
      vendorId:      true,
      status:        true,
      prediction:    true,
      aiDecision:    true,
      customerName:  true,
      customerEmail: true,
      customerPhone: true,
      orderId:       true,
      type:          true,
      policyRejected: true,
    },
  })

  if (!claim) {
    return NextResponse.json({ error: 'Réclamation introuvable' }, { status: 404 })
  }

  if (!isAdmin) {
    const vendor = await prisma.vendor.findUnique({ where: { userId: user.id }, select: { id: true } })
    if (!vendor || vendor.id !== claim.vendorId) {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }
    // Refus hors politique : déterministe, pas rattrapable par le vendeur.
    if (claim.policyRejected) {
      return NextResponse.json(
        { error: 'Cette réclamation est hors de votre politique de retour et ne peut pas être traitée.' },
        { status: 403 },
      )
    }
  }

  let body: { status?: string; note?: string; aiDecision?: string; overrideNote?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }

  const newStatus = body.status?.toUpperCase()
  if (!newStatus || !ALLOWED_STATUSES.includes(newStatus as AllowedStatus)) {
    return NextResponse.json(
      { error: `Statut invalide. Valeurs acceptées : ${ALLOWED_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  // Le vendeur tranche parmi 4 décisions (les 3 classes ML + Refund) : il peut
  // accorder un remboursement que le ML ne sait pas recommander.
  if (body.aiDecision !== undefined && !isVendorDecision(body.aiDecision)) {
    return NextResponse.json(
      { error: `Décision invalide. Valeurs acceptées : ${VENDOR_DECISIONS.join(', ')}` },
      { status: 400 },
    )
  }

  const decision = body.aiDecision as VendorDecision | undefined
  const note     = body.note?.trim() || body.overrideNote?.trim() || null

  const returnPolicy = await prisma.returnPolicy.findUnique({
    where:  { vendorId: claim.vendorId },
    select: { acceptedTypes: true },
  })

  const rejection = checkVendorDecision({
    from:            claim.status,
    to:              newStatus as AllowedStatus,
    decision,
    currentDecision: claim.aiDecision,
    requestedType:   claim.type,
    acceptedTypes:   returnPolicy?.acceptedTypes,
  })
  if (rejection) {
    log.warn('claims.decision_refused', {
      claimId, code: rejection.code, from: claim.status, to: newStatus, decision: decision ?? null,
    })
    return NextResponse.json(
      { error: rejection.message, code: rejection.code },
      { status: rejection.status },
    )
  }

  // Une décision qui diverge de la reco ML est un override vendeur : on le trace
  // dans `prediction.override`, la forme que lisent les deux pages dashboard
  // (badge « Modifiée manuellement » + note de révision).
  const isOverride = !!decision && decision !== claim.aiDecision

  const existingPrediction = (claim.prediction as Prisma.JsonObject | null) ?? {}
  const updatedPrediction: Prisma.InputJsonValue = {
    ...existingPrediction,
    ...(decision ? { aiDecision: decision } : {}),
    ...(isOverride
      ? {
          override: {
            resolution: decision,
            mlDecision: claim.aiDecision,
            note,
            at: new Date().toISOString(),
            by: user.email ?? user.id,
          },
        }
      : {}),
    ...(body.overrideNote ? { overrideNote: body.overrideNote } : {}),
    ...(body.note?.trim() ? { vendorNote: body.note.trim(), vendorNoteAt: new Date().toISOString() } : {}),
  }

  // Origine de la décision — prédiction ≠ vérité terrain (C-04).
  //
  // Un humain n'établit une vérité terrain que lorsqu'il désigne explicitement
  // une résolution (`body.aiDecision`) : c'est ce que fait le dashboard, dont
  // le formulaire impose de confirmer une résolution avant d'approuver ou de
  // refuser. Un PATCH qui ne change que le statut (passage en IN_PROGRESS, ou
  // intégration qui n'envoie pas de résolution) laisse `aiDecision` à la valeur
  // écrite par le modèle : dans ce cas l'origine reste MODEL, et la réclamation
  // n'entrera pas dans le dataset d'entraînement.
  const humanGroundTruth = !!decision
  const now = new Date()
  const actor = user.email ?? user.id

  // Verrou optimiste : la mise à jour est conditionnée au statut lu plus haut.
  // Deux décisions simultanées ne peuvent pas s'écraser : la seconde ne trouve
  // plus la réclamation dans son état d'origine et reçoit un 409.
  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.claim.updateMany({
      where: { id: claimId, status: claim.status },
      data:  {
        status:      newStatus as AllowedStatus,
        processedAt: now,
        prediction:  updatedPrediction,
        // Colonne `aiDecision` = décision effective sur la réclamation (reco ML
        // à la création, puis choix du vendeur s'il tranche autrement).
        ...(decision ? { aiDecision: decision } : {}),
        ...(humanGroundTruth
          ? {
              resolutionSource: 'HUMAN' as const,
              resolvedBy:       actor,
              resolvedAt:       now,
            }
          : {}),
      },
    })
    if (count === 0) return null

    await recordDecisionEvent(tx, {
      claimId,
      previousStatus:   claim.status,
      newStatus:        newStatus as AllowedStatus,
      previousDecision: claim.aiDecision,
      newDecision:      decision ?? claim.aiDecision,
      actorType:        isAdmin ? 'ADMIN' : 'VENDOR',
      actor,
      origin:           'dashboard',
      reason:           note,
    })

    return tx.claim.findUnique({
      where:  { id: claimId },
      select: { id: true, status: true, processedAt: true },
    })
  })

  if (!updated) {
    log.warn('claims.decision_conflict', { claimId, from: claim.status, to: newStatus })
    return NextResponse.json(
      {
        error: 'Cette réclamation vient d’être modifiée par ailleurs. Rechargez la page pour voir sa décision.',
        code:  'CONCURRENT_UPDATE',
      },
      { status: 409 },
    )
  }

  // Décision notifiée : priorité au choix du vendeur, sinon celle déjà sur le claim
  const finalDecision = (decision ?? claim.aiDecision) as VendorDecision | null

  notifyCustomer({
    customerName:  claim.customerName,
    customerEmail: claim.customerEmail,
    customerPhone: claim.customerPhone,
    orderId:       claim.orderId,
    status:        newStatus as AllowedStatus,
    aiDecision:    finalDecision,
    claimType:     claim.type,
    note,
  }).catch(err => log.error('claims.notification_error', { err: String(err) }))

  log.info('claims.decision', {
    claimId,
    status:      newStatus,
    decision:    finalDecision,
    mlDecision:  claim.aiDecision,
    overridden:  isOverride,
    groundTruth: humanGroundTruth,
  })

  return NextResponse.json({ claim: updated })
}
