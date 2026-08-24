"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { Button, IconButton } from "@/design-system/primitives/button/button";
import { prefersReducedMotion } from "@/lib/ui/motion";

import type { AssignmentUnitItem } from "../catalog-types";
import styles from "./vocab-assignment-planner.module.css";

export function DayRangeRail({
  onSelect,
  selectedUnitIds,
  units,
}: {
  onSelect: (unitId: string) => void;
  selectedUnitIds: ReadonlySet<string>;
  units: readonly AssignmentUnitItem[];
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dragRef = useRef({ active: false, moved: false, startX: 0, scrollLeft: 0 });

  function scroll(direction: -1 | 1) {
    railRef.current?.scrollBy({
      left: direction * 360,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    if (!rail || event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      scrollLeft: rail.scrollLeft,
    };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag.active) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 5 && !drag.moved) {
      drag.moved = true;
      rail.setPointerCapture(event.pointerId);
      rail.dataset.dragging = "true";
    }
    if (drag.moved) rail.scrollLeft = drag.scrollLeft - distance;
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    if (!rail) return;
    dragRef.current.active = false;
    if (rail.hasPointerCapture(event.pointerId)) {
      rail.releasePointerCapture(event.pointerId);
    }
    rail.dataset.dragging = "false";
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = Math.min(units.length - 1, Math.max(0, index + offset));
    buttonRefs.current[next]?.focus();
    buttonRefs.current[next]?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }

  return (
    <div className={styles.dayRailFrame}>
      <IconButton aria-label="이전 범위 보기" onClick={() => scroll(-1)}>
        ‹
      </IconButton>
      <div
        aria-label="단어 범위"
        className={styles.dayRail}
        data-dragging="false"
        onPointerCancel={endDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        ref={railRef}
        role="group"
      >
        {units.map((unit, index) => (
          <Button
            aria-pressed={selectedUnitIds.has(unit.id)}
            className={styles.dayButton}
            key={unit.id}
            onClick={() => {
              if (!dragRef.current.moved) onSelect(unit.id);
              dragRef.current.moved = false;
            }}
            onKeyDown={(event) => moveFocus(event, index)}
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            size="small"
            variant={selectedUnitIds.has(unit.id) ? "primary" : "filter"}
          >
            {unit.label}
          </Button>
        ))}
      </div>
      <IconButton aria-label="다음 범위 보기" onClick={() => scroll(1)}>
        ›
      </IconButton>
    </div>
  );
}
