"use client";

// components/claims/AmendDecision.tsx — Flowmerce
//
// Correction d'une décision déjà rendue (audit RedStone RS-01), par le
// marchand sur ses réclamations ou par l'administrateur. Une réclamation
// tranchée ne bascule plus par la décision ordinaire : elle se corrige ici,
// avec un motif obligatoire inscrit dans l'historique.
//
// Même présentation que la modale de décision (ClaimActions).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, PenLine, AlertTriangle } from "lucide-react";
import { VENDOR_DECISION_LABELS, type VendorDecision } from "@/lib/constants";
import { AMENDMENT_REASON_MAX, AMENDMENT_REASON_MIN } from "@/lib/claim-transitions";

type Props = {
  claimId:         string;
  currentDecision: string | null;
  /** `admin` : route admin (toutes boutiques). `vendor` : route du marchand. */
  scope?:          "admin" | "vendor";
  /**
   * Résolutions que le serveur acceptera (politique de retour + demande du
   * client, plus le refus). Absent : les quatre sont proposées et le serveur
   * tranche.
   */
  allowed?:        readonly VendorDecision[];
};

const RESOLUTION_OPTIONS: { value: VendorDecision; dot: string; cls: string }[] = [
  { value: "Exchange", dot: "bg-blue-500",    cls: "border-blue-300 bg-blue-50 text-blue-800"          },
  { value: "Repair",   dot: "bg-amber-400",   cls: "border-amber-300 bg-amber-50 text-amber-800"       },
  { value: "Refund",   dot: "bg-emerald-500", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  { value: "Reject",   dot: "bg-red-500",     cls: "border-red-300 bg-red-50 text-red-800"             },
];

export function AmendDecision({ claimId, currentDecision, scope = "admin", allowed }: Props) {
  const router = useRouter();

  const [open,       setOpen]       = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [resolution, setResolution] = useState<VendorDecision | "">("");
  const [reason,     setReason]     = useState("");
  const [notify,     setNotify]     = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const reasonLength = reason.trim().length;
  const reasonOk     = reasonLength >= AMENDMENT_REASON_MIN && reasonLength <= AMENDMENT_REASON_MAX;
  const unchanged    = resolution !== "" && resolution === currentDecision;
  const canSubmit    = !!resolution && !unchanged && reasonOk && !loading;
  const options      = allowed
    ? RESOLUTION_OPTIONS.filter(opt => allowed.includes(opt.value))
    : RESOLUTION_OPTIONS;
  const missing      = Math.max(AMENDMENT_REASON_MIN - reasonLength, 0);

  const submit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const endpoint = scope === "admin"
      ? `/api/admin/claims/${claimId}/amend`
      : `/api/claims/${claimId}/amend`;
    const res = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ aiDecision: resolution, reason: reason.trim(), notifyCustomer: notify }),
    }).catch(() => null);

    setLoading(false);

    if (!res?.ok) {
      const detail = await res?.json().catch(() => null);
      setError(detail?.error ?? "La correction a échoué. Réessayez.");
      return;
    }

    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button
        onClick={() => { setResolution(""); setReason(""); setNotify(true); setError(null); setOpen(true); }}
        className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 flex items-center gap-1 w-fit"
      >
        <PenLine className="w-3 h-3" />
        Corriger la décision
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="amend-title"
            className="my-auto w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 id="amend-title" className="text-sm font-semibold text-gray-900">Corriger la décision</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  La correction et son motif restent dans l&apos;historique de la réclamation.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Décision actuelle</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">
                  {currentDecision
                    ? VENDOR_DECISION_LABELS[currentDecision as VendorDecision] ?? currentDecision
                    : "—"}
                </p>
              </div>

              <fieldset>
                <legend className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Nouvelle décision <span className="text-red-400 font-normal normal-case">*</span>
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {options.map(opt => {
                    const isCurrent = opt.value === currentDecision;
                    return (
                      <label
                        key={opt.value}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all ${
                          isCurrent
                            ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed opacity-60"
                            : resolution === opt.value
                              ? opt.cls + " border-current cursor-pointer"
                              : "border-gray-200 hover:border-gray-300 bg-gray-50 text-gray-500 cursor-pointer"
                        }`}
                      >
                        <input
                          type="radio"
                          name="amend-resolution"
                          value={opt.value}
                          checked={resolution === opt.value}
                          disabled={isCurrent}
                          onChange={() => setResolution(opt.value)}
                          className="sr-only"
                        />
                        <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />
                        <span className="text-xs font-medium">{VENDOR_DECISION_LABELS[opt.value]}</span>
                        {isCurrent && <span className="ml-auto text-[10px] uppercase tracking-wide">actuelle</span>}
                      </label>
                    );
                  })}
                </div>
                {allowed && (
                  <p className="text-xs text-gray-400 mt-2">
                    Seules les résolutions prévues par la politique de retour ou demandées par le client sont proposées.
                  </p>
                )}
                {unchanged && (
                  <p className="text-xs text-amber-700 mt-2">C&apos;est déjà la décision actuelle.</p>
                )}
              </fieldset>

              <div>
                <label htmlFor="amend-reason" className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Motif de la correction <span className="text-red-400 font-normal normal-case">*</span>
                </label>
                <textarea
                  id="amend-reason"
                  rows={3}
                  value={reason}
                  maxLength={AMENDMENT_REASON_MAX}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Pourquoi la décision change (note interne, non envoyée au client)…"
                  aria-describedby="amend-reason-hint"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition"
                />
                <p
                  id="amend-reason-hint"
                  className={`text-xs mt-1 ${missing > 0 && reasonLength > 0 ? "text-amber-700" : "text-gray-400"}`}
                >
                  {missing > 0
                    ? `Encore ${missing} caractère${missing > 1 ? "s" : ""} (au moins ${AMENDMENT_REASON_MIN}).`
                    : `${reasonLength} / ${AMENDMENT_REASON_MAX} caractères.`}
                </p>
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notify}
                  onChange={e => setNotify(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Prévenir le client de la nouvelle décision</span>
              </label>

              {error && (
                <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {error}
                </p>
              )}
            </div>

            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 bg-indigo-600 hover:bg-indigo-700"
              >
                {loading ? "Enregistrement…" : "Enregistrer la correction"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
