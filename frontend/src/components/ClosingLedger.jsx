import React from "react";
import LedgerCard from "./LedgerCard.jsx";
import LiveLedgerCard from "./LiveLedgerCard.jsx";
import { isComparisonReady } from "../offerState.js";

// Rank live human-in-the-loop entries by ELIGIBILITY, not by whichever number is
// smallest: comparison-ready quotes (usable payable total, not a lowball, no
// unresolved mandatory fees) rank first by payable ascending; everything else
// (lowballs, incomplete/estimate/declined/callback) sinks below in arrival order.
function payableOf(e) {
  return e.finalConfirmedTotal ?? e.currentKnownTotal ?? Infinity;
}
function rankLive(entries) {
  return [...entries]
    .sort((a, b) => {
      const ae = isComparisonReady(a);
      const be = isComparisonReady(b);
      if (ae !== be) return ae ? -1 : 1; // eligible first
      if (ae && be) {
        const ap = payableOf(a);
        const bp = payableOf(b);
        if (ap !== bp) return ap - bp;
      }
      return a.id - b.id; // stable by arrival
    })
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export default function ClosingLedger({ report, completedProfileIds, status, liveEntries = [] }) {
  const ledger = report?.ledger || [];
  // Reveal a card as soon as its call has finished playing (progressive fill).
  const visible = ledger.filter((c) => completedProfileIds.includes(c.profile_id));
  // Live mode has no backend report — rank the parsed closing entries instead.
  const live = rankLive(liveEntries);

  return (
    <section className="panel p-4" aria-label="Closing ledger">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label">Closing Ledger</h2>
        {report ? (
          <span className="text-[12px] text-muted">
            {visible.length}/{ledger.length} calls
          </span>
        ) : (
          live.length > 0 && (
            <span className="text-[12px] text-muted">{live.length} call{live.length === 1 ? "" : "s"}</span>
          )
        )}
      </div>

      {report?.recommendation && status === "done" && (
        <p className="mb-3 rounded-lg border border-success/60 bg-success/10 p-3 text-[14px] text-body">
          {report.recommendation}
        </p>
      )}

      {visible.length === 0 && live.length === 0 ? (
        <div className="rounded-lg border border-edge bg-surface p-4 text-center text-[14px] text-muted">
          Ranked outcomes appear here as each call completes.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((card) => (
            <LedgerCard key={card.profile_id} card={card} />
          ))}
          {live.map((card) => (
            <LiveLedgerCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
