// app/api/admin/claims/[claimId]/amend/route.ts — Flowmerce
//
// Correction d'une décision déjà rendue — ADMIN, sur n'importe quelle boutique.
// Le marchand corrige ses propres réclamations par
// POST /api/claims/[claimId]/amend. Règles communes :
// lib/services/claim-amendment.ts.
//
// POST { aiDecision: 'Exchange'|'Repair'|'Refund'|'Reject', reason: string,
//        notifyCustomer?: boolean (défaut true) }

import { NextRequest, NextResponse } from 'next/server'
import { getSessionServer }          from '@/lib/getSession'
import { amendClaimDecision }        from '@/lib/services/claim-amendment'

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

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }

  const { claimId } = await params
  const result = await amendClaimDecision({
    claimId,
    actor: { type: 'ADMIN', id: user.email ?? user.id },
    body,
  })
  return NextResponse.json(result.body, { status: result.status })
}
