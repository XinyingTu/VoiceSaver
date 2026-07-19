// Regression test for the client-side "closing ledger" parser that turns a
// finished human-in-the-loop transcript into a single ranked ledger entry.
// Pure logic, no test runner required:
//   node test/parseClosingEntry.test.mjs
import assert from "node:assert/strict";
import { parseClosingEntry } from "../src/api.js";

// Transcript lines mirror the shape produced in HumanWidget: { isProxy, text }.
const l = (isProxy, text) => ({ isProxy, text });

// 1. Itemized quote: a dispatcher who introduces themselves and lands a price.
{
  const t = [
    l(true, "Hi, I'm calling to get a moving quote for a 2-bedroom."),
    l(false, "Sure, this is Tony over at Apex Movers."),
    l(true, "Great, what's the all-in itemized total?"),
    l(false, "For that job I can do $2,000, but I'll come down to $1,800 all-in."),
  ];
  const e = parseClosingEntry(t);
  assert.equal(e.name, "Tony", "name from self-introduction");
  assert.equal(e.price, 1800, "freshest final price");
  assert.equal(e.outcome, "ITEMIZED_QUOTE");
  assert.equal(e.outcomeLabel, "Itemized Quote Obtained");
  assert.match(e.evidence, /1,?800/, "evidence cites the price line");
}

// 2. Lowball fraud: cash-only / no written estimate red flags trump the price.
{
  const t = [
    l(false, "Yeah this is Greg. I can do it for $600 cash only, no written estimate."),
    l(true, "Can you send an itemized breakdown?"),
    l(false, "Nah, cash deposit up front, trust me."),
  ];
  const e = parseClosingEntry(t);
  assert.equal(e.name, "Greg");
  assert.equal(e.outcome, "LOWBALL_FRAUD");
  assert.equal(e.outcomeLabel, "Suspected Lowball Fraud Flagged");
  assert.equal(e.price, 600, "price still surfaced alongside the flag");
  assert.match(e.evidence, /cash/i, "evidence cites the red-flag line");
}

// 3. No price yet → in-progress, and a sensible fallback name is used.
{
  const t = [
    l(true, "Hi, calling about a move."),
    l(false, "Let me check the calendar and call you back."),
  ];
  const e = parseClosingEntry(t, { fallbackName: "Sunrise Movers" });
  assert.equal(e.price, null);
  assert.equal(e.outcome, "IN_PROGRESS");
  assert.equal(e.outcomeLabel, "Quote In Progress");
  assert.equal(e.name, "Sunrise Movers", "fallback name when no self-intro");
}

// 4. Proxy self-references must not be mistaken for the competitor's name.
{
  const t = [
    l(true, "I'm calling on behalf of the household. This is VoiceSaver."),
    l(false, "Okay, we can do $1,500 itemized."),
  ];
  const e = parseClosingEntry(t, { fallbackName: "Dispatcher" });
  assert.equal(e.name, "Dispatcher", "ignore proxy lines when finding the name");
  assert.equal(e.price, 1500);
}

// 5. Empty / null transcript is safe.
{
  const e = parseClosingEntry([], { fallbackName: "Mover" });
  assert.equal(e.name, "Mover");
  assert.equal(e.price, null);
  assert.equal(e.outcome, "IN_PROGRESS");
  assert.equal(parseClosingEntry(null).name, "Dispatcher", "null transcript default name");
}

console.log("parseClosingEntry: all cases passed");
