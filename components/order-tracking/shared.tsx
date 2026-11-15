"use client";

// Pièces communes aux sections de la page « Suivi des commandes ».

import { useState } from "react";
import { Check, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, FOCUS } from "@/components/dashboard/ui";
import type { IntegrationMode } from "@/lib/order-tracking/integration";
import type { Language, MappableStatus, TrackingStatus } from "@/lib/order-tracking/statuses";

export type ChannelKey = "EMAIL" | "WHATSAPP";

export type TrackingSettings = {
  enabled: boolean;
  webhookUrl: string;
  secret: {
    storageReady: boolean;
    configured: boolean;
    prefix: string | null;
    createdAt: string | null;
  };
  apiKeys: { id: string; name: string; keyPrefix: string | null }[];
  /** Mode d'intégration actif et état de chaque source. */
  integration: {
    mode: IntegrationMode;
    polling: { url: string | null; tokenConfigured: boolean };
    connectorId: string | null;
    connectors: {
      id: string;
      name: string;
      family: "carrier" | "platform";
      description: string;
      available: boolean;
    }[];
    sync: {
      startedAt: string | null;
      lastRunAt: string | null;
      lastOk: boolean | null;
      lastError: string | null;
      lastEvents: number | null;
    };
  };
  mappings: { id: string; externalStatus: string; status: MappableStatus }[];
  unmappedStatuses: { rawStatus: string; count: number; lastSeenAt: string | null }[];
  /** Statuts déclarés par la boutique, avec leur statut normalisé. */
  storeStatuses: {
    declared: boolean;
    declaredAt: string | null;
    items: { label: string; status: TrackingStatus }[];
  };
  /** Statuts à proposer au vendeur : ceux de sa boutique. */
  activeStatuses: MappableStatus[];
  /** Nom de chaque statut tel que la boutique le nomme. */
  statusLabels: Record<MappableStatus, string>;
  notifyStatuses: MappableStatus[];
  notificationChannel: ChannelKey;
  channels: { channel: ChannelKey; label: string; available: boolean }[];
  defaultLanguage: Language;
  templates: Record<
    MappableStatus,
    Record<Language, { subject: string; body: string; custom: boolean }>
  >;
};

/** Enregistre une partie des réglages. Retourne un message d'erreur, ou null. */
export type SaveSettings = (patch: Record<string, unknown>) => Promise<string | null>;

export const LABEL = "mb-2 block text-[13px] font-semibold text-ink";
export const HINT = "mt-1.5 text-[12px] text-faint";
export const CODE =
  "min-w-0 flex-1 truncate rounded-control border border-line bg-page px-3 py-2 font-mono text-[12px] text-ink";
export const CHOICE = `mt-0.5 accent-indigo-600 ${FOCUS}`;
export const TH =
  "px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint";

export const fmtDateTime = (v: string | null) =>
  v
    ? new Date(v).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// Même échelle sémantique fermée que les statuts de réclamation.
const BADGE_TONE = {
  neutral: "bg-page text-body",
  positive: "bg-green-50 text-green-800",
  warning: "bg-amber-50 text-amber-800",
  danger: "bg-red-50 text-red-800",
  info: "bg-blue-50 text-blue-800",
} as const;

export type BadgeTone = keyof typeof BADGE_TONE;

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function CopyButton({ value, label = "Copier" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button type="button" onClick={copy} className={`${BTN_GHOST} shrink-0 px-3 py-2`}>
      {copied ? (
        <>
          <Check size={14} className="text-green-700" aria-hidden />
          Copié
        </>
      ) : (
        <>
          <Copy size={14} aria-hidden />
          {label}
        </>
      )}
    </button>
  );
}

/** Bouton d'enregistrement d'une section, avec ses retours de succès et d'erreur. */
export function SaveRow({
  saving,
  saved,
  error,
  onSave,
  disabled,
}: {
  saving: boolean;
  saved: boolean;
  error: string;
  onSave: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button type="button" onClick={onSave} disabled={saving || disabled} className={BTN_PRIMARY}>
        {saving && <Loader2 size={15} className="animate-spin" aria-hidden />}
        {saving ? "Enregistrement" : "Enregistrer"}
      </button>
      {saved && (
        <span
          role="status"
          className="flex items-center gap-1.5 text-[13px] font-semibold text-green-700"
        >
          <CheckCircle2 size={14} aria-hidden />
          Enregistré
        </span>
      )}
      {error && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** État d'un enregistrement de section : en cours, réussi, en erreur. */
export function useSave(save: SaveSettings) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const run = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setSaved(false);
    setError("");
    const failure = await save(patch);
    setSaving(false);
    if (failure) {
      setError(failure);
      return false;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    return true;
  };

  return { saving, saved, error, run };
}
