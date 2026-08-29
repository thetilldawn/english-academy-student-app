"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import styles from "./help-tip.module.css";

const VIEWPORT_GAP = 8;
const TOOLTIP_GAP = 7;
const TOOLTIP_MAX_WIDTH = 280;

export type TooltipPositionInput = {
  tooltipHeight: number;
  triggerBottom: number;
  triggerLeft: number;
  triggerTop: number;
  triggerWidth: number;
  viewportHeight: number;
  viewportWidth: number;
};

export function computeTooltipPosition({
  tooltipHeight,
  triggerBottom,
  triggerLeft,
  triggerTop,
  triggerWidth,
  viewportHeight,
  viewportWidth,
}: TooltipPositionInput) {
  const width = Math.max(
    0,
    Math.min(TOOLTIP_MAX_WIDTH, viewportWidth - VIEWPORT_GAP * 2),
  );
  const centeredLeft = triggerLeft + triggerWidth / 2 - width / 2;
  const left = Math.min(
    Math.max(centeredLeft, VIEWPORT_GAP),
    viewportWidth - width - VIEWPORT_GAP,
  );
  const preferredTop = triggerTop - tooltipHeight - TOOLTIP_GAP;
  const fallbackTop = Math.min(
    triggerBottom + TOOLTIP_GAP,
    viewportHeight - tooltipHeight - VIEWPORT_GAP,
  );

  return {
    left: Math.max(left, VIEWPORT_GAP),
    top: Math.max(
      preferredTop >= VIEWPORT_GAP ? preferredTop : fallbackTop,
      VIEWPORT_GAP,
    ),
    width,
  };
}

export const inlineHelpClassName = styles.inline;

export function HelpTip({
  label,
  children,
  trigger,
}: {
  label: string;
  children: ReactNode;
  trigger: ReactNode;
}) {
  const tooltipId = useId();
  const transientOpenRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  const positionTooltip = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip || !tooltip.matches(":popover-open")) return;

    const triggerRect = trigger.getBoundingClientRect();
    const position = computeTooltipPosition({
      tooltipHeight: tooltip.offsetHeight,
      triggerBottom: triggerRect.bottom,
      triggerLeft: triggerRect.left,
      triggerTop: triggerRect.top,
      triggerWidth: triggerRect.width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    });

    tooltip.style.width = `${position.width}px`;
    tooltip.style.left = `${position.left}px`;
    tooltip.style.top = `${position.top}px`;
  }, []);

  const show = useCallback(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip || tooltip.matches(":popover-open")) return;
    tooltip.showPopover();
    window.requestAnimationFrame(positionTooltip);
  }, [positionTooltip]);

  const hide = useCallback(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip || !tooltip.matches(":popover-open")) return;
    tooltip.hidePopover();
  }, []);

  useEffect(() => {
    if (!open) return;
    const reposition = () => positionTooltip();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, positionTooltip]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return;
      }
      transientOpenRef.current = false;
      hide();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      transientOpenRef.current = false;
      hide();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [hide, open]);

  return (
    <span className={styles.labelRoot}>
      <button
        aria-describedby={open ? tooltipId : undefined}
        aria-label={label}
        className={styles.labelTrigger}
        onBlur={() => {
          transientOpenRef.current = false;
          hide();
        }}
        onClick={() => {
          const tooltip = tooltipRef.current;
          if (tooltip?.matches(":popover-open")) {
            if (transientOpenRef.current) {
              transientOpenRef.current = false;
              return;
            }
            hide();
            return;
          }
          transientOpenRef.current = false;
          show();
        }}
        onFocus={() => {
          if (tooltipRef.current?.matches(":popover-open")) return;
          transientOpenRef.current = true;
          show();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          event.stopPropagation();
          transientOpenRef.current = false;
          hide();
        }}
        onMouseEnter={() => {
          if (tooltipRef.current?.matches(":popover-open")) return;
          transientOpenRef.current = true;
          show();
        }}
        onMouseLeave={() => {
          if (document.activeElement !== triggerRef.current) {
            transientOpenRef.current = false;
            hide();
          }
        }}
        ref={triggerRef}
        type="button"
      >
        {trigger}
      </button>
      <span
        className={styles.content}
        id={tooltipId}
        onToggle={(event) =>
          setOpen(event.currentTarget.matches(":popover-open"))
        }
        popover="manual"
        ref={tooltipRef}
        role="tooltip"
      >
        {children}
      </span>
    </span>
  );
}
