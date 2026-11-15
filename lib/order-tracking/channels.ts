// lib/order-tracking/channels.ts — Flowmerce · Suivi des commandes
//
// Canaux d'envoi des notifications de suivi.
//
// Le worker ne connaît que cette interface : il rend le message, puis le confie
// au canal du travail. Ajouter WhatsApp revient à fournir un `ChannelSender`
// de plus et à le déclarer `isAvailable` — ni le webhook, ni la file, ni le
// worker n'ont à changer.
//
// Aujourd'hui seul l'e-mail est branché. Il partage le transport SMTP de la
// plateforme (lib/mailer.ts) — infrastructure commune, pas une dépendance
// envers Retours-ML : rien ici n'importe ses notifications ni ses modèles.

import type { NotificationChannel } from '@prisma/client'
import { env } from '@/lib/env'
import { createMailTransport } from '@/lib/mailer'
import type { RenderedMessage } from './templates'

export interface OutboundNotification {
  recipient: string
  shopName:  string
  message:   RenderedMessage
}

export interface ChannelSender {
  channel: NotificationChannel
  label:   string
  /** Un fournisseur est-il branché pour ce canal ? */
  isAvailable(): boolean
  /** Le destinataire est-il exploitable par ce canal ? */
  acceptsRecipient(recipient: string): boolean
  /** Envoie le message. Rejette en cas d'échec : le worker décide de la relance. */
  send(notification: OutboundNotification): Promise<void>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const emailSender: ChannelSender = {
  channel: 'EMAIL',
  label:   'E-mail',
  isAvailable: () => true,
  acceptsRecipient: (recipient) => EMAIL_RE.test(recipient),

  async send({ recipient, shopName, message }) {
    // Le nom affiché est celui de la boutique : c'est elle que le client
    // connaît. Guillemets et retours à la ligne retirés du nom d'expéditeur.
    const fromName = shopName.replace(/["\r\n]/g, ' ').trim() || 'Flowmerce'

    await createMailTransport().sendMail({
      from:    `"${fromName}" <${env.GMAIL_USER}>`,
      replyTo: `no-reply <${env.GMAIL_USER}>`,
      to:      recipient,
      subject: message.subject,
      text:    message.text,
      html:    message.html,
    })
  },
}

const whatsappSender: ChannelSender = {
  channel: 'WHATSAPP',
  label:   'WhatsApp',
  // Aucun fournisseur WhatsApp n'est intégré à Flowmerce pour l'instant.
  isAvailable: () => false,
  acceptsRecipient: (recipient) => /^\+?\d{8,15}$/.test(recipient.replace(/[\s.-]/g, '')),
  async send() {
    throw new Error('Canal WhatsApp non disponible')
  },
}

export const CHANNELS: Record<NotificationChannel, ChannelSender> = {
  EMAIL:    emailSender,
  WHATSAPP: whatsappSender,
}

export function getChannel(channel: NotificationChannel): ChannelSender {
  return CHANNELS[channel]
}

/** Canaux présentés au vendeur, avec leur disponibilité. */
export function listChannels(): { channel: NotificationChannel; label: string; available: boolean }[] {
  return Object.values(CHANNELS).map((c) => ({
    channel:   c.channel,
    label:     c.label,
    available: c.isAvailable(),
  }))
}
