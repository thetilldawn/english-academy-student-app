"use client";

import {
  isVocabularyLearningSource,
  learningSourceTypeLabel,
  type StudentLearningSourceItem,
} from "@/lib/admin/learning-sources";
import { IconButton } from "@/design-system/primitives/button/button";
import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";

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
          displayLabel:
            fallbackPrimaryLabel ??
            adminStudentsText.learning.source.fallbackPrimary,
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
              <IconButton
                aria-label={formatContentText(
                  adminStudentsText.learning.source.openAria,
                  { type: learningSourceTypeLabel(source.sourceType) },
                )}
                className="learning-add-button"
                onClick={() => onOpen(view, source)}
                variant="quiet"
              >
                +
              </IconButton>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
