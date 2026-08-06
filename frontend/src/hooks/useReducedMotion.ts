import { useEffect, useState } from "react";

/**
 * Returns true when the user has requested reduced motion. Reactive.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}

/**
 * Returns true when the device is fine-pointer (mouse/trackpad). Reactive.
 * Used to gate hover-driven effects (magnet, glare, RGB shift, parallax).
 */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(hover: hover) and (pointer: fine)");
    const handler = (event: MediaQueryListEvent) => setFine(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return fine;
}
