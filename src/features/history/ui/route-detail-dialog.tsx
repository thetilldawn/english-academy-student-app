"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, type ReactNode } from "react";

import {
  DialogBody,
  DialogFrame,
  DialogHeader,
  type DialogLayout,
} from "@/design-system/primitives/dialog/dialog";
import { adminHistoryText } from "@/content/ko/admin-history";

export function RouteDetailDialog({
  beforeRouteClose,
  children,
  closeDisabled = false,
  contentMode = "body",
  heading,
  headerActions,
  layout = "body",
  size = "wide",
  height,
}: {
  beforeRouteClose?: () => boolean;
  children: ReactNode;
  closeDisabled?: boolean;
  contentMode?: "body" | "structured";
  heading: ReactNode;
  headerActions?: ReactNode;
  layout?: DialogLayout;
  size?: "wide" | "extra-wide";
  height?: "large";
}) {
  const router = useRouter();
  const closingRef = useRef(false);

  const closeRoute = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    router.back();
  }, [router]);
  const close = useCallback(() => {
    if (beforeRouteClose && !beforeRouteClose()) return;
    closeRoute();
  }, [beforeRouteClose, closeRoute]);

  return (
    <DialogFrame
      aria-labelledby="route-history-detail-title"
      closeDisabled={closeDisabled}
      height={height}
      layout={layout}
      onRequestClose={close}
      size={size}
    >
      <DialogHeader
        actions={headerActions}
        closeLabel={adminHistoryText.detailModal.close}
      >
        {heading}
      </DialogHeader>
      {contentMode === "structured" ? children : <DialogBody>{children}</DialogBody>}
    </DialogFrame>
  );
}
