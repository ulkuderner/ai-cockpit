/**
 * @file theme.ts
 * @description Theme preference (system / light / dark) stored in localStorage and applied as
 * `data-theme` on <html>. The inline script in index.html applies it before first paint.
 */
import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";
export const THEME_KEY = "ai-cockpit-theme";
export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** matchMedia is absent in some environments (jsdom); treat that as dark. */
function mql(): MediaQueryList | null {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;
}

function apply(mode: ThemeMode): void {
  const light = mode === "light" || (mode === "system" && Boolean(mql()?.matches));
  document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
}

/** Current theme mode plus a setter that persists and applies it; follows OS changes in system mode. */
export function useTheme(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setModeState] = useState<ThemeMode>(readMode);

  useEffect(() => {
    apply(mode);
    if (mode !== "system") return;
    const mq = mql();
    if (!mq) return;
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  // Keep multiple mounted selectors (sidebar, settings) and other tabs in sync.
  useEffect(() => {
    const sync = () => setModeState(readMode());
    window.addEventListener("storage", sync);
    window.addEventListener("ai-cockpit-theme", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("ai-cockpit-theme", sync);
    };
  }, []);

  const setMode = (next: ThemeMode) => {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
    setModeState(next);
    window.dispatchEvent(new Event("ai-cockpit-theme"));
  };
  return [mode, setMode];
}
