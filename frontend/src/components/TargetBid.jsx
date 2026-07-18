import React, { useEffect, useState } from "react";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber.js";
import { money } from "../api.js";

export default function TargetBid({ currentBid, priceDropSeq, benchmark, report, status }) {
  const savings = report?.savings_summary;
  const done = status === "done";
  // While live, track the number on the table. At done, settle on the best
  // itemized quote secured (the last call may be a decline that would otherwise
  // freeze this counter on a rejected price).
  const headlineNumber = done && savings ? savings.recommended_total : currentBid;
  const display = useAnimatedNumber(headlineNumber ?? 0, 750);
  const [flash, setFlash] = useState(false);

  // Brief highlight each time a concession tumbles the number.
  useEffect(() => {
    if (priceDropSeq > 0) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(t);
    }
  }, [priceDropSeq]);

  return (
    <section className="panel p-4" aria-label="Live savings counter">
      <h2 className="label mb-3">Live Savings Counter</h2>

      <div
        className={`rounded-lg border p-4 text-center transition-colors ${
          flash || done ? "border-success bg-success/10" : "border-edge bg-surface"
        }`}
      >
        <div className="label">{done ? "Final Secured Bid" : "Current Target Bid"}</div>
        <div
          data-testid="target-bid"
          className={`font-mono text-5xl font-black tabular-nums ${
            flash ? "animate-tumble text-success" : done ? "text-success" : "text-body"
          }`}
          role="status"
          aria-live="polite"
        >
          {headlineNumber != null ? money(display) : "—"}
        </div>
        <div className="mt-1 text-[13px] text-muted">
          {done
            ? "Best itemized quote secured"
            : status === "running"
            ? "Tracking the live number on the table"
            : "Awaiting live negotiation"}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-edge bg-panel2 px-3 py-2 text-center">
          <div className="label">Benchmark (2BR)</div>
          <div className="font-mono text-lg text-body">{money(benchmark)}</div>
        </div>
        <div className="rounded-md border border-edge bg-panel2 px-3 py-2 text-center">
          <div className="label">Best Itemized</div>
          <div className="font-mono text-lg text-success">
            {savings ? money(savings.recommended_total) : "—"}
          </div>
        </div>
      </div>

      {status === "done" && savings && (
        <div className="mt-3 animate-risein rounded-lg border border-success/60 bg-success/10 p-3">
          <div className="label text-success">Verified Savings</div>
          <div className="mt-1 text-[14px] text-body">
            {money(savings.savings_vs_benchmark)} under the 2-bedroom benchmark
            {savings.savings_vs_highest > 0 && (
              <> · {money(savings.savings_vs_highest)} below the highest quote</>
            )}
            .
          </div>
        </div>
      )}
    </section>
  );
}
