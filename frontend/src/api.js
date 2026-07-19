// API client for the VoiceSaver FastAPI backend.
export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

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
