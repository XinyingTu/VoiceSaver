import React, { useEffect, useState } from "react";
import { money } from "../api.js";
import { counterLabel, PRICE_BASIS } from "../offerState.js";

// Friendly labels for unresolved fee keys (taxonomy keys or free-text labels).
const FEE_LABEL = {
  base_labor_fee: "Base labor",
  mileage_fee: "Mileage",
  stair_carry_fee: "Stair fee",
  long_carry_fee: "Long carry",
  packing_materials_fee: "Packing materials",
  fuel_surcharge: "Fuel surcharge",
};
const feeLabel = (k) => FEE_LABEL[k] || String(k).replace(/_/g, " ").replace(/\bfee\b/i, "").trim() || k;

// ── Live human-in-the-loop counter, driven by the authoritative OfferState ──
function LiveCounter({ offer, benchmark, bestComparable, priceDropSeq, status }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (priceDropSeq > 0) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(t);
    }
  }, [priceDropSeq]);

  const label = counterLabel(offer);
  const isFinal = offer.priceBasis === PRICE_BASIS.ALL_IN_CONFIRMED && offer.finalConfirmedTotal != null;
  const hasUnresolved = offer.priceBasis === PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED;
  // The number shown: a confirmed final if we have one, else the known total.
  const headline = offer.finalConfirmedTotal ?? offer.currentKnownTotal ?? offer.initialTotal;

  return (
    <section className="panel p-4" aria-label="Live savings counter">
      <h2 className="label mb-3">Live Savings Counter</h2>

      <div
        className={`rounded-lg border p-4 text-center transition-colors ${
          flash || isFinal ? "border-success bg-success/10" : "border-edge bg-surface"
        }`}
      >
        <div className="label">{label}</div>
        <div
          data-testid="target-bid"
          role="status"
          aria-live="polite"
          className={`font-mono text-5xl font-black tabular-nums ${
            flash ? "text-success" : isFinal ? "text-success" : "text-body"
          }`}
        >
          {headline != null ? (
            money(headline)
          ) : (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">no verified quote yet</span>
            </>
          )}
        </div>

        {/* When mandatory fees remain unresolved, be explicit that the number is
            a KNOWN price, not the final payable total. */}
        {hasUnresolved ? (
          <div className="mt-2 text-left text-[13px] text-body">
            <div>Known price: <b>{money(headline)}</b></div>
            <div className="text-muted">Final payable total: <b className="text-body">Unknown</b></div>
            {offer.unresolvedFees.length > 0 && (
              <div className="text-muted">Unresolved: {offer.unresolvedFees.map(feeLabel).join(", ")}</div>
            )}
          </div>
        ) : (
          <div className="mt-1 text-[13px] text-muted">
            {status === "done"
              ? isFinal
                ? "Vendor-confirmed all-in price"
                : "Best comparable price captured"
              : status === "running"
              ? "Tracking the verified vendor total"
              : "Awaiting live negotiation"}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-edge bg-panel2 px-3 py-2 text-center">
          <div className="label">Job Benchmark</div>
          <div className="font-mono text-lg text-body">{benchmark != null ? money(benchmark) : "—"}</div>
        </div>
        <div className="rounded-md border border-edge bg-panel2 px-3 py-2 text-center">
          <div className="label">Best Comparable</div>
          <div className="font-mono text-lg text-success">
            {bestComparable != null ? money(bestComparable) : "—"}
          </div>
        </div>
      </div>

      {/* Negotiated reduction — only a genuine vendor drop on the known price,
          never a benchmark/competitor difference. */}
      {offer.negotiatedSavings > 0 && (
        <div className="mt-3 animate-risein rounded-lg border border-success/60 bg-success/10 p-3">
          <div className="label text-success">Negotiated Reduction</div>
          <div className="mt-1 text-[14px] text-body">
            {money(offer.negotiatedSavings)} off the vendor's known price
            {offer.finalConfirmedTotal == null && (
              <span className="text-muted"> · final payable total still unresolved</span>
            )}
            .
          </div>
        </div>
      )}

      {bestComparable == null && status !== "idle" && (
        <p className="mt-3 rounded-lg border border-edge bg-surface p-2 text-center text-[13px] text-muted">
          No comparison-ready offer yet
        </p>
      )}
    </section>
  );
}

// ── Simulated-mode counter (unchanged behavior; report-driven) ──────────────
function SimulatedCounter({ currentBid, priceDropSeq, benchmark, bestItemized, savings, status }) {
  const done = status === "done";
  const headlineNumber = done && bestItemized != null ? bestItemized : currentBid;
  const [flash, setFlash] = useState(false);

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
        <div className="label">{done ? "Best Itemized Quote" : "Current Target Bid"}</div>
        <div
          data-testid="target-bid"
          role="status"
          aria-live="polite"
          className={`font-mono text-5xl font-black tabular-nums ${
            flash ? "text-success" : done ? "text-success" : "text-body"
          }`}
        >
          {headlineNumber != null ? (
            money(headlineNumber)
          ) : (
            <>
              <span aria-hidden="true">—</span>
              <span className="sr-only">no bid yet</span>
            </>
          )}
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
          <div className="label">Job Benchmark</div>
          <div className="font-mono text-lg text-body">{money(benchmark)}</div>
        </div>
        <div className="rounded-md border border-edge bg-panel2 px-3 py-2 text-center">
          <div className="label">Best Itemized</div>
          <div className="font-mono text-lg text-success">
            {bestItemized != null ? money(bestItemized) : "—"}
          </div>
        </div>
      </div>

      {status === "done" && savings && (
        <div className="mt-3 animate-risein rounded-lg border border-success/60 bg-success/10 p-3">
          <div className="label text-success">Verified Savings</div>
          <div className="mt-1 text-[14px] text-body">
            {money(savings.savings_vs_benchmark)} under the job benchmark
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

export default function TargetBid(props) {
  // Human-in-the-loop mode passes an authoritative `offer`; simulated mode does
  // not. Keeping both paths avoids disturbing the report-driven simulated flow.
  if (props.offer) {
    return (
      <LiveCounter
        offer={props.offer}
        benchmark={props.benchmark}
        bestComparable={props.bestComparable}
        priceDropSeq={props.priceDropSeq}
        status={props.status}
      />
    );
  }
  return <SimulatedCounter {...props} />;
}
