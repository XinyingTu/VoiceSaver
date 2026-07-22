import React from "react";
import { CheckIcon, ClockIcon, BlockIcon, WarnIcon, ShieldIcon } from "./Icons.jsx";
import { QUOTE_STATUS, QUOTE_STATUS_LABEL } from "../offerState.js";

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

// Truthful factual quote-status badge for the live ledger. This is the FACT of
// what was captured (all-in vs total-only vs incomplete vs estimate vs callback
// vs declined) — a lowball warning is a SEPARATE badge that may coexist with it.
const QUOTE_STATUS_CLS = {
  [QUOTE_STATUS.ALL_IN_CONFIRMED]: "badge-success",
  [QUOTE_STATUS.PARTIALLY_ITEMIZED]: "badge-success",
  [QUOTE_STATUS.TOTAL_ONLY]: "badge-neutral",
  [QUOTE_STATUS.INCOMPLETE_FEES_UNRESOLVED]: "badge-neutral",
  [QUOTE_STATUS.ESTIMATE]: "badge-neutral",
  [QUOTE_STATUS.CALLBACK]: "badge-access",
  [QUOTE_STATUS.DECLINED]: "badge-neutral",
  [QUOTE_STATUS.NONE]: "badge-neutral",
};

export function QuoteStatusBadge({ status }) {
  const cls = QUOTE_STATUS_CLS[status] || "badge-neutral";
  const text = QUOTE_STATUS_LABEL[status] || "AWAITING QUOTE";
  const Icon =
    status === QUOTE_STATUS.ALL_IN_CONFIRMED || status === QUOTE_STATUS.PARTIALLY_ITEMIZED
      ? CheckIcon
      : status === QUOTE_STATUS.CALLBACK
      ? ClockIcon
      : status === QUOTE_STATUS.DECLINED
      ? BlockIcon
      : ClockIcon;
  return (
    <span className={`badge ${cls}`}>
      <Icon />
      {text}
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
