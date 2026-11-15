// app/api/order-tracking/secret/route.ts — Flowmerce · Suivi des commandes
//
// POST → génère le secret webhook de la boutique connectée, ou le remplace.
//
// Le secret est rendu en clair UNE seule fois, dans cette réponse. Il est
// stocké chiffré ; aucune route ne peut le restituer ensuite. Le régénérer
// invalide immédiatement l'ancien : les webhooks signés avec lui sont refusés
// tant que la boutique n'a pas mis sa configuration à jour.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/getSession'
import { requireDashboardVendor } from '@/lib/dashboard-vendor'
import {
  encryptSecret,
  generateWebhookSecret,
  isSecretStorageConfigured,
  webhookSecretPrefix,
} from '@/lib/order-tracking/crypto'
import { log } from '@/lib/logger'

export async function POST() {
  const session = await getSessionFromRequest()
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const resolved = await requireDashboardVendor(session.user)
  if (!resolved.ok) return resolved.response
  const vendorId = resolved.vendor.id

  if (!isSecretStorageConfigured()) {
    log.error('order_tracking.secret_storage_missing', { vendorId })
    return NextResponse.json(
      {
        error: 'Le stockage des secrets webhook n’est pas configuré sur ce déploiement',
        code:  'SECRET_STORAGE_NOT_CONFIGURED',
      },
      { status: 503 },
    )
  }

  const secret    = generateWebhookSecret()
  const prefix    = webhookSecretPrefix(secret)
  const createdAt = new Date()
  const fields    = {
    webhookSecretEnc:       encryptSecret(secret),
    webhookSecretPrefix:    prefix,
    webhookSecretCreatedAt: createdAt,
  }

  const previous = await prisma.orderTrackingConfig.findUnique({
    where:  { vendorId },
    select: { webhookSecretEnc: true },
  })

  await prisma.orderTrackingConfig.upsert({
    where:  { vendorId },
    create: { vendorId, ...fields },
    update: fields,
  })

  log.info('order_tracking.secret_generated', {
    vendorId, regenerated: Boolean(previous?.webhookSecretEnc),
  })

  return NextResponse.json(
    { secret, prefix, createdAt, oneTimeReveal: true },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
