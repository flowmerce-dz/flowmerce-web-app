// __tests__/helpers/fake-tracking-db.ts — Flowmerce
//
// Base de données en mémoire pour les tests du suivi des commandes.
//
// Elle reproduit le sous-ensemble de Prisma que le service utilise, avec ce
// qui compte pour ses garanties : contraintes d'unicité (P2002), mises à jour
// conditionnelles (`updateMany` + `where`) et annulation d'une transaction qui
// échoue. Les tests exercent ainsi le vrai code d'ingestion et du worker, pas
// une suite d'appels simulés un à un.

import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'

// Lignes de forme libre, comme les mocks Prisma des autres tests.
type Row = Record<string, any>

const TABLES = [
  'vendor', 'apiKey', 'orderTrackingConfig', 'storeStatusMapping',
  'order', 'orderStatusEvent', 'notificationJob', 'webhookLog',
] as const
type TableName = (typeof TABLES)[number]

const UNIQUE: Partial<Record<TableName, string[][]>> = {
  order:               [['vendorId', 'externalId']],
  orderStatusEvent:    [['vendorId', 'eventId']],
  notificationJob:     [['eventId']],
  orderTrackingConfig: [['vendorId']],
  storeStatusMapping:  [['vendorId', 'normalizedKey']],
}

const DEFAULTS: Partial<Record<TableName, () => Row>> = {
  order:            () => ({ status: 'UNMAPPED', customerName: null, customerEmail: null, customerPhone: null, customerLanguage: null, trackingNumber: null, carrier: null, trackingUrl: null, items: null }),
  orderStatusEvent: () => ({ applied: true, receivedAt: new Date() }),
  notificationJob:  () => ({ status: 'PENDING', language: 'fr', attempts: 0, maxAttempts: 5, nextAttemptAt: new Date(), lockedAt: null, lastError: null, sentAt: null, createdAt: new Date() }),
  webhookLog:       () => ({ isTest: false, source: 'WEBHOOK', receivedAt: new Date() }),
  orderTrackingConfig: () => ({
    webhookSecretEnc: null, notifyStatuses: [], notificationChannel: 'EMAIL', defaultLanguage: 'fr', messageTemplates: null,
    integrationMode: 'WEBHOOK', pollingUrl: null, pollingTokenEnc: null, connectorId: null, connectorCredentialsEnc: null,
    pullStartedAt: null, pullCursor: null, pullLockedAt: null, pullLastRunAt: null, pullLastOk: null, pullLastError: null, pullLastEvents: null,
  }),
}

let state: Record<TableName, Row[]> = emptyState()
let seq = 0

function emptyState(): Record<TableName, Row[]> {
  return Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Record<TableName, Row[]>
}

const time = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number))

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as Row
    if ('lte' in c) return actual != null && time(actual) <= time(c.lte)
    if ('lt' in c)  return actual != null && time(actual) <  time(c.lt)
    if ('in' in c)  return (c.in as unknown[]).includes(actual)
  }
  if (actual instanceof Date && cond instanceof Date) return actual.getTime() === cond.getTime()
  return actual === cond
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w))
    // Clé composée Prisma : { vendorId_eventId: { vendorId, eventId } }
    if (key.includes('_') && cond && typeof cond === 'object' && !(cond instanceof Date)) {
      return matches(row, cond as Row)
    }
    return matchValue(row[key], cond)
  })
}

function applyData(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] += value.increment
    else row[key] = value
  }
}

function uniqueViolation(): Error {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002', clientVersion: 'test',
  })
}

function table(name: TableName) {
  const rows = () => state[name]

  return {
    async findUnique({ where }: { where: Row }) {
      const row = rows().find((r) => matches(r, where))
      if (!row) return null
      const copy = { ...row }
      // Relations lues par le service.
      if (name === 'orderStatusEvent') copy.order = { ...state.order.find((o) => o.id === row.orderId) }
      if (name === 'apiKey') copy.vendor = { ...state.vendor.find((v) => v.id === row.vendorId), returnPolicy: null }
      if (name === 'vendor') {
        copy.orderTrackingConfig = state.orderTrackingConfig.find((c) => c.vendorId === row.id) ?? null
      }
      return copy
    },
    async findMany({ where, take, orderBy }: { where?: Row; take?: number; orderBy?: Row } = {}) {
      let out = rows().filter((r) => matches(r, where)).map((r) => ({ ...r }))
      const [field, dir] = Object.entries(orderBy ?? {})[0] ?? []
      if (field) out.sort((a, b) => (time(a[field]) - time(b[field])) * (dir === 'desc' ? -1 : 1))
      if (take !== undefined) out = out.slice(0, take)
      return out
    },
    async create({ data }: { data: Row }) {
      const row: Row = { id: `${name}_${++seq}`, ...(DEFAULTS[name]?.() ?? {}), ...data }
      for (const fields of UNIQUE[name] ?? []) {
        if (rows().some((r) => fields.every((f) => r[f] === row[f]))) throw uniqueViolation()
      }
      rows().push(row)
      return { ...row }
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = rows().find((r) => matches(r, where))
      if (!row) throw new Error(`${name}: ligne introuvable`)
      applyData(row, data)
      return { ...row }
    },
    async updateMany({ where, data }: { where?: Row; data: Row }) {
      const hit = rows().filter((r) => matches(r, where))
      hit.forEach((r) => applyData(r, data))
      return { count: hit.length }
    },
    async count({ where }: { where?: Row } = {}) {
      return rows().filter((r) => matches(r, where)).length
    },
    async upsert({ where, create, update }: { where: Row; create: Row; update: Row }) {
      const row = rows().find((r) => matches(r, where))
      if (!row) return this.create({ data: create })
      applyData(row, update)
      return { ...row }
    },
    async deleteMany({ where }: { where?: Row } = {}) {
      const kept = rows().filter((r) => !matches(r, where))
      const count = rows().length - kept.length
      state[name] = kept
      return { count }
    },
    async createMany({ data }: { data: Row[] }) {
      for (const d of data) await this.create({ data: d })
      return { count: data.length }
    },
    /** Regroupement sur un seul champ, avec le décompte et la dernière réception. */
    async groupBy({ by, where }: { by: string[]; where?: Row }) {
      const groups = new Map<unknown, Row[]>()
      for (const r of rows().filter((x) => matches(x, where))) {
        groups.set(r[by[0]], [...(groups.get(r[by[0]]) ?? []), r])
      }
      return [...groups].map(([value, members]) => ({
        [by[0]]: value,
        _count:  { _all: members.length },
        _max:    { receivedAt: members.map((m) => m.receivedAt).sort((a, b) => time(b) - time(a))[0] ?? null },
      }))
    },
  }
}

type FakeDb = Record<TableName, ReturnType<typeof table>> & {
  $transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T>
}

export const fakeDb: FakeDb = {
  ...(Object.fromEntries(TABLES.map((t) => [t, table(t)])) as Record<TableName, ReturnType<typeof table>>),

  /**
   * Transaction : tout ce qui a été écrit est annulé si la fonction échoue.
   *
   * Les transactions s'exécutent l'une après l'autre. C'est le résultat
   * qu'impose PostgreSQL à deux écritures concurrentes sur la même clé
   * unique : la seconde attend la validation de la première, puis voit sa
   * ligne. Le cas où elle l'a manquée avant d'écrire (P2002) est testé à part.
   */
  $transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    const run = async () => {
      const snapshot = structuredClone(state)
      try {
        return await fn(fakeDb)
      } catch (err) {
        state = snapshot
        throw err
      }
    }
    const result = txQueue.then(run, run)
    txQueue = result.catch(() => undefined)
    return result
  },
}

let txQueue: Promise<unknown> = Promise.resolve()

// ─────────────────────────────────────────────────────────────
// Préparation des tests
// ─────────────────────────────────────────────────────────────

export function resetDb() {
  state = emptyState()
  seq = 0
}

export const rowsOf = (name: TableName): Row[] => state[name]

const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex')

/** Crée une boutique approuvée avec une clé API active. */
export function seedVendor(opts: {
  id?: string
  returnsMLEnabled?: boolean
  orderTrackingEnabled?: boolean
} = {}) {
  const id     = opts.id ?? `v_${++seq}`
  const rawKey = `flk_test_${id}`
  state.vendor.push({
    id,
    userId:               `user_${id}`,
    companyName:          'Caba Store',
    website:              'https://caba.example.com',
    status:               'APPROVED',
    vendorCategories:     [],
    returnsMLEnabled:     opts.returnsMLEnabled ?? true,
    orderTrackingEnabled: opts.orderTrackingEnabled ?? false,
  })
  state.apiKey.push({ id: `k_${id}`, vendorId: id, key: sha256(rawKey), isActive: true, lastUsedAt: null })
  return { vendorId: id, rawKey }
}

/** Configure le suivi d'une boutique. `webhookSecretEnc` est fourni déjà chiffré. */
export function seedTrackingConfig(vendorId: string, config: Row) {
  state.orderTrackingConfig.push({ id: `cfg_${vendorId}`, vendorId, ...DEFAULTS.orderTrackingConfig!(), ...config })
}
