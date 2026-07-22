// Regression test for the ledger's fraud math: is a quote 30%+ below the
// JOB-SPECIFIC benchmark (a lowball / bait-and-switch risk), and by what %.
// The benchmark is REQUIRED now — there is no hard-coded 2BR fallback, so the
// same job benchmark is used in the counter, the warning, and the ledger.
// Pure logic, no test runner required:
//   node test/lowballAssessment.test.mjs
import assert from "node:assert/strict";
import { lowballAssessment } from "../src/api.js";

// 30%+ below the given benchmark is a lowball.
assert.deepEqual(lowballAssessment(600, 2200), { isLowball: true, pctBelow: 73 });

// Exactly at the 30% threshold (2200 * 0.7 = 1540) counts as a lowball.
assert.deepEqual(lowballAssessment(1540, 2200), { isLowball: true, pctBelow: 30 });

// Just above the threshold: display rounds to 30% but it is NOT flagged
// (threshold uses the exact ratio, not the rounded percent).
assert.deepEqual(lowballAssessment(1541, 2200), { isLowball: false, pctBelow: 30 });

// A merely-cheap-but-fair quote is not a lowball.
assert.deepEqual(lowballAssessment(1800, 2200), { isLowball: false, pctBelow: 18 });

// Above benchmark → negative pctBelow, never a lowball.
assert.deepEqual(lowballAssessment(2500, 2200), { isLowball: false, pctBelow: -14 });

// The SAME quote against a larger job benchmark (3-bedroom, 3,415) IS a lowball —
// proves the assessment tracks the job benchmark, not a fixed 2,200.
assert.deepEqual(lowballAssessment(1800, 3415), { isLowball: true, pctBelow: 47 });

// No price yet → nothing to assess.
assert.deepEqual(lowballAssessment(null, 2200), { isLowball: false, pctBelow: null });

// No benchmark available → NO assessment (never silently substitute a fixture).
assert.deepEqual(lowballAssessment(600), { isLowball: false, pctBelow: null });
assert.deepEqual(lowballAssessment(600, null), { isLowball: false, pctBelow: null });

// Custom benchmark is honored.
assert.deepEqual(lowballAssessment(500, 1000), { isLowball: true, pctBelow: 50 });

console.log("lowballAssessment: all cases passed");
