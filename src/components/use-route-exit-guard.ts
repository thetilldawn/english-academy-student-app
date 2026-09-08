"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";

import {
  useNavigationExitGuardRegistration,
  type NavigationContinuation,
} from "@/components/navigation-exit-guard";
import { useUnsavedChangesWarning } from "@/lib/ui/use-unsaved-changes-warning";
import { useConfirmation } from "@/design-system/patterns/confirmation/confirmation";

const HISTORY_BASE_KEY = "__routeExitGuardBase";
const HISTORY_SENTINEL_KEY = "__routeExitGuardSentinel";

type HistoryRecord = Record<string, unknown>;

function historyRecord(state: unknown): HistoryRecord {
  return typeof state === "object" && state !== null
    ? { ...(state as HistoryRecord) }
    : {};
}

function withoutGuardMarkers(state: unknown) {
  const next = historyRecord(state);
  delete next[HISTORY_BASE_KEY];
  delete next[HISTORY_SENTINEL_KEY];
  return next;
}

function ownsBase(state: unknown, guardId: string) {
  return historyRecord(state)[HISTORY_BASE_KEY] === guardId;
}

function ownsSentinel(state: unknown, guardId: string) {
  return historyRecord(state)[HISTORY_SENTINEL_KEY] === guardId;
}

function ownsExactBase(state: unknown, guardId: string) {
  return ownsBase(state, guardId) && !ownsSentinel(state, guardId);
}

function internalAnchorFromEvent(event: MouseEvent) {
  if (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return null;
  }
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.download || (anchor.target && anchor.target !== "_self")) {
    return null;
  }
  const destination = new URL(anchor.href, window.location.href);
  if (destination.origin !== window.location.origin) return null;
  return {
    destination,
    hashOnly:
      destination.pathname === window.location.pathname &&
      destination.search === window.location.search,
  };
}

function moveToHashWithoutAddingHistory(destination: URL) {
  window.history.replaceState(window.history.state, "", destination.href);
  const rawId = destination.hash.slice(1);
  if (!rawId) return;
  const target = document.getElementById(decodeURIComponent(rawId));
  target?.scrollIntoView();
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
}

function isSameDocument(firstHref: string, secondHref: string) {
  const first = new URL(firstHref, window.location.href);
  const second = new URL(secondHref, window.location.href);
  return (
    first.origin === second.origin &&
    first.pathname === second.pathname &&
    first.search === second.search
  );
}

export type RouteExitGuard = {
  canExit: () => Promise<boolean>;
  forceExit: (continueNavigation: NavigationContinuation) => boolean;
  requestExit: (continueNavigation: NavigationContinuation) => boolean;
};

/**
 * Protects an editor consistently across Next links, route-dialog close,
 * browser Back, refresh, and document exit.
 */
export function useRouteExitGuard({
  busy,
  confirmMessage,
  dirty,
  idPrefix,
}: {
  busy: boolean;
  confirmMessage: string;
  dirty: boolean;
  idPrefix: string;
}): RouteExitGuard {
  const reactId = useId();
  const guardId = `${idPrefix}-${reactId}`;
  const confirm = useConfirmation(guardId);
  const confirmationRef = useRef<AbortController | null>(null);
  const decisionVersionRef = useRef(0);
  const restoreBackStepsRef = useRef<number | null>(null);
  const active = busy || dirty;
  const activeRef = useRef(active);
  const busyRef = useRef(busy);
  const dirtyRef = useRef(dirty);
  const desiredActiveRef = useRef(active);
  const mountedRef = useRef(false);
  const sentinelRef = useRef(false);
  const awaitingBaseRef = useRef(false);
  const browserBackApprovedRef = useRef(false);
  const restoringUnexpectedPopRef = useRef(false);
  const exitInProgressRef = useRef(false);
  const protectedHrefRef = useRef("");
  const pendingExitRef = useRef<NavigationContinuation | null>(null);
  const exitAfterRestorationRef = useRef<NavigationContinuation | null>(null);

  useUnsavedChangesWarning(active, activeRef);

  const pushSentinel = useCallback(() => {
    const href = protectedHrefRef.current || window.location.href;
    const baseState = {
      ...withoutGuardMarkers(window.history.state),
      [HISTORY_BASE_KEY]: guardId,
    };
    window.history.replaceState(baseState, "", href);
    window.history.pushState(
      { ...baseState, [HISTORY_SENTINEL_KEY]: guardId },
      "",
      href,
    );
    sentinelRef.current = true;
  }, [guardId]);

  const restoreAfterFailedContinuation = useCallback(() => {
    pendingExitRef.current = null;
    awaitingBaseRef.current = false;
    browserBackApprovedRef.current = false;
    restoringUnexpectedPopRef.current = false;
    exitInProgressRef.current = false;
    const shouldRearm =
      mountedRef.current &&
      desiredActiveRef.current &&
      isSameDocument(protectedHrefRef.current, window.location.href);
    activeRef.current = shouldRearm;
    if (!shouldRearm) return;
    pushSentinel();
  }, [pushSentinel]);

  const runContinuation = useCallback((continuation: NavigationContinuation) => {
    let result: boolean | void | Promise<boolean | void>;
    try {
      result = continuation();
    } catch {
      restoreAfterFailedContinuation();
      return;
    }
    void Promise.resolve(result).then((completed) => {
      if (completed === false) restoreAfterFailedContinuation();
    }, restoreAfterFailedContinuation);
  }, [restoreAfterFailedContinuation]);

  const canExit = useCallback(async () => {
    if (exitInProgressRef.current || busyRef.current || confirmationRef.current) return false;
    if (!dirtyRef.current) return true;
    const request = new AbortController();
    confirmationRef.current = request;
    try {
      const accepted = await confirm({ title: "작성을 그만둘까요?", message: confirmMessage, confirmLabel: "그만두기", signal: request.signal });
      return accepted && !request.signal.aborted && mountedRef.current && !busyRef.current;
    } finally {
      if (confirmationRef.current === request) confirmationRef.current = null;
    }
  }, [confirm, confirmMessage]);

  const forceExit = useCallback((continuation: NavigationContinuation) => {
    if (restoringUnexpectedPopRef.current) {
      if (exitAfterRestorationRef.current) return false;
      confirmationRef.current?.abort();
      exitAfterRestorationRef.current = continuation;
      return true;
    }
    if (exitInProgressRef.current) return false;
    confirmationRef.current?.abort();
    exitInProgressRef.current = true;
    activeRef.current = false;
    if (!sentinelRef.current) {
      runContinuation(continuation);
      return true;
    }
    pendingExitRef.current = continuation;
    sentinelRef.current = false;
    awaitingBaseRef.current = true;
    window.history.back();
    return true;
  }, [runContinuation]);

  const requestExit = useCallback((continuation: NavigationContinuation) => {
    if (exitInProgressRef.current || busyRef.current || confirmationRef.current) return false;
    if (!dirtyRef.current) return forceExit(continuation);
    const version = decisionVersionRef.current;
    const stillAllowed = () => mountedRef.current && !busyRef.current && decisionVersionRef.current === version;
    void canExit().then(accepted => {
      if (accepted && stillAllowed()) forceExit(() => stillAllowed() ? continuation() : false);
    });
    // Synchronous interception, not approval. The continuation runs only after approval.
    return true;
  }, [canExit, forceExit]);

  useNavigationExitGuardRegistration({
    active,
    id: guardId,
    requestExit,
  });

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      decisionVersionRef.current += 1;
      confirmationRef.current?.abort();
    };
  }, []);

  useLayoutEffect(() => {
    decisionVersionRef.current += 1;
    busyRef.current = busy;
    dirtyRef.current = dirty;
    desiredActiveRef.current = active;
    if (!dirty || busy) confirmationRef.current?.abort();
    if (!exitInProgressRef.current) activeRef.current = active;
    if (active) {
      if (!sentinelRef.current && !exitInProgressRef.current) {
        protectedHrefRef.current = window.location.href;
        pushSentinel();
      }
      return;
    }
    activeRef.current = false;
    if (sentinelRef.current && !exitInProgressRef.current) {
      exitInProgressRef.current = true;
      sentinelRef.current = false;
      awaitingBaseRef.current = true;
      pendingExitRef.current = null;
      window.history.back();
      return;
    }
    if (!awaitingBaseRef.current) {
      exitInProgressRef.current = false;
      const current = window.history.state;
      if (ownsBase(current, guardId) || ownsSentinel(current, guardId)) {
        window.history.replaceState(
          withoutGuardMarkers(current),
          "",
          window.location.href,
        );
      }
    }
  }, [active, busy, dirty, guardId, pushSentinel]);

  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      if (browserBackApprovedRef.current) {
        browserBackApprovedRef.current = false;
        return;
      }

      if (restoringUnexpectedPopRef.current) {
        event.stopImmediatePropagation();
        if (ownsSentinel(event.state, guardId)) {
          restoringUnexpectedPopRef.current = false;
          sentinelRef.current = true;
          exitInProgressRef.current = false;
          const steps = restoreBackStepsRef.current;
          restoreBackStepsRef.current = null;
          const afterRestoration = exitAfterRestorationRef.current;
          exitAfterRestorationRef.current = null;
          if (afterRestoration) {
            forceExit(afterRestoration);
            return;
          }
          if (steps !== null && !busyRef.current) requestExit(() => {
            browserBackApprovedRef.current = true;
            window.history.go(-Math.max(1, steps - 1));
          });
          return;
        }
        if (restoreBackStepsRef.current !== null) restoreBackStepsRef.current += 1;
        window.history.forward();
        return;
      }

      if (awaitingBaseRef.current) {
        event.stopImmediatePropagation();
        awaitingBaseRef.current = false;
        const pendingExit = pendingExitRef.current;
        pendingExitRef.current = null;
        if (!ownsExactBase(event.state, guardId)) {
          activeRef.current = desiredActiveRef.current;
          if (desiredActiveRef.current) {
            restoringUnexpectedPopRef.current = true;
            window.history.forward();
          } else {
            exitInProgressRef.current = false;
          }
          return;
        }
        if (pendingExit) {
          queueMicrotask(() => runContinuation(pendingExit));
        } else {
          exitInProgressRef.current = false;
          const current = window.history.state;
          if (ownsBase(current, guardId)) {
            window.history.replaceState(
              withoutGuardMarkers(current),
              "",
              window.location.href,
            );
          }
        }
        return;
      }

      if (!activeRef.current) {
        if (ownsSentinel(event.state, guardId)) {
          window.history.replaceState(
            withoutGuardMarkers(event.state),
            "",
            window.location.href,
          );
          window.history.back();
        }
        return;
      }

      if (ownsSentinel(event.state, guardId)) {
        event.stopImmediatePropagation();
        sentinelRef.current = true;
        return;
      }

      sentinelRef.current = false;
      // Restore before asking: otherwise Next's popstate handler unmounts the editor.
      event.stopImmediatePropagation();
      const expectedBase = ownsExactBase(event.state, guardId);
      if (expectedBase) {
        pushSentinel();
        if (!busyRef.current) requestExit(() => {
          browserBackApprovedRef.current = true;
          window.history.back();
        });
      } else {
        restoreBackStepsRef.current = 1;
        restoringUnexpectedPopRef.current = true;
        exitInProgressRef.current = true;
        window.history.forward();
      }
    }

    function handleDocumentClick(event: MouseEvent) {
      const link = internalAnchorFromEvent(event);
      if (!link?.hashOnly) return;
      if (exitInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!activeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      protectedHrefRef.current = link.destination.href;
      moveToHashWithoutAddingHistory(link.destination);
    }

    window.addEventListener("popstate", handlePopState, true);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("popstate", handlePopState, true);
      document.removeEventListener("click", handleDocumentClick, true);
      const current = window.history.state;
      if (ownsBase(current, guardId) || ownsSentinel(current, guardId)) {
        window.history.replaceState(
          withoutGuardMarkers(current),
          "",
          window.location.href,
        );
      }
    };
  }, [forceExit, guardId, pushSentinel, requestExit, runContinuation]);

  return { canExit, forceExit, requestExit };
}
