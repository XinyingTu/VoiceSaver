// Regression test for the live-session dynamic-variable builder. This is the
// P0 fix: the locked/edited job spec must flow into the ElevenLabs session, so
// the agent stops describing the seeded Daniel job. Pure logic, no test runner:
//   node test/sessionVars.test.mjs
import assert from "node:assert/strict";
import { buildSessionDynamicVariables, sanitizeSpec } from "../src/sessionVars.js";

// An edited spec: 3-bedroom, new ZIPs, 80 miles, 1 flight, changed inventory.
const editedSpec = {
  household_size: "3_bedroom",
  origin_zip: "90210",
  destination_zip: "94103",
  distance_miles: 80,
  stair_flights: 1,
  inventory_items: ["king bed + frame", "sectional sofa", "40 packed boxes"],
};

// 1. Building session vars from an edited spec carries every edited field into
//    job_spec_json.
{
  const vars = buildSessionDynamicVariables(editedSpec, "sess-1", false);
  const parsed = JSON.parse(vars.job_spec_json);
  assert.equal(parsed.household_size, "3_bedroom", "household size");
  assert.equal(parsed.origin_zip, "90210", "origin ZIP");
  assert.equal(parsed.destination_zip, "94103", "destination ZIP");
  assert.equal(parsed.distance_miles, 80, "distance");
  assert.equal(parsed.stair_flights, 1, "stairs");
  assert.deepEqual(parsed.inventory_items, editedSpec.inventory_items, "inventory");
  assert.equal(vars.session_id, "sess-1", "session id passed through");
  assert.equal(vars.ada_shield_active, "false", "ada flag as string");
  // ElevenLabs runtime variables are scalar: job_spec_json must be a string.
  assert.equal(typeof vars.job_spec_json, "string", "job_spec_json is a JSON string, not an object");
}

// 2. The dynamic-variable value is derived from the spec argument that is passed
//    in (the current spec prop), not any module-level fixture. Two different
//    specs produce two different job_spec_json values.
{
  const daniel = {
    household_size: "2_bedroom",
    origin_zip: "29730",
    origin_label: "Rock Hill, SC",
    destination_zip: "28202",
    destination_label: "Charlotte, NC",
    distance_miles: 45,
    stair_flights: 2,
    inventory_items: ["queen bed + frame"],
  };
  const a = buildSessionDynamicVariables(daniel, "sess-a", false);
  const b = buildSessionDynamicVariables(editedSpec, "sess-b", false);
  assert.notEqual(a.job_spec_json, b.job_spec_json, "different specs -> different vars");
  const parsedA = JSON.parse(a.job_spec_json);
  assert.equal(parsedA.distance_miles, 45, "first session keeps its own spec");
}

// 3. Changing the spec between two sessions must not reuse the first session's
//    spec on the second session.
{
  let spec = { household_size: "2_bedroom", distance_miles: 45, inventory_items: [] };
  const first = buildSessionDynamicVariables(spec, "s1", false);
  // User edits and re-locks.
  spec = { household_size: "4_bedroom", distance_miles: 80, inventory_items: [] };
  const second = buildSessionDynamicVariables(spec, "s2", false);
  assert.equal(JSON.parse(first.job_spec_json).distance_miles, 45);
  assert.equal(JSON.parse(second.job_spec_json).distance_miles, 80, "second session uses the newest spec");
  assert.equal(JSON.parse(second.job_spec_json).household_size, "4_bedroom");
}

// 4. Editing origin_zip / destination_zip drops the now-stale city labels so
//    they are never treated as authoritative; the agent falls back to the ZIP.
{
  const stale = {
    origin_zip: "90210", // edited away from Rock Hill's 29730
    origin_label: "Rock Hill, SC", // leftover, now wrong
    destination_zip: "94103", // edited away from Charlotte's 28202
    destination_label: "Charlotte, NC", // leftover, now wrong
    inventory_items: [],
  };
  const cleaned = sanitizeSpec(stale);
  assert.equal(cleaned.origin_label, undefined, "stale origin_label dropped");
  assert.equal(cleaned.destination_label, undefined, "stale destination_label dropped");
  const vars = buildSessionDynamicVariables(stale, "s", false);
  assert.doesNotMatch(vars.job_spec_json, /Rock Hill/, "no stale Rock Hill label in session vars");
  assert.doesNotMatch(vars.job_spec_json, /Charlotte/, "no stale Charlotte label in session vars");
  assert.match(vars.job_spec_json, /90210/, "ZIP retained so the agent can describe by ZIP");

  // A label that still matches its verified ZIP pairing is kept.
  const consistent = { origin_zip: "29730", origin_label: "Rock Hill, SC", inventory_items: [] };
  assert.equal(sanitizeSpec(consistent).origin_label, "Rock Hill, SC", "verified label kept");
}

console.log("sessionVars: all cases passed");
