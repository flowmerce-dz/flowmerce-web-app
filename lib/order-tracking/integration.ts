// lib/order-tracking/integration.ts — Flowmerce · Suivi des commandes
//
// Modes d'intégration : la façon dont les changements de statut d'une boutique
// arrivent chez Flowmerce.
//
//   WEBHOOK    la boutique pousse chaque changement (POST /api/v1/webhooks/orders) ;
//   POLLING    Flowmerce interroge une URL de la boutique à intervalle régulier ;
//   CONNECTOR  Flowmerce lit les statuts chez un service tiers, avec les
//              identifiants de la boutique.
//
// Quel que soit le mode, tout ce qui suit la réception est identique :
// normalisation du statut, idempotence, chronologie, file de notifications.
// Un seul mode est actif par boutique — deux sources simultanées décriraient
// le même changement sous deux identifiants et préviendraient le client deux
// fois.
//
// Ce fichier ne dépend d'aucun module serveur : il est importé tel quel par
// le tableau de bord.

import type { TrackingIntegrationMode } from '@prisma/client'

export const INTEGRATION_MODES = ['WEBHOOK', 'POLLING', 'CONNECTOR'] as const

export type IntegrationMode = (typeof INTEGRATION_MODES)[number]

// Garde de compilation : la liste et l'enum Prisma doivent rester identiques.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _modesMatchPrisma: Same<IntegrationMode, TrackingIntegrationMode> = true
void _modesMatchPrisma

export function isIntegrationMode(value: unknown): value is IntegrationMode {
  return typeof value === 'string' && (INTEGRATION_MODES as readonly string[]).includes(value)
}

/** Modes où c'est Flowmerce qui va chercher les statuts. */
export function isPullMode(mode: IntegrationMode): boolean {
  return mode === 'POLLING' || mode === 'CONNECTOR'
}

export const INTEGRATION_MODE_LABELS: Record<IntegrationMode, { name: string; summary: string }> = {
  WEBHOOK: {
    name:    'Webhook',
    summary: 'Votre boutique envoie chaque changement de statut à Flowmerce, à l’instant où il a lieu.',
  },
  POLLING: {
    name:    'Polling',
    summary: 'Flowmerce interroge l’API de votre boutique à intervalle régulier pour y lire les changements.',
  },
  CONNECTOR: {
    name:    'Connecteur',
    summary: 'Flowmerce lit les statuts chez un service que vous utilisez déjà. Aucun développement.',
  },
}
