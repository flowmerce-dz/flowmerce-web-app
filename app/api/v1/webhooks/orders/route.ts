// app/api/v1/webhooks/orders/route.ts — Flowmerce · Suivi des commandes
//
// Réception des changements de statut de commande envoyés par une boutique.
//
// POST /api/v1/webhooks/orders
//   X-Flowmerce-Key:        clé API de la boutique (flk_…)
//   X-Flowmerce-Signature:  HMAC-SHA256 hexadécimal de
//                           `${timestamp}.${eventId}.${corps brut}`,
//                           calculé avec le secret webhook (préfixe sha256= accepté)
//   X-Flowmerce-Event-Id:   identifiant unique de l'événement
//   X-Flowmerce-Timestamp:  secondes Unix de l'envoi
//
//   200  événement enregistré (appliqué, arrivé en retard ou statut non reconnu)
//   400  en-têtes ou corps invalides
//   401  clé API ou signature invalide, horodatage hors fenêtre
//   403  suivi non activé pour la boutique, boutique dans un autre mode
//        d'intégration, ou secret webhook non généré
//   409  événement déjà reçu — ne pas le renvoyer
//   500  erreur interne — l'événement peut être renvoyé
//
// Cette route n'appartient qu'au service de suivi : elle ne lit ni la
// politique de retour, ni l'état de Retours-ML.
//
// Le traitement est dans lib/order-tracking/webhook.ts. La route identifie la
// boutique, lit le corps brut — la signature porte sur les octets reçus, pas
// sur un JSON re-sérialisé — puis réveille le worker une fois la réponse rendue.

import { after, NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateApiKey } from '@/lib/api-key-auth'
import { log } from '@/lib/logger'
import { processOrderWebhook } from '@/lib/order-tracking/webhook'
import { processDueNotificationJobs } from '@/lib/order-tracking/worker'

export const dynamic = 'force-dynamic'

/** Travaux traités au réveil qui suit un webhook ; le cron prend le reste. */
const POST_RESPONSE_BATCH = 5

export async function POST(req: NextRequest) {
  // 1 & 2 — boutique identifiée par sa clé API, service de suivi actif.
  const auth = await validateApiKey(req.headers.get('x-flowmerce-key'), {
    service: 'orderTracking',
  })
  if (!auth.ok) return auth.response
  const { keyRecord } = auth

  const rawBody = await req.text()

  const result = await processOrderWebhook({
    vendorId:  keyRecord.vendorId,
    signature: req.headers.get('x-flowmerce-signature'),
    eventId:   req.headers.get('x-flowmerce-event-id'),
    timestamp: req.headers.get('x-flowmerce-timestamp'),
    rawBody,
  })

  if (result.accepted) {
    await prisma.apiKey
      .update({ where: { id: keyRecord.id }, data: { lastUsedAt: new Date() } })
      .catch(() => null)

    // Réveil du worker APRÈS l'envoi de la réponse : la boutique n'attend
    // jamais un fournisseur d'e-mail. Le travail est déjà en base ; si ce
    // réveil n'a pas lieu, le cron le prendra.
    try {
      after(async () => {
        await processDueNotificationJobs({ limit: POST_RESPONSE_BATCH }).catch((err) =>
          log.error('order_tracking.post_response_worker_error', { err: String(err) }),
        )
      })
    } catch {
      // Hors d'un contexte de requête Next.js : le cron reste le filet.
    }
  }

  return result.response
}
