"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

const VIEWPORT_GAP = 8;
const TOOLTIP_GAP = 7;
const TOOLTIP_MAX_WIDTH = 280;

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
    if (!trigger || !tooltip || !tooltip.matches(":popover-open")) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(
      TOOLTIP_MAX_WIDTH,
      window.innerWidth - VIEWPORT_GAP * 2,
    );
    tooltip.style.width = `${width}px`;
    const height = tooltip.offsetHeight;
    const centeredLeft =
      triggerRect.left + triggerRect.width / 2 - width / 2;
    const left = Math.min(
      Math.max(centeredLeft, VIEWPORT_GAP),
      window.innerWidth - width - VIEWPORT_GAP,
    );
    const preferredTop = triggerRect.top - height - TOOLTIP_GAP;
    const top =
      preferredTop >= VIEWPORT_GAP
        ? preferredTop
        : Math.min(
            triggerRect.bottom + TOOLTIP_GAP,
            window.innerHeight - height - VIEWPORT_GAP,
          );

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(top, VIEWPORT_GAP)}px`;
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
    <span className="help-tip">
      <button
        aria-describedby={tooltipId}
        aria-expanded={open}
        aria-label={label}
        className="help-tip-button"
        onBlur={hide}
        onClick={show}
        onFocus={show}
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
        className="help-tip-content"
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
