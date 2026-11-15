"use client";

/**
 * VendorAccessGuard
 * À placer en haut des pages client du dashboard (api-keys, return-policy).
 * Redirige vers /dashboard si le compte est bloqué.
 *
 * `service` : la page appartient à un service. Si la boutique ne l'a pas
 * activé, redirige vers /dashboard/services. Sans cette option, seul le statut
 * du compte est contrôlé.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function VendorAccessGuard({
  service,
}: {
  service?: "returnsML" | "orderTracking";
} = {}) {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/vendors/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.noVendor || data.isBlocked) {
          router.replace("/dashboard");
        } else if (service && data.services && data.services[service] === false) {
          router.replace("/dashboard/services");
        }
      })
      .catch(() => {});
  }, [router, service]);

  return null;
}
