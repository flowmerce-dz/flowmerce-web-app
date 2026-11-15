// app/api/order-tracking/activity/route.ts — Flowmerce · Suivi des commandes
//
// GET ?type=webhooks|notifications&page=1
//
// Journaux du suivi pour la boutique connectée :
//   webhooks       → événements reçus, quel que soit le mode d'intégration :
//                    webhooks acceptés ou refusés, événements lus par polling
//                    ou connecteur, synchronisations en échec (WebhookLog) ;
//   notifications  → file d'envoi et état de chaque notification (NotificationJob).
//
// Toujours filtré sur la boutique de la session : un vendeur ne voit que ses
// propres lignes.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/getSession'
import { requireDashboardVendor } from '@/lib/dashboard-vendor'

const PAGE_SIZE = 10

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest()
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const resolved = await requireDashboardVendor(session.user)
  if (!resolved.ok) return resolved.response
  const vendorId = resolved.vendor.id

  const params = req.nextUrl.searchParams
  const type   = params.get('type')
  const page   = Math.max(1, Math.min(10_000, Number.parseInt(params.get('page') ?? '1', 10) || 1))
  const skip   = (page - 1) * PAGE_SIZE

  if (type === 'webhooks') {
    const [items, total] = await Promise.all([
      prisma.webhookLog.findMany({
        where:   { vendorId },
        orderBy: { receivedAt: 'desc' },
        skip,
        take:    PAGE_SIZE,
        select: {
          id: true, eventId: true, externalOrderId: true, rawStatus: true,
          outcome: true, httpStatus: true, error: true, isTest: true,
          durationMs: true, receivedAt: true, source: true,
        },
      }),
      prisma.webhookLog.count({ where: { vendorId } }),
    ])
    return NextResponse.json({ items, total, page, pageSize: PAGE_SIZE })
  }

  if (type === 'notifications') {
    const [rows, total] = await Promise.all([
      prisma.notificationJob.findMany({
        where:   { vendorId },
        orderBy: { createdAt: 'desc' },
        skip,
        take:    PAGE_SIZE,
        select: {
          id: true, channel: true, status: true, orderStatus: true, recipient: true,
          language: true, attempts: true, maxAttempts: true, nextAttemptAt: true,
          lastError: true, sentAt: true, createdAt: true,
          order: { select: { externalId: true } },
        },
      }),
      prisma.notificationJob.count({ where: { vendorId } }),
    ])
    const items = rows.map(({ order, ...job }) => ({ ...job, externalOrderId: order.externalId }))
    return NextResponse.json({ items, total, page, pageSize: PAGE_SIZE })
  }

  return NextResponse.json(
    { error: 'Paramètre type invalide (webhooks | notifications)' },
    { status: 400 },
  )
}
