"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { subscribeAdminPrivateCacheChanges } from "./admin-private-cache-events";

type SessionCache = {
  readonly revision: number;
  subscribe: (listener: () => void) => () => void;
  lock: () => void;
  invalidate: () => void;
  cancelRequests: () => void;
};

export function usePrivateListSession<Cache extends SessionCache>(cache: Cache) {
  const pathname = usePathname();
  const [visibility, setVisibility] = useState({ visible: true, epoch: 0 });
  const revision = useSyncExternalStore(cache.subscribe, () => cache.revision, () => 0);
  const ticket = useMemo(() => ({ pathname, epoch: visibility.epoch }), [pathname, visibility.epoch]);
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
  useEffect(() => () => cache.cancelRequests(), [cache, pathname]);
  return useMemo(() => ({ cache, ticket, visible: visibility.visible, revision, refresh }), [cache, ticket, visibility.visible, revision, refresh]);
}
