// lib/mailer.ts
//
// Point unique de création du transport email, partagé par les notifications
// client (lib/services/notification.ts) et le formulaire de contact.
//
//   SMTP_HOST défini → serveur SMTP local (Mailpit, développement uniquement) :
//                      les emails y sont capturés et ne partent jamais.
//   sinon            → Gmail (production).

import nodemailer from 'nodemailer'
import { env } from '@/lib/env'

export function createMailTransport() {
  if (env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   env.SMTP_HOST,
      port:   env.SMTP_PORT,
      secure: false,
    })
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  })
}
