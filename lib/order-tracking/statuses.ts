// lib/order-tracking/statuses.ts — Flowmerce · Suivi des commandes
//
// Statuts normalisés et correspondance des statuts transmis par les boutiques.
//
// Le statut reçu dans un webhook n'est jamais utilisé tel quel : c'est une
// chaîne libre, propre à chaque boutique (« Expédiée », « shipped », « تم
// الشحن »…). Il est ramené à l'un des statuts ci-dessous par `resolveStatus`,
// d'abord selon les correspondances de la boutique, puis selon les
// correspondances par défaut. Sans correspondance, il devient `UNMAPPED` et
// reste visible du vendeur, qui peut alors le rattacher à un statut.
//
// Ce fichier ne dépend d'aucun module serveur : il est importé tel quel par
// le tableau de bord.

import type { OrderStatus } from '@prisma/client'

export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED_DELIVERY',
  'RETURNED',
  'CANCELLED',
  'UNMAPPED',
] as const

export type TrackingStatus = (typeof ORDER_STATUSES)[number]

// Garde de compilation : la liste ci-dessus et l'enum Prisma `OrderStatus`
// doivent rester identiques. Un statut ajouté d'un seul côté casse le build.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _statusesMatchPrisma: Same<TrackingStatus, OrderStatus> = true
void _statusesMatchPrisma

/** Statuts qu'un vendeur peut choisir comme cible d'une correspondance. */
export const MAPPABLE_STATUSES = ORDER_STATUSES.filter(
  (s): s is Exclude<TrackingStatus, 'UNMAPPED'> => s !== 'UNMAPPED',
)

export type MappableStatus = (typeof MAPPABLE_STATUSES)[number]

export function isMappableStatus(value: unknown): value is MappableStatus {
  return typeof value === 'string' && (MAPPABLE_STATUSES as readonly string[]).includes(value)
}

export const LANGUAGES = ['fr', 'ar'] as const
export type Language = (typeof LANGUAGES)[number]

export function isLanguage(value: unknown): value is Language {
  return value === 'fr' || value === 'ar'
}

export const ORDER_STATUS_LABELS: Record<TrackingStatus, Record<Language, string>> = {
  PENDING:          { fr: 'En attente',            ar: 'قيد الانتظار' },
  CONFIRMED:        { fr: 'Confirmée',             ar: 'تم التأكيد' },
  PREPARING:        { fr: 'En préparation',        ar: 'قيد التحضير' },
  SHIPPED:          { fr: 'Expédiée',              ar: 'تم الشحن' },
  OUT_FOR_DELIVERY: { fr: 'En cours de livraison', ar: 'قيد التوصيل' },
  DELIVERED:        { fr: 'Livrée',                ar: 'تم التوصيل' },
  FAILED_DELIVERY:  { fr: 'Échec de livraison',    ar: 'تعذّر التوصيل' },
  RETURNED:         { fr: 'Retournée',             ar: 'تم الإرجاع' },
  CANCELLED:        { fr: 'Annulée',               ar: 'ملغاة' },
  UNMAPPED:         { fr: 'Non reconnu',           ar: 'غير معروف' },
}

/**
 * Clé de comparaison d'un statut : minuscules, sans accents ni signes
 * diacritiques, ponctuation et séparateurs ramenés à une espace.
 * « Expédiée », « EXPEDIEE » et « expédiée  » donnent la même clé ;
 * « OUT_FOR_DELIVERY » et « out for delivery » aussi.
 */
export function normalizeStatusKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Correspondances par défaut. Elles évitent à une boutique de tout déclarer
// pour les libellés courants ; une correspondance propre à la boutique prime
// toujours sur celles-ci.
const DEFAULT_LABELS: Record<MappableStatus, string[]> = {
  PENDING: ['pending', 'en attente', 'nouvelle', 'new', 'قيد الانتظار'],
  CONFIRMED: ['confirmed', 'confirmee', 'confirme', 'validee', 'تم التأكيد'],
  PREPARING: [
    'preparing', 'processing', 'en preparation', 'en cours de preparation',
    'قيد التحضير',
  ],
  SHIPPED: ['shipped', 'expediee', 'expedie', 'envoyee', 'تم الشحن'],
  OUT_FOR_DELIVERY: [
    'out for delivery', 'en cours de livraison', 'en livraison', 'قيد التوصيل',
  ],
  DELIVERED: ['delivered', 'livree', 'livre', 'تم التوصيل'],
  FAILED_DELIVERY: [
    'failed delivery', 'delivery failed', 'echec de livraison',
    'livraison echouee', 'تعذر التوصيل',
  ],
  RETURNED: ['returned', 'retournee', 'retourne', 'تم الإرجاع'],
  CANCELLED: ['cancelled', 'canceled', 'annulee', 'annule', 'ملغاة'],
}

export const DEFAULT_STATUS_MAPPINGS: ReadonlyMap<string, MappableStatus> = new Map(
  MAPPABLE_STATUSES.flatMap((status) =>
    DEFAULT_LABELS[status].map((label) => [normalizeStatusKey(label), status] as const),
  ),
)

export interface StoreMapping {
  normalizedKey: string
  status:        TrackingStatus
}

/**
 * Ramène un statut reçu à un statut normalisé.
 * Ordre : correspondance de la boutique, puis correspondance par défaut,
 * sinon `UNMAPPED`. Une correspondance de boutique vers `UNMAPPED` n'existe
 * pas (cf. `isMappableStatus` à l'écriture) : elle est ignorée si elle
 * apparaît.
 */
export function resolveStatus(raw: string, storeMappings: readonly StoreMapping[]): TrackingStatus {
  const key = normalizeStatusKey(raw)
  if (!key) return 'UNMAPPED'

  const custom = storeMappings.find((m) => m.normalizedKey === key)
  if (custom && custom.status !== 'UNMAPPED') return custom.status

  return DEFAULT_STATUS_MAPPINGS.get(key) ?? 'UNMAPPED'
}
