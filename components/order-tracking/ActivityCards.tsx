"use client";

// Journal des événements reçus — quel que soit le mode d'intégration — et
// historique des notifications.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, Inbox } from "lucide-react";
import {
  BTN_GHOST,
  Card,
  EmptyState,
  Notice,
  Pagination,
  Skeleton,
} from "@/components/dashboard/ui";
import { INTEGRATION_MODE_LABELS, type IntegrationMode } from "@/lib/order-tracking/integration";
import { ORDER_STATUS_LABELS, type TrackingStatus } from "@/lib/order-tracking/statuses";
import { Badge, TH, fmtDateTime, type BadgeTone } from "./shared";

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

function useActivity<T>(type: "webhooks" | "notifications", refreshKey: number) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<T> | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(`/api/order-tracking/activity?type=${type}&page=${page}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Chargement impossible");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    }
  }, [type, page]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return { page, setPage, data, error, load };
}

function ActivityShell<T>({
  title,
  caption,
  headers,
  activity,
  empty,
  label,
  renderRow,
}: {
  title: string;
  caption: string;
  headers: string[];
  activity: ReturnType<typeof useActivity<T>>;
  empty: { icon: typeof Bell; title: string; hint: string };
  label: string;
  renderRow: (item: T) => React.ReactNode;
}) {
  const { data, error, load, page, setPage } = activity;

  return (
    <Card padded={false}>
      <div className="border-b border-line px-6 py-4">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      </div>

      {error ? (
        <div className="p-6">
          <Notice
            tone="danger"
            icon={AlertTriangle}
            title="Chargement impossible"
            action={
              <button type="button" onClick={load} className={BTN_GHOST}>
                Réessayer
              </button>
            }
          >
            {error}
          </Notice>
        </div>
      ) : !data ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : data.total === 0 ? (
        <EmptyState icon={empty.icon} title={empty.title} hint={empty.hint} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr className="border-b border-line">
                  {headers.map((h) => (
                    <th key={h} scope="col" className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">{data.items.map(renderRow)}</tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={setPage}
            label={label}
          />
        </>
      )}
    </Card>
  );
}

// ── Événements reçus ─────────────────────────────────────────────────────────

type EventLogItem = {
  id: string;
  source: IntegrationMode;
  eventId: string | null;
  externalOrderId: string | null;
  rawStatus: string | null;
  outcome: string;
  httpStatus: number;
  error: string | null;
  isTest: boolean;
  receivedAt: string;
};

const OUTCOMES: Record<string, { label: string; tone: BadgeTone }> = {
  PROCESSED: { label: "Traité", tone: "positive" },
  TEST_OK: { label: "Test réussi", tone: "positive" },
  STALE: { label: "Arrivé en retard", tone: "info" },
  UNMAPPED: { label: "Statut non reconnu", tone: "warning" },
  DUPLICATE: { label: "Déjà reçu", tone: "neutral" },
  INVALID_SIGNATURE: { label: "Signature invalide", tone: "danger" },
  INVALID_TIMESTAMP: { label: "Horodatage refusé", tone: "danger" },
  INVALID_PAYLOAD: { label: "Corps invalide", tone: "danger" },
  INVALID_REQUEST: { label: "Requête invalide", tone: "danger" },
  NOT_CONFIGURED: { label: "Secret absent", tone: "danger" },
  WRONG_MODE: { label: "Mode webhook inactif", tone: "danger" },
  PULL_ERROR: { label: "Synchronisation échouée", tone: "danger" },
  ERROR: { label: "Erreur interne", tone: "danger" },
};

export function EventLogCard({ refreshKey }: { refreshKey: number }) {
  const activity = useActivity<EventLogItem>("webhooks", refreshKey);

  return (
    <ActivityShell
      title="Journal des événements reçus"
      caption="Changements de statut reçus de la boutique, du plus récent au plus ancien"
      headers={["Reçu le", "Source", "Commande", "Statut reçu", "Résultat", "HTTP"]}
      activity={activity}
      label="événements"
      empty={{
        icon: Inbox,
        title: "Aucun événement reçu",
        hint: "Chaque changement de statut reçu de votre boutique apparaîtra ici, accepté ou refusé, avec la raison.",
      }}
      renderRow={(log) => {
        const outcome = OUTCOMES[log.outcome] ?? { label: log.outcome, tone: "neutral" as const };
        return (
          <tr key={log.id} className="transition-colors hover:bg-page">
            <td className="px-6 py-4 text-[12px] tabular-nums text-body">
              {fmtDateTime(log.receivedAt)}
            </td>
            <td className="px-6 py-4 text-[13px] text-body">
              {INTEGRATION_MODE_LABELS[log.source]?.name ?? log.source}
            </td>
            <td className="px-6 py-4 text-[13px] font-semibold text-ink">
              {log.externalOrderId ?? "—"}
              {log.isTest && <span className="ml-2 text-[11px] font-medium text-faint">Test</span>}
            </td>
            <td className="px-6 py-4 text-[13px] text-body">{log.rawStatus ?? "—"}</td>
            <td className="px-6 py-4">
              <Badge tone={outcome.tone}>{outcome.label}</Badge>
              {log.error && <p className="mt-1 text-[12px] text-body">{log.error}</p>}
            </td>
            <td className="px-6 py-4 text-[12px] tabular-nums text-body">
              {/* 0 : la boutique n'a pas répondu à la synchronisation. */}
              {log.httpStatus || "—"}
            </td>
          </tr>
        );
      }}
    />
  );
}

// ── Notifications ────────────────────────────────────────────────────────────

type NotificationItem = {
  id: string;
  channel: "EMAIL" | "WHATSAPP";
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED";
  orderStatus: TrackingStatus;
  recipient: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  externalOrderId: string;
};

const JOB_STATUS: Record<NotificationItem["status"], { label: string; tone: BadgeTone }> = {
  PENDING: { label: "En attente", tone: "warning" },
  PROCESSING: { label: "En cours d’envoi", tone: "info" },
  SENT: { label: "Envoyée", tone: "positive" },
  FAILED: { label: "Échec", tone: "danger" },
};

const CHANNEL_LABELS = { EMAIL: "E-mail", WHATSAPP: "WhatsApp" } as const;

export function NotificationLogCard({ refreshKey }: { refreshKey: number }) {
  const activity = useActivity<NotificationItem>("notifications", refreshKey);

  return (
    <ActivityShell
      title="Notifications"
      caption="Notifications envoyées aux clients, de la plus récente à la plus ancienne"
      headers={["Créée le", "Commande", "Statut annoncé", "Destinataire", "État", "Tentatives"]}
      activity={activity}
      label="notifications"
      empty={{
        icon: Bell,
        title: "Aucune notification",
        hint: "Les messages envoyés à vos clients apparaîtront ici, avec leur état d’envoi.",
      }}
      renderRow={(job) => {
        const state = JOB_STATUS[job.status];
        return (
          <tr key={job.id} className="transition-colors hover:bg-page">
            <td className="px-6 py-4 text-[12px] tabular-nums text-body">
              {fmtDateTime(job.createdAt)}
            </td>
            <td className="px-6 py-4 text-[13px] font-semibold text-ink">{job.externalOrderId}</td>
            <td className="px-6 py-4 text-[13px] text-body">
              {ORDER_STATUS_LABELS[job.orderStatus]?.fr ?? job.orderStatus}
            </td>
            <td className="px-6 py-4">
              <p className="text-[13px] text-ink">{job.recipient}</p>
              <p className="text-[12px] text-body">{CHANNEL_LABELS[job.channel]}</p>
            </td>
            <td className="px-6 py-4">
              <Badge tone={state.tone}>{state.label}</Badge>
              {job.status === "SENT" && (
                <p className="mt-1 text-[12px] tabular-nums text-body">{fmtDateTime(job.sentAt)}</p>
              )}
              {job.status === "PENDING" && job.attempts > 0 && (
                <p className="mt-1 text-[12px] tabular-nums text-body">
                  Nouvel essai le {fmtDateTime(job.nextAttemptAt)}
                </p>
              )}
              {job.lastError && job.status !== "SENT" && (
                <p className="mt-1 text-[12px] text-body">{job.lastError}</p>
              )}
            </td>
            <td className="px-6 py-4 text-[12px] tabular-nums text-body">
              {job.attempts} / {job.maxAttempts}
            </td>
          </tr>
        );
      }}
    />
  );
}
