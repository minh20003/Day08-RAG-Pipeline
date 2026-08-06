import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mesh, Program, Renderer, Triangle } from "ogl";
import type { OGLRenderingContext } from "ogl";
import { useFinePointer, useReducedMotion } from "../../hooks/useReducedMotion";
import { useWebGLSupport } from "../../hooks/useWebGLSupport";
import { AURORA_FRAG, AURORA_VERT } from "../../lib/shaders/aurora";
import { LIQUID_CHROME_FRAG, LIQUID_CHROME_VERT } from "../../lib/shaders/liquidChrome";
import type { ThemeMode } from "../../types";

interface GlassBackdropProps {
  theme: ThemeMode;
  className?: string;
}

interface BackdropRuntime {
  dispose: () => void;
  setTheme: (theme: ThemeMode) => void;
}

interface BackdropPalette {
  aurora: [number, number, number][];
  liquid: [number, number, number];
}

const MAX_DPR = 1.5;
let hasWarnedAboutWebglFailure = false;

const BACKDROP_PALETTES: Record<ThemeMode, BackdropPalette> = {
  light: {
    aurora: [
      [0.26, 0.34, 0.78],
      [0.34, 0.63, 0.88],
      [0.55, 0.48, 0.86],
    ],
    liquid: [0.32, 0.42, 0.72],
  },
  dark: {
    aurora: [
      [0.19, 0.28, 0.68],
      [0.24, 0.54, 0.76],
      [0.45, 0.36, 0.76],
    ],
    liquid: [0.16, 0.27, 0.52],
  },
};

function warnAboutWebglFailure(error: unknown) {
  if (hasWarnedAboutWebglFailure) return;
  hasWarnedAboutWebglFailure = true;
  // The CSS lake stays mounted below this canvas, so a single warning is
  // enough. Repeated frame warnings obscure the actual application errors.
  // eslint-disable-next-line no-console
  console.warn("[GlassBackdrop] WebGL disabled; using the CSS backdrop instead.", error);
}

/**
 * A deliberately subtle two-layer WebGL accent. It never owns a content
 * surface: when unsupported or unavailable, the CSS lake remains the fallback.
 */
export function GlassBackdrop({ className, theme }: GlassBackdropProps) {
  const webglSupported = useWebGLSupport();
  const reducedMotion = useReducedMotion();
  const finePointer = useFinePointer();
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<BackdropRuntime | null>(null);
  const themeRef = useRef(theme);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Switching theme updates uniforms on the live renderer. In particular, do
  // not recreate a canvas after WEBGL_lose_context; that caused the stale white
  // canvas and the OGL error loop during rapid light/dark toggles.
  useLayoutEffect(() => {
    themeRef.current = theme;
    runtimeRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    setReady(false);
    if (!webglSupported || reducedMotion || !finePointer || failed || !hostRef.current) return;

    let disposed = false;
    let runtime: BackdropRuntime | null = null;

    try {
      runtime = mountBackdrop(hostRef.current, themeRef.current, {
        onError: (error) => {
          if (disposed) return;
          setReady(false);
          setFailed(true);
          warnAboutWebglFailure(error);
        },
        onReady: () => {
          if (!disposed) setReady(true);
        },
      });
      runtimeRef.current = runtime;
    } catch (error) {
      setFailed(true);
      warnAboutWebglFailure(error);
    }

    return () => {
      disposed = true;
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      runtime?.dispose();
    };
  }, [failed, finePointer, reducedMotion, webglSupported]);

  // Touch-first devices do not render an invisible, continuously animated
  // canvas. They retain the same CSS fallback without a background RAF.
  if (!webglSupported || reducedMotion || !finePointer || failed) return null;

  return (
    <div ref={hostRef} className={`liquid-backdrop ${className ?? ""}`} aria-hidden="true">
      <div className="liquid-backdrop__veil" />
      <canvas className={`liquid-backdrop__canvas ${ready ? "is-ready" : ""}`} aria-hidden="true" />
    </div>
  );
}

function mountBackdrop(
  host: HTMLDivElement,
  initialTheme: ThemeMode,
  callbacks: { onError: (error: unknown) => void; onReady: () => void },
): BackdropRuntime {
  const canvas = host.querySelector<HTMLCanvasElement>(".liquid-backdrop__canvas");
  if (!canvas) throw new Error("Backdrop canvas is unavailable.");
  const backdropCanvas = canvas;

  // Aurora uses GLSL ES 3.00, so avoid OGL's WebGL1 fallback entirely. This
  // also lets the component fail cleanly before OGL attempts a bad draw.
  const webglAttributes: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  };
  if (!backdropCanvas.getContext("webgl2", webglAttributes)) {
    throw new Error("Glass backdrop requires WebGL2.");
  }

  const renderer = new Renderer({
    alpha: true,
    antialias: false,
    autoClear: false,
    canvas,
    depth: false,
    dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    powerPreference: "low-power",
    premultipliedAlpha: true,
    webgl: 2,
  });
  const gl = renderer.gl as OGLRenderingContext;
  if (!renderer.isWebgl2) {
    throw new Error("Glass backdrop requires WebGL2.");
  }

  gl.clearColor(0, 0, 0, 0);
  const initialPalette = BACKDROP_PALETTES[initialTheme];
  const auroraProgram = new Program(gl, {
    vertex: AURORA_VERT,
    fragment: AURORA_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uAmplitude: { value: 0.46 },
      uBlend: { value: 0.18 },
      uColorStops: { value: initialPalette.aurora.map((color) => [...color]) },
      uResolution: { value: new Float32Array([canvas.width, canvas.height]) },
    },
    transparent: true,
    depthTest: false,
  });
  const liquidProgram = new Program(gl, {
    vertex: LIQUID_CHROME_VERT,
    fragment: LIQUID_CHROME_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uResolution: {
        value: new Float32Array([canvas.width, canvas.height, canvas.width / Math.max(canvas.height, 1)]),
      },
      uBaseColor: { value: new Float32Array(initialPalette.liquid) },
      uAmplitude: { value: 0.16 },
      uFrequencyX: { value: 2.1 },
      uFrequencyY: { value: 1.8 },
      uMouse: { value: new Float32Array([0.5, 0.5]) },
    },
    transparent: true,
    depthTest: false,
  });

  assertProgramLinked(gl, auroraProgram, "aurora");
  assertProgramLinked(gl, liquidProgram, "liquid");

  const geometry = new Triangle(gl);
  const auroraMesh = new Mesh(gl, { geometry, program: auroraProgram });
  const liquidMesh = new Mesh(gl, { geometry, program: liquidProgram });

  const handleResize = () => {
    const width = Math.max(1, host.clientWidth || window.innerWidth);
    const height = Math.max(1, host.clientHeight || window.innerHeight);
    renderer.setSize(width, height);

    const auroraResolution = auroraProgram.uniforms.uResolution.value as Float32Array;
    auroraResolution[0] = canvas.width;
    auroraResolution[1] = canvas.height;

    const liquidResolution = liquidProgram.uniforms.uResolution.value as Float32Array;
    liquidResolution[0] = canvas.width;
    liquidResolution[1] = canvas.height;
    liquidResolution[2] = canvas.width / Math.max(canvas.height, 1);
  };
  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(handleResize) : null;
  window.addEventListener("resize", handleResize);
  resizeObserver?.observe(host);
  handleResize();

  const handlePointer = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const mouse = liquidProgram.uniforms.uMouse.value as Float32Array;
    mouse[0] = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    mouse[1] = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  };
  window.addEventListener("pointermove", handlePointer, { passive: true });

  let frameId: number | null = null;
  let disposed = false;
  let hasFailed = false;
  let hasPainted = false;
  let isRunning = false;

  function stop() {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = null;
    isRunning = false;
  }

  function dispose(releaseResources = true) {
    if (disposed) return;
    disposed = true;
    stop();
    window.removeEventListener("resize", handleResize);
    resizeObserver?.disconnect();
    window.removeEventListener("pointermove", handlePointer);
    document.removeEventListener("visibilitychange", onVisibility);
    backdropCanvas.removeEventListener("webglcontextlost", onContextLost);

    if (releaseResources && !gl.isContextLost()) {
      auroraProgram.remove();
      liquidProgram.remove();
      geometry.remove();
    }
  }

  function fail(error: unknown, releaseResources = true) {
    if (disposed || hasFailed) return;
    hasFailed = true;
    dispose(releaseResources);
    callbacks.onError(error);
  }

  function render(time: number) {
    frameId = null;
    if (disposed || document.hidden) {
      isRunning = false;
      return;
    }

    try {
      const elapsed = time * 0.001;
      auroraProgram.uniforms.uTime.value = elapsed * 0.12;
      liquidProgram.uniforms.uTime.value = elapsed * 0.18;

      // Both transparent layers share one cleared buffer. The second pass
      // intentionally skips clearing so it composites over the liquid layer.
      renderer.render({ scene: liquidMesh, clear: true });
      renderer.render({ scene: auroraMesh, clear: false });

      const errorCode = gl.getError();
      if (errorCode !== gl.NO_ERROR) {
        throw new Error(`WebGL render error (${errorCode}).`);
      }

      if (!hasPainted) {
        hasPainted = true;
        callbacks.onReady();
      }
      frameId = window.requestAnimationFrame(render);
    } catch (error) {
      fail(error);
    }
  }

  function start() {
    if (disposed || isRunning || document.hidden) return;
    isRunning = true;
    frameId = window.requestAnimationFrame(render);
  }

  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  function onContextLost(event: Event) {
    event.preventDefault();
    fail(new Error("WebGL context was lost."), false);
  }

  document.addEventListener("visibilitychange", onVisibility);
  backdropCanvas.addEventListener("webglcontextlost", onContextLost);
  start();

  return {
    dispose,
    setTheme: (theme) => {
      const palette = BACKDROP_PALETTES[theme];
      const liquid = liquidProgram.uniforms.uBaseColor.value as Float32Array;
      liquid.set(palette.liquid);

      const aurora = auroraProgram.uniforms.uColorStops.value as number[][];
      palette.aurora.forEach((color, index) => {
        aurora[index][0] = color[0];
        aurora[index][1] = color[1];
        aurora[index][2] = color[2];
      });
    },
  };
}

function assertProgramLinked(gl: OGLRenderingContext, program: Program, name: string) {
  if (gl.getProgramParameter(program.program, gl.LINK_STATUS)) return;
  throw new Error(`${name} shader failed to link: ${gl.getProgramInfoLog(program.program) ?? "unknown error"}`);
}
