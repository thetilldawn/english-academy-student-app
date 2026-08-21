export const questionOrderModes = [
  "fixed",
  "ascending",
  "descending",
  "random",
] as const;

export type QuestionOrderMode = (typeof questionOrderModes)[number];

export const timingModes = ["total", "per_question"] as const;

export type TimingMode = (typeof timingModes)[number];

export type AssignmentTimingSource = {
  timingMode: TimingMode;
  timeLimitSeconds: number;
  questionTimeLimitSeconds: number | null;
};

export function questionOrderLabel(mode: QuestionOrderMode) {
  if (mode === "random") return "무작위";
  if (mode === "descending") return "내림차순";
  return "오름차순";
}

export function assignmentTimingLabel(source: AssignmentTimingSource) {
  if (source.timingMode === "per_question") {
    return source.questionTimeLimitSeconds !== null &&
      Number.isFinite(source.questionTimeLimitSeconds) &&
      source.questionTimeLimitSeconds > 0
      ? `문제당 ${Math.floor(source.questionTimeLimitSeconds)}초`
      : "시간 확인 필요";
  }

  if (!Number.isFinite(source.timeLimitSeconds) || source.timeLimitSeconds <= 0) {
    return "시간 확인 필요";
  }

  const seconds = Math.floor(source.timeLimitSeconds);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `전체 ${minutes}분`;
  if (minutes === 0) return `전체 ${remainingSeconds}초`;
  return `전체 ${minutes}분 ${remainingSeconds}초`;
}
