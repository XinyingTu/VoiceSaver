import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Streams a whole session (3 calls) live: types each transcript message,
 * tracks the CURRENT TARGET BID (tumbling on concessions), and reports which
 * calls have completed so the Closing Ledger can fill in progressively.
 *
 * waveState reflects the live channel: listening | processing | disconnected | idle.
 */
export function useSessionPlayback(session) {
  const [revealed, setRevealed] = useState([]); // {type:'separator'|'message', ...}
  const [active, setActive] = useState(null); // currently typing message
  const [currentBid, setCurrentBid] = useState(null);
  const [priceDropSeq, setPriceDropSeq] = useState(0); // increments on each concession
  const [completedProfileIds, setCompletedProfileIds] = useState([]);
  const [waveState, setWaveState] = useState("idle");
  const [status, setStatus] = useState("idle"); // idle | running | done
  const timers = useRef([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const reset = useCallback(() => {
    clear();
    setRevealed([]);
    setActive(null);
    setCurrentBid(null);
    setPriceDropSeq(0);
    setCompletedProfileIds([]);
    setWaveState("idle");
    setStatus("idle");
  }, []);

  const start = useCallback(() => {
    if (!session?.calls?.length) return;
    clear();
    setRevealed([]);
    setActive(null);
    setCurrentBid(null);
    setPriceDropSeq(0);
    setCompletedProfileIds([]);
    setStatus("running");
    setWaveState("listening");

    // Flatten calls into an ordered step list.
    const steps = [];
    session.calls.forEach((call, ci) => {
      steps.push({
        type: "separator",
        callIndex: ci,
        profileId: call.profile.id,
        callName: call.profile.name,
        outcome: call.outcome,
      });
      call.transcript.forEach((msg, mi) => {
        steps.push({
          type: "message",
          callIndex: ci,
          profileId: call.profile.id,
          callName: call.profile.name,
          outcome: call.outcome,
          isLast: mi === call.transcript.length - 1,
          msg,
        });
      });
    });

    let i = 0;

    const run = () => {
      if (i >= steps.length) {
        setActive(null);
        setStatus("done");
        setWaveState("idle");
        return;
      }
      const step = steps[i];

      if (step.type === "separator") {
        setRevealed((prev) => [...prev, step]);
        setCurrentBid(null); // new call — reset the target bid
        setWaveState("listening");
        i += 1;
        timers.current.push(setTimeout(run, 350));
        return;
      }

      const { msg } = step;
      const hasTool = (msg.events || []).some((e) => e.type === "tool_call");
      if (hasTool) setWaveState("processing");
      else setWaveState("listening");

      const speed = msg.speaker === "dispatcher" ? 14 : 11;
      let c = 0;
      const typeChar = () => {
        c += 1;
        setActive({ ...step, typed: msg.text.slice(0, c) });
        if (c < msg.text.length) {
          timers.current.push(setTimeout(typeChar, speed));
          return;
        }
        // Message complete.
        setActive(null);
        setRevealed((prev) => [...prev, step]);
        if (msg.price_on_table != null) setCurrentBid(msg.price_on_table);
        if (msg.is_price_drop) setPriceDropSeq((s) => s + 1);

        if (step.isLast) {
          setCompletedProfileIds((prev) =>
            prev.includes(step.profileId) ? prev : [...prev, step.profileId]
          );
          if (step.outcome === "DOCUMENTED_DECLINE") setWaveState("disconnected");
        }
        i += 1;
        const pause = step.isLast ? 700 : msg.speaker === "dispatcher" ? 480 : 300;
        timers.current.push(setTimeout(run, pause));
      };
      typeChar();
    };

    run();
  }, [session]);

  useEffect(() => () => clear(), []);

  return {
    revealed,
    active,
    currentBid,
    priceDropSeq,
    completedProfileIds,
    waveState,
    status,
    start,
    reset,
  };
}
