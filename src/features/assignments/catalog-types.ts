import type {
  CataloguedDataset,
  CataloguedUnit,
} from "@/lib/admin/dataset-catalog";

export type AssignmentDatasetItem = CataloguedDataset & {
  isActive: boolean;
  rowCount: number;
  status: "pending_review" | "ready" | "retired";
};

export type AssignmentStudentItem = {
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  displayName: string;
  gradeLabel: string | null;
  id: string;
  schoolName: string | null;
  status: "active" | "blocked";
};

export type AssignmentUnitItem = CataloguedUnit & {
  datasetId: string;
  entryCount: number;
  id: string;
  kind: "day" | "supplement";
  label: string;
  number: number | null;
  sortIndex: number;
};

export type AssignmentLearningSourceItem = {
  displayLabel: string;
  id: string;
  rangeMetadata: Record<string, unknown>;
  sortOrder: number;
  sourceType:
    | "primary_vocab"
    | "exam_vocab"
    | "textbook"
    | "supplement"
    | "mock_exam"
    | "passage";
  studentId: string;
  vocabDatasetId: string | null;
};

export type AssignmentProgressItem = {
  latestAttemptId: string | null;
  latestAssignmentTitle: string | null;
  latestAttemptNumber: number | null;
  latestCompletedAssignmentTitle: string | null;
  latestCompletedAt: string | null;
  latestCompletedFinalScore: number | null;
  latestCompletedInitialScore: number | null;
  latestFinalScore: number | null;
  latestInitialScore: number | null;
  latestPassed: boolean | null;
  latestPassingScore: number | null;
  latestPhase: "initial" | "review" | "retry" | "completed" | null;
  latestRetryStartedAt: string | null;
  latestScore: number | null;
  latestStartedAt: string | null;
  latestStatus:
    | "not_started"
    | "cancelled"
    | "missed"
    | "in_progress"
    | "completed"
    | "expired"
    | null;
  latestUnitLabel: string | null;
  recommendationReason:
    | "assigned"
    | "first"
    | "next"
    | "repeat"
    | "resume"
    | "complete"
    | "manual"
    | null;
  recommendedDatasetId: string | null;
  recommendedDirection: 1 | -1;
  recommendedRangeTruncated: boolean;
  recommendedUnitId: string | null;
  recommendedUnitIds: string[];
  recommendedUnitLabel: string | null;
  recommendedUnitLabels: string[];
  studentId: string;
};
