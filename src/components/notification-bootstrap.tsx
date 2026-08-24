"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { notificationText } from "@/content/ko/notifications";
import { requestNotificationDelivery } from "@/features/notifications/api/notification-delivery";

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
      const delivery = await requestNotificationDelivery(role);
      if (!delivery) return;

      if (delivery.newAssignmentCount > 0) {
        toast.info(
          role === "student"
            ? `${delivery.newAssignmentCount}${notificationText.delivery.studentNewAssignmentsSuffix}`
            : `${delivery.newAssignmentCount}${notificationText.delivery.adminNewAssignmentsSuffix}`,
        );
      }
      if (role === "student" && delivery.deadlineSoonCount > 0) {
        toast.warning(
          `${notificationText.delivery.deadlineSoonPrefix} ${delivery.deadlineSoonCount}${notificationText.delivery.deadlineSoonSuffix}`,
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
