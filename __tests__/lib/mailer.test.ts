import { describe, it, expect, beforeEach, vi } from 'vitest'

const createTransport = vi.fn(() => ({ sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport } }))

const mockEnv: Record<string, unknown> = {}
vi.mock('@/lib/env', () => ({ env: mockEnv }))

describe('createMailTransport', () => {
  beforeEach(() => {
    createTransport.mockClear()
    for (const k of Object.keys(mockEnv)) delete mockEnv[k]
    Object.assign(mockEnv, {
      GMAIL_USER: 'flowmerce@gmail.com',
      GMAIL_APP_PASSWORD: 'x'.repeat(16),
      SMTP_PORT: 1025,
    })
  })

  it('utilise Gmail quand SMTP_HOST est absent (production)', async () => {
    const { createMailTransport } = await import('@/lib/mailer')
    createMailTransport()
    expect(createTransport).toHaveBeenCalledWith({
      service: 'gmail',
      auth: { user: 'flowmerce@gmail.com', pass: 'x'.repeat(16) },
    })
  })

  it('utilise le SMTP local sans identifiants Gmail quand SMTP_HOST est défini', async () => {
    mockEnv.SMTP_HOST = 'mailpit'
    const { createMailTransport } = await import('@/lib/mailer')
    createMailTransport()
    expect(createTransport).toHaveBeenCalledWith({
      host: 'mailpit',
      port: 1025,
      secure: false,
    })
  })
})
