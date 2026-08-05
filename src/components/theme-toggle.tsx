"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "english-academy-theme";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

function subscribeTheme(listener: () => void) {
  window.addEventListener("english-academy-theme-change", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("english-academy-theme-change", listener);
    window.removeEventListener("storage", listener);
  };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => "light",
  );

  function toggleTheme() {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    window.dispatchEvent(new Event("english-academy-theme-change"));
  }

  const dark = theme === "dark";
  return (
    <button
      aria-checked={dark}
      aria-label="다크 모드"
      className={["theme-toggle", className].filter(Boolean).join(" ")}
      onClick={toggleTheme}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle-track">
        <span className="theme-toggle-thumb" />
      </span>
      <span className="theme-toggle-label">다크</span>
    </button>
  );
}
