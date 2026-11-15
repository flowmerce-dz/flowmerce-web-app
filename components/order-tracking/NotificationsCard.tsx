"use client";

// Notifications aux clients : statuts déclencheurs, canal, langue et messages.

import { useEffect, useState } from "react";
import { Card, CardTitle, FIELD, BTN_GHOST } from "@/components/dashboard/ui";
import { LANGUAGES, type Language, type MappableStatus } from "@/lib/order-tracking/statuses";
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLE_LABELS,
} from "@/lib/order-tracking/templates";
import {
  CHOICE,
  HINT,
  LABEL,
  SaveRow,
  useSave,
  type ChannelKey,
  type SaveSettings,
  type TrackingSettings,
} from "./shared";

const LANGUAGE_LABELS: Record<Language, string> = { fr: "Français", ar: "Arabe" };

export function NotificationsCard({
  settings,
  save,
}: {
  settings: TrackingSettings;
  save: SaveSettings;
}) {
  const [statuses, setStatuses] = useState<MappableStatus[]>(settings.notifyStatuses);
  const [channel, setChannel] = useState<ChannelKey>(settings.notificationChannel);
  const [language, setLanguage] = useState<Language>(settings.defaultLanguage);
  const { saving, saved, error, run } = useSave(save);

  useEffect(() => {
    setStatuses(settings.notifyStatuses);
    setChannel(settings.notificationChannel);
    setLanguage(settings.defaultLanguage);
  }, [settings.notifyStatuses, settings.notificationChannel, settings.defaultLanguage]);

  const toggle = (status: MappableStatus) =>
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );

  // Seuls les statuts qui existent dans la boutique sont proposés.
  const { activeStatuses, statusLabels, storeStatuses } = settings;

  return (
    <Card>
      <CardTitle>Notifications aux clients</CardTitle>

      <fieldset className="m-0 border-0 p-0">
        <legend className={LABEL}>Statuts qui préviennent le client</legend>
        {activeStatuses.length === 0 && (
          <p className="text-[13px] text-body">
            Aucun statut de votre boutique n’a encore de correspondance. Associez-les
            ci-dessus pour pouvoir prévenir vos clients.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {activeStatuses.map((status) => {
            const checked = statuses.includes(status);
            return (
              <label
                key={status}
                className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                  checked ? "border-brand bg-brand-soft" : "border-line bg-surface"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(status)}
                  className={CHOICE}
                />
                <span
                  className={`text-[13px] font-medium ${checked ? "text-brand-ink" : "text-ink"}`}
                >
                  {statusLabels[status]}
                </span>
              </label>
            );
          })}
        </div>
        <p className={HINT}>
          {storeStatuses.declared
            ? "Ce sont les statuts que votre boutique a déclarés. "
            : "Votre boutique n’a pas déclaré ses statuts : tous les statuts standards sont proposés. "}
          Un statut non coché est enregistré dans l’historique de la commande sans prévenir le
          client.
        </p>
      </fieldset>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <fieldset className="m-0 border-0 p-0">
          <legend className={LABEL}>Canal</legend>
          <div className="space-y-2">
            {settings.channels.map((c) => (
              <label
                key={c.channel}
                className={`flex items-start gap-3 rounded-control border p-3 transition-colors ${
                  !c.available
                    ? "border-line bg-page"
                    : channel === c.channel
                      ? "cursor-pointer border-brand bg-brand-soft"
                      : "cursor-pointer border-line bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="notification-channel"
                  value={c.channel}
                  checked={channel === c.channel}
                  disabled={!c.available}
                  onChange={() => setChannel(c.channel)}
                  className={CHOICE}
                />
                <span className="text-[13px] font-medium text-ink">
                  {c.label}
                  {!c.available && (
                    <span className="block text-[12px] font-normal text-faint">
                      Bientôt disponible
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="default-language" className={LABEL}>
            Langue des messages
          </label>
          <select
            id="default-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className={FIELD}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
          <p className={HINT}>
            Utilisée quand votre boutique ne transmet pas la langue du client (customer.language).
          </p>
        </div>
      </div>

      <SaveRow
        saving={saving}
        saved={saved}
        error={error}
        onSave={() =>
          run({
            // Un statut coché autrefois mais absent de la boutique n'est plus enregistré.
            notifyStatuses: statuses.filter((s) => activeStatuses.includes(s)),
            notificationChannel: channel,
            defaultLanguage: language,
          })
        }
      />
    </Card>
  );
}

export function MessageTemplatesCard({
  settings,
  save,
}: {
  settings: TrackingSettings;
  save: SaveSettings;
}) {
  const { activeStatuses, statusLabels } = settings;
  const [selected, setSelected] = useState<MappableStatus>("SHIPPED");
  const [language, setLanguage] = useState<Language>(settings.defaultLanguage);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const { saving, saved, error, run } = useSave(save);

  // Le statut affiché est toujours l'un de ceux de la boutique.
  const status = activeStatuses.includes(selected) ? selected : activeStatuses[0];
  const current = status ? settings.templates[status][language] : null;
  const currentSubject = current?.subject ?? "";
  const currentBody = current?.body ?? "";

  useEffect(() => {
    setSubject(currentSubject);
    setBody(currentBody);
  }, [currentSubject, currentBody]);

  if (!status || !current) return null;

  const dirty = subject !== current.subject || body !== current.body;

  return (
    <Card>
      <CardTitle>Messages</CardTitle>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="template-status" className={LABEL}>
            Statut
          </label>
          <select
            id="template-status"
            value={status}
            onChange={(e) => setSelected(e.target.value as MappableStatus)}
            className={FIELD}
          >
            {activeStatuses.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="template-language" className={LABEL}>
            Langue
          </label>
          <select
            id="template-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className={FIELD}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor="template-subject" className={LABEL}>
          Objet
        </label>
        <input
          id="template-subject"
          type="text"
          dir={language === "ar" ? "rtl" : "ltr"}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={MAX_SUBJECT_LENGTH}
          className={FIELD}
        />
      </div>

      <div className="mt-5">
        <label htmlFor="template-body" className={LABEL}>
          Message
        </label>
        <textarea
          id="template-body"
          dir={language === "ar" ? "rtl" : "ltr"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={MAX_BODY_LENGTH}
          rows={6}
          aria-describedby="template-variables"
          className={FIELD}
        />
        <p id="template-variables" className={HINT}>
          Variables remplacées à l’envoi :{" "}
          {TEMPLATE_VARIABLES.map((v, i) => (
            <span key={v}>
              <code className="font-mono text-ink">{`{{${v}}}`}</code> {TEMPLATE_VARIABLE_LABELS[v].toLowerCase()}
              {i < TEMPLATE_VARIABLES.length - 1 ? ", " : "."}
            </span>
          ))}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SaveRow
          saving={saving}
          saved={saved}
          error={error}
          disabled={!dirty || !subject.trim() || !body.trim()}
          onSave={() =>
            run({
              templates: { [status]: { [language]: { subject: subject.trim(), body: body.trim() } } },
            })
          }
        />
        {current.custom && (
          <button
            type="button"
            disabled={saving}
            onClick={() => run({ templates: { [status]: { [language]: null } } })}
            className={BTN_GHOST}
          >
            Rétablir le message par défaut
          </button>
        )}
      </div>
    </Card>
  );
}
