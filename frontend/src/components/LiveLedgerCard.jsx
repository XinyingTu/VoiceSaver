import React, { useState } from "react";
import { QuoteStatusBadge, RedFlagBadge } from "./StatusBadge.jsx";
import { ChevronIcon, PlayIcon, DocIcon } from "./Icons.jsx";
import { money, lowballAssessment } from "../api.js";
import { PRICE_BASIS, QUOTE_STATUS } from "../offerState.js";

const FEE_LABEL = {
  base_labor_fee: "Base labor",
  mileage_fee: "Mileage",
  stair_carry_fee: "Stair carry",
  long_carry_fee: "Long carry",
  packing_materials_fee: "Packing materials",
  fuel_surcharge: "Fuel surcharge",
};
const feeLabel = (k) =>
  FEE_LABEL[k] || String(k).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// A real dispatcher name ("Tony") gets a "(Dispatcher)" tag; a raw persona id
// ("mover_002_tough") that leaked through as a fallback is shown generically.
function displayName(name) {
  if (!name || /_/.test(name)) return "Live Dispatcher";
  return /\(dispatcher\)/i.test(name) ? name : `${name} (Dispatcher)`;
}

function subLabel(card) {
  if (card.lowballRisk || card.fraudPhrase) return "Suspected bait lowballer — hidden-fee risk";
  switch (card.priceBasis) {
    case PRICE_BASIS.ALL_IN_CONFIRMED:
      return "Vendor-confirmed all-in price";
    case PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED:
      return "Known price — mandatory fees unresolved";
    case PRICE_BASIS.ESTIMATE:
      return "Non-binding estimate";
    case PRICE_BASIS.NO_COMPARABLE_QUOTE:
      return card.quoteStatus === QUOTE_STATUS.CALLBACK ? "Callback required" : "No comparable quote";
    case PRICE_BASIS.WORKING_OFFER:
      return "Total-only working quote";
    default:
      return "Quote in progress";
  }
}

// Honest fee breakdown built from the authoritative offer — a fee the vendor
// never priced is shown as "—"/"Amount unknown", NEVER as $0. Deposits, optional
// fees, and unit rates are listed separately and are NOT part of the total.
function FeeBreakdown({ card }) {
  const payable = card.finalConfirmedTotal ?? card.currentKnownTotal;
  const rows = [];
  for (const f of card.mandatoryAdditions || []) {
    rows.push([f.label || feeLabel(f.key), money(f.amount), f.includedInTotal ? "in total" : ""]);
  }
  for (const k of card.unresolvedFees || []) {
    rows.push([feeLabel(k), "Amount unknown", ""]);
  }

  return (
    <table className="mt-2 w-full text-[14px]">
      <caption className="sr-only">Vendor-stated fee detail</caption>
      <tbody>
        {rows.length === 0 && (
          <tr className="border-b border-edge/60">
            <td className="py-1 text-muted" colSpan={3}>
              No itemized vendor fees captured{card.currentKnownTotal != null ? " — total only" : ""}.
            </td>
          </tr>
        )}
        {rows.map(([label, amount, note], i) => (
          <tr key={`f${i}`} className="border-b border-edge/60">
            <td className="py-1 text-muted">
              {label}
              {note && <span className="ml-1 text-[11px] text-muted">({note})</span>}
            </td>
            <td className="py-1 text-right font-mono text-body">{amount}</td>
          </tr>
        ))}
        {card.deposit != null && (
          <tr className="border-b border-edge/60">
            <td className="py-1 text-muted">Deposit <span className="text-[11px]">(not part of total)</span></td>
            <td className="py-1 text-right font-mono text-body">{money(card.deposit)}</td>
          </tr>
        )}
        {(card.optionalFees || []).map((f, i) => (
          <tr key={`o${i}`} className="border-b border-edge/60">
            <td className="py-1 text-muted">Optional: {f.label} <span className="text-[11px]">(not added)</span></td>
            <td className="py-1 text-right font-mono text-body">{money(f.amount)}</td>
          </tr>
        ))}
        {(card.unitRates || []).map((r, i) => (
          <tr key={`u${i}`} className="border-b border-edge/60">
            <td className="py-1 text-muted">Rate <span className="text-[11px]">(not a total)</span></td>
            <td className="py-1 text-right font-mono text-body">{money(r.amount)}{r.unit ? ` / ${r.unit.replace(/^per\s?/, "")}` : ""}</td>
          </tr>
        ))}
        <tr>
          <td className="py-1 font-semibold text-body">
            {card.priceBasis === PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED ? "Known price (not final)" : "Payable total"}
          </td>
          <td className="py-1 text-right font-mono font-bold text-body">
            {payable != null ? money(payable) : "—"}
          </td>
        </tr>
        {card.priceBasis === PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED && (
          <tr>
            <td className="py-1 text-muted">Final payable total</td>
            <td className="py-1 text-right font-mono text-muted">Unknown</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// Rich ledger card for a finished human-in-the-loop call, driven by the
// authoritative OfferState (never by "the last number in the transcript").
export default function LiveLedgerCard({ card }) {
  const [showFees, setShowFees] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const payable = card.finalConfirmedTotal ?? card.currentKnownTotal;
  const { pctBelow } = lowballAssessment(payable, card.benchmark);
  const flagged = card.lowballRisk || card.fraudPhrase;

  return (
    <article data-testid="live-ledger-card" className="rounded-lg border border-edge bg-panel2 p-3">
      {/* Header: rank + friendly name + sub-label, price on the right. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-muted">#{card.rank}</span>
            <h3 className="truncate text-base font-semibold text-body">{displayName(card.name)}</h3>
          </div>
          <p className="text-[13px] text-muted">{subLabel(card)}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-bold text-body">{payable != null ? money(payable) : "—"}</div>
          {card.priceBasis === PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED && (
            <div className="text-[11px] text-muted">known price</div>
          )}
        </div>
      </div>

      {/* Badges: factual quote-status + (separately) a lowball warning. These are
          not contradictory — a lowball quote still has a factual status. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <QuoteStatusBadge status={card.quoteStatus} />
        {flagged && <RedFlagBadge />}
      </div>

      {/* Prominent fraud alert with the computed percent below the JOB benchmark. */}
      {flagged && payable != null && card.benchmark != null && (
        <p
          className="mt-2 rounded-md border border-danger/60 bg-danger/10 p-2 text-[13px] text-body"
          role="alert"
        >
          Quote is {pctBelow}% below the {money(card.benchmark)} job benchmark — treat as a possible
          lowball / bait-and-switch fraud risk (FMCSA), not a competitive win. Excluded from Best Offer.
        </p>
      )}

      {/* Unresolved-fee honesty line. */}
      {card.priceBasis === PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED && card.unresolvedFees.length > 0 && (
        <p className="mt-2 rounded-md border border-edge bg-surface p-2 text-[13px] text-muted">
          Final payable total unknown — unresolved: {card.unresolvedFees.map(feeLabel).join(", ")}.
        </p>
      )}

      {/* Negotiated reduction (genuine vendor drop only). */}
      {card.negotiatedSavings > 0 && (
        <p className="mt-2 rounded-md border border-success/50 bg-success/10 p-2 text-[13px] text-body">
          {money(card.negotiatedSavings)} negotiated off the vendor's known price
          {card.finalConfirmedTotal == null && " — final total still unresolved"}.
        </p>
      )}

      {/* Fee accordion. */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setShowFees((o) => !o)}
          aria-expanded={showFees}
          className="btn-ghost inline-flex items-center gap-1.5"
        >
          <ChevronIcon style={{ transform: showFees ? "rotate(180deg)" : "none" }} />
          {showFees ? "Hide fee detail" : "Show fee detail"}
        </button>
        {showFees && <FeeBreakdown card={card} />}
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
