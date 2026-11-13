// lib/claim-transitions.ts — Flowmerce
//
// Machine à états des réclamations (audit RedStone RS-01).
//
//   PENDING ──► IN_PROGRESS ──► APPROVED
//      │             └────────► REJECTED
//      ├──────────────────────► APPROVED
//      └──────────────────────► REJECTED
//
// APPROVED et REJECTED sont TERMINAUX : une décision rendue au client n'est
// plus réécrite. Avant cette règle, un même PATCH pouvait faire alterner une
// réclamation entre approuvée et refusée, en écrasant `processedAt` et en
// renvoyant à chaque fois une notification contradictoire au client.
//
// Ce module est pur : la route et les services s'en servent avant d'écrire, et
// les écritures restent conditionnées au statut lu (verrou optimiste).

import {
  TYPE_TO_RESOLUTION,
  type ClaimStatusValue,
  type ClaimTypeValue,
  type VendorDecision,
} from '@/lib/constants'

const TRANSITIONS: Record<ClaimStatusValue, readonly ClaimStatusValue[]> = {
  PENDING:     ['IN_PROGRESS', 'APPROVED', 'REJECTED'],
  IN_PROGRESS: ['APPROVED', 'REJECTED'],
  APPROVED:    [],
  REJECTED:    [],
}

export function isTerminalStatus(status: ClaimStatusValue): boolean {
  return TRANSITIONS[status].length === 0
}

export function canTransition(from: ClaimStatusValue, to: ClaimStatusValue): boolean {
  return TRANSITIONS[from].includes(to)
}

/**
 * Résolutions qu'un vendeur peut accorder : celles de sa politique de retour
 * (toutes si elle n'en restreint aucune, même convention que
 * `checkReturnPolicy`), plus celle que le client a demandée — un vendeur peut
 * toujours accepter la demande telle quelle.
 */
export function grantableResolutions(
  acceptedTypes: readonly ClaimTypeValue[] | null | undefined,
  requestedType: ClaimTypeValue | null | undefined,
): VendorDecision[] {
  const types: ClaimTypeValue[] = acceptedTypes?.length
    ? [...acceptedTypes]
    : (Object.keys(TYPE_TO_RESOLUTION) as ClaimTypeValue[])
  if (requestedType && !types.includes(requestedType)) types.push(requestedType)
  return types.map(t => TYPE_TO_RESOLUTION[t])
}

export type DecisionError =
  | { code: 'CLAIM_ALREADY_DECIDED';  status: 409; message: string }
  | { code: 'INVALID_TRANSITION';     status: 409; message: string }
  | { code: 'DECISION_STATUS_MISMATCH'; status: 400; message: string }
  | { code: 'RESOLUTION_REQUIRED';    status: 400; message: string }
  | { code: 'RESOLUTION_NOT_ALLOWED'; status: 400; message: string }

/**
 * Vérifie une décision vendeur avant écriture. Retourne `null` si elle est
 * acceptable, sinon l'erreur à renvoyer telle quelle au client HTTP.
 */
export function checkVendorDecision(input: {
  from:            ClaimStatusValue
  to:              ClaimStatusValue
  /** Résolution choisie par le vendeur, si la requête en désigne une. */
  decision?:       VendorDecision
  /** Résolution déjà portée par la réclamation (reco ML ou décision passée). */
  currentDecision: string | null
  requestedType:   ClaimTypeValue | null
  acceptedTypes:   readonly ClaimTypeValue[] | null | undefined
}): DecisionError | null {
  const { from, to, decision } = input

  if (isTerminalStatus(from)) {
    return {
      code: 'CLAIM_ALREADY_DECIDED', status: 409,
      message: 'Cette réclamation a déjà été traitée : sa décision ne peut plus être modifiée.',
    }
  }
  if (!canTransition(from, to)) {
    return {
      code: 'INVALID_TRANSITION', status: 409,
      message: `Passage de ${from} à ${to} impossible.`,
    }
  }

  if (to === 'IN_PROGRESS' && decision !== undefined) {
    return {
      code: 'DECISION_STATUS_MISMATCH', status: 400,
      message: 'Une résolution ne peut être choisie qu’en approuvant ou en refusant la réclamation.',
    }
  }

  if (to === 'REJECTED' && decision !== undefined && decision !== 'Reject') {
    return {
      code: 'DECISION_STATUS_MISMATCH', status: 400,
      message: 'Un refus ne peut pas porter une autre résolution que « Reject ».',
    }
  }

  if (to === 'APPROVED') {
    if (decision === 'Reject') {
      return {
        code: 'DECISION_STATUS_MISMATCH', status: 400,
        message: 'Une réclamation approuvée ne peut pas porter la résolution « Reject ».',
      }
    }
    const effective = decision ?? input.currentDecision
    if (!effective || effective === 'Reject') {
      return {
        code: 'RESOLUTION_REQUIRED', status: 400,
        message: 'Choisissez la résolution accordée au client pour approuver la réclamation.',
      }
    }
    // Seule une résolution choisie maintenant est contrôlée : celle déjà portée
    // par la réclamation a été filtrée par la politique au moment de la reco.
    if (decision !== undefined) {
      const allowed = grantableResolutions(input.acceptedTypes, input.requestedType)
      if (!allowed.includes(decision)) {
        return {
          code: 'RESOLUTION_NOT_ALLOWED', status: 400,
          message: `Cette résolution n’est ni demandée par le client ni prévue par votre politique de retour. Résolutions possibles : ${allowed.join(', ')}.`,
        }
      }
    }
  }

  return null
}

// ── Correction d'une décision rendue (administrateur seul) ──────────────────
//
// Les statuts APPROVED et REJECTED restent terminaux pour les vendeurs. Une
// erreur de décision se corrige par ce circuit distinct (recommandation
// RedStone RS-01) : réservé à l'admin, motif obligatoire, inscrit dans
// l'historique comme une correction.

export const AMENDMENT_REASON_MIN = 10
export const AMENDMENT_REASON_MAX = 1000

export type AmendmentError =
  | { code: 'CLAIM_NOT_DECIDED';      status: 409; message: string }
  | { code: 'AMENDMENT_NO_CHANGE';    status: 400; message: string }
  | { code: 'AMENDMENT_REASON_REQUIRED'; status: 400; message: string }
  | { code: 'RESOLUTION_NOT_ALLOWED'; status: 400; message: string }

/**
 * Vérifie une correction. Retourne le nouveau statut, déduit de la résolution
 * (Reject → REJECTED, sinon APPROVED), ou l'erreur à renvoyer.
 */
export function checkAdminAmendment(input: {
  from:            ClaimStatusValue
  decision:        VendorDecision
  currentDecision: string | null
  reason:          string
  requestedType:   ClaimTypeValue | null
  acceptedTypes:   readonly ClaimTypeValue[] | null | undefined
}): { ok: true; to: 'APPROVED' | 'REJECTED' } | { ok: false; error: AmendmentError } {
  const { from, decision } = input

  if (!isTerminalStatus(from)) {
    return { ok: false, error: {
      code: 'CLAIM_NOT_DECIDED', status: 409,
      message: 'Cette réclamation n’a pas encore de décision : traitez-la normalement.',
    } }
  }

  const reason = input.reason.trim()
  if (reason.length < AMENDMENT_REASON_MIN || reason.length > AMENDMENT_REASON_MAX) {
    return { ok: false, error: {
      code: 'AMENDMENT_REASON_REQUIRED', status: 400,
      message: `Le motif de la correction est obligatoire (${AMENDMENT_REASON_MIN} à ${AMENDMENT_REASON_MAX} caractères).`,
    } }
  }

  const to = decision === 'Reject' ? 'REJECTED' : 'APPROVED'
  if (to === from && decision === input.currentDecision) {
    return { ok: false, error: {
      code: 'AMENDMENT_NO_CHANGE', status: 400,
      message: 'La décision choisie est déjà celle de la réclamation.',
    } }
  }

  if (decision !== 'Reject') {
    const allowed = grantableResolutions(input.acceptedTypes, input.requestedType)
    if (!allowed.includes(decision)) {
      return { ok: false, error: {
        code: 'RESOLUTION_NOT_ALLOWED', status: 400,
        message: `Cette résolution n’est ni demandée par le client ni prévue par la politique de retour du vendeur. Résolutions possibles : ${allowed.join(', ')}.`,
      } }
    }
  }

  return { ok: true, to }
}
