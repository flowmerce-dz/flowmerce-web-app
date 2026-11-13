// ─────────────────────────────────────────────────────────────────────────────
// Source de vérité unique pour toutes les chaînes constantes de l'application.
// Importer depuis ici — ne jamais redéfinir localement.
// ─────────────────────────────────────────────────────────────────────────────

// ── Raisons de retour (français — page hébergée + politique avancée) ─────────
export const RETURN_REASONS = [
  'Produit défectueux',
  'Produit contrefait',
  'Produit endommagé livraison',
  "Changement d'avis",
  'Panne après utilisation',
  'Mauvaise taille',
  'Allergie/Réaction',
  'Ne correspond pas',
  'Erreur de commande vendeur',
  'Pièces manquantes',
] as const
export type ReturnReason = (typeof RETURN_REASONS)[number]

// ── Descriptions des raisons (page hébergée + formulaire API) ────────────────
export const RETURN_REASON_DESCRIPTIONS: Record<ReturnReason, string> = {
  'Produit défectueux':          'Le produit est endommagé ou ne fonctionne pas',
  'Produit contrefait':          'Le produit semble être une contrefaçon',
  'Produit endommagé livraison': 'Le produit a été abîmé pendant le transport',
  "Changement d'avis":           "Je n'ai plus besoin de ce produit",
  'Panne après utilisation':     'Le produit est tombé en panne rapidement',
  'Mauvaise taille':             'La taille ou la couleur ne correspond pas',
  'Allergie/Réaction':           'Réaction allergique au produit',
  'Ne correspond pas':           'Le produit reçu est différent de la commande',
  'Erreur de commande vendeur':  'Mauvais produit envoyé par la boutique',
  'Pièces manquantes':           'Des éléments manquent dans le colis',
}

// ── Sous-raisons des motifs de retour ────────────────────────────────────────
// Données ADDITIONNELLES, indépendantes des motifs ci-dessus : elles précisent
// un motif sans jamais le remplacer. `RETURN_REASONS` reste la source de vérité
// du motif principal, et c'est lui seul qui part au modèle ML (Return_Reason) —
// la sous-raison n'entre ni dans le payload ML ni dans `mlInput` (le schéma
// /predict de Flowmerce-ML refuse tout champ inconnu : extra="forbid").
//
// `code` : identifiant technique stable, unique tous motifs confondus. C'est
// lui qui est transmis (`reason_detail`) et stocké (`Claim.returnReasonDetail`).
// Ne jamais renommer un code existant : il vit dans l'historique des retours.
//
// `productRelated` : la sous-raison décrit un problème du produit ou de son
// expédition par la boutique, et non une décision du client. Seules ces
// sous-raisons peuvent révéler un problème collectif sur un produit — et donc
// neutraliser leur effet sur le score de fraude des clients concernés
// (lib/services/product-issues.ts). « Changement d'avis » et les « Autre »,
// trop vagues pour désigner un défaut précis, ne le sont jamais.
export interface ReturnReasonDetail {
  code:           string
  label:          string
  productRelated: boolean
  isOther:        boolean
}

const detail = (code: string, label: string, productRelated = true): ReturnReasonDetail =>
  ({ code, label, productRelated, isOther: false })
const other = (code: string): ReturnReasonDetail =>
  ({ code, label: 'Autre', productRelated: false, isOther: true })

export const RETURN_REASON_DETAILS: Record<ReturnReason, readonly ReturnReasonDetail[]> = {
  'Produit défectueux': [
    detail('NOT_WORKING',          'Ne fonctionne pas'),
    detail('BROKEN_OR_DAMAGED',    'Cassé ou endommagé'),
    detail('MANUFACTURING_DEFECT', 'Défaut de fabrication'),
    other('OTHER_DEFECTIVE'),
  ],
  'Produit contrefait': [
    detail('FAKE_BRAND_LOGO',       'Logo ou marque non authentique'),
    detail('SUSPICIOUS_PACKAGING',  'Emballage ou étiquetage suspect'),
    detail('NOT_MATCHING_ORIGINAL', 'Produit ne correspondant pas à l’original'),
    other('OTHER_COUNTERFEIT'),
  ],
  'Produit endommagé livraison': [
    detail('BROKEN_IN_TRANSIT',    'Produit cassé pendant le transport'),
    detail('SCRATCHED_OR_DAMAGED', 'Produit rayé ou abîmé'),
    detail('PACKAGE_DAMAGED',      'Colis endommagé'),
    other('OTHER_SHIPPING_DAMAGE'),
  ],
  "Changement d'avis": [
    detail('NO_LONGER_WANTED',   'N’en veut plus',                    false),
    detail('ORDERED_BY_MISTAKE', 'Commandé par erreur',               false),
    detail('NOT_AS_EXPECTED',    'Ne correspond pas à ses attentes',  false),
    other('OTHER_CHANGE_OF_MIND'),
  ],
  'Panne après utilisation': [
    detail('STOPPED_WORKING',      'Ne fonctionne plus après utilisation'),
    detail('INTERMITTENT_FAILURE', 'Fonctionnement intermittent'),
    detail('BATTERY_OR_POWER',     'Problème de batterie ou d’alimentation'),
    other('OTHER_FAILURE'),
  ],
  'Mauvaise taille': [
    detail('TOO_SMALL',           'Trop petit'),
    detail('TOO_LARGE',           'Trop grand'),
    detail('SIZE_GUIDE_MISMATCH', 'Ne correspond pas au guide des tailles'),
    other('OTHER_SIZE'),
  ],
  'Allergie/Réaction': [
    detail('SKIN_IRRITATION',               'Irritation de la peau'),
    detail('ALLERGIC_REACTION',             'Réaction allergique'),
    detail('RESPIRATORY_OR_OTHER_REACTION', 'Réaction respiratoire ou autre réaction'),
    other('OTHER_REACTION'),
  ],
  'Ne correspond pas': [
    detail('WRONG_COLOR',            'Mauvaise couleur'),
    detail('WRONG_MODEL',            'Mauvais modèle'),
    detail('DIFFERENT_FROM_LISTING', 'Différent des photos ou de la description'),
    other('OTHER_MISMATCH'),
  ],
  'Erreur de commande vendeur': [
    detail('WRONG_PRODUCT_SENT',  'Mauvais produit envoyé'),
    detail('WRONG_VARIANT_SENT',  'Mauvaise variante envoyée'),
    detail('WRONG_QUANTITY_SENT', 'Mauvaise quantité envoyée'),
    other('OTHER_VENDOR_ERROR'),
  ],
  'Pièces manquantes': [
    detail('MISSING_ACCESSORY', 'Accessoire manquant'),
    detail('MISSING_COMPONENT', 'Composant ou pièce manquante'),
    detail('MISSING_MANUAL',    'Manuel ou document manquant'),
    other('OTHER_MISSING_PART'),
  ],
}

// Index code → (motif, sous-raison), matérialisé une fois au chargement.
const REASON_DETAIL_INDEX: ReadonlyMap<string, { reason: ReturnReason; detail: ReturnReasonDetail }> =
  new Map(
    RETURN_REASONS.flatMap(reason =>
      RETURN_REASON_DETAILS[reason].map(d => [d.code, { reason, detail: d }] as const),
    ),
  )

export function isReturnReason(value: unknown): value is ReturnReason {
  return typeof value === 'string' && (RETURN_REASONS as readonly string[]).includes(value)
}

/** Motif et définition d'une sous-raison à partir de son code, ou null. */
export function findReturnReasonDetail(
  code: string | null | undefined,
): { reason: ReturnReason; detail: ReturnReasonDetail } | null {
  if (!code) return null
  return REASON_DETAIL_INDEX.get(code) ?? null
}

/** Vrai si `code` est une sous-raison du motif `reason`. */
export function isReasonDetailOf(reason: string, code: string): boolean {
  return findReturnReasonDetail(code)?.reason === reason
}

/** Libellé d'affichage d'une sous-raison ; le code brut s'il est inconnu. */
export function formatReturnReasonDetail(code: string | null | undefined): string | null {
  if (!code) return null
  return findReturnReasonDetail(code)?.detail.label ?? code
}

// ── Raisons externes (anglais — API partenaires) ──────────────────────────────
export const EXTERNAL_RETURN_REASONS = [
  'DEFECTIVE', 'WRONG_ITEM', 'DESCRIPTION', 'CHANGE_MIND',
] as const
export type ExternalReturnReason = (typeof EXTERNAL_RETURN_REASONS)[number]

// ── Types de réclamation (enum Prisma ClaimType) ──────────────────────────────
export const CLAIM_TYPES = ['EXCHANGE', 'REFUND', 'REPAIR'] as const
export type ClaimTypeValue = (typeof CLAIM_TYPES)[number]

// Contrat ML : 3 classes. Le modèle ne prédit JAMAIS 'Refund' — c'est ce que
// valide callMLPredict sur la réponse de /predict. Ne pas élargir cette liste.
export const AI_DECISIONS = ['Exchange', 'Repair', 'Reject'] as const
export type AIDecision = (typeof AI_DECISIONS)[number]

export function isAIDecision(value: unknown): value is AIDecision {
  return typeof value === 'string' && (AI_DECISIONS as readonly string[]).includes(value)
}

// Décision effective du vendeur : les 3 classes ML + 'Refund'. Le remboursement
// reste hors du contrat ML (le modèle ne peut pas le recommander) mais le
// vendeur doit pouvoir l'accorder — notamment quand le client l'a demandé
// (claim.type = REFUND) et que le ML a recommandé autre chose.
export const VENDOR_DECISIONS = ['Exchange', 'Repair', 'Refund', 'Reject'] as const
export type VendorDecision = (typeof VENDOR_DECISIONS)[number]

export function isVendorDecision(value: unknown): value is VendorDecision {
  return typeof value === 'string' && (VENDOR_DECISIONS as readonly string[]).includes(value)
}

// Résolution demandée par le client (`ClaimType`) → résolution correspondante
// dans le vocabulaire des décisions. Sert à deux endroits qui doivent rester
// d'accord : l'export vers le dataset ML, et la lecture des résolutions
// autorisées par le vendeur (`ReturnPolicy.acceptedTypes`, qui est une liste de
// `ClaimType`) pour filtrer la recommandation du modèle.
//
// `Reject` n'y figure volontairement pas : ce n'est pas une résolution qu'un
// client demande ni qu'un vendeur « offre », c'est un refus.
export const TYPE_TO_RESOLUTION = {
  EXCHANGE: 'Exchange',
  REFUND:   'Refund',
  REPAIR:   'Repair',
} as const satisfies Record<ClaimTypeValue, VendorDecision>

// ── Statuts de réclamation (enum Prisma ClaimStatus) ─────────────────────────
export const CLAIM_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'IN_PROGRESS'] as const
export type ClaimStatusValue = (typeof CLAIM_STATUSES)[number]

// ── Types de document (enum Prisma DocumentType) ──────────────────────────────
export const DOCUMENT_TYPES = [
  'ID_CARD', 'BUSINESS_REGISTRATION', 'ADDRESS_PROOF',
  'TAX_CERTIFICATE', 'BANK_DETAILS', 'OTHER',
] as const
export type DocumentTypeValue = (typeof DOCUMENT_TYPES)[number]

// ── Catégories produit (politique vendeur avancée) ────────────────────────────
export const VENDOR_CATEGORIES = [
  'Electronics', 'Appliances', 'Clothing', 'Shoes',
  'Beauty', 'Books', 'Toys', 'Sports', 'Home', 'Food',
] as const
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]

// ── Moyens de paiement ────────────────────────────────────────────────────────
// `value` = valeur envoyée au ML (champ Payment_Method), `label` = affichage FR.
// La wilaya n'a volontairement pas de liste figée : elle est transmise par la
// boutique (session de retour ou réponses du formulaire) et reprise telle quelle.
export const PAYMENT_METHODS = [
  'Cash on Delivery', 'Card', 'CCP', 'Bank Transfer',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  'Cash on Delivery': 'Paiement à la livraison',
  'Card':             'Carte bancaire (CIB / Edahabia)',
  'CCP':              'Versement CCP',
  'Bank Transfer':    'Virement bancaire',
}

// ── Labels UI ─────────────────────────────────────────────────────────────────
export const CLAIM_TYPE_LABELS: Record<ClaimTypeValue, string> = {
  EXCHANGE: 'Échange',
  REFUND:   'Remboursement',
  REPAIR:   'Réparation',
}

export const CLAIM_TYPE_DESCRIPTIONS: Record<ClaimTypeValue, string> = {
  EXCHANGE: 'Je souhaite un produit de remplacement',
  REFUND:   'Je souhaite être remboursé(e)',
  REPAIR:   'Je souhaite que le produit soit réparé',
}

// Le type d'un claim peut être null tant que le ML n'a pas répondu (la décision
// du type est désormais déléguée au ML). Helper UI pour afficher proprement.
export function formatClaimType(type: ClaimTypeValue | string | null | undefined): string {
  if (!type) return 'En attente IA'
  return CLAIM_TYPE_LABELS[type as ClaimTypeValue] ?? type
}

// Le genre est transmis librement par la boutique (champ Customer_Gender du
// dataset ML, pas de liste figée côté API). On traduit les valeurs courantes
// pour l'affichage et on restitue la valeur brute pour tout le reste.
// 'Unknown' est la valeur de repli des routes d'ingestion : elle signifie
// « non transmis », donc rien à afficher.
const GENDER_LABELS: Record<string, string> = {
  male:   'Homme',
  m:      'Homme',
  homme:  'Homme',
  female: 'Femme',
  f:      'Femme',
  femme:  'Femme',
  other:  'Autre',
  autre:  'Autre',
}

export function formatCustomerGender(gender: unknown): string | null {
  if (typeof gender !== 'string') return null
  const raw = gender.trim()
  if (!raw || raw.toLowerCase() === 'unknown') return null
  return GENDER_LABELS[raw.toLowerCase()] ?? raw
}

export const AI_DECISION_LABELS: Record<AIDecision, string> = {
  Exchange: 'Échange',
  Repair:   'Réparation',
  Reject:   'Refus',
}

export const VENDOR_DECISION_LABELS: Record<VendorDecision, string> = {
  Exchange: 'Échange',
  Repair:   'Réparation',
  Refund:   'Remboursement',
  Reject:   'Refus',
}

export const CLAIM_STATUS_LABELS: Record<ClaimStatusValue, string> = {
  PENDING:     'En attente',
  APPROVED:    'Approuvée',
  REJECTED:    'Rejetée',
  IN_PROGRESS: 'En cours',
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentTypeValue, string> = {
  ID_CARD:               "Carte d'identité nationale",
  BUSINESS_REGISTRATION: 'Registre du commerce',
  ADDRESS_PROOF:         'Justificatif de domicile',
  TAX_CERTIFICATE:       'Attestation fiscale',
  BANK_DETAILS:          'Coordonnées bancaires',
  OTHER:                 'Autre document',
}

export const VENDOR_STATUS_LABELS: Record<string, string> = {
  PENDING:             'En attente',
  APPROVED:            'Approuvé',
  REJECTED:            'Rejeté',
  DOCUMENTS_REQUESTED: 'Documents demandés',
}
