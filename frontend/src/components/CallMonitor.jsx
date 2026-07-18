import React, { useEffect, useRef } from "react";
import Waveform from "./Waveform.jsx";
import { OutcomeBadge } from "./StatusBadge.jsx";
import { ShieldIcon, WarnIcon } from "./Icons.jsx";

function EventTags({ events }) {
  if (!events?.length) return null;
  const tag = (e, i) => {
    if (e.type === "tool_call") return <span key={i} className="badge badge-neutral">tool: {e.detail}</span>;
    if (e.type === "ada_shield") return <span key={i} className="badge badge-access"><ShieldIcon />ADA disclosure</span>;
    if (e.type === "lowball_flag") return <span key={i} className="badge badge-danger"><WarnIcon />lowball flag</span>;
    if (e.type === "leverage_cited") return <span key={i} className="badge badge-success">leverage: {e.detail}</span>;
    if (e.type === "price_drop") return <span key={i} className="badge badge-success">price drop</span>;
    if (e.type === "upcharge") return <span key={i} className="badge badge-danger">hidden fee</span>;
    return <span key={i} className="badge badge-neutral">{e.type}</span>;
  };
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{events.map(tag)}</div>;
}

function Line({ item, typing }) {
  const { msg } = item;
  const isDispatcher = msg.speaker === "dispatcher";
  const who = isDispatcher ? item.callName : "VoiceSaver Proxy";
  const accent = isDispatcher ? "text-access" : "text-info";
  return (
    <div className={`rounded-lg border border-edge bg-panel2 px-3 py-2 ${item.animate ? "animate-risein" : ""}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`text-[12px] font-bold ${accent}`}>
          {who} <span className="text-muted">· {isDispatcher ? "DISPATCHER" : "PROXY"}</span>
        </span>
        {msg.is_price_drop && (
          <span className="badge badge-success">CONCESSION</span>
        )}
      </div>
      <p className={`text-base text-body ${typing ? "caret" : ""}`}>{typing ? item.typed : msg.text}</p>
      {!typing && <EventTags events={msg.events} />}
    </div>
  );
}

function Separator({ item }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="h-px flex-1 bg-edge" />
      <span className="badge badge-neutral">CALL {item.callIndex + 1}: {item.callName}</span>
      <OutcomeBadge outcome={item.outcome} />
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}

export default function CallMonitor({ waveState, revealed, active, status }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [revealed, active]);

  const empty = status === "idle" && revealed.length === 0 && !active;

  return (
    <section className="panel flex flex-col p-4" aria-label="Live call monitoring hub">
      <h2 className="label mb-3">Live Call Monitoring Hub</h2>

      <div className="rounded-lg border border-edge bg-surface p-3">
        <Waveform state={waveState} />
      </div>

      <div className="mt-4 mb-2 flex items-center justify-between">
        <span className="label">Live Transcript</span>
        <span className="text-[12px] text-muted">
          {status === "running" ? "● live" : status === "done" ? "■ ended" : "○ standby"}
        </span>
      </div>

      {/* aria-live so assistive tech announces incremental transcript text */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label="Negotiation transcript"
        className="scroll-thin flex max-h-[420px] min-h-[420px] flex-col gap-2 overflow-y-auto rounded-lg border border-edge bg-surface p-3 font-mono"
      >
        {empty && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <p className="text-base">Channel on standby.</p>
            <p className="text-[14px]">Lock the job spec and launch the negotiation to watch it unfold live.</p>
          </div>
        )}
        {revealed.map((item, i) =>
          item.type === "separator" ? (
            <Separator key={`s${i}`} item={item} />
          ) : (
            <Line key={`m${i}`} item={item} typing={false} />
          )
        )}
        {active && <Line item={active} typing />}
      </div>
    </section>
  );
}
