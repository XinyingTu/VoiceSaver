// Dynamic-variable construction for the live ElevenLabs human-in-the-loop
// session. Kept pure + dependency-free so it is unit-tested with plain node
// (see test/sessionVars.test.mjs) and so HumanWidget builds the variables from
// the CURRENT locked spec at startSession time — never from a module-level
// fixture or stale page data.

// The only ZIP -> city/state pairings we can vouch for. Because the intake UI
// exposes ZIP fields but NO label fields, origin_label/destination_label only
// ever hold the seeded defaults. The moment a ZIP is edited away from its
// verified pairing, its label is stale and must not be treated as authoritative
// (we never invent a city name from a ZIP). Extend this map only with pairings
// that have been genuinely verified.
export const VERIFIED_ZIP_LABELS = {
  "29730": "Rock Hill, SC",
  "28202": "Charlotte, NC",
};

// Drop a location label unless it still matches its ZIP's verified pairing.
// Deterministic: same input always yields the same output, no lookups/network.
function verifiedLabel(zip, label) {
  if (!label) return undefined;
  const z = zip == null ? "" : String(zip).trim();
  return VERIFIED_ZIP_LABELS[z] === label ? label : undefined;
}

// Return a copy of the spec with any stale location label removed, so the agent
// describes edited-ZIP locations by their ZIP instead of a leftover city name.
export function sanitizeSpec(spec) {
  const s = spec && typeof spec === "object" ? { ...spec } : {};
  const origin = verifiedLabel(s.origin_zip, s.origin_label);
  const destination = verifiedLabel(s.destination_zip, s.destination_label);
  if (origin === undefined) delete s.origin_label;
  else s.origin_label = origin;
  if (destination === undefined) delete s.destination_label;
  else s.destination_label = destination;
  return s;
}

// Build the ElevenLabs dynamicVariables for one live session from the current
// locked spec. ElevenLabs runtime dynamic variables are scalar values, so the
// job spec travels as a JSON string ({{job_spec_json}} in the agent prompt) —
// never as a nested object. Strings match what the agent template expects.
export function buildSessionDynamicVariables(spec, sessionId, adaActive) {
  return {
    job_spec_json: JSON.stringify(sanitizeSpec(spec)),
    session_id: sessionId == null ? "" : String(sessionId),
    ada_shield_active: adaActive ? "true" : "false",
  };
}
