"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "gold";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const GOLD_CLR: Record<string, string> = {
  "#2563eb": "#5b9fc4",
  "#1d4ed8": "#4a8ab0",
  "#3b82f6": "#5b9fc4",
  "#3498db": "#5b9fc4",
  "#6366f1": "#b8864e",
  "#8b5cf6": "#d4836a",
  "#a855f7": "#d4836a",
  "#a78bfa": "#d4836a",
  "#7c3aed": "#b8864e",
  "#4f46e5": "#a67c1e",
  "#8e44ad": "#d4836a",
  "#9333ea": "#d4836a",
  "#4c1d95": "#8a6518",
  "#06b6d4": "#d4a847",
  "#14b8a6": "#5bb89a",
  "#0ea5e9": "#d4a847",
  "#0891b2": "#5bb89a",
  "#0e7490": "#5bb89a",
  "#0d9488": "#5bb89a",
  "#16a085": "#5bb89a",
  "#f59e0b": "#e6a62e",
  "#d97706": "#e6a62e",
  "#f39c12": "#e6a62e",
  "#f97316": "#d4836a",
  "#ea580c": "#d4836a",
  "#ca8a04": "#c49a2c",
  "#ef4444": "#e07a5f",
  "#dc2626": "#e07a5f",
  "#e74c3c": "#e07a5f",
  "#e11d48": "#e07a5f",
  "#ec4899": "#d4836a",
  "#db2777": "#d4836a",
  "#22c55e": "#4ade80",
  "#16a34a": "#4ade80",
  "#10b981": "#5bb89a",
  "#059669": "#5bb89a",
  "#27ae60": "#4ade80",
  "#6b7280": "#8a847a",
  "#64748b": "#8a847a",
};

const THEME_ACCENT: Record<Theme, { id: string; mine: string }> = {
  light: { id: "#3498db", mine: "#2563eb" },
  gold:  { id: "#d4a847", mine: "#c49a2c" },
};

export function useThemeAccent() {
  const { theme } = useContext(ThemeContext);
  return THEME_ACCENT[theme];
}

export function useThemeRemap() {
  const { theme } = useContext(ThemeContext);
  if (theme === "gold") return (c: string) => GOLD_CLR[c.toLowerCase()] ?? c;
  return (c: string) => c;
}
export const useGoldRemap = useThemeRemap;

function persistTheme(t: Theme) {
  localStorage.setItem("rocks-fast-theme", t);
  document.cookie = `rocks-fast-theme=${t};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("rocks-fast-theme") as Theme | null;
    if (stored === "light" || stored === "gold") {
      setThemeState(stored);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      document.documentElement.setAttribute("data-theme", theme);
      persistTheme(theme);
    }
  }, [theme, mounted]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => prev === "gold" ? "light" : "gold"),
    []
  );

  if (!mounted) {
    return <div style={{ visibility: "hidden" }}>{children}</div>;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
