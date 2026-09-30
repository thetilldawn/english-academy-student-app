"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, type HTMLAttributes, type ReactNode } from "react";
import styles from "./fit-text.module.css";

type FittingGroup = { register: (node: HTMLElement, group: string) => () => void; update: () => void };
const Context = createContext<FittingGroup | null>(null);

export function fittedFontSize(base: number, available: number, required: number, minimum: number) {
  if (available <= 0 || required <= 0) return base;
  return Math.floor(Math.min(base, Math.max(minimum, base * available / required)) * 10) / 10;
}

/** Measure rendered glyphs, including bold stress marks, never character counts.
 * At the readable minimum, allow horizontal access rather than clipping the word. */
function fit(nodes: Map<HTMLElement, string>) {
  const measured: { node: HTMLElement; size: number; group: string }[] = [];
  const minimum = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.875;
  for (const [node, group] of nodes) {
    const text = node.firstElementChild as HTMLElement | null;
    if (!node.isConnected || !text || node.clientWidth <= 0) continue;
    node.style.removeProperty("--fit-size");
    const base = Number.parseFloat(getComputedStyle(text).fontSize);
    const visualWidth = node.getBoundingClientRect().width;
    const scale = node.offsetWidth > 0 && visualWidth > 0 ? visualWidth / node.offsetWidth : 1;
    measured.push({ node, group, size: fittedFontSize(base, node.clientWidth, text.getBoundingClientRect().width / scale, minimum) });
  }
  for (const item of measured) {
    const size = item.group ? Math.min(...measured.filter(other => other.group === item.group).map(other => other.size)) : item.size;
    item.node.style.setProperty("--fit-size", `${size}px`);
  }
}

function createGroup(): FittingGroup {
  const nodes = new Map<HTMLElement, string>();
  return {
    register(node, group) { nodes.set(node, group); return () => { nodes.delete(node); fit(nodes); }; },
    update() { fit(nodes); },
  };
}

export function FitTextGroup({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const group = useMemo(() => createGroup(), []);
  return <Context.Provider value={group}><div {...props}>{children}</div></Context.Provider>;
}

export function FitText({ children, className, group = "", ...props }: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode; group?: string;
}) {
  const shared = useContext(Context);
  const local = useMemo(() => createGroup(), []);
  const fitting = shared ?? local;
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const unregister = fitting.register(node, group);
    let active = true;
    const update = () => { if (active) fitting.update(); };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    window.addEventListener("resize", update);
    void document.fonts?.ready.then(update);
    document.fonts?.addEventListener("loadingdone", update);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", update);
      document.fonts?.removeEventListener("loadingdone", update);
      unregister();
    };
  }, [children, fitting, group]);
  return <span {...props} ref={ref} className={[styles.box, className].filter(Boolean).join(" ")} data-fit-text="">
    <span className={styles.text}>{children}</span>
  </span>;
}
