import React, { useRef } from "react";
import { LockIcon, ShieldIcon, PhoneIcon, DocIcon } from "./Icons.jsx";
import { money } from "../api.js";

const HOUSEHOLD_OPTIONS = ["studio", "1_bedroom", "2_bedroom", "3_bedroom", "4_bedroom_plus"];

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export default function IntakeColumn({
  spec,
  onField,
  locked,
  onLock,
  onUnlock,
  ada,
  onAdaToggle,
  intakeInfo,
  importing,
  importError,
  onImportDemo,
  onImportVision,
  modes,
  mode,
  onModeChange,
  onLaunch,
  launching,
  running,
}) {
  const fileRef = useRef(null);

  return (
    <section className="panel flex flex-col p-4" aria-label="Intake asset and spec center">
      <h2 className="label mb-3">Intake Asset & Spec Center</h2>

      {/* Document intake path */}
      <div className="mb-4 rounded-lg border border-edge bg-panel2 p-3">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-body">
          <DocIcon /> Document Intake (vision / OCR)
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={onImportDemo} disabled={locked || importing}>
            Use demo parse
          </button>
          <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={locked || importing}>
            {importing ? "Parsing…" : "Upload photo (vision)"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Upload a quote or intake document photo"
            onChange={(e) => e.target.files?.[0] && onImportVision(e.target.files[0])}
          />
        </div>
        {importError && (
          <p className="mt-2 rounded-md border border-danger/50 bg-danger/10 p-2 text-[13px] text-body">
            {importError}
          </p>
        )}
        {intakeInfo && (
          <p className="mt-2 text-[13px] text-muted">
            Parsed via <b className="text-body">{intakeInfo._mode}</b>
            {intakeInfo.parsed_quote?.total != null && (
              <> — seed quote {money(intakeInfo.parsed_quote.total)} ({intakeInfo.parsed_quote.company})</>
            )}
            . Both intake paths produce this same schema.
          </p>
        )}
      </div>

      {/* Unified editable spec */}
      <div className="grid grid-cols-1 gap-3">
        <Field label="Household size">
          <select className="field" value={spec.household_size || ""} disabled={locked}
            onChange={(e) => onField("household_size", e.target.value)}>
            {HOUSEHOLD_OPTIONS.map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Origin ZIP">
            <input className="field" value={spec.origin_zip || ""} disabled={locked}
              onChange={(e) => onField("origin_zip", e.target.value)} />
          </Field>
          <Field label="Destination ZIP">
            <input className="field" value={spec.destination_zip || ""} disabled={locked}
              onChange={(e) => onField("destination_zip", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Distance (miles)">
            <input type="number" className="field" value={spec.distance_miles ?? ""} disabled={locked}
              onChange={(e) => onField("distance_miles", Number(e.target.value))} />
          </Field>
          <Field label="Stair flights">
            <input type="number" className="field" value={spec.stair_flights ?? ""} disabled={locked}
              onChange={(e) => onField("stair_flights", Number(e.target.value))} />
          </Field>
        </div>
        <Field label={`Inventory items (${(spec.inventory_items || []).length}) — one per line`}>
          <textarea className="field h-24 resize-none" disabled={locked}
            value={(spec.inventory_items || []).join("\n")}
            onChange={(e) => onField("inventory_items", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
        </Field>
      </div>

      {/* Spec lock step */}
      <div className="mt-4">
        {locked ? (
          <div className="flex items-center justify-between rounded-lg border border-success/60 bg-success/10 p-2.5">
            <span className="badge badge-success"><LockIcon /> SPEC LOCKED</span>
            <button type="button" className="btn-ghost" onClick={onUnlock} disabled={running}>Edit spec</button>
          </div>
        ) : (
          <button type="button" className="btn-primary w-full inline-flex items-center justify-center gap-2" onClick={onLock}>
            <LockIcon /> Confirm & Lock Spec
          </button>
        )}
        <p className="mt-1.5 text-[13px] text-muted">
          The launch button stays disabled until the spec is locked — a safeguard against sight-unseen estimate expansion.
        </p>
      </div>

      {/* Strategy switch: ADA Voice Equity Shield */}
      <div className="mt-4 rounded-lg border border-edge bg-panel2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldIcon className={ada ? "text-access" : "text-muted"} />
            <span className="text-[14px] font-semibold text-body">ADA Voice Equity Shield</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ada}
            aria-label="ADA Voice Equity Shield self-attestation toggle"
            onClick={() => onAdaToggle(!ada)}
            disabled={locked}
            className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
              ada ? "border-access bg-access/30" : "border-edge bg-surface"
            } ${locked ? "opacity-70" : ""}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${ada ? "left-6 bg-access" : "left-0.5 bg-muted"}`} />
          </button>
        </div>
        {ada && <div className="mt-2"><span className="badge badge-access"><ShieldIcon /> SELF-ATTESTED · ACTIVE</span></div>}
        <p className="mt-2 text-[13px] text-muted">
          Enable this only if you (or the person you're representing) genuinely have a vocal, cognitive-processing, or
          hearing-related accessibility need. When enabled, if a dispatcher exhibits automated-blocking behavior, the AI
          proxy will truthfully disclose this accessibility context. When disabled (default), the proxy always answers
          identity questions plainly and never references any accessibility status.
        </p>
      </div>

      {/* Counterparty setup selector (appears once locked) */}
      {locked && (
        <fieldset className="mt-4 rounded-lg border border-edge bg-panel2 p-3">
          <legend className="label px-1">Counterparty Setup</legend>
          <div className="flex flex-col gap-1.5">
            {modes.map((m) => (
              <label key={m.id} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                mode === m.id ? "border-info bg-info/10" : "border-edge"} ${!m.available ? "opacity-60" : "cursor-pointer"}`}>
                <input type="radio" name="mode" value={m.id} checked={mode === m.id}
                  disabled={!m.available || running} onChange={() => onModeChange(m.id)} />
                <span className="min-w-0">
                  <span className="text-[14px] text-body">{m.label}</span>
                  {!m.available && <span className="ml-1 badge badge-neutral">needs credentials</span>}
                  <span className="block text-[12px] text-muted">{m.note}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Primary CTA */}
      <button
        type="button"
        onClick={onLaunch}
        disabled={!locked || running || launching}
        className="btn-primary mt-4 w-full inline-flex items-center justify-center gap-2"
      >
        <PhoneIcon />
        {launching ? "Dialing…" : running ? "Negotiation in progress…" : "Launch Live Voice Negotiation"}
      </button>
      {!locked && (
        <p className="mt-1.5 text-center text-[13px] text-muted">Lock the spec to enable launch.</p>
      )}
    </section>
  );
}
