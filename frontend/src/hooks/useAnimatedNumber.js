import { useEffect, useRef, useState } from "react";

// Smoothly tween a displayed number toward `target` (used by the savings ticker).
export function useAnimatedNumber(target, duration = 900) {
  const [display, setDisplay] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);
  const rafRef = useRef(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (target == null) return;
    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) {
      setDisplay(target);
      return;
    }
    startRef.current = performance.now();

    const tick = (now) => {
      const elapsed = now - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      // easeOutExpo for a snappy, decelerating counter.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplay(from + delta * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}
