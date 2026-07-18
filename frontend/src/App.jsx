import React, { useEffect, useMemo, useState } from "react";
import {
  API_BASE,
  audioUrlFor,
  fetchJob,
  fetchNegotiation,
  fetchProfiles,
  formatMoney,
} from "./api.js";
import { useNegotiationPlayback } from "./hooks/useNegotiationPlayback.js";
import IntakePanel from "./components/IntakePanel.jsx";
import ProfileSelector from "./components/ProfileSelector.jsx";
import Waveform from "./components/Waveform.jsx";
import Transcript from "./components/Transcript.jsx";
import SavingsCounter from "./components/SavingsCounter.jsx";
import PlayButton from "./components/PlayButton.jsx";

export default function App() {
  const [job, setJob] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState("greg_hard_seller");
  const [negotiation, setNegotiation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  const [error, setError] = useState(null);
  const [audioTrigger, setAudioTrigger] = useState(0);

  const playback = useNegotiationPlayback(negotiation);
  const running = playback.status === "running";

  // Initial load: job + profiles.
  useEffect(() => {
    Promise.all([fetchJob(), fetchProfiles()])
      .then(([jobData, profileData]) => {
        setJob(jobData);
        setProfiles(profileData.profiles);
        if (profileData.profiles.length && !profileData.profiles.some((p) => p.id === "greg_hard_seller")) {
          setSelectedId(profileData.profiles[0].id);
        }
      })
      .catch((e) => setError(`Cannot reach backend at ${API_BASE}. Is uvicorn running? (${e.message})`));
  }, []);

  // Start playback once the freshly-fetched negotiation is in state.
  useEffect(() => {
    if (pendingStart && negotiation) {
      playback.start();
      setPendingStart(false);
    }
  }, [pendingStart, negotiation, playback]);

  // Fire the highlight audio at the exact breakthrough line.
  useEffect(() => {
    if (playback.breakthroughFired) setAudioTrigger((t) => t + 1);
  }, [playback.breakthroughFired]);

  const openLine = async () => {
    if (running || loading) return;
    setError(null);
    setLoading(true);
    playback.reset();
    setNegotiation(null);
    try {
      const result = await fetchNegotiation(selectedId);
      setNegotiation(result);
      setPendingStart(true);
    } catch (e) {
      setError(`Negotiation request failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectProfile = (id) => {
    if (running || loading) return;
    setSelectedId(id);
    setNegotiation(null);
    playback.reset();
  };

  const audioSources = useMemo(
    () => audioUrlFor(selectedId, negotiation?.audio_url),
    [selectedId, negotiation]
  );

  const highlight = negotiation?.highlight;
  const caption = highlight
    ? `${highlight.mover_name} drops ${formatMoney(highlight.price_before)} → ${formatMoney(
        highlight.price_after
      )}`
    : "The moment the mover caves.";

  return (
    <div className="cockpit-bg min-h-screen w-full px-4 py-5 sm:px-8">
      {/* Header */}
      <header className="mx-auto mb-5 flex max-w-[1500px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-black tracking-wider text-cyan-soft neon-text sm:text-3xl">
            THE&nbsp;NEGOTIATOR
          </h1>
          <p className="text-[11px] uppercase tracking-[0.3em] text-magenta-soft">
            Live Voice Negotiation Control Center
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`chip ${error ? "border-amberflag/50 text-amberflag" : "border-neonlime/40 text-neonlime"}`}>
            <span className={`h-2 w-2 rounded-full ${error ? "bg-amberflag" : "bg-neonlime animate-pulseglow"}`} />
            {error ? "Backend offline" : "Simulated Market online"}
          </span>
          <span className="chip">{API_BASE.replace(/^https?:\/\//, "")}</span>
        </div>
      </header>

      {error && (
        <div className="mx-auto mb-4 max-w-[1500px] rounded-lg border border-amberflag/50 bg-amberflag/10 px-4 py-2 text-[12px] text-amber-200">
          {error}
        </div>
      )}

      {/* Three-column cockpit */}
      <main className="mx-auto grid max-w-[1500px] grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)_360px]">
        {/* LEFT */}
        <IntakePanel job={job} />

        {/* MIDDLE */}
        <section className="panel flex flex-col p-4">
          <div className="scanline" />
          <div className="mb-3 flex items-center justify-between">
            <div className="panel-title">
              <span className="inline-block h-2 w-2 rounded-full bg-cyan-glow animate-pulseglow" />
              Live Call Monitoring Suite
            </div>
            <span className="chip">
              {running ? "● REC" : playback.status === "done" ? "■ ENDED" : "○ STANDBY"}
            </span>
          </div>

          <ProfileSelector
            profiles={profiles}
            selectedId={selectedId}
            onSelect={selectProfile}
            disabled={running || loading}
          />

          <button
            type="button"
            onClick={openLine}
            disabled={running || loading}
            className={`mt-3 w-full rounded-xl border py-2.5 font-display text-sm font-bold uppercase tracking-widest transition ${
              running || loading
                ? "cursor-not-allowed border-paneledge text-slate-600"
                : "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-soft shadow-neon hover:bg-cyan-glow/20"
            }`}
          >
            {loading ? "Dialing…" : running ? "Negotiation in progress…" : "▶ Open Line & Negotiate"}
          </button>

          {/* Waveform */}
          <div className="mt-4 rounded-xl border border-paneledge bg-void/50 p-3">
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
              <span>Voice Channel</span>
              <span className={running ? "text-neonlime" : "text-slate-600"}>
                {running ? "streaming" : "muted"}
              </span>
            </div>
            <Waveform active={running} />
          </div>

          {/* Transcript */}
          <div className="mt-4 flex-1">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-500">
              Live Transcript
            </div>
            <Transcript messages={playback.messages} active={playback.active} status={playback.status} />
          </div>
        </section>

        {/* RIGHT */}
        <section className="flex flex-col gap-4">
          <SavingsCounter
            currentQuote={playback.currentQuote}
            anchorPrice={negotiation?.anchor_price}
            finalPrice={negotiation?.final_price}
            competitorQuote={negotiation?.competitor_quote}
            fairBenchmark={negotiation?.fair_benchmark}
            breakthroughFired={playback.breakthroughFired}
            status={playback.status}
            success={negotiation?.success}
            redFlag={negotiation?.red_flag}
            redFlagReason={negotiation?.red_flag_reason}
          />
          <div className="panel p-4">
            <div className="scanline" />
            <PlayButton
              sources={audioSources}
              disabled={!negotiation}
              autoTrigger={audioTrigger}
              caption={caption}
            />
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-6 max-w-[1500px] text-center text-[10px] uppercase tracking-[0.3em] text-slate-700">
        Simulated agent-to-agent market · Alex never fabricates bids · English-only build
      </footer>
    </div>
  );
}
