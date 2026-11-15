// Secret webhook et signature des requêtes (lib/order-tracking/crypto.ts).

import { describe, it, expect, vi } from 'vitest'

const mockEnv = vi.hoisted(
  () => ({ ORDER_TRACKING_SECRET_KEY: 'k'.repeat(40) }) as Record<string, unknown>,
)
vi.mock('@/lib/env', () => ({ env: mockEnv }))

import {
  SecretStorageError,
  computeSignature,
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  isSecretStorageConfigured,
  isTimestampFresh,
  parseTimestamp,
  verifySignature,
  webhookSecretPrefix,
} from '@/lib/order-tracking/crypto'

const SECRET = 'whsec_test_secret'
const TS     = '1794676800'
const EVENT  = 'evt_1'
const BODY   = '{"order_id":"CABA-10452","status":"Expédiée"}'

describe('signature HMAC-SHA256', () => {
  const signature = computeSignature(SECRET, TS, EVENT, BODY)

  it('accepte une signature correcte, avec ou sans préfixe sha256=', () => {
    expect(verifySignature(SECRET, signature, TS, EVENT, BODY)).toBe(true)
    expect(verifySignature(SECRET, `sha256=${signature}`, TS, EVENT, BODY)).toBe(true)
  })

  it('refuse un corps, un identifiant d’événement ou un horodatage modifié', () => {
    expect(verifySignature(SECRET, signature, TS, EVENT, BODY + ' ')).toBe(false)
    expect(verifySignature(SECRET, signature, TS, 'evt_2', BODY)).toBe(false)
    expect(verifySignature(SECRET, signature, '1794676801', EVENT, BODY)).toBe(false)
  })

  it('refuse une signature calculée avec un autre secret', () => {
    const other = computeSignature('whsec_autre', TS, EVENT, BODY)
    expect(verifySignature(SECRET, other, TS, EVENT, BODY)).toBe(false)
  })

  it('refuse une signature mal formée sans lever d’erreur', () => {
    for (const bad of ['', 'sha256=', 'abc', signature.slice(0, 63), `${signature}00`, 'z'.repeat(64)]) {
      expect(verifySignature(SECRET, bad, TS, EVENT, BODY)).toBe(false)
    }
  })
})

describe('horodatage', () => {
  it('lit des secondes ou des millisecondes Unix', () => {
    expect(parseTimestamp('1794676800')?.getTime()).toBe(1794676800_000)
    expect(parseTimestamp('1794676800000')?.getTime()).toBe(1794676800_000)
  })

  it('refuse toute autre valeur', () => {
    for (const bad of ['', 'abc', '-5', '2026-11-14T17:20:00Z', '12.5']) {
      expect(parseTimestamp(bad)).toBeNull()
    }
  })

  it('tolère 5 minutes d’écart, dans les deux sens, pas davantage', () => {
    const now = new Date('2026-11-14T12:00:00Z')
    expect(isTimestampFresh(new Date('2026-11-14T11:55:30Z'), now)).toBe(true)
    expect(isTimestampFresh(new Date('2026-11-14T12:04:30Z'), now)).toBe(true)
    expect(isTimestampFresh(new Date('2026-11-14T11:54:00Z'), now)).toBe(false)
    expect(isTimestampFresh(new Date('2026-11-14T12:06:00Z'), now)).toBe(false)
  })
})

describe('stockage du secret', () => {
  it('génère des secrets distincts, préfixés whsec_', () => {
    const a = generateWebhookSecret()
    const b = generateWebhookSecret()
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(webhookSecretPrefix(a)).toBe(a.slice(0, 10))
  })

  it('chiffre puis déchiffre, sans jamais stocker le clair', () => {
    const secret    = generateWebhookSecret()
    const encrypted = encryptSecret(secret)
    expect(encrypted).not.toContain(secret)
    expect(decryptSecret(encrypted)).toBe(secret)
    // Vecteur d'initialisation aléatoire : deux chiffrements diffèrent.
    expect(encryptSecret(secret)).not.toBe(encrypted)
  })

  it('refuse une valeur altérée ou une autre clé de chiffrement', () => {
    const encrypted = encryptSecret('whsec_x')
    const [v, iv, tag, data] = encrypted.split('.')
    const tampered = [v, iv, tag, data.slice(0, -2) + (data.endsWith('AA') ? 'BB' : 'AA')].join('.')
    expect(() => decryptSecret(tampered)).toThrow(SecretStorageError)
    expect(() => decryptSecret('inconnu')).toThrow(SecretStorageError)

    mockEnv.ORDER_TRACKING_SECRET_KEY = 'z'.repeat(40)
    expect(() => decryptSecret(encrypted)).toThrow(SecretStorageError)
    mockEnv.ORDER_TRACKING_SECRET_KEY = 'k'.repeat(40)
  })

  it('signale l’absence de clé de chiffrement sans rien chiffrer', () => {
    delete mockEnv.ORDER_TRACKING_SECRET_KEY
    expect(isSecretStorageConfigured()).toBe(false)
    expect(() => encryptSecret('whsec_x')).toThrow(SecretStorageError)
    mockEnv.ORDER_TRACKING_SECRET_KEY = 'k'.repeat(40)
    expect(isSecretStorageConfigured()).toBe(true)
  })
})
