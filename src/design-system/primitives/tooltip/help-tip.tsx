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
}: {
  label: string;
  children: ReactNode;
}) {
  const tooltipId = useId();
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

  return (
    <span className={styles.root}>
      <button
        aria-describedby={open ? tooltipId : undefined}
        aria-label={label}
        className={styles.trigger}
        onBlur={hide}
        onClick={() => (open ? hide() : show())}
        onFocus={show}
        onKeyDown={(event) => {
          if (event.key === "Escape") hide();
        }}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (document.activeElement !== triggerRef.current) hide();
        }}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true">?</span>
      </button>
      <span
        className={styles.content}
        id={tooltipId}
        onToggle={(event) =>
          setOpen(event.currentTarget.matches(":popover-open"))
        }
        popover="auto"
        ref={tooltipRef}
        role="tooltip"
      >
        {children}
      </span>
    </span>
  );
}
