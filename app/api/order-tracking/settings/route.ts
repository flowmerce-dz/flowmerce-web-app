// app/api/order-tracking/settings/route.ts — Flowmerce · Suivi des commandes
//
// Réglages du suivi pour la boutique connectée (tableau de bord).
//
// GET   → tout ce que la page « Suivi des commandes » affiche : état du
//         service, mode d'intégration (webhook, polling, connecteur) et état
//         de sa source, URL du webhook, préfixes de clé API et de secret,
//         correspondances de statuts, statuts non reconnus, notifications.
// PATCH → enregistre les réglages transmis ; un champ absent n'est pas touché.
//
// Le secret webhook n'est jamais renvoyé ici, ni en clair ni chiffré : seul son
// préfixe l'est. Il n'est révélé qu'à sa génération (route ./secret).
//
// Les réglages restent modifiables quand le suivi est désactivé : une boutique
// peut tout préparer avant d'activer le service.

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { env } from '@/lib/env'
import { getSessionFromRequest } from '@/lib/getSession'
import { requireDashboardVendor } from '@/lib/dashboard-vendor'
import { isServiceEnabled } from '@/lib/services/vendor-services'
import { getChannel, listChannels } from '@/lib/order-tracking/channels'
import { getConnector, listConnectors } from '@/lib/order-tracking/connectors'
import { encryptSecret, isSecretStorageConfigured } from '@/lib/order-tracking/crypto'
import { INTEGRATION_MODES, isPullMode } from '@/lib/order-tracking/integration'
import {
  POLL_MAX_TOKEN_SIZE,
  POLL_MAX_URL_LENGTH,
  validatePollingUrl,
} from '@/lib/order-tracking/polling'
import {
  LANGUAGES,
  MAPPABLE_STATUSES,
  normalizeStatusKey,
  resolveStatus,
} from '@/lib/order-tracking/statuses'
import { buildStoreStatusView } from '@/lib/order-tracking/store-statuses'
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  effectiveTemplates,
  readStoreTemplates,
  type StoreTemplates,
} from '@/lib/order-tracking/templates'
import { log } from '@/lib/logger'

const MAX_MAPPINGS = 100

const WEBHOOK_URL = `${env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/v1/webhooks/orders`

const StatusEnum   = z.enum(MAPPABLE_STATUSES as [string, ...string[]])
const LanguageEnum = z.enum(LANGUAGES)

const TemplateSchema = z
  .object({
    subject: z.string().trim().min(1).max(MAX_SUBJECT_LENGTH),
    body:    z.string().trim().min(1).max(MAX_BODY_LENGTH),
  })
  .nullable() // null : revenir au modèle par défaut

const PatchSchema = z
  .object({
    notifyStatuses:      z.array(StatusEnum).max(MAPPABLE_STATUSES.length).optional(),
    notificationChannel: z.enum(['EMAIL', 'WHATSAPP']).optional(),
    defaultLanguage:     LanguageEnum.optional(),
    mappings: z
      .array(z.object({
        externalStatus: z.string().trim().min(1).max(100),
        status:         StatusEnum,
      }))
      .max(MAX_MAPPINGS)
      .optional(),
    templates: z.record(StatusEnum, z.record(LanguageEnum, TemplateSchema)).optional(),

    // Mode d'intégration et réglages de sa source.
    integrationMode: z.enum(INTEGRATION_MODES).optional(),
    polling: z
      .object({
        // null ou chaîne vide : effacer.
        url:   z.string().trim().max(POLL_MAX_URL_LENGTH).nullable().optional(),
        // Écriture seule : jamais renvoyé par GET.
        token: z.string().trim().max(POLL_MAX_TOKEN_SIZE).nullable().optional(),
      })
      .strict()
      .optional(),
    connector: z
      .object({
        id:          z.string().trim().min(1).max(50),
        credentials: z.record(z.string().max(100), z.string().trim().max(500)),
      })
      .strict()
      .optional(),
  })
  .strict()

const secretStorageMissing = () => NextResponse.json(
  { error: 'Le stockage des secrets n’est pas configuré sur ce déploiement' },
  { status: 503 },
)

type OrderStatusValue = (typeof MAPPABLE_STATUSES)[number]

// ─────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSessionFromRequest()
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const resolved = await requireDashboardVendor(session.user)
  if (!resolved.ok) return resolved.response
  const { vendor } = resolved

  const [config, apiKeys, mappings, unmappedEvents, seenEvents] = await Promise.all([
    prisma.orderTrackingConfig.findUnique({ where: { vendorId: vendor.id } }),
    prisma.apiKey.findMany({
      where:   { vendorId: vendor.id, isActive: true },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, name: true, keyPrefix: true },
    }),
    prisma.storeStatusMapping.findMany({
      where:   { vendorId: vendor.id },
      orderBy: { createdAt: 'asc' },
      select:  { id: true, externalStatus: true, normalizedKey: true, status: true },
    }),
    prisma.orderStatusEvent.groupBy({
      by:      ['rawStatus'],
      where:   { vendorId: vendor.id, status: 'UNMAPPED' },
      _count:  { _all: true },
      _max:    { receivedAt: true },
      orderBy: { _max: { receivedAt: 'desc' } },
      take:    50,
    }),
    // Statuts normalisés déjà reçus pour cette boutique.
    prisma.orderStatusEvent.groupBy({ by: ['status'], where: { vendorId: vendor.id } }),
  ])

  // Statuts propres à la boutique : seuls ceux-là sont proposés au vendeur.
  const storeStatuses = buildStoreStatusView(
    config?.storeStatuses ?? [],
    mappings,
    seenEvents.map((e) => e.status),
  )

  // Statuts sans correspondance, à présenter au vendeur : ceux reçus par
  // webhook, puis ceux que la boutique a déclarés sans les avoir encore
  // envoyés. Ceux qu'une correspondance ajoutée depuis reconnaît désormais ne
  // sont plus listés.
  const receivedUnmapped = unmappedEvents
    .filter((e) => resolveStatus(e.rawStatus, mappings) === 'UNMAPPED')
    .map((e) => ({
      rawStatus:  e.rawStatus,
      count:      e._count._all,
      lastSeenAt: e._max.receivedAt as Date | null,
    }))
  const receivedKeys = new Set(receivedUnmapped.map((u) => normalizeStatusKey(u.rawStatus)))
  const unmappedStatuses = [
    ...receivedUnmapped,
    ...storeStatuses.items
      .filter((i) => i.status === 'UNMAPPED' && !receivedKeys.has(normalizeStatusKey(i.label)))
      .map((i) => ({ rawStatus: i.label, count: 0, lastSeenAt: null })),
  ]

  return NextResponse.json({
    enabled:    isServiceEnabled(vendor, 'orderTracking'),
    webhookUrl: WEBHOOK_URL,
    secret: {
      storageReady: isSecretStorageConfigured(),
      configured:   Boolean(config?.webhookSecretEnc),
      prefix:       config?.webhookSecretPrefix ?? null,
      createdAt:    config?.webhookSecretCreatedAt ?? null,
    },
    apiKeys,
    // Mode d'intégration actif et état de chaque source. Ni le jeton de
    // polling ni les identifiants d'un connecteur ne sont renvoyés.
    integration: {
      mode: config?.integrationMode ?? 'WEBHOOK',
      polling: {
        url:             config?.pollingUrl ?? null,
        tokenConfigured: Boolean(config?.pollingTokenEnc),
      },
      connectorId: config?.connectorId ?? null,
      connectors:  listConnectors(),
      sync: {
        startedAt:  config?.pullStartedAt ?? null,
        lastRunAt:  config?.pullLastRunAt ?? null,
        lastOk:     config?.pullLastOk ?? null,
        lastError:  config?.pullLastError ?? null,
        lastEvents: config?.pullLastEvents ?? null,
      },
    },
    mappings: mappings.map(({ id, externalStatus, status }) => ({ id, externalStatus, status })),
    unmappedStatuses,
    storeStatuses: {
      declared:   storeStatuses.declared,
      declaredAt: config?.storeStatusesDeclaredAt ?? null,
      items:      storeStatuses.items,
    },
    // Statuts à proposer au vendeur et nom que la boutique leur donne.
    activeStatuses: storeStatuses.activeStatuses,
    statusLabels:   storeStatuses.labels,
    notifyStatuses:      config?.notifyStatuses ?? [],
    notificationChannel: config?.notificationChannel ?? 'EMAIL',
    channels:            listChannels(),
    defaultLanguage:     config?.defaultLanguage ?? 'fr',
    templates:           effectiveTemplates(readStoreTemplates(config?.messageTemplates)),
  })
}

// ─────────────────────────────────────────────────────────────
// PATCH
// ─────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getSessionFromRequest()
  if (!session?.user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const resolved = await requireDashboardVendor(session.user)
  if (!resolved.ok) return resolved.response
  const vendorId = resolved.vendor.id

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides', details: parsed.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`) },
      { status: 400 },
    )
  }
  const input = parsed.data

  if (input.notificationChannel && !getChannel(input.notificationChannel).isAvailable()) {
    return NextResponse.json(
      { error: 'Ce canal de notification n’est pas encore disponible' },
      { status: 400 },
    )
  }

  // Correspondances : la clé de comparaison doit être exploitable et unique.
  let mappingRows: { externalStatus: string; normalizedKey: string; status: OrderStatusValue }[] | undefined
  if (input.mappings) {
    mappingRows = input.mappings.map((m) => ({
      externalStatus: m.externalStatus,
      normalizedKey:  normalizeStatusKey(m.externalStatus),
      status:         m.status as OrderStatusValue,
    }))
    if (mappingRows.some((m) => !m.normalizedKey)) {
      return NextResponse.json({ error: 'Un statut de boutique est vide ou illisible' }, { status: 400 })
    }
    const keys = new Set(mappingRows.map((m) => m.normalizedKey))
    if (keys.size !== mappingRows.length) {
      return NextResponse.json(
        { error: 'Un même statut de boutique ne peut avoir qu’une seule correspondance' },
        { status: 400 },
      )
    }
  }

  // Mode d'intégration et source : validés avant toute écriture.
  const integration: Prisma.OrderTrackingConfigUncheckedUpdateInput = {}
  if (input.integrationMode || input.polling || input.connector) {
    const existing = await prisma.orderTrackingConfig.findUnique({ where: { vendorId } })
    // La source change : la synchronisation repart de maintenant.
    let restart = false

    if (input.polling?.url !== undefined) {
      if (!input.polling.url) {
        integration.pollingUrl = null
      } else {
        const check = validatePollingUrl(input.polling.url)
        if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
        if (check.url !== existing?.pollingUrl) restart = true
        integration.pollingUrl = check.url
      }
    }
    if (input.polling?.token !== undefined) {
      if (!input.polling.token) {
        integration.pollingTokenEnc = null
      } else {
        if (!isSecretStorageConfigured()) return secretStorageMissing()
        integration.pollingTokenEnc = encryptSecret(input.polling.token)
      }
    }

    if (input.connector) {
      const connector = getConnector(input.connector.id)
      if (!connector) return NextResponse.json({ error: 'Connecteur inconnu' }, { status: 400 })
      if (!connector.isAvailable()) {
        return NextResponse.json({ error: 'Ce connecteur n’est pas encore disponible' }, { status: 400 })
      }
      const credentials: Record<string, string> = {}
      for (const field of connector.credentialFields) {
        const value = input.connector.credentials[field.key]
        if (!value) {
          return NextResponse.json({ error: `Identifiant manquant : ${field.label}` }, { status: 400 })
        }
        credentials[field.key] = value
      }
      if (!isSecretStorageConfigured()) return secretStorageMissing()
      integration.connectorId             = connector.id
      integration.connectorCredentialsEnc = encryptSecret(JSON.stringify(credentials))
      restart = true
    }

    const mode = input.integrationMode ?? existing?.integrationMode ?? 'WEBHOOK'
    const url  = integration.pollingUrl !== undefined ? integration.pollingUrl : existing?.pollingUrl
    if (mode === 'POLLING' && !url) {
      return NextResponse.json(
        { error: 'Renseignez l’URL de polling avant d’utiliser ce mode' },
        { status: 400 },
      )
    }
    if (mode === 'CONNECTOR') {
      const connectorId = (integration.connectorId as string | undefined) ?? existing?.connectorId
      const ready = integration.connectorCredentialsEnc ?? existing?.connectorCredentialsEnc
      if (!getConnector(connectorId)?.isAvailable() || !ready) {
        return NextResponse.json(
          { error: 'Aucun connecteur disponible n’est configuré pour cette boutique' },
          { status: 400 },
        )
      }
    }

    if (input.integrationMode && input.integrationMode !== (existing?.integrationMode ?? 'WEBHOOK')) {
      integration.integrationMode = input.integrationMode
      if (isPullMode(input.integrationMode)) restart = true
    }

    if (restart) {
      // Les changements antérieurs à cet instant ne seront pas annoncés aux
      // clients (cf. lib/order-tracking/pull.ts).
      Object.assign(integration, {
        pullStartedAt: new Date(), pullCursor: null,
        pullLastRunAt: null, pullLastOk: null, pullLastError: null, pullLastEvents: null,
      })
    }
  }

  let reclassified = 0

  await prisma.$transaction(async (tx) => {
    const current = await tx.orderTrackingConfig.findUnique({ where: { vendorId } })

    const data: Prisma.OrderTrackingConfigUncheckedUpdateInput = { ...integration }
    if (input.notifyStatuses) {
      data.notifyStatuses = [...new Set(input.notifyStatuses)] as OrderStatusValue[]
    }
    if (input.notificationChannel) data.notificationChannel = input.notificationChannel
    if (input.defaultLanguage)     data.defaultLanguage     = input.defaultLanguage

    if (input.templates) {
      // Fusion : seules les entrées transmises changent ; `null` rétablit le
      // modèle par défaut pour ce statut et cette langue.
      const merged: StoreTemplates = readStoreTemplates(current?.messageTemplates)
      for (const [status, byLanguage] of Object.entries(input.templates)) {
        const entry = { ...merged[status as OrderStatusValue] }
        for (const [language, template] of Object.entries(byLanguage ?? {})) {
          if (template) entry[language as 'fr' | 'ar'] = template
          else delete entry[language as 'fr' | 'ar']
        }
        if (Object.keys(entry).length) merged[status as OrderStatusValue] = entry
        else delete merged[status as OrderStatusValue]
      }
      data.messageTemplates = merged as Prisma.InputJsonValue
    }

    if (Object.keys(data).length > 0 || !current) {
      await tx.orderTrackingConfig.upsert({
        where:  { vendorId },
        create: { ...(data as Prisma.OrderTrackingConfigUncheckedCreateInput), vendorId },
        update: data,
      })
    }

    if (mappingRows) {
      await tx.storeStatusMapping.deleteMany({ where: { vendorId } })
      if (mappingRows.length) {
        await tx.storeStatusMapping.createMany({
          data: mappingRows.map((m) => ({ vendorId, ...m })),
        })
      }

      // Les commandes restées « non reconnues » prennent le statut que les
      // nouvelles correspondances leur donnent. Aucune notification n'est
      // émise pour ce reclassement : il ne correspond à aucun événement.
      const pending = await tx.order.groupBy({
        by:    ['rawStatus'],
        where: { vendorId, status: 'UNMAPPED' },
      })
      for (const { rawStatus } of pending) {
        const status = resolveStatus(rawStatus, mappingRows)
        if (status === 'UNMAPPED') continue
        const { count } = await tx.order.updateMany({
          where: { vendorId, status: 'UNMAPPED', rawStatus },
          data:  { status },
        })
        reclassified += count
      }
    }
  })

  log.info('order_tracking.settings_updated', {
    vendorId, fields: Object.keys(input), reclassified,
  })

  return NextResponse.json({ success: true, reclassified })
}
