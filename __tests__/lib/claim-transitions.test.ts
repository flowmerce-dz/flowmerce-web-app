import { describe, expect, it } from 'vitest'
import {
  canTransition,
  checkVendorDecision,
  grantableResolutions,
  isTerminalStatus,
} from '@/lib/claim-transitions'

const base = {
  currentDecision: 'Exchange' as string | null,
  requestedType:   'EXCHANGE' as const,
  acceptedTypes:   ['EXCHANGE', 'REPAIR'] as ('EXCHANGE' | 'REPAIR' | 'REFUND')[],
}

describe('machine à états des réclamations', () => {
  it('APPROVED et REJECTED sont terminaux', () => {
    expect(isTerminalStatus('APPROVED')).toBe(true)
    expect(isTerminalStatus('REJECTED')).toBe(true)
    expect(isTerminalStatus('PENDING')).toBe(false)
    expect(isTerminalStatus('IN_PROGRESS')).toBe(false)
  })

  it('autorise seulement les transitions vers l’avant', () => {
    expect(canTransition('PENDING', 'IN_PROGRESS')).toBe(true)
    expect(canTransition('PENDING', 'APPROVED')).toBe(true)
    expect(canTransition('IN_PROGRESS', 'REJECTED')).toBe(true)
    expect(canTransition('IN_PROGRESS', 'IN_PROGRESS')).toBe(false)
    expect(canTransition('APPROVED', 'REJECTED')).toBe(false)
    expect(canTransition('REJECTED', 'APPROVED')).toBe(false)
  })
})

describe('checkVendorDecision', () => {
  it('refuse de réécrire une décision rendue (scénario RedStone RS-01)', () => {
    expect(checkVendorDecision({ ...base, from: 'APPROVED', to: 'REJECTED', decision: 'Reject' }))
      .toMatchObject({ code: 'CLAIM_ALREADY_DECIDED', status: 409 })
    expect(checkVendorDecision({ ...base, from: 'REJECTED', to: 'APPROVED', decision: 'Repair' }))
      .toMatchObject({ code: 'CLAIM_ALREADY_DECIDED', status: 409 })
  })

  it('accepte une approbation cohérente', () => {
    expect(checkVendorDecision({ ...base, from: 'PENDING', to: 'APPROVED', decision: 'Repair' })).toBeNull()
    expect(checkVendorDecision({ ...base, from: 'IN_PROGRESS', to: 'APPROVED' })).toBeNull()
  })

  it('refuse un statut et une résolution contradictoires', () => {
    expect(checkVendorDecision({ ...base, from: 'PENDING', to: 'APPROVED', decision: 'Reject' }))
      .toMatchObject({ code: 'DECISION_STATUS_MISMATCH' })
    expect(checkVendorDecision({ ...base, from: 'PENDING', to: 'REJECTED', decision: 'Exchange' }))
      .toMatchObject({ code: 'DECISION_STATUS_MISMATCH' })
    expect(checkVendorDecision({ ...base, from: 'PENDING', to: 'IN_PROGRESS', decision: 'Exchange' }))
      .toMatchObject({ code: 'DECISION_STATUS_MISMATCH' })
  })

  it('exige une résolution pour approuver', () => {
    expect(checkVendorDecision({ ...base, currentDecision: null, from: 'PENDING', to: 'APPROVED' }))
      .toMatchObject({ code: 'RESOLUTION_REQUIRED' })
    expect(checkVendorDecision({ ...base, currentDecision: 'Reject', from: 'PENDING', to: 'APPROVED' }))
      .toMatchObject({ code: 'RESOLUTION_REQUIRED' })
  })

  it('refuse une résolution ni demandée ni prévue par la politique', () => {
    expect(checkVendorDecision({ ...base, from: 'PENDING', to: 'APPROVED', decision: 'Refund' }))
      .toMatchObject({ code: 'RESOLUTION_NOT_ALLOWED', status: 400 })
  })

  it('accepte toujours la résolution demandée par le client', () => {
    expect(checkVendorDecision({
      ...base, requestedType: 'REFUND', from: 'PENDING', to: 'APPROVED', decision: 'Refund',
    })).toBeNull()
  })
})

describe('grantableResolutions', () => {
  it('sans restriction de politique, toutes les résolutions sont possibles', () => {
    expect(grantableResolutions([], null).sort()).toEqual(['Exchange', 'Refund', 'Repair'])
    expect(grantableResolutions(null, 'EXCHANGE').sort()).toEqual(['Exchange', 'Refund', 'Repair'])
  })

  it('ajoute la demande du client aux résolutions de la politique', () => {
    expect(grantableResolutions(['EXCHANGE'], 'REFUND').sort()).toEqual(['Exchange', 'Refund'])
  })
})
