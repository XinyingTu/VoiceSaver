import React, { useMemo } from "react";

// State-driven waveform. Color AND a text label carry the state, never color
// alone. This reflects the live channel (listening / processing / disconnected).
const STATE = {
  idle: { color: "#9DA7B3", label: "Channel idle", active: false },
  listening: { color: "#10B981", label: "Listening", active: true },
  processing: { color: "#F59E0B", label: "Processing", active: true },
  disconnected: { color: "#EF4444", label: "Disconnected", active: false },
};

export default function Waveform({ state = "idle", bars = 44 }) {
  const cfg = STATE[state] || STATE.idle;
  const width = 600;
  const height = 96;
  const mid = height / 2;
  const gap = width / bars;

  const seeds = useMemo(
    () => Array.from({ length: bars }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7))),
    [bars]
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Audio Waveform</span>
        <span className="badge badge-neutral" role="status" aria-live="polite">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: cfg.color }}
            aria-hidden
          />
          {cfg.label}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
        role="img"
        aria-label={`Live audio waveform: ${cfg.label}`}
      >
        {seeds.map((seed, i) => {
          const base = cfg.active ? seed : seed * 0.22;
          const barH = base * (height * 0.9);
          const x = i * gap + gap * 0.22;
          const w = gap * 0.5;
          const dur = cfg.active ? 0.7 + (i % 6) * 0.12 : 3 + (i % 4) * 0.4;
          return (
            <rect
              key={i}
              x={x}
              y={mid - barH / 2}
              width={w}
              height={barH}
              rx={w / 2}
              fill={cfg.color}
              opacity={cfg.active ? 0.9 : 0.4}
              style={{
                transformOrigin: `${x + w / 2}px ${mid}px`,
                animation: `wf ${dur}s ease-in-out ${i * 0.03}s infinite`,
              }}
            />
          );
        })}
        <style>{`@keyframes wf {0%,100%{transform:scaleY(0.35)}50%{transform:scaleY(1)}}`}</style>
      </svg>
    </div>
  );
}
