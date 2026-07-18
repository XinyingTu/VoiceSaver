import React, { useMemo } from "react";

// Animated pulsing SVG waveform. `active` intensifies the motion (live call /
// audio playing); otherwise it idles at a low ambient amplitude.
export default function Waveform({ active = false, bars = 48, color = "#22d3ee" }) {
  const width = 640;
  const height = 120;
  const mid = height / 2;
  const gap = width / bars;

  const seeds = useMemo(
    () => Array.from({ length: bars }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7))),
    [bars]
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-28 w-full"
      role="img"
      aria-label="Live audio waveform"
    >
      <defs>
        <linearGradient id="wf-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f0338d" stopOpacity="0.9" />
          <stop offset="50%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor="#a3e635" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      {seeds.map((seed, i) => {
        const base = active ? seed : seed * 0.28;
        const barH = base * (height * 0.9);
        const x = i * gap + gap * 0.2;
        const w = gap * 0.55;
        const dur = active ? 0.7 + (i % 6) * 0.12 : 2.4 + (i % 5) * 0.3;
        return (
          <rect
            key={i}
            x={x}
            y={mid - barH / 2}
            width={w}
            height={barH}
            rx={w / 2}
            fill="url(#wf-grad)"
            style={{
              transformOrigin: `${x + w / 2}px ${mid}px`,
              animation: `wfbar ${dur}s ease-in-out ${i * 0.03}s infinite`,
              opacity: active ? 0.95 : 0.4,
            }}
          />
        );
      })}
      <style>{`
        @keyframes wfbar {
          0%, 100% { transform: scaleY(0.35); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </svg>
  );
}
