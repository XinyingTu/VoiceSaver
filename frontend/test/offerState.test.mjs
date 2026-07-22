// Regression tests for the AUTHORITATIVE live offer model — the single source
// the Live Savings Counter and Closing Ledger read from. This replaces the old
// "last currency amount in the transcript is the price" behavior with a
// structured OfferState that distinguishes a vendor total from a deposit, a
// unit rate, an optional fee, a mandatory addition, a competitor quote, and a
// benchmark, and that never coerces an unknown fee to $0.
//
// Pure logic, no test runner required:
//   node test/offerState.test.mjs
import assert from "node:assert/strict";
import {
  PRICE_BASIS,
  QUOTE_STATUS,
  emptyOfferState,
  deriveLiveOffer,
  counterLabel,
  bestComparableOffer,
  appendLedgerEntry,
  offerEventFromStructured,
  applyOfferEvent,
  offerStateFromEvents,
} from "../src/offerState.js";

// Dispatcher/proxy transcript lines, same shape HumanWidget renders.
const d = (text) => ({ isProxy: false, text }); // dispatcher (the vendor)
const p = (text) => ({ isProxy: true, text }); // proxy (our agent)

// Job-specific benchmark used throughout (matches the 3-bedroom screenshot job).
const BENCH = 3415;

// ── Scenario 1: total vs deposit ──────────────────────────────────────────
{
  const s = deriveLiveOffer(
    [d("Your total is $1,800, and I just need a $200 deposit to hold the date.")],
    { benchmark: BENCH }
  );
  assert.equal(s.currentKnownTotal, 1800, "total is 1800, not the deposit");
  assert.equal(s.deposit, 200, "deposit captured separately");
  assert.equal(s.finalConfirmedTotal, null, "not confirmed all-in yet");
}

// ── Scenario 2: base + explicit mandatory addition ─────────────────────────
{
  const s = deriveLiveOffer(
    [d("The base is $1,800, plus a mandatory $200 stair fee on top.")],
    { benchmark: BENCH }
  );
  assert.equal(s.currentKnownTotal, 2000, "base + explicit mandatory addition");
  assert.ok(
    s.mandatoryAdditions.some((f) => f.amount === 200 && f.includedInTotal),
    "stair fee tracked as an included mandatory addition"
  );
}

// ── Scenario 3: discount on known base while a fee stays unresolved ─────────
{
  const s = deriveLiveOffer(
    [
      d("For that move it'd be $5,000 total."),
      d("Okay, to keep the job I can bring the base down to $4,900."),
      d("There's also a stair fee, but I'd have to check the exact amount."),
    ],
    { benchmark: BENCH }
  );
  assert.equal(s.initialTotal, 5000, "initial vendor total");
  assert.equal(s.currentKnownTotal, 4900, "known base after discount");
  assert.equal(s.negotiatedSavings, 100, "100 negotiated reduction on the known price");
  assert.equal(s.finalConfirmedTotal, null, "final payable total unknown while a fee is unresolved");
  assert.ok(s.unresolvedFees.includes("stair_carry_fee"), "stair fee unresolved");
  assert.equal(s.priceBasis, PRICE_BASIS.KNOWN_BASE_PLUS_UNRESOLVED);
}

// ── Scenario 4: the AGENT mentions a competing quote → vendor offer unchanged
{
  const s = deriveLiveOffer(
    [
      d("For that job it's $1,900 all-in."),
      p("I actually have another quote for $1,700 — can you beat it?"),
    ],
    { benchmark: BENCH }
  );
  assert.equal(s.currentKnownTotal, 1900, "proxy's competitor quote never becomes the vendor total");
  assert.equal(s.finalConfirmedTotal, 1900, "vendor's all-in stands");
}

// ── Scenario 5: unit rate is not a total ───────────────────────────────────
{
  const s = deriveLiveOffer([d("It's $200 per hour, two-hour minimum.")], { benchmark: BENCH });
  assert.equal(s.currentKnownTotal, null, "a per-hour rate is not a payable total");
  assert.ok(s.unitRates.some((r) => r.amount === 200), "unit rate captured separately");
  assert.equal(s.priceBasis, PRICE_BASIS.AWAITING);
}

// ── Scenario 6: optional fee is not added to the payable total ─────────────
{
  const s = deriveLiveOffer(
    [d("It's $1,800 all-in. Optional insurance is $150 if you want it.")],
    { benchmark: BENCH }
  );
  assert.equal(s.currentKnownTotal, 1800, "optional fee not added to the total");
  assert.equal(s.finalConfirmedTotal, 1800, "all-in confirmed with no unresolved fees");
  assert.ok(s.optionalFees.some((f) => f.amount === 150), "optional fee tracked separately");
}

// ── Scenario 7: confirmed mandatory addition raises the known total ────────
{
  const s = deriveLiveOffer(
    [d("It's $1,800, plus a mandatory coverage fee of $150 on top.")],
    { benchmark: BENCH }
  );
  assert.equal(s.currentKnownTotal, 1950, "1800 base + 150 mandatory coverage");
}

// ── Scenario 8: fee named without an amount is unresolved, never $0 ────────
{
  const s = deriveLiveOffer(
    [d("Base is $1,800. There's a stair fee too, depends on the flights.")],
    { benchmark: BENCH }
  );
  assert.equal(s.currentKnownTotal, 1800, "base only — the unpriced fee is NOT added");
  assert.ok(s.unresolvedFees.includes("stair_carry_fee"), "unpriced stair fee is unresolved");
  // It must never be represented as a $0 mandatory addition.
  assert.ok(
    !s.mandatoryAdditions.some((f) => f.key === "stair_carry_fee" && f.amount === 0),
    "an unknown fee is never coerced to $0"
  );
}

// ── Scenario 9: a total-only quote is never itemized in the fallback ───────
{
  const s = deriveLiveOffer([d("It's $1,800 all-in, that's everything.")], { benchmark: BENCH });
  assert.equal(s.isItemized, false, "no vendor-stated line items → not itemized");
}

// ── Scenario 10: a lowball quote is factual but excluded from best offer ───
{
  const s = deriveLiveOffer([d("I can do the whole thing for $200 all-in.")], { benchmark: BENCH });
  assert.equal(s.lowballRisk, true, "$200 vs a $3,415 benchmark is a lowball risk");
  assert.equal(bestComparableOffer([{ ...s, id: 1 }]), null, "lowball excluded from best offer");
}

// ── Scenario 11: one benchmark everywhere ──────────────────────────────────
{
  const risky = deriveLiveOffer([d("It's $200 all-in.")], { benchmark: BENCH });
  const ok = deriveLiveOffer([d("It's $3,000 all-in, that's everything.")], { benchmark: BENCH });
  assert.equal(risky.benchmark, 3415, "counter benchmark threaded");
  assert.equal(risky.lowballRisk, true, "lowball uses the 3,415 benchmark");
  assert.equal(ok.benchmark, 3415, "same benchmark on the comparable quote");
  assert.equal(ok.lowballRisk, false, "$3,000 vs 3,415 is not a lowball");
}

// ── Scenario 12: two calls, independent state; best uses eligible only ─────
{
  const callA = deriveLiveOffer([d("It's $2,600 all-in, nothing else.")], { benchmark: BENCH });
  const callB = deriveLiveOffer([d("It's $200 all-in.")], { benchmark: BENCH }); // lowball
  assert.equal(callA.currentKnownTotal, 2600);
  assert.equal(callB.currentKnownTotal, 200);
  const best = bestComparableOffer([
    { ...callA, id: 1 },
    { ...callB, id: 2 },
  ]);
  assert.equal(best?.id, 1, "the eligible (non-lowball) quote wins, not the cheapest number");
}

// ── Scenario 13: idempotent ledger append (repeated disconnect callbacks) ──
{
  let list = [];
  const entry = { callKey: "call-1", price: 2600 };
  list = appendLedgerEntry(list, entry);
  list = appendLedgerEntry(list, entry); // duplicate finalize
  assert.equal(list.length, 1, "the same completed call is appended only once");
  list = appendLedgerEntry(list, { callKey: "call-2", price: 1800 });
  assert.equal(list.length, 2, "a genuinely new call is still appended");
}

// ── Scenario 14: a new/empty session has no stale price ────────────────────
{
  const s = emptyOfferState(BENCH);
  assert.equal(s.currentKnownTotal, null);
  assert.equal(s.initialTotal, null);
  assert.equal(s.priceBasis, PRICE_BASIS.AWAITING);
  assert.equal(deriveLiveOffer([], { benchmark: BENCH }).currentKnownTotal, null);
}

// ── Counter labels are state-aware (never an unconditional FINAL SECURED) ──
{
  assert.equal(counterLabel(emptyOfferState(BENCH)), "AWAITING VERIFIED QUOTE");
  assert.equal(
    counterLabel(deriveLiveOffer([d("It's about $1,900.")], { benchmark: BENCH })),
    "CURRENT QUOTED TOTAL"
  );
  assert.equal(
    counterLabel(
      deriveLiveOffer(
        [d("Base is $4,900, but there's a stair fee, depends on the flights.")],
        { benchmark: BENCH }
      )
    ),
    "KNOWN PRICE — ADDITIONAL FEES UNRESOLVED"
  );
  assert.equal(
    counterLabel(deriveLiveOffer([d("It's $1,800 all-in, that's everything.")], { benchmark: BENCH })),
    "FINAL CONFIRMED OFFER"
  );
  assert.equal(
    counterLabel(deriveLiveOffer([d("Roughly $2,000, that's just a ballpark estimate.")], { benchmark: BENCH })),
    "CURRENT ESTIMATE"
  );
}

// ── Structured events supersede the fallback and never cross roles ─────────
{
  // A benchmark / competitor structured event must NEVER become the vendor total.
  let s = emptyOfferState(BENCH);
  s = applyOfferEvent(s, offerEventFromStructured("market_benchmark", { amount: 3415 }));
  s = applyOfferEvent(s, offerEventFromStructured("verified_competitor_quote", { amount: 1700 }));
  assert.equal(s.currentKnownTotal, null, "benchmark/competitor events don't set the vendor total");

  s = applyOfferEvent(s, offerEventFromStructured("initial_vendor_offer", { amount: 5000 }));
  s = applyOfferEvent(s, offerEventFromStructured("revised_vendor_offer", { amount: 4900 }));
  assert.equal(s.initialTotal, 5000);
  assert.equal(s.currentKnownTotal, 4900);
  assert.equal(s.negotiatedSavings, 100);
  assert.equal(s.provisional, false, "structured state is authoritative, not provisional");
}

// ── Regression: an all-in restatement subsumes prior itemized lines (no
//    double-count). base labor $1,500 + mandatory mileage $300, then "all in
//    it's $1,800" → 1800, NOT 2100. ─────────────────────────────────────────
{
  const s = deriveLiveOffer(
    [
      d("Base labor is $1,500 and mileage is a mandatory $300."),
      d("So all in it's $1,800, that's everything."),
    ],
    { benchmark: BENCH }
  );
  assert.equal(s.currentKnownTotal, 1800, "all-in restatement is not double-counted");
  assert.equal(s.finalConfirmedTotal, 1800, "confirmed all-in equals the restated total");
}

// ── Regression: a bare "plus a $200 stair fee" (no 'mandatory' keyword) is a
//    real mandatory addition, never dropped. base $1,800 + $200 → 2000. ──────
{
  const s = deriveLiveOffer([d("The base is $1,800 plus a $200 stair fee.")], { benchmark: BENCH });
  assert.equal(s.currentKnownTotal, 2000, "a bare fee clause is added, not dropped");
  assert.ok(
    s.mandatoryAdditions.some((f) => f.amount === 200),
    "the $200 stair fee is tracked as a mandatory addition"
  );
}

// A plain (non-all-in) base restatement still keeps a fee stated on top of it.
{
  const s = deriveLiveOffer(
    [d("The base is $1,800, plus a mandatory $200 stair fee."), d("Actually the base is $1,700.")],
    { benchmark: BENCH }
  );
  assert.equal(s.currentKnownTotal, 1900, "base correction keeps the on-top fee (1700 + 200)");
}

// ── Authoritative READ path: backend-stored events (as returned by
//    /api/tools/offer_events/{id}) fold into the SAME state as everything else,
//    and benchmark/competitor still never move the vendor total. ─────────────
{
  const events = [
    { role: "initial_vendor_offer", amount: 5000, evidence: "it'd be $5,000" },
    { role: "revised_vendor_offer", amount: 4900 },
    { role: "unresolved_mandatory_fee", fee_key: "stair_carry_fee" },
    { role: "deposit", amount: 200 },
    { role: "market_benchmark", amount: 3415 },
    { role: "verified_competitor_quote", amount: 1700 },
  ];
  const s = offerStateFromEvents(events, { benchmark: BENCH });
  assert.equal(s.initialTotal, 5000, "initial vendor offer");
  assert.equal(s.currentKnownTotal, 4900, "revised vendor offer is the known total");
  assert.equal(s.negotiatedSavings, 100, "revised reduction captured");
  assert.equal(s.finalConfirmedTotal, null, "final unknown while a fee is unresolved");
  assert.equal(s.deposit, 200, "deposit tracked, not added to total");
  assert.equal(s.provisional, false, "server-sourced state is authoritative");
  assert.ok(s.unresolvedFees.includes("stair_carry_fee"));
}

console.log("offerState: all cases passed");
