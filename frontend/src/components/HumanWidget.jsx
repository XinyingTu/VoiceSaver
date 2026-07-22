import React, { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import Waveform from "./Waveform.jsx";
import { latestPrice, parseClosingEntry } from "../api.js";
import { buildSessionDynamicVariables } from "../sessionVars.js";

// Human-in-the-loop live voice via the ElevenLabs React SDK (not the embed
// widget). useConversation lets us: render our own real-time transcript from
// onMessage, pass the ADA Shield state as a dynamic variable so the UI toggle
// controls disclosure at call time, and capture the mic directly (no
// cross-origin iframe / allow-attribute juggling).
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

function LiveCall({ info, spec, sessionId, ada, onPrice, onStatus, onClose }) {
  const agentId = info?.agent_id;
  const [transcript, setTranscript] = useState([]);
  const [callError, setCallError] = useState(null);
  const seqRef = useRef(0);
  const scrollRef = useRef(null);
  // Last price surfaced live, so we can flag a downward concession vs. an upcharge.
  const lastPriceRef = useRef(null);
  // Latest transcript for the end-of-call parser (avoids stale-closure reads in
  // the lifecycle effect), plus a guard so we close the ledger entry only once.
  const transcriptRef = useRef([]);
  const finalizedRef = useRef(false);

  const conversation = useConversation({
    onMessage: (msg) => {
      const text = msg?.message ?? msg?.text ?? "";
      if (!text.trim()) return; // skip empty/debug frames
      const line = toLine(msg, (seqRef.current += 1));
      transcriptRef.current = [...transcriptRef.current, line];
      setTranscript((prev) => [...prev, line]);
      // Force-feed the live number on the table to the Savings Counter. The tool
      // webhooks fire server-side and may miss/mangle total_price, so we don't
      // depend on them: rescan the WHOLE spoken transcript for the latest credible
      // total and push it up. Once any price is spoken the counter shows it and
      // never blanks; a line with no number leaves the last price in place.
      const price = latestPrice(transcriptRef.current);
      if (price != null && price !== lastPriceRef.current && onPrice) {
        const prev = lastPriceRef.current;
        const isDrop = prev != null && price < prev;
        lastPriceRef.current = price;
        onPrice({ price, isDrop });
      }
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

  const start = useCallback(async () => {
    setCallError(null);
    setTranscript([]);
    seqRef.current = 0;
    lastPriceRef.current = null;
    transcriptRef.current = [];
    finalizedRef.current = false;
    onPrice?.({ reset: true });
    try {
      // Prompt for the mic explicitly so a denial surfaces a clear message
      // instead of a generic SDK failure. Release this probe stream right away —
      // the SDK opens its own; leaving this one live would hold the mic open.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop());
      // dynamicVariables drive the runtime placeholders in the agent prompt so
      // the UI controls the call at start time: {{job_spec_json}} carries the
      // CURRENT locked spec (P0 fix — the agent must describe the edited job,
      // not the seeded fixture) and {{ada_shield_active}} the disclosure toggle.
      // Built here from the live spec prop so every session reflects the newest
      // lock. Strings/JSON-string match what ElevenLabs runtime variables accept.
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
  }, [startSession, agentId, ada, spec, sessionId]);

  // End the session if the widget unmounts mid-call.
  useEffect(() => () => { try { endSession(); } catch { /* not connected */ } }, [endSession]);

  const statusLabel = connected
    ? (isSpeaking ? "● proxy speaking" : "● listening")
    : connecting ? "◌ connecting" : "○ standby";

  // Drive the persistent waveform + the shared savings-counter status.
  // isSpeaking = our proxy is talking (working the deal) → processing.
  const waveState = callError
    ? "disconnected"
    : connected
    ? (isSpeaking ? "processing" : "listening")
    : connecting
    ? "processing"
    : "idle";

  // Report call lifecycle up so the Savings Counter mirrors simulated mode:
  // running while connected, done once a completed call disconnects. When a
  // real call ends, parse its transcript once and post a closing-ledger entry.
  const hadCall = useRef(false);
  useEffect(() => {
    if (connected) hadCall.current = true;
    const ended = hadCall.current && !connected && !connecting;
    const s = connected || connecting ? "running" : ended ? "done" : "idle";
    onStatus?.(s);
    if (ended && !finalizedRef.current) {
      finalizedRef.current = true;
      if (transcriptRef.current.length) {
        onClose?.(parseClosingEntry(transcriptRef.current, { fallbackName: info?.persona_ref }));
      }
    }
  }, [connected, connecting, onStatus, onClose, info]);

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

export default function HumanWidget({ info, spec, sessionId, ada = false, onPrice, onStatus, onClose }) {
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
            onPrice={onPrice}
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
