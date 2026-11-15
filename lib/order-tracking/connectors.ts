// lib/order-tracking/connectors.ts — Flowmerce · Suivi des commandes
//
// Sources que Flowmerce interroge lui-même, et catalogue des connecteurs.
//
// Une source rend des pages d'événements dans le format du webhook
// (cf. payload.ts). Le polling en est une — l'URL de la boutique, cf.
// polling.ts. Un connecteur en est une autre : il traduit l'API d'un service
// tiers (transporteur, plateforme e-commerce) vers ce même format. La boucle
// de synchronisation (pull.ts) ne connaît que l'interface ci-dessous.
//
// Ajouter un connecteur = l'ajouter à `CONNECTORS` avec `isAvailable` à true,
// ses champs d'identifiants et sa fonction `pull`. Rien d'autre ne change : ni
// la boucle, ni l'ingestion, ni les notifications.
//
// Aucun connecteur n'est branché pour l'instant. Ceux du catalogue sont
// annoncés comme à venir et ne peuvent pas être sélectionnés.

export interface PullInput {
  /** Date à partir de laquelle lire : dernier changement vu, ou branchement. */
  since:  Date
  /** Curseur opaque rendu par la page précédente, s'il y en a un. */
  cursor: string | null
  now:    Date
}

export interface PullPage {
  /** Événements bruts, au format du corps du webhook (+ `event_id` facultatif). */
  events:     unknown[]
  nextCursor: string | null
  hasMore:    boolean
}

/** Échec d'une lecture, avec un message lisible par le vendeur. */
export class PullError extends Error {
  constructor(
    message: string,
    /** Statut HTTP rendu par la source ; 0 si elle n'a pas répondu. */
    readonly httpStatus: number = 0,
  ) {
    super(message)
  }
}

export type ConnectorFamily = 'carrier' | 'platform'

export interface TrackingConnector {
  id:          string
  name:        string
  family:      ConnectorFamily
  description: string
  /** Identifiants demandés au vendeur. Stockés chiffrés, jamais renvoyés. */
  credentialFields: readonly { key: string; label: string }[]
  isAvailable(): boolean
  pull(credentials: Record<string, string>, input: PullInput): Promise<PullPage>
}

function comingSoon(
  def: Pick<TrackingConnector, 'id' | 'name' | 'family' | 'description'>,
): TrackingConnector {
  return {
    ...def,
    credentialFields: [],
    isAvailable: () => false,
    pull: async () => {
      throw new PullError('Ce connecteur n’est pas encore disponible')
    },
  }
}

export const CONNECTORS: readonly TrackingConnector[] = [
  comingSoon({
    id:          'yalidine',
    name:        'Yalidine',
    family:      'carrier',
    description: 'Statut de vos colis lu directement chez le transporteur.',
  }),
  comingSoon({
    id:          'shopify',
    name:        'Shopify',
    family:      'platform',
    description: 'Statut de vos commandes lu dans votre boutique Shopify.',
  }),
  comingSoon({
    id:          'woocommerce',
    name:        'WooCommerce',
    family:      'platform',
    description: 'Statut de vos commandes lu dans votre boutique WooCommerce.',
  }),
]

export function getConnector(id: string | null | undefined): TrackingConnector | null {
  return CONNECTORS.find((c) => c.id === id) ?? null
}

export function listConnectors() {
  return CONNECTORS.map((c) => ({
    id:          c.id,
    name:        c.name,
    family:      c.family,
    description: c.description,
    available:   c.isAvailable(),
    credentialFields: c.credentialFields,
  }))
}
