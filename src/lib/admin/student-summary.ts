import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";

export type StudentSummary = {
  id: string;
  displayName: string;
  schoolName: string | null;
  gradeLabel: string | null;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  readingCurriculumStage: ReadingCurriculumStage;
  readingContextSyncStatus:
    | "not_synced"
    | "not_configured"
    | "synced"
    | "failed";
  status: "active" | "blocked";
  codeGeneration: number;
  codeStatus: "active" | "blocked" | "expired" | "missing";
  createdAt: string;
};

export type StudentLearningSourceSummary = {
  id: string;
  studentId: string;
  sourceType:
    | "primary_vocab"
    | "exam_vocab"
    | "textbook"
    | "supplement"
    | "mock_exam"
    | "passage";
  vocabDatasetId: string | null;
  displayLabel: string;
  rangeMetadata: Record<string, unknown>;
  sortOrder: number;
};

export type StudentClassGroupSummary = {
  id: string;
  name: string;
  studentIds: string[];
};
