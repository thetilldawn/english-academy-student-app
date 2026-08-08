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
  label:
    | "응시 전"
    | "배정 취소"
    | "응시 중"
    | "재시험"
    | "완료"
    | "미통과"
    | "시간 종료";
  className: string;
  outcome: string;
};

function scoreValue(score: number | null | undefined) {
  return score === null || score === undefined ? "-" : `${score}점`;
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
): [AttemptScoreSlot, AttemptScoreSlot] {
  if (input.status === "missed") {
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
        value: scoreValue(input.initialScore),
        tone: scoreTone(input.initialScore, input.passingScore),
      },
      {
        label: "재시험",
        value: scoreValue(input.finalScore ?? input.initialScore),
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
        value: scoreValue(input.initialScore),
        tone: scoreTone(input.initialScore, input.passingScore),
      },
      null,
    ];
  }

  const finalScore = input.finalScore ?? input.initialScore;
  return [
    {
      label: "최종",
      value: scoreValue(finalScore),
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
      label: "응시 전",
      className: "status-not_started",
      outcome: "not_started",
    };
  }
  if (input.status === "cancelled") {
    return {
      label: "배정 취소",
      className: "status-cancelled",
      outcome: "cancelled",
    };
  }
  if (input.status === "missed") {
    return {
      label: "미통과",
      className: "status-failed",
      outcome: "missed",
    };
  }
  if (input.status === "in_progress") {
    if (input.phase === "review") {
      return {
        label: "미통과",
        className: "status-failed",
        outcome: "failed",
      };
    }
    return input.phase === "retry" || Boolean(input.retryStartedAt)
      ? {
          label: "재시험",
          className: "status-retried",
          outcome: "retried",
        }
      : {
          label: "응시 중",
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
        label: "미통과",
        className: "status-failed",
        outcome: "failed",
      };
    }
    if (input.retryStartedAt) {
      return {
        label: "재시험",
        className: "status-retried",
        outcome: "retried",
      };
    }
    return {
      label: "완료",
      className: "status-completed",
      outcome: "completed",
    };
  }

  return input.status === "expired"
    ? {
        label: "시간 종료",
        className: "status-expired",
        outcome: "expired",
      }
    : {
        label: "완료",
        className: "status-completed",
        outcome: "completed",
      };
}
