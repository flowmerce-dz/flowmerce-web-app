// app/api/cron/order-notifications/route.ts — Flowmerce · Suivi des commandes
//
// Worker de la file de notifications du suivi des commandes : envoie les
// travaux arrivés à échéance, relance ceux qui ont échoué et reprend ceux
// qu'un worker interrompu a laissés en cours.
//
// Le worker est déjà réveillé après chaque webhook accepté ; cette route est le
// filet qui garantit les relances quand aucun webhook n'arrive. Sa fréquence
// fixe donc le délai maximal d'une relance (cf. vercel.json et le README).
//
// Protection : `Authorization: Bearer <CRON_SECRET>`, envoyé par Vercel Cron.
// La route peut aussi être appelée par un ordonnanceur externe muni du secret.

import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { processDueNotificationJobs } from '@/lib/order-tracking/worker'

const BATCH_SIZE = 50

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const summary = await processDueNotificationJobs({ limit: BATCH_SIZE })
  return NextResponse.json(summary)
}
