"use client";

import React, { createContext, useContext } from "react";
import { useTheme } from "@/components/ThemeProvider";

type Mode = "light" | "dark";

interface Ctx {
  mode: Mode;
}

const MasterThemeContext = createContext<Ctx>({ mode: "light" });

/**
 * Master Dashboard light/dark mode is driven by the app-wide theme toggle
 * in the navbar (RocksFast ThemeProvider — light | gold). There is no
 * separate dashboard toggle: when the app theme is "gold" (its dark mode)
 * the Master Dashboard renders the Dashboard-project dark palette; "light"
 * renders the light palette. The `.master-scope` div sets data-master-mode
 * so the scoped CSS variables resolve accordingly.
 */
export function MasterThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const mode: Mode = theme === "gold" ? "dark" : "light";

  return (
    <MasterThemeContext.Provider value={{ mode }}>
      <div className="master-scope" data-master-mode={mode}>
        {children}
      </div>
    </MasterThemeContext.Provider>
  );
}

export function useMasterTheme() {
  return useContext(MasterThemeContext);
}
