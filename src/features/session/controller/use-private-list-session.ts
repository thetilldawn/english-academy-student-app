"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { announceAdminPrivateCacheChange, subscribeAdminPrivateCacheChanges } from "./admin-private-cache-events";

type SessionCache = {
  readonly blocked: boolean;
  readonly revision: number;
  subscribe: (listener: () => void) => () => void;
  lock: () => void;
  invalidate: () => void;
  cancelRequests: () => void;
};

export function usePrivateListSession<Cache extends SessionCache>(cache: Cache) {
  // The protected layout's main page owns the list. Opening @detail changes
  // the URL, but must not cancel or re-authorize the still-mounted backdrop.
  const pageKey = JSON.stringify(useSelectedLayoutSegments("children"));
  const [visibility, setVisibility] = useState({ visible: true, epoch: 0 });
  const revision = useSyncExternalStore(cache.subscribe, () => cache.revision, () => 0);
  const notifiedLock = useRef<Cache | null>(null);
  useEffect(() => {
    if (!cache.blocked || notifiedLock.current === cache) return;
    notifiedLock.current = cache;
    // Current access failure also hides any already-open private detail.
    announceAdminPrivateCacheChange("identity");
  }, [cache, revision]);
  const ticket = useMemo(() => ({ pageKey, epoch: visibility.epoch }), [pageKey, visibility.epoch]);
  const refresh = useCallback(() => {
    cache.invalidate();
    setVisibility(current => ({ ...current, epoch: current.epoch + 1 }));
  }, [cache]);
  useEffect(() => {
    const unsubscribe = subscribeAdminPrivateCacheChanges(kind => {
      if (kind === "identity") cache.lock();
      else refresh();
    });
    const hide = () => { cache.cancelRequests(); setVisibility(current => ({ visible: false, epoch: current.epoch + 1 })); };
    const show = () => setVisibility(current => ({ visible: document.visibilityState !== "hidden", epoch: current.epoch + 1 }));
    const visibilityChanged = () => { if (document.visibilityState === "hidden") hide(); else show(); };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("online", show);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      unsubscribe(); cache.invalidate();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("online", show);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [cache, refresh]);
  useEffect(() => () => cache.cancelRequests(), [cache, pageKey]);
  return useMemo(() => ({ cache, ticket, visible: visibility.visible, revision, refresh }), [cache, ticket, visibility.visible, revision, refresh]);
}
