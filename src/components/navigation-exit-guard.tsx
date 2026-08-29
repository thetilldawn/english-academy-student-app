"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export type NavigationContinuation = () =>
  | boolean
  | void
  | Promise<boolean | void>;

export type ExitRequest = (
  continueNavigation: NavigationContinuation,
) => boolean;

type NavigationExitGuardContextValue = {
  register: (id: string, requestExit: ExitRequest) => () => void;
  requestNavigation: (continueNavigation: NavigationContinuation) => boolean;
};

const NavigationExitGuardContext =
  createContext<NavigationExitGuardContextValue | null>(null);

/** Shares the active editor's exit request with links in the surrounding shell. */
export function NavigationExitGuardProvider({ children }: { children: ReactNode }) {
  const guardsRef = useRef(new Map<string, ExitRequest>());

  const register = useCallback((id: string, requestExit: ExitRequest) => {
    guardsRef.current.delete(id);
    guardsRef.current.set(id, requestExit);
    return () => {
      if (guardsRef.current.get(id) === requestExit) guardsRef.current.delete(id);
    };
  }, []);

  const requestNavigation = useCallback((continueNavigation: NavigationContinuation) => {
    const activeGuard = Array.from(guardsRef.current.values()).at(-1);
    if (!activeGuard) return false;
    activeGuard(continueNavigation);
    return true;
  }, []);

  const value = useMemo(
    () => ({ register, requestNavigation }),
    [register, requestNavigation],
  );

  return (
    <NavigationExitGuardContext.Provider value={value}>
      {children}
    </NavigationExitGuardContext.Provider>
  );
}

export function useNavigationExitGuardRegistration({
  active,
  id,
  requestExit,
}: {
  active: boolean;
  id: string;
  requestExit: ExitRequest;
}) {
  const context = useContext(NavigationExitGuardContext);
  useEffect(() => {
    if (!active || !context) return;
    return context.register(id, requestExit);
  }, [active, context, id, requestExit]);
}

export function useGuardedNavigationRequest() {
  const context = useContext(NavigationExitGuardContext);
  return useCallback(
    (continueNavigation: NavigationContinuation) =>
      context?.requestNavigation(continueNavigation) ?? false,
    [context],
  );
}
