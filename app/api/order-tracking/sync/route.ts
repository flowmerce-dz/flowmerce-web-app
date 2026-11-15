// app/api/order-tracking/sync/route.ts — Flowmerce · Suivi des commandes
//
// POST → synchronise maintenant la boutique connectée (bouton « Synchroniser
// maintenant » du tableau de bord), sans attendre le prochain passage planifié.
//
// Réservé aux modes où Flowmerce va chercher les statuts (polling, connecteur).
// C'est la même synchronisation que celle du cron : mêmes contrôles, même
// verrou — un clic pendant un passage planifié ne lance rien en double.

import { after, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/getSession'
import { requireDashboardVendor } from '@/lib/dashboard-vendor'
import { log } from '@/lib/logger'
import { syncStore, type SkipReason } from '@/lib/order-tracking/pull'
import { processDueNotificationJobs } from '@/lib/order-tracking/worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SKIP_MESSAGES: Record<SkipReason, { status: number; error: string }> = {
  disabled:       { status: 403, error: 'Activez le suivi des commandes avant de synchroniser' },
  wrong_mode:     { status: 409, error: 'La synchronisation ne concerne que les modes polling et connecteur' },
  not_configured: { status: 409, error: 'La source n’est pas encore configurée' },
  locked:         { status: 409, error: 'Une synchronisation est déjà en cours' },
}

export async function POST() {
  const session = await getSessionFromRequest()
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const resolved = await requireDashboardVendor(session.user)
  if (!resolved.ok) return resolved.response

  const summary = await syncStore(resolved.vendor.id)

  if (summary.status === 'skipped') {
    const { status, error } = SKIP_MESSAGES[summary.reason ?? 'not_configured']
    return NextResponse.json({ error, code: summary.reason }, { status })
  }

  if (summary.notifications > 0) {
    // Envoi après la réponse : le vendeur n'attend pas le fournisseur d'e-mail.
    try {
      after(async () => {
        await processDueNotificationJobs({ limit: 10 }).catch((err) =>
          log.error('order_tracking.post_sync_worker_error', { err: String(err) }),
        )
      })
    } catch {
      // Hors d'un contexte de requête Next.js : le cron reste le filet.
    }
  }

  // Un échec de la boutique n'est pas une erreur de cette route : il est rendu
  // tel quel, pour être affiché au vendeur.
  return NextResponse.json(summary)
}
