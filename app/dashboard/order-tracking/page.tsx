"use client";

// Intégration → Suivi des commandes.
//
// Page du service de suivi, indépendante de Retours-ML : elle ne lit ni la
// politique de retour ni les réclamations, et reste accessible que Retours-ML
// soit activé ou non.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Power } from "lucide-react";
import { VendorAccessGuard } from "@/components/vendor/VendorAccessGuard";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  Card,
  CardTitle,
  Notice,
  PageHeader,
  Skeleton,
} from "@/components/dashboard/ui";
import { ConnectionCard } from "@/components/order-tracking/ConnectionCard";
import { ConnectorsCard } from "@/components/order-tracking/ConnectorsCard";
import { IntegrationModeCard } from "@/components/order-tracking/IntegrationModeCard";
import { PollingCard } from "@/components/order-tracking/PollingCard";
import { StatusMappingCard } from "@/components/order-tracking/StatusMappingCard";
import {
  MessageTemplatesCard,
  NotificationsCard,
} from "@/components/order-tracking/NotificationsCard";
import { TestWebhookCard } from "@/components/order-tracking/TestWebhookCard";
import {
  EventLogCard,
  NotificationLogCard,
} from "@/components/order-tracking/ActivityCards";
import { Badge, type SaveSettings, type TrackingSettings } from "@/components/order-tracking/shared";
import type { IntegrationMode } from "@/lib/order-tracking/integration";

export default function OrderTrackingPage() {
  const [settings, setSettings] = useState<TrackingSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState("");
  // Incrémenté pour recharger les journaux après un test ou une synchronisation.
  const [activityKey, setActivityKey] = useState(0);
  const refreshActivity = () => setActivityKey((k) => k + 1);
  // Mode consulté ; par défaut, celui que la boutique utilise.
  const [viewMode, setViewMode] = useState<IntegrationMode | null>(null);
  const viewed = viewMode ?? settings?.integration.mode ?? "WEBHOOK";

  const fetchSettings = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/order-tracking/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chargement impossible");
      setSettings(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Chargement impossible");
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const save: SaveSettings = useCallback(
    async (patch) => {
      try {
        const res = await fetch("/api/order-tracking/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) return data.error || "Enregistrement impossible.";
        await fetchSettings();
        return null;
      } catch {
        return "Impossible de contacter le serveur.";
      }
    },
    [fetchSettings],
  );

  const toggleService = async () => {
    if (!settings) return;
    const next = !settings.enabled;
    if (
      !next &&
      !confirm(
        "Désactiver le suivi des commandes ? Les changements de statut de votre boutique ne seront plus pris en compte et plus aucun client ne sera prévenu. Vos réglages et l’historique sont conservés.",
      )
    )
      return;

    setToggling(true);
    setToggleError("");
    try {
      const res = await fetch("/api/vendors/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderTrackingEnabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToggleError(data.error || "Modification impossible.");
        return;
      }
      await fetchSettings();
    } catch {
      setToggleError("Impossible de contacter le serveur.");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="w-full max-w-5xl p-5 sm:p-10">
      <VendorAccessGuard />

      <PageHeader
        title="Suivi des commandes"
        subtitle="Recevez les changements de statut de vos commandes et prévenez vos clients automatiquement."
      />

      {loadError ? (
        <Notice
          tone="danger"
          icon={AlertTriangle}
          title="Chargement impossible"
          action={
            <button type="button" onClick={fetchSettings} className={BTN_GHOST}>
              Réessayer
            </button>
          }
        >
          {loadError}
        </Notice>
      ) : !settings ? (
        <div className="space-y-5">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-4 w-64" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <Card>
            <CardTitle
              aside={
                <Badge tone={settings.enabled ? "positive" : "neutral"}>
                  {settings.enabled ? "Activé" : "Désactivé"}
                </Badge>
              }
            >
              Service
            </CardTitle>
            <p className="mb-4 text-[13px] text-body">
              {settings.enabled
                ? "Les changements de statut de votre boutique sont pris en compte et vos clients sont prévenus selon vos réglages."
                : "Le suivi est désactivé : aucun changement de statut n’est pris en compte. Vous pouvez préparer tous les réglages avant de l’activer."}
            </p>
            <button
              type="button"
              onClick={toggleService}
              disabled={toggling}
              className={settings.enabled ? BTN_GHOST : BTN_PRIMARY}
            >
              {toggling ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : settings.enabled ? (
                <Power size={15} strokeWidth={2} aria-hidden />
              ) : (
                <CheckCircle2 size={15} strokeWidth={2} aria-hidden />
              )}
              {settings.enabled ? "Désactiver le suivi" : "Activer le suivi"}
            </button>
            {toggleError && (
              <p role="alert" className="mt-3 text-[13px] font-medium text-red-700">
                {toggleError}
              </p>
            )}
          </Card>

          {/* Source des statuts : propre à chaque mode d'intégration. */}
          <IntegrationModeCard
            settings={settings}
            viewed={viewed}
            onView={setViewMode}
            save={save}
          />
          {viewed === "WEBHOOK" && (
            <>
              <ConnectionCard settings={settings} onChanged={fetchSettings} />
              <TestWebhookCard onSent={refreshActivity} />
            </>
          )}
          {viewed === "POLLING" && (
            <PollingCard
              settings={settings}
              save={save}
              onSynced={() => {
                fetchSettings();
                refreshActivity();
              }}
            />
          )}
          {viewed === "CONNECTOR" && <ConnectorsCard settings={settings} />}

          {/* Commun aux trois modes. */}
          <StatusMappingCard settings={settings} save={save} />
          <NotificationsCard settings={settings} save={save} />
          <MessageTemplatesCard settings={settings} save={save} />
          <EventLogCard refreshKey={activityKey} />
          <NotificationLogCard refreshKey={activityKey} />
        </div>
      )}
    </div>
  );
}
