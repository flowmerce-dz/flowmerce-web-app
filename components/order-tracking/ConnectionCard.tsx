"use client";

// Informations de connexion du webhook : URL, clé API, secret de signature.
//
// Le secret n'existe en clair dans le navigateur qu'à l'instant où il vient
// d'être généré ; il n'est jamais rechargé depuis le serveur.

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { BTN_GHOST, BTN_PRIMARY, Card, CardTitle, FOCUS, Notice } from "@/components/dashboard/ui";
import { CODE, CopyButton, HINT, LABEL, fmtDateTime, type TrackingSettings } from "./shared";

export function ConnectionCard({
  settings,
  onChanged,
}: {
  settings: TrackingSettings;
  onChanged: () => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const { secret, apiKeys, webhookUrl } = settings;

  const generate = async () => {
    if (
      secret.configured &&
      !confirm(
        "Régénérer le secret ? L’ancien cesse immédiatement de fonctionner : les webhooks de votre boutique seront refusés tant que le nouveau secret n’y est pas enregistré.",
      )
    )
      return;

    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/order-tracking/secret", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Génération impossible.");
        return;
      }
      setRevealed(data.secret);
      onChanged();
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card>
      <CardTitle>Connexion du webhook</CardTitle>

      <div className="space-y-5">
        <div>
          <p className={LABEL}>URL du webhook</p>
          <div className="flex items-center gap-2">
            <code className={CODE}>{webhookUrl}</code>
            <CopyButton value={webhookUrl} />
          </div>
          <p className={HINT}>
            Votre boutique y envoie une requête POST à chaque changement de statut d’une commande.
          </p>
        </div>

        <div>
          <p className={LABEL}>Clé API</p>
          {apiKeys.length === 0 ? (
            <p className="text-[13px] text-body">
              Aucune clé active.{" "}
              <Link
                href="/dashboard/api-keys"
                className={`rounded-control font-semibold text-brand-ink hover:underline ${FOCUS}`}
              >
                Créer une clé API
              </Link>
            </p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {apiKeys.map((key) => (
                <li key={key.id} className="flex items-center gap-2">
                  <code className={CODE}>{key.keyPrefix ? `${key.keyPrefix}…` : "••••••••"}</code>
                  <span className="shrink-0 text-[12px] text-body">{key.name}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={HINT}>
            La clé identifie votre boutique, dans l’en-tête X-Flowmerce-Key. Sa valeur complète
            n’est affichée qu’à sa création, sur la page{" "}
            <Link
              href="/dashboard/api-keys"
              className={`rounded-control font-semibold text-brand-ink hover:underline ${FOCUS}`}
            >
              Clés API
            </Link>
            .
          </p>
        </div>

        <div>
          <p className={LABEL}>Secret de signature</p>

          {!secret.storageReady ? (
            <Notice tone="warning" icon={AlertTriangle} title="Génération indisponible">
              Le stockage des secrets n’est pas configuré sur ce déploiement. Contactez le support.
            </Notice>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <code className={CODE}>
                  {revealed ?? (secret.configured ? `${secret.prefix ?? "whsec_"}…` : "Aucun secret généré")}
                </code>
                {revealed && <CopyButton value={revealed} />}
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating}
                  className={`${secret.configured ? BTN_GHOST : BTN_PRIMARY} shrink-0 px-3 py-2`}
                >
                  {generating ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden />
                  ) : (
                    secret.configured && <RefreshCw size={14} aria-hidden />
                  )}
                  {secret.configured ? "Régénérer" : "Générer"}
                </button>
              </div>

              {revealed ? (
                <p
                  role="status"
                  className="mt-2 flex items-start gap-1.5 text-[12px] font-medium text-amber-800"
                >
                  <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
                  Copiez ce secret maintenant : il ne sera plus jamais affiché.
                </p>
              ) : (
                <p className={HINT}>
                  {secret.configured
                    ? `Généré le ${fmtDateTime(secret.createdAt)}. Il signe chaque requête et ne quitte jamais votre serveur.`
                    : "Il signe chaque requête de votre boutique. Sans lui, aucun webhook n’est accepté."}
                </p>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">
              {error}
            </p>
          )}
        </div>

        <div>
          <p className={LABEL}>Signature attendue</p>
          <code className="block overflow-x-auto whitespace-pre rounded-control bg-deep px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-200">
            {`X-Flowmerce-Key:        flk_votre_cle_api
X-Flowmerce-Event-Id:   identifiant unique de l’événement
X-Flowmerce-Timestamp:  secondes Unix de l’envoi
X-Flowmerce-Signature:  HMAC-SHA256(secret, timestamp + "." + event_id + "." + corps)`}
          </code>
          <p className={HINT}>
            La signature est le résultat hexadécimal, calculé sur le corps exact de la requête. Un
            horodatage de plus de 5 minutes est refusé, et un identifiant d’événement déjà reçu
            n’est jamais traité deux fois. Le détail est dans la{" "}
            <Link
              href="/docs/developpeurs/suivi#webhook"
              className={`rounded-control font-semibold text-brand-ink hover:underline ${FOCUS}`}
            >
              documentation développeur
            </Link>
            .
          </p>
        </div>
      </div>
    </Card>
  );
}
