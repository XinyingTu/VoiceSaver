// Regression test for the live-price extractor used by the human-in-the-loop
// savings counter. Pure logic, no test runner required:
//   node test/extractPrice.test.mjs
import assert from "node:assert/strict";
import { extractPrice } from "../src/api.js";

const cases = [
  ["I can do that for just $1,200. Best price.", 1200],
  ["Well that was $1,850 all-in now.", 1850],
  ["okay okay, 1800 dollars, final offer", 1800],
  ["lets say $1.8k then", 1800],
  ["first $2,000 but I can come down to $1,800", 1800], // freshest figure wins
  ["no numbers here at all", null],
  ["that is 50 bucks", null], // below the $100 credibility floor
  ["", null],
  [null, null],
  ["call me at 5551234 maybe", null], // bare digits, not a price
];

for (const [input, expected] of cases) {
  assert.equal(extractPrice(input), expected, `extractPrice(${JSON.stringify(input)})`);
}

console.log(`extractPrice: ${cases.length} cases passed`);
