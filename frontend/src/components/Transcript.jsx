import React, { useEffect, useRef } from "react";

function Line({ msg, typing }) {
  const isMover = msg.role === "mover";
  const accent = isMover ? "text-magenta-soft" : "text-cyan-soft";
  const border = isMover ? "border-magenta-glow/40" : "border-cyan-glow/40";
  const label = isMover ? `${msg.speaker} · DISPATCHER` : `${msg.speaker} · NEGOTIATOR`;

  return (
    <div className={`animate-risein rounded-lg border ${border} bg-void/40 px-3 py-2`}>
      <div className="mb-1 flex items-center justify-between">
        <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${accent}`}>
          {label}
        </span>
        <span className="text-[10px] text-slate-500">
          T{msg.turn}
          {msg.is_breakthrough && (
            <span className="ml-2 rounded bg-neonlime/20 px-1.5 py-0.5 font-bold text-neonlime">
              BREAKTHROUGH
            </span>
          )}
        </span>
      </div>
      <p className={`text-[13px] leading-relaxed text-slate-200 ${typing ? "caret" : ""}`}>
        {typing ? msg.typed : msg.text}
      </p>
    </div>
  );
}

export default function Transcript({ messages, active, status }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, active]);

  const empty = status === "idle" && messages.length === 0 && !active;

  return (
    <div
      ref={scrollRef}
      className="scroll-thin flex max-h-[300px] min-h-[300px] flex-col gap-2 overflow-y-auto pr-1"
    >
      {empty && (
        <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center text-slate-600">
          <span className="text-3xl">📡</span>
          <p className="text-xs uppercase tracking-widest">Channel idle</p>
          <p className="text-[11px] text-slate-700">
            Select a dispatcher and open the line to begin negotiation.
          </p>
        </div>
      )}
      {messages.map((m, i) => (
        <Line key={i} msg={m} typing={false} />
      ))}
      {active && <Line msg={active} typing />}
    </div>
  );
}
