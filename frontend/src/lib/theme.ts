export type Theme = "light" | "dark";

const KEY = "fleet.theme";

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  localStorage.setItem(KEY, theme);
  window.dispatchEvent(new Event("fleet-theme"));
}

export function toggleTheme(): Theme {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
