import { useEffect, useId, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { useThemeMode } from "../../hooks/useThemeMode";

/**
 * Vision-style glass surface with chromatic refraction via SVG
 * feDisplacementMap + feColorMatrix. Adapted from react-bits/GlassSurface
 * to match the CampusIQ vanilla-CSS design system: no Tailwind, uses the
 * project's existing --glass-* / --liquid-* CSS variables, and respects
 * data-theme (not prefers-color-scheme).
 *
 * Disabled in @supports not (backdrop-filter) to the existing fallback.
 */
export interface GlassSurfaceProps {
  children?: ReactNode;
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  borderWidth?: number;
  brightness?: number;
  opacity?: number;
  blur?: number;
  displace?: number;
  backgroundOpacity?: number;
  saturation?: number;
  distortionScale?: number;
  redOffset?: number;
  greenOffset?: number;
  blueOffset?: number;
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
}

function supportsSVGFilters(): boolean {
  if (typeof document === "undefined") return false;
  const div = document.createElement("div");
  div.style.backdropFilter = "url(#test)";
  return Boolean(div.style.backdropFilter);
}

function supportsBackdropFilter(): boolean {
  if (typeof window === "undefined") return false;
  return CSS.supports("backdrop-filter", "blur(10px)");
}

export function GlassSurface({
  children,
  width,
  height,
  borderRadius = 20,
  borderWidth = 0.07,
  brightness = 50,
  opacity = 0.93,
  blur = 11,
  displace = 0,
  backgroundOpacity = 0,
  saturation = 1,
  distortionScale = -180,
  redOffset = 0,
  greenOffset = 10,
  blueOffset = 20,
  className = "",
  style,
  as,
}: GlassSurfaceProps) {
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark";
  const uniqueId = useId().replace(/:/g, "-");
  const filterId = `campusiq-glass-${uniqueId}`;
  const redGradId = `red-grad-${uniqueId}`;
  const blueGradId = `blue-grad-${uniqueId}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const feImageRef = useRef<SVGFEImageElement>(null);
  const redChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const greenChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const blueChannelRef = useRef<SVGFEDisplacementMapElement>(null);
  const gaussianBlurRef = useRef<SVGFEGaussianBlurElement>(null);

  const [svgSupported, setSvgSupported] = useState<boolean>(false);

  const generateDisplacementMap = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    const actualWidth = rect?.width || 400;
    const actualHeight = rect?.height || 200;
    const edgeSize = Math.min(actualWidth, actualHeight) * (borderWidth * 0.5);

    const svgContent = `
      <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="black"></rect>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${redGradId})" />
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode: difference" />
        <rect x="${edgeSize}" y="${edgeSize}" width="${actualWidth - edgeSize * 2}" height="${actualHeight - edgeSize * 2}" rx="${borderRadius}" fill="hsl(0 0% ${brightness}% / ${opacity})" style="filter:blur(${blur}px)" />
      </svg>
    `;

    return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
  };

  const updateDisplacementMap = () => {
    feImageRef.current?.setAttribute("href", generateDisplacementMap());
  };

  useEffect(() => {
    setSvgSupported(supportsSVGFilters());
  }, []);

  useEffect(() => {
    updateDisplacementMap();
    (
      [
        { ref: redChannelRef, offset: redOffset },
        { ref: greenChannelRef, offset: greenOffset },
        { ref: blueChannelRef, offset: blueOffset },
      ] as const
    ).forEach(({ ref, offset }) => {
      if (ref.current) {
        ref.current.setAttribute("scale", (distortionScale + offset).toString());
      }
    });
    gaussianBlurRef.current?.setAttribute("stdDeviation", displace.toString());
  }, [
    width,
    height,
    borderRadius,
    borderWidth,
    brightness,
    opacity,
    blur,
    displace,
    distortionScale,
    redOffset,
    greenOffset,
    blueOffset,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;
    const node = containerRef.current;
    const observer = new ResizeObserver(() => {
      window.setTimeout(updateDisplacementMap, 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const backdropFilterSupported = supportsBackdropFilter();

  const baseStyles: CSSProperties = {
    ...style,
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    borderRadius: `${borderRadius}px`,
  } as CSSProperties;

  const containerStyles: CSSProperties = svgSupported
    ? {
        ...baseStyles,
        background: isDark
          ? `hsl(0 0% 0% / ${backgroundOpacity})`
          : `hsl(0 0% 100% / ${backgroundOpacity})`,
        backdropFilter: `url(#${filterId}) saturate(${saturation})`,
        WebkitBackdropFilter: `url(#${filterId}) saturate(${saturation})`,
        boxShadow: isDark
          ? `0 0 2px 1px color-mix(in oklch, white, transparent 65%) inset,
             0px 4px 16px rgb(0 0 0 / 6%),
             0px 8px 24px rgb(0 0 0 / 6%),
             0px 16px 56px rgb(0 0 0 / 6%)`
          : `0 0 2px 1px color-mix(in oklch, black, transparent 85%) inset,
             0px 4px 16px rgb(17 17 26 / 5%),
             0px 8px 24px rgb(17 17 26 / 5%),
             0px 16px 56px rgb(17 17 26 / 5%)`,
      }
    : isDark
      ? {
          ...baseStyles,
          background: backdropFilterSupported ? "rgb(255 255 255 / 8%)" : "rgb(0 0 0 / 38%)",
          backdropFilter: backdropFilterSupported ? "blur(14px) saturate(170%)" : undefined,
          WebkitBackdropFilter: backdropFilterSupported ? "blur(14px) saturate(170%)" : undefined,
          border: "1px solid rgb(255 255 255 / 18%)",
          boxShadow: `inset 0 1px 0 0 rgb(255 255 255 / 18%), inset 0 -1px 0 0 rgb(255 255 255 / 8%)`,
        }
      : {
          ...baseStyles,
          background: backdropFilterSupported ? "rgb(255 255 255 / 28%)" : "rgb(255 255 255 / 38%)",
          backdropFilter: backdropFilterSupported ? "blur(14px) saturate(170%)" : undefined,
          WebkitBackdropFilter: backdropFilterSupported ? "blur(14px) saturate(170%)" : undefined,
          border: "1px solid rgb(255 255 255 / 32%)",
          boxShadow: `inset 0 1px 0 0 rgb(255 255 255 / 48%), inset 0 -1px 0 0 rgb(255 255 255 / 22%)`,
        };

  const Tag = (as ?? "div") as ElementType;

  return (
    <Tag
      ref={containerRef as React.RefObject<HTMLElement>}
      className={`liquid-glass ${className}`}
      style={containerStyles}
    >
      <svg
        className="liquid-glass__filter"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <filter
            id={filterId}
            colorInterpolationFilters="sRGB"
            x="0%"
            y="0%"
            width="100%"
            height="100%"
          >
            <feImage
              ref={feImageRef}
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              ref={redChannelRef}
              in="SourceGraphic"
              in2="map"
              result="dispRed"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feColorMatrix
              in="dispRed"
              type="matrix"
              values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="red"
            />
            <feDisplacementMap
              ref={greenChannelRef}
              in="SourceGraphic"
              in2="map"
              result="dispGreen"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feColorMatrix
              in="dispGreen"
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="green"
            />
            <feDisplacementMap
              ref={blueChannelRef}
              in="SourceGraphic"
              in2="map"
              result="dispBlue"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feColorMatrix
              in="dispBlue"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              result="blue"
            />
            <feBlend in="red" in2="green" mode="screen" result="rg" />
            <feBlend in="rg" in2="blue" mode="screen" result="output" />
            <feGaussianBlur ref={gaussianBlurRef} in="output" stdDeviation="0.7" />
          </filter>
        </defs>
      </svg>
      <div className="liquid-glass__inner">{children}</div>
    </Tag>
  );
}
