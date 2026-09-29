"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { navigateDocument } from "@/components/document-navigation";
import { requestAdminLogout } from "./admin-session-commands";
import { requestStudentLogout } from "../api/session";
type LogoutState = "idle" | "pending" | "failed" | "leaving";
export type LogoutTransition = { state: LogoutState; logout: () => Promise<boolean> };
export const LogoutContext = createContext<LogoutTransition | null>(null);
export function useLogoutTransition(role: "admin" | "student"): LogoutTransition {
  const [state, setState] = useState<LogoutState>("idle");
  const inFlight = useRef<Promise<boolean> | null>(null);
  const leaving = useRef(false);
  const logout = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    if (leaving.current) return Promise.resolve(true);
    // Logout is an explicit event/guard continuation, not an effect. Commit the
    // privacy boundary before the synchronous cache identity broadcast can render
    // an authentication error in the old subtree.
    flushSync(() => setState("pending"));
    // Set the shared request lock before starting the asynchronous transport.
    const request = Promise.resolve().then(async () => {
      try {
        const ok = await (role === "admin" ? requestAdminLogout() : requestStudentLogout());
        if (!ok) { setState("failed"); return false; }
        leaving.current = true;
        setState("leaving");
        navigateDocument("/", true);
        return true;
      } catch {
        leaving.current = false;
        setState("failed");
        return false;
      } finally { inFlight.current = null; }
    });
    inFlight.current = request;
    return request;
  }, [role]);
  return { state, logout };
}
export function useSessionLogout() {
  const value = useContext(LogoutContext);
  if (!value) throw new Error("SessionLogoutBoundary is required");
  return value;
}
