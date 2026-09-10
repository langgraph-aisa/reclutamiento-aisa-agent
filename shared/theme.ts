export const THEME_STORAGE_KEY = "jarvi-rh-theme";

export const APP_THEMES = ["light", "dark", "high-contrast"] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export const APP_THEME_LABELS: Record<AppTheme, string> = {
  light: "Día",
  dark: "Oscuro atenuado",
  "high-contrast": "Oscuro de alto contraste",
};

export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.includes(value as AppTheme);
}

export function resolveStoredTheme(
  storedValue: unknown,
  fallback: AppTheme = "light"
): AppTheme {
  return isAppTheme(storedValue) ? storedValue : fallback;
}

export function nextAppTheme(theme: AppTheme): AppTheme {
  const currentIndex = APP_THEMES.indexOf(theme);
  return APP_THEMES[(currentIndex + 1) % APP_THEMES.length];
}
