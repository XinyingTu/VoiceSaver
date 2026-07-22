// Authoritative live-offer model for VoiceSaver.
//
// The transcript is EVIDENCE, not the price state. This module owns the one
// structured OfferState that the Live Savings Counter and Closing Ledger read
// from, so a deposit, a per-hour rate, an optional add-on, the agent's own
// competitor quote, and the market benchmark can never be mistaken for the
// vendor's payable total, and an unknown fee is never coerced to $0.
//
// Two producers feed the SAME state, in this order of authority:
//   1. Structured offer events (record_offer_event tool, surfaced live by the
//      ElevenLabs SDK). These are authoritative — applyOfferEvent / structured.
//   2. A conservative, dispatcher-lines-only transcript classifier used ONLY as
//      a clearly-labeled fallback when no structured events are available
//      (deriveLiveOffer, provisional: true).
//
// Pure + dependency-light so it is unit-tested with plain node (test/).
import { extractPrice, lowballAssessment } from "./api.js";

export const PRICE_BASIS = {
  AWAITING: "awaiting",
  WORKING_OFFER: "working_offer",
  KNOWN_BASE_PLUS_UNRESOLVED: "known_base_plus_unresolved_fees",
  ALL_IN_CONFIRMED: "all_in_confirmed",
  ESTIMATE: "estimate",
  NO_COMPARABLE_QUOTE: "no_comparable_quote",
};

export const QUOTE_STATUS = {
  NONE: "none",
  TOTAL_ONLY: "total_only",
  PARTIALLY_ITEMIZED: "partially_itemized",
  ALL_IN_CONFIRMED: "all_in_confirmed",
  INCOMPLETE_FEES_UNRESOLVED: "incomplete_fees_unresolved",
  ESTIMATE: "estimate",
  CALLBACK: "callback",
  DECLINED: "declined",
};

// State-aware Counter label. Never an unconditional "FINAL SECURED BID".
const BASIS_LABEL = {
  [PRICE_BASIS.AWAITING]: "AWAITING VERIFIED QUOTE",
  [PRICE_BASIS.WORKING_OFFER]: "CURRENT QUOTED TOTAL",
  [PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED]: "KNOWN PRICE — ADDITIONAL FEES UNRESOLVED",
  [PRICE_BASIS.ALL_IN_CONFIRMED]: "FINAL CONFIRMED OFFER",
  [PRICE_BASIS.ESTIMATE]: "CURRENT ESTIMATE",
  [PRICE_BASIS.NO_COMPARABLE_QUOTE]: "NO COMPARABLE QUOTE",
};

export function counterLabel(state) {
  return BASIS_LABEL[state?.priceBasis] || BASIS_LABEL[PRICE_BASIS.AWAITING];
}

// Human-readable badge for the ledger's factual quote status (lowball risk is
// tracked separately and MAY coexist with any of these).
export const QUOTE_STATUS_LABEL = {
  [QUOTE_STATUS.NONE]: "AWAITING QUOTE",
  [QUOTE_STATUS.TOTAL_ONLY]: "TOTAL ONLY",
  [QUOTE_STATUS.PARTIALLY_ITEMIZED]: "PARTIALLY ITEMIZED",
  [QUOTE_STATUS.ALL_IN_CONFIRMED]: "ALL-IN CONFIRMED",
  [QUOTE_STATUS.INCOMPLETE_FEES_UNRESOLVED]: "INCOMPLETE — FEES UNRESOLVED",
  [QUOTE_STATUS.ESTIMATE]: "ESTIMATE / NON-BINDING",
  [QUOTE_STATUS.CALLBACK]: "CALLBACK REQUIRED",
  [QUOTE_STATUS.DECLINED]: "DECLINED",
};

// ─────────────────────────────────────────────────────────────────────────
// The fee taxonomy (mirrors config/domain_config.json fee_line_items). Kept
// here so the classifier can name unresolved fees with the same keys the
// backend uses. Order defines display order.
// ─────────────────────────────────────────────────────────────────────────
export const FEE_KEYS = [
  "base_labor_fee",
  "mileage_fee",
  "stair_carry_fee",
  "long_carry_fee",
  "packing_materials_fee",
  "fuel_surcharge",
];

// Map a spoken fee noun to a taxonomy key (best-effort; unknown nouns keep a
// free-text label and no key).
function feeKeyFor(text) {
  const t = text.toLowerCase();
  if (/\bstairs?\b|stair[- ]?carry|flights?\b/.test(t)) return "stair_carry_fee";
  if (/\bmileage\b|\bmiles?\b/.test(t)) return "mileage_fee";
  if (/\bfuel\b/.test(t)) return "fuel_surcharge";
  if (/\bpacking\b|materials?\b/.test(t)) return "packing_materials_fee";
  if (/long[- ]?carry/.test(t)) return "long_carry_fee";
  if (/\blabou?r\b/.test(t)) return "base_labor_fee";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Empty / initial state
// ─────────────────────────────────────────────────────────────────────────
export function emptyOfferState(benchmark = null) {
  return {
    initialTotal: null,
    knownBase: null, // the vendor's stated base/subtotal before mandatory additions
    currentKnownTotal: null, // knownBase + amounts of INCLUDED mandatory additions
    finalConfirmedTotal: null, // only when all-in confirmed AND nothing unresolved
    priceBasis: PRICE_BASIS.AWAITING,
    quoteStatus: QUOTE_STATUS.NONE,
    isItemized: false, // only structured vendor line items make this true
    mandatoryAdditions: [], // [{ key, label, amount|null, includedInTotal }]
    unresolvedFees: [], // [feeKey|label]
    deposit: null,
    optionalFees: [], // [{ label, amount }]
    unitRates: [], // [{ label, amount, unit }]
    negotiatedSavings: null, // initialTotal - knownBase, only when vendor lowered it
    lowballRisk: false,
    outcome: null, // 'CALLBACK' | 'DECLINED' | null
    benchmark: benchmark == null ? null : benchmark,
    evidence: {}, // { initialTotal, currentKnownTotal, deposit, ... }
    provisional: false, // true when derived from the transcript fallback
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Internal event application. Events are the shared currency of both producers.
// event = { type, amount, feeKey, label, unit, confirmedAllIn, isEstimate,
//           evidence }  where type ∈ vendor_total | mandatory_addition |
//           unresolved_fee | deposit | unit_rate | optional_fee | outcome
// ─────────────────────────────────────────────────────────────────────────
export function applyOfferEvent(state, event) {
  if (!event || !event.type) return state;
  const s = {
    ...state,
    mandatoryAdditions: [...state.mandatoryAdditions],
    unresolvedFees: [...state.unresolvedFees],
    optionalFees: [...state.optionalFees],
    unitRates: [...state.unitRates],
    evidence: { ...state.evidence },
  };

  switch (event.type) {
    case "vendor_total": {
      const amt = event.amount;
      if (!(amt > 0)) break;
      if (s.initialTotal == null) {
        s.initialTotal = amt;
        s.evidence.initialTotal = event.evidence || s.evidence.initialTotal;
      }
      s.knownBase = amt;
      s.evidence.currentKnownTotal = event.evidence || s.evidence.currentKnownTotal;
      if (event.isEstimate) s._latestIsEstimate = true;
      else s._latestIsEstimate = false;
      if (event.confirmedAllIn) {
        s._allInConfirmed = true;
        // An all-in RESTATEMENT subsumes the earlier itemized lines — do not add
        // them again on top of it (that would double-count). A plain base
        // restatement (not all-in) keeps additions, which still sit on top.
        s.mandatoryAdditions = [];
      }
      break;
    }
    case "mandatory_addition": {
      if (event.amount != null && event.amount > 0) {
        s.mandatoryAdditions.push({
          key: event.feeKey || null,
          label: event.label || event.feeKey || "mandatory fee",
          amount: event.amount,
          includedInTotal: true,
          evidence: event.evidence || null,
        });
        // A newly-priced fee resolves any prior "unresolved" of the same key.
        if (event.feeKey) s.unresolvedFees = s.unresolvedFees.filter((k) => k !== event.feeKey);
      } else {
        // Named mandatory fee with NO amount → unresolved, never $0.
        const key = event.feeKey || event.label;
        if (key && !s.unresolvedFees.includes(key)) s.unresolvedFees.push(key);
      }
      break;
    }
    case "unresolved_fee": {
      const key = event.feeKey || event.label;
      if (
        key &&
        !s.unresolvedFees.includes(key) &&
        !s.mandatoryAdditions.some((f) => f.key === key)
      ) {
        s.unresolvedFees.push(key);
      }
      break;
    }
    case "deposit":
      if (event.amount > 0) {
        s.deposit = event.amount;
        s.evidence.deposit = event.evidence || s.evidence.deposit;
      }
      break;
    case "optional_fee":
      if (event.amount > 0) s.optionalFees.push({ label: event.label || "optional", amount: event.amount });
      break;
    case "unit_rate":
      if (event.amount > 0) s.unitRates.push({ label: event.label || "rate", amount: event.amount, unit: event.unit || null });
      break;
    case "outcome":
      s.outcome = event.outcome || null; // 'CALLBACK' | 'DECLINED'
      break;
    default:
      break;
  }
  return recompute(s);
}

// Recompute all derived fields from the accumulated primitives.
function recompute(s) {
  const additionsTotal = s.mandatoryAdditions
    .filter((f) => f.includedInTotal && f.amount != null)
    .reduce((sum, f) => sum + f.amount, 0);

  s.currentKnownTotal = s.knownBase == null ? null : round2(s.knownBase + additionsTotal);

  const hasUnresolved = s.unresolvedFees.length > 0;
  const allIn = Boolean(s._allInConfirmed);

  // Negotiated savings: only a genuine vendor reduction of the known base.
  s.negotiatedSavings =
    s.initialTotal != null && s.knownBase != null && s.knownBase < s.initialTotal
      ? round2(s.initialTotal - s.knownBase)
      : null;

  // Final confirmed only when the vendor confirmed all-in AND nothing is unresolved.
  s.finalConfirmedTotal = allIn && !hasUnresolved && s.currentKnownTotal != null ? s.currentKnownTotal : null;

  // Price basis.
  if (s.outcome === "DECLINED") {
    s.priceBasis = PRICE_BASIS.NO_COMPARABLE_QUOTE;
  } else if (s.knownBase == null) {
    s.priceBasis = PRICE_BASIS.AWAITING;
  } else if (hasUnresolved) {
    s.priceBasis = PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED;
  } else if (allIn) {
    s.priceBasis = PRICE_BASIS.ALL_IN_CONFIRMED;
  } else if (s._latestIsEstimate) {
    s.priceBasis = PRICE_BASIS.ESTIMATE;
  } else {
    s.priceBasis = PRICE_BASIS.WORKING_OFFER;
  }

  // Factual quote status.
  if (s.outcome === "DECLINED") s.quoteStatus = QUOTE_STATUS.DECLINED;
  else if (s.outcome === "CALLBACK") s.quoteStatus = QUOTE_STATUS.CALLBACK;
  else if (s.knownBase == null) s.quoteStatus = QUOTE_STATUS.NONE;
  else if (hasUnresolved) s.quoteStatus = QUOTE_STATUS.INCOMPLETE_FEES_UNRESOLVED;
  else if (allIn) s.quoteStatus = QUOTE_STATUS.ALL_IN_CONFIRMED;
  else if (s._latestIsEstimate) s.quoteStatus = QUOTE_STATUS.ESTIMATE;
  else if (s.isItemized) s.quoteStatus = QUOTE_STATUS.PARTIALLY_ITEMIZED;
  else s.quoteStatus = QUOTE_STATUS.TOTAL_ONLY;

  // Lowball risk against the SINGLE job benchmark, on the displayed payable.
  const payable = s.finalConfirmedTotal ?? s.currentKnownTotal ?? s.initialTotal;
  s.lowballRisk = lowballAssessment(payable, s.benchmark ?? undefined).isLowball && payable != null;

  return s;
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────
// Structured producer: map a record_offer_event role → an internal event.
// Roles that describe something OTHER than the vendor's payable total map to a
// non-total event, so a benchmark / competitor / deposit / optional / unit rate
// can never be substituted for the vendor total.
// ─────────────────────────────────────────────────────────────────────────
export function offerEventFromStructured(role, payload = {}) {
  const amount = num(payload.amount);
  const base = { amount, evidence: payload.evidence || null, feeKey: payload.fee_key || payload.feeKey || null, label: payload.label || null };
  switch (role) {
    case "initial_vendor_offer":
    case "revised_vendor_offer":
    case "known_base_or_subtotal":
      return { ...base, type: "vendor_total", confirmedAllIn: false, isEstimate: Boolean(payload.is_estimate) };
    case "final_confirmed_offer":
      return { ...base, type: "vendor_total", confirmedAllIn: true, isEstimate: false };
    case "known_mandatory_addition":
      return { ...base, type: "mandatory_addition" };
    case "unresolved_mandatory_fee":
      return { type: "unresolved_fee", feeKey: base.feeKey, label: base.label, evidence: base.evidence };
    case "deposit":
      return { ...base, type: "deposit" };
    case "optional_fee":
      return { ...base, type: "optional_fee" };
    case "unit_rate":
      return { ...base, type: "unit_rate", unit: payload.unit || null };
    // Never map to the vendor total:
    case "verified_competitor_quote":
    case "market_benchmark":
    default:
      return null;
  }
}

function num(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Fallback producer: conservative, dispatcher-lines-only transcript classifier.
// "Total or nothing": an amount is promoted to a vendor total ONLY with explicit
// total/offer context; deposits, per-unit rates, optional fees, and mandatory
// additions are recognized so they are placed correctly (or rejected), and any
// ambiguous amount is ignored. Everything produced here is provisional.
// ─────────────────────────────────────────────────────────────────────────

const RATE_RE = /\bper\s?(hour|hr|mile|box|item|day)\b|\ban?\s?(hour|mile)\b|\/\s?(hr|hour|mile)\b|hourly\b/i;
const DEPOSIT_RE = /\bdeposit\b|\bdown\s?payment\b|to\s?hold\b|hold the (job|date|slot)|put\s?down\b|reservation fee\b/i;
const OPTIONAL_RE = /\boptional\b|\bif you (want|'?d like|choose)\b|\badd-?on\b|\bupgrade\b|insurance(?! is mandatory)/i;
const MANDATORY_RE = /\bmandatory\b|\brequired\b|\bplus\b|\bon top\b|\bextra\b|\badditional\b|\bcomes to another\b|\bhas to be\b/i;
const TOTAL_RE = /\btotal\b|\ball[- ]?in\b|\bit'?s\b|\bit'?d be\b|\bthat'?d be\b|\bi can do\b|\bcomes to\b|\bruns?\b|\bflat\b|\bfor the (whole )?(job|move)\b|\bbase\b|\bout the door\b|\bcharge you\b|\bprice is\b/i;
const ESTIMATE_RE = /\bestimate\b|\bballpark\b|\broughly\b|\baround\b|\bapprox|\bgive or take\b|\bsomewhere\b|\bnon-?binding\b/i;
const ALLIN_RE = /\ball[- ]?in\b|that'?s everything|nothing else|no other (fees|charges)|no hidden|out the door|flat rate/i;
const UNCERTAIN_RE = /\bdepend|have to check|not sure|unknown|we'?ll see|can'?t say|varies|might be|could be|to be determined|\btbd\b|need to (look|see)/i;
const DECLINE_RE = /\b(not going to (give|quote)|won'?t quote|no quote|refuse|deposit or lose|lose my number|we'?re done|hang(ing)? up)\b/i;
const CALLBACK_RE = /\b(call you back|have someone call|supervisor will call|manager will call|owner will call|call you tomorrow)\b/i;

// Split a dispatcher line into clauses so each amount is classified by its own
// local context ("$1,800, plus a $200 stair fee" → two clauses). A comma splits
// only when it is NOT a thousands separator (i.e. not between digits), so
// "$1,800" stays intact.
function clauses(text) {
  return text
    .split(/;|\.|\bplus\b|\band\b|\bbut\b|\bwith\b|,(?!\d)/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

// Classify one dispatcher line into zero or more internal events.
export function classifyDispatcherLine(text) {
  if (!text || typeof text !== "string") return [];
  const events = [];
  const pricedFeeKeys = new Set();

  for (const clause of clauses(text)) {
    const amount = extractPrice(clause);
    if (amount == null) continue;
    const low = clause.toLowerCase();

    // Order matters — most specific, non-total roles first.
    if (RATE_RE.test(low)) {
      const unit = (low.match(RATE_RE) || [])[0] || null;
      events.push({ type: "unit_rate", amount, unit, evidence: clause });
      continue;
    }
    if (DEPOSIT_RE.test(low)) {
      events.push({ type: "deposit", amount, evidence: clause });
      continue;
    }
    if (MANDATORY_RE.test(low) && !TOTAL_RE_headline(low)) {
      const feeKey = feeKeyFor(clause);
      if (feeKey) pricedFeeKeys.add(feeKey);
      events.push({ type: "mandatory_addition", amount, feeKey, label: feeLabel(clause), evidence: clause });
      continue;
    }
    if (OPTIONAL_RE.test(low)) {
      events.push({ type: "optional_fee", amount, label: feeLabel(clause), evidence: clause });
      continue;
    }
    if (TOTAL_RE.test(low) || ESTIMATE_RE.test(low)) {
      events.push({
        type: "vendor_total",
        amount,
        confirmedAllIn: ALLIN_RE.test(low),
        isEstimate: ESTIMATE_RE.test(low),
        evidence: clause,
      });
      continue;
    }
    // A clause that NAMES a fee and carries an amount, with no total/deposit/
    // rate/optional cue, is a mandatory line item — e.g. "plus a $200 stair fee"
    // once the connective "plus"/"and" has been split off. Capture it as an
    // addition (applied on top of the current base) so a genuinely-owed fee is
    // never silently dropped, understating the total.
    const fk = feeKeyFor(clause);
    if (fk || /\bfee\b|surcharge/i.test(low)) {
      if (fk) pricedFeeKeys.add(fk);
      events.push({ type: "mandatory_addition", amount, feeKey: fk, label: feeLabel(clause), evidence: clause });
      continue;
    }
    // Ambiguous amount with no total/offer semantics → ignore (conservative).
  }

  // Line-level: a fee noun stated with uncertainty and no amount is unresolved.
  if (UNCERTAIN_RE.test(text)) {
    const key = feeKeyFor(text);
    if (key && !pricedFeeKeys.has(key)) events.push({ type: "unresolved_fee", feeKey: key, evidence: text });
  }

  // Line-level outcome markers.
  if (DECLINE_RE.test(text)) events.push({ type: "outcome", outcome: "DECLINED", evidence: text });
  else if (CALLBACK_RE.test(text)) events.push({ type: "outcome", outcome: "CALLBACK", evidence: text });

  return events;
}

// A clause that both names a mandatory addition AND uses whole-total wording is
// treated as a total, not an addition (e.g. "the all-in total is $2,000").
function TOTAL_RE_headline(low) {
  return /\ball[- ]?in\b|\btotal\b|out the door/.test(low);
}

function feeLabel(clause) {
  const key = feeKeyFor(clause);
  if (key) {
    return {
      stair_carry_fee: "Stair carry",
      mileage_fee: "Mileage",
      fuel_surcharge: "Fuel surcharge",
      packing_materials_fee: "Packing materials",
      long_carry_fee: "Long carry",
      base_labor_fee: "Base labor",
    }[key];
  }
  // Free-text label for a non-taxonomy mandatory fee (e.g. "coverage").
  const m = clause.match(/([a-z][a-z ]{2,30}?)\s?fee/i);
  return m ? m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()) : "Mandatory fee";
}

// Fold BACKEND-STORED structured offer events (the authoritative server path:
// the hosted agent's webhook tool wrote them into the session store, and the
// frontend fetched them from /api/tools/offer_events/{session_id}) into an
// authoritative OfferState. Reuses the SAME reducer as the transcript fallback,
// so the two producers can never disagree. Each event carries { role, amount,
// fee_key, label, is_estimate } as stored by record_offer_event.
export function offerStateFromEvents(events, { benchmark = null } = {}) {
  let state = emptyOfferState(benchmark);
  for (const e of Array.isArray(events) ? events : []) {
    const ev = e && e.role ? offerEventFromStructured(e.role, e) : null;
    if (ev) state = applyOfferEvent(state, ev);
  }
  state.provisional = false; // server-sourced state is authoritative
  return state;
}

// Fold a whole transcript (dispatcher lines only) into a provisional OfferState.
export function deriveLiveOffer(transcript, { benchmark = null } = {}) {
  let state = { ...emptyOfferState(benchmark), provisional: true };
  const lines = Array.isArray(transcript) ? transcript : [];
  for (const ln of lines) {
    if (!ln || ln.isProxy) continue; // NEVER read the proxy/agent's own lines as the vendor price
    const text = typeof ln === "string" ? ln : ln.text;
    for (const ev of classifyDispatcherLine(text)) state = applyOfferEvent(state, ev);
  }
  state.provisional = true;
  return state;
}

// ─────────────────────────────────────────────────────────────────────────
// Best comparable offer eligibility (drives the Closing Ledger's Best Offer).
// ─────────────────────────────────────────────────────────────────────────
export function isComparisonReady(state) {
  if (!state) return false;
  if (state.lowballRisk) return false;
  if (state.outcome === "DECLINED" || state.outcome === "CALLBACK") return false;
  if (state.priceBasis === PRICE_BASIS.ESTIMATE) return false;
  if (state.priceBasis === PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED) return false;
  const payable = state.finalConfirmedTotal ?? state.currentKnownTotal;
  return payable != null && payable > 0;
}

// Return the single eligible entry with the lowest payable total, or null.
// Entries are OfferState objects (optionally carrying an id/callKey).
export function bestComparableOffer(entries) {
  const eligible = (Array.isArray(entries) ? entries : []).filter(isComparisonReady);
  if (!eligible.length) return null;
  return eligible.reduce((best, e) => {
    const ep = e.finalConfirmedTotal ?? e.currentKnownTotal;
    const bp = best.finalConfirmedTotal ?? best.currentKnownTotal;
    return ep < bp ? e : best;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Idempotent ledger append — a completed call is added once even if the SDK
// fires the disconnect/finalize path more than once.
// ─────────────────────────────────────────────────────────────────────────
export function appendLedgerEntry(list, entry) {
  const arr = Array.isArray(list) ? list : [];
  if (entry?.callKey != null && arr.some((e) => e.callKey === entry.callKey)) return arr;
  return [...arr, entry];
}
