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
  children,
  closeDisabled = false,
  contentMode = "body",
  heading,
  headerActions,
  layout = "body",
  onRequestClose,
  size = "wide",
  height,
}: {
  children: ReactNode;
  closeDisabled?: boolean;
  contentMode?: "body" | "structured";
  heading: ReactNode;
  headerActions?: ReactNode;
  layout?: DialogLayout;
  onRequestClose?: () => void;
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
  const close = onRequestClose ?? closeRoute;

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
