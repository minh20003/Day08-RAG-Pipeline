import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useCursorAngle } from "../../hooks/useCursorAngle";
import { useReducedMotion } from "../../hooks/useReducedMotion";

/**
 * Vision-style border glow. Cursor-driven conic mask reveals a mesh-gradient
 * border ring + soft outer glow. Adapted from react-bits/BorderGlow to use
 * the project's CSS variables and the useCursorAngle hook from this codebase.
 */
export interface BorderGlowProps {
  children?: ReactNode;
  className?: string;
  edgeSensitivity?: number;
  glowRadius?: number;
  glowIntensity?: number;
  coneSpread?: number;
  colors?: string[];
  fillOpacity?: number;
  style?: CSSProperties;
}

const GRADIENT_POSITIONS = ["80% 55%", "69% 34%", "8% 6%", "41% 38%", "86% 85%", "82% 18%", "51% 4%"];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

const DEFAULT_COLORS = ["#7c8cff", "#71cfff", "#8cffd1"];

function buildMeshGradients(colors: string[]): string[] {
  const gradients: string[] = [];
  for (let i = 0; i < 7; i++) {
    const c = colors[Math.min(COLOR_MAP[i] ?? 0, colors.length - 1)];
    gradients.push(`radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`);
  }
  gradients.push(`linear-gradient(${colors[0] ?? "#7c8cff"} 0 100%)`);
  return gradients;
}

export function BorderGlow({
  children,
  className = "",
  edgeSensitivity = 30,
  glowRadius = 28,
  glowIntensity = 0.85,
  coneSpread = 22,
  colors = DEFAULT_COLORS,
  fillOpacity = 0.45,
  style,
}: BorderGlowProps) {
  const reducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [cursorAngle, setCursorAngle] = useState(45);
  const [edgeProximity, setEdgeProximity] = useState(0);
  const { angle, edgeProximity: proximityFor } = useCursorAngle();

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const x = event.clientX;
    const y = event.clientY;
    setCursorAngle(angle(card, x, y));
    setEdgeProximity(proximityFor(card, x, y));
  };

  if (reducedMotion) {
    return (
      <div ref={cardRef} className={className} style={style}>
        {children}
      </div>
    );
  }

  const colorSensitivity = edgeSensitivity + 20;
  const isVisible = isHovered;
  const borderOpacity = isVisible
    ? Math.max(0, (edgeProximity * 100 - colorSensitivity) / (100 - colorSensitivity))
    : 0;
  const glowOpacity = isVisible
    ? Math.max(0, (edgeProximity * 100 - edgeSensitivity) / (100 - edgeSensitivity))
    : 0;
  const meshGradients = buildMeshGradients(colors);
  const borderBg = meshGradients.map((g) => `${g} border-box`);
  const fillBg = meshGradients.map((g) => `${g} padding-box`);
  const angleDeg = `${cursorAngle.toFixed(2)}deg`;

  const borderMaskImage =
    `conic-gradient(from ${angleDeg} at center, ` +
    `rgb(0 0 0 / ${coneSpread}%) ${coneSpread}%, transparent ${coneSpread + 15}%, transparent ${100 - coneSpread - 15}%, rgb(0 0 0 / ${coneSpread}%) ${100 - coneSpread}%)`;
  const webkitBorderMaskImage = borderMaskImage;

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      className={`liquid-border-glow ${className}`}
      style={{
        position: "relative",
        isolation: "isolate",
        transform: "translate3d(0, 0, 0.01px)",
        ...style,
      }}
    >
      <div
        aria-hidden="true"
        className="liquid-border-glow__border"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          zIndex: -1,
          border: "1px solid transparent",
          background: [
            `linear-gradient(var(--surface) 0 100%) padding-box`,
            "linear-gradient(rgb(255 255 255 / 0%) 0% 100%) border-box",
            ...borderBg,
          ].join(", "),
          opacity: borderOpacity,
          maskImage: borderMaskImage,
          WebkitMaskImage: webkitBorderMaskImage,
          transition: isVisible ? "opacity 0.25s ease-out" : "opacity 0.75s ease-in-out",
        }}
      />
      <div
        aria-hidden="true"
        className="liquid-border-glow__fill"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          zIndex: -1,
          border: "1px solid transparent",
          background: fillBg.join(", "),
          maskImage: [
            "linear-gradient(to bottom, rgb(0 0 0), rgb(0 0 0))",
            "radial-gradient(ellipse at 50% 50%, rgb(0 0 0) 40%, transparent 65%)",
            "radial-gradient(ellipse at 66% 66%, rgb(0 0 0) 5%, transparent 40%)",
            "radial-gradient(ellipse at 33% 33%, rgb(0 0 0) 5%, transparent 40%)",
            "radial-gradient(ellipse at 66% 33%, rgb(0 0 0) 5%, transparent 40%)",
            "radial-gradient(ellipse at 33% 66%, rgb(0 0 0) 5%, transparent 40%)",
            `conic-gradient(from ${angleDeg} at center, transparent 5%, rgb(0 0 0) 15%, rgb(0 0 0) 85%, transparent 95%)`,
          ].join(", "),
          WebkitMaskImage: [
            "linear-gradient(to bottom, rgb(0 0 0), rgb(0 0 0))",
            "radial-gradient(ellipse at 50% 50%, rgb(0 0 0) 40%, transparent 65%)",
            "radial-gradient(ellipse at 66% 66%, rgb(0 0 0) 5%, transparent 40%)",
            "radial-gradient(ellipse at 33% 33%, rgb(0 0 0) 5%, transparent 40%)",
            "radial-gradient(ellipse at 66% 33%, rgb(0 0 0) 5%, transparent 40%)",
            "radial-gradient(ellipse at 33% 66%, rgb(0 0 0) 5%, transparent 40%)",
            `conic-gradient(from ${angleDeg} at center, transparent 5%, rgb(0 0 0) 15%, rgb(0 0 0) 85%, transparent 95%)`,
          ].join(", "),
          maskComposite: "subtract, add, add, add, add, add" as CSSProperties["maskComposite"],
          WebkitMaskComposite:
            "source-out, source-over, source-over, source-over, source-over, source-over" as CSSProperties["WebkitMaskComposite"],
          opacity: borderOpacity * fillOpacity,
          mixBlendMode: "soft-light",
          transition: isVisible ? "opacity 0.25s ease-out" : "opacity 0.75s ease-in-out",
        }}
      />
      <span
        aria-hidden="true"
        className="liquid-border-glow__outer"
        style={{
          position: "absolute",
          pointerEvents: "none",
          zIndex: 1,
          inset: `${-glowRadius}px`,
          borderRadius: "inherit",
          maskImage: `conic-gradient(from ${angleDeg} at center, rgb(0 0 0) 2.5%, transparent 10%, transparent 90%, rgb(0 0 0) 97.5%)`,
          WebkitMaskImage: `conic-gradient(from ${angleDeg} at center, rgb(0 0 0) 2.5%, transparent 10%, transparent 90%, rgb(0 0 0) 97.5%)`,
          opacity: glowOpacity * glowIntensity,
          mixBlendMode: "plus-lighter",
          transition: isVisible ? "opacity 0.25s ease-out" : "opacity 0.75s ease-in-out",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: `${glowRadius}px`,
            borderRadius: "inherit",
            boxShadow: `0 0 ${glowRadius * 1.4}px ${colors[0]}55, inset 0 0 ${glowRadius}px ${colors[1] ?? colors[0]}33`,
          }}
        />
      </span>
      <div style={{ position: "relative", zIndex: 1, overflow: "auto" }}>{children}</div>
    </div>
  );
}
