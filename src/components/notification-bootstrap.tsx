"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { notificationText } from "@/content/ko/notifications";

const responseSchema = z.object({
  newAssignmentCount: z.number().int().nonnegative(),
  deadlineSoonCount: z.number().int().nonnegative(),
});

const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

export function NotificationBootstrap({
  role,
}: {
  role: "student" | "admin";
}) {
  const inFlight = useRef(false);

  const deliver = useCallback(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      const response = await fetch(`/api/${role}/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const payload: unknown = await response.json();
      if (!response.ok) return;
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success) return;

      if (parsed.data.newAssignmentCount > 0) {
        toast.info(
          role === "student"
            ? `${parsed.data.newAssignmentCount}${notificationText.delivery.studentNewAssignmentsSuffix}`
            : `${parsed.data.newAssignmentCount}${notificationText.delivery.adminNewAssignmentsSuffix}`,
        );
      }
      if (role === "student" && parsed.data.deadlineSoonCount > 0) {
        toast.warning(
          `${notificationText.delivery.deadlineSoonPrefix} ${parsed.data.deadlineSoonCount}${notificationText.delivery.deadlineSoonSuffix}`,
        );
      }
    } catch {
      // 알림 확인 실패는 현재 화면의 핵심 동작을 막지 않는다.
    } finally {
      inFlight.current = false;
    }
  }, [role]);

  useEffect(() => {
    void deliver();
    const intervalId = window.setInterval(
      () => void deliver(),
      RECHECK_INTERVAL_MS,
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void deliver();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [deliver]);

  return null;
}
