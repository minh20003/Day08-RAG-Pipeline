import { type CSSProperties } from "react";

export interface MetricBarProps {
  /** Target value 0..1. */
  value: number;
  /** When set, override the track + progress colours. */
  trackColor?: string;
  fillColor?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Animated horizontal metric bar. The browser interpolates a single CSS width
 * transition between values; React only renders when the metric changes.
 */
export function MetricBar({ value, className, style, trackColor, fillColor }: MetricBarProps) {
  const safe = Math.max(0, Math.min(1, value));
  return (
    <span
      className={`liquid-bar ${className ?? ""}`}
      style={style}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safe * 100)}
    >
      <span
        className="liquid-bar__fill"
        style={
          {
            ["--liquid-bar-value" as string]: `${safe * 100}%`,
            background: fillColor,
          } as CSSProperties
        }
      />
      {trackColor ? (
        <style>{`.liquid-bar { background: ${trackColor}; }`}</style>
      ) : null}
    </span>
  );
}
