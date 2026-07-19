import React, { useEffect } from "react";

// ElevenLabs' embeddable conversation web component. Loading this script defines
// the <elevenlabs-convai> custom element; we render the element itself via
// dangerouslySetInnerHTML because innerHTML-injected <script> tags don't execute.
const SCRIPT_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";

export default function HumanWidget({ info }) {
  useEffect(() => {
    if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      document.body.appendChild(s);
    }
  }, []);

  const agentId = info?.agent_id;

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
          className="flex flex-1 items-center justify-center rounded-lg border border-edge bg-panel/40 p-4"
          // agentId originates from our backend .env, not user input — safe to inject.
          dangerouslySetInnerHTML={{
            __html: `<elevenlabs-convai agent-id="${agentId}"></elevenlabs-convai>`,
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
