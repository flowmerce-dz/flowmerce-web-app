// lib/order-tracking/templates.ts — Flowmerce · Suivi des commandes
//
// Messages envoyés aux clients lors d'un changement de statut.
//
// Un message existe par statut et par langue (français, arabe). La boutique
// peut remplacer l'objet et le texte de chacun ; ce qu'elle ne personnalise pas
// retombe sur les modèles par défaut ci-dessous.
//
// Variables disponibles, entre doubles accolades :
//   {{customer_name}}  {{order_id}}  {{status}}  {{tracking_number}}
//   {{carrier}}  {{tracking_url}}  {{shop_name}}
//
// Le rendu est indépendant du canal : il produit un objet, un texte brut et un
// HTML d'e-mail. Un futur canal (WhatsApp) réutilise le texte brut.

import {
  MAPPABLE_STATUSES,
  ORDER_STATUS_LABELS,
  isLanguage,
  isMappableStatus,
  type Language,
  type MappableStatus,
} from './statuses'

export const TEMPLATE_VARIABLES = [
  'customer_name',
  'order_id',
  'status',
  'tracking_number',
  'carrier',
  'tracking_url',
  'shop_name',
] as const

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

export const TEMPLATE_VARIABLE_LABELS: Record<TemplateVariable, string> = {
  customer_name:   'Nom du client',
  order_id:        'Identifiant de commande',
  status:          'Statut',
  tracking_number: 'Numéro de suivi',
  carrier:         'Transporteur',
  tracking_url:    'Lien de suivi',
  shop_name:       'Nom de la boutique',
}

export const MAX_SUBJECT_LENGTH = 150
export const MAX_BODY_LENGTH    = 2000

export interface MessageTemplate {
  subject: string
  body:    string
}

export type StoreTemplates = Partial<
  Record<MappableStatus, Partial<Record<Language, MessageTemplate>>>
>

// ─────────────────────────────────────────────────────────────
// Modèles par défaut
// ─────────────────────────────────────────────────────────────

const FR_BODY: Record<MappableStatus, string> = {
  PENDING:          'Nous avons bien reçu votre commande {{order_id}}. Elle sera traitée dans les meilleurs délais.',
  CONFIRMED:        'Votre commande {{order_id}} est confirmée. Nous commençons sa préparation.',
  PREPARING:        'Votre commande {{order_id}} est en cours de préparation.',
  SHIPPED:          'Votre commande {{order_id}} a été expédiée.',
  OUT_FOR_DELIVERY: 'Votre commande {{order_id}} est en cours de livraison. Merci de rester joignable.',
  DELIVERED:        'Votre commande {{order_id}} a été livrée. Merci pour votre confiance.',
  FAILED_DELIVERY:  'La livraison de votre commande {{order_id}} n’a pas pu aboutir. Nous vous recontacterons pour convenir d’un nouveau passage.',
  RETURNED:         'Votre commande {{order_id}} nous a été retournée.',
  CANCELLED:        'Votre commande {{order_id}} a été annulée.',
}

const AR_BODY: Record<MappableStatus, string> = {
  PENDING:          'لقد استلمنا طلبكم {{order_id}} وستتم معالجته في أقرب وقت.',
  CONFIRMED:        'تم تأكيد طلبكم {{order_id}} وبدأنا في تحضيره.',
  PREPARING:        'طلبكم {{order_id}} قيد التحضير.',
  SHIPPED:          'تم شحن طلبكم {{order_id}}.',
  OUT_FOR_DELIVERY: 'طلبكم {{order_id}} في طريقه إليكم. يرجى البقاء على اتصال.',
  DELIVERED:        'تم توصيل طلبكم {{order_id}}. شكراً لثقتكم.',
  FAILED_DELIVERY:  'تعذّر توصيل طلبكم {{order_id}}. سنتواصل معكم لتحديد موعد جديد.',
  RETURNED:         'تم إرجاع طلبكم {{order_id}} إلينا.',
  CANCELLED:        'تم إلغاء طلبكم {{order_id}}.',
}

export function defaultTemplate(status: MappableStatus, language: Language): MessageTemplate {
  return language === 'ar'
    ? {
        subject: `{{shop_name}} — الطلب {{order_id}}: {{status}}`,
        body:    `مرحباً {{customer_name}}،\n\n${AR_BODY[status]}`,
      }
    : {
        subject: `{{shop_name}} — Commande {{order_id}} : {{status}}`,
        body:    `Bonjour {{customer_name}},\n\n${FR_BODY[status]}`,
      }
}

// ─────────────────────────────────────────────────────────────
// Lecture des modèles de la boutique
// ─────────────────────────────────────────────────────────────

/**
 * Relit la colonne JSON `messageTemplates` : ne retient que les entrées bien
 * formées. La colonne vient de la base mais reste du JSON libre — rien n'y est
 * supposé valide.
 */
export function readStoreTemplates(value: unknown): StoreTemplates {
  const out: StoreTemplates = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out

  for (const [status, byLanguage] of Object.entries(value as Record<string, unknown>)) {
    if (!isMappableStatus(status) || !byLanguage || typeof byLanguage !== 'object') continue

    for (const [language, tpl] of Object.entries(byLanguage as Record<string, unknown>)) {
      if (!isLanguage(language) || !tpl || typeof tpl !== 'object') continue
      const { subject, body } = tpl as Record<string, unknown>
      if (typeof subject !== 'string' || typeof body !== 'string') continue
      if (!subject.trim() || !body.trim()) continue

      out[status] = {
        ...out[status],
        [language]: {
          subject: subject.slice(0, MAX_SUBJECT_LENGTH),
          body:    body.slice(0, MAX_BODY_LENGTH),
        },
      }
    }
  }
  return out
}

/** Modèles effectifs — personnalisés ou par défaut — pour tous les statuts. */
export function effectiveTemplates(
  store: StoreTemplates,
): Record<MappableStatus, Record<Language, MessageTemplate & { custom: boolean }>> {
  return Object.fromEntries(
    MAPPABLE_STATUSES.map((status) => [
      status,
      {
        fr: { ...(store[status]?.fr ?? defaultTemplate(status, 'fr')), custom: Boolean(store[status]?.fr) },
        ar: { ...(store[status]?.ar ?? defaultTemplate(status, 'ar')), custom: Boolean(store[status]?.ar) },
      },
    ]),
  ) as Record<MappableStatus, Record<Language, MessageTemplate & { custom: boolean }>>
}

// ─────────────────────────────────────────────────────────────
// Rendu
// ─────────────────────────────────────────────────────────────

export interface MessageContext {
  status:          MappableStatus
  language:        Language
  shopName:        string
  orderId:         string
  customerName?:   string | null
  trackingNumber?: string | null
  carrier?:        string | null
  trackingUrl?:    string | null
}

export interface RenderedMessage {
  subject: string
  text:    string
  html:    string
}

const FALLBACK_NAME: Record<Language, string> = { fr: 'cher client', ar: 'عميلنا العزيز' }

const UI: Record<Language, Record<'order' | 'status' | 'tracking' | 'carrier' | 'track' | 'footer', string>> = {
  fr: {
    order:    'Commande',
    status:   'Statut',
    tracking: 'Numéro de suivi',
    carrier:  'Transporteur',
    track:    'Suivre mon colis',
    footer:   'Ceci est un e-mail automatique — merci de ne pas répondre à cette adresse.',
  },
  ar: {
    order:    'الطلب',
    status:   'الحالة',
    tracking: 'رقم التتبع',
    carrier:  'شركة التوصيل',
    track:    'تتبع الطرد',
    footer:   'هذه رسالة آلية، يرجى عدم الرد عليها.',
  },
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function variables(ctx: MessageContext): Record<TemplateVariable, string> {
  return {
    customer_name:   ctx.customerName?.trim() || FALLBACK_NAME[ctx.language],
    order_id:        ctx.orderId,
    status:          ORDER_STATUS_LABELS[ctx.status][ctx.language],
    tracking_number: ctx.trackingNumber ?? '',
    carrier:         ctx.carrier ?? '',
    tracking_url:    ctx.trackingUrl ?? '',
    shop_name:       ctx.shopName,
  }
}

/** Remplace les variables connues ; une variable inconnue est laissée telle quelle. */
function fill(template: string, vars: Record<TemplateVariable, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) =>
    name in vars ? vars[name as TemplateVariable] : match,
  )
}

export function renderMessage(ctx: MessageContext, store: StoreTemplates = {}): RenderedMessage {
  const template = store[ctx.status]?.[ctx.language] ?? defaultTemplate(ctx.status, ctx.language)
  const vars     = variables(ctx)
  const ui       = UI[ctx.language]

  // Un objet d'e-mail tient sur une ligne : les sauts de ligne y ouvriraient
  // la porte à l'injection d'en-têtes.
  const subject = fill(template.subject, vars).replace(/[\r\n]+/g, ' ').trim()
  const body    = fill(template.body, vars).trim()

  const details: [string, string][] = [
    [ui.order, ctx.orderId],
    [ui.status, vars.status],
  ]
  if (ctx.trackingNumber) details.push([ui.tracking, ctx.trackingNumber])
  if (ctx.carrier)        details.push([ui.carrier, ctx.carrier])

  const text = [
    body,
    '',
    ...details.map(([label, value]) => `${label} : ${value}`),
    ...(ctx.trackingUrl ? ['', `${ui.track} : ${ctx.trackingUrl}`] : []),
  ].join('\n')

  return { subject, text, html: buildHtml(ctx, body, details, ui) }
}

// Tout ce qui vient de la boutique ou du client — modèle personnalisé compris —
// est échappé avant d'entrer dans le HTML.
function buildHtml(
  ctx:     MessageContext,
  body:    string,
  details: [string, string][],
  ui:      (typeof UI)[Language],
): string {
  const rtl   = ctx.language === 'ar'
  const align = rtl ? 'right' : 'left'

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) =>
      `<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.7;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`,
    )
    .join('')

  const rows = details
    .map(([label, value], i) => {
      const border = i < details.length - 1 ? 'border-bottom:1px solid #e2e8f0;' : ''
      return `<tr>
        <td style="padding:11px 16px;color:#94a3b8;font-weight:500;width:40%;${border}">${escapeHtml(label)}</td>
        <td style="padding:11px 16px;color:#0f172a;font-weight:600;${border}">${escapeHtml(value)}</td>
      </tr>`
    })
    .join('')

  const button = ctx.trackingUrl
    ? `<table cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr>
         <td style="background:#4f46e5;border-radius:10px;">
           <a href="${escapeHtml(ctx.trackingUrl)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(ui.track)}</a>
         </td>
       </tr></table>`
    : ''

  return `<!DOCTYPE html>
<html lang="${ctx.language}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
  <tr><td style="padding:0 0 20px;text-align:center;">
    <p style="margin:0;font-size:17px;font-weight:700;color:#0f172a;">${escapeHtml(ctx.shopName)}</p>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:16px;box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="height:4px;background:#4f46e5;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:32px 36px;text-align:${align};">
        ${paragraphs}
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;font-size:13px;text-align:${align};">
          ${rows}
        </table>
        ${button}
      </td></tr>
      <tr><td style="padding:16px 36px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">${escapeHtml(ui.footer)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}
