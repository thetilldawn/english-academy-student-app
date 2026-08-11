import { commonText } from "@/content/ko/common";
import {
  deriveLearningActivityState,
  type LearningActivityOrderInput,
} from "@/features/history/domain/learning-activity";
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
  passed?: boolean | null | undefined;
  retryStartedAt: string | null | undefined;
};

export type AttemptOutcome =
  | "cancelled"
  | "completed"
  | "failed"
  | "in_progress"
  | "missed"
  | "not_started"
  | "retried";

export type AttemptStatusPresentation = {
  label: string;
  tone: StatusTone;
  outcome: AttemptOutcome;
};

function scoreValue(score: number | null | undefined, compact: boolean) {
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

function scoreToneForAttempt(
  input: AttemptScorePresentationInput,
  score: number | null | undefined,
): AttemptScoreTone {
  if (input.status === "expired" || input.status === "missed") return "fail";
  return scoreTone(score, input.passingScore);
}

export function buildAttemptScoreSlots(
  input: AttemptScorePresentationInput,
  options: { compact?: boolean } = {},
): [AttemptScoreSlot, AttemptScoreSlot] {
  const compact = options.compact ?? false;
  if (input.status === "missed") {
    if (compact) return [null, null];
    return [{ label: "첫 시험", value: "미응시", tone: "fail" }, null];
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
        tone: scoreToneForAttempt(input, input.initialScore),
      },
      {
        label: "재시험",
        value: scoreValue(input.finalScore ?? input.initialScore, compact),
        tone: scoreToneForAttempt(input, input.finalScore ?? input.initialScore),
      },
    ];
  }

  if (input.status === "in_progress" && input.phase === "review") {
    return [
      {
        label: "첫 시험",
        value: scoreValue(input.initialScore, compact),
        tone: scoreToneForAttempt(input, input.initialScore),
      },
      null,
    ];
  }

  const finalScore = input.finalScore ?? input.initialScore;
  return [
    {
      label: "최종",
      value: scoreValue(finalScore, compact),
      tone: scoreToneForAttempt(input, finalScore),
    },
    null,
  ];
}

export function hasAttemptScoreContent(
  input: AttemptScorePresentationInput,
  options: { compact?: boolean } = {},
) {
  return buildAttemptScoreSlots(input, options).some(Boolean);
}

export function buildAttemptStatusPresentation(
  input: AttemptScorePresentationInput,
): AttemptStatusPresentation {
  const state = deriveLearningActivityState({
    activityAt: "",
    assignedAt: null,
    availableUntil: null,
    cancelledAt: null,
    completedAt: null,
    deadlineAt: null,
    finalScore: input.finalScore,
    initialScore: input.initialScore,
    missedAt: null,
    passed: input.passed,
    passingScore: input.passingScore ?? 0,
    phase: input.phase,
    retryStartedAt: input.retryStartedAt,
    startedAt: null,
    status: input.status,
  } satisfies LearningActivityOrderInput);

  const presentationByKind: Record<
    typeof state.kind,
    Omit<AttemptStatusPresentation, "outcome">
  > = {
    not_started: {
      label: commonText.activityStatus.notStarted,
      tone: "neutral",
    },
    initial_in_progress: {
      label: commonText.activityStatus.inProgress,
      tone: "neutral",
    },
    review_pending: {
      label: commonText.activityStatus.failed,
      tone: "danger",
    },
    retry_in_progress: {
      label: commonText.activityStatus.retry,
      tone: "warning",
    },
    missed: {
      label: commonText.activityStatus.missed,
      tone: "danger",
    },
    expired: {
      label: commonText.activityStatus.failed,
      tone: "danger",
    },
    failed: {
      label: commonText.activityStatus.failed,
      tone: "danger",
    },
    completed_first_try: {
      label: commonText.activityStatus.completed,
      tone: "success",
    },
    completed_after_retry: {
      label: commonText.activityStatus.completed,
      tone: "warning",
    },
    cancelled: {
      label: commonText.activityStatus.cancelled,
      tone: "neutral",
    },
  };

  return { ...presentationByKind[state.kind], outcome: state.outcome };
}
