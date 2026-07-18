import React from "react";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber.js";
import { formatMoney } from "../api.js";

function Stat({ label, value, accent = "text-slate-200" }) {
  return (
    <div className="rounded-lg border border-paneledge bg-void/40 px-3 py-2 text-center">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`font-display text-sm ${accent}`}>{value}</div>
    </div>
  );
}

export default function SavingsCounter({
  currentQuote,
  anchorPrice,
  finalPrice,
  competitorQuote,
  fairBenchmark,
  breakthroughFired,
  status,
  success,
  redFlag,
  redFlagReason,
}) {
  const displayQuote = useAnimatedNumber(currentQuote ?? 0, 850);
  const hasQuote = currentQuote != null;

  const savings = hasQuote && anchorPrice ? Math.max(anchorPrice - currentQuote, 0) : 0;
  const displaySavings = useAnimatedNumber(savings, 850);
  const savingsPct = anchorPrice ? Math.round((savings / anchorPrice) * 100) : 0;

  const done = status === "done";
  const quoteColor = breakthroughFired
    ? "text-neonlime"
    : hasQuote
    ? "text-cyan-soft"
    : "text-slate-600";

  return (
    <div className="panel flex h-full flex-col p-4">
      <div className="scanline" />
      <div className="panel-title mb-3">
        <span className="inline-block h-2 w-2 rounded-full bg-magenta-glow animate-pulseglow" />
        Live Savings Counter
      </div>

      {/* Giant live quote */}
      <div
        className={`relative rounded-xl border p-5 text-center transition-all duration-500 ${
          breakthroughFired
            ? "border-neonlime/60 bg-neonlime/5 shadow-neon"
            : "border-paneledge bg-void/50"
        }`}
      >
        <div className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
          Current Quote On Table
        </div>
        <div
          className={`font-display text-5xl font-black tabular-nums transition-colors ${quoteColor} ${
            breakthroughFired ? "neon-text" : ""
          }`}
        >
          {hasQuote ? formatMoney(displayQuote) : "—"}
        </div>
        {breakthroughFired && (
          <div className="mt-1 animate-pulseglow text-[11px] font-bold uppercase tracking-widest text-neonlime">
            ▼ Leverage breakthrough
          </div>
        )}
      </div>

      {/* Savings readout */}
      <div className="mt-4 rounded-xl border border-magenta-glow/30 bg-magenta-glow/5 p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.25em] text-magenta-soft">
          Total Savings vs Peak
        </div>
        <div className="font-display text-3xl font-black tabular-nums text-magenta-soft magenta-text">
          {formatMoney(displaySavings)}
        </div>
        <div className="text-[11px] text-slate-400">{savingsPct}% off the peak ask</div>
      </div>

      {/* Reference stats */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Peak Ask" value={formatMoney(anchorPrice)} accent="text-slate-300" />
        <Stat label="Fair Bench" value={formatMoney(fairBenchmark)} accent="text-cyan-soft" />
        <Stat label="Competitor" value={formatMoney(competitorQuote)} accent="text-neonlime" />
      </div>

      {/* Outcome */}
      <div className="mt-4 min-h-[64px]">
        {done && (
          <div className="animate-risein space-y-2">
            <div
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                success
                  ? "border-neonlime/50 bg-neonlime/10 text-neonlime"
                  : "border-amberflag/50 bg-amberflag/10 text-amberflag"
              }`}
            >
              <span className="text-[11px] font-bold uppercase tracking-widest">
                {success ? "✓ Deal secured" : "△ Above target"}
              </span>
              <span className="font-display text-sm">{formatMoney(finalPrice)}</span>
            </div>
            {redFlag && (
              <div className="rounded-lg border border-amberflag/50 bg-amberflag/10 p-2.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-amberflag">
                  ⚑ Red Flag
                </div>
                <div className="mt-1 text-[11px] text-amber-200/80">{redFlagReason}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
