import { NextResponse } from 'next/server'
import { prisma } from './prisma'
import { hashApiKey } from './utils'
import { log } from './logger'
import {
  isServiceEnabled,
  serviceDisabledResponse,
  type ServiceKey,
} from './services/vendor-services'

async function _findKey(hash: string) {
  return prisma.apiKey.findUnique({
    where:   { key: hash },
    include: { vendor: { include: { returnPolicy: true } } },
  })
}

type KeyRecord = NonNullable<Awaited<ReturnType<typeof _findKey>>>

export type ApiKeyResult =
  | { ok: true;  keyRecord: KeyRecord }
  | { ok: false; response: NextResponse }

interface ValidateOptions {
  /**
   * Service que la route appelée sert. La clé API identifie la boutique, pas
   * un service : une même clé donne accès aux services que la boutique a
   * activés, et à eux seuls.
   *
   * Défaut `returnsML` : toutes les routes antérieures à l'introduction des
   * services appartiennent à Retours-ML. Le webhook de suivi passe
   * explicitement `orderTracking`, et n'est donc jamais conditionné à
   * Retours-ML ni à l'existence d'une ReturnPolicy.
   */
  service?: ServiceKey
}

export async function validateApiKey(
  rawKey: string | null,
  { service = 'returnsML' }: ValidateOptions = {},
): Promise<ApiKeyResult> {
  if (!rawKey) {
    return { ok: false, response: NextResponse.json({ error: 'Clé API manquante' }, { status: 401 }) }
  }

  let keyRecord: KeyRecord | null
  try {
    keyRecord = await _findKey(hashApiKey(rawKey))
  } catch (err) {
    log.error('api-key-auth.db_error', { err: err instanceof Error ? err.message : String(err) })
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Service temporairement indisponible' },
        { status: 503, headers: { 'Retry-After': '30' } },
      ),
    }
  }

  if (!keyRecord || !keyRecord.isActive) {
    return { ok: false, response: NextResponse.json({ error: 'Clé API invalide ou révoquée' }, { status: 401 }) }
  }
  if (keyRecord.vendor.status !== 'APPROVED') {
    return { ok: false, response: NextResponse.json({ error: 'Compte vendeur non approuvé' }, { status: 403 }) }
  }
  if (!isServiceEnabled(keyRecord.vendor, service)) {
    return { ok: false, response: serviceDisabledResponse(service) }
  }

  return { ok: true, keyRecord }
}
