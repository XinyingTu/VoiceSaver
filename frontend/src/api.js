// API client for the VoiceSaver FastAPI backend.
export const API_BASE =
  import.meta.env?.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

async function req(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json();
}

const jsonPost = (path, body) =>
  req(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const fetchJobSpec = () => req("/api/job_spec");
export const fetchProfiles = () => req("/api/profiles");
export const fetchCounterpartyModes = () => req("/api/counterparty/modes");
export const fetchHumanWidget = (profileId = "mover_002_tough") =>
  req(`/api/counterparty/human_in_the_loop?profile_id=${encodeURIComponent(profileId)}`);
export const fetchIntakeDemo = () => req("/api/intake/demo");

export const lockSpec = (jobSpec, adaSelfAttested) =>
  jsonPost("/api/job_spec/lock", { job_spec: jobSpec, ada_self_attested: adaSelfAttested });

export const attestAdaShield = (sessionId) =>
  jsonPost("/api/ada/attest", { session_id: sessionId, confirmed: true });

export const runSession = (body) => jsonPost("/api/session/run", body);

// Deterministic benchmark for the locked spec — the same webhook the live
// ElevenLabs agent calls (get_price_benchmark). Used to populate BENCHMARK (2BR)
// in human-in-the-loop mode where there is no simulated report.
export const getPriceBenchmark = (jobSpec, vertical = "moving_services") =>
  jsonPost("/api/tools/get_price_benchmark", { vertical, job_spec: jobSpec });

// Pull the dollar figure on the table out of a live transcript line. The
// ElevenLabs tool webhooks (log_competitor_quote / calculate_discount) fire
// server-side, but the spoken price they act on is present in the conversation,
// so we can surface it live on the frontend. Matches "$1,800", "1800 dollars",
// "$1.8k". Returns a positive number or null. Keep this pure — it is unit-tested.
export function extractPrice(text) {
  if (!text || typeof text !== "string") return null;
  let best = null;
  // $1,800 / $1800 / $1.8k  (currency-anchored)
  const dollar = /\$\s?([\d,]+(?:\.\d+)?)\s?(k)?/gi;
  // 1800 dollars / 1,800 bucks (word-anchored)
  const worded = /([\d,]+(?:\.\d+)?)\s?(k)?\s?(?:dollars|bucks)\b/gi;
  for (const re of [dollar, worded]) {
    let m;
    while ((m = re.exec(text)) !== null) {
      let n = parseFloat(m[1].replace(/,/g, ""));
      if (m[2]) n *= 1000; // "k" suffix
      if (Number.isFinite(n) && n >= 100 && n <= 1_000_000) {
        // Take the last credible figure in the line — the freshest number.
        best = n;
      }
    }
  }
  return best;
}

// Red-flag phrases that turn a cheap number into a suspected lowball. Kept
// deliberately conservative (cash-only, no written estimate, upfront deposit).
const FRAUD_RE =
  /\b(?:cash[\s-]?only|cash deposit|wire transfer|venmo|zelle|no (?:written|itemized) (?:estimate|quote|breakdown)|deposit up ?front|low ?ball)\b/i;

// Self-introduction patterns spoken by the dispatcher we're negotiating with,
// e.g. "this is Tony", "name's Greg", "you've reached Sam". Captures one name.
const NAME_RE =
  /\b(?:this is|it'?s|you'?(?:ve|re) reached|name'?s|my name is)\s+([A-Z][a-z]{1,20})\b/;
// Words that follow the intro grammar but are never a person's name.
const NAME_STOP = new Set([
  "Just", "Here", "Calling", "Going", "Sorry", "Actually", "Okay", "Well", "The", "A",
]);

const OUTCOME_LABEL = {
  ITEMIZED_QUOTE: "Itemized Quote Obtained",
  LOWBALL_FRAUD: "Suspected Lowball Fraud Flagged",
  IN_PROGRESS: "Quote In Progress",
};

// Turn a finished human-in-the-loop transcript into a single ranked ledger
// entry that cites its own evidence line. Pure + unit-tested (test/). Transcript
// is the same shape HumanWidget renders: [{ isProxy, text }]. `fallbackName` is
// used when the dispatcher never introduces themselves.
export function parseClosingEntry(transcript, { fallbackName = "Dispatcher" } = {}) {
  const lines = Array.isArray(transcript) ? transcript : [];
  // Only the dispatcher's lines describe the competitor — never the proxy's.
  const theirLines = lines.filter((ln) => ln && !ln.isProxy && typeof ln.text === "string");

  // Name: first credible self-introduction in a dispatcher line.
  let name = fallbackName;
  for (const ln of theirLines) {
    const m = NAME_RE.exec(ln.text);
    if (m && !NAME_STOP.has(m[1])) {
      name = m[1];
      break;
    }
  }

  // Price: freshest credible figure the dispatcher put on the table, plus the
  // line that carried it (evidence). Scan in order so the last one wins.
  let price = null;
  let priceLine = null;
  for (const ln of theirLines) {
    const p = extractPrice(ln.text);
    if (p != null) {
      price = p;
      priceLine = ln.text;
    }
  }

  // Outcome: a red flag beats everything; otherwise a price means itemized.
  const fraudLine = lines.find((ln) => ln && typeof ln.text === "string" && FRAUD_RE.test(ln.text));
  let outcome = "IN_PROGRESS";
  let evidence = priceLine || theirLines.at(-1)?.text || lines.at(-1)?.text || "";
  if (fraudLine) {
    outcome = "LOWBALL_FRAUD";
    evidence = fraudLine.text;
  } else if (price != null) {
    outcome = "ITEMIZED_QUOTE";
  }

  return { name, price, outcome, outcomeLabel: OUTCOME_LABEL[outcome], evidence };
}

// Transcript price fallback for the live "Current Target Bid". Scans the whole
// spoken transcript (dispatcher AND proxy lines) and returns the latest credible
// dollar total, or null if none has been spoken yet. This is the authoritative
// source for the live counter: the ElevenLabs tool webhooks fire server-side and
// may miss/mangle total_price, but the number on the table is right here in the
// words — so we read it straight from the transcript and never blank once a
// figure has been said. Accepts [{ text }] lines or bare strings. Pure + tested.
export function latestPrice(transcript) {
  const lines = Array.isArray(transcript) ? transcript : [];
  let latest = null;
  for (const ln of lines) {
    const text = typeof ln === "string" ? ln : ln?.text;
    const p = extractPrice(text);
    if (p != null) latest = p; // last credible figure across the transcript wins
  }
  return latest;
}

export const uploadVision = async (file, allowDemoFallback = false) => {
  const form = new FormData();
  form.append("file", file);
  return req(`/api/intake/vision?allow_demo_fallback=${allowDemoFallback}`, {
    method: "POST",
    body: form,
  });
};

export const audioUrl = (profileId) => `${API_BASE}/api/audio/${profileId}`;
export const transcriptUrl = (profileId) => `${API_BASE}/api/session/transcript/${profileId}`;

export const money = (v) =>
  v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`;
