"use client";

import {
  isVocabularyLearningSource,
  learningSourceTypeLabel,
  type StudentLearningSourceItem,
} from "@/lib/admin/learning-sources";

type LearningView = "vocab" | "passage";

export function StudentLearningSourceList({
  fallbackPrimaryLabel,
  onOpen,
  sources,
}: {
  fallbackPrimaryLabel?: string | null;
  onOpen?: (view: LearningView, source: StudentLearningSourceItem) => void;
  sources: StudentLearningSourceItem[];
}) {
  const sortedSources = sources.toSorted(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.displayLabel.localeCompare(right.displayLabel, "ko-KR"),
  );
  const hasPrimary = sortedSources.some(
    (source) => source.sourceType === "primary_vocab",
  );
  const visibleSources = hasPrimary
    ? sortedSources
    : [
        {
          id: "fallback-primary",
          studentId: "",
          sourceType: "primary_vocab" as const,
          vocabDatasetId: null,
          displayLabel: fallbackPrimaryLabel ?? "미선택",
          rangeMetadata: {},
          sortOrder: -1,
        },
        ...sortedSources,
      ];

  return (
    <div className="student-learning-source-list">
      {visibleSources.map((source) => {
        const view = isVocabularyLearningSource(source.sourceType)
          ? "vocab"
          : "passage";
        return (
          <div className="student-learning-source-row" key={source.id}>
            <div>
              <span>{learningSourceTypeLabel(source.sourceType)}</span>
              <strong>{source.displayLabel}</strong>
            </div>
            {onOpen ? (
              <button
                aria-label={`${learningSourceTypeLabel(source.sourceType)} 학습 관리 열기`}
                className="learning-add-button"
                onClick={() => onOpen(view, source)}
                type="button"
              >
                +
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
