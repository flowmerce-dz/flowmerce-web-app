// app/api/vendors/services/route.ts — Flowmerce
//
// Activation des services de la boutique connectée.
//
// GET   → { services: { returnsML, orderTracking } }
// PATCH → body { returnsMLEnabled?: boolean, orderTrackingEnabled?: boolean }
//
// Chaque drapeau est écrit seul : un champ absent du corps n'est pas touché.
// Activer ou désactiver un service ne modifie donc jamais l'autre, et aucune
// combinaison n'est interdite — y compris aucun service.
//
// Désactiver un service coupe ses API et ses pages, sans rien supprimer : la
// configuration et les données sont retrouvées telles quelles à la réactivation.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getSessionFromRequest } from '@/lib/getSession'
import { requireDashboardVendor } from '@/lib/dashboard-vendor'
import { enabledServices } from '@/lib/services/vendor-services'
import { log } from '@/lib/logger'

const PatchSchema = z
  .object({
    returnsMLEnabled:     z.boolean().optional(),
    orderTrackingEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.returnsMLEnabled !== undefined || v.orderTrackingEnabled !== undefined, {
    message: 'Aucun service à modifier',
  })

export async function GET() {
  const session = await getSessionFromRequest()
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const resolved = await requireDashboardVendor(session.user)
  if (!resolved.ok) return resolved.response

  return NextResponse.json({ services: enabledServices(resolved.vendor) })
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest()
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const resolved = await requireDashboardVendor(session.user)
  if (!resolved.ok) return resolved.response

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
  }

  // Seuls les drapeaux présents dans le corps sont écrits.
  const data: { returnsMLEnabled?: boolean; orderTrackingEnabled?: boolean } = {}
  if (parsed.data.returnsMLEnabled !== undefined)     data.returnsMLEnabled     = parsed.data.returnsMLEnabled
  if (parsed.data.orderTrackingEnabled !== undefined) data.orderTrackingEnabled = parsed.data.orderTrackingEnabled

  const vendor = await prisma.vendor.update({
    where:  { id: resolved.vendor.id },
    data,
    select: { returnsMLEnabled: true, orderTrackingEnabled: true },
  })

  log.info('vendor.services_updated', { vendorId: resolved.vendor.id, ...data })

  return NextResponse.json({ services: enabledServices(vendor) })
}
