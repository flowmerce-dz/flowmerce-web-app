import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockEnv: Record<string, unknown> = {}
vi.mock('@/lib/env', () => ({ env: mockEnv }))

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('@/lib/logger', () => ({ log: mockLog }))

const TOKEN = 'secret-token-value'

function configure() {
  Object.assign(mockEnv, {
    WHATSAPP_PHONE_NUMBER_ID: '1481661498359966',
    WHATSAPP_ACCESS_TOKEN:    TOKEN,
  })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(mockEnv)) delete mockEnv[k]
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeWhatsAppPhone', () => {
  it.each([
    ['0555 12 34 56',      '213555123456'],
    ['+213 555-12-34-56',  '213555123456'],
    ['00213555123456',     '213555123456'],
    ['(0770) 11.22.33',    '213770112233'],
    ['+1 555 155 1482',    '15551551482'],
    ['213555123456',       '213555123456'],
    // Indicatif suivi du 0 national, saisie fréquente en Algérie.
    ['+213 0555 12 34 56', '213555123456'],
    ['00213 0555123456',   '213555123456'],
    ['+213 (0)555123456',  '213555123456'],
  ])('%s → %s', async (raw, expected) => {
    const { normalizeWhatsAppPhone } = await import('@/lib/whatsapp/client')
    expect(normalizeWhatsAppPhone(raw)).toBe(expected)
  })

  it.each([['123'], [''], ['   '], ['abc'], ['+1234567890123456']])(
    'rejette %j',
    async (raw) => {
      const { normalizeWhatsAppPhone } = await import('@/lib/whatsapp/client')
      expect(normalizeWhatsAppPhone(raw)).toBeNull()
    },
  )

  it('rejette null et undefined', async () => {
    const { normalizeWhatsAppPhone } = await import('@/lib/whatsapp/client')
    expect(normalizeWhatsAppPhone(null)).toBeNull()
    expect(normalizeWhatsAppPhone(undefined)).toBeNull()
  })
})

describe('sanitizeTemplateParam', () => {
  it('remplace les sauts de ligne par un espace', async () => {
    const { sanitizeTemplateParam } = await import('@/lib/whatsapp/client')
    expect(sanitizeTemplateParam('Karim\nB')).toBe('Karim B')
    expect(sanitizeTemplateParam('Karim\r\nB')).toBe('Karim B')
  })

  it('réduit tabulations et espaces multiples', async () => {
    const { sanitizeTemplateParam } = await import('@/lib/whatsapp/client')
    expect(sanitizeTemplateParam('a\t\tb     c')).toBe('a b c')
  })

  it('remplace une valeur vide par un tiret (Meta refuse les paramètres vides)', async () => {
    const { sanitizeTemplateParam } = await import('@/lib/whatsapp/client')
    expect(sanitizeTemplateParam('   ')).toBe('-')
    expect(sanitizeTemplateParam('')).toBe('-')
  })
})

describe('isWhatsAppConfigured', () => {
  it('faux sans variables', async () => {
    const { isWhatsAppConfigured } = await import('@/lib/whatsapp/client')
    expect(isWhatsAppConfigured()).toBe(false)
  })

  it('faux si le token manque', async () => {
    mockEnv.WHATSAPP_PHONE_NUMBER_ID = '1'
    const { isWhatsAppConfigured } = await import('@/lib/whatsapp/client')
    expect(isWhatsAppConfigured()).toBe(false)
  })

  it("faux si l'ID du numéro manque", async () => {
    mockEnv.WHATSAPP_ACCESS_TOKEN = TOKEN
    const { isWhatsAppConfigured } = await import('@/lib/whatsapp/client')
    expect(isWhatsAppConfigured()).toBe(false)
  })

  it('vrai avec les deux', async () => {
    configure()
    const { isWhatsAppConfigured } = await import('@/lib/whatsapp/client')
    expect(isWhatsAppConfigured()).toBe(true)
  })
})

describe('sendWhatsAppTemplate', () => {
  const message = {
    to:         '0555 12 34 56',
    template:   'decision_reclamation',
    language:   'fr',
    bodyParams: ['Karim', 'CMD-10234', 'استبدال'],
  }

  it("n'appelle pas Meta quand WhatsApp n'est pas configuré", async () => {
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/client')
    await expect(sendWhatsAppTemplate(message)).resolves.toEqual({ ok: false, error: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("n'appelle pas Meta pour un numéro inexploitable", async () => {
    configure()
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/client')
    await expect(sendWhatsAppTemplate({ ...message, to: '123' })).resolves.toEqual({
      ok: false,
      error: 'invalid_phone',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('envoie le modèle avec ses paramètres de corps et renvoie l’identifiant Meta', async () => {
    configure()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }),
    )
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/client')

    await expect(sendWhatsAppTemplate(message)).resolves.toEqual({ ok: true, messageId: 'wamid.X' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/1481661498359966/messages')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization:  `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to:   '213555123456',
      type: 'template',
      template: {
        name:     'decision_reclamation',
        language: { code: 'fr' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Karim' },
              { type: 'text', text: 'CMD-10234' },
              { type: 'text', text: 'استبدال' },
            ],
          },
        ],
      },
    })
  })

  it('renvoie le code et le message Meta en cas de refus, sans journaliser le token', async () => {
    configure()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 190, message: 'expired' } }), { status: 401 }),
    )
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/client')

    await expect(sendWhatsAppTemplate(message)).resolves.toEqual({ ok: false, error: 'meta_190: expired' })

    expect(mockLog.error).toHaveBeenCalled()
    const logged = JSON.stringify(mockLog.error.mock.calls)
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('213555123456')
    expect(logged).toContain('3456')
  })

  it('ne lève pas en cas de panne réseau', async () => {
    configure()
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/client')

    const result = await sendWhatsAppTemplate(message)
    expect(result.ok).toBe(false)
    expect(mockLog.error).toHaveBeenCalled()
  })

  it('ne lève pas si la réponse de Meta n’est pas du JSON', async () => {
    configure()
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/client')

    const result = await sendWhatsAppTemplate(message)
    expect(result).toEqual({ ok: false, error: 'http_502' })
  })
})
