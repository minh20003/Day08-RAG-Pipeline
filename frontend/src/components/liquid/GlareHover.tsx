import { useRef, type CSSProperties, type ReactNode } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/**
 * Hover-triggered diagonal glare sweep. Adapted from react-bits/Animations/
 * GlareHover — vanilla CSS, single overlay, no Tailwind. Skipped entirely
 * when prefers-reduced-motion is set.
 */
export interface GlareHoverProps {
  children: ReactNode;
  className?: string;
  glareColor?: string;
  glareOpacity?: number;
  glareAngle?: number;
  glareSize?: number;
  transitionDuration?: number;
  style?: CSSProperties;
}

function hexToRgba(input: string, alpha: number): string {
  const hex = input.replace("#", "");
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return input;
}

export function GlareHover({
  children,
  className = "",
  glareColor = "#ffffff",
  glareOpacity = 0.32,
  glareAngle = -45,
  glareSize = 250,
  transitionDuration = 650,
  style,
}: GlareHoverProps) {
  const reducedMotion = useReducedMotion();
  const overlayRef = useRef<HTMLDivElement>(null);

  const animateIn = () => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.backgroundPosition = "-100% -100%, 0 0";
    // Force reflow so the next transition is picked up
    void el.offsetWidth;
    el.style.transition = `${transitionDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    el.style.backgroundPosition = "100% 100%, 0 0";
  };

  const animateOut = () => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.transition = `${transitionDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    el.style.backgroundPosition = "-100% -100%, 0 0";
  };

  if (reducedMotion) {
    return <div className={className} style={style}>{children}</div>;
  }

  const rgba = hexToRgba(glareColor, glareOpacity);

  return (
    <div
      className={`liquid-glare ${className}`}
      style={{ position: "relative", overflow: "hidden", ...style }}
      onMouseEnter={animateIn}
      onMouseLeave={animateOut}
    >
      <div
        ref={overlayRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(${glareAngle}deg,
              hsla(0,0%,0%,0) 60%,
              ${rgba} 70%,
              hsla(0,0%,0%,0) 100%)`,
          backgroundSize: `${glareSize}% ${glareSize}%, 100% 100%`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "-100% -100%, 0 0",
          pointerEvents: "none",
          mixBlendMode: "screen",
        }}
      />
      {children}
    </div>
  );
}
