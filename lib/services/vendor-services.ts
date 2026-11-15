// lib/services/vendor-services.ts — Flowmerce
//
// Activation des services par boutique.
//
// Flowmerce propose deux services indépendants :
//
//   returnsML      gestion des réclamations et analyse des retours (ML) ;
//   orderTracking  suivi des commandes et notifications aux clients.
//
// Une boutique active l'un, l'autre, les deux ou aucun. Chaque service a son
// propre drapeau sur `Vendor` et sa propre configuration (`ReturnPolicy` pour
// l'un, `OrderTrackingConfig` pour l'autre). Ce fichier est le seul endroit qui
// lit ces drapeaux : aucune règle n'y relie un service à l'autre, et il ne doit
// jamais en apparaître une.

import { NextResponse } from 'next/server'

export const SERVICE_KEYS = ['returnsML', 'orderTracking'] as const
export type ServiceKey = (typeof SERVICE_KEYS)[number]

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  returnsML:     'Retours-ML',
  orderTracking: 'Suivi des commandes',
}

/** Drapeaux tels que portés par `Vendor`. */
export interface ServiceFlags {
  returnsMLEnabled?:     boolean | null
  orderTrackingEnabled?: boolean | null
}

export type EnabledServices = Record<ServiceKey, boolean>

/**
 * Un service est-il activé pour cette boutique ?
 *
 * Les deux drapeaux n'ont pas le même défaut, comme en base :
 *   · Retours-ML est actif tant qu'il n'a pas été désactivé — c'était le
 *     comportement implicite avant l'introduction des services ;
 *   · le suivi n'est actif que s'il a été explicitement activé.
 */
export function isServiceEnabled(vendor: ServiceFlags, service: ServiceKey): boolean {
  return service === 'returnsML'
    ? vendor.returnsMLEnabled !== false
    : vendor.orderTrackingEnabled === true
}

export function enabledServices(vendor: ServiceFlags): EnabledServices {
  return {
    returnsML:     isServiceEnabled(vendor, 'returnsML'),
    orderTracking: isServiceEnabled(vendor, 'orderTracking'),
  }
}

/** Réponse d'API quand la boutique appelle un service qu'elle n'a pas activé. */
export function serviceDisabledResponse(service: ServiceKey): NextResponse {
  return NextResponse.json(
    {
      error:   `Le service « ${SERVICE_LABELS[service]} » n'est pas activé pour cette boutique`,
      code:    'SERVICE_DISABLED',
      service,
    },
    { status: 403 },
  )
}
