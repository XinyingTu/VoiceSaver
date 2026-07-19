import React from "react";
import { OutcomeBadge, RedFlagBadge } from "./StatusBadge.jsx";
import { money } from "../api.js";

// Compact ledger card for a finished human-in-the-loop call. Unlike the
// simulated LedgerCard it has no audio/transcript file to link — its proof is
// the transcript line quoted inline as evidence.
export default function LiveLedgerCard({ card }) {
  const fraud = card.outcome === "LOWBALL_FRAUD";
  return (
    <article data-testid="live-ledger-card" className="rounded-lg border border-edge bg-panel2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-muted">#{card.rank}</span>
            <h3 className="truncate text-base font-semibold text-body">{card.name}</h3>
          </div>
          <p className="text-[13px] text-muted">Live human-in-the-loop call</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-bold text-body">{money(card.price)}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {fraud ? (
          <RedFlagBadge />
        ) : card.outcome === "ITEMIZED_QUOTE" ? (
          <OutcomeBadge outcome="ITEMIZED_QUOTE" />
        ) : (
          <span className="badge badge-neutral">{card.outcomeLabel}</span>
        )}
      </div>

      {card.evidence && (
        <figure className="mt-2 rounded-md border border-edge/60 bg-surface p-2">
          <figcaption className="text-[11px] font-bold uppercase tracking-wide text-muted">
            Transcript evidence
          </figcaption>
          <blockquote className="mt-1 text-[13px] italic text-body">“{card.evidence}”</blockquote>
        </figure>
      )}
    </article>
  );
}
