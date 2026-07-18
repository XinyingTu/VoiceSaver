import React from "react";
import LedgerCard from "./LedgerCard.jsx";

export default function ClosingLedger({ report, completedProfileIds, status }) {
  const ledger = report?.ledger || [];
  // Reveal a card as soon as its call has finished playing (progressive fill).
  const visible = ledger.filter((c) => completedProfileIds.includes(c.profile_id));

  return (
    <section className="panel p-4" aria-label="Closing ledger">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label">Closing Ledger</h2>
        {report && (
          <span className="text-[12px] text-muted">
            {visible.length}/{ledger.length} calls
          </span>
        )}
      </div>

      {report?.recommendation && status === "done" && (
        <p className="mb-3 rounded-lg border border-success/60 bg-success/10 p-3 text-[14px] text-body">
          {report.recommendation}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-edge bg-surface p-4 text-center text-[14px] text-muted">
          Ranked outcomes appear here as each call completes.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((card) => (
            <LedgerCard key={card.profile_id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
