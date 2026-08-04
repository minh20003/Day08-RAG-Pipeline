import { useEffect, useRef, useState } from "react";

interface CountUpValueProps {
  value: number;
  decimals?: number;
  suffix?: string;
}

const easeOutExpo = (progress: number) =>
  progress >= 1 ? 1 : 1 - Math.pow(2, -10 * progress);

export function CountUpValue({ value, decimals = 0, suffix = "" }: CountUpValueProps) {
  const [displayedValue, setDisplayedValue] = useState(0);
  const previousValue = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      previousValue.current = value;
      setDisplayedValue(value);
      return undefined;
    }

    const from = previousValue.current;
    const startedAt = performance.now();
    const duration = 760;
    let frameId = 0;

    const render = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const next = from + (value - from) * easeOutExpo(progress);
      setDisplayedValue(next);
      if (progress < 1) {
        frameId = window.requestAnimationFrame(render);
      } else {
        previousValue.current = value;
      }
    };

    frameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return <>{displayedValue.toFixed(decimals)}{suffix}</>;
}
