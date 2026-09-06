import { z } from "zod";
import { studentAppText } from "@/content/ko/student-app";
import { formatKoreanActivityDateTime } from "@/lib/format";

// A server-evaluated projection, not a browser implementation of predecessor rules.
export const assignmentReleaseSchema = z.object({
  state: z.enum([
    "unrestricted", "open", "waiting_initial", "waiting_time",
    "schedule_conflict", "held", "cancelled", "unavailable",
  ]),
  opensAt: z.iso.datetime({ offset: true }).nullable(),
  hasDeadline: z.boolean(),
}).strict().superRefine((release, context) => {
  if (release.state === "waiting_time" && release.opensAt === null) {
    context.addIssue({ code: "custom", path: ["opensAt"], message: "공개 시각이 필요합니다." });
  }
});

export type AssignmentRelease = z.infer<typeof assignmentReleaseSchema>;

export function isAssignmentReleaseOpen(release: AssignmentRelease | undefined) {
  // Missing only supports the old read RPC during a rolling deployment.
  // Unknown/malformed states are rejected by the schema, never treated as open.
  return release === undefined || release.state === "open" || release.state === "unrestricted";
}

export function assignmentReleaseNotice(release: AssignmentRelease | undefined): string | null {
  const copy = studentAppText.dashboard.release;
  switch (release?.state) {
    case "waiting_initial":
      return release.hasDeadline ? copy.waitingInitialWithDeadline : copy.waitingInitial;
    case "waiting_time":
      return release.opensAt
        ? copy.waitingTime.replace("{datetime}", formatKoreanActivityDateTime(release.opensAt))
        : copy.checkSchedule;
    case "schedule_conflict": return copy.checkSchedule;
    case "held": return copy.held;
    case "cancelled": return copy.cancelled;
    case "unavailable": return studentAppText.study.notFound;
    default: return null;
  }
}

export function assignmentReleaseStartError(message: string | undefined): string | null {
  const match = /^assignment_release_(waiting_initial|waiting_time|schedule_conflict|held|cancelled|unavailable)$/u.exec(message ?? "");
  if (!match) return null;
  const copy = studentAppText.dashboard.release;
  switch (match[1]) {
    case "waiting_initial": return copy.waitingInitial;
    case "waiting_time": return copy.waitingTimeUnknown;
    case "held": return copy.held;
    case "cancelled": return copy.cancelled;
    case "unavailable": return studentAppText.actions.startError;
    default: return copy.checkSchedule;
  }
}
