// app/api/order-tracking/test/route.ts — Flowmerce · Suivi des commandes
//
// POST → envoie un webhook de test pour la boutique connectée.
// Body : { status?: string }  — libellé de statut à essayer (défaut « Expédiée »)
//
// Le serveur fabrique un événement, le signe avec le secret de la boutique et
// le soumet au traitement réel (lib/order-tracking/webhook.ts) : signature,
// horodatage, contrat du corps et correspondance des statuts sont vérifiés
// exactement comme pour un envoi de la boutique.
//
// Rien de fictif n'entre en base : en mode test, le traitement n'écrit ni
// commande, ni historique, ni notification. Seule une ligne du journal des
// webhooks, marquée « test », garde la trace de l'essai.
//
// Le secret ne quitte pas le serveur : la signature est calculée ici.

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/getSession'
import { requireDashboardVendor } from '@/lib/dashboard-vendor'
import { isServiceEnabled, serviceDisabledResponse } from '@/lib/services/vendor-services'
import { computeSignature, decryptSecret } from '@/lib/order-tracking/crypto'
import { processOrderWebhook } from '@/lib/order-tracking/webhook'
import { log } from '@/lib/logger'

const BodySchema = z.object({ status: z.string().trim().min(1).max(100).optional() }).strict()

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest()
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const resolved = await requireDashboardVendor(session.user)
  if (!resolved.ok) return resolved.response
  const { vendor } = resolved

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })

  const now       = new Date()
  const eventId   = `test_${randomUUID()}`
  const timestamp = String(Math.floor(now.getTime() / 1000))
  const payload   = {
    order_id:        `TEST-${timestamp}`,
    status:          parsed.data.status ?? 'Expédiée',
    updated_at:      now.toISOString(),
    customer:        { name: 'Client de test', email: 'client.test@example.com' },
    tracking_number: 'TEST-123456',
    carrier:         'test',
  }
  const rawBody = JSON.stringify(payload)

  const report = (httpStatus: number, response: unknown) =>
    NextResponse.json({ ok: httpStatus === 200, httpStatus, response, request: { eventId, timestamp, body: payload } })

  // Même verdict que la route publique pour une boutique qui n'a pas activé le suivi.
  if (!isServiceEnabled(vendor, 'orderTracking')) {
    return report(403, await serviceDisabledResponse('orderTracking').json())
  }

  // Sans secret, la signature est vide : le traitement répondra lui-même que
  // le secret n'a pas été généré.
  let signature = ''
  try {
    const config = await prisma.orderTrackingConfig.findUnique({
      where:  { vendorId: vendor.id },
      select: { webhookSecretEnc: true },
    })
    if (config?.webhookSecretEnc) {
      signature = computeSignature(decryptSecret(config.webhookSecretEnc), timestamp, eventId, rawBody)
    }
  } catch (err) {
    log.error('order_tracking.test_secret_error', { vendorId: vendor.id, err: String(err) })
    return report(500, { error: 'Erreur interne', code: 'INTERNAL_ERROR' })
  }

  const result = await processOrderWebhook({
    vendorId: vendor.id,
    signature: signature || 'sha256=',
    eventId,
    timestamp,
    rawBody,
    isTest: true,
    now,
  })

  return report(result.response.status, await result.response.json())
}
