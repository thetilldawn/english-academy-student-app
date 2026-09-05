import "server-only";

import { requireStudentSession } from "@/lib/auth/student-session";
import { logServerError } from "@/lib/observability/server-log";
import {
  getStudentAttemptPointSummary,
  getStudentPointBalance,
} from "@/lib/services/learning-point-read-service";

import { HeaderPointSummary } from "../../ui/header-point-summary";

export async function StudentHeaderPoints({
  segments,
}: {
  segments: readonly string[];
}) {
  if (segments[0] === "attempt") return null;
  // Parallel slots authenticate themselves; parent layout execution is not an
  // authorization prerequisite. Keep redirect errors outside the read fallback.
  const student = await requireStudentSession();

  let currentPoints: number;
  try {
    const attemptSummary = segments[0] === "result" && segments.length === 2
      ? await getStudentAttemptPointSummary(student.studentId, segments[1])
      : null;
    currentPoints = attemptSummary?.currentPoints ??
      await getStudentPointBalance(student.studentId);
  } catch (error) {
    logServerError({
      event: "student_header_points_read_failed",
      operation: "student_header_points",
      error,
    });
    return <HeaderPointSummary state="unavailable" />;
  }
  return <HeaderPointSummary currentPoints={currentPoints} />;
}
