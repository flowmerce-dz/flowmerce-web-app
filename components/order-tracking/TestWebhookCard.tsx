"use client";

// Envoi d'un webhook de test : même traitement qu'un envoi réel de la boutique,
// sans rien enregistrer d'autre qu'une ligne du journal.

import { useState } from "react";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { BTN_PRIMARY, Card, CardTitle, FIELD, Notice } from "@/components/dashboard/ui";
import { ORDER_STATUS_LABELS, type TrackingStatus } from "@/lib/order-tracking/statuses";
import { HINT, LABEL } from "./shared";

type TestReport = {
  ok: boolean;
  httpStatus: number;
  response: {
    error?: string;
    status?: TrackingStatus;
    would_notify?: boolean;
  };
};

export function TestWebhookCard({ onSent }: { onSent: () => void }) {
  const [status, setStatus] = useState("Expédiée");
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<TestReport | null>(null);
  const [error, setError] = useState("");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError("");
    setReport(null);
    try {
      const res = await fetch("/api/order-tracking/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Envoi impossible.");
        return;
      }
      setReport(data);
      onSent();
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setSending(false);
    }
  };

  const normalized = report?.response.status;

  return (
    <Card>
      <CardTitle>Webhook de test</CardTitle>

      <form onSubmit={send}>
        <label htmlFor="test-status" className={LABEL}>
          Statut à essayer
        </label>
        <div className="flex gap-2">
          <input
            id="test-status"
            type="text"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            maxLength={100}
            required
            aria-describedby="test-status-hint"
            className={FIELD}
          />
          <button type="submit" disabled={sending} className={`${BTN_PRIMARY} shrink-0`}>
            {sending ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Send size={15} strokeWidth={2} aria-hidden />
            )}
            {sending ? "Envoi" : "Envoyer un test"}
          </button>
        </div>
        <p id="test-status-hint" className={HINT}>
          Flowmerce signe un événement fictif avec votre secret et le traite comme un envoi de
          votre boutique. Aucune commande n’est créée et aucun client n’est prévenu.
        </p>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-red-700">
          {error}
        </p>
      )}

      {report && (
        <div className="mt-5" role="status">
          {report.ok ? (
            <Notice icon={CheckCircle2} title={`Webhook accepté — HTTP ${report.httpStatus}`}>
              {normalized === "UNMAPPED" ? (
                <p>
                  Le statut « {status} » n’a pas de correspondance : il serait enregistré comme
                  non reconnu. Ajoutez-le dans la correspondance des statuts.
                </p>
              ) : (
                normalized && (
                  <p>
                    « {status} » correspond au statut{" "}
                    <strong>{ORDER_STATUS_LABELS[normalized].fr}</strong>.{" "}
                    {report.response.would_notify
                      ? "Le client serait prévenu."
                      : "Ce statut ne prévient pas le client."}
                  </p>
                )
              )}
            </Notice>
          ) : (
            <Notice tone="danger" icon={XCircle} title={`Webhook refusé — HTTP ${report.httpStatus}`}>
              {report.response.error ?? "Le traitement a échoué."}
            </Notice>
          )}
        </div>
      )}
    </Card>
  );
}
