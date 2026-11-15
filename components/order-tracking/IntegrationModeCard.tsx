"use client";

// Choix du mode d'intégration : webhook, polling ou connecteur.
//
// Le vendeur peut consulter et préparer chaque mode ; un seul est actif. Le
// changement de mode est une action explicite, confirmée, parce qu'il coupe
// la source précédente.

import { CheckCircle2, Loader2 } from "lucide-react";
import { BTN_PRIMARY, Card, CardTitle } from "@/components/dashboard/ui";
import {
  INTEGRATION_MODES,
  INTEGRATION_MODE_LABELS,
  type IntegrationMode,
} from "@/lib/order-tracking/integration";
import { Badge, CHOICE, HINT, useSave, type SaveSettings, type TrackingSettings } from "./shared";

const SWITCH_WARNING: Record<IntegrationMode, string> = {
  WEBHOOK:
    "Passer en mode webhook ? Flowmerce cessera d’interroger votre boutique : seuls les envois de votre boutique seront pris en compte.",
  POLLING:
    "Passer en mode polling ? Les webhooks de votre boutique seront refusés : Flowmerce lira lui-même les changements, à partir de maintenant.",
  CONNECTOR:
    "Passer en mode connecteur ? Les webhooks de votre boutique seront refusés : Flowmerce lira les statuts chez le service connecté, à partir de maintenant.",
};

export function IntegrationModeCard({
  settings,
  viewed,
  onView,
  save,
}: {
  settings: TrackingSettings;
  viewed: IntegrationMode;
  onView: (mode: IntegrationMode) => void;
  save: SaveSettings;
}) {
  const { saving, error, run } = useSave(save);
  const { mode: active, polling, connectors, connectorId } = settings.integration;

  // Ce qui manque avant de pouvoir utiliser le mode consulté.
  const missing =
    viewed === "POLLING" && !polling.url
      ? "Enregistrez d’abord l’URL de votre boutique, ci-dessous."
      : viewed === "CONNECTOR" && !connectors.some((c) => c.available && c.id === connectorId)
        ? "Aucun connecteur n’est encore disponible."
        : null;

  const activate = () => {
    if (!confirm(SWITCH_WARNING[viewed])) return;
    run({ integrationMode: viewed });
  };

  return (
    <Card>
      <CardTitle>Mode d’intégration</CardTitle>

      <p className="mb-4 text-[13px] text-body">
        La façon dont les changements de statut de vos commandes arrivent chez Flowmerce. Un seul
        mode est actif à la fois ; les statuts, les notifications et les messages se règlent de la
        même manière quel que soit le mode.
      </p>

      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">Mode d’intégration à consulter</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {INTEGRATION_MODES.map((mode) => (
            <label
              key={mode}
              className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                viewed === mode ? "border-brand bg-brand-soft" : "border-line bg-surface"
              }`}
            >
              <input
                type="radio"
                name="integration-mode"
                value={mode}
                checked={viewed === mode}
                onChange={() => onView(mode)}
                className={CHOICE}
              />
              <span className="min-w-0 text-[13px] font-medium text-ink">
                <span className="flex flex-wrap items-center gap-2">
                  {INTEGRATION_MODE_LABELS[mode].name}
                  {active === mode && <Badge tone="positive">Actif</Badge>}
                </span>
                <span className="mt-1 block text-[12px] font-normal text-body">
                  {INTEGRATION_MODE_LABELS[mode].summary}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {viewed === active ? (
        <p className="mt-4 flex items-center gap-1.5 text-[13px] font-semibold text-green-700">
          <CheckCircle2 size={14} aria-hidden />
          C’est le mode utilisé par votre boutique.
        </p>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={activate}
            disabled={saving || Boolean(missing)}
            className={BTN_PRIMARY}
          >
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Utiliser le mode {INTEGRATION_MODE_LABELS[viewed].name.toLowerCase()}
          </button>
          <p className={HINT}>
            {missing ??
              `Votre boutique est actuellement en mode ${INTEGRATION_MODE_LABELS[
                active
              ].name.toLowerCase()}. Vous pouvez préparer ce mode avant de l’utiliser.`}
          </p>
          {error && (
            <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
