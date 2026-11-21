export type ThemeChoice = "light" | "dark" | "system";
export const THEME_COOKIE = "iica_theme";

export function parseTheme(raw: string | undefined): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}
