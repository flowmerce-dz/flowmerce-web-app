// lib/order-tracking/store-statuses.ts — Flowmerce · Suivi des commandes
//
// Statuts propres à chaque boutique.
//
// Toutes les boutiques n'ont pas les mêmes statuts de commande : l'une s'arrête
// à « Livrée », une autre distingue « En cours de livraison » et « Échec de
// livraison ». Proposer à un vendeur des statuts que sa boutique n'émettra
// jamais ne lui sert à rien.
//
// Chaque boutique déclare donc la liste de ses statuts, sous ses propres
// libellés (PUT /api/v1/order-statuses). Flowmerce ne code en dur la liste
// d'aucune boutique : la même règle vaut pour toutes.
//
//   · liste déclarée → le tableau de bord ne présente que les statuts
//     normalisés auxquels ces libellés correspondent, nommés comme la boutique
//     les nomme ;
//   · rien de déclaré → tous les statuts standards sont proposés.
//
// Un statut déjà reçu par webhook reste présenté même s'il manque à la
// déclaration : une liste devenue incomplète ne doit pas masquer un statut que
// la boutique envoie réellement.
//
// La déclaration ne change rien au traitement des webhooks : un statut non
// déclaré est accepté et normalisé comme les autres.

import {
  MAPPABLE_STATUSES,
  ORDER_STATUS_LABELS,
  normalizeStatusKey,
  resolveStatus,
  type MappableStatus,
  type StoreMapping,
  type TrackingStatus,
} from './statuses'

export const MAX_STORE_STATUSES    = 50
export const MAX_STATUS_LABEL_SIZE = 100

/**
 * Nettoie une liste déclarée : espaces retirés, libellés vides ou illisibles
 * écartés, doublons (à la casse et aux accents près) fusionnés sur le premier.
 */
export function sanitizeDeclaredStatuses(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = raw.trim()
    const key   = normalizeStatusKey(label)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

export interface DeclaredStatus {
  label:  string
  /** Statut normalisé du libellé ; `UNMAPPED` s'il reste à associer. */
  status: TrackingStatus
}

export interface StoreStatusView {
  /** La boutique a-t-elle déclaré ses statuts ? */
  declared: boolean
  items:    DeclaredStatus[]
  /** Statuts normalisés à présenter au vendeur, dans l'ordre standard. */
  activeStatuses: MappableStatus[]
  /** Nom de chaque statut tel que la boutique le nomme. */
  labels: Record<MappableStatus, string>
}

export function buildStoreStatusView(
  declaredLabels: readonly string[],
  mappings:       readonly StoreMapping[],
  seenStatuses:   readonly TrackingStatus[] = [],
): StoreStatusView {
  const items: DeclaredStatus[] = declaredLabels.map((label) => ({
    label,
    status: resolveStatus(label, mappings),
  }))
  const declared = items.length > 0

  const inUse = new Set<TrackingStatus>([...items.map((i) => i.status), ...seenStatuses])
  const activeStatuses = declared
    ? MAPPABLE_STATUSES.filter((s) => inUse.has(s))
    : [...MAPPABLE_STATUSES]

  const labels = Object.fromEntries(
    MAPPABLE_STATUSES.map((status) => {
      const own = items.filter((i) => i.status === status).map((i) => i.label)
      return [status, own.length ? own.join(' / ') : ORDER_STATUS_LABELS[status].fr]
    }),
  ) as Record<MappableStatus, string>

  return { declared, items, activeStatuses, labels }
}
