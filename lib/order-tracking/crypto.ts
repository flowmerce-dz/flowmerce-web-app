// lib/order-tracking/crypto.ts — Flowmerce · Suivi des commandes
//
// Secret webhook d'une boutique et signature des requêtes.
//
// ── Signature ────────────────────────────────────────────────────────────────
//   signature = HMAC-SHA256(secret, `${timestamp}.${eventId}.${corps brut}`)
//
// en hexadécimal, transmise dans `X-Flowmerce-Signature` (préfixe `sha256=`
// accepté). Le timestamp et l'identifiant d'événement entrent dans le calcul :
// rejouer un corps valide avec un autre identifiant ou une autre date invalide
// la signature. La comparaison se fait en temps constant.
//
// ── Stockage du secret ───────────────────────────────────────────────────────
// Une clé API se vérifie par son empreinte ; un secret HMAC, non : il faut la
// valeur en clair pour recalculer la signature. Il est donc chiffré au repos en
// AES-256-GCM, avec une clé dérivée de `ORDER_TRACKING_SECRET_KEY`. Le clair
// n'est rendu au vendeur qu'à la génération, jamais ensuite.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { env } from '@/lib/env'

const SECRET_PREFIX = 'whsec'
const ENC_VERSION   = 'v1'
const HKDF_INFO     = 'flowmerce:order-tracking:webhook-secret:v1'

/** Écart toléré entre l'horloge de la boutique et la nôtre, en secondes. */
export const TIMESTAMP_TOLERANCE_SEC = 300

export class SecretStorageError extends Error {}

// ─────────────────────────────────────────────────────────────
// Secret
// ─────────────────────────────────────────────────────────────

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}_${randomBytes(32).toString('base64url')}`
}

/** Début du secret, affichable au vendeur pour l'identifier. */
export function webhookSecretPrefix(secret: string): string {
  return secret.slice(0, 10)
}

/** Le chiffrement des secrets est-il disponible sur ce déploiement ? */
export function isSecretStorageConfigured(): boolean {
  return Boolean(env.ORDER_TRACKING_SECRET_KEY)
}

function encryptionKey(): Buffer {
  const master = env.ORDER_TRACKING_SECRET_KEY
  if (!master) {
    throw new SecretStorageError('ORDER_TRACKING_SECRET_KEY est absent')
  }
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), HKDF_INFO, 32))
}

export function encryptSecret(plain: string): string {
  const iv     = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const data   = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return [ENC_VERSION, iv, tag, data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

export function decryptSecret(encrypted: string): string {
  const [version, iv, tag, data] = encrypted.split('.')
  if (version !== ENC_VERSION || !iv || !tag || !data) {
    throw new SecretStorageError('Format de secret chiffré inconnu')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch (err) {
    if (err instanceof SecretStorageError) throw err
    // Clé de chiffrement changée, ou valeur altérée en base.
    throw new SecretStorageError('Secret webhook indéchiffrable')
  }
}

// ─────────────────────────────────────────────────────────────
// Signature
// ─────────────────────────────────────────────────────────────

export function computeSignature(
  secret:    string,
  timestamp: string,
  eventId:   string,
  rawBody:   string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${eventId}.${rawBody}`, 'utf8')
    .digest('hex')
}

export function verifySignature(
  secret:    string,
  provided:  string,
  timestamp: string,
  eventId:   string,
  rawBody:   string,
): boolean {
  const hex = provided.trim().replace(/^sha256=/i, '')
  // 32 octets en hexadécimal. Tout autre format est refusé avant comparaison :
  // `timingSafeEqual` exige deux tampons de même longueur.
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false

  const expected = Buffer.from(computeSignature(secret, timestamp, eventId, rawBody), 'hex')
  const received = Buffer.from(hex, 'hex')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

// ─────────────────────────────────────────────────────────────
// Horodatage — protection contre le rejeu
// ─────────────────────────────────────────────────────────────

/**
 * Lit `X-Flowmerce-Timestamp` : secondes Unix (millisecondes acceptées).
 * Retourne null si la valeur n'est pas un entier positif.
 */
export function parseTimestamp(header: string): Date | null {
  const value = header.trim()
  if (!/^\d{9,14}$/.test(value)) return null
  const n = Number(value)
  return new Date(value.length >= 12 ? n : n * 1000)
}

export function isTimestampFresh(sentAt: Date, now: Date = new Date()): boolean {
  return Math.abs(now.getTime() - sentAt.getTime()) <= TIMESTAMP_TOLERANCE_SEC * 1000
}
