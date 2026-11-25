"use client";

import { useLayoutEffect, useState } from "react";
import { applyTheme, toggleTheme } from "@/lib/theme";

export default function ThemeButton({ className, activeClassName }: { className?: string; activeClassName?: string }) {
  const [dark, setDark] = useState(false);
  useLayoutEffect(() => {
    const saved = localStorage.getItem("fleet.theme") === "dark" ? "dark" : "light";
    applyTheme(saved);
    setDark(saved === "dark");
  }, []);

  return (
    <button
      type="button"
      className={[className, dark ? activeClassName : ""].filter(Boolean).join(" ") || undefined}
      title={dark ? "Светлая тема" : "Тёмная тема"}
      aria-pressed={dark}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setDark(toggleTheme() === "dark")}
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}
