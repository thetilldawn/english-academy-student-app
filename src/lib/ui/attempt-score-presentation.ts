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
    return [null, { label: "점수", value: "-", tone }];
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
    null,
    {
      label: "최종",
      value: scoreValue(finalScore),
      tone: scoreTone(finalScore, input.passingScore),
    },
  ];
}
