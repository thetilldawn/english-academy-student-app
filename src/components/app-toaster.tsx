"use client";

import { useSyncExternalStore } from "react";
import { Toaster } from "sonner";

type AppTheme = "light" | "dark";

const MOBILE_QUERY = "(max-width: 767px)";

function subscribeMedia(listener: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function isMobileViewport() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function subscribeTheme(listener: () => void) {
  window.addEventListener("english-academy-theme-change", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("english-academy-theme-change", listener);
    window.removeEventListener("storage", listener);
  };
}

function currentTheme(): AppTheme {
  return document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

export function AppToaster() {
  const mobile = useSyncExternalStore(
    subscribeMedia,
    isMobileViewport,
    () => false,
  );
  const theme = useSyncExternalStore<AppTheme>(
    subscribeTheme,
    currentTheme,
    () => "light",
  );

  return (
    <Toaster
      closeButton
      duration={2000}
      position={mobile ? "top-center" : "top-right"}
      richColors={false}
      theme={theme}
      toastOptions={{
        classNames: {
          error: "app-sonner-toast app-sonner-toast-error",
          success: "app-sonner-toast app-sonner-toast-success",
          toast: "app-sonner-toast",
        },
      }}
      visibleToasts={3}
    />
  );
}
