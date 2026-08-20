import type {
  VocabCollisionDecisionMode,
  VocabCollisionWarningKind,
} from "../domain/vocab-collision-decisions";

export const vocabCollisionActionLabels: Record<
  VocabCollisionDecisionMode,
  string
> = {
  skip: "건너뜀",
  move: "다음 날 이동",
  allow: "허용",
};

export function vocabCollisionActionAriaLabel(input: {
  mode: VocabCollisionDecisionMode;
  sourceSessionNumber: number;
  studentName: string;
  warningKind: VocabCollisionWarningKind;
}) {
  const action = input.mode === "move" &&
      input.warningKind === "planned_series_order"
    ? "하루 더 이동"
    : input.mode === "allow"
      ? "겹침 허용"
      : vocabCollisionActionLabels[input.mode];
  return `${input.studentName} 원래 ${input.sourceSessionNumber}회 ${action}`;
}
