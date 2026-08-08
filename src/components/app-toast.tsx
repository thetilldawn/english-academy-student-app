"use client";

import { useEffect, useRef } from "react";
import { commonText } from "@/content/ko/common";

export type AppToastMessage = {
  id: number;
  text: string;
  tone?: "success" | "error";
};

export function AppToast({
  message,
  onDismiss,
}: {
  message: AppToastMessage | null;
  onDismiss: () => void;
}) {
  const toastRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toast = toastRef.current;
    if (!toast || !message) return;
    if (!toast.matches(":popover-open")) toast.showPopover();
    const timeoutId = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(timeoutId);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      className="app-toast"
      data-tone={message.tone ?? "success"}
      popover="manual"
      ref={toastRef}
      role={message.tone === "error" ? "alert" : "status"}
    >
      <span>{message.text}</span>
      <button
        aria-label={commonText.closeNotification}
        className="app-toast-close"
        onClick={onDismiss}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
