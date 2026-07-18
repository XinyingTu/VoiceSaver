import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives the live playback of a negotiation transcript:
 *   - types each message out character-by-character (typewriter),
 *   - updates the standing quote the instant a mover finishes speaking,
 *   - raises `breakthroughFired` at the exact leverage-breakthrough line.
 */
export function useNegotiationPlayback(result) {
  const [messages, setMessages] = useState([]); // completed messages
  const [active, setActive] = useState(null); // currently-typing message
  const [currentQuote, setCurrentQuote] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | running | done
  const [breakthroughFired, setBreakthroughFired] = useState(false);
  const timers = useRef([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const reset = useCallback(() => {
    clearTimers();
    setMessages([]);
    setActive(null);
    setCurrentQuote(null);
    setStatus("idle");
    setBreakthroughFired(false);
  }, []);

  const start = useCallback(() => {
    if (!result) return;
    clearTimers();
    setMessages([]);
    setActive(null);
    setCurrentQuote(null);
    setBreakthroughFired(false);
    setStatus("running");

    const transcript = result.transcript;
    let i = 0;

    const typeMessage = () => {
      if (i >= transcript.length) {
        setActive(null);
        setStatus("done");
        return;
      }
      const msg = transcript[i];
      const speed = msg.role === "mover" ? 15 : 11; // ms per character
      let c = 0;

      const typeChar = () => {
        c += 1;
        setActive({ ...msg, typed: msg.text.slice(0, c) });
        if (c < msg.text.length) {
          timers.current.push(setTimeout(typeChar, speed));
          return;
        }
        // Message finished.
        setActive(null);
        setMessages((prev) => [...prev, msg]);
        if (msg.role === "mover") {
          setCurrentQuote(msg.price_on_table);
          if (msg.is_breakthrough) setBreakthroughFired(true);
        }
        i += 1;
        const pause = msg.role === "mover" ? 650 : 320;
        timers.current.push(setTimeout(typeMessage, pause));
      };
      typeChar();
    };

    typeMessage();
  }, [result]);

  useEffect(() => () => clearTimers(), []);

  return { messages, active, currentQuote, status, breakthroughFired, start, reset };
}
