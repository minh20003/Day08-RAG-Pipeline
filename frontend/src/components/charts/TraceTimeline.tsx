import { useEffect, useState, type CSSProperties } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion";

export interface TraceTimelineProps {
  /** Pipeline stage names. */
  steps: string[];
  /** When set, the timeline plays an automatic progress animation. */
  autoProgress?: boolean;
  /** ms between step highlights when autoProgress is on. */
  stepMs?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Horizontal stepper for the RAG pipeline. Each step is a chip; the active
 * step lights up. With autoProgress, the steps light up sequentially and
 * then loop. Used in chat bubbles to visualise the retrieval trace.
 */
export function TraceTimeline({
  steps,
  autoProgress = false,
  stepMs = 360,
  className,
  style,
}: TraceTimelineProps) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!autoProgress || reducedMotion || steps.length === 0) return undefined;
    let handle = 0;
    const step = (index: number) => {
      setActiveIndex(index);
      if (index < steps.length - 1) {
        handle = window.setTimeout(() => step(index + 1), stepMs);
      } else {
        handle = window.setTimeout(() => step(0), stepMs * 1.6);
      }
    };
    step(0);
    return () => window.clearTimeout(handle);
  }, [autoProgress, reducedMotion, stepMs, steps.length]);

  if (steps.length === 0) return null;

  return (
    <div className={`liquid-trace ${className ?? ""}`} style={style} role="list" aria-label="RAG pipeline trace">
      {steps.map((step, index) => (
        <span key={step} style={{ display: "contents" }}>
          <span
            className={`liquid-trace__step ${index <= activeIndex ? "is-active" : ""}`}
            role="listitem"
            aria-current={index === activeIndex ? "step" : undefined}
          >
            {step}
          </span>
          {index < steps.length - 1 ? (
            <span
              className={`liquid-trace__connector ${index < activeIndex ? "is-active" : ""}`}
              aria-hidden="true"
            />
          ) : null}
        </span>
      ))}
    </div>
  );
}
