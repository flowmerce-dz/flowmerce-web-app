// lib/whatsapp/claim-templates.ts — Flowmerce · Retours-ML
//
// Paramètres des modèles WhatsApp des réclamations, tels qu'approuvés chez
// Meta. Chaque modèle contient le même message en arabe, anglais et français,
// dans cet ordre : 9 variables, trois par langue.
//
//   nouvelle_reclamation (vendeur)
//     {{1}} {{4}} {{7}}  numéro de commande
//     {{2}} {{5}} {{8}}  nom du client
//     {{3}} {{6}} {{9}}  motif — AR / EN / FR
//
//   decision_reclamation (client)
//     {{1}} {{4}} {{7}}  prénom du client
//     {{2}} {{5}} {{8}}  numéro de commande
//     {{3}} {{6}} {{9}}  décision — AR / EN / FR
//
// Modifier un modèle chez Meta (ordre ou nombre de variables, langue) impose
// de modifier ce fichier : un écart fait refuser chaque envoi.

import type { ClaimTypeValue, ReturnReason, VendorDecision } from '@/lib/constants'
import { sanitizeTemplateParam } from './client'

export const NEW_CLAIM_TEMPLATE      = { name: 'nouvelle_reclamation', language: 'en' } as const
export const CLAIM_DECISION_TEMPLATE = { name: 'decision_reclamation', language: 'fr' } as const

interface Label { ar: string; en: string; fr: string }

const REASON_LABELS: Record<ReturnReason, { ar: string; en: string }> = {
  'Produit défectueux':          { ar: 'منتج معيب',              en: 'Defective product' },
  'Produit contrefait':          { ar: 'منتج مقلد',              en: 'Counterfeit product' },
  'Produit endommagé livraison': { ar: 'منتج تالف أثناء التوصيل', en: 'Damaged during delivery' },
  "Changement d'avis":           { ar: 'تغيير الرأي',            en: 'Change of mind' },
  'Panne après utilisation':     { ar: 'عطل بعد الاستعمال',      en: 'Broke down after use' },
  'Mauvaise taille':             { ar: 'مقاس غير مناسب',         en: 'Wrong size' },
  'Allergie/Réaction':           { ar: 'حساسية أو تفاعل',        en: 'Allergy/Reaction' },
  'Ne correspond pas':           { ar: 'غير مطابق للطلب',        en: 'Not as described' },
  'Erreur de commande vendeur':  { ar: 'خطأ من البائع في الطلب', en: 'Seller order error' },
  'Pièces manquantes':           { ar: 'قطع ناقصة',              en: 'Missing parts' },
}

const DECISION_LABELS: Record<VendorDecision, Label> = {
  Exchange: { ar: 'استبدال',        en: 'Exchange', fr: 'Échange' },
  Repair:   { ar: 'إصلاح',          en: 'Repair',   fr: 'Réparation' },
  Refund:   { ar: 'استرداد المبلغ', en: 'Refund',   fr: 'Remboursement' },
  Reject:   { ar: 'مرفوض',          en: 'Rejected', fr: 'Refusée' },
}

const APPROVED_LABEL: Label = { ar: 'مقبول', en: 'Approved', fr: 'Acceptée' }

const TYPE_LABELS: Record<ClaimTypeValue, Label> = {
  EXCHANGE: DECISION_LABELS.Exchange,
  REFUND:   DECISION_LABELS.Refund,
  REPAIR:   DECISION_LABELS.Repair,
}

const UNSPECIFIED_LABEL: Label = { ar: 'غير محدد', en: 'Not specified', fr: 'Non précisé' }

function reasonLabel(reason: string | null | undefined, type: ClaimTypeValue | null | undefined): Label {
  if (reason?.trim()) {
    const known = REASON_LABELS[reason as ReturnReason]
    return known ? { ...known, fr: reason } : { ar: reason, en: reason, fr: reason }
  }
  return (type && TYPE_LABELS[type]) || UNSPECIFIED_LABEL
}

/** Trois blocs identiques, un par langue, dans l'ordre AR / EN / FR. */
function trilingual(a: string, b: string, label: Label): string[] {
  return [a, b, label.ar, a, b, label.en, a, b, label.fr].map(sanitizeTemplateParam)
}

export function buildNewClaimParams(c: {
  orderId:       string
  customerName:  string
  returnReason?: string | null
  type?:         ClaimTypeValue | null
}): string[] {
  return trilingual(c.orderId, c.customerName, reasonLabel(c.returnReason, c.type))
}

export function buildDecisionParams(c: {
  customerName: string
  orderId:      string
  status:       'APPROVED' | 'REJECTED'
  decision?:    VendorDecision | null
}): string[] {
  const firstName = c.customerName.trim().split(/\s+/)[0] ?? ''
  // Le statut fait foi : un refus est toujours annoncé comme tel, même si la
  // décision portée est la recommandation du ML (ex. Exchange) restée sur la
  // réclamation ; une approbation ne peut pas s'annoncer « refusée ».
  const label =
    c.status === 'REJECTED'
      ? DECISION_LABELS.Reject
      : c.decision && c.decision !== 'Reject'
        ? DECISION_LABELS[c.decision]
        : APPROVED_LABEL
  return trilingual(firstName, c.orderId, label)
}
