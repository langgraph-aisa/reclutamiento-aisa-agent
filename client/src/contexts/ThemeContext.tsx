import {
  nextAppTheme,
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
    const usesDarkCanvas = theme !== "light";
    root.classList.toggle("dark", usesDarkCanvas);
    root.classList.toggle("high-contrast", theme === "high-contrast");
    root.dataset.theme = theme;
    root.style.colorScheme = usesDarkCanvas ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        theme === "light" ? "#f7f4ed" : theme === "dark" ? "#0B1118" : "#000000"
      );

    if (switchable) {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // El tema sigue activo durante la sesión si el navegador bloquea storage.
      }
    }
  }, [theme, switchable]);

  const toggleTheme = () => {
    if (switchable) setTheme(previous => nextAppTheme(previous));
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
