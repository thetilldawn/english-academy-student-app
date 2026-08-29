"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import type { NavigationContinuation } from "@/components/navigation-exit-guard";
import {
  RouteDetailDialog,
  type RouteDetailDialogProps,
} from "@/design-system/patterns/route-detail-dialog/route-detail-dialog";

type RoutedDetailDialogProps = Omit<RouteDetailDialogProps, "onRequestClose"> & {
  routeCloseGuard?: (closeRoute: NavigationContinuation) => boolean | void;
};

/** App Router navigation adapter for the route-agnostic dialog pattern. */
export function RoutedDetailDialog({
  routeCloseGuard,
  ...props
}: RoutedDetailDialogProps) {
  const router = useRouter();
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (routeCloseGuard) {
      const accepted = routeCloseGuard(() => router.back());
      if (accepted !== false) closingRef.current = true;
      return;
    }
    closingRef.current = true;
    router.back();
  }, [routeCloseGuard, router]);

  return <RouteDetailDialog {...props} onRequestClose={requestClose} />;
}
