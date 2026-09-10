import {
  oppositeTheme,
  resolveStoredTheme,
  THEME_STORAGE_KEY,
  type AppTheme,
} from "@shared/theme";
import React, { createContext, useContext, useEffect, useState } from "react";

interface ThemeContextType {
  theme: AppTheme;
  toggleTheme: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: AppTheme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = true,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (!switchable || typeof window === "undefined") return defaultTheme;
    try {
      return resolveStoredTheme(
        window.localStorage.getItem(THEME_STORAGE_KEY),
        defaultTheme
      );
    } catch {
      return defaultTheme;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#101b2b" : "#f7f4ed");

    if (switchable) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // El tema sigue activo durante la sesión si el navegador bloquea storage.
      }
    }
  }, [theme, switchable]);

  const toggleTheme = () => {
    if (switchable) setTheme(previous => oppositeTheme(previous));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
