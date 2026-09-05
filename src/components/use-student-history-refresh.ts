"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

function shouldRefresh(pathname: string) {
  return pathname.startsWith("/student") &&
    !pathname.startsWith("/student/attempt/");
}

// Back/forward can restore an old RSC summary. Ordinary navigation does not
// refresh the whole route, and a running quiz must never be refreshed here.
export function useStudentHistoryRefresh(pathname: string) {
  const router = useRouter();
  const pendingPath = useRef<string | null>(null);

  useEffect(() => {
    const onPopState = () => {
      const destination = window.location.pathname;
      // Closing a study modal must keep the underlying completed-list page and
      // its loaded items. Studying words does not mutate the point ledger.
      if (/^\/student\/assignments\/[^/]+\/words\/?$/.test(pathname)) {
        pendingPath.current = null;
        return;
      }
      pendingPath.current = shouldRefresh(destination) ? destination : null;
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && shouldRefresh(window.location.pathname)) {
        pendingPath.current = null;
        router.refresh();
      }
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pathname, router]);

  useEffect(() => {
    if (pendingPath.current !== pathname) return;
    pendingPath.current = null;
    router.refresh();
  }, [pathname, router]);
}
