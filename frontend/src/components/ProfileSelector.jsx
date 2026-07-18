import React from "react";

const AVATAR = {
  tony_lowballer: "🙂",
  brenda_tough: "😠",
  greg_hard_seller: "🤝",
};

export default function ProfileSelector({ profiles, selectedId, onSelect, disabled }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {profiles.map((p) => {
        const selected = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(p.id)}
            className={`group rounded-xl border p-3 text-left transition ${
              selected
                ? "border-cyan-glow/70 bg-cyan-glow/5 shadow-neon"
                : "border-paneledge bg-void/40 hover:border-cyan-glow/40"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">{AVATAR[p.id] || "🚚"}</span>
              <div className="min-w-0">
                <div
                  className={`truncate text-sm font-bold ${
                    selected ? "text-cyan-soft neon-text" : "text-slate-200"
                  }`}
                >
                  {p.name}
                </div>
                <div className="truncate text-[10px] uppercase tracking-wider text-slate-500">
                  {p.archetype}
                </div>
              </div>
            </div>
            <div className="mt-2 line-clamp-2 text-[11px] leading-snug text-slate-500">
              {p.personality}
            </div>
          </button>
        );
      })}
    </div>
  );
}
