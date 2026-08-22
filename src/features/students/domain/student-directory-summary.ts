import { deriveLearningActivityState } from "@/features/history/domain/learning-activity";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

const completedKinds = new Set([
  "completed_first_try",
  "completed_after_retry",
  "failed",
  "expired",
]);

function latestTimestamp(values: Array<string | null | undefined>) {
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest;
    if (!latest) return value;
    return Date.parse(value) > Date.parse(latest) ? value : latest;
  }, null);
}

export function summarizeStudentDirectoryActivities(
  activities: readonly AssignmentHistorySummary[],
) {
  let completedCount = 0;
  let missedCount = 0;
  let notStartedCount = 0;
  let recentAttemptAt: string | null = null;

  for (const activity of activities) {
    const state = deriveLearningActivityState(activity);
    if (completedKinds.has(state.kind)) completedCount += 1;
    if (state.kind === "missed") missedCount += 1;
    if (state.kind === "not_started") notStartedCount += 1;

    recentAttemptAt = latestTimestamp([
      recentAttemptAt,
      activity.startedAt,
      activity.initialCompletedAt,
      activity.retryStartedAt,
      activity.completedAt,
    ]);
  }

  return {
    completedCount,
    missedCount,
    notStartedCount,
    recentAttemptAt,
  };
}
