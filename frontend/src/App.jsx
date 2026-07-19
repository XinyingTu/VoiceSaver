import React, { useEffect, useState } from "react";
import {
  API_BASE,
  attestAdaShield,
  fetchCounterpartyModes,
  fetchIntakeDemo,
  fetchJobSpec,
  fetchProfiles,
  lockSpec,
  runSession,
  uploadVision,
} from "./api.js";
import { useSessionPlayback } from "./hooks/useSessionPlayback.js";
import IntakeColumn from "./components/IntakeColumn.jsx";
import CallMonitor from "./components/CallMonitor.jsx";
import TargetBid from "./components/TargetBid.jsx";
import ClosingLedger from "./components/ClosingLedger.jsx";

export default function App() {
  const [spec, setSpec] = useState({ inventory_items: [] });
  const [sessionId, setSessionId] = useState(null);
  const [locked, setLocked] = useState(false);
  const [ada, setAda] = useState(false);
  const [modes, setModes] = useState([]);
  const [mode, setMode] = useState("simulated");

  const [intakeInfo, setIntakeInfo] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  const [session, setSession] = useState(null);
  const [report, setReport] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  const [error, setError] = useState(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  const playback = useSessionPlayback(session);
  const running = playback.status === "running";

  useEffect(() => {
    Promise.all([fetchJobSpec(), fetchProfiles(), fetchCounterpartyModes()])
      .then(([job, prof, cp]) => {
        setSpec(job.job_spec);
        setSessionId(job.session_id);
        setAda(Boolean(job.ada_shield?.active));
        setLocked(Boolean(job.spec_locked));
        setModes(cp.modes);
        const firstAvailable = cp.modes.find((m) => m.available);
        if (firstAvailable) setMode(firstAvailable.id);
      })
      .catch((e) => setError(`Cannot reach backend at ${API_BASE}. Is uvicorn running? (${e.message})`));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
  }, [reduceMotion]);

  useEffect(() => {
    if (pendingStart && session) {
      playback.start();
      setPendingStart(false);
    }
  }, [pendingStart, session, playback]);

  const onField = (key, value) => setSpec((prev) => ({ ...prev, [key]: value }));

  // Only called after the user explicitly confirms in the ADA modal.
  const onAdaConfirm = async () => {
    try {
      await attestAdaShield(sessionId);
    } catch (e) {
      setError(`ADA attestation log failed: ${e.message}`);
    }
    setAda(true);
  };

  const applyIntake = (parsed) => {
    const js = parsed.job_spec || {};
    setSpec((prev) => ({
      ...prev,
      household_size: js.household_size || prev.household_size,
      origin_zip: js.origin_zip || prev.origin_zip,
      destination_zip: js.destination_zip || prev.destination_zip,
      distance_miles: js.distance_miles ?? prev.distance_miles,
      stair_flights: js.stair_flights ?? prev.stair_flights,
      inventory_items: js.inventory_items?.length ? js.inventory_items : prev.inventory_items,
    }));
    setIntakeInfo(parsed);
  };

  const onImportDemo = async () => {
    setImportError(null);
    setImporting(true);
    try {
      applyIntake(await fetchIntakeDemo());
    } catch (e) {
      setImportError(e.message);
    } finally {
      setImporting(false);
    }
  };

  const onImportVision = async (file) => {
    setImportError(null);
    setImporting(true);
    try {
      applyIntake(await uploadVision(file, false));
    } catch (e) {
      setImportError(`${e.message} — set OPENAI_API_KEY on the backend, or use "Use demo parse" for offline wiring.`);
    } finally {
      setImporting(false);
    }
  };

  const onLock = async () => {
    setError(null);
    try {
      await lockSpec(spec, ada);
      setLocked(true);
    } catch (e) {
      setError(`Lock failed: ${e.message}`);
    }
  };

  const onUnlock = async () => {
    try {
      await fetch(`${API_BASE}/api/job_spec/unlock`, { method: "POST" });
    } catch {
      /* ignore */
    }
    setLocked(false);
    setSession(null);
    setReport(null);
    playback.reset();
  };

  const onLaunch = async () => {
    if (!locked || running || launching) return;
    setError(null);
    setLaunching(true);
    setSession(null);
    setReport(null);
    playback.reset();
    try {
      const { session: s, report: r } = await runSession({
        counterparty_mode: mode,
        ada_by_profile: ada ? { mover_002_tough: true } : {},
      });
      setSession(s);
      setReport(r);
      setPendingStart(true);
    } catch (e) {
      setError(`Launch failed: ${e.message}`);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="min-h-screen w-full px-4 py-5 sm:px-6">
      <header className="mx-auto mb-5 flex max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-body sm:text-3xl">VoiceSaver</h1>
          <p className="text-[14px] text-muted">Universal Automated Negotiation Cockpit</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            aria-pressed={reduceMotion}
            onClick={() => setReduceMotion((v) => !v)}
          >
            Motion: {reduceMotion ? "Reduced" : "On"}
          </button>
          <span className={`badge ${error ? "badge-danger" : "badge-success"}`} role="status">
            <span className={`h-2 w-2 rounded-full ${error ? "bg-danger" : "bg-success"}`} aria-hidden />
            {error ? "Backend offline" : "API online"}
          </span>
        </div>
      </header>

      {error && (
        <div className="mx-auto mb-4 max-w-[1600px] rounded-lg border border-danger/60 bg-danger/10 px-4 py-2 text-[14px] text-body" role="alert">
          {error}
        </div>
      )}

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)_400px]">
        <IntakeColumn
          spec={spec}
          onField={onField}
          locked={locked}
          onLock={onLock}
          onUnlock={onUnlock}
          ada={ada}
          onAdaToggle={setAda}
          onAdaConfirm={onAdaConfirm}
          intakeInfo={intakeInfo}
          importing={importing}
          importError={importError}
          onImportDemo={onImportDemo}
          onImportVision={onImportVision}
          modes={modes}
          mode={mode}
          onModeChange={setMode}
          onLaunch={onLaunch}
          launching={launching}
          running={running}
        />

        <CallMonitor
          waveState={playback.waveState}
          revealed={playback.revealed}
          active={playback.active}
          status={playback.status}
        />

        <div className="flex flex-col gap-4">
          <TargetBid
            currentBid={playback.currentBid}
            priceDropSeq={playback.priceDropSeq}
            benchmark={report?.benchmark_total}
            report={report}
            status={playback.status}
          />
          <ClosingLedger
            report={report}
            completedProfileIds={playback.completedProfileIds}
            status={playback.status}
          />
        </div>
      </main>

      <footer className="mx-auto mt-6 max-w-[1600px] text-center text-[13px] text-muted">
        Honest leverage only · the proxy never fabricates competitor quotes or inventory · WCAG 2.1 AA · English-only build
      </footer>
    </div>
  );
}
