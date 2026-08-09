"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";

import { ModalBody, ModalFrame, ModalHeader } from "@/components/ui-modal";
import { adminHistoryText } from "@/content/ko/admin-history";

export function RouteDetailDialog({
  children,
  heading,
}: {
  children: ReactNode;
  heading: ReactNode;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closingRef = useRef(false);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    router.back();
  }, [router]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) close();
  }

  return (
    <ModalFrame
      aria-labelledby="route-history-detail-title"
      className="dialog-wide route-detail-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={closeOnBackdrop}
      ref={dialogRef}
    >
      <ModalHeader
        closeLabel={adminHistoryText.resultDetail.backToResults}
        onClose={close}
      >
        {heading}
      </ModalHeader>
      <ModalBody className="history-detail-scroll-region">{children}</ModalBody>
    </ModalFrame>
  );
}
