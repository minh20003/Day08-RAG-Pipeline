import { useEffect, useState } from "react";

/**
 * Detects WebGL support and reports a stable boolean. Used to gate
 * GlassBackdrop so the rest of the app degrades to pure CSS on browsers
 * without a GPU.
 */
export function useWebGLSupport(): boolean {
  const [supported, setSupported] = useState<boolean>(true);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    const ctx =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    setSupported(Boolean(ctx));
  }, []);

  return supported;
}
