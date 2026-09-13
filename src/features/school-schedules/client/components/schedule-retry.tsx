"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/design-system/primitives/button/button";
export function ScheduleRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button disabled={pending} onClick={() => start(() => router.refresh())} variant="quiet">{pending ? "확인 중…" : "다시 시도"}</Button>;
}
