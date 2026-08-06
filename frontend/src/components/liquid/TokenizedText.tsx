import { useMemo } from "react";
import { useReducedMotion } from "../../hooks/useReducedMotion";

export interface TokenizedTextProps {
  text: string;
  perTokenDelay?: number;
  startDelay?: number;
  className?: string;
  preserveBreaks?: boolean;
}

/**
 * Splits text into whitespace-delimited tokens and renders each with a
 * staggered CSS animation. The CSS keyframe (liquid-token-arrive) handles
 * the actual fade/slide so it can be globally overridden by
 * prefers-reduced-motion via the stylesheet without re-rendering.
 */
export function TokenizedText({
  text,
  perTokenDelay = 14,
  startDelay = 0,
  className,
  preserveBreaks = true,
}: TokenizedTextProps) {
  const reducedMotion = useReducedMotion();

  const segments = useMemo(() => {
    if (preserveBreaks) {
      return text.split(/(\s+)/);
    }
    return [text];
  }, [text, preserveBreaks]);

  if (reducedMotion) {
    return <p className={className}>{text}</p>;
  }

  let tokenIndex = 0;
  return (
    <span className={className}>
      {segments.map((segment, segmentIndex) => {
        if (/^\s+$/.test(segment)) {
          return <span key={`seg-${segmentIndex}`}>{segment}</span>;
        }
        // Each token is its own span so per-token delay is constant.
        return segment.split(/(\b)/).map((tokenPart, subIndex) => {
          if (!tokenPart) return null;
          if (tokenPart === "\n") return <br key={`br-${segmentIndex}-${subIndex}`} />;
          if (!/\S/.test(tokenPart)) return <span key={`ws-${segmentIndex}-${subIndex}`}>{tokenPart}</span>;
          const delay = startDelay + tokenIndex * perTokenDelay;
          tokenIndex += 1;
          return (
            <span
              key={`tok-${segmentIndex}-${subIndex}`}
              className="liquid-token"
              style={{ ["--token-delay" as string]: `${delay}ms` }}
            >
              {tokenPart}
            </span>
          );
        });
      })}
    </span>
  );
}