"use client";

import { useCallback, type ReactNode } from "react";

import {
  DialogBody,
  DialogFrame,
  DialogHeader,
  type DialogCloseReason,
  type DialogHeight,
  type DialogLayout,
  type DialogSize,
} from "../../primitives/dialog/dialog";

export type RouteDetailDialogProps = {
  backLabel?: string;
  beforeRouteClose?: (reason: DialogCloseReason) => boolean;
  children: ReactNode;
  closeDisabled?: boolean;
  closeLabel: string;
  contentMode?: "body" | "structured";
  fullScreenMobile?: boolean;
  heading: ReactNode;
  headerActions?: ReactNode;
  height?: DialogHeight;
  layout?: DialogLayout;
  onBack?: () => void;
  onRequestClose: (reason: DialogCloseReason) => void;
  size?: DialogSize;
  titleId: string;
};

export function RouteDetailDialog({
  backLabel,
  beforeRouteClose,
  children,
  closeDisabled = false,
  closeLabel,
  contentMode = "body",
  fullScreenMobile = false,
  heading,
  headerActions,
  height,
  layout = "body",
  onBack,
  onRequestClose,
  size = "wide",
  titleId,
}: RouteDetailDialogProps) {
  const close = useCallback((reason: DialogCloseReason) => {
    if (beforeRouteClose && !beforeRouteClose(reason)) return;
    onRequestClose(reason);
  }, [beforeRouteClose, onRequestClose]);

  return (
    <DialogFrame
      aria-labelledby={titleId}
      closeDisabled={closeDisabled}
      fullScreenMobile={fullScreenMobile}
      height={height}
      layout={layout}
      onRequestClose={close}
      size={size}
    >
      <DialogHeader
        actions={headerActions}
        backLabel={backLabel}
        closeLabel={closeLabel}
        onBack={onBack}
      >
        {heading}
      </DialogHeader>
      {contentMode === "structured" ? children : <DialogBody>{children}</DialogBody>}
    </DialogFrame>
  );
}
