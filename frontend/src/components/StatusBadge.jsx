import React from "react";
import { CheckIcon, ClockIcon, BlockIcon, WarnIcon, ShieldIcon } from "./Icons.jsx";

// Maps a status to {icon, text, variant}. The text label is the primary signal;
// the icon and color are reinforcement, never the sole channel.
const OUTCOME = {
  ITEMIZED_QUOTE: { Icon: CheckIcon, text: "ITEMIZED QUOTE", cls: "badge-success" },
  CALLBACK_COMMITMENT: { Icon: ClockIcon, text: "CALLBACK COMMITMENT", cls: "badge-access" },
  DOCUMENTED_DECLINE: { Icon: BlockIcon, text: "DOCUMENTED DECLINE", cls: "badge-neutral" },
};

export function OutcomeBadge({ outcome }) {
  const cfg = OUTCOME[outcome] || OUTCOME.DOCUMENTED_DECLINE;
  const { Icon } = cfg;
  return (
    <span className={`badge ${cfg.cls}`}>
      <Icon />
      {cfg.text}
    </span>
  );
}

export function RedFlagBadge({ label = "LOWBALL FRAUD RISK" }) {
  return (
    <span className="badge badge-danger" role="alert">
      <WarnIcon />
      {label}
    </span>
  );
}

export function AdaBadge() {
  return (
    <span className="badge badge-access">
      <ShieldIcon />
      ADA SHIELD ACTIVE
    </span>
  );
}
