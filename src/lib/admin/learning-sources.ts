export type StudentLearningSourceType =
  | "primary_vocab"
  | "exam_vocab"
  | "textbook"
  | "supplement"
  | "mock_exam"
  | "passage";

export type StudentLearningSourceItem = {
  id: string;
  studentId: string;
  sourceType: StudentLearningSourceType;
  vocabDatasetId: string | null;
  displayLabel: string;
  rangeMetadata: Record<string, unknown>;
  sortOrder: number;
};

const sourceTypeLabels: Record<StudentLearningSourceType, string> = {
  primary_vocab: "최근 단어장",
  exam_vocab: "시험 대비",
  textbook: "교과서",
  supplement: "부교재",
  mock_exam: "모의고사",
  passage: "지문",
};

export function learningSourceTypeLabel(type: StudentLearningSourceType) {
  return sourceTypeLabels[type];
}

export function learningSourceLabelsForStudent(
  sources: StudentLearningSourceItem[],
  studentId: string,
) {
  return sources
    .filter((source) => source.studentId === studentId)
    .toSorted(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.displayLabel.localeCompare(right.displayLabel, "ko-KR"),
    )
    .map((source) => source.displayLabel);
}

export function isVocabularyLearningSource(
  type: StudentLearningSourceType,
) {
  return type === "primary_vocab" || type === "exam_vocab";
}
