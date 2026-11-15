"use client";

// Mode connecteur : catalogue des services auprès desquels Flowmerce peut lire
// les statuts. Le catalogue vient du serveur (lib/order-tracking/connectors.ts) ;
// un connecteur à venir y figure sans pouvoir être choisi.

import { Plug } from "lucide-react";
import { Card, CardTitle, EmptyState } from "@/components/dashboard/ui";
import { Badge, HINT, LABEL, type TrackingSettings } from "./shared";

const FAMILIES = [
  { key: "carrier", label: "Sociétés de livraison" },
  { key: "platform", label: "Plateformes e-commerce" },
] as const;

export function ConnectorsCard({ settings }: { settings: TrackingSettings }) {
  const { connectors, connectorId, mode } = settings.integration;

  return (
    <Card>
      <CardTitle>Connecteurs</CardTitle>

      <p className="mb-5 text-[13px] text-body">
        Un connecteur lit les statuts directement chez un service que vous utilisez déjà : vous
        n’avez qu’à fournir vos identifiants, sans rien développer dans votre boutique.
      </p>

      {connectors.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="Aucun connecteur"
          hint="Les connecteurs disponibles apparaîtront ici."
        />
      ) : (
        <div className="space-y-5">
          {FAMILIES.map((family) => {
            const items = connectors.filter((c) => c.family === family.key);
            if (items.length === 0) return null;
            return (
              <div key={family.key}>
                <p className={LABEL}>{family.label}</p>
                <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
                  {items.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-start justify-between gap-3 rounded-control border border-line bg-page px-3 py-3"
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink">{c.name}</span>
                        <span className="mt-0.5 block text-[12px] text-body">{c.description}</span>
                      </span>
                      {mode === "CONNECTOR" && c.id === connectorId ? (
                        <Badge tone="positive">Connecté</Badge>
                      ) : (
                        <Badge tone="neutral">{c.available ? "Disponible" : "Bientôt disponible"}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <p className={HINT}>
        En attendant, le webhook et le polling couvrent toutes les boutiques qui disposent d’un
        développeur.
      </p>
    </Card>
  );
}
