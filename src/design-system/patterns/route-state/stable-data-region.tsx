"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep only the space, never the previous private DOM, while checking access. */
export function StableDataRegion({ pending, fallback, children }: {
  pending: boolean; fallback: ReactNode; children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(240);
  useEffect(() => {
    if (pending || !content.current || typeof ResizeObserver === "undefined") return;
    const element = content.current;
    const observer = new ResizeObserver(() => {
      const next = Math.ceil(element.getBoundingClientRect().height);
      if (next > 0) setHeight(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [pending]);
  return <div aria-busy={pending} style={pending ? { minHeight: height } : undefined}>
    <div ref={content}>{pending ? fallback : children}</div>
  </div>;
}
