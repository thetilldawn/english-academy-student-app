"use client";

import { useEffect } from "react";

/** Uses the browser's native warning for refresh, tab close, and document exit. */
export function useUnsavedChangesWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [active]);
}
