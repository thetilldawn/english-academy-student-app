export const questionOrderModes = [
  "fixed",
  "ascending",
  "descending",
  "random",
] as const;

export type QuestionOrderMode = (typeof questionOrderModes)[number];

export const timingModes = ["total", "per_question"] as const;

export type TimingMode = (typeof timingModes)[number];

export function questionOrderLabel(mode: QuestionOrderMode) {
  if (mode === "random") return "무작위";
  if (mode === "descending") return "내림차순";
  return "오름차순";
}
