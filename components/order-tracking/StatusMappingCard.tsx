"use client";

// Correspondance entre les statuts de la boutique et les statuts normalisés.

import { useEffect, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { BTN_GHOST, Card, CardTitle, FIELD, FOCUS, Notice } from "@/components/dashboard/ui";
import {
  MAPPABLE_STATUSES,
  ORDER_STATUS_LABELS,
  normalizeStatusKey,
  type MappableStatus,
} from "@/lib/order-tracking/statuses";
import {
  Badge,
  HINT,
  LABEL,
  SaveRow,
  fmtDateTime,
  useSave,
  type SaveSettings,
  type TrackingSettings,
} from "./shared";

type Row = { key: string; externalStatus: string; status: MappableStatus };

let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

function StatusSelect({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: MappableStatus;
  onChange: (status: MappableStatus) => void;
  label: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as MappableStatus)}
      className={FIELD}
    >
      {MAPPABLE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {ORDER_STATUS_LABELS[s].fr}
        </option>
      ))}
    </select>
  );
}

export function StatusMappingCard({
  settings,
  save,
}: {
  settings: TrackingSettings;
  save: SaveSettings;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const { saving, saved, error, run } = useSave(save);

  // Repart des correspondances enregistrées à chaque rechargement des réglages.
  useEffect(() => {
    setRows(
      settings.mappings.map((m) => ({
        key: m.id,
        externalStatus: m.externalStatus,
        status: m.status,
      })),
    );
  }, [settings.mappings]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const add = (externalStatus = "") =>
    setRows((prev) => [...prev, { key: newKey(), externalStatus, status: "SHIPPED" }]);

  const pendingUnmapped = settings.unmappedStatuses.filter(
    (u) =>
      !rows.some((r) => normalizeStatusKey(r.externalStatus) === normalizeStatusKey(u.rawStatus)),
  );

  const onSave = () =>
    run({
      mappings: rows
        .filter((r) => r.externalStatus.trim())
        .map((r) => ({ externalStatus: r.externalStatus.trim(), status: r.status })),
    });

  return (
    <Card>
      <CardTitle>Correspondance des statuts</CardTitle>

      <p className="mb-5 text-[13px] text-body">
        Flowmerce ramène chaque statut envoyé par votre boutique à un statut standard. Les
        libellés courants — « Expédiée », « Livrée », « shipped »… — sont reconnus d’office.
        Déclarez ici ceux qui sont propres à votre boutique.
      </p>

      {settings.storeStatuses.declared && (
        <div className="mb-5">
          <p className={LABEL}>Statuts de votre boutique</p>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {settings.storeStatuses.items.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between gap-3 rounded-control border border-line bg-page px-3 py-2"
              >
                <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                  {item.label}
                </span>
                <Badge tone={item.status === "UNMAPPED" ? "warning" : "neutral"}>
                  {item.status === "UNMAPPED" ? "À associer" : ORDER_STATUS_LABELS[item.status].fr}
                </Badge>
              </li>
            ))}
          </ul>
          <p className={HINT}>
            Liste transmise par votre boutique le {fmtDateTime(settings.storeStatuses.declaredAt)},
            avec le statut standard auquel chacun correspond. Seuls ces statuts vous sont
            proposés pour les notifications et les messages.
          </p>
        </div>
      )}

      {pendingUnmapped.length > 0 && (
        <div className="mb-5">
          <Notice
            tone="warning"
            icon={AlertTriangle}
            title={`${pendingUnmapped.length} statut${pendingUnmapped.length > 1 ? "s" : ""} reçu${
              pendingUnmapped.length > 1 ? "s" : ""
            } de votre boutique sans correspondance`}
          >
            <ul className="m-0 mt-2 list-none space-y-2 p-0">
              {pendingUnmapped.map((u) => (
                <li key={u.rawStatus} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{u.rawStatus}</strong>
                    <span className="tabular-nums">
                      {u.count > 0 ? ` · reçu ${u.count} fois` : " · déclaré par votre boutique"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => add(u.rawStatus)}
                    className={`${BTN_GHOST} px-3 py-1.5`}
                  >
                    <Plus size={14} aria-hidden />
                    Associer
                  </button>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-[13px] text-body">
          Aucune correspondance personnalisée : seules les correspondances par défaut s’appliquent.
        </p>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {rows.map((row, i) => (
            <li key={row.key} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <input
                type="text"
                aria-label={`Statut de votre boutique, ligne ${i + 1}`}
                value={row.externalStatus}
                onChange={(e) => update(row.key, { externalStatus: e.target.value })}
                maxLength={100}
                className={FIELD}
              />
              <StatusSelect
                id={`mapping-${row.key}`}
                label={`Statut Flowmerce, ligne ${i + 1}`}
                value={row.status}
                onChange={(status) => update(row.key, { status })}
              />
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                aria-label={`Supprimer la correspondance ${row.externalStatus || i + 1}`}
                className={`rounded-control p-2 text-red-700 transition-colors hover:bg-red-50 ${FOCUS}`}
              >
                <Trash2 size={15} strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => add()} className={`${BTN_GHOST} mt-3 px-3 py-2`}>
        <Plus size={14} aria-hidden />
        Ajouter une correspondance
      </button>
      <p className={HINT}>
        La casse, les accents et la ponctuation sont ignorés : « Expédiée » et « EXPEDIEE » sont
        le même statut.
      </p>

      <SaveRow saving={saving} saved={saved} error={error} onSave={onSave} />
    </Card>
  );
}
