import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useFinePointer, useReducedMotion } from "../../hooks/useReducedMotion";

/**
 * Vanilla-DOM port of react-bits/Animations/Magnet — wraps children and snaps
 * the inner element toward the cursor inside a configurable padding zone,
 * springing back when the cursor leaves. Reuses the global pointer x/y from
 * the existing MotionProvider when fine pointer is available, and falls
 * back to its own listener otherwise.
 */
export interface MagnetProps {
  children: ReactNode;
  padding?: number;
  disabled?: boolean;
  magnetStrength?: number;
  activeTransition?: string;
  inactiveTransition?: string;
  wrapperClassName?: string;
  innerClassName?: string;
  style?: CSSProperties;
}

export function Magnet({
  children,
  padding = 80,
  disabled = false,
  magnetStrength = 2,
  activeTransition = "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
  inactiveTransition = "transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
  wrapperClassName = "",
  innerClassName = "",
  style,
}: MagnetProps) {
  const finePointer = useFinePointer();
  const reducedMotion = useReducedMotion();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isActive, setIsActive] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Subscribe to the global cursor via window listener when fine pointer is
  // available; otherwise use the per-element listener. Skip when reduced
  // motion is set or the device has no fine pointer.
  const interactive = finePointer && !reducedMotion && !disabled;

  useEffect(() => {
    if (!interactive) {
      setOffset({ x: 0, y: 0 });
      setIsActive(false);
      return;
    }
    const node = wrapperRef.current;
    if (!node) return;

    const handleMove = (event: globalThis.MouseEvent) => {
      const { left, top, width, height } = node.getBoundingClientRect();
      const cx = left + width / 2;
      const cy = top + height / 2;
      const dx = Math.abs(cx - event.clientX);
      const dy = Math.abs(cy - event.clientY);
      if (dx < width / 2 + padding && dy < height / 2 + padding) {
        setIsActive(true);
        setOffset({
          x: (event.clientX - cx) / magnetStrength,
          y: (event.clientY - cy) / magnetStrength,
        });
      } else {
        setIsActive(false);
        setOffset({ x: 0, y: 0 });
      }
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [interactive, padding, magnetStrength]);

  return (
    <div
      ref={wrapperRef}
      className={`liquid-magnet ${wrapperClassName}`}
      style={{ position: "relative", display: "inline-block", ...style }}
      onMouseEnter={(event: MouseEvent<HTMLDivElement>) => {
        if (!interactive) return;
        const node = wrapperRef.current;
        if (!node) return;
        const { left, top, width, height } = node.getBoundingClientRect();
        const cx = left + width / 2;
        const cy = top + height / 2;
        setIsActive(true);
        setOffset({ x: (event.clientX - cx) / magnetStrength, y: (event.clientY - cy) / magnetStrength });
      }}
      onMouseLeave={() => {
        if (!interactive) return;
        setIsActive(false);
        setOffset({ x: 0, y: 0 });
      }}
    >
      <div
        className={`liquid-magnet__inner ${innerClassName}`}
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
          transition: isActive ? activeTransition : inactiveTransition,
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  );
}
