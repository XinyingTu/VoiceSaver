import React, { useState } from "react";
import { OutcomeBadge, RedFlagBadge } from "./StatusBadge.jsx";
import { ChevronIcon, PlayIcon, DocIcon } from "./Icons.jsx";
import { money, lowballAssessment } from "../api.js";

// Deterministic 2-bedroom benchmark — mirrors get_price_benchmark's 2BR
// baseline used everywhere else; a quote 30%+ under it is a lowball fraud risk.
const BENCHMARK_TOTAL = 2200;

// Fee rows for the breakdown accordion. The live parser only captures a total,
// so any missing line item renders as $0 (honest "not itemized" placeholder).
const FEE_LABEL = {
  base_labor_fee: "Base labor",
  mileage_fee: "Mileage",
  stair_carry_fee: "Stair carry",
  packing_materials_fee: "Packing materials",
  fuel_surcharge: "Fuel surcharge",
};

// A real dispatcher name ("Tony") gets a "(Dispatcher)" tag; a raw persona id
// ("mover_002_tough") that leaked through as a fallback is shown generically.
function displayName(name) {
  if (!name || /_/.test(name)) return "Live Dispatcher";
  return /\(dispatcher\)/i.test(name) ? name : `${name} (Dispatcher)`;
}

function subLabel(isLowball, outcome) {
  if (isLowball || outcome === "LOWBALL_FRAUD") return "Suspected bait lowballer — hidden-fee risk";
  if (outcome === "ITEMIZED_QUOTE") return "Standard carrier bid";
  return "Quote in progress";
}

function FeeBreakdown({ fees, total }) {
  return (
    <table className="mt-2 w-full text-[14px]">
      <caption className="sr-only">Itemized fee breakdown</caption>
      <tbody>
        {Object.keys(FEE_LABEL).map((k) => (
          <tr key={k} className="border-b border-edge/60">
            <td className="py-1 text-muted">{FEE_LABEL[k]}</td>
            <td className="py-1 text-right font-mono text-body">{money(fees?.[k] ?? 0)}</td>
          </tr>
        ))}
        <tr>
          <td className="py-1 font-semibold text-body">Total</td>
          <td className="py-1 text-right font-mono font-bold text-body">{money(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

// Rich ledger card for a finished human-in-the-loop call — mirrors the simulated
// LedgerCard layout (badges → fraud alert → fee accordion → action footer) using
// the fields our transcript parser produces. Its proof is the transcript line,
// revealed under the "Full transcript" toggle.
export default function LiveLedgerCard({ card }) {
  const [showFees, setShowFees] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const { isLowball, pctBelow } = lowballAssessment(card.price, BENCHMARK_TOTAL);
  const flagged = isLowball || card.outcome === "LOWBALL_FRAUD";
  const hasQuote = card.price != null;

  return (
    <article data-testid="live-ledger-card" className="rounded-lg border border-edge bg-panel2 p-3">
      {/* Header: rank + friendly name + sub-label, price on the right. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-muted">#{card.rank}</span>
            <h3 className="truncate text-base font-semibold text-body">{displayName(card.name)}</h3>
          </div>
          <p className="text-[13px] text-muted">{subLabel(isLowball, card.outcome)}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-bold text-body">{money(card.price)}</div>
        </div>
      </div>

      {/* Badges: green itemized (or neutral in-progress) + red lowball pill. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {hasQuote ? (
          <OutcomeBadge outcome="ITEMIZED_QUOTE" />
        ) : (
          <span className="badge badge-neutral">{card.outcomeLabel}</span>
        )}
        {flagged && <RedFlagBadge />}
      </div>

      {/* Prominent fraud alert with the computed percent below benchmark. */}
      {flagged && hasQuote && (
        <p
          className="mt-2 rounded-md border border-danger/60 bg-danger/10 p-2 text-[13px] text-body"
          role="alert"
        >
          Quote is {pctBelow}% below the {BENCHMARK_TOTAL} benchmark — at or beyond the 30% threshold.
          Treat as a possible lowball / bait-and-switch fraud risk (FMCSA), not a competitive win.
        </p>
      )}

      {/* Itemized fee accordion. */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setShowFees((o) => !o)}
          aria-expanded={showFees}
          className="btn-ghost inline-flex items-center gap-1.5"
        >
          <ChevronIcon style={{ transform: showFees ? "rotate(180deg)" : "none" }} />
          {showFees ? "Hide fee breakdown" : "Show fee breakdown"}
        </button>
        {showFees && <FeeBreakdown fees={card.fees} total={card.price} />}
      </div>

      {/* Action footer: mock Play + Full-transcript toggle (cites the evidence). */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-edge/60 pt-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Live calls have no simulated recording"
            className="btn-ghost inline-flex items-center gap-1.5 opacity-60"
          >
            <PlayIcon />
            Play
          </button>
          <span className="text-[12px] text-muted">Simulated playback — not a real recording</span>
        </div>
        <button
          type="button"
          onClick={() => setShowTranscript((o) => !o)}
          aria-expanded={showTranscript}
          className="btn-ghost inline-flex items-center gap-1.5"
        >
          <DocIcon />
          Full transcript
        </button>
      </div>

      {/* Transcript evidence, revealed by the Full-transcript toggle. */}
      {showTranscript && (
        <figure className="mt-2 rounded-md border border-edge/60 bg-surface p-2">
          <figcaption className="text-[11px] font-bold uppercase tracking-wide text-muted">
            Transcript evidence
          </figcaption>
          <blockquote className="mt-1 text-[13px] italic text-body">
            {card.evidence ? `“${card.evidence}”` : "No transcript line was captured for this call."}
          </blockquote>
        </figure>
      )}
    </article>
  );
}
