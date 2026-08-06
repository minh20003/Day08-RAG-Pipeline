import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useAnimationFrame, useMotionValue, useTransform } from "motion/react";

/**
 * Animated gradient text — uses Motion's useAnimationFrame to drive a
 * Motion value that maps to backgroundPosition. Adapted from
 * react-bits/TextAnimations/GradientText with no Tailwind.
 */
export interface GradientTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
  animationSpeed?: number; // seconds per cycle
  direction?: "horizontal" | "vertical" | "diagonal";
  yoyo?: boolean;
  pauseOnHover?: boolean;
  style?: CSSProperties;
}

export function GradientText({
  children,
  className = "",
  colors = ["#7c8cff", "#71cfff", "#c5a8ff"],
  animationSpeed = 8,
  direction = "horizontal",
  yoyo = true,
  pauseOnHover = false,
  style,
}: GradientTextProps) {
  const [isPaused, setIsPaused] = useState(false);
  const progress = useMotionValue(0);
  const elapsedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  const animationDuration = animationSpeed * 1000;

  useAnimationFrame((time) => {
    if (isPaused) {
      lastTimeRef.current = null;
      return;
    }
    if (lastTimeRef.current === null) {
      lastTimeRef.current = time;
      return;
    }
    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;
    elapsedRef.current += deltaTime;

    if (yoyo) {
      const fullCycle = animationDuration * 2;
      const cycleTime = elapsedRef.current % fullCycle;
      if (cycleTime < animationDuration) {
        progress.set((cycleTime / animationDuration) * 100);
      } else {
        progress.set(100 - ((cycleTime - animationDuration) / animationDuration) * 100);
      }
    } else {
      progress.set((elapsedRef.current / animationDuration) * 100);
    }
  });

  useEffect(() => {
    elapsedRef.current = 0;
    progress.set(0);
  }, [animationSpeed, yoyo, progress]);

  const backgroundPosition = useTransform(progress, (p) => {
    if (direction === "horizontal") return `${p}% 50%`;
    if (direction === "vertical") return `50% ${p}%`;
    return `${p}% 50%`;
  });

  const gradientAngle =
    direction === "horizontal"
      ? "to right"
      : direction === "vertical"
        ? "to bottom"
        : "to bottom right";
  const gradientColors = [...colors, colors[0]].join(", ");

  const gradientStyle = {
    backgroundImage: `linear-gradient(${gradientAngle}, ${gradientColors})`,
    backgroundSize:
      direction === "horizontal" ? "300% 100%" : direction === "vertical" ? "100% 300%" : "300% 300%",
    backgroundRepeat: "repeat",
  };

  return (
    <motion.span
      className={`liquid-gradient-text ${className}`}
      onMouseEnter={() => pauseOnHover && setIsPaused(true)}
      onMouseLeave={() => pauseOnHover && setIsPaused(false)}
      style={{
        ...style,
        display: "inline-block",
        color: "transparent",
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        ...gradientStyle,
        backgroundPosition,
      }}
    >
      {children}
    </motion.span>
  );
}
