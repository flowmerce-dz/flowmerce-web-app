"use client";

// Mode polling : l'URL que Flowmerce interroge, son jeton, et l'état de la
// dernière synchronisation.
//
// Le jeton est en écriture seule : une fois enregistré, il n'est plus jamais
// renvoyé au navigateur.

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { BTN_GHOST, Card, CardTitle, FIELD, FOCUS, Notice } from "@/components/dashboard/ui";
import {
  HINT,
  LABEL,
  SaveRow,
  fmtDateTime,
  useSave,
  type SaveSettings,
  type TrackingSettings,
} from "./shared";

type SyncResult =
  | { ok: true; processed: number; notifications: number }
  | { ok: false; message: string };

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function PollingCard({
  settings,
  save,
  onSynced,
}: {
  settings: TrackingSettings;
  save: SaveSettings;
  onSynced: () => void;
}) {
  const { mode, polling, sync } = settings.integration;
  const active = mode === "POLLING";

  const [url, setUrl] = useState(polling.url ?? "");
  const [token, setToken] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const { saving, saved, error, run } = useSave(save);

  useEffect(() => {
    setUrl(polling.url ?? "");
  }, [polling.url]);

  const onSave = async () => {
    const patch: { url: string; token?: string } = { url: url.trim() };
    if (token.trim()) patch.token = token.trim();
    if (await run({ polling: patch })) setToken("");
  };

  const removeToken = () => {
    if (confirm("Supprimer le jeton ? Flowmerce interrogera votre boutique sans authentification.")) {
      run({ polling: { token: null } });
    }
  };

  const synchronize = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/order-tracking/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setResult({ ok: false, message: data.error || "Synchronisation impossible." });
      else if (data.status === "error") setResult({ ok: false, message: data.error });
      else setResult({ ok: true, processed: data.processed, notifications: data.notifications });
      onSynced();
    } catch {
      setResult({ ok: false, message: "Impossible de contacter le serveur." });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardTitle>Connexion par polling</CardTitle>

      <div className="space-y-5">
        <div>
          <label htmlFor="polling-url" className={LABEL}>
            URL de votre boutique
          </label>
          <input
            id="polling-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://votre-boutique.com/api/flowmerce/order-events"
            maxLength={2000}
            className={FIELD}
          />
          <p className={HINT}>
            Flowmerce y envoie une requête GET et y lit les commandes dont le statut a changé. Le
            format attendu est décrit dans la{" "}
            <Link
              href="/docs/developpeurs/suivi#polling"
              className={`rounded-control font-semibold text-brand-ink hover:underline ${FOCUS}`}
            >
              documentation développeur
            </Link>
            .
          </p>
        </div>

        <div>
          <label htmlFor="polling-token" className={LABEL}>
            Jeton d’accès
          </label>
          <input
            id="polling-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              polling.tokenConfigured ? "Laisser vide pour conserver le jeton enregistré" : "Facultatif"
            }
            maxLength={500}
            className={FIELD}
          />
          <p className={HINT}>
            {polling.tokenConfigured
              ? "Un jeton est enregistré. Il est envoyé dans l’en-tête Authorization: Bearer et n’est plus jamais affiché. "
              : "S’il est renseigné, il est envoyé dans l’en-tête Authorization: Bearer. Recommandé : sans lui, votre URL répond à n’importe qui. "}
            {polling.tokenConfigured && (
              <button
                type="button"
                onClick={removeToken}
                className={`rounded-control font-semibold text-red-700 hover:underline ${FOCUS}`}
              >
                Supprimer le jeton
              </button>
            )}
          </p>
        </div>
      </div>

      <SaveRow saving={saving} saved={saved} error={error} onSave={onSave} disabled={!url.trim()} />

      <div className="mt-6 border-t border-line pt-5">
        <p className={LABEL}>Synchronisation</p>

        {!active ? (
          <p className="text-[13px] text-body">
            Ce mode n’est pas utilisé par votre boutique : Flowmerce n’interroge pas cette URL.
          </p>
        ) : sync.lastRunAt === null ? (
          <p className="text-[13px] text-body">
            Aucune synchronisation pour l’instant. Seuls les changements postérieurs au{" "}
            {fmtDateTime(sync.startedAt)} seront annoncés à vos clients.
          </p>
        ) : sync.lastOk ? (
          <p className="flex items-start gap-1.5 text-[13px] text-body">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green-700" aria-hidden />
            <span>
              Dernière synchronisation le {fmtDateTime(sync.lastRunAt)} :{" "}
              {plural(sync.lastEvents ?? 0, "nouvel événement", "nouveaux événements")}.
            </span>
          </p>
        ) : (
          <Notice
            tone="danger"
            icon={AlertTriangle}
            title={`Échec de la synchronisation du ${fmtDateTime(sync.lastRunAt)}`}
          >
            {sync.lastError}
          </Notice>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={synchronize}
            disabled={syncing || !active || !settings.enabled}
            className={BTN_GHOST}
          >
            {syncing ? (
              <Loader2 size={14} className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw size={14} aria-hidden />
            )}
            {syncing ? "Synchronisation" : "Synchroniser maintenant"}
          </button>
          {result?.ok && (
            <span
              role="status"
              className="flex items-center gap-1.5 text-[13px] font-semibold text-green-700"
            >
              <CheckCircle2 size={14} aria-hidden />
              Connexion réussie :{" "}
              {plural(result.processed, "nouvel événement", "nouveaux événements")},{" "}
              {plural(result.notifications, "notification", "notifications")}.
            </span>
          )}
          {result && !result.ok && (
            <p role="alert" className="text-[13px] font-medium text-red-700">
              {result.message}
            </p>
          )}
        </div>
        <p className={HINT}>
          {active && !settings.enabled
            ? "Activez le suivi des commandes pour synchroniser."
            : "Flowmerce synchronise aussi votre boutique automatiquement, à intervalle régulier."}
        </p>
      </div>
    </Card>
  );
}
