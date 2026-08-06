import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";

/**
 * Scrollable list wrapper that reveals top + bottom edge fades whenever the
 * list has more content than the viewport. Each child enters with a stagger
 * once it scrolls into view. Adapted from react-bits/AnimatedList with the
 * Tailwind removed and the global token system honoured.
 */
export interface AnimatedListProps {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  itemClassName?: string;
  fadeSize?: number;
  baseDelay?: number;
  stagger?: number;
  showGradients?: boolean;
  style?: CSSProperties;
}

export function AnimatedList({
  children,
  className = "",
  innerClassName = "",
  itemClassName = "",
  fadeSize = 36,
  baseDelay = 0.04,
  stagger = 0.04,
  showGradients = true,
  style,
}: AnimatedListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [topOpacity, setTopOpacity] = useState(0);
  const [bottomOpacity, setBottomOpacity] = useState(1);
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(new Set());

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setTopOpacity(Math.min(scrollTop / Math.max(fadeSize, 1), 1));
    const bottomDistance = scrollHeight - (scrollTop + clientHeight);
    setBottomOpacity(
      scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / Math.max(fadeSize, 1), 1),
    );

    // Reveal items whose mid-point has scrolled into view (used for stagger
    // enter on first paint and when scrolling back up).
    const next = new Set<number>();
    Array.from(el.querySelectorAll<HTMLElement>("[data-liquid-list-item]")).forEach(
      (node, index) => {
        const rect = node.getBoundingClientRect();
        const viewRect = el.getBoundingClientRect();
        const top = rect.top - viewRect.top;
        if (top >= 0 && top <= viewRect.height) next.add(index);
      },
    );
    if (next.size !== visibleIndices.size || [...next].some((i) => !visibleIndices.has(i))) {
      setVisibleIndices(next);
    }
  };

  // Trigger initial visibility so the first batch fades in on mount.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current;
    Array.from(el.querySelectorAll<HTMLElement>("[data-liquid-list-item]")).forEach(
      (node, index) => {
        const rect = node.getBoundingClientRect();
        const viewRect = el.getBoundingClientRect();
        const top = rect.top - viewRect.top;
        if (top >= 0 && top <= viewRect.height) {
          setVisibleIndices((current) => {
            if (current.has(index)) return current;
            const next = new Set(current);
            next.add(index);
            return next;
          });
        }
      },
    );
    handleScroll({ currentTarget: el } as unknown as UIEvent<HTMLDivElement>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={listRef}
      className={`liquid-list ${className}`}
      onScroll={handleScroll}
      style={{
        position: "relative",
        overflowY: "auto",
        scrollbarWidth: "thin",
        ...style,
      }}
    >
      <div className={`liquid-list__inner ${innerClassName}`}>
        {Array.isArray(children)
          ? children.map((child, index) => {
              const visible = visibleIndices.has(index);
              const delay = baseDelay + index * stagger;
              return (
                <div
                  key={(child as { key?: string })?.key ?? index}
                  data-liquid-list-item=""
                  className={itemClassName}
                  style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(12px)",
                    transition: `opacity 420ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}s, transform 420ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}s`,
                    willChange: "opacity, transform",
                  }}
                >
                  {child}
                </div>
              );
            })
          : children}
      </div>
      {showGradients ? (
        <>
          <div
            aria-hidden="true"
            className="liquid-list__fade liquid-list__fade--top"
            style={{ opacity: topOpacity, height: fadeSize, position: "sticky", top: 0, marginTop: `-${fadeSize}px` }}
          />
          <div
            aria-hidden="true"
            className="liquid-list__fade liquid-list__fade--bottom"
            style={{ opacity: bottomOpacity, height: fadeSize, position: "sticky", bottom: 0, marginBottom: `-${fadeSize}px` }}
          />
        </>
      ) : null}
    </div>
  );
}
