// Regression test for the transcript price fallback that drives the live
// "Current Target Bid". It scans the whole spoken transcript and returns the
// latest credible total so the counter never blanks once a number is spoken.
// Pure logic, no test runner required:
//   node test/latestPrice.test.mjs
import assert from "node:assert/strict";
import { latestPrice } from "../src/api.js";

// Accepts transcript-line objects ({ text }) and bare strings.
const t = (...texts) => texts.map((text) => ({ text }));

// Latest credible figure across the whole transcript wins (freshest on the table).
assert.equal(latestPrice(t("Hi there", "I can do $1,800", "actually $1,500 final")), 1500);

// A line with no price does not blank a previously-seen price — latest still wins.
assert.equal(latestPrice(t("$1,800 all-in", "let me check the calendar")), 1800);

// Multiple numbers in one line → the last credible one (the total, not a line item).
assert.equal(latestPrice(t("labor $100, mileage $20, total $1,800")), 1800);

// "k" and worded-dollar forms are handled by extractPrice under the hood.
assert.equal(latestPrice(t("lets say $1.8k")), 1800);
assert.equal(latestPrice(t("okay, 600 dollars")), 600);

// No price anywhere → null (counter shows the honest "—" until a quote lands).
assert.equal(latestPrice(t("hello", "no numbers here")), null);
assert.equal(latestPrice([]), null);
assert.equal(latestPrice(null), null);

// Bare strings are accepted too.
assert.equal(latestPrice(["first $2,000", "then $900"]), 900);

// Sub-$100 noise (phone digits, tiny amounts) is ignored by the credibility floor.
assert.equal(latestPrice(t("call me at 5551234", "that's 50 bucks")), null);

console.log("latestPrice: all cases passed");
