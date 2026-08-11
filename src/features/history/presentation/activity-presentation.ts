import { commonText } from "@/content/ko/common";
import { deriveLearningActivityState } from "@/features/history/domain/learning-activity";
import type { AssignmentActivityStatus } from "@/lib/admin/history";
import type { StatusTone } from "@/lib/ui/status";

import {
  buildAttemptStatusPresentation,
  type AttemptScorePresentationInput,
} from "./attempt-presentation";

export type ActivityTimelineInput = AttemptScorePresentationInput & {
  status: AssignmentActivityStatus;
  passingScore: number;
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

export function buildActivityStatusTimeline(
  item: ActivityTimelineInput,
): ActivityStatusTimelinePresentation {
  const status = buildAttemptStatusPresentation(item);
  const state = deriveLearningActivityState(item);
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
      timestamp: state.statusAt,
    },
  };
}
