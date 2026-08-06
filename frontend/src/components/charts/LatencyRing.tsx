import { useId, type CSSProperties, type ReactNode } from "react";

export interface LatencyRingProps {
  /** 0..1 progress around the ring. */
  value: number;
  /** Outer diameter in pixels. */
  size?: number;
  /** Stroke width in pixels. */
  stroke?: number;
  /** Track color (CSS color). */
  trackColor?: string;
  /** Progress color (CSS color). */
  progressColor?: string;
  /** Center label. */
  label?: ReactNode;
  /** Caption below the label. */
  caption?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Conic-style progress ring. Renders an SVG <circle> stroke-dashoffset ring
 * with a CSS-customisable colour and an optional centred label. Animation
 * is a single CSS transition on stroke-dashoffset.
 */
export function LatencyRing({
  value,
  size = 96,
  stroke = 7,
  trackColor = "var(--surface-strong)",
  progressColor = "var(--primary)",
  label,
  caption,
  className,
  style,
}: LatencyRingProps) {
  const gradId = useId().replace(/:/g, "-");
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeValue = Math.max(0, Math.min(1, value));
  // stroke-dashoffset transitions in CSS. Keeping the target value in the DOM
  // avoids a React state update on every animation frame.
  const offset = circumference * (1 - safeValue);

  return (
    <div
      className={`liquid-ring ${className ?? ""}`}
      style={{ width: size, height: size, position: "relative", ...style }}
      role="img"
      aria-label={(typeof label === "string" ? label : caption) ?? `${Math.round(safeValue * 100)}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={progressColor} />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--success) 60%, var(--primary))" />
          </linearGradient>
        </defs>
        <circle
          className="liquid-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <circle
          className="liquid-ring__progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#grad-${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {(label || caption) ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {label ? <strong style={{ fontSize: size * 0.18, color: "var(--primary-ink)" }}>{label}</strong> : null}
            {caption ? <span style={{ fontSize: size * 0.085, color: "var(--text-faint)" }}>{caption}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
