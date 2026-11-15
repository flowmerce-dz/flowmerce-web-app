'use client'

// Documentation développeur du suivi des commandes : les trois modes
// d'intégration (webhook, polling, connecteur), puis ce qui leur est commun —
// format d'un événement, statuts, déclaration des statuts de la boutique.
//
// Les valeurs citées (en-têtes, codes d'erreur, limites) sont celles du code :
// lib/order-tracking/{webhook,payload,polling,pull,statuses}.ts.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { DocsTabs } from '@/components/docs/DocsTabs'
import { CodeBlock, ErrorRow, FieldRow, H3, IconCode, IconKey, IconLink } from '@/components/docs/parts'

// ── Modes ─────────────────────────────────────────────────────────────────────

const MODES = [
  {
    key: 'webhook',
    name: 'Webhook',
    tag: 'Votre boutique envoie',
    body: 'Votre backend envoie une requête signée à chaque changement de statut. Le client est prévenu dans la foulée.',
  },
  {
    key: 'polling',
    name: 'Polling',
    tag: 'Flowmerce vient lire',
    body: 'Vous exposez une URL qui liste les commandes modifiées. Flowmerce l’interroge à intervalle régulier.',
  },
  {
    key: 'connecteurs',
    name: 'Connecteurs',
    tag: 'Aucun code',
    body: 'Flowmerce lit les statuts chez un service tiers avec les identifiants du marchand. Bientôt disponible.',
  },
] as const

type Mode = (typeof MODES)[number]['key']

const modeOfHash = (hash: string): Mode | null =>
  MODES.find((m) => hash === m.key || hash.startsWith(`${m.key}-`))?.key ?? null

// ── Exemples : envoi d'un webhook signé ───────────────────────────────────────

const LANGS = ['Node.js', 'PHP', 'Python'] as const
type Lang = (typeof LANGS)[number]

const CODE_WEBHOOK: Record<Lang, string> = {
  'Node.js': `import crypto from 'node:crypto'

// Le corps est sérialisé UNE fois : la chaîne signée est la chaîne envoyée.
const body = JSON.stringify({
  order_id: 'CMD-10452',
  status: 'Expédiée',
  updated_at: new Date().toISOString(),
  customer: { name: 'Amine B.', email: 'amine@example.com', language: 'fr' },
  tracking_number: 'YAL-123456',
  carrier: 'Yalidine',
})

const eventId   = crypto.randomUUID()        // à conserver pour les renvois
const timestamp = Math.floor(Date.now() / 1000).toString()
const signature = crypto
  .createHmac('sha256', process.env.FLOWMERCE_WEBHOOK_SECRET)
  .update(timestamp + '.' + eventId + '.' + body)
  .digest('hex')

const res = await fetch('https://flowmerce.app/api/v1/webhooks/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Flowmerce-Key': process.env.FLOWMERCE_API_KEY,
    'X-Flowmerce-Event-Id': eventId,
    'X-Flowmerce-Timestamp': timestamp,
    'X-Flowmerce-Signature': signature,
  },
  body,
})

// 200 et 409 : livré, ne pas renvoyer. 5xx ou erreur réseau : renvoyer plus
// tard avec le MÊME eventId (et un horodatage et une signature recalculés).`,

  PHP: `<?php
// Le corps est sérialisé UNE fois : la chaîne signée est la chaîne envoyée.
$body = json_encode([
    'order_id'        => 'CMD-10452',
    'status'          => 'Expédiée',
    'updated_at'      => gmdate('Y-m-d\\TH:i:s\\Z'),
    'customer'        => ['name' => 'Amine B.', 'email' => 'amine@example.com', 'language' => 'fr'],
    'tracking_number' => 'YAL-123456',
    'carrier'         => 'Yalidine',
], JSON_UNESCAPED_UNICODE);

$eventId   = bin2hex(random_bytes(16));   // à conserver pour les renvois
$timestamp = (string) time();
$signature = hash_hmac(
    'sha256',
    $timestamp . '.' . $eventId . '.' . $body,
    getenv('FLOWMERCE_WEBHOOK_SECRET')
);

$ch = curl_init('https://flowmerce.app/api/v1/webhooks/orders');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'X-Flowmerce-Key: ' . getenv('FLOWMERCE_API_KEY'),
        'X-Flowmerce-Event-Id: ' . $eventId,
        'X-Flowmerce-Timestamp: ' . $timestamp,
        'X-Flowmerce-Signature: ' . $signature,
    ],
]);
$response = curl_exec($ch);
$status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);

// 200 et 409 : livré, ne pas renvoyer. 5xx ou échec réseau : renvoyer plus
// tard avec le MÊME $eventId.`,

  Python: `import hashlib, hmac, json, os, time, uuid
from datetime import datetime, timezone

import requests

# Le corps est sérialisé UNE fois : la chaîne signée est la chaîne envoyée.
body = json.dumps({
    "order_id": "CMD-10452",
    "status": "Expédiée",
    "updated_at": datetime.now(timezone.utc).isoformat(),
    "customer": {"name": "Amine B.", "email": "amine@example.com", "language": "fr"},
    "tracking_number": "YAL-123456",
    "carrier": "Yalidine",
}, ensure_ascii=False)

event_id  = str(uuid.uuid4())             # à conserver pour les renvois
timestamp = str(int(time.time()))
signature = hmac.new(
    os.environ["FLOWMERCE_WEBHOOK_SECRET"].encode(),
    (timestamp + "." + event_id + "." + body).encode("utf-8"),
    hashlib.sha256,
).hexdigest()

res = requests.post(
    "https://flowmerce.app/api/v1/webhooks/orders",
    data=body.encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "X-Flowmerce-Key": os.environ["FLOWMERCE_API_KEY"],
        "X-Flowmerce-Event-Id": event_id,
        "X-Flowmerce-Timestamp": timestamp,
        "X-Flowmerce-Signature": signature,
    },
    timeout=10,
)

# 200 et 409 : livré, ne pas renvoyer. 5xx ou échec réseau : renvoyer plus
# tard avec le MÊME event_id.`,
}

const CODE_POLLING = `// GET /api/flowmerce/order-events?since=<ISO-8601>&limit=100
export async function GET(req) {
  // 1. Seul Flowmerce connaît ce jeton : le marchand le colle dans son tableau de bord.
  const expected = 'Bearer ' + process.env.FLOWMERCE_POLLING_TOKEN
  if (req.headers.get('authorization') !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }

  const params = new URL(req.url).searchParams
  const since  = new Date(params.get('since'))
  const limit  = Math.min(Number(params.get('limit')) || 100, 100)

  // 2. Les commandes dont le statut a changé depuis « since », les plus
  //    anciennes d'abord. « >= » : un doublon est sans effet, un oubli non.
  const orders = await db.order.findMany({
    where:   { statusUpdatedAt: { gte: since } },
    orderBy: { statusUpdatedAt: 'asc' },
    take:    limit + 1,
  })
  const page = orders.slice(0, limit)

  // 3. Chaque ligne a le format d'un événement.
  return Response.json({
    events: page.map((order) => ({
      order_id:   order.reference,
      status:     order.statusLabel,                    // votre libellé, tel quel
      updated_at: order.statusUpdatedAt.toISOString(),
      customer:   { name: order.customerName, email: order.customerEmail, language: 'fr' },
      tracking_number: order.trackingNumber,
    })),
    has_more: orders.length > limit,
  })
}`

// ── Petites pièces locales ────────────────────────────────────────────────────

const TH = 'text-left text-xs font-semibold text-faint uppercase tracking-wider pb-2 pr-4'
const INLINE = 'font-mono text-xs bg-page px-1 py-0.5 rounded'
const CARD = 'bg-surface border border-line rounded-card'

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Endpoint({ method, url }: { method: string; url: string }) {
  return (
    <div className="p-6 flex items-center gap-3 flex-wrap">
      <span className="bg-brand-soft text-brand-ink text-xs font-black px-2.5 py-1 rounded-md">{method}</span>
      <code className="text-sm font-mono text-ink break-all">{url}</code>
    </div>
  )
}

function Checklist({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2 text-sm text-body list-none p-0">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="text-brand-ink">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

const STATUSES: [string, string, string][] = [
  ['PENDING',          'En attente',            'pending, en attente, nouvelle, new'],
  ['CONFIRMED',        'Confirmée',             'confirmed, confirmée, validée'],
  ['PREPARING',        'En préparation',        'preparing, processing, en préparation'],
  ['SHIPPED',          'Expédiée',              'shipped, expédiée, envoyée'],
  ['OUT_FOR_DELIVERY', 'En cours de livraison', 'out for delivery, en cours de livraison, en livraison'],
  ['DELIVERED',        'Livrée',                'delivered, livrée'],
  ['FAILED_DELIVERY',  'Échec de livraison',    'failed delivery, échec de livraison, livraison échouée'],
  ['RETURNED',         'Retournée',             'returned, retournée'],
  ['CANCELLED',        'Annulée',               'cancelled, canceled, annulée'],
]

// ── Page ──────────────────────────────────────────────────────────────────────

export function TrackingDeveloperDocs() {
  const [mode, setMode] = useState<Mode>('webhook')
  const [lang, setLang] = useState<Lang>('Node.js')

  // Un lien vers #polling (ou #polling-format…) ouvre le bon mode, puis y défile.
  useEffect(() => {
    const open = () => {
      const hash   = window.location.hash.slice(1)
      const target = modeOfHash(hash)
      if (!target) return
      setMode(target)
      requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView())
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  return (
    <>
      <section className="px-4 sm:px-6 pt-28 pb-10 sm:pt-32">
        <div className="max-w-4xl mx-auto">
          <DocsTabs active="developpeurs" service="suivi" />
          <h1 className="mt-8 text-4xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05] text-ink">
            Brancher le suivi
            <br />
            <span className="text-brand-ink">des commandes.</span>
          </h1>
          <p className="mt-5 text-[15px] text-body leading-relaxed max-w-xl">
            Référence technique : les trois modes d’intégration, le format d’un
            événement, les statuts et les codes d’erreur. Ce service est indépendant
            de l’API de retours.
          </p>
        </div>
      </section>

      <div className="max-w-4xl mx-auto px-6 pb-24 space-y-12">

        {/* ── Principe ── */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-2">Comment ça marche</h2>
          <p className="text-sm text-body mb-6">
            Flowmerce apprend qu’une commande a changé de statut, ramène ce statut à un
            statut standard, puis envoie au client le message que le marchand a prévu.
            Seule la première étape dépend du mode d’intégration.
          </p>
          <CodeBlock
            lang="Du changement de statut au message"
            code={`[Boutique]   une commande passe à « Expédiée »
     │
     │  webhook     la boutique envoie l'événement          (immédiat)
     │  polling     Flowmerce lit l'URL de la boutique      (au passage suivant)
     │  connecteur  Flowmerce lit le service tiers          (au passage suivant)
     ▼
[Flowmerce]  1. idempotence : un événement déjà reçu n'est jamais rejoué
             2. statut ramené à un statut standard (« Expédiée » → SHIPPED)
             3. chronologie : un événement en retard n'écrase rien
             4. notification mise en file si le marchand a coché ce statut
     ▼
[Client]     e-mail en français ou en arabe`}
          />
        </section>

        {/* ── Prérequis et authentification ── */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-brand text-white rounded-control flex items-center justify-center shrink-0">
              <IconKey />
            </div>
            <h2 className="text-xl font-bold text-ink">Prérequis et authentification</h2>
          </div>

          <div className={`${CARD} p-6 space-y-4`}>
            <Checklist
              items={[
                <>Le marchand a activé le service <strong className="text-ink">Suivi des commandes</strong> dans son tableau de bord. Sinon l’API répond <code className={INLINE}>403 SERVICE_DISABLED</code>.</>,
                <>Une <strong className="text-ink">clé API</strong> active, la même que pour les retours. Elle identifie la boutique.</>,
                <>Le <strong className="text-ink">mode d’intégration</strong> choisi par le marchand : un seul est actif à la fois.</>,
              ]}
            />

            <CodeBlock
              lang="HTTP headers"
              code={`# Webhook : la clé est attendue dans cet en-tête
X-Flowmerce-Key: flk_votre_cle_api

# Déclaration des statuts : cet en-tête, ou l'un des deux formats habituels
Authorization: Bearer flk_votre_cle_api
x-api-key: flk_votre_cle_api`}
            />

            <div className="bg-red-50 border border-red-200 rounded-card p-4 text-sm text-red-800">
              <strong>⚠ Côté serveur uniquement :</strong> la clé API, le secret de signature
              et le jeton de polling ne doivent jamais apparaître dans le navigateur. Gardez-les
              dans les variables d’environnement de votre serveur.
            </div>

            <p className="text-sm text-body">
              La clé se génère sur{' '}
              <Link href="/dashboard/api-keys" className="text-brand-ink hover:underline font-medium">
                Clés API
              </Link>
              , le reste sur{' '}
              <Link href="/dashboard/order-tracking" className="text-brand-ink hover:underline font-medium">
                Suivi des commandes
              </Link>
              .
            </p>
          </div>
        </section>

        {/* ── Choix du mode ── */}
        <section>
          <h2 className="text-xl font-bold text-ink mb-2">Choisissez votre mode d’intégration</h2>
          <p className="text-sm text-body mb-6">
            Un seul mode est actif par boutique : deux sources simultanées décriraient le même
            changement deux fois, et le client serait prévenu deux fois.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                aria-pressed={mode === m.key}
                className={`text-left p-5 rounded-card border-2 transition-all ${
                  mode === m.key
                    ? 'border-brand bg-brand-soft/40 shadow-sm'
                    : 'border-line bg-surface hover:border-line'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-8 h-8 rounded-control flex items-center justify-center ${
                    mode === m.key ? 'bg-brand text-white' : 'bg-page text-body'
                  }`}>
                    {m.key === 'connecteurs' ? <IconLink /> : <IconCode />}
                  </div>
                  <div>
                    <span className="block font-bold text-ink">{m.name}</span>
                    <span className="block text-xs text-faint">{m.tag}</span>
                  </div>
                </div>
                <p className="text-xs text-body leading-relaxed">{m.body}</p>
              </button>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* WEBHOOK                                                             */}
        {/* ═══════════════════════════════════════════════════════════════════ */}

        {mode === 'webhook' && (
          <div id="webhook" className="scroll-mt-24 space-y-12">

            <section>
              <H3 id="webhook-endpoint">Endpoint</H3>
              <div className={`${CARD} divide-y divide-line`}>
                <Endpoint method="POST" url="https://flowmerce.app/api/v1/webhooks/orders" />

                <div className="p-6 space-y-4">
                  <h4 className="text-sm font-semibold text-ink">En-têtes</h4>
                  <Table head={['En-tête', 'Type', 'Description']}>
                    <FieldRow name="X-Flowmerce-Key"       type="string" required desc="Clé API de la boutique (flk_…)." />
                    <FieldRow name="X-Flowmerce-Event-Id"  type="string" required desc="Identifiant unique de l'événement, généré par vous : 1 à 200 caractères ASCII sans espace. Un UUID convient. C'est la clé d'idempotence." />
                    <FieldRow name="X-Flowmerce-Timestamp" type="string" required desc="Secondes Unix de l'envoi. Refusé au-delà de 5 minutes d'écart." />
                    <FieldRow name="X-Flowmerce-Signature" type="string" required desc="HMAC-SHA256 hexadécimal (voir ci-dessous). Le préfixe « sha256= » est accepté." />
                    <FieldRow name="Content-Type"          type="string" required desc="application/json" />
                  </Table>
                </div>

                <div className="p-6 space-y-3">
                  <h4 className="text-sm font-semibold text-ink">Corps</h4>
                  <p className="text-sm text-body">
                    Un événement, au{' '}
                    <a href="#evenement" className="text-brand-ink hover:underline font-medium">format commun</a>
                    , 256 Ko au plus.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <H3 id="webhook-signature">Signature</H3>
              <div className={`${CARD} p-6 space-y-4`}>
                <CodeBlock
                  lang="Calcul"
                  code={`signature = HMAC-SHA256( secret, timestamp + "." + event_id + "." + corps )
            → en hexadécimal, dans X-Flowmerce-Signature`}
                />
                <Checklist
                  items={[
                    <>Le <strong className="text-ink">secret</strong> (<code className={INLINE}>whsec_…</code>) est généré par le marchand dans son tableau de bord et affiché une seule fois. Le régénérer invalide immédiatement l’ancien.</>,
                    <>Le <strong className="text-ink">corps</strong> signé est la chaîne exacte envoyée, à l’octet près. Sérialisez le JSON une fois, signez cette chaîne, envoyez cette chaîne.</>,
                    <>La signature est vérifiée <strong className="text-ink">avant</strong> toute lecture du corps, puis l’horodatage : une requête rejouée après 5 minutes est refusée même avec une signature valide.</>,
                  ]}
                />
              </div>
            </section>

            <section>
              <H3 id="webhook-code">Exemple de code</H3>
              <div className={`${CARD} overflow-hidden`}>
                <div className="flex border-b border-line bg-page/60 overflow-x-auto">
                  {LANGS.map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
                        lang === l
                          ? 'border-brand text-brand-ink bg-surface'
                          : 'border-transparent text-body hover:text-ink'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <div className="p-5">
                  <CodeBlock code={CODE_WEBHOOK[lang]} lang={lang} />
                </div>
              </div>
            </section>

            <section>
              <H3 id="webhook-reponse">Réponse</H3>
              <div className={`${CARD} p-6 space-y-4`}>
                <CodeBlock
                  lang="200 OK"
                  code={`{
  "received": true,
  "event_id": "9b2f6c1e-…",
  "order_id": "CMD-10452",
  "event_status": "SHIPPED",     // statut standard de CET événement
  "status": "SHIPPED",           // statut courant de la commande
  "applied": true,               // false : arrivé en retard ou statut non reconnu
  "outcome": "processed",        // processed | stale | unmapped
  "notification": "queued"       // queued | not_selected | no_recipient
                                 //   | channel_unavailable | none
}`}
                />
                <Table head={['Champ', 'Type', 'Description']}>
                  <FieldRow name="outcome"      type="string"  desc="processed : statut appliqué. stale : un événement plus récent avait déjà fixé le statut, celui-ci est gardé dans l'historique. unmapped : libellé non reconnu, à associer par le marchand." />
                  <FieldRow name="notification" type="string"  desc="queued : message mis en file. not_selected : le marchand n'a pas coché ce statut. no_recipient : pas d'adresse e-mail exploitable. none : l'événement n'a pas changé le statut courant." />
                  <FieldRow name="ignored"      type="string[]" desc="Présent si un champ facultatif a été écarté (e-mail invalide, langue inconnue, URL de suivi invalide), avec la raison. L'événement est tout de même enregistré." />
                </Table>
                <p className="text-sm text-body">
                  La réponse est rendue dès que l’événement est enregistré. L’e-mail part ensuite,
                  hors de la requête : votre boutique n’attend jamais un fournisseur d’e-mail.
                </p>
              </div>
            </section>

            <section>
              <H3 id="webhook-errors">Codes d’erreur</H3>
              <div className={`${CARD} p-6`}>
                <Table head={['Status', 'Code', 'Quand', 'Action recommandée']}>
                  <ErrorRow status={400} code="INVALID_EVENT_ID"         when="X-Flowmerce-Event-Id absent ou mal formé" action="Envoyer un identifiant ASCII de 1 à 200 caractères, sans espace" />
                  <ErrorRow status={400} code="INVALID_TIMESTAMP_FORMAT" when="X-Flowmerce-Timestamp absent ou non numérique" action="Envoyer des secondes Unix" />
                  <ErrorRow status={400} code="PAYLOAD_TOO_LARGE"        when="Corps de plus de 256 Ko" action="Réduire le corps (liste d'articles)" />
                  <ErrorRow status={400} code="INVALID_PAYLOAD"          when="JSON invalide, ou order_id, status, updated_at absent ou invalide" action="Corriger le corps : le détail est dans « details ». Ne pas renvoyer tel quel" />
                  <ErrorRow status={401} code="—"                        when="Clé API absente, invalide ou révoquée" action="Vérifier X-Flowmerce-Key" />
                  <ErrorRow status={401} code="MISSING_SIGNATURE"        when="X-Flowmerce-Signature absent" action="Signer la requête" />
                  <ErrorRow status={401} code="INVALID_SIGNATURE"        when="La signature ne correspond pas" action="Vérifier le secret, l'ordre timestamp.event_id.corps, et que le corps signé est celui envoyé" />
                  <ErrorRow status={401} code="TIMESTAMP_OUT_OF_RANGE"   when="Plus de 5 minutes d'écart avec l'heure de Flowmerce" action="Recalculer l'horodatage et la signature à chaque envoi ; vérifier l'horloge du serveur" />
                  <ErrorRow status={403} code="SERVICE_DISABLED"         when="Le marchand n'a pas activé le suivi des commandes" action="Activer le service dans le tableau de bord" />
                  <ErrorRow status={403} code="INTEGRATION_MODE_MISMATCH" when="La boutique est en mode polling ou connecteur" action="Repasser en mode webhook dans le tableau de bord, ou cesser d'envoyer" />
                  <ErrorRow status={403} code="WEBHOOK_SECRET_NOT_CONFIGURED" when="Aucun secret n'a été généré" action="Générer le secret dans le tableau de bord" />
                  <ErrorRow status={409} code="DUPLICATE_EVENT"          when="Cet event_id a déjà été reçu" action="Considérer l'événement comme livré : ne pas le renvoyer" />
                  <ErrorRow status={500} code="INTERNAL_ERROR"           when="Erreur côté Flowmerce" action="Renvoyer plus tard avec le même event_id" />
                </Table>
              </div>
            </section>

            <section>
              <H3 id="webhook-renvois">Renvois et bonnes pratiques</H3>
              <div className={`${CARD} p-6`}>
                <Checklist
                  items={[
                    <><strong className="text-ink">Envoyez hors de la requête du client.</strong> Enregistrez l’événement dans votre base au moment du changement de statut, envoyez-le ensuite : une panne de Flowmerce ne doit pas bloquer votre back-office.</>,
                    <><strong className="text-ink">Renvoyez sur 5xx, délai dépassé ou erreur réseau</strong>, avec le même <code className={INLINE}>event_id</code>, un horodatage et une signature recalculés. Ne renvoyez pas sur 4xx : la requête serait refusée de la même façon.</>,
                    <><strong className="text-ink">Un <code className={INLINE}>event_id</code> par changement</strong>, jamais par tentative d’envoi. C’est ce qui garantit qu’un client n’est pas prévenu deux fois.</>,
                    <><strong className="text-ink">L’ordre d’arrivée n’a pas d’importance.</strong> Flowmerce ordonne les événements par <code className={INLINE}>updated_at</code> : envoyez la date réelle du changement, pas celle de l’envoi.</>,
                    <><strong className="text-ink">Testez depuis le tableau de bord.</strong> Le bouton de test signe un événement fictif et le fait passer par tous les contrôles, sans créer de commande ni prévenir de client.</>,
                  ]}
                />
              </div>
            </section>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* POLLING                                                             */}
        {/* ═══════════════════════════════════════════════════════════════════ */}

        {mode === 'polling' && (
          <div id="polling" className="scroll-mt-24 space-y-12">

            <section>
              <H3 id="polling-principe">Principe</H3>
              <div className={`${CARD} p-6 space-y-4`}>
                <p className="text-sm text-body leading-relaxed">
                  Ici les rôles sont inversés : c’est <strong className="text-ink">votre boutique qui expose
                  une URL</strong>, et Flowmerce qui l’appelle. Le marchand colle cette URL et son jeton dans
                  son tableau de bord. Vous n’avez rien à signer et rien à envoyer.
                </p>
                <CodeBlock
                  lang="Flux"
                  code={`[Flowmerce]   à intervalle régulier, ou au clic « Synchroniser maintenant »
     │
     │  GET https://votre-boutique.com/api/flowmerce/order-events
     │      ?since=2026-11-15T10:00:00.000Z&limit=100
     │  Authorization: Bearer <votre jeton>
     ▼
[Votre boutique]   rend les commandes dont le statut a changé depuis « since »
     │
     │  200 { "events": [ … ], "has_more": false }
     ▼
[Flowmerce]   enregistre chaque événement, puis repart du plus récent
              au passage suivant`}
                />
              </div>
            </section>

            <section>
              <H3 id="polling-requete">La requête que vous recevez</H3>
              <div className={`${CARD} divide-y divide-line`}>
                <Endpoint method="GET" url="<votre URL>?since=…&limit=100" />
                <div className="p-6 space-y-4">
                  <Table head={['Élément', 'Type', 'Description']}>
                    <FieldRow name="since"         type="ISO-8601" required desc="Date du dernier changement déjà lu par Flowmerce. Au premier passage : le moment où le marchand a branché le polling." />
                    <FieldRow name="limit"         type="number"   required desc="Nombre maximal d'événements attendus dans la réponse : 100." />
                    <FieldRow name="cursor"        type="string"            desc="Présent seulement si votre réponse précédente contenait next_cursor : la valeur vous est rendue telle quelle." />
                    <FieldRow name="Authorization" type="en-tête"           desc="Bearer <jeton>, si le marchand en a enregistré un. Refusez la requête (401) quand il manque ou diffère." />
                  </Table>
                  <p className="text-sm text-body">
                    Vos propres paramètres d’URL sont conservés : Flowmerce y ajoute les siens.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <H3 id="polling-reponse">La réponse attendue</H3>
              <div className={`${CARD} p-6 space-y-4`}>
                <CodeBlock
                  lang="200 OK — application/json"
                  code={`{
  "events": [
    {
      "event_id": "evt_78412",                  // facultatif, recommandé
      "order_id": "CMD-10452",
      "status": "Expédiée",
      "updated_at": "2026-11-15T10:42:00Z",
      "customer": { "name": "Amine B.", "email": "amine@example.com", "language": "fr" },
      "tracking_number": "YAL-123456"
    }
  ],
  "has_more": false,                            // true : il reste des événements
  "next_cursor": null                           // facultatif : votre propre curseur
}`}
                />
                <Table head={['Champ', 'Type', 'Description']}>
                  <FieldRow name="events"      type="array"   required desc="Événements au format commun, du plus ancien au plus récent. 500 au plus ; un tableau vide quand rien n'a changé. Le tableau seul, sans objet autour, est aussi accepté." />
                  <FieldRow name="events[].event_id" type="string"     desc="Identifiant du changement. Absent, Flowmerce le déduit de (order_id, status, updated_at) : relire la même ligne ne crée rien." />
                  <FieldRow name="has_more"    type="boolean"          desc="true : Flowmerce redemande aussitôt la suite (3 pages par passage au plus, le reste au passage suivant)." />
                  <FieldRow name="next_cursor" type="string"           desc="Curseur opaque, 500 caractères au plus, rendu dans le paramètre cursor de la requête suivante. Inutile si vous paginez avec since." />
                </Table>
              </div>
            </section>

            <section>
              <H3 id="polling-code">Exemple de code</H3>
              <div className={`${CARD} p-5`}>
                <CodeBlock code={CODE_POLLING} lang="JavaScript — route de votre boutique" />
              </div>
            </section>

            <section>
              <H3 id="polling-regles">Règles à connaître</H3>
              <div className={`${CARD} p-6`}>
                <Checklist
                  items={[
                    <><strong className="text-ink">Rendez les changements à partir de <code className={INLINE}>since</code> inclus</strong> (<code className={INLINE}>&gt;=</code>). Une ligne relue est ignorée ; une ligne oubliée est un client non prévenu.</>,
                    <><strong className="text-ink">Une ligne par changement si vous le pouvez.</strong> Si vous ne rendez que le statut courant de chaque commande, une commande qui change deux fois entre deux passages n’annonce que son dernier statut.</>,
                    <><strong className="text-ink">Pas de rattrapage de l’historique.</strong> Un changement antérieur au branchement du polling est enregistré mais n’est jamais annoncé au client, même si votre URL le rend.</>,
                    <><strong className="text-ink">Le délai dépend du passage suivant.</strong> La fréquence est fixée par Flowmerce et n’est pas garantie à la minute ; le marchand peut déclencher une synchronisation immédiate. Pour prévenir un client dans l’instant, utilisez le webhook.</>,
                    <><strong className="text-ink">HTTPS, adresse publique, pas de redirection.</strong> Flowmerce n’appelle qu’une URL <code className={INLINE}>https://</code> joignable depuis Internet et ne suit aucune redirection : donnez l’URL finale.</>,
                    <><strong className="text-ink">10 secondes, 1 Mo.</strong> Au-delà, le passage échoue et reprend au suivant, là où il s’était arrêté.</>,
                  ]}
                />
              </div>
            </section>

            <section>
              <H3 id="polling-errors">Ce que Flowmerce fait de votre réponse</H3>
              <div className={`${CARD} p-6`}>
                <Table head={['Votre réponse', 'Effet']}>
                  {[
                    ['200 + JSON conforme', 'Événements enregistrés ; la position de lecture avance.'],
                    ['401 ou 403', 'Passage en échec, affiché au marchand comme « jeton refusé ».'],
                    ['Autre statut, 3xx compris', 'Passage en échec avec le statut reçu ; nouvel essai au passage suivant.'],
                    ['Pas de réponse en 10 s', 'Passage en échec ; nouvel essai au passage suivant.'],
                    ['JSON illisible ou sans « events »', 'Passage en échec ; rien n’est enregistré.'],
                    ['Un événement invalide parmi d’autres', 'Seul celui-là est écarté et signalé dans le journal ; les autres sont enregistrés.'],
                  ].map(([response, effect]) => (
                    <tr key={response} className="border-b border-line last:border-0">
                      <td className="py-3 pr-4 align-top text-sm font-medium text-ink w-64">{response}</td>
                      <td className="py-3 align-top text-sm text-body">{effect}</td>
                    </tr>
                  ))}
                </Table>
                <p className="mt-4 text-sm text-body">
                  Chaque échec apparaît dans le journal du marchand avec sa raison. Il n’y a rien à
                  rejouer de votre côté.
                </p>
              </div>
            </section>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* CONNECTEURS                                                         */}
        {/* ═══════════════════════════════════════════════════════════════════ */}

        {mode === 'connecteurs' && (
          <div id="connecteurs" className="scroll-mt-24 space-y-12">
            <section>
              <H3 id="connecteurs-principe">Principe</H3>
              <div className={`${CARD} p-6 space-y-4`}>
                <p className="text-sm text-body leading-relaxed">
                  Un connecteur lit les statuts directement chez un service que le marchand
                  utilise déjà — sa société de livraison ou sa plateforme e-commerce — avec les
                  identifiants qu’il fournit dans son tableau de bord. Il n’y a{' '}
                  <strong className="text-ink">rien à développer</strong> dans la boutique.
                </p>
                <p className="text-sm text-body leading-relaxed">
                  Une fois lus, les événements suivent exactement le même traitement que ceux
                  d’un webhook ou du polling : mêmes statuts, mêmes garanties, mêmes messages.
                </p>
              </div>
            </section>

            <section>
              <H3 id="connecteurs-catalogue">Catalogue</H3>
              <div className={`${CARD} divide-y divide-line`}>
                {[
                  ['Yalidine', 'Société de livraison'],
                  ['Shopify', 'Plateforme e-commerce'],
                  ['WooCommerce', 'Plateforme e-commerce'],
                ].map(([name, family]) => (
                  <div key={name} className="p-5 flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <h4 className="text-sm font-semibold text-ink">{name}</h4>
                      <p className="text-xs text-body">{family}</p>
                    </div>
                    <span className="bg-brand-soft text-brand-ink text-xs font-semibold px-2.5 py-1 rounded-full">
                      Bientôt disponible
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-body">
                Aucun connecteur n’est encore ouvert. En attendant, le webhook et le polling
                couvrent toute boutique qui dispose d’un développeur.
              </p>
            </section>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* COMMUN AUX TROIS MODES                                              */}
        {/* ═══════════════════════════════════════════════════════════════════ */}

        <section>
          <h2 className="text-xl font-bold text-ink mb-2">Commun aux trois modes</h2>
          <p className="text-sm text-body">
            Le format d’un événement, les statuts et la déclaration des statuts de la boutique
            ne dépendent pas du mode d’intégration.
          </p>
        </section>

        <section>
          <H3 id="evenement">Format d’un événement</H3>
          <div className={`${CARD} p-6 space-y-4`}>
            <p className="text-sm text-body">
              C’est le corps d’un webhook, et chaque élément de <code className={INLINE}>events</code>{' '}
              en polling.
            </p>
            <Table head={['Champ', 'Type', 'Description']}>
              <FieldRow name="order_id"          type="string"   required desc="Identifiant de la commande dans votre système, 200 caractères au plus. Une commande n'existe qu'une fois par boutique." />
              <FieldRow name="status"            type="string"   required desc="Le statut tel que votre boutique le nomme (« Expédiée », « shipped »…), 100 caractères au plus. Flowmerce le ramène à un statut standard." />
              <FieldRow name="updated_at"        type="ISO-8601" required desc="Date du changement, avec fuseau (Z ou +01:00). Sert à ordonner les événements. Refusée si elle est dans le futur de plus de 24 h." />
              <FieldRow name="customer.email"    type="string"            desc="Destinataire du message. Sans adresse valide, l'événement est enregistré mais aucun e-mail ne part." />
              <FieldRow name="customer.name"     type="string"            desc="Nom du client, repris dans le message." />
              <FieldRow name="customer.phone"    type="string"            desc="Téléphone du client. Conservé pour le canal WhatsApp, à venir." />
              <FieldRow name="customer.language" type="string"            desc="« fr » ou « ar ». Absent : la langue par défaut choisie par le marchand." />
              <FieldRow name="tracking_number"   type="string"            desc="Numéro de suivi du colis." />
              <FieldRow name="carrier"           type="string"            desc="Nom du transporteur." />
              <FieldRow name="tracking_url"      type="string"            desc="Lien de suivi, en http(s)." />
              <FieldRow name="items"             type="array"             desc="Articles : { sku?, name, qty }. 200 au plus." />
            </Table>
            <p className="text-sm text-body">
              Les trois champs requis sont stricts. Les autres sont tolérants : une valeur
              inexploitable est écartée sans faire échouer l’événement, et un champ inconnu est
              ignoré. Un champ absent ne vide jamais une information déjà connue de la commande.
            </p>
          </div>
        </section>

        <section>
          <H3 id="statuts">Statuts</H3>
          <div className={`${CARD} p-6 space-y-4`}>
            <p className="text-sm text-body">
              Vous envoyez vos propres libellés. Flowmerce les compare sans tenir compte de la
              casse, des accents ni de la ponctuation, d’abord aux correspondances définies par
              le marchand, puis aux libellés reconnus d’office, en français, en anglais et en
              arabe.
            </p>
            <Table head={['Statut standard', 'Libellé', 'Reconnus d’office (extrait)']}>
              {STATUSES.map(([code, label, known]) => (
                <tr key={code} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 align-top">
                    <code className="text-xs font-mono text-brand-ink bg-brand-soft px-1.5 py-0.5 rounded">{code}</code>
                  </td>
                  <td className="py-3 pr-4 align-top text-sm text-ink whitespace-nowrap">{label}</td>
                  <td className="py-3 align-top text-sm text-body">{known}</td>
                </tr>
              ))}
            </Table>
            <p className="text-sm text-body">
              Un libellé non reconnu est enregistré comme <code className={INLINE}>UNMAPPED</code> :
              il n’écrase pas le statut courant, ne prévient personne, et apparaît dans le tableau
              de bord du marchand pour être associé à un statut standard. Les commandes concernées
              sont alors reclassées.
            </p>
          </div>
        </section>

        <section>
          <H3 id="declarer-statuts">Déclarer les statuts de la boutique</H3>
          <div className={`${CARD} divide-y divide-line`}>
            <Endpoint method="PUT" url="https://flowmerce.app/api/v1/order-statuses" />
            <div className="p-6 space-y-4">
              <p className="text-sm text-body">
                Facultatif, recommandé. Envoyez la liste des statuts qui existent dans votre
                boutique : le tableau de bord du marchand ne lui proposera que ceux-là, sous vos
                libellés, et lui signalera avant le premier envoi ceux qui restent à associer.
              </p>
              <CodeBlock
                lang="Requête et réponse"
                code={`PUT /api/v1/order-statuses
X-Flowmerce-Key: flk_votre_cle_api
Content-Type: application/json

{ "statuses": ["En attente", "Confirmée", "Expédiée", "Chez le transporteur", "Livrée"] }

200 OK
{
  "statuses": [
    { "label": "En attente",           "status": "PENDING",   "mapped": true  },
    { "label": "Confirmée",            "status": "CONFIRMED", "mapped": true  },
    { "label": "Expédiée",             "status": "SHIPPED",   "mapped": true  },
    { "label": "Chez le transporteur", "status": "UNMAPPED",  "mapped": false },
    { "label": "Livrée",               "status": "DELIVERED", "mapped": true  }
  ],
  "declared_at": "2026-11-15T10:00:00.000Z"
}`}
              />
              <Checklist
                items={[
                  <>La liste envoyée <strong className="text-ink">remplace</strong> la précédente : envoyez toujours la liste complète (50 libellés au plus, 100 caractères chacun). Une liste vide annule la déclaration.</>,
                  <><code className={INLINE}>GET</code> sur la même URL rend la liste enregistrée.</>,
                  <>La déclaration <strong className="text-ink">ne restreint rien</strong> : un statut non déclaré est toujours accepté et normalisé.</>,
                  <>Pas de signature sur cette route : la clé API suffit. <code className={INLINE}>400</code> corps invalide, <code className={INLINE}>401</code> clé refusée, <code className={INLINE}>403</code> suivi non activé.</>,
                ]}
              />
            </div>
          </div>
        </section>

        <section>
          <H3 id="garanties">Garanties</H3>
          <div className={`${CARD} p-6`}>
            <Checklist
              items={[
                <><strong className="text-ink">Idempotence.</strong> Un événement est identifié par la boutique et son <code className={INLINE}>event_id</code>. Reçu deux fois, il ne crée ni historique ni message.</>,
                <><strong className="text-ink">Chronologie.</strong> Le statut courant ne régresse jamais : un événement plus ancien que celui qui l’a fixé est gardé dans l’historique sans rien changer.</>,
                <><strong className="text-ink">Notification différée.</strong> Aucun e-mail ne part pendant la réception. Le message est mis en file et réessayé jusqu’à cinq fois en cas d’échec.</>,
                <><strong className="text-ink">Indépendance.</strong> Ces routes ne lisent ni la politique de retour ni l’état du service de retours.</>,
              ]}
            />
          </div>
        </section>

        {/* CTA final */}
        <section className="bg-linear-to-br from-indigo-50 to-white border border-line rounded-card p-10 text-center">
          <h2 className="text-2xl font-bold text-ink mb-3">Prêt à brancher le suivi ?</h2>
          <p className="text-body text-sm mb-8 max-w-md mx-auto">
            Le marchand active le service et choisit le mode ; vous n’avez plus qu’à suivre la
            section correspondante.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard/order-tracking"
              className="bg-brand text-white px-7 py-3 rounded-card text-sm font-semibold shadow-lg shadow-indigo-200 hover:bg-brand-dark transition-all"
            >
              Ouvrir le suivi des commandes
            </Link>
            <Link
              href="/docs/suivi"
              className="bg-surface text-ink px-7 py-3 rounded-card text-sm font-semibold border border-line hover:bg-page transition-all"
            >
              Guide du marchand
            </Link>
          </div>
        </section>

      </div>
    </>
  )
}
