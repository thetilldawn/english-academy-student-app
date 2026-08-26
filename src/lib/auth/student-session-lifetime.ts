import { STUDENT_SESSION_RENEWAL_INTERVAL_MS } from "@/lib/constants";

export function studentSessionRenewalDelay(lastSeenAt: string, now = Date.now()) {
  const lastSeenMilliseconds = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMilliseconds)) return 0;
  return Math.max(
    0,
    lastSeenMilliseconds + STUDENT_SESSION_RENEWAL_INTERVAL_MS - now,
  );
}
