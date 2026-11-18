// app/api/claims/[claimId]/amend/route.ts — Flowmerce
//
// Correction d'une décision déjà rendue, par le marchand sur ses propres
// réclamations (ou par l'admin). La boutique est lue depuis la SESSION : aucun
// paramètre ne permet de corriger la réclamation d'une autre boutique.
// Règles communes avec la route admin : lib/services/claim-amendment.ts.
//
// POST { aiDecision: 'Exchange'|'Repair'|'Refund'|'Reject', reason: string,
//        notifyCustomer?: boolean (défaut true) }

import { NextRequest, NextResponse } from 'next/server'
import { prisma }                    from '@/lib/prisma'
import { getSessionServer }          from '@/lib/getSession'
import { amendClaimDecision, type AmendmentActor } from '@/lib/services/claim-amendment'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ claimId: string }> },
) {
  const session = await getSessionServer()
  if (!session?.user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  const user = session.user

  let actor: AmendmentActor
  if (user.role === 'ADMIN') {
    actor = { type: 'ADMIN', id: user.email ?? user.id }
  } else {
    const vendor = await prisma.vendor.findUnique({ where: { userId: user.id }, select: { id: true } })
    if (!vendor) {
      return NextResponse.json({ error: 'Accès non autorisé' }, { status: 403 })
    }
    actor = { type: 'VENDOR', id: user.email ?? user.id, vendorId: vendor.id }
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }

  const { claimId } = await params
  const result = await amendClaimDecision({ claimId, actor, body })
  return NextResponse.json(result.body, { status: result.status })
}
