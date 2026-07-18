import React from "react";
import { formatMoney } from "../api.js";

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-paneledge/50 py-1.5">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-right text-[12px] font-medium text-slate-200">{value}</span>
    </div>
  );
}

const DOC_ICON = {
  competitor_binding_quote: "🎯",
  inventory_photos: "📸",
  certificate_of_insurance: "📄",
};

export default function IntakePanel({ job }) {
  if (!job) {
    return (
      <div className="panel h-full animate-pulse p-4 text-xs text-slate-600">
        Loading intake…
      </div>
    );
  }

  const { spec, documents } = job;
  const leverage = documents.find((d) => d.type === "competitor_binding_quote");

  return (
    <div className="panel flex h-full flex-col p-4">
      <div className="scanline" />
      <div className="panel-title mb-3">
        <span className="inline-block h-2 w-2 rounded-full bg-cyan-glow animate-pulseglow" />
        Intake Spec
      </div>

      <div className="mb-3 rounded-lg border border-paneledge bg-void/40 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">Job ID</div>
        <div className="font-display text-sm text-cyan-soft neon-text">{job.job_id}</div>
        <div className="mt-1 text-[11px] text-slate-500">{job.client_alias}</div>
      </div>

      <div className="mb-4">
        <Row label="Household" value={spec.household_size.replace(/_/g, " ")} />
        <Row label="Origin" value={`${spec.origin_label} (${spec.origin_zip})`} />
        <Row label="Destination" value={`${spec.destination_label} (${spec.destination_zip})`} />
        <Row label="Distance" value={`${spec.distance_miles} mi`} />
        <Row label="Stair flights" value={spec.stair_flights} />
        <Row label="Window" value={spec.preferred_window} />
      </div>

      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        Inventory ({spec.inventory_items.length})
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {spec.inventory_items.map((item) => (
          <span key={item} className="chip">
            {spec.special_items?.includes(item.split(" ")[1]) ||
            spec.special_items?.some((s) => item.includes(s)) ? (
              <span className="text-amberflag">★</span>
            ) : null}
            {item}
          </span>
        ))}
      </div>

      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
        Document Intake ({documents.length})
      </div>
      <div className="flex flex-col gap-2">
        {documents.map((doc) => (
          <div
            key={doc.reference}
            className="rounded-lg border border-paneledge bg-void/40 p-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-slate-200">
                {DOC_ICON[doc.type] || "📎"} {doc.source}
              </span>
              {doc.amount != null && (
                <span className="font-display text-[13px] text-neonlime">
                  {formatMoney(doc.amount)}
                </span>
              )}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">{doc.note}</div>
          </div>
        ))}
      </div>

      {leverage && (
        <div className="mt-auto rounded-lg border border-neonlime/40 bg-neonlime/5 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-neonlime">
            Core Leverage
          </div>
          <div className="mt-1 text-[11px] text-slate-300">
            Verified binding bid from <b>{leverage.source}</b> at{" "}
            <b className="text-neonlime">{formatMoney(leverage.amount)}</b>. Alex will use this —
            and never a fabricated number — to drive the price down.
          </div>
        </div>
      )}
    </div>
  );
}
