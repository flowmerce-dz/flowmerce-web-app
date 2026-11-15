"use client";

// Services de la boutique : Retours-ML et suivi des commandes.
//
// Chaque service s'active et se désactive seul. Le bouton d'un service n'envoie
// que son propre drapeau : l'autre n'est jamais touché.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Inbox, Loader2, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { VendorAccessGuard } from "@/components/vendor/VendorAccessGuard";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  Card,
  CardTitle,
  FOCUS,
  Notice,
  PageHeader,
  Skeleton,
} from "@/components/dashboard/ui";
import { Badge } from "@/components/order-tracking/shared";

type ServiceKey = "returnsML" | "orderTracking";
type Services = Record<ServiceKey, boolean>;

const SERVICES: {
  key: ServiceKey;
  flag: "returnsMLEnabled" | "orderTrackingEnabled";
  title: string;
  description: string;
  disableWarning: string;
  href: string;
  linkLabel: string;
  Icon: LucideIcon;
}[] = [
  {
    key: "orderTracking",
    flag: "orderTrackingEnabled",
    title: "Suivi des commandes",
    description:
      "Votre boutique transmet chaque changement de statut d’une commande. Flowmerce en garde l’historique et prévient vos clients.",
    disableWarning:
      "Désactiver le suivi des commandes ? Les changements de statut de votre boutique ne seront plus pris en compte et plus aucun client ne sera prévenu. Vos réglages et l’historique sont conservés.",
    href: "/dashboard/order-tracking",
    linkLabel: "Configurer le suivi",
    Icon: Truck,
  },
  {
    key: "returnsML",
    flag: "returnsMLEnabled",
    title: "Retours-ML",
    description:
      "Vos clients déposent leurs demandes de retour. Flowmerce les instruit selon votre politique et vous propose une décision.",
    disableWarning:
      "Désactiver Retours-ML ? Votre boutique ne pourra plus transmettre de demande de retour et les liens de retour déjà envoyés cesseront de fonctionner. Vos réclamations et votre politique sont conservées.",
    href: "/dashboard/return-policy",
    linkLabel: "Configurer la politique de retour",
    Icon: Inbox,
  },
];

export default function ServicesPage() {
  const [services, setServices] = useState<Services | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<ServiceKey | null>(null);
  const [error, setError] = useState("");

  const fetchServices = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/vendors/services");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chargement impossible");
      setServices(data.services);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Chargement impossible");
    }
  }, []);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const toggle = async (service: (typeof SERVICES)[number]) => {
    if (!services) return;
    const next = !services[service.key];
    if (!next && !confirm(service.disableWarning)) return;

    setPending(service.key);
    setError("");
    try {
      const res = await fetch("/api/vendors/services", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [service.flag]: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Modification impossible.");
        return;
      }
      setServices(data.services);
      // La navigation latérale dépend des services activés.
      window.location.reload();
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="w-full max-w-3xl p-5 sm:p-10">
      <VendorAccessGuard />

      <PageHeader
        title="Services"
        subtitle="Activez les services dont votre boutique a besoin. Chacun fonctionne seul, avec ses propres réglages."
      />

      <div className="space-y-5">
        {loadError ? (
          <Notice
            tone="danger"
            icon={AlertTriangle}
            title="Chargement impossible"
            action={
              <button type="button" onClick={fetchServices} className={BTN_GHOST}>
                Réessayer
              </button>
            }
          >
            {loadError}
          </Notice>
        ) : !services ? (
          <Card className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-4 w-48" />
          </Card>
        ) : (
          SERVICES.map((service) => {
            const enabled = services[service.key];
            const { Icon } = service;
            return (
              <Card key={service.key}>
                <CardTitle
                  aside={
                    <Badge tone={enabled ? "positive" : "neutral"}>
                      {enabled ? "Activé" : "Désactivé"}
                    </Badge>
                  }
                >
                  <span className="flex items-center gap-2">
                    <Icon size={15} strokeWidth={1.75} className="text-brand-ink" aria-hidden />
                    {service.title}
                  </span>
                </CardTitle>
                <p className="mb-4 text-[13px] text-body">{service.description}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggle(service)}
                    disabled={pending !== null}
                    className={enabled ? BTN_GHOST : BTN_PRIMARY}
                  >
                    {pending === service.key && (
                      <Loader2 size={15} className="animate-spin" aria-hidden />
                    )}
                    {enabled ? "Désactiver" : "Activer"}
                  </button>
                  {/* Les pages de Retours-ML ne s'ouvrent que service activé ; celle
                      du suivi sert aussi à le préparer avant activation. */}
                  {(enabled || service.key === "orderTracking") && (
                    <Link
                      href={service.href}
                      className={`rounded-control text-[12px] font-semibold text-brand-ink hover:underline ${FOCUS}`}
                    >
                      {service.linkLabel}
                    </Link>
                  )}
                </div>
              </Card>
            );
          })
        )}

        {error && (
          <p role="alert" className="text-[13px] font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
