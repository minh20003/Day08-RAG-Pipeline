import { useCallback } from "react";

/**
 * Returns helpers that compute the cursor's angle (in degrees, 0 = up) and
 * distance from an element's center. Extracted from react-bits/BorderGlow.
 */
export function useCursorAngle() {
  const centerOf = useCallback((el: HTMLElement) => {
    const { width, height } = el.getBoundingClientRect();
    return { cx: width / 2, cy: height / 2 };
  }, []);

  const angle = useCallback(
    (el: HTMLElement, clientX: number, clientY: number) => {
      const { cx, cy } = centerOf(el);
      const rect = el.getBoundingClientRect();
      const dx = clientX - rect.left - cx;
      const dy = clientY - rect.top - cy;
      if (dx === 0 && dy === 0) return 0;
      const radians = Math.atan2(dy, dx);
      let degrees = radians * (180 / Math.PI) + 90;
      if (degrees < 0) degrees += 360;
      return degrees;
    },
    [centerOf],
  );

  const edgeProximity = useCallback(
    (el: HTMLElement, clientX: number, clientY: number) => {
      const { cx, cy } = centerOf(el);
      const rect = el.getBoundingClientRect();
      const dx = clientX - rect.left - cx;
      const dy = clientY - rect.top - cy;
      let kx = Number.POSITIVE_INFINITY;
      let ky = Number.POSITIVE_INFINITY;
      if (dx !== 0) kx = cx / Math.abs(dx);
      if (dy !== 0) ky = cy / Math.abs(dy);
      return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    },
    [centerOf],
  );

  return { angle, edgeProximity };
}
