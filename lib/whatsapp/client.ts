// lib/whatsapp/client.ts — Flowmerce
//
// Envoi de modèles de messages WhatsApp via l'API WhatsApp Cloud de Meta.
//
// Infrastructure commune, comme lib/mailer.ts : ce module ne connaît ni les
// réclamations ni le suivi des commandes, seulement « tel modèle, telle
// langue, tels paramètres, à tel numéro ».
//
// Variables d'environnement (facultatives — absentes, WhatsApp est désactivé
// et rien n'est envoyé, sans empêcher l'application de démarrer) :
//   WHATSAPP_PHONE_NUMBER_ID  identifiant du numéro expéditeur
//   WHATSAPP_ACCESS_TOKEN     token d'accès (utilisateur système en production)
//
// Les envois sont « au mieux » : `sendWhatsAppTemplate` ne lève jamais,
// il renvoie un résultat que l'appelant peut ignorer.

import { env } from '@/lib/env'
import { log } from '@/lib/logger'

const GRAPH_API_URL = 'https://graph.facebook.com/v21.0'
const TIMEOUT_MS    = 10_000

export interface WhatsAppTemplateMessage {
  /** Numéro tel que saisi ; normalisé ici. */
  to:         string
  template:   string
  language:   string
  bodyParams: string[]
}

export type WhatsAppSendResult =
  | { ok: true;  messageId: string }
  | { ok: false; error: string }

/**
 * Numéro au format attendu par Meta : chiffres seuls, indicatif pays inclus.
 * Un numéro local à 10 chiffres commençant par 0 est considéré algérien.
 * Renvoie `null` si le résultat n'a pas la longueur d'un numéro international.
 */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/[\s.\-()]/g, '')

  if (digits.startsWith('+'))       digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  else if (/^0\d{9}$/.test(digits)) digits = `213${digits.slice(1)}`

  // « +213 0555… » : le 0 national saisi après l'indicatif n'existe pas en
  // numérotation internationale — sans ce retrait, le numéro paraît valide
  // (13 chiffres) mais n'atteint personne.
  if (/^2130\d{9}$/.test(digits)) digits = `213${digits.slice(4)}`

  return /^\d{10,15}$/.test(digits) ? digits : null
}

/**
 * Meta refuse dans un paramètre de modèle les sauts de ligne, les tabulations,
 * plus de quatre espaces consécutifs et les valeurs vides.
 */
export function sanitizeTemplateParam(value: string): string {
  const clean = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return clean || '-'
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN)
}

/** Seuls les 4 derniers chiffres apparaissent dans les journaux. */
function maskPhone(phone: string): string {
  return `***${phone.slice(-4)}`
}

export async function sendWhatsAppTemplate(msg: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return { ok: false, error: 'not_configured' }

  const to = normalizeWhatsAppPhone(msg.to)
  if (!to) {
    log.warn('whatsapp.invalid_phone', { template: msg.template })
    return { ok: false, error: 'invalid_phone' }
  }

  const ctx = { template: msg.template, to: maskPhone(to) }

  try {
    const res = await fetch(`${GRAPH_API_URL}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name:     msg.template,
          language: { code: msg.language },
          components: [
            {
              type: 'body',
              parameters: msg.bodyParams.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const data = (await res.json().catch(() => null)) as {
      messages?: { id?: string }[]
      error?:    { code?: number; message?: string }
    } | null

    const messageId = data?.messages?.[0]?.id
    if (res.ok && messageId) {
      log.info('whatsapp.sent', { ...ctx, messageId })
      return { ok: true, messageId }
    }

    const error = data?.error
      ? `meta_${data.error.code}: ${data.error.message}`
      : `http_${res.status}`
    log.error('whatsapp.send_error', { ...ctx, status: res.status, error })
    return { ok: false, error }
  } catch (err) {
    log.error('whatsapp.send_error', { ...ctx, error: String(err) })
    return { ok: false, error: String(err) }
  }
}
