// lib/services/claim-history.ts — Flowmerce
//
// Écriture de l'historique des décisions (table ClaimDecisionEvent, en ajout
// seul). Toujours appelée dans la MÊME transaction que le changement de statut :
// une décision sans trace, ou une trace sans décision, est impossible.

import type { Prisma } from '@prisma/client'
import type { ClaimStatusValue } from '@/lib/constants'

export type DecisionActorType = 'VENDOR' | 'ADMIN' | 'SYSTEM'
export type DecisionOrigin =
  | 'dashboard' | 'auto_on_create' | 'validation_mode' | 'policy'
  | 'admin_amendment' | 'vendor_amendment'

export interface DecisionEventInput {
  claimId:          string
  previousStatus:   ClaimStatusValue | null
  newStatus:        ClaimStatusValue
  previousDecision: string | null
  newDecision:      string | null
  actorType:        DecisionActorType
  actor:            string
  origin:           DecisionOrigin
  reason?:          string | null
}

export function decisionEventData(event: DecisionEventInput) {
  return {
    claimId:          event.claimId,
    previousStatus:   event.previousStatus,
    newStatus:        event.newStatus,
    previousDecision: event.previousDecision,
    newDecision:      event.newDecision,
    actorType:        event.actorType,
    actor:            event.actor,
    origin:           event.origin,
    reason:           event.reason?.trim() || null,
  }
}

export function recordDecisionEvent(
  tx: Prisma.TransactionClient,
  event: DecisionEventInput,
) {
  return tx.claimDecisionEvent.create({ data: decisionEventData(event) })
}
