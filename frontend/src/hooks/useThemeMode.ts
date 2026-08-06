import { useEffect, useState } from "react";

/**
 * Returns the current theme mode ("light" | "dark") based on the
 * data-theme attribute on <html>. Reactive — updates when the theme is
 * toggled elsewhere in the tree.
 */
export type ThemeMode = "light" | "dark";

export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof document === "undefined") return "light";
    const attr = document.documentElement.getAttribute("data-theme");
    return attr === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const attr = root.getAttribute("data-theme");
      setMode(attr === "dark" ? "dark" : "light");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return mode;
}
