import React, { useRef, useState } from "react";
import { OutcomeBadge, RedFlagBadge, AdaBadge } from "./StatusBadge.jsx";
import { ChevronIcon, PlayIcon, PauseIcon, DocIcon } from "./Icons.jsx";
import { audioUrl, transcriptUrl, money } from "../api.js";

const FEE_LABEL = {
  base_labor_fee: "Base labor",
  mileage_fee: "Mileage",
  stair_carry_fee: "Stair carry",
  long_carry_fee: "Long carry",
  packing_materials_fee: "Packing materials",
  fuel_surcharge: "Fuel surcharge",
};

function FeeBreakdown({ fees }) {
  return (
    <table className="mt-2 w-full text-[14px]">
      <caption className="sr-only">Itemized fee breakdown</caption>
      <tbody>
        {Object.keys(FEE_LABEL).map((k) => (
          <tr key={k} className="border-b border-edge/60 last:border-0">
            <td className="py-1 text-muted">{FEE_LABEL[k]}</td>
            {/* A fee the dispatcher never stated is unknown, NOT $0 — render a
                neutral dash so an unconfirmed line is never shown as free. */}
            <td className="py-1 text-right font-mono text-body">
              {fees[k] == null ? <span className="text-muted" title="Not stated by the dispatcher">—</span> : money(fees[k])}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AudioControl({ profileId }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause simulated call playback" : "Play simulated call playback"}
        className="btn-ghost inline-flex items-center gap-1.5"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
        {playing ? "Pause" : "Play"}
      </button>
      <span className="text-[12px] text-muted">Simulated playback — not a real recording</span>
      <audio
        ref={ref}
        src={audioUrl(profileId)}
        preload="none"
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}

export default function LedgerCard({ card }) {
  const [open, setOpen] = useState(false);
  const itemized = card.outcome === "ITEMIZED_QUOTE";

  return (
    <article data-testid="ledger-card" className="rounded-lg border border-edge bg-panel2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-muted">#{card.rank}</span>
            <h3 className="truncate text-base font-semibold text-body">{card.company}</h3>
          </div>
          <p className="text-[13px] text-muted">{card.style}</p>
        </div>
        <div className="text-right">
          {card.itemized_total != null && (
            <div className="font-mono text-xl font-bold text-body">{money(card.itemized_total)}</div>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <OutcomeBadge outcome={card.outcome} />
        {card.red_flag && <RedFlagBadge label={card.red_flag.label} />}
        {card.ada_shield_triggered && <AdaBadge />}
      </div>

      {card.red_flag && (
        <p className="mt-2 rounded-md border border-danger/50 bg-danger/10 p-2 text-[13px] text-body">
          {card.red_flag.message}
        </p>
      )}

      {card.price_drop && (
        <p className="mt-2 rounded-md border border-success/50 bg-success/10 p-2 text-[13px] text-body">
          {card.price_drop.text}
        </p>
      )}

      {card.outcome === "CALLBACK_COMMITMENT" && (
        <p className="mt-2 text-[13px] text-body">Callback window: {card.callback_window}</p>
      )}
      {card.outcome === "DOCUMENTED_DECLINE" && (
        <p className="mt-2 text-[13px] text-muted">{card.decline_reason}</p>
      )}

      {itemized && card.fee_line_items && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="btn-ghost inline-flex items-center gap-1.5"
          >
            <ChevronIcon style={{ transform: open ? "rotate(180deg)" : "none" }} />
            {open ? "Hide fee breakdown" : "Show fee breakdown"}
          </button>
          {open && <FeeBreakdown fees={card.fee_line_items} />}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-edge/60 pt-2">
        <AudioControl profileId={card.profile_id} />
        <a
          href={transcriptUrl(card.profile_id)}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost inline-flex items-center gap-1.5"
        >
          <DocIcon />
          Full transcript
        </a>
      </div>
    </article>
  );
}
