import React, { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import Waveform from "./Waveform.jsx";
import { parseClosingEntry, fetchOfferState } from "../api.js";
import { emptyOfferState, deriveLiveOffer, offerStateFromEvents } from "../offerState.js";
import { buildSessionDynamicVariables } from "../sessionVars.js";

// Human-in-the-loop live voice via the ElevenLabs React SDK (not the embed
// widget). useConversation lets us: render our own real-time transcript from
// onMessage, pass the ADA Shield state as a dynamic variable so the UI toggle
// controls disclosure at call time, and capture the mic directly (no
// cross-origin iframe / allow-attribute juggling).
//
// PRICE STATE: the transcript is EVIDENCE, not the price. The live counter is
// driven by the authoritative OfferState (offerState.js), fed by ONE of two
// producers, in this order of authority:
//   1. AUTHORITATIVE server path. record_offer_event is a SERVER/webhook tool
//      (configure_elevenlabs_agent.py registers every tool as type "webhook"),
//      so on a real call ElevenLabs' servers POST the event straight to FastAPI
//      — there is NO browser tool callback. The backend validates + stores it
//      per session; this widget READS that stored state by polling
//      /api/tools/offer_events/{session_id} and folds it into OfferState. It
//      requires the hosted agent to be configured with the tool; until then the
//      poll returns no events and (2) drives the UI.
//   2. FALLBACK. A conservative, dispatcher-lines-only transcript classifier
//      (provisional) — it never reads the proxy's own lines, and distinguishes a
//      vendor total from a deposit / unit rate / optional fee / competitor quote.
//
// We do NOT register record_offer_event as a client tool and do NOT rely on
// onAgentToolRequest: that would be a second, competing path against a tool that
// actually executes server-side.
//
// useConversation must live inside a <ConversationProvider>, so the interactive
// call UI is split into <LiveCall> mounted under the provider below.

// Map an SDK message onto a transcript line. The agent under test is our
// VoiceSaver proxy (source "ai"); the human answering the widget role-plays the
// dispatcher (source "user").
function toLine(msg, id) {
  const source = msg?.source ?? msg?.role;
  const text = msg?.message ?? msg?.text ?? "";
  return { id, isProxy: source === "ai" || source === "agent", text };
}

function LiveCall({ info, spec, sessionId, ada, benchmark, onOffer, onStatus, onClose }) {
  const agentId = info?.agent_id;
  const [transcript, setTranscript] = useState([]);
  const [callError, setCallError] = useState(null);
  const seqRef = useRef(0);
  const scrollRef = useRef(null);
  // Latest transcript for parsing (avoids stale-closure reads), structured
  // events (authoritative when present), the last known total (for the drop
  // flash), the latest computed offer (for the closing entry), a monotonic call
  // counter (for an idempotent closing-ledger key), and a finalize guard.
  const transcriptRef = useRef([]);
  // Backend-stored structured offer events (authoritative), as last fetched from
  // /api/tools/offer_events/{session_id}. Empty until the hosted agent's webhook
  // tool has recorded any — then it supersedes the transcript fallback.
  const structuredEventsRef = useRef([]);
  const lastTotalRef = useRef(null);
  const offerRef = useRef(emptyOfferState(benchmark));
  const callSeqRef = useRef(0);
  const finalizedRef = useRef(false);

  // Recompute the authoritative offer from whichever producer is active and
  // push it up. Backend structured events supersede the transcript fallback.
  const recomputeOffer = useCallback(() => {
    const offer = structuredEventsRef.current.length
      ? offerStateFromEvents(structuredEventsRef.current, { benchmark })
      : deriveLiveOffer(transcriptRef.current, { benchmark });
    offerRef.current = offer;
    const cur = offer.finalConfirmedTotal ?? offer.currentKnownTotal;
    const prev = lastTotalRef.current;
    const isDrop = prev != null && cur != null && cur < prev;
    if (cur != null) lastTotalRef.current = cur;
    onOffer?.({ offer, isDrop });
  }, [benchmark, onOffer]);

  const conversation = useConversation({
    onMessage: (msg) => {
      const text = msg?.message ?? msg?.text ?? "";
      if (!text.trim()) return; // skip empty/debug frames
      const line = toLine(msg, (seqRef.current += 1));
      transcriptRef.current = [...transcriptRef.current, line];
      setTranscript((prev) => [...prev, line]);
      recomputeOffer();
    },
    onError: (err) => setCallError(typeof err === "string" ? err : err?.message || "Conversation error."),
  });

  const { status, isSpeaking, startSession, endSession } = conversation;
  const connected = status === "connected";
  const connecting = status === "connecting";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  // If the benchmark arrives after the call starts, recompute so lowball risk
  // uses the job benchmark rather than staying unassessed.
  useEffect(() => {
    if (transcriptRef.current.length || structuredEventsRef.current.length) recomputeOffer();
  }, [benchmark, recomputeOffer]);

  // AUTHORITATIVE read path: poll the backend session for structured offer events
  // the hosted agent's server webhook tool recorded. The backend list is already
  // validated + de-duplicated, so we replace our copy wholesale each poll. When
  // it is empty (agent not yet configured with the tool), the transcript fallback
  // keeps driving the counter.
  const pollOfferState = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetchOfferState(sessionId);
      const events = res?.offer_events || [];
      if (events.length) {
        structuredEventsRef.current = events;
        recomputeOffer();
      }
    } catch {
      /* transient network error — keep the last-known state */
    }
  }, [sessionId, recomputeOffer]);

  useEffect(() => {
    if (!connected || !sessionId) return undefined;
    pollOfferState(); // fetch immediately on connect
    const id = setInterval(pollOfferState, 2500);
    return () => clearInterval(id);
  }, [connected, sessionId, pollOfferState]);

  const start = useCallback(async () => {
    setCallError(null);
    setTranscript([]);
    seqRef.current = 0;
    transcriptRef.current = [];
    structuredEventsRef.current = [];
    lastTotalRef.current = null;
    offerRef.current = emptyOfferState(benchmark);
    callSeqRef.current += 1;
    finalizedRef.current = false;
    // Reset the counter to a clean AWAITING state for the new call — no stale
    // price from a previous call bleeds in.
    onOffer?.({ reset: true, offer: emptyOfferState(benchmark) });
    try {
      // Prompt for the mic explicitly so a denial surfaces a clear message
      // instead of a generic SDK failure. Release this probe stream right away —
      // the SDK opens its own; leaving this one live would hold the mic open.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      // dynamicVariables drive the runtime placeholders in the agent prompt so
      // the UI controls the call at start time: {{job_spec_json}} carries the
      // CURRENT locked spec and {{ada_shield_active}} the disclosure toggle.
      startSession({
        agentId,
        connectionType: "webrtc",
        dynamicVariables: buildSessionDynamicVariables(spec, sessionId, ada),
      });
    } catch (e) {
      setCallError(
        e?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the browser and try again."
          : e?.message || "Could not start the conversation."
      );
    }
  }, [startSession, agentId, ada, spec, sessionId, benchmark, onOffer]);

  // End the session if the widget unmounts mid-call.
  useEffect(() => () => { try { endSession(); } catch { /* not connected */ } }, [endSession]);

  const statusLabel = connected
    ? (isSpeaking ? "● proxy speaking" : "● listening")
    : connecting ? "◌ connecting" : "○ standby";

  // Drive the persistent waveform + the shared savings-counter status.
  const waveState = callError
    ? "disconnected"
    : connected
    ? (isSpeaking ? "processing" : "listening")
    : connecting
    ? "processing"
    : "idle";

  // Report call lifecycle up so the Savings Counter mirrors simulated mode:
  // running while connected, done once a completed call disconnects. When a real
  // call ends, build ONE closing-ledger entry from the authoritative offer state
  // (plus the dispatcher name + evidence line) and post it exactly once. The
  // stable callKey lets App dedupe if the disconnect path fires repeatedly.
  const hadCall = useRef(false);
  useEffect(() => {
    if (connected) hadCall.current = true;
    const ended = hadCall.current && !connected && !connecting;
    const s = connected || connecting ? "running" : ended ? "done" : "idle";
    onStatus?.(s);
    if (ended && !finalizedRef.current) {
      finalizedRef.current = true;
      // One last authoritative fetch so the closing entry reflects any events
      // recorded right before disconnect, then post exactly once.
      (async () => {
        await pollOfferState();
        if (!transcriptRef.current.length && !structuredEventsRef.current.length) return;
        const parsed = parseClosingEntry(transcriptRef.current, { fallbackName: info?.persona_ref });
        const offer = offerRef.current;
        const evidence =
          offer.evidence.currentKnownTotal || offer.evidence.initialTotal || parsed.evidence || "";
        onClose?.({
          callKey: `${sessionId || "session"}:${callSeqRef.current}`,
          name: parsed.name,
          evidence,
          fraudPhrase: parsed.outcome === "LOWBALL_FRAUD",
          ...offer,
        });
      })();
    }
  }, [connected, connecting, onStatus, onClose, info, sessionId, pollOfferState]);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="label">Session</span>
        <span className="badge badge-neutral shrink-0" role="status">{statusLabel}</span>
      </div>

      {/* Persistent Audio Waveform — stays visible above the live transcript in
          the active human-in-the-loop call, mirroring the standby monitor. */}
      <div className="rounded-lg border border-edge bg-surface p-3">
        <Waveform state={waveState} />
      </div>

      <div className="rounded-lg border border-edge bg-info/5 p-3 text-[13px] text-body">
        <div className="font-semibold">Role-play brief</div>
        <p className="mt-1 text-muted">{info?.instructions}</p>
        <p className="mt-2">
          Persona: <b className="text-body">{info?.persona_ref}</b>
          <span className="ml-2 text-muted">· ADA Shield: <b className="text-body">{ada ? "ON" : "OFF"}</b></span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        {!connected ? (
          <button type="button" className="btn-primary" onClick={start} disabled={connecting}>
            {connecting ? "Connecting…" : "Start live call"}
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => endSession()}>End call</button>
        )}
      </div>

      {callError && (
        <div className="rounded-lg border border-danger/60 bg-danger/10 p-2 text-[13px] text-body" role="alert">
          {callError}
        </div>
      )}

      <div className="mb-1 flex items-center justify-between">
        <span className="label">Live Transcript</span>
        <span className="text-[12px] text-muted">{connected ? "● live" : "○ standby"}</span>
      </div>

      {/* aria-live so assistive tech announces incremental transcript text */}
      <div
        ref={scrollRef}
        aria-live="polite"
        aria-label="Live voice transcript"
        className="scroll-thin flex max-h-[260px] min-h-[160px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-edge bg-surface p-3 font-mono"
      >
        {transcript.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-muted">
            <p className="text-[14px]">
              {connected ? "Listening… start talking to see the transcript." : "Start the call to begin."}
            </p>
          </div>
        ) : (
          transcript.map((line) => (
            <div key={line.id} className="rounded-lg border border-edge bg-panel2 px-3 py-2">
              <span className={`text-[12px] font-bold ${line.isProxy ? "text-info" : "text-access"}`}>
                {line.isProxy ? "VoiceSaver Proxy" : "You (Dispatcher)"}
                <span className="text-muted"> · {line.isProxy ? "PROXY" : "DISPATCHER"}</span>
              </span>
              <p className="text-base text-body">{line.text}</p>
            </div>
          ))
        )}
      </div>
    </>
  );
}

export default function HumanWidget({ info, spec, sessionId, ada = false, benchmark = null, onOffer, onStatus, onClose }) {
  const agentId = info?.agent_id;

  return (
    <section className="card flex min-h-[420px] flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-black text-body">Human-in-the-loop · live voice</h2>
        <p className="mt-1 text-[14px] text-muted">
          The VoiceSaver agent calls you. Answer live and role-play the moving-company
          dispatcher — the agent invokes the real tool webhooks as you talk.
        </p>
      </div>

      {!agentId ? (
        <div className="rounded-lg border border-danger/60 bg-danger/10 p-3 text-[13px] text-body">
          Agent not configured. Set <code>ELEVENLABS_AGENT_ID</code> in the backend .env and restart it.
        </div>
      ) : (
        <ConversationProvider>
          <LiveCall
            info={info}
            spec={spec}
            sessionId={sessionId}
            ada={ada}
            benchmark={benchmark}
            onOffer={onOffer}
            onStatus={onStatus}
            onClose={onClose}
          />
        </ConversationProvider>
      )}

      <p className="text-center text-[12px] text-muted">
        Grant microphone access when prompted. Powered by the ElevenLabs Agents Platform.
      </p>
    </section>
  );
}
