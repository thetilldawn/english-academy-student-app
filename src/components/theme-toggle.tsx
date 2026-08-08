"use client";

import { useSyncExternalStore } from "react";
import { adminShellText } from "@/content/ko/admin-shell";

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
  const actionLabel = dark
    ? adminShellText.theme.toLight
    : adminShellText.theme.toDark;
  return (
    <button
      aria-checked={dark}
      aria-label={adminShellText.theme.ariaLabel}
      className={["theme-toggle", className].filter(Boolean).join(" ")}
      onClick={toggleTheme}
      role="switch"
      title={actionLabel}
      type="button"
    >
      <span aria-hidden="true" className="theme-toggle-track">
        <span className="theme-toggle-thumb" />
      </span>
    </button>
  );
}
