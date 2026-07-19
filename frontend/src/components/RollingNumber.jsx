import React from "react";

// Slot-machine / odometer number. Each digit is a vertical 0–9 strip that
// translateY-rolls to the target digit; when a price is negotiated DOWN the
// digits tumble downward, visually emphasising the savings. A staggered
// transition-delay (left→right) gives the cascading "slot machine" feel.
//
// Motion is pure CSS `transform` + `transition`, so the app-wide reduce-motion
// rule (`.reduce-motion *` and prefers-reduced-motion) instantly disables the
// roll while still landing on the correct final digit. The rolling digits are
// aria-hidden; callers pair this with an sr-only aria-live number for AT.

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Digit({ value, delayMs, durationMs }) {
  return (
    <span
      className="inline-block overflow-hidden align-baseline"
      style={{ height: "1em", lineHeight: 1 }}
    >
      <span
        className="flex flex-col"
        style={{
          transform: `translateY(-${value * 10}%)`,
          transition: `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms`,
          willChange: "transform",
        }}
      >
        {DIGITS.map((n) => (
          <span key={n} style={{ height: "1em", lineHeight: 1 }}>
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function RollingNumber({
  value,
  className = "",
  durationMs = 650,
  staggerMs = 55,
}) {
  if (value == null || Number.isNaN(value)) {
    return <span className={className} aria-hidden="true">—</span>;
  }

  const text = `$${Math.round(value).toLocaleString("en-US")}`;
  let digitIndex = 0;

  return (
    <span className={`inline-flex items-baseline ${className}`} aria-hidden="true">
      {text.split("").map((ch, i) => {
        if (/\d/.test(ch)) {
          const idx = digitIndex++;
          return (
            <Digit
              key={i}
              value={Number(ch)}
              delayMs={idx * staggerMs}
              durationMs={durationMs}
            />
          );
        }
        return <span key={i}>{ch}</span>;
      })}
    </span>
  );
}
