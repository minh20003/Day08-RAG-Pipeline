import { useReducedMotion } from "../../hooks/useReducedMotion";

export interface SkeletonCardProps {
  /** Number of horizontal "lines" to render. */
  lines?: number;
  /** Widths for each line (CSS length strings). Defaults to a random-ish mix. */
  widths?: string[];
  className?: string;
}

/**
 * Glass-card skeleton placeholder with a shimmer keyframe. Used while the
 * message list / source list is loading. Respects prefers-reduced-motion
 * by rendering static blocks instead of animated ones.
 */
export function SkeletonCard({ lines = 3, widths, className }: SkeletonCardProps) {
  const reducedMotion = useReducedMotion();
  const effectiveWidths =
    widths ?? [Math.round(82 + Math.random() * 12) + "%", Math.round(60 + Math.random() * 22) + "%", Math.round(40 + Math.random() * 28) + "%"];

  return (
    <div className={`liquid-skeleton-card ${className ?? ""}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <span
          key={index}
          className="liquid-skeleton liquid-skeleton--block"
          style={{
            width: effectiveWidths[index] ?? "70%",
            animation: reducedMotion ? "none" : undefined,
            background: reducedMotion ? "var(--surface-soft)" : undefined,
          }}
        />
      ))}
    </div>
  );
}