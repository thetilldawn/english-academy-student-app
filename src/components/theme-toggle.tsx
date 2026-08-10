"use client";

import { useSyncExternalStore } from "react";
import { adminShellText } from "@/content/ko/admin-shell";

import styles from "./theme-toggle.module.css";

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

export function ThemeToggle({
  placement = "inline",
}: {
  placement?: "auth" | "inline";
}) {
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
      className={[styles.root, placement === "auth" ? styles.auth : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={toggleTheme}
      role="switch"
      title={actionLabel}
      type="button"
    >
      <span aria-hidden="true" className={styles.track}>
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
