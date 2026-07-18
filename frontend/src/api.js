// Thin API client for the FastAPI backend.
export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "http://localhost:8000";

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const fetchJob = () => getJSON("/api/job");
export const fetchProfiles = () => getJSON("/api/profiles");
export const fetchNegotiation = (profileId) =>
  getJSON(`/api/negotiation/${profileId}`);

// Prefer the statically-served mirror in /public/audio so playback works even
// if the API host differs; fall back to the API audio route.
export const audioUrlFor = (profileId, apiAudioUrl) => {
  const local = `/audio/highlight_${profileId}.wav`;
  return { local, remote: apiAudioUrl ? `${API_BASE}${apiAudioUrl}` : local };
};

export const formatMoney = (value) =>
  value == null ? "—" : `$${Math.round(value).toLocaleString("en-US")}`;
