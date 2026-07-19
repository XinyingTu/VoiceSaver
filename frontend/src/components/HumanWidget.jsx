import React, { useEffect, useRef } from "react";

// ElevenLabs' embeddable conversation web component. Loading this script defines
// the <elevenlabs-convai> custom element; we render the element itself via
// dangerouslySetInnerHTML because innerHTML-injected <script> tags don't execute.
const SCRIPT_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";

// The permissions the live voice widget needs. Microphone is the critical one —
// without it the browser blocks getUserMedia inside the widget's iframe and the
// agent can't hear the dispatcher. autoplay lets the agent's replies play back
// without a second gesture.
const WIDGET_ALLOW = "microphone; autoplay";

// Grant an <iframe> the microphone permission if it doesn't already have it.
// Idempotent: only rewrites the attribute when "microphone" is missing.
function grantMicPermission(iframe) {
  const current = iframe.getAttribute("allow") || "";
  if (current.includes("microphone")) return;
  const merged = [current, WIDGET_ALLOW].filter(Boolean).join("; ");
  iframe.setAttribute("allow", merged);
}

// The convai widget mounts its iframe asynchronously (after the embed script
// loads) and may place it inside an open shadow root, so a one-shot query isn't
// enough. Scan the light DOM plus any reachable open shadow roots under `root`.
function patchIframes(root) {
  if (!root) return;
  root.querySelectorAll("iframe").forEach(grantMicPermission);
  root.querySelectorAll("*").forEach((el) => {
    if (el.shadowRoot) el.shadowRoot.querySelectorAll("iframe").forEach(grantMicPermission);
  });
}

export default function HumanWidget({ info }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      document.body.appendChild(s);
    }
  }, []);

  const agentId = info?.agent_id;

  // Make sure the mic permission lands on the widget's iframe however/whenever it
  // appears. A MutationObserver catches light-DOM insertions; a bounded poll
  // covers iframes rendered inside the widget's (open) shadow root, which the
  // observer on our container can't see into.
  useEffect(() => {
    if (!agentId) return;
    const root = containerRef.current;
    if (!root) return;

    patchIframes(root);

    const observer = new MutationObserver(() => patchIframes(root));
    observer.observe(root, { childList: true, subtree: true });

    let attempts = 0;
    const poll = setInterval(() => {
      patchIframes(root);
      if (++attempts >= 20) clearInterval(poll); // ~10s of coverage while it mounts
    }, 500);

    return () => {
      observer.disconnect();
      clearInterval(poll);
    };
  }, [agentId]);

  return (
    <section className="card flex min-h-[420px] flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-black text-body">Human-in-the-loop · live voice</h2>
        <p className="mt-1 text-[14px] text-muted">
          The VoiceSaver agent is calling. Answer in the widget and role-play the moving-company
          dispatcher live — the agent invokes the real tool webhooks as you talk.
        </p>
      </div>

      <div className="rounded-lg border border-edge bg-info/5 p-3 text-[13px] text-body">
        <div className="font-semibold">Role-play brief</div>
        <p className="mt-1 text-muted">{info?.instructions}</p>
        <p className="mt-2">
          Persona: <b className="text-body">{info?.persona_ref}</b>
        </p>
      </div>

      {agentId ? (
        <div
          ref={containerRef}
          className="flex flex-1 items-center justify-center rounded-lg border border-edge bg-panel/40 p-4"
          // agentId originates from our backend .env, not user input — safe to inject.
          // allow="microphone; autoplay" is set on the element and re-applied to the
          // widget's iframe on mount (see the effect above) so voice capture works.
          dangerouslySetInnerHTML={{
            __html: `<elevenlabs-convai agent-id="${agentId}" allow="${WIDGET_ALLOW}"></elevenlabs-convai>`,
          }}
        />
      ) : (
        <div className="rounded-lg border border-danger/60 bg-danger/10 p-3 text-[13px] text-body">
          Agent not configured. Set <code>ELEVENLABS_AGENT_ID</code> in the backend .env and restart it.
        </div>
      )}

      <p className="text-center text-[12px] text-muted">
        Grant microphone access when the browser prompts. Powered by the ElevenLabs Agents Platform.
      </p>
    </section>
  );
}
