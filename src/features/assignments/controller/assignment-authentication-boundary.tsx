"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ReactNode } from "react";

const Context = createContext<(() => void) | undefined>(undefined);

// Assignment controllers report current failures; the owning cache decides what to erase.
export function AssignmentAuthenticationBoundary({ onFailure, children }: { onFailure?: () => void; children: ReactNode }) {
  return <Context.Provider value={onFailure}>{children}</Context.Provider>;
}

export function useAssignmentAuthenticationFailure() {
  const onFailure = useContext(Context);
  const lifetime = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    lifetime.current = Symbol();
    return () => { lifetime.current = null; };
  }, [onFailure]);
  // Capture at request start, including non-cancellable saves. An old screen's
  // response must not lock a new screen (or a Strict Mode effect remount).
  return useCallback(() => {
    const startedIn = lifetime.current;
    return (error: unknown) => {
      if (!startedIn || lifetime.current !== startedIn || !error || typeof error !== "object") return;
      if (("status" in error && (error.status === 401 || error.status === 403)) ||
          ("kind" in error && (error.kind === "unauthorized" || error.kind === "forbidden"))) onFailure?.();
    };
  }, [onFailure]);
}
