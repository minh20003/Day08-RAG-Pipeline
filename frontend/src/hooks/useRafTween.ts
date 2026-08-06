import { useEffect, useRef } from "react";

/**
 * Drives a 0→100 numeric value via requestAnimationFrame between `start` and `end`.
 * Extracted from react-bits/BorderGlow.tsx so multiple liquid components can share it.
 */
export function useRafTween(opts: {
  start: number;
  end: number;
  duration: number;
  ease?: (t: number) => number;
  delay?: number;
  onUpdate: (value: number) => void;
  onEnd?: () => void;
  deps?: ReadonlyArray<unknown>;
}) {
  const { start, end, duration, ease = easeOutCubic, delay = 0, onUpdate, onEnd, deps = [] } = opts;
  const handle = useRef<number | null>(null);
  const timeoutHandle = useRef<number | null>(null);

  useEffect(() => {
    const t0 = performance.now() + delay;
    const tick = () => {
      const elapsed = performance.now() - t0;
      const t = Math.min(elapsed / duration, 1);
      onUpdate(start + (end - start) * ease(t));
      if (t < 1) {
        handle.current = window.requestAnimationFrame(tick);
      } else {
        onEnd?.();
      }
    };
    timeoutHandle.current = window.setTimeout(() => {
      handle.current = window.requestAnimationFrame(tick);
    }, delay);

    return () => {
      if (handle.current !== null) window.cancelAnimationFrame(handle.current);
      if (timeoutHandle.current !== null) window.clearTimeout(timeoutHandle.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeInCubic(x: number) {
  return x * x * x;
}
