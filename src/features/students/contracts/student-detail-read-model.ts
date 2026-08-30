import type { AdminHistoryListItem } from "@/features/history/contracts/admin-history-read-model";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";
import type { StudentLearningSourceItem } from "@/lib/admin/learning-sources";
import type { StudentVocabBookHistory } from "./student-vocab-book-history";

export type StudentCodeView = {
  code: string;
  label: string;
};

export type StudentDetailProfile = {
  codeStatus: "active" | "blocked" | "expired" | "missing";
  createdAt: string;
  currentVocabBook: string | null;
  currentVocabDatasetId: string | null;
  displayName: string;
  gradeLabel: string | null;
  id: string;
  rawPoints: number;
  readingContextSyncStatus:
    | "not_synced"
    | "not_configured"
    | "synced"
    | "failed";
  readingCurriculumStage: ReadingCurriculumStage;
  schoolName: string | null;
  status: "active" | "blocked";
  updatedAt: string;
};

export type StudentCurrentWrongSummary = {
  repeatedWrongWordCount: number;
  wrongWordCount: number;
};

export type StudentDetailInitial = {
  history: StudentHistoryPage;
  learningSources: StudentLearningSourceItem[];
  snapshotAt: string;
  student: StudentDetailProfile;
  vocabBookHistory: StudentVocabBookHistory[];
  wrongSummary: StudentCurrentWrongSummary;
};

export const studentHistoryPurposeFilters = [
  "all",
  "regular",
  "mixed",
  "review",
] as const;

export const studentHistorySectionFilters = [
  "all",
  "open",
  "needs_attention",
  "completed",
  "archived",
] as const;

export type StudentHistoryFilters = {
  purpose: (typeof studentHistoryPurposeFilters)[number];
  section: (typeof studentHistorySectionFilters)[number];
  since: string | null;
};

export const emptyStudentHistoryFilters: StudentHistoryFilters = {
  purpose: "all",
  section: "all",
  since: null,
};

export type StudentHistoryInitialRequest = {
  filters: StudentHistoryFilters;
  mode: "initial";
};

export type StudentHistoryPageRequest = {
  cursor: string;
  filters: StudentHistoryFilters;
  mode: "page";
};

export type StudentHistoryReadRequest =
  | StudentHistoryInitialRequest
  | StudentHistoryPageRequest;

export type StudentHistoryPageChunk = {
  items: AdminHistoryListItem[];
  nextCursor: string | null;
};

export type StudentHistoryPage = StudentHistoryPageChunk & {
  totalCount: number;
};
