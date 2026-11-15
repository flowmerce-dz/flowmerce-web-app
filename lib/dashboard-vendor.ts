// lib/dashboard-vendor.ts — Flowmerce
//
// Boutique de l'utilisateur connecté, pour les routes d'API du tableau de bord.
//
// La session est lue par la route elle-même (`getSessionFromRequest`) ; cette
// fonction ne fait que retrouver la boutique et appliquer la règle d'accès déjà
// en vigueur sur les clés API et la politique de retour : compte approuvé, ou
// administrateur disposant d'un profil vendeur.

import { NextResponse } from 'next/server'
import type { Vendor } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type DashboardVendorResult =
  | { ok: true;  vendor: Vendor }
  | { ok: false; response: NextResponse }

export async function requireDashboardVendor(
  user: { id: string; role?: string | null },
): Promise<DashboardVendorResult> {
  const vendor = await prisma.vendor.findUnique({ where: { userId: user.id } })

  if (!vendor) {
    return { ok: false, response: NextResponse.json({ error: 'Vendeur introuvable' }, { status: 404 }) }
  }
  if (vendor.status !== 'APPROVED' && user.role !== 'ADMIN') {
    return { ok: false, response: NextResponse.json({ error: 'Compte non approuvé' }, { status: 403 }) }
  }
  return { ok: true, vendor }
}
