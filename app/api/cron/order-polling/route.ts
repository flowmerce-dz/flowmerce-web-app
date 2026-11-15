// app/api/cron/order-polling/route.ts — Flowmerce · Suivi des commandes
//
// Synchronisation des boutiques en mode polling ou connecteur : Flowmerce va
// lire leurs changements de statut, puis envoie les notifications qui en
// découlent.
//
// La fréquence d'appel de cette route fixe le délai entre un changement de
// statut dans la boutique et la notification du client. Vercel Cron la
// déclenche une fois par jour sur le plan Hobby (cf. vercel.json) ; pour un
// suivi rapproché, un ordonnanceur externe peut l'appeler toutes les quelques
// minutes avec le même secret (cf. README).
//
// Protection : `Authorization: Bearer <CRON_SECRET>`.

import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { syncDueStores } from '@/lib/order-tracking/pull'
import { processDueNotificationJobs } from '@/lib/order-tracking/worker'

const STORE_BATCH        = 20
const NOTIFICATION_BATCH = 50

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const sync          = await syncDueStores({ limit: STORE_BATCH })
  const notifications = await processDueNotificationJobs({ limit: NOTIFICATION_BATCH })
  return NextResponse.json({ sync, notifications })
}
