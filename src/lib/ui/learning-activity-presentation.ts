import { commonText } from "@/content/ko/common";
import type { AssignmentActivityStatus } from "@/lib/admin/history";
import {
  buildAttemptStatusPresentation,
  type AttemptScorePresentationInput,
} from "@/lib/ui/attempt-score-presentation";
import type { StatusTone } from "@/lib/ui/status";

export type ActivityTimelineInput = AttemptScorePresentationInput & {
  status: AssignmentActivityStatus;
  activityAt: string;
  assignedAt: string;
  availableUntil: string | null;
  cancelledAt: string | null;
  missedAt: string | null;
  startedAt: string | null;
  initialCompletedAt?: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
};

export type ActivityTimelineRow = {
  kind: "assigned" | "deadline" | "status";
  label: string;
  tone: StatusTone;
  timestamp: string | null;
};

export type ActivityStatusTimelinePresentation = {
  deadline: ActivityTimelineRow | null;
  status: ActivityTimelineRow;
};

function statusTimestamp(item: ActivityTimelineInput) {
  if (item.status === "not_started") return null;
  if (item.status === "cancelled") {
    return item.cancelledAt ?? item.activityAt;
  }
  if (item.status === "missed") {
    return item.missedAt ?? item.availableUntil ?? item.activityAt;
  }
  if (item.status === "expired") {
    return item.deadlineAt ?? item.activityAt;
  }
  if (item.status === "completed") {
    return item.completedAt ?? item.activityAt;
  }
  if (item.phase === "review") {
    return item.initialCompletedAt ?? item.startedAt ?? item.activityAt;
  }
  if (item.phase === "retry") {
    return item.retryStartedAt ?? item.startedAt ?? item.activityAt;
  }
  return item.startedAt ?? item.activityAt;
}

export function buildActivityStatusTimeline(
  item: ActivityTimelineInput,
): ActivityStatusTimelinePresentation {
  const status = buildAttemptStatusPresentation(item);
  const cancelled = item.status === "cancelled";

  return {
    deadline:
      !cancelled && item.availableUntil
        ? {
            kind: "deadline",
            label: commonText.activityStatus.deadline,
            tone: "neutral",
            timestamp: item.availableUntil,
          }
        : item.status === "not_started"
          ? {
              kind: "assigned",
              label: commonText.activityStatus.assigned,
              tone: "neutral",
              timestamp: item.assignedAt,
            }
          : null,
    status: {
      kind: "status",
      label: status.label,
      tone: status.tone,
      timestamp: statusTimestamp(item),
    },
  };
}
