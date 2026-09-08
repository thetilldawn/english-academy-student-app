"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { Button, IconButton } from "../button/button";

import styles from "./dialog.module.css";

export type DialogCloseReason = "backdrop" | "close-button" | "escape";
export type DialogHeight = "auto" | "large" | "medium";
export type DialogLayout = "body" | "body-footer" | "tabs" | "tabs-footer";
export type DialogSize = "compact" | "default" | "wide" | "extra-wide";

type DialogContextValue = {
  closeDisabled: boolean;
  requestClose: (reason: DialogCloseReason) => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);
const DialogVisibilityContext = createContext(true);

/** Presentation only: the owning feature decides whether its content may be shown. */
export function DialogVisibilityBoundary({ visible, children }: { visible: boolean; children: ReactNode }) {
  return <DialogVisibilityContext.Provider value={visible}>
    <div hidden={!visible} inert={!visible} style={{ display: visible ? "contents" : "none" }}>{children}</div>
  </DialogVisibilityContext.Provider>;
}

let activeDialogCount = 0;
let previousBodyOverflow = "";
let previousHtmlOverflow = "";

function lockDocumentScroll() {
  if (activeDialogCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }
  activeDialogCount += 1;
}

function unlockDocumentScroll() {
  activeDialogCount = Math.max(0, activeDialogCount - 1);
  if (activeDialogCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousHtmlOverflow;
  }
}

function useDialogContext() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("DialogHeader must be rendered inside DialogFrame.");
  }
  return context;
}

function hasOpenPopover() {
  return Array.from(document.querySelectorAll<HTMLElement>("[popover]")).some(
    (popover) => {
      try {
        return popover.matches(":popover-open");
      } catch {
        return false;
      }
    },
  );
}

type DialogFrameProps = Omit<
  ComponentPropsWithoutRef<"dialog">,
  "onCancel" | "onClick" | "onClose" | "onKeyDown"
> & {
  closeDisabled?: boolean;
  fullScreenMobile?: boolean;
  height?: DialogHeight;
  layout?: DialogLayout;
  onAfterClose?: () => void;
  onRequestClose: (reason: DialogCloseReason) => void;
  size?: DialogSize;
};

export const DialogFrame = forwardRef<HTMLDialogElement, DialogFrameProps>(
  function DialogFrame(
    {
      children,
      className = "",
      closeDisabled = false,
      fullScreenMobile = false,
      height = "auto",
      layout = "body",
      onAfterClose,
      onRequestClose,
      size = "default",
      style,
      ...props
    },
    forwardedRef,
  ) {
    const localRef = useRef<HTMLDialogElement | null>(null);
    const visible = useContext(DialogVisibilityContext);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const pausedFocusRef = useRef<HTMLElement | null>(null);
    const escapeKeyRequestRef = useRef(false);
    const escapeResetTimerRef = useRef<number | null>(null);

    const setRef = useCallback(
      (node: HTMLDialogElement | null) => {
        localRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    const requestClose = useCallback(
      (reason: DialogCloseReason) => {
        if (!closeDisabled) onRequestClose(reason);
      },
      [closeDisabled, onRequestClose],
    );

    useLayoutEffect(() => {
      if (!visible) return;
      const dialog = localRef.current;
      returnFocusRef.current ??=
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (dialog && !dialog.open) dialog.showModal();
      if (pausedFocusRef.current?.isConnected) pausedFocusRef.current.focus({ preventScroll: true });
      lockDocumentScroll();

      return () => {
        if (escapeResetTimerRef.current !== null) {
          window.clearTimeout(escapeResetTimerRef.current);
        }
        if (dialog?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) pausedFocusRef.current = document.activeElement;
        if (dialog?.open) dialog.close();
        unlockDocumentScroll();
        const returnTarget = returnFocusRef.current;
        window.requestAnimationFrame(() => {
          if (returnTarget?.isConnected && !dialog?.open) returnTarget.focus();
        });
      };
    }, [visible]);

    return (
      <DialogContext.Provider value={{ closeDisabled, requestClose }}>
        <dialog
          className={[
            styles.frame,
            styles[size],
            styles[height],
            fullScreenMobile ? styles.fullScreenMobile : "",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          data-layout={layout}
          onCancel={(event) => {
            event.preventDefault();
            if (escapeKeyRequestRef.current) return;
            requestClose("escape");
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              requestClose("backdrop");
            }
          }}
          onClose={() => {
            // A close event is queued. Do not treat a hide/reopen cycle as the
            // user's final close if the same dialog has already reopened.
            if (visible && !localRef.current?.open) onAfterClose?.();
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "Escape" ||
              event.defaultPrevented ||
              hasOpenPopover()
            ) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            escapeKeyRequestRef.current = true;
            if (escapeResetTimerRef.current !== null) {
              window.clearTimeout(escapeResetTimerRef.current);
            }
            escapeResetTimerRef.current = window.setTimeout(() => {
              escapeKeyRequestRef.current = false;
              escapeResetTimerRef.current = null;
            }, 0);
            requestClose("escape");
          }}
          ref={setRef}
          {...props}
          style={{ ...style, ...(!visible ? { display: "none" } : {}) }}
        >
          {children}
        </dialog>
      </DialogContext.Provider>
    );
  },
);

export function DialogHeader({
  actions,
  backLabel,
  children,
  closeLabel,
  onBack,
  showCloseButton = true,
}: {
  actions?: ReactNode;
  backLabel?: string;
  children: ReactNode;
  closeLabel: string;
  onBack?: () => void;
  showCloseButton?: boolean;
}) {
  const { closeDisabled, requestClose } = useDialogContext();

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        {onBack ? (
          <IconButton
            aria-label={backLabel ?? closeLabel}
            disabled={closeDisabled}
            onClick={onBack}
            variant="quiet"
          >
            ←
          </IconButton>
        ) : null}
        <div className={styles.title}>{children}</div>
      </div>
      {actions || showCloseButton ? <div className={styles.headerActions}>
        {actions}
        {showCloseButton ? <Button
          aria-label={closeLabel}
          disabled={closeDisabled}
          onClick={() => requestClose("close-button")}
          size="small"
          variant="quiet"
        >
          {closeLabel}
        </Button> : null}
      </div> : null}
    </header>
  );
}

export function DialogBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={[styles.body, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export function DialogFooter({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <footer className={[styles.footer, className].filter(Boolean).join(" ")}>
      {children}
    </footer>
  );
}
