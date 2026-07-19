// Regression test for the live ledger card's fraud math: is a quote 30%+ below
// the 2-bedroom benchmark (a lowball / bait-and-switch risk), and by what %.
// Pure logic, no test runner required:
//   node test/lowballAssessment.test.mjs
import assert from "node:assert/strict";
import { lowballAssessment } from "../src/api.js";

// Default benchmark is 2200 (matches get_price_benchmark's 2BR baseline).
assert.deepEqual(lowballAssessment(600), { isLowball: true, pctBelow: 73 });

// Exactly at the 30% threshold (2200 * 0.7 = 1540) counts as a lowball.
assert.deepEqual(lowballAssessment(1540), { isLowball: true, pctBelow: 30 });

// Just above the threshold: display rounds to 30% but it is NOT flagged
// (threshold uses the exact ratio, not the rounded percent).
assert.deepEqual(lowballAssessment(1541), { isLowball: false, pctBelow: 30 });

// A merely-cheap-but-fair quote is not a lowball.
assert.deepEqual(lowballAssessment(1800), { isLowball: false, pctBelow: 18 });

// Above benchmark → negative pctBelow, never a lowball.
assert.deepEqual(lowballAssessment(2500), { isLowball: false, pctBelow: -14 });

// No price yet → nothing to assess.
assert.deepEqual(lowballAssessment(null), { isLowball: false, pctBelow: null });

// Custom benchmark is honored.
assert.deepEqual(lowballAssessment(500, 1000), { isLowball: true, pctBelow: 50 });

console.log("lowballAssessment: all cases passed");
