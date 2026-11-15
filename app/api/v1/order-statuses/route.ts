// app/api/v1/order-statuses/route.ts — Flowmerce · Suivi des commandes
//
// Déclaration, par une boutique, des statuts de commande qui existent chez
// elle. Le tableau de bord du vendeur ne lui présente ensuite que ceux-là
// (lib/order-tracking/store-statuses.ts).
//
// PUT /api/v1/order-statuses
//   X-Flowmerce-Key: flk_…            (ou Authorization: Bearer flk_…)
//   Body: { "statuses": ["En attente", "Confirmée", "Expédiée", "Livrée"] }
//
//   La liste transmise REMPLACE la précédente : la boutique envoie toujours sa
//   liste complète. Une liste vide annule la déclaration.
//
//   200 → { statuses: [{ label, status, mapped }], declared_at }
//         `status` est le statut normalisé du libellé ; `mapped: false`
//         signale un libellé à associer dans le tableau de bord.
//   400 → corps invalide · 401 → clé API · 403 → suivi non activé
//
// GET /api/v1/order-statuses → la liste déclarée, sous la même forme.
//
// Les libellés sont ceux que la boutique envoie dans le champ `status` du
// webhook. Déclarer un statut ne le rend pas obligatoire et n'en interdit
// aucun autre : un statut non déclaré reste accepté par le webhook.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { validateApiKey } from '@/lib/api-key-auth'
import { log } from '@/lib/logger'
import {
  MAX_STATUS_LABEL_SIZE,
  MAX_STORE_STATUSES,
  buildStoreStatusView,
  sanitizeDeclaredStatuses,
} from '@/lib/order-tracking/store-statuses'

export const dynamic = 'force-dynamic'

const BodySchema = z
  .object({
    statuses: z.array(z.string().trim().min(1).max(MAX_STATUS_LABEL_SIZE)).max(MAX_STORE_STATUSES),
  })
  .strict()

function authenticate(req: NextRequest) {
  const rawKey =
    req.headers.get('x-flowmerce-key') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.headers.get('x-api-key') ??
    null
  // Service de suivi uniquement : ni Retours-ML ni la politique de retour
  // n'entrent en jeu.
  return validateApiKey(rawKey, { service: 'orderTracking' })
}

async function respond(vendorId: string, labels: string[], declaredAt: Date | null) {
  const mappings = await prisma.storeStatusMapping.findMany({
    where:  { vendorId },
    select: { normalizedKey: true, status: true },
  })
  const { items } = buildStoreStatusView(labels, mappings)

  return NextResponse.json({
    statuses: items.map(({ label, status }) => ({ label, status, mapped: status !== 'UNMAPPED' })),
    declared_at: declaredAt,
  })
}

export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return auth.response
  const { vendorId } = auth.keyRecord

  const config = await prisma.orderTrackingConfig.findUnique({
    where:  { vendorId },
    select: { storeStatuses: true, storeStatusesDeclaredAt: true },
  })
  return respond(vendorId, config?.storeStatuses ?? [], config?.storeStatusesDeclaredAt ?? null)
}

export async function PUT(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return auth.response
  const { vendorId } = auth.keyRecord

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: `Corps invalide : { "statuses": [...] } attendu, ${MAX_STORE_STATUSES} libellés au plus, ${MAX_STATUS_LABEL_SIZE} caractères chacun`,
        code:  'INVALID_PAYLOAD',
      },
      { status: 400 },
    )
  }

  const storeStatuses = sanitizeDeclaredStatuses(parsed.data.statuses)
  const declaredAt    = storeStatuses.length ? new Date() : null
  const fields        = { storeStatuses, storeStatusesDeclaredAt: declaredAt }

  await prisma.orderTrackingConfig.upsert({
    where:  { vendorId },
    create: { vendorId, ...fields },
    update: fields,
  })

  log.info('order_tracking.store_statuses_declared', { vendorId, count: storeStatuses.length })

  return respond(vendorId, storeStatuses, declaredAt)
}
