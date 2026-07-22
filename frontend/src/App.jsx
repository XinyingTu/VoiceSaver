import React, { useCallback, useEffect, useState } from "react";
import {
  API_BASE,
  attestAdaShield,
  fetchCounterpartyModes,
  fetchHumanWidget,
  fetchIntakeDemo,
  fetchJobSpec,
  fetchProfiles,
  getPriceBenchmark,
  lockSpec,
  runSession,
  uploadVision,
} from "./api.js";
import { useSessionPlayback } from "./hooks/useSessionPlayback.js";
import IntakeColumn from "./components/IntakeColumn.jsx";
import CallMonitor from "./components/CallMonitor.jsx";
import HumanWidget from "./components/HumanWidget.jsx";
import TargetBid from "./components/TargetBid.jsx";
import ClosingLedger from "./components/ClosingLedger.jsx";
import { emptyOfferState, appendLedgerEntry, bestComparableOffer } from "./offerState.js";

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
  const [humanWidget, setHumanWidget] = useState(null);
  // Live savings feed for human-in-the-loop mode (no simulated report to read).
  // The authoritative OfferState is the source; `seq` bumps on a downward move
  // to trigger the flash animation.
  const [humanOffer, setHumanOffer] = useState({ offer: emptyOfferState(null), seq: 0 });
  const [humanStatus, setHumanStatus] = useState("idle");
  const [humanBenchmark, setHumanBenchmark] = useState(null);
  // Closing ledger for live human-in-the-loop calls: each finished call is
  // parsed from its transcript and appended here so the ledger renders a ranked,
  // evidence-cited card instantly (no backend report exists in this mode).
  const [humanLedger, setHumanLedger] = useState([]);
  const [launching, setLaunching] = useState(false);
  const [pendingStart, setPendingStart] = useState(false);
  const [error, setError] = useState(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  const playback = useSessionPlayback(session);
  const running = playback.status === "running";

  // Best comparison-ready offer across finished live calls AND the in-flight one
  // — eligibility-filtered (no lowballs, no unresolved-fee bases, no
  // declines/callbacks/estimates), never merely the smallest number.
  const bestEntry = humanWidget
    ? bestComparableOffer([...humanLedger, humanOffer.offer].filter(Boolean))
    : null;
  const bestComparable = bestEntry ? bestEntry.finalConfirmedTotal ?? bestEntry.currentKnownTotal : null;

  // One savings feed for the counter, whichever channel is live: the simulated
  // playback (report-driven, legacy props) or the human-in-the-loop conversation
  // (authoritative OfferState via the `offer` prop).
  const feed = humanWidget
    ? {
        offer: humanOffer.offer,
        priceDropSeq: humanOffer.seq,
        benchmark: humanBenchmark,
        bestComparable,
        status: humanStatus,
      }
    : {
        currentBid: playback.currentBid,
        priceDropSeq: playback.priceDropSeq,
        benchmark: report?.benchmark_total,
        bestItemized: report?.savings_summary?.recommended_total,
        status: playback.status,
        savings: report?.savings_summary,
      };

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

  // Authoritative live offer surfaced from the human-in-the-loop conversation.
  // The whole OfferState flows up; `seq` bumps on a genuine downward move so the
  // counter can flash. A `reset` clears the counter to AWAITING for a new call.
  const onHumanOffer = useCallback((p) => {
    if (p?.reset) {
      setHumanOffer({ offer: p.offer || emptyOfferState(null), seq: 0 });
      return;
    }
    setHumanOffer((prev) => ({ offer: p.offer, seq: p.isDrop ? prev.seq + 1 : prev.seq }));
  }, []);
  const onHumanStatus = useCallback((s) => setHumanStatus(s), []);

  // A live call ended: append its authoritative closing entry ONCE (idempotent
  // by callKey, so a repeated disconnect/finalize callback does not double-add).
  const onHumanClose = useCallback((entry) => {
    if (!entry) return;
    setHumanLedger((prev) => appendLedgerEntry(prev, { ...entry, id: prev.length + 1 }));
  }, []);

  const resetHumanFeed = () => {
    setHumanOffer({ offer: emptyOfferState(null), seq: 0 });
    setHumanStatus("idle");
    setHumanBenchmark(null);
    setHumanLedger([]);
  };

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
    setHumanWidget(null);
    resetHumanFeed();
    playback.reset();
  };

  const onLaunch = async () => {
    if (!locked || running || launching) return;
    setError(null);
    setLaunching(true);
    setSession(null);
    setReport(null);
    setHumanWidget(null);
    resetHumanFeed();
    playback.reset();
    try {
      // Human-in-the-loop is a live ElevenLabs widget, not the local sim — embed it
      // instead of running an agent-to-agent session.
      if (mode === "human_in_the_loop") {
        const info = await fetchHumanWidget();
        if (!info.agent_id) {
          throw new Error("Agent not configured on the backend (ELEVENLABS_AGENT_ID missing).");
        }
        setHumanWidget(info);
        // Populate BENCHMARK (2BR) from the same webhook the live agent calls,
        // so the Savings Counter isn't blank before the first spoken quote.
        getPriceBenchmark(spec)
          .then((b) => setHumanBenchmark(b.benchmark_total))
          .catch(() => {/* leave benchmark blank if unavailable */});
        return;
      }
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

        {humanWidget ? (
          <HumanWidget
            info={humanWidget}
            spec={spec}
            sessionId={sessionId}
            ada={ada}
            benchmark={humanBenchmark}
            onOffer={onHumanOffer}
            onStatus={onHumanStatus}
            onClose={onHumanClose}
          />
        ) : (
          <CallMonitor
            waveState={playback.waveState}
            revealed={playback.revealed}
            active={playback.active}
            status={playback.status}
          />
        )}

        <div className="flex flex-col gap-4">
          <TargetBid {...feed} />
          <ClosingLedger
            report={report}
            completedProfileIds={playback.completedProfileIds}
            status={playback.status}
            liveEntries={humanWidget ? humanLedger : []}
          />
        </div>
      </main>

      <footer className="mx-auto mt-6 max-w-[1600px] text-center text-[13px] text-muted">
        Honest leverage only · the proxy never fabricates competitor quotes or inventory · WCAG 2.1 AA · English-only build
      </footer>
    </div>
  );
}
