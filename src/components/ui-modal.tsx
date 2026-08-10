import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import {
  Button,
  IconButton,
} from "@/design-system/primitives/button/button";
import { commonText } from "@/content/ko/common";

export const ModalFrame = forwardRef<
  HTMLDialogElement,
  ComponentPropsWithoutRef<"dialog">
>(function ModalFrame({ children, className = "", ...props }, ref) {
  return (
    <dialog
      className={["dialog", "modal-frame", className]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      {...props}
    >
      {children}
    </dialog>
  );
});

export function ModalHeader({
  backLabel,
  children,
  closeLabel = commonText.modal.close,
  disabled = false,
  onBack,
  onClose,
}: {
  backLabel?: string;
  children: ReactNode;
  closeLabel?: string;
  disabled?: boolean;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <header className="modal-frame-header">
      <div className="modal-frame-title-row">
        {onBack ? (
          <IconButton
            aria-label={backLabel ?? commonText.modal.back}
            disabled={disabled}
            onClick={onBack}
            variant="quiet"
          >
            ←
          </IconButton>
        ) : null}
        <div className="modal-frame-title">{children}</div>
      </div>
      <Button
        aria-label={closeLabel}
        disabled={disabled}
        onClick={onClose}
        size="small"
        variant="quiet"
      >
        {closeLabel}
      </Button>
    </header>
  );
}

export function ModalBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["modal-frame-body", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <footer className="modal-frame-footer">{children}</footer>;
}
