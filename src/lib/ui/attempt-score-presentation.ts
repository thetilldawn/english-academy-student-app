import { commonText } from "@/content/ko/common";
import type { StatusTone } from "@/lib/ui/status";

export type AttemptScoreTone = "neutral" | "pass" | "fail";

export type AttemptScoreSlot = {
  label: "첫 시험" | "재시험" | "최종" | "점수";
  value: string;
  tone: AttemptScoreTone;
} | null;

export type AttemptScorePresentationInput = {
  status:
    | "not_started"
    | "cancelled"
    | "missed"
    | "in_progress"
    | "completed"
    | "expired"
    | null;
  phase: "initial" | "review" | "retry" | "completed" | null;
  initialScore: number | null | undefined;
  finalScore: number | null | undefined;
  passingScore: number | null | undefined;
  retryStartedAt: string | null | undefined;
};

export type AttemptStatusPresentation = {
  label: string;
  tone: StatusTone;
  className: string;
  outcome: string;
};

function scoreValue(
  score: number | null | undefined,
  compact: boolean,
) {
  if (score === null || score === undefined) return "-";
  return compact ? String(score) : `${score}점`;
}

function scoreTone(
  score: number | null | undefined,
  passingScore: number | null | undefined,
): AttemptScoreTone {
  if (score === null || score === undefined) return "neutral";
  if (passingScore === null || passingScore === undefined) return "neutral";
  return score >= passingScore ? "pass" : "fail";
}

export function buildAttemptScoreSlots(
  input: AttemptScorePresentationInput,
  options: { compact?: boolean } = {},
): [AttemptScoreSlot, AttemptScoreSlot] {
  const compact = options.compact ?? false;
  if (input.status === "missed") {
    if (compact) return [null, null];
    return [
      { label: "첫 시험", value: "미응시", tone: "fail" },
      null,
    ];
  }

  if (input.initialScore === null || input.initialScore === undefined) {
    const tone = input.status === "expired" ? "fail" : "neutral";
    return [{ label: "점수", value: "-", tone }, null];
  }

  if (input.retryStartedAt) {
    return [
      {
        label: "첫 시험",
        value: scoreValue(input.initialScore, compact),
        tone: scoreTone(input.initialScore, input.passingScore),
      },
      {
        label: "재시험",
        value: scoreValue(input.finalScore ?? input.initialScore, compact),
        tone: scoreTone(
          input.finalScore ?? input.initialScore,
          input.passingScore,
        ),
      },
    ];
  }

  if (input.status === "in_progress" && input.phase === "review") {
    return [
      {
        label: "첫 시험",
        value: scoreValue(input.initialScore, compact),
        tone: scoreTone(input.initialScore, input.passingScore),
      },
      null,
    ];
  }

  const finalScore = input.finalScore ?? input.initialScore;
  return [
    {
      label: "최종",
      value: scoreValue(finalScore, compact),
      tone: scoreTone(finalScore, input.passingScore),
    },
    null,
  ];
}

export function buildAttemptStatusPresentation(
  input: AttemptScorePresentationInput,
): AttemptStatusPresentation {
  if (input.status === "not_started" || input.status === null) {
    return {
      label: commonText.activityStatus.notStarted,
      tone: "neutral",
      className: "status-not_started",
      outcome: "not_started",
    };
  }
  if (input.status === "cancelled") {
    return {
      label: commonText.activityStatus.cancelled,
      tone: "neutral",
      className: "status-cancelled",
      outcome: "cancelled",
    };
  }
  if (input.status === "missed") {
    return {
      label: commonText.activityStatus.missed,
      tone: "danger",
      className: "status-failed",
      outcome: "missed",
    };
  }
  if (input.status === "in_progress") {
    if (input.phase === "review") {
      return {
        label: commonText.activityStatus.failed,
        tone: "danger",
        className: "status-failed",
        outcome: "failed",
      };
    }
    return input.phase === "retry" || Boolean(input.retryStartedAt)
      ? {
          label: commonText.activityStatus.retry,
          tone: "warning",
          className: "status-retried",
          outcome: "retried",
        }
      : {
          label: commonText.activityStatus.inProgress,
          tone: "neutral",
          className: "status-in_progress",
          outcome: "in_progress",
        };
  }

  const finalScore = input.finalScore ?? input.initialScore;
  if (
    finalScore !== null &&
    finalScore !== undefined &&
    input.passingScore !== null &&
    input.passingScore !== undefined
  ) {
    if (finalScore < input.passingScore) {
      return {
        label: commonText.activityStatus.failed,
        tone: "danger",
        className: "status-failed",
        outcome: "failed",
      };
    }
    if (input.retryStartedAt) {
      return {
        label: commonText.activityStatus.completed,
        tone: "warning",
        className: "status-retried",
        outcome: "retried",
      };
    }
    return {
      label: commonText.activityStatus.completed,
      tone: "success",
      className: "status-completed",
      outcome: "completed",
    };
  }

  return input.status === "expired"
    ? {
        label: commonText.activityStatus.failed,
        tone: "danger",
        className: "status-failed",
        outcome: "failed",
      }
    : {
        label: commonText.activityStatus.completed,
        tone: "success",
        className: "status-completed",
        outcome: "completed",
      };
}
