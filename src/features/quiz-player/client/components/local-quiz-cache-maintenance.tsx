"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { scheduleLocalQuizMaintenance } from "../flows/local-quiz-maintenance";

export function LocalQuizCacheMaintenance() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/student") return scheduleLocalQuizMaintenance();
  }, [pathname]);
  return null;
}
