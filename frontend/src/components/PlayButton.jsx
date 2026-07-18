import React, { useEffect, useRef, useState } from "react";

// High-fidelity custom Play button for the mocked ElevenLabs highlight audio.
// `autoTrigger` is a counter — bump it to request autoplay (e.g. at breakthrough).
export default function PlayButton({ sources, disabled, autoTrigger = 0, caption }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

  const play = () => {
    const el = audioRef.current;
    if (!el) return;
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      play();
    }
  };

  // Autoplay when the trigger counter increments (browser may block until a
  // user gesture; we degrade gracefully to the manual button).
  useEffect(() => {
    if (autoTrigger > 0 && ready) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrigger, ready]);

  const onError = () => {
    // Fall back from the local mirror to the API route.
    const el = audioRef.current;
    if (el && sources?.remote && el.src.indexOf(sources.remote) === -1 && sources.remote !== sources.local) {
      el.src = sources.remote;
      el.load();
    }
  };

  const circumference = 2 * Math.PI * 26;
  const dash = circumference * (1 - progress);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={playing ? "Pause highlight" : "Play highlight"}
        className={`group relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border transition
          ${disabled
            ? "cursor-not-allowed border-paneledge text-slate-600"
            : "border-magenta-glow/60 text-magenta-soft shadow-magenta hover:scale-105"}`}
      >
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
          <circle
            cx="30"
            cy="30"
            r="26"
            fill="none"
            stroke="#f0338d"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dash}
            style={{ transition: "stroke-dashoffset 0.1s linear" }}
          />
        </svg>
        {playing ? (
          <span className="flex gap-1">
            <span className="h-5 w-1.5 rounded bg-magenta-soft" />
            <span className="h-5 w-1.5 rounded bg-magenta-soft" />
          </span>
        ) : (
          <span className="ml-1 block h-0 w-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-magenta-soft" />
        )}
      </button>

      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-magenta-soft">
          ElevenLabs Highlight <span className="text-slate-600">(mock)</span>
        </div>
        <div className="truncate text-[11px] text-slate-400">
          {caption || "The moment the mover caves."}
        </div>
      </div>

      <audio
        ref={audioRef}
        src={sources?.local}
        preload="auto"
        onCanPlay={() => setReady(true)}
        onError={onError}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) setProgress(el.currentTime / el.duration);
        }}
      />
    </div>
  );
}
