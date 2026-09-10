export const THEME_STORAGE_KEY = "jarvi-rh-theme";

export const APP_THEMES = ["light", "dark"] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.includes(value as AppTheme);
}

export function resolveStoredTheme(
  storedValue: unknown,
  fallback: AppTheme = "light"
): AppTheme {
  return isAppTheme(storedValue) ? storedValue : fallback;
}

export function oppositeTheme(theme: AppTheme): AppTheme {
  return theme === "light" ? "dark" : "light";
}
