import { useEffect, useRef, type ReactNode } from "react";

interface MotionProviderProps {
  children: ReactNode;
  paused?: boolean;
}

interface PointerSnapshot {
  target: HTMLElement | null;
  x: number;
  y: number;
}

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function findMotionTarget(target: EventTarget | null, selector: string) {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

export function MotionProvider({ children, paused = false }: MotionProviderProps) {
  const frameId = useRef<number | null>(null);
  const activeSurface = useRef<HTMLElement | null>(null);
  const activeMagnet = useRef<HTMLElement | null>(null);
  const pointer = useRef<PointerSnapshot>({ target: null, x: 0, y: 0 });
  const lens = useRef({ x: 0, y: 0, initialized: false });

  useEffect(() => {
    const root = document.documentElement;
    const finePointer = window.matchMedia(FINE_POINTER_QUERY);
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);

    const clearSurface = () => {
      activeSurface.current?.classList.remove("is-liquid-active");
      activeSurface.current = null;
    };

    const clearMagnet = () => {
      if (!activeMagnet.current) return;
      activeMagnet.current.style.removeProperty("--magnetic-x");
      activeMagnet.current.style.removeProperty("--magnetic-y");
      activeMagnet.current.classList.remove("is-magnetic-active");
      activeMagnet.current = null;
    };

    const cancelFrame = () => {
      if (frameId.current !== null) {
        window.cancelAnimationFrame(frameId.current);
        frameId.current = null;
      }
    };

    const deactivate = () => {
      cancelFrame();
      clearSurface();
      clearMagnet();
      root.classList.remove("liquid-pointer-enabled");
      root.style.removeProperty("--pointer-x");
      root.style.removeProperty("--pointer-y");
      root.style.removeProperty("--pointer-nx");
      root.style.removeProperty("--pointer-ny");
    };

    if (paused || !finePointer.matches || reducedMotion.matches) {
      deactivate();
      return undefined;
    }

    const isInteractive = () => finePointer.matches && !reducedMotion.matches;

    const renderFrame = () => {
      frameId.current = null;
      if (document.hidden) return;

      const snapshot = pointer.current;
      const target = snapshot.target;
      const nextLensX = lens.current.initialized
        ? lens.current.x + (snapshot.x - lens.current.x) * 0.17
        : snapshot.x;
      const nextLensY = lens.current.initialized
        ? lens.current.y + (snapshot.y - lens.current.y) * 0.17
        : snapshot.y;

      lens.current = { x: nextLensX, y: nextLensY, initialized: true };
      root.style.setProperty("--pointer-x", `${nextLensX}px`);
      root.style.setProperty("--pointer-y", `${nextLensY}px`);
      root.style.setProperty("--pointer-nx", `${((nextLensX / window.innerWidth) - 0.5) * 2}`);
      root.style.setProperty("--pointer-ny", `${((nextLensY / window.innerHeight) - 0.5) * 2}`);
      root.classList.add("liquid-pointer-enabled");

      if (target !== activeSurface.current) {
        clearSurface();
        activeSurface.current = target;
        target?.classList.add("is-liquid-active");
      }

      if (target) {
        const bounds = target.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (snapshot.x - bounds.left) / bounds.width));
        const y = Math.max(0, Math.min(1, (snapshot.y - bounds.top) / bounds.height));
        target.style.setProperty("--liquid-x", `${x * 100}%`);
        target.style.setProperty("--liquid-y", `${y * 100}%`);
        target.style.setProperty("--liquid-tilt-x", `${(0.5 - y) * 3.2}deg`);
        target.style.setProperty("--liquid-tilt-y", `${(x - 0.5) * 3.2}deg`);
        target.style.setProperty("--liquid-shadow-x", `${(0.5 - x) * 24}px`);
        target.style.setProperty("--liquid-shadow-y", `${(0.5 - y) * 20}px`);
      }

      const magnet = findMotionTarget(
        document.elementFromPoint(snapshot.x, snapshot.y),
        "[data-magnetic]",
      );
      if (magnet !== activeMagnet.current) {
        clearMagnet();
        activeMagnet.current = magnet;
        magnet?.classList.add("is-magnetic-active");
      }
      if (magnet) {
        const bounds = magnet.getBoundingClientRect();
        const strength = Number(magnet.dataset.magneticStrength ?? "8");
        magnet.style.setProperty(
          "--magnetic-x",
          `${((snapshot.x - (bounds.left + bounds.width / 2)) / bounds.width) * strength}px`,
        );
        magnet.style.setProperty(
          "--magnetic-y",
          `${((snapshot.y - (bounds.top + bounds.height / 2)) / bounds.height) * strength}px`,
        );
      }

      if (Math.abs(snapshot.x - nextLensX) > 0.2 || Math.abs(snapshot.y - nextLensY) > 0.2) {
        frameId.current = window.requestAnimationFrame(renderFrame);
      }
    };

    const requestFrame = () => {
      if (frameId.current === null) frameId.current = window.requestAnimationFrame(renderFrame);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isInteractive() || (event.pointerType && event.pointerType !== "mouse")) return;
      pointer.current = {
        target: findMotionTarget(event.target, "[data-liquid-surface]"),
        x: event.clientX,
        y: event.clientY,
      };
      requestFrame();
    };

    const handlePointerLeave = () => {
      cancelFrame();
      clearSurface();
      clearMagnet();
      root.classList.remove("liquid-pointer-enabled");
    };

    const handleRipple = (event: PointerEvent) => {
      if (!isInteractive() || event.button !== 0 || event.pointerType === "touch") return;
      const host = findMotionTarget(event.target, "[data-liquid-ripple]");
      if (!host) return;

      const bounds = host.getBoundingClientRect();
      const isNavigationRipple = host.hasAttribute("data-nav-ripple");
      const ripple = document.createElement("span");
      ripple.className = isNavigationRipple ? "liquid-ripple liquid-ripple--nav" : "liquid-ripple";
      ripple.style.setProperty("--ripple-x", `${event.clientX - bounds.left}px`);
      ripple.style.setProperty("--ripple-y", `${event.clientY - bounds.top}px`);
      ripple.style.setProperty(
        "--ripple-size",
        `${Math.max(bounds.width, bounds.height) * (isNavigationRipple ? 0.72 : 1.7)}px`,
      );
      host.classList.add("liquid-ripple-host");
      host.append(ripple);
      window.setTimeout(() => ripple.remove(), isNavigationRipple ? 470 : 720);
    };

    const handleVisibility = () => {
      if (document.hidden) cancelFrame();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave, { passive: true });
    window.addEventListener("pointerdown", handleRipple, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    finePointer.addEventListener("change", deactivate);
    reducedMotion.addEventListener("change", deactivate);

    return () => {
      deactivate();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("pointerdown", handleRipple);
      document.removeEventListener("visibilitychange", handleVisibility);
      finePointer.removeEventListener("change", deactivate);
      reducedMotion.removeEventListener("change", deactivate);
    };
  }, [paused]);

  return <>{children}</>;
}
