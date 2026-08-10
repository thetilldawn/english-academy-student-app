"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useRef,
  type ReactNode,
} from "react";

import {
  DialogBody,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import { adminHistoryText } from "@/content/ko/admin-history";

export function RouteDetailDialog({
  children,
  heading,
}: {
  children: ReactNode;
  heading: ReactNode;
}) {
  const router = useRouter();
  const closingRef = useRef(false);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    router.back();
  }, [router]);

  return (
    <DialogFrame
      aria-labelledby="route-history-detail-title"
      onRequestClose={close}
      size="wide"
    >
      <DialogHeader
        closeLabel={adminHistoryText.detailModal.close}
      >
        {heading}
      </DialogHeader>
      <DialogBody className="history-detail-scroll-region">{children}</DialogBody>
    </DialogFrame>
  );
}
